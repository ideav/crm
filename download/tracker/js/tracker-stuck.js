/* Что застряло и почему: отчёт руководителя без ручной сборки, события без продолжения, журнал с компенсацией вместо правки. */
(function () {
    'use strict';
    var P = window.Trk, C = P.core, tab = (location.hash.match(/tab=(\w+)/) || [])[1] || 'stuck';
    function lastWhy(M, q) { var ev = C.chain(M.journal, q.code).filter(function (e) { return e.why; }); var e = ev[ev.length - 1]; return e ? e.why + ' (' + e.author + ', ' + C.toDmy(e.date) + ')' : ''; }
    function compensate(M, e) {
        var why = P.input('textarea', '');
        P.modal('Компенсировать ' + e.code, P.el('div', {}, [P.el('p', { text: e.kind + ' · ' + e.step + ' · ' + e.why }), P.field('Почему запись ошибочна', why),
            P.el('p', { 'class': 'trk-muted trk-small', text: 'Запись журнала не правится и не удаляется: рядом встаёт компенсирующая запись со ссылкой на неё.' })]),
        [{ text: 'Отмена' }, { text: 'Компенсировать', cls: 'trk-primary', fn: function () {
            if (!why.value.trim()) { P.toast('Нужна причина', true); return false; }
            P.run(P.log({ code: e.req }, e.step, 'Компенсация', why.value.trim(), 'Компенсирует ' + e.code), 'Компенсация записана');
        } }]);
    }
    P.mount(function (host, M) {
        var st = C.stuck(M.spec, M.reqs, M.journal, P.TODAY, P.now()), mt = C.metrics(M.journal);
        var unc = st.filter(function (x) { return x.uncertain; }), over = st.filter(function (x) { return x.over; });
        host.appendChild(P.el('div', {}, P.head('Что застряло и почему', 'Срез на ' + C.toDmy(P.TODAY) + ' ' + P.now() + ' собран из журнала: время в шаге, причина последней записи, у кого висит.')));
        host.appendChild(P.el('div', { 'class': 'trk-kpis' }, [P.kpi('Без продолжения', String(unc.length), 'шаг есть, правила нет', unc.length ? 'bad' : 'ok'), P.kpi('Дольше норматива', String(over.length), 'из ' + st.length + ' в работе', over.length ? 'warn' : 'ok'),
            P.kpi('Исключений', mt.excShare + '%', mt.exceptions + ' из ' + mt.moves + ' переходов'), P.kpi('Цикл закрытой заявки', C.fmtHours(mt.cycleAvg), 'в среднем по ' + mt.closed)]));
        var tabs = [['stuck', 'Застряло'], ['unc', 'События без продолжения'], ['steps', 'Время в шагах'], ['journal', 'Журнал']];
        host.appendChild(P.el('div', { 'class': 'trk-tabs', role: 'tablist' }, tabs.map(function (t) {
            return P.el('button', { type: 'button', role: 'tab', 'class': 'trk-tab' + (t[0] === tab ? ' trk-tab-on' : ''), 'aria-selected': String(t[0] === tab), text: t[1], onclick: function () { tab = t[0]; location.hash = 'tab=' + tab; P.refresh(); } });
        })));
        if (tab === 'stuck') host.appendChild(P.table([
            { t: 'Заявка', html: function (x) { return '<b>' + P.esc(x.req.code) + '</b><div class="trk-small">' + P.esc(x.req.title) + '</div>'; } },
            { t: 'Шаг', html: function (x) { return P.esc(x.req.step) + (x.uncertain ? ' ' + P.badge('нет продолжения', 'bad') : ''); } },
            { t: 'В шаге', num: true, html: function (x) { return '<span class="' + (x.over ? 'trk-red' : '') + '">' + P.esc(C.fmtHours(x.hours)) + '</span>'; } },
            { t: 'Норматив', num: true, html: function (x) { return x.norm ? x.norm + ' ч' : '—'; } },
            { t: 'У кого', html: function (x) { return P.esc(x.req.exec || 'очередь шага: ' + ((M.spec.by[x.req.step] || {}).dept || '')); } },
            { t: 'Почему (последняя запись)', html: function (x) { return P.esc(lastWhy(M, x.req)); } }
        ], st.filter(function (x) { return x.over || x.uncertain; }), { onrow: function (x) { P.reqCard(M, x.req); }, empty: 'Ничего не застряло' }));
        if (tab === 'unc') {
            var open = C.detect(M.spec, M.reqs, M.journal);
            host.appendChild(P.el('p', { 'class': 'trk-sub', text: 'Открытые: заявка стоит в шаге, у которого нет действующего продолжения. Пусто — значит, процесс выучил все случаи.' }));
            host.appendChild(P.table([{ t: 'Заявка', html: function (d) { return '<b>' + P.esc(d.req.code) + '</b> ' + P.esc(d.req.title); } }, { t: 'Шаг', html: function (d) { return P.esc(d.step); } },
                { t: 'С', html: function (d) { return P.esc(C.toDmy(d.since.date) + ' ' + d.since.time); } }, { t: 'Детектор', html: function (d) { return d.logged ? P.badge('записано', 'ok') : P.badge('ещё не записано', 'warn'); } }],
                open, { onrow: function (d) { P.reqCard(M, d.req); }, empty: 'Событий без продолжения нет' }));
            host.appendChild(P.el('h2', { text: 'История неопределённостей' }));
            host.appendChild(P.table([{ t: 'Запись', k: 'code' }, { t: 'Когда', html: function (e) { return P.esc(C.toDmy(e.date) + ' ' + e.time); } }, { t: 'Заявка', k: 'req' }, { t: 'Шаг', k: 'step' }, { t: 'Кто', k: 'author' }, { t: 'Что', k: 'why' }],
                M.journal.filter(function (e) { return e.kind === 'Неопределённость'; }).sort(function (a, b) { return b.code.localeCompare(a.code); })));
        }
        if (tab === 'steps') host.appendChild(P.table([{ t: 'Шаг', k: 'name' }, { t: 'Прошло заявок', num: true, html: function (s) { return String((mt.steps[s.name] || {}).n || 0); } },
            { t: 'Среднее время', num: true, html: function (s) { var a = (mt.steps[s.name] || {}).avg || 0; return '<span class="' + (s.norm && a > s.norm ? 'trk-red' : '') + '">' + P.esc(C.fmtHours(a)) + '</span>'; } },
            { t: 'Норматив', num: true, html: function (s) { return s.norm ? s.norm + ' ч' : '—'; } }], M.spec.steps.filter(function (s) { return !C.isFinal(s); })));
        if (tab === 'journal') host.appendChild(P.table([{ t: 'Запись', k: 'code' }, { t: 'Когда', html: function (e) { return P.esc(C.toDmy(e.date) + ' ' + e.time); } }, { t: 'Заявка', k: 'req' },
            { t: 'Вид', html: function (e) { return P.kindBadge(e.kind); } }, { t: 'Шаг', k: 'step' }, { t: 'Автор', k: 'author' }, { t: 'Причина', k: 'why' }, { t: 'Основание', k: 'basis' },
            { t: '', html: function () { return P.isBA() ? '<span class="trk-link">компенсировать</span>' : ''; } }],
            M.journal.slice().sort(function (a, b) { return b.code.localeCompare(a.code); }).slice(0, 120), { onrow: P.isBA() ? function (e) { compensate(M, e); } : null }));
    });
})();
