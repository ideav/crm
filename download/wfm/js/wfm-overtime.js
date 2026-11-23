/* WFM: Сверхурочные и нормы. Часы сотрудника против нормы учётного периода; внутри периода - прогноз сверхурочных. */
(function () {
    'use strict';
    var W = window.Wfm, C = W.core, S = { tab: 'month', month: '2026-11' }, D = {};
    var MONTHS = [['2026-10', 'Октябрь 2026'], ['2026-11', 'Ноябрь 2026']];

    function reducedDates(emp, a, b) { return D.F.recs.filter(function (x) { return x.emp === emp && x.reduces && x.date >= a && x.date <= b; }).map(function (x) { return x.date; }); }
    function empsOf(modePrefix) {
        var mode = {}; D.M.depts.forEach(function (d) { mode[d['Подразделение']] = d['Режим учёта']; });
        return Object.keys(D.M.emps).sort().filter(function (e) { return (mode[D.M.emps[e]['Подразделение']] || '').indexOf(modePrefix) === 0; });
    }
    function monthRows() {
        var rg = W.monthRange(S.month), out = [];
        empsOf('Сменный').forEach(function (e) {
            var em = D.M.emps[e], mine = D.F.recs.filter(function (x) { return x.emp === e && x.date >= rg[0] && x.date <= rg[1]; });
            if (!mine.length) return;
            var fact = mine.reduce(function (s, x) { return s + x.fact; }, 0), rate = C.num(em['Ставка']) || 1;
            var norm = C.normHours(D.cal, rg[0], rg[1], rate, reducedDates(e, rg[0], rg[1]));
            out.push({ fio: em['ФИО'], dept: em['Подразделение'], rate: rate, fact: C.round2(fact), norm: C.round2(norm), over: Math.max(0, C.round2(fact - norm)) });
        });
        return out.sort(function (a, b) { return b.over - a.over; });
    }
    function quarterRows() {
        var out = [], lastDay = '2026-11-30';
        empsOf('Суммированный, квартал').forEach(function (e) {
            var em = D.M.emps[e], rate = C.num(em['Ставка']) || 1, mine = D.F.recs.filter(function (x) { return x.emp === e; });
            var acc = mine.reduce(function (s, x) { return s + x.fact; }, 0), red = reducedDates(e, '2026-10-01', lastDay);
            var normTd = C.normHours(D.cal, '2026-10-01', W.FACT_DAY, rate, red), normEnd = C.normHours(D.cal, '2026-10-01', lastDay, rate, red);
            var plan = D.M.shifts.filter(function (s) { return s.emp === e && s.date > W.FACT_DAY && s.date <= lastDay; }).reduce(function (s, x) { return s + x.hours; }, 0);
            out.push({ fio: em['ФИО'], acc: C.round2(acc), normTd: C.round2(normTd), ahead: C.round2(acc - normTd), plan: C.round2(plan), forecast: C.round2(acc + plan), normEnd: C.round2(normEnd), over: Math.max(0, C.round2(acc + plan - normEnd)) });
        });
        return out.sort(function (a, b) { return b.acc - a.acc; });
    }
    function vahtaRows() {
        var out = [];
        Object.keys(D.M.emps).sort().forEach(function (e) {
            var em = D.M.emps[e]; if (!em['Бригада']) return;
            var vs = D.vahtas.filter(function (v) { return v['Бригада'] === em['Бригада']; }), hrs = vs.length ? C.num(vs[0]['Часов в день по плану']) : 12;
            var st = W.vahtaStats(em, D.F.recs, vs.map(function (v) { return { start: C.toIso(v['Прибытие на объект']), end: C.toIso(v['Убытие с объекта']), status: v['Статус вахты'] }; }), D.cal, D.M.rules, hrs, W.FACT_DAY);
            out.push({ fio: em['ФИО'], brig: em['Бригада'], acc: C.round2(st.acc), norm: C.round2(st.norm), ahead: C.round2(st.ahead), forecast: C.round2(st.forecast), over: C.round2(st.overtime) });
        });
        return out;
    }
    function render(host) {
        host.innerHTML = '';
        host.appendChild(W.el('h1', { text: 'Сверхурочные и нормы' }));
        host.appendChild(W.el('p', { 'class': 'wfm-sub', text: 'Сверхурочные - часы сверх нормы учётного периода (ст. 99 ТК РФ). Внутри суммированного периода показываем опережение нормы и прогноз сверхурочных.' }));
        var tabs = [['month', 'Сменный учёт, месяц'], ['quarter', 'Суммированный, квартал']]; if (D.vahtas.length) tabs.push(['vahta', 'Вахта, год']);
        host.appendChild(W.tabs(tabs, S.tab, function (t) { S.tab = t; render(host); }));
        if (S.tab === 'month') {
            var sel = W.select(MONTHS, S.month); sel.onchange = function () { S.month = sel.value; render(host); };
            host.appendChild(W.el('div', { 'class': 'wfm-bar' }, [W.field('Месяц', sel)]));
            host.appendChild(W.table([{ k: 'fio', t: 'Сотрудник' }, { k: 'dept', t: 'Подразделение' }, { k: 'rate', t: 'Ставка', num: 1 }, { k: 'fact', t: 'Факт, ч', num: 1 }, { k: 'norm', t: 'Норма, ч', num: 1 }, { k: 'over', t: 'Сверхурочные, ч', num: 1 }], monthRows(), { rowCls: function (r) { return r.over > 0 ? 'wfm-row-warn' : ''; } }));
        } else if (S.tab === 'quarter') {
            host.appendChild(W.el('p', { 'class': 'wfm-sub', text: 'Накоплено с 01.10.2026 по ' + C.toDmy(W.FACT_DAY) + ' против нормы на дату; прогноз - факт плюс плановые смены до конца графика (30.11.2026).' }));
            host.appendChild(W.table([{ k: 'fio', t: 'Сотрудник' }, { k: 'acc', t: 'Накоплено, ч', num: 1 }, { k: 'normTd', t: 'Норма на дату, ч', num: 1 }, { k: 'ahead', t: 'Опережение, ч', num: 1 }, { k: 'plan', t: 'План до 30.11, ч', num: 1 },
                { k: 'forecast', t: 'Прогноз, ч', num: 1 }, { k: 'normEnd', t: 'Норма до 30.11, ч', num: 1 }, { k: 'over', t: 'Прогноз сверхурочных, ч', num: 1 }], quarterRows(), { rowCls: function (r) { return r.over > 0 ? 'wfm-row-warn' : ''; } }));
        } else {
            host.appendChild(W.el('p', { 'class': 'wfm-sub', text: 'Учётный период - год. Норма года ' + W.right(D.M.rules.yearNorm) + ' ч. Опережение на дату не является сверхурочными: они считаются по итогам года, здесь - прогноз на 31.12.2026.' }));
            host.appendChild(W.table([{ k: 'fio', t: 'Сотрудник' }, { k: 'brig', t: 'Бригада' }, { k: 'acc', t: 'Накоплено на ' + C.toDmy(W.FACT_DAY) + ', ч', num: 1 }, { k: 'norm', t: 'Норма на дату, ч', num: 1 }, { k: 'ahead', t: 'Опережение, ч', num: 1 },
                { k: 'forecast', t: 'Прогноз на 31.12, ч', num: 1 }, { k: 'over', t: 'Прогноз сверхурочных, ч', num: 1 }], vahtaRows(), { rowCls: function (r) { return r.over > 0 ? 'wfm-row-warn' : ''; } }));
        }
    }
    W.mount(function (host) {
        return Promise.all([W.loadSchedule(), W.loadFacts(), W.rows('Календарь'), W.rows('Вахта').catch(function () { return []; })]).then(function (r) {
            D.M = r[0]; D.F = r[1]; D.cal = W.calendar(r[2]); D.vahtas = r[3];
            if (!W.canRead('Вахта') || !D.vahtas.length) D.vahtas = [];
            render(host);
        });
    });
})();
