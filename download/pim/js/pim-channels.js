/* PIM: площадки и соответствия. Наборы атрибутов площадок по категориям, привязка к нашим атрибутам, таблица соответствий значений. */
(function () {
    'use strict';
    var W = window.Pim, C = W.core, S = { chan: '', cat: '' }, M = null;

    function coverage(ca) {
        var a = M.attrs[ca.ours]; if (!a || !ca.values.length || !a.values.length) return null;
        var ok = a.values.filter(function (v) { return C.translate(ca, v, M.valueMap).ok; });
        return { ok: ok.length, total: a.values.length, miss: a.values.filter(function (v) { return !C.translate(ca, v, M.valueMap).ok; }) };
    }
    function valuesModal(ca, host) {
        var a = M.attrs[ca.ours], can = W.caps().mapping;
        var rows = a.values.map(function (v) { var t = C.translate(ca, v, M.valueMap); return { v: v, to: t.ok ? t.value : '', how: t.ok ? (t.mapped ? 'таблица соответствий' : 'совпадает') : 'нет соответствия', ok: t.ok }; });
        var body = W.el('div', {}, [W.el('p', { 'class': 'pim-sub', text: ca.channel + ' / ' + ca.title + '. Справочник площадки: ' + ca.values.join(', ') + '.' }),
            W.table([{ k: 'v', t: 'Наше значение' }, { k: 'to', t: 'Значение площадки' }, { k: 'how', t: 'Как', cls: function (r) { return r.ok ? '' : 'pim-i-bad'; } }], rows, { rowCls: function (r) { return r.ok ? '' : 'pim-row-bad'; }, onrow: can ? function (r) { if (r.how === 'совпадает') { W.toast('Значение совпадает со справочником'); return; } W.mapValueModal(M, ca, r.v, function () { render(host); }); } : null })]);
        W.modal('Соответствие значений', body);
    }
    function render(host) {
        host.innerHTML = '';
        host.appendChild(W.el('h1', { text: 'Площадки и соответствия' }));
        var can = W.caps();
        var ch = M.chan(S.chan);
        host.appendChild(W.el('div', { 'class': 'pim-kpis' }, M.channels.map(function (c) {
            var as = M.chanAttrs.filter(function (a) { return a.channel === c.name; }), req = as.filter(function (a) { return a.required; }).length, miss = as.filter(function (a) { var cv = coverage(a); return cv && cv.miss.length; }).length;
            var d = W.el('div', { 'class': 'pim-kpi pim-click', html: '<small>' + W.esc(c.type) + '</small><b style="font-size:1.1rem">' + W.esc(c.name) + '</b><small>атрибутов: ' + as.length + ', обязательных: ' + req + '<br>' + (miss ? '<span class="pim-i-bad">значений без соответствия: у ' + miss + ' атрибутов</span>' : 'соответствия полные') + '</small>' });
            d.addEventListener('click', function () { S.chan = c.name; render(host); }); return d;
        })));
        host.appendChild(W.el('p', { 'class': 'pim-note', text: 'Справочники площадок (поля, обязательность, допустимые значения, лимиты) лежат в данных и демонстрационные: их обновляют загрузкой, а не правкой кода. Обмен по API Ozon, Wildberries и Яндекс Маркета не подключён: ' + (ch.api || 'доработка 12-16 ч на площадку') + '.' }));
        var chs = W.select(M.channels.map(function (c) { return [c.name, c.name]; }), S.chan); chs.addEventListener('change', function () { S.chan = chs.value; render(host); });
        var cats = W.select(Object.keys(M.categories).map(function (c) { return [c, c]; }), S.cat); cats.addEventListener('change', function () { S.cat = cats.value; render(host); });
        host.appendChild(W.el('div', { 'class': 'pim-bar' }, [W.field('Площадка', chs), W.field('Категория', cats)]));
        host.appendChild(W.el('p', { 'class': 'pim-sub', text: ch.name + ': лимит названия ' + ch.titleLimit + ', описания ' + ch.descLimit + ', минимум фото ' + ch.minPhotos + ', шаблон названия «' + ch.template + '», выгрузка: ' + (ch.format || '') }));
        var as = M.chanAttrs.filter(function (a) { return a.channel === S.chan && a.category === S.cat; }).sort(function (a, b) { return a.order - b.order; });
        var ours = Object.keys(M.attrs);
        var tbl = W.el('table', { 'class': 'pim-table' }, [W.el('thead', {}, [W.el('tr', {}, ['Атрибут площадки', 'Обяз.', 'Наш атрибут', 'Лимит', 'Справочник', 'Значения'].map(function (t) { return W.el('th', { text: t }); }))]),
            W.el('tbody', {}, as.map(function (a) {
                var cv = coverage(a), sel = W.select([['', '— нет соответствия —']].concat(ours.map(function (o) { return [o, o]; })), a.ours || ''); sel.disabled = !can.mapping;
                sel.addEventListener('change', function () { W.batch([{ op: 'save', id: a.id, fields: { 'Наш атрибут': sel.value } }]).then(function () { a.ours = sel.value; M.checkAll(); W.toast('Привязка сохранена'); render(host); }).catch(function (e) { W.toast(e.message, true); }); });
                var cell = W.el('td', {}, a.values.length ? [W.btn(cv ? (cv.miss.length ? 'без соответствия: ' + cv.miss.length : 'все сопоставлены') : 'значения', function () { if (cv) valuesModal(a, host); }, cv && cv.miss.length ? 'pim-danger' : '')] : []);
                return W.el('tr', { 'class': !a.ours && a.required ? 'pim-row-bad' : '' }, [W.el('td', { text: a.title }), W.el('td', { text: a.required ? 'да' : '' }), W.el('td', {}, [sel]), W.el('td', { 'class': 'pim-num', text: a.limit ? String(a.limit) : '' }), W.el('td', { 'class': 'pim-sub', text: a.values.length ? a.values.length + ' знач.' : 'свободный ввод' }), cell]);
            }))]);
        host.appendChild(W.el('div', { 'class': 'pim-tablewrap' }, [tbl]));
        if (!can.mapping) host.appendChild(W.el('p', { 'class': 'pim-sub', text: 'Только просмотр: править соответствия может контент-менеджер.' }));
    }
    W.mount(function (host) { return W.loadModel().then(function (m) { M = m; S.chan = M.channels[0].name; S.cat = Object.keys(M.categories)[0]; render(host); }); });
})();
