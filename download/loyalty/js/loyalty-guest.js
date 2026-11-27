/* Карточка гостя: все счета, партии со сроком, правило гостя, RFM, тестовый чек с переключателем механики, история и ручная операция. */
(function () {
    'use strict';
    var P = window.Loy, C = P.core;
    var state = { mech: null, sum: 640, drinks: 2, promo: '', want: 0 };
    P.mount(function (host, M) {
        var pick = P.hash().g || (M.guestBy['Соколова Анна Сергеевна'] ? 'Соколова Анна Сергеевна' : (M.guests[0] || {}).name);
        state.mech = state.mech || M.program.mech;
        function draw(name) {
            host.innerHTML = '';
            host.appendChild(P.el('div', {}, P.head('Карточка гостя', 'Все счета гостя, его сегмент и правило на одном экране. Найдите гостя по фамилии, телефону или номеру карты.')));
            host.appendChild(searchBox(M, draw));
            var g = M.guestBy[name];
            if (!g) { host.appendChild(P.el('p', { 'class': 'loy-muted', text: 'Гость не найден.' })); return; }
            if (location.hash !== '#g=' + encodeURIComponent(name)) history.replaceState(null, '', '#g=' + encodeURIComponent(name));
            var s = M.st[name], L = s.lots, rule = C.ruleFor(M.program, g);
            var head = P.el('div', { 'class': 'loy-ghead' }, [P.el('h2', { text: g.name }), P.el('span', { html: P.seg(s.rfm.segment) }),
                P.el('span', { 'class': 'loy-muted', text: [g.card, g.phone, 'точка ' + g.point, s.v.last ? 'последний визит ' + C.toDmy(s.v.last) + ' (' + s.rfm.days + ' дн. назад)' : 'визитов нет'].filter(Boolean).join(' · ') })]);
            host.appendChild(head);
            var grid = P.el('div', { 'class': 'loy-grid3' });
            grid.appendChild(accounts(M, g, s, L));
            grid.appendChild(ruleCard(M, g, s, rule));
            grid.appendChild(receipt(M, g, s, L));
            host.appendChild(grid);
            host.appendChild(historyBox(M, g));
        }
        draw(pick);
    });

    function searchBox(M, draw) {
        var inp = P.input('search', '', { placeholder: 'Фамилия, телефон или карта', 'aria-label': 'Поиск гостя' }), list = P.el('div', { 'class': 'loy-suggest', hidden: 'hidden' });
        inp.addEventListener('input', function () {
            var q = inp.value.trim().toLowerCase().replace(/\s/g, '');
            list.innerHTML = '';
            if (q.length < 2) { list.hidden = true; return; }
            var hits = M.guests.filter(function (g) { return (g.name + g.card + (g.phone || '')).toLowerCase().replace(/\s/g, '').indexOf(q) >= 0; }).slice(0, 12);
            hits.forEach(function (g) { list.appendChild(P.el('div', { text: g.name + ' · ' + g.card, onclick: function () { draw(g.name); } })); });
            if (!hits.length) list.appendChild(P.el('div', { 'class': 'loy-muted', text: 'Никого не нашли' }));
            list.hidden = false;
        });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !list.hidden && list.firstChild) list.firstChild.click(); });
        var quick = P.el('span', { 'class': 'loy-muted' }, ['Примеры: ', link('Соколова Анна Сергеевна', draw), ', ', link('Морозов Илья Андреевич', draw), ', ', link('Тарасов Глеб Викторович', draw)]);
        return P.el('div', { 'class': 'loy-search' }, [inp, list, quick]);
    }
    function link(name, draw) { return P.el('a', { href: '#g=' + encodeURIComponent(name), text: name.split(' ').slice(0, 2).join(' '), onclick: function (e) { e.preventDefault(); draw(name); } }); }

    function accounts(M, g, s, L) {
        var soon = L.expiring(14), lim14 = C.addDays(M.today, 14);
        var card = P.el('div', { 'class': 'loy-card' }, [P.el('h3', { text: 'Счета гостя' })]);
        card.appendChild(P.el('div', { 'class': 'loy-kpis' }, [
            P.kpi('бонусов на счёте', P.bonus(L.balance), '1 бонус = 1 ₽', ''),
            P.kpi('сгорит за 14 дней', P.bonus(soon), L.nextBurn ? 'ближайшая партия ' + C.toDmy(L.nextBurn.expires) : 'нет партий', soon > 0 ? 'bad' : '')]));
        if (M.program.mech === 'nth' || state.mech === 'nth') card.appendChild(P.el('div', { 'class': 'loy-kv' }, [P.el('span', { text: 'Штампы до подарка' }), P.el('b', { text: (s.v.drinks % M.program.nth) + ' из ' + M.program.nth })]));
        card.appendChild(P.el('div', { 'class': 'loy-kv' }, [P.el('span', { text: 'Предоплаченная карта' }), P.el('span', { 'class': 'loy-muted', text: 'опция, подключаем за день' })]));
        card.appendChild(P.el('h3', { text: 'Партии бонусов', style: 'margin-top:12px' }));
        if (!L.lots.length) card.appendChild(P.el('p', { 'class': 'loy-muted', text: 'Живых партий нет.' }));
        var sorted = L.lots.slice().sort(function (a, b) { return a.expires < b.expires ? -1 : 1; }), rest = sorted.slice(8);
        sorted.slice(0, 8).forEach(function (l) {
            card.appendChild(P.el('div', { 'class': 'loy-lot' + (l.expires && l.expires <= lim14 ? ' loy-soon' : '') }, [P.el('span', { text: 'от ' + C.toDmy(l.date) + ', сгорает ' + C.toDmy(l.expires) }), P.el('span', { text: P.bonus(l.left) + (l.left < l.amount ? ' из ' + P.bonus(l.amount) : '') })]));
        });
        if (rest.length) card.appendChild(P.el('div', { 'class': 'loy-lot loy-muted' }, [P.el('span', { text: 'ещё ' + rest.length + ' партий, до ' + C.toDmy(rest[rest.length - 1].expires) }), P.el('span', { text: P.bonus(rest.reduce(function (x, l) { return x + l.left; }, 0)) })]));
        return card;
    }
    function ruleCard(M, g, s, rule) {
        var card = P.el('div', { 'class': 'loy-card loy-rule' }, [P.el('h3', { text: 'Правило этого гостя' })]);
        card.appendChild(P.el('div', { 'class': 'loy-kv' }, [P.el('span', { text: 'Механика программы' }), P.el('b', { text: M.program.mechName })]));
        card.appendChild(P.el('div', { 'class': 'loy-kv' }, [P.el('span', { text: 'Кэшбэк' }), P.el('b', { text: rule.percent + '%' + (g.percent ? ' (личный)' : '') })]));
        card.appendChild(P.el('div', { 'class': 'loy-kv' }, [P.el('span', { text: 'Лимит списания' }), P.el('b', { text: rule.limit + '% чека' + (g.limit ? ' (личный)' : '') })]));
        card.appendChild(P.el('div', { 'class': 'loy-kv' }, [P.el('span', { text: 'Срок жизни бонусов' }), P.el('b', { text: M.program.life + ' дн.' })]));
        if (rule.text) card.appendChild(P.el('div', { 'class': 'loy-warnbox loy-g', text: rule.text }));
        var bd = M.promos.filter(function (p) { return /день рождения/i.test(p.cond || ''); })[0];
        if (bd && g.birthday && C.promoApplies(bd, C.addDays(M.today, 2), g.birthday)) card.appendChild(P.el('div', { 'class': 'loy-warnbox loy-w', text: 'День рождения ' + C.toDmy(g.birthday).slice(0, 5) + ': действует «' + bd.name + '», бонусами в этот чек платить нельзя.' }));
        if (!g.consent) card.appendChild(P.el('div', { 'class': 'loy-warnbox loy-e', text: 'Нет согласия на рассылку: писать гостю нельзя.' }));
        card.appendChild(P.el('h3', { text: 'RFM', style: 'margin-top:12px' }));
        card.appendChild(P.el('div', { 'class': 'loy-kv' }, [P.el('span', { text: 'Давность / частота / сумма' }), P.el('b', { text: 'R' + s.rfm.R + ' F' + s.rfm.F + ' M' + s.rfm.M })]));
        card.appendChild(P.el('div', { 'class': 'loy-kv' }, [P.el('span', { text: 'Визитов за 90 дней' }), P.el('b', { text: String(s.v.visits90) })]));
        card.appendChild(P.el('div', { 'class': 'loy-kv' }, [P.el('span', { text: 'Средний чек' }), P.el('b', { text: s.v.visits ? P.money(s.v.sum / s.v.visits) : '—' })]));
        var seg = M.segments.filter(function (x) { return x.name === s.rfm.segment; })[0];
        if (seg && seg.text) card.appendChild(P.el('div', { 'class': 'loy-warnbox loy-w', text: 'Что написать: ' + seg.text }));
        return card;
    }

    /* Тестовый чек: механика переключается на лету, правила гостя и акции считаются при вводе. */
    function receipt(M, g, s, L) {
        var card = P.el('div', { 'class': 'loy-card loy-receipt' }, [P.el('h3', { text: 'Тестовый чек' })]);
        var sw = P.el('div', { 'class': 'loy-mech', role: 'group', 'aria-label': 'Механика' });
        M.mechs.forEach(function (m) {
            var built = C.isBuilt(m.key);
            sw.appendChild(P.el('button', { type: 'button', 'class': (state.mech === m.key ? 'loy-on' : '') + (built ? '' : ' loy-opt'), title: built ? m.desc : 'Опция по запросу: подключаем за день', text: m.name, onclick: function () {
                if (!built) { P.toast('«' + m.name + '» - опция по запросу, подключаем за день. На демо считаем кэшбэк и N-ю в подарок.'); return; }
                state.mech = m.key; redraw();
            } }));
        });
        card.appendChild(sw);
        var sum = P.input('number', state.sum, { min: 0, step: 10 }), drinks = P.input('number', state.drinks, { min: 0, step: 1 }), want = P.input('number', state.want, { min: 0, step: 10 });
        var promo = P.select([['', 'без акции']].concat(M.promos.map(function (p) { return [p.name, p.name + (p.bonusAllowed ? '' : ' (без бонусов)')]; })), state.promo);
        card.appendChild(P.el('div', { 'class': 'loy-grid2' }, [P.field('Сумма чека, ₽', sum), P.field('Напитков', drinks), P.field('Акция', promo), P.field('Списать бонусов', want, 'до лимита гостя')]));
        var out = P.el('div', {});
        card.appendChild(out);
        var point = P.myPoint(M), canPost = P.canWrite('Чек') && P.canWrite('Бонусная операция');
        var pointSel = point ? null : P.select(M.points, g.point);
        if (canPost && pointSel) card.appendChild(P.field('Точка', pointSel));
        var post = canPost ? P.btn('Провести чек', function () { save(M, g, calc(), point || pointSel.value); }, 'loy-primary') : P.el('p', { 'class': 'loy-muted', text: 'Проводить чеки может касса и управляющий; здесь - только расчёт.' });
        card.appendChild(post);
        function calc() {
            state.sum = C.num(sum.value); state.drinks = C.num(drinks.value); state.want = C.num(want.value); state.promo = promo.value;
            return C.calcCheck({ sum: state.sum, drinks: state.drinks, wantBonus: state.want, date: M.today }, { program: M.program, person: g, promo: M.promoBy[state.promo], balance: L.balance, stamps: s.v.drinks, mech: state.mech });
        }
        function kv(a, b, cls) { return P.el('div', { 'class': 'loy-kv ' + (cls || '') }, [P.el('span', { text: a }), P.el('b', { text: b })]); }
        function redraw() {
            var r = calc(); out.innerHTML = '';
            out.appendChild(kv('Сумма', P.money(state.sum)));
            if (r.gift) out.appendChild(kv('Подарок: ' + r.gifts + ' напиток', '−' + P.money(r.gift)));
            if (r.discount) out.appendChild(kv('Скидка акции', '−' + P.money(r.discount)));
            out.appendChild(kv('Списано бонусами (можно ' + r.bonusMax + ')', '−' + P.money(r.bonusUsed)));
            out.appendChild(kv('К оплате', P.money(r.toPay), 'loy-total'));
            if (r.mech === 'cashback') out.appendChild(kv('Начислим бонусов (' + r.rule.percent + '%)', '+' + r.accrue));
            if (r.mech === 'nth') out.appendChild(kv('Штампов после чека', r.stampsAfter + ' из ' + M.program.nth));
            r.conflicts.forEach(function (t) { out.appendChild(P.el('div', { 'class': 'loy-warnbox loy-e', text: t })); });
            r.notes.forEach(function (t) { out.appendChild(P.el('div', { 'class': 'loy-warnbox loy-w', text: t })); });
            if (canPost) post.disabled = r.option || state.mech !== M.program.mech;
            if (canPost && state.mech !== M.program.mech) out.appendChild(P.el('div', { 'class': 'loy-warnbox loy-w', text: 'Это примерка механики. Провести чек можно по действующей механике программы: «' + M.program.mechName + '» (меняется в «Правилах программы»).' }));
            Array.prototype.forEach.call(sw.querySelectorAll('button'), function (b, i) { b.classList.toggle('loy-on', M.mechs[i].key === state.mech); });
        }
        [sum, drinks, want, promo].forEach(function (i) { i.addEventListener('input', redraw); });
        redraw();
        return card;
    }
    function save(M, g, r, point) {
        if (r.conflicts.length) { P.toast(r.conflicts[0], true); return; }
        var num = P.nextNum(M.checks, 'Ч-'), ops = [], n = parseInt(P.nextNum(M.ops, 'Б-').slice(2), 10);
        function opNum() { return 'Б-' + ('00000' + (n++)).slice(-6); }
        var f = { 'Чек': num, 'Дата чека': M.today, 'Время чека': P.now(), 'Участник': g.name, 'Точка': point, 'Сумма чека': state.sum, 'Напитков в чеке': state.drinks, 'Кассир': P.who() };
        if (r.bonusUsed) f['Оплачено бонусами'] = r.bonusUsed;
        if (state.promo) f['Акция'] = state.promo;
        ops.push({ op: 'new', id: 'Чек', up: 1, fields: f });
        var base = { 'Дата операции': M.today, 'Участник': g.name, 'Точка': point, 'Чек': num, 'Автор операции': P.who() };
        if (r.bonusUsed) ops.push({ op: 'new', id: 'Бонусная операция', up: 1, fields: Object.assign({ 'Бонусная операция': opNum(), 'Вид операции': 'Списание в оплату', 'Бонусы': -r.bonusUsed }, base) });
        if (r.accrue) ops.push({ op: 'new', id: 'Бонусная операция', up: 1, fields: Object.assign({ 'Бонусная операция': opNum(), 'Вид операции': 'Начисление за покупку', 'Бонусы': r.accrue, 'Сгорает': C.addDays(M.today, M.program.life) }, base) });
        P.batch(ops).then(function () { P.toast('Чек ' + num + ' проведён'); setTimeout(function () { location.reload(); }, 700); }).catch(function (e) { P.toast(e.message, true); });
    }

    function historyBox(M, g) {
        var wrap = P.el('div', {});
        var bar = P.el('div', { 'class': 'loy-bar' }, [P.el('h2', { text: 'История операций', style: 'margin:0' }), P.el('span', { 'class': 'loy-grow' })]);
        if (P.canWrite('Бонусная операция')) bar.appendChild(P.btn('Ручная операция', function () { manual(M, g); }));
        wrap.appendChild(bar);
        var ops = (M.opsBy[g.name] || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.num < b.num ? 1 : -1); });
        wrap.appendChild(P.table([
            { t: 'Дата', html: function (o) { return C.toDmy(o.date); } }, { t: 'Операция', k: 'kind' }, { t: 'Бонусы', num: true, html: function (o) { return (o.bonus > 0 ? '+' : '') + P.bonus(o.bonus); } },
            { t: 'Сгорает', html: function (o) { return C.toDmy(o.expires); } }, { t: 'Точка', k: 'point' }, { t: 'Причина', k: 'reason' }, { t: 'Кто', k: 'author' }
        ], ops.slice(0, 60), { rowCls: function (o) { return o.manual && !o.reason ? 'loy-row-bad' : o.manual ? 'loy-row-warn' : ''; } }));
        if (ops.length > 60) wrap.appendChild(P.el('p', { 'class': 'loy-muted', text: 'Показаны последние 60 из ' + ops.length + '. Весь журнал - в «Журнале операций».' }));
        return wrap;
    }
    /* Ручная операция: причина обязательна, проверка при вводе. */
    function manual(M, g) {
        var kinds = Object.keys(M.kinds).filter(function (k) { return M.kinds[k].manual; });
        var kind = P.select(kinds), amount = P.input('number', 100, { min: 1 }), reason = P.input('text', '', { placeholder: 'За что: компенсация, ошибка кассы...' }), box = P.el('div', {});
        var point = P.myPoint(M) || g.point, bal = M.st[g.name].lots.balance;
        function op() { var sign = (M.kinds[kind.value] || {}).sign || 1; return { manual: true, bonus: sign * Math.abs(C.num(amount.value)), reason: reason.value }; }
        function check() {
            var r = C.checkManual(op(), bal, M.program); box.innerHTML = '';
            r.errors.forEach(function (t) { box.appendChild(P.el('div', { 'class': 'loy-warnbox loy-e', text: t })); });
            r.warnings.forEach(function (t) { box.appendChild(P.el('div', { 'class': 'loy-warnbox loy-w', text: t })); });
            return r;
        }
        [kind, amount, reason].forEach(function (i) { i.addEventListener('input', check); });
        var body = P.el('div', {}, [P.el('p', { 'class': 'loy-muted', text: g.name + ' · баланс ' + P.bonus(bal) + ' · точка ' + point }), P.field('Вид', kind), P.field('Бонусов', amount), P.field('Причина', reason, 'попадёт в журнал, управляющий видит все ручные операции'), box]);
        check();
        P.modal('Ручная операция', body, [{ text: 'Отмена' }, { text: 'Провести', cls: 'loy-primary', keep: true, fn: function (close) {
            var o = op(), r = check(); if (!r.ok) return false;
            var f = { 'Бонусная операция': P.nextNum(M.ops, 'Б-'), 'Дата операции': M.today, 'Участник': g.name, 'Точка': point, 'Вид операции': kind.value, 'Бонусы': o.bonus, 'Причина': o.reason.trim(), 'Автор операции': P.who() };
            if (o.bonus > 0) f['Сгорает'] = C.addDays(M.today, M.program.life);
            P.batch([{ op: 'new', id: 'Бонусная операция', up: 1, fields: f }]).then(function () { close(); P.toast('Операция проведена'); setTimeout(function () { location.reload(); }, 600); }).catch(function (e) { P.toast(e.message, true); });
            return false;
        } }]);
    }
})();
