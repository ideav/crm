/* КЭДО: очередь кадровика «мне сегодня» — отказы, просрочки, эскалации, ошибки передачи в ЗУП. */
(function () {
    'use strict';
    var P = window.Kedo, C = P.core;
    var KIND = { zup: ['Не доехал до ЗУП', 'crit'], refused: ['Отказ', 'crit'], escalate: ['Эскалация', 'crit'], overdue: ['Просрочка', 'warn'], soon: ['Срок сегодня', 'info'] };
    P.mount(function (host, M) {
        var st = { kind: '' };
        function draw() {
            host.innerHTML = '';
            var q = C.queue(M.docs, P.TODAY, M.hol, M.rules);
            P.head('Мне сегодня', 'Очередь кадровика: только то, что требует действия. Ничего не вводится повторно: данные из ЗУП и от оператора уже в реестре.').forEach(function (n) { host.appendChild(n); });
            var cnt = {}; q.forEach(function (i) { cnt[i.kind] = (cnt[i.kind] || 0) + 1; });
            host.appendChild(P.tabs([['', 'Все (' + q.length + ')']].concat(Object.keys(KIND).filter(function (k) { return cnt[k]; }).map(function (k) { return [k, KIND[k][0] + ' (' + cnt[k] + ')']; })), st.kind, function (k) { st.kind = k; draw(); }));
            var list = q.filter(function (i) { return !st.kind || i.kind === st.kind; });
            var retryable = list.filter(function (i) { return i.kind === 'zup' && C.retryOutcome(i.doc).ok; });
            if (retryable.length && P.canWrite('Кадровый документ')) {
                host.appendChild(P.el('div', { 'class': 'kedo-bar' }, [P.btn('Передать повторно всё, что можно (' + retryable.length + ')', function (ev) {
                    ev.target.disabled = true;
                    retryable.reduce(function (p, i) { return p.then(function () { return P.retryZup(i.doc); }); }, Promise.resolve())
                        .then(function () { P.toast('Передано в ЗУП: ' + retryable.length); reload(); }).catch(function (e) { P.toast(e.message, true); reload(); });
                }, 'kedo-primary'), P.el('span', { 'class': 'kedo-muted', text: 'Ошибки ключа («сотрудник не найден») повтор не лечит — они останутся в очереди с подсказкой.' })]));
            }
            if (!list.length) host.appendChild(P.el('div', { 'class': 'kedo-warnbox kedo-g', text: 'Очередь пуста: все документы в срок и в учёте.' }));
            list.forEach(function (i) {
                var d = i.doc, k = KIND[i.kind];
                var acts = P.el('div', { 'class': 'kedo-actions' });
                acts.appendChild(P.btn('Открыть', function () { P.docCard(M, d, reload); }, 'kedo-small'));
                if (i.kind === 'zup' && P.canWrite('Кадровый документ') && C.retryOutcome(d).ok) acts.appendChild(P.btn('Передать повторно', function () { P.retry(d, reload); }, 'kedo-small kedo-primary'));
                if ((i.kind === 'overdue' || i.kind === 'soon') && P.canAct()) acts.appendChild(P.btn('Напомнить', function () { P.remind(d, reload); }, 'kedo-small'));
                if (i.kind === 'escalate' && P.canAct()) acts.appendChild(P.btn('Эскалировать: ' + P.deptHead(M, d.dept), function () { P.escalate(M, d, reload); }, 'kedo-small kedo-danger'));
                if (i.kind === 'refused' && P.canAct()) acts.appendChild(P.btn('Перевести на бумагу', function () {
                    P.addEvent(d, 'Решение кадровика: оформить на бумаге, акт об отказе от электронной подписи', 'Бумага').then(function () { P.resetModel(); P.toast('Записано в историю документа'); reload(); }).catch(function (e) { P.toast(e.message, true); });
                }, 'kedo-small'));
                host.appendChild(P.el('div', { 'class': 'kedo-doc' + (k[1] === 'crit' ? ' kedo-bad' : '') }, [
                    P.el('div', { 'class': 'kedo-doc-h' }, [P.el('div', { html: P.badge(k[0], k[1]) + ' <b>' + P.esc(d.number) + '</b> ' + P.esc(d.type) + ' · ' + P.esc(d.emp) + ' <span class="kedo-muted">(' + P.esc(d.dept) + ')</span>' }), acts]),
                    P.el('div', { 'class': 'kedo-muted', text: i.title + ': ' + i.note + (i.kind === 'zup' && !C.retryOutcome(d).ok ? ' — ' + (C.retryOutcome(d).hint || '') : '') })
                ]));
            });
        }
        function reload() { P.model().then(function (m) { M = m; draw(); }); }
        draw();
    });
})();
