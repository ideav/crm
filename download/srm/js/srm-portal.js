/* SRM: Кабинет поставщика (тонкий вход). Свои приглашения, ответ формой или загрузкой Excel, подтверждение приёма.
   Поставщик видит только свои приглашения и свои КП: бюджеты, чужие цены и оценки ему закрыты правами роли. */
(function () {
    'use strict';
    var P = window.Srm, C = P.core;
    var st = { inv: P.hash().inv || '', done: null };

    function template() {
        var rows = [['Поле', 'Значение'], ['Цена за ед., руб.', ''], ['НДС', 'с НДС'], ['Доставка до завода, руб.', '0'], ['Отсрочка платежа, дней', ''], ['Предоплата, %', '0'], ['Срок поставки, дней', ''], ['КП действует до', ''], ['Комментарий', '']];
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + C.toCsv(rows)], { type: 'text/csv;charset=utf-8' })); a.download = 'kp-template.csv';
        document.body.appendChild(a); a.click(); a.remove();
    }
    function readFile(file) {
        return new Promise(function (res, rej) {
            var fr = new FileReader();
            if (/\.xlsx?$/i.test(file.name) && window.XLSX) {
                fr.onload = function () { try { var wb = window.XLSX.read(new Uint8Array(fr.result), { type: 'array' }); res(window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false })); } catch (e) { rej(e); } };
                fr.readAsArrayBuffer(file);
            } else { fr.onload = function () { res(String(fr.result).split(/\r?\n/).map(function (l) { return l.split(/[;\t]/).map(function (c) { return c.replace(/^"|"$/g, ''); }); })); }; fr.readAsText(file, 'utf-8'); }
        });
    }
    function form(host, M, inv) {
        var f = { price: P.input('number', '', { min: 0, step: 'any' }), vat: P.select([['1', 'с НДС'], ['0', 'без НДС']], '1'), delivery: P.input('number', '0'), deferral: P.input('number', '30'), prepay: P.input('number', '0'), lead: P.input('number', ''), valid: P.input('date', C.addDays(P.TODAY, 30)), comment: P.input('textarea', '') };
        var note = P.el('div', {}), file = P.el('input', { type: 'file', accept: '.xlsx,.xls,.csv,.txt' }), paste = P.input('textarea', '', { placeholder: 'Подпись и значение в строке: «Цена за т, руб. с НДС  78900»' });
        function apply(r) {
            var o = r.fields; note.innerHTML = '';
            if (o.price !== undefined) f.price.value = o.price; if (o.vatIncluded !== undefined) f.vat.value = o.vatIncluded ? '1' : '0';
            ['delivery', 'deferral', 'prepay', 'lead'].forEach(function (k) { if (o[k] !== undefined) f[k].value = o[k]; });
            if (o.validTo) f.valid.value = o.validTo; if (o.comment) f.comment.value = o.comment;
            note.appendChild(P.box(r.missing.length ? 'w' : 'g', r.missing.length ? 'Из файла не прочитано: ' + r.missing.join(', ') + '. Проверьте поля ниже.' : 'Условия из файла перенесены в форму. Проверьте и отправьте.'));
        }
        file.addEventListener('change', function () { if (file.files[0]) readFile(file.files[0]).then(function (rows) { apply(C.parseOfferRows(rows)); }).catch(function (e) { P.toast('Не удалось прочитать файл: ' + e.message, true); }); });
        paste.addEventListener('input', function () { if (paste.value.trim()) apply(C.parseOfferText(paste.value)); });
        var send = P.btn('Отправить предложение', function () {
            if (!C.num(f.price.value) || !f.lead.value) { P.toast('Укажите цену и срок поставки', true); return; }
            send.disabled = true;
            var num = 'КП-' + inv.code.replace(/^INV-/, '');
            P.create('Предложение', { 'Предложение': num, 'Приглашение': inv.id, 'Цена за ед.': C.num(f.price.value), 'Цена включает НДС': f.vat.value, 'Ставка НДС': 20, 'Доставка': C.num(f.delivery.value), 'Отсрочка, дней': C.num(f.deferral.value), 'Предоплата, %': C.num(f.prepay.value), 'Срок поставки, дней': C.num(f.lead.value), 'КП действует до': f.valid.value, 'Дата КП': P.TODAY, 'Канал КП': 'Форма по ссылке', 'Комментарий поставщика': f.comment.value })
                .then(function () { st.done = { num: num, inv: inv }; P.reload(); }).catch(function (e) { P.toast(e.message, true); send.disabled = false; });
        }, 'srm-primary');
        host.appendChild(P.el('div', { 'class': 'srm-card' }, [
            P.el('h2', { text: 'Ответ на запрос ' + inv.req, style: 'margin-top:0' }), P.el('p', { html: '<b>' + P.esc(inv.lot) + '</b>' }), P.el('p', { 'class': 'srm-muted', text: 'Ответить до ' + P.d(inv.due) + '. Приглашение ' + inv.code + '.' }),
            P.el('div', { 'class': 'srm-bar' }, [P.field('Загрузить КП из Excel', file), P.btn('Скачать шаблон', template, 'srm-small')]), P.field('Или вставьте ячейки из Excel', paste), note,
            P.el('div', { 'class': 'srm-grid2' }, [P.field('Цена за единицу, ₽', f.price), P.field('НДС', f.vat), P.field('Доставка до завода, ₽', f.delivery, '0 - доставка включена в цену'), P.field('Отсрочка платежа, дней', f.deferral), P.field('Предоплата, %', f.prepay), P.field('Срок поставки, дней', f.lead), P.field('КП действует до', f.valid)]),
            P.field('Комментарий', f.comment), send]));
    }
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('h1', { text: 'Кабинет поставщика' }));
        host.appendChild(P.el('p', { 'class': 'srm-sub', text: 'Ответ на запрос КП по ссылке из письма: форма или загрузка Excel, без пересылки файлов почтой. Предложение сразу попадает в сравнение у закупщика.' }));
        if (st.done) {
            host.appendChild(P.el('div', { 'class': 'srm-card srm-ok-big' }, [P.el('div', { 'class': 'srm-kpi-v', text: 'Предложение принято' }), P.el('p', { text: st.done.num + ' от ' + P.d(P.TODAY) + ' по запросу ' + st.done.inv.req + ': ' + st.done.inv.lot }), P.el('p', { 'class': 'srm-muted', text: 'Закупщик видит его в сравнении. Итоги выбора придут письмом; цены других участников не раскрываются.' })]));
            st.done = null; st.inv = '';
        }
        var answered = {}; M.offers.forEach(function (o) { answered[o.invId] = o; });
        var open = M.invs.filter(function (i) { return !answered[i.id] && i.due >= P.TODAY; });
        var inv = M.invs.filter(function (i) { return i.code === st.inv && !answered[i.id]; })[0] || (st.inv === '' && open.length === 1 ? open[0] : null);
        if (inv) form(host, M, inv);
        host.appendChild(P.el('h2', { text: 'Мои приглашения' }));
        host.appendChild(P.table([
            { t: 'Запрос', html: function (i) { return '<b>' + P.esc(i.req) + '</b><div class="srm-muted">' + P.esc(i.code) + '</div>'; } },
            { t: 'Лот', k: 'lot' },
            { t: 'Ответить до', html: function (i) { return P.d(i.due); } },
            { t: 'Статус', html: function (i) { var o = answered[i.id]; return o ? P.badge('отправлено ' + P.d(o.date), 'ok') + (o.chosen ? ' ' + P.badge('выбрано', 'violet') : '') : i.due < P.TODAY ? P.badge('срок истёк', 'mute') : P.badge('ждёт ответа', 'warn'); } },
            { t: '', node: function (i) { return !answered[i.id] && i.due >= P.TODAY ? P.btn('Ответить', function () { st.inv = i.code; location.hash = 'inv=' + i.code; render(host, M); }, 'srm-small srm-primary') : null; } }
        ], M.invs.slice().sort(function (a, b) { return a.sent < b.sent ? 1 : -1; }), { empty: 'Приглашений нет' }));
    }
    P.mount(render);
})();
