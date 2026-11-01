// Рабочее место atex «Заказы этикетки» (роль Менеджер; ideav/crm#5324, Фаза 2, шаг 4).
//
// Список позиций этикетки — компонент integram-table над отчётом `label_positions`
// (позиции «Заказанного количества» с «Вид продукции = этикетка», отбор в определении отчёта;
// создаёт docs/scripts/create_report_label_positions_5324.py). Рядом с гридом:
//   - ввод позиции (модальная форма): заказ (существующий или новый), размер этикетки,
//     ручьёв в заказе, этикеток в рулоне, рулонов, сырьё (его основа, клей, тип и толщина
//     подложки видны в форме), тип ножей 1С, ширина и диаметр втулки, намотка, срок;
//   - подбор ножа при сохранении позиции и по кнопке (`positionDie` из label-production.js):
//     точный размер, основа сырья, состояние «Нож подбирается», ручьёв ножа кратно ручьям
//     заказа, наименьший пробег (отчёт `die_runs`); ручной выбор перекрывает автоподбор;
//     нож не найден — «Подбор ножа = нет ножа» и причина в карточке;
//   - минимальная партия (`labelMinBatch`): этикеток с одного мастер-рулона длиной
//     LABEL_MASTER_ROLL_M; меньше — предупреждение, не блокировка;
//   - подтверждение ИТС: признак «Нужно подтверждение ИТС» ставится ВРУЧНУЮ (решение владельца
//     01.11.2026, #5318; автопризнак по размеру отключён); кнопка «Подтвердить ИТС» ставит «Подтверждено ИТС» —
//     только ролям из LABEL_ITS_ROLES (пусто — «Диспетчер»: ИТС — это он), admin и владельцу базы (`canConfirmIts`);
//   - потребность позиции (`labelPositionDemand`): этикеток, раппортов, метраж вырубки,
//     мастер-рулонов, коэффициент использования сырья.
//
// Таблицы и реквизиты резолвятся по именам из /metadata (resolveProductionTables), id в коде нет.

(function(root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') {
        window.AtexLabelOrders = api;
        var start = function() {
            var el = document.getElementById('atex-lo-app');
            if (el && !el.__atexLabelOrders) el.__atexLabelOrders = new api.AtexLabelOrders(el).start();
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
        else start();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
    'use strict';

    var LP = (root && root.AtexLabelProduction) ||
        (typeof require === 'function' ? require('../../atex/js/label-production.js') : null);
    var lp = LP ? LP.core : null;

    var REPORT = 'label_positions';
    // id позиции в отчёте: колонка «<Имя>ID» рядом с «<Имя>» — грид её скрывает.
    var POSITION_ID_COLUMN = 'РулоновID';
    var RUNS_REPORT = 'die_runs';
    var SETTINGS = { MR_LENGTH: 'LABEL_MASTER_ROLL_M', ITS_ROLES: 'LABEL_ITS_ROLES' };
    // Кто подтверждает ИТС, если настройка LABEL_ITS_ROLES пуста: ИТС на производстве — Диспетчер.
    var ITS_ROLES_DEFAULT = 'Диспетчер';
    var MR_LENGTH_DEFAULT_M = 2000;

    // ── Чистые функции (покрыты experiments/atex-p2-5324-label-orders.test.js) ───

    function kvRecords(json) {
        var reqs = (json && json.reqs) || {};
        return ((json && json.object) || []).map(function(o) {
            return { id: String(o.id), val: o.val == null ? '' : String(o.val), reqs: reqs[o.id] || {} };
        });
    }

    function refId(rec, reqId) {
        var raw = rec && rec.reqs && reqId ? rec.reqs['ref_' + reqId] : null;
        if (raw == null || String(raw).trim() === '') return '';
        return String(raw).replace(/^\s*\d+:/, '').split(',')[0].trim();
    }

    function reqVal(rec, reqId) {
        var v = rec && rec.reqs && reqId ? rec.reqs[reqId] : null;
        return v == null ? '' : String(v);
    }

    function num(v) {
        var n = Number(String(v == null ? '' : v).replace(',', '.').trim());
        return String(v == null ? '' : v).trim() !== '' && isFinite(n) ? n : NaN;
    }

    // BOOLEAN Интеграма: «X» (или «1») — да, пусто — нет.
    function bool(v) {
        var s = String(v == null ? '' : v).trim().toLowerCase();
        return s !== '' && s !== '0' && s !== 'false';
    }

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

    // Пробег ножей по строкам отчёта die_runs → { id ножа: метры }.
    function mileageByDie(runRows) {
        var groups = {};
        (runRows || []).forEach(function(r) {
            var id = String(r.die_id || '');
            if (!id) return;
            (groups[id] = groups[id] || []).push({ id: r.run_id, date: r.run_date, kind: r.run_kind, meters: r.meters });
        });
        var out = {};
        Object.keys(groups).forEach(function(id) { out[id] = lp.dieMileage(groups[id]).meters; });
        return out;
    }

    // Ножи для подбора. t — resolveProductionTables(...).tables; selectableStates — { id
    // состояния: true } у состояний с «Нож подбирается»; cylinders — { id вала: раппорт, мм };
    // mileage — { id ножа: метры } (null — пробег не прочитан).
    function buildDies(dieRecs, t, selectableStates, cylinders, mileage) {
        var r = (t.die && t.die.reqs) || {};
        return (dieRecs || []).map(function(rec) {
            var cylId = refId(rec, r.cylinder);
            var stateId = refId(rec, r.state);
            return {
                id: rec.id,
                no: rec.val,
                width: reqVal(rec, r.labelWidth),
                length: reqVal(rec, r.labelLength),
                base: reqVal(rec, r.base),
                streams: reqVal(rec, r.streams),
                labelsPerRepeat: reqVal(rec, r.labelsPerRepeat),
                cylinder: reqVal(rec, r.cylinder),
                repeatMm: cylId && cylinders ? cylinders[cylId] : '',
                usedFormat: reqVal(rec, r.usedFormat),
                sleeveWidth: reqVal(rec, r.sleeveWidth),
                state: reqVal(rec, r.state),
                selectable: !!(stateId && selectableStates && selectableStates[stateId]),
                meters: mileage ? (mileage[rec.id] || 0) : 0
            };
        });
    }

    // Валы → { id: раппорт, мм }: «Раппорт, мм», без него — зубья × 3.175.
    function cylinderRepeats(cylRecs, t) {
        var col = t.cylinder && t.cylinder.reqs ? t.cylinder.reqs.repeat : '';
        var out = {};
        (cylRecs || []).forEach(function(c) {
            var rep = num(reqVal(c, col));
            out[c.id] = rep > 0 ? rep : (num(c.val) > 0 ? lp.cylinderRepeatMm(c.val) : '');
        });
        return out;
    }

    // Сырьё этикетки → { id: { name, base, glue, linerType, linerThickness } }.
    function materialIndex(recs, t) {
        var r = (t.material && t.material.reqs) || {};
        var out = {};
        (recs || []).forEach(function(m) {
            out[m.id] = {
                name: m.val,
                base: reqVal(m, r.base),
                glue: reqVal(m, r.glue),
                linerType: reqVal(m, r.linerType),
                linerThickness: reqVal(m, r.linerThickness)
            };
        });
        return out;
    }

    // Строка отчёта label_positions → позиция для подбора.
    function positionFromRow(row, materials) {
        var x = row || {};
        var mat = (materials || {})[String(x['СырьёID'] || '')] || null;
        var kt = String(x['Тип ножей'] || '').trim();
        var parsed = kt ? lp.parseKnifeType(kt) : null;
        return {
            id: String(x['РулоновID'] || ''),
            orderId: String(x['ЗаказID'] || ''),
            orderNo: x['Заказ'] || '',
            client: x['Клиент'] || '',
            width: x['Ширина, мм'],
            length: x['Длина, мм'],
            orderStreams: x['Ручьёв'],
            labelsPerRoll: x['Шт в рулоне'],
            rolls: x['Рулонов'],
            materialId: String(x['СырьёID'] || ''),
            material: x['Сырьё'] || '',
            base: mat ? mat.base : '',
            knifeType: kt,
            knifeStreams: parsed && parsed.ok ? parsed.streams : null,
            pick: String(x['Подбор ножа'] || '').trim(),
            dieId: String(x['НожID'] || ''),
            dieNo: x['Нож'] || '',
            minBatch: x['Мин. партия'],
            itsNeeded: bool(x['ИТС нужен']),
            itsConfirmed: bool(x['ИТС подтв.']),
            sleeveWidth: x['Втулка, мм'] || '',
            sleeveId: String(x['Диаметр втулкиID'] || ''),
            winding: String(x['Намотка'] || '').trim(),
            due: x['Срок'] || '',
            status: x['Статус'] || ''
        };
    }

    // Расчёт позиции: нож, минимальная партия, ИТС, потребность, блокировки — и что записать
    // в позицию (`write`: ключ реквизита конфигурации → значение, «» — очистить).
    // settings — { mrLength }. Признак «Нужно подтверждение ИТС» — ручной (pos.itsNeeded), не пересчитывается (#5318).
    function planPosition(pos, dies, settings) {
        var s = settings || {};
        var mrLength = num(s.mrLength) > 0 ? num(s.mrLength) : MR_LENGTH_DEFAULT_M;
        var dieRes = lp.positionDie(pos, dies);
        var min = dieRes.ok ? lp.labelMinBatch(dieRes.die, mrLength) : { ok: false, error: dieRes.reason };
        var its = { needed: pos.itsNeeded === true, reason: 'отмечено вручную' };
        var demand = lp.labelPositionDemand(pos, dieRes.ok ? dieRes.die : null, mrLength);
        var flags = lp.labelPositionFlags({
            pick: dieRes.pick,
            itsNeeded: its.needed,
            itsConfirmed: pos.itsConfirmed,
            labels: demand.labels,
            minBatch: min.ok ? min.labels : ''
        });
        var out = {
            die: dieRes,
            minBatch: min,
            its: its,
            demand: demand,
            flags: flags,
            mrLength: mrLength,
            write: {
                die: dieRes.ok ? String(dieRes.die.id) : '',
                diePick: dieRes.pick,
                minBatch: min.ok ? String(min.labels) : ''
            }
        };
        // Ширина втулки — из ножа, если в позиции её нет (её читает втулкорез).
        if (dieRes.ok && !(num(pos.sleeveWidth) > 0) && num(dieRes.die.sleeveWidth) > 0) out.write.sleeveWidth = String(num(dieRes.die.sleeveWidth));
        return out;
    }

    // Что записано в позиции и расходится с расчётом → { show, text }. Пока подбор пишется
    // (`pending`) или позиция ещё не перечитана после записи, расхождения нет: карточка
    // показывает расчёт, а не прежнее содержимое позиции (D13: «записано: ничего» рядом с баннером
    // «нож подобран»).
    function recordedNote(pos, plan, pending) {
        var dieId = plan.die.ok ? String(plan.die.die.id) : '';
        if (String(pos.dieId || '') === dieId && String(pos.pick || '') === String(plan.die.pick || '')) return { show: false, text: '' };
        if (pending) return { show: true, text: 'Нож записывается в позицию…' };
        var has = pos.pick || pos.dieNo;
        return { show: true, text: 'В позиции записано: ' + (has ? (pos.pick || 'нож') + (pos.dieNo ? ' (№ ' + pos.dieNo + ')' : '') : 'нож не записан') + ' — нажмите «Подобрать нож».' };
    }

    // Подсказка к предупреждению «меньше минимальной партии»: что делать.
    function minBatchAdvice(minLabels, mrLength) {
        var mr = num(mrLength) > 0 ? num(mrLength) : MR_LENGTH_DEFAULT_M;
        return 'Заказ меньше этикеток с одного мастер-рулона (' + mr + ' м)' + (num(minLabels) > 0 ? ': ' + fmtInt(num(minLabels)) + ' шт' : '') +
            '. Запуск не блокируется, но высечка займёт целый мастер-рулон. Что сделать: ' +
            'увеличить заказ до минимальной партии; объединить с другой позицией того же ножа и сырья; ' +
            'либо согласовать с клиентом и запустить как есть (остаток мастер-рулона вернётся на склад).';
    }

    // Отличается ли расчёт от записанного в позиции (чтобы не писать без нужды).
    function writeDiffers(pos, write) {
        var cur = {
            die: pos.dieId || '',
            diePick: pos.pick || '',
            minBatch: num(pos.minBatch) > 0 ? String(num(pos.minBatch)) : '',
            sleeveWidth: num(pos.sleeveWidth) > 0 ? String(num(pos.sleeveWidth)) : ''
        };
        return Object.keys(write).some(function(k) { return String(cur[k]) !== String(write[k]); });
    }

    // Сохранение формы сбрасывает «Подтверждено ИТС», только если подтверждение стоит, а размер
    // сменился (подтверждали другой размер). В остальных случаях поля в _m_set нет: у Менеджера на
    // него грант READ, и ядро отбило бы весь запрос.
    function itsResetOnSave(prev, f) {
        if (!prev || !prev.itsConfirmed) return false;
        return num(prev.width) !== num(f.width) || num(prev.length) !== num(f.length);
    }

    // Поля формы позиции → { field: ошибка } (пусто — форма верна).
    // opts — { prev: позиция до правки, canIts: право подтверждать ИТС } (для правки позиции).
    function validatePositionForm(f, opts) {
        var err = {};
        if (!(num(f.width) > 0)) err.width = 'ширина этикетки — число больше нуля';
        if (!(num(f.length) > 0)) err.length = 'длина этикетки — число больше нуля';
        if (!err.width && !err.length && opts && !opts.canIts && itsResetOnSave(opts.prev, f)) {
            err.width = 'размер подтверждён ИТС — изменить его может ' + (opts.itsRoles || ITS_ROLES_DEFAULT) + ' (или пусть сначала снимет подтверждение)';
        }
        if (!(num(f.labelsPerRoll) > 0)) err.labelsPerRoll = 'этикеток в рулоне — больше нуля';
        if (!(num(f.rolls) > 0) || Math.round(num(f.rolls)) !== num(f.rolls)) err.rolls = 'рулонов — целое больше нуля';
        var st = String(f.orderStreams == null ? '' : f.orderStreams).trim();
        if (st !== '' && (!(num(st) > 0) || Math.round(num(st)) !== num(st))) err.orderStreams = 'ручьёв — целое больше нуля';
        if (!f.materialId) err.materialId = 'выберите сырьё';
        if (!f.orderId && !String(f.newOrderNo || '').trim()) err.orderId = 'выберите заказ или введите номер нового';
        if (f.knifeType && !lp.parseKnifeType(f.knifeType).ok) err.knifeType = lp.parseKnifeType(f.knifeType).error;
        return err;
    }

    // «2026-11-10» (input type=date) → «10.11.2026»; «10.11.2026» → «2026-11-10».
    function isoToRu(s) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
        return m ? m[3] + '.' + m[2] + '.' + m[1] : '';
    }
    function ruToIso(s) {
        var m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(String(s || '').trim());
        return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
    }

    function fmtInt(n) {
        return isFinite(n) ? String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '—';
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function normRole(s) {
        return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
    }

    // Право подтвердить или снять подтверждение ИТС. ctx — { role, user, db } вошедшего;
    // rolesSetting — LABEL_ITS_ROLES: имена ролей через запятую или «;» (пусто — «Диспетчер»).
    // Сверка по ИМЕНИ роли: id ролей у баз свои. admin и владелец базы — всегда: ядро
    // пускает их в обход грантов (Check_Grant).
    function canConfirmIts(ctx, rolesSetting) {
        var role = normRole(ctx && ctx.role);
        var user = normRole(ctx && ctx.user);
        var db = normRole(ctx && ctx.db);
        if (role === 'admin' || user === 'admin' || (user && db && user === db)) return true;
        if (!role) return false;
        var list = String(rolesSetting == null ? '' : rolesSetting).split(/[,;]/).map(normRole).filter(Boolean);
        if (!list.length) list = [normRole(ITS_ROLES_DEFAULT)];
        return list.indexOf(role) >= 0;
    }

    function itsRolesLabel(rolesSetting) {
        var list = String(rolesSetting == null ? '' : rolesSetting).split(/[,;]/)
            .map(function(x) { return x.trim(); }).filter(Boolean);
        return (list.length ? list : [ITS_ROLES_DEFAULT]).join(', ');
    }

    var core = {
        REPORT: REPORT,
        SETTINGS: SETTINGS,
        kvRecords: kvRecords,
        bool: bool,
        settingValue: settingValue,
        mileageByDie: mileageByDie,
        buildDies: buildDies,
        cylinderRepeats: cylinderRepeats,
        materialIndex: materialIndex,
        positionFromRow: positionFromRow,
        planPosition: planPosition,
        writeDiffers: writeDiffers,
        recordedNote: recordedNote,
        minBatchAdvice: minBatchAdvice,
        validatePositionForm: validatePositionForm,
        itsResetOnSave: itsResetOnSave,
        isoToRu: isoToRu,
        ruToIso: ruToIso,
        canConfirmIts: canConfirmIts,
        itsRolesLabel: itsRolesLabel
    };

    // ── Рабочее место (браузер) ──────────────────────────────────────────────────

    function AtexLabelOrders(rootEl) {
        this.root = rootEl;
        this.db = rootEl.getAttribute('data-db') || '';
        this.ctx = { role: rootEl.getAttribute('data-role') || '', user: rootEl.getAttribute('data-user') || '', db: this.db };
        this.tables = null;
        this.meta = null;
        this.rows = [];          // позиции (positionFromRow)
        this.dies = [];
        this.materials = {};
        this.orders = [];
        this.clients = [];
        this.sleeves = [];
        this.kindLabelId = '';
        this.settings = {};
        this.mileageOk = true;
        this.selectedId = '';
        this.busy = false;
        this.picking = false;
    }

    AtexLabelOrders.prototype.$ = function(id) { return document.getElementById(id); };
    AtexLabelOrders.prototype.url = function(path) { return '/' + encodeURIComponent(this.db) + '/' + path; };

    AtexLabelOrders.prototype.getJson = function(path) {
        return fetch(this.url(path), { credentials: 'same-origin' }).then(function(resp) {
            if (!resp.ok) throw new Error(path + ': HTTP ' + resp.status);
            return resp.json();
        });
    };

    AtexLabelOrders.prototype.post = function(path, params) {
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
                var first = Array.isArray(result) ? result[0] : result;
                if (first && (first.error || first.err)) throw new Error(first.error || first.err);
                return result;
            });
        });
    };

    AtexLabelOrders.prototype.message = function(text, kind) {
        var el = this.$('atex-lo-message');
        if (!el) return;
        el.hidden = !text;
        el.className = 'atex-lo-message' + (kind ? ' is-' + kind : '');
        el.textContent = text || '';
    };

    AtexLabelOrders.prototype.start = function() {
        var self = this;
        this.root.addEventListener('click', function(e) {
            var act = e.target.closest('[data-lo-action]');
            if (act) return self.action(act.getAttribute('data-lo-action'), act);
            var pick = e.target.closest('[data-lo-position]');
            if (pick) return self.select(pick.getAttribute('data-lo-position'));
        });
        this.init().catch(function(err) {
            console.error('[label-orders] ❌', err);
            self.message('Рабочее место не загрузилось: ' + err.message, 'error');
        });
        return this;
    };

    function findTable(meta, name) {
        return (meta || []).filter(function(t) { return String(t.val).trim() === name; })[0] || null;
    }
    function findReq(table, name) {
        return ((table && table.reqs) || []).filter(function(r) { return String(r.val).trim() === name; })[0] || null;
    }

    AtexLabelOrders.prototype.init = function() {
        var self = this;
        return this.getJson('metadata').then(function(meta) {
            var res = lp.resolveProductionTables(meta, lp.PRODUCT_KIND.LABEL);
            var need = ['order', 'position', 'material', 'die', 'dieState', 'cylinder', 'productKind'];
            var lost = need.filter(function(k) { return !res.tables[k]; });
            if (lost.length) throw new Error('в базе нет таблиц: ' + lost.map(function(k) { return lp.PRODUCTION_CONFIGS[lp.PRODUCT_KIND.LABEL].tables[k].name; }).join(', '));
            var posMissing = res.missing.filter(function(m) { return /^(Заказанное количество|Нож|Сырьё этикетки) →/.test(m); });
            if (posMissing.length) self.message('В базе нет колонок: ' + posMissing.join('; ') + ' — накатите docs/atex_phase2_schema.json.', 'error');
            self.meta = meta;
            self.tables = res.tables;
            var pos = findTable(meta, 'Заказанное количество');
            var order = findTable(meta, 'Заказ');
            self.cols = {
                client: findReq(order, 'Клиент'),
                sleeve: findReq(pos, 'Диаметр втулки'),
                winding: findReq(pos, 'Тип намотки'),
                due: findReq(pos, 'Срок изготовления'),
                notes: findReq(pos, 'Примечание')
            };
            self.settingsTable = findTable(meta, 'Настройка');
            self.mountGrid();
            return self.reload(false);
        });
    };

    AtexLabelOrders.prototype.mountGrid = function() {
        var Grid = typeof IntegramTable === 'function' ? IntegramTable : root.IntegramTable;
        if (typeof Grid !== 'function') {
            this.message('Компонент таблиц не загрузился — список недоступен, карточка и ввод работают.', 'error');
            return;
        }
        var self = this;
        this.grid = new Grid('atex-lo-grid', {
            // ?JSON — формат columns/data, который грид читает у отчёта (как templates/report.html).
            apiUrl: '/' + this.db + '/report/' + REPORT + '?JSON',
            dataSource: 'report',
            pageSize: 50,
            title: 'Позиции этикетки',
            cookiePrefix: 'atex-label-orders',
            instanceName: 'atexLabelOrdersTable',
            onCellClick: function(row) {
                var g = self.grid;
                var idx = -1;
                (g.columns || []).forEach(function(c, i) {
                    if ([c.name, c.val, c.label].indexOf(POSITION_ID_COLUMN) !== -1) idx = i;
                });
                var id = idx >= 0 && g.data[row] ? g.data[row][idx] : '';
                if (id && typeof id === 'object') id = id.value != null ? id.value : id.val;
                if (id) self.select(String(id));
            }
        });
        root.atexLabelOrdersTable = this.grid;
    };

    AtexLabelOrders.prototype.loadSettings = function() {
        var self = this;
        var empty = { mrLength: '', itsRoles: '' };
        if (!this.settingsTable) return Promise.resolve(empty);
        var typeReq = findReq(this.settingsTable, 'Тип');
        var valReq = findReq(this.settingsTable, 'Значение');
        return this.getJson('object/' + this.settingsTable.id + '/?JSON_KV&LIMIT=0,1000').then(function(json) {
            var recs = kvRecords(json).map(function(r) {
                return { key: r.val, type: typeReq ? reqVal(r, typeReq.id) : '', value: valReq ? reqVal(r, valReq.id) : '' };
            });
            return {
                mrLength: settingValue(recs, SETTINGS.MR_LENGTH, self.db),
                itsRoles: settingValue(recs, SETTINGS.ITS_ROLES, self.db)
            };
        });
    };

    AtexLabelOrders.prototype.reload = function(withGrid) {
        var self = this;
        var t = this.tables;
        var sleeveTable = this.cols.sleeve && this.cols.sleeve.ref ? this.cols.sleeve.ref : '';
        var clientTable = this.cols.client && this.cols.client.ref ? this.cols.client.ref : '';
        var optional = function(p) { return p.catch(function(err) { console.warn('[label-orders] ' + err.message); return null; }); };
        return Promise.all([
            this.getJson('report/' + REPORT + '?JSON_KV&LIMIT=0,10000'),
            this.getJson('object/' + t.die.id + '/?JSON_KV&LIMIT=0,10000'),
            optional(this.getJson('report/' + RUNS_REPORT + '?JSON_KV&LIMIT=0,100000')),
            this.getJson('object/' + t.cylinder.id + '/?JSON_KV&LIMIT=0,1000'),
            this.getJson('object/' + t.dieState.id + '/?JSON_KV&LIMIT=0,100'),
            this.getJson('object/' + t.material.id + '/?JSON_KV&LIMIT=0,1000'),
            this.getJson('object/' + t.order.id + '/?JSON_KV&LIMIT=0,10000'),
            this.getJson('object/' + t.productKind.id + '/?JSON_KV&LIMIT=0,20'),
            clientTable ? optional(this.getJson('object/' + clientTable + '/?JSON_KV&LIMIT=0,5000')) : Promise.resolve(null),
            sleeveTable ? optional(this.getJson('object/' + sleeveTable + '/?JSON_KV&LIMIT=0,500')) : Promise.resolve(null),
            this.loadSettings()
        ]).then(function(res) {
            self.settings = res[10];
            self.mileageOk = Array.isArray(res[2]);
            var selCol = t.dieState.reqs.selectable;
            var selectable = {};
            kvRecords(res[4]).forEach(function(s) { if (bool(reqVal(s, selCol))) selectable[s.id] = true; });
            var cylinders = cylinderRepeats(kvRecords(res[3]), t);
            self.dies = buildDies(kvRecords(res[1]), t, selectable, cylinders, self.mileageOk ? mileageByDie(res[2]) : null);
            self.materials = materialIndex(kvRecords(res[5]), t);
            self.materialList = kvRecords(res[5]);
            self.orders = kvRecords(res[6]);
            self.kindLabelId = (kvRecords(res[7]).filter(function(k) { return lp.productKindOf(k.val) === lp.PRODUCT_KIND.LABEL; })[0] || {}).id || '';
            self.clients = res[8] ? kvRecords(res[8]) : [];
            self.sleeves = res[9] ? kvRecords(res[9]) : [];
            var rows = Array.isArray(res[0]) ? res[0] : [];
            self.rows = rows.map(function(r) { return positionFromRow(r, self.materials); });
            if (!self.mileageOk) self.message('Отчёт «' + RUNS_REPORT + '» не прочитан — пробег ножей не учтён, из подходящих выбирается меньший номер.', 'warn');
            self.renderKpi();
            if (self.selectedId) self.renderCard();
            if (withGrid && self.grid && self.grid.refreshData) self.grid.refreshData();
        });
    };

    AtexLabelOrders.prototype.planOf = function(pos) {
        return planPosition(pos, this.dies, this.settings);
    };

    AtexLabelOrders.prototype.renderKpi = function() {
        var self = this;
        var k = { total: this.rows.length, noDie: 0, its: 0, small: 0, ready: 0, stale: 0 };
        this.rows.forEach(function(p) {
            var plan = self.planOf(p);
            if (plan.flags.blocks.indexOf(lp.DIE_PICK.NONE) !== -1) k.noDie++;
            if (plan.its.needed && !p.itsConfirmed) k.its++;
            if (plan.flags.warnings.length) k.small++;
            if (plan.flags.ready) k.ready++;
            if (writeDiffers(p, plan.write)) k.stale++;
        });
        var tile = function(label, value, cls, title) {
            return '<div class="atex-lo-kpi-tile' + (cls ? ' ' + cls : '') + '"' + (title ? ' title="' + esc(title) + '"' : '') +
                '><div class="atex-lo-kpi-value">' + esc(value) + '</div><div class="atex-lo-kpi-label">' + esc(label) + '</div></div>';
        };
        var s = this.settings;
        var itsTitle = 'Признак «Нужно подтверждение ИТС» ставится вручную';
        this.$('atex-lo-kpi').innerHTML =
            tile('позиций этикетки', k.total) +
            tile('готовы к планированию', k.ready, 'is-ok') +
            tile('нет ножа', k.noDie, k.noDie ? 'is-bad' : '') +
            tile('ждут ИТС', k.its, k.its ? 'is-warn' : '', itsTitle) +
            tile('меньше мин. партии', k.small, k.small ? 'is-warn' : '', 'Мин. партия — этикеток с одного мастер-рулона ' + (s.mrLength || MR_LENGTH_DEFAULT_M) + ' м') +
            (k.stale ? tile('не подобрано', k.stale, 'is-warn', 'Подбор в позиции отличается от расчёта: нажмите «Подобрать всем»') : '');
    };

    AtexLabelOrders.prototype.current = function() {
        var id = this.selectedId;
        return this.rows.filter(function(p) { return p.id === id; })[0] || null;
    };

    AtexLabelOrders.prototype.select = function(id) {
        this.selectedId = String(id);
        this.renderCard();
    };

    AtexLabelOrders.prototype.renderCard = function() {
        var el = this.$('atex-lo-card');
        var p = this.current();
        if (!p) { el.innerHTML = '<div class="atex-lo-empty">Позиция не найдена — обновите данные.</div>'; return; }
        var plan = this.planOf(p);
        var mat = this.materials[p.materialId] || null;
        var d = plan.die.ok ? plan.die.die : null;
        var row = function(label, value) { return '<div class="atex-lo-kv"><span>' + esc(label) + '</span><b>' + value + '</b></div>'; };
        var labelsPerStream = num(p.labelsPerRoll) / (num(p.orderStreams) > 0 ? num(p.orderStreams) : 1);
        var html = '<h2 class="atex-lo-panel-title">Заказ ' + esc(p.orderNo) + (p.client ? ' · ' + esc(p.client) : '') + '</h2>' +
            '<div class="atex-lo-flags">' +
            plan.flags.blocks.map(function(b) { return '<span class="atex-lo-badge is-bad">' + esc(b) + '</span>'; }).join('') +
            plan.flags.warnings.map(function(w) {
                var help = /меньше минимальной партии/.test(w) ? minBatchAdvice(plan.minBatch.ok ? plan.minBatch.labels : '', plan.mrLength) : '';
                return '<span class="atex-lo-badge is-warn"' + (help ? ' title="' + esc(help) + '"' : '') + '>' + esc(w) + '</span>';
            }).join('') +
            (plan.flags.ready ? '<span class="atex-lo-badge is-ok">готова к планированию</span>' : '') + '</div>' +
            row('Этикетка', esc(p.width + ' × ' + p.length + ' мм')) +
            row('Ручьёв в заказе', esc(p.orderStreams || '1')) +
            row('Этикеток в рулоне / в ручье', esc(fmtInt(num(p.labelsPerRoll)) + ' / ' + fmtInt(labelsPerStream))) +
            row('Рулонов / этикеток всего', esc(fmtInt(num(p.rolls)) + ' / ' + fmtInt(plan.demand.labels))) +
            row('Сырьё', esc(p.material || '—') + (mat ? '<small>' + esc([mat.base, mat.glue && 'клей ' + mat.glue, mat.linerType && 'подложка ' + mat.linerType,
                mat.linerThickness && mat.linerThickness + ' мкм'].filter(Boolean).join(', ')) + '</small>' : '')) +
            row('Тип ножей (1С)', esc(p.knifeType || '—')) +
            row('Срок', esc(p.due || '—'));

        html += '<h3 class="atex-lo-sub">Нож</h3>';
        if (d) {
            html += row('Нож', '№ ' + esc(d.no) + ' <span class="atex-lo-badge ' + (plan.die.pick === lp.DIE_PICK.MANUAL ? 'is-warn' : 'is-ok') + '">' + esc(plan.die.pick) + '</span>') +
                row('Ручьёв / на раппорте', esc((d.streams || '—') + ' / ' + (d.labelsPerRepeat || '—'))) +
                row('Вал / раппорт', esc((d.cylinder || '—') + ' / ' + (d.repeatMm ? d.repeatMm + ' мм' : '—'))) +
                row('Исп. формат', esc(d.usedFormat ? d.usedFormat + ' мм' : '—')) +
                row('Пробег', esc(this.mileageOk ? fmtInt(d.meters) + ' м' : 'не прочитан'));
            if (plan.die.pick === lp.DIE_PICK.FOUND && plan.die.candidates.length > 1) {
                html += '<div class="atex-lo-note">Автоподбор: точный размер и основа, наименьший пробег из ' + plan.die.candidates.length + ' подходящих.</div>';
            }
        } else {
            html += '<div class="atex-lo-message is-error">' + esc(plan.die.reason || 'нож не подобран') + '</div>';
        }
        var rec = recordedNote(p, plan, this.picking);
        if (rec.show) html += '<div class="atex-lo-note is-warn">' + esc(rec.text) + '</div>';

        html += '<h3 class="atex-lo-sub">Партия и ИТС</h3>' +
            row('Мин. партия', plan.minBatch.ok ? esc(fmtInt(plan.minBatch.labels) + ' шт (1 МР ' + plan.mrLength + ' м)') : '<span class="atex-lo-muted">' + esc(plan.minBatch.error) + '</span>') +
            row('Подтверждение ИТС', plan.its.needed
                ? (p.itsConfirmed ? '<span class="atex-lo-badge is-ok">подтверждено</span>' : '<span class="atex-lo-badge is-warn">нужно</span>') + '<small>' + esc(plan.its.reason) + '</small>'
                : 'не нужно');
        if (plan.its.needed && !this.canIts()) {
            html += '<div class="atex-lo-note">Подтверждает ИТС роль: ' + esc(this.itsRolesText()) + ' (настройка ' + SETTINGS.ITS_ROLES + ').</div>';
        }

        if (plan.flags.warnings.some(function(w) { return /меньше минимальной партии/.test(w); })) {
            html += '<div class="atex-lo-note is-warn">' + esc(minBatchAdvice(plan.minBatch.ok ? plan.minBatch.labels : '', plan.mrLength)) + '</div>';
        }

        if (plan.demand.ok) {
            html += '<h3 class="atex-lo-sub">Потребность позиции</h3>' +
                row('Раппортов', esc(fmtInt(plan.demand.repeats))) +
                row('Метраж вырубки', esc(fmtInt(plan.demand.meters) + ' м')) +
                row('Мастер-рулонов ' + plan.mrLength + ' м', esc(plan.demand.masterRolls == null ? '—' : plan.demand.masterRolls)) +
                row('Коэф. использования сырья', esc(plan.demand.useRatio == null ? '—' : plan.demand.useRatio));
        }

        html += '<div class="atex-lo-actions">' +
            '<button class="atex-lo-btn atex-lo-btn-primary" type="button" data-lo-action="pick">Подобрать нож</button>' +
            '<button class="atex-lo-btn" type="button" data-lo-action="manual">Выбрать нож вручную</button>' +
            (plan.die.pick === lp.DIE_PICK.MANUAL ? '<button class="atex-lo-btn" type="button" data-lo-action="auto">Вернуть автоподбор</button>' : '') +
            (this.canIts() ? '<button class="atex-lo-btn" type="button" data-lo-action="its-needed">' + (p.itsNeeded ? 'Снять отметку «нужен ИТС»' : 'Отметить: нужен ИТС') + '</button>' : '') +
            (plan.its.needed && this.canIts() ? '<button class="atex-lo-btn" type="button" data-lo-action="its">' + (p.itsConfirmed ? 'Снять подтверждение ИТС' : 'Подтвердить ИТС') + '</button>' : '') +
            '<button class="atex-lo-btn" type="button" data-lo-action="edit">Изменить</button>' +
            '</div>';
        el.innerHTML = html;
    };

    AtexLabelOrders.prototype.action = function(name, el) {
        if (this.busy && name !== 'modal-cancel') return;
        switch (name) {
            case 'refresh': return this.reload(true).then(function() {});
            case 'new': return this.openForm(null);
            case 'edit': return this.openForm(this.current());
            case 'pick': return this.pickOne(this.current(), null);
            case 'pick-all': return this.pickAll();
            case 'manual': return this.openManual(this.current());
            case 'manual-choose': return this.pickOne(this.current(), el.getAttribute('data-die'));
            case 'auto': return this.pickOne(this.current(), '');
            case 'its': return this.toggleIts(this.current());
            case 'its-needed': return this.toggleItsNeeded(this.current());
            case 'form-parse': return this.parseKnifeTypeIntoForm();
            case 'form-save': return this.saveForm();
            case 'modal-cancel': return this.closeModal();
        }
    };

    AtexLabelOrders.prototype.fieldsOf = function(write) {
        var r = this.tables.position.reqs;
        var out = {};
        Object.keys(write).forEach(function(k) { if (r[k]) out['t' + r[k]] = write[k]; });
        return out;
    };

    // Подбор ножа одной позиции. manualDieId: null — автоподбор с учётом записанного ручного
    // выбора; '' — сбросить ручной выбор и подобрать заново; id — выбрать этот нож вручную.
    AtexLabelOrders.prototype.pickOne = function(p, manualDieId) {
        var self = this;
        if (!p) return Promise.resolve();
        var pos = Object.assign({}, p);
        if (manualDieId === '') { pos.pick = ''; pos.dieId = ''; }
        else if (manualDieId) { pos.pick = lp.DIE_PICK.MANUAL; pos.dieId = String(manualDieId); }
        var plan = this.planOf(pos);
        this.busy = true;
        this.picking = true;
        this.closeModal();
        if (this.selectedId === p.id) this.renderCard();
        return this.post('_m_set/' + encodeURIComponent(p.id) + '?JSON', this.fieldsOf(plan.write)).then(function() {
            // Баннер — после перечитывания: до него карточка ещё показывает старое содержимое позиции.
            return self.reload(true).then(function() {
                self.message('Позиция заказа ' + p.orderNo + ': ' + (plan.die.ok ? 'нож № ' + plan.die.die.no + ' (' + plan.die.pick + ')' : 'нет ножа — ' + plan.die.reason), plan.die.ok ? 'ok' : 'warn');
            });
        }).catch(function(err) {
            console.error('[label-orders] ❌ подбор', err);
            self.message('Не записано: ' + err.message, 'error');
        }).then(function() { self.busy = false; self.picking = false; if (self.selectedId) self.renderCard(); });
    };

    AtexLabelOrders.prototype.pickAll = function() {
        var self = this;
        var todo = this.rows.map(function(p) { return { p: p, plan: self.planOf(p) }; })
            .filter(function(x) { return writeDiffers(x.p, x.plan.write); });
        if (!todo.length) { this.message('Подбор во всех позициях совпадает с расчётом — записывать нечего.', 'ok'); return Promise.resolve(); }
        return this.confirm('Записать подбор ножа, мин. партию и признак ИТС в ' + todo.length + ' позиций? Ручной выбор ножа сохраняется.').then(function(yes) {
            if (!yes) return;
            self.busy = true;
            var errors = [];
            var chain = Promise.resolve();
            todo.forEach(function(x) {
                chain = chain.then(function() {
                    return self.post('_m_set/' + encodeURIComponent(x.p.id) + '?JSON', self.fieldsOf(x.plan.write))
                        .catch(function(err) { errors.push(x.p.orderNo + ': ' + err.message); });
                });
            });
            return chain.then(function() {
                self.message(errors.length ? 'Записано ' + (todo.length - errors.length) + ' из ' + todo.length + '; ошибки: ' + errors.join('; ') : 'Подбор записан в ' + todo.length + ' позиций.', errors.length ? 'error' : 'ok');
                return self.reload(true);
            }).then(function() { self.busy = false; });
        });
    };

    AtexLabelOrders.prototype.canIts = function() {
        return canConfirmIts(this.ctx, this.settings && this.settings.itsRoles);
    };

    AtexLabelOrders.prototype.itsRolesText = function() {
        return itsRolesLabel(this.settings && this.settings.itsRoles);
    };

    // Ручная отметка «Нужно подтверждение ИТС» (#5318): ставит человек, размером не выводится.
    AtexLabelOrders.prototype.toggleItsNeeded = function(p) {
        var self = this;
        if (!p) return Promise.resolve();
        if (!this.canIts()) {
            this.message('Отмечать ИТС может только роль: ' + itsRolesLabel(this.settings && this.settings.itsRoles) + '.', 'warn');
            return Promise.resolve();
        }
        var reqId = this.tables.position.reqs.itsNeeded;
        if (!reqId) { this.message('В позиции нет реквизита «Нужно подтверждение ИТС».', 'error'); return Promise.resolve(); }
        var f = {};
        f['t' + reqId] = p.itsNeeded ? '' : '1';
        this.busy = true;
        return this.post('_m_set/' + encodeURIComponent(p.id) + '?JSON', f).then(function() {
            return self.reload(true);
        }).catch(function(err) { self.message('Не записано: ' + err.message, 'error'); })
            .then(function() { self.busy = false; });
    };

    AtexLabelOrders.prototype.toggleIts = function(p) {
        var self = this;
        if (!p) return Promise.resolve();
        if (!this.canIts()) {
            this.message('Подтверждать ИТС может только роль: ' + itsRolesLabel(this.settings && this.settings.itsRoles) + '.', 'warn');
            return Promise.resolve();
        }
        var text = p.itsConfirmed ? 'Снять подтверждение ИТС у позиции заказа ' + p.orderNo + '? Позиция вернётся в блокировку.'
            : 'Подтвердить ИТС: этикетка ' + p.width + ' × ' + p.length + ' мм (заказ ' + p.orderNo + ') может идти в производство?';
        return this.confirm(text).then(function(yes) {
            if (!yes) return;
            var f = {};
            f['t' + self.tables.position.reqs.itsConfirmed] = p.itsConfirmed ? '' : '1';
            self.busy = true;
            return self.post('_m_set/' + encodeURIComponent(p.id) + '?JSON', f).then(function() {
                return self.reload(true);
            }).catch(function(err) { self.message('Не записано: ' + err.message, 'error'); })
                .then(function() { self.busy = false; });
        });
    };

    // ── Модальные окна (alert/confirm запрещены гайдом рабочих мест) ─────────────

    AtexLabelOrders.prototype.openModal = function(html) {
        this.$('atex-lo-modal-body').innerHTML = html;
        this.$('atex-lo-modal').hidden = false;
    };
    AtexLabelOrders.prototype.closeModal = function() {
        var m = this.$('atex-lo-modal');
        if (m) m.hidden = true;
        if (this._confirmResolve) { var r = this._confirmResolve; this._confirmResolve = null; r(false); }
    };

    AtexLabelOrders.prototype.confirm = function(text) {
        var self = this;
        this.openModal('<div class="atex-lo-modal-text">' + esc(text) + '</div><div class="atex-lo-modal-actions">' +
            '<button class="atex-lo-btn" type="button" data-lo-action="modal-cancel">Отмена</button>' +
            '<button class="atex-lo-btn atex-lo-btn-primary" type="button" id="atex-lo-confirm-ok">Подтвердить</button></div>');
        return new Promise(function(resolve) {
            self._confirmResolve = resolve;
            self.$('atex-lo-confirm-ok').addEventListener('click', function() {
                self._confirmResolve = null;
                self.$('atex-lo-modal').hidden = true;
                resolve(true);
            });
        });
    };

    // Ручной выбор: все ножи этого размера (любой основы и состояния) — диспетчер видит, почему
    // автоподбор их не взял.
    AtexLabelOrders.prototype.openManual = function(p) {
        if (!p) return;
        var w = num(p.width), l = num(p.length);
        var list = this.dies.filter(function(d) { return Math.abs(num(d.width) - w) <= 0.05 && Math.abs(num(d.length) - l) <= 0.05; })
            .sort(function(a, b) { return a.meters - b.meters; });
        var html = '<h2 class="atex-lo-panel-title">Нож для ' + esc(p.width + ' × ' + p.length) + ' мм</h2>';
        html += list.length ? '<table class="atex-lo-table"><thead><tr><th>Нож</th><th>Основа</th><th>Состояние</th><th class="num">Ручьёв</th><th>Вал</th><th class="num">Пробег, м</th><th></th></tr></thead><tbody>' +
            list.map(function(d) {
                return '<tr' + (d.selectable ? '' : ' class="is-muted"') + '><td>' + esc(d.no) + '</td><td>' + esc(d.base || '—') + '</td><td>' + esc(d.state || '—') +
                    '</td><td class="num">' + esc(d.streams || '—') + '</td><td>' + esc(d.cylinder || '—') + '</td><td class="num">' + esc(fmtInt(d.meters)) +
                    '</td><td><button class="atex-lo-btn" type="button" data-lo-action="manual-choose" data-die="' + esc(d.id) + '">Выбрать</button></td></tr>';
            }).join('') + '</tbody></table>'
            : '<div class="atex-lo-empty">Ножей этого размера в базе нет.</div>';
        html += '<div class="atex-lo-modal-actions"><button class="atex-lo-btn" type="button" data-lo-action="modal-cancel">Закрыть</button></div>';
        this.openModal(html);
    };

    // ── Форма позиции ─────────────────────────────────────────────────────────────

    function options(list, selected, labelOf, empty) {
        return (empty != null ? '<option value="">' + esc(empty) + '</option>' : '') + (list || []).map(function(x) {
            return '<option value="' + esc(x.id) + '"' + (String(x.id) === String(selected) ? ' selected' : '') + '>' + esc(labelOf ? labelOf(x) : x.val) + '</option>';
        }).join('');
    }

    AtexLabelOrders.prototype.openForm = function(p) {
        var self = this;
        var e = p || {};
        this.formPosition = p;
        var field = function(name, label, input, hint) {
            return '<label class="atex-lo-field" data-field="' + name + '"><span>' + esc(label) + '</span>' + input +
                (hint ? '<small>' + esc(hint) + '</small>' : '') + '<em class="atex-lo-field-error"></em></label>';
        };
        var text = function(name, value, attrs) { return '<input name="' + name + '" value="' + esc(value == null ? '' : value) + '"' + (attrs || '') + '>'; };
        var orders = this.orders.slice().sort(function(a, b) { return Number(b.id) - Number(a.id); });
        var clientCol = this.cols.client ? this.cols.client.id : '';
        var matLabel = function(m) { var x = self.materials[m.id] || {}; return m.val + (x.base ? ' — ' + x.base : ''); };
        var html = '<h2 class="atex-lo-panel-title">' + (p ? 'Позиция заказа ' + esc(e.orderNo) : 'Новая позиция этикетки') + '</h2><form id="atex-lo-form" class="atex-lo-form">' +
            (p ? '' : field('orderId', 'Заказ', '<select name="orderId">' + options(orders, '', function(o) {
                var c = reqVal(o, clientCol); return o.val + (c ? ' · ' + c : '');
            }, '— новый заказ —') + '</select>') +
                field('newOrderNo', 'Номер нового заказа', text('newOrderNo', '')) +
                field('clientId', 'Клиент нового заказа', '<select name="clientId">' + options(this.clients, '', null, '—') + '</select>')) +
            field('knifeType', 'Тип ножей (1С)', text('knifeType', e.knifeType) + '<button class="atex-lo-btn" type="button" data-lo-action="form-parse">Размер из типа</button>', 'например «85 х 38 (80)»') +
            field('width', 'Ширина этикетки, мм', text('labelWidth', e.width, ' inputmode="decimal"')) +
            field('length', 'Длина этикетки, мм', text('labelLength', e.length, ' inputmode="decimal"')) +
            field('orderStreams', 'Ручьёв в заказе', text('orderStreams', e.orderStreams || '1', ' inputmode="numeric"'), 'нож подбирается с числом ручьёв, кратным этому') +
            field('labelsPerRoll', 'Этикеток в рулоне', text('labelsPerRoll', e.labelsPerRoll, ' inputmode="numeric"')) +
            field('rolls', 'Рулонов', text('rolls', e.rolls, ' inputmode="numeric"')) +
            field('materialId', 'Сырьё', '<select name="materialId">' + options(this.materialList, e.materialId, matLabel, '—') + '</select>', 'основа, клей и подложка — из карточки сырья') +
            field('sleeveWidth', 'Ширина втулки, мм', text('sleeveWidth', e.sleeveWidth, ' inputmode="decimal"'), 'пусто — из подобранного ножа') +
            field('sleeveId', 'Диаметр втулки', '<select name="sleeveId">' + options(this.sleeves, e.sleeveId, null, '—') + '</select>') +
            field('winding', 'Намотка', '<select name="winding">' + options([{ id: 'OUT', val: 'Наружу (OUT)' }, { id: 'IN', val: 'Внутрь (IN)' }], e.winding, null, '—') + '</select>') +
            field('due', 'Срок изготовления', '<input type="date" name="due" value="' + esc(ruToIso(e.due)) + '">') +
            '</form><div class="atex-lo-modal-actions"><button class="atex-lo-btn" type="button" data-lo-action="modal-cancel">Отмена</button>' +
            '<button class="atex-lo-btn atex-lo-btn-primary" type="button" data-lo-action="form-save">Сохранить и подобрать нож</button></div>';
        this.openModal(html);
    };

    AtexLabelOrders.prototype.formValues = function() {
        var form = this.$('atex-lo-form');
        var out = {};
        Array.prototype.forEach.call(form.elements, function(el) { if (el.name) out[el.name] = String(el.value || '').trim(); });
        // Поля размера названы labelWidth/labelLength: имя «length» у поля формы перекрыто
        // свойством HTMLFormElement.length (число полей).
        out.width = out.labelWidth || '';
        out.length = out.labelLength || '';
        if (this.formPosition) out.orderId = this.formPosition.orderId;
        return out;
    };

    AtexLabelOrders.prototype.parseKnifeTypeIntoForm = function() {
        var form = this.$('atex-lo-form');
        var r = lp.parseKnifeType(form.elements.knifeType.value);
        this.showFormErrors(r.ok ? {} : { knifeType: r.error });
        if (!r.ok) return;
        form.elements.labelWidth.value = r.width;
        form.elements.labelLength.value = r.length;
    };

    AtexLabelOrders.prototype.showFormErrors = function(err) {
        Array.prototype.forEach.call(this.root.querySelectorAll('.atex-lo-field'), function(f) {
            var msg = err[f.getAttribute('data-field')] || '';
            f.classList.toggle('has-error', !!msg);
            f.querySelector('.atex-lo-field-error').textContent = msg;
        });
    };

    AtexLabelOrders.prototype.saveForm = function() {
        var self = this;
        var f = this.formValues();
        var err = validatePositionForm(f, { prev: this.formPosition, canIts: this.canIts(), itsRoles: this.itsRolesText() });
        this.showFormErrors(err);
        if (Object.keys(err).length) return Promise.resolve();
        var t = this.tables, r = t.position.reqs;
        var p = this.formPosition;
        var fields = {};
        var put = function(reqId, v) { if (reqId) fields['t' + reqId] = v; };
        put(r.labelWidth, f.width.replace(',', '.'));
        put(r.labelLength, f.length.replace(',', '.'));
        put(r.orderStreams, f.orderStreams || '1');
        put(r.labelsPerRoll, f.labelsPerRoll);
        put(r.material, f.materialId);
        put(r.knifeType, f.knifeType);
        if (f.sleeveWidth) put(r.sleeveWidth, f.sleeveWidth.replace(',', '.'));
        if (f.sleeveId && this.cols.sleeve) put(this.cols.sleeve.id, f.sleeveId);
        if (f.winding && this.cols.winding) put(this.cols.winding.id, f.winding);
        if (f.due && this.cols.due) put(this.cols.due.id, isoToRu(f.due));
        // Размер поменялся — прежнее подтверждение ИТС было за другой размер.
        if (itsResetOnSave(p, f)) put(r.itsConfirmed, '');
        this.busy = true;
        var orderPromise = f.orderId ? Promise.resolve(f.orderId) : this.createOrder(f.newOrderNo, f.clientId);
        return orderPromise.then(function(orderId) {
            if (p) {
                var main = {};
                main['t' + t.position.id] = f.rolls;
                return self.post('_m_save/' + encodeURIComponent(p.id) + '?JSON', main)
                    .then(function() { return self.post('_m_set/' + encodeURIComponent(p.id) + '?JSON', fields); })
                    .then(function() { return p.id; });
            }
            var nf = Object.assign({}, fields);
            nf['t' + t.position.id] = f.rolls;
            if (self.kindLabelId) nf['t' + r.productKind] = self.kindLabelId;
            return self.post('_m_new/' + t.position.id + '?JSON&up=' + encodeURIComponent(orderId), nf).then(function(res) {
                var id = res && (res.id || res.obj);
                if (!id) throw new Error('позиция не создана: ' + JSON.stringify(res).slice(0, 200));
                return String(id);
            });
        }).then(function(posId) {
            self.closeModal();
            self.selectedId = posId;
            self.picking = true;   // нож подбирается сразу после перечитывания: карточка не показывает «записано: ничего»
            return self.reload(true).then(function() {
                var pos = self.current();
                self.busy = false;
                if (!pos) { self.picking = false; self.message('Позиция сохранена, но не попала в отчёт «' + REPORT + '» — проверьте «Вид продукции».', 'warn'); return; }
                return self.pickOne(pos, null);
            });
        }).catch(function(e) {
            console.error('[label-orders] ❌ сохранение', e);
            self.showFormErrors({ knifeType: '' });
            self.message('Не сохранено: ' + e.message, 'error');
            self.busy = false;
            self.picking = false;
        });
    };

    AtexLabelOrders.prototype.createOrder = function(no, clientId) {
        var t = this.tables;
        var f = { up: '1' };
        f['t' + t.order.id] = no;
        if (clientId && this.cols.client) f['t' + this.cols.client.id] = clientId;
        return this.post('_m_new/' + t.order.id + '?JSON&up=1', f).then(function(res) {
            var id = res && (res.id || res.obj);
            if (!id) throw new Error('заказ не создан: ' + JSON.stringify(res).slice(0, 200));
            return String(id);
        });
    };

    return { core: core, AtexLabelOrders: AtexLabelOrders };
});
