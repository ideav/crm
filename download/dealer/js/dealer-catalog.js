/* Каталог и заказ: персональный прайс дилера, остатки по складам, корзина с проверкой лимита, просрочки и маржи при вводе. */
(function () {
    'use strict';
    var P = window.Dealer, C = P.core;
    var cart = {}, filt = { group: '', q: '' }, loaded = false;
    function render(host, M) {
        var d = P.dealer(M), S = P.dealerState(M, d), h = P.hash();
        if (!loaded && (h.repeat || h.draft)) { loaded = true; return prefill(host, M, d, h.repeat || h.draft, !!h.draft); }
        host.innerHTML = '';
        host.appendChild(P.head('Каталог и заказ', 'Прайс ' + d.name + ': цены по условиям дилера, остаток - на складе отгрузки «' + d.wh + '» и на других складах.', P.pickDealer(M, d, function () { cart = {}; render(host, M); })));
        var cat = C.catalogFor(M.products, d), groups = M.groups.filter(function (g) { return cat.some(function (p) { return p.group === g; }); });
        if (cat.length < M.products.length) host.appendChild(P.note('Дилеру открыты группы: ' + groups.join(', ') + '. Остальные товары каталога ему не видны.', 'info'));
        var gs = P.select([['', 'Все группы']].concat(groups), filt.group), q = P.input('search', filt.q, { placeholder: 'Артикул или название' });
        gs.addEventListener('change', function () { filt.group = gs.value; drawTable(); });
        q.addEventListener('input', function () { filt.q = q.value; drawTable(); });
        host.appendChild(P.el('div', { 'class': 'dl-bar-row' }, [P.field('Товарная группа', gs), P.el('div', { 'class': 'dl-grow' }, [P.field('Поиск', q)])]));
        var split = P.el('div', { 'class': 'dl-split' }), left = P.el('div', {}), right = P.el('div', { 'class': 'dl-card dl-sticky' });
        split.appendChild(left); split.appendChild(right); host.appendChild(split);
        var priced = cat.map(function (p) { var pr = P.price(M, d, p), st = C.stockByWarehouse(p.name, M.stocks); return { p: p, pr: pr, st: st, avail: st[d.wh] || 0 }; });
        function stockHtml(x) {
            return '<span class="dl-stock">' + M.whs.map(function (w) { var n = x.st[w] || 0; return '<span class="dl-s-' + C.stockLevel(n) + (w === d.wh ? ' dl-s-main' : '') + '" title="' + P.esc(w) + ': доступно ' + n + '">' + P.esc(M.whCode[w] || w) + ' ' + n + '</span>'; }).join('') + '</span>';
        }
        function drawTable() {
            left.innerHTML = '';
            var rows = priced.filter(function (x) { return (!filt.group || x.p.group === filt.group) && (!filt.q || (x.p.name + ' ' + x.p.art).toLowerCase().indexOf(filt.q.toLowerCase()) >= 0); });
            var cols = [
                { t: 'Артикул', html: function (x) { return '<span class="dl-muted">' + P.esc(x.p.art) + '</span>'; } },
                { t: 'Товар', html: function (x) { return P.esc(x.p.name) + '<span class="dl-rule">' + P.esc(x.p.group) + ' · ' + P.esc(x.p.unit) + (x.p.pack > 1 ? ', кратно ' + x.p.pack : '') + '</span>'; } },
                { t: 'Цена дилера', num: true, html: function (x) { return (x.pr.price !== x.pr.base ? '<span class="dl-strike">' + P.money(x.pr.base) + '</span> ' : '') + '<span class="dl-price">' + P.money(x.pr.price) + '</span><span class="dl-rule">' + P.esc(x.pr.rule) + '</span>'; } }
            ];
            if (M.canCost) cols.push({ t: 'Маржа', num: true, html: function (x) { var m = C.marginPct(x.pr.price, x.p.cost); return m !== null && m < M.rules.marginMin ? '<span class="dl-red">' + P.pct(m) + '</span>' : P.pct(m); } });
            cols.push({ t: 'Доступно по складам', html: stockHtml });
            if (P.canWrite('Заказ дилера')) cols.push({ t: 'Заказать', num: true, node: function (x) {
                var i = P.input('number', cart[x.p.name] || '', { min: 0, step: x.p.pack, 'aria-label': 'Количество ' + x.p.name });
                i.addEventListener('input', function () { var v = C.num(i.value); if (v > 0) cart[x.p.name] = v; else delete cart[x.p.name]; drawCart(); });
                return i;
            } });
            left.appendChild(P.table(cols, rows, { empty: 'Ничего не нашлось' }));
        }
        function check() {
            var lines = Object.keys(cart).map(function (n) {
                var x = priced.filter(function (y) { return y.p.name === n; })[0]; if (!x) return null;
                var other = M.whs.filter(function (w) { return w !== d.wh && (x.st[w] || 0) > 0; }).map(function (w) { return w.replace('Склад ', '') + ' ' + x.st[w]; }).join(', ');
                return { product: n, qty: cart[n], pack: x.p.pack, price: x.pr.price, base: x.pr.base, rule: x.pr.rule, cost: x.p.cost, approve: x.pr.approve, avail: x.avail, elsewhere: other };
            }).filter(Boolean);
            return { lines: lines, res: C.checkOrder({ dealer: d, lines: lines, debt: S.debt, open: S.open, rules: M.rules }) };
        }
        function drawCart() {
            right.innerHTML = '';
            var c = check(), r = c.res;
            right.appendChild(P.el('h2', { text: 'Заказ' }));
            if (!c.lines.length) right.appendChild(P.el('p', { 'class': 'dl-muted', text: 'Введите количество в строках прайса - корзина и проверки пересчитываются сразу.' }));
            c.lines.forEach(function (l) { right.appendChild(P.el('div', { 'class': 'dl-cart-line' }, [P.el('span', { text: l.product + ' × ' + l.qty }), P.el('b', { text: P.money(l.qty * l.price) })])); });
            right.appendChild(P.el('div', { 'class': 'dl-cart-total' }, [P.el('span', { text: 'Итого' }), P.el('span', { text: P.money(r.total) })]));
            if (S.limit) {
                right.appendChild(P.el('div', { 'class': 'dl-muted', text: 'Лимит ' + P.money(S.limit.limit) + ': занято ' + P.money(S.limit.used) + ', с заказом ' + P.money(r.after) }));
                right.appendChild(P.limitBar(S.limit, r.total));
            }
            if (!c.lines.length) { if (r.errors.length > 1) right.appendChild(P.note(r.errors[1], 'bad')); else if (r.approvals.length) right.appendChild(P.note('Любой новый заказ уйдёт на согласование: ' + r.approvals.map(function (a) { return a.reason.toLowerCase(); }).join(', ') + '.', 'warn')); return; }
            r.errors.forEach(function (t) { right.appendChild(P.note(t, 'bad')); });
            r.approvals.forEach(function (a) { right.appendChild(P.note('На согласование: ' + a.reason + '. ' + (M.isDealer && a.reason === 'Цена ниже маржи' ? 'Цена по договору требует подтверждения коммерческого директора.' : a.detail), 'warn')); });
            r.warnings.forEach(function (t) { right.appendChild(P.note(t, 'info')); });
            if (c.lines.length && r.ok && !r.approvals.length) right.appendChild(P.note('Проверки пройдены: заказ сразу уходит на склад.', 'ok'));
            if (!P.canWrite('Заказ дилера')) return;
            var send = P.btn(r.approvals.length ? 'Отправить на согласование' : 'Отправить заказ', function () { save(c, r.ok ? r.status : null, send); }, 'dl-primary');
            send.disabled = !c.lines.length || !r.ok;
            var draft = P.btn('Сохранить черновик', function () { save(c, 'Черновик', draft); });
            draft.disabled = !c.lines.length;
            right.appendChild(P.el('div', { 'class': 'dl-actions' }, [send, draft]));
        }
        function save(c, status, b) {
            if (!status) return;
            b.disabled = true;
            var r = c.res, pre = 'ЗД-' + d.id + '-', no = C.nextNumber(M.orders.map(function (o) { return o.no; }), pre);
            var f = { 'Заказ дилера': no, 'Дилер': d.id, 'Дата заказа': M.today, 'Склад': d.wh, 'Статус заказа': status, 'Сумма заказа': Math.round(r.total), 'Автор заказа': P.ctx.user,
                'Причина согласования': status === 'На согласовании' ? r.approvals.map(function (a) { return a.reason; }).join(', ') : '',
                'Детали согласования': status === 'На согласовании' ? r.approvals.map(function (a) { return a.reason + ': ' + a.detail; }).join('\n') : '' };
            /* номер с портала - в серии дилера (закупщик видит только свои заказы); занятый номер сдвигаем */
            function tryCreate(n) {
                return P.create('Заказ дилера', f).catch(function (e) {
                    if (n > 3 || !/существует/.test(e.message)) throw e;
                    no = C.nextNumber([no], pre); f['Заказ дилера'] = no; return tryCreate(n + 1);
                });
            }
            tryCreate(0).then(function (res) {
                var id = P.newId(res);
                return P.batch(c.lines.map(function (l, i) { return { op: 'new', id: 'Строка заказа', up: id, fields: { 'Строка заказа': String(i + 1), 'Товар': (M.prodBy[l.product] || {}).id, 'Количество': l.qty, 'Цена в заказе': l.price, 'Базовая цена': l.base, 'Правило цены': l.rule, 'Дилер': d.id } }; })).then(function () { return id; });
            }).then(function (id) {
                cart = {};
                P.toast(status === 'Черновик' ? 'Черновик ' + no + ' сохранён' : status === 'На согласовании' ? 'Заказ ' + no + ' отправлен на согласование' : 'Заказ ' + no + ' принят и передан на склад');
                setTimeout(function () { P.go('orders', 'd=' + d.id + '&o=' + id); }, 700);
            }).catch(function (e) { P.toast(e.message, true); b.disabled = false; });
        }
        drawTable(); drawCart();
    }
    /* Повтор заказа или черновик: строки по сегодняшним ценам, изменения цены видны. */
    function prefill(host, M, d, orderId, isDraft) {
        P.lines(orderId).then(function (ls) {
            var rep = C.repeatLines(ls, function (name) { var p = M.prodBy[name]; return p ? P.price(M, d, p) : null; });
            cart = {}; rep.forEach(function (l) { if (!l.missing) cart[l.product] = l.qty; });
            render(host, M);
            var ch = rep.filter(function (l) { return l.changed; });
            var o = M.orderById[orderId];
            host.insertBefore(P.note((isDraft ? 'Черновик ' : 'Повтор заказа ') + (o ? o.no : '') + ': ' + rep.length + ' поз. в корзине.' + (ch.length ? ' Цена изменилась: ' + ch.map(function (l) { return l.product + ' ' + P.money(l.oldPrice) + ' -> ' + P.money(l.price); }).join('; ') + '.' : ' Цены те же.'), ch.length ? 'warn' : 'info'), host.children[1]);
        }).catch(P.fail);
    }
    P.mount(render);
})();
