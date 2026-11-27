/* ТОиР: журнал дефектов — критичность, сроки, ответ автору, «в ремонт». */
(function () {
    'use strict';
    var T = window.Toir, C = T.core, el = T.el;
    var F = { shop: '', view: 'open', crit: '' };
    T.mount(draw);
    function draw(h, M) {
        h = h || document.getElementById('toir-app'); M = M || T.cur; h.innerHTML = '';
        var shops = M.shops.length > 1;
        h.appendChild(el('div', {}, T.head('Дефекты', 'Единый поток: обходы, мастера, технологи и мониторинг MDC. У каждого дефекта узел, критичность и срок; автор видит ответ у себя в телефоне.')));
        var all = M.defects.filter(function (d) { return !F.shop || d.shop === F.shop; });
        var open = all.filter(C.isOpen), st = function (d) { return C.defectState(d, T.TODAY); };
        h.appendChild(el('div', { 'class': 'toir-kpis' }, [
            T.kpi('открытых дефектов', String(open.length)),
            T.kpi('срок прошёл', String(open.filter(function (d) { return st(d).overdue; }).length), 'аварийные и высокие — в первую очередь', open.some(function (d) { return st(d).overdue; }) ? 'bad' : 'good'),
            T.kpi('аварийных и высоких', String(open.filter(function (d) { return /Аварийная|Высокая/.test(d.crit); }).length), '', 'warn'),
            T.kpi('без ответа автору', String(open.filter(function (d) { return st(d).silent; }).length), 'обходчик не знает, что с замечанием', open.some(function (d) { return st(d).silent; }) ? 'warn' : ''),
            T.kpi('новых сегодня', String(all.filter(function (d) { return d.found === T.TODAY; }).length))]));
        var bar = el('div', { 'class': 'toir-bar' });
        if (shops) { var s = T.select([['', 'Все цеха']].concat(M.shops.map(function (x) { return x.name; })), F.shop); s.addEventListener('change', function () { F.shop = s.value; draw(); }); bar.appendChild(T.field('Цех', s)); }
        var c = T.select([['', 'Любая']].concat(M.crit.map(function (x) { return x.name; })), F.crit); c.addEventListener('change', function () { F.crit = c.value; draw(); }); bar.appendChild(T.field('Критичность', c));
        h.appendChild(bar);
        h.appendChild(T.tabs([['open', 'Открытые'], ['overdue', 'Срок прошёл'], ['all', 'Все']], F.view, function (v) { F.view = v; draw(); }));
        var order = {}; M.crit.forEach(function (x) { order[x.name] = x.order; });
        var list = all.filter(function (d) { return (F.view === 'all' || (F.view === 'open' ? C.isOpen(d) : st(d).overdue)) && (!F.crit || d.crit === F.crit); })
            .sort(function (a, b) { return (C.isOpen(b) - C.isOpen(a)) || (order[a.crit] || 9) - (order[b.crit] || 9) || String(a.due).localeCompare(String(b.due)); });
        h.appendChild(T.table([
            { t: '№', html: function (d) { return T.esc(d.name) + '<br><small class="toir-muted">' + C.ru(d.found) + '</small>'; } },
            { t: 'Узел', node: function (d) { return T.eqLink(M, d.eq); } },
            { t: 'Описание', html: function (d) { return T.esc(d.text) + '<br><small class="toir-muted">' + T.esc(d.source) + ' · ' + T.esc(d.author) + '</small>'; } },
            { t: 'Критичность', html: function (d) { return T.badge(d.crit, T.critKind(d.crit)); } },
            { t: 'Срок', html: function (d) { var x = st(d); return '<span class="' + (x.overdue ? 'toir-red' : '') + '">' + C.ru(d.due) + '</span>' + (x.overdue ? '<br><small class="toir-red">просрочен ' + (-x.left) + ' дн.</small>' : ''); } },
            { t: 'Статус', html: function (d) { return T.badge(d.status, T.statusKind(d.status)) + (d.stop ? '<br><small class="toir-muted">' + T.esc(d.stop) + '</small>' : ''); } },
            { t: 'Ответ автору', html: function (d) { return d.answer ? T.esc(d.answer) : (C.isOpen(d) ? '<span class="toir-amber">нет ответа</span>' : ''); } }
        ], list, { cls: 'toir-stack', onrow: function (d) { card(M, d); }, rowCls: function (d) { return st(d).overdue ? 'toir-row-bad' : ''; } }));
    }
    function card(M, d) {
        var mark = M.marks.filter(function (m) { return m.id === d.mark; })[0];
        var canW = T.canWrite('Дефект'), canO = T.canWrite('Наряд');
        var stat = T.select(['Новый', 'Принят', 'В ведомости', 'В ремонте', 'Устранён', 'Отклонён'], d.status);
        var crit = T.select(M.crit.map(function (c) { return c.name; }), d.crit);
        var ans = T.input('textarea', d.answer || '', { rows: 3, placeholder: 'Что сделаем и когда — увидит автор' });
        var stops = M.stops.filter(function (s) { return s.line === (M.eqBy[d.eq] || {}).line && s.status !== 'Проведён'; });
        var stop = T.select([['', '— без останова —']].concat(stops.map(function (s) { return s.name; })), d.stop || '');
        var works = T.select([['', '— не задан —']].concat(Object.keys(M.works).sort()), d.work || '');
        var orders = M.orders.filter(function (o) { return o.defect === d.name; });
        var body = el('div', {}, [
            el('p', {}, [T.eqLink(M, d.eq), el('span', { 'class': 'toir-muted', text: ' · ' + d.shop + ' · обнаружен ' + C.ru(d.found) + ' · ' + d.source + ' · ' + d.author })]),
            el('div', { 'class': 'toir-note', text: d.text }),
            mark ? el('p', { 'class': 'toir-muted', html: 'Отметка обхода ' + C.ru(mark.date) + ' ' + T.esc(mark.time || '') + ': ' + T.esc(mark.item) + (mark.value ? ' = ' + T.fmt(mark.value, 1) : '') + ' (' + T.esc(mark.tag || '') + ')' + (mark.photo ? ' · <a href="' + T.esc(mark.photo) + '" target="_blank" rel="noopener">фото</a>' : '') }) : null,
            orders.length ? el('p', { html: 'Наряды: ' + orders.map(function (o) { return T.esc(o.name) + ' ' + T.badge(o.status, T.statusKind(o.status)); }).join(', ') }) : null,
            canW ? el('div', {}, [T.field('Статус', stat), T.field('Критичность', crit), T.field('Вид работ', works), T.field('Останов', stop, stops.length ? 'дефект попадёт в ведомость останова' : 'на линии нет запланированных остановов'), T.field('Ответ автору', ans)]) : el('p', { html: 'Статус: ' + T.badge(d.status, T.statusKind(d.status)) + (d.answer ? '<br>Ответ: ' + T.esc(d.answer) : '') })
        ]);
        var btns = [{ text: 'Закрыть' }];
        if (canO && C.isOpen(d) && !orders.some(function (o) { return o.status !== 'Выполнен'; })) btns.push({ text: 'В ремонт', fn: function () { T.orderDialog(M, { eq: d.eq, defect: d.name, work: works.value || d.work, stop: stop.value }, function () { draw(); }); } });
        if (canW) btns.push({ text: 'Сохранить', cls: 'toir-primary', fn: function () {
            var f = { 'Статус дефекта': stat.value, 'Критичность дефекта': crit.value, 'Ответ автору': ans.value, 'Вид работ': works.value, 'Останов': stop.value };
            if (!works.value && !d.work) delete f['Вид работ']; if (!stop.value && !d.stop) delete f['Останов'];
            if (crit.value !== d.crit) { var days = (M.critBy[crit.value] || {}).days; if (days) f['Срок устранения'] = C.dueDate(d.found, days); }
            if (stop.value && stat.value === 'Принят') f['Статус дефекта'] = 'В ведомости';
            if (stat.value === 'Устранён' && !d.done) f['Устранён'] = T.TODAY;
            return T.update(d.id, f).then(function () {
                d.status = f['Статус дефекта']; d.crit = crit.value; d.answer = ans.value; d.work = works.value; d.stop = stop.value; if (f['Срок устранения']) d.due = f['Срок устранения']; if (f['Устранён']) d.done = T.TODAY;
                T.toast('Дефект ' + d.name + ' сохранён' + (ans.value ? ', автор увидит ответ' : '')); draw();
            });
        } });
        T.modal('Дефект ' + d.name, body, btns, true);
    }
})();
