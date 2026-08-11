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
    // МАССОВАЯ ЗАПИСЬ — общий инструмент (`js/integram-batch.js`, #4716): пул до пяти потоков и
    // семафор на транспорте. Своей реализации у конвертора нет.
    var Batch = (typeof require === 'function') ? require('./integram-batch.js')
              : (typeof window !== 'undefined' ? window.IntegramBatch : null);

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

    // ЗАПИСЬ СЛОВАРЯ ГОДА — ЭТО ИМЯ И ГРАНИЦЫ (#4718). Рабочее место `dash` отбирает периоды по
    // «С» и «По» (`dashFilterPeriodDict` в `js/dash.js`): строка без обеих дат отбрасывается
    // молча. Год, записанный одним именем, для модели невидим — колонок по нему не появится.
    function yearDictRows(years, extra) {
        return periodValues(years, extra).map(function (y) {
            return { name: String(y), from: '01.01.' + y, to: '31.12.' + y };
        });
    }

    // ── Справочники: один способ на все ─────────────────────────────────────────────────────
    //
    // Модель опирается на четыре справочника: «Период» (вид оси), «Год» (сами колонки),
    // «Тип RG» (режим колонок панели), «Строка бюджета» (по имени связаны числа со строками).
    // Каждый из них обрабатывался по-своему и каждый умел молча отвалиться: словарь «Год» не
    // заполнялся вовсе (#4718), «Тип RG» и «Строка бюджета» на пустой ответ подставляли `{}` —
    // после чего панель оставалась без колонок, а числа не записывались, и экран всё равно
    // рапортовал «Готово». Поэтому путь теперь один на все: прочитать → дописать недостающее →
    // отдать индекс «ключ → id» → писать в модель ТОЛЬКО id.
    //
    // Почему именно id: `_m_new` ссылку по имени ещё резолвит (и молча создаёт запись, если у
    // роли есть WRITE), а `_m_set` приводит значение к `(int)` — имя превращается в 0 и СТИРАЕТ
    // ссылку. Один формат записи на оба пути снимает этот класс ошибок целиком.

    // ПЛАН ПРИВЕДЕНИЯ СПРАВОЧНИКА В ПОРЯДОК — чистой функцией, чтобы его проверял тест, а не
    // браузер. Чего нет — создать; что нашлось по имени, но без ключа — дописать ключ
    // (иначе «Тип RG» с пустым «Кодом» тихо ломает отрисовку колонок).
    //   needed:   [{ name, key?, fields? }]
    //   existing: строки `JSON_OBJ`
    //   opts:     { keyCol — индекс ключевой колонки в r[], keyReq — id реквизита ключа }
    // → { create: [{ name, key, fields }], patch: [{ id, name, key, fields }], index: { ключ: id } }
    function dictPlan(needed, existing, opts) {
        opts = opts || {};
        var byName = {}, byKey = {}, index = {}, create = [], patch = [];
        (existing || []).forEach(function (rec) {
            var r = (rec && rec.r) || [];
            var name = String(r[0] == null ? '' : r[0]).trim();
            var key = opts.keyCol == null ? '' : String(r[opts.keyCol] == null ? '' : r[opts.keyCol]).trim();
            if (name && !byName[name]) byName[name] = { id: String(rec.i), key: key };
            if (key && !byKey[key]) byKey[key] = String(rec.i);
        });
        var queued = {};
        (needed || []).forEach(function (want) {
            var name = String(want.name == null ? '' : want.name).trim();
            var key = want.key == null ? '' : String(want.key).trim();
            var slot = key || name;
            if (!name || index[slot] || queued[slot]) return;   // повтор в списке — одна запись
            queued[slot] = 1;
            var found = key ? byKey[key] : (byName[name] && byName[name].id);
            if (found) { index[slot] = found; return; }
            var sameName = byName[name];
            if (key && sameName && !sameName.key && opts.keyReq) {
                var f = {};
                f[opts.keyReq] = key;
                patch.push({ id: sameName.id, name: name, key: key, fields: f });
                index[slot] = sameName.id;
                return;
            }
            var fields = {};
            Object.keys(want.fields || {}).forEach(function (k) { fields[k] = want.fields[k]; });
            // Ключевая колонка заполняется и у СОЗДАВАЕМОЙ записи: «Тип RG» без «Кода» рабочее
            // место не узнаёт — оно сравнивает `rg`/`line`, название ему ничего не говорит.
            if (key && opts.keyReq) fields[opts.keyReq] = key;
            create.push({ name: name, key: key, fields: fields });
        });
        return { create: create, patch: patch, index: index };
    }

    // Чего не хватает в справочниках под эту модель. Один список — один порядок обработки:
    // «Период» и «Год» нужны до дэшборда, «Тип RG» — до панелей, «Строка бюджета» — до чисел.
    // → [{ key, name, table, needed, keyCol, keyReq }]
    function dictSpecs(schema, model, extra) {
        schema = schema || {};
        var dicts = schema.dicts || {};
        var years = yearDictRows((model && model.years) || [], extra);
        var needLine = ((model && model.sheets) || []).some(function (s) {
            return (s.panels || []).some(function (p) { return p.totalCol != null; }); });
        var rgTypes = [{ name: 'Repeating group', key: 'rg' }];
        if (needLine) rgTypes.push({ name: 'Сумма строки', key: 'line' });
        return [
            { key: 'period', name: 'Период', table: dicts.period,
              needed: [{ name: schema.periodName || 'Год' }] },
            { key: 'years', name: schema.periodName || 'Год', table: dicts.years,
              needed: years.map(function (y) {
                  var f = {};
                  f[(schema.req || {}).yearFrom] = y.from;
                  f[(schema.req || {}).yearTo] = y.to;
                  return { name: y.name, fields: f };
              }) },
            { key: 'rgTypes', name: 'Тип RG', table: dicts.rgTypes, keyCol: 1,
              keyReq: (schema.req || {}).rgTypeCode, needed: rgTypes },
            { key: 'budget', name: 'Строка бюджета', table: dicts.budget,
              needed: budgetRowNames(model || {}).map(function (n) { return { name: n }; }) }
        ];
    }

    // Реквизит таблицы по имени — сравниваем и с именем ТИПА, и с псевдонимом: в finmo тип
    // зовётся «С_т», а колонка — «С» (#4672).
    function findReq(table, reqName) {
        return ((table && table.reqs) || []).filter(function (r) {
            if (String(r.val || '').trim() === reqName) return true;
            var attrs = {};
            try { attrs = JSON.parse(r.attrs || '{}'); } catch (e) { attrs = {}; }
            return String(attrs.alias || '').trim() === reqName;
        })[0] || null;
    }

    // ТАБЛИЦА-СЛОВАРЬ ПЕРИОДА ищется ПО ИМЕНИ ПЕРИОДА — ровно так её читает `dash`
    // (`object/Год?JSON_DATA&LIMIT=10000`). Имена таблиц не уникальны (#4714), поэтому из
    // одноимённых берём ту, у которой есть границы «С» и «По»; запасной путь — id, на который
    // смотрит реквизит «Год» листа. → { id, from, to } | null
    function periodDictTable(metadata, name, fallbackId) {
        var wanted = String(name || '').trim();
        var named = (metadata || []).filter(function (t) {
            return String(t.val || '').trim() === wanted; });
        var withBounds = named.filter(function (t) { return findReq(t, 'С') && findReq(t, 'По'); });
        var table = withBounds[0] || named[0] ||
            (fallbackId ? (metadata || []).filter(function (t) {
                return String(t.id) === String(fallbackId); })[0] : null);
        if (!table) return null;
        var from = findReq(table, 'С'), to = findReq(table, 'По');
        return { id: Number(table.id), name: String(table.val || '').trim(),
                 from: from ? Number(from.id) : null, to: to ? Number(to.id) : null };
    }

    // ── Значения: справочник строк, дата периода, ключ ──────────────────────────────────────

    // ЗНАЧЕНИЕ СВЯЗАНО СО СТРОКОЙ ПО ИМЕНИ, А НЕ ССЫЛКОЙ НА СТРОКУ МОДЕЛИ (#4709).
    // Запись «Значение» ссылается на справочник «Строка бюджета»; строка модели и строка значений —
    // разные таблицы, связывает их имя (плюс «Метка»), см. `docs/kb/dashboard.md`. Поэтому перед
    // записью чисел нужны имена строк в справочнике — уникальные, без дублей (#4327).
    function budgetRowNames(model) {
        var seen = {}, out = [];
        (model.sheets || []).forEach(function (s) {
            (s.panels || []).forEach(function (p) {
                (p.rows || []).forEach(function (r) {
                    var name = String(r.name || '').trim();
                    if (name && !seen[name]) { seen[name] = 1; out.push(name); }
                });
            });
        });
        return out;
    }

    // Дата периода для годовой оси — первое число года: «Значение» хранит дату, а не номер периода.
    function valueDateForYear(year) { return '01.01.' + String(year); }

    // Ключ значения: строка + период + метка. По нему повторный залив того же файла НЕ задваивает
    // числа — он их узнаёт (правило «импорт не плодит дубли», #4327).
    function valueKey(rowName, year, label) {
        return [String(rowName || '').trim(), String(year), String(label || '').trim()].join('\u0001');   // разделитель — управляющий символ: в именах строк его не бывает
    }

    // ТИП RG БЕРЁМ ПО КОДУ, А НЕ ПО ID (#4709). Коды (`rg`, `line`, `value`, `mu`, `col`, `query`)
    // — это контракт рабочего места `dash`; id записей «Тип RG» у каждой базы свои.
    // rows — записи справочника «Тип RG» в виде { i, r:[название, код, …] }. → { код: id }
    function rgTypeIdsByCode(rows) {
        var out = {};
        (rows || []).forEach(function (rec) {
            var code = String((rec.r && rec.r[1]) || '').trim();
            if (code) out[code] = String(rec.i);
        });
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

    // АДРЕС СОЗДАНИЯ ЗАПИСИ — ОДНО МЕСТО (#4711). Ядро требует родителя ВСЕГДА: у подчинённой
    // записи это id владельца, у независимой — единица. Без `up` приходит
    // «Недопустимые данные: up=0. Установите значение=1 для независимых объектов», и кнопка
    // «Создать модель» падает на первой же записи (дэшборд). Правило записано здесь, а не в каждом
    // вызове: иначе следующая создаваемая сущность снова забудет родителя.
    function newObjectPath(tableId, up) {
        var parent = (up === undefined || up === null || up === '' || Number(up) === 0) ? 1 : up;
        return '_m_new/' + tableId + '?JSON&up=' + encodeURIComponent(parent);
    }

    // ЧТЕНИЕ ПОДЧИНЁННЫХ — ПО `F_U`, А НЕ ПО `up` (#4720). Параметр `up` действует при СОЗДАНИИ
    // записи; при чтении он не фильтрует ничего и молча отдаёт пустой список. Из-за этого лист
    // модели «не находился», и каждый прогон конвертора создавал ещё один одноимённый лист —
    // в finmo их набралось четыре, а строки одной модели разъехались по двум.
    function childListPath(tableId, parentId, limit) {
        return 'object/' + tableId + '/?JSON_OBJ&LIMIT=0,' + (limit || 500) +
               '&F_U=' + encodeURIComponent(parentId);
    }

    // Границы дэшборда «С»/«По» выводятся из годов файла: без них отбор периодов не выполняется
    // вовсе — в диапазон берутся периоды, целиком лежащие внутри [С; По] (`docs/kb/dashboard.md`).
    function modelDateRange(years) {
        var list = (years || []).slice().sort(function (a, b) { return a - b; });
        if (!list.length) return null;
        return { from: '01.01.' + list[0], to: '31.12.' + list[list.length - 1] };
    }

    // ── Схема целевой базы ──────────────────────────────────────────────────────────────────

    // Таблицы модели резолвим ПО ИМЕНИ из `metadata` — ids у каждой базы свои (`docs/kb/dashboard.md`).
    // Чистая: на вход — массив metadata, на выход — схема либо список того, чего не хватает.
    function resolveSchema(metadata) {
        var byId = {}, byName = {};
        (metadata || []).forEach(function (t) {
            byId[String(t.id)] = t;
            (byName[String(t.val || '').trim()] = byName[String(t.val || '').trim()] || []).push(t);
        });
        // Реквизит таблицы по имени — сравниваем и с именем, и с псевдонимом («Метка_т» ↔ «Метка»).
        function req(tableId, reqName) { return findReq(byId[String(tableId)], reqName); }
        function reqId(tableId, reqName) { var q = req(tableId, reqName); return q ? Number(q.id) : null; }
        // Таблица, на которую смотрит реквизит: подчинённая (`arr_id`) или справочник (`ref`).
        function linked(tableId, reqName) {
            var q = req(tableId, reqName);
            var target = q && (q.arr_id || q.ref);
            return target ? String(target) : null;
        }
        // Корень ищем по имени, но из одноимённых берём ТУ, у которой есть подчинённые «Листы»:
        // имя таблицы уникальным не бывает.
        var dashboard = (byName['Дэшборд'] || []).filter(function (t) {
            return linked(t.id, 'Лист'); })[0];
        dashboard = dashboard ? String(dashboard.id) : null;

        // ИЕРАРХИЮ БЕРЁМ ПО ССЫЛКАМ, А НЕ ПО ИМЕНАМ (#4714). В базе бывают одноимённые таблицы:
        // в `finmo` «Панель» — это и 138, и 537, и по имени выбиралась чужая. Запись в неё
        // отвечала «У вас нет доступа к реквизиту объекта … 138» и конвертор падал. Настоящую
        // цепочку задаёт сама модель: Дэшборд → реквизит «Лист» → Лист → «Панель» → Панель →
        // «Строка»/«RG». Так же ищутся и справочники — по реквизиту, который на них смотрит.
        var sheet = dashboard ? linked(dashboard, 'Лист') : null;
        var panel = sheet ? linked(sheet, 'Панель') : null;
        var row = panel ? linked(panel, 'Строка') : null;
        var rg = panel ? linked(panel, 'RG') : null;
        var values = ((byName['Значение'] || [])[0] || {}).id;
        values = values ? String(values) : null;

        var schema = {
            dashboard: num(dashboard), sheet: num(sheet), panel: num(panel), row: num(row), rg: num(rg),
            rgTypeDict: num(rg ? linked(rg, 'Тип RG') : null),
            values: num(values),
            budgetRows: num(values ? linked(values, 'Строка бюджета') : null),
            periodDict: num(dashboard ? linked(dashboard, 'Период') : null),
            yearTable: num(sheet ? linked(sheet, 'Год') : null),
            req: {
                dashPeriod: dashboard ? reqId(dashboard, 'Период') : null,
                dashFrom: dashboard ? reqId(dashboard, 'С') : null,
                dashTo: dashboard ? reqId(dashboard, 'По') : null,
                rowFormula: row ? reqId(row, 'Формула') : null,
                rowLabel: row ? reqId(row, 'Метка') : null,
                rgType: rg ? reqId(rg, 'Тип RG') : null,
                valDate: values ? reqId(values, 'Дата') : null,
                valRow: values ? reqId(values, 'Строка бюджета') : null,
                valLabel: values ? reqId(values, 'Метка') : null,
                rgTypeCode: rg && linked(rg, 'Тип RG') ? reqId(linked(rg, 'Тип RG'), 'Код') : null
            },
            periodName: 'Год'
        };
        schema.missing = ['dashboard', 'sheet', 'panel', 'row', 'rg', 'values']
            .filter(function (k) { return !schema[k]; });

        // СПРАВОЧНИКИ МОДЕЛИ — проверяются ВСЕ и ДО записи. Каждый из них умеет сломать модель
        // тихо: без «Года» нет колонок (#4718), без «Типа RG» панель пустая, без «Строки
        // бюджета» не пишутся числа. Пусть недостача называется словами, пока в базе ещё ничего
        // не создано.
        var period = periodDictTable(metadata, schema.periodName, schema.yearTable);
        schema.periodTable = period ? period.id : null;
        schema.req.yearFrom = period ? period.from : null;
        schema.req.yearTo = period ? period.to : null;
        schema.periodDictProblem = !period
            ? 'в базе нет таблицы-словаря «' + schema.periodName + '» — годам модели негде лежать'
            : (!period.from || !period.to
                ? 'у таблицы «' + period.name + '» нет колонок «С» и «По» — без границ период не' +
                  ' попадает в модель'
                : null);

        schema.dicts = {
            period: schema.periodDict, years: schema.periodTable,
            rgTypes: schema.rgTypeDict, budget: schema.budgetRows
        };
        schema.dictProblems = [];
        if (schema.periodDictProblem) schema.dictProblems.push(schema.periodDictProblem);
        if (!schema.periodDict)
            schema.dictProblems.push('нет справочника «Период» — дэшборду нечем назвать свою ось');
        if (!schema.req.dashPeriod)
            schema.dictProblems.push('у «Дэшборда» нет колонки «Период» — вид оси задать негде');
        if (!schema.rgTypeDict)
            schema.dictProblems.push('нет справочника «Тип RG» — панели останутся без колонок');
        else if (!schema.req.rgTypeCode)
            schema.dictProblems.push('у справочника «Тип RG» нет колонки «Код» — рабочее место ' +
                'сравнивает именно код (`rg`, `line`), название ему ничего не говорит');
        if (!schema.req.rgType)
            schema.dictProblems.push('у «RG» нет ссылки «Тип RG» — режим колонок задать негде');
        if (!schema.budgetRows)
            schema.dictProblems.push('нет справочника «Строка бюджета» — числа не с чем связать');
        if (!schema.req.valRow)
            schema.dictProblems.push('у «Значения» нет ссылки «Строка бюджета» — число повиснет ' +
                'без строки');
        return schema;
    }
    function num(v) { return v == null || v === '' ? null : Number(v); }

    // ── Трасса переноса (панель отладки, #4718) ─────────────────────────────────────────────

    // Импорт делает сотни записей по сети, а экран показывал одну итоговую строку. Когда
    // «прошло успешно», но в базе чего-то нет (годы!), разбирать нечего. Трасса пишет каждый
    // шаг и КАЖДЫЙ запрос — адрес, статус, id созданной записи — и выгружается файлом.
    // Часы передаются параметром: тесту нужен предсказуемый отсчёт.
    function createTrace(meta, now) {
        var clock = now || function () { return Date.now(); };
        var t0 = clock(), entries = [], counters = {};
        function push(kind, step, data) {
            var e = { ms: clock() - t0, kind: kind, step: step,
                      data: data === undefined ? null : data };
            entries.push(e);
            return e;
        }
        return {
            add:   function (step, data) { return push('step', step, data); },
            api:   function (step, data) { return push('api', step, data); },
            error: function (step, data) { return push('error', step, data); },
            count: function (name, by) { counters[name] = (counters[name] || 0) + (by == null ? 1 : by); },
            counters: function () { return counters; },
            all: function () { return entries.slice(); },
            errors: function () { return entries.filter(function (e) { return e.kind === 'error'; }); },
            toJSON: function () {
                var out = { tool: 'dash-import', entries: entries.slice(), counters: counters };
                Object.keys(meta || {}).forEach(function (k) { out[k] = meta[k]; });
                return out;
            },
            // Текст для экрана: хвост урезаем (модель на 700 значений даёт тысячи строк), но
            // ошибки показываем ВСЕ — ради них панель и открывают.
            toText: function (limit) {
                var max = limit == null ? 200 : limit;
                var lines = entries.slice(0, max).map(function (e) {
                    return '+' + e.ms + 'мс  ' + (e.kind === 'error' ? '⛔ ' : '') + e.step +
                           (e.data == null ? '' : '  ' + JSON.stringify(e.data));
                });
                if (entries.length > max) {
                    lines.push('… ещё ' + (entries.length - max) + ' записей — они в выгруженном файле');
                    entries.slice(max).filter(function (e) { return e.kind === 'error'; })
                        .forEach(function (e) {
                            lines.push('+' + e.ms + 'мс  ⛔ ' + e.step +
                                       (e.data == null ? '' : '  ' + JSON.stringify(e.data)));
                        });
                }
                var names = Object.keys(counters);
                if (names.length) lines.push('— итог: ' + names.map(function (n) {
                    return n + ' ' + counters[n]; }).join(', '));
                return lines.join('\n');
            }
        };
    }

    var api = {
        newObjectPath: newObjectPath,
        childListPath: childListPath,
        modelDateRange: modelDateRange,
        resolveSchema: resolveSchema,
        periodDictTable: periodDictTable,
        yearDictRows: yearDictRows,
        dictPlan: dictPlan,
        dictSpecs: dictSpecs,
        createTrace: createTrace,
        budgetRowNames: budgetRowNames,
        valueDateForYear: valueDateForYear,
        valueKey: valueKey,
        rgTypeIdsByCode: rgTypeIdsByCode,
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
    var state = { model: null, journal: [], fileName: '', trace: createTrace({ db: DB }) };

    function el(id) { return document.getElementById(id); }
    function status(text, kind) {
        var box = el('di-status');
        box.textContent = text || '';
        box.className = 'di-status' + (kind ? ' di-status-' + kind : '');
    }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

    // Интеграм-API. Ошибка приходит как [{error}] с 4xx — смотрим resp.ok, а не только тело.
    // Каждый запрос попадает в трассу (#4718): по ней потом видно, что именно ушло в базу.
    // Потолок держит САМ транспорт: пулы вкладываются (листы → панели → строки), и пять
    // вложенных пулов по пять дали бы 25 запросов разом (#4480).
    function api2(path, form) {
        var opts = { method: form ? 'POST' : 'GET', credentials: 'same-origin' };
        if (form) { form.append('_xsrf', XSRF); opts.body = form; }
        return fetch('/' + DB + '/' + path, opts).then(function (resp) {
            return resp.text().then(function (text) {
                var data = null;
                try { data = JSON.parse(text); } catch (e) { data = null; }
                if (!resp.ok) {
                    var msg = (data && data[0] && data[0].error) || text.slice(0, 200);
                    state.trace.error(opts.method + ' ' + path, { status: resp.status, answer: msg });
                    throw new Error(path + ' → ' + resp.status + ' ' + msg);
                }
                state.trace.api(opts.method + ' ' + path, {
                    status: resp.status,
                    rows: Array.isArray(data) ? data.length : undefined,
                    id: (data && !Array.isArray(data) && (data.id || data.ID)) || undefined
                });
                return data;
            });
        });
    }
    var post5 = Batch.limiter(api2, 5);

    function createObj(tableId, up, mainValue, fields) {
        var f = new FormData();
        f.append('t' + tableId, mainValue == null ? '' : String(mainValue));
        Object.keys(fields || {}).forEach(function (k) { f.append('t' + k, String(fields[k])); });
        return post5(newObjectPath(tableId, up), f).then(function (res) {
            var id = res && (res.id || res.ID || (res[0] && res[0].id));
            if (!id) {
                state.trace.error('создание в таблице ' + tableId + ' — ответ без id',
                                  { up: up, value: mainValue, answer: res });
                throw new Error('создание в таблице ' + tableId + ': ответ без id');
            }
            state.trace.add('создано в таблице ' + tableId,
                            { id: String(id), up: up == null ? 1 : up, value: mainValue, fields: fields });
            return String(id);
        });
    }

    // Правка записи. Ссылку `_m_set` принимает ТОЛЬКО id: имя приводится к `(int)` = 0 и стирает
    // значение (index.php, «_m_set» → ветка非-MULTI ref). Поэтому в модель уходят одни id.
    function setObj(objId, fields) {
        var keys = Object.keys(fields || {}).filter(function (k) {
            return k && k !== 'null' && k !== 'undefined' && fields[k] != null && fields[k] !== ''; });
        if (!keys.length) return Promise.resolve(String(objId));
        var f = new FormData();
        keys.forEach(function (k) { f.append('t' + k, String(fields[k])); });
        return api2('_m_set/' + objId + '?JSON', f).then(function () {
            state.trace.add('правка записи ' + objId, { fields: fields });
            return String(objId);
        });
    }
    function makeField(reqId, value) {
        var f = {};
        if (reqId && value) f[reqId] = value;
        return f;
    }

    // ── Панель отладки ──────────────────────────────────────────────────────────────────────

    function renderDebug() {
        el('di-debug-text').value = state.trace.toText();
        var errs = state.trace.errors().length;
        el('di-debug-count').textContent = state.trace.all().length + ' шагов' +
            (errs ? ', ошибок ' + errs : '');
        el('di-debug-step').hidden = false;
    }
    function debugFileName() {
        var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
        var stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
                    p(d.getHours()) + p(d.getMinutes());
        var name = String((state.model && state.model.name) || 'модель').replace(/[\\/:*?"<>|]/g, '_');
        return 'dash-import-' + name + '-' + stamp + '.json';
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
        state.trace = createTrace({ db: DB, file: file.name });
        state.trace.add('выбран файл', { name: file.name, size: file.size });
        withXLSX().then(function (XLSX) {
            return file.arrayBuffer().then(function (buf) {
                var wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
                var res = recognizeModel(file.name, gridsFromWorkbook(XLSX, wb));
                state.model = res.model; state.journal = res.journal;
                state.trace.add('файл разобран', {
                    model: res.model.name, years: res.model.years,
                    sheets: res.model.sheets.map(function (s) {
                        return { name: s.name, panels: s.panels.map(function (p) {
                            return { title: p.title, rows: p.rows.length,
                                     total: p.totalCol != null }; }) };
                    }),
                    journal: res.journal.count()
                });
                renderPreview();
                renderDebug();
                status('Разобрано. Проверьте структуру — в базу пока ничего не записано.', 'ok');
            });
        }).catch(function (e) {
            state.trace.error('разбор файла', { message: e.message });
            renderDebug();
            status('Не удалось разобрать файл: ' + e.message, 'err');
        });
    });

    el('di-journal-copy').addEventListener('click', function () {
        var ta = el('di-journal-text');
        ta.select();
        try { document.execCommand('copy'); status('Журнал скопирован — вставляйте в issue.', 'ok'); }
        catch (e) { status('Скопируйте текст журнала вручную.', 'err'); }
    });

    // Выгрузка трассы файлом (#4718): её прикладывают к issue целиком — на экране показан хвост.
    el('di-debug-download').addEventListener('click', function () {
        var blob = new Blob([JSON.stringify(state.trace.toJSON(), null, 2)],
                            { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = debugFileName();
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 0);
        status('Файл отладки выгружен: ' + a.download, 'ok');
    });

    el('di-debug-copy').addEventListener('click', function () {
        var ta = el('di-debug-text');
        ta.select();
        try { document.execCommand('copy'); status('Трасса скопирована.', 'ok'); }
        catch (e) { status('Скопируйте текст трассы вручную.', 'err'); }
    });

    el('di-create').addEventListener('click', function () {
        if (!state.model) return;
        var btn = el('di-create');
        btn.disabled = true;
        status('Читаю схему базы…');
        var schema, dashId, sheetIds = {}, dicts = {}, dictCounts = {};
        api2('metadata?JSON').then(function (meta) {
            schema = resolveSchema(meta);
            state.trace.add('схема базы', {
                dashboard: schema.dashboard, sheet: schema.sheet, panel: schema.panel,
                row: schema.row, rg: schema.rg, values: schema.values,
                dicts: schema.dicts, req: schema.req, missing: schema.missing,
                dictProblems: schema.dictProblems
            });
            renderDebug();
            if (schema.missing.length) throw new Error('в базе нет таблиц модели: ' + schema.missing.join(', '));
            // СПРАВОЧНИКИ ЗАПОЛНЯЮТСЯ ДО МОДЕЛИ И ВСЕ ОДИНАКОВО. Раньше каждый шёл своим путём и
            // каждый умел отвалиться молча: «Год» не заполнялся вовсе (#4718), «Тип RG» и
            // «Строка бюджета» на пустой ответ подставляли `{}` — панель оставалась без колонок,
            // числа не писались, а экран рапортовал «Готово». Недостачу называем здесь, пока в
            // базе ещё ничего не создано.
            if (schema.dictProblems.length)
                throw new Error('справочники модели: ' + schema.dictProblems.join('; '));
            status('Проверяю справочники…');
            var specs = dictSpecs(schema, state.model, 3);
            var chain = Promise.resolve();
            specs.forEach(function (spec) {
                chain = chain.then(function () {
                    return api2('object/' + spec.table + '/?JSON_OBJ&LIMIT=0,5000');
                }).then(function (rows) {
                    var plan = dictPlan(spec.needed, rows,
                                        { keyCol: spec.keyCol, keyReq: spec.keyReq });
                    dicts[spec.key] = plan.index;
                    dictCounts[spec.name] = { было: (rows || []).length,
                                              создаём: plan.create.length,
                                              дописываем_код: plan.patch.length };
                    state.trace.add('справочник «' + spec.name + '»', {
                        table: spec.table, было: (rows || []).length,
                        создаём: plan.create.map(function (r) { return r.key || r.name; }),
                        дописываем_код: plan.patch.map(function (r) { return r.name + '→' + r.key; })
                    });
                    // Записи справочника друг от друга не зависят — пишем пулом (#4716).
                    // Барьер между правками и созданием не нужен: правка трогает найденную
                    // запись, создание заводит новую, пересечений нет.
                    return Batch.runWithConcurrency(
                        plan.patch.map(function (p) {
                            return function () { return setObj(p.id, p.fields); };
                        }).concat(plan.create.map(function (rec) {
                            return function () {
                                return createObj(spec.table, null, rec.name, rec.fields)
                                    .then(function (id) { plan.index[rec.key || rec.name] = id; });
                            };
                        })), 5);
                });
            });
            return chain;
        }).then(function () {
            // Модель с таким именем уже есть? Тогда дописываем в неё (#4704).
            return api2('object/' + schema.dashboard + '/?JSON_OBJ&LIMIT=0,500');
        }).then(function (list) {
            // ГРАНИЦЫ [С; По] ОБЯЗАТЕЛЬНЫ (#4720): без них отбор периодов не выполняется, и модель
            // открывается без колонок. Берём их из годов файла — 01.01.<первый> … 31.12.<последний>.
            function dashFields(periodId) {
                var f = makeField(schema.req.dashPeriod, periodId);
                var range = modelDateRange(state.model.years);
                if (range && schema.req.dashFrom) f[schema.req.dashFrom] = range.from;
                if (range && schema.req.dashTo) f[schema.req.dashTo] = range.to;
                return f;
            }
            // ВИД ОСИ ПИШЕТСЯ ID ЗАПИСИ СПРАВОЧНИКА, А НЕ ЕЁ ИМЕНЕМ. `_m_new` имя ещё резолвит,
            // `_m_set` приводит значение к `(int)` — имя там превращается в 0 и СТИРАЕТ ссылку.
            var periodId = dicts.period[schema.periodName];
            if (!periodId)
                throw new Error('в справочнике «Период» нет записи «' + schema.periodName +
                                '» — модели нечем задать ось, колонок не будет');
            var found = (list || []).filter(function (r) {
                return String(r.r && r.r[0]).trim() === state.model.name; })[0];
            if (found) {
                dashId = String(found.i);
                status('Модель найдена — дописываю листы…');
                // У найденной модели период мог остаться пустым (её создавали прежней версией
                // конвертора или руками) — проставляем; запись того же id ничего не меняет.
                return setObj(dashId, dashFields(periodId));
            }
            status('Создаю модель…');
            return createObj(schema.dashboard, null, state.model.name, dashFields(periodId))
                .then(function (id) { dashId = id; });
        }).then(function () {
            // Листы: одноимённый переиспользуем, новый создаём.
            return api2(childListPath(schema.sheet, dashId)).then(function (list) {
                (list || []).forEach(function (r) { sheetIds[String(r.r && r.r[0]).trim()] = String(r.i); });
            }).catch(function () { /* подчинённых ещё нет */ });
        }).then(function () {
            // Справочники уже приведены в порядок общим проходом: «Тип RG» — по КОДУ (#4709),
            // «Строка бюджета» — по имени строки (#4709), недостающие записи созданы.
            var ctx = { rgTypes: dicts.rgTypes, budget: dicts.budget };
            // Уже записанные значения — чтобы повторный залив того же файла не задваивал числа.
            if (!schema.values) { ctx.seenValues = {}; return ctx; }
            return api2('object/' + schema.values + '/?JSON_OBJ&LIMIT=0,5000').then(function (list) {
                var seen = {};
                (list || []).forEach(function (r) {
                    var row = String((r.r && r.r[2]) || '').split(':').slice(1).join(':').trim();
                    var year = String((r.r && r.r[1]) || '').slice(-4);
                    var label = String((r.r && r.r[6]) || '').trim();
                    if (row && year) seen[valueKey(row, year, label)] = true;
                });
                ctx.seenValues = seen;
                return ctx;
            }).catch(function () { ctx.seenValues = {}; return ctx; });
        }).then(function (ctx) {
            var chain = Promise.resolve();
            var created = { sheets: 0, panels: 0, rows: 0, rgs: 0, values: 0, budget: 0, skipped: 0 };
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
                            // Колонки панели: повтор по периодам, плюс сумма строки при колонке
                            // «Итог». Типы взяты из общего прохода по справочникам, поэтому
                            // «нет кода rg» здесь уже невозможно — раньше в этом месте панель
                            // молча оставалась без единой колонки.
                            var rgChain = Promise.resolve().then(function () {
                                created.rgs++;
                                var f = {}; f[schema.req.rgType] = ctx.rgTypes.rg;
                                return createObj(schema.rg, panelId, '', f);
                            });
                            if (panel.totalCol != null) {
                                rgChain = rgChain.then(function () {
                                    created.rgs++;
                                    var f2 = {}; f2[schema.req.rgType] = ctx.rgTypes.line;
                                    return createObj(schema.rg, panelId, '', f2);
                                });
                            }
                            // Строки панели друг от друга не зависят — пишем пулом (#4716),
                            // а значения строки не зависят и от самой записи строки: они
                            // ссылаются на «Строку бюджета», которая уже заведена.
                            return rgChain.then(function () {
                                return Batch.runWithConcurrency(panel.rows.map(function (row) {
                                    return function () {
                                        created.rows++;
                                        var f = {};
                                        if (schema.req.rowFormula && row.formula) f[schema.req.rowFormula] = row.formula;
                                        // «Метка» — КОМПАНИЯ (подпись модели и ключ, по которому
                                        // значение находит строку), а не название блока (#4720).
                                        if (schema.req.rowLabel) f[schema.req.rowLabel] = state.model.name;
                                        // Имя строки заведено общим проходом по справочникам;
                                        // если его всё же нет — это молчаливая потеря чисел,
                                        // поэтому падаем ДО записи самой строки.
                                        if (!ctx.budget[row.name])
                                            throw new Error('в справочнике «Строка бюджета» нет записи «' +
                                                row.name + '» — числа этой строки записать некуда');
                                        var rowOp = createObj(schema.row, panelId, row.name, f);
                                        var valueOps = Object.keys(row.values).map(function (year) {
                                            var key = valueKey(row.name, year, state.model.name);
                                            if (ctx.seenValues[key]) { created.skipped++; return null; }
                                            ctx.seenValues[key] = true;
                                            return function () {
                                                created.values++;
                                                var vf = {};
                                                if (schema.req.valDate) vf[schema.req.valDate] = valueDateForYear(year);
                                                if (schema.req.valRow) vf[schema.req.valRow] = ctx.budget[row.name];
                                                if (schema.req.valLabel) vf[schema.req.valLabel] = state.model.name;
                                                return createObj(schema.values, null, row.values[year], vf);
                                            };
                                        }).filter(Boolean);
                                        return Promise.all([rowOp, Batch.runWithConcurrency(valueOps, 5)]);
                                    };
                                }), 5);
                            });
                        });
                    });
                    return inner;
                });
            });
            return chain.then(function () { return created; });
        }).then(function (created) {
            ['sheets', 'panels', 'rows', 'rgs', 'values', 'skipped'].forEach(function (k) {
                state.trace.count(k, created[k]); });
            var createdYears = (dictCounts[schema.periodName] || {}).создаём || 0;
            state.trace.count('years', createdYears);
            state.trace.add('готово', { dashboard: dashId, created: created,
                                        справочники: dictCounts });
            renderDebug();
            status('Готово: годов ' + createdYears + ', листов ' + created.sheets +
                   ', панелей ' + created.panels +
                   ', строк ' + created.rows + ', колонок (RG) ' + created.rgs +
                   ', значений ' + created.values +
                   (created.skipped ? ' (уже были: ' + created.skipped + ')' : '') +
                   '. Модель: ' + state.model.name +
                   ' (dash/' + dashId + ').', 'ok');
            el('di-target').innerHTML = '<a href="/' + DB + '/dash/' + dashId + '" target="_blank">Открыть модель</a>';
            btn.disabled = false;
        }).catch(function (e) {
            state.trace.error('запись прервана', { message: e.message });
            renderDebug();
            status('Запись прервана: ' + e.message +
                   '. Что успело создаться — осталось в базе; выгрузите отладку и приложите к issue.', 'err');
            btn.disabled = false;
        });
    });
})();
