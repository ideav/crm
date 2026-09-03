/* Рабочее место руководителя: дашборд */
(function () {
    'use strict';
    var root = document.getElementById('pf-dashboard-root');
    if (!root) return;
    var el = PF.el;
    var st = {tasks: [], meas: [], downtime: [], edits: [], plan: [], fact: [], cards: {}, lines: {}};
    // #4840: по умолчанию дашборд открывается периодом на текущую дату (пустой период = весь период)
    var period = {from: PF.isoDate(), to: PF.isoDate()};

    // #4841: быстрые периоды. shiftIso(0) — сегодня, -1 — вчера, 1..2 — «План 2 дня»
    function shiftIso(offset) {
        return PF.isoDate(new Date(PF.serverNow().getTime() + offset * 86400000));
    }
    function periodBtn(label, from, to) {
        var active = period.from === from && period.to === (to || from);
        return el('button', {
            class: 'pf-btn pf-period-btn' + (active ? ' pf-btn--primary' : ''),
            text: label,
            onclick: function () { period.from = from; period.to = to || from; render(); }
        });
    }

    function load() {
        return Promise.all([
            PF.report('pf_tasks'),
            PF.report('pf_meas_kus'), PF.report('pf_meas_pas'), PF.report('pf_meas_vol'),
            PF.report('pf_downtime'), PF.report('pf_edits'),
            PF.report('pf_plan'), PF.report('pf_fact'),
            PF.rows(PF.tid('Карта контроля'))
        ]).then(function (r) {
            st.tasks = r[0].filter(function (t) { return t.task_id && t.task_no; });
            st.meas = [].concat(r[1], r[2], r[3]).filter(function (m) { return m.task_id && m.value !== ''; });
            st.downtime = r[4].filter(function (d) { return d.task_no; });
            st.edits = r[5].filter(function (e) { return e.author; });
            st.plan = r[6].filter(function (x) { return x.plan_name; });
            st.fact = r[7].filter(function (x) { return x.plan_name; });
            var cards = r[8];
            return Promise.all(cards.map(function (c) {
                return PF.children(PF.tid('Строка карты'), c.i).then(function (rows) {
                    var t = PF.table('Строка карты');
                    var ri = 1 + t.reqs.findIndex(function (q) { return q.name === 'Обязателен'; });
                    st.lines[c.r[0]] = rows.filter(function (x) { return x.r[ri] === 'X'; }).length;
                });
            }));
        });
    }

    function inPeriod(dateStr) {
        if (!period.from && !period.to) return true;
        var d = PF.toDate(dateStr);
        if (!d) return true;
        if (period.from && d < new Date(period.from + 'T00:00:00')) return false;
        if (period.to && d > new Date(period.to + 'T23:59:59')) return false;
        return true;
    }

    function tasksInPeriod() {
        return st.tasks.filter(function (t) { return inPeriod(t.date); });
    }

    function isOut(m) {
        var v = PF.num(m.value), min = PF.num(m.norm_min), max = PF.num(m.norm_max);
        if (v === null || min === null || max === null) return false;
        return v < min || v > max;
    }

    function kpi(value, label, hint, kind, onClick) {
        return el('div', {
            class: 'pf-kpi' + (kind ? ' pf-kpi--' + kind : '') + (onClick ? ' pf-kpi--click' : ''),
            onclick: onClick || null
        }, [
            el('div', {class: 'pf-kpi__val', text: String(value)}),
            el('div', {class: 'pf-kpi__label', text: label}),
            hint ? el('div', {class: 'pf-kpi__hint', text: hint}) : null
        ]);
    }

    function barList(items, unitLabel) {
        var max = items.reduce(function (a, b) { return Math.max(a, b.value); }, 0) || 1;
        var box = el('div', {});
        if (!items.length) return el('div', {class: 'pf-empty', text: 'Нет данных'});
        items.forEach(function (it) {
            box.appendChild(el('div', {class: 'pf-inline', style: 'margin-bottom:8px'}, [
                el('div', {style: 'flex:1 1 46%;min-width:0', text: it.name}),
                el('div', {class: 'pf-bar', style: 'flex:1 1 40%'}, [
                    el('div', {class: 'pf-bar__fill' + (it.kind ? ' pf-bar__fill--' + it.kind : ''),
                        style: 'width:' + Math.round(it.value / max * 100) + '%'})
                ]),
                el('div', {style: 'width:88px;text-align:right', text: it.value + (unitLabel || '')})
            ]));
        });
        return box;
    }

    function render() {
        PF.clear(root);
        var tasks = tasksInPeriod();
        var taskIds = {};
        tasks.forEach(function (t) { taskIds[t.task_id] = t; });
        var meas = st.meas.filter(function (m) { return taskIds[m.task_id]; });
        var downtime = st.downtime.filter(function (d) { return taskIds[d.task_id]; });

        // #4841: три кнопки периодов по центру над дашбордом
        root.appendChild(el('div', {class: 'pf-period-nav'}, [
            periodBtn('Вчера', shiftIso(-1)),
            periodBtn('Сегодня', shiftIso(0)),
            periodBtn('План 2 дня', shiftIso(1), shiftIso(2))
        ]));

        root.appendChild(el('div', {class: 'pf-head'}, [
            el('div', {}, [
                el('h1', {text: 'Дашборд производства ПЕТФУД'}),
                el('div', {class: 'pf-head__sub', text: 'Контроль замесов, отклонений, простоев и выполнения плана'})
            ]),
            el('div', {class: 'pf-filters', style: 'margin:0'}, [
                dateInput('Период с', 'from'), dateInput('по', 'to'),
                el('button', {class: 'pf-btn', text: 'Сбросить', onclick: function () { period.from = period.to = ''; render(); }})
            ])
        ]));

        // ---- план/факт выпуска
        var planRows = st.plan.filter(function (p) { return inPeriod(p.date); });
        var factRows = st.fact.filter(function (p) { return inPeriod(p.date); });
        var planTotal = planRows.reduce(function (a, r) { return a + (PF.num(r.plan_ed) || 0); }, 0);
        var factTotal = factRows.reduce(function (a, r) { return a + (PF.num(r.fact_ed) || 0); }, 0);
        var devPct = planTotal ? Math.round((factTotal - planTotal) / planTotal * 100) : 0;

        root.appendChild(el('h2', {text: 'План-факт выпуска продукции'}));
        root.appendChild(el('div', {class: 'pf-grid pf-grid--kpi'}, [
            kpi(PF.money(planTotal), 'Плановый выпуск, ед'),
            kpi(PF.money(factTotal), 'Фактический выпуск, ед', '', 'accent'),
            kpi((devPct > 0 ? '+' : '') + devPct + '%', 'Отклонение план/факт', 'по сменам за период',
                devPct < -5 ? 'danger' : (devPct < 0 ? 'warn' : '')),
            kpi(factRows.reduce(function (a, r) { return a + (PF.num(r.defects) || 0); }, 0), 'Брак, ед', '', 'danger')
        ]));

        // ---- задания по статусам
        var byStatus = {new: 0, in_work: 0, done: 0};
        tasks.forEach(function (t) { if (byStatus[t.status_code] !== undefined) byStatus[t.status_code]++; });
        var batches = {};
        meas.forEach(function (m) { batches[m.batch_id] = true; });
        var batchCount = Object.keys(batches).length;
        var badBatches = {};
        meas.forEach(function (m) { if (isOut(m)) badBatches[m.batch_id] = true; });
        var okShare = batchCount ? Math.round((batchCount - Object.keys(badBatches).length) / batchCount * 100) : 0;

        root.appendChild(el('h2', {text: 'Задания и замесы'}));
        root.appendChild(el('div', {class: 'pf-grid pf-grid--kpi'}, [
            kpi(byStatus.new, 'Новые задания', 'клик — открыть список', '', function () { PF.go('pf-tasks', {status: 'new'}); }),
            kpi(byStatus.in_work, 'В работе', 'клик — открыть список', 'warn', function () { PF.go('pf-tasks', {status: 'in_work'}); }),
            kpi(byStatus.done, 'Выполнено', 'клик — открыть список', 'accent', function () { PF.go('pf-tasks', {status: 'done'}); }),
            kpi(batchCount, 'Замесов проконтролировано', meas.length + ' замеров'),
            kpi(okShare + '%', 'Замесы без отклонений', Object.keys(badBatches).length + ' с отклонением',
                okShare < 90 ? 'warn' : ''),
            kpi(st.edits.length, 'Правок замеров в журнале', 'аудит качества')
        ]));

        // ---- отклонения по показателям
        var byInd = {};
        meas.forEach(function (m) {
            if (!isOut(m)) return;
            byInd[m.indicator] = (byInd[m.indicator] || 0) + 1;
        });
        var indItems = Object.keys(byInd).map(function (k) { return {name: k, value: byInd[k], kind: 'danger'}; })
            .sort(function (a, b) { return b.value - a.value; }).slice(0, 8);

        // ---- простои
        var byEquip = {}, byFail = {};
        downtime.forEach(function (d) {
            var m = PF.num(d.minutes) || 0;
            byEquip[d.equipment] = (byEquip[d.equipment] || 0) + m;
            byFail[d.failure] = (byFail[d.failure] || 0) + m;
        });
        var equipItems = Object.keys(byEquip).map(function (k) { return {name: k, value: byEquip[k], kind: 'warn'}; })
            .sort(function (a, b) { return b.value - a.value; });
        var failItems = Object.keys(byFail).map(function (k) { return {name: k, value: byFail[k], kind: 'warn'}; })
            .sort(function (a, b) { return b.value - a.value; });

        root.appendChild(el('div', {class: 'pf-grid pf-grid--2'}, [
            el('div', {class: 'pf-card'}, [
                el('div', {class: 'pf-card__title', text: 'Топ показателей по отклонениям'}),
                barList(indItems, ' шт')
            ]),
            el('div', {class: 'pf-card'}, [
                el('div', {class: 'pf-card__title', text: 'Простои по оборудованию'}),
                barList(equipItems, ' мин')
            ]),
            el('div', {class: 'pf-card'}, [
                el('div', {class: 'pf-card__title', text: 'Простои по виду поломки'}),
                barList(failItems, ' мин')
            ]),
            el('div', {class: 'pf-card'}, [
                el('div', {class: 'pf-card__title', text: 'Выполнение плана по сменам'}),
                barList(planRows.map(function (p) {
                    var fq = factRows.filter(function (x) { return x.plan_name === p.plan_name && x.shift === p.shift; })[0];
                    var pct = PF.num(p.plan_ed) ? Math.round((PF.num(fq && fq.fact_ed) || 0) / PF.num(p.plan_ed) * 100) : 0;
                    return {name: p.plan_name + ' · ' + p.shift, value: pct, kind: pct < 90 ? 'danger' : ''};
                }), '%')
            ])
        ]));

        // ---- заполненность чек-листов
        var rows = tasks.map(function (t) {
            var req = st.lines[t.card] || 0;
            var bs = {};
            meas.filter(function (m) { return String(m.task_id) === String(t.task_id); })
                .forEach(function (m) {
                    bs[m.batch_id] = bs[m.batch_id] || {};
                    bs[m.batch_id][m.indicator] = true;
                });
            var nb = Object.keys(bs).length;
            var need = req * nb;
            var filled = Object.keys(bs).reduce(function (a, b) { return a + Object.keys(bs[b]).length; }, 0);
            filled = Math.min(filled, need);
            return {task: t, need: need, filled: filled, pct: need ? Math.round(filled / need * 100) : 0, batches: nb};
        }).filter(function (r) { return r.need > 0; }).sort(function (a, b) { return a.pct - b.pct; });

        root.appendChild(el('div', {class: 'pf-card'}, [
            el('div', {class: 'pf-card__title', text: 'Заполненность чек-листов по заданиям'}),
            PF.tableView([
                {title: '№', render: function (r) { return r.task.task_no; }, cls: 'pf-num'},
                {title: 'Дата', render: function (r) { return PF.fmtDate(r.task.date); }},
                {title: 'Смена', render: function (r) { return r.task.shift; }},
                {title: 'Продукт', render: function (r) { return r.task.product; }},
                {title: 'Замесов', render: function (r) { return r.batches; }, cls: 'pf-num'},
                {title: 'Заполнено', render: function (r) { return r.filled + ' из ' + r.need; }, cls: 'pf-num'},
                {title: 'Готовность', render: function (r) {
                    return el('div', {class: 'pf-inline'}, [
                        el('div', {class: 'pf-bar', style: 'width:110px'}, [
                            el('div', {class: 'pf-bar__fill' + (r.pct < 100 ? ' pf-bar__fill--warn' : ''),
                                style: 'width:' + r.pct + '%'})
                        ]),
                        el('span', {text: r.pct + '%'})
                    ]);
                }},
                {title: 'Статус', render: function (r) { return PF.badge(r.task.status, PF.statusKind(r.task.status_code)); }}
            ], rows, {empty: 'Нет заданий за период', onRow: function (r) { PF.go('pf-task', {id: r.task.task_id}); }})
        ]));
    }

    function dateInput(label, key) {
        var i = el('input', {type: 'date', class: 'pf-input', value: period[key],
            onchange: function () { period[key] = i.value; render(); }});
        return el('label', {class: 'pf-field'}, [el('span', {class: 'pf-field__label', text: label}), i]);
    }

    PF.loading(root);
    PF.schema().then(load).then(render).catch(function (e) {
        PF.clear(root).appendChild(el('div', {class: 'pf-card', text: 'Ошибка загрузки дашборда: ' + e.message}));
        PF.error(e);
    });
})();
