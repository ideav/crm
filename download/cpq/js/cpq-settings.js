/* CPQ: экран «Настройки». Опции демо лежат в таблице «Настройка», лимиты ролей - в «Роль продаж»; экраны и ядро читают их при загрузке.
 * Менять может роль с правом WRITE на «Настройка» (коммерческий директор); остальные видят значения без возможности правки. */
(function () {
    'use strict';
    const W = window.Cpq, C = W.core;
    const GROUPS = ['Скидка', 'Лимиты скидки', 'Маржа', 'Статусы КП', 'Печатная форма'];
    let M = null, rows = [], roles = [], canEdit = false, canRoles = false;

    const variants = r => String(r['Варианты'] || '').split('|').filter(Boolean).map(v => { const p = v.split('='); return { code: p[0], name: p[1] || p[0], fit: p.slice(2).join('=') }; });
    const isChoice = r => r['Тип'] === 'Выбор';

    function save(row, field, value, after) {
        return W.post('_m_set/' + row._id + '?JSON', { fields: (function () { const f = {}; f[field] = value; return f; })() })
            .then(() => { W.toast('Сохранено: ' + (row['Настройка'] || row['Роль продаж'])); return reload(); }).then(after || null).catch(e => { W.toast(e.message, true); return reload(); });
    }
    function choiceBlock(r) {
        const cur = r['Значение'] || '', name = 'opt-' + r['Код'];
        return W.el('div', { 'class': 'cpq-choices', role: 'radiogroup', 'aria-label': r['Настройка'] }, variants(r).map(v => {
            const inp = W.el('input', { type: 'radio', name: name, value: v.code, 'data-opt': r['Код'], checked: v.code === cur ? 'checked' : false, disabled: canEdit ? false : 'disabled' });
            inp.addEventListener('change', () => { if (inp.checked) save(r, 'Значение', v.code); });
            return W.el('label', { 'class': 'cpq-choice' + (v.code === cur ? ' cpq-choice-on' : '') }, [inp, W.el('span', {}, [W.el('strong', { text: v.name }), W.el('span', { 'class': 'cpq-muted cpq-small', text: v.fit })])]);
        }));
    }
    function numberBlock(r) {
        const inp = W.el('input', { type: 'number', min: '0', max: '100', step: '0.5', value: String(C.num(r['Значение настройки'])), 'class': 'cpq-qty', 'aria-label': r['Настройка'], 'data-opt': r['Код'], disabled: canEdit ? false : 'disabled' });
        inp.addEventListener('change', () => { const v = Math.min(100, Math.max(0, C.num(inp.value))); save(r, 'Значение настройки', v); });
        return W.el('div', { 'class': 'cpq-row' }, [inp, W.el('span', { 'class': 'cpq-muted', text: r['Единица'] || '' })]);
    }
    function optionCard(r) {
        return W.el('section', { 'class': 'cpq-card cpq-optcard', 'data-code': r['Код'] }, [
            W.el('h3', { text: r['Настройка'] }), W.el('p', { 'class': 'cpq-muted cpq-small', text: r['Когда выбирают'] || '' }), isChoice(r) ? choiceBlock(r) : numberBlock(r)]);
    }
    function rolesCard() {
        const t = W.table([{ k: 'n', t: 'Роль' }, { k: 'a', t: 'Согласует скидки', html: r => r.approves ? 'да' : 'нет' }, { k: 'l', t: 'Лимит скидки, %', num: true }, { k: 'd', t: 'Описание' }],
            roles.map(r => ({ n: r['Роль продаж'], approves: C.num(r['Согласует']) > 0, l: r['Лимит скидки, %'], d: r['Описание'], row: r })));
        // поля лимита: заменяем число полем ввода
        [].forEach.call(t.querySelectorAll('tbody tr'), (tr, i) => {
            const r = roles[i], td = tr.children[2]; td.textContent = '';
            const inp = W.el('input', { type: 'number', min: '0', max: '100', step: '0.5', value: String(C.num(r['Лимит скидки, %'])), 'class': 'cpq-qty', 'aria-label': 'Лимит ' + r['Роль продаж'], 'data-role': r['Роль продаж'], disabled: canRoles ? false : 'disabled' });
            inp.addEventListener('change', () => save(r, 'Лимит скидки, %', Math.min(100, Math.max(0, C.num(inp.value)))));
            td.appendChild(inp);
        });
        const flat = M.opts.limitsMode === 'flat';
        return W.el('section', { 'class': 'cpq-card cpq-optcard', 'data-code': 'ROLES' }, [W.el('h3', { text: 'Лимиты скидки по ролям' }),
            W.el('p', { 'class': 'cpq-muted cpq-small', text: flat ? 'Сейчас включён единый лимит: менеджеры, которые не согласуют скидки, используют его (' + C.round1(M.opts.flatLimit) + '%), лимиты ниже у них не действуют. Согласующие держат свой лимит отсюда.' : 'Менеджер даёт скидку сам в пределах своего лимита; выше - согласует ближайшая роль с достаточным лимитом.' }), t]);
    }
    /* «Что будет»: те же функции ядра, что и в конфигураторе, на текущих значениях настроек */
    function preview() {
        const discs = [5, 8, 12, 18, 26], rolesShow = M.roles.filter(r => !r.approves);
        const cell = (role, d, margin) => {
            const a = C.approval(M, d, margin, role);
            return a.blocked ? W.badge('запрещено', 'crit') : (a.needs ? W.badge('согласует: ' + a.approver, 'warn') : W.badge('сам', 'ok'));
        };
        const lowMargin = (M.settings['Минимальная маржа, %'] || 0) - 3;
        const cols = [{ k: 'r', t: 'Роль' }].concat(discs.map(d => ({ k: 'd' + d, t: 'Скидка ' + d + '%', html: r => r['d' + d] })));
        const mk = (role, margin) => { const o = { r: role + (margin === undefined ? '' : ', маржа ниже минимума') }; discs.forEach(d => { o['d' + d] = cell(role, d, margin === undefined ? 40 : lowMargin); }); return o; };
        const data = []; rolesShow.forEach(r => data.push(mk(r.name))); if (rolesShow[0]) data.push(mk(rolesShow[0].name, 1));
        return W.el('section', { 'class': 'cpq-card cpq-optcard', 'data-code': 'PREVIEW' }, [W.el('h3', { text: 'Что будет при текущих настройках' }),
            W.el('p', { 'class': 'cpq-muted cpq-small', text: 'Тот же расчёт, что в конфигураторе: кто может дать скидку сам, а кого нужно согласовать. Меняйте настройки выше - таблица обновляется.' }), W.table(cols, data),
            W.el('p', { 'class': 'cpq-muted cpq-small', text: 'Менеджер ' + (C.canSetStatus(M, rolesShow[0] ? rolesShow[0].name : 'Менеджер') ? 'может' : 'не может') + ' менять статус КП вручную; маржа для него: ' + ({ show: 'цифра', flag: 'только отметка', hide: 'скрыта' })[M.opts.marginView] + '; скидка: ' + (M.opts.discountMode === 'lines' ? 'по позициям' : 'на всё КП') + '.' })]);
    }
    function render() {
        const host = W.host; host.innerHTML = '';
        host.appendChild(W.el('h1', { text: 'Настройки' }));
        host.appendChild(W.el('p', { 'class': 'cpq-sub', text: 'У каждой компании своё «нормально»: здесь выбирают правила скидок, маржи и статусов. Переключили - экраны сразу ведут себя по-новому.' }));
        if (!canEdit) host.appendChild(W.el('div', { 'class': 'cpq-banner cpq-b-info' }, 'Значения видны всем, менять может коммерческий директор.'));
        GROUPS.forEach(g => {
            const list = rows.filter(r => (r['Группа настроек'] || '') === g);
            if (!list.length && g !== 'Лимиты скидки') return;
            host.appendChild(W.el('h2', { text: g }));
            const box = W.el('div', { 'class': 'cpq-optgrid' }, list.map(optionCard));
            if (g === 'Лимиты скидки') box.appendChild(rolesCard());
            host.appendChild(box);
        });
        host.appendChild(preview());
    }
    function reload() {
        return Promise.all([W.loadModel(), W.rows('Настройка'), W.rows('Роль продаж')]).then(r => { M = r[0]; rows = r[1].filter(x => x['Код']); roles = r[2].sort((a, b) => C.num(a['Уровень']) - C.num(b['Уровень'])); render(); });
    }
    W.mount(() => { canEdit = W.canWrite('Настройка'); canRoles = W.canWrite('Роль продаж'); return reload(); });
})();
