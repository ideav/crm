/* Консолидация: «Журнал корректировок» - вид, основание, автор, проводки; баланс проводки и влияние на прибыль; утверждение. */
(function () {
    'use strict';
    var P = window.Consol, C = P.core;
    var st = { per: '', kind: '' };
    var SK = { 'Утверждена': 'good', 'Черновик': 'warn', 'Отклонена': 'muted' };

    function check(M, a) { return C.validateAdj(a, M.artBy, { name: a.kind, profit: (M.kindBy[a.kind] || {}).profit }); }
    function entriesTable(M, en) {
        return P.table([{ t: 'Статья', html: function (e) { return P.esc(e.article + ' ' + (M.artBy[e.article] ? M.artBy[e.article].name : '')); } }, { t: 'Общество', html: function (e) { return P.esc(e.company); } },
            { t: 'Дебет', num: true, html: function (e) { return e.amount > 0 ? P.fmt(e.amount) : ''; } }, { t: 'Кредит', num: true, html: function (e) { return e.amount < 0 ? P.fmt(-e.amount) : ''; } }], en);
    }
    function card(host, M, a) {
        var v = check(M, a), canW = P.canWrite('Корректировка') && !P.locked(M, a.period);
        var basis = P.input('textarea', a.basis, { rows: 3 });
        var body = P.el('div', {}, [
            P.el('div', { 'class': 'consol-grid2' }, [
                P.el('div', { html: '<small class="consol-muted">Вид</small><br>' + P.esc(a.kind) + ((M.kindBy[a.kind] || {}).profit ? ' ' + P.badge('влияет на прибыль', 'violet') : ' ' + P.badge('без влияния на прибыль', 'info')) }),
                P.el('div', { html: '<small class="consol-muted">Статус</small><br>' + P.badge(a.status, SK[a.status]) + (a.auto ? ' ' + P.badge('сформирована системой', 'info') : '') }),
                P.el('div', { html: '<small class="consol-muted">Автор, создана</small><br>' + P.esc(a.author + ', ' + a.created) }),
                P.el('div', { html: '<small class="consol-muted">Утвердил</small><br>' + P.esc(a.approver ? a.approver + ', ' + a.approved : '-') }),
                P.el('div', { html: '<small class="consol-muted">Влияние на прибыль группы</small><br><b>' + P.fmt(v.profit) + '</b> тыс. руб.' })
            ]),
            canW && a.status === 'Черновик' ? P.field('Основание (документ, расчёт, запрос аудитора)', basis) : P.el('p', { html: '<b>Основание:</b> ' + (a.basis ? P.esc(a.basis) : '<span class="consol-red">не указано</span>') }),
            P.el('h3', { text: 'Проводки, тыс. руб.' }), entriesTable(M, a.entries),
            v.ok ? P.el('p', { 'class': 'consol-good-t', text: '✓ Проводка сбалансирована, основание есть' }) : P.el('div', { 'class': 'consol-warnbox consol-e', text: v.errors.join('; ') })
        ]);
        var btns = [{ text: 'Закрыть' }];
        if (canW && a.status === 'Черновик') {
            btns.push({ text: 'Сохранить основание', fn: function (close) { P.update(a.id, { 'Основание': basis.value.trim() }).then(function () { close(); P.toast('Основание сохранено'); P.reload(function (M2) { render(host, M2); }); }).catch(function (e) { P.toast(e.message, true); }); return false; } });
            btns.push({ text: 'Отклонить', cls: 'consol-danger', fn: function (close) { P.update(a.id, { 'Статус корректировки': 'Отклонена' }).then(function () { close(); P.reload(function (M2) { render(host, M2); }); }).catch(function (e) { P.toast(e.message, true); }); return false; } });
            btns.push({ text: 'Утвердить', cls: 'consol-primary', fn: function (close) {
                var v2 = check(M, Object.assign({}, a, { basis: basis.value }));
                if (!v2.ok) { P.toast('Не утвердить: ' + v2.errors.join('; '), true); return false; }
                P.update(a.id, { 'Основание': basis.value.trim(), 'Статус корректировки': 'Утверждена', 'Утвердил': P.myName(M), 'Дата утверждения': P.nowStr() }).then(function () { close(); P.toast(a.num + ' утверждена'); P.reload(function (M2) { render(host, M2); }); }).catch(function (e) { P.toast(e.message, true); });
                return false;
            } });
        }
        P.modal(a.num + ': ' + a.title, body, btns, true);
    }
    function newDlg(host, M) {
        var per = M.periodBy[st.per];
        var kinds = P.select(M.kinds.map(function (k) { return k.name; }), 'Трансформация'), title = P.input('text', ''), basis = P.input('textarea', '', { rows: 2 });
        var rows = [{ article: '', company: '', d: '', k: '' }, { article: '', company: '', d: '', k: '' }];
        var list = P.el('div'), info = P.el('div');
        var artO = [['', '- статья -']].concat(M.arts.map(function (a) { return [a.code, a.code + ' ' + a.name]; })), coO = [['', '- общество -']].concat(M.cos.map(function (c) { return [c.code, c.code]; }));
        function entries() { return rows.map(function (r) { return { article: r.article, company: r.company, amount: C.num(r.d) - C.num(r.k) }; }); }
        function upd() {
            var v = C.validateAdj({ basis: basis.value, entries: entries() }, M.artBy, { name: kinds.value, profit: (M.kindBy[kinds.value] || {}).profit });
            info.innerHTML = v.ok ? '<p class="consol-good-t">✓ Сбалансировано, влияние на прибыль ' + P.esc(P.fmt(v.profit)) + '</p>' : '<div class="consol-warnbox consol-e">' + P.esc(v.errors.join('; ')) + '</div>';
            return v;
        }
        function draw() {
            list.innerHTML = '';
            rows.forEach(function (r, i) {
                var a = P.select(artO, r.article), c = P.select(coO, r.company), d = P.input('text', r.d, { inputmode: 'decimal', placeholder: 'Дебет', 'aria-label': 'Дебет' }), k = P.input('text', r.k, { inputmode: 'decimal', placeholder: 'Кредит', 'aria-label': 'Кредит' });
                a.onchange = function () { r.article = a.value; upd(); }; c.onchange = function () { r.company = c.value; upd(); };
                d.oninput = function () { r.d = d.value; upd(); }; k.oninput = function () { r.k = k.value; upd(); };
                list.appendChild(P.el('div', { 'class': 'consol-entry' }, [a, c, d, k, P.btn('×', function () { rows.splice(i, 1); draw(); }, 'consol-small')]));
            });
            upd();
        }
        basis.oninput = upd; kinds.onchange = upd;
        draw();
        var body = P.el('div', {}, [P.el('div', { 'class': 'consol-grid2' }, [P.field('Вид корректировки', kinds), P.field('Суть', title)]), P.field('Основание', basis),
            P.el('h3', { text: 'Проводки (тыс. руб.)' }), list, P.btn('+ строка', function () { rows.push({ article: '', company: '', d: '', k: '' }); draw(); }, 'consol-small'), info]);
        P.modal('Новая корректировка: ' + st.per, body, [{ text: 'Отмена' }, { text: 'Сохранить черновиком', cls: 'consol-primary', fn: function (close, b) {
            var v = upd(), en = entries().filter(function (e) { return e.article && e.amount; });
            if (!title.value.trim() || !en.length || Math.abs(v.balance) > 0.5) { P.toast('Нужны суть и сбалансированные проводки', true); return false; }
            var k = M.kindBy[kinds.value] || { prefix: 'К' }, num = C.nextAdjNum(M.adjs.filter(function (a) { return a.period === st.per; }), per.short, k.prefix);
            var ops = [{ op: 'new', id: 'Корректировка', up: 1, fields: { 'Корректировка': num, 'Период': st.per, 'Вид корректировки': kinds.value, 'Суть корректировки': title.value.trim(), 'Основание': basis.value.trim(), 'Автор корректировки': P.myName(M), 'Создана': P.nowStr(), 'Статус корректировки': 'Черновик' } }];
            en.forEach(function (e) { ops.push({ op: 'new', id: 'Проводка', up: 1, fields: { 'Проводка': num + ' ' + (e.amount > 0 ? 'Дт' : 'Кт') + ' ' + e.article, 'Корректировка': ':id0', 'Статья группы': M.artBy[e.article].name, 'Компания': M.coBy[e.company] ? M.coBy[e.company].name : '', 'Сумма': e.amount } }); });
            b.disabled = true;
            P.batch(ops).then(function () { close(); P.toast('Корректировка ' + num + ' сохранена черновиком'); P.reload(function (M2) { render(host, M2); }); }).catch(function (e) { b.disabled = false; P.toast(e.message, true); });
            return false;
        } }], true);
    }
    function render(host, M) {
        host.innerHTML = '';
        st.per = st.per || P.hash().per || M.cur;
        host.appendChild(P.el('h1', { text: 'Журнал корректировок' }));
        host.appendChild(P.el('p', { 'class': 'consol-sub', text: 'Каждая корректировка - с видом, основанием, автором и сбалансированными проводками по обществам. Без основания не утверждается; реклассификация не может менять прибыль. Нажмите на строку - откроется карточка.' }));
        var sel = P.select(M.periods.map(function (p) { return p.name; }), st.per); sel.onchange = function () { st.per = sel.value; render(host, M); };
        var ks = P.select([['', 'Все виды']].concat(M.kinds.map(function (k) { return k.name; })), st.kind); ks.onchange = function () { st.kind = ks.value; render(host, M); };
        var bar = [P.field('Период', sel), P.field('Вид', ks), P.el('span', { 'class': 'consol-grow' })];
        if (P.canWrite('Корректировка') && !P.locked(M, st.per)) bar.push(P.btn('Новая корректировка', function () { newDlg(host, M); }, 'consol-primary'));
        host.appendChild(P.el('div', { 'class': 'consol-bar' }, bar));
        var list = M.adjs.filter(function (a) { return a.period === st.per && (!st.kind || a.kind === st.kind); });
        var all = M.adjs.filter(function (a) { return a.period === st.per; });
        var drafts = all.filter(function (a) { return a.status === 'Черновик'; }), noB = all.filter(function (a) { return a.status !== 'Отклонена' && !String(a.basis || '').trim(); });
        var pr = all.filter(function (a) { return a.status === 'Утверждена'; }).reduce(function (s, a) { return s + check(M, a).profit; }, 0);
        host.appendChild(P.el('div', { 'class': 'consol-kpis' }, [
            P.kpi('Корректировок', String(all.length), all.filter(function (a) { return a.auto; }).length + ' сформированы системой'),
            P.kpi('В черновике', String(drafts.length), 'не попадают в отчётность', drafts.length ? 'warn' : 'good'),
            P.kpi('Без основания', String(noB.length), noB.map(function (a) { return a.num; }).join(', ') || 'у всех есть', noB.length ? 'bad' : 'good'),
            P.kpi('Влияние на прибыль', P.fmt(pr), 'утверждённых, тыс. руб.')
        ]));
        host.appendChild(P.table([
            { t: 'Номер', html: function (a) { return '<b>' + P.esc(a.num) + '</b>'; } },
            { t: 'Вид', html: function (a) { return P.esc(a.kind) + (a.auto ? '<br><small class="consol-muted">сформирована системой</small>' : ''); } },
            { t: 'Суть и основание', html: function (a) { return P.esc(a.title) + '<br><small class="' + (a.basis ? 'consol-muted' : 'consol-red') + '">' + P.esc(a.basis || 'основание не указано') + '</small>'; } },
            { t: 'Общества', html: function (a) { var s = {}; a.entries.forEach(function (e) { s[e.company] = 1; }); return P.esc(Object.keys(s).join(', ')); } },
            { t: 'На прибыль', num: true, html: function (a) { var v = check(M, a); return v.profit ? P.fmt(v.profit) : '0'; } },
            { t: 'Автор', html: function (a) { return P.esc(a.author) + '<br><small class="consol-muted">' + P.esc(a.created) + '</small>'; } },
            { t: 'Статус', html: function (a) { var v = check(M, a); return P.badge(a.status, SK[a.status]) + (!v.ok && a.status === 'Черновик' ? '<br>' + P.badge('не утвердить', 'bad') : ''); } }
        ], list, { onrow: function (a) { card(host, M, a); }, rowCls: function (a) { return !a.basis ? 'consol-r-breach' : a.status === 'Черновик' ? 'consol-r-warn' : ''; }, empty: 'Корректировок нет' }));
    }
    P.mount(render);
})();
