(function(window, document) {
    'use strict';

    // Рабочее место массового подбора SKU для строк каталога контрагента (таблица RFP).
    // Пачками выбирает необработанные строки RFP (серверный фильтр: пустое «Наш артикул»),
    // для каждой строки запускает запрос mass_match (фильтр FR_RFPID={id строки}) и записывает
    // обратно в RFP три поля: «Наш артикул» (ссылка на SKU), «Кандидаты» (мульти-ссылка на SKU)
    // и «Точность подбора». Обработанные строки выпадают из выборки — пачка всегда «свежая».

    var DEFAULT_RFP_TABLE = '2032189';
    var DEFAULT_QUERY = 'mass_match';
    var DEFAULT_RFP_FILTER = 'RFPID';
    var DEFAULT_BATCH_SIZE = 50;
    var DEFAULT_CONCURRENCY = 3;
    var DEFAULT_MAX_CANDIDATES = 20;

    // Имена полей в таблице RFP (резолвятся по метаданным; можно переопределить data-атрибутами).
    var DEFAULT_RFP_NAME_NAME = 'Наименование';   // «Наименование из RFP» — для оценки точности
    var DEFAULT_OUR_NAME = 'Наш артикул';
    var DEFAULT_CANDIDATES_NAME = 'Кандидаты';
    var DEFAULT_ACCURACY_NAME = 'Точность подбора';

    // Имена колонок запроса mass_match (JSON_KV — ключи = «Имя в отчёте»).
    var DEFAULT_SKU_ID_KEY = 'SKUID';
    var DEFAULT_SKU_LABEL_KEY = 'Наименование SKU';
    var DEFAULT_TOKENS_KEY = 'токены';            // совпавшие токены (числитель точности)
    var DEFAULT_TMA_KEY = 'ТММ';                  // флаг точного совпадения артикула

    var state = {
        root: null,
        db: '',
        rfpTable: DEFAULT_RFP_TABLE,
        query: DEFAULT_QUERY,
        rfpFilter: DEFAULT_RFP_FILTER,
        batchSize: DEFAULT_BATCH_SIZE,
        concurrency: DEFAULT_CONCURRENCY,
        maxCandidates: DEFAULT_MAX_CANDIDATES,
        skuIdKey: DEFAULT_SKU_ID_KEY,
        skuLabelKey: DEFAULT_SKU_LABEL_KEY,
        tokensKey: DEFAULT_TOKENS_KEY,
        tmaKey: DEFAULT_TMA_KEY,
        names: {},
        fields: {},          // { rfpName, our, candidates, accuracy } -> { id, index }
        columns: [],
        records: [],
        running: false,
        stopRequested: false,
        loadToken: 0
    };

    function trimValue(value) {
        return String(value == null ? '' : value).trim();
    }

    function encodePathSegment(value) {
        return encodeURIComponent(String(value == null ? '' : value));
    }

    function normalizeName(value) {
        return trimValue(value).toLowerCase();
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // --- Токенизация и точность подбора -------------------------------------

    // Алфавитно-цифровые токены строки (латиница + кириллица + цифры), в нижнем регистре.
    function tokenize(value) {
        var matches = String(value == null ? '' : value).toLowerCase().match(/[0-9a-zа-яё]+/g);
        return matches || [];
    }

    // Длина «склеенных» токенов наименования (все алфавитно-цифровые символы без разделителей).
    function alnumLength(value) {
        return tokenize(value).reduce(function(sum, token) {
            return sum + token.length;
        }, 0);
    }

    // Длина совпавших токенов: токены, встречающиеся и в RFP, и в SKU (по мультимножеству),
    // склеиваются в одну строку — её длина и есть числитель точности.
    function matchedAlnumLength(rfpString, skuString) {
        var pool = {};
        tokenize(rfpString).forEach(function(token) {
            pool[token] = (pool[token] || 0) + 1;
        });

        var matchedLength = 0;
        tokenize(skuString).forEach(function(token) {
            if (pool[token] > 0) {
                pool[token] -= 1;
                matchedLength += token.length;
            }
        });
        return matchedLength;
    }

    // Вес флага TMA в оценке точности (≈50%); остальное — текстовое совпадение токенов.
    var TMA_WEIGHT = 0.5;

    // Точность подбора в процентах — взвешенная сумма двух составляющих:
    //   • текстовое совпадение: длина склеенных совпавших токенов, делённая на полусумму
    //     длин «Наименование SKU» и «Наименование из RFP» (длины — по склеенным токенам);
    //   • флаг ТММ (точное совпадение артикула): вес ≈50%.
    // 100% — полное совпадение токенов И ТММ=1. 50% — только одно из двух. 0% — ни того, ни другого.
    // matchedTokens — список совпавших токенов из отчёта (колонка «токены»); если пуст,
    // совпадение считается пересечением токенов «Наименование из RFP» и «Наименование SKU».
    function computeAccuracy(rfpName, skuName, matchedTokens, tmaFlag) {
        var denom = (alnumLength(skuName) + alnumLength(rfpName)) / 2;
        var matchedLength = trimValue(matchedTokens)
            ? alnumLength(matchedTokens)
            : matchedAlnumLength(rfpName, skuName);
        var lengthScore = denom > 0 ? Math.min(1, matchedLength / denom) : 0;
        var tmaScore = trimValue(tmaFlag) === '1' ? 1 : 0;

        var accuracy = TMA_WEIGHT * tmaScore + (1 - TMA_WEIGHT) * lengthScore;
        return Math.max(0, Math.min(100, Math.round(accuracy * 100)));
    }

    // --- Метаданные таблицы RFP ---------------------------------------------

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

    // Колонки таблицы по метаданным: главное значение, затем реквизиты (reqs) по порядку.
    // Индекс колонки совпадает с индексом значения в массиве r[] записи (JSON_OBJ).
    function buildColumns(metadata) {
        var columns = [];
        var mainName = metadata && (metadata.val || metadata.name || metadata.value) || 'RFP';

        if (metadata && metadata.id) {
            columns.push({ id: String(metadata.id), name: mainName, type: metadata.type || 'SHORT' });
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

    function resolveMetadata(payload, table) {
        var lookup = normalizeName(table || DEFAULT_RFP_TABLE);
        if (Array.isArray(payload)) {
            var found = null;
            payload.some(function(item) {
                var names = [item && item.id, item && item.val, item && item.name, item && item.value];
                found = names.some(function(name) {
                    return normalizeName(name) === lookup;
                }) ? item : null;
                return !!found;
            });
            return found;
        }
        return payload && typeof payload === 'object' ? payload : null;
    }

    // Найти колонку по имени (override id из data-атрибута имеет приоритет).
    function findField(name, overrideId) {
        if (overrideId) {
            for (var i = 0; i < state.columns.length; i++) {
                if (state.columns[i].id === String(overrideId)) {
                    return { id: state.columns[i].id, index: i, name: state.columns[i].name };
                }
            }
            return { id: String(overrideId), index: -1, name: name };
        }
        var target = normalizeName(name);
        for (var j = 0; j < state.columns.length; j++) {
            if (normalizeName(state.columns[j].name) === target) {
                return { id: state.columns[j].id, index: j, name: state.columns[j].name };
            }
        }
        return null;
    }

    // --- HTTP ----------------------------------------------------------------

    function fetchJson(url) {
        return fetch(url, { credentials: 'same-origin' }).then(function(response) {
            return response.text().then(function(text) {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status + ': ' + text.slice(0, 180));
                }
                try {
                    return JSON.parse(text);
                } catch (error) {
                    throw new Error('Сервер вернул ответ не в формате JSON');
                }
            });
        });
    }

    function getXsrf() {
        return (typeof window !== 'undefined' && window.xsrf) ? window.xsrf : '';
    }

    // POST _m_set/{recordId} с одним значением реквизита (t{reqId}=value).
    function postSet(recordId, reqId, value) {
        var url = '/' + encodePathSegment(state.db) + '/_m_set/' + encodePathSegment(recordId) + '?JSON';
        var body = '_xsrf=' + encodeURIComponent(getXsrf()) +
            '&t' + encodeURIComponent(reqId) + '=' + encodeURIComponent(value);
        return fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body
        }).then(function(response) {
            return response.text().then(function(text) {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status + ': ' + text.slice(0, 180));
                }
                return text;
            });
        });
    }

    // --- URL-построители -----------------------------------------------------

    function buildMetadataUrl() {
        return '/' + encodePathSegment(state.db) + '/metadata/' + encodePathSegment(state.rfpTable);
    }

    // Запрос пачки необработанных строк RFP: серверный фильтр «Наш артикул» пуст (F_{id}=!%).
    // Обработанные (с заполненным «Наш артикул») сервер не возвращает — пачка всегда «свежая»,
    // без клиентского сканирования таблицы.
    function buildScanUrl(limit) {
        var params = new URLSearchParams();
        params.set('JSON_OBJ', '');
        if (state.fields.our && state.fields.our.id) {
            params.set('F_' + state.fields.our.id, '!%');
        }
        params.set('LIMIT', '0,' + limit);
        return '/' + encodePathSegment(state.db) + '/object/' +
            encodePathSegment(state.rfpTable) + '/?' + params.toString();
    }

    function buildMatchUrl(recordId) {
        var params = new URLSearchParams();
        params.set('JSON_KV', '');
        params.set('FR_' + state.rfpFilter, String(recordId));
        return '/' + encodePathSegment(state.db) + '/report/' +
            encodePathSegment(state.query) + '?' + params.toString();
    }

    // --- Разбор данных -------------------------------------------------------

    function normalizeRows(json) {
        if (!Array.isArray(json)) return [];
        return json.map(function(item) {
            return {
                id: String(item && item.i != null ? item.i : ''),
                values: item && Array.isArray(item.r) ? item.r : []
            };
        });
    }

    function parseRefValue(raw) {
        var str = String(raw == null ? '' : raw);
        var m = str.match(/^(\d+):(.*)$/);
        if (m) return { refId: m[1], label: m[2] };
        return { refId: null, label: str };
    }

    // Привести ответ запроса (JSON_KV / платформенный JSON) к массиву строк-объектов.
    function normalizeQueryRows(json) {
        if (Array.isArray(json)) {
            return json.filter(function(row) {
                return row && typeof row === 'object' && !Array.isArray(row);
            });
        }
        if (json && Array.isArray(json.columns) && Array.isArray(json.data)) {
            var columns = json.columns.map(function(column, index) {
                return String(column.name || column.val || column.id || index);
            });
            var rowCount = 0;
            json.data.forEach(function(columnData) {
                if (Array.isArray(columnData)) rowCount = Math.max(rowCount, columnData.length);
            });
            var rows = [];
            for (var r = 0; r < rowCount; r++) {
                var obj = {};
                columns.forEach(function(name, c) {
                    obj[name] = Array.isArray(json.data[c]) ? json.data[c][r] : '';
                });
                rows.push(obj);
            }
            return rows;
        }
        return [];
    }

    function detectKey(row, explicit, predicate) {
        if (explicit && Object.prototype.hasOwnProperty.call(row, explicit)) return explicit;
        var keys = Object.keys(row);
        for (var i = 0; i < keys.length; i++) {
            if (predicate(keys[i])) return keys[i];
        }
        return null;
    }

    // Из строк запроса собрать первый артикул (Наш артикул) и кандидатов (остальные).
    function pickMatches(rows) {
        if (!rows.length) return { our: null, candidates: [], tokens: '', tma: '' };

        var first = rows[0];
        var idKey = detectKey(first, state.skuIdKey, function(key) {
            return /id$/i.test(key) && normalizeName(key) !== normalizeName(state.rfpFilter);
        });
        var labelKey = detectKey(first, state.skuLabelKey, function(key) {
            return key !== idKey && !/id$/i.test(key);
        });

        function toItem(row) {
            var id = idKey ? trimValue(row[idKey]) : '';
            var label = labelKey ? trimValue(row[labelKey]) : '';
            if (!id) {
                var parsed = parseRefValue(label);
                if (parsed.refId) { id = parsed.refId; label = parsed.label; }
            }
            return { id: id, label: label || id };
        }

        var our = toItem(first);
        var candidates = rows.slice(1).map(toItem).filter(function(item) {
            return item.id;
        });
        if (state.maxCandidates > 0) candidates = candidates.slice(0, state.maxCandidates);

        return {
            our: our.id ? our : null,
            candidates: candidates,
            tokens: state.tokensKey && first[state.tokensKey] != null ? trimValue(first[state.tokensKey]) : '',
            tma: state.tmaKey && first[state.tmaKey] != null ? trimValue(first[state.tmaKey]) : ''
        };
    }

    // --- Рендеринг -----------------------------------------------------------

    function setText(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function setHidden(id, hidden) {
        var el = document.getElementById(id);
        if (el) el.hidden = !!hidden;
    }

    function setDisabled(id, disabled) {
        var el = document.getElementById(id);
        if (el) el.disabled = !!disabled;
    }

    function renderMessage(text, type) {
        var container = document.getElementById('xcom-mass-list');
        if (!container) return;
        var cls = type === 'error' ? 'xcom-mass-error' :
            (type === 'loading' ? 'xcom-mass-loading' : 'xcom-mass-empty');
        container.innerHTML = '<div class="' + cls + '">' +
            (type === 'loading' ? '<span class="xcom-mass-spinner"></span>' : '') +
            '<span>' + escapeHtml(text) + '</span></div>';
    }

    function statusCell(record) {
        switch (record.status) {
            case 'processing':
                return '<span class="xcom-mass-status xcom-mass-status-processing">' +
                    '<span class="xcom-mass-spinner"></span>Обработка…</span>';
            case 'done':
                return '<span class="xcom-mass-status xcom-mass-status-done">' +
                    '<i class="pi pi-check"></i>Готово</span>';
            case 'error':
                return '<span class="xcom-mass-status xcom-mass-status-error" title="' +
                    escapeHtml(record.message || '') + '"><i class="pi pi-exclamation-triangle"></i>Ошибка</span>';
            default:
                return '<span class="xcom-mass-status xcom-mass-status-pending">—</span>';
        }
    }

    function candidatesCell(record) {
        if (!record.candidates || !record.candidates.length) return '';
        return record.candidates.map(function(item) {
            return escapeHtml(item.label);
        }).join(', ');
    }

    function renderList() {
        var container = document.getElementById('xcom-mass-list');
        if (!container) return;

        if (!state.records.length) {
            renderMessage('Несопоставленных строк RFP не осталось — поле «' + state.names.our +
                '» заполнено у всех.', 'empty');
            return;
        }

        var body = state.records.map(function(record, index) {
            return '<tr data-record-id="' + escapeHtml(record.id) + '">' +
                '<td class="xcom-mass-num">' + (index + 1) + '</td>' +
                '<td>' + escapeHtml(record.label) + '</td>' +
                '<td class="xcom-mass-rfp-name">' + escapeHtml(record.rfpName || '') + '</td>' +
                '<td class="xcom-mass-status-col">' + statusCell(record) + '</td>' +
                '<td>' + escapeHtml(record.our ? record.our.label : '') + '</td>' +
                '<td>' + candidatesCell(record) + '</td>' +
                '<td class="xcom-mass-accuracy">' + (record.accuracy == null ? '' : record.accuracy + '%') + '</td>' +
                '</tr>';
        }).join('');

        container.innerHTML = '<table class="xcom-mass-table">' +
            '<thead><tr>' +
            '<th class="xcom-mass-num">#</th>' +
            '<th>Строка RFP</th>' +
            '<th class="xcom-mass-rfp-name">Наименование из RFP</th>' +
            '<th class="xcom-mass-status-col">Статус</th>' +
            '<th>Наш артикул</th>' +
            '<th>Кандидаты</th>' +
            '<th class="xcom-mass-accuracy">Точность</th>' +
            '</tr></thead><tbody>' + body + '</tbody></table>';
    }

    function updateRecordRow(record) {
        var container = document.getElementById('xcom-mass-list');
        if (!container) return;
        var row = container.querySelector('tr[data-record-id="' + record.id + '"]');
        if (!row) return;
        var cells = row.cells;
        if (cells.length < 7) return;
        cells[3].innerHTML = statusCell(record);
        cells[4].textContent = record.our ? record.our.label : '';
        cells[5].innerHTML = candidatesCell(record);
        cells[6].textContent = record.accuracy == null ? '' : record.accuracy + '%';
    }

    function updateProgress() {
        var total = state.records.length;
        var done = state.records.filter(function(r) {
            return r.status === 'done' || r.status === 'error';
        }).length;
        var errors = state.records.filter(function(r) {
            return r.status === 'error';
        }).length;

        setText('xcom-mass-progress-label',
            'Обработано ' + done + ' из ' + total + (errors ? ' (ошибок: ' + errors + ')' : ''));
        var bar = document.getElementById('xcom-mass-progress-bar');
        if (bar) bar.style.width = (total ? Math.round((done / total) * 100) : 0) + '%';
    }

    function setControls(mode) {
        // mode: 'idle' | 'running' | 'loading'
        setDisabled('xcom-mass-reload', mode !== 'idle');
        setHidden('xcom-mass-start', mode === 'running');
        setDisabled('xcom-mass-start', mode !== 'idle' || !state.records.length);
        setHidden('xcom-mass-stop', mode !== 'running');
        setHidden('xcom-mass-progress', mode === 'loading');
    }

    // --- Обработка одной строки ---------------------------------------------

    function processRecord(record) {
        record.status = 'processing';
        record.message = '';
        updateRecordRow(record);
        updateProgress();

        return fetchJson(buildMatchUrl(record.id)).then(function(json) {
            var picked = pickMatches(normalizeQueryRows(json));
            record.our = picked.our;
            record.candidates = picked.candidates;
            record.accuracy = picked.our
                ? computeAccuracy(record.rfpName || record.label, picked.our.label, picked.tokens, picked.tma)
                : 0;

            return writeBack(record).then(function() {
                record.status = 'done';
                updateRecordRow(record);
                updateProgress();
            });
        }).catch(function(error) {
            record.status = 'error';
            record.message = error && error.message ? error.message : 'Не удалось обработать строку.';
            updateRecordRow(record);
            updateProgress();
        });
    }

    // Записать результат в таблицу RFP: «Наш артикул», «Кандидаты» (по одной ссылке), «Точность».
    function writeBack(record) {
        var steps = [];
        var fields = state.fields;

        if (fields.our && record.our && record.our.id) {
            steps.push(function() {
                return postSet(record.id, fields.our.id, record.our.id);
            });
        }
        if (fields.candidates && record.candidates && record.candidates.length) {
            record.candidates.forEach(function(item) {
                if (!item.id) return;
                steps.push(function() {
                    return postSet(record.id, fields.candidates.id, item.id);
                });
            });
        }
        if (fields.accuracy && record.accuracy != null) {
            steps.push(function() {
                return postSet(record.id, fields.accuracy.id, record.accuracy);
            });
        }

        // Последовательно, чтобы записи в мульти-ссылку «Кандидаты» добавлялись по порядку.
        return steps.reduce(function(chain, step) {
            return chain.then(step);
        }, Promise.resolve());
    }

    // --- Пул обработки (не более N одновременно) -----------------------------

    function runBatch() {
        if (state.running || !state.records.length) return;
        state.running = true;
        state.stopRequested = false;
        setControls('running');

        var queue = state.records.filter(function(record) {
            return record.status === 'pending' || record.status === 'error';
        });
        queue.forEach(function(record) {
            record.status = 'pending';
            record.message = '';
        });
        renderList();
        updateProgress();

        var cursor = 0;
        var active = 0;

        return new Promise(function(resolve) {
            function pump() {
                if (state.stopRequested && active === 0) return resolve();
                if (cursor >= queue.length && active === 0) return resolve();

                while (!state.stopRequested && active < state.concurrency && cursor < queue.length) {
                    var record = queue[cursor++];
                    active += 1;
                    processRecord(record).then(function() {
                        active -= 1;
                        pump();
                    });
                }
            }
            pump();
        }).then(function() {
            state.running = false;
            setControls('idle');
            updateProgress();
        });
    }

    function stopBatch() {
        if (!state.running) return;
        state.stopRequested = true;
        setText('xcom-mass-progress-label', 'Остановка…');
    }

    // --- Загрузка пачки ------------------------------------------------------

    // Необработанная строка — пустое поле «Наш артикул» (его заполняет writeBack при обработке).
    // Уже обработанные пропускаем: иначе повторно дублировались бы «Кандидаты» (мульти-ссылка).
    function isUnprocessed(record) {
        var index = state.fields.our ? state.fields.our.index : -1;
        if (index < 0) return true;
        return trimValue(record.values[index]) === '';
    }

    // Пачка = один запрос. Сервер сам отдаёт только необработанные строки (фильтр в buildScanUrl),
    // поэтому ни клиентского сканирования таблицы, ни курсора не нужно: по мере обработки строки
    // получают «Наш артикул» и выпадают из выборки — следующее «Обновить» вернёт новую пачку.
    function loadBatch() {
        var token = ++state.loadToken;
        state.records = [];
        setControls('loading');
        renderMessage('Загрузка строк RFP…', 'loading');
        setText('xcom-mass-summary', 'Загрузка…');

        return fetchJson(buildScanUrl(state.batchSize)).then(function(json) {
            if (token !== state.loadToken) return;
            var rows = normalizeRows(json);

            var nameField = state.fields.rfpName;
            var nameIndex = nameField ? nameField.index : -1;
            // подстраховка: даже если сервер вернёт строку с «Наш артикул», не обрабатываем её
            // повторно (иначе дублировались бы «Кандидаты»).
            var collected = rows.filter(isUnprocessed).map(function(row) {
                return {
                    id: row.id,
                    label: trimValue(row.values[0]),
                    rfpName: nameIndex >= 0 ? trimValue(row.values[nameIndex]) : trimValue(row.values[0]),
                    values: row.values,
                    status: 'pending',
                    our: null,
                    candidates: [],
                    accuracy: null,
                    message: ''
                };
            });

            state.records = collected;
            renderList();
            setText('xcom-mass-summary', collected.length + ' необработанных');
            setControls('idle');
            updateProgress();
        }).catch(function(error) {
            if (token !== state.loadToken) return;
            renderMessage(error && error.message ? error.message : 'Не удалось загрузить строки RFP.', 'error');
            setText('xcom-mass-summary', 'Ошибка');
            setControls('idle');
        });
    }

    // --- Инициализация -------------------------------------------------------

    function loadMetadata() {
        renderMessage('Загрузка метаданных таблицы RFP…', 'loading');
        return fetchJson(buildMetadataUrl()).then(function(payload) {
            var metadata = resolveMetadata(payload, state.rfpTable);
            if (!metadata) throw new Error('Таблица ' + state.rfpTable + ' не найдена в метаданных.');
            state.columns = buildColumns(metadata);

            var attr = function(name) { return state.root.getAttribute(name); };
            state.fields.rfpName = findField(state.names.rfpName, attr('data-rfp-name-field-id'));
            state.fields.our = findField(state.names.our, attr('data-our-field-id'));
            state.fields.candidates = findField(state.names.candidates, attr('data-candidates-field-id'));
            state.fields.accuracy = findField(state.names.accuracy, attr('data-accuracy-field-id'));

            var missing = [];
            if (!state.fields.our) missing.push(state.names.our);
            if (!state.fields.candidates) missing.push(state.names.candidates);
            if (!state.fields.accuracy) missing.push(state.names.accuracy);
            if (missing.length) {
                throw new Error('В таблице RFP не найдены поля: ' + missing.join(', ') +
                    '. Добавьте их или задайте data-*-field-id.');
            }

            return loadBatch();
        }).catch(function(error) {
            renderMessage(error && error.message ? error.message : 'Не удалось загрузить метаданные RFP.', 'error');
            setText('xcom-mass-summary', 'Ошибка');
            setControls('loading');
            setDisabled('xcom-mass-reload', false);
        });
    }

    function bindEvents() {
        var reload = document.getElementById('xcom-mass-reload');
        var start = document.getElementById('xcom-mass-start');
        var stop = document.getElementById('xcom-mass-stop');

        if (reload) reload.addEventListener('click', function() {
            if (state.running) return;
            loadBatch();
        });
        if (start) start.addEventListener('click', function() {
            runBatch();
        });
        if (stop) stop.addEventListener('click', function() {
            stopBatch();
        });
    }

    function readConfig() {
        var root = state.root;
        var num = function(attr, fallback) {
            var value = parseInt(root.getAttribute(attr), 10);
            return isNaN(value) || value <= 0 ? fallback : value;
        };
        var str = function(attr, fallback) {
            var value = trimValue(root.getAttribute(attr));
            return value || fallback;
        };

        state.db = root.getAttribute('data-db') || window.db || '';
        state.rfpTable = str('data-rfp-table', DEFAULT_RFP_TABLE);
        state.query = str('data-query', DEFAULT_QUERY);
        state.rfpFilter = str('data-rfp-filter', DEFAULT_RFP_FILTER);
        state.batchSize = num('data-batch-size', DEFAULT_BATCH_SIZE);
        state.concurrency = num('data-concurrency', DEFAULT_CONCURRENCY);
        state.maxCandidates = num('data-max-candidates', DEFAULT_MAX_CANDIDATES);
        state.skuIdKey = str('data-sku-id-field', DEFAULT_SKU_ID_KEY);
        state.skuLabelKey = str('data-sku-field', DEFAULT_SKU_LABEL_KEY);
        state.tokensKey = str('data-tokens-field', DEFAULT_TOKENS_KEY);
        state.tmaKey = str('data-tma-field', DEFAULT_TMA_KEY);
        state.names = {
            rfpName: str('data-rfp-name', DEFAULT_RFP_NAME_NAME),
            our: str('data-our-name', DEFAULT_OUR_NAME),
            candidates: str('data-candidates-name', DEFAULT_CANDIDATES_NAME),
            accuracy: str('data-accuracy-name', DEFAULT_ACCURACY_NAME)
        };
    }

    function init() {
        state.root = document.getElementById('xcom-mass-match-app');
        if (!state.root) return;
        readConfig();
        bindEvents();
        setText('xcom-mass-batch-hint', 'Пачка по ' + state.batchSize +
            ', одновременно не более ' + state.concurrency + ' запросов');
        loadMetadata();
    }

    window.XcomMassMatchWorkspace = {
        tokenize: tokenize,
        alnumLength: alnumLength,
        computeAccuracy: computeAccuracy,
        buildColumns: buildColumns,
        resolveMetadata: resolveMetadata,
        normalizeRows: normalizeRows,
        normalizeQueryRows: normalizeQueryRows,
        pickMatches: pickMatches,
        buildMatchUrl: buildMatchUrl,
        buildScanUrl: buildScanUrl,
        _state: state,
        init: init
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : {});
