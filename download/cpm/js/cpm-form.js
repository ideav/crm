/* CPM: форма бюджета ЦФО - статьи x месяцы как в Excel, правила контроля при вводе, сравнение с прошлым годом и прошлым кругом. */
(function () {
    'use strict';
    var P = window.Cpm, C = P.core;
    function kv(x) { return x === null || x === undefined ? '' : String(Math.round(C.num(x) / 100) / 10).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
    function clone(v) { var o = {}; Object.keys(v).forEach(function (k) { o[k] = v[k].slice(); }); return o; }
    function sel(opts, value, onchange) { var s = P.select(opts, value); s.addEventListener('change', function () { onchange(s.value); }); return s; }

    function render(host, M) {
        var h = P.hash();
        var cfos = M.isHead ? M.cfos.filter(function (c) { return c.name === M.myCfo; }) : M.cfos;
        var cfo = (h.cfo && M.cfoBy[h.cfo]) ? h.cfo : (M.myCfo || (cfos[0] && cfos[0].name));
        var version = h.v && M.verBy[h.v] ? h.v : P.CUR;
        var ver = M.verBy[version], cfoObj = M.cfoBy[cfo] || {};
        var budget = P.budgetOf(M, cfo, version);
        var arts = C.cfoArticles(M.rows, cfo, M.articles);
        var g = C.grid(M.rows, cfo, version), before = g.values;
        arts.forEach(function (a) { if (!before[a.name]) before[a.name] = [null, null, null, null, null, null, null, null, null, null, null, null]; });
        var cur = clone(before);
        var baseName = ver && ver.year === 2027 ? P.PLAN : null, cmpName = ver && ver.compare && ver.compare !== baseName ? ver.compare : null;
        var base = baseName ? C.grid(M.rows, cfo, baseName).values : {}, cmp = cmpName ? C.grid(M.rows, cfo, cmpName).values : {};
        var editable = !M.readOnly && C.canEdit(ver, budget && budget.status, M.isFinance) && (M.isFinance || cfo === M.myCfo);
        var cells = {}, totals = {}, issuesBox = P.el('div', { 'class': 'cpm-issues' }), dirty = P.el('span', { 'class': 'cpm-muted' });

        host.innerHTML = '';
        P.head('Форма бюджета ЦФО', 'Та же форма, что и в Excel: статьи по строкам, месяцы по столбцам, суммы в тыс. ₽. Tab и Enter переходят по ячейкам, блок из Excel вставляется Ctrl+V с любой ячейки. Правила контроля срабатывают сразу при вводе.').forEach(function (n) { host.appendChild(n); });
        var go = function (c, v) { location.hash = 'cfo=' + encodeURIComponent(c) + '&v=' + encodeURIComponent(v); };
        var bar = P.el('div', { 'class': 'cpm-toolbar' }, [
            P.field('ЦФО', sel(cfos.map(function (c) { return [c.name, c.name + ' · ' + ((P.map(M.entities, 'name')[c.entity] || {}).role || c.entity)]; }), cfo, function (v) { go(v, version); })),
            P.field('Версия', sel(M.versions.map(function (v) { return [v.name, v.name + (v.locked ? ' (замок)' : '')]; }), version, function (v) { go(cfo, v); })),
            P.el('div', { 'class': 'cpm-grow', html: (budget ? P.badge(budget.status, P.STATUS_KIND[budget.status]) + ' <span class="cpm-muted">срок ' + P.date(budget.deadline) + (budget.submitted ? ', сдан ' + P.date(budget.submitted) : '') + '</span>' : '') + (ver && ver.locked ? ' ' + P.badge('версия утверждена: правка только новой версией', 'mute') : '') }),
            dirty
        ]);
        host.appendChild(bar);
        var acts = P.el('div', { 'class': 'cpm-toolbar' });
        if (editable) {
            acts.appendChild(P.btn('Сохранить', function () { save(false); }, 'cpm-primary'));
            if (budget && !/Сдан|Утверждён|Принят/.test(budget.status)) acts.appendChild(P.btn('Отправить на согласование', function () { save(true); }));
            acts.appendChild(P.btn('Вставить из Excel', pasteDialog));
        }
        acts.appendChild(P.btn('Выгрузить в Excel', exportCsv));
        if (!M.isHead) acts.appendChild(P.el('a', { 'class': 'cpm-btn cpm-primary', href: P.nav('svod', 'v=' + encodeURIComponent(version)), text: 'Свод по группе →', style: 'text-decoration:none;display:inline-flex;align-items:center' }));
        host.appendChild(acts);
        host.appendChild(P.el('p', { 'class': 'cpm-muted', text: 'Макропараметры кампании: ' + M.macros.map(function (m) { return m.name + ' ' + String(m.value).replace('.', ',') + (m.unit === '%' ? '%' : ' ' + m.unit); }).join(' · ') + '. Руководитель ЦФО: ' + (cfoObj.head || '') + '.' }));
        if (budget && budget.comment) host.appendChild(P.el('div', { 'class': 'cpm-note' + (budget.status === 'Возвращён' ? ' cpm-bad' : ''), html: '<b>Комментарий финансиста:</b> ' + P.esc(budget.comment) }));
        if (!arts.length) { host.appendChild(P.el('div', { 'class': 'cpm-note', text: 'У ЦФО пока нет статей. Экономист добавляет статьи в справочник «Статья бюджета» без программиста.' })); return; }

        /* шапка таблицы */
        var hr = [P.el('th', { 'class': 'cpm-xl-name', text: 'Статья' })];
        C.MONTHS.forEach(function (m) { hr.push(P.el('th', { text: m })); });
        hr.push(P.el('th', { text: 'Итого ' + (ver ? ver.year : '') }));
        if (baseName) { hr.push(P.el('th', { text: baseName })); hr.push(P.el('th', { text: 'к ' + (ver.year - 1) })); }
        if (cmpName) { hr.push(P.el('th', { text: cmpName.replace('Бюджет 2027 · ', '') })); hr.push(P.el('th', { text: 'Δ к кругу' })); }
        var tbody = P.el('tbody');
        var flatArts = [];
        M.groups.forEach(function (gr) {
            var list = arts.filter(function (a) { return a.group === gr; });
            if (!list.length) return;
            var gtr = P.el('tr', { 'class': 'cpm-xl-grp' }, [P.el('td', { 'class': 'cpm-xl-name', text: gr })]);
            totals['g:' + gr] = [];
            for (var i = 0; i < 13; i++) { var td = P.el('td', { 'class': i < 12 ? 'cpm-xl-v' : 'cpm-xl-tot' }); totals['g:' + gr].push(td); gtr.appendChild(td); }
            if (baseName) { gtr.appendChild(totals['gb:' + gr] = P.el('td', { 'class': 'cpm-xl-v' })); gtr.appendChild(P.el('td')); }
            if (cmpName) { gtr.appendChild(totals['gc:' + gr] = P.el('td', { 'class': 'cpm-xl-v' })); gtr.appendChild(P.el('td')); }
            tbody.appendChild(gtr);
            list.forEach(function (a) {
                flatArts.push(a.name);
                var tr = P.el('tr', {}, [P.el('td', { 'class': 'cpm-xl-name', title: a.name + (a.owner ? ' (ответственный: ' + a.owner + ')' : ''), html: '<span class="cpm-xl-code">' + P.esc(a.code) + '</span>' + P.esc(a.name) + (a.intra ? ' ' + P.badge('внутри группы', 'mute') : '') })]);
                cells[a.name] = [];
                for (var m = 0; m < 12; m++) {
                    var inp = P.input('text', kv(cur[a.name][m]), { inputmode: 'decimal', 'aria-label': a.name + ', ' + C.MONTHS[m], 'data-a': a.name, 'data-m': m });
                    if (!editable) inp.disabled = true;
                    inp.addEventListener('input', onInput); inp.addEventListener('keydown', onKey); inp.addEventListener('paste', onPaste);
                    inp.addEventListener('blur', function (e) { var t = e.target; t.value = kv(cur[t.dataset.a][+t.dataset.m]); });
                    var td = P.el('td', {}, [inp]); cells[a.name].push(td); tr.appendChild(td);
                }
                tr.appendChild(totals[a.name] = P.el('td', { 'class': 'cpm-xl-tot' }));
                if (baseName) { tr.appendChild(P.el('td', { 'class': 'cpm-xl-v', text: kv(C.sum(base[a.name])) })); tr.appendChild(totals['p:' + a.name] = P.el('td', { 'class': 'cpm-xl-v' })); }
                if (cmpName) { tr.appendChild(P.el('td', { 'class': 'cpm-xl-v', text: kv(C.sum(cmp[a.name])) })); tr.appendChild(totals['c:' + a.name] = P.el('td', { 'class': 'cpm-xl-v' })); }
                tbody.appendChild(tr);
            });
        });
        var res = P.el('tr', { 'class': 'cpm-xl-sum' }, [P.el('td', { 'class': 'cpm-xl-name', text: 'Результат ЦФО (доходы минус расходы)' })]);
        totals.res = [];
        for (var i = 0; i < 13; i++) { var td = P.el('td', { 'class': i < 12 ? 'cpm-xl-v' : 'cpm-xl-tot' }); totals.res.push(td); res.appendChild(td); }
        if (baseName) { res.appendChild(totals.resb = P.el('td', { 'class': 'cpm-xl-v' })); res.appendChild(P.el('td')); }
        if (cmpName) { res.appendChild(totals.resc = P.el('td', { 'class': 'cpm-xl-v' })); res.appendChild(P.el('td')); }
        tbody.appendChild(res);
        host.appendChild(P.el('div', { 'class': 'cpm-xl-wrap' }, [P.el('table', { 'class': 'cpm-xl' }, [P.el('thead', {}, [P.el('tr', {}, hr)]), tbody])]));
        host.appendChild(issuesBox);
        if (!editable) host.appendChild(P.el('p', { 'class': 'cpm-muted', text: ver && ver.locked ? 'Версия под замком: цифры утверждены, изменения вносятся только новой версией (рефорекаст).' : M.readOnly ? 'Режим просмотра.' : 'Бюджет сдан на согласование: правка после возврата финансистом.' }));
        refresh();

        function sign(a) { return (M.artBy[a] || {}).kind === 'Доход' ? 1 : -1; }
        function refresh() {
            var resM = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], resB = 0, resC = 0, changed = 0;
            M.groups.forEach(function (gr) {
                if (!totals['g:' + gr]) return;
                var gm = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], gb = 0, gc = 0;
                arts.filter(function (a) { return a.group === gr; }).forEach(function (a) {
                    var v = cur[a.name], t = C.sum(v), b = C.sum(base[a.name]), c = C.sum(cmp[a.name]), s = sign(a.name);
                    v.forEach(function (x, m) { gm[m] += C.num(x); resM[m] += s * C.num(x); var o = before[a.name][m]; if ((o === null ? null : C.num(o)) !== (x === null ? null : C.num(x))) { changed++; cells[a.name][m].classList.add('cpm-c-chg'); } else cells[a.name][m].classList.remove('cpm-c-chg'); });
                    gb += b; gc += c; resB += s * b; resC += s * c;
                    totals[a.name].textContent = kv(t);
                    var tp = totals['p:' + a.name];
                    if (tp) { var p = C.growthPct(t, b); tp.textContent = P.pct(p, true); tp.className = 'cpm-xl-v ' + (p > 0 ? (s < 0 ? 'cpm-up' : 'cpm-down') : ''); }
                    var tc = totals['c:' + a.name];
                    if (tc) tc.textContent = t - c ? (t - c > 0 ? '+' : '') + kv(t - c) : '';
                });
                gm.forEach(function (x, m) { totals['g:' + gr][m].textContent = kv(x); });
                totals['g:' + gr][12].textContent = kv(C.sum(gm));
                if (totals['gb:' + gr]) totals['gb:' + gr].textContent = kv(gb);
                if (totals['gc:' + gr]) totals['gc:' + gr].textContent = kv(gc);
            });
            resM.forEach(function (x, m) { totals.res[m].textContent = kv(x); });
            totals.res[12].textContent = kv(C.sum(resM));
            if (totals.resb) totals.resb.textContent = kv(resB);
            if (totals.resc) totals.resc.textContent = kv(resC);
            /* правила контроля */
            Object.keys(cells).forEach(function (a) { cells[a].forEach(function (td) { td.classList.remove('cpm-c-err', 'cpm-c-warn'); }); totals[a].classList.remove('cpm-c-warn'); });
            var issues = C.checkGrid(cur, base, M.rules);
            P.formIssues = issues;
            issuesBox.innerHTML = '';
            issues.forEach(function (i) {
                var td = i.month === null ? totals[i.article] : cells[i.article] && cells[i.article][i.month];
                if (td) td.classList.add(i.level === 'error' ? 'cpm-c-err' : 'cpm-c-warn');
            });
            var grouped = {};
            issues.forEach(function (i) { var k = i.article + '|' + i.rule; (grouped[k] = grouped[k] || []).push(i); });
            Object.keys(grouped).forEach(function (k) {
                var l = grouped[k], i = l[0];
                var where = i.month === null ? 'за год ' + P.pct(i.pct, true) : l.map(function (x) { return C.MONTHS[x.month]; }).join(', ');
                issuesBox.appendChild(P.el('div', { 'class': 'cpm-issue ' + (i.level === 'error' ? 'cpm-e' : 'cpm-w'), text: (i.level === 'error' ? 'Ошибка' : 'Проверьте') + ' · ' + i.article + ' (' + where + '): ' + i.msg + ' [правило «' + i.rule + '»]',
                    onclick: function () { var td = i.month === null ? cells[i.article][0] : cells[i.article][i.month]; var inp = td && td.querySelector('input'); if (inp) inp.focus(); } }));
            });
            if (!issues.length) issuesBox.appendChild(P.el('div', { 'class': 'cpm-note cpm-good', text: 'Правила контроля пройдены: ' + M.rules.filter(function (r) { return r.on; }).length + ' правил, замечаний нет.' }));
            dirty.textContent = changed ? 'Изменено ячеек: ' + changed + ' (не сохранено)' : '';
        }
        function setCell(a, m, raw) {
            var s = String(raw).trim();
            cur[a][m] = s === '' ? null : Math.round(C.num(s) * 1000);
        }
        function onInput(e) { var t = e.target; setCell(t.dataset.a, +t.dataset.m, t.value); refresh(); }
        function focusCell(a, m) { var td = cells[a] && cells[a][m]; var i = td && td.querySelector('input'); if (i) { i.focus(); i.select(); } }
        function onKey(e) {
            var t = e.target, a = t.dataset.a, m = +t.dataset.m, r = flatArts.indexOf(a);
            if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); if (flatArts[r + 1]) focusCell(flatArts[r + 1], m); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); if (r > 0) focusCell(flatArts[r - 1], m); }
        }
        function fill(grid, a0, m0) {
            var r0 = flatArts.indexOf(a0), n = 0;
            grid.forEach(function (row, i) {
                var a = flatArts[r0 + i]; if (!a) return;
                row.forEach(function (v, j) { var m = m0 + j; if (m > 11) return; cur[a][m] = v === null ? null : Math.round(v * 1000); var inp = cells[a][m].querySelector('input'); inp.value = kv(cur[a][m]); n++; });
            });
            refresh();
            return n;
        }
        function onPaste(e) {
            var text = (e.clipboardData || window.clipboardData).getData('text');
            if (!/[\t\n]/.test(text)) return;
            e.preventDefault();
            var n = fill(C.parseTsv(text), e.target.dataset.a, +e.target.dataset.m);
            P.toast('Вставлено ячеек: ' + n);
        }
        function pasteDialog() {
            var ta = P.el('textarea', { rows: 8, style: 'width:100%;font-family:monospace', placeholder: 'Скопируйте в Excel блок «статьи x 12 месяцев» (в тыс. ₽) и вставьте сюда. Строки заполняются по порядку статей формы, начиная с «' + flatArts[0] + '».' });
            P.modal('Вставить из Excel', P.el('div', {}, [ta]), [{ text: 'Отмена' }, { text: 'Вставить', cls: 'cpm-primary', fn: function () { var n = fill(C.parseTsv(ta.value), flatArts[0], 0); P.toast('Вставлено ячеек: ' + n); } }], true);
        }

        function exportCsv() {
            var head = ['Код', 'Статья'].concat(C.MONTHS, ['Итого']);
            var rows = arts.map(function (a) { return [a.code, a.name].concat(cur[a.name].map(function (x) { return x === null ? '' : String(C.num(x) / 1000).replace('.', ','); }), [String(C.sum(cur[a.name]) / 1000).replace('.', ',')]); });
            P.download('Бюджет ' + cfo + ' ' + version + '.csv', C.toCsv(head, rows));
        }
        function save(submit) {
            var issues = P.formIssues || [];
            if (submit && C.hasErrors(issues)) { P.toast('Не отправлено: исправьте ошибки (подсвечены красным)', true); return; }
            var warns = issues.filter(function (i) { return i.level === 'warn'; });
            var ops = C.saveOps(before, cur, g.ids, { year: ver.year, cfoId: cfoObj.id, versionId: ver.id, articleIds: M.artIds });
            function finish(note) {
                var n = ops.length;
                P.batch(ops).then(function () {
                    if (!budget) return null;
                    if (submit) return P.update(budget.id, { 'Статус сдачи': 'Сдан', 'Сдан': P.TODAY });
                    if (budget.status === 'Не начат') return P.update(budget.id, { 'Статус сдачи': 'Черновик' });
                    return null;
                }).then(function () {
                    return P.log(cfo + ': ' + (submit ? 'сдан на согласование' + (note ? ' («' + note + '»)' : '') : 'сохранено ячеек ' + n), cfo, version);
                }).then(function () {
                    P.toast(submit ? 'Бюджет отправлен на согласование, свод обновлён' : 'Сохранено ячеек: ' + n);
                    P.mount(render);
                }).catch(function (e) { P.toast('Ошибка записи: ' + e.message, true); });
            }
            if (submit && warns.length) {
                var ta = P.el('textarea', { rows: 3, style: 'width:100%' });
                var list = P.el('ul', {}, warns.map(function (w) { return P.el('li', { text: w.article + ': ' + w.msg }); }));
                P.modal('Пояснение к предупреждениям', P.el('div', {}, [P.el('p', { text: 'Правила нашли отклонения. Пояснение увидят финансист и бюджетный комитет:' }), list, P.field('Пояснение', ta)]),
                    [{ text: 'Отмена' }, { text: 'Отправить', cls: 'cpm-primary', fn: function () { if (!ta.value.trim()) { P.toast('Напишите пояснение', true); return false; } finish(ta.value.trim()); } }], true);
            } else if (!submit && !ops.length) P.toast('Изменений нет');
            else finish('');
        }
    }
    P.mount(render);
    window.addEventListener('hashchange', function () { P.mount(render); });
})();
