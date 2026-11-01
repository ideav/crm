// Статусы позиции и заказа этикетки по заданиям высечки (Фаза 2 atex; ideav/crm#5341).
//
// Правило: позиция «Выполнена», когда у неё есть задания высечки и все они «Выполнено»; заказ
// «Выполнен», когда выполнены все его позиции. Статус не откатывается назад: выполненное не
// трогается, отменённый заказ остаётся отменённым. Позиция без заданий не выполнена.
//
// Модуль без DOM и без привязки к рабочему месту. Звать его надо из того места, где задание
// высечки получает статус «Выполнено» (пульт высечки, die-cutter.js, после записи статуса):
//
//     AtexLabelStatus.completeAfterJob(client, meta, jobId)
//
// client — { getJson(path), post(path, fields) } (как у рабочих мест: get — JSON, post — тело
// формы с _xsrf), meta — ответ /metadata. Все таблицы и колонки находятся по именам.
// Чистая часть — completionPlan (план операций без записи) и applyPlan (запись плана).

(function(root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.AtexLabelStatus = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
    'use strict';

    var JOB_DONE = 'Выполнено';
    // Как называется «выполнено» в справочниках: «Статус позиции» — «Выполнена»; «Статус заказа» — «Выполнен».
    var POSITION_DONE = ['Выполнена', 'Выполнено'];
    var ORDER_DONE = ['Выполнен', 'Выполнено'];
    var ORDER_CANCELLED = ['Отменён', 'Отменен'];
    var REPORT = 'label_positions';

    function norm(s) {
        return String(s == null ? '' : s).replace(/ё/g, 'е').replace(/Ё/g, 'Е').replace(/\s+/g, ' ').trim().toLowerCase();
    }
    function isOneOf(label, names) {
        var n = norm(label);
        return names.some(function(x) { return norm(x) === n; });
    }
    function dictId(recs, names) {
        var hit = (recs || []).filter(function(r) { return isOneOf(r.val, names); })[0];
        return hit ? String(hit.id) : '';
    }

    // Задания позиции выполнены: хотя бы одно и все «Выполнено».
    function jobsDone(jobs) {
        return jobs.length > 0 && jobs.every(function(j) { return norm(j.status) === norm(JOB_DONE); });
    }

    // Что записать после выполнения заданий.
    // input:
    //   order      — { id, status (подпись) }
    //   positions  — позиции этого заказа: [{ id, status (подпись) }]
    //   jobs       — задания высечки позиций заказа: [{ id, positionId, status }]
    //   positionStatuses, orderStatuses — справочники [{ id, val }]
    //   tables     — { positionStatus: { id } (таблица справочника), positionStatusReq, orderStatusReq } —
    //                id реквизитов «Статус» в позиции и в заказе
    // → { positionsDone: [id], orderDone: bool, ops, skipped }
    // ops — { op: 'new', table, up, ref, fields } | { op: 'set', id, fields }; значение { ref } —
    // запись, созданная операцией new этого же плана (нет «Выполнена» в справочнике — создаётся).
    function completionPlan(input) {
        var inp = input || {};
        var t = inp.tables || {};
        var positions = inp.positions || [], jobs = inp.jobs || [];
        var ops = [], positionsDone = [], skipped = [];
        var order = inp.order || null;

        var byPos = {};
        jobs.forEach(function(j) { (byPos[String(j.positionId)] = byPos[String(j.positionId)] || []).push(j); });

        var posDoneId = dictId(inp.positionStatuses, POSITION_DONE);
        var posDoneValue = posDoneId || { ref: 'positionStatus:done' };
        var needPosDictRecord = false;

        var allDone = positions.length > 0;
        positions.forEach(function(p) {
            var already = isOneOf(p.status, POSITION_DONE);
            var done = already || jobsDone(byPos[String(p.id)] || []);
            if (!done) { allDone = false; return; }
            if (already) return;
            if (!t.positionStatusReq) { skipped.push('в позиции нет колонки «Статус позиции»'); return; }
            positionsDone.push(String(p.id));
            needPosDictRecord = !posDoneId;
            var fields = {};
            fields['t' + t.positionStatusReq] = posDoneValue;
            ops.push({ op: 'set', id: String(p.id), fields: fields });
        });
        if (needPosDictRecord && t.positionStatus) {
            var fv = {};
            fv['t' + t.positionStatus.id] = POSITION_DONE[0];
            ops.unshift({ op: 'new', table: t.positionStatus.id, up: 1, ref: 'positionStatus:done', fields: fv });
        }

        var orderDone = false;
        if (allDone && order && !isOneOf(order.status, ORDER_DONE) && !isOneOf(order.status, ORDER_CANCELLED)) {
            if (!t.orderStatusReq) skipped.push('в заказе нет колонки «Статус заказа»');
            else {
                var ordDoneId = dictId(inp.orderStatuses, ORDER_DONE);
                if (!ordDoneId) skipped.push('в справочнике «Статус заказа» нет «Выполнен»');
                else {
                    var of = {};
                    of['t' + t.orderStatusReq] = ordDoneId;
                    ops.push({ op: 'set', id: String(order.id), fields: of });
                    orderDone = true;
                }
            }
        }
        return { positionsDone: positionsDone, orderDone: orderDone, ops: ops, skipped: skipped };
    }

    // Запись плана. api — { create(tableId, up, fields) → Promise<id>, set(id, fields) → Promise }.
    function applyPlan(plan, api) {
        var created = {};
        var chain = Promise.resolve();
        (plan.ops || []).forEach(function(op) {
            chain = chain.then(function() {
                var fields = {};
                Object.keys(op.fields).forEach(function(k) {
                    var v = op.fields[k];
                    if (v && typeof v === 'object' && v.ref) {
                        if (created[v.ref] == null) throw new Error('запись «' + v.ref + '» не создана');
                        v = created[v.ref];
                    }
                    fields[k] = v;
                });
                if (op.op === 'new') return api.create(op.table, op.up, fields).then(function(id) { created[op.ref] = String(id); });
                return api.set(op.id, fields);
            });
        });
        return chain.then(function() { return created; });
    }

    // ── Чтение базы и запись ─────────────────────────────────────────────────────────────

    function kv(json) {
        var reqs = (json && json.reqs) || {};
        return ((json && json.object) || []).map(function(o) {
            return { id: String(o.id), up: o.up == null ? '' : String(o.up), val: o.val == null ? '' : String(o.val), reqs: reqs[o.id] || {} };
        });
    }
    function tableByName(meta, name) {
        return (meta || []).filter(function(t) { return norm(t.val) === norm(name); })[0] || null;
    }
    function reqByName(table, names) {
        var list = Array.isArray(names) ? names : [names];
        var reqs = (table && table.reqs) || [];
        for (var i = 0; i < list.length; i++) {
            var hit = reqs.filter(function(r) { return norm(r.val) === norm(list[i]) || norm(r.alias) === norm(list[i]) ||
                norm(r.field_attrs && r.field_attrs.alias) === norm(list[i]); })[0];
            if (hit) return String(hit.id);
        }
        return '';
    }
    function refOf(rec, reqId) {
        var raw = rec.reqs['ref_' + reqId];
        if (raw != null && String(raw).trim() !== '') return String(raw).replace(/^\s*\d+:/, '').split(',')[0].trim();
        return '';
    }

    // Пересчитать статусы после того, как задание jobId стало «Выполнено». → Promise<plan>.
    // Читает: задания высечки, отчёт label_positions (позиция → заказ, статус), заказы, справочники статусов.
    function completeAfterJob(client, meta, jobId) {
        var jobT = tableByName(meta, 'Задание высечки'), posT = tableByName(meta, 'Заказанное количество');
        var ordT = tableByName(meta, 'Заказ');
        var posStT = tableByName(meta, 'Статус позиции'), ordStT = tableByName(meta, 'Статус заказа');
        if (!jobT || !posT || !ordT) return Promise.reject(new Error('в базе нет таблиц «Задание высечки», «Заказанное количество» или «Заказ»'));
        var jobPosReq = reqByName(jobT, 'Заказанное количество'), jobStatusReq = reqByName(jobT, 'Статус задания этикетки');
        var posStatusReq = reqByName(posT, ['Статус позиции', 'Статус']), ordStatusReq = reqByName(ordT, ['Статус заказа', 'Статус']);
        return Promise.all([
            client.getJson('object/' + jobT.id + '/?JSON_KV&LIMIT=0,100000'),
            client.getJson('report/' + REPORT + '?JSON_KV&LIMIT=0,100000'),
            client.getJson('object/' + ordT.id + '/?JSON_KV&LIMIT=0,100000'),
            posStT ? client.getJson('object/' + posStT.id + '/?JSON_KV&LIMIT=0,200') : Promise.resolve(null),
            ordStT ? client.getJson('object/' + ordStT.id + '/?JSON_KV&LIMIT=0,200') : Promise.resolve(null)
        ]).then(function(r) {
            var allJobs = kv(r[0]).map(function(j) {
                return { id: j.id, positionId: refOf(j, jobPosReq), status: j.reqs[jobStatusReq] || '' };
            });
            var job = allJobs.filter(function(j) { return j.id === String(jobId); })[0];
            if (!job || !job.positionId) throw new Error('задание ' + jobId + ' не найдено или без позиции');
            var rows = Array.isArray(r[1]) ? r[1] : [];
            var me = rows.filter(function(x) { return String(x['РулоновID']) === job.positionId; })[0];
            if (!me) return { positionsDone: [], orderDone: false, ops: [], skipped: ['позиция не в отчёте ' + REPORT + ' (не этикетка?)'] };
            var orderId = String(me['ЗаказID']);
            var positions = rows.filter(function(x) { return String(x['ЗаказID']) === orderId; })
                .map(function(x) { return { id: String(x['РулоновID']), status: x['Статус'] || '' }; });
            var ids = {};
            positions.forEach(function(p) { ids[p.id] = true; });
            var ordRec = kv(r[2]).filter(function(o) { return o.id === orderId; })[0];
            var plan = completionPlan({
                order: { id: orderId, status: ordRec && ordStatusReq ? (ordRec.reqs[ordStatusReq] || '') : '' },
                positions: positions,
                jobs: allJobs.filter(function(j) { return ids[j.positionId]; }),
                positionStatuses: r[3] ? kv(r[3]) : [], orderStatuses: r[4] ? kv(r[4]) : [],
                tables: { positionStatus: posStT ? { id: posStT.id } : null, positionStatusReq: posStatusReq, orderStatusReq: ordStatusReq }
            });
            return applyPlan(plan, {
                create: function(tableId, up, fields) {
                    return client.post('_m_new/' + tableId + '?JSON&up=' + encodeURIComponent(up), fields).then(function(res) {
                        var id = res && (res.id || res.obj);
                        if (!id) throw new Error('запись не создана: ' + JSON.stringify(res).slice(0, 200));
                        return id;
                    });
                },
                set: function(id, fields) { return client.post('_m_set/' + encodeURIComponent(id) + '?JSON', fields); }
            }).then(function() { return plan; });
        });
    }

    return {
        JOB_DONE: JOB_DONE,
        POSITION_DONE: POSITION_DONE,
        ORDER_DONE: ORDER_DONE,
        completionPlan: completionPlan,
        applyPlan: applyPlan,
        completeAfterJob: completeAfterJob
    };
});
