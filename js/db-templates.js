// Шаблоны баз (#5364): выбор шаблона при создании базы в ЛК, модерация, фиксация версии в меню файлов.
// Сервер: GET /{db}/_tpl_list?JSON, POST /{db}/_tpl_publish?JSON (id, title, descr),
// POST /my/_tpl_status?JSON (id, ver, status, note). Логика списков — чистые функции (тест в node),
// разметка — initCabinet (templates/my/main.html) и initDirAdmin (templates/dir_admin.html).
(function (root) {
    'use strict';

    var ID_RE = /^[a-z][a-z0-9]{1,14}$/;
    var STATUS_TEXT = { pending: 'на модерации', approved: 'одобрена', rejected: 'отклонена', withdrawn: 'снята' };

    function idValid(id) {
        return typeof id === 'string' && ID_RE.test(id) && id !== 'my';
    }

    // Одобренные шаблоны, которых ещё нет в списке выбора (значения сравниваются без регистра)
    function optionsToAdd(list, existingValues) {
        var have = {};
        (existingValues || []).forEach(function (v) { have[String(v).toLowerCase()] = 1; });
        return (list || []).filter(function (t) { return t.ver > 0 && !have[String(t.id).toLowerCase()]; })
            .map(function (t) { return { value: t.id, label: (t.title || t.id) + ' (v' + t.ver + ')' }; });
    }

    // Действия над версией: модератор — одобрить/отклонить на модерации, снять действующую;
    // владелец базы-источника — только снять
    function versionActions(status, moderator) {
        if (status === 'pending') return moderator ? ['approved', 'rejected', 'withdrawn'] : ['withdrawn'];
        if (status === 'approved') return ['withdrawn'];
        return [];
    }

    // Плоский список версий (новые сверху) для таблицы модерации или своего шаблона
    function versionRows(list, moderator) {
        var rows = [];
        (list || []).forEach(function (t) {
            (t.versions || []).forEach(function (v) {
                rows.push({ id: t.id, title: t.title || t.id, source: t.source || '', author: t.author || '',
                    ver: v.ver, status: v.status, statusText: STATUS_TEXT[v.status] || v.status,
                    created: v.created || '', note: v.note || '', current: t.ver === v.ver,
                    actions: versionActions(v.status, moderator) });
            });
        });
        rows.sort(function (a, b) {
            if (a.status === 'pending' && b.status !== 'pending') return -1;
            if (b.status === 'pending' && a.status !== 'pending') return 1;
            return a.id < b.id ? -1 : a.id > b.id ? 1 : b.ver - a.ver;
        });
        return rows;
    }

    // Текст итога по ответу сервера (JSON или сырой текст ошибки)
    function resultMessage(text) {
        var res;
        try { res = JSON.parse(text); } catch (e) { return { ok: false, text: String(text || 'Пустой ответ сервера').slice(0, 500) }; }
        if (res && res.result === 'ok') {
            var verb = { pending: 'отправлена на модерацию', approved: 'одобрена', rejected: 'отклонена', withdrawn: 'снята' };
            return { ok: true, text: 'Версия ' + res.ver + ' шаблона ' + res.id + ' ' + (verb[res.status] || res.status) + '.' };
        }
        return { ok: false, text: (res && res.error) || 'Сервер не принял запрос' };
    }

    function el(tag, attrs, text) {
        var e = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function post(url, fields) {
        var fd = new FormData();
        Object.keys(fields).forEach(function (k) { fd.append(k, fields[k]); });
        return fetch(url, { method: 'POST', credentials: 'include', body: fd })
            .then(function (r) { return r.text(); })
            .catch(function (e) { return 'Сеть: ' + (e && e.message ? e.message : e); })
            .then(resultMessage);
    }

    function getList(url) {
        return fetch(url, { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .catch(function () { return { templates: [], moderator: 0 }; });
    }

    // Таблица версий с кнопками действий; onAction(row, status) — по нажатию
    var ACTION_TEXT = { approved: 'Одобрить', rejected: 'Отклонить', withdrawn: 'Снять' };
    function renderVersions(box, rows, onAction, showSource) {
        box.textContent = '';
        if (!rows.length) { box.appendChild(el('p', {}, 'Версий нет.')); return; }
        var table = el('table', { class: 'table table-sm db-templates-table' });
        var head = el('tr');
        ['Шаблон', 'Версия', 'Статус', 'Зафиксирована'].concat(showSource ? ['База', 'Автор'] : []).concat(['Комментарий', ''])
            .forEach(function (h) { head.appendChild(el('th', {}, h)); });
        table.appendChild(head);
        rows.forEach(function (r) {
            var tr = el('tr');
            [r.title + ' (' + r.id + ')', 'v' + r.ver + (r.current ? ' — в ЛК' : ''), r.statusText, r.created]
                .concat(showSource ? [r.source, r.author] : []).concat([r.note])
                .forEach(function (c) { tr.appendChild(el('td', {}, c)); });
            var td = el('td');
            r.actions.forEach(function (a) {
                var b = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary' }, ACTION_TEXT[a]);
                b.addEventListener('click', function () { onAction(r, a, b); });
                td.appendChild(b);
            });
            tr.appendChild(td);
            table.appendChild(tr);
        });
        box.appendChild(table);
    }

    // ЛК: одобренные шаблоны — в список выбора при создании базы; модератору — панель модерации.
    // opts: { base: 'https://host/my', xsrf, select: <select>, panel: <div> }
    function initCabinet(opts) {
        return getList(opts.base + '/_tpl_list?JSON').then(function (res) {
            var list = (res && res.templates) || [];
            if (opts.select) {
                var have = Array.prototype.map.call(opts.select.options, function (o) { return o.value; });
                optionsToAdd(list, have).forEach(function (o) { opts.select.appendChild(el('option', { value: o.value }, o.label)); });
            }
            if (!opts.panel || !(res && res.moderator)) return;
            opts.panel.style.display = '';
            opts.panel.textContent = '';
            opts.panel.appendChild(el('h3', {}, 'Шаблоны баз: модерация'));
            var note = el('input', { type: 'text', class: 'database-field-input', placeholder: 'Комментарий к решению (необязательно)' });
            var status = el('p', { class: 'db-templates-status' });
            var box = el('div');
            opts.panel.appendChild(note);
            opts.panel.appendChild(status);
            opts.panel.appendChild(box);
            var draw = function (l) {
                renderVersions(box, versionRows(l, true), function (row, act, btn) {
                    btn.disabled = true;
                    post(opts.base + '/_tpl_status?JSON', { _xsrf: opts.xsrf, id: row.id, ver: row.ver, status: act, note: note.value })
                        .then(function (r) {
                            status.textContent = r.text;
                            status.style.color = r.ok ? '#3c763d' : '#a94442';
                            return getList(opts.base + '/_tpl_list?JSON');
                        })
                        .then(function (fresh) { draw((fresh && fresh.templates) || []); });
                }, true);
            };
            draw(list);
        });
    }

    // Меню файлов базы: зафиксировать версию шаблона из этой базы и посмотреть/снять свои версии.
    // opts: { db, xsrf, box: <div> }
    function initDirAdmin(opts) {
        var base = '/' + opts.db;
        var box = opts.box;
        box.textContent = '';
        box.appendChild(el('p', {}, 'Шаблон — снимок данных и файлов этой базы. Пользователи, пароли и токены в снимок не попадают. '
            + 'После одобрения модератором шаблон появится в Личном кабинете при создании базы; новые правки этой базы '
            + 'войдут в шаблон только следующей зафиксированной версией.'));
        var id = el('input', { type: 'text', class: 'form-control form-control-sm mb-1', placeholder: 'Имя шаблона: 2–15 латинских букв и цифр' });
        var title = el('input', { type: 'text', class: 'form-control form-control-sm mb-1', placeholder: 'Название для Личного кабинета' });
        var descr = el('textarea', { class: 'form-control form-control-sm mb-1', placeholder: 'Что внутри шаблона' });
        var btn = el('button', { type: 'button', class: 'btn btn-sm btn-primary' }, 'Зафиксировать версию');
        var status = el('p', { class: 'db-templates-status mt-1' });
        var versions = el('div');
        [id, title, descr, btn, status, versions].forEach(function (e) { box.appendChild(e); });
        var refresh = function () {
            return getList(base + '/_tpl_list?JSON').then(function (res) {
                var own = ((res && res.templates) || []).filter(function (t) { return t.source === opts.db; });
                if (own.length && !id.value) { id.value = own[0].id; id.readOnly = true; title.value = own[0].title || ''; descr.value = own[0].descr || ''; }
                renderVersions(versions, versionRows(own, false), function (row, act, b) {
                    b.disabled = true;
                    post(base + '/_tpl_status?JSON', { _xsrf: opts.xsrf, id: row.id, ver: row.ver, status: act })
                        .then(function (r) { show(r); refresh(); });
                }, false);
            });
        };
        var show = function (r) { status.textContent = r.text; status.style.color = r.ok ? '#3c763d' : '#a94442'; };
        btn.addEventListener('click', function () {
            var v = id.value.trim().toLowerCase();
            if (!idValid(v)) { show({ ok: false, text: 'Имя шаблона — от 2 до 15 латинских букв и цифр, начиная с буквы' }); return; }
            btn.disabled = true;
            show({ ok: true, text: 'Снимаю данные и файлы базы…' });
            post(base + '/_tpl_publish?JSON', { _xsrf: opts.xsrf, id: v, title: title.value, descr: descr.value })
                .then(function (r) { btn.disabled = false; show(r); refresh(); });
        });
        return refresh();
    }

    var api = { idValid: idValid, optionsToAdd: optionsToAdd, versionActions: versionActions, versionRows: versionRows,
        resultMessage: resultMessage, initCabinet: initCabinet, initDirAdmin: initDirAdmin };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.DbTemplates = api;
})(typeof window !== 'undefined' ? window : this);
