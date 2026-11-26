/* SRM: Заявки и маршрут. Список заявок, карточка с маршрутом по порогам (пороги правятся на месте), рассылка приглашений, новая заявка с проверкой на дробление. */
(function () {
    'use strict';
    var P = window.Srm, C = P.core;
    var st = { tab: 'open', sel: P.hash().req || '' };

    function splitLimit(M) { var t = M.thresholds.filter(function (x) { return /комисси/i.test(x.steps); })[0]; return t ? t.from : 3000000; }
    function newRequest(M) {
        var plants = M.plants.slice();
        if (/инициатор/.test(C.roleKey(P.ctx.role))) { var own = M.reqs.map(function (q) { return q.plant; }).filter(function (p, i, a) { return p && a.indexOf(p) === i; }); if (own.length) plants = own; }
        var plant = P.select(plants, plants[0]), nom = P.select(Object.keys(M.noms).map(function (n) { return [n, n + ' (' + M.noms[n].unit + ')']; }));
        var qty = P.input('number', '', { min: 0, step: 'any' }), budget = P.input('number', '', { min: 0, step: 1000 }), need = P.input('date', C.addDays(P.TODAY, 30)), why = P.input('textarea', '');
        var out = P.el('div', {});
        function check() {
            out.innerHTML = '';
            var cand = M.reqs.filter(function (q) { return q.stage !== 'Отменена'; }).map(function (q) { return { id: q.num, plant: q.plant, nom: q.nom, date: q.date, amount: q.budget }; });
            cand.push({ id: 'новая', plant: plant.value, nom: nom.value, date: P.TODAY, amount: C.num(budget.value) });
            var hit = C.detectSplitting(cand, splitLimit(M), M.rules).filter(function (g) { return g.items.some(function (i) { return i.id === 'новая'; }); })[0];
            if (hit) out.appendChild(P.box('w', 'Похоже на дробление: ' + hit.items.length + ' заявки «' + hit.nom + '» завода за ' + hit.days + ' дн. на ' + P.money(hit.sum) + ' при пороге комиссии ' + P.money(splitLimit(M)) + '. Заявка уйдёт с отметкой, директор увидит её в сводке.'));
            if (C.num(budget.value) > 0) { var r = C.routeFor(C.num(budget.value), M.thresholds); out.appendChild(P.box(r.commission ? 'w' : 'g', 'Маршрут: ' + r.steps.join(' - затем '))); }
        }
        [plant, nom, qty, budget].forEach(function (c) { c.addEventListener('input', check); c.addEventListener('change', check); });
        var body = P.el('div', {}, [P.el('div', { 'class': 'srm-grid2' }, [P.field('Завод', plant), P.field('Номенклатура', nom), P.field('Количество', qty), P.field('Бюджет, ₽ с НДС', budget), P.field('Нужно к дате', need)]), P.field('Обоснование', why), out]);
        P.modal('Новая заявка', body, [{ text: 'Отмена' }, { text: 'Создать заявку', cls: 'srm-primary', fn: function (close, b) {
            if (!C.num(qty.value) || !C.num(budget.value)) { P.toast('Заполните количество и бюджет', true); return false; }
            b.disabled = true;
            var num = C.nextNumber(M.reqs.map(function (q) { return q.num; }).concat(['З-2026-0152']), 'З-2026-');
            var f = { 'Заявка на закупку': num, 'Завод': plant.value, 'Номенклатура': nom.value, 'Категория закупок': M.noms[nom.value].cat, 'Количество': C.num(qty.value), 'Бюджет заявки': C.num(budget.value), 'Дата заявки': P.TODAY, 'Нужно к дате': need.value, 'Инициатор': P.ctx.user, 'Стадия заявки': 'Новая', 'Способ закупки': 'Запрос КП', 'Обоснование заявки': why.value };
            P.batch([{ op: 'new', id: 'Заявка на закупку', up: 1, fields: f }, { op: 'new', id: 'Событие процедуры', up: ':id0', fields: { 'Событие процедуры': 'Заявка создана: ' + nom.value + ', ' + qty.value + ' ' + M.noms[nom.value].unit, 'Дата события': P.TODAY, 'Автор события': P.ctx.user, 'Вид события': 'Создание' } }])
                .then(function () { P.toast('Заявка ' + num + ' создана'); st.sel = num; close(); P.reload(); }).catch(function (e) { P.toast(e.message, true); b.disabled = false; });
            return false;
        } }], true);
        check();
    }
    function sendInvites(M, q) {
        var due = P.input('date', C.addDays(P.TODAY, 5)), box = P.el('div', {}), checks = [];
        M.sups.filter(function (s) { return s.cats.indexOf(q.cat) >= 0; }).forEach(function (s) {
            var a = P.admissionOf(M, s.name), cb = P.el('input', { type: 'checkbox' }); cb.checked = a.ok; cb.disabled = !a.ok;
            checks.push([cb, s]);
            box.appendChild(P.el('label', { 'class': 'srm-kv' }, [P.el('span', {}, [cb, ' ' + s.name]), P.el('span', { html: P.light(M, s.name) + (a.ok ? '' : ' <small class="srm-muted">' + P.esc(a.reasons[0]) + '</small>') })]));
        });
        var unit = (M.noms[q.nom] || {}).unit || '';
        var lot = q.nom + ' - ' + q.qty + ' ' + unit + ', поставка: ' + q.plant;
        var letter = P.el('div', { 'class': 'srm-letter', text: 'Тема: Запрос КП ' + q.num + '\nПросим направить предложение: ' + lot + '.\nОтветить до ' + P.d(due.value) + ' по ссылке (без регистрации): ' + location.origin + P.nav('portal', 'inv=<код приглашения>') + '\nМожно загрузить Excel или заполнить форму.' });
        var body = P.el('div', {}, [P.el('p', { 'class': 'srm-muted', text: 'Аккредитованные поставщики категории «' + q.cat + '». Поставщики в красной зоне в рассылку не попадают.' }), box, P.field('Ответить до', due), P.el('h4', { text: 'Письмо со ссылкой' }), letter]);
        P.modal('Разослать приглашения: ' + q.num, body, [{ text: 'Отмена' }, { text: 'Разослать', cls: 'srm-primary', fn: function (close, b) {
            var pick = checks.filter(function (c) { return c[0].checked; }); if (!pick.length) { P.toast('Отметьте поставщиков', true); return false; }
            b.disabled = true;
            var ops = pick.map(function (c) { return { op: 'new', id: 'Приглашение', up: 1, fields: { 'Приглашение': C.inviteCode(), 'Заявка на закупку': q.id, 'Поставщик': c[1].id, 'Лот': lot, 'Отправлено': P.TODAY, 'Ответить до': due.value } }; });
            ops.push({ op: 'set', id: q.id, fields: { 'Стадия заявки': 'Сбор КП' } });
            P.batch(ops).then(function () { return P.event(q, 'Разосланы приглашения: ' + pick.map(function (c) { return c[1].name; }).join(', '), 'Рассылка'); })
                .then(function () { P.toast('Приглашения отправлены: ' + pick.length); close(); P.reload(); }).catch(function (e) { P.toast(e.message, true); b.disabled = false; });
            return false;
        } }], true);
    }
    function thresholdsBox(M, onChange) {
        var can = P.canWrite('Порог согласования'), wrap = P.el('div', { 'class': 'srm-card' }, [P.el('h3', { text: 'Пороги из положения о закупках' })]);
        wrap.appendChild(P.table([{ t: 'Порог', k: 'name' }, { t: 'Сумма от', num: true, node: function (t) { return can ? inp(t, 'from', 'Сумма от') : document.createTextNode(P.money(t.from)); } }, { t: 'до', num: true, node: function (t) { return can ? inp(t, 'to', 'Сумма до') : document.createTextNode(t.to === '' ? 'без границы' : P.money(t.to)); } }, { t: 'Шаги', html: function (t) { return P.esc(t.steps); } }], M.thresholds));
        function inp(t, k, field) {
            var i = P.input('number', t[k], { step: 100000, min: 0, style: 'width:130px', 'aria-label': field + ' ' + t.name });
            i.addEventListener('change', function () { t[k] = i.value === '' ? '' : C.num(i.value); var f = {}; f[field] = i.value; P.update(t.id, f).then(function () { P.toast('Порог сохранён: маршрут пересчитан'); onChange(); }).catch(function (e) { P.toast(e.message, true); }); });
            return i;
        }
        wrap.appendChild(P.el('p', { 'class': 'srm-muted', text: can ? 'Измените сумму - маршрут заявки пересчитается сразу, без программиста.' : 'Пороги правит директор по закупкам.' }));
        return wrap;
    }
    function card(M, q, slot, rerender) {
        slot.innerHTML = '';
        var offers = P.offersOf(M, q.num), invs = M.invs.filter(function (i) { return i.req === q.num; }), unit = (M.noms[q.nom] || {}).unit || '';
        var left = P.el('div', { 'class': 'srm-stack' }), right = P.el('div', { 'class': 'srm-stack' });
        var info = P.el('div', { 'class': 'srm-card' }, [P.el('h2', { html: P.esc(q.num) + ' ' + P.stageBadge(q.stage), style: 'margin-top:0' }),
            P.el('div', { 'class': 'srm-kv' }, [P.el('span', { text: 'Позиция' }), P.el('b', { text: q.nom + ', ' + q.qty + ' ' + unit })]),
            P.el('div', { 'class': 'srm-kv' }, [P.el('span', { text: 'Завод / инициатор' }), P.el('span', { text: q.plant + ' / ' + q.initiator })]),
            P.el('div', { 'class': 'srm-kv' }, [P.el('span', { text: 'Бюджет' }), P.el('span', { text: P.money(q.budget) })]),
            P.el('div', { 'class': 'srm-kv' }, [P.el('span', { text: 'Нужно к' }), P.el('span', { text: P.d(q.need) })]),
            P.el('div', { 'class': 'srm-kv' }, [P.el('span', { text: 'Способ' }), P.el('span', { text: q.method })]),
            P.el('p', { 'class': 'srm-muted', text: q.why || '' })]);
        var acts = P.el('div', { 'class': 'srm-bar' });
        if (q.stage === 'Новая' && P.canWrite('Приглашение')) acts.appendChild(P.btn('Разослать приглашения', function () { sendInvites(M, q); }, 'srm-primary'));
        if (offers.length || invs.length) acts.appendChild(P.el('a', { 'class': 'srm-btn', href: P.nav('compare', 'req=' + encodeURIComponent(q.num)), text: 'Сравнение КП (' + offers.length + ' из ' + invs.length + ')' }));
        info.appendChild(acts); left.appendChild(info);
        left.appendChild(P.routeBox(M, q, function () { P.reload(); }));
        left.appendChild(thresholdsBox(M, function () { rerender(); }));
        var jr = P.el('div', { 'class': 'srm-card' }, [P.el('h3', { text: 'Журнал процедуры' }), P.el('div', { 'class': 'srm-muted', text: 'Загрузка...' })]);
        right.appendChild(jr);
        P.eventsOf(q).then(function (ev) {
            jr.lastChild.remove();
            ev.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
            jr.appendChild(P.el('ul', { 'class': 'srm-journal' }, ev.map(function (e) { return P.el('li', {}, [e.text, P.el('small', { text: P.d(e.date) + ' - ' + e.who + (e.kind ? ' - ' + e.kind : '') })]); })));
        });
        if (invs.length && M.offers) right.appendChild(P.el('div', { 'class': 'srm-card' }, [P.el('h3', { text: 'Приглашения' }), P.table([{ t: 'Поставщик', html: function (i) { return P.light(M, i.sup) + ' ' + P.esc(i.sup); } }, { t: 'Ответ', html: function (i) { var o = offers.filter(function (x) { return x.invId === i.id; })[0]; return o ? P.badge(o.channel + ', ' + P.d(o.date), 'ok') : i.due < P.TODAY ? P.badge('нет ответа', 'mute') : P.badge('ждём до ' + P.d(i.due), 'warn'); } }], invs)]));
        slot.appendChild(P.el('div', { 'class': 'srm-layout' }, [left, right]));
    }
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('h1', { text: 'Заявки и маршрут согласования' }));
        host.appendChild(P.el('p', { 'class': 'srm-sub', text: 'Заявка завода идёт по маршруту из положения о закупках: порог суммы решает, нужны ли директор и комиссия. Рассылка, КП, подписи и договор - в одной карточке, со следом в журнале.' }));
        var open = M.reqs.filter(function (q) { return !/Исполнена|Отменена/.test(q.stage); });
        var mySign = open.filter(function (q) { var r = P.route(M, q); return r.progress.next && C.canSign(P.ctx.role, r.progress.next) && (P.chosenOf(M, q.num) || q.stage === 'Выбор и согласование'); });
        host.appendChild(P.el('div', { 'class': 'srm-kpis' }, [
            P.kpi('Открытые заявки', String(open.length), 'новые, сбор КП, выбор, договор'),
            P.kpi('Ждут моей подписи', String(mySign.length), mySign.map(function (q) { return q.num; }).join(', ') || 'нет', mySign.length ? 'warn' : 'good'),
            P.kpi('Сбор КП', String(open.filter(function (q) { return q.stage === 'Сбор КП'; }).length), 'приглашения разосланы'),
            P.kpi('С комиссией', String(open.filter(function (q) { return P.route(M, q).commission; }).length), 'сумма выше порога комиссии')
        ]));
        var bar = P.el('div', { 'class': 'srm-bar' }, [P.tabs([['open', 'Открытые'], ['all', 'Все']], st.tab, function (t) { st.tab = t; render(host, M); })]);
        if (P.canWrite('Заявка на закупку')) bar.appendChild(P.btn('Новая заявка', function () { newRequest(M); }, 'srm-primary'));
        host.appendChild(bar);
        var list = st.tab === 'open' ? open : M.reqs;
        host.appendChild(P.table([
            { t: 'Заявка', html: function (q) { return '<b>' + P.esc(q.num) + '</b><div class="srm-muted">' + P.d(q.date) + '</div>'; } },
            { t: 'Завод', k: 'plant' },
            { t: 'Позиция', html: function (q) { return P.esc(q.nom) + '<div class="srm-muted">' + q.qty + ' ' + P.esc((M.noms[q.nom] || {}).unit || '') + ', ' + P.esc(q.cat) + '</div>'; } },
            { t: 'Бюджет', num: true, html: function (q) { return P.money(q.budget); } },
            { t: 'Стадия', html: function (q) { return P.stageBadge(q.stage); } },
            { t: 'Маршрут', html: function (q) { return P.routeChips(M, q); } },
            { t: 'КП', num: true, html: function (q) { var n = P.offersOf(M, q.num).length, i = M.invs.filter(function (x) { return x.req === q.num; }).length; return i ? n + ' из ' + i : '-'; } }
        ], list, { onrow: function (q) { st.sel = q.num; location.hash = 'req=' + encodeURIComponent(q.num); paint(); }, rowCls: function (q) { return q.num === st.sel ? 'srm-row-sel' : ''; } }));
        var slot = P.el('div', { id: 'srm-card', style: 'margin-top:16px' });
        host.appendChild(slot);
        function paint() { var q = M.reqBy[st.sel]; if (q) { card(M, q, slot, function () { render(host, M); }); slot.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }
        if (!st.sel && M.reqBy['З-2026-0147']) st.sel = 'З-2026-0147';
        var q0 = M.reqBy[st.sel]; if (q0) card(M, q0, slot, function () { render(host, M); });
    }
    P.mount(render);
})();
