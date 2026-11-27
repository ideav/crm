/* MDC: чистые функции мониторинга оборудования (время смены, дежурный, правило порога и длительности, прогон правила по истории, срок реакции и эскалация, статус оборудования, сборка инцидента и заявки). Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MdcCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var DAY = 86400000;
    var SHIFTS = { day: 'Дневная', night: 'Ночная' };
    var DAY_FROM = 8 * 60, DAY_TO = 20 * 60; /* дневная смена 08:00-20:00, ночная 20:00-08:00 */

    function num(x) { var n = parseFloat(String(x === undefined || x === null ? '' : x).replace(',', '.').replace(/\s/g, '')); return isNaN(n) ? 0 : n; }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    /* '26.11.2026' и '2026-11-26' -> '2026-11-26' */
    function toIso(s) {
        s = String(s || '').trim();
        var m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/); if (m) return m[3] + '-' + m[2] + '-' + m[1];
        m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : '';
    }
    function toDmy(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
    function toShort(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '.' + p[1] : ''; }
    function utc(iso) { var p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
    function addDays(iso, n) { var d = new Date(utc(iso) + n * DAY); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
    /* 'ЧЧ:ММ' -> минуты от полуночи; пусто -> null */
    function hm(s) { var m = String(s || '').match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; }
    function fmtHm(min) { min = ((Math.round(min) % 1440) + 1440) % 1440; return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }
    /* Абсолютная отметка в минутах: дата + время суток. */
    function stamp(dateIso, time) { var t = hm(time); return utc(toIso(dateIso)) / 60000 + (t === null ? 0 : t); }
    function fromStamp(st) { var d = Math.floor(st / 1440); var dt = new Date(d * DAY); return { date: dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate()), time: fmtHm(st - d * 1440) }; }
    function durText(min) {
        min = Math.max(0, Math.round(min));
        if (min < 60) return min + ' мин';
        var h = Math.floor(min / 60), m = min % 60;
        if (h < 24) return h + ' ч' + (m ? ' ' + m + ' мин' : '');
        return Math.floor(h / 24) + ' дн ' + (h % 24) + ' ч';
    }

    /* Смена и её дата: ночная после полуночи относится к смене предыдущего дня. */
    function shiftOf(dateIso, time) {
        var t = hm(time) || 0, d = toIso(dateIso);
        if (t >= DAY_FROM && t < DAY_TO) return { date: d, shift: SHIFTS.day };
        return { date: t < DAY_FROM ? addDays(d, -1) : d, shift: SHIFTS.night };
    }
    /* Дежурный участка на момент события. duties: [{date, shift, section, emp}] */
    function onDuty(duties, section, dateIso, time) {
        var s = shiftOf(dateIso, time);
        var hit = (duties || []).filter(function (x) { return toIso(x.date) === s.date && x.shift === s.shift && x.section === section; })[0];
        return hit ? hit.emp : '';
    }

    /* Правило: параметр, условие (> или <), порог, длительность в минутах. Отклонение - интервал, когда параметр вышел за уровень: пик и длительность. */
    function ruleMatches(rule, dev, override) {
        if (!rule || !dev) return false;
        var o = override || {};
        var thr = o.threshold !== undefined ? num(o.threshold) : num(rule.threshold);
        var dur = o.minutes !== undefined ? num(o.minutes) : num(rule.minutes);
        if (rule.param !== dev.param) return false;
        var peak = num(dev.peak);
        var over = rule.cond === '<' ? peak < thr : peak > thr;
        return over && num(dev.minutes) >= dur;
    }
    var SEV_RANK = { 'Авария': 3, 'Предупреждение': 2, 'Информация': 1 };
    function sevRank(s) { return SEV_RANK[s] || 0; }
    /* Какое правило сработает на отклонение: из активных совпавших - самое строгое по важности, затем с меньшим сроком реакции. */
    function pickRule(rules, dev) {
        var hits = (rules || []).filter(function (r) { return r.active !== false && ruleMatches(r, dev); });
        hits.sort(function (a, b) { return sevRank(b.severity) - sevRank(a.severity) || num(a.react) - num(b.react); });
        return hits[0] || null;
    }
    /* Прогон правила по истории отклонений: сколько тревог дало бы правило с порогом и длительностью override. */
    function replay(devs, rule, override, days) {
        var list = (devs || []).filter(function (d) { return ruleMatches(rule, d, override); });
        var byDay = {};
        list.forEach(function (d) { var k = toIso(d.date); byDay[k] = (byDay[k] || 0) + 1; });
        var out = { count: list.length, byDay: byDay, list: list };
        if (days) out.perDay = Math.round(list.length / days * 10) / 10;
        return out;
    }
    /* Шум до и после правки правила: сколько тревог отсеется. */
    function noiseDelta(devs, rule, override) {
        var before = replay(devs, rule).count, after = replay(devs, rule, override).count;
        return { before: before, after: after, removed: before - after, pct: before ? Math.round((before - after) / before * 100) : 0 };
    }

    /* Срок реакции и эскалация. inc: {date, time, status, acceptTime}; rule: {react, escalate}; now - отметка stamp().
       Время принятия хранится ЧЧ:ММ; если оно меньше времени начала, принятие было на следующие сутки. */
    function acceptedAt(inc) {
        var a = hm(inc.acceptTime); if (a === null) return null;
        var st = stamp(inc.date, inc.time), at = stamp(inc.date, inc.acceptTime);
        return at < st ? at + 1440 : at;
    }
    function reaction(inc, rule, now) {
        var st = stamp(inc.date, inc.time), react = num(rule && rule.react) || 15, esc = num(rule && rule.escalate) || 0;
        var deadline = st + react, acc = acceptedAt(inc);
        if (acc !== null) return { state: acc <= deadline ? 'done' : 'late', deadline: deadline, took: acc - st, left: 0, escalated: false };
        if (inc.status === 'Закрыт') return { state: 'done', deadline: deadline, took: null, left: 0, escalated: false };
        var left = deadline - now;
        return { state: left < 0 ? 'overdue' : left <= 5 ? 'soon' : 'ok', deadline: deadline, left: left, took: null, escalated: esc > 0 && now >= deadline + esc, escalateAt: deadline + esc };
    }
    function isOpen(inc) { return inc.status !== 'Закрыт'; }
    var EQ_RANK = { 'Авария': 4, 'Простой': 3, 'Плановый простой': 2, 'Работает': 1 };
    /* Статус оборудования на экране смены: открытый инцидент сильнее статуса из шлюза. */
    function equipmentState(eq, incidents, stopParam) {
        var st = eq.status || 'Работает', why = null;
        (incidents || []).forEach(function (i) {
            if (i.eq !== eq.name || !isOpen(i)) return;
            var s = i.severity === 'Авария' ? 'Авария' : (i.param === (stopParam || 'Остановка станка') ? 'Простой' : null);
            if (s && (EQ_RANK[s] || 0) > (EQ_RANK[st] || 0)) { st = s; why = i; }
            else if (!why) why = i;
        });
        return { status: st, incident: why };
    }
    /* Порядок ленты: открытые по срочности (просрочено, вот-вот, в срок), затем закрытые - новые сверху. */
    var FEED_RANK = { overdue: 0, soon: 1, ok: 2, late: 3, done: 3 };
    function feedOrder(incidents, ruleBy, now) {
        return (incidents || []).map(function (i) { return { inc: i, r: reaction(i, ruleBy[i.rule], now) }; }).sort(function (a, b) {
            var oa = isOpen(a.inc) ? 0 : 1, ob = isOpen(b.inc) ? 0 : 1;
            if (oa !== ob) return oa - ob;
            if (oa === 0 && FEED_RANK[a.r.state] !== FEED_RANK[b.r.state]) return FEED_RANK[a.r.state] - FEED_RANK[b.r.state];
            return stamp(b.inc.date, b.inc.time) - stamp(a.inc.date, a.inc.time);
        });
    }
    /* Что нужно, чтобы закрыть инцидент: причина из справочника обязательна, свободный текст причиной не считается. */
    function closeErrors(inc, causes) {
        var e = [];
        if (!inc.cause) e.push('Укажите причину из справочника: без кода причины инцидент не закрывается.');
        else if (causes && causes.indexOf(inc.cause) < 0) e.push('Причина «' + inc.cause + '» не из справочника.');
        if (!inc.acceptTime) e.push('Сначала примите инцидент: так фиксируется время реакции.');
        return e;
    }
    function nextCode(codes, prefix, width) {
        var max = 0;
        (codes || []).forEach(function (c) { var m = String(c || '').match(/(\d+)\s*$/); if (m && String(c).indexOf(prefix) === 0 && +m[1] > max) max = +m[1]; });
        return prefix + String(max + 1).padStart(width || 4, '0');
    }
    /* Инцидент из отклонения по правилу. ctx: {sensorBy, eqBy, duties, codes}. Инцидент начинается, когда правило сработало (начало отклонения + «дольше, мин»); ответственный - дежурный участка в эту смену. */
    function buildIncident(dev, rule, ctx) {
        var sensor = ctx.sensorBy[dev.sensor] || {}, eq = ctx.eqBy[sensor.eq] || {};
        var fire = fromStamp(stamp(dev.date, dev.time) + num(rule.minutes));
        return {
            code: nextCode(ctx.codes, 'ИН-', 4), eq: eq.name || sensor.eq || '', section: eq.section || '', rule: rule.name, param: rule.param, severity: rule.severity,
            date: fire.date, time: fire.time, peak: num(dev.peak), status: 'Новый', resp: onDuty(ctx.duties, eq.section, fire.date, fire.time), cause: '', acceptTime: ''
        };
    }
    /* Заявка на ремонт из инцидента, если правило велит её создавать. */
    function buildRepair(inc, rule, codes) {
        if (!rule || !rule.repair) return null;
        return {
            code: nextCode(codes, 'ЗР-', 4), incident: inc.code, eq: inc.eq, section: inc.section, severity: inc.severity, date: inc.date, status: 'Новая', worker: inc.resp,
            text: rule.name + ': ' + inc.eq + ', пик ' + inc.peak + (rule.unit ? ' ' + rule.unit : '') + ' в ' + inc.time + '.'
        };
    }
    /* Цепочка шлюза: отклонение -> правило -> инцидент (+ заявка). Возвращает null, если ни одно правило не сработало. */
    function processDeviation(dev, rules, ctx) {
        var rule = pickRule(rules, dev); if (!rule) return null;
        var inc = buildIncident(dev, rule, ctx);
        return { rule: rule, incident: inc, repair: buildRepair(inc, rule, ctx.repairCodes) };
    }
    /* Видимость по участку: роль мастера видит только свой участок. */
    function visibleBySection(rows, section) { return section ? (rows || []).filter(function (r) { return r.section === section; }) : (rows || []); }

    return {
        SHIFTS: SHIFTS, num: num, toIso: toIso, toDmy: toDmy, toShort: toShort, addDays: addDays, hm: hm, fmtHm: fmtHm, stamp: stamp, fromStamp: fromStamp, durText: durText,
        shiftOf: shiftOf, onDuty: onDuty, ruleMatches: ruleMatches, sevRank: sevRank, pickRule: pickRule, replay: replay, noiseDelta: noiseDelta,
        acceptedAt: acceptedAt, reaction: reaction, isOpen: isOpen, equipmentState: equipmentState, feedOrder: feedOrder, closeErrors: closeErrors, nextCode: nextCode,
        buildIncident: buildIncident, buildRepair: buildRepair, processDeviation: processDeviation, visibleBySection: visibleBySection
    };
});
