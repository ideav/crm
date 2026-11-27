/* MDM: Заявки НСИ. Очередь со сроком (SLA) вместо писем: создать, изменить, объединить, заблокировать. Инициатор видит свои заявки, служба НСИ - все. */
(function () {
    'use strict';
    var P = window.Mdm, C = P.core;
    var flt = 'open';

    function render(host, M) {
        host.innerHTML = '';
        var nsi = P.canWrite('Номенклатура');
        P.head('Заявки НСИ', nsi ? 'Очередь службы НСИ. Срок заявки - ' + M.params.slaDays + ' раб. дн. При разборе система сама показывает похожие записи: дубль отклоняется со ссылкой на существующую позицию.' : 'Ваши заявки в службу НСИ и их статус. Новую позицию заводите на экране «Новая позиция».').forEach(function (e) { host.appendChild(e); });
        var open = M.reqs.filter(function (r) { return r.status === 'Новая' || r.status === 'На проверке НСИ'; });
        var late = open.filter(function (r) { return C.slaState(r, P.TODAY).state === 'late'; });
        var today = open.filter(function (r) { return C.slaState(r, P.TODAY).state === 'today'; });
        host.appendChild(P.el('div', { 'class': 'mdm-kpis' }, [P.kpi('В работе', String(open.length)), P.kpi('Просрочено', String(late.length), 'срок прошёл', late.length ? 'bad' : 'good'), P.kpi('Срок сегодня', String(today.length), '', today.length ? 'warn' : ''),
            P.kpi('Время заведения', String(C.entryDays(M.reqs)).replace('.', ',') + ' дн.', 'среднее, рабочих дней от заявки до кода НСИ')]));
        host.appendChild(P.tabs([['open', 'В работе'], ['all', 'Все'], ['done', 'Закрытые']], flt, function (k) { flt = k; render(host, M); }));
        var rows = M.reqs.filter(function (r) { var o = r.status === 'Новая' || r.status === 'На проверке НСИ'; return flt === 'all' || (flt === 'open' ? o : !o); }).sort(function (a, b) { return a.due < b.due ? -1 : 1; });
        host.appendChild(P.table([
            { t: '№', html: function (r) { return '<b>' + P.esc(r.no) + '</b>'; } },
            { t: 'Вид', html: function (r) { return P.esc(r.kind) + '<div class="mdm-muted">' + P.esc(r.dict) + '</div>'; } },
            { t: 'Что', html: function (r) { return P.esc(r.name) + (r.similar ? '<div class="mdm-muted">похожие: ' + P.esc(r.similar) + '</div>' : ''); } },
            { t: 'Инициатор', k: 'author' },
            { t: 'Подана', html: function (r) { return C.ruDate(r.date); } },
            { t: 'Срок', html: function (r) { var s = C.slaState(r, P.TODAY); return C.ruDate(r.due) + '<div>' + (s.state === 'late' ? P.badge('просрочена на ' + -s.days + ' дн.', 'crit') : s.state === 'today' ? P.badge('сегодня', 'warn') : s.state === 'done' ? (s.late ? P.badge('закрыта с опозданием', 'warn') : '') : P.badge('осталось ' + s.days + ' дн.', 'info')) + '</div>'; } },
            { t: 'Статус', html: function (r) { return P.statusBadge(r.status) + (r.result ? '<div class="mdm-muted">' + P.esc(r.result) + '</div>' : ''); } }
        ], rows, { onrow: function (r) { openReq(host, M, r); }, rowCls: function (r) { return C.slaState(r, P.TODAY).state === 'late' ? 'mdm-row-bad' : ''; }, empty: 'Заявок нет' }));
    }
    function draftOf(r) { return r.dict === P.KON ? { name: r.name, 'ИНН': r.inn } : { name: r.name, 'Артикул': r.art, 'Бренд': r.brand }; }
    function openReq(host, M, r) {
        var dict = r.dict === P.KON ? P.KON : P.NOM, nsi = P.canWrite(dict) && P.canWrite('Заявка НСИ');
        var sim = r.kind === 'Создать' ? C.similarTo(draftOf(r), P.list(M, dict), M.rules[dict], dict, M.params.hintThreshold, 5) : [];
        var body = P.el('div', {}, [
            P.el('p', { html: P.statusBadge(r.status) + ' <b>' + P.esc(r.kind) + '</b> · ' + P.esc(r.dict) + ' · от ' + P.esc(r.author) + ', ' + C.ruDate(r.date) + ', срок ' + C.ruDate(r.due) }),
            P.el('p', { html: '<b>' + P.esc(r.name) + '</b>' + [r.art ? 'арт. ' + r.art : '', r.brand, r.inn ? 'ИНН ' + r.inn : '', r.group].filter(Boolean).map(function (x) { return ' · ' + P.esc(x); }).join('') }),
            r.inn && !C.validInn(r.inn) ? P.el('div', { 'class': 'mdm-warnbox mdm-e', text: 'ИНН не прошёл проверку контрольной суммы.' }) : null,
            r.note ? P.el('p', { 'class': 'mdm-muted', text: r.note }) : null
        ]);
        if (sim.length) body.appendChild(P.el('div', { 'class': 'mdm-hint' + (sim[0].score >= M.params.dupThreshold ? ' mdm-hint-hard' : '') }, [P.el('h3', { text: 'Похожие записи в справочнике' })].concat(sim.map(function (x) { return P.el('div', { 'class': 'mdm-hint-row' }, [P.el('div', { html: P.scoreBadge(x.score, M.params.dupThreshold) }), P.el('div', { html: P.recLine(x.rec) + '<div class="mdm-why">' + P.esc(x.reason) + '</div>' })]); }))));
        else if (r.kind === 'Создать') body.appendChild(P.el('div', { 'class': 'mdm-warnbox mdm-g', text: 'Похожих записей нет - можно заводить.' }));
        var openSt = r.status === 'Новая' || r.status === 'На проверке НСИ';
        var act = function (fn, msg) { return function (close) { fn().then(function () { close(); P.toast(msg); P.rerender(render); }).catch(function (e) { P.toast(e.message, true); }); return false; }; };
        var done = function (result, status, note) { var f = { 'Статус заявки': status, 'Исполнитель заявки': P.ctx.user, 'Результат заявки': result, 'Дата выполнения': P.TODAY }; if (note) f['Комментарий НСИ'] = note; return P.update(r.id, f); };
        P.modal('Заявка ' + r.no, body, [
            { text: 'Закрыть' },
            nsi && r.status === 'Новая' ? { text: 'Взять в работу', fn: act(function () { return P.update(r.id, { 'Статус заявки': 'На проверке НСИ', 'Исполнитель заявки': P.ctx.user }); }, 'Заявка в работе') } : null,
            nsi && openSt && sim.length ? { text: 'Отклонить: есть ' + sim[0].rec.code, fn: act(function () { return done('Есть: ' + sim[0].rec.code, 'Отклонена', 'Позиция уже есть в справочнике: ' + sim[0].rec.name); }, 'Отклонено как дубль') } : null,
            nsi && openSt && r.kind === 'Создать' ? { text: 'Завести и закрыть', cls: 'mdm-primary', fn: act(function () { return createFrom(M, r, dict).then(function (code) { return done(code, 'Выполнена'); }); }, 'Позиция заведена, заявка закрыта') } : null,
            nsi && openSt && r.kind !== 'Создать' ? { text: 'Выполнено', cls: 'mdm-primary', fn: act(function () { return done(r.kind === 'Объединить' ? 'см. журнал слияний' : 'выполнено', 'Выполнена'); }, 'Заявка закрыта') } : null,
            nsi && openSt && r.kind === 'Объединить' ? { text: 'К поиску дублей', fn: function () { location.href = P.nav('dubli', 'kind=' + (dict === P.KON ? 'kon' : 'nom') + '&run=1'); } } : null
        ], true);
    }
    function createFrom(M, r, dict) {
        var list = P.list(M, dict), code = P.nextNo(list.map(function (x) { return x.code; }), dict === P.KON ? 'НСИ-К' : 'НСИ-', dict === P.KON ? 5 : 6);
        var f = { 'Код НСИ': code, 'Источник': M.systems[0] ? M.systems[0].name : '', 'Статус записи': 'Эталон', 'Дата заведения': P.TODAY, 'Кем заведена': P.ctx.user + ' по заявке ' + r.no, 'Число документов': 0 };
        f[dict] = r.name;
        if (dict === P.NOM) { f['Артикул'] = r.art; f['Бренд'] = r.brand; if (r.group) f['Группа номенклатуры'] = r.group; } else f['ИНН'] = r.inn;
        return P.create(dict, f).then(function () { return code; });
    }
    P.mount(render);
})();
