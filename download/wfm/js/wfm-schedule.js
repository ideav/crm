/* WFM: График магазина. Сетка «сотрудник x дни месяца», проверки ТК пересчитываются сразу при правке смены. */
(function () {
    'use strict';
    var W = window.Wfm, C = W.core, S = { dept: '', month: '2026-11' }, M, CAL = {};
    var MONTHS = [['2026-10', 'Октябрь 2026'], ['2026-11', 'Ноябрь 2026'], ['2026-12', 'Декабрь 2026']];

    function hash() { var h = {}; location.hash.slice(1).split('&').forEach(function (p) { var kv = p.split('='); if (kv[0]) h[kv[0]] = decodeURIComponent(kv[1] || ''); }); return h; }
    function graphOf() { return M.graphs.filter(function (g) { return g['Подразделение'] === S.dept && C.toIso(g['Период']).slice(0, 7) === S.month; })[0]; }
    function shiftClass(s) { return s.night > 0 ? 'wfm-s-night' : (s.hours <= 4 ? 'wfm-s-short' : 'wfm-s-day'); }
    function key(v) { return v.emp + '|' + v.date; }

    function tplFields(t) { return { 'Шаблон смены': t['Шаблон смены'], 'Начало смены': t['Начало смены'], 'Конец смены': t['Конец смены'], 'Часы план': t['Оплачиваемых часов'], 'Ночные план': t['Ночных часов'] }; }
    function applyLocal(s, t) { s.tpl = t['Шаблон смены']; s.start = t['Начало смены']; s.end = t['Конец смены']; s.hours = C.num(t['Оплачиваемых часов']); s.night = C.num(t['Ночных часов']); }

    function editCell(emp, date, existing, host) {
        var opts = [['', '- нет смены -']].concat(M.tpls.map(function (t) { return [t['Шаблон смены'], t['Шаблон смены'] + ' (' + t['Начало смены'] + '-' + t['Конец смены'] + ', ' + W.right(t['Оплачиваемых часов']) + ' ч)']; }));
        var sel = W.select(opts, existing ? existing.tpl : '');
        var body = W.el('div', {}, [W.el('p', { text: M.emps[emp]['ФИО'] + ', ' + C.toDmy(date) }), W.field('Шаблон смены', sel)]);
        W.modal('Смена', body, [{ text: 'Отмена' }, { text: 'Сохранить', cls: 'wfm-primary', keep: true, fn: function (close) { save(emp, date, existing, sel.value, host).then(close); return false; } }]);
    }
    function save(emp, date, existing, tplName, host) {
        var t = M.tplBy[tplName], g = graphOf();
        var p;
        if (existing && !tplName) p = W.post('_m_del/' + existing.id + '?JSON', {}).then(function () { M.shifts = M.shifts.filter(function (x) { return x !== existing; }); });
        else if (existing) p = W.post('_m_set/' + existing.id + '?JSON', { fields: tplFields(t) }).then(function () { applyLocal(existing, t); });
        else if (tplName) {
            var f = tplFields(t); f['Смена'] = date; f['График'] = g['График']; f['Сотрудник'] = emp; f['Статус смены'] = 'Запланирована';
            p = W.post('_m_new/' + W.tid('Смена') + '?JSON', { up: 1, fields: f }).then(function (r) {
                var s = { id: String(r.id || r.obj), emp: emp, date: date, graph: g['График'], status: 'Запланирована', dept: S.dept }; applyLocal(s, t); M.shifts.push(s);
            });
        } else p = Promise.resolve();
        return p.then(function () { W.toast('Сохранено'); render(host); }).catch(function (e) { W.toast(e.message, true); });
    }
    function addShift(host) {
        var emps = Object.keys(M.emps).filter(function (e) { return M.emps[e]['Подразделение'] === S.dept; });
        var se = W.select(emps.map(function (e) { return [e, M.emps[e]['ФИО']]; })), dt = W.el('input', { type: 'date', value: S.month + '-01' });
        var st = W.select(M.tpls.map(function (t) { return t['Шаблон смены']; }));
        W.modal('Добавить смену', W.el('div', {}, [W.field('Сотрудник', se), W.field('Дата', dt), W.field('Шаблон смены', st)]), [{ text: 'Отмена' }, { text: 'Добавить', cls: 'wfm-primary', keep: true, fn: function (close) {
            var ex = M.shifts.filter(function (s) { return s.emp === se.value && s.date === dt.value; })[0];
            if (!dt.value || dt.value.slice(0, 7) !== S.month) { W.toast('Дата должна быть в месяце графика', true); return false; }
            save(se.value, dt.value, ex, st.value, host).then(close); return false; } }]);
    }
    function publish(host) {
        var g = graphOf();
        W.post('_m_set/' + g._id + '?JSON', { fields: { 'Статус графика': 'Опубликован', 'Опубликован': W.TODAY } }).then(function () {
            g['Статус графика'] = 'Опубликован'; g['Опубликован'] = C.toDmy(W.TODAY); W.toast('График опубликован'); render(host);
        }).catch(function (e) { W.toast(e.message, true); });
    }

    function render(host) {
        host.innerHTML = '';
        var depts = W.pickDept(M), g = graphOf(), rg = W.monthRange(S.month), days = C.eachDay(rg[0], rg[1]);
        var viol = W.violations(M, S.dept, S.month), bad = {}, covDay = {};
        viol.forEach(function (v) { if (v.type === 'coverage') covDay[v.date] = v; else { bad[key(v)] = v; if (v.type === 'rest') bad[v.emp + '|' + v.from] = v; } });
        var bar = W.el('div', { 'class': 'wfm-bar' }, [
            W.field('Подразделение', (function () { var s = W.select(depts, S.dept); s.onchange = function () { S.dept = s.value; render(host); }; return s; })()),
            W.field('Месяц', (function () { var s = W.select(MONTHS, S.month); s.onchange = function () { S.month = s.value; render(host); }; return s; })()),
            g ? W.el('span', { html: 'Статус: ' + W.badge(g['Статус графика'], g['Статус графика'] === 'Опубликован' ? 'ok' : 'warn') }) : W.el('span', { text: 'График на месяц не создан' }),
            W.canWrite('Смена') && g ? W.btn('Добавить смену', function () { addShift(host); }) : null,
            W.canWrite('График') && g && g['Статус графика'] !== 'Опубликован' ? W.btn('Опубликовать', function () { publish(host); }, 'wfm-primary') : null
        ]);
        host.appendChild(W.el('h1', { text: 'График смен' }));
        host.appendChild(W.el('p', { 'class': 'wfm-sub', text: 'Красным подсвечены нарушения: отдых между сменами, серия без недельного отдыха, ночь при ограничении. Правила берутся из справочника «Правило».' }));
        host.appendChild(bar);
        var emps = Object.keys(M.emps).filter(function (e) { return M.emps[e]['Подразделение'] === S.dept; }).sort();
        var byEmpDate = {}; M.shifts.forEach(function (s) { if (s.dept === S.dept) byEmpDate[s.emp + '|' + s.date] = s; });
        var editable = W.canWrite('Смена') && !!g;
        var head = W.el('tr', {}, [W.el('th', { text: 'Сотрудник' })].concat(days.map(function (d) {
            var wd = new Date(C.utc(d)).getUTCDay(), th = W.el('th', { text: d.slice(8), title: C.toDmy(d) + (covDay[d] ? ': покрытие ' + covDay[d].count + ' из ' + covDay[d].min : '') });
            if (wd === 0 || wd === 6) th.className = 'wfm-off'; if (covDay[d]) th.style.color = 'var(--w-red, #dc2626)'; if (covDay[d]) th.textContent = d.slice(8) + '!';
            return th;
        })).concat([W.el('th', { text: 'Часы / норма' })]));
        var norm = C.normHours(CAL, rg[0], rg[1], 1, []);
        var rows = emps.map(function (e) {
            var tot = 0;
            var tds = days.map(function (d) {
                var s = byEmpDate[e + '|' + d], td = W.el('td', {});
                if (s) tot += s.hours;
                var b = bad[e + '|' + d];
                var cell = W.el('button', { type: 'button', 'class': 'wfm-cell' + (s ? ' ' + shiftClass(s) : '') + (b ? ' wfm-viol' : ''), 'data-emp': e, 'data-date': d,
                    title: s ? s.tpl + ' ' + s.start + '-' + s.end + (b ? ' - ' + W.violationText(M, b) : '') : (editable ? 'Добавить смену' : ''), text: s ? s.tpl.split(' ')[0] : '', disabled: editable ? undefined : 'disabled',
                    onclick: function () { editCell(e, d, s, host); } });
                td.appendChild(cell); return td;
            });
            var rate = C.num(M.emps[e]['Ставка']) || 1;
            return W.el('tr', {}, [W.el('td', { text: M.emps[e]['ФИО'], title: e + ', ' + M.emps[e]['Должность'] })].concat(tds).concat([W.el('td', { text: W.right(tot) + ' / ' + W.right(norm * rate) })]));
        });
        host.appendChild(W.el('div', { 'class': 'wfm-tablewrap' }, [W.el('table', { 'class': 'wfm-grid' }, [W.el('thead', {}, [head]), W.el('tbody', {}, rows)])]));
        host.appendChild(W.el('div', { 'class': 'wfm-legend', html: 'Д, В, У - дневные смены; Н, С - ночные и переходящие; Р - короткая. Норма месяца по производственному календарю: ' + W.right(norm) + ' ч на полную ставку.' }));
        host.appendChild(W.el('h2', { text: 'Нарушения (' + viol.length + ')' }));
        host.appendChild(viol.length ? W.el('ul', { 'class': 'wfm-list wfm-viol-list' }, viol.map(function (v) { return W.el('li', { text: W.violationText(M, v) }); })) : W.el('p', { 'class': 'wfm-sub', text: 'Нарушений нет.' }));
    }
    W.mount(function (host) {
        return Promise.all([W.loadSchedule(), W.rows('Календарь')]).then(function (r) {
            M = r[0]; CAL = W.calendar(r[1]);
            var h = hash(), depts = W.pickDept(M);
            S.dept = depts.indexOf(h.dept) >= 0 ? h.dept : depts[0]; if (h.month) S.month = h.month;
            if (!S.dept) throw new Error('Нет доступных подразделений');
            render(host);
        });
    });
})();
