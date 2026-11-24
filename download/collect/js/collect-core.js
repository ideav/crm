/* Взыскание дебиторки: чистые функции расчёта (даты, старение, ступени воронки, пени и проценты, стоп-отгрузка, график реструктуризации, DSO, прогноз). Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.CollectCore = api;
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
    function num(v) {
        var n = parseFloat(String(v === undefined || v === null || v === '' ? 0 : v).replace(/\s/g, '').replace(',', '.'));
        return isNaN(n) ? 0 : n;
    }
    function round2(x) { return Math.round((x + (x >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }
    function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
    /* Сумма в рублях: 1 234 567,89 (неразрывный пробел) */
    function fmtRub(x, kop) {
        var n = round2(num(x)), neg = n < 0, s = Math.abs(n).toFixed(kop ? 2 : 0).replace('.', ',');
        var p = s.split(',');
        p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        return (neg ? '-' : '') + p.join(',');
    }

    /* ---------- Старение ---------- */
    var BUCKETS = [['cur', 'Срок не наступил'], ['b30', '0–30'], ['b60', '31–60'], ['b90', '61–90'], ['b90p', '90+']];
    function overdueDays(due, asOf) { return Math.max(0, diffDays(due, asOf)); }
    function bucketOf(days) {
        if (days <= 0) return 'cur';
        if (days <= 30) return 'b30';
        if (days <= 60) return 'b60';
        if (days <= 90) return 'b90';
        return 'b90p';
    }
    /* Остаток по документам с учётом оплат на дату. docs: {id, client, contract, number, date, due, amount}; pays: {doc, date, amount}. */
    function openDocs(docs, pays, asOf) {
        var paid = {};
        pays.forEach(function (p) { if (p.date <= asOf) paid[p.doc] = (paid[p.doc] || 0) + p.amount; });
        var out = [];
        docs.forEach(function (d) {
            if (d.date > asOf) return;
            var bal = round2(d.amount - (paid[d.id] || 0));
            if (bal <= 0.004) return;
            var days = overdueDays(d.due, asOf);
            out.push({ id: d.id, client: d.client, contract: d.contract, number: d.number, date: d.date, due: d.due, amount: d.amount, paid: round2(paid[d.id] || 0), balance: bal, days: days, bucket: bucketOf(days) });
        });
        return out;
    }
    function emptyAging() { return { cur: 0, b30: 0, b60: 0, b90: 0, b90p: 0, total: 0, overdue: 0 }; }
    function aging(items) {
        var a = emptyAging();
        items.forEach(function (i) {
            a[i.bucket] = round2(a[i.bucket] + i.balance);
            a.total = round2(a.total + i.balance);
            if (i.days > 0) a.overdue = round2(a.overdue + i.balance);
        });
        return a;
    }
    /* Сводка по клиентам: debt, overdue, maxDays, aging, docs. */
    function ledger(docs, pays, asOf) {
        var items = openDocs(docs, pays, asOf), by = {};
        items.forEach(function (i) { (by[i.client] = by[i.client] || []).push(i); });
        var rows = Object.keys(by).map(function (c) {
            var list = by[c], a = aging(list), maxDays = 0, oldest = '';
            list.forEach(function (i) { if (i.days > maxDays) { maxDays = i.days; oldest = i.number; } });
            return { client: c, docs: list, aging: a, debt: a.total, overdue: a.overdue, maxDays: maxDays, oldest: oldest };
        });
        return { items: items, rows: rows, total: aging(items) };
    }

    /* ---------- Ступени воронки ---------- */
    /* stages: [{code, name, from, action, owner}] - from: с какого дня просрочки ступень действует (у «До срока» 0). */
    function stageFor(days, stages) {
        var sorted = stages.filter(function (s) { return s.code !== 'restructuring'; }).sort(function (a, b) { return a.from - b.from; });
        var d = Math.max(0, days), cur = sorted[0];
        sorted.forEach(function (s) { if (s.from >= 1 && s.from <= d) cur = s; });
        return cur;
    }
    /* Ступень клиента: суд и реструктуризация перекрывают возраст долга. */
    function clientStage(days, stages, flags) {
        flags = flags || {};
        var base = stageFor(days, stages);
        var byCode = {}; stages.forEach(function (s) { byCode[s.code] = s; });
        if (flags.court && byCode.court) return { stage: byCode.court, override: 'court' };
        if (flags.restructuring) return { stage: byCode.restructuring || { code: 'restructuring', name: 'Реструктуризация', action: 'Контроль графика', owner: 'Кредитный контролёр' }, override: 'restructuring' };
        return { stage: base, override: '' };
    }

    /* ---------- Стоп-отгрузка ---------- */
    /* client: {limit, key}; m: {maxDays, overdue, debt}; rules: {stopDays, stopSum, byLimit}; opts: {restructOk} */
    function stopDecision(client, m, rules, opts) {
        opts = opts || {};
        var reasons = [];
        if (rules.stopDays > 0 && m.maxDays >= rules.stopDays) reasons.push('просрочка ' + m.maxDays + ' дн. (порог ' + rules.stopDays + ')');
        if (rules.stopSum > 0 && m.overdue >= rules.stopSum) reasons.push('просроченная сумма ' + fmtRub(m.overdue) + ' (порог ' + fmtRub(rules.stopSum) + ')');
        if (rules.byLimit && client.limit > 0 && m.debt > client.limit) reasons.push('долг ' + fmtRub(m.debt) + ' выше лимита ' + fmtRub(client.limit));
        if (!reasons.length) return { stop: false, needDirector: false, reasons: [] };
        if (opts.restructOk) return { stop: false, needDirector: false, reasons: reasons, note: 'отгрузка под действующий график реструктуризации' };
        if (client.key) return { stop: false, needDirector: true, reasons: reasons, note: 'ключевой клиент: решение директора' };
        return { stop: true, needDirector: false, reasons: reasons };
    }

    /* ---------- Пени и проценты ---------- */
    /* Остаток основного долга по дням: платёж уменьшает долг со дня платежа (день платежа не начисляется). */
    function principalCuts(due, amount, pays, toExcl) {
        var list = pays.filter(function (p) { return p.date > due && p.date < toExcl; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
        var cuts = [], rest = amount, prev = null;
        list.forEach(function (p) {
            rest = round2(rest - p.amount);
            cuts.push({ date: p.date, principal: Math.max(0, rest) });
        });
        return cuts;
    }
    function segments(from, toExcl, cutDates) {
        var pts = [from];
        cutDates.forEach(function (d) { if (d > from && d < toExcl && pts.indexOf(d) < 0) pts.push(d); });
        for (var y = +from.slice(0, 4) + 1; y <= +toExcl.slice(0, 4); y++) { var j = y + '-01-01'; if (j > from && j < toExcl && pts.indexOf(j) < 0) pts.push(j); }
        pts.sort();
        var out = [];
        for (var i = 0; i < pts.length; i++) out.push({ from: pts[i], toExcl: i + 1 < pts.length ? pts[i + 1] : toExcl });
        return out;
    }
    function rateAt(rates, date) {
        var cur = null;
        rates.slice().sort(function (a, b) { return a.from < b.from ? -1 : 1; }).forEach(function (r) { if (r.from <= date) cur = r; });
        return cur ? cur.rate : (rates.length ? rates.slice().sort(function (a, b) { return a.from < b.from ? -1 : 1; })[0].rate : 0);
    }
    function principalAt(amount, cuts, date) {
        var p = amount;
        cuts.forEach(function (c) { if (c.date <= date) p = c.principal; });
        return p;
    }
    /* Проценты по ст. 395 ГК: по ключевой ставке, действовавшей в каждый период; год 365/366 дн.; платёж уменьшает базу со дня платежа.
       Начисление: со дня, следующего за сроком оплаты, по asOf включительно. Сложные проценты не применяются (п. 5 ст. 395). */
    function interest395(amount, due, pays, asOf, rates) {
        var from = addDays(due, 1), toExcl = addDays(asOf, 1);
        if (from >= toExcl) return { total: 0, days: 0, rows: [], basis: '395' };
        var cuts = principalCuts(due, amount, pays, toExcl);
        var segs = segments(from, toExcl, cuts.map(function (c) { return c.date; }).concat(rates.map(function (r) { return r.from; })));
        var rows = [], total = 0, days = 0;
        segs.forEach(function (s) {
            var p = principalAt(amount, cuts, s.from), n = diffDays(s.from, s.toExcl), r = rateAt(rates, s.from), yd = isLeap(+s.from.slice(0, 4)) ? 366 : 365;
            var sum = round2(p * r / 100 * n / yd);
            rows.push({ from: s.from, to: addDays(s.toExcl, -1), days: n, principal: p, rate: r, yearDays: yd, sum: sum });
            total = round2(total + sum); days += n;
        });
        return { total: total, days: days, rows: rows, basis: '395' };
    }
    /* Неустойка по договору: ставка в день (% от неоплаченной суммы), необязательный потолок в % от суммы долга. */
    function penaltyContract(amount, due, pays, asOf, ratePerDay, capPct) {
        var from = addDays(due, 1), toExcl = addDays(asOf, 1);
        if (from >= toExcl || !(ratePerDay > 0)) return { total: 0, raw: 0, capped: false, days: 0, rows: [], basis: 'contract' };
        var cuts = principalCuts(due, amount, pays, toExcl);
        var segs = segments(from, toExcl, cuts.map(function (c) { return c.date; }));
        var rows = [], raw = 0, days = 0;
        segs.forEach(function (s) {
            var p = principalAt(amount, cuts, s.from), n = diffDays(s.from, s.toExcl), sum = round2(p * ratePerDay / 100 * n);
            rows.push({ from: s.from, to: addDays(s.toExcl, -1), days: n, principal: p, rate: ratePerDay, sum: sum });
            raw = round2(raw + sum); days += n;
        });
        var cap = capPct > 0 ? round2(amount * capPct / 100) : 0, capped = cap > 0 && raw > cap;
        return { total: capped ? cap : raw, raw: raw, cap: cap, capped: capped, days: days, rows: rows, basis: 'contract' };
    }
    /* Пени по документу по способу, выбранному в договоре: 'contract' | '395' | 'none'. */
    function penaltyFor(doc, pays, asOf, contract, rates) {
        var mine = pays.filter(function (p) { return p.doc === doc.id; });
        if (contract.basis === '395') return interest395(doc.amount, doc.due, mine, asOf, rates);
        if (contract.basis === 'contract') return penaltyContract(doc.amount, doc.due, mine, asOf, contract.rate, contract.cap);
        return { total: 0, days: 0, rows: [], basis: 'none' };
    }

    /* ---------- Претензионный срок (ч. 5 ст. 4 АПК РФ) ---------- */
    /* Иск в арбитраж - по истечении 30 календарных дней со дня направления претензии, если договором не установлен иной срок. */
    function claimTerm(sendDate, termDays, asOf) {
        var t = termDays > 0 ? termDays : 30, last = addDays(sendDate, t);
        return { last: last, earliestSuit: addDays(last, 1), canSue: asOf > last, daysLeft: Math.max(0, diffDays(asOf, last)), term: t };
    }

    /* ---------- График реструктуризации ---------- */
    /* rows: [{date, amount, paid}]; grace - льготных дней после даты платежа. */
    function restructureCheck(rows, asOf, grace) {
        grace = grace || 0;
        var planned = 0, paid = 0, late = 0, maxLate = 0, next = null;
        var out = rows.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).map(function (r) {
            var rest = round2(r.amount - r.paid), status;
            planned = round2(planned + r.amount); paid = round2(paid + Math.min(r.paid, r.amount));
            if (rest <= 0.004) status = 'paid';
            else if (diffDays(r.date, asOf) > grace) { status = 'late'; late = round2(late + rest); maxLate = Math.max(maxLate, diffDays(r.date, asOf)); }
            else { status = 'wait'; if (!next) next = r; }
            return { date: r.date, amount: r.amount, paid: r.paid, rest: Math.max(0, rest), status: status };
        });
        return { rows: out, planned: planned, paid: paid, remain: round2(planned - paid), late: late, maxLate: maxLate, violated: late > 0, next: next };
    }

    /* ---------- Показатели ---------- */
    /* DSO = дебиторка / выручка за период * дней периода. */
    function dso(receivable, revenue, periodDays) { return revenue > 0 ? round2(receivable / revenue * periodDays) : 0; }
    function revenueFor(docs, asOf, periodDays) {
        var from = addDays(asOf, -periodDays), s = 0;
        docs.forEach(function (d) { if (d.date > from && d.date <= asOf) s += d.amount; });
        return round2(s);
    }
    /* По менеджерам: rows ledger-ов с полем manager. */
    function byManager(rows) {
        var m = {};
        rows.forEach(function (r) {
            var x = m[r.manager] = m[r.manager] || { manager: r.manager, debt: 0, overdue: 0, clients: 0, bad: 0, maxDays: 0 };
            x.debt = round2(x.debt + r.debt); x.overdue = round2(x.overdue + r.overdue); x.clients++;
            if (r.overdue > 0) x.bad++;
            x.maxDays = Math.max(x.maxDays, r.maxDays);
        });
        return Object.keys(m).map(function (k) { var x = m[k]; x.share = x.debt > 0 ? round2(x.overdue / x.debt * 100) : 0; return x; }).sort(function (a, b) { return b.overdue - a.overdue; });
    }

    /* Прогноз поступлений на N недель. clients: [{client, stageCode, overdue, scheduled}]; promises: [{client, date, amount}]; schedule: [{client, date, amount, paid}];
       upcoming: открытые документы со сроком в будущем. prob - вероятность оплаты просрочки по ступеням. Оценка грубая: показывает порядок величины. */
    function forecast(asOf, weeks, upcoming, promises, schedule, overdueRows, prob) {
        var w = [], i;
        for (i = 0; i < weeks; i++) w.push({ from: addDays(asOf, 1 + 7 * i), to: addDays(asOf, 7 * (i + 1)), due: 0, promised: 0, scheduled: 0, overdue: 0, total: 0 });
        function put(date, key, sum) {
            for (var k = 0; k < w.length; k++) if (date >= w[k].from && date <= w[k].to) { w[k][key] = round2(w[k][key] + sum); return; }
        }
        var covered = {};
        promises.forEach(function (p) { put(p.date, 'promised', p.amount * 0.8); covered[p.client] = (covered[p.client] || 0) + p.amount; });
        schedule.forEach(function (s) { var rest = s.amount - s.paid; if (rest > 0) { put(s.date, 'scheduled', rest * 0.9); covered[s.client] = (covered[s.client] || 0) + rest; } });
        upcoming.forEach(function (u) { put(u.due, 'due', u.balance * 0.85); });
        overdueRows.forEach(function (r) {
            var rest = Math.max(0, r.overdue - (covered[r.client] || 0)), p = prob[r.stageCode] === undefined ? 0.3 : prob[r.stageCode];
            if (rest > 0 && w.length > 1) { w[1].overdue = round2(w[1].overdue + rest * p); }
        });
        w.forEach(function (x) { x.total = round2(x.due + x.promised + x.scheduled + x.overdue); });
        return w;
    }

    /* ---------- Тексты ---------- */
    function fill(text, vars) { return String(text || '').replace(/\{([^{}]+)\}/g, function (m, k) { return vars[k] === undefined ? m : vars[k]; }); }
    /* Претензия: массив абзацев. d: {seller, buyer, contractNo, contractDate, docs:[{number,date,due,balance,days}], principal, penalty:{basis,total,rows}, penaltyRate, sendDate, asOf, term} */
    function buildClaim(d) {
        var t = claimTerm(d.sendDate, d.term, d.asOf), L = [];
        L.push('ПРЕТЕНЗИЯ об уплате задолженности');
        L.push('Кому: ' + d.buyer + '. От: ' + d.seller + '. Дата: ' + toDmy(d.sendDate) + '.');
        L.push('По договору № ' + d.contractNo + (d.contractDate ? ' от ' + toDmy(d.contractDate) : '') + ' нами поставлен товар, оплата в срок не поступила. Задолженность на ' + toDmy(d.asOf) + ' составляет ' + fmtRub(d.principal, true) + ' руб.:');
        d.docs.forEach(function (x) { L.push('- ' + x.number + ' от ' + toDmy(x.date) + ', срок оплаты ' + toDmy(x.due) + ', долг ' + fmtRub(x.balance, true) + ' руб., просрочка ' + x.days + ' дн.'); });
        var p = d.penalty || { total: 0, basis: 'none' };
        if (p.basis === 'contract') L.push('Неустойка по договору (' + String(d.penaltyRate).replace('.', ',') + '% в день' + (p.capped ? ', с учётом ограничения по договору' : '') + ') на ' + toDmy(d.asOf) + ': ' + fmtRub(p.total, true) + ' руб.');
        else if (p.basis === '395') L.push('Проценты за пользование чужими денежными средствами по ст. 395 ГК РФ (по ключевой ставке Банка России) на ' + toDmy(d.asOf) + ': ' + fmtRub(p.total, true) + ' руб.');
        else L.push('Неустойка и проценты в претензии не заявляются.');
        L.push('Итого к уплате: ' + fmtRub(round2(d.principal + (p.total || 0)), true) + ' руб.');
        L.push('Просим погасить задолженность в течение ' + t.term + ' календарных дней со дня направления претензии, то есть до ' + toDmy(t.last) + '. При неисполнении мы обратимся в арбитражный суд (ч. 5 ст. 4 АПК РФ: иск возможен по истечении ' + t.term + ' календарных дней со дня направления претензии), а также вправе приостановить отгрузку (ст. 328 ГК РФ).');
        return L;
    }

    return {
        utc: utc, iso: iso, addDays: addDays, diffDays: diffDays, toIso: toIso, toDmy: toDmy, num: num, round2: round2, fmtRub: fmtRub, isLeap: isLeap,
        BUCKETS: BUCKETS, overdueDays: overdueDays, bucketOf: bucketOf, openDocs: openDocs, aging: aging, ledger: ledger,
        stageFor: stageFor, clientStage: clientStage, stopDecision: stopDecision,
        interest395: interest395, penaltyContract: penaltyContract, penaltyFor: penaltyFor, rateAt: rateAt, claimTerm: claimTerm,
        restructureCheck: restructureCheck, dso: dso, revenueFor: revenueFor, byManager: byManager, forecast: forecast, fill: fill, buildClaim: buildClaim
    };
});
