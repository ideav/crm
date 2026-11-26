/* Карточка работника: комплект СИЗ по нормам, инструктажи и обучение, медосмотр, допуск сегодня, личная карточка учёта выдачи СИЗ. */
(function () {
    'use strict';
    var A = window.Suot, C = A.core, el = A.el;
    var HERO = 'Гаврилов Сергей Петрович';
    A.mount(function (host, M) {
        var h = A.hash(), T = M.today;
        var name = h.w && M.workerBy[h.w] ? h.w : (M.workerBy[HERO] ? HERO : (M.workers[0] || {}).name);
        var w = M.workerBy[name];
        host.appendChild(el('div', {}, A.head('Карточка работника', 'Паспорт допуска: что положено по нормам компании (на основе ЕТН), что выдано и когда менять, какие инструктажи, обучение и медосмотр действуют, допущен ли человек сегодня к нарядам-допускам.')));
        if (!w) { host.appendChild(el('p', { 'class': 'suot-muted', text: 'Нет работников, доступных роли.' })); return; }
        var sel = A.workerSelect(M, name);
        sel.addEventListener('change', function () { location.hash = 'w=' + encodeURIComponent(sel.value); A.render(); });
        host.appendChild(el('div', { 'class': 'suot-bar' }, [A.field('Работник', sel), el('div', { 'class': 'suot-grow' }),
            A.btn('Печать личной карточки', function () { window.print(); }),
            A.canWrite('Выдача СИЗ') ? A.btn('Выдать СИЗ на складе', function () { location.href = A.nav('issue', 'w=' + encodeURIComponent(w.name)); }, 'suot-primary') : null]));

        var pos = M.positions[w.pos] || { works: [], factors: [] };
        var full = M.can['Запись обучения'] && M.can['Медосмотр'];
        var adm = full ? C.admission(w, M, T) : null;
        var info = el('div', { 'class': 'suot-card' }, [el('h2', { text: w.name }),
            kv('Табельный №', w.tab), kv('Подразделение', w.dept), kv('Должность', w.pos), kv('Принят', C.toDmy(w.hire)),
            kv('Опасные работы', pos.works.join(', ') || 'нет'), kv('Вредные факторы', pos.factors.join(', ') || 'нет'),
            kv('Размеры', [w.sizes.clothes, 'обувь ' + w.sizes.shoes, 'голова ' + w.sizes.head, 'перчатки ' + w.sizes.gloves].join(' · '))]);
        var verdict;
        if (!adm) verdict = el('div', { 'class': 'suot-verdict' }, [el('b', { text: 'Допуск к работам роли не показывается' }), el('span', { 'class': 'suot-muted', text: 'Журналы инструктажей и медосмотры видят специалист по ОТ, мастер и начальник производства. Здесь — только СИЗ.' })]);
        else if (adm.ok) verdict = el('div', { 'class': 'suot-verdict suot-yes' }, [el('b', { text: 'Допущен к работам сегодня, ' + C.toDmy(T) }), el('span', { text: pos.works.length ? 'Может входить в наряд-допуск: ' + pos.works.join(', ') + '.' : 'Инструктажи, обучение и медосмотр действуют.' })]);
        else verdict = el('div', { 'class': 'suot-verdict suot-no' }, [el('b', { text: 'Не допущен: наряд-допуск с ним не подпишется' }), el('ul', {}, adm.reasons.map(function (r) { return el('li', { text: r }); }))]);
        var cnt = counts(w, M, T, full);
        var kp = el('div', { 'class': 'suot-kpis' }, [A.kpi('просрочено', String(cnt.over), 'СИЗ, инструктажи, медосмотр', cnt.over ? 'bad' : 'good'), A.kpi('истекает за ' + M.rules.warnDays + ' дн.', String(cnt.soon), 'надо запланировать', cnt.soon ? 'warn' : ''), A.kpi('СИЗ по норме выдано', cnt.ppeOk + ' из ' + cnt.ppeAll, 'позиций комплекта', cnt.ppeOk < cnt.ppeAll ? 'warn' : 'good')]);
        host.appendChild(el('div', { 'class': 'suot-person' }, [info, el('div', {}, [verdict, kp])]));

        /* СИЗ по нормам */
        var card = C.ppeCard(w, M, T);
        host.appendChild(sec('Комплект СИЗ по нормам должности', 'нормы «' + w.pos + '», ' + card.length + ' позиций'));
        host.appendChild(A.table([
            { t: 'СИЗ', html: function (r) { return A.esc(r.ppe) + (r.work ? ' <span class="suot-chip">' + A.esc(r.work) + '</span>' : ''); } },
            { t: 'Норма', html: function (r) { return A.esc(r.qty + ' ' + ((M.ppeBy[r.ppe] || {}).unit || 'шт') + ' / ' + (r.months ? r.months + ' мес' : 'до износа')); } },
            { t: 'Пункт норм', html: function (r) { return A.esc(r.point) + '<br><small class="suot-muted">' + A.esc(r.basis) + '</small>'; } },
            { t: 'Размер', k: 'size' },
            { t: 'Выдано', html: function (r) { return r.last ? C.toDmy(r.last) : '<span class="suot-muted">—</span>'; } },
            { t: 'Следующая выдача', html: function (r) { return r.due ? C.toDmy(r.due) + '<br><small class="suot-muted">' + C.dueText(r.due, T) + '</small>' : (r.months ? '' : '<span class="suot-muted">по износу</span>'); } },
            { t: 'Статус', html: function (r) { return A.stateBadge(r.state, r.due); } }
        ], card, { rowCls: rowCls, empty: 'Для должности нет норм выдачи — сопоставить с ЕТН на экране «Нормы СИЗ»' }));

        /* инструктажи и обучение */
        if (M.can['Запись обучения']) {
            var tr = C.trainingCard(w, M, T);
            var head = sec('Инструктажи, обучение, проверка знаний', 'виды «для всех» и по опасным работам должности');
            host.appendChild(head);
            host.appendChild(A.table([
                { t: 'Вид', html: function (r) { return A.esc(r.kind) + '<br><small class="suot-muted">' + A.esc(r.cat) + (r.why !== 'для всех' ? ' · ' + A.esc(r.why) : '') + '</small>'; } },
                { t: 'Периодичность', html: function (r) { return r.once ? 'однократно' : 'раз в ' + r.months + ' мес' + (r.kind === 'Повторный инструктаж' && r.months < M.rules.repeatMonths ? '<br><small class="suot-muted">первый год на опасных работах (пост. № 805)</small>' : ''); } },
                { t: 'Последний', html: function (r) { return r.last ? C.toDmy(r.last) + '<br><small class="suot-muted">' + A.esc(r.by) + '</small>' : '—'; } },
                { t: 'Следующий', html: function (r) { return r.due ? C.toDmy(r.due) + '<br><small class="suot-muted">' + C.dueText(r.due, T) + '</small>' : ''; } },
                { t: 'Статус', html: function (r) { return A.stateBadge(r.state, r.due); } },
                { t: '', html: function () { return ''; }, cls: function () { return 'suot-act'; } }
            ], tr, { rowCls: rowCls }));
            if (A.canWrite('Запись обучения')) host.querySelectorAll('.suot-act').forEach(function (td, i) {
                var r = tr[i]; if (r.once && r.state === 'ok') return;
                td.appendChild(A.btn('Отметить проведение', function () { A.markTraining(M, w, r.kind); }, 'suot-small'));
            });
        }
        /* медосмотр */
        if (M.can['Медосмотр']) {
            var med = C.medCard(w, M, T);
            host.appendChild(sec('Медосмотр', med.state === 'na' ? 'вредных факторов у должности нет' : 'периодичность по самому частому фактору: раз в ' + med.months + ' мес'));
            host.appendChild(A.table([{ t: 'Факторы (приказ № 29н)', html: function () { return A.esc(med.factors.join(', ') || '—'); } }, { t: 'Последний', html: function () { return med.last ? C.toDmy(med.last) : '—'; } }, { t: 'Заключение', html: function () { return A.esc(med.verdict || '—'); } },
                { t: 'Следующий до', html: function () { return med.due ? C.toDmy(med.due) + '<br><small class="suot-muted">' + C.dueText(med.due, T) + '</small>' : ''; } }, { t: 'Статус', html: function () { return A.stateBadge(med.state, med.due); } }], med.state === 'na' ? [] : [med], { rowCls: function () { return rowCls(med); } }));
        }
        /* личная карточка: история выдач */
        var hist = M.issues.filter(function (i) { return i.worker === w.name; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
        host.appendChild(sec('Личная карточка учёта выдачи СИЗ', 'электронная форма по приказу № 766н (п. 25–26): вместо подписи — идентифицирующие сведения о получении'));
        host.appendChild(A.table([{ t: 'Дата', html: function (r) { return C.toDmy(r.date); } }, { t: 'СИЗ', k: 'ppe' }, { t: 'Сертификат / декларация', html: function (r) { return '<small>' + A.esc((M.ppeBy[r.ppe] || {}).cert || '') + '</small>'; } }, { t: 'Кол-во', k: 'qty', num: 1 }, { t: 'Размер', k: 'size' }, { t: 'Выдал', k: 'by' }, { t: 'Получение', html: function (r) { return '<small>' + A.esc(r.sign) + (r.reason ? '<br>Причина: ' + A.esc(r.reason) : '') + '</small>'; } }], hist, { empty: 'Выдач нет' }));
    });
    function kv(k, v) { return el('div', { 'class': 'suot-kv' }, [el('span', { text: k }), el('span', { text: v || '—' })]); }
    function sec(t, sub) { return el('div', { 'class': 'suot-section-head' }, [el('h2', { text: t }), el('span', { 'class': 'suot-muted', text: sub || '' })]); }
    function rowCls(r) { return r.state === 'over' || r.state === 'none' ? 'suot-row-bad' : r.state === 'soon' ? 'suot-row-warn' : ''; }
    function counts(w, M, T, full) {
        var all = C.ppeCard(w, M, T).map(function (c) { return c.state; }), x = { over: 0, soon: 0, ppeAll: all.length, ppeOk: 0 };
        all.forEach(function (s) { if (s !== 'none') x.ppeOk++; });
        if (full) { all = all.concat(C.trainingCard(w, M, T).map(function (t) { return t.state; })); var m = C.medCard(w, M, T).state; if (m !== 'na') all.push(m); }
        all.forEach(function (s) { if (s === 'over' || s === 'none') x.over++; else if (s === 'soon') x.soon++; });
        return x;
    }
})();
