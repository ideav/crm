/* Диспетчеризация и холодовая цепь: чистые функции (время и смена, классификация отклонения по режиму хранения с допуском на открытую дверь,
   маршрут тревоги по графику дежурств и эскалация, статус объекта, партии в зоне на момент отклонения, проверка акта, журнал для проверки).
   Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DispatchCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var DAY = 86400000;
    var DAY_FROM = 8 * 60, DAY_TO = 20 * 60; /* дневная смена диспетчерской 08:00-20:00, ночная 20:00-08:00 */
    var CLASS = { norm: 'Норма', door: 'Открытая дверь', warn: 'Предупреждение', alarm: 'Тревога' };
    var CLASS_RANK = { 'Норма': 0, 'Открытая дверь': 1, 'Предупреждение': 2, 'Тревога': 3 };

    function num(x) { var n = parseFloat(String(x === undefined || x === null ? '' : x).replace(',', '.').replace(/\s/g, '')); return isNaN(n) ? 0 : n; }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function toIso(s) {
        s = String(s || '').trim();
        var m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/); if (m) return m[3] + '-' + m[2] + '-' + m[1];
        m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : '';
    }
    function toDmy(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
    function toShort(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '.' + p[1] : ''; }
    function utc(iso) { var p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
    function addDays(iso, n) { var d = new Date(utc(iso) + n * DAY); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
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

    /* Смена диспетчерской: ночная после полуночи относится к смене предыдущего дня. */
    function shiftOf(dateIso, time) {
        var t = hm(time) || 0, d = toIso(dateIso);
        if (t >= DAY_FROM && t < DAY_TO) return { date: d, shift: 'Дневная' };
        return { date: t < DAY_FROM ? addDays(d, -1) : d, shift: 'Ночная' };
    }
    /* Дежурный линии ('1' - диспетчер, '2' - дежурный инженер) на момент времени по графику. */
    function onDuty(duties, line, dateIso, time) {
        var s = shiftOf(dateIso, time);
        var d = (duties || []).filter(function (x) { return toIso(x.date) === s.date && x.shift === s.shift && String(x.line) === String(line); })[0];
        return d ? d.emp : '';
    }
    /* 'ЧЧ:ММ-ЧЧ:ММ' -> работает ли объект в это время (пусто - круглосуточно без персонала: false). */
    function isOpenHours(hours, time) {
        var m = String(hours || '').match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/); if (!m) return false;
        var t = hm(time), a = hm(m[1]), b = hm(m[2]);
        return a <= b ? t >= a && t < b : t >= a || t < b;
    }
    /* Маршрут тревоги: в часы работы объекта первым - ответственный объекта (заведующая), вне часов - диспетчер смены;
       дальше по цепочке: диспетчер, дежурный инженер, руководитель службы. Повторы и пустые звенья выпадают. */
    function route(obj, duties, dateIso, time, head) {
        var chain = [];
        function add(who, role) { if (who && !chain.some(function (c) { return c.who === who; })) chain.push({ who: who, role: role }); }
        if (obj && isOpenHours(obj.hours, time)) add(obj.resp, 'ответственный объекта');
        add(onDuty(duties, '1', dateIso, time), 'диспетчер смены');
        add(onDuty(duties, '2', dateIso, time), 'дежурный инженер');
        add(head, 'руководитель службы');
        return chain;
    }

    function outOfRange(peak, mode) { return peak > mode.max || peak < mode.min; }
    /* Классификация отклонения по режиму хранения.
       Вне границ при открытой двери не дольше допуска - «Открытая дверь» (в журнал, без тревоги);
       вне границ дольше «времени до тревоги» - «Тревога»; короче - «Предупреждение»;
       в границах, но ближе «предупреждения за, °C» к границе - «Предупреждение». */
    function classify(dev, mode, over) {
        var m = Object.assign({}, mode, over || {}), p = num(dev.peak), min = num(dev.minutes);
        if (outOfRange(p, m)) {
            if (dev.door && min <= num(m.door)) return CLASS.door;
            return min >= num(m.delay) ? CLASS.alarm : CLASS.warn;
        }
        if (p > m.max - num(m.warn) || p < m.min + num(m.warn)) return CLASS.warn;
        return CLASS.norm;
    }
    /* Прогон режима по истории отклонений: сколько дало бы тревог и предупреждений (для настройки допуска). */
    function replay(devs, mode, over) {
        var out = { 'Норма': 0, 'Открытая дверь': 0, 'Предупреждение': 0, 'Тревога': 0 };
        (devs || []).forEach(function (d) { out[classify(d, mode, over)]++; });
        return out;
    }

    function isOpen(a) { return a.status !== 'Закрыта'; }
    function acceptedAt(a) {
        var t = hm(a.acceptTime); if (t === null) return null;
        var st = stamp(a.date, a.time), acc = stamp(a.date, a.acceptTime);
        return acc < st ? acc + 1440 : acc; /* принятие после полуночи - следующие сутки */
    }
    /* Срок реакции и эскалация. Тревога срабатывает в a.date a.time (уже после «времени до тревоги»).
       Пока не принята, каждые escalate минут переходит к следующему звену маршрута. */
    function escalation(a, mode, chain, now) {
        var st = stamp(a.date, a.time), react = num(mode.react) || 15, esc = num(mode.escalate) || 15, acc = acceptedAt(a);
        var deadline = st + react, n = (chain || []).length;
        if (acc !== null) {
            var lvlA = n ? Math.min(n - 1, Math.max(0, Math.floor((acc - st) / esc))) : 0;
            return { state: acc > deadline ? 'late' : 'accepted', took: acc - st, level: lvlA, who: a.resp || (chain[lvlA] || {}).who || '', deadline: deadline, left: deadline - acc };
        }
        var el = now - st, lvl = n ? Math.min(n - 1, Math.max(0, Math.floor(el / esc))) : 0;
        var next = lvl < n - 1 ? st + (lvl + 1) * esc : null;
        return { state: now > deadline ? 'overdue' : (deadline - now <= 5 ? 'soon' : 'ok'), took: null, level: lvl, who: (chain[lvl] || {}).who || '', role: (chain[lvl] || {}).role || '',
            deadline: deadline, left: deadline - now, nextAt: next, nextWho: next ? chain[lvl + 1].who : '', noOne: n === 0 };
    }
    /* Статус объекта: худший класс открытых тревог по его зонам. */
    function objectState(objName, alarms) {
        var open = (alarms || []).filter(function (a) { return a.obj === objName && isOpen(a); });
        var worst = open.reduce(function (w, a) { return CLASS_RANK[a.cls] > CLASS_RANK[w] ? a.cls : w; }, CLASS.norm);
        return { state: worst, open: open };
    }
    /* Партии, лежавшие в зоне в момент отклонения: поступили до, выбыли после (или ещё лежат). */
    function batchesAt(batches, zone, dateIso, time) {
        var t = stamp(dateIso, time);
        return (batches || []).filter(function (b) {
            if (b.zone !== zone) return false;
            if (!b.inDate || stamp(b.inDate, '00:00') > t) return false;
            return !b.outDate || stamp(b.outDate, '23:59') >= t;
        });
    }
    var DECISIONS = ['Годна', 'Карантин до оценки производителя', 'Списание'];
    /* Акт можно утвердить, только если указана причина и по каждой партии зоны принято решение из справочника. */
    function actErrors(act, batches, decisions) {
        var errs = [];
        if (!String(act.cause || '').trim()) errs.push('Укажите причину отклонения.');
        var dec = {}; (decisions || []).forEach(function (d) { dec[d.batch] = d.decision; });
        (batches || []).forEach(function (b) {
            if (!dec[b.name]) errs.push('Нет решения по партии ' + b.name + ' (' + b.drug + ').');
            else if (DECISIONS.indexOf(dec[b.name]) < 0) errs.push('Решение «' + dec[b.name] + '» не из справочника.');
        });
        return errs;
    }
    /* Журнал для проверки за период: строки тревог с реакцией и решением, итоги. */
    function journal(alarms, acts, modeOf, from, to) {
        var actBy = {}; (acts || []).forEach(function (x) { actBy[x.alarm] = x; });
        var rows = (alarms || []).filter(function (a) { var d = toIso(a.date); return d >= from && d <= to; }).map(function (a) {
            var acc = acceptedAt(a), mode = modeOf(a) || {}, act = actBy[a.code];
            var took = acc === null ? null : acc - stamp(a.date, a.time);
            return { alarm: a, took: took, late: took === null ? isOpen(a) : took > (num(mode.react) || 15), act: act || null, needAct: a.cls === CLASS.alarm, approved: !!(act && act.status === 'Утверждён') };
        }).sort(function (x, y) { return stamp(x.alarm.date, x.alarm.time) - stamp(y.alarm.date, y.alarm.time); });
        var alarmsOnly = rows.filter(function (r) { return r.needAct; }), tooks = rows.filter(function (r) { return r.took !== null; }).map(function (r) { return r.took; });
        tooks.sort(function (a, b) { return a - b; });
        return { rows: rows, total: rows.length, alarms: alarmsOnly.length, late: rows.filter(function (r) { return r.late; }).length,
            withAct: alarmsOnly.filter(function (r) { return r.approved; }).length, noAct: alarmsOnly.filter(function (r) { return !r.approved; }).length,
            medianTook: tooks.length ? tooks[Math.floor((tooks.length - 1) / 2)] : null };
    }
    function nextCode(codes, prefix, width) {
        var max = 0; (codes || []).forEach(function (c) { var m = String(c).match(/(\d+)$/); if (m && +m[1] > max) max = +m[1]; });
        var s = String(max + 1); while (s.length < width) s = '0' + s; return prefix + s;
    }
    /* Шлюз пишет отклонение; режим зоны решает, будет ли тревога и кому она уйдёт. */
    function processDeviation(dev, ctx) {
        var mode = ctx.modeOfZone(dev.zone); if (!mode) return null;
        var cls = classify(dev, mode);
        if (cls === CLASS.norm || cls === CLASS.door) return { cls: cls, mode: mode, alarm: null };
        var trig = cls === CLASS.alarm ? fromStamp(stamp(dev.date, dev.time) + num(mode.delay)) : { date: toIso(dev.date), time: dev.time };
        var chain = route(ctx.objOfZone(dev.zone), ctx.duties, trig.date, trig.time, ctx.head);
        var alarm = { code: nextCode(ctx.codes, 'ТР-', 4), obj: (ctx.objOfZone(dev.zone) || {}).name, zone: dev.zone, sensor: dev.sensor, cls: cls,
            date: trig.date, time: trig.time, minutes: num(dev.minutes), peak: num(dev.peak), status: 'Новая', resp: chain.length ? chain[0].who : '' };
        return { cls: cls, mode: mode, alarm: alarm, chain: chain };
    }

    return {
        CLASS: CLASS, DECISIONS: DECISIONS, num: num, toIso: toIso, toDmy: toDmy, toShort: toShort, addDays: addDays, hm: hm, fmtHm: fmtHm, stamp: stamp, fromStamp: fromStamp, durText: durText,
        shiftOf: shiftOf, onDuty: onDuty, isOpenHours: isOpenHours, route: route, classify: classify, replay: replay, isOpen: isOpen, acceptedAt: acceptedAt, escalation: escalation,
        objectState: objectState, batchesAt: batchesAt, actErrors: actErrors, journal: journal, nextCode: nextCode, processDeviation: processDeviation
    };
});
