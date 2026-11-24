/* CPQ: мастер конфигурации. Несовместимые опции гаснут с объяснением, цена и лимит скидки считаются сразу. Правила и цены - cpq-core.js. */
(function () {
    'use strict';
    const W = window.Cpq, C = W.core;
    const st = { client: '', product: '', sel: [], qty: 1, items: [], edit: -1, disc: 0, id: '', code: '', status: '', oldRows: [], notes: null, version: 1 };
    let M = null, clients = [];

    const grp = () => W.clientGroup(clients, st.client);
    const cur = () => ({ product: st.product, sel: st.sel, qty: st.qty });
    const hashQ = () => { const m = /[#&]q=(\d+)/.exec(location.hash); return m ? m[1] : ''; };
    const fmtAmt = (o, base) => o.priceType === 'percent' ? '+' + C.round1(o.price) + '% от базы (' + C.money(C.round(base * o.price / 100)) + ' ₽)' : (o.price ? '+' + C.money(o.price) + ' ₽' : 'в базе');

    function pickProduct(key) {
        st.product = key; st.sel = key ? C.initial(M, key) : []; st.notes = null; st.edit = -1;
    }
    function click(code) {
        const ev = C.evaluate(M, st.product, st.sel);
        if (ev.disabled[code]) { st.notes = { bad: ev.disabled[code], code: code }; return draw(); }
        const r = C.toggle(M, st.product, st.sel, code);
        if (!r.ok) { st.notes = { bad: r.reasons.map(x => x.text), code: code }; return draw(); }
        st.sel = r.sel;
        st.notes = (r.added.length || r.removed.length) ? { added: r.added, removed: r.removed } : null;
        draw();
    }

    /* ---------- левая часть ---------- */
    function productPicker() {
        return W.el('div', { 'class': 'cpq-products' }, M.products.map(p => W.el('button', { type: 'button', 'class': 'cpq-product' + (p.key === st.product ? ' cpq-on' : ''), 'data-product': p.key, onclick: () => { pickProduct(p.key); draw(); } }, [
            W.el('strong', { text: p.name }), W.el('span', { 'class': 'cpq-muted', text: p.note }),
            W.el('span', { 'class': 'cpq-pmeta', text: 'от ' + C.money(p.base) + ' ₽ · до ' + p.maxPressure + ' бар · срок ' + p.leadDays + ' дн' })])));
    }
    function optionTile(o, ev, base) {
        const on = st.sel.indexOf(o.code) >= 0, dis = !on && ev.disabled[o.code], locked = on && ev.locked[o.code];
        const kids = [W.el('span', { 'class': 'cpq-mark', 'aria-hidden': 'true', text: on ? '✓' : (dis ? '✕' : '') }),
            W.el('span', { 'class': 'cpq-ot' }, [W.el('span', { 'class': 'cpq-oname', text: o.name }), o.note && !dis ? W.el('span', { 'class': 'cpq-muted', text: o.note }) : null,
                dis ? W.el('span', { 'class': 'cpq-why', text: dis[0] }) : null, locked ? W.el('span', { 'class': 'cpq-lock', text: 'Обязательно: ' + ev.locked[o.code] }) : null]),
            W.el('span', { 'class': 'cpq-price', text: fmtAmt(o, base) })];
        const g = M.groupBy[o.group];
        return W.el('button', { type: 'button', 'class': 'cpq-opt' + (on ? ' cpq-on' : '') + (dis ? ' cpq-dis' : '') + (st.notes && st.notes.code === o.code ? ' cpq-pulse' : ''), 'data-code': o.code,
            role: g.mode === 'one' ? 'radio' : 'checkbox', 'aria-checked': on ? 'true' : 'false', 'aria-disabled': dis ? 'true' : 'false', title: dis ? dis.join('\n') : '', onclick: () => click(o.code) }, kids);
    }
    function groups() {
        const ev = C.evaluate(M, st.product, st.sel), base = M.prodBy[st.product].base, host = W.el('div', {});
        M.groups.forEach((g, i) => {
            const opts = M.options.filter(o => o.group === g.name), miss = ev.missing.indexOf(g.name) >= 0;
            host.appendChild(W.el('section', { 'class': 'cpq-group' + (miss ? ' cpq-miss' : ''), 'data-group': g.name }, [
                W.el('h3', {}, [W.el('span', { 'class': 'cpq-step', text: String(i + 1) }), g.name,
                    W.el('span', { 'class': 'cpq-gmeta', html: g.mode === 'one' ? 'выбрать одно' : 'можно несколько' }),
                    g.required ? (miss ? W.el('span', { 'class': 'cpq-badge cpq-warn', text: 'нужно выбрать' }) : W.el('span', { 'class': 'cpq-badge cpq-ok', text: 'выбрано' })) : null]),
                W.el('p', { 'class': 'cpq-muted cpq-hint', text: g.hint }),
                W.el('div', { 'class': 'cpq-opts' }, opts.map(o => optionTile(o, ev, base)))]));
        });
        return host;
    }
    function notes() {
        const n = st.notes; if (!n) return null;
        if (n.bad) return W.el('div', { 'class': 'cpq-banner cpq-b-crit', role: 'alert' }, [W.el('strong', { text: 'Эту опцию выбрать нельзя. ' }), n.bad.join(' ')]);
        const li = [];
        n.added.forEach(x => li.push(W.el('li', { text: 'Добавлено: «' + M.optBy[x.code].name + '», ' + x.why })));
        n.removed.forEach(x => li.push(W.el('li', { text: 'Снято: «' + M.optBy[x.code].name + '», ' + x.why })));
        return W.el('div', { 'class': 'cpq-banner cpq-b-info', role: 'status' }, [W.el('strong', { text: 'Состав изменён по правилам совместимости' }), W.el('ul', { 'class': 'cpq-list' }, li)]);
    }

    /* ---------- правая часть: цена, позиции, скидка ---------- */
    function pricePanel() {
        const box = W.el('div', { 'class': 'cpq-card' });
        if (!st.product) { box.appendChild(W.el('p', { 'class': 'cpq-muted', text: 'Выберите изделие, чтобы увидеть цену.' })); return box; }
        const ev = C.evaluate(M, st.product, st.sel), pl = C.priceLine(M, cur(), grp());
        box.appendChild(W.el('h3', { text: st.edit >= 0 ? 'Правка позиции ' + (st.edit + 1) : 'Текущая позиция' }));
        const rows = pl.parts.map(p => [p.label, p.amount, p.kind]);
        const t = W.el('table', { 'class': 'cpq-sum' }, rows.map(r => W.el('tr', {}, [W.el('td', { text: r[0] }), W.el('td', { 'class': 'cpq-num', text: C.money(r[1]) })])));
        box.appendChild(t);
        const kv = (k, v, cls) => W.el('div', { 'class': 'cpq-kv ' + (cls || '') }, [W.el('span', { text: k }), W.el('span', { 'class': 'cpq-num', text: v })]);
        box.appendChild(kv('По каталогу за единицу', C.money(pl.listUnit) + ' ₽'));
        box.appendChild(kv('Наценка группы «' + (grp() || 'клиент не выбран') + '», ' + (pl.markupPct >= 0 ? '+' : '') + pl.markupPct + '%', (pl.markupAmount >= 0 ? '+' : '') + C.money(pl.markupAmount) + ' ₽'));
        box.appendChild(kv('Цена за единицу', C.money(pl.unit) + ' ₽', 'cpq-strong'));
        const q = W.el('input', { type: 'number', min: '1', max: '999', value: String(st.qty), 'aria-label': 'Количество', 'class': 'cpq-qty', onchange: e => { st.qty = Math.max(1, parseInt(e.target.value, 10) || 1); draw(); } });
        box.appendChild(W.el('div', { 'class': 'cpq-kv' }, [W.el('span', { text: 'Количество, шт' }), q]));
        if (pl.volumePct) box.appendChild(kv('Скидка за объём ' + pl.volumePct + '% (по ступеням, не из лимита менеджера)', '−' + C.money(pl.volumeAmount) + ' ₽'));
        box.appendChild(kv('Итого по позиции', C.money(pl.total) + ' ₽', 'cpq-strong cpq-big'));
        if (!ev.complete) {
            const msgs = ev.missing.map(g => 'Не выбрано: ' + g).concat(ev.errors.map(e => e.text));
            box.appendChild(W.el('div', { 'class': 'cpq-banner cpq-b-warn' }, msgs.map(x => W.el('div', { text: x }))));
        }
        const add = W.btn(st.edit >= 0 ? 'Сохранить позицию' : 'Добавить в КП', () => {
            const it = { product: st.product, sel: st.sel.slice(), qty: st.qty };
            if (st.edit >= 0) st.items[st.edit] = Object.assign(st.items[st.edit], it); else st.items.push(it);
            st.edit = -1; pickProduct(''); st.qty = 1; draw(); window.scrollTo(0, 0);
        }, 'cpq-primary');
        if (!ev.complete) { add.disabled = true; add.title = 'Сначала завершите комплектацию'; }
        box.appendChild(add);
        return box;
    }
    function quotePanel() {
        const box = W.el('div', { 'class': 'cpq-card' });
        box.appendChild(W.el('h3', { text: st.code ? 'КП ' + st.code : 'Новое КП' }));
        const clSel = W.select([['', 'Выберите клиента']].concat(clients.map(c => [c['Клиент'], c['Клиент']])), st.client);
        clSel.onchange = () => { st.client = clSel.value; draw(); };
        box.appendChild(W.field('Клиент', clSel));
        box.appendChild(W.el('p', { 'class': 'cpq-muted', text: st.client ? 'Группа клиента: ' + grp() + ', наценка ' + (C.markupOf(M, grp()) >= 0 ? '+' : '') + C.markupOf(M, grp()) + '%' : 'Группа клиента определяет наценку на цену каталога' }));
        if (!st.items.length) { box.appendChild(W.el('p', { 'class': 'cpq-muted', text: 'Позиций пока нет. Соберите изделие слева и нажмите «Добавить в КП».' })); return box; }
        const q = C.priceQuote(M, st.items, grp(), st.disc, M.me.role);
        box.appendChild(W.el('div', { 'class': 'cpq-items' }, st.items.map((it, i) => {
            const p = q.lines[i], pr = M.prodBy[it.product];
            return W.el('div', { 'class': 'cpq-item' }, [W.el('div', { 'class': 'cpq-item-h' }, [W.el('strong', { text: (i + 1) + '. ' + pr.name }), W.el('span', { 'class': 'cpq-num', text: C.money(p.total) + ' ₽' })]),
                W.el('div', { 'class': 'cpq-muted cpq-small', text: it.qty + ' шт × ' + C.money(p.unit) + ' ₽' + (p.volumePct ? ', скидка за объём ' + p.volumePct + '%' : '') }),
                W.el('div', { 'class': 'cpq-muted cpq-small', text: C.describe(M, it.sel).join(', ') }),
                W.el('div', { 'class': 'cpq-row' }, [W.btn('Изменить', () => { st.edit = i; st.product = it.product; st.sel = it.sel.slice(); st.qty = it.qty; st.notes = null; draw(); window.scrollTo(0, 0); }),
                    W.btn('Удалить', () => { st.items.splice(i, 1); st.edit = -1; draw(); }, 'cpq-danger')])]);
        })));
        const kv = (k, v, cls) => W.el('div', { 'class': 'cpq-kv ' + (cls || '') }, [W.el('span', { text: k }), W.el('span', { 'class': 'cpq-num', text: v })]);
        box.appendChild(kv('Сумма по позициям', C.money(q.subtotal) + ' ₽'));
        const d = W.el('input', { type: 'number', min: '0', max: '60', step: '0.5', value: String(st.disc), 'aria-label': 'Скидка менеджера, %', 'class': 'cpq-qty', 'data-id': 'disc', onchange: e => { st.disc = Math.max(0, C.num(e.target.value)); draw(); } });
        box.appendChild(W.el('div', { 'class': 'cpq-kv' }, [W.el('span', { text: 'Скидка менеджера, %' }), d]));
        const a = q.approval;
        const meter = W.el('div', { 'class': 'cpq-meter', 'aria-hidden': 'true' }, [W.el('div', { 'class': 'cpq-meter-fill ' + (a.blocked ? 'cpq-crit' : (a.needs ? 'cpq-warn' : 'cpq-ok')), style: 'width:' + Math.min(100, st.disc / a.maxLimit * 100) + '%' }),
            W.el('div', { 'class': 'cpq-meter-mark', style: 'left:' + Math.min(100, a.limit / a.maxLimit * 100) + '%', title: 'Ваш лимит' })]);
        box.appendChild(meter);
        box.appendChild(W.el('p', { 'class': 'cpq-muted cpq-small', text: 'Ваша роль: ' + M.me.role + ', лимит скидки ' + C.round1(a.limit) + '%. Предел компании ' + C.round1(a.maxLimit) + '%.' }));
        if (st.disc > 0) box.appendChild(kv('Скидка', '−' + C.money(q.discount) + ' ₽'));
        box.appendChild(kv('Итого без НДС', C.money(q.total) + ' ₽', 'cpq-strong cpq-big'));
        box.appendChild(kv('НДС ' + q.vatPct + '%', C.money(q.vat) + ' ₽'));
        box.appendChild(kv('Итого с НДС', C.money(q.totalVat) + ' ₽', 'cpq-strong'));
        box.appendChild(kv('Маржа (видна только продажам)', q.marginPct + '%' + ' при минимуме ' + C.round1(a.minMargin) + '%', q.approval.lowMargin ? 'cpq-bad' : ''));
        if (a.blocked) box.appendChild(W.el('div', { 'class': 'cpq-banner cpq-b-crit', role: 'alert' }, a.reasons.join('. ')));
        else if (a.needs) box.appendChild(W.el('div', { 'class': 'cpq-banner cpq-b-warn', role: 'status' }, [W.el('strong', { text: 'Нужно согласование: ' + (a.approver || '') + '. ' }), a.reasons.join('. ')]));
        else box.appendChild(W.el('div', { 'class': 'cpq-banner cpq-b-ok', role: 'status' }, 'Скидка в пределах вашего лимита, согласование не требуется.'));
        const ready = st.client && !a.blocked && st.items.length;
        const save = (open) => () => save1(open);
        const b1 = W.btn('Сохранить черновик', save(false)), b2 = W.btn('Сохранить и открыть КП', save(true), 'cpq-primary');
        if (!ready || !W.canWrite('КП')) { b1.disabled = b2.disabled = true; b1.title = b2.title = !W.canWrite('КП') ? 'У вашей роли нет права создавать КП' : (st.client ? 'Исправьте скидку' : 'Выберите клиента'); }
        box.appendChild(W.el('div', { 'class': 'cpq-row' }, [b1, b2]));
        return box;
    }
    function save1(open) {
        const f = W.quoteFields(M, st, grp()), q = f.q;
        let p;
        const till = C.addDays(W.TODAY, C.num(M.settings['Срок действия КП, дн']) || 14);
        if (st.id) {
            const flds = Object.assign({ 'Клиент': st.client, 'Статус КП': 'Черновик', 'Версия': st.version + (st.status === 'Отклонено руководителем' ? 1 : 0), 'Действует до': till }, f.fields);
            p = W.post('_m_set/' + st.id + '?JSON', { fields: flds }).then(() => W.saveItems(M, st.id, st.items, q, st.oldRows)).then(() => W.event(st.id, 'Изменено', 'Версия ' + flds['Версия'] + ', ' + st.items.length + ' поз.'));
        } else {
            const all = W.quotesCache || [], max = all.reduce((s, x) => Math.max(s, parseInt(x.code.slice(-4), 10) || 0), 0), code = 'КП-2026-' + String(max + 1).padStart(4, '0');
            const flds = Object.assign({ 'КП': code, 'Клиент': st.client, 'Менеджер': M.me.name, 'Статус КП': 'Черновик', 'Дата КП': W.TODAY, 'Действует до': till, 'Версия': 1 }, f.fields);
            p = W.post('_m_new/' + W.tid('КП') + '?JSON', { up: 1, fields: flds }).then(r => { const id = String(r.id || r.obj); st.id = id; st.code = code; return W.saveItems(M, id, st.items, q, []); }).then(() => W.event(st.id, 'Создано', 'Конфигурация собрана в мастере'));
        }
        p.then(() => { W.toast('КП ' + (st.code || '') + ' сохранено'); if (open) location.href = W.url('quote') + '#id=' + st.id; else return reloadDraft(); }).catch(e => W.toast(e.message, true));
    }
    function reloadDraft() {
        return W.loadQuote(st.id, M).then(d => { st.oldRows = d.items; st.status = d.status; st.version = d.version; draw(); });
    }

    function draw() {
        const host = W.host, y = window.scrollY;
        host.innerHTML = '';
        host.appendChild(W.el('h1', { text: 'Конфигуратор КП' }));
        host.appendChild(W.el('p', { 'class': 'cpq-sub', text: 'Выбирайте изделие и опции: правила совместимости работают сразу, несовместимое гаснет с объяснением. Правила хранятся в таблице и правятся инженером без программиста.' }));
        const left = W.el('div', { 'class': 'cpq-left' }), right = W.el('div', { 'class': 'cpq-right' });
        left.appendChild(W.el('h2', { text: '1. Изделие' }));
        left.appendChild(productPicker());
        if (st.product) {
            left.appendChild(W.el('h2', { text: '2. Комплектация: ' + M.prodBy[st.product].name }));
            const n = notes(); if (n) left.appendChild(n);
            left.appendChild(groups());
        }
        right.appendChild(pricePanel()); right.appendChild(quotePanel());
        host.appendChild(W.el('div', { 'class': 'cpq-wiz' }, [left, right]));
        window.scrollTo(0, y);
    }

    W.mount(() => {
        const id = hashQ();
        return Promise.all([W.loadModel(), W.rows('Клиент'), W.loadQuotes()]).then(r => {
            M = r[0]; clients = r[1].filter(function (c) { return c['Группа клиента']; }); W.quotesCache = r[2];
            M.settings = M.settings || {};
            if (!id) return;
            return W.loadQuote(id, M).then(d => {
                st.id = d.id; st.code = d.code; st.client = d.client; st.disc = d.disc; st.status = d.status; st.version = d.version;
                st.items = d.items.map(x => ({ product: x.product, sel: x.sel, qty: x.qty })); st.oldRows = d.items;
            });
        }).then(draw);
    });
})();
