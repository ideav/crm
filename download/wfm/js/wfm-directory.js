/* WFM: Справочники и правила. Сотрудники, шаблоны смен, календарь, правила; остальные справочники открываются в таблицах платформы. */
(function () {
    'use strict';
    var W = window.Wfm, C = W.core, S = { tab: 'Сотрудник' }, cache = {};
    var TABS = [['Сотрудник', 'Сотрудники'], ['Шаблон смены', 'Шаблоны смен'], ['Календарь', 'Календарь'], ['Правило', 'Правила']];
    var OTHER = ['Подразделение', 'Бригада', 'Должность', 'Статус', 'Вид времени', 'Тип дня', 'Источник факта', 'Вид отпуска', 'Цикл вахты', 'Регион', 'Режим учёта', 'Тип подразделения'];
    var COLS = {
        'Сотрудник': [['Сотрудник', 'Табельный номер'], ['ФИО', 'ФИО'], ['Должность', 'Должность'], ['Подразделение', 'Подразделение'], ['Бригада', 'Бригада'], ['Ставка', 'Ставка', 1], ['Без ночных', 'Без ночных']],
        'Шаблон смены': [['Шаблон смены', 'Шаблон'], ['Начало смены', 'Начало'], ['Конец смены', 'Конец'], ['Перерыв, мин', 'Перерыв, мин', 1], ['Оплачиваемых часов', 'Оплачиваемых, ч', 1], ['Ночных часов', 'Ночных, ч', 1]],
        'Календарь': [['Календарь', 'Дата'], ['Тип дня', 'Тип дня'], ['Норма часов', 'Норма, ч', 1], ['Примечание', 'Примечание']],
        'Правило': [['Правило', 'Правило'], ['Значение правила', 'Значение', 1], ['Единица', 'Единица'], ['Комментарий', 'Комментарий']]
    };
    function editRule(r, host) {
        var v = W.el('input', { type: 'number', step: 'any', value: C.num(r['Значение правила']) });
        W.modal(r['Правило'], W.el('div', {}, [W.el('p', { 'class': 'wfm-sub', text: r['Комментарий'] }), W.field('Значение (' + (r['Единица'] || '') + ')', v)]), [{ text: 'Отмена' }, { text: 'Сохранить', cls: 'wfm-primary', keep: true, fn: function (close) {
            W.post('_m_set/' + r._id + '?JSON', { fields: { 'Значение правила': v.value } }).then(function () { r['Значение правила'] = v.value; W.toast('Правило сохранено'); close(); render(host); }).catch(function (e) { W.toast(e.message, true); });
            return false; } }]);
    }
    function render(host) {
        host.innerHTML = '';
        host.appendChild(W.el('h1', { text: 'Справочники и правила' }));
        host.appendChild(W.tabs(TABS.concat([['other', 'Прочие справочники']]), S.tab, function (t) { S.tab = t; load(host); }));
        if (S.tab === 'other') {
            host.appendChild(W.el('ul', { 'class': 'wfm-list' }, OTHER.filter(function (n) { return W.canRead(n); }).map(function (n) {
                return W.el('li', {}, [W.el('a', { href: W.url('table/' + W.tid(n)), text: n })]);
            })));
            return;
        }
        var rows = cache[S.tab], can = W.canWrite(S.tab);
        host.appendChild(W.el('p', { 'class': 'wfm-sub', text: 'Записей: ' + rows.length + '. ' + (S.tab === 'Правило' && can ? 'Клик по строке - изменить значение: проверки пересчитываются без правки кода.' : '') }));
        var cols = COLS[S.tab].map(function (c) { return { k: c[0], t: c[1], num: !!c[2] }; });
        host.appendChild(W.table(cols, rows, { onrow: S.tab === 'Правило' && can ? function (r) { editRule(r, host); } : null }));
        if (can) host.appendChild(W.el('p', {}, [W.el('a', { href: W.url('table/' + W.tid(S.tab)), text: 'Открыть таблицу для добавления и правки записей' })]));
    }
    function load(host) {
        if (S.tab === 'other' || cache[S.tab]) return render(host);
        W.rows(S.tab).then(function (r) { cache[S.tab] = r; render(host); }).catch(W.fail);
    }
    W.mount(function (host) { load(host); });
})();
