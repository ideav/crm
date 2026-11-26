/* Сводка для руководителя и специалиста по ОТ: допущенные и просрочки по подразделениям, наряды, выгрузка «к проверке ГИТ». */
(function () {
    'use strict';
    var A = window.Suot, C = A.core, el = A.el;
    A.mount(function (host, M) {
        var T = M.today, sum = C.summary(M, T), ev = C.events(M, T);
        host.appendChild(el('div', {}, A.head('Сводка просрочек', 'Состояние охраны труда на ' + C.toDmy(T) + ': кто допущен к работе, где просрочены СИЗ, инструктажи, обучение и медосмотры. Клик по подразделению — список сроков.')));
        var all = sum.reduce(function (s, x) { return s + x.workers; }, 0), ok = sum.reduce(function (s, x) { return s + x.admitted; }, 0);
        var over = ev.filter(function (e) { return e.state !== 'soon'; }).length, soon = ev.length - over;
        var open = M.permits.filter(function (p) { return p.status !== 'Закрыт' && p.status !== 'Отклонён'; });
        var blocked = open.filter(function (p) { return !C.permitCheck(p, M, T).ok; });
        host.appendChild(el('div', { 'class': 'suot-kpis' }, [
            A.kpi('допущены к работе', (all ? Math.round(ok * 100 / all) : 0) + '%', ok + ' из ' + all + ' работников', ok < all ? 'warn' : 'good'),
            A.kpi('просрочено и нет записи', String(over), 'по всем потокам', over ? 'bad' : 'good'),
            A.kpi('истекает за ' + M.rules.warnDays + ' дн.', String(soon), 'запланировать', soon ? 'warn' : ''),
            A.kpi('открытых нарядов', String(open.length), blocked.length ? blocked.length + ' с недопущенным исполнителем' : 'все исполнители допущены', blocked.length ? 'bad' : 'good')]));
        function cell(x) { return '<span class="suot-cell ' + (x.over ? 'suot-cell-bad' : x.soon ? 'suot-cell-warn' : 'suot-cell-ok') + '">' + x.over + ' / ' + x.soon + '</span>'; }
        var cols = [{ t: 'Подразделение', html: function (r) { return '<b>' + A.esc(r.dept) + '</b>'; } }, { t: 'Работников', k: 'workers', num: 1 },
            { t: 'Допущены', html: function (r) { return '<span class="suot-cell ' + (r.pct < 70 ? 'suot-cell-bad' : r.pct < 100 ? 'suot-cell-warn' : 'suot-cell-ok') + '">' + r.pct + '%</span>'; }, num: 1 }];
        C.STREAMS.forEach(function (s) { cols.push({ t: s + ' (проср. / истек.)', html: function (r) { return cell(r[s]); }, num: 1 }); });
        sum.sort(function (a, b) { return a.pct - b.pct; });
        host.appendChild(A.table(cols, sum, { onrow: function (r) { location.href = A.nav('calendar', 'dept=' + encodeURIComponent(r.dept)); } }));
        /* что мешает больше всего */
        var top = {}; ev.filter(function (e) { return e.state !== 'soon'; }).forEach(function (e) { var k = e.stream + ': ' + e.item; top[k] = (top[k] || 0) + 1; });
        var topRows = Object.keys(top).map(function (k) { return { what: k, n: top[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 6);
        host.appendChild(el('div', { 'class': 'suot-two', style: 'margin-top:16px' }, [
            el('div', {}, [el('h2', { text: 'Чаще всего просрочено' }), A.table([{ t: 'Что', k: 'what' }, { t: 'Случаев', k: 'n', num: 1 }], topRows, { empty: 'Просрочек нет' })]),
            el('div', {}, [el('h2', { text: 'Наряды-допуски в работе' }), A.table([{ t: 'Наряд', html: function (p) { return '<a href="' + A.nav('permits', 'n=' + p.num) + '">' + A.esc(p.num) + '</a>'; } }, { t: 'Работы', k: 'work' }, { t: 'Статус', k: 'status' }, { t: 'Исполнители', html: function (p) { var c = C.permitCheck(p, M, T); return c.ok ? A.badge('допущены', 'ok') : A.badge('не допущены: ' + c.rows.filter(function (r) { return !r.ok; }).length, 'crit'); } }], open, { empty: 'Открытых нарядов нет' })])]));
        host.appendChild(el('div', { 'class': 'suot-bar' }, [A.btn('Выгрузка к проверке ГИТ (CSV)', function () {
            var rows = [['Работник', 'Таб. №', 'Подразделение', 'Должность', 'Допущен', 'Причины недопуска']];
            M.workers.forEach(function (w) { var a = C.admission(w, M, T); rows.push([w.name, w.tab, w.dept, w.pos, a.ok ? 'да' : 'нет', a.reasons.join('; ')]); });
            A.download('gotovnost-git-' + T + '.csv', C.toCsv(rows));
        }, 'suot-primary')]));
    });
})();
