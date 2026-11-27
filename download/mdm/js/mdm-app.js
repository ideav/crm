/* MDM: общий слой рабочих мест (данные, запись, окна, модель). Расчёты - в mdm-core.js. */
(function () {
    'use strict';
    var C = window.MdmCore;
    var P = window.Mdm = { core: C };
    var host = document.getElementById('mdm-app');
    var ds = host ? host.dataset : {};
    P.ctx = { db: ds.db || location.pathname.split('/')[1], xsrf: ds.xsrf || '', user: ds.user || '', role: ds.role || '', screen: ds.screen || '' };
    P.TODAY = '2026-11-26'; /* дата демо */
    P.NOM = 'Номенклатура'; P.KON = 'Контрагент';

    P.dec = function (s) { return typeof s === 'string' ? s.replace(/&comma;/g, ',') : s; };
    P.esc = function (s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    P.url = function (p) { return '/' + P.ctx.db + '/' + p; };
    P.get = function (p, init) {
        return fetch(P.url(p), Object.assign({ credentials: 'same-origin' }, init || {})).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + p);
            return r.json();
        });
    };
    /* POST с XSRF; вложенные объекты уходят JSON-строкой. */
    P.post = function (p, fields) {
        var fd = new FormData();
        fd.append('_xsrf', P.ctx.xsrf);
        Object.keys(fields || {}).forEach(function (k) { var v = fields[k]; fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v); });
        return fetch(P.url(p), { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { return r.json().catch(function () { return {}; }); })
            .then(function (j) { var e = Array.isArray(j) ? j[0] : j; if (e && e.error) throw new Error(e.error); return j; });
    };
    var metaP = null;
    P.meta = function () { return metaP || (metaP = P.get('metadata?JSON=1').then(function (m) { var by = {}; m.forEach(function (t) { by[t.val] = t; }); P.metaBy = by; return by; })); };
    P.tid = function (name) { return P.metaBy[name] && P.metaBy[name].id; };
    P.canWrite = function (name) { return !!(P.metaBy[name] && P.metaBy[name].granted === 'WRITE'); };
    P.canRead = function (name) { return !!P.metaBy[name]; };

    function norm(o) {
        var r = { _id: String(o.id), _ref: {} };
        Object.keys(o).forEach(function (k) {
            if (k === 'id' || k === 'up' || k === 'ord') return;
            var v = o[k];
            if (v && typeof v === 'object') { if (v.id !== undefined) { r[k] = P.dec(v.val); r._ref[k] = String(v.id); } return; }
            r[k] = v === null ? '' : P.dec(v);
        });
        return r;
    }
    P.rows = function (name) {
        if (!P.canRead(name)) return Promise.resolve(null);
        var id = P.tid(name), out = [], PAGE = 500;
        function page(off) {
            return P.get('object/' + id + '/?JSON_OBJ&NAMED&LIMIT=' + off + ',' + PAGE, { cache: 'no-store' }).then(function (j) {
                if (!Array.isArray(j)) throw new Error('Нет доступа к таблице «' + name + '»');
                j.forEach(function (o) { out.push(norm(o)); });
                return j.length < PAGE ? out : page(off + PAGE);
            });
        }
        return page(0).catch(function () { return null; });
    };
    P.map = function (rows, key) { var m = {}; (rows || []).forEach(function (r) { m[r[key]] = r; }); return m; };
    P.num = C.num;
    P.money = function (x) { var n = Math.round(C.num(x)); return (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; };
    P.pct = function (x) { return String(Math.round(C.num(x) * 10) / 10).replace('.', ',') + '%'; };

    /* ---------- модель: все таблицы одним слоем ---------- */
    var modelP = null;
    function rec(x, kind) {
        var r = { id: x._id, kind: kind, name: x[kind], code: x['Код НСИ'], source: x['Источник'] || '', srcCode: x['Код в источнике'] || '', status: x['Статус записи'] || '', mergedInto: x['Слита в'] || '',
            date: C.toIso(x['Дата заведения']), who: x['Кем заведена'] || '', docs: C.num(x['Число документов']) };
        if (kind === P.NOM) { r['Артикул'] = x['Артикул'] || ''; r['Бренд'] = x['Бренд'] || ''; r['Единица измерения'] = x['Единица измерения'] || ''; r.group = x['Группа номенклатуры'] || ''; r.barcode = x['Штрихкод'] || ''; }
        else { r['ИНН'] = x['ИНН'] || ''; r['КПП'] = x['КПП'] || ''; r.ogrn = x['ОГРН'] || ''; r.addr = x['Адрес контрагента'] || ''; r.advance = x['Открытый аванс'] === undefined ? null : C.num(x['Открытый аванс']); r.debt = x['Задолженность'] === undefined ? null : C.num(x['Задолженность']); }
        return r;
    }
    P.FIELDS = { 'Номенклатура': ['Наименование', 'Артикул', 'Бренд', 'Единица измерения'], 'Контрагент': ['Наименование', 'ИНН', 'КПП'] };
    P.model = function () {
        if (modelP) return modelP;
        var names = ['Система учёта', 'Группа номенклатуры', 'Единица измерения', 'Номенклатура', 'Контрагент', 'Правило похожести', 'Параметр НСИ', 'Слияние', 'Соответствие кодов', 'Заявка НСИ', 'Замер качества'];
        modelP = Promise.all(names.map(P.rows)).then(function (r) {
            var M = { today: P.TODAY };
            M.systems = (r[0] || []).map(function (x) { return { id: x._id, name: x['Система учёта'], kind: x['Вид системы'], prio: C.num(x['Приоритет источника']) || 99, owner: x['Владелец системы'] }; }).sort(function (a, b) { return a.prio - b.prio; });
            M.prio = {}; M.systems.forEach(function (s) { M.prio[s.name] = s.prio; });
            M.groups = (r[1] || []).map(function (x) { return { name: x['Группа номенклатуры'], okpd: x['Код ОКПД2'], mask: x['Маска наименования'], attrs: x['Обязательные атрибуты'] }; });
            M.units = (r[2] || []).map(function (x) { return x['Единица измерения']; });
            M.nom = (r[3] || []).map(function (x) { return rec(x, P.NOM); });
            M.kon = (r[4] || []).map(function (x) { return rec(x, P.KON); });
            M.canMoney = M.kon.length > 0 && M.kon[0].advance !== null;
            M.ruleRows = (r[5] || []).map(function (x) { return { id: x._id, name: x['Правило похожести'], kind: x['Вид справочника'], field: x['Поле сравнения'], how: x['Способ сравнения'], w: C.num(x['Вес поля']), on: x['Правило включено'] !== '' && x['Правило включено'] !== '0' && x['Правило включено'] !== '-1' }; });
            M.rules = C.parseRules(M.ruleRows);
            M.paramRows = (r[6] || []).map(function (x) { return { id: x._id, name: x['Параметр НСИ'], value: C.num(x['Значение параметра']), note: x['Пояснение параметра'] }; });
            var pm = {}; M.paramRows.forEach(function (p) { pm[p.name] = p.value; }); M.params = C.parseParams(pm);
            M.merges = (r[7] || []).map(function (x) { return { id: x._id, no: x['Слияние'], kind: x['Вид справочника'], golden: x['Золотая запись'], absorbed: x['Поглощённые записи'], score: C.num(x['Доля совпадения']), reason: x['Причина совпадения'], fields: x['Поля из источников'], snap: x['Снимок до слияния'], by: x['Предложил'], conf: x['Подтвердил'], status: x['Статус слияния'], dp: C.toIso(x['Дата предложения']), dd: C.toIso(x['Дата решения']) }; });
            M.mergesReadable = !!r[7];
            M.maps = (r[8] || []).map(function (x) { return { id: x._id, no: x['Соответствие кодов'], nomId: x._ref['Номенклатура'] || '', nom: x['Номенклатура'] || '', system: x['Система учёта'], ext: x['Внешний код'], extName: x['Внешнее наименование'], score: C.num(x['Доля совпадения']), method: x['Способ сопоставления'], status: x['Статус соответствия'], who: x['Подтвердил'] }; });
            M.mapsReadable = !!r[8];
            M.reqs = (r[9] || []).map(function (x) { return { id: x._id, no: x['Заявка НСИ'], kind: x['Вид заявки'], dict: x['Вид справочника'], name: x['Наименование в заявке'], art: x['Артикул'], brand: x['Бренд'], inn: x['ИНН'], group: x['Группа номенклатуры'], author: x['Инициатор'], date: C.toIso(x['Дата заявки']), due: C.toIso(x['Срок заявки']), status: x['Статус заявки'], exec: x['Исполнитель заявки'], similar: x['Похожие записи'], result: x['Результат заявки'], done: C.toIso(x['Дата выполнения']), note: x['Комментарий НСИ'] }; });
            M.quality = (r[10] || []).map(function (x) { return { id: x._id, name: x['Замер качества'], date: C.toIso(x['Дата замера']), total: C.num(x['Записей в справочнике']), dup: C.num(x['Доля дублей']), days: C.num(x['Время заведения позиции']), auto: C.num(x['Доля автосопоставления']), late: C.num(x['Просрочено заявок']) }; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
            M.byCode = {}; M.nom.concat(M.kon).forEach(function (x) { M.byCode[x.code] = x; });
            M.rights = C.mergeRights(P.ctx.role);
            P.cur = M;
            return M;
        });
        return modelP;
    };
    P.resetModel = function () { modelP = null; };
    P.list = function (M, kind) { return kind === P.KON ? M.kon : M.nom; };
    P.groups = function (M, kind, threshold) { return C.findDuplicates(P.list(M, kind), M.rules[kind], kind, threshold || M.params.dupThreshold); };
    /* Следующий номер: НСИ-000200, СЛ-0007, ЗН-0153. */
    P.nextNo = function (list, prefix, width) {
        var mx = 0; list.forEach(function (s) { if (s && s.indexOf(prefix) === 0) { var n = parseInt(s.slice(prefix.length), 10); if (n > mx) mx = n; } });
        return prefix + String(mx + 1).padStart(width, '0');
    };
    P.pendingFor = function (M, codes) { return M.merges.filter(function (m) { return m.status === 'Предложено' && codes.indexOf(m.golden) >= 0; })[0] || null; };

    /* ---------- запись ---------- */
    P.create = function (table, fields) { return P.post('_m_new/' + P.tid(table) + '?JSON', { up: 1, fields: fields }).then(function (r) { P.resetModel(); return r; }); };
    P.update = function (id, fields) { return P.post('_m_set/' + id + '?JSON', { fields: fields }).then(function (r) { P.resetModel(); return r; }); };
    P.batch = function (ops) {
        if (!ops.length) return Promise.resolve({});
        return P.post('_m_batch?JSON', { ops: ops }).then(function (j) {
            var bad = (j.results || []).filter(function (x) { return !x.ok; });
            if (bad.length) throw new Error(bad[0].error || 'Не все записи сохранены');
            P.resetModel(); return j;
        });
    };
    function setOps(updates) {
        return updates.map(function (u) {
            var f = Object.assign({}, u.fields), main = f['Наименование']; delete f['Наименование'];
            if (main !== undefined) f[u.kind || P.NOM] = main;
            return { op: main !== undefined ? 'save' : 'set', id: u.id, fields: f };
        });
    }
    /* Слияние группы: журнал + (если подтверждает руководитель) статусы записей и поля золотой записи. */
    P.applyMerge = function (M, group, goldenId, chosen, confirm) {
        var plan = C.planMerge(group, goldenId, chosen, { user: P.ctx.user, today: P.TODAY, confirm: confirm, fields: P.FIELDS[group.kind] });
        plan.journal['Слияние'] = P.nextNo(M.merges.map(function (m) { return m.no; }), 'СЛ-', 4);
        return P.create('Слияние', plan.journal).then(function () {
            if (!confirm) return plan;
            plan.updates.forEach(function (u) { u.kind = group.kind; });
            return P.batch(setOps(plan.updates)).then(function () { return plan; });
        });
    };
    /* Подтверждение предложенного слияния из журнала: записи берутся по кодам НСИ. */
    P.confirmMerge = function (M, m) {
        var g = M.byCode[m.golden], others = String(m.absorbed || '').split(/,\s*/).filter(Boolean).map(function (c) { return M.byCode[c]; }).filter(Boolean);
        if (!g) return Promise.reject(new Error('Золотая запись ' + m.golden + ' не найдена'));
        var chosen = {}; try { chosen = JSON.parse(m.fields || '{}'); } catch (e) { chosen = {}; }
        var gf = { 'Статус записи': 'Эталон' }; Object.keys(chosen).forEach(function (f) { if (chosen[f] && chosen[f].value !== undefined && chosen[f].value !== (f === 'Наименование' ? g.name : g[f])) gf[f] = chosen[f].value; });
        var ups = [{ id: g.id, kind: m.kind, fields: gf }].concat(others.map(function (o) { return { id: o.id, kind: m.kind, fields: { 'Статус записи': 'Дубль (слит)', 'Слита в': g.code } }; }));
        return P.batch(setOps(ups)).then(function () { return P.update(m.id, { 'Статус слияния': 'Подтверждено', 'Подтвердил': P.ctx.user, 'Дата решения': P.TODAY }); });
    };
    P.rollbackMerge = function (M, m) {
        var ups = C.planRollback(m.snap, P.FIELDS[m.kind]).map(function (u) { u.kind = m.kind; return u; });
        return P.batch(setOps(ups)).then(function () { return P.update(m.id, { 'Статус слияния': 'Откачено', 'Подтвердил': P.ctx.user, 'Дата решения': P.TODAY }); });
    };

    /* ---------- DOM ---------- */
    P.el = function (tag, attrs, kids) {
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
    P.btn = function (text, fn, cls) { return P.el('button', { type: 'button', 'class': 'mdm-btn ' + (cls || ''), onclick: fn, text: text }); };
    P.toast = function (msg, bad) {
        var t = P.el('div', { 'class': 'mdm-toast' + (bad ? ' mdm-toast-bad' : ''), text: msg, role: 'status' });
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, bad ? 6000 : 2800);
    };
    /* Модальное окно (не alert/confirm/prompt). */
    P.modal = function (title, body, buttons, wide) {
        var back = P.el('div', { 'class': 'mdm-modal-back' });
        function close() { back.remove(); }
        var foot = P.el('div', { 'class': 'mdm-modal-foot' }, (buttons || [{ text: 'Закрыть' }]).map(function (b) {
            return b ? P.btn(b.text, function () { if (!b.fn || b.fn(close) !== false) { if (!b.keep) close(); } }, b.cls) : null;
        }));
        var box = P.el('div', { 'class': 'mdm-modal' + (wide ? ' mdm-modal-wide' : ''), role: 'dialog', 'aria-label': title }, [P.el('h3', { text: title }), body, foot]);
        back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
        back.appendChild(box); document.body.appendChild(back);
        return { close: close, box: box };
    };
    P.field = function (label, input, hint) { return P.el('label', { 'class': 'mdm-field' }, [P.el('span', { text: label }), input, hint ? P.el('small', { text: hint }) : null]); };
    P.select = function (opts, value) {
        var s = P.el('select', {}, opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return P.el('option', { value: v, text: t }); }));
        s.value = value === undefined ? '' : value; return s;
    };
    P.input = function (type, value, attrs) { var i = P.el('input', Object.assign({ type: type }, attrs || {})); i.value = value === undefined ? '' : value; return i; };
    P.download = function (name, text) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
    };
    P.badge = function (text, kind) { return '<span class="mdm-badge mdm-' + (kind || 'info') + '">' + P.esc(text) + '</span>'; };
    P.scoreBadge = function (s, thr) { return P.badge(Math.round(s) + '%', s >= 95 ? 'crit' : s >= (thr || 85) ? 'warn' : 'info'); };
    P.statusBadge = function (s) {
        var k = { 'Эталон': 'ok', 'На проверке': 'warn', 'Дубль (слит)': 'mute', 'Заблокирована': 'mute', 'Подтверждено': 'ok', 'Предложено': 'warn', 'Отклонено': 'mute', 'Откачено': 'crit', 'Не найдено': 'crit', 'Новая': 'info', 'На проверке НСИ': 'warn', 'Выполнена': 'ok', 'Отклонена': 'mute' }[s];
        return P.badge(s || '-', k || 'info');
    };
    P.tabs = function (items, active, onpick) {
        return P.el('div', { 'class': 'mdm-tabs', role: 'tablist' }, items.map(function (it) {
            return P.el('button', { type: 'button', role: 'tab', 'class': 'mdm-tab' + (it[0] === active ? ' mdm-tab-on' : ''), 'aria-selected': it[0] === active ? 'true' : 'false', onclick: function () { onpick(it[0]); }, text: it[1] });
        }));
    };
    /* Таблица: cols = [{k, t, num, cls(r), html(r)}] */
    P.table = function (cols, rows, opts) {
        opts = opts || {};
        var thead = P.el('thead', {}, [P.el('tr', {}, cols.map(function (c) { return P.el('th', { text: c.t, 'class': c.num ? 'mdm-num' : '' }); }))]);
        var tbody = P.el('tbody', {}, rows.map(function (r) {
            return P.el('tr', { 'class': (opts.rowCls ? opts.rowCls(r) : '') + (opts.onrow ? ' mdm-click' : ''), onclick: opts.onrow ? function () { opts.onrow(r); } : undefined },
                cols.map(function (c) {
                    var td = P.el('td', { 'class': (c.num ? 'mdm-num ' : '') + (c.cls ? c.cls(r) : '') });
                    if (c.html) td.innerHTML = c.html(r); else td.textContent = r[c.k] === undefined ? '' : r[c.k];
                    return td;
                }));
        }));
        if (!rows.length) tbody.appendChild(P.el('tr', {}, [P.el('td', { colspan: cols.length, 'class': 'mdm-empty', text: opts.empty || 'Нет данных' })]));
        return P.el('div', { 'class': 'mdm-tablewrap' }, [P.el('table', { 'class': 'mdm-table' }, [thead, tbody])]);
    };
    P.kpi = function (label, value, sub, kind) {
        return P.el('div', { 'class': 'mdm-kpi' + (kind ? ' mdm-kpi-' + kind : '') }, [P.el('div', { 'class': 'mdm-kpi-v', html: value }), P.el('div', { 'class': 'mdm-kpi-l', text: label }), sub ? P.el('div', { 'class': 'mdm-kpi-s', text: sub }) : null]);
    };
    P.fail = function (e) { host.innerHTML = ''; host.appendChild(P.el('div', { 'class': 'mdm-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    P.mount = function (fn) {
        if (!host) return;
        host.textContent = 'Загрузка...';
        P.meta().then(function () { return P.model(); }).then(function (M) { return fn(host, M); }).catch(P.fail);
    };
    P.rerender = function (fn) { P.resetModel(); P.model().then(function (M) { fn(host, M); }).catch(P.fail); };
    P.nav = function (screen, hash) { return P.url(screen) + (hash ? '#' + hash : ''); };
    P.hash = function () { var o = {}; location.hash.replace(/^#/, '').split('&').forEach(function (p) { var a = p.split('='); if (a[0]) o[a[0]] = decodeURIComponent(a[1] || ''); }); return o; };
    P.head = function (title, sub) { return [P.el('h1', { text: title }), P.el('p', { 'class': 'mdm-sub', text: sub })]; };
    P.recLine = function (r) {
        var extra = r.kind === P.KON ? 'ИНН ' + (r['ИНН'] || '-') + (r['КПП'] ? ', КПП ' + r['КПП'] : '') : [r['Артикул'] ? 'арт. ' + r['Артикул'] : '', r['Бренд'], r['Единица измерения']].filter(Boolean).join(' · ');
        return '<b>' + P.esc(r.name) + '</b><div class="mdm-muted">' + P.esc(r.code) + ' · ' + P.esc(r.source || 'без источника') + (r.srcCode ? ' (' + P.esc(r.srcCode) + ')' : '') + (extra ? ' · ' + P.esc(extra) : '') + '</div>';
    };
})();
