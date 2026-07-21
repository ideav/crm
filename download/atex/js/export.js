// Рабочее место atex «Выгрузка/Загрузка заказов и заданий» (экспорт/импорт).
//
// Решение ideav/crm#4308. Правила разработки — docs/WORKSPACE_DEVELOPMENT_GUIDE.md.
// URL: /atex/export. Шаблон templates/atex/export.html, стили download/atex/css/export.css.
//
// ЧТО ДЕЛАЕТ:
//   • «Выгрузить» — по галкам (заказы и/или задания) читает ВСЕ записи выбранных деревьев
//     СО ВСЕМИ ПОДЧИНЁННЫМИ таблицами и скачивает единый JSON-файл
//     {дата-время}[_заказы][_задания].json.
//   • «Загрузить» — читает ранее выгруженный файл, СНАЧАЛА проверяет его целостность и
//     показывает отчёт; по подтверждении МАССОВО УДАЛЯЕТ таблицы выбранных деревьев (в порядке
//     зависимостей) и ПЕРЕСОЗДАЁТ записи из файла, пересвязывая ссылки по карте old→new id.
//
// ДЕРЕВЬЯ (родитель → потомок; up = «Подчинён»):
//   Заказы:  Заказ (up=1) → Заказанное количество/Позиция заказа (up=Заказ)
//   Задания: Задание в производство/Производственная резка (up=1) → Партия ГП (up=резка),
//            Полоса (up=резка); Обеспечение (up=позиция) — ссылается на резку и Партию ГП;
//            Задание на втулки (up=позиция).
// Обеспечение/Задание-на-втулки структурно висят на ПОЗИЦИИ заказа, поэтому файл с заданиями
// самодостаточен ТОЛЬКО вместе с заказами (проверка целостности это требует, issue #4308).
//
// Id таблиц и реквизитов НЕ хардкодятся — резолвятся по именам из GET /{db}/metadata.
// Чистое ядро (проверка целостности, план пересвязки) экспортируется через module.exports для
// тестов (experiments/atex-export-4308.test.js).

(function(root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') {
        window.AtexExport = api;
        if (typeof document !== 'undefined') {
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', api.init);
            else api.init();
        }
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    'use strict';

    var FORMAT = 'atex-orders-tasks-export';
    var SCHEMA_VERSION = 1;
    var READ_LIMIT = 50000;   // потолок чтения таблицы (object/…?JSON_OBJ&LIMIT=0,N)

    // Канонические ключи таблиц, их имена (с синонимами) и структура дерева.
    // parent: ключ родительской таблицы или null (корень, up=1). tree: 'orders' | 'tasks'.
    var TABLES = [
        { key: 'order',      names: ['Заказ'],                                     parent: null,       tree: 'orders' },
        { key: 'position',   names: ['Заказанное количество', 'Позиция заказа'],   parent: 'order',    tree: 'orders' },
        { key: 'cut',        names: ['Задание в производство', 'Производственная резка'], parent: null, tree: 'tasks' },
        { key: 'batch',      names: ['Партия ГП'],                                 parent: 'cut',      tree: 'tasks' },
        { key: 'strip',      names: ['Полоса'],                                    parent: 'cut',      tree: 'tasks' },
        { key: 'sleeveTask', names: ['Задача на втулки', 'Задание на втулки'],     parent: 'position', tree: 'tasks' },
        { key: 'supply',     names: ['Обеспечение'],                               parent: 'position', tree: 'tasks' }
    ];
    var TABLE_BY_KEY = {}; TABLES.forEach(function(t) { TABLE_BY_KEY[t.key] = t; });
    // Порядок ПЕРЕСОЗДАНИЯ (родитель раньше потомка/ссылки).
    var CREATE_ORDER = ['order', 'position', 'cut', 'batch', 'strip', 'sleeveTask', 'supply'];
    // Порядок УДАЛЕНИЯ (ссылки/потомки раньше родителей): обратный + Обеспечение (ссылки на резку) первым.
    var DELETE_ORDER = ['supply', 'sleeveTask', 'strip', 'batch', 'cut', 'position', 'order'];

    // Внутренние ссылки-РЕКВИЗИТЫ (кроме up) на таблицы нашего экспорта — их id надо пересвязать.
    // req — имя реквизита; target — ключ таблицы-цели; list — мультизначение (id через запятую).
    // На ateh Обеспечение ссылается ТОЛЬКО на «Партию ГП» (ref→1081); связь с резкой — косвенная
    // (Обеспечение→Партия ГП→up=резка), отдельного реквизита «Задание в производство» у Обеспечения нет.
    var REF_FIELDS = {
        cut:    [{ req: 'ID первой части', target: 'cut',   list: false }],
        batch:  [{ req: 'ID заказа',       target: 'order', list: true  }],
        supply: [{ req: 'Партия ГП',       target: 'batch', list: false }]
    };

    // ── Чистые помощники метаданных/значений (без DOM) ──────────────────────────────────────────

    function norm(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
    function aliasOf(entry) {
        if (!entry) return '';
        if (entry.alias != null && entry.alias !== '') return String(entry.alias);
        if (entry.attrs) {
            try { var a = typeof entry.attrs === 'string' ? JSON.parse(entry.attrs) : entry.attrs;
                if (a && a.alias != null) return String(a.alias); } catch (e) {}
        }
        return '';
    }
    function matchesName(entry, name) {
        var t = norm(name); if (!entry || t === '') return false;
        return norm(entry.val) === t || norm(aliasOf(entry)) === t;
    }
    function tableByAnyName(list, names) {
        var arr = Array.isArray(list) ? list : (list == null ? [] : [list]);
        for (var n = 0; n < (names || []).length; n++)
            for (var i = 0; i < arr.length; i++) if (matchesName(arr[i], names[n])) return arr[i];
        return null;
    }
    function reqByName(meta, name) { return tableByAnyName((meta && meta.reqs) || [], [name]); }
    function reqIdByName(meta, name) { var r = reqByName(meta, name); return r ? String(r.id) : null; }
    // Индекс значения реквизита в массиве record.r ([main, ...reqs в порядке meta.reqs]).
    function columnIndex(meta, reqName) {
        if (!meta) return -1;
        var order = [String(meta.id)].concat((meta.reqs || []).map(function(r) { return String(r.id); }));
        var rid = reqIdByName(meta, reqName);
        return rid == null ? -1 : order.indexOf(String(rid));
    }
    // «id:Label» → id (мультиссылка «id1,id2:...» → «id1,id2»). Не ссылка → как есть.
    function refIdPart(raw) {
        var s = String(raw == null ? '' : raw);
        var m = s.match(/^([\d,]+):[\s\S]*$/);
        return m ? m[1] : s;
    }
    function isRefCell(raw) { return /^[\d,]+:[\s\S]*$/.test(String(raw == null ? '' : raw)); }

    // ── Чистое ядро: проверка целостности файла (тест) ──────────────────────────────────────────
    // Возвращает { ok, trees, counts, errors:[str], warnings:[str] }.
    //  • структурная целостность: у каждой записи резолвится up (родитель есть в файле) и все
    //    внутренние ссылки-реквизиты (supply→резка/Партия ГП, batch→заказ, cut→перв.часть);
    //  • самодостаточность: задания структурно висят на позициях заказов, поэтому при наличии
    //    заданий в файле ОБЯЗАНЫ быть и заказы (иначе ссылки не пересвязать) — issue #4308.
    function buildIntegrityReport(pkg) {
        var errors = [], warnings = [];
        if (!pkg || pkg.format !== FORMAT) return { ok: false, trees: {}, counts: {}, errors: ['Неизвестный формат файла (ожидался «' + FORMAT + '»)'], warnings: [] };
        if (Number(pkg.version) !== SCHEMA_VERSION) warnings.push('Версия схемы файла ' + pkg.version + ' ≠ текущей ' + SCHEMA_VERSION + ' — проверьте совместимость');
        var tables = pkg.tables || {};
        var present = {};   // key → true если таблица есть в файле
        var idSet = {};     // key → { oldId: true }
        var counts = {};
        CREATE_ORDER.forEach(function(key) {
            var t = tables[key];
            if (!t) return;
            present[key] = true;
            idSet[key] = {};
            counts[key] = (t.records || []).length;
            (t.records || []).forEach(function(r) {
                if (r && r.id != null) idSet[key][String(r.id)] = true;
            });
        });
        var trees = {
            orders: !!(present.order || present.position),
            tasks: !!(present.cut || present.batch || present.strip || present.sleeveTask || present.supply)
        };
        // Заявленные счётчики совпадают с фактическими записями.
        if (pkg.counts) Object.keys(pkg.counts).forEach(function(key) {
            if (present[key] && Number(pkg.counts[key]) !== counts[key])
                errors.push('Таблица «' + (TABLE_BY_KEY[key] ? TABLE_BY_KEY[key].key : key) + '»: заявлено ' + pkg.counts[key] + ' записей, в файле ' + counts[key]);
        });
        // Самодостаточность: задания требуют заказов (позиции — родитель Обеспечения/втулок).
        if (trees.tasks && !trees.orders)
            errors.push('Файл не самодостаточен: есть задания, но нет заказов — Обеспечение/«Задание на втулки» висят на позициях заказов. Выгрузите заказы вместе с заданиями.');
        // Структурная целостность: up и ссылки-реквизиты.
        function resolvable(targetKey, id) {
            if (!present[targetKey]) return false;           // целевого дерева нет в файле
            return !!(idSet[targetKey] && idSet[targetKey][String(id)]);
        }
        CREATE_ORDER.forEach(function(key) {
            if (!present[key]) return;
            var t = tables[key], parent = TABLE_BY_KEY[key].parent;
            var refs = REF_FIELDS[key] || [];
            var dangUp = 0, dangRef = 0;
            (t.records || []).forEach(function(r) {
                if (parent) {
                    var up = String(r.up == null ? '' : r.up);
                    if (up !== '' && up !== '1' && !resolvable(parent, up)) dangUp++;
                }
                refs.forEach(function(rf) {
                    var raw = r.values ? r.values[rf.req] : undefined;
                    if (raw == null || String(raw).trim() === '') return;
                    var ids = refIdPart(raw).split(',').map(function(x) { return x.trim(); }).filter(Boolean);
                    ids.forEach(function(id) { if (!resolvable(rf.target, id)) dangRef++; });
                });
            });
            if (dangUp) errors.push('Таблица «' + key + '»: у ' + dangUp + ' записей родитель (up) не найден в файле');
            if (dangRef) errors.push('Таблица «' + key + '»: ' + dangRef + ' ссылок ведут на записи, которых нет в файле');
        });
        return { ok: errors.length === 0, trees: trees, counts: counts, errors: errors, warnings: warnings };
    }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    // Имя файла: {ГГГГ-ММ-ДД_ЧЧ-ММ}[_заказы][_задания].json (now — Date).
    function exportFileName(now, trees) {
        var d = now || new Date();
        var stamp = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
            + '_' + pad2(d.getHours()) + '-' + pad2(d.getMinutes());
        return stamp + (trees.orders ? '_заказы' : '') + (trees.tasks ? '_задания' : '') + '.json';
    }

    // ── Контроллер (DOM/сеть) ───────────────────────────────────────────────────────────────────

    function Controller(root) {
        this.root = root;
        this.db = (typeof window !== 'undefined' && window.db) || root.getAttribute('data-db') || '';
        this.meta = {};          // key → метаданные таблицы
        this.rollupNames = {};   // key → { reqName: true } — подтабличные РОЛЛАП-колонки (не пишем при импорте)
        this.busy = false;
        this.pendingImport = null;   // { pkg, report } — ждёт подтверждения загрузки
        this.exportSel = { orders: true, tasks: true };
    }

    Controller.prototype.url = function(path) { return '/' + encodeURIComponent(this.db) + '/' + path; };

    Controller.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            return resp.text().then(function(text) {
                var j; try { j = JSON.parse(text); } catch (e) { throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200)); }
                if (j && (j.error || j.err)) throw new Error(j.error || j.err);
                if (Array.isArray(j) && j[0] && j[0].error) throw new Error(j[0].error);
                return j;
            });
        });
    };

    Controller.prototype.post = function(path, params) {
        var body = new URLSearchParams();
        body.set('_xsrf', (typeof window !== 'undefined' && window.xsrf) || this.root.getAttribute('data-xsrf') || '');
        Object.keys(params || {}).forEach(function(k) { if (params[k] != null) body.set(k, params[k]); });
        return fetch(this.url(path), {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
        }).then(function(resp) {
            return resp.text().then(function(text) {
                var j; try { j = JSON.parse(text); } catch (e) { throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200)); }
                if (j && (j.error || j.err)) throw new Error(j.error || j.err);
                if (Array.isArray(j) && j[0] && j[0].error) throw new Error(j[0].error);
                return j;
            });
        });
    };

    Controller.prototype.loadMetadata = function() {
        var self = this;
        return this.getJson('metadata').then(function(all) {
            var list = Array.isArray(all) ? all : [all];
            TABLES.forEach(function(t) { self.meta[t.key] = tableByAnyName(list, t.names); });
            var missing = TABLES.filter(function(t) { return !self.meta[t.key]; }).map(function(t) { return t.names[0]; });
            if (missing.length) throw new Error('В метаданных не найдены таблицы: ' + missing.join(', '));
            // Подтабличные РОЛЛАП-колонки (счётчик/список дочерних записей): req.orig = id ТАБЛИЦЫ и НЕТ
            // ref. Их значение вычисляет сервер по потомкам — не выгружаем и не пишем (напр. «Обеспечение»
            // на позиции = orig 1077, «Заказанное количество» на заказе = orig 1076). Обычная ссылка
            // (напр. «Партия ГП» на Обеспечении) имеет ref → НЕ роллап, сохраняется.
            var tableIds = {}; list.forEach(function(t) { if (t && t.id != null) tableIds[String(t.id)] = true; });
            TABLES.forEach(function(t) {
                var m = self.meta[t.key], set = {};
                (m.reqs || []).forEach(function(rq) {
                    if (!rq.ref && rq.orig != null && tableIds[String(rq.orig)]) set[rq.val] = true;
                });
                self.rollupNames[t.key] = set;
            });
        });
    };

    // Строка object/JSON_OBJ ({i,u,r}) → { id, up, main, values:{reqName: rawCell} } (без роллап-колонок).
    Controller.prototype.mapRows = function(key, rows) {
        var meta = this.meta[key], rollup = this.rollupNames[key] || {}, reqs = (meta.reqs || []);
        return (rows || []).map(function(rec) {
            var r = rec.r || [], values = {};
            reqs.forEach(function(rq) {
                if (rollup[rq.val]) return;   // подтабличная роллап-колонка — сервер считает сам
                var idx = columnIndex(meta, rq.val);
                if (idx >= 0 && r[idx] != null && String(r[idx]) !== '') values[rq.val] = String(r[idx]);
            });
            return { id: String(rec.i), up: rec.u == null ? '' : String(rec.u), main: r[0] == null ? '' : String(r[0]), values: values };
        });
    };
    // Корневая таблица (up=1): object/<id>/?JSON_OBJ&LIMIT — отдаёт все записи.
    Controller.prototype.readRoot = function(key) {
        var self = this, meta = this.meta[key];
        return this.getJson('object/' + meta.id + '/?JSON_OBJ&LIMIT=0,' + READ_LIMIT)
            .then(function(rows) { return self.mapRows(key, rows); });
    };
    // Подчинённая таблица: object/<id> отдаёт ТОЛЬКО корень, поэтому читаем ПО РОДИТЕЛЯМ (F_U=parentId).
    Controller.prototype.readChildrenOf = function(key, parentIds) {
        var self = this, meta = this.meta[key], out = [], chain = Promise.resolve();
        (parentIds || []).forEach(function(pid) {
            chain = chain.then(function() {
                return self.getJson('object/' + meta.id + '/?JSON_OBJ&F_U=' + encodeURIComponent(pid) + '&LIMIT=0,' + READ_LIMIT)
                    .then(function(rows) { out = out.concat(self.mapRows(key, rows)); });
            });
        });
        return chain.then(function() { return out; });
    };
    // Прочитать записи для wantKeys + их предков (для F_U потомка нужен уже прочитанный родитель).
    // Обеспечение/«Задача на втулки» висят на позиции — их чтение тянет заказы+позиции даже когда
    // выгружаем только задания (в файл заказы попадут лишь при отмеченной галке «заказы»).
    // → { key: [records] } (включая предков). Порядок обхода — CREATE_ORDER (родитель раньше потомка).
    Controller.prototype.readGraph = function(wantKeys) {
        var self = this, need = {}, byKey = {}, chain = Promise.resolve();
        (wantKeys || []).forEach(function(k) { for (var cur = k; cur; cur = TABLE_BY_KEY[cur].parent) need[cur] = true; });
        CREATE_ORDER.forEach(function(key) {
            if (!need[key]) return;
            chain = chain.then(function() {
                var tdef = TABLE_BY_KEY[key];
                if (!tdef.parent) return self.readRoot(key).then(function(recs) { byKey[key] = recs; });
                var pids = (byKey[tdef.parent] || []).map(function(r) { return r.id; });
                return self.readChildrenOf(key, pids).then(function(recs) { byKey[key] = recs; });
            });
        });
        return chain.then(function() { return byKey; });
    };

    // ── Выгрузка ──
    Controller.prototype.doExport = function() {
        var self = this;
        if (this.busy) return;
        var sel = this.exportSel;
        if (!sel.orders && !sel.tasks) { this.notify('Отметьте хотя бы одно: заказы или задания', 'warn'); return; }
        var keys = TABLES.filter(function(t) { return sel[t.tree]; }).map(function(t) { return t.key; });
        this.setBusy(true, 'Чтение данных…');
        var pkg = { format: FORMAT, version: SCHEMA_VERSION, exportedAt: new Date().toISOString(),
            db: this.db, trees: { orders: !!sel.orders, tasks: !!sel.tasks }, tables: {}, counts: {} };
        // Читаем граф (нужные таблицы + предков для F_U); в ФАЙЛ кладём только выбранные деревья.
        return this.readGraph(keys).then(function(byKey) {
            keys.forEach(function(key) {
                var records = byKey[key] || [];
                pkg.tables[key] = { name: self.meta[key].val, key: key,
                    reqNames: (self.meta[key].reqs || []).map(function(r) { return r.val; }), records: records };
                pkg.counts[key] = records.length;
            });
            downloadJson(pkg, exportFileName(new Date(), pkg.trees));
            self.setBusy(false);
            self.notify('Выгружено: ' + keys.map(function(k) { return k + ' ' + pkg.counts[k]; }).join(', '), 'ok');
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('Ошибка выгрузки: ' + (err && err.message || err), 'error');
        });
    };

    // ── Загрузка: разбор файла + проверка целостности → отчёт ──
    Controller.prototype.handleFile = function(file) {
        var self = this;
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function() {
            var pkg;
            try { pkg = JSON.parse(String(reader.result)); }
            catch (e) { self.pendingImport = null; self.notify('Файл не является корректным JSON', 'error'); self.render(); return; }
            var report = buildIntegrityReport(pkg);
            self.pendingImport = { pkg: pkg, report: report, fileName: file.name };
            self.render();
        };
        reader.onerror = function() { self.notify('Не удалось прочитать файл', 'error'); };
        reader.readAsText(file);
    };

    // ── Подтверждённая загрузка: удалить деревья файла + пересоздать с пересвязкой ──
    Controller.prototype.runImport = function() {
        var self = this;
        if (this.busy || !this.pendingImport || !this.pendingImport.report.ok) return;
        var pkg = this.pendingImport.pkg;
        var present = {}; Object.keys(pkg.tables || {}).forEach(function(k) { present[k] = true; });
        this.setBusy(true, 'Чтение текущих записей…');
        // 1) УДАЛЕНИЕ: читаем ТЕКУЩИЙ граф таблиц деревьев файла и удаляем в порядке зависимостей
        //    (ссылки/потомки раньше родителей: Обеспечение → втулки → полосы → Партии ГП → резки →
        //    позиции → заказы). Уже удалённое каскадом «no such record» — глотаем.
        var delKeys = DELETE_ORDER.filter(function(k) { return present[k]; });
        var deleted = 0;
        var chain = this.readGraph(delKeys).then(function(cur) {
            var sub = Promise.resolve();
            delKeys.forEach(function(key) {
                (cur[key] || []).forEach(function(rec) {
                    sub = sub.then(function() {
                        return self.post('_m_del/' + encodeURIComponent(rec.id) + '?JSON', {})
                            .then(function() { deleted++; self.setBusy(true, 'Удаление… (' + deleted + ')'); })
                            .catch(function(e) { if (!/no such record|нет .*запис/i.test(String(e && e.message))) throw e; });
                    });
                });
            });
            return sub;
        });
        // 2) ПЕРЕСОЗДАНИЕ: родитель раньше потомка; карта old→new id для пересвязки up и ссылок.
        var idMap = {};   // key → { oldId: newId }
        var created = 0;
        CREATE_ORDER.forEach(function(key) {
            if (!present[key]) return;
            idMap[key] = idMap[key] || {};
            chain = chain.then(function() {
                var records = (pkg.tables[key].records || []);
                var sub = Promise.resolve();
                records.forEach(function(rec) {
                    sub = sub.then(function() { return self.createRecord(key, rec, idMap); })
                        .then(function() { created++; self.setBusy(true, 'Создание… (' + created + ')'); });
                });
                return sub;
            });
        });
        return chain.then(function() {
            self.setBusy(false);
            self.pendingImport = null;
            self.notify('Загрузка завершена: удалено ' + deleted + ', создано ' + created + ' записей', 'ok');
            self.render();
        }).catch(function(err) {
            self.setBusy(false);
            self.notify('ОШИБКА загрузки (данные могли частично измениться!): ' + (err && err.message || err), 'error');
            self.render();
        });
    };

    // Создать одну запись с пересвязкой up + ссылок; записать new id в idMap.
    // Порядок (гайд §3): _m_new (создать под up) → _m_save (главное значение, ПЕРВАЯ колонка) →
    // _m_set (остальные реквизиты). full=1 — на случай длинных/HTML-полей (обрезка VAL_LIM=127).
    Controller.prototype.createRecord = function(key, rec, idMap) {
        var self = this;
        var meta = this.meta[key], tdef = TABLE_BY_KEY[key];
        // up: корень → 1; иначе new id родителя из карты (если не нашли — оставляем как есть).
        var up = '1';
        if (tdef.parent) {
            var oldUp = String(rec.up == null ? '' : rec.up);
            up = (idMap[tdef.parent] && idMap[tdef.parent][oldUp]) || oldUp || '1';
        }
        var refByReq = {}; (REF_FIELDS[key] || []).forEach(function(rf) { refByReq[rf.req] = rf; });
        var setFields = {};
        Object.keys(rec.values || {}).forEach(function(reqName) {
            var reqId = reqIdByName(meta, reqName);
            if (!reqId) return;   // такого реквизита нет в целевой схеме — пропускаем
            var raw = rec.values[reqName], rf = refByReq[reqName], val;
            if (rf) {   // внутренняя ссылка — пересвязать id по карте цели (мультизначение — по каждому id)
                val = refIdPart(raw).split(',').map(function(id) {
                    id = id.trim(); return (idMap[rf.target] && idMap[rf.target][id]) || id;
                }).filter(Boolean).join(',');
            } else if (isRefCell(raw)) {
                val = refIdPart(raw);   // внешняя ссылка (Слиттер/Сырьё/…): id как есть — цель не пересоздаём
            } else {
                val = raw;
            }
            setFields['t' + reqId] = val;
        });
        var mainVal = rec.main == null ? '' : String(rec.main);
        return this.post('_m_new/' + meta.id + '?JSON&up=' + encodeURIComponent(up), {}).then(function(res) {
            var newId = res && (res.obj || res.id || res.i);
            if (!newId) throw new Error('Сервер не вернул id новой записи таблицы «' + key + '»');
            idMap[key][String(rec.id)] = String(newId);
            var chain = Promise.resolve();
            if (mainVal !== '') {
                var mf = {}; mf['t' + meta.id] = mainVal;
                chain = chain.then(function() { return self.post('_m_save/' + encodeURIComponent(newId) + '?JSON&full=1', mf); });
            }
            if (Object.keys(setFields).length) {
                chain = chain.then(function() { return self.post('_m_set/' + encodeURIComponent(newId) + '?JSON&full=1', setFields); });
            }
            return chain;
        });
    };

    // ── Отрисовка ──
    Controller.prototype.setBusy = function(b, msg) {
        this.busy = !!b;
        this.root.classList.toggle('is-busy', !!b);
        var st = this.root.querySelector('.atex-exp-status');
        if (st) st.textContent = b ? (msg || 'Работаю…') : '';
    };
    Controller.prototype.notify = function(msg, kind) {
        var box = this.root.querySelector('.atex-exp-toast');
        if (!box) return;
        box.textContent = msg;
        box.className = 'atex-exp-toast is-' + (kind || 'info') + ' is-shown';
        var self = this;
        clearTimeout(this._toastT);
        if (kind !== 'error') this._toastT = setTimeout(function() { box.classList.remove('is-shown'); }, 6000);
    };

    Controller.prototype.render = function() {
        var self = this, root = this.root;
        root.innerHTML = '';
        root.appendChild(elh('h2', 'atex-exp-title', 'Выгрузка / Загрузка заказов и заданий'));
        root.appendChild(elh('p', 'atex-exp-note',
            'Экспорт/импорт СО ВСЕМИ подчинёнными таблицами. Загрузка МАССОВО УДАЛЯЕТ таблицы заказов/заданий (с учётом связей) и пересоздаёт записи из файла.'));

        // Выгрузка
        var expCard = elh('div', 'atex-exp-card');
        expCard.appendChild(elh('h3', 'atex-exp-card-title', '1. Выгрузить'));
        var cbOrders = checkbox('Заказы (Заказ + Заказанное количество)', this.exportSel.orders, function(v) { self.exportSel.orders = v; });
        var cbTasks = checkbox('Задания в производство (Резка + Партия ГП + Полоса + Обеспечение + Втулки)', this.exportSel.tasks, function(v) { self.exportSel.tasks = v; });
        expCard.appendChild(cbOrders); expCard.appendChild(cbTasks);
        expCard.appendChild(elh('div', 'atex-exp-hint', 'Для восстановления заданий нужны и заказы (задания ссылаются на позиции заказов) — отмечайте обе галки.'));
        var expBtn = elh('button', 'atex-exp-btn atex-exp-btn-primary', 'Выгрузить');
        expBtn.type = 'button';
        expBtn.addEventListener('click', function() { self.doExport(); });
        expCard.appendChild(expBtn);
        root.appendChild(expCard);

        // Загрузка
        var impCard = elh('div', 'atex-exp-card');
        impCard.appendChild(elh('h3', 'atex-exp-card-title', '2. Загрузить'));
        var fileInput = document.createElement('input');
        fileInput.type = 'file'; fileInput.accept = '.json,application/json'; fileInput.className = 'atex-exp-file';
        fileInput.addEventListener('change', function(e) { if (e.target.files && e.target.files[0]) self.handleFile(e.target.files[0]); });
        impCard.appendChild(fileInput);
        if (this.pendingImport) impCard.appendChild(this.renderReport());
        root.appendChild(impCard);

        root.appendChild(elh('div', 'atex-exp-status', ''));
        var toast = elh('div', 'atex-exp-toast', ''); root.appendChild(toast);
    };

    Controller.prototype.renderReport = function() {
        var self = this, pend = this.pendingImport, rep = pend.report;
        var box = elh('div', 'atex-exp-report' + (rep.ok ? ' is-ok' : ' is-bad'));
        box.appendChild(elh('div', 'atex-exp-report-title', 'Проверка файла «' + pend.fileName + '»'));
        var counts = Object.keys(rep.counts).map(function(k) { return k + ': ' + rep.counts[k]; }).join(' · ');
        box.appendChild(elh('div', 'atex-exp-report-line', 'Деревья: ' + (rep.trees.orders ? 'заказы ' : '') + (rep.trees.tasks ? 'задания' : '') + '  |  записей — ' + (counts || '—')));
        (rep.warnings || []).forEach(function(w) { box.appendChild(elh('div', 'atex-exp-report-warn', '⚠ ' + w)); });
        (rep.errors || []).forEach(function(e) { box.appendChild(elh('div', 'atex-exp-report-err', '✗ ' + e)); });
        if (rep.ok) {
            box.appendChild(elh('div', 'atex-exp-report-ok', '✓ Целостность в порядке. Загрузка УДАЛИТ текущие записи выбранных деревьев и заменит их данными из файла.'));
            var go = elh('button', 'atex-exp-btn atex-exp-btn-danger', 'Подтвердить загрузку (удалить и заменить)');
            go.type = 'button';
            go.addEventListener('click', function() { self.runImport(); });
            box.appendChild(go);
        } else {
            box.appendChild(elh('div', 'atex-exp-report-err', 'Загрузка невозможна — исправьте файл (см. ошибки выше).'));
        }
        var cancel = elh('button', 'atex-exp-btn', 'Отмена');
        cancel.type = 'button';
        cancel.addEventListener('click', function() { self.pendingImport = null; self.render(); });
        box.appendChild(cancel);
        return box;
    };

    // ── DOM-помощники ──
    function elh(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
    function checkbox(label, checked, onChange) {
        var wrap = elh('label', 'atex-exp-check');
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!checked;
        cb.addEventListener('change', function() { onChange(cb.checked); });
        wrap.appendChild(cb); wrap.appendChild(document.createTextNode(' ' + label));
        return wrap;
    }
    function downloadJson(data, filename) {
        var text = JSON.stringify(data, null, 2);
        var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url; link.download = String(filename).replace(/[\\/:*?"<>|]+/g, '_');
        document.body.appendChild(link); link.click(); link.remove();
        URL.revokeObjectURL(url);
    }

    Controller.prototype.start = function() {
        var self = this;
        this.render();
        this.setBusy(true, 'Загрузка метаданных…');
        return this.loadMetadata().then(function() { self.setBusy(false); self.render(); })
            .catch(function(err) { self.setBusy(false); self.notify('Ошибка инициализации: ' + (err && err.message || err), 'error'); });
    };

    function init() {
        if (typeof document === 'undefined') return;
        var root = document.getElementById('atex-export');
        if (!root || root.dataset.initialized === '1') return;
        root.dataset.initialized = '1';
        new Controller(root).start();
    }

    return {
        init: init, Controller: Controller,
        // чистое ядро для тестов:
        buildIntegrityReport: buildIntegrityReport,
        exportFileName: exportFileName,
        refIdPart: refIdPart, isRefCell: isRefCell,
        FORMAT: FORMAT, SCHEMA_VERSION: SCHEMA_VERSION,
        TABLES: TABLES, CREATE_ORDER: CREATE_ORDER, DELETE_ORDER: DELETE_ORDER, REF_FIELDS: REF_FIELDS
    };
});
