/* MDM: Новая позиция. При вводе сразу ищет похожие записи и предупреждает «похожая запись уже есть»; служба НСИ заводит запись, остальные - отправляют заявку. */
(function () {
    'use strict';
    var P = window.Mdm, C = P.core;
    var kind = P.NOM, timer = null;

    function render(host, M) {
        host.innerHTML = '';
        var direct = P.canWrite(kind);
        P.head('Новая позиция', direct ? 'Вы в службе НСИ: запись заводится сразу в эталон. Пока вы печатаете, система ищет похожие записи по тем же правилам, что и поиск дублей.' : 'Заполните карточку - заявка уйдёт в службу НСИ (срок ' + M.params.slaDays + ' раб. дн.). Пока вы печатаете, система ищет похожие записи: возможно, позиция уже есть.').forEach(function (e) { host.appendChild(e); });
        host.appendChild(P.tabs([[P.NOM, 'Номенклатура'], [P.KON, 'Контрагент']], kind, function (k) { kind = k; render(host, M); }));
        var f = {}, form = P.el('div', { 'class': 'mdm-form' });
        function inp(key, label, hint, attrs) { f[key] = P.input('text', '', Object.assign({ autocomplete: 'off' }, attrs || {})); f[key].addEventListener('input', schedule); form.appendChild(P.field(label, f[key], hint)); }
        var grp = null;
        if (kind === P.NOM) {
            inp('name', 'Наименование', 'например: Подшипник 6205 2RS SKF', { 'class': 'mdm-wide' }); form.lastChild.classList.add('mdm-wide');
            inp('art', 'Артикул производителя'); inp('brand', 'Бренд');
            f.unit = P.select([['', '-']].concat(M.units), 'шт'); f.unit.addEventListener('change', schedule); form.appendChild(P.field('Единица измерения', f.unit));
            grp = P.select([['', '-']].concat(M.groups.map(function (g) { return [g.name, g.name + (g.okpd ? ' (ОКПД2 ' + g.okpd + ')' : '')]; })), '');
            var maskHint = P.el('small', {}); grp.addEventListener('change', function () { var g = M.groups.filter(function (x) { return x.name === grp.value; })[0]; maskHint.textContent = g ? 'Маска: ' + g.mask + ' · обязательно: ' + g.attrs : ''; });
            form.appendChild(P.el('label', { 'class': 'mdm-field' }, [P.el('span', { text: 'Группа номенклатуры' }), grp, maskHint]));
        } else {
            inp('name', 'Наименование', 'например: ТД Металлсервис'); form.lastChild.classList.add('mdm-wide');
            inp('inn', 'ИНН', '10 цифр для организации, 12 для ИП', { inputmode: 'numeric' }); inp('kpp', 'КПП', '', { inputmode: 'numeric' });
        }
        host.appendChild(form);
        var hint = P.el('div', {}); host.appendChild(hint);
        var send = P.btn(direct ? 'Завести в справочник' : 'Отправить заявку в НСИ', function () { submit(host, M, f, grp, last); }, 'mdm-primary');
        host.appendChild(P.el('div', { 'class': 'mdm-bar' }, [send, P.el('span', { 'class': 'mdm-muted', text: direct ? 'Код НСИ присвоится автоматически.' : 'Заявку видите вы и служба НСИ.' })]));
        var last = [];
        function draft() {
            var d = { name: f.name.value.trim() };
            if (kind === P.NOM) { d['Артикул'] = f.art.value.trim(); d['Бренд'] = f.brand.value.trim(); d['Единица измерения'] = f.unit.value; } else { d['ИНН'] = f.inn.value.trim(); d['КПП'] = f.kpp.value.trim(); }
            return d;
        }
        function schedule() { clearTimeout(timer); timer = setTimeout(check, 180); }
        function check() {
            var d = draft(); hint.innerHTML = '';
            if (kind === P.KON && d['ИНН'] && d['ИНН'].replace(/\D/g, '').length >= 10 && !C.validInn(d['ИНН'])) hint.appendChild(P.el('div', { 'class': 'mdm-warnbox mdm-e', text: 'ИНН не прошёл проверку контрольной суммы - вероятна опечатка.' }));
            if (d.name.length < 4 && !d['Артикул'] && !d['ИНН']) { last = []; return; }
            last = C.similarTo(d, P.list(M, kind), M.rules[kind], kind, M.params.hintThreshold, 5);
            if (!last.length) { if (d.name.length >= 4) hint.appendChild(P.el('div', { 'class': 'mdm-warnbox mdm-g', text: 'Похожих записей не найдено (порог подсказки ' + M.params.hintThreshold + '%).' })); return; }
            var hard = last[0].score >= M.params.dupThreshold;
            hint.appendChild(P.el('div', { 'class': 'mdm-hint' + (hard ? ' mdm-hint-hard' : '') }, [P.el('h3', { text: hard ? 'Похожая запись уже есть' : 'Есть похожие записи' })].concat(last.map(function (x) {
                return P.el('div', { 'class': 'mdm-hint-row' }, [P.el('div', { html: P.scoreBadge(x.score, M.params.dupThreshold) }), P.el('div', { html: P.recLine(x.rec) + ' ' + P.statusBadge(x.rec.status) + '<div class="mdm-why">' + P.esc(x.reason) + '</div>' })]);
            }))));
        }
    }
    function submit(host, M, f, grp, similar) {
        var name = f.name.value.trim();
        if (!name) { P.toast('Укажите наименование', true); return; }
        var top = similar[0], direct = P.canWrite(kind);
        var go = function () { (direct ? createRecord : createRequest)(host, M, f, grp, similar).catch(function (e) { P.toast(e.message, true); }); };
        if (top && top.score >= M.params.dupThreshold) {
            P.modal('Похоже на дубль', P.el('p', { html: 'Запись <b>' + P.esc(top.rec.code) + '</b> «' + P.esc(top.rec.name) + '» совпадает на ' + top.score + '%. ' + (direct ? 'Всё равно завести новую?' : 'Отправить заявку с пометкой о похожей записи?') }),
                [{ text: 'Отмена' }, { text: direct ? 'Завести всё равно' : 'Отправить', cls: 'mdm-primary', fn: go }]);
        } else go();
    }
    function createRecord(host, M, f, grp) {
        var list = P.list(M, kind), prefix = kind === P.KON ? 'НСИ-К' : 'НСИ-', code = P.nextNo(list.map(function (r) { return r.code; }), prefix, kind === P.KON ? 5 : 6);
        var fields = { 'Код НСИ': code, 'Источник': M.systems[0] ? M.systems[0].name : '', 'Статус записи': 'Эталон', 'Дата заведения': P.TODAY, 'Кем заведена': P.ctx.user, 'Число документов': 0 };
        fields[kind] = f.name.value.trim();
        if (kind === P.NOM) { fields['Артикул'] = f.art.value.trim(); fields['Бренд'] = f.brand.value.trim(); if (f.unit.value) fields['Единица измерения'] = f.unit.value; if (grp && grp.value) fields['Группа номенклатуры'] = grp.value; }
        else { fields['ИНН'] = f.inn.value.trim(); fields['КПП'] = f.kpp.value.trim(); }
        return P.create(kind, fields).then(function () { P.toast('Заведено: ' + code); P.rerender(render); });
    }
    function createRequest(host, M, f, grp, similar) {
        /* инициатор видит только свои заявки, поэтому номер - от времени, а не «последний + 1» */
        var no = 'ЗН-' + String(Date.now()).slice(-7, -1);
        var fields = { 'Заявка НСИ': no, 'Вид заявки': 'Создать', 'Вид справочника': kind, 'Наименование в заявке': f.name.value.trim(), 'Дата заявки': P.TODAY, 'Срок заявки': C.addWorkDays(P.TODAY, M.params.slaDays), 'Статус заявки': 'Новая',
            'Похожие записи': similar.map(function (x) { return x.rec.code + ' (' + x.score + '%)'; }).join(', ') };
        if (kind === P.NOM) { fields['Артикул'] = f.art.value.trim(); fields['Бренд'] = f.brand.value.trim(); if (grp && grp.value) fields['Группа номенклатуры'] = grp.value; } else fields['ИНН'] = f.inn.value.trim();
        return P.create('Заявка НСИ', fields).then(function () { P.toast('Заявка ' + no + ' отправлена в службу НСИ'); location.href = P.nav('requests'); });
    }
    P.mount(render);
})();
