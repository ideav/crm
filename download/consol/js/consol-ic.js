/* Консолидация: «Сверка ВГО» - пары обществ группы по расчётам, займам, выручке и процентам, расхождения и элиминация сошедшихся пар. */
(function () {
    'use strict';
    var P = window.Consol, C = P.core;
    var st = { per: '' };
    var STATE = { ok: ['сошлась', 'good'], diff: ['расхождение', 'bad'], missing: ['нет встречной строки', 'warn'] };

    /* Пары, уже сторнированные корректировками периода (по обществу и статье стороны A). */
    function eliminated(M, per) {
        var done = {};
        M.adjs.filter(function (a) { return a.period === per && a.kind === 'Элиминация ВГО' && a.status !== 'Отклонена'; }).forEach(function (a) {
            a.entries.forEach(function (e) { done[e.company + '|' + e.article] = a.num; });
        });
        return done;
    }
    function drill(M, p) {
        var ls = P.periodLines(M, st.per).filter(function (l) { return (l.company === p.a && l.cp === p.b && l.article === p.artA) || (l.company === p.b && l.cp === p.a && l.article === p.artB); });
        P.modal(p.a + ' / ' + p.b + ': ' + p.kind, P.el('div', {}, [
            P.table([{ t: 'Общество', k: 'company' }, { t: 'Счёт', k: 'acc' }, { t: 'Статья', html: function (l) { return P.esc(M.artBy[l.article].name); } }, { t: 'Контрагент', k: 'cp' },
                { t: 'Сумма', num: true, html: function (l) { return P.fmt(C.disp(M.artBy[l.article], l.amount)); } }], ls),
            p.state === 'diff' ? P.el('p', { 'class': 'consol-warnbox consol-e', text: 'Разница ' + P.fmt(Math.abs(p.diff)) + ' тыс. руб.: одно из обществ не отразило операцию или отразило в другом периоде. Пока пара не сошлась, элиминация по ней не формируется.' }) : null
        ]), null, true);
    }
    function render(host, M) {
        host.innerHTML = '';
        st.per = st.per || P.hash().per || M.cur;
        host.appendChild(P.el('h1', { text: 'Сверка внутригрупповых операций' }));
        host.appendChild(P.el('p', { 'class': 'consol-sub', text: 'Строки пакетов с контрагентом группы (по ИНН) сводятся в пары: дебиторка против кредиторки, займ выданный против полученного, выручка против закупок, проценты. Сошедшиеся пары сторнируются корректировкой «Элиминация ВГО».' }));
        var sel = P.select(M.periods.map(function (p) { return p.name; }), st.per); sel.onchange = function () { st.per = sel.value; render(host, M); };
        var pairs = P.pairsFor(M, st.per), done = eliminated(M, st.per);
        var ready = pairs.filter(function (p) { return p.state === 'ok' && !done[p.a + '|' + p.artA]; });
        var bar = [P.field('Период', sel), P.el('span', { 'class': 'consol-grow' })];
        if (P.canWrite('Корректировка') && !P.locked(M, st.per)) {
            var b = P.btn('Сформировать элиминацию (' + ready.length + ' пар)', function () {
                var per = M.periodBy[st.per], k = M.kindBy['Элиминация ВГО'] || { prefix: 'Э' };
                var num = C.nextAdjNum(M.adjs.filter(function (a) { return a.period === st.per; }), per.short, k.prefix), ent = C.eliminationEntries(ready);
                var ops = [{ op: 'new', id: 'Корректировка', up: 1, fields: { 'Корректировка': num, 'Период': st.per, 'Вид корректировки': 'Элиминация ВГО', 'Суть корректировки': 'Элиминация сошедшихся пар: ' + ready.map(function (p) { return p.a + '-' + p.b + ' ' + p.kind.toLowerCase(); }).join(', '),
                    'Основание': 'Сверка ВГО ' + st.per + ' на ' + P.nowStr() + ': ' + ready.length + ' пар сошлись без разницы', 'Автор корректировки': P.myName(M), 'Создана': P.nowStr(), 'Статус корректировки': 'Черновик', 'Сформирована автоматически': 1 } }];
                ent.forEach(function (e) { ops.push({ op: 'new', id: 'Проводка', up: 1, fields: { 'Проводка': num + ' ' + (e.amount > 0 ? 'Дт' : 'Кт') + ' ' + e.article, 'Корректировка': ':id0', 'Статья группы': M.artBy[e.article].name, 'Компания': M.coBy[e.company].name, 'Сумма': e.amount } }); });
                b.disabled = true;
                P.batch(ops).then(function () { P.toast('Корректировка ' + num + ' создана черновиком - утвердите её в журнале'); P.reload(function (M2) { render(host, M2); }); }).catch(function (e) { b.disabled = false; P.toast(e.message, true); });
            }, ready.length ? 'consol-primary' : '');
            b.disabled = !ready.length; bar.push(b);
        }
        host.appendChild(P.el('div', { 'class': 'consol-bar' }, bar));
        var bad = pairs.filter(function (p) { return p.state === 'diff'; }), miss = pairs.filter(function (p) { return p.state === 'missing'; });
        host.appendChild(P.el('div', { 'class': 'consol-kpis' }, [
            P.kpi('Пар внутри группы', String(pairs.length), pairs.filter(function (p) { return p.state === 'ok'; }).length + ' сошлись'),
            P.kpi('Расхождения', String(bad.length), bad.length ? 'на ' + P.fmt(bad.reduce(function (s, p) { return s + Math.abs(p.diff); }, 0)) + ' тыс. руб.' : 'нет', bad.length ? 'bad' : 'good'),
            P.kpi('Нет встречной строки', String(miss.length), miss.length ? 'контрагент не сдал пакет' : 'все пакеты на месте', miss.length ? 'warn' : 'good'),
            P.kpi('Готово к элиминации', String(ready.length), 'сошлись, ещё не сторнированы', ready.length ? 'warn' : '')
        ]));
        /* шахматка обществ: цвет - худшее состояние пар между двумя обществами */
        var cos = M.cos.map(function (c) { return c.code; }), rank = { diff: 3, missing: 2, ok: 1 };
        var cell = function (x, y) { var ps = pairs.filter(function (p) { return (p.a === x && p.b === y) || (p.a === y && p.b === x); }); if (!ps.length) return null; return ps.reduce(function (w, p) { return rank[p.state] > rank[w.state] ? p : w; }); };
        var grid = '<table class="consol-matrix" aria-label="Шахматка ВГО"><tr><th></th>' + cos.map(function (c) { return '<th>' + P.esc(c) + '</th>'; }).join('') + '</tr>' + cos.map(function (x) {
            return '<tr><th>' + P.esc(x) + '</th>' + cos.map(function (y) { if (x === y) return '<td class="consol-m-self"></td>'; var p = cell(x, y); return p ? '<td class="consol-m-' + p.state + '" title="' + P.esc(STATE[p.state][0]) + '">' + (p.state === 'ok' ? '✓' : p.state === 'diff' ? P.fmt(Math.abs(p.diff)) : '?') + '</td>' : '<td></td>'; }).join('') + '</tr>';
        }).join('') + '</table>';
        host.appendChild(P.el('div', { 'class': 'consol-card', html: '<h3>Шахматка обществ</h3>' + grid + '<small class="consol-muted">✓ пары сошлись, число - разница, ? - нет встречного пакета</small>' }));
        host.appendChild(P.table([
            { t: 'Пара', html: function (p) { return '<b>' + P.esc(p.a + ' / ' + p.b) + '</b><br><small class="consol-muted">' + P.esc(P.coName(M, p.a) + ' / ' + P.coName(M, p.b)) + '</small>'; } },
            { t: 'Вид', k: 'kind' },
            { t: 'Сторона A', num: true, html: function (p) { return p.amtA === null ? '-' : P.fmt(C.disp(M.artBy[p.artA], p.amtA)) + '<br><small class="consol-muted">' + P.esc(M.artBy[p.artA].name) + '</small>'; } },
            { t: 'Сторона B', num: true, html: function (p) { return p.amtB === null ? '<span class="consol-muted">нет строки</span>' : P.fmt(C.disp(M.artBy[p.artB], p.amtB)) + '<br><small class="consol-muted">' + P.esc(M.artBy[p.artB].name) + '</small>'; } },
            { t: 'Разница', num: true, html: function (p) { return p.diff === null ? '' : p.diff ? '<b class="consol-red">' + P.fmt(Math.abs(p.diff)) + '</b>' : '0'; } },
            { t: 'Статус', html: function (p) { var s = STATE[p.state]; return P.badge(s[0], s[1]) + (done[p.a + '|' + p.artA] ? ' ' + P.badge('элиминировано ' + done[p.a + '|' + p.artA], 'muted') : ''); } }
        ], pairs, { onrow: function (p) { drill(M, p); }, rowCls: function (p) { return p.state === 'diff' ? 'consol-r-breach' : p.state === 'missing' ? 'consol-r-warn' : ''; } }));
    }
    P.mount(render);
})();
