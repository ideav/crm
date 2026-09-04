/*
 * Обновление рабочих файлов базы из репозитория (ideav/crm#4874).
 *
 * Страница «Файлы сервера» (templates/dir_admin.html) получает ссылку
 * «Обновление из репозитория»: сводная того, что отличается в папках
 * templates/{база} и download/{база} репозитория от лежащего на сервере,
 * и кнопка «Обновить» — залить новые и изменившиеся файлы через файловый
 * менеджер dir_admin (права на запись файлов обязательны, иначе сервер
 * отвечает отказом). Вся работа — под токеном текущего пользователя:
 * обычная сессия страницы, никаких отдельных токенов.
 *
 * Репозиторий хранится в таблице «Настройка» (269) с типом GIT (адрес —
 * главное значение записи). Настройки нет — используется
 * https://github.com/ideav/crm/. Сменить адрес может тот, у кого есть право
 * записи в «Настройку»; перед сохранением адрес проверяется по GitHub API:
 * репозиторий должен существовать и содержать папку templates или download.
 *
 * Деплой: js/* раскладывается update.conf во все базы, dir_admin.html один
 * на все базы — поэтому модуль глобальный, а не в download/{база}.
 *
 * Чистая часть (разбор адресов, дерева репозитория, листинга менеджера,
 * расхождений, план заливки) экспортируется для тестов
 * (experiments/atex-repo-update-4874.test.js).
 */
(function(root, factory) {
    'use strict';
    var api = factory(root);   // #4876: root обязана доехать до фабрики — без неё
                               // браузерный слой не видел ни document, ни fetch
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root && root.document) {
        root.RepoUpdate = api;
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function(root) {
    'use strict';

    // Дефолтный репозиторий и ветка (issue #4874).
    var DEFAULT_REPO = 'https://github.com/ideav/crm/';
    var BRANCH = 'main';
    // У базы ateh папки в репозитории зовутся atex (маппинг update.conf:
    // templates/atex/* → templates/custom/ateh/). Кандидаты имени папки: имя базы,
    // затем псевдоним.
    var DB_FOLDER_ALIASES = { ateh: 'atex' };
    // Таблица «Настройка» (269): реквизит «Тип» (271) = GIT, адрес в главном
    // значении; «Значение» (273) — запасное место (MEMO).
    var SETTING_TYPE = 'GIT';
    var SETTING_VALUE_REQ = '273';

    // ───────────────────────── Чистое ядро ─────────────────────────

    function trimText(v) { return String(v == null ? '' : v).trim(); }

    // «https://github.com/owner/repo[/|.git]» → { owner, repo }; не github или без
    // имени репозитория → null.
    function parseRepoUrl(url) {
        var m = /^https:\/\/github\.com\/([^\/\s]+)\/([^\/\s]+?)(?:\.git)?\/?$/i.exec(trimText(url));
        return m ? { owner: m[1], repo: m[2] } : null;
    }

    function githubUrls(parsed, branch) {
        var api = 'https://api.github.com/repos/' + parsed.owner + '/' + parsed.repo;
        return {
            api: api,
            tree: api + '/git/trees/' + encodeURIComponent(branch || BRANCH) + '?recursive=1',
            raw: function(path) {
                return 'https://raw.githubusercontent.com/' + parsed.owner + '/' + parsed.repo
                    + '/' + encodeURIComponent(branch || BRANCH) + '/' + path;
            }
        };
    }

    // Папки базы в дереве репозитория: templates/{X} и download/{X}, где X — имя
    // базы или её псевдоним. Папки нет → null.
    function resolveRepoFolders(tree, db) {
        var paths = {};
        ((tree && tree.tree) || []).forEach(function(entry) {
            if (entry) paths[trimText(entry.path)] = true;
        });
        function exists(folder) {
            if (paths[folder]) return true;   // сама папка есть в дереве
            var prefix = folder + '/';
            return Object.keys(paths).some(function(p) { return p.indexOf(prefix) === 0; });
        }
        function pick(prefix) {
            var candidates = [db].concat(DB_FOLDER_ALIASES[trimText(db).toLowerCase()] || []);
            for (var i = 0; i < candidates.length; i++) {
                var folder = prefix + '/' + trimText(candidates[i]);
                if (exists(folder)) return folder;
            }
            return null;
        }
        return { templates: pick('templates'), download: pick('download') };
    }

    // Файлы базы из дерева: только blob-ы внутри выбранных папок.
    // → [{ repoPath, tree: 'templates'|'download', sub, name, size }]
    function repoFiles(tree, folders) {
        var out = [];
        ((tree && tree.tree) || []).forEach(function(entry) {
            if (!entry || entry.type !== 'blob') return;
            var path = trimText(entry.path);
            ['templates', 'download'].forEach(function(kind) {
                var folder = folders && folders[kind];
                if (!folder || path.indexOf(folder + '/') !== 0) return;
                var rest = path.slice(folder.length + 1);
                var slash = rest.lastIndexOf('/');
                out.push({
                    repoPath: path,
                    tree: kind,
                    sub: slash >= 0 ? '/' + rest.slice(0, slash) : '',   // add_path менеджера: '/js'
                    name: slash >= 0 ? rest.slice(slash + 1) : rest,
                    size: Number(entry.size) || 0
                });
            });
        });
        return out;
    }

    // «12.34 KB» / «512 B» / «2 MB» (формат NormalSize из index.php) → байты.
    // Разобрать не удалось → 0: файл посчитается изменившимся (не спрячем отличие).
    function toBytes(human) {
        var m = /^([\d.,]+)\s*(B|KB|MB|GB|TB)$/i.exec(trimText(human).replace(',', '.'));
        if (!m) return 0;
        var mult = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 }[m[2].toUpperCase()];
        return Math.round(parseFloat(m[1]) * mult);
    }

    function decodeHtml(s) {
        return trimText(s)
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    }

    // Листинг каталога из HTML страницы dir_admin (своей же разметки): строки
    // File_list несут ссылку …&gf={имя} и колонку размера «N B|KB|MB».
    // Каталоги (ссылки без gf) и служебные ячейки мимо.
    // → [{ name, size }] — size в байтах.
    function parseDirListing(html) {
        var out = [], seen = {};
        var rowRe = /<tr[\s\S]*?<\/tr>/g;
        var rows = String(html == null ? '' : html).match(rowRe) || [];
        rows.forEach(function(row) {
            var gf = /gf=([^"'>]+)/.exec(row);
            if (!gf) return;
            var name = decodeHtml(decodeURIComponent(gf[1]));
            if (!name || seen[name]) return;
            var sizeM = /align="right">\s*(?:&nbsp;)?\s*([^<]*?)\s*<\//.exec(row);
            seen[name] = true;
            out.push({ name: name, size: toBytes(sizeM ? sizeM[1] : '') });
        });
        return out;
    }

    // Расхождение репозитория с сервером (по имени файла, внутри одного дерева
    // и подпапки; совпадение размера = файл актуален).
    // added — в репозитории есть, на сервере нет; changed — размеры разные;
    // same — совпали; extra — на сервере лишнее (не удаляем, только показываем).
    function diffFiles(repoList, serverList) {
        var server = {};
        (serverList || []).forEach(function(f) { server[f.name] = f; });
        var same = [], changed = [], added = [], repoNames = {};
        (repoList || []).forEach(function(f) {
            repoNames[f.name] = true;
            var onServer = server[f.name];
            if (!onServer) { added.push(f.repoPath); return; }
            if (Number(onServer.size) !== Number(f.size)) changed.push(f.repoPath);
            else same.push(f.repoPath);
        });
        var extra = (serverList || []).filter(function(f) { return !repoNames[f.name]; })
            .map(function(f) { return f.name; });
        return { same: same, changed: changed, added: added, extra: extra };
    }

    // Что заливать: изменившиеся и новые. → [{ repoPath, tree, addPath, name }]
    function updatePlan(diff) {
        return [].concat(diff.changed, diff.added).map(function(repoPath) {
            var meta = diff.meta && diff.meta[repoPath];
            return {
                repoPath: repoPath,
                tree: meta.tree,
                addPath: meta.sub,
                name: meta.name
            };
        });
    }

    // Сводка с картой метаданных по repoPath — с ней updatePlan знает, куда лить.
    function diffWithMeta(repoList, serverList) {
        var diff = diffFiles(repoList, serverList);
        diff.meta = {};
        (repoList || []).forEach(function(f) { diff.meta[f.repoPath] = f; });
        return diff;
    }

    // Адрес репозитория из записи «Настройки»: главное значение, пусто — реквизит
    // «Значение» (273; в строке JSON_OBJ он третий: главное значение, «Тип», «Значение»).
    // Записи нет → '' (вызывающий возьмёт дефолт).
    function repoFromSetting(row) {
        if (!row) return '';
        var val = trimText(row.val);
        if (val) return val;
        var reqs = row.r || [];
        return trimText(reqs[2]) || trimText(row[SETTING_VALUE_REQ]);
    }

    // ───────────────────────── Браузерный слой ─────────────────────────

    var ctx = { db: '', xsrf: '', panel: null };

    function el(tag, attrs, children) {
        var node = root.document.createElement(tag);
        Object.keys(attrs || {}).forEach(function(k) {
            if (attrs[k] === undefined || attrs[k] === null) return;
            if (k === 'text') node.textContent = attrs[k];
            else if (k === 'class') node.className = attrs[k];
            else node.setAttribute(k, attrs[k]);
        });
        (children || []).forEach(function(c) { if (c) node.appendChild(c); });
        return node;
    }
    function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
    function status(text) {
        var s = ctx.panel.querySelector('.ru-status');
        if (s) s.textContent = text || '';
    }

    function getJson(url) {
        return root.fetch(url, { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                var data;
                try { data = JSON.parse(text); }
                catch (e) { throw new Error('Сервер вернул не JSON: ' + text.slice(0, 120)); }
                var first = Array.isArray(data) ? data[0] : data;
                if (first && (first.error || first.err)) throw new Error(first.error || first.err);
                return data;
            });
        });
    }
    function postForm(path, fields) {
        var fd = new root.FormData();
        fd.append('_xsrf', ctx.xsrf);
        Object.keys(fields || {}).forEach(function(k) {
            if (fields[k] === undefined || fields[k] === null) return;
            fd.append(k, fields[k]);
        });
        return root.fetch('/' + encodeURIComponent(ctx.db) + '/' + path, {
            method: 'POST', credentials: 'same-origin', body: fd
        }).then(function(resp) {
            return resp.text().then(function(text) {
                // Успех — 302 на листинг (fetch егоTransiently следует): url сменился.
                // Отказ прав — 200 c текстом «Недостаточно прав …» и без редиректа.
                if (!resp.redirected && /Недостаточно прав/i.test(text)) {
                    throw new Error('нет прав на запись файлов (объект «Файлы») — обновление выполняет сотрудник с правом записи');
                }
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return true;
            });
        });
    }

    function loadSettingRow() {
        return getJson('/' + encodeURIComponent(ctx.db) + '/object/269?JSON&F_271=' + SETTING_TYPE)
            .then(function(data) {
                var list = (data && data.object) || [];
                return list[0] || null;
            })
            .catch(function() { return null; });
    }

    function currentRepoUrl() {
        return loadSettingRow().then(function(row) {
            return core.repoFromSetting(row) || DEFAULT_REPO;
        });
    }

    function validateRepo(url) {
        var parsed = core.parseRepoUrl(url);
        if (!parsed) return Promise.reject(new Error('Адрес должен быть вида https://github.com/owner/repo/'));
        var urls = core.githubUrls(parsed, BRANCH);
        return root.fetch(urls.api).then(function(resp) {
            if (!resp.ok) throw new Error('Репозиторий не найден или приватный: ' + urls.api);
            // Папка templates или download — достаточно одной (issue #4874).
            return Promise.all(['templates', 'download'].map(function(folder) {
                return root.fetch(urls.api + '/contents/' + folder).then(function(r) { return r.ok; })
                    .catch(function() { return false; });
            }));
        }).then(function(folders) {
            if (!folders[0] && !folders[1]) {
                throw new Error('В репозитории нет папки templates или download — такой репозиторий не подходит');
            }
            return parsed;
        });
    }

    function saveRepo() {
        var url = ctx.panel.querySelector('.ru-repo').value;
        status('Проверяем репозиторий…');
        validateRepo(url).then(function() {
            return loadSettingRow().then(function(row) {
                var fields = { 't269': url, 't271': SETTING_TYPE };
                return postForm(row ? '_m_set/' + row.id + '?JSON' : '_m_new/269?JSON&up=1', fields);
            });
        }).then(function() {
            status('Адрес репозитория сохранён: ' + url);
            return refresh();
        }).catch(function(err) {
            status('Не сохранено: ' + (err && err.message ? err.message : err));
        });
    }

    // Листинг одного каталога менеджера. add_path_effective сверяется с запрошенным:
    // несуществующая папка менеджером молча заменяется корнем — считаем её пустой.
    function serverListing(treeParam, sub) {
        var want = sub || '';
        return root.fetch('/' + encodeURIComponent(ctx.db) + '/dir_admin/?' + treeParam
            + '=1&add_path=' + encodeURIComponent(want), { credentials: 'same-origin' })
            .then(function(resp) { return resp.text(); })
            .then(function(html) {
                var got = /name="add_path" type="hidden" value="([^"]*)"/.exec(html);
                var effective = got ? got[1] : want;
                if ((effective || '') !== want) return [];
                return core.parseDirListing(html);
            });
    }

    function renderSummary(diff, repoUrl) {
        ctx.diff = diff;   // план для кнопки «Обновить» (api.run)
        clear(ctx.panel);
        ctx.panel.appendChild(repoRow(repoUrl));
        var head = el('p', {}, [
            el('b', { text: 'Сводка по репозиторию (' + core.BRANCH + '): ' }),
            el('span', { text: 'новых ' + diff.added.length + ', изменились ' + diff.changed.length
                + ', актуальны ' + diff.same.length + ', только на сервере ' + diff.extra.length })
        ]);
        ctx.panel.appendChild(head);
        var list = el('div', { class: 'ru-list' });
        function block(title, paths, emphasize) {
            if (!paths.length) return;
            list.appendChild(el('div', {}, [el('b', { text: title })]));
            paths.forEach(function(p) {
                list.appendChild(el('div', { text: p, style: emphasize ? 'color:#b45309' : '' }));
            });
        }
        block('Новые в репозитории:', diff.added, true);
        block('Отличаются от сервера:', diff.changed, true);
        block('Только на сервере (в репозитории отсутствуют, не трогаем):', diff.extra, false);
        ctx.panel.appendChild(list);

        if (diff.added.length + diff.changed.length) {
            var btn = el('button', { class: 'btn btn-default', type: 'button', text: 'Обновить (' + (diff.added.length + diff.changed.length) + ')' });
            btn.addEventListener('click', function() { api.run(); });
            ctx.panel.appendChild(el('p', {}, [btn]));
        } else {
            ctx.panel.appendChild(el('p', { text: 'Всё актуально — обновлять нечего.' }));
        }
        var log = el('div', { class: 'ru-log', style: 'font-family:monospace;font-size:12px;white-space:pre-wrap' });
        ctx.panel.appendChild(log);
        ctx.panel.appendChild(el('p', { class: 'ru-status', text: '' }));
    }

    // #4878: ИТОГОВЫЙ ОТЧЁТ по кнопке «Обновить» — что получилось сделать.
    // Залитые файлы и ошибки с причинами сервера, время запуска; рядом кнопка
    // «Перепроверить» (свежая сводка сразу после отчёта).
    function renderReport(results, plan, startedMs) {
        var okList = results.filter(function(r) { return r.ok; });
        var errList = results.filter(function(r) { return !r.ok; });
        clear(ctx.panel);
        ctx.panel.appendChild(repoRow(ctx.repoUrl || ''));
        var report = el('div', { class: 'ru-report' });
        report.appendChild(el('h4', { text: 'Отчёт об обновлении (' + core.BRANCH + ')'
            + (startedMs ? ' — ' + new Date(startedMs).toLocaleString() : '') }));
        report.appendChild(el('p', {}, [
            el('b', { text: 'Залито: ' + okList.length + ' из ' + plan.length + '.' }),
            el('span', { text: errList.length ? ' С ошибками: ' + errList.length + '.' : ' Все файлы обновлены.' })
        ]));
        if (okList.length) {
            report.appendChild(el('b', { text: 'Обновлены:' }));
            okList.forEach(function(r) {
                report.appendChild(el('div', { text: '✓ ' + r.repoPath }));
            });
        }
        if (errList.length) {
            report.appendChild(el('b', { text: 'Не удалось:' }));
            errList.forEach(function(r) {
                report.appendChild(el('div', { text: '✗ ' + r.repoPath + ' — ' + r.error, style: 'color:#b91c1c' }));
            });
            report.appendChild(el('p', { text: 'Ошибка прав не снимает остальные файлы: исправьте причину и нажмите «Перепроверить», затем «Обновить» ещё раз.' }));
        }
        var again = el('button', { class: 'btn btn-default', type: 'button', text: 'Перепроверить' });
        again.addEventListener('click', function() { refresh(); });
        report.appendChild(el('p', {}, [again]));
        ctx.panel.appendChild(report);
        ctx.panel.appendChild(el('p', { class: 'ru-status', text: '' }));
    }

    // Строка «Репозиторий: [input] [Сохранить]».
    function repoRow(url) {
        var input = el('input', { class: 'ru-repo form-control', type: 'text', value: url, style: 'display:inline-block;max-width:420px' });
        var btn = el('button', { class: 'btn btn-default', type: 'button', text: 'Сохранить адрес' });
        btn.addEventListener('click', function() { saveRepo(); });
        return el('p', {}, [
            el('span', { text: 'Репозиторий: ' }),
            input, ' ', btn,
            el('span', { text: ' (право записи в таблицу «Настройка»)' })
        ]);
    }

    function logLine(text) {
        var log = ctx.panel.querySelector('.ru-log');
        if (log) log.appendChild(el('div', { text: text }));
    }

    // Заливка по текущему плану (ctx.diff) с журналом прогресса и ИТОГОВЫМ
    // отчётом (#4878): залито/ошибки с причинами. Ошибка одного файла не мешает
    // остальным — все попытки выполняются, отчёт собирается по факту.
    function runUpdate() {
        var diff = ctx.diff;
        if (!diff) return Promise.resolve();
        var startedMs = Date.now();
        var urls = core.githubUrls(core.parseRepoUrl(ctx.repoUrl || core.DEFAULT_REPO), core.BRANCH);
        var plan = core.updatePlan(diff);
        var results = [];
        var chain = Promise.resolve();
        plan.forEach(function(item) {
            chain = chain.then(function() {
                logLine('↧ ' + item.repoPath + ' …');
                return root.fetch(urls.raw(item.repoPath)).then(function(resp) {
                    if (!resp.ok) throw new Error('HTTP ' + resp.status);
                    return resp.text();
                }).then(function(text) {
                    return postForm('dir_admin/?' + item.tree + '=1', {
                        add_path: item.addPath,
                        rewrite: '1',
                        upload: 'Загрузить',
                        userfile: new root.File([text], item.name, { type: 'text/plain' })
                    });
                }).then(function() {
                    logLine('✓ ' + item.repoPath);
                    results.push({ repoPath: item.repoPath, ok: true });
                }).catch(function(err) {
                    results.push({ repoPath: item.repoPath, ok: false,
                        error: err && err.message ? err.message : String(err) });
                    logLine('✗ ' + item.repoPath + ' — ' + results[results.length - 1].error);
                });
            });
        });
        return chain.then(function() {
            renderReport(results, plan, startedMs);
        });
    }

    function refresh() {
        status('Читаем дерево репозитория…');
        return currentRepoUrl().then(function(url) {
            ctx.repoUrl = url;
            clear(ctx.panel);
            ctx.panel.appendChild(repoRow(url));
            ctx.panel.appendChild(el('p', { class: 'ru-status', text: 'Читаем дерево репозитория…' }));
            var parsed = core.parseRepoUrl(url);
            if (!parsed) throw new Error('Адрес репозитория не похож на github.com/owner/repo: ' + url);
            var urls = core.githubUrls(parsed, core.BRANCH);
            return root.fetch(urls.tree).then(function(resp) {
                if (!resp.ok) throw new Error('Дерево репозитория недоступно (HTTP ' + resp.status + ')');
                return resp.json();
            }).then(function(tree) {
                var folders = core.resolveRepoFolders(tree, ctx.db);
                if (!folders.templates && !folders.download) {
                    throw new Error('В репозитории нет папок templates/' + ctx.db + ' и download/' + ctx.db);
                }
                var files = core.repoFiles(tree, folders);
                // Серверные листинги: templates — по подпапкам репо-папки, download — аналогично.
                var subs = {};
                files.forEach(function(f) {
                    var key = f.tree + '|' + f.sub;
                    subs[key] = { tree: f.tree, sub: f.sub };
                });
                var listings = Object.keys(subs).map(function(key) {
                    var s = subs[key];
                    return serverListing(s.tree, s.sub).then(function(list) {
                        return { key: key, list: list };
                    });
                });
                return Promise.all(listings).then(function(results) {
                    // Слияние листингов одного дерева: имена уникальны внутри (sub, tree),
                    // но сверять надо по (tree, sub, name) — diffFiles сверяет по имени
                    // внутри пары, поэтому группируем строго по ключу.
                    var grouped = {};
                    results.forEach(function(r) { grouped[r.key] = r.list; });
                    var merged = { same: [], changed: [], added: [], extra: [], meta: {} };
                    files.forEach(function(f) {
                        var key = f.tree + '|' + f.sub;
                        var one = core.diffWithMeta([f], grouped[key] || []);
                        ['same', 'changed', 'added'].forEach(function(bucket) {
                            if (one[bucket].length) merged[bucket].push(one[bucket][0]);
                        });
                        (one.extra || []).forEach(function(name) {
                            if (merged.extra.indexOf(name) === -1) merged.extra.push(name);
                        });
                        merged.meta[f.repoPath] = f;
                    });
                    renderSummary(merged, url);
                });
            });
        }).catch(function(err) {
            // Ошибка — не строчкой в углу, а текстом в панели: «в базе нет папок в
            // репозитории» читался бы пустотой (#4878).
            var text = 'Не получилось: ' + (err && err.message ? err.message : err);
            var existing = ctx.panel.querySelector('.ru-status');
            if (existing) existing.textContent = text;
            else ctx.panel.appendChild(el('p', { text: text }));
        });
    }

    var core = {
        BRANCH: BRANCH,
        DEFAULT_REPO: DEFAULT_REPO,
        parseRepoUrl: parseRepoUrl,
        githubUrls: githubUrls,
        resolveRepoFolders: resolveRepoFolders,
        repoFiles: repoFiles,
        toBytes: toBytes,
        parseDirListing: parseDirListing,
        diffFiles: diffFiles,
        diffWithMeta: diffWithMeta,
        updatePlan: updatePlan,
        repoFromSetting: repoFromSetting
    };

    var api = {
        core: core,
        // Шаблон: RepoUpdate.init({db: db, xsrf: document.view_dir._xsrf.value});
        // #4876: каким бы ни было окружение, init не роняет страницу — нет панели
        // (или document без getElementById) — open() молча не делает ничего.
        run: function() { return runUpdate(); },
        init: function(opts) {
            ctx.db = trimText(opts && opts.db);
            ctx.xsrf = trimText(opts && opts.xsrf);
            try {
                ctx.panel = root.document && root.document.getElementById
                    ? root.document.getElementById('repo-update')
                    : null;
            } catch (e) {
                ctx.panel = null;
                if (root.console) root.console.error('[repo-update] панель «repo-update» недоступна:', e && e.message ? e.message : e);
            }
        },
        open: function() {
            if (!ctx.panel) return;
            try {
                refresh();
            } catch (e) {
                status('Не получилось: ' + (e && e.message ? e.message : e));
            }
        }
    };
    return api;
});
