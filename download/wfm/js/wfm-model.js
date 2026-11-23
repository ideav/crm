/* WFM: модель графиков (загрузка смен и расчёт нарушений по подразделению и периоду). Нужен wfm-app.js. */
(function () {
    'use strict';
    var W = window.Wfm, C = W.core;

    W.loadSchedule = function () {
        var soft = function (n) { return W.rows(n).catch(function () { return []; }); }; /* графики и смены доступны не всем ролям */
        return Promise.all([W.rows('Подразделение'), W.rows('Сотрудник'), soft('График'), soft('Смена'), W.rows('Шаблон смены'), W.rows('Правило'), W.rows('Статус')]).then(function (r) {
            var emps = W.map(r[1], 'Сотрудник'), m = { depts: r[0], emps: emps, graphs: r[2], tpls: r[4], statuses: r[6], rules: W.rules(r[5]) };
            m.tplBy = W.map(r[4], 'Шаблон смены');
            m.shifts = r[3].map(function (s) {
                var e = emps[s['Сотрудник']];
                return { id: s._id, emp: s['Сотрудник'], date: C.toIso(s['Смена']), start: s['Начало смены'], end: s['Конец смены'], night: C.num(s['Ночные план']),
                    hours: C.num(s['Часы план']), tpl: s['Шаблон смены'], graph: s['График'], status: s['Статус смены'], dept: e ? e['Подразделение'] : '' };
            });
            m.noNight = {}; r[1].forEach(function (e) { if (e['Без ночных']) m.noNight[e['Сотрудник']] = true; });
            return m;
        });
    };
    function monthRange(month) { var a = month + '-01', n = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate(); return [a, month + '-' + ('0' + n).slice(-2)]; }
    W.monthRange = monthRange;
    /* Нарушения подразделения за месяц. Отдых и серии считаются по всем сменам сотрудника (граница месяцев не теряется). */
    W.violations = function (m, dept, month) {
        var rg = monthRange(month), shifts = m.shifts.filter(function (s) { return s.dept === dept; });
        var d = m.depts.filter(function (x) { return x['Подразделение'] === dept; })[0];
        var inM = function (v) { return v.date >= rg[0] && v.date <= rg[1]; };
        var out = C.restViolations(shifts, m.rules.minRest).concat(C.streakViolations(shifts, m.rules.weekRest), C.nightViolations(shifts, m.noNight)).filter(inM);
        var monthShifts = shifts.filter(inM);
        if (monthShifts.length && d) out = out.concat(C.coverageViolations(shifts, C.num(d['Мин. человек в день']), C.eachDay(rg[0], rg[1])));
        return out;
    };
    W.violationText = function (m, v) {
        var e = m.emps[v.emp], n = e ? e['ФИО'] : v.emp;
        if (v.type === 'rest') return n + ': отдых ' + W.right(v.gap) + ' ч при правиле ' + v.min + ' ч (' + C.toDmy(v.from) + ' - ' + C.toDmy(v.date) + ')';
        if (v.type === 'streak') return n + ': ' + v.run + ' смен подряд без недельного отдыха, до ' + C.toDmy(v.date);
        if (v.type === 'night') return n + ': ночная смена при ограничении, ' + C.toDmy(v.date);
        return 'Покрытие ' + C.toDmy(v.date) + ': ' + v.count + ' из ' + v.min + ' человек';
    };
    /* Все записи табелей, к которым есть доступ: [{emp,date,kind,code,plan,fact,night,hol,tabel}] */
    W.loadFacts = function () {
        return Promise.all([W.rows('Табель'), W.rows('Вид времени')]).then(function (r) {
            var code = {}, reduces = {};
            r[1].forEach(function (k) { code[k['Вид времени']] = k['Код']; reduces[k['Вид времени']] = !!k['Уменьшает норму']; });
            return Promise.all(r[0].map(function (t) { return W.rows('Запись табеля', t._id); })).then(function (z) {
                var recs = [];
                z.forEach(function (l, i) {
                    l.forEach(function (x) {
                        recs.push({ emp: x['Сотрудник'], date: C.toIso(x['Запись табеля']), kind: x['Вид времени'], code: code[x['Вид времени']] || '', reduces: !!reduces[x['Вид времени']],
                            plan: C.num(x['Часы план']), fact: C.num(x['Часы факт']), night: C.num(x['Ночные часы']), hol: C.num(x['Праздничные часы']), tabel: r[0][i]['Табель'], id: x._id });
                    });
                });
                return { tabels: r[0], kinds: r[1], recs: recs };
            });
        });
    };
    /* Накопленные часы вахтовика, норма на дату и прогноз на конец года. */
    W.vahtaStats = function (emp, recs, vahtas, cal, rules, cycle, today) {
        var mine = recs.filter(function (x) { return x.emp === emp['Сотрудник']; });
        var fact = mine.reduce(function (s, x) { return s + x.fact; }, 0), acc = C.num(emp['Накоплено часов на 01.10.2026']) + fact;
        var normTd = rules.norm9m + C.normHours(cal, '2026-10-01', today, 1, []);
        var f = C.vahtaForecast(acc, vahtas, today, '2026-12-31', cycle, rules.yearNorm);
        return { fact: fact, acc: acc, norm: normTd, ahead: acc - normTd, forecast: f.total, overtime: f.overtime };
    };
    W.pickDept = function (m, host) { /* подразделения с графиками (магазины) */
        var has = {}; m.graphs.forEach(function (g) { has[g['Подразделение']] = 1; });
        return m.depts.map(function (d) { return d['Подразделение']; }).filter(function (n) { return has[n]; });
    };
})();
