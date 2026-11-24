/* Взыскание: графики реструктуризации с автоконтролем платежей. */
(function () {
    'use strict';
    var W = window.Dbt, C = W.core, M = W.M;
    var ST = { paid: ['Оплачен', 'ok'], late: ['Просрочен', 'crit'], wait: ['Ожидается', 'info'] };

    function after(host, msg) { return function () { W.toast(msg); return M.reload().then(function () { render(host); }); }; }
    function fail(e) { W.toast(e.message, true); }

    function card(host, s) {
        var chk = M.scheduleCheck(s), cl = s['Клиент'], r = M.byName[cl];
        var can = W.canWrite('Платёж графика');
        var head = W.el('div', { 'class': 'dbt-card-head', html: '<h3 style="margin:0">' + W.esc(s['График реструктуризации']) + ' · ' + W.esc(cl) + '</h3>' + (chk.violated ? W.badge('график нарушен', 'crit') : W.badge('график выполняется', 'ok')) +
            '<div class="dbt-mini">Соглашение от ' + C.toDmy(C.toIso(s['Дата соглашения'])) + ' · ' + W.esc(s['Основание']) + ' · менеджер ' + W.esc(W.shortFio(s['Менеджер'])) + '</div>' });
        var kp = W.el('div', { 'class': 'dbt-kpis dbt-kpis-s' }, [
            W.el('div', { 'class': 'dbt-kpi' }, [W.el('div', { 'class': 'dbt-kpi-v', text: W.money(chk.planned) + ' ₽' }), W.el('div', { 'class': 'dbt-kpi-l', text: 'по графику' })]),
            W.el('div', { 'class': 'dbt-kpi' }, [W.el('div', { 'class': 'dbt-kpi-v', text: W.money(chk.paid) + ' ₽' }), W.el('div', { 'class': 'dbt-kpi-l', text: 'оплачено' })]),
            W.el('div', { 'class': 'dbt-kpi' + (chk.violated ? ' dbt-kpi-bad' : '') }, [W.el('div', { 'class': 'dbt-kpi-v', text: W.money(chk.violated ? chk.late : chk.remain) + ' ₽' }), W.el('div', { 'class': 'dbt-kpi-l', text: chk.violated ? 'просрочено по графику, ' + chk.maxLate + ' дн.' : 'остаток' })])]);
        var rows = chk.rows.map(function (x, i) { return { x: x, rec: s.pay.filter(function (p) { return C.toIso(p['Платёж графика']) === x.date; })[0] }; });
        var tbl = W.table([
            { t: 'Дата платежа', html: function (o) { return C.toDmy(o.x.date); } }, { t: 'По графику, ₽', num: true, html: function (o) { return W.money(o.x.amount); } }, { t: 'Оплачено, ₽', num: true, html: function (o) { return o.x.paid ? W.money(o.x.paid) : ''; } },
            { t: 'Статус', html: function (o) { return W.badge(ST[o.x.status][0], ST[o.x.status][1]); } },
            { t: '', html: function () { return ''; } }], rows, { rowCls: function (o) { return o.x.status === 'late' ? 'dbt-row-hot' : ''; } });
        [].slice.call(tbl.querySelectorAll('tbody tr')).forEach(function (tr, i) {
            var o = rows[i]; if (!can || o.x.status === 'paid' || !o.rec) return;
            tr.children[4].appendChild(W.btn('Отметить платёж', function () { payDialog(host, o); }));
        });
        var note = chk.violated ? W.el('p', { 'class': 'dbt-red', html: '<b>Нарушение графика:</b> клиент возвращается в воронку (' + W.esc(r ? r.stage.name : '') + '), стоп-отгрузка по правилам включается.' }) : (chk.next ? W.el('p', { 'class': 'dbt-mini', text: 'Ближайший платёж ' + C.toDmy(chk.next.date) + ' на ' + W.money(chk.next.amount) + ' ₽. Пока график выполняется, отгрузка под него разрешена.' }) : null);
        return W.el('div', { 'class': 'dbt-card dbt-sec' }, [head, kp, tbl, note]);
    }
    function payDialog(host, o) {
        var inp = W.el('input', { type: 'number', value: o.x.amount - o.x.paid, min: 0 });
        W.modal('Платёж по графику на ' + C.toDmy(o.x.date), W.el('div', {}, [W.field('Поступило сейчас, ₽', inp)]), [{ text: 'Записать', cls: 'dbt-primary', fn: function () {
            var v = C.num(inp.value); if (v <= 0) { W.toast('Укажите сумму', true); return false; }
            M.set(o.rec._id, { 'Оплачено': C.round2(o.x.paid + v) }).then(after(host, 'Платёж отмечен')).catch(fail); } }, { text: 'Отмена' }]);
    }
    function createDialog(host) {
        var cand = M.rows.filter(function (r) { return r.overdue > 0 && !r.sched; }).sort(function (a, b) { return b.overdue - a.overdue; });
        var sel = W.select(cand.map(function (r) { return [r.name, r.name + ' — просрочено ' + W.money(r.overdue) + ' ₽']; }), cand[0] && cand[0].name);
        var n = W.el('input', { type: 'number', value: 4, min: 2, max: 24 }), first = W.el('input', { type: 'date', value: C.addDays(W.TODAY, 14) }), step = W.el('input', { type: 'number', value: 30, min: 7 }), why = W.el('input', { type: 'text', placeholder: 'Основание: почему клиент просит график' });
        W.modal('Новый график реструктуризации', W.el('div', {}, [W.field('Клиент', sel), W.field('Платежей', n), W.field('Первый платёж', first), W.field('Шаг, дней', step), W.field('Основание', why)]), [{ text: 'Создать график', cls: 'dbt-primary', fn: function () {
            var r = M.byName[sel.value]; if (!r) return false;
            var cnt = Math.max(2, Math.round(C.num(n.value))), each = Math.floor(r.overdue / cnt / 100) * 100, no = 'РС-2026/0' + (M.schedules.length + 1);
            M.create('График реструктуризации', { 'График реструктуризации': no, 'Клиент': r.name, 'Менеджер': r.mgr, 'Дата соглашения': W.TODAY, 'Сумма реструктуризации': r.overdue, 'Статус графика': 'График: действует', 'Основание': why.value })
                .then(function (res) {
                    var up = res.id || res.obj, ps = [];
                    for (var i = 0; i < cnt; i++) ps.push(W.post('_m_new/' + W.tid('Платёж графика') + '?JSON', { up: up, fields: { 'Платёж графика': C.addDays(first.value, i * C.num(step.value)), 'Менеджер': r.mgr, 'Сумма платежа': i === cnt - 1 ? C.round2(r.overdue - each * (cnt - 1)) : each } }));
                    return Promise.all(ps);
                }).then(after(host, 'График создан: клиент под контролем платежей')).catch(fail);
        } }, { text: 'Отмена' }]);
    }
    function render(host) {
        host.innerHTML = '';
        host.appendChild(W.el('h1', { text: 'Реструктуризация' }));
        host.appendChild(W.el('p', { 'class': 'dbt-sub', text: 'График платежей с автоконтролем: пока платежи идут по графику, клиент не попадает в стоп-отгрузку и претензии; первый сорванный платёж возвращает его в воронку.' }));
        var bar = W.el('div', { 'class': 'dbt-bar' });
        if (W.canWrite('График реструктуризации')) bar.appendChild(W.btn('Новый график', function () { createDialog(host); }, 'dbt-primary'));
        host.appendChild(bar);
        var list = M.schedules.filter(function (s) { return s.pay; });
        if (!list.length) host.appendChild(W.el('p', { 'class': 'dbt-empty', text: 'Графиков нет' }));
        list.forEach(function (s) { host.appendChild(card(host, s)); });
    }
    W.mount(function (host) { return W.loadModel().then(function () { render(host); }); });
})();
