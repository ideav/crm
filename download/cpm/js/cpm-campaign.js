/* CPM: бюджетная кампания - кто сдал, кто просрочил, замечания правил, приём и возврат с комментарием, замок версии. */
(function () {
    'use strict';
    var P = window.Cpm, C = P.core;
    var STATE = { ok: ['утверждён', 'ok'], review: ['ждёт проверки', 'info'], late: ['просрочен', 'crit'], back: ['на доработке', 'warn'], work: ['заполняется', 'mute'] };
    function render(host, M) {
        var h = P.hash();
        var version = h.v && M.verBy[h.v] ? h.v : P.CUR, ver = M.verBy[version];
        var list = C.campaign(M.budgets.filter(function (b) { return b.version === version; }), P.TODAY);
        var order = {}; M.cfos.forEach(function (c, i) { order[c.name] = i; });
        list.sort(function (a, b) { return order[a.cfo] - order[b.cfo]; });
        var sum = C.campaignSummary(list);
        var baseName = ver.year === 2027 ? P.PLAN : null;
        list.forEach(function (b) {
            var g = C.grid(M.rows, b.cfo, version).values, base = baseName ? C.grid(M.rows, b.cfo, baseName).values : {};
            var iss = Object.keys(g).length ? C.checkGrid(g, base, M.rules) : [];
            b.errors = iss.filter(function (i) { return i.level === 'error'; }).length; b.warns = iss.length - b.errors;
            b.entity = (M.cfoBy[b.cfo] || {}).entity; b.head = (M.cfoBy[b.cfo] || {}).head;
        });
        host.innerHTML = '';
        P.head('Бюджетная кампания', version + ': статус сдачи по ЦФО на ' + P.date(P.TODAY) + '. Финансист видит замечания правил до открытия формы, принимает или возвращает с комментарием; финансовый директор ставит замок на утверждённую версию.').forEach(function (n) { host.appendChild(n); });
        var vs = P.select(M.versions.filter(function (v) { return v.kind === 'План'; }).map(function (v) { return v.name; }), version);
        vs.addEventListener('change', function () { location.hash = 'v=' + encodeURIComponent(vs.value); });
        host.appendChild(P.el('div', { 'class': 'cpm-toolbar' }, [P.field('Версия', vs), P.el('div', { 'class': 'cpm-grow', html: ver.locked ? P.badge('замок: версия утверждена ' + P.date(ver.approved), 'ok') : P.badge(ver.status, 'info') })]));
        host.appendChild(P.el('div', { 'class': 'cpm-kpis' }, [
            P.kpi('Сдали', sum.done + ' из ' + sum.total, 'срок круга 27.11', sum.done === sum.total ? 'good' : ''),
            P.kpi('Утверждено', String(sum.approved), 'принято финансистом', sum.approved === sum.total ? 'good' : ''),
            P.kpi('Просрочено', String(sum.late), sum.late ? 'срок прошёл, бюджета нет' : 'нет', sum.late ? 'bad' : 'good'),
            P.kpi('На доработке', String(sum.back), 'возвращены с комментарием', sum.back ? 'warn' : ''),
            P.kpi('Замечания правил', String(list.reduce(function (a, b) { return a + b.errors + b.warns; }, 0)), 'ошибок ' + list.reduce(function (a, b) { return a + b.errors; }, 0) + ', остальное - предупреждения')
        ]));
        var can = M.isFinance && !ver.locked;
        host.appendChild(P.table([
            { t: 'ЦФО', html: function (b) { return '<a href="' + P.esc(P.nav('form', 'cfo=' + encodeURIComponent(b.cfo) + '&v=' + encodeURIComponent(version))) + '">' + P.esc(b.cfo) + '</a><div class="cpm-muted" style="font-size:12px">' + P.esc(b.head || '') + '</div>'; } },
            { t: 'Статус', html: function (b) { var s = STATE[b.state]; return P.badge(b.status, P.STATUS_KIND[b.status]) + (b.late ? ' ' + P.badge(s[0], s[1]) : ''); } },
            { t: 'Срок', html: function (b) { return P.date(b.deadline); }, cls: function (b) { return b.late ? 'cpm-up' : ''; } },
            { t: 'Сдан', html: function (b) { return P.date(b.submitted); } },
            { t: 'Напоминаний', k: 'reminders', num: true },
            { t: 'Правила', html: function (b) { return b.errors ? P.badge('ошибок ' + b.errors, 'crit') : b.warns ? P.badge('проверить ' + b.warns, 'warn') : (b.done || b.status === 'Черновик' ? P.badge('чисто', 'ok') : ''); } },
            { t: 'Комментарий', html: function (b) { return P.esc(b.comment || ''); } },
            { t: '', html: function () { return ''; }, cls: function () { return 'cpm-acts'; } }
        ], list, { empty: 'В версии нет бюджетов ЦФО' }));
        var rowsEl = host.querySelectorAll('tbody tr');
        list.forEach(function (b, i) {
            var td = rowsEl[i] && rowsEl[i].lastChild; if (!td || !can) return;
            if (b.status === 'Сдан') { td.appendChild(P.btn('Принять', function () { act(b, { 'Статус сдачи': 'Утверждён' }, b.cfo + ': принят финансистом'); }, 'cpm-small cpm-primary')); td.appendChild(P.btn('Вернуть', function () { back(b); }, 'cpm-small')); }
            else if (!b.done) td.appendChild(P.btn('Напомнить', function () { act(b, { 'Напоминаний': b.reminders + 1 }, b.cfo + ': напоминание о сроке ' + P.date(b.deadline) + ' (' + (b.reminders + 1) + '-е)'); }, 'cpm-small'));
        });
        if (M.isFD && !ver.locked) {
            var box = P.el('div', { 'class': 'cpm-note' + (sum.canLock ? ' cpm-good' : '') });
            box.appendChild(P.el('div', { html: sum.canLock ? '<b>Все ЦФО утверждены.</b> Поставьте замок: версия станет утверждённой, правка только новой версией.' : '<b>Замок версии</b> доступен, когда утверждены все ' + sum.total + ' ЦФО. Осталось: ' + P.esc(list.filter(function (b) { return b.status !== 'Утверждён' && b.status !== 'Принят'; }).map(function (b) { return b.cfo; }).join(', ')) + '.' }));
            var lockBtn = P.btn('Утвердить версию и поставить замок', function () {
                P.update(ver.id, { 'Замок версии': '1', 'Статус версии': 'Утверждена', 'Утверждена': P.TODAY }).then(function () { return P.log(version + ': утверждена, замок поставлен'); }).then(function () { P.toast('Версия утверждена'); P.mount(render); }).catch(function (e) { P.toast(e.message, true); });
            }, 'cpm-primary');
            lockBtn.disabled = !sum.canLock; box.appendChild(lockBtn);
            host.appendChild(box);
        }
        host.appendChild(P.el('h2', { text: 'Журнал изменений' }));
        host.appendChild(P.table([{ t: 'Когда', k: 'at' }, { t: 'Кто', k: 'author' }, { t: 'Что', k: 'text' }], M.journal.filter(function (j) { return !j.version || j.version === version; }).slice(0, 15), { empty: 'Записей нет' }));
        function act(b, fields, text) {
            P.update(b.id, fields).then(function () { return P.log(text, b.cfo, version); }).then(function () { P.toast(text); P.mount(render); }).catch(function (e) { P.toast(e.message, true); });
        }
        function back(b) {
            var ta = P.el('textarea', { rows: 3, style: 'width:100%' });
            P.modal('Вернуть бюджет «' + b.cfo + '» на доработку', P.field('Что исправить', ta), [{ text: 'Отмена' }, { text: 'Вернуть', cls: 'cpm-primary', fn: function () {
                if (!ta.value.trim()) { P.toast('Напишите, что исправить', true); return false; }
                act(b, { 'Статус сдачи': 'Возвращён', 'Комментарий финансиста': ta.value.trim() }, b.cfo + ': возвращён на доработку (' + ta.value.trim() + ')');
            } }]);
        }
    }
    P.mount(render);
    window.addEventListener('hashchange', function () { P.mount(render); });
})();
