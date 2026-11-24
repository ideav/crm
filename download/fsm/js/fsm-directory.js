/* FSM: справочники (экран directory): инженеры и допуски, склад в машинах, оборудование, заказчики и объекты. Только чтение. */
(function () {
    'use strict';
    var W = window.Fsm, C = W.core, E = W.esc;
    var M, types = {}, state = { tab: 'eng', q: '', eq: '', open: {} };
    var body;

    function today() { return C.dayStart(W.now()); }
    function ordersOf(name) {
        var d = today(), res = { today: 0, open: 0 };
        M.orders.forEach(function (o) {
            if (o.eng !== name || o.status === 'Отменён') return;
            if (C.dayStart(o.win0 || o.created) === d) res.today++;
            if (C.isOpen(o)) res.open++;
        });
        return res;
    }
    function chip(eng, k) {
        var r = C.skillOk(eng, k.skill, W.now()), cls = 'fsm-dir-chip', note = '';
        if (k.until) {
            if (!r.valid) { cls += ' fsm-crit'; note = ' (истёк ' + C.fmtDate(C.parseDt(k.until)) + ')'; }
            else if (r.soon) { cls += ' fsm-warn'; note = ' (до ' + C.fmtDate(C.parseDt(k.until)) + ')'; }
            else cls += ' fsm-ok';
        } else cls += ' fsm-dir-chip-n';
        return '<span class="' + cls + '"' + (k.doc ? ' title="Документ ' + E(k.doc) + '"' : '') + '>' + E(k.skill) + E(note) + '</span>';
    }
    function sec(title, node, cls) { return W.el('section', { 'class': 'fsm-dir-sec ' + (cls || '') }, [W.el('h2', { text: title }), node]); }
    function fmtQ(x) { return W.right(x); }

    /* ---------- 1. инженеры ---------- */
    function engModal(e) {
        var box = W.el('div', { 'class': 'fsm-dir-card' });
        var h = '<div class="fsm-kv"><span>Телефон</span><span>' + E(e.phone) + '</span></div><div class="fsm-kv"><span>Район</span><span>' + E(e.district) + '</span></div>' +
            '<div class="fsm-kv"><span>Смена</span><span>' + E(e.from) + '-' + E(e.to) + (e.works ? '' : ' (не работает)') + '</span></div><div class="fsm-kv"><span>Автомобиль</span><span>' + E(e.car) + '</span></div>' +
            '<div class="fsm-kv"><span>Максимум нарядов в день</span><span>' + e.max + '</span></div>';
        h += '<h4>Матрица навыков</h4>';
        h += e.skills.length ? '<table class="fsm-table fsm-dir-mini"><thead><tr><th>Навык</th><th>Допуск до</th><th>Документ</th><th>Состояние</th></tr></thead><tbody>' + e.skills.map(function (k) {
            var r = C.skillOk(e, k.skill, W.now()), s = !k.until ? W.badge('без документа', 'info') : !r.valid ? W.badge('истёк', 'crit') : r.soon ? W.badge('истекает', 'warn') : W.badge('действует', 'ok');
            return '<tr><td>' + E(k.skill) + '</td><td>' + E(k.until ? C.fmtDate(C.parseDt(k.until)) : '—') + '</td><td>' + E(k.doc || '—') + '</td><td>' + s + '</td></tr>';
        }).join('') + '</tbody></table>' : '<p class="fsm-sub">Навыков нет.</p>';
        h += '<h4>Остатки в машине</h4>';
        h += e.stock.length ? '<table class="fsm-table fsm-dir-mini"><thead><tr><th>Материал</th><th class="fsm-num">Остаток</th><th class="fsm-num">Минимум</th></tr></thead><tbody>' + e.stock.map(function (s) {
            var low = s.qty < s.min;
            return '<tr' + (low ? ' class="fsm-row-bad"' : '') + '><td>' + E(s.name) + (low ? ' ' + W.badge('ниже минимума', 'crit') : '') + '</td><td class="fsm-num">' + fmtQ(s.qty) + '</td><td class="fsm-num">' + fmtQ(s.min) + '</td></tr>';
        }).join('') + '</tbody></table>' : '<p class="fsm-sub">Склад в машине не заведён.</p>';
        box.innerHTML = h;
        W.modal(e.name, box, [{ text: 'Закрыть' }]);
    }
    function tabEng(root) {
        var cov = C.skillCoverage(M.engineers, W.now());
        root.appendChild(W.el('div', { 'class': 'fsm-dir-warn' }, [
            W.el('span', { 'class': 'fsm-badge fsm-' + (cov.soon ? 'warn' : 'ok'), text: 'Допусков истекает в ближайшие 30 дней: ' + cov.soon }),
            W.el('span', { 'class': 'fsm-badge fsm-' + (cov.expired ? 'crit' : 'ok'), text: 'Допусков истекло: ' + cov.expired })]));
        var covRows = cov.skills.map(function (s) { return { skill: s.skill, valid: s.valid, soon: s.soon, expired: s.expired }; });
        var matrix = W.table([
            { t: 'Навык', k: 'skill' },
            { t: 'Инженеров с действующим допуском', num: true, html: function (r) { return r.valid === 0 ? W.badge('0: дефицит', 'crit') : r.valid === 1 ? W.badge('1: один исполнитель', 'warn') : W.badge(String(r.valid), 'ok'); } },
            { t: 'Истекает', num: true, html: function (r) { return r.soon ? W.badge(String(r.soon), 'warn') : '0'; } },
            { t: 'Истёк', num: true, html: function (r) { return r.expired ? W.badge(String(r.expired), 'crit') : '0'; } }], covRows, { empty: 'Данных о навыках нет (нет доступа или навыки не заведены)' });
        root.appendChild(sec('Навык × число инженеров с действующим допуском', matrix));
        var rows = M.engineers.map(function (e) { var o = ordersOf(e.name); return { e: e, name: e.name, district: e.district, shift: e.from + '-' + e.to, phone: e.phone, car: e.car, today: o.today, open: o.open }; });
        var tb = W.table([
            { t: 'Инженер', html: function (r) { return '<b>' + E(r.name) + '</b>' + (r.e.works ? '' : ' ' + W.badge('не работает', 'warn')); } }, { t: 'Район', k: 'district' },
            { t: 'Смена', html: function (r) { return '<span class="fsm-nowrap">' + E(r.shift) + '</span>'; } }, { t: 'Телефон', html: function (r) { return '<span class="fsm-nowrap">' + E(r.phone) + '</span>'; } }, { t: 'Автомобиль', k: 'car' },
            { t: 'Навыки и допуски', html: function (r) { return r.e.skills.map(function (k) { return chip(r.e, k); }).join(' ') || '<span class="fsm-sub">нет</span>'; } },
            { t: 'Нарядов сегодня', num: true, k: 'today' }, { t: 'Открытых', num: true, k: 'open' }], rows, { onrow: function (r) { engModal(r.e); }, empty: 'Нет доступа к списку инженеров' });
        root.appendChild(sec('Инженеры', tb));
        root.appendChild(W.el('div', { 'class': 'fsm-legend' }, [W.el('span', { html: '<span class="fsm-dir-chip fsm-ok">действует</span> <span class="fsm-dir-chip fsm-warn">истекает в 30 дней</span> <span class="fsm-dir-chip fsm-crit">истёк</span> <span class="fsm-dir-chip fsm-dir-chip-n">без документа</span>' })]));
    }

    /* ---------- 2. склад ---------- */
    function tabStock(root) {
        var low = C.lowStock(M.engineers);
        var box = W.el('div', { 'class': 'fsm-dir-lowbox' + (low.length ? ' fsm-dir-lowbox-bad' : '') });
        box.appendChild(W.el('b', { text: 'Ниже минимума: ' + low.length + ' ' + (low.length % 10 === 1 && low.length % 100 !== 11 ? 'позиция' : (low.length % 10 >= 2 && low.length % 10 <= 4 && (low.length % 100 < 10 || low.length % 100 >= 20)) ? 'позиции' : 'позиций') }));
        if (low.length) box.appendChild(W.el('ul', { 'class': 'fsm-list' }, low.map(function (x) { return W.el('li', { 'class': 'fsm-dir-red', text: x.eng + ': ' + x.name + ', остаток ' + fmtQ(x.qty) + ', минимум ' + fmtQ(x.min) }); })));
        root.appendChild(box);
        var names = {}; M.engineers.forEach(function (e) { e.stock.forEach(function (s) { names[s.name] = 1; }); });
        var list = Object.keys(names).sort();
        var thead = '<tr><th>Инженер</th>' + list.map(function (n) { return '<th class="fsm-num">' + E(n) + '</th>'; }).join('') + '</tr>';
        var tbody = M.engineers.map(function (e) {
            var by = {}; e.stock.forEach(function (s) { by[s.name] = s; });
            return '<tr><td><b>' + E(e.name) + '</b></td>' + list.map(function (n) {
                var s = by[n]; if (!s) return '<td class="fsm-num fsm-sub">—</td>';
                return '<td class="fsm-num' + (s.qty < s.min ? ' fsm-dir-lowcell' : '') + '" title="минимум ' + fmtQ(s.min) + '">' + fmtQ(s.qty) + '</td>';
            }).join('') + '</tr>';
        }).join('');
        var t = W.el('div', { 'class': 'fsm-tablewrap' }, [W.el('table', { 'class': 'fsm-table fsm-dir-stock', html: '<thead>' + thead + '</thead><tbody>' + tbody + '</tbody>' })]);
        root.appendChild(sec('Остатки по инженерам', M.engineers.length && list.length ? t : W.el('p', { 'class': 'fsm-sub', text: 'Нет данных о складе (нет доступа или остатки не заведены).' })));
        root.appendChild(W.el('div', { 'class': 'fsm-legend', html: '<span><span class="fsm-dir-lowcell fsm-dir-swatch"></span> остаток ниже минимума</span>' }));
        var cat = Object.keys(M.nomen).map(function (k) { return M.nomen[k]; }).sort(function (a, b) { return a.name < b.name ? -1 : 1; });
        root.appendChild(sec('Каталог номенклатуры', W.table([{ t: 'Наименование', k: 'name' }, { t: 'Артикул', k: 'art' }, { t: 'Ед. изм.', k: 'unit' }, { t: 'Цена, ₽', num: true, html: function (r) { return r.price.toLocaleString('ru-RU'); } }], cat, { empty: 'Номенклатура недоступна' })));
    }

    /* ---------- 3. оборудование ---------- */
    function eqCard(eq) {
        var ob = M.objects[eq.obj] || {}, now = W.now(), war = C.warrantyState(eq.warr, now), trips = C.recentVisits(M.orders, eq.name, null, now, 90).length, hist = C.equipHistory(M.orders, eq.name);
        var h = '<h3>' + E(eq.name) + '</h3>';
        h += '<div class="fsm-dir-flags">' + (trips >= 3 ? W.badge('Часто ломается', 'crit') + ' ' : '') + W.badge(war.text, war.state === 'on' ? 'ok' : war.state === 'off' ? 'warn' : 'info') + '</div>';
        [['Модель', eq.model], ['Серийный №', eq.serial], ['Вид', eq.kind], ['Объект', String(eq.obj).split(' · ').pop()], ['Заказчик', ob.client || String(eq.obj).split(' · ')[0]], ['Адрес', ob.address], ['Установлено', eq.inst ? C.fmtDate(C.parseDt(eq.inst)) : ''],
            ['Гарантия до', eq.warr ? C.fmtDate(C.parseDt(eq.warr)) : '—'], ['Выездов за 90 дней', String(trips)]].forEach(function (p) { h += '<div class="fsm-kv"><span>' + E(p[0]) + '</span><span>' + E(p[1] || '—') + '</span></div>'; });
        h += '<h4>История нарядов (' + hist.length + ')</h4>';
        if (!hist.length) h += '<p class="fsm-sub">Нарядов по этому оборудованию нет.</p>';
        else h += '<ol class="fsm-dir-timeline">' + hist.map(function (o) {
            var d = o.fin || o.arr || o.dep || o.win0 || o.created, s = C.slaState(o, now, W.opts);
            var sla = s.state === 'met' ? W.badge('в срок', 'ok') : s.state === 'missed' ? W.badge('с просрочкой', 'crit') : s.state === 'none' ? '' : W.slaBadge(o);
            return '<li><div class="fsm-dir-tl-d">' + E(C.fmtDate(d)) + '</div><div class="fsm-dir-tl-b"><b>' + E(o.wt) + '</b> <span class="fsm-sub">' + E(o.num) + '</span><div class="fsm-dir-tl-m">' + E(o.eng || 'без инженера') + ' ' +
                W.badge(o.status, W.STATUS_CLS[o.status] || 'info') + ' ' + sla + (o.repeat ? ' ' + W.badge('Повторный выезд', 'warn') : '') + (o.warranty ? ' ' + W.badge('Гарантия', 'info') : '') + '</div></div></li>';
        }).join('') + '</ol>';
        return h;
    }
    function tabEq(root) {
        var eqs = Object.keys(M.equipment).map(function (k) { return M.equipment[k]; });
        var q = state.q.trim().toLowerCase();
        var list = eqs.filter(function (e) { var ob = M.objects[e.obj] || {}; return !q || [e.name, e.obj, ob.client, e.model, e.serial].join(' ').toLowerCase().indexOf(q) >= 0; })
            .sort(function (a, b) { return a.obj < b.obj ? -1 : a.obj > b.obj ? 1 : a.name < b.name ? -1 : 1; });
        var qIn = W.el('input', { type: 'search', placeholder: 'Объект, заказчик, модель, серийный номер', value: state.q, 'aria-label': 'Поиск оборудования' });
        var wrap = W.el('div', { 'class': 'fsm-dir-eq' }), left = W.el('div', { 'class': 'fsm-dir-eqlist' }), card = W.el('div', { 'class': 'fsm-card fsm-dir-eqcard' });
        function fill() {
            var qq = qIn.value.trim().toLowerCase();
            state.q = qIn.value;
            var shown = eqs.filter(function (e) { var ob = M.objects[e.obj] || {}; return !qq || [e.name, e.obj, ob.client, e.model, e.serial].join(' ').toLowerCase().indexOf(qq) >= 0; })
                .sort(function (a, b) { return a.obj < b.obj ? -1 : a.obj > b.obj ? 1 : a.name < b.name ? -1 : 1; });
            left.innerHTML = '';
            left.appendChild(W.el('p', { 'class': 'fsm-sub', text: 'Найдено: ' + shown.length + (shown.length > 60 ? ' (показаны первые 60)' : '') }));
            shown.slice(0, 60).forEach(function (e) {
                left.appendChild(W.el('button', { type: 'button', 'class': 'fsm-dir-eqitem' + (state.eq === e.name ? ' fsm-dir-eqitem-on' : ''), onclick: function () { state.eq = e.name; fill(); } },
                    [W.el('b', { text: e.name }), W.el('span', { 'class': 'fsm-sub', text: String(e.obj).split(' · ').reverse().join(', ') + ' · ' + (e.serial || '') })]));
            });
            var cur = state.eq && M.equipment[state.eq];
            if (cur) card.innerHTML = eqCard(cur); else card.innerHTML = '<p class="fsm-sub">Выберите оборудование в списке слева: откроется карточка с историей нарядов.</p>';
        }
        qIn.oninput = fill;
        root.appendChild(W.el('div', { 'class': 'fsm-bar' }, [W.field('Поиск', qIn)]));
        wrap.appendChild(left); wrap.appendChild(card); root.appendChild(wrap);
        fill();
    }

    /* ---------- 4. заказчики и объекты ---------- */
    function tabClients(root) {
        var now = W.now(), names = Object.keys(M.clients).sort(), byClient = {};
        Object.keys(M.objects).forEach(function (k) { var o = M.objects[k]; (byClient[o.client] = byClient[o.client] || []).push(o); });
        var thead = '<tr><th>Заказчик</th><th>Тип договора</th><th class="fsm-num">Коэфф. SLA</th><th>Договор</th><th class="fsm-num">Объектов</th><th class="fsm-num">Нарядов за 30 дней</th><th class="fsm-num">SLA, %</th></tr>';
        var tbl = W.el('table', { 'class': 'fsm-table fsm-dir-clients', html: '<thead>' + thead + '</thead>' }), tb = W.el('tbody');
        tbl.appendChild(tb);
        function draw() {
            tb.innerHTML = '';
            if (!names.length) { tb.innerHTML = '<tr><td colspan="7" class="fsm-empty">Нет данных о заказчиках</td></tr>'; return; }
            names.forEach(function (n) {
                var c = M.clients[n], st = C.clientStats(M.orders, n, now, 30), objs = byClient[n] || [], t = types[c['Тип договора']] || {}, open = !!state.open[n];
                var tr = W.el('tr', { 'class': 'fsm-click', onclick: function () { if (state.open[n]) delete state.open[n]; else state.open[n] = 1; draw(); } });
                tr.innerHTML = '<td><b>' + (open ? '&#9662; ' : '&#9656; ') + E(n) + '</b><div class="fsm-sub fsm-dir-small">' + E(c['Контактное лицо'] || '') + ' ' + E(c['Телефон'] || '') + '</div></td><td>' + E(c['Тип договора'] || '') + (t.paid ? ' ' + W.badge('платный выезд', 'info') : '') + '</td><td class="fsm-num">' +
                    (t.k !== undefined ? E(W.right(t.k)) : '') + '</td><td>' + E(c['Номер договора'] || '') + '</td><td class="fsm-num">' + objs.length + '</td><td class="fsm-num">' + st.orders + '</td><td class="fsm-num">' +
                    (st.hasSla ? W.badge(Math.round(st.slaPct) + '%', st.slaPct >= 90 ? 'ok' : st.slaPct >= 75 ? 'warn' : 'crit') : '—') + '</td>';
                tb.appendChild(tr);
                if (open) {
                    var td = W.el('td', { colspan: 7, 'class': 'fsm-dir-objcell' });
                    td.innerHTML = objs.length ? '<div class="fsm-tablewrap"><table class="fsm-table fsm-dir-mini"><thead><tr><th>Объект</th><th>Адрес</th><th>Район</th><th>Флаги</th><th>Контакт на объекте</th><th>Как пройти</th></tr></thead><tbody>' + objs.map(function (o) {
                        return '<tr><td>' + E(String(o.name).split(' · ').pop()) + '</td><td>' + E(o.address) + '</td><td>' + E(o.district) + '</td><td>' + (o.nosig ? W.badge('Нет связи', 'warn') + ' ' : '') + (o.pass ? W.badge('Пропуск нужен', 'info') : '') + (o.nosig || o.pass ? '' : '<span class="fsm-sub">нет</span>') + '</td><td>' + E(o.onsite || '—') + '</td><td>' + E(o.how || '—') + '</td></tr>';
                    }).join('') + '</tbody></table></div>' : '<span class="fsm-sub">Объектов нет</span>';
                    tb.appendChild(W.el('tr', { 'class': 'fsm-dir-objrow' }, [td]));
                }
            });
        }
        draw();
        root.appendChild(W.el('p', { 'class': 'fsm-sub', text: 'Нажмите на заказчика, чтобы раскрыть его объекты. SLA — доля нарядов, выполненных в срок, за последние 30 дней.' }));
        root.appendChild(W.el('div', { 'class': 'fsm-tablewrap' }, [tbl]));
    }

    var TABS = [['eng', 'Инженеры'], ['stock', 'Склад в машинах'], ['eq', 'Оборудование'], ['clients', 'Заказчики и объекты']];
    function render() {
        body.innerHTML = '';
        body.appendChild(W.el('h1', { text: 'Справочники' }));
        body.appendChild(W.el('p', { 'class': 'fsm-sub', text: 'Инженеры и допуски, склад в машинах, оборудование и заказчики. Только просмотр.' }));
        body.appendChild(W.tabs(TABS, state.tab, function (t) { state.tab = t; render(); }));
        var root = W.el('div', { 'class': 'fsm-dir-body' });
        body.appendChild(root);
        ({ eng: tabEng, stock: tabStock, eq: tabEq, clients: tabClients })[state.tab](root);
    }

    W.mount(function (host) {
        body = host; host.classList.add('fsm-dir-screen');
        return Promise.all([W.load(), W.canRead('Тип договора') ? W.rows('Тип договора').catch(function () { return []; }) : []]).then(function (r) {
            M = r[0];
            r[1].forEach(function (t) { types[t['Тип договора']] = { k: C.num(t['Коэффициент SLA']), paid: W.bool(t['Платный выезд']) }; });
            render();
        });
    });
})();
