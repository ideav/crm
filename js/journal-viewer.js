// Просмотр журнала базы в рабочем месте dir_admin (issue #5000).
//
// Вкладка «Журнал» читает GET /{db}/journal?JSON (журнал запросов mode=log и журнал изменений данных
// mode=sql): страницами по 100 строк от самых новых, дальше вглубь истории по курсору «файл:смещение»
// из ответа сервера, назад — по стеку пройденных курсоров. Фильтры — условия «поле / как сравнивать /
// значение» по любому полю или по всем сразу (*), сервер применяет их до разбивки на страницы
// (параметр where). Текущую страницу можно выгрузить в JSON или CSV.
// Журнал видит только администратор базы — отказ сервера показывается текстом.
(function (root) {
    'use strict';

    var PAGE = 100;
    var OPS = [
        ['contains', 'содержит'], ['starts', 'начинается с'], ['ends', 'заканчивается на'],
        ['eq', 'равно'], ['ne', 'не равно'], ['notcontains', 'не содержит']
    ];
    // Порядок колонок; остальные поля страницы идут следом по алфавиту
    var PREFERRED = {
        log: ['ts', 'user', 'role', 'ip', 'm', 'path', 'st', 'ms', 'sqls', 'sql_ms', 'rid', 'ai_job', 'params', 'msg'],
        sql: ['ts', 'user', 'op', 't', 'id', 'up', 'old', 'new', 'sql', 'n', 'err', 'ms', 'rid']
    };
    var CELL_CHARS = 140;

    // Значение поля как текст для ячейки и выгрузки. Строки отбирает только сервер (logJournalCond
    // в index.php): текст JSON у PHP и JS расходится (пустой объект: «[]» / «{}»), второй отбор на клиенте
    // выкидывал бы строки, которые сервер признал подходящими.
    function valueText(v) {
        if (v === undefined || v === null) return '';
        if (typeof v === 'string') return v;
        return JSON.stringify(v);
    }

    // Условия формы без пустых значений («равно пустому» задаётся явно — op eq и пустое v не отбрасываем)
    function cleanConds(conds) {
        return conds.filter(function (c) { return c && c.f && (c.v !== '' || c.op === 'eq' || c.op === 'ne'); });
    }

    function buildQuery(db, mode, cursor, conds) {
        var q = 'JSON&mode=' + encodeURIComponent(mode) + '&limit=' + PAGE;
        if (cursor) q += '&cursor=' + encodeURIComponent(cursor);
        conds = cleanConds(conds || []);
        if (conds.length) q += '&where=' + encodeURIComponent(JSON.stringify(conds));
        return '/' + encodeURIComponent(db) + '/journal?' + q;
    }

    function columnsFor(mode, rows) {
        var seen = {};
        rows.forEach(function (r) { Object.keys(r).forEach(function (k) { seen[k] = true; }); });
        var cols = (PREFERRED[mode] || []).filter(function (k) { return seen[k]; });
        Object.keys(seen).sort().forEach(function (k) { if (cols.indexOf(k) === -1) cols.push(k); });
        return cols;
    }

    function cellText(v) {
        var s = valueText(v);
        return s.length > CELL_CHARS ? s.slice(0, CELL_CHARS) + '…' : s;
    }

    // Строка, начинающаяся с = + - @ (или \t, \r), в Excel станет формулой: в журнале лежат
    // значения, которые вводили пользователи, поэтому такой текст уходит с апострофом впереди.
    // Числа формулой не бывают — отрицательное число остаётся числом.
    function csvCell(v) {
        var s = valueText(v);
        if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return /[",;\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    // Разделитель «;»: файл с BOM открывают двойным щелчком в Excel, а русский Excel делит столбцы по «;»
    var CSV_SEP = ';';

    function toCsv(rows, cols) {
        var out = [cols.map(csvCell).join(CSV_SEP)];
        rows.forEach(function (r) { out.push(cols.map(function (c) { return csvCell(r[c]); }).join(CSV_SEP)); });
        return out.join('\r\n');
    }

    function fieldChoices(mode, rows) {
        var cols = columnsFor(mode, rows);
        (PREFERRED[mode] || []).forEach(function (k) { if (cols.indexOf(k) === -1) cols.push(k); });
        return cols;
    }

    function errorText(status, body) {
        var res = null;
        try { res = JSON.parse(body); } catch (e) { res = null; }
        if (res && res.error) return res.error;
        if (status === 403) return 'Журнал доступен только администратору базы';
        return 'Ошибка ' + status + (body ? ': ' + String(body).slice(0, 200) : '');
    }

    // ---- DOM ---------------------------------------------------------------------------------

    function el(tag, cls, text) {
        var node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function option(sel, value, label) {
        var o = el('option', '', label);
        o.value = value;
        sel.appendChild(o);
    }

    function download(name, type, text) {
        var blob = new Blob([text], { type: type });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }

    function init(opts) {
        var host = document.getElementById(opts.container || 'journal-viewer');
        if (!host) return;
        var db = opts.db;
        var state = { mode: 'log', conds: [], stack: [], cursor: '', rows: [], next: null, more: false, busy: false };

        var bar = el('div', 'jv-bar');
        var modeSel = el('select', 'da-input');
        option(modeSel, 'log', 'Запросы');
        option(modeSel, 'sql', 'Изменения данных');
        var condBox = el('div', 'jv-conds');
        var addBtn = el('button', 'btn btn-default btn-xs', '+ условие');
        addBtn.type = 'button';
        var applyBtn = el('button', 'btn btn-default', 'Найти');
        applyBtn.type = 'button';
        var resetBtn = el('button', 'btn btn-default', 'Сбросить');
        resetBtn.type = 'button';
        bar.appendChild(modeSel);
        bar.appendChild(condBox);
        bar.appendChild(addBtn);
        bar.appendChild(applyBtn);
        bar.appendChild(resetBtn);

        var nav = el('div', 'jv-nav');
        var newer = el('button', 'btn btn-default', '← Новее');
        newer.type = 'button';
        var older = el('button', 'btn btn-default', 'Старее →');
        older.type = 'button';
        var info = el('span', 'jv-info');
        var expJson = el('button', 'btn btn-default', 'JSON');
        expJson.type = 'button';
        expJson.title = 'Выгрузить текущую страницу в JSON';
        var expCsv = el('button', 'btn btn-default', 'CSV');
        expCsv.type = 'button';
        expCsv.title = 'Выгрузить текущую страницу в CSV';
        [newer, older, info, expJson, expCsv].forEach(function (n) { nav.appendChild(n); });

        var status = el('div', 'jv-status');
        var wrap = el('div', 'jv-table-wrap');
        host.appendChild(bar);
        host.appendChild(nav);
        host.appendChild(status);
        host.appendChild(wrap);

        function addCond(c) {
            var row = el('div', 'jv-cond');
            var f = el('select', 'da-input');
            var op = el('select', 'da-input');
            var v = el('input', 'da-input');
            var rm = el('button', 'btn btn-default btn-xs', '×');
            rm.type = 'button';
            rm.title = 'Убрать условие';
            fieldChoices(state.mode, state.rows).forEach(function (k) { option(f, k, k); });
            option(f, '*', 'любое поле');
            OPS.forEach(function (o) { option(op, o[0], o[1]); });
            v.type = 'text';
            v.placeholder = 'значение';
            f.value = c && c.f ? c.f : '*';
            if (f.value !== (c && c.f ? c.f : '*')) { option(f, c.f, c.f); f.value = c.f; }
            if (c && c.op) op.value = c.op;
            if (c && c.v !== undefined) v.value = c.v;
            v.addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });
            rm.addEventListener('click', function () { condBox.removeChild(row); });
            [f, op, v, rm].forEach(function (n) { row.appendChild(n); });
            condBox.appendChild(row);
            row.getConds = function () { return { f: f.value, op: op.value, v: v.value }; };
            return row;
        }

        function formConds() {
            return Array.prototype.map.call(condBox.children, function (r) { return r.getConds(); });
        }

        function setStatus(text, isError) {
            status.textContent = text || '';
            status.className = 'jv-status' + (isError ? ' jv-error' : '');
        }

        function render() {
            wrap.textContent = '';
            var rows = state.rows;
            var cols = columnsFor(state.mode, rows);
            if (!rows.length) {
                setStatus(state.busy ? 'Читаем журнал…' : (status.className.indexOf('jv-error') === -1 ? 'Записей нет' : status.textContent),
                          status.className.indexOf('jv-error') !== -1);
            }
            var table = el('table', 'table table-striped table-condensed table-bordered jv-table');
            var head = el('tr');
            cols.forEach(function (c) { head.appendChild(el('th', '', c)); });
            table.appendChild(head);
            rows.forEach(function (r) {
                var tr = el('tr', 'jv-row');
                cols.forEach(function (c) {
                    var td = el('td', '', cellText(r[c]));
                    var full = valueText(r[c]);
                    if (full.length > CELL_CHARS) td.title = full.slice(0, 500);
                    tr.appendChild(td);
                });
                tr.addEventListener('click', function () {
                    var open = tr.nextSibling && tr.nextSibling.className === 'jv-detail';
                    if (open) { table.removeChild(tr.nextSibling); return; }
                    var d = el('tr', 'jv-detail');
                    var td = el('td');
                    td.colSpan = cols.length || 1;
                    td.appendChild(el('pre', '', JSON.stringify(r, null, 2)));
                    d.appendChild(td);
                    table.insertBefore(d, tr.nextSibling);
                });
                table.appendChild(tr);
            });
            wrap.appendChild(table);
            newer.disabled = state.busy || !state.stack.length;
            older.disabled = state.busy || !state.more;
            expJson.disabled = expCsv.disabled = !rows.length;
            info.textContent = rows.length
                ? 'Строк: ' + rows.length + (state.cursor ? ' · с ' + state.cursor : ' · с конца журнала')
                  + (state.more ? ' · есть более старые' : ' · это начало журнала')
                : '';
        }

        // Номер последнего запроса: ответ более раннего (смена режима, «Найти», «Сбросить» во время
        // чтения) приходит позже и молча отбрасывается — иначе на экране оказались бы строки и курсор
        // другого режима или старых условий. onOk — сдвиг стека курсоров, только при успехе: при
        // ошибке стек и показанная страница (state.cursor) остаются как были.
        var seq = 0;

        function load(cursor, onOk) {
            var my = ++seq;
            state.busy = true;
            setStatus('Читаем журнал…');
            render();
            return fetch(buildQuery(db, state.mode, cursor, state.conds), { credentials: 'same-origin' })
                .then(function (r) { return r.text().then(function (body) { return { status: r.status, body: body }; }); })
                .then(function (res) {
                    if (my !== seq) return;
                    state.busy = false;
                    if (res.status !== 200) {
                        state.rows = []; state.more = false;
                        setStatus(errorText(res.status, res.body), true);
                        return render();
                    }
                    var page = JSON.parse(res.body);
                    // Строки уже отобраны сервером по where — источник истины он
                    state.rows = page.rows || [];
                    state.more = !!page.more;
                    state.next = page.next;
                    state.cursor = cursor;
                    if (onOk) onOk();
                    setStatus('');
                    render();
                    if (!state.rows.length && state.more) setStatus('На этой странице совпадений нет — нажмите «Старее →»');
                })
                .catch(function (e) {
                    if (my !== seq) return;
                    state.busy = false;
                    state.rows = [];
                    state.more = false;
                    setStatus('Не удалось прочитать журнал: ' + (e && e.message ? e.message : e), true);
                    render();
                });
        }

        function search() {
            state.conds = formConds();
            state.stack = [];
            state.cursor = '';
            load('');
        }

        newer.addEventListener('click', function () {
            if (!state.stack.length) return;
            load(state.stack[state.stack.length - 1], function () { state.stack.pop(); });
        });
        older.addEventListener('click', function () {
            if (!state.more || !state.next) return;
            var shown = state.cursor;
            load(state.next, function () { state.stack.push(shown); });
        });
        applyBtn.addEventListener('click', search);
        resetBtn.addEventListener('click', function () { condBox.textContent = ''; search(); });
        addBtn.addEventListener('click', function () { addCond(); });
        modeSel.addEventListener('change', function () {
            state.mode = modeSel.value;
            condBox.textContent = '';
            state.rows = [];
            search();
        });
        expJson.addEventListener('click', function () {
            download('journal-' + state.mode + '.json', 'application/json', JSON.stringify(state.rows, null, 2));
        });
        expCsv.addEventListener('click', function () {
            // BOM — чтобы Excel открыл кириллицу в UTF-8
            download('journal-' + state.mode + '.csv', 'text/csv;charset=utf-8',
                '﻿' + toCsv(state.rows, columnsFor(state.mode, state.rows)));
        });

        var loaded = false;
        host.start = function () { if (!loaded) { loaded = true; search(); } };
        render();
    }

    var api = { init: init, PAGE: PAGE, cleanConds: cleanConds,
                buildQuery: buildQuery, columnsFor: columnsFor, cellText: cellText, toCsv: toCsv,
                valueText: valueText, errorText: errorText };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.JournalViewer = api;
})(this);
