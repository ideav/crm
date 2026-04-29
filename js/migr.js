(function(root) {
    'use strict';

    const SETTINGS_TABLE_ID = '269';
    const SETTINGS_TYPE = 'migration';
    const QUERY_TABLE_ID = '22';
    const EXPORT_LIMIT = '0,100000';
    const TEXT_FILE_RE = /\.(html?|css|js|json|txt|md|xml|svg|csv|sql|php|py|conf|ya?ml)$/i;

    function toId(value) {
        if (value === null || value === undefined) return '';
        return String(value).trim();
    }

    function getDisplayValue(value) {
        if (value === null || value === undefined) return '';
        const text = String(value);
        const colon = text.indexOf(':');
        return colon > -1 ? text.slice(colon + 1) : text;
    }

    function normalizeSearch(value) {
        return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    function resolvedRuntimeValue() {
        for (let i = 0; i < arguments.length; i++) {
            const value = toId(arguments[i]);
            if (!value) continue;
            let decoded = value;
            try {
                decoded = decodeURIComponent(value);
            } catch (e) {
                decoded = value;
            }
            if (decoded.indexOf('{') === -1 && decoded.indexOf('}') === -1 && decoded.indexOf('_global_.') === -1) {
                return value;
            }
        }
        return '';
    }

    function dbFromLocation() {
        if (typeof window === 'undefined' || !window.location) return '';
        return (window.location.pathname.split('/').filter(Boolean)[0]) || '';
    }

    function decodeSegment(value) {
        const text = String(value || '').replace(/\+/g, ' ');
        try {
            return decodeURIComponent(text);
        } catch (e) {
            return text;
        }
    }

    function uniquePush(list, seen, item) {
        const id = toId(item.id);
        if (!id || seen.has(id)) return;
        seen.add(id);
        list.push(Object.assign({}, item, { id: id }));
    }

    function mapById(items) {
        const map = new Map();
        (items || []).forEach(function(item) {
            const id = toId(item.id);
            if (id) map.set(id, item);
        });
        return map;
    }

    function mapByName(items) {
        const map = new Map();
        (items || []).forEach(function(item) {
            const name = normalizeSearch(item.name || item.val || item.value);
            if (name) map.set(name, item);
        });
        return map;
    }

    function parseDependencyRefs(text, catalog) {
        const source = String(text || '');
        const tables = (catalog && catalog.tables) || [];
        const queries = (catalog && catalog.queries) || [];
        const tableById = mapById(tables);
        const queryById = mapById(queries);
        const queryByName = mapByName(queries);
        const result = { tables: [], queries: [] };
        const seenTables = new Set();
        const seenQueries = new Set();

        function addTable(id, sourceName) {
            const key = toId(id);
            if (!key || !/^\d+$/.test(key)) return;
            const known = tableById.get(key);
            uniquePush(result.tables, seenTables, {
                id: key,
                name: known ? (known.name || known.val || known.value || key) : key,
                source: sourceName
            });
        }

        function addQuery(id, sourceName) {
            const key = toId(id);
            if (!key || !/^\d+$/.test(key)) return;
            const known = queryById.get(key);
            uniquePush(result.queries, seenQueries, {
                id: key,
                name: known ? (known.name || known.val || known.value || key) : key,
                source: sourceName
            });
        }

        const tableRegex = /(?:^|[/"'`\s])(?:object|metadata|table|cards)\/(\d+)(?=[/?#&"'`\s]|$)/gi;
        let match;
        while ((match = tableRegex.exec(source)) !== null) {
            const marker = match[0].toLowerCase();
            const sourceName = marker.indexOf('metadata') > -1 ? 'metadata' :
                marker.indexOf('table') > -1 ? 'table' :
                marker.indexOf('cards') > -1 ? 'cards' : 'object';
            addTable(match[1], sourceName);
        }

        const queryRegex = /(?:^|[/"'`\s])(?:report|query|smartq|sql)\/([^?#"'`<>\s]+)/gi;
        while ((match = queryRegex.exec(source)) !== null) {
            const raw = decodeSegment(match[1]).replace(/^\/+|\/+$/g, '');
            if (!raw || raw.indexOf('{') > -1 || raw.indexOf(':') > -1) continue;
            const marker = match[0].toLowerCase();
            const sourceName = marker.indexOf('report') > -1 ? 'report' :
                marker.indexOf('query') > -1 ? 'query' :
                marker.indexOf('smartq') > -1 ? 'smartq' : 'sql';
            if (/^\d+$/.test(raw)) {
                addQuery(raw, sourceName);
            } else {
                const known = queryByName.get(normalizeSearch(raw));
                if (known) {
                    uniquePush(result.queries, seenQueries, {
                        id: known.id,
                        name: known.name || known.val || known.value || raw,
                        source: sourceName + '-name'
                    });
                }
            }
        }

        return result;
    }

    function cloneTable(item) {
        return {
            id: toId(item.id),
            name: item.name || item.val || item.value || toId(item.id),
            exportData: !!item.exportData,
            filter: item.filter || ''
        };
    }

    function cloneQuery(item) {
        return {
            id: toId(item.id),
            name: item.name || item.val || item.value || toId(item.id)
        };
    }

    function cloneFile(item) {
        return {
            root: item.root || 'templates',
            path: item.path || item.name || '',
            name: item.name || item.path || ''
        };
    }

    function serializeConfig(state) {
        const selectedTables = state.selectedTables instanceof Map
            ? Array.from(state.selectedTables.values())
            : (state.tables || []);
        const selectedQueries = state.selectedQueries instanceof Map
            ? Array.from(state.selectedQueries.values())
            : (state.queries || []);
        const selectedFiles = state.selectedFiles instanceof Map
            ? Array.from(state.selectedFiles.values())
            : (state.files || []);

        return {
            version: 1,
            type: SETTINGS_TYPE,
            name: state.settingsName || state.name || '',
            tables: selectedTables.map(cloneTable).filter(function(item) { return item.id; }),
            queries: selectedQueries.map(cloneQuery).filter(function(item) { return item.id; }),
            files: selectedFiles.map(cloneFile).filter(function(item) { return item.path; })
        };
    }

    function normalizeConfig(config) {
        const raw = config && typeof config === 'object' ? config : {};
        return {
            version: raw.version || 1,
            type: raw.type || SETTINGS_TYPE,
            name: raw.name || '',
            tables: Array.isArray(raw.tables) ? raw.tables.map(cloneTable).filter(function(item) { return item.id; }) : [],
            queries: Array.isArray(raw.queries) ? raw.queries.map(cloneQuery).filter(function(item) { return item.id; }) : [],
            files: Array.isArray(raw.files) ? raw.files.map(cloneFile).filter(function(item) { return item.path; }) : []
        };
    }

    const Utils = {
        parseDependencyRefs: parseDependencyRefs,
        serializeConfig: serializeConfig,
        normalizeConfig: normalizeConfig,
        getDisplayValue: getDisplayValue,
        normalizeSearch: normalizeSearch
    };

    class MigrationWorkspace {
        constructor(container) {
            this.container = container;
            this.db = resolvedRuntimeValue(container.dataset.db, root.db, dbFromLocation());
            this.xsrf = resolvedRuntimeValue(container.dataset.xsrf, root.xsrf);
            this.user = resolvedRuntimeValue(container.dataset.user, root.user);
            this.state = {
                settingsId: null,
                settingsName: '',
                selectedTables: new Map(),
                selectedQueries: new Map(),
                selectedFiles: new Map()
            };
            this.catalog = {
                tables: [],
                queries: [],
                settings: [],
                files: []
            };
            this.fileBrowser = {
                root: 'templates',
                path: '',
                dirs: [],
                files: []
            };
            this.metadataCache = new Map();
            this.fileContentCache = new Map();
            this.lastPackage = null;
            this.busyCount = 0;
        }

        async init() {
            document.title = 'Миграция';
            this.renderShell();
            this.bindEvents();
            await this.loadInitialData();
            this.renderAll();
        }

        renderShell() {
            this.container.innerHTML = [
                '<div class="migr-workspace">',
                '  <header class="migr-header">',
                '    <div>',
                '      <h1>Миграция</h1>',
                '      <div class="migr-subtitle">JSON-пакет сущностей, запросов, рабочих мест и файлов</div>',
                '    </div>',
                '    <div class="migr-actions">',
                '      <button type="button" class="migr-btn migr-btn-secondary" data-action="scan-queries" title="Найти таблицы и колонки, используемые в выбранных запросах"><i class="pi pi-sitemap"></i><span>Анализ запросов</span></button>',
                '      <button type="button" class="migr-btn migr-btn-secondary" data-action="scan-files" title="Найти зависимости в выбранных файлах"><i class="pi pi-search"></i><span>Найти связи</span></button>',
                '      <button type="button" class="migr-btn migr-btn-secondary" data-action="save-settings" title="Сохранить конфигурацию"><i class="pi pi-save"></i><span>Сохранить</span></button>',
                '      <button type="button" class="migr-btn migr-btn-primary" data-action="export-package" title="Сформировать JSON"><i class="pi pi-download"></i><span>Экспорт</span></button>',
                '    </div>',
                '  </header>',
                '  <section class="migr-settings migr-panel">',
                '    <label class="migr-field"><span>Настройка</span><select id="migr-settings-select"></select></label>',
                '    <label class="migr-field migr-field-grow"><span>Название</span><input id="migr-settings-name" type="text" autocomplete="off" placeholder="Новая миграция"></label>',
                '    <button type="button" class="migr-icon-btn" data-action="new-settings" title="Новая настройка"><i class="pi pi-plus"></i></button>',
                '    <div id="migr-status" class="migr-status"></div>',
                '  </section>',
                '  <main class="migr-layout">',
                '    <section class="migr-panel migr-list-panel">',
                '      <div class="migr-panel-title"><i class="pi pi-database"></i><h2>Таблицы</h2><span id="migr-tables-count"></span></div>',
                '      <div class="migr-search"><i class="pi pi-search"></i><input id="migr-table-search" type="search" autocomplete="off" placeholder="Поиск"></div>',
                '      <div id="migr-tables-list" class="migr-list"></div>',
                '      <div class="migr-selected-block">',
                '        <div class="migr-selected-title">Отобрано</div>',
                '        <div id="migr-selected-tables" class="migr-selected-list"></div>',
                '      </div>',
                '    </section>',
                '    <section class="migr-panel migr-list-panel">',
                '      <div class="migr-panel-title"><i class="pi pi-table"></i><h2>Запросы</h2><span id="migr-queries-count"></span></div>',
                '      <div class="migr-search"><i class="pi pi-search"></i><input id="migr-query-search" type="search" autocomplete="off" placeholder="Поиск"></div>',
                '      <div id="migr-queries-list" class="migr-list"></div>',
                '    </section>',
                '    <section class="migr-panel migr-list-panel">',
                '      <div class="migr-panel-title"><i class="pi pi-folder-open"></i><h2>Файлы</h2><span id="migr-files-count"></span></div>',
                '      <div class="migr-file-toolbar">',
                '        <button type="button" class="migr-chip active" data-file-root="templates">templates</button>',
                '        <button type="button" class="migr-chip" data-file-root="download">download</button>',
                '        <button type="button" class="migr-icon-btn" data-action="folder-up" title="На уровень выше"><i class="pi pi-arrow-up"></i></button>',
                '      </div>',
                '      <div id="migr-file-path" class="migr-path"></div>',
                '      <div class="migr-search"><i class="pi pi-search"></i><input id="migr-file-search" type="search" autocomplete="off" placeholder="Поиск"></div>',
                '      <div id="migr-files-list" class="migr-list"></div>',
                '      <div class="migr-selected-block">',
                '        <div class="migr-selected-title">Отобрано</div>',
                '        <div id="migr-selected-files" class="migr-selected-list"></div>',
                '      </div>',
                '    </section>',
                '  </main>',
                '  <section class="migr-panel migr-output-panel">',
                '    <div class="migr-panel-title"><i class="pi pi-code"></i><h2>Пакет</h2><span id="migr-package-size"></span></div>',
                '    <textarea id="migr-output" spellcheck="false" readonly></textarea>',
                '  </section>',
                '</div>',
                '<div id="migr-toast" class="migr-toast" aria-live="polite"></div>'
            ].join('');
        }

        bindEvents() {
            const self = this;
            this.container.addEventListener('click', function(event) {
                const actionEl = event.target.closest('[data-action]');
                if (actionEl) {
                    self.handleAction(actionEl.dataset.action, actionEl);
                    return;
                }

                const rootEl = event.target.closest('[data-file-root]');
                if (rootEl) {
                    self.setFileRoot(rootEl.dataset.fileRoot);
                    return;
                }

                const dirEl = event.target.closest('[data-open-dir]');
                if (dirEl) {
                    self.openFileDir(self.fileBrowser.root, dirEl.dataset.openDir);
                }
            });

            this.container.addEventListener('change', function(event) {
                const target = event.target;
                if (target.matches('[data-table-toggle]')) {
                    self.toggleTable(target.dataset.tableToggle, target.checked);
                } else if (target.matches('[data-query-toggle]')) {
                    self.toggleQuery(target.dataset.queryToggle, target.checked);
                } else if (target.matches('[data-file-toggle]')) {
                    self.toggleFile(target.dataset.fileToggle, target.checked);
                } else if (target.matches('[data-table-export]')) {
                    self.updateSelectedTable(target.dataset.tableExport, { exportData: target.checked });
                } else if (target.id === 'migr-settings-select') {
                    self.applySetting(target.value);
                }
            });

            this.container.addEventListener('input', function(event) {
                const target = event.target;
                if (target.id === 'migr-table-search') {
                    self.renderTables();
                } else if (target.id === 'migr-query-search') {
                    self.renderQueries();
                } else if (target.id === 'migr-file-search') {
                    self.renderFiles();
                } else if (target.id === 'migr-settings-name') {
                    self.state.settingsName = target.value.trim();
                } else if (target.matches('[data-table-filter]')) {
                    self.updateSelectedTable(target.dataset.tableFilter, { filter: target.value.trim() });
                }
            });
        }

        async handleAction(action) {
            if (action === 'new-settings') {
                this.newSettings();
            } else if (action === 'save-settings') {
                await this.saveSettings();
            } else if (action === 'scan-queries') {
                await this.scanSelectedQueries();
            } else if (action === 'scan-files') {
                await this.scanSelectedFiles();
            } else if (action === 'export-package') {
                await this.exportPackage();
            } else if (action === 'folder-up') {
                this.openParentDir();
            } else if (action.indexOf('remove-table:') === 0) {
                this.toggleTable(action.slice('remove-table:'.length), false);
            } else if (action.indexOf('remove-file:') === 0) {
                this.state.selectedFiles.delete(action.slice('remove-file:'.length));
                this.renderFiles();
                this.renderSelectedFiles();
            }
        }

        async loadInitialData() {
            this.setBusy(true);
            try {
                await Promise.all([
                    this.loadMetadata(),
                    this.loadQueries(),
                    this.loadSettings()
                ]);
                await this.openFileDir('templates', '');
                this.setStatus('Готово');
            } catch (e) {
                console.error('[migr] init failed:', e);
                this.showToast('Не удалось загрузить данные рабочего места', 'error');
            } finally {
                this.setBusy(false);
            }
        }

        apiUrl(endpoint) {
            return '/' + this.db + '/' + endpoint.replace(/^\/+/, '');
        }

        async fetchJson(endpoint) {
            const response = await fetch(this.apiUrl(endpoint), { credentials: 'include' });
            if (!response.ok) throw new Error(endpoint + ': HTTP ' + response.status);
            return response.json();
        }

        async fetchText(endpoint) {
            const response = await fetch(this.apiUrl(endpoint), { credentials: 'include' });
            if (!response.ok) throw new Error(endpoint + ': HTTP ' + response.status);
            return response.text();
        }

        async loadMetadata() {
            const json = await this.fetchJson('metadata?JSON');
            if (!Array.isArray(json)) {
                this.catalog.tables = [];
                return;
            }
            this.catalog.tables = json.map(function(item) {
                return {
                    id: toId(item.id),
                    name: getDisplayValue(item.val || item.name || item.value || item.id),
                    raw: item
                };
            }).filter(function(item) {
                return item.id;
            }).sort(function(a, b) {
                return a.name.localeCompare(b.name, 'ru');
            });
        }

        async loadQueries() {
            const json = await this.fetchJson('object/' + QUERY_TABLE_ID + '?JSON_OBJ&LIMIT=0,1000');
            if (!Array.isArray(json)) {
                this.catalog.queries = [];
                return;
            }
            this.catalog.queries = json.map(function(item) {
                return {
                    id: toId(item.i),
                    name: getDisplayValue(item.r && item.r[0] ? item.r[0] : item.i),
                    raw: item
                };
            }).filter(function(item) {
                return item.id;
            }).sort(function(a, b) {
                return a.name.localeCompare(b.name, 'ru');
            });
        }

        async loadSettings() {
            const json = await this.fetchJson('object/' + SETTINGS_TABLE_ID + '?JSON_OBJ&F_271=' + encodeURIComponent(SETTINGS_TYPE));
            const rows = Array.isArray(json) ? json : [];
            this.catalog.settings = rows.map(function(item) {
                let parsed = null;
                const rawJson = item.r && item.r[2] ? item.r[2] : '';
                if (rawJson) {
                    try {
                        parsed = normalizeConfig(JSON.parse(rawJson));
                    } catch (e) {
                        parsed = null;
                    }
                }
                return {
                    id: toId(item.i),
                    name: getDisplayValue(item.r && item.r[0] ? item.r[0] : item.i),
                    config: parsed,
                    raw: item
                };
            }).filter(function(item) {
                return item.id;
            }).sort(function(a, b) {
                return a.name.localeCompare(b.name, 'ru');
            });
        }

        async openFileDir(rootName, path) {
            this.fileBrowser.root = rootName || 'templates';
            this.fileBrowser.path = this.normalizePath(path || '');
            this.setBusy(true);
            try {
                const items = await this.fetchDirItems(this.fileBrowser.root, this.fileBrowser.path);
                this.fileBrowser.dirs = items.dirs;
                this.fileBrowser.files = items.files;
                this.catalog.files = this.mergeFiles(this.catalog.files, items.files);
                this.renderFiles();
                this.renderSelectedFiles();
                this.updateRootButtons();
            } catch (e) {
                console.error('[migr] file listing failed:', e);
                this.fileBrowser.dirs = [];
                this.fileBrowser.files = [];
                this.renderFiles();
                this.showToast('Не удалось открыть папку файлов', 'error');
            } finally {
                this.setBusy(false);
            }
        }

        async fetchDirItems(rootName, path) {
            const query = rootName + '=1&add_path=' + encodeURIComponent(path || '');
            const html = await this.fetchText('dir_admin/?' + query);
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const dirs = [];
            const files = [];
            const currentPath = this.normalizePath(path || '');

            Array.from(doc.querySelectorAll('tr')).forEach((row) => {
                const fileLink = row.querySelector('a[href*="gf="]');
                if (fileLink) {
                    const href = fileLink.getAttribute('href') || '';
                    const url = new URL(href, window.location.origin);
                    const name = decodeSegment(url.searchParams.get('gf') || fileLink.textContent.trim());
                    const addPath = this.normalizePath(url.searchParams.get('add_path') || currentPath);
                    files.push(this.makeFileItem(rootName, addPath, name));
                    return;
                }

                const dirLink = row.querySelector('td[colspan="2"] a[href*="add_path="]');
                if (!dirLink) return;
                const href = dirLink.getAttribute('href') || '';
                const url = new URL(href, window.location.origin);
                const dirPath = this.normalizePath(url.searchParams.get('add_path') || '');
                const name = dirLink.textContent.trim();
                if (!name || name === '..' || dirPath === currentPath) return;
                dirs.push({
                    root: rootName,
                    path: dirPath,
                    name: name
                });
            });

            dirs.sort(function(a, b) { return a.path.localeCompare(b.path, 'ru'); });
            files.sort(function(a, b) { return a.path.localeCompare(b.path, 'ru'); });
            return { dirs: dirs, files: files };
        }

        makeFileItem(rootName, dirPath, name) {
            const path = this.normalizePath((dirPath ? dirPath + '/' : '') + name);
            return {
                key: rootName + ':' + path,
                root: rootName,
                path: path,
                name: name,
                dir: this.normalizePath(dirPath || ''),
                text: TEXT_FILE_RE.test(name)
            };
        }

        mergeFiles(oldFiles, newFiles) {
            const map = new Map();
            (oldFiles || []).concat(newFiles || []).forEach(function(item) {
                map.set(item.key, item);
            });
            return Array.from(map.values());
        }

        normalizePath(path) {
            return String(path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
        }

        updateRootButtons() {
            this.container.querySelectorAll('[data-file-root]').forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.fileRoot === this.fileBrowser.root);
            });
        }

        async setFileRoot(rootName) {
            await this.openFileDir(rootName, '');
        }

        openParentDir() {
            const path = this.fileBrowser.path;
            if (!path) return;
            const parts = path.split('/');
            parts.pop();
            this.openFileDir(this.fileBrowser.root, parts.join('/'));
        }

        renderAll() {
            this.renderSettings();
            this.renderTables();
            this.renderSelectedTables();
            this.renderQueries();
            this.renderFiles();
            this.renderSelectedFiles();
            this.renderOutput();
        }

        renderSettings() {
            const select = this.container.querySelector('#migr-settings-select');
            const input = this.container.querySelector('#migr-settings-name');
            if (!select || !input) return;

            const options = ['<option value="">Новая настройка</option>'];
            this.catalog.settings.forEach(function(item) {
                options.push('<option value="' + escapeAttr(item.id) + '">' + escapeHtml(item.name) + '</option>');
            });
            select.innerHTML = options.join('');
            select.value = this.state.settingsId || '';
            input.value = this.state.settingsName || '';
        }

        renderTables() {
            const search = normalizeSearch(this.getInputValue('#migr-table-search'));
            const list = this.container.querySelector('#migr-tables-list');
            const count = this.container.querySelector('#migr-tables-count');
            if (!list) return;

            const items = this.catalog.tables.filter((item) => {
                return !search || normalizeSearch(item.name + ' ' + item.id).indexOf(search) > -1;
            }).slice().sort((a, b) => {
                const aSelected = this.state.selectedTables.has(a.id) ? 0 : 1;
                const bSelected = this.state.selectedTables.has(b.id) ? 0 : 1;
                return aSelected - bSelected;
            });
            if (count) count.textContent = String(this.state.selectedTables.size) + ' / ' + String(this.catalog.tables.length);

            list.innerHTML = items.map((item) => {
                const checked = this.state.selectedTables.has(item.id) ? ' checked' : '';
                return [
                    '<label class="migr-row">',
                    '  <input type="checkbox" data-table-toggle="' + escapeAttr(item.id) + '"' + checked + '>',
                    '  <span class="migr-row-main"><span class="migr-row-name">' + escapeHtml(item.name) + '</span><span class="migr-row-meta">#' + escapeHtml(item.id) + '</span></span>',
                    '</label>'
                ].join('');
            }).join('') || '<div class="migr-empty">Нет таблиц</div>';
        }

        renderSelectedTables() {
            const container = this.container.querySelector('#migr-selected-tables');
            if (!container) return;
            const items = Array.from(this.state.selectedTables.values());
            container.innerHTML = items.map(function(item) {
                return [
                    '<div class="migr-selected-item">',
                    '  <div class="migr-selected-head">',
                    '    <span>' + escapeHtml(item.name) + ' <span class="migr-row-meta">#' + escapeHtml(item.id) + '</span></span>',
                    '    <button type="button" class="migr-mini-btn" data-action="remove-table:' + escapeAttr(item.id) + '" title="Убрать"><i class="pi pi-times"></i></button>',
                    '  </div>',
                    '  <label class="migr-checkline"><input type="checkbox" data-table-export="' + escapeAttr(item.id) + '"' + (item.exportData ? ' checked' : '') + '> Данные</label>',
                    '  <input class="migr-filter-input" data-table-filter="' + escapeAttr(item.id) + '" value="' + escapeAttr(item.filter || '') + '" placeholder="F_Поле=значение">',
                    '</div>'
                ].join('');
            }).join('') || '<div class="migr-empty">Таблицы не выбраны</div>';
        }

        renderQueries() {
            const search = normalizeSearch(this.getInputValue('#migr-query-search'));
            const list = this.container.querySelector('#migr-queries-list');
            const count = this.container.querySelector('#migr-queries-count');
            if (!list) return;

            const items = this.catalog.queries.filter((item) => {
                return !search || normalizeSearch(item.name + ' ' + item.id).indexOf(search) > -1;
            }).slice().sort((a, b) => {
                const aSelected = this.state.selectedQueries.has(a.id) ? 0 : 1;
                const bSelected = this.state.selectedQueries.has(b.id) ? 0 : 1;
                return aSelected - bSelected;
            });
            if (count) count.textContent = String(this.state.selectedQueries.size) + ' / ' + String(this.catalog.queries.length);

            list.innerHTML = items.map((item) => {
                const checked = this.state.selectedQueries.has(item.id) ? ' checked' : '';
                return [
                    '<label class="migr-row">',
                    '  <input type="checkbox" data-query-toggle="' + escapeAttr(item.id) + '"' + checked + '>',
                    '  <span class="migr-row-main"><span class="migr-row-name">' + escapeHtml(item.name) + '</span><span class="migr-row-meta">#' + escapeHtml(item.id) + '</span></span>',
                    '</label>'
                ].join('');
            }).join('') || '<div class="migr-empty">Нет запросов</div>';
        }

        renderFiles() {
            const search = normalizeSearch(this.getInputValue('#migr-file-search'));
            const list = this.container.querySelector('#migr-files-list');
            const count = this.container.querySelector('#migr-files-count');
            const path = this.container.querySelector('#migr-file-path');
            if (!list) return;

            const dirs = this.fileBrowser.dirs.filter(function(item) {
                return !search || normalizeSearch(item.path).indexOf(search) > -1;
            });
            const files = this.fileBrowser.files.filter(function(item) {
                return !search || normalizeSearch(item.path).indexOf(search) > -1;
            });

            if (count) count.textContent = String(this.state.selectedFiles.size) + ' / ' + String(this.catalog.files.length);
            if (path) path.textContent = this.fileBrowser.root + (this.fileBrowser.path ? '/' + this.fileBrowser.path : '/');

            const dirHtml = dirs.map(function(item) {
                return [
                    '<button type="button" class="migr-row migr-row-button" data-open-dir="' + escapeAttr(item.path) + '">',
                    '  <i class="pi pi-folder"></i>',
                    '  <span class="migr-row-main"><span class="migr-row-name">' + escapeHtml(item.name) + '</span><span class="migr-row-meta">' + escapeHtml(item.path) + '</span></span>',
                    '</button>'
                ].join('');
            }).join('');

            const fileHtml = files.map((item) => {
                const checked = this.state.selectedFiles.has(item.key) ? ' checked' : '';
                return [
                    '<label class="migr-row">',
                    '  <input type="checkbox" data-file-toggle="' + escapeAttr(item.key) + '"' + checked + '>',
                    '  <span class="migr-row-main"><span class="migr-row-name">' + escapeHtml(item.name) + '</span><span class="migr-row-meta">' + escapeHtml(item.path) + '</span></span>',
                    '</label>'
                ].join('');
            }).join('');

            list.innerHTML = dirHtml + fileHtml || '<div class="migr-empty">Файлы не найдены</div>';
        }

        renderSelectedFiles() {
            const container = this.container.querySelector('#migr-selected-files');
            if (!container) return;
            const items = Array.from(this.state.selectedFiles.values());
            container.innerHTML = items.map(function(item) {
                return [
                    '<div class="migr-pill">',
                    '  <span>' + escapeHtml(item.root + '/' + item.path) + '</span>',
                    '  <button type="button" class="migr-mini-btn" data-action="remove-file:' + escapeAttr(item.key) + '" title="Убрать"><i class="pi pi-times"></i></button>',
                    '</div>'
                ].join('');
            }).join('') || '<div class="migr-empty">Файлы не выбраны</div>';
        }

        renderOutput() {
            const output = this.container.querySelector('#migr-output');
            const size = this.container.querySelector('#migr-package-size');
            const text = this.lastPackage ? JSON.stringify(this.lastPackage, null, 2) : '';
            if (output) output.value = text;
            if (size) size.textContent = text ? String(Math.round(text.length / 1024)) + ' КБ' : '';
        }

        getInputValue(selector) {
            const input = this.container.querySelector(selector);
            return input ? input.value : '';
        }

        toggleTable(id, checked) {
            const table = this.catalog.tables.find(function(item) { return item.id === id; }) || { id: id, name: id };
            if (checked) {
                if (!this.state.selectedTables.has(id)) {
                    this.state.selectedTables.set(id, { id: id, name: table.name, exportData: false, filter: '' });
                }
            } else {
                this.state.selectedTables.delete(id);
            }
            this.renderTables();
            this.renderSelectedTables();
        }

        toggleQuery(id, checked) {
            const query = this.catalog.queries.find(function(item) { return item.id === id; }) || { id: id, name: id };
            if (checked) {
                if (!this.state.selectedQueries.has(id)) {
                    this.state.selectedQueries.set(id, { id: id, name: query.name });
                }
            } else {
                this.state.selectedQueries.delete(id);
            }
            this.renderQueries();
        }

        toggleFile(key, checked) {
            const file = this.catalog.files.find(function(item) { return item.key === key; });
            if (!file) return;
            if (checked) {
                this.state.selectedFiles.set(key, file);
            } else {
                this.state.selectedFiles.delete(key);
            }
            this.renderFiles();
            this.renderSelectedFiles();
        }

        updateSelectedTable(id, patch) {
            const current = this.state.selectedTables.get(id);
            if (!current) return;
            this.state.selectedTables.set(id, Object.assign({}, current, patch));
        }

        newSettings() {
            this.state.settingsId = null;
            this.state.settingsName = '';
            this.state.selectedTables.clear();
            this.state.selectedQueries.clear();
            this.state.selectedFiles.clear();
            this.lastPackage = null;
            this.renderAll();
            this.setStatus('Новая настройка');
        }

        applySetting(id) {
            if (!id) {
                this.newSettings();
                return;
            }
            const item = this.catalog.settings.find(function(setting) { return setting.id === id; });
            if (!item || !item.config) {
                this.showToast('Настройка не содержит корректный JSON', 'error');
                return;
            }

            const config = normalizeConfig(item.config);
            this.state.settingsId = item.id;
            this.state.settingsName = config.name || item.name;
            this.state.selectedTables.clear();
            this.state.selectedQueries.clear();
            this.state.selectedFiles.clear();

            config.tables.forEach((table) => {
                const known = this.catalog.tables.find(function(item2) { return item2.id === table.id; });
                this.state.selectedTables.set(table.id, Object.assign({}, table, {
                    name: table.name || (known && known.name) || table.id
                }));
            });
            config.queries.forEach((query) => {
                const known = this.catalog.queries.find(function(item2) { return item2.id === query.id; });
                this.state.selectedQueries.set(query.id, Object.assign({}, query, {
                    name: query.name || (known && known.name) || query.id
                }));
            });
            config.files.forEach((file) => {
                const key = (file.root || 'templates') + ':' + file.path;
                const known = this.catalog.files.find(function(item2) { return item2.key === key; });
                this.state.selectedFiles.set(key, known || Object.assign({ key: key }, file));
            });

            this.renderAll();
            this.setStatus('Настройка загружена');
        }

        async saveSettings() {
            const input = this.container.querySelector('#migr-settings-name');
            const name = (input && input.value.trim()) || this.state.settingsName;
            if (!name) {
                this.showToast('Укажите название настройки', 'error');
                return;
            }
            this.state.settingsName = name;
            const config = serializeConfig(this.state);
            config.name = name;

            const matched = this.catalog.settings.find((item) => {
                return item.id === this.state.settingsId || item.name === name;
            });
            const remoteId = matched ? matched.id : this.state.settingsId;

            const body = new FormData();
            body.append('_xsrf', this.xsrf);
            body.append('t269', name);
            body.append('t271', SETTINGS_TYPE);
            body.append('t273', JSON.stringify(config));

            const endpoint = remoteId
                ? '_m_save/' + encodeURIComponent(remoteId) + '?JSON'
                : '_m_new/' + SETTINGS_TABLE_ID + '?JSON&up=1';

            this.setBusy(true);
            try {
                const response = await fetch(this.apiUrl(endpoint), {
                    method: 'POST',
                    credentials: 'include',
                    body: body
                });
                if (!response.ok) throw new Error('HTTP ' + response.status);
                const json = await response.json();
                const createdId = json && json.obj && (json.obj.id || json.obj);
                this.state.settingsId = remoteId || toId(createdId);
                await this.loadSettings();
                this.renderSettings();
                this.showToast('Настройка сохранена', 'success');
                this.setStatus('Сохранено');
            } catch (e) {
                console.error('[migr] save settings failed:', e);
                this.showToast('Не удалось сохранить настройку', 'error');
            } finally {
                this.setBusy(false);
            }
        }

        async scanSelectedQueries() {
            const queries = Array.from(this.state.selectedQueries.values());
            if (!queries.length) {
                this.showToast('Выберите запросы для анализа', 'error');
                return;
            }

            this.setBusy(true);
            let addedTables = 0;
            try {
                const tableById = mapById(this.catalog.tables);
                for (const query of queries) {
                    let columns;
                    try {
                        columns = await this.fetchJson('object/28?F_U=' + encodeURIComponent(query.id) + '&JSON_OBJ&LIMIT=1000');
                    } catch (e) {
                        console.warn('[migr] query columns fetch failed for', query.id, e);
                        continue;
                    }
                    if (!Array.isArray(columns)) continue;
                    for (const col of columns) {
                        const r0 = col.r && col.r[0] ? String(col.r[0]) : '';
                        const colon = r0.indexOf(':');
                        if (colon < 1) continue;
                        const rawId = r0.slice(0, colon).trim();
                        if (!rawId || rawId === '0' || !/^\d+$/.test(rawId)) continue;
                        if (this.state.selectedTables.has(rawId)) continue;
                        const known = tableById.get(rawId);
                        const name = known ? (known.name || rawId) : (r0.slice(colon + 1).trim() || rawId);
                        this.state.selectedTables.set(rawId, {
                            id: rawId,
                            name: name,
                            exportData: false,
                            filter: ''
                        });
                        addedTables += 1;
                    }
                }
                this.renderTables();
                this.renderSelectedTables();
                this.showToast('Добавлено таблиц из запросов: ' + addedTables, 'success');
                this.setStatus('Анализ запросов завершён');
            } catch (e) {
                console.error('[migr] query scan failed:', e);
                this.showToast('Не удалось проанализировать запросы', 'error');
            } finally {
                this.setBusy(false);
            }
        }

        async scanSelectedFiles() {
            const files = Array.from(this.state.selectedFiles.values());
            if (!files.length) {
                this.showToast('Выберите файлы для проверки', 'error');
                return;
            }

            this.setBusy(true);
            let addedTables = 0;
            let addedQueries = 0;
            try {
                for (const file of files) {
                    const content = await this.getFileContent(file);
                    const refs = parseDependencyRefs(content, {
                        tables: this.catalog.tables,
                        queries: this.catalog.queries
                    });
                    refs.tables.forEach((item) => {
                        if (!this.state.selectedTables.has(item.id)) {
                            this.state.selectedTables.set(item.id, {
                                id: item.id,
                                name: item.name,
                                exportData: false,
                                filter: ''
                            });
                            addedTables += 1;
                        }
                    });
                    refs.queries.forEach((item) => {
                        if (!this.state.selectedQueries.has(item.id)) {
                            this.state.selectedQueries.set(item.id, {
                                id: item.id,
                                name: item.name
                            });
                            addedQueries += 1;
                        }
                    });
                }
                this.renderTables();
                this.renderSelectedTables();
                this.renderQueries();
                this.showToast('Добавлено: таблиц ' + addedTables + ', запросов ' + addedQueries, 'success');
                this.setStatus('Связи проверены');
            } catch (e) {
                console.error('[migr] dependency scan failed:', e);
                this.showToast('Не удалось проверить файлы', 'error');
            } finally {
                this.setBusy(false);
            }
        }

        async getFileContent(file) {
            if (this.fileContentCache.has(file.key)) {
                return this.fileContentCache.get(file.key);
            }
            if (!TEXT_FILE_RE.test(file.name || file.path || '')) {
                this.fileContentCache.set(file.key, '');
                return '';
            }
            const endpoint = 'dir_admin/?' + file.root + '=1&add_path=' +
                encodeURIComponent(file.dir || dirname(file.path)) +
                '&gf=' + encodeURIComponent(file.name || basename(file.path));
            const text = await this.fetchText(endpoint);
            this.fileContentCache.set(file.key, text);
            return text;
        }

        async exportPackage() {
            const config = serializeConfig(this.state);
            if (!config.tables.length && !config.queries.length && !config.files.length) {
                this.showToast('Выберите таблицы, запросы или файлы', 'error');
                return;
            }

            this.setBusy(true);
            try {
                const pack = {
                    version: 1,
                    kind: 'integram-migration',
                    createdAt: new Date().toISOString(),
                    source: {
                        db: this.db,
                        location: window.location.origin
                    },
                    config: config,
                    tables: [],
                    queries: [],
                    files: []
                };

                for (const table of config.tables) {
                    const metadata = await this.getTableMetadata(table.id);
                    const entry = {
                        id: table.id,
                        name: table.name,
                        metadata: metadata,
                        exportData: !!table.exportData,
                        filter: table.filter || ''
                    };
                    if (table.exportData) {
                        entry.data = await this.getTableData(table);
                    }
                    pack.tables.push(entry);
                }

                for (const query of config.queries) {
                    pack.queries.push(await this.getQueryPackage(query));
                }

                for (const file of Array.from(this.state.selectedFiles.values())) {
                    const content = await this.getFileContent(file);
                    const deps = parseDependencyRefs(content, {
                        tables: this.catalog.tables,
                        queries: this.catalog.queries
                    });
                    pack.files.push({
                        root: file.root,
                        path: file.path,
                        name: file.name,
                        text: TEXT_FILE_RE.test(file.name || file.path || ''),
                        content: content,
                        dependencies: deps
                    });
                }

                this.lastPackage = pack;
                this.renderOutput();
                this.downloadJson(pack, (config.name || 'migration') + '.json');
                this.showToast('JSON сформирован', 'success');
                this.setStatus('Экспорт готов');
            } catch (e) {
                console.error('[migr] export failed:', e);
                this.showToast('Не удалось сформировать экспорт', 'error');
            } finally {
                this.setBusy(false);
            }
        }

        async getTableMetadata(id) {
            const key = toId(id);
            if (this.metadataCache.has(key)) return this.metadataCache.get(key);
            const json = await this.fetchJson('metadata/' + encodeURIComponent(key) + '?JSON');
            this.metadataCache.set(key, json);
            return json;
        }

        async getTableData(table) {
            let endpoint = 'object/' + encodeURIComponent(table.id) + '?JSON_OBJ&LIMIT=' + encodeURIComponent(EXPORT_LIMIT);
            const filter = String(table.filter || '').replace(/^[?&]+/, '');
            if (filter) endpoint += '&' + filter;
            return this.fetchJson(endpoint);
        }

        async getQueryPackage(query) {
            const entry = {
                id: query.id,
                name: query.name,
                record: null,
                columns: null,
                report: null
            };
            try {
                entry.record = await this.fetchJson('object/' + QUERY_TABLE_ID + '/' + encodeURIComponent(query.id) + '?JSON_OBJ');
            } catch (e) {
                entry.recordError = e.message;
            }
            try {
                entry.columns = await this.fetchJson('object/28?F_U=' + encodeURIComponent(query.id) + '&JSON_OBJ&LIMIT=1000');
            } catch (e) {
                entry.columnsError = e.message;
            }
            try {
                entry.report = await this.fetchJson('report/' + encodeURIComponent(query.id) + '?JSON');
            } catch (e) {
                entry.reportError = e.message;
            }
            return entry;
        }

        downloadJson(data, filename) {
            const text = JSON.stringify(data, null, 2);
            const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename.replace(/[\\/:*?"<>|]+/g, '_');
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        }

        setBusy(isBusy) {
            this.busyCount += isBusy ? 1 : -1;
            if (this.busyCount < 0) this.busyCount = 0;
            this.container.classList.toggle('is-busy', this.busyCount > 0);
        }

        setStatus(text) {
            const status = this.container.querySelector('#migr-status');
            if (status) status.textContent = text || '';
        }

        showToast(message, type) {
            const toast = document.getElementById('migr-toast');
            if (!toast) return;
            toast.textContent = message;
            toast.className = 'migr-toast show ' + (type || '');
            clearTimeout(this.toastTimer);
            this.toastTimer = setTimeout(function() {
                toast.className = 'migr-toast';
            }, 3200);
        }
    }

    function dirname(path) {
        const value = String(path || '');
        const idx = value.lastIndexOf('/');
        return idx > -1 ? value.slice(0, idx) : '';
    }

    function basename(path) {
        const value = String(path || '');
        const idx = value.lastIndexOf('/');
        return idx > -1 ? value.slice(idx + 1) : value;
    }

    function escapeHtml(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/`/g, '&#96;');
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = Utils;
    }

    if (typeof window !== 'undefined') {
        window.MigrationWorkspace = MigrationWorkspace;
        window.MigrationWorkspaceUtils = Utils;
        document.addEventListener('DOMContentLoaded', function() {
            const container = document.getElementById('migration-workspace');
            if (!container) return;
            const app = new MigrationWorkspace(container);
            window.migrationWorkspace = app;
            app.init();
        });
    }
}(typeof window !== 'undefined' ? window : globalThis));
