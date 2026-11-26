/* Бизнес-клуб: рассылки по сегментам - все активные, должники, участники события, продление, новые. */
(function () {
    'use strict';
    var N = window.Netclub, C = N.core;

    function compose(M) {
        var seg = N.select(C.SEGMENTS, 'Все активные'), ev = N.select(M.events.map(function (e) { return [e.name, C.toDmy(e.date) + ' · ' + e.name]; }), (M.events.filter(function (e) { return e.date >= N.TODAY; })[0] || {}).name);
        var ch = N.select(['Telegram', 'Email', 'SMS'], 'Telegram'), subj = N.input('text', ''), txt = N.input('textarea', '', { rows: 5 });
        var evField = N.field('Событие', ev), cnt = N.el('div', { 'class': 'nc-okline' });
        var who = [];
        function upd() {
            evField.style.display = seg.value === 'Участники события' ? '' : 'none';
            who = C.segmentRecipients(seg.value, { today: N.TODAY, members: M.members, fees: M.fees, regs: M.regs, event: ev.value, days: M.settings.renewDays });
            cnt.textContent = 'Получателей: ' + who.length + (who.length ? ' — ' + who.slice(0, 6).map(function (m) { return m.name.split(' ').slice(0, 2).join(' '); }).join(', ') + (who.length > 6 ? ' и ещё ' + (who.length - 6) : '') : '');
            if (!subj.dataset.touched) subj.value = { 'Все активные': 'Новости клуба', 'Должники': 'Напоминание об оплате взноса', 'Участники события': 'Событие «' + ev.value + '»', 'Продление в ближайшие дни': 'Продление членства', 'Новые участники': 'Добро пожаловать в клуб' }[seg.value];
        }
        subj.oninput = function () { subj.dataset.touched = 1; };
        seg.onchange = upd; ev.onchange = upd; upd();
        N.modal('Новая рассылка', N.el('div', {}, [N.field('Сегмент', seg), evField, N.field('Канал', ch), N.field('Тема', subj), N.field('Текст', txt), cnt,
            N.el('p', { 'class': 'nc-muted', text: 'Рассылка сохраняется со списком получателей. Отправка в Telegram-бот или почту — подключаемая опция.' })]),
            [{ text: 'Отмена' }, { text: 'Сохранить и отправить', cls: 'nc-primary', fn: function () {
                if (!txt.value.trim()) { N.toast('Напишите текст рассылки', true); return false; }
                if (!who.length) { N.toast('В сегменте нет получателей', true); return false; }
                var f = { 'Рассылка': subj.value || 'Рассылка ' + C.toDmy(N.TODAY), 'Сегмент рассылки': seg.value, 'Канал рассылки': ch.value, 'Текст рассылки': txt.value.trim(), 'Дата рассылки': N.TODAY, 'Получателей': who.length,
                    'Список получателей': who.map(function (m) { return m.name; }).join('\n'), 'Отправил': N.ctx.user };
                if (seg.value === 'Участники события') f['Событие'] = M.eventBy[ev.value].id;
                return N.create('Рассылка', f).then(function () { N.toast('Рассылка «' + f['Рассылка'] + '»: ' + who.length + ' ' + C.plural(who.length, 'получатель', 'получателя', 'получателей')); N.refresh(); });
            } }], true);
    }

    N.mount(function (host, M) {
        if (!M.mailings) { host.appendChild(N.el('p', { text: 'Рассылки ведут организатор и менеджер клуба.' })); return; }
        N.head('Рассылки', 'Сообщения по сегментам: все активные, должники, участники события, у кого скоро продление, новые участники.').forEach(function (x) { host.appendChild(x); });
        var ctx = { today: N.TODAY, members: M.members, fees: M.fees, regs: M.regs, days: M.settings.renewDays };
        host.appendChild(N.el('div', { 'class': 'nc-kpis' }, ['Все активные', 'Должники', 'Продление в ближайшие дни', 'Новые участники'].map(function (s) { return N.kpi(s, String(C.segmentRecipients(s, ctx).length), 'получателей сейчас'); })));
        host.appendChild(N.el('div', { 'class': 'nc-bar' }, [N.el('h2', { 'class': 'nc-grow', text: 'Отправленные' }), N.btn('Новая рассылка', function () { compose(M); }, 'nc-primary')]));
        host.appendChild(N.table([{ t: 'Дата', html: function (r) { return C.toDmy(r.date); } }, { t: 'Тема', k: 'name' }, { t: 'Сегмент', html: function (r) { return N.badge(r.segment, r.segment === 'Должники' ? 'warn' : 'info') + (r.event ? '<div class="nc-muted">' + N.esc(r.event) + '</div>' : ''); } },
            { t: 'Канал', k: 'channel' }, { t: 'Получателей', num: 1, k: 'count' }, { t: 'Отправил', k: 'by' }], M.mailings.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }),
            { onrow: function (r) { N.modal(r.name, N.el('div', {}, [N.el('p', { text: r.text }), r.list ? N.el('pre', { 'class': 'nc-pre', text: r.list }) : N.el('p', { 'class': 'nc-muted', text: 'Получателей: ' + r.count })])); } }));
    });
})();
