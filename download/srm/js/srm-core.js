/* SRM: чистые функции (приведение КП к единому виду, история цен, маршрут по порогам, допуск поставщика,
   экономия по единой методике, дробление под порог, исполнение поставок, разбор КП из Excel и письма).
   Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.SrmCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var DAY = 86400000;
    /* moneyRate - стоимость денег, % годовых (оценка отсрочки и предоплаты); vat - ставка НДС по умолчанию;
       priceDev - отклонение от прошлой закупки, % (выше - подсветка); splitWindow - окно поиска дробления, дней;
       docSoon - за сколько дней предупреждать об истечении документа поставщика. */
    var DEFAULT_RULES = { moneyRate: 16, vat: 20, priceDev: 5, splitWindow: 30, docSoon: 30 };
    var STEP_ROLES = { 'категорийный закупщик': ['категорийный закупщик'], 'директор по закупкам': ['директор по закупкам'], 'закупочная комиссия': ['директор по закупкам'] };

    function utc(s) { var p = String(s).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
    function iso(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
    function addDays(s, n) { return iso(utc(s) + n * DAY); }
    function diffDays(a, b) { return Math.round((utc(b) - utc(a)) / DAY); }
    /* 'ДД.ММ.ГГГГ' или 'ГГГГ-ММ-ДД...' -> 'ГГГГ-ММ-ДД'; пусто -> '' */
    function toIso(v) {
        if (!v) return '';
        var m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(String(v));
        return m ? m[3] + '-' + m[2] + '-' + m[1] : String(v).slice(0, 10);
    }
    function toDmy(v) { var s = toIso(v); return s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : ''; }
    function num(v) {
        if (v === null || v === undefined || v === '') return 0;
        if (typeof v === 'number') return isFinite(v) ? v : 0;
        var n = parseFloat(String(v).replace(/\s| /g, '').replace(',', '.'));
        return isFinite(n) ? n : 0;
    }
    function round2(x) { return Math.round(x * 100) / 100; }
    function bool(v) { return v === true || v === 1 || v === '1' || v === 'true' || v === 'X'; }
    function roleKey(r) { return String(r || '').trim().toLowerCase().replace(/ё/g, 'е'); }

    /* ---------- приведение КП к единому виду ---------- */
    /* o: {price, vatIncluded, vatRate, delivery, deferral, prepay, lead}; qty - количество лота.
       Итог - сумма с НДС с доставкой до завода; «приведённая» - с поправкой на стоимость денег:
       день оплаты относительно поставки = доля предоплаты x (-срок поставки) + остаток x отсрочка. */
    function normalizeOffer(o, qty, rules) {
        rules = rules || DEFAULT_RULES;
        var vat = o.vatRate === undefined || o.vatRate === '' ? rules.vat : num(o.vatRate);
        var unitGross = bool(o.vatIncluded) ? num(o.price) : num(o.price) * (1 + vat / 100);
        var goods = unitGross * num(qty), delivery = num(o.delivery);
        var total = goods + delivery;
        var prepay = Math.min(100, Math.max(0, num(o.prepay))) / 100;
        var payDay = prepay * -num(o.lead) + (1 - prepay) * num(o.deferral);
        var factor = 1 - (rules.moneyRate / 100) * payDay / 365;
        var adjusted = total * factor;
        return { unitGross: round2(unitGross), goods: round2(goods), delivery: delivery, total: round2(total), payDay: round2(payDay), finAdj: round2(adjusted - total), adjusted: round2(adjusted), perUnit: num(qty) ? round2(adjusted / num(qty)) : 0 };
    }
    /* Ранжирование: лучшая - минимальная приведённая сумма; у каждой - отрыв от лучшей, %; дешёвая «на бумаге» цена отмечается, если она не лучшая. */
    function rankOffers(offers, qty, rules) {
        var rows = offers.map(function (o) { return { offer: o, n: normalizeOffer(o, qty, rules) }; });
        rows.sort(function (a, b) { return a.n.adjusted - b.n.adjusted; });
        var best = rows.length ? rows[0].n.adjusted : 0;
        var rawMin = null;
        rows.forEach(function (r) { var raw = bool(r.offer.vatIncluded) ? num(r.offer.price) / (1 + (r.offer.vatRate === undefined || r.offer.vatRate === '' ? (rules || DEFAULT_RULES).vat : num(r.offer.vatRate)) / 100) : num(r.offer.price); r.rawNet = round2(raw); if (rawMin === null || raw < rawMin.rawNet) rawMin = r; });
        rows.forEach(function (r, i) { r.rank = i + 1; r.best = i === 0; r.gapPct = best ? round2((r.n.adjusted - best) / best * 100) : 0; r.paperCheapest = r === rawMin && i !== 0; });
        return rows;
    }

    /* ---------- история цен ---------- */
    /* contracts: [{nom, date, unitPrice, supplier}] -> по возрастанию даты, только до даты before (не включая). */
    function priceHistory(contracts, nom, before) {
        return contracts.filter(function (c) { return c.nom === nom && c.unitPrice > 0 && (!before || toIso(c.date) < toIso(before)); })
            .map(function (c) { return { date: toIso(c.date), price: num(c.unitPrice), supplier: c.supplier || '', id: c.id }; })
            .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    }
    function deviation(price, last) { return last ? round2((num(price) - num(last)) / num(last) * 100) : null; }
    function priceFlag(price, last, rules) {
        var d = deviation(price, last); if (d === null) return { dev: null, kind: 'none' };
        var lim = (rules || DEFAULT_RULES).priceDev;
        return { dev: d, kind: d > lim ? 'up' : d < -lim ? 'down' : 'ok' };
    }

    /* ---------- маршрут согласования по порогам ---------- */
    /* thresholds: [{name, from, to, steps:'A; B; C'}]; сумма попадает в порог from < сумма <= to (to пусто - без верхней границы). */
    function parseSteps(s) { return String(s || '').split(/[;\n]/).map(function (x) { return x.trim(); }).filter(Boolean); }
    function routeFor(amount, thresholds) {
        var a = num(amount);
        var list = thresholds.slice().sort(function (x, y) { return num(x.from) - num(y.from); });
        var hit = null;
        list.forEach(function (t) { var to = t.to === '' || t.to === undefined || t.to === null || num(t.to) === 0 ? Infinity : num(t.to); if (a > num(t.from) && a <= to) hit = t; });
        if (!hit && list.length && a <= num(list[0].from)) hit = list[0];
        var steps = hit ? parseSteps(hit.steps) : [];
        return { threshold: hit, steps: steps, commission: steps.some(function (s) { return /комисси/i.test(s); }) };
    }
    function signedList(s) { return String(s || '').split(';').map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) { var p = x.split('|'); return { step: p[0], who: p[1] || '', date: p[2] || '' }; }); }
    function routeProgress(steps, signed) {
        var got = signedList(signed), done = [], next = null;
        steps.forEach(function (st) { var g = got.filter(function (x) { return roleKey(x.step) === roleKey(st); })[0]; if (g && next === null) done.push(g); else if (next === null) next = st; });
        return { done: done, next: next, complete: steps.length > 0 && next === null, total: steps.length };
    }
    function canSign(role, step) {
        var r = roleKey(role); if (!step) return false;
        if (r === 'admin' || r === 'администратор') return true;
        var allowed = STEP_ROLES[roleKey(step)] || [roleKey(step)];
        return allowed.indexOf(r) >= 0;
    }
    function addSign(signed, step, who, date) { var list = String(signed || '').trim(); var item = step + '|' + who + '|' + date; return list ? list + '; ' + item : item; }

    /* ---------- допуск поставщика ---------- */
    /* sup: {level, color('green'|'amber'|'red'), until, reason}; docs: [{name, until}].
       Красная зона или истёкший срок допуска - договор не создаётся; истёкший документ - предупреждение. */
    function docStatus(d, today, rules) {
        var u = toIso(d.until); if (!u) return 'none';
        var left = diffDays(today, u);
        return left < 0 ? 'expired' : left <= (rules || DEFAULT_RULES).docSoon ? 'soon' : 'ok';
    }
    function admission(sup, docs, today, rules) {
        var reasons = [], warnings = [];
        var color = sup.color || 'amber';
        if (color === 'red') reasons.push('Поставщик в зоне «' + (sup.level || 'красная') + '»' + (sup.reason ? ': ' + sup.reason : ''));
        if (toIso(sup.until) && toIso(sup.until) < today) reasons.push('Срок допуска истёк ' + toDmy(sup.until));
        (docs || []).forEach(function (d) {
            var s = docStatus(d, today, rules);
            if (s === 'expired') warnings.push('Документ «' + d.name + '» просрочен с ' + toDmy(d.until));
            else if (s === 'soon') warnings.push('Документ «' + d.name + '» истекает ' + toDmy(d.until));
        });
        var light = reasons.length ? 'red' : (color === 'amber' || warnings.length ? 'amber' : 'green');
        return { ok: reasons.length === 0, light: light, reasons: reasons, warnings: warnings };
    }
    /* Договор: допуск поставщика и пройденный маршрут. */
    function contractGate(adm, progress) {
        var r = [];
        if (!adm.ok) r = r.concat(adm.reasons);
        if (!progress.complete) r.push(progress.next ? 'Маршрут не пройден: ждёт подписи «' + progress.next + '»' : 'Маршрут не определён');
        return { ok: r.length === 0, reasons: r };
    }

    /* ---------- экономия по единой методике ---------- */
    /* base: 'budget' - бюджет заявки; 'first' - первое полученное КП (приведённая сумма); 'last' - цена прошлой закупки x количество. */
    var SAVING_BASES = { budget: 'от бюджета заявки', first: 'от первого КП', last: 'от прошлой закупки' };
    function saving(c, base) {
        var b = base === 'first' ? num(c.firstOffer) : base === 'last' ? num(c.lastPrice) * num(c.qty) : num(c.budget);
        if (!b) return { base: 0, amount: 0, pct: null };
        var amt = b - num(c.sum);
        return { base: round2(b), amount: round2(amt), pct: round2(amt / b * 100) };
    }
    function savingTotal(list, base) {
        var b = 0, a = 0;
        list.forEach(function (c) { var s = saving(c, base); if (s.base) { b += s.base; a += s.amount; } });
        return { base: round2(b), amount: round2(a), pct: b ? round2(a / b * 100) : null };
    }

    /* ---------- дробление под порог ---------- */
    /* reqs: [{id, plant, nom, date, amount}]; limit - порог комиссии. Ищем группы «тот же завод и номенклатура в окне N дней»,
       где каждая заявка ниже порога, а вместе выше. */
    function detectSplitting(reqs, limit, rules) {
        var win = (rules || DEFAULT_RULES).splitWindow, groups = {}, out = [];
        reqs.forEach(function (r) { if (num(r.amount) > 0 && num(r.amount) <= limit) { var k = r.plant + '|' + r.nom; (groups[k] = groups[k] || []).push(r); } });
        Object.keys(groups).forEach(function (k) {
            var g = groups[k].slice().sort(function (a, b) { return toIso(a.date) < toIso(b.date) ? -1 : 1; });
            var used = {};
            for (var i = 0; i < g.length; i++) {
                if (used[g[i].id]) continue;
                var pack = [g[i]], sum = num(g[i].amount);
                for (var j = i + 1; j < g.length; j++) if (diffDays(toIso(g[i].date), toIso(g[j].date)) <= win) { pack.push(g[j]); sum += num(g[j].amount); }
                if (pack.length >= 2 && sum > limit) { pack.forEach(function (p) { used[p.id] = 1; }); out.push({ plant: g[i].plant, nom: g[i].nom, items: pack, sum: round2(sum), days: diffDays(toIso(pack[0].date), toIso(pack[pack.length - 1].date)) }); }
            }
        });
        return out.sort(function (a, b) { return b.sum - a.sum; });
    }

    /* ---------- траты по поставщику и концентрация ---------- */
    function spendBy(contracts, key) {
        var m = {}, total = 0;
        contracts.forEach(function (c) { var k = c[key] || '-'; m[k] = (m[k] || 0) + num(c.sum); total += num(c.sum); });
        return Object.keys(m).map(function (k) { return { key: k, sum: round2(m[k]), share: total ? round2(m[k] / total * 100) : 0 }; }).sort(function (a, b) { return b.sum - a.sum; });
    }
    function spendMatrix(contracts, supplier) {
        var rows = contracts.filter(function (c) { return c.supplier === supplier; });
        return { total: round2(rows.reduce(function (s, c) { return s + num(c.sum); }, 0)), byPlant: spendBy(rows, 'plant'), count: rows.length };
    }

    /* ---------- исполнение поставок ---------- */
    /* stages: [{plan, fact, qty, accepted}]; вовремя и полностью = факт не позже плана и принято не меньше этапа. */
    function stageState(s, today) {
        var plan = toIso(s.plan), fact = toIso(s.fact);
        if (!fact) return plan && plan < today ? 'overdue' : 'wait';
        var full = num(s.accepted) >= num(s.qty) - 1e-9;
        return fact <= plan ? (full ? 'otif' : 'short') : 'late';
    }
    function otif(stages, today) {
        var done = 0, good = 0, overdue = [];
        stages.forEach(function (s) { var st = stageState(s, today); if (st === 'overdue') overdue.push(s); if (st === 'otif' || st === 'short' || st === 'late') { done++; if (st === 'otif') good++; } });
        return { done: done, good: good, pct: done ? Math.round(good / done * 100) : null, overdue: overdue };
    }
    /* Этапы договора: qty делится на n частей, первая поставка через firstDays, далее через stepDays. */
    function planStages(qty, start, n, firstDays, stepDays) {
        n = Math.max(1, n || 1); var out = [], left = num(qty), part = Math.round(num(qty) / n * 1000) / 1000;
        for (var i = 0; i < n; i++) { var q = i === n - 1 ? Math.round(left * 1000) / 1000 : part; left -= q; out.push({ name: 'Этап ' + (i + 1), plan: addDays(start, (firstDays || 14) + i * (stepDays || 14)), qty: q }); }
        return out;
    }
    function cycleDays(reqDate, contractDate) { return reqDate && contractDate ? diffDays(toIso(reqDate), toIso(contractDate)) : null; }

    /* ---------- разбор КП: строки Excel и текст письма ---------- */
    function numIn(s) { var m = /-?\d[\d\s ]*(?:[.,]\d+)?/.exec(String(s)); return m ? num(m[0]) : null; }
    function vatOf(s) { var t = String(s).toLowerCase(); if (/без\s*ндс|ндс\s*не\s*облаг|не\s*включ/.test(t)) return false; if (/(^|\s)(с|вкл\S*|включая|в т\.?\s*ч\.?)\s*ндс|ндс\s*включ|^да$|^с ндс$/.test(t)) return true; return null; }
    var LABELS = [['delivery', /доставк|транспорт/], ['deferral', /отсроч/], ['prepay', /предоплат|аванс/], ['lead', /срок\s*(поставки|отгрузки)|поставка,?\s*дн|отгрузка/], ['valid', /действ/], ['comment', /коммент|примеч/], ['vat', /^ндс|ставка ндс/], ['price', /цена|стоимость/]];
    function labelKey(l) { var t = String(l || '').toLowerCase().trim(); for (var i = 0; i < LABELS.length; i++) if (LABELS[i][1].test(t)) return LABELS[i][0]; return null; }
    function put(o, key, label, val) {
        if (val === null || val === undefined || String(val).trim() === '') return;
        if (key === 'price') { var p = numIn(val); if (p !== null) o.price = p; var v = vatOf(label) ; if (v === null) v = vatOf(val); if (v !== null) o.vatIncluded = v; }
        else if (key === 'vat') { var vv = vatOf(val); if (vv !== null) o.vatIncluded = vv; else if (numIn(val) !== null) o.vatRate = numIn(val); }
        else if (key === 'delivery') o.delivery = /включ|бесплат/i.test(String(val)) ? 0 : (numIn(val) || 0);
        else if (key === 'valid') o.validTo = toIso(String(val).trim());
        else if (key === 'comment') o.comment = String(val).trim();
        else { var n = numIn(val); if (n !== null) o[key] = n; }
    }
    /* rows - массив строк (массивов ячеек): «подпись | значение» по строкам или строка заголовков + строка значений. */
    function parseOfferRows(rows) {
        var o = {};
        rows = (rows || []).filter(function (r) { return r && r.some(function (c) { return String(c === undefined || c === null ? '' : c).trim() !== ''; }); });
        var head = rows[0] || [], keys = head.map(labelKey);
        if (rows.length >= 2 && keys.filter(Boolean).length >= 2) {
            var data = rows[1];
            keys.forEach(function (k, i) { if (k) put(o, k, head[i], data[i]); });
        } else rows.forEach(function (r) { var k = labelKey(r[0]); if (k) put(o, k, r[0], r[1]); });
        return finish(o);
    }
    function parseOfferText(text) {
        var t = String(text || '');
        if (/\t/.test(t)) return parseOfferRows(t.split(/\r?\n/).map(function (l) { return l.split('\t'); }));
        var o = {}, m, flat = t.replace(/ /g, ' ');
        m = /(?:цен[аыу]?|стоимость)[^0-9\n]{0,60}?(\d[\d ]*(?:[.,]\d+)?)\s*(?:руб|₽|р\.)/i.exec(flat); if (m) o.price = num(m[1]);
        var v = vatOf(flat.toLowerCase().replace(/[^\sа-яёa-z.]/gi, ' ')); if (/без\s+ндс/i.test(flat)) o.vatIncluded = false; else if (/(с|включая|вкл\.?|в т\.?\s?ч\.?)\s+ндс|ндс\s+включ/i.test(flat)) o.vatIncluded = true; else if (v !== null) o.vatIncluded = v;
        if (/доставк[а-я]*\s+(включ|бесплат|за наш)/i.test(flat)) o.delivery = 0;
        else { m = /доставк[а-я]*[^0-9\n]{0,40}?(\d[\d ]*)\s*(?:руб|₽|р\.)/i.exec(flat); if (m) o.delivery = num(m[1]); }
        m = /отсрочк[а-я]*[^0-9\n]{0,30}?(\d+)\s*(?:дн|календ|банк|раб)/i.exec(flat); if (m) o.deferral = num(m[1]);
        m = /(\d+)\s*%\s*(?:предоплат|аванс)/i.exec(flat) || /(?:предоплат|аванс)[а-я]*\s*(\d+)\s*%/i.exec(flat); if (m) o.prepay = num(m[1]); else if (/(?:полная|100-?процентная)\s+предоплат/i.test(flat)) o.prepay = 100;
        m = /(?:срок\s+(?:поставки|отгрузки)|отгрузка|поставка)[^0-9\n]{0,30}?(\d+)\s*(?:дн|раб|кал)/i.exec(flat); if (m) o.lead = num(m[1]);
        return finish(o);
    }
    function finish(o) {
        var need = ['price', 'vatIncluded', 'deferral', 'lead'];
        return { fields: o, missing: need.filter(function (k) { return o[k] === undefined; }) };
    }

    /* ---------- прочее ---------- */
    function nextNumber(list, prefix) {
        var max = 0; (list || []).forEach(function (s) { var m = new RegExp('^' + prefix.replace(/[-.]/g, '\\$&') + '(\\d+)').exec(String(s)); if (m && +m[1] > max) max = +m[1]; });
        return prefix + String(max + 1).padStart(4, '0');
    }
    function inviteCode(rnd) { var a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = ''; rnd = rnd || Math.random; for (var i = 0; i < 8; i++) s += a[Math.floor(rnd() * a.length)]; return 'INV-' + s; }
    function toCsv(rows) { return rows.map(function (r) { return r.map(function (c) { var s = String(c === undefined || c === null ? '' : c); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';'); }).join('\n'); }

    return {
        DEFAULT_RULES: DEFAULT_RULES, SAVING_BASES: SAVING_BASES, utc: utc, iso: iso, addDays: addDays, diffDays: diffDays, toIso: toIso, toDmy: toDmy, num: num, round2: round2, bool: bool, roleKey: roleKey,
        normalizeOffer: normalizeOffer, rankOffers: rankOffers, priceHistory: priceHistory, deviation: deviation, priceFlag: priceFlag,
        parseSteps: parseSteps, routeFor: routeFor, signedList: signedList, routeProgress: routeProgress, canSign: canSign, addSign: addSign,
        docStatus: docStatus, admission: admission, contractGate: contractGate, saving: saving, savingTotal: savingTotal, detectSplitting: detectSplitting,
        spendBy: spendBy, spendMatrix: spendMatrix, stageState: stageState, otif: otif, planStages: planStages, cycleDays: cycleDays,
        parseOfferRows: parseOfferRows, parseOfferText: parseOfferText, nextNumber: nextNumber, inviteCode: inviteCode, toCsv: toCsv
    };
});
