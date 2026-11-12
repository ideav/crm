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

    // Партнёрский раздел ЛК: блоки partnerLinks, partnerClients, partnerExam, partnerStats
    // (отчёты с теми же именами, столбцы — точки вставки в templates/my/cabdata.html)
    function readPartnerData(json) {
        var links = blockRows(json, 'partnerLinks').filter(function (r) { return r.material || r.title; }).map(function (r) {
            return { material: r.material || '', title: r.title || r.material, token: r.token || '', kind: r.kind || 'page' };
        });
        var clients = blockRows(json, 'partnerClients').filter(function (r) { return r.client; }).map(function (r) {
            return { name: r.client, came: r.came || '', did: r.did || '', start: r.start || r.came || '', paid: r.paid === '1' };
        });
        var e = blockRows(json, 'partnerExam')[0];
        var exam = e ? {
            passed: e.passed === '1', score: num(e.score), date: e.examdate || '',
            attemptsLeft: e.attemptsleft === '' || e.attemptsleft == null ? 3 : parseInt(e.attemptsleft, 10) || 0,
            threshold: num(e.threshold) || 80
        } : null;
        var s = blockRows(json, 'partnerStats')[0];
        var stats = s ? {
            clients: num(s.clients), onSupport: num(s.onsupport), paidClients: num(s.paidclients), earned: num(s.earned),
            opens: num(s.opens), people: num(s.people), videoPeople: num(s.videopeople),
            presentationPeople: num(s.presentationpeople), kpPeople: num(s.kppeople),
            botStarts: num(s.botstarts), flows: num(s.flows)
        } : null;
        return { links: links, clients: clients, exam: exam, stats: stats };
    }

    // Один запрос /cabdata?JSON кормит и тарифы, и партнёрский раздел: ответ держится 3 секунды,
    // чтобы повторный вызов позже (после оплаты) читал свежие данные
    var cabJsonCache = {};
    function fetchCabJson(base) {
        var hit = cabJsonCache[base];
        if (hit && Date.now() - hit.t < 3000) return hit.p;
        var p = fetch(base + '/cabdata?JSON', { credentials: 'include' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; });
        cabJsonCache[base] = { t: Date.now(), p: p };
        return p;
    }

    function loadCabData(base) {
        return fetchCabJson(base).then(readCabData);
    }

    function loadPartnerData(base) {
        return fetchCabJson(base).then(readPartnerData);
    }

    root.MyMode = {
        getMode: getMode, blockRows: blockRows, readCabData: readCabData, put: put, loadCabData: loadCabData,
        readPartnerData: readPartnerData, loadPartnerData: loadPartnerData
    };

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
