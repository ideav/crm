/* CPM: чистые функции бюджетирования (сетка формы ЦФО, правила контроля ввода, свод с элиминацией, сравнение версий, план-факт, лимиты заявок, кампания). Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.CpmCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
    var DONE = { 'Сдан': 1, 'Утверждён': 1, 'Принят': 1 };
    var USED = { 'Оплачена': 1, 'Согласована': 1, 'Согласована сверх лимита': 1 };

    function num(x) {
        if (x === null || x === undefined || x === '') return 0;
        var n = parseFloat(String(x).replace(/\s/g, '').replace(',', '.'));
        return isFinite(n) ? n : 0;
    }
    /* «01.01.2027» или «2027-01-01» -> «2027-01-01» */
    function toIso(s) {
        if (!s) return '';
        var m = String(s).match(/^(\d{2})\.(\d{2})\.(\d{4})/);
        if (m) return m[3] + '-' + m[2] + '-' + m[1];
        return String(s).slice(0, 10);
    }
    function monthIdx(iso) { return parseInt(toIso(iso).slice(5, 7), 10) - 1; }
    function yearOf(iso) { return parseInt(toIso(iso).slice(0, 4), 10); }
    function addDays(iso, d) { var t = new Date(toIso(iso) + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); }
    function sum(a) { var s = 0; (a || []).forEach(function (v) { if (v !== null && v !== undefined) s += num(v); }); return s; }
    function round(x) { return Math.round(x); }

    /* Сетка формы: { статья: [12 значений или null] } по строкам одной версии и одного ЦФО. ids - id записей для правки. */
    function grid(rows, cfo, version) {
        var g = {}, ids = {};
        (rows || []).forEach(function (r) {
            if (r.cfo !== cfo || r.version !== version) return;
            var m = monthIdx(r.period);
            if (!g[r.article]) { g[r.article] = [null, null, null, null, null, null, null, null, null, null, null, null]; ids[r.article] = []; }
            g[r.article][m] = (g[r.article][m] || 0) + num(r.amount);
            ids[r.article][m] = r.id;
        });
        return { values: g, ids: ids };
    }
    /* Статьи формы ЦФО: все, что встречались у этого ЦФО в любой версии, в порядке справочника. */
    function cfoArticles(rows, cfo, articles) {
        var seen = {};
        (rows || []).forEach(function (r) { if (r.cfo === cfo) seen[r.article] = 1; });
        return (articles || []).filter(function (a) { return seen[a.name]; }).sort(function (a, b) { return a.order - b.order; });
    }
    function growthPct(total, base) { return base > 0 ? (total / base - 1) * 100 : null; }

    /* Правила контроля ввода. rules: [{name, kind, article, threshold, message, on}]; base - сетка прошлого года (для роста). */
    function checkGrid(values, base, rules) {
        var out = [];
        var on = (rules || []).filter(function (r) { return r.on; });
        var growthByArt = {}, growthAll = null;
        on.forEach(function (r) { if (r.kind === 'growth') { if (r.article) growthByArt[r.article] = r; else growthAll = r; } });
        Object.keys(values || {}).forEach(function (art) {
            var v = values[art];
            on.forEach(function (r) {
                if (r.article && r.article !== art) return;
                if (r.kind === 'nonneg') v.forEach(function (x, m) { if (x !== null && num(x) < 0) out.push({ article: art, month: m, level: 'error', rule: r.name, msg: r.message }); });
                if (r.kind === 'required') {
                    var miss = []; v.forEach(function (x, m) { if (x === null || x === '') miss.push(m); });
                    if (miss.length && miss.length < 12) miss.forEach(function (m) { out.push({ article: art, month: m, level: 'error', rule: r.name, msg: r.message }); });
                }
                if (r.kind === 'spike') v.forEach(function (x, m) {
                    if (x === null) return;
                    var others = v.filter(function (y, k) { return k !== m && y !== null; });
                    var avg = others.length ? sum(others) / others.length : 0;
                    if (avg > 0 && num(x) > avg * r.threshold / 100) out.push({ article: art, month: m, level: 'warn', rule: r.name, msg: r.message });
                });
            });
            var gr = growthByArt[art] || growthAll;
            if (gr && base && base[art]) {
                var p = growthPct(sum(v), sum(base[art])); if (p !== null) p = Math.round(p * 10) / 10;
                if (p !== null && p > gr.threshold) out.push({ article: art, month: null, level: 'warn', rule: gr.name, msg: gr.message, pct: Math.round(p * 10) / 10 });
            }
        });
        return out;
    }
    function hasErrors(issues) { return (issues || []).some(function (i) { return i.level === 'error'; }); }

    /* Свод версии: итоги ЦФО за год, ЦФО без строк версии берутся из запасной версии (прошлый круг). */
    function consolidate(rows, version, fallback, cfos, articles) {
        var artBy = {}; (articles || []).forEach(function (a) { artBy[a.name] = a; });
        var has = {}; (rows || []).forEach(function (r) { if (r.version === version) has[r.cfo] = 1; });
        var by = {}, used = [];
        (cfos || []).forEach(function (c) {
            var v = has[c.name] ? version : (fallback || null);
            if (v !== version) used.push(c.name);
            by[c.name] = {};
            (rows || []).forEach(function (r) {
                if (r.cfo !== c.name || r.version !== v) return;
                by[c.name][r.article] = (by[c.name][r.article] || 0) + num(r.amount);
            });
        });
        var intraIn = 0, intraOut = 0, lines = [], groupArt = {};
        Object.keys(by).forEach(function (cfo) {
            Object.keys(by[cfo]).forEach(function (art) {
                var a = artBy[art] || {}, x = by[cfo][art];
                if (a.intra) { if (a.kind === 'Доход') intraIn += x; else intraOut += x; lines.push({ cfo: cfo, article: art, kind: a.kind, amount: x }); }
                else groupArt[art] = (groupArt[art] || 0) + x;
            });
        });
        return { byCfo: by, fallbackCfos: used, group: groupArt, elim: { income: intraIn, expense: intraOut, diff: intraIn - intraOut, lines: lines, ok: Math.abs(intraIn - intraOut) < 1 } };
    }
    /* Показатели БДР по набору «статья -> сумма»: выручка, себестоимость, валовая прибыль, расходы, EBITDA. */
    function pnl(map, articles) {
        var r = { revenue: 0, cogs: 0, commercial: 0, admin: 0, intraIn: 0, intraOut: 0 };
        (articles || []).forEach(function (a) {
            var x = num((map || {})[a.name]);
            if (!x) return;
            if (a.intra) { if (a.kind === 'Доход') r.intraIn += x; else r.intraOut += x; return; }
            if (a.group === 'Выручка') r.revenue += x;
            else if (a.group === 'Себестоимость') r.cogs += x;
            else if (a.group === 'Коммерческие расходы') r.commercial += x;
            else r.admin += x;
        });
        r.gross = r.revenue - r.cogs;
        r.ebitda = r.gross - r.commercial - r.admin + r.intraIn - r.intraOut;
        r.margin = r.revenue > 0 ? r.ebitda / r.revenue * 100 : null;
        return r;
    }
    /* Сравнение двух сводов по ЦФО и статьям: дельта и процент. */
    function compare(a, b) {
        var out = [];
        Object.keys(a.byCfo).forEach(function (cfo) {
            var x = a.byCfo[cfo] || {}, y = (b.byCfo || {})[cfo] || {}, keys = {};
            Object.keys(x).concat(Object.keys(y)).forEach(function (k) { keys[k] = 1; });
            Object.keys(keys).forEach(function (art) {
                var d = num(x[art]) - num(y[art]);
                if (Math.abs(d) >= 1) out.push({ cfo: cfo, article: art, now: num(x[art]), before: num(y[art]), delta: d, pct: num(y[art]) ? d / num(y[art]) * 100 : null });
            });
        });
        return out.sort(function (p, q) { return Math.abs(q.delta) - Math.abs(p.delta); });
    }

    /* План-факт за набор месяцев: отклонение больше порога (% и рублей) требует пояснения ответственного. */
    function planFact(rows, planVer, factVer, months, opts, articles, notes) {
        opts = opts || {}; var pct = opts.pct === undefined ? 5 : opts.pct, abs = opts.abs === undefined ? 300000 : opts.abs;
        var artBy = {}; (articles || []).forEach(function (a) { artBy[a.name] = a; });
        var inM = {}; (months || []).forEach(function (m) { inM[m] = 1; });
        var acc = {};
        (rows || []).forEach(function (r) {
            if (r.version !== planVer && r.version !== factVer) return;
            if (!inM[monthIdx(r.period)]) return;
            var k = r.cfo + '|' + r.article, o = acc[k] || (acc[k] = { cfo: r.cfo, article: r.article, plan: 0, fact: 0 });
            if (r.version === planVer) o.plan += num(r.amount); else o.fact += num(r.amount);
        });
        var last = Math.max.apply(null, months || [0]);
        return Object.keys(acc).map(function (k) {
            var o = acc[k], a = artBy[o.article] || {};
            o.dev = o.fact - o.plan;
            o.pct = o.plan ? o.dev / o.plan * 100 : null;
            o.income = a.kind === 'Доход';
            o.bad = o.income ? o.dev < 0 : o.dev > 0;
            o.over = o.pct !== null && Math.abs(o.pct) > pct && Math.abs(o.dev) > abs;
            o.note = (notes || []).filter(function (n) { return n.cfo === o.cfo && n.article === o.article && inM[monthIdx(n.period)]; })
                .sort(function (x, y) { return x.status === 'Дано' ? -1 : 1; })[0] || null;
            o.needNote = o.over && !(o.note && o.note.status === 'Дано');
            o.period = (opts.year || 2026) + '-' + String(last + 1).padStart(2, '0') + '-01';
            return o;
        }).sort(function (x, y) { return (y.over - x.over) || Math.abs(y.pct || 0) - Math.abs(x.pct || 0); });
    }
    /* Лимит статьи на месяц = утверждённый план; израсходовано - оплаченные и согласованные заявки месяца. */
    function limitState(rows, planVer, requests, cfo, article, monthIso, amount, skipId) {
        var m = toIso(monthIso).slice(0, 7), limit = 0, used = 0, pending = 0;
        (rows || []).forEach(function (r) { if (r.version === planVer && r.cfo === cfo && r.article === article && toIso(r.period).slice(0, 7) === m) limit += num(r.amount); });
        (requests || []).forEach(function (q) {
            if (q.id === skipId || q.cfo !== cfo || q.article !== article || toIso(q.date).slice(0, 7) !== m) return;
            if (USED[q.status]) used += num(q.amount); else if (q.status === 'На согласовании у ФД') pending += num(q.amount);
        });
        var rest = limit - used, after = rest - num(amount);
        return { limit: limit, used: used, pending: pending, rest: rest, after: after, over: num(amount) > 0 && after < 0, overBy: after < 0 ? -after : 0 };
    }
    /* Статус кампании по ЦФО на дату: сдан/просрочен/в работе. */
    function campaign(budgets, today) {
        return (budgets || []).map(function (b) {
            var done = !!DONE[b.status];
            var late = !done && b.deadline && toIso(b.deadline) < toIso(today);
            return Object.assign({}, b, { done: done, late: !!late, state: done ? (b.status === 'Сдан' ? 'review' : 'ok') : late ? 'late' : (b.status === 'Возвращён' ? 'back' : 'work') });
        });
    }
    function campaignSummary(list) {
        var s = { total: list.length, done: 0, approved: 0, late: 0, back: 0 };
        list.forEach(function (b) { if (b.done) s.done++; if (b.status === 'Утверждён' || b.status === 'Принят') s.approved++; if (b.late) s.late++; if (b.status === 'Возвращён') s.back++; });
        s.canLock = s.total > 0 && s.approved === s.total;
        return s;
    }
    /* Замок: в утверждённую версию не пишет никто; сданный бюджет руководитель ЦФО не правит до возврата. */
    function canEdit(version, budgetStatus, isFinance) {
        if (!version || version.locked) return false;
        if (isFinance) return true;
        return !(budgetStatus === 'Сдан' || budgetStatus === 'Утверждён' || budgetStatus === 'Принят');
    }
    /* Вставка из Excel: строки через перевод строки, ячейки через табуляцию; «1 234,5» -> 1234.5, пусто -> null. */
    function parseTsv(text) {
        return String(text || '').replace(/\r/g, '').split('\n').filter(function (l) { return l.trim() !== ''; }).map(function (l) {
            return l.split('\t').map(function (c) { c = c.trim().replace(/ /g, ''); return c === '' || c === '-' ? null : num(c); });
        });
    }
    function toCsv(head, rows) {
        function q(v) { v = v === null || v === undefined ? '' : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
        return [head].concat(rows).map(function (r) { return r.map(q).join(';'); }).join('\r\n');
    }
    /* Правка сетки -> операции _m_batch: set для существующих ячеек, new для новых. */
    function saveOps(before, after, ids, ctx) {
        var ops = [];
        Object.keys(after).forEach(function (art) {
            after[art].forEach(function (v, m) {
                var old = before[art] ? before[art][m] : null, id = ids[art] ? ids[art][m] : null;
                if ((old === null ? null : num(old)) === (v === null ? null : num(v))) return;
                if (id) ops.push({ op: 'set', id: id, fields: { 'Сумма строки': v === null ? 0 : v } });
                else if (v !== null) ops.push({ op: 'new', id: 'Строка бюджета', up: 1, fields: { 'Строка бюджета': ctx.year + '-' + String(m + 1).padStart(2, '0') + '-01', 'ЦФО': ctx.cfoId, 'Версия бюджета': ctx.versionId, 'Статья бюджета': ctx.articleIds[art], 'Сумма строки': v } });
            });
        });
        return ops;
    }
    return {
        MONTHS: MONTHS, num: num, toIso: toIso, monthIdx: monthIdx, yearOf: yearOf, addDays: addDays, sum: sum, round: round,
        grid: grid, cfoArticles: cfoArticles, growthPct: growthPct, checkGrid: checkGrid, hasErrors: hasErrors,
        consolidate: consolidate, pnl: pnl, compare: compare, planFact: planFact, limitState: limitState,
        campaign: campaign, campaignSummary: campaignSummary, canEdit: canEdit, parseTsv: parseTsv, toCsv: toCsv, saveOps: saveOps
    };
});
