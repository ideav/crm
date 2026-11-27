/* BPM: Интеграции - входящий и исходящий HTTP из шага, журнал вызовов, повтор с затуханием, ошибка без потери заявки. */
(function () {
    'use strict';
    var P = window.Bpm, C = P.core;
    function render(host, M) {
        host.appendChild(P.el('div', {}, P.head('Интеграции', 'Вызовы из шагов процесса: 1С, СЭД, портал поставщиков, почта. Повтор с затуханием 5/20/80 мин; когда попытки кончились, заявка не теряется — встаёт со статусом «Ошибка интеграции» у аналитика.')));
        var byReq = {}; M.calls.forEach(function (c) { (byReq[c.integ + '|' + c.req] = byReq[c.integ + '|' + c.req] || []).push(c); });
        var stat = M.integs.map(function (i) {
            var calls = M.calls.filter(function (c) { return c.integ === i.name; }), groups = Object.keys(byReq).filter(function (k) { return k.indexOf(i.name + '|') === 0; }).map(function (k) { return { req: k.split('|')[1], calls: byReq[k], st: C.callState(byReq[k], i.max || 1) }; });
            return { i: i, calls: calls.length, ok: calls.filter(function (c) { return c.code >= 200 && c.code < 300; }).length, retried: groups.filter(function (g) { return g.calls.length > 1 && g.st.state === 'успех'; }).length, failed: groups.filter(function (g) { return g.st.state === 'исчерпано'; }) };
        });
        host.appendChild(P.table([{ t: 'Интеграция', html: function (s) { return '<b>' + P.esc(s.i.name) + '</b><br><span class="bpm-muted">' + P.esc(s.i.desc) + '</span>'; } }, { t: 'Направление', html: function (s) { return P.badge(s.i.dir, s.i.dir === 'Входящий' ? 'violet' : 'info'); } },
            { t: 'Вызов', html: function (s) { return '<code>' + P.esc(s.i.method + ' ' + s.i.addr) + '</code>' + (s.i.step ? '<br><span class="bpm-muted">шаг «' + P.esc(s.i.step) + '»</span>' : ''); } },
            { t: 'Попыток', num: true, html: function (s) { return s.i.max ? String(s.i.max) : '—'; } }, { t: 'Вызовов', num: true, html: function (s) { return s.calls ? s.ok + ' / ' + s.calls : '—'; } },
            { t: 'Состояние', html: function (s) { return s.failed.length ? P.badge('ошибка: ' + s.failed.map(function (f) { return f.req; }).join(', '), 'crit') : s.retried ? P.badge('успех после повтора: ' + s.retried, 'warn') : s.calls ? P.badge('работает', 'ok') : P.badge('нет вызовов в журнале', 'mute'); } }], stat));
        var fails = []; stat.forEach(function (s) { s.failed.forEach(function (f) { fails.push({ s: s, f: f }); }); });
        fails.forEach(function (x) {
            var r = M.reqBy[x.f.req], last = x.f.calls[x.f.calls.length - 1];
            var can = P.canWrite('Вызов интеграции') && P.canWrite('Заявка') && r && r.status === 'Ошибка интеграции';
            host.appendChild(P.el('div', { 'class': 'bpm-card bpm-bad bpm-failcard' }, [
                P.el('div', { 'class': 'bpm-card-h', html: '<b>' + P.esc(x.f.req) + '</b> ' + (r ? P.statusBadge(r.status) : '') + ' · ' + P.esc(x.s.i.name) }),
                P.el('div', { text: (r ? r.subj + ' · ' + r.cp + ' · ' : '') + 'попыток ' + x.f.calls.length + ' из ' + x.s.i.max + ', последняя ' + P.d(last.date) + ' ' + last.time + ': ' + last.code + ' ' + last.res }),
                P.el('div', { 'class': 'bpm-muted', text: 'Повторы шли через ' + x.f.calls.slice(1).map(function (c, i) { return C.retryDelay(i + 1) + ' мин'; }).join(' и ') + '. Заявка у ' + (r ? P.holderText(M, r) : '—') + '; без решения она не пропадёт и не уйдёт дальше.' }),
                can ? P.el('div', { 'class': 'bpm-bar' }, [P.btn('Повторить вызов', function (ev) { ev.target.disabled = true; retry(M, x.s.i, r, x.f.calls); }, 'bpm-primary'), P.el('span', { 'class': 'bpm-muted', text: 'В демо ответ 1С имитируется: тестовый стенд отвечает 200.' })]) : null
            ]));
        });
        var h = P.hash(), list = M.calls.filter(function (c) { return !h.r || c.req === h.r; }).sort(function (a, b) { return a.date + a.time < b.date + b.time ? 1 : -1; }).slice(0, 60);
        host.appendChild(P.el('h2', { text: 'Журнал вызовов' + (h.r ? ' — ' + h.r : ' (последние 60)') }));
        host.appendChild(P.table([{ t: 'Когда', html: function (c) { return P.d(c.date) + ' ' + P.esc(c.time); } }, { k: 'req', t: 'Заявка' }, { k: 'integ', t: 'Интеграция' }, { k: 'att', t: 'Попытка', num: true }, { t: 'Ответ', html: function (c) { return P.badge(String(c.code), c.code >= 200 && c.code < 300 ? 'ok' : 'crit'); } }, { k: 'res', t: 'Результат' }], list,
            { rowCls: function (c) { return c.code >= 300 ? 'bpm-row-bad' : ''; } }));
        host.appendChild(P.el('h2', { text: 'Входящий вызов: запуск заявки из внешней системы' }));
        host.appendChild(P.el('pre', { 'class': 'bpm-code', text: 'POST https://ideav.ru/' + P.ctx.db + '/_m_new/Заявка?JSON\nX-Authorization: <токен интеграции>\n\nfields={"Заявка":"ЗК-2026-0331","Процесс":"Заявка на закупку","Предмет заявки":"Подшипники 6205",\n        "Сумма заявки":48000,"Инициатор":"portal","Текущий шаг":"Создание заявки на закупку"}' }));
        host.appendChild(P.el('div', { 'class': 'bpm-bar' }, [P.btn('Адаптер Kafka / RabbitMQ', function () { P.option('Адаптер «старый движок ↔ новый» с сохранением внешних контрактов', '3'); }), P.btn('Мониторинг и алерты (OpenTelemetry)', function () { P.option('Единый мониторинг: логи, алерты, дашборды', '3'); }), P.btn('Экспорт истории во внешнюю шину', function () { P.option('История процессов с экспортом в Kafka', '2'); })]));
    }
    function retry(M, integ, r, calls) {
        var att = calls.length + 1, no = P.nextNo(M.calls.map(function (c) { return c.n; }), 'В-', 4), t = P.now(), code = '00-' + (48000 + calls.length * 7);
        var next = C.route(M.spec, r.at, C.attrsOf(r, 'Согласовано')).to || '';
        var evNo = function (k) { var m = 0; M.events.forEach(function (e) { var x = /^Ж-(\d+)$/.exec(e.n); if (x) m = Math.max(m, +x[1]); }); return 'Ж-' + String(m + k).padStart(5, '0'); };
        var ops = [P.NEW('Вызов интеграции', { 'Вызов интеграции': no, 'Интеграция': integ.name, 'Заявка': r.n, 'Дата вызова': M.today, 'Время вызова': t, 'Код ответа': 200, 'Попытка': att, 'Результат вызова': 'код контрагента ' + code + ' (ручной повтор)' }),
            P.NEW('Событие журнала', { 'Событие журнала': evNo(1), 'Заявка': r.n, 'Дата события': M.today, 'Время события': t, 'Код события': 'Вызов интеграции', 'Шаг процесса': r.at, 'Автор события': P.ctx.user, 'Причина события': integ.name + ': ручной повтор, попытка ' + att + ', ответ 200 — код контрагента ' + code, 'Инициатор заявки': r.init })];
        if (next) {
            var end = C.isEnd(M.spec, next);
            ops.push(P.SET(r.id, { 'Текущий шаг': next, 'Текущий исполнитель': end ? '' : P.execOf(next, r), 'Статус заявки': end ? 'Завершена' : 'В работе', 'Вошла в шаг': M.today, 'Завершена': end ? M.today : '' }));
            ops.push(P.NEW('Событие журнала', { 'Событие журнала': evNo(2), 'Заявка': r.n, 'Дата события': M.today, 'Время события': t, 'Код события': 'Переход', 'Шаг процесса': r.at, 'В шаг': next, 'Автор события': 'система', 'Причина события': 'Ответ интеграции получен', 'Инициатор заявки': r.init }));
        }
        P.batch(ops).then(function () { P.toast(r.n + ': вызов прошёл' + (next ? ', заявка → «' + next + '»' : '')); P.rerender(render); }).catch(function (e) { P.toast(e.message, true); });
    }
    P.mount(render);
})();
