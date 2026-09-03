/* Рабочее место: планирование смен (директор) и итоги смен (мастер) */
(function () {
    'use strict';
    var root = document.getElementById('pf-plan-root');
    if (!root) return;
    var el = PF.el;
    var PLAN = 'План смены', ROW = 'Плановый выпуск', FACT = 'Итог смены';
    var PRODUCT_DICT = 'Наименование продукта';
    var st = {plans: [], rows: [], facts: [], shifts: [], products: []};

    function idx(table, name) {
        return 1 + PF.table(table).reqs.findIndex(function (q) { return q.name === name; });
    }

    // #4845: значения справочника «Наименование продукта». Справочник может ещё
    // не существовать в схеме — тогда свободный ввод текстом, страница не падает.
    function dictProducts() {
        try {
            return PF.rows(PF.tid(PRODUCT_DICT)).then(function (rows) {
                return rows.map(function (x) { return x.r[0]; }).filter(Boolean);
            }).catch(function () { return []; });
        } catch (e) { return Promise.resolve([]); }
    }

    // #4844: итоговое наименование полной смены всегда строится из даты и продукта
    function planName(dateIso, product) {
        var d = dateIso && PF.toDate(dateIso) ? PF.isoDate(PF.toDate(dateIso)) : '';
        return ['Смена общая', d, product].filter(Boolean).join(' ');
    }

    function load() {
        return Promise.all([
            PF.rows(PF.tid(PLAN)),
            PF.report('pf_plan'),
            PF.report('pf_fact'),
            PF.rows(PF.tid('Тип смены')),
            dictProducts()
        ]).then(function (r) {
            st.plans = r[0].map(function (x) {
                return {
                    id: x.i, name: x.r[0],
                    date: x.r[idx(PLAN, 'Дата смены')],
                    product: x.r[idx(PLAN, 'Продукт')],
                    comment: x.r[idx(PLAN, 'Комментарий плана')]
                };
            });
            // #4842: самые свежие смены — вверху (без даты — в конце)
            st.plans.sort(function (a, b) {
                var da = PF.toDate(a.date), db = PF.toDate(b.date);
                var ta = da ? da.getTime() : -1, tb = db ? db.getTime() : -1;
                return tb !== ta ? tb - ta : b.id - a.id;
            });
            st.products = r[4];
            st.rows = r[1].filter(function (x) { return x.plan_name; });
            st.facts = r[2].filter(function (x) { return x.plan_name; });
            st.shifts = r[3].map(function (x) { return {id: x.i, name: x.r[0]}; });
        });
    }

    function planForm(plan) {
        // #4845: «Планируемый продукт» — выбор из справочника; старые свободные значения не теряем
        var products = st.products.slice();
        if (plan && plan.product && products.indexOf(plan.product) < 0) products.unshift(plan.product);
        var f = PF.form([
            {key: 'name', label: 'Наименование смены', type: 'text', placeholder: 'Заполнится автоматически'},
            {key: 'date', label: 'Дата смены', type: 'date'},
            {key: 'product', label: 'Планируемый продукт', type: products.length ? 'select' : 'text',
                options: [{id: '', name: '— не выбрано —'}].concat(products.map(function (n) { return {id: n, name: n}; }))},
            {key: 'comment', label: 'Комментарий', type: 'memo', rows: 2}
        ], plan ? {name: plan.name, date: plan.date ? PF.isoDate(PF.toDate(plan.date)) : '', product: plan.product, comment: plan.comment}
            : {date: PF.isoDate()});
        PF.modal(plan ? 'План смены' : 'Новый план общей смены', f.node, [{
            text: 'Сохранить', primary: true, onClick: function (close) {
                var v = f.values(), fields = {};
                // #4844: наименование перегенерируется при каждом сохранении —
                // «Смена общая ГГГГ-ММ-ДД Продукт» (ручное имя не используется)
                fields['t' + PF.tid(PLAN)] = planName(v.date, v.product);
                fields[PF.f(PLAN, 'Дата смены')] = v.date;
                fields[PF.f(PLAN, 'Продукт')] = v.product;
                fields[PF.f(PLAN, 'Комментарий плана')] = v.comment;
                var p = plan ? PF.update(plan.id, fields) : PF.create(PF.tid(PLAN), fields, 1);
                p.then(function () { close(); PF.toast('План сохранён'); reload(); }).catch(PF.error);
            }
        }]);
    }

    function rowForm(plan, existing) {
        var f = PF.form([
            {key: 'shift', label: 'Смена', type: 'select', options: st.shifts},
            {key: 'ed', label: 'План выпуска, ед', type: 'number'},
            {key: 'batches', label: 'План замесов', type: 'number'},
            {key: 'kg', label: 'План массы, кг', type: 'number'}
        ], existing ? {
            shift: (st.shifts.filter(function (s) { return s.name === existing.shift; })[0] || {}).id,
            ed: existing.plan_ed, batches: existing.plan_batches, kg: existing.plan_kg
        } : {});
        PF.modal('Плановые показатели смены', f.node, [{
            text: 'Сохранить', primary: true, onClick: function (close) {
                var v = f.values(), fields = {};
                var label = (st.shifts.filter(function (s) { return String(s.id) === String(v.shift); })[0] || {}).name || '';
                fields['t' + PF.tid(ROW)] = label;
                fields[PF.f(ROW, 'Смена')] = v.shift;
                fields[PF.f(ROW, 'План выпуска, ед')] = v.ed;
                fields[PF.f(ROW, 'План замесов')] = v.batches;
                fields[PF.f(ROW, 'План массы, кг')] = v.kg;
                var p = existing ? PF.update(existing.row_id, fields) : PF.create(PF.tid(ROW), fields, plan.id);
                p.then(function () { close(); PF.toast('Плановые показатели сохранены'); reload(); }).catch(PF.error);
            }
        }]);
    }

    function factForm(plan, existing) {
        var f = PF.form([
            {key: 'shift', label: 'Смена', type: 'select', options: st.shifts},
            {key: 'ed', label: 'Факт выпуска, ед', type: 'number'},
            {key: 'batches', label: 'Факт замесов', type: 'number'},
            {key: 'defects', label: 'Брак, ед', type: 'number'},
            {key: 'downtime', label: 'Простой, мин', type: 'number'},
            {key: 'master', label: 'Мастер смены', type: 'text'},
            {key: 'comment', label: 'Комментарий', type: 'memo', rows: 2}
        ], existing ? {
            shift: (st.shifts.filter(function (s) { return s.name === existing.shift; })[0] || {}).id,
            ed: existing.fact_ed, batches: existing.fact_batches, defects: existing.defects,
            downtime: existing.downtime_min, master: existing.master, comment: existing.comment
        } : {master: PF.user});
        PF.modal('Итоги смены', f.node, [{
            text: 'Сохранить', primary: true, onClick: function (close) {
                var v = f.values(), fields = {};
                var label = (st.shifts.filter(function (s) { return String(s.id) === String(v.shift); })[0] || {}).name || '';
                fields['t' + PF.tid(FACT)] = label;
                fields[PF.f(FACT, 'Смена')] = v.shift;
                fields[PF.f(FACT, 'Факт выпуска, ед')] = v.ed;
                fields[PF.f(FACT, 'Факт замесов')] = v.batches;
                fields[PF.f(FACT, 'Брак, ед')] = v.defects;
                fields[PF.f(FACT, 'Простой, мин')] = v.downtime;
                fields[PF.f(FACT, 'Мастер смены')] = v.master;
                fields[PF.f(FACT, 'Комментарий итога')] = v.comment;
                var p = existing ? PF.update(existing.row_id, fields) : PF.create(PF.tid(FACT), fields, plan.id);
                p.then(function () { close(); PF.toast('Итоги смены сохранены'); reload(); }).catch(PF.error);
            }
        }]);
    }

    function pctNode(fact, plan) {
        var p = PF.num(plan), fq = PF.num(fact);
        if (!p) return el('span', {text: '—'});
        var pct = Math.round(fq / p * 100);
        var kind = pct >= 100 ? 'green' : (pct >= 90 ? 'amber' : 'red');
        return PF.badge(pct + '%', kind);
    }

    function render() {
        PF.clear(root);
        var canPlan = PF.canWrite(PLAN), canFact = PF.canWrite(FACT);
        root.appendChild(el('div', {class: 'pf-head'}, [
            el('div', {}, [
                el('h1', {text: 'План и итоги смен'}),
                el('div', {class: 'pf-head__sub', text: 'Директор планирует выпуск и замесы, мастер вносит фактические итоги смены'})
            ]),
            el('div', {class: 'pf-actions'}, [
                canPlan ? el('button', {class: 'pf-btn pf-btn--primary', text: '+ План общей смены', onclick: function () { planForm(null); }}) : null
            ])
        ]));

        // сводка план/факт
        var totals = {plan: 0, fact: 0, planB: 0, factB: 0, defects: 0, downtime: 0};
        st.rows.forEach(function (r) { totals.plan += PF.num(r.plan_ed) || 0; totals.planB += PF.num(r.plan_batches) || 0; });
        st.facts.forEach(function (r) {
            totals.fact += PF.num(r.fact_ed) || 0; totals.factB += PF.num(r.fact_batches) || 0;
            totals.defects += PF.num(r.defects) || 0; totals.downtime += PF.num(r.downtime_min) || 0;
        });
        var dev = totals.plan ? Math.round((totals.fact - totals.plan) / totals.plan * 100) : 0;
        root.appendChild(el('div', {class: 'pf-grid pf-grid--kpi'}, [
            kpi(PF.money(totals.plan), 'План выпуска, ед'),
            kpi(PF.money(totals.fact), 'Факт выпуска, ед'),
            kpi((dev > 0 ? '+' : '') + dev + '%', 'Отклонение план/факт', dev < 0 ? 'warn' : 'accent'),
            kpi(totals.planB + ' / ' + totals.factB, 'Замесы план / факт'),
            kpi(PF.money(totals.defects), 'Брак, ед', 'danger'),
            kpi(totals.downtime + ' мин', 'Простой суммарно', 'warn')
        ]));

        st.plans.forEach(function (p) {
            var rows = st.rows.filter(function (r) { return r.plan_name === p.name; });
            var facts = st.facts.filter(function (r) { return r.plan_name === p.name; });
            var body = el('div', {class: 'pf-card'}, [
                el('div', {class: 'pf-card__title'}, [
                    el('span', {text: p.name}),
                    el('div', {class: 'pf-actions'}, [
                        canPlan ? el('button', {class: 'pf-btn', text: 'Изменить', onclick: function () { planForm(p); }}) : null,
                        canPlan ? el('button', {class: 'pf-btn', text: '+ Плановая смена', onclick: function () { rowForm(p, null); }}) : null,
                        canFact ? el('button', {class: 'pf-btn pf-btn--primary', text: '+ Итоги смены', onclick: function () { factForm(p, null); }}) : null
                    ])
                ]),
                PF.tableView([
                    {title: 'Смена', key: 'shift'},
                    {title: 'План, ед', cls: 'pf-num', render: function (r) { return PF.money(r.plan_ed); }},
                    {title: 'Факт, ед', cls: 'pf-num', render: function (r) {
                        var fq = facts.filter(function (x) { return x.shift === r.shift; })[0];
                        return fq ? PF.money(fq.fact_ed) : '—';
                    }},
                    {title: 'Выполнение', render: function (r) {
                        var fq = facts.filter(function (x) { return x.shift === r.shift; })[0];
                        return pctNode(fq && fq.fact_ed, r.plan_ed);
                    }},
                    {title: 'Замесы план/факт', cls: 'pf-num', render: function (r) {
                        var fq = facts.filter(function (x) { return x.shift === r.shift; })[0];
                        return (r.plan_batches || '0') + ' / ' + (fq ? (fq.fact_batches || '0') : '—');
                    }},
                    {title: 'Брак, ед', cls: 'pf-num', render: function (r) {
                        var fq = facts.filter(function (x) { return x.shift === r.shift; })[0];
                        return fq ? fq.defects : '—';
                    }},
                    {title: 'Простой, мин', cls: 'pf-num', render: function (r) {
                        var fq = facts.filter(function (x) { return x.shift === r.shift; })[0];
                        return fq ? fq.downtime_min : '—';
                    }},
                    {title: 'Мастер', render: function (r) {
                        var fq = facts.filter(function (x) { return x.shift === r.shift; })[0];
                        return fq ? fq.master : '—';
                    }},
                    {title: '', render: function (r) {
                        if (!canFact) return '';
                        var fq = facts.filter(function (x) { return x.shift === r.shift; })[0];
                        return el('button', {
                            class: 'pf-btn', text: fq ? 'Правка итогов' : 'Внести итоги',
                            onclick: function (e) { e.stopPropagation(); factForm(p, fq || null); }
                        });
                    }}
                ], rows, {
                    empty: 'Плановых показателей нет',
                    onRow: canPlan ? function (r) { rowForm(p, r); } : null
                })
            ]);
            root.appendChild(body);
        });
    }

    function kpi(value, label, kind) {
        return el('div', {class: 'pf-kpi' + (kind ? ' pf-kpi--' + kind : '')}, [
            el('div', {class: 'pf-kpi__val', text: String(value)}),
            el('div', {class: 'pf-kpi__label', text: label})
        ]);
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
