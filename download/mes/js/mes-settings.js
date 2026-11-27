/* MES: нормы и расценки под клиента — маршруты изделий, операции, расценки, причины простоя, правила цеха. */
(function () {
    'use strict';
    var P = window.Mes, C = P.core;
    P.mount(function (host, M) {
        var h = P.hash(), tab = h.t || 'route';
        P.head('Нормы и расценки', 'Всё, чем этот цех отличается от соседнего: свои операции и участки, маршрут изделия, нормы времени, расценки, причины простоя и правила оплаты. Правка здесь сразу меняет пульт, терминал и расчёт сдельной.').forEach(function (n) { host.appendChild(n); });
        host.appendChild(P.tabs([['route', 'Маршруты, нормы, расценки'], ['ops', 'Операции и участки'], ['reasons', 'Причины простоя'], ['rules', 'Правила цеха']], tab, function (v) { location.hash = 't=' + v; P.redraw(); }));
        function saved(p) { return p.then(function () { P.toast('Сохранено'); P.redraw(); }).catch(function (e) { P.toast(e.message, true); }); }
        function saveBtn(fn, ok) { return ok ? P.btn('Сохранить', fn, 'mes-small') : null; }
        if (tab === 'route') {
            var prod = h.p || (M.products[0] || {}).name, sel = P.select(M.products.map(function (p) { return [p.name, p.name + ' (' + p.code1c + ')']; }), prod);
            sel.addEventListener('change', function () { location.hash = 't=route&p=' + encodeURIComponent(sel.value); P.redraw(); });
            host.appendChild(P.el('div', { 'class': 'mes-bar' }, [P.field('Изделие (код из 1С)', sel)]));
            var canN = P.canWrite('Шаг маршрута'), canR = P.canWrite('Расценка');
            var route = C.routeOf(M.steps, prod), total = 0, money = 0;
            host.appendChild(P.table([
                { t: 'Шаг', num: true, k: 'step' }, { t: 'Операция', k: 'op' }, { t: 'Участок', html: function (s) { return P.esc(M.opSection[s.op] || ''); } },
                { t: 'Норма, мин/шт', node: function (s) { var i = P.input('number', s.norm, { min: 0.1, step: 0.5, 'class': 'mes-cell', disabled: !canN }); s._n = i; return i; } },
                { t: 'Расценка, ₽/шт', node: function (s) { var r = M.rates.filter(function (x) { return x.op === s.op && x.product === prod; })[0]; s._r = r; var i = P.input('number', r ? r.price : '', { min: 0, step: 1, 'class': 'mes-cell', disabled: !canR || !r }); s._p = i; return i; } },
                { t: '₽ за норма-час', num: true, html: function (s) { var r = s._r; return r && s.norm ? P.money(r.price / s.norm * 60) : ''; } },
                { t: '', node: function (s) { return saveBtn(function () {
                    var ops = []; if (canN && C.num(s._n.value) !== s.norm) ops.push({ op: 'set', id: s.id, fields: { 'Норма, мин/шт': C.num(s._n.value) } });
                    if (canR && s._r && C.num(s._p.value) !== s._r.price) ops.push({ op: 'set', id: s._r.id, fields: { 'Цена за штуку': C.num(s._p.value) } });
                    if (!ops.length) return P.toast('Нет изменений'); saved(P.batch(ops));
                }, canN || canR); } }
            ], route));
            route.forEach(function (s) { total += s.norm; var r = M.rates.filter(function (x) { return x.op === s.op && x.product === prod; })[0]; money += r ? r.price : 0; });
            host.appendChild(P.note('Трудоёмкость изделия ' + P.fmt(total, 1) + ' мин, сдельная на изделие ' + P.money(money) + '. Расценка действует с даты в справочнике «Расценка»: новую расценку с другой датой можно завести рядом, расчёт возьмёт действующую на день отметки.', 'info'));
        } else if (tab === 'ops') {
            var canO = P.canWrite('Операция');
            host.appendChild(P.table([
                { t: 'Код', k: 'code' },
                { t: 'Операция (ваше название)', node: function (o) { var i = P.input('text', o.name, { 'class': 'mes-cell mes-cell-wide', disabled: !canO }); o._i = i; return i; } },
                { t: 'Участок', k: 'section' },
                { t: 'Заданий в работе', num: true, html: function (o) { return String(M.tasks.filter(function (t) { return t.op === o.name && t.state !== C.STATE.done; }).length); } },
                { t: '', node: function (o) { return saveBtn(function () { var v = o._i.value.trim(); if (!v || v === o.name) return P.toast('Нет изменений'); saved(P.update(o.id, { 'Операция': v })); }, canO); } }
            ], M.ops));
            host.appendChild(P.note('Переименование операции сразу видно в очереди мастера, на терминале и в наряде: задания и расценки ссылаются на операцию, а не копируют её название.', 'info'));
        } else if (tab === 'reasons') {
            host.appendChild(P.table([{ t: 'Код', k: 'code' }, { t: 'Причина простоя', k: 'name' }, { t: 'Вид', html: function (r) { return P.badge(r.kind, r.kind === C.WORKER_FAULT ? 'warn' : 'info'); } }, { t: 'Оплата', html: function (r) { return r.kind === C.WORKER_FAULT ? 'не оплачивается' : Math.round(M.rules.idleShare * 100) + '% тарифной ставки'; } },
                { t: 'Минут за ноябрь', num: true, html: function (r) { return String(M.downs.filter(function (d) { return d.reason === r.name; }).reduce(function (a, d) { return a + d.mins; }, 0)); } }], M.reasons));
        } else {
            var canRu = P.canWrite('Правило цеха');
            host.appendChild(P.table([{ t: 'Правило', k: 'name' },
                { t: 'Значение', node: function (r) { var i = P.input('number', C.num(r.value), { step: 'any', 'class': 'mes-cell', disabled: !canRu }); r._i = i; return i; } },
                { t: 'Пояснение', k: 'note' },
                { t: '', node: function (r) { return saveBtn(function () { if (C.num(r._i.value) === C.num(r.value)) return P.toast('Нет изменений'); saved(P.update(r.id, { 'Значение правила': C.num(r._i.value) })); }, canRu); } }], M.ruleRows));
        }
    });
})();
