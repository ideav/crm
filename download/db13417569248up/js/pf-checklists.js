/* Рабочее место руководителя: карты контроля (распределение показателей) */
(function () {
    'use strict';
    var root = document.getElementById('pf-checklists-root');
    if (!root) return;
    var el = PF.el;
    var CARD = 'Карта контроля', LINE = 'Строка карты';
    var st = {cards: [], lines: {}, packs: [], inds: [], current: null};

    function idx(table, name) {
        return 1 + PF.table(table).reqs.findIndex(function (q) { return q.name === name; });
    }

    function load() {
        return Promise.all([
            PF.rows(PF.tid(CARD)),
            PF.rows(PF.tid('Вид упаковки')),
            PF.rows(PF.tid('Показатель контроля'))
        ]).then(function (r) {
            st.packs = r[1].map(function (x) { return {id: x.i, name: x.r[0]}; });
            var pi = idx('Показатель контроля', 'Тип замера');
            st.inds = r[2].map(function (x) { return {id: x.i, name: x.r[0], type: PF.refVal(x.r[pi])}; });
            st.cards = r[0].map(function (x) {
                return {
                    id: x.i, name: x.r[0],
                    product: x.r[idx(CARD, 'Продукт')],
                    from: x.r[idx(CARD, 'Действует с')],
                    active: x.r[idx(CARD, 'Активна')] === 'X',
                    pack: PF.refVal(x.r[idx(CARD, 'Вид упаковки')]),
                    packId: PF.refId(x.r[idx(CARD, 'Вид упаковки')]),
                    lines: PF.num(x.r[idx(CARD, 'Строка карты')]) || 0
                };
            });
            if (!st.current && st.cards.length) st.current = st.cards[0].id;
            return loadLines();
        });
    }

    function loadLines() {
        if (!st.current) return Promise.resolve();
        return PF.children(PF.tid(LINE), st.current).then(function (rows) {
            st.lines[st.current] = rows.map(function (r) {
                return {
                    id: r.i, no: r.r[0],
                    indId: PF.refId(r.r[idx(LINE, 'Показатель контроля')]),
                    ind: PF.refVal(r.r[idx(LINE, 'Показатель контроля')]),
                    ord: PF.num(r.r[idx(LINE, 'Порядок сортировки')]) || 0,
                    required: r.r[idx(LINE, 'Обязателен')] === 'X',
                    min: PF.num(r.r[idx(LINE, 'Норма мин карты')]),
                    max: PF.num(r.r[idx(LINE, 'Норма макс карты')])
                };
            }).sort(function (a, b) { return a.ord - b.ord; });
        });
    }

    function cardForm(card) {
        var f = PF.form([
            {key: 'name', label: 'Наименование карты', type: 'text', placeholder: 'Фасовка ПЕТФУД — пауч'},
            {key: 'pack', label: 'Вид упаковки', type: 'ref', options: st.packs},
            {key: 'product', label: 'Продукт', type: 'text'},
            {key: 'from', label: 'Действует с', type: 'date'},
            {key: 'active', label: 'Активна', type: 'bool'}
        ], card ? {name: card.name, pack: card.packId, product: card.product,
            from: card.from ? PF.isoDate(PF.toDate(card.from)) : '', active: card.active ? 1 : 0}
            : {from: PF.isoDate(), active: 1});
        PF.modal(card ? 'Карта контроля' : 'Новая карта контроля', f.node, [{
            text: 'Сохранить', primary: true, onClick: function (close) {
                var v = f.values(), fields = {};
                fields['t' + PF.tid(CARD)] = v.name;
                fields[PF.f(CARD, 'Вид упаковки')] = v.pack;
                fields[PF.f(CARD, 'Продукт')] = v.product;
                fields[PF.f(CARD, 'Действует с')] = v.from;
                fields[PF.f(CARD, 'Активна')] = v.active;
                var p = card ? PF.update(card.id, fields) : PF.create(PF.tid(CARD), fields, 1);
                p.then(function (id) {
                    close();
                    if (!card && id) st.current = id;
                    PF.toast('Карта сохранена');
                    reload();
                }).catch(PF.error);
            }
        }]);
    }

    function duplicate(card) {
        var lines = st.lines[card.id] || [];
        var fields = {};
        fields['t' + PF.tid(CARD)] = card.name + ' (копия)';
        fields[PF.f(CARD, 'Вид упаковки')] = card.packId;
        fields[PF.f(CARD, 'Продукт')] = card.product;
        fields[PF.f(CARD, 'Действует с')] = PF.isoDate();
        fields[PF.f(CARD, 'Активна')] = 0;
        PF.create(PF.tid(CARD), fields, 1).then(function (newId) {
            return lines.reduce(function (p, l) {
                return p.then(function () {
                    var lf = {};
                    lf[PF.f(LINE, 'Показатель контроля')] = l.indId;
                    lf[PF.f(LINE, 'Порядок сортировки')] = l.ord;
                    lf[PF.f(LINE, 'Обязателен')] = l.required ? 1 : 0;
                    lf[PF.f(LINE, 'Норма мин карты')] = l.min;
                    lf[PF.f(LINE, 'Норма макс карты')] = l.max;
                    return PF.create(PF.tid(LINE), lf, newId);
                });
            }, Promise.resolve()).then(function () { st.current = newId; });
        }).then(function () { PF.toast('Карта продублирована'); reload(); }).catch(PF.error);
    }

    function lineForm(line) {
        var lines = st.lines[st.current] || [];
        var f = PF.form([
            {key: 'ind', label: 'Показатель контроля', type: 'ref', options: st.inds},
            {key: 'ord', label: 'Порядок в чек-листе', type: 'number'},
            {key: 'required', label: 'Обязателен к заполнению', type: 'bool'},
            {key: 'min', label: 'Норма мин, °C (пусто — из справочника)', type: 'number'},
            {key: 'max', label: 'Норма макс, °C', type: 'number'}
        ], line ? {ind: line.indId, ord: line.ord, required: line.required ? 1 : 0, min: line.min, max: line.max}
            : {ord: lines.length + 1, required: 1, min: 1, max: 100});
        PF.modal(line ? 'Строка карты' : 'Новая строка карты', f.node, [{
            text: 'Сохранить', primary: true, onClick: function (close) {
                var v = f.values(), fields = {};
                if (!v.ind) { PF.toast('Выберите показатель', 'warn'); return; }
                fields[PF.f(LINE, 'Показатель контроля')] = v.ind;
                fields[PF.f(LINE, 'Порядок сортировки')] = v.ord;
                fields[PF.f(LINE, 'Обязателен')] = v.required;
                fields[PF.f(LINE, 'Норма мин карты')] = v.min;
                fields[PF.f(LINE, 'Норма макс карты')] = v.max;
                var p = line ? PF.update(line.id, fields) : PF.create(PF.tid(LINE), fields, st.current);
                p.then(function () { close(); PF.toast('Строка сохранена'); reload(); }).catch(PF.error);
            }
        }, line ? {
            text: 'Удалить строку', onClick: function (close) {
                PF.remove(line.id).then(function () { close(); PF.toast('Строка удалена'); reload(); }).catch(PF.error);
            }
        } : null].filter(Boolean));
    }

    function render() {
        PF.clear(root);
        var canWrite = PF.canWrite(CARD);
        root.appendChild(el('div', {class: 'pf-head'}, [
            el('div', {}, [
                el('h1', {text: 'Карты контроля'}),
                el('div', {class: 'pf-head__sub', text: 'Наборы показателей, которые оператор заполняет по каждому замесу'})
            ]),
            el('div', {class: 'pf-actions'}, [
                canWrite ? el('button', {class: 'pf-btn pf-btn--primary', text: '+ Карта', onclick: function () { cardForm(null); }}) : null
            ])
        ]));

        root.appendChild(el('div', {class: 'pf-card'}, [
            el('div', {class: 'pf-card__title', text: 'Карты'}),
            PF.tableView([
                {title: 'Наименование', key: 'name'},
                {title: 'Упаковка', key: 'pack'},
                {title: 'Продукт', key: 'product'},
                {title: 'Действует с', render: function (c) { return PF.fmtDate(c.from); }},
                {title: 'Строк', key: 'lines', cls: 'pf-num'},
                {title: 'Статус', render: function (c) { return PF.badge(c.active ? 'активна' : 'архив', c.active ? 'green' : 'gray'); }}
            ], st.cards, {
                empty: 'Карт контроля нет',
                onRow: function (c) { st.current = c.id; reload(); }
            })
        ]));

        var card = st.cards.filter(function (c) { return c.id === st.current; })[0];
        if (!card) return;
        var lines = st.lines[card.id] || [];
        root.appendChild(el('div', {class: 'pf-card'}, [
            el('div', {class: 'pf-card__title'}, [
                el('span', {text: 'Показатели карты «' + card.name + '»'}),
                el('div', {class: 'pf-actions'}, [
                    canWrite ? el('button', {class: 'pf-btn', text: 'Изменить карту', onclick: function () { cardForm(card); }}) : null,
                    canWrite ? el('button', {class: 'pf-btn', text: 'Дублировать', onclick: function () { duplicate(card); }}) : null,
                    canWrite ? el('button', {class: 'pf-btn pf-btn--primary', text: '+ Показатель', onclick: function () { lineForm(null); }}) : null
                ])
            ]),
            PF.tableView([
                {title: '№', key: 'ord', cls: 'pf-num'},
                {title: 'Показатель контроля', key: 'ind'},
                {title: 'Тип замера', render: function (l) {
                    var i = st.inds.filter(function (x) { return x.id === l.indId; })[0];
                    return i ? i.type : '—';
                }},
                {title: 'Обязателен', render: function (l) { return l.required ? 'да' : 'нет'; }},
                {title: 'Норма, °C', render: function (l) {
                    return (l.min === null ? '—' : '+' + l.min) + '…' + (l.max === null ? '—' : '+' + l.max);
                }}
            ], lines, {empty: 'Показателей ещё нет', onRow: canWrite ? lineForm : null})
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
