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
    /* Лимиты площадки: правятся здесь (право на запись в «Площадка»), пометка «сверить с документацией» - по настройке. */
    function limitsBox(host, ch, can) {
        var box = W.el('div', { 'class': 'pim-card' }), ln = C.limitsNote(ch, M.settings);
        box.appendChild(W.el('h2', { text: ch.name + ': лимиты и шаблон' }));
        if (ln) box.appendChild(W.el('p', { 'class': ln.warn ? 'pim-note' : 'pim-sub', text: ln.text }));
        var defs = [['Лимит названия', 'titleLimit', 'number'], ['Лимит описания', 'descLimit', 'number'], ['Мин. фото', 'minPhotos', 'number'], ['Шаблон названия', 'template', 'text'], ['Источник лимитов (ссылка на документацию)', 'limitsSource', 'text']], inputs = {};
        var form = W.el('div', { 'class': 'pim-form' });
        defs.forEach(function (d) {
            var el = W.el('input', { type: 'text', value: ch[d[1]] === undefined || ch[d[1]] === null ? '' : String(ch[d[1]]), inputmode: d[2] === 'number' ? 'numeric' : 'text' }); el.disabled = !can.limits; inputs[d[1]] = el;
            form.appendChild(W.field(d[0], el));
        });
        box.appendChild(form);
        if (can.limits) {
            var bar = W.el('div', { 'class': 'pim-bar' });
            function save(verified) {
                var f = {}; f['Лимит названия'] = String(C.num(inputs.titleLimit.value)); f['Лимит описания'] = String(C.num(inputs.descLimit.value)); f['Мин. фото'] = String(C.num(inputs.minPhotos.value));
                f['Шаблон названия'] = inputs.template.value; f['Источник лимитов'] = inputs.limitsSource.value; if (verified) f['Лимиты сверены'] = W.TODAY;
                W.batch([{ op: 'save', id: ch.id, fields: f }]).then(function () {
                    ch.titleLimit = C.num(inputs.titleLimit.value); ch.descLimit = C.num(inputs.descLimit.value); ch.minPhotos = C.num(inputs.minPhotos.value); ch.template = inputs.template.value; ch.limitsSource = inputs.limitsSource.value;
                    if (verified) ch.limitsChecked = W.dmy(W.TODAY);
                    M.checkAll(); W.toast('Лимиты сохранены, готовность пересчитана'); render(host);
                }).catch(function (e) { W.toast(e.message, true); });
            }
            bar.appendChild(W.btn('Сохранить лимиты', function () { save(false); }, 'pim-primary'));
            bar.appendChild(W.btn('Сохранить и отметить «сверено с документацией»', function () { save(true); }));
            box.appendChild(bar);
        } else box.appendChild(W.el('p', { 'class': 'pim-sub', text: 'Только просмотр: лимиты правит руководитель e-commerce или контент-менеджер.' }));
        host.appendChild(box);
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
        limitsBox(host, ch, can);
        var as = M.chanAttrs.filter(function (a) { return a.channel === S.chan && a.category === S.cat; }).sort(function (a, b) { return a.order - b.order; });
        var ours = Object.keys(M.attrs);
        function limitCell(a, host, can) {
            var at = M.attrs[a.ours], fixed = at && (at.field === 'name' || at.field === 'desc');
            if (fixed) return W.el('td', { 'class': 'pim-num', title: 'Лимит названия и описания задаётся выше, для всей площадки', text: String(C.limitFor(a, at, ch) || '') });
            var el = W.el('input', { type: 'text', value: a.limit ? String(a.limit) : '', inputmode: 'numeric', style: 'width:5em' }); el.disabled = !can.limits;
            el.addEventListener('change', function () { var v = C.num(el.value); W.batch([{ op: 'save', id: a.id, fields: { 'Лимит длины': String(v) } }]).then(function () { a.limit = v; M.checkAll(); W.toast('Лимит сохранён'); }).catch(function (e) { W.toast(e.message, true); }); });
            return W.el('td', { 'class': 'pim-num' }, [el]);
        }
        var tbl = W.el('table', { 'class': 'pim-table' }, [W.el('thead', {}, [W.el('tr', {}, ['Атрибут площадки', 'Обяз.', 'Наш атрибут', 'Лимит', 'Справочник', 'Значения'].map(function (t) { return W.el('th', { text: t }); }))]),
            W.el('tbody', {}, as.map(function (a) {
                var cv = coverage(a), sel = W.select([['', '— нет соответствия —']].concat(ours.map(function (o) { return [o, o]; })), a.ours || ''); sel.disabled = !can.mapping;
                sel.addEventListener('change', function () { W.batch([{ op: 'save', id: a.id, fields: { 'Наш атрибут': sel.value } }]).then(function () { a.ours = sel.value; M.checkAll(); W.toast('Привязка сохранена'); render(host); }).catch(function (e) { W.toast(e.message, true); }); });
                var cell = W.el('td', {}, a.values.length ? [W.btn(cv ? (cv.miss.length ? 'без соответствия: ' + cv.miss.length : 'все сопоставлены') : 'значения', function () { if (cv) valuesModal(a, host); }, cv && cv.miss.length ? 'pim-danger' : '')] : []);
                return W.el('tr', { 'class': !a.ours && a.required ? 'pim-row-bad' : '' }, [W.el('td', { text: a.title }), W.el('td', { text: a.required ? 'да' : '' }), W.el('td', {}, [sel]), limitCell(a, host, can), W.el('td', { 'class': 'pim-sub', text: a.values.length ? a.values.length + ' знач.' : 'свободный ввод' }), cell]);
            }))]);
        host.appendChild(W.el('div', { 'class': 'pim-tablewrap' }, [tbl]));
        if (!can.mapping) host.appendChild(W.el('p', { 'class': 'pim-sub', text: 'Только просмотр: править соответствия может контент-менеджер.' }));
    }
    W.mount(function (host) { return W.loadModel().then(function (m) { M = m; S.chan = M.channels[0].name; S.cat = Object.keys(M.categories)[0]; render(host); }); });
})();
