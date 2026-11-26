/* Service Desk: чистые функции (рабочий календарь, срок SLA в рабочих часах с паузой, таймер, очередь, маршрут, подбор услуги, поля формы, отчёт SLA). Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DeskCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var DAY = 1440;
    var DEFAULT_RULES = { dayStart: 9, dayEnd: 18, warnPct: 80, autoCloseDays: 3, target: 90 };

    function num(v) { var n = parseFloat(String(v === undefined || v === null ? '' : v).replace(',', '.').replace(/\s/g, '')); return isNaN(n) ? 0 : n; }
    function pad(n) { return ('0' + n).slice(-2); }
    /* Время - «наивные» минуты от 1970-01-01 по московским часам: так рабочий день 9-18 считается без часовых поясов. */
    function isoOf(min) { var d = new Date(Math.floor(min / DAY) * 86400000); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
    function dayOf(min) { return Math.floor(min / DAY) * DAY; }
    function fromIso(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 60000; }
    /* 'ГГГГ-ММ-ДД ЧЧ:ММ[:СС]', 'ДД.ММ.ГГГГ ЧЧ:ММ:СС', 'ДД.ММ.ГГГГ' или epoch-секунды UTC из DATETIME ядра -> минуты по Москве. */
    function parseDt(v) {
        if (v === undefined || v === null || v === '') return null;
        if (typeof v === 'number' || /^\d{9,11}$/.test(String(v))) return Math.floor(num(v) / 60) + 180;
        var s = String(v).trim(), m = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(s);
        if (m) return fromIso(m[3] + '-' + m[2] + '-' + m[1]) + (m[4] ? +m[4] * 60 + +m[5] : 0);
        m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
        if (m) return fromIso(m[1] + '-' + m[2] + '-' + m[3]) + (m[4] ? +m[4] * 60 + +m[5] : 0);
        return null;
    }
    function fmtDt(min) { if (min === null || min === undefined) return ''; var h = min - dayOf(min); return isoOf(min) + ' ' + pad(Math.floor(h / 60)) + ':' + pad(h % 60); }
    function fmtShort(min) { if (min === null || min === undefined) return ''; var s = fmtDt(min); return s.slice(8, 10) + '.' + s.slice(5, 7) + ' ' + s.slice(11, 16); }
    function dow(min) { var d = new Date(dayOf(min) * 60000).getUTCDay(); return d === 0 ? 7 : d; }

    /* Рабочий календарь: часы службы и нерабочие дни {ГГГГ-ММ-ДД: 1}. */
    function calendar(rules, hol) { rules = rules || DEFAULT_RULES; return { start: (rules.dayStart || 9) * 60, end: (rules.dayEnd || 18) * 60, hol: hol || {} }; }
    function isWorkDay(min, cal) { return dow(min) <= 5 && !cal.hol[isoOf(min)]; }
    /* Рабочих минут между a и b (a <= b). */
    function workBetween(a, b, cal) {
        if (a === null || b === null || b <= a) return 0;
        var total = 0, d = dayOf(a);
        for (var guard = 0; d <= b && guard < 3700; d += DAY, guard++) {
            if (!isWorkDay(d, cal)) continue;
            var s = Math.max(a, d + cal.start), e = Math.min(b, d + cal.end);
            if (e > s) total += e - s;
        }
        return total;
    }
    /* Момент, когда истекут minutes рабочих минут от start. */
    function addWork(start, minutes, cal) {
        var t = start, left = Math.max(0, minutes);
        for (var guard = 0; guard < 3700; guard++) {
            var d = dayOf(t);
            if (isWorkDay(d, cal)) {
                var s = Math.max(t, d + cal.start), e = d + cal.end;
                if (s < e) { if (left <= e - s) return s + left; left -= e - s; }
            }
            t = d + DAY;
        }
        return t;
    }
    /* Бюджет SLA в рабочих минутах: часы услуги x множитель приоритета (не меньше 30 мин). */
    function budget(svc, prio) {
        var k = prio && num(prio.mult) > 0 ? num(prio.mult) : 1;
        return { react: Math.max(30, Math.round(num(svc.reactH) * 60 * k)), solve: Math.max(30, Math.round(num(svc.solveH) * 60 * k)) };
    }
    function deadlines(created, svc, prio, cal, pauseMin) {
        var b = budget(svc, prio);
        return { react: addWork(created, b.react, cal), solve: addWork(created, b.solve + (pauseMin || 0), cal), budget: b };
    }
    /* Состояние таймера решения. t: {created, solveBudget, pauseMin, pausedFrom, resolved, timer('идёт'|'пауза'|'стоп')} */
    function slaState(t, now, cal, warnPct) {
        warnPct = warnPct || DEFAULT_RULES.warnPct;
        var end = t.resolved !== null && t.resolved !== undefined ? t.resolved : now;
        var openPause = t.pausedFrom !== null && t.pausedFrom !== undefined && t.resolved == null ? workBetween(t.pausedFrom, end, cal) : 0;
        var paused = (t.pauseMin || 0) + openPause;
        var used = Math.max(0, workBetween(t.created, end, cal) - paused);
        var budgetMin = t.solveBudget || 1, pct = Math.round(used / budgetMin * 100), left = budgetMin - used;
        var state;
        if (t.resolved !== null && t.resolved !== undefined) state = used <= budgetMin ? 'met' : 'missed';
        else if (t.timer === 'стоп') state = 'stopped';
        else if (left < 0) state = 'breach';
        else if (t.timer === 'пауза') state = 'paused';
        else if (pct >= warnPct) state = 'warn';
        else state = 'ok';
        return { used: used, budget: budgetMin, pct: pct, left: left, state: state, paused: paused, deadline: addWork(t.created, budgetMin + paused, cal) };
    }
    /* Реакция в срок: взята в работу не позже бюджета реакции (рабочие минуты от создания). */
    function reactionMet(t, cal) {
        if (t.taken === null || t.taken === undefined) return null;
        return workBetween(t.created, t.taken, cal) <= t.reactBudget;
    }
    /* «осталось 2 ч 15 мин» / «просрочено на 1 ч 05 мин» в рабочих часах. */
    function humanLeft(left) {
        var a = Math.abs(Math.round(left)), h = Math.floor(a / 60), m = a % 60;
        var s = (h ? h + ' ч ' : '') + (h ? pad(m) : m) + ' мин';
        return left < 0 ? 'просрочено на ' + s : 'осталось ' + s;
    }

    /* Очередь диспетчера: корзины по открытым заявкам. t.sla - результат slaState, t.status, t.exec */
    var DONE = { 'Решена': 1, 'Закрыта': 1, 'Отклонена': 1 };
    function isOpen(t) { return !DONE[t.status]; }
    function bucketOf(t) {
        if (!isOpen(t)) return '';
        if (t.status === 'На согласовании') return 'approval';
        if (t.sla && t.sla.state === 'breach') return 'overdue';
        if (t.status === 'Ждём заявителя') return 'waiting';
        if (!t.exec) return 'unassigned';
        if (t.sla && t.sla.state === 'warn') return 'soon';
        return 'inwork';
    }
    function buckets(list) {
        var b = { overdue: [], soon: [], unassigned: [], waiting: [], approval: [], inwork: [] };
        list.forEach(function (t) { var k = bucketOf(t); if (k) b[k].push(t); });
        return b;
    }
    /* Подбор услуги по тексту «Мне нужно…»: совпадения основ слов с названием и ключевыми словами. */
    function stems(text) {
        return String(text || '').toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter(function (w) { return w.length >= 3 && !/^\d+$/.test(w); })
            .map(function (w) { return w.length > 5 ? w.slice(0, w.length > 7 ? 5 : 4) : w; });
    }
    function matchServices(text, services, limit) {
        var q = stems(text); if (!q.length) return [];
        var out = services.map(function (s) {
            var title = stems(s.name), keys = stems((s.keywords || '') + ' ' + (s.group || '')), score = 0;
            q.forEach(function (w) {
                if (title.some(function (x) { return x.indexOf(w) === 0 || w.indexOf(x) === 0; })) score += 3;
                else if (keys.some(function (x) { return x.indexOf(w) === 0 || w.indexOf(x) === 0; })) score += 2;
            });
            return { svc: s, score: score };
        }).filter(function (r) { return r.score > 0; });
        out.sort(function (a, b) { return b.score - a.score || (a.svc.name < b.svc.name ? -1 : 1); });
        return out.slice(0, limit || 5);
    }
    /* Номер помещения в тексте («дверь в 304» -> помещение 304). */
    function findRoom(text, rooms) {
        var toks = String(text || '').toLowerCase().split(/[^a-zа-я0-9-]+/);
        for (var i = 0; i < rooms.length; i++) if (toks.indexOf(String(rooms[i].name).toLowerCase()) >= 0) return rooms[i];
        return null;
    }
    /* Поля формы услуги: строка на поле, «Название*» - обязательное, «:date», «:number» или «:Вариант1|Вариант2». */
    function parseForm(spec) {
        return String(spec || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
            var m = /^([^:*]+?)(\*)?\s*(?::\s*(.+))?$/.exec(l), type = 'text', options = null;
            var t = m && m[3] ? m[3].trim() : '';
            if (t === 'date' || t === 'number') type = t; else if (t) { type = 'select'; options = t.split('|').map(function (x) { return x.trim(); }); }
            return { name: m ? m[1].trim() : l, req: !!(m && m[2]), type: type, options: options };
        });
    }
    function validateForm(fields, values) {
        var errs = [];
        fields.forEach(function (f) {
            var v = values[f.name] === undefined ? '' : String(values[f.name]).trim();
            if (f.req && !v) errs.push('Заполните поле «' + f.name + '»');
            else if (v && f.type === 'number' && !/^\d+([.,]\d+)?$/.test(v)) errs.push('«' + f.name + '»: нужно число');
            else if (v && f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errs.push('«' + f.name + '»: нужна дата');
            else if (v && f.type === 'select' && f.options.indexOf(v) < 0) errs.push('«' + f.name + '»: выберите из списка');
        });
        return errs;
    }
    function formText(fields, values, free) {
        var lines = fields.filter(function (f) { return values[f.name]; }).map(function (f) { return f.name + ': ' + values[f.name]; });
        if (free) lines.push(free);
        return lines.join('\n');
    }
    /* Маршрут согласования услуги. «Руководитель» - руководитель заявителя, «Руководитель службы» - владелец услуги. */
    function routeSteps(svc, emp, service) {
        var steps = String(svc.route || '').split(/[,;]/).map(function (s) { return s.trim(); }).filter(Boolean);
        return steps.map(function (s, i) {
            if (/службы/i.test(s)) return { step: i + 1, role: s, who: service ? service.head : '', login: service ? service.headLogin : '' };
            return { step: i + 1, role: s, who: emp ? emp.manager : '', login: emp ? emp.managerLogin : '' };
        });
    }
    /* Текущий шаг: первый без решения; отклонение останавливает маршрут. */
    function routeProgress(approvals) {
        var list = approvals.slice().sort(function (a, b) { return a.step - b.step; });
        for (var i = 0; i < list.length; i++) {
            if (list[i].decision === 'Отклонено') return { done: true, rejected: true, current: null };
            if (list[i].decision !== 'Согласовано') return { done: false, rejected: false, current: list[i] };
        }
        return { done: true, rejected: false, current: null };
    }
    /* Отчёт «Соблюдение SLA, %»: решённые в периоде [from, to) по ключу группы; открытые - отдельно. */
    function slaReport(list, keyFn, from, to) {
        var g = {};
        list.forEach(function (t) {
            var k = keyFn(t); if (!k) return;
            var r = g[k] || (g[k] = { key: k, total: 0, inTime: 0, missed: 0, open: 0, breachOpen: 0, reactN: 0, reactOk: 0 });
            if (t.resolved !== null && t.resolved !== undefined) {
                if (t.resolved < from || t.resolved >= to) return;
                r.total++; if (t.sla.state === 'met') r.inTime++; else r.missed++;
                if (t.reactOk !== null && t.reactOk !== undefined) { r.reactN++; if (t.reactOk) r.reactOk++; }
            } else if (isOpen(t) && t.status !== 'На согласовании') { r.open++; if (t.sla.state === 'breach') r.breachOpen++; }
        });
        return Object.keys(g).map(function (k) { var r = g[k]; r.pct = r.total ? Math.round(r.inTime / r.total * 1000) / 10 : null; r.reactPct = r.reactN ? Math.round(r.reactOk / r.reactN * 1000) / 10 : null; return r; })
            .sort(function (a, b) { return (a.pct === null ? 101 : a.pct) - (b.pct === null ? 101 : b.pct) || b.total - a.total; });
    }
    /* Повторные заявки: та же услуга в том же помещении с разрывом не больше days дней. */
    function repeats(list, days) {
        var g = {};
        list.forEach(function (t) { if (!t.room) return; var k = t.service + '|' + t.room; (g[k] = g[k] || []).push(t); });
        return Object.keys(g).map(function (k) {
            var a = g[k].sort(function (x, y) { return x.created - y.created; }), hits = [];
            for (var i = 1; i < a.length; i++) if (a[i].created - a[i - 1].created <= days * DAY) { if (hits.indexOf(a[i - 1]) < 0) hits.push(a[i - 1]); hits.push(a[i]); }
            return { service: a[0].service, room: a[0].room, items: hits };
        }).filter(function (r) { return r.items.length >= 2; }).sort(function (a, b) { return b.items.length - a.items.length; });
    }
    /* Решена и не подтверждена autoCloseDays рабочих дней - закрывается сама. */
    function autoCloseDue(t, now, cal, days) {
        if (t.status !== 'Решена' || t.resolved === null || t.resolved === undefined) return false;
        return workBetween(t.resolved, now, cal) >= days * (cal.end - cal.start);
    }
    function nextNumber(list) {
        var max = 0; list.forEach(function (t) { var n = parseInt(String(t.num || '').replace(/\D/g, ''), 10); if (n > max) max = n; });
        return 'SD-' + (max + 1);
    }
    function toCsv(rows, cols) {
        function q(v) { v = String(v === undefined || v === null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
        return [cols.map(function (c) { return q(c[1]); }).join(';')].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c[0]]); }).join(';'); })).join('\n');
    }
    return {
        DEFAULT_RULES: DEFAULT_RULES, num: num, parseDt: parseDt, fmtDt: fmtDt, fmtShort: fmtShort, isoOf: isoOf, dow: dow, calendar: calendar, isWorkDay: isWorkDay,
        workBetween: workBetween, addWork: addWork, budget: budget, deadlines: deadlines, slaState: slaState, reactionMet: reactionMet, humanLeft: humanLeft,
        isOpen: isOpen, bucketOf: bucketOf, buckets: buckets, stems: stems, matchServices: matchServices, findRoom: findRoom, parseForm: parseForm, validateForm: validateForm,
        formText: formText, routeSteps: routeSteps, routeProgress: routeProgress, slaReport: slaReport, repeats: repeats, autoCloseDue: autoCloseDue, nextNumber: nextNumber, toCsv: toCsv
    };
});
