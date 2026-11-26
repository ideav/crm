/* MES: выработка по людям и операциям, сдельный заработок по расценкам, выгрузка наряда в 1С. */
(function () {
    'use strict';
    var P = window.Mes, C = P.core;
    P.mount(function (host, M) {
        var h = P.hash(), per = h.p || 'month';
        var secs = M.sections.filter(function (s) { return M.workers.some(function (w) { return w.section === s.name; }); });
        var sec = h.sec || (M.mySection && !/Начальник|Нормировщик|admin/.test(P.ctx.role) ? M.mySection : '');
        var from = per === 'today' ? M.today : per === 'week' ? C.addDays(M.today, -3) : P.MONTH_FROM, to = M.today;
        P.head('Выработка и сдельная', 'Кто, какую операцию и сколько сделал, сколько за это начислено по расценкам. Расчёт виден сразу после отметки на терминале; к выплате идёт принятое мастером.').forEach(function (n) { host.appendChild(n); });
        function go(o) { var x = Object.assign({ p: per, sec: sec }, o); location.hash = 'p=' + x.p + '&sec=' + encodeURIComponent(x.sec || ''); P.redraw(); }
        var secSel = P.select([['', 'Все участки']].concat(secs.map(function (s) { return [s.name, s.name]; })), sec); secSel.addEventListener('change', function () { go({ sec: secSel.value }); });
        host.appendChild(P.tabs([['today', 'Смена ' + C.toShort(M.today)], ['week', 'Неделя 23–26.11'], ['month', 'Ноябрь (1–26)']], per, function (v) { go({ p: v }); }));
        host.appendChild(P.el('div', { 'class': 'mes-bar' }, [P.field('Участок', secSel)]));
        var workers = M.workers.filter(function (w) { return !sec || w.section === sec; });
        var rows = C.earnings({ marks: M.marks, downs: M.downs, taskBy: M.taskBy, workers: workers, rates: M.rates, reasonKind: M.reasonKind, rules: M.rules, from: from, to: to })
            .filter(function (r) { return workers.some(function (w) { return w.name === r.worker; }); })
            .sort(function (a, b) { return b.total + b.pending - a.total - a.pending; });
        var wBy = P.map(M.workers, 'name');
        var sum = function (k) { return rows.reduce(function (a, r) { return a + r[k]; }, 0); };
        host.appendChild(P.el('div', { 'class': 'mes-kpis' }, [
            P.kpi('К выплате (принято)', P.money(sum('total')), 'сдельно ' + P.money(sum('paid')) + ' + простой ' + P.money(sum('idlePay')), 'good'),
            P.kpi('Ждёт приёмки мастером', P.money(sum('pending')), 'видно рабочему сразу, к выплате — после приёмки', sum('pending') ? 'warn' : ''),
            P.kpi('Спорные начисления', P.money(sum('dispute')), 'отметки со статусом «Спор»', sum('dispute') ? 'bad' : ''),
            P.kpi('Простой не по вине рабочих', P.hours(rows.reduce(function (a, r) { return a + r.idleMin; }, 0)), 'оплачен ' + Math.round(M.rules.idleShare * 100) + '% ставки (ст. 157 ТК)'),
            P.kpi('Брак по вине рабочих', P.money(sum('badLoss')), 'не оплачен (ст. 156 ТК)')
        ]));
        host.appendChild(P.el('h2', { text: 'По людям' }));
        host.appendChild(P.table([
            { t: 'ТН', html: function (r) { return P.esc((wBy[r.worker] || {}).num); } },
            { t: 'Рабочий', html: function (r) { return '<b>' + P.esc(r.worker) + '</b><br><small>' + P.esc((wBy[r.worker] || {}).section) + ', ' + (wBy[r.worker] || {}).grade + ' р.</small>'; } },
            { t: 'Годных', num: true, k: 'good' },
            { t: 'Брак', num: true, html: function (r) { return r.bad ? '<span class="mes-red">' + r.bad + '</span>' : '0'; } },
            { t: 'Норма-часы', num: true, html: function (r) { return P.fmt(r.normMin / 60, 1); } },
            { t: 'Сдельно', num: true, html: function (r) { return P.money(r.paid); } },
            { t: 'Простой', num: true, html: function (r) { return r.idleMin ? r.idleMin + ' мин<br><small>' + P.money(r.idlePay) + '</small>' : '—'; } },
            { t: 'Ждёт приёмки', num: true, html: function (r) { return r.pending ? P.money(r.pending) : '—'; } },
            { t: 'Спор', num: true, html: function (r) { return r.dispute ? '<span class="mes-red">' + P.money(r.dispute) + '</span>' : '—'; } },
            { t: 'К выплате', num: true, html: function (r) { return '<b>' + P.money(r.total) + '</b>'; } }
        ], rows, { onrow: function (r) { detail(r); }, rowCls: function (r) { return r.dispute ? 'mes-row-warn' : ''; } }));
        host.appendChild(P.el('p', { 'class': 'mes-muted', text: 'Нажмите на строку — разбивка по операциям и изделиям, как в сдельном наряде.' }));

        var ops = {}; rows.forEach(function (r) { Object.keys(r.lines).forEach(function (k) { var l = r.lines[k], x = ops[l.op] || (ops[l.op] = { op: l.op, qty: 0, sum: 0, people: {} }); x.qty += l.qty; x.sum += l.sum; x.people[r.worker] = 1; }); });
        var opRows = M.ops.map(function (o) { return ops[o.name]; }).filter(Boolean);
        host.appendChild(P.el('h2', { text: 'По операциям' }));
        host.appendChild(P.table([{ t: 'Операция', k: 'op' }, { t: 'Участок', html: function (r) { return P.esc(M.opSection[r.op]); } }, { t: 'Штук к оплате', num: true, k: 'qty' }, { t: 'Человек', num: true, html: function (r) { return String(Object.keys(r.people).length); } }, { t: 'Начислено', num: true, html: function (r) { return P.money(r.sum); } }], opRows));

        var period = C.toRu(from) + '–' + C.toRu(to);
        var bar = P.el('div', { 'class': 'mes-bar' }, [P.btn('Сдельный наряд для 1С (CSV)', function () { P.download('sdelny-naryad-' + from + '-' + to + '.csv', C.onecRows(rows, M.workers, period).join('\r\n')); }, 'mes-primary')]);
        if (P.canWrite('Выгрузка в 1С') && M.exports) bar.appendChild(P.btn('Отметить: наряд передан в 1С', function () {
            P.create('Выгрузка в 1С', { 'Выгрузка в 1С': P.nextNo(M.exports, 'ОБ-', 4), 'Документ 1С': 'Сдельный наряд ' + period + (sec ? ', ' + sec : ''), 'Дата смены': M.today, 'Результат обмена': 'Отправлено', 'Кто выгрузил': P.ctx.user }).then(function () { P.toast('Наряд отмечен в журнале обмена с 1С'); P.redraw(); }).catch(function (e) { P.toast(e.message, true); });
        }));
        host.appendChild(bar);
        host.appendChild(P.note('Правила расчёта (справочник «Правило цеха», меняются под ваше положение об оплате): годные — по расценке операции и изделия на дату; брак не по вине рабочего — как годные, по его вине — ' + Math.round(M.rules.badShare * 100) + '% расценки (ст. 156 ТК); простой по организационным и техническим причинам — ' + Math.round(M.rules.idleShare * 100) + '% тарифной ставки (ст. 157 ТК), по вине рабочего — не оплачивается.', 'info'));

        function detail(r) {
            var lines = Object.keys(r.lines).map(function (k) { return r.lines[k]; });
            var marks = M.marks.filter(function (m) { return m.worker === r.worker && m.date >= from && m.date <= to && m.accept !== 'Принято'; });
            var body = P.el('div', {}, [P.table([{ t: 'Операция', k: 'op' }, { t: 'Изделие', k: 'product' }, { t: 'Шт к оплате', num: true, k: 'qty' }, { t: 'Расценка', num: true, html: function (l) { return P.money(l.rate); } }, { t: 'Сумма', num: true, html: function (l) { return P.money(l.sum); } }], lines),
                marks.length ? P.el('h3', { text: 'Не принято мастером', style: 'margin-top:14px' }) : null,
                marks.length ? P.table([{ t: 'Дата', html: function (m) { return C.toShort(m.date) + ' ' + P.esc(m.at); } }, { t: 'Задание', k: 'task' }, { t: 'Годных', num: true, k: 'good' }, { t: 'Брак', num: true, html: function (m) { return m.bad + (m.culprit ? ' (' + P.esc(m.culprit) + ')' : ''); } }, { t: 'Приёмка', k: 'accept' }], marks) : null]);
            P.modal(r.worker + ': ' + period, body, null, true);
        }
    });
})();
