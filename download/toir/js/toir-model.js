/* ТОиР: модель — все таблицы одним слоем с понятными полями. */
(function () {
    'use strict';
    var T = window.Toir, C = T.core;
    var NAMES = ['Цех', 'Тип оборудования', 'Оборудование', 'Пункт чек-листа', 'Маршрут обхода', 'Точка маршрута', 'Обход', 'Отметка обхода', 'Критичность дефекта', 'Вид работ', 'Запчасть', 'Норма запчасти', 'Останов', 'Дефект', 'ППР', 'Наряд', 'Запчасть наряда', 'Простой'];
    var modelP = null;
    /* Граница нормы для показа: 4,5 вместо 4.50 (C.num понимает запятую). */
    function nn(s) { return C.has(s) ? String(C.num(s)).replace('.', ',') : ''; }
    T.model = function () {
        if (modelP) return modelP;
        modelP = Promise.all(NAMES.map(function (n) { return T.rows(n); })).then(function (r) {
            var g = {}; NAMES.forEach(function (n, i) { g[n] = r[i] || []; });
            var M = { today: T.TODAY };
            M.shops = g['Цех'].map(function (x) { return { id: x._id, name: x['Цех'], code: x['Код цеха'], head: x['Начальник цеха'], login: x['Логин начальника цеха'] }; });
            M.eq = g['Оборудование'].map(function (x) {
                return { id: x._id, name: x['Оборудование'], inv: x['Инвентарный номер'], shop: x['Цех'], line: x['Линия'], type: x['Тип оборудования'], cls: x['Критичность оборудования'], cost: C.num(x['Стоимость часа простоя']), hours: C.num(x['Наработка, ч']), code: x['Код 1С'], label: x['Метка точки'] };
            });
            M.eqBy = T.map(M.eq, 'name');
            M.items = {}; g['Пункт чек-листа'].forEach(function (x) {
                (M.items[x['Тип оборудования']] = M.items[x['Тип оборудования']] || []).push({ id: x._id, name: x['Пункт чек-листа'], order: C.num(x['Порядок пункта']), kind: x['Вид контроля'], lo: nn(x['Норма от']), hi: nn(x['Норма до']), unit: x['Единица показания'], hint: x['Подсказка обходчику'] });
            });
            Object.keys(M.items).forEach(function (k) { M.items[k].sort(function (a, b) { return a.order - b.order; }); });
            M.itemBy = {}; Object.keys(M.items).forEach(function (k) { M.items[k].forEach(function (i) { M.itemBy[i.name] = i; }); });
            M.routes = g['Маршрут обхода'].map(function (x) { return { id: x._id, name: x['Маршрут обхода'], shop: x['Цех'], period: x['Периодичность обхода'], walker: x['Обходчик'], start: x['Начало обхода'], points: [] }; });
            M.routeBy = T.map(M.routes, 'name');
            g['Точка маршрута'].forEach(function (x) { var rt = M.routeBy[x['Маршрут обхода']]; if (rt) rt.points.push({ eq: x['Оборудование'], order: C.num(x['Порядок точки']), type: (M.eqBy[x['Оборудование']] || {}).type }); });
            M.routes.forEach(function (rt) { rt.points.sort(function (a, b) { return a.order - b.order; }); });
            M.rounds = g['Обход'].map(function (x) { return { id: x._id, name: x['Обход'], route: x['Маршрут обхода'], shop: x['Цех'], date: C.toIso(x['Дата обхода']), walker: x['Обходчик'], status: x['Статус обхода'], started: x['Начат в'], finished: x['Завершён в'] }; });
            M.roundBy = T.map(M.rounds, 'name');
            M.marks = g['Отметка обхода'].map(function (x) {
                var rd = M.roundBy[x['Обход']] || {};
                return { id: x._id, round: x['Обход'], date: rd.date || '', eq: x['Оборудование'], item: x['Пункт чек-листа'], shop: x['Цех'], walker: x['Обходчик'], result: x['Результат отметки'], value: x['Показание'], note: x['Комментарий отметки'], photo: T.href(x['Фото замечания']), time: x['Время отметки'], tag: x['Отметка по метке'] };
            });
            M.crit = g['Критичность дефекта'].map(function (x) { return { name: x['Критичность дефекта'], order: C.num(x['Порядок критичности']), days: C.num(x['Срок устранения, дней']), rule: x['Правило критичности'] }; }).sort(function (a, b) { return a.order - b.order; });
            M.critBy = T.map(M.crit, 'name');
            M.works = {}; g['Вид работ'].forEach(function (x) { M.works[x['Вид работ']] = { name: x['Вид работ'], hours: C.num(x['Норма часов']), prof: x['Профессия'], stop: x['Нужен останов'] }; });
            M.parts = {}; g['Запчасть'].forEach(function (x) { M.parts[x['Запчасть']] = { id: x._id, name: x['Запчасть'], art: x['Артикул'], code: x['Код 1С'], unit: x['Единица'], stock: C.num(x['Остаток на складе']), reserved: C.num(x['В резерве']), lead: C.num(x['Срок поставки, дней']), price: C.num(x['Цена']) }; });
            M.norms = {}; g['Норма запчасти'].forEach(function (x) { (M.norms[x['Вид работ']] = M.norms[x['Вид работ']] || []).push({ part: x['Запчасть'], qty: C.num(x['Количество']) }); });
            M.stops = g['Останов'].map(function (x) { return { id: x._id, name: x['Останов'], shop: x['Цех'], line: x['Линия'], from: C.toIso(x['Начало останова']), to: C.toIso(x['Конец останова']), hours: C.num(x['Часов останова']), status: x['Статус останова'], approved: x['Согласовал останов'] }; });
            M.defects = g['Дефект'].map(function (x) {
                return { id: x._id, name: x['Дефект'], eq: x['Оборудование'], shop: x['Цех'], found: C.toIso(x['Обнаружен']), source: x['Источник дефекта'], mark: x._ref['Отметка обхода'] || '', text: x['Описание дефекта'], crit: x['Критичность дефекта'], status: x['Статус дефекта'], due: C.toIso(x['Срок устранения']), author: x['Автор дефекта'], answer: x['Ответ автору'], work: x['Вид работ'], stop: x['Останов'], done: C.toIso(x['Устранён']) };
            });
            M.defBy = T.map(M.defects, 'name');
            M.ppr = g['ППР'].map(function (x) { return { id: x._id, name: x['ППР'], eq: x['Оборудование'], shop: x['Цех'], work: x['Вид работ'], period: C.num(x['Периодичность, дней']), last: C.toIso(x['Последнее выполнение']), plan: C.toIso(x['Плановая дата']), status: x['Статус ППР'] }; });
            M.pprBy = T.map(M.ppr, 'name');
            M.orders = g['Наряд'].map(function (x) {
                return { id: x._id, name: x['Наряд'], defect: x['Дефект'], ppr: x['ППР'], eq: x['Оборудование'], shop: x['Цех'], work: x['Вид работ'], stop: x['Останов'], exec: x['Исполнитель наряда'], team: x['Бригада'], plan: C.toIso(x['Плановая дата наряда']), done: C.toIso(x['Дата выполнения']), status: x['Статус наряда'], hours: C.num(x['Часов факт']), exported: C.toIso(x['Выгружен в 1С']) };
            });
            M.orderParts = {}; g['Запчасть наряда'].forEach(function (x) { (M.orderParts[x['Наряд']] = M.orderParts[x['Наряд']] || []).push({ id: x._id, part: x['Запчасть'], qty: C.num(x['Количество']), status: x['Статус резерва'] }); });
            M.downs = g['Простой'].map(function (x) { return { id: x._id, name: x['Простой'], eq: x['Оборудование'], shop: x['Цех'], date: C.toIso(x['Дата простоя']), hours: C.num(x['Часов простоя']), cause: x['Причина простоя'], defect: x['Дефект'], note: x['Комментарий простоя'] }; });
            M.eqLine = {}; M.eqCost = {}; M.eqCode = {}; M.eq.forEach(function (e) { M.eqLine[e.name] = e.line; M.eqCost[e.name] = e.cost; M.eqCode[e.name] = e.code; });
            M.myShop = M.shops.filter(function (s) { return s.login === T.ctx.user; })[0] || null;
            T.cur = M;
            return M;
        });
        return modelP;
    };
    T.reset = function () { modelP = null; };
    /* Показания пункта по узлу по датам (для графика истории). */
    T.history = function (M, eq, item) {
        return M.marks.filter(function (m) { return m.eq === eq && m.item === item && m.value !== '' && m.value !== undefined; })
            .sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
    };
    T.mount = function (fn) {
        if (!host()) return;
        var h = host(); h.textContent = 'Загрузка...';
        T.meta().then(function () { return T.model(); }).then(function (M) { h.innerHTML = ''; return fn(h, M); }).catch(T.fail);
    };
    function host() { return document.getElementById('toir-app'); }
    T.fail = function (e) { var h = host(); if (!h) return; h.innerHTML = ''; h.appendChild(T.el('div', { 'class': 'toir-error', text: 'Ошибка: ' + (e && e.message || e) })); };
    T.redraw = function (fn) { T.reset(); T.mount(fn); };
})();
