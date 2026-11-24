/* FSM: экран «Дашборд руководителя». Все показатели считаются одной функцией compute() поверх Fsm.core.kpi/weekly/slaState. */
(function () {
    'use strict';
    var W = window.Fsm, C = W.core, E = W.esc;
    var DAY = C.DAY, KEY = 'fsm-dash-period';
    var PERIODS = [['week', 'Эта неделя'], ['d7', 'Последние 7 дней'], ['d30', '30 дней']];
    var STATUSES = ['Новый', 'Назначен', 'В пути', 'На объекте', 'Ждёт запчасти', 'Выполнен', 'Закрыт'];

    function f1(x) { return (Math.round(x * 10) / 10).toFixed(1).replace('.', ','); }
    function money(x) { return Math.round(x).toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₽'; }
    function hm(min) { min = Math.round(min); var h = Math.floor(min / 60), m = min % 60; return h ? h + ' ч ' + (m < 10 ? '0' : '') + m + ' мин' : m + ' мин'; }
    function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

    /* ---------- расчёт: единый источник чисел для плиток, графиков и таблиц ---------- */
    function range(orders, key, now) {
        var d0 = C.dayStart(now), dow = (new Date(d0).getUTCDay() + 6) % 7, mon = d0 - dow * DAY, a, b, note = '';
        if (key === 'week') {
            a = mon; b = mon + 7 * DAY;
            var k0 = C.kpi(orders, a, b, now, W.opts); if (k0.met + k0.missed < 10) { a -= 7 * DAY; b -= 7 * DAY; note = 'На этой неделе пока мало завершённых нарядов, показана прошлая неделя'; }
            return { a: a, b: b, pa: a - 7 * DAY, pb: a, note: note, label: C.fmtDate(a).slice(0, 5) + ' – ' + C.fmtDate(b - DAY).slice(0, 5) };
        }
        var n = key === 'd7' ? 7 : 30;
        a = d0 - (n - 1) * DAY; b = d0 + DAY;
        return { a: a, b: b, pa: a - n * DAY, pb: a, note: '', label: C.fmtDate(a).slice(0, 5) + ' – ' + C.fmtDate(d0).slice(0, 5) };
    }
    function isToday(o, now) { return C.dayStart(o.win0 || o.created) === C.dayStart(now); }

    function compute(M, rep, key, now) {
        var R = range(M.orders, key, now), D = {};
        D.range = R;
        D.cur = C.kpi(M.orders, R.a, R.b, now, W.opts);
        D.prev = C.kpi(M.orders, R.pa, R.pb, now, W.opts);
        D.weeks = C.weekly(M.orders, now, 6, W.opts);
        D.worstWeek = -1; var mx = 0;
        D.weeks.forEach(function (w, i) { if (w.missed > mx) { mx = w.missed; D.worstWeek = i; } });
        /* открытые наряды в SLA-риске и просрочке (по всем нарядам, не по периоду) */
        D.alert = M.orders.filter(function (o) { if (!C.isOpen(o)) return false; var s = C.slaState(o, now, W.opts); return s.state === 'late' || s.state === 'risk'; })
            .map(function (o) { return { o: o, s: C.slaState(o, now, W.opts) }; }).sort(function (x, y) { return x.s.left - y.s.left; });
        D.lateNow = D.alert.filter(function (x) { return x.s.state === 'late'; }).length;
        /* сегодня */
        var today = M.orders.filter(function (o) { return o.status !== 'Отменён' && isToday(o, now); });
        D.today = today; D.byStatus = {};
        STATUSES.forEach(function (s) { D.byStatus[s] = 0; });
        today.forEach(function (o) { if (D.byStatus[o.status] !== undefined) D.byStatus[o.status]++; });
        D.load = M.engineers.filter(function (e) { return e.works; }).map(function (e) {
            return { name: e.name, count: today.filter(function (o) { return o.eng === e.name; }).length, max: e.max };
        }).sort(function (x, y) { return (y.count / y.max) - (x.count / x.max) || x.name.localeCompare(y.name); });
        /* повторные выезды за период */
        var inPeriod = M.orders.filter(function (o) { return o.status !== 'Отменён' && o.created >= R.a && o.created < R.b; });
        D.repeats = inPeriod.filter(function (o) { return o.repeat; }).sort(function (x, y) { return y.created - x.created; });
        var bw = {}; D.repeats.forEach(function (o) { bw[o.wt] = (bw[o.wt] || 0) + 1; });
        D.repByWork = Object.keys(bw).map(function (k) { return { label: k, val: bw[k] }; }).sort(function (x, y) { return y.val - x.val; });
        D.repSrcClosed = D.repeats.filter(function (o) { var s = M.orderBy[o.repOf]; return s && (s.status === 'Закрыт' || s.status === 'Выполнен'); }).length;
        /* материалы за период по дате завершения */
        var be = {}, bm = {}, total = 0;
        rep.forEach(function (r) {
            var t = C.parseDt(r['Завершён']); if (!t || t < R.a || t >= R.b) return;
            var sum = C.num(r['Количество']) * C.num(r['Цена']); total += sum;
            be[r['Инженер']] = (be[r['Инженер']] || 0) + sum; bm[r['Материал']] = (bm[r['Материал']] || 0) + sum;
        });
        function top(o, n) { return Object.keys(o).map(function (k) { return { label: k, val: o[k] }; }).sort(function (x, y) { return y.val - x.val; }).slice(0, n); }
        D.matByEng = top(be, 8); D.matByMat = top(bm, 6); D.matTotal = total;
        /* склад ниже минимума */
        D.low = [];
        M.engineers.forEach(function (e) { e.stock.forEach(function (s) { if (s.qty < s.min) D.low.push({ eng: e.name, name: s.name, qty: s.qty, min: s.min }); }); });
        D.low.sort(function (x, y) { return (x.qty / (x.min || 1)) - (y.qty / (y.min || 1)); });
        /* акты и допуски */
        D.actsAccess = W.canRead('Акт');
        D.actsUnsigned = M.acts.filter(function (a) { return !a.signedAt && !a.refused; });
        var d0 = C.dayStart(now); D.skillsSoon = []; D.skillsExpired = [];
        M.engineers.forEach(function (e) {
            e.skills.forEach(function (k) {
                if (!k.until) return; var d = Math.round((C.parseDt(k.until) - d0) / DAY);
                if (d < 0) D.skillsExpired.push({ eng: e.name, skill: k.skill, until: k.until, days: d });
                else if (d <= 30) D.skillsSoon.push({ eng: e.name, skill: k.skill, until: k.until, days: d });
            });
        });
        D.skillsSoon.sort(function (x, y) { return x.days - y.days; });
        return D;
    }

    /* ---------- SVG ---------- */
    /* Горизонтальные столбцы: подпись над полосой, значение справа. items: {label, val, text, track, bad}. */
    function hbar(items, o) {
        o = o || {}; var Wd = 420, BW = 330, RH = 36, mx = o.max || Math.max.apply(null, items.map(function (i) { return Math.max(i.val, i.track || 0); }).concat([1]));
        var h = items.length * RH + 4, s = '<svg class="fsm-dash-svg" viewBox="0 0 ' + Wd + ' ' + h + '" role="img" aria-label="' + E(o.aria || '') + '">';
        items.forEach(function (it, i) {
            var y = i * RH + 2, w = Math.max(it.val ? 3 : 0, it.val / mx * BW), tw = it.track ? it.track / mx * BW : BW;
            s += '<text class="fsm-dash-lbl" x="0" y="' + (y + 12) + '">' + E(cut(it.label, 44)) + '</text>';
            s += '<rect class="fsm-dash-track" x="0" y="' + (y + 18) + '" width="' + tw.toFixed(1) + '" height="10" rx="3"/>';
            s += '<rect class="fsm-dash-bar' + (it.bad ? ' fsm-dash-bad' : '') + '" x="0" y="' + (y + 18) + '" width="' + w.toFixed(1) + '" height="10" rx="3"/>';
            s += '<text class="fsm-dash-val' + (it.bad ? ' fsm-dash-valbad' : '') + '" x="' + Wd + '" y="' + (y + 27) + '" text-anchor="end">' + E(it.text) + '</text>';
        });
        return s + '</svg>';
    }
    function weeklyChart(D) {
        var Wd = 420, H = 230, L = 30, B = 40, T = 22, cw = (Wd - L) / D.weeks.length, bw = Math.min(40, cw - 14), ph = H - B - T;
        function y(v) { return T + ph * (1 - v / 100); }
        var s = '<svg class="fsm-dash-svg" viewBox="0 0 ' + Wd + ' ' + H + '" role="img" aria-label="Доля нарядов в срок по неделям">';
        [0, 50, 100].forEach(function (g) { s += '<line class="fsm-dash-grid" x1="' + L + '" x2="' + Wd + '" y1="' + y(g) + '" y2="' + y(g) + '"/><text class="fsm-dash-axis" x="' + (L - 4) + '" y="' + (y(g) + 4) + '" text-anchor="end">' + g + '</text>'; });
        D.weeks.forEach(function (w, i) {
            var x = L + i * cw + (cw - bw) / 2, cur = i === D.weeks.length - 1, bad = i === D.worstWeek, hh = ph * w.slaPct / 100;
            s += '<rect class="fsm-dash-bar' + (bad ? ' fsm-dash-bad' : '') + (cur ? ' fsm-dash-part' : '') + '" x="' + x.toFixed(1) + '" y="' + y(w.slaPct).toFixed(1) + '" width="' + bw + '" height="' + Math.max(hh, 0).toFixed(1) + '" rx="3"><title>Неделя с ' + C.fmtDate(w.start).slice(0, 5) + ': в срок ' + f1(w.slaPct) + ' %, нарядов ' + w.total + ', нарушений ' + w.missed + '</title></rect>';
            s += '<text class="fsm-dash-val' + (bad ? ' fsm-dash-valbad' : '') + '" x="' + (x + bw / 2).toFixed(1) + '" y="' + (y(w.slaPct) - 5).toFixed(1) + '" text-anchor="middle">' + (w.total ? f1(w.slaPct) : '–') + '</text>';
            s += '<text class="fsm-dash-lbl" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - B + 14) + '" text-anchor="middle">' + C.fmtDate(w.start).slice(0, 5) + (cur ? '*' : '') + '</text>';
            s += '<text class="fsm-dash-axis' + (bad ? ' fsm-dash-valbad' : '') + '" x="' + (x + bw / 2).toFixed(1) + '" y="' + (H - B + 28) + '" text-anchor="middle">' + (w.missed ? '▲ ' + w.missed + ' нар.' : '0 нар.') + '</text>';
        });
        s += '<line class="fsm-dash-target" x1="' + L + '" x2="' + Wd + '" y1="' + y(90) + '" y2="' + y(90) + '"/><text class="fsm-dash-axis" x="' + Wd + '" y="' + (y(90) - 4) + '" text-anchor="end">цель 90 %</text>';
        return s + '</svg>';
    }

    /* ---------- интерфейс ---------- */
    function delta(cur, prev, unit, goodUp, fmt) {
        var d = cur - prev; if (Math.abs(d) < 0.05) return '<span class="fsm-dash-d">без изменений к пред. периоду</span>';
        var good = goodUp ? d > 0 : d < 0, txt = fmt ? fmt(Math.abs(d)) : f1(Math.abs(d)) + ' ' + unit;
        return '<span class="fsm-dash-d ' + (good ? 'fsm-dash-dgood' : 'fsm-dash-dbad') + '">' + (d > 0 ? '▲ +' : '▼ −') + txt + ' <i>' + (good ? '(лучше)' : '(хуже)') + '</i> к пред. периоду</span>';
    }
    function tile(label, value, sub, extra) {
        extra = extra || {};
        var attrs = { 'class': 'fsm-dash-tile' + (extra.bad ? ' fsm-dash-tilebad' : '') + (extra.fn ? ' fsm-dash-click' : ''), html: '<div class="fsm-dash-tl">' + E(label) + '</div><div class="fsm-dash-tv">' + value + '</div><div class="fsm-dash-ts">' + (sub || '') + '</div>' };
        if (extra.fn) { attrs.role = 'button'; attrs.tabindex = '0'; attrs.onclick = extra.fn; attrs.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); extra.fn(); } }; }
        return W.el('div', attrs);
    }
    function card(title, hint, body, cls) {
        return W.el('section', { 'class': 'fsm-dash-card ' + (cls || '') }, [W.el('h2', { text: title }), hint ? W.el('p', { 'class': 'fsm-dash-hint', html: hint }) : null, body]);
    }
    function html(s) { var d = W.el('div', { 'class': 'fsm-dash-chart' }); d.innerHTML = s; return d; }

    function render(host, M, rep, key, onkey) {
        var now = W.now(), D = compute(M, rep, key, now), K = D.cur, P = D.prev;
        host.innerHTML = '';
        var timeEl = W.el('span', { 'class': 'fsm-dash-time', text: C.fmtDt(now) });
        var head = W.el('div', { 'class': 'fsm-dash-head' }, [
            W.el('div', {}, [W.el('h1', { text: 'Сервис: показатели' }), W.el('p', { 'class': 'fsm-sub' }, ['Демо-время: ', timeEl, ' (по Москве)'])]),
            W.el('div', { 'class': 'fsm-dash-per' }, [W.tabs(PERIODS, key, onkey), W.el('div', { 'class': 'fsm-dash-hint', text: 'Период: ' + D.range.label + ' (по дате создания наряда)' + (D.range.note ? '. ' + D.range.note : '') })])
        ]);
        host.appendChild(head);
        host._timeEl = timeEl;

        var tableId = 'fsm-dash-alert';
        var tiles = W.el('div', { 'class': 'fsm-dash-tiles' }, [
            tile('SLA в срок', f1(K.slaPct) + '<small> %</small>', 'прибытие и завершение в срок<br>' + delta(K.slaPct, P.slaPct, 'п.п.', true) + '<br><span class="fsm-dash-d">нарядов в расчёте: ' + (K.met + K.missed) + ', цель 90 %</span>', { bad: K.slaPct < 90 && K.met + K.missed > 0 }),
            tile('Просрочено сейчас', String(D.lateNow), D.lateNow ? 'открытых нарядов с нарушенным сроком; нажмите, чтобы перейти к таблице' : 'просроченных нет', { bad: D.lateNow > 0, fn: function () { var t = document.getElementById(tableId); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }),
            tile('Повторные выезды', f1(K.repeatPct) + '<small> %</small>', K.repeat + ' из ' + K.total + ' нарядов<br>' + delta(K.repeatPct, P.repeatPct, 'п.п.', false)),
            tile('От заявки до прибытия', hm(K.reactMin), 'в среднем по прибывшим<br>' + delta(K.reactMin, P.reactMin, '', false, function (x) { return hm(x); })),
            tile('Закрыто в день выезда', f1(K.sameDayPct) + '<small> %</small>', 'выполнено в день прибытия<br>' + delta(K.sameDayPct, P.sameDayPct, 'п.п.', true)),
            tile('Выездов на инженера в день', f1(K.perEngDay).replace(/^(\d+)$/, '$1'), 'завершённых нарядов<br>' + delta(K.perEngDay, P.perEngDay, '', true, function (x) { return f1(x); })),
            tile('Акты без подписи', D.actsAccess ? String(D.actsUnsigned.length) : '–', D.actsAccess ? 'ждут подписи клиента; нажмите, чтобы открыть акты' : 'нет доступа к актам', { fn: D.actsAccess ? function () { location.href = W.url('acts'); } : null }),
            tile('Допуски истекают в 30 дней', String(D.skillsSoon.length), D.skillsExpired.length ? 'уже истекли: ' + D.skillsExpired.length : 'истёкших нет', {
                fn: function () {
                    var rows = D.skillsExpired.map(function (x) { return [x, 'истёк']; }).concat(D.skillsSoon.map(function (x) { return [x, 'истекает']; }));
                    W.modal('Допуски инженеров', W.table([{ t: 'Инженер', k: 'eng' }, { t: 'Навык', k: 'skill' }, { t: 'Допуск до', html: function (r) { return E(C.fmtDate(C.parseDt(r.until))); } }, { t: 'Осталось', html: function (r) { return r.days < 0 ? W.badge('истёк ' + (-r.days) + ' дн. назад', 'crit') : W.badge(r.days + ' дн.', 'warn'); } }],
                        rows.map(function (r) { return r[0]; }), { empty: 'Нет' }), [{ text: 'Закрыть' }]);
                }
            })
        ]);
        host.appendChild(tiles);

        var grid = W.el('div', { 'class': 'fsm-dash-grid2' });
        host.appendChild(grid);

        grid.appendChild(card('SLA по неделям', 'Доля нарядов, выполненных в срок. Красный столбец: неделя с наибольшим числом нарушений. * - неделя ещё идёт.', html(weeklyChart(D))));

        grid.appendChild(card('Наряды сегодня по статусам', 'Всего на сегодня: ' + D.today.length + '.', html(hbar(STATUSES.map(function (s) { return { label: s, val: D.byStatus[s], text: String(D.byStatus[s]), bad: s === 'Ждёт запчасти' && D.byStatus[s] > 0 }; }), { max: Math.max(5, Math.max.apply(null, STATUSES.map(function (s) { return D.byStatus[s]; }))), aria: 'Наряды сегодня по статусам' }))));

        var over = D.load.filter(function (x) { return x.count > x.max; }).length;
        grid.appendChild(card('Загрузка инженеров сегодня', 'Нарядов на сегодня к лимиту «Макс. нарядов в день». Серая дорожка - свободная ёмкость' + (over ? '; перегруз отмечен красным и значком ▲.' : '.'),
            html(hbar(D.load.map(function (x) { return { label: x.name, val: x.count, track: x.max, text: (x.count > x.max ? '▲ ' : '') + x.count + ' из ' + x.max, bad: x.count > x.max }; }), { max: Math.max.apply(null, D.load.map(function (x) { return Math.max(x.max, x.count); }).concat([1])), aria: 'Загрузка инженеров' }))));

        var repBody = W.el('div', {}, [
            D.repByWork.length ? html(hbar(D.repByWork.map(function (x) { return { label: x.label, val: x.val, text: String(x.val) }; }), { aria: 'Повторные выезды по видам работ' })) : W.el('p', { 'class': 'fsm-dash-hint', text: 'За период повторных выездов нет.' }),
            W.table([
                { t: 'Наряд', html: function (r) { return '<b>' + E(r.num) + '</b>'; } }, { t: 'Оборудование', k: 'eq' }, { t: 'Исходный наряд', k: 'repOf' }, { t: 'Инженер', k: 'eng' }, { t: 'Дата', html: function (r) { return E(C.fmtDate(r.created).slice(0, 5)); } }
            ], D.repeats.slice(0, 8), { empty: 'Нет повторных выездов' })
        ]);
        grid.appendChild(card('Повторные выезды', 'Повтор - не просто «закрыто»: наряд был закрыт, а клиент вызвал инженера снова по той же неисправности. ' + (D.repeats.length ? 'Из ' + D.repeats.length + ' повторных исходный наряд уже был выполнен или закрыт у ' + D.repSrcClosed + '.' : ''), repBody, 'fsm-dash-wide'));

        grid.appendChild(card('Расход материалов по инженерам', 'За период по дате завершения наряда, всего ' + money(D.matTotal) + '.', html(hbar(D.matByEng.map(function (x) { return { label: x.label, val: x.val, text: money(x.val) }; }), { aria: 'Расход материалов по инженерам' }))));
        grid.appendChild(card('Топ материалов в деньгах', 'Те же наряды, по материалам.', html(hbar(D.matByMat.map(function (x) { return { label: x.label, val: x.val, text: money(x.val) }; }), { aria: 'Топ материалов' }))));

        grid.appendChild(card('Склад в машинах ниже минимума', D.low.length ? 'Позиций ниже минимума: ' + D.low.length + '.' : '', W.table([
            { t: 'Инженер', k: 'eng' }, { t: 'Материал', k: 'name' }, { t: 'Остаток', num: true, html: function (r) { return '<span class="fsm-dash-valbad">' + E(W.right(r.qty)) + '</span>'; } }, { t: 'Минимум', num: true, k: 'min' }
        ], D.low, { empty: 'Все остатки не ниже минимума' }), 'fsm-dash-wide'));

        var tw = W.table([
            { t: 'Наряд', html: function (r) { return '<b>' + E(r.o.num) + '</b>'; } },
            { t: 'Объект', html: function (r) { return E(r.o.obj); } },
            { t: 'Приоритет', html: function (r) { return E(r.o.prio); } },
            { t: 'Инженер', html: function (r) { return r.o.eng ? E(r.o.eng) : '<i>не назначен</i>'; } },
            { t: 'Срок', html: function (r) { return W.badge((r.s.state === 'late' ? '▲ ' : '') + r.s.text + (r.s.stage === 'arrive' ? ' (прибытие)' : ' (завершение)'), r.s.state === 'late' ? 'crit' : 'warn'); } },
            { t: 'Причина', html: function (r) { return r.o.reason ? E(r.o.reason) : '<span class="fsm-dash-hint">не заполнена</span>'; } }
        ], D.alert, { empty: 'Просроченных и рискованных нарядов нет', rowCls: function (r) { return r.s.state === 'late' ? 'fsm-row-bad' : 'fsm-row-warn'; } });
        var sec = card('Просрочено и в риске сейчас', 'Открытые наряды: срок нарушен или до него 30 минут и меньше. Всего: ' + D.alert.length + ', просрочено: ' + D.lateNow + '.', tw, 'fsm-dash-full');
        sec.id = tableId; host.appendChild(sec);
        return D;
    }

    W.dashCompute = compute;
    W.mount(function (host) {
        host.classList.add('fsm-dash');
        return Promise.all([W.load(), W.report('Материалы по нарядам').catch(function () { return []; })]).then(function (r) {
            var M = r[0], rep = r[1], key = 'd30';
            try { var k = localStorage.getItem(KEY); if (k && PERIODS.some(function (p) { return p[0] === k; })) key = k; } catch (e) { /* без хранилища */ }
            function draw() {
                var D = render(host, M, rep, key, function (k) { key = k; try { localStorage.setItem(KEY, k); } catch (e) { /* нет хранилища */ } draw(); });
                window.FsmDash = D;
            }
            draw();
            setInterval(function () { var t = host.querySelector('.fsm-dash-time'); if (t) t.textContent = C.fmtDt(W.now()); }, 30000);
        });
    });
})();
