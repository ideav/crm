/* Согласование правил: стороны голосуют за переход, отказа нет — только контрпредложение; после согласия всех переход действует с даты утверждения. */
(function () {
    'use strict';
    var P = window.Trk, C = P.core;
    function vote(M, tr, v, decision, counter) {
        return P.voteIds(tr).then(function (ids) {
            if (!ids[v.code]) throw new Error('Нет доступа к голосу «' + v.side + '»');
            return P.update(ids[v.code], C.votePatch(tr, decision, counter, P.TODAY));
        }).then(function () { return P.reload(); }).then(function (M2) {
            var t2 = M2.spec.trans.filter(function (t) { return t.code === tr.code; })[0];
            if (t2 && t2.st.state === 'effective' && t2.st.derived && P.isBA()) return fix(M2, t2);
        });
    }
    function fix(M, tr) { return P.update(tr.id, { 'Статус перехода': 'Действует', 'Действует с': tr.st.since || P.TODAY }).then(function () { return P.bumpSpec(M); }); }
    function counterDlg(M, tr, v) {
        var c = P.input('text', tr.cond || '', { placeholder: 'Например «Сумма заявки >= 1000000»' });
        P.modal('Контрпредложение', P.el('div', {}, [P.el('p', { text: tr.from + ' → ' + tr.to + ': предложите своё условие перехода. Отказа в процессе нет — есть своё предложение.' }), P.field('Условие', c)]),
            [{ text: 'Отмена' }, { text: 'Отправить', cls: 'trk-primary', fn: function () { P.run(vote(M, tr, v, 'Контрпредложение', c.value.trim()), 'Контрпредложение отправлено'); } }]);
    }
    function acceptCounter(M, tr) {
        var a = C.acceptCounter(tr, tr.st, P.TODAY);
        var p = P.update(tr.id, a.trans).then(function () { return P.voteIds(tr); }).then(function (ids) {
            return Promise.all(tr.st.votes.filter(function (v) { return v.code === tr.st.counter.code || v.side === 'Бизнес-администратор'; })
                .map(function (v) { return P.update(ids[v.code], { 'Решение стороны': 'Согласен', 'Версия голоса': a.trans['Версия предложения'], 'Контрпредложение': '', 'Дата голоса': P.TODAY }); }));
        });
        P.run(p, 'Версия ' + a.trans['Версия предложения'] + ': ' + C.condText(a.trans['Условие перехода']) + '. Остальные стороны голосуют заново');
    }
    function block(M, tr) {
        var st = tr.st, me = P.ctx.user, ba = P.isBA();
        var head = P.el('div', { 'class': 'trk-prop-h', html: '<b>' + P.esc(tr.code) + '</b> · ' + P.esc(tr.from) + ' → <b>' + P.esc(tr.to) + '</b>' + (tr.cond ? ' <span class="trk-muted">если ' + P.esc(C.condText(tr.cond)) + '</span>' : '') +
            ' · версия ' + st.version + ' ' + ({ effective: P.badge('действует с ' + C.toDmy(st.since), 'ok'), counter: P.badge('контрпредложение', 'warn'), proposed: P.badge('ждёт: ' + st.pending.join(', ').toLowerCase(), 'warn') }[st.state] || '') });
        var info = P.el('div', { 'class': 'trk-muted trk-small', text: 'Предложил ' + (tr.by || '—') + (tr.req ? ' по заявке ' + tr.req : '') + '. ' + (tr.why || '') });
        var rows = st.votes.map(function (v) {
            var cur = v.version === st.version, txt = !cur && v.decision !== 'Ждёт' ? 'голосовал за v' + v.version + ' — ждёт' : v.decision;
            var btns = [];
            if (v.login === me && (!cur || v.decision !== 'Согласен') && st.state !== 'effective') {
                btns.push(P.btn('Согласен', function () { P.run(vote(M, tr, v, 'Согласен'), 'Голос учтён'); }, 'trk-primary'));
                btns.push(P.btn('Контрпредложение', function () { counterDlg(M, tr, v); }));
            }
            return P.el('tr', {}, [P.el('td', { text: v.side }), P.el('td', { text: v.name }), P.el('td', { html: P.badge(txt + (cur && v.counter ? ': ' + C.condText(v.counter) : ''), cur && v.decision === 'Согласен' ? 'ok' : v.decision === 'Контрпредложение' && cur ? 'warn' : 'muted') }),
                P.el('td', { text: C.toDmy(v.date) }), P.el('td', {}, btns)]);
        });
        var acts = [];
        if (ba && st.state === 'counter') acts.push(P.btn('Принять контрпредложение', function () { acceptCounter(M, tr); }, 'trk-primary'));
        if (ba && st.state === 'effective' && st.derived) acts.push(P.btn('Зафиксировать в спецификации', function () { P.run(fix(M, tr), 'Переход действует с ' + C.toDmy(st.since)); }, 'trk-primary'));
        return P.el('div', { 'class': 'trk-prop' + (st.state === 'effective' ? ' trk-prop-ok' : '') }, [head, info,
            P.el('div', { 'class': 'trk-tablewrap' }, [P.el('table', { 'class': 'trk-table' }, [P.el('thead', {}, [P.el('tr', {}, ['Сторона', 'Кто', 'Решение', 'Дата', ''].map(function (h) { return P.el('th', { text: h }); }))]), P.el('tbody', {}, rows)])]),
            acts.length ? P.el('div', { 'class': 'trk-actions' }, acts) : null]);
    }
    P.mount(function (host, M) {
        var props = M.spec.trans.filter(function (t) { return t.code.indexOf('ПР-') === 0; }).sort(function (a, b) { return b.code.localeCompare(a.code); });
        var open = props.filter(function (t) { return t.st.state !== 'effective' || t.st.derived; }), done = props.filter(function (t) { return t.st.state === 'effective' && !t.st.derived; });
        var mine = open.filter(function (t) { return t.st.votes.some(function (v) { return v.login === P.ctx.user && (v.version !== t.st.version || v.decision !== 'Согласен'); }); });
        host.appendChild(P.el('div', {}, P.head('Согласование правил', 'Шаг встаёт в спецификацию, когда согласны стороны: передающий, принимающий и бизнес-администратор. Заявки тем временем идут исключениями.')));
        host.appendChild(P.el('div', { 'class': 'trk-kpis' }, [P.kpi('Висит у меня', String(mine.length), P.ctx.user, mine.length ? 'warn' : 'ok'), P.kpi('На согласовании', String(open.length)), P.kpi('Утверждено', String(done.length))]));
        host.appendChild(P.el('h2', { text: 'На согласовании' }));
        open.forEach(function (t) { host.appendChild(block(M, t)); });
        if (!open.length) host.appendChild(P.el('p', { 'class': 'trk-empty', text: 'Всё согласовано' }));
        host.appendChild(P.el('h2', { text: 'Утверждённые правила' }));
        done.forEach(function (t) { host.appendChild(block(M, t)); });
    });
})();
