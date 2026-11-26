/* Трекер с живой спецификацией: чистые функции (спека, условия переходов, детектор «нет продолжения», варианты «куда дальше», цикл одобрения, отчёты). Без DOM и сети: работает в браузере и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.TrackerCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var HOUR = 3600000;
    var SIDES = ['Передающий', 'Принимающий', 'Бизнес-администратор'];

    function num(v) { var n = parseFloat(String(v === undefined || v === null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; }
    /* 'ДД.ММ.ГГГГ' или 'ГГГГ-ММ-ДД' -> 'ГГГГ-ММ-ДД' */
    function toIso(v) {
        if (!v) return '';
        var m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(v);
        return m ? m[3] + '-' + m[2] + '-' + m[1] : String(v).slice(0, 10);
    }
    function toDmy(s) { return s ? s.slice(0, 10).split('-').reverse().join('.') : ''; }
    function stamp(date, time) { var p = toIso(date).split('-'), t = String(time || '00:00').split(':'); return Date.UTC(+p[0], +p[1] - 1, +p[2], +t[0] || 0, +t[1] || 0); }
    function hoursBetween(d1, t1, d2, t2) { return Math.max(0, Math.round((stamp(d2, t2) - stamp(d1, t1)) / HOUR)); }
    function fmtHours(h) { if (h < 24) return h + ' ч'; var d = Math.floor(h / 24), r = h % 24; return d + ' дн' + (r ? ' ' + r + ' ч' : ''); }
    function isFinal(step) { return !!step && step.kind === 'Конечное'; }

    /* Условие перехода: «Поле оп значение», оп: >= <= != > < =. Пусто — всегда да. */
    function parseCond(c) {
        c = String(c || '').trim();
        if (!c) return null;
        var m = /^(.+?)\s*(>=|<=|!=|>|<|=)\s*(.*)$/.exec(c);
        return m ? { field: m[1].trim(), op: m[2], value: m[3].trim() } : { bad: c };
    }
    function evalCond(c, obj) {
        var p = parseCond(c);
        if (!p) return true;
        if (p.bad) return false;
        var a = obj ? obj[p.field] : undefined, b = p.value;
        if (a === undefined || a === null) a = '';
        var numeric = /^-?[\d\s]+([.,]\d+)?$/.test(String(b)) && /^-?[\d\s]*([.,]\d+)?$/.test(String(a)) && String(a) !== '';
        var x = numeric ? num(a) : String(a).toLowerCase(), y = numeric ? num(b) : String(b).toLowerCase();
        switch (p.op) {
            case '>=': return x >= y; case '<=': return x <= y; case '>': return x > y; case '<': return x < y;
            case '!=': return x !== y; default: return x === y;
        }
    }
    function condText(c) {
        var p = parseCond(c);
        if (!p) return '';
        if (p.bad) return p.bad;
        var v = /^\d+$/.test(p.value) ? String(p.value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '«' + p.value + '»';
        var op = { '>=': '≥', '<=': '≤', '!=': '≠', '>': '>', '<': '<', '=': '=' }[p.op];
        return p.field.toLowerCase() + ' ' + op + ' ' + v;
    }

    /* Состояние перехода по голосам сторон текущей версии.
       effective — действует (записан «Действует» или все стороны согласны); counter — есть контрпредложение; proposed — ждёт голосов. */
    function transitionState(tr, votes, today) {
        var ver = num(tr.version) || 1;
        var cur = (votes || []).filter(function (v) { return v.proposal === tr.code; });
        if (tr.status === 'Действует') return { state: tr.since && today && tr.since > today ? 'scheduled' : 'effective', since: tr.since, version: ver, pending: [], counter: null, votes: cur };
        if (tr.status === 'Отменён') return { state: 'cancelled', version: ver, pending: [], counter: null, votes: cur };
        var counter = null, pending = [], last = '';
        var sides = sidesOf(cur);
        sides.forEach(function (side) {
            var v = cur.filter(function (x) { return x.side === side; })[0];
            if (v && num(v.version) === ver && v.decision === 'Контрпредложение' && !counter) counter = v;
            if (!v || num(v.version) !== ver || v.decision !== 'Согласен') pending.push(side);
            else if (v.date > last) last = v.date;
        });
        if (counter) return { state: 'counter', version: ver, pending: pending, counter: counter, votes: cur };
        if (!pending.length && sides.length) return { state: 'effective', since: last || today, version: ver, pending: [], counter: null, votes: cur, derived: true };
        return { state: 'proposed', version: ver, pending: pending, counter: null, votes: cur };
    }
    function sidesOf(votes) { var s = []; SIDES.forEach(function (x) { if (votes.some(function (v) { return v.side === x; })) s.push(x); }); return s.length ? s : SIDES.slice(); }

    /* Спека: шаги по порядку, переходы с состоянием. */
    function buildSpec(steps, trans, votes, today) {
        var list = (steps || []).slice().sort(function (a, b) { return num(a.order) - num(b.order); });
        var by = {}; list.forEach(function (s) { by[s.name] = s; });
        var all = (trans || []).map(function (t) { var st = transitionState(t, votes, today); return Object.assign({}, t, { st: st }); });
        var out = {}; list.forEach(function (s) { out[s.name] = []; });
        all.forEach(function (t) { (out[t.from] = out[t.from] || []).push(t); });
        return { steps: list, by: by, trans: all, out: out, today: today };
    }
    function effectiveOut(spec, step) { return (spec.out[step] || []).filter(function (t) { return t.st.state === 'effective'; }); }
    /* Куда заявка может идти по правилу: действующие переходы из её шага, условие выполнено. */
    function nextSteps(spec, req) { return effectiveOut(spec, req.step).filter(function (t) { return evalCond(t.cond, req.fields || req); }); }
    function isUncertain(spec, req) { var s = spec.by[req.step]; return !!s && !isFinal(s) && nextSteps(spec, req).length === 0; }

    /* Журнал заявки по времени. */
    function chain(journal, reqCode) {
        return (journal || []).filter(function (e) { return e.req === reqCode; }).sort(function (a, b) { return stamp(a.date, a.time) - stamp(b.date, b.time) || String(a.code).localeCompare(String(b.code)); });
    }
    function moves(journal, reqCode) { return chain(journal, reqCode).filter(function (e) { return e.kind === 'Шаг' || e.kind === 'Исключение'; }); }
    /* Когда заявка вошла в текущий шаг: последнее событие «Шаг/Исключение» с этим шагом. */
    function enteredAt(journal, req) {
        var ev = moves(journal, req.code).filter(function (e) { return e.step === req.step; });
        var e = ev[ev.length - 1];
        return e ? { date: e.date, time: e.time, ev: e } : { date: req.since || '', time: '00:00', ev: null };
    }
    /* Детектор живой спеки: заявки, у шага которых нет продолжения. Запись spec.uncertainty — одна на вход в шаг (без дублей). */
    function detect(spec, reqs, journal) {
        return (reqs || []).filter(function (r) { return isUncertain(spec, r); }).map(function (r) {
            var at = enteredAt(journal, r);
            var logged = chain(journal, r.code).some(function (e) { return e.kind === 'Неопределённость' && e.step === r.step && stamp(e.date, e.time) >= stamp(at.date, at.time); });
            return { req: r, step: r.step, since: at, logged: logged };
        });
    }
    /* Откуда заявка пришла в текущий шаг. */
    function cameFrom(journal, req) {
        var ev = moves(journal, req.code);
        for (var i = ev.length - 1; i > 0; i--) if (ev[i].step === req.step && ev[i - 1].step !== req.step) return ev[i - 1].step;
        return '';
    }
    function big(x) { return num(x) >= 1000000; }
    /* Варианты «куда дальше» для шага без продолжения: похожие заявки, регламент, предложения на согласовании и обычный путь по спеке. */
    function variants(spec, req, journal, regs) {
        var cand = {}, f = req.fields || {};
        function add(step, score, why) {
            if (!step || step === req.step || !spec.by[step]) return;
            var c = cand[step] = cand[step] || { step: step, score: 0, why: [] };
            c.score += score; c.why.push(why);
        }
        var codes = {};
        (journal || []).forEach(function (e) { if (e.req !== req.code) codes[e.req] = 1; });
        Object.keys(codes).forEach(function (code) {
            var ev = moves(journal, code);
            for (var i = 0; i < ev.length - 1; i++) {
                if (ev[i].step !== req.step || ev[i + 1].step === req.step) continue;
                var w = 1, same = [];
                if (ev[i].reqKind && ev[i].reqKind === f['Вид заявки']) { w += 1; same.push('тот же вид'); }
                if (ev[i].reqSum !== undefined && ev[i].reqSum !== '' && big(ev[i].reqSum) === big(f['Сумма заявки'])) { w += 1; same.push(big(ev[i].reqSum) ? 'сумма от 1 млн' : 'сумма до 1 млн'); }
                add(ev[i + 1].step, w, 'похожая ' + code + (same.length ? ' (' + same.join(', ') + ')' : '') + (ev[i + 1].kind === 'Исключение' ? ': решили исключением' : ': по правилу'));
            }
        });
        (regs || []).forEach(function (g) { if (g.step === req.step) add(g.next, 3, 'регламент, п. ' + g.name); });
        (spec.out[req.step] || []).forEach(function (t) { if (t.st.state === 'proposed' || t.st.state === 'counter') add(t.to, 1, 'предложение ' + t.code + ' на согласовании'); });
        var from = cameFrom(journal, req);
        if (from) effectiveOut(spec, from).forEach(function (t) { add(t.to, 1, 'обычный путь после «' + from + '»'); });
        return Object.keys(cand).map(function (k) { return cand[k]; }).sort(function (a, b) { return b.score - a.score || num(spec.by[a.step].order) - num(spec.by[b.step].order); });
    }

    /* Проверка спеки: нет старта/конечного, недостижимые шаги, тупики, переходы в никуда, дубли. */
    function lint(spec) {
        var issues = [], starts = spec.steps.filter(function (s) { return s.start; }), seen = {}, reach = {};
        if (!starts.length) issues.push({ kind: 'no-start', text: 'Нет стартового шага' });
        if (!spec.steps.some(isFinal)) issues.push({ kind: 'no-final', text: 'Нет конечного шага' });
        spec.trans.forEach(function (t) {
            if (t.st.state !== 'effective') return;
            if (!spec.by[t.to]) issues.push({ kind: 'dangling', step: t.from, text: 'Переход ' + t.code + ' ведёт в несуществующий шаг «' + t.to + '»' });
            var k = t.from + '>' + t.to + '>' + (t.cond || '');
            if (seen[k]) issues.push({ kind: 'duplicate', step: t.from, text: 'Дубль перехода «' + t.from + ' → ' + t.to + '» (' + seen[k] + ', ' + t.code + ')' });
            seen[k] = t.code;
        });
        var queue = starts.map(function (s) { return s.name; });
        queue.forEach(function (n) { reach[n] = 1; });
        while (queue.length) { var n = queue.shift(); effectiveOut(spec, n).forEach(function (t) { if (!reach[t.to] && spec.by[t.to]) { reach[t.to] = 1; queue.push(t.to); } }); }
        spec.steps.forEach(function (s) {
            if (!reach[s.name]) issues.push({ kind: 'unreachable', step: s.name, text: 'Шаг «' + s.name + '» недостижим от старта' });
            if (!isFinal(s) && !effectiveOut(spec, s.name).length) issues.push({ kind: 'dead-end', step: s.name, text: 'У шага «' + s.name + '» нет продолжения' });
        });
        return issues;
    }

    /* Застрявшие: время в шаге против норматива. */
    function stuck(spec, reqs, journal, nowDate, nowTime) {
        return (reqs || []).filter(function (r) { var s = spec.by[r.step]; return s && !isFinal(s); }).map(function (r) {
            var at = enteredAt(journal, r), h = hoursBetween(at.date, at.time, nowDate, nowTime), norm = num((spec.by[r.step] || {}).norm);
            return { req: r, hours: h, norm: norm, over: norm > 0 && h > norm, ratio: norm > 0 ? Math.round(h / norm * 10) / 10 : 0, uncertain: isUncertain(spec, r) };
        }).sort(function (a, b) { return (b.uncertain - a.uncertain) || (b.ratio - a.ratio); });
    }
    /* Метрики руководителя: доля исключений, время цикла закрытых, среднее время в шаге. */
    function metrics(journal) {
        var all = (journal || []).filter(function (e) { return (e.kind === 'Шаг' || e.kind === 'Исключение') && e.basis !== 'Старт процесса'; });
        var exc = all.filter(function (e) { return e.kind === 'Исключение'; }).length, cyc = [], inStep = {}, codes = {};
        (journal || []).forEach(function (e) { codes[e.req] = 1; });
        Object.keys(codes).forEach(function (k) {
            var ev = moves(journal, k);
            if (!ev.length) return;
            for (var i = 0; i < ev.length - 1; i++) (inStep[ev[i].step] = inStep[ev[i].step] || []).push(hoursBetween(ev[i].date, ev[i].time, ev[i + 1].date, ev[i + 1].time));
            var last = ev[ev.length - 1];
            if (last.step === 'Закрыта') cyc.push(hoursBetween(ev[0].date, ev[0].time, last.date, last.time));
        });
        function avg(a) { return a.length ? Math.round(a.reduce(function (s, x) { return s + x; }, 0) / a.length) : 0; }
        var steps = {}; Object.keys(inStep).forEach(function (k) { steps[k] = { avg: avg(inStep[k]), n: inStep[k].length }; });
        return { moves: all.length, exceptions: exc, excShare: all.length ? Math.round(exc / all.length * 1000) / 10 : 0, cycleAvg: avg(cyc), closed: cyc.length, steps: steps,
            uncertain: (journal || []).filter(function (e) { return e.kind === 'Неопределённость'; }).length };
    }

    /* Стороны одобрения перехода: передающий (руководитель подразделения шага-источника), принимающий (шага-цели), бизнес-администратор.
       Если объект никому не передаётся (одно подразделение) — две стороны. */
    function parties(spec, from, to, depts, ba) {
        var dep = {}; (depts || []).forEach(function (d) { dep[d.name] = d; });
        var a = dep[(spec.by[from] || {}).dept], b = dep[(spec.by[to] || {}).dept], out = [];
        if (a) out.push({ side: 'Передающий', name: a.head, login: a.login });
        if (b && (!a || b.name !== a.name)) out.push({ side: 'Принимающий', name: b.head, login: b.login });
        out.push({ side: 'Бизнес-администратор', name: ba.name, login: ba.login });
        return out;
    }
    function nextCode(codes, prefix, width) {
        var max = 0;
        (codes || []).forEach(function (c) { if (String(c).indexOf(prefix) === 0) max = Math.max(max, num(String(c).slice(prefix.length))); });
        return prefix + String(max + 1).padStart(width || 3, '0');
    }
    /* Как записать перемещение заявки: по правилу — «Шаг», перехода нет — «Исключение» с причиной. */
    function moveKind(spec, req, to) {
        var rule = nextSteps(spec, req).filter(function (t) { return t.to === to; })[0];
        return rule ? { kind: 'Шаг', basis: 'Переход «' + req.step + ' → ' + to + '»' + (rule.code.indexOf('ПР-') === 0 ? ', ' + rule.code : ''), rule: rule }
            : { kind: 'Исключение', basis: 'Перехода «' + req.step + ' → ' + to + '» нет в спецификации', rule: null };
    }
    /* Голос: отказа нет — либо «Согласен», либо контрпредложение (своё условие). */
    function votePatch(tr, decision, counter, today) {
        var ver = num(tr.version) || 1;
        var pc = parseCond(counter);
        if (decision === 'Контрпредложение' && (!pc || pc.bad)) throw new Error('Контрпредложение — это своё условие, например «Сумма заявки >= 1000000»');
        return { 'Решение стороны': decision, 'Версия голоса': ver, 'Контрпредложение': decision === 'Контрпредложение' ? counter : '', 'Дата голоса': today };
    }
    function canVote(vote, user, role) { return !!vote && (vote.login === user || /Бизнес-администратор/.test(role || '')) && vote.decision !== 'Согласен'; }
    /* Бизнес-администратор принимает контрпредложение: новая версия с условием автора; автор и администратор согласны, остальные голосуют заново. */
    function acceptCounter(tr, st, today) {
        if (!st.counter) throw new Error('Нет контрпредложения');
        var ver = (num(tr.version) || 1) + 1;
        var votes = st.votes.filter(function (v) { return v.id === st.counter.id || v.side === 'Бизнес-администратор'; })
            .map(function (v) { return { id: v.id, fields: { 'Решение стороны': 'Согласен', 'Версия голоса': ver, 'Контрпредложение': '', 'Дата голоса': today } }; });
        return { trans: { 'Условие перехода': st.counter.counter, 'Версия предложения': ver }, votes: votes };
    }
    /* Действия исполнителя в один тап: взять свободную, сдать дальше по правилу, «другое — написать как есть». */
    function queueActions(spec, req, user) {
        var mine = req.login === user, free = !req.login;
        return { take: free, mine: mine, next: mine ? nextSteps(spec, req) : [], other: mine, uncertain: isUncertain(spec, req) };
    }
    function money(x) { var n = Math.round(num(x)); return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }

    return {
        SIDES: SIDES, num: num, toIso: toIso, toDmy: toDmy, stamp: stamp, hoursBetween: hoursBetween, fmtHours: fmtHours, isFinal: isFinal, money: money,
        parseCond: parseCond, evalCond: evalCond, condText: condText, transitionState: transitionState, buildSpec: buildSpec, effectiveOut: effectiveOut,
        nextSteps: nextSteps, isUncertain: isUncertain, chain: chain, enteredAt: enteredAt, detect: detect, cameFrom: cameFrom, variants: variants,
        lint: lint, stuck: stuck, metrics: metrics, parties: parties, nextCode: nextCode, moveKind: moveKind, votePatch: votePatch, canVote: canVote,
        acceptCounter: acceptCounter, queueActions: queueActions
    };
});
