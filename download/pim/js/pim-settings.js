/* PIM: настройки демо. Спорные решения (название на площадку, справочник соответствий, правило «Готово к выгрузке», состав файла, права, пометка про лимиты)
   выбираются здесь, а не зашиты в код: экраны и расчёт читают значение настройки. Запись - только у роли с правом на таблицу «Настройки демо». */
(function () {
    'use strict';
    var W = window.Pim, C = W.core, M = null;

    function rowOf(code) { return M.settingRows.filter(function (r) { return r['Код настройки'] === code; })[0]; }
    function apply() { M.settings = W.S = C.resolveSettings(M.settingRows.map(function (x) { return { code: x['Код настройки'], value: x['Значение настройки'] }; })); M.rebuildMap(); M.checkAll(); }

    /* Что изменится, если выбрать вариант v: считается на живых данных, ничего не пишет. */
    function impact(o, v) {
        var cards, S2 = Object.assign({}, M.settings);
        if (o.code === 'ready_rule') {
            S2.ready_rule = v; cards = M.cards();
            return 'Прошли бы в «Готово к выгрузке»: ' + C.readyCount(cards, S2) + ' из ' + cards.length + ' карточек';
        }
        if (o.code === 'value_map_scope') {
            S2.value_map_scope = v; var M2 = { attrs: M.attrs, settings: S2, valueMap: C.buildValueMap(M.rawMap, M.chanAttrs, v) }, n = 0;
            M.products.forEach(function (p) { M.channels.forEach(function (ch) { C.checkChannel(p, ch, M.chanAttrs, M2).items.forEach(function (it) { if (it.state === 'invalid' && /нужно соответствие/.test(it.msg)) n++; }); }); });
            return 'Значений без соответствия сейчас: ' + n + ' (карточка × площадка)';
        }
        if (o.code === 'approve_by') return v === 'editors' ? 'Утверждать смогут все, кто правит карточки, включая ассистента' : 'Ассистент только отправляет на проверку';
        return '';
    }

    function save(o, value, host) {
        var r = rowOf(o.code), op = r ? { op: 'save', id: r._id, fields: { 'Значение настройки': value } }
            : { op: 'new', id: 'Настройки демо', up: 1, fields: { 'Настройки демо': o.title, 'Код настройки': o.code, 'Группа настроек': o.group, 'Значение настройки': value, 'Тип настройки': o.type, 'Варианты значений': C.variantsText(o), 'Пояснение': o.hint } };
        return W.batch([op]).then(function (res) {
            if (r) r['Значение настройки'] = value; else M.settingRows.push({ _id: res[0].id, 'Код настройки': o.code, 'Значение настройки': value });
            apply(); W.toast('Сохранено: «' + o.title + '». Каталог, карточки и выгрузка уже работают по-новому'); render(host);
        }).catch(function (e) { W.toast(e.message, true); });
    }

    function optionBlock(o, host, can) {
        var cur = C.opt(M.settings, o.code), box = W.el('div', { 'class': 'pim-card' });
        box.appendChild(W.el('h3', { text: o.title }));
        box.appendChild(W.el('p', { 'class': 'pim-sub', text: o.hint }));
        if (o.type === 'channels') {
            var names = M.channels.map(function (c) { return c.name; }), act = C.activeChannels(M.settings, names);
            names.forEach(function (n) {
                var cb = W.el('input', { type: 'checkbox' }); cb.checked = act.indexOf(n) >= 0; cb.disabled = !can;
                cb.addEventListener('change', function () {
                    var next = names.filter(function (x) { return x === n ? cb.checked : act.indexOf(x) >= 0; });
                    if (!next.length) { W.toast('Нужна хотя бы одна площадка', true); cb.checked = true; return; }
                    save(o, next.length === names.length ? '' : next.join('|'), host);
                });
                box.appendChild(W.el('label', { 'class': 'pim-opt' }, [cb, ' ' + n]));
            });
            return box;
        }
        o.variants.forEach(function (v) {
            var rb = W.el('input', { type: 'radio', name: 'opt-' + o.code, value: v[0] }); rb.checked = cur === v[0]; rb.disabled = !can;
            rb.addEventListener('change', function () { if (rb.checked) save(o, v[0], host); });
            var im = impact(o, v[0]);
            box.appendChild(W.el('label', { 'class': 'pim-opt' + (cur === v[0] ? ' pim-opt-on' : '') }, [rb, W.el('span', {}, [W.el('b', { text: ' ' + v[1] }), W.el('br'), W.el('span', { 'class': 'pim-sub', text: v[2] + (im ? '. ' + im : '') })])]));
        });
        return box;
    }

    function render(host) {
        var can = W.caps().settings, groups = [];
        host.innerHTML = '';
        host.appendChild(W.el('h1', { text: 'Настройки' }));
        host.appendChild(W.el('p', { 'class': 'pim-sub', text: 'У каждой компании своё «нормально»: мы не навязываем правило, а даём выбрать. Переключите вариант - каталог, карточка и выгрузка сразу работают по-новому. У каждого варианта указано, кому он подходит.' }));
        if (!can) host.appendChild(W.el('p', { 'class': 'pim-note', text: 'Только просмотр: менять настройки может руководитель e-commerce (администратор демо).' }));
        C.OPTIONS.forEach(function (o) { if (groups.indexOf(o.group) < 0) groups.push(o.group); });
        groups.forEach(function (g) {
            host.appendChild(W.el('h2', { text: g }));
            C.OPTIONS.filter(function (o) { return o.group === g; }).forEach(function (o) { host.appendChild(optionBlock(o, host, can)); });
        });
        if (can) host.appendChild(W.el('div', { 'class': 'pim-bar' }, [W.btn('Вернуть значения по умолчанию', function () {
            var ops = [];
            C.OPTIONS.forEach(function (o) { var r = rowOf(o.code); if (r && r['Значение настройки'] !== o.def) ops.push({ op: 'save', id: r._id, fields: { 'Значение настройки': o.def } }); });
            if (!ops.length) { W.toast('Уже значения по умолчанию'); return; }
            W.batch(ops).then(function () { M.settingRows.forEach(function (r) { var o = C.optionByCode(r['Код настройки']); if (o) r['Значение настройки'] = o.def; }); apply(); W.toast('Значения по умолчанию возвращены'); render(host); }).catch(function (e) { W.toast(e.message, true); });
        })]));
    }
    W.mount(function (host) { return W.loadModel().then(function (m) { M = m; render(host); }); });
})();
