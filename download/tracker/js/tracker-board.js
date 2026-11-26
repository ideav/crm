/* Живая доска процесса: колонки = шаги спецификации, карточка = «почему она здесь», шаг без продолжения подсвечен. */
(function () {
    'use strict';
    var P = window.Trk, C = P.core;
    /* Бизнес-администратор ставит заявку в любой шаг (исключение с причиной). */
    P.placeReq = function (M, req) {
        var to = P.select(M.spec.steps.filter(function (s) { return s.name !== req.step; }).map(function (s) { return s.name; })), why = P.input('textarea', '');
        P.modal('Переместить ' + req.code, P.el('div', {}, [P.reqHead(req), P.field('В шаг', to), P.field('Причина', why)]), [{ text: 'Отмена' }, { text: 'Переместить', cls: 'trk-primary', fn: function () {
            P.run(P.move(req, to.value, why.value.trim()), 'Заявка в шаге «' + to.value + '»');
        } }]);
    };
    P.runDetector = function (M) {
        var todo = C.detect(M.spec, M.reqs, M.journal).filter(function (d) { return !d.logged; });
        if (!todo.length) { P.toast('Детектор: новых неопределённостей нет'); return; }
        var chainP = Promise.resolve(), n = 0;
        todo.forEach(function (d) {
            chainP = chainP.then(function () {
                var code = C.nextCode(M.journal.map(function (e) { return e.code; }), 'Ж-', 4); M.journal.push({ code: code });
                n++;
                return P.create('Событие журнала', { 'Событие журнала': code, 'Заявка': d.req.code, 'Шаг процесса': d.step, 'Вид записи': 'Неопределённость', 'Дата события': P.TODAY, 'Время события': P.now(),
                    'Автор': 'детектор живой спеки', 'Логин автора': 'detector', 'Причина': 'У шага «' + d.step + '» нет продолжения в спецификации: заявка встала, куда дальше — не определено', 'Основание': 'spec.uncertainty', 'Версия правил': C.num(M.process['Версия спеки']) || 1 });
            });
        });
        P.run(chainP, 'Детектор: записано неопределённостей — ' + todo.length);
    };
    function card(M, q, hours) {
        var s = M.spec.by[q.step], unc = C.isUncertain(M.spec, q), over = s && s.norm > 0 && hours > s.norm;
        var el = P.el('div', { 'class': 'trk-card' + (unc ? ' trk-card-unc' : over ? ' trk-card-over' : '') + (q.login === P.ctx.user ? ' trk-card-mine' : ''), tabindex: '0', role: 'button', 'data-code': q.code,
            html: '<div class="trk-card-h"><b>' + P.esc(q.code.replace('ЗС-2026-', '№')) + '</b><span>' + P.esc(C.money(q.sum)) + '</span></div><div class="trk-card-t">' + P.esc(q.title) + '</div>' +
                '<div class="trk-card-f"><span>' + P.esc(q.exec || 'в очереди шага') + '</span><span class="' + (over ? 'trk-red' : 'trk-muted') + '">' + P.esc(C.fmtHours(hours)) + '</span></div>' +
                (unc ? '<div class="trk-card-q">нет продолжения — куда дальше?</div>' : '') });
        el.addEventListener('click', function () { openCard(M, q); });
        el.addEventListener('keydown', function (e) { if (e.key === 'Enter') openCard(M, q); });
        return el;
    }
    function openCard(M, q) {
        P.reqCard(M, q);
        if (P.isBA()) { var foot = document.querySelector('.trk-modal-foot'); if (foot) foot.insertBefore(P.btn('Переместить…', function () { document.querySelector('.trk-modal-back').remove(); P.placeReq(M, q); }), foot.firstChild); }
    }
    P.mount(function (host, M) {
        var now = P.now(), st = C.stuck(M.spec, M.reqs, M.journal, P.TODAY, now), hrs = {};
        st.forEach(function (x) { hrs[x.req.code] = x.hours; });
        var unc = st.filter(function (x) { return x.uncertain; }), over = st.filter(function (x) { return x.over && !x.uncertain; }), mt = C.metrics(M.journal);
        host.appendChild(P.el('div', { 'class': 'trk-headrow' }, [P.el('div', {}, P.head('Живая доска: ' + (M.process['Процесс'] || ''), 'Колонки — шаги спецификации v' + (M.process['Версия спеки'] || 1) + '. Клик по заявке — цепочка «почему она здесь».')),
            P.el('div', { 'class': 'trk-actions' }, P.isBA() ? [P.btn('+ Новый шаг', function () { P.addStep(M); }), P.btn('Проверить процесс', function () { P.runDetector(M); })] : [])]));
        host.appendChild(P.el('div', { 'class': 'trk-kpis' }, [P.kpi('В работе', String(st.length)), P.kpi('Без продолжения', String(unc.length), 'шаг есть, правила дальше нет', unc.length ? 'bad' : 'ok'),
            P.kpi('Дольше норматива', String(over.length), 'время в шаге > норматива', over.length ? 'warn' : 'ok'), P.kpi('Исключений', mt.excShare + '%', mt.exceptions + ' из ' + mt.moves + ' переходов')]));
        if (unc.length) host.appendChild(P.el('div', { 'class': 'trk-alert trk-banner' }, [P.el('span', { text: 'Неопределённость: ' + unc.map(function (x) { return x.req.code + ' в «' + x.req.step + '»'; }).join(', ') + '. У шага нет продолжения — система спрашивает, куда дальше.' }),
            P.btn('Куда дальше?', function () { var q = unc[0].req; if (q.login === P.ctx.user || P.isBA()) P.whereNext(M, q); else openCard(M, q); }, 'trk-primary')]));
        var cols = M.spec.steps.map(function (s) {
            var items = M.reqs.filter(function (q) { return q.step === s.name; });
            var fin = C.isFinal(s), shown = fin ? items.slice(-3) : items;
            var dead = !fin && !C.effectiveOut(M.spec, s.name).length;
            return P.el('section', { 'class': 'trk-col' + (fin ? ' trk-col-fin' : '') + (dead ? ' trk-col-dead' : '') }, [
                P.el('header', { html: '<b>' + P.esc(s.name) + '</b> <span class="trk-count">' + items.length + '</span>' + (s.added >= '2026-11-20' ? ' ' + P.badge('новый', 'warn') : '') +
                    '<div class="trk-muted trk-small">' + P.esc(s.dept + (s.norm ? ' · норматив ' + s.norm + ' ч' : '')) + '</div>' + (dead ? '<div class="trk-red trk-small">нет продолжения в спеке</div>' : '') })]
                .concat(shown.map(function (q) { return card(M, q, hrs[q.code] || 0); })).concat(fin && items.length > 3 ? [P.el('div', { 'class': 'trk-muted trk-small', text: 'и ещё ' + (items.length - 3) }) ] : []));
        });
        host.appendChild(P.el('div', { 'class': 'trk-board' }, cols));
    });
})();
