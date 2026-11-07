// ЛК базы my (#5420): режим страницы и данные отчётов ЛК.
//
// templates/my/main.html несёт обе разметки в <template>: ЛК клиента (my-*-cabinet) и рабочее
// место админа (my-*-admin). Режим выбирается по виду пользователя AppView.getView (js/app-view.js):
// вид admin (роль admin, суперадмин по ADMINHASH, владелец базы, полные гранты) — рабочее место
// админа, остальные — ЛК. put(part) вставляет разметку своего режима на место вызова через
// document.write, пока страница разбирается: скрипты разметки выполняются по порядку, а разметка
// другого режима в документ не попадает (в обеих одинаковые id навбара и меню пользователя).
//
// Данные отчётов ЛК, которые клиент не может запросить сам (отчёты закрыты маской), отдаёт
// шаблонизатор: шаблон templates/my/cabdata.html, ответ /my/cabdata?JSON. readCabData разбирает
// ответ: ключи — пути блоков (&main.a.plans), значения — столбцы точек вставки.
(function (root) {
    'use strict';

    function getMode(ctx, getView) {
        var view = typeof getView === 'function' ? getView(ctx || {}) : 'user';
        return view === 'admin' ? 'admin' : 'cabinet';
    }

    // Строки блока name (без учёта регистра и пути) из API-ответа шаблонизатора
    function blockRows(json, name) {
        var want = String(name).toLowerCase(), cols = null;
        if (!json || typeof json !== 'object' || Array.isArray(json)) return [];
        Object.keys(json).forEach(function (key) {
            var parts = key.toLowerCase().split('.');
            if (parts[parts.length - 1] === want && json[key] && typeof json[key] === 'object') cols = json[key];
        });
        if (!cols) return [];
        var rows = [];
        Object.keys(cols).forEach(function (col) {
            (Array.isArray(cols[col]) ? cols[col] : []).forEach(function (val, i) {
                rows[i] = rows[i] || {};
                rows[i][col.toLowerCase()] = val == null ? '' : String(val);
            });
        });
        return rows;
    }

    function num(v) {
        var n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
        return isNaN(n) ? 0 : n;
    }

    function readCabData(json) {
        var plans = blockRows(json, 'plans').filter(function (r) { return r.planid; }).map(function (r) {
            return { id: r.planid, name: r.planname || r.planid, price: num(r.price), limit: parseInt(r.limit, 10) || 0 };
        });
        var paid = blockRows(json, 'paidThisMonth').reduce(function (s, r) { return s + num(r.payment); }, 0);
        var me = blockRows(json, 'noAdmin')[0] || {};
        return { plans: plans, paidThisMonth: paid, limit: parseInt(me.limit, 10) || 0 };
    }

    function put(part, doc) {
        doc = doc || root.document;
        var tpl = doc.getElementById('my-' + part + '-' + root.MY_MODE);
        if (tpl) doc.write(tpl.innerHTML);
    }

    function loadCabData(base) {
        return fetch(base + '/cabdata?JSON', { credentials: 'include' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(readCabData)
            .catch(function () { return readCabData(null); });
    }

    root.MyMode = { getMode: getMode, blockRows: blockRows, readCabData: readCabData, put: put, loadCabData: loadCabData };

    if (root.document && root.document.documentElement) {
        // Гранты шаблонизатор отдаёт base64-строкой; у суперадмина их может не быть совсем
        if (typeof root.grants === 'undefined') {
            try { root.grants = JSON.parse(root.atob(root.grantsB64 || '')); } catch (e) { root.grants = null; }
        }
        root.MY_MODE = getMode({
            db: root.db, user: root.user, role: root.role, roleId: root.roleId, grants: root.grants
        }, root.AppView && root.AppView.getView);
        root.document.documentElement.setAttribute('data-my-mode', root.MY_MODE);
    }
})(typeof window !== 'undefined' ? window : globalThis);
