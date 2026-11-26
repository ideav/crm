/* Нормы СИЗ компании по должностям (на основе ЕТН, приказ № 767н) и правила сроков; должности без норм подсвечены. */
(function () {
    'use strict';
    var A = window.Suot, C = A.core, el = A.el;
    var pos = '';
    A.mount(function (host, M) {
        var names = Object.keys(M.positions).sort();
        if (!pos || !M.positions[pos]) pos = names.filter(function (n) { return n === 'Слесарь-ремонтник'; })[0] || names[0];
        host.appendChild(el('div', {}, A.head('Нормы СИЗ и правила', 'Нормы компании: должность × СИЗ × количество × срок носки с пунктом ЕТН и основанием (ЕТН или собственная поправка по СОУТ). Из них считаются карточка, выдача и календарь.')));
        var gaps = names.filter(function (n) { return !C.normsOf(M, n).length; });
        if (gaps.length) host.appendChild(el('div', { 'class': 'suot-warnbox suot-e', text: 'Должности без норм выдачи: ' + gaps.join(', ') + ' — сопоставить с ЕТН (приложение 1 к приказу № 767н) и утвердить.' }));
        var tbl = A.table([{ t: 'Должность', html: function (n) { return A.esc(n) + '<br><small class="suot-muted">ЕТН: ' + A.esc(M.positions[n].point || '—') + '</small>'; } },
            { t: 'Опасные работы', html: function (n) { return M.positions[n].works.map(function (x) { return '<span class="suot-chip">' + A.esc(x) + '</span>'; }).join('') || '<span class="suot-muted">—</span>'; } },
            { t: 'Позиций', html: function (n) { var k = C.normsOf(M, n).length; return k ? String(k) : A.badge('нет норм', 'crit'); }, num: 1 },
            { t: 'Работников', html: function (n) { return String(M.workers.filter(function (w) { return w.pos === n; }).length); }, num: 1 }], names,
            { onrow: function (n) { pos = n; A.render(); }, rowCls: function (n) { return n === pos ? 'suot-row-warn' : ''; } });
        var p = M.positions[pos], norms = C.normsOf(M, pos);
        var right = el('div', {}, [el('div', { 'class': 'suot-section-head', style: 'margin-top:0' }, [el('h2', { text: pos }), el('span', { 'class': 'suot-grow' }), A.canWrite('Норма выдачи') ? A.btn('Добавить позицию', function () { addNorm(M, pos); }, 'suot-primary') : null]),
            el('p', { 'class': 'suot-muted', text: 'Вредные факторы: ' + (p.factors.join(', ') || 'нет') + '. Опасные работы: ' + (p.works.join(', ') || 'нет') + '.' }),
            A.table([{ t: 'СИЗ', html: function (n) { return A.esc(n.ppe) + (n.work ? ' <span class="suot-chip">' + A.esc(n.work) + '</span>' : ''); } }, { t: 'Кол-во', k: 'qty', num: 1 }, { t: 'Срок носки', html: function (n) { return n.months ? n.months + ' мес' : 'до износа'; } }, { t: 'Пункт', k: 'point' },
                { t: 'Основание', html: function (n) { return A.badge(n.basis, /Собств/.test(n.basis) ? 'warn' : 'info'); } }, { t: 'Сертификат СИЗ', html: function (n) { return '<small>' + A.esc((M.ppeBy[n.ppe] || {}).cert || '') + '</small>'; } }], norms, { empty: 'Нет норм — добавьте позиции' })]);
        host.appendChild(el('div', { 'class': 'suot-split' }, [tbl, right]));
        /* правила сроков */
        host.appendChild(el('h2', { text: 'Правила сроков' }));
        var rt = A.table([{ t: 'Правило', html: function (r) { return A.esc(r['Правило ОТ']) + '<br><small class="suot-muted">' + A.esc(r['Пояснение правила']) + '</small>'; } }, { t: 'Значение', k: 'Значение правила', num: 1 }, { t: '', html: function () { return ''; }, cls: function () { return 'suot-act'; } }], M.ruleRows);
        host.appendChild(rt);
        if (A.canWrite('Правило ОТ')) rt.querySelectorAll('.suot-act').forEach(function (td, i) {
            var r = M.ruleRows[i];
            td.appendChild(A.btn('Изменить', function () {
                var v = A.input('number', r['Значение правила']);
                A.modal(r['Правило ОТ'], A.field('Значение', v, r['Пояснение правила']), [{ text: 'Отмена' }, { text: 'Сохранить', cls: 'suot-primary', keep: 1, fn: function (close) { A.update(r._id, { 'Значение правила': v.value }).then(function () { close(); A.toast('Правило изменено: карточки и календарь пересчитаны'); A.render(); }, function (e) { A.toast(e.message, 1); }); } }]);
            }, 'suot-small'));
        });
    });
    function addNorm(M, pos) {
        var ppe = A.select(M.ppe.map(function (p) { return p.name; })), qty = A.input('number', '1'), mo = A.input('number', '12'), pt = A.input('text', ''), basis = A.select(['ЕТН (приказ № 767н)', 'Собственная норма (по СОУТ, утверждена приказом)']), work = A.select([['', '—']].concat(M.workTypes));
        A.modal('Норма: ' + pos, el('div', { 'class': 'suot-grid2' }, [A.field('СИЗ', ppe), A.field('Количество на срок', qty), A.field('Срок носки, мес', mo, '0 — до износа'), A.field('Пункт норм', pt), A.field('Основание', basis), A.field('Обязательно для работ', work)]), [{ text: 'Отмена' }, { text: 'Добавить', cls: 'suot-primary', keep: 1, fn: function (close) {
            A.create('Норма выдачи', { 'Норма выдачи': pos + ': ' + ppe.value, 'Должность': pos, 'СИЗ': ppe.value, 'Количество на срок': qty.value, 'Срок носки, мес': mo.value, 'Пункт норм': pt.value, 'Основание нормы': basis.value, 'Для работ': work.value })
                .then(function () { close(); A.toast('Норма добавлена'); A.render(); }, function (e) { A.toast(e.message, 1); });
        } }], true);
    }
})();
