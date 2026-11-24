/* Взыскание: претензия с расчётом неустойки по договору / процентов по ст. 395 ГК, срок 30 дней (ч. 5 ст. 4 АПК), реестр претензий и дела. */
(function () {
    'use strict';
    var W = window.Dbt, C = W.core, M = W.M;
    var state = { tab: 'calc', client: '', send: '', way: '', text: null };
    var SELLER = 'ООО «Демо-Поставка»';
    var CLAIM_ST = { 'Претензия: черновик': 'warn', 'Претензия: отправлена': 'info', 'Претензия: вручена': 'info' };

    function calcFor(r, send, way) {
        var k = M.contractByClient[r.name] || { basis: 'none', rate: 0, cap: 0, claimDays: 30 };
        var pays = M.pays.filter(function (p) { return p.client === r.name; }).map(function (p) { return { doc: p.doc, date: p.date, amount: p.amount }; });
        var items = C.openDocs(M.docs.filter(function (d) { return d.client === r.name; }), pays, send).filter(function (i) { return i.days > 0; });
        var rows = items.map(function (i) {
            var mine = pays.filter(function (p) { return p.doc === i.id; });
            var doc = M.docs.filter(function (d) { return d.id === i.id; })[0];
            var a = k.rate > 0 ? C.penaltyContract(doc.amount, doc.due, mine, send, k.rate, M.S.capOff ? 0 : k.cap) : { total: 0, rows: [] };
            var b = C.interest395(doc.amount, doc.due, mine, send, M.rates);
            return { item: i, contract: a, k395: b };
        });
        var sum = function (f) { return rows.reduce(function (s, x) { return C.round2(s + f(x)); }, 0); };
        var tot = { principal: sum(function (x) { return x.item.balance; }), contract: sum(function (x) { return x.contract.total; }), k395: sum(function (x) { return x.k395.total; }) };
        var use = way || C.effectiveBasis(k, M.S.claimBasis);
        var pen = use === 'contract' ? tot.contract : use === '395' ? tot.k395 : 0;
        return { k: k, rows: rows, tot: tot, use: use, pen: pen, items: items };
    }
    function textOf(r, cs, send) {
        var penal = cs.use === 'contract' ? { basis: 'contract', total: cs.pen, capped: cs.rows.some(function (x) { return x.contract.capped; }) } : cs.use === '395' ? { basis: '395', total: cs.pen } : { basis: 'none', total: 0 };
        return C.buildClaim({ seller: SELLER, buyer: r.name, contractNo: cs.k.no || '', contractDate: cs.k.date, docs: cs.items, principal: cs.tot.principal, penalty: penal, penaltyRate: String(cs.k.rate || ''), sendDate: send, asOf: send, term: cs.k.claimDays }).join('\n');
    }
    function nextNo() { var m = 40; M.claims.forEach(function (c) { var n = parseInt(String(c.no).split('/')[1], 10); if (n > m) m = n; }); return 'ПР-2026/' + (m + 1); }

    function calcView(host) {
        var list = M.rows.filter(function (r) { return r.overdue > 0; }).sort(function (a, b) { return b.overdue - a.overdue; });
        if (!state.client && list.length) state.client = list[0].name;
        var r = M.byName[state.client];
        var wrap = W.el('div', {});
        var sel = W.select(list.map(function (x) { return [x.name, x.name + ' — ' + W.money(x.overdue) + ' ₽, ' + x.maxDays + ' дн.']; }), state.client);
        sel.onchange = function () { state.client = sel.value; state.text = null; state.way = ''; render(host); };
        var send = W.el('input', { type: 'date', value: state.send || W.TODAY }); send.onchange = function () { state.send = send.value || W.TODAY; state.text = null; render(host); };
        var bar = W.el('div', { 'class': 'dbt-bar' }, [W.field('Должник', sel), W.field('Дата направления претензии', send)]);
        wrap.appendChild(bar);
        if (!r) { wrap.appendChild(W.el('p', { text: 'Нет должников с просрочкой.' })); return wrap; }
        var sd = state.send || W.TODAY, cs = calcFor(r, sd, state.way), k = cs.k;
        var wayName = { contract: 'Неустойка по договору', '395': 'Проценты по ст. 395 ГК', none: 'Без пеней' };
        var way = W.select([['contract', wayName.contract], ['395', wayName['395']], ['none', wayName.none]], cs.use);
        way.onchange = function () { state.way = way.value; state.text = null; render(host); };
        wrap.appendChild(W.el('p', { 'class': 'dbt-mini', text: 'Договор ' + (k.no || '') + ': способ расчёта по договору — ' + (k.basisName || 'без пеней') + (k.rate ? ', ' + String(k.rate).replace('.', ',') + '% в день' + (k.cap ? ', потолок ' + k.cap + '%' : '') : '') + '; претензионный срок ' + k.claimDays + ' дн.; подсудность: ' + (k.court || '—') + '.' }));
        wrap.appendChild(W.el('div', { 'class': 'dbt-calc' }, [
            W.el('div', { 'class': 'dbt-pick' + (cs.use === 'contract' ? ' dbt-pick-on' : '') }, [W.el('div', { 'class': 'dbt-mini', text: 'Неустойка по договору' }), W.el('div', { 'class': 'dbt-big', text: W.money2(cs.tot.contract) + ' ₽' }), W.el('div', { 'class': 'dbt-mini', text: k.rate ? String(k.rate).replace('.', ',') + '% в день от неоплаченной суммы' : 'в договоре не предусмотрена' })]),
            W.el('div', { 'class': 'dbt-pick' + (cs.use === '395' ? ' dbt-pick-on' : '') }, [W.el('div', { 'class': 'dbt-mini', text: 'Проценты по ст. 395 ГК' }), W.el('div', { 'class': 'dbt-big', text: W.money2(cs.tot.k395) + ' ₽' }), W.el('div', { 'class': 'dbt-mini', text: 'по ключевой ставке Банка России за каждый период её действия' })]),
            W.el('div', { 'class': 'dbt-pick' }, [W.el('div', { 'class': 'dbt-mini', text: 'К уплате по претензии' }), W.el('div', { 'class': 'dbt-big', text: W.money2(cs.tot.principal + cs.pen) + ' ₽' }), W.el('div', { 'class': 'dbt-mini', text: 'долг ' + W.money2(cs.tot.principal) + ' + пени ' + W.money2(cs.pen) }), W.field('Применить', way)])
        ]));
        wrap.appendChild(W.el('p', { 'class': 'dbt-mini', text: 'Ст. 395 п. 4: при неустойке по договору проценты сверх неё не взыскиваются, если иное не предусмотрено. Поэтому применяется один способ.' }));
        wrap.appendChild(W.el('h2', { text: 'Расчёт по отгрузкам на ' + C.toDmy(sd) }));
        wrap.appendChild(W.table([
            { t: 'Отгрузка', html: function (x) { return W.esc(x.item.number); } }, { t: 'Срок оплаты', html: function (x) { return C.toDmy(x.item.due); } },
            { t: 'Долг, ₽', num: true, html: function (x) { return W.money2(x.item.balance); } }, { t: 'Дней', num: true, html: function (x) { return x.item.days; } },
            { t: 'Неустойка по договору', num: true, html: function (x) { return W.money2(x.contract.total) + (x.contract.capped ? ' <span class="dbt-mini">потолок</span>' : ''); } },
            { t: 'Ст. 395 ГК', num: true, html: function (x) { return W.money2(x.k395.total); } }], cs.rows, { empty: 'Просрочки на эту дату нет' }));
        var per = [];
        cs.rows.forEach(function (x) { x.k395.rows.forEach(function (p) { per.push({ doc: x.item.number, from: p.from, to: p.to, days: p.days, principal: p.principal, rate: p.rate, yd: p.yearDays, sum: p.sum }); }); });
        wrap.appendChild(W.el('h2', { text: 'Проценты по ст. 395 ГК: периоды по ключевой ставке' }));
        wrap.appendChild(W.table([
            { t: 'Отгрузка', k: 'doc' }, { t: 'Период', html: function (p) { return C.toDmy(p.from) + ' – ' + C.toDmy(p.to); } }, { t: 'Дней', num: true, html: function (p) { return p.days; } },
            { t: 'База, ₽', num: true, html: function (p) { return W.money2(p.principal); } }, { t: 'Ставка, %', num: true, html: function (p) { return String(p.rate).replace('.', ','); } },
            { t: 'Дней в году', num: true, html: function (p) { return p.yd; } }, { t: 'Проценты, ₽', num: true, html: function (p) { return W.money2(p.sum); } }], per));
        wrap.appendChild(W.el('p', { 'class': 'dbt-mini', text: 'Формула: база × ставка × дней / дней в году. Ключевая ставка берётся из справочника с датами (' + M.rates.length + ' записей); значения сверены с историей ключевой ставки на сайте Банка России (cbr.ru).' }));
        // срок
        var t = C.claimTerm(sd, k.claimDays, W.TODAY);
        wrap.appendChild(W.el('div', { 'class': 'dbt-term' }, [W.el('b', { text: 'Срок до обращения в суд: ' }), W.el('span', { text: 'претензия направлена ' + C.toDmy(sd) + ' — ' + t.term + ' календарных дней истекают ' + C.toDmy(t.last) + '; иск в арбитражный суд можно подать с ' + C.toDmy(t.earliestSuit) + ' (ч. 5 ст. 4 АПК РФ, если договором не установлен иной срок).' })]));
        // текст
        if (state.text === null) state.text = textOf(r, cs, sd);
        var ta = W.el('textarea', { rows: 14, 'aria-label': 'Текст претензии' }); ta.value = state.text; ta.oninput = function () { state.text = ta.value; };
        wrap.appendChild(W.el('h2', { text: 'Текст претензии' }));
        wrap.appendChild(ta);
        var acts = [];
        if (W.canWrite('Претензия')) {
            var mk = function (status, sent) {
                return function () {
                    var f = { 'Претензия': nextNo(), 'Клиент': r.name, 'Договор': k.no, 'Менеджер': r.mgr, 'Дата претензии': sd, 'Основной долг': cs.tot.principal, 'Пени': cs.pen, 'Способ расчёта': wayName[cs.use], 'Статус претензии': status, 'Текст претензии': ta.value.replace(/\n/g, ' ') };
                    if (sent) f['Дата отправки'] = sd;
                    M.create('Претензия', f).then(function () {
                        if (sent && W.canWrite('Контакт')) return M.create('Контакт', { 'Контакт': W.TODAY, 'Клиент': r.name, 'Менеджер': r.mgr, 'Канал контакта': 'Письмо заказное', 'Автор': W.ctx.user, 'Тема': 'Претензия ' + f['Претензия'], 'Итог': 'Отправлена, срок ответа ' + k.claimDays + ' дн.' });
                    }).then(function () { W.toast(sent ? 'Претензия отправлена, срок ' + C.toDmy(t.last) : 'Черновик сохранён'); return M.reload(); }).then(function () { state.tab = 'claims'; render(host); }).catch(function (e) { W.toast(e.message, true); });
                };
            };
            acts.push(W.btn('Сохранить черновик', mk('Претензия: черновик', false)));
            acts.push(W.btn('Отправить и начать отсчёт ' + k.claimDays + ' дней', mk('Претензия: отправлена', true), 'dbt-primary'));
        }
        acts.push(W.btn('Копировать текст', function () { ta.select(); try { document.execCommand('copy'); W.toast('Текст скопирован'); } catch (e) { W.toast('Не удалось скопировать', true); } }));
        acts.push(W.btn('Печать', function () { var w = window.open('', '_blank'); if (w) { w.document.write('<pre style="font:14px/1.5 sans-serif;white-space:pre-wrap">' + W.esc(ta.value) + '</pre>'); w.document.close(); w.print(); } }));
        wrap.appendChild(W.el('div', { 'class': 'dbt-bar' }, acts));
        return wrap;
    }
    function claimsView(host) {
        var rows = M.claims.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).map(function (c) {
            var k = M.contractByClient[c.client] || {}, t = c.sent ? C.claimTerm(c.sent, k.claimDays, W.TODAY) : null;
            var hasCase = M.cases.some(function (x) { return x.claim === c.no; });
            return { c: c, t: t, hasCase: hasCase };
        });
        return W.table([
            { t: 'Претензия', html: function (x) { return '<b>' + W.esc(x.c.no) + '</b>'; } }, { t: 'Клиент', html: function (x) { return W.esc(x.c.client); } }, { t: 'Направлена', html: function (x) { return x.c.sent ? C.toDmy(x.c.sent) : '—'; } },
            { t: 'Долг, ₽', num: true, html: function (x) { return W.money2(x.c.principal); } }, { t: 'Пени, ₽', num: true, html: function (x) { return W.money2(x.c.pen); } }, { t: 'Способ', html: function (x) { return W.esc(x.c.way); } },
            { t: 'Статус', html: function (x) { return W.badge(W.short(x.c.status), CLAIM_ST[x.c.status] || 'info'); } },
            { t: 'Срок 30 дней', html: function (x) { if (!x.t) return 'не отправлена'; return x.hasCase ? 'в суде' : x.t.canSue ? W.badge('иск можно подавать', 'crit') : 'до ' + C.toDmy(x.t.last) + ' (' + x.t.daysLeft + ' дн.)'; } }], rows,
            { empty: 'Претензий пока нет', onrow: function (x) { state.client = x.c.client; state.tab = 'calc'; state.text = null; state.way = ''; state.send = ''; render(host); } });
    }
    function casesView(host) {
        var can = W.canWrite('Дело');
        return W.el('div', {}, [W.table([
            { t: 'Дело', html: function (c) { return '<b>' + W.esc(c.no) + '</b>'; } }, { t: 'Клиент', k: 'client' }, { t: 'Суд', k: 'court' }, { t: 'Статус', html: function (c) { return W.badge(W.short(c.status), /исполнительный|ФССП|решение/i.test(c.status) ? 'ok' : 'warn'); } },
            { t: 'Сумма иска, ₽', num: true, html: function (c) { return W.money2(c.sum); } }, { t: 'Подано', html: function (c) { return c.filed ? C.toDmy(c.filed) : '—'; } }, { t: 'Заседание', html: function (c) { return c.hearing ? C.toDmy(c.hearing) : '—'; } },
            { t: 'Юрист', k: 'lawyer' }, { t: 'Комментарий', k: 'comment' }], M.cases, { empty: 'Дел нет', onrow: can ? function (c) { caseDialog(c, host); } : undefined }), can ? W.el('p', { 'class': 'dbt-mini', text: 'Клик по строке — сменить статус дела.' }) : null]);
    }
    function caseDialog(c, host) {
        var st = W.select(['Дело: подготовка иска', 'Дело: иск подан', 'Дело: решение', 'Дело: исполнительный лист', 'Дело: ФССП', 'Дело: закрыто'], c.status);
        W.modal('Дело ' + c.no, W.el('div', {}, [W.field('Статус', st)]), [{ text: 'Сохранить', cls: 'dbt-primary', fn: function () {
            M.set(c.id, { 'Статус дела': st.value }).then(function () { W.toast('Статус дела изменён'); return M.reload(); }).then(function () { render(host); }).catch(function (e) { W.toast(e.message, true); }); } }, { text: 'Отмена' }]);
    }
    function render(host) {
        host.innerHTML = '';
        host.appendChild(W.el('h1', { text: 'Претензии и пени' }));
        host.appendChild(W.el('p', { 'class': 'dbt-sub', text: 'Расчёт неустойки по договору или процентов по ст. 395 ГК, претензия по шаблону, контроль 30-дневного срока до иска.' }));
        host.appendChild(W.tabs([['calc', 'Расчёт и претензия'], ['claims', 'Реестр претензий'], ['cases', 'Дела в суде']], state.tab, function (t) { state.tab = t; render(host); }));
        host.appendChild(state.tab === 'calc' ? calcView(host) : state.tab === 'claims' ? claimsView(host) : casesView(host));
    }
    W.mount(function (host) {
        return W.loadModel().then(function () {
            var h = /client=([^&]+)/.exec(location.hash); if (h) state.client = decodeURIComponent(h[1]);
            if (W.ctx.role === 'Юрист') state.tab = 'claims';
            render(host);
        });
    });
})();
