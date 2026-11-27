/* MDC: Оборудование и датчики. Справочник оборудования по участкам, датчики с последним значением от шлюза и правила, которые за ними следят; график дежурств смены. */
(function () {
    'use strict';
    var P = window.Mdc, C = P.core;
    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('div', {}, P.head('Оборудование и датчики', 'Справочник оборудования и датчиков. Источник данных - шлюз клиента (MQTT, OPC UA, выгрузка историка): он пишет последнее значение и отклонения, сырой ряд остаётся в историке.')));
        var pick = P.hash().eq || '';
        var rulesOf = function (param) { return M.rules.filter(function (r) { return r.param === param && r.active; }); };
        host.appendChild(P.table([
            { t: 'Код', html: function (e) { return '<b>' + P.esc(e.name) + '</b>'; } },
            { t: 'Оборудование', html: function (e) { return P.esc(e.title) + ' <span class="mdc-muted">' + P.esc(e.model) + '</span>'; } },
            { t: 'Участок', k: 'section' },
            { t: 'Статус', html: function (e) { var s = C.equipmentState(e, M.incidents).status; return P.badge(s, { 'Работает': 'ok', 'Плановый простой': 'mute', 'Простой': 'warn', 'Авария': 'crit' }[s]); } },
            { t: 'Топик шлюза', html: function (e) { return '<span class="mdc-mono">' + P.esc(e.topic) + '</span>'; } },
            { t: 'Инцидентов за неделю', num: true, html: function (e) { return String(M.incidents.filter(function (i) { return i.eq === e.name; }).length); } }
        ], M.eqs, { rowCls: function (e) { return e.name === pick ? 'mdc-row-warn' : ''; } }));
        host.appendChild(P.el('h2', { text: 'Датчики' }));
        var eqNames = {}; M.eqs.forEach(function (e) { eqNames[e.name] = 1; });
        host.appendChild(P.table([
            { t: 'Датчик', html: function (s) { return '<span class="mdc-mono">' + P.esc(s.name) + '</span>'; } },
            { t: 'Оборудование', k: 'eq' },
            { t: 'Параметр', k: 'param' },
            { t: 'Последнее значение', num: true, html: function (s) { var u = M.unitBy[s.param]; return u === 'сигнал' ? (C.num(s.last) ? 'стоит' : 'работает') : P.val(s.last) + ' ' + P.esc(u || ''); } },
            { t: 'Время', k: 'time' },
            { t: 'Правила', html: function (s) { return rulesOf(s.param).map(function (r) { return P.esc(r.name) + ' <span class="mdc-muted">(' + r.cond + ' ' + P.val(r.threshold) + ', ' + r.minutes + ' мин)</span>'; }).join('<br>') || '<span class="mdc-muted">не задано</span>'; } }
        ], M.sensors.filter(function (s) { return eqNames[s.eq]; }), { rowCls: function (s) { return s.eq === pick ? 'mdc-row-warn' : ''; } }));
        host.appendChild(P.el('h2', { text: 'Дежурства ' + C.toDmy(P.TODAY) }));
        host.appendChild(P.table([{ t: 'Смена', k: 'shift' }, { t: 'Участок', k: 'section' }, { t: 'Дежурный', k: 'emp' }, { t: 'Телефон', html: function (d) { return P.esc((M.empBy[d.emp] || {}).phone || ''); } }],
            M.duties.filter(function (d) { return d.date === P.TODAY || (d.date === C.addDays(P.TODAY, -1) && d.shift === 'Ночная'); }), { rowCls: function (d) { return d.shift === M.shift.shift && d.date === M.shift.date ? 'mdc-row-warn' : ''; } }));
    }
    P.mount(render);
})();
