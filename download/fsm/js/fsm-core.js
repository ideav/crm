/* FSM: чистые функции расчёта (время, SLA, подбор инженера, KPI, акт, склад в машине). Без DOM и сети: работает и в браузере, и в Node.
   Время везде - «настенные» миллисекунды по Москве: значение epoch сервера + 3 ч, поля читаются как UTC. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.FsmCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var MIN = 60000, HOUR = 3600000, DAY = 86400000, TZ = 3 * HOUR;
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    function num(v) { var n = parseFloat(String(v === undefined || v === null || v === '' ? 0 : v).replace(',', '.')); return isNaN(n) ? 0 : n; }
    function round2(x) { return Math.round(x * 100) / 100; }
    /* epoch (сек) | 'ГГГГ-ММ-ДД[ Т]ЧЧ:ММ[:СС]' | 'ДД.ММ.ГГГГ[ ЧЧ:ММ]' -> настенные мс; пусто -> 0 */
    function parseDt(v) {
        if (v === undefined || v === null || v === '') return 0;
        var s = String(v), m;
        if (/^\d{9,11}$/.test(s)) return (+s) * 1000 + TZ;
        if ((m = /^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d))?/.exec(s))) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
        if ((m = /^(\d\d)\.(\d\d)\.(\d{4})(?: (\d\d):(\d\d))?/.exec(s))) return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
        return 0;
    }
    function toApi(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()) + ' ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':00'; }
    function isoDate(ms) { return toApi(ms).slice(0, 10); }
    function dateMs(iso) { return parseDt(iso); }
    function fmtTime(ms) { if (!ms) return ''; var d = new Date(ms); return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()); }
    function fmtDate(ms) { if (!ms) return ''; var d = new Date(ms); return p2(d.getUTCDate()) + '.' + p2(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear(); }
    function fmtShort(ms) { if (!ms) return ''; var d = new Date(ms); return p2(d.getUTCDate()) + '.' + p2(d.getUTCMonth() + 1) + ' ' + fmtTime(ms); }
    function fmtDt(ms) { return ms ? fmtDate(ms) + ' ' + fmtTime(ms) : ''; }
    function dayStart(ms) { return Math.floor(ms / DAY) * DAY; }
    function sameDay(a, b) { return dayStart(a) === dayStart(b); }
    function minutesOfDay(hhmm) { var p = String(hhmm || '').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); }
    function fmtDur(min) { min = Math.abs(Math.round(min)); var h = Math.floor(min / 60), m = min % 60; return h ? h + ' ч' + (m ? ' ' + m + ' мин' : '') : m + ' мин'; }
    function fmtKm(km) { return (Math.round(km * 10) / 10).toFixed(1).replace('.', ','); }

    /* ---------- SLA ---------- */
    var OPEN = { 'Новый': 1, 'Назначен': 1, 'В пути': 1, 'На объекте': 1, 'Ждёт запчасти': 1 };
    function isOpen(o) { return !!OPEN[o.status]; }
    /* Состояние SLA наряда. stage: arrive | finish | done | cancel; state: ok | risk | late | met | missed | none; left - минут до срока (отрицательно - просрочено). */
    function slaState(o, now) {
        if (o.status === 'Отменён') return { stage: 'cancel', state: 'none', left: 0, due: 0, text: 'отменён' };
        var stage = !o.arr ? 'arrive' : !o.fin ? 'finish' : 'done', due, left;
        if (stage === 'done') {
            var met = o.arr <= o.arrDue && o.fin <= o.finDue;
            return { stage: stage, state: met ? 'met' : 'missed', left: 0, due: o.finDue, text: met ? 'в срок' : 'с просрочкой' };
        }
        due = stage === 'arrive' ? o.arrDue : o.finDue; left = Math.round((due - now) / MIN);
        var state = left < 0 ? 'late' : left <= 30 ? 'risk' : 'ok';
        return { stage: stage, state: state, left: left, due: due, text: (left < 0 ? 'просрочено ' : 'осталось ') + fmtDur(left) };
    }
    /* Для KPI: наряд «в срок» - прибыл и завершил в сроки; открытый просроченный - нарушение; открытый в срок - не учитывается. */
    function slaOutcome(o, now) {
        if (o.status === 'Отменён') return 'skip';
        var s = slaState(o, now);
        if (s.state === 'met') return 'met';
        if (s.state === 'missed' || s.state === 'late') return 'missed';
        if (o.arr && o.arr > o.arrDue) return 'missed';
        return 'open';
    }

    /* ---------- география ---------- */
    function haversine(lat1, lon1, lat2, lon2) {
        var R = 6371, rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * R * Math.asin(Math.sqrt(a)) * 1.3; /* коэффициент извилистости городских дорог */
    }
    function travelMin(km) { return Math.round(km / 27 * 60) + 5; }

    /* ---------- подбор инженера ---------- */
    function skillOk(eng, skill, atMs) {
        var k = (eng.skills || []).filter(function (s) { return s.skill === skill; })[0];
        if (!k) return { has: false };
        var until = k.until ? parseDt(k.until) : 0;
        if (until && until + DAY - MIN < atMs) return { has: true, valid: false, until: until };
        return { has: true, valid: true, until: until, soon: !!until && until - atMs < 30 * DAY };
    }
    /* Окно, под которое подбираем: окно наряда, иначе от «сейчас» на нормочасы. */
    function orderWindow(o, work, now) {
        if (o.win0 && o.win1) return [Math.max(o.win0, 0), o.win1];
        var a = Math.max(now, o.created || now); return [a, a + Math.max(work ? work.norm : 1, 1) * HOUR];
    }
    function engOrders(name, orders, exceptId) {
        return orders.filter(function (x) { return x.eng === name && x.id !== exceptId && x.status !== 'Отменён' && x.status !== 'Закрыт'; });
    }
    /* ctx: {engineers, orders, objects{name:{lat,lon,district}}, works{name:{skill,norm}}, now}. Возвращает инженеров по убыванию пригодности. */
    function rankEngineers(o, ctx) {
        var work = ctx.works[o.wt] || { skill: '', norm: 1 }, ob = ctx.objects[o.obj] || {}, w = orderWindow(o, work, ctx.now), day = dayStart(w[0]);
        var out = ctx.engineers.map(function (e) {
            var reasons = [], blockers = [], score = 100;
            var sk = skillOk(e, work.skill, w[0]);
            if (!e.works) blockers.push('не работает (отпуск или больничный)');
            if (!sk.has) blockers.push('нет навыка «' + work.skill + '»');
            else if (!sk.valid) blockers.push('допуск «' + work.skill + '» истёк ' + fmtDate(sk.until));
            else reasons.push({ t: sk.soon ? 'warn' : 'ok', s: 'Навык «' + work.skill + '»' + (sk.until ? ', допуск до ' + fmtDate(sk.until) : '') + (sk.soon ? ' (скоро истекает)' : '') });
            if (sk.soon) score -= 5;
            var mine = engOrders(e.name, ctx.orders, o.id), sameDay = mine.filter(function (x) { return sameDay_(x, day); });
            var busy = sameDay.filter(function (x) {
                var a = x.win0 || x.created, b = x.win1 || (a + 2 * HOUR);
                if (x.status === 'На объекте' || x.status === 'Ждёт запчасти') b = Math.max(b, ctx.now + 30 * MIN);
                return a < w[1] && b > w[0];
            });
            if (busy.length) blockers.push('занят в окне: ' + busy[0].num + ' ' + fmtTime(busy[0].win0 || busy[0].created) + '-' + fmtTime(busy[0].win1));
            else reasons.push({ t: 'ok', s: 'Свободен в окне ' + fmtTime(w[0]) + '-' + fmtTime(w[1]) });
            var max = e.max || 6;
            if (sameDay.length >= max) blockers.push('лимит нарядов на день: ' + sameDay.length + ' из ' + max);
            else reasons.push({ t: sameDay.length >= max - 1 ? 'warn' : 'ok', s: 'Нарядов на день: ' + sameDay.length + ' из ' + max });
            score -= 6 * sameDay.length;
            var s0 = minutesOfDay(e.from || '08:00'), s1 = minutesOfDay(e.to || '18:00'), m0 = (w[0] - day) / MIN, m1 = (w[1] - day) / MIN;
            if (m0 < s0 - 1 || m1 > s1 + 30) blockers.push('вне смены ' + (e.from || '') + '-' + (e.to || ''));
            var km = 0, mins = 0, fromBase = day !== dayStart(ctx.now);
            if (ob.lat && e.lat) { km = haversine(e.lat, e.lon, ob.lat, ob.lon); mins = travelMin(km); reasons.push({ t: km > 12 ? 'warn' : 'ok', s: 'До объекта ' + fmtKm(km) + ' км, около ' + mins + ' мин' + (fromBase ? ' (от базы)' : ' (от текущей позиции)') }); }
            score -= 2.5 * km;
            if (ob.district && e.district === ob.district) { score += 5; reasons.push({ t: 'ok', s: 'Работает в этом районе' }); }
            return { eng: e.name, e: e, ok: !blockers.length, score: round2(blockers.length ? score - 1000 : score), km: round2(km), min: mins, count: sameDay.length, max: max, reasons: reasons, blockers: blockers };
        });
        out.sort(function (a, b) { return b.score - a.score; });
        return out;
    }
    function sameDay_(x, day) { var a = x.win0 || x.created; return dayStart(a) === day; }

    /* ---------- KPI ---------- */
    function kpi(orders, from, to, now) {
        var list = orders.filter(function (o) { return o.status !== 'Отменён' && o.created >= from && o.created < to; });
        var met = 0, missed = 0, open = 0, lateOpen = 0, rep = 0, fin = 0, same = 0, react = 0, reactN = 0, byEng = {};
        list.forEach(function (o) {
            var r = slaOutcome(o, now); if (r === 'met') met++; else if (r === 'missed') missed++; else open++;
            if (isOpen(o) && slaState(o, now).state === 'late') lateOpen++;
            if (o.repeat) rep++;
            if (o.fin) { fin++; if (sameDay(o.arr, o.fin)) same++; var d = isoDate(o.fin); var k = o.eng + '|' + d; byEng[k] = 1; }
            if (o.arr && o.prio !== 'Плановое ТО') { react += (o.arr - o.created) / MIN; reactN++; } /* плановое ТО создаётся заранее: время реакции к нему не относится */
        });
        var engDays = Object.keys(byEng).length;
        return { total: list.length, finished: fin, met: met, missed: missed, open: open, lateOpen: lateOpen, repeat: rep,
            slaPct: met + missed ? round2(met / (met + missed) * 100) : 0, repeatPct: list.length ? round2(rep / list.length * 100) : 0,
            sameDayPct: fin ? round2(same / fin * 100) : 0, reactMin: reactN ? Math.round(react / reactN) : 0, perEngDay: engDays ? round2(fin / engDays) : 0 };
    }
    /* Недели (с понедельника) в порядке возрастания: [{start, total, slaPct, repeat, missed}] */
    function weekly(orders, now, weeks) {
        var d0 = dayStart(now), dow = (new Date(d0).getUTCDay() + 6) % 7, mon = d0 - dow * DAY, out = [];
        for (var i = weeks - 1; i >= 0; i--) {
            var a = mon - i * 7 * DAY, k = kpi(orders, a, a + 7 * DAY, now);
            out.push({ start: a, total: k.total, slaPct: k.slaPct, repeat: k.repeat, missed: k.missed, met: k.met });
        }
        return out;
    }

    /* ---------- акт и склад ---------- */
    function matSum(m) { return Math.round(num(m.qty) * num(m.price)); }
    function actTotals(work, mats, warranty) {
        var w = num(work && work.price), m = (mats || []).reduce(function (s, x) { return s + matSum(x); }, 0);
        return { works: w, mats: m, sum: w + m, total: warranty ? 0 : w + m, warranty: !!warranty };
    }
    function checkProgress(items) { var d = items.filter(function (x) { return x.done; }).length; return { done: d, total: items.length, pct: items.length ? Math.round(d / items.length * 100) : 0 }; }
    /* Остатки склада в машине после списания материалов нарядa (только источник «Склад в машине»). Возвращает [{name, qty, min, low, used}]. */
    function stockAfter(stock, mats) {
        var used = {}; (mats || []).forEach(function (m) { if (m.src === 'Склад в машине' || !m.src) used[m.name] = (used[m.name] || 0) + num(m.qty); });
        return stock.map(function (s) {
            var u = used[s.name] || 0, q = Math.max(0, round2(num(s.qty) - u));
            return { name: s.name, qty: q, min: num(s.min), used: u, low: q < num(s.min), id: s.id, short: u > num(s.qty) };
        });
    }
    /* ---------- оборудование: гарантия, история ремонтов, повторные выезды (экран инженера) ---------- */
    /* Гарантия: until - дата ('ГГГГ-ММ-ДД'/'ДД.ММ.ГГГГ'/epoch); state: on | off | none. */
    function warrantyState(until, now) {
        var u = parseDt(until); if (!u) return { state: 'none', until: 0, text: 'гарантия не указана' };
        return u + DAY - MIN >= now ? { state: 'on', until: u, text: 'на гарантии до ' + fmtDate(u) } : { state: 'off', until: u, text: 'гарантия истекла ' + fmtDate(u) };
    }
    function orderDate(o) { return o.fin || o.arr || o.dep || o.win0 || o.created || 0; }
    /* Другие наряды по оборудованию, от новых к старым (кроме отменённых и самого наряда). */
    function equipHistory(orders, eq, exceptId, limit) {
        var list = orders.filter(function (x) { return x.eq === eq && x.id !== exceptId && x.status !== 'Отменён'; });
        list.sort(function (a, b) { return orderDate(b) - orderDate(a); });
        return limit ? list.slice(0, limit) : list;
    }
    /* Выезды по оборудованию за последние days суток до now (наряды, где инженер выезжал, прибыл или завершил). */
    function recentVisits(orders, eq, exceptId, now, days) {
        return equipHistory(orders, eq, exceptId).filter(function (x) {
            var d = x.fin || x.arr || x.dep; return d && d <= now && now - d <= (days || 30) * DAY;
        });
    }
    /* ---------- акт и справочники (экраны актов и справочников) ---------- */
    /* Сумма прописью: rubWords(12300) -> 'Двенадцать тысяч триста рублей 00 копеек'. */
    function rubWords(n) {
        n = Math.round(Math.abs(num(n)) * 100) / 100;
        var rub = Math.floor(n), kop = Math.round((n - rub) * 100);
        var ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'], onesF = ['', 'одна', 'две'],
            teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'],
            tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'],
            hund = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
        function plural(k, a, b, c) { var m100 = k % 100, m10 = k % 10; if (m100 >= 11 && m100 <= 19) return c; return m10 === 1 ? a : m10 >= 2 && m10 <= 4 ? b : c; }
        function triad(k, fem) {
            var out = [], h = Math.floor(k / 100), t = Math.floor(k / 10) % 10, o = k % 10;
            if (h) out.push(hund[h]);
            if (t === 1) out.push(teens[o]);
            else { if (t) out.push(tens[t]); if (o) out.push(fem && o <= 2 ? onesF[o] : ones[o]); }
            return out;
        }
        var parts = [], groups = [[1000000000, 'миллиард', 'миллиарда', 'миллиардов', false], [1000000, 'миллион', 'миллиона', 'миллионов', false], [1000, 'тысяча', 'тысячи', 'тысяч', true]], rest = rub;
        groups.forEach(function (g) {
            var k = Math.floor(rest / g[0]) % 1000;
            if (k) { parts = parts.concat(triad(k, g[4])); parts.push(plural(k, g[1], g[2], g[3])); }
        });
        var low = rest % 1000;
        if (low) parts = parts.concat(triad(low, false));
        if (!rub) parts.push('ноль');
        var s = parts.join(' '); s = s.charAt(0).toUpperCase() + s.slice(1);
        return s + ' ' + plural(rub, 'рубль', 'рубля', 'рублей') + ' ' + p2(kop) + ' ' + plural(kop, 'копейка', 'копейки', 'копеек');
    }
    /* Покрытие навыков допусками на момент at: [{skill, valid, soon, expired, nodoc}] по навыкам, а также счётчики истекающих и истёкших допусков. */
    function skillCoverage(engineers, at) {
        var by = {}, soon = 0, expired = 0;
        engineers.forEach(function (e) {
            (e.skills || []).forEach(function (k) {
                var s = by[k.skill] = by[k.skill] || { skill: k.skill, valid: 0, soon: 0, expired: 0, nodoc: 0 };
                var r = skillOk(e, k.skill, at);
                if (!r.valid) { s.expired++; expired++; } else { if (!k.until) s.nodoc++; if (r.soon) { s.soon++; soon++; } if (e.works !== false) s.valid++; }
            });
        });
        return { skills: Object.keys(by).sort().map(function (k) { return by[k]; }), soon: soon, expired: expired };
    }
    /* Позиции склада в машинах ниже минимума: [{eng, name, qty, min}]. */
    function lowStock(engineers) {
        var out = [];
        engineers.forEach(function (e) { (e.stock || []).forEach(function (s) { if (num(s.qty) < num(s.min)) out.push({ eng: e.name, name: s.name, qty: num(s.qty), min: num(s.min) }); }); });
        return out;
    }
    /* Статистика заказчика за days суток до now: число нарядов, доля в срок (slaOutcome). */
    function clientStats(orders, client, now, days) {
        var list = orders.filter(function (o) { return o.client === client && o.status !== 'Отменён' && o.created <= now && now - o.created <= (days || 30) * DAY; });
        var met = 0, missed = 0;
        list.forEach(function (o) { var r = slaOutcome(o, now); if (r === 'met') met++; else if (r === 'missed') missed++; });
        return { orders: list.length, met: met, missed: missed, slaPct: met + missed ? round2(met / (met + missed) * 100) : 0, hasSla: met + missed > 0 };
    }
    var FLOW = { 'Назначен': 'В пути', 'В пути': 'На объекте', 'На объекте': 'Выполнен', 'Ждёт запчасти': 'На объекте' };
    function nextStatus(st) { return FLOW[st] || ''; }
    function distCsv(rows, cols) {
        var esc = function (v) { v = v === undefined || v === null ? '' : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        return cols.map(function (c) { return esc(c[1]); }).join(';') + '\n' + rows.map(function (r) { return cols.map(function (c) { return esc(r[c[0]]); }).join(';'); }).join('\n');
    }
    return {
        MIN: MIN, HOUR: HOUR, DAY: DAY, num: num, round2: round2, parseDt: parseDt, toApi: toApi, isoDate: isoDate, dateMs: dateMs, fmtTime: fmtTime, fmtDate: fmtDate, fmtShort: fmtShort, fmtDt: fmtDt,
        dayStart: dayStart, sameDay: sameDay, minutesOfDay: minutesOfDay, fmtDur: fmtDur, fmtKm: fmtKm, isOpen: isOpen, slaState: slaState, slaOutcome: slaOutcome, haversine: haversine, travelMin: travelMin,
        skillOk: skillOk, orderWindow: orderWindow, rankEngineers: rankEngineers, kpi: kpi, weekly: weekly, matSum: matSum, actTotals: actTotals, checkProgress: checkProgress,
        stockAfter: stockAfter, nextStatus: nextStatus, toCsv: distCsv,
        rubWords: rubWords, skillCoverage: skillCoverage, lowStock: lowStock, clientStats: clientStats,
        warrantyState: warrantyState, equipHistory: equipHistory, recentVisits: recentVisits
    };
});
