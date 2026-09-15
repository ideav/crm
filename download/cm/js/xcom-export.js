(function(window, document) {
    'use strict';

    var state = { root: null, db: '', report: 'matching_export', columns: [], rows: [], loading: false };

    function trimValue(value) {
        return String(value == null ? '' : value).trim();
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function normalizeResponse(json) {
        var columns = [];
        var rows = [];
        var i;
        if (Array.isArray(json)) {
            json.forEach(function(row) {
                if (!row || typeof row !== 'object' || Array.isArray(row)) return;
                Object.keys(row).forEach(function(key) {
                    if (columns.indexOf(key) < 0) columns.push(key);
                });
            });
            rows = json.map(function(row) {
                var object = {};
                columns.forEach(function(column) { object[column] = row && row[column] != null ? row[column] : ''; });
                return object;
            });
            return { columns: columns, rows: rows };
        }
        if (json && Array.isArray(json.columns) && Array.isArray(json.data)) {
            columns = json.columns.map(function(column, index) { return trimValue(column.name || column.val || column.id || ('Колонка ' + (index + 1))); });
            var count = 0;
            json.data.forEach(function(columnData) { if (Array.isArray(columnData)) count = Math.max(count, columnData.length); });
            for (i = 0; i < count; i++) {
                var object = {};
                columns.forEach(function(column, columnIndex) {
                    object[column] = Array.isArray(json.data[columnIndex]) && json.data[columnIndex][i] != null ? json.data[columnIndex][i] : '';
                });
                rows.push(object);
            }
        }
        return { columns: columns, rows: rows };
    }

    function buildApiUrl(db, report, limit) {
        return '/' + encodeURIComponent(db) + '/report/' + encodeURIComponent(report) + '?JSON_KV&LIMIT=0,' + (limit || 5000);
    }

    function pad(number) {
        return number < 10 ? '0' + number : String(number);
    }

    function exportFileName(date, extension) {
        var d = date || new Date();
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' +
            pad(d.getHours()) + '-' + pad(d.getMinutes()) + '_сопоставление.' + extension;
    }

    function buildJsonPayload(rows, columns, meta) {
        return {
            format: 'integram-xcom-matching',
            version: 1,
            exported_at: (meta && meta.exported_at) || new Date().toISOString(),
            database: meta && meta.database || '',
            report: meta && meta.report || '',
            count: (rows || []).length,
            columns: (columns || []).slice(),
            rows: (rows || []).map(function(row) {
                var copy = {};
                (columns || []).forEach(function(column) { copy[column] = row[column] == null ? '' : row[column]; });
                return copy;
            })
        };
    }

    function setStatus(text, kind) {
        var el = document.getElementById('xcom-export-status');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'xcom-export-status' + (kind === 'error' ? ' is-error' : '');
    }

    function updateButtons() {
        var disabled = state.loading || !state.rows.length;
        ['xcom-export-json', 'xcom-export-excel'].forEach(function(id) {
            var button = document.getElementById(id);
            if (button) button.disabled = disabled;
        });
        var refresh = document.getElementById('xcom-export-refresh');
        if (refresh) refresh.disabled = state.loading;
    }

    function renderTable() {
        var el = document.getElementById('xcom-export-table');
        if (!el) return;
        if (!state.rows.length) {
            el.innerHTML = '<div class="xcom-export-empty">В отчёте пока нет сопоставленных строк. Выполните массовый подбор и обновите выгрузку.</div>';
            return;
        }
        var visible = state.rows.slice(0, 200);
        el.innerHTML = '<table class="xcom-export-table"><thead><tr>' + state.columns.map(function(column) {
            return '<th>' + escapeHtml(column) + '</th>';
        }).join('') + '</tr></thead><tbody>' + visible.map(function(row) {
            return '<tr>' + state.columns.map(function(column) { return '<td>' + escapeHtml(row[column]) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table>';
    }

    function fetchJson(url) {
        return fetch(url, { credentials: 'same-origin' }).then(function(response) {
            return response.text().then(function(text) {
                if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + text.slice(0, 180));
                try { return JSON.parse(text); } catch (error) { throw new Error('Сервер вернул ответ не в формате JSON'); }
            });
        });
    }

    function load() {
        if (state.loading) return;
        state.loading = true;
        updateButtons();
        setStatus('Загрузка результата…');
        fetchJson(buildApiUrl(state.db, state.report, 5000)).then(function(json) {
            var normalized = normalizeResponse(json);
            state.columns = normalized.columns;
            state.rows = normalized.rows;
            renderTable();
            setStatus(state.rows.length ? 'Готово: ' + state.rows.length + ' строк.' : 'Данных для выгрузки пока нет.');
        }).catch(function(error) {
            state.columns = [];
            state.rows = [];
            renderTable();
            setStatus(error.message || 'Не удалось загрузить результат.', 'error');
        }).then(function() {
            state.loading = false;
            updateButtons();
        });
    }

    function downloadJson() {
        if (!state.rows.length) return;
        var payload = buildJsonPayload(state.rows, state.columns, { database: state.db, report: state.report });
        var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = exportFileName(new Date(), 'json');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function downloadExcel() {
        if (!state.rows.length) return;
        if (!window.XLSX) { setStatus('Библиотека Excel не загрузилась. Обновите страницу.', 'error'); return; }
        var sheet = window.XLSX.utils.json_to_sheet(state.rows, { header: state.columns });
        var workbook = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(workbook, sheet, 'Сопоставление');
        window.XLSX.writeFile(workbook, exportFileName(new Date(), 'xlsx'));
    }

    function init() {
        state.root = document.getElementById('xcom-export-app');
        if (!state.root) return;
        state.db = state.root.getAttribute('data-db') || window.db || '';
        state.report = state.root.getAttribute('data-report') || 'matching_export';
        var apiUrl = buildApiUrl(state.db, state.report, 5000);
        var api = document.getElementById('xcom-export-api-url');
        if (api) api.textContent = window.location.origin + apiUrl;
        document.getElementById('xcom-export-refresh').addEventListener('click', load);
        document.getElementById('xcom-export-json').addEventListener('click', downloadJson);
        document.getElementById('xcom-export-excel').addEventListener('click', downloadExcel);
        load();
    }

    var api = {
        normalizeResponse: normalizeResponse,
        buildApiUrl: buildApiUrl,
        exportFileName: exportFileName,
        buildJsonPayload: buildJsonPayload,
        _state: state,
        init: init
    };
    window.XcomExportWorkspace = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : {});
