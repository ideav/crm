// SQL-доступ во вкладке dir_admin (#5373): вьюхи пользователя по правам его роли и учётка MySQL.
// Сервер — POST /<база>/_ext_rebuild?JSON (action=list | rebuild | revoke, user=<id>, password, _xsrf).
(function () {
    'use strict';
    var S = { inited: false };

    function el(tag, attrs, text) {
        var e = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
        if (text !== undefined) e.textContent = text;
        return e;
    }
    function post(fields) {
        var fd = new FormData();
        fd.append('_xsrf', S.xsrf);
        Object.keys(fields).forEach(function (k) { fd.append(k, fields[k]); });
        return fetch('/' + S.db + '/_ext_rebuild?JSON', { method: 'POST', credentials: 'include', body: fd })
            .then(function (r) { return r.text(); })
            .then(function (t) {
                var j;
                try { j = JSON.parse(t); } catch (e) { throw new Error(t.slice(0, 300) || 'пустой ответ'); }
                if (Array.isArray(j) && j[0] && j[0].error) throw new Error(j[0].error);
                return j;
            });
    }
    function status(text, isError) {
        S.status.textContent = text;
        S.status.className = 'alert ' + (isError ? 'alert-danger' : 'alert-info');
        S.status.hidden = !text;
    }
    function line(dl, name, value) {
        if (value === undefined || value === null || value === '') return;
        dl.appendChild(el('dt', {}, name));
        var dd = el('dd');
        dd.appendChild(el('code', {}, String(value)));
        dl.appendChild(dd);
    }
    function showResult(r) {
        var box = S.result;
        box.innerHTML = '';
        box.appendChild(el('h4', {}, 'Доступ пользователя ' + r.user));
        var dl = el('dl');
        if (r.ssh) {
            line(dl, 'SSH: хост', r.ssh.host);
            line(dl, 'SSH: порт', r.ssh.port);
            line(dl, 'SSH: пользователь', r.ssh.user);
            line(dl, 'Туннель (командная строка)', r.ssh.command);
            line(dl, 'MySQL со стороны сервера (DBeaver, вкладка Main)', r.ssh.db_host + ':' + r.ssh.db_port);
        }
        line(dl, 'База', r.schema);
        line(dl, 'Логин MySQL', r.login);
        line(dl, 'Пароль (показывается один раз)', r.password);
        line(dl, 'Строка подключения', r.connection);
        box.appendChild(dl);
        box.appendChild(el('p', {}, 'Представлений: ' + r.rebuilt.length + (r.dropped.length ? ', удалено: ' + r.dropped.length : '')));
        if (r.rebuilt.length) box.appendChild(el('p', {}, r.rebuilt.join(', ')));
        if (r.errors.length) {
            box.appendChild(el('p', {}, 'Не построены:'));
            var ul = el('ul');
            r.errors.forEach(function (e) { ul.appendChild(el('li', {}, e.view + ' — ' + e.error)); });
            box.appendChild(ul);
        }
    }
    function rebuild() {
        var id = S.user.value;
        if (!id) { status('Выберите пользователя', true); return; }
        status('Строю представления…');
        S.go.disabled = true;
        post({ action: 'rebuild', user: id, password: S.pass.value })
            .then(function (r) { S.pass.value = ''; status(''); showResult(r); return load(); })
            .catch(function (e) { status('Ошибка: ' + e.message, true); })
            .then(function () { S.go.disabled = false; });
    }
    function revoke(btn, reader) {
        if (btn.getAttribute('data-armed') !== '1') {   // второе нажатие подтверждает
            btn.setAttribute('data-armed', '1');
            btn.textContent = 'Точно отозвать?';
            return;
        }
        btn.disabled = true;
        post({ action: 'revoke', user: reader.user_id })
            .then(function () { status('Доступ пользователя ' + reader.user + ' отозван'); S.result.innerHTML = ''; return load(); })
            .catch(function (e) { status('Ошибка: ' + e.message, true); btn.disabled = false; });
    }
    function renderReaders(list) {
        var t = S.readers;
        t.innerHTML = '';
        if (!list.length) { t.appendChild(el('p', {}, 'SQL-доступ пока никому не выдан.')); return; }
        var table = el('table', { 'class': 'table table-striped table-condensed table-bordered' });
        var head = el('tr');
        ['Пользователь', 'Логин MySQL', 'Представлений', 'Выдан', ''].forEach(function (h) { head.appendChild(el('th', {}, h)); });
        table.appendChild(head);
        list.forEach(function (r) {
            var tr = el('tr');
            [r.user, r.login, r.views, r.created].forEach(function (v) { tr.appendChild(el('td', {}, String(v))); });
            var td = el('td');
            var b = el('button', { type: 'button', 'class': 'btn btn-default btn-xs' }, 'Отозвать');
            b.addEventListener('click', function () { revoke(b, r); });
            td.appendChild(b);
            tr.appendChild(td);
            table.appendChild(tr);
        });
        t.appendChild(table);
    }
    function load() {
        return post({ action: 'list' }).then(function (r) {
            var cur = S.user.value;
            S.user.innerHTML = '';
            S.user.appendChild(el('option', { value: '' }, '— пользователь —'));
            r.users.forEach(function (u) {
                S.user.appendChild(el('option', { value: String(u.id) }, u.name + (u.role ? ' (' + u.role + ')' : ' (нет роли)')));
            });
            S.user.value = cur;
            S.tunnel.textContent = r.ssh
                ? 'SSH-туннель: ' + r.ssh.user + '@' + r.ssh.host + ':' + r.ssh.port + ', MySQL со стороны сервера — ' + r.ssh.db_host + ':' + r.ssh.db_port
                : 'SSH-туннель на сервере не настроен (INTEGRAM_EXT_SSH_HOST): подключение напрямую — ' + r.connection;
            renderReaders(r.readers);
        }).catch(function (e) { status('Ошибка: ' + e.message, true); });
    }
    function init(opts) {
        if (S.inited || !opts.box) return;
        S.inited = true;
        S.db = opts.db;
        S.xsrf = opts.xsrf;
        var box = opts.box;
        S.status = el('div', { 'class': 'alert alert-info' });
        S.status.hidden = true;
        S.tunnel = el('p');
        var form = el('p');
        S.user = el('select');
        S.pass = el('input', { type: 'text', placeholder: 'Пароль (необязательно)', autocomplete: 'off' });
        S.go = el('button', { type: 'button', 'class': 'btn btn-primary' }, 'Выдать доступ / пересобрать');
        S.go.addEventListener('click', rebuild);
        [S.user, document.createTextNode(' '), S.pass, document.createTextNode(' '), S.go].forEach(function (n) { form.appendChild(n); });
        S.result = el('div');
        S.readers = el('div');
        [S.tunnel, form, S.status, S.result, el('h4', {}, 'Кому выдан доступ'), S.readers].forEach(function (n) { box.appendChild(n); });
        load();
    }
    window.ExtAccess = { init: init };
})();
