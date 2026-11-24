/* FSM: экран «Настройки» (settings). Спорные решения демо - переключаемые опции: экраны и расчёты читают значения из таблицы «Настройка демо».
   Редактирует тот, у кого есть право записи в таблицу (руководитель сервиса, администратор); остальные видят значения только для чтения. */
(function () {
    'use strict';
    var W = window.Fsm, C = W.core, el = W.el;
    var rows = {}, cur = {}, write = false, host = null;

    function loadRows() {
        return W.rows('Настройка демо').then(function (r) {
            rows = {}; r.forEach(function (x) { rows[x['Настройка демо']] = x; });
            cur = C.parseOpts(r.map(function (x) { return { code: x['Настройка демо'], value: x['Значение'] }; }));
        });
    }
    function fmtVal(d, v) {
        if (d.type === 'bool') return v ? 'включено' : 'выключено';
        if (d.type === 'enum') return (d.variants.filter(function (x) { return x[0] === v; })[0] || ['', String(v)])[1];
        return String(v).replace('.', ',') + (d.unit ? ' ' + d.unit : '');
    }
    /* Запись значения: есть строка - _m_set, нет - создаём. */
    function save(d, v) {
        var str = C.optToStr(d, v), r = rows[d.code];
        var p = r ? W.post('_m_set/' + r._id + '?JSON', { fields: { 'Значение': str } })
            : W.post('_m_new/' + W.tid('Настройка демо') + '?JSON', { up: 1, fields: { 'Настройка демо': d.code, 'Название': d.title, 'Значение': str, 'Тип': d.type } });
        return p.then(function (j) {
            cur[d.code] = v;
            if (r) r['Значение'] = str;
            else { var id = (Array.isArray(j) ? j[0] : j).id; rows[d.code] = { _id: String(id), 'Значение': str }; }
        });
    }
    function control(d, onchange) {
        var v = cur[d.code], c;
        if (d.type === 'bool') {
            c = el('input', { type: 'checkbox', 'class': 'fsm-set-check', id: 'o-' + d.code, 'aria-label': d.title }); c.checked = !!v;
            c.onchange = function () { onchange(c.checked); };
            return el('label', { 'class': 'fsm-set-switch', 'for': 'o-' + d.code }, [c, el('span', { 'class': 'fsm-set-slider' }), el('span', { 'class': 'fsm-set-state', text: v ? 'Включено' : 'Выключено' })]);
        }
        if (d.type === 'enum') {
            c = W.select(d.variants, v); c.setAttribute('aria-label', d.title); c.className = 'fsm-set-select';
            c.onchange = function () { onchange(c.value); };
            return c;
        }
        c = el('input', { type: 'number', 'class': 'fsm-set-num', step: 'any', min: d.min, max: d.max, value: String(v), 'aria-label': d.title });
        c.onchange = function () {
            var n = parseFloat(String(c.value).replace(',', '.'));
            if (isNaN(n) || n < d.min || n > d.max) { W.toast('Допустимо от ' + d.min + ' до ' + d.max, true); c.value = String(cur[d.code]); return; }
            onchange(n);
        };
        return el('span', { 'class': 'fsm-set-numwrap' }, [c, el('span', { 'class': 'fsm-set-unit', text: d.unit || '' })]);
    }
    function row(d) {
        var box = el('div', { 'class': 'fsm-set-row', 'data-code': d.code }), ctl, meta = el('div', { 'class': 'fsm-set-meta' });
        function apply(v) {
            ctl.querySelectorAll('input,select').forEach(function (x) { x.disabled = true; });
            save(d, v).then(function () { W.toast('Сохранено: ' + d.title); draw(); }, function (e) { W.toast('Не сохранилось: ' + (e && e.message || e), true); draw(); });
        }
        ctl = control(d, apply);
        if (!write) ctl.querySelectorAll('input,select').forEach(function (x) { x.disabled = true; });
        meta.appendChild(el('span', { 'class': 'fsm-set-def', text: 'По умолчанию: ' + fmtVal(d, d.def) }));
        if (cur[d.code] !== d.def) {
            meta.appendChild(el('span', { 'class': 'fsm-badge fsm-warn', text: 'изменено' }));
            if (write) meta.appendChild(el('button', { type: 'button', 'class': 'fsm-set-reset', text: 'Сбросить', onclick: function () { apply(d.def); } }));
        }
        box.appendChild(el('div', { 'class': 'fsm-set-main' }, [el('div', { 'class': 'fsm-set-title', text: d.title }), el('div', { 'class': 'fsm-set-hint', text: d.hint }), meta]));
        box.appendChild(el('div', { 'class': 'fsm-set-ctl' }, [ctl]));
        return box;
    }
    function group(g) {
        var sec = el('section', { 'class': 'fsm-set-card' }, [el('h2', { text: g.title }), el('p', { 'class': 'fsm-set-ghint', text: g.hint })]);
        C.OPT_DEFS.filter(function (d) { return d.group === g.id; }).forEach(function (d) { sec.appendChild(row(d)); });
        sec.appendChild(el('a', { 'class': 'fsm-set-look', href: W.url(g.screen), text: 'Посмотреть: ' + g.link }));
        return sec;
    }
    function resetAll() {
        var list = C.OPT_DEFS.filter(function (d) { return cur[d.code] !== d.def; }), p = Promise.resolve();
        if (!list.length) { W.toast('Все значения уже по умолчанию'); return; }
        list.forEach(function (d) { p = p.then(function () { return save(d, d.def); }); });
        p.then(function () { W.toast('Возвращены значения по умолчанию'); draw(); }, function (e) { W.toast('Ошибка: ' + (e && e.message || e), true); draw(); });
    }
    function draw() {
        host.innerHTML = '';
        var changed = C.OPT_DEFS.filter(function (d) { return cur[d.code] !== d.def; }).length;
        var head = el('div', { 'class': 'fsm-set-head' }, [el('div', {}, [el('h1', { text: 'Настройки' }),
            el('p', { 'class': 'fsm-set-lead', text: 'У каждой компании своё «нормально». Здесь выбирается, как работает сервис: изменения применяются сразу на всех экранах. Изменено относительно значений по умолчанию: ' + changed + '.' })])]);
        if (write) head.appendChild(W.btn('Вернуть всё по умолчанию', resetAll, 'fsm-set-resetall'));
        host.appendChild(head);
        if (!write) host.appendChild(el('div', { 'class': 'fsm-set-ro', text: 'Режим просмотра: менять настройки может руководитель сервиса.' }));
        var grid = el('div', { 'class': 'fsm-set-grid' });
        C.OPT_GROUPS.forEach(function (g) { grid.appendChild(group(g)); });
        host.appendChild(grid);
    }
    W.mount(function (h) {
        host = h; host.classList.add('fsm-set-host'); write = W.canWrite('Настройка демо');
        return loadRows().then(draw);
    });
})();
