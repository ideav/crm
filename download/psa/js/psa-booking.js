/* PSA: Бронирование. Очередь согласований руководителю ресурсного пула, все брони (мягкие и жёсткие), запросы ресурса. */
(function () {
    'use strict';
    var P = window.Psa, C = P.core;
    var st = { tab: 'queue', pool: null, status: '', q: '' };

    function canApprove() { return /пула|PMO/.test(P.ctx.role); }
    function local(host, M, b, patch, msg, close) { Object.keys(patch).forEach(function (k) { b[k] = patch[k]; }); P.toast(msg); if (close) close(); render(host, M); }
    function dateRange(b) { return C.toShort(b.from) + ' - ' + C.toShort(b.to); }
    function check(M, b) {
        var e = M.empBy[b.emp];
        return C.checkBooking(e, b, M.bookings.filter(function (x) { return x.id !== b.id; }), M.hol, M.abs[e.name] || [], M.rules);
    }
    function peak(res) { var m = 0; res.weeks.forEach(function (l) { if (l.pct !== null && l.base > 0 && l.pct > m) m = l.pct; }); return Math.round(m); }
    function expiryBadge(M, b) {
        if (b.kind !== 'Мягкая' || !b.expires || (b.status !== 'Подтверждена' && b.status !== 'Запрошена')) return '';
        var d = C.diffDays(P.TODAY, b.expires);
        return P.badge(d <= 0 ? 'истекла' : 'истекает через ' + d + ' дн.', d <= 3 ? 'crit' : d <= 7 ? 'warn' : 'mute');
    }
    function statusBadge(s) { return P.badge(s, { 'Запрошена': 'warn', 'Подтверждена': 'ok', 'Отклонена': 'crit', 'Истекла': 'mute' }[s] || 'info'); }

    function render(host, M) {
        host.innerHTML = '';
        if (st.pool === null) st.pool = M.me && canApprove() ? M.me.name : '';
        var pend = M.bookings.filter(function (b) { return b.status === 'Запрошена'; }).length;
        host.appendChild(P.el('h1', { text: 'Бронирование ресурсов' }));
        host.appendChild(P.el('p', { 'class': 'psa-sub', text: 'Руководитель проекта запрашивает человека на проект, руководитель ресурсного пула видит последствия для загрузки и подтверждает или отклоняет. Мягкая бронь истекает сама, жёсткая держится до конца срока.' }));
        var bar = P.el('div', { 'class': 'psa-bar' }, [P.el('span', { 'class': 'psa-grow' })]);
        if (P.canWrite('Бронь')) bar.appendChild(P.btn('Новая бронь', function () { P.bookingForm(M, { onSaved: function () { reload(host); } }); }, 'psa-primary'));
        if (P.canWrite('Запрос ресурса')) bar.appendChild(P.btn('Новый запрос ресурса', function () { requestForm(host, M); }));
        host.appendChild(bar);
        host.appendChild(P.tabs([['queue', 'На согласовании (' + pend + ')'], ['all', 'Все брони'], ['reqs', 'Запросы ресурса']], st.tab, function (t) { st.tab = t; render(host, M); }));
        if (st.tab === 'queue') queue(host, M); else if (st.tab === 'all') all(host, M); else reqs(host, M);
    }
    function reload(host) { P.resetModel(); P.model().then(function (M) { render(host, M); }).catch(P.fail); }

    function queue(host, M) {
        var pools = [['', 'Все пулы']].concat(M.pools.map(function (p) { return [p.name, p.name]; }));
        var s = P.select(pools, st.pool); s.onchange = function () { st.pool = s.value; render(host, M); };
        host.appendChild(P.el('div', { 'class': 'psa-bar' }, [P.field('Ресурсный пул', s)]));
        var rows = M.bookings.filter(function (b) { return b.status === 'Запрошена' && (!st.pool || M.empBy[b.emp].pool === st.pool); }).map(function (b) {
            var r = check(M, b); return { b: b, res: r, peak: peak(r) };
        });
        var cols = [
            { t: 'Бронь', html: function (r) { return '<b>' + P.esc(r.b.id) + '</b>'; } },
            { t: 'Проект', html: function (r) { return P.esc(r.b.project) + '<div class="psa-muted">' + P.esc(r.b.requester) + '</div>'; } },
            { t: 'Сотрудник', html: function (r) { var e = M.empBy[r.b.emp]; return P.esc(r.b.emp) + '<div class="psa-muted">' + P.esc(e.pool) + ', ' + P.esc(e.grade) + '</div>'; } },
            { t: 'Вид', html: function (r) { return P.badge(r.b.kind, r.b.kind === 'Жёсткая' ? 'info' : 'mute') + ' ' + expiryBadge(M, r.b); } },
            { t: 'Срок', html: function (r) { return dateRange(r.b); } },
            { t: 'Ч/нед', num: true, html: function (r) { return String(r.b.hpw); } },
            { t: 'Загрузка с бронью', html: function (r) { return r.res.errors.length ? P.badge('пик ' + r.peak + '%: нельзя', 'crit') : r.res.warnings.length ? P.badge('пик ' + r.peak + '%', 'warn') : P.badge('пик ' + r.peak + '%', 'ok'); } },
            { t: '', html: function (r) { return '<span class="psa-av">открыть</span>'; } }
        ];
        host.appendChild(P.table(cols, rows, { empty: 'Очередь пуста: всё согласовано', onrow: function (r) { detail(host, M, r.b); }, rowCls: function (r) { return r.res.errors.length ? 'psa-row-bad' : ''; } }));
    }
    function all(host, M) {
        var sts = [['', 'Любой статус'], ['Подтверждена', 'Подтверждена'], ['Запрошена', 'Запрошена'], ['Отклонена', 'Отклонена'], ['Истекла', 'Истекла']];
        var s = P.select(sts, st.status), q = P.input('text', st.q, { placeholder: 'Сотрудник или проект' });
        s.onchange = function () { st.status = s.value; render(host, M); }; q.onchange = function () { st.q = q.value; render(host, M); };
        host.appendChild(P.el('div', { 'class': 'psa-bar' }, [P.field('Статус', s), P.field('Поиск', q)]));
        var rows = M.bookings.filter(function (b) {
            if (st.status && b.status !== st.status) return false;
            if (st.q && (b.emp + ' ' + b.project).toLowerCase().indexOf(st.q.toLowerCase()) < 0) return false;
            if (M.myProjects.length && !M.myProjects.some(function (p) { return p.name === b.project; }) && !st.q && !st.status) return false;
            return true;
        }).sort(function (a, b) { return a.from < b.from ? 1 : -1; }).slice(0, 300);
        host.appendChild(P.table([
            { t: 'Бронь', html: function (b) { return '<b>' + P.esc(b.id) + '</b>'; } }, { t: 'Проект', k: 'project' }, { t: 'Сотрудник', k: 'emp' },
            { t: 'Вид', html: function (b) { return P.badge(b.kind, b.kind === 'Жёсткая' ? 'info' : 'mute') + ' ' + expiryBadge(M, b); } },
            { t: 'Статус', html: function (b) { return statusBadge(b.status); } }, { t: 'Срок', html: dateRange }, { t: 'Ч/нед', num: true, html: function (b) { return String(b.hpw); } },
            { t: 'Решение', html: function (b) { return P.esc(b.decision || ''); } }
        ], rows, { onrow: function (b) { detail(host, M, b); }, empty: 'Броней нет' }));
        if (M.myProjects.length && !st.q && !st.status) host.appendChild(P.el('p', { 'class': 'psa-muted', text: 'Показаны брони ваших проектов. Чтобы увидеть остальные, выберите статус или введите поиск.' }));
    }
    function reqs(host, M) {
        var rows = M.reqs.slice().sort(function (a, b) { return ({ 'Высокий': 0, 'Средний': 1, 'Низкий': 2 })[a.priority] - ({ 'Высокий': 0, 'Средний': 1, 'Низкий': 2 })[b.priority]; });
        host.appendChild(P.table([
            { t: 'Запрос', html: function (r) { return '<b>' + P.esc(r.code) + '</b>'; } }, { t: 'Проект', k: 'project' }, { t: 'Роль', k: 'role' },
            { t: 'Навык и грейд', html: function (r) { return P.esc(r.skill) + ' ' + '<span class="psa-lvl">' + new Array(r.minLevel + 1).join('★') + '</span><div class="psa-muted">от ' + P.esc(r.minGrade) + '</div>'; } },
            { t: 'Нужен', html: function (r) { return C.toShort(r.from) + ' - ' + C.toShort(r.to) + ', ' + r.hpw + ' ч/нед'; } },
            { t: 'Приоритет', html: function (r) { return P.badge(r.priority, r.priority === 'Высокий' ? 'crit' : r.priority === 'Средний' ? 'warn' : 'mute'); } },
            { t: 'Статус', html: function (r) { return P.badge(r.status, r.status === 'Закрыт' ? 'ok' : r.status === 'Предложено' ? 'info' : 'warn') + (r.suggested ? '<div class="psa-muted">' + P.esc(r.suggested) + '</div>' : ''); } },
            { t: '', html: function (r) { return r.status === 'Закрыт' ? '' : '<span class="psa-av">подобрать</span>'; } }
        ], rows, { onrow: function (r) { if (r.status !== 'Закрыт') location.href = P.nav('finder', 'req=' + encodeURIComponent(r.code)); }, empty: 'Запросов нет' }));
    }

    function detail(host, M, b) {
        var e = M.empBy[b.emp], res = check(M, b), body = P.el('div', {});
        body.appendChild(P.el('div', { html: '<div class="psa-kv"><span>Проект</span><b>' + P.esc(b.project) + '</b></div><div class="psa-kv"><span>Сотрудник</span><b>' + P.esc(b.emp) + ', ' + P.esc(e.pool) + ', ' + P.esc(e.grade) + '</b></div>' +
            '<div class="psa-kv"><span>Бронь</span><b>' + P.esc(b.kind) + ', ' + b.hpw + ' ч/нед, ' + dateRange(b) + '</b></div><div class="psa-kv"><span>Статус</span><span>' + statusBadge(b.status) + ' ' + expiryBadge(M, b) + '</span></div>' +
            '<div class="psa-kv"><span>Заявитель</span><b>' + P.esc(b.requester) + '</b></div>' + (b.decision ? '<div class="psa-kv"><span>Решение</span><b>' + P.esc(b.decision) + '</b></div>' : '') }));
        var weeks = C.weeksBetween(b.status === 'Запрошена' ? b.from : P.TODAY < b.from ? b.from : P.TODAY, b.to).slice(0, 14);
        body.appendChild(P.el('div', { 'class': 'psa-muted', style: 'margin-top:10px', text: 'Загрузка ' + e.name + ' (с учётом этой брони)' }));
        body.appendChild(P.loadStrip(M, e, M.bookings, weeks));
        if (b.status === 'Запрошена') body.appendChild(P.checkBox(res));
        var btns = [{ text: 'Закрыть' }];
        var wr = P.canWrite('Бронь');
        if (wr && canApprove() && b.status === 'Запрошена') {
            btns.push({ text: 'Отклонить', cls: 'psa-danger', fn: function (close) { reasonModal(host, M, b, close); return false; } });
            btns.push({ text: 'Подтвердить', cls: 'psa-primary', fn: function (close) {
                if (!res.ok) { P.toast('Подтвердить нельзя: ' + res.errors[0], true); return false; }
                P.update(b.rid, { 'Статус брони': 'Подтверждена', 'Решение': 'Подтверждено', 'Дата решения': P.TODAY, 'Согласующий': M.me ? M.me.head : P.ctx.user }).then(function () { local(host, M, b, { status: 'Подтверждена', decision: 'Подтверждено', decDate: P.TODAY }, 'Бронь подтверждена', close); }).catch(function (er) { P.toast(er.message, true); });
                return false; } });
        }
        if (wr && canApprove() && b.status === 'Подтверждена' && b.kind === 'Мягкая') {
            btns.push({ text: 'Продлить на ' + M.rules.softDays + ' дн.', fn: function (close) {
                P.update(b.rid, { 'Истекает': C.addDays(b.expires && b.expires > P.TODAY ? b.expires : P.TODAY, M.rules.softDays) }).then(function () { local(host, M, b, { expires: C.addDays(b.expires && b.expires > P.TODAY ? b.expires : P.TODAY, M.rules.softDays) }, 'Срок продлён', close); }).catch(function (er) { P.toast(er.message, true); });
                return false; } });
            btns.push({ text: 'Сделать жёсткой', fn: function (close) {
                var chk = C.checkBooking(e, Object.assign({}, b, { kind: 'Жёсткая' }), M.bookings.filter(function (x) { return x.id !== b.id; }), M.hol, M.abs[e.name] || [], M.rules);
                if (!chk.ok) { P.toast(chk.errors[0], true); return false; }
                P.update(b.rid, { 'Вид брони': 'Жёсткая', 'Истекает': '' }).then(function () { local(host, M, b, { kind: 'Жёсткая', expires: '' }, 'Бронь стала жёсткой', close); }).catch(function (er) { P.toast(er.message, true); });
                return false; } });
        }
        P.modal(b.id + ': ' + b.project, body, btns, true);
    }
    function reasonModal(host, M, b, closeParent) {
        var t = P.el('textarea', { rows: 3, placeholder: 'Например: сотрудник нужен на другом проекте до конца года' });
        P.modal('Отклонить бронь', P.field('Причина', t), [{ text: 'Отмена' }, { text: 'Отклонить', cls: 'psa-danger', fn: function (close) {
            if (!t.value.trim()) { P.toast('Укажите причину', true); return false; }
            P.update(b.rid, { 'Статус брони': 'Отклонена', 'Решение': t.value.trim(), 'Дата решения': P.TODAY }).then(function () { closeParent(); local(host, M, b, { status: 'Отклонена', decision: t.value.trim(), decDate: P.TODAY }, 'Бронь отклонена', close); }).catch(function (er) { P.toast(er.message, true); });
            return false; } }]);
    }
    function requestForm(host, M) {
        var mine = P.pickProjects(M);
        var proj = P.select(mine.map(function (p) { return [p.name, p.code + ' ' + p.name]; }), mine[0] && mine[0].name);
        var role = P.input('text', '', { placeholder: 'Например: Java-разработчик' });
        var skill = P.select(M.skillList.map(function (s) { return [s, s]; }), M.skillList[0]), grade = P.select(M.gradeList.map(function (g) { return [g, g]; }), 'middle');
        var lvl = P.select([['2', '2 из 5'], ['3', '3 из 5'], ['4', '4 из 5'], ['5', '5 из 5']], '3');
        var from = P.input('date', C.weekStart(C.addDays(P.TODAY, 14))), to = P.input('date', C.addDays(C.weekStart(C.addDays(P.TODAY, 14)), 90));
        var hpw = P.input('number', 20, { min: 1, max: 60 }), prio = P.select([['Высокий', 'Высокий'], ['Средний', 'Средний'], ['Низкий', 'Низкий']], 'Средний');
        var body = P.el('div', { 'class': 'psa-grid2' }, [P.field('Проект', proj), P.field('Роль', role), P.field('Навык', skill), P.field('Минимальный грейд', grade), P.field('Уровень навыка', lvl), P.field('Приоритет', prio), P.field('Нужен с', from), P.field('Нужен по', to), P.field('Часов в неделю', hpw)]);
        P.modal('Новый запрос ресурса', body, [{ text: 'Отмена' }, { text: 'Создать запрос', cls: 'psa-primary', fn: function (close) {
            if (!role.value.trim()) { P.toast('Укажите роль', true); return false; }
            var max = 0; M.reqs.forEach(function (r) { var n = parseInt(String(r.code).replace(/\D/g, ''), 10); if (n > max) max = n; });
            P.create('Запрос ресурса', { 'Запрос ресурса': 'ЗР-' + String(max + 1).padStart(3, '0'), 'Проект': proj.value, 'Роль на проекте': role.value, 'Навык': skill.value, 'Мин. грейд': grade.value, 'Мин. уровень навыка': lvl.value, 'Нужно с': from.value, 'Нужно по': to.value, 'Часов в неделю': hpw.value, 'Приоритет запроса': prio.value, 'Статус запроса': 'Новый' })
                .then(function () { P.toast('Запрос создан'); close(); st.tab = 'reqs'; reload(host); }).catch(function (er) { P.toast(er.message, true); });
            return false; } }], true);
    }
    P.mount(render);
})();
