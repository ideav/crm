/* ТОиР: дефектная ведомость на останов — дефекты линии, ППР, нормы, запчасти против склада, печать, «всё в ремонт». */
(function () {
    'use strict';
    var T = window.Toir, C = T.core, el = T.el;
    var cur = null;
    T.mount(draw);
    function execFor(prof) { return /КИП/.test(prof) ? 'electric-kip' : /Наладчик/.test(prof) ? 'naladchik-fedorov' : 'slesar-zakharov'; }
    function draw(h, M) {
        h = h || document.getElementById('toir-app'); M = M || T.cur; h.innerHTML = '';
        var stops = M.stops.slice().sort(function (a, b) { return (a.status === 'Проведён') - (b.status === 'Проведён') || a.from.localeCompare(b.from); });
        if (!stops.length) { h.appendChild(el('p', { 'class': 'toir-muted', text: 'Нет остановов, доступных вашей роли.' })); return; }
        var st = M.stops.filter(function (s) { return s.name === cur; })[0] || stops[0]; cur = st.name;
        var eqm = {}; M.eq.forEach(function (e) { eqm[e.name] = { line: e.line, type: e.type }; });
        var S = C.statement({ stop: st, eq: eqm, defects: M.defects, ppr: M.ppr.filter(function (p) { return p.status !== 'Выполнен'; }), works: M.works, norms: M.norms, parts: M.parts, today: T.TODAY });
        var lineEq = {}; M.eq.forEach(function (e) { if (e.line === st.line) lineEq[e.name] = 1; });
        var free = C.remarksWithoutDefect(M.marks.filter(function (m) { return lineEq[m.eq] && m.date >= C.addDays(T.TODAY, -30); }), M.defects);
        var openOrder = function (r) { return M.orders.filter(function (o) { return (r.kind === 'defect' ? o.defect === r.ref : o.ppr === r.ref) && o.status !== 'Выполнен'; })[0]; };
        var sel = T.select(stops.map(function (s) { return [s.name, s.name + ' · ' + s.status]; }), st.name); sel.addEventListener('change', function () { cur = sel.value; draw(); });
        var tools = el('div', { 'class': 'toir-bar toir-noprint' }, [T.field('Останов', sel), el('span', { 'class': 'toir-grow' }),
            T.btn('Печать', function () { window.print(); }), T.btn('CSV', function () { csv(st, S); })]);
        var todo = S.rows.filter(function (r) { return !openOrder(r) && r.work; });
        if (T.canWrite('Наряд') && todo.length) tools.appendChild(T.btn('Всё в ремонт (' + todo.length + ')', function (ev) { allToRepair(M, st, todo, ev.target); }, 'toir-primary'));
        if (T.canWrite('Останов') && T.roleIs(/Начальник цеха/) && st.status === 'На согласовании') tools.appendChild(T.btn('Согласовать останов', function () { T.update(st.id, { 'Статус останова': 'Согласован', 'Согласовал останов': T.who() }).then(function () { st.status = 'Согласован'; st.approved = T.who(); T.toast('Останов согласован'); draw(); }).catch(function (e) { T.toast(e.message, true); }); }, 'toir-primary'));
        h.appendChild(tools);
        var doc = el('div', { 'class': 'toir-print' }); h.appendChild(doc);
        doc.appendChild(el('h1', { text: 'Дефектная ведомость: ' + st.name }));
        doc.appendChild(el('p', { 'class': 'toir-sub', text: st.shop + ' · линия ' + st.line + ' · ' + C.ru(st.from) + (st.to !== st.from ? '–' + C.ru(st.to) : '') + ' · окно ' + st.hours + ' ч · ' + st.status + (st.approved ? ' (' + st.approved + ')' : '') + '. Собрана ' + C.ru(T.TODAY) + ' из дефектов и графика ППР, запчасти проверены по складу.' }));
        var nDef = S.rows.filter(function (r) { return r.kind === 'defect'; }).length;
        doc.appendChild(el('div', { 'class': 'toir-kpis' }, [
            T.kpi('дефектов в ведомости', String(nDef), S.rows.filter(function (r) { return r.overdue && r.kind === 'defect'; }).length + ' со сроком, который уже прошёл'),
            T.kpi('работ ППР в останов', String(S.rows.length - nDef), 'плановые сроки до ' + C.ru(C.addDays(st.to, 14))),
            T.kpi('трудоёмкость по нормам', T.h(S.hours), Object.keys(S.hoursBy).map(function (k) { return k + ' ' + T.h(S.hoursBy[k]); }).join(', ')),
            T.kpi('заказать сегодня', String(S.orderToday), 'успевает к ' + C.ru(C.addDays(st.from, -1)), S.orderToday ? 'warn' : 'good'),
            T.kpi('не успеет к останову', String(S.late.length), S.late.join(', ') || 'всё есть или придёт', S.late.length ? 'bad' : 'good')]));
        if (free.length) doc.appendChild(el('div', { 'class': 'toir-card toir-card-warn toir-noprint' }, [
            el('b', { text: 'Замечания обходов на этой линии, которые не стали дефектами: ' + free.length }),
            el('p', { 'class': 'toir-muted', text: 'Раньше такие записи терялись в журнале и не попадали в ведомость. Одно нажатие — и замечание в ведомости.' }),
            T.table([{ t: 'Дата', html: function (m) { return C.ru(m.date); } }, { t: 'Узел', node: function (m) { return T.eqLink(M, m.eq); } }, { k: 'item', t: 'Пункт' }, { k: 'note', t: 'Запись обходчика' }, { k: 'walker', t: 'Кто' },
                { t: '', node: function (m) { return T.canWrite('Дефект') ? T.btn('В ведомость', function (ev) { fromRemark(M, st, m, ev.target); }, 'toir-small') : null; } }], free, { cls: 'toir-stack' })]));
        doc.appendChild(el('h2', { text: 'Работы' }));
        doc.appendChild(T.table([
            { t: '№', html: function (r) { return T.esc(r.ref) + (r.kind === 'ppr' ? '<br><small class="toir-muted">ППР</small>' : ''); } },
            { t: 'Узел', node: function (r) { return T.eqLink(M, r.eq); } },
            { t: 'Что', html: function (r) { return r.kind === 'defect' ? T.esc(r.text) : 'Плановое обслуживание по графику'; } },
            { t: 'Критичность / срок', html: function (r) { return (r.crit ? T.badge(r.crit, T.critKind(r.crit)) + ' ' : '') + '<span class="' + (r.overdue ? 'toir-red' : '') + '">' + C.ru(r.due) + '</span>'; } },
            { t: 'Работа', html: function (r) { return r.work ? T.esc(r.work) + '<br><small class="toir-muted">' + T.esc(r.prof) + '</small>' : '<span class="toir-amber">вид работ не задан</span>'; } },
            { t: 'Норма', num: true, html: function (r) { return T.h(r.hours); } },
            { t: 'Запчасти', html: function (r) { return r.parts.length ? r.parts.map(function (p) { var x = S.parts.filter(function (y) { return y.part === p.part; })[0]; return '<span class="' + (x.state === 'late' ? 'toir-red' : x.state === 'order' ? 'toir-amber' : '') + '">' + T.esc(p.part) + ' × ' + T.fmt(p.qty, p.qty % 1 ? 1 : 0) + '</span>'; }).join('<br>') : '<span class="toir-muted">—</span>'; } },
            { t: 'Наряд', node: function (r) { var o = openOrder(r); if (o) return el('span', { html: T.esc(o.name) + ' ' + T.badge(o.status, T.statusKind(o.status)) }); return T.canWrite('Наряд') && r.work ? T.btn('В ремонт', function () { T.orderDialog(M, { eq: r.eq, defect: r.kind === 'defect' ? r.ref : '', ppr: r.kind === 'ppr' ? r.ref : '', work: r.work, stop: st.name, exec: execFor(r.prof), plan: st.from }, function () { draw(); }); }, 'toir-small toir-noprint') : el('span', { 'class': 'toir-muted', text: 'нет' }); } }
        ], S.rows, { cls: 'toir-stack', rowCls: function (r) { return r.blocked ? 'toir-row-bad' : r.overdue ? 'toir-row-warn' : ''; } }));
        doc.appendChild(el('h2', { text: 'Запчасти по нормам против склада' }));
        var label = { ok: ['есть', 'ok'], order: ['заказать сегодня — успеет', 'warn'], late: ['не успеет к останову', 'crit'] };
        doc.appendChild(T.table([
            { k: 'part', t: 'Запчасть' }, { t: 'Нужно', num: true, html: function (p) { return T.fmt(p.need, p.need % 1 ? 1 : 0); } }, { t: 'На складе', num: true, html: function (p) { return T.fmt(p.stock); } },
            { t: 'В резерве', num: true, html: function (p) { return T.fmt(p.reserved); } }, { t: 'Свободно', num: true, html: function (p) { return T.fmt(p.free); } },
            { t: 'Не хватает', num: true, html: function (p) { return p.short ? '<b class="toir-red">' + T.fmt(p.short) + '</b>' : '—'; } },
            { t: 'Поставка', html: function (p) { return p.short ? p.lead + ' дн., придёт ' + C.ru(p.arrive) : ''; } },
            { t: 'Итог', html: function (p) { return T.badge(label[p.state][0], label[p.state][1]); } }], S.parts, { cls: 'toir-stack' }));
        if (S.late.length) doc.appendChild(el('p', { 'class': 'toir-note toir-note-bad', text: 'Без замены поставщика или аналога работы ' + S.rows.filter(function (r) { return r.blocked; }).map(function (r) { return r.ref; }).join(', ') + ' в этот останов не выполнить: срок поставки длиннее, чем осталось до ' + C.ru(st.from) + '.' }));
        doc.appendChild(el('p', { 'class': 'toir-muted', text: 'Составил: ' + T.who() + ' · Утверждаю: главный механик ________ · Согласовано: начальник цеха ________' }));
    }
    function fromRemark(M, st, m, btn) {
        btn.disabled = true;
        var no = C.defectNo(T.TODAY, T.now()), eq = M.eqBy[m.eq] || {}, text = (m.note || m.item) + ' (замечание обхода ' + C.ru(m.date) + ')';
        T.create('Дефект', { 'Дефект': no, 'Оборудование': m.eq, 'Цех': eq.shop, 'Обнаружен': m.date, 'Источник дефекта': 'Обход', 'Отметка обхода': m.id, 'Описание дефекта': text, 'Критичность дефекта': 'Средняя', 'Статус дефекта': 'В ведомости', 'Срок устранения': st.from, 'Автор дефекта': m.walker, 'Останов': st.name, 'Ответ автору': 'Взято в ведомость ' + st.name })
            .then(function (id) { M.defects.push({ id: id, name: no, eq: m.eq, shop: eq.shop, found: m.date, source: 'Обход', mark: m.id, text: text, crit: 'Средняя', status: 'В ведомости', due: st.from, author: m.walker, answer: 'Взято в ведомость ' + st.name, stop: st.name, work: '' }); T.toast('Дефект ' + no + ' в ведомости. Задайте вид работ в журнале дефектов'); draw(); })
            .catch(function (e) { btn.disabled = false; T.toast(e.message, true); });
    }
    function allToRepair(M, st, rows, btn) {
        btn.disabled = true; var made = [], chain = Promise.resolve();
        rows.forEach(function (r) {
            chain = chain.then(function () { return T.makeOrder(M, { eq: r.eq, defect: r.kind === 'defect' ? r.ref : '', ppr: r.kind === 'ppr' ? r.ref : '', work: r.work, stop: st.name, exec: execFor(r.prof), plan: st.from }).then(function (no) { made.push(no); }); });
        });
        var eqLine = {}; M.eq.forEach(function (e) { eqLine[e.name] = e.line; });
        var moves = C.pprToStop(M.ppr.filter(function (p) { return p.status !== 'Выполнен'; }), st, eqLine);
        chain = chain.then(function () { return Promise.all(moves.map(function (mv) { var p = M.pprBy[mv.name]; p.plan = mv.to; p.status = 'В останове'; return T.update(mv.id, { 'Плановая дата': mv.to, 'Статус ППР': 'В останове' }); })); });
        chain.then(function () { T.toast('Нарядов: ' + made.length + '. Запчасти зарезервированы, ППР перестроен: ' + moves.length + ' работ перенесены на ' + C.ru(st.from)); draw(); })
            .catch(function (e) { T.toast(e.message, true); draw(); });
    }
    function csv(st, S) {
        var q = function (s) { s = String(s === undefined || s === null ? '' : s); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        var lines = ['№;Узел;Что;Критичность;Срок;Работа;Норма, ч;Запчасти'];
        S.rows.forEach(function (r) { lines.push([r.ref, r.eq, r.kind === 'defect' ? r.text : 'ППР', r.crit || '', C.ru(r.due), r.work, String(r.hours).replace('.', ','), r.parts.map(function (p) { return p.part + ' x ' + p.qty; }).join(', ')].map(q).join(';')); });
        T.download('ведомость-' + st.name.replace(/\s+/g, '-') + '.csv', lines.join('\r\n'));
    }
})();
