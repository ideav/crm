/* Моя очередь: одним нажатием «взял / сделал / передал»; нет моего случая — пишу как есть, система не ругается. */
(function () {
    'use strict';
    var P = window.Trk, C = P.core;
    function asIs(M, q) {
        var t = P.input('textarea', '', { placeholder: 'Например: «отдал юристам на проверку», «жду КП от поставщика»' });
        P.modal('Написать как есть', P.el('div', {}, [P.reqHead(q), P.field('Что происходит', t), P.el('p', { 'class': 'trk-muted trk-small', text: 'Заявка останется у вас. Запись попадёт в журнал, а случай — в отчёт «события без продолжения»: из таких записей рождаются новые шаги процесса.' })]),
            [{ text: 'Отмена' }, { text: 'Записать', cls: 'trk-primary', fn: function () {
                if (!t.value.trim()) { P.toast('Напишите пару слов', true); return false; }
                P.run(P.log(q, q.step, 'Неопределённость', t.value.trim(), 'Со слов исполнителя: нужного шага нет'), 'Записано в журнал');
            } }]);
    }
    function row(M, q, hours) {
        var a = C.queueActions(M.spec, q, P.ctx.user), s = M.spec.by[q.step] || {}, over = s.norm > 0 && hours > s.norm;
        var btns = [];
        if (a.take) btns.push(P.btn('Взял', function () { P.run(P.take(q), 'Заявка ' + q.code + ' у вас'); }, 'trk-primary trk-big'));
        a.next.forEach(function (t) { btns.push(P.btn('Сделал → ' + t.to, function () { P.run(P.move(q, t.to), 'Передано: ' + t.to); }, 'trk-primary trk-big')); });
        if (a.mine && a.uncertain) btns.push(P.btn('Куда дальше?', function () { P.whereNext(M, q); }, 'trk-warnbtn trk-big'));
        if (a.other) btns.push(P.btn('Другое…', function () { asIs(M, q); }, 'trk-big'));
        btns.push(P.btn('Почему здесь', function () { P.reqCard(M, q); }, 'trk-link'));
        return P.el('div', { 'class': 'trk-qrow' + (a.uncertain ? ' trk-card-unc' : over ? ' trk-card-over' : '') }, [
            P.el('div', { 'class': 'trk-qinfo', html: '<b>' + P.esc(q.code) + '</b> · ' + P.esc(q.step) + (a.uncertain ? ' ' + P.badge('нет продолжения', 'bad') : over ? ' ' + P.badge('дольше норматива', 'warn') : '') +
                '<div>' + P.esc(q.title) + '</div><div class="trk-muted trk-small">' + P.esc(C.money(q.sum) + ' · в шаге ' + C.fmtHours(hours) + (s.norm ? ' из ' + s.norm + ' ч' : '') + ' · срок ' + C.toDmy(q.due)) + '</div>' }),
            P.el('div', { 'class': 'trk-qbtns' }, btns)]);
    }
    P.mount(function (host, M) {
        var st = C.stuck(M.spec, M.reqs, M.journal, P.TODAY, P.now()), hrs = {};
        st.forEach(function (x) { hrs[x.req.code] = x.hours; });
        var mine = M.reqs.filter(function (q) { return q.login === P.ctx.user && !C.isFinal(M.spec.by[q.step]); });
        var myDept = (M.me || {}).dept, mySteps = {};
        M.spec.steps.forEach(function (s) { if (!myDept || s.dept === myDept) mySteps[s.name] = 1; });
        var free = M.reqs.filter(function (q) { return !q.login && mySteps[q.step] && !C.isFinal(M.spec.by[q.step]); });
        host.appendChild(P.el('div', {}, P.head('Моя очередь', (M.me.name || P.ctx.user) + (myDept ? ' · ' + myDept : '') + '. Одно нажатие — и статус в системе совпадает с жизнью.')));
        host.appendChild(P.el('h2', { text: 'У меня в работе · ' + mine.length }));
        host.appendChild(P.el('div', { 'class': 'trk-qlist' }, mine.length ? mine.map(function (q) { return row(M, q, hrs[q.code] || 0); }) : [P.el('p', { 'class': 'trk-empty', text: 'Ничего не висит' })]));
        host.appendChild(P.el('h2', { text: 'Свободные в очереди моих шагов · ' + free.length }));
        host.appendChild(P.el('div', { 'class': 'trk-qlist' }, free.length ? free.map(function (q) { return row(M, q, hrs[q.code] || 0); }) : [P.el('p', { 'class': 'trk-empty', text: 'Очередь пуста' })]));
    });
})();
