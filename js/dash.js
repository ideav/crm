(function(){

const repRegex  = /^\[([A-Za-яЁё][A-Za-яЁё0-9 ]*)(\.[A-Za-яЁё][A-Za-яЁё0-9 ]*)(\.[A-Za-яЁё][A-Za-яЁё0-9 ]*)?\]$/
    , itemRegex = /^\[([A-Za-яЁё][ A-Za-яЁё0-9\(\)-]*)\]$/
    , exprRegex = /(СУММА)\(\[(.*?)\]:\[(.*?)\]\)/g
    , itemIdRegex = /\[\d+\]/g;
const DASH_MATRIX_DATE_FIELD_ID = '155552'
    , DASH_MATRIX_LINE_FIELD_ID = '155553'
    , DASH_MATRIX_COL_FIELD_ID = '155554'
    , DASH_VALUE_LABEL_FIELD_ID = '155556'
    , DASH_MATRIX_LABEL_FIELD_ID = '155557';

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
        + '<button type="button" class="dash-tile-mode-icon" onclick="dashToggleSheetTileMode(this.closest(\'.f-sheet\'))" title="Включить режим плитки" aria-label="Режим плитки" aria-pressed="false"><i class="pi pi-th-large"></i></button>'
        + '<button type="button" class="dash-reset-size-icon" onclick="dashResetSheetSizeCookies(this.closest(\'.f-sheet\'))" title="Сбросить размеры панелей" aria-label="Сбросить размеры панелей" aria-hidden="true" disabled><i class="pi pi-refresh"></i></button>'
        + '</div></div>'
    , panelTpl    = '<div id=":id:" f-period=":period:" class="f-panel pt-3" data-panel-id=":panelid:">'
        + '<div class="f-panel-header">'
        + '<div class="f-panel-viz-icons"></div>'
        + '<h4>:name:</h4>'
        + (dashIsAdmin ? '<a class="f-panel-settings-icon" title="Настройки отображения"><i class="pi pi-chart-bar"></i></a>' : '')
        + '<a class="f-panel-filter-icon" title="Фильтр"><i class="pi pi-filter"></i></a>'
        + '<a class="f-panel-copy-icon" title="Скопировать таблицу"><i class="pi pi-copy"></i></a>'
        + '</div>'
        + '<div class="f-panel-content">'
        + '<div class="f-table-wrap"><table class="table table-sm table-bordered w-auto"><thead><tr class="dash-head f-head"><th>:head:</thead><tbody></tbody></table></div>'
        + '<div class="f-chart-wrap" style="display:none"><canvas class="f-chart-canvas"></canvas></div>'
        + '<div class="f-pivot-wrap" style="display:none"></div>'
        + '<div class="f-panel-notes" style="display:none"></div>'
        + '</div>'
        + '</div>'
    , headTpl     = '<th range=":from:-:to:">:head:'
    , itemTpl     = '<tr class="dash-item f-item" id=":id:" item-name=":name:"><td class="dash-first-cell f-first-cell" style="padding-left::pl:.2rem"><div class="show-id"><span onclick="dashCopy2Buffer(:id:)">:id:</span>'
        + ' <a href="/' + db + '/table/997?F_U=:panel-id:&F_I=:id:" target="edit-item">'
        + '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-top:-4px;">'
        + '<path d="M17.2857 13.09V17.2857C17.2857 17.7025 17.1201 18.1022 16.8254 18.3969C16.5307 18.6916 16.1311 18.8572 15.7143 18.8572H4.71428C4.29751 18.8572 3.89781 18.6916 3.60311 18.3969C3.30841 18.1022 3.14285 17.7025 3.14285 17.2857V6.28574C3.14285 5.86897 3.30841 5.46927 3.60311 5.17457C3.89781 4.87987 4.29751 4.71431 4.71428 4.71431H8.91M15.7143 3.14288L18.8571 6.28574L11 14.1429H7.85714V11L15.7143 3.14288Z" stroke="lightgray" stroke-linecap="round" stroke-linejoin="round"></path>'
        + '</svg></a></div>'
        + ':name:'
    , cellTpl     = '<td range=":from:-:to:" ready=":ready:" class="f-cell :classes:" align="right" title=":title:" data-src=":src:" data-item-id=":item-id:":extra:>:val:';

let dashModelData = {}, dashPeriodData = {}, dashPeriods = {}, dashValues = {}, dashValueErrors = {}, dashFormulas = {}, dashItems = {}, dashReports = {}, dashReportNames = {}, dashReportIds = {}, dashReportHeaders = {}, dashReportKeys = {}, dashReportSources = {}, dashVizReports = {}, dashPanelValues = {}, dashPanelValueErrors = {}, dashPanelFilters = {}, dashAjaxes = 0;
// Issue 2718: алиасы запросов id↔name из X-Query-* заголовков; очередь row-fetch'ей, ждущих panel-fetch.
let dashQueryNameById = {}, dashQueryIdByName = {}, dashPendingPanelRows = {};
// Issue 2727: индекс panelQuery по id и имени для кросс-панельного шаринга row-fetch'ей.
// Заполняется pre-pass'ом до основного цикла, чтобы строка из панели B могла найти панель A
// с подходящим panelQuery даже если A идёт в JSON позже. Server-filter хранится тут же —
// сравнение dashModelData[candidate].panelFilter не сработало бы, пока главный цикл не дошёл до A.
// hasItems нужен потому что dashGetPanelValues пропускает панель без .f-item, и данные в
// dashReports[panelReportKey] не попадут — кросс-панельный шаринг для такой панели бесполезен.
let dashPanelKeyByRef = {}, dashPanelServerFilterByKey = {}, dashPanelHasItemsByKey = {};
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

function dashCellValueFormat(rowId) {
    var item = dashItems && dashItems[rowId];
    return String((item && item.format) || '').toUpperCase();
}

function dashCellFormatAttribute(rowId) {
    var format = dashCellValueFormat(rowId);
    return format ? ' data-format="' + dashAttr(format) + '"' : '';
}

function dashEscapeHtml(v) {
    return String(v === null || v === undefined ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function dashMarkdownInline(text) {
    var placeholders = []
        , s = dashEscapeHtml(text);
    function hold(html) {
        var token = '\u0000' + placeholders.length + '\u0000';
        placeholders.push(html);
        return token;
    }
    s = s.replace(/`([^`]+)`/g, function(match, code) {
        return hold('<code>' + code + '</code>');
    });
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|\/[^\s)]*)\)/g, function(match, label, href) {
        return hold('<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + label + '</a>');
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,;:!?])/g, '$1<em>$2</em>');
    s = s.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,;:!?])/g, '$1<em>$2</em>');
    s = s.replace(/\\([\\`*_\[\]()#+\-.!])/g, '$1');
    placeholders.forEach(function(html, i) {
        s = s.replace(new RegExp('\u0000' + i + '\u0000', 'g'), html);
    });
    return s;
}

function dashMarkdownToHtml(markdown) {
    var lines = String(markdown === null || markdown === undefined ? '' : markdown).replace(/\r\n?/g, '\n').split('\n')
        , html = []
        , paragraph = []
        , listType = ''
        , listItems = [];

    function flushParagraph() {
        if (!paragraph.length) return;
        html.push('<p>' + paragraph.map(dashMarkdownInline).join('<br>') + '</p>');
        paragraph = [];
    }

    function flushList() {
        if (!listType) return;
        html.push('<' + listType + '>' + listItems.map(function(item) {
            return '<li>' + dashMarkdownInline(item) + '</li>';
        }).join('') + '</' + listType + '>');
        listType = '';
        listItems = [];
    }

    lines.forEach(function(line) {
        var trimmed = line.trim(), m;
        if (!trimmed) {
            flushParagraph();
            flushList();
            return;
        }

        m = line.match(/^(\s*)([-*+])\s+(.+)$/);
        if (m) {
            flushParagraph();
            if (listType && listType !== 'ul') flushList();
            listType = 'ul';
            listItems.push(m[3]);
            return;
        }

        m = line.match(/^(\s*)\d+[.)]\s+(.+)$/);
        if (m) {
            flushParagraph();
            if (listType && listType !== 'ol') flushList();
            listType = 'ol';
            listItems.push(m[2]);
            return;
        }

        flushList();
        m = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (m) {
            flushParagraph();
            html.push('<p><strong>' + dashMarkdownInline(m[2]) + '</strong></p>');
            return;
        }
        paragraph.push(trimmed);
    });

    flushParagraph();
    flushList();
    return html.join('');
}

function dashSetPanelNotes(panelEl, notes) {
    var notesEl = panelEl && panelEl.querySelector ? panelEl.querySelector('.f-panel-notes') : null
        , html = dashMarkdownToHtml(notes);
    if (!notesEl) return;
    notesEl.innerHTML = html;
    notesEl.style.display = html ? '' : 'none';
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

// Returns the source-value parse error (if any) for a given item/column pair,
// preferring the panel-scoped bucket when a panelKey is supplied. Falls back
// to the item-only key so the cell still highlights when colGroup info isn't
// available on the error record.
function dashLookupValueError(itemName, colName, panelKey) {
    var itemKey = (itemName || '').toLowerCase()
        , colKey = (colName || '').toLowerCase()
        , scoped = panelKey ? dashPanelValueErrors[panelKey] : null
        , scopedHit = scoped && (scoped[colKey ? itemKey + ':' + colKey : itemKey] || scoped[itemKey])
        , globalHit = dashValueErrors[colKey ? itemKey + ':' + colKey : itemKey] || dashValueErrors[itemKey];
    return scopedHit || globalHit || null;
}

// Marks the cell that was just appended to `row` with the .dash-err class and
// a title that surfaces the parse error and the raw expression so the user
// can see why the cell is empty — instead of the row silently disappearing.
function dashMarkCellErrorIfAny(row, itemName, colName, panelKey) {
    var info = dashLookupValueError(itemName, colName, panelKey);
    if (!info) return;
    var cell = row.lastElementChild;
    if (!cell) return;
    cell.classList.add('dash-err');
    cell.setAttribute('title', info.error + ' | ' + info.raw);
}

function dashFormatNumberText(v) {
    if (v === null || v === undefined) return '';
    var raw = String(v).trim()
        , normalized, sign = '', percent = '', parts, whole, fraction, decimalSep;
    if (!raw) return '';
    normalized = dashNormalizeNumberText(raw);
    if (normalized === '') return String(v);
    if (/%\s*$/.test(raw)) percent = '%';
    if (normalized.charAt(0) === '+' || normalized.charAt(0) === '-') {
        sign = normalized.charAt(0);
        normalized = normalized.slice(1);
    }
    parts = normalized.split('.');
    whole = parts[0] || '0';
    fraction = parts.length > 1 ? parts.slice(1).join('') : '';
    if (whole.length > 1 && whole.charAt(0) === '0') return raw;
    decimalSep = fraction && raw.lastIndexOf(',') > raw.lastIndexOf('.') ? ',' : '.';
    whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return sign + whole + (fraction ? decimalSep + fraction : '') + percent;
}

function dashGetFloat(v) {
    return parseFloat(dashNormalizeNumberText(v));
}

// Like dashGetFloat but treats the string 'null' (and JS null) as a chart gap (issue #2586)
// When convertMinusOneToNull is true, also converts -1 to null (issue #2632)
function dashChartMeasureValue(raw, convertMinusOneToNull) {
    if (raw === null || raw === 'null') return null;
    var n = dashGetFloat(raw);
    if (isNaN(n)) return 0;
    if (convertMinusOneToNull && n === -1) return null;
    return n;
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

// Find the cached metadata entry for a given object type id.
// dashMetadata may be an array of {id, reqs, ...} (the typical /metadata
// payload — see js/integram-table/16-state.js) or an object keyed by id.
function dashFindTypeMetadata(typeId) {
    if (!dashMetadata) return null;
    var key = String(typeId);
    var num = Number(typeId);
    if (Array.isArray(dashMetadata)) {
        for (var i = 0; i < dashMetadata.length; i++) {
            var item = dashMetadata[i];
            if (item && (String(item.id) === key || item.id === num)) return item;
        }
        return null;
    }
    if (typeof dashMetadata === 'object') {
        return dashMetadata[key] || dashMetadata[num] || null;
    }
    return null;
}

// Returns the index in a JSON_OBJ record's `r` array where the given req
// field lives, or -1 if not resolvable. Layout: r[0] = main value,
// r[1..N] = reqs in metadata.reqs order (issue #857).
function dashRecordReqIndex(typeId, fieldId) {
    var meta = dashFindTypeMetadata(typeId);
    if (!meta || !Array.isArray(meta.reqs)) return -1;
    for (var i = 0; i < meta.reqs.length; i++) {
        if (meta.reqs[i] && String(meta.reqs[i].id) === String(fieldId)) return i + 1;
    }
    return -1;
}

// Reads the dashboard label off a record returned by object/<type>?JSON_OBJ.
// JSON_OBJ payloads expose values only via the positional `r` array — there
// is no `rec['Метка']` key — so we resolve the index via cached metadata
// and fall back to the last req when metadata is unavailable (the dashboard
// schemas keep the label field as the trailing req on both 1010 and 155551).
function dashRecordLabel(rec, typeId, labelFieldId) {
    if (!rec) return '';
    if (Object.prototype.hasOwnProperty.call(rec, 'Метка')) return rec['Метка'] || '';
    if (!Array.isArray(rec.r)) return '';
    var idx = dashRecordReqIndex(typeId, labelFieldId);
    if (idx >= 0 && idx < rec.r.length) return rec.r[idx] || '';
    return rec.r[rec.r.length - 1] || '';
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

function dashPanelFilterPartIsLocal(part) {
    return part.indexOf('=') === -1 && part.indexOf(':') > 0;
}

function dashPanelFilterParts(panelFilter) {
    var result = { server: [], local: [] }
        , filter = String(panelFilter || '').trim().replace(/^[?&]+/, '');
    if (!filter) return result;
    filter.split('&').forEach(function(part) {
        part = String(part || '').trim().replace(/^[?&]+/, '');
        if (!part) return;
        if (dashPanelFilterPartIsLocal(part))
            result.local.push(part);
        else
            result.server.push(part);
    });
    return result;
}

function dashDecodePanelFilterPart(part) {
    var text = String(part || '').replace(/\+/g, ' ');
    try {
        return decodeURIComponent(text);
    } catch (e) {
        return text;
    }
}

function dashNormalizePanelFilter(panelFilter) {
    var filter = String(panelFilter || '').trim().replace(/^[?&]+/, '');
    if (!filter) return '';
    return filter.split('&').map(function(part) {
        return String(part || '').trim().replace(/^[?&]+/, '');
    }).filter(function(part) {
        return part && !(part.indexOf('=') === -1 && part.indexOf(':') > 0);
    }).join('&');
}

function dashPanelLocalFilterState(panelFilter) {
    var filters = {};
    dashPanelFilterParts(panelFilter).local.forEach(function(part) {
        var idx = part.indexOf(':')
            , field = dashDecodePanelFilterPart(part.slice(0, idx)).trim()
            , value = dashDecodePanelFilterPart(part.slice(idx + 1)).trim()
            , key, filterValue;
        if (!field) return;
        key = 'panelFilter:' + field;
        filterValue = dashPanelFilterValueKey(value, 'values', 'text');
        if (!filters[key])
            filters[key] = { source: 'report', field: field, kind: 'values', valueType: 'text', selected: [] };
        if (filters[key].selected.indexOf(filterValue) === -1)
            filters[key].selected.push(filterValue);
    });
    return filters;
}

function dashMergePanelFilterState(target, incoming) {
    target = target || {};
    Object.keys(incoming || {}).forEach(function(key) {
        var src = incoming[key]
            , dst = target[key];
        if (!dst) {
            target[key] = Object.assign({}, src, {
                selected: Array.isArray(src.selected) ? src.selected.slice() : src.selected
            });
            return;
        }
        if (Array.isArray(src.selected) && Array.isArray(dst.selected)) {
            src.selected.forEach(function(value) {
                if (dst.selected.indexOf(value) === -1) dst.selected.push(value);
            });
        } else {
            target[key] = Object.assign({}, src, {
                selected: Array.isArray(src.selected) ? src.selected.slice() : src.selected
            });
        }
    });
    return target;
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

function dashResolvePanelVizReportId(row) {
    var keys = [
        'panelChartReportID', 'panelChartReportId', 'panelChartQueryID', 'panelChartQueryId',
        'chartReportID', 'chartReportId', 'chartQueryID', 'chartQueryId',
        'chartReport', 'chartQuery',
        'vizReportID', 'vizReportId', 'vizQueryID', 'vizQueryId',
        'vizReport', 'vizQuery',
        'panelReportID', 'panelReportId', 'panelQueryID', 'panelQueryId',
        'panelReport', 'panelQuery',
        'reportID', 'reportId', 'queryID', 'queryId', 'report', 'query',
        'ГрафикЗапросID', 'ГрафикЗапрос', 'ЗапросГрафикаID', 'ЗапросГрафика',
        'ЗапросID', 'ЗапросId', 'Запрос', 'ОтчетID', 'ОтчётID', 'Отчет', 'Отчёт'
    ];
    var i, key, value, match;
    if (!row) return '';
    for (i = 0; i < keys.length; i++) {
        key = keys[i];
        if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
        value = row[key];
        if (value === null || value === undefined) continue;
        value = String(value).trim();
        if (!value || value === '0') continue;
        match = value.match(/^\s*(\d+)(?::|$)/);
        return match ? match[1] : value;
    }
    return '';
}

// Issue 2718: разобрать panelQuery как {id, name, raw}. Формы: "155564", "Имя", "155564:Имя".
// Используется чтобы строки, чьи формулы ссылаются на тот же запрос (по id или по имени),
// шарили данные panel-fetch'а вместо отдельного запроса.
function dashPanelQueryParts(row) {
    var keys = [
        'panelReportID', 'panelReportId', 'panelQueryID', 'panelQueryId',
        'panelReport', 'panelQuery',
        'reportID', 'reportId', 'queryID', 'queryId', 'report', 'query',
        'ЗапросID', 'ЗапросId', 'Запрос', 'ОтчетID', 'ОтчётID', 'Отчет', 'Отчёт'
    ];
    var i, key, value, m, parts = null;
    if (!row) return null;
    for (i = 0; i < keys.length; i++) {
        key = keys[i];
        if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
        value = row[key];
        if (value === null || value === undefined) continue;
        value = String(value).trim();
        if (!value || value === '0') continue;
        m = value.match(/^\s*(\d+)\s*(?::\s*(.+?)\s*)?$/);
        parts = m ? { id: m[1], name: m[2] || '', raw: value } : { id: '', name: value, raw: value };
        break;
    }
    if (!parts) return null;
    if (parts.id && !parts.name && dashQueryNameById[parts.id])
        parts.name = dashQueryNameById[parts.id];
    if (parts.name && !parts.id && dashQueryIdByName[parts.name.toLowerCase()])
        parts.id = dashQueryIdByName[parts.name.toLowerCase()];
    return parts;
}

function dashRefMatchesPanelQuery(rowRef, parts) {
    if (!parts || !rowRef) return false;
    var s = String(rowRef).trim();
    if (!s) return false;
    if (parts.id && s === parts.id) return true;
    if (parts.name && s.toLowerCase() === parts.name.toLowerCase()) return true;
    return false;
}

// Issue 2727: найти панель, чей panelQuery соответствует row-ref'у, для кросс-панельного шаринга.
// Шаринг безопасен только если server-side panelFilter совпадает — иначе данные на сервере
// отфильтрованы по-разному (FR_dept=1 vs FR_dept=2). Локальные ":"-фильтры применяются per-cell
// в dashGetRepVals и шарингу не мешают.
function dashFindPanelForRowRef(rowRef, rowPanelFilter, ownPanelKey) {
    var s = String(rowRef || '').trim();
    if (!s) return '';
    var sLower = s.toLowerCase()
        , rowServerFilter = dashNormalizePanelFilter(rowPanelFilter)
        , candidate = dashPanelKeyByRef[s] || dashPanelKeyByRef[sLower];
    if (!candidate || candidate === ownPanelKey) return '';
    // Сравниваем по индексу, а не по dashModelData[candidate]: целевая панель может ещё
    // не быть создана в основном цикле (если её строки идут в JSON позже текущей).
    if (dashPanelServerFilterByKey[candidate] !== rowServerFilter) return '';
    // dashGetPanelValues пропускает панели без .f-item — без её ответа данные в
    // dashReports[panelReportKey] не появятся и очередь не разойдётся.
    if (!dashPanelHasItemsByKey[candidate]) return '';
    return candidate;
}

function dashVizReportKey(reportId, panelFilter) {
    return JSON.stringify(['viz', String(reportId || ''), dashNormalizePanelFilter(panelFilter)]);
}

function dashVizReportUrl(reportId, fr, to, panelFilter) {
    var url = 'report/' + reportId + '?JSON&FR_Date=' + fr + '&TO_Date=' + to
        , filter = dashNormalizePanelFilter(panelFilter);
    if (filter) url += '&' + filter;
    return url;
}

function dashNormalizeReportJson(json) {
    var rawColumns = (json && Array.isArray(json.columns)) ? json.columns : []
        , columns = []
        , rows = []
        , data = json && json.data
        , i, j, rowCount = 0, row, col, value;

    rawColumns.forEach(function(column, idx) {
        var name = String((column && (column.name || column.val || column.id)) || ('Колонка ' + (idx + 1)));
        columns.push({
            id: String((column && column.id !== undefined && column.id !== null) ? column.id : name),
            name: name,
            type: column ? column.type : '',
            format: String((column && column.format) || '').toUpperCase(),
            ref: column ? column.ref : undefined,
            granted: column ? column.granted : undefined,
            totals: column && Object.prototype.hasOwnProperty.call(column, 'totals') ? column.totals : undefined,
            index: idx
        });
    });

    if (!Array.isArray(data)) data = [];

    if (data.length === columns.length && data.every(function(colData) { return Array.isArray(colData); })) {
        data.forEach(function(colData) {
            if (colData.length > rowCount) rowCount = colData.length;
        });
        for (i = 0; i < rowCount; i++) {
            row = {};
            for (j = 0; j < columns.length; j++) {
                row[columns[j].name] = data[j] && data[j][i] !== undefined ? data[j][i] : '';
            }
            rows.push(row);
        }
    } else if (data.length === columns.length && data.length && data.every(function(cell) {
        return !Array.isArray(cell) && (cell === null || typeof cell !== 'object');
    })) {
        row = {};
        columns.forEach(function(column, idx) {
            row[column.name] = data[idx] !== undefined ? data[idx] : '';
        });
        rows.push(row);
    } else {
        data.forEach(function(rawRow) {
            row = {};
            if (Array.isArray(rawRow)) {
                columns.forEach(function(column, idx) {
                    row[column.name] = rawRow[idx] !== undefined ? rawRow[idx] : '';
                });
            } else if (rawRow && typeof rawRow === 'object') {
                columns.forEach(function(column) {
                    if (Object.prototype.hasOwnProperty.call(rawRow, column.name))
                        value = rawRow[column.name];
                    else if (Object.prototype.hasOwnProperty.call(rawRow, column.id))
                        value = rawRow[column.id];
                    else
                        value = '';
                    row[column.name] = value;
                });
            }
            rows.push(row);
        });
    }

    return {
        header: json && json.header ? json.header : '',
        columns: columns,
        rows: rows
    };
}

function dashReportColumnByField(columns, field) {
    var i, key = String(field || '');
    if (!key) return null;
    for (i = 0; i < (columns || []).length; i++)
        if (String(columns[i].id) === key) return columns[i];
    for (i = 0; i < (columns || []).length; i++)
        if (String(columns[i].name) === key) return columns[i];
    return null;
}

function dashReportColumnIsNumeric(column) {
    var format = String((column && column.format) || '').toUpperCase();
    return /^(NUMBER|SIGNED|NUMERIC|INT|INTEGER|FLOAT|DOUBLE|DECIMAL|MONEY|CURRENCY|PERCENT)$/.test(format);
}

function dashReportColumnNameHasIdSuffix(column) {
    var name = String((column && column.name) || '').trim();
    return /(^|[\s_-])(id|ид)$/i.test(name) || /(ID|ИД)$/.test(name);
}

function dashReportColumnIsStyle(column) {
    var name = String((column && column.name) || '')
        , lower = name.toLowerCase();
    return lower === 'style' || lower.slice(-6) === '.style';
}

function dashReportStyleTargetName(column) {
    var name = String((column && column.name) || '')
        , lower = name.toLowerCase();
    if (lower === 'style') return '';
    return lower.slice(-6) === '.style' ? name.slice(0, -6) : '';
}

function dashReportColumnIsMeasure(column) {
    if (!dashReportColumnIsNumeric(column)) return false;
    if (dashReportColumnIsStyle(column)) return false;
    if (column && column.ref) return false;
    if (dashReportColumnNameHasIdSuffix(column)) return false;
    return true;
}

function dashReportColumnIsVisible(column) {
    return !!column && !dashReportColumnNameHasIdSuffix(column) && !dashReportColumnIsStyle(column);
}

function dashReportVisibleColumns(columns) {
    return (columns || []).filter(dashReportColumnIsVisible);
}

function dashReportColumnIsDimension(column) {
    return !!column && !dashReportColumnIsStyle(column) && !dashReportColumnIsMeasure(column);
}

function dashReportDefaultColumn(columns, preferredField, predicate) {
    var i, col = dashReportColumnByField(columns, preferredField);
    if (col && (!predicate || predicate(col))) return col;
    for (i = 0; i < (columns || []).length; i++)
        if (!predicate || predicate(columns[i])) return columns[i];
    return (columns && columns[0]) || null;
}

function dashReportRowValue(row, column) {
    if (!row || !column) return '';
    return row[column.name] !== undefined && row[column.name] !== null ? row[column.name] : '';
}

function dashReportValueText(value) {
    return value === undefined || value === null ? '' : String(value);
}

function dashReportColumnStyleKey(column) {
    var id = column && column.id;
    return String(id !== undefined && id !== null && id !== '' ? id : (column && column.name) || '');
}

function dashReportRowCellStyles(row, allColumns, visibleColumns) {
    var styles = {}
        , visibleByName = {}
        , previousVisibleColumn = null;

    (visibleColumns || []).forEach(function(column) {
        var name = String((column && column.name) || '');
        if (!visibleByName[name]) visibleByName[name] = column;
    });

    (allColumns || []).forEach(function(column) {
        var styleText, targetName, targetColumn, key;
        if (!dashReportColumnIsStyle(column)) {
            if (dashReportColumnIsVisible(column)) previousVisibleColumn = column;
            return;
        }

        styleText = dashReportValueText(dashReportRowValue(row, column)).trim();
        if (!styleText) return;

        targetName = dashReportStyleTargetName(column);
        targetColumn = targetName ? visibleByName[targetName] : null;
        if (!targetColumn) targetColumn = previousVisibleColumn;
        if (!targetColumn) return;

        key = dashReportColumnStyleKey(targetColumn);
        styles[key] = styles[key] ? styles[key] + '; ' + styleText : styleText;
    });

    return styles;
}

function dashReportColumnIsHtml(column) {
    return String((column && column.format) || '').toUpperCase() === 'HTML';
}

function dashReportColumnAlign(column) {
    var format = String((column && column.format) || '').toUpperCase();
    if (dashReportColumnIsNumeric(column)) return 'right';
    if (/^(DATE|DATETIME|TIME|MONTH|BOOLEAN)$/.test(format)) return 'center';
    return 'left';
}

function dashReportHasTotals(report) {
    return (report && report.columns || []).some(function(column) {
        return column
            && column.totals !== undefined
            && column.totals !== null
            && dashReportValueText(column.totals).trim() !== '';
    });
}

function dashReportTableCellHtml(tagName, column, value, extraClass, styleText) {
    var format = String((column && column.format) || '').toUpperCase()
        , align = dashReportColumnAlign(column)
        , classes = ['dash-report-cell', 'dash-report-cell--' + align]
        , text = tagName === 'td' && dashReportColumnIsNumeric(column)
            ? dashFormatNumberText(value)
            : dashReportValueText(value)
        , content = (tagName === 'td' && dashReportColumnIsHtml(column)) ? text : dashEscapeHtml(text)
        , inlineStyle = tagName === 'td' ? dashReportValueText(styleText).trim() : '';
    if (extraClass) classes.push(extraClass);
    return '<' + tagName
        + ' class="' + classes.join(' ') + '"'
        + ' data-format="' + dashAttr(format) + '"'
        + ' data-column-id="' + dashAttr(column ? column.id : '') + '"'
        + (inlineStyle ? ' style="' + dashAttr(inlineStyle) + '"' : '')
        + '>'
        + content
        + '</' + tagName + '>';
}

function dashRenderReportTableHtml(report, filters) {
    var allColumns = report ? report.columns || [] : []
        , columns = dashReportVisibleColumns(allColumns)
        , rows = dashFilterReportRowsForPanel(report ? report.rows || [] : [], filters || {})
        , html = '<table class="table table-sm table-bordered w-auto dash-report-table" data-dash-report-table="1"><thead>'
        , hasTotals = dashReportHasTotals({ columns: columns });

    html += '<tr class="dash-head f-head">';
    columns.forEach(function(column) {
        html += dashReportTableCellHtml('th', column, column.name, 'dash-report-head-cell');
    });
    if (!columns.length)
        html += '<th></th>';
    html += '</tr></thead><tbody>';

    rows.forEach(function(row) {
        var rowStyles = dashReportRowCellStyles(row, allColumns, columns);
        html += '<tr class="dash-report-row">';
        columns.forEach(function(column) {
            html += dashReportTableCellHtml('td', column, dashReportRowValue(row, column), '', rowStyles[dashReportColumnStyleKey(column)]);
        });
        if (!columns.length)
            html += '<td></td>';
        html += '</tr>';
    });
    html += '</tbody>';

    if (hasTotals) {
        html += '<tfoot><tr class="dash-report-totals-row">';
        columns.forEach(function(column) {
            html += dashReportTableCellHtml('td', column, column.totals, 'dash-report-total-cell');
        });
        html += '</tr></tfoot>';
    }

    html += '</table>';
    return html;
}

function dashRenderReportTable(panelEl) {
    var report = dashPanelGetVizReportData(panelEl)
        , tableWrap = panelEl ? panelEl.querySelector('.f-table-wrap') : null;
    if (!report || !tableWrap || (panelEl && panelEl.querySelector('.f-item'))) return false;
    tableWrap.innerHTML = dashRenderReportTableHtml(report, dashPanelFiltersFor(panelEl));
    dashEnsureTableResizeHandle(panelEl);
    return true;
}

function dashReportValueLabel(value) {
    value = String(value === undefined || value === null ? '' : value).trim();
    return value || '(пусто)';
}

function dashPanelDateValue(value) {
    var s = String(value === undefined || value === null ? '' : value).trim()
        , m;
    if (!s) return '';
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    if (m) return m[3] + '-' + m[2] + '-' + m[1];
    m = s.match(/^(\d{4})-(\d{2})$/);
    if (m) return m[1] + '-' + m[2] + '-01';
    m = s.match(/^(\d{2})\.(\d{4})$/);
    if (m) return m[2] + '-' + m[1] + '-01';
    return '';
}

function dashPanelMonthValue(value) {
    var s = String(value === undefined || value === null ? '' : value).trim()
        , m;
    if (!s) return '';
    m = s.match(/^(\d{4})-(\d{2})(?:-\d{2})?/);
    if (m) return m[1] + '-' + m[2];
    m = s.match(/^(\d{4})(\d{2})(?:\d{2})?$/);
    if (m) return m[1] + '-' + m[2];
    m = s.match(/^(\d{2})\.(\d{4})$/);
    if (m) return m[2] + '-' + m[1];
    m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    if (m) return m[3] + '-' + m[2];
    return '';
}

function dashPanelFilterValueKey(value, kind, valueType) {
    var n, dateValue, monthValue;
    if (kind === 'month') {
        monthValue = dashPanelMonthValue(value);
        return monthValue || String(value === undefined || value === null ? '' : value).trim();
    }
    if (valueType === 'date') {
        dateValue = dashPanelDateValue(value);
        return dateValue || String(value === undefined || value === null ? '' : value).trim();
    }
    if (valueType === 'number') {
        n = dashGetFloat(value);
        return isNaN(n) ? '' : String(n);
    }
    return String(value === undefined || value === null ? '' : value).trim();
}

function dashPanelFilterFieldKind(column, values) {
    var name = String((column && (column.name || column.id)) || '')
        , format = String((column && column.format) || '').toUpperCase()
        , nonEmpty = (values || []).filter(function(value) {
            return String(value === undefined || value === null ? '' : value).trim() !== '';
        })
        , monthName = /(^|[\s_-])(месяц|month)([\s_-]|$)/i.test(name) || format === 'MONTH'
        , allMonthValues = nonEmpty.length > 0 && nonEmpty.every(function(value) { return !!dashPanelMonthValue(value); })
        , allDateValues = nonEmpty.length > 0 && nonEmpty.every(function(value) { return !!dashPanelDateValue(value); })
        , allNumericValues = nonEmpty.length > 0 && nonEmpty.every(function(value) { return !isNaN(dashGetFloat(value)); });

    if (monthName || (format === 'MONTH' && allMonthValues))
        return { kind: 'month', valueType: 'month' };
    if (allMonthValues && /(^|[\s_-])(период|period)([\s_-]|$)/i.test(name))
        return { kind: 'month', valueType: 'month' };
    if (/^(DATE|DATETIME)$/.test(format) || allDateValues)
        return { kind: 'range', valueType: 'date' };
    if (dashReportColumnIsNumeric(column) || allNumericValues)
        return { kind: 'range', valueType: 'number' };
    return { kind: 'values', valueType: 'text' };
}

function dashPanelAddFilterOption(field, rawValue) {
    var key = dashPanelFilterValueKey(rawValue, field.kind, field.valueType)
        , label = String(rawValue === undefined || rawValue === null ? '' : rawValue).trim();
    if (!field._seen) field._seen = {};
    if (field._seen[key]) return;
    field._seen[key] = true;
    field.options.push({
        value: key,
        label: label || (key || '(пусто)')
    });
}

function dashBuildReportFilterFields(columns, rows) {
    var fields = [];
    (columns || []).forEach(function(column) {
        if (dashReportColumnIsStyle(column)) return;

        var values = (rows || []).map(function(row) { return dashReportRowValue(row, column); })
            , kindInfo = dashPanelFilterFieldKind(column, values)
            , field = {
                source: 'report',
                key: 'report:' + String((column && (column.name || column.id)) || ''),
                field: String((column && (column.name || column.id)) || ''),
                label: String((column && (column.name || column.id)) || ''),
                kind: kindInfo.kind,
                valueType: kindInfo.valueType,
                options: []
            }
            , min = null, max = null;

        if (!field.field) return;

        if (field.kind === 'range') {
            values.forEach(function(value) {
                var normalized = dashPanelFilterValueKey(value, field.kind, field.valueType)
                    , comparable;
                if (!normalized) return;
                comparable = field.valueType === 'number' ? parseFloat(normalized) : normalized;
                if (field.valueType === 'number' && !isFinite(comparable)) return;
                if (min === null || comparable < min) min = comparable;
                if (max === null || comparable > max) max = comparable;
            });
            if (min === null && max === null) return;
            field.min = String(min);
            field.max = String(max);
        } else {
            values.forEach(function(value) { dashPanelAddFilterOption(field, value); });
            field.options.sort(function(a, b) {
                return String(a.value).localeCompare(String(b.value), undefined, { numeric: true });
            });
            delete field._seen;
            if (!field.options.length) return;
        }

        fields.push(field);
    });
    return fields;
}

function dashPanelFilterIsActive(filter) {
    if (!filter) return false;
    if (filter.kind === 'values' || filter.kind === 'month')
        return Array.isArray(filter.selected);
    if (filter.kind === 'range')
        return !!(String(filter.from || '').trim() || String(filter.to || '').trim());
    return false;
}

function dashPanelReportRowPassesFilter(row, filter) {
    var raw, value, from, to, n, selected;
    if (!dashPanelFilterIsActive(filter) || filter.source === 'table') return true;
    if (!row || !Object.prototype.hasOwnProperty.call(row, filter.field)) return true;
    raw = row[filter.field];

    if (filter.kind === 'values' || filter.kind === 'month') {
        selected = {};
        (filter.selected || []).forEach(function(item) { selected[String(item)] = true; });
        value = dashPanelFilterValueKey(raw, filter.kind, filter.valueType);
        return !!selected[value];
    }

    if (filter.kind === 'range' && filter.valueType === 'number') {
        n = dashGetFloat(raw);
        if (isNaN(n)) return false;
        from = String(filter.from || '').trim();
        to = String(filter.to || '').trim();
        if (from && n < parseFloat(from)) return false;
        if (to && n > parseFloat(to)) return false;
        return true;
    }

    if (filter.kind === 'range' && filter.valueType === 'date') {
        value = dashPanelDateValue(raw);
        if (!value) return false;
        from = String(filter.from || '').trim();
        to = String(filter.to || '').trim();
        if (from && value < from) return false;
        if (to && value > to) return false;
        return true;
    }

    return true;
}

function dashFilterReportRowsForPanel(rows, filters) {
    var active = [];
    Object.keys(filters || {}).forEach(function(key) {
        var filter = filters[key];
        if (filter && filter.source !== 'table' && dashPanelFilterIsActive(filter))
            active.push(filter);
    });
    if (!active.length) return rows || [];
    return (rows || []).filter(function(row) {
        return active.every(function(filter) {
            return dashPanelReportRowPassesFilter(row, filter);
        });
    });
}

function dashReportAddOrdered(order, seen, value) {
    var key = String(value);
    if (seen[key]) return;
    seen[key] = true;
    order.push(value);
}

function dashCollectReportVizData(report, vizConfig) {
    var config = vizConfig || {}
        , fieldMap = config.fieldMap || {}
        , type = config.type || 'line'
        , columns = report ? report.columns || [] : []
        , rows = dashFilterReportRowsForPanel(report ? report.rows || [] : [], config.filters || {})
        , labelCol, valueCol, seriesCol, xCol, yCol, rCol
        , labels = [], datasets = [], labelSeen = {}, seriesSeen = {}, seriesOrder = [], buckets = {}
        , records;

    if (!rows.length) return { labels: [], datasets: [], records: [], columns: columns };

    records = rows.map(function(row) {
        var rec = {};
        columns.forEach(function(column) {
            var raw = dashReportRowValue(row, column)
                , n;
            if (dashReportColumnIsMeasure(column)) {
                rec[column.name] = dashChartMeasureValue(raw, config.convertMinusOneToNull);
            } else {
                rec[column.name] = raw;
            }
        });
        return rec;
    });

    if (type === 'bubble') {
        xCol = dashReportDefaultColumn(columns, fieldMap.bubbleX, dashReportColumnIsMeasure);
        yCol = dashReportDefaultColumn(columns, fieldMap.bubbleY, function(col) { return dashReportColumnIsMeasure(col) && (!xCol || col.id !== xCol.id); }) || xCol;
        rCol = dashReportDefaultColumn(columns, fieldMap.bubbleR, function(col) {
            return dashReportColumnIsMeasure(col) && (!xCol || col.id !== xCol.id) && (!yCol || col.id !== yCol.id);
        }) || yCol || xCol;
        labelCol = dashReportDefaultColumn(columns, fieldMap.labelField || fieldMap.bubbleLabel, dashReportColumnIsDimension) || columns[0];
        rows.forEach(function(row) {
            labels.push(dashReportValueLabel(dashReportRowValue(row, labelCol)));
        });
        return {
            labels: labels,
            datasets: [
                { label: xCol ? xCol.name : 'X', data: rows.map(function(row) { return dashGetFloat(dashReportRowValue(row, xCol)) || 0; }) },
                { label: yCol ? yCol.name : 'Y', data: rows.map(function(row) { return dashGetFloat(dashReportRowValue(row, yCol)) || 0; }) },
                { label: rCol ? rCol.name : 'Размер', data: rows.map(function(row) { return dashGetFloat(dashReportRowValue(row, rCol)) || 0; }) }
            ],
            records: records,
            columns: columns
        };
    }

    labelCol = dashReportDefaultColumn(columns, fieldMap.labelField || fieldMap.xField, dashReportColumnIsDimension) || columns[0];
    valueCol = dashReportDefaultColumn(columns, fieldMap.valueField, dashReportColumnIsMeasure);
    seriesCol = dashReportColumnByField(columns, fieldMap.seriesField);
    var stackCol = dashReportColumnByField(columns, fieldMap.stackField);
    if (stackCol && seriesCol && stackCol.id === seriesCol.id) stackCol = null;
    var stackOrder = [], stackSeen = {};

    rows.forEach(function(row) {
        var label = dashReportValueLabel(dashReportRowValue(row, labelCol))
            , series = seriesCol ? dashReportValueLabel(dashReportRowValue(row, seriesCol)) : (valueCol ? valueCol.name : 'Количество')
            , stack = stackCol ? dashReportValueLabel(dashReportRowValue(row, stackCol)) : null
            , value = valueCol ? dashChartMeasureValue(dashReportRowValue(row, valueCol), config.convertMinusOneToNull) : 1;
        dashReportAddOrdered(labels, labelSeen, label);
        dashReportAddOrdered(seriesOrder, seriesSeen, series);
        if (stackCol) dashReportAddOrdered(stackOrder, stackSeen, stack);
        if (!buckets[series]) buckets[series] = {};
        if (stackCol) {
            if (!buckets[series][stack]) buckets[series][stack] = {};
            buckets[series][stack][label] = value === null ? null : ((buckets[series][stack][label] || 0) + value);
        } else {
            buckets[series][label] = value === null ? null : ((buckets[series][label] || 0) + value);
        }
    });

    if (type === 'pie' || type === 'funnel') {
        datasets.push({
            label: valueCol ? valueCol.name : 'Количество',
            data: labels.map(function(label) {
                var sum = 0;
                seriesOrder.forEach(function(series) {
                    if (stackCol) {
                        stackOrder.forEach(function(stack) {
                            sum += (buckets[series] && buckets[series][stack] && buckets[series][stack][label]) || 0;
                        });
                    } else {
                        sum += (buckets[series] && buckets[series][label]) || 0;
                    }
                });
                return sum;
            })
        });
    } else if (stackCol) {
        seriesOrder.forEach(function(series) {
            stackOrder.forEach(function(stack) {
                datasets.push({
                    label: series + ' / ' + stack,
                    data: labels.map(function(label) {
                        var b = buckets[series] && buckets[series][stack];
                        return (b && label in b) ? b[label] : 0;
                    }),
                    _series: series,
                    _stack: stack
                });
            });
        });
    } else {
        seriesOrder.forEach(function(series) {
            datasets.push({
                label: series,
                data: labels.map(function(label) {
                    var b = buckets[series];
                    return (b && label in b) ? b[label] : 0;
                })
            });
        });
    }

    return { labels: labels, datasets: datasets, records: records, columns: columns };
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

function dashGetVal(item, fr, to, dashLabel, panelKey) {
    var i, acc = 0, valids = false, key = item ? item.toLowerCase() : item;
    var store = (panelKey && dashPanelValues[panelKey]) ? dashPanelValues[panelKey] : dashValues;
    if (!store[key]) return;
    var hasLabelFilter = dashLabel !== undefined;
    for (i in store[key]) {
        var entry = store[key][i];
        if (hasLabelFilter && !dashMatrixLabelMatches(dashLabel, entry['Метка'])) continue;
        if (!fr || (entry.date >= fr && entry.date <= to)) {
            valids = true;
            acc += dashGetFloat(entry.val);
        }
    }
    if (valids) return dashNormalizeVal(key, acc);
}

function dashGetColVal(item, col, dashLabel, panelKey) {
    var i, acc = 0, valids = false, key = item ? item.toLowerCase() : item, colLower = col ? col.toLowerCase() : col;
    var store = (panelKey && dashPanelValues[panelKey]) ? dashPanelValues[panelKey] : dashValues;
    if (!store[key]) return;
    var hasLabelFilter = dashLabel !== undefined;
    for (i in store[key]) {
        var entry = store[key][i];
        if (hasLabelFilter && !dashMatrixLabelMatches(dashLabel, entry['Метка'])) continue;
        if ((entry.col || '').toLowerCase() === colLower) {
            valids = true;
            acc += dashGetFloat(entry.val);
        }
    }
    if (valids) return dashNormalizeVal(key, acc);
}

// Build a comma-separated breakdown of contributing entries for a cell title.
// Mirrors the iteration in dashGetVal / dashGetColVal so the title lists every
// per-entry value that actually went into the displayed sum (issue #2677).
function dashFormatDetailEntry(entry, n) {
    var v = dashFormatNumberText(n), label = entry && entry['Метка'] ? String(entry['Метка']).trim() : '';
    var prefix = entry && entry.date ? String(entry.date) : '';
    if (label) prefix = prefix ? prefix + ' [' + label + ']' : '[' + label + ']';
    return prefix ? prefix + ': ' + v : v;
}

function dashGetValDetails(item, fr, to, dashLabel, panelKey) {
    var i, parts = [], key = item ? item.toLowerCase() : item;
    var store = (panelKey && dashPanelValues[panelKey]) ? dashPanelValues[panelKey] : dashValues;
    if (!store[key]) return '';
    var hasLabelFilter = dashLabel !== undefined;
    for (i in store[key]) {
        var entry = store[key][i];
        if (hasLabelFilter && !dashMatrixLabelMatches(dashLabel, entry['Метка'])) continue;
        if (!fr || (entry.date >= fr && entry.date <= to)) {
            var n = dashGetFloat(entry.val);
            if (isNaN(n)) continue;
            parts.push(dashFormatDetailEntry(entry, n));
        }
    }
    return parts.join(', ');
}

function dashGetColValDetails(item, col, dashLabel, panelKey) {
    var i, parts = [], key = item ? item.toLowerCase() : item, colLower = col ? col.toLowerCase() : col;
    var store = (panelKey && dashPanelValues[panelKey]) ? dashPanelValues[panelKey] : dashValues;
    if (!store[key]) return '';
    var hasLabelFilter = dashLabel !== undefined;
    for (i in store[key]) {
        var entry = store[key][i];
        if (hasLabelFilter && !dashMatrixLabelMatches(dashLabel, entry['Метка'])) continue;
        if ((entry.col || '').toLowerCase() === colLower) {
            var n = dashGetFloat(entry.val);
            if (isNaN(n)) continue;
            parts.push(dashFormatDetailEntry(entry, n));
        }
    }
    return parts.join(', ');
}

function dashResolveValueCell(rowId, groupName, panelKey) {
    var formula = dashFormulas[rowId] || ''
        , itemMeta = dashItems[rowId] || {}
        , itemName = (itemMeta.srcName || itemMeta.name || '')
        , dashLabel = itemMeta.label || ''
        , altName = formula.match(itemRegex)
        , valueName = altName ? altName[1] : itemName
        , groupedKey = groupName ? valueName + ':' + groupName : ''
        , isPanelScoped = !!(panelKey && dashPanelValues[panelKey])
        , rowValue = isPanelScoped ? undefined : dashValues[rowId]
        , groupedValue = groupedKey ? dashGetVal(groupedKey, undefined, undefined, dashLabel, panelKey) : undefined
        , plainValue = dashGetVal(valueName, undefined, undefined, dashLabel, panelKey)
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
        if (valids) el.innerHTML = dashFormatNumberText(v);
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
        // Missing operands turn the substituted formula into invalid JS
        // (`+++` etc.) and eval throws — show an empty cell instead of N/A
        // so dashboards read as "no data" rather than "broken" (issue #2660).
        val = '';
        console.log(e + ': ' + f);
    }
    el.innerHTML = dashFormatNumberText(val);
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
                    var rgColVal = el.getAttribute('data-rg-col');
                    // Use getElementById to avoid invalid CSS selectors when IDs start with digits (issue #2074)
                    var refEl = document.getElementById(refs[i]);
                    var cells = refEl ? refEl.querySelectorAll('.f-rg-cell[range="' + rangeVal + '"],.f-col-cell[range="' + rangeVal + '"]') : [];
                    var fallbackUsed = false;
                    if (cells.length === 0 && rangeVal === '-') {
                        // If no exact match and looking for "-", accept any range
                        cells = refEl ? refEl.querySelectorAll('.f-rg-cell,.f-col-cell') : [];
                        fallbackUsed = true;
                    }
                    // Plan/Fact sub-columns share the same range="from-to", so the selector
                    // above returns both; the non-global replace below would always pick the
                    // first (План), leaking Plan values into Факт cells. Restrict to the
                    // target cell's sub-column (issue #2652).
                    if (rgColVal !== null && cells.length > 1) {
                        var rgFilteredCells = Array.prototype.filter.call(cells, function(c) {
                            return c.getAttribute('data-rg-col') === rgColVal;
                        });
                        if (rgFilteredCells.length > 0) cells = rgFilteredCells;
                    }
                    dashTrace('formula-ref-lookup', {
                        itemId: itemId,
                        refId: refs[i],
                        range: rangeVal,
                        rgCol: rgColVal,
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
                // Empty operands turn the expression into invalid JS — show an
                // empty cell rather than N/A so missing data reads as "no data"
                // instead of "broken" (issue #2660).
                val = '';
                console.log('RGformula eval error: ' + e + ' in: ' + expr);
            }
            var valStr = val !== null && val !== undefined ? String(val) : '';
            el.innerHTML = dashFormatNumberText(valStr);
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
                        , panel = el.closest ? el.closest('.f-panel') : null
                        , panelFilters = (typeof dashPanelFiltersFor === 'function')
                            ? dashPanelFiltersFor(panel)
                            : (panel && typeof dashPanelFilters !== 'undefined' && dashPanelFilters[panel.id] ? dashPanelFilters[panel.id] : {})
                        , filteredReportRows = dashFilterReportRowsForPanel(reportRows, panelFilters)
                        , val;
                    if (restrictToReportGroup && !dashSameGroupName(group, parsed.report)) return;
                    val = dashResolveReportCellValue(filteredReportRows, date, range, parsed, group, groups);
                    if (val !== undefined) {
                        el.innerHTML = dashFormatNumberText(val);
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
                                var itemName = dashRowLookupName(row);
                                var s = dashCellSrc(row.id, 'rg');
                                var valueItemId = dashPanelValues[panelId] ? '' : (dashValueItemIds[(itemName || '').toLowerCase()] || '');
                                var rgHeadVal = dashModelData[panelId].rgs[rg].head || '';
                                var rowLabel = (dashItems[row.id] && dashItems[row.id].label) || '';
                                rgCols.forEach(function(colName) {
                                    var vDetails = '';
                                    v = dashGetVal(itemName + ':' + colName, fr, to, rowLabel, panelId);
                                    if (v !== undefined)
                                        vDetails = dashGetValDetails(itemName + ':' + colName, fr, to, rowLabel, panelId);
                                    else if (dashFormulas[row.id]) {
                                        if (dashFormulas[row.id] === '[]') {
                                            v = dashGetVal(itemName, fr, to, rowLabel, panelId);
                                            if (v !== undefined) vDetails = dashGetValDetails(itemName, fr, to, rowLabel, panelId);
                                        } else if (itemRegex.test(dashFormulas[row.id])) {
                                            var aliasItem = dashFormulas[row.id].match(itemRegex)[1];
                                            v = dashGetVal(aliasItem + ':' + colName, fr, to, rowLabel, panelId);
                                            if (v) {
                                                vDetails = dashGetValDetails(aliasItem + ':' + colName, fr, to, rowLabel, panelId);
                                            } else {
                                                v = dashGetVal(aliasItem, fr, to, rowLabel, panelId);
                                                if (v) vDetails = dashGetValDetails(aliasItem, fr, to, rowLabel, panelId);
                                                else v = '0';
                                            }
                                        }
                                    }
                                    var cellExtra = s.extra
                                        + (valueItemId ? ' data-value-item-id="' + valueItemId + '"' : '')
                                        + (rgHeadVal ? ' data-rg-head="' + rgHeadVal.replace(/"/g, '&quot;') + '"' : '')
                                        + (rowLabel ? ' data-dash-label="' + dashAttr(rowLabel) + '"' : '')
                                        + ' data-rg-col="' + colName.replace(/"/g, '&quot;') + '"'
                                        + dashCellFormatAttribute(row.id);
                                    var hasValue = v !== undefined && v !== '';
                                    var rowFormula = dashFormulas[row.id];
                                    var cellReady = hasValue || rowFormula === '[]' || !rowFormula ? '1' : '0';
                                    row.insertAdjacentHTML('beforeend',
                                        cellTpl.replace(':val:', dashFormatNumberText(v || ''))
                                            .replace(':ready:', cellReady)
                                            .replace(':title:', cellReady === '1' ? dashAttr(vDetails) : '')
                                            .replace(':classes:', 'f-rg-cell')
                                            .replace(':src:', s.src)
                                            .replace(':item-id:', row.id)
                                            .replace(':extra:', cellExtra)
                                            .replace(':from:', fr)
                                            .replace(':to:', to));
                                    dashMarkCellErrorIfAny(row, itemName, colName, panelId);
                                });
                            });
                        } else {
                            // No RGcolumns — original single-column behaviour
                            panel.querySelector('.f-head').insertAdjacentHTML('beforeend',
                                headTpl.replace(':head:', p[i].r[0]).replace(':from:', fr).replace(':to:', to));
                            panel.querySelectorAll('.f-item').forEach(function(row) {
                                var s = dashCellSrc(row.id, 'rg');
                                var itemName = dashRowLookupName(row);
                                var valueItemId = dashPanelValues[panelId] ? '' : (dashValueItemIds[(itemName || '').toLowerCase()] || '');
                                var rgHeadVal = dashModelData[panelId].rgs[rg].head || '';
                                var rowLabel = (dashItems[row.id] && dashItems[row.id].label) || '';
                                var vDetails = '';
                                v = dashGetVal(itemName, fr, to, rowLabel, panelId);
                                if (v !== undefined)
                                    vDetails = dashGetValDetails(itemName, fr, to, rowLabel, panelId);
                                else if (dashFormulas[row.id]) {
                                    if (dashFormulas[row.id] === '[]') {
                                        v = dashGetVal(itemName, fr, to, rowLabel, panelId);
                                        if (v !== undefined) vDetails = dashGetValDetails(itemName, fr, to, rowLabel, panelId);
                                    } else if (itemRegex.test(dashFormulas[row.id])) {
                                        var aliasItem = dashFormulas[row.id].match(itemRegex)[1];
                                        v = dashGetVal(aliasItem, fr, to, rowLabel, panelId);
                                        if (v) vDetails = dashGetValDetails(aliasItem, fr, to, rowLabel, panelId);
                                        else v = '0';
                                    }
                                }
                                var periodLabel = p[i].r[0] || '';
                                var cellExtra = s.extra
                                    + (valueItemId ? ' data-value-item-id="' + valueItemId + '"' : '')
                                    + (rgHeadVal ? ' data-rg-head="' + rgHeadVal.replace(/"/g, '&quot;') + '"' : '')
                                    + (rowLabel ? ' data-dash-label="' + dashAttr(rowLabel) + '"' : '')
                                    + ' data-rg-col="' + dashAttr(periodLabel) + '"'
                                    + dashCellFormatAttribute(row.id);
                                row.insertAdjacentHTML('beforeend',
                                    cellTpl.replace(':val:', dashFormatNumberText(v || ''))
                                        .replace(':ready:', v || dashFormulas[row.id] === '[]' || !dashFormulas[row.id] ? '1' : '0')
                                        .replace(':title:', v || dashFormulas[row.id] === '[]' || !dashFormulas[row.id] ? dashAttr(vDetails) : '')
                                        .replace(':classes:', 'f-rg-cell')
                                        .replace(':src:', s.src)
                                        .replace(':item-id:', row.id)
                                        .replace(':extra:', cellExtra)
                                        .replace(':from:', fr)
                                        .replace(':to:', to));
                                dashMarkCellErrorIfAny(row, itemName, '', panelId);
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
                            , resolved = dashResolveValueCell(row.id, groupName, panelId);
                        if (resolved.alias)
                            s = { src: 'value', extra: '' };
                        v = dashNormalizeVal(row.id, resolved.value);
                        var itemName = dashRowLookupName(row);
                        var valueItemId = dashPanelValues[panelId] ? '' : (dashValueItemIds[(itemName || '').toLowerCase()] || '');
                        var rgHeadVal = groupName;
                        var rowLabel = (dashItems[row.id] && dashItems[row.id].label) || '';
                        var cellExtra = s.extra
                            + (valueItemId ? ' data-value-item-id="' + valueItemId + '"' : '')
                            + (rgHeadVal ? ' data-rg-head="' + rgHeadVal.replace(/"/g, '&quot;') + '"' : '')
                            + (rowLabel ? ' data-dash-label="' + dashAttr(rowLabel) + '"' : '')
                            + dashCellFormatAttribute(row.id);
                        row.insertAdjacentHTML('beforeend',
                            cellTpl.replace(':val:', dashFormatNumberText(v || ''))
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
                        var rgf = dashModelData[panelId].rgs[rg].rgFormulas || ''
                            , cellExtra = (rgf ? ' data-rg-formula="' + rgf.replace(/"/g, '&quot;') + '"' : '')
                                + dashCellFormatAttribute(row.id);
                        row.insertAdjacentHTML('beforeend',
                            cellTpl.replace(':val:', '')
                                .replace(':classes:', 'f-rg-formula-cell')
                                .replace(':from:', '-').replace(':to:', '-')
                                .replace(':ready:', '0')
                                .replace(':title:', rgf)
                                .replace(':src:', 'rgformula')
                                .replace(':item-id:', row.id)
                                .replace(':extra:', cellExtra));
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
                                        var ready = 0, src = 'report', extra = '', vDetails = '';
                                        var item = dashItems[row.id] || {};
                                        var itemName = item.srcName || item.name || '';
                                        var rowLabel = item.label || '';
                                        if (useMatrix) {
                                            var matrixRow = dashFindMatrixValue(itemName, col, rowLabel);
                                            var matrixLabel = matrixRow ? (matrixRow['Метка'] || '') : rowLabel;
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
                                            v = dashGetColVal(itemName, col, rowLabel, panelId);
                                            if (v || dashFormulas[row.id] === '[]') ready = 1;
                                            if (v !== undefined) vDetails = dashGetColValDetails(itemName, col, rowLabel, panelId);
                                        }
                                        if (rowLabel) extra += ' data-dash-label="' + dashAttr(rowLabel) + '"';
                                        extra += ' data-rg-col="' + dashAttr(col) + '"';
                                        extra += dashCellFormatAttribute(row.id);
                                        row.insertAdjacentHTML('beforeend',
                                            cellTpl.replace(':val:', dashFormatNumberText(dashNormalizeVal(row.id, v || '')))
                                                .replace(':ready:', ready)
                                                .replace(':title:', ready === 1 ? dashAttr(vDetails) : '')
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
            dashApplyPanelTableFilters(panel);
            dashUpdatePanelFilterIcon(panel);
            // Only render if not yet interacted (user click sets data-user-selected)
            var icons = panel.querySelector('.f-panel-viz-icons');
            var hasUserSelection = icons && icons.querySelector('.f-viz-type-icon[data-user-selected]');
            if (settings && !hasUserSelection) dashPanelApplySettings(panel.id, settings, true);
            if (!hasUserSelection) {
                var activeIcon = icons ? icons.querySelector('.f-viz-type-icon.active') : null;
                if (!activeIcon || activeIcon.dataset.vizType === 'table')
                    dashRenderReportTable(panel);
            }
            dashUpdateSubheadStickyTop(panel);
        });
    }
    dashDebug();
}

function dashUpdateTableWrapOverflow() {
    // overflow-x: auto is set via CSS; no dynamic toggle needed.
}

function dashUpdateSubheadStickyTop(panelEl) {
    var tableWrap = panelEl ? panelEl.querySelector('.f-table-wrap') : null;
    if (!tableWrap) return;
    var headRow = tableWrap.querySelector('thead .dash-head');
    if (!headRow) return;
    var headHeight = headRow.getBoundingClientRect().height;
    tableWrap.style.setProperty('--dash-head-height', headHeight + 'px');
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
    // Issue 2718: имя и id запроса приходят в X-Query-* заголовках, копим в алиас-индекс.
    dashCaptureQueryHeaders(key, ctx && typeof ctx === 'object' ? ctx.responseHeaders : null);
    dashAjaxes--;
    dashDrawPeriods();
}

// Сохранить X-Query-Id / X-Query-Name (rawurlencoded) из заголовков ответа.
function dashCaptureQueryHeaders(key, headers) {
    if (!headers) return;
    if (headers['x-query-id']) dashReportIds[key] = String(headers['x-query-id']);
    if (headers['x-query-name']) {
        try { dashReportHeaders[key] = decodeURIComponent(headers['x-query-name']); }
        catch (e) { dashReportHeaders[key] = headers['x-query-name']; }
    }
    if (dashReportIds[key] && dashReportHeaders[key]) {
        dashQueryNameById[dashReportIds[key]] = dashReportHeaders[key];
        dashQueryIdByName[dashReportHeaders[key].toLowerCase()] = dashReportIds[key];
    }
}

function dashGetRep(rep, fr, to, panelFilter) {
    var key = dashReportKey(rep, panelFilter);
    dashReports[key] = {};
    dashReportNames[key] = rep;
    dashAjaxes++;
    newApi('GET', dashReportUrl(rep, fr, to, panelFilter), 'dashGetRepDone', '', { key: key });
    return key;
}

function dashGetVizReportDone(json, ctx) {
    var key = ctx && typeof ctx === 'object' ? ctx.key : ctx;
    dashVizReports[key] = dashNormalizeReportJson(json || {});
    dashAjaxes--;
    dashDrawPeriods();
}

function dashGetVizReport(reportId, fr, to, panelFilter) {
    var key = dashVizReportKey(reportId, panelFilter);
    if (dashVizReports[key]) return key;
    dashVizReports[key] = { loading: true, columns: [], rows: [] };
    dashAjaxes++;
    newApi('GET', dashVizReportUrl(reportId, fr, to, panelFilter), 'dashGetVizReportDone', '', { key: key });
    return key;
}

// Parses a source-`value` string into an array of `{date, val, ...}` records.
// Historically `value` came as a bare list of objects with no outer brackets —
// `{"date":...},{"date":...}` — so the caller wrapped it in `[...]` before
// JSON.parse. Newer backends may emit the same payload already wrapped:
// `[{"date":...},{"date":...}]`. Wrapping that a second time produced a valid
// JSON array of arrays — JSON.parse succeeded silently but the parsed records
// were nested one level too deep, so per-record fields (date/val/Метка)
// stopped being visible and the cells came up empty without any error.
// Sniff the first non-whitespace char: if it's already `[`, parse as-is.
function dashParseSrcValue(value) {
    var raw = String(value == null ? '' : value).replace(/^\s+/, '');
    return JSON.parse(raw.charAt(0) === '[' ? raw : '[' + raw + ']');
}

function dashGetSrc(json) {
    for (var i in json || []) {
        if (json[i].valueItemID) dashValueItemIds[(json[i].item || '').toLowerCase()] = json[i].valueItemID;
        if (json[i].value.length > 0) {
            try {
                var colGroup = (json[i]['Колонка группы'] || '').toLowerCase();
                var itemKey = (json[i].item || '').toLowerCase();
                var key = colGroup ? itemKey + ':' + colGroup : itemKey;
                var srcLabel = json[i]['Метка'] || '';
                var parsed = dashParseSrcValue(json[i].value);
                var tagged = parsed.map(function(p) {
                    return Object.assign({}, p, { 'Метка': srcLabel });
                });
                dashValues[key] = Array.isArray(dashValues[key])
                    ? dashValues[key].concat(tagged)
                    : tagged;
                dashTrace('source-value-parse', {
                    item: json[i].item,
                    colGroup: colGroup,
                    key: key,
                    label: srcLabel,
                    count: tagged.length,
                    first: tagged[0]
                });
            } catch (e) {
                // Earlier rows for the same item may have parsed OK — don't
                // clobber dashValues with a string. Track the failure
                // separately so the affected cell can be highlighted.
                var errItemKey = (json[i].item || '').toLowerCase();
                var errColGroup = (json[i]['Колонка группы'] || json[i].RGcolumnsID || '').toLowerCase();
                var errKey = errColGroup ? errItemKey + ':' + errColGroup : errItemKey;
                dashValueErrors[errKey] = { error: String(e), raw: json[i].value };
                if (!dashValueErrors[errItemKey]) dashValueErrors[errItemKey] = { error: String(e), raw: json[i].value };
                dashTrace('source-value-parse-error', {
                    item: json[i].item,
                    colGroup: errColGroup,
                    key: errKey,
                    error: String(e),
                    raw: json[i].value
                });
            }
        }
    }
    dashAjaxes--;
    dashDrawPeriods();
}

// Fetch per-panel values from `panelQuery` (JSON_KV) and store them in a
// panel-scoped bucket. Used when a panel has both `panelQuery` and rows
// (.f-item). Shape mirrors Дэшборд.ЗначенияЗаПериод rows but with
// RGcolumnsID in place of «Колонка группы»; missing valueItemID is
// intentional — these cells are rendered read-only.
function dashGetPanelValues(panelKey, queryId, fr, to, panelFilter) {
    if (!panelKey || !queryId) return;
    dashPanelValues[panelKey] = {};
    dashPanelValueErrors[panelKey] = {};
    var panelEl = document.getElementById(panelKey);
    if (panelEl) panelEl.classList.add('f-panel-readonly');
    var url = 'report/' + queryId + '?JSON_KV&FR_Date=' + fr + '&TO_Date=' + to
        , filter = dashNormalizePanelFilter(panelFilter);
    if (filter) url += '&' + filter;
    dashAjaxes++;
    newApi('GET', url, 'dashGetPanelValuesDone', '', { panelKey: panelKey });
}

function dashGetPanelValuesDone(json, ctx) {
    var panelKey = ctx && ctx.panelKey;
    // Issue 2718: данные panel-fetch'а кладём ещё и в dashReports[panelReportKey], чтобы
    // row-формулы, чей запрос совпал с panelQuery, могли читать оттуда без отдельного запроса.
    // Заодно фиксируем X-Query-Id/X-Query-Name в алиас-индексе.
    var panelReportKey = panelKey && dashModelData[panelKey] && dashModelData[panelKey].panelReportKey;
    if (panelReportKey && Array.isArray(json)) dashReports[panelReportKey] = json;
    if (panelReportKey) dashCaptureQueryHeaders(panelReportKey, ctx && ctx.responseHeaders);
    if (panelKey && Array.isArray(json)) {
        var bucket = dashPanelValues[panelKey] = {};
        var errBucket = dashPanelValueErrors[panelKey] = {};
        // Apply local panelFilter parts ("Field:Value") that weren't sent to
        // the server in dashGetPanelValues. Without this, the panel would
        // surface rows from every sheet even though panelFilter restricts
        // it (issue #2679).
        var modelFilters = (dashModelData[panelKey] && dashModelData[panelKey].panelFilters) || {};
        var filteredRows = dashFilterReportRowsForPanel(json, modelFilters);
        filteredRows.forEach(function(row) {
            if (!row || row.value === undefined || row.value === null || row.value === '') return;
            var itemKey = (row.item || '').toLowerCase();
            var colGroup = (row.RGcolumnsID || '').toLowerCase();
            var key = colGroup ? itemKey + ':' + colGroup : itemKey;
            try {
                var srcLabel = row['Метка'] || '';
                var parsed = dashParseSrcValue(row.value);
                var tagged = parsed.map(function(p) {
                    return Object.assign({}, p, { 'Метка': srcLabel });
                });
                bucket[key] = Array.isArray(bucket[key]) ? bucket[key].concat(tagged) : tagged;
            } catch (e) {
                // Record the parse failure so the cell can be highlighted
                // with the original expression in its title. Don't clobber
                // bucket[key] — sibling rows for the same item may have
                // parsed OK earlier.
                errBucket[key] = { error: String(e), raw: row.value };
                if (!errBucket[itemKey]) errBucket[itemKey] = { error: String(e), raw: row.value };
            }
        });
    }
    // Issue 2718: row-fetch'и этой панели ждали в очереди — теперь данные есть и алиасы свежие.
    if (panelKey) dashDrainPendingPanelRows(panelKey);
    dashAjaxes--;
    dashDrawPeriods();
}

// Issue 2718: после прихода panel-данных разобрать очередь row-fetch'ей.
// Для каждой строки: совпала с panelQuery → переиспользуем panel-key, иначе fetch'аем свой.
function dashDrainPendingPanelRows(panelKey) {
    var queue = dashPendingPanelRows[panelKey];
    if (!queue) return;
    delete dashPendingPanelRows[panelKey];
    var data = dashModelData[panelKey];
    var panelParts = data && data.panelQueryParts;
    var panelReportKey = data && data.panelReportKey;
    // Дозаполняем parts через свежие алиасы из заголовков ответа.
    if (panelParts) {
        if (panelParts.id && !panelParts.name && dashQueryNameById[panelParts.id])
            panelParts.name = dashQueryNameById[panelParts.id];
        if (panelParts.name && !panelParts.id && dashQueryIdByName[panelParts.name.toLowerCase()])
            panelParts.id = dashQueryIdByName[panelParts.name.toLowerCase()];
    }
    queue.forEach(function(entry) {
        var fetchRef = entry.rowRef, reportKey;
        if (panelReportKey && panelParts && dashRefMatchesPanelQuery(entry.rowRef, panelParts)) {
            reportKey = panelReportKey;
        } else {
            // Нормализуем ref через алиас-индекс — если этот запрос уже встречался по другой форме.
            var s = String(entry.rowRef).toLowerCase();
            if (dashQueryIdByName[s] && dashQueryNameById[dashQueryIdByName[s]])
                fetchRef = dashQueryNameById[dashQueryIdByName[s]];
            reportKey = dashReportKey(fetchRef, entry.panelFilter);
            if (!dashReports[reportKey]) dashGetRep(fetchRef, entry.fr, entry.to, entry.panelFilter);
        }
        if (!dashReportKeys[entry.itemTargetId]) dashReportKeys[entry.itemTargetId] = reportKey;
        dashRememberReportSource(entry.itemTargetId, entry.formula, reportKey);
        dashReportNames[reportKey] = fetchRef;
    });
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
        dashItems[json[i].itemID] = { name: json[i].item, format: json[i].format, mu: json[i].MU, label: json[i]['Метка'] || '', srcName: json[i].itemSrcName || '' };
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

    // Issue 2727: pre-pass — индексируем panelQuery каждой панели по id и имени, чтобы
    // row-формула в любой панели могла найти подходящий panel-fetch до начала основного
    // цикла. Без этого матч сработал бы только для панелей, обработанных ранее в JSON.
    var seenPanelsForRefIndex = {};
    for (i in json) {
        var indexPid = json[i].panelID;
        var indexPanelKey = 'fp' + indexPid;
        if (json[i].itemID) dashPanelHasItemsByKey[indexPanelKey] = true;
        if (seenPanelsForRefIndex[indexPid]) continue;
        seenPanelsForRefIndex[indexPid] = true;
        var indexParts = dashPanelQueryParts(json[i]);
        if (!indexParts) continue;
        if (indexParts.id) dashPanelKeyByRef[indexParts.id] = indexPanelKey;
        if (indexParts.name) dashPanelKeyByRef[indexParts.name.toLowerCase()] = indexPanelKey;
        dashPanelServerFilterByKey[indexPanelKey] = dashNormalizePanelFilter(json[i].panelFilter || '');
    }

    for (i in json) {
        var panelKey = 'fp' + json[i].panelID
            , previousItem = lastVisibleItemByPanel[panelKey]
            , isDuplicateRow = dashIsDuplicateModelRow(previousItem, json[i])
            , itemTargetId = isDuplicateRow ? previousItem.itemID : json[i].itemID
            , vizReportId = dashResolvePanelVizReportId(json[i])
            , panelNotes = json[i].panelNotes === null || json[i].panelNotes === undefined ? '' : String(json[i].panelNotes)
            , panelFilter = json[i].panelFilter || ''
            , panelFilters = dashPanelLocalFilterState(panelFilter);
        // Add sheet tab
        if (!document.getElementById(json[i].sheetID)) {
            model.querySelector('.sheet-tabs').insertAdjacentHTML('beforeend',
                sheetTabTpl.replace(/:id:/g, json[i].sheetID).replace(':name:', json[i].sheet));
            model.querySelector('.sheets').insertAdjacentHTML('beforeend',
                sheetTpl.replace(/:id:/g, json[i].sheetID));
            var sheetEl = document.getElementById('ds' + json[i].sheetID);
            dashSetSheetTileModeDefault(sheetEl, json[i]);
            dashInitFilterBar(sheetEl);
            dashSetSheetTileModeButtonState(sheetEl, dashReadSheetTileMode(sheetEl));
        } else {
            var existingSheetEl = document.getElementById('ds' + json[i].sheetID);
            dashSetSheetTileModeDefault(existingSheetEl, json[i]);
            dashSetSheetTileModeButtonState(existingSheetEl, dashReadSheetTileMode(existingSheetEl));
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
            dashModelData[panelKey] = {
                items: {},
                rgs: {},
                noDates: json[i].NoDates,
                settings: panelSettings,
                panelID: json[i].panelID,
                notes: '',
                panelFilter: panelFilter,
                panelFilters: panelFilters,
                vizReportId: vizReportId,
                vizReportKey: vizReportId ? dashGetVizReport(vizReportId, fr, to, panelFilter) : '',
                // Issue 2718: panelQuery в разобранной форме + ключ для шаринга panel-fetch с row-формулами.
                panelQueryParts: dashPanelQueryParts(json[i]),
                panelReportKey: vizReportId ? dashReportKey(vizReportId, panelFilter) : ''
            };
            dashApplyVizSize(document.getElementById(panelKey), 'table', {});
            dashPanelApplySettings(panelKey, panelSettings, false);
        } else if (dashModelData[panelKey]) {
            dashModelData[panelKey].panelFilters = dashMergePanelFilterState(dashModelData[panelKey].panelFilters, panelFilters);
        }
        if (panelNotes.trim() && dashModelData[panelKey] && !dashModelData[panelKey].notes) {
            dashModelData[panelKey].notes = panelNotes;
            dashSetPanelNotes(document.getElementById(panelKey), panelNotes);
        }
        if (vizReportId && dashModelData[panelKey] && !dashModelData[panelKey].vizReportId) {
            dashModelData[panelKey].vizReportId = vizReportId;
            dashModelData[panelKey].vizReportKey = dashGetVizReport(vizReportId, fr, to, panelFilter);
        }
        if (json[i].NoDates !== undefined)
            dashModelData[panelKey].noDates = json[i].NoDates;
        // Add item row
        if (json[i].itemID && !isDuplicateRow && !document.getElementById(json[i].itemID)) {
            document.getElementById(panelKey).querySelector('table tbody').insertAdjacentHTML('beforeend',
                itemTpl.replace(/:id:/g, json[i].itemID)
                    .replace(':panel-id:', json[i].panelID)
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
                // Issue 2718/2727: row-fetch встаёт в очередь подходящей панели, если такая есть:
                //   1) собственная панель имеет panelQuery → ждём её panel-fetch'а (issue 2718);
                //   2) иначе — другая панель имеет panelQuery с тем же ref'ом и тем же
                //      server-side panelFilter → шарим её panel-fetch (issue 2727).
                // Иначе — fire'им свой dashGetRep как раньше.
                var panelData2 = dashModelData[panelKey]
                    , panelParts2 = panelData2 && panelData2.panelQueryParts
                    , queueKey = panelParts2 ? panelKey : dashFindPanelForRowRef(rep[1], panelFilter, panelKey);
                if (queueKey) {
                    if (!dashPendingPanelRows[queueKey]) dashPendingPanelRows[queueKey] = [];
                    dashPendingPanelRows[queueKey].push({
                        itemTargetId: itemTargetId, formula: json[i].formulas, rowRef: rep[1],
                        fr: fr, to: to, panelFilter: panelFilter
                    });
                } else {
                    var reportKey = dashReportKey(rep[1], panelFilter);
                    if (!dashReportKeys[itemTargetId])
                        dashReportKeys[itemTargetId] = reportKey;
                    dashRememberReportSource(itemTargetId, json[i].formulas, reportKey);
                    dashReportNames[reportKey] = rep[1];
                    if (!dashReports[reportKey])
                        dashGetRep(rep[1], fr, to, panelFilter);
                }
            }
        }
    }
    // For panels that declare panelQuery AND have rows, fetch per-panel
    // values via JSON_KV. They become the data source for those panels
    // (cells rendered read-only, see f-panel-readonly).
    Object.keys(dashModelData).forEach(function(panelKey) {
        var data = dashModelData[panelKey];
        if (!data || !data.vizReportId) return;
        var panelEl = document.getElementById(panelKey);
        if (!panelEl || !panelEl.querySelector('.f-item')) return;
        dashGetPanelValues(panelKey, data.vizReportId, fr, to, data.panelFilter);
    });
    dashUpdateAllSheetSizeResetIcons();

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
            if (targetSheet) {
                targetSheet.style.display = '';
                dashInitSheetTileMode(targetSheet);
            }
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
    { id: 'funnel', label: 'Диаграмма-воронка',      icon: 'pi-filter' },
    { id: 'pivot',  label: 'Сводная таблица',        icon: 'pi-objects-column' }
];

var DASH_VIZ_SIZE_UNITS = ['%', 'px', 'rem'];
var DASH_PANEL_MAX_WIDTH_UNITS = ['%', 'px'];
var DASH_PANEL_MAX_WIDTH_MOBILE_BREAKPOINT = 767;
var DASH_PANEL_COLUMN_BREAKPOINTS = [
    { key: 'xs', label: 'XS', range: '<576px', minWidth: 0, defaultValue: 12 },
    { key: 'sm', label: 'SM', range: '>=576px', minWidth: 576, defaultValue: 12 },
    { key: 'md', label: 'MD', range: '>=768px', minWidth: 768, defaultValue: 6 },
    { key: 'lg', label: 'LG', range: '>=992px', minWidth: 992, defaultValue: 4 },
    { key: 'xl', label: 'XL', range: '>=1200px', minWidth: 1200, defaultValue: 4 },
    { key: 'xxl', label: 'XXL', range: '>=1400px', minWidth: 1400, defaultValue: 3 }
];
var DASH_CHART_RESIZE_MIN_WIDTH = 260;
var DASH_CHART_RESIZE_MIN_HEIGHT = 180;
var DASH_TABLE_RESIZE_MIN_WIDTH = 260;
var DASH_TABLE_RESIZE_MIN_HEIGHT = 120;
var DASH_CHART_RESIZE_COOKIE_MAX_AGE = 31536000;
var dashVizModalCtx = null; // { panelEl, panelKey }

function dashPanelGetVizReportData(panelEl) {
    var modelData = panelEl ? dashModelData[panelEl.id] : null
        , report = modelData && modelData.vizReportKey ? dashVizReports[modelData.vizReportKey] : null;
    if (!report || report.loading) return null;
    return report;
}

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
        rows.push(dashPanelGetRowName(tr));
    });
    return rows;
}

function dashPanelGetRowName(row) {
    return row ? (row.getAttribute('item-name') || '') : '';
}

// Alternative row name used to look up data in the query (issue #2682).
// When `itemSrcName` is filled on a Дэшборд row, the source data is keyed by
// that name in ЗначенияЗаПериод / panelQuery — not by the visible row name.
// Falls back to the visible `item-name` when itemSrcName is empty.
function dashRowLookupName(row) {
    if (!row) return '';
    var meta = dashItems[row.id];
    return (meta && meta.srcName) || row.getAttribute('item-name') || '';
}

function dashPanelGetRowKey(row) {
    return String((row && row.id) || dashPanelGetRowName(row) || '');
}

function dashNormalizeSelectedRows(selectedRows) {
    var selected = {};
    if (!Array.isArray(selectedRows)) return null;
    selectedRows.forEach(function(row) {
        var key = String(row || '');
        if (key) selected[key] = true;
    });
    return selected;
}

function dashPanelFilterRows(rows, selectedRows) {
    var selected = dashNormalizeSelectedRows(selectedRows);
    if (selected === null) return rows;
    return rows.filter(function(row) {
        return !!(selected[dashPanelGetRowKey(row)] || selected[dashPanelGetRowName(row)]);
    });
}

function dashCollectPanelData(panelEl, vizConfig) {
    var report = typeof dashPanelGetVizReportData === 'function' ? dashPanelGetVizReportData(panelEl) : null;
    if (report) return dashCollectReportVizData(report, Object.assign({}, vizConfig || {}, { filters: dashPanelFiltersFor(panelEl) }));

    var datasets = [], cols = dashPanelGetColumns(panelEl), filters = dashPanelFiltersFor(panelEl);
    var itemRows = dashPanelFilterRows(
        Array.from(panelEl.querySelectorAll('.f-item')),
        vizConfig ? vizConfig.selectedRows : null
    ).filter(function(row) { return dashPanelTableRowPassesFilters(row, filters); });

    if (!itemRows.length) return { labels: [], datasets: [] };

    if (cols.length === 0) {
        // Single value column — one dataset, labels are row names
        var labels = [], vals = [];
        itemRows.forEach(function(tr) {
            labels.push(dashPanelGetRowName(tr));
            var td = tr.querySelector('td.f-cell');
            vals.push(dashGetFloat(td ? td.textContent.trim() : '') || 0);
        });
        datasets.push({ label: '', data: vals });
        return { labels: labels, datasets: datasets };
    }

    // Multiple columns: columns are X-axis labels, each row is a dataset
    itemRows.forEach(function(tr) {
        var rowName = dashPanelGetRowName(tr);
        var vals = cols.map(function(col) {
            var cells = Array.from(tr.querySelectorAll('td.f-cell'));
            var matching = cells.filter(function(td) {
                return ((td.dataset.rgCol || '') === col || (td.dataset.rgHead || '') === col)
                    && dashPanelTableCellPassesFilters(td, filters);
            });
            var sum = 0;
            matching.forEach(function(td) { sum += dashGetFloat(td.textContent.trim()) || 0; });
            return matching.length ? sum : 0;
        });
        datasets.push({ label: rowName, data: vals });
    });
    return { labels: cols, datasets: datasets };
}

var CHART_COLORS = [
    'rgba(54,162,235,0.7)', 'rgba(255,99,132,0.7)', 'rgba(255,206,86,0.7)',
    'rgba(75,192,192,0.7)', 'rgba(153,102,255,0.7)', 'rgba(255,159,64,0.7)',
    'rgba(99,255,132,0.7)', 'rgba(235,54,162,0.7)'
];

function dashBrowserSupportsColor(value) {
    var probe;
    value = String(value || '').trim();
    if (!value) return false;
    try {
        if (typeof CSS !== 'undefined' && CSS.supports && CSS.supports('color', value)) return true;
    } catch (e) {}
    try {
        if (typeof document !== 'undefined' && document.createElement) {
            probe = document.createElement('span');
            probe.style.color = '';
            probe.style.color = value;
            return !!probe.style.color;
        }
    } catch (e) {}
    return /^[A-Za-z]+$/.test(value);
}

function dashNormalizeColorToken(value) {
    var raw = String(value === undefined || value === null ? '' : value).trim();
    if (!raw) return null;
    if (/^#?([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(raw))
        return raw.charAt(0) === '#' ? raw : '#' + raw;
    if (dashBrowserSupportsColor(raw)) return /^[A-Za-z]+$/.test(raw) ? raw.toLowerCase() : raw;
    return null;
}

function dashNormalizeColorPalette(value) {
    var source = Array.isArray(value) ? value : String(value === undefined || value === null ? '' : value).split(',')
        , result = [];
    source.forEach(function(part) {
        var color;
        if (result.length >= 32) return;
        color = dashNormalizeColorToken(part);
        if (color) result.push(color);
    });
    return result.length ? result : null;
}

function dashColorPaletteToText(palette) {
    var normalized = dashNormalizeColorPalette(palette);
    return normalized ? normalized.join(', ') : '';
}

function dashChartPaletteFromGeneral(general) {
    return general && Array.isArray(general.colorPalette) && general.colorPalette.length ? general.colorPalette : CHART_COLORS;
}

function dashChartColor(palette, index) {
    var colors = Array.isArray(palette) && palette.length ? palette : CHART_COLORS;
    return colors[index % colors.length];
}

function dashColorWithAlpha(color, alpha) {
    var value = String(color || '').trim()
        , a = parseFloat(alpha)
        , hex, rgb, r, g, b, m, canvas, ctx, normalized;
    if (!isFinite(a)) return value;
    a = Math.max(0, Math.min(1, a));

    m = value.match(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/);
    if (m) {
        hex = m[1];
        if (hex.length === 3 || hex.length === 4)
            hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
        else
            hex = hex.slice(0, 6);
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }

    rgb = value.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*[0-9.]+)?\s*\)$/i);
    if (rgb) {
        r = Math.max(0, Math.min(255, Math.round(parseFloat(rgb[1]))));
        g = Math.max(0, Math.min(255, Math.round(parseFloat(rgb[2]))));
        b = Math.max(0, Math.min(255, Math.round(parseFloat(rgb[3]))));
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }

    try {
        if (typeof document !== 'undefined' && document.createElement) {
            canvas = document.createElement('canvas');
            ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
            if (ctx) {
                ctx.fillStyle = '#000000';
                ctx.fillStyle = value;
                normalized = ctx.fillStyle;
                if (normalized && normalized !== value) return dashColorWithAlpha(normalized, a);
            }
        }
    } catch (e) {}

    return value;
}

function dashNormalizeAreaMode(mode) {
    mode = String(mode || 'plain');
    return ['plain', 'stacked', 'normalized'].indexOf(mode) === -1 ? 'plain' : mode;
}

function dashBuildAreaModeHtml(fieldMap) {
    var areaMode = dashNormalizeAreaMode(fieldMap && fieldMap.areaMode);
    return '<div class="dash-viz-field-row"><label>Режим</label>'
        + '<select class="dash-viz-field-select" name="areaMode">'
        + '<option value="plain"' + (areaMode === 'plain' ? ' selected' : '') + '>С областями</option>'
        + '<option value="stacked"' + (areaMode === 'stacked' ? ' selected' : '') + '>С областями и накоплением</option>'
        + '<option value="normalized"' + (areaMode === 'normalized' ? ' selected' : '') + '>Нормированная с накоплением</option>'
        + '</select></div>';
}

function dashNormalizePercentDatasets(datasets) {
    var source = Array.isArray(datasets) ? datasets : []
        , totals = [];

    source.forEach(function(ds) {
        (ds && Array.isArray(ds.data) ? ds.data : []).forEach(function(value, index) {
            var n = parseFloat(value);
            if (!isNaN(n)) totals[index] = (totals[index] || 0) + n;
        });
    });

    return source.map(function(ds) {
        var data = (ds && Array.isArray(ds.data) ? ds.data : []).map(function(value, index) {
            var n = parseFloat(value)
                , total = totals[index] || 0;
            return !isNaN(n) && total ? n * 100 / total : 0;
        });
        return Object.assign({}, ds, { data: data });
    });
}

function dashBuildAreaDatasets(datasets, fieldMap, palette) {
    var areaMode = dashNormalizeAreaMode(fieldMap && fieldMap.areaMode)
        , source = areaMode === 'normalized' ? dashNormalizePercentDatasets(datasets) : (datasets || []);

    return source.map(function(ds, i) {
        var color = dashChartColor(palette, i);
        var dataset = {
            label: ds.label,
            data: ds.data,
            borderWidth: 0,
            backgroundColor: color,
            tension: 0.3,
            fill: true,
            pointRadius: 0
        };
        if (areaMode !== 'plain') dataset.stack = 'area';
        return dataset;
    });
}

function dashBuildAreaChartOptions(fieldMap) {
    var areaMode = dashNormalizeAreaMode(fieldMap && fieldMap.areaMode)
        , yScale
        , base = { plugins: { legend: { labels: { borderWidth: 0 } } } };
    if (areaMode === 'plain') return base;

    yScale = { stacked: true };
    if (areaMode === 'normalized') {
        yScale.min = 0;
        yScale.max = 100;
        yScale.ticks = {
            callback: function(value) {
                var n = parseFloat(value);
                return (isNaN(n) ? value : Math.round(n * 100) / 100) + '%';
            }
        };
    }
    return Object.assign(base, { scales: { y: yScale } });
}

function dashEnsureChartJs(cb) {
    if (window.Chart) { cb(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
    s.onload = cb;
    document.head.appendChild(s);
}

function dashLoadScriptOnce(id, src, cb) {
    var existing = document.getElementById(id)
        , s;
    if (existing) {
        if (existing.getAttribute('data-loaded') === '1') { cb(); return; }
        existing.addEventListener('load', cb);
        return;
    }
    s = document.createElement('script');
    s.id = id;
    s.src = src;
    s.onload = function() {
        s.setAttribute('data-loaded', '1');
        cb();
    };
    document.head.appendChild(s);
}

function dashPivotDepsReady() {
    return window.jQuery && window.jQuery.fn && window.jQuery.fn.pivotUI && window.jQuery.fn.sortable;
}

function dashEnsurePivotJs(cb) {
    if (dashPivotDepsReady()) { cb(); return; }
    // Load pivottable.js CSS
    if (!document.getElementById('pivottable-css')) {
        var lnk = document.createElement('link');
        lnk.id = 'pivottable-css';
        lnk.rel = 'stylesheet';
        lnk.href = 'https://cdn.jsdelivr.net/npm/pivottable@2/dist/pivot.min.css';
        document.head.appendChild(lnk);
    }
    function loadPivot() {
        if (window.jQuery && window.jQuery.fn && window.jQuery.fn.pivotUI) { cb(); return; }
        dashLoadScriptOnce('pivottable-js', 'https://cdn.jsdelivr.net/npm/pivottable@2/dist/pivot.min.js', cb);
    }
    function loadJqueryUi() {
        if (window.jQuery && window.jQuery.fn && window.jQuery.fn.sortable) { loadPivot(); return; }
        dashLoadScriptOnce('jquery-ui-js', 'https://cdn.jsdelivr.net/npm/jquery-ui-dist@1.12.1/jquery-ui.min.js', loadPivot);
    }
    // PivotTable UI requires jQuery and jQuery UI sortable.
    if (!window.jQuery) {
        dashLoadScriptOnce('jquery-js', 'https://cdn.jsdelivr.net/npm/jquery@3/dist/jquery.min.js', loadJqueryUi);
    } else {
        loadJqueryUi();
    }
}

function dashNormalizeVizSizeValue(value) {
    var raw = String(value === undefined || value === null ? '' : value).trim().replace(',', '.')
        , n;
    if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return '';
    n = parseFloat(raw);
    if (!isFinite(n) || n <= 0) return '';
    return String(n);
}

function dashNormalizeVizSizeUnit(unit) {
    unit = String(unit || '').trim();
    return DASH_VIZ_SIZE_UNITS.indexOf(unit) === -1 ? 'px' : unit;
}

function dashNormalizeVizSizeDimension(dim) {
    var value, unit, match;
    if (!dim) return null;
    if (typeof dim === 'string' || typeof dim === 'number') {
        match = String(dim).trim().match(/^(\d+(?:[.,]\d+)?)(%|px|rem)?$/);
        if (!match) return null;
        value = match[1];
        unit = match[2] || 'px';
    } else {
        value = dim.value;
        unit = dim.unit;
    }
    value = dashNormalizeVizSizeValue(value);
    if (!value) return null;
    return { value: value, unit: dashNormalizeVizSizeUnit(unit) };
}

function dashNormalizeVizSize(size) {
    var result = {}, width, height;
    if (!size) return null;
    width = dashNormalizeVizSizeDimension(size.width || (size.widthValue ? { value: size.widthValue, unit: size.widthUnit } : null));
    height = dashNormalizeVizSizeDimension(size.height || (size.heightValue ? { value: size.heightValue, unit: size.heightUnit } : null));
    if (width) result.width = width;
    if (height) result.height = height;
    return result.width || result.height ? result : null;
}

function dashVizSizeCss(dim) {
    return dim ? dim.value + dim.unit : '';
}

function dashNormalizePanelMaxWidthUnit(unit) {
    unit = String(unit || '').trim();
    return DASH_PANEL_MAX_WIDTH_UNITS.indexOf(unit) === -1 ? 'px' : unit;
}

function dashNormalizePanelMaxWidthDimension(dim) {
    var value, unit, match;
    if (!dim) return null;
    if (typeof dim === 'string' || typeof dim === 'number') {
        match = String(dim).trim().match(/^(\d+(?:[.,]\d+)?)(%|px)?$/);
        if (!match) return null;
        value = match[1];
        unit = match[2] || 'px';
    } else {
        value = dim.value;
        unit = dim.unit;
    }
    value = dashNormalizeVizSizeValue(value);
    unit = String(unit || '').trim() || 'px';
    if (!value) return null;
    if (DASH_PANEL_MAX_WIDTH_UNITS.indexOf(unit) === -1) return null;
    return { value: value, unit: unit };
}

function dashNormalizePanelMaxWidth(maxWidth) {
    var result = {}, desktop, mobile;
    if (!maxWidth) return null;
    desktop = dashNormalizePanelMaxWidthDimension(maxWidth.desktop || (maxWidth.desktopValue ? { value: maxWidth.desktopValue, unit: maxWidth.desktopUnit } : null));
    mobile = dashNormalizePanelMaxWidthDimension(maxWidth.mobile || (maxWidth.mobileValue ? { value: maxWidth.mobileValue, unit: maxWidth.mobileUnit } : null));
    if (desktop) result.desktop = desktop;
    if (mobile) result.mobile = mobile;
    return result.desktop || result.mobile ? result : null;
}

function dashPanelMaxWidthFromSettings(settings) {
    var list = settings ? (Array.isArray(settings) ? settings : [settings]) : []
        , found = null;
    list.forEach(function(entry) {
        if (!found && entry && entry.panelMaxWidth)
            found = dashNormalizePanelMaxWidth(entry.panelMaxWidth);
    });
    return found;
}

function dashSetPanelMaxWidthInSettings(settings, panelMaxWidth) {
    var list = settings ? (Array.isArray(settings) ? settings.slice() : [settings]) : []
        , normalized = dashNormalizePanelMaxWidth(panelMaxWidth)
        , result = [];
    list.forEach(function(entry) {
        if (entry && entry.panelMaxWidth) return;
        result.push(entry);
    });
    if (normalized) result.push({ panelMaxWidth: normalized });
    return result;
}

function dashPanelMaxWidthDevice() {
    if (typeof window !== 'undefined' && window.matchMedia)
        return window.matchMedia('(max-width: ' + DASH_PANEL_MAX_WIDTH_MOBILE_BREAKPOINT + 'px)').matches ? 'mobile' : 'desktop';
    if (typeof window !== 'undefined' && window.innerWidth && window.innerWidth <= DASH_PANEL_MAX_WIDTH_MOBILE_BREAKPOINT)
        return 'mobile';
    return 'desktop';
}

function dashPanelMaxWidthForPanel(panelEl) {
    var modelData = panelEl ? dashModelData[panelEl.id] : null
        , maxWidth = dashPanelMaxWidthFromSettings(modelData && modelData.settings)
        , device = dashPanelMaxWidthDevice();
    if (!maxWidth) return null;
    if (device === 'mobile') return maxWidth.mobile || maxWidth.desktop || null;
    return maxWidth.desktop || null;
}

function dashPanelMaxWidthCss(dim) {
    return dim ? dim.value + dim.unit : '';
}

function dashCombineMaxWidthCss(vizWidthCss, panelMaxWidthCss) {
    if (vizWidthCss && panelMaxWidthCss && vizWidthCss !== panelMaxWidthCss)
        return 'min(' + vizWidthCss + ', ' + panelMaxWidthCss + ')';
    return vizWidthCss || panelMaxWidthCss || '';
}

function dashApplyPanelMaxWidth(panelEl) {
    var vizWidthCss = panelEl && panelEl._dashVizWidthCss ? panelEl._dashVizWidthCss : ''
        , panelMaxWidthCss = dashPanelMaxWidthCss(dashPanelMaxWidthForPanel(panelEl));
    if (!panelEl || !panelEl.style) return;
    panelEl.style.maxWidth = dashCombineMaxWidthCss(vizWidthCss, panelMaxWidthCss);
}

function dashNormalizePanelHeight(panelHeight) {
    var minRaw, maxRaw, minValue, maxValue, result = {};
    if (!panelHeight || typeof panelHeight !== 'object') return null;
    minRaw = panelHeight.min;
    maxRaw = panelHeight.max;
    if (minRaw === undefined && panelHeight.minValue !== undefined) minRaw = panelHeight.minValue;
    if (maxRaw === undefined && panelHeight.maxValue !== undefined) maxRaw = panelHeight.maxValue;
    minValue = dashNormalizeIntegerInRange(minRaw, 0, 4000);
    maxValue = dashNormalizeIntegerInRange(maxRaw, 0, 4000);
    if (minValue !== null) result.min = minValue;
    if (maxValue !== null) result.max = maxValue;
    if (result.min !== undefined && result.max !== undefined && result.max < result.min)
        result.max = result.min;
    return result.min !== undefined || result.max !== undefined ? result : null;
}

function dashPanelHeightFromSettings(settings) {
    var list = settings ? (Array.isArray(settings) ? settings : [settings]) : []
        , found = null;
    list.forEach(function(entry) {
        if (!found && entry && entry.panelHeight)
            found = dashNormalizePanelHeight(entry.panelHeight);
    });
    return found;
}

function dashSetPanelHeightInSettings(settings, panelHeight) {
    var list = settings ? (Array.isArray(settings) ? settings.slice() : [settings]) : []
        , normalized = dashNormalizePanelHeight(panelHeight)
        , result = [];
    list.forEach(function(entry) {
        if (entry && entry.panelHeight) return;
        result.push(entry);
    });
    if (normalized) result.push({ panelHeight: normalized });
    return result;
}

function dashNormalizePanelColumns(panelColumns) {
    var result = {}, hasCustom = false;
    if (!panelColumns || typeof panelColumns !== 'object') return null;
    DASH_PANEL_COLUMN_BREAKPOINTS.forEach(function(bp) {
        var raw = panelColumns[bp.key]
            , val;
        if (raw === undefined && panelColumns[bp.key + 'Value'] !== undefined)
            raw = panelColumns[bp.key + 'Value'];
        val = dashNormalizeIntegerInRange(raw, 1, 12);
        if (val === null) return;
        result[bp.key] = val;
        if (val !== bp.defaultValue) hasCustom = true;
    });
    return hasCustom ? result : null;
}

function dashPanelColumnsWithDefaults(panelColumns) {
    var normalized = dashNormalizePanelColumns(panelColumns) || {}
        , result = {};
    DASH_PANEL_COLUMN_BREAKPOINTS.forEach(function(bp) {
        result[bp.key] = normalized[bp.key] || bp.defaultValue;
    });
    return result;
}

function dashPanelColumnsFromSettings(settings) {
    var list = settings ? (Array.isArray(settings) ? settings : [settings]) : []
        , found = null;
    list.forEach(function(entry) {
        if (!found && entry && entry.panelColumns)
            found = dashNormalizePanelColumns(entry.panelColumns);
    });
    return found;
}

function dashSetPanelColumnsInSettings(settings, panelColumns) {
    var list = settings ? (Array.isArray(settings) ? settings.slice() : [settings]) : []
        , normalized = dashNormalizePanelColumns(panelColumns)
        , result = [];
    list.forEach(function(entry) {
        if (entry && entry.panelColumns) return;
        result.push(entry);
    });
    if (normalized) result.push({ panelColumns: normalized });
    return result;
}

function dashApplyPanelHeight(panelEl, activeVizType) {
    var modelData = panelEl ? dashModelData[panelEl.id] : null
        , panelHeight = dashPanelHeightFromSettings(modelData && modelData.settings)
        , content = panelEl && panelEl.querySelector ? panelEl.querySelector('.f-panel-content') : null
        , chartWrap = panelEl && panelEl.querySelector ? panelEl.querySelector('.f-chart-wrap') : null
        , canvas = panelEl && panelEl.querySelector ? panelEl.querySelector('.f-chart-canvas') : null
        , applyToChart = false;
    activeVizType = activeVizType || dashPanelActiveVizType(panelEl);
    applyToChart = !!(panelHeight && chartWrap && chartWrap.style && dashIsResizableChartViz(activeVizType));
    if (panelEl) panelEl._dashPanelHeightAppliesToChart = false;
    if (content && content.style) {
        content.style.minHeight = '';
        content.style.maxHeight = '';
        content.style.overflow = '';
    }
    if (!panelHeight) return;

    if (applyToChart) {
        if (panelHeight.min !== undefined) chartWrap.style.minHeight = panelHeight.min + 'px';
        if (panelHeight.max !== undefined) {
            chartWrap.style.maxHeight = panelHeight.max + 'px';
            chartWrap.style.overflow = 'auto';
        }
        if (canvas && canvas.style) {
            canvas.style.height = '100%';
            canvas.style.maxHeight = '100%';
        }
        if (panelEl) panelEl._dashPanelHeightAppliesToChart = true;
        return;
    }

    if (!content || !content.style) return;
    if (panelHeight.min !== undefined) content.style.minHeight = panelHeight.min + 'px';
    if (panelHeight.max !== undefined) {
        content.style.maxHeight = panelHeight.max + 'px';
        content.style.overflow = 'auto';
    }
}

function dashApplyPanelColumns(panelEl) {
    var modelData = panelEl ? dashModelData[panelEl.id] : null
        , panelColumns = dashPanelColumnsFromSettings(modelData && modelData.settings);
    if (!panelEl || !panelEl.style) return;
    DASH_PANEL_COLUMN_BREAKPOINTS.forEach(function(bp) {
        var prop = '--dash-panel-cols-' + bp.key;
        if (panelColumns && panelColumns[bp.key]) {
            if (panelEl.style.setProperty) panelEl.style.setProperty(prop, panelColumns[bp.key]);
            else panelEl.style[prop] = panelColumns[bp.key];
        } else if (panelEl.style.removeProperty) {
            panelEl.style.removeProperty(prop);
        } else {
            panelEl.style[prop] = '';
        }
    });
}

function dashApplyPanelLayout(panelEl, activeVizType) {
    dashApplyPanelMaxWidth(panelEl);
    dashApplyPanelHeight(panelEl, activeVizType);
    dashApplyPanelColumns(panelEl);
}

// ─── General panel chart settings ───────────────────────────────────────────
// Panel-wide chart settings (applied across all visualizations of the panel
// where each chart property supports them).

var DASH_GENERAL_AXIS_FONT_SIZES = [8, 9, 10, 12, 14, 16];
var DASH_GENERAL_LEGEND_FONT_SIZES = [8, 9, 10, 12, 14, 16];
var DASH_GENERAL_LEGEND_POSITIONS = ['top', 'bottom', 'left', 'right', 'none'];
var DASH_GENERAL_X_ROTATIONS = [0, 45, 90];
var DASH_GENERAL_TOOLTIP_DECIMALS = [0, 1, 2, 3];

function dashNormalizePositiveNumber(value, max) {
    var raw = String(value === undefined || value === null ? '' : value).trim().replace(',', '.')
        , n;
    if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return null;
    n = parseFloat(raw);
    if (!isFinite(n) || n <= 0) return null;
    if (max !== undefined && n > max) return null;
    return n;
}

function dashNormalizeIntegerInRange(value, min, max) {
    var raw = String(value === undefined || value === null ? '' : value).trim()
        , n;
    if (!raw || !/^-?\d+$/.test(raw)) return null;
    n = parseInt(raw, 10);
    if (!isFinite(n)) return null;
    if (min !== undefined && n < min) return null;
    if (max !== undefined && n > max) return null;
    return n;
}

function dashNormalizeEnum(value, allowed) {
    var n;
    if (value === undefined || value === null || value === '') return null;
    n = (typeof value === 'number') ? value : (/^-?\d+$/.test(String(value).trim()) ? parseInt(String(value).trim(), 10) : value);
    return allowed.indexOf(n) === -1 ? null : n;
}

function dashNormalizeGeneralSettings(general) {
    var result = {}, has = false, val;
    if (!general || typeof general !== 'object') return null;

    val = dashNormalizePositiveNumber(general.barThickness, 200);
    if (val !== null) { result.barThickness = val; has = true; }

    val = dashNormalizeEnum(general.axisFontSize, DASH_GENERAL_AXIS_FONT_SIZES);
    if (val !== null) { result.axisFontSize = val; has = true; }

    val = dashNormalizeEnum(general.legendFontSize, DASH_GENERAL_LEGEND_FONT_SIZES);
    if (val !== null) { result.legendFontSize = val; has = true; }

    val = dashNormalizeEnum(general.legendPosition, DASH_GENERAL_LEGEND_POSITIONS);
    if (val !== null) { result.legendPosition = val; has = true; }

    val = dashNormalizeColorPalette(general.colorPalette);
    if (val !== null) { result.colorPalette = val; has = true; }

    val = dashNormalizePositiveNumber(general.yMaxTicksLimit, 100);
    if (val !== null) { result.yMaxTicksLimit = Math.round(val); has = true; }

    val = dashNormalizePositiveNumber(general.yStepSize);
    if (val !== null) { result.yStepSize = val; has = true; }

    val = dashNormalizeEnum(general.xLabelRotation, DASH_GENERAL_X_ROTATIONS);
    if (val !== null) { result.xLabelRotation = val; has = true; }

    if (general.xLabelAutoSkip === true || general.xLabelAutoSkip === 'true' || general.xLabelAutoSkip === 1 || general.xLabelAutoSkip === '1') {
        result.xLabelAutoSkip = true;
        has = true;
    }

    if (general.convertMinusOneToNull === true || general.convertMinusOneToNull === 'true' || general.convertMinusOneToNull === 1 || general.convertMinusOneToNull === '1') {
        result.convertMinusOneToNull = true;
        has = true;
    }

    val = dashNormalizeEnum(general.tooltipDecimals, DASH_GENERAL_TOOLTIP_DECIMALS);
    if (val !== null) { result.tooltipDecimals = val; has = true; }

    if (typeof general.tooltipPrefix === 'string' && general.tooltipPrefix !== '') {
        result.tooltipPrefix = general.tooltipPrefix.slice(0, 16);
        has = true;
    }
    if (typeof general.tooltipSuffix === 'string' && general.tooltipSuffix !== '') {
        result.tooltipSuffix = general.tooltipSuffix.slice(0, 16);
        has = true;
    }

    return has ? result : null;
}

function dashGeneralSettingsFromSettings(settings) {
    var list = settings ? (Array.isArray(settings) ? settings : [settings]) : []
        , found = null;
    list.forEach(function(entry) {
        if (!found && entry && entry.general)
            found = dashNormalizeGeneralSettings(entry.general);
    });
    return found;
}

function dashSetGeneralSettingsInSettings(settings, general) {
    var list = settings ? (Array.isArray(settings) ? settings.slice() : [settings]) : []
        , normalized = dashNormalizeGeneralSettings(general)
        , result = [];
    list.forEach(function(entry) {
        if (entry && entry.general) return;
        result.push(entry);
    });
    if (normalized) result.push({ general: normalized });
    return result;
}

function dashFormatTooltipValue(value, general) {
    var n = parseFloat(value)
        , decimals
        , prefix
        , suffix
        , str;
    if (!general) return null;
    decimals = (typeof general.tooltipDecimals === 'number') ? general.tooltipDecimals : null;
    prefix = general.tooltipPrefix || '';
    suffix = general.tooltipSuffix || '';
    if (!isFinite(n)) {
        str = String(value === undefined || value === null ? '' : value);
    } else if (decimals !== null) {
        str = n.toFixed(decimals);
    } else {
        str = String(n);
    }
    return prefix + str + suffix;
}

function dashApplyGeneralChartOptions(options, vizType, general) {
    if (!general) return options || {};
    var opts = options || {}
        , scales = opts.scales || (opts.scales = {})
        , plugins = opts.plugins || (opts.plugins = {})
        , supportsAxes = vizType === 'bar' || vizType === 'line' || vizType === 'area' || vizType === 'bubble' || vizType === 'funnel'
        , xAxis, yAxis;

    if (supportsAxes) {
        xAxis = scales.x || (scales.x = {});
        yAxis = scales.y || (scales.y = {});

        if (typeof general.axisFontSize === 'number') {
            xAxis.ticks = xAxis.ticks || {};
            xAxis.ticks.font = Object.assign({}, xAxis.ticks.font || {}, { size: general.axisFontSize });
            yAxis.ticks = yAxis.ticks || {};
            yAxis.ticks.font = Object.assign({}, yAxis.ticks.font || {}, { size: general.axisFontSize });
        }

        if (typeof general.yMaxTicksLimit === 'number') {
            yAxis.ticks = yAxis.ticks || {};
            yAxis.ticks.maxTicksLimit = general.yMaxTicksLimit;
        }
        if (typeof general.yStepSize === 'number') {
            yAxis.ticks = yAxis.ticks || {};
            yAxis.ticks.stepSize = general.yStepSize;
        }

        if (typeof general.xLabelRotation === 'number') {
            xAxis.ticks = xAxis.ticks || {};
            xAxis.ticks.maxRotation = general.xLabelRotation;
            xAxis.ticks.minRotation = general.xLabelRotation;
        }
        if (general.xLabelAutoSkip) {
            xAxis.ticks = xAxis.ticks || {};
            xAxis.ticks.autoSkip = true;
        }
    }

    if (typeof general.legendFontSize === 'number' || typeof general.legendPosition === 'string') {
        plugins.legend = plugins.legend || {};
        if (typeof general.legendPosition === 'string') {
            if (general.legendPosition === 'none') {
                plugins.legend.display = false;
            } else {
                plugins.legend.position = general.legendPosition;
            }
        }
        if (typeof general.legendFontSize === 'number') {
            plugins.legend.labels = plugins.legend.labels || {};
            plugins.legend.labels.font = Object.assign({}, plugins.legend.labels.font || {}, { size: general.legendFontSize });
        }
    }

    if (general.tooltipDecimals !== undefined || general.tooltipPrefix || general.tooltipSuffix) {
        plugins.tooltip = plugins.tooltip || {};
        plugins.tooltip.callbacks = plugins.tooltip.callbacks || {};
        plugins.tooltip.callbacks.label = function(context) {
            var raw = context && context.parsed !== undefined ? context.parsed : (context ? context.raw : null)
                , value = (raw && typeof raw === 'object') ? (raw.y !== undefined ? raw.y : (raw.value !== undefined ? raw.value : raw)) : raw
                , label = context && context.dataset && context.dataset.label ? context.dataset.label + ': ' : ''
                , formatted = dashFormatTooltipValue(value, general);
            return label + (formatted === null ? value : formatted);
        };
    }

    return opts;
}

function dashApplyGeneralBarDataset(dataset, general) {
    if (!general || !dataset) return dataset;
    if (typeof general.barThickness === 'number') {
        dataset.barThickness = general.barThickness;
        dataset.maxBarThickness = general.barThickness;
    }
    return dataset;
}

// ─── Custom chart options ────────────────────────────────────────────────────
// Per-chart-type user-supplied JSON options (e.g. to recolor the last bar of
// a bar chart). Stored on the viz entry as { customOptions: "<json string>" }.

var DASH_CUSTOM_OPTIONS_MAX_LENGTH = 8000;
var DASH_CUSTOM_OPTIONS_DOC_URL = 'https://github.com/ideav/crm/blob/main/docs/CHART_CUSTOM_OPTIONS.md';

function dashNormalizeCustomOptionsString(value) {
    var raw;
    if (value === undefined || value === null) return '';
    raw = String(value).trim();
    if (!raw) return '';
    if (raw.length > DASH_CUSTOM_OPTIONS_MAX_LENGTH) raw = raw.slice(0, DASH_CUSTOM_OPTIONS_MAX_LENGTH);
    return raw;
}

function dashParseCustomOptions(value) {
    var raw = dashNormalizeCustomOptionsString(value)
        , parsed;
    if (!raw) return null;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
}

function dashIsPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function dashDeepMergeOptions(target, source) {
    var result, key, srcVal, dstVal;
    if (!dashIsPlainObject(source)) return target;
    result = dashIsPlainObject(target) ? target : {};
    for (key in source) {
        if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
        srcVal = source[key];
        dstVal = result[key];
        if (dashIsPlainObject(srcVal) && dashIsPlainObject(dstVal)) {
            result[key] = dashDeepMergeOptions(dstVal, srcVal);
        } else if (Array.isArray(srcVal)) {
            result[key] = srcVal.slice();
        } else {
            result[key] = srcVal;
        }
    }
    return result;
}

function dashResolveDatasetIndex(idx, length) {
    var n = parseInt(idx, 10);
    if (!isFinite(n) || !length) return -1;
    if (n < 0) n = length + n;
    if (n < 0 || n >= length) return -1;
    return n;
}

function dashApplyDatasetOverride(dataset, override) {
    var data, key, val, idx, mapKey;
    if (!dataset || !dashIsPlainObject(override)) return;
    data = Array.isArray(dataset.data) ? dataset.data : [];
    for (key in override) {
        if (!Object.prototype.hasOwnProperty.call(override, key)) continue;
        val = override[key];
        if (key === 'pointColors' && dashIsPlainObject(val)) {
            dataset.backgroundColor = Array.isArray(dataset.backgroundColor)
                ? dataset.backgroundColor.slice()
                : data.map(function() { return dataset.backgroundColor; });
            for (mapKey in val) {
                if (!Object.prototype.hasOwnProperty.call(val, mapKey)) continue;
                idx = dashResolveDatasetIndex(mapKey, data.length);
                if (idx >= 0) dataset.backgroundColor[idx] = val[mapKey];
            }
        } else if (key === 'pointBorderColors' && dashIsPlainObject(val)) {
            dataset.borderColor = Array.isArray(dataset.borderColor)
                ? dataset.borderColor.slice()
                : data.map(function() { return dataset.borderColor; });
            for (mapKey in val) {
                if (!Object.prototype.hasOwnProperty.call(val, mapKey)) continue;
                idx = dashResolveDatasetIndex(mapKey, data.length);
                if (idx >= 0) dataset.borderColor[idx] = val[mapKey];
            }
        } else if (Array.isArray(val)) {
            dataset[key] = val.slice();
        } else if (dashIsPlainObject(val)) {
            dataset[key] = dashDeepMergeOptions(dashIsPlainObject(dataset[key]) ? dataset[key] : {}, val);
        } else {
            dataset[key] = val;
        }
    }
}

function dashApplyCustomChartConfig(chartConfig, customOptions) {
    var custom = dashParseCustomOptions(customOptions)
        , datasets, datasetsCfg, eachDataset, i, idx, override;
    if (!custom || !chartConfig) return chartConfig;

    if (dashIsPlainObject(custom.options))
        chartConfig.options = dashDeepMergeOptions(chartConfig.options || {}, custom.options);

    datasets = chartConfig.data && Array.isArray(chartConfig.data.datasets)
        ? chartConfig.data.datasets : [];

    eachDataset = custom.dataset || custom.eachDataset;
    if (dashIsPlainObject(eachDataset))
        datasets.forEach(function(ds) { dashApplyDatasetOverride(ds, eachDataset); });

    datasetsCfg = custom.datasets;
    if (Array.isArray(datasetsCfg)) {
        for (i = 0; i < datasetsCfg.length; i++) {
            if (!datasets[i]) continue;
            dashApplyDatasetOverride(datasets[i], datasetsCfg[i]);
        }
    } else if (dashIsPlainObject(datasetsCfg)) {
        for (var dsKey in datasetsCfg) {
            if (!Object.prototype.hasOwnProperty.call(datasetsCfg, dsKey)) continue;
            override = datasetsCfg[dsKey];
            idx = dashResolveDatasetIndex(dsKey, datasets.length);
            if (idx >= 0) dashApplyDatasetOverride(datasets[idx], override);
        }
    }

    return chartConfig;
}

function dashResetVizSizeStyles(el) {
    if (!el || !el.style) return;
    el.style.flex = '';
    el.style.width = '';
    el.style.maxWidth = '';
    el.style.height = '';
    el.style.maxHeight = '';
    el.style.minHeight = '';
    el.style.overflow = '';
}

function dashIsResizableChartViz(vizType) {
    return !!vizType && vizType !== 'table' && vizType !== 'pivot';
}

function dashCookieGet(name) {
    var escaped, match;
    if (typeof document === 'undefined' || !document.cookie) return '';
    escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
}

function dashCookieSet(name, value, maxAge) {
    if (typeof document === 'undefined') return;
    document.cookie = String(name) + '=' + encodeURIComponent(String(value))
        + '; path=/; max-age=' + String(maxAge || DASH_CHART_RESIZE_COOKIE_MAX_AGE);
}

function dashCookieRemove(name) {
    if (typeof document === 'undefined') return;
    document.cookie = String(name) + '=; path=/; max-age=0';
}

function dashCookieNamePart(value) {
    return String(value || '0').replace(/[^A-Za-z0-9_-]/g, '_');
}

function dashChartSizeCookieName(panelEl, vizType) {
    var dashId = dashRecordId || dashCurrentId || 'dash'
        , panelId = panelEl && panelEl.dataset && panelEl.dataset.panelId ? panelEl.dataset.panelId : (panelEl ? panelEl.id : 'panel');
    return 'dash_chart_size_'
        + dashCookieNamePart(dashId) + '_'
        + dashCookieNamePart(panelId) + '_'
        + dashCookieNamePart(vizType);
}

function dashReadChartSizeCookie(panelEl, vizType) {
    var raw, parsed;
    if (!dashIsResizableChartViz(vizType)) return null;
    raw = dashCookieGet(dashChartSizeCookieName(panelEl, vizType));
    if (!raw) return null;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return null;
    }
    return dashNormalizeVizSize({
        width: parsed.width ? { value: parsed.width, unit: 'px' } : null,
        height: parsed.height ? { value: parsed.height, unit: 'px' } : null
    });
}

function dashWriteChartSizeCookie(panelEl, vizType, size) {
    var normalized = dashNormalizeVizSize(size)
        , payload = {};
    if (!dashIsResizableChartViz(vizType) || !normalized) return null;
    if (normalized.width) payload.width = Math.round(parseFloat(normalized.width.value));
    if (normalized.height) payload.height = Math.round(parseFloat(normalized.height.value));
    if (!payload.width && !payload.height) return null;
    dashCookieSet(dashChartSizeCookieName(panelEl, vizType), JSON.stringify(payload), DASH_CHART_RESIZE_COOKIE_MAX_AGE);
    return payload;
}

function dashTableSizeCookieName(panelEl) {
    var dashId = dashRecordId || dashCurrentId || 'dash'
        , panelId = panelEl && panelEl.dataset && panelEl.dataset.panelId ? panelEl.dataset.panelId : (panelEl ? panelEl.id : 'panel');
    return 'dash_table_size_'
        + dashCookieNamePart(dashId) + '_'
        + dashCookieNamePart(panelId);
}

function dashReadTableSizeCookie(panelEl) {
    var raw = dashCookieGet(dashTableSizeCookieName(panelEl))
        , parsed;
    if (!raw) return null;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return null;
    }
    return dashNormalizeVizSize({
        width: parsed.width ? { value: parsed.width, unit: 'px' } : null,
        height: parsed.height ? { value: parsed.height, unit: 'px' } : null
    });
}

function dashWriteTableSizeCookie(panelEl, size) {
    var normalized = dashNormalizeVizSize(size)
        , payload = {};
    if (!normalized) return null;
    if (normalized.width) payload.width = Math.round(parseFloat(normalized.width.value));
    if (normalized.height) payload.height = Math.round(parseFloat(normalized.height.value));
    if (!payload.width && !payload.height) return null;
    dashCookieSet(dashTableSizeCookieName(panelEl), JSON.stringify(payload), DASH_CHART_RESIZE_COOKIE_MAX_AGE);
    return payload;
}

function dashPanelSizeCookieNames(panelEl) {
    var names = [];
    if (!panelEl) return names;
    names.push(dashTableSizeCookieName(panelEl));
    DASH_VIZ_TYPES.forEach(function(vizType) {
        if (dashIsResizableChartViz(vizType.id))
            names.push(dashChartSizeCookieName(panelEl, vizType.id));
    });
    return names;
}

function dashSizeCookieExists(name) {
    return !!dashCookieGet(name);
}

function dashSizeCookieHasWidth(name) {
    var raw = dashCookieGet(name)
        , parsed;
    if (!raw) return false;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return false;
    }
    return !!dashNormalizeVizSizeDimension({ value: parsed && parsed.width, unit: 'px' });
}

function dashSheetSizeCookieNames(sheetEl, widthOnly) {
    var names = []
        , seen = {};
    if (!sheetEl || !sheetEl.querySelectorAll) return names;
    sheetEl.querySelectorAll('.f-panel').forEach(function(panelEl) {
        dashPanelSizeCookieNames(panelEl).forEach(function(name) {
            if (seen[name]) return;
            if (widthOnly ? dashSizeCookieHasWidth(name) : dashSizeCookieExists(name)) {
                seen[name] = true;
                names.push(name);
            }
        });
    });
    return names;
}

function dashSheetWidthSizeCookieNames(sheetEl) {
    return dashSheetSizeCookieNames(sheetEl, true);
}

function dashUpdateSheetSizeResetIcon(sheetEl) {
    var icon = sheetEl && sheetEl.querySelector ? sheetEl.querySelector('.dash-reset-size-icon') : null
        , hasWidthCookies;
    if (!icon) return;
    hasWidthCookies = dashSheetWidthSizeCookieNames(sheetEl).length > 0;
    if (icon.classList && icon.classList.toggle)
        icon.classList.toggle('dash-reset-size-icon--visible', hasWidthCookies);
    if ('disabled' in icon) icon.disabled = !hasWidthCookies;
    if ('tabIndex' in icon) icon.tabIndex = hasWidthCookies ? 0 : -1;
    if (icon.setAttribute) {
        icon.setAttribute('aria-hidden', hasWidthCookies ? 'false' : 'true');
        icon.setAttribute('aria-disabled', hasWidthCookies ? 'false' : 'true');
    }
}

function dashUpdateAllSheetSizeResetIcons() {
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    document.querySelectorAll('#dash-model .f-sheet').forEach(dashUpdateSheetSizeResetIcon);
}

function dashSheetTileModeCookieName(sheetEl) {
    var dashId = dashRecordId || dashCurrentId || 'dash'
        , sheetId = sheetEl && sheetEl.id ? sheetEl.id : 'sheet';
    return 'dash_tile_mode_'
        + dashCookieNamePart(dashId) + '_'
        + dashCookieNamePart(sheetId);
}

function dashSheetTilePanelWidthCookieName(sheetEl) {
    var dashId = dashRecordId || dashCurrentId || 'dash'
        , sheetId = sheetEl && sheetEl.id ? sheetEl.id : 'sheet';
    return 'dash_tile_panel_width_'
        + dashCookieNamePart(dashId) + '_'
        + dashCookieNamePart(sheetId);
}

function dashReadSheetTilePanelWidth(sheetEl) {
    var raw = dashCookieGet(dashSheetTilePanelWidthCookieName(sheetEl))
        , value;
    if (!raw) return 0;
    value = parseInt(raw, 10);
    return isFinite(value) && value > 0 ? value : 0;
}

function dashWriteSheetTilePanelWidth(sheetEl, width) {
    if (!sheetEl) return;
    dashCookieSet(dashSheetTilePanelWidthCookieName(sheetEl), String(Math.round(width)),
        DASH_CHART_RESIZE_COOKIE_MAX_AGE);
}

function dashRemoveSheetTilePanelWidth(sheetEl) {
    if (!sheetEl) return;
    dashCookieRemove(dashSheetTilePanelWidthCookieName(sheetEl));
}

function dashSheetDefaultTileMode(sheetEl) {
    return !!(sheetEl && sheetEl.dataset && sheetEl.dataset.defaultTileMode === '1');
}

function dashSheetTileModeDefaultFromValue(value) {
    var normalized;
    if (value === null || value === undefined) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    normalized = String(value).trim().toLowerCase();
    if (!normalized) return false;
    return ['0', 'false', 'no', 'off', 'нет'].indexOf(normalized) === -1;
}

function dashSheetTileModeDefaultFromRow(row) {
    var names = ['Сетка', 'сетка', 'grid', 'Grid', 'GRID', 'sheetGrid', 'sheetGridMode', 'gridMode', 'tileMode', 'sheetTileMode']
        , i, name;
    if (!row) return null;
    for (i = 0; i < names.length; i++) {
        name = names[i];
        if (Object.prototype.hasOwnProperty.call(row, name))
            return dashSheetTileModeDefaultFromValue(row[name]);
    }
    return null;
}

function dashSetSheetTileModeDefault(sheetEl, row) {
    var enabled = dashSheetTileModeDefaultFromRow(row);
    if (!sheetEl || !sheetEl.dataset) return false;
    if (enabled === null) {
        if (!sheetEl.dataset.defaultTileMode)
            sheetEl.dataset.defaultTileMode = '0';
    } else {
        sheetEl.dataset.defaultTileMode = enabled ? '1' : '0';
    }
    return dashSheetDefaultTileMode(sheetEl);
}

function dashReadSheetTileMode(sheetEl) {
    var raw;
    if (!sheetEl) return false;
    raw = dashCookieGet(dashSheetTileModeCookieName(sheetEl));
    if (raw === '0') return false;
    if (raw === '1') return true;
    return dashSheetDefaultTileMode(sheetEl);
}

function dashSetSheetTileModeButtonState(sheetEl, enabled) {
    var button = sheetEl && sheetEl.querySelector ? sheetEl.querySelector('.dash-tile-mode-icon') : null;
    if (!button) return;
    if (button.classList && button.classList.toggle)
        button.classList.toggle('active', !!enabled);
    if (button.setAttribute) {
        button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        button.setAttribute('title', enabled ? 'Выключить режим плитки' : 'Включить режим плитки');
    }
    button.title = enabled ? 'Выключить режим плитки' : 'Включить режим плитки';
}

function dashMeasureSheetTilePanelMinWidth(sheetEl) {
    var maxWidth = 0;
    if (!sheetEl || !sheetEl.querySelectorAll) return 0;
    sheetEl.querySelectorAll('.f-panel').forEach(function(panelEl) {
        var rect = panelEl && panelEl.getBoundingClientRect ? panelEl.getBoundingClientRect() : null
            , width = rect && isFinite(rect.width) ? rect.width : 0;
        if (width > maxWidth) maxWidth = width;
    });
    return maxWidth > 0 ? Math.ceil(maxWidth) : 0;
}

function dashApplySheetTilePanelMinWidth(sheetEl, width) {
    if (!sheetEl || !sheetEl.style) return;
    if (!(width > 0)) {
        if (sheetEl.style.removeProperty)
            sheetEl.style.removeProperty('--dash-tile-panel-min-width');
        else
            sheetEl.style['--dash-tile-panel-min-width'] = '';
        return;
    }
    if (sheetEl.style.setProperty)
        sheetEl.style.setProperty('--dash-tile-panel-min-width', width + 'px');
    else
        sheetEl.style['--dash-tile-panel-min-width'] = width + 'px';
}

function dashPrepareSheetTileMode(sheetEl) {
    dashApplySheetTilePanelMinWidth(sheetEl, 0);
    dashRemoveSheetTilePanelResizeHandles(sheetEl);
    return 0;
}

function dashClearSheetTileMode(sheetEl) {
    dashApplySheetTilePanelMinWidth(sheetEl, 0);
    dashRemoveSheetTilePanelResizeHandles(sheetEl);
    if (sheetEl && sheetEl.classList)
        sheetEl.classList.remove('f-sheet--tile-resizing');
    if (typeof document !== 'undefined' && document.body && document.body.classList)
        document.body.classList.remove('dash-tile-resizing');
}

function dashRemoveSheetTilePanelResizeHandles(sheetEl) {
    if (!sheetEl || !sheetEl.querySelectorAll) return;
    sheetEl.querySelectorAll('.f-tile-resize-handle').forEach(function(handle) {
        if (handle && handle.parentNode && handle.parentNode.removeChild)
            handle.parentNode.removeChild(handle);
        else if (handle && handle.remove)
            handle.remove();
    });
}

function dashEnsureSheetTilePanelResizeHandles(sheetEl) {
    dashRemoveSheetTilePanelResizeHandles(sheetEl);
}

function dashApplySheetTileMode(sheetEl, enabled, persist) {
    var wasEnabled;
    enabled = !!enabled;
    if (!sheetEl || !sheetEl.classList) return enabled;
    wasEnabled = sheetEl.classList.contains('dash-tile-mode');
    if (enabled && !wasEnabled) dashPrepareSheetTileMode(sheetEl);
    sheetEl.classList.toggle('dash-tile-mode', enabled);
    if (!enabled) dashClearSheetTileMode(sheetEl);
    dashSetSheetTileModeButtonState(sheetEl, enabled);
    dashRemoveSheetTilePanelResizeHandles(sheetEl);
    if (persist) {
        if (enabled)
            dashCookieSet(dashSheetTileModeCookieName(sheetEl), '1', DASH_CHART_RESIZE_COOKIE_MAX_AGE);
        else {
            dashCookieSet(dashSheetTileModeCookieName(sheetEl), '0', DASH_CHART_RESIZE_COOKIE_MAX_AGE);
            dashRemoveSheetTilePanelWidth(sheetEl);
        }
    }
    if (typeof dashScheduleVisibleVizRefresh === 'function')
        dashScheduleVisibleVizRefresh(sheetEl);
    return enabled;
}

function dashInitSheetTileMode(sheetEl) {
    return dashApplySheetTileMode(sheetEl, dashReadSheetTileMode(sheetEl), false);
}

function dashToggleSheetTileMode(sheetEl) {
    var enabled = !(sheetEl && sheetEl.classList && sheetEl.classList.contains('dash-tile-mode'));
    dashApplySheetTileMode(sheetEl, enabled, true);
    dashSetStatus(enabled ? 'Режим плитки включен' : 'Режим плитки выключен');
    return enabled;
}

function dashPanelActiveVizType(panelEl) {
    var active = panelEl && panelEl.querySelector ? panelEl.querySelector('.f-viz-type-icon.active') : null;
    return active && active.dataset && active.dataset.vizType ? active.dataset.vizType : 'table';
}

function dashPanelVizConfig(panelEl, vizType) {
    var settings = (panelEl && dashModelData[panelEl.id] || {}).settings
        , list = settings ? (Array.isArray(settings) ? settings : [settings]) : []
        , found = null;
    list.forEach(function(entry) {
        if (!found && entry && entry.type === vizType) found = entry;
    });
    return found || {};
}

function dashReapplyPanelSizeWithoutCookies(panelEl) {
    var vizType = dashPanelActiveVizType(panelEl)
        , vizConfig = dashPanelVizConfig(panelEl, vizType);
    if (!panelEl) return;
    dashRenderChart(panelEl, vizType, vizConfig.fieldMap || {}, vizConfig);
}

function dashResetSheetSizeCookies(sheetEl) {
    var widthNames = dashSheetWidthSizeCookieNames(sheetEl)
        , names;
    if (!sheetEl || !widthNames.length) {
        dashUpdateSheetSizeResetIcon(sheetEl);
        return;
    }
    names = dashSheetSizeCookieNames(sheetEl, false);
    names.forEach(dashCookieRemove);
    sheetEl.querySelectorAll('.f-panel').forEach(dashReapplyPanelSizeWithoutCookies);
    dashUpdateSheetSizeResetIcon(sheetEl);
    dashSetStatus('Размеры панелей сброшены');
}

function dashMergeVizSize(baseSize, overrideSize) {
    var merged = {}, hasSize = false;
    if (baseSize && baseSize.width) {
        merged.width = baseSize.width;
        hasSize = true;
    }
    if (baseSize && baseSize.height) {
        merged.height = baseSize.height;
        hasSize = true;
    }
    if (overrideSize && overrideSize.width) {
        merged.width = overrideSize.width;
        hasSize = true;
    }
    if (overrideSize && overrideSize.height) {
        merged.height = overrideSize.height;
        hasSize = true;
    }
    return hasSize ? merged : null;
}

function dashResolveVizSize(panelEl, vizType, vizConfig) {
    var configuredSize = dashNormalizeVizSize(vizConfig && vizConfig.size);
    if (!dashIsResizableChartViz(vizType)) return configuredSize;
    return dashMergeVizSize(configuredSize, dashReadChartSizeCookie(panelEl, vizType));
}

function dashResolveTableSize(panelEl, vizConfig) {
    return dashMergeVizSize(
        dashNormalizeVizSize(vizConfig && vizConfig.size),
        dashReadTableSizeCookie(panelEl)
    );
}

function dashApplyVizSizeStyles(panelEl, vizType, size) {
    var chartWrap = panelEl.querySelector('.f-chart-wrap')
        , tableWrap = panelEl.querySelector('.f-table-wrap')
        , pivotWrap = panelEl.querySelector('.f-pivot-wrap')
        , canvas = panelEl.querySelector('.f-chart-canvas')
        , targetWrap = vizType === 'pivot' ? pivotWrap : (vizType === 'table' ? tableWrap : chartWrap)
        , widthCss = size && size.width ? dashVizSizeCss(size.width) : ''
        , heightCss = size && size.height ? dashVizSizeCss(size.height) : '';

    if (widthCss) {
        panelEl._dashVizWidthCss = widthCss;
        panelEl.style.flex = '0 1 ' + widthCss;
        panelEl.style.width = '100%';
        panelEl.style.maxWidth = widthCss;
    }
    if (heightCss && targetWrap) {
        targetWrap.style.height = heightCss;
        targetWrap.style.maxHeight = heightCss;
        targetWrap.style.minHeight = '0';
        if (canvas && vizType !== 'pivot') {
            canvas.style.height = '100%';
            canvas.style.maxHeight = '100%';
        }
    }
    return size;
}

function dashResizeChartInstance(panelEl) {
    var canvas = panelEl ? panelEl.querySelector('.f-chart-canvas') : null
        , chart = canvas ? canvas._chartInstance : null;
    if (!chart) return;
    if (chart.options) chart.options.maintainAspectRatio = false;
    if (typeof chart.resize === 'function') chart.resize();
    else if (typeof chart.update === 'function') chart.update();
}

function dashApplyChartPixelSize(panelEl, vizType, width, height) {
    var chartWrap = panelEl.querySelector('.f-chart-wrap')
        , pivotWrap = panelEl.querySelector('.f-pivot-wrap')
        , canvas = panelEl.querySelector('.f-chart-canvas')
        , size = dashNormalizeVizSize({
            width: { value: Math.round(width), unit: 'px' },
            height: { value: Math.round(height), unit: 'px' }
        });
    if (!size) return null;
    panelEl._dashVizWidthCss = '';
    dashResetVizSizeStyles(panelEl);
    dashResetVizSizeStyles(chartWrap);
    dashResetVizSizeStyles(pivotWrap);
    if (canvas && canvas.style) {
        canvas.style.height = '';
        canvas.style.maxHeight = '';
    }
    dashApplyVizSizeStyles(panelEl, vizType, size);
    dashApplyPanelLayout(panelEl, vizType);
    dashResizeChartInstance(panelEl);
    return size;
}

function dashApplyTablePixelSize(panelEl, width, height) {
    var tableWrap = panelEl.querySelector('.f-table-wrap')
        , chartWrap = panelEl.querySelector('.f-chart-wrap')
        , pivotWrap = panelEl.querySelector('.f-pivot-wrap')
        , canvas = panelEl.querySelector('.f-chart-canvas')
        , size = dashNormalizeVizSize({
            width: { value: Math.round(width), unit: 'px' },
            height: { value: Math.round(height), unit: 'px' }
        });
    if (!size) return null;
    panelEl._dashVizWidthCss = '';
    dashResetVizSizeStyles(panelEl);
    dashResetVizSizeStyles(tableWrap);
    dashResetVizSizeStyles(chartWrap);
    dashResetVizSizeStyles(pivotWrap);
    if (canvas && canvas.style) {
        canvas.style.height = '';
        canvas.style.maxHeight = '';
    }
    dashApplyVizSizeStyles(panelEl, 'table', size);
    dashApplyPanelLayout(panelEl, 'table');
    dashUpdateTableWrapOverflow();
    return size;
}

function dashChartResizeMaxWidth(panelEl) {
    var parent = panelEl ? panelEl.parentElement : null
        , rect = parent && parent.getBoundingClientRect ? parent.getBoundingClientRect() : null
        , width = rect && rect.width ? rect.width : ((typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1200);
    return Math.max(DASH_CHART_RESIZE_MIN_WIDTH, Math.round(width));
}

function dashChartResizeMaxHeight() {
    var height = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 800;
    return Math.max(DASH_CHART_RESIZE_MIN_HEIGHT, Math.round(height * 1.5));
}

function dashClampChartSize(value, minValue, maxValue) {
    return Math.max(minValue, Math.min(maxValue, Math.round(value)));
}

function dashStartChartResize(e, vizType) {
    var handle = e.currentTarget || e.target
        , panelEl = handle && handle.closest ? handle.closest('.f-panel') : null
        , chartWrap = panelEl ? panelEl.querySelector('.f-chart-wrap') : null
        , rect = chartWrap && chartWrap.getBoundingClientRect ? chartWrap.getBoundingClientRect() : null
        , startX, startY, startWidth, startHeight, maxWidth, maxHeight, activeVizType
        , latestSize = null;
    if (e.button !== undefined && e.button !== 0) return;
    if (!panelEl || !chartWrap || !rect) return;
    e.preventDefault();
    activeVizType = vizType || (handle.dataset ? handle.dataset.vizType : '') || 'line';
    startX = e.clientX;
    startY = e.clientY;
    startWidth = rect.width || chartWrap.offsetWidth || DASH_CHART_RESIZE_MIN_WIDTH;
    startHeight = rect.height || chartWrap.offsetHeight || DASH_CHART_RESIZE_MIN_HEIGHT;
    maxWidth = dashChartResizeMaxWidth(panelEl);
    maxHeight = dashChartResizeMaxHeight();

    function onMove(moveEvent) {
        var nextWidth, nextHeight;
        moveEvent.preventDefault();
        nextWidth = dashClampChartSize(startWidth + (moveEvent.clientX - startX), DASH_CHART_RESIZE_MIN_WIDTH, maxWidth);
        nextHeight = dashClampChartSize(startHeight + (moveEvent.clientY - startY), DASH_CHART_RESIZE_MIN_HEIGHT, maxHeight);
        latestSize = dashApplyChartPixelSize(panelEl, activeVizType, nextWidth, nextHeight);
    }

    function onUp(upEvent) {
        if (upEvent && upEvent.preventDefault) upEvent.preventDefault();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        panelEl.classList.remove('f-panel--chart-resizing');
        if (document.body && document.body.classList) document.body.classList.remove('dash-chart-resizing');
        if (latestSize) {
            dashWriteChartSizeCookie(panelEl, activeVizType, latestSize);
            if (typeof dashUpdateSheetSizeResetIcon === 'function')
                dashUpdateSheetSizeResetIcon(panelEl.closest ? panelEl.closest('.f-sheet') : null);
        }
    }

    panelEl.classList.add('f-panel--chart-resizing');
    if (document.body && document.body.classList) document.body.classList.add('dash-chart-resizing');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

function dashStartTableResize(e) {
    var handle = e.currentTarget || e.target
        , panelEl = handle && handle.closest ? handle.closest('.f-panel') : null
        , tableWrap = panelEl ? panelEl.querySelector('.f-table-wrap') : null
        , rect = tableWrap && tableWrap.getBoundingClientRect ? tableWrap.getBoundingClientRect() : null
        , startX, startY, startWidth, startHeight, maxWidth, maxHeight
        , latestSize = null;
    if (e.button !== undefined && e.button !== 0) return;
    if (!panelEl || !tableWrap || !rect) return;
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    startWidth = rect.width || tableWrap.offsetWidth || DASH_TABLE_RESIZE_MIN_WIDTH;
    startHeight = rect.height || tableWrap.offsetHeight || DASH_TABLE_RESIZE_MIN_HEIGHT;
    maxWidth = dashChartResizeMaxWidth(panelEl);
    maxHeight = dashChartResizeMaxHeight();

    function onMove(moveEvent) {
        var nextWidth, nextHeight;
        moveEvent.preventDefault();
        nextWidth = dashClampChartSize(startWidth + (moveEvent.clientX - startX), DASH_TABLE_RESIZE_MIN_WIDTH, maxWidth);
        nextHeight = dashClampChartSize(startHeight + (moveEvent.clientY - startY), DASH_TABLE_RESIZE_MIN_HEIGHT, maxHeight);
        latestSize = dashApplyTablePixelSize(panelEl, nextWidth, nextHeight);
    }

    function onUp(upEvent) {
        if (upEvent && upEvent.preventDefault) upEvent.preventDefault();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        panelEl.classList.remove('f-panel--table-resizing');
        if (document.body && document.body.classList) document.body.classList.remove('dash-table-resizing');
        if (latestSize) {
            dashWriteTableSizeCookie(panelEl, latestSize);
            if (typeof dashUpdateSheetSizeResetIcon === 'function')
                dashUpdateSheetSizeResetIcon(panelEl.closest ? panelEl.closest('.f-sheet') : null);
        }
    }

    panelEl.classList.add('f-panel--table-resizing');
    if (document.body && document.body.classList) document.body.classList.add('dash-table-resizing');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

function dashEnsureChartResizeHandle(panelEl, vizType) {
    var chartWrap = panelEl ? panelEl.querySelector('.f-chart-wrap') : null
        , handle;
    if (!chartWrap || typeof document === 'undefined' || !document.createElement) return;
    handle = chartWrap.querySelector('.f-chart-resize-handle');
    if (!dashIsResizableChartViz(vizType)) {
        if (handle) handle.style.display = 'none';
        return;
    }
    if (!handle) {
        handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'f-chart-resize-handle';
        handle.title = 'Изменить размер графика';
        handle.setAttribute('aria-label', 'Изменить размер графика');
        handle.addEventListener('mousedown', function(ev) {
            dashStartChartResize(ev, handle.dataset.vizType);
        });
        chartWrap.appendChild(handle);
    }
    handle.dataset.vizType = vizType || '';
    handle.style.display = '';
}

function dashEnsureTableResizeHandle(panelEl) {
    var tableWrap = panelEl ? panelEl.querySelector('.f-table-wrap') : null
        , handle;
    if (!tableWrap || typeof document === 'undefined' || !document.createElement) return;
    handle = tableWrap.querySelector('.f-table-resize-handle');
    if (!handle) {
        handle = document.createElement('button');
        handle.type = 'button';
        handle.className = 'f-table-resize-handle';
        handle.title = 'Изменить размер таблицы';
        handle.setAttribute('aria-label', 'Изменить размер таблицы');
        handle.addEventListener('mousedown', dashStartTableResize);
        tableWrap.appendChild(handle);
    }
    handle.style.display = '';
}

function dashApplyVizSize(panelEl, vizType, vizConfig) {
    var chartWrap = panelEl.querySelector('.f-chart-wrap')
        , tableWrap = panelEl.querySelector('.f-table-wrap')
        , pivotWrap = panelEl.querySelector('.f-pivot-wrap')
        , canvas = panelEl.querySelector('.f-chart-canvas')
        , size = vizType === 'table'
            ? dashResolveTableSize(panelEl, vizConfig || {})
            : dashResolveVizSize(panelEl, vizType, vizConfig || {})
        , appliedSize = null;

    panelEl._dashVizWidthCss = '';
    dashResetVizSizeStyles(panelEl);
    dashResetVizSizeStyles(tableWrap);
    dashResetVizSizeStyles(chartWrap);
    dashResetVizSizeStyles(pivotWrap);
    if (canvas && canvas.style) {
        canvas.style.height = '';
        canvas.style.maxHeight = '';
    }

    if (vizType === 'table') {
        dashEnsureTableResizeHandle(panelEl);
        if (size) appliedSize = dashApplyVizSizeStyles(panelEl, vizType, size);
        dashApplyPanelLayout(panelEl, 'table');
        return appliedSize;
    }

    dashEnsureChartResizeHandle(panelEl, vizType);

    if (size) appliedSize = dashApplyVizSizeStyles(panelEl, vizType, size);
    dashApplyPanelLayout(panelEl, vizType);
    return appliedSize;
}

function dashDocumentHidden() {
    return typeof document !== 'undefined' && document.hidden === true;
}

function dashElementHiddenForRender(el) {
    var doc = typeof document !== 'undefined' ? document : null
        , rects;
    if (!el || dashDocumentHidden()) return true;
    if (el.getClientRects) {
        rects = el.getClientRects();
        if (!rects || rects.length === 0) return true;
    }
    if (el.offsetParent === null && (!doc || (el !== doc.body && el !== doc.documentElement)))
        return true;
    return false;
}

function dashQueueHiddenVizRender(panelEl, vizType, fieldMap, vizConfig) {
    var normalizedFieldMap = Object.assign({}, fieldMap || (vizConfig && vizConfig.fieldMap) || {})
        , normalizedConfig = Object.assign({}, vizConfig || {});
    if (!panelEl) return;
    if (normalizedConfig.fieldMap)
        normalizedConfig.fieldMap = Object.assign({}, normalizedConfig.fieldMap);
    if (Object.keys(normalizedFieldMap).length)
        normalizedConfig.fieldMap = normalizedFieldMap;
    panelEl._dashDeferredViz = {
        vizType: vizType,
        fieldMap: normalizedFieldMap,
        vizConfig: normalizedConfig
    };
    if (panelEl.dataset) panelEl.dataset.dashDeferredViz = vizType || '';
}

function dashPanelListForRoot(rootEl) {
    var doc = typeof document !== 'undefined' ? document : null
        , root = rootEl || doc;
    if (!root) return [];
    if (root.matches && root.matches('.f-panel')) return [root];
    if (!root.querySelectorAll) return [];
    if (doc && root === doc) return Array.from(root.querySelectorAll('#dash-model .f-panel'));
    return Array.from(root.querySelectorAll('.f-panel'));
}

function dashFlushDeferredVizRenders(rootEl) {
    if (dashDocumentHidden()) return;
    dashPanelListForRoot(rootEl).forEach(function(panelEl) {
        var pending = panelEl._dashDeferredViz;
        if (!pending || dashElementHiddenForRender(panelEl)) return;
        delete panelEl._dashDeferredViz;
        if (panelEl.dataset) delete panelEl.dataset.dashDeferredViz;
        dashRenderChart(panelEl, pending.vizType, pending.fieldMap || {}, pending.vizConfig || {});
    });
}

function dashRefreshChartInstance(chart) {
    if (!chart) return;
    if (typeof chart.resize === 'function') chart.resize();
    if (typeof chart.update === 'function') chart.update('none');
}

function dashRefreshVisibleCharts(rootEl) {
    if (dashDocumentHidden()) return;
    dashPanelListForRoot(rootEl).forEach(function(panelEl) {
        var canvas, chart;
        if (dashElementHiddenForRender(panelEl)) return;
        canvas = panelEl.querySelector('.f-chart-canvas');
        chart = canvas ? canvas._chartInstance : null;
        dashRefreshChartInstance(chart);
    });
}

function dashScheduleVisibleVizRefresh(rootEl) {
    var run = function() {
        if (dashDocumentHidden()) return;
        dashFlushDeferredVizRenders(rootEl);
        dashRefreshVisibleCharts(rootEl);
    };
    if (dashDocumentHidden()) return;
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(function() {
            window.requestAnimationFrame(run);
        });
    } else {
        setTimeout(run, 0);
    }
}

function dashRenderChart(panelEl, vizType, fieldMap, vizConfig) {
    if (vizType !== 'table' && dashElementHiddenForRender(panelEl)) {
        dashQueueHiddenVizRender(panelEl, vizType, fieldMap, vizConfig);
        return;
    }

    var data = dashCollectPanelData(panelEl, Object.assign({}, vizConfig || {}, { type: vizType, fieldMap: fieldMap || {}, convertMinusOneToNull: !!((dashGeneralSettingsFromSettings((dashModelData[panelEl.id] || {}).settings) || {}).convertMinusOneToNull) }));
    var canvas = panelEl.querySelector('.f-chart-canvas');
    var chartWrap = panelEl.querySelector('.f-chart-wrap');
    var tableWrap = panelEl.querySelector('.f-table-wrap');
    var pivotWrap = panelEl.querySelector('.f-pivot-wrap');
    var vizSize = dashApplyVizSize(panelEl, vizType, vizConfig || {});

    // Destroy old chart if any
    if (canvas._chartInstance) {
        canvas._chartInstance.destroy();
        canvas._chartInstance = null;
    }

    tableWrap.style.display = 'none';
    pivotWrap.style.display = 'none';

    if (vizType === 'table') {
        dashRenderReportTable(panelEl);
        dashEnsureTableResizeHandle(panelEl);
        tableWrap.style.display = '';
        chartWrap.style.display = 'none';
        panelEl.classList.remove('f-panel--chart');
        dashUpdateSubheadStickyTop(panelEl);
        return;
    }

    if (vizType === 'pivot') {
        chartWrap.style.display = 'none';
        pivotWrap.style.display = '';
        panelEl.classList.add('f-panel--chart');
        dashRenderPivot(panelEl, pivotWrap, data, fieldMap, vizConfig || {});
        return;
    }

    chartWrap.style.display = '';
    panelEl.classList.add('f-panel--chart');

    dashEnsureChartJs(function() {
        var labels = data.labels;
        var chartType, chartDatasets, options = {};
        var modelData = dashModelData[panelEl.id] || {};
        var general = dashGeneralSettingsFromSettings(modelData.settings);
        var palette = dashChartPaletteFromGeneral(general);

        if (dashElementHiddenForRender(panelEl)) {
            dashQueueHiddenVizRender(panelEl, vizType, fieldMap, vizConfig);
            return;
        }

        if (vizType === 'pie') {
            chartType = 'pie';
            var vals = data.datasets.length ? data.datasets[0].data : [];
            chartDatasets = [{
                data: vals,
                backgroundColor: labels.map(function(_, i) { return dashChartColor(palette, i); })
            }];
            options = { plugins: { legend: { position: 'right' } } };

        } else if (vizType === 'line') {
            chartType = 'line';
            chartDatasets = data.datasets.map(function(ds, i) {
                var color = dashChartColor(palette, i);
                return { label: ds.label, data: ds.data, borderColor: color, backgroundColor: color, tension: 0.3, fill: false };
            });

        } else if (vizType === 'area') {
            chartType = 'line';
            chartDatasets = dashBuildAreaDatasets(data.datasets, fieldMap, palette);
            options = dashBuildAreaChartOptions(fieldMap);

        } else if (vizType === 'bar') {
            var barMode = (fieldMap && fieldMap.barMode) || 'grouped';
            chartType = 'bar';
            var hasPairedMeta = data.datasets.some(function(ds) { return ds && ds._stack; });
            if (barMode === 'pairedStacked' && hasPairedMeta) {
                var seriesIndex = {}, nextSeriesIdx = 0;
                data.datasets.forEach(function(ds) {
                    var key = ds._series == null ? ds.label : ds._series;
                    if (!(key in seriesIndex)) seriesIndex[key] = nextSeriesIdx++;
                });
                chartDatasets = data.datasets.map(function(ds) {
                    var key = ds._series == null ? ds.label : ds._series;
                    var color = dashChartColor(palette, seriesIndex[key]);
                    return dashApplyGeneralBarDataset({ label: ds.label, data: ds.data, backgroundColor: color, stack: String(ds._stack || 'default') }, general);
                });
                options = { scales: { x: { stacked: true }, y: { stacked: true } } };
            } else {
                chartDatasets = data.datasets.map(function(ds, i) {
                    return dashApplyGeneralBarDataset({ label: ds.label, data: ds.data, backgroundColor: dashChartColor(palette, i) }, general);
                });
                options = { scales: { x: { stacked: barMode === 'stacked' || barMode === 'combo' }, y: { stacked: barMode === 'stacked' } } };
            }

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
                backgroundColor: dashChartColor(palette, 0)
            }];

        } else if (vizType === 'funnel') {
            chartType = 'bar';
            var funnelVals = data.datasets.length ? data.datasets[0].data : [];
            var funnelPairs = labels.map(function(lbl, i) {
                return { label: lbl, value: Number(funnelVals[i]) || 0 };
            }).sort(function(a, b) { return b.value - a.value; });
            labels = funnelPairs.map(function(p) { return p.label; });
            chartDatasets = [{
                label: data.datasets[0] && data.datasets[0].label ? data.datasets[0].label : '',
                data: funnelPairs.map(function(p) { return p.value; }),
                backgroundColor: funnelPairs.map(function(_, i) { return dashChartColor(palette, i); }),
                borderWidth: 0
            }];
            options = {
                indexAxis: 'y',
                plugins: { legend: { display: false } },
                scales: {
                    x: { beginAtZero: true },
                    y: { ticks: { autoSkip: false } }
                }
            };
        }

        if ((vizSize && vizSize.height) || panelEl._dashPanelHeightAppliesToChart)
            options.maintainAspectRatio = false;

        options = dashApplyGeneralChartOptions(options, vizType, general);

        var chartConfig = {
            type: chartType,
            data: { labels: labels, datasets: chartDatasets },
            options: options
        };
        dashApplyCustomChartConfig(chartConfig, vizConfig && vizConfig.customOptions);

        canvas._chartInstance = new Chart(canvas, chartConfig);
    });
}

function dashGetPivotUiElement(pivotWrap) {
    if (!pivotWrap || !pivotWrap.querySelector) return pivotWrap;
    return pivotWrap.querySelector('.dash-pivot-ui') || pivotWrap;
}

function dashEnsurePivotShell(pivotWrap) {
    var uiWrap, actionsWrap;
    if (!pivotWrap) return { uiWrap: null, actionsWrap: null };
    if (!pivotWrap.querySelector || !pivotWrap.appendChild || !document.createElement) {
        pivotWrap.innerHTML = '';
        return { uiWrap: pivotWrap, actionsWrap: null };
    }
    uiWrap = pivotWrap.querySelector('.dash-pivot-ui');
    actionsWrap = pivotWrap.querySelector('.dash-pivot-actions');
    if (!uiWrap) {
        pivotWrap.innerHTML = '';
        actionsWrap = null;
        uiWrap = document.createElement('div');
        uiWrap.className = 'dash-pivot-ui';
        pivotWrap.appendChild(uiWrap);
    } else {
        uiWrap.innerHTML = '';
    }
    if (!actionsWrap) {
        actionsWrap = document.createElement('div');
        actionsWrap.className = 'dash-pivot-actions';
        pivotWrap.appendChild(actionsWrap);
    }
    return { uiWrap: uiWrap, actionsWrap: actionsWrap };
}

function dashNormalizePivotConfig(config) {
    var clean = {}
        , arrayKeys = ['rows', 'cols', 'vals']
        , stringKeys = ['aggregatorName', 'rendererName', 'rowOrder', 'colOrder']
        , objectKeys = ['exclusions', 'inclusions'];
    if (!config || typeof config !== 'object') return clean;

    function cloneJsonValue(value) {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            return undefined;
        }
    }

    arrayKeys.forEach(function(key) {
        var value = cloneJsonValue(config[key]);
        if (Array.isArray(value)) clean[key] = value;
    });
    stringKeys.forEach(function(key) {
        if (typeof config[key] === 'string' && config[key]) clean[key] = config[key];
    });
    objectKeys.forEach(function(key) {
        var value = cloneJsonValue(config[key]);
        if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length)
            clean[key] = value;
    });
    return clean;
}

function dashPivotConfigString(config) {
    function stable(value) {
        var sorted = {};
        if (Array.isArray(value)) return value.map(stable);
        if (!value || typeof value !== 'object') return value;
        Object.keys(value).sort().forEach(function(key) {
            sorted[key] = stable(value[key]);
        });
        return sorted;
    }
    return JSON.stringify(stable(dashNormalizePivotConfig(config)));
}

function dashDefaultPivotConfig(data, fieldMap) {
    var config = { rows: [], cols: [], aggregatorName: 'Sum', rendererName: 'Table', vals: [] }
        , rowField, colField, valField;
    if (data && data.records && data.columns) {
        rowField = dashReportColumnByField(data.columns, fieldMap && fieldMap.pivotRows);
        colField = dashReportColumnByField(data.columns, fieldMap && fieldMap.pivotCols);
        valField = dashReportColumnByField(data.columns, fieldMap && fieldMap.pivotVals);
        rowField = rowField || dashReportDefaultColumn(data.columns, '', dashReportColumnIsDimension);
        valField = valField || dashReportDefaultColumn(data.columns, '', dashReportColumnIsMeasure);
        config.rows = rowField ? [rowField.name] : [];
        config.cols = colField ? [colField.name] : [];
        config.vals = valField ? [valField.name] : [];
        return config;
    }
    config.rows = fieldMap && fieldMap.pivotRows ? [fieldMap.pivotRows] : ['Строка'];
    config.cols = fieldMap && fieldMap.pivotCols ? [fieldMap.pivotCols] : [];
    config.vals = fieldMap && fieldMap.pivotVals ? [fieldMap.pivotVals] : (data && data.datasets && data.datasets[0] ? [data.datasets[0].label || 'Значение'] : []);
    return config;
}

function dashPivotConfigForRender(data, fieldMap, vizConfig) {
    return Object.assign(
        {},
        dashDefaultPivotConfig(data, fieldMap),
        dashNormalizePivotConfig(vizConfig && vizConfig.pivotConfig)
    );
}

function dashPanelCanSaveVizSettings(panelEl) {
    return !!(panelEl && panelEl.querySelector && panelEl.querySelector('.f-panel-settings-icon'));
}

function dashReadPivotControlsState(pivotWrap) {
    var value;
    if (!pivotWrap) return null;
    value = pivotWrap.dataset ? pivotWrap.dataset.dashPivotControlsOpen : pivotWrap._dashPivotControlsOpen;
    if (value === undefined || value === null || value === '') return null;
    return value === true || value === '1';
}

function dashSetPivotControlsVisible(pivotWrap, visible) {
    var uiWrap = dashGetPivotUiElement(pivotWrap)
        , toggle = uiWrap && uiWrap.querySelector ? uiWrap.querySelector('.dash-pivot-settings-toggle') : null
        , open = !!visible;
    if (!pivotWrap || !uiWrap) return;
    if (pivotWrap.dataset) pivotWrap.dataset.dashPivotControlsOpen = open ? '1' : '0';
    else pivotWrap._dashPivotControlsOpen = open;
    if (pivotWrap.classList) {
        pivotWrap.classList.toggle('dash-pivot-controls-open', open);
        pivotWrap.classList.toggle('dash-pivot-controls-collapsed', !open);
    }
    if (uiWrap.classList) {
        uiWrap.classList.toggle('dash-pivot-controls-open', open);
        uiWrap.classList.toggle('dash-pivot-controls-collapsed', !open);
    }
    if (toggle) {
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (toggle.classList) toggle.classList.toggle('active', open);
    }
}

function dashPivotHasConfiguredOptions(fieldMap, vizConfig) {
    var fm = Object.assign({}, (vizConfig && vizConfig.fieldMap) || {}, fieldMap || {})
        , pivotConfig = dashNormalizePivotConfig(vizConfig && vizConfig.pivotConfig);
    if (fm.pivotRows || fm.pivotCols || fm.pivotVals) return true;
    return Object.keys(pivotConfig).some(function(key) {
        var value = pivotConfig[key];
        if (Array.isArray(value)) return value.length > 0;
        if (value && typeof value === 'object') return Object.keys(value).length > 0;
        return !!value;
    });
}

function dashPivotControlsAutoOpened(pivotWrap) {
    var value;
    if (!pivotWrap) return false;
    value = pivotWrap.dataset ? pivotWrap.dataset.dashPivotControlsAutoOpened : pivotWrap._dashPivotControlsAutoOpened;
    return value === true || value === '1';
}

function dashSetPivotControlsAutoOpened(pivotWrap) {
    if (!pivotWrap) return;
    if (pivotWrap.dataset) pivotWrap.dataset.dashPivotControlsAutoOpened = '1';
    else pivotWrap._dashPivotControlsAutoOpened = true;
}

function dashShouldAutoOpenPivotControls(pivotWrap, fieldMap, vizConfig) {
    return !dashPivotControlsAutoOpened(pivotWrap) && !dashPivotHasConfiguredOptions(fieldMap, vizConfig);
}

function dashMarkPivotRendererArea(uiWrap) {
    var rendererArea, rendererRow;
    if (!uiWrap || !uiWrap.querySelector) return null;
    if (uiWrap.querySelectorAll)
        Array.from(uiWrap.querySelectorAll('.dash-pivot-renderer-row')).forEach(function(row) {
            if (row.classList) row.classList.remove('dash-pivot-renderer-row');
        });
    rendererArea = uiWrap.querySelector('.pvtRendererArea');
    if (!rendererArea) return null;
    rendererRow = rendererArea.closest ? rendererArea.closest('tr') : null;
    if (rendererRow && rendererRow.classList) rendererRow.classList.add('dash-pivot-renderer-row');
    return rendererArea;
}

function dashEnsurePivotSettingsToggle(panelEl, pivotWrap) {
    var uiWrap = dashGetPivotUiElement(pivotWrap)
        , rendererArea = dashMarkPivotRendererArea(uiWrap)
        , toggle;
    if (!rendererArea || !rendererArea.querySelector || !rendererArea.appendChild || !document.createElement)
        return null;
    toggle = rendererArea.querySelector('.dash-pivot-settings-toggle');
    if (toggle) return toggle;
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'dash-pivot-settings-toggle';
    toggle.title = 'Настройка';
    toggle.setAttribute('aria-label', 'Настройка сводной таблицы');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<i class="pi pi-cog"></i>';
    toggle.addEventListener('click', function(e) {
        var state;
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        state = dashReadPivotControlsState(pivotWrap);
        dashSetPivotControlsVisible(pivotWrap, state !== true);
    });
    rendererArea.appendChild(toggle);
    return toggle;
}

function dashRefreshPivotControls(panelEl, pivotWrap, fieldMap, vizConfig, allowAutoOpen) {
    var toggle = dashEnsurePivotSettingsToggle(panelEl, pivotWrap)
        , state = dashReadPivotControlsState(pivotWrap);
    dashSetPivotControlsVisible(pivotWrap, state === true);
    if (allowAutoOpen && toggle && dashShouldAutoOpenPivotControls(pivotWrap, fieldMap, vizConfig)) {
        dashSetPivotControlsAutoOpened(pivotWrap);
        if (toggle.click) toggle.click();
        else dashSetPivotControlsVisible(pivotWrap, true);
    }
}

function dashEnsurePivotSaveButton(panelEl, pivotWrap) {
    var actionsWrap, btn;
    if (!dashPanelCanSaveVizSettings(panelEl) || !pivotWrap || !pivotWrap.querySelector || !pivotWrap.appendChild || !document.createElement)
        return null;
    actionsWrap = pivotWrap.querySelector('.dash-pivot-actions');
    if (!actionsWrap) {
        actionsWrap = document.createElement('div');
        actionsWrap.className = 'dash-pivot-actions';
        pivotWrap.appendChild(actionsWrap);
    }
    btn = actionsWrap.querySelector('.dash-pivot-save-settings');
    if (btn) return btn;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dash-apply-btn dash-btn-primary dash-pivot-save-settings';
    btn.textContent = 'Сохранить настройки';
    btn.style.display = 'none';
    btn.addEventListener('click', function(e) {
        if (e && e.preventDefault) e.preventDefault();
        dashSaveCurrentPivotSettings(panelEl, pivotWrap);
    });
    actionsWrap.appendChild(btn);
    return btn;
}

function dashSetPivotSaveButtonDirty(panelEl, pivotWrap, dirty) {
    var btn = dirty ? dashEnsurePivotSaveButton(panelEl, pivotWrap)
        : (pivotWrap && pivotWrap.querySelector ? pivotWrap.querySelector('.dash-pivot-save-settings') : null);
    if (!btn) return;
    btn.style.display = dirty ? '' : 'none';
}

function dashCurrentPivotConfig(pivotWrap) {
    var uiWrap = dashGetPivotUiElement(pivotWrap)
        , options;
    if (pivotWrap && pivotWrap._dashPivotCurrentConfig)
        return dashNormalizePivotConfig(pivotWrap._dashPivotCurrentConfig);
    if (!uiWrap || !window.jQuery) return null;
    options = window.jQuery(uiWrap).data ? window.jQuery(uiWrap).data('pivotUIOptions') : null;
    return options ? dashNormalizePivotConfig(options) : null;
}

function dashSetPivotSavedConfig(pivotWrap, configString) {
    if (!pivotWrap) return;
    if (pivotWrap.dataset) pivotWrap.dataset.dashPivotSavedConfig = configString;
    else pivotWrap._dashPivotSavedConfig = configString;
}

function dashGetPivotSavedConfig(pivotWrap) {
    if (!pivotWrap) return '';
    return pivotWrap.dataset ? pivotWrap.dataset.dashPivotSavedConfig || '' : pivotWrap._dashPivotSavedConfig || '';
}

function dashMergePivotConfigIntoSettings(settings, pivotConfig) {
    var vizList = settings ? (Array.isArray(settings) ? settings.slice() : [settings]) : []
        , idx = -1
        , normalized = dashNormalizePivotConfig(pivotConfig)
        , pivotEntry, fieldMap;
    vizList.forEach(function(viz, i) {
        if (idx === -1 && viz && viz.type === 'pivot') idx = i;
    });
    pivotEntry = idx === -1 ? { type: 'pivot' } : Object.assign({}, vizList[idx]);
    fieldMap = Object.assign({}, pivotEntry.fieldMap || {});
    if (normalized.rows && normalized.rows.length) fieldMap.pivotRows = normalized.rows[0];
    else delete fieldMap.pivotRows;
    if (normalized.cols && normalized.cols.length) fieldMap.pivotCols = normalized.cols[0];
    else delete fieldMap.pivotCols;
    if (normalized.vals && normalized.vals.length) fieldMap.pivotVals = normalized.vals[0];
    else delete fieldMap.pivotVals;
    pivotEntry.fieldMap = fieldMap;
    pivotEntry.pivotConfig = normalized;
    if (idx === -1) vizList.push(pivotEntry);
    else vizList[idx] = pivotEntry;
    return vizList;
}

function dashSaveCurrentPivotSettings(panelEl, pivotWrap) {
    var panelKey = panelEl ? panelEl.id : ''
        , modelData = dashModelData[panelKey] || {}
        , panelID = modelData.panelID || ''
        , pivotConfig = dashCurrentPivotConfig(pivotWrap)
        , settings, jsonStr;
    if (!panelEl || !pivotConfig) return;
    settings = dashMergePivotConfigIntoSettings(modelData.settings, pivotConfig);
    jsonStr = JSON.stringify(settings);
    if (panelID) {
        newApi('POST', '_m_set/' + panelID + '?JSON', 'dashPivotSettingsSaved',
            't1165=' + encodeURIComponent(jsonStr),
            { panelEl: panelEl, panelKey: panelKey, settings: settings, pivotWrap: pivotWrap, pivotConfig: pivotConfig });
    } else {
        dashApplyNewVizSettings(panelEl, panelKey, settings);
        dashSetPivotSavedConfig(pivotWrap, dashPivotConfigString(pivotConfig));
        dashSetPivotSaveButtonDirty(panelEl, pivotWrap, false);
        dashSetStatus('Настройки сохранены');
    }
}

window.dashPivotSettingsSaved = function(json, ctx) {
    if (!json || json.error) { dashSetStatus('Ошибка сохранения настроек'); return; }
    dashApplyNewVizSettings(ctx.panelEl, ctx.panelKey, ctx.settings);
    if (ctx.pivotWrap) {
        dashSetPivotSavedConfig(ctx.pivotWrap, dashPivotConfigString(ctx.pivotConfig));
        dashSetPivotSaveButtonDirty(ctx.panelEl, ctx.pivotWrap, false);
    }
    dashSetStatus('Настройки сохранены');
};

function dashRenderPivot(panelEl, pivotWrap, data, fieldMap, vizConfig) {
    if (dashElementHiddenForRender(panelEl)) {
        dashQueueHiddenVizRender(panelEl, 'pivot', fieldMap, vizConfig);
        return;
    }
    if (!dashPivotDepsReady()) {
        dashEnsurePivotJs(function() {
            dashRenderPivot(panelEl, pivotWrap, data, fieldMap, vizConfig);
        });
        return;
    }
    var shell = dashEnsurePivotShell(pivotWrap)
        , uiWrap = shell.uiWrap
        , records
        , options = dashPivotConfigForRender(data, fieldMap, vizConfig || {})
        , initialRefreshSeen = false;
    if (!uiWrap) return;
    delete pivotWrap._dashPivotCurrentConfig;
    if (data.records && data.columns) {
        records = data.records;
    } else {
        records = data.labels.map(function(lbl, i) {
            var rec = { 'Строка': lbl };
            data.datasets.forEach(function(ds) {
                rec[ds.label || 'Значение'] = ds.data[i] || 0;
            });
            return rec;
        });
    }

    options.onRefresh = function(currentOptions) {
        var currentConfig = dashNormalizePivotConfig(currentOptions || dashCurrentPivotConfig(pivotWrap) || options)
            , currentString = dashPivotConfigString(currentConfig)
            , savedString = dashGetPivotSavedConfig(pivotWrap);
        pivotWrap._dashPivotCurrentConfig = currentConfig;
        dashRefreshPivotControls(panelEl, pivotWrap, fieldMap, vizConfig, !initialRefreshSeen);
        if (!initialRefreshSeen) {
            initialRefreshSeen = true;
            dashSetPivotSavedConfig(pivotWrap, currentString);
            dashSetPivotSaveButtonDirty(panelEl, pivotWrap, false);
            return;
        }
        dashSetPivotSaveButtonDirty(panelEl, pivotWrap, currentString !== savedString);
    };

    window.jQuery(uiWrap).pivotUI(records, options, true);
    dashEnsurePivotSaveButton(panelEl, pivotWrap);
    dashRefreshPivotControls(panelEl, pivotWrap, fieldMap, vizConfig, true);
    if (!initialRefreshSeen) {
        initialRefreshSeen = true;
        dashSetPivotSavedConfig(pivotWrap, dashPivotConfigString(dashCurrentPivotConfig(pivotWrap) || options));
        dashSetPivotSaveButtonDirty(panelEl, pivotWrap, false);
    }
}

function dashPanelApplySettings(panelKey, settings, renderChart) {
    var panel = document.getElementById(panelKey);
    if (!panel) return;
    if (!settings) return;

    // Normalize: settings can be a single object {type:...} or an array
    var vizList = Array.isArray(settings) ? settings : [settings];
    var enabled = vizList.filter(function(v) { return v && v.type; });
    var def = enabled.find(function(v) { return v.default; }) || enabled[0];
    dashApplyPanelLayout(panel, def && def.type ? def.type : 'table');
    if (!enabled.length) return;

    // Build visualization type icons
    dashUpdatePanelVizIcons(panel, enabled);

    if (!renderChart) return;

    // Find default or first enabled
    if (def && def.type) {
        dashRenderChart(panel, def.type, def.fieldMap || {}, def);
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
            container.querySelectorAll('.f-viz-type-icon').forEach(function(b) { b.classList.remove('active'); delete b.dataset.userSelected; });
            btn.classList.add('active');
            btn.dataset.userSelected = '1';
            var modelData = dashModelData[panel.id] || {};
            var s = modelData.settings;
            var vizList = s ? (Array.isArray(s) ? s : [s]) : [];
            var vizCfg = vizList.find(function(v) { return v.type === viz.type; }) || {};
            dashRenderChart(panel, viz.type, vizCfg.fieldMap || {}, vizCfg);
        });
        container.appendChild(btn);
    });

    // Mark current default as active
    var settings = (dashModelData[panel.id] || {}).settings;
    var vizList = settings ? (Array.isArray(settings) ? settings : [settings]) : [];
    vizList = vizList.filter(function(v) { return v && v.type; });
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
    var panelGeneralEl = document.getElementById('dash-panel-general-settings');
    if (panelGeneralEl)
        panelGeneralEl.innerHTML = dashBuildPanelHeightHtml(dashPanelHeightFromSettings(settings))
            + dashBuildPanelColumnsHtml(dashPanelColumnsFromSettings(settings))
            + dashBuildPanelGeneralHtml(dashGeneralSettingsFromSettings(settings));
    dashVizModalActivateTab('panels');

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
        if (!dashPanelGetVizReportData(panelEl))
            fieldMapHtml += dashBuildVizRowsHtml(existing ? existing.selectedRows : null, panelEl);
        fieldMapHtml += dashBuildVizCustomOptionsHtml(existing ? existing.customOptions : '');
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
        dashInitVizRowBulkControls(item);
        dashInitVizCustomOptionsControl(item);

        accordion.appendChild(item);
    });

    document.getElementById('dash-viz-modal').classList.add('open');
}

function dashBuildFieldMapHtml(vizType, fieldMap, panelEl) {
    var report = dashPanelGetVizReportData(panelEl);
    if (report) return dashBuildReportFieldMapHtml(vizType, fieldMap, report);

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
            + '<select class="dash-viz-field-select" name="' + name + '">'
            + optionsHtml.replace('value="' + dashAttr(val) + '"', 'value="' + dashAttr(val) + '" selected')
            + '</select></div>';
    }

    if (vizType === 'bar') {
        var barMode = fm.barMode || 'grouped';
        return '<div class="dash-viz-field-row"><label>Режим</label>'
            + '<select class="dash-viz-field-select" name="barMode">'
            + '<option value="grouped"' + (barMode === 'grouped' ? ' selected' : '') + '>Группы столбиков</option>'
            + '<option value="stacked"' + (barMode === 'stacked' ? ' selected' : '') + '>Сегменты</option>'
            + '<option value="combo"' + (barMode === 'combo' ? ' selected' : '') + '>Комбинация</option>'
            + '<option value="pairedStacked"' + (barMode === 'pairedStacked' ? ' selected' : '') + '>Пары со стеком</option>'
            + '</select></div>'
            + sel('stackField', 'Стек', fm.stackField || '');
    }
    if (vizType === 'area') {
        return dashBuildAreaModeHtml(fm)
            + '<div class="dash-viz-field-row dash-viz-field-hint">Поля подбираются автоматически из данных панели.</div>';
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

function dashBuildReportFieldOptions(columns, selected, predicate, includeEmpty) {
    var html = includeEmpty ? '<option value="">(не задано)</option>' : ''
        , selectedKey = String(selected || '')
        , selectedFound = !selectedKey;
    (columns || []).forEach(function(column) {
        if (predicate && !predicate(column)) return;
        var value = String(column.id)
            , isSelected = selectedKey && (selectedKey === value || selectedKey === String(column.name));
        if (isSelected) selectedFound = true;
        html += '<option value="' + dashAttr(value) + '"' + (isSelected ? ' selected' : '') + '>'
            + dashAttr(column.name)
            + '</option>';
    });
    if (selectedKey && !selectedFound)
        html += '<option value="' + dashAttr(selectedKey) + '" selected>' + dashAttr(selectedKey) + '</option>';
    return html;
}

function dashBuildReportFieldMapHtml(vizType, fieldMap, report) {
    var columns = report ? report.columns || [] : []
        , fm = fieldMap || {};

    function sel(name, label, val, predicate, includeEmpty) {
        return '<div class="dash-viz-field-row"><label>' + label + '</label>'
            + '<select class="dash-viz-field-select" name="' + name + '">'
            + dashBuildReportFieldOptions(columns, val, predicate, includeEmpty !== false)
            + '</select></div>';
    }

    if (vizType === 'bar') {
        var barMode = fm.barMode || 'grouped';
        return '<div class="dash-viz-field-row"><label>Режим</label>'
            + '<select class="dash-viz-field-select" name="barMode">'
            + '<option value="grouped"' + (barMode === 'grouped' ? ' selected' : '') + '>Группы столбиков</option>'
            + '<option value="stacked"' + (barMode === 'stacked' ? ' selected' : '') + '>Сегменты</option>'
            + '<option value="combo"' + (barMode === 'combo' ? ' selected' : '') + '>Комбинация</option>'
            + '<option value="pairedStacked"' + (barMode === 'pairedStacked' ? ' selected' : '') + '>Пары со стеком</option>'
            + '</select></div>'
            + sel('labelField', 'Ось X', fm.labelField || fm.xField || '', dashReportColumnIsDimension)
            + sel('valueField', 'Значение', fm.valueField || '', dashReportColumnIsMeasure)
            + sel('seriesField', 'Серии (цвет)', fm.seriesField || '', dashReportColumnIsDimension)
            + sel('stackField', 'Стек', fm.stackField || '', dashReportColumnIsDimension);
    }
    if (vizType === 'line') {
        return sel('labelField', 'Ось X', fm.labelField || fm.xField || '', dashReportColumnIsDimension)
            + sel('valueField', 'Значение', fm.valueField || '', dashReportColumnIsMeasure)
            + sel('seriesField', 'Серии', fm.seriesField || '', dashReportColumnIsDimension);
    }
    if (vizType === 'area') {
        return dashBuildAreaModeHtml(fm)
            + sel('labelField', 'Ось X', fm.labelField || fm.xField || '', dashReportColumnIsDimension)
            + sel('valueField', 'Значение', fm.valueField || '', dashReportColumnIsMeasure)
            + sel('seriesField', 'Серии', fm.seriesField || '', dashReportColumnIsDimension);
    }
    if (vizType === 'pie') {
        return sel('labelField', 'Сектор', fm.labelField || '', dashReportColumnIsDimension)
            + sel('valueField', 'Значение', fm.valueField || '', dashReportColumnIsMeasure);
    }
    if (vizType === 'funnel') {
        return sel('labelField', 'Этап', fm.labelField || '', dashReportColumnIsDimension)
            + sel('valueField', 'Значение', fm.valueField || '', dashReportColumnIsMeasure);
    }
    if (vizType === 'bubble') {
        return sel('bubbleX', 'X (ось)', fm.bubbleX || '', dashReportColumnIsMeasure)
            + sel('bubbleY', 'Y (ось)', fm.bubbleY || '', dashReportColumnIsMeasure)
            + sel('bubbleR', 'Размер', fm.bubbleR || '', dashReportColumnIsMeasure)
            + sel('labelField', 'Подпись', fm.labelField || fm.bubbleLabel || '', dashReportColumnIsDimension);
    }
    if (vizType === 'pivot') {
        return sel('pivotRows', 'Строки', fm.pivotRows || '', dashReportColumnIsDimension)
            + sel('pivotCols', 'Столбцы', fm.pivotCols || '', dashReportColumnIsDimension)
            + sel('pivotVals', 'Значения', fm.pivotVals || '', dashReportColumnIsMeasure);
    }
    return '';
}

function dashBuildVizRowsHtml(selectedRows, panelEl) {
    var rows = Array.from(panelEl.querySelectorAll('.f-item'))
        , selected = dashNormalizeSelectedRows(selectedRows)
        , rowItems = []
        , allChecked = true
        , html = '';
    if (!rows.length) return '';

    rows.forEach(function(row) {
        var key = dashPanelGetRowKey(row)
            , name = dashPanelGetRowName(row)
            , checked = selected === null || selected[key] || selected[name];
        if (!checked) allChecked = false;
        rowItems.push({ key: key, name: name, checked: checked });
    });

    html += '<div class="dash-viz-rows-group">'
        + '<div class="dash-viz-rows-head">'
        + '<div class="dash-viz-rows-title">Строки на графике</div>'
        + '<label class="dash-viz-row-all-option">'
        + '<input type="checkbox" class="dash-viz-row-all-check"' + (allChecked ? ' checked' : '') + '>'
        + '<span>Все строки</span>'
        + '</label>'
        + '</div>'
        + '<div class="dash-viz-rows-list">';
    rowItems.forEach(function(row) {
        html += '<label class="dash-viz-row-option">'
            + '<input type="checkbox" class="dash-viz-row-check" value="' + dashAttr(row.key) + '"' + (row.checked ? ' checked' : '') + '>'
            + '<span>' + dashAttr(row.name) + '</span>'
            + '</label>';
    });
    html += '</div></div>';
    return html;
}

function dashSyncVizRowAllCheck(group) {
    var allCheck = group ? group.querySelector('.dash-viz-row-all-check') : null
        , checks = group ? Array.from(group.querySelectorAll('.dash-viz-row-check')) : [];
    if (!allCheck || !checks.length) return;

    var checkedCount = checks.filter(function(check) { return check.checked; }).length;
    allCheck.checked = checkedCount === checks.length;
    allCheck.indeterminate = checkedCount > 0 && checkedCount < checks.length;
}

function dashInitVizRowBulkControls(item) {
    if (!item) return;
    item.querySelectorAll('.dash-viz-rows-group').forEach(function(group) {
        var allCheck = group.querySelector('.dash-viz-row-all-check')
            , checks = Array.from(group.querySelectorAll('.dash-viz-row-check'));
        if (!allCheck || !checks.length) return;

        allCheck.addEventListener('change', function() {
            checks.forEach(function(check) {
                check.checked = allCheck.checked;
            });
            dashSyncVizRowAllCheck(group);
        });

        checks.forEach(function(check) {
            check.addEventListener('change', function() {
                dashSyncVizRowAllCheck(group);
            });
        });

        dashSyncVizRowAllCheck(group);
    });
}

function dashInitVizCustomOptionsControl(item) {
    var textarea = item ? item.querySelector('.dash-viz-custom-options') : null
        , statusEl = item ? item.querySelector('.dash-viz-custom-options-status') : null;
    if (!textarea || !statusEl) return;
    textarea.addEventListener('input', function() {
        var raw = dashNormalizeCustomOptionsString(textarea.value);
        if (!raw) {
            statusEl.classList.remove('dash-viz-custom-options-status--error');
            statusEl.textContent = 'Опционально. JSON-объект с полями options / datasets, переопределяющий настройки Chart.js.';
            return;
        }
        if (dashParseCustomOptions(raw) === null) {
            statusEl.classList.add('dash-viz-custom-options-status--error');
            statusEl.textContent = 'Некорректный JSON — настройки не будут применены, пока ошибка не исправлена.';
        } else {
            statusEl.classList.remove('dash-viz-custom-options-status--error');
            statusEl.textContent = 'JSON корректен.';
        }
    });
}

function dashCollectVizCustomOptions(item) {
    var textarea = item ? item.querySelector('.dash-viz-custom-options') : null
        , raw = textarea ? dashNormalizeCustomOptionsString(textarea.value) : '';
    return raw || '';
}

function dashBuildVizCustomOptionsHtml(customOptions) {
    var raw = dashNormalizeCustomOptionsString(customOptions)
        , isInvalid = raw && dashParseCustomOptions(raw) === null;
    return '<div class="dash-viz-custom-options-group">'
        + '<div class="dash-viz-custom-options-head">'
        + '<div class="dash-viz-rows-title">Кастомные настройки диаграммы (JSON)</div>'
        + '<a class="dash-viz-custom-options-help" href="' + DASH_CUSTOM_OPTIONS_DOC_URL + '" target="_blank" rel="noopener noreferrer" title="Описание правил кастомных настроек">Правила и примеры</a>'
        + '</div>'
        + '<textarea class="dash-viz-custom-options" name="customOptions" rows="4" maxlength="' + DASH_CUSTOM_OPTIONS_MAX_LENGTH
        + '" placeholder=\'{"datasets":{"-1":{"pointColors":{"-1":"#e53935"}}}}\'>'
        + dashAttr(raw)
        + '</textarea>'
        + '<div class="dash-viz-custom-options-status' + (isInvalid ? ' dash-viz-custom-options-status--error' : '') + '">'
        + (isInvalid ? 'Некорректный JSON — настройки не будут применены, пока ошибка не исправлена.' : 'Опционально. JSON-объект с полями options / datasets, переопределяющий настройки Chart.js.')
        + '</div>'
        + '</div>';
}

function dashBuildPanelHeightHtml(panelHeight) {
    var normalized = dashNormalizePanelHeight(panelHeight) || {};
    return '<div class="dash-panel-general-group dash-panel-height-group">'
        + '<div class="dash-viz-size-title">Высота панели / графика</div>'
        + '<div class="dash-viz-field-row dash-panel-height-row"><label>Минимальная</label>'
        + '<input type="number" min="0" max="4000" step="1" name="panelHeightMin" value="' + dashAttr(normalized.min !== undefined ? normalized.min : '') + '">'
        + '<span>px</span></div>'
        + '<div class="dash-viz-field-row dash-panel-height-row"><label>Максимальная</label>'
        + '<input type="number" min="0" max="4000" step="1" name="panelHeightMax" value="' + dashAttr(normalized.max !== undefined ? normalized.max : '') + '">'
        + '<span>px</span></div>'
        + '</div>';
}

function dashBuildPanelColumnsHtml(panelColumns) {
    var cols = dashPanelColumnsWithDefaults(panelColumns)
        , html = '<div class="dash-panel-general-group dash-panel-columns-group">'
            + '<div class="dash-viz-size-title">Ширина панели (12 колонок)</div>';
    DASH_PANEL_COLUMN_BREAKPOINTS.forEach(function(bp) {
        html += '<div class="dash-viz-field-row dash-panel-columns-row"><label>' + bp.label + ' ' + bp.range + '</label>'
            + '<input type="number" min="1" max="12" step="1" name="panelColumns' + bp.key.toUpperCase() + '" value="' + dashAttr(cols[bp.key]) + '">'
            + '</div>';
    });
    return html + '</div>';
}

function dashBuildSelectOptions(values, selected, valueFormatter) {
    var fmt = valueFormatter || function(v) { return v; };
    return values.map(function(value) {
        var attrValue = String(value)
            , isSelected = selected !== null && selected !== undefined && String(selected) === attrValue;
        return '<option value="' + dashAttr(attrValue) + '"' + (isSelected ? ' selected' : '') + '>' + fmt(value) + '</option>';
    }).join('');
}

function dashBuildPanelGeneralHtml(general) {
    var g = general || {}
        , fontOptions = dashBuildSelectOptions(DASH_GENERAL_AXIS_FONT_SIZES, g.axisFontSize, function(v) { return v + ' px'; })
        , legendFontOptions = dashBuildSelectOptions(DASH_GENERAL_LEGEND_FONT_SIZES, g.legendFontSize, function(v) { return v + ' px'; })
        , legendPositionLabels = { top: 'Сверху', bottom: 'Снизу', left: 'Слева', right: 'Справа', none: 'Без легенды' }
        , legendPositionOptions = dashBuildSelectOptions(DASH_GENERAL_LEGEND_POSITIONS, g.legendPosition, function(v) { return legendPositionLabels[v] || v; })
        , rotationOptions = dashBuildSelectOptions(DASH_GENERAL_X_ROTATIONS, g.xLabelRotation, function(v) { return v + '°'; })
        , decimalOptions = dashBuildSelectOptions(DASH_GENERAL_TOOLTIP_DECIMALS, g.tooltipDecimals)
        , paletteText = dashColorPaletteToText(g.colorPalette);
    return '<div class="dash-panel-general-group">'
        + '<div class="dash-viz-size-title">Толщина столбцов (px)</div>'
        + '<div class="dash-viz-field-row"><label>Толщина</label>'
        + '<input type="number" min="0" max="200" step="1" name="generalBarThickness" value="' + dashAttr(g.barThickness !== undefined ? g.barThickness : '') + '">'
        + '</div>'
        + '</div>'
        + '<div class="dash-panel-general-group">'
        + '<div class="dash-viz-size-title">Цветовая гамма</div>'
        + '<div class="dash-viz-field-row"><label>Цвета</label>'
        + '<input type="text" maxlength="512" name="generalColorPalette" placeholder="#1B50F3, cyan, A4B9FA" value="' + dashAttr(paletteText) + '">'
        + '</div>'
        + '</div>'
        + '<div class="dash-panel-general-group">'
        + '<div class="dash-viz-size-title">Размер шрифта подписей осей</div>'
        + '<div class="dash-viz-field-row"><label>Размер</label>'
        + '<select name="generalAxisFontSize"><option value="">(по умолчанию)</option>' + fontOptions + '</select>'
        + '</div>'
        + '</div>'
        + '<div class="dash-panel-general-group">'
        + '<div class="dash-viz-size-title">Легенда</div>'
        + '<div class="dash-viz-field-row"><label>Положение</label>'
        + '<select name="generalLegendPosition"><option value="">(по умолчанию)</option>' + legendPositionOptions + '</select>'
        + '</div>'
        + '<div class="dash-viz-field-row"><label>Размер шрифта</label>'
        + '<select name="generalLegendFontSize"><option value="">(по умолчанию)</option>' + legendFontOptions + '</select>'
        + '</div>'
        + '</div>'
        + '<div class="dash-panel-general-group">'
        + '<div class="dash-viz-size-title">Деления оси Y</div>'
        + '<div class="dash-viz-field-row"><label>Макс. меток</label>'
        + '<input type="number" min="0" max="100" step="1" name="generalYMaxTicksLimit" value="' + dashAttr(g.yMaxTicksLimit !== undefined ? g.yMaxTicksLimit : '') + '">'
        + '</div>'
        + '<div class="dash-viz-field-row"><label>Шаг</label>'
        + '<input type="number" min="0" step="1" name="generalYStepSize" value="' + dashAttr(g.yStepSize !== undefined ? g.yStepSize : '') + '">'
        + '</div>'
        + '</div>'
        + '<div class="dash-panel-general-group">'
        + '<div class="dash-viz-size-title">Подписи оси X</div>'
        + '<div class="dash-viz-field-row"><label>Поворот</label>'
        + '<select name="generalXLabelRotation"><option value="">(авто)</option>' + rotationOptions + '</select>'
        + '</div>'
        + '<div class="dash-viz-field-row"><label></label>'
        + '<label class="dash-viz-check-label"><input type="checkbox" name="generalXLabelAutoSkip"' + (g.xLabelAutoSkip ? ' checked' : '') + '>'
        + '<span>Прятать метки, если не влезают</span></label>'
        + '</div>'
        + '</div>'
        + '<div class="dash-panel-general-group">'
        + '<div class="dash-viz-size-title">Формат подсказки (Tooltip)</div>'
        + '<div class="dash-viz-field-row"><label>Знаков после запятой</label>'
        + '<select name="generalTooltipDecimals"><option value="">(по умолчанию)</option>' + decimalOptions + '</select>'
        + '</div>'
        + '<div class="dash-viz-field-row"><label>Префикс</label>'
        + '<input type="text" maxlength="16" name="generalTooltipPrefix" value="' + dashAttr(g.tooltipPrefix || '') + '">'
        + '</div>'
        + '<div class="dash-viz-field-row"><label>Суффикс</label>'
        + '<input type="text" maxlength="16" name="generalTooltipSuffix" value="' + dashAttr(g.tooltipSuffix || '') + '">'
        + '</div>'
        + '</div>'
        + '<div class="dash-panel-general-group">'
        + '<div class="dash-viz-size-title">Данные</div>'
        + '<div class="dash-viz-field-row"><label></label>'
        + '<label class="dash-viz-check-label"><input type="checkbox" name="generalConvertMinusOneToNull"' + (g.convertMinusOneToNull ? ' checked' : '') + '>'
        + '<span>Преобразовывать -1 в null (для разрывов в графиках)</span></label>'
        + '</div>'
        + '</div>';
}

function dashCollectPanelHeight() {
    var container = document.getElementById('dash-panel-general-settings')
        , result;
    if (!container) return null;

    function read(name) {
        var input = container.querySelector('[name="' + name + '"]');
        return input ? input.value : '';
    }

    result = dashNormalizePanelHeight({
        min: read('panelHeightMin'),
        max: read('panelHeightMax')
    });
    return result;
}

function dashCollectPanelColumns() {
    var container = document.getElementById('dash-panel-general-settings')
        , result = {};
    if (!container) return null;
    DASH_PANEL_COLUMN_BREAKPOINTS.forEach(function(bp) {
        var input = container.querySelector('[name="panelColumns' + bp.key.toUpperCase() + '"]');
        if (input) result[bp.key] = input.value;
    });
    return dashNormalizePanelColumns(result);
}

function dashCollectPanelGeneral() {
    var container = document.getElementById('dash-panel-general-settings')
        , result = {}
        , has = false
        , val
        , el;
    if (!container) return null;

    function read(name) {
        var input = container.querySelector('[name="' + name + '"]');
        return input ? input.value : '';
    }

    val = dashNormalizePositiveNumber(read('generalBarThickness'), 200);
    if (val !== null) { result.barThickness = val; has = true; }

    val = dashNormalizeEnum(read('generalAxisFontSize'), DASH_GENERAL_AXIS_FONT_SIZES);
    if (val !== null) { result.axisFontSize = val; has = true; }

    val = dashNormalizeEnum(read('generalLegendFontSize'), DASH_GENERAL_LEGEND_FONT_SIZES);
    if (val !== null) { result.legendFontSize = val; has = true; }

    val = dashNormalizeEnum(read('generalLegendPosition'), DASH_GENERAL_LEGEND_POSITIONS);
    if (val !== null) { result.legendPosition = val; has = true; }

    val = dashNormalizeColorPalette(read('generalColorPalette'));
    if (val !== null) { result.colorPalette = val; has = true; }

    val = dashNormalizePositiveNumber(read('generalYMaxTicksLimit'), 100);
    if (val !== null) { result.yMaxTicksLimit = Math.round(val); has = true; }

    val = dashNormalizePositiveNumber(read('generalYStepSize'));
    if (val !== null) { result.yStepSize = val; has = true; }

    val = dashNormalizeEnum(read('generalXLabelRotation'), DASH_GENERAL_X_ROTATIONS);
    if (val !== null) { result.xLabelRotation = val; has = true; }

    el = container.querySelector('[name="generalXLabelAutoSkip"]');
    if (el && el.checked) { result.xLabelAutoSkip = true; has = true; }

    el = container.querySelector('[name="generalConvertMinusOneToNull"]');
    if (el && el.checked) { result.convertMinusOneToNull = true; has = true; }

    val = dashNormalizeEnum(read('generalTooltipDecimals'), DASH_GENERAL_TOOLTIP_DECIMALS);
    if (val !== null) { result.tooltipDecimals = val; has = true; }

    val = read('generalTooltipPrefix');
    if (val) { result.tooltipPrefix = String(val).slice(0, 16); has = true; }

    val = read('generalTooltipSuffix');
    if (val) { result.tooltipSuffix = String(val).slice(0, 16); has = true; }

    return has ? result : null;
}

function dashVizModalIsOpen() {
    var modal = document.getElementById('dash-viz-modal');
    return !!(modal && modal.classList.contains('open'));
}

function dashCloseVizModal() {
    var modal = document.getElementById('dash-viz-modal');
    if (modal) modal.classList.remove('open');
    dashVizModalCtx = null;
}

function dashHandleVizModalKeydown(e) {
    if (!e || (e.key !== 'Escape' && e.keyCode !== 27)) return;
    if (!dashVizModalIsOpen()) return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    dashCloseVizModal();
}

function dashHandleVizModalBackdropClick(e) {
    var modal = document.getElementById('dash-viz-modal');
    if (modal && e && e.target === modal) dashCloseVizModal();
}

function dashVizModalActivateTab(name) {
    var modal = document.getElementById('dash-viz-modal');
    if (!modal) return;
    var tabs = modal.querySelectorAll('.dash-viz-tab');
    tabs.forEach(function(tab) {
        var active = tab.dataset.vizTab === name;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    modal.querySelectorAll('.dash-viz-tab-pane').forEach(function(pane) {
        pane.classList.toggle('active', pane.dataset.vizTabPane === name);
    });
}

function dashCollectVizSizeDimension(item, axis) {
    var valueEl = item.querySelector(axis === 'width' ? '[name="sizeWidthValue"]' : '[name="sizeHeightValue"]')
        , unitEl = item.querySelector(axis === 'width' ? '[name="sizeWidthUnit"]' : '[name="sizeHeightUnit"]')
        , value = valueEl ? valueEl.value : ''
        , unit = unitEl ? unitEl.value : 'px';
    return dashNormalizeVizSizeDimension({ value: value, unit: unit });
}

function dashCollectVizSize(item) {
    var result = {}
        , width = dashCollectVizSizeDimension(item, 'width')
        , height = dashCollectVizSizeDimension(item, 'height');
    if (width) result.width = width;
    if (height) result.height = height;
    return result.width || result.height ? result : null;
}

function dashCollectVizSelectedRows(item) {
    var checks = Array.from(item.querySelectorAll('.dash-viz-row-check'))
        , selected = []
        , unchecked = false;
    if (!checks.length) return null;
    checks.forEach(function(check) {
        if (check.checked) selected.push(check.value);
        else unchecked = true;
    });
    return unchecked ? selected : null;
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
        var size = dashCollectVizSize(item);
        var selectedRows = dashCollectVizSelectedRows(item);
        var customOptions = dashCollectVizCustomOptions(item);
        item.querySelectorAll('.dash-viz-fieldmap .dash-viz-field-select').forEach(function(sel) {
            if (sel.name && sel.value) fieldMap[sel.name] = sel.value;
        });
        var entry = { type: vizType, fieldMap: fieldMap };
        if (size) entry.size = size;
        if (selectedRows !== null) entry.selectedRows = selectedRows;
        if (customOptions) entry.customOptions = customOptions;
        if (isDefault) entry.default = true;
        result.push(entry);
    });
    result = dashSetPanelHeightInSettings(result, dashCollectPanelHeight());
    result = dashSetPanelColumnsInSettings(result, dashCollectPanelColumns());
    result = dashSetGeneralSettingsInSettings(result, dashCollectPanelGeneral());
    return result;
}

document.getElementById('dash-viz-cancel').addEventListener('click', function() {
    dashCloseVizModal();
});

document.querySelectorAll('#dash-viz-modal .dash-viz-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
        dashVizModalActivateTab(tab.dataset.vizTab);
    });
    tab.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            dashVizModalActivateTab(tab.dataset.vizTab);
        }
    });
});

document.getElementById('dash-viz-modal').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        if (e.target && e.target.classList && e.target.classList.contains('dash-viz-tab')) return;
        e.preventDefault();
        document.getElementById('dash-viz-save').click();
    }
});
document.addEventListener('keydown', dashHandleVizModalKeydown);
document.getElementById('dash-viz-modal').addEventListener('click', dashHandleVizModalBackdropClick);

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
    var vizList = settings ? (Array.isArray(settings) ? settings : [settings]) : [];
    var enabled = vizList.filter(function(v) { return v && v.type; });
    dashUpdatePanelVizIcons(panelEl, enabled);
    var def = enabled.find(function(v) { return v.default; }) || enabled[0];
    if (def) {
        dashRenderChart(panelEl, def.type, def.fieldMap || {}, def);
    } else {
        // No enabled: show table
        dashApplyVizSize(panelEl, 'table', {});
        panelEl.querySelector('.f-table-wrap').style.display = '';
        panelEl.querySelector('.f-chart-wrap').style.display = 'none';
        panelEl.querySelector('.f-pivot-wrap').style.display = 'none';
        panelEl.classList.remove('f-panel--chart');
    }
}

function dashRefreshPanelMaxWidths() {
    document.querySelectorAll('#dash-model .f-panel').forEach(dashApplyPanelLayout);
}

// ─── Panel filters ──────────────────────────────────────────────────────────

var dashPanelFilterModalCtx = null;

function dashPanelFiltersFor(panelEl) {
    var modelStore = (typeof dashModelData !== 'undefined') ? dashModelData : {}
        , filterStore = (typeof dashPanelFilters !== 'undefined') ? dashPanelFilters : {}
        , modelFilters = panelEl && modelStore[panelEl.id] ? modelStore[panelEl.id].panelFilters : null
        , userFilters = panelEl && filterStore[panelEl.id] ? filterStore[panelEl.id] : null;
    if (!modelFilters) return userFilters || {};
    if (!userFilters) return modelFilters || {};
    return dashMergePanelFilterState(dashMergePanelFilterState({}, modelFilters), userFilters);
}

function dashPanelFilterModalIsOpen() {
    var modal = document.getElementById('dash-panel-filter-modal');
    return !!(modal && modal.classList.contains('open'));
}

function dashClosePanelFilterModal() {
    var modal = document.getElementById('dash-panel-filter-modal');
    if (modal) modal.classList.remove('open');
    dashPanelFilterModalCtx = null;
}

function dashHandlePanelFilterModalKeydown(e) {
    if (!e || (e.key !== 'Escape' && e.keyCode !== 27)) return;
    if (!dashPanelFilterModalIsOpen()) return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    dashClosePanelFilterModal();
}

function dashHandlePanelFilterBackdropClick(e) {
    var modal = document.getElementById('dash-panel-filter-modal');
    if (modal && e && e.target === modal) dashClosePanelFilterModal();
}

function dashReportRowsToColumns(rows) {
    var columns = [], seen = {};
    (rows || []).forEach(function(row) {
        Object.keys(row || {}).forEach(function(name) {
            if (seen[name]) return;
            seen[name] = true;
            columns.push({ id: name, name: name, format: '' });
        });
    });
    return columns;
}

function dashMergePanelFilterFields(target, incoming) {
    var byKey = {};
    target.forEach(function(field) { byKey[field.key] = field; });
    (incoming || []).forEach(function(field) {
        var existing = byKey[field.key]
            , fieldMin, fieldMax, existingMin, existingMax;
        if (!existing) {
            target.push(field);
            byKey[field.key] = field;
            return;
        }
        if (field.kind === 'range' && existing.kind === 'range') {
            if (field.valueType === 'number' || existing.valueType === 'number') {
                fieldMin = parseFloat(field.min);
                fieldMax = parseFloat(field.max);
                existingMin = parseFloat(existing.min);
                existingMax = parseFloat(existing.max);
                if (field.min !== undefined && (existing.min === undefined || !isFinite(existingMin) || (isFinite(fieldMin) && fieldMin < existingMin))) existing.min = field.min;
                if (field.max !== undefined && (existing.max === undefined || !isFinite(existingMax) || (isFinite(fieldMax) && fieldMax > existingMax))) existing.max = field.max;
            } else {
                if (field.min !== undefined && (existing.min === undefined || field.min < existing.min)) existing.min = field.min;
                if (field.max !== undefined && (existing.max === undefined || field.max > existing.max)) existing.max = field.max;
            }
        } else if ((field.kind === 'values' || field.kind === 'month') && Array.isArray(field.options)) {
            if (!existing._seen) {
                existing._seen = {};
                (existing.options || []).forEach(function(option) { existing._seen[option.value] = true; });
            }
            field.options.forEach(function(option) {
                if (existing._seen[option.value]) return;
                existing._seen[option.value] = true;
                existing.options.push(option);
            });
        }
    });
}

function dashFinalizePanelFilterFields(fields) {
    fields.forEach(function(field) {
        if (field._seen) delete field._seen;
        if (Array.isArray(field.options))
            field.options.sort(function(a, b) {
                return String(a.value).localeCompare(String(b.value), undefined, { numeric: true });
            });
    });
    return fields;
}

function dashCollectFormulaFilterFields(panelEl) {
    var rows = [];
    panelEl.querySelectorAll('.f-item').forEach(function(row) {
        var rowId = row.id
            , sources = dashReportSources[rowId] || (dashReportKeys[rowId] ? [{ reportKey: dashReportKeys[rowId] }] : []);
        sources.forEach(function(source) {
            var reportRows = source && source.reportKey ? dashReports[source.reportKey] : null;
            if (Array.isArray(reportRows)) rows = rows.concat(reportRows);
        });
    });
    if (!rows.length) return [];
    return dashBuildReportFilterFields(dashReportRowsToColumns(rows), rows);
}

function dashBuildTableFilterFields(panelEl) {
    var fields = []
        , rowField = { source: 'table', key: 'table:row', tableTarget: 'row', field: 'row', label: 'Строка', kind: 'values', valueType: 'text', options: [] }
        , colField = { source: 'table', key: 'table:column', tableTarget: 'column', field: 'column', label: 'Колонка', kind: 'values', valueType: 'text', options: [] }
        , valueField = { source: 'table', key: 'table:value', tableTarget: 'value', field: 'value', label: 'Значение', kind: 'range', valueType: 'number' }
        , dateField = { source: 'table', key: 'table:date', tableTarget: 'date', field: 'date', label: 'Дата', kind: 'range', valueType: 'date' }
        , minValue = null, maxValue = null, minDate = null, maxDate = null;

    panelEl.querySelectorAll('.f-item').forEach(function(row) {
        dashPanelAddFilterOption(rowField, dashPanelGetRowName(row));
        row.querySelectorAll('td.f-cell').forEach(function(td) {
            var n = dashGetFloat(td.textContent.trim())
                , fr = dashPanelDateValue(dashCellDateFr(td) || '')
                , to = dashPanelDateValue(dashCellDateTo(td) || '')
                , col = dashPanelTableCellColumnLabel(td);
            if (col) dashPanelAddFilterOption(colField, col);
            if (!isNaN(n)) {
                if (minValue === null || n < minValue) minValue = n;
                if (maxValue === null || n > maxValue) maxValue = n;
            }
            if (fr && (minDate === null || fr < minDate)) minDate = fr;
            if (to && (maxDate === null || to > maxDate)) maxDate = to;
        });
    });

    if (rowField.options.length) fields.push(rowField);
    if (colField.options.length) fields.push(colField);
    if (minValue !== null || maxValue !== null) {
        valueField.min = String(minValue);
        valueField.max = String(maxValue);
        fields.push(valueField);
    }
    if (minDate || maxDate) {
        dateField.min = minDate || maxDate;
        dateField.max = maxDate || minDate;
        fields.push(dateField);
    }
    return dashFinalizePanelFilterFields(fields);
}

function dashCollectPanelFilterFields(panelEl) {
    var fields = []
        , report = dashPanelGetVizReportData(panelEl);
    if (report)
        dashMergePanelFilterFields(fields, dashBuildReportFilterFields(report.columns || [], report.rows || []));
    dashMergePanelFilterFields(fields, dashCollectFormulaFilterFields(panelEl));
    if (!fields.length)
        dashMergePanelFilterFields(fields, dashBuildTableFilterFields(panelEl));
    return dashFinalizePanelFilterFields(fields);
}

function dashPanelFilterSelectedMap(filter) {
    var selected = {};
    (filter && filter.selected || []).forEach(function(value) { selected[String(value)] = true; });
    return selected;
}

function dashPanelFilterOptionChecks(fieldEl) {
    return fieldEl ? Array.from(fieldEl.querySelectorAll('.dash-panel-filter-option-input')) : [];
}

function dashSetPanelFilterOptionChecks(fieldEl, checked) {
    dashPanelFilterOptionChecks(fieldEl).forEach(function(check) {
        check.checked = checked;
    });
}

function dashSyncPanelFilterBulkControls(fieldEl) {
    var checks = dashPanelFilterOptionChecks(fieldEl)
        , selectAll = fieldEl ? fieldEl.querySelector('.dash-panel-filter-select-all') : null
        , checkedCount = checks.filter(function(check) { return check.checked; }).length
        , allChecked = checks.length > 0 && checkedCount === checks.length
        , partiallyChecked = checkedCount > 0 && checkedCount < checks.length;
    if (selectAll) {
        selectAll.checked = allChecked;
        selectAll.indeterminate = partiallyChecked;
    }
}

function dashHandlePanelFilterCheckboxChange(input) {
    var fieldEl = input && input.closest ? input.closest('.dash-panel-filter-field') : null;
    if (!fieldEl) return;
    if (input.classList.contains('dash-panel-filter-select-all')) {
        dashSetPanelFilterOptionChecks(fieldEl, input.checked);
    } else if (!input.classList.contains('dash-panel-filter-option-input')) {
        return;
    }
    dashSyncPanelFilterBulkControls(fieldEl);
}

function dashPanelTableCellColumnLabel(td) {
    var table, head, ths, idx, th;
    if (!td) return '';
    if (td.dataset && td.dataset.rgCol) return td.dataset.rgCol;
    if (td.dataset && td.dataset.rgHead) return td.dataset.rgHead;
    table = td.closest ? td.closest('table') : null;
    head = table ? table.querySelector('thead .f-subhead') || table.querySelector('thead .f-head') : null;
    if (!head) return '';
    idx = Array.from(td.parentNode.cells).indexOf(td);
    ths = Array.from(head.querySelectorAll('th'));
    th = ths[idx];
    return th ? (th.getAttribute('data-rg-col') || th.textContent || '').trim() : '';
}

function dashPanelTableCellPassesFilters(td, filters) {
    var cellFilters = [], selected, colValue, n, from, to, fr, cellFrom, cellTo;
    Object.keys(filters || {}).forEach(function(key) {
        var filter = filters[key];
        if (filter && filter.source === 'table' && filter.tableTarget !== 'row' && dashPanelFilterIsActive(filter))
            cellFilters.push(filter);
    });
    if (!cellFilters.length) return true;

    for (var i = 0; i < cellFilters.length; i++) {
        var filter = cellFilters[i];
        if (filter.tableTarget === 'column') {
            selected = dashPanelFilterSelectedMap(filter);
            colValue = dashPanelFilterValueKey(dashPanelTableCellColumnLabel(td), filter.kind, filter.valueType);
            if (!selected[colValue]) return false;
        } else if (filter.tableTarget === 'value') {
            n = dashGetFloat(td.textContent.trim());
            if (isNaN(n)) return false;
            from = String(filter.from || '').trim();
            to = String(filter.to || '').trim();
            if (from && n < parseFloat(from)) return false;
            if (to && n > parseFloat(to)) return false;
        } else if (filter.tableTarget === 'date') {
            from = String(filter.from || '').trim();
            to = String(filter.to || '').trim();
            cellFrom = dashPanelDateValue(dashCellDateFr(td) || '');
            cellTo = dashPanelDateValue(dashCellDateTo(td) || '') || cellFrom;
            fr = cellFrom || cellTo;
            if (!fr) return false;
            if (from && cellTo < from) return false;
            if (to && cellFrom > to) return false;
        }
    }
    return true;
}

function dashPanelTableRowPassesFilters(row, filters) {
    var rowFilter = filters ? filters['table:row'] : null
        , selected, rowName, cells, hasCellFilters = false;
    if (dashPanelFilterIsActive(rowFilter)) {
        selected = dashPanelFilterSelectedMap(rowFilter);
        rowName = dashPanelFilterValueKey(dashPanelGetRowName(row), rowFilter.kind, rowFilter.valueType);
        if (!selected[rowName]) return false;
    }
    Object.keys(filters || {}).forEach(function(key) {
        var filter = filters[key];
        if (filter && filter.source === 'table' && filter.tableTarget !== 'row' && dashPanelFilterIsActive(filter))
            hasCellFilters = true;
    });
    if (!hasCellFilters) return true;
    cells = Array.from(row.querySelectorAll('td.f-cell'));
    return cells.some(function(td) { return dashPanelTableCellPassesFilters(td, filters); });
}

function dashSetRowHidden(row, key, hidden) {
    if (!row || !row.dataset) return;
    if (hidden) row.dataset[key] = '1';
    else delete row.dataset[key];
    row.style.display = (row.dataset.dashSearchHidden === '1' || row.dataset.dashPanelFilterHidden === '1') ? 'none' : '';
}

function dashApplyPanelTableFilters(panelEl) {
    var filters = dashPanelFiltersFor(panelEl);
    panelEl.querySelectorAll('.f-item').forEach(function(row) {
        dashSetRowHidden(row, 'dashPanelFilterHidden', !dashPanelTableRowPassesFilters(row, filters));
    });
}

function dashUpdatePanelFilterIcon(panelEl) {
    var icon = panelEl ? panelEl.querySelector('.f-panel-filter-icon') : null
        , filters = dashPanelFiltersFor(panelEl)
        , active = Object.keys(filters).some(function(key) { return dashPanelFilterIsActive(filters[key]); });
    if (!icon) return;
    icon.classList.toggle('active', active);
}

function dashRerenderCurrentPanelViz(panelEl) {
    var active = panelEl.querySelector('.f-viz-type-icon.active')
        , vizType = active ? active.dataset.vizType : 'table'
        , modelData = dashModelData[panelEl.id] || {}
        , settings = modelData.settings
        , vizList = settings ? (Array.isArray(settings) ? settings : [settings]) : []
        , vizCfg = vizList.find(function(v) { return v.type === vizType; }) || {};
    dashRenderChart(panelEl, vizType, vizCfg.fieldMap || {}, vizCfg);
}

function dashRecalculatePanelAfterFilter(panelEl) {
    panelEl.querySelectorAll('td.f-cell[data-src="report"]').forEach(function(td) {
        td.textContent = '';
        td.setAttribute('ready', '0');
        td.classList.remove('dash-err');
    });
    panelEl.querySelectorAll('td.f-rg-formula-cell').forEach(function(td) {
        td.textContent = '';
        td.setAttribute('ready', '0');
        td.classList.remove('dash-err');
    });
    dashGetRepVals();
    dashCalcCells();
    dashCalcRGFormulas();
    dashApplyPanelTableFilters(panelEl);
    dashRerenderCurrentPanelViz(panelEl);
    dashUpdatePanelFilterIcon(panelEl);
}

function dashRenderPanelFilterModal(panelEl, fields) {
    var container = document.getElementById('dash-panel-filter-fields')
        , filters = dashPanelFiltersFor(panelEl);
    container.innerHTML = '';
    if (!fields.length) {
        container.innerHTML = '<div class="dash-panel-filter-empty">Нет данных для фильтра</div>';
        return;
    }

    fields.forEach(function(field) {
        var filter = filters[field.key]
            , html = '<div class="dash-panel-filter-field" data-field-key="' + dashAttr(field.key) + '">';
        if (field.kind === 'values' || field.kind === 'month') {
            var options = field.options || []
                , selected = filter && Array.isArray(filter.selected) ? dashPanelFilterSelectedMap(filter) : null
                , selectedCount = selected === null ? options.length : options.filter(function(option) { return selected[String(option.value)]; }).length
                , allChecked = options.length > 0 && selectedCount === options.length;
            html += '<div class="dash-panel-filter-label' + (options.length ? ' dash-panel-filter-label--with-toggle' : '') + '">';
            if (options.length)
                html += '<input type="checkbox" class="dash-panel-filter-select-all dash-panel-filter-bulk-toggle" value="__all" title="Выделить всё / снять выделение" aria-label="Выделить всё / снять выделение"' + (allChecked ? ' checked' : '') + '>';
            html += '<span>' + dashAttr(field.label) + '</span></div>';
            html += '<div class="dash-panel-filter-options">';
            options.forEach(function(option) {
                var checked = selected === null || selected[String(option.value)];
                html += '<label class="dash-panel-filter-option">'
                    + '<input type="checkbox" class="dash-panel-filter-option-input" value="' + dashAttr(option.value) + '"' + (checked ? ' checked' : '') + '>'
                    + '<span>' + dashAttr(option.label) + '</span>'
                    + '</label>';
            });
            html += '</div>';
        } else {
            var inputType = field.valueType === 'date' ? 'date' : (field.valueType === 'number' ? 'number' : 'text');
            html += '<div class="dash-panel-filter-label">' + dashAttr(field.label) + '</div>';
            html += '<div class="dash-panel-filter-range">'
                + '<input type="' + inputType + '" class="dash-panel-filter-from" placeholder="' + dashAttr(field.min || 'От') + '" value="' + dashAttr(filter ? filter.from || '' : '') + '">'
                + '<span>—</span>'
                + '<input type="' + inputType + '" class="dash-panel-filter-to" placeholder="' + dashAttr(field.max || 'До') + '" value="' + dashAttr(filter ? filter.to || '' : '') + '">'
                + '</div>';
        }
        html += '</div>';
        container.insertAdjacentHTML('beforeend', html);
    });
    container.querySelectorAll('.dash-panel-filter-field').forEach(dashSyncPanelFilterBulkControls);
}

function dashReadPanelFilterState(fields) {
    var container = document.getElementById('dash-panel-filter-fields')
        , state = {};
    fields.forEach(function(field) {
        var fieldEl = container.querySelector('[data-field-key="' + CSS.escape(field.key) + '"]')
            , selected = [], from, to;
        if (!fieldEl) return;
        if (field.kind === 'values' || field.kind === 'month') {
            fieldEl.querySelectorAll('.dash-panel-filter-option-input').forEach(function(check) {
                if (check.checked) selected.push(check.value);
            });
            if (selected.length !== (field.options || []).length)
                state[field.key] = Object.assign({}, field, { selected: selected });
        } else {
            from = (fieldEl.querySelector('.dash-panel-filter-from') || {}).value || '';
            to = (fieldEl.querySelector('.dash-panel-filter-to') || {}).value || '';
            if (from || to) state[field.key] = Object.assign({}, field, { from: from, to: to });
        }
    });
    return state;
}

function dashOpenPanelFilter(panelEl) {
    var fields = dashCollectPanelFilterFields(panelEl);
    dashPanelFilterModalCtx = { panelEl: panelEl, fields: fields };
    dashRenderPanelFilterModal(panelEl, fields);
    document.getElementById('dash-panel-filter-modal').classList.add('open');
}

document.getElementById('dash-panel-filter-fields').addEventListener('change', function(e) {
    var target = e.target;
    if (!target || target.type !== 'checkbox') return;
    dashHandlePanelFilterCheckboxChange(target);
});

document.getElementById('dash-panel-filter-cancel').addEventListener('click', function() {
    dashClosePanelFilterModal();
});

document.getElementById('dash-panel-filter-reset').addEventListener('click', function() {
    if (!dashPanelFilterModalCtx) return;
    var panelEl = dashPanelFilterModalCtx.panelEl;
    delete dashPanelFilters[panelEl.id];
    dashClosePanelFilterModal();
    dashRecalculatePanelAfterFilter(panelEl);
});

document.getElementById('dash-panel-filter-apply').addEventListener('click', function() {
    if (!dashPanelFilterModalCtx) return;
    var panelEl = dashPanelFilterModalCtx.panelEl
        , state = dashReadPanelFilterState(dashPanelFilterModalCtx.fields);
    if (Object.keys(state).length) dashPanelFilters[panelEl.id] = state;
    else delete dashPanelFilters[panelEl.id];
    dashClosePanelFilterModal();
    dashRecalculatePanelAfterFilter(panelEl);
});

document.addEventListener('keydown', dashHandlePanelFilterModalKeydown);
document.getElementById('dash-panel-filter-modal').addEventListener('click', dashHandlePanelFilterBackdropClick);

document.addEventListener('click', function(e) {
    var icon = e.target.closest('.f-panel-filter-icon');
    if (!icon) return;
    e.preventDefault();
    e.stopPropagation();
    var panel = icon.closest('.f-panel');
    if (panel) dashOpenPanelFilter(panel);
});

// Event delegation for panel settings icon clicks
document.addEventListener('click', function(e) {
    var icon = e.target.closest('.f-panel-settings-icon');
    if (!icon) return;
    var panel = icon.closest('.f-panel');
    if (panel) dashOpenPanelVizSettings(panel);
});

function dashReset() {
    dashModelData = {}; dashPeriodData = {}; dashPeriods = {}; dashValues = {}; dashValueErrors = {};
    dashFormulas = {}; dashItems = {}; dashReports = {}; dashReportNames = {}; dashReportIds = {}; dashReportHeaders = {}; dashReportKeys = {}; dashReportSources = {}; dashVizReports = {}; dashPanelValues = {}; dashPanelValueErrors = {}; dashPanelFilters = {}; dashAjaxes = 0; dashValueItemIds = {};
    dashQueryNameById = {}; dashQueryIdByName = {}; dashPendingPanelRows = {};
    dashPanelFilterModalCtx = null;
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
window.dashGetVizReportDone       = dashGetVizReportDone;
window.dashGetPanelValuesDone     = dashGetPanelValuesDone;
window.dashDebug                  = dashDebug;
window.dashUpdateTableWrapOverflow = dashUpdateTableWrapOverflow;
window.dashResetSheetSizeCookies  = dashResetSheetSizeCookies;
window.dashToggleSheetTileMode    = dashToggleSheetTileMode;

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
        delete dashPanelValues[p.id];
        delete dashPanelValueErrors[p.id];
        p.remove();
    });
    dashUpdateSheetSizeResetIcon(sheetEl);
    dashPeriodData = {}; dashPeriods = {}; dashValues = {}; dashValueErrors = {}; dashReports = {}; dashReportNames = {}; dashReportIds = {}; dashReportHeaders = {}; dashReportKeys = {}; dashReportSources = {}; dashVizReports = {}; dashAjaxes = 0; dashValueItemIds = {}; dashRgSourceIds = {};

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
        dashSetRowHidden(row, 'dashSearchHidden', !match);
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
    if (sheet) dashInitSheetTileMode(sheet);
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

// Re-check responsive panel constraints on resize.
window.addEventListener('resize', function() {
    dashUpdateTableWrapOverflow();
    dashRefreshPanelMaxWidths();
    dashScheduleVisibleVizRefresh();
});

document.addEventListener('visibilitychange', function() {
    if (!dashDocumentHidden()) dashScheduleVisibleVizRefresh();
});

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

function dashMatrixDashLabel(td) {
    if (!td || !td.dataset) return '';
    if (td.dataset.dashLabel) return td.dataset.dashLabel;
    return td.dataset.matrixLabel || '';
}

function dashMatrixSearchUrl(td) {
    var url = 'object/155551?JSON_OBJ';
    if (dashMatrixUsesDates(td)) {
        var fr = dashMatrixSheetInputValue(td, '.dash-fr-input');
        var to = dashMatrixSheetInputValue(td, '.dash-to-input');
        if (fr) url += '&FR_' + DASH_MATRIX_DATE_FIELD_ID + '=' + encodeURIComponent(fr);
        if (to) url += '&TO_' + DASH_MATRIX_DATE_FIELD_ID + '=' + encodeURIComponent(to);
    }
    url += '&F_' + DASH_MATRIX_LINE_FIELD_ID + '=' + encodeURIComponent(td.dataset.matrixLine || '');
    url += '&F_' + DASH_MATRIX_COL_FIELD_ID + '=' + encodeURIComponent(td.dataset.matrixCol || '');
    var dashLabel = dashMatrixDashLabel(td);
    url += '&F_' + DASH_MATRIX_LABEL_FIELD_ID + '=' + (dashLabel ? '%' : '!%');
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
    var params = 't155551=' + encodeURIComponent(newVal);
    if (dashMatrixUsesDates(td))
        params += '&t' + DASH_MATRIX_DATE_FIELD_ID + '=' + encodeURIComponent(dashTodayYMD());
    params += '&t' + DASH_MATRIX_LINE_FIELD_ID + '=' + encodeURIComponent(td.dataset.matrixLine || '');
    params += '&t' + DASH_MATRIX_COL_FIELD_ID + '=' + encodeURIComponent(td.dataset.matrixCol || '');
    var dashLabel = dashMatrixDashLabel(td);
    if (dashLabel) params += '&t' + DASH_MATRIX_LABEL_FIELD_ID + '=' + encodeURIComponent(dashLabel);
    return params;
}

function dashSaveMatrixExisting(recId, td, newVal) {
    if (newVal === '')
        newApi('POST', '_m_del/' + recId + '?JSON', 'dashMatrixValueSaveDone', '', { td: td, newVal: newVal, recId: recId });
    else
        newApi('POST', '_m_save/' + recId + '?JSON', 'dashMatrixValueSaveDone',
            't155551=' + encodeURIComponent(newVal), { td: td, newVal: newVal, recId: recId });
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

    // Filter results by label matching rules (а/б/в) using the row's dashboard label.
    // The server-side filter is the literal F_155557=% / =!% per the issue spec, which
    // narrows to "any label" / "no label" — we still need the substring rules client-side.
    var dashLabel = dashMatrixDashLabel(td);
    json = json.filter(function(rec) {
        return dashMatrixLabelMatches(dashLabel, dashRecordLabel(rec, '155551', DASH_MATRIX_LABEL_FIELD_ID));
    });

    if (json.length === 0) {
        if (newVal === '') {
            dashSetStatus('');
            td.style.backgroundColor = '';
            return;
        }
        newApi('POST', '_m_new/155551?JSON&up=1', 'dashMatrixValueSaveDone',
            dashMatrixCreateParams(td, newVal), { td: td, newVal: newVal, recId: '' });
    } else if (json.length === 1) {
        dashSaveMatrixExisting(json[0].i, td, newVal);
    } else {
        td.style.backgroundColor = '';
        dashShowMultivalModal(json, dashMatrixListUrl(ctx.searchUrl || dashMatrixSearchUrl(td)), td, newVal, {
            saveCallback: 'dashMatrixValueSaveDone',
            saveParam: 't155551'
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
    ctx.td.textContent = dashFormatNumberText(ctx.newVal);
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
    var valueItemId = (td.dataset && td.dataset.valueItemId) || '';
    var itemRef = dashCellItemRef(td);
    var fr = dashCellDateFr(td);
    var to = dashCellDateTo(td);
    var rgHead = dashCellRgHead(td);
    var dashLabel = (td.dataset && td.dataset.dashLabel) || '';
    var url = 'object/1010?JSON_OBJ';
    if (fr) url += '&FR_1039=' + fr;
    if (to) url += '&TO_1039=' + to;
    // valueItemId is a record id (filter by id with @), itemRef is a name (filter by value)
    if (valueItemId) url += '&FR_1042=@' + encodeURIComponent(valueItemId);
    else url += '&FR_1042=' + encodeURIComponent(itemRef);
    if (rgHead) url += '&F_1104=' + encodeURIComponent(rgHead);
    url += '&F_' + DASH_VALUE_LABEL_FIELD_ID + '=' + (dashLabel ? '%' : '!%');
    return url;
}

// Save or delete a Значение: search first, then create/update/delete
function dashSaveValue(td, newVal, originalVal) {
    var searchUrl = dashValueSearchUrl(td);
    var itemRef = dashCellItemRef(td);
    var fr = dashCellDateFr(td);
    var to = dashCellDateTo(td);
    var rgHead = dashCellRgHead(td);
    var dashLabel = (td.dataset && td.dataset.dashLabel) || '';

    newApi('GET', searchUrl, 'dashValueSearchDone', '', { td: td, newVal: newVal, originalVal: originalVal, itemRef: itemRef, fr: fr, to: to, rgHead: rgHead, dashLabel: dashLabel });
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
    var dashLabel = ctx.dashLabel || '';

    // Filter results by label matching rules (а/б/в) using the row's dashboard label.
    // The server-side filter is the literal F_155556=% / =!% per the issue spec, which
    // narrows to "any label" / "no label" — we still need the substring rules client-side.
    json = (json || []).filter(function(rec) {
        return dashMatrixLabelMatches(dashLabel, dashRecordLabel(rec, '1010', DASH_VALUE_LABEL_FIELD_ID));
    });

    if (json.length === 0) {
        // Delete: nothing to do if value is already empty
        if (newVal === '') { dashSetStatus(''); return; }
        // Create new record
        var valueItemId = ctx.td.dataset.valueItemId;
        var params = 't1010=' + encodeURIComponent(newVal)
            + (valueItemId ? '&t1042=' + encodeURIComponent(valueItemId) : '&NEW_1042=' + encodeURIComponent(itemRef)) // Create the ref in case it does not exist
            + '&t1039=' + encodeURIComponent(fr || dashTodayYMD());
        if (rgHead) params += '&t1104=' + encodeURIComponent(rgHead);
        if (dashLabel) params += '&t' + DASH_VALUE_LABEL_FIELD_ID + '=' + encodeURIComponent(dashLabel);
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
    ctx.td.textContent = dashFormatNumberText(ctx.newVal);
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
        var newVal = input.value.trim()
            , currentNumber = dashNormalizeNumberText(currentVal)
            , newNumber = dashNormalizeNumberText(newVal)
            , changed = currentNumber !== '' && newNumber !== ''
                ? currentNumber !== newNumber
                : newVal !== currentVal;
        restorePadding();
        td.textContent = dashFormatNumberText(newVal);
        if (changed) {
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

    // Panels driven by panelQuery render read-only values (no valueItemID
    // and other edit fields are absent from the query response).
    if (td.closest('.f-panel-readonly')) {
        dashShowReadonlyTip(e);
        return;
    }

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

// ─── Cell multi-selection (sum of selected cells) ────────────────────────────
// Drag inside a table to make a rectangular selection. Ctrl/Cmd+drag adds an
// additional rectangle to the existing selection. Ctrl/Cmd+click toggles a
// single cell. Shift+click extends from the anchor. Triple-click selects the
// whole row. Plain click on a cell preserves existing behaviour (inline edit /
// formula modal / readonly tooltip) and clears any previous selection. The
// floating badge under the selection shows Σ / count / average over numeric
// cells and supports click-to-copy plus Ctrl/Cmd+C TSV copy of everything
// selected.
(function() {
    var DRAG_PIXEL_THRESHOLD = 4;
    var dashModelEl = document.getElementById('dash-model');
    var badge = document.getElementById('dash-selection-sum');
    if (!dashModelEl || !badge) return;

    var sel = {
        cells: new Set(),
        anchor: null,
        dragStart: null,
        dragTbody: null,
        dragOriginX: 0,
        dragOriginY: 0,
        dragArmed: false,
        dragActive: false,
        dragMode: null,           // 'replace' | 'additive'
        dragBase: null,           // snapshot for additive merge
        dragPendingToggle: false, // mouseup applies the Ctrl-click toggle if no drag happened
        suppressNextClick: false
    };

    // Returns true for any cell the user is allowed to drag-select. Header
    // cells (.f-head / .f-subhead th) and the row-label column (.f-first-cell)
    // join the data cells (.f-cell) so a drag from the period header down or
    // from the row name across covers everything, Excel-style (issue #2681).
    function isSelectableCell(node) {
        if (!node || !node.classList) return false;
        if (node.classList.contains('f-cell')) return true;
        if (node.classList.contains('f-first-cell')) return true;
        if (node.tagName === 'TH' && node.closest('.f-panel table')) return true;
        return false;
    }

    // Cells that contribute numbers to the Σ / N / ⌀ badge. Headers and the
    // row-label column are part of the selection (for copy) but not the stats.
    function isStatsCell(node) {
        return !!(node && node.classList && node.classList.contains('f-cell'));
    }

    // Row index inside the cell's table (across thead + tbody), so a rectangle
    // can span a period header at the top down to a data row at the bottom.
    function cellRC(td) {
        var tr = td && td.parentElement;
        if (!tr || tr.tagName !== 'TR') return null;
        var table = tr.closest('table');
        if (!table) return null;
        var allRows = table.querySelectorAll('tr');
        var rowIdx = Array.prototype.indexOf.call(allRows, tr);
        if (rowIdx < 0) return null;
        return {
            row: rowIdx,
            col: Array.prototype.indexOf.call(tr.children, td),
            tbody: table  // keep the field name for back-compat — it now scopes the rectangle to the whole table
        };
    }

    function clearSelection() {
        sel.cells.forEach(function(c) { c.classList.remove('dash-cell-selected'); });
        sel.cells.clear();
        sel.anchor = null;
        updateBadge();
    }

    function addCell(td) {
        if (!sel.cells.has(td)) {
            sel.cells.add(td);
            td.classList.add('dash-cell-selected');
        }
    }

    function removeCell(td) {
        if (sel.cells.has(td)) {
            sel.cells.delete(td);
            td.classList.remove('dash-cell-selected');
        }
    }

    function rectFromCells(a, b) {
        var ra = cellRC(a), rb = cellRC(b);
        if (!ra || !rb || ra.tbody !== rb.tbody) return [];
        var rows = ra.tbody.querySelectorAll('tr');
        var r1 = Math.min(ra.row, rb.row), r2 = Math.max(ra.row, rb.row);
        var c1 = Math.min(ra.col, rb.col), c2 = Math.max(ra.col, rb.col);
        var out = [];
        for (var r = r1; r <= r2; r++) {
            var tr = rows[r];
            if (!tr) continue;
            for (var c = c1; c <= c2; c++) {
                var cell = tr.children[c];
                if (isSelectableCell(cell)) out.push(cell);
            }
        }
        return out;
    }

    function replaceWith(cells) {
        sel.cells.forEach(function(c) { c.classList.remove('dash-cell-selected'); });
        sel.cells.clear();
        cells.forEach(addCell);
        updateBadge();
    }

    function formatAvg(n) {
        var s = n.toFixed(2).replace(/\.?0+$/, '');
        return dashFormatNumberText(s);
    }

    function htmlEscape(s) {
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function stripSpaces(text) {
        // Drop every whitespace char (regular space used as thousands
        // separator, NBSP, narrow NBSP, tabs etc.) — keep digits, decimal
        // comma/period, sign, percent.
        return String(text).replace(/\s+/g, '');
    }

    function pill(text) {
        var display = htmlEscape(text);
        var copy = htmlEscape(stripSpaces(text));
        return '<span class="dash-sel-copy" role="button" tabindex="0" '
            + 'title="Скопировать в буфер" data-copy="' + copy + '">' + display + '</span>';
    }

    function copyToClipboard(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                return navigator.clipboard.writeText(text);
            }
        } catch (e) {}
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
    }

    function flashCopied(el) {
        el.classList.add('dash-sel-copied');
        setTimeout(function() { el.classList.remove('dash-sel-copied'); }, 700);
    }

    function flashSelection() {
        var cells = [];
        sel.cells.forEach(function(c) { cells.push(c); });
        cells.forEach(function(c) { c.classList.add('dash-cell-copied'); });
        setTimeout(function() {
            cells.forEach(function(c) { c.classList.remove('dash-cell-copied'); });
        }, 700);
    }

    // If a stray first click on a triple-click sequence opened the inline
    // editor, route the cell back through its own Esc handler so the original
    // value is restored cleanly before we replace the selection.
    function cancelInlineEdit() {
        var input = dashModelEl.querySelector('.dash-cell-input');
        if (!input) return;
        try {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        } catch (err) {
            // KeyboardEvent ctor not available — just blur, the cell will
            // commit but stay editable through its own logic.
            input.blur();
        }
    }

    function selectRowOf(td) {
        var tr = td && td.closest && td.closest('tr');
        if (!tr) return;
        clearSelection();
        sel.anchor = td;
        for (var i = 0; i < tr.children.length; i++) {
            var child = tr.children[i];
            if (isSelectableCell(child)) addCell(child);
        }
        updateBadge();
    }

    // Text for a single cell in a TSV payload. Strips thousands-separator
    // spaces from numeric data cells so "1 234,56" pastes as a clean number;
    // text cells (row labels, period headers) keep their internal spaces so
    // "Total revenue" doesn't become "Totalrevenue" (issue #2681).
    function tsvCellText(cell) {
        if (!cell) return '';
        if (isStatsCell(cell)) return stripSpaces(dashCellText(cell));
        // The row-label cell hides .show-id (row id + edit link) via CSS,
        // but textContent still picks it up. Use item-name as the canonical
        // row label when available; otherwise fall back to textContent with
        // any .show-id branch stripped.
        if (cell.classList && cell.classList.contains('f-first-cell')) {
            var tr = cell.closest('tr');
            var attr = tr && tr.getAttribute && tr.getAttribute('item-name');
            if (attr) return String(attr).trim();
            var clone = cell.cloneNode(true);
            clone.querySelectorAll('.show-id').forEach(function(el) { el.remove(); });
            return (clone.textContent || '').trim();
        }
        return (cell.textContent != null ? String(cell.textContent) : '').trim();
    }

    function tsvCellColSpan(cell) {
        if (!cell) return 1;
        var raw = typeof cell.colSpan === 'number'
            ? cell.colSpan
            : (cell.getAttribute && cell.getAttribute('colspan'));
        var span = parseInt(raw, 10);
        return span > 1 ? span : 1;
    }

    function appendTsvCell(rowCells, cell) {
        rowCells.push(tsvCellText(cell));
        for (var i = 1, span = tsvCellColSpan(cell); i < span; i++) {
            rowCells.push('');
        }
    }

    // Build a TSV blob from the current selection, walking the DOM in row
    // order. Each `<tr>` that has any selected cell becomes a line; selected
    // cells inside the row are joined with TAB in DOM (column) order. This
    // makes a rectangular range paste as a matching grid in Excel/Google
    // Sheets, while disjoint Ctrl-selections still produce a sensible
    // row-per-line layout.
    function buildSelectionTsv() {
        var trs = dashModelEl.querySelectorAll('tr');
        var rows = [];
        trs.forEach(function(tr) {
            var rowCells = [];
            for (var i = 0; i < tr.children.length; i++) {
                var cell = tr.children[i];
                if (sel.cells.has(cell)) appendTsvCell(rowCells, cell);
            }
            if (rowCells.length > 0) rows.push(rowCells.join('\t'));
        });
        return rows.join('\n');
    }

    // Build a TSV blob for a single panel's table — every <tr> (thead + tbody)
    // joined cell-by-cell. Colspans expand to empty TSV cells after the text
    // cell so grouped period headers stay aligned with subcolumns (issue #2703).
    // Powers the .f-panel-copy-icon click action; runs independently of any
    // active selection (issue #2681).
    function buildTableTsv(table) {
        if (!table) return '';
        var rows = [];
        table.querySelectorAll('tr').forEach(function(tr) {
            var rowCells = [];
            for (var i = 0; i < tr.children.length; i++) {
                appendTsvCell(rowCells, tr.children[i]);
            }
            rows.push(rowCells.join('\t'));
        });
        return rows.join('\n');
    }

    function updateBadge() {
        if (sel.cells.size < 2) {
            badge.classList.remove('visible');
            return;
        }
        var sum = 0, n = 0, rect = null;
        sel.cells.forEach(function(td) {
            if (isStatsCell(td)) {
                var v = dashGetFloat(dashCellText(td));
                if (!isNaN(v)) { sum += v; n++; }
            }
            var r = td.getBoundingClientRect();
            if (!rect) rect = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
            else {
                if (r.left < rect.left) rect.left = r.left;
                if (r.right > rect.right) rect.right = r.right;
                if (r.top < rect.top) rect.top = r.top;
                if (r.bottom > rect.bottom) rect.bottom = r.bottom;
            }
        });
        if (n === 0) {
            badge.classList.remove('visible');
            return;
        }
        var avg = sum / n;
        var sep = '<span class="dash-sel-sep">·</span>';
        badge.innerHTML =
            'Σ ' + pill(dashFormatNumberText(sum)) + sep +
            'N ' + pill(String(n)) + sep +
            '⌀ ' + pill(formatAvg(avg));
        var sy = window.pageYOffset || document.documentElement.scrollTop || 0;
        var sx = window.pageXOffset || document.documentElement.scrollLeft || 0;
        badge.style.top = (rect.bottom + sy + 6) + 'px';
        badge.style.left = (rect.right + sx) + 'px';
        badge.classList.add('visible');
    }

    // Click-to-copy on the badge. The badge lives outside #dash-model, so
    // these clicks don't reach the dashboard's mousedown/click handlers and
    // the selection stays put.
    badge.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    badge.addEventListener('click', function(e) {
        var btn = e.target.closest('.dash-sel-copy');
        if (!btn) return;
        e.stopPropagation();
        var text = btn.getAttribute('data-copy') || btn.textContent;
        copyToClipboard(text);
        flashCopied(btn);
    });
    badge.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var btn = e.target.closest && e.target.closest('.dash-sel-copy');
        if (!btn) return;
        e.preventDefault();
        var text = btn.getAttribute('data-copy') || btn.textContent;
        copyToClipboard(text);
        flashCopied(btn);
    });

    // Ctrl+C / Cmd+C (and the OS «Copy» menu) over an active selection
    // copies a TSV of every selected cell. We listen for the `copy` event so
    // the user's data goes through `clipboardData.setData` directly — no
    // permission prompt, no clipboard API quirks.
    document.addEventListener('copy', function(e) {
        if (sel.cells.size === 0) return;
        var ae = document.activeElement;
        if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName)) return;
        if (ae && ae.isContentEditable) return;
        var text = buildSelectionTsv();
        if (!text) return;
        if (e.clipboardData) {
            e.clipboardData.setData('text/plain', text);
            e.preventDefault();
        } else {
            // Old IE / fallback
            copyToClipboard(text);
        }
        flashSelection();
    });

    dashModelEl.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        // Hover-revealed panel header icons (copy / filter / settings) own
        // their own click handlers and must leave any active selection
        // alone — independent of selected cells per #2681.
        if (e.target.closest('.f-panel-copy-icon, .f-panel-filter-icon, .f-panel-settings-icon')) return;
        // Restrict the closest() search to a panel table — clicks outside
        // .f-panel (sheet tabs, status bar, etc.) must still fall through.
        var hit = e.target.closest('td.f-cell, td.f-first-cell, th');
        var td = (hit && hit.closest('.f-panel table') && isSelectableCell(hit)) ? hit : null;

        // Multi-click handling runs even when the target is inside an inline
        // edit input — that way triple-click still works after a stray first
        // click opened the editor.
        if (td && e.detail >= 2) {
            e.preventDefault();
            sel.suppressNextClick = true;
            if (e.detail === 3) {
                cancelInlineEdit();
                selectRowOf(td);
            }
            return;
        }

        // Don't interfere with inputs (inline edit, formula modal textarea, …)
        if (e.target.closest('input, textarea, select, .dash-cell-input, a, button')) return;

        if (!td) {
            if (sel.cells.size > 0) clearSelection();
            return;
        }
        var rc = cellRC(td);
        if (!rc) return;

        if (e.shiftKey && sel.anchor) {
            var anchorRC = cellRC(sel.anchor);
            if (anchorRC && anchorRC.tbody === rc.tbody) {
                replaceWith(rectFromCells(sel.anchor, td));
            } else {
                clearSelection();
                sel.anchor = td;
                addCell(td);
                updateBadge();
            }
            sel.suppressNextClick = true;
            e.preventDefault();
            return;
        }
        if (e.ctrlKey || e.metaKey) {
            // Defer the toggle until mouseup so Ctrl+drag can grow an additive
            // rectangle from this cell; a plain Ctrl+click without movement
            // still toggles, applied in the mouseup handler below.
            sel.dragStart = td;
            sel.dragTbody = rc.tbody;
            sel.dragOriginX = e.clientX;
            sel.dragOriginY = e.clientY;
            sel.dragArmed = true;
            sel.dragActive = false;
            sel.dragMode = 'additive';
            sel.dragBase = new Set(sel.cells);
            sel.dragPendingToggle = true;
            e.preventDefault();
            return;
        }

        // No modifier: arm a replace-drag without changing the selection yet,
        // so a plain click still falls through to the existing handler.
        sel.dragStart = td;
        sel.dragTbody = rc.tbody;
        sel.dragOriginX = e.clientX;
        sel.dragOriginY = e.clientY;
        sel.dragArmed = true;
        sel.dragActive = false;
        sel.dragMode = 'replace';
        sel.dragBase = null;
        sel.dragPendingToggle = false;
    });

    document.addEventListener('mousemove', function(e) {
        if (!sel.dragArmed) return;
        if (!sel.dragActive) {
            var dx = e.clientX - sel.dragOriginX;
            var dy = e.clientY - sel.dragOriginY;
            if (dx * dx + dy * dy < DRAG_PIXEL_THRESHOLD * DRAG_PIXEL_THRESHOLD) return;
            sel.dragActive = true;
            sel.dragPendingToggle = false;
            if (sel.dragMode === 'replace') clearSelection();
            sel.anchor = sel.dragStart;
            dashModelEl.classList.add('dash-selecting');
        }
        var node = document.elementFromPoint(e.clientX, e.clientY);
        var hit = node && node.closest ? node.closest('td.f-cell, td.f-first-cell, th') : null;
        var td = (hit && hit.closest('.f-panel table') && isSelectableCell(hit)) ? hit : null;
        if (!td) return;
        var rc = cellRC(td);
        if (!rc || rc.tbody !== sel.dragTbody) return;
        e.preventDefault();
        var rect = rectFromCells(sel.dragStart, td);
        if (sel.dragMode === 'additive') {
            var merged = new Set(sel.dragBase);
            rect.forEach(function(c) { merged.add(c); });
            replaceWith(merged);
        } else {
            replaceWith(rect);
        }
    });

    document.addEventListener('mouseup', function() {
        if (!sel.dragArmed) return;
        var wasDrag = sel.dragActive;
        var pendingToggle = sel.dragPendingToggle;
        var dragStart = sel.dragStart;
        sel.dragArmed = false;
        sel.dragActive = false;
        sel.dragMode = null;
        sel.dragBase = null;
        sel.dragPendingToggle = false;
        sel.dragStart = null;
        sel.dragTbody = null;
        dashModelEl.classList.remove('dash-selecting');
        if (wasDrag) {
            sel.suppressNextClick = true;
            return;
        }
        if (pendingToggle && dragStart) {
            // Plain Ctrl/Cmd+click with no drag — apply the deferred toggle now.
            if (sel.cells.has(dragStart)) {
                removeCell(dragStart);
                if (sel.anchor === dragStart) sel.anchor = null;
            } else {
                if (!sel.anchor) sel.anchor = dragStart;
                addCell(dragStart);
            }
            updateBadge();
            sel.suppressNextClick = true;
        }
    });

    // Capture phase: suppress the existing bubble click handler when a
    // modifier-select or drag-select just happened.
    dashModelEl.addEventListener('click', function(e) {
        if (sel.suppressNextClick) {
            sel.suppressNextClick = false;
            e.stopImmediatePropagation();
            e.preventDefault();
            return;
        }
        // Don't drop an active selection when the user clicks one of the
        // hover-revealed panel header icons — they have their own handlers
        // and the copy icon is explicitly selection-independent (#2681).
        if (e.target.closest('.f-panel-copy-icon, .f-panel-filter-icon, .f-panel-settings-icon')) return;
        if (sel.cells.size > 0) clearSelection();
    }, true);

    // Hover-revealed Copy icon in the panel header — TSV-copy of the entire
    // panel table, independent of any selection (issue #2681).
    dashModelEl.addEventListener('click', function(e) {
        var icon = e.target.closest('.f-panel-copy-icon');
        if (!icon) return;
        e.preventDefault();
        e.stopPropagation();
        var panel = icon.closest('.f-panel');
        var table = panel && panel.querySelector('table');
        if (!table) return;
        var text = buildTableTsv(table);
        if (!text) return;
        copyToClipboard(text);
        flashCopied(icon);
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && sel.cells.size > 0) clearSelection();
    });

    // Keep the badge anchored to the selection on scroll / resize.
    window.addEventListener('scroll', function() {
        if (sel.cells.size >= 2) updateBadge();
    }, true);
    window.addEventListener('resize', function() {
        if (sel.cells.size >= 2) updateBadge();
    });
})();

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
