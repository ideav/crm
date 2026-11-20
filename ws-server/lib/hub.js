'use strict';
// Раздача пачки событий ядра (POST /push) подключённым клиентам. Описание — docs/kb/realtime.md.
//
// Клиент: { db, user, fp, creds, subs: Map<typeId, {shown:Set<id>, feed, masked}>, send(obj) }.
//   fp     — отпечаток прав от ядра (ws_auth): одинаковый у тех, кто видит одни и те же строки;
//   shown  — записи таблицы, которые сейчас на экране подписчика;
//   feed   — лента для внешней системы: все видимые изменения, а не только записи на экране;
//   masked — у таблицы есть маски этого пользователя.
//
// Событие строки несёт цепочку [id, тип] до объекта первого уровня; подписчик таблицы t
// получает изменение ближайшей записи типа t из цепочки. Изменённые строки демон берёт одним
// запросом ядра на группу (база, таблица, fp) — входом участника группы, со всеми масками ядра
// (fetchRows). Подписчику уходит {op:"rows", t, by, rows?, remove?, added?, stale?}:
//   rows   — новые значения записей на экране (лента — всех видимых);
//   remove — записи с экрана, которые удалены или больше не видны по маске;
//   added  — родители (u) новых видимых записей: счётчик плашки «Добавлено N», без id;
//   stale  — "schema" | "bulk" | "lost": данные надо перечитать (плашка), строк нет.
// Записи не на экране и скрытые маской подписчику не сообщаются ничем.

const KIND_RANK = { update: 1, insert: 2, delete: 3 };

class Hub {
    constructor(opts) {
        const o = opts || {};
        this.fetchRows = o.fetchRows || (async () => null);
        this.maxFetch = o.maxFetch || 200;
        this.byDb = new Map();
    }

    add(client) {
        if (!this.byDb.has(client.db)) this.byDb.set(client.db, new Set());
        this.byDb.get(client.db).add(client);
    }

    remove(client) {
        const set = this.byDb.get(client.db);
        if (!set) return;
        set.delete(client);
        if (!set.size) this.byDb.delete(client.db);
    }

    count() {
        let n = 0;
        for (const set of this.byDb.values()) n += set.size;
        return n;
    }

    // Изменения пачки по таблицам: t → Map(id записи → insert|update|delete)
    static byType(events) {
        const out = new Map();
        for (const e of events) {
            if (!e || e.k !== 'change') continue;
            const chain = Array.isArray(e.chain) && e.chain.length ? e.chain : [[e.id, e.t]];
            const seen = new Set();
            chain.forEach((link, idx) => {
                const id = Number(link[0]);
                const t = Number(link[1]);
                if (seen.has(t) || !Number.isInteger(id) || !Number.isInteger(t)) return;
                seen.add(t);
                const kind = idx === 0 && KIND_RANK[e.op] ? e.op : 'update';
                if (!out.has(t)) out.set(t, new Map());
                const m = out.get(t);
                if (!m.has(id) || KIND_RANK[kind] > KIND_RANK[m.get(id)]) m.set(id, kind);
            });
        }
        return out;
    }

    async route(payload) {
        const set = this.byDb.get(payload.db);
        if (!set) return 0;
        const events = Array.isArray(payload.events) ? payload.events : [];
        const notify = Array.isArray(payload.notify) ? payload.notify : [];
        const by = typeof payload.by === 'string' ? payload.by : '';
        const schema = new Set(events.filter((e) => e && e.k === 'schema').map((e) => Number(e.t)));
        const changes = Hub.byType(events);
        const plans = [];               // {client, t, sub, msg, items: Map}
        const groups = new Map();       // "t|fp" → {t, clients: [], ids: Set, rows: Map|null, over}

        for (const client of set) {
            for (const [t, sub] of client.subs) {
                const msg = { op: 'rows', t, by };
                if (payload.bulk || schema.has(t)) {
                    msg.stale = payload.bulk ? 'bulk' : 'schema';
                    plans.push({ client, t, sub, msg, items: null });
                    continue;
                }
                const items = changes.get(t);
                if (!items) continue;
                const plan = { client, t, sub, msg, items, group: null };
                for (const [id, kind] of items) {
                    if (kind === 'delete') continue;
                    if (!sub.feed && kind !== 'insert' && !sub.shown.has(id)) continue;
                    const key = t + '|' + (client.fp || '');
                    if (!groups.has(key)) groups.set(key, { t, clients: [], ids: new Set(), rows: null });
                    const g = groups.get(key);
                    if (plan.group !== g) { plan.group = g; g.clients.push(client); }
                    g.ids.add(id);
                }
                plans.push(plan);
            }
        }

        await Promise.all([...groups.values()].map((g) => this.loadGroup(g)));

        let sent = 0;
        for (const p of plans) {
            const { msg, sub } = p;
            if (p.items) this.fill(p);
            if (msg.stale || msg.rows || msg.remove || msg.added) {
                p.client.send(msg);
                sent++;
            }
            if (msg.remove) msg.remove.forEach((id) => sub.shown.delete(id));
        }
        for (const client of set) {
            for (const n of notify) {
                if (n && Array.isArray(n.to) && n.to.includes(client.user)) {
                    client.send({ op: 'notify', from: n.from, data: n.data });
                    sent++;
                }
            }
        }
        return sent;
    }

    // Строки группы — входом первого участника, чей вход ядро приняло
    async loadGroup(g) {
        if (g.ids.size > this.maxFetch) { g.over = true; return; }
        const ids = [...g.ids];
        for (const client of g.clients) {
            let rows = null;
            try {
                rows = await this.fetchRows(client, g.t, ids);
            } catch (e) {
                rows = null;
            }
            if (Array.isArray(rows)) {
                g.rows = new Map();
                for (const r of rows) if (r && g.ids.has(Number(r.i))) g.rows.set(Number(r.i), r);
                return;
            }
        }
    }

    fill(p) {
        const { msg, sub, items, group } = p;
        const rows = [];
        const remove = [];
        const added = [];
        let lost = false;
        for (const [id, kind] of items) {
            const mine = sub.feed || sub.shown.has(id);
            if (kind === 'delete') {
                if (sub.shown.has(id) || (sub.feed && !sub.masked)) remove.push(id);
                continue;
            }
            if (!mine && kind !== 'insert') continue;
            if (!group || group.over) { if (mine) msg.stale = group && group.over ? 'bulk' : 'lost'; continue; }
            if (!group.rows) { if (mine) lost = true; continue; }
            const row = group.rows.get(id);
            if (row) {
                if (mine) rows.push(row);
                else added.push(Number(row.u) || 0);
            } else if (sub.shown.has(id) || (sub.feed && !sub.masked)) {
                remove.push(id);
            }
        }
        if (msg.stale || lost) {
            msg.stale = msg.stale || 'lost';
            return;
        }
        if (rows.length) msg.rows = rows;
        if (remove.length) msg.remove = remove;
        if (added.length) msg.added = added;
    }
}

module.exports = { Hub };
