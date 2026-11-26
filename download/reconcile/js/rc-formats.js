/* Сверка: форматы загрузки (маппинг колонок файла на поля сверки) и правила сопоставления (порядок, допуски). Проверка файла по формату. */
(function () {
    'use strict';
    var P = window.Rc, C = P.core;
    var st = { fmt: '' };
    var host, M;
    function cur() { return M.fmtBy[st.fmt] || M.formats[0]; }
    function preview(box, text) {
        var f = cur(), r = C.applyFormat(text, f); box.innerHTML = '';
        if (r.missing.length) box.appendChild(P.el('div', { 'class': 'rc-warnbox rc-e', text: 'Не найдены колонки: ' + r.missing.map(function (m) { return '«' + m.header + '»'; }).join(', ') + '. В файле: ' + r.headers.join(', ') }));
        else box.appendChild(P.el('div', { 'class': 'rc-warnbox rc-g', text: 'Разобрано строк: ' + r.rows.length + ' из ' + r.total + (r.errors.length ? '; пропущено: ' + r.errors.map(function (e) { return 'строка ' + e.line + ' (' + e.msg + ')'; }).slice(0, 3).join(', ') : '') }));
        if (r.rows.length) box.appendChild(P.table([{ t: 'Строка', k: 'line', num: 1 }, { t: 'Дата', html: function (x) { return C.toDmy(x.date); } }, { t: 'Сумма', num: 1, html: function (x) { return P.money(x.amount); } }, { t: 'Контрагент', k: 'cp' }, { t: 'Ключ контрагента', html: function (x) { return '<span class="rc-mono">' + P.esc(x.k) + '</span>'; } }, { t: 'П/п', k: 'n' }], r.rows.slice(0, 8)));
    }
    function saveCol(col, inp) {
        var v = inp.value.trim(); if (!v || v === col.header) return;
        P.batch([{ op: 'set', id: col.id, fields: { 'Заголовок в файле': v } }, P.logOp('Изменение формата', cur().name, col.label + ': «' + col.header + '» → «' + v + '»')])
            .then(function () { P.toast('Маппинг сохранён'); return P.model(); }).then(function (m2) { M = m2; render(); }).catch(function (e) { P.toast(e.message, true); });
    }
    function saveRule(r, f, v) {
        var fields = {}; fields[f] = v;
        P.batch([{ op: 'set', id: r.id, fields: fields }, P.logOp('Изменение правила', r.name, f + ': ' + v)]).then(function () { P.toast('Правило сохранено'); return P.model(); }).then(function (m2) { M = m2; render(); }).catch(function (e) { P.toast(e.message, true); });
    }
    function render() {
        host.innerHTML = '';
        var wc = P.canWrite('Колонка формата'), wr = P.canWrite('Правило сопоставления');
        P.head('Форматы и правила', 'Формат источника - какие колонки файла чем считать и как читать даты и суммы. Банк поменял выписку - правится заголовок колонки, без программиста. Правила сопоставления применяются по порядку: точное, с допуском, N:1.' + (wc ? '' : ' Править форматы и правила может методолог.')).forEach(function (n) { host.appendChild(n); });
        host.appendChild(P.tabs(M.formats.map(function (f) { return [f.name, f.name]; }), cur().name, function (t) { st.fmt = t; render(); }));
        var f = cur();
        host.appendChild(P.el('div', { 'class': 'rc-cards' }, [P.el('div', { 'class': 'rc-card' }, [
            P.el('div', { 'class': 'rc-kv', html: '<span>Сторона</span><span>' + P.esc(f.side) + '</span>' }), P.el('div', { 'class': 'rc-kv', html: '<span>Источник</span><span>' + P.esc(f.sys) + '</span>' }),
            P.el('div', { 'class': 'rc-kv', html: '<span>Разделитель</span><span class="rc-mono">' + P.esc(f.delim) + '</span>' }), P.el('div', { 'class': 'rc-kv', html: '<span>Даты</span><span>' + P.esc(f.dateFmt) + '</span>' }),
            P.el('div', { 'class': 'rc-kv', html: '<span>Десятичный знак</span><span class="rc-mono">' + P.esc(f.dec) + '</span>' }), P.el('div', { 'class': 'rc-kv', html: '<span>Кодировка</span><span>' + P.esc(f.enc) + '</span>' })])]));
        host.appendChild(P.el('h2', { text: 'Колонки файла' }));
        host.appendChild(P.table([{ t: 'Поле сверки', k: 'label' }, { t: 'Заголовок в файле', html: function () { return ''; } }, { t: 'Обязательная', html: function (c) { return c.required ? 'да' : '<span class="rc-muted">нет</span>'; } }], f.cols));
        var tb = host.querySelectorAll('.rc-table tbody tr');
        f.cols.forEach(function (c, i) {
            var td = tb[i] && tb[i].children[1]; if (!td) return;
            if (!wc) { td.textContent = c.header; return; }
            var inp = P.input('text', c.header); inp.onchange = function () { saveCol(c, inp); }; td.appendChild(inp);
        });
        var pv = P.el('div', {}), fi = P.el('input', { type: 'file', accept: '.csv,.txt', onchange: function () { var r = new FileReader(); r.onload = function () { preview(pv, String(r.result)); }; if (fi.files[0]) r.readAsText(fi.files[0], 'utf-8'); } });
        host.appendChild(P.el('h2', { text: 'Проверить файл по формату' }));
        host.appendChild(P.el('div', { 'class': 'rc-bar' }, [fi, P.btn('Демо: выписка в новом формате', function () { fetch('/download/' + P.ctx.db + '/demo/volga_4417_2026-11-26_new.csv', { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (t) { preview(pv, t); }); })]));
        host.appendChild(pv);
        host.appendChild(P.el('h2', { text: 'Правила сопоставления' }));
        host.appendChild(P.table([{ t: '№', k: 'order', num: 1 }, { t: 'Правило', k: 'name' }, { t: 'Вид', k: 'kind' }, { t: 'Ключи', k: 'keys' }, { t: 'Допуск суммы, ₽', num: 1, html: function () { return ''; } }, { t: 'Допуск дней', num: 1, html: function () { return ''; } }, { t: 'Включено', html: function () { return ''; } }],
            M.ruleRows.slice().sort(function (a, b) { return C.num(a.order) - C.num(b.order); })));
        var rt = host.querySelectorAll('.rc-table')[host.querySelectorAll('.rc-table').length - 1].querySelectorAll('tbody tr');
        M.ruleRows.slice().sort(function (a, b) { return C.num(a.order) - C.num(b.order); }).forEach(function (r, i) {
            var tr = rt[i]; if (!tr) return;
            [['Допуск суммы, ₽', r.amtTol, 4], ['Допуск дней', r.dayTol, 5]].forEach(function (x) {
                var td = tr.children[x[2]];
                if (!wr) { td.textContent = C.num(x[1]); return; }
                var inp = P.input('number', C.num(x[1]), { min: 0, step: x[2] === 4 ? 0.01 : 1, style: 'width:90px' }); inp.onchange = function () { saveRule(r, x[0], inp.value); }; td.appendChild(inp);
            });
            var cb = P.el('input', { type: 'checkbox' }); cb.checked = r.on; cb.disabled = !wr; cb.onchange = function () { saveRule(r, 'Правило включено', cb.checked ? 1 : -1); }; tr.children[6].appendChild(cb);
        });
    }
    P.mount(function (h, m) { host = h; M = m; render(); });
})();
