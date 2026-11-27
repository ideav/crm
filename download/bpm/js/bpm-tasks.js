/* BPM: Мои задачи - единый список со сроком и контекстом, форма шага, «нестандартный случай», замещение и передача. */
(function () {
    'use strict';
    var P = window.Bpm, C = P.core;
    var state = { who: '' };
    function decisionsOf(M, step) {
        var vals = [];
        C.outgoing(M.spec, step).forEach(function (t) { C.parseCond(t.cond).forEach(function (c) { if (c.field === 'Решение' && c.op === '=' && vals.indexOf(c.value) < 0) vals.push(c.value); }); });
        if (!vals.length) vals = ['Отправлено'];
        var st = M.spec.steps[step];
        if (!(st && st.start)) vals.push('Нестандартный случай');
        return vals;
    }
    function render(host, M) {
        var me = P.ctx.user, boss = M.isOwner;
        if (!state.who) state.who = me;
        host.appendChild(P.el('div', {}, P.head('Мои задачи', 'Все задачи на мне — со сроком и данными заявки. Решение по форме; случай, которого нет в маршруте, — кнопкой «Нестандартный случай» с комментарием: заявка не встанет молча.')));
        var open = M.reqs.filter(function (r) { return !r.done && r.exec; });
        var mineL = function (login) { return open.filter(function (r) { return C.holder(r.exec, M.empByLogin, M.subs, M.today).who === login; }); };
        if (boss) {
            var who = P.select(M.emps.map(function (e) { return [e.login, P.short(e.name) + ' — ' + e.pos]; }), state.who);
            who.onchange = function () { state.who = who.value; host.innerHTML = ''; render(host, M); };
            host.appendChild(P.el('div', { 'class': 'bpm-bar' }, [P.field('Чьи задачи (владелец процесса видит всех)', who)]));
        }
        var list = mineL(state.who).sort(function (a, b) { return (a.status === 'Ждёт решения' ? -1 : 0) - (b.status === 'Ждёт решения' ? -1 : 0) || (a.entered < b.entered ? -1 : 1); });
        var subsMine = M.subs.filter(function (s) { return s.sub === state.who && s.from <= M.today && s.to >= M.today; });
        if (subsMine.length) host.appendChild(P.el('div', { 'class': 'bpm-warnbox bpm-w', text: 'Замещение: ' + subsMine.map(function (s) { return 'за ' + P.who(s.emp) + ' с ' + P.d(s.from) + ' по ' + P.d(s.to); }).join('; ') + '. Его задачи — в этом списке с пометкой.' }));
        host.appendChild(P.table([
            { t: 'Заявка', html: function (r) { return '<b>' + P.esc(r.n) + '</b><br><span class="bpm-muted">' + P.esc(r.proc) + '</span>'; } },
            { t: 'Задача', html: function (r) { var h = C.holder(r.exec, M.empByLogin, M.subs, M.today); return (r.status === 'Ждёт решения' ? P.badge('решить неопределённость', 'crit') + ' ' : '') + P.esc(r.at) + (h.via ? '<br>' + P.badge('за ' + P.who(h.via), 'warn') : ''); } },
            { t: 'Предмет', html: function (r) { return P.esc(r.subj) + '<br><span class="bpm-muted">' + P.esc(r.cp) + '</span>'; } },
            { t: 'Сумма', num: true, html: function (r) { return P.esc(P.money(r.sum, r.cur)); } },
            { t: 'Получена', html: function (r) { var d = C.workDays(r.entered, M.today, M.hol), st = M.spec.steps[r.at] || {}, n = Math.ceil(C.num(st.norm) / 8) || 1; return P.d(r.entered) + '<br>' + (d > n ? P.badge(d + ' дн., норма ' + n, 'crit') : '<span class="bpm-muted">' + d + ' дн.</span>'); } }
        ], list, { onrow: function (r) { if (r.status === 'Ждёт решения') P.openReq(r, again); else if (r.status === 'Ошибка интеграции') location.href = P.nav('integrations', 'r=' + encodeURIComponent(r.n)); else form(M, r); }, rowCls: function (r) { return r.status === 'Ждёт решения' ? 'bpm-row-bad' : ''; }, empty: 'Задач нет' }));
        var done = M.tasks.filter(function (t) { return t.who === state.who; }).sort(function (a, b) { return a.to < b.to ? 1 : -1; }).slice(0, 8);
        if (done.length) {
            host.appendChild(P.el('h2', { text: 'Недавно решённые' }));
            host.appendChild(P.table([{ k: 'req', t: 'Заявка' }, { k: 'step', t: 'Шаг' }, { t: 'Решение', html: function (t) { return P.badge(t.dec, t.dec === 'Возвращено' || t.dec === 'Отклонено' ? 'warn' : 'ok') + (t.via ? ' ' + P.badge('за ' + P.who(t.via), 'mute') : ''); } }, { t: 'Дата', html: function (t) { return P.d(t.to); } }, { k: 'com', t: 'Комментарий' }], done));
        }
        if (boss) hanging(host, M, open);
    }
    function again() { P.rerender(render); }
    /* Владелец видит задачи отсутствующих без замещения и передаёт их. */
    function hanging(host, M, open) {
        var hang = open.filter(function (r) { return r.status === 'В работе' && C.holder(r.exec, M.empByLogin, M.subs, M.today).hanging; });
        if (!hang.length) return;
        host.appendChild(P.el('h2', { text: 'Висят у отсутствующих (' + hang.length + ')' }));
        host.appendChild(P.el('p', { 'class': 'bpm-sub', text: 'Исполнитель в отпуске, замещение не оформлено. Передайте задачу или оформите замещение — заявки пойдут дальше.' }));
        host.appendChild(P.table([{ k: 'n', t: 'Заявка' }, { k: 'at', t: 'Шаг' }, { t: 'Исполнитель', html: function (r) { var e = M.empByLogin[r.exec]; return P.esc(P.who(r.exec)) + (e ? '<br><span class="bpm-muted">отсутствует ' + P.d(e.absFrom) + '–' + P.d(e.absTo) + '</span>' : ''); } }, { t: 'На шаге', num: true, html: function (r) { return C.workDays(r.entered, M.today, M.hol) + ' дн.'; } },
            { t: '', html: function () { return '<span class="bpm-cta">Передать →</span>'; } }], hang, { onrow: function (r) { delegate(M, r); }, rowCls: function () { return 'bpm-row-warn'; } }));
    }
    function delegate(M, r) {
        var cands = M.emps.filter(function (e) { return e.login !== r.exec && !C.absentOn(e, M.today); }).map(function (e) { return [e.login, P.short(e.name) + ' — ' + e.pos]; });
        var to = P.select(cands, 'isokolova'), ab = M.empByLogin[r.exec], why = P.input('textarea', P.who(r.exec) + ' отсутствует' + (ab && ab.absTo ? ' до ' + P.d(ab.absTo) : '') + ', замещение не оформлено');
        P.modal('Передать ' + r.n + ' («' + r.at + '»)', P.el('div', {}, [P.field('Кому', to), P.field('Причина', why)]), [{ text: 'Отмена' }, { text: 'Передать', cls: 'bpm-primary', keep: true, fn: function (close) {
            if (why.value.trim().length < 5) { P.toast('Нужна причина', true); return false; }
            P.batch([P.SET(r.id, { 'Текущий исполнитель': to.value }), P.NEW('Событие журнала', { 'Событие журнала': P.nextNo(M.events.map(function (e) { return e.n; }), 'Ж-', 5), 'Заявка': r.n, 'Дата события': M.today, 'Время события': P.now(), 'Код события': 'Передача задачи', 'Шаг процесса': r.at, 'Автор события': P.ctx.user, 'Причина события': 'Задача передана от ' + P.who(r.exec) + ' к ' + P.who(to.value) + ': ' + why.value.trim(), 'Инициатор заявки': r.init })])
                .then(function () { close(); P.toast('Задача ' + r.n + ' передана: ' + P.who(to.value)); again(); }).catch(function (e) { P.toast(e.message, true); });
            return false;
        } }]);
    }
    function form(M, r) {
        var st = M.spec.steps[r.at] || {}, decs = decisionsOf(M, r.at), cur = decs[0];
        var fields = String(st.form || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        var com = P.input('textarea', '', { placeholder: 'Комментарий (обязателен для возврата и нестандартного случая)' });
        var prev = P.el('div', { 'class': 'bpm-preview' }), radios = P.el('div', { 'class': 'bpm-decisions' });
        function draw() {
            radios.innerHTML = '';
            decs.forEach(function (d) { radios.appendChild(P.btn(d, function () { cur = d; draw(); }, (d === cur ? 'bpm-primary ' : '') + (d === 'Нестандартный случай' ? 'bpm-odd' : ''))); });
            var p = C.plan(M.spec, r, r.at, cur), m = p.matches && p.matches[0];
            prev.className = 'bpm-warnbox ' + (p.stuck ? 'bpm-e' : 'bpm-g');
            prev.innerHTML = p.manual ? 'Заявка уйдёт ответственному (' + P.esc(P.who(P.ownerOf(r.proc))) + ') как неопределённость с вашим комментарием; он выберет шаг по похожим случаям.'
                : p.stuck ? '<b>Перехода нет.</b> Для этой заявки (' + P.esc(C.featuresOf(r)) + ') спецификация не знает, куда идти после «' + P.esc(r.at) + '». Заявка не упадёт в инцидент: уйдёт ответственному как неопределённость.'
                : 'Дальше: <b>' + P.esc(p.to) + '</b>' + (m && m.cond ? ' <span class="bpm-muted">(условие: ' + P.esc(m.cond) + (/^Правка/.test(m.source || '') ? '; ' + P.esc(m.source) : '') + ')</span>' : '') + (p.to ? ' — ' + P.esc(P.who(P.execOf(p.to, r))) : '');
        }
        draw();
        var body = P.el('div', {}, [
            P.el('div', { 'class': 'bpm-kv', html: '<span>Заявка</span><span><b>' + P.esc(r.n) + '</b> · ' + P.esc(r.subj) + '</span>' }),
            P.el('div', { 'class': 'bpm-kv', html: '<span>Контрагент</span><span>' + P.esc(r.cp) + (r.nonres ? ' ' + P.badge('нерезидент', 'warn') : '') + '</span>' }),
            P.el('div', { 'class': 'bpm-kv', html: '<span>Сумма</span><span>' + P.esc(P.money(r.sum, r.cur)) + '</span>' }),
            fields.length ? P.el('div', { 'class': 'bpm-formfields' }, [P.el('h3', { text: 'Форма шага «' + r.at + '»' })].concat(fields.map(function (f) { return P.field(f, P.input('text', '', { placeholder: f })); }))) : null,
            P.el('h3', { text: 'Решение' }), radios, prev, P.field('Комментарий', com),
            P.el('details', {}, [P.el('summary', { text: 'Журнал заявки' }), P.timeline(M, r)])
        ]);
        P.modal(r.at + ' · ' + r.n, body, [{ text: 'Отмена' }, { text: 'Принять решение', cls: 'bpm-primary', keep: true, fn: function (close) {
            var err = C.checkDecision(cur, com.value); if (err.length) { P.toast(err.join('; '), true); return false; }
            P.decide(r, cur, com.value.trim()).then(function (p) {
                close(); P.toast(p.stuck ? r.n + ': неопределённость передана ответственному' : r.n + ' → ' + p.to); again();
            }).catch(function (e) { P.toast(e.message, true); });
            return false;
        } }], true);
    }
    P.mount(render);
})();
