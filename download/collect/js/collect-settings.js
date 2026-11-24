/* Взыскание: экран «Настройки демо». Каждая спорная точка решения - опция: администратор выбирает вариант, экраны и расчётное ядро читают значение. Описание опций лежит в таблице «Настройка демо». */
(function () {
    'use strict';
    var W = window.Dbt, C = W.core, M = W.M;
    var GROUPS = ['Воронка просрочки', 'Стоп-отгрузка', 'Претензия и пени', 'Дата'];

    function variants(row) {
        return String(W.dec(row['Варианты']) || '').split('|').filter(Boolean).map(function (v) {
            var eq = v.indexOf('='), code = eq < 0 ? v : v.slice(0, eq), rest = eq < 0 ? v : v.slice(eq + 1), t = rest.indexOf('~');
            return { code: code.trim(), name: (t < 0 ? rest : rest.slice(0, t)).trim(), hint: t < 0 ? '' : rest.slice(t + 1).trim() };
        });
    }
    function save(host, row, value) {
        return M.set(row._id, { 'Значение': value }).then(function () { W.toast('Опция сохранена, экраны пересчитаны'); return M.reload(); }).then(function () { render(host); }).catch(function (e) { W.toast(e.message, true); });
    }
    function option(host, row, can) {
        var code = row['Код'], cur = String(W.dec(row['Значение']) || C.SETTING_DEFAULTS[code] || '');
        var card = W.el('div', { 'class': 'dbt-card dbt-opt' }, [W.el('h3', { text: row['Настройка демо'] }), W.el('p', { 'class': 'dbt-sub', text: W.dec(row['Пояснение']) })]);
        if (row['Тип'] === 'date') {
            var d = W.el('input', { type: 'date', value: C.toIso(cur) || C.SETTING_DEFAULTS[code], disabled: !can || M.S.todayMode !== 'demo', 'aria-label': row['Настройка демо'] });
            d.onchange = function () { if (d.value) save(host, row, d.value); };
            card.appendChild(W.el('div', { 'class': 'dbt-bar' }, [W.field('Демо-дата', d)]));
            if (M.S.todayMode !== 'demo') card.appendChild(W.el('p', { 'class': 'dbt-mini', text: 'Сейчас включена реальная дата, демо-дата не используется.' }));
        } else {
            variants(row).forEach(function (v) {
                var rb = W.el('input', { type: 'radio', name: code, value: v.code, disabled: !can }); rb.checked = v.code === cur;
                rb.onchange = function () { if (rb.checked) save(host, row, v.code); };
                card.appendChild(W.el('label', { 'class': 'dbt-radio' + (rb.checked ? ' dbt-radio-on' : '') }, [rb, W.el('span', {}, [W.el('b', { text: v.name }), v.hint ? W.el('span', { 'class': 'dbt-mini', text: ' — ' + v.hint }) : null])]));
            });
        }
        if (row['Кому подходит']) card.appendChild(W.el('p', { 'class': 'dbt-mini dbt-opt-for', text: 'Кому подходит: ' + W.dec(row['Кому подходит']) }));
        return card;
    }
    function summary() {
        var rows = M.rows, need = rows.filter(function (r) { return r.dec.stop; }).length, dir = rows.filter(function (r) { return r.dec.needDirector; }).length;
        var f = M.funnel(rows).filter(function (x) { return x.code !== 'before' && x.n > 0; }).map(function (x) { return M.stageBy[x.code].name + ': ' + x.n; }).join(' · ');
        return W.el('div', { 'class': 'dbt-card dbt-opt-now' }, [W.el('h3', { text: 'Что получается сейчас' }),
            W.el('p', { html: 'Сегодня: <b>' + C.toDmy(W.TODAY) + '</b> (' + (M.S.todayMode === 'real' ? 'реальная дата' : 'демо-дата') + '). Нужна стоп-отгрузка: <b>' + need + '</b>, решает директор: <b>' + dir + '</b>.' }),
            W.el('p', { 'class': 'dbt-mini', text: 'Воронка: ' + f })]);
    }
    function render(host) {
        host.innerHTML = '';
        var can = W.canWrite('Настройка демо');
        host.appendChild(W.el('h1', { text: 'Настройки' }));
        host.appendChild(W.el('p', { 'class': 'dbt-sub', text: 'У каждой компании своё «нормально»: правила не зашиты в систему, а выбираются. Переключите опцию — реестр, воронка и претензии сразу работают по-новому.' + (can ? '' : ' Менять настройки может финансовый директор.') }));
        host.appendChild(summary());
        var rows = M.settingRows.slice().sort(function (a, b) { return C.num(a['Порядок']) - C.num(b['Порядок']); });
        GROUPS.forEach(function (g) {
            var list = rows.filter(function (r) { return r['Группа'] === g; });
            if (!list.length) return;
            host.appendChild(W.el('h2', { text: g }));
            host.appendChild(W.el('div', { 'class': 'dbt-opts' }, list.map(function (r) { return option(host, r, can); })));
        });
        if (!rows.length) host.appendChild(W.el('p', { 'class': 'dbt-empty', text: 'Таблица «Настройка демо» пуста или недоступна.' }));
    }
    W.mount(function (host) { return W.loadModel().then(function () { render(host); }); });
})();
