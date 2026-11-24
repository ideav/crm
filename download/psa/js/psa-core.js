/* PSA: чистые функции расчёта (даты, ёмкость по календарю, загрузка, проверка брони, подбор, утилизация, маржа). Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PsaCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var DAY = 86400000;
    var DEFAULT_RULES = { limit: 100, overbook: 110, overbookWeeks: 2, softDays: 14, utilTarget: 80, marginMin: 20, dayHours: 8 };
    var GRADES = ['junior', 'middle', 'senior', 'lead'];

    function utc(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
    function iso(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
    function addDays(s, n) { return iso(utc(s) + n * DAY); }
    function diffDays(a, b) { return Math.round((utc(b) - utc(a)) / DAY); }
    /* 'ДД.ММ.ГГГГ' или 'ГГГГ-ММ-ДД' -> 'ГГГГ-ММ-ДД'; пусто -> '' */
    function toIso(v) {
        if (!v) return '';
        var m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v);
        return m ? m[3] + '-' + m[2] + '-' + m[1] : String(v).slice(0, 10);
    }
    function toDmy(s) { return s ? s.split('-').reverse().join('.') : ''; }
    function toShort(s) { return s ? s.slice(8, 10) + '.' + s.slice(5, 7) : ''; }
    function num(v) { var n = parseFloat(String(v === undefined || v === null ? '' : v).replace(',', '.')); return isNaN(n) ? 0 : n; }
    function round1(x) { return Math.round(x * 10) / 10; }
    function round2(x) { return Math.round(x * 100) / 100; }
    /* день недели: 1 = понедельник ... 7 = воскресенье */
    function dow(s) { var d = new Date(utc(s)).getUTCDay(); return d === 0 ? 7 : d; }
    function weekStart(s) { return addDays(s, 1 - dow(s)); }
    function weeksFrom(start, n) { var r = [], w = weekStart(start); for (var i = 0; i < n; i++) { r.push(w); w = addDays(w, 7); } return r; }
    function weeksBetween(a, b) { var r = [], w = weekStart(a), last = weekStart(b); while (w <= last) { r.push(w); w = addDays(w, 7); } return r; }
    function weekDays(w) { return [0, 1, 2, 3, 4].map(function (i) { return addDays(w, i); }); }

    /* Рабочие часы календарного дня: выходной = 0, праздник/предпраздничный берутся из карты hol {дата: часы}. */
    function dayHours(d, hol, base) {
        if (dow(d) > 5) return 0;
        if (hol && hol[d] !== undefined) return hol[d];
        return base === undefined ? 8 : base;
    }
    function inAbsence(d, abs) {
        for (var i = 0; i < (abs || []).length; i++) if (d >= abs[i].from && d <= abs[i].to) return abs[i];
        return null;
    }
    /* Ёмкость сотрудника на неделю в часах: рабочие дни недели x ставка, минус отпуск и больничный. */
    function capacityWeek(emp, w, hol, abs) {
        var base = 0, cap = 0, off = 0;
        weekDays(w).forEach(function (d) {
            var h = dayHours(d, hol) * emp.fte;
            base += h;
            if (inAbsence(d, abs)) off += h; else cap += h;
        });
        return { base: round2(base), cap: round2(cap), absent: round2(off) };
    }
    /* Часы брони в неделе: часов в неделю x (рабочие часы дней недели внутри срока брони / 40). */
    function bookingHoursWeek(b, w, hol) {
        var inside = 0;
        weekDays(w).forEach(function (d) { if (d >= b.from && d <= b.to) inside += dayHours(d, hol); });
        return round2(b.hpw * inside / 40);
    }
    var ACTIVE = { 'Подтверждена': 1, 'Запрошена': 1 };
    function isActive(b, includePending) {
        if (b.status === 'Подтверждена') return true;
        return !!includePending && b.status === 'Запрошена';
    }
    /* Загрузка недели: план из броней, ёмкость, процент и разложение по проектам. */
    function loadWeek(emp, w, bookings, hol, abs, opts) {
        opts = opts || {};
        var c = capacityWeek(emp, w, hol, abs), plan = 0, items = [];
        bookings.forEach(function (b) {
            if (b.emp !== emp.name || !isActive(b, opts.pending !== false)) return;
            var h = bookingHoursWeek(b, w, hol);
            if (h > 0) { plan += h; items.push({ id: b.id, project: b.project, hours: h, kind: b.kind, status: b.status }); }
        });
        plan = round2(plan);
        var pct = c.cap > 0 ? round1(plan / c.cap * 100) : (plan > 0 ? 999 : null);
        return { week: w, plan: plan, cap: c.cap, base: c.base, absent: c.absent, pct: pct, items: items, free: Math.max(0, round2(c.cap - plan)) };
    }
    /* Класс ячейки тепловой карты. */
    function loadClass(l, rules) {
        rules = rules || DEFAULT_RULES;
        if (l.base === 0) return 'holiday';
        if (l.cap === 0) return l.plan > 0 ? 'crit' : 'away';
        if (l.pct > rules.overbook) return 'crit';
        if (l.pct > rules.limit) return 'warn';
        if (l.pct >= 90) return 'high';
        if (l.pct >= 50) return 'ok';
        return 'free';
    }
    /* Проверка брони при вводе: ошибки блокируют, предупреждения нет. existing - все брони, newB - новая или изменённая. */
    function checkBooking(emp, newB, existing, hol, abs, rules) {
        rules = rules || DEFAULT_RULES;
        var list = existing.filter(function (b) { return b.id !== newB.id; }).concat([newB]);
        var errors = [], warnings = [], weeks = [], streak = 0, maxStreak = 0, worst = null;
        weeksBetween(newB.from, newB.to).forEach(function (w) {
            var l = loadWeek(emp, w, list, hol, abs, { pending: true });
            weeks.push(l);
            if (l.base === 0) return;
            if (l.cap === 0) return; /* сотрудник отсутствует всю неделю: предупреждение ниже, в перегрузку не считается */
            if (l.pct !== null && l.pct > rules.limit) { streak++; if (streak > maxStreak) maxStreak = streak; } else streak = 0;
            if (l.pct !== null && (!worst || l.pct > worst.pct)) worst = l;
            if (newB.kind === 'Жёсткая') {
                var hard = list.filter(function (b) { return b.kind === 'Жёсткая'; });
                var lh = loadWeek(emp, w, hard, hol, abs, { pending: true });
                if (lh.pct !== null && lh.pct > rules.limit) errors.push('Жёсткие брони на неделе ' + toShort(w) + ' занимают ' + Math.round(lh.pct) + '% ёмкости: вторая жёсткая бронь сверх 100% запрещена');
            }
        });
        if (worst && worst.pct > rules.overbook) errors.push('Перегрузка ' + Math.round(worst.pct) + '% на неделе ' + toShort(worst.week) + ' выше допустимых ' + rules.overbook + '%');
        else if (worst && worst.pct > rules.limit) warnings.push('Загрузка ' + Math.round(worst.pct) + '% на неделе ' + toShort(worst.week) + ': выше 100%, допустимый овербукинг до ' + rules.overbook + '%');
        if (maxStreak > rules.overbookWeeks) errors.push('Загрузка выше 100% дольше ' + rules.overbookWeeks + ' недель подряд (' + maxStreak + ')');
        weeks.forEach(function (l) { if (l.cap === 0 && l.base > 0 && newB.hpw > 0 && bookingHoursWeek(newB, l.week, hol) > 0) warnings.push('Неделя ' + toShort(l.week) + ': сотрудник в отпуске или на больничном'); });
        return { errors: errors, warnings: warnings, weeks: weeks, ok: errors.length === 0 };
    }
    /* Статус перегрузки сотрудника на горизонте: список недель выше лимита. */
    function overloadWeeks(emp, weeks, bookings, hol, abs, rules) {
        rules = rules || DEFAULT_RULES;
        return weeks.map(function (w) { return loadWeek(emp, w, bookings, hol, abs, { pending: true }); })
            .filter(function (l) { return l.base > 0 && (l.cap === 0 ? l.plan > 0 : l.pct > rules.limit); });
    }
    function gradeRank(g) { var i = GRADES.indexOf(g); return i < 0 ? 0 : i + 1; }
    /* Подбор: кто обладает навыком на уровне >= minLevel, грейд >= minGrade и свободен на период на hpw часов в неделю. */
    function findCandidates(emps, skills, bookings, hol, absences, q) {
        var res = [], weeks = weeksBetween(q.from, q.to);
        emps.forEach(function (e) {
            if (q.pool && e.pool !== q.pool) return;
            if (q.minGrade && gradeRank(e.grade) < gradeRank(q.minGrade)) return;
            var lvl = 0;
            if (q.skill) {
                (skills[e.name] || []).forEach(function (s) { if (s.skill === q.skill) lvl = s.level; });
                if (lvl < (q.minLevel || 1)) return;
            }
            var abs = absences[e.name] || [], freeSum = 0, minFree = Infinity, n = 0, absentDays = 0, ok = true;
            weeks.forEach(function (w) {
                var l = loadWeek(e, w, bookings, hol, abs, { pending: true });
                if (l.base === 0) return;
                if (l.cap === 0) { absentDays += 5; return; }
                if (l.absent > 0) absentDays += Math.round(l.absent / (l.base / 5 || 1));
                var need = q.hpw * l.cap / l.base;
                n++; freeSum += l.free / (l.cap / l.base); var fr = l.free / (l.cap / l.base);
                if (fr < minFree) minFree = fr;
                if (l.free < need - 0.01) ok = false;
            });
            var avg = n ? round1(freeSum / n) : 0;
            res.push({ emp: e, level: lvl, grade: e.grade, avgFree: avg, minFree: n ? round1(minFree) : 0, fits: n > 0 && ok, avgFits: n > 0 && avg >= q.hpw, absentDays: absentDays });
        });
        res.sort(function (a, b) {
            if (a.fits !== b.fits) return a.fits ? -1 : 1;
            if (a.avgFits !== b.avgFits) return a.avgFits ? -1 : 1;
            if (b.level !== a.level) return b.level - a.level;
            return b.avgFree - a.avgFree;
        });
        return res;
    }
    /* План-факт по сотруднику и неделе: план из броней (подтверждённых), факт из таймшитов. */
    function planFact(emp, w, bookings, timesheets, hol) {
        var plan = 0, fact = 0;
        bookings.forEach(function (b) { if (b.emp === emp.name && b.status === 'Подтверждена') plan += bookingHoursWeek(b, w, hol); });
        timesheets.forEach(function (t) { if (t.emp === emp.name && t.week === w) fact += t.hours; });
        return { plan: round2(plan), fact: round2(fact), diff: round2(fact - plan) };
    }
    /* Утилизация: оплачиваемые часы (проекты не-внутренние) / ёмкость; общая = все списанные / ёмкость. */
    function utilization(emps, weeks, timesheets, projects, hol, absences) {
        var cap = 0, bill = 0, all = 0, byProj = {};
        projects.forEach(function (p) { byProj[p.name] = p; });
        emps.forEach(function (e) { weeks.forEach(function (w) { cap += capacityWeek(e, w, hol, absences[e.name] || []).cap; }); });
        var inW = {}, inE = {};
        weeks.forEach(function (w) { inW[w] = 1; }); emps.forEach(function (e) { inE[e.name] = 1; });
        timesheets.forEach(function (t) {
            if (!inW[t.week] || !inE[t.emp]) return;
            all += t.hours;
            var p = byProj[t.project];
            if (p && p.contract !== 'Внутренний') bill += t.hours;
        });
        return { cap: round1(cap), billable: round1(bill), total: round1(all), billablePct: cap ? round1(bill / cap * 100) : 0, totalPct: cap ? round1(all / cap * 100) : 0 };
    }
    /* Бенч на неделю: свободная ёмкость (ч), FTE и стоимость по себестоимости. */
    function bench(emps, w, bookings, hol, absences) {
        var free = 0, cost = 0, people = [];
        emps.forEach(function (e) {
            var l = loadWeek(e, w, bookings, hol, absences[e.name] || [], { pending: false });
            if (l.base === 0) return;
            free += l.free; cost += l.free * e.cost;
            if (l.cap > 0 && l.pct < 50) people.push(e.name);
        });
        return { free: round1(free), fte: round1(free / 40), cost: Math.round(cost), people: people };
    }
    function sellRate(rates, project, grade) { var r = rates[project + '|' + grade]; return r === undefined ? 0 : r; }
    /* Экономика проекта. p: {name, contract, price, budgetHours, ready, from, to}; facts - таймшиты; bookings - брони (остаток плана с недели today). */
    function projectMargin(p, emps, rates, timesheets, bookings, hol, today) {
        var byEmp = {}; emps.forEach(function (e) { byEmp[e.name] = e; });
        var factH = 0, factCost = 0, tmRev = 0, rows = {};
        timesheets.forEach(function (t) {
            if (t.project !== p.name) return;
            var e = byEmp[t.emp]; if (!e) return;
            factH += t.hours; factCost += t.hours * e.cost; tmRev += t.hours * sellRate(rates, p.name, e.grade);
            var r = rows[e.name] || (rows[e.name] = { emp: e.name, grade: e.grade, hours: 0, cost: 0, rev: 0 });
            r.hours += t.hours; r.cost += t.hours * e.cost; r.rev += t.hours * sellRate(rates, p.name, e.grade);
        });
        var cur = weekStart(today), remH = 0, remCost = 0, remRev = 0, end = p.to;
        bookings.forEach(function (b) {
            if (b.project !== p.name || b.status !== 'Подтверждена' || !byEmp[b.emp]) return;
            weeksBetween(cur, b.to < end ? b.to : end).forEach(function (w) {
                if (w < cur) return;
                var h = bookingHoursWeek(b, w, hol);
                remH += h; remCost += h * byEmp[b.emp].cost; remRev += h * sellRate(rates, p.name, byEmp[b.emp].grade);
            });
        });
        var revFact, revPlan;
        if (p.contract === 'T&M') { revFact = tmRev; revPlan = tmRev + remRev; }
        else if (p.contract === 'Внутренний') { revFact = 0; revPlan = 0; }
        else if (p.contract === 'Поддержка') {
            var total = Math.max(1, diffDays(p.from, p.to)), done = Math.min(total, Math.max(0, diffDays(p.from, today)));
            revFact = p.price * done / total; revPlan = p.price;
        } else { revFact = p.price * p.ready / 100; revPlan = p.price; }
        var costPlan = factCost + remCost;
        var out = {
            project: p.name, contract: p.contract, factHours: round1(factH), forecastHours: round1(factH + remH), budgetHours: p.budgetHours,
            revFact: Math.round(revFact), costFact: Math.round(factCost), marginFact: Math.round(revFact - factCost), marginFactPct: revFact > 0 ? round1((revFact - factCost) / revFact * 100) : null,
            revPlan: Math.round(revPlan), costPlan: Math.round(costPlan), marginPlan: Math.round(revPlan - costPlan), marginPlanPct: revPlan > 0 ? round1((revPlan - costPlan) / revPlan * 100) : null,
            overrunPct: p.budgetHours ? round1(((factH + remH) / p.budgetHours - 1) * 100) : 0,
            people: Object.keys(rows).map(function (k) { var r = rows[k]; r.margin = Math.round(r.rev - r.cost); r.hours = round1(r.hours); return r; }).sort(function (a, b) { return b.hours - a.hours; })
        };
        return out;
    }
    function toCsv(rows, cols) {
        function q(v) { v = String(v === undefined || v === null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
        return [cols.map(function (c) { return q(c[1]); }).join(';')].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c[0]]); }).join(';'); })).join('\n');
    }
    return {
        DEFAULT_RULES: DEFAULT_RULES, GRADES: GRADES, utc: utc, iso: iso, addDays: addDays, diffDays: diffDays, toIso: toIso, toDmy: toDmy, toShort: toShort, num: num, round1: round1, round2: round2,
        dow: dow, weekStart: weekStart, weeksFrom: weeksFrom, weeksBetween: weeksBetween, weekDays: weekDays, dayHours: dayHours, capacityWeek: capacityWeek,
        bookingHoursWeek: bookingHoursWeek, loadWeek: loadWeek, loadClass: loadClass, checkBooking: checkBooking, overloadWeeks: overloadWeeks, gradeRank: gradeRank,
        findCandidates: findCandidates, planFact: planFact, utilization: utilization, bench: bench, projectMargin: projectMargin, sellRate: sellRate, toCsv: toCsv
    };
});
