/* KPI: «План и факт» - значения показателей за период и загрузка вставкой из Excel (табельный номер или ФИО, синонимы показателей). */
(function () {
    'use strict';
    var K = window.Kpi, C = K.core;
    var st = { period: 'Ноябрь 2026', dept: 'Отдел продаж' };
    var TAB = String.fromCharCode(9), NL = String.fromCharCode(10);
    function sample() {
        return [['Таб. номер', 'Сотрудник', 'Показатель', 'План', 'Факт'], ['ТН-0101', 'Ковалёв Денис Игоревич', 'Оборот', '6,2', '4,9'], ['', 'ковалев денис игоревич', 'Новые контрагенты', '8', '6'],
            ['ТН-0104', 'Гусев Артём Олегович', 'Выручка', '6', '5,6'], ['', 'Петров Пётр Петрович', 'Выручка', '6', '3,1'], ['ТН-0105', '', 'ПДЗ', '5', 'н/д']].map(function (r) { return r.join(TAB); }).join(NL);
    }
    function load(M, parsed, pname) {
        var b = M.byPeriod[pname], ops = [];
        parsed.rows.forEach(function (r) {
            var ex = b.valRows[r.emp] && b.valRows[r.emp][r.ind], e = M.empBy[r.emp];
            var f = { 'Факт': r.fact, 'Источник загрузки': 'Вставка из Excel ' + K.TODAY };
            if (r.plan !== null) f['План'] = r.plan;
            if (ex) ops.push(K.update(ex._id, f));
            else ops.push(K.create('Значение KPI', Object.assign(f, { 'Значение KPI': pname + ' ' + e.num + ' ' + r.ind, 'Период премии': pname, 'Сотрудник': r.emp, 'Показатель KPI': r.ind, 'План': r.plan === null ? 0 : r.plan, 'Логин сотрудника': e.login, 'Логин руководителя': e.headLogin })));
        });
        return Promise.all(ops).then(function () { return K.log('Загружен факт за ' + pname + ' вставкой из Excel: ' + parsed.rows.length + ' значений' + (parsed.errors.length ? ', отклонено строк: ' + parsed.errors.length : ''), { period: pname }); });
    }
    K.mount(function (host, M) {
        var pname = st.period, b = M.byPeriod[pname], p = K.period(M, pname);
        function rerender() { host.innerHTML = ''; K.render(host, M); }
        host.appendChild(K.el('div', {}, K.head('План и факт', 'Значения показателей за период из 1С, CRM, WMS и файлов руководителей. Вставьте таблицу из Excel: сотрудник ищется по табельному номеру или ФИО (ё/е и регистр не важны), показатель - по названию или синониму. Ошибочные строки не грузятся и показываются списком.')));
        var dsel = K.select(M.depts.map(function (d) { return d.name; }), st.dept); dsel.addEventListener('change', function () { st.dept = dsel.value; rerender(); });
        host.appendChild(K.el('div', { 'class': 'kpi-bar' }, [K.periodPicker(M, pname, function (v) { st.period = v; rerender(); }), K.field('Подразделение', dsel),
            K.el('span', { 'class': 'kpi-muted', text: 'Факт на ' + C.toDmy(p.factAt) + ' · рабочих дней ' + p.passed + ' из ' + p.days })]));
        var emps = M.emps.filter(function (e) { return e.dept === st.dept && b.vals[e.name]; });
        var sc = emps.length ? M.schemes[emps[0].scheme] : null;
        if (sc) {
            var inds = sc.lines.map(function (l) { return l.ind; });
            host.appendChild(K.table([{ t: 'Сотрудник', html: function (e) { return '<b>' + K.esc(e.name) + '</b><br><span class="kpi-muted">' + K.esc(e.num) + '</span>'; } }].concat(inds.map(function (i) {
                return { t: i.name + ', ' + i.unit, num: true, html: function (e) { var v = b.valRows[e.name] && b.valRows[e.name][i.name]; if (!v) return '<span class="kpi-cell-warn">нет</span>';
                    var plan = C.num(v['План']), fact = C.num(v['Факт']), ach = C.achievement(i, plan, fact, 9);
                    var cls = i.kind === C.BLOCK ? (fact > plan ? 'kpi-cell-bad' : '') : (ach === null ? 'kpi-cell-warn' : (ach < sc.threshold / 100 ? 'kpi-cell-bad' : ''));
                    return '<span class="' + cls + '">' + C.fnum(fact) + '</span> <small class="kpi-muted">/ ' + C.fnum(plan) + '</small><br><small class="kpi-muted">' + K.esc(v['Источник загрузки']) + '</small>'; } };
            })), emps));
        }
        if (!K.canWrite('Значение KPI')) return;
        host.appendChild(K.el('h2', { text: 'Загрузка вставкой из Excel' }));
        var ta = K.el('textarea', { rows: 7, style: 'width:100%;font-family:monospace', placeholder: 'Таб. номер | Сотрудник | Показатель | План | Факт - скопируйте строки из Excel и вставьте сюда' });
        var out = K.el('div');
        function preview() {
            out.innerHTML = '';
            var parsed = C.parseFacts(ta.value, M.emps, Object.keys(M.inds).map(function (k) { return M.inds[k]; }));
            if (!parsed.rows.length && !parsed.errors.length) return parsed;
            out.appendChild(K.table([{ t: 'Сотрудник', k: 'emp' }, { t: 'Показатель', k: 'ind' }, { t: 'План', num: true, html: function (r) { return r.plan === null ? '<span class="kpi-muted">не меняется</span>' : C.fnum(r.plan); } },
                { t: 'Факт', num: true, html: function (r) { return C.fnum(r.fact); } }, { t: 'Найден по', k: 'matchedBy' },
                { t: 'Было', num: true, html: function (r) { var v = b.valRows[r.emp] && b.valRows[r.emp][r.ind]; return v ? C.fnum(C.num(v['Факт'])) : '<span class="kpi-muted">новое</span>'; } }], parsed.rows));
            parsed.errors.forEach(function (e) { out.appendChild(K.el('div', { 'class': 'kpi-warnbox kpi-e', text: e })); });
            return parsed;
        }
        ta.addEventListener('input', preview);
        host.appendChild(ta);
        host.appendChild(K.el('div', { 'class': 'kpi-bar' }, [K.btn('Пример вставки', function () { ta.value = sample(); preview(); }),
            K.btn('Загрузить в ' + pname, function () { var parsed = preview(); if (!parsed.rows.length) return K.toast('Нет строк для загрузки', true);
                load(M, parsed, pname).then(function () { K.toast('Загружено значений: ' + parsed.rows.length); K.reload(); }).catch(function (e) { K.toast(e.message, true); }); }, 'kpi-primary')]));
        host.appendChild(out);
    });
})();
