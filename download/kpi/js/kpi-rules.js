/* KPI: «Правила премии» - схемы словами, веса, шкалы, порог и потолок. Правка с проверкой (веса = 100 %) и записью в журнал. */
(function () {
    'use strict';
    var K = window.Kpi, C = K.core;
    function schemeCard(M, s) {
        var can = K.canWrite('Схема премии') && K.canWrite('Показатель схемы');
        var card = K.el('div', { 'class': 'kpi-card' });
        card.appendChild(K.el('h2', { html: 'Схема «' + K.esc(s.name) + '» <span class="kpi-muted">версия ' + s.version + ', изменена ' + K.esc(s.changed || '') + '</span>' }));
        var staff = M.emps.filter(function (e) { return e.scheme === s.name; }).length;
        card.appendChild(K.el('div', { 'class': 'kpi-formula' }, C.formulaText(s).map(function (t) { return K.el('p', { text: t }); }).concat(staff ? [K.el('p', { 'class': 'kpi-muted', text: 'Работают по схеме: ' + staff + ' чел.' })] : [])));
        var ed = { threshold: K.input('number', s.threshold, { min: 0, max: 99, step: 5 }), cap: K.input('number', s.cap, { min: 100, max: 200, step: 5 }),
            ratingStep: K.input('number', s.ratingStep, { min: 0, max: 20, step: 1 }), partMode: K.select(['Пропорционально', 'Полностью'], s.partMode) };
        var wIn = {}, scIn = {}, stIn = {};
        card.appendChild(K.table([
            { t: 'Показатель', html: function (l) { return '<b>' + K.esc(l.ind.name) + '</b><br><span class="kpi-muted">' + K.esc(l.ind.src || '') + '</span>'; } },
            { t: 'Направление', html: function (l) { return K.esc(l.ind.dir) + (l.ind.kind === C.BLOCK ? '<br>' + K.badge('Блокирующий', 'crit') : ''); } },
            { t: 'Единица', html: function (l) { return K.esc(l.ind.unit); } },
            { t: 'Вес, %', num: true, html: function (l) { return l.ind.kind === C.BLOCK ? '<span class="kpi-muted">-</span>' : String(l.weight); } },
            { t: 'Шкала', html: function (l) { return l.ind.kind === C.BLOCK ? '<span class="kpi-muted">превышение допустимого = премии нет</span>' : K.esc(l.scale); } }
        ], s.lines));
        if (s.steps.length) card.appendChild(K.el('p', { text: 'Ступени: ' + s.steps.slice().sort(function (a, b) { return a.from - b.from; }).map(function (x) { return 'от ' + x.from + ' % - коэффициент ' + C.fnum(x.coef); }).join('; ') }));
        if (!can) return card;
        var form = K.el('div', { hidden: 'hidden' });
        form.appendChild(K.el('div', { 'class': 'kpi-bar' }, [K.field('Порог начисления, %', ed.threshold), K.field('Потолок коэффициента, %', ed.cap), K.field('Шаг множителя оценки, %', ed.ratingStep, '0 - оценка не влияет'), K.field('Неполный месяц', ed.partMode)]));
        s.lines.forEach(function (l) {
            if (l.ind.kind === C.BLOCK) return;
            wIn[l.id] = K.input('number', l.weight, { min: 0, max: 100, step: 5 });
            scIn[l.id] = K.select(['Линейная', 'Ступенчатая'], l.scale);
            form.appendChild(K.el('div', { 'class': 'kpi-rule-row' }, [K.el('span', { text: l.ind.name }), K.field('Вес, %', wIn[l.id]), K.field('Шкала', scIn[l.id])]));
        });
        s.steps.forEach(function (x) { stIn[x.id] = K.input('number', x.coef, { min: 0, max: 3, step: 0.05 }); form.appendChild(K.el('div', { 'class': 'kpi-rule-row' }, [K.el('span', { text: 'Ступень от ' + x.from + ' %' }), K.field('Коэффициент', stIn[x.id]), K.el('span')])); });
        var reason = K.input('text', '', { placeholder: 'Основание: приказ, протокол, решение директора' });
        var msg = K.el('div');
        form.appendChild(K.field('Основание изменения (попадёт в журнал)', reason));
        form.appendChild(msg);
        function draft() {
            return Object.assign({}, s, { threshold: C.num(ed.threshold.value), cap: C.num(ed.cap.value), ratingStep: C.num(ed.ratingStep.value), partMode: ed.partMode.value,
                lines: s.lines.map(function (l) { return wIn[l.id] ? Object.assign({}, l, { weight: C.num(wIn[l.id].value), scale: scIn[l.id].value }) : l; }),
                steps: s.steps.map(function (x) { return Object.assign({}, x, { coef: C.num(stIn[x.id].value) }); }) });
        }
        function check() {
            var d = draft(), e = C.validateScheme(d); msg.innerHTML = '';
            e.forEach(function (x) { msg.appendChild(K.el('div', { 'class': 'kpi-warnbox kpi-e', text: x })); });
            if (!e.length) {
                var ctx = K.calcCtx(M, K.CUR), ov = {}; ov[s.name] = d;
                var w = C.whatIf(ctx, ov);
                msg.appendChild(K.el('div', { 'class': 'kpi-warnbox kpi-g', text: 'Проверка пройдена. На октябре: ФОТ премий ' + C.rub(w.before) + ' -> ' + C.rub(w.after) + ' (' + (w.delta > 0 ? '+' : '') + C.rub(w.delta) + '), меняется у ' + w.changed.length + ' чел.' }));
            }
            return e;
        }
        form.addEventListener('input', check); form.addEventListener('change', check);
        form.appendChild(K.el('div', { 'class': 'kpi-bar' }, [K.btn('Сохранить правило', function () {
            if (check().length) return K.toast('Исправьте ошибки схемы', true);
            if (!reason.value.trim()) return K.toast('Укажите основание изменения', true);
            var d = draft(), ver = s.version + 1, ops = [K.update(s.id, { 'Порог начисления, %': d.threshold, 'Потолок коэффициента, %': d.cap, 'Шаг множителя оценки, %': d.ratingStep, 'Неполный месяц': d.partMode, 'Версия правил': ver, 'Правила изменены': K.now() + ' ' + K.ctx.user })];
            d.lines.forEach(function (l, i) { var o = s.lines[i]; if (wIn[l.id] && (o.weight !== l.weight || o.scale !== l.scale)) ops.push(K.update(l.id, { 'Вес, %': l.weight, 'Шкала показателя': l.scale })); });
            d.steps.forEach(function (x, i) { if (s.steps[i].coef !== x.coef) ops.push(K.update(x.id, { 'Коэффициент ступени': x.coef })); });
            Promise.all(ops).then(function () { return K.log('Схема «' + s.name + '» изменена (версия ' + ver + '): ' + C.formulaText(d).slice(1, 3).join(' ') + ' Основание: ' + reason.value.trim()); })
                .then(function () { K.toast('Правило сохранено, расчёт обновлён'); K.reload(); }).catch(function (e) { K.toast(e.message, true); });
        }, 'kpi-primary')]));
        card.appendChild(K.btn('Изменить правило', function (ev) { form.hidden = !form.hidden; ev.target.textContent = form.hidden ? 'Изменить правило' : 'Скрыть'; if (!form.hidden) check(); }));
        card.appendChild(form);
        return card;
    }
    K.mount(function (host, M) {
        host.appendChild(K.el('div', {}, K.head('Правила премии', 'Формула премии каждой схемы - словами, как в положении о премировании (ст. 135 ТК). Меняется в одном месте: веса, порог, потолок, ступени, учёт оценки и неполного месяца; каждое изменение - в журнал.')));
        if (M.params['Положение о премировании']) host.appendChild(K.el('p', { 'class': 'kpi-muted', text: 'Положение о премировании: ' + M.params['Положение о премировании'] }));
        host.appendChild(K.el('div', { 'class': 'kpi-cards', style: 'grid-template-columns:1fr' }, Object.keys(M.schemes).map(function (n) { return schemeCard(M, M.schemes[n]); })));
        var j = M.journal.filter(function (x) { return /^Схема/.test(x.text); });
        if (j.length) {
            host.appendChild(K.el('h2', { text: 'История правил' }));
            host.appendChild(K.table([{ t: 'Когда', k: 'when' }, { t: 'Кто', k: 'who' }, { t: 'Что изменено', k: 'text' }], j));
        }
    });
})();
