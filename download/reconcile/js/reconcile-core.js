/* Сверка данных: чистые функции (разбор файлов по формату, нормализация, сопоставление, причины расхождений, возраст, «четыре глаза», период). Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ReconCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var DAY = 86400000;
    var REASONS = {
        NO_LEDGER: 'Нет в учёте',
        NO_BANK: 'Нет в банке',
        AMOUNT: 'Сумма не равна',
        DATE: 'Дата вне допуска',
        DUP: 'Дубль в учёте',
        FEE: 'Комиссия банка не проведена'
    };
    var DEFAULT_RULES = [
        { name: 'Точное: сумма, дата, п/п, контрагент', kind: 'exact', keys: ['amount', 'date', 'doc', 'cp'], on: true },
        { name: 'Точное без номера п/п', kind: 'exact', keys: ['amount', 'date', 'cp'], on: true },
        { name: 'Допуск: сумма ±1 ₽, дата ±2 дня', kind: 'tol', amtTol: 1, dayTol: 2, on: true },
        { name: 'N:1: один платёж за несколько документов', kind: 'many', amtTol: 0, dayTol: 3, maxK: 4, on: true }
    ];

    /* ---------- даты и числа ---------- */
    function utc(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
    function iso(t) { return new Date(t).toISOString().slice(0, 10); }
    function dayNo(isoDate) { return Math.round(utc(isoDate) / DAY); }
    function addDays(s, n) { return iso(utc(s) + n * DAY); }
    function diffDays(a, b) { return Math.round((utc(b) - utc(a)) / DAY); }
    function toIso(s) {
        if (!s) return '';
        s = String(s).trim();
        var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
        m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/); if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
        return '';
    }
    function toDmy(s) { var i = toIso(s); return i ? i.slice(8, 10) + '.' + i.slice(5, 7) + '.' + i.slice(0, 4) : ''; }
    /* Дата по формату источника; неверная дата (31.02) - null. */
    function parseDate(s, fmt) {
        s = String(s === undefined || s === null ? '' : s).trim();
        var m, d, mo, y;
        if (fmt === 'ГГГГ-ММ-ДД') { m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; } }
        else if (fmt === 'ДД/ММ/ГГГГ') { m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; } }
        else { m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/); if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; } }
        if (!m) return null;
        var t = Date.UTC(y, mo - 1, d), dt = new Date(t);
        if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
        return iso(t);
    }
    /* Сумма: «1 234 567,89», «1234567.89», «-12,5», «(500,00)»; dec - десятичный знак источника. */
    function parseAmount(s, dec) {
        if (typeof s === 'number') return s;
        s = String(s === undefined || s === null ? '' : s).trim();
        if (!s) return null;
        var neg = /^\(.*\)$/.test(s) || /^-/.test(s);
        s = s.replace(/[()\-+\s  ₽]|руб\.?/g, '');
        if (dec === '.') s = s.replace(/,/g, ''); else s = s.replace(/\./g, '').replace(',', '.');
        if (!/^\d+(\.\d+)?$/.test(s)) return null;
        var v = parseFloat(s);
        return neg ? -v : v;
    }
    function num(x) { var v = parseFloat(String(x === undefined || x === null ? '' : x).replace(/\s/g, '').replace(',', '.')); return isFinite(v) ? v : 0; }
    function cents(x) { return Math.round(num(x) * 100); }
    function round2(x) { return Math.round(x * 100) / 100; }
    function money(x) {
        var n = round2(num(x)), s = Math.abs(n).toFixed(2).split('.');
        return (n < 0 ? '-' : '') + s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + s[1] + ' ₽';
    }

    /* ---------- нормализация ---------- */
    /* Контрагент: «ООО "Ромашка"», «Ромашка ООО», «ООО «РОМАШКА»» - один ключ. */
    function normName(s) {
        return String(s || '').toLowerCase().replace(/ё/g, 'е')
            .replace(/["'«»„“”]/g, ' ')
            .replace(/(^|[\s,.])(ооо|оао|зао|пао|ао|ип|нао|фгуп|муп|гуп|общество с ограниченной ответственностью|акционерное общество)(?=$|[\s,.])/g, ' ')
            .replace(/[^a-zа-я0-9]+/g, ' ').trim().split(' ').filter(Boolean).sort().join(' ');
    }
    /* Номер документа: «№ 000123», «п/п 123», «123» - «123». */
    function normDoc(s) { var m = String(s || '').match(/\d+/g); return m ? m.join('').replace(/^0+(?=\d)/, '') : ''; }
    /* Номер п/п из назначения платежа, если отдельной колонки нет. */
    function docFromPurpose(s) { var m = String(s || '').match(/(?:п\/п|пп|пл\.?\s*пор\.?|№)\s*№?\s*(\d{1,10})/i); return m ? normDoc(m[1]) : ''; }
    function isFee(purpose) { return /комисси|абонентск\w* плат|за ведение сч|обслуживани\w* сч/i.test(String(purpose || '')); }

    /* ---------- разбор файла ---------- */
    /* CSV с кавычками и переводами строк внутри; разделитель - из формата (\t допускается). */
    function parseCsv(text, delim) {
        delim = delim === '\t' || delim === 'TAB' ? '\t' : (delim || ';');
        text = String(text || '').replace(/^﻿/, '');
        var rows = [], row = [], cell = '', q = false, i, ch;
        for (i = 0; i < text.length; i++) {
            ch = text[i];
            if (q) {
                if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
                else cell += ch;
            } else if (ch === '"' && cell === '') q = true;
            else if (ch === delim) { row.push(cell); cell = ''; }
            else if (ch === '\n' || ch === '\r') {
                if (ch === '\r' && text[i + 1] === '\n') i++;
                row.push(cell); cell = '';
                if (row.length > 1 || row[0] !== '') rows.push(row);
                row = [];
            } else cell += ch;
        }
        if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
        return rows;
    }
    var FIELD_LABEL = { date: 'Дата', amount: 'Сумма', 'in': 'Приход', out: 'Расход', cp: 'Контрагент', inn: 'ИНН', doc: 'Номер документа', purpose: 'Назначение' };
    function hdr(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim(); }
    /* Применить формат: заголовки ищутся по имени (без учёта регистра), обязательные проверяются до разбора строк.
       fmt = {delim, dateFmt, dec, skip, side, cols: [{field, header, required}]} */
    function applyFormat(text, fmt) {
        var all = parseCsv(text, fmt.delim), skip = fmt.skip || 0;
        var head = (all[skip] || []).map(hdr), body = all.slice(skip + 1);
        var pos = {}, missing = [];
        (fmt.cols || []).forEach(function (c) {
            var i = head.indexOf(hdr(c.header));
            if (i >= 0) pos[c.field] = i; else if (c.required) missing.push({ field: c.field, label: FIELD_LABEL[c.field] || c.field, header: c.header });
        });
        if (pos.amount === undefined && pos['in'] === undefined && pos.out === undefined && !missing.some(function (m) { return m.field === 'amount' || m.field === 'in' || m.field === 'out'; }))
            missing.push({ field: 'amount', label: 'Сумма', header: '' });
        var res = { headers: all[skip] || [], missing: missing, rows: [], errors: [], total: body.length };
        if (missing.length) return res;
        body.forEach(function (r, k) {
            var line = skip + k + 2, get = function (f) { return pos[f] === undefined ? '' : String(r[pos[f]] === undefined ? '' : r[pos[f]]).trim(); };
            var d = parseDate(get('date'), fmt.dateFmt), a;
            if (pos.amount !== undefined) a = parseAmount(get('amount'), fmt.dec);
            else { var vi = parseAmount(get('in'), fmt.dec) || 0, vo = parseAmount(get('out'), fmt.dec) || 0; a = (get('in') === '' && get('out') === '') ? null : round2(vi - vo); }
            if (!d) { res.errors.push({ line: line, msg: 'дата «' + get('date') + '» не по формату ' + fmt.dateFmt }); return; }
            if (a === null || isNaN(a)) { res.errors.push({ line: line, msg: 'сумма «' + (get('amount') || get('in') || get('out')) + '» не число' }); return; }
            var purpose = get('purpose'), doc = normDoc(get('doc')) || docFromPurpose(purpose);
            res.rows.push({ line: line, date: d, amount: a, cp: get('cp'), inn: get('inn'), doc: get('doc'), purpose: purpose, d: dayNo(d), c: Math.round(a * 100), k: normName(get('cp')) || get('inn'), n: doc });
        });
        return res;
    }
    /* Запись из базы или файла - во внутренний вид сопоставления. */
    function prep(r) {
        var a = num(r.amount);
        return Object.assign({}, r, { d: dayNo(toIso(r.date)), c: Math.round(a * 100), k: r.k || normName(r.cp) || r.inn || '', n: r.n !== undefined ? r.n : (normDoc(r.doc) || docFromPurpose(r.purpose)) });
    }

    /* ---------- сопоставление ---------- */
    function keyOf(r, keys) {
        var out = [];
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (k === 'amount') out.push(r.c); else if (k === 'date') out.push(r.d);
            else if (k === 'doc') { if (!r.n) return null; out.push(r.n); }
            else { if (!r.k) return null; out.push(r.k); }
        }
        return out.join('|');
    }
    function indexBy(list, used, fn) {
        var m = new Map();
        for (var i = 0; i < list.length; i++) {
            if (used[i]) continue;
            var k = fn(list[i]); if (k === null || k === '') continue;
            var a = m.get(k); if (a) a.push(i); else m.set(k, [i]);
        }
        return m;
    }
    /* Подмножество кандидатов (2..maxK), сумма которого равна цели в пределах допуска (копейки). */
    function subsetSum(target, vals, tol, maxK) {
        var best = null;
        function go(start, sum, pick) {
            if (best) return;
            if (pick.length >= 2 && Math.abs(sum - target) <= tol) { best = pick.slice(); return; }
            if (pick.length >= maxK) return;
            for (var i = start; i < vals.length; i++) {
                var s = sum + vals[i];
                if (target > 0 ? s > target + tol : s < target - tol) continue;
                pick.push(i); go(i + 1, s, pick); pick.pop();
                if (best) return;
            }
        }
        go(0, 0, []);
        return best;
    }
    /* Многоуровневое сопоставление A (банк) и B (учёт) по правилам по порядку: точное → допуск → N:1. */
    function match(A, B, rules) {
        var uA = new Uint8Array(A.length), uB = new Uint8Array(B.length), groups = [];
        function add(rule, a, b) {
            var sa = 0, sb = 0; a.forEach(function (i) { uA[i] = 1; sa += A[i].c; }); b.forEach(function (j) { uB[j] = 1; sb += B[j].c; });
            groups.push({ id: groups.length + 1, rule: rule.name, kind: rule.kind, a: a, b: b, diff: (sa - sb) / 100 });
        }
        (rules || DEFAULT_RULES).forEach(function (rule) {
            if (rule.on === false) return;
            if (rule.kind === 'exact') {
                var m = indexBy(B, uB, function (r) { return keyOf(r, rule.keys); });
                for (var i = 0; i < A.length; i++) {
                    if (uA[i]) continue;
                    var k = keyOf(A[i], rule.keys); if (k === null) continue;
                    var l = m.get(k); if (!l) continue;
                    while (l.length && uB[l[0]]) l.shift();
                    if (l.length) add(rule, [i], [l.shift()]);
                }
            } else if (rule.kind === 'tol') {
                var byK = indexBy(B, uB, function (r) { return r.k; }), at = Math.round((rule.amtTol || 0) * 100), dt = rule.dayTol || 0;
                for (var x = 0; x < A.length; x++) {
                    if (uA[x]) continue;
                    var cand = byK.get(A[x].k); if (!cand) continue;
                    var best = -1, bs = Infinity;
                    cand.forEach(function (j) {
                        if (uB[j]) return;
                        var dc = Math.abs(A[x].c - B[j].c), dd = Math.abs(A[x].d - B[j].d);
                        if (dc <= at && dd <= dt && (A[x].c > 0) === (B[j].c > 0) && dc / 100 + dd < bs) { bs = dc / 100 + dd; best = j; }
                    });
                    if (best >= 0) add(rule, [x], [best]);
                }
            } else if (rule.kind === 'many') {
                manyPass(A, B, uA, uB, rule, function (i, js) { add(rule, [i], js); });
                manyPass(B, A, uB, uA, rule, function (j, is) { add(rule, is, [j]); });
            }
        });
        var unA = [], unB = [];
        for (var p = 0; p < A.length; p++) if (!uA[p]) unA.push(p);
        for (var q = 0; q < B.length; q++) if (!uB[q]) unB.push(q);
        return { groups: groups, unA: unA, unB: unB, usedA: uA, usedB: uB };
    }
    /* Одна запись X против нескольких записей Y того же контрагента в окне дат. */
    function manyPass(X, Y, uX, uY, rule, onHit) {
        var byK = indexBy(Y, uY, function (r) { return r.k; }), tol = Math.round((rule.amtTol || 0) * 100), dt = rule.dayTol || 0, maxK = rule.maxK || 4;
        for (var i = 0; i < X.length; i++) {
            if (uX[i]) continue;
            var js = pickMany(X[i], Y, (byK.get(X[i].k) || []).filter(function (j) { return !uY[j]; }), dt, tol, maxK);
            if (js) onHit(i, js);
        }
    }
    function pickMany(x, Y, cand, dayTol, tol, maxK) {
        var c = cand.filter(function (j) { var y = Y[j]; return Math.abs(y.d - x.d) <= dayTol && (y.c > 0) === (x.c > 0) && Math.abs(y.c) <= Math.abs(x.c) + tol; })
            .sort(function (a, b) { return Math.abs(Y[a].d - x.d) - Math.abs(Y[b].d - x.d); }).slice(0, 14);
        if (c.length < 2) return null;
        var s = subsetSum(x.c, c.map(function (j) { return Y[j].c; }), tol, maxK);
        return s ? s.map(function (k) { return c[k]; }) : null;
    }
    /* Предложение N:1 для ручного разбора: окно дат шире, чем у автоматического правила. */
    function suggest(x, pool, opts) {
        opts = opts || {};
        var X = prep(x), Y = pool.map(prep), cand = [];
        Y.forEach(function (y, j) { if (y.k && y.k === X.k) cand.push(j); });
        var js = pickMany(X, Y, cand, opts.dayTol || 15, Math.round((opts.amtTol || 0) * 100), opts.maxK || 4);
        if (!js) {
            /* одна запись с той же суммой, но вне окна дат */
            var one = cand.filter(function (j) { return Y[j].c === X.c; })[0];
            js = one === undefined ? null : [one];
        }
        if (!js) return null;
        var sum = 0; js.forEach(function (j) { sum += Y[j].c; });
        return { idx: js, rows: js.map(function (j) { return pool[j]; }), sum: sum / 100, diff: (X.c - sum) / 100 };
    }

    /* ---------- причины расхождений ---------- */
    /* Каждая непарная запись получает причину; пара «нашлась, но сумма/дата не та» - одно расхождение на обе стороны. */
    function classify(A, B, res, opts) {
        opts = opts || {};
        var dayTol = opts.dayTol === undefined ? 2 : opts.dayTol, pct = opts.amountPct === undefined ? 5 : opts.amountPct;
        var items = [], doneA = {}, doneB = {};
        function item(reason, a, b) {
            var sa = 0, sb = 0, rec = a.length ? A[a[0]] : B[b[0]];
            a.forEach(function (i) { doneA[i] = 1; sa += A[i].c; }); b.forEach(function (j) { doneB[j] = 1; sb += B[j].c; });
            items.push({ reason: reason, a: a, b: b, amount: (a.length ? sa : sb) / 100, diff: (sa - sb) / 100, cp: rec.cp || '', date: rec.date || '', k: rec.k });
        }
        var all = new Map();
        B.forEach(function (r, j) { var k = r.c + '|' + r.d + '|' + r.k + '|' + r.n; all.set(k, (all.get(k) || 0) + 1); });
        res.unB.forEach(function (j) { var r = B[j]; if (r.n && all.get(r.c + '|' + r.d + '|' + r.k + '|' + r.n) > 1) item(REASONS.DUP, [], [j]); });
        res.unA.forEach(function (i) { if (A[i].c < 0 && isFee(A[i].purpose)) item(REASONS.FEE, [i], []); });
        var restB = function () { return res.unB.filter(function (j) { return !doneB[j]; }); };
        var byDoc = new Map(), byK = new Map();
        restB().forEach(function (j) { var r = B[j]; if (r.n && r.k) byDoc.set(r.k + '|' + r.n, j); if (!byK.has(r.k)) byK.set(r.k, []); byK.get(r.k).push(j); });
        res.unA.forEach(function (i) {
            if (doneA[i]) return;
            var a = A[i], j = a.n ? byDoc.get(a.k + '|' + a.n) : undefined;
            if (j !== undefined && !doneB[j] && B[j].c !== a.c) { item(REASONS.AMOUNT, [i], [j]); return; }
            var near = (byK.get(a.k) || []).filter(function (q) { var b = B[q]; return !doneB[q] && Math.abs(b.d - a.d) <= dayTol && b.c !== a.c && (b.c > 0) === (a.c > 0) && Math.abs(b.c - a.c) <= Math.abs(a.c) * pct / 100; })[0];
            if (near !== undefined) item(REASONS.AMOUNT, [i], [near]);
        });
        var byAmt = new Map(); restB().forEach(function (j) { var r = B[j]; var k = r.k + '|' + r.c; if (!byAmt.has(k)) byAmt.set(k, []); byAmt.get(k).push(j); });
        res.unA.forEach(function (i) {
            if (doneA[i]) return;
            var l = (byAmt.get(A[i].k + '|' + A[i].c) || []).filter(function (j) { return !doneB[j] && Math.abs(B[j].d - A[i].d) > dayTol; });
            if (l.length) item(REASONS.DATE, [i], [l[0]]);
        });
        res.unA.forEach(function (i) { if (!doneA[i]) item(REASONS.NO_LEDGER, [i], []); });
        res.unB.forEach(function (j) { if (!doneB[j]) item(REASONS.NO_BANK, [], [j]); });
        return items;
    }
    /* Итог прогона: сошлось/не сошлось по строкам, по причинам и по правилам. */
    function summary(A, B, res, items) {
        var tot = A.length + B.length, un = res.unA.length + res.unB.length, br = {}, bu = {};
        items.forEach(function (it) { var r = br[it.reason] || (br[it.reason] = { reason: it.reason, n: 0, rows: 0, sum: 0 }); r.n++; r.rows += it.a.length + it.b.length; r.sum += Math.abs(it.diff || it.amount); });
        res.groups.forEach(function (g) { var r = bu[g.rule] || (bu[g.rule] = { rule: g.rule, groups: 0, rows: 0 }); r.groups++; r.rows += g.a.length + g.b.length; });
        return {
            rowsA: A.length, rowsB: B.length, total: tot, matched: tot - un, unmatched: un,
            pct: tot ? Math.round((tot - un) / tot * 1000) / 10 : 100,
            byReason: Object.keys(br).map(function (k) { br[k].sum = round2(br[k].sum); return br[k]; }).sort(function (a, b) { return b.sum - a.sum; }),
            byRule: Object.keys(bu).map(function (k) { return bu[k]; })
        };
    }

    /* ---------- разбор расхождений: возраст, срок, «четыре глаза», период ---------- */
    var ST = { OPEN: 'Открыто', CHECK: 'На проверке', DONE: 'Закрыто' };
    function ageDays(found, today) { var f = toIso(found); return f ? Math.max(0, diffDays(f, today)) : 0; }
    function ageBucket(days) { return days <= 1 ? 'до 2 дн.' : days <= 5 ? '2–5 дн.' : days <= 15 ? '6–15 дн.' : 'больше 15 дн.'; }
    var BUCKETS = ['до 2 дн.', '2–5 дн.', '6–15 дн.', 'больше 15 дн.'];
    function isOverdue(d, today) { return d.status !== ST.DONE && !!toIso(d.due) && toIso(d.due) < today; }
    function periodOf(date, periods) { var i = toIso(date); return (periods || []).filter(function (p) { return toIso(p.from) <= i && i <= toIso(p.to); })[0] || null; }
    function isLocked(date, periods) { var p = periodOf(date, periods); return !!p && p.status === 'Закрыт'; }
    /* Закрыть с основанием (оператор или контролёр). Возвращает список причин отказа; пусто - можно. */
    function closeErrors(d, basis, role, periods) {
        var e = [];
        if (d.status !== ST.OPEN) e.push('Расхождение уже ' + (d.status === ST.CHECK ? 'на проверке' : 'закрыто'));
        if (role !== 'operator' && role !== 'controller') e.push('Закрывать расхождения может оператор или контролёр');
        if (String(basis || '').trim().length < 10) e.push('Укажите основание закрытия (не короче 10 символов): документ, проводка или письмо');
        if (isLocked(d.date, periods)) e.push('Период операции закрыт: правки запрещены');
        return e;
    }
    /* Подтвердить закрытие: только контролёр и только не тот, кто закрывал (принцип четырёх глаз). */
    function approveErrors(d, user, role, periods) {
        var e = [];
        if (role !== 'controller') e.push('Подтверждает закрытие только контролёр');
        if (d.status !== ST.CHECK) e.push('Подтвердить можно только расхождение на проверке');
        if (d.closedBy && d.closedBy === user) e.push('Четыре глаза: закрыл и подтверждает один и тот же пользователь');
        if (isLocked(d.date, periods)) e.push('Период операции закрыт: правки запрещены');
        return e;
    }
    /* Закрыть период можно, только когда в нём нет незакрытых расхождений. */
    function lockErrors(period, discs) {
        var open = (discs || []).filter(function (d) { var i = toIso(d.date); return i >= toIso(period.from) && i <= toIso(period.to) && d.status !== ST.DONE; });
        return open.length ? ['В периоде ' + period.name + ' не закрыто расхождений: ' + open.length] : [];
    }
    /* Код роли по названию роли в базе. */
    function roleKey(role) {
        var r = String(role || '').toLowerCase();
        if (/оператор/.test(r)) return 'operator';
        if (/контрол/.test(r)) return 'controller';
        if (/методолог/.test(r)) return 'methodologist';
        if (/аудит/.test(r)) return 'auditor';
        if (r === 'admin' || /админ/.test(r)) return 'controller';
        return 'viewer';
    }

    /* ---------- нагрузочный прогон и служебное ---------- */
    function rng(seed) { var s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    /* Две синтетические выгрузки по n строк с заложенным шумом ~6%: суммы, даты, пропуски, дубли, оплаты N:1. */
    function synth(n, seed) {
        var R = rng(seed || 979), A = new Array(n), B = [], d0 = dayNo('2026-11-02'), cps = Math.max(50, Math.round(n / 40));
        for (var i = 0; i < n; i++) {
            var k = 'k' + Math.floor(R() * cps), c = (Math.floor(R() * 5000000) + 1000) * (R() < 0.45 ? -1 : 1), d = d0 + Math.floor(R() * 24), doc = String(100000 + i);
            A[i] = { d: d, c: c, k: k, n: doc };
            var x = R();
            if (x < 0.94) B.push({ d: d + (R() < 0.15 ? 1 : 0), c: c, k: k, n: R() < 0.2 ? '' : doc });
            else if (x < 0.955) B.push({ d: d, c: c + (Math.floor(R() * 9000) + 200) * (c > 0 ? -1 : 1), k: k, n: doc });
            else if (x < 0.965) B.push({ d: d + 6 + Math.floor(R() * 5), c: c, k: k, n: '' });
            else if (x < 0.975) { var p1 = Math.round(c * 0.6); B.push({ d: d, c: p1, k: k, n: '' }); B.push({ d: d + 1, c: c - p1, k: k, n: '' }); }
            else if (x < 0.985) { B.push({ d: d, c: c, k: k, n: doc }); B.push({ d: d, c: c, k: k, n: doc }); }
            /* иначе - нет в учёте */
            if (R() < 0.01) B.push({ d: d0 + Math.floor(R() * 24), c: (Math.floor(R() * 900000) + 100) * -1, k: 'k' + Math.floor(R() * cps), n: String(900000 + i) });
        }
        return { A: A, B: B };
    }
    /* Хэш содержимого файла для журнала (FNV-1a, 32 бита). */
    function hash(text) { var h = 0x811c9dc5; text = String(text || ''); for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); } return ('0000000' + (h >>> 0).toString(16)).slice(-8); }
    function toCsv(rows, cols) {
        var q = function (v) { v = v === undefined || v === null ? '' : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        return [cols.map(function (c) { return q(c.t); }).join(';')].concat(rows.map(function (r) { return cols.map(function (c) { return q(typeof c.k === 'function' ? c.k(r) : r[c.k]); }).join(';'); })).join('\r\n');
    }
    /* Правила из таблицы «Правило сопоставления» базы. */
    function rulesFrom(rows) {
        var kind = { 'Точное': 'exact', 'Допуск': 'tol', 'N:1': 'many' }, keyMap = { 'сумма': 'amount', 'дата': 'date', 'документ': 'doc', 'п/п': 'doc', 'контрагент': 'cp' };
        return rows.slice().sort(function (a, b) { return num(a.order) - num(b.order); }).map(function (r) {
            return { name: r.name, kind: kind[r.kind] || 'exact', keys: String(r.keys || '').split(/[,+]/).map(function (s) { return keyMap[s.trim().toLowerCase()]; }).filter(Boolean), amtTol: num(r.amtTol), dayTol: num(r.dayTol), maxK: num(r.maxK) || 4, on: r.on !== false && r.on !== '' && r.on !== '0' };
        });
    }

    return {
        REASONS: REASONS, DEFAULT_RULES: DEFAULT_RULES, ST: ST, BUCKETS: BUCKETS, FIELD_LABEL: FIELD_LABEL,
        utc: utc, iso: iso, dayNo: dayNo, addDays: addDays, diffDays: diffDays, toIso: toIso, toDmy: toDmy, parseDate: parseDate, parseAmount: parseAmount, num: num, cents: cents, round2: round2, money: money,
        normName: normName, normDoc: normDoc, docFromPurpose: docFromPurpose, isFee: isFee, parseCsv: parseCsv, applyFormat: applyFormat, prep: prep,
        subsetSum: subsetSum, match: match, suggest: suggest, classify: classify, summary: summary,
        ageDays: ageDays, ageBucket: ageBucket, isOverdue: isOverdue, periodOf: periodOf, isLocked: isLocked, closeErrors: closeErrors, approveErrors: approveErrors, lockErrors: lockErrors, roleKey: roleKey,
        synth: synth, rng: rng, hash: hash, toCsv: toCsv, rulesFrom: rulesFrom
    };
});
