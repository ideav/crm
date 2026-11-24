/* PIM: карточка товара. Слева поля и атрибуты категории, справа вкладки площадок с готовностью и списком недостающего.
   Индикаторы пересчитываются на лету, до сохранения. Нужны pim-core.js и pim-app.js. */
(function () {
    'use strict';
    var W = window.Pim, C = W.core;

    W.openCard = function (host, M, p, back) {
        var cat = M.categories[p.category] || { attrs: [], type: '' };
        var tmp = JSON.parse(JSON.stringify({ sku: p.sku, name: p.name, category: p.category, brand: p.brand, country: p.country, barcode: p.barcode, desc: p.desc, weight: p.weight, photos: p.photos, status: p.status, values: p.values }));
        var dirty = {}, dirtyVals = {}, tab = M.channels[0] ? M.channels[0].name : '', inputs = {}, right = W.el('div', { 'class': 'pim-card' }), head = W.el('div', {}), brands = [], countries = [];
        var can = W.caps();

        function recompute() { return C.checkAll(tmp, M.channels, M.chanAttrs, M); }
        function setField(key, v) { tmp[key] = v; dirty[key] = v; refresh(); }
        function setValue(a, v) { tmp.values[a] = v; dirtyVals[a] = v; refresh(); }
        function refresh() { renderRight(); renderHead(); }

        function renderHead() {
            var res = recompute();
            head.innerHTML = '';
            head.appendChild(W.el('div', { 'class': 'pim-head' }, [
                W.btn('← К списку', function () { back(); }),
                W.el('div', {}, [W.el('h1', { text: p.sku + ' · ' + (tmp.name || 'без названия') }),
                    W.el('p', { 'class': 'pim-sub', html: W.statusBadge(p.status) + ' &nbsp; ' + W.esc(p.category) + ' · версия ' + p.version + ' · обновлено ' + W.dmy(p.updated) + ' · ответственный: ' + W.esc(p.owner || '—') })])]));
            head.appendChild(W.el('div', { 'class': 'pim-stages' }, C.STATUSES.map(function (s) { return W.el('span', { 'class': 'pim-stage' + (s === p.status ? ' pim-stage-on' : ''), text: s }); })));
            head.appendChild(W.el('div', { 'class': 'pim-barrow', html: '<div class="pim-pills">' + M.channels.map(function (c) { return '<span><span class="pim-pillhead">' + W.esc(W.short(c.name)) + '</span><br>' + W.pill(res[c.name]) + '</span>'; }).join('') + '</div>' }));
        }

        function fld(label, el, cls, bad) { var f = W.field(label, el); if (cls) f.className += ' ' + cls; if (bad) f.className += ' pim-field-bad'; f.dataset.fieldKey = ''; return f; }
        function badFor(res, ours) { return M.channels.some(function (c) { return res[c.name].blockers.some(function (b) { return b.ours === ours; }); }); }

        var leftBox = W.el('div', { 'class': 'pim-card' });
        function buildLeft() {
            var res = recompute(), form = W.el('div', { 'class': 'pim-form' }), ro = !can.card;
            inputs = {};
            function sys(key, label, el, cls, ours) {
                inputs[ours] = el; el.disabled = ro || !can.edit && key !== 'status' ? true : el.disabled;
                form.appendChild(fld(label, el, cls, badFor(res, ours)));
            }
            var name = W.el('input', { type: 'text', value: tmp.name || '' }); name.addEventListener('input', function () { tmp.name = name.value; dirty.name = name.value; renderRight(); renderHead(); markBad(); });
            sys('name', 'Название', name, 'pim-wide', 'Название');
            var desc = W.el('textarea', {}); desc.value = tmp.desc || ''; desc.addEventListener('input', function () { setField('desc', desc.value); markBad(); });
            sys('desc', 'Описание', desc, 'pim-wide', 'Описание');
            var brand = W.select([['', '— не задано —']].concat(brands.map(function (b) { return [b, b]; })), tmp.brand || ''); brand.addEventListener('change', function () { setField('brand', brand.value); markBad(); });
            sys('brand', 'Бренд', brand, '', 'Бренд');
            var country = W.select([['', '— не задано —']].concat(countries.map(function (b) { return [b, b]; })), tmp.country || ''); country.addEventListener('change', function () { setField('country', country.value); markBad(); });
            sys('country', 'Страна производства', country, '', 'Страна производства');
            var bc = W.el('input', { type: 'text', value: tmp.barcode || '', inputmode: 'numeric' }); bc.addEventListener('input', function () { setField('barcode', bc.value); markBad(); });
            sys('barcode', 'Штрихкод (EAN-13)', bc, '', 'Штрихкод');
            var wt = W.el('input', { type: 'text', value: tmp.weight || '', inputmode: 'decimal' }); wt.addEventListener('input', function () { setField('weight', wt.value); markBad(); });
            sys('weight', 'Вес, г', wt, '', 'Вес, г');
            var ph = W.el('input', { type: 'number', min: 0, value: tmp.photos || 0 }); ph.addEventListener('input', function () { setField('photos', ph.value); });
            var phWrap = W.el('div', { 'class': 'pim-field' }, []);
            form.appendChild(fld('Фото, шт (загрузка файлов - в проекте)', ph, '', false));
            var need = Math.max.apply(null, M.channels.map(function (c) { return c.minPhotos; }).concat([0]));
            var tiles = W.el('div', { 'class': 'pim-photos pim-wide' }); for (var i = 0; i < Math.max(need, C.num(tmp.photos)); i++) tiles.appendChild(W.el('div', { 'class': 'pim-photo' + (i >= C.num(tmp.photos) ? ' pim-photo-need' : ''), text: i >= C.num(tmp.photos) ? 'нужно' : 'фото ' + (i + 1) }));
            form.appendChild(tiles);
            if (cat.attrs.length) form.appendChild(W.el('h2', { 'class': 'pim-wide', text: 'Характеристики категории «' + p.category + '»' }));
            cat.attrs.forEach(function (ca) {
                var a = M.attrs[ca.name]; if (!a) return;
                var el = W.valueInput(a, tmp.values[ca.name] || '', function (v) { setValue(ca.name, v); markBad(); });
                el.disabled = !can.edit; inputs[ca.name] = el;
                form.appendChild(fld(ca.name + (ca.required ? ' *' : '') + (a.unit && a.type === 'number' ? ' (' + a.unit + ')' : ''), el, '', badFor(res, ca.name)));
            });
            leftBox.innerHTML = ''; leftBox.appendChild(form);
            if (!can.edit) leftBox.insertBefore(W.el('p', { 'class': 'pim-note', text: 'Ваша роль не правит характеристики: поля доступны для чтения.' }), form);
        }
        function markBad() {
            var res = recompute();
            Object.keys(inputs).forEach(function (k) { var f = inputs[k].closest('label'); if (f) f.classList.toggle('pim-field-bad', badFor(res, k)); });
        }

        function renderRight() {
            var res = recompute(), ch = M.chan(tab), r = res[tab];
            right.innerHTML = '';
            right.appendChild(W.tabs(M.channels.map(function (c) { return [c.name, W.short(c.name) + ' ' + res[c.name].pct + '%']; }), tab, function (t) { tab = t; renderRight(); }));
            right.appendChild(W.el('div', { 'class': 'pim-head', html: W.ring(r.pct) + '<div><b>' + W.esc(tab) + '</b><br><span class="pim-sub">' + (r.blockers.length ? 'Не хватает: ' + r.blockers.length + ' из ' + r.required + ' обязательных' : 'Все обязательные атрибуты заполнены') + '</span></div>' }));
            var ul = W.el('ul', { 'class': 'pim-check' });
            r.items.slice().sort(function (a, b) { return (a.state === 'ok') - (b.state === 'ok') || (b.required - a.required); }).forEach(function (it) {
                var bad = it.state !== 'ok', li = W.el('li', { 'class': bad && it.required ? 'pim-bad' : bad ? 'pim-opt' : '' });
                li.appendChild(W.el('span', { 'class': bad && it.required ? 'pim-i-bad' : 'pim-i-ok', text: bad ? (it.required ? '✕' : '○') : '✓' }));
                var txt = W.el('span', { text: bad ? (it.msg || it.label) + (it.required ? '' : ' (необязательно)') : it.label + (it.value !== undefined && it.value !== it.raw ? ': «' + it.raw + '» → «' + it.value + '»' : '') });
                li.appendChild(txt);
                if (bad && it.ours && inputs[it.ours]) li.appendChild(W.el('a', { 'class': 'pim-link', text: 'исправить', href: '#', onclick: function (e) { e.preventDefault(); inputs[it.ours].focus(); inputs[it.ours].scrollIntoView({ block: 'center' }); } }));
                if (it.state === 'long' && M.attrs[it.ours] && M.attrs[it.ours].field === 'name') li.appendChild(W.el('a', { 'class': 'pim-link', text: 'собрать по шаблону', href: '#', onclick: function (e) { e.preventDefault(); titleModal(ch); } }));
                if (it.state === 'invalid' && it.msg.indexOf('нужно соответствие') >= 0 && can.mapping) li.appendChild(W.el('a', { 'class': 'pim-link', text: 'добавить соответствие', href: '#', onclick: function (e) {
                    e.preventDefault(); var ca = M.chanAttrs.filter(function (a) { return a.key === it.key; })[0]; W.mapValueModal(M, ca, it.raw || C.getValue(tmp, M.attrs[it.ours]), function () { refresh(); buildLeft(); }); } }));
                ul.appendChild(li);
            });
            right.appendChild(ul);
            if (ch && ch.titleLimit) {
                var n = (tmp.name || '').length;
                right.appendChild(W.el('p', { 'class': 'pim-counter' + (n > ch.titleLimit ? ' pim-counter-bad' : ''), text: 'Название: ' + n + ' симв. при лимите ' + ch.titleLimit + '. Шаблон площадки: ' + ch.template }));
            }
            if (!M.chanAttrs.some(function (a) { return a.channel === tab && a.category === p.category; })) right.appendChild(W.el('p', { 'class': 'pim-note', text: 'Для категории нет набора атрибутов этой площадки: добавьте его на экране «Площадки и соответствия».' }));
        }
        function titleModal(ch) {
            var s = C.buildTitle(ch.template, tmp, cat.type), tooLong = ch.titleLimit && s.length > ch.titleLimit;
            W.modal('Название по шаблону ' + ch.name, W.el('div', {}, [W.el('p', { 'class': 'pim-sub', text: 'Шаблон: ' + ch.template }), W.el('p', { html: '<b>' + W.esc(s) + '</b>' }), W.el('p', { 'class': 'pim-counter' + (tooLong ? ' pim-counter-bad' : ''), text: s.length + ' симв. при лимите ' + ch.titleLimit })]),
                [{ text: 'Отмена' }, { text: 'Применить', cls: 'pim-primary', fn: function () { tmp.name = s; dirty.name = s; if (inputs['Название']) inputs['Название'].value = s; refresh(); buildLeft(); } }]);
        }

        function changeStatus(target) {
            var res = recompute(), b = C.statusBlockers(tmp, target, res);
            if (b.length) { W.toast('Нельзя: ' + b.join('; '), true); return; }
            saveAll({ status: target });
        }
        function saveAll(extra) {
            var fields = Object.assign({}, dirty, extra || {});
            if (fields.status && fields.status === p.status) delete fields.status;
            var vals = {}; Object.keys(dirtyVals).forEach(function (a) { if ((p.values[a] || '') !== dirtyVals[a]) vals[a] = dirtyVals[a]; });
            if (!Object.keys(fields).length && !Object.keys(vals).length) { W.toast('Изменений нет'); return; }
            W.saveCard(p, { fields: fields, values: vals }).then(function () { dirty = {}; dirtyVals = {}; tmp.status = p.status; W.toast('Сохранено, версия ' + p.version); M.check(p); renderHead(); renderRight(); buildActions(); }).catch(function (e) { W.toast(e.message, true); });
        }
        var actions = W.el('div', { 'class': 'pim-bar' });
        function buildActions() {
            actions.innerHTML = '';
            if (can.card) actions.appendChild(W.btn('Сохранить', function () { saveAll(); }, 'pim-primary'));
            if (can.card && p.status === 'Черновик') actions.appendChild(W.btn('Отправить на проверку', function () { changeStatus('На проверке'); }));
            if (can.approve && p.status === 'На проверке') actions.appendChild(W.btn('Готово к выгрузке', function () { changeStatus('Готово к выгрузке'); }, 'pim-primary'));
            if (can.card && p.status !== 'Черновик' && (can.approve || p.status === 'На проверке')) actions.appendChild(W.btn(p.status === 'Готово к выгрузке' ? 'Вернуть на проверку' : 'Вернуть в черновик', function () { changeStatus(p.status === 'Готово к выгрузке' ? 'На проверке' : 'Черновик'); }));
            if (!can.card) actions.appendChild(W.el('span', { 'class': 'pim-sub', text: 'Просмотр: права на правку карточек у вашей роли нет.' }));
        }

        Promise.all([W.rows('Бренд'), W.rows('Страна')]).then(function (r) {
            brands = r[0].map(function (x) { return x['Бренд']; }); countries = r[1].map(function (x) { return x['Страна']; });
            host.innerHTML = '';
            host.appendChild(head); renderHead();
            buildLeft(); renderRight(); buildActions();
            host.appendChild(W.el('div', { 'class': 'pim-split' }, [leftBox, right]));
            host.appendChild(actions);
        }).catch(W.fail);
    };
})();
