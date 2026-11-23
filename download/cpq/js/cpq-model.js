/* CPQ: загрузка модели из базы (каталог, правила, цены, роли), текущий пользователь, сохранение КП. Нужны cpq-core.js и cpq-app.js. */
(function () {
    'use strict';
    var W = window.Cpq, C = W.core;

    W.STATUS_KIND = { 'Черновик': 'info', 'На согласовании': 'warn', 'Отклонено руководителем': 'crit', 'Согласовано': 'ok', 'Отправлено клиенту': 'info', 'Выиграно': 'ok', 'Проиграно': 'crit' };
    W.CLOSED = { 'Выиграно': 1, 'Проиграно': 1 };

    /* Каталог, правила, цены и роли -> модель ядра. Цели правил приходят отчётом (подчинённую таблицу без родителя не прочитать). */
    W.loadModel = function () {
        var soft = function (p) { return p.catch(function () { return []; }); };
        return Promise.all([W.rows('Группа опций'), W.rows('Опция'), W.rows('Изделие'), W.rows('Правило'), W.report('Цели правил'), W.rows('Группа клиента'),
            W.rows('Ступень количества'), W.rows('Роль продаж'), W.rows('Настройка'), W.rows('Менеджер'), W.rows('Статус КП'), soft(W.rows('Причина отказа'))]).then(function (r) {
            var ruleId = {}; r[3].forEach(function (x) { ruleId[x['Правило']] = x._id; });
            var targets = r[4].map(function (t) { return { _up: ruleId[t['Правило']], 'Опция цели': t['Цель'] }; });
            var m = C.buildModel({ groups: r[0], options: r[1], products: r[2], rules: r[3], targets: targets, custGroups: r[5], steps: r[6], roles: r[7], settings: r[8] });
            m.managers = r[9]; m.statuses = r[10].sort(function (a, b) { return C.num(a['Порядок']) - C.num(b['Порядок']); }); m.lostReasons = r[11].map(function (x) { return x['Причина отказа']; });
            m.optId = {}; r[1].forEach(function (o) { m.optId[o['Код']] = o._id; });
            m.ruleRows = r[3];
            var me = r[9].filter(function (x) { return x['Логин'] === W.ctx.user; })[0];
            m.me = me ? { name: me['Менеджер'], role: me['Роль продаж'], id: me._id } : { name: W.ctx.user, role: 'Менеджер' };
            m.myRole = m.roles.filter(function (x) { return x.name === m.me.role; })[0] || { name: m.me.role, limit: 0, level: 0, approves: false };
            W.me = m.me;
            return m;
        });
    };
    W.loadQuotes = function () {
        return W.rows('КП').then(function (rows) {
            return rows.map(function (q) {
                return { id: q._id, code: q['КП'], client: q['Клиент'], mgr: q['Менеджер'], status: q['Статус КП'], date: C.toIso(q['Дата КП']), until: C.toIso(q['Действует до']),
                    disc: C.num(q['Скидка менеджера, %']), subtotal: C.num(q['Сумма без скидки']), total: C.num(q['Итого']), margin: C.num(q['Маржа, %']),
                    needs: !!q['Требуется согласование'], approver: q['Согласующая роль'], lost: q['Причина отказа'], version: C.num(q['Версия']) || 1, comment: q['Комментарий'] };
            }).sort(function (a, b) { return a.code < b.code ? 1 : -1; });
        });
    };
    W.loadQuote = function (id, m) {
        return Promise.all([W.rows('КП').then(function (all) { return all.filter(function (x) { return x._id === String(id); })[0]; }), W.rows('Позиция КП', id), W.rows('Событие КП', id)]).then(function (r) {
            var q = r[0]; if (!q) throw new Error('КП не найдено или нет доступа');
            var byName = {}; m.products.forEach(function (p) { byName[p.name] = p.key; });
            var items = r[1].sort(function (a, b) { return C.num(a['Позиция КП']) - C.num(b['Позиция КП']); }).map(function (x) {
                return { rowId: x._id, product: byName[x['Изделие']], qty: C.num(x['Количество']), unit: C.num(x['Цена за единицу']), lineTotal: C.num(x['Сумма позиции']), sel: x['Конфигурация'] ? x['Конфигурация'].split('|') : [] };
            });
            return { id: q._id, code: q['КП'], client: q['Клиент'], mgr: q['Менеджер'], status: q['Статус КП'], date: C.toIso(q['Дата КП']), until: C.toIso(q['Действует до']), disc: C.num(q['Скидка менеджера, %']), subtotal: C.num(q['Сумма без скидки']), total: C.num(q['Итого']), margin: C.num(q['Маржа, %']),
                needs: !!q['Требуется согласование'], approver: q['Согласующая роль'], lost: q['Причина отказа'], version: C.num(q['Версия']) || 1, comment: q['Комментарий'], items: items,
                events: r[2].map(function (e) { return { date: C.toIso(e['Дата события']), name: e['Событие КП'], who: e['Автор'], text: e['Комментарий события'] }; }).sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); }) };
        });
    };
    W.clientGroup = function (clients, name) { var c = clients.filter(function (x) { return x['Клиент'] === name; })[0]; return c ? c['Группа клиента'] : ''; };
    W.event = function (qid, name, text) {
        return W.post('_m_new/' + W.tid('Событие КП') + '?JSON', { up: qid, fields: { 'Событие КП': name, 'Дата события': W.TODAY, 'Автор': W.me ? W.me.name : W.ctx.user, 'Комментарий события': text || '' } });
    };
    /* Пересчитанные поля КП для записи */
    W.quoteFields = function (m, st, clientGroup) {
        var q = C.priceQuote(m, st.items.map(function (i) { return { product: i.product, sel: i.sel, qty: i.qty }; }), clientGroup, st.disc, m.me.role);
        return { q: q, fields: { 'Скидка менеджера, %': st.disc, 'Сумма без скидки': q.subtotal, 'Итого': q.total, 'Маржа, %': q.marginPct, 'Требуется согласование': q.approval.needs ? 1 : '',
            'Согласующая роль': q.approval.needs ? (q.approval.approver || '') : '' } };
    };
    W.saveItems = function (m, qid, items, q, oldRows) {
        var del = Promise.all((oldRows || []).map(function (x) { return W.post('_m_del/' + x.rowId + '?JSON', {}); }));
        return del.then(function () {
            var chain = Promise.resolve();
            items.forEach(function (it, i) {
                chain = chain.then(function () {
                    var p = q.lines[i];
                    return W.post('_m_new/' + W.tid('Позиция КП') + '?JSON', { up: qid, fields: { 'Позиция КП': i + 1, 'Изделие': m.prodBy[it.product].name, 'Количество': p.qty, 'Конфигурация': it.sel.join('|'), 'Цена за единицу': p.unit, 'Сумма позиции': p.total } });
                });
            });
            return chain;
        });
    };
    W.setStatus = function (qid, status, fields, evName, evText) {
        var f = Object.assign({ 'Статус КП': status }, fields || {});
        return W.post('_m_set/' + qid + '?JSON', { fields: f }).then(function () { return evName ? W.event(qid, evName, evText) : null; });
    };
})();
