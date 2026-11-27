/* GRC: кампания подтверждения контролей - запуск, ход по владельцам, напоминание ссылкой в мессенджер. */
(function () {
    'use strict';
    var P = window.Grc, C = P.core;
    var sel = null;

    function confirmUrl() { return location.origin + P.url('confirm'); }
    function render(host, M, reload) {
        var camp = M.campBy[sel] || M.current;
        host.innerHTML = '';
        P.head('Кампания подтверждения', 'Владелец контроля получает ссылку в мессенджер и отвечает одной кнопкой: выполнил / не выполнил, причина и файл. Служба контроля видит, кто не ответил, и напоминает в один клик.').forEach(function (n) { host.appendChild(n); });
        if (!camp) { host.appendChild(P.el('p', { text: 'Кампаний пока нет.' })); }
        var bar = P.el('div', { 'class': 'grc-bar' }, [P.tabs(M.camps.map(function (c) { return [c.name, c.name + (c.status === 'Идёт' ? ' (идёт)' : '')]; }), camp && camp.name, function (n) { sel = n; render(host, M, reload); }), P.el('span', { 'class': 'grc-grow' }),
            P.canWrite('Кампания подтверждения') ? P.btn('Запустить кампанию', function () { launchDlg(M, reload); }, 'grc-primary') : null]);
        host.appendChild(bar);
        if (!camp) return;
        var reqs = P.campReqs(M, camp), s = C.campaignStats(reqs, camp, M.ctrlBy, M.today);
        host.appendChild(P.el('p', { 'class': 'grc-sub', text: 'Период ' + C.toDmy(camp.start) + ' - ' + C.toDmy(camp.end) + ', запущена ' + C.toDmy(camp.launch) + (camp.by ? ' (' + camp.by + ')' : '') + ', срок ответа ' + C.toDmy(camp.due) + (M.today > camp.due ? ' - срок прошёл' : ', осталось ' + C.diffDays(M.today, camp.due) + ' дн.') }));
        host.appendChild(P.el('div', { 'class': 'grc-kpis' }, [
            P.kpi('Ответили', P.pct(s.answeredPct), s.answered + ' из ' + s.total),
            P.kpi('В срок', String(s.done), 'выполнен до ' + C.toDmy(camp.due), 'good'),
            P.kpi('Не выполнено', String(s.fail), 'с причиной', s.fail ? 'warn' : ''),
            P.kpi('Нет ответа', String(s.overdue + s.wait), s.overdue ? s.overdue + ' после срока' : 'срок не прошёл', s.overdue ? 'bad' : ''),
            P.kpi('Без доказательства', String(s.noFile), 'файл не приложен', s.noFile ? 'warn' : '')]));
        var owners = C.byOwner(reqs, camp, M.today);
        host.appendChild(P.el('h2', { text: 'По владельцам' }));
        host.appendChild(P.table([
            { t: 'Владелец', html: function (o) { var e = M.empByLogin[o.owner]; return '<b>' + P.esc(e ? e.name : o.owner) + '</b><br><small>' + P.esc(e ? e.position + ' · ' + (e.messenger || '') : '') + '</small>'; } },
            { t: 'Запросов', k: 'total', num: true }, { t: 'В срок', k: 'done', num: true }, { t: 'Опоздал', k: 'late', num: true }, { t: 'Не выполнен', k: 'fail', num: true },
            { t: 'Нет ответа', num: true, html: function (o) { var n = o.overdue + o.wait; return n ? '<b class="grc-et">' + n + '</b>' : '0'; } },
            { t: '', html: function () { return ''; }, cls: function () { return 'grc-act'; } }
        ], owners, { rowCls: function (o) { return o.overdue ? 'grc-row-bad' : ''; } }));
        var tb = host.querySelector('.grc-table tbody');
        owners.forEach(function (o, k) {
            var open = reqs.filter(function (r) { return r.owner === o.owner && !r.result; });
            if (open.length && P.canWrite('Запрос подтверждения') && tb.children[k]) tb.children[k].lastChild.appendChild(P.btn('Напомнить', function () { remindDlg(M, camp, o.owner, open, reload); }, 'grc-small'));
        });
        host.appendChild(P.el('h2', { text: 'Запросы кампании' }));
        host.appendChild(P.table([
            { t: 'Контроль', html: function (r) { var c = M.ctrlBy[r.control]; return '<b>' + P.esc(r.control) + '</b> ' + P.esc(c ? c.name : '') + (c && c.key ? ' ' + P.badge('ключевой', 'info') : ''); } },
            { t: 'Владелец', k: 'ownerName' },
            { t: 'Состояние', html: function (r) { var st = P.state(M, r); return P.stateBadge(st) + (C.evidenceMissing(r, M.ctrlBy[r.control]) ? ' ' + P.badge('без файла', 'warn') : ''); } },
            { t: 'Ответ', html: function (r) { return r.answered ? C.toDmy(r.answered) + ' ' + P.esc(r.time) : ''; } },
            { t: 'Напоминаний', num: true, html: function (r) { return r.reminders ? String(r.reminders) : ''; } },
            { t: 'Причина / файл', html: function (r) { return P.esc(r.reason || '') + ' ' + P.fileLink(r); } }
        ], reqs.slice().sort(function (a, b) { var o = { overdue: 0, wait: 1, fail: 2, late: 3, done: 4 }; return o[P.state(M, a)] - o[P.state(M, b)] || (a.control < b.control ? -1 : 1); }), { onrow: function (r) { P.ctrlCard(M, r.control); } }));
    }
    function remindDlg(M, camp, login, open, reload) {
        var e = M.empByLogin[login] || { name: login }, first = e.name.split(' ').slice(1, 3).join(' ') || e.name;
        var text = C.reminderText(first, open.length, camp.due, camp.name);
        var link = C.messengerLink(confirmUrl(), text);
        var body = P.el('div', {}, [P.el('p', { html: 'Кому: <b>' + P.esc(e.name) + '</b> ' + P.esc(e.messenger || '') }), P.el('div', { 'class': 'grc-msg', text: text + '\n' + confirmUrl() }),
            P.el('p', { 'class': 'grc-sub', text: 'Ссылка ведёт на экран «Мои контроли»: владелец видит только свои контроли. Напоминание записывается в журнал.' }),
            P.el('a', { href: link, target: '_blank', rel: 'noopener', 'class': 'grc-btn grc-primary', text: 'Открыть в Telegram' })]);
        P.modal('Напоминание владельцу', body, [{ text: 'Отмена' }, { text: 'Отправлено, записать в журнал', cls: 'grc-primary', keep: true, fn: function (close) {
            var ops = [];
            open.forEach(function (r) {
                ops.push({ op: 'set', id: r.id, fields: { 'Напоминаний': r.reminders + 1, 'Последнее напоминание': M.today } });
                ops.push({ op: 'new', id: 'Журнал подтверждений', up: 1, fields: P.journalEntry(M, r, 'Напоминание', 'Ссылка в Telegram ' + (e.messenger || '')) });
            });
            P.batch(ops).then(function () { close(); P.toast('Напоминание записано: ' + open.length); reload(); }).catch(function (x) { P.toast(x.message, true); });
            return false;
        } }]);
    }
    function launchDlg(M, reload) {
        var scope = C.campaignScope(M.ctrls, M.emps);
        var name = P.input('text', 'Декабрь 2026'), from = P.input('date', '2026-12-01'), to = P.input('date', '2026-12-31'), due = P.input('date', '2027-01-15');
        var body = P.el('div', {}, [P.field('Название', name), P.el('div', { 'class': 'grc-bar' }, [P.field('Период с', from), P.field('Период по', to), P.field('Срок ответа', due)]),
            P.el('p', { html: 'В кампанию попадут <b>' + scope.take.length + '</b> контролей у ' + Object.keys(scope.take.reduce(function (m, t) { m[t.owner] = 1; return m; }, {})).length + ' владельцев.' }),
            scope.skip.length ? P.el('div', { 'class': 'grc-gaps' }, [P.el('b', { text: 'Не попадут: ' })].concat(scope.skip.map(function (s) { return P.el('span', { 'class': 'grc-gap', text: s.control + ': ' + s.why }); }))) : null]);
        P.modal('Запустить кампанию подтверждения', body, [{ text: 'Отмена' }, { text: 'Запустить и разослать ссылки', cls: 'grc-primary', keep: true, fn: function (close) {
            var n = name.value.trim();
            if (!n || !from.value || !to.value || !due.value) { P.toast('Заполните название, период и срок', true); return false; }
            if (M.campBy[n]) { P.toast('Кампания «' + n + '» уже есть', true); return false; }
            var pre = 'C' + M.today.replace(/-/g, '').slice(2), used = {}; M.reqs.forEach(function (r) { used[r.code] = 1; });
            for (var k = 0; scope.take.some(function (t) { return used[pre + '/' + t.control]; }); k++) pre = 'C' + M.today.replace(/-/g, '').slice(2) + String.fromCharCode(97 + k);
            var ops = M.camps.filter(function (c) { return c.status === 'Идёт'; }).map(function (c) { return { op: 'set', id: c.id, fields: { 'Статус кампании': 'Закрыта' } }; });
            var me = M.empByLogin[P.ctx.user];
            ops.push({ op: 'new', id: 'Кампания подтверждения', up: 1, fields: { 'Кампания подтверждения': n, 'Период с': from.value, 'Период по': to.value, 'Срок ответа': due.value, 'Дата запуска': M.today, 'Статус кампании': 'Идёт', 'Кто запустил': me ? me.name : P.ctx.user } });
            scope.take.forEach(function (t) {
                var code = pre + '/' + t.control, e = M.empByLogin[t.owner] || {};
                ops.push({ op: 'new', id: 'Запрос подтверждения', up: 1, fields: { 'Запрос подтверждения': code, 'Кампания подтверждения': n, 'Контроль': t.control, 'Логин владельца': t.owner, 'Напоминаний': 0 } });
                ops.push({ op: 'new', id: 'Журнал подтверждений', up: 1, fields: P.journalEntry(M, { code: code, owner: t.owner }, 'Запрос отправлен', 'Ссылка на форму подтверждения отправлена в Telegram ' + (e.messenger || '')) });
            });
            P.batch(ops).then(function () { close(); sel = n; P.toast('Кампания запущена: ' + scope.take.length + ' запросов'); reload(); }).catch(function (x) { P.toast(x.message, true); });
            return false;
        } }]);
    }
    P.mount(function (host, M, reload) { render(host, M, reload); });
})();
