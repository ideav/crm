/* ПЕТФУД · общее ядро рабочих мест: API, схема, форматирование, UI-примитивы */
(function (w) {
    'use strict';

    var DB = w.db || location.pathname.split('/')[1];
    var PF = {
        db: DB,
        uid: String(w.uid || ''),
        user: w.user || '',
        role: w.role || '',
        roleId: String(w.roleId || ''),
        grants: w.grants || {},
        _schema: null,
        _clockSkew: 0
    };

    /* ---------------------------------------------------------------- API */
    function url(path) {
        return '/' + DB + '/' + path;
    }

    PF.get = function (path) {
        return fetch(url(path), {credentials: 'same-origin', headers: {'Accept': 'application/json'}})
            .then(function (r) {
                var d = r.headers.get('Date');
                if (d) PF._clockSkew = new Date(d).getTime() - Date.now();
                if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + path);
                return r.text();
            })
            .then(function (t) {
                try {
                    return JSON.parse(t);
                } catch (e) {
                    console.error('Не JSON от ' + path, t.slice(0, 200));
                    throw new Error('Сервер вернул не JSON: ' + path);
                }
            });
    };

    PF.post = function (path, fields) {
        var fd = new FormData();
        fd.append('token', w.token || '');
        fd.append('_xsrf', w.xsrf || '');
        Object.keys(fields || {}).forEach(function (k) {
            var v = fields[k];
            if (v === undefined || v === null) return;   // «поле не трогаем»
            fd.append(k, v);                              // пустая строка = очистка
        });
        return fetch(url(path) + (path.indexOf('?') < 0 ? '?JSON=1' : '&JSON=1'),
            {method: 'POST', credentials: 'same-origin', body: fd})
            .then(function (r) { return r.text(); })
            .then(function (t) {
                var j;
                try { j = JSON.parse(t); } catch (e) { throw new Error('Ответ сервера: ' + t.slice(0, 160)); }
                if (j && j.error) throw new Error(j.error);
                return j;
            });
    };

    PF.report = function (name, params) {
        var q = [];
        Object.keys(params || {}).forEach(function (k) {
            if (params[k] !== '' && params[k] !== undefined && params[k] !== null)
                q.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
        });
        return PF.get('report/' + encodeURIComponent(name) + '?JSON_KV' + (q.length ? '&' + q.join('&') : ''))
            .then(function (rows) {
                if (!Array.isArray(rows)) {
                    console.error('Отчёт ' + name + ' вернул не массив', rows);
                    return [];
                }
                return rows;
            });
    };

    PF.rows = function (tableId, extra) {
        return PF.get('object/' + tableId + '/?JSON_OBJ&LIMIT=0,1000' + (extra || ''));
    };
    PF.children = function (tableId, up) {
        return PF.rows(tableId, '&F_U=' + up);
    };
    PF.create = function (tableId, fields, up) {
        var f = {up: up === undefined ? 1 : up};
        Object.keys(fields || {}).forEach(function (k) { f[k] = fields[k]; });
        return PF.post('_m_new/' + tableId, f).then(function (r) { return parseInt(r.obj || r.id, 10); });
    };
    PF.update = function (objId, fields) { return PF.post('_m_set/' + objId, fields); };
    PF.remove = function (objId) { return PF.post('_m_del/' + objId, {}); };

    /* ------------------------------------------------------------- схема */
    /* Идентификаторы таблиц и реквизитов берутся из metadata (НФТ-2) */
    PF.schema = function () {
        if (PF._schema) return Promise.resolve(PF._schema);
        return PF.get('metadata?JSON=1').then(function (md) {
            var byName = {}, byId = {};
            md.forEach(function (t) {
                var tab = {id: parseInt(t.id, 10), name: t.val, cols: {}, reqs: []};
                (t.reqs || []).forEach(function (r) {
                    var alias = '';
                    try {
                        var a = typeof r.attrs === 'string' ? JSON.parse(r.attrs) : (r.attrs || {});
                        alias = a && a.alias ? a.alias : '';
                    } catch (e) { /* attrs бывает строкой без JSON */ }
                    var item = {
                        id: parseInt(r.id, 10), name: alias || r.val, type: r.type,
                        ref: r.ref ? parseInt(r.ref, 10) : 0,
                        arr: r.arr_id ? parseInt(r.arr_id, 10) : 0
                    };
                    tab.reqs.push(item);
                    tab.cols[item.name] = item;
                    if (alias && alias !== r.val) tab.cols[r.val] = tab.cols[r.val] || item;
                });
                byName[tab.name] = tab;
                byId[tab.id] = tab;
            });
            PF._schema = {byName: byName, byId: byId};
            return PF._schema;
        });
    };
    PF.tid = function (name) {
        var t = PF._schema && PF._schema.byName[name];
        if (!t) throw new Error('Нет таблицы «' + name + '» в metadata');
        return t.id;
    };
    PF.table = function (name) { return PF._schema.byName[name]; };
    PF.rid = function (table, col) {
        var t = PF._schema.byName[table];
        if (!t || !t.cols[col]) throw new Error('Нет колонки «' + col + '» в «' + table + '»');
        return t.cols[col].id;
    };
    PF.f = function (table, col) { return 't' + PF.rid(table, col); };
    PF.tf = function (table) { return 't' + PF.tid(table); };

    /* id записей, реально видимых роли (маска применяется сервером к таблицам) */
    PF.visibleIds = function (tableName) {
        return PF.rows(PF.tid(tableName)).then(function (rows) {
            var set = {};
            rows.forEach(function (r) { set[r.i] = r; });
            return set;
        });
    };

    PF.canWrite = function (tableName) {
        var g = PF.grants || {};
        if (g['1'] === 'WRITE') return true;
        try { return g[String(PF.tid(tableName))] === 'WRITE'; } catch (e) { return false; }
    };
    PF.canRead = function (tableName) {
        var g = PF.grants || {};
        if (g['1']) return true;
        try { return !!g[String(PF.tid(tableName))]; } catch (e) { return false; }
    };

    /* ------------------------------------------------------- разбор значений */
    PF.refId = function (v) {                       // "123:Название" -> 123
        if (v === undefined || v === null || v === '') return 0;
        var s = String(v), i = s.indexOf(':');
        return i < 0 ? parseInt(s, 10) || 0 : parseInt(s.slice(0, i), 10) || 0;
    };
    PF.refVal = function (v) {
        if (v === undefined || v === null) return '';
        var s = String(v), i = s.indexOf(':');
        return i < 0 ? s : s.slice(i + 1);
    };
    PF.num = function (v) {
        if (v === undefined || v === null || v === '') return null;
        var n = parseFloat(String(v).replace(',', '.'));
        return isNaN(n) ? null : n;
    };
    PF.toDate = function (v) {
        if (!v && v !== 0) return null;
        if (v instanceof Date) return v;                      // не умножать повторно
        if (typeof v === 'string' && /^\d{2}\.\d{2}\.\d{4}/.test(v)) {
            var p = v.split(/[\s.:]+/);
            return new Date(+p[2], +p[1] - 1, +p[0], +(p[3] || 0), +(p[4] || 0));
        }
        // ISO «YYYY-MM-DD» (input type=date, isoDate()): раньше проваливался в parseInt,
        // который брал год «2026» как unix-секунды — отсюда «Смена 01.01.1970» (#4844)
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
            var q = v.split(/[-\s.:]+/);
            return new Date(+q[0], +q[1] - 1, +q[2], +(q[3] || 0), +(q[4] || 0));
        }
        var n = parseInt(v, 10);
        if (!n || isNaN(n)) return null;
        return new Date(n * 1000);                            // unix-секунды
    };
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    PF.fmtTime = function (v) {
        var d = PF.toDate(v);
        return d ? p2(d.getHours()) + ':' + p2(d.getMinutes()) : '';
    };
    PF.fmtDT = function (v) {
        var d = PF.toDate(v);
        return d ? p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' +
            p2(d.getHours()) + ':' + p2(d.getMinutes()) : '';
    };
    PF.fmtDate = function (v) {
        var d = PF.toDate(v);
        return d ? p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear() : '';
    };
    PF.serverNow = function () { return new Date(Date.now() + PF._clockSkew); };
    PF.stampNow = function () {                    // формат записи DATETIME
        var d = PF.serverNow();
        return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' +
            p2(d.getHours()) + ':' + p2(d.getMinutes());
    };
    PF.isoDate = function (d) {
        d = d || PF.serverNow();
        return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    };
    PF.money = function (n) {
        n = PF.num(n);
        if (n === null) return '—';
        return n.toLocaleString('ru-RU');
    };

    /* ------------------------------------------------------------ DOM/UI */
    PF.el = function (tag, attrs, kids) {
        var e = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) {
            if (k === 'text') e.textContent = attrs[k];
            else if (k === 'html') e.innerHTML = attrs[k];
            else if (k === 'onclick') e.addEventListener('click', attrs[k]);
            else if (k === 'onchange') e.addEventListener('change', attrs[k]);
            else if (k === 'oninput') e.addEventListener('input', attrs[k]);
            else if (k === 'onkeydown') e.addEventListener('keydown', attrs[k]);
            else if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
        });
        (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
        return e;
    };
    var el = PF.el;

    PF.clear = function (node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; };

    PF.toast = function (msg, kind) {
        var box = document.getElementById('pf-toasts');
        if (!box) {
            box = el('div', {id: 'pf-toasts', class: 'pf-toasts'});
            document.body.appendChild(box);
        }
        var t = el('div', {class: 'pf-toast pf-toast--' + (kind || 'ok'), text: msg});
        box.appendChild(t);
        setTimeout(function () { t.classList.add('pf-toast--out'); }, 3200);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3800);
    };
    PF.error = function (e) {
        console.error(e);
        PF.toast((e && e.message) ? e.message : String(e), 'err');
    };

    /* Модальное окно: непрозрачная панель поверх затемнения */
    PF.modal = function (title, bodyNode, actions) {
        var overlay = el('div', {class: 'pf-modal-overlay'});
        var panel = el('div', {class: 'pf-modal', role: 'dialog', 'aria-label': title});
        var close = function () { if (overlay.parentNode) document.body.removeChild(overlay); };
        var head = el('div', {class: 'pf-modal__head'}, [
            el('h3', {text: title}),
            el('button', {class: 'pf-icon-btn', type: 'button', title: 'Закрыть', onclick: close, html: '<i class="pi pi-times"></i>'})
        ]);
        var foot = el('div', {class: 'pf-modal__foot'});
        (actions || []).forEach(function (a) {
            foot.appendChild(el('button', {
                type: 'button', class: 'pf-btn ' + (a.primary ? 'pf-btn--primary' : ''),
                text: a.text, onclick: function () { a.onClick(close); }
            }));
        });
        foot.appendChild(el('button', {type: 'button', class: 'pf-btn', text: 'Закрыть', onclick: close}));
        panel.appendChild(head);
        panel.appendChild(el('div', {class: 'pf-modal__body'}, [bodyNode]));
        panel.appendChild(foot);
        overlay.appendChild(panel);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
        document.addEventListener('keydown', function esc(e) {
            if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
        });
        panel.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && e.ctrlKey && actions && actions.length) actions[0].onClick(close);
        });
        document.body.appendChild(overlay);
        var first = panel.querySelector('input,select,textarea');
        if (first) first.focus();
        return close;
    };

    PF.confirm = function (title, text, onYes) {
        PF.modal(title, el('p', {text: text}), [{text: 'Да', primary: true, onClick: function (close) { close(); onYes(); }}]);
    };

    /* Поисковый комбобокс: видимый input + скрытое поле с id */
    PF.combo = function (name, options, value, opts) {
        opts = opts || {};
        var wrap = el('div', {class: 'pf-combo'});
        var hidden = el('input', {type: 'hidden', name: name, id: name});
        var input = el('input', {
            type: 'text', class: 'pf-input', role: 'combobox', autocomplete: 'off',
            placeholder: opts.placeholder || 'Начните вводить…', 'aria-expanded': 'false'
        });
        var list = el('div', {class: 'pf-combo__list', hidden: 'hidden'});
        var cur = null;
        options.forEach(function (o) { if (String(o.id) === String(value)) cur = o; });
        if (cur) { hidden.value = cur.id; input.value = cur.name; }

        function render(filter) {
            PF.clear(list);
            var f = (filter || '').toLowerCase();
            var shown = options.filter(function (o) {
                return !f || String(o.name).toLowerCase().indexOf(f) >= 0;
            }).slice(0, 60);
            if (!shown.length) list.appendChild(el('div', {class: 'pf-combo__empty', text: 'Ничего не найдено'}));
            shown.forEach(function (o) {
                list.appendChild(el('div', {
                    class: 'pf-combo__item', text: o.name, onclick: function () {
                        hidden.value = o.id;
                        input.value = o.name;
                        list.hidden = true;
                        if (opts.onSelect) opts.onSelect(o);
                    }
                }));
            });
            list.hidden = false;
        }
        input.addEventListener('focus', function () { render(''); });
        input.addEventListener('input', function () {
            hidden.value = '';
            render(input.value);
        });
        input.addEventListener('blur', function () {
            setTimeout(function () {
                list.hidden = true;
                if (!hidden.value) {                       // не выбрали — вернуть прежнее
                    var back = null;
                    options.forEach(function (o) { if (o.name === input.value) back = o; });
                    if (back) hidden.value = back.id; else input.value = '';
                }
            }, 180);
        });
        wrap.appendChild(input);
        wrap.appendChild(hidden);
        wrap.appendChild(list);
        return wrap;
    };

    /* Простая форма: описание полей -> DOM + сбор значений */
    PF.form = function (fields, values) {
        values = values || {};
        var root = el('div', {class: 'pf-form', 'data-submit-scope': '1'});
        var controls = {};
        fields.forEach(function (f) {
            var id = 'f_' + f.key;
            var ctrl;
            var v = values[f.key];
            if (f.type === 'ref') {
                ctrl = PF.combo(id, f.options || [], v, {placeholder: f.placeholder});
                controls[f.key] = function () { return ctrl.querySelector('input[type=hidden]').value; };
            } else if (f.type === 'select') {
                var sel = el('select', {class: 'pf-input', id: id});
                (f.options || []).forEach(function (o) {
                    var op = el('option', {value: o.id, text: o.name});
                    if (String(o.id) === String(v)) op.setAttribute('selected', 'selected');
                    sel.appendChild(op);
                });
                ctrl = sel;
                controls[f.key] = function () { return sel.value; };
            } else if (f.type === 'memo') {
                var ta = el('textarea', {class: 'pf-input', id: id, rows: f.rows || 3});
                ta.value = v === undefined || v === null ? '' : v;
                ctrl = ta;
                controls[f.key] = function () { return ta.value; };
            } else if (f.type === 'bool') {
                var cb = el('input', {type: 'checkbox', id: id, class: 'pf-check'});
                cb.checked = (v === 'X' || v === 1 || v === '1' || v === true);
                ctrl = cb;
                controls[f.key] = function () { return cb.checked ? 1 : 0; };
            } else {
                var inp = el('input', {
                    type: f.type === 'number' ? 'number' : (f.type === 'date' ? 'date' : 'text'),
                    class: 'pf-input', id: id, step: f.step || (f.type === 'number' ? 'any' : null),
                    inputmode: f.type === 'number' ? 'decimal' : null,
                    placeholder: f.placeholder || ''
                });
                inp.value = v === undefined || v === null ? '' : v;
                ctrl = inp;
                controls[f.key] = function () { return inp.value; };
            }
            root.appendChild(el('label', {class: 'pf-field', for: id}, [
                el('span', {class: 'pf-field__label', text: f.label}),
                ctrl
            ]));
        });
        return {
            node: root,
            values: function () {
                var out = {};
                Object.keys(controls).forEach(function (k) { out[k] = controls[k](); });
                return out;
            }
        };
    };

    /* Таблица: строки собираются узлами (никакого innerHTML для <tr>) */
    PF.tableView = function (columns, rows, opts) {
        opts = opts || {};
        var table = el('table', {class: 'pf-table'});
        var thead = el('thead');
        var tr = el('tr');
        columns.forEach(function (c) { tr.appendChild(el('th', {text: c.title, class: c.cls || ''})); });
        thead.appendChild(tr);
        table.appendChild(thead);
        var tbody = el('tbody');
        if (!rows.length) {
            var trE = el('tr');
            trE.appendChild(el('td', {colspan: columns.length, class: 'pf-empty', text: opts.empty || 'Нет данных'}));
            tbody.appendChild(trE);
        }
        rows.forEach(function (r, i) {
            var row = el('tr', opts.onRow ? {class: 'pf-row--click', tabindex: '0'} : {});
            columns.forEach(function (c) {
                var td = el('td', {class: c.cls || ''});
                var v = c.render ? c.render(r, i) : r[c.key];
                if (v instanceof Node) td.appendChild(v);
                else td.textContent = (v === undefined || v === null || v === '') ? '—' : String(v);
                row.appendChild(td);
            });
            if (opts.onRow) {
                row.addEventListener('click', function () { opts.onRow(r); });
                row.addEventListener('keydown', function (e) { if (e.key === 'Enter') opts.onRow(r); });
            }
            tbody.appendChild(row);
        });
        table.appendChild(tbody);
        var wrap = el('div', {class: 'pf-table-wrap'}, [table]);
        return wrap;
    };

    PF.badge = function (text, kind) {
        return el('span', {class: 'pf-badge pf-badge--' + (kind || 'gray'), text: text});
    };
    PF.statusKind = function (code) {
        return code === 'done' ? 'green' : (code === 'in_work' ? 'amber' : 'gray');
    };

    PF.qs = function (name) {
        var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search);
        return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
    };
    PF.go = function (page, params) {
        var q = [];
        Object.keys(params || {}).forEach(function (k) {
            if (params[k] !== '' && params[k] !== undefined && params[k] !== null)
                q.push(k + '=' + encodeURIComponent(params[k]));
        });
        location.href = '/' + DB + '/' + page + (q.length ? '?' + q.join('&') : '');
    };

    PF.loading = function (node, text) {
        PF.clear(node).appendChild(el('div', {class: 'pf-loading', text: text || 'Загрузка…'}));
    };

    /* Очередь отправки на случай обрыва связи (НФТ-4) */
    PF.queue = {
        key: 'pf_queue_' + DB,
        all: function () {
            try { return JSON.parse(localStorage.getItem(this.key) || '[]'); } catch (e) { return []; }
        },
        put: function (item) {
            var q = this.all();
            q.push(item);
            localStorage.setItem(this.key, JSON.stringify(q));
        },
        drop: function (uidKey) {
            var q = this.all().filter(function (x) { return x.uid !== uidKey; });
            localStorage.setItem(this.key, JSON.stringify(q));
        },
        flush: function (sender) {
            var q = this.all(), self = this;
            if (!q.length) return Promise.resolve(0);
            var n = 0;
            return q.reduce(function (p, item) {
                return p.then(function () {
                    return sender(item).then(function () { self.drop(item.uid); n++; })
                        .catch(function () { /* оставить в очереди */ });
                });
            }, Promise.resolve()).then(function () { return n; });
        }
    };

    w.PF = PF;
})(window);
