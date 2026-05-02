(function() {

const repRegex  = /^\[([A-Za-яЁё][A-Za-яЁё0-9 ]*)(\.[A-Za-яЁё][A-Za-яЁё0-9 ]*)(\.[A-Za-яЁё][A-Za-яЁё0-9 ]*)?\]$/
    , itemRegex = /^\[([A-Za-яЁё][ A-Za-яЁё0-9\(\)-]*)\]$/
    , exprRegex = /(СУММА)\(\[(.*?)\]:\[(.*?)\]\)/g
    , itemIdRegex = /\[\d+\]/g;
const DASH_MATRIX_TYPE_ID = '155551'
    , DASH_MATRIX_DATE_FIELD_ID = '155552'
    , DASH_MATRIX_LINE_FIELD_ID = '155553'
    , DASH_MATRIX_COL_FIELD_ID = '155554';

let dashTraceEnabled = false;
try {
    var dashTraceParams = new URLSearchParams(window.location.search);
    dashTraceEnabled = dashTraceParams.has('DEBUG') || dashTraceParams.has('debug');
} catch (e) {}

function dashTrace(stage, data) {
    if (!dashTraceEnabled && !(typeof window !== 'undefined' && window.DASH_DEBUG)) return;
    console.log('[Dash Trace] ' + stage, data);
}

// Returns { src, extra } for a cell based on row formula and base type ('rg' or 'value').
// src   — data-src value; extra — optional extra HTML attribute string (data-formula="...")
function dashCellSrc(rowId, baseType) {
    var f = dashFormulas[rowId];
    if (!f || f === '[]') return { src: baseType, extra: '' };
    if (itemRegex.test(f) || repRegex.test(f)) return { src: 'report', extra: '' };
    return { src: baseType + '-formula', extra: ' data-formula="' + f.replace(/"/g, '&quot;') + '"' };
}

let dashCurrentId = null, dashRecordId = null, dashDateFr = null, dashDateTo = null, dashPeriodVal = 'Месяц';

function dashToInputDate(s) {
    if (!s) return '';
    var p = s.split('.');
    return p.length === 3 ? p[2] + '-' + String(p[1]).padStart(2,'0') + '-' + String(p[0]).padStart(2,'0') : '';
}
function dashFromInputDate(s) {
    if (!s) return '';
    var p = s.split('-');
    return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : '';
}
function dashInitFilterBar(sheetEl) {
    var y = new Date().getFullYear();
    sheetEl.querySelector('.dash-fr-input').value = dashToInputDate(dashDateFr || '01.01.' + y);
    sheetEl.querySelector('.dash-to-input').value = dashToInputDate(dashDateTo || '31.12.' + y);
    sheetEl.querySelector('.dash-period-sel').value = dashPeriodVal;
}

const sheetTabTpl = '<li class="nav-item"><a id=":id:" class="nav-link dash-sheet-tab" onclick="dashSetActive(this)">:name:</a></li>'
    , dashIsAdmin = (typeof role !== 'undefined' && role === 'admin')
    , sheetTpl    = '<div id="ds:id:" class="f-sheet" style="display:none"><div class="dash-filter-bar">'
        + '<input type="date" class="dash-fr-input"><span class="dash-filter-sep">—</span><input type="date" class="dash-to-input">'
        + '<select class="dash-period-sel"><option value="Неделя">Неделя</option><option value="Месяц">Месяц</option><option value="Год">Год</option></select>'
        + '<button class="dash-apply-btn" onclick="dashApplyFilter(this.closest(\'.f-sheet\'))">Применить</button>'
        + '<input type="text" class="dash-search-input" placeholder="Поиск..." oninput="dashApplySearch(this.value,this.closest(\'.f-sheet\'))">'
        + (dashIsAdmin ? '<a class="dash-settings-icon" onclick="dashOpenSettings()" title="Настройки дэшборда"><i class="pi pi-cog"></i></a>' : '')
        + '</div></div>'
    , panelTpl    = '<div id=":id:" f-period=":period:" class="f-panel pt-3" data-panel-id=":panelid:">'
        + '<div class="f-panel-header">'
        + '<div class="f-panel-viz-icons"></div>'
        + '<h4>:name:</h4>'
        + (dashIsAdmin ? '<a class="f-panel-settings-icon" title="Настройки отображения"><i class="pi pi-chart-bar"></i></a>' : '')
        + '</div>'
        + '<div class="f-panel-content">'
        + '<div class="f-table-wrap"><table class="table table-sm table-bordered w-auto"><thead><tr class="dash-head f-head"><th>:head:</thead><tbody></tbody></table></div>'
        + '<div class="f-chart-wrap" style="display:none"><canvas class="f-chart-canvas"></canvas></div>'
        + '<div class="f-pivot-wrap" style="display:none"></div>'
        + '</div>'
        + '</div>'
    , headTpl     = '<th range=":from:-:to:">:head:'
    , itemTpl     = '<tr class="dash-item f-item" id=":id:" item-name=":name:"><td class="dash-first-cell f-first-cell" style="padding-left::pl:.2rem"><div class="show-id"><span onclick="dashCopy2Buffer(:id:)">:id:</span>'
        + ' <a href="/' + db + '/table/Строка?F_I=:id:" target="edit-item">'
        + '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-top:-4px;">'
        + '<path d="M17.2857 13.09V17.2857C17.2857 17.7025 17.1201 18.1022 16.8254 18.3969C16.5307 18.6916 16.1311 18.8572 15.7143 18.8572H4.71428C4.29751 18.8572 3.89781 18.6916 3.60311 18.3969C3.30841 18.1022 3.14285 17.7025 3.14285 17.2857V6.28574C3.14285 5.86897 3.30841 5.46927 3.60311 5.17457C3.89781 4.87987 4.29751 4.71431 4.71428 4.71431H8.91M15.7143 3.14288L18.8571 6.28574L11 14.1429H7.85714V11L15.7143 3.14288Z" stroke="lightgray" stroke-linecap="round" stroke-linejoin="round"></path>'
        + '</svg></a></div>'
        + ':name:'
    , cellTpl     = '<td range=":from:-:to:" ready=":ready:" class="f-cell :classes:" align="right" title=":title:" data-src=":src:" data-item-id=":item-id:":extra:>:val:';

let dashModelData = {}, dashPeriodData = {}, dashPeriods = {}, dashValues = {}, dashFormulas = {}, dashItems = {}, dashReports = {}, dashReportNames = {}, dashReportKeys = {}, dashReportSources = {}, dashAjaxes = 0;
let dashValueItemIds = {}; // item name -> valueItemID from ЗначенияЗаПериод
let dashMatrixValues = [], dashMatrixValuesRequested = false, dashRgSourceIds = {};

function dashDateYMD(d) {
    return d.slice(6) + d.slice(3, 5) + d.slice(0, 2);
}

function dashAttr(v) {
    return String(v || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

function dashSetStatus(msg) {
    var el = document.getElementById('dash-status');
    if (el) el.textContent = msg;
}

function dashNormalizeNumberText(v) {
    if (v === null || v === undefined) return '';
    var raw = String(v).trim()
        , s, sign = '', lastComma, lastDot, lastSep, hasMixedSeparators
        , parts, groupedThousands, whole, fraction;
    if (!raw) return '';
    raw = raw.replace(/[\u2212\u2012\u2013\u2014]/g, '-');
    if (!/^[+-]?[\d\s\u00a0\u202f.,]+%?$/.test(raw)) return '';
    s = raw.replace(/%$/, '').replace(/[\s\u00a0\u202f]/g, '');
    if (s.charAt(0) === '+' || s.charAt(0) === '-') {
        sign = s.charAt(0);
        s = s.slice(1);
    }
    s = s.replace(/[^0-9.,]/g, '');
    if (!/[0-9]/.test(s)) return '';

    lastComma = s.lastIndexOf(',');
    lastDot = s.lastIndexOf('.');
    lastSep = Math.max(lastComma, lastDot);
    if (lastSep !== -1) {
        hasMixedSeparators = lastComma !== -1 && lastDot !== -1;
        if (hasMixedSeparators) {
            whole = s.slice(0, lastSep).replace(/[.,]/g, '') || '0';
            fraction = s.slice(lastSep + 1).replace(/[.,]/g, '');
            return sign + whole + (fraction ? '.' + fraction : '');
        }

        parts = s.split(s.charAt(lastSep));
        groupedThousands = parts.length > 1
            && parts.slice(1).every(function(part) { return part.length === 3; })
            && parts[0].length > 0
            && parts[0].length <= 3
            && parts[0] !== '0';
        if (!groupedThousands) {
            whole = parts.slice(0, -1).join('').replace(/[.,]/g, '') || '0';
            fraction = parts[parts.length - 1].replace(/[.,]/g, '');
            return sign + whole + (fraction ? '.' + fraction : '');
        }
        s = parts.join('');
    }
    return sign + s;
}

function dashGetFloat(v) {
    return parseFloat(dashNormalizeNumberText(v));
}

function dashNumberForFormula(v) {
    var n = dashNormalizeNumberText(v);
    return n === '' ? '0' : n;
}

function dashCellText(el) {
    return el && el.textContent !== undefined ? el.textContent : (el ? el.innerHTML : '');
}

function dashNormalizeVal(item, val) {
    var v = val || '', n;
    if (typeof val === 'object' && val !== null)
        v = val[0].val;
    n = dashNormalizeNumberText(v);
    return n === '' ? String(v) : n;
}

function dashNormalizeMatrixKey(v) {
    return String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function dashMatrixLabelScore(dashLabel, matrixLabel) {
    var d = dashNormalizeMatrixKey(dashLabel);
    var m = dashNormalizeMatrixKey(matrixLabel);
    if (!d && !m) return 1;
    if (!d || !m) return 0;
    if (d === m) return 1000 + d.length;
    if (d.indexOf(m) !== -1) return 500 + m.length;
    if (m.indexOf(d) !== -1) return 250 + d.length;
    return 0;
}

function dashMatrixLabelMatches(dashLabel, matrixLabel) {
    return dashMatrixLabelScore(dashLabel, matrixLabel) > 0;
}

function dashSumMatrixValues(rows) {
    var acc = 0, hasNumeric = false, vals = [], ids = [];
    rows.forEach(function(row) {
        var raw = row ? row.val : '';
        var n = dashGetFloat(raw);
        if (!isNaN(n)) {
            acc += n;
            hasNumeric = true;
        } else if (raw !== undefined && raw !== null && raw !== '') {
            vals.push(raw);
        }
        if (row && row.valID !== undefined && row.valID !== null && row.valID !== '')
            ids.push(String(row.valID));
    });
    return {
        val: hasNumeric ? dashNormalizeVal('', acc) : vals.join(', '),
        valID: ids.join(',')
    };
}

function dashFindMatrixValue(line, col, dashLabel) {
    var lineKey = dashNormalizeMatrixKey(line);
    var colKey = dashNormalizeMatrixKey(col);
    var bestRows = [], bestScore = 0;
    (dashMatrixValues || []).forEach(function(row) {
        if (dashNormalizeMatrixKey(row.line) !== lineKey) return;
        if (dashNormalizeMatrixKey(row.col) !== colKey) return;
        var score = dashMatrixLabelScore(dashLabel, row['Метка']);
        if (score > bestScore) {
            bestRows = [row];
            bestScore = score;
        } else if (score === bestScore && score > 0) {
            bestRows.push(row);
        }
    });
    if (!bestRows.length) return null;
    var result = Object.assign({}, bestRows[0], dashSumMatrixValues(bestRows));
    return result;
}

function dashHasRows(json) {
    if (!json) return false;
    if (Array.isArray(json)) return json.length > 0;
    if (typeof json === 'object') return Object.keys(json).length > 0;
    return false;
}

function dashNormalizePanelFilter(panelFilter) {
    return String(panelFilter || '').trim().replace(/^[?&]+/, '');
}

function dashReportKey(rep, panelFilter) {
    return JSON.stringify([String(rep || ''), dashNormalizePanelFilter(panelFilter)]);
}

function dashReportUrl(rep, fr, to, panelFilter) {
    var url = 'report/' + rep + '?JSON_KV&FR_Date=' + fr + '&TO_Date=' + to
        , filter = dashNormalizePanelFilter(panelFilter);
    if (filter) url += '&' + filter;
    return url;
}

function dashParseReportFormula(formula) {
    var rep = (formula || '').match(repRegex);
    if (!rep) return null;
    var field = rep[2].substr(1)
        , group = rep[3] ? rep[3].substr(1) : '';
    return {
        report: rep[1],
        field: field,
        group: group,
        fullField: group ? field + '.' + group : field
    };
}

function dashReportFieldName(row, field) {
    var k, fieldLower;
    if (!row || !field) return null;
    if (Object.prototype.hasOwnProperty.call(row, field)) return field;
    fieldLower = String(field).toLowerCase();
    for (k in row)
        if (String(k).toLowerCase() === fieldLower) return k;
    return null;
}

function dashReportHasField(reportRows, field) {
    var i;
    for (i in reportRows || [])
        if (dashReportFieldName(reportRows[i], field) !== null) return true;
    return false;
}

function dashReportSumField(reportRows, dateField, range, field) {
    var i, row, fieldName, n, acc = 0;
    for (i in reportRows || []) {
        row = reportRows[i];
        fieldName = dashReportFieldName(row, field);
        if (fieldName === null) continue;
        // If range[0] is empty (range="-"), include all data regardless of date (issue #1875)
        if (!range[0] || (row[dateField] >= range[0] && row[dateField] <= range[1])) {
            n = dashGetFloat(row[fieldName] || 0);
            if (!isNaN(n)) acc += n;
        }
    }
    return dashNormalizeVal(field, acc);
}

function dashNormalizeGroupName(groupName) {
    return String(groupName || '').trim().toLowerCase();
}

function dashSameGroupName(a, b) {
    return dashNormalizeGroupName(a) === dashNormalizeGroupName(b);
}

function dashIsDuplicateModelRow(previousRow, row) {
    if (!previousRow || !row || !row.itemID) return false;
    if (String(previousRow.panelID || '') !== String(row.panelID || '')) return false;
    if (String(previousRow.itemID || '') === String(row.itemID || '')) return false;
    return String(previousRow.item || '') === String(row.item || '')
        && String(previousRow.level || 1) === String(row.level || 1);
}

function dashRememberReportSource(rowId, formula, reportKey) {
    var i, sources, parsed;
    if (!rowId || !formula) return;
    parsed = dashParseReportFormula(formula);
    if (!parsed) return;
    sources = dashReportSources[rowId] || (dashReportSources[rowId] = []);
    for (i = 0; i < sources.length; i++) {
        if (sources[i].formula === formula && sources[i].reportKey === reportKey) return;
    }
    sources.push({ formula: formula, reportKey: reportKey });
}

function dashReportGroupMatches(groups, reportName) {
    var i;
    for (i = 0; i < (groups || []).length; i++)
        if (dashSameGroupName(groups[i], reportName)) return true;
    return false;
}

function dashCellRgColumn(td) {
    if (td.dataset && td.dataset.rgCol) return td.dataset.rgCol;
    var table = td.closest ? td.closest('table') : null;
    if (!table) return null;
    var subhead = table.querySelector('thead .f-subhead');
    if (!subhead) return null;
    var colIdx = Array.from(td.parentNode.cells).indexOf(td);
    var ths = Array.from(subhead.querySelectorAll('th'));
    var th = ths[colIdx];
    return (th && th.getAttribute('data-rg-col')) || null;
}

function dashCellReportGroup(td) {
    return dashCellRgColumn(td) || (td.dataset ? td.dataset.rgHead : '') || '';
}

function dashCollectReportGroups(cells) {
    var groups = [], seen = {};
    cells.forEach(function(cell) {
        var group = dashCellReportGroup(cell)
            , key = dashNormalizeGroupName(group);
        if (key && !seen[key]) {
            seen[key] = true;
            groups.push(group);
        }
    });
    return groups;
}

function dashResolveReportCellValue(reportRows, dateField, range, parsed, cellGroup, groups) {
    var groupCount = groups ? groups.length : 0
        , hasGroups = groupCount > 0
        , groupedField;

    if (!hasGroups) {
        if (parsed.group && dashReportHasField(reportRows, parsed.fullField))
            return dashReportSumField(reportRows, dateField, range, parsed.fullField);
        if (dashReportHasField(reportRows, parsed.field))
            return dashReportSumField(reportRows, dateField, range, parsed.field);
        return undefined;
    }

    if (!parsed.group) {
        if (dashReportHasField(reportRows, parsed.field))
            return dashReportSumField(reportRows, dateField, range, parsed.field);
        if (cellGroup) {
            groupedField = parsed.field + '.' + cellGroup;
            if (dashReportHasField(reportRows, groupedField))
                return dashReportSumField(reportRows, dateField, range, groupedField);
        }
        return undefined;
    }

    if (groupCount === 1) {
        if (dashReportHasField(reportRows, parsed.fullField))
            return dashReportSumField(reportRows, dateField, range, parsed.fullField);
        if (dashReportHasField(reportRows, parsed.field))
            return dashReportSumField(reportRows, dateField, range, parsed.field);
        return undefined;
    }

    if (!dashSameGroupName(cellGroup, parsed.group)) return undefined;
    if (dashReportHasField(reportRows, parsed.fullField))
        return dashReportSumField(reportRows, dateField, range, parsed.fullField);
    return undefined;
}

function dashFetchMatrixValues() {
    if (dashMatrixValuesRequested) return;
    dashMatrixValuesRequested = true;
    dashAjaxes++;
    newApi('GET', 'report/155564?JSON_KV', 'dashGetMatrixValues');
}

function dashGetVal(item, fr, to) {
    var i, acc = 0, valids = false, key = item ? item.toLowerCase() : item;
    if (!dashValues[key]) return;
    for (i in dashValues[key]) {
        if (!fr || (dashValues[key][i].date >= fr && dashValues[key][i].date <= to)) {
            valids = true;
            acc += dashGetFloat(dashValues[key][i].val);
        }
    }
    if (valids) return dashNormalizeVal(key, acc);
}

function dashGetColVal(item, col) {
    var i, acc = 0, valids = false, key = item ? item.toLowerCase() : item, colLower = col ? col.toLowerCase() : col;
    if (!dashValues[key]) return;
    for (i in dashValues[key]) {
        if ((dashValues[key][i].col || '').toLowerCase() === colLower) {
            valids = true;
            acc += dashGetFloat(dashValues[key][i].val);
        }
    }
    if (valids) return dashNormalizeVal(key, acc);
}

function dashResolveValueCell(rowId, groupName) {
    var formula = dashFormulas[rowId] || ''
        , itemName = dashItems[rowId] ? dashItems[rowId].name : ''
        , altName = formula.match(itemRegex)
        , valueName = altName ? altName[1] : itemName
        , groupedKey = groupName ? valueName + ':' + groupName : ''
        , rowValue = dashValues[rowId]
        , groupedValue = groupedKey ? dashGetVal(groupedKey) : undefined
        , plainValue = dashGetVal(valueName)
        , value = rowValue || groupedValue || plainValue;

    dashTrace('value-cell-resolve', {
        rowId: rowId,
        itemName: itemName,
        groupName: groupName,
        formula: formula,
        valueName: valueName,
        groupedKey: groupedKey,
        hasRowValue: rowValue !== undefined,
        groupedValue: groupedValue,
        plainValue: plainValue,
        resolvedValue: value
    });

    return {
        value: value,
        alias: !!altName,
        source: rowValue !== undefined ? 'row' : (groupedValue !== undefined ? 'group' : (plainValue !== undefined ? 'plain' : 'empty'))
    };
}

function dashCalcLineTotals() {
    document.querySelectorAll('#dash-model .f-line-sum').forEach(function(el) {
        var valids = false, v = 0;
        el.title = 'Сумма значений строки';
        el.closest('tr').querySelectorAll('.f-rg-cell').forEach(function(cell) {
            var n = dashGetFloat(dashCellText(cell));
            if (!isNaN(n)) { valids = true; v += n; }
        });
        if (valids) el.innerHTML = v;
    });
}

function dashReplaceItems(match, key) {
    if (dashItems[key]) return '[' + dashItems[key].name + ']';
    return '(Not found ' + key + ')';
}

function dashEvalFormula(el, f) {
    var val;
    try {
        val = parseFloat(eval(f)); // eslint-disable-line no-eval
        if (isNaN(val)) return false;
    } catch (e) {
        val = 'N/A';
        console.log(e + ': ' + f);
    }
    el.innerHTML = val;
    el.setAttribute('ready', '1');
    return true;
}

function dashCalcCells() {
    var val, progress = true, todo = true, j = 0;
    while (progress && todo && j++ < 100) {
        progress = false;
        todo = false;
        document.querySelectorAll('#dash-model td[ready="0"]').forEach(function(el) {
            todo = true;
            var i, refs, itemEl = el.closest('tr'), itemId = itemEl ? itemEl.id : null
                , f = itemId ? dashFormulas[itemId] : null;
            if (!f) return;
            el.title = f;
            refs = f.match(itemIdRegex);
            if (refs) {
                refs = [...new Set(refs.map(function(s) { return s.replace(/[\[\]]/g, ''); }))];
                for (i in refs) {
                    // Try exact range match first; if not found and range="-", accept any range (issue #1877)
                    var rangeVal = el.getAttribute('range');
                    // Use getElementById to avoid invalid CSS selectors when IDs start with digits (issue #2074)
                    var refEl = document.getElementById(refs[i]);
                    var cells = refEl ? refEl.querySelectorAll('.f-rg-cell[range="' + rangeVal + '"],.f-col-cell[range="' + rangeVal + '"]') : [];
                    var fallbackUsed = false;
                    if (cells.length === 0 && rangeVal === '-') {
                        // If no exact match and looking for "-", accept any range
                        cells = refEl ? refEl.querySelectorAll('.f-rg-cell,.f-col-cell') : [];
                        fallbackUsed = true;
                    }
                    dashTrace('formula-ref-lookup', {
                        itemId: itemId,
                        refId: refs[i],
                        range: rangeVal,
                        matches: cells.length,
                        fallbackUsed: fallbackUsed,
                        formulaBeforeReplace: f
                    });
                    cells.forEach(function(rc) {
                        if (rc.getAttribute('ready') === '1')
                            f = f.replace(new RegExp('\\[' + refs[i] + '\\]'), dashNumberForFormula(dashCellText(rc)));
                    });
                    // Use getElementById to avoid invalid CSS selectors when IDs start with digits (issue #2074)
                    (refEl ? refEl.querySelectorAll('.f-values') : []).forEach(function(fv) {
                        if (fv.getAttribute('ready') === '1')
                            f = f.replace(new RegExp('\\[' + refs[i] + '\\]'), dashNumberForFormula(dashCellText(fv)));
                    });
                }
                refs = f.match(itemIdRegex);
                if (!refs) progress = dashEvalFormula(el, f);
                el.title = el.title.replace(/\[(\d+)\]/g, dashReplaceItems) + '=' + f;
            } else {
                progress = dashEvalFormula(el, f);
            }
        });
        dashCalcLineTotals();
    }
    document.querySelectorAll('#dash-model td[ready="0"]:not(.f-rg-formula-cell)').forEach(function(el) {
        el.classList.add('dash-err');
    });
}

function dashCalcRGFormulas() {
    var progress = true, j = 0;
    while (progress && j++ < 100) {
        progress = false;
        document.querySelectorAll('#dash-model td.f-rg-formula-cell[ready="0"]').forEach(function(el) {
            var rgf = el.getAttribute('data-rg-formula');
            if (!rgf) return;
            var row = el.closest('tr');
            if (!row) return;
            // Collect all cells in this row (td elements)
            var cells = Array.from(row.querySelectorAll('td'));
            var myIdx = cells.indexOf(el);

            // Build a map: column header name -> cell index (for named refs)
            var table = row.closest('table');
            var colNameMap = {};
            if (table) {
                // Prefer sub-header row (RGcolumns column names); fall back to main header
                var subhead = table.querySelector('thead .f-subhead');
                var headRow = table.querySelector('thead .dash-head');
                var refRow = subhead || headRow;
                if (refRow) {
                    Array.from(refRow.querySelectorAll('th')).forEach(function(th, thIdx) {
                        var name = (th.getAttribute('data-rg-col') || th.textContent || '').trim();
                        if (name) colNameMap[name] = thIdx;
                    });
                }
            }

            var expr = rgf;
            var allReady = true;

            // Replace named refs [colName]
            expr = expr.replace(/\[([^\]]+)\]/g, function(match, ref) {
                // Check if numeric offset
                var num = parseInt(ref, 10);
                if (!isNaN(num) && String(num) === ref.trim()) {
                    // numeric relative ref
                    var targetIdx = myIdx + num;
                    if (targetIdx < 0 || targetIdx >= cells.length) return '0';
                    var tc = cells[targetIdx];
                    if (!tc || tc.getAttribute('ready') !== '1') { allReady = false; return match; }
                    return dashNumberForFormula(dashCellText(tc));
                }
                // Named ref: find column index by name
                var colIdx = colNameMap[ref.trim()];
                if (colIdx === undefined) {
                    // fallback: search all cells in row for a column with that header
                    return '0';
                }
                var tc = cells[colIdx];
                if (!tc || tc.getAttribute('ready') !== '1') { allReady = false; return match; }
                return dashNumberForFormula(dashCellText(tc));
            });

            if (!allReady) return; // wait for deps

            // Evaluate
            var val;
            try {
                val = eval(expr); // eslint-disable-line no-eval
            } catch (e) {
                val = 'N/A';
                console.log('RGformula eval error: ' + e + ' in: ' + expr);
            }
            var valStr = val !== null && val !== undefined ? String(val) : '';
            el.innerHTML = valStr;
            el.title = rgf + ' => ' + expr + ' = ' + valStr;
            el.setAttribute('ready', '1');
            progress = true;
        });
    }
    // Mark still-pending cells as errors and show the formula in title for debugging
    document.querySelectorAll('#dash-model td.f-rg-formula-cell[ready="0"]').forEach(function(el) {
        el.classList.add('dash-err');
        var rgf = el.getAttribute('data-rg-formula');
        if (rgf && el.title === rgf) el.title = rgf + ' (не удалось вычислить)';
    });
}

function dashGetRepVals() {
    var reportKey, reportRows, rep, i, parsed, date, rowIds = {}, sources, source, sourceIdx
        , reportSources = (typeof dashReportSources !== 'undefined') ? dashReportSources : {};
    for (reportKey in dashReports) {
        reportRows = dashReports[reportKey];
        if (!reportRows || !reportRows[0]) continue;
        date = '';
        for (i in reportRows[0]) { date = i; break; }
        rep = dashReportNames[reportKey] || reportKey;
        rowIds = {};
        for (i in dashFormulas) rowIds[i] = true;
        for (i in reportSources) rowIds[i] = true;
        for (i in rowIds) {
            sources = (reportSources[i] && reportSources[i].length)
                ? reportSources[i]
                : [{ formula: dashFormulas[i], reportKey: dashReportKeys[i] }];
            for (sourceIdx = 0; sourceIdx < sources.length; sourceIdx++) {
                source = sources[sourceIdx] || {};
                parsed = dashParseReportFormula(source.formula || dashFormulas[i]);
                if (!parsed) continue;
                if (source.reportKey || dashReportKeys[i]) {
                    if ((source.reportKey || dashReportKeys[i]) !== reportKey) continue;
                } else if (parsed.report !== rep) {
                    continue;
                }
                // Use getElementById to avoid invalid CSS selectors when IDs start with digits (issue #2074)
                var iEl = document.getElementById(i);
                var cells = iEl ? Array.from(iEl.querySelectorAll('.f-rg-cell[data-src="report"],.f-values[data-src="report"]')) : [];
                if (!cells.length && iEl)
                    cells = Array.from(iEl.querySelectorAll('.f-rg-cell')).filter(function(cell) {
                        return !cell.dataset || !cell.dataset.src || cell.dataset.src === 'report';
                    });
                var groups = dashCollectReportGroups(cells)
                    , restrictToReportGroup = sources.length > 1 && !parsed.group && dashReportGroupMatches(groups, parsed.report);
                cells.forEach(function(el) {
                    var range = String(el.getAttribute('range') || '-').split('-')
                        , group = dashCellReportGroup(el)
                        , val;
                    if (restrictToReportGroup && !dashSameGroupName(group, parsed.report)) return;
                    val = dashResolveReportCellValue(reportRows, date, range, parsed, group, groups);
                    if (val !== undefined) {
                        el.innerHTML = val;
                        el.setAttribute('ready', '1');
                    }
                });
            }
        }
    }
}

function dashDrawPeriods() {
    var i, rg, j;
    if (dashAjaxes > 0) return;
    dashSetStatus('Отрисовка данных...');
    document.querySelectorAll('#dash-model .f-panel').forEach(function(panel) {
        var panelId = panel.id;
        var p = dashPeriodData[panel.getAttribute('f-period')];
        for (rg in dashModelData[panelId].rgs) {
            var v, rep, fr, to, col;
            switch (dashModelData[panelId].rgs[rg].type) {
                case 'rg':
                    var rgCols = (dashModelData[panelId].rgs[rg].columns || '')
                        .split(',').map(function(c) { return c.trim(); }).filter(Boolean);
                    for (i in p) {
                        if (!p[i] || !p[i].r) continue;
                        fr = dashDateYMD(p[i].r[1]);
                        to = dashDateYMD(p[i].r[2]);
                        if (rgCols.length > 0) {
                            // Period header with colspan spanning all column groups
                            panel.querySelector('.f-head').insertAdjacentHTML('beforeend',
                                '<th colspan="' + rgCols.length + '" range="' + fr + '-' + to + '">' + p[i].r[0] + '</th>');
                            // Ensure sub-header row exists (first time only per panel)
                            var thead = panel.querySelector('thead');
                            var subhead = thead.querySelector('.f-subhead');
                            if (!subhead) {
                                subhead = document.createElement('tr');
                                subhead.className = 'f-subhead';
                                subhead.innerHTML = '<th></th>'; // spacer for item-name column
                                thead.appendChild(subhead);
                            }
                            // Add one th per column group under this period
                            rgCols.forEach(function(colName) {
                                subhead.insertAdjacentHTML('beforeend',
                                    '<th range="' + fr + '-' + to + '" data-rg-col="' + colName + '">' + colName + '</th>');
                            });
                            // Add cells: for each item row, one cell per column group
                            panel.querySelectorAll('.f-item').forEach(function(row) {
                                var itemName = row.getAttribute('item-name');
                                var s = dashCellSrc(row.id, 'rg');
                                var valueItemId = dashValueItemIds[(itemName || '').toLowerCase()] || '';
                                var rgHeadVal = dashModelData[panelId].rgs[rg].head || '';
                                rgCols.forEach(function(colName) {
                                    v = dashGetVal(itemName + ':' + colName, fr, to);
                                    if (v === undefined && dashFormulas[row.id]) {
                                        if (dashFormulas[row.id] === '[]')
                                            v = dashGetVal(itemName, fr, to);
                                        else if (itemRegex.test(dashFormulas[row.id]))
                                            v = dashGetVal(dashFormulas[row.id].match(itemRegex)[1] + ':' + colName, fr, to)
                                             || dashGetVal(dashFormulas[row.id].match(itemRegex)[1], fr, to) || '0';
                                    }
                                    var cellExtra = s.extra
                                        + (valueItemId ? ' data-value-item-id="' + valueItemId + '"' : '')
                                        + (rgHeadVal ? ' data-rg-head="' + rgHeadVal.replace(/"/g, '&quot;') + '"' : '')
                                        + ' data-rg-col="' + colName.replace(/"/g, '&quot;') + '"';
                                    row.insertAdjacentHTML('beforeend',
                                        cellTpl.replace(':val:', v || '')
                                            .replace(':ready:', '1')
                                            .replace(':title:', v || '')
                                            .replace(':classes:', 'f-rg-cell')
                                            .replace(':src:', s.src)
                                            .replace(':item-id:', row.id)
                                            .replace(':extra:', cellExtra)
                                            .replace(':from:', fr)
                                            .replace(':to:', to));
                                });
                            });
                        } else {
                            // No RGcolumns — original single-column behaviour
                            panel.querySelector('.f-head').insertAdjacentHTML('beforeend',
                                headTpl.replace(':head:', p[i].r[0]).replace(':from:', fr).replace(':to:', to));
                            panel.querySelectorAll('.f-item').forEach(function(row) {
                                var s = dashCellSrc(row.id, 'rg');
                                var itemName = row.getAttribute('item-name');
                                var valueItemId = dashValueItemIds[(itemName || '').toLowerCase()] || '';
                                var rgHeadVal = dashModelData[panelId].rgs[rg].head || '';
                                v = dashGetVal(itemName, fr, to);
                                if (v === undefined && dashFormulas[row.id]) {
                                    if (dashFormulas[row.id] === '[]')
                                        v = dashGetVal(itemName, fr, to);
                                    else if (itemRegex.test(dashFormulas[row.id]))
                                        v = dashGetVal(dashFormulas[row.id].match(itemRegex)[1], fr, to) || '0';
                                }
                                var cellExtra = s.extra
                                    + (valueItemId ? ' data-value-item-id="' + valueItemId + '"' : '')
                                    + (rgHeadVal ? ' data-rg-head="' + rgHeadVal.replace(/"/g, '&quot;') + '"' : '');
                                row.insertAdjacentHTML('beforeend',
                                    cellTpl.replace(':val:', v || '')
                                        .replace(':ready:', v || dashFormulas[row.id] === '[]' || !dashFormulas[row.id] ? '1' : '0')
                                        .replace(':title:', v || dashFormulas[row.id] === '[]' || !dashFormulas[row.id] ? v || '' : '')
                                        .replace(':classes:', 'f-rg-cell')
                                        .replace(':src:', s.src)
                                        .replace(':item-id:', row.id)
                                        .replace(':extra:', cellExtra)
                                        .replace(':from:', fr)
                                        .replace(':to:', to));
                            });
                        }
                    }
                    break;
                case 'value':
                    var groupName = dashModelData[panelId].rgs[rg].head || '';
                    panel.querySelector('.f-head').insertAdjacentHTML('beforeend',
                        headTpl.replace(':head:', groupName || 'Значение')
                               .replace(':from:-:to:', '-'));
                    panel.querySelectorAll('.f-item').forEach(function(row) {
                        var s = dashCellSrc(row.id, 'value')
                            , resolved = dashResolveValueCell(row.id, groupName);
                        if (resolved.alias)
                            s = { src: 'value', extra: '' };
                        v = dashNormalizeVal(row.id, resolved.value);
                        var itemName = row.getAttribute('item-name');
                        var valueItemId = dashValueItemIds[(itemName || '').toLowerCase()] || '';
                        var rgHeadVal = groupName;
                        var cellExtra = s.extra
                            + (valueItemId ? ' data-value-item-id="' + valueItemId + '"' : '')
                            + (rgHeadVal ? ' data-rg-head="' + rgHeadVal.replace(/"/g, '&quot;') + '"' : '');
                        row.insertAdjacentHTML('beforeend',
                            cellTpl.replace(':val:', v || '')
                                .replace(':classes:', 'f-values')
                                .replace(':from:', '-').replace(':to:', '-')
                                .replace(':ready:', v || dashFormulas[row.id] === '[]' || !dashFormulas[row.id] ? '1' : '0')
                                .replace(':title:', dashFormulas[row.id] || '')
                                .replace(':src:', s.src)
                                .replace(':item-id:', row.id)
                                .replace(':extra:', cellExtra));
                    });
                    break;
                case 'formulas':
                    panel.querySelector('.f-head').insertAdjacentHTML('beforeend',
                        headTpl.replace(':head:', dashModelData[panelId].rgs[rg].head || '')
                               .replace(':from:-:to:', '-'));
                    panel.querySelectorAll('.f-item').forEach(function(row) {
                        var rgf = dashModelData[panelId].rgs[rg].rgFormulas || '';
                        row.insertAdjacentHTML('beforeend',
                            cellTpl.replace(':val:', '')
                                .replace(':classes:', 'f-rg-formula-cell')
                                .replace(':from:', '-').replace(':to:', '-')
                                .replace(':ready:', '0')
                                .replace(':title:', rgf)
                                .replace(':src:', 'rgformula')
                                .replace(':item-id:', row.id)
                                .replace(':extra:', rgf ? ' data-rg-formula="' + rgf.replace(/"/g, '&quot;') + '"' : ''));
                    });
                    break;
                case 'mu':
                    panel.querySelector('.f-head').insertAdjacentHTML('beforeend',
                        headTpl.replace(':head:', dashModelData[panelId].rgs[rg].head || 'Ед.изм.')
                               .replace(':from:-:to:', '-'));
                    panel.querySelectorAll('.f-item').forEach(function(row) {
                        row.insertAdjacentHTML('beforeend',
                            cellTpl.replace(':val:', dashItems[row.id] ? dashItems[row.id].mu || '' : '')
                                .replace(':classes:', 'f-mus')
                                .replace(':from:', '-').replace(':to:', '-')
                                .replace(':ready:', '1')
                                .replace(':title:', '')
                                .replace(':src:', 'mu')
                                .replace(':item-id:', row.id)
                                .replace(':extra:', ''));
                    });
                    break;
                case 'line':
                    panel.querySelector('.f-head').insertAdjacentHTML('beforeend',
                        headTpl.replace(':head:', dashModelData[panelId].rgs[rg].head || 'Сумма')
                               .replace(':from:-:to:', '-'));
                    panel.querySelectorAll('.f-item').forEach(function(row) {
                        row.insertAdjacentHTML('beforeend',
                            cellTpl.replace(':val:', '')
                                .replace(':classes:', 'f-line-sum')
                                .replace(':from:', '-').replace(':to:', '-')
                                .replace(':title:', 'Сумма')
                                .replace(':ready:', '1')
                                .replace(':src:', 'linesum')
                                .replace(':item-id:', row.id)
                                .replace(':extra:', ''));
                    });
                    break;
                default:
                    rep = dashModelData[panelId].rgs[rg].src;
                    if (rep) {
                        var useMatrix = dashRgSourceIds[rep] && dashMatrixValuesRequested;
                        for (i in dashPeriodData[rep])
                            for (j in dashPeriodData[rep][i]) {
                                if (col = dashPeriodData[rep][i][j]) {
                                    panel.querySelector('.f-head').insertAdjacentHTML('beforeend',
                                        headTpl.replace(':head:', col).replace(':from:-:to:', i));
                                    panel.querySelectorAll('.f-item').forEach(function(row) {
                                        var ready = 0, src = 'report', extra = '';
                                        var item = dashItems[row.id] || {};
                                        var itemName = item.name || '';
                                        if (useMatrix) {
                                            var matrixRow = dashFindMatrixValue(itemName, col, item.label || '');
                                            var matrixLabel = matrixRow ? (matrixRow['Метка'] || '') : (item.label || '');
                                            v = matrixRow ? matrixRow.val : '';
                                            ready = 1;
                                            src = 'matrix';
                                            extra = ' data-matrix-line="' + dashAttr(itemName) + '"'
                                                + ' data-matrix-col="' + dashAttr(col) + '"'
                                                + ' data-matrix-label="' + dashAttr(matrixLabel) + '"';
                                            if (matrixRow && matrixRow.valID)
                                                extra += ' data-matrix-val-id="' + dashAttr(matrixRow.valID) + '"';
                                            if (matrixRow && matrixRow.date)
                                                extra += ' data-matrix-date="' + dashAttr(matrixRow.date) + '"';
                                        } else {
                                            v = dashGetColVal(itemName, col);
                                            if (v || dashFormulas[row.id] === '[]') ready = 1;
                                        }
                                        row.insertAdjacentHTML('beforeend',
                                            cellTpl.replace(':val:', dashNormalizeVal(row.id, v || ''))
                                                .replace(':ready:', ready)
                                                .replace(':title:', '')
                                                .replace(':classes:', 'f-col-cell')
                                                .replace(':src:', src)
                                                .replace(':item-id:', row.id)
                                                .replace(':extra:', extra)
                                                .replace(':from:-:to:', i));
                                    });
                                }
                                break;
                            }
                    }
                    break;
            }
        }
    });
    dashGetRepVals();
    dashCalcCells();
    dashCalcRGFormulas();
    dashUpdateTableWrapOverflow();
    dashSetStatus('Готово');
    // Apply visualization settings after all data is loaded (final draw only)
    if (dashAjaxes === 0) {
        document.querySelectorAll('#dash-model .f-panel').forEach(function(panel) {
            var settings = (dashModelData[panel.id] || {}).settings;
            // Only render if not yet interacted (no active icon set by user)
            var icons = panel.querySelector('.f-panel-viz-icons');
            var hasUserSelection = icons && icons.querySelector('.f-viz-type-icon.active');
            if (settings && !hasUserSelection) dashPanelApplySettings(panel.id, settings, true);
        });
    }
    dashDebug();
}

function dashUpdateTableWrapOverflow() {
    // overflow-x: auto is set via CSS; no dynamic toggle needed.
}

function dashDebug() {
    var out = [];
    out.push('=== DASH DEBUG INFO ===');
    out.push('Timestamp: ' + new Date().toISOString());

    // Viewport and scroll info
    var navbar = document.querySelector('.navbar') || document.querySelector('nav') || document.querySelector('header');
    out.push('\n-- Layout info --');
    out.push('window.innerHeight: ' + window.innerHeight);
    out.push('document.scrollingElement.scrollTop: ' + (document.scrollingElement ? document.scrollingElement.scrollTop : 'n/a'));
    if (navbar) {
        var nr = navbar.getBoundingClientRect();
        out.push('navbar rect: top=' + nr.top + ' bottom=' + nr.bottom + ' height=' + nr.height);
    } else {
        out.push('navbar: not found');
    }

    // Panel structure
    out.push('\n-- Panels --');
    document.querySelectorAll('#dash-model .f-panel').forEach(function(panel) {
        out.push('\nPanel id=' + panel.id + ' period=' + panel.getAttribute('f-period'));
        var table = panel.querySelector('table');
        if (!table) { out.push('  table: NOT FOUND'); return; }
        var tr = table.getBoundingClientRect();
        out.push('  table rect: top=' + Math.round(tr.top) + ' height=' + Math.round(tr.height));
        var thead = table.querySelector('thead');
        var tbody = table.querySelector('tbody');
        out.push('  thead present: ' + !!thead);
        out.push('  tbody present: ' + !!tbody);
        if (thead) {
            var theadRows = thead.querySelectorAll('tr');
            out.push('  thead rows: ' + theadRows.length);
            theadRows.forEach(function(tr, idx) {
                var thr = tr.getBoundingClientRect();
                var cs = window.getComputedStyle(tr);
                out.push('  thead tr[' + idx + ']: cols=' + tr.querySelectorAll('th,td').length
                    + ' top=' + Math.round(thr.top) + ' height=' + Math.round(thr.height)
                    + ' position=' + cs.position + ' top-style=' + cs.top);
            });
        }
        if (tbody) {
            var tbodyRows = tbody.querySelectorAll('tr');
            out.push('  tbody rows: ' + tbodyRows.length);
            if (tbodyRows.length > 0) {
                var fbr = tbodyRows[0].getBoundingClientRect();
                out.push('  tbody first tr: top=' + Math.round(fbr.top) + ' height=' + Math.round(fbr.height));
            }
        }
        // Check for stray rows outside thead/tbody
        var strayRows = [];
        table.querySelectorAll(':scope > tr').forEach(function(r) { strayRows.push(r); });
        out.push('  stray rows (direct children of table): ' + strayRows.length);
    });

    // Raw HTML of first panel for inspection
    var firstPanel = document.querySelector('#dash-model .f-panel');
    if (firstPanel) {
        out.push('\n-- First panel outerHTML --');
        out.push(firstPanel.outerHTML.slice(0, 2000));
    }

    var msg = out.join('\n');
    console.log(msg);

    // Also show brief status
    var panelCount = document.querySelectorAll('#dash-model .f-panel').length;
    dashSetStatus('Готово | ' + panelCount + ' панелей (отладка в консоли)');
}

function dashGetPeriods(json, period) {
    dashPeriodData[period] = (json && typeof json === 'object') ? json : {};
    if (dashRgSourceIds[period] && dashHasRows(json))
        dashFetchMatrixValues();
    dashAjaxes--;
    dashDrawPeriods();
}

function dashGetMatrixValues(json) {
    dashMatrixValues = Array.isArray(json) ? json : [];
    dashAjaxes--;
    dashDrawPeriods();
}

function dashGetRepDone(json, ctx) {
    if (!json) return;
    var key = ctx && typeof ctx === 'object' ? ctx.key : ctx;
    dashReports[key] = json;
    dashAjaxes--;
    dashDrawPeriods();
}

function dashGetRep(rep, fr, to, panelFilter) {
    var key = dashReportKey(rep, panelFilter);
    dashReports[key] = {};
    dashReportNames[key] = rep;
    dashAjaxes++;
    newApi('GET', dashReportUrl(rep, fr, to, panelFilter), 'dashGetRepDone', '', { key: key });
    return key;
}

function dashGetSrc(json) {
    for (var i in json || []) {
        if (json[i].valueItemID) dashValueItemIds[(json[i].item || '').toLowerCase()] = json[i].valueItemID;
        if (json[i].value.length > 0) {
            try {
                var colGroup = (json[i]['Колонка группы'] || '').toLowerCase();
                var itemKey = (json[i].item || '').toLowerCase();
                var key = colGroup ? itemKey + ':' + colGroup : itemKey;
                var parsed = JSON.parse('[' + json[i].value + ']');
                dashValues[key] = parsed;
                dashTrace('source-value-parse', {
                    item: json[i].item,
                    colGroup: colGroup,
                    key: key,
                    count: parsed.length,
                    first: parsed[0]
                });
            } catch (e) {
                dashValues[(json[i].item || '').toLowerCase()] = 'error ' + e + ' in ' + json[i].value;
                dashTrace('source-value-parse-error', {
                    item: json[i].item,
                    error: String(e),
                    raw: json[i].value
                });
            }
        }
    }
    dashAjaxes--;
    dashDrawPeriods();
}

function dashGetRecord(json) {
    if (!json || json.error || !json.val) {
        dashSetStatus('Дэшборд не найден');
        return;
    }
    if (json.type !== 'Дэшборд') {
        dashSetStatus('Объект не является дэшбордом');
        return;
    }
    document.title = json.val;
    var navCenter = document.querySelector('.navbar-center .navbar-workspace');
    if (navCenter) navCenter.textContent = json.val;
    dashRecordId = json.id;
    dashSetStatus('Загрузка модели...');
    newApi('GET', 'report/Дэшборд?JSON_KV&FR_modelID=' + json.id + '&period=' + encodeURIComponent(dashPeriodVal), 'dashGetModel');
}

function dashGetModel(json) {
    if (!json || !json.length) {
        dashSetStatus('Дэшборд не найден');
        return;
    }
    var i, j, rep, fr, to, lastVisibleItemByPanel = {};
    dashSetStatus('Загрузка данных...');

    for (i in json) {
        dashPeriods[json[i].period] = 1;
        dashItems[json[i].itemID] = { name: json[i].item, format: json[i].format, mu: json[i].MU, label: json[i]['Метка'] || '' };
        if (json[i].RGsourceID && !dashPeriods[json[i].RGsourceID]) {
            dashRgSourceIds[json[i].RGsourceID] = 1;
            dashPeriods[json[i].RGsourceID] = 1;
            dashAjaxes++;
            newApi('GET', 'report/' + json[i].RGsourceID + '?JSON_KV&FR_Date=' + json[i].periodFrom + '&TO_Date=' + json[i].periodTo,
                'dashGetPeriods', '', json[i].RGsourceID);
        } else if (json[i].RGsourceID) {
            dashRgSourceIds[json[i].RGsourceID] = 1;
        }
    }

    fr = dashDateFr || json[i].periodFrom;
    to = dashDateTo || json[i].periodTo;

    dashAjaxes++;
    newApi('GET', 'report/Дэшборд.ЗначенияЗаПериод?JSON_KV&Fr=' + dashDateYMD(fr) + '&To=' + dashDateYMD(to), 'dashGetSrc');

    if (dashPeriods['Год']) {
        dashAjaxes++;
        newApi('GET', 'object/Год?JSON_DATA&LIMIT=10000&FR_С=>=' + fr + '&FR_По=<=' + to, 'dashGetPeriods', '', 'Год');
    }
    if (dashPeriods['Квартал']) {
        dashAjaxes++;
        newApi('GET', 'object/Квартал?JSON_DATA&LIMIT=10000&FR_С=>=' + fr + '&FR_По=<=' + to, 'dashGetPeriods', '', 'Квартал');
    }
    if (dashPeriods['Месяц']) {
        dashAjaxes++;
        newApi('GET', 'object/Месяц?JSON_DATA&LIMIT=10000&FR_С=>=' + fr + '&FR_По=<=' + to, 'dashGetPeriods', '', 'Месяц');
    }

    var model = document.getElementById('dash-model');

    for (i in json) {
        var panelKey = 'fp' + json[i].panelID
            , previousItem = lastVisibleItemByPanel[panelKey]
            , isDuplicateRow = dashIsDuplicateModelRow(previousItem, json[i])
            , itemTargetId = isDuplicateRow ? previousItem.itemID : json[i].itemID;
        // Add sheet tab
        if (!document.getElementById(json[i].sheetID)) {
            model.querySelector('.sheet-tabs').insertAdjacentHTML('beforeend',
                sheetTabTpl.replace(/:id:/g, json[i].sheetID).replace(':name:', json[i].sheet));
            model.querySelector('.sheets').insertAdjacentHTML('beforeend',
                sheetTpl.replace(/:id:/g, json[i].sheetID));
            dashInitFilterBar(document.getElementById('ds' + json[i].sheetID));
        }
        // Add panel to sheet (prefix 'fp' to avoid ID collision with item rows)
        if (!document.getElementById(panelKey)) {
            var panelSettingsStr = json[i].panelSettings || '';
            var panelSettings = null;
            try { if (panelSettingsStr) panelSettings = JSON.parse(panelSettingsStr); } catch(e) {}
            document.getElementById('ds' + json[i].sheetID).insertAdjacentHTML('beforeend',
                panelTpl.replace(/:id:/g, panelKey)
                    .replace(':head:', json[i].itemsHead || json[i].panel)
                    .replace(':period:', json[i].period)
                    .replace(':name:', json[i].panel)
                    .replace(':panelid:', json[i].panelID));
            dashModelData[panelKey] = { items: {}, rgs: {}, noDates: json[i].NoDates, settings: panelSettings, panelID: json[i].panelID };
            dashPanelApplySettings(panelKey, panelSettings, false);
        }
        if (json[i].NoDates !== undefined)
            dashModelData[panelKey].noDates = json[i].NoDates;
        // Add item row
        if (json[i].itemID && !isDuplicateRow && !document.getElementById(json[i].itemID)) {
            document.getElementById(panelKey).querySelector('table tbody').insertAdjacentHTML('beforeend',
                itemTpl.replace(/:id:/g, json[i].itemID)
                    .replace(':pl:', Math.max(0, (json[i].level || 1) - 1))
                    .replace(/:name:/g, json[i].item));
        }
        if (json[i].itemID && !isDuplicateRow) {
            lastVisibleItemByPanel[panelKey] = {
                panelID: json[i].panelID,
                itemID: json[i].itemID,
                item: json[i].item,
                level: json[i].level || 1
            };
        }
        // Remember RG metadata; accumulate column names across rows (each row may carry one column)
        if (!dashModelData[panelKey].rgs[json[i].RG])
            dashModelData[panelKey].rgs[json[i].RG] = { type: json[i].RGtype, head: json[i].rgHead, src: json[i].RGsourceID, columns: json[i].RGcolumns || '', rgFormulas: json[i].RGformulas || '' };
        else if (json[i].RGcolumns) {
            var existingCols = dashModelData[panelKey].rgs[json[i].RG].columns
                .split(',').map(function(c) { return c.trim(); }).filter(Boolean);
            json[i].RGcolumns.split(',').map(function(c) { return c.trim(); }).filter(Boolean).forEach(function(col) {
                if (existingCols.indexOf(col) === -1) existingCols.push(col);
            });
            dashModelData[panelKey].rgs[json[i].RG].columns = existingCols.join(',');
        }
        // Predefined values
        if (json[i].value.length > 0)
            dashValues[itemTargetId] = dashNormalizeVal(itemTargetId, json[i].value);
        // Formulas
        if (json[i].formulas.length > 0) {
            rep = json[i].formulas.match(repRegex);
            if (!dashFormulas[itemTargetId] || (rep && dashFormulas[itemTargetId] === '[]'))
                dashFormulas[itemTargetId] = json[i].formulas;
            if (rep) {
                var reportKey = dashReportKey(rep[1], json[i].panelFilter);
                if (!dashReportKeys[itemTargetId])
                    dashReportKeys[itemTargetId] = reportKey;
                dashRememberReportSource(itemTargetId, json[i].formulas, reportKey);
                dashReportNames[reportKey] = rep[1];
                if (!dashReports[reportKey])
                    dashGetRep(rep[1], fr, to, json[i].panelFilter);
            }
        }
    }

    // Activate tab: restore from URL hash or default to first tab (issue #1840)
    if (!model.querySelector('.dash-sheet-tab.active')) {
        var savedTab = null;
        try {
            var hashMatch = window.location.hash.match(/^#tab=(.+)/);
            if (hashMatch) savedTab = model.querySelector('.dash-sheet-tab#' + CSS.escape(decodeURIComponent(hashMatch[1])));
        } catch(e) {}
        var targetTab = savedTab || model.querySelector('.dash-sheet-tab');
        if (targetTab) {
            targetTab.classList.add('active');
            var targetSheet = document.getElementById('ds' + targetTab.id);
            if (targetSheet) targetSheet.style.display = '';
        }
    }
}

// ─── Visualization (charts / pivot) ──────────────────────────────────────────

var DASH_VIZ_TYPES = [
    { id: 'table',  label: 'Таблица',               icon: 'pi-table' },
    { id: 'line',   label: 'Линейный график',        icon: 'pi-chart-line' },
    { id: 'pie',    label: 'Круговая диаграмма',     icon: 'pi-chart-pie' },
    { id: 'bar',    label: 'Столбчатая диаграмма',   icon: 'pi-chart-bar' },
    { id: 'area',   label: 'Диаграмма с областями',  icon: 'pi-chart-line' },
    { id: 'bubble', label: 'Пузырьковая диаграмма',  icon: 'pi-circle' },
    { id: 'pivot',  label: 'Сводная таблица',        icon: 'pi-table' }
];

var dashVizModalCtx = null; // { panelEl, panelKey }

function dashPanelGetColumns(panelEl) {
    var cols = [];
    var subhead = panelEl.querySelector('thead .f-subhead');
    var headRow = panelEl.querySelector('thead .f-head');
    if (subhead) {
        subhead.querySelectorAll('th').forEach(function(th) {
            var name = (th.getAttribute('data-rg-col') || th.textContent || '').trim();
            if (name) cols.push(name);
        });
    } else if (headRow) {
        headRow.querySelectorAll('th').forEach(function(th, idx) {
            if (idx === 0) return;
            var name = th.textContent.trim();
            if (name) cols.push(name);
        });
    }
    return cols;
}

function dashPanelGetRows(panelEl) {
    var rows = [];
    panelEl.querySelectorAll('.f-item').forEach(function(tr) {
        rows.push(tr.getAttribute('item-name') || '');
    });
    return rows;
}

function dashCollectPanelData(panelEl) {
    var labels = [], datasets = [], cols = dashPanelGetColumns(panelEl);
    panelEl.querySelectorAll('.f-item').forEach(function(tr) {
        labels.push(tr.getAttribute('item-name') || '');
    });

    if (cols.length === 0) {
        // Single value column
        var vals = [];
        panelEl.querySelectorAll('.f-item').forEach(function(tr) {
            var td = tr.querySelector('td.f-cell');
            vals.push(dashGetFloat(td ? td.textContent.trim() : '') || 0);
        });
        datasets.push({ label: '', data: vals });
    } else {
        cols.forEach(function(col, ci) {
            var vals = [];
            panelEl.querySelectorAll('.f-item').forEach(function(tr) {
                var cells = Array.from(tr.querySelectorAll('td.f-cell'));
                // Find cells matching this column
                var matching = cells.filter(function(td) {
                    return (td.dataset.rgCol || '') === col || (td.dataset.rgHead || '') === col;
                });
                var sum = 0;
                matching.forEach(function(td) { sum += dashGetFloat(td.textContent.trim()) || 0; });
                vals.push(matching.length ? sum : 0);
            });
            datasets.push({ label: col, data: vals });
        });
    }
    return { labels: labels, datasets: datasets };
}

var CHART_COLORS = [
    'rgba(54,162,235,0.7)', 'rgba(255,99,132,0.7)', 'rgba(255,206,86,0.7)',
    'rgba(75,192,192,0.7)', 'rgba(153,102,255,0.7)', 'rgba(255,159,64,0.7)',
    'rgba(99,255,132,0.7)', 'rgba(235,54,162,0.7)'
];

function dashEnsureChartJs(cb) {
    if (window.Chart) { cb(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
    s.onload = cb;
    document.head.appendChild(s);
}

function dashEnsurePivotJs(cb) {
    if (window.$.pivotUI) { cb(); return; }
    // Load pivottable.js CSS
    if (!document.getElementById('pivottable-css')) {
        var lnk = document.createElement('link');
        lnk.id = 'pivottable-css';
        lnk.rel = 'stylesheet';
        lnk.href = 'https://cdn.jsdelivr.net/npm/pivottable@2/dist/pivot.min.css';
        document.head.appendChild(lnk);
    }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/pivottable@2/dist/pivot.min.js';
    s.onload = cb;
    document.head.appendChild(s);
}

function dashRenderChart(panelEl, vizType, fieldMap) {
    var data = dashCollectPanelData(panelEl);
    var canvas = panelEl.querySelector('.f-chart-canvas');
    var chartWrap = panelEl.querySelector('.f-chart-wrap');
    var tableWrap = panelEl.querySelector('.f-table-wrap');
    var pivotWrap = panelEl.querySelector('.f-pivot-wrap');

    // Destroy old chart if any
    if (canvas._chartInstance) {
        canvas._chartInstance.destroy();
        canvas._chartInstance = null;
    }

    tableWrap.style.display = 'none';
    pivotWrap.style.display = 'none';

    if (vizType === 'table') {
        tableWrap.style.display = '';
        chartWrap.style.display = 'none';
        return;
    }

    if (vizType === 'pivot') {
        chartWrap.style.display = 'none';
        pivotWrap.style.display = '';
        dashRenderPivot(panelEl, pivotWrap, data, fieldMap);
        return;
    }

    chartWrap.style.display = '';

    dashEnsureChartJs(function() {
        var labels = data.labels;
        var chartType, chartDatasets, options = {};

        if (vizType === 'pie') {
            chartType = 'pie';
            var vals = data.datasets.length ? data.datasets[0].data : [];
            chartDatasets = [{
                data: vals,
                backgroundColor: labels.map(function(_, i) { return CHART_COLORS[i % CHART_COLORS.length]; })
            }];
            options = { plugins: { legend: { position: 'right' } } };

        } else if (vizType === 'line') {
            chartType = 'line';
            chartDatasets = data.datasets.map(function(ds, i) {
                return { label: ds.label, data: ds.data, borderColor: CHART_COLORS[i % CHART_COLORS.length], backgroundColor: CHART_COLORS[i % CHART_COLORS.length], tension: 0.3, fill: false };
            });

        } else if (vizType === 'area') {
            chartType = 'line';
            chartDatasets = data.datasets.map(function(ds, i) {
                return { label: ds.label, data: ds.data, borderColor: CHART_COLORS[i % CHART_COLORS.length], backgroundColor: CHART_COLORS[i % CHART_COLORS.length].replace('0.7', '0.3'), tension: 0.3, fill: true };
            });

        } else if (vizType === 'bar') {
            var barMode = (fieldMap && fieldMap.barMode) || 'grouped';
            chartType = 'bar';
            chartDatasets = data.datasets.map(function(ds, i) {
                return { label: ds.label, data: ds.data, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] };
            });
            options = { scales: { x: { stacked: barMode === 'stacked' || barMode === 'combo' }, y: { stacked: barMode === 'stacked' } } };

        } else if (vizType === 'bubble') {
            chartType = 'bubble';
            // Use first 3 datasets as x, y, r
            var xData = (data.datasets[0] || { data: [] }).data;
            var yData = (data.datasets[1] || data.datasets[0] || { data: [] }).data;
            var rData = (data.datasets[2] || data.datasets[0] || { data: [] }).data;
            chartDatasets = [{
                label: panelEl.querySelector('h4') ? panelEl.querySelector('h4').textContent : '',
                data: labels.map(function(lbl, i) {
                    return { x: xData[i] || 0, y: yData[i] || 0, r: Math.max(3, Math.abs(rData[i] || 5)) };
                }),
                backgroundColor: CHART_COLORS[0]
            }];
        }

        canvas._chartInstance = new Chart(canvas, {
            type: chartType,
            data: { labels: labels, datasets: chartDatasets },
            options: options
        });
    });
}

function dashRenderPivot(panelEl, pivotWrap, data, fieldMap) {
    if (!window.jQuery || !window.jQuery.fn || !window.jQuery.fn.pivotUI) {
        dashEnsurePivotJs(function() {
            dashRenderPivot(panelEl, pivotWrap, data, fieldMap);
        });
        return;
    }
    pivotWrap.innerHTML = '';
    // Build flat records array for pivottable
    var records = data.labels.map(function(lbl, i) {
        var rec = { 'Строка': lbl };
        data.datasets.forEach(function(ds) {
            rec[ds.label || 'Значение'] = ds.data[i] || 0;
        });
        return rec;
    });
    window.jQuery(pivotWrap).pivotUI(records, {
        rows: fieldMap && fieldMap.pivotRows ? [fieldMap.pivotRows] : ['Строка'],
        cols: fieldMap && fieldMap.pivotCols ? [fieldMap.pivotCols] : [],
        aggregatorName: 'Sum',
        vals: fieldMap && fieldMap.pivotVals ? [fieldMap.pivotVals] : (data.datasets[0] ? [data.datasets[0].label || 'Значение'] : [])
    });
}

function dashPanelApplySettings(panelKey, settings, renderChart) {
    var panel = document.getElementById(panelKey);
    if (!panel) return;
    if (!settings) return;

    // Normalize: settings can be a single object {type:...} or an array
    var vizList = Array.isArray(settings) ? settings : [settings];
    var enabled = vizList.filter(function(v) { return v && v.type; });
    if (!enabled.length) return;

    // Build visualization type icons
    dashUpdatePanelVizIcons(panel, enabled);

    if (!renderChart) return;

    // Find default or first enabled
    var def = enabled.find(function(v) { return v.default; }) || enabled[0];
    if (def && def.type && def.type !== 'table') {
        dashRenderChart(panel, def.type, def.fieldMap || {});
    }
}

function dashUpdatePanelVizIcons(panel, enabled) {
    var container = panel.querySelector('.f-panel-viz-icons');
    if (!container) return;
    container.innerHTML = '';

    // Always add table icon first
    var allTypes = [{ type: 'table' }].concat(enabled.filter(function(v) { return v.type !== 'table'; }));
    allTypes.forEach(function(viz) {
        var typeInfo = DASH_VIZ_TYPES.find(function(t) { return t.id === viz.type; }) || DASH_VIZ_TYPES[0];
        var btn = document.createElement('a');
        btn.className = 'f-viz-type-icon';
        btn.title = typeInfo.label;
        btn.dataset.vizType = viz.type;
        btn.innerHTML = '<i class="pi ' + typeInfo.icon + '"></i>';
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            container.querySelectorAll('.f-viz-type-icon').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            var modelData = dashModelData[panel.id] || {};
            var s = modelData.settings;
            var vizList = s ? (Array.isArray(s) ? s : [s]) : [];
            var vizCfg = vizList.find(function(v) { return v.type === viz.type; }) || {};
            dashRenderChart(panel, viz.type, vizCfg.fieldMap || {});
        });
        container.appendChild(btn);
    });

    // Mark current default as active
    var settings = (dashModelData[panel.id] || {}).settings;
    var vizList = settings ? (Array.isArray(settings) ? settings : [settings]) : [];
    var def = vizList.find(function(v) { return v.default; }) || vizList[0];
    var activeType = def ? def.type : 'table';
    var activeBtn = container.querySelector('[data-viz-type="' + activeType + '"]');
    if (activeBtn) activeBtn.classList.add('active');
}

// Open visualization settings modal for a panel
function dashOpenPanelVizSettings(panelEl) {
    dashVizModalCtx = { panelEl: panelEl, panelKey: panelEl.id };
    var settings = (dashModelData[panelEl.id] || {}).settings;
    var vizList = settings ? (Array.isArray(settings) ? settings : [settings]) : [];

    var accordion = document.getElementById('dash-viz-accordion');
    accordion.innerHTML = '';

    // Skip 'table' in the accordion (it's always available)
    DASH_VIZ_TYPES.filter(function(t) { return t.id !== 'table'; }).forEach(function(typeInfo) {
        var existing = vizList.find(function(v) { return v.type === typeInfo.id; }) || null;
        var isChecked = !!existing;
        var isDefault = existing && existing.default;

        var item = document.createElement('div');
        item.className = 'dash-viz-accordion-item';
        item.dataset.vizType = typeInfo.id;

        var headerHtml = '<div class="dash-viz-accordion-header">'
            + '<label class="dash-viz-check-label">'
            + '<input type="checkbox" class="dash-viz-check" data-viz-type="' + typeInfo.id + '"' + (isChecked ? ' checked' : '') + '>'
            + '<i class="pi ' + typeInfo.icon + '"></i>'
            + '<span>' + typeInfo.label + '</span>'
            + '</label>'
            + '<label class="dash-viz-default-label" title="По умолчанию">'
            + '<input type="radio" name="dash-viz-default" class="dash-viz-default" value="' + typeInfo.id + '"' + (isDefault ? ' checked' : '') + (isChecked ? '' : ' disabled') + '>'
            + 'По умолчанию'
            + '</label>'
            + '</div>';

        var fieldMapHtml = '<div class="dash-viz-fieldmap" style="' + (isChecked ? '' : 'display:none') + '">';
        fieldMapHtml += dashBuildFieldMapHtml(typeInfo.id, existing ? existing.fieldMap : null, panelEl);
        fieldMapHtml += '</div>';

        item.innerHTML = headerHtml + fieldMapHtml;

        // Toggle fieldmap and default radio on checkbox change
        item.querySelector('.dash-viz-check').addEventListener('change', function(e) {
            var checked = e.target.checked;
            item.querySelector('.dash-viz-fieldmap').style.display = checked ? '' : 'none';
            item.querySelector('.dash-viz-default').disabled = !checked;
            if (!checked && item.querySelector('.dash-viz-default').checked) {
                item.querySelector('.dash-viz-default').checked = false;
            }
        });

        accordion.appendChild(item);
    });

    document.getElementById('dash-viz-modal').classList.add('open');
}

function dashBuildFieldMapHtml(vizType, fieldMap, panelEl) {
    var cols = dashPanelGetColumns(panelEl);
    var rows = dashPanelGetRows(panelEl);
    var allFields = cols.length ? cols : rows;
    var fm = fieldMap || {};

    var optionsHtml = '<option value="">(не задано)</option>';
    allFields.forEach(function(f) {
        optionsHtml += '<option value="' + dashAttr(f) + '">' + f + '</option>';
    });

    function sel(name, label, val) {
        return '<div class="dash-viz-field-row"><label>' + label + '</label>'
            + '<select name="' + name + '">'
            + optionsHtml.replace('value="' + dashAttr(val) + '"', 'value="' + dashAttr(val) + '" selected')
            + '</select></div>';
    }

    if (vizType === 'bar') {
        var barMode = fm.barMode || 'grouped';
        return '<div class="dash-viz-field-row"><label>Режим</label>'
            + '<select name="barMode">'
            + '<option value="grouped"' + (barMode === 'grouped' ? ' selected' : '') + '>Группы столбиков</option>'
            + '<option value="stacked"' + (barMode === 'stacked' ? ' selected' : '') + '>Сегменты</option>'
            + '<option value="combo"' + (barMode === 'combo' ? ' selected' : '') + '>Комбинация</option>'
            + '</select></div>';
    }
    if (vizType === 'bubble') {
        return sel('bubbleX', 'X (ось)', fm.bubbleX || '')
            + sel('bubbleY', 'Y (ось)', fm.bubbleY || '')
            + sel('bubbleR', 'Размер', fm.bubbleR || '');
    }
    if (vizType === 'pivot') {
        return sel('pivotRows', 'Строки', fm.pivotRows || '')
            + sel('pivotCols', 'Столбцы', fm.pivotCols || '')
            + sel('pivotVals', 'Значения', fm.pivotVals || '');
    }
    return '<div class="dash-viz-field-row dash-viz-field-hint">Поля подбираются автоматически из данных панели.</div>';
}

function dashVizModalCollectSettings() {
    var accordion = document.getElementById('dash-viz-accordion');
    var result = [];
    accordion.querySelectorAll('.dash-viz-accordion-item').forEach(function(item) {
        var vizType = item.dataset.vizType;
        var checked = item.querySelector('.dash-viz-check').checked;
        if (!checked) return;
        var isDefault = item.querySelector('.dash-viz-default').checked;
        var fieldMap = {};
        item.querySelectorAll('.dash-viz-fieldmap select').forEach(function(sel) {
            if (sel.name && sel.value) fieldMap[sel.name] = sel.value;
        });
        var entry = { type: vizType, fieldMap: fieldMap };
        if (isDefault) entry.default = true;
        result.push(entry);
    });
    return result;
}

document.getElementById('dash-viz-cancel').addEventListener('click', function() {
    document.getElementById('dash-viz-modal').classList.remove('open');
    dashVizModalCtx = null;
});

document.getElementById('dash-viz-save').addEventListener('click', function() {
    if (!dashVizModalCtx) return;
    var settings = dashVizModalCollectSettings();
    var panelEl = dashVizModalCtx.panelEl;
    var panelKey = dashVizModalCtx.panelKey;
    var panelID = (dashModelData[panelKey] || {}).panelID || '';
    var jsonStr = JSON.stringify(settings);
    document.getElementById('dash-viz-modal').classList.remove('open');
    dashVizModalCtx = null;

    if (panelID) {
        newApi('POST', '_m_set/' + panelID + '?JSON', 'dashVizSettingsSaved',
            't1165=' + encodeURIComponent(jsonStr),
            { panelEl: panelEl, panelKey: panelKey, settings: settings });
    } else {
        dashApplyNewVizSettings(panelEl, panelKey, settings);
    }
});

window.dashVizSettingsSaved = function(json, ctx) {
    if (!json || json.error) { dashSetStatus('Ошибка сохранения настроек'); return; }
    dashApplyNewVizSettings(ctx.panelEl, ctx.panelKey, ctx.settings);
    dashSetStatus('Настройки сохранены');
};

function dashApplyNewVizSettings(panelEl, panelKey, settings) {
    if (dashModelData[panelKey]) dashModelData[panelKey].settings = settings;
    var enabled = settings.filter(function(v) { return v && v.type; });
    dashUpdatePanelVizIcons(panelEl, enabled);
    var def = enabled.find(function(v) { return v.default; }) || enabled[0];
    if (def) {
        dashRenderChart(panelEl, def.type, def.fieldMap || {});
    } else {
        // No enabled: show table
        panelEl.querySelector('.f-table-wrap').style.display = '';
        panelEl.querySelector('.f-chart-wrap').style.display = 'none';
        panelEl.querySelector('.f-pivot-wrap').style.display = 'none';
    }
}

// Event delegation for panel settings icon clicks
document.addEventListener('click', function(e) {
    var icon = e.target.closest('.f-panel-settings-icon');
    if (!icon) return;
    var panel = icon.closest('.f-panel');
    if (panel) dashOpenPanelVizSettings(panel);
});

function dashReset() {
    dashModelData = {}; dashPeriodData = {}; dashPeriods = {}; dashValues = {};
    dashFormulas = {}; dashItems = {}; dashReports = {}; dashReportNames = {}; dashReportKeys = {}; dashReportSources = {}; dashAjaxes = 0; dashValueItemIds = {};
    dashMatrixValues = []; dashMatrixValuesRequested = false; dashRgSourceIds = {};
    var model = document.getElementById('dash-model');
    model.querySelector('.sheet-tabs').innerHTML = '';
    model.querySelector('.sheets').innerHTML = '';
}

window.dashGetRecord  = dashGetRecord;
window.dashGetModel   = dashGetModel;
window.dashGetSrc     = dashGetSrc;
window.dashGetPeriods = dashGetPeriods;
window.dashGetMatrixValues = dashGetMatrixValues;
window.dashGetRepDone             = dashGetRepDone;
window.dashDebug                  = dashDebug;
window.dashUpdateTableWrapOverflow = dashUpdateTableWrapOverflow;

window.dashApplyFilter = function(sheetEl) {
    dashDateFr    = dashFromInputDate(sheetEl.querySelector('.dash-fr-input').value);
    dashDateTo    = dashFromInputDate(sheetEl.querySelector('.dash-to-input').value);
    dashPeriodVal = sheetEl.querySelector('.dash-period-sel').value;

    // Get active sheet name for FR_sheet filter
    var model = document.getElementById('dash-model');
    var activeTab = model.querySelector('.dash-sheet-tab.active');
    var sheetName = activeTab ? activeTab.textContent.trim() : '';

    // Partial reset: remove only this sheet's panels, keep tabs/other sheets intact
    sheetEl.querySelectorAll('.f-panel').forEach(function(p) {
        p.querySelectorAll('.f-item').forEach(function(row) {
            delete dashFormulas[row.id];
            delete dashItems[row.id];
            delete dashReportKeys[row.id];
        });
        delete dashModelData[p.id];
        p.remove();
    });
    dashPeriodData = {}; dashPeriods = {}; dashValues = {}; dashReports = {}; dashReportNames = {}; dashReportKeys = {}; dashReportSources = {}; dashAjaxes = 0; dashValueItemIds = {}; dashRgSourceIds = {};

    // Re-fetch model for this sheet only — skip get_record, use cached dashRecordId
    dashSetStatus('Загрузка данных...');
    newApi('GET', 'report/Дэшборд?JSON_KV&FR_modelID=' + dashRecordId
        + '&period=' + encodeURIComponent(dashPeriodVal)
        + (sheetName ? '&FR_sheet=' + encodeURIComponent(sheetName) : ''),
        'dashGetModel');
};

window.dashApplySearch = function(query, sheetEl) {
    var q = query.toLowerCase().trim();
    sheetEl.querySelectorAll('.f-item').forEach(function(row) {
        var match = !q || row.textContent.toLowerCase().indexOf(q) !== -1;
        row.style.display = match ? '' : 'none';
        row.style.backgroundColor = q && match ? 'rgba(255,140,0,0.25)' : '';
    });
};

window.dashLoad = function(dashId) {
    dashCurrentId = dashId;
    dashReset();
    dashSetStatus('Загрузка дэшборда...');
    newApi('GET', 'get_record/' + dashId, 'dashGetRecord');
};

window.dashSetActive = function(el) {
    document.querySelectorAll('#dash-model .f-sheet').forEach(function(s) { s.style.display = 'none'; });
    document.querySelectorAll('#dash-model .dash-sheet-tab').forEach(function(t) { t.classList.remove('active'); });
    el.classList.add('active');
    var sheet = document.getElementById('ds' + el.id);
    if (sheet) sheet.style.display = '';
    // Persist active tab in URL hash so page refresh restores it (issue #1840)
    try { history.replaceState(null, '', '#tab=' + encodeURIComponent(el.id)); } catch(e) {}
};

window.dashOpenSettings = function() {
    if (dashRecordId) window.open('/' + db + '/edit_obj/' + dashRecordId, 'dash-settings');
};

window.dashCopy2Buffer = function(text) {
    var temp = document.createElement('textarea');
    document.body.appendChild(temp);
    temp.value = text;
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
};

// Re-check table overflow on resize so sticky behaviour stays correct
window.addEventListener('resize', function() { dashUpdateTableWrapOverflow(); });

// ─── Cell editing ────────────────────────────────────────────────────────────

var dashMetadata = null; // cached after first fetch

function dashLoadMetadata(cb) {
    if (dashMetadata) { cb(); return; }
    newApi('GET', 'metadata', 'dashMetadataDone', '', cb);
}

window.dashMetadataDone = function(json, cb) {
    dashMetadata = json || {};
    if (typeof cb === 'function') cb();
};

function dashCellDateFr(td) {
    var range = td.getAttribute('range') || '-';
    if (range === '-') return null;
    return range.split('-')[0] || null;
}
function dashCellDateTo(td) {
    var range = td.getAttribute('range') || '-';
    if (range === '-') return null;
    return range.split('-')[1] || null;
}
function dashTodayYMD() {
    var d = new Date();
    return String(d.getFullYear())
        + String(d.getMonth() + 1).padStart(2, '0')
        + String(d.getDate()).padStart(2, '0');
}

function dashMatrixUpsertCache(td, newVal, recId) {
    if (!recId) return;
    for (var i = 0; i < dashMatrixValues.length; i++) {
        if (String(dashMatrixValues[i].valID) === String(recId)) {
            if (newVal === '')
                dashMatrixValues.splice(i, 1);
            else
                dashMatrixValues[i].val = newVal;
            return;
        }
    }
    if (newVal !== '') {
        dashMatrixValues.push({
            val: newVal,
            date: td.dataset.matrixDate || '',
            line: td.dataset.matrixLine || '',
            col: td.dataset.matrixCol || '',
            'Метка': td.dataset.matrixLabel || '',
            valID: String(recId)
        });
    }
}

function dashMatrixRecordIds(td) {
    return String((td.dataset && td.dataset.matrixValId) || '')
        .split(',')
        .map(function(id) { return id.trim(); })
        .filter(Boolean);
}

function dashMatrixUsesDates(td) {
    var panel = td.closest('.f-panel');
    var panelData = panel ? dashModelData[panel.id] : null;
    return !!panelData && panelData.noDates === '';
}

function dashMatrixSheetInputValue(td, selector) {
    var sheet = td.closest('.f-sheet');
    var input = sheet ? sheet.querySelector(selector) : null;
    return input ? input.value : '';
}

function dashMatrixSearchUrl(td) {
    var url = 'object/' + DASH_MATRIX_TYPE_ID + '?JSON_OBJ';
    if (dashMatrixUsesDates(td)) {
        var fr = dashMatrixSheetInputValue(td, '.dash-fr-input');
        var to = dashMatrixSheetInputValue(td, '.dash-to-input');
        if (fr) url += '&FR_' + DASH_MATRIX_DATE_FIELD_ID + '=' + encodeURIComponent(fr);
        if (to) url += '&TO_' + DASH_MATRIX_DATE_FIELD_ID + '=' + encodeURIComponent(to);
    }
    url += '&F_' + DASH_MATRIX_LINE_FIELD_ID + '=' + encodeURIComponent(td.dataset.matrixLine || '');
    url += '&F_' + DASH_MATRIX_COL_FIELD_ID + '=' + encodeURIComponent(td.dataset.matrixCol || '');
    return url;
}

function dashMatrixListUrl(url) {
    return String(url || '')
        .replace('?JSON_OBJ&', '?')
        .replace('&JSON_OBJ&', '&')
        .replace('?JSON_OBJ', '')
        .replace('&JSON_OBJ', '')
        .replace(/&&/g, '&')
        .replace(/\?&/, '?')
        .replace(/[?&]$/, '');
}

function dashMatrixCreateParams(td, newVal) {
    var params = 't' + DASH_MATRIX_TYPE_ID + '=' + encodeURIComponent(newVal);
    if (dashMatrixUsesDates(td))
        params += '&t' + DASH_MATRIX_DATE_FIELD_ID + '=' + encodeURIComponent(dashTodayYMD());
    params += '&t' + DASH_MATRIX_LINE_FIELD_ID + '=' + encodeURIComponent(td.dataset.matrixLine || '');
    params += '&t' + DASH_MATRIX_COL_FIELD_ID + '=' + encodeURIComponent(td.dataset.matrixCol || '');
    return params;
}

function dashSaveMatrixExisting(recId, td, newVal) {
    if (newVal === '')
        newApi('POST', '_m_del/' + recId + '?JSON', 'dashMatrixValueSaveDone', '', { td: td, newVal: newVal, recId: recId });
    else
        newApi('POST', '_m_save/' + recId + '?JSON', 'dashMatrixValueSaveDone',
            't' + DASH_MATRIX_TYPE_ID + '=' + encodeURIComponent(newVal), { td: td, newVal: newVal, recId: recId });
}

function dashSaveMatrixValue(td, newVal, originalVal) {
    var ids = dashMatrixRecordIds(td);
    if (ids.length === 1) {
        dashSaveMatrixExisting(ids[0], td, newVal);
        return;
    }

    var searchUrl = dashMatrixSearchUrl(td);
    newApi('GET', searchUrl, 'dashMatrixValueSearchDone', '', { td: td, newVal: newVal, originalVal: originalVal, searchUrl: searchUrl });
}

function dashMatrixValueSearchDone(json, ctx) {
    if (!Array.isArray(json)) json = [];
    var td = ctx.td, newVal = ctx.newVal;

    if (json.length === 0) {
        if (newVal === '') {
            dashSetStatus('');
            td.style.backgroundColor = '';
            return;
        }
        newApi('POST', '_m_new/' + DASH_MATRIX_TYPE_ID + '?JSON&up=1', 'dashMatrixValueSaveDone',
            dashMatrixCreateParams(td, newVal), { td: td, newVal: newVal, recId: '' });
    } else if (json.length === 1) {
        dashSaveMatrixExisting(json[0].i, td, newVal);
    } else {
        td.style.backgroundColor = '';
        dashShowMultivalModal(json, dashMatrixListUrl(ctx.searchUrl || dashMatrixSearchUrl(td)), td, newVal, {
            saveCallback: 'dashMatrixValueSaveDone',
            saveParam: 't' + DASH_MATRIX_TYPE_ID
        }, ctx.originalVal);
    }
}
window.dashMatrixValueSearchDone = dashMatrixValueSearchDone;

function dashMatrixValueSaveDone(json, ctx) {
    if (!json || json.error) {
        ctx.td.style.backgroundColor = '';
        dashSetStatus('Ошибка сохранения');
        return;
    }
    var recId = ctx.recId || json.id || json.obj || '';
    ctx.td.textContent = ctx.newVal;
    ctx.td.style.backgroundColor = '';
    ctx.td.setAttribute('ready', '1');
    if (ctx.newVal === '')
        delete ctx.td.dataset.matrixValId;
    else if (recId)
        ctx.td.dataset.matrixValId = String(recId);
    dashMatrixUpsertCache(ctx.td, ctx.newVal, recId);
    dashSetStatus('Сохранено');
    ctx.td.closest('tr').querySelectorAll('td.f-rg-formula-cell').forEach(function(fc) {
        fc.setAttribute('ready', '0');
        fc.textContent = '';
        fc.classList.remove('dash-err');
    });
    dashCalcCells();
    dashCalcRGFormulas();
}
window.dashMatrixValueSaveDone = dashMatrixValueSaveDone;

// Get the item text for t1042: valueItemID from data-value-item-id, or item-name from row
function dashCellItemRef(td) {
    if (td.dataset.valueItemId) return td.dataset.valueItemId;
    var row = td.closest('tr');
    return row ? (row.getAttribute('item-name') || '') : '';
}

// Get the rg group head for a cell: data-rg-head if set, otherwise data-rg-col from the subheader th
function dashCellRgHead(td) {
    if (td.dataset.rgHead) return td.dataset.rgHead;
    var table = td.closest('table');
    if (!table) return null;
    var subhead = table.querySelector('thead .f-subhead');
    if (!subhead) return null;
    var colIdx = Array.from(td.parentNode.cells).indexOf(td);
    var ths = Array.from(subhead.querySelectorAll('th'));
    var th = ths[colIdx];
    return (th && th.getAttribute('data-rg-col')) || null;
}

// Build search URL for a Значение record
function dashValueSearchUrl(td) {
    var itemRef = dashCellItemRef(td);
    var fr = dashCellDateFr(td);
    var to = dashCellDateTo(td);
    var rgHead = dashCellRgHead(td);
    var url = 'object/1010?JSON_OBJ';
    if (fr) url += '&FR_1039=' + fr;
    if (to) url += '&TO_1039=' + to;
    url += '&FR_1042=@' + encodeURIComponent(itemRef);
    if (rgHead) url += '&F_1104=' + encodeURIComponent(rgHead);
    return url;
}

// Save or delete a Значение: search first, then create/update/delete
function dashSaveValue(td, newVal, originalVal) {
    var searchUrl = dashValueSearchUrl(td);
    var itemRef = dashCellItemRef(td);
    var fr = dashCellDateFr(td);
    var to = dashCellDateTo(td);
    var rgHead = dashCellRgHead(td);

    newApi('GET', searchUrl, 'dashValueSearchDone', '', { td: td, newVal: newVal, originalVal: originalVal, itemRef: itemRef, fr: fr, to: to, rgHead: rgHead });
}

function dashSaveCell(td, newVal, originalVal) {
    if (td.dataset.src === 'matrix') {
        dashSaveMatrixValue(td, newVal, originalVal);
        return;
    }
    dashSaveValue(td, newVal, originalVal);
}

window.dashValueSearchDone = function(json, ctx) {
    if (!json) json = [];
    var td = ctx.td, newVal = ctx.newVal, itemRef = ctx.itemRef;
    var fr = ctx.fr, to = ctx.to, rgHead = ctx.rgHead;

    if (json.length === 0) {
        // Delete: nothing to do if value is already empty
        if (newVal === '') { dashSetStatus(''); return; }
        // Create new record
        var valueItemId = ctx.td.dataset.valueItemId;
        var params = 't1010=' + encodeURIComponent(newVal)
            + (valueItemId ? '&t1042=' + encodeURIComponent(valueItemId) : '&NEW_1042=' + encodeURIComponent(itemRef)) // Create the ref in case it does not exist
            + '&t1039=' + encodeURIComponent(fr || dashTodayYMD());
        if (rgHead) params += '&t1104=' + encodeURIComponent(rgHead);
        newApi('POST', '_m_new/1010?JSON&up=1', 'dashValueSaveDone', params, { td: td, newVal: newVal });
    } else if (json.length === 1) {
        var recId = json[0].i;
        if (newVal === '') {
            // Delete existing record when value cleared
            newApi('POST', '_m_del/' + recId + '?JSON', 'dashValueSaveDone', '', { td: td, newVal: newVal });
        } else {
            // Update existing record
            var params2 = 't1010=' + encodeURIComponent(newVal);
            newApi('POST', '_m_save/' + recId + '?JSON', 'dashValueSaveDone', params2, { td: td, newVal: newVal });
        }
    } else {
        // Multiple records — show modal with first 10, link to full list
        dashShowMultivalModal(json, dashValueSearchUrl(td).replace('JSON_OBJ', '').replace(/&&/g, '&'), td, newVal, {}, ctx.originalVal);
    }
};

window.dashValueSaveDone = function(json, ctx) {
    if (!json || json.error) {
        ctx.td.style.backgroundColor = '';
        dashSetStatus('Ошибка сохранения');
        return;
    }
    // Update cell display
    ctx.td.textContent = ctx.newVal;
    ctx.td.style.backgroundColor = '';
    ctx.td.setAttribute('ready', '1');
    dashSetStatus('Сохранено');
    // Reset and recalculate RGformula cells in the same row
    ctx.td.closest('tr').querySelectorAll('td.f-rg-formula-cell').forEach(function(fc) {
        fc.setAttribute('ready', '0');
        fc.textContent = '';
        fc.classList.remove('dash-err');
    });
    dashCalcCells();
    dashCalcRGFormulas();
};

// Inline input editor
function dashStartInlineEdit(td) {
    var currentVal = td.textContent.trim();
    var savedPadding = td.style.padding;
    var cellWidth = td.offsetWidth;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'dash-cell-input';
    input.value = currentVal;
    input.style.maxWidth = cellWidth + 'px';
    td.textContent = '';
    td.style.padding = '0';
    td.appendChild(input);
    input.focus();
    input.select();

    function restorePadding() {
        td.style.padding = savedPadding;
    }

    function commit() {
        var newVal = input.value.trim();
        restorePadding();
        td.textContent = newVal;
        if (newVal !== currentVal) {
            td.style.backgroundColor = '#ffe0e0';
            dashSetStatus('Сохранение...');
            dashSaveCell(td, newVal, currentVal);
        }
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        } else if (e.key === 'Escape') {
            input.removeEventListener('blur', commit);
            restorePadding();
            td.textContent = currentVal;
        } else if (e.key === 'Tab' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            input.removeEventListener('blur', commit);
            commit();
            var editableCells = Array.from(document.querySelectorAll('td.f-cell[data-src="rg"], td.f-cell[data-src="value"], td.f-cell[data-src="matrix"]'));
            var idx = editableCells.indexOf(td);
            var target = null;
            if (e.key === 'Tab') {
                target = e.shiftKey ? editableCells[idx - 1] : editableCells[idx + 1];
            } else if (e.key === 'ArrowDown') {
                // Find cell in same column, next row
                var colIdx = Array.from(td.parentNode.cells).indexOf(td);
                var nextRow = td.parentNode.nextElementSibling;
                while (nextRow) {
                    var candidate = nextRow.cells[colIdx];
                    if (candidate && (candidate.dataset.src === 'rg' || candidate.dataset.src === 'value' || candidate.dataset.src === 'matrix')) {
                        target = candidate; break;
                    }
                    nextRow = nextRow.nextElementSibling;
                }
            } else if (e.key === 'ArrowUp') {
                var colIdx = Array.from(td.parentNode.cells).indexOf(td);
                var prevRow = td.parentNode.previousElementSibling;
                while (prevRow) {
                    var candidate = prevRow.cells[colIdx];
                    if (candidate && (candidate.dataset.src === 'rg' || candidate.dataset.src === 'value' || candidate.dataset.src === 'matrix')) {
                        target = candidate; break;
                    }
                    prevRow = prevRow.previousElementSibling;
                }
            }
            if (target) {
                setTimeout(function() { dashStartInlineEdit(target); }, 0);
            }
        }
    });
}

// Formula modal
var dashFormulaCtx = null;

function dashShowFormulaModal(td) {
    dashFormulaCtx = td;
    var formula = td.dataset.formula || '';
    document.getElementById('dash-formula-textarea').value = formula;
    document.getElementById('dash-formula-modal').classList.add('open');
    document.getElementById('dash-formula-textarea').focus();
}

document.getElementById('dash-formula-cancel').addEventListener('click', function() {
    document.getElementById('dash-formula-modal').classList.remove('open');
    dashFormulaCtx = null;
});

document.getElementById('dash-formula-save').addEventListener('click', function() {
    if (!dashFormulaCtx) return;
    var newFormula = document.getElementById('dash-formula-textarea').value.trim();
    var td = dashFormulaCtx;
    document.getElementById('dash-formula-modal').classList.remove('open');
    dashFormulaCtx = null;

    // POST new formula to the model indicator, then recalc
    var itemId = td.dataset.itemId;
    var params = '_xsrf=' + encodeURIComponent(xsrf) + '&formula=' + encodeURIComponent(newFormula);
    newApi('POST', '_m_save/' + itemId, 'dashFormulaSaveDone', params, { td: td, newFormula: newFormula });
});

window.dashFormulaSaveDone = function(json, ctx) {
    if (!json || json.error) { dashSetStatus('Ошибка сохранения формулы'); return; }
    // Update formula in memory and recalc
    var itemId = ctx.td.dataset.itemId;
    dashFormulas[itemId] = ctx.newFormula;
    ctx.td.setAttribute('ready', '0');
    ctx.td.dataset.formula = ctx.newFormula;
    dashCalcCells();
    dashCalcRGFormulas();
    dashSetStatus('Формула сохранена');
};

// Multiple values modal state
var dashMultivalCtx = null;

function dashMultivalRenderList(records) {
    var list = document.getElementById('dash-multival-list');
    list.innerHTML = '';
    records.slice(0, 10).forEach(function(rec) {
        var li = document.createElement('li');
        var span = document.createElement('span');
        span.textContent = rec.r ? rec.r.join(' | ') : String(rec.i);
        var btn = document.createElement('button');
        btn.className = 'dash-multival-del';
        btn.title = 'Удалить';
        btn.textContent = '×';
        btn.dataset.recId = rec.i;
        li.appendChild(span);
        li.appendChild(btn);
        list.appendChild(li);
    });
}

function dashShowMultivalModal(records, baseUrl, td, newVal, options, originalVal) {
    dashMultivalCtx = { records: records, baseUrl: baseUrl, td: td, newVal: newVal, options: options || {}, originalVal: originalVal };
    document.getElementById('dash-multival-subtitle').textContent = 'Не могу однозначно сохранить ' + newVal;
    dashMultivalRenderList(records);
    var link = document.getElementById('dash-multival-link');
    link.href = '/' + db + '/' + baseUrl;
    document.getElementById('dash-multival-modal').classList.add('open');
}

document.getElementById('dash-multival-list').addEventListener('click', function(e) {
    var btn = e.target.closest('.dash-multival-del');
    if (!btn || !dashMultivalCtx) return;
    var recId = btn.dataset.recId;
    newApi('POST', '_m_del/' + recId + '?JSON', 'dashMultivalDelDone', '', { recId: recId });
});

window.dashMultivalDelDone = function(json, ctx) {
    if (!json || json.error || !dashMultivalCtx) {
        dashSetStatus('Ошибка удаления');
        return;
    }
    if (dashMultivalCtx.options && dashMultivalCtx.options.saveCallback === 'dashMatrixValueSaveDone')
        dashMatrixUpsertCache(dashMultivalCtx.td, '', ctx.recId);
    var remaining = dashMultivalCtx.records.filter(function(r) { return String(r.i) !== String(ctx.recId); });
    dashMultivalCtx.records = remaining;
    if (remaining.length === 1) {
        // Auto-save the pending value into the last remaining record
        var recId = remaining[0].i;
        var newVal = dashMultivalCtx.newVal;
        var td = dashMultivalCtx.td;
        var options = dashMultivalCtx.options || {};
        var saveCallback = options.saveCallback || 'dashValueSaveDone';
        var saveParam = options.saveParam || 't1010';
        var saveCtx = { td: td, newVal: newVal };
        if (saveCallback === 'dashMatrixValueSaveDone')
            saveCtx.recId = recId;
        document.getElementById('dash-multival-modal').classList.remove('open');
        dashMultivalCtx = null;
        if (newVal === '') {
            newApi('POST', '_m_del/' + recId + '?JSON', saveCallback, '', saveCtx);
        } else {
            newApi('POST', '_m_save/' + recId + '?JSON', saveCallback, saveParam + '=' + encodeURIComponent(newVal), saveCtx);
        }
    } else {
        dashMultivalRenderList(remaining);
    }
};

document.getElementById('dash-multival-close').addEventListener('click', function() {
    document.getElementById('dash-multival-modal').classList.remove('open');
    if (dashMultivalCtx) {
        var td = dashMultivalCtx.td;
        if (td && dashMultivalCtx.originalVal !== undefined) {
            td.textContent = dashMultivalCtx.originalVal;
            td.style.backgroundColor = '';
        }
        dashMultivalCtx = null;
    }
});

// Readonly tooltip
var dashReadonlyTip = document.getElementById('dash-readonly-tip');
var dashReadonlyTimer = null;

function dashShowReadonlyTip(e) {
    dashReadonlyTip.style.left = (e.clientX + 12) + 'px';
    dashReadonlyTip.style.top  = (e.clientY + 8) + 'px';
    dashReadonlyTip.classList.add('visible');
    clearTimeout(dashReadonlyTimer);
    dashReadonlyTimer = setTimeout(function() {
        dashReadonlyTip.classList.remove('visible');
    }, 1800);
}

// Main cell click handler (event delegation on #dash-model)
document.getElementById('dash-model').addEventListener('click', function(e) {
    var td = e.target.closest('td.f-cell');
    if (!td) return;
    // Skip if inline input is already active
    if (td.querySelector('.dash-cell-input')) return;

    var src = td.dataset.src || '';

    if (src === 'matrix') {
        dashStartInlineEdit(td);
        return;
    }

    if (src === 'rg' || src === 'value') {
        dashLoadMetadata(function() {
            dashStartInlineEdit(td);
        });
        return;
    }

    if (src === 'rg-formula' || src === 'value-formula') {
        dashLoadMetadata(function() {
            dashShowFormulaModal(td);
        });
        return;
    }

    if (src === 'report' || src === 'mu' || src === 'linesum') {
        dashShowReadonlyTip(e);
        return;
    }
});

// Auto-load dashboard ID from URL path: dash/id
(function() {
    var pathParts = window.location.pathname.split('/').filter(function(p) { return p !== ''; });
    var dashIdx = -1;
    for (var i = 0; i < pathParts.length; i++) {
        if (pathParts[i] === 'dash') { dashIdx = i; break; }
    }
    if (dashIdx === -1 || dashIdx + 1 >= pathParts.length) {
        dashSetStatus('Дэшборд не указан');
        return;
    }
    var rawId = pathParts[dashIdx + 1];
    if (!/^\d+$/.test(rawId)) {
        dashSetStatus('Дэшборд не указан');
        return;
    }
    dashLoad(rawId);
})();

})();
