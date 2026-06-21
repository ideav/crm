(function(window, document) {
    'use strict';

    // Рабочее место массового подбора SKU для строк каталога контрагента (таблица RFP).
    // Пачками выбирает необработанные строки RFP (серверный фильтр: пустое «Наш артикул»),
    // для каждой строки запускает запрос mass_match (фильтр FR_RFPID={id строки}) и записывает
    // обратно в RFP три поля ОДНИМ запросом _m_set: «Наш артикул» (артикул SKU), «Кандидаты»
    // (список артикулов SKU через запятую) и «Точность подбора». Обработанные строки выпадают из
    // выборки. «Старт» обрабатывает пачки подряд (по batchSize), автоматически подгружая
    // следующие, пока не нажмут «Стоп» или сервер не вернёт пустой список (issue #3512).

    var DEFAULT_RFP_TABLE = '2032189';
    var DEFAULT_QUERY = 'mass_match';
    var DEFAULT_RFP_FILTER = 'RFPID';
    var DEFAULT_BATCH_SIZE = 50;
    var DEFAULT_CONCURRENCY = 5;                       // одновременных запросов (issue #3522)
    var CONCURRENCY_OPTIONS = [3, 5, 7, 10, 15, 20];  // допустимые значения переключателя (issue #3522)
    // Авто-регулировка числа потоков по скорости пачки (issue #3527)
    var MIN_CONCURRENCY = 1;
    var MAX_CONCURRENCY = 20;
    var TUNE_COOLDOWN_BATCHES = 3;    // через сколько пачек повторить пробу после неудачной
    var SPEED_DROP_RATIO = 0.9;       // падение скорости ≥10% к прошлой пачке → уменьшать потоки
    var DEFAULT_MAX_CANDIDATES = 20;
    // Запись-заглушка «Наш артикул» для строк без совпадений или с ошибкой — чтобы они вышли
    // из выборки необработанных (фильтр пустого «Наш артикул») и не возвращались в каждую пачку.
    // «Наш артикул» (type 3, ref=null) хранит сырое значение как текст → '0' делает val непустым.
    var DEFAULT_PLACEHOLDER_OUR_ID = '0';

    // Имена полей в таблице RFP (резолвятся по метаданным; можно переопределить data-атрибутами).
    var DEFAULT_RFP_NAME_NAME = 'Наименование';   // «Наименование из RFP» — для оценки точности
    var DEFAULT_OUR_NAME = 'Наш артикул';
    var DEFAULT_CANDIDATES_NAME = 'Кандидаты';
    var DEFAULT_ACCURACY_NAME = 'Точность подбора';

    // Имена колонок запроса mass_match (JSON_KV — ключи = «Имя в отчёте»).
    var DEFAULT_SKU_ID_KEY = 'SKUID';
    var DEFAULT_SKU_LABEL_KEY = 'Наименование SKU';
    var DEFAULT_SKU_ARTICLE_KEY = 'Артикул';      // артикул SKU — показываем в таблице вместо ID (issue #3532)
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
        placeholderOurId: DEFAULT_PLACEHOLDER_OUR_ID,
        skuIdKey: DEFAULT_SKU_ID_KEY,
        skuLabelKey: DEFAULT_SKU_LABEL_KEY,
        skuArticleKey: DEFAULT_SKU_ARTICLE_KEY,
        tokensKey: DEFAULT_TOKENS_KEY,
        tmaKey: DEFAULT_TMA_KEY,
        names: {},
        fields: {},          // { rfpName, our, candidates, accuracy } -> { id, index }
        columns: [],
        records: [],
        running: false,
        stopRequested: false,
        loadToken: 0,
        keyword: '',        // ключевое слово фильтра по «Наименованию» RFP (issue #3523)
        seenIds: {},        // id строк, уже взятых в работу в этом прогоне — защита от зацикливания
        // issue #3522: статистика и время выполнения авто-прогона
        outcomes: {},       // { recordId: 'matched'|'noMatch'|'error' } — итог по строке для статистики
        startTime: 0,       // Date.now() начала прогона
        endTime: 0,         // Date.now() конца прогона (0 — пока идёт)
        timer: null,        // id setInterval живого таймера
        // issue #3527: авто-регулировка числа потоков по скорости пачки
        autoConcurrency: true, // вкл/выкл авто-регулировку (по умолчанию вкл)
        prevSpeed: null,    // скорость (строк/сек) предыдущей пачки — база для оценки ПАДЕНИЯ
        maxSpeed: null,     // исторический максимум скорости за прогон — база для оценки ПРИРОСТА (issue #3549)
        lastTuneUp: false,  // увеличивали ли потоки ПЕРЕД последней пачкой (оценка пробы)
        tuneCooldown: 0     // сколько пачек ждать до следующей пробы повышения
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

    // POST _m_set/{recordId} с несколькими реквизитами ОДНИМ запросом (issue #3512):
    // тело = _xsrf + t{reqId}=value для каждого поля. fieldValues — { reqId: value, … }.
    function postSetMany(recordId, fieldValues) {
        var url = '/' + encodePathSegment(state.db) + '/_m_set/' + encodePathSegment(recordId) + '?JSON';
        var body = '_xsrf=' + encodeURIComponent(getXsrf());
        Object.keys(fieldValues).forEach(function(reqId) {
            body += '&t' + encodeURIComponent(reqId) + '=' + encodeURIComponent(fieldValues[reqId]);
        });
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
    // без клиентского сканирования таблицы. issue #3523: если задано ключевое слово —
    // дополнительно ограничиваем выборку строками, чьё «Наименование» его содержит
    // (F_{rfpNameId}=%слово% — LIKE-«содержит», как column-фильтр у object-эндпоинта).
    function buildScanUrl(limit) {
        var params = new URLSearchParams();
        params.set('JSON_OBJ', '');
        if (state.fields.our && state.fields.our.id) {
            params.set('F_' + state.fields.our.id, '!%');
        }
        if (state.keyword && state.fields.rfpName && state.fields.rfpName.id) {
            params.set('F_' + state.fields.rfpName.id, '%' + state.keyword + '%');
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
        // Артикул SKU — отдельная колонка отчёта; показываем её в таблице вместо ID (issue #3532).
        var articleKey = detectKey(first, state.skuArticleKey, function(key) {
            return /артикул/i.test(key);
        });

        function toItem(row) {
            var id = idKey ? trimValue(row[idKey]) : '';
            var label = labelKey ? trimValue(row[labelKey]) : '';
            var article = articleKey ? trimValue(row[articleKey]) : '';
            if (!id) {
                var parsed = parseRefValue(label);
                if (parsed.refId) { id = parsed.refId; label = parsed.label; }
            }
            return {
                id: id,
                label: label || id,
                article: article,   // показываем в таблице вместо ID (issue #3532); потерян при merge #3536, восстановлен в #3537
                tokens: state.tokensKey && row[state.tokensKey] != null ? trimValue(row[state.tokensKey]) : '',
                tma: state.tmaKey && row[state.tmaKey] != null ? trimValue(row[state.tmaKey]) : ''
            };
        }

        // Берём только строки с реальным SKU (непустой SKUID). Отчёт mass_match иногда возвращает
        // ведущую служебную строку без SKU (пустые SKUID/Артикул/Наименование, в «токенах» —
        // требования RFP): раньше она становилась «Наш артикул», our → null, и в строку RFP
        // писалась заглушка «0», хотя кандидаты были (issue #3534). Теперь её пропускаем:
        // «Наш артикул» = первый настоящий SKU, точность считаем по ЕГО токенам, а не по служебной строке.
        var items = rows.map(toItem).filter(function(item) {
            return item.id;
        });
        if (!items.length) return { our: null, candidates: [], tokens: '', tma: '' };

        var our = items[0];
        var candidates = items.slice(1);
        if (state.maxCandidates > 0) candidates = candidates.slice(0, state.maxCandidates);

        return {
            our: our,
            candidates: candidates,
            tokens: our.tokens,
            tma: our.tma
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

    // Ячейка SKU: показываем артикул, ID кладём в title для трассировки (issue #3532).
    // В строку RFP теперь тоже записывается артикул (см. writeBack, issue #3547).
    function skuCell(item) {
        var text = item.article || item.id;
        return '<span title="ID ' + escapeHtml(item.id) + '">' + escapeHtml(text) + '</span>';
    }

    // Колонка «Наш артикул» — артикул SKU вместо ID (issue #3532; до этого выводился ID, #3519).
    function ourCell(record) {
        if (!record.our || !record.our.id) return '';
        return skuCell(record.our);
    }

    // Колонка «Кандидаты» — список артикулов SKU через запятую (issue #3532; ранее список ID, #3519).
    function candidatesCell(record) {
        if (!record.candidates || !record.candidates.length) return '';
        return record.candidates.filter(function(item) {
            return item.id;
        }).map(skuCell).join(', ');
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
                '<td>' + ourCell(record) + '</td>' +
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
        cells[4].innerHTML = ourCell(record);
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

    // --- Статистика и время выполнения (issue #3522) -------------------------

    // Зафиксировать итог строки для статистики (перезапись при ретрае — без двойного счёта).
    function recordOutcome(record) {
        state.outcomes[record.id] = record.status === 'error' ? 'error'
            : (record.our && record.our.placeholder ? 'noMatch' : 'matched');
        renderStats();
    }

    function formatDuration(ms) {
        var s = Math.max(0, Math.floor(ms / 1000));
        var h = Math.floor(s / 3600);
        var m = Math.floor((s % 3600) / 60);
        var sec = s % 60;
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        return (h > 0 ? h + ':' + pad(m) : m) + ':' + pad(sec);
    }

    // Обновить панель статистики: время прогона, всего обработано, с подбором / без подбора /
    // ошибки и скорость (строк/мин). Считаем по state.outcomes (итог по каждой строке прогона).
    function renderStats() {
        var matched = 0, noMatch = 0, errors = 0, total = 0;
        for (var id in state.outcomes) {
            if (!Object.prototype.hasOwnProperty.call(state.outcomes, id)) continue;
            total++;
            var o = state.outcomes[id];
            if (o === 'matched') matched++;
            else if (o === 'noMatch') noMatch++;
            else if (o === 'error') errors++;
        }
        var elapsed = state.startTime ? ((state.endTime || Date.now()) - state.startTime) : 0;
        var speed = elapsed > 0 ? Math.round(total / (elapsed / 60000)) : 0;

        setText('xcom-mass-stat-time', formatDuration(elapsed));
        setText('xcom-mass-stat-total', String(total));
        setText('xcom-mass-stat-matched', String(matched));
        setText('xcom-mass-stat-nomatch', String(noMatch));
        setText('xcom-mass-stat-errors', String(errors));
        setText('xcom-mass-stat-speed', String(speed));
    }

    function startStatsTimer() {
        stopStatsTimer();
        state.timer = setInterval(renderStats, 1000);
    }

    function stopStatsTimer() {
        if (state.timer) { clearInterval(state.timer); state.timer = null; }
    }

    // --- Авто-регулировка числа потоков по скорости пачки (issue #3527) ------

    // Решение по числу потоков после очередной пачки. batchSpeed — строк/сек этой пачки.
    // Правила: (1) пробуем +1 от текущего; (2) пока повышение даёт НОВЫЙ исторический максимум —
    // повышаем дальше; (3) если максимум не побит — возвращаем обратно и ждём TUNE_COOLDOWN_BATCHES
    // пачек до следующей пробы; (4) если скорость упала ≥10% к ПОСЛЕДНЕЙ пачке — понижаем.
    // issue #3549: прирост меряем относительно исторического максимума (maxSpeed), а падение —
    // относительно последней пачки (prevSpeed). Иначе после revert/wait на сниженных потоках
    // следующая проба сравнивалась бы с деградированной базой и «прирост» засчитывался ложно.
    // Возвращает { action, from, to } (для логов/тестов).
    function tuneConcurrency(batchSpeed) {
        var prev = state.prevSpeed;     // скорость предыдущей пачки (или null для первой) — для падения
        var max = state.maxSpeed;       // исторический максимум за прогон (или null) — для прироста (issue #3549)
        var wasUp = state.lastTuneUp;   // повышали ли потоки ПЕРЕД этой пачкой
        var before = state.concurrency;
        var action;

        if (prev != null && batchSpeed <= prev * SPEED_DROP_RATIO) {
            // (4) скорость упала на 10% и больше ОТНОСИТЕЛЬНО ПОСЛЕДНЕЙ пачки — понижаем
            state.concurrency = Math.max(MIN_CONCURRENCY, state.concurrency - 1);
            state.lastTuneUp = false;
            state.tuneCooldown = TUNE_COOLDOWN_BATCHES;
            action = 'down';
        } else if (wasUp) {
            if (max == null || batchSpeed > max) {
                // (2) повышение дало НОВЫЙ исторический максимум — продолжаем повышать (issue #3549)
                state.concurrency = Math.min(MAX_CONCURRENCY, state.concurrency + 1);
                state.lastTuneUp = true;
                action = 'up';
            } else {
                // (3) исторический максимум не побит — возвращаем обратно и ждём перед следующей пробой
                state.concurrency = Math.max(MIN_CONCURRENCY, state.concurrency - 1);
                state.lastTuneUp = false;
                state.tuneCooldown = TUNE_COOLDOWN_BATCHES;
                action = 'revert';
            }
        } else if (state.tuneCooldown > 0) {
            // ждём перед следующей пробой повышения
            state.tuneCooldown -= 1;
            state.lastTuneUp = false;
            action = 'wait';
        } else if (state.concurrency < MAX_CONCURRENCY) {
            // (1) пробуем повысить на 1
            state.concurrency = state.concurrency + 1;
            state.lastTuneUp = true;
            action = 'probe-up';
        } else {
            state.lastTuneUp = false;
            action = 'max';
        }

        state.prevSpeed = batchSpeed;
        // обновляем исторический максимум ПОСЛЕ оценки (сравнивали с максимумом до этой пачки)
        state.maxSpeed = (max == null || batchSpeed > max) ? batchSpeed : max;
        return { action: action, from: before, to: state.concurrency };
    }

    // Отразить текущее число потоков в плитке статистики, селекторе и подсказке.
    function renderConcurrency() {
        setText('xcom-mass-stat-concurrency', String(state.concurrency));
        var sel = document.getElementById('xcom-mass-concurrency');
        if (sel && !sel.disabled) {
            // при ручном режиме селектор — источник истины; в авто он отключён и лишь стартовое значение
        }
        updateBatchHint();
    }

    function setControls(mode) {
        // mode: 'idle' | 'running' | 'loading'
        setDisabled('xcom-mass-reload', mode !== 'idle');
        setDisabled('xcom-mass-keyword', mode !== 'idle');
        setHidden('xcom-mass-start', mode === 'running');
        setDisabled('xcom-mass-start', mode !== 'idle' || !state.records.length);
        setHidden('xcom-mass-stop', mode !== 'running');
        setHidden('xcom-mass-progress', mode === 'loading');
    }

    // --- Обработка одной строки ---------------------------------------------

    // Заглушка «Наш артикул» (без совпадений / ошибка) — чтобы строка вышла из выборки.
    function placeholderOur(label) {
        return { id: state.placeholderOurId, label: label || '', placeholder: true };
    }

    function processRecord(record) {
        record.status = 'processing';
        record.message = '';
        updateRecordRow(record);
        updateProgress();

        return fetchJson(buildMatchUrl(record.id)).then(function(json) {
            return pickMatches(normalizeQueryRows(json));
        }).catch(function(error) {
            // ошибка запроса/отчёта — дальше поставим заглушку, чтобы строка не зависла
            record.message = error && error.message ? error.message : 'Не удалось обработать строку.';
            return null;
        }).then(function(picked) {
            if (picked && picked.our) {
                record.our = picked.our;
                record.candidates = picked.candidates;
                record.accuracy = computeAccuracy(record.rfpName || record.label, picked.our.label, picked.tokens, picked.tma);
            } else {
                // нет совпадений (picked.our пуст) или ошибка отчёта (picked === null) —
                // пишем заглушку «Наш артикул», иначе строка зависнет в пустом состоянии
                // и будет попадать в каждую следующую пачку.
                record.our = placeholderOur(picked ? 'нет совпадений' : '');
                record.candidates = [];
                record.accuracy = 0;
            }

            return writeBack(record).then(function() {
                record.status = (picked === null) ? 'error' : 'done';
                updateRecordRow(record);
                updateProgress();
                recordOutcome(record);
            });
        }).catch(function(error) {
            // ошибка записи результата — не зацикливаемся, просто помечаем строку ошибкой
            record.status = 'error';
            record.message = record.message || (error && error.message) || 'Не удалось записать результат.';
            updateRecordRow(record);
            updateProgress();
            recordOutcome(record);
        });
    }

    // Значение SKU для записи в строку RFP: артикул, фоллбэк на ID, если артикул пуст (issue #3547).
    // Тот же выбор, что и в отображении (skuCell: item.article || item.id) — храним то, что видно.
    // У заглушки «нет совпадений» артикула нет, поэтому пишется её id ('0') — маркер обработанной строки.
    function skuStoredValue(item) {
        if (!item) return '';
        return trimValue(item.article) || trimValue(item.id);
    }

    // Собрать значения для _m_set по строке RFP: «Наш артикул», «Кандидаты», «Точность подбора».
    // Выделено из writeBack для тестируемости (issue #3547) — чистая функция без сетевых запросов.
    function buildWriteValues(record) {
        var fields = state.fields;
        var values = {};

        if (fields.our && record.our) {
            var ourValue = skuStoredValue(record.our);
            if (ourValue) values[fields.our.id] = ourValue;
        }
        if (fields.candidates && record.candidates && record.candidates.length) {
            var candidateValues = record.candidates.map(skuStoredValue).filter(Boolean);
            if (candidateValues.length) {
                values[fields.candidates.id] = candidateValues.join(', ');
            }
        }
        if (fields.accuracy && record.accuracy != null) {
            values[fields.accuracy.id] = record.accuracy;
        }
        return values;
    }

    // Записать результат в строку RFP ОДНИМ запросом _m_set (issue #3512): «Наш артикул»,
    // «Кандидаты», «Точность подбора» — все три поля сразу, а не по одному. Обе колонки текстовые:
    // «Наш артикул» (type 3, ref=null) — артикул первого SKU (или заглушка '0' для несопоставленных);
    // «Кандидаты» (type 8, строка) — артикулы остальных SKU через запятую с пробелом (issue #3547,
    // раньше хранились SKUID — #3519).
    function writeBack(record) {
        var values = buildWriteValues(record);
        if (!Object.keys(values).length) return Promise.resolve();
        return postSetMany(record.id, values);
    }

    // --- Пул обработки (не более N одновременно) -----------------------------

    // Обработать все необработанные строки ТЕКУЩЕЙ пачки пулом (не более concurrency сразу).
    // Возвращает Promise, который резолвится по завершении пачки или по запросу «Стоп».
    function processCurrentBatch() {
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
        });
    }

    // Авто-обработка (issue #3512): обработать пачку, затем автоматически подгрузить следующие
    // batchSize строк и так далее, пока не нажмут «Стоп» или сервер не вернёт пустой список.
    function runAuto() {
        if (state.running || !state.records.length) return;
        state.running = true;
        state.stopRequested = false;
        state.seenIds = {};
        state.outcomes = {};
        state.startTime = Date.now();
        state.endTime = 0;
        // сброс авто-регулировки потоков на каждый прогон (issue #3527, #3549)
        state.prevSpeed = null;
        state.maxSpeed = null;
        state.lastTuneUp = false;
        state.tuneCooldown = 0;
        setHidden('xcom-mass-stats', false);
        renderStats();
        renderConcurrency();
        startStatsTimer();
        setControls('running');

        function iterate() {
            if (state.stopRequested) return Promise.resolve();

            // если в текущей пачке остались необработанные — доедаем её; иначе грузим следующую
            var hasPending = state.records.some(function(r) { return r.status === 'pending'; });
            var prepared;
            if (hasPending) {
                prepared = Promise.resolve(state.records.length);
            } else {
                setText('xcom-mass-summary', 'Загрузка следующей пачки…');
                prepared = fetchBatch().then(function(count) {
                    if (count < 0) return 0;          // запрос устарел
                    renderList();
                    // защита от зацикливания: если ни одной новой строки (все уже пытались
                    // обработать в этом прогоне) — дальше нет смысла, останавливаемся
                    var fresh = state.records.some(function(r) { return !state.seenIds[r.id]; });
                    return fresh ? count : 0;
                });
            }

            return prepared.then(function(count) {
                if (state.stopRequested) return;
                if (!count || !state.records.length) return;   // пустой список → конец
                state.records.forEach(function(r) { state.seenIds[r.id] = true; });
                var batchStart = Date.now();
                var batchStartCount = Object.keys(state.outcomes).length;
                return processCurrentBatch().then(function() {
                    if (state.stopRequested) return;
                    // замер скорости пачки и авто-регулировка числа потоков (issue #3527)
                    if (state.autoConcurrency) {
                        var elapsed = Date.now() - batchStart;
                        var batchCount = Object.keys(state.outcomes).length - batchStartCount;
                        if (batchCount > 0 && elapsed > 0) {
                            tuneConcurrency(batchCount / (elapsed / 1000));
                            renderConcurrency();
                        }
                    }
                    return iterate();
                });
            });
        }

        return iterate().then(function() {
            state.running = false;
            state.endTime = Date.now();
            stopStatsTimer();
            renderStats();
            setControls('idle');
            updateProgress();
            var processed = Object.keys(state.outcomes).length;
            setText('xcom-mass-summary', (state.stopRequested ? 'Остановлено' : 'Готово') +
                ' · обработано за прогон: ' + processed + ' за ' + formatDuration(state.endTime - state.startTime));
            if (!state.records.length) renderList();
        });
    }

    function stopBatch() {
        if (!state.running) return;
        state.stopRequested = true;
        setText('xcom-mass-progress-label', 'Остановка…');
    }

    // --- Загрузка пачки ------------------------------------------------------

    // Необработанная строка — пустое поле «Наш артикул» (его заполняет writeBack при обработке).
    // Уже обработанные пропускаем: иначе повторно дублировались бы «Кандидаты».
    function isUnprocessed(record) {
        var index = state.fields.our ? state.fields.our.index : -1;
        if (index < 0) return true;
        return trimValue(record.values[index]) === '';
    }

    // Запросить одну пачку необработанных строк RFP в state.records (один запрос; серверный
    // фильтр в buildScanUrl сам отдаёт только строки с пустым «Наш артикул»). Возвращает их
    // число, либо -1 если запрос устарел (стартовала более новая загрузка по loadToken).
    function fetchBatch() {
        var token = ++state.loadToken;
        state.records = [];
        return fetchJson(buildScanUrl(state.batchSize)).then(function(json) {
            if (token !== state.loadToken) return -1;
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
            return collected.length;
        });
    }

    // Ручная загрузка пачки (кнопка «Обновить» и первичная загрузка). По мере обработки строки
    // получают «Наш артикул» и выпадают из выборки — следующее «Обновить» вернёт новую пачку.
    function loadBatch() {
        setControls('loading');
        renderMessage('Загрузка строк RFP…', 'loading');
        setText('xcom-mass-summary', 'Загрузка…');

        return fetchBatch().then(function(count) {
            if (count < 0) return;
            renderList();
            setText('xcom-mass-summary', count + ' необработанных');
            setControls('idle');
            updateProgress();
        }).catch(function(error) {
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

    // Подсказка о пачке/потоках (issue #3522: число потоков; #3527: авто-регулировка).
    function updateBatchHint() {
        setText('xcom-mass-batch-hint', 'Пачка по ' + state.batchSize +
            ', потоков ' + state.concurrency + (state.autoConcurrency ? ' (авто-регулировка по скорости)' : '') +
            '; «Старт» обрабатывает пачки подряд до пустого списка или «Стоп»');
    }

    // Применить состояние авто-регулировки к UI: селектор потоков активен только в ручном режиме.
    function applyAutoConcurrency() {
        setDisabled('xcom-mass-concurrency', state.autoConcurrency);
        renderConcurrency();
    }

    function bindEvents() {
        var reload = document.getElementById('xcom-mass-reload');
        var start = document.getElementById('xcom-mass-start');
        var stop = document.getElementById('xcom-mass-stop');
        var concurrency = document.getElementById('xcom-mass-concurrency');
        var auto = document.getElementById('xcom-mass-auto');
        var keyword = document.getElementById('xcom-mass-keyword');

        if (reload) reload.addEventListener('click', function() {
            if (state.running) return;
            loadBatch();
        });
        // Ключевое слово фильтра по «Наименованию» RFP (issue #3523): применяется по Enter/blur/
        // очистке (события change/search у input[type=search]); пустое слово = без фильтра.
        if (keyword) {
            var applyKeyword = function() {
                if (state.running) return;
                var value = trimValue(keyword.value);
                if (value === state.keyword) return;   // без изменений — не перезагружаем
                state.keyword = value;
                loadBatch();
            };
            keyword.addEventListener('change', applyKeyword);
            keyword.addEventListener('search', applyKeyword);
        }
        if (start) start.addEventListener('click', function() {
            runAuto();
        });
        if (stop) stop.addEventListener('click', function() {
            stopBatch();
        });
        // Число одновременных запросов можно менять в любой момент — пул читает state.concurrency
        // на каждом шаге, поэтому увеличение подхватывается по мере завершения строк.
        if (concurrency) concurrency.addEventListener('change', function() {
            var value = parseInt(concurrency.value, 10);
            if (!isNaN(value) && value > 0) {
                state.concurrency = value;
                renderConcurrency();
            }
        });
        // Авто-регулировка потоков (issue #3527): в авто-режиме селектор — лишь стартовое значение.
        if (auto) auto.addEventListener('change', function() {
            state.autoConcurrency = !!auto.checked;
            applyAutoConcurrency();
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
        var autoAttr = trimValue(root.getAttribute('data-auto-concurrency')).toLowerCase();
        state.autoConcurrency = !(autoAttr === '0' || autoAttr === 'false' || autoAttr === 'off');
        state.maxCandidates = num('data-max-candidates', DEFAULT_MAX_CANDIDATES);
        state.placeholderOurId = str('data-placeholder-our-id', DEFAULT_PLACEHOLDER_OUR_ID);
        state.skuIdKey = str('data-sku-id-field', DEFAULT_SKU_ID_KEY);
        state.skuLabelKey = str('data-sku-field', DEFAULT_SKU_LABEL_KEY);
        state.skuArticleKey = str('data-sku-article-field', DEFAULT_SKU_ARTICLE_KEY);
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
        // синхронизировать переключатель потоков с конфигом (по умолчанию 5)
        var sel = document.getElementById('xcom-mass-concurrency');
        if (sel) sel.value = String(state.concurrency);
        var auto = document.getElementById('xcom-mass-auto');
        if (auto) auto.checked = state.autoConcurrency;
        applyAutoConcurrency();   // селектор активен только в ручном режиме + плитка «потоков»
        updateBatchHint();
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
        ourCell: ourCell,
        candidatesCell: candidatesCell,
        skuStoredValue: skuStoredValue,
        buildWriteValues: buildWriteValues,
        buildMatchUrl: buildMatchUrl,
        buildScanUrl: buildScanUrl,
        tuneConcurrency: tuneConcurrency,
        _state: state,
        init: init
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : {});
