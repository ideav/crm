/* PIM: импорт файла поставщика. Вставка из Excel или CSV, подбор колонок, проверка до записи (штрихкоды, пустые страны, значения вне справочника), создание и обновление карточек по артикулу. */
(function () {
    'use strict';
    var W = window.Pim, C = W.core, S = { cat: '', supplier: '', text: '', parsed: null, map: {}, update: true }, M = null;

    function targets(cat) {
        var opts = [['', '— не загружать —'], ['f:sku', 'Артикул'], ['f:name', 'Название'], ['f:brand', 'Бренд'], ['f:country', 'Страна производства'], ['f:barcode', 'Штрихкод'], ['f:desc', 'Описание'], ['f:weight', 'Вес, г'], ['f:weightKg', 'Вес, кг (пересчёт в граммы)'], ['f:price', 'Цена']];
        ((M.categories[cat] || { attrs: [] }).attrs).forEach(function (a) { opts.push(['a:' + a.name, 'Атрибут: ' + a.name]); });
        return opts;
    }
    function recs() {
        var attrs = {}; Object.keys(M.attrs).forEach(function (k) { attrs[k] = M.attrs[k]; });
        return S.parsed.rows.slice(1).map(function (r) { return C.importRow(r, S.map, { attrs: attrs }); });
    }
    function parse() {
        S.parsed = C.parseDelimited(S.text);
        if (S.parsed.rows.length < 2) { S.parsed = null; return; }
        S.map = C.mapColumns(S.parsed.rows[0], ((M.categories[S.cat] || { attrs: [] }).attrs).map(function (a) { return a.name; }));
    }

    function render(host) {
        host.innerHTML = '';
        host.appendChild(W.el('h1', { text: 'Импорт файла поставщика' }));
        host.appendChild(W.el('p', { 'class': 'pim-sub', text: 'Вставьте таблицу из Excel или загрузите CSV: система подберёт колонки, покажет проблемы до записи и создаст карточки в статусе «Черновик». Карточки с известным артикулом обновляются. Файлы XLSX загружает универсальная форма импорта платформы; здесь вставка из Excel и CSV.' }));
        var cat = W.select([['', '— выберите категорию —']].concat(Object.keys(M.categories).map(function (c) { return [c, c]; })), S.cat);
        cat.addEventListener('change', function () { S.cat = cat.value; if (S.text) parse(); render(host); });
        var sup = W.select([['', '— не указывать —']].concat(S.sups.map(function (s) { return [s, s]; })), S.supplier); sup.addEventListener('change', function () { S.supplier = sup.value; });
        var ta = W.el('textarea', { 'class': 'pim-ta', placeholder: 'Вставьте сюда таблицу из Excel (с заголовками колонок)...' }); ta.value = S.text;
        ta.addEventListener('change', function () { S.text = ta.value; parse(); render(host); });
        var file = W.el('input', { type: 'file', accept: '.csv,.txt,.tsv' });
        var enc = W.select([['utf-8', 'UTF-8'], ['windows-1251', 'Windows-1251 (из 1С)']], 'utf-8');
        file.addEventListener('change', function () {
            var f = file.files[0]; if (!f) return; var rd = new FileReader();
            rd.onload = function () { S.text = rd.result; parse(); render(host); }; rd.readAsText(f, enc.value);
        });
        host.appendChild(W.el('div', { 'class': 'pim-bar' }, [W.field('Категория файла', cat), W.field('Поставщик', sup), W.field('Файл CSV', file), W.field('Кодировка', enc),
            W.btn('Подставить образец поставщика', function () { S.text = window.PimSample || ''; S.cat = S.cat || 'Постельное бельё'; S.supplier = S.supplier || 'ООО «ТекстильТрейд Север»'; parse(); render(host); })]));
        host.appendChild(ta);
        if (!S.parsed) return;
        if (!S.cat) { host.appendChild(W.el('p', { 'class': 'pim-note', text: 'Выберите категорию: от неё зависят атрибуты, в которые лягут колонки.' })); return; }

        var head = S.parsed.rows[0], tg = targets(S.cat);
        host.appendChild(W.el('h2', { text: 'Колонки файла (' + head.length + ') и строки (' + (S.parsed.rows.length - 1) + ')' }));
        var tbl = W.el('table', { 'class': 'pim-table' }, [W.el('thead', {}, [W.el('tr', {}, ['Колонка файла', 'Пример', 'Куда загрузить'].map(function (t) { return W.el('th', { text: t }); }))]),
            W.el('tbody', {}, head.map(function (h, i) {
                var sel = W.select(tg, S.map[i] || ''); sel.addEventListener('change', function () { if (sel.value) S.map[i] = sel.value; else delete S.map[i]; render(host); });
                return W.el('tr', { 'class': S.map[i] ? '' : 'pim-row-warn' }, [W.el('td', { text: h }), W.el('td', { 'class': 'pim-sub', text: (S.parsed.rows[1] || [])[i] || '' }), W.el('td', {}, [sel])]);
            }))]);
        host.appendChild(W.el('div', { 'class': 'pim-tablewrap' }, [tbl]));
        var unmapped = head.filter(function (h, i) { return !S.map[i]; });
        if (unmapped.length) host.appendChild(W.el('p', { 'class': 'pim-note', text: 'Не понял колонки: ' + unmapped.join(', ') + '. Выберите, куда их загрузить, или оставьте как есть.' }));

        var rs = recs(), st = C.columnStats(rs), have = {}; M.products.forEach(function (p) { have[p.sku] = p; });
        var newN = rs.filter(function (r) { return r.sku && !have[r.sku]; }).length, updN = rs.filter(function (r) { return r.sku && have[r.sku]; }).length, noSku = rs.filter(function (r) { return !r.sku; }).length;
        host.appendChild(W.el('h2', { text: 'Проверка до записи' }));
        host.appendChild(W.el('div', { 'class': 'pim-kpis' }, [
            W.el('div', { 'class': 'pim-kpi', html: '<small>Новых карточек</small><b>' + newN + '</b>' }), W.el('div', { 'class': 'pim-kpi', html: '<small>Обновится по артикулу</small><b>' + updN + '</b>' }),
            W.el('div', { 'class': 'pim-kpi', html: '<small>Строк с проблемами</small><b>' + rs.filter(function (r) { return r.issues.length; }).length + '</b><small>без артикула: ' + noSku + '</small>' })]));
        var stRows = Object.keys(st).map(function (k) { return { col: k, bad: st[k].bad, warn: st[k].warn }; });
        if (stRows.length) host.appendChild(W.table([{ k: 'col', t: 'Колонка' }, { k: 'bad', t: 'Ошибок', num: true, cls: function (r) { return r.bad ? 'pim-i-bad' : ''; } }, { k: 'warn', t: 'Замечаний', num: true }], stRows));
        var prev = rs.slice(0, 40).map(function (r, i) { return { n: i + 2, sku: r.sku || '—', name: r.fields.name || '', country: r.fields.country || '', barcode: r.fields.barcode || '', state: have[r.sku] ? 'обновится' : 'новая', issues: r.issues.map(function (x) { return x.msg; }).join('; ') }; });
        host.appendChild(W.table([{ k: 'n', t: 'Строка', num: true }, { k: 'sku', t: 'Артикул' }, { k: 'name', t: 'Название' }, { k: 'country', t: 'Страна' }, { k: 'barcode', t: 'Штрихкод' }, { k: 'state', t: 'Что будет' }, { k: 'issues', t: 'Проблемы' }],
            prev, { rowCls: function (r) { return /не сходится|Excel|нет артикула/.test(r.issues) ? 'pim-row-bad' : r.issues ? 'pim-row-warn' : ''; } }));
        var can = W.caps();
        var up = W.el('input', { type: 'checkbox' }); up.checked = S.update; up.addEventListener('change', function () { S.update = up.checked; });
        host.appendChild(W.el('div', { 'class': 'pim-bar' }, [W.el('label', { 'class': 'pim-field' }, [W.el('span', { text: 'Обновлять существующие' }), up]),
            can.edit ? W.btn('Загрузить в каталог', function () { commit(rs, have, host); }, 'pim-primary') : W.el('span', { 'class': 'pim-sub', text: 'У вашей роли нет права добавлять карточки.' })]));
    }

    function commit(rs, have, host) {
        var good = rs.filter(function (r) { return r.sku; }), fresh = good.filter(function (r) { return !have[r.sku]; }), upd = S.update ? good.filter(function (r) { return have[r.sku]; }) : [], ops = [];
        upd.forEach(function (r) {
            var p = have[r.sku], ch = { fields: {}, values: r.values };
            Object.keys(r.fields).forEach(function (k) { if (k !== 'sku' && W.FIELD[k]) ch.fields[k] = r.fields[k]; });
            r.ch = ch; W.cardOps(p, ch).forEach(function (o) { ops.push(o); });
        });
        W.createCards(fresh, { category: S.cat, supplier: S.supplier, owner: W.ctx.user }).then(function () { return W.batch(ops); }).then(function () {
            W.toast('Создано: ' + fresh.length + ', обновлено: ' + upd.length);
            S.text = ''; S.parsed = null;
            W.loadModel().then(function (m) { M = m; render(host); host.insertBefore(W.el('div', { 'class': 'pim-note', html: 'Готово: создано ' + fresh.length + ', обновлено ' + upd.length + '. <a class="pim-link" href="' + W.url('catalog') + '">Открыть каталог</a>' }), host.firstChild.nextSibling); });
        }).catch(function (e) { W.toast(e.message, true); });
    }

    W.mount(function (host) {
        return W.loadModel().then(function (m) { M = m; return W.rows('Поставщик'); }).then(function (s) { S.sups = s.map(function (x) { return x['Поставщик']; }); render(host); });
    });
})();
