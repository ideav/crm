/* Диспетчеризация: экран «Режимы хранения». Граница, допуск на открытую дверь, время до тревоги, срок реакции; прогон по ноябрю - сколько дало бы тревог. */
(function () {
    'use strict';
    var P = window.Dsp, C = P.core;
    var pick = null;
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('div', {}, P.head('Режимы хранения', 'Режим зоны решает, что считать отклонением: граница, допуск на открытую дверь при приёмке, время до тревоги, срок реакции и шаг эскалации. Перед сохранением режим прогоняется по отклонениям ноября.')));
        if (!pick || !M.modeBy[pick]) pick = M.modes[0] && M.modes[0].name;
        host.appendChild(P.el('div', { 'class': 'dsp-cards' }, M.modes.map(function (m) {
            var zones = M.zones.filter(function (z) { return z.mode === m.name; });
            return P.el('div', { 'class': 'dsp-card dsp-rule' + (m.name === pick ? ' dsp-on' : ''), onclick: function () { pick = m.name; render(host, M); } }, [
                P.el('b', { text: m.name }), P.el('div', { 'class': 'dsp-muted', text: P.modeText(m) }),
                P.el('div', { 'class': 'dsp-muted', text: 'реакция ' + m.react + ' мин, эскалация каждые ' + m.escalate + ' мин; зон: ' + zones.length })]);
        })));
        var m = M.modeBy[pick]; if (!m) return;
        var can = P.canWrite('Режим хранения');
        var inp = {}; [['min', 'Нижняя граница, °C'], ['max', 'Верхняя граница, °C'], ['warn', 'Предупреждение за, °C'], ['door', 'Допуск на открытую дверь, мин'], ['delay', 'Время до тревоги, мин'], ['react', 'Срок реакции, мин'], ['escalate', 'Эскалация через, мин']].forEach(function (k) {
            inp[k[0]] = { el: P.input('number', m[k[0]], { step: k[0] === 'min' || k[0] === 'max' || k[0] === 'warn' ? '0.5' : '1' }), name: k[1] }; inp[k[0]].el.disabled = !can;
        });
        var zones = M.zones.filter(function (z) { return z.mode === m.name; }).map(function (z) { return z.name; });
        var devs = (M.devs || []).filter(function (d) { return zones.indexOf(d.zone) >= 0; });
        var out = P.el('div', {});
        function cur() { var o = {}; Object.keys(inp).forEach(function (k) { o[k] = C.num(inp[k].el.value); }); return o; }
        function show() {
            var a = C.replay(devs, m), b = C.replay(devs, m, cur()), z = C.replay(devs, m, { door: 0 });
            out.innerHTML = '';
            out.appendChild(P.table([{ t: 'Вариант', k: 'v' }, { t: 'Открытая дверь (без тревоги)', k: 'd', num: true }, { t: 'Предупреждений', k: 'w', num: true }, { t: 'Тревог', k: 'a', num: true }], [
                { v: 'Сейчас в базе', d: a['Открытая дверь'], w: a['Предупреждение'], a: a['Тревога'] },
                { v: 'С изменениями на форме', d: b['Открытая дверь'], w: b['Предупреждение'], a: b['Тревога'] },
                { v: 'Без допуска на дверь (как в облаке датчиков)', d: z['Открытая дверь'], w: z['Предупреждение'], a: z['Тревога'] }]));
        }
        Object.keys(inp).forEach(function (k) { inp[k].el.addEventListener('input', show); });
        host.appendChild(P.el('h2', { text: m.name }));
        host.appendChild(P.el('p', { 'class': 'dsp-muted', text: 'Зоны: ' + (zones.join(', ') || 'нет') + '. Отклонений в ноябре: ' + devs.length + (M.devs ? '' : ' (история закрыта ролью)') + '.' }));
        host.appendChild(P.el('div', { 'class': 'dsp-grid2' }, Object.keys(inp).map(function (k) { return P.field(inp[k].name, inp[k].el); })));
        host.appendChild(P.el('h3', { text: 'Прогон по отклонениям ноября', style: 'margin-top:14px' }));
        host.appendChild(out);
        if (can) host.appendChild(P.el('div', { 'class': 'dsp-bar' }, [P.el('div', { 'class': 'dsp-grow' }), P.btn('Сохранить режим', function () {
            var f = {}; Object.keys(inp).forEach(function (k) { f[inp[k].name] = C.num(inp[k].el.value); });
            P.update(m.id, f).then(function () { P.toast('Режим «' + m.name + '» сохранён'); P.refresh(); }, function (er) { P.toast(er.message, true); });
        }, 'dsp-primary')]));
        show();
    }
    P.mount(render);
})();
