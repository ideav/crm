/* Адаптация персонала: чистые функции (даты шагов от оффера и выхода, план новичка по маршруту, светофор и причины, испытательный срок, панель «Застряли / Идут / Завершают», проверка маршрута, отчёт по подразделениям). Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.OnboardCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var SERVICE_ROLES = { 'ИТ': 'доступы не выданы', 'АХО': 'рабочее место или пропуск не готовы', 'Служба безопасности': 'проверка СБ не закрыта' };
    var FINAL = { 'Прошёл испытательный': 1, 'Ушёл на испытательном': 1, 'Отказался до выхода': 1 };

    function num(v) { var n = parseFloat(String(v === undefined || v === null ? '' : v).replace(',', '.').replace(/\s/g, '')); return isNaN(n) ? 0 : n; }
    function pad(n) { return ('0' + n).slice(-2); }
    /* Дата - номер дня от 1970-01-01 (UTC), без часовых поясов. */
    function fromIso(s) { var p = s.split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
    function isoOf(d) { var x = new Date(d * 86400000); return x.getUTCFullYear() + '-' + pad(x.getUTCMonth() + 1) + '-' + pad(x.getUTCDate()); }
    /* 'ГГГГ-ММ-ДД', 'ДД.ММ.ГГГГ', 'ГГГГММДД' или epoch-секунды -> номер дня. */
    function parseD(v) {
        if (v === undefined || v === null || v === '') return null;
        var s = String(v).trim(), m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s);
        if (m) return fromIso(m[3] + '-' + m[2] + '-' + m[1]);
        m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
        if (m && s.length <= 19 && !/^\d{9,11}$/.test(s)) return fromIso(m[1] + '-' + m[2] + '-' + m[3]);
        if (/^\d{9,11}$/.test(s)) return Math.floor((num(s) + 3 * 3600) / 86400);
        return null;
    }
    function fmtD(d) { if (d === null || d === undefined) return ''; var s = isoOf(d); return s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4); }
    function fmtDM(d) { return d === null || d === undefined ? '' : fmtD(d).slice(0, 5); }
    function dow(d) { var w = new Date(d * 86400000).getUTCDay(); return w === 0 ? 7 : w; }
    var WD = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
    function wd(d) { return WD[dow(d)]; }
    function plural(n, a, b, c) { var m = Math.abs(n) % 100, k = m % 10; return n + ' ' + (m > 10 && m < 20 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c); }

    /* Срок шага: база - дата оффера или дата выхода, плюс смещение в днях (минус - «до выхода»).
       Срок в выходной: подготовка до выхода сдвигается на пятницу (готово к понедельнику), шаги после выхода - на понедельник. */
    function dueDate(step, offerDay, startDay) {
        var fromOffer = /оффер/i.test(step.basis || '');
        var base = fromOffer ? offerDay : startDay;
        if (base === null || base === undefined) return null;
        var off = num(step.offset), d = base + off, back = fromOffer || off < 0, w = dow(d);
        if (w === 6) d += back ? -1 : 2; else if (w === 7) d += back ? -2 : 1;
        if (fromOffer && startDay !== null && startDay !== undefined && d >= startDay) d = startDay - 1 - (dow(startDay - 1) === 7 ? 2 : dow(startDay - 1) === 6 ? 1 : 0);
        return d;
    }
    /* Исполнитель шага по роли: руководитель и наставник - конкретного новичка, «Новичок» - он сам, служба - исполнитель роли по умолчанию. */
    function executorOf(role, roleDef, ctx) {
        if (role === 'Руководитель') return { name: ctx.manager && ctx.manager.name || '', login: ctx.manager && ctx.manager.login || '' };
        if (role === 'Наставник') return { name: ctx.mentor && ctx.mentor.name || '', login: ctx.mentor && ctx.mentor.login || '' };
        if (role === 'Новичок') return { name: ctx.newbie.name, login: ctx.newbie.login || '' };
        return { name: roleDef && roleDef.exec || '', login: roleDef && roleDef.login || '' };
    }
    /* План новичка по маршруту: шаги со сроками, исполнителями и полями видимости. Поля логинов всегда заполнены («нет» вместо пустого). */
    function planSteps(routeSteps, ctx) {
        var nb = ctx.newbie, roles = ctx.roles || {};
        return (routeSteps || []).slice().sort(function (a, b) { return num(a.order) - num(b.order); }).map(function (s) {
            var ex = executorOf(s.role, roles[s.role], ctx);
            return {
                name: s.name, stepId: s.id, role: s.role, type: s.type || 'Задача', order: num(s.order), hidden: !!s.hidden,
                due: dueDate(s, nb.offer, nb.start), exec: ex.name, execLogin: ex.login || 'нет',
                seen: s.hidden ? 'нет' : (nb.login || 'нет'), mentorLogin: ctx.mentor && ctx.mentor.login || 'нет', managerLogin: ctx.manager && ctx.manager.login || 'нет'
            };
        });
    }
    function missing(plan) {
        var out = [];
        plan.forEach(function (p) { if (!p.exec) out.push(p.name + ': нет исполнителя (' + p.role + ')'); if (p.due === null) out.push(p.name + ': нет даты'); });
        return out;
    }

    /* Состояние шага на сегодня: done, late (сделан с опозданием), overdue, soon (срок через warn дней и меньше), wait. */
    function stepState(s, today, warn) {
        if (s.done !== null && s.done !== undefined) return s.due !== null && s.done > s.due ? 'late' : 'done';
        if (s.due === null || s.due === undefined) return 'wait';
        if (s.due < today) return 'overdue';
        if (s.due - today <= (warn === undefined ? 2 : warn)) return 'soon';
        return 'wait';
    }
    function isDone(st) { return st === 'done' || st === 'late'; }
    function progress(steps) {
        var done = steps.filter(function (s) { return s.done !== null && s.done !== undefined; }).length;
        return { total: steps.length, done: done, pct: steps.length ? Math.round(done * 100 / steps.length) : 0 };
    }
    /* Почему шаг тормозит новичка - формулировка светофора. */
    function reasonOf(s) {
        if (SERVICE_ROLES[s.role]) return SERVICE_ROLES[s.role];
        if (s.role === 'Наставник') return 'встреча с наставником просрочена';
        if (s.role === 'Руководитель' && s.type === 'Контрольная точка') return 'отчёт по испытательному не сдан';
        if (s.role === 'Руководитель') return 'руководитель не выполнил шаг';
        if (s.role === 'Новичок') return 'новичок не выполнил шаг';
        return 'шаг HR просрочен';
    }
    /* Светофор новичка: красный - есть просрочка, жёлтый - срок на носу, зелёный - всё в графике. Причины сгруппированы. */
    function light(steps, today, warn) {
        var red = {}, soon = [], order = [];
        steps.forEach(function (s) {
            var st = stepState(s, today, warn);
            if (st === 'overdue') { var r = reasonOf(s); if (!red[r]) { red[r] = []; order.push(r); } red[r].push(s); }
            else if (st === 'soon') soon.push(s);
        });
        var reasons = order.map(function (r) { var l = red[r]; return { text: r, count: l.length, days: Math.max.apply(null, l.map(function (s) { return today - s.due; })), steps: l }; })
            .sort(function (a, b) { return b.days - a.days; });
        return { color: reasons.length ? 'red' : soon.length ? 'yellow' : 'green', reasons: reasons, soon: soon };
    }
    /* Испытательный срок: день N из M; до выхода - отрицательный день. */
    function probation(start, today, len) {
        if (start === null || start === undefined) return { day: null, left: null, len: len };
        var day = today >= start ? today - start + 1 : today - start;
        return { day: day, left: len - Math.max(day, 0), len: len, end: start + len - 1, before: today < start };
    }
    /* Панель «Застряли / Идут / Завершают»: offer - ждут запуска маршрута, prep - готовим к выходу, archive - история. */
    function bucketOf(nb, lt, pr) {
        if (FINAL[nb.status]) return 'archive';
        if (nb.status === 'Оффер принят') return 'offer';
        if (lt.color === 'red') return 'stuck';
        if (nb.status === 'Подготовка к выходу' || pr.before) return 'prep';
        if (pr.left !== null && pr.left <= 14) return 'finishing';
        return 'going';
    }
    function buckets(list) {
        var b = { stuck: [], going: [], finishing: [], prep: [], offer: [], archive: [] };
        list.forEach(function (n) { (b[n.bucket] || b.going).push(n); });
        return b;
    }
    /* Проверка маршрута перед сохранением: ошибки (нельзя сохранить) и предупреждения (можно, но странно). */
    function validateRoute(steps, probDays) {
        var errors = [], warns = [], seen = {};
        (steps || []).forEach(function (s) {
            var n = s.name || '(без названия)';
            if (!String(s.name || '').trim()) errors.push('Шаг без названия');
            if (!s.role) errors.push(n + ': не выбрана роль исполнителя');
            if (seen[num(s.order)]) errors.push(n + ': порядок ' + num(s.order) + ' уже занят шагом «' + seen[num(s.order)] + '»');
            seen[num(s.order)] = n;
            if (!/оффер/i.test(s.basis || '') && num(s.offset) >= probDays) errors.push(n + ': срок позже конца испытательного (' + probDays + ' дн)');
            if (s.type === 'Заявка' && !/оффер/i.test(s.basis || '') && num(s.offset) >= 0) warns.push(n + ': заявка службе со сроком в день выхода или позже - новичок будет ждать');
        });
        var fin = (steps || []).filter(function (s) { return s.type === 'Контрольная точка' && !/оффер/i.test(s.basis || '') && num(s.offset) >= probDays - 14; });
        if ((steps || []).length && !fin.length) warns.push('Нет итоговой контрольной точки в последние 2 недели испытательного - решение «оставить или нет» примут по ощущению');
        return { errors: errors, warns: warns, ok: !errors.length };
    }
    /* Решение по испытательному: «Продлить» и «Расстаться» - только с причиной. */
    function decisionErrors(decision, reason, comment) {
        var e = [];
        if (!/^(Оставить|Продлить|Расстаться)$/.test(decision || '')) e.push('Выберите решение');
        if (decision === 'Расстаться' && !reason) e.push('Укажите причину ухода - она попадёт в отчёт по текучести');
        if (decision === 'Продлить' && !String(comment || '').trim()) e.push('Напишите, что новичок должен успеть за продление');
        return e;
    }
    function statusAfter(decision) { return { 'Оставить': 'Прошёл испытательный', 'Продлить': 'Продлён испытательный', 'Расстаться': 'Ушёл на испытательном' }[decision] || ''; }
    /* Шаги новичка на сегодня: просрочено, сегодня, эта неделя, дальше. */
    function todayPlan(steps, today) {
        var r = { overdue: [], today: [], week: [], later: [], done: [] };
        steps.forEach(function (s) {
            if (s.done !== null && s.done !== undefined) r.done.push(s);
            else if (s.due < today) r.overdue.push(s);
            else if (s.due === today) r.today.push(s);
            else if (s.due <= today + 7) r.week.push(s);
            else r.later.push(s);
        });
        ['overdue', 'today', 'week', 'later'].forEach(function (k) { r[k].sort(function (a, b) { return a.due - b.due || a.order - b.order; }); });
        return r;
    }
    /* Отчёт по подразделениям: кто вышел, прошёл, ушёл на испытательном; на каком шаге застревают (просрочено или сделано с опозданием). */
    function deptReport(newbies, today, warn) {
        var by = {};
        newbies.forEach(function (n) {
            if (n.start === null || n.start > today && n.status !== 'Отказался до выхода') return;
            var d = by[n.dept] || (by[n.dept] = { dept: n.dept, started: 0, active: 0, passed: 0, left: 0, extended: 0, refused: 0, reasons: {}, stuck: {}, late: 0, lateDays: 0, itLate: [] });
            if (n.status === 'Отказался до выхода') { d.refused++; return; }
            d.started++;
            if (n.status === 'Прошёл испытательный') d.passed++;
            else if (n.status === 'Ушёл на испытательном') { d.left++; if (n.reason) d.reasons[n.reason] = (d.reasons[n.reason] || 0) + 1; }
            else { d.active++; if (n.status === 'Продлён испытательный') d.extended++; }
            (n.steps || []).forEach(function (s) {
                var st = stepState(s, today, warn);
                if (st !== 'late' && st !== 'overdue') return;
                var days = (st === 'late' ? s.done : today) - s.due;
                d.late++; d.lateDays += days;
                var k = s.name; (d.stuck[k] || (d.stuck[k] = { name: k, role: s.role, count: 0, days: 0 })).count++; d.stuck[k].days += days;
                if (s.role === 'ИТ') d.itLate.push(days);
            });
        });
        return Object.keys(by).map(function (k) {
            var d = by[k], closed = d.passed + d.left;
            d.leftPct = closed ? Math.round(d.left * 100 / closed) : 0;
            d.top = Object.keys(d.stuck).map(function (x) { return d.stuck[x]; }).sort(function (a, b) { return b.count - a.count || b.days - a.days; }).slice(0, 3);
            d.topReason = Object.keys(d.reasons).sort(function (a, b) { return d.reasons[b] - d.reasons[a]; })[0] || '';
            d.itAvg = d.itLate.length ? Math.round(d.itLate.reduce(function (a, b) { return a + b; }, 0) * 10 / d.itLate.length) / 10 : 0;
            return d;
        }).sort(function (a, b) { return b.leftPct - a.leftPct || b.started - a.started; });
    }
    function toCsv(rows) { return rows.map(function (r) { return r.map(function (v) { var s = String(v === undefined || v === null ? '' : v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';'); }).join('\r\n'); }
    return {
        SERVICE_ROLES: SERVICE_ROLES, num: num, parseD: parseD, fmtD: fmtD, fmtDM: fmtDM, isoOf: isoOf, fromIso: fromIso, dow: dow, wd: wd, plural: plural,
        dueDate: dueDate, executorOf: executorOf, planSteps: planSteps, missing: missing, stepState: stepState, isDone: isDone, progress: progress, reasonOf: reasonOf, light: light,
        probation: probation, bucketOf: bucketOf, buckets: buckets, validateRoute: validateRoute, decisionErrors: decisionErrors, statusAfter: statusAfter,
        todayPlan: todayPlan, deptReport: deptReport, toCsv: toCsv
    };
});
