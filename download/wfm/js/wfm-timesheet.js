/* WFM: Табель. План и факт по календарным суткам, расхождения, правки, согласование, передача в ЗУП, журнал, выгрузка. */
(function () {
    'use strict';
    var W = window.Wfm, C = W.core, S = { tabel: '', tab: 'rows', onlyDiff: false, q: '' }, D = {};

    function closed(t) { return t['Статус табеля'] === 'Передан в ЗУП'; }
    function sumFact(recs) { return recs.reduce(function (s, r) { return s + C.num(r['Часы факт']); }, 0); }
    function reload(host) {
        var t = D.tabels.filter(function (x) { return x['Табель'] === S.tabel; })[0];
        return W.rows('Запись табеля', t._id).then(function (z) { D.recs = z; D.t = t; render(host); });
    }
    function journal() {
        return W.report('Журнал корректировок').then(function (r) { D.journal = r; }, function () { D.journal = null; });
    }
    function nextNo() {
        var mx = 0; (D.journal || []).forEach(function (r) { var n = parseInt(String(r['Корректировка']).replace(/\D/g, ''), 10); if (n > mx) mx = n; });
        return 'К-' + ('00' + (mx + 1)).slice(-3);
    }
    function editRec(r, host) {
        var t = D.t, isClosed = closed(t), canCorr = W.canWrite('Корректировка');
        if (isClosed && !canCorr) { W.toast('Табель передан в ЗУП: только чтение', true); return; }
        var fact = W.el('input', { type: 'number', step: '0.25', value: C.num(r['Часы факт']) }), why = W.el('input', { type: 'text', placeholder: 'Причина правки' });
        var comment = W.el('input', { type: 'text', value: r['Комментарий'] || '' });
        var body = W.el('div', {}, [W.el('p', { text: D.emps[r['Сотрудник']]['ФИО'] + ', ' + r['Запись табеля'] + (isClosed ? ' - табель передан в ЗУП, нужна причина' : '') }),
            W.field('Часы факт', fact), isClosed ? W.field('Причина (обязательна)', why) : W.field('Комментарий', comment)]);
        W.modal('Исправить запись табеля', body, [{ text: 'Отмена' }, { text: 'Сохранить', cls: 'wfm-primary', keep: true, fn: function (close) {
            if (isClosed && !why.value.trim()) { W.toast('Укажите причину правки', true); return false; }
            var old = C.num(r['Часы факт']), val = C.num(fact.value);
            var f = { 'Часы факт': val }; if (!isClosed) f['Комментарий'] = comment.value;
            W.post('_m_set/' + r._id + '?JSON', { fields: f }).then(function () {
                if (!isClosed) return null;
                return W.post('_m_new/' + W.tid('Корректировка') + '?JSON', { up: r._id, fields: { 'Корректировка': nextNo(), 'Дата правки': W.TODAY, 'Было, ч': old, 'Стало, ч': val, 'Причина': why.value.trim(), 'Автор': W.ctx.user, 'После передачи': 1 } });
            }).then(function () { W.toast('Сохранено'); close(); return journal().then(function () { return reload(host); }); }).catch(function (e) { W.toast(e.message, true); });
            return false; } }]);
    }
    function setStatus(host, status, extra) {
        var f = { 'Статус табеля': status }; Object.keys(extra || {}).forEach(function (k) { f[k] = extra[k]; });
        W.post('_m_set/' + D.t._id + '?JSON', { fields: f }).then(function () {
            Object.keys(f).forEach(function (k) { D.t[k] = k === 'Передан в ЗУП' ? C.toDmy(f[k]) : f[k]; });
            W.toast('Статус: ' + status); render(host);
        }).catch(function (e) { W.toast(e.message, true); });
    }
    function exportZup() {
        var kinds = {}; D.kinds.forEach(function (k) { kinds[k['Код']] = { reduces: !!k['Уменьшает норму'] }; });
        var byName = {}; D.kinds.forEach(function (k) { byName[k['Вид времени']] = k['Код']; });
        var rows = C.zupRows(D.recs.map(function (r) { return { emp: r['Сотрудник'], kind: byName[r['Вид времени']] || r['Вид времени'], fact: r['Часы факт'], night: r['Ночные часы'], holiday: r['Праздничные часы'] }; }), kinds);
        rows.forEach(function (x) { x.fio = D.emps[x.emp] ? D.emps[x.emp]['ФИО'] : ''; });
        W.download('zup-' + S.tabel + '.csv', C.toCsv(rows, [['emp', 'Табельный номер'], ['fio', 'ФИО'], ['kind', 'Вид времени'], ['days', 'Дней'], ['hours', 'Часов'], ['night', 'Ночных'], ['holiday', 'Праздничных']]));
    }
    function render(host) {
        host.innerHTML = ''; var t = D.t, tol = D.rules.tolerance, isClosed = closed(t);
        var rows = D.recs.map(function (r) {
            var d = C.num(r['Часы факт']) - C.num(r['Часы план']); var e = D.emps[r['Сотрудник']] || {};
            return { rec: r, date: r['Запись табеля'], fio: e['ФИО'] || r['Сотрудник'], tab: r['Сотрудник'], kind: r['Вид времени'], plan: r['Часы план'], fact: r['Часы факт'], diff: C.round2(d), night: r['Ночные часы'], hol: r['Праздничные часы'], inn: r['Вход факт'], out: r['Выход факт'], src: r['Источник факта'], note: r['Комментарий'], bad: Math.abs(d) > tol };
        }).filter(function (x) { return (!S.onlyDiff || x.bad) && (!S.q || x.fio.toLowerCase().indexOf(S.q.toLowerCase()) >= 0); });
        rows.sort(function (a, b) { var da = C.toIso(a.date), db = C.toIso(b.date); return da < db ? -1 : da > db ? 1 : (a.fio < b.fio ? -1 : 1); });
        var total = sumFact(D.recs), ctrl = C.num(t['Контрольная сумма часов']), delta = C.round2(total - ctrl);
        host.appendChild(W.el('h1', { text: 'Табель' }));
        var sel = W.select(D.tabels.map(function (x) { return x['Табель']; }), S.tabel); sel.onchange = function () { S.tabel = sel.value; reload(host); };
        var only = W.el('input', { type: 'checkbox', id: 'wfm-only', onchange: function () { S.onlyDiff = only.checked; render(host); } }); only.checked = S.onlyDiff;
        var q = W.el('input', { type: 'search', placeholder: 'Поиск по ФИО', value: S.q }); q.onchange = function () { S.q = q.value; render(host); };
        host.appendChild(W.el('div', { 'class': 'wfm-bar' }, [W.field('Табель', sel), W.field('Сотрудник', q),
            W.el('label', { 'class': 'wfm-field' }, [W.el('span', { text: 'Допуск ' + W.right(tol) + ' ч' }), W.el('span', {}, [only, ' только расхождения'])]),
            W.el('span', { html: 'Статус: ' + W.badge(t['Статус табеля'], isClosed ? 'ok' : 'warn') })]));
        host.appendChild(W.tabs([['rows', 'Записи'], ['zup', 'Передача в ЗУП'], ['log', 'Журнал правок']], S.tab, function (x) { S.tab = x; render(host); }));
        if (S.tab === 'rows') {
            var edit = W.canWrite('Запись табеля') && (!isClosed || W.canWrite('Корректировка'));
            host.appendChild(W.el('p', { 'class': 'wfm-sub', text: 'Строк: ' + rows.length + ' из ' + D.recs.length + '. ' + (edit ? 'Клик по строке - исправить.' : 'Только чтение.') }));
            host.appendChild(W.table([{ k: 'date', t: 'Дата' }, { k: 'fio', t: 'Сотрудник' }, { k: 'kind', t: 'Вид времени' }, { k: 'plan', t: 'План', num: 1 }, { k: 'fact', t: 'Факт', num: 1 }, { k: 'diff', t: 'Разность', num: 1 },
                { k: 'night', t: 'Ночные', num: 1 }, { k: 'hol', t: 'Праздничные', num: 1 }, { k: 'inn', t: 'Вход' }, { k: 'out', t: 'Выход' }, { k: 'src', t: 'Источник' }, { k: 'note', t: 'Комментарий' }], rows,
                { rowCls: function (x) { return x.bad ? 'wfm-row-warn' : ''; }, onrow: edit ? function (x) { editRec(x.rec, host); } : null }));
        } else if (S.tab === 'zup') {
            var kv = function (k, v) { return W.el('div', { 'class': 'wfm-kv' }, [W.el('span', { text: k }), W.el('span', { html: v })]); };
            var card = W.el('div', { 'class': 'wfm-card', style: 'max-width:420px' }, [W.el('h3', { text: 'Контроль передачи' }), kv('Передан в ЗУП', W.esc(t['Передан в ЗУП'] || '-')), kv('Контрольная сумма, ч', W.right(ctrl)), kv('Сумма по записям, ч', W.right(total)),
                kv('Расхождение, ч', W.badge(W.right(delta), isClosed && delta !== 0 ? 'crit' : 'ok'))]);
            host.appendChild(card);
            if (isClosed && delta !== 0) host.appendChild(W.el('p', { 'class': 'wfm-error', text: 'После передачи в табель внесены правки: итог не равен контрольной сумме, нужно повторное согласование.' }));
            var acts = [W.btn('Выгрузка для ЗУП (CSV)', exportZup)];
            if (W.canWrite('Табель')) {
                if (t['Статус табеля'] === 'Черновик') acts.push(W.btn('Согласовать', function () { setStatus(host, 'Согласован'); }));
                if (t['Статус табеля'] === 'Согласован') acts.push(W.btn('Передать в ЗУП', function () { setStatus(host, 'Передан в ЗУП', { 'Передан в ЗУП': W.TODAY, 'Контрольная сумма часов': C.round2(total) }); }, 'wfm-primary'));
                if (isClosed && delta !== 0) acts.push(W.btn('Согласовать повторно', function () { setStatus(host, 'Согласован'); }, 'wfm-primary'));
            }
            host.appendChild(W.el('div', { 'class': 'wfm-bar' }, acts));
        } else {
            var j = (D.journal || []).filter(function (x) { return x['Табель'] === S.tabel; });
            host.appendChild(D.journal === null ? W.el('p', { 'class': 'wfm-sub', text: 'Журнал правок недоступен для вашей роли.' }) :
                W.table([{ k: 'Корректировка', t: 'Правка' }, { k: 'Дата записи', t: 'Запись' }, { k: 'Сотрудник', t: 'Таб. №' }, { k: 'Дата правки', t: 'Дата правки' }, { k: 'Было', t: 'Было, ч', num: 1 }, { k: 'Стало', t: 'Стало, ч', num: 1 }, { k: 'Причина', t: 'Причина' }, { k: 'Автор', t: 'Автор' },
                    { k: 'После передачи', t: 'После передачи', html: function (x) { return x['После передачи'] ? W.badge('да', 'warn') : ''; } }], j, { empty: 'Правок нет' }));
        }
    }
    W.mount(function (host) {
        return Promise.all([W.rows('Табель'), W.rows('Сотрудник'), W.rows('Правило'), W.rows('Вид времени'), journal()]).then(function (r) {
            D.tabels = r[0].sort(function (a, b) { return a['Табель'] < b['Табель'] ? -1 : 1; }); D.emps = W.map(r[1], 'Сотрудник'); D.rules = W.rules(r[2]); D.kinds = r[3];
            if (!D.tabels.length) throw new Error('Нет доступных табелей');
            var h = decodeURIComponent((location.hash.match(/tabel=([^&]*)/) || [])[1] || '');
            S.tabel = D.tabels.some(function (t) { return t['Табель'] === h; }) ? h : D.tabels[D.tabels.length - 1]['Табель'];
            return reload(host);
        });
    });
})();
