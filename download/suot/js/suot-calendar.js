/* Календарь сроков: что просрочено и что истекает в горизонте по СИЗ, инструктажам, обучению и медосмотрам; отметка проведения и список на медосмотр. */
(function () {
    'use strict';
    var A = window.Suot, C = A.core, el = A.el;
    var f = { dept: '', stream: '', state: '' };
    A.mount(function (host, M) {
        var T = M.today, h = A.hash();
        if (h.dept !== undefined && h.dept !== f.dept) f.dept = h.dept;
        host.appendChild(el('div', {}, A.head('Календарь сроков', 'Один список вместо Excel «у кого что истекает»: просрочено, нет записи и истекает в ближайшие ' + M.rules.warnDays + ' дн. Горизонт и периодичности берутся из правил компании.')));
        if (!M.can['Запись обучения'] || !M.can['Медосмотр']) host.appendChild(el('div', { 'class': 'suot-warnbox suot-w', text: 'Роль не видит журналы обучения или медосмотры: в календаре только доступные ей потоки.' }));
        var ev = C.events(M, T).filter(function (e) { return (e.stream !== 'Медосмотр' || M.can['Медосмотр']) && (e.stream === 'СИЗ' || e.stream === 'Медосмотр' || M.can['Запись обучения']); });
        var depts = M.depts.filter(function (d) { return M.workers.some(function (w) { return w.dept === d; }); });
        var sd = A.select([['', 'Все подразделения']].concat(depts), f.dept), ss = A.select([['', 'Все потоки']].concat(C.STREAMS), f.stream), st = A.select([['', 'Все'], ['over', 'Просрочено'], ['none', 'Нет записи'], ['soon', 'Истекает']], f.state);
        [[sd, 'dept'], [ss, 'stream'], [st, 'state']].forEach(function (x) { x[0].addEventListener('change', function () { f[x[1]] = x[0].value; if (x[1] === 'dept') location.hash = 'dept=' + encodeURIComponent(f.dept); A.render(); }); });
        var rows = ev.filter(function (e) { return (!f.dept || e.dept === f.dept) && (!f.stream || e.stream === f.stream) && (!f.state || e.state === f.state); });
        var cnt = function (s) { return rows.filter(function (e) { return e.state === s; }).length; };
        host.appendChild(el('div', { 'class': 'suot-kpis' }, [A.kpi('просрочено', String(cnt('over')), 'срок прошёл', cnt('over') ? 'bad' : 'good'), A.kpi('нет записи', String(cnt('none')), 'не выдано или не проводилось', cnt('none') ? 'bad' : ''), A.kpi('истекает', String(cnt('soon')), 'в ближайшие ' + M.rules.warnDays + ' дн.', cnt('soon') ? 'warn' : '')]));
        var med = rows.filter(function (e) { return e.stream === 'Медосмотр'; });
        host.appendChild(el('div', { 'class': 'suot-bar' }, [A.field('Подразделение', sd), A.field('Поток', ss), A.field('Состояние', st), el('div', { 'class': 'suot-grow' }),
            M.can['Медосмотр'] && med.length ? A.btn('Список на медосмотр (' + med.length + ')', function () { medList(M, med); }) : null,
            A.btn('Выгрузить CSV', function () { A.download('sroki-' + T + '.csv', C.toCsv([['Работник', 'Таб. №', 'Подразделение', 'Должность', 'Поток', 'Что', 'Срок', 'Состояние']].concat(rows.map(function (e) { return [e.worker, e.tab, e.dept, e.pos, e.stream, e.item, C.toDmy(e.due), C.STATE_TEXT[e.state]]; })))); })]));
        var tbl = A.table([
            { t: 'Работник', html: function (e) { return '<a href="' + A.nav('card', 'w=' + encodeURIComponent(e.worker)) + '">' + A.esc(e.worker) + '</a><br><small class="suot-muted">' + A.esc(e.pos) + '</small>'; } },
            { t: 'Подразделение', k: 'dept' }, { t: 'Поток', k: 'stream' }, { t: 'Что', k: 'item' },
            { t: 'Срок', html: function (e) { return e.due ? C.toDmy(e.due) + '<br><small class="suot-muted">' + C.dueText(e.due, T) + '</small>' : '—'; } },
            { t: 'Состояние', html: function (e) { return A.stateBadge(e.state, e.due); } },
            { t: '', html: function () { return ''; }, cls: function () { return 'suot-act'; } }
        ], rows, { rowCls: function (e) { return e.state === 'soon' ? 'suot-row-warn' : 'suot-row-bad'; }, empty: 'Просрочек и истекающих сроков нет' });
        host.appendChild(tbl);
        tbl.querySelectorAll('.suot-act').forEach(function (td, i) {
            var e = rows[i];
            if ((e.stream === 'Инструктаж' || e.stream === 'Обучение') && A.canWrite('Запись обучения')) td.appendChild(A.btn('Отметить', function () { A.markTraining(M, M.workerBy[e.worker], e.item); }, 'suot-small'));
            if (e.stream === 'СИЗ' && A.canWrite('Выдача СИЗ')) td.appendChild(A.btn('Выдать', function () { location.href = A.nav('issue', 'w=' + encodeURIComponent(e.worker)); }, 'suot-small'));
        });
    });
    /* Поимённый список для медорганизации: ФИО, дата рождения, должность, факторы. */
    function medList(M, med) {
        var rows = med.map(function (e) { var w = M.workerBy[e.worker], m = C.medCard(w, M, M.today); return [w.name, C.toDmy(w.birth), w.dept, w.pos, m.factors.join(', '), C.toDmy(m.due)]; });
        A.download('spisok-medosmotr-' + M.today + '.csv', C.toCsv([['ФИО', 'Дата рождения', 'Подразделение', 'Должность', 'Вредные факторы (приказ № 29н)', 'Срок']].concat(rows)));
        A.toast('Список на медосмотр выгружен: ' + rows.length + ' чел.');
    }
})();
