/* КЭДО: чистые функции (рабочие дни, просрочка, светофор, очередь кадровика, сверка «оператор ↔ ЗУП», повтор передачи). Без DOM и сети: работает и в браузере, и в Node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.KedoCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    var DAY = 86400000;
    var DEFAULT_RULES = { overdueDays: 3, escalateDays: 5, dateTolerance: 2 };
    var SIGNED = 'Подписан', REFUSED = 'Отказ', PREPARED = 'Подготовлен', SENT = 'Отправлен', OPENED = 'Открыт', OVERDUE = 'Просрочен';
    var ZUP_OK = 'Принят', ZUP_ERR = 'Ошибка передачи', ZUP_NONE = 'Не передан';

    function utc(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
    function iso(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
    function addDays(s, n) { return iso(utc(s) + n * DAY); }
    function diffDays(a, b) { return Math.round((utc(b) - utc(a)) / DAY); }
    /* 'ДД.ММ.ГГГГ', 'ДД.ММ.ГГ', 'ГГГГ-ММ-ДД[ ЧЧ:ММ:СС]' -> 'ГГГГ-ММ-ДД'; пусто или мусор -> '' */
    function toIso(v) {
        if (!v) return '';
        v = String(v).trim();
        var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d)/.exec(v);
        if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
        m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
        return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
    }
    function toDmy(s) { return s ? s.split('-').reverse().join('.') : ''; }
    function num(v) { var n = parseFloat(String(v === undefined || v === null ? '' : v).replace(',', '.')); return isNaN(n) ? 0 : n; }
    /* день недели: 1 = понедельник ... 7 = воскресенье */
    function dow(s) { var d = new Date(utc(s)).getUTCDay(); return d === 0 ? 7 : d; }
    function isWorkday(s, hol) { return dow(s) < 6 && !(hol && hol[s]); }
    /* Рабочих дней после from по to включительно: отправлен в пятницу, сегодня четверг = 4. */
    function workdaysBetween(from, to, hol) {
        if (!from || !to || to <= from) return 0;
        var n = 0, d = addDays(from, 1);
        while (d <= to) { if (isWorkday(d, hol)) n++; d = addDays(d, 1); }
        return n;
    }
    function addWorkdays(from, n, hol) { var d = from; while (n > 0) { d = addDays(d, 1); if (isWorkday(d, hol)) n--; } return d; }

    function rulesFrom(rows) {
        var r = Object.assign({}, DEFAULT_RULES), by = {};
        (rows || []).forEach(function (x) { by[x.name] = num(x.value); });
        if (by['Порог просрочки, раб. дней']) r.overdueDays = by['Порог просрочки, раб. дней'];
        if (by['Эскалация руководителю после, раб. дней']) r.escalateDays = by['Эскалация руководителю после, раб. дней'];
        if (by['Допуск сверки по дате, дней'] !== undefined) r.dateTolerance = by['Допуск сверки по дате, дней'];
        return r;
    }

    /* Состояние документа на дату: эффективный статус (с «просрочен»), сколько висит, доехал ли до ЗУП.
       doc: {status, sent, signed, zup, error, limit} — limit = срок подписания типа документа, иначе правило. */
    function docState(doc, today, hol, rules) {
        rules = rules || DEFAULT_RULES;
        var waiting = (doc.status === SENT || doc.status === OPENED) && !!doc.sent;
        var wd = waiting ? workdaysBetween(doc.sent, today, hol) : 0;
        var limit = num(doc.limit) || rules.overdueDays;
        var overdue = waiting && wd > limit;
        var signed = doc.status === SIGNED;
        return {
            status: overdue ? OVERDUE : (doc.status || PREPARED), waiting: waiting, wd: wd, limit: limit, overdue: overdue,
            escalate: overdue && wd > rules.escalateDays, signed: signed, refused: doc.status === REFUSED,
            inZup: signed && doc.zup === ZUP_OK, notInZup: signed && doc.zup !== ZUP_OK, zupError: signed && doc.zup === ZUP_ERR,
            signDays: signed && doc.sent && doc.signed ? workdaysBetween(doc.sent, doc.signed, hol) : null
        };
    }
    /* Светофор реестра. */
    function lights(docs, today, hol, rules) {
        var L = { total: 0, signedNotZup: 0, zupErrors: 0, overdue: 0, escalate: 0, refused: 0, waiting: 0, prepared: 0, done: 0, signDaysAvg: 0 }, sd = [];
        (docs || []).forEach(function (d) {
            var s = docState(d, today, hol, rules); L.total++;
            if (s.notInZup) L.signedNotZup++;
            if (s.zupError) L.zupErrors++;
            if (s.overdue) L.overdue++;
            if (s.escalate) L.escalate++;
            if (s.refused) L.refused++;
            if (s.waiting) L.waiting++;
            if ((d.status || PREPARED) === PREPARED) L.prepared++;
            if (s.inZup) L.done++;
            if (s.signDays !== null) sd.push(s.signDays);
        });
        L.signDaysAvg = sd.length ? Math.round(sd.reduce(function (a, b) { return a + b; }, 0) / sd.length * 10) / 10 : 0;
        L.donePct = L.total ? Math.round(L.done / L.total * 100) : 0;
        return L;
    }
    /* Очередь кадровика «мне сегодня»: что требует действия и какое действие. Приоритет 1 — первым. */
    function queue(docs, today, hol, rules) {
        var out = [];
        (docs || []).forEach(function (d) {
            var s = docState(d, today, hol, rules);
            if (s.zupError) out.push({ doc: d, kind: 'zup', pri: 1, wd: workdaysBetween(d.signed || today, today, hol), title: 'Ошибка передачи в ЗУП', note: d.error || '', action: 'Передать повторно' });
            else if (s.notInZup) out.push({ doc: d, kind: 'zup', pri: 2, wd: workdaysBetween(d.signed || today, today, hol), title: 'Подписан, но не в ЗУП', note: 'подписан ' + toDmy(d.signed), action: 'Передать повторно' });
            if (s.refused) out.push({ doc: d, kind: 'refused', pri: 1, wd: 0, title: 'Отказ от подписания', note: d.reason || 'причина не указана', action: 'Выяснить причину' });
            if (s.overdue) out.push({ doc: d, kind: s.escalate ? 'escalate' : 'overdue', pri: s.escalate ? 1 : 2, wd: s.wd, title: s.escalate ? 'Просрочен, пора эскалировать' : 'Просрочен', note: 'висит ' + s.wd + ' раб. дн. при сроке ' + s.limit, action: s.escalate ? 'Эскалировать руководителю' : 'Напомнить' });
            else if (s.waiting && s.wd === s.limit) out.push({ doc: d, kind: 'soon', pri: 3, wd: s.wd, title: 'Срок подписания истекает сегодня', note: 'висит ' + s.wd + ' раб. дн.', action: 'Напомнить' });
        });
        return out.sort(function (a, b) { return a.pri - b.pri || b.wd - a.wd || String(a.doc.number).localeCompare(String(b.doc.number)); });
    }
    /* Повтор передачи в ЗУП: ошибки ключа (сотрудник не найден) повтор не лечит. */
    function retryOutcome(doc) {
        if (!doc || doc.status !== SIGNED) return { ok: false, error: 'Документ ещё не подписан: передавать в ЗУП нечего' };
        if (doc.zup === ZUP_OK) return { ok: false, error: 'Документ уже в ЗУП' };
        if (/не найден/i.test(doc.error || '')) return { ok: false, error: doc.error, hint: 'Повтор не поможет: сначала исправьте табельный номер или карточку сотрудника в ЗУП' };
        return { ok: true };
    }
    function normKey(s) { return String(s || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' '); }
    /* Статус оператора -> единый статус по справочнику соответствий; неизвестный -> null. */
    function normStatus(raw, map) { var k = normKey(raw), m = {}; Object.keys(map || {}).forEach(function (x) { m[normKey(x)] = map[x]; }); return m[k] || null; }
    function sameKind(doc, kind) { var k = normKey(kind); return !!k && (normKey(doc.zupKind) === k || normKey(doc.type) === k); }
    /* Сверка выгрузки оператора с реестром учёта.
       docs: [{number, tab, type, zupKind, date, sent, status, opId, zup}], rows: [{opId, tab, fio, kind, date, opStatus, signed}],
       map: {статус оператора: единый статус}, emps: {табельный: ФИО}. */
    function reconcile(docs, rows, map, emps, tol) {
        tol = tol === undefined ? DEFAULT_RULES.dateTolerance : tol;
        var G = { ok: [], signedNotInZup: [], statusStale: [], missingAtOperator: [], notInRegistry: [], unknownEmp: [], unknownStatus: [] }, used = {}, byId = {}, byComposite = 0;
        (docs || []).forEach(function (d) { if (d.opId) byId[d.opId] = d; });
        (rows || []).forEach(function (r) {
            var st = normStatus(r.opStatus, map);
            if (!st) { G.unknownStatus.push({ row: r }); return; }
            var d = r.opId && byId[r.opId] && !used[r.opId] ? byId[r.opId] : null;
            if (!d) {
                if (!emps || !emps[String(r.tab || '').trim()]) { G.unknownEmp.push({ row: r, status: st }); return; }
                var di = toIso(r.date);
                d = (docs || []).filter(function (x) { return !used[x.opId || x.number] && String(x.tab) === String(r.tab).trim() && sameKind(x, r.kind) && di && x.date && Math.abs(diffDays(x.date, di)) <= tol; })[0] || null;
                if (d) byComposite++;
            }
            if (!d) { G.notInRegistry.push({ row: r, status: st }); return; }
            used[d.opId || d.number] = 1;
            var item = { doc: d, row: r, status: st };
            if (st === SIGNED && d.status !== SIGNED) G.statusStale.push(item);
            else if (st === SIGNED && d.zup !== ZUP_OK) G.signedNotInZup.push(item);
            else if (st !== SIGNED && st !== d.status && !(st === SENT && d.status === OPENED)) G.statusStale.push(item);
            else G.ok.push(item);
        });
        (docs || []).forEach(function (d) { if (d.status && d.status !== PREPARED && !used[d.opId || d.number]) G.missingAtOperator.push({ doc: d }); });
        var problems = 0; Object.keys(G).forEach(function (k) { if (k !== 'ok') problems += G[k].length; });
        return { groups: G, byComposite: byComposite, rows: (rows || []).length, problems: problems };
    }
    /* CSV выгрузки: разделитель ; , или таб, кавычки, BOM. -> [{заголовок: значение}] */
    function parseCsv(text) {
        text = String(text || '').replace(/^﻿/, '');
        var first = text.split(/\r?\n/)[0] || '', sep = [';', '\t', ','].sort(function (a, b) { return first.split(b).length - first.split(a).length; })[0];
        var rows = [], row = [], cell = '', q = false;
        for (var i = 0; i < text.length; i++) {
            var c = text[i];
            if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
            if (c === '"') q = true;
            else if (c === sep) { row.push(cell); cell = ''; }
            else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
            else cell += c;
        }
        if (cell || row.length) { row.push(cell); rows.push(row); }
        rows = rows.filter(function (r) { return r.some(function (x) { return String(x).trim(); }); });
        if (!rows.length) return [];
        var head = rows[0].map(function (h) { return String(h).trim(); });
        return rows.slice(1).map(function (r) { var o = {}; head.forEach(function (h, j) { o[h] = String(r[j] === undefined ? '' : r[j]).trim(); }); return o; });
    }
    var HEADS = { tab: ['таб. №', 'таб.№', 'табельный номер', 'табельный'], fio: ['фио', 'сотрудник', 'работник'], kind: ['вид документа', 'тип документа', 'документ'],
        opId: ['id', 'id документа', 'номер', 'номер документа'], date: ['дата документа', 'дата'], opStatus: ['статус', 'статус документа', 'статус подписания'], signed: ['дата подписания', 'подписан'] };
    /* Строки CSV оператора -> строки сверки; missing — какие обязательные колонки не нашлись. */
    function mapExport(objs) {
        var keys = objs && objs[0] ? Object.keys(objs[0]) : [], col = {};
        Object.keys(HEADS).forEach(function (f) { keys.forEach(function (k) { if (!col[f] && HEADS[f].indexOf(normKey(k)) >= 0) col[f] = k; }); });
        var missing = ['tab', 'kind', 'opStatus'].filter(function (f) { return !col[f]; });
        var rows = (objs || []).map(function (o) { var r = {}; Object.keys(HEADS).forEach(function (f) { r[f] = col[f] ? o[col[f]] : ''; }); r.date = toIso(r.date); r.signed = toIso(r.signed); return r; });
        return { rows: rows, columns: col, missing: missing };
    }
    function roleKey(role) {
        var r = normKey(role);
        if (/руководитель hr|директор по персоналу|hrd/.test(r)) return 'hrd';
        if (/кадр|hr/.test(r)) return 'hr';
        if (/руководитель подраздел/.test(r)) return 'manager';
        if (/сотрудник/.test(r)) return 'employee';
        return r === 'admin' ? 'admin' : 'other';
    }
    function routeSteps(steps) { return (steps || []).slice().sort(function (a, b) { return num(a.order) - num(b.order); }); }
    /* Что сотрудник видит про свой документ: одна фраза без кадрового жаргона. */
    function employeeHint(doc, today, hol, rules) {
        var s = docState(doc, today, hol, rules);
        if (s.refused) return 'Вы отказались подписать. Кадровик свяжется с вами.';
        if (s.inZup) return 'Подписан и принят в учёте. Ничего делать не нужно.';
        if (s.signed) return 'Подписан. Кадровая служба переносит документ в учёт.';
        if (s.waiting) return s.overdue ? 'Нужно подписать: срок прошёл ' + (s.wd - s.limit) + ' раб. дн. назад.' : 'Нужно подписать до ' + toDmy(addWorkdays(doc.sent, s.limit, hol)) + '.';
        return 'Документ готовится, подписывать пока нечего.';
    }
    function toCsv(rows, cols) {
        function q(v) { v = String(v === undefined || v === null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
        return [cols.map(function (c) { return q(c[1]); }).join(';')].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c[0]]); }).join(';'); })).join('\n');
    }
    return {
        DEFAULT_RULES: DEFAULT_RULES, SIGNED: SIGNED, REFUSED: REFUSED, PREPARED: PREPARED, SENT: SENT, OPENED: OPENED, OVERDUE: OVERDUE, ZUP_OK: ZUP_OK, ZUP_ERR: ZUP_ERR, ZUP_NONE: ZUP_NONE,
        utc: utc, iso: iso, addDays: addDays, diffDays: diffDays, toIso: toIso, toDmy: toDmy, num: num, dow: dow, isWorkday: isWorkday, workdaysBetween: workdaysBetween, addWorkdays: addWorkdays,
        rulesFrom: rulesFrom, docState: docState, lights: lights, queue: queue, retryOutcome: retryOutcome, normKey: normKey, normStatus: normStatus, reconcile: reconcile,
        parseCsv: parseCsv, mapExport: mapExport, roleKey: roleKey, routeSteps: routeSteps, employeeHint: employeeHint, toCsv: toCsv
    };
});
