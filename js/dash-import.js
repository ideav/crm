// Конвертор Excel → модель дэшборда (issue #4704).
//
// Рабочее место `dash-import`: файл xlsx → распознанная структура → ПРЕДПРОСМОТР → запись в БД.
// Предпросмотр обязателен: структура модели угадывается по форме таблицы, и ошибку распознавания
// оператор должен увидеть ДО того, как в базе появятся записи.
//
// Модель собирается по контракту `docs/kb/dashboard.md`:
//   Дэшборд → Лист → Панель → Строка (+ RG у панели), иерархия — подчинёнными записями (`up`).
//
// Ядро модуля ЧИСТОЕ (никакого DOM и сети) и покрыто тестом на реальном образце из тикета:
//   recognizeModel(grids)     — форма книги → структура модели + журнал непереносимого
//   periodValues(years, +N)   — значения словаря периода: годы файла + запас
//   buildCreateOps(model, …)  — структура → список операций записи (создать/переиспользовать)
//   журнал непереносимого — общий инструмент `js/import-journal.js` (формат, виды, текст issue)
//
(function () {
    'use strict';

    // ЖУРНАЛ — общий инструмент (`js/import-journal.js`), а не частная выдумка этого конвертора:
    // формат записи, виды и сборка issue едины для всех импортёров.
    var Journal = (typeof require === 'function') ? require('./import-journal.js')
                : (typeof window !== 'undefined' ? window.ImportJournal : null);

    // ── Разбор формы книги ──────────────────────────────────────────────────────────────────

    // Ячейка сетки: { v: значение, f: формула|null }. Пустая ячейка — null.
    function cellVal(cell) { return cell && cell.v != null ? cell.v : null; }
    function cellText(cell) {
        var v = cellVal(cell);
        return (typeof v === 'string') ? v.trim() : '';
    }
    function cellNum(cell) {
        var v = cellVal(cell);
        if (typeof v === 'number') return v;
        if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v);
        return null;
    }
    function isYearNum(n) { return n != null && n === Math.round(n) && n >= 1990 && n <= 2100; }

    // ШАПКА ПЕРИОДОВ. Строка, где подряд (с пропусками) стоят ≥ 3 возрастающих года — это ось
    // периодов, и она открывает новую панель. Так секции «P&L» / «Cash Flow» / «DCF» одного листа
    // разделяются без опоры на цвет, жирность и прочее оформление, которого в данных нет.
    // → { cols: [индексы колонок], years: [годы], totalCol: индекс колонки «Итог» | null }
    function periodHeader(row) {
        var cols = [], years = [];
        for (var c = 0; c < row.length; c++) {
            var n = cellNum(row[c]);
            if (isYearNum(n) && (!years.length || n > years[years.length - 1])) { cols.push(c); years.push(n); }
        }
        if (years.length < 3) return null;
        var totalCol = null;
        for (var t = cols[cols.length - 1] + 1; t < row.length && t <= cols[cols.length - 1] + 3; t++) {
            if (/итог/i.test(cellText(row[t]))) { totalCol = t; break; }
        }
        return { cols: cols, years: years, totalCol: totalCol };
    }

    // Подпись строки: текстовые ячейки ЛЕВЕЕ первой колонки периодов. Ближняя к периодам — имя
    // строки («ФОТ», «Выручка»), дальняя — метка/группа («OpEx 1», «COGS»). Одна ячейка — это имя.
    function rowLabels(row, firstPeriodCol) {
        var texts = [];
        for (var c = 0; c < firstPeriodCol && c < row.length; c++) {
            var s = cellText(row[c]);
            if (s !== '') texts.push({ col: c, text: s });
        }
        if (!texts.length) return { name: '', label: '' };
        if (texts.length === 1) return { name: texts[0].text, label: '' };
        return { name: texts[texts.length - 1].text, label: texts[0].text };
    }

    // Ссылки формулы на колонки/строки: A1, $F$3, SUM(F3:F4).
    function formulaRefs(formula) {
        var out = [];
        var re = /\$?([A-Z]{1,3})\$?(\d+)/g, m;
        while ((m = re.exec(String(formula || ''))) !== null) {
            var col = 0, s = m[1];
            for (var i = 0; i < s.length; i++) col = col * 26 + (s.charCodeAt(i) - 64);
            out.push({ col: col - 1, row: Number(m[2]) - 1 });
        }
        return out;
    }

    // РАСПОЗНАВАНИЕ ЛИСТА. grid — массив строк, каждая строка — массив ячеек (0-based).
    // → { panels: [{ title, years, rows: [{ name, label, values, total, formula }] }], journal: [] }
    function recognizeSheet(sheetName, grid, opts) {
        opts = opts || {};
        var journal = opts.journal || Journal.createJournal({ tool: 'dash-import', source: sheetName });
        var panels = [];
        var head = null, panel = null, pendingTitle = '', panelIndex = 0;

        function pushJournal(kind, rowIdx, colIdx, what, why) {
            journal.add({ kind: kind, where: 'лист «' + sheetName + '»',
                          address: cellAddr(rowIdx, colIdx), what: what, why: why });
        }

        for (var r = 0; r < grid.length; r++) {
            var row = grid[r] || [];
            var h = periodHeader(row);
            if (h) {
                head = h;
                panel = { title: pendingTitle || ('Панель ' + (++panelIndex)), years: h.years.slice(),
                          totalCol: h.totalCol, rows: [], headRow: r };
                if (pendingTitle) panelIndex++;
                panels.push(panel);
                pendingTitle = '';
                continue;
            }
            if (!head) {                                  // до первой шапки периодов — «шапка листа»
                var pre = rowLabels(row, row.length);
                if (pre.name) pendingTitle = pre.name;
                continue;
            }
            var lab = rowLabels(row, head.cols[0]);
            var values = {}, hasValue = false, formula = null;
            for (var i = 0; i < head.cols.length; i++) {
                var cell = row[head.cols[i]];
                var n = cellNum(cell);
                if (n != null) { values[head.years[i]] = n; hasValue = true; }
                if (cell && cell.f && !formula) formula = cell.f;
            }
            var total = head.totalCol != null ? cellNum(row[head.totalCol]) : null;

            if (!hasValue) {
                // Текст без чисел — заголовок следующей секции.
                if (lab.name) pendingTitle = lab.name;
                continue;
            }
            // СЕКЦИЯ БЕЗ СВОЕЙ ШАПКИ ЛЕТ. «Дисконтированный денежный поток» и сводный блок идут под
            // собственным заголовком, но ось периодов у них та же — новой строки с годами нет.
            // Заголовок + уже набранные строки = начинается новая панель на той же оси.
            if (pendingTitle && panel && panel.rows.length) {
                panel = { title: pendingTitle, years: head.years.slice(), totalCol: head.totalCol,
                          rows: [], headRow: panel.headRow };
                panels.push(panel);
                pendingTitle = '';
            }
            if (!lab.name) {
                pushJournal('unnamed-row', r, head.cols[0], 'строка с числами без подписи',
                    'имя строки модели взять неоткуда — строка не перенесена');
                continue;
            }
            // Формулы: переносимы только ссылки ВНУТРИ своей панели и внутри колонок периодов.
            var moved = null;
            if (formula) {
                var refs = formulaRefs(formula);
                var panelHeadRow = panel.headRow;
                var outside = refs.filter(function (ref) {
                    var inPeriodCols = head.cols.indexOf(ref.col) !== -1 || ref.col === head.totalCol;
                    var inPanel = ref.row > panelHeadRow;
                    return !inPeriodCols || !inPanel;
                });
                if (outside.length) {
                    pushJournal('formula', r, head.cols[0], '=' + formula,
                        'формула ссылается за пределы своей панели (параметры справа или другая секция) — значения перенесены как числа, формула нет');
                } else {
                    moved = formula;
                }
            }
            panel.rows.push({ name: lab.name, label: lab.label, values: values,
                              total: total, formula: moved, srcRow: r + 1 });
        }
        // Объединения в области данных — сетка, которую модель не повторяет.
        (opts.merges || []).forEach(function (m) {
            journal.add({ kind: 'merge', where: 'лист «' + sheetName + '»', address: m,
                what: 'объединённые ячейки', 
                why: 'модель не воспроизводит объединения — колонки строятся по периодам' });
        });
        // Панель без своего заголовка называем меткой первой строки («Cash Inflows»), а не «Панель N»:
        // метка — это то, как секцию называет сам автор файла.
        panels.forEach(function (p) {
            if (!/^Панель \d+$/.test(p.title)) return;
            var first = p.rows.filter(function (r) { return r.label; })[0];
            if (first) p.title = first.label;
        });
        return { panels: panels.filter(function (p) { return p.rows.length; }), journal: journal };
    }

    function cellAddr(rowIdx, colIdx) {
        var n = (colIdx == null ? 0 : colIdx) + 1, s = '';
        while (n) { var rem = (n - 1) % 26; s = String.fromCharCode(65 + rem) + s; n = Math.floor((n - 1) / 26); }
        return s + ((rowIdx == null ? 0 : rowIdx) + 1);
    }

    // РАСПОЗНАВАНИЕ КНИГИ. grids — [{ name, grid, merges }]. Имя модели — из имени файла.
    function recognizeModel(fileName, grids) {
        var model = { name: modelNameFromFile(fileName), sheets: [] };
        var journal = Journal.createJournal({
            tool: 'dash-import', source: modelNameFromFile(fileName), target: 'модель дэшборда' });
        (grids || []).forEach(function (g) {
            var res = recognizeSheet(g.name, g.grid || [], { merges: g.merges, journal: journal });
            model.sheets.push({ name: g.name, panels: res.panels });
        });
        journal.moved(model.sheets.reduce(function (a, s) {
            return a + s.panels.reduce(function (b, p) { return b + p.rows.length; }, 0); }, 0));
        model.years = [];
        model.sheets.forEach(function (s) {
            s.panels.forEach(function (p) {
                p.years.forEach(function (y) { if (model.years.indexOf(y) === -1) model.years.push(y); });
            });
        });
        model.years.sort(function (a, b) { return a - b; });
        return { model: model, journal: journal };
    }

    // Имя модели = имя файла без пути и расширения.
    function modelNameFromFile(fileName) {
        var base = String(fileName || '').split(/[\\/]/).pop();
        return base.replace(/\.(xlsx|xlsm|xls)$/i, '').trim() || 'Модель';
    }

    // СЛОВАРЬ ПЕРИОДА: годы файла + запас (решение заказчика 11.08.2026 — «годы файла + 3»).
    function periodValues(years, extra) {
        var list = (years || []).slice().sort(function (a, b) { return a - b; });
        if (!list.length) return [];
        var n = extra == null ? 3 : extra, last = list[list.length - 1], out = list.slice();
        for (var i = 1; i <= n; i++) out.push(last + i);
        return out;
    }

    // ── Операции записи ─────────────────────────────────────────────────────────────────────

    // Структура → операции. Ничего не пишет и не знает про сеть: возвращает список действий,
    // который исполняет контроллер (браузер) или MCP-инструмент.
    // existing — то, что уже есть в базе: { dashboardId, sheetsByName, periodTableId }.
    // Дописывание: лист с тем же именем переиспользуется, новый — создаётся (#4327 — импорт не
    // плодит дубли: перед вставкой ищем существующее по ключу).
    function buildCreateOps(model, schema, existing) {
        existing = existing || {};
        var ops = [], seq = 0;
        function ref() { return '$' + (++seq); }

        var periodOp = null;
        if (!existing.periodTableId) {
            periodOp = { op: 'create-period-dict', ref: ref(), name: schema.periodName || 'Год',
                         values: periodValues(model.years, 3) };
            ops.push(periodOp);
        } else {
            ops.push({ op: 'fill-period-dict', tableId: existing.periodTableId,
                       values: periodValues(model.years, 3) });
        }

        var dashRef;
        if (existing.dashboardId) {
            dashRef = existing.dashboardId;
            ops.push({ op: 'reuse-dashboard', id: existing.dashboardId, name: model.name });
        } else {
            dashRef = ref();
            ops.push({ op: 'create-dashboard', ref: dashRef, table: schema.dashboard, name: model.name,
                       period: periodOp ? periodOp.ref : existing.periodTableId });
        }

        model.sheets.forEach(function (sheet) {
            var known = (existing.sheetsByName || {})[sheet.name];
            var sheetRef;
            if (known) { sheetRef = known; ops.push({ op: 'reuse-sheet', id: known, name: sheet.name }); }
            else {
                sheetRef = ref();
                ops.push({ op: 'create-sheet', ref: sheetRef, table: schema.sheet, up: dashRef, name: sheet.name });
            }
            sheet.panels.forEach(function (panel) {
                var panelRef = ref();
                ops.push({ op: 'create-panel', ref: panelRef, table: schema.panel, up: sheetRef, name: panel.title });
                // Колонки: повтор по периодам (rg) + колонка суммы строки (line), если в файле «Итог:».
                ops.push({ op: 'create-rg', ref: ref(), table: schema.rg, up: panelRef,
                           rgType: schema.rgTypes.rg, ord: 1 });
                if (panel.totalCol != null) {
                    ops.push({ op: 'create-rg', ref: ref(), table: schema.rg, up: panelRef,
                               rgType: schema.rgTypes.line, ord: 2 });
                }
                panel.rows.forEach(function (row) {
                    var rowRef = ref();
                    ops.push({ op: 'create-row', ref: rowRef, table: schema.row, up: panelRef,
                               name: row.name, label: row.label, formula: row.formula });
                    Object.keys(row.values).forEach(function (year) {
                        ops.push({ op: 'create-value', table: schema.values, item: rowRef,
                                   period: Number(year), value: row.values[year] });
                    });
                });
            });
        });
        return ops;
    }

    // ── Журнал непереносимого ───────────────────────────────────────────────────────────────

    // ── Адаптер SheetJS → сетка ядра ────────────────────────────────────────────────────────

    // Книга SheetJS → [{ name, grid, merges }]. Формулы берём из `.f`, значения из `.v`.
    function gridsFromWorkbook(XLSX, workbook) {
        return (workbook.SheetNames || []).map(function (name) {
            var ws = workbook.Sheets[name];
            var ref = ws['!ref'] || 'A1';
            var range = XLSX.utils.decode_range(ref);
            var grid = [];
            for (var r = range.s.r; r <= range.e.r; r++) {
                var line = [];
                for (var c = range.s.c; c <= range.e.c; c++) {
                    var cell = ws[XLSX.utils.encode_cell({ r: r, c: c })];
                    line.push(cell ? { v: cell.v, f: cell.f || null } : null);
                }
                grid.push(line);
            }
            var merges = (ws['!merges'] || []).map(function (m) { return XLSX.utils.encode_range(m); });
            return { name: name, grid: grid, merges: merges };
        });
    }

    // ── Схема целевой базы ──────────────────────────────────────────────────────────────────

    // Таблицы модели резолвим ПО ИМЕНИ из `metadata` — ids у каждой базы свои (`docs/kb/dashboard.md`).
    // Чистая: на вход — массив metadata, на выход — схема либо список того, чего не хватает.
    function resolveSchema(metadata) {
        var byName = {};
        (metadata || []).forEach(function (t) {
            var name = String(t.val || '').trim();
            // Дублирующиеся имена: берём запись с бо́льшим числом реквизитов — она и есть рабочая.
            if (!byName[name] || (t.reqs || []).length > (byName[name].reqs || []).length) byName[name] = t;
        });
        function id(name) { return byName[name] ? Number(byName[name].id) : null; }
        function reqId(tableName, reqName) {
            var t = byName[tableName];
            if (!t) return null;
            var q = (t.reqs || []).filter(function (r) { return String(r.val || '').trim() === reqName; })[0];
            return q ? Number(q.id) : null;
        }
        var schema = {
            dashboard: id('Дэшборд'), sheet: id('Лист'), panel: id('Панель'), row: id('Строка'),
            rg: id('RG'), rgTypeDict: id('Тип RG'), values: id('Значение'),
            periodDict: id('Период'), yearTable: id('Год'), budgetRows: id('Строка бюджета'),
            req: {
                dashPeriod: reqId('Дэшборд', 'Период'),
                rowFormula: reqId('Строка', 'Формула_т'), rowLabel: reqId('Строка', 'Метка_т'),
                rgType: reqId('RG', 'Тип RG'),
                valDate: reqId('Значение', 'Дата_т'), valRow: reqId('Значение', 'Строка бюджета'),
                valLabel: reqId('Значение', 'Метка_т')
            },
            periodName: 'Год'
        };
        schema.missing = ['dashboard', 'sheet', 'panel', 'row', 'rg', 'values']
            .filter(function (k) { return !schema[k]; });
        return schema;
    }

    var api = {
        resolveSchema: resolveSchema,
        recognizeModel: recognizeModel,
        recognizeSheet: recognizeSheet,
        periodHeader: periodHeader,
        rowLabels: rowLabels,
        periodValues: periodValues,
        buildCreateOps: buildCreateOps,
        modelNameFromFile: modelNameFromFile,
        gridsFromWorkbook: gridsFromWorkbook,
        formulaRefs: formulaRefs
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.DashImport = api;

    // ── Рабочее место ───────────────────────────────────────────────────────────────────────
    // Ниже — только экран: чтение файла, предпросмотр, запись. Логика распознавания выше и от
    // DOM не зависит, поэтому её проверяет тест, а не браузер.

    if (typeof document === 'undefined') return;
    var root = document.getElementById('dash-import');
    if (!root) return;

    var DB = root.getAttribute('data-db') || '';
    var XSRF = root.getAttribute('data-xsrf') || '';
    var state = { model: null, journal: [], fileName: '' };

    function el(id) { return document.getElementById(id); }
    function status(text, kind) {
        var box = el('di-status');
        box.textContent = text || '';
        box.className = 'di-status' + (kind ? ' di-status-' + kind : '');
    }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

    // Интеграм-API. Ошибка приходит как [{error}] с 4xx — смотрим resp.ok, а не только тело.
    function api2(path, form) {
        var opts = { method: form ? 'POST' : 'GET', credentials: 'same-origin' };
        if (form) { form.append('_xsrf', XSRF); opts.body = form; }
        return fetch('/' + DB + '/' + path, opts).then(function (resp) {
            return resp.text().then(function (text) {
                var data = null;
                try { data = JSON.parse(text); } catch (e) { data = null; }
                if (!resp.ok) {
                    var msg = (data && data[0] && data[0].error) || text.slice(0, 200);
                    throw new Error(path + ' → ' + resp.status + ' ' + msg);
                }
                return data;
            });
        });
    }
    function createObj(tableId, up, mainValue, fields) {
        var f = new FormData();
        f.append('t' + tableId, mainValue == null ? '' : String(mainValue));
        Object.keys(fields || {}).forEach(function (k) { f.append('t' + k, String(fields[k])); });
        var path = '_m_new/' + tableId + '?JSON=1' + (up ? '&up=' + up : '');
        return api2(path, f).then(function (res) {
            var id = res && (res.id || res.ID || (res[0] && res[0].id));
            if (!id) throw new Error('создание в таблице ' + tableId + ': ответ без id');
            return String(id);
        });
    }

    // SheetJS подгружаем лениво — он нужен только когда файл выбран (как в upload.html).
    function withXLSX() {
        if (window.XLSX) return Promise.resolve(window.XLSX);
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = '/js/xlsx0.18.5.full.min.js';
            s.onload = function () { resolve(window.XLSX); };
            s.onerror = function () { reject(new Error('не загрузилась библиотека чтения xlsx')); };
            document.head.appendChild(s);
        });
    }

    function renderPreview() {
        var m = state.model;
        var sheets = m.sheets.length;
        var panels = m.sheets.reduce(function (a, s) { return a + s.panels.length; }, 0);
        var rows = m.sheets.reduce(function (a, s) {
            return a + s.panels.reduce(function (b, p) { return b + p.rows.length; }, 0); }, 0);
        var values = m.sheets.reduce(function (a, s) {
            return a + s.panels.reduce(function (b, p) {
                return b + p.rows.reduce(function (c, r) { return c + Object.keys(r.values).length; }, 0); }, 0); }, 0);
        el('di-summary').innerHTML =
            '<b>' + esc(m.name) + '</b> · листов ' + sheets + ' · панелей ' + panels +
            ' · строк ' + rows + ' · значений ' + values +
            ' · периоды ' + (m.years[0] || '—') + '…' + (m.years[m.years.length - 1] || '—');

        var html = '';
        m.sheets.forEach(function (s) {
            html += '<div class="di-sheet"><div class="di-sheet-name">Лист «' + esc(s.name) + '»</div>';
            s.panels.forEach(function (p) {
                html += '<div class="di-panel"><div class="di-panel-name">' + esc(p.title) +
                        ' <span class="di-dim">строк ' + p.rows.length +
                        (p.totalCol != null ? ', есть «Итог»' : '') + '</span></div><ul class="di-rows">';
                p.rows.forEach(function (r) {
                    html += '<li>' + esc(r.name) +
                            (r.label ? ' <span class="di-dim">[' + esc(r.label) + ']</span>' : '') +
                            (r.formula ? ' <span class="di-f">ƒ ' + esc(r.formula) + '</span>' : '') + '</li>';
                });
                html += '</ul></div>';
            });
            html += '</div>';
        });
        el('di-preview').innerHTML = html;
        el('di-preview-step').hidden = false;

        el('di-journal-count').textContent = state.journal.count() ? state.journal.count() : '— ничего';
        el('di-journal-text').value = state.journal.toIssueMarkdown();
        el('di-journal-step').hidden = false;
        el('di-create-step').hidden = false;
    }

    el('di-file').addEventListener('change', function (ev) {
        var file = ev.target.files && ev.target.files[0];
        if (!file) return;
        state.fileName = file.name;
        el('di-file-name').textContent = file.name;
        status('Читаю файл…');
        withXLSX().then(function (XLSX) {
            return file.arrayBuffer().then(function (buf) {
                var wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
                var res = recognizeModel(file.name, gridsFromWorkbook(XLSX, wb));
                state.model = res.model; state.journal = res.journal;
                renderPreview();
                status('Разобрано. Проверьте структуру — в базу пока ничего не записано.', 'ok');
            });
        }).catch(function (e) { status('Не удалось разобрать файл: ' + e.message, 'err'); });
    });

    el('di-journal-copy').addEventListener('click', function () {
        var ta = el('di-journal-text');
        ta.select();
        try { document.execCommand('copy'); status('Журнал скопирован — вставляйте в issue.', 'ok'); }
        catch (e) { status('Скопируйте текст журнала вручную.', 'err'); }
    });

    el('di-create').addEventListener('click', function () {
        if (!state.model) return;
        var btn = el('di-create');
        btn.disabled = true;
        status('Читаю схему базы…');
        var schema, dashId, sheetIds = {};
        api2('metadata?JSON').then(function (meta) {
            schema = resolveSchema(meta);
            if (schema.missing.length) throw new Error('в базе нет таблиц модели: ' + schema.missing.join(', '));
            // Модель с таким именем уже есть? Тогда дописываем в неё (#4704).
            return api2('object/' + schema.dashboard + '/?JSON_OBJ&LIMIT=0,500');
        }).then(function (list) {
            var found = (list || []).filter(function (r) {
                return String(r.r && r.r[0]).trim() === state.model.name; })[0];
            if (found) { dashId = String(found.i); status('Модель найдена — дописываю листы…'); return null; }
            status('Создаю модель…');
            var fields = {};
            if (schema.req.dashPeriod && schema.periodDict) fields[schema.req.dashPeriod] = 'Год';
            return createObj(schema.dashboard, null, state.model.name, fields).then(function (id) { dashId = id; });
        }).then(function () {
            // Листы: одноимённый переиспользуем, новый создаём.
            return api2('object/' + schema.sheet + '/?JSON_OBJ&LIMIT=0,500&up=' + dashId).then(function (list) {
                (list || []).forEach(function (r) { sheetIds[String(r.r && r.r[0]).trim()] = String(r.i); });
            }).catch(function () { /* подчинённых ещё нет */ });
        }).then(function () {
            var chain = Promise.resolve(), created = { sheets: 0, panels: 0, rows: 0, values: 0 };
            state.model.sheets.forEach(function (sheet) {
                chain = chain.then(function () {
                    if (sheetIds[sheet.name]) return sheetIds[sheet.name];
                    created.sheets++;
                    return createObj(schema.sheet, dashId, sheet.name, {});
                }).then(function (sheetId) {
                    var inner = Promise.resolve();
                    sheet.panels.forEach(function (panel) {
                        inner = inner.then(function () {
                            created.panels++;
                            return createObj(schema.panel, sheetId, panel.title, {});
                        }).then(function (panelId) {
                            var rowsChain = Promise.resolve();
                            panel.rows.forEach(function (row) {
                                rowsChain = rowsChain.then(function () {
                                    created.rows++;
                                    var f = {};
                                    if (schema.req.rowFormula && row.formula) f[schema.req.rowFormula] = row.formula;
                                    if (schema.req.rowLabel && row.label) f[schema.req.rowLabel] = row.label;
                                    return createObj(schema.row, panelId, row.name, f);
                                });
                            });
                            return rowsChain;
                        });
                    });
                    return inner;
                });
            });
            return chain.then(function () { return created; });
        }).then(function (created) {
            status('Готово: листов ' + created.sheets + ', панелей ' + created.panels +
                   ', строк ' + created.rows + '. Модель: ' + state.model.name +
                   ' (dash/' + dashId + ').', 'ok');
            el('di-target').innerHTML = '<a href="/' + DB + '/dash/' + dashId + '" target="_blank">Открыть модель</a>';
            btn.disabled = false;
        }).catch(function (e) {
            status('Запись прервана: ' + e.message + '. Что успело создаться — осталось в базе.', 'err');
            btn.disabled = false;
        });
    });
})();
