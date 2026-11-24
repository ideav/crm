/* PIM: общий слой рабочих мест (данные, запись, окна, таблицы). Расчёты - в pim-core.js. */
(function () {
    'use strict';
    var Core = window.PimCore;
    var W = window.Pim = { core: Core };
    var host = document.getElementById('pim-app');
    var ds = host ? host.dataset : {};
    W.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };

    W.dec = function (s) { return typeof s === 'string' ? s.replace(/&comma;/g, ',') : s; };
    W.esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    W.url = function (p) { return '/' + W.ctx.db + '/' + p; };
    W.get = function (p) {
        return fetch(W.url(p), { credentials: 'same-origin' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + p);
            return r.json();
        });
    };
    /* POST с XSRF; fields - объект значений, вложенные объекты уходят JSON-строкой. */
    W.post = function (p, fields) {
        var fd = new FormData();
        fd.append('_xsrf', W.ctx.xsrf);
        Object.keys(fields || {}).forEach(function (k) {
            var v = fields[k]; fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v);
        });
        return fetch(W.url(p), { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (j) {
                var e = Array.isArray(j) ? j[0] : j;
                if (e && e.error) throw new Error(e.error);
                return j;
            });
    };
    var metaP = null;
    W.meta = function () { return metaP || (metaP = W.get('metadata?JSON=1').then(function (m) { var by = {}; m.forEach(function (t) { by[t.val] = t; }); W.metaBy = by; return by; })); };
    W.tid = function (name) { return W.metaBy[name] && W.metaBy[name].id; };
    W.canWrite = function (name) { return !!(W.metaBy[name] && W.metaBy[name].granted === 'WRITE'); };
    W.canRead = function (name) { return !!W.metaBy[name]; };

    /* Запись NAMED -> плоский объект: ссылки как строка значения, id ссылок в _ref, счётчики подчинённых пропускаются. */
    function norm(o) {
        var r = { _id: String(o.id), _up: String(o.up), _ref: {} };
        Object.keys(o).forEach(function (k) {
            if (k === 'id' || k === 'up' || k === 'ord') return;
            var v = o[k];
            if (v && typeof v === 'object') { if (v.id !== undefined) { r[k] = W.dec(v.val); r._ref[k] = String(v.id); } return; }
            r[k] = v === null ? '' : W.dec(v);
        });
        return r;
    }
    W.rows = function (name, up) {
        var id = W.tid(name), out = [], PAGE = 2000;
        function page(off) {
            return W.get('object/' + id + '/?JSON_OBJ&NAMED&LIMIT=' + off + ',' + PAGE + (up ? '&F_U=' + up : '')).then(function (j) {
                if (!Array.isArray(j)) throw new Error('Нет доступа к таблице «' + name + '»');
                j.forEach(function (o) { out.push(norm(o)); });
                return j.length < PAGE ? out : page(off + PAGE);
            });
        }
        return page(0);
    };
    W.report = function (name, query) {
        return W.get('report/' + encodeURIComponent(name) + '?JSON_KV' + (query || '')).then(function (j) { return Array.isArray(j) ? j : []; });
    };
    W.all = function (names) { return Promise.all(names.map(function (n) { return W.rows(n); })); };
    W.map = function (rows, key) { var m = {}; rows.forEach(function (r) { m[r[key]] = r; }); return m; };
    W.num = Core.num;
    W.right = function (x) { return String(Core.num(x)).replace('.', ','); };
    W.TODAY = '2026-11-23'; /* дата демо */
    W.truthy = function (v) { return v === '1' || v === 'X' || v === true; };
    W.split = function (s) { return s ? String(s).split('|').map(function (x) { return x.trim(); }).filter(Boolean) : []; };
    W.iso = function (d) { var m = /^(\d\d)\.(\d\d)\.(\d{4})$/.exec(d || ''); return m ? m[3] + '-' + m[2] + '-' + m[1] : (d || ''); };
    W.dmy = function (d) { var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(d || ''); return m ? m[3] + '.' + m[2] + '.' + m[1] : (d || ''); };
    W.pack = function (rows) { return W.map(rows, '_id'); };

    /* Пакет операций _m_batch; бросает ошибку с первой причиной, если часть операций упала. */
    W.batch = function (ops) {
        var out = [], i = 0;
        function next() {
            if (i >= ops.length) return Promise.resolve(out);
            var part = ops.slice(i, i + 400); i += 400;
            return W.post('_m_batch', { ops: part }).then(function (j) {
                var res = (j && j.results) || [];
                var bad = res.filter(function (x) { return !x.ok; });
                if (bad.length) throw new Error(bad.length + ' из ' + part.length + ' операций не прошли: ' + (bad[0].error || '').replace(/!.*$/, ''));
                out = out.concat(res); return next();
            });
        }
        return next();
    };

    /* ---------- модель: справочники, площадки, соответствия, карточки с готовностью ---------- */
    W.FIELD = { name: 'Название товара', desc: 'Описание товара', brand: 'Бренд', country: 'Страна производства', barcode: 'Штрихкод', weight: 'Вес, г', photos: 'Фото, шт', status: 'Статус карточки', price: 'Цена, ₽', category: 'Категория', supplier: 'Поставщик' };
    W.loadModel = function () {
        var soft = function (n, up) { return W.rows(n, up).catch(function () { return []; }); };
        return Promise.all([W.rows('Товар'), soft('Значение атрибута', '-1'), W.rows('Атрибут'), W.rows('Категория'), soft('Атрибут категории', '-1'), W.rows('Атрибут площадки'),
            W.rows('Соответствие значения'), W.rows('Площадка'), W.rows('Статус карточки'), soft('Выгрузка'), soft('Строка выгрузки', '-1'), soft('Настройки демо'), soft('Название для площадки', '-1')]).then(function (r) {
            var M = { attrs: {}, categories: {}, channels: [], chanAttrs: [], valueMap: {}, vmIds: {}, statuses: [], products: [], byId: {}, journal: r[9], journalLines: r[10], rawMap: {} };
            M.settingRows = r[11]; W.S = M.settings = Core.resolveSettings(r[11].map(function (x) { return { code: x['Код настройки'], value: x['Значение настройки'] }; }));
            r[2].forEach(function (a) { M.attrs[a['Атрибут']] = { id: a._id, name: a['Атрибут'], type: a['Тип значения'] || 'text', unit: a['Единица'], values: W.split(a['Допустимые значения']), field: a['Поле карточки'] || '' }; });
            var catById = {};
            r[3].forEach(function (c) { var o = { id: c._id, name: c['Категория'], type: c['Тип товара'], attrs: [] }; M.categories[o.name] = o; catById[o.id] = o; });
            r[4].forEach(function (x) { var c = catById[x._up]; if (c && x._ref['Атрибут']) c.attrs.push({ name: x['Атрибут'], required: W.truthy(x['Обязателен']), order: Core.num(x['Порядок']) }); });
            Object.keys(M.categories).forEach(function (k) { M.categories[k].attrs.sort(function (a, b) { return a.order - b.order; }); });
            M.channels = r[7].map(function (c) { return { id: c._id, name: c['Площадка'], code: c['Код'], type: c['Тип площадки'], titleLimit: Core.num(c['Лимит названия']), descLimit: Core.num(c['Лимит описания']), minPhotos: Core.num(c['Мин. фото']), template: c['Шаблон названия'], format: c['Формат выгрузки'], api: c['Подключение API'], limitsChecked: W.dmy(W.iso(c['Лимиты сверены'])), limitsSource: c['Источник лимитов'] }; });
            r[5].forEach(function (a) { M.chanAttrs.push({ id: a._id, key: a['Атрибут площадки'], channel: a['Площадка'], category: a['Категория'], catTitle: a['Категория площадки'], title: a['Название на площадке'], ours: a['Наш атрибут'], required: W.truthy(a['Обязателен']), values: W.split(a['Допустимые значения']), limit: Core.num(a['Лимит длины']), order: Core.num(a['Порядок']) }); });
            r[6].forEach(function (v) { var k = v['Атрибут площадки'], n = Core.norm(v['Соответствие значения']); (M.rawMap[k] = M.rawMap[k] || {})[n] = v['Значение площадки']; (M.vmIds[k] = M.vmIds[k] || {})[n] = v._id; });
            M.rebuildMap = function () { M.valueMap = Core.buildValueMap(M.rawMap, M.chanAttrs, Core.opt(M.settings, 'value_map_scope')); };
            M.rebuildMap();
            M.statuses = r[8].sort(function (a, b) { return Core.num(a['Порядок']) - Core.num(b['Порядок']); }).map(function (s) { return s['Статус карточки']; });
            M.products = r[0].map(function (p) {
                var o = { id: p._id, sku: p['Товар'], name: p['Название товара'], category: p['Категория'], brand: p['Бренд'], supplier: p['Поставщик'], country: p['Страна производства'], barcode: p['Штрихкод'], desc: p['Описание товара'],
                    weight: p['Вес, г'], photos: Core.num(p['Фото, шт']), status: p['Статус карточки'], version: Core.num(p['Версия']) || 1, updated: W.iso(p['Обновлён']), owner: p['Ответственный'], price: p['Цена, ₽'], values: {}, valueIds: {}, titles: {}, titleIds: {} };
                M.byId[o.id] = o; return o;
            });
            r[1].forEach(function (v) { var p = M.byId[v._up]; if (p && v._ref['Атрибут']) { p.values[v['Атрибут']] = v['Значение атрибута']; p.valueIds[v['Атрибут']] = v._id; } });
            r[12].forEach(function (t) { var p = M.byId[t._up]; if (p && t['Площадка']) { p.titles[t['Площадка']] = t['Название для площадки']; p.titleIds[t['Площадка']] = t._id; } });
            M.chan = function (n) { return M.channels.filter(function (c) { return c.name === n; })[0]; };
            M.check = function (p) { p._res = Core.checkAll(p, M.channels, M.chanAttrs, M); return p._res; };
            M.checkAll = function () { M.products.forEach(M.check); return M; };
            M.cards = function () { return M.products.map(function (p) { return { p: p, res: p._res || M.check(p) }; }); };
            return M.checkAll();
        });
    };
    /* Что может текущий пользователь (по правам на таблицы, а не по названию роли). */
    W.caps = function () {
        var edit = W.canWrite('Значение атрибута'), card = W.canWrite('Товар');
        return { card: card, edit: edit, approve: Core.canApprove(W.S, { card: card, edit: edit, feed: W.canWrite('Выгрузка') }), review: card, mapping: W.canWrite('Соответствие значения'), feed: W.canWrite('Выгрузка'),
            titles: W.canWrite('Название для площадки'), limits: W.canWrite('Площадка'), settings: W.canWrite('Настройки демо') };
    };
    /* Операции записи для набора изменений карточки (поля и значения атрибутов); версия растёт, дата обновляется. */
    W.cardOps = function (p, changes) {
        var ops = [], f = {};
        Object.keys(changes.fields || {}).forEach(function (key) { f[W.FIELD[key]] = changes.fields[key]; });
        f['Версия'] = String(p.version + 1); f['Обновлён'] = W.TODAY;
        ops.push({ op: 'save', id: p.id, fields: f });
        Object.keys(changes.values || {}).forEach(function (a) {
            var v = changes.values[a], id = p.valueIds[a];
            if (id && v === '') ops.push({ op: 'del', id: id });
            else if (id) ops.push({ op: 'save', id: id, fields: { 'Значение атрибута': v } });
            else if (v !== '') ops.push({ op: 'new', id: 'Значение атрибута', up: p.id, fields: { 'Значение атрибута': v, 'Атрибут': a } });
        });
        return ops.concat(Core.titleOps(p, changes.titles));
    };
    W.applyLocal = function (p, changes) {
        Object.keys(changes.fields || {}).forEach(function (key) { p[key] = key === 'photos' ? Core.num(changes.fields[key]) : changes.fields[key]; });
        Object.keys(changes.values || {}).forEach(function (a) { if (changes.values[a] === '') delete p.values[a]; else p.values[a] = changes.values[a]; });
        Object.keys(changes.titles || {}).forEach(function (c) { if (changes.titles[c] === '') delete p.titles[c]; else p.titles[c] = changes.titles[c]; });
        p.version += 1; p.updated = W.TODAY;
    };
    W.saveCard = function (p, changes) { return W.batch(W.cardOps(p, changes)).then(function () { W.applyLocal(p, changes); return p; }); };
    /* Редактор значения атрибута по его типу. */
    W.valueInput = function (attr, value, onchange) {
        var el;
        if (attr.type === 'list' || attr.type === 'bool') {
            el = W.select([['', '— не задано —']].concat((attr.values.length ? attr.values : ['Да', 'Нет']).map(function (v) { return [v, v]; })), value || '');
            if (value && el.value !== value) { el.appendChild(W.el('option', { value: value, text: value + ' (нет в справочнике)' })); el.value = value; }
        } else el = W.el('input', { type: 'text', value: value || '', inputmode: attr.type === 'number' ? 'decimal' : 'text' });
        el.addEventListener('input', function () { onchange(el.value); }); el.addEventListener('change', function () { onchange(el.value); });
        return el;
    };
    /* Добавить или изменить соответствие нашего значения значению справочника площадки. ca - строка справочника атрибутов площадки. */
    W.mapValueModal = function (M, ca, ours, done) {
        var n = Core.norm(ours), exist = M.vmIds[ca.key] && M.vmIds[ca.key][n];
        var sel = W.select([['', '— выберите —']].concat(ca.values.map(function (v) { return [v, v]; })), (M.valueMap[ca.key] || {})[n] || '');
        W.modal('Соответствие значения', W.el('div', {}, [W.el('p', { 'class': 'pim-sub', text: ca.channel + ' / ' + ca.title + ': наше значение «' + ours + '» нужно привести к справочнику площадки.' + (Core.opt(M.settings, 'value_map_scope') === 'channel' ? ' Справочник общий на площадку: соответствие подействует во всех категориях.' : ' Справочник по категории: для других категорий соответствие задаётся отдельно.') }), W.field('Значение площадки', sel)]),
            [{ text: 'Отмена' }, { text: 'Сохранить', cls: 'pim-primary', keep: true, fn: function (close) {
                if (!sel.value) { W.toast('Выберите значение площадки', true); return false; }
                var op = exist ? { op: 'save', id: exist, fields: { 'Значение площадки': sel.value } } : { op: 'new', id: 'Соответствие значения', up: 1, fields: { 'Соответствие значения': ours, 'Атрибут площадки': ca.key, 'Значение площадки': sel.value } };
                W.batch([op]).then(function (res) { (M.rawMap[ca.key] = M.rawMap[ca.key] || {})[n] = sel.value; M.rebuildMap(); (M.vmIds[ca.key] = M.vmIds[ca.key] || {})[n] = exist || res[0].id; M.checkAll(); W.toast('Соответствие сохранено'); close(); if (done) done(); }).catch(function (e) { W.toast(e.message, true); });
                return false; } }]);
    };
    /* Создать карточки из импорта пачками (родитель адресуется через :idN внутри пакета). */
    W.createCards = function (recs, base) {
        var chunks = [], cur = [], i;
        recs.forEach(function (r) { cur.push(r); if (cur.length >= 30) { chunks.push(cur); cur = []; } }); if (cur.length) chunks.push(cur);
        var created = 0;
        function next(k) {
            if (k >= chunks.length) return Promise.resolve(created);
            var ops = [];
            chunks[k].forEach(function (r) {
                var f = { 'Товар': r.sku, 'Категория': base.category, 'Статус карточки': 'Черновик', 'Версия': '1', 'Обновлён': W.TODAY, 'Ответственный': base.owner };
                if (base.supplier) f['Поставщик'] = base.supplier;
                Object.keys(r.fields).forEach(function (key) { if (key !== 'sku' && W.FIELD[key]) f[W.FIELD[key]] = r.fields[key]; });
                var idx = ops.length; ops.push({ op: 'new', id: 'Товар', up: 1, fields: f });
                Object.keys(r.values).forEach(function (a) { ops.push({ op: 'new', id: 'Значение атрибута', up: ':id' + idx, fields: { 'Значение атрибута': r.values[a], 'Атрибут': a } }); });
            });
            return W.batch(ops).then(function () { created += chunks[k].length; return next(k + 1); });
        }
        return next(0);
    };
    /* Индикаторы готовности */
    W.pill = function (res) {
        var lvl = Core.level(res.pct), tip = res.blockers.length ? res.channel + ': ' + res.blockers.map(function (b) { return b.msg; }).join('; ') : res.channel + ': всё заполнено';
        return '<span class="pim-pill pim-pill-' + lvl + '" title="' + W.esc(tip) + '">' + res.pct + '%</span>';
    };
    W.pills = function (p, M) {
        return '<div class="pim-pills">' + M.channels.map(function (c) { return W.pill((p._res || M.check(p))[c.name]); }).join('') + '</div>';
    };
    W.ring = function (pct) { var lvl = Core.level(pct); return '<div class="pim-ring pim-ring-' + lvl + '" style="--deg:' + Math.round(pct * 3.6) + 'deg"><span>' + pct + '%</span></div>'; };
    W.bar = function (pct) { return '<div class="pim-meter pim-meter-' + Core.level(pct) + '"><span style="width:' + Math.max(2, pct) + '%"></span></div>'; };
    W.statusBadge = function (s) { return W.badge(s, s === 'Готово к выгрузке' ? 'ok' : s === 'На проверке' ? 'warn' : 'info'); };
    W.short = function (name) { return { 'Ozon': 'Ozon', 'Wildberries': 'WB', 'Яндекс Маркет': 'ЯМ' }[name] || (/Гипердом/.test(name) ? 'B2B' : name); };
    W.go = function (screen, hash) { location.href = W.url(screen) + (hash ? '#' + hash : ''); };
    W.hash = function () { var o = {}; (location.hash || '').replace(/^#/, '').split('&').forEach(function (x) { var i = x.indexOf('='); if (i > 0) o[x.slice(0, i)] = decodeURIComponent(x.slice(i + 1)); }); return o; };


    /* ---------- DOM ---------- */
    W.el = function (tag, attrs, kids) {
        var e = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            if (k === 'text') e.textContent = attrs[k];
            else if (k === 'html') e.innerHTML = attrs[k];
            else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
            else if (attrs[k] !== false && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
        });
        [].concat(kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
        return e;
    };
    W.btn = function (text, fn, cls) { return W.el('button', { type: 'button', 'class': 'pim-btn ' + (cls || ''), onclick: fn, text: text }); };
    W.toast = function (msg, bad) {
        var t = W.el('div', { 'class': 'pim-toast' + (bad ? ' pim-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 2500);
    };
    /* Модальное окно (не alert/confirm/prompt). body - узел, buttons - [{text, fn, cls}]. */
    W.modal = function (title, body, buttons) {
        var back = W.el('div', { 'class': 'pim-modal-back' });
        function close() { back.remove(); }
        var foot = W.el('div', { 'class': 'pim-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            return W.btn(b.text, function () { if (!b.fn || b.fn(close) !== false) { if (!b.keep) close(); } }, b.cls);
        }));
        var box = W.el('div', { 'class': 'pim-modal', role: 'dialog', 'aria-label': title }, [W.el('h3', { text: title }), body, foot]);
        back.appendChild(box); document.body.appendChild(back);
        var f = box.querySelector('input,select,textarea'); if (f) f.focus();
        return { close: close, box: box };
    };
    W.field = function (label, input) { return W.el('label', { 'class': 'pim-field' }, [W.el('span', { text: label }), input]); };
    W.select = function (opts, value) {
        var s = W.el('select', {}, opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return W.el('option', { value: v, text: t }); }));
        s.value = value === undefined ? '' : value; return s;
    };
    W.download = function (name, text) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}], rows = [{...}] */
    W.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = W.el('thead', {}, [W.el('tr', {}, cols.map(function (c) { return W.el('th', { text: c.t, 'class': c.num ? 'pim-num' : '' }); }))]);
        var tbody = W.el('tbody', {}, rows.map(function (r) {
            var tr = W.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' pim-click' : ''), onclick: opts.onrow ? function () { opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = W.el('td', { 'class': (c.num ? 'pim-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.html) td.innerHTML = c.html(r); else td.textContent = c.num ? W.right(r[c.k]) : (r[c.k] === undefined ? '' : r[c.k]);
                    return td;
                }));
            return tr;
        }));
        if (!rows.length) tbody.appendChild(W.el('tr', {}, [W.el('td', { colspan: cols.length, 'class': 'pim-empty', text: opts.empty || 'Нет данных' })]));
        return W.el('div', { 'class': 'pim-tablewrap' }, [W.el('table', { 'class': 'pim-table' }, [thead, tbody])]);
    };
    W.badge = function (text, kind) { return '<span class="pim-badge pim-' + (kind || 'info') + '">' + W.esc(text) + '</span>'; };
    W.tabs = function (items, active, onpick) {
        return W.el('div', { 'class': 'pim-tabs', role: 'tablist' }, items.map(function (it) {
            return W.el('button', { type: 'button', role: 'tab', 'class': 'pim-tab' + (it[0] === active ? ' pim-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, text: it[1] });
        }));
    };
    W.fail = function (e) { host.innerHTML = ''; host.appendChild(W.el('div', { 'class': 'pim-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    W.mount = function (fn) {
        if (!host) return;
        host.textContent = 'Загрузка...';
        W.meta().then(function () { return fn(host); }).catch(W.fail);
    };
    W.host = host;
})();
