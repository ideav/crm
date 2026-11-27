/* CPM: заявки на оплату - остаток лимита статьи виден в момент заявки, превышение уходит финансовому директору. */
(function () {
    'use strict';
    var P = window.Cpm, C = P.core;
    var MONTH = '2026-11-01';
    function render(host, M) {
        var reqs = M.requests.filter(function (q) { return q.date.slice(0, 7) === MONTH.slice(0, 7); });
        var cfos = M.isHead ? [M.myCfo] : M.cfos.map(function (c) { return c.name; });
        host.innerHTML = '';
        P.head('Заявки на оплату', 'Лимит статьи на месяц - утверждённый бюджет 2026 года. В момент заявки видно, сколько осталось; в пределах лимита заявка согласуется сама, сверх лимита - уходит финансовому директору с суммой превышения. Ноябрь 2026.').forEach(function (n) { host.appendChild(n); });
        var wait = reqs.filter(function (q) { return q.status === 'На согласовании у ФД'; });
        if (!M.readOnly) host.appendChild(newForm());
        if (wait.length) {
            host.appendChild(P.el('h2', { text: 'Ждут решения финансового директора (' + wait.length + ')' }));
            host.appendChild(P.table([{ t: 'Заявка', k: 'num' }, { t: 'ЦФО', k: 'cfo' }, { t: 'Статья', k: 'article' }, { t: 'Контрагент', k: 'counterparty' }, { t: 'Сумма', num: true, html: function (q) { return P.money(q.amount); } },
                { t: 'Превышение', num: true, html: function (q) { var s = C.limitState(M.rows, P.PLAN, M.requests, q.cfo, q.article, q.date, q.amount, q.id); return '<span class="cpm-up">' + P.money(s.overBy) + '</span>'; } },
                { t: 'Инициатор', k: 'author' }, { t: '', html: function () { return ''; } }], wait));
            var trs = host.querySelectorAll('.cpm-table')[0].querySelectorAll('tbody tr');
            if (M.isFD) wait.forEach(function (q, i) {
                trs[i].lastChild.appendChild(P.btn('Согласовать', function () { decide(q, true); }, 'cpm-small cpm-primary'));
                trs[i].lastChild.appendChild(P.btn('Отклонить', function () { decide(q, false); }, 'cpm-small'));
            });
        }
        /* лимиты */
        var lim = [];
        cfos.forEach(function (c) {
            M.articles.forEach(function (a) {
                if (a.kind !== 'Расход' || a.intra) return;
                var s = C.limitState(M.rows, P.PLAN, M.requests, c, a.name, MONTH, 0);
                if (s.limit || s.used) lim.push(Object.assign({ cfo: c, article: a.name, share: s.limit ? s.used / s.limit * 100 : null }, s));
            });
        });
        lim.sort(function (a, b) { return (b.share || 0) - (a.share || 0); });
        host.appendChild(P.el('h2', { text: 'Лимиты ноября по статьям' }));
        host.appendChild(P.table([{ t: 'ЦФО', k: 'cfo' }, { t: 'Статья', k: 'article' }, { t: 'Лимит', num: true, html: function (r) { return P.money(r.limit); } }, { t: 'Оплачено и согласовано', num: true, html: function (r) { return P.money(r.used); } },
            { t: 'Ждёт решения', num: true, html: function (r) { return r.pending ? P.money(r.pending) : ''; } }, { t: 'Остаток', num: true, html: function (r) { return P.money(r.rest); }, cls: function (r) { return r.rest < 0 ? 'cpm-up' : ''; } },
            { t: 'Использовано', num: true, html: function (r) { return r.share === null ? '' : P.badge(P.pct(r.share), r.share > 100 ? 'crit' : r.share > 85 ? 'warn' : 'ok'); } }], lim.filter(function (r) { return r.used || r.pending || M.isHead; }), { empty: 'В ноябре заявок нет' }));
        host.appendChild(P.el('h2', { text: 'Заявки ноября' }));
        host.appendChild(P.table([{ t: 'Заявка', k: 'num' }, { t: 'ЦФО', k: 'cfo' }, { t: 'Статья', k: 'article' }, { t: 'Контрагент', k: 'counterparty' }, { t: 'Сумма', num: true, html: function (q) { return P.money(q.amount); } },
            { t: 'Платёж', html: function (q) { return P.date(q.date); } }, { t: 'Статус', html: function (q) { return P.badge(q.status, /Оплачена|Согласована/.test(q.status) ? 'ok' : q.status === 'Отклонена' ? 'crit' : 'warn') + (q.over ? ' ' + P.badge('сверх лимита', 'warn') : ''); } },
            { t: 'Решение ФД', k: 'decision' }], reqs.slice().reverse()));

        function newForm() {
            var card = P.el('div', { 'class': 'cpm-card', style: 'max-width:760px' }, [P.el('h3', { text: 'Новая заявка' })]);
            var cfoSel = P.select(cfos, cfos[0]);
            var artSel = P.select([]);
            function fillArts() {
                var list = M.articles.filter(function (a) { return a.kind === 'Расход' && !a.intra && C.limitState(M.rows, P.PLAN, [], cfoSel.value, a.name, MONTH, 0).limit > 0; });
                artSel.innerHTML = ''; list.forEach(function (a) { artSel.appendChild(P.el('option', { value: a.name, text: a.code + ' ' + a.name })); });
            }
            fillArts();
            var who = P.input('text', '', { placeholder: 'ООО «...»' }), amt = P.input('text', '', { inputmode: 'decimal', placeholder: '0' }), dt = P.input('date', P.TODAY, { min: '2026-11-01', max: '2026-11-30' });
            var panel = P.el('div'), sendBtn = P.btn('Отправить', send, 'cpm-primary');
            card.appendChild(P.el('div', { 'class': 'cpm-grid2' }, [P.field('ЦФО', cfoSel), P.field('Статья бюджета', artSel), P.field('Контрагент', who), P.field('Сумма, ₽', amt), P.field('Дата платежа', dt)]));
            card.appendChild(panel); card.appendChild(sendBtn);
            function st() { return C.limitState(M.rows, P.PLAN, M.requests, cfoSel.value, artSel.value, dt.value || P.TODAY, C.num(amt.value)); }
            function upd() {
                var s = st();
                panel.innerHTML = '';
                panel.appendChild(P.el('div', { 'class': 'cpm-limit' }, [['Лимит месяца', s.limit], ['Оплачено и согласовано', s.used], ['Ждёт решения ФД', s.pending], ['Остаток', s.rest], ['После заявки', s.after]].map(function (x) { return P.el('div', { html: '<b' + (x[1] < 0 ? ' class="cpm-up"' : '') + '>' + P.money(x[1]) + '</b><span>' + x[0] + '</span>' }); })));
                if (s.over) panel.appendChild(P.el('div', { 'class': 'cpm-note cpm-bad', html: '<b>Сверх лимита на ' + P.money(s.overBy) + '.</b> Заявка уйдёт финансовому директору: он видит остаток и решает сразу, без переписки.' }));
                sendBtn.textContent = s.over ? 'Отправить финансовому директору' : 'Отправить (в пределах лимита)';
            }
            [cfoSel, artSel, amt, dt].forEach(function (e) { e.addEventListener('input', upd); e.addEventListener('change', upd); });
            cfoSel.addEventListener('change', function () { fillArts(); upd(); });
            upd();
            function send() {
                var s = st(), sum = C.num(amt.value);
                if (!(sum > 0) || !who.value.trim()) { P.toast('Укажите контрагента и сумму', true); return; }
                var max = 0; M.requests.forEach(function (q) { var n = parseInt(String(q.num).replace(/\D/g, ''), 10); if (n > max) max = n; });
                var f = { 'Заявка на оплату': 'ЗО-' + (max + 1), 'ЦФО': M.cfoBy[cfoSel.value].id, 'Статья бюджета': M.artIds[artSel.value], 'Контрагент': who.value.trim(), 'Сумма заявки': sum, 'Дата платежа': dt.value, 'Статус заявки': s.over ? 'На согласовании у ФД' : 'Согласована', 'Инициатор': P.ctx.user, 'Сверх лимита': s.over ? '1' : '' };
                P.create('Заявка на оплату', f).then(function () { return P.log('Заявка ЗО-' + (max + 1) + ' ' + cfoSel.value + ' / ' + artSel.value + ': ' + P.money(sum) + (s.over ? ', сверх лимита на ' + P.money(s.overBy) + ' - к финдиректору' : ', в пределах лимита'), cfoSel.value); })
                    .then(function () { P.toast(s.over ? 'Заявка ушла финансовому директору' : 'Заявка согласована в пределах лимита'); P.mount(render); }).catch(function (e) { P.toast(e.message, true); });
            }
            return card;
        }
        function decide(q, yes) {
            var ta = P.el('textarea', { rows: 2, style: 'width:100%' });
            P.modal((yes ? 'Согласовать сверх лимита: ' : 'Отклонить: ') + q.num, P.field('Комментарий', ta), [{ text: 'Отмена' }, { text: yes ? 'Согласовать' : 'Отклонить', cls: 'cpm-primary', fn: function () {
                P.update(q.id, { 'Статус заявки': yes ? 'Согласована сверх лимита' : 'Отклонена', 'Решение ФД': ta.value.trim() || (yes ? 'Согласовано' : 'Отклонено') })
                    .then(function () { return P.log(q.num + ': ' + (yes ? 'согласована сверх лимита' : 'отклонена') + ' финдиректором', q.cfo); }).then(function () { P.toast('Решение записано'); P.mount(render); }).catch(function (e) { P.toast(e.message, true); });
            } }]);
        }
    }
    P.mount(render);
})();
