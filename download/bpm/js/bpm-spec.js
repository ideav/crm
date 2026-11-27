/* BPM: Спецификация процесса - шаги, переходы с условиями, проверка (недостижимые, в никуда, тупики, нет продолжения). */
(function () {
    'use strict';
    var P = window.Bpm, C = P.core;
    var state = { proc: 'Согласование договора' };
    var KIND = { dangling: 'crit', gap: 'crit', unreachable: 'warn', deadEnd: 'crit', ambiguous: 'warn', noEnd: 'crit' };
    var KNAME = { dangling: 'переход в никуда', gap: 'нет продолжения', unreachable: 'недостижимый', deadEnd: 'тупик', ambiguous: 'неоднозначно', noEnd: 'нет конца' };
    function render(host, M) {
        var pr = M.procBy[state.proc] || M.procs[0]; state.proc = pr.name;
        host.appendChild(P.el('div', {}, P.head('Спецификация', 'Процесс как данные: шаги, переходы и условия. Правка — без выкладки и перезапуска; проверка показывает дыры до того, как в них упадёт заявка.')));
        var ps = P.select(M.procs.map(function (p) { return [p.name, p.name + ' (v' + p.version + ')']; }), state.proc);
        ps.onchange = function () { state.proc = ps.value; host.innerHTML = ''; render(host, M); };
        var edit = P.canWrite('Переход');
        host.appendChild(P.el('div', { 'class': 'bpm-bar' }, [P.field('Процесс', ps), P.el('div', { 'class': 'bpm-grow', html: '<div class="bpm-muted">' + P.esc(pr.desc) + '<br>Владелец: ' + P.esc(P.who(pr.owner)) + ' · регламент ' + pr.days + ' раб. дн. · версия ' + pr.version + '</div>' }),
            edit ? P.btn('Добавить переход', function () { trForm(M, null); }) : null, P.btn('Импорт BPMN/DMN', function () { P.option('Импорт BPMN в шаги и переходы, DMN в таблицу правил', '12–16 и 10–14'); })]));
        var issues = C.lint(M.spec, state.proc);
        host.appendChild(P.el('h2', { text: 'Проверка спецификации' + (issues.length ? ' — ' + issues.length : ': замечаний нет') }));
        if (issues.length) host.appendChild(P.el('ul', { 'class': 'bpm-lint' }, issues.map(function (i) { return P.el('li', { html: P.badge(KNAME[i.kind], KIND[i.kind]) + ' ' + P.esc(i.text) }); })));
        var steps = M.stepList.filter(function (s) { return s.proc === state.proc; });
        var integBy = {}; M.integs.forEach(function (i) { if (i.step) (integBy[i.step] = integBy[i.step] || []).push(i.name); });
        host.appendChild(P.el('h2', { text: 'Шаги и события' }));
        host.appendChild(P.table([{ k: 'order', t: '№', num: true }, { t: 'Шаг', html: function (s) { return '<b>' + P.esc(s.name) + '</b>' + (s.start ? ' ' + P.badge('начало', 'info') : ''); } }, { t: 'Вид', html: function (s) { return P.badge(s.kind, s.kind === 'Конечное' ? 'mute' : 'info'); } },
            { t: 'Исполнитель', html: function (s) { return P.esc(s.exec === 'Инициатор' ? 'инициатор заявки' : s.kind === 'Конечное' ? '' : P.who(s.exec)); } }, { t: 'Норма', num: true, html: function (s) { return s.norm ? s.norm + ' ч' : ''; } },
            { t: 'Форма шага', html: function (s) { return P.esc(s.form || ''); } }, { t: 'Интеграция', html: function (s) { return (integBy[s.name] || []).map(P.esc).join('<br>'); } }], steps));
        var trs = M.spec.transitions.filter(function (t) { return t.proc === state.proc; }).sort(function (a, b) { var oa = (M.spec.steps[a.from] || {}).order || 0, ob = (M.spec.steps[b.from] || {}).order || 0; return oa - ob; });
        host.appendChild(P.el('h2', { text: 'Переходы' }));
        host.appendChild(P.table([{ t: 'Из шага', html: function (t) { return P.esc(t.from); } }, { t: 'В шаг', html: function (t) { return M.spec.steps[t.to] ? '<b>' + P.esc(t.to) + '</b>' : '<b class="bpm-red">' + P.esc(t.to) + '</b> ' + P.badge('нет такого шага', 'crit'); } },
            { t: 'Условие', html: function (t) { return t.cond ? '<code>' + P.esc(t.cond) + '</code>' : '<span class="bpm-muted">всегда</span>'; } },
            { t: 'Источник', html: function (t) { return /^Правка/.test(t.source || '') ? P.badge(t.source, 'violet') + ' <span class="bpm-muted">с ' + P.d(t.since) + '</span>' : P.esc(t.source || ''); } }], trs,
            { onrow: edit ? function (t) { trForm(M, t); } : null, rowCls: function (t) { return /^Правка/.test(t.source || '') ? 'bpm-row-new' : ''; } }));
        host.appendChild(P.el('p', { 'class': 'bpm-muted', text: 'Условие — строка вида «Решение = Согласовано и Сумма > 3000000». Поля: Решение, Нерезидент (да/нет), Валюта, Сумма, Вид договора. Операции: =, ≠, >, <, >=, <=.' }));
    }
    function trForm(M, t) {
        var steps = M.stepList.filter(function (s) { return s.proc === state.proc; }).map(function (s) { return [s.name, s.name]; });
        var from = P.select(steps, t ? t.from : steps[0][0]), to = P.select(steps, t ? t.to : steps[1][0]), cond = P.input('text', t ? t.cond : 'Решение = Согласовано');
        var chk = P.el('div', { 'class': 'bpm-warnbox' });
        function check() { var bad = C.parseCond(cond.value).filter(function (c) { return c.op === '?'; }); chk.className = 'bpm-warnbox ' + (bad.length ? 'bpm-e' : 'bpm-g'); chk.textContent = bad.length ? 'Не разобрано: «' + bad[0].field + '» — нужен оператор (=, ≠, >, <, >=, <=)' : 'Условие разобрано: ' + C.parseCond(cond.value).length + ' частей'; }
        cond.oninput = check; check();
        P.modal(t ? 'Переход ' + t.name : 'Новый переход', P.el('div', {}, [P.field('Из шага', from), P.field('В шаг', to), P.field('Условие', cond), chk]), [{ text: 'Отмена' }, { text: 'Сохранить', cls: 'bpm-primary', keep: true, fn: function (close) {
            if (C.parseCond(cond.value).some(function (c) { return c.op === '?'; })) { P.toast('Условие не разобрано', true); return false; }
            var f = { 'Из шага': from.value, 'В шаг': to.value, 'Условие перехода': cond.value.trim() };
            var op = t ? P.SET(t.id, f) : P.NEW('Переход', Object.assign({ 'Переход': from.value + ' → ' + to.value, 'Процесс': state.proc, 'Источник перехода': 'Аналитик ' + P.ctx.user, 'Действует с': M.today }, f));
            P.batch([op]).then(function () { close(); P.toast('Спецификация сохранена'); P.rerender(render); }).catch(function (e) { P.toast(e.message, true); });
            return false;
        } }]);
    }
    P.mount(render);
})();
