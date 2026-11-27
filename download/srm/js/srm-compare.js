/* SRM: Сравнение КП. Предложения приведены к единому виду (с НДС, доставкой и стоимостью денег), история цен, выбор поставщика,
   стоп-кран допуска перед договором и договор с этапами одним кликом. */
(function () {
    'use strict';
    var P = window.Srm, C = P.core;
    var st = { req: P.hash().req || 'З-2026-0147' };

    function chart(hist, offers, unitLabel) {
        var pts = hist.map(function (h) { return { x: h.date, y: h.price, t: P.d(h.date) + ': ' + P.fmt(h.price) + ' ₽ (' + h.supplier + ')', k: 'h' }; })
            .concat(offers.map(function (o) { return { x: P.TODAY, y: o.n.unitGross, t: o.offer.sup + ': ' + P.fmt(o.n.unitGross) + ' ₽ с НДС', k: o.best ? 'b' : 'o' }; }));
        if (!pts.length) return '<p class="srm-muted">Прошлых закупок этой позиции нет.</p>';
        var W = 520, H = 170, pad = 46, ys = pts.map(function (p) { return p.y; }), lo = Math.min.apply(null, ys) * 0.97, hi = Math.max.apply(null, ys) * 1.03;
        var x0 = C.utc('2026-01-01'), x1 = C.utc(P.TODAY) + 86400000 * 10, X = function (d) { return pad + (C.utc(d) - x0) / (x1 - x0) * (W - pad - 10); }, Y = function (v) { return H - 22 - (v - lo) / (hi - lo || 1) * (H - 36); };
        var s = '<svg class="srm-chart" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="История цен за ' + P.esc(unitLabel) + '">';
        [lo, (lo + hi) / 2, hi].forEach(function (g) { s += '<line x1="' + pad + '" x2="' + W + '" y1="' + Y(g) + '" y2="' + Y(g) + '" stroke="currentColor" stroke-opacity=".12"/><text x="0" y="' + (Y(g) + 4) + '" font-size="10" fill="currentColor" fill-opacity=".6">' + P.fmt(g / 1000, 1) + 'к</text>'; });
        var h = pts.filter(function (p) { return p.k === 'h'; });
        if (h.length > 1) s += '<polyline fill="none" stroke="#2563eb" stroke-width="2" points="' + h.map(function (p) { return X(p.x) + ',' + Y(p.y); }).join(' ') + '"/>';
        pts.forEach(function (p) { s += '<circle cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="' + (p.k === 'h' ? 4 : 5) + '" fill="' + (p.k === 'h' ? '#2563eb' : p.k === 'b' ? '#16a34a' : '#d97706') + '"><title>' + P.esc(p.t) + '</title></circle>'; });
        ['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01'].forEach(function (d) { s += '<text x="' + X(d) + '" y="' + (H - 6) + '" font-size="10" fill="currentColor" fill-opacity=".6">' + P.d(d).slice(3) + '</text>'; });
        return s + '</svg><div class="srm-legend"><span><i style="background:#2563eb"></i>прошлые договоры</span><span><i style="background:#16a34a"></i>лучшее КП</span><span><i style="background:#d97706"></i>другие КП (сегодня)</span></div>';
    }
    function offerForm(M, q, invs) {
        var txt = P.input('textarea', '', { placeholder: 'Вставьте текст письма поставщика или строки из Excel' });
        var inv = P.select(invs.map(function (i) { return [i.id, i.sup]; }));
        var f = { price: P.input('number', ''), vat: P.select([['1', 'с НДС'], ['0', 'без НДС']], '1'), delivery: P.input('number', '0'), deferral: P.input('number', '0'), prepay: P.input('number', '0'), lead: P.input('number', '') };
        var note = P.el('div', {});
        function parse() {
            var r = C.parseOfferText(txt.value), o = r.fields; note.innerHTML = '';
            if (o.price !== undefined) f.price.value = o.price; if (o.vatIncluded !== undefined) f.vat.value = o.vatIncluded ? '1' : '0';
            ['delivery', 'deferral', 'prepay', 'lead'].forEach(function (k) { if (o[k] !== undefined) f[k].value = o[k]; });
            note.appendChild(P.box(r.missing.length ? 'w' : 'g', r.missing.length ? 'Не нашли в тексте: ' + r.missing.map(function (k) { return { price: 'цена', vatIncluded: 'НДС', deferral: 'отсрочка', lead: 'срок поставки' }[k]; }).join(', ') + ' - заполните вручную.' : 'Все условия найдены в тексте.'));
            var sup = invs.filter(function (i) { return txt.value.indexOf(i.sup.replace(/^(ООО|АО|ИП)\s*/, '').replace(/[«»]/g, '')) >= 0 || txt.value.indexOf(i.sup) >= 0; })[0]; if (sup) inv.value = sup.id;
        }
        txt.addEventListener('input', parse);
        var body = P.el('div', {}, [P.field('Письмо или строки Excel', txt), note, P.el('div', { 'class': 'srm-grid2' }, [P.field('Поставщик (приглашение)', inv), P.field('Цена за ед.', f.price), P.field('НДС', f.vat), P.field('Доставка, ₽', f.delivery), P.field('Отсрочка, дней', f.deferral), P.field('Предоплата, %', f.prepay), P.field('Срок поставки, дней', f.lead)])]);
        P.modal('КП из письма: ' + q.num, body, [{ text: 'Отмена' }, { text: 'Добавить в сравнение', cls: 'srm-primary', fn: function (close, b) {
            if (!C.num(f.price.value)) { P.toast('Нет цены', true); return false; }
            b.disabled = true;
            P.create('Предложение', { 'Предложение': C.nextNumber(M.offers.map(function (o) { return o.num; }), 'КП-'), 'Приглашение': inv.value, 'Цена за ед.': C.num(f.price.value), 'Цена включает НДС': f.vat.value, 'Ставка НДС': 20, 'Доставка': C.num(f.delivery.value), 'Отсрочка, дней': C.num(f.deferral.value), 'Предоплата, %': C.num(f.prepay.value), 'Срок поставки, дней': C.num(f.lead.value), 'Дата КП': P.TODAY, 'Канал КП': 'Письмо', 'Комментарий поставщика': txt.value.slice(0, 900) })
                .then(function () { return P.event(q, 'КП ' + M.invById[inv.value].sup + ' из письма разобрано в сравнение', 'КП'); }).then(function () { P.toast('КП добавлено в сравнение'); close(); P.reload(); }).catch(function (e) { P.toast(e.message, true); b.disabled = false; });
            return false;
        } }], true);
    }
    function admit(M, q, sup) {
        var why = P.input('textarea', ''), until = P.input('date', '2026-12-31'), lvl = P.select(Object.keys(M.levels).filter(function (k) { return M.levels[k].color !== 'red'; }), 'Допущен с условием');
        var a = P.admissionOf(M, sup.name);
        var body = P.el('div', {}, a.reasons.map(function (r) { return P.box('e', r); }).concat([P.field('Новый уровень', lvl), P.field('Допуск до', until), P.field('Обоснование (попадёт в журнал)', why, 'Например: проверка смены директора завершена, документы получены 26.11')]));
        P.modal('Решение по допуску: ' + sup.name, body, [{ text: 'Отмена' }, { text: 'Допустить', cls: 'srm-primary', fn: function (close, b) {
            if (why.value.trim().length < 10) { P.toast('Нужно обоснование', true); return false; }
            b.disabled = true;
            P.batch([{ op: 'new', id: 'Решение по допуску', up: sup.id, fields: { 'Решение по допуску': 'Допущен под условие: ' + q.num, 'Дата решения': P.TODAY, 'Кто решил': P.ctx.user, 'Уровень допуска': lvl.value, 'Обоснование решения': why.value } },
                { op: 'set', id: sup.id, fields: { 'Уровень допуска': lvl.value, 'Допуск до': until.value, 'Причина ограничения': why.value } }])
                .then(function () { return P.event(q, 'СБ: ' + sup.name + ' - ' + lvl.value + ' до ' + P.d(until.value) + '. ' + why.value, 'Допуск'); })
                .then(function () { P.toast('Допуск записан в журнал'); close(); P.reload(); }).catch(function (e) { P.toast(e.message, true); b.disabled = false; });
            return false;
        } }]);
    }
    function makeContract(M, q, o, n) {
        var num = C.nextNumber(M.contracts.map(function (c) { return c.num; }), 'Д-2026-'), stages = C.planStages(q.qty, P.TODAY, q.qty >= 20 ? 2 : 1, 14, 14);
        var ops = [{ op: 'new', id: 'Договор', up: 1, fields: { 'Договор': num, 'Заявка на закупку': q.id, 'Поставщик': M.supBy[o.sup].id, 'Сумма договора': Math.round(n.total), 'Цена за ед. договора': n.unitGross, 'Дата договора': P.TODAY, 'Состояние договора': 'Исполняется' } }]
            .concat(stages.map(function (s) { return { op: 'new', id: 'Этап поставки', up: ':id0', fields: { 'Этап поставки': s.name, 'Плановая дата': s.plan, 'Количество этапа': s.qty } }; }))
            .concat([{ op: 'set', id: q.id, fields: { 'Стадия заявки': 'Договор' } }]);
        return P.batch(ops).then(function () { return P.event(q, 'Создан договор ' + num + ' с ' + o.sup + ': ' + stages.map(function (s) { return s.name + ' ' + P.d(s.plan) + ', ' + s.qty; }).join('; '), 'Договор'); })
            .then(function () { P.toast('Договор ' + num + ' создан, этапы в календаре поставок'); return num; });
    }
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('h1', { text: 'Сравнение коммерческих предложений' }));
        host.appendChild(P.el('p', { 'class': 'srm-sub', text: 'Все КП приведены к одной сумме: цена с НДС, доставка до завода и стоимость денег (отсрочка дешевле, предоплата дороже, ' + M.rules.moneyRate + '% годовых). Рядом история цен этой позиции.' }));
        var withOffers = M.reqs.filter(function (q) { return M.invs.some(function (i) { return i.req === q.num; }); });
        var sel = P.select(withOffers.map(function (q) { return [q.num, q.num + ' - ' + q.nom + ', ' + q.plant + ' (' + q.stage + ')']; }), st.req);
        sel.onchange = function () { st.req = sel.value; location.hash = 'req=' + encodeURIComponent(st.req); render(host, M); };
        host.appendChild(P.el('div', { 'class': 'srm-bar' }, [P.field('Заявка', sel)]));
        var q = M.reqBy[st.req] || withOffers[0]; if (!q) { host.appendChild(P.box('w', 'Нет заявок с приглашениями.')); return; }
        st.req = q.num; sel.value = q.num;
        var unit = (M.noms[q.nom] || {}).unit || '', invs = M.invs.filter(function (i) { return i.req === q.num; }), offers = P.offersOf(M, q.num);
        var rows = C.rankOffers(offers, q.qty, M.rules), last = P.lastPrice(M, q.nom, q.date), chosen = P.chosenOf(M, q.num);
        var first = offers.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0];
        host.appendChild(P.el('div', { 'class': 'srm-kpis' }, [
            P.kpi('Лот', P.esc(q.qty + ' ' + unit), q.nom + ', ' + q.plant),
            P.kpi('Ответили', offers.length + ' из ' + invs.length, invs.filter(function (i) { return !offers.some(function (o) { return o.invId === i.id; }); }).map(function (i) { return i.sup; }).join(', ') || 'все', offers.length < invs.length ? 'warn' : 'good'),
            P.kpi('Лучшая приведённая сумма', rows.length ? P.mln(rows[0].n.adjusted) : '-', rows.length ? rows[0].offer.sup : '', 'good'),
            P.kpi('Бюджет заявки', P.mln(q.budget), rows.length ? 'лучшее КП ' + P.pct((rows[0].n.total - q.budget) / q.budget * 100) + ' к бюджету' : ''),
            P.kpi('Прошлая закупка', last ? P.fmt(last.price) + ' ₽/' + unit : '-', last ? P.d(last.date) + ', ' + last.supplier : 'нет истории')
        ]));
        var canEdit = P.canWrite('Предложение') && !/Договор|Исполнена/.test(q.stage);
        host.appendChild(P.table([
            { t: '#', num: true, html: function (r) { return String(r.rank); } },
            { t: 'Поставщик', html: function (r) { return P.light(M, r.offer.sup) + '<div><b>' + P.esc(r.offer.sup) + '</b></div><div class="srm-muted">' + P.esc(r.offer.channel) + ', ' + P.d(r.offer.date) + '</div>'; } },
            { t: 'Цена в КП', num: true, html: function (r) { return P.fmt(r.offer.price) + ' ₽<div class="srm-muted">' + (r.offer.vatIncluded ? 'с НДС' : 'без НДС') + '</div>' + (r.paperCheapest ? P.badge('дешевле всех на бумаге', 'warn') : ''); } },
            { t: 'С НДС за ' + unit, num: true, html: function (r) { var f = last ? C.priceFlag(r.n.unitGross, last.price, M.rules) : null; return P.fmt(r.n.unitGross) + ' ₽' + (f ? '<div>' + P.badge(P.pct(f.dev) + ' к прошлой', f.kind === 'up' ? 'crit' : f.kind === 'down' ? 'ok' : 'mute') + '</div>' : ''); } },
            { t: 'Доставка', num: true, html: function (r) { return r.offer.delivery ? P.money(r.offer.delivery) : 'включена'; } },
            { t: 'Оплата', html: function (r) { return r.offer.prepay ? r.offer.prepay + '% предоплата' : 'отсрочка ' + r.offer.deferral + ' дн.'; } },
            { t: 'Срок', num: true, html: function (r) { return r.offer.lead + ' дн.'; } },
            { t: 'Итого с НДС', num: true, html: function (r) { return P.money(r.n.total); } },
            { t: 'Поправка на деньги', num: true, html: function (r) { return (r.n.finAdj > 0 ? '+' : '') + P.money(r.n.finAdj); } },
            { t: 'Приведённая сумма', num: true, html: function (r) { return '<b>' + P.money(r.n.adjusted) + '</b>' + (r.best ? '<div>' + P.badge('лучшее', 'ok') + '</div>' : '<div class="srm-muted">+' + String(r.gapPct).replace('.', ',') + '%</div>'); } },
            { t: '', node: function (r) { if (r.offer.chosen) return P.el('span', { html: P.badge('выбрано', 'violet') }); if (!canEdit) return null; return P.btn('Выбрать', function () { choose(r); }, 'srm-small'); } }
        ], rows, { rowCls: function (r) { return r.best ? 'srm-row-best' : r.offer.chosen ? 'srm-row-sel' : ''; }, empty: 'Предложений пока нет' }));
        function choose(r) {
            var ops = offers.filter(function (o) { return o.chosen && o.id !== r.offer.id; }).map(function (o) { return { op: 'set', id: o.id, fields: { 'Выбрано': '0' } }; });
            ops.push({ op: 'set', id: r.offer.id, fields: { 'Выбрано': '1' } }, { op: 'set', id: q.id, fields: { 'Стадия заявки': 'Выбор и согласование' } });
            P.batch(ops).then(function () { return P.event(q, 'Выбран поставщик ' + r.offer.sup + ' (приведённая сумма ' + P.money(r.n.adjusted) + (r.best ? ', лучшая' : ', не лучшая: +' + r.gapPct + '%') + ')', 'Выбор'); })
                .then(function () { P.toast('Выбран ' + r.offer.sup); P.reload(); }).catch(function (e) { P.toast(e.message, true); });
        }
        var bar = P.el('div', { 'class': 'srm-bar' });
        if (canEdit && invs.length) bar.appendChild(P.btn('Добавить КП из письма или Excel', function () { offerForm(M, q, invs); }));
        bar.appendChild(P.el('a', { 'class': 'srm-btn', href: P.nav('requests', 'req=' + encodeURIComponent(q.num)), text: 'Карточка заявки и журнал' }));
        host.appendChild(bar);
        var left = P.el('div', { 'class': 'srm-stack' }), right = P.el('div', { 'class': 'srm-stack' });
        left.appendChild(P.el('div', { 'class': 'srm-card' }, [P.el('h3', { text: 'История цен: ' + q.nom + ', ₽ с НДС за ' + unit }), P.el('div', { html: chart(C.priceHistory(M.contracts, q.nom, P.TODAY), rows, unit) })]));
        if (first && rows.length) { var fr = rows.filter(function (r) { return r.offer === first; })[0]; left.appendChild(P.el('p', { 'class': 'srm-muted', text: 'Экономия лучшего КП: ' + P.money(q.budget - rows[0].n.total) + ' от бюджета, ' + P.money(fr.n.adjusted - rows[0].n.adjusted) + ' от первого полученного КП (' + first.sup + '), ' + (last ? P.money(last.price * q.qty - rows[0].n.total) + ' от прошлой закупки.' : 'прошлой закупки нет.') })); }
        right.appendChild(P.routeBox(M, q, function () { P.reload(); }));
        if (chosen) {
            var n = C.normalizeOffer(chosen, q.qty, M.rules), a = P.admissionOf(M, chosen.sup), gate = C.contractGate(a, P.route(M, q).progress), sup = M.supBy[chosen.sup];
            var cbox = P.el('div', { 'class': 'srm-card' + (a.ok ? '' : ' srm-bad') }, [P.el('h3', { html: 'Договор с ' + P.esc(chosen.sup) + ' ' + P.light(M, chosen.sup) })]);
            a.warnings.forEach(function (w) { cbox.appendChild(P.box('w', w)); });
            var existing = M.contracts.filter(function (c) { return c.req === q.num; })[0];
            if (existing) cbox.appendChild(P.el('p', { html: 'Создан договор <b>' + P.esc(existing.num) + '</b> от ' + P.d(existing.date) + ' на ' + P.money(existing.sum) + '. <a href="' + P.nav('contracts', 'c=' + encodeURIComponent(existing.num)) + '">Этапы поставки</a>' }));
            else if (gate.ok) {
                cbox.appendChild(P.box('g', 'Допуск есть, маршрут пройден: можно заключать договор на ' + P.money(n.total) + '.'));
                if (P.canWrite('Договор')) cbox.appendChild(P.btn('Создать договор с этапами', function (e) { e.target.disabled = true; makeContract(M, q, chosen, n).then(function () { P.reload(); }).catch(function (er) { P.toast(er.message, true); e.target.disabled = false; }); }, 'srm-primary'));
            } else {
                cbox.appendChild(P.el('p', { html: '<b>Договор не создаётся:</b>' }));
                gate.reasons.forEach(function (r) { cbox.appendChild(P.box('e', r)); });
                if (!a.ok && sup && P.canWrite('Решение по допуску')) cbox.appendChild(P.btn('Допустить с обоснованием', function () { admit(M, q, sup); }, 'srm-primary'));
                else if (!a.ok) cbox.appendChild(P.el('p', { 'class': 'srm-muted', text: 'Снять ограничение может только служба безопасности: решение с обоснованием попадёт в журнал процедуры и в карточку поставщика.' }));
            }
            right.appendChild(cbox);
        } else right.appendChild(P.box('w', 'Поставщик ещё не выбран: нажмите «Выбрать» в строке предложения.'));
        host.appendChild(P.el('div', { 'class': 'srm-layout' }, [left, right]));
    }
    P.mount(render);
})();
