/* Склад СИЗ: сканирование табельного и штрихкода СИЗ, комплект к выдаче по нормам, остатки по размеру, подпись на экране, личная карточка заполняется сама. */
(function () {
    'use strict';
    var A = window.Suot, C = A.core, el = A.el;
    var picked = null, chosen = {}, reasons = {};
    A.mount(function (host, M) {
        var T = M.today, h = A.hash();
        if (!picked && h.w && M.workerBy[h.w]) picked = h.w;
        host.appendChild(el('div', {}, A.head('Склад: выдача СИЗ', 'Сканер работает как клавиатура: табельный номер с пропуска, затем штрихкод СИЗ. Система сама показывает, что положено по норме, какой размер и есть ли он на складе; выдача вне нормы или раньше срока — только с причиной.')));
        var inp = A.input('text', '', { placeholder: 'Сканируйте пропуск или СИЗ', 'aria-label': 'Код со сканера' });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { scan(inp.value); inp.value = ''; } });
        var demo = el('span', { 'class': 'suot-muted' }, ['Коды для демо: ', A.btn('ТН-0412', function () { scan('ТН-0412'); }, 'suot-small'), ' ', A.btn('SIZ-107 привязь', function () { scan('SIZ-107'); }, 'suot-small'), ' ', A.btn('SIZ-103 каска', function () { scan('SIZ-103'); }, 'suot-small'), ' ', A.btn('SIZ-113 утеплённый', function () { scan('SIZ-113'); }, 'suot-small')]);
        host.appendChild(el('div', { 'class': 'suot-scan' }, [inp, A.btn('Найти', function () { scan(inp.value); inp.value = ''; }), demo]));
        setTimeout(function () { inp.focus(); }, 50);
        var w = picked && M.workerBy[picked];
        if (!w) {
            host.appendChild(el('p', { 'class': 'suot-muted', text: 'Отсканируйте пропуск работника или выберите из списка.' }));
            var sel = A.workerSelect(M, ''); sel.insertBefore(el('option', { value: '', text: '— выбрать —' }), sel.firstChild); sel.value = '';
            sel.addEventListener('change', function () { picked = sel.value; chosen = {}; A.render(); });
            host.appendChild(A.field('Работник', sel));
            host.appendChild(stockTable(M));
            return;
        }
        var card = C.ppeCard(w, M, T);
        if (!Object.keys(chosen).length) card.forEach(function (c) { if (c.state === 'none' || c.state === 'over' || c.state === 'soon') chosen[c.ppe] = 1; });
        host.appendChild(el('div', { 'class': 'suot-card' }, [el('h2', { text: w.name + ' · ' + w.tab }), el('div', { 'class': 'suot-muted', text: w.pos + ' · ' + w.dept + ' · одежда ' + w.sizes.clothes + ' · обувь ' + w.sizes.shoes + ' · голова ' + w.sizes.head + ' · перчатки ' + w.sizes.gloves }),
            el('div', { 'class': 'suot-bar' }, [A.btn('Другой работник', function () { picked = null; chosen = {}; reasons = {}; A.render(); }), A.btn('Открыть карточку', function () { location.href = A.nav('card', 'w=' + encodeURIComponent(w.name)); })])]));
        /* к выдаче: позиции норм + отсканированные вне нормы */
        var rows = card.map(function (c) { return { ppe: c.ppe, card: c }; });
        Object.keys(chosen).forEach(function (p) { if (!card.some(function (c) { return c.ppe === p; })) rows.push({ ppe: p, card: null }); });
        rows.forEach(function (r) {
            var ppe = M.ppeBy[r.ppe] || {};
            r.size = C.sizeFor(w, ppe); r.qty = r.card ? r.card.qty : 1;
            r.stock = C.stockOf(M.batches, r.ppe, r.size);
            r.chk = C.issueCheck(w, r.ppe, M, T);
        });
        host.appendChild(el('h2', { text: 'К выдаче' }));
        var tbl = A.table([
            { t: '', html: function () { return ''; }, cls: function () { return 'suot-pick'; } },
            { t: 'СИЗ', html: function (r) { return A.esc(r.ppe) + '<br><small class="suot-muted">' + A.esc((M.ppeBy[r.ppe] || {}).code || '') + '</small>'; } },
            { t: 'По норме', html: function (r) { return r.card ? A.stateBadge(r.card.state, r.card.due) + (r.card.last ? '<br><small class="suot-muted">выдано ' + C.toDmy(r.card.last) + '</small>' : '') : A.badge('вне нормы', 'crit'); } },
            { t: 'Кол-во', k: 'qty', num: 1 }, { t: 'Размер', html: function (r) { return A.esc(r.size || 'универсальный'); } },
            { t: 'На складе', html: function (r) { return r.stock >= r.qty ? String(r.stock) : A.badge(r.stock ? 'мало: ' + r.stock : 'нет на складе', 'crit'); }, num: 1 },
            { t: 'Проверка', html: function (r) { return '<small>' + A.esc(r.chk.message) + '</small>'; } },
            { t: 'Причина', html: function () { return ''; }, cls: function () { return 'suot-why'; } }
        ], rows, { rowCls: function (r) { return chosen[r.ppe] ? 'suot-row-warn' : ''; } });
        host.appendChild(tbl);
        var picks = tbl.querySelectorAll('.suot-pick'), whys = tbl.querySelectorAll('.suot-why');
        rows.forEach(function (r, i) {
            var cb = A.input('checkbox', '', { 'aria-label': 'Выдать ' + r.ppe }); cb.checked = !!chosen[r.ppe]; cb.disabled = r.stock < r.qty;
            cb.addEventListener('change', function () { if (cb.checked) chosen[r.ppe] = 1; else delete chosen[r.ppe]; A.render(); });
            picks[i].appendChild(cb);
            if (chosen[r.ppe] && r.chk.needReason) { var ri = A.input('text', reasons[r.ppe] || '', { placeholder: 'износ, порча, утеря…' }); ri.addEventListener('input', function () { reasons[r.ppe] = ri.value; }); whys[i].appendChild(ri); }
        });
        var todo = rows.filter(function (r) { return chosen[r.ppe] && r.stock >= r.qty; });
        host.appendChild(el('div', { 'class': 'suot-bar' }, [el('div', { 'class': 'suot-grow', text: todo.length ? 'Отмечено к выдаче: ' + todo.length : 'Ничего не отмечено' }),
            A.canWrite('Выдача СИЗ') ? A.btn('Выдать и подписать (' + todo.length + ')', function () { sign(M, w, todo); }, 'suot-primary') : el('span', { 'class': 'suot-muted', text: 'Роль не выдаёт СИЗ' })]));
        host.appendChild(stockTable(M));

        function scan(text) {
            var s = C.parseScan(text, M);
            if (s.worker) { picked = s.worker.name; chosen = {}; reasons = {}; }
            if (s.ppe) { if (!picked) { A.toast('Сначала пропуск работника', 1); return; } chosen[s.ppe.name] = 1; }
            if (!s.worker && !s.ppe) { A.toast('Код «' + text + '» не найден', 1); return; }
            A.render();
        }
    });
    function stockTable(M) {
        var by = {};
        M.batches.forEach(function (b) { var k = b.ppe; by[k] = by[k] || { ppe: k, qty: 0, sizes: [] }; by[k].qty += b.qty; if (b.size) by[k].sizes.push(b.size + ': ' + b.qty); });
        var rows = Object.keys(by).map(function (k) { return by[k]; });
        return el('div', {}, [el('h2', { text: 'Остатки на складе' }), A.table([{ t: 'СИЗ', k: 'ppe' }, { t: 'Всего', k: 'qty', num: 1 }, { t: 'По размерам', html: function (r) { return '<small>' + A.esc(r.sizes.join(' · ') || 'универсальный') + '</small>'; } }], rows, { rowCls: function (r) { return r.qty === 0 ? 'suot-row-bad' : r.qty < 5 ? 'suot-row-warn' : ''; } })]);
    }
    /* Подпись пальцем: отпечаток штрихов + время = идентифицирующие сведения (766н, п. 26). */
    function sign(M, w, todo) {
        var miss = todo.filter(function (r) { return r.chk.needReason && !(reasons[r.ppe] || '').trim(); });
        if (miss.length) { A.toast('Укажите причину: ' + miss.map(function (r) { return r.ppe; }).join(', '), 1); return; }
        var cv = el('canvas', { 'class': 'suot-sign', width: 640, height: 180, 'aria-label': 'Поле подписи' }), pts = [], draw = false, ctx = cv.getContext('2d');
        function xy(e) { var r = cv.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * cv.width / r.width), Math.round((e.clientY - r.top) * cv.height / r.height)]; }
        cv.addEventListener('pointerdown', function (e) { draw = true; var p = xy(e); pts.push(p.join(',')); ctx.beginPath(); ctx.moveTo(p[0], p[1]); });
        cv.addEventListener('pointermove', function (e) { if (!draw) return; var p = xy(e); pts.push(p.join(',')); ctx.lineWidth = 2.5; ctx.strokeStyle = '#0f172a'; ctx.lineTo(p[0], p[1]); ctx.stroke(); });
        window.addEventListener('pointerup', function () { draw = false; });
        var list = el('ul', {}, todo.map(function (r) { return el('li', { text: r.ppe + ' — ' + r.qty + ' · размер ' + (r.size || 'универсальный') }); }));
        A.modal('Подпись получения: ' + w.name, el('div', {}, [list, el('p', { 'class': 'suot-muted', text: 'Работник расписывается пальцем на экране планшета или телефона.' }), cv]), [{ text: 'Отмена' }, { text: 'Очистить', keep: 1, fn: function () { pts = []; ctx.clearRect(0, 0, cv.width, cv.height); } }, { text: 'Подтвердить выдачу', cls: 'suot-primary', keep: 1, fn: function (close) {
            if (pts.length < 8) { A.toast('Нет подписи', 1); return; }
            var stamp = A.stamp(), sig = 'Подпись на экране ' + stamp + ', отпечаток ' + C.fingerprint(w.tab + '|' + pts.join(';'));
            var n = M.issues.reduce(function (m, i) { var x = parseInt(String(i.code).split('-').pop(), 10) || 0; return Math.max(m, x); }, 0);
            var chain = Promise.resolve();
            todo.forEach(function (r) {
                var b = C.pickBatch(M.batches, r.ppe, r.size, r.qty);
                chain = chain.then(function () {
                    n++;
                    return A.create('Выдача СИЗ', { 'Выдача СИЗ': 'В-2026-' + ('000' + n).slice(-4), 'Работник': w.name, 'СИЗ': r.ppe, 'Дата выдачи': C.toDmy(M.today), 'Количество выдано': r.qty, 'Размер выдачи': r.size || 'универсальный', 'Партия выдачи': b ? b.code : '', 'Выдал': A.FIO[A.ctx.user] || A.ctx.user, 'Подтверждение получения': sig, 'Причина внеплановой выдачи': r.chk.needReason ? reasons[r.ppe] : '' });
                }).then(function () { if (b) { b.qty -= r.qty; return A.update(b.id, { 'Остаток партии': b.qty }); } });
            });
            chain.then(function () { close(); chosen = {}; reasons = {}; A.toast('Выдано ' + todo.length + ' поз., личная карточка заполнена'); A.render(); }, function (e) { A.toast(e.message, 1); });
        } }], true);
    }
})();
