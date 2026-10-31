// Рабочее место atex «Ножи и валы» (роли Технолог, Диспетчер; ideav/crm#5314).
//
// Справочник ножей и валов — компонент integram-table над таблицами «Нож» и «Вал»
// (поиск, фильтры, правка, «+ запись», экспорт). Рядом с гридом — то, чего в таблице нет:
//   - пробег ножей: отчёт `die_runs` (все движения пробега одной выборкой) →
//     `dieMileageIndex` из label-production.js: сумма движений за всю жизнь ножа;
//   - ресурс ножа: у его марки (справочник «Марка ножа», «Ресурс, м»), без марки — настройка
//     DIE_RESOURCE_DEFAULT_M таблицы «Настройка»; ресурса нет нигде — «у ресурса» не считается;
//   - показатели: ножей всего / рабочих / у ресурса / резерв, экспертиза / списано;
//   - карточка ножа: марка, пробег и % ресурса, история движений с «Накоплено», кнопки смены
//     состояния (`dieStateActions`). Ножи не затачиваются: выработавший ресурс нож списывается;
//   - валы: раппорт, станки, на которые вал встаёт («Допустимые валы» станка; пусто — любой
//     вал), число ножей на валу.
//
// Таблицы и реквизиты резолвятся по именам из /metadata (resolveProductionTables), id в коде нет.

(function(root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') {
        window.AtexDies = api;
        var start = function() {
            var el = document.getElementById('atex-dies-app');
            if (el && !el.__atexDies) el.__atexDies = new api.AtexDies(el).start();
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
        else start();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
    'use strict';

    var LP = (root && root.AtexLabelProduction) ||
        (typeof require === 'function' ? require('../../atex/js/label-production.js') : null);
    var lp = LP ? LP.core : null;

    var RESOURCE_KEY = 'DIE_RESOURCE_DEFAULT_M';
    var RUNS_REPORT = 'die_runs';
    var MAX_CYLINDER = 'Макс. вал';   // реквизит станка высечки: наибольший вал, зубьев (#5344)

    // ── Чистые функции (покрыты experiments/atex-p2-5314-dies.test.js) ──────────

    // Ответ object/{t}/?JSON_KV → [{ id, val, reqs }]: главные значения — в `object[]`,
    // реквизиты — в `reqs[id]` (ключ = id реквизита, ссылка — ещё `ref_{id}` = «таблица:id,id»).
    function kvRecords(json) {
        var reqs = (json && json.reqs) || {};
        return ((json && json.object) || []).map(function(o) {
            return { id: String(o.id), val: o.val == null ? '' : String(o.val), reqs: reqs[o.id] || {} };
        });
    }

    function refIds(rec, reqId) {
        var raw = rec && rec.reqs ? rec.reqs['ref_' + reqId] : null;
        if (raw == null || String(raw).trim() === '') return [];
        var s = String(raw).replace(/^\s*\d+:/, '');
        return s.split(',').map(function(x) { return x.trim(); }).filter(Boolean);
    }

    function reqVal(rec, reqId) {
        var v = rec && rec.reqs && reqId ? rec.reqs[reqId] : null;
        return v == null ? '' : String(v);
    }

    function num(v) {
        var n = Number(String(v == null ? '' : v).replace(',', '.'));
        return isFinite(n) ? n : 0;
    }

    // Значение настройки: строка с типом базы важнее строки «ATEH», та — важнее общей
    // (тот же порядок, что у loadDaySettings планирования). recs — [{ key, type, value }].
    function settingValue(recs, key, db) {
        var dbKey = String(db || '').trim().toUpperCase();
        var best = null, bestRank = 0;
        (recs || []).forEach(function(r) {
            if (String(r.key || '').replace(/^﻿/, '').trim() !== key) return;
            var v = String(r.value == null ? '' : r.value).trim();
            if (v === '') return;
            var type = String(r.type || '').trim().toUpperCase();
            var rank = dbKey && type === dbKey ? 3 : (type === 'ATEH' ? 2 : 1);
            if (rank >= bestRank) { best = v; bestRank = rank; }
        });
        return best == null ? '' : best;
    }

    // Справочник «Марка ножа» → { id марки: ресурс (строка, «» — не задан) }.
    function brandResources(brandRecs, brandTable) {
        var col = brandTable && brandTable.reqs ? brandTable.reqs.resource : '';
        var out = {};
        (brandRecs || []).forEach(function(b) { out[b.id] = reqVal(b, col).trim(); });
        return out;
    }

    // Строки ножей для показателей и карточки.
    // t — resolveProductionTables(...).tables; mileage — dieMileageIndex(...);
    // brands — brandResources(...); defaultResource — настройка DIE_RESOURCE_DEFAULT_M.
    function buildDieRows(dieRecs, t, mileage, brands, defaultResource) {
        var r = (t.die && t.die.reqs) || {};
        return (dieRecs || []).map(function(rec) {
            var m = (mileage || {})[rec.id] || { meters: 0, runs: 0, errors: [] };
            var brandId = refIds(rec, r.brand)[0] || '';
            var res = lp.dieResource(brandId ? (brands || {})[brandId] : '', defaultResource);
            return {
                id: rec.id,
                no: rec.val,
                width: reqVal(rec, r.labelWidth),
                length: reqVal(rec, r.labelLength),
                streams: reqVal(rec, r.streams),
                cylinderId: refIds(rec, r.cylinder)[0] || '',
                cylinder: reqVal(rec, r.cylinder),
                base: reqVal(rec, r.base),
                brandId: brandId,
                brand: reqVal(rec, r.brand),
                resource: res.meters,
                resourceSource: res.source,
                stateId: refIds(rec, r.state)[0] || '',
                state: lp.dieStateOf(reqVal(rec, r.state)),
                stateRaw: reqVal(rec, r.state),
                meters: m.meters,
                runs: m.runs,
                errors: m.errors,
                wear: lp.dieWearLevel(m.meters, res.meters)
            };
        });
    }

    function dieKpi(rows) {
        var S = lp.DIE_STATE;
        var k = { total: 0, working: 0, reserve: 0, expertise: 0, writtenOff: 0, noState: 0, near: 0, over: 0 };
        (rows || []).forEach(function(d) {
            k.total++;
            if (d.state === S.WORKING) k.working++;
            else if (d.state === S.RESERVE) k.reserve++;
            else if (d.state === S.EXPERTISE) k.expertise++;
            else if (d.state === S.WRITTEN_OFF) k.writtenOff++;
            else k.noState++;
            // У ресурса считаются ножи, которые ещё режут: списанные — уже нет.
            if (d.state !== S.WRITTEN_OFF) {
                if (d.wear === 'near') k.near++;
                else if (d.wear === 'over') k.over++;
            }
        });
        return k;
    }

    // Ножи у ресурса (near/over), кроме списанных; больший пробег — выше.
    function wearList(rows) {
        var S = lp.DIE_STATE;
        return (rows || []).filter(function(d) {
            return (d.wear === 'near' || d.wear === 'over') && d.state !== S.WRITTEN_OFF;
        }).sort(function(a, b) { return b.meters - a.meters; });
    }

    // Валы: раппорт, станки, на которые вал встаёт, ножей на валу (всего / рабочих).
    // Станок с пустыми «Допустимыми валами» принимает любой вал; вал больше «Макс. вала» станка
    // (maxReq — id реквизита, если он есть в базе) на станок не встаёт.
    function cylinderRows(cylRecs, machineRecs, dieRows, t, maxReq) {
        var cr = (t.cylinder && t.cylinder.reqs) || {};
        var mr = (t.machine && t.machine.reqs) || {};
        var S = lp.DIE_STATE;
        return (cylRecs || []).map(function(c) {
            var machines = (machineRecs || []).filter(function(m) {
                var allowed = refIds(m, mr.cylinders), max = maxReq ? num(reqVal(m, maxReq)) : 0;
                if (max > 0 && num(c.val) > max) return false;
                return allowed.length === 0 || allowed.indexOf(c.id) !== -1;
            }).map(function(m) { return m.val; });
            var dies = (dieRows || []).filter(function(d) { return d.cylinderId === c.id; });
            return {
                id: c.id,
                teeth: c.val,
                repeat: reqVal(c, cr.repeat),
                repeatCheck: lp.checkCylinderRepeat(c.val, reqVal(c, cr.repeat)),
                machines: machines,
                dies: dies.length,
                working: dies.filter(function(d) { return d.state === S.WORKING; }).length
            };
        }).sort(function(a, b) { return num(a.teeth) - num(b.teeth); });
    }

    function fmtMeters(m) {
        return String(Math.round(Number(m) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' м';
    }

    // Дата движения для истории: «ДД.ММ.ГГГГ ЧЧ:ММ» по Москве (UTC+3).
    function fmtRunDate(v) {
        var t = lp.runTime(v);
        if (!isFinite(t)) return String(v == null ? '' : v);
        var d = new Date((t + 3 * 3600) * 1000);
        var p = function(n) { return (n < 10 ? '0' : '') + n; };
        return p(d.getUTCDate()) + '.' + p(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    var core = {
        RESOURCE_KEY: RESOURCE_KEY,
        RUNS_REPORT: RUNS_REPORT,
        kvRecords: kvRecords,
        refIds: refIds,
        settingValue: settingValue,
        brandResources: brandResources,
        buildDieRows: buildDieRows,
        dieKpi: dieKpi,
        wearList: wearList,
        cylinderRows: cylinderRows,
        fmtMeters: fmtMeters,
        fmtRunDate: fmtRunDate
    };

    // ── Рабочее место (браузер) ──────────────────────────────────────────────────

    function AtexDies(rootEl) {
        this.root = rootEl;
        this.db = rootEl.getAttribute('data-db') || '';
        this.tables = null;
        this.settingsTable = null;
        this.dieRows = [];
        this.runRows = [];
        this.states = {};       // подпись состояния → id записи справочника
        this.brands = {};       // id марки → ресурс, м
        this.defaultResource = '';
        this.selectedId = '';
        this.busy = false;
    }

    AtexDies.prototype.$ = function(id) { return document.getElementById(id); };

    AtexDies.prototype.url = function(path) { return '/' + encodeURIComponent(this.db) + '/' + path; };

    AtexDies.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            if (!resp.ok) throw new Error(path + ': HTTP ' + resp.status);
            return resp.json();
        });
    };

    AtexDies.prototype.post = function(path, params) {
        var body = new URLSearchParams();
        body.set('_xsrf', (typeof window !== 'undefined' && window.xsrf) || this.root.getAttribute('data-xsrf') || '');
        Object.keys(params || {}).forEach(function(k) { body.set(k, params[k]); });
        return fetch(this.url(path), {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        }).then(function(resp) {
            return resp.text().then(function(text) {
                var result;
                try { result = JSON.parse(text); } catch (e) { throw new Error('Сервер вернул не JSON: ' + text.slice(0, 200)); }
                if (result && (result.error || result.err)) throw new Error(result.error || result.err);
                return result;
            });
        });
    };

    AtexDies.prototype.message = function(text, kind) {
        var el = this.$('atex-dies-message');
        if (!el) return;
        el.hidden = !text;
        el.className = 'atex-dies-message' + (kind ? ' is-' + kind : '');
        el.textContent = text || '';
    };

    AtexDies.prototype.start = function() {
        var self = this;
        this.root.addEventListener('click', function(e) {
            var tab = e.target.closest('[data-tab]');
            if (tab) return self.showTab(tab.getAttribute('data-tab'));
            var pick = e.target.closest('[data-die-id]');
            if (pick) return self.selectDie(pick.getAttribute('data-die-id'));
            var act = e.target.closest('[data-die-action]');
            if (act) return self.askAction(act.getAttribute('data-die-action'));
        });
        var refresh = this.$('atex-dies-refresh');
        if (refresh) refresh.addEventListener('click', function() { self.reload(true); });
        this.init().catch(function(err) {
            console.error('[dies] ❌', err);
            self.message('Рабочее место не загрузилось: ' + err.message, 'error');
        });
        return this;
    };

    AtexDies.prototype.init = function() {
        var self = this;
        return this.getJson('metadata').then(function(meta) {
            var res = lp.resolveProductionTables(meta, lp.PRODUCT_KIND.LABEL);
            var need = ['die', 'dieRun', 'dieState', 'dieBrand', 'cylinder', 'machine'];
            var lost = need.filter(function(k) { return !res.tables[k]; });
            if (lost.length) throw new Error('в базе нет таблиц: ' + lost.map(function(k) { return lp.PRODUCTION_CONFIGS[lp.PRODUCT_KIND.LABEL].tables[k].name; }).join(', '));
            var dieMissing = res.missing.filter(function(m) { return /^(Нож|Марка ножа|Движение пробега|Вал|Станок высечки) →/.test(m); });
            if (dieMissing.length) console.warn('[dies] нет колонок: ' + dieMissing.join('; '));
            self.tables = res.tables;
            var machineMeta = (meta || []).filter(function(x) { return String(x.id) === String(res.tables.machine.id); })[0];
            var maxReq = ((machineMeta && machineMeta.reqs) || []).filter(function(x) { return String(x.val).trim() === MAX_CYLINDER; })[0];
            self.maxCylinderReq = maxReq ? String(maxReq.id) : '';
            self.settingsTable = (meta || []).filter(function(t) { return String(t.val).trim() === 'Настройка'; })[0] || null;
            self.mountGrids();
            return self.reload(false);
        });
    };

    AtexDies.prototype.mountGrids = function() {
        // `class IntegramTable` объявлен в бандле на верхнем уровне скрипта: глобальное имя
        // есть, а свойства window — нет.
        var Grid = typeof IntegramTable === 'function' ? IntegramTable : root.IntegramTable;
        if (typeof Grid !== 'function') {
            this.message('Компонент таблиц не загрузился — справочник недоступен, показатели и карточка работают.', 'error');
            return;
        }
        var self = this;
        var make = function(elId, table, name, onClick) {
            var grid = new Grid(elId, {
                apiUrl: '/' + self.db + '/metadata/' + table.id,
                dataSource: 'table',
                tableTypeId: table.id,
                pageSize: 50,
                cookiePrefix: 'atex-' + name,
                instanceName: name,
                onCellClick: onClick
            });
            root[name] = grid;
            return grid;
        };
        this.dieGrid = make('atex-dies-grid', this.tables.die, 'atexDiesTable', function(row) {
            var rec = self.dieGrid && self.dieGrid.rawObjectData ? self.dieGrid.rawObjectData[row] : null;
            if (rec && rec.i != null) self.selectDie(String(rec.i));
        });
        this.cylGrid = make('atex-dies-cyl-grid', this.tables.cylinder, 'atexCylindersTable', null);
    };

    AtexDies.prototype.loadSettings = function() {
        var self = this;
        if (!this.settingsTable) return Promise.resolve('');
        var reqs = this.settingsTable.reqs || [];
        var typeReq = reqs.filter(function(r) { return r.val === 'Тип'; })[0];
        var valReq = reqs.filter(function(r) { return r.val === 'Значение'; })[0];
        return this.getJson('object/' + this.settingsTable.id + '/?JSON_KV&LIMIT=0,1000').then(function(json) {
            var recs = kvRecords(json).map(function(r) {
                return { key: r.val, type: typeReq ? reqVal(r, typeReq.id) : '', value: valReq ? reqVal(r, valReq.id) : '' };
            });
            return settingValue(recs, RESOURCE_KEY, self.db);
        });
    };

    AtexDies.prototype.reload = function(withGrids) {
        var self = this;
        var t = this.tables;
        return Promise.all([
            this.getJson('object/' + t.die.id + '/?JSON_KV&LIMIT=0,10000'),
            this.getJson('report/' + RUNS_REPORT + '?JSON_KV&LIMIT=0,100000'),
            this.getJson('object/' + t.cylinder.id + '/?JSON_KV&LIMIT=0,1000'),
            this.getJson('object/' + t.machine.id + '/?JSON_KV&LIMIT=0,100'),
            this.getJson('object/' + t.dieState.id + '/?JSON_KV&LIMIT=0,100'),
            this.getJson('object/' + t.dieBrand.id + '/?JSON_KV&LIMIT=0,100'),
            this.loadSettings()
        ]).then(function(res) {
            var dies = kvRecords(res[0]);
            self.runRows = Array.isArray(res[1]) ? res[1] : [];
            // Пустой отчёт при ножах с движениями — признак поломки отчёта, а не «пробега нет».
            var runsCol = t.die.reqs.runs;
            var withRuns = dies.filter(function(d) { return num(d.reqs[t.dieRun.id] || (runsCol && d.reqs[runsCol])) > 0; }).length;
            if (self.runRows.length === 0 && withRuns > 0) {
                console.error('[dies] ❌ отчёт ' + RUNS_REPORT + ' пуст, а движения пробега есть у ' + withRuns + ' ножей');
                self.message('Отчёт «' + RUNS_REPORT + '» вернул 0 движений, хотя у ' + withRuns + ' ножей они есть — пробег не посчитан. Проверьте отчёт.', 'error');
            }
            self.states = {};
            kvRecords(res[4]).forEach(function(s) { self.states[lp.dieStateOf(s.val) || s.val] = s.id; });
            self.brands = brandResources(kvRecords(res[5]), t.dieBrand);
            self.defaultResource = res[6] || '';
            var mileage = lp.dieMileageIndex(self.runRows);
            self.dieRows = buildDieRows(dies, t, mileage, self.brands, self.defaultResource);
            self.cylRows = cylinderRows(kvRecords(res[2]), kvRecords(res[3]), self.dieRows, t, self.maxCylinderReq);
            self.renderKpi();
            self.renderWear();
            self.renderCylinders();
            if (self.selectedId) self.renderCard();
            if (withGrids) {
                if (self.dieGrid && self.dieGrid.refreshData) self.dieGrid.refreshData();
                if (self.cylGrid && self.cylGrid.refreshData) self.cylGrid.refreshData();
            }
        });
    };

    AtexDies.prototype.showTab = function(name) {
        Array.prototype.forEach.call(this.root.querySelectorAll('[data-tab]'), function(b) {
            b.classList.toggle('is-active', b.getAttribute('data-tab') === name);
        });
        Array.prototype.forEach.call(this.root.querySelectorAll('[data-pane]'), function(p) {
            p.hidden = p.getAttribute('data-pane') !== name;
        });
    };

    // Подсказка о ресурсе по умолчанию: откуда берётся ресурс ножа без марки.
    AtexDies.prototype.defaultResourceText = function() {
        var d = lp.parseSettingNumber(this.defaultResource);
        return d > 0 ? 'ресурс по умолчанию ' + fmtMeters(d) : 'ресурс по умолчанию не задан (настройка ' + RESOURCE_KEY + ')';
    };

    AtexDies.prototype.renderKpi = function() {
        var k = dieKpi(this.dieRows);
        var withResource = this.dieRows.some(function(d) { return d.resource > 0; });
        var tile = function(label, value, cls, title) {
            return '<div class="atex-dies-kpi-tile' + (cls ? ' ' + cls : '') + '"' + (title ? ' title="' + esc(title) + '"' : '') +
                '><div class="atex-dies-kpi-value">' + esc(value) + '</div><div class="atex-dies-kpi-label">' + esc(label) + '</div></div>';
        };
        var html = tile('ножей всего', k.total) +
            tile('рабочих', k.working, 'is-ok') +
            tile('у ресурса / выработан', withResource ? (k.near + ' / ' + k.over) : '—', (k.near + k.over) ? 'is-warn' : '',
                'Ресурс — у марки ножа; без марки — ' + this.defaultResourceText() + '. «У ресурса» — от 90 %, «выработан» — от 100 %: нож пора списать') +
            tile('резерв / экспертиза', k.reserve + ' / ' + k.expertise) +
            tile('списано', k.writtenOff, 'is-muted');
        if (k.noState) html += tile('без состояния', k.noState, 'is-warn', 'Состояние не задано (в базе ножей «нет данных»)');
        this.$('atex-dies-kpi').innerHTML = html;
    };

    AtexDies.prototype.renderWear = function() {
        var el = this.$('atex-dies-wear');
        if (!this.dieRows.some(function(d) { return d.resource > 0; })) {
            el.innerHTML = '<div class="atex-dies-empty">Ресурс ножей не задан: заполните «Ресурс, м» у марок ножей ' +
                'или добавьте в «Настройку» строку ' + esc(RESOURCE_KEY) + ' со значением в метрах.</div>';
            return;
        }
        var list = wearList(this.dieRows);
        if (!list.length) { el.innerHTML = '<div class="atex-dies-empty">Нет ножей у ресурса.</div>'; return; }
        el.innerHTML = '<table class="atex-dies-table"><thead><tr><th>Нож</th><th>Этикетка</th><th>Марка</th><th class="num">Пробег</th><th class="num">Ресурс</th><th class="num">%</th></tr></thead><tbody>' +
            list.map(function(d) {
                return '<tr class="is-' + d.wear + '" data-die-id="' + esc(d.id) + '"><td>' + esc(d.no) + '</td><td>' + esc(num(d.width) + '×' + num(d.length)) +
                    '</td><td>' + esc(d.brand || '—') + '</td><td class="num">' + esc(fmtMeters(d.meters)) + '</td><td class="num">' + esc(fmtMeters(d.resource)) +
                    '</td><td class="num">' + Math.round(d.meters / d.resource * 100) + '</td></tr>';
            }).join('') + '</tbody></table>';
    };

    AtexDies.prototype.renderCylinders = function() {
        var el = this.$('atex-dies-cylinders');
        if (!this.cylRows.length) { el.innerHTML = '<div class="atex-dies-empty">Валов нет.</div>'; return; }
        el.innerHTML = '<table class="atex-dies-table"><thead><tr><th>Вал</th><th class="num">Раппорт, мм</th><th>Станки</th><th class="num">Ножей (рабочих)</th></tr></thead><tbody>' +
            this.cylRows.map(function(c) {
                var bad = c.repeatCheck && !c.repeatCheck.ok;
                return '<tr' + (bad ? ' class="is-over" title="' + esc(c.repeatCheck.error) + '"' : '') + '><td>' + esc(c.teeth) + '</td><td class="num">' + esc(c.repeat) +
                    (bad ? ' ⚠' : '') + '</td><td>' + (c.machines.length ? esc(c.machines.join(', ')) : '<span class="atex-dies-muted">ни один станок</span>') +
                    '</td><td class="num">' + c.dies + ' (' + c.working + ')</td></tr>';
            }).join('') + '</tbody></table>';
    };

    AtexDies.prototype.selectDie = function(id) {
        this.selectedId = String(id);
        this.renderCard();
    };

    AtexDies.prototype.currentDie = function() {
        var id = this.selectedId;
        return this.dieRows.filter(function(d) { return d.id === id; })[0] || null;
    };

    AtexDies.prototype.renderCard = function() {
        var el = this.$('atex-dies-card');
        var d = this.currentDie();
        if (!d) { el.innerHTML = '<div class="atex-dies-empty">Нож не найден — обновите данные.</div>'; return; }
        var runs = this.runRows.filter(function(r) { return String(r.die_id) === d.id; }).map(function(r) {
            return { id: r.run_id, date: r.run_date, kind: r.run_kind, meters: r.meters, job: r.job_id, operator: r.operator };
        });
        var extra = {};
        runs.forEach(function(r) { extra[r.id] = r; });
        var history = lp.dieRunHistory(runs).reverse();
        var actions = lp.dieStateActions(d.state);
        var html = '<h2 class="atex-dies-panel-title">Нож № ' + esc(d.no) + '</h2>' +
            '<div class="atex-dies-card-meta">' +
            '<span class="atex-dies-state" data-state="' + esc(d.state || 'none') + '">' + esc(d.state || (d.stateRaw ? d.stateRaw : 'состояние не задано')) + '</span>' +
            '<span>' + esc(num(d.width) + '×' + num(d.length) + ' мм') + (d.streams ? ', ручьёв ' + esc(d.streams) : '') + '</span>' +
            (d.cylinder ? '<span>вал ' + esc(d.cylinder) + '</span>' : '') + (d.base ? '<span>' + esc(d.base) + '</span>' : '') +
            '<span>' + (d.brand ? 'марка ' + esc(d.brand) : 'марка не задана') + '</span></div>' +
            '<div class="atex-dies-card-mileage"><div><b>' + esc(fmtMeters(d.meters)) + '</b> пробег</div>' +
            (d.resource > 0 ? '<div class="is-' + d.wear + '">' + Math.round(d.meters / d.resource * 100) + ' % ресурса ' + esc(fmtMeters(d.resource)) +
                (d.resourceSource === 'default' ? ' (по умолчанию)' : '') + (d.wear === 'over' ? ' — ресурс выработан, нож пора списать' : '') + '</div>'
                : '<div>ресурс не задан: ни у марки, ни настройкой ' + esc(RESOURCE_KEY) + '</div>') +
            '<div>движений: ' + d.runs + '</div></div>';
        if (d.errors && d.errors.length) html += '<div class="atex-dies-message is-error">' + esc(d.errors.join('; ')) + '</div>';
        html += '<div class="atex-dies-card-actions">' + (actions.length ? actions.map(function(a) {
            return '<button class="atex-dies-btn' + (a.action === lp.DIE_ACTION.WRITE_OFF ? ' atex-dies-btn-danger' : '') + '" type="button" data-die-action="' + esc(a.action) + '">' + esc(a.label) + '</button>';
        }).join('') : '<span class="atex-dies-muted">Нож списан — состояние не меняется.</span>') + '</div>';
        html += '<h3 class="atex-dies-sub">История пробега</h3>';
        html += history.length ? '<div class="atex-dies-history"><table class="atex-dies-table"><thead><tr><th>Дата</th><th>Вид</th><th>Задание</th><th>Оператор</th><th class="num">Метры</th><th class="num">Накоплено</th></tr></thead><tbody>' +
            history.map(function(h) {
                var x = extra[h.id] || {};
                return '<tr><td>' + esc(fmtRunDate(h.date)) + '</td><td>' + esc(h.kind) + '</td><td>' +
                    esc(x.job || '') + '</td><td>' + esc(x.operator || '') + '</td><td class="num">' + esc(fmtMeters(h.meters)) + '</td><td class="num">' + esc(fmtMeters(h.accumulated)) + '</td></tr>';
            }).join('') + '</tbody></table></div>' : '<div class="atex-dies-empty">Движений пробега нет.</div>';
        el.innerHTML = html;
    };

    // Подтверждение — модалка рабочего места (alert/confirm запрещены гайдом §8).
    AtexDies.prototype.confirm = function(text) {
        var modal = this.$('atex-dies-modal');
        var ok = this.$('atex-dies-modal-ok');
        var cancel = this.$('atex-dies-modal-cancel');
        this.$('atex-dies-modal-text').textContent = text;
        modal.hidden = false;
        return new Promise(function(resolve) {
            var done = function(v) {
                modal.hidden = true;
                ok.removeEventListener('click', yes);
                cancel.removeEventListener('click', no);
                resolve(v);
            };
            var yes = function() { done(true); };
            var no = function() { done(false); };
            ok.addEventListener('click', yes);
            cancel.addEventListener('click', no);
        });
    };

    AtexDies.prototype.askAction = function(action) {
        var self = this;
        var d = this.currentDie();
        if (!d || this.busy) return;
        var step = lp.dieStateAction(d.state, action);
        if (!step.ok) { this.message(step.error, 'error'); return; }
        var text = 'Нож № ' + d.no + ': «' + (d.state || 'без состояния') + '» → «' + step.state + '».';
        if (step.state === lp.DIE_STATE.WRITTEN_OFF) text += ' Списанный нож утилизируется, вернуть его в работу нельзя.';
        this.confirm(text).then(function(yes) { if (yes) return self.applyAction(d, step); });
    };

    AtexDies.prototype.applyAction = function(d, step) {
        var self = this;
        var t = this.tables;
        var stateId = this.states[step.state];
        if (!stateId) { this.message('В справочнике «Состояние ножа» нет записи «' + step.state + '»', 'error'); return Promise.resolve(); }
        this.busy = true;
        var p = {};
        p['t' + t.die.reqs.state] = stateId;
        return this.post('_m_set/' + encodeURIComponent(d.id) + '?JSON', p).then(function() {
            self.message('Нож № ' + d.no + ': состояние «' + step.state + '»', 'ok');
            return self.reload(true);
        }).catch(function(err) {
            console.error('[dies] ❌ смена состояния', err);
            self.message('Не записано: ' + err.message, 'error');
            return self.reload(false);
        }).then(function() { self.busy = false; });
    };

    return { core: core, AtexDies: AtexDies };
});
