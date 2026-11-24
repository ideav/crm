/* CPQ: каталог и правила совместимости. Правила - строки таблицы, их правит инженер; тестовый прогон показывает последствия. */
(function () {
    'use strict';
    const W = window.Cpq, C = W.core;
    const st = { tab: 'rules', product: '', a: '', b: '' };
    let M = null, targetsBy = {};

    const TYPES = ['Требует', 'Исключает', 'Только вместе', 'По умолчанию'];
    const TYPE_KIND = { 'Требует': 'info', 'Исключает': 'crit', 'Только вместе': 'warn', 'По умолчанию': 'ok' };
    const optName = c => (M.optBy[c] || { name: c }).name;
    const canRules = () => W.canWrite('Правило');

    function ruleDlg() {
        const type = W.select(TYPES, 'Исключает');
        const optList = M.options.map(o => [o.name, o.group + ': ' + o.name]);
        const ifSel = W.select([['', 'Нет: правило для изделия целиком']].concat(optList), '');
        const prod = W.select([['', 'Все изделия']].concat(M.products.map(p => [p.name, p.name])), '');
        const tg = W.el('select', { multiple: 'multiple', size: '8', 'aria-label': 'Цели правила' }, optList.map(o => W.el('option', { value: o[0], text: o[1] })));
        const msg = W.el('input', { type: 'text', placeholder: 'Почему так: увидит менеджер, например «хлориды разрушают чугун»', 'aria-label': 'Пояснение' });
        const body = W.el('div', {}, [W.field('Тип правила', type), W.field('Если выбрана опция', ifSel), W.field('Изделие', prod), W.field('Цели (несколько: Ctrl)', tg), W.field('Пояснение для менеджера', msg)]);
        W.modal('Новое правило', body, [{ text: 'Отмена' }, { text: 'Создать', cls: 'cpq-primary', keep: true, fn: close => {
            const targets = [].slice.call(tg.selectedOptions).map(o => o.value);
            if (!targets.length || !msg.value.trim()) { W.toast('Выберите цели и напишите пояснение', true); return false; }
            const n = M.rules.reduce((s, r) => Math.max(s, parseInt(String(r.name).slice(2), 10) || 0), 0) + 1;
            const name = 'R-' + String(n).padStart(2, '0') + ' ' + (ifSel.value || (prod.value || 'Изделие')).slice(0, 40) + ': ' + type.value.toLowerCase();
            W.post('_m_new/' + W.tid('Правило') + '?JSON', { up: 1, fields: { 'Правило': name, 'Тип правила': type.value, 'Если опция': ifSel.value, 'Изделие': prod.value, 'Пояснение для менеджера': msg.value.trim(), 'Активно': 1, 'Действует с': W.TODAY, 'Автор правки': W.me.name } })
                .then(r => { const id = String(r.id || r.obj); let p = Promise.resolve(); targets.forEach(t => { p = p.then(() => W.post('_m_new/' + W.tid('Цель правила') + '?JSON', { up: id, fields: { 'Цель правила': t, 'Опция цели': t } })); }); return p; })
                .then(() => { close(); W.toast('Правило добавлено'); reload(); }).catch(e => W.toast(e.message, true));
            return false; } }]);
    }
    function toggleRule(r) {
        W.post('_m_set/' + r.id + '?JSON', { fields: { 'Активно': r.active ? '' : 1 } }).then(() => { W.toast(r.active ? 'Правило отключено' : 'Правило включено'); reload(); }).catch(e => W.toast(e.message, true));
    }
    function priceDlg(o) {
        const v = W.el('input', { type: 'number', step: '0.5', value: String(o.price), 'aria-label': 'Цена' });
        W.modal(o.name, W.el('div', {}, [W.field(o.priceType === 'percent' ? 'Надбавка, % от базы' : 'Цена, ₽', v)]), [{ text: 'Отмена' }, { text: 'Сохранить', cls: 'cpq-primary', keep: true, fn: close => {
            W.post('_m_set/' + M.optId[o.code] + '?JSON', { fields: { 'Цена опции': v.value } }).then(() => { close(); W.toast('Цена сохранена'); reload(); }).catch(e => W.toast(e.message, true)); return false; } }]);
    }

    function rulesTab(host) {
        const rows = M.rules.map(r => ({ id: r.id, name: r.name, type: M.TYPE_NAME[r.type], kind: r.type, ifc: r.ifCode ? optName(r.ifCode) : 'изделие целиком', product: r.product ? M.prodBy[r.product].name : 'все',
            targets: r.targets.map(optName).join(', '), msg: r.message, since: r.since, active: r.active, author: r.author }));
        const bar = [W.el('p', { 'class': 'cpq-muted', text: 'Правило: «Если выбрана опция A, то B требуется / исключается / идёт только вместе». Менеджер видит пояснение прямо в мастере. Правила версионируются датой и автором.' })];
        if (canRules()) bar.push(W.btn('Добавить правило', ruleDlg, 'cpq-primary'));
        host.appendChild(W.el('div', {}, bar));
        host.appendChild(W.table([
            { k: 'name', t: 'Правило', html: r => '<strong>' + W.esc(r.name) + '</strong>' }, { k: 'type', t: 'Тип', html: r => W.badge(r.type, TYPE_KIND[r.type]) },
            { k: 'ifc', t: 'Если выбрано' }, { k: 'targets', t: 'Цели' }, { k: 'product', t: 'Изделие' }, { k: 'msg', t: 'Пояснение менеджеру' },
            { k: 'since', t: 'С даты', html: r => W.esc(r.since) }, { k: 'author', t: 'Автор' },
            { k: 'active', t: 'Статус', html: r => r.active ? W.badge('действует', 'ok') : W.badge('отключено', 'warn') }
        ], rows, { rowCls: r => r.active ? '' : 'cpq-row-warn', onrow: canRules() ? r => toggleRule(r) : null }));
        if (canRules()) host.appendChild(W.el('p', { 'class': 'cpq-muted cpq-small', text: 'Клик по строке включает или отключает правило.' }));
    }
    function optionsTab(host) {
        M.groups.forEach(g => {
            host.appendChild(W.el('h2', { text: g.name + ' (' + (g.mode === 'one' ? 'одно' : 'несколько') + (g.required ? ', обязательно' : '') + ')' }));
            host.appendChild(W.table([{ k: 'code', t: 'Код' }, { k: 'name', t: 'Опция', html: r => '<strong>' + W.esc(r.name) + '</strong>' },
                { k: 'price', t: 'Цена', num: true, html: r => r.priceType === 'percent' ? '+' + C.round1(r.price) + '% от базы' : (r.price ? C.money(r.price) + ' ₽' : 'в базе') }, { k: 'note', t: 'Описание' }],
                M.options.filter(o => o.group === g.name), { onrow: W.canWrite('Опция') ? priceDlg : null }));
        });
    }
    function productsTab(host) {
        host.appendChild(W.table([{ k: 'key', t: 'Артикул' }, { k: 'name', t: 'Изделие', html: r => '<strong>' + W.esc(r.name) + '</strong>' }, { k: 'base', t: 'Базовая цена, ₽', num: true },
            { k: 'maxPressure', t: 'Давление, бар', num: true }, { k: 'maxTemp', t: 'Температура, °C', num: true }, { k: 'leadDays', t: 'Срок, дн', num: true }, { k: 'note', t: 'Описание' }], M.products));
    }
    function checkTab(host) {
        if (!st.product) st.product = M.products[0].key;
        const prod = W.select(M.products.map(p => [p.key, p.name]), st.product); prod.onchange = () => { st.product = prod.value; st.a = st.b = ''; render(); };
        const opt = (k) => { const s = W.select([['', 'Выберите опцию']].concat(M.options.map(o => [o.code, o.group + ': ' + o.name])), st[k]); s.onchange = () => { st[k] = s.value; render(); }; return s; };
        host.appendChild(W.el('p', { 'class': 'cpq-muted', text: 'Тестовый прогон: система перебирает все комбинации обязательных групп (среда, материал, привод, управление, уплотнение) и показывает, сколько из них допустимы.' }));
        host.appendChild(W.el('div', { 'class': 'cpq-bar' }, [W.field('Изделие', prod)]));
        const a = C.analyze(M, st.product), kv = (k, v, cls) => W.el('div', { 'class': 'cpq-kpi ' + (cls || '') }, [W.el('span', { 'class': 'cpq-muted', text: k }), W.el('strong', { text: v })]);
        host.appendChild(W.el('div', { 'class': 'cpq-kpis' }, [kv('Комбинаций', String(a.combos)), kv('Допустимых', String(a.valid)), kv('Запрещено правилами', String(a.invalid), 'cpq-kpi-warn'), kv('Недоступных опций', String(a.dead.length))]));
        host.appendChild(W.el('h2', { text: 'Недоступные для изделия опции' }));
        host.appendChild(W.table([{ k: 'name', t: 'Опция' }, { k: 'reason', t: 'Почему' }], a.dead, { empty: 'Все опции доступны' }));
        const lint = C.lint(M);
        host.appendChild(W.el('h2', { text: 'Противоречия в правилах' }));
        host.appendChild(W.table([{ k: 'text', t: 'Замечание' }], lint, { empty: 'Противоречий не найдено' }));
        host.appendChild(W.el('h2', { text: 'Проверка пары опций' }));
        const A = opt('a'), B = opt('b');
        host.appendChild(W.el('div', { 'class': 'cpq-bar' }, [W.field('Опция A', A), W.field('Опция B', B)]));
        if (st.a && st.b) {
            const base = C.initial(M, st.product), r1 = C.tryAdd(M, st.product, base, st.a);
            let text, ok;
            if (!r1.ok) { ok = false; text = '«' + optName(st.a) + '» недоступна: ' + r1.reasons[0].text; }
            else { const r2 = C.tryAdd(M, st.product, r1.sel, st.b); ok = r2.ok; text = ok ? 'Совместимы: можно выбрать вместе' + (r2.added.length || r1.added.length ? ' (с добавлением: ' + r1.added.concat(r2.added).map(x => optName(x.code)).join(', ') + ')' : '') : 'Нельзя вместе: ' + r2.reasons[0].text; }
            host.appendChild(W.el('div', { 'class': 'cpq-banner ' + (ok ? 'cpq-b-ok' : 'cpq-b-crit'), role: 'status', text: text }));
        }
    }
    function render() {
        const host = W.host; host.innerHTML = '';
        host.appendChild(W.el('h1', { text: 'Каталог и правила' }));
        host.appendChild(W.el('p', { 'class': 'cpq-sub', text: 'Изделия, опции и правила совместимости лежат в таблицах базы, а не в коде. Изменение правила сразу меняет поведение мастера.' }));
        host.appendChild(W.tabs([['rules', 'Правила (' + M.rules.length + ')'], ['check', 'Проверка правил'], ['options', 'Опции (' + M.options.length + ')'], ['products', 'Изделия']], st.tab, t => { st.tab = t; render(); }));
        ({ rules: rulesTab, check: checkTab, options: optionsTab, products: productsTab })[st.tab](host);
    }
    function reload() { return W.loadModel().then(m => { M = m; M.TYPE_NAME = C.TYPE_NAME; render(); }).catch(W.fail); }
    W.mount(() => W.loadModel().then(m => { M = m; M.TYPE_NAME = C.TYPE_NAME; render(); }));
})();
