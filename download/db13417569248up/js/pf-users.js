/* Рабочее место руководителя: пользователи и доступ */
(function () {
    'use strict';
    var root = document.getElementById('pf-users-root');
    if (!root) return;
    var el = PF.el;
    var USER = 18, ROLE = 42;
    var st = {users: [], roles: []};

    function load() {
        return Promise.all([PF.rows(USER), PF.rows(ROLE)]).then(function (r) {
            var u = PF._schema.byId[USER];
            var idx = {};
            ['Роль', 'Имя', 'Email', 'Телефон', 'Token'].forEach(function (n) {
                idx[n] = 1 + u.reqs.findIndex(function (q) { return q.name === n; });
            });
            st.users = r[0].map(function (x) {
                return {
                    id: x.i, login: x.r[0],
                    roleId: PF.refId(x.r[idx['Роль']]), role: PF.refVal(x.r[idx['Роль']]),
                    fio: x.r[idx['Имя']], email: x.r[idx['Email']], phone: x.r[idx['Телефон']],
                    isSuper: String(x.r[0]) === PF.db
                };
            });
            st.roles = r[1].map(function (x) { return {id: x.i, name: x.r[0]}; });
        });
    }

    function userForm(u) {
        var fields = [
            {key: 'login', label: 'Логин', type: 'text'},
            {key: 'fio', label: 'ФИО сотрудника', type: 'text'},
            {key: 'role', label: 'Роль', type: 'select', options: st.roles},
            {key: 'email', label: 'Email', type: 'text'},
            {key: 'phone', label: 'Телефон', type: 'text'},
            {key: 'pwd', label: u ? 'Новый пароль (оставьте пустым — не менять)' : 'Пароль', type: 'text'}
        ];
        var f = PF.form(fields, u ? {login: u.login, fio: u.fio, role: u.roleId, email: u.email, phone: u.phone} : {});
        var actions = [{
            text: 'Сохранить', primary: true, onClick: function (close) {
                var v = f.values(), out = {};
                if (!u) out['t' + USER] = v.login;
                out[PF.f('Пользователь', 'Роль')] = v.role;
                out[PF.f('Пользователь', 'Имя')] = v.fio;
                out[PF.f('Пользователь', 'Email')] = v.email;
                out[PF.f('Пользователь', 'Телефон')] = v.phone;
                if (v.pwd) out[PF.f('Пользователь', 'Password')] = v.pwd;
                var p = u ? PF.update(u.id, out) : PF.create(USER, out, 1);
                p.then(function () { close(); PF.toast('Сохранено'); reload(); }).catch(PF.error);
            }
        }];
        if (u && !u.isSuper) {
            actions.push({
                text: 'Лишить доступа', onClick: function (close) {
                    PF.confirm('Лишить доступа', 'Сотрудник ' + u.login +
                        ' потеряет возможность войти: пароль будет заменён случайным, сессионный токен очищен. Запись сохранится.',
                        function () {
                            var out = {};
                            out[PF.f('Пользователь', 'Password')] = 'blocked_' + Math.random().toString(36).slice(2, 12);
                            out[PF.f('Пользователь', 'Token')] = '';
                            PF.update(u.id, out).then(function () {
                                close(); PF.toast('Доступ отозван', 'warn'); reload();
                            }).catch(PF.error);
                        });
                }
            });
        }
        PF.modal(u ? 'Сотрудник ' + u.login : 'Новый сотрудник', f.node, actions);
    }

    function render() {
        PF.clear(root);
        var canWrite = PF.canWrite('Пользователь');
        root.appendChild(el('div', {class: 'pf-head'}, [
            el('div', {}, [
                el('h1', {text: 'Пользователи и доступ'}),
                el('div', {class: 'pf-head__sub', text: 'Заведение сотрудников, смена роли, сброс пароля и отзыв доступа'})
            ]),
            el('div', {class: 'pf-actions'}, [
                canWrite ? el('button', {class: 'pf-btn pf-btn--primary', text: '+ Сотрудник',
                    onclick: function () { userForm(null); }}) : null
            ])
        ]));

        root.appendChild(el('div', {class: 'pf-card'}, [
            el('div', {class: 'pf-card__title', text: 'Сотрудники'}),
            PF.tableView([
                {title: 'Логин', key: 'login'},
                {title: 'ФИО', key: 'fio'},
                {title: 'Роль', render: function (u) { return PF.badge(u.role || '—', u.isSuper ? 'amber' : 'gray'); }},
                {title: 'Email', key: 'email'},
                {title: 'Телефон', key: 'phone'},
                {title: '', render: function (u) {
                    return u.isSuper ? el('span', {class: 'pf-legend', text: 'технический администратор базы'}) : '';
                }}
            ], st.users, {
                empty: 'Пользователей нет',
                onRow: canWrite ? function (u) {
                    if (u.isSuper) {
                        PF.toast('Супер-пользователя базы менять нельзя', 'warn');
                        return;
                    }
                    userForm(u);
                } : null
            })
        ]));

        root.appendChild(el('div', {class: 'pf-card'}, [
            el('div', {class: 'pf-card__title', text: 'Роли приложения'}),
            PF.tableView([
                {title: 'Роль', key: 'name'},
                {title: 'Сотрудников', render: function (r) {
                    return st.users.filter(function (u) { return u.roleId === r.id; }).length;
                }, cls: 'pf-num'}
            ], st.roles, {empty: 'Ролей нет'})
        ]));
    }

    function reload() {
        PF.loading(root);
        return load().then(render).catch(function (e) {
            PF.clear(root).appendChild(el('div', {class: 'pf-card', text: 'Ошибка: ' + e.message}));
            PF.error(e);
        });
    }

    PF.loading(root);
    PF.schema().then(reload);
})();
