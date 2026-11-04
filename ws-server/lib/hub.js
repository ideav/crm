'use strict';
// Раздача пачки событий ядра (POST /push) подключённым клиентам.
// Клиент: { db, user, subs: Set<typeId>, send(obj) }.
//   change — тем, у кого в подписках есть любой тип из цепочки события (types);
//   schema — подписчикам этого типа;
//   bulk   — «перечитать» всем, у кого есть хоть одна подписка в этой базе;
//   notify — адресатам по логину.
// Клиенту уходит одно сообщение {op:"events"} на пачку и по {op:"notify"} на уведомление.

class Hub {
    constructor() {
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

    route(payload) {
        const set = this.byDb.get(payload.db);
        if (!set) return 0;
        const events = Array.isArray(payload.events) ? payload.events : [];
        const notify = Array.isArray(payload.notify) ? payload.notify : [];
        const by = typeof payload.by === 'string' ? payload.by : '';
        let sent = 0;
        for (const client of set) {
            if (client.subs.size) {
                const mine = events.filter((e) => Hub.matches(e, client.subs));
                if (mine.length || payload.bulk) {
                    client.send({ op: 'events', by, reload: !!payload.bulk, events: mine });
                    sent++;
                }
            }
            for (const n of notify) {
                if (Array.isArray(n.to) && n.to.includes(client.user)) {
                    client.send({ op: 'notify', from: n.from, data: n.data });
                    sent++;
                }
            }
        }
        return sent;
    }

    static matches(event, subs) {
        if (event.k === 'schema') return subs.has(event.t);
        if (event.k === 'change') return Array.isArray(event.types) && event.types.some((t) => subs.has(t));
        return false;
    }
}

module.exports = { Hub };
