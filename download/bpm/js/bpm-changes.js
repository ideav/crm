/* BPM: Правки процесса - предложение из решения по неопределённости, одобрение сторон, внесение в спецификацию, сброс демо. */
(function () {
    'use strict';
    var P = window.Bpm, C = P.core;
    function render(host, M) {
        host.appendChild(P.el('div', {}, P.head('Правки процесса', 'Новый шаг встаёт в спецификацию только после одобрения сторон: передающей, принимающей и владельца процесса. Если объект никому не передаётся — двух сторон: исполнителя шага и владельца.')));
        var props = M.props.slice().sort(function (a, b) { return a.n < b.n ? 1 : -1; });
        var myWait = M.apprs.filter(function (a) { return a.who === P.ctx.user && a.decision === 'Ждёт'; });
        host.appendChild(P.el('div', { 'class': 'bpm-kpis' }, [
            P.kpi('Ждут моего одобрения', String(myWait.length), '', myWait.length ? 'warn' : ''),
            P.kpi('На одобрении', String(props.filter(function (p) { return p.state === 'На одобрении'; }).length), ''),
            P.kpi('Внесено в спецификацию', String(props.filter(function (p) { return p.state === 'Внесена'; }).length), 'версии: ' + M.procs.map(function (p) { return p.code + ' v' + p.version; }).join(', '))
        ]));
        if (!props.length) host.appendChild(P.el('p', { 'class': 'bpm-muted', text: 'Предложений нет. Они появляются, когда ответственный решает неопределённость на экране «Заявки».' }));
        props.forEach(function (p) { host.appendChild(card(M, p)); });
        if (M.isOwner && P.canWrite('Заявка')) host.appendChild(P.el('div', { 'class': 'bpm-reset' }, [P.el('span', { 'class': 'bpm-muted', text: 'Демо повторяется: вернуть заявки, неопределённость и правки в состояние на утро 26.11.2026.' }), P.btn('Вернуть демо в исходное', function () { reset(M); }, 'bpm-small')]));
    }
    function card(M, p) {
        var rows = M.apprs.filter(function (a) { return a.prop === p.n; }), st = C.approvalState(rows), unc = M.uncs.filter(function (u) { return u.n === p.unc; })[0];
        var stateB = p.state === 'Внесена' ? P.badge('внесена в спецификацию', 'ok') : st.rejected ? P.badge('отклонена', 'mute') : st.approved ? P.badge('одобрена всеми сторонами', 'ok') : P.badge('одобрено ' + st.done + ' из ' + st.total, 'warn');
        var box = P.el('div', { 'class': 'bpm-card bpm-prop' }, [
            P.el('div', { 'class': 'bpm-card-h', html: '<b>' + P.esc(p.n) + '</b> · ' + P.esc(p.proc) + ' ' + stateB + ' ' + P.badge(p.transfer ? 'передача объекта: 3 стороны' : 'без передачи: 2 стороны', 'info') }),
            P.el('div', { 'class': 'bpm-route', html: P.esc(p.from) + ' <span class="bpm-arrow">→</span> <b>' + P.esc(p.to) + '</b> <span class="bpm-muted">при «' + P.esc(p.cond) + '»</span>' }),
            P.el('p', { text: p.text }),
            P.el('div', { 'class': 'bpm-muted', html: 'Предложил ' + P.esc(P.who(p.author)) + ' ' + P.d(p.date) + (unc ? ' · основание: ' + P.esc(unc.n) + ', заявка <a href="' + P.nav('requests', 'r=' + encodeURIComponent(unc.req)) + '">' + P.esc(unc.req) + '</a>' : '') })
        ]);
        box.appendChild(P.table([{ k: 'side', t: 'Сторона' }, { t: 'Кто', html: function (a) { return P.esc(P.who(a.who)); } }, { t: 'Решение', html: function (a) { return P.badge(a.decision, a.decision === 'Одобрено' ? 'ok' : a.decision === 'Отклонено' ? 'crit' : 'warn') + (a.date ? ' <span class="bpm-muted">' + P.d(a.date) + '</span>' : ''); } }, { k: 'com', t: 'Комментарий' },
            { t: '', html: function (a) { return a.who === P.ctx.user && a.decision === 'Ждёт' && p.state !== 'Внесена' ? '<span class="bpm-cta">Решить →</span>' : ''; } }], rows, { onrow: function (a) { if (a.who === P.ctx.user && a.decision === 'Ждёт' && p.state !== 'Внесена') decide(M, a); } }));
        /* Что изменится для заявок в работе на этом шаге. */
        var spec2 = { steps: M.spec.steps, transitions: M.spec.transitions.concat(p.state === 'Внесена' ? [] : [{ from: p.from, to: p.to, cond: p.cond }]) };
        var affected = M.reqs.filter(function (r) { return !r.done && r.at === p.from && r.status === 'В работе' && r.proc === p.proc; }).map(function (r) {
            var now = C.route(p.state === 'Внесена' ? M.spec : { steps: M.spec.steps, transitions: M.spec.transitions }, r.at, C.attrsOf(r, 'Согласовано')), after = C.route(spec2, r.at, C.attrsOf(r, 'Согласовано'));
            return { r: r, now: now, after: after };
        }).filter(function (x) { return x.after.to === p.to || x.now.stuck; });
        if (affected.length) box.appendChild(P.el('div', { 'class': 'bpm-warnbox ' + (p.state === 'Внесена' ? 'bpm-g' : 'bpm-w'), html: affected.map(function (x) {
            return '<b>' + P.esc(x.r.n) + '</b> (' + P.esc(x.r.cp) + ') сейчас на «' + P.esc(x.r.at) + '»: ' + (p.state === 'Внесена' ? 'после решения «Согласовано» пойдёт в «' + P.esc(x.after.to) + '» сама, без исключения.' : (x.now.stuck ? 'без правки встанет так же, как ' + P.esc(unc ? unc.req : 'основание') + '; ' : '') + 'с правкой пойдёт в «' + P.esc(x.after.to) + '».');
        }).join('<br>') }));
        if (p.state !== 'Внесена' && st.approved && P.canWrite('Переход')) box.appendChild(P.el('div', { 'class': 'bpm-bar' }, [P.btn('Внести в спецификацию', function (ev) { ev.target.disabled = true; P.applyProp(p).then(function () { P.toast(p.n + ' внесена: новый переход в «' + p.proc + '»'); P.rerender(render); }).catch(function (e) { ev.target.disabled = false; P.toast(e.message, true); }); }, 'bpm-primary')]));
        return box;
    }
    function decide(M, a) {
        var com = P.input('textarea', '', { placeholder: 'Комментарий (обязателен при отклонении)' });
        P.modal('Правка ' + a.prop + ': ' + a.side.toLowerCase() + ' сторона', P.el('div', {}, [P.field('Комментарий', com)]), [{ text: 'Отмена' },
            { text: 'Отклонить', cls: 'bpm-danger', keep: true, fn: function (close) { if (com.value.trim().length < 5) { P.toast('Отклонение — с комментарием', true); return false; } go('Отклонено', close); return false; } },
            { text: 'Одобрить', cls: 'bpm-primary', keep: true, fn: function (close) { go('Одобрено', close); return false; } }]);
        function go(d, close) { P.approve(a, d, com.value.trim()).then(function () { close(); P.toast(a.prop + ': ' + d.toLowerCase()); P.rerender(render); }).catch(function (e) { P.toast(e.message, true); }); }
    }
    /* Сброс демо: всё, что создано после загрузки данных, удаляется; заявки в работе и Н-0007 возвращаются. */
    var BASE = { 'Т-': 265, 'Ж-': 433, 'Н-': 7, 'П-': 1, 'О-': 2, 'В-': 63, 'З-': 1 };
    var OPEN = [['ДГ-2026-0446', 'Подписание договора', 'ptikhonov', 'В работе', '2026-11-23'], ['ДГ-2026-0448', 'Проверка бюджета', 'esmirnova', 'В работе', '2026-11-19'], ['ДГ-2026-0450', 'Согласование с финдиректором', 'vzaitsev', 'В работе', '2026-11-23'], ['ДГ-2026-0452', 'Проверка бюджета', 'esmirnova', 'В работе', '2026-11-23'], ['ДГ-2026-0453', 'Валютный контроль', 'treasury', 'В работе', '2026-11-23'], ['ДГ-2026-0455', 'Проверка бюджета', 'esmirnova', 'В работе', '2026-11-24'], ['ДГ-2026-0457', 'Проверка юристом', 'owner', 'Ждёт решения', '2026-11-23'], ['ДГ-2026-0458', 'Проверка юристом', 'lawyer', 'В работе', '2026-11-25'], ['ДГ-2026-0460', 'Возврат инициатору', 'initiator', 'В работе', '2026-11-25'], ['ДГ-2026-0461', 'Регистрация договора', 'mlebedeva', 'В работе', '2026-11-26'], ['ДГ-2026-0463', 'Проверка юристом', 'lawyer', 'В работе', '2026-11-26'], ['ЗК-2026-0319', 'Создание контрагента в 1С', 'analyst', 'Ошибка интеграции', '2026-11-24'], ['ЗК-2026-0324', 'Проверка лимита', 'isokolova', 'В работе', '2026-11-24'], ['ЗК-2026-0327', 'Согласование руководителем закупок', 'ikovalev', 'В работе', '2026-11-25'], ['ЗК-2026-0329', 'Создание заявки на закупку', 'initiator', 'В работе', '2026-11-26'], ['ЗК-2026-0330', 'Проверка лимита', 'isokolova', 'В работе', '2026-11-26']];
    var VERS = { 'ДГ': 4, 'ЗК': 5 };
    function newer(n) { var m = /^([А-Я]-)(\d+)$/.exec(n || ''); return !!m && BASE[m[1]] !== undefined && +m[2] > BASE[m[1]]; }
    function reset(M) {
        P.modal('Вернуть демо в исходное', P.el('p', { text: 'Удалятся заявки, задачи, события, неопределённости, правки и вызовы, созданные во время показа; заявки в работе вернутся на свои шаги, Н-0007 — в «Открыта», версии спецификаций — ДГ v4, ЗК v5.' }), [{ text: 'Отмена' }, { text: 'Вернуть', cls: 'bpm-primary', keep: true, fn: function (close) {
            var del = [], set = [], baseReq = {};
            OPEN.forEach(function (o) { baseReq[o[0]] = o; });
            /* порядок: сначала ссылающиеся записи - ядро не удаляет запись, на которую есть ссылка */
            [M.calls, M.apprs, M.props, M.tasks, M.events, M.uncs, M.subs].forEach(function (list) { list.forEach(function (x) { if (newer(x.n)) del.push(x.id); }); });
            M.spec.transitions.forEach(function (t) { if (/^Правка/.test(t.source || '')) del.push(t.id); });
            M.reqs.forEach(function (r) { if (!/^(ДГ-2026-0(4[1-5]\d|46[0-3])|ЗК-2026-03([0-2]\d|30))$/.test(r.n)) del.push(r.id); else if (baseReq[r.n]) { var o = baseReq[r.n]; if (r.at !== o[1] || r.exec !== o[2] || r.status !== o[3] || r.entered !== o[4] || r.done) set.push(P.SET(r.id, { 'Текущий шаг': o[1], 'Текущий исполнитель': o[2], 'Статус заявки': o[3], 'Вошла в шаг': o[4], 'Завершена': '' })); } });
            M.uncs.forEach(function (u) { if (u.n === 'Н-0007' && u.state !== 'Открыта') set.push(P.SET(u.id, { 'Выбранный шаг': '', 'Решена': '', 'Комментарий решения': '', 'Состояние неопределённости': 'Открыта' })); });
            M.apprs.forEach(function (a) { if (a.n === 'О-0002' && a.decision !== 'Ждёт') set.push(P.SET(a.id, { 'Решение стороны': 'Ждёт', 'Дата решения': '', 'Комментарий стороны': '' })); });
            M.props.forEach(function (p) { if (p.n === 'П-0001' && p.state !== 'На одобрении') set.push(P.SET(p.id, { 'Состояние правки': 'На одобрении' })); });
            M.procs.forEach(function (p) { if (VERS[p.code] && p.version !== VERS[p.code]) set.push(P.SET(p.id, { 'Версия спецификации': VERS[p.code] })); });
            var ops = set.concat(del.map(function (id) { return { op: 'del', id: id }; }));
            if (!ops.length) { close(); P.toast('Демо уже в исходном состоянии'); return false; }
            P.batch(ops).then(function () { close(); P.toast('Демо возвращено: ' + set.length + ' записей восстановлено, ' + del.length + ' удалено'); P.rerender(render); }).catch(function (e) { P.toast(e.message, true); });
            return false;
        } }]);
    }
    P.mount(render);
})();
