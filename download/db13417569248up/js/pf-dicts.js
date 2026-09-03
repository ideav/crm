/* Рабочее место руководителя: справочники */
(function () {
    'use strict';
    var root = document.getElementById('pf-dicts-root');
    if (!root) return;
    var el = PF.el;

    var DICTS = [
        {table: 'Вид упаковки', title: 'Виды упаковки', first: 'Наименование',
         cols: [['Код упаковки', 'text'], ['Граммовка, г', 'number'], ['Порядок сортировки', 'number']]},
        {table: 'Показатель контроля', title: 'Показатели контроля', first: 'Наименование показателя',
         cols: [['Код показателя', 'text'], ['Группа этапа', 'text'], ['Тип замера', 'ref:Тип замера'],
                ['Ед. изм.', 'text'], ['Норма мин', 'number'], ['Норма макс', 'number'], ['Порядок сортировки', 'number']]},
        {table: 'Оборудование', title: 'Оборудование и линии', first: 'Наименование',
         cols: [['Код оборудования', 'text'], ['Тип оборудования', 'text'], ['Инвентарный номер', 'text'],
                ['Норма скорости', 'number'], ['Ед. скорости', 'text'], ['В работе', 'bool']]},
        {table: 'Вид поломки', title: 'Виды поломок и остановок', first: 'Наименование',
         cols: [['Код поломки', 'text'], ['Плановая остановка', 'bool'], ['Описание поломки', 'memo']]},
        {table: 'Тип смены', title: 'Смены', first: 'Наименование',
         cols: [['Код смены', 'text'], ['Начало смены', 'text'], ['Окончание смены', 'text']]},
        {table: 'Наименование продукта', title: 'Наименование продукта', first: 'Наименование',
         cols: [['Код продукта', 'text'], ['Порядок сортировки', 'number']]},
        {table: 'Тип замера', title: 'Типы замера', first: 'Наименование',
         cols: [['Код типа замера', 'text'], ['Описание типа замера', 'memo']]},
        {table: 'Статус задания', title: 'Статусы задания', first: 'Наименование',
         cols: [['Код статуса', 'text'], ['Порядок сортировки', 'number'], ['Цвет статуса', 'text']]}
    ];

    var current = DICTS[0], data = [], refCache = {};

    function refOptions(tableName) {
        if (refCache[tableName]) return Promise.resolve(refCache[tableName]);
        return PF.rows(PF.tid(tableName)).then(function (rows) {
            refCache[tableName] = rows.map(function (r) { return {id: r.i, name: r.r[0]}; });
            return refCache[tableName];
        });
    }

    function load() {
        var needRefs = current.cols.filter(function (c) { return c[1].indexOf('ref:') === 0; })
            .map(function (c) { return refOptions(c[1].slice(4)); });
        return Promise.all([PF.rows(PF.tid(current.table))].concat(needRefs)).then(function (r) {
            var t = PF.table(current.table);
            data = r[0].map(function (row) {
                var o = {id: row.i, _value: row.r[0]};
                current.cols.forEach(function (c) {
                    var i = 1 + t.reqs.findIndex(function (q) { return q.name === c[0]; });
                    o[c[0]] = row.r[i];
                });
                return o;
            });
        });
    }

    function editor(rec) {
        var fields = [{key: '_value', label: current.first, type: 'text'}];
        current.cols.forEach(function (c) {
            if (c[1].indexOf('ref:') === 0)
                fields.push({key: c[0], label: c[0], type: 'ref', options: refCache[c[1].slice(4)] || []});
            else fields.push({key: c[0], label: c[0], type: c[1]});
        });
        var vals = {};
        if (rec) {
            vals._value = rec._value;
            current.cols.forEach(function (c) {
                var v = rec[c[0]];
                if (c[1].indexOf('ref:') === 0) v = PF.refId(v);
                else if (c[1] === 'bool') v = (v === 'X') ? 1 : 0;
                vals[c[0]] = v;
            });
        }
        var f = PF.form(fields, vals);
        PF.modal((rec ? 'Изменение · ' : 'Новая запись · ') + current.title, f.node, [{
            text: 'Сохранить', primary: true, onClick: function (close) {
                var v = f.values(), out = {};
                out['t' + PF.tid(current.table)] = v._value;
                current.cols.forEach(function (c) { out[PF.f(current.table, c[0])] = v[c[0]]; });
                var p = rec ? PF.update(rec.id, out) : PF.create(PF.tid(current.table), out, 1);
                p.then(function () { close(); PF.toast('Сохранено'); reload(); }).catch(PF.error);
            }
        }]);
    }

    function render() {
        PF.clear(root);
        var canWrite = PF.canWrite(current.table);
        root.appendChild(el('div', {class: 'pf-head'}, [
            el('div', {}, [
                el('h1', {text: 'Справочники'}),
                el('div', {class: 'pf-head__sub', text: 'Единые списки, из которых собираются задания и чек-листы'})
            ]),
            el('div', {class: 'pf-actions'}, [
                canWrite ? el('button', {class: 'pf-btn pf-btn--primary', text: '+ Запись',
                    onclick: function () { editor(null); }}) : null
            ])
        ]));

        var tabs = el('div', {class: 'pf-tabs'});
        DICTS.forEach(function (d) {
            tabs.appendChild(el('button', {
                class: 'pf-tab' + (d.table === current.table ? ' pf-tab--active' : ''), type: 'button',
                text: d.title, onclick: function () { current = d; reload(); }
            }));
        });
        root.appendChild(tabs);

        var columns = [{title: current.first, key: '_value'}];
        current.cols.forEach(function (c) {
            columns.push({
                title: c[0], cls: c[1] === 'number' ? 'pf-num' : '',
                render: function (r) {
                    var v = r[c[0]];
                    if (c[1] === 'bool') return v === 'X' ? 'да' : 'нет';
                    if (c[1].indexOf('ref:') === 0) return PF.refVal(v);
                    return v;
                }
            });
        });
        root.appendChild(el('div', {class: 'pf-card'}, [
            el('div', {class: 'pf-card__title', text: current.title + ' · записей: ' + data.length}),
            PF.tableView(columns, data, {empty: 'Записей нет', onRow: canWrite ? editor : null})
        ]));
    }

    function reload() {
        PF.loading(root);
        return load().then(render).catch(function (e) {
            PF.clear(root).appendChild(el('div', {class: 'pf-card', text: 'Ошибка: ' + e.message}));
            PF.error(e);
        });
    }

    PF.loading(root);
    PF.schema().then(reload);
})();
