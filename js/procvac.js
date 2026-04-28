(function(window, document) {
    'use strict';

    var TABLE_ID = '8137';
    var DEFAULT_ORDER = '-8152';
    var ARCHIVE_PAGE_SIZE = 25;
    var ACTIVE_STATUSES = ['в работе', 'не начато'];
    var REF_OPTIONS_LIMIT = 200;
    var COLUMN_WIDTH_COOKIE = 'procvac-column-widths';
    var MIN_COLUMN_WIDTH = 48;
    var MAX_REFERENCE_SELECT_SIZE = 10;
    var EVENTS_TABLE_ID = '5616';
    var STATUS_CELL_CLASSES = {
        'в работе': 'procvac-status--in-work',
        'не начато': 'procvac-status--not-started',
        'оффер принят': 'procvac-status--offer-accepted',
        'вышел': 'procvac-status--joined',
        'пауза': 'procvac-status--pause',
        'оффер': 'procvac-status--offer',
    };

    var FIELD_DEFS = [
        { key: 'title', label: 'Вакансия актуальная', names: ['Вакансия актуальная'] },
        { key: 'status', label: 'Статус', names: ['Статус', 'Статус вакансии'] },
        { key: 'department', label: 'Отдел', names: ['Отдел', 'Департамент'] },
        { key: 'plan', label: 'План', names: ['План'] },
        { key: 'fact', label: 'Факт', names: ['Факт'] },
        { key: 'request', label: 'Заявка', names: ['Заявка'], documentLink: true },
        { key: 'responsible', label: 'Ответственный', names: ['Ответственный', 'Пользователь'] },
        { key: 'startDate', label: 'Старт работы', names: ['Старт работы'] },
        { key: 'deadline', label: 'Дедлайн', names: ['Дедлайн'] },
        { key: 'exitDate', label: 'Выход', names: ['Выход'] },
        { key: 'hireType', label: 'Штат/Лагерь/ОШ', names: ['Штат/Лагерь/ОШ', 'Тип найма'] },
        { key: 'weeksInWork', label: 'Недель в работе', derived: true, format: 'NUMBER' },
        { key: 'events', label: 'События', derived: true },
        { key: 'comments', label: 'Комментарии', names: ['Комментарии'] },
    ];

    var DEFAULT_COLUMN_WIDTHS = {
        title: 190,
        status: 124,
        department: 210,
        plan: 84,
        fact: 84,
        weeksInWork: 84,
        events: 70,
        request: 70,
        responsible: 132,
        startDate: 110,
        deadline: 110,
        exitDate: 110,
        hireType: 130,
        comments: 240,
    };

    var state = {
        metadata: null,
        columns: [],
        rows: [],
        search: '',
        archiveOpen: false,
        archivePage: 0,
        editing: null,
        refOptionsCache: {},
        columnWidths: {},
    };

    function normalizeFieldName(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/ё/g, 'е')
            .replace(/[\s_\-\/]+/g, '')
            .replace(/[^\wа-я0-9]/g, '');
    }

    function isWriteGranted(value) {
        return value === 1 || value === true || String(value || '').toUpperCase() === 'WRITE';
    }

    function isMetadataWritable(metadata) {
        return isWriteGranted(metadata && metadata.granted);
    }

    function sourceIsEditable(metadata, source) {
        if (!source) return false;
        if (isMetadataWritable(metadata)) return true;
        return isWriteGranted(source.granted);
    }

    function mapTypeToFormat(typeId) {
        var map = {
            '2': 'HTML',
            '3': 'SHORT',
            '4': 'DATETIME',
            '5': 'GRANT',
            '6': 'PWD',
            '7': 'BUTTON',
            '8': 'CHARS',
            '9': 'DATE',
            '10': 'FILE',
            '11': 'BOOLEAN',
            '12': 'MEMO',
            '13': 'NUMBER',
            '14': 'SIGNED',
            '16': 'REPORT_COLUMN',
            '17': 'CHARS',
        };
        return map[String(typeId)] || 'SHORT';
    }

    function buildFieldSources(metadata) {
        var sources = [];
        if (!metadata) return sources;

        sources.push({
            id: String(metadata.id),
            index: 0,
            name: metadata.val || '',
            type: metadata.type || '3',
            format: mapTypeToFormat(metadata.type || '3'),
            kind: 'main',
            granted: metadata.granted,
            ref_id: metadata.ref_id || null,
            orig: metadata.orig || metadata.id,
        });

        (metadata.reqs || []).forEach(function(req, idx) {
            sources.push({
                id: String(req.id),
                index: idx + 1,
                name: req.val || '',
                type: req.type || '3',
                format: req.ref_id ? 'REF' : mapTypeToFormat(req.type || '3'),
                kind: 'req',
                granted: req.granted,
                ref_id: req.ref_id || null,
                orig: req.orig || null,
                attrs: req.attrs || '',
            });
        });

        return sources;
    }

    function findSourceForField(def, sources) {
        if (def.derived) return null;
        var wanted = (def.names || []).map(normalizeFieldName);
        for (var i = 0; i < sources.length; i++) {
            if (wanted.indexOf(normalizeFieldName(sources[i].name)) !== -1) {
                return sources[i];
            }
        }
        return null;
    }

    function normalizeColumnWidths(widths) {
        var normalized = {};
        if (!widths || typeof widths !== 'object') return normalized;

        FIELD_DEFS.forEach(function(def) {
            if (!Object.prototype.hasOwnProperty.call(widths, def.key)) return;
            var width = Number(widths[def.key]);
            if (!isFinite(width)) return;
            normalized[def.key] = Math.max(MIN_COLUMN_WIDTH, Math.round(width));
        });

        return normalized;
    }

    function getDefaultColumnWidth(key) {
        return DEFAULT_COLUMN_WIDTHS[key] || 100;
    }

    function applyColumnWidths(columns, widths) {
        var normalized = normalizeColumnWidths(widths || {});
        return columns.map(function(column) {
            column.width = normalized[column.key] || getDefaultColumnWidth(column.key);
            return column;
        });
    }

    function buildColumns(metadata) {
        var sources = buildFieldSources(metadata);
        var columns = FIELD_DEFS.map(function(def) {
            var source = findSourceForField(def, sources);
            return {
                key: def.key,
                label: def.label,
                names: def.names || [],
                source: source,
                derived: !!def.derived,
                documentLink: !!def.documentLink,
                editable: !def.derived && !!source && sourceIsEditable(metadata, source),
                format: source ? source.format : (def.format || 'SHORT'),
            };
        });
        return applyColumnWidths(columns, state.columnWidths);
    }

    function getSourceValue(rawRow, source) {
        if (!rawRow || !source || !Array.isArray(rawRow.r)) return '';
        var value = rawRow.r[source.index];
        return value === undefined || value === null ? '' : String(value);
    }

    function parseReferenceValue(value) {
        var text = String(value || '');
        var idx = text.indexOf(':');
        if (idx <= 0) {
            return { id: text, label: text, text: text };
        }
        return {
            id: text.slice(0, idx),
            label: text.slice(idx + 1),
            text: text.slice(idx + 1),
        };
    }

    function abbreviateDepartmentName(value) {
        var text = String(value || '').trim();
        if (!text) return '';
        var parts = text.split(/[\s,.;:()\/\\-]+/);
        var abbreviation = parts.map(function(part) {
            var match = String(part || '').match(/[A-Za-zА-Яа-яЁё]/);
            return match ? match[0].toUpperCase().replace('Ё', 'Е') : '';
        }).join('');
        return abbreviation || text;
    }

    function displayValueForColumn(rawValue, column) {
        if (!column) return '';
        var value = rawValue === undefined || rawValue === null ? '' : String(rawValue);
        if (column.format === 'REF' || (column.source && column.source.ref_id)) {
            value = parseReferenceValue(rawValue).text;
        }
        if (column.key === 'department') {
            return abbreviateDepartmentName(value);
        }
        return value;
    }

    function parseDate(value) {
        var text = String(value || '').trim();
        if (!text) return null;

        var ddmmyyyy = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
        if (ddmmyyyy) {
            return new Date(Number(ddmmyyyy[3]), Number(ddmmyyyy[2]) - 1, Number(ddmmyyyy[1]));
        }

        var yyyymmdd = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (yyyymmdd) {
            return new Date(Number(yyyymmdd[1]), Number(yyyymmdd[2]) - 1, Number(yyyymmdd[3]));
        }

        var parsed = new Date(text);
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    function formatDateForInput(value) {
        var date = parseDate(value);
        if (!date) return '';
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0'),
        ].join('-');
    }

    function formatDateForDisplay(value) {
        if (!value) return '';
        var parts = String(value).split('-');
        if (parts.length === 3) {
            return [parts[2], parts[1], parts[0]].join('.');
        }
        return value;
    }

    function sameMonth(date, now) {
        return !!date && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    }

    function calculateWeeksInWork(startValue, now) {
        var start = parseDate(startValue);
        if (!start) return '';
        var base = now || new Date();
        var startMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        var nowMidnight = new Date(base.getFullYear(), base.getMonth(), base.getDate());
        var days = Math.floor((nowMidnight.getTime() - startMidnight.getTime()) / 86400000);
        if (days < 0) return '0';
        return String(Math.round(days / 7));
    }

    function normalizeRow(rawRow, columns, now) {
        var row = {
            id: rawRow && rawRow.i,
            raw: rawRow,
            values: {},
            rawValues: {},
            fields: {},
        };

        columns.forEach(function(column) {
            if (column.derived) return;
            var rawValue = getSourceValue(rawRow, column.source);
            row.rawValues[column.key] = rawValue;
            row.values[column.key] = displayValueForColumn(rawValue, column);
            row.fields[column.key] = column.source || null;
        });

        row.rawValues.weeksInWork = row.rawValues.startDate || '';
        row.values.weeksInWork = calculateWeeksInWork(row.rawValues.startDate, now || new Date());
        row.rawValues.events = row.id === undefined || row.id === null ? '' : String(row.id);
        row.values.events = row.rawValues.events ? 'События' : '';
        return row;
    }

    function statusText(row) {
        return String((row && row.values && row.values.status) || '').trim().toLowerCase();
    }

    function getStatusClass(value) {
        var key = String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
        return STATUS_CELL_CLASSES[key] || '';
    }

    function getRowSection(row, now) {
        var status = statusText(row);
        if (ACTIVE_STATUSES.indexOf(status) !== -1) {
            return 'active';
        }

        var base = now || new Date();
        var exitDate = parseDate(row.values.exitDate || row.rawValues.exitDate);
        var deadline = parseDate(row.values.deadline || row.rawValues.deadline);
        if (sameMonth(exitDate, base) || (!exitDate && sameMonth(deadline, base))) {
            return 'closedThisMonth';
        }

        return 'archive';
    }

    function groupRows(rows, now) {
        var grouped = {
            active: [],
            closedThisMonth: [],
            archive: [],
        };

        rows.forEach(function(row) {
            grouped[getRowSection(row, now || new Date())].push(row);
        });

        return grouped;
    }

    function searchableText(row) {
        return Object.keys(row.values || {}).map(function(key) {
            return row.values[key];
        }).join(' ').toLowerCase();
    }

    function filterRows(rows, query) {
        var needle = String(query || '').trim().toLowerCase();
        if (!needle) return rows.slice();
        return rows.filter(function(row) {
            return searchableText(row).indexOf(needle) !== -1;
        });
    }

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function escapeHtml(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function highlightText(value, query) {
        var text = String(value === undefined || value === null ? '' : value);
        var needle = String(query || '').trim();
        if (!needle) return escapeHtml(text);

        var lower = text.toLowerCase();
        var lowerNeedle = needle.toLowerCase();
        var parts = [];
        var pos = 0;
        var idx = lower.indexOf(lowerNeedle);

        while (idx !== -1) {
            parts.push(escapeHtml(text.slice(pos, idx)));
            parts.push('<mark>' + escapeHtml(text.slice(idx, idx + needle.length)) + '</mark>');
            pos = idx + needle.length;
            idx = lower.indexOf(lowerNeedle, pos);
        }
        parts.push(escapeHtml(text.slice(pos)));
        return parts.join('');
    }

    function isUrl(value) {
        return /^https?:\/\//i.test(String(value || '').trim());
    }

    function renderDocumentLink(value) {
        var href = String(value || '').trim();
        if (!href) return '';
        if (!isUrl(href)) return escapeHtml(href);
        return '<a class="procvac-doc-link" href="' + escapeHtml(href) + '" target="_blank" rel="noopener" title="' + escapeHtml(href) + '" aria-label="Открыть заявку"><i class="pi pi-file"></i></a>';
    }

    function buildEventsHref(rowId) {
        return getApiBase() + '/table/' + EVENTS_TABLE_ID + '?F_U=' + encodeURIComponent(rowId);
    }

    function renderEventsLink(rowId) {
        if (rowId === undefined || rowId === null || rowId === '') return '';
        var href = buildEventsHref(rowId);
        return '<a class="procvac-events-link" href="' + escapeHtml(href) + '" target="_blank" rel="noopener" title="Посмотреть события" aria-label="Посмотреть события"><i class="pi pi-calendar"></i></a>';
    }

    function getApiBase() {
        var dbName = window.db || '';
        if (!dbName && window.location && window.location.pathname) {
            dbName = window.location.pathname.split('/').filter(Boolean)[0] || '';
        }
        return dbName ? '/' + dbName : '';
    }

    function getXsrf() {
        return typeof window.xsrf !== 'undefined' ? window.xsrf : (typeof xsrf !== 'undefined' ? xsrf : '');
    }

    function getCookie(name) {
        if (!document || typeof document.cookie !== 'string') return '';
        var escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
        if (!match) return '';
        try {
            return decodeURIComponent(match[1]);
        } catch (error) {
            return match[1];
        }
    }

    function setCookie(name, value, days) {
        if (!document) return;
        var expires = '';
        if (days) {
            var date = new Date();
            date.setTime(date.getTime() + days * 86400000);
            expires = '; expires=' + date.toUTCString();
        }
        document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/';
    }

    function loadColumnWidths() {
        var raw = getCookie(COLUMN_WIDTH_COOKIE);
        if (!raw) return {};

        try {
            return normalizeColumnWidths(JSON.parse(raw));
        } catch (error) {
            console.warn('procvac column width cookie error:', error);
            return {};
        }
    }

    function saveColumnWidths() {
        setCookie(COLUMN_WIDTH_COOKIE, JSON.stringify(normalizeColumnWidths(state.columnWidths)), 365);
    }

    function updateColumnWidth(key, width) {
        var widths = {};
        widths[key] = width;
        var normalized = normalizeColumnWidths(widths);
        var nextWidth = normalized[key] || getDefaultColumnWidth(key);
        state.columnWidths[key] = nextWidth;

        var column = findColumnByKey(key);
        if (column) column.width = nextWidth;

        return nextWidth;
    }

    function fetchJson(url, options) {
        return fetch(url, options).then(function(response) {
            return response.text().then(function(text) {
                var data = null;
                if (text) {
                    try {
                        data = JSON.parse(text);
                    } catch (err) {
                        throw new Error('Невалидный JSON: ' + text.slice(0, 240));
                    }
                }
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
                var serverError = getServerError(data);
                if (serverError) {
                    throw new Error(serverError);
                }
                return data;
            });
        });
    }

    function getServerError(value) {
        if (!value || typeof value !== 'object') return '';
        if (value.error) return String(value.error);
        if (value.err) return String(value.err);
        if (Array.isArray(value)) {
            for (var i = 0; i < value.length; i++) {
                var nested = getServerError(value[i]);
                if (nested) return nested;
            }
        } else {
            var keys = Object.keys(value);
            for (var j = 0; j < keys.length; j++) {
                var child = value[keys[j]];
                if (child && typeof child === 'object') {
                    var childError = getServerError(child);
                    if (childError) return childError;
                }
            }
        }
        return '';
    }

    function loadReferenceOptions(source) {
        if (!source || !source.id || !source.ref_id) {
            return Promise.resolve([]);
        }
        var cacheKey = String(source.id);
        if (state.refOptionsCache[cacheKey]) {
            return Promise.resolve(state.refOptionsCache[cacheKey]);
        }

        var url = getApiBase() + '/_ref_reqs/' + encodeURIComponent(source.id) + '?JSON&LIMIT=' + REF_OPTIONS_LIMIT;
        return fetchJson(url).then(function(data) {
            var entries = [];
            if (Array.isArray(data)) {
                data.forEach(function(item) {
                    if (Array.isArray(item)) {
                        entries.push({ id: String(item[0]), text: String(item[1] || '') });
                    } else if (item && typeof item === 'object') {
                        var id = item.id || item.i || item.value;
                        var text = item.text || item.val || item.name || (item.r && item.r[0]);
                        if (id !== undefined) entries.push({ id: String(id), text: String(text || id) });
                    }
                });
            } else if (data && typeof data === 'object') {
                Object.keys(data).forEach(function(id) {
                    entries.push({ id: String(id), text: String(data[id]) });
                });
            }
            state.refOptionsCache[cacheKey] = entries;
            return entries;
        });
    }

    function getColumnWidth(column) {
        if (!column) return 100;
        return column.width || state.columnWidths[column.key] || getDefaultColumnWidth(column.key);
    }

    function getColumnWidthStyle(column) {
        return ' style="width: ' + getColumnWidth(column) + 'px;"';
    }

    function renderColumn(column) {
        return '<col class="procvac-col procvac-col--' + escapeHtml(column.key) + '" data-col-key="' + escapeHtml(column.key) + '"' + getColumnWidthStyle(column) + '>';
    }

    function renderHeaderCell(column) {
        return [
            '<th class="procvac-head-cell procvac-head-cell--' + escapeHtml(column.key) + '" data-col-key="' + escapeHtml(column.key) + '"' + getColumnWidthStyle(column) + '>',
            '<span class="procvac-head-label">' + escapeHtml(column.label) + '</span>',
            '<span class="procvac-col-resize-handle" data-col-key="' + escapeHtml(column.key) + '" title="Изменить ширину"></span>',
            '</th>',
        ].join('');
    }

    function getCellAlignmentClass(column) {
        var format = String(column && column.format || '').toUpperCase();
        if (format === 'NUMBER' || format === 'SIGNED') return 'procvac-cell--numeric';
        if (format === 'DATE' || format === 'DATETIME') return 'procvac-cell--date';
        return '';
    }

    function renderCell(row, column, sectionKey) {
        var value = row.values[column.key] || '';
        var rawValue = row.rawValues[column.key] || '';
        var classes = ['procvac-cell', 'procvac-cell--' + column.key];
        var alignmentClass = getCellAlignmentClass(column);
        var statusClass = column.key === 'status' ? getStatusClass(value) : '';
        var editable = column.editable;
        if (alignmentClass) classes.push(alignmentClass);
        if (statusClass) classes.push(statusClass);
        if (editable) classes.push('procvac-cell--editable');
        if (!value) classes.push('procvac-cell--empty');

        var html = '';
        if (column.key === 'events') {
            html = renderEventsLink(row.id);
        } else if (column.documentLink && isUrl(rawValue)) {
            html = renderDocumentLink(rawValue);
        } else {
            html = highlightText(value, state.search);
        }

        return '<td class="' + classes.join(' ') + '" data-row-id="' + escapeHtml(row.id) + '" data-col-key="' + escapeHtml(column.key) + '" data-section="' + escapeHtml(sectionKey) + '">' + html + '</td>';
    }

    function renderDataRow(row, sectionKey) {
        var cells = state.columns.map(function(column) {
            return renderCell(row, column, sectionKey);
        }).join('');
        return '<tr class="procvac-data-row" data-row-id="' + escapeHtml(row.id) + '" data-section="' + escapeHtml(sectionKey) + '">' + cells + '</tr>';
    }

    function renderSectionHeader(key, title, rows) {
        var button = '';
        if (key === 'archive') {
            var icon = state.archiveOpen ? 'pi-chevron-up' : 'pi-chevron-down';
            var label = state.archiveOpen ? 'Свернуть' : 'Развернуть';
            button = '<button type="button" class="procvac-section-toggle" id="procvac-archive-toggle" title="' + label + '"><i class="pi ' + icon + '"></i><span>' + label + '</span></button>';
        }

        return [
            '<tr class="procvac-section-gap"><td colspan="' + state.columns.length + '"></td></tr>',
            '<tr class="procvac-section-row procvac-section-row--' + key + '">',
            '<th colspan="' + state.columns.length + '">',
            '<div class="procvac-section-head">',
            '<span class="procvac-section-title">' + escapeHtml(title) + '</span>',
            '<span class="procvac-section-count">' + rows.length + '</span>',
            button,
            '</div>',
            '</th>',
            '</tr>',
        ].join('');
    }

    function renderEmptySection(key, message) {
        return '<tr class="procvac-empty-row" data-section="' + escapeHtml(key) + '"><td colspan="' + state.columns.length + '">' + escapeHtml(message) + '</td></tr>';
    }

    function renderArchivePager(rows) {
        if (!state.archiveOpen || rows.length <= ARCHIVE_PAGE_SIZE) return '';
        var pageCount = Math.ceil(rows.length / ARCHIVE_PAGE_SIZE);
        var current = Math.min(state.archivePage, pageCount - 1);
        state.archivePage = current;
        return [
            '<tr class="procvac-pager-row">',
            '<td colspan="' + state.columns.length + '">',
            '<div class="procvac-pager">',
            '<button type="button" class="procvac-pager-btn" data-page-delta="-1"' + (current <= 0 ? ' disabled' : '') + ' title="Предыдущая страница"><i class="pi pi-chevron-left"></i></button>',
            '<span>' + (current + 1) + ' / ' + pageCount + '</span>',
            '<button type="button" class="procvac-pager-btn" data-page-delta="1"' + (current >= pageCount - 1 ? ' disabled' : '') + ' title="Следующая страница"><i class="pi pi-chevron-right"></i></button>',
            '</div>',
            '</td>',
            '</tr>',
        ].join('');
    }

    function renderSection(key, title, rows) {
        var html = renderSectionHeader(key, title, rows);
        if (key === 'archive' && !state.archiveOpen) {
            return html;
        }

        if (!rows.length) {
            return html + renderEmptySection(key, 'Нет записей');
        }

        var visibleRows = rows;
        if (key === 'archive') {
            var start = state.archivePage * ARCHIVE_PAGE_SIZE;
            visibleRows = rows.slice(start, start + ARCHIVE_PAGE_SIZE);
        }

        html += visibleRows.map(function(row) {
            return renderDataRow(row, key);
        }).join('');

        if (key === 'archive') {
            html += renderArchivePager(rows);
        }
        return html;
    }

    function render() {
        var grid = document.getElementById('procvac-grid');
        if (!grid) return;

        if (!state.columns.length) {
            grid.innerHTML = '<div class="procvac-loading"><span class="procvac-spinner"></span>Загрузка...</div>';
            return;
        }

        var filtered = filterRows(state.rows, state.search);
        var grouped = groupRows(filtered, new Date());
        var colgroup = state.columns.map(function(column) {
            return renderColumn(column);
        }).join('');
        var header = state.columns.map(function(column) {
            return renderHeaderCell(column);
        }).join('');
        var body = [
            renderSection('active', 'Актуальные вакансии', grouped.active),
            renderSection('closedThisMonth', 'Закрыто в этом месяце', grouped.closedThisMonth),
            renderSection('archive', 'Архив', grouped.archive),
        ].join('');

        grid.innerHTML = [
            '<table class="procvac-table">',
            '<colgroup>' + colgroup + '</colgroup>',
            '<thead><tr>' + header + '</tr></thead>',
            '<tbody>' + body + '</tbody>',
            '</table>',
        ].join('');
    }

    function loadData() {
        var apiBase = getApiBase();
        var metadataUrl = apiBase + '/metadata/' + TABLE_ID + '?JSON';
        var dataUrl = apiBase + '/object/' + TABLE_ID + '/?JSON_OBJ&LIMIT=10000&ORDER=' + encodeURIComponent(DEFAULT_ORDER);

        render();

        return Promise.all([fetchJson(metadataUrl), fetchJson(dataUrl)])
            .then(function(results) {
                var metadata = Array.isArray(results[0]) ? results[0][0] : results[0];
                var dataRows = Array.isArray(results[1]) ? results[1] : [];
                state.metadata = metadata || {};
                state.columns = buildColumns(state.metadata);
                state.rows = dataRows.map(function(row) {
                    return normalizeRow(row, state.columns, new Date());
                });
                state.archivePage = 0;
                render();
            })
            .catch(function(error) {
                console.error('procvac load error:', error);
                var grid = document.getElementById('procvac-grid');
                if (grid) {
                    grid.innerHTML = '<div class="procvac-error"><i class="pi pi-exclamation-triangle"></i><span>' + escapeHtml(error.message || error) + '</span></div>';
                }
            });
    }

    function findRowById(rowId) {
        for (var i = 0; i < state.rows.length; i++) {
            if (String(state.rows[i].id) === String(rowId)) return state.rows[i];
        }
        return null;
    }

    function findColumnByKey(key) {
        for (var i = 0; i < state.columns.length; i++) {
            if (state.columns[i].key === key) return state.columns[i];
        }
        return null;
    }

    function clearEditing() {
        state.editing = null;
    }

    function cancelEditing() {
        if (state.editing && state.editing.cell) {
            state.editing.cell.innerHTML = state.editing.originalHtml;
        }
        clearEditing();
    }

    function editorValue(editor, column) {
        if (!editor) return '';
        if (column.format === 'DATE') return formatDateForDisplay(editor.value);
        return editor.value;
    }

    function editorDisplayText(editor, column) {
        if (!editor) return '';
        if (column.format === 'DATE') return formatDateForDisplay(editor.value);
        if (column.format === 'REF' || (column.source && column.source.ref_id)) {
            var selected = editor.options && editor.selectedIndex >= 0 ? editor.options[editor.selectedIndex] : null;
            return selected ? selected.textContent : '';
        }
        return editor.value;
    }

    function getReferenceSelectSize(optionCount) {
        return Math.min(MAX_REFERENCE_SELECT_SIZE, Math.max(2, Number(optionCount) || 0));
    }

    function buildEditor(column, row, options) {
        var currentRaw = row.rawValues[column.key] || '';
        var currentDisplay = row.values[column.key] || '';
        var format = column.format;

        if (format === 'REF' || (column.source && column.source.ref_id)) {
            var currentRef = parseReferenceValue(currentRaw);
            var select = document.createElement('select');
            select.className = 'procvac-editor procvac-editor--select';
            var emptyOption = document.createElement('option');
            emptyOption.value = '';
            emptyOption.textContent = '';
            select.appendChild(emptyOption);
            (options || []).forEach(function(option) {
                var opt = document.createElement('option');
                opt.value = option.id;
                opt.textContent = option.text;
                if (String(option.id) === String(currentRef.id)) {
                    opt.selected = true;
                }
                select.appendChild(opt);
            });
            var hasCurrentOption = false;
            Array.prototype.forEach.call(select.options, function(option) {
                if (String(option.value) === String(currentRef.id)) hasCurrentOption = true;
            });
            if (currentRef.id && !hasCurrentOption) {
                var currentOption = document.createElement('option');
                currentOption.value = currentRef.id;
                currentOption.textContent = currentDisplay || currentRef.id;
                currentOption.selected = true;
                select.appendChild(currentOption);
            }
            select.size = getReferenceSelectSize(select.options.length);
            return select;
        }

        if (format === 'DATE') {
            var dateInput = document.createElement('input');
            dateInput.className = 'procvac-editor';
            dateInput.type = 'date';
            dateInput.value = formatDateForInput(currentRaw || currentDisplay);
            return dateInput;
        }

        if (format === 'NUMBER' || format === 'SIGNED') {
            var numberInput = document.createElement('input');
            numberInput.className = 'procvac-editor';
            numberInput.type = 'number';
            if (format === 'SIGNED') numberInput.step = 'any';
            numberInput.value = currentRaw || currentDisplay;
            return numberInput;
        }

        if (format === 'MEMO' || column.key === 'comments') {
            var textarea = document.createElement('textarea');
            textarea.className = 'procvac-editor procvac-editor--textarea';
            textarea.value = currentRaw || currentDisplay;
            return textarea;
        }

        var input = document.createElement('input');
        input.className = 'procvac-editor';
        input.type = 'text';
        input.value = currentRaw || currentDisplay;
        return input;
    }

    function startCellEdit(cell) {
        if (!cell || cell.classList.contains('procvac-cell--editing')) return;

        var row = findRowById(cell.dataset.rowId);
        var column = findColumnByKey(cell.dataset.colKey);
        if (!row || !column || !column.editable || !column.source) return;

        if (state.editing) cancelEditing();

        cell.classList.add('procvac-cell--editing');
        var originalHtml = cell.innerHTML;
        cell.innerHTML = '<span class="procvac-cell-loading"></span>';

        var optionsPromise = (column.format === 'REF' || (column.source && column.source.ref_id))
            ? loadReferenceOptions(column.source).catch(function(error) {
                console.warn('procvac reference options error:', error);
                return [];
            })
            : Promise.resolve([]);

        optionsPromise.then(function(options) {
            if (!cell.isConnected) return;
            var editor = buildEditor(column, row, options);
            cell.innerHTML = '';
            cell.appendChild(editor);

            state.editing = {
                cell: cell,
                row: row,
                column: column,
                editor: editor,
                originalHtml: originalHtml,
                originalRaw: row.rawValues[column.key] || '',
            };

            editor.focus();
            if (editor.select && editor.tagName !== 'SELECT') editor.select();

            var finished = false;
            function finish(save) {
                if (finished) return;
                finished = true;
                cell.classList.remove('procvac-cell--editing');
                if (save) {
                    saveEditing(editorValue(editor, column), editorDisplayText(editor, column));
                } else {
                    cancelEditing();
                }
            }

            editor.addEventListener('keydown', function(event) {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    finish(false);
                } else if (event.key === 'Enter' && editor.tagName !== 'TEXTAREA') {
                    event.preventDefault();
                    finish(true);
                }
            });

            editor.addEventListener('blur', function() {
                setTimeout(function() {
                    if (state.editing && state.editing.editor === editor) {
                        finish(true);
                    }
                }, 80);
            });

            if (editor.tagName === 'SELECT') {
                editor.addEventListener('change', function() {
                    finish(true);
                });
            }
        });
    }

    function saveEditing(newValue, displayText) {
        var editing = state.editing;
        if (!editing) return;
        clearEditing();

        var row = editing.row;
        var column = editing.column;
        var source = column.source;
        var rawValue = String(newValue === undefined || newValue === null ? '' : newValue);
        var originalComparable = String(editing.originalRaw || '');
        if (column.format === 'REF' || (column.source && column.source.ref_id)) {
            originalComparable = parseReferenceValue(originalComparable).id;
        }

        if (rawValue === originalComparable) {
            render();
            return;
        }

        var params = new URLSearchParams();
        var token = getXsrf();
        if (token) params.append('_xsrf', token);
        params.append('t' + source.id, rawValue);

        var url = getApiBase() + (source.kind === 'main' ? '/_m_save/' : '/_m_set/') + encodeURIComponent(row.id) + '?JSON';

        fetchJson(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        }).then(function() {
            updateLocalRow(row, column, rawValue, displayText);
            render();
        }).catch(function(error) {
            console.error('procvac save error:', error);
            render();
        });
    }

    function updateLocalRow(row, column, rawValue, displayText) {
        var storedRaw = rawValue;
        if (column.format === 'REF' || (column.source && column.source.ref_id)) {
            storedRaw = rawValue ? rawValue + ':' + (displayText || rawValue) : '';
        }

        row.rawValues[column.key] = storedRaw;
        row.values[column.key] = displayValueForColumn(storedRaw, column);
        if (row.raw && Array.isArray(row.raw.r) && column.source) {
            row.raw.r[column.source.index] = storedRaw;
        }
        row.values.weeksInWork = calculateWeeksInWork(row.rawValues.startDate, new Date());
        row.rawValues.weeksInWork = row.rawValues.startDate || '';
    }

    function findElementByColumnKey(root, tagName, key) {
        var elements = root ? root.getElementsByTagName(tagName) : [];
        for (var i = 0; i < elements.length; i++) {
            if (elements[i].dataset && elements[i].dataset.colKey === key) {
                return elements[i];
            }
        }
        return null;
    }

    function startColumnResize(handle, event) {
        if (!handle || !event) return;
        event.preventDefault();
        event.stopPropagation();

        var key = handle.dataset.colKey;
        if (!key) return;

        var grid = document.getElementById('procvac-grid');
        var header = handle.closest ? handle.closest('.procvac-head-cell') : handle.parentNode;
        var col = findElementByColumnKey(grid, 'col', key);
        var startX = event.clientX;
        var startWidth = header && header.getBoundingClientRect
            ? header.getBoundingClientRect().width
            : getColumnWidth(findColumnByKey(key));

        if (document.body) {
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        }

        function applyWidth(width) {
            var nextWidth = updateColumnWidth(key, width);
            if (header) header.style.width = nextWidth + 'px';
            if (col) col.style.width = nextWidth + 'px';
        }

        function onMouseMove(moveEvent) {
            applyWidth(startWidth + moveEvent.clientX - startX);
        }

        function onMouseUp() {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (document.body) {
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
            saveColumnWidths();
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    function configureShellLayout(root) {
        if (!root) return;
        var appContent = root.closest ? root.closest('.app-content') : document.querySelector('.app-content');
        if (appContent) {
            appContent.style.overflowY = 'hidden';
        }
    }

    function attachEvents() {
        var search = document.getElementById('procvac-search');
        if (search) {
            search.addEventListener('input', function() {
                state.search = search.value || '';
                state.archivePage = 0;
                render();
            });
        }

        var grid = document.getElementById('procvac-grid');
        if (grid) {
            grid.addEventListener('mousedown', function(event) {
                var resizeHandle = event.target.closest('.procvac-col-resize-handle');
                if (resizeHandle) startColumnResize(resizeHandle, event);
            });

            grid.addEventListener('click', function(event) {
                if (event.target.closest('.procvac-col-resize-handle')) return;

                var archiveToggle = event.target.closest('#procvac-archive-toggle');
                var archiveHeader = event.target.closest('.procvac-section-row--archive');
                if (archiveToggle || archiveHeader) {
                    state.archiveOpen = !state.archiveOpen;
                    state.archivePage = 0;
                    render();
                    return;
                }

                var pager = event.target.closest('.procvac-pager-btn');
                if (pager && !pager.disabled) {
                    state.archivePage += Number(pager.dataset.pageDelta || 0);
                    if (state.archivePage < 0) state.archivePage = 0;
                    render();
                    return;
                }

                if (event.target.closest('a, button, input, select, textarea')) return;
                var cell = event.target.closest('.procvac-cell--editable');
                if (cell) startCellEdit(cell);
            });
        }
    }

    function init() {
        var root = document.getElementById('procvac-app');
        if (!root) return;
        state.columnWidths = loadColumnWidths();
        configureShellLayout(root);
        attachEvents();
        loadData();
    }

    window.ProcVacTesting = {
        DEFAULT_COLUMN_WIDTHS: DEFAULT_COLUMN_WIDTHS,
        MIN_COLUMN_WIDTH: MIN_COLUMN_WIDTH,
        buildColumns: buildColumns,
        normalizeRow: normalizeRow,
        groupRows: groupRows,
        filterRows: filterRows,
        highlightText: highlightText,
        renderDocumentLink: renderDocumentLink,
        normalizeColumnWidths: normalizeColumnWidths,
        applyColumnWidths: applyColumnWidths,
        renderColumn: renderColumn,
        renderHeaderCell: renderHeaderCell,
        renderCell: renderCell,
        getReferenceSelectSize: getReferenceSelectSize,
        parseDate: parseDate,
        calculateWeeksInWork: calculateWeeksInWork,
        getRowSection: getRowSection,
        escapeRegExp: escapeRegExp,
    };

    window.ProcVac = {
        init: init,
        reload: loadData,
    };

    if (document && document.addEventListener) {
        document.addEventListener('DOMContentLoaded', init);
    }
})(window, document);
