/* PIM: каталог карточек (список с индикаторами готовности по площадкам, фильтры, массовые действия) и переход в карточку. */
(function () {
    'use strict';
    var W = window.Pim, C = W.core, S = { q: '', cat: '', status: '', chan: '', sort: 'sku', sel: {}, limit: 60 }, M = null;

    function filtered() {
        var q = C.norm(S.q);
        var list = M.products.filter(function (p) {
            if (S.cat && p.category !== S.cat) return false;
            if (S.status && p.status !== S.status) return false;
            if (S.chan && (p._res || M.check(p))[S.chan].pct >= 100) return false;
            if (q && (p.sku + ' ' + p.name + ' ' + p.brand).toLowerCase().indexOf(q) < 0) return false;
            return true;
        });
        var minPct = function (p) { return Math.min.apply(null, M.channels.map(function (c) { return (p._res || M.check(p))[c.name].pct; })); };
        list.sort(function (a, b) { return S.sort === 'sku' ? (a.sku < b.sku ? -1 : 1) : S.sort === 'upd' ? (a.updated < b.updated ? 1 : -1) : S.sort === 'low' ? minPct(a) - minPct(b) || (a.sku < b.sku ? -1 : 1) : minPct(b) - minPct(a) || (a.sku < b.sku ? -1 : 1); });
        return list;
    }

    function massFill(list, host) {
        var selIds = Object.keys(S.sel), cats = S.cat ? [S.cat] : Object.keys(M.categories);
        var names = [], seen = {};
        cats.forEach(function (c) { M.categories[c].attrs.forEach(function (a) { if (!seen[a.name]) { seen[a.name] = 1; names.push(a.name); } }); });
        ['Страна производства', 'Бренд', 'Вес, г'].forEach(function (n) { if (!seen[n]) names.unshift(n); });
        var attrSel = W.select(names.map(function (n) { return [n, n]; }), names.indexOf('Страна производства') >= 0 ? 'Страна производства' : names[0]);
        var valBox = W.el('div', {}), val = '', scope = W.select([['filter', 'Все по фильтру (' + list.length + ')']].concat(selIds.length ? [['sel', 'Выбранные (' + selIds.length + ')']] : []), selIds.length ? 'sel' : 'filter');
        var mode = W.select([['empty', 'Только пустые'], ['all', 'Перезаписать все']], 'empty'), info = W.el('p', { 'class': 'pim-sub' }), plan = [];
        var countries = [];
        function curAttr() { return M.attrs[attrSel.value]; }
        function buildVal() {
            valBox.innerHTML = ''; val = ''; var a = curAttr(), el;
            if (a.field === 'country') el = W.select([['', '— выберите —']].concat(countries.map(function (c) { return [c, c]; })), '');
            else if (a.field === 'brand') el = W.select([['', '— выберите —']].concat(M.brands.map(function (c) { return [c, c]; })), '');
            else el = W.valueInput(a, '', function () {});
            var up = function () { val = el.value; recalc(); }; el.addEventListener('input', up); el.addEventListener('change', up);
            valBox.appendChild(W.field('Значение', el)); recalc();
        }
        function recalc() {
            var a = curAttr(), base = scope.value === 'sel' ? M.products.filter(function (p) { return S.sel[p.id]; }) : list;
            plan = val === '' ? [] : C.planMassFill(base, { attr: a, value: val, mode: mode.value });
            info.textContent = val === '' ? 'Выберите значение.' : 'Изменится карточек: ' + plan.length + ' из ' + base.length + (plan.length ? '. Например: ' + plan.slice(0, 3).map(function (x) { return x.sku + ' (' + (x.from || 'пусто') + ' → ' + x.to + ')'; }).join(', ') : '');
        }
        W.rows('Страна').then(function (r) { countries = r.map(function (x) { return x['Страна']; }); buildVal(); });
        [attrSel, scope, mode].forEach(function (e) { e.addEventListener('change', function () { if (e === attrSel) buildVal(); else recalc(); }); });
        W.modal('Массовое заполнение', W.el('div', {}, [W.field('Кого', scope), W.field('Атрибут', attrSel), valBox, W.field('Режим', mode), info]),
            [{ text: 'Отмена' }, { text: 'Заполнить', cls: 'pim-primary', keep: true, fn: function (close) {
                if (!plan.length) { W.toast('Нечего менять', true); return false; }
                var a = curAttr(), ops = [], byId = {};
                plan.forEach(function (x) { var p = M.byId[x.id]; byId[x.id] = p; var ch = a.field ? { fields: {} } : { values: {} }; if (a.field) ch.fields[a.field] = x.to; else ch.values[a.name] = x.to; x.ch = ch; W.cardOps(p, ch).forEach(function (o) { ops.push(o); }); });
                W.batch(ops).then(function () { plan.forEach(function (x) { W.applyLocal(byId[x.id], x.ch); }); M.checkAll(); W.toast('Заполнено карточек: ' + plan.length); close(); render(host); }).catch(function (e) { W.toast(e.message, true); });
                return false; } }]);
    }

    function bulkStatus(target, host) {
        var ids = Object.keys(S.sel), ok = [], skip = 0;
        ids.forEach(function (id) { var p = M.byId[id], b = C.statusBlockers(p, target, p._res || M.check(p)); if (b.length || p.status === target) skip++; else ok.push(p); });
        if (!ok.length) { W.toast('Ни одну карточку нельзя перевести: ' + (target === 'Готово к выгрузке' ? 'нет площадки со 100%' : 'проверьте данные'), true); return; }
        var ops = []; ok.forEach(function (p) { W.cardOps(p, { fields: { status: target } }).forEach(function (o) { ops.push(o); }); });
        W.batch(ops).then(function () { ok.forEach(function (p) { W.applyLocal(p, { fields: { status: target } }); }); W.toast('Статус «' + target + '»: ' + ok.length + (skip ? ', пропущено ' + skip : '')); S.sel = {}; render(host); }).catch(function (e) { W.toast(e.message, true); });
    }

    function render(host) {
        var hs = W.hash(), can = W.caps();
        if (hs.card && M.byId[hs.card]) { W.openCard(host, M, M.byId[hs.card], function () { location.hash = ''; M.checkAll(); render(host); }); return; }
        var list = filtered(), selN = Object.keys(S.sel).length;
        host.innerHTML = '';
        host.appendChild(W.el('h1', { text: 'Каталог карточек' }));
        host.appendChild(W.el('p', { 'class': 'pim-sub', text: 'Карточек: ' + M.products.length + '. Цвет индикатора - полнота обязательных атрибутов площадки: зелёный 100%, жёлтый от 70%, красный ниже. Наведите на индикатор, чтобы увидеть, чего не хватает.' }));
        var q = W.el('input', { type: 'search', placeholder: 'Поиск: артикул, название, бренд', value: S.q }); q.addEventListener('input', function () { S.q = q.value; S.limit = 60; renderBody(); });
        var cat = W.select([['', 'Все категории']].concat(Object.keys(M.categories).map(function (c) { return [c, c]; })), S.cat), st = W.select([['', 'Все статусы']].concat(M.statuses.map(function (s) { return [s, s]; })), S.status),
            ch = W.select([['', 'Любая готовность']].concat(M.channels.map(function (c) { return [c.name, 'Не готовы: ' + c.name]; })), S.chan), so = W.select([['sku', 'По артикулу'], ['low', 'Сначала менее готовые'], ['pct', 'Сначала более готовые'], ['upd', 'Недавно изменённые']], S.sort);
        [[cat, 'cat'], [st, 'status'], [ch, 'chan'], [so, 'sort']].forEach(function (x) { x[0].addEventListener('change', function () { S[x[1]] = x[0].value; S.limit = 60; render(host); }); });
        var bar = W.el('div', { 'class': 'pim-bar' }, [W.field('Поиск', q), W.field('Категория', cat), W.field('Статус', st), W.field('Готовность', ch), W.field('Порядок', so)]);
        if (can.edit) bar.appendChild(W.btn('Массовое заполнение' + (selN ? ' (' + selN + ')' : ''), function () { massFill(list, host); }));
        if (can.card && selN) bar.appendChild(W.btn('Выбранные → На проверку', function () { bulkStatus('На проверке', host); }));
        if (can.approve && selN) bar.appendChild(W.btn('Выбранные → Готово к выгрузке', function () { bulkStatus('Готово к выгрузке', host); }, 'pim-primary'));
        host.appendChild(bar);
        var body = W.el('div', {}); host.appendChild(body);
        function renderBody() {
            body.innerHTML = '';
            list = filtered(); var shown = list.slice(0, S.limit);
            var thead = W.el('thead', {}, [W.el('tr', {}, [W.el('th', {}, [W.el('input', { type: 'checkbox', 'class': 'pim-sel', 'aria-label': 'Выбрать все', onclick: function (e) { shown.forEach(function (p) { if (e.target.checked) S.sel[p.id] = 1; else delete S.sel[p.id]; }); render(host); } })])]
                .concat(['Артикул', 'Название', 'Статус'].map(function (t) { return W.el('th', { text: t }); }))
                .concat(M.channels.map(function (c) { return W.el('th', { 'class': 'pim-num', text: W.short(c.name) }); })).concat([W.el('th', { 'class': 'pim-num', text: 'Фото' })]))]);
            var tb = W.el('tbody', {}, shown.map(function (p) {
                var tr = W.el('tr', { 'class': 'pim-click', onclick: function (e) { if (e.target.tagName === 'INPUT') return; location.hash = 'card=' + p.id; render(host); } });
                var cb = W.el('input', { type: 'checkbox', 'class': 'pim-sel', 'aria-label': 'Выбрать ' + p.sku }); cb.checked = !!S.sel[p.id];
                cb.addEventListener('change', function () { if (cb.checked) S.sel[p.id] = 1; else delete S.sel[p.id]; });
                tr.appendChild(W.el('td', {}, [cb])); tr.appendChild(W.el('td', { text: p.sku }));
                tr.appendChild(W.el('td', { html: '<b>' + W.esc(p.name || '—') + '</b><br><span class="pim-sub">' + W.esc(p.category) + ' · ' + W.esc(p.brand || 'бренд не указан') + '</span>' }));
                tr.appendChild(W.el('td', { html: W.statusBadge(p.status) }));
                M.channels.forEach(function (c) { tr.appendChild(W.el('td', { 'class': 'pim-num', html: W.pill((p._res || M.check(p))[c.name]) })); });
                tr.appendChild(W.el('td', { 'class': 'pim-num', text: String(p.photos) }));
                return tr;
            }));
            if (!shown.length) tb.appendChild(W.el('tr', {}, [W.el('td', { colspan: 8, 'class': 'pim-empty', text: 'Нет карточек по фильтру' })]));
            body.appendChild(W.el('div', { 'class': 'pim-tablewrap' }, [W.el('table', { 'class': 'pim-table' }, [thead, tb])]));
            body.appendChild(W.el('p', { 'class': 'pim-sub', text: 'Показано ' + shown.length + ' из ' + list.length }));
            if (list.length > shown.length) body.appendChild(W.btn('Показать ещё 60', function () { S.limit += 60; renderBody(); }));
        }
        renderBody();
    }

    W.mount(function (host) {
        return W.loadModel().then(function (m) {
            M = m; var h = W.hash(); if (h.status) S.status = h.status; if (h.chan) S.chan = h.chan; if (h.cat) S.cat = h.cat;
            return W.rows('Бренд').then(function (b) { M.brands = b.map(function (x) { return x['Бренд']; }); render(host); window.addEventListener('hashchange', function () { render(host); }); });
        });
    });
})();
