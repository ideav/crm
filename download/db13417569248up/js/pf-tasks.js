/* Рабочее место: список сменных заданий */
(function () {
    'use strict';
    var root = document.getElementById('pf-tasks-root');
    if (!root) return;
    var el = PF.el;
    var TASK = 'Задание производства';
    var dicts = {}, all = [], counts = {};

    var filters = {
        status: PF.qs('status'), date_from: '', date_to: '',
        shift: '', line: '', operator: '', pack: ''
    };

    function loadDicts() {
        return Promise.all([
            PF.rows(PF.tid('Статус задания')),
            PF.rows(PF.tid('Тип смены')),
            PF.rows(PF.tid('Оборудование')),
            PF.rows(PF.tid('Вид упаковки')),
            PF.rows(PF.tid('Карта контроля')),
            PF.rows(18)
        ]).then(function (r) {
            var st = PF.table('Статус задания');
            dicts.status = r[0].map(function (x) {
                return {id: x.i, name: x.r[0], code: x.r[1 + st.reqs.findIndex(function (q) { return q.name === 'Код статуса'; })]};
            });
            dicts.shift = r[1].map(function (x) { return {id: x.i, name: x.r[0]}; });
            dicts.line = r[2].map(function (x) { return {id: x.i, name: x.r[0]}; });
            dicts.pack = r[3].map(function (x) { return {id: x.i, name: x.r[0]}; });
            var karta = PF.table('Карта контроля');
            var packIdx = 1 + karta.reqs.findIndex(function (q) { return q.name === 'Вид упаковки'; });
            dicts.card = r[4].map(function (x) {
                return {id: x.i, name: x.r[0], packId: PF.refId(x.r[packIdx])};
            });
            dicts.user = r[5].filter(function (x) { return String(x.r[0]) !== PF.db; })
                .map(function (x) { return {id: x.i, name: x.r[0]}; });
        });
    }

    function loadTasks() {
        return Promise.all([
            PF.report('pf_tasks'),
            PF.rows(PF.tid(TASK))
        ]).then(function (res) {
            var visible = {};
            res[1].forEach(function (r) { visible[r.i] = true; });
            all = res[0].filter(function (t) { return t.task_id && t.task_no && visible[t.task_id]; });
            var t = PF.table(TASK);
            var idx = {};
            ['Замес-кусочки', 'Замес-паштет', 'Замес-волокна', 'Простой'].forEach(function (n) {
                idx[n] = 1 + t.reqs.findIndex(function (q) { return q.name === n; });
            });
            counts = {};
            res[1].forEach(function (r) {
                counts[r.i] = {
                    batches: (PF.num(r.r[idx['Замес-кусочки']]) || 0) + (PF.num(r.r[idx['Замес-паштет']]) || 0) +
                        (PF.num(r.r[idx['Замес-волокна']]) || 0),
                    downtime: PF.num(r.r[idx['Простой']]) || 0
                };
            });
        });
    }

    function apply() {
        return all.filter(function (t) {
            if (filters.status && t.status_code !== filters.status) return false;
            if (filters.shift && t.shift !== filters.shift) return false;
            if (filters.line && t.line !== filters.line) return false;
            if (filters.operator && t.operator !== filters.operator) return false;
            if (filters.pack && t.pack_type !== filters.pack) return false;
            var d = PF.toDate(t.date);
            if (filters.date_from && d && d < new Date(filters.date_from + 'T00:00:00')) return false;
            if (filters.date_to && d && d > new Date(filters.date_to + 'T23:59:59')) return false;
            return true;
        });
    }

    function filterBar() {
        var bar = el('div', {class: 'pf-filters'});
        function sel(label, key, options) {
            var s = el('select', {class: 'pf-input', onchange: function () { filters[key] = s.value; render(); }});
            s.appendChild(el('option', {value: '', text: '— все —'}));
            options.forEach(function (o) {
                var op = el('option', {value: o.v, text: o.t});
                if (String(o.v) === String(filters[key])) op.setAttribute('selected', 'selected');
                s.appendChild(op);
            });
            bar.appendChild(el('label', {class: 'pf-field'}, [el('span', {class: 'pf-field__label', text: label}), s]));
        }
        sel('Статус', 'status', (dicts.status || []).map(function (x) { return {v: x.code, t: x.name}; }));
        sel('Смена', 'shift', (dicts.shift || []).map(function (x) { return {v: x.name, t: x.name}; }));
        sel('Линия', 'line', (dicts.line || []).map(function (x) { return {v: x.name, t: x.name}; }));
        sel('Оператор', 'operator', (dicts.user || []).map(function (x) { return {v: x.name, t: x.name}; }));
        sel('Упаковка', 'pack', (dicts.pack || []).map(function (x) { return {v: x.name, t: x.name}; }));
        ['date_from', 'date_to'].forEach(function (k) {
            var i = el('input', {type: 'date', class: 'pf-input', value: filters[k],
                onchange: function () { filters[k] = i.value; render(); }});
            bar.appendChild(el('label', {class: 'pf-field'}, [
                el('span', {class: 'pf-field__label', text: k === 'date_from' ? 'Дата с' : 'Дата по'}), i]));
        });
        bar.appendChild(el('button', {
            class: 'pf-btn', text: 'Сбросить', onclick: function () {
                Object.keys(filters).forEach(function (k) { filters[k] = ''; });
                render();
            }
        }));
        return bar;
    }

    function newTaskForm() {
        var f = PF.form([
            {key: 'date', label: 'Дата смены', type: 'date'},
            {key: 'shift', label: 'Смена', type: 'select', options: dicts.shift},
            {key: 'product', label: 'Продукт', type: 'text', placeholder: 'Паштет для кошек'},
            {key: 'pack', label: 'Вид упаковки', type: 'ref', options: dicts.pack},
            {key: 'gramm', label: 'Граммовка, г', type: 'number'},
            {key: 'line', label: 'Линия / оборудование', type: 'ref', options: dicts.line},
            {key: 'card', label: 'Карта контроля', type: 'ref', options: dicts.card},
            {key: 'operator', label: 'Оператор', type: 'ref', options: dicts.user},
            {key: 'plan', label: 'План выпуска, ед', type: 'number'},
            {key: 'checker', label: 'Ф.И.О. проверяющего', type: 'text'},
            {key: 'onpack', label: 'Дата на упаковке', type: 'bool'},
            {key: 'notes', label: 'Комментарии / проблемы / замечания', type: 'memo'}
        ], {date: PF.isoDate(), onpack: 1});

        // карта контроля подставляется по виду упаковки, но остаётся заменяемой (ФТ-6)
        var packHidden = f.node.querySelector('#f_pack');
        var cardHidden = f.node.querySelector('#f_card');
        function suggestCard() {
            if (!packHidden || !cardHidden || !packHidden.value || cardHidden.value) return;
            var match = dicts.card.filter(function (c) { return String(c.packId) === String(packHidden.value); })[0];
            if (!match) return;
            cardHidden.value = match.id;
            var text = cardHidden.parentNode.querySelector('input[type=text]');
            if (text) text.value = match.name;
        }
        f.node.addEventListener('click', suggestCard);
        f.node.addEventListener('change', suggestCard);
        f.node.addEventListener('focusout', suggestCard);

        PF.modal('Новое сменное задание', f.node, [{
            text: 'Создать', primary: true, onClick: function (close) {
                var v = f.values();
                if (!v.date || !v.shift) { PF.toast('Укажите дату и смену', 'warn'); return; }
                var newStatus = (dicts.status.filter(function (s) { return s.code === 'new'; })[0] || dicts.status[0]);
                var fields = {};
                fields[PF.f(TASK, 'Дата задания')] = v.date;
                fields[PF.f(TASK, 'Смена')] = v.shift;
                fields[PF.f(TASK, 'Продукт')] = v.product;
                fields[PF.f(TASK, 'Граммовка, г')] = v.gramm;
                fields[PF.f(TASK, 'Вид упаковки')] = v.pack;
                fields[PF.f(TASK, 'Оборудование (линия)')] = v.line;
                fields[PF.f(TASK, 'Карта контроля')] = v.card;
                fields[PF.f(TASK, 'Оператор')] = v.operator;
                fields[PF.f(TASK, 'План выпуска, ед')] = v.plan;
                fields[PF.f(TASK, 'Проверяющий')] = v.checker;
                fields[PF.f(TASK, 'Дата на упаковке')] = v.onpack;
                fields[PF.f(TASK, 'Мастер')] = PF.user;
                fields[PF.f(TASK, 'Комментарии/проблемы/замечания')] = v.notes;
                fields[PF.f(TASK, 'Статус')] = newStatus.id;
                PF.create(PF.tid(TASK), fields, 1).then(function (id) {
                    close();
                    PF.toast('Задание создано');
                    PF.go('pf-task', {id: id});
                }).catch(PF.error);
            }
        }]);
    }

    function render() {
        PF.clear(root);
        var canWrite = PF.canWrite(TASK);
        var head = el('div', {class: 'pf-head'}, [
            el('div', {}, [
                el('h1', {text: 'Сменные задания'}),
                el('div', {class: 'pf-head__sub', text: 'Чек-листы производства ПЕТФУД · роль: ' + PF.role})
            ]),
            el('div', {class: 'pf-actions'}, [
                canWrite ? el('button', {class: 'pf-btn pf-btn--primary', text: '+ Задание', onclick: newTaskForm}) : null,
                el('button', {class: 'pf-btn', text: 'Ввод показаний', onclick: function () { PF.go('pf-entry', {}); }})
            ])
        ]);
        root.appendChild(head);
        root.appendChild(filterBar());

        var rows = apply();
        root.appendChild(el('div', {class: 'pf-legend', text: 'Показано заданий: ' + rows.length + ' из ' + all.length}));
        root.appendChild(PF.tableView([
            {title: '№', key: 'task_no', cls: 'pf-num'},
            {title: 'Дата', render: function (t) { return PF.fmtDate(t.date) || t.date; }},
            {title: 'Смена', key: 'shift'},
            {title: 'Продукт', key: 'product'},
            {title: 'Упаковка', render: function (t) { return t.pack_type + (t.gramm ? ' · ' + t.gramm + ' г' : ''); }},
            {title: 'Линия', key: 'line'},
            {title: 'Оператор', key: 'operator'},
            {title: 'Замесов', cls: 'pf-num', render: function (t) { return (counts[t.task_id] || {}).batches || 0; }},
            {title: 'Простоев', cls: 'pf-num', render: function (t) { return (counts[t.task_id] || {}).downtime || 0; }},
            {title: 'План/факт', cls: 'pf-num', render: function (t) {
                var p = PF.num(t.plan_ed) || 0, fq = PF.num(t.fact_ed) || 0;
                if (!p) return '—';
                var pct = Math.round(fq / p * 100);
                return PF.money(fq) + ' / ' + PF.money(p) + ' (' + pct + '%)';
            }},
            {title: 'Статус', render: function (t) { return PF.badge(t.status, PF.statusKind(t.status_code)); }}
        ], rows, {
            empty: 'Заданий по фильтру нет',
            onRow: function (t) { PF.go('pf-task', {id: t.task_id}); }
        }));
    }

    PF.loading(root);
    PF.schema()
        .then(loadDicts)
        .then(loadTasks)
        .then(render)
        .catch(function (e) {
            PF.clear(root).appendChild(el('div', {class: 'pf-card', text: 'Ошибка загрузки: ' + e.message}));
            PF.error(e);
        });
})();
