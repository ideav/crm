/* GRC: чистые функции внутреннего контроля (шкалы и зоны риска, тепловая карта, остаточный риск, кампания подтверждения, пробелы матрицы, разбор Excel, цепочка журнала). Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.GrcCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var DAY = 86400000;
    var DONE = 'Выполнен', FAIL = 'Не выполнен';

    function num(x) { var n = parseFloat(String(x === undefined || x === null ? '' : x).replace(',', '.').replace(/\s/g, '')); return isNaN(n) ? 0 : n; }
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

    /* ---------- шкалы и зоны ---------- */
    /* Зона по баллу «вероятность × влияние»: зоны заказчика заданы диапазонами баллов. */
    function zoneOf(score, zones) {
        for (var i = 0; i < zones.length; i++) if (score >= zones[i].from && score <= zones[i].to) return zones[i];
        return null;
    }
    function zoneRank(zone, zones) { var s = zones.slice().sort(function (a, b) { return a.from - b.from; }); return zone ? s.indexOf(zone) : -1; }

    /* ---------- запросы подтверждения ---------- */
    /* Состояние запроса на дату: done / fail / late (ответ после срока) / overdue (нет ответа, срок прошёл) / wait. */
    function requestState(req, camp, today) {
        var due = camp && camp.due;
        if (req.result === DONE || req.result === FAIL) {
            var late = due && req.answered && req.answered > due;
            if (req.result === FAIL) return 'fail';
            return late ? 'late' : 'done';
        }
        return due && today > due ? 'overdue' : 'wait';
    }
    /* Доказательство обязательно, если у контроля задано «что приложить». */
    function evidenceMissing(req, ctrl) { return req.result === DONE && !!(ctrl && ctrl.evidence) && !req.file; }

    function campaignStats(reqs, camp, ctrlBy, today) {
        var s = { total: reqs.length, done: 0, late: 0, fail: 0, overdue: 0, wait: 0, noFile: 0 };
        reqs.forEach(function (r) { s[requestState(r, camp, today)]++; if (evidenceMissing(r, ctrlBy[r.control])) s.noFile++; });
        s.answered = s.done + s.late + s.fail;
        s.onTimePct = s.total ? Math.round(100 * s.done / s.total) : 0;
        s.answeredPct = s.total ? Math.round(100 * s.answered / s.total) : 0;
        return s;
    }
    /* Свод по владельцам: кто сколько не ответил. */
    function byOwner(reqs, camp, today) {
        var m = {};
        reqs.forEach(function (r) {
            var o = m[r.owner] = m[r.owner] || { owner: r.owner, total: 0, done: 0, fail: 0, overdue: 0, late: 0, wait: 0 };
            o.total++; o[requestState(r, camp, today)]++;
        });
        return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.overdue - a.overdue || b.fail - a.fail || (a.owner < b.owner ? -1 : 1); });
    }
    /* Повторы: контроль не выполнен или без ответа в нескольких кампаниях подряд (кампании от новой к старой). */
    function repeatFailures(camps, reqs, today, minRun) {
        minRun = minRun || 2;
        var byCamp = {}; reqs.forEach(function (r) { (byCamp[r.campaign] = byCamp[r.campaign] || {})[r.control] = r; });
        var ordered = camps.slice().sort(function (a, b) { return a.start < b.start ? 1 : -1; });
        var ctrls = {}; reqs.forEach(function (r) { ctrls[r.control] = 1; });
        var out = [];
        Object.keys(ctrls).forEach(function (c) {
            var run = 0;
            for (var i = 0; i < ordered.length; i++) {
                var r = (byCamp[ordered[i].name] || {})[c];
                if (!r) break;
                var st = requestState(r, ordered[i], today);
                if (st === 'fail' || st === 'overdue') run++; else break;
            }
            if (run >= minRun) out.push({ control: c, run: run });
        });
        return out.sort(function (a, b) { return b.run - a.run || (a.control < b.control ? -1 : 1); });
    }

    /* ---------- остаточный риск и тепловая карта ---------- */
    /* Принятое правило демо: каждый ключевой контроль риска, подтверждённый в последней кампании (выполнен, с доказательством),
       снижает вероятность на 1 балл, но не ниже 1 и не больше чем на 2. Не выполненный или без ответа ключевой контроль снижения не даёт. */
    function residual(risk, ctrls, lastReq, today, camp) {
        var key = ctrls.filter(function (c) { return c.risk === risk.code && c.key; });
        var ok = 0, broken = [];
        key.forEach(function (c) {
            var r = lastReq[c.code], st = r ? requestState(r, camp, today) : 'none';
            if ((st === 'done' || st === 'late') && !evidenceMissing(r, c)) ok++;
            else broken.push({ control: c.code, state: st });
        });
        var all = ctrls.filter(function (c) { return c.risk === risk.code; }).length;
        return { p: Math.max(1, risk.p - Math.min(2, ok)), i: risk.i, keyTotal: key.length, keyOk: ok, broken: broken, uncovered: all === 0 };
    }
    /* Сетка P x I: ячейка - балл, зона и список рисков. mode: 'inherent' | 'residual'. */
    function heatmap(risks, zones, pMax, iMax, pos) {
        var grid = [];
        for (var p = pMax; p >= 1; p--) {
            var row = [];
            for (var i = 1; i <= iMax; i++) row.push({ p: p, i: i, score: p * i, zone: zoneOf(p * i, zones), risks: [] });
            grid.push(row);
        }
        risks.forEach(function (r) {
            var q = pos ? pos(r) : r;
            if (!q.p || !q.i) return;
            grid[pMax - q.p][q.i - 1].risks.push(r);
        });
        return grid;
    }

    /* ---------- пробелы матрицы ---------- */
    function matrixGaps(risks, ctrls, emps, zones) {
        var empBy = {}; emps.forEach(function (e) { empBy[e.name] = e; });
        var withCtrl = {}; ctrls.forEach(function (c) { withCtrl[c.risk] = (withCtrl[c.risk] || 0) + 1; });
        var g = [];
        risks.forEach(function (r) {
            var z = zoneOf(r.p * r.i, zones), high = zoneRank(z, zones) >= zones.length - 2;
            if (!withCtrl[r.code]) g.push({ kind: 'noControl', ref: r.code, high: high, text: 'Риск без контроля' + (high ? ' в зоне «' + z.name + '»' : '') });
            else if (high && !ctrls.some(function (c) { return c.risk === r.code && c.key; })) g.push({ kind: 'noKey', ref: r.code, high: true, text: 'Высокий риск без ключевого контроля' });
        });
        ctrls.forEach(function (c) {
            if (!c.owner) g.push({ kind: 'noOwner', ref: c.code, text: 'Контроль без владельца' });
            else if (!empBy[c.owner] || !empBy[c.owner].login) g.push({ kind: 'notPerson', ref: c.code, text: 'Владелец - не сотрудник: «' + c.owner + '»' });
            if (!c.period) g.push({ kind: 'noPeriod', ref: c.code, text: 'Не задана периодичность' });
            if (!c.risk) g.push({ kind: 'noRisk', ref: c.code, text: 'Контроль не привязан к риску' });
        });
        return g;
    }
    /* В кампанию попадают контроли с владельцем-сотрудником и периодичностью, кроме «при событии». */
    function campaignScope(ctrls, emps) {
        var empBy = {}; emps.forEach(function (e) { empBy[e.name] = e; });
        var take = [], skip = [];
        ctrls.forEach(function (c) {
            var e = empBy[c.owner];
            if (!e || !e.login) skip.push({ control: c.code, why: 'нет владельца-сотрудника' });
            else if (!c.period) skip.push({ control: c.code, why: 'нет периодичности' });
            else if (/событи/i.test(c.period)) skip.push({ control: c.code, why: 'выполняется при событии' });
            else take.push({ control: c.code, owner: e.login, ownerName: e.name });
        });
        return { take: take, skip: skip };
    }

    /* ---------- разбор матрицы из Excel (вставка из буфера или CSV) ---------- */
    function parseTable(text) {
        text = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
        var first = text.split('\n')[0] || '';
        var d = first.indexOf('\t') >= 0 ? '\t' : (first.split(';').length >= first.split(',').length ? ';' : ',');
        var rows = [], row = [], cell = '', q = false;
        for (var i = 0; i < text.length; i++) {
            var ch = text[i];
            if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
            if (ch === '"' && cell === '') q = true;
            else if (ch === d) { row.push(cell.trim()); cell = ''; }
            else if (ch === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
            else cell += ch;
        }
        if (cell !== '' || row.length) { row.push(cell.trim()); rows.push(row); }
        return rows.filter(function (r) { return r.some(function (c) { return c !== ''; }); });
    }
    var COLS = [['riskCode', /код риска|№ риска|номер риска/], ['ctrlCode', /код контрол|№ контрол|номер контрол/], ['category', /категор/], ['process', /процесс/],
        ['evidence', /приложить|доказ|подтвержд/], ['key', /ключев/], ['period', /периодич|частот/], ['prob', /вероятн/], ['impact', /влиян|ущерб|последств/],
        ['owner', /владел|ответствен|исполнител/], ['control', /контрол|процедур|мера/], ['risk', /риск/]];
    function mapColumns(header) {
        var m = {};
        header.forEach(function (h, k) {
            var t = String(h).toLowerCase();
            for (var i = 0; i < COLS.length; i++) if (m[COLS[i][0]] === undefined && COLS[i][1].test(t)) { m[COLS[i][0]] = k; break; }
        });
        return m;
    }
    var WORDS = [[/очень высок|почти навер|катастроф/, 5], [/очень низк|маловер|редко|незначит/, 1], [/высок|вероятн|существ/, 4], [/низк|возможн|умерен|малый/, 2], [/средн/, 3]];
    /* Балл по шкале: число, имя уровня шкалы заказчика или слово («высокий»). */
    function scaleValue(v, levels) {
        var s = String(v || '').trim().toLowerCase();
        if (!s) return { v: 0 };
        if (/^\d+([.,]\d+)?$/.test(s)) { var n = Math.round(num(s)); return n >= 1 && n <= (levels.length || 5) ? { v: n } : { v: 0, bad: true }; }
        for (var i = 0; i < levels.length; i++) if (levels[i].name.toLowerCase() === s) return { v: levels[i].score };
        for (var j = 0; j < WORDS.length; j++) if (WORDS[j][0].test(s)) return { v: WORDS[j][1], word: true };
        return { v: 0, bad: true };
    }
    function findEmp(owner, emps) {
        var s = String(owner || '').trim().toLowerCase(); if (!s) return null;
        var sur = s.split(/[\s.]+/)[0];
        for (var i = 0; i < emps.length; i++) if (emps[i].name.toLowerCase() === s) return emps[i];
        var c = emps.filter(function (e) { return e.name.toLowerCase().split(' ')[0] === sur; });
        return c.length === 1 ? c[0] : null;
    }
    function nextCode(prefix, codes) {
        var max = 0; codes.forEach(function (c) { var m = new RegExp('^' + prefix + '(\\d+)$').exec(c); if (m) max = Math.max(max, +m[1]); });
        return function () { max++; return prefix + (max < 10 ? '0' : '') + max; };
    }
    /* План загрузки: риски (склеены по названию), контроли и найденные проблемы со ссылкой на строку файла. */
    function importPlan(rows, ctx) {
        var head = rows[0] || [], m = mapColumns(head), issues = [], risks = [], ctrls = [], rBy = {};
        var exist = {}; (ctx.risks || []).forEach(function (r) { exist[r.name.toLowerCase()] = r; });
        var rCode = nextCode('Р-', (ctx.risks || []).map(function (r) { return r.code; })), cCode = nextCode('К-', (ctx.ctrls || []).map(function (c) { return c.code; }));
        if (m.risk === undefined || m.control === undefined) return { map: m, risks: [], ctrls: [], issues: [{ row: 1, kind: 'head', text: 'Не нашли колонки «Риск» и «Контроль» в первой строке' }] };
        var prev = null;
        for (var k = 1; k < rows.length; k++) {
            var row = rows[k], get = function (f) { return m[f] === undefined ? '' : String(row[m[f]] || '').trim(); }, n = k + 1;
            var rname = get('risk');
            if (!rname && prev) { rname = prev; issues.push({ row: n, kind: 'merged', text: 'Пустая ячейка риска - взят риск из строки выше (объединённые ячейки)' }); }
            if (!rname) { issues.push({ row: n, kind: 'noRisk', text: 'Строка без риска пропущена' }); continue; }
            prev = rname;
            var key = rname.toLowerCase(), r = rBy[key];
            if (!r) {
                var p = scaleValue(get('prob'), ctx.probs || []), im = scaleValue(get('impact'), ctx.impacts || []);
                if (p.word || im.word) issues.push({ row: n, kind: 'words', text: 'Шкала словами («' + (p.word ? get('prob') : get('impact')) + '») переведена в балл' });
                if (p.bad || im.bad || !p.v || !im.v) issues.push({ row: n, kind: 'scale', text: 'Нет оценки вероятности или влияния по шкале' });
                r = rBy[key] = { code: exist[key] ? exist[key].code : (get('riskCode') || rCode()), name: rname, process: get('process'), category: get('category'), p: p.v, i: im.v, rows: [n], exists: !!exist[key] };
                risks.push(r);
            } else { r.rows.push(n); if (r.rows.length === 2) issues.push({ row: n, kind: 'dupRisk', text: 'Риск «' + rname + '» встречается в нескольких строках - объединён' }); }
            var cname = get('control');
            if (!cname) { issues.push({ row: n, kind: 'noControl', text: 'Риск без контроля' }); continue; }
            var owner = get('owner'), e = findEmp(owner, ctx.emps || []);
            if (!owner) issues.push({ row: n, kind: 'noOwner', text: 'Контроль без владельца' });
            else if (!e) issues.push({ row: n, kind: 'notPerson', text: 'Владелец «' + owner + '» не найден среди сотрудников - назначьте человека' });
            var per = get('period'), pm = (ctx.periods || []).filter(function (x) { return per && x.toLowerCase().indexOf(per.toLowerCase().slice(0, 6)) === 0; })[0] || '';
            if (!per) issues.push({ row: n, kind: 'noPeriod', text: 'Не задана периодичность' });
            else if (!pm) issues.push({ row: n, kind: 'period', text: 'Периодичность «' + per + '» не из справочника' });
            ctrls.push({ code: get('ctrlCode') || cCode(), name: cname, risk: r.code, owner: e ? e.name : '', ownerRaw: owner, period: pm, key: /^(да|1|y|yes|ключ|\+)/i.test(get('key')), evidence: get('evidence'), row: n });
        }
        return { map: m, risks: risks, ctrls: ctrls, issues: issues };
    }

    /* ---------- неизменяемый журнал: цепочка отпечатков ---------- */
    /* Отпечаток записи = хэш (отпечаток предыдущей записи + содержимое). Правка любой записи задним числом рвёт цепочку на ней. */
    function fnv(str, h) {
        for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        return ('0000000' + (h >>> 0).toString(16)).slice(-8);
    }
    function fingerprint(s) { return fnv(s, 2166136261) + fnv(s.split('').reverse().join(''), 3735928559); }
    function journalText(e) { return [e.code, e.request, e.owner, e.action, e.author, e.date, e.time, e.content || ''].join('|'); }
    function byCode(a, b) { return a.code < b.code ? -1 : a.code > b.code ? 1 : 0; }
    function signNext(prevFp, e) { return fingerprint((prevFp || '') + '#' + journalText(e)); }
    /* Цепочка ведётся по владельцу контроля: владелец видит (маской) только свои записи и дописывает свою цепочку сам. */
    function signChain(entries) {
        var prev = {};
        return entries.slice().sort(byCode).map(function (e) { var k = e.owner || ''; prev[k] = signNext(prev[k], e); return Object.assign({}, e, { fp: prev[k] }); });
    }
    /* Сверка: каждая запись проверяется по сохранённому отпечатку предыдущей записи той же цепочки; ломаются только правленые записи. */
    function verifyChain(entries) {
        var list = entries.slice().sort(byCode), prev = {}, bad = [];
        list.forEach(function (e) { var k = e.owner || ''; if (signNext(prev[k], e) !== e.fp) bad.push(e.code); prev[k] = e.fp; });
        return { total: list.length, bad: bad, ok: bad.length === 0, chains: Object.keys(prev).length, last: prev };
    }
    /* Код новой записи: позже любой прежней при сортировке по коду (Ж-DГГММДДЧЧММССnnn; буква D старше цифр загруженного журнала, nnn - порядковый номер на странице). */
    function journalCode(date, time, salt) { return 'Ж-D' + date.slice(2).replace(/-/g, '') + String(time || '').replace(/:/g, '') + ('00' + (salt % 1000)).slice(-3); }
    function appendEntry(entries, e) { var v = verifyChain(entries.filter(function (x) { return x.owner === e.owner; })); return Object.assign({}, e, { fp: signNext(v.last[e.owner || ''], e) }); }

    /* ---------- ссылки, отчёты, выгрузки ---------- */
    function messengerLink(url, text) { return 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text); }
    function reminderText(ownerName, count, due, campName) {
        return ownerName + ', ' + (campName ? 'кампания «' + campName + '»: ' : '') + 'подтвердите, пожалуйста, ' + count + ' ' + plural(count, 'контроль', 'контроля', 'контролей') +
            ' до ' + toDmy(due) + '. Одна кнопка: выполнил / не выполнил, причина и файл.';
    }
    function plural(n, a, b, c) { var m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; }
    /* Строки для аудитора: контроль - период - исполнитель - результат - файл - время, за кампании, пересекающие период. */
    function auditRows(reqs, ctrlBy, camps, from, to) {
        var cBy = {}; camps.forEach(function (c) { cBy[c.name] = c; });
        return reqs.filter(function (r) { var c = cBy[r.campaign]; return c && c.start <= to && c.end >= from; }).map(function (r) {
            var c = cBy[r.campaign], k = ctrlBy[r.control] || {};
            return { control: r.control, name: k.name || '', risk: k.risk || '', period: toDmy(c.start) + ' - ' + toDmy(c.end), owner: r.ownerName || r.owner, result: r.result || 'Нет ответа',
                reason: r.reason || '', file: r.fileName || '', when: r.answered ? toDmy(r.answered) + ' ' + (r.time || '') : '', fp: r.fp || '', fileUrl: r.file || '', jcode: r.jcode || '' };
        }).sort(function (a, b) { return a.period < b.period ? -1 : a.period > b.period ? 1 : a.control < b.control ? -1 : 1; });
    }
    function toCsv(cols, rows) {
        var q = function (v) { v = String(v === undefined || v === null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        return [cols.map(function (c) { return q(c[1]); }).join(';')].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c[0]]); }).join(';'); })).join('\r\n');
    }

    return {
        DONE: DONE, FAIL: FAIL, num: num, utc: utc, iso: iso, addDays: addDays, diffDays: diffDays, toIso: toIso, toDmy: toDmy, plural: plural,
        zoneOf: zoneOf, zoneRank: zoneRank, requestState: requestState, evidenceMissing: evidenceMissing, campaignStats: campaignStats, byOwner: byOwner, repeatFailures: repeatFailures,
        residual: residual, heatmap: heatmap, matrixGaps: matrixGaps, campaignScope: campaignScope,
        parseTable: parseTable, mapColumns: mapColumns, scaleValue: scaleValue, findEmp: findEmp, nextCode: nextCode, importPlan: importPlan,
        fingerprint: fingerprint, journalText: journalText, signNext: signNext, signChain: signChain, verifyChain: verifyChain, journalCode: journalCode, appendEntry: appendEntry,
        messengerLink: messengerLink, reminderText: reminderText, auditRows: auditRows, toCsv: toCsv
    };
});
