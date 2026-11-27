/* BPM: Заявки - первый клик демо. Где застряло и почему, все заявки, запуск новой заявки инициатором. */
(function () {
    'use strict';
    var P = window.Bpm, C = P.core;
    var state = { proc: '', status: 'open', q: '' };
    function render(host, M) {
        var mine = !M.isOwner && !P.canRead('Неопределённость');
        host.appendChild(P.el('div', {}, P.head(mine ? 'Мои заявки' : 'Заявки', mine ? 'Где заявка, у кого и сколько стоит. История каждой заявки — в журнале.' : 'Заявки на согласование договоров и закупок. Вверху — где застряло и почему: неопределённость, отсутствующий исполнитель, ошибка интеграции.')));
        var open = M.reqs.filter(function (r) { return !r.done; });
        var stuck = open.map(function (r) { return { r: r, why: C.stuckReasons(r, M.ctx) }; }).filter(function (x) { return x.why.length; });
        var rank = { uncertainty: 0, integration: 1, absent: 2, overdue: 3 };
        stuck.sort(function (a, b) { return rank[a.why[0].kind] - rank[b.why[0].kind] || b.why[0].age - a.why[0].age; });
        var doneDg = M.reqs.filter(function (r) { return r.done && r.status === 'Завершена' && /^ДГ/.test(r.n); });
        var avg = doneDg.length ? doneDg.reduce(function (s, r) { return s + C.workDays(r.start, r.done, M.hol); }, 0) / doneDg.length : 0;
        var offs = M.events.filter(function (e) { return e.code === 'Ручной перевод'; }).length;
        var cnt = function (k) { return stuck.filter(function (x) { return x.why.some(function (w) { return w.kind === k; }); }).length; };
        host.appendChild(P.el('div', { 'class': 'bpm-kpis' }, [
            P.kpi('В работе', String(open.length), M.reqs.length + ' за сентябрь–ноябрь'),
            P.kpi('Ждут решения', String(cnt('uncertainty')), 'у шага нет продолжения', cnt('uncertainty') ? 'bad' : ''),
            P.kpi('Висят у отсутствующих', String(cnt('absent')), 'отпуск без замещения', cnt('absent') ? 'warn' : ''),
            P.kpi('Ошибка интеграции', String(cnt('integration')), 'попытки исчерпаны', cnt('integration') ? 'bad' : ''),
            mine ? null : P.kpi('Решали в мессенджере', String(offs), 'ручные переводы вне спецификации за квартал', offs ? 'warn' : ''),
            P.kpi('Срок согласования договора', P.fmt(avg, 1) + ' дн.', 'среднее по ' + doneDg.length + ' завершённым, регламент 7')
        ]));
        var hard = stuck.filter(function (x) { return x.why[0].kind !== 'overdue'; }), soft = stuck.filter(function (x) { return x.why[0].kind === 'overdue'; });
        if (stuck.length) {
            host.appendChild(P.el('h2', { text: 'Где застряло' }));
            host.appendChild(P.el('div', { 'class': 'bpm-cards' }, hard.map(function (x) {
                var r = x.r, w = x.why[0];
                return P.el('div', { 'class': 'bpm-card bpm-click' + (w.kind === 'uncertainty' || w.kind === 'integration' ? ' bpm-bad' : ' bpm-warncard'), tabindex: '0', role: 'button', onclick: function () { open1(r); }, onkeydown: function (e) { if (e.key === 'Enter') open1(r); } }, [
                    P.el('div', { 'class': 'bpm-card-h', html: '<b>' + P.esc(r.n) + '</b> ' + P.statusBadge(r.status) }),
                    P.el('div', { text: r.subj + ' · ' + r.cp }),
                    P.el('div', { 'class': 'bpm-muted', text: r.at + ' · ' + P.holderText(M, r) + ' · ' + w.age + ' раб. дн.' }),
                    P.el('ul', { 'class': 'bpm-why' }, x.why.map(function (y) { return P.el('li', { text: y.text }); })),
                    w.kind === 'uncertainty' ? P.el('div', { 'class': 'bpm-cta', text: 'Открыть: варианты по похожим случаям →' }) : null
                ]);
            })));
            if (soft.length) host.appendChild(P.el('p', { 'class': 'bpm-muted', html: 'Дольше нормы шага: ' + soft.map(function (x) { return '<a href="#r=' + encodeURIComponent(x.r.n) + '" data-r="' + P.esc(x.r.n) + '">' + P.esc(x.r.n) + '</a> (' + P.esc(x.r.at) + ', ' + x.why[0].age + ' дн.)'; }).join(', '), onclick: function (e) { var a = e.target.closest('a[data-r]'); if (a) { e.preventDefault(); open1(M.reqBy[a.getAttribute('data-r')]); } } }));
        }
        var bar = P.el('div', { 'class': 'bpm-bar' });
        var ps = P.select([['', 'Все процессы']].concat(M.procs.map(function (p) { return [p.name, p.name]; })), state.proc);
        var ss = P.select([['open', 'В работе'], ['', 'Все'], ['Завершена', 'Завершённые'], ['Отклонена', 'Отклонённые']], state.status);
        var q = P.input('text', state.q, { placeholder: 'Номер, предмет, контрагент' });
        ps.onchange = function () { state.proc = ps.value; draw(); }; ss.onchange = function () { state.status = ss.value; draw(); }; q.oninput = function () { state.q = q.value; draw(); };
        bar.appendChild(P.field('Процесс', ps)); bar.appendChild(P.field('Статус', ss)); bar.appendChild(P.el('div', { 'class': 'bpm-grow' }, [P.field('Поиск', q)]));
        if (P.canWrite('Заявка') && P.canWrite('Событие журнала')) bar.appendChild(P.btn('Новая заявка на договор', function () { newReq(M); }, 'bpm-primary'));
        bar.appendChild(P.btn('CSV', function () { P.download('zayavki.csv', C.toCsv(list(), [{ k: 'n', t: 'Заявка' }, { k: 'proc', t: 'Процесс' }, { k: 'subj', t: 'Предмет' }, { k: 'cp', t: 'Контрагент' }, { k: 'sum', t: 'Сумма' }, { k: 'cur', t: 'Валюта' }, { k: 'at', t: 'Шаг' }, { k: 'status', t: 'Статус' }])); }));
        host.appendChild(P.el('h2', { text: 'Все заявки' }));
        host.appendChild(bar);
        var wrap = P.el('div'); host.appendChild(wrap);
        function list() {
            var s = state.q.trim().toLowerCase();
            return M.reqs.filter(function (r) {
                if (state.proc && r.proc !== state.proc) return false;
                if (state.status === 'open' && r.done) return false;
                if (state.status && state.status !== 'open' && r.status !== state.status) return false;
                return !s || (r.n + ' ' + r.subj + ' ' + r.cp).toLowerCase().indexOf(s) >= 0;
            });
        }
        function draw() {
            wrap.innerHTML = '';
            wrap.appendChild(P.table([
                { k: 'n', t: 'Заявка', html: function (r) { return '<b>' + P.esc(r.n) + '</b>'; } },
                { k: 'subj', t: 'Предмет', html: function (r) { return P.esc(r.subj) + '<br><span class="bpm-muted">' + P.esc(r.cp) + (r.nonres ? ' · нерезидент' : '') + '</span>'; } },
                { t: 'Сумма', num: true, html: function (r) { return P.esc(P.money(r.sum, r.cur)); } },
                { t: 'Где сейчас', html: function (r) { return r.done ? P.esc(r.at) + '<br><span class="bpm-muted">' + P.d(r.done) + '</span>' : P.esc(r.at) + '<br><span class="bpm-muted">' + P.esc(P.holderText(M, r)) + '</span>'; } },
                { t: 'На шаге', num: true, html: function (r) { return r.done ? '' : C.workDays(r.entered, M.today, M.hol) + ' дн.'; } },
                { t: 'Статус', html: function (r) { return P.statusBadge(r.status); } }
            ], list(), { onrow: open1, rowCls: function (r) { return r.status === 'Ждёт решения' || r.status === 'Ошибка интеграции' ? 'bpm-row-bad' : ''; }, empty: 'Заявок нет' }));
        }
        draw();
        var h = P.hash(); if (h.r && M.reqBy[h.r]) open1(M.reqBy[h.r]);
    }
    function open1(r) { P.openReq(r, function () { P.rerender(render); }); }
    /* Запуск заявки инициатором: шаг «Регистрация договора», дальше - «Мои задачи». */
    function newReq(M) {
        var proc = 'Согласование договора', no = P.nextNo(M.reqs.map(function (r) { return r.n; }), 'ДГ-2026-', 4);
        var subj = P.input('text', ''), cp = P.input('text', ''), sum = P.input('number', ''), cur = P.select(['RUB', 'CNY', 'USD', 'EUR'], 'RUB'), kind = P.select(['Поставка', 'Услуги', 'Подряд'], 'Поставка'), nr = P.el('input', { type: 'checkbox' });
        var body = P.el('div', {}, [P.el('p', { 'class': 'bpm-muted', text: 'Номер ' + no + '. Заявка встанет на шаг «Регистрация договора» у вас; отправьте её на согласование из «Мои задачи».' }),
            P.field('Предмет договора', subj), P.field('Контрагент', cp), P.el('div', { 'class': 'bpm-grid2' }, [P.field('Сумма', sum), P.field('Валюта', cur)]), P.field('Вид договора', kind), P.el('label', { 'class': 'bpm-check' }, [nr, ' Контрагент — нерезидент'])]);
        P.modal('Новая заявка на договор', body, [{ text: 'Отмена' }, { text: 'Создать', cls: 'bpm-primary', keep: true, fn: function (close) {
            if (!subj.value.trim() || !cp.value.trim() || !(C.num(sum.value) > 0)) { P.toast('Заполните предмет, контрагента и сумму', true); return false; }
            var start = M.stepList.filter(function (s) { return s.proc === proc && s.start; })[0];
            P.batch([P.NEW('Заявка', { 'Заявка': no, 'Процесс': proc, 'Предмет заявки': subj.value.trim(), 'Контрагент': cp.value.trim(), 'Сумма заявки': C.num(sum.value), 'Валюта': cur.value, 'Нерезидент': nr.checked ? 1 : '', 'Вид договора': kind.value, 'Инициатор': P.ctx.user, 'Текущий шаг': start.name, 'Текущий исполнитель': P.ctx.user, 'Статус заявки': 'В работе', 'Дата запуска': M.today, 'Вошла в шаг': M.today, 'Срок заявки': C.addWork(M.today, M.procBy[proc].days, M.hol) }),
                P.NEW('Событие журнала', { 'Событие журнала': P.nextNo(M.events.map(function (e) { return e.n; }), 'Ж-', 5), 'Заявка': no, 'Дата события': M.today, 'Время события': P.now(), 'Код события': 'Запуск', 'Шаг процесса': start.name, 'Автор события': P.ctx.user, 'Причина события': 'Заявка создана: ' + subj.value.trim(), 'Инициатор заявки': P.ctx.user })])
                .then(function () { close(); P.toast('Заявка ' + no + ' создана'); P.rerender(render); }).catch(function (e) { P.toast(e.message, true); });
            return false;
        } }]);
    }
    P.mount(render);
})();
