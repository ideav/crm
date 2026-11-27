/* Сверка: очередь расхождений. Возраст, срок, ответственный; карточка с записями, предложение N:1, закрытие с основанием и проверка «четырёх глаз». */
(function () {
    'use strict';
    var P = window.Rc, C = P.core;
    var st = { tab: 'open', pair: '', reason: '', overdue: false };
    var host, M;
    var KIND = { 'Открыто': 'crit', 'На проверке': 'warn', 'Закрыто': 'ok' };

    function list() {
        return M.discs.filter(function (d) {
            if (st.tab === 'open' && d.status !== C.ST.OPEN) return false;
            if (st.tab === 'check' && d.status !== C.ST.CHECK) return false;
            if (st.tab === 'done' && d.status !== C.ST.DONE) return false;
            if (st.pair && d.pair !== st.pair) return false;
            if (st.reason && d.reason !== st.reason) return false;
            if (st.overdue && !C.isOverdue(d, P.TODAY)) return false;
            return true;
        }).sort(function (a, b) { return (C.isOverdue(b, P.TODAY) - C.isOverdue(a, P.TODAY)) || (a.found < b.found ? -1 : a.found > b.found ? 1 : 0) || Math.abs(b.diff) - Math.abs(a.diff); });
    }
    function recRow(code) { return M.recBy[code] || { code: code, side: '', date: '', amount: 0, cp: '(нет доступа к записи)', doc: '', purpose: '' }; }
    function recTable(codes) {
        return P.table([{ t: 'Запись', k: 'code' }, { t: 'Сторона', k: 'side' }, { t: 'Дата', html: function (r) { return P.esc(C.toDmy(r.date)); } }, { t: 'Сумма', num: 1, html: function (r) { return P.money(r.amount); } }, { t: 'Контрагент', k: 'cp' }, { t: 'П/п', k: 'doc' }, { t: 'Назначение', html: function (r) { return '<span class="rc-muted">' + P.esc(r.purpose) + '</span>'; } }], codes.map(recRow), { empty: 'Записей нет' });
    }
    /* Пул для предложения: непарные записи другой стороны той же пары. */
    function suggestion(d) {
        var side = d.recA.length && !d.recB.length ? 'Учёт' : !d.recA.length && d.recB.length ? 'Банк' : '';
        if (!side) return null;
        var x = recRow((d.recA[0] || d.recB[0])); if (!x.date) return null;
        var pool = M.recs.filter(function (r) { return r.pair === d.pair && r.side === side && r.status === 'Расхождение'; });
        var s = C.suggest(x, pool, { dayTol: 15, maxK: 4 });
        return s && Math.abs(s.diff) < 0.01 ? s : null;
    }
    function discsOf(codes) { return M.discs.filter(function (d) { return d.status === C.ST.OPEN && d.recA.concat(d.recB).some(function (c) { return codes.indexOf(c) >= 0; }); }); }
    function closeOps(d, basis) { return { op: 'set', id: d.id, fields: { 'Статус разбора': C.ST.CHECK, 'Основание закрытия': basis, 'Закрыл': P.ctx.user, 'Дата закрытия': P.TODAY } }; }
    function done(msg) { P.toast(msg); return P.model().then(function (m2) { M = m2; render(); }); }
    function card(d) {
        var body = P.el('div', {}), m;
        var age = C.ageDays(d.found, P.TODAY), over = C.isOverdue(d, P.TODAY), rs = M.reasons.filter(function (r) { return r.name === d.reason; })[0] || {};
        body.appendChild(P.el('div', { 'class': 'rc-grid2' }, [
            P.el('div', {}, [P.el('div', { 'class': 'rc-kv', html: '<span>Причина</span><span>' + P.badge(d.reason, 'crit') + '</span>' }), P.el('div', { 'class': 'rc-kv', html: '<span>Пара</span><span>' + P.esc(d.pair) + '</span>' }), P.el('div', { 'class': 'rc-kv', html: '<span>Контрагент</span><span>' + P.esc(d.cp) + '</span>' }), P.el('div', { 'class': 'rc-kv', html: '<span>Сумма / разница</span><span>' + P.money(d.amount) + ' / ' + P.money(d.diff) + '</span>' })]),
            P.el('div', {}, [P.el('div', { 'class': 'rc-kv', html: '<span>Выявлено</span><span>' + C.toDmy(d.found) + ' (' + age + ' дн.)</span>' }), P.el('div', { 'class': 'rc-kv', html: '<span>Срок разбора</span><span>' + (over ? '<b style="color:var(--p-red)">' + C.toDmy(d.due) + ', просрочено</b>' : C.toDmy(d.due)) + '</span>' }), P.el('div', { 'class': 'rc-kv', html: '<span>Ответственный</span><span>' + P.esc(d.resp) + '</span>' }), P.el('div', { 'class': 'rc-kv', html: '<span>Статус</span><span>' + P.badge(d.status, KIND[d.status]) + '</span>' })])]));
        if (rs.check) body.appendChild(P.el('p', { 'class': 'rc-muted', text: 'Что проверить: ' + rs.check + '. Обычное действие: ' + rs.action + '.' }));
        body.appendChild(recTable(d.recA.concat(d.recB)));
        var sg = d.status === C.ST.OPEN ? suggestion(d) : null;
        if (sg) {
            var box = P.el('div', { 'class': 'rc-sugg' }, [P.el('b', { text: 'Предлагаемое сопоставление ' + (sg.rows.length > 1 ? 'N:1' : '1:1') + ': ' + sg.rows.length + ' ' + (sg.rows.length > 1 ? 'записи' : 'запись') + ' на ' + P.money(sg.sum) + ', разница 0 ₽' }), P.el('p', { 'class': 'rc-muted', text: 'Даты вне окна автоматического правила, поэтому сопоставление предлагается человеку. Записи: ' + sg.rows.map(function (r) { return r.code + ' от ' + C.toDmy(r.date) + ' на ' + P.money(r.amount); }).join('; ') })]);
            if (P.canWrite('Расхождение') && C.closeErrors(d, 'Сопоставлено вручную', P.role, M.periods).length === 0) {
                box.appendChild(P.btn('Принять сопоставление и закрыть', function () {
                    var codes = sg.rows.map(function (r) { return r.code; }), all = d.recA.concat(d.recB).concat(codes), grp = 'ГР-' + d.code, basis = 'Сопоставлено вручную ' + (codes.length > 1 ? 'N:1' : '1:1') + ': ' + all.join(', ') + ' на ' + P.money(sg.sum);
                    var ops = [closeOps(d, basis)];
                    discsOf(codes).forEach(function (o) { if (o.id !== d.id) ops.push(closeOps(o, basis)); });
                    all.forEach(function (c) { var r = M.recBy[c]; if (r && P.canWrite('Запись сверки')) ops.push({ op: 'set', id: r.id, fields: { 'Статус сопоставления': 'Сопоставлено вручную', 'Группа сопоставления': grp } }); });
                    ops.push(P.logOp('Ручное сопоставление', d.code, basis));
                    P.batch(ops).then(function () { m.close(); return done('Сопоставлено и передано на проверку контролёру'); }).catch(function (e) { P.toast(e.message, true); });
                }, 'rc-primary'));
            }
            body.appendChild(box);
        }
        if (d.basis) body.appendChild(P.el('p', { html: '<b>Основание:</b> ' + P.esc(d.basis) + ' <span class="rc-muted">(закрыл ' + P.esc(d.closedBy) + ' ' + C.toDmy(d.closedAt) + (d.checkedBy ? ', проверил ' + P.esc(d.checkedBy) + ' ' + C.toDmy(d.checkedAt) : '') + ')</span>' }));
        var btns = [{ text: 'Закрыть окно' }];
        if (d.status === C.ST.OPEN && P.canWrite('Расхождение')) {
            var ta = P.el('textarea', { 'class': 'rc-ta', placeholder: 'Основание: документ 1С, письмо банка, номер проводки' }), err = P.el('div', {});
            body.appendChild(P.field('Закрыть с основанием', ta)); body.appendChild(err);
            btns.push({ text: 'Закрыть и передать на проверку', cls: 'rc-primary', keep: true, fn: function () {
                var e = C.closeErrors(d, ta.value, P.role, M.periods); err.innerHTML = '';
                if (e.length) { e.forEach(function (t) { err.appendChild(P.el('div', { 'class': 'rc-warnbox rc-e', text: t })); }); return false; }
                P.batch([closeOps(d, ta.value.trim()), P.logOp('Закрытие расхождения', d.code, ta.value.trim())]).then(function () { m.close(); return done('Закрыто, ждёт проверки контролёра'); }).catch(function (x) { P.toast(x.message, true); });
                return false;
            } });
        }
        if (d.status === C.ST.CHECK && P.role === 'controller' && P.canWrite('Расхождение')) {
            var ae = C.approveErrors(d, P.ctx.user, P.role, M.periods);
            if (ae.length) body.appendChild(P.el('div', { 'class': 'rc-warnbox rc-w', text: ae.join('; ') }));
            btns.push({ text: 'Вернуть в работу', fn: function () { P.batch([{ op: 'set', id: d.id, fields: { 'Статус разбора': C.ST.OPEN, 'Закрыл': '', 'Дата закрытия': '' } }, P.logOp('Возврат в работу', d.code, 'Основание не принято: ' + d.basis)]).then(function () { return done('Возвращено ответственному'); }); } });
            if (!ae.length) btns.push({ text: 'Подтвердить закрытие', cls: 'rc-primary', fn: function () { P.batch([{ op: 'set', id: d.id, fields: { 'Статус разбора': C.ST.DONE, 'Проверил': P.ctx.user, 'Дата проверки': P.TODAY } }, P.logOp('Проверка закрытия', d.code, 'Подтверждено (четыре глаза)')]).then(function () { return done('Закрытие подтверждено'); }); } });
        }
        m = P.modal('Расхождение ' + d.code, body, btns, true);
    }

    function render() {
        host.innerHTML = '';
        var mine = P.role === 'operator';
        P.head('Расхождения', (mine ? 'Ваши расхождения' : 'Все расхождения') + ' по парам сверки: возраст, срок разбора и ответственный. Ничто не закрывается молча: закрытие требует основания, а подтверждает его другой человек (контролёр).').forEach(function (n) { host.appendChild(n); });
        var open = M.discs.filter(function (d) { return d.status === C.ST.OPEN; }), over = M.discs.filter(function (d) { return C.isOverdue(d, P.TODAY); }), chk = M.discs.filter(function (d) { return d.status === C.ST.CHECK; });
        var sum = function (a) { return a.reduce(function (s, d) { return s + Math.abs(d.diff); }, 0); };
        host.appendChild(P.el('div', { 'class': 'rc-kpis' }, [
            P.kpi('Открыто', String(open.length), 'на ' + P.short(sum(open)), open.length ? 'warn' : 'good'),
            P.kpi('Просрочено', String(over.length), over.length ? 'старшее - ' + Math.max.apply(null, over.map(function (d) { return C.ageDays(d.found, P.TODAY); })) + ' дн., ' + P.short(sum(over)) : 'в срок', over.length ? 'bad' : 'good'),
            P.kpi('На проверке', String(chk.length), 'ждут контролёра'),
            P.kpi('Закрыто в ноябре', String(M.discs.filter(function (d) { return d.status === C.ST.DONE && d.found >= '2026-11-01'; }).length), 'с основанием и подписью проверяющего', 'good')]));
        host.appendChild(P.tabs([['open', 'Открытые'], ['check', 'На проверке'], ['done', 'Закрытые'], ['all', 'Все']], st.tab, function (t) { st.tab = t; render(); }));
        var ps = P.select([['', 'Все пары']].concat(M.pairs.map(function (p) { return [p.name, p.name]; })), st.pair); ps.onchange = function () { st.pair = ps.value; render(); };
        var rs = P.select([['', 'Все причины']].concat(M.reasons.map(function (r) { return [r.name, r.name]; })), st.reason); rs.onchange = function () { st.reason = rs.value; render(); };
        var ov = P.el('input', { type: 'checkbox' }); ov.checked = st.overdue; ov.onchange = function () { st.overdue = ov.checked; render(); };
        host.appendChild(P.el('div', { 'class': 'rc-bar' }, [P.field('Пара сверки', ps), P.field('Причина', rs), P.el('label', { 'class': 'rc-muted' }, [ov, ' только просроченные'])]));
        var rows = list();
        host.appendChild(P.table([
            { t: 'Код', k: 'code' }, { t: 'Причина', html: function (d) { return P.badge(d.reason, d.reason === C.REASONS.FEE ? 'warn' : 'crit'); } },
            { t: 'Контрагент', k: 'cp' }, { t: 'Дата операции', html: function (d) { return C.toDmy(d.date); } },
            { t: 'Разница', num: 1, html: function (d) { return P.money(d.diff); } },
            { t: 'Возраст', num: 1, html: function (d) { var a = C.ageDays(d.found, P.TODAY); return a + ' дн. <span class="rc-muted">' + C.ageBucket(a) + '</span>'; } },
            { t: 'Срок', html: function (d) { return C.isOverdue(d, P.TODAY) ? '<b style="color:var(--p-red)">' + C.toDmy(d.due) + '</b>' : C.toDmy(d.due); } },
            { t: 'Ответственный', k: 'resp' }, { t: 'Статус', html: function (d) { return P.badge(d.status, KIND[d.status]); } }
        ], rows, { onrow: card, rowCls: function (d) { return C.isOverdue(d, P.TODAY) ? 'rc-row-bad' : ''; }, empty: 'Расхождений нет' }));
        var h = P.hash(); if (h.d) { var d = M.discs.filter(function (x) { return x.code === h.d; })[0]; if (d) { history.replaceState(null, '', location.pathname); card(d); } }
    }
    P.mount(function (h, m) { host = h; M = m; render(); });
})();
