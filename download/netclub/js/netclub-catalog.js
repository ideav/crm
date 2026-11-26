/* Бизнес-клуб: закрытый каталог участников - «чем занимаюсь / что ищу / чем могу помочь», поиск, запрос на знакомство через менеджера. */
(function () {
    'use strict';
    var N = window.Netclub, C = N.core;
    var EXAMPLES = ['ищу бухгалтера по ЭДО', 'доставка в Казахстан', 'упаковка для кофеен', 'помещение под кафе', 'маркетплейсы'];
    var INTRO_KIND = { 'Отправлен': 'warn', 'Передан участнику': 'info', 'Встреча состоялась': 'ok', 'Отклонён': 'muted' };

    function vis(M, f) { return C.catalogFieldVisible(N.rk, f, M.settings); }
    function profile(M, m) {
        var rows = [['Компания', m.company], ['Должность', m.position], ['Сфера', m.sphere], ['Город', m.city], ['Чем занимаюсь', m.does], ['Что ищу', m.seeks], ['Чем могу помочь', m.offers], ['Телефон', m.phone], ['Email', m.email]]
            .filter(function (x) { return x[1] && (x[0] === 'Телефон' || x[0] === 'Email' ? N.isStaff() : vis(M, x[0])); });
        var reason = N.input('textarea', '', { rows: 3, placeholder: 'Например: нужна бухгалтерия на аутсорс с переводом на ЭДО для 9 кофеен' });
        var body = N.el('div', {}, [N.el('dl', { 'class': 'nc-dl' }, [].concat.apply([], rows.map(function (x) { return [N.el('dt', { text: x[0] }), N.el('dd', { text: x[1] })]; }))),
            M.me && M.me.name !== m.name ? N.field('Повод для знакомства', reason, 'Менеджер клуба передаст запрос и договорится о встрече. Контакты участника не раскрываются без его согласия.') : null]);
        var bt = [{ text: 'Закрыть' }];
        if (M.me && M.me.name !== m.name) bt.push({ text: 'Запросить знакомство', cls: 'nc-primary', fn: function () {
            if (!reason.value.trim()) { N.toast('Напишите повод — так участник быстрее согласится', true); return false; }
            return N.create('Запрос на знакомство', { 'Запрос на знакомство': 'ЗН-' + N.TODAY.slice(5).replace('-', '') + '-' + String(Date.now()).slice(-4), 'Инициатор': M.me.id, 'Кому знакомство': m.name, 'Повод знакомства': reason.value.trim(), 'Статус знакомства': 'Отправлен', 'Дата запроса': N.TODAY, 'Логин участника': N.ctx.user })
                .then(function () { N.toast('Запрос отправлен менеджеру клуба: знакомство с ' + m.name); N.refresh(); });
        } });
        N.modal(m.name, body, bt, true);
    }
    function cardOf(M, x) {
        var m = x.member, hl = function (t) { var s = N.esc(t); x.hits.forEach(function (h) { s = s.replace(new RegExp('(^|[^а-яёa-z0-9])(' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[а-яёa-z0-9]*)', 'gi'), '$1<mark>$2</mark>'); }); return s; };
        return N.el('button', { type: 'button', 'class': 'nc-card', onclick: function () { profile(M, m); } }, [
            N.el('b', { text: m.name }), N.el('div', { 'class': 'nc-muted', text: [vis(M, 'Должность') && m.position, vis(M, 'Компания') && m.company].filter(Boolean).join(', ') }),
            N.el('div', { html: (vis(M, 'Сфера') && m.sphere ? N.badge(m.sphere, 'info') : '') + (vis(M, 'Город') && m.city ? ' ' + N.badge(m.city, 'muted') : '') }),
            vis(M, 'Чем могу помочь') && m.offers ? N.el('p', { html: '<span class="nc-muted">Помогу:</span> ' + hl(m.offers) }) : null,
            vis(M, 'Что ищу') && m.seeks ? N.el('p', { html: '<span class="nc-muted">Ищу:</span> ' + hl(m.seeks) }) : null]);
    }
    function introsTable(M, list, staff) {
        return N.table([{ t: 'Дата', html: function (z) { return C.toDmy(z.date); } }, staff ? { t: 'Кто', k: 'from' } : null, { t: 'С кем', k: 'to' }, { t: 'Повод', k: 'reason' },
            { t: 'Статус', html: function (z) { return N.badge(z.status, INTRO_KIND[z.status]); } },
            staff ? { t: '', node: function (z) {
                var next = { 'Отправлен': 'Передан участнику', 'Передан участнику': 'Встреча состоялась' }[z.status];
                var box = N.el('div', { 'class': 'nc-actions' });
                if (next) box.appendChild(N.btn(next, function () { N.update(z.id, { 'Статус знакомства': next }).then(function () { N.toast(z.from + ' → ' + z.to + ': ' + next.toLowerCase()); N.refresh(); }); }, 'nc-small nc-primary'));
                if (z.status === 'Отправлен' || z.status === 'Передан участнику') box.appendChild(N.btn('Отклонён', function () { N.update(z.id, { 'Статус знакомства': 'Отклонён' }).then(function () { N.refresh(); }); }, 'nc-small'));
                return box;
            } } : null].filter(Boolean), list.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }), { empty: 'Запросов пока нет' });
    }

    N.mount(function (host, M) {
        N.head('Каталог участников', 'Закрытый каталог: кто чем занимается, кого ищет и чем может помочь. Ищите обычными словами — по профилю, сфере и компании.').forEach(function (x) { host.appendChild(x); });
        var hash = decodeURIComponent((location.hash.match(/q=([^&]*)/) || [])[1] || '');
        var q = N.input('search', hash, { placeholder: 'Например: ищу бухгалтера по ЭДО', 'class': 'nc-search' });
        var sp = N.select([['', 'Все сферы']].concat(M.spheres), '');
        var out = N.el('div'), info = N.el('p', { 'class': 'nc-muted' });
        var draw = function () {
            var r = C.searchCatalog(M.members, q.value, { sphere: sp.value, exclude: M.me ? M.me.name : '' });
            info.textContent = q.value.trim() ? 'Найдено: ' + r.length + (r.length ? '. Сначала те, у кого совпали все слова запроса.' : '. Попробуйте другие слова или напишите менеджеру — он подскажет.') : 'Участников в каталоге: ' + r.length;
            out.innerHTML = ''; out.appendChild(N.el('div', { 'class': 'nc-cards' }, r.map(function (x) { return cardOf(M, x); })));
        };
        var t = null; q.oninput = function () { clearTimeout(t); t = setTimeout(draw, 150); }; sp.onchange = draw;
        host.appendChild(N.el('div', { 'class': 'nc-bar' }, [N.el('div', { 'class': 'nc-grow' }, [N.field('Поиск', q)]), N.field('Сфера', sp)]));
        host.appendChild(N.el('div', { 'class': 'nc-chips' }, EXAMPLES.map(function (e) { return N.btn(e, function () { q.value = e; draw(); }, 'nc-chip'); })));
        host.appendChild(info); host.appendChild(out); draw();
        host.appendChild(N.el('h2', { text: N.isStaff() ? 'Запросы на знакомство' : 'Мои запросы на знакомство' }));
        host.appendChild(introsTable(M, M.intros, N.isStaff()));
    });
})();
