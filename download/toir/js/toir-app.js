/* ТОиР: общий слой рабочих мест (данные, запись, окна, модель). Расчёты - в toir-core.js. */
(function () {
    'use strict';
    var C = window.ToirCore;
    var T = window.Toir = { core: C };
    var host = document.getElementById('toir-app');
    var ds = host ? host.dataset : {};
    T.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    T.TODAY = '2026-11-26'; /* дата демо */
    T.dec = function (s) { return typeof s === 'string' ? s.replace(/&comma;/g, ',') : s; };
    T.esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    T.url = function (p) { return '/' + T.ctx.db + '/' + p; };
    T.get = function (p) {
        return fetch(T.url(p), { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + p); return r.json(); });
    };
    function answer(r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
            var e = Array.isArray(j) ? j[0] : j;
            if (e && e.error) throw new Error(e.error);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return j;
        });
    }
    /* POST с XSRF; вложенные объекты уходят JSON-строкой, File - файлом. */
    T.post = function (p, fields) {
        var fd = new FormData();
        fd.append('_xsrf', T.ctx.xsrf);
        Object.keys(fields || {}).forEach(function (k) { var v = fields[k]; if (v instanceof Blob) fd.append(k, v, v.name || 'photo.jpg'); else fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v); });
        return fetch(T.url(p), { method: 'POST', body: fd, credentials: 'same-origin' }).then(answer);
    };
    var metaP = null;
    T.meta = function () { return metaP || (metaP = T.get('metadata?JSON=1').then(function (m) { var by = {}; m.forEach(function (t) { by[t.val] = t; }); T.metaBy = by; return by; })); };
    T.tid = function (name) { return T.metaBy[name] && T.metaBy[name].id; };
    T.reqId = function (table, name) { var t = T.metaBy[table], r = t && (t.reqs || []).filter(function (x) { return x.val === name; })[0]; return r ? r.id : null; };
    T.canWrite = function (name) { return !!(T.metaBy[name] && T.metaBy[name].granted === 'WRITE'); };
    T.canRead = function (name) { return !!T.metaBy[name]; };
    function norm(o) {
        var r = { _id: String(o.id), _ref: {} };
        Object.keys(o).forEach(function (k) {
            if (k === 'id' || k === 'up' || k === 'ord') return;
            var v = o[k];
            if (v && typeof v === 'object') { if (v.id !== undefined) { r[k] = T.dec(v.val); r._ref[k] = String(v.id); } return; }
            r[k] = v === null ? '' : T.dec(v);
        });
        return r;
    }
    /* Все записи таблицы (страницами по 700, по 3 параллельно); нет доступа - пустой список. */
    T.rows = function (name) {
        if (!T.canRead(name)) return Promise.resolve([]);
        var id = T.tid(name), out = [], PAGE = 700, PAR = 3;
        function batch(off) {
            var ps = [];
            for (var i = 0; i < PAR; i++) ps.push(T.get('object/' + id + '/?JSON_OBJ&NAMED&LIMIT=' + (off + i * PAGE) + ',' + PAGE).catch(function () { return []; }));
            return Promise.all(ps).then(function (pages) {
                var done = false;
                pages.forEach(function (j) { if (done) return; if (!Array.isArray(j)) { done = true; return; } j.forEach(function (o) { out.push(norm(o)); }); if (j.length < PAGE) done = true; });
                return done ? out : batch(off + PAR * PAGE);
            });
        }
        return batch(0);
    };
    T.map = function (rows, key) { var m = {}; (rows || []).forEach(function (r) { m[r[key]] = r; }); return m; };
    T.fmt = function (x, d) { return C.num(x).toFixed(d || 0).replace('.', ','); };
    T.money = function (x) { var n = Math.round(C.num(x)); return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; };
    T.h = function (x) { var n = C.num(x); return (Math.round(n * 10) / 10).toString().replace('.', ',') + ' ч'; };
    T.create = function (table, fields) { return T.post('_m_new/' + T.tid(table) + '?JSON', { up: 1, fields: fields }).then(function (j) { var id = String(j.id || j.obj || ''); if (!id) throw new Error('Запись не создана'); return id; }); };
    T.update = function (id, fields) { return T.post('_m_set/' + id + '?JSON', { fields: fields }); };
    T.upload = function (id, table, field, file) { var k = T.reqId(table, field); return k ? T.post('_m_set/' + id + '?JSON', { ['t' + k]: file }) : Promise.resolve(); };
    T.href = function (a) { var m = /href="([^"]+)"/.exec(a || ''); return m ? m[1].replace(/&amp;/g, '&') : ''; };
    /* Время по Москве для отметок. */
    T.now = function () { var d = new Date(Date.now() + 3 * 3600e3); return ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2) + ':' + ('0' + d.getUTCSeconds()).slice(-2); };
    T.hm = function () { return T.now().slice(0, 5); };
    T.who = function () { return T.ctx.user; };
    T.isAdmin = function () { return /admin/i.test(T.ctx.role) || T.ctx.user === T.ctx.db; };
    T.roleIs = function (re) { return T.isAdmin() || re.test(T.ctx.role); };
})();
