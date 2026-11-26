/* MES: пульт мастера — очередь участка, горящие заказы, факт смены и приёмка отметок. */
(function () {
    'use strict';
    var P = window.Mes, C = P.core;
    P.mount(function (host, M) {
        var all = !M.mySection || P.ctx.role === 'Начальник производства' || P.ctx.role === 'admin';
        var secs = M.sections.filter(function (s) { return all || s.name === M.mySection; });
        var h = P.hash(), sec = (secs.filter(function (s) { return s.name === h.sec; })[0] || secs.filter(function (s) { return s.name === M.mySection; })[0] || secs[0] || {}).name;
        var S = M.sections.filter(function (s) { return s.name === sec; })[0] || {};
        P.head('Пульт мастера', (sec || 'Участок') + (S.master ? ' · мастер ' + S.master : '') + ' · ' + C.toRu(M.today) + ', смена 08:00–16:30').forEach(function (n) { host.appendChild(n); });
        if (secs.length > 1) host.appendChild(P.tabs(secs.map(function (s) { return [s.name, s.name]; }), sec, function (v) { location.hash = 'sec=' + encodeURIComponent(v); P.redraw(); }));

        var queue = M.tasks.filter(function (t) { return t.section === sec && t.state !== C.STATE.done; }).sort(function (a, b) { return a.queue - b.queue; });
        var fc = {}; queue.forEach(function (t) { if (!fc[t.order]) fc[t.order] = P.forecast(M, t.order); });
        var loadMin = queue.reduce(function (a, t) { return a + (M.rem[t.no] || 0); }, 0);
        var hot = []; queue.forEach(function (t) { var o = M.orderBy[t.order]; if (o && P.isHot(M, o) && !hot.some(function (x) { return x.order === t.order; })) hot.push(t); });
        var marksToday = M.marks.filter(function (m) { return m.section === sec && m.date === M.today; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
        var toAccept = M.marks.filter(function (m) { return m.section === sec && (m.accept === 'Ожидает' || m.accept === 'Спор'); });
        var downsToday = M.downs.filter(function (d) { return d.section === sec && d.date === M.today; });
        var canQ = P.canWrite('Сменное задание'), canAcc = P.canWrite('Отметка выработки');

        host.appendChild(P.el('div', { 'class': 'mes-kpis' }, [
            P.kpi('Заданий в очереди', String(queue.length), P.hours(loadMin) + ' по нормам ≈ ' + P.fmt(loadMin / (M.cap[sec] || 1), 1) + ' смены участка'),
            P.kpi('Горящие заказы', String(hot.length), 'срок ≤ ' + M.rules.hotDays + ' раб. дн.', hot.length ? 'bad' : 'good'),
            P.kpi('Отметки к приёмке', String(toAccept.length), toAccept.filter(function (m) { return m.accept === 'Спор'; }).length + ' спорных', toAccept.length ? 'warn' : ''),
            P.kpi('Простой сегодня', downsToday.reduce(function (a, d) { return a + d.mins; }, 0) + ' мин', downsToday.length ? downsToday.map(function (d) { return d.reason; }).join(', ') : 'нет', downsToday.length ? 'warn' : '')
        ]));

        function raise(t, everywhere) {
            var ops = [];
            var list = P.orderTasks(M, t.order).filter(function (x) { return x.state !== C.STATE.done && (everywhere || x.section === t.section); });
            var pos = {}; list.forEach(function (x) {
                var q = M.tasks.filter(function (y) { return y.section === x.section && y.state !== C.STATE.done; }).map(function (y) { var n = ops.filter(function (o) { return o.no === y.no; }).pop(); return n ? { no: y.no, queue: n.queue } : y; });
                pos[x.section] = (pos[x.section] || 0) + 1;
                C.reorder(q, x.no, pos[x.section]).forEach(function (c) { ops.push({ no: c.no, queue: c.queue }); });
            });
            ops = ops.map(function (c) { return { op: 'set', id: M.taskBy[c.no].id, fields: { 'Очередь': c.queue } }; });
            if (!ops.length) return P.toast('Задание уже первое в очереди');
            P.batch(ops).then(function () { P.toast('Очередь пересчитана: ' + t.order + (everywhere ? ' первым на всех участках' : ' первым на участке')); P.redraw(); }).catch(function (e) { P.toast(e.message, true); });
        }
        function move(t, pos) {
            var ops = C.reorder(queue, t.no, pos).map(function (c) { return { op: 'set', id: M.taskBy[c.no].id, fields: { 'Очередь': c.queue } }; });
            if (ops.length) P.batch(ops).then(function () { P.redraw(); }).catch(function (e) { P.toast(e.message, true); });
        }
        hot.forEach(function (t) {
            var o = M.orderBy[t.order], f = fc[t.order], pos = queue.indexOf(t) + 1;
            var txt = '<b>Горит: ' + P.esc(o.no) + '</b> · ' + P.esc(o.product) + ' × ' + o.qty + ' · ' + P.esc(o.cust) + ' · срок <b>' + C.toRu(o.due) + '</b>. ' + P.esc(t.op) + ' — ' + pos + '-е место в очереди участка. ' +
                (f ? (f.late ? 'По нормам и очереди выйдет <b>' + C.toRu(f.finish) + '</b> — не успевает.' : 'По нормам и очереди выйдет ' + C.toRu(f.finish) + ' — успевает.') : '');
            var box = P.note(txt, f && f.late ? 'bad' : 'ok');
            if (canQ && f && f.late) {
                box.appendChild(P.btn('Поднять первым на участке', function () { raise(t, false); }, 'mes-primary mes-small'));
                if (all) box.appendChild(P.btn('Первым на всех участках', function () { raise(t, true); }, 'mes-small'));
            }
            host.appendChild(box);
        });

        host.appendChild(P.el('h2', { text: 'Очередь участка' }));
        host.appendChild(P.table([
            { t: '№', num: true, html: function (r) { return String(queue.indexOf(r) + 1); } },
            { t: 'Задание', html: function (r) { return '<b>' + P.esc(r.no) + '</b><br><small>' + P.esc(r.order) + '</small>'; } },
            { t: 'Изделие', k: 'product' },
            { t: 'Операция', html: function (r) { return P.esc(r.op) + '<br><small>шаг ' + r.step + ' из ' + C.routeOf(M.steps, r.product).length + '</small>'; } },
            { t: 'План', num: true, k: 'plan' },
            { t: 'Годных / брак', num: true, html: function (r) { var p = M.prog[r.no] || { good: 0, bad: 0 }; return p.good + (p.bad ? ' / <span class="mes-red">' + p.bad + '</span>' : ''); } },
            { t: 'Доступно', num: true, html: function (r) { var a = P.avail(M, r); return a ? String(a) : '<span class="mes-muted" title="Предыдущая операция ещё не отдала детали">ждёт вход</span>'; } },
            { t: 'Остаток', num: true, html: function (r) { return P.hours(M.rem[r.no] || 0); } },
            { t: 'Состояние', html: function (r) { return P.stateBadge(r.state) + (r.worker ? '<br><small>' + P.esc(r.worker.split(' ').slice(0, 2).join(' ')) + (r.started ? ', с ' + P.esc(r.started) : '') + '</small>' : ''); } },
            { t: 'Срок', html: function (r) { return r.due ? C.toRu(r.due) : ''; } },
            { t: 'Прогноз выхода', html: function (r) { var f = fc[r.order]; return f ? (f.late ? P.badge(C.toRu(f.finish), 'crit') : P.badge(C.toRu(f.finish), 'ok')) : ''; } },
            { t: '', node: function (r) {
                if (!canQ) return null; var i = queue.indexOf(r);
                return P.el('span', { 'class': 'mes-acts' }, [P.btn('▲', function () { move(r, i); }, 'mes-small', { title: 'Выше', disabled: i === 0 }), P.btn('▼', function () { move(r, i + 2); }, 'mes-small', { title: 'Ниже', disabled: i === queue.length - 1 }), i > 0 ? P.btn('Первым', function () { raise(r, false); }, 'mes-small') : null]);
            } }
        ], queue, { rowCls: function (r) { var o = M.orderBy[r.order]; return o && P.isHot(M, o) ? 'mes-row-hot' : ''; }, empty: 'Очередь пуста' }));

        host.appendChild(P.el('h2', { text: 'Факт смены: отметки рабочих' }));
        var accBtn = canAcc && toAccept.length ? P.btn('Принять все без спора (' + toAccept.filter(function (m) { return m.accept === 'Ожидает'; }).length + ')', function () {
            var ops = toAccept.filter(function (m) { return m.accept === 'Ожидает'; }).map(function (m) { return { op: 'set', id: m.id, fields: { 'Приёмка мастером': 'Принято' } }; });
            P.batch(ops).then(function () { P.toast('Отметки приняты: заработок рабочих пересчитан'); P.redraw(); }).catch(function (e) { P.toast(e.message, true); });
        }, 'mes-primary') : null;
        if (accBtn) host.appendChild(P.el('div', { 'class': 'mes-bar' }, [accBtn, P.el('span', { 'class': 'mes-muted', text: 'Принятое мастером идёт в сдельную к выплате; спорное — до разбора.' })]));
        var feed = toAccept.filter(function (m) { return m.date !== M.today; }).concat(marksToday);
        host.appendChild(P.table([
            { t: 'Дата', html: function (r) { return C.toShort(r.date) + ' ' + P.esc(r.at); } },
            { t: 'Рабочий', k: 'worker' },
            { t: 'Задание', html: function (r) { var t = M.taskBy[r.task] || {}; return P.esc(r.task) + '<br><small>' + P.esc(t.op || '') + ' · ' + P.esc(t.product || '') + '</small>'; } },
            { t: 'Годных', num: true, k: 'good' },
            { t: 'Брак', num: true, html: function (r) { return r.bad ? '<span class="mes-red">' + r.bad + '</span><br><small>' + P.esc(r.culprit) + '</small>' : '0'; } },
            { t: 'Приёмка', html: function (r) { return P.badge(r.accept, { 'Принято': 'ok', 'Ожидает': 'warn', 'Спор': 'crit' }[r.accept] || 'mute'); } },
            { t: '', node: function (r) {
                if (!canAcc || r.accept === 'Принято') return null;
                return P.el('span', { 'class': 'mes-acts' }, [P.btn('Принять', function () { P.update(r.id, { 'Приёмка мастером': 'Принято' }).then(function () { P.redraw(); }).catch(function (e) { P.toast(e.message, true); }); }, 'mes-small'),
                    r.bad ? P.btn('Брак не по вине', function () { P.update(r.id, { 'Виновник брака': 'Предыдущий участок', 'Приёмка мастером': 'Принято' }).then(function () { P.toast('Брак оплачен как годные (ст. 156 ТК)'); P.redraw(); }).catch(function (e) { P.toast(e.message, true); }); }, 'mes-small') : null]);
            } }
        ], feed, { empty: 'Сегодня отметок нет', rowCls: function (r) { return r.accept === 'Спор' ? 'mes-row-warn' : ''; } }));
        if (downsToday.length) {
            host.appendChild(P.el('h2', { text: 'Простои сегодня' }));
            host.appendChild(P.table([{ t: 'С', k: 'at' }, { t: 'Рабочий', k: 'worker' }, { t: 'Причина', html: function (r) { return P.esc(r.reason) + '<br><small>' + P.esc(M.reasonKind[r.reason] || '') + '</small>'; } }, { t: 'Минут', num: true, k: 'mins' }], downsToday));
        }
    });
})();
