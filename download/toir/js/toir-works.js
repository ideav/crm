/* ТОиР: наряды, график ППР и выгрузка нарядов в 1С. */
(function () {
    'use strict';
    var T = window.Toir, C = T.core, el = T.el;
    var tab = (location.hash.replace('#', '') || 'orders'), F = { st: 'open' };
    T.mount(draw);
    function draw(h, M) {
        h = h || document.getElementById('toir-app'); M = M || T.cur; h.innerHTML = '';
        h.appendChild(el('div', {}, T.head('Наряды и ППР', 'Наряд из дефекта или графика ППР, запчасти резервируются по норме вида работ. Закрытый наряд закрывает дефект и сдвигает ППР; выполненные уходят в 1С файлом.')));
        var unexp = C.export1C(M.orders, M.eqCode, {}).rows.length;
        h.appendChild(T.tabs([['orders', 'Наряды'], ['ppr', 'График ППР'], ['export', 'Выгрузка в 1С' + (unexp ? ' (' + unexp + ')' : '')]], tab, function (v) { tab = v; location.hash = v; draw(); }));
        if (tab === 'ppr') ppr(h, M); else if (tab === 'export') exp(h, M); else orders(h, M);
    }
    function partsCell(M, o) {
        var ps = M.orderParts[o.name] || [];
        return ps.length ? ps.map(function (p) { return T.badge(p.part + ' × ' + T.fmt(p.qty, p.qty % 1 ? 1 : 0), p.status === 'Нет на складе' ? 'crit' : p.status === 'Списана' ? 'mute' : 'ok'); }).join('<br>') : '<span class="toir-muted">—</span>';
    }
    function orders(h, M) {
        var bar = el('div', { 'class': 'toir-bar' }); var s = T.select([['open', 'Открытые'], ['done', 'Выполненные'], ['all', 'Все']], F.st);
        s.addEventListener('change', function () { F.st = s.value; draw(); }); bar.appendChild(T.field('Показать', s)); h.appendChild(bar);
        var list = M.orders.filter(function (o) { return F.st === 'all' || (F.st === 'done' ? o.status === 'Выполнен' : o.status !== 'Выполнен'); })
            .sort(function (a, b) { return F.st === 'done' ? (b.done || '').localeCompare(a.done || '') : (a.plan || '').localeCompare(b.plan || ''); });
        h.appendChild(T.table([
            { k: 'name', t: '№' }, { t: 'Узел', node: function (o) { return T.eqLink(M, o.eq); } },
            { t: 'Работа', html: function (o) { return T.esc(o.work) + '<br><small class="toir-muted">' + (o.defect ? 'дефект ' + T.esc(o.defect) : o.ppr ? 'ППР ' + T.esc(o.ppr) : 'по плану') + (o.stop ? ' · ' + T.esc(o.stop) : '') + '</small>'; } },
            { t: 'Исполнитель', html: function (o) { return T.esc(o.team || o.exec); } },
            { t: 'Дата', html: function (o) { return o.done ? 'выполнен ' + C.ru(o.done) : C.ru(o.plan); } },
            { t: 'Статус', html: function (o) { return T.badge(o.status, T.statusKind(o.status)); } },
            { t: 'Запчасти', html: function (o) { return partsCell(M, o); } },
            { t: '', node: function (o) { return T.canWrite('Наряд') && o.status !== 'Выполнен' ? T.btn('Закрыть', function () { closeDialog(M, o); }, 'toir-small') : null; } }
        ], list, { cls: 'toir-stack' }));
    }
    function closeDialog(M, o) {
        var hrs = T.input('number', (M.works[o.work] || {}).hours || 1, { step: '0.5', min: '0' }), dt = T.input('date', T.TODAY);
        var body = el('div', {}, [el('p', { 'class': 'toir-sub', text: o.name + ' · ' + o.eq + ' · ' + o.work }), T.field('Дата выполнения', dt), T.field('Часов факт', hrs, 'норма ' + T.h((M.works[o.work] || {}).hours || 0)), el('p', { 'class': 'toir-muted', html: 'Запчасти спишутся со склада: ' + partsCell(M, o) })]);
        T.modal('Закрыть наряд', body, [{ text: 'Отмена' }, { text: 'Выполнен', cls: 'toir-primary', fn: function () { return closeOrder(M, o, dt.value, C.num(hrs.value)).then(function () { T.toast('Наряд ' + o.name + ' закрыт'); draw(); }); } }]);
    }
    function closeOrder(M, o, date, hours) {
        var chain = T.update(o.id, { 'Статус наряда': 'Выполнен', 'Дата выполнения': date, 'Часов факт': hours }).then(function () { o.status = 'Выполнен'; o.done = date; o.hours = hours; });
        (M.orderParts[o.name] || []).forEach(function (p) {
            if (p.status !== 'Зарезервирована') return;
            chain = chain.then(function () {
                var sp = M.parts[p.part]; p.status = 'Списана';
                var w = [T.update(p.id, { 'Статус резерва': 'Списана' })];
                if (sp) { sp.stock = Math.max(0, sp.stock - p.qty); sp.reserved = Math.max(0, sp.reserved - p.qty); w.push(T.update(sp.id, { 'Остаток на складе': sp.stock, 'В резерве': sp.reserved })); }
                return Promise.all(w);
            });
        });
        var d = M.defBy[o.defect];
        if (d) chain = chain.then(function () { d.status = 'Устранён'; d.done = date; d.answer = 'Устранено по наряду ' + o.name + ' ' + C.ru(date); return T.update(d.id, { 'Статус дефекта': 'Устранён', 'Устранён': date, 'Ответ автору': d.answer }); });
        var p = M.pprBy[o.ppr];
        if (p) chain = chain.then(function () { p.last = date; p.plan = C.addDays(date, p.period); p.status = 'Запланирован'; return T.update(p.id, { 'Последнее выполнение': date, 'Плановая дата': p.plan, 'Статус ППР': p.status }); });
        return chain;
    }
    function ppr(h, M) {
        var label = { overdue: ['просрочен', 'crit'], soon: ['в ближайшие 7 дней', 'warn'], plan: ['по плану', 'info'], stop: ['в останове', 'violet'], none: ['нет даты', 'mute'] };
        var list = M.ppr.map(function (p) { var s = p.status === 'В останове' ? 'stop' : C.pprState(p, T.TODAY); return Object.assign({ st: s }, p); }).sort(function (a, b) { return a.plan.localeCompare(b.plan); });
        var cnt = function (s) { return list.filter(function (p) { return p.st === s; }).length; };
        h.appendChild(el('div', { 'class': 'toir-kpis' }, [T.kpi('просрочено', String(cnt('overdue')), 'плановая дата прошла, наряда нет', cnt('overdue') ? 'bad' : 'good'), T.kpi('в ближайшие 7 дней', String(cnt('soon'))), T.kpi('перенесено в останов', String(cnt('stop')))]));
        h.appendChild(T.table([
            { k: 'name', t: '№' }, { t: 'Узел', node: function (p) { return T.eqLink(M, p.eq); } }, { k: 'work', t: 'Работа' },
            { t: 'Период', num: true, html: function (p) { return p.period + ' дн.'; } }, { t: 'Последнее', html: function (p) { return C.ru(p.last); } },
            { t: 'Плановая дата', html: function (p) { return '<b>' + C.ru(p.plan) + '</b>'; } }, { t: 'Состояние', html: function (p) { return T.badge(label[p.st][0], label[p.st][1]); } },
            { t: 'Наряд', node: function (p) { var o = M.orders.filter(function (x) { return x.ppr === p.name && x.status !== 'Выполнен'; })[0]; if (o) return el('span', { text: o.name }); return T.canWrite('Наряд') ? T.btn('Наряд', function () { T.orderDialog(M, { eq: p.eq, ppr: p.name, work: p.work, plan: p.plan < T.TODAY ? C.addDays(T.TODAY, 1) : p.plan }, function () { draw(); }); }, 'toir-small') : null; } }
        ], list, { cls: 'toir-stack', rowCls: function (p) { return p.st === 'overdue' ? 'toir-row-bad' : p.st === 'soon' ? 'toir-row-warn' : ''; } }));
        h.appendChild(el('p', { 'class': 'toir-muted', text: 'Периодичность — по календарю. Планирование по наработке (счётчики моточасов) подключается опцией.' }));
    }
    function exp(h, M) {
        var by = M.orderParts, ex = C.export1C(M.orders, M.eqCode, by);
        h.appendChild(el('p', { 'class': 'toir-sub', text: 'Выполненные наряды, которых ещё нет в 1С: файл CSV для обработки загрузки в 1С:ТОИР / УПП / ERP (номер, дата, код оборудования 1С, работа, часы, запчасти). Двусторонний обмен по расписанию — опция.' }));
        h.appendChild(T.table([{ k: 'name', t: '№' }, { t: 'Выполнен', html: function (o) { return C.ru(o.done); } }, { t: 'Код 1С', html: function (o) { return T.esc(M.eqCode[o.eq] || ''); } }, { k: 'eq', t: 'Узел' }, { k: 'work', t: 'Работа' }, { t: 'Часов', num: true, html: function (o) { return T.fmt(o.hours, 1); } }], ex.rows, { cls: 'toir-stack', empty: 'Все выполненные наряды уже в 1С' }));
        if (ex.rows.length && T.canWrite('Наряд')) h.appendChild(el('p', {}, [T.btn('Выгрузить в 1С: ' + ex.rows.length + ' нарядов', function (ev) {
            ev.target.disabled = true;
            T.download('naryady-1c-' + T.TODAY + '.csv', ex.csv);
            Promise.all(ex.rows.map(function (o) { return T.update(o.id, { 'Выгружен в 1С': T.TODAY }).then(function () { o.exported = T.TODAY; }); })).then(function () { T.toast('Файл сохранён, наряды отмечены выгруженными ' + C.ru(T.TODAY)); draw(); }).catch(function (e) { T.toast(e.message, true); });
        }, 'toir-primary')]));
    }
})();
