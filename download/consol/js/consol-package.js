/* Консолидация: «Пакет общества» - загрузка ОСВ из 1С, сопоставление счетов со статьями группы, контроли сразу, встречные ВГО,
   отправка в центр. Методолог принимает пакет или возвращает с замечанием. */
(function () {
    'use strict';
    var P = window.Consol, C = P.core;
    var st = { co: '', per: '', work: null, fromOsv: false };
    var EDIT = ['Не начат', 'Черновик', 'Возвращён'];
    var MAP_TEXT = { mapped: ['сопоставлен', 'good'], suggested: ['подсказка', 'warn'], unmapped: ['нет статьи', 'bad'], skip: ['служебный', 'muted'] };
    var ICON = { ok: '✓', warn: '!', error: '✕' };

    function isAcc(M) { return !!M.me; }
    function artOptions(M) { return [['', '- выберите статью -']].concat(M.arts.filter(function (a) { return !a.ic; }).map(function (a) { return [a.code, a.code + ' ' + a.name]; })); }
    function controlsBox(res) {
        return P.el('div', { 'class': 'consol-ctl' }, res.map(function (c) {
            return P.el('div', { 'class': 'consol-ctl-i consol-ctl-' + c.state }, [P.el('b', { text: ICON[c.state] + ' ' + c.title }), P.el('span', { text: c.msg }),
                c.items.length && c.state !== 'ok' ? P.el('ul', {}, c.items.slice(0, 8).map(function (t) { return P.el('li', { text: t }); })) : null]);
        }));
    }
    function lineOp(M, pkg, l) {
        var co = M.coBy[pkg.company], cp = l.cp ? M.coBy[l.cp] : null;
        return { op: 'new', id: 'Строка пакета', up: 1, fields: { 'Строка пакета': l.acc, 'Пакет': pkg.name, 'Статья группы': l.article ? M.artBy[l.article].name : '', 'Наименование счёта': l.name, 'Контрагент группы': cp ? cp.name : '',
            'Сальдо на начало': l.open || 0, 'Сумма': l.amount || 0, 'Код общества': pkg.company, 'Код периода': M.periodBy[pkg.period].code, 'Логин бухгалтера': co.login, 'Логин контрагента': cp ? cp.login : '' } };
    }
    /* Сохранить строки и подтверждённые счета; send - отправить в центр. */
    function save(M, pkg, send) {
        var co = M.coBy[pkg.company], map = M.mapping[pkg.company] || {}, ops = [], seen = {};
        var rows = st.work || P.pkgLines(M, pkg);
        if (st.fromOsv) {
            M.lines.filter(function (l) { return l.pkg === pkg.id; }).forEach(function (l) { ops.push({ op: 'del', id: l.id }); });
            rows.filter(function (l) { return l.status !== 'skip'; }).forEach(function (l) { ops.push(lineOp(M, pkg, l)); });
        } else {
            rows.filter(function (l) { return l._changed && l.id; }).forEach(function (l) { ops.push({ op: 'set', id: l.id, fields: { 'Статья группы': l.article ? M.artBy[l.article].name : '' } }); });
        }
        rows.filter(function (l) { return l.status === 'mapped' && l.base && !map[l.acc] && !seen[l.acc]; }).forEach(function (l) {
            seen[l.acc] = 1;
            ops.push({ op: 'new', id: 'Счёт общества', up: 1, fields: { 'Счёт общества': l.acc, 'Компания': co.name, 'Наименование счёта': l.name, 'Статья группы': M.artBy[l.base].name, 'Подтвердил': P.myName(M), 'Логин бухгалтера': co.login } });
        });
        var pf = { 'Статус пакета': send ? 'Отправлен' : 'Черновик', 'Способ ввода': st.fromOsv ? 'ОСВ из 1С' : (pkg.method || 'ОСВ из 1С') };
        if (send) { pf['Отправлен'] = P.nowStr(); pf['Версия пакета'] = (pkg.ver || 0) + 1; }
        ops.push({ op: 'set', id: pkg.id, fields: pf });
        return P.batch(ops);
    }
    function uploadDlg(host, M, pkg) {
        var ta = P.input('textarea', '', { rows: 8, placeholder: 'Вставьте ОСВ из Excel или 1С (Ctrl+V) или выберите файл CSV' });
        var file = P.el('input', { type: 'file', accept: '.csv,.txt' });
        file.onchange = function () { var f = file.files[0]; if (!f) return; var rd = new FileReader(); rd.onload = function () { ta.value = rd.result; }; rd.readAsText(f, 'utf-8'); };
        var sample = window.ConsolSample && window.ConsolSample[pkg.company];
        var body = P.el('div', {}, [P.el('p', { 'class': 'consol-muted', text: 'Оборотно-сальдовая ведомость за период: счёт, наименование, ИНН контрагента, сальдо на начало Дт/Кт, обороты Дт/Кт, сальдо на конец Дт/Кт. Контрагенты группы определяются по ИНН, их строки уходят в статьи «(ВГО)».' }),
            P.field('Файл', file), P.field('Или вставка', ta), sample ? P.btn('Подставить выгрузку 1С за ' + pkg.period + ' (пример)', function () { ta.value = sample; }, 'consol-small') : null]);
        P.modal('Загрузка ОСВ из 1С: ' + P.coName(M, pkg.company), body, [{ text: 'Отмена' }, { text: 'Разобрать', cls: 'consol-primary', fn: function () {
            var osv = C.parseOsv(ta.value);
            if (!osv.length) { P.toast('Не нашлось строк со счетами', true); return false; }
            st.work = C.mapOsv(osv, { articles: M.arts, byCode: M.artBy, mapping: M.mapping[pkg.company] || {}, innTo: M.innTo, self: pkg.company }).map(function (r, i) { r._osv = osv[i]; return r; });
            st.fromOsv = true; render(host, M);
            P.toast('Загружено ' + osv.length + ' строк: проверьте подсказки и контроли');
        } }], true);
    }
    function returnDlg(host, M, pkg) {
        var t = P.input('text', ''), x = P.input('textarea', '', { rows: 4 });
        P.modal('Вернуть пакет ' + pkg.name + ' на доработку', P.el('div', {}, [P.field('Кратко', t), P.field('Что исправить', x)]), [{ text: 'Отмена' }, { text: 'Вернуть', cls: 'consol-primary', fn: function (close, b) {
            if (!x.value.trim()) { P.toast('Опишите, что исправить', true); return false; }
            b.disabled = true;
            P.batch([{ op: 'new', id: 'Замечание', up: 1, fields: { 'Замечание': t.value.trim() || x.value.trim().slice(0, 40), 'Пакет': pkg.name, 'Текст замечания': x.value.trim(), 'Автор замечания': P.myName(M), 'Когда': P.nowStr(), 'Статус замечания': 'Открыто', 'Логин бухгалтера': pkg.login } },
                { op: 'set', id: pkg.id, fields: { 'Статус пакета': 'Возвращён' } }])
                .then(function () { close(); P.toast('Пакет возвращён с замечанием'); P.reload(function (M2) { render(host, M2); }); }).catch(function (e) { b.disabled = false; P.toast(e.message, true); });
            return false;
        } }]);
    }
    function render(host, M) {
        host.innerHTML = '';
        var h = P.hash();
        st.per = st.per || h.per || M.cur;
        st.co = isAcc(M) ? M.me.code : (st.co || h.co || M.cos[0].code);
        var pkg = M.pkgOf(st.co, st.per);
        host.appendChild(P.el('h1', { text: 'Пакет: ' + P.coName(M, st.co) + ' · ' + st.per }));
        host.appendChild(P.el('p', { 'class': 'consol-sub', text: isAcc(M) ? 'Загрузите ОСВ из 1С - счета сопоставятся со статьями группы, контроли посчитаются сразу. Встречные суммы контрагентов группы видны здесь же: расхождение по ВГО видно до отправки, а не через две недели.' : 'Пакет общества глазами методолога: строки, сопоставление счетов, контроли и встречные ВГО. Принять можно, когда блокирующие контроли зелёные.' }));
        var bar = [];
        if (!isAcc(M)) {
            var cs = P.select(M.cos.map(function (c) { return [c.code, c.code + ' ' + c.name]; }), st.co);
            cs.onchange = function () { st.co = cs.value; st.work = null; st.fromOsv = false; render(host, M); };
            bar.push(P.field('Общество', cs));
        }
        var ps = P.select(M.periods.map(function (p) { return p.name; }), st.per);
        ps.onchange = function () { st.per = ps.value; st.work = null; st.fromOsv = false; render(host, M); };
        bar.push(P.field('Период', ps));
        if (!pkg) { host.appendChild(P.el('div', { 'class': 'consol-bar' }, bar)); host.appendChild(P.el('div', { 'class': 'consol-note', text: 'Пакет за период не заведён.' })); return; }
        var lines = st.work || P.pkgLines(M, pkg), res = P.controlsFor(M, pkg, lines), ok = C.canSubmit(res);
        var locked = P.locked(M, pkg.period), editable = isAcc(M) && EDIT.indexOf(pkg.status) >= 0 && !locked && P.canWrite('Строка пакета');
        bar.push(P.el('span', { 'class': 'consol-grow' }));
        bar.push(P.el('div', { html: P.badge(pkg.status, C.statusKind(pkg.status)) + (pkg.sent ? ' <small class="consol-muted">отправлен ' + P.esc(pkg.sent) + '</small>' : '') + (pkg.accepted ? ' <small class="consol-muted">принят ' + P.esc(pkg.accepted) + ' (' + P.esc(pkg.by) + ')</small>' : '') + (locked ? ' ' + P.badge('период закрыт', 'muted') : '') }));
        host.appendChild(P.el('div', { 'class': 'consol-bar' }, bar));
        var rem = M.remarks.filter(function (r) { return r.pkg === pkg.id && r.status !== 'Снято'; });
        rem.forEach(function (r) { host.appendChild(P.el('div', { 'class': 'consol-warnbox consol-e', html: '<b>Замечание методолога: ' + P.esc(r.title) + '</b> <small>' + P.esc(r.when + ', ' + r.author) + '</small><br>' + P.esc(r.text) })); });
        var acts = [];
        if (editable) {
            var sug = lines.filter(function (l) { return l.status === 'suggested'; });
            acts.push(P.btn('Загрузить ОСВ из 1С', function () { uploadDlg(host, M, pkg); }, 'consol-primary'));
            if (sug.length) acts.push(P.btn('Подтвердить подсказки (' + sug.length + ')', function () {
                st.work = lines.map(function (l) { return l.status === 'suggested' ? Object.assign({}, l, { status: 'mapped', base: l.base || l.article, _changed: true }) : l; }); render(host, M);
            }));
            var go = function (send) { return function (e) { var b = e.target; b.disabled = true; save(M, pkg, send).then(function () { st.work = null; st.fromOsv = false; P.toast(send ? 'Пакет отправлен в центр' : 'Черновик сохранён'); P.reload(function (M2) { render(host, M2); }); }).catch(function (er) { b.disabled = false; P.toast(er.message, true); }); }; };
            acts.push(P.btn('Сохранить черновик', go(false)));
            var sb = P.btn('Отправить в центр', go(true), ok ? 'consol-primary' : ''); sb.disabled = !ok; if (!ok) sb.title = 'Сначала исправьте красные контроли';
            acts.push(sb);
        }
        if (!isAcc(M) && P.canWrite('Пакет') && !locked) {
            if (pkg.status === 'Отправлен') {
                var ab = P.btn('Принять пакет', function () { ab.disabled = true; P.update(pkg.id, { 'Статус пакета': 'Принят', 'Принят': P.nowStr(), 'Принял': P.myName(M) }).then(function () { P.toast('Пакет принят'); P.reload(function (M2) { render(host, M2); }); }).catch(function (e) { ab.disabled = false; P.toast(e.message, true); }); }, ok ? 'consol-primary' : '');
                ab.disabled = !ok; acts.push(ab);
            }
            if (['Отправлен', 'Принят'].indexOf(pkg.status) >= 0) acts.push(P.btn('Вернуть с замечанием', function () { returnDlg(host, M, pkg); }, 'consol-danger'));
            rem.forEach(function (r) { acts.push(P.btn('Снять замечание «' + r.title + '»', function () { P.update(r.id, { 'Статус замечания': 'Снято' }).then(function () { P.reload(function (M2) { render(host, M2); }); }).catch(function (e) { P.toast(e.message, true); }); }, 'consol-small')); });
        }
        if (acts.length) host.appendChild(P.el('div', { 'class': 'consol-acts consol-mb' }, acts));
        if (st.fromOsv) host.appendChild(P.el('div', { 'class': 'consol-note', text: 'Загружена новая ОСВ: строки ещё не сохранены. «Сохранить черновик» заменит строки пакета, «Отправить в центр» - заменит и отправит.' }));
        if (!lines.length) { host.appendChild(P.el('div', { 'class': 'consol-note', text: 'Строк пакета пока нет. ' + (editable ? 'Загрузите ОСВ из 1С.' : 'Общество ещё не загрузило пакет.') })); return; }
        host.appendChild(P.el('h2', { text: 'Контроли пакета' }));
        host.appendChild(controlsBox(res));
        var ic = res.ic || [];
        if (ic.length) {
            host.appendChild(P.el('h2', { text: 'Внутригруппа: что отразили контрагенты' }));
            host.appendChild(P.table([
                { t: 'Пара', k: 'title' }, { t: 'У нас', num: true, html: function (p) { return P.fmt(p.own); } },
                { t: 'У контрагента', num: true, html: function (p) { return p.their === null ? '<span class="consol-muted">нет пакета</span>' : P.fmt(p.their); } },
                { t: 'Разница', num: true, html: function (p) { return p.diff === null ? '' : p.diff ? '<b class="consol-red">' + P.fmt(Math.abs(p.diff)) + '</b>' : '0'; } },
                { t: 'Статус', html: function (p) { return p.state === 'ok' ? P.badge('сходится', 'good') : p.state === 'diff' ? P.badge('расхождение', 'bad') : P.badge('ждём пакет: ' + p.cpStatus, 'warn'); } }
            ], ic, { rowCls: function (p) { return p.state === 'diff' ? 'consol-r-breach' : ''; } }));
        }
        host.appendChild(P.el('h2', { text: 'Строки пакета (' + lines.length + '), тыс. руб.' }));
        var opts = artOptions(M);
        host.appendChild(P.table([
            { t: 'Счёт', html: function (l) { return '<b>' + P.esc(l.acc) + '</b>'; } }, { t: 'Наименование', k: 'name' },
            { t: 'Контрагент группы', html: function (l) { return l.cp ? P.badge(l.cp, 'violet') : ''; } },
            { t: 'Статья группы', node: function (l) {
                if (!editable || l.status === 'skip') return P.el('span', { text: l.article ? l.article + ' ' + M.artBy[l.article].name : l.status === 'skip' ? 'не переносится' : '-' });
                var s = P.select(opts, l.base || (l.article && M.artBy[l.article] && M.artBy[l.article].ic ? '' : l.article)); s.setAttribute('aria-label', 'Статья для счёта ' + l.acc);
                s.onchange = function () {
                    st.work = lines.map(function (x) { if (x !== l) return x; var r = C.remap(x, s.value, M.artBy, x._osv); r._changed = true; if (!s.value) { r.status = 'unmapped'; r.article = ''; } return r; });
                    render(host, M);
                };
                var w = P.el('div', {}, [s]); if (l.cp && l.article && M.artBy[l.article].ic) w.appendChild(P.el('small', { 'class': 'consol-muted', text: ' -> ' + M.artBy[l.article].name }));
                if (l.status === 'suggested') w.appendChild(P.el('small', { 'class': 'consol-muted consol-block', text: 'подсказка: ' + (l.src || 'по счетам группы') }));
                return w;
            } },
            { t: 'Сальдо на начало', num: true, html: function (l) { return l.article && C.isBal(M.artBy[l.article]) ? P.fmt(C.disp(M.artBy[l.article], l.open)) : ''; } },
            { t: 'На конец / оборот', num: true, html: function (l) { return l.article ? P.fmt(C.disp(M.artBy[l.article], l.amount)) : P.fmt(l.amount); } },
            { t: '', html: function (l) { var m = MAP_TEXT[l.status] || MAP_TEXT.mapped; return P.badge(m[0], m[1]); } }
        ], lines, { rowCls: function (l) { return l.status === 'unmapped' ? 'consol-row-bad' : l.status === 'suggested' ? 'consol-row-hl' : ''; } }));
    }
    P.mount(render);
})();
