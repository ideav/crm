/* Консолидация отчётности группы: чистые функции (разбор ОСВ, трансляция счетов, контроли пакета, сверка ВГО,
   элиминации, консолидация, версии, закрытие периода). Без DOM и сети: грузится в браузере (window.ConsolCore) и в node (тест).
   Знаки: суммы хранятся как в ОСВ - дебет «+», кредит «-». Актив показывается как есть, пассив и ОПУ - с обратным знаком. */
(function (root, factory) {
    var m = factory();
    if (typeof module === 'object' && module.exports) module.exports = m; else root.ConsolCore = m;
})(typeof window !== 'undefined' ? window : this, function () {
    'use strict';
    var RE_CODE = '1370'; /* нераспределённая прибыль: сюда закрывается влияние корректировок на прибыль */

    function num(v) {
        if (typeof v === 'number') return isFinite(v) ? v : 0;
        if (v === null || v === undefined) return 0;
        var s = String(v).replace(/[\s\u00a0]/g, '').replace(/[\u2212\u2013]/g, '-').replace(',', '.');
        if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
        var n = parseFloat(s); return isFinite(n) ? n : 0;
    }
    function round(n) { return Math.round(n * 100) / 100; }
    /* 1234567 -> «1 234 567», отрицательные с настоящим минусом. */
    function fmt(n) {
        n = round(num(n)); if (n === 0) return '0';
        var neg = n < 0, a = Math.abs(n), s = String(Math.round(a)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
        return (neg ? '\u2212' : '') + s;
    }
    function isBal(art) { return !!art && art.section !== 'ОПУ'; }
    /* Значение «как в отчёте»: актив как есть, пассив и ОПУ (доходы «+», расходы «-») с обратным знаком. */
    function disp(art, amount) { return art && art.section === 'А' ? amount : -amount; }

    /* ---------- ОСВ из 1С ---------- */
    /* Текст (CSV через «;» или «,», либо вставка из Excel через табуляцию). Колонки: Счёт; Наименование; ИНН контрагента;
       Сальдо нач. Дт; Сальдо нач. Кт; Оборот Дт; Оборот Кт; Сальдо кон. Дт; Сальдо кон. Кт. Строки без кода счёта (шапка, итоги) пропускаются. */
    function parseOsv(text) {
        var lines = String(text || '').replace(/^\ufeff/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });
        if (!lines.length) return [];
        var sep = lines.some(function (l) { return l.indexOf('\t') >= 0; }) ? '\t' : (lines[0].split(';').length > 2 ? ';' : ',');
        var out = [];
        lines.forEach(function (l) {
            var c = l.split(sep).map(function (x) { return x.trim().replace(/^"|"$/g, ''); });
            if (!/^\d{2}/.test(c[0] || '')) return;
            var o = { acc: c[0], name: c[1] || '', inn: (c[2] || '').replace(/\D/g, ''), open: num(c[3]) - num(c[4]), turnD: num(c[5]), turnK: num(c[6]), close: num(c[7]) - num(c[8]) };
            o.turn = o.turnD - o.turnK; out.push(o);
        });
        return out;
    }
    /* Типовая трансляция плана счетов 1С в статьи группы (длинный префикс важнее). skip - служебные счета закрытия. */
    var RULES = [['01', '1150'], ['02', '1150'], ['08', '1150'], ['10', '1210'], ['41', '1210'], ['43', '1210'], ['19', '1260'], ['50', '1250'], ['51', '1250'], ['52', '1250'], ['55', '1250'],
        ['58.01', '1170'], ['58.03', '1171'], ['60', '1520'], ['62', '1230'], ['63', '1540'], ['66', '1510'], ['67', '1410'], ['68', '1550'], ['69', '1550'], ['70', '1550'], ['71', '1260'], ['76', '1260'], ['97', '1260'],
        ['80', '1310'], ['84', '1370'], ['96', '1540'], ['99.01', '1370'], ['90.01', '2110'], ['90.02', '2120'], ['90.07', '2220'], ['90.08', '2220'], ['91.01', '2350'], ['91.02', '2350'], ['91.02.1', '2330'], ['99.02', '2410'],
        ['90.03', 'skip'], ['90.09', 'skip'], ['91.09', 'skip']];
    function ruleFor(acc) {
        var best = null;
        RULES.forEach(function (r) { if ((acc === r[0] || acc.indexOf(r[0] + '.') === 0) && (!best || r[0].length > best[0].length)) best = r; });
        return best ? best[1] : null;
    }
    function stems(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter(function (w) { return w.length >= 4; }).map(function (w) { return w.slice(0, 5); }); }
    /* Подсказка по наименованию счёта: статья с наибольшим пересечением основ слов. */
    function suggestByName(name, articles) {
        var st = stems(name), best = null, bestS = 0;
        articles.forEach(function (a) {
            if (a.ic) return;
            var as = stems(a.name), s = st.filter(function (w) { return as.indexOf(w) >= 0; }).length;
            if (s > bestS) { bestS = s; best = a.code; }
        });
        return best;
    }

    /* Трансляция строк ОСВ в строки пакета. ctx: {articles: [..], byCode, mapping: {счёт: код статьи} (подтверждённые счета общества),
       innTo: {ИНН: код общества}, self: код общества}. Контрагент группы по ИНН переводит статью в её пару «(ВГО)».
       status: mapped - счёт уже сопоставлен; suggested - по типовой трансляции или по наименованию, ждёт подтверждения; unmapped; skip. */
    function mapOsv(osv, ctx) {
        var by = ctx.byCode || {};
        return osv.map(function (r) {
            var code = ctx.mapping && ctx.mapping[r.acc], status = 'mapped', src = 'счёт общества';
            if (!code) { code = ruleFor(r.acc); status = 'suggested'; src = 'типовая трансляция 1С'; }
            if (!code) { code = suggestByName(r.name, ctx.articles || []); src = 'по наименованию'; status = code ? 'suggested' : 'unmapped'; }
            if (code === 'skip') return { acc: r.acc, name: r.name, status: 'skip', base: 'skip', article: '', cp: '', open: 0, amount: 0, src: 'служебный счёт закрытия' };
            var cp = r.inn && ctx.innTo ? ctx.innTo[r.inn] || '' : '';
            if (cp === ctx.self) cp = '';
            var art = by[code], fin = code;
            if (cp && art && art.icTwin) fin = art.icTwin;
            var fa = by[fin];
            return { acc: r.acc, name: r.name, inn: r.inn, base: code || '', article: fin || '', cp: cp, status: status, src: src,
                open: fa && isBal(fa) ? r.open : 0, amount: fa ? (isBal(fa) ? r.close : r.turn) : 0 };
        });
    }
    /* Подтверждение статьи для счёта (смена базовой статьи пересчитывает пару ВГО). */
    function remap(row, code, byCode, osvRow) {
        var art = byCode[code], fin = row.cp && art && art.icTwin ? art.icTwin : code, fa = byCode[fin];
        var r = Object.assign({}, row, { base: code, article: fin, status: 'mapped', src: 'подтверждено' });
        if (osvRow && fa) { r.open = isBal(fa) ? osvRow.open : 0; r.amount = isBal(fa) ? osvRow.close : osvRow.turn; }
        return r;
    }

    function sum(rows, f) { var s = 0; rows.forEach(function (r) { s += num(f(r)); }); return round(s); }
    function groupSum(lines, keyF, valF) { var m = {}; lines.forEach(function (l) { var k = keyF(l); m[k] = round((m[k] || 0) + num(valF(l))); }); return m; }
    function pct1(x) { return String(x).replace('.', ','); }

    /* ---------- контроли пакета ---------- */
    /* lines: [{article, cp, open, amount, status}] своего пакета; ctx: {byCode, self, prev: строки прошлого периода этого общества или null,
       counter: строки других обществ с cp === self, cpPkg: {код общества: статус пакета}, rules: {код контроля: {threshold, blocking, on}}}.
       Результат: [{code, title, state: ok|warn|error, msg, items}]. error - контроль блокирует отправку. */
    function controls(lines, ctx) {
        var by = ctx.byCode, rules = ctx.rules || {}, out = [];
        lines = lines.filter(function (l) { return l.status !== 'skip'; });
        function push(code, title, failed, msg, items, okMsg) {
            var r = rules[code] || { blocking: true, on: true };
            if (r.on === false) return;
            out.push({ code: code, title: title, state: failed ? (r.blocking ? 'error' : 'warn') : 'ok', msg: failed ? msg : (okMsg || 'сходится'), items: items || [] });
        }
        var art = function (l) { return by[l.article]; };
        var un = lines.filter(function (l) { return !l.article || l.status === 'unmapped'; });
        var sug = lines.filter(function (l) { return l.article && l.status === 'suggested'; });
        push('MAP', 'Все счета сопоставлены со статьями группы', un.length + sug.length > 0,
            (un.length ? un.length + ' без статьи' : '') + (un.length && sug.length ? ', ' : '') + (sug.length ? sug.length + ' ждут подтверждения подсказки' : ''),
            un.concat(sug).map(function (l) { return l.acc + ' ' + l.name; }), lines.length + ' счетов');
        var bal = lines.filter(function (l) { return isBal(art(l)); }), pnl = lines.filter(function (l) { return art(l) && !isBal(art(l)); });
        var sc = sum(bal, function (l) { return l.amount; }), so = sum(bal, function (l) { return l.open; });
        push('BAL', 'Баланс сходится: актив = пассив', Math.abs(sc) > 0.5 || Math.abs(so) > 0.5, 'расхождение на конец ' + fmt(sc) + (so ? ', на начало ' + fmt(so) : ''), [], 'актив = пассив на начало и конец');
        var re = bal.filter(function (l) { return l.article === RE_CODE; }), dRe = sum(re, function (l) { return l.amount; }) - sum(re, function (l) { return l.open; });
        var sp = sum(pnl, function (l) { return l.amount; });
        push('PNL', 'Прибыль в балансе = прибыль по ОПУ', Math.abs(round(dRe - sp)) > 0.5, 'изменение нераспределённой прибыли ' + fmt(-dRe) + ', прибыль по ОПУ ' + fmt(-sp), [], 'прибыль периода ' + fmt(-sp));
        if (ctx.prev && ctx.prev.length) {
            var po = groupSum(ctx.prev.filter(function (l) { return isBal(by[l.article]); }), function (l) { return l.article; }, function (l) { return l.amount; });
            var no = groupSum(bal, function (l) { return l.article; }, function (l) { return l.open; });
            var items = [];
            Object.keys(Object.assign({}, po, no)).forEach(function (k) {
                var d = round((no[k] || 0) - (po[k] || 0));
                if (Math.abs(d) > 0.5) items.push((by[k] ? by[k].name : k) + ': на начало ' + fmt(disp(by[k], no[k] || 0)) + ', в принятом пакете прошлого периода ' + fmt(disp(by[k], po[k] || 0)));
            });
            push('OPEN', 'Сальдо на начало = конец прошлого периода', items.length > 0, items.length + ' статей не совпадают с принятым пакетом прошлого периода', items, 'совпадает с принятым пакетом');
        }
        var th = (rules.OTHER && rules.OTHER.threshold) || 5;
        var share = function (rows) {
            var all = sum(rows, function (l) { return Math.abs(l.amount); }), o = sum(rows.filter(function (l) { return art(l).other; }), function (l) { return Math.abs(l.amount); });
            return all ? Math.round(o / all * 1000) / 10 : 0;
        };
        var shB = share(bal), shP = share(pnl), sh = Math.max(shB, shP);
        push('OTHER', 'Доля «прочих» статей не больше ' + th + '%', sh > th, '«прочие» ' + pct1(sh) + '% ' + (shP >= shB ? 'в ОПУ' : 'в балансе') + ': разнесите по статьям', [], 'баланс ' + pct1(shB) + '%, ОПУ ' + pct1(shP) + '%');
        var bySt = groupSum(bal, function (l) { return l.article; }, function (l) { return l.amount; });
        var neg = Object.keys(bySt).filter(function (k) { var a = by[k]; return a && ((a.section === 'А' && bySt[k] < -0.5) || (a.section === 'П' && k !== RE_CODE && bySt[k] > 0.5)); });
        push('SIGN', 'Знаки статей верные', neg.length > 0, neg.length + ' статей с обратным знаком', neg.map(function (k) { return by[k].name + ': ' + fmt(disp(by[k], bySt[k])); }), 'обратных знаков нет');
        var ic = icCheck(lines, ctx.counter || [], ctx.self, by, ctx.cpPkg || {}, ctx.icTol);
        var bad = ic.filter(function (p) { return p.state === 'diff'; }), wait = ic.filter(function (p) { return p.state === 'missing'; });
        push('IC', 'Внутригруппа бьётся с контрагентами', bad.length > 0, bad.length + ' расхождений' + (wait.length ? ', ' + wait.length + ' ждут пакета контрагента' : ''),
            bad.map(function (p) { return p.title + ': у нас ' + fmt(p.own) + ', у контрагента ' + fmt(p.their) + ', разница ' + fmt(Math.abs(p.diff)); }),
            ic.length ? ic.filter(function (p) { return p.state === 'ok'; }).length + ' пар сверено' + (wait.length ? ', ' + wait.length + ' ждут пакета контрагента' : '') : 'операций внутри группы нет');
        out.ic = ic;
        return out;
    }
    function canSubmit(res) { return !res.some(function (c) { return c.state === 'error'; }); }

    /* ---------- внутригруппа ---------- */
    /* Пары своих строк ВГО со встречными строками контрагента. own и their - суммы сторон по модулю,
       diff - сумма в знаках ОСВ (у сошедшейся пары 0). */
    function icCheck(own, counter, self, by, cpPkg, tol) {
        tol = tol || 0.5;
        var mine = groupSum(own.filter(function (l) { return l.cp && by[l.article] && by[l.article].ic; }), function (l) { return l.cp + '|' + l.article; }, function (l) { return l.amount; });
        var theirs = groupSum(counter.filter(function (l) { return l.cp === self; }), function (l) { return l.company + '|' + l.article; }, function (l) { return l.amount; });
        return Object.keys(mine).map(function (k) {
            var p = k.split('|'), a = by[p[1]], cnt = a.counter, t = theirs[p[0] + '|' + cnt];
            var present = t !== undefined, d = present ? round(mine[k] + t) : null;
            return { cp: p[0], article: p[1], counter: cnt, title: a.name + ' / ' + (by[cnt] ? by[cnt].name : cnt) + ' (' + p[0] + ')', own: Math.abs(mine[k]), their: present ? Math.abs(t) : null, diff: d,
                state: !present ? 'missing' : Math.abs(d) <= tol ? 'ok' : 'diff', cpStatus: cpPkg[p[0]] || 'нет пакета' };
        });
    }
    var PAIR_KIND = { '1171': 'Займы', '1411': 'Займы', '1231': 'Расчёты', '1521': 'Расчёты', '2111': 'Выручка и закупки', '2121': 'Выручка и закупки', '2320': 'Проценты', '2331': 'Проценты' };
    /* Все пары группы за период: lines - строки всех пакетов [{company, cp, article, amount}].
       Пара = (общество A, статья A) против (общество B, встречная статья); A - сторона актива или дохода. */
    function icPairs(lines, by, tol) {
        tol = tol || 0.5;
        var g = groupSum(lines.filter(function (l) { return l.cp && by[l.article] && by[l.article].ic; }), function (l) { return l.company + '|' + l.cp + '|' + l.article; }, function (l) { return l.amount; });
        var seen = {}, out = [];
        Object.keys(g).forEach(function (k) {
            if (seen[k]) return;
            var p = k.split('|'), a = by[p[2]], back = p[1] + '|' + p[0] + '|' + a.counter;
            seen[k] = seen[back] = true;
            var lead = a.section === 'А' || ['2111', '2320'].indexOf(a.code) >= 0;
            var f = lead ? [p[0], p[1], p[2], g[k], g[back]] : [p[1], p[0], a.counter, g[back], g[k]];
            var A = f[3] === undefined ? null : f[3], B = f[4] === undefined ? null : f[4];
            var d = A !== null && B !== null ? round(A + B) : null;
            out.push({ a: f[0], b: f[1], artA: f[2], artB: by[f[2]].counter, kind: PAIR_KIND[f[2]] || 'Прочее', amtA: A, amtB: B, diff: d,
                state: A === null || B === null ? 'missing' : Math.abs(d) <= tol ? 'ok' : 'diff' });
        });
        var rank = { diff: 0, missing: 1, ok: 2 };
        return out.sort(function (x, y) { return rank[x.state] - rank[y.state] || x.a.localeCompare(y.a) || x.b.localeCompare(y.b) || x.kind.localeCompare(y.kind); });
    }
    /* Проводки элиминации по сошедшимся парам: обе стороны сторнируются, на прибыль группы не влияет. */
    function eliminationEntries(pairs) {
        var e = [];
        pairs.filter(function (p) { return p.state === 'ok'; }).forEach(function (p) {
            e.push({ article: p.artA, company: p.a, amount: round(-p.amtA) });
            e.push({ article: p.artB, company: p.b, amount: round(-p.amtB) });
        });
        return e;
    }

    /* ---------- корректировки ---------- */
    /* adj: {basis, entries: [{article, company, amount}]}, kind: {profit: влияет ли на прибыль}. */
    function validateAdj(adj, by, kind) {
        var errs = [], en = (adj.entries || []).filter(function (e) { return e.article && num(e.amount) !== 0; });
        if (!en.length) errs.push('нет проводок');
        if (!String(adj.basis || '').trim()) errs.push('не указано основание: без него корректировку не утвердить');
        var bal = sum(en, function (e) { return e.amount; });
        if (Math.abs(bal) > 0.5) errs.push('проводка не сбалансирована: дебет - кредит = ' + fmt(bal));
        if (en.some(function (e) { return !e.company; })) errs.push('у проводки не указано общество');
        var pnl = sum(en.filter(function (e) { return by[e.article] && !isBal(by[e.article]); }), function (e) { return e.amount; });
        if (kind && !kind.profit && Math.abs(pnl) > 0.5) errs.push('вид «' + kind.name + '» не должен менять прибыль, а меняет на ' + fmt(-pnl));
        return { ok: !errs.length, errors: errs, profit: round(-pnl) || 0, balance: bal };
    }
    /* Номер корректировки: префикс вида + период + порядковый номер в периоде (по всем видам). */
    function nextAdjNum(adjs, periodShort, prefix) {
        var n = 0;
        adjs.forEach(function (a) { var m = /-(\d+)$/.exec(a.num || ''); if (a.period === periodShort || (a.num || '').indexOf('-' + periodShort + '-') > 0) n = Math.max(n, m ? +m[1] : 0); });
        return (prefix || 'К') + '-' + periodShort + '-' + String(n + 1).padStart(2, '0');
    }

    /* ---------- консолидация ---------- */
    /* lines: строки пакетов периода [{company, article, amount, ...}]; adjs: [{status, entries}]; opts.drafts - включать черновики.
       Корректировки, задевающие ОПУ, закрываются в нераспределённую прибыль: баланс группы сходится.
       Результат: {rows: [{code, name, section, group, byCo, pkg, adj, total, value}], cos, profit, assets, liab, check}. */
    function consolidate(lines, adjs, articles, cos, opts) {
        opts = opts || {};
        var by = {}, rows = articles.slice().sort(function (a, b) { return a.ord - b.ord; }).map(function (a) {
            var r = { code: a.code, name: a.name, section: a.section, group: a.group, other: a.other, ic: a.ic, byCo: {}, pkg: 0, adj: 0, adjPnl: 0, total: 0, src: [], adjSrc: [] };
            by[a.code] = r; return r;
        });
        lines.forEach(function (l) {
            var r = by[l.article]; if (!r) return;
            r.byCo[l.company] = round((r.byCo[l.company] || 0) + num(l.amount)); r.pkg = round(r.pkg + num(l.amount)); r.src.push(l);
        });
        var re = by[RE_CODE];
        (adjs || []).filter(function (a) { return a.status === 'Утверждена' || (opts.drafts && a.status !== 'Отклонена'); }).forEach(function (a) {
            (a.entries || []).forEach(function (e) {
                var r = by[e.article]; if (!r) return;
                r.adj = round(r.adj + num(e.amount)); r.adjSrc.push({ num: a.num, kind: a.kind, title: a.title, company: e.company, amount: num(e.amount), status: a.status });
                if (r.section === 'ОПУ' && re) { re.adj = round(re.adj + num(e.amount)); re.adjPnl = round(re.adjPnl + num(e.amount)); re.adjSrc.push({ num: a.num, kind: a.kind, title: 'влияние на прибыль: ' + r.name, company: e.company, amount: num(e.amount), status: a.status }); }
            });
        });
        rows.forEach(function (r) { r.total = round(r.pkg + r.adj); r.value = disp(r, r.total); });
        var s = function (f) { return round(rows.filter(f).reduce(function (x, r) { return x + r.total; }, 0)); };
        var assets = s(function (r) { return r.section === 'А'; }), liab = -s(function (r) { return r.section === 'П'; }), pnl = s(function (r) { return r.section === 'ОПУ'; });
        var coProfit = {};
        (cos || []).forEach(function (c) { coProfit[c] = round(-rows.filter(function (r) { return r.section === 'ОПУ'; }).reduce(function (x, r) { return x + (r.byCo[c] || 0); }, 0)); });
        return { rows: rows, by: by, cos: cos || [], assets: assets, liab: liab, profit: round(-pnl), coProfit: coProfit, check: round(assets - liab) };
    }
    /* Снимок версии: итог по статьям в знаках ОСВ + прибыль. */
    function snapshot(cons) {
        var s = {}; cons.rows.forEach(function (r) { if (r.total) s[r.code] = r.total; }); s._profit = cons.profit; return s;
    }
    /* Сравнение двух снимков: изменившиеся статьи и корректировки, которые объясняют изменение. */
    function compareSnap(a, b, articles, adjsB, adjsInA) {
        var inA = {}; (adjsInA || []).forEach(function (n) { inA[n] = 1; });
        var fresh = (adjsB || []).filter(function (x) { return !inA[x.num]; });
        var out = [];
        articles.slice().sort(function (x, y) { return x.ord - y.ord; }).forEach(function (art) {
            var va = num(a[art.code]), vb = num(b[art.code]), d = round(vb - va);
            if (Math.abs(d) < 0.5) return;
            var why = fresh.filter(function (x) { return (x.entries || []).some(function (e) { return e.article === art.code || (art.code === RE_CODE && articles.some(function (q) { return q.code === e.article && q.section === 'ОПУ'; })); }); }).map(function (x) { return x.num; });
            out.push({ code: art.code, name: art.name, section: art.section, a: disp(art, va), b: disp(art, vb), diff: disp(art, d), why: why });
        });
        return { rows: out, profitA: num(a._profit), profitB: num(b._profit), fresh: fresh.map(function (x) { return x.num; }) };
    }

    /* ---------- срок, статус, закрытие ---------- */
    function isoDate(s) { var m = /(\d{4})-(\d{2})-(\d{2})/.exec(s || '') || /(\d{2})\.(\d{2})\.(\d{4})/.exec(s || ''); if (!m) return null; return m[1].length === 4 ? m[1] + '-' + m[2] + '-' + m[3] : m[3] + '-' + m[2] + '-' + m[1]; }
    /* Рабочих дней просрочки: дни пн-пт после срока до сегодня включительно (праздники - список ISO-дат). */
    function workdaysLate(deadline, today, holidays) {
        var d0 = isoDate(deadline), d1 = isoDate(today); if (!d0 || !d1 || d1 <= d0) return 0;
        var t = new Date(d0 + 'T00:00:00Z'), end = new Date(d1 + 'T00:00:00Z'), n = 0, hol = holidays || [];
        while (t < end) { t.setUTCDate(t.getUTCDate() + 1); var w = t.getUTCDay(), iso = t.toISOString().slice(0, 10); if (w !== 0 && w !== 6 && hol.indexOf(iso) < 0) n++; }
        return n;
    }
    var STATUS_ORDER = ['Не начат', 'Черновик', 'Возвращён', 'Отправлен', 'Принят'];
    function statusKind(s) { return { 'Принят': 'good', 'Отправлен': 'info', 'Возвращён': 'bad', 'Черновик': 'warn', 'Не начат': 'muted' }[s] || 'info'; }
    /* Чек-лист закрытия периода. st: {pkgs: [{company, status}], perimeter: [коды обществ], pkgControls: {код: [контроли]}, pairs, adjs, cons}. */
    function closeChecklist(st) {
        var per = st.perimeter || [], acc = per.filter(function (c) { return (st.pkgs || []).some(function (p) { return p.company === c && p.status === 'Принят'; }); });
        var red = per.filter(function (c) { return (st.pkgControls && st.pkgControls[c] || []).some(function (x) { return x.state === 'error'; }); });
        var badPairs = (st.pairs || []).filter(function (p) { return p.state !== 'ok'; });
        var drafts = (st.adjs || []).filter(function (a) { return a.status === 'Черновик'; });
        var noBasis = (st.adjs || []).filter(function (a) { return a.status !== 'Отклонена' && !String(a.basis || '').trim(); });
        var steps = [
            { key: 'pkgs', title: 'Пакеты всех обществ приняты', ok: acc.length === per.length, info: acc.length + ' из ' + per.length + (acc.length < per.length ? ', не приняты: ' + per.filter(function (c) { return acc.indexOf(c) < 0; }).join(', ') : '') },
            { key: 'ctl', title: 'Блокирующие контроли пакетов зелёные', ok: !red.length, info: red.length ? 'красные у ' + red.join(', ') : 'все зелёные' },
            { key: 'ic', title: 'Внутригруппа сверена', ok: !badPairs.length, info: badPairs.length ? badPairs.length + ' пар с расхождением или без встречного пакета' : 'все пары сошлись' },
            { key: 'adj', title: 'Корректировки утверждены и обоснованы', ok: !drafts.length && !noBasis.length, info: (drafts.length ? drafts.length + ' в черновике' : 'черновиков нет') + (noBasis.length ? ', без основания: ' + noBasis.map(function (a) { return a.num; }).join(', ') : '') },
            { key: 'bal', title: 'Консолидированный баланс сходится', ok: !!st.cons && Math.abs(st.cons.check) < 0.5, info: st.cons ? 'актив - пассив = ' + fmt(st.cons.check) : '' }
        ];
        return { steps: steps, ready: steps.every(function (s) { return s.ok; }), failed: steps.filter(function (s) { return !s.ok; }) };
    }
    function periodLocked(p) { return !!p && p.status === 'Закрыт'; }
    function toCsv(rows, cols) {
        var q = function (v) { v = v === null || v === undefined ? '' : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        return [cols.map(function (c) { return q(c[1]); }).join(';')].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c[0]]); }).join(';'); })).join('\r\n');
    }

    return { RE_CODE: RE_CODE, RULES: RULES, num: num, round: round, fmt: fmt, isBal: isBal, disp: disp, parseOsv: parseOsv, ruleFor: ruleFor, suggestByName: suggestByName,
        mapOsv: mapOsv, remap: remap, sum: sum, groupSum: groupSum, controls: controls, canSubmit: canSubmit, icCheck: icCheck, icPairs: icPairs, eliminationEntries: eliminationEntries,
        validateAdj: validateAdj, nextAdjNum: nextAdjNum, consolidate: consolidate, snapshot: snapshot, compareSnap: compareSnap, isoDate: isoDate, workdaysLate: workdaysLate,
        STATUS_ORDER: STATUS_ORDER, statusKind: statusKind, closeChecklist: closeChecklist, periodLocked: periodLocked, toCsv: toCsv };
});
