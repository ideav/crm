/* GRC: общие компоненты экранов (состояния запросов, тепловая карта, карточка контроля). */
(function () {
    'use strict';
    var P = window.Grc, C = P.core;
    P.STATE = { done: ['Выполнен в срок', 'ok'], late: ['Выполнен с опозданием', 'warn'], fail: ['Не выполнен', 'crit'], overdue: ['Нет ответа, срок прошёл', 'crit'], wait: ['Ждём ответа', 'info'], none: ['Не запрашивался', 'mute'] };
    P.stateBadge = function (st) { var s = P.STATE[st] || P.STATE.none; return P.badge(s[0], s[1]); };
    P.zoneBadge = function (z) { return z ? '<span class="grc-zone" style="--z:' + P.esc(z.color) + '">' + P.esc(z.name) + '</span>' : ''; };
    P.riskLabel = function (M, code) { var r = M.riskBy[code]; return r ? r.code + ' ' + r.name : code || ''; };
    P.fileLink = function (r) { return r.file ? '<a href="' + P.esc(r.file) + '" target="_blank" rel="noopener">' + P.esc(r.fileName || 'файл') + '</a>' : ''; };
    P.campLabel = function (c) { return c ? c.name + ' (срок ответа ' + C.toDmy(c.due) + ')' : ''; };

    /* Тепловая карта: строки - вероятность (сверху высокая), столбцы - влияние; pos(r) даёт {p,i}. */
    P.heatGrid = function (M, risks, pos, onCell, picked) {
        var pMax = M.probs.length, iMax = M.impacts.length;
        var grid = C.heatmap(risks, M.zones, pMax, iMax, pos);
        var t = P.el('table', { 'class': 'grc-heat', 'aria-label': 'Тепловая карта рисков' });
        grid.forEach(function (row, k) {
            var pl = M.probs[pMax - 1 - k];
            var tr = P.el('tr', {}, [P.el('th', { 'class': 'grc-heat-y', html: '<b>' + pl.score + '</b> ' + P.esc(pl.name) + '<small>' + P.esc(pl.text || '') + '</small>' })]);
            row.forEach(function (cell) {
                var on = picked && picked.p === cell.p && picked.i === cell.i;
                var b = P.el('button', { type: 'button', 'class': 'grc-hc' + (cell.risks.length ? ' grc-hc-has' : '') + (on ? ' grc-hc-on' : ''), style: '--z:' + (cell.zone ? cell.zone.color : '#94a3b8'),
                    title: (cell.zone ? cell.zone.name + ', ' : '') + 'балл ' + cell.score + ': ' + (cell.risks.map(function (r) { return r.code; }).join(', ') || 'нет рисков'),
                    onclick: function () { onCell(cell); } }, [P.el('span', { 'class': 'grc-hc-n', text: cell.risks.length ? String(cell.risks.length) : '' }), P.el('small', { text: cell.risks.slice(0, 3).map(function (r) { return r.code; }).join(' ') + (cell.risks.length > 3 ? ' …' : '') })]);
                tr.appendChild(P.el('td', {}, [b]));
            });
            t.appendChild(tr);
        });
        t.appendChild(P.el('tr', {}, [P.el('th', { 'class': 'grc-heat-corner', text: 'Вероятность / Влияние' })].concat(M.impacts.map(function (il) {
            return P.el('th', { 'class': 'grc-heat-x', html: '<b>' + il.score + '</b> ' + P.esc(il.name) + '<small>' + P.esc(il.text || '') + '</small>' });
        }))));
        return P.el('div', { 'class': 'grc-heatwrap' }, [t]);
    };
    P.zoneLegend = function (M) {
        return P.el('div', { 'class': 'grc-legend' }, M.zones.map(function (z) {
            return P.el('span', { html: P.zoneBadge(z) + ' ' + z.from + '-' + z.to + ' баллов: ' + P.esc(z.action || '') });
        }));
    };
    /* История контроля по кампаниям. */
    P.ctrlHistory = function (M, code) {
        return M.camps.map(function (c) {
            var r = M.reqs.filter(function (x) { return x.campaign === c.name && x.control === code; })[0];
            return { camp: c.name, r: r, st: r ? C.requestState(r, c, M.today) : 'none' };
        });
    };
    P.ctrlCard = function (M, code) {
        var c = M.ctrlBy[code]; if (!c) return;
        var rk = M.riskBy[c.risk], z = rk ? P.zone(M, rk.p * rk.i) : null;
        var body = P.el('div', {}, [
            P.el('div', { 'class': 'grc-kv', html: '<span>Риск</span><span>' + P.esc(P.riskLabel(M, c.risk)) + ' ' + P.zoneBadge(z) + '</span>' }),
            P.el('div', { 'class': 'grc-kv', html: '<span>Владелец</span><span>' + P.esc(c.owner || 'не назначен') + '</span>' }),
            P.el('div', { 'class': 'grc-kv', html: '<span>Периодичность</span><span>' + P.esc(c.period || 'не задана') + '</span>' }),
            P.el('div', { 'class': 'grc-kv', html: '<span>Вид, способ</span><span>' + P.esc([c.kind, c.method].filter(Boolean).join(', ')) + (c.key ? ' ' + P.badge('ключевой', 'info') : '') + '</span>' }),
            P.el('div', { 'class': 'grc-kv', html: '<span>Что приложить</span><span>' + P.esc(c.evidence || 'не требуется') + '</span>' }),
            P.el('h3', { text: 'Подтверждения по кампаниям', style: 'margin-top:12px' }),
            P.table([{ t: 'Кампания', k: 'camp' }, { t: 'Результат', html: function (x) { return P.stateBadge(x.st); } },
                { t: 'Ответ', html: function (x) { return x.r && x.r.answered ? C.toDmy(x.r.answered) + ' ' + P.esc(x.r.time) : ''; } },
                { t: 'Причина / файл', html: function (x) { return x.r ? P.esc(x.r.reason || '') + ' ' + P.fileLink(x.r) : ''; } }], P.ctrlHistory(M, code))
        ]);
        P.modal(c.code + ' ' + c.name, body, null, true);
    };
})();
