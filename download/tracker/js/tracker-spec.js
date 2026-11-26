/* Спецификация процесса: шаги и переходы как данные, проверка спеки, исключения → предложение правила. */
(function () {
    'use strict';
    var P = window.Trk, C = P.core;
    /* Пары «откуда → куда», которые прошли исключением, — кандидаты в правило. */
    function exceptionPairs(M) {
        var pairs = {}, codes = {};
        M.journal.forEach(function (e) { codes[e.req] = 1; });
        Object.keys(codes).forEach(function (code) {
            var ev = C.chain(M.journal, code).filter(function (e) { return e.kind === 'Шаг' || e.kind === 'Исключение'; });
            for (var i = 1; i < ev.length; i++) if (ev[i].kind === 'Исключение') {
                var k = ev[i - 1].step + '>' + ev[i].step, p = pairs[k] = pairs[k] || { from: ev[i - 1].step, to: ev[i].step, n: 0, reqs: [], why: '' };
                p.n++; p.reqs.push(code); p.why = ev[i].why;
            }
        });
        return Object.keys(pairs).map(function (k) {
            var p = pairs[k];
            p.rule = (M.spec.out[p.from] || []).filter(function (t) { return t.to === p.to && t.st.state !== 'cancelled'; })[0] || null;
            return p;
        }).sort(function (a, b) { return b.n - a.n; });
    }
    P.propose = function (M, from, to, cond, req, why) {
        var code = C.nextCode(M.trans.map(function (t) { return t.code; }), 'ПР-2026-', 3), fromStep = M.spec.by[from];
        var ops = [{ op: 'new', id: 'Переход', up: fromStep.id, fields: { 'Переход': code, 'Следующий шаг': to, 'Условие перехода': cond || '', 'Статус перехода': 'Предложен', 'Заявка': req || '', 'Версия предложения': 1, 'Предложил': M.me.name, 'Обоснование': why || '' } }];
        C.parties(M.spec, from, to, M.depts, M.ba).forEach(function (s) {
            ops.push({ op: 'new', id: 'Голос стороны', up: ':id0', fields: { 'Голос стороны': code + ' / ' + s.side, 'Сторона': s.side, 'Голосующий': s.name, 'Логин голосующего': s.login, 'Решение стороны': 'Ждёт', 'Версия голоса': 1 } });
        });
        return P.post('_m_batch?JSON', { ops: ops }).then(function (r) { if (r && r.failed) throw new Error('Не все записи предложения сохранены'); return code; });
    };
    function proposeDlg(M, p) {
        var cond = P.input('text', '', { placeholder: 'Пусто — всегда; например «Сумма заявки >= 1000000»' }), why = P.input('textarea', p.why || '');
        var sides = C.parties(M.spec, p.from, p.to, M.depts, M.ba);
        P.modal('Предложить правило', P.el('div', {}, [P.el('p', { html: '<b>' + P.esc(p.from + ' → ' + p.to) + '</b> · исключением прошли: ' + P.esc(p.reqs.join(', ')) }), P.field('Условие перехода', cond), P.field('Обоснование', why),
            P.el('p', { 'class': 'trk-muted trk-small', text: 'Стороны одобрения: ' + sides.map(function (s) { return s.side.toLowerCase() + ' — ' + s.name; }).join('; ') + '. Отказа нет: можно согласиться или предложить своё условие.' })]),
        [{ text: 'Отмена' }, { text: 'Отправить сторонам', cls: 'trk-primary', fn: function () {
            if (cond.value.trim() && C.parseCond(cond.value).bad) { P.toast('Условие: «Поле оп значение», например «Сумма заявки >= 1000000»', true); return false; }
            P.run(P.propose(M, p.from, p.to, cond.value.trim(), p.reqs[p.reqs.length - 1], why.value.trim()), 'Предложение отправлено сторонам');
        } }]);
    }
    var ST = { effective: ['действует', 'ok'], scheduled: ['с даты', 'info'], proposed: ['на согласовании', 'warn'], counter: ['контрпредложение', 'warn'], cancelled: ['отменён', 'muted'] };
    P.mount(function (host, M) {
        var issues = C.lint(M.spec), ba = P.isBA();
        host.appendChild(P.el('div', { 'class': 'trk-headrow' }, [P.el('div', {}, P.head('Спецификация процесса', (M.process['Процесс'] || '') + ' · версия ' + (M.process['Версия спеки'] || 1) + ' · владелец ' + (M.process['Владелец процесса'] || '') + '. Шаги и переходы — данные: правятся без разработчика и релиза.')),
            P.el('div', { 'class': 'trk-actions' }, ba ? [P.btn('+ Новый шаг', function () { P.addStep(M); })] : [])]));
        host.appendChild(P.el('div', { 'class': issues.length ? 'trk-alert' : 'trk-okbox' }, [P.el('b', { text: issues.length ? 'Проверка спеки: ' + issues.length : 'Проверка спеки: замечаний нет' })]
            .concat(issues.map(function (i) { return P.el('div', { text: '• ' + i.text }); }))));
        host.appendChild(P.table([
            { t: 'Шаг', html: function (s) { return '<b>' + P.esc(s.name) + '</b>' + (s.start ? ' ' + P.badge('старт', 'info') : '') + (C.isFinal(s) ? ' ' + P.badge('конечный', 'muted') : '') + '<div class="trk-muted trk-small">' + P.esc(s.dept) + '</div>'; } },
            { t: 'Норматив', num: true, html: function (s) { return s.norm ? s.norm + ' ч' : '—'; } },
            { t: 'Переходы', html: function (s) {
                var out = M.spec.out[s.name] || [];
                if (!out.length) return C.isFinal(s) ? '<span class="trk-muted">—</span>' : '<span class="trk-red">нет продолжения</span>';
                return out.map(function (t) { var b = ST[t.st.state] || ['?', 'info']; return '→ <b>' + P.esc(t.to) + '</b>' + (t.cond ? ' <span class="trk-muted">если ' + P.esc(C.condText(t.cond)) + '</span>' : '') + ' ' + P.badge(b[0], b[1]) + (t.code.indexOf('ПР-') === 0 ? ' <span class="trk-muted trk-small">' + P.esc(t.code + (t.st.since ? ', с ' + C.toDmy(t.st.since) : '')) + '</span>' : ''); }).join('<br>');
            } },
            { t: 'Введён', html: function (s) { return P.esc(C.toDmy(s.added) + (s.addedBy ? ' · ' + s.addedBy.split(' ')[0] : '')); } }
        ], M.spec.steps));
        var pairs = exceptionPairs(M);
        host.appendChild(P.el('h2', { text: 'Исключения → правила' }));
        host.appendChild(P.el('p', { 'class': 'trk-sub', text: 'Пути, которыми заявки прошли мимо спецификации. Частое исключение — кандидат в правило: предложение уходит сторонам, и после их согласия следующая такая заявка идёт без исключения.' }));
        host.appendChild(P.table([
            { t: 'Путь', html: function (p) { return '<b>' + P.esc(p.from + ' → ' + p.to) + '</b>'; } }, { t: 'Раз', k: 'n', num: true },
            { t: 'Заявки', html: function (p) { return P.esc(p.reqs.join(', ')); } }, { t: 'Последняя причина', k: 'why' },
            { t: '', html: function (p) { return p.rule ? P.badge(p.rule.code + ': ' + (ST[p.rule.st.state] || ['?'])[0], (ST[p.rule.st.state] || ['', 'info'])[1]) : ''; } }
        ], pairs, { onrow: ba ? function (p) { if (!p.rule) proposeDlg(M, p); else location.href = P.url('approvals'); } : null, empty: 'Исключений нет' }));
    });
})();
