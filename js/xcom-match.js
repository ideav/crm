(function(window, document) {
    'use strict';

    var DEFAULT_SKU_TABLE = '2032189';
    var DEFAULT_MATCH_REPORT = 'Сопоставление';
    var DEFAULT_LIMIT = 20;

    var state = {
        root: null,
        db: '',
        skuTable: DEFAULT_SKU_TABLE,
        matchReport: DEFAULT_MATCH_REPORT,
        tableRef: DEFAULT_SKU_TABLE,
        columns: [],
        searchFields: [],
        values: {},
        rows: [],
        searchRequestId: 0,
        reportRequestId: 0
    };

    function trimValue(value) {
        return String(value == null ? '' : value).trim();
    }

    function encodePathSegment(value) {
        return encodeURIComponent(String(value == null ? '' : value));
    }

    function isNumericRef(value) {
        return /^\d+$/.test(trimValue(value));
    }

    function normalizeLookupName(value) {
        return trimValue(value).toLowerCase();
    }

    function normalizeReportFilterKey(name) {
        return trimValue(name).replace(/\s+/g, '_');
    }

    function buildMetadataUrl(options) {
        var dbName = options.db || state.db;
        var table = options.table || state.skuTable || DEFAULT_SKU_TABLE;

        if (isNumericRef(table)) {
            return '/' + encodePathSegment(dbName) + '/metadata/' + encodePathSegment(table);
        }

        return '/' + encodePathSegment(dbName) + '/metadata?JSON';
    }

    function resolveSkuMetadata(payload, table) {
        var lookup = normalizeLookupName(table || DEFAULT_SKU_TABLE);

        if (Array.isArray(payload)) {
            var found = null;
            payload.some(function(item) {
                var names = [
                    item && item.id,
                    item && item.val,
                    item && item.name,
                    item && item.value
                ];
                found = names.some(function(name) {
                    return normalizeLookupName(name) === lookup;
                }) ? item : null;
                return !!found;
            });
            return found;
        }

        return payload && typeof payload === 'object' ? payload : null;
    }

    function parseAttrs(attrs) {
        var result = {};
        if (!attrs) return result;

        if (typeof attrs === 'object') return attrs;

        var text = String(attrs);
        try {
            var parsed = JSON.parse(text);
            if (parsed && typeof parsed === 'object') return parsed;
        } catch (error) {}

        text.split(/[;\n]/).forEach(function(part) {
            var pos = part.indexOf('=');
            if (pos <= 0) return;
            var key = trimValue(part.slice(0, pos));
            var value = trimValue(part.slice(pos + 1));
            if (key) result[key] = value;
        });

        return result;
    }

    function buildSkuColumns(metadata) {
        var columns = [];
        var mainName = metadata && (metadata.val || metadata.name || metadata.value) || 'SKU';

        if (metadata && metadata.id) {
            columns.push({
                id: String(metadata.id),
                name: mainName,
                type: metadata.type || 'SHORT'
            });
        }

        if (metadata && Array.isArray(metadata.reqs)) {
            metadata.reqs.forEach(function(req) {
                var attrs = parseAttrs(req.attrs);
                columns.push({
                    id: String(req.id),
                    name: attrs.alias || req.val || req.name || String(req.id),
                    type: req.type || 'SHORT'
                });
            });
        }

        return columns;
    }

    function buildSkuSearchUrl(options) {
        var dbName = options.db || state.db;
        var table = options.table || state.tableRef || DEFAULT_SKU_TABLE;
        var fields = options.fields || state.searchFields;
        var values = options.values || state.values;
        var limit = options.limit || DEFAULT_LIMIT;
        var params = new URLSearchParams();

        params.set('JSON_OBJ', '');
        params.set('LIMIT', '0,' + limit);

        fields.forEach(function(field) {
            var value = trimValue(values[field.id]);
            if (!value) return;
            params.set('FR_' + field.id, '%' + value + '%');
        });

        return '/' + encodePathSegment(dbName) + '/object/' + encodePathSegment(table) + '/?' + params.toString();
    }

    function buildMatchReportUrl(options) {
        var dbName = options.db || state.db;
        var report = options.report || state.matchReport || DEFAULT_MATCH_REPORT;
        var fields = options.fields || state.searchFields;
        var values = options.values || state.values;
        var selectedRow = options.selectedRow || null;
        var params = new URLSearchParams();

        params.set('JSON', '');
        params.set('LIMIT', '0,' + (options.limit || DEFAULT_LIMIT));

        fields.forEach(function(field) {
            var value = trimValue(values[field.id]);
            var key = normalizeReportFilterKey(field.name || field.id);
            if (!value || !key) return;
            params.set('FR_' + key, value);
        });

        if (selectedRow) {
            // if (selectedRow.id) params.set('sku_id', selectedRow.id);
            if (selectedRow.values && selectedRow.values.length) {
                params.set('FR_SKU', trimValue(selectedRow.values[0]));
            }
            fields.forEach(function(field, fieldIndex) {
                var parsed = parseRefValue(selectedRow.values[fieldIndex]);
                if (!parsed.refId) return;
                var key = normalizeReportFilterKey(field.name || field.id);
                if (key) params.set('FR_' + key + 'ID', parsed.refId);
            });
        }

        return '/' + encodePathSegment(dbName) + '/report/' + encodePathSegment(report) + '?' + params.toString();
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function normalizeRows(json) {
        if (!Array.isArray(json)) return [];

        return json.map(function(item) {
            return {
                id: String(item && item.i != null ? item.i : ''),
                values: item && Array.isArray(item.r) ? item.r : []
            };
        });
    }

    function normalizeReportResponse(json) {
        var columns = [];
        var rows = [];
        var i;
        var rowIndex;

        if (json && Array.isArray(json.columns)) {
            columns = json.columns.map(function(column, index) {
                return {
                    id: String(column.id != null ? column.id : index),
                    name: column.name || column.val || column.id || ('Колонка ' + (index + 1))
                };
            });
        }

        if (json && Array.isArray(json.data)) {
            var rowCount = 0;
            json.data.forEach(function(columnData) {
                if (Array.isArray(columnData)) rowCount = Math.max(rowCount, columnData.length);
            });
            for (rowIndex = 0; rowIndex < rowCount; rowIndex++) {
                rows.push(json.data.map(function(columnData) {
                    return Array.isArray(columnData) ? columnData[rowIndex] : '';
                }));
            }
            return { columns: columns, rows: rows };
        }

        if (json && Array.isArray(json.rows)) {
            if (!columns.length && json.rows.length && typeof json.rows[0] === 'object' && !Array.isArray(json.rows[0])) {
                Object.keys(json.rows[0]).forEach(function(key) {
                    columns.push({ id: key, name: key });
                });
            }
            rows = json.rows.map(function(row) {
                if (Array.isArray(row)) return row;
                return columns.map(function(column) {
                    return row[column.id];
                });
            });
            return { columns: columns, rows: rows };
        }

        if (Array.isArray(json)) {
            json.forEach(function(row) {
                if (!row || typeof row !== 'object' || Array.isArray(row)) return;
                Object.keys(row).forEach(function(key) {
                    for (i = 0; i < columns.length; i++) {
                        if (columns[i].id === key) return;
                    }
                    columns.push({ id: key, name: key });
                });
            });
            rows = json.map(function(row) {
                return columns.map(function(column) {
                    return row && row[column.id] != null ? row[column.id] : '';
                });
            });
        }

        return { columns: columns, rows: rows };
    }

    function fetchJson(url) {
        return fetch(url, { credentials: 'same-origin' }).then(function(response) {
            return response.text().then(function(text) {
                var json;
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status + ': ' + text.slice(0, 180));
                }
                try {
                    json = JSON.parse(text);
                } catch (error) {
                    throw new Error('Сервер вернул ответ не в формате JSON');
                }
                return json;
            });
        });
    }

    function setSummary(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function renderMessage(containerId, className, iconClass, text) {
        var container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '<div class="' + className + '">' +
            (iconClass ? '<i class="pi ' + iconClass + '"></i>' : '') +
            '<span>' + escapeHtml(text) + '</span></div>';
    }

    function renderLoading(containerId, text) {
        var container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = '<div class="xcom-match-loading"><span class="xcom-match-spinner"></span><span>' + escapeHtml(text) + '</span></div>';
        }
    }

    function renderError(containerId, text) {
        renderMessage(containerId, 'xcom-match-error', 'pi-exclamation-triangle', text);
    }

    function renderSearchFields() {
        var container = document.getElementById('xcom-match-fields');
        if (!container) return;

        if (!state.searchFields.length) {
            container.innerHTML = '<div class="xcom-match-empty">В таблице sku не найдены поля для поиска.</div>';
            return;
        }

        container.innerHTML = state.searchFields.map(function(field) {
            return '<div class="xcom-match-field">' +
                '<label for="xcom-match-field-' + escapeHtml(field.id) + '">' + escapeHtml(field.name) + '</label>' +
                '<input id="xcom-match-field-' + escapeHtml(field.id) + '" data-field-id="' + escapeHtml(field.id) + '" type="search" autocomplete="off">' +
                '</div>';
        }).join('');
    }

    function readValues() {
        var values = {};
        var inputs = state.root ? state.root.querySelectorAll('[data-field-id]') : [];
        inputs.forEach(function(input) {
            values[input.getAttribute('data-field-id')] = trimValue(input.value);
        });
        return values;
    }

    function restoreValues() {
        var inputs = state.root ? state.root.querySelectorAll('[data-field-id]') : [];
        inputs.forEach(function(input) {
            var fieldId = input.getAttribute('data-field-id');
            input.value = state.values[fieldId] || '';
        });
    }

    function renderSkuRows() {
        var container = document.getElementById('xcom-match-sku-results');
        if (!container) return;

        if (!state.rows.length) {
            renderMessage('xcom-match-sku-results', 'xcom-match-empty', '', 'По заданным полям SKU не найдены.');
            setSummary('xcom-match-sku-summary', '0 записей');
            return;
        }

        var headers = state.searchFields.map(function(field) {
            return '<th>' + escapeHtml(field.name) + '</th>';
        }).join('');

        var body = state.rows.map(function(row, index) {
            var cells = state.searchFields.map(function(field, fieldIndex) {
                return '<td>' + escapeHtml(row.values[fieldIndex]) + '</td>';
            }).join('');

            return '<tr data-row-index="' + index + '">' + cells +
                '<td class="xcom-match-action-col">' +
                '<button class="xcom-match-btn xcom-match-btn-primary xcom-match-btn-select" type="button" data-row-index="' + index + '" title="Подобрать">' +
                '<i class="pi pi-check"></i><span>Подобрать</span></button>' +
                '</td></tr>';
        }).join('');

        container.innerHTML = '<table class="xcom-match-table">' +
            '<thead><tr>' + headers + '<th class="xcom-match-action-col">Действие</th></tr></thead>' +
            '<tbody>' + body + '</tbody></table>';
        setSummary('xcom-match-sku-summary', state.rows.length + ' из ' + DEFAULT_LIMIT);
    }

    function renderReport(report, selectedRow) {
        var container = document.getElementById('xcom-match-report-results');
        if (!container) return;

        if (!report.columns.length || !report.rows.length) {
            renderMessage('xcom-match-report-results', 'xcom-match-empty', '', 'Запрос «' + state.matchReport + '» не вернул строки.');
            setSummary('xcom-match-report-summary', selectedRow && selectedRow.values.length ? trimValue(selectedRow.values[0]) : 'Нет строк');
            return;
        }

        var headers = report.columns.map(function(column) {
            return '<th>' + escapeHtml(column.name) + '</th>';
        }).join('');
        var body = report.rows.map(function(row) {
            return '<tr>' + report.columns.map(function(column, index) {
                return '<td>' + escapeHtml(row[index]) + '</td>';
            }).join('') + '</tr>';
        }).join('');

        container.innerHTML = '<table class="xcom-match-table">' +
            '<thead><tr>' + headers + '</tr></thead>' +
            '<tbody>' + body + '</tbody></table>';

        setSummary(
            'xcom-match-report-summary',
            (selectedRow && selectedRow.values.length ? trimValue(selectedRow.values[0]) + ': ' : '') + report.rows.length + ' строк'
        );
    }

    function setSearchBusy(isBusy) {
        var form = document.getElementById('xcom-match-search-form');
        if (!form) return;
        form.querySelectorAll('button').forEach(function(button) {
            button.disabled = isBusy;
        });
    }

    function runSearch() {
        var requestId = ++state.searchRequestId;
        state.values = readValues();
        setSearchBusy(true);
        renderLoading('xcom-match-sku-results', 'Поиск SKU...');
        setSummary('xcom-match-sku-summary', 'Загрузка...');

        fetchJson(buildSkuSearchUrl({
            db: state.db,
            table: state.tableRef,
            fields: state.searchFields,
            values: state.values,
            limit: DEFAULT_LIMIT
        })).then(function(json) {
            if (requestId !== state.searchRequestId) return;
            state.rows = normalizeRows(json).slice(0, DEFAULT_LIMIT);
            renderSkuRows();
        }).catch(function(error) {
            if (requestId !== state.searchRequestId) return;
            renderError('xcom-match-sku-results', error.message || 'Не удалось загрузить SKU.');
            setSummary('xcom-match-sku-summary', 'Ошибка');
        }).finally(function() {
            if (requestId === state.searchRequestId) setSearchBusy(false);
        });
    }

    function runMatch(row) {
        var requestId = ++state.reportRequestId;
        renderLoading('xcom-match-report-results', 'Выполняется запрос «' + state.matchReport + '»...');
        setSummary('xcom-match-report-summary', row && row.values.length ? trimValue(row.values[0]) : 'Загрузка...');

        fetchJson(buildMatchReportUrl({
            db: state.db,
            report: state.matchReport,
            fields: state.searchFields,
            values: state.values,
            selectedRow: row,
            limit: DEFAULT_LIMIT
        })).then(function(json) {
            if (requestId !== state.reportRequestId) return;
            renderReport(normalizeReportResponse(json), row);
        }).catch(function(error) {
            if (requestId !== state.reportRequestId) return;
            renderError('xcom-match-report-results', error.message || 'Не удалось выполнить сопоставление.');
            setSummary('xcom-match-report-summary', 'Ошибка');
        });
    }

    function bindEvents() {
        var form = document.getElementById('xcom-match-search-form');
        var reset = document.getElementById('xcom-match-reset');
        var skuResults = document.getElementById('xcom-match-sku-results');

        if (form) {
            form.addEventListener('submit', function(event) {
                event.preventDefault();
                runSearch();
            });
        }

        if (reset) {
            reset.addEventListener('click', function() {
                state.values = {};
                restoreValues();
                runSearch();
            });
        }

        if (skuResults) {
            skuResults.addEventListener('click', function(event) {
                var button = event.target.closest ? event.target.closest('[data-row-index]') : null;
                if (!button) return;
                var index = Number(button.getAttribute('data-row-index'));
                var row = state.rows[index];
                if (!row) return;
                skuResults.querySelectorAll('tr.xcom-match-row-selected').forEach(function(tr) {
                    tr.classList.remove('xcom-match-row-selected');
                });
                var tr = skuResults.querySelector('tr[data-row-index="' + index + '"]');
                if (tr) tr.classList.add('xcom-match-row-selected');
                runMatch(row);
            });
        }
    }

    function loadMetadata() {
        renderLoading('xcom-match-fields', 'Загрузка полей SKU...');
        fetchJson(buildMetadataUrl({
            db: state.db,
            table: state.skuTable
        })).then(function(payload) {
            var metadata = resolveSkuMetadata(payload, state.skuTable);
            if (!metadata) throw new Error('Таблица ' + state.skuTable + ' не найдена в метаданных.');
            state.tableRef = metadata && metadata.id ? metadata.id : state.skuTable;
            state.columns = buildSkuColumns(metadata);
            state.searchFields = state.columns.slice(0, 3);
            renderSearchFields();
            restoreValues();
            runSearch();
        }).catch(function(error) {
            renderError('xcom-match-fields', error.message || 'Не удалось загрузить метаданные sku.');
            renderError('xcom-match-sku-results', 'Поиск SKU недоступен без метаданных таблицы.');
            setSummary('xcom-match-sku-summary', 'Ошибка');
        });
    }

    function init() {
        state.root = document.getElementById('xcom-match-app');
        if (!state.root) return;

        state.db = state.root.getAttribute('data-db') || window.db || '';
        state.skuTable = state.root.getAttribute('data-sku-table') || DEFAULT_SKU_TABLE;
        state.matchReport = state.root.getAttribute('data-match-report') || DEFAULT_MATCH_REPORT;

        bindEvents();
        loadMetadata();
    }

    window.XcomMatchWorkspace = {
        buildMetadataUrl: buildMetadataUrl,
        resolveSkuMetadata: resolveSkuMetadata,
        buildSkuColumns: buildSkuColumns,
        buildSkuSearchUrl: buildSkuSearchUrl,
        buildMatchReportUrl: buildMatchReportUrl,
        normalizeReportFilterKey: normalizeReportFilterKey,
        normalizeRows: normalizeRows,
        normalizeReportResponse: normalizeReportResponse,
        init: init
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
