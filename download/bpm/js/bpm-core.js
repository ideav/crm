/* BPM: чистые функции исполнения процесса по событийной спецификации (условия переходов, маршрут, неопределённость,
   похожие случаи, стороны одобрения правки, проверка спецификации, карта из журнала, замещение, повтор вызовов).
   Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.BpmCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var DAY = 86400000;
    function num(x) { var n = parseFloat(String(x === undefined || x === null ? '' : x).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; }
    function toIso(s) { s = String(s || ''); var m = /^(\d\d)\.(\d\d)\.(\d{4})/.exec(s); return m ? m[3] + '-' + m[2] + '-' + m[1] : s.slice(0, 10); }
    function ruDate(s) { s = toIso(s); return s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : ''; }
    function utc(s) { var p = toIso(s).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
    function isWork(ms, hol) { var d = new Date(ms), w = d.getUTCDay(); var iso = d.toISOString().slice(0, 10); return w !== 0 && w !== 6 && !(hol && hol[iso]); }
    /* Рабочих дней от a до b (a не считается, b считается): заявка вошла в шаг 23.11, сегодня 26.11 -> 3. */
    function workDays(a, b, hol) {
        if (!a || !b) return 0;
        var x = utc(a), y = utc(b), n = 0, sign = 1;
        if (y < x) { var t = x; x = y; y = t; sign = -1; }
        for (var d = x + DAY; d <= y; d += DAY) if (isWork(d, hol)) n++;
        return n * sign;
    }
    function addWork(s, n, hol) { var d = utc(s); while (n > 0) { d += DAY; if (isWork(d, hol)) n--; } return new Date(d).toISOString().slice(0, 10); }

    /* ---------- условия переходов: «Решение = Согласовано и Сумма > 3000000» ---------- */
    var OPS = ['<=', '>=', '≠', '!=', '=', '>', '<'];
    function parseCond(s) {
        s = String(s || '').trim();
        if (!s) return [];
        return s.split(/\s+и\s+/).map(function (part) {
            for (var i = 0; i < OPS.length; i++) {
                var k = part.indexOf(' ' + OPS[i] + ' ');
                if (k > 0) return { field: part.slice(0, k).trim(), op: OPS[i] === '!=' ? '≠' : OPS[i], value: part.slice(k + OPS[i].length + 2).trim() };
            }
            return { field: part.trim(), op: '?', value: '' };
        });
    }
    function low(v) { return String(v === undefined || v === null ? '' : v).trim().toLowerCase(); }
    function clauseOk(c, attrs) {
        var v = attrs[c.field];
        if (c.op === '?') return false;
        if (c.op === '>' || c.op === '<' || c.op === '>=' || c.op === '<=') {
            var a = num(v), b = num(c.value);
            return c.op === '>' ? a > b : c.op === '<' ? a < b : c.op === '>=' ? a >= b : a <= b;
        }
        var eq = low(v) === low(c.value);
        return c.op === '=' ? eq : !eq;
    }
    function evalCond(cond, attrs) { var cs = typeof cond === 'string' ? parseCond(cond) : cond; for (var i = 0; i < cs.length; i++) if (!clauseOk(cs[i], attrs || {})) return false; return true; }
    function condFields(cond) { return parseCond(cond).map(function (c) { return c.field; }); }
    /* Атрибуты заявки для условий: поля формы плюс решение по задаче. */
    function attrsOf(req, decision) {
        return { 'Решение': decision || '', 'Нерезидент': req.nonres ? 'да' : 'нет', 'Валюта': req.cur || 'RUB', 'Сумма': num(req.sum), 'Вид договора': req.kind || '' };
    }

    /* ---------- маршрут ---------- */
    /* spec = { steps: {имя: {kind, proc, exec, start, norm}}, transitions: [{from, to, cond, source, proc}] } */
    function outgoing(spec, step) { return spec.transitions.filter(function (t) { return t.from === step; }); }
    function isEnd(spec, step) { var s = spec.steps[step]; return !!s && s.kind === 'Конечное'; }
    /* Куда идти из шага при этих атрибутах. stuck - шаг не конечный, а ни один переход не подошёл (неопределённость). */
    function route(spec, step, attrs) {
        var out = outgoing(spec, step), m = out.filter(function (t) { return evalCond(t.cond, attrs); });
        var to = m.length ? m[0].to : null;
        return { matches: m, to: to, stuck: !m.length && !isEnd(spec, step), ambiguous: m.length > 1, dangling: !!to && !spec.steps[to], tried: out };
    }
    /* Признаки случая для поиска похожих: «Нерезидент = да; Валюта = CNY; Вид договора = Поставка». */
    function featuresOf(req) { return 'Нерезидент = ' + (req.nonres ? 'да' : 'нет') + '; Валюта = ' + (req.cur || 'RUB') + '; Вид договора = ' + (req.kind || ''); }
    function parseFeatures(s) { var o = {}; String(s || '').split(';').forEach(function (p) { var k = p.indexOf('='); if (k > 0) o[p.slice(0, k).trim()] = p.slice(k + 1).trim(); }); return o; }
    function similarity(a, b) {
        var fa = parseFeatures(a), fb = parseFeatures(b), keys = Object.keys(fa), same = 0;
        if (!keys.length) return 0;
        keys.forEach(function (k) { if (low(fa[k]) === low(fb[k])) same++; });
        return same / keys.length;
    }
    /* Варианты по прошлым похожим случаям: тот же шаг, решённые, сходство признаков >= minScore.
       Группировка по выбранному шагу: сколько раз, среднее сходство, средний простой и сколько дошли до конца. */
    function variants(cases, step, features, opts) {
        opts = opts || {}; var min = opts.minScore === undefined ? 0.5 : opts.minScore;
        var by = {};
        (cases || []).forEach(function (c) {
            if (c.step !== step || !c.to) return;
            var sc = similarity(features, c.feat);
            if (sc < min) return;
            var g = by[c.to] || (by[c.to] = { to: c.to, count: 0, score: 0, delay: 0, finished: 0, examples: [] });
            g.count++; g.score += sc; g.delay += num(c.delay); if (c.finished) g.finished++; g.examples.push(c.req);
        });
        var list = Object.keys(by).map(function (k) { var g = by[k]; g.score = g.score / g.count; g.delay = g.delay / g.count; return g; });
        var total = list.reduce(function (s, g) { return s + g.count; }, 0);
        list.forEach(function (g) { g.share = total ? g.count / total : 0; });
        list.sort(function (a, b) { return b.count - a.count || b.score - a.score; });
        return list;
    }
    /* Предложение правки по решению: новый переход из шага, где встала заявка, в выбранный шаг при признаках случая. */
    function proposalFrom(unc, chosen, decision) {
        var f = parseFeatures(unc.feat), cond = 'Решение = ' + (decision || 'Согласовано');
        if (f['Нерезидент'] === 'да') cond += ' и Нерезидент = да';
        else if (f['Валюта'] && f['Валюта'] !== 'RUB') cond += ' и Валюта = ' + f['Валюта'];
        return { from: unc.step, to: chosen, cond: cond };
    }

    /* ---------- стороны одобрения правки ---------- */
    /* Объект передаётся между исполнителями: передающая, принимающая и владелец процесса.
       Не передаётся: исполнитель шага и владелец. Один человек в двух ролях подписывает один раз. */
    function sides(p, spec, owner) {
        var ex = function (s) { return spec.steps[s] ? spec.steps[s].exec : ''; };
        var list = p.transfer
            ? [{ side: 'Передающая', who: ex(p.from) }, { side: 'Принимающая', who: ex(p.to) }, { side: 'Владелец процесса', who: owner }]
            : [{ side: 'Исполнитель шага', who: ex(p.from) }, { side: 'Владелец процесса', who: owner }];
        var seen = {};
        return list.filter(function (s) { if (!s.who || seen[s.who]) return false; seen[s.who] = 1; return true; });
    }
    function approvalState(rows) {
        var waiting = rows.filter(function (r) { return r.decision !== 'Одобрено' && r.decision !== 'Отклонено'; });
        var rejected = rows.some(function (r) { return r.decision === 'Отклонено'; });
        return { approved: rows.length > 0 && !rejected && !waiting.length, rejected: rejected, waiting: waiting, done: rows.length - waiting.length, total: rows.length };
    }

    /* ---------- проверка спецификации ---------- */
    function domainOf(trs, field) {
        var vals = [], comp = false, nums = [];
        trs.forEach(function (t) {
            parseCond(t.cond).forEach(function (c) {
                if (c.field !== field) return;
                if (/[<>]/.test(c.op)) { var b = num(c.value); nums.push(b, b + 1, b - 1); return; }
                if (vals.indexOf(c.value) < 0) vals.push(c.value);
                if (c.op === '≠' || field !== 'Решение') comp = true;
            });
        });
        if (field === 'Нерезидент') return ['да', 'нет'];
        if (nums.length) return nums;
        if (comp) vals.push('(другое)');
        return vals;
    }
    /* Наборы значений, при которых из шага нет ни одного перехода («у шага нет продолжения»). */
    function gaps(spec, step) {
        var out = outgoing(spec, step);
        if (!out.length || isEnd(spec, step)) return [];
        var fields = [];
        out.forEach(function (t) { condFields(t.cond).forEach(function (f) { if (fields.indexOf(f) < 0) fields.push(f); }); });
        if (!fields.length) return [];
        if (fields.indexOf('Решение') < 0) fields.unshift('Решение');
        var combos = [{}];
        fields.forEach(function (f) {
            var d = domainOf(out, f); if (!d.length) d = ['(любое)'];
            var next = []; combos.forEach(function (c) { d.forEach(function (v) { var o = Object.assign({}, c); o[f] = v; next.push(o); }); }); combos = next;
        });
        var res = [], seen = {};
        combos.forEach(function (c) {
            if (out.some(function (t) { return evalCond(t.cond, c); })) return;
            var d = c['Решение']; if (d === '(любое)' || d === '(другое)') return;
            var key = fields.map(function (f) { return /[<>]/.test(String(c[f])) ? '' : f + ' = ' + c[f]; }).filter(Boolean).join(' и ');
            if (!seen[key]) { seen[key] = 1; res.push(key); }
        });
        return res;
    }
    function lint(spec, proc) {
        var names = Object.keys(spec.steps).filter(function (s) { return !proc || spec.steps[s].proc === proc; });
        var trs = spec.transitions.filter(function (t) { return !proc || t.proc === proc; });
        var issues = [];
        if (!names.some(function (s) { return spec.steps[s].kind === 'Конечное'; })) issues.push({ kind: 'noEnd', text: 'Нет конечного события' });
        trs.forEach(function (t) { if (!spec.steps[t.to]) issues.push({ kind: 'dangling', step: t.from, text: 'Переход в никуда: «' + t.from + '» → «' + t.to + '» (такого шага нет)' }); });
        names.forEach(function (s) {
            var st = spec.steps[s];
            if (!st.start && !trs.some(function (t) { return t.to === s; })) issues.push({ kind: 'unreachable', step: s, text: 'Недостижимый шаг: в «' + s + '» не ведёт ни один переход' });
            if (st.kind !== 'Конечное' && !trs.some(function (t) { return t.from === s; })) issues.push({ kind: 'deadEnd', step: s, text: 'Тупик: из «' + s + '» нет переходов' });
            gaps(spec, s).forEach(function (g) { issues.push({ kind: 'gap', step: s, text: 'Нет продолжения: «' + s + '» при ' + g }); });
            var amb = outgoing(spec, s);
            if (amb.length > 1) for (var i = 0; i < amb.length; i++) for (var j = i + 1; j < amb.length; j++) if (amb[i].cond && amb[j].cond && overlaps(amb[i].cond, amb[j].cond)) issues.push({ kind: 'ambiguous', step: s, text: 'Неоднозначно: из «' + s + '» подходят оба перехода — в «' + amb[i].to + '» и в «' + amb[j].to + '»' });
        });
        return issues;
    }
    /* Одно условие строго включает другое (второе - уточнение первого): оба сработают. */
    function overlaps(a, b) {
        var ca = parseCond(a), cb = parseCond(b);
        var sub = function (x, y) { return x.every(function (c) { return y.some(function (d) { return d.field === c.field && d.op === c.op && low(d.value) === low(c.value); }); }); };
        return ca.length !== cb.length && (sub(ca, cb) || sub(cb, ca));
    }

    /* ---------- карта процесса из журнала ---------- */
    var MOVE = { 'Переход': 1, 'Ручной перевод': 1, 'Решение по неопределённости': 1 };
    function stamp(e) { return utc(e.date) + (num(String(e.time || '00:00').slice(0, 2)) * 60 + num(String(e.time || '00:00').slice(3, 5))) * 60000; }
    /* Рёбра «из шага -> в шаг»: сколько раз, среднее время на шаге (ч), вне спецификации ли (такого перехода в спеке нет). */
    function buildMap(events, spec) {
        var byReq = {};
        events.forEach(function (e) { (byReq[e.req] = byReq[e.req] || []).push(e); });
        var edges = {}, dwell = {};
        Object.keys(byReq).forEach(function (r) {
            var list = byReq[r].slice().sort(function (a, b) { return stamp(a) - stamp(b); });
            var enteredAt = null;
            list.forEach(function (e) {
                if (e.code === 'Запуск') { enteredAt = stamp(e); return; }
                if (!MOVE[e.code] || !e.to) return;
                var k = e.from + '→' + e.to, h = enteredAt === null ? 0 : (stamp(e) - enteredAt) / 3600000;
                var g = edges[k] || (edges[k] = { from: e.from, to: e.to, count: 0, hours: 0, manual: 0, reqs: [] });
                g.count++; g.hours += h; if (e.code !== 'Переход') g.manual++; g.reqs.push(r);
                var d = dwell[e.from] || (dwell[e.from] = { step: e.from, n: 0, hours: 0 }); d.n++; d.hours += h;
                enteredAt = stamp(e);
            });
        });
        var list = Object.keys(edges).map(function (k) {
            var g = edges[k]; g.avgH = g.count ? g.hours / g.count : 0;
            g.offSpec = !spec.transitions.some(function (t) { return t.from === g.from && t.to === g.to; });
            return g;
        }).sort(function (a, b) { return b.count - a.count; });
        var steps = Object.keys(dwell).map(function (k) { var d = dwell[k]; d.avgH = d.hours / d.n; return d; });
        var unused = spec.transitions.filter(function (t) { return !edges[t.from + '→' + t.to]; });
        return { edges: list, steps: steps, unused: unused };
    }
    /* Цепочка заявки: причина -> решение -> правка, по порядку событий. */
    function chain(events, req) {
        return events.filter(function (e) { return e.req === req; }).sort(function (a, b) { return stamp(a) - stamp(b); });
    }

    /* ---------- исполнитель, замещение, где застряло ---------- */
    function absentOn(emp, day) { return !!(emp && emp.absFrom && toIso(emp.absFrom) <= day && (!emp.absTo || toIso(emp.absTo) >= day)); }
    /* Кто реально держит задачу сегодня: исполнитель, его заместитель или никто (висит). */
    function holder(login, empByLogin, subs, day) {
        var e = empByLogin[login];
        if (!absentOn(e, day)) return { who: login, via: '', hanging: false };
        var s = (subs || []).filter(function (x) { return x.emp === login && toIso(x.from) <= day && toIso(x.to) >= day; })[0];
        return s ? { who: s.sub, via: login, hanging: false } : { who: login, via: '', hanging: true, until: e.absTo };
    }
    /* Почему заявка стоит: неопределённость, ошибка интеграции, исполнитель отсутствует без замещения, шаг дольше нормы. */
    function stuckReasons(req, ctx) {
        if (req.done) return [];
        var r = [], age = workDays(req.entered, ctx.today, ctx.hol), st = ctx.spec.steps[req.at] || {};
        if (req.status === 'Ждёт решения') r.push({ kind: 'uncertainty', text: 'Неопределённость: у шага нет продолжения для этого случая', age: age });
        if (req.status === 'Ошибка интеграции') r.push({ kind: 'integration', text: 'Ошибка интеграции: попытки вызова исчерпаны', age: age });
        if (req.status === 'В работе' && req.exec) {
            var h = holder(req.exec, ctx.empByLogin, ctx.subs, ctx.today);
            if (h.hanging) r.push({ kind: 'absent', text: 'Исполнитель отсутствует до ' + ruDate(h.until) + ', замещения нет', age: age });
        }
        var normDays = Math.ceil(num(st.norm) / 8);
        if (req.status === 'В работе' && normDays && age > normDays) r.push({ kind: 'overdue', text: 'На шаге ' + age + ' раб. дн. при норме ' + normDays, age: age });
        return r;
    }

    /* ---------- решение по задаче ---------- */
    var NEED_COMMENT = { 'Возвращено': 1, 'Отклонено': 1, 'Нестандартный случай': 1, 'Отозвано': 1 };
    function checkDecision(decision, comment) {
        var e = [];
        if (!decision) e.push('Выберите решение');
        if (NEED_COMMENT[decision] && String(comment || '').trim().length < 5) e.push('Решение «' + decision + '» без комментария не принимается');
        return e;
    }
    /* Что произойдёт при решении: следующий шаг или неопределённость. «Нестандартный случай» всегда идёт к ответственному. */
    function plan(spec, req, step, decision) {
        if (decision === 'Нестандартный случай') return { stuck: true, manual: true, to: null };
        var r = route(spec, step, attrsOf(req, decision));
        return { stuck: r.stuck, manual: false, to: r.to, matches: r.matches, dangling: r.dangling };
    }

    /* ---------- повтор вызова интеграции: 5, 20, 80 мин ---------- */
    function retryDelay(attempt, base, factor) { base = base || 5; factor = factor || 4; return base * Math.pow(factor, Math.max(0, attempt - 1)); }
    function callState(calls, max) {
        var list = calls.slice().sort(function (a, b) { return num(a.att) - num(b.att); }), last = list[list.length - 1];
        if (!last) return { state: 'нет вызовов' };
        var okc = num(last.code) >= 200 && num(last.code) < 300;
        if (okc) return { state: 'успех', attempts: list.length };
        if (num(last.att) >= max) return { state: 'исчерпано', attempts: list.length };
        return { state: 'повтор', attempts: list.length, nextIn: retryDelay(num(last.att) + 1) };
    }
    function minutesAdd(time, m) { var t = num(String(time).slice(0, 2)) * 60 + num(String(time).slice(3, 5)) + m; return ('0' + Math.floor(t / 60) % 24).slice(-2) + ':' + ('0' + t % 60).slice(-2); }

    function toCsv(rows, cols) {
        var q = function (v) { v = String(v === undefined || v === null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        return [cols.map(function (c) { return q(c.t); }).join(';')].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c.k]); }).join(';'); })).join('\n');
    }

    return {
        num: num, toIso: toIso, ruDate: ruDate, workDays: workDays, addWork: addWork,
        parseCond: parseCond, evalCond: evalCond, attrsOf: attrsOf, route: route, outgoing: outgoing, isEnd: isEnd,
        featuresOf: featuresOf, parseFeatures: parseFeatures, similarity: similarity, variants: variants, proposalFrom: proposalFrom,
        sides: sides, approvalState: approvalState, gaps: gaps, lint: lint,
        buildMap: buildMap, chain: chain, absentOn: absentOn, holder: holder, stuckReasons: stuckReasons,
        checkDecision: checkDecision, plan: plan, retryDelay: retryDelay, callState: callState, minutesAdd: minutesAdd, toCsv: toCsv
    };
});
