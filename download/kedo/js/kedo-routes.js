/* КЭДО: маршруты подписания компании — кто, в каком порядке, какой подписью, что при отказе. Подписант и вид подписи меняются на глазах. */
(function () {
    'use strict';
    var P = window.Kedo, C = P.core;
    var WHO = ['Сотрудник', 'Руководитель подразделения', 'Кадровик', 'Директор юрлица', 'Директор по персоналу'];
    P.mount(function (host, M) {
        var edit = P.canWrite('Шаг маршрута');
        host.innerHTML = '';
        P.head('Маршруты подписания', 'Маршрут задаётся по типу документа. У каждой компании свой: кто подписывает, в каком порядке, какой подписью и что делать при отказе.' + (edit ? ' Измените подписанта или вид подписи — новые документы пойдут по новому маршруту.' : ' Менять маршруты может директор по персоналу.')).forEach(function (n) { host.appendChild(n); });
        M.routes.forEach(function (rt) {
            var types = M.types.filter(function (t) { return t.route === rt.name; });
            var line = P.el('div', { 'class': 'kedo-muted', style: 'margin-top:8px' });
            function sayLine() { line.textContent = 'Как пойдёт документ: ' + rt.steps.map(function (s) { return s.who + ' (' + s.sign + ')'; }).join(' → ') + '. Срок по маршруту ' + rt.steps.reduce(function (a, s) { return a + s.days; }, 0) + ' раб. дн.'; }
            var steps = P.el('div', { 'class': 'kedo-steps' });
            rt.steps.forEach(function (s, i) {
                if (i) steps.appendChild(P.el('span', { 'class': 'kedo-arrow', text: '→', 'aria-hidden': 'true' }));
                var box = P.el('div', { 'class': 'kedo-step' }, [P.el('b', { text: 'Шаг ' + s.order })]);
                if (edit) {
                    var who = P.select(WHO, s.who), sign = P.select(M.signKinds.map(function (k) { return [k.name, k.name]; }), s.sign);
                    var days = P.input('number', s.days, { min: 1, max: 10, step: 1, style: 'width:70px;min-height:32px' });
                    who.setAttribute('aria-label', 'Подписант, шаг ' + s.order); sign.setAttribute('aria-label', 'Вид подписи, шаг ' + s.order); days.setAttribute('aria-label', 'Срок шага, шаг ' + s.order);
                    var save = function () {
                        var f = { 'Подписант': who.value, 'Вид подписи': sign.value, 'Срок шага, раб. дней': C.num(days.value) || 1, 'Шаг маршрута': s.order + '. ' + who.value };
                        P.post('_m_set/' + s.id + '?JSON', { fields: f }).then(function () { s.who = who.value; s.sign = sign.value; s.days = f['Срок шага, раб. дней']; sayLine(); P.resetModel(); P.toast('Маршрут «' + rt.name + '» сохранён'); }).catch(function (e) { P.toast(e.message, true); });
                    };
                    [who, sign, days].forEach(function (c) { c.addEventListener('change', save); });
                    box.appendChild(who); box.appendChild(sign); box.appendChild(P.el('div', { 'class': 'kedo-muted' }, ['срок ', days, ' р.д.']));
                } else {
                    box.appendChild(P.el('div', { text: s.who })); box.appendChild(P.el('div', { html: P.badge(s.sign, 'info') })); box.appendChild(P.el('div', { 'class': 'kedo-muted', text: 'срок ' + s.days + ' р.д.' }));
                }
                box.appendChild(P.el('small', { 'class': 'kedo-muted', text: 'При отказе: ' + (s.onRefuse || '—') }));
                steps.appendChild(box);
            });
            sayLine();
            host.appendChild(P.el('div', { 'class': 'kedo-card', style: 'margin-bottom:14px' }, [
                P.el('h2', { text: rt.name, style: 'margin-top:0' }), P.el('p', { 'class': 'kedo-sub', text: rt.descr + '. Типы: ' + types.map(function (t) { return t.name; }).join(', ') }), steps, line]));
        });
        host.appendChild(P.el('h2', { text: 'Виды подписи' }));
        host.appendChild(P.table([{ k: 'name', t: 'Вид подписи' }, { k: 'who', t: 'Кто выпускает' }], M.signKinds));
        host.appendChild(P.el('div', { 'class': 'kedo-border', text: P.BORDER + ' Документы с подписью «задним числом» в КЭДО не идут: время отправки и подписания ставит сервер оператора.' }));
    });
})();
