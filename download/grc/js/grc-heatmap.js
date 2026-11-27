/* GRC: тепловая карта руководителя службы внутреннего контроля и отчёт комитету. */
(function () {
    'use strict';
    var P = window.Grc, C = P.core;
    var mode = 'residual', picked = null;

    function analyse(M) {
        var last = P.lastReq(M), camp = M.current, out = {};
        out.res = {}; M.risks.forEach(function (r) { out.res[r.code] = C.residual(r, M.ctrls, last, M.today, camp); });
        out.stats = C.campaignStats(P.campReqs(M, camp), camp, M.ctrlBy, M.today);
        out.repeats = C.repeatFailures(M.camps, M.reqs, M.today, 2);
        out.repBy = {}; out.repeats.forEach(function (x) { out.repBy[x.control] = x.run; });
        out.gaps = C.matrixGaps(M.risks, M.ctrls, M.emps, M.zones);
        var top = M.zones.length - 2;
        out.attention = M.risks.map(function (r) { var q = out.res[r.code]; return { r: r, q: q, z: P.zone(M, q.p * q.i), zi: P.zone(M, r.p * r.i) }; })
            .filter(function (x) { return C.zoneRank(x.z, M.zones) >= top && (x.q.broken.length || x.q.uncovered); })
            .sort(function (a, b) { return b.q.p * b.q.i - a.q.p * a.q.i || (a.r.code < b.r.code ? -1 : 1); });
        return out;
    }
    function brokenText(M, A, b) {
        var c = M.ctrlBy[b.control], rq = P.lastReq(M)[b.control];
        var st = b.state === 'none' ? 'не в кампании' : P.STATE[b.state][0].toLowerCase();
        if (rq && C.evidenceMissing(rq, c)) st = 'выполнен без доказательства';
        return '<b>' + P.esc(b.control) + '</b> ' + P.esc(c ? c.name : '') + ': <span class="grc-' + (b.state === 'done' || b.state === 'late' ? 'w' : 'e') + 't">' + P.esc(st) + '</span>' +
            (c && c.owner ? ' · ' + P.esc(c.owner) : '') + (A.repBy[b.control] ? ' ' + P.badge('сбой ' + A.repBy[b.control] + ' кампании подряд', 'crit') : '');
    }
    function report(M, A) {
        var camp = M.current, s = A.stats;
        var rows = A.attention.map(function (x) {
            return { code: x.r.code, name: x.r.name, process: x.r.process, inh: x.zi ? x.zi.name : '', res: x.z ? x.z.name : '', owner: x.r.owner,
                why: x.q.uncovered ? 'нет контролей' : x.q.broken.map(function (b) { var c = M.ctrlBy[b.control]; return b.control + ' ' + (P.STATE[b.state] ? P.STATE[b.state][0] : 'нет запроса') + (c ? ' (' + c.owner + ')' : ''); }).join('; ') };
        });
        var html = '<h2>Отчёт комитету по аудиту</h2><p>ГК «Светлояр», служба внутреннего контроля. Кампания «' + P.esc(camp.name) + '», период ' + C.toDmy(camp.start) + ' - ' + C.toDmy(camp.end) + ', срок ответа ' + C.toDmy(camp.due) + '. Состояние на ' + C.toDmy(M.today) + '.</p>' +
            '<p>Подтверждено в срок: <b>' + s.onTimePct + '%</b> (' + s.done + ' из ' + s.total + '); с опозданием ' + s.late + '; не выполнено ' + s.fail + '; нет ответа после срока ' + s.overdue + '; выполнено без доказательства ' + s.noFile + '. Повторные сбои контролей: ' + A.repeats.length + '.</p>' +
            '<table border="1" cellspacing="0" cellpadding="4"><tr><th>Риск</th><th>Процесс</th><th>Исходная зона</th><th>Остаточная зона</th><th>Владелец риска</th><th>Почему</th></tr>' +
            rows.map(function (r) { return '<tr><td>' + P.esc(r.code + ' ' + r.name) + '</td><td>' + P.esc(r.process) + '</td><td>' + P.esc(r.inh) + '</td><td>' + P.esc(r.res) + '</td><td>' + P.esc(r.owner) + '</td><td>' + P.esc(r.why) + '</td></tr>'; }).join('') + '</table>';
        var body = P.el('div', { 'class': 'grc-report', html: html });
        P.modal('Отчёт комитету', body, [
            { text: 'Скачать CSV', fn: function () { P.download('Отчёт комитету ' + C.toDmy(M.today) + '.csv', C.toCsv([['code', 'Риск'], ['name', 'Название'], ['process', 'Процесс'], ['inh', 'Исходная зона'], ['res', 'Остаточная зона'], ['owner', 'Владелец риска'], ['why', 'Почему']], rows)); return false; }, keep: true },
            { text: 'Печать / PDF', cls: 'grc-primary', fn: function () { var w = window.open('', '_blank'); if (!w) return false; w.document.write('<!doctype html><meta charset="utf-8"><title>Отчёт комитету</title><body style="font-family:sans-serif;font-size:13px">' + html + '</body>'); w.document.close(); w.print(); return false; }, keep: true },
            { text: 'Закрыть' }], true);
    }
    function render(host, M) {
        var A = analyse(M), s = A.stats, camp = M.current;
        host.innerHTML = '';
        P.head('Тепловая карта рисков', 'ГК «Светлояр»: шкалы и зоны заказчика 5 x 5. Кампания «' + (camp ? camp.name : '-') + '», срок ответа ' + (camp ? C.toDmy(camp.due) : '-') + '. Остаточный риск снижается, только когда ключевой контроль подтверждён владельцем с доказательством.').forEach(function (n) { host.appendChild(n); });
        host.appendChild(P.el('div', { 'class': 'grc-kpis' }, [
            P.kpi('Подтверждено в срок', P.pct(s.onTimePct), s.done + ' из ' + s.total + ' контролей', s.onTimePct < 80 ? 'warn' : 'good'),
            P.kpi('Нет ответа после срока', String(s.overdue), 'владельцы не подтвердили к ' + C.toDmy(camp.due), s.overdue ? 'bad' : 'good'),
            P.kpi('Не выполнено', String(s.fail), 'с причиной от владельца', s.fail ? 'warn' : 'good'),
            P.kpi('Без доказательства', String(s.noFile), '«выполнен», но файла нет', s.noFile ? 'warn' : 'good'),
            P.kpi('Повторные сбои', String(A.repeats.length), 'контроль сбоит 2+ кампании подряд', A.repeats.length ? 'bad' : 'good')]));
        var bar = P.el('div', { 'class': 'grc-bar' }, [P.tabs([['residual', 'Остаточный риск'], ['inherent', 'Исходный риск']], mode, function (m) { mode = m; picked = null; render(host, M); }), P.el('span', { 'class': 'grc-grow' }),
            P.btn('Отчёт комитету', function () { report(M, A); }, 'grc-primary')]);
        host.appendChild(bar);
        var pos = mode === 'residual' ? function (r) { return A.res[r.code]; } : null;
        var list = P.el('div', { 'class': 'grc-cellist' });
        var layout = P.el('div', { 'class': 'grc-split' }, [P.heatGrid(M, M.risks, pos, function (cell) { picked = cell; render(host, M); }, picked), list]);
        host.appendChild(layout);
        host.appendChild(P.zoneLegend(M));
        if (picked) {
            var cell = C.heatmap(M.risks, M.zones, M.probs.length, M.impacts.length, pos)[M.probs.length - picked.p][picked.i - 1];
            list.appendChild(P.el('h3', { text: 'Ячейка: вероятность ' + picked.p + ' x влияние ' + picked.i + (cell.zone ? ' (' + cell.zone.name + ')' : '') }));
            if (!cell.risks.length) list.appendChild(P.el('p', { 'class': 'grc-sub', text: 'Рисков нет.' }));
            cell.risks.forEach(function (r) { list.appendChild(riskCard(M, A, r)); });
        } else {
            list.appendChild(P.el('h3', { text: 'Требует внимания: ' + A.attention.length }));
            list.appendChild(P.el('p', { 'class': 'grc-sub', text: 'Высокие и критические риски, у которых ключевой контроль не подтверждён или контролей нет.' }));
            A.attention.forEach(function (x) { list.appendChild(riskCard(M, A, x.r)); });
        }
    }
    function riskCard(M, A, r) {
        var q = A.res[r.code], zi = P.zone(M, r.p * r.i), zr = P.zone(M, q.p * q.i);
        var card = P.el('div', { 'class': 'grc-card' + (C.zoneRank(zr, M.zones) >= M.zones.length - 1 ? ' grc-bad' : '') }, [
            P.el('div', { 'class': 'grc-card-h', html: '<b>' + P.esc(r.code) + '</b> ' + P.esc(r.name) }),
            P.el('div', { 'class': 'grc-card-s', html: P.esc(r.process) + ' · ' + P.esc(r.cat) + ' · исходно ' + P.zoneBadge(zi) + ' → остаточно ' + P.zoneBadge(zr) })]);
        if (q.uncovered) card.appendChild(P.el('div', { 'class': 'grc-line', html: '<span class="grc-et">Нет ни одного контроля</span>: риск не прикрыт' }));
        q.broken.forEach(function (b) { card.appendChild(P.el('div', { 'class': 'grc-line grc-click', html: brokenText(M, A, b), onclick: function () { P.ctrlCard(M, b.control); } })); });
        if (!q.uncovered && !q.broken.length) card.appendChild(P.el('div', { 'class': 'grc-line', html: '<span class="grc-gt">Ключевые контроли подтверждены: ' + q.keyOk + ' из ' + q.keyTotal + '</span>' }));
        return card;
    }
    P.mount(function (host, M) { render(host, M); });
})();
