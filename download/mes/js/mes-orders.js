/* MES: заказы из 1С, маршрут операций по участкам, «где заказ», возврат выпуска в 1С. */
(function () {
    'use strict';
    var P = window.Mes, C = P.core;
    P.mount(function (host, M) {
        P.head('Заказы и маршруты', 'Заказы на производство приходят из 1С:УНФ и раскладываются на маршрут операций по участкам. Здесь видно, на какой операции каждый заказ, и что выпущено, но ещё не вернулось в 1С.').forEach(function (n) { host.appendChild(n); });
        var canTask = P.canWrite('Сменное задание') && P.canWrite('Заказ на производство'), canExp = P.canWrite('Выгрузка в 1С') && P.canWrite('Заказ на производство');
        function eff(o) {
            var ts = P.orderTasks(M, o.no);
            if (!ts.length) return o.state || 'Новый из 1С';
            if (o.state === 'Передан в 1С') return o.state;
            if (ts.every(function (t) { return t.state === C.STATE.done; })) return 'Выпущен';
            return ts.some(function (t) { var p = M.prog[t.no]; return p && p.good + p.bad > 0; }) ? 'В производстве' : 'Запущен';
        }
        var fresh = M.orders.filter(function (o) { return !P.orderTasks(M, o.no).length; });
        var unsent = M.orders.filter(function (o) { return eff(o) === 'Выпущен'; });
        fresh.forEach(function (o) {
            var route = C.routeOf(M.steps, o.product);
            var box = P.note('<b>Новый заказ из 1С: ' + P.esc(o.no) + '</b> (' + P.esc(o.so) + ', ' + P.esc(o.cust) + ') · ' + P.esc(o.product) + ' × ' + o.qty + ' · срок ' + C.toRu(o.due) + '. Маршрут: ' + route.map(function (s) { return P.esc(s.op) + ' (' + P.esc(M.opSection[s.op] || '') + ', ' + s.norm + ' мин/шт)'; }).join(' → '), 'info');
            if (canTask) box.appendChild(P.btn('Разложить на маршрут', function () { split(o); }, 'mes-primary mes-small'));
            host.appendChild(box);
        });
        if (unsent.length) {
            var b2 = P.note('<b>Выпущено, но не передано в 1С: ' + unsent.map(function (o) { return P.esc(o.no); }).join(', ') + '.</b> В УНФ эти заказы ещё «в работе» — выпуск продукции и сдельный наряд не проведены.', 'bad');
            if (canExp) b2.appendChild(P.btn('Передать выпуск в 1С', function () { sendAll(unsent); }, 'mes-primary mes-small'));
            host.appendChild(b2);
        }
        function split(o) {
            var maxQ = {}; M.tasks.forEach(function (t) { maxQ[t.section] = Math.max(maxQ[t.section] || 0, t.queue); });
            var ts = C.routeTasks(o, M.steps, M.opSection, maxQ);
            /* _m_batch new с занятым значением уникальной таблицы пишет в существующую запись — проверяем сами */
            var busy = ts.filter(function (t) { return M.taskBy[t.no]; });
            if (busy.length) return P.toast('Задания ' + busy.map(function (t) { return t.no; }).join(', ') + ' уже есть — обновите страницу', true);
            var ops = ts.map(function (t) { return { op: 'new', id: 'Сменное задание', up: 1, fields: { 'Сменное задание': t.no, 'Заказ на производство': o.no, 'Операция': t.op, 'Участок': t.section, 'Номер шага': t.step, 'План, шт': t.plan, 'Очередь': t.queue, 'Состояние задания': t.state } }; });
            ops.push({ op: 'set', id: o.id, fields: { 'Состояние заказа': 'Запущен', 'Маршрут создан': M.today } });
            P.batch(ops).then(function () { P.toast(o.no + ': ' + ts.length + ' сменных заданий на ' + Object.keys(ts.reduce(function (a, t) { a[t.section] = 1; return a; }, {})).length + ' участках'); P.redraw(); }).catch(function (e) { P.toast(e.message, true); });
        }
        function sendAll(list) {
            if (!M.exports) return P.toast('Нет доступа к журналу обмена с 1С', true);
            var n = P.nextNo(M.exports, 'ОБ-', 4), k = parseInt(n.replace(/\D/g, ''), 10), ops = [];
            list.forEach(function (o) {
                ['Выпуск продукции', 'Сдельный наряд'].forEach(function (doc) { ops.push({ op: 'new', id: 'Выгрузка в 1С', up: 1, fields: { 'Выгрузка в 1С': 'ОБ-' + String(k++).padStart(4, '0'), 'Заказ на производство': o.no, 'Документ 1С': doc, 'Дата смены': M.today, 'Результат обмена': 'Принято 1С', 'Кто выгрузил': P.ctx.user } }); });
                ops.push({ op: 'set', id: o.id, fields: { 'Состояние заказа': 'Передан в 1С' } });
            });
            P.batch(ops).then(function () { P.toast('Выпуск и наряды переданы в 1С (демо: обмен через OData подключаем у клиента)'); P.redraw(); }).catch(function (e) { P.toast(e.message, true); });
        }
        var showAll = P.hash().all === '1';
        var list = M.orders.filter(function (o) { return showAll || eff(o) !== 'Передан в 1С'; }).sort(function (a, b) { return a.due < b.due ? -1 : 1; });
        host.appendChild(P.el('div', { 'class': 'mes-bar' }, [P.el('h2', { text: 'Заказы в цехе', style: 'margin:0' }), P.el('span', { 'class': 'mes-grow' }), P.btn(showAll ? 'Скрыть переданные в 1С' : 'Показать и переданные в 1С', function () { location.hash = showAll ? '' : 'all=1'; P.redraw(); }, 'mes-small')]));
        host.appendChild(P.table([
            { t: 'Заказ', html: function (o) { return '<b>' + P.esc(o.no) + '</b><br><small>' + P.esc(o.so) + ' от ' + C.toShort(o.from) + '</small>'; } },
            { t: 'Изделие', html: function (o) { return P.esc(o.product) + ' × ' + o.qty + '<br><small>' + P.esc(o.cust) + '</small>'; } },
            { t: 'Срок', html: function (o) { return P.isHot(M, o) ? P.badge(C.toRu(o.due), 'crit') : C.toRu(o.due); } },
            { t: 'Маршрут: где заказ', node: function (o) {
                var ts = P.orderTasks(M, o.no), byStep = {}; ts.forEach(function (t) { byStep[t.step] = t; });
                var route = C.routeOf(M.steps, o.product);
                return P.el('div', { 'class': 'mes-route' }, route.map(function (s) {
                    var t = byStep[s.step], p = t ? M.prog[t.no] || { good: 0, bad: 0 } : null;
                    var cls = !t ? 'none' : t.state === C.STATE.done ? 'done' : p.good + p.bad > 0 || t.state === C.STATE.run ? 'run' : 'wait';
                    return P.el('span', { 'class': 'mes-step mes-step-' + cls, title: s.op + ' — ' + (M.opSection[s.op] || '') + (t ? ': ' + p.good + ' из ' + t.plan + (p.bad ? ', брак ' + p.bad : '') + ', ' + t.state : ': маршрут не создан'), html: P.esc(s.op) + '<small>' + (t ? p.good + '/' + t.plan : '—') + '</small>' });
                }));
            } },
            { t: 'Состояние', html: function (o) { var s = eff(o); return P.badge(s, { 'Новый из 1С': 'info', 'Запущен': 'mute', 'В производстве': 'info', 'Выпущен': 'warn', 'Передан в 1С': 'ok' }[s]); } },
            { t: 'Прогноз выхода', html: function (o) { var f = P.forecast(M, o.no); return f ? P.badge(C.toRu(f.finish), f.late ? 'crit' : 'ok') : ''; } }
        ], list));
        if (M.exports) {
            var ex = M.exports.slice().sort(function (a, b) { return a.no < b.no ? 1 : -1; }).slice(0, 8);
            host.appendChild(P.el('h2', { text: 'Журнал обмена с 1С (последние)' }));
            host.appendChild(P.table([{ t: '№', k: 'no' }, { t: 'Дата', html: function (r) { return C.toRu(r.date); } }, { t: 'Заказ', k: 'order' }, { t: 'Документ 1С', k: 'doc' }, { t: 'Результат', html: function (r) { return P.badge(r.res, r.res === 'Принято 1С' ? 'ok' : 'info'); } }], ex));
        }
    });
})();
