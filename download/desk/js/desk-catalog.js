/* Service Desk: каталог услуг. Руководитель службы сам добавляет услугу, её поля, маршрут и срок SLA - без разработчика. */
(function () {
    'use strict';
    var P = window.Desk, C = P.core;
    var ROUTES = [['', 'Без согласования'], ['Руководитель', 'Руководитель заявителя'], ['Руководитель, Руководитель службы', 'Руководитель заявителя, затем руководитель службы']];
    var SAMPLE = { name: 'Пропуск гостю', service: 'АХО', group: 'Доступ в здание', descr: 'Разовый пропуск для посетителя в офис.', keywords: 'пропуск гость посетитель охрана ресепшн',
        form: 'ФИО гостя*\nДата визита*:date\nВремя прихода*\nКомпания гостя', route: '', exec: 'Лебедев Сергей Иванович', prio: 'Высокий', reactH: 0.5, solveH: 2 };

    function editor(host, M, s) {
        s = s || {};
        var isNew = !s.id;
        var name = P.input('text', s.name || ''), srv = P.select(M.services.map(function (x) { return x.name; }), s.service || M.services[0].name);
        var group = P.input('text', s.group || ''), descr = P.input('textarea', s.descr || ''), keys = P.input('text', s.keywords || '');
        var form = P.input('textarea', s.form || '', { rows: 5 }), route = P.select(ROUTES, s.route || '');
        var exec = P.select([['', 'Назначит диспетчер']].concat(M.execs.map(function (e) { return [e.name, e.name + ' (' + e.service + ')']; })), s.exec || '');
        var prio = P.select(M.prios.map(function (p) { return p.name; }), s.prio || 'Обычный');
        var react = P.input('number', s.reactH || 1, { min: 0.25, step: 0.25 }), solve = P.input('number', s.solveH || 8, { min: 0.5, step: 0.5 });
        var pub = P.el('input', { type: 'checkbox' }); pub.checked = isNew ? true : s.published;
        var pv = P.el('div', { 'class': 'desk-note' });
        function refresh() {
            var f = C.parseForm(form.value), b = C.budget({ reactH: react.value, solveH: solve.value }, M.prioBy[prio.value]);
            var dl = C.addWork(M.now, b.solve, M.cal);
            pv.innerHTML = '<b>Форма заявителя:</b> ' + (f.length ? f.map(function (x) { return P.esc(x.name) + (x.req ? '*' : '') + ' <small class="desk-muted">(' + (x.type === 'select' ? x.options.join(' / ') : x.type === 'date' ? 'дата' : x.type === 'number' ? 'число' : 'текст') + ')</small>'; }).join(', ') : 'только описание') +
                '<br><b>Срок:</b> заявка, поданная сейчас (' + P.esc(C.fmtShort(M.now)) + '), решается до <b>' + P.esc(C.fmtShort(dl)) + '</b> с учётом приоритета «' + P.esc(prio.value) + '» и рабочего календаря.';
        }
        [form, react, solve, prio].forEach(function (x) { x.addEventListener('input', refresh); x.addEventListener('change', refresh); }); refresh();
        var body = P.el('div', {}, [
            P.el('div', { 'class': 'desk-grid2' }, [P.field('Название услуги *', name), P.field('Служба', srv), P.field('Группа', group), P.field('Ключевые слова для поиска', keys, 'по ним «Мне нужно…» находит услугу'),
                P.field('Маршрут согласования', route), P.field('Исполнитель по умолчанию', exec), P.field('Приоритет', prio), P.el('label', { 'class': 'desk-field' }, [P.el('span', { text: 'Опубликована на портале' }), pub]),
                P.field('Реакция, раб. ч', react), P.field('Решение, раб. ч', solve)]),
            P.field('Описание для заявителя', descr),
            P.field('Поля формы', form, 'по строке на поле: «Название*» - обязательное, «:date», «:number», «:Вариант 1|Вариант 2» - выбор; «Помещение» подставится само'),
            pv]);
        P.modal(isNew ? 'Новая услуга' : s.name, body, [{ text: 'Отмена' }, { text: isNew ? 'Добавить в каталог' : 'Сохранить', cls: 'desk-primary', fn: function (close, bt) {
            if (!name.value.trim()) return false;
            var e = M.execBy[exec.value];
            var f = { 'Служба': M.serviceBy[srv.value].id, 'Группа услуг': group.value, 'Описание услуги': descr.value, 'Ключевые слова': keys.value, 'Поля формы': form.value, 'Маршрут согласования': route.value,
                'Исполнитель': e ? e.id : '', 'Приоритет': M.prioBy[prio.value].id, 'Реакция, ч': react.value, 'Решение, ч': solve.value, 'Опубликована': pub.checked ? 1 : -1 };
            bt.disabled = true;
            var q = isNew ? P.create('Услуга', Object.assign({ 'Услуга': name.value.trim() }, f)) : P.update(s.id, f);
            q.then(function () { close(); P.reload(function (M2) { render(host, M2); P.toast(isNew ? 'Услуга «' + name.value.trim() + '» уже на портале' : 'Сохранено: новые заявки получат новый срок'); }); })
                .catch(function (er) { bt.disabled = false; P.toast(er.message, true); });
            return false;
        } }], true);
    }
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('h1', { text: 'Каталог услуг' }));
        host.appendChild(P.el('p', { 'class': 'desk-sub', text: 'Свои услуги, поля формы, маршрут и сроки у каждой службы. Изменения сразу видны на портале; уже поданные заявки сохраняют свой срок.' }));
        var canW = P.canWrite('Услуга');
        if (canW) host.appendChild(P.el('div', { 'class': 'desk-bar' }, [P.btn('+ Новая услуга', function () { editor(host, M, null); }, 'desk-primary'), P.btn('Пример: «Пропуск гостю»', function () { editor(host, M, SAMPLE); })]));
        var since = M.now - 30 * 1440;
        M.services.forEach(function (srv) {
            var list = M.catalog.filter(function (s) { return s.service === srv.name; });
            var rep = {}; C.slaReport(M.tickets, function (t) { return t.service; }, since, M.now + 1).forEach(function (r) { rep[r.key] = r; });
            host.appendChild(P.el('h2', { text: srv.name + ' - ' + srv.head }));
            host.appendChild(P.table([
                { t: 'Услуга', html: function (s) { return '<b>' + P.esc(s.name) + '</b>' + (s.published ? '' : ' ' + P.badge('скрыта', 'muted')) + '<br><small class="desk-muted">' + P.esc(s.group) + '</small>'; } },
                { t: 'Поля формы', html: function (s) { return P.esc(C.parseForm(s.form).map(function (f) { return f.name + (f.req ? '*' : ''); }).join(', ') || '-'); } },
                { t: 'Согласование', html: function (s) { return P.esc(s.route || '-'); } }, { t: 'Исполнитель', html: function (s) { return P.esc(s.exec || 'диспетчер'); } },
                { t: 'Реакция / решение', num: true, html: function (s) { return s.reactH + ' / ' + s.solveH + ' ч'; } },
                { t: 'SLA за 30 дн.', num: true, html: function (s) { var r = rep[s.name]; return r && r.pct !== null ? (r.pct < M.rules.target ? '<b class="desk-red">' + String(r.pct).replace('.', ',') + '%</b>' : String(r.pct).replace('.', ',') + '%') : '-'; } }
            ], list, { onrow: canW ? function (s) { editor(host, M, s); } : null }));
        });
    }
    P.mount(render);
})();
