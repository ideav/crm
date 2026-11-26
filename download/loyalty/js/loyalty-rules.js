/* Правила программы: механика, кэшбэк, лимит списания, срок жизни, пороги; акции и проверка их конфликта с бонусами; личные правила гостей. */
(function () {
    'use strict';
    var P = window.Loy, C = P.core;
    var FIELDS = [['percent', 'Процент начисления', 'Кэшбэк, % от оплаченного деньгами'], ['limit', 'Лимит списания', '% чека, который можно оплатить бонусами'], ['life', 'Срок жизни бонусов', 'дней у каждой партии'],
        ['nth', 'Каждая N-я в подарок', 'для механики «N-я в подарок»'], ['giftPrice', 'Цена подарка', '₽, стоимость подарочного напитка'], ['welcome', 'Приветственный бонус', 'бонусов при регистрации'],
        ['manualMax', 'Порог ручной операции', 'сверх - на проверку управляющему'], ['lostDays', 'Дней до ухода', 'граница RFM «давно не был»']];
    P.mount(function (host, M) {
        var can = P.canWrite('Программа лояльности'), canPromo = P.canWrite('Акция');
        host.appendChild(P.el('div', {}, P.head('Правила программы', 'Правила - записи базы, а не параметры тарифа: меняются здесь и сразу работают в тестовом чеке и отчётах.')));
        var two = P.el('div', { 'class': 'loy-two' });
        var prog = P.el('div', { 'class': 'loy-card' }, [P.el('h3', { text: 'Программа «' + M.program.name + '»' })]);
        var mech = P.select(M.mechs.map(function (m) { return [m.name, m.name + (C.isBuilt(m.key) ? '' : ' - опция, подключаем за день')]; }), M.program.mechName);
        Array.prototype.forEach.call(mech.options, function (o, i) { if (!C.isBuilt(M.mechs[i].key)) o.disabled = true; });
        var inputs = {};
        var grid = P.el('div', { 'class': 'loy-grid2' }, [P.field('Механика', mech, 'одна механика в базовой коробке')]);
        FIELDS.forEach(function (f) { inputs[f[0]] = P.input('number', M.program[f[0]], { min: 0, step: 1 }); grid.appendChild(P.field(f[1], inputs[f[0]], f[2])); });
        var onPromo = P.input('checkbox', '', {}); onPromo.checked = M.program.bonusOnPromo;
        grid.appendChild(P.field('Бонусами можно платить в любой акции', onPromo, 'выключено: решает флаг акции'));
        prog.appendChild(grid);
        if (!can) Array.prototype.forEach.call(prog.querySelectorAll('input,select'), function (i) { i.disabled = true; });
        if (can) prog.appendChild(P.btn('Сохранить правила', function () {
            var f = { 'Механика': mech.value, 'Бонусы на акции': onPromo.checked ? 1 : 0 };
            FIELDS.forEach(function (x) { f[x[1]] = C.num(inputs[x[0]].value); });
            if (f['Лимит списания'] > 100) { P.toast('Лимит списания не больше 100% чека', true); return; }
            P.update(M.program.id, f).then(function () { P.toast('Правила сохранены'); setTimeout(function () { location.reload(); }, 600); }).catch(function (e) { P.toast(e.message, true); });
        }, 'loy-primary'));
        else prog.appendChild(P.el('p', { 'class': 'loy-muted', text: 'Правила меняет маркетолог или управляющий.' }));
        two.appendChild(prog);
        var mbox = P.el('div', { 'class': 'loy-card' }, [P.el('h3', { text: 'Механики' })]);
        M.mechs.forEach(function (m) {
            mbox.appendChild(P.el('div', { 'class': 'loy-kv' }, [P.el('span', { html: '<b>' + P.esc(m.name) + '</b><br><small class="loy-muted">' + P.esc(m.desc || '') + '</small>' }),
                P.el('span', { html: m.name === M.program.mechName ? P.badge('действует', 'ok') : C.isBuilt(m.key) ? P.badge('в коробке', 'info') : P.badge('опция, за день', 'mute') })]));
        });
        two.appendChild(mbox);
        host.appendChild(two);

        host.appendChild(P.el('h2', { text: 'Акции и конфликт с бонусами' }));
        var rows = M.promos.map(function (p) {
            var bonusOk = p.bonusAllowed || M.program.bonusOnPromo, max = p.discount + (bonusOk ? (100 - p.discount) * M.program.limit / 100 : 0);
            var used = M.checks.filter(function (c) { return c.promo === p.name; }), bad = used.filter(function (c) { return !bonusOk && c.paidBonus > 0; });
            return { p: p, bonusOk: bonusOk, max: Math.round(max), used: used.length, bad: bad.length, active: p.from <= M.today && (!p.to || p.to >= M.today) };
        });
        host.appendChild(P.table([
            { t: 'Акция', html: function (r) { return P.esc(r.p.name) + '<br><small class="loy-muted">' + P.esc(r.p.cond || '') + '</small>'; } }, { t: 'Срок', html: function (r) { return C.toDmy(r.p.from) + ' - ' + C.toDmy(r.p.to) + (r.active ? '' : ' ' + P.badge('не идёт', 'mute')); } },
            { t: 'Скидка', num: true, html: function (r) { return r.p.discount + '%'; } },
            { t: 'Бонусами в акции', html: function (r) { return canPromo ? '<label><input type="checkbox" data-promo="' + P.esc(r.p.id) + '"' + (r.p.bonusAllowed ? ' checked' : '') + '> можно</label>' : (r.bonusOk ? 'можно' : 'нельзя'); } },
            { t: 'Макс. выгода гостя', num: true, html: function (r) { return r.max > 40 ? P.badge(r.max + '% чека', 'crit') : r.max + '% чека'; } },
            { t: 'Чеков', num: true, k: 'used' }, { t: 'Нарушений', num: true, html: function (r) { return r.bad ? '<a href="' + P.nav('operations') + '">' + P.badge(r.bad + ' чек.', 'crit') + '</a>' : '0'; } }
        ], rows));
        host.querySelectorAll('input[data-promo]').forEach(function (cb) {
            cb.addEventListener('change', function () { P.update(cb.getAttribute('data-promo'), { 'Бонусы в акцию': cb.checked ? 1 : 0 }).then(function () { P.toast('Акция обновлена'); setTimeout(function () { location.reload(); }, 600); }).catch(function (e) { P.toast(e.message, true); }); });
        });
        host.appendChild(P.el('p', { 'class': 'loy-muted', text: 'Макс. выгода = скидка акции плюс списание бонусов до лимита. Больше 40% - акция и бонусы складываются в двойную скидку.' }));

        host.appendChild(P.el('h2', { text: 'Личные правила гостей' }));
        var own = M.guests.filter(function (g) { return g.percent || g.limit || g.rule; });
        host.appendChild(P.table([
            { t: 'Гость', html: function (g) { return '<a href="' + P.nav('guest', 'g=' + encodeURIComponent(g.name)) + '">' + P.esc(g.name) + '</a>'; } },
            { t: 'Кэшбэк', num: true, html: function (g) { return g.percent ? g.percent + '%' : P.esc(M.program.percent + '% (общий)'); } },
            { t: 'Лимит списания', num: true, html: function (g) { return g.limit ? g.limit + '%' : P.esc(M.program.limit + '% (общий)'); } }, { t: 'Правило', k: 'rule' }
        ], own, { empty: 'Личных правил нет' }));
    });
})();
