/* Взыскание: задачи менеджера «на сегодня». */
(function () {
    'use strict';
    var W = window.Dbt, C = W.core, M = W.M;
    var state = { mgr: '', done: false };

    function done(host, t) {
        M.set(t.id, { 'Статус работы': 'Задача: выполнена' }).then(function () { W.toast('Задача выполнена'); return M.reload(); }).then(function () { render(host); }).catch(function (e) { W.toast(e.message, true); });
    }
    function addDialog(host) {
        var names = M.rows.filter(function (r) { return r.overdue > 0 && (!state.mgr || r.mgr === state.mgr); }).map(function (r) { return r.name; });
        var cl = W.select(names, names[0]), tp = W.select(['Напоминание', 'Звонок', 'Претензия', 'Сверка'], 'Звонок');
        var d = W.el('input', { type: 'date', value: W.TODAY }), ds = W.el('input', { type: 'text', placeholder: 'Что сделать' });
        W.modal('Новая задача', W.el('div', {}, [W.field('Клиент', cl), W.field('Тип', tp), W.field('Срок', d), W.field('Описание', ds)]), [{ text: 'Создать', cls: 'dbt-primary', fn: function () {
            var r = M.byName[cl.value]; if (!r) return false;
            M.create('Задача по долгу', { 'Задача по долгу': d.value, 'Клиент': r.name, 'Менеджер': r.mgr, 'Тип задачи': tp.value, 'Описание': ds.value, 'Статус работы': 'Задача: открыта', 'Ступень': r.stage.name })
                .then(function () { W.toast('Задача создана'); return M.reload(); }).then(function () { render(host); }).catch(function (e) { W.toast(e.message, true); }); } }, { text: 'Отмена' }]);
    }
    function render(host) {
        host.innerHTML = '';
        var mine = !!M.me && W.ctx.role.indexOf('Менеджер') === 0;
        if (mine) state.mgr = M.me;
        host.appendChild(W.el('h1', { text: mine ? 'Мои задачи' : 'Задачи по просрочке' }));
        host.appendChild(W.el('p', { 'class': 'dbt-sub', text: 'Список «кому что сегодня»: каждая ступень воронки порождает задачу со сроком и исполнителем.' }));
        var bar = W.el('div', { 'class': 'dbt-bar' });
        if (!mine) bar.appendChild(W.field('Менеджер', (function () { var s = W.select([['', 'Все менеджеры']].concat(M.managers.map(function (m) { return [m['Менеджер'], m['Менеджер']]; })), state.mgr); s.onchange = function () { state.mgr = s.value; render(host); }; return s; })()));
        bar.appendChild(W.field('Показывать', (function () { var s = W.select([['0', 'Открытые'], ['1', 'Выполненные']], state.done ? '1' : '0'); s.onchange = function () { state.done = s.value === '1'; render(host); }; return s; })()));
        if (W.canWrite('Задача по долгу')) bar.appendChild(W.btn('Добавить задачу', function () { addDialog(host); }));
        host.appendChild(bar);
        var list = M.tasks.filter(function (t) { return (!state.mgr || t.mgr === state.mgr) && ((t.status === 'Задача: выполнена') === state.done); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
        var T = W.TODAY;
        var groups = state.done ? [['Выполнено', list]] : [['Просрочены', list.filter(function (t) { return t.date < T; })], ['Сегодня', list.filter(function (t) { return t.date === T; })], ['Позже', list.filter(function (t) { return t.date > T; })]];
        var k = W.el('div', { 'class': 'dbt-kpis' }, [W.el('div', { 'class': 'dbt-kpi' + (groups[0][1].length && !state.done ? ' dbt-kpi-bad' : '') }, [W.el('div', { 'class': 'dbt-kpi-v', text: String(groups[0][1].length) }), W.el('div', { 'class': 'dbt-kpi-l', text: groups[0][0] })])]);
        if (!state.done) { k.appendChild(W.el('div', { 'class': 'dbt-kpi' }, [W.el('div', { 'class': 'dbt-kpi-v', text: String(groups[1][1].length) }), W.el('div', { 'class': 'dbt-kpi-l', text: 'Сегодня' })])); k.appendChild(W.el('div', { 'class': 'dbt-kpi' }, [W.el('div', { 'class': 'dbt-kpi-v', text: String(groups[2][1].length) }), W.el('div', { 'class': 'dbt-kpi-l', text: 'Позже' })])); }
        host.appendChild(k);
        groups.forEach(function (g) {
            if (!g[1].length) return;
            host.appendChild(W.el('h2', { text: g[0] + ' (' + g[1].length + ')' }));
            var tbl = W.table([
                { t: 'Срок', html: function (t) { return C.toDmy(t.date); } }, { t: 'Клиент', html: function (t) { return '<b>' + W.esc(t.client) + '</b>'; } }, { t: 'Ступень', html: function (t) { var s = M.stageByName[t.stage]; return s ? W.badge(s.name, s.color) : W.esc(t.stage); } },
                { t: 'Тип', k: 'type' }, { t: 'Что сделать', k: 'desc' }, { t: 'Менеджер', html: function (t) { return W.esc(W.shortFio(t.mgr)); } }, { t: '', html: function () { return ''; } }], g[1], { rowCls: function (t) { return !state.done && t.date < T ? 'dbt-row-hot' : ''; } });
            [].slice.call(tbl.querySelectorAll('tbody tr')).forEach(function (tr, i) {
                var t = g[1][i]; tr.children[1].style.cursor = 'pointer'; tr.children[1].onclick = function () { location.href = W.url('registry') + '#client=' + encodeURIComponent(t.client); };
                if (!state.done && W.canWrite('Задача по долгу')) tr.children[6].appendChild(W.btn('Выполнено', function () { done(host, t); }));
            });
            host.appendChild(tbl);
        });
        if (!list.length) host.appendChild(W.el('p', { 'class': 'dbt-empty', text: 'Задач нет' }));
    }
    W.mount(function (host) { return W.loadModel().then(function () { render(host); }); });
})();
