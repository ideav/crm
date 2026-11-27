/* Адаптация персонала: «Отчёт по подразделениям». Кто не доходит до конца испытательного, на каком шаге застревают, причины ухода, задержка доступов. */
(function () {
    'use strict';
    var P = window.Onb, C = P.core;

    function render(host, M) {
        host.innerHTML = '';
        host.appendChild(P.el('h1', { text: 'Адаптация по подразделениям' }));
        var first = M.newbies.reduce(function (m, n) { return n.start !== null && (m === null || n.start < m) ? n.start : m; }, null);
        host.appendChild(P.el('p', { 'class': 'ob-sub', text: 'Все новички, вышедшие с ' + C.fmtD(first) + ' по ' + C.fmtD(M.today) + '. «Застревают» - шаги, сделанные позже срока или просроченные сейчас; доля ушедших считается от завершивших испытательный.' }));
        var rep = C.deptReport(M.newbies, M.today, M.rules.warn);
        var tot = rep.reduce(function (s, d) { return { started: s.started + d.started, passed: s.passed + d.passed, left: s.left + d.left, refused: s.refused + d.refused }; }, { started: 0, passed: 0, left: 0, refused: 0 });
        var worst = rep[0];
        host.appendChild(P.el('div', { 'class': 'ob-kpis' }, [
            P.kpi('Вышли на работу', String(tot.started), 'отказались до выхода: ' + tot.refused),
            P.kpi('Ушли на испытательном', (tot.passed + tot.left ? Math.round(tot.left * 100 / (tot.passed + tot.left)) : 0) + '%', tot.left + ' из ' + (tot.passed + tot.left) + ' завершивших', tot.left ? 'bad' : 'good'),
            worst ? P.kpi('Больше всего уходят', worst.leftPct + '%', worst.dept + (worst.topReason ? ': ' + worst.topReason.toLowerCase() : ''), worst.leftPct >= 30 ? 'bad' : 'warn') : null,
            worst && worst.top[0] ? P.kpi('Главная пробка', C.plural(worst.top[0].count, 'раз', 'раза', 'раз'), worst.top[0].name + ', в среднем +' + Math.round(worst.top[0].days / worst.top[0].count * 10) / 10 + ' дн', 'warn') : null]));
        host.appendChild(P.el('div', { 'class': 'ob-legend', html: '<span><i class="ob-b-pass"></i>прошли</span><span><i class="ob-b-left"></i>ушли</span><span><i class="ob-b-act"></i>идут сейчас</span>' }));
        host.appendChild(P.table([
            { t: 'Подразделение', html: function (d) { return '<b>' + P.esc(d.dept) + '</b>'; } },
            { t: 'Вышли', num: true, k: 'started' },
            { t: 'Итог', node: function (d) { var w = function (x) { return d.started ? x * 100 / d.started : 0; }; return P.el('div', { 'class': 'ob-bars', title: 'прошли ' + d.passed + ', ушли ' + d.left + ', идут ' + d.active, html: '<i class="ob-b-pass" style="width:' + w(d.passed) + '%"></i><i class="ob-b-left" style="width:' + w(d.left) + '%"></i><i class="ob-b-act" style="width:' + w(d.active) + '%"></i>' }); } },
            { t: 'Ушли', num: true, html: function (d) { return '<b class="' + (d.leftPct >= 30 ? 'ob-red' : '') + '">' + d.leftPct + '%</b><br><small class="ob-muted">' + d.left + ' чел.</small>'; } },
            { t: 'Почему уходят', html: function (d) { return Object.keys(d.reasons).map(function (r) { return P.esc(r) + ' - ' + d.reasons[r]; }).join('<br>') || '<span class="ob-muted">-</span>'; } },
            { t: 'Где застревают', html: function (d) { return d.top.map(function (t) { return P.esc(t.name) + ' <small class="ob-muted">' + t.count + ' раз, +' + Math.round(t.days / t.count * 10) / 10 + ' дн</small>'; }).join('<br>') || '<span class="ob-muted">без задержек</span>'; } },
            { t: 'Доступы ИТ, задержка', num: true, html: function (d) { return d.itLate.length ? '<b>+' + String(d.itAvg).replace('.', ',') + ' дн</b><br><small class="ob-muted">' + d.itLate.length + ' раз</small>' : '-'; } }
        ], rep));
        var gone = M.newbies.filter(function (n) { return n.status === 'Ушёл на испытательном'; }).sort(function (a, b) { return b.ddate - a.ddate; });
        if (gone.length) {
            host.appendChild(P.el('h2', { text: 'Ушли на испытательном' }));
            host.appendChild(P.table([
                { t: 'Новичок', html: function (n) { return P.esc(n.name) + '<br><small class="ob-muted">' + P.esc(n.pos) + '</small>'; } },
                { t: 'Подразделение', k: 'dept' },
                { t: 'День ухода', num: true, html: function (n) { return n.ddate !== null ? String(n.ddate - n.start + 1) : ''; } },
                { t: 'Причина', k: 'reason' },
                { t: 'Опоздали шаги', html: function (n) { var l = n.steps.filter(function (s) { return C.stepState(s, M.today) === 'late'; }); return l.map(function (s) { return P.esc(s.name) + ' +' + (s.done - s.due); }).join('<br>') || '-'; } }
            ], gone, { onrow: function (n) { P.newbieCard(M, n); } }));
        }
        host.appendChild(P.el('div', { 'class': 'ob-bar' }, [P.btn('Выгрузить CSV', function () {
            P.download('adaptation-by-dept.csv', C.toCsv([['Подразделение', 'Вышли', 'Прошли', 'Ушли', 'Идут', 'Доля ушедших, %', 'Главная причина', 'Где застревают', 'Задержка ИТ, дн']].concat(rep.map(function (d) {
                return [d.dept, d.started, d.passed, d.left, d.active, d.leftPct, d.topReason, d.top.map(function (t) { return t.name + ' (' + t.count + ')'; }).join(', '), d.itAvg];
            }))));
        })]));
    }
    P.mount(render);
})();
