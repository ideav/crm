/* Лояльность: чистые функции (партии бонусов и сгорание, расчёт чека по механике и правилам, конфликт акции и бонусов, RFM, кому написать, инкрементальность кампании, обязательства, проверка ручных операций). Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.LoyaltyCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var DAY = 86400000;
    var DEFAULT_PROGRAM = { mech: 'cashback', percent: 5, limit: 30, life: 90, nth: 6, giftPrice: 220, welcome: 100, bonusOnPromo: false, manualMax: 300, lostDays: 30 };
    /* Механики: ключ по названию записи «Механика». Собранные в базовой коробке считаются, остальные - опции. */
    var MECHS = { 'Кэшбэк бонусами': 'cashback', 'Каждая N-я в подарок': 'nth', 'Предоплаченная карта': 'prepaid', 'Абонемент на N напитков': 'pass', 'Предзаказ ко времени': 'preorder' };

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
    function toDmy(s) { return s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : ''; }
    function num(x) { var n = parseFloat(String(x === undefined || x === null ? '' : x).replace(',', '.').replace(/\s/g, '')); return isNaN(n) ? 0 : n; }
    function round2(x) { return Math.round(x * 100) / 100; }
    function mechKey(name) { return MECHS[name] || 'cashback'; }
    function isBuilt(key) { return key === 'cashback' || key === 'nth'; }

    /* Партии бонусов. Каждое начисление - партия со своим сроком; списание и сгорание гасят партии
       с ближайшим сроком. Партия живёт до даты «Сгорает» (в этот день уже сгорела).
       ops: [{date, bonus, expires}] ; возвращает {balance, lots, expiredUnburned, expiring(days)} на дату today. */
    function lots(ops, today) {
        var list = ops.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (b.bonus - a.bonus); });
        var L = [], overdraft = 0;
        list.forEach(function (o) {
            var b = num(o.bonus);
            if (b > 0) { L.push({ date: o.date, expires: o.expires || '', amount: b, left: b }); return; }
            var need = -b;
            var open = L.filter(function (l) { return l.left > 0 && l.date <= o.date; })
                .sort(function (x, y) { return (x.expires || '9999') < (y.expires || '9999') ? -1 : (x.expires || '9999') > (y.expires || '9999') ? 1 : 0; });
            open.forEach(function (l) { var t = Math.min(l.left, need); l.left = round2(l.left - t); need = round2(need - t); });
            overdraft = round2(overdraft + need);
        });
        var alive = L.filter(function (l) { return l.left > 0 && (!l.expires || l.expires > today); });
        var dead = L.filter(function (l) { return l.left > 0 && l.expires && l.expires <= today; });
        var bal = round2(alive.reduce(function (s, l) { return s + l.left; }, 0));
        return {
            balance: bal, lots: alive, overdraft: overdraft,
            expiredUnburned: round2(dead.reduce(function (s, l) { return s + l.left; }, 0)),
            expiring: function (days) { var lim = addDays(today, days); return round2(alive.filter(function (l) { return l.expires && l.expires <= lim; }).reduce(function (s, l) { return s + l.left; }, 0)); },
            nextBurn: alive.filter(function (l) { return l.expires; }).sort(function (a, b) { return a.expires < b.expires ? -1 : 1; })[0] || null
        };
    }
    /* Операции сгорания, которые пора провести на дату today (по одной на просроченную партию с остатком). */
    function burnOps(ops, today) {
        var r = lots(ops, '0000-00-00'), out = [];
        /* lots(..., '0000') оставляет все партии живыми - нужен остаток каждой */
        r.lots.forEach(function (l) { if (l.expires && l.expires <= today) out.push({ date: l.expires, bonus: -l.left, lotDate: l.date }); });
        return out;
    }

    /* Правило гостя: личное перекрывает программу. */
    function ruleFor(program, person) {
        var p = Object.assign({}, DEFAULT_PROGRAM, program || {});
        var own = person || {};
        return {
            percent: num(own.percent) > 0 ? num(own.percent) : p.percent,
            limit: num(own.limit) > 0 ? num(own.limit) : p.limit,
            personal: num(own.percent) > 0 || num(own.limit) > 0,
            text: own.rule || ''
        };
    }
    /* Акция действует для чека? Условие «День рождения» - за 3 дня до и 3 после. */
    function promoApplies(promo, date, birthday) {
        if (!promo) return false;
        if (promo.from && date < promo.from) return false;
        if (promo.to && date > promo.to) return false;
        if (/день рождения/i.test(promo.cond || '')) {
            if (!birthday) return false;
            var y = date.slice(0, 4), bd = y + birthday.slice(4);
            var d = Math.abs(diffDays(bd, date));
            if (d > 3 && Math.abs(diffDays((+y - 1) + birthday.slice(4), date)) > 3 && Math.abs(diffDays((+y + 1) + birthday.slice(4), date)) > 3) return false;
        }
        return true;
    }

    /* Тестовый чек: q = {sum, drinks, wantBonus, date}, ctx = {program, person, promo, balance, stamps, mech}.
       Возвращает раскладку: скидка акции, сколько можно и сколько списано бонусами, начисление, подарок, к оплате, конфликты. */
    function calcCheck(q, ctx) {
        var P = Object.assign({}, DEFAULT_PROGRAM, ctx.program || {});
        var mech = ctx.mech || P.mech, rule = ruleFor(P, ctx.person);
        var sum = Math.max(0, num(q.sum)), drinks = Math.max(0, Math.floor(num(q.drinks)));
        var r = { mech: mech, option: !isBuilt(mech), discount: 0, gift: 0, gifts: 0, bonusMax: 0, bonusUsed: 0, accrue: 0, toPay: sum, conflicts: [], notes: [], rule: rule };
        if (r.option) { r.notes.push('Механика подключается по запросу: на демо не собрана.'); return r; }
        var promo = ctx.promo && promoApplies(ctx.promo, q.date || '', ctx.person && ctx.person.birthday) ? ctx.promo : null;
        if (ctx.promo && !promo) r.notes.push('Акция «' + ctx.promo.name + '» к этому чеку не применяется.');
        if (mech === 'nth') {
            var n = P.nth > 0 ? P.nth : 6, before = Math.max(0, Math.floor(num(ctx.stamps))) % n;
            r.gifts = Math.min(drinks, Math.floor((before + drinks) / n));
            r.gift = Math.min(sum, r.gifts * num(P.giftPrice));
            r.stampsAfter = (before + drinks) % n;
        }
        var base = sum - r.gift;
        if (promo) r.discount = Math.round(base * num(promo.discount)) / 100;
        base = round2(base - r.discount);
        r.bonusMax = Math.floor(Math.min(num(ctx.balance), base * rule.limit / 100));
        var want = Math.max(0, Math.floor(num(q.wantBonus)));
        if (promo && !promo.bonusAllowed && !P.bonusOnPromo) {
            if (want > 0) r.conflicts.push('Акция «' + promo.name + '»: бонусами в этот чек платить нельзя - скидка и списание вместе дают двойную выгоду.');
            r.bonusMax = 0;
        }
        if (want > r.bonusMax && r.bonusMax > 0 && want > 0) r.notes.push('Списать можно не больше ' + r.bonusMax + ' (лимит ' + rule.limit + '% чека и баланс).');
        r.bonusUsed = Math.min(want, r.bonusMax);
        r.toPay = round2(base - r.bonusUsed);
        if (mech === 'cashback') r.accrue = Math.floor(r.toPay * rule.percent / 100);
        return r;
    }
    /* Аудит проведённых чеков: акция без права на бонусы, а бонусами всё равно заплатили. */
    function checkConflicts(checks, promoBy, program) {
        var P = Object.assign({}, DEFAULT_PROGRAM, program || {});
        return checks.filter(function (c) {
            var p = c.promo && promoBy[c.promo];
            return p && !p.bonusAllowed && !P.bonusOnPromo && num(c.paidBonus) > 0;
        });
    }

    /* RFM на дату today по визитам за 90 дней. v = {last, first, visits90, sum90}. */
    var SEGMENTS = ['Чемпион', 'Лояльный', 'Растущий', 'Новичок', 'Под угрозой ухода', 'Спящий', 'Потерянный'];
    function rfm(v, today, lostDays) {
        var lost = lostDays || DEFAULT_PROGRAM.lostDays;
        var d = v.last ? diffDays(v.last, today) : 999;
        var R = d <= 7 ? 5 : d <= 14 ? 4 : d <= lost ? 3 : d <= lost * 2 ? 2 : 1;
        var f = num(v.visits90), F = f >= 24 ? 5 : f >= 12 ? 4 : f >= 6 ? 3 : f >= 2 ? 2 : 1;
        var m = num(v.sum90), M = m >= 15000 ? 5 : m >= 8000 ? 4 : m >= 4000 ? 3 : m >= 1500 ? 2 : 1;
        var seg;
        if (v.first && diffDays(v.first, today) <= 30 && R >= 3) seg = 'Новичок';
        else if (R >= 4 && F >= 4) seg = 'Чемпион';
        else if (R >= 3 && F >= 3) seg = 'Лояльный';
        else if (R <= 2 && F >= 3) seg = 'Под угрозой ухода';
        else if (R >= 3) seg = 'Растущий';
        else if (R === 2) seg = 'Спящий';
        else seg = 'Потерянный';
        return { R: R, F: F, M: M, days: d, segment: seg, code: '' + R + F + M };
    }
    /* Кому написать: g = [{name, consent, segment, days, balance, expiring14, birthday, sum90}]. Приоритет: под угрозой с бонусами,
       сгорание в 14 дней, день рождения в 7 дней, спящие с балансом. Без согласия на рассылку - в список не попадает. */
    function whomToWrite(guests, today) {
        var out = [];
        guests.forEach(function (g) {
            if (!g.consent) return;
            var why = [], score = 0;
            if (g.segment === 'Под угрозой ухода') { why.push('не был ' + g.days + ' дн., раньше ходил часто'); score += 50 + Math.min(30, num(g.sum90) / 500); }
            if (g.expiring14 > 0) { why.push('сгорит ' + Math.round(g.expiring14) + ' бонусов за 14 дн.'); score += 20 + Math.min(20, g.expiring14 / 50); }
            if (g.birthday) {
                var y = today.slice(0, 4), bd = y + g.birthday.slice(4), dd = diffDays(today, bd);
                if (dd < 0) dd = diffDays(today, (+y + 1) + g.birthday.slice(4));
                if (dd <= 7) { why.push('день рождения через ' + dd + ' дн.'); score += 15; }
            }
            if (g.segment === 'Спящий' && g.balance > 0) { why.push('спит, на счёте ' + Math.round(g.balance) + ' бонусов'); score += 10; }
            if (why.length) out.push({ name: g.name, segment: g.segment, why: why, score: Math.round(score) });
        });
        return out.sort(function (a, b) { return b.score - a.score || (a.name < b.name ? -1 : 1); });
    }
    /* Инкрементальность кампании против контрольной группы. */
    function uplift(c) {
        var sent = num(c.sent), back = num(c.back), ctl = num(c.control), ctlBack = num(c.controlBack);
        var conv = sent > 0 ? back / sent : 0, base = ctl > 0 ? ctlBack / ctl : 0;
        var pp = Math.round((conv - base) * 1000) / 10;
        return { conv: Math.round(conv * 1000) / 10, base: Math.round(base * 1000) / 10, pp: pp, extra: Math.round((conv - base) * sent), effective: ctl > 0 && pp >= 5, noControl: !(ctl > 0) };
    }

    /* Обязательства перед участниками на дату today: byGuest = {имя: {lots, point}}; 1 бонус = rate рублей. */
    function liabilities(byGuest, today, rate) {
        var k = rate || 1, total = 0, guests = 0, d14 = 0, d30 = 0, byMonth = {}, byPoint = {};
        var lim14 = addDays(today, 14), lim30 = addDays(today, 30);
        Object.keys(byGuest).forEach(function (n) {
            var g = byGuest[n], had = false;
            g.lots.forEach(function (l) {
                if (!(l.left > 0) || (l.expires && l.expires <= today)) return;
                had = true; total += l.left;
                if (l.expires && l.expires <= lim14) d14 += l.left;
                if (l.expires && l.expires <= lim30) d30 += l.left;
                var mk = l.expires ? l.expires.slice(0, 7) : 'без срока';
                byMonth[mk] = (byMonth[mk] || 0) + l.left;
                var pk = g.point || 'без точки';
                byPoint[pk] = (byPoint[pk] || 0) + l.left;
            });
            if (had) guests++;
        });
        var months = Object.keys(byMonth).sort().map(function (m) { return { month: m, bonus: Math.round(byMonth[m]), rub: Math.round(byMonth[m] * k) }; });
        var points = Object.keys(byPoint).sort().map(function (p) { return { point: p, bonus: Math.round(byPoint[p]), rub: Math.round(byPoint[p] * k) }; });
        return { total: Math.round(total), rub: Math.round(total * k), guests: guests, d14: Math.round(d14), d30: Math.round(d30), months: months, points: points };
    }

    /* Ручная операция при вводе: причина обязательна, списание не больше баланса, сверх порога - предупреждение. */
    function checkManual(op, balance, program) {
        var P = Object.assign({}, DEFAULT_PROGRAM, program || {});
        var e = [], w = [], b = num(op.bonus);
        if (!b) e.push('Укажите количество бонусов.');
        if (op.manual && !String(op.reason || '').trim()) e.push('Ручная операция без причины не проводится: причина попадёт в журнал.');
        if (op.manual && String(op.reason || '').trim().length > 0 && String(op.reason).trim().length < 5) e.push('Причина слишком короткая: напишите, за что.');
        if (b < 0 && -b > num(balance)) e.push('Списать можно не больше баланса: ' + Math.floor(num(balance)) + '.');
        if (op.manual && Math.abs(b) > P.manualMax) w.push('Больше ' + P.manualMax + ' бонусов вручную: операция попадёт в список на проверку управляющему.');
        return { ok: !e.length, errors: e, warnings: w };
    }
    /* Подозрительные ручные операции: без причины, сверх порога, или один автор чаще 3 раз за 30 дней одному гостю. */
    function suspicious(ops, today, program) {
        var P = Object.assign({}, DEFAULT_PROGRAM, program || {});
        var from = addDays(today, -30), cnt = {}, out = [];
        ops.forEach(function (o) { if (o.manual && o.date > from) { var k = o.author + '|' + o.guest; cnt[k] = (cnt[k] || 0) + 1; } });
        ops.forEach(function (o) {
            if (!o.manual) return;
            var why = [];
            if (!String(o.reason || '').trim()) why.push('нет причины');
            if (Math.abs(num(o.bonus)) > P.manualMax) why.push('больше ' + P.manualMax);
            if (o.date > from && cnt[o.author + '|' + o.guest] > 3) why.push(o.author + ' -> ' + o.guest + ': ' + cnt[o.author + '|' + o.guest] + ' раз за 30 дн.');
            if (why.length) out.push(Object.assign({ why: why }, o));
        });
        return out.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    }
    function toCsv(rows, cols) {
        var q = function (v) { v = String(v === undefined || v === null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        return [cols.map(function (c) { return q(c[1]); }).join(';')].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c[0]]); }).join(';'); })).join('\r\n');
    }

    return {
        DEFAULT_PROGRAM: DEFAULT_PROGRAM, MECHS: MECHS, SEGMENTS: SEGMENTS, utc: utc, iso: iso, addDays: addDays, diffDays: diffDays, toIso: toIso, toDmy: toDmy, num: num, round2: round2,
        mechKey: mechKey, isBuilt: isBuilt, lots: lots, burnOps: burnOps, ruleFor: ruleFor, promoApplies: promoApplies, calcCheck: calcCheck, checkConflicts: checkConflicts,
        rfm: rfm, whomToWrite: whomToWrite, uplift: uplift, liabilities: liabilities, checkManual: checkManual, suspicious: suspicious, toCsv: toCsv
    };
});
