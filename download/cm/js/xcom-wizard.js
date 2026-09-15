(function(window, document) {
    'use strict';

    var ROLES = [
        { id: 'name', label: 'Наименование', hint: 'Текст для токенизации', aliases: ['наименование', 'название', 'товар', 'продукт', 'позиция', 'description', 'name', 'title'] },
        { id: 'article', label: 'Артикул', hint: 'Код или артикул позиции', aliases: ['артикул', 'код товара', 'sku', 'vendor code', 'article', 'part number'] },
        { id: 'brand', label: 'Бренд', hint: 'Производитель или торговая марка', aliases: ['бренд', 'марка', 'производитель', 'brand', 'vendor', 'manufacturer'] },
        { id: 'model', label: 'Модель', hint: 'Модель, серия или исполнение', aliases: ['модель', 'серия', 'model', 'series'] },
        { id: 'type', label: 'Тип', hint: 'Тип или вид товара', aliases: ['тип', 'вид', 'категория', 'type', 'category', 'kind'] },
        { id: 'size', label: 'Размер', hint: 'Размер, диаметр или формат', aliases: ['размер', 'диаметр', 'формат', 'габарит', 'size', 'diameter', 'dimension'] }
    ];

    var state = {
        root: null,
        db: '',
        step: 1,
        startedAt: 0,
        timer: null,
        books: { rfp: null, sku: null },
        files: { rfp: null, sku: null },
        sheets: { rfp: '', sku: '' },
        datasets: { rfp: null, sku: null },
        mappings: { rfp: {}, sku: {} },
        rules: [],
        saving: false
    };

    function trimValue(value) {
        return String(value == null ? '' : value).trim();
    }

    function normalizeHeader(value) {
        return trimValue(value).toLowerCase()
            .replace(/ё/g, 'е')
            .replace(/[^0-9a-zа-я]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function nonEmpty(values) {
        return (values || []).map(trimValue).filter(Boolean);
    }

    function roleScore(header, samples, role) {
        var name = normalizeHeader(header);
        var score = 0;
        role.aliases.forEach(function(alias) {
            var normalized = normalizeHeader(alias);
            if (name === normalized) score = Math.max(score, 100);
            else if (name.indexOf(normalized) >= 0 || normalized.indexOf(name) >= 0) score = Math.max(score, 72);
        });
        var values = nonEmpty(samples).slice(0, 30);
        if (!values.length) return score;
        if (role.id === 'article') {
            var codes = values.filter(function(value) {
                return /\d/.test(value) && /^[0-9a-zа-я._\-/\s]+$/i.test(value) && value.length <= 40;
            }).length;
            score += Math.round(codes / values.length * 18);
        }
        if (role.id === 'model') {
            var models = values.filter(function(value) { return /[a-zа-я]/i.test(value) && /\d/.test(value) && value.length <= 50; }).length;
            score += Math.round(models / values.length * 13);
        }
        if (role.id === 'name') {
            var avg = values.reduce(function(sum, value) { return sum + value.length; }, 0) / values.length;
            if (avg > 18) score += 16;
        }
        if (role.id === 'brand' || role.id === 'type') {
            var unique = {};
            values.forEach(function(value) { unique[normalizeHeader(value)] = true; });
            var ratio = Object.keys(unique).length / values.length;
            if (ratio < 0.55) score += 8;
        }
        return score;
    }

    function suggestMapping(headers, rows) {
        var result = {};
        var used = {};
        ROLES.forEach(function(role) {
            var best = { header: '', score: 0 };
            (headers || []).forEach(function(header) {
                if (used[header]) return;
                var samples = (rows || []).map(function(row) { return row && row[header]; });
                var score = roleScore(header, samples, role);
                if (score > best.score) best = { header: header, score: score };
            });
            if (best.score >= 35) {
                result[role.id] = best.header;
                used[best.header] = true;
            }
        });
        return result;
    }

    function matrixToDataset(matrix) {
        var rows = Array.isArray(matrix) ? matrix : [];
        var headerIndex = -1;
        for (var i = 0; i < rows.length; i++) {
            if (nonEmpty(rows[i]).length) { headerIndex = i; break; }
        }
        if (headerIndex < 0) return { headers: [], rows: [], headerRow: 0, totalRows: 0 };
        var seen = {};
        var headers = (rows[headerIndex] || []).map(function(value, index) {
            var base = trimValue(value) || ('Колонка ' + (index + 1));
            var name = base;
            var suffix = 2;
            while (seen[normalizeHeader(name)]) name = base + ' ' + suffix++;
            seen[normalizeHeader(name)] = true;
            return name;
        });
        var objects = rows.slice(headerIndex + 1).filter(function(row) { return nonEmpty(row).length; }).map(function(row) {
            var object = {};
            headers.forEach(function(header, index) { object[header] = row[index] == null ? '' : row[index]; });
            return object;
        });
        return { headers: headers, rows: objects, headerRow: headerIndex + 1, totalRows: objects.length };
    }

    function sheetToDataset(workbook, sheetName, xlsx) {
        if (!workbook || !workbook.Sheets || !workbook.Sheets[sheetName]) return matrixToDataset([]);
        var matrix = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
        return matrixToDataset(matrix);
    }

    function buildRules(mappings) {
        return ROLES.filter(function(role) {
            return role.id !== 'name' && role.id !== 'article' &&
                mappings.rfp[role.id] && mappings.sku[role.id];
        }).map(function(role) {
            return {
                role: role.id,
                label: role.label,
                rfp_key: role.label + ' RFP',
                sku_key: role.label + ' SKU',
                required: role.id === 'brand' || role.id === 'model',
                weight: role.id === 'type' || role.id === 'size' ? 0.15 : 0.1
            };
        });
    }

    function buildMatchingConfig(input) {
        var rules = input.rules || [];
        return {
            schema_version: 1,
            category: trimValue(input.category),
            preset: trimValue(input.preset),
            tma_weight: Math.max(0, Math.min(1, Number(input.tma_weight) || 0)),
            attribute_weights: rules.filter(function(rule) { return Number(rule.weight) > 0; }).map(function(rule) {
                return { rfp_key: rule.rfp_key, sku_key: rule.sku_key, weight: Math.max(0, Math.min(1, Number(rule.weight))) };
            }),
            required_attributes: rules.filter(function(rule) { return !!rule.required; }).map(function(rule) {
                return { rfp_key: rule.rfp_key, sku_key: rule.sku_key };
            }),
            column_mapping: {
                rfp: Object.assign({}, input.mappings && input.mappings.rfp || {}),
                sku: Object.assign({}, input.mappings && input.mappings.sku || {})
            },
            llm: { enabled: false, gray_zone_min: 45, gray_zone_max: 75 },
            decision_log: { enabled: true, table_name: 'Решение по паре' }
        };
    }

    function findTable(tables, name) {
        return (tables || []).filter(function(table) {
            return normalizeHeader(table && (table.val || table.name)) === normalizeHeader(name);
        })[0] || null;
    }

    function targetFieldName(side, roleId) {
        if (roleId === 'name') return 'Наименование';
        if (roleId === 'article') return side === 'rfp' ? 'Артикул поставщика' : 'Артикул';
        var role = ROLES.filter(function(item) { return item.id === roleId; })[0];
        return role ? role.label : '';
    }

    function fieldId(table, name) {
        if (normalizeHeader(table && (table.val || table.name)) === normalizeHeader(name)) return String(table.id);
        var req = (table && table.reqs || []).filter(function(item) {
            return normalizeHeader(item && (item.val || item.name)) === normalizeHeader(name);
        })[0];
        return req ? String(req.id) : '';
    }

    function buildUploadSetting(side, dataset, mapping, table, sheetName) {
        if (!dataset || !table) throw new Error('Не хватает структуры файла или таблицы ' + side.toUpperCase() + '.');
        var importMap = {};
        ROLES.forEach(function(role) {
            var header = mapping && mapping[role.id];
            if (!header) return;
            var target = targetFieldName(side, role.id);
            var targetId = role.id === 'name' ? String(table.id) : fieldId(table, target);
            var sourceIndex = dataset.headers.indexOf(header);
            if (!targetId) throw new Error('В таблице «' + (table.val || table.name) + '» нет поля «' + target + '».');
            if (sourceIndex >= 0) importMap[targetId] = sourceIndex;
        });
        return {
            type: String(table.id),
            name: String(table.val || table.name || side.toUpperCase()),
            header: 1,
            trim: 1,
            delimiter: '',
            newline: '',
            importMap: importMap,
            formulas: {},
            createParent: 0,
            xlsx: { sheet: sheetName || '', r0: Math.max(0, Number(dataset.headerRow || 1) - 1), c0: 0, r1: null, c1: null }
        };
    }

    function buildMappingRows(input) {
        var category = trimValue(input.category) || 'Без категории';
        var result = [];
        ['rfp', 'sku'].forEach(function(side) {
            ROLES.forEach(function(role) {
                var required = (input.rules || []).some(function(rule) { return rule.role === role.id && rule.required; });
                result.push({
                    key: category + ':' + side + ':' + role.id,
                    category: category,
                    side: side.toUpperCase(),
                    role: role.label,
                    source: input.mappings && input.mappings[side] && input.mappings[side][role.id] || '',
                    target: targetFieldName(side, role.id),
                    required: required ? '1' : '0',
                    file: input.files && input.files[side] && input.files[side].name || '',
                    sheet: input.sheets && input.sheets[side] || '',
                    rows: input.datasets && input.datasets[side] && input.datasets[side].totalRows || 0
                });
            });
        });
        return result;
    }

    function validateStep(step, current) {
        var context = current || state;
        if (step === 1) {
            if (!context.datasets.rfp || !context.datasets.sku) return 'Выберите и разберите оба файла.';
            if (!context.datasets.rfp.totalRows || !context.datasets.sku.totalRows) return 'В одном из выбранных листов нет строк данных.';
        }
        if (step === 2) {
            if (!context.mappings.rfp.name || !context.mappings.sku.name) return 'Укажите колонку «Наименование» для RFP и SKU.';
        }
        if (step === 4) {
            var confirmed = document.getElementById && document.getElementById('xcom-wizard-confirm');
            if (confirmed && !confirmed.checked) return 'Подтвердите проверку колонок и обязательных атрибутов.';
        }
        return '';
    }

    function setStatus(text, kind) {
        var el = document.getElementById('xcom-wizard-status');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'xcom-wizard-status' + (kind ? ' is-' + kind : '');
    }

    function formatDuration(ms) {
        var seconds = Math.max(0, Math.floor(ms / 1000));
        var minutes = Math.floor(seconds / 60);
        seconds %= 60;
        return (minutes < 10 ? '0' : '') + minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
    }

    function updateTimer() {
        var el = document.getElementById('xcom-wizard-timer');
        if (el) el.textContent = formatDuration(Date.now() - state.startedAt);
    }

    function renderFileSummary(side) {
        var dataset = state.datasets[side];
        var file = state.files[side];
        var el = document.getElementById('xcom-wizard-' + side + '-summary');
        if (!el) return;
        if (!dataset) { el.textContent = 'Файл не выбран'; return; }
        el.textContent = (file ? file.name + '. ' : '') + dataset.totalRows + ' строк, ' + dataset.headers.length +
            ' колонок. Заголовок в строке ' + dataset.headerRow + '.';
    }

    function refreshDataset(side) {
        var select = document.getElementById('xcom-wizard-' + side + '-sheet');
        var book = state.books[side];
        if (!book || !select || !select.value) return;
        state.sheets[side] = select.value;
        state.datasets[side] = sheetToDataset(book, select.value, window.XLSX);
        state.mappings[side] = suggestMapping(state.datasets[side].headers, state.datasets[side].rows);
        renderFileSummary(side);
        updateActions();
    }

    function parseFile(side, file) {
        if (!file) return;
        if (!window.XLSX) { setStatus('Библиотека чтения Excel не загрузилась. Обновите страницу.', 'error'); return; }
        setStatus('Разбираю файл «' + file.name + '»…');
        var read = file.arrayBuffer ? file.arrayBuffer() : new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function() { resolve(reader.result); };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
        read.then(function(buffer) {
            var book = window.XLSX.read(buffer, { type: 'array', cellDates: true });
            state.files[side] = file;
            state.books[side] = book;
            var select = document.getElementById('xcom-wizard-' + side + '-sheet');
            select.innerHTML = '';
            book.SheetNames.forEach(function(name) {
                var option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                select.appendChild(option);
            });
            select.disabled = false;
            select.value = book.SheetNames[0] || '';
            refreshDataset(side);
            setStatus('Файл «' + file.name + '» готов.');
        }).catch(function(error) {
            setStatus('Не удалось прочитать «' + file.name + '»: ' + (error.message || error), 'error');
        });
    }

    function optionHtml(headers, selected) {
        return '<option value="">Не использовать</option>' + (headers || []).map(function(header) {
            return '<option value="' + escapeHtml(header) + '"' + (header === selected ? ' selected' : '') + '>' + escapeHtml(header) + '</option>';
        }).join('');
    }

    function renderMapping() {
        var el = document.getElementById('xcom-wizard-mapping');
        if (!el) return;
        el.innerHTML = ROLES.map(function(role) {
            return '<div class="xcom-wizard-map-row" data-role="' + role.id + '">' +
                '<div class="xcom-wizard-map-label"><b>' + role.label + '</b><span>' + role.hint + '</span></div>' +
                '<select data-side="rfp" aria-label="RFP: ' + role.label + '">' + optionHtml(state.datasets.rfp.headers, state.mappings.rfp[role.id]) + '</select>' +
                '<select data-side="sku" aria-label="SKU: ' + role.label + '">' + optionHtml(state.datasets.sku.headers, state.mappings.sku[role.id]) + '</select>' +
                '</div>';
        }).join('');
        el.querySelectorAll('select').forEach(function(select) {
            select.addEventListener('change', function() {
                var role = select.closest('[data-role]').getAttribute('data-role');
                state.mappings[select.getAttribute('data-side')][role] = select.value;
                updateActions();
            });
        });
        renderPreview();
    }

    function renderPreview() {
        var el = document.getElementById('xcom-wizard-preview-table');
        if (!el) return;
        function table(side) {
            var dataset = state.datasets[side];
            var headers = dataset.headers.slice(0, 8);
            return '<strong>' + (side === 'rfp' ? 'RFP' : 'SKU') + '</strong><table><thead><tr>' +
                headers.map(function(header) { return '<th>' + escapeHtml(header) + '</th>'; }).join('') +
                '</tr></thead><tbody>' + dataset.rows.slice(0, 3).map(function(row) {
                    return '<tr>' + headers.map(function(header) { return '<td>' + escapeHtml(row[header]) + '</td>'; }).join('') + '</tr>';
                }).join('') + '</tbody></table>';
        }
        el.innerHTML = table('rfp') + table('sku');
    }

    function renderPresetOptions() {
        var select = document.getElementById('xcom-wizard-preset');
        if (!select) return;
        select.innerHTML = '<option value="">Без пресета</option>';
        var presets = window.XcomMatchingPresets && window.XcomMatchingPresets.presets || [];
        presets.forEach(function(preset) {
            var option = document.createElement('option');
            option.value = preset.id;
            option.textContent = preset.name + (preset.status === 'starter' ? ' (стартовый)' : '');
            select.appendChild(option);
        });
    }

    function applySelectedPreset() {
        var select = document.getElementById('xcom-wizard-preset');
        var presets = window.XcomMatchingPresets;
        var preset = presets && presets.findPreset(select && select.value);
        if (!preset) return;
        var category = document.getElementById('xcom-wizard-category');
        var tma = document.getElementById('xcom-wizard-tma-weight');
        if (category) category.value = preset.config.category || '';
        if (tma) tma.value = String(preset.config.tma_weight);
        state.rules.forEach(function(rule) {
            rule.required = (preset.config.required_attributes || []).some(function(attr) {
                return attr.rfp_key === rule.rfp_key && attr.sku_key === rule.sku_key;
            });
            var weighted = (preset.config.attribute_weights || []).filter(function(attr) {
                return attr.rfp_key === rule.rfp_key && attr.sku_key === rule.sku_key;
            })[0];
            rule.weight = weighted ? weighted.weight : 0;
        });
        renderRules();
        setStatus('Пресет применён. Проверьте правила на данных клиента.');
    }

    function renderRules() {
        var el = document.getElementById('xcom-wizard-rules');
        if (!el) return;
        if (!state.rules.length) {
            el.innerHTML = '<p>Парные атрибуты не найдены. Вернитесь на шаг 2 и укажите бренд, модель, тип или размер.</p>';
            return;
        }
        el.innerHTML = state.rules.map(function(rule, index) {
            return '<div class="xcom-wizard-rule" data-rule-index="' + index + '">' +
                '<div><b>' + escapeHtml(rule.label) + '</b><br><small>' + escapeHtml(rule.rfp_key + ' ↔ ' + rule.sku_key) + '</small></div>' +
                '<label><input class="xcom-wizard-rule-required" type="checkbox"' + (rule.required ? ' checked' : '') + '>Обязательное совпадение</label>' +
                '<label><span class="sr-only">Вес</span><input class="xcom-wizard-rule-weight" type="number" min="0" max="1" step="0.05" value="' + escapeHtml(rule.weight) + '"></label>' +
                '</div>';
        }).join('');
        el.querySelectorAll('[data-rule-index]').forEach(function(row) {
            var index = Number(row.getAttribute('data-rule-index'));
            row.querySelector('.xcom-wizard-rule-required').addEventListener('change', function(event) {
                state.rules[index].required = event.target.checked;
            });
            row.querySelector('.xcom-wizard-rule-weight').addEventListener('change', function(event) {
                state.rules[index].weight = Math.max(0, Math.min(1, Number(event.target.value) || 0));
            });
        });
    }

    function currentConfig() {
        return buildMatchingConfig({
            category: document.getElementById('xcom-wizard-category').value,
            preset: document.getElementById('xcom-wizard-preset').value,
            tma_weight: document.getElementById('xcom-wizard-tma-weight').value,
            mappings: state.mappings,
            rules: state.rules
        });
    }

    function renderReview() {
        var config = currentConfig();
        var required = config.required_attributes.map(function(attr) { return attr.rfp_key.replace(/ RFP$/, ''); });
        var el = document.getElementById('xcom-wizard-review');
        if (!el) return;
        el.innerHTML = '<dl><dt>RFP</dt><dd>' + escapeHtml(state.files.rfp.name) + ', ' + state.datasets.rfp.totalRows + ' строк</dd>' +
            '<dt>SKU</dt><dd>' + escapeHtml(state.files.sku.name) + ', ' + state.datasets.sku.totalRows + ' строк</dd></dl>' +
            '<dl><dt>Категория</dt><dd>' + escapeHtml(config.category || 'Не указана') + '</dd>' +
            '<dt>Обязательные атрибуты</dt><dd>' + escapeHtml(required.join(', ') || 'Нет') + '</dd>' +
            '<dt>Вес артикула</dt><dd>' + escapeHtml(config.tma_weight) + '</dd></dl>';
    }

    function renderStep() {
        document.querySelectorAll('.xcom-wizard-step').forEach(function(section) {
            section.hidden = Number(section.getAttribute('data-step')) !== state.step;
        });
        document.querySelectorAll('[data-step-marker]').forEach(function(marker) {
            var number = Number(marker.getAttribute('data-step-marker'));
            marker.removeAttribute('aria-current');
            marker.classList.toggle('is-complete', number < state.step);
            if (number === state.step) marker.setAttribute('aria-current', 'step');
        });
        if (state.step === 2) renderMapping();
        if (state.step === 3) {
            state.rules = buildRules(state.mappings).map(function(rule) {
                var previous = state.rules.filter(function(old) { return old.role === rule.role; })[0];
                return previous || rule;
            });
            renderRules();
        }
        if (state.step === 4) renderReview();
        updateActions();
    }

    function updateActions() {
        var back = document.getElementById('xcom-wizard-back');
        var next = document.getElementById('xcom-wizard-next');
        var save = document.getElementById('xcom-wizard-save');
        var hint = document.getElementById('xcom-wizard-action-hint');
        var error = validateStep(state.step, state);
        back.hidden = state.step === 1;
        next.hidden = state.step === 4;
        save.hidden = state.step !== 4;
        next.disabled = !!error;
        save.disabled = !!error || state.saving;
        hint.textContent = error || (state.step === 4 ? 'Профиль готов к сохранению.' : 'Предложения можно изменить вручную.');
    }

    function encodePath(value) {
        return encodeURIComponent(String(value == null ? '' : value));
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
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: '_xsrf=' + encodeURIComponent(window.xsrf || '') + '&' + params
        }).then(function(response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.text();
        });
    }

    function settingsDescriptor() {
        return fetchJson('/' + encodePath(state.db) + '/metadata').then(function(payload) {
            var tables = Array.isArray(payload) ? payload : [payload];
            var table = tables.filter(function(item) { return normalizeHeader(item && (item.val || item.name)) === normalizeHeader('Настройка сопоставления'); })[0];
            if (!table) throw new Error('Таблица «Настройка сопоставления» не найдена. Сначала запустите инсталлятор.');
            var req = (table.reqs || []).filter(function(item) {
                return normalizeHeader(item && (item.val || item.name)) === normalizeHeader('Значение') || /alias\s*=\s*Значение/i.test(item && item.attrs || '');
            })[0];
            if (!req) throw new Error('В настройках нет реквизита «Значение».');
            return fetchJson('/' + encodePath(state.db) + '/object/' + encodePath(table.id) + '/?JSON_OBJ&LIMIT=0,50').then(function(rows) {
                return { tableId: String(table.id), valueReqId: String(req.id), rows: Array.isArray(rows) ? rows : [], tables: tables };
            });
        });
    }

    function upsertSetting(descriptor, key, value) {
        var found = descriptor.rows.filter(function(row) { return normalizeHeader(row && row.r && row.r[0]) === normalizeHeader(key); })[0];
        var json = JSON.stringify(value);
        if (found) {
            return post('/' + encodePath(state.db) + '/_m_set/' + encodePath(found.i) + '?JSON=1',
                't' + encodeURIComponent(descriptor.valueReqId) + '=' + encodeURIComponent(json));
        }
        return post('/' + encodePath(state.db) + '/_m_new/' + encodePath(descriptor.tableId) + '?JSON=1',
            'up=1&t' + encodeURIComponent(descriptor.tableId) + '=' + encodeURIComponent(key) +
            '&t' + encodeURIComponent(descriptor.valueReqId) + '=' + encodeURIComponent(json));
    }

    function loadUploadSettings() {
        return fetchJson('/' + encodePath(state.db) + '/object/269/?JSON_OBJ&LIMIT=0,200&F_271=UPLOAD').then(function(rows) {
            return Array.isArray(rows) ? rows : [];
        });
    }

    function upsertUploadSetting(rows, name, value) {
        var found = (rows || []).filter(function(row) { return normalizeHeader(row && row.r && row.r[0]) === normalizeHeader(name); })[0];
        var json = JSON.stringify(value);
        if (found) return post('/' + encodePath(state.db) + '/_m_set/' + encodePath(found.i) + '?JSON=1', 't273=' + encodeURIComponent(json));
        return post('/' + encodePath(state.db) + '/_m_new/269?JSON=1',
            'up=1&t271=UPLOAD&t269=' + encodeURIComponent(name) + '&t273=' + encodeURIComponent(json));
    }

    function saveMappingRows(tables, rows) {
        var table = findTable(tables, 'Профиль загрузки');
        if (!table) return Promise.reject(new Error('Таблица «Профиль загрузки» не найдена. Обновите шаблон установщиком.'));
        var names = ['Категория', 'Сторона', 'Роль', 'Колонка Excel', 'Поле Интеграма', 'Обязательное', 'Файл', 'Лист', 'Строк'];
        var ids = {};
        names.forEach(function(name) { ids[name] = fieldId(table, name); });
        return fetchJson('/' + encodePath(state.db) + '/object/' + encodePath(table.id) + '/?JSON_OBJ&LIMIT=0,500').then(function(existing) {
            var chain = Promise.resolve();
            rows.forEach(function(row) {
                chain = chain.then(function() {
                    var found = (Array.isArray(existing) ? existing : []).filter(function(item) {
                        return normalizeHeader(item && item.r && item.r[0]) === normalizeHeader(row.key);
                    })[0];
                    var fields = {
                        'Категория': row.category, 'Сторона': row.side, 'Роль': row.role,
                        'Колонка Excel': row.source, 'Поле Интеграма': row.target,
                        'Обязательное': row.required, 'Файл': row.file, 'Лист': row.sheet, 'Строк': row.rows
                    };
                    var params = Object.keys(fields).map(function(name) {
                        return 't' + encodeURIComponent(ids[name]) + '=' + encodeURIComponent(fields[name]);
                    }).join('&');
                    if (found) return post('/' + encodePath(state.db) + '/_m_set/' + encodePath(found.i) + '?JSON=1', params);
                    return post('/' + encodePath(state.db) + '/_m_new/' + encodePath(table.id) + '?JSON=1',
                        'up=1&t' + encodeURIComponent(table.id) + '=' + encodeURIComponent(row.key) + '&' + params);
                });
            });
            return chain;
        });
    }

    function saveProfile() {
        var error = validateStep(4, state);
        if (error || state.saving) { if (error) setStatus(error, 'error'); return; }
        state.saving = true;
        updateActions();
        setStatus('Сохраняю конфиг и профиль загрузки…');
        var config = currentConfig();
        var profile = {
            schema_version: 1,
            saved_at: new Date().toISOString(),
            setup_seconds: Math.round((Date.now() - state.startedAt) / 1000),
            files: {
                rfp: { name: state.files.rfp.name, sheet: state.sheets.rfp, rows: state.datasets.rfp.totalRows },
                sku: { name: state.files.sku.name, sheet: state.sheets.sku, rows: state.datasets.sku.totalRows }
            },
            column_mapping: config.column_mapping
        };
        settingsDescriptor().then(function(descriptor) {
            var rfpTable = findTable(descriptor.tables, 'RFP');
            var skuTable = findTable(descriptor.tables, 'SKU');
            var suffix = config.category ? ' — ' + config.category : '';
            var uploadNames = { rfp: 'Сопоставление RFP' + suffix, sku: 'Сопоставление SKU' + suffix };
            var uploadProfiles = {
                rfp: buildUploadSetting('rfp', state.datasets.rfp, state.mappings.rfp, rfpTable, state.sheets.rfp),
                sku: buildUploadSetting('sku', state.datasets.sku, state.mappings.sku, skuTable, state.sheets.sku)
            };
            profile.upload_settings = uploadNames;
            return upsertSetting(descriptor, 'config', config).then(function() {
                return upsertSetting(descriptor, 'wizard_profile', profile);
            }).then(loadUploadSettings).then(function(uploadRows) {
                return upsertUploadSetting(uploadRows, uploadNames.rfp, uploadProfiles.rfp).then(function() {
                    return upsertUploadSetting(uploadRows, uploadNames.sku, uploadProfiles.sku);
                });
            }).then(function() {
                return saveMappingRows(descriptor.tables, buildMappingRows({
                    category: config.category, mappings: state.mappings, rules: state.rules,
                    files: state.files, sheets: state.sheets, datasets: state.datasets
                }));
            });
        }).then(function() {
            setStatus('Профиль и две настройки загрузки сохранены. Можно переходить к первому массовому прогону.', 'success');
            document.getElementById('xcom-wizard-action-hint').textContent = 'Настройка завершена за ' + formatDuration(Date.now() - state.startedAt) + '.';
            var mapping = document.getElementById('xcom-wizard-saved-mapping');
            if (mapping) mapping.hidden = false;
            if (window.xcomWizardMappingTable && typeof window.xcomWizardMappingTable.refreshData === 'function') {
                window.xcomWizardMappingTable.refreshData();
            }
        }).catch(function(errorSave) {
            setStatus(errorSave.message || 'Не удалось сохранить профиль.', 'error');
        }).then(function() {
            state.saving = false;
            updateActions();
        });
    }

    function bindEvents() {
        ['rfp', 'sku'].forEach(function(side) {
            var file = document.getElementById('xcom-wizard-' + side + '-file');
            var sheet = document.getElementById('xcom-wizard-' + side + '-sheet');
            file.addEventListener('change', function() { parseFile(side, file.files && file.files[0]); });
            sheet.addEventListener('change', function() { refreshDataset(side); });
        });
        document.getElementById('xcom-wizard-back').addEventListener('click', function() {
            if (state.step > 1) { state.step -= 1; setStatus(''); renderStep(); }
        });
        document.getElementById('xcom-wizard-next').addEventListener('click', function() {
            var error = validateStep(state.step, state);
            if (error) { setStatus(error, 'error'); return; }
            if (state.step < 4) { state.step += 1; setStatus(''); renderStep(); }
        });
        document.getElementById('xcom-wizard-preset').addEventListener('change', applySelectedPreset);
        document.getElementById('xcom-wizard-confirm').addEventListener('change', updateActions);
        document.getElementById('xcom-wizard-save').addEventListener('click', saveProfile);
    }

    function init() {
        state.root = document.getElementById('xcom-wizard-app');
        if (!state.root) return;
        state.db = state.root.getAttribute('data-db') || window.db || '';
        state.startedAt = Date.now();
        state.timer = setInterval(updateTimer, 1000);
        renderPresetOptions();
        bindEvents();
        renderStep();
        updateTimer();
    }

    var api = {
        roles: ROLES,
        normalizeHeader: normalizeHeader,
        roleScore: roleScore,
        suggestMapping: suggestMapping,
        matrixToDataset: matrixToDataset,
        sheetToDataset: sheetToDataset,
        buildRules: buildRules,
        buildMatchingConfig: buildMatchingConfig,
        targetFieldName: targetFieldName,
        buildUploadSetting: buildUploadSetting,
        buildMappingRows: buildMappingRows,
        validateStep: validateStep,
        formatDuration: formatDuration,
        _state: state,
        init: init
    };

    window.XcomWizardWorkspace = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : {});
