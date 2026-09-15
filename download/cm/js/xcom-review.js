(function(window, document) {
    'use strict';

    var SETTINGS_TABLE = 'Настройка сопоставления';
    var DECISION_TABLE = 'Решение по паре';
    var defaults = {
        llm: { enabled: false, gray_zone_min: 45, gray_zone_max: 75 },
        decision_log: { enabled: true, table_name: DECISION_TABLE }
    };
    var state = {
        db: '',
        config: defaults,
        decisionDescriptor: null,
        decisions: [],
        selectedRow: null,
        report: null,
        busy: false
    };

    function trimValue(value) { return String(value == null ? '' : value).trim(); }
    function normalize(value) { return trimValue(value).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' '); }
    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }
    function encodePath(value) { return encodeURIComponent(String(value == null ? '' : value)); }

    function parseRef(value) {
        var text = trimValue(value);
        var match = text.match(/^(\d+):(.*)$/);
        return match ? { id: match[1], label: trimValue(match[2]) } : { id: '', label: text };
    }

    function findColumnIndex(report, patterns) {
        var result = -1;
        (report && report.columns || []).some(function(column, index) {
            var name = trimValue(column && column.name);
            if (patterns.some(function(pattern) { return pattern.test(name); })) { result = index; return true; }
            return false;
        });
        return result;
    }

    function candidateFromRow(report, row, index) {
        var idIndex = findColumnIndex(report, [/^skuid$/i, /^sku[ _]?id$/i, /id sku/i]);
        var articleIndex = findColumnIndex(report, [/^артикул$/i, /артикул sku/i, /article/i]);
        var labelIndex = findColumnIndex(report, [/наименование sku/i, /^sku$/i, /название sku/i]);
        var accuracyIndex = findColumnIndex(report, [/точност/i, /accuracy/i, /score/i]);
        var ref = parseRef(idIndex >= 0 ? row[idIndex] : '');
        return {
            index: index,
            id: ref.id || trimValue(idIndex >= 0 ? row[idIndex] : ''),
            article: trimValue(articleIndex >= 0 ? row[articleIndex] : ''),
            label: trimValue(labelIndex >= 0 ? row[labelIndex] : '') || ref.label,
            accuracy: accuracyIndex >= 0 ? Number(String(row[accuracyIndex]).replace(',', '.')) : null,
            values: row.slice ? row.slice() : row
        };
    }

    function rowsInGrayZone(report, min, max) {
        var result = [];
        (report && report.rows || []).forEach(function(row, index) {
            var candidate = candidateFromRow(report, row, index);
            if (candidate.accuracy != null && isFinite(candidate.accuracy) && candidate.accuracy >= min && candidate.accuracy <= max) {
                result.push(candidate);
            }
        });
        return result;
    }

    function buildRefinementPrompt(selectedRow, report, min, max) {
        var candidates = rowsInGrayZone(report, min, max);
        var rfp = selectedRow && selectedRow.values || [];
        var payload = candidates.map(function(candidate) {
            var object = { selected_index: candidate.index, sku_id: candidate.id, article: candidate.article, name: candidate.label, accuracy: candidate.accuracy };
            (report.columns || []).forEach(function(column, index) { object[column.name] = candidate.values[index]; });
            return object;
        });
        return 'Ты проверяешь шорт-лист сопоставления товарных каталогов. ' +
            'Выбери только точное соответствие позиции RFP или верни null. Не придумывай товары. ' +
            'Ответь строго JSON: {"selected_index": число|null, "confidence": 0..1, "reason": "кратко"}.\n' +
            'RFP: ' + JSON.stringify(rfp) + '\nКандидаты: ' + JSON.stringify(payload);
    }

    function parseAgentVerdict(content) {
        var text = trimValue(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        var parsed;
        try { parsed = JSON.parse(text); } catch (error) {
            var objectMatch = text.match(/\{[\s\S]*\}/);
            if (objectMatch) {
                try { parsed = JSON.parse(objectMatch[0]); } catch (ignored) {}
            }
        }
        if (!parsed || typeof parsed !== 'object') return { selected_index: null, confidence: 0, reason: text || 'ИИ не вернул структурированный вердикт' };
        var selected = parsed.selected_index;
        if (selected !== null && selected !== undefined && !Number.isInteger(Number(selected))) selected = null;
        return {
            selected_index: selected === null || selected === undefined ? null : Number(selected),
            confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
            reason: trimValue(parsed.reason)
        };
    }

    function descriptor(table) {
        var fields = {};
        fields[normalize(table.val || table.name)] = { id: String(table.id), index: 0, name: table.val || table.name };
        (table.reqs || []).forEach(function(req, index) {
            var name = req.val || req.name || '';
            var alias = '';
            if (typeof req.attrs === 'string') {
                var match = req.attrs.match(/alias\s*=\s*([^;]+)/i);
                alias = match ? trimValue(match[1]) : '';
            }
            fields[normalize(alias || name)] = { id: String(req.id), index: index + 1, name: alias || name };
        });
        return { tableId: String(table.id), table: table, fields: fields };
    }

    function field(desc, name) { return desc && desc.fields[normalize(name)] || null; }

    function rowValue(row, desc, name) {
        var info = field(desc, name);
        return info && row && row.r ? row.r[info.index] : '';
    }

    function fetchJson(url) {
        return fetch(url, { credentials: 'same-origin' }).then(function(response) {
            return response.text().then(function(text) {
                if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + text.slice(0, 180));
                try { return JSON.parse(text); } catch (error) { throw new Error('Сервер вернул не JSON'); }
            });
        });
    }

    function post(url, params) {
        return fetch(url, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: '_xsrf=' + encodeURIComponent(window.xsrf || '') + '&' + params
        }).then(function(response) {
            return response.text().then(function(text) {
                if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + text.slice(0, 180));
                try { return JSON.parse(text); } catch (error) { return {}; }
            });
        });
    }

    function loadEnvironment() {
        return fetchJson('/' + encodePath(state.db) + '/metadata').then(function(payload) {
            var tables = Array.isArray(payload) ? payload : [payload];
            var settings = tables.filter(function(table) { return normalize(table && (table.val || table.name)) === normalize(SETTINGS_TABLE); })[0];
            var decisionName = state.config.decision_log && state.config.decision_log.table_name || DECISION_TABLE;
            var decisions = tables.filter(function(table) { return normalize(table && (table.val || table.name)) === normalize(decisionName); })[0];
            var jobs = [];
            if (settings) {
                jobs.push(fetchJson('/' + encodePath(state.db) + '/object/' + encodePath(settings.id) + '/?JSON_OBJ&LIMIT=0,30').then(function(rows) {
                    (Array.isArray(rows) ? rows : []).some(function(row) {
                        if (normalize(row && row.r && row.r[0]) !== 'config') return false;
                        try {
                            var config = JSON.parse(row.r[1] || '{}');
                            state.config = Object.assign({}, defaults, config, {
                                llm: Object.assign({}, defaults.llm, config.llm || {}),
                                decision_log: Object.assign({}, defaults.decision_log, config.decision_log || {})
                            });
                        } catch (error) { setReviewStatus('Конфиг не JSON, ИИ выключен.', 'error'); }
                        return true;
                    });
                }));
            }
            if (decisions) {
                state.decisionDescriptor = descriptor(decisions);
                jobs.push(loadDecisions());
            }
            return Promise.all(jobs);
        }).catch(function(error) {
            setReviewStatus('Настройки проверки недоступны: ' + (error.message || error), 'error');
        }).then(updateReviewControls);
    }

    function loadDecisions() {
        if (!state.decisionDescriptor) return Promise.resolve([]);
        return fetchJson('/' + encodePath(state.db) + '/object/' + encodePath(state.decisionDescriptor.tableId) + '/?JSON_OBJ&LIMIT=0,10000').then(function(rows) {
            state.decisions = Array.isArray(rows) ? rows : [];
            renderHistory();
            return state.decisions;
        });
    }

    function renderActionCell(index) {
        return '<td><div class="xcom-match-decision-actions">' +
            '<button class="xcom-match-decision" data-decision="accept" data-row-index="' + index + '" type="button">Принять</button>' +
            '<button class="xcom-match-decision" data-decision="reject" data-row-index="' + index + '" type="button">Отклонить</button>' +
            '</div></td>';
    }

    function setReviewStatus(text, kind) {
        var el = document.getElementById('xcom-match-review-status');
        if (!el) return;
        el.textContent = text || '';
        el.style.color = kind === 'error' ? 'var(--danger, #b91c1c)' : '';
    }

    function decisionObject(row) {
        var desc = state.decisionDescriptor;
        return {
            recordId: row && row.i != null ? String(row.i) : '',
            pair: trimValue(row && row.r && row.r[0]),
            rfpId: trimValue(rowValue(row, desc, 'RFP ID')),
            skuId: trimValue(rowValue(row, desc, 'SKU ID')),
            decision: trimValue(rowValue(row, desc, 'Решение')),
            date: trimValue(rowValue(row, desc, 'Дата')),
            user: trimValue(rowValue(row, desc, 'Кто')),
            rfpName: trimValue(rowValue(row, desc, 'Наименование RFP')),
            skuName: trimValue(rowValue(row, desc, 'Наименование SKU')),
            article: trimValue(rowValue(row, desc, 'Артикул SKU')),
            accuracy: trimValue(rowValue(row, desc, 'Точность')),
            source: trimValue(rowValue(row, desc, 'Источник'))
        };
    }

    function decisionParams(value) {
        var desc = state.decisionDescriptor;
        var fields = {
            'RFP ID': value.rfpId, 'SKU ID': value.skuId, 'Решение': value.decision,
            'Дата': value.date, 'Кто': value.user, 'Наименование RFP': value.rfpName,
            'Наименование SKU': value.skuName, 'Артикул SKU': value.article,
            'Точность': value.accuracy == null ? '' : value.accuracy, 'Источник': value.source
        };
        var params = [];
        Object.keys(fields).forEach(function(name) {
            var info = field(desc, name);
            if (info && trimValue(fields[name]) !== '') params.push('t' + encodeURIComponent(info.id) + '=' + encodeURIComponent(fields[name]));
        });
        return params.join('&');
    }

    function saveDecision(value) {
        if (!state.decisionDescriptor) return Promise.reject(new Error('Таблица «Решение по паре» не установлена.'));
        var pair = value.rfpId + ':' + (value.skuId || value.article);
        var existing = state.decisions.map(decisionObject).filter(function(item) { return item.pair === pair; })[0];
        var params = decisionParams(value);
        if (existing) {
            return post('/' + encodePath(state.db) + '/_m_set/' + encodePath(existing.recordId) + '?JSON=1', params).then(loadDecisions);
        }
        return post('/' + encodePath(state.db) + '/_m_new/' + encodePath(state.decisionDescriptor.tableId) + '?JSON=1',
            'up=1&t' + encodeURIComponent(state.decisionDescriptor.tableId) + '=' + encodeURIComponent(pair) + (params ? '&' + params : '')).then(loadDecisions);
    }

    function writeRfpFields(candidate, llmText) {
        var match = window.XcomMatchWorkspace && window.XcomMatchWorkspace._state;
        if (!match || !match.selectedRow) return Promise.resolve(false);
        var values = [];
        (match.columns || []).forEach(function(column) {
            var name = normalize(column.name);
            if (candidate && name === normalize('Наш артикул')) {
                values.push('t' + encodeURIComponent(column.id) + '=' + encodeURIComponent(candidate.article || candidate.id));
            }
            if (candidate && candidate.accuracy != null && name === normalize('Точность подбора')) {
                values.push('t' + encodeURIComponent(column.id) + '=' + encodeURIComponent(candidate.accuracy));
            }
            if (llmText && name === normalize('ИИ-вердикт')) {
                values.push('t' + encodeURIComponent(column.id) + '=' + encodeURIComponent(llmText));
            }
        });
        if (!values.length) return Promise.resolve(false);
        return post('/' + encodePath(state.db) + '/_m_set/' + encodePath(match.selectedRow.id) + '?JSON=1', values.join('&')).then(function() { return true; });
    }

    function makeDecisionValue(candidate, decision, source) {
        return {
            rfpId: trimValue(state.selectedRow && state.selectedRow.id),
            skuId: candidate.id,
            decision: decision,
            date: new Date().toISOString(),
            user: trimValue(window.user),
            rfpName: trimValue(state.selectedRow && state.selectedRow.values && state.selectedRow.values[0]),
            skuName: candidate.label,
            article: candidate.article,
            accuracy: candidate.accuracy,
            source: source || 'manual'
        };
    }

    function handleDecision(event) {
        var button = event.target.closest ? event.target.closest('[data-decision][data-row-index]') : null;
        if (!button || state.busy || !state.report) return;
        var candidate = candidateFromRow(state.report, state.report.rows[Number(button.getAttribute('data-row-index'))], Number(button.getAttribute('data-row-index')));
        var decision = button.getAttribute('data-decision') === 'accept' ? 'Принято' : 'Отклонено';
        state.busy = true;
        setReviewStatus('Сохраняю решение…');
        var write = decision === 'Принято' ? writeRfpFields(candidate, '') : Promise.resolve();
        write.then(function() { return saveDecision(makeDecisionValue(candidate, decision, 'manual')); }).then(function() {
            setReviewStatus(decision + ': ' + (candidate.article || candidate.label) + '.');
        }).catch(function(error) {
            setReviewStatus(error.message || 'Не удалось сохранить решение.', 'error');
        }).then(function() { state.busy = false; updateReviewControls(); });
    }

    function renderHistory() {
        var el = document.getElementById('xcom-match-history-list');
        if (!el || !state.selectedRow) return;
        var rfpId = trimValue(state.selectedRow.id);
        var items = state.decisions.map(decisionObject).filter(function(item) { return item.rfpId === rfpId; })
            .sort(function(a, b) { return String(b.date).localeCompare(String(a.date)); });
        if (!items.length) { el.textContent = 'Решений пока нет.'; return; }
        el.innerHTML = '<ul class="xcom-match-history-list">' + items.map(function(item) {
            return '<li><b>' + escapeHtml(item.decision) + '</b> ' + escapeHtml(item.article || item.skuName || item.skuId) +
                ' <span>' + escapeHtml(item.user || 'неизвестно') + ', ' + escapeHtml(item.date) + '</span></li>';
        }).join('') + '</ul>';
    }

    function extractAgentContent(data) {
        if (!data) return '';
        if (typeof data === 'string') return data;
        if (typeof data.content === 'string') return data.content;
        if (data.result && typeof data.result.content === 'string') return data.result.content;
        if (data.job && typeof data.job.content === 'string') return data.job.content;
        return '';
    }

    function jobIdOf(data) {
        if (!data) return '';
        if (typeof data.job === 'string' || typeof data.job === 'number') return String(data.job);
        if (data.job && (data.job.id || data.job.job_id)) return String(data.job.id || data.job.job_id);
        return trimValue(data.job_id || data.id);
    }

    function pollAgent(jobId, attempt) {
        if (attempt > 35) return Promise.reject(new Error('ИИ не завершил задачу вовремя. Результат останется в истории агента.'));
        return fetchJson('/' + encodePath(state.db) + '/ai/agent?JSON=1&job=' + encodeURIComponent(jobId)).then(function(data) {
            var content = extractAgentContent(data);
            var status = normalize(data && (data.status || data.job && data.job.status));
            if (content && (!status || status === 'done' || status === 'completed')) return content;
            if (status === 'error' || status === 'failed') throw new Error(trimValue(data.error || data.message) || 'ИИ вернул ошибку');
            return new Promise(function(resolve) { setTimeout(resolve, 1800); }).then(function() { return pollAgent(jobId, attempt + 1); });
        });
    }

    function submitAgent(prompt) {
        var form = new FormData();
        form.append('_xsrf', window.xsrf || '');
        form.append('message', prompt);
        return fetch('/' + encodePath(state.db) + '/ai/agent?JSON=1', {
            method: 'POST', credentials: 'same-origin', body: form, headers: { 'X-Requested-With': 'XMLHttpRequest' }
        }).then(function(response) {
            return response.json().catch(function() { return null; }).then(function(data) {
                if (!response.ok) throw new Error(trimValue(data && (data.message || data.error)) || ('HTTP ' + response.status));
                return data;
            });
        }).then(function(data) {
            var content = extractAgentContent(data);
            if (content) return content;
            var jobId = jobIdOf(data);
            if (!jobId) throw new Error('ИИ-слой не вернул id задачи.');
            return pollAgent(jobId, 0);
        });
    }

    function refine() {
        if (state.busy || !state.report || !state.selectedRow) return;
        var llm = state.config.llm || defaults.llm;
        if (!llm.enabled) { setReviewStatus('ИИ-доуточнение выключено в настройках.'); return; }
        var candidates = rowsInGrayZone(state.report, llm.gray_zone_min, llm.gray_zone_max);
        if (!candidates.length) { setReviewStatus('В заданной серой зоне нет кандидатов.'); return; }
        state.busy = true;
        updateReviewControls();
        setReviewStatus('ИИ проверяет ' + candidates.length + ' кандидатов…');
        submitAgent(buildRefinementPrompt(state.selectedRow, state.report, llm.gray_zone_min, llm.gray_zone_max)).then(function(content) {
            var verdict = parseAgentVerdict(content);
            var candidate = verdict.selected_index == null ? null : candidateFromRow(state.report, state.report.rows[verdict.selected_index], verdict.selected_index);
            var text = candidate
                ? 'Рекомендуется ' + (candidate.article || candidate.label) + ', уверенность ' + Math.round(verdict.confidence * 100) + '%. ' + verdict.reason
                : 'Точного соответствия не найдено. ' + verdict.reason;
            return writeRfpFields(null, text).then(function() {
                if (!candidate || !state.decisionDescriptor) return;
                return saveDecision(makeDecisionValue(candidate, 'ИИ-рекомендация', 'llm'));
            }).then(function() { setReviewStatus(text); });
        }).catch(function(error) {
            setReviewStatus('ИИ недоступен: ' + (error.message || error) + '. Ручная проверка продолжает работать.', 'error');
        }).then(function() { state.busy = false; updateReviewControls(); });
    }

    function updateReviewControls() {
        var button = document.getElementById('xcom-match-llm-refine');
        if (!button) return;
        var llm = state.config.llm || defaults.llm;
        var count = state.report ? rowsInGrayZone(state.report, llm.gray_zone_min, llm.gray_zone_max).length : 0;
        button.disabled = state.busy || !llm.enabled || !count;
        button.title = !llm.enabled ? 'Включите ИИ в настройках сопоставления' : (count ? 'Кандидатов в серой зоне: ' + count : 'Нет кандидатов в серой зоне');
    }

    function onReportReady(selectedRow, report) {
        state.selectedRow = selectedRow;
        state.report = report;
        renderHistory();
        updateReviewControls();
        var llm = state.config.llm || defaults.llm;
        var count = rowsInGrayZone(report, llm.gray_zone_min, llm.gray_zone_max).length;
        setReviewStatus(llm.enabled ? ('В серой зоне ' + count + ' кандидатов.') : 'ИИ выключен; ручные решения доступны.');
    }

    function init() {
        var root = document.getElementById('xcom-match-app');
        if (!root) return;
        state.db = root.getAttribute('data-db') || window.db || '';
        var results = document.getElementById('xcom-match-report-results');
        var refineButton = document.getElementById('xcom-match-llm-refine');
        if (results) results.addEventListener('click', handleDecision);
        if (refineButton) refineButton.addEventListener('click', refine);
        loadEnvironment();
    }

    var api = {
        parseRef: parseRef,
        findColumnIndex: findColumnIndex,
        candidateFromRow: candidateFromRow,
        rowsInGrayZone: rowsInGrayZone,
        buildRefinementPrompt: buildRefinementPrompt,
        parseAgentVerdict: parseAgentVerdict,
        renderActionCell: renderActionCell,
        decisionObject: decisionObject,
        onReportReady: onReportReady,
        _state: state,
        init: init
    };
    window.XcomReviewWorkspace = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : {});
