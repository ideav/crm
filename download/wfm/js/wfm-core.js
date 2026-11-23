/* WFM: чистые функции расчёта (даты, смены, нормы, проверки ТК, отпуска). Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.WfmCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var DAY = 86400000;
    function utc(iso) { var p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
    function iso(ms) {
        var d = new Date(ms);
        return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
    }
    function addDays(s, n) { return iso(utc(s) + n * DAY); }
    function diffDays(a, b) { return Math.round((utc(b) - utc(a)) / DAY); }
    /* 'ДД.ММ.ГГГГ' или 'ГГГГ-ММ-ДД' -> 'ГГГГ-ММ-ДД'; пусто -> '' */
    function toIso(v) {
        if (!v) return '';
        var m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v);
        return m ? m[3] + '-' + m[2] + '-' + m[1] : String(v).slice(0, 10);
    }
    function toDmy(s) { return s ? s.split('-').reverse().join('.') : ''; }
    function eachDay(a, b) { var r = [], d = a; while (d <= b) { r.push(d); d = addDays(d, 1); } return r; }
    function hm(s) { var p = String(s).split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
    function num(v) {
        var n = parseFloat(String(v === undefined || v === null || v === '' ? 0 : v).replace(',', '.'));
        return isNaN(n) ? 0 : n;
    }
    function round2(x) { return Math.round(x * 100) / 100; }

    /* Окно смены: конец не позже начала - смена переходит на следующие сутки. */
    function shiftWindow(date, start, end) {
        var s = hm(start), e = hm(end);
        if (e <= s) e += 1440;
        return { start: utc(date) + s * 60000, end: utc(date) + e * 60000 };
    }
    /* Разнесение смены по календарным суткам. Перерыв вычитается из суток, где лежит середина смены. */
    function splitShift(date, start, end, breakMin) {
        var S = hm(start), E = hm(end);
        if (E <= S) E += 1440;
        var mid = (S + E) / 2;
        var segs = E <= 1440 ? [[date, S, E, S, E]] : [[date, S, 1440, S, 1440], [addDays(date, 1), 0, E - 1440, 1440, E]];
        return segs.map(function (g) {
            var a = g[1], b = g[2], len = b - a;
            if (breakMin && g[3] <= mid && mid <= g[4]) len -= breakMin;
            var night = Math.max(0, Math.min(b, 360) - a) + Math.max(0, Math.min(b, 1440) - Math.max(a, 1320));
            return { date: g[0], hours: len / 60, night: night / 60 };
        });
    }
    /* Смены по сотруднику: shifts = [{emp,date,start,end,night}] -> {emp: [... по дате]} */
    function byEmp(shifts) {
        var m = {};
        shifts.forEach(function (s) { (m[s.emp] = m[s.emp] || []).push(s); });
        Object.keys(m).forEach(function (k) {
            m[k].sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
        });
        return m;
    }
    /* Отдых между соседними сменами короче minHours. */
    function restViolations(shifts, minHours) {
        var out = [], m = byEmp(shifts);
        Object.keys(m).forEach(function (emp) {
            var l = m[emp];
            for (var i = 1; i < l.length; i++) {
                var a = shiftWindow(l[i - 1].date, l[i - 1].start, l[i - 1].end);
                var b = shiftWindow(l[i].date, l[i].start, l[i].end);
                var gap = (b.start - a.end) / 3600000;
                if (gap < minHours) out.push({ type: 'rest', emp: emp, date: l[i].date, from: l[i - 1].date, gap: round2(gap), min: minHours });
            }
        });
        return out;
    }
    /* Серия смен подряд: нарушение в день, когда серия достигла limit (7: нет 42-часового недельного отдыха). */
    function streakViolations(shifts, limit) {
        var out = [], m = byEmp(shifts);
        limit = limit || 7;
        Object.keys(m).forEach(function (emp) {
            var run = 0, prev = null;
            m[emp].forEach(function (s) {
                if (prev !== s.date) run = prev && diffDays(prev, s.date) === 1 ? run + 1 : 1;
                if (run === limit && prev !== s.date) out.push({ type: 'streak', emp: emp, date: s.date, run: run });
                prev = s.date;
            });
        });
        return out;
    }
    /* Ночная смена у сотрудника с признаком «Без ночных». noNight: {emp: true}. */
    function nightViolations(shifts, noNight) {
        return shifts.filter(function (s) { return noNight[s.emp] && num(s.night) > 0; })
            .map(function (s) { return { type: 'night', emp: s.emp, date: s.date }; });
    }
    /* Покрытие: число разных сотрудников со сменой в день меньше минимума. */
    function coverageViolations(shifts, minPerDay, dates) {
        var cnt = {}, out = [];
        shifts.forEach(function (s) { (cnt[s.date] = cnt[s.date] || {})[s.emp] = 1; });
        dates.forEach(function (d) {
            var n = cnt[d] ? Object.keys(cnt[d]).length : 0;
            if (n < minPerDay) out.push({ type: 'coverage', date: d, count: n, min: minPerDay });
        });
        return out;
    }
    /* Норма сотрудника за период: «Норма часов» календаря x ставка, без дней, уменьшающих норму (ОТ, Б). */
    function normHours(cal, from, to, rate, reducedDates) {
        var n = 0, red = {};
        (reducedDates || []).forEach(function (d) { red[d] = 1; });
        Object.keys(cal).forEach(function (d) { if (d >= from && d <= to && !red[d]) n += num(cal[d]); });
        return n * (rate || 1);
    }
    /* Вахта: календарные дни вахты, кроме первого и последнего (дни в пути), считаются рабочими. */
    function vahtaWorkDays(start, end, after, yearEnd) {
        var a = start > after ? start : addDays(after, 1), b = end < yearEnd ? end : yearEnd, n = 0;
        eachDay(a, b).forEach(function (d) { if (d !== start && d !== end) n++; });
        return n;
    }
    /* Прогноз на конец года: накоплено + плановые часы будущих вахт, и прогноз сверхурочных к норме года. */
    function vahtaForecast(accumulated, vahtas, today, yearEnd, hoursPerDay, yearNorm) {
        var add = 0;
        vahtas.forEach(function (v) {
            if (v.end > today && v.status !== 'Завершена') add += vahtaWorkDays(v.start, v.end, today, yearEnd) * hoursPerDay;
        });
        return { add: add, total: accumulated + add, overtime: accumulated + add - yearNorm };
    }
    /* Вахты бригады по циклу от опорной вахты: период = дней на объекте + дней отдыха. */
    function vahtaPeriods(anchorStart, onDays, restDays, fromDate, toDate) {
        var step = onDays + restDays, out = [];
        for (var k = Math.floor(diffDays(anchorStart, fromDate) / step) - 1; ; k++) {
            var s = addDays(anchorStart, k * step), e = addDays(s, onDays - 1);
            if (s > toDate) break;
            if (e >= fromDate) out.push({ start: s, end: e });
        }
        return out;
    }
    function nonRejected(rows) { return rows.filter(function (r) { return r.status !== 'Отклонён'; }); }
    function cross(r, a, b) { return !(r.end < a || r.start > b); }
    /* Отпуска. rows: [{emp,start,end,days,status,dept}]. ctx: minPart, limits{dept}, forbidden{dept:[с,по]}, onSite{emp:[{start,end}]} */
    function vacationChecks(rows, ctx) {
        var out = [], act = nonRejected(rows), minPart = ctx.minPart || 14, per = {}, byDept = {};
        act.forEach(function (r) { (per[r.emp] = per[r.emp] || []).push(r); (byDept[r.dept] = byDept[r.dept] || []).push(r); });
        Object.keys(per).forEach(function (emp) {
            var l = per[emp], total = 0, max = 0;
            l.forEach(function (r) { total += r.days; if (r.days > max) max = r.days; });
            if (total >= minPart && max < minPart) out.push({ type: 'minpart', emp: emp, parts: l.map(function (r) { return r.days; }) });
        });
        Object.keys(byDept).forEach(function (dept) {
            var lim = (ctx.limits || {})[dept], cnt = {}, cur = null;
            if (!lim) return;
            byDept[dept].forEach(function (r) { eachDay(r.start, r.end).forEach(function (d) { (cnt[d] = cnt[d] || []).push(r.emp); }); });
            Object.keys(cnt).sort().forEach(function (d) {
                if (cnt[d].length > lim) {
                    if (cur && addDays(cur.to, 1) === d && cur.max === cnt[d].length) cur.to = d;
                    else { cur = { type: 'overlap', dept: dept, from: d, to: d, max: cnt[d].length, limit: lim, emps: cnt[d].slice() }; out.push(cur); }
                } else cur = null;
            });
        });
        act.forEach(function (r) {
            var f = (ctx.forbidden || {})[r.dept], w = (ctx.onSite || {})[r.emp];
            if (f && f[0] && cross(r, f[0], f[1])) out.push({ type: 'forbidden', emp: r.emp, start: r.start, end: r.end, from: f[0], to: f[1] });
            if (w && w.some(function (p) { return cross(r, p.start, p.end); })) out.push({ type: 'onsite', emp: r.emp, start: r.start, end: r.end });
        });
        return out;
    }
    /* Остаток отпуска: положено + перенос - запланировано (без отклонённых). */
    function vacationBalance(entitled, carry, rows) {
        return entitled + carry - nonRejected(rows).reduce(function (s, r) { return s + r.days; }, 0);
    }
    /* Выгрузка для ЗУП по сотруднику и виду времени; виды, уменьшающие норму (ОТ, Б), дают дни, а не часы. */
    function zupRows(records, kinds) {
        var m = {};
        records.forEach(function (r) {
            var k = r.emp + '|' + r.kind, x = m[k] || (m[k] = { emp: r.emp, kind: r.kind, days: 0, hours: 0, night: 0, holiday: 0 });
            x.days++; x.hours += num(r.fact); x.night += num(r.night); x.holiday += num(r.holiday);
        });
        return Object.keys(m).sort().map(function (k) {
            var x = m[k];
            if (kinds && kinds[x.kind] && kinds[x.kind].reduces) { x.hours = 0; x.night = 0; x.holiday = 0; }
            x.hours = round2(x.hours); x.night = round2(x.night); x.holiday = round2(x.holiday);
            return x;
        });
    }
    function toCsv(rows, cols) {
        var esc = function (v) { v = v === undefined || v === null ? '' : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        return cols.map(function (c) { return esc(c[1]); }).join(';') + '\n' +
            rows.map(function (r) { return cols.map(function (c) { return esc(r[c[0]]); }).join(';'); }).join('\n');
    }
    return {
        utc: utc, iso: iso, addDays: addDays, diffDays: diffDays, toIso: toIso, toDmy: toDmy, eachDay: eachDay, hm: hm, num: num, round2: round2,
        shiftWindow: shiftWindow, splitShift: splitShift, restViolations: restViolations, streakViolations: streakViolations,
        nightViolations: nightViolations, coverageViolations: coverageViolations, normHours: normHours, vahtaWorkDays: vahtaWorkDays,
        vahtaForecast: vahtaForecast, vahtaPeriods: vahtaPeriods, vacationChecks: vacationChecks, vacationBalance: vacationBalance,
        zupRows: zupRows, toCsv: toCsv
    };
});
