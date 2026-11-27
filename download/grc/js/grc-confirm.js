/* GRC: «Мои контроли» - экран владельца контроля с телефона: выполнил / не выполнил, причина, файл. */
(function () {
    'use strict';
    var P = window.Grc, C = P.core;

    function render(host, M, reload) {
        var me = M.empByLogin[P.ctx.user], camp = M.current;
        var mine = M.reqs.filter(function (r) { return r.owner === P.ctx.user; });
        var open = mine.filter(function (r) { return camp && r.campaign === camp.name && !r.result; });
        var done = mine.filter(function (r) { return r.result; }).sort(function (a, b) { return (b.answered + b.time) < (a.answered + a.time) ? -1 : 1; });
        host.innerHTML = '';
        host.classList.add('grc-mobile');
        var hello = me ? me.name.split(' ').slice(1, 3).join(' ') : P.ctx.user;
        host.appendChild(P.el('h1', { text: 'Мои контроли' }));
        host.appendChild(P.el('p', { 'class': 'grc-sub', text: hello + ', ' + (open.length ? 'нужно подтвердить ' + open.length + ' ' + C.plural(open.length, 'контроль', 'контроля', 'контролей') + ' по кампании «' + camp.name + '» до ' + C.toDmy(camp.due) + (M.today > camp.due ? ' (срок прошёл, ответьте сегодня)' : '') + '.' : 'все запросы закрыты, спасибо.') }));
        host.appendChild(P.el('div', { 'class': 'grc-note', text: 'Отметка «не выполнен» с причиной - не нарушение: служба контроля видит причину и помогает её устранить. Ответ попадает в журнал и потом не меняется.' }));
        open.forEach(function (r) { host.appendChild(card(M, r, reload)); });
        if (done.length) {
            host.appendChild(P.el('h2', { text: 'Отвеченные' }));
            done.slice(0, 15).forEach(function (r) {
                var c = M.ctrlBy[r.control] || {};
                host.appendChild(P.el('div', { 'class': 'grc-card grc-card-done' }, [P.el('div', { 'class': 'grc-card-h', html: '<b>' + P.esc(r.control) + '</b> ' + P.esc(c.name || '') }),
                    P.el('div', { 'class': 'grc-card-s', html: P.esc(r.campaign) + ' · ' + P.stateBadge(P.state(M, r)) + ' · ' + C.toDmy(r.answered) + ' ' + P.esc(r.time) + (r.reason ? '<br>' + P.esc(r.reason) : '') + (r.file ? '<br>' + P.fileLink(r) : '') })]));
            });
        }
    }
    function card(M, r, reload) {
        var c = M.ctrlBy[r.control] || {}, rk = M.riskBy[c.risk];
        var box = P.el('div', { 'class': 'grc-card grc-ask' });
        box.appendChild(P.el('div', { 'class': 'grc-card-h', html: '<b>' + P.esc(r.control) + '</b> ' + P.esc(c.name || '') }));
        box.appendChild(P.el('div', { 'class': 'grc-card-s', text: [c.period, rk ? 'риск: ' + rk.name : '', c.evidence ? 'приложить: ' + c.evidence : 'файл не обязателен'].filter(Boolean).join(' · ') }));
        if (r.reminders) box.appendChild(P.el('div', { 'class': 'grc-card-s', html: P.badge('напоминаний: ' + r.reminders, 'warn') }));
        var form = P.el('div', { 'class': 'grc-form' });
        var yes = P.btn('Выполнил', function () { pick(true); }, 'grc-big grc-yes'), no = P.btn('Не выполнил', function () { pick(false); }, 'grc-big grc-no');
        box.appendChild(P.el('div', { 'class': 'grc-yesno' }, [yes, no]));
        box.appendChild(form);
        function pick(ok) {
            yes.classList.toggle('grc-on', ok); no.classList.toggle('grc-on', !ok);
            form.innerHTML = '';
            var reason = P.el('textarea', { rows: 3, placeholder: ok ? 'Комментарий (необязательно)' : 'Почему не выполнен и когда будет' });
            var file = P.input('file', '', { accept: '.pdf,.jpg,.jpeg,.png,.xlsx,.xls,.docx,.doc' });
            form.appendChild(P.field(ok ? 'Комментарий' : 'Причина (обязательно)', reason));
            form.appendChild(P.field(ok ? (c.evidence ? 'Файл: ' + c.evidence + ' (обязательно)' : 'Файл (необязательно)') : 'Файл (необязательно)', file));
            form.appendChild(P.btn('Отправить ответ', function () { send(ok, reason.value.trim(), file.files[0]); }, 'grc-primary grc-big'));
        }
        function send(ok, reason, f) {
            if (!ok && !reason) { P.toast('Напишите причину', true); return; }
            if (ok && c.evidence && !f) { P.toast('Приложите файл: ' + c.evidence, true); return; }
            var t = P.now(), fields = { 'Результат контроля': ok ? C.DONE : C.FAIL, 'Причина невыполнения': reason, 'Дата ответа': M.today, 'Время ответа': t };
            var content = (ok ? '' : reason) + (ok && reason ? reason : '') + (f ? (reason ? '. ' : '') + 'Файл: ' + f.name : (ok ? (reason ? '. ' : '') + 'Без файла' : ''));
            box.classList.add('grc-busy');
            P.update(r.id, fields).then(function () { return f ? P.upload(r.id, 'Запрос подтверждения', 'Файл подтверждения', f) : null; })
                .then(function () { return P.create('Журнал подтверждений', P.journalEntry(M, r, ok ? C.DONE : C.FAIL, content)); })
                .then(function () { P.toast('Ответ записан в журнал'); reload(); })
                .catch(function (e) { box.classList.remove('grc-busy'); P.toast(e.message, true); });
        }
        return box;
    }
    P.mount(function (host, M, reload) { render(host, M, reload); });
})();
