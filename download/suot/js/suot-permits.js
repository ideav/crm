/* Наряды-допуски: маршрут «мастер → ОТ → начальник производства → закрытие», проверка допуска каждого исполнителя, блокировка подписи. */
(function () {
    'use strict';
    var A = window.Suot, C = A.core, el = A.el;
    var cur = null;
    var WHO = { master: 'мастер участка', ot: 'специалист по ОТ', chief: 'начальник производства', admin: 'администратор' };
    A.mount(function (host, M) {
        var T = M.today, h = A.hash();
        if (h.n) cur = h.n;
        host.appendChild(el('div', {}, A.head('Наряды-допуски', 'Электронный наряд на работы повышенной опасности. На каждом шаге система проверяет исполнителей: без действующего инструктажа, проверки знаний, медосмотра и обязательных СИЗ подпись не ставится.')));
        var canNew = A.canWrite('Наряд-допуск') && A.canWrite('Исполнитель наряда') && (A.rk === 'master' || A.rk === 'ot' || A.rk === 'admin');
        host.appendChild(el('div', { 'class': 'suot-bar' }, [el('div', { 'class': 'suot-grow', text: 'Ваша роль: ' + (A.ctx.role || '—') }), canNew ? A.btn('Новый наряд', function () { create(M); }, 'suot-primary') : null]));
        if (!M.permits.length) { host.appendChild(el('p', { 'class': 'suot-muted', text: 'Нарядов нет.' })); return; }
        var p = M.permits.filter(function (x) { return x.num === cur; })[0] || M.permits.filter(function (x) { return x.status === 'На согласовании ОТ'; })[0] || M.permits[0];
        cur = p.num;
        var listTbl = A.table([{ t: 'Наряд', html: function (r) { return '<b>' + A.esc(r.num) + '</b><br><small class="suot-muted">' + C.toDmy(r.date) + ' ' + A.esc(r.from + '–' + r.to) + '</small>'; } }, { t: 'Работы', html: function (r) { return A.esc(r.work) + '<br><small class="suot-muted">' + A.esc(r.dept) + '</small>'; } }, { t: 'Статус', html: function (r) { var chk = C.permitCheck(r, M, T); return A.badge(r.status, r.status === 'Закрыт' ? 'mute' : r.status === 'Допуск выдан' ? 'ok' : r.status === 'Отклонён' ? 'crit' : 'info') + (!chk.ok && r.status !== 'Закрыт' && r.status !== 'Отклонён' ? '<br>' + A.badge('исполнитель не допущен', 'crit') : ''); } }],
            M.permits, { onrow: function (r) { cur = r.num; location.hash = 'n=' + r.num; A.render(); }, rowCls: function (r) { return r.num === cur ? 'suot-row-warn' : ''; } });
        host.appendChild(el('div', { 'class': 'suot-split' }, [listTbl, detail(M, p, T)]));
    });
    function detail(M, p, T) {
        var chk = C.permitCheck(p, M, T), step = C.nextStep(p.status);
        var idx = C.FLOW.map(function (f) { return f.from; }).concat(['Закрыт']).indexOf(p.status);
        var steps = el('div', { 'class': 'suot-steps' }, C.FLOW.map(function (f, i) {
            var cls = p.status === 'Отклонён' ? '' : i < idx ? 'suot-done' : i === idx ? (chk.ok || f.to === 'Закрыт' ? 'suot-now' : 'suot-stop') : '';
            return el('div', { 'class': 'suot-step ' + cls }, [el('b', { text: f.label }), WHO[f.role]]);
        }));
        var box = el('div', { 'class': 'suot-card' }, [el('h2', { text: p.num + ' · ' + p.work }), el('p', { text: p.what }),
            kv('Подразделение', p.dept), kv('Место', p.place), kv('Когда', C.toDmy(p.date) + ', ' + p.from + '–' + p.to), kv('Ответственный руководитель', p.head), kv('Производитель работ', p.doer), kv('Статус', p.status), steps]);
        /* исполнители */
        var editable = (p.status === 'Черновик' || p.status === 'На согласовании ОТ') && A.canWrite('Исполнитель наряда');
        var rows = chk.rows;
        var t = A.table([{ t: 'Исполнитель', html: function (r) { var w = M.workerBy[r.worker] || {}; return '<a href="' + A.nav('card', 'w=' + encodeURIComponent(r.worker)) + '">' + A.esc(r.worker) + '</a><br><small class="suot-muted">' + A.esc(w.pos || '') + '</small>'; } },
            { t: 'Допуск к «' + p.work + '»', html: function (r) { return r.ok ? A.badge('допущен', 'ok') : A.badge('не допущен', 'crit') + '<br><small>' + r.reasons.map(A.esc).join('<br>') + '</small>'; } },
            { t: '', html: function () { return ''; }, cls: function () { return 'suot-xact'; } }], rows, { rowCls: function (r) { return r.ok ? '' : 'suot-row-bad'; }, empty: 'Исполнители не назначены' });
        if (editable) t.querySelectorAll('.suot-xact').forEach(function (td, i) {
            var row = M.execRows.filter(function (x) { return x.permit === p.num && x.worker === rows[i].worker; })[0];
            if (row) td.appendChild(A.btn('Убрать', function () { A.post('_m_del/' + row.id + '?JSON', {}).then(function () { A.resetModel(); A.toast('Исполнитель убран'); A.render(); }, function (e) { A.toast(e.message, 1); }); }, 'suot-small'));
        });
        box.appendChild(el('h3', { text: 'Исполнители', style: 'margin-top:14px' }));
        box.appendChild(t);
        if (editable) {
            var cand = M.workers.filter(function (w) { return w.dept === p.dept && p.executors.indexOf(w.name) < 0 && (M.positions[w.pos] || { works: [] }).works.indexOf(p.work) >= 0; });
            if (cand.length) {
                var sel = A.select(cand.map(function (w) { var a = C.admission(w, M, T, p.works); return [w.name, w.name + (a.ok ? ' — допущен' : ' — не допущен')]; }));
                box.appendChild(el('div', { 'class': 'suot-bar' }, [A.field('Добавить исполнителя', sel), A.btn('Добавить', function () {
                    A.create('Исполнитель наряда', { 'Исполнитель наряда': p.num + ': ' + sel.value, 'Наряд-допуск': p.num, 'Работник': sel.value }).then(function () { A.toast('Исполнитель добавлен'); A.render(); }, function (e) { A.toast(e.message, 1); });
                })]));
            }
        }
        /* подпись текущего шага */
        if (step) {
            var res = C.signPermit(p, A.ctx.role, M, T);
            var mine = A.rk === step.role || A.rk === 'admin';
            if (res.blocked) box.appendChild(el('div', { 'class': 'suot-warnbox suot-e' }, [el('b', { text: 'Подпись «' + step.label + '» заблокирована. ' }), 'Не допущены: ' + chk.rows.filter(function (r) { return !r.ok; }).map(function (r) { return r.worker; }).join(', ') + '. Замените исполнителя или проведите недостающее (карточка работника).']));
            var b = A.btn(step.label, function () { doSign(M, p); }, 'suot-primary');
            b.disabled = !mine || !res.ok || !A.canWrite('Наряд-допуск');
            var bar = el('div', { 'class': 'suot-bar' }, [b, mine ? null : el('span', { 'class': 'suot-muted', text: 'Этот шаг подписывает ' + WHO[step.role] + '.' })]);
            if (mine && A.canWrite('Наряд-допуск') && step.to !== 'Закрыт' && (A.rk === 'ot' || A.rk === 'chief' || A.rk === 'admin')) bar.appendChild(A.btn('Отклонить', function () { reject(M, p); }, 'suot-danger'));
            box.appendChild(bar);
        }
        box.appendChild(el('h3', { text: 'Журнал подписей', style: 'margin-top:14px' }));
        box.appendChild(el('pre', { 'class': 'suot-log', text: p.log || 'Подписей пока нет' }));
        return box;
    }
    function line(step) { return A.stamp() + ' ' + A.short(A.FIO[A.ctx.user] || A.ctx.user) + ' (' + (A.ctx.role || '') + '): ' + step; }
    function doSign(M, p) {
        var res = C.signPermit(p, A.ctx.role, M, M.today);
        if (!res.ok) { A.toast(res.error, 1); return; }
        A.update(p.id, { 'Статус наряда': res.status, 'Журнал подписей': (p.log ? p.log + '\n' : '') + line(res.step.label.toLowerCase()) })
            .then(function () { A.toast(p.num + ': ' + res.status); A.render(); }, function (e) { A.toast(e.message, 1); });
    }
    function reject(M, p) {
        var why = A.input('text', '');
        A.modal('Отклонить ' + p.num, A.field('Причина', why), [{ text: 'Отмена' }, { text: 'Отклонить', cls: 'suot-danger', keep: 1, fn: function (close) {
            if (!why.value.trim()) { A.toast('Нужна причина', 1); return; }
            A.update(p.id, { 'Статус наряда': 'Отклонён', 'Журнал подписей': (p.log ? p.log + '\n' : '') + line('отклонён: ' + why.value) }).then(function () { close(); A.render(); }, function (e) { A.toast(e.message, 1); });
        } }]);
    }
    function create(M) {
        var depts = M.depts.filter(function (d) { return M.workers.some(function (w) { return w.dept === d; }); });
        var dept = A.select(depts, depts[0]), work = A.select(M.workTypes, M.workTypes[0]), what = A.input('text', ''), place = A.input('text', ''), date = A.input('date', C.addDays(M.today, 1)), from = A.input('time', '08:00'), to = A.input('time', '16:00');
        var head = A.input('text', ''), doer = A.input('text', '');
        function fill() { var d = M.deptRows.filter(function (x) { return x['Подразделение'] === dept.value; })[0] || {}; head.value = d['Руководитель подразделения'] || ''; doer.value = d['Мастер подразделения'] || ''; }
        fill(); dept.addEventListener('change', fill);
        A.modal('Новый наряд-допуск', el('div', { 'class': 'suot-grid2' }, [A.field('Подразделение', dept), A.field('Вид работ', work), A.field('Содержание работ', what), A.field('Место работ', place), A.field('Дата работ', date), el('div', { 'class': 'suot-grid2' }, [A.field('Начало', from), A.field('Окончание', to)]), A.field('Ответственный руководитель', head), A.field('Производитель работ', doer)]), [{ text: 'Отмена' }, { text: 'Создать черновик', cls: 'suot-primary', keep: 1, fn: function (close) {
            if (!what.value.trim()) { A.toast('Опишите работы', 1); return; }
            var n = M.permits.reduce(function (m, x) { return Math.max(m, parseInt(String(x.num).split('-').pop(), 10) || 0); }, 0) + 1, num = 'НД-2026-' + n;
            A.create('Наряд-допуск', { 'Наряд-допуск': num, 'Подразделение': dept.value, 'Вид работ': work.value, 'Содержание работ': what.value, 'Место работ': place.value, 'Дата работ': C.toDmy(date.value), 'Время начала': from.value, 'Время окончания': to.value, 'Ответственный руководитель': head.value, 'Производитель работ': doer.value, 'Статус наряда': 'Черновик', 'Составил': A.FIO[A.ctx.user] || A.ctx.user })
                .then(function () { close(); cur = num; location.hash = 'n=' + num; A.toast(num + ' создан: добавьте исполнителей'); A.render(); }, function (e) { A.toast(e.message, 1); });
        } }], true);
    }
    function kv(k, v) { return el('div', { 'class': 'suot-kv' }, [el('span', { text: k }), el('span', { text: v || '—' })]); }
})();
