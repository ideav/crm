/* B2B-портал дилера: чистые функции (персональная цена, маржа, остатки, дебиторка, проверка заказа, статусы, отчёт дилера). Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.DealerCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var DAY = 86400000;
    /* marginMin - порог маржи строки, %; approveOverdue - просрочка (дней), с которой заказ идёт на согласование;
       blockOverdue - просрочка, с которой заказ не принимается; limitTolerance - допуск сверх лимита, % */
    var DEFAULT_RULES = { marginMin: 15, approveOverdue: 1, blockOverdue: 30, limitTolerance: 0 };
    var RULE_NAMES = { 'Мин. маржа, %': 'marginMin', 'Согласование при просрочке от, дней': 'approveOverdue', 'Блок заказа при просрочке от, дней': 'blockOverdue', 'Допуск сверх лимита, %': 'limitTolerance' };
    /* Статусы, у которых заказ уже занимает лимит, но счёта ещё нет. */
    var OPEN_STATUSES = ['На согласовании', 'Подтверждён', 'Собирается'];
    var FLOW = ['Черновик', 'На согласовании', 'Подтверждён', 'Собирается', 'Отгружен', 'Доставлен'];

    function utc(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
    function iso(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
    function addDays(s, n) { return iso(utc(s) + n * DAY); }
    function diffDays(a, b) { return Math.round((utc(b) - utc(a)) / DAY); }
    /* 'ДД.ММ.ГГГГ' или 'ГГГГ-ММ-ДД' -> 'ГГГГ-ММ-ДД'; пусто -> '' */
    function toIso(v) {
        if (!v) return '';
        var m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(v);
        return m ? m[3] + '-' + m[2] + '-' + m[1] : String(v).slice(0, 10);
    }
    function toDmy(s) { return s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : ''; }
    function num(x) { var n = parseFloat(String(x === undefined || x === null ? '' : x).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; }
    function round1(x) { return Math.round(x * 10) / 10; }
    function rub(x) { var n = Math.round(num(x)); return (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }

    function parseRules(byName) {
        var r = Object.assign({}, DEFAULT_RULES);
        Object.keys(byName || {}).forEach(function (k) { if (RULE_NAMES[k] && String(byName[k]) !== '') r[RULE_NAMES[k]] = num(byName[k]); });
        return r;
    }
    function active(cond, today) { return !cond.until || cond.until >= today; }

    /* Персональная цена дилера. Спеццена на товар сильнее скидок; иначе берётся большая из скидки уровня и
       договорной скидки на товарную группу. cond: {dealer, kind:'Спеццена'|'Скидка на группу', group, product, pct, price, until, approve}.
       approve - спеццена ниже порога маржи: у роли без себестоимости (закупщик) заказ по ней всё равно уходит на согласование. */
    function priceFor(product, dealer, conds, levelPct, today) {
        var base = num(product.base), best = { price: base, base: base, pct: 0, kind: 'base', rule: 'Базовая цена' };
        var mine = (conds || []).filter(function (c) { return c.dealer === dealer.name && active(c, today); });
        var sp = mine.filter(function (c) { return c.kind === 'Спеццена' && c.product === product.name && num(c.price) > 0; })[0];
        if (sp) return { price: num(sp.price), base: base, pct: base > 0 ? round1((1 - num(sp.price) / base) * 100) : 0, kind: 'special', rule: 'Спеццена по договору' + (sp.until ? ' до ' + toDmy(sp.until) : ''), until: sp.until || '', approve: !!sp.approve };
        var lv = num(levelPct);
        if (lv > 0) best = { price: Math.round(base * (1 - lv / 100)), base: base, pct: lv, kind: 'level', rule: 'Уровень «' + (dealer.level || '') + '» -' + lv + '%' };
        mine.forEach(function (c) {
            if (c.kind !== 'Скидка на группу' || c.group !== product.group) return;
            var p = num(c.pct);
            if (p > best.pct) best = { price: Math.round(base * (1 - p / 100)), base: base, pct: p, kind: 'group', rule: 'Договорная скидка на «' + c.group + '» -' + p + '%' + (c.until ? ' до ' + toDmy(c.until) : ''), until: c.until || '' };
        });
        return best;
    }
    function marginPct(price, cost) { price = num(price); if (price <= 0 || cost === null || cost === undefined || cost === '') return null; return round1((price - num(cost)) / price * 100); }
    /* Каталог дилера: только открытые ему товарные группы (пустой список = все). */
    function catalogFor(products, dealer) {
        var g = dealer.groups || [];
        return g.length ? products.filter(function (p) { return g.indexOf(p.group) >= 0; }) : products.slice();
    }
    /* Доступно = в наличии минус резерв, по складам: {склад: шт} */
    function stockByWarehouse(productName, stocks) {
        var out = {};
        (stocks || []).forEach(function (s) { if (s.product === productName) out[s.wh] = (out[s.wh] || 0) + Math.max(0, num(s.qty) - num(s.reserve)); });
        return out;
    }
    function stockLevel(n) { return n <= 0 ? 'none' : n < 10 ? 'low' : 'ok'; }

    /* Дебиторка дилера на дату: долг, просроченная часть и максимальная просрочка в днях. */
    function debtSummary(invoices, dealerName, today) {
        var r = { debt: 0, overdue: 0, overdueDays: 0, open: [], nextDue: '' };
        (invoices || []).forEach(function (i) {
            if (dealerName && i.dealer !== dealerName) return;
            var rest = num(i.sum) - num(i.paid);
            if (rest <= 0.5) return;
            r.debt += rest; r.open.push(Object.assign({ rest: rest, late: i.due && i.due < today ? diffDays(i.due, today) : 0 }, i));
            if (i.due && i.due < today) { r.overdue += rest; r.overdueDays = Math.max(r.overdueDays, diffDays(i.due, today)); }
            else if (i.due && (!r.nextDue || i.due < r.nextDue)) r.nextDue = i.due;
        });
        r.open.sort(function (a, b) { return a.due < b.due ? -1 : 1; });
        return r;
    }
    function aging(invoices, today) {
        var b = { current: 0, d15: 0, d30: 0, over30: 0 };
        (invoices || []).forEach(function (i) {
            var rest = num(i.sum) - num(i.paid); if (rest <= 0.5) return;
            var late = i.due && i.due < today ? diffDays(i.due, today) : 0;
            if (late <= 0) b.current += rest; else if (late <= 15) b.d15 += rest; else if (late <= 30) b.d30 += rest; else b.over30 += rest;
        });
        return b;
    }
    /* Заказы, которые заняли лимит, но ещё без счёта. */
    function openOrdersSum(orders, dealerName, exceptId) {
        return (orders || []).reduce(function (s, o) { return s + (o.dealer === dealerName && (exceptId === undefined || o.id !== exceptId) && OPEN_STATUSES.indexOf(o.status) >= 0 ? num(o.sum) : 0); }, 0);
    }
    function limitState(dealer, debt, open) {
        var limit = num(dealer.limit), used = debt + open;
        return { limit: limit, used: used, free: limit - used, pct: limit > 0 ? Math.round(used / limit * 100) : 0 };
    }
    /* Проверка заказа при вводе.
       o: {dealer, lines:[{product, qty, pack, price, base, cost, approve, avail, elsewhere}], debt (debtSummary), open (сумма открытых заказов), rules}
       Итог: errors (заказ не отправить), warnings (видно, но не мешает), approvals (что уйдёт коммерческому директору), status. */
    function checkOrder(o) {
        var R = Object.assign({}, DEFAULT_RULES, o.rules || {}), res = { total: 0, errors: [], warnings: [], approvals: [], lines: [] };
        var lines = (o.lines || []).filter(function (l) { return num(l.qty) > 0; });
        if (!lines.length) res.errors.push('В заказе нет позиций');
        var low = [];
        lines.forEach(function (l) {
            var q = num(l.qty), sum = q * num(l.price), m = marginPct(l.price, l.cost);
            res.total += sum;
            var pack = num(l.pack) || 1;
            if (q % pack !== 0) res.errors.push(l.product + ': количество кратно ' + pack + ' (упаковка), сейчас ' + q);
            if (l.avail !== undefined && q > num(l.avail)) res.warnings.push(l.product + ': на складе отгрузки ' + num(l.avail) + ', не хватает ' + (q - num(l.avail)) + (l.elsewhere ? ' (есть: ' + l.elsewhere + ')' : ' - под заказ'));
            if (m !== null && m < R.marginMin) low.push(l.product + ': цена ' + rub(l.price) + ', маржа ' + String(m).replace('.', ',') + '% при пороге ' + R.marginMin + '%');
            else if (m === null && l.approve) low.push(l.product + ': спеццена ' + rub(l.price) + ' помечена «согласовать цену»');
            res.lines.push({ product: l.product, sum: sum, margin: m, low: (m !== null && m < R.marginMin) || (m === null && !!l.approve) });
        });
        var d = o.debt || { debt: 0, overdue: 0, overdueDays: 0 }, st = limitState(o.dealer || {}, d.debt, num(o.open));
        res.limit = st; res.after = st.used + res.total;
        res.freeAfter = st.limit - res.after;
        if (d.overdueDays >= R.blockOverdue) res.errors.push('Заказ не принимается: просрочка оплаты ' + d.overdueDays + ' дн. (порог ' + R.blockOverdue + ' дн.), просрочено ' + rub(d.overdue));
        else if (d.overdueDays >= R.approveOverdue) res.approvals.push({ reason: 'Отгрузка при просрочке', detail: 'Просрочка оплаты ' + d.overdueDays + ' дн., просрочено ' + rub(d.overdue), amount: Math.round(d.overdue) });
        if (st.limit > 0 && res.after > st.limit * (1 + R.limitTolerance / 100)) res.approvals.push({ reason: 'Сверх лимита', detail: 'Лимит ' + rub(st.limit) + ', занято ' + rub(st.used) + ', с заказом ' + rub(res.after), amount: Math.round(res.after - st.limit) });
        if (low.length) res.approvals.push({ reason: 'Цена ниже маржи', detail: low.join('; '), amount: 0 });
        res.status = res.errors.length ? 'blocked' : res.approvals.length ? 'На согласовании' : 'Подтверждён';
        res.ok = !res.errors.length;
        return res;
    }
    /* Статус заказа по решениям согласований: любое «Отклонено» - отклонён, все «Одобрено» - подтверждён. */
    function statusByDecisions(apps) {
        if (!apps.length) return null;
        if (apps.some(function (a) { return a.decision === 'Отклонено'; })) return 'Отклонён';
        return apps.every(function (a) { return a.decision === 'Одобрено'; }) ? 'Подтверждён' : 'На согласовании';
    }
    /* Следующий шаг склада: Подтверждён -> Собирается -> Отгружен -> Доставлен. */
    function nextWarehouseStatus(s) { var i = ['Подтверждён', 'Собирается', 'Отгружен'].indexOf(s); return i < 0 ? null : ['Собирается', 'Отгружен', 'Доставлен'][i]; }
    /* Повтор заказа: строки старого заказа по сегодняшним ценам, с пометкой, где цена изменилась. */
    function repeatLines(oldLines, priceOf) {
        return (oldLines || []).map(function (l) {
            var p = priceOf(l.product);
            return { product: l.product, qty: num(l.qty), oldPrice: num(l.price), price: p ? p.price : null, changed: !!p && p.price !== num(l.price), missing: !p };
        });
    }
    /* Отчёт дилера: срок - 5-е число следующего месяца; кто не сдал. period 'ГГГГ-ММ' */
    function reportDue(period) { var y = +period.slice(0, 4), m = +period.slice(5, 7); return iso(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 5)); }
    function missingReports(dealers, reports, period) {
        var got = {}; (reports || []).forEach(function (r) { if (r.period === period) got[r.dealer] = 1; });
        return (dealers || []).filter(function (d) { return !got[d.name]; }).map(function (d) { return d.name; });
    }
    function checkReportRow(r) {
        var e = [];
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.period || '')) e.push('Период - в виде ГГГГ-ММ');
        if (!r.product) e.push('Не выбран товар');
        if (num(r.sold) < 0 || num(r.stock) < 0) e.push('Количество не может быть отрицательным');
        return e;
    }
    function nextNumber(list, prefix) {
        var max = 0; (list || []).forEach(function (s) { var m = String(s).match(/(\d+)$/); if (m && String(s).indexOf(prefix) === 0) max = Math.max(max, +m[1]); });
        return prefix + String(max + 1).padStart(4, '0');
    }
    function toCsv(rows) { return rows.map(function (r) { return r.map(function (c) { c = String(c === undefined || c === null ? '' : c); return /[;"\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(';'); }).join('\n'); }
    return {
        DEFAULT_RULES: DEFAULT_RULES, RULE_NAMES: RULE_NAMES, OPEN_STATUSES: OPEN_STATUSES, FLOW: FLOW,
        rub: rub, utc: utc, iso: iso, addDays: addDays, diffDays: diffDays, toIso: toIso, toDmy: toDmy, num: num, round1: round1,
        parseRules: parseRules, priceFor: priceFor, marginPct: marginPct, catalogFor: catalogFor, stockByWarehouse: stockByWarehouse, stockLevel: stockLevel,
        debtSummary: debtSummary, aging: aging, openOrdersSum: openOrdersSum, limitState: limitState
        , checkOrder: checkOrder, statusByDecisions: statusByDecisions, nextWarehouseStatus: nextWarehouseStatus, repeatLines: repeatLines,
        reportDue: reportDue, missingReports: missingReports, checkReportRow: checkReportRow, nextNumber: nextNumber, toCsv: toCsv
    };
});
