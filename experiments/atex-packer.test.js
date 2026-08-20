// Unit tests for the «Рабочее место упаковщика» core (ideav/crm#4658).
//
// Боевая схема ateh: строка отчёта `packer` — это Партия ГП внутри задания
// («Задание в производство»), с позицией заказа и заказом сбоку. Отметка упаковки
// пишет «Упаковано шт» в Партию ГП и событие смены «Упаковка» (тип 670935).
// См. docs/atex_workplaces.md §3.13 и docs/integram-reports.md §11.
//
// Run with: node experiments/atex-packer.test.js

var mod = require('../download/atex/js/packer.js');
var core = mod.core;

var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) {
        passed++;
    } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

// Строка отчёта `packer?JSON_KV` в том виде, в каком её отдаёт боевая ateh.
function row(over) {
    var base = {
        task: '1786078800', task_id: '666355', gp_id: '666392',
        order_no: '4619', order: '',
        material: 'MWR113L', cut_width: '110.00', cut_length: '600.00',
        wind_direction: 'IN', sleeve: 'втулка пластик серая для Videojet', add_sleeve: '',
        qty: '110', qty_fact: '110', packed: '', notes: '', events: '1'
    };
    Object.keys(over || {}).forEach(function(k) { base[k] = over[k]; });
    return base;
}

// ── toNumber / formatNumber: числа отчёта приходят строками с хвостом «.00» ──
assertEqual(core.toNumber('110.00'), 110, 'toNumber parses decimal string');
assertEqual(core.toNumber('12,5'), 12.5, 'toNumber accepts comma decimal');
assertEqual(core.toNumber(''), 0, 'toNumber empty → 0');
assertEqual(core.formatNumber('110.00'), '110', 'formatNumber: хвост .00 срезается');
assertEqual(core.formatNumber('12.50'), '12.5', 'formatNumber: значащий знак остаётся');
assertEqual(core.formatNumber(''), '', 'formatNumber: пусто остаётся пустым');

// ── Разбор строки отчёта ──
(function() {
    var item = core.itemFromReportRow(row());
    assertEqual(item.taskId, '666355', 'itemFromReportRow: task_id');
    assertEqual(item.gpId, '666392', 'itemFromReportRow: gp_id');
    assertEqual(item.orderNo, '4619', 'itemFromReportRow: номер заказа');
    assertEqual(item.planQty, 110, 'itemFromReportRow: план');
    assertEqual(item.factQty, 110, 'itemFromReportRow: факт');
    assertEqual(item.packedQty, 0, 'itemFromReportRow: не упаковано → 0');

    // JSON_KV отдаёт ссылочные колонки как {val,id} — берём отображаемое значение.
    var kv = core.itemFromReportRow(row({ material: { val: 'MR194', id: '1101' } }));
    assertEqual(kv.material, 'MR194', 'itemFromReportRow: {val,id} → val');
})();

// ── Подпись позиции в привычном упаковщику виде ──
assertEqual(core.describeItem(core.itemFromReportRow(row())),
    'MWR113L 110 х 600 IN втулка пластик серая для Videojet',
    'describeItem: сырьё, ширина х длина, намотка, втулка');
assertEqual(core.describeItem(core.itemFromReportRow(row({ add_sleeve: 'Приклеить' }))),
    'MWR113L 110 х 600 IN втулка пластик серая для Videojet + доп. втулка: Приклеить',
    'describeItem: доп. втулка добавляется хвостом');
assertEqual(core.describeItem(core.itemFromReportRow(row({ wind_direction: '', sleeve: '' }))),
    'MWR113L 110 х 600',
    'describeItem: пустые поля не оставляют дыр');

// ── Номера заказа в карточке (#4688): крупно клиентский, мелко внутренний ──
assertEqual(core.orderTitle(core.itemFromReportRow(row({ order_no: '4619', order: 'ЗК-2026/117' }))),
    { main: 'ЗК-2026/117', sub: '4619' },
    'orderTitle: клиентский номер крупно, внутренний — строкой ниже');
assertEqual(core.orderTitle(core.itemFromReportRow(row({ order_no: '4619', order: '' }))),
    { main: '4619', sub: '' },
    'orderTitle: клиентского нет → крупно внутренний, второй строки нет');
assertEqual(core.orderTitle(core.itemFromReportRow(row({ order_no: '', order: '  ЗК-7  ' }))),
    { main: 'ЗК-7', sub: '' },
    'orderTitle: пробелы срезаются, пустого внутреннего строкой не показываем');
assertEqual(core.orderTitle(core.itemFromReportRow(row({ order_no: '', order: '' }))),
    { main: '—', sub: '' },
    'orderTitle: нет ни одного номера → прочерк');

// ── Количество к упаковке: qty_fact, а если его нет — qty ──
assertEqual(core.packQtyFor(core.itemFromReportRow(row({ qty: '110', qty_fact: '24' }))), 24,
    'packQtyFor: есть факт → факт');
assertEqual(core.packQtyFor(core.itemFromReportRow(row({ qty: '110', qty_fact: '' }))), 110,
    'packQtyFor: факта нет → план');
assertEqual(core.packQtyFor(core.itemFromReportRow(row({ qty: '110', qty_fact: '0' }))), 110,
    'packQtyFor: факт 0 → план');
assertEqual(core.packQtyFor(core.itemFromReportRow(row({ qty: '', qty_fact: '' }))), 0,
    'packQtyFor: ни факта, ни плана → 0');

// ── Правка количества живёт в карточке до отметки (#4680) ──
(function() {
    // Количество меняют кликом по самому количеству, а кнопка «Упаковано» фиксирует
    // упаковку ТЕМ, ЧТО ВИДНО. Значит правка обязана быть источником и для карточки,
    // и для записи — иначе упаковщик отметит не то, что прочитал.
    var item = core.itemFromReportRow(row({ qty: '110', qty_fact: '60' }));
    assertEqual(core.currentQty(item), 60, 'currentQty: правки нет → подсказка отчёта');
    assertEqual(core.baseQty(item), 60, 'baseQty: правки нет → от подсказки и считаем');
    assertEqual(core.isEdited(item), false, 'isEdited: правки нет');

    item.editedQty = 55;
    assertEqual(core.currentQty(item), 55, 'currentQty: правка сильнее подсказки отчёта');
    assertEqual(core.isEdited(item), true, 'isEdited: правка отличается от отчёта');
    assertEqual(core.baseQty(item), 60, 'baseQty: примечание требуем за отход от ОТЧЁТА, не от прежней правки');

    item.editedQty = 60;
    assertEqual(core.isEdited(item), false, 'isEdited: вернули как в отчёте — правки нет');

    // Упакованная позиция живёт записанным «Упаковано шт»: правка её не касается.
    var done = core.itemFromReportRow(row({ qty: '110', qty_fact: '110', packed: '90' }));
    done.editedQty = 5;
    assertEqual(core.currentQty(done), 90, 'currentQty: упаковано → записанное «Упаковано шт»');
    assertEqual(core.baseQty(done), 90, 'baseQty: упаковано → от записанного');
    assertEqual(core.isEdited(done), false, 'isEdited: у упакованной позиции правки не бывает');
})();

// ── Отчёт фильтруется по упаковочному месту (#4681) ──
assertEqual(core.itemsPath({ id: '669275', label: '2' }),
    'report/packer?JSON_KV&LIMIT=0,5000&FR_packer_no=2',
    'itemsPath: место выбрано → FR_packer_no с его НОМЕРОМ, а не с id записи');
assertEqual(core.itemsPath(null), 'report/packer?JSON_KV&LIMIT=0,5000',
    'itemsPath: места нет → фильтра нет');
assertEqual(core.itemsPath({ id: '669272', label: ' ' }), 'report/packer?JSON_KV&LIMIT=0,5000',
    'itemsPath: пустой номер не превращается в FR_packer_no=');
assertEqual(core.itemsPath({ id: '1', label: 'Цех №1' }),
    'report/packer?JSON_KV&LIMIT=0,5000&FR_packer_no=%D0%A6%D0%B5%D1%85%20%E2%84%961',
    'itemsPath: номер уезжает в URL закодированным');

// ── Признак упаковки — из «Упаковано шт» отчёта ──
assertEqual(core.isPacked(core.itemFromReportRow(row())), false, 'isPacked: пусто → нет');
assertEqual(core.isPacked(core.itemFromReportRow(row({ packed: '110' }))), true, 'isPacked: 110 → да');
assertEqual(core.isPacked(core.itemFromReportRow(row({ packed: '0' }))), false, 'isPacked: 0 → нет');

// ── Правка количества обязывает написать примечание ──
assertEqual(core.noteRequired(110, 110), false, 'noteRequired: количество не меняли');
assertEqual(core.noteRequired('110', 110), false, 'noteRequired: строка и число равны');
assertEqual(core.noteRequired(90, 110), true, 'noteRequired: количество поправили');
assertEqual(core.validatePack({ qty: 90, suggested: 110, note: '' }),
    'Количество изменено — напишите примечание', 'validatePack: правка без примечания не проходит');
assertEqual(core.validatePack({ qty: 90, suggested: 110, note: 'часть в брак' }), '',
    'validatePack: правка с примечанием проходит');
assertEqual(core.validatePack({ qty: 0, suggested: 110, note: 'ничего' }),
    'Количество должно быть больше нуля', 'validatePack: ноль не принимается');
assertEqual(core.validatePack({ qty: 110, suggested: 110, note: '' }), '',
    'validatePack: количество как предложено — примечание не нужно');

// ── Группировка по заданию: одно время старта ≠ одно задание ──
(function() {
    // На бою у разных заданий совпадает плановый старт (коллизии planStart), поэтому
    // группируем строго по task_id — иначе чужие позиции слипаются в одну карточку.
    var rows = [
        row({ task_id: '666355', gp_id: 'a', order_no: '4619' }),
        row({ task_id: '662041', gp_id: 'b', order_no: '4572' }),
        row({ task_id: '666355', gp_id: 'c', order_no: '4619' })
    ];
    var items = rows.map(core.itemFromReportRow);
    var groups = core.groupByTask(items);
    assertEqual(groups.map(function(g) { return g.taskId; }), ['666355', '662041'],
        'groupByTask: порядок групп — как в отчёте (первое появление)');
    assertEqual(groups.map(function(g) { return g.items.length; }), [2, 1],
        'groupByTask: строки одного task_id в одной группе');
    assertEqual(groups[0].taskUnix, 1786078800, 'groupByTask: время задания у группы');
})();

// ── Сводка и фильтр «показать упакованные» ──
(function() {
    var items = [
        core.itemFromReportRow(row({ gp_id: 'a', qty: '110', qty_fact: '110', packed: '110' })),
        core.itemFromReportRow(row({ gp_id: 'b', qty: '16', qty_fact: '24', packed: '' })),
        core.itemFromReportRow(row({ gp_id: 'c', qty: '29', qty_fact: '', packed: '' }))
    ];
    assertEqual(core.summarize(items), { total: 3, packed: 1, rolls: 163, packedRolls: 110 },
        'summarize: позиции, упакованные, рулоны по qty_fact||qty');
    items[1].editedQty = 20;
    assertEqual(core.summarize(items), { total: 3, packed: 1, rolls: 159, packedRolls: 110 },
        'summarize: сводка идёт за правкой количества, а не за отчётом');
    items[1].editedQty = null;
    assertEqual(core.visibleItems(items, false).map(function(i) { return i.gpId; }), ['b', 'c'],
        'visibleItems: упакованные скрыты');
    assertEqual(core.visibleItems(items, true).map(function(i) { return i.gpId; }), ['a', 'b', 'c'],
        'visibleItems: с переключателем видны все, на своих местах');
    assertEqual(core.packedCount(items), 1, 'packedCount: сколько прячет переключатель');
})();

// ── Время задания → локальное HH:MM (round-trip, TZ-независимо) ──
(function() {
    var unix = Math.floor(new Date(2026, 7, 7, 8, 0, 0).getTime() / 1000);
    assertEqual(core.unixToLocalTime(unix), '08:00', 'unixToLocalTime: Unix → HH:MM');
    assertEqual(core.unixToLocalDate(unix), '07.08.2026', 'unixToLocalDate: Unix → DD.MM.YYYY');
    assertEqual(core.unixToLocalTime(''), '', 'unixToLocalTime: пусто → пусто');
})();

// ── Поля записи: что уходит в «Партию ГП» и в «Событие смены» ──
(function() {
    var gpMeta = { id: '1081', reqs: [{ id: '673786', val: 'Упаковано шт' }, { id: '673789', val: 'Примечание' }] };
    assertEqual(core.gpPackFields(gpMeta, { qty: 110, note: '' }), { t673786: 110 },
        'gpPackFields: без примечания пишем только «Упаковано шт»');
    assertEqual(core.gpPackFields(gpMeta, { qty: 90, note: 'часть в брак' }),
        { t673786: 90, t673789: 'часть в брак' },
        'gpPackFields: примечание пишется в «Примечание» партии');

    var evMeta = {
        id: '1082',
        reqs: [
            { id: '1196', val: 'Пользователь' }, { id: '1198', val: 'Значение' },
            { id: '1199', val: 'Примечания' }, { id: '16415', val: 'Задание в производство' },
            { id: '16419', val: 'Тип события' }, { id: '642887', val: 'Слиттер' }
        ]
    };
    var fields = core.eventFields(evMeta, {
        when: '2026-08-09 18:20:00', taskId: '666355', userId: '462', qty: 110, note: ''
    });
    assertEqual(fields, {
        t1082: '2026-08-09 18:20:00', t16419: 'Упаковка', t16415: '666355',
        t1196: '462', t1198: 110
    }, 'eventFields: время, тип «Упаковка», задание, оператор, количество — и НИ СЛОВА о станке');
    assertEqual(Object.prototype.hasOwnProperty.call(
        core.eventFields(evMeta, { when: 'x', taskId: '1', userId: '2', qty: 1, note: '' }), 't642887'), false,
        'eventFields: «Слиттер» не пишется — упаковка без станка');
    assertEqual(core.eventFields(evMeta, { when: 'x', taskId: '', userId: '', qty: 5, note: 'правка' }),
        { t1082: 'x', t16419: 'Упаковка', t1198: 5, t1199: 'правка' },
        'eventFields: без задания и оператора — пишем что есть, примечание попадает в событие');
})();

// ── Упаковочное место: помним выбор, к таблице повторно не ходим ──
(function() {
    var store = {};
    var savedWindow = global.window;
    global.window = { localStorage: {
        getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setItem: function(k, v) { store[k] = String(v); }
    } };
    var Controller = mod.Controller;
    var inst = Object.create(Controller.prototype);
    inst.place = { id: '669275', label: '2' };
    inst.storePlace();

    var fresh = Object.create(Controller.prototype);
    fresh.place = null;
    fresh.restorePlace();
    assertEqual(fresh.place, { id: '669275', label: '2' }, 'restorePlace: место поднимается из localStorage');
    assertEqual(fresh.needsPlacePick(), false, 'needsPlacePick: место есть — таблицу не запрашиваем');

    var virgin = Object.create(Controller.prototype);
    virgin.place = null;
    store = {};
    virgin.restorePlace();
    assertEqual(virgin.place, null, 'restorePlace: пусто — места нет');
    assertEqual(virgin.needsPlacePick(), true, 'needsPlacePick: без места идём в таблицу «Упаковочное место»');
    global.window = savedWindow;
})();

// ── Кнопка «Упаковано» фиксирует упаковку без вопросов (#4680) ──
(function() {
    // Кнопка больше не открывает модалку: она пишет ТО КОЛИЧЕСТВО, КОТОРОЕ ВИДНО в
    // карточке, вместе с примечанием, которым эту правку объяснили.
    var inst = Object.create(mod.Controller.prototype);
    var written = [];
    var asked = [];
    var said = [];
    inst.markPacked = function(item, qty, note) { written.push({ gpId: item.gpId, qty: qty, note: note }); };
    inst.openQtyDialog = function(item) { asked.push(item.gpId); };
    inst.notify = function(message) { said.push(message); };

    var item = core.itemFromReportRow(row({ gp_id: 'a', qty: '110', qty_fact: '60' }));
    inst.packNow(item);
    assertEqual(written, [{ gpId: 'a', qty: 60, note: '' }],
        'packNow: без правки пишем подсказку отчёта и ни о чём не спрашиваем');
    assertEqual(asked, [], 'packNow: модалку кнопка не открывает');

    written = [];
    item.editedQty = 55;
    item.editedNote = '5 шт в брак';
    inst.packNow(item);
    assertEqual(written, [{ gpId: 'a', qty: 55, note: '5 шт в брак' }],
        'packNow: с правкой пишем поправленное количество и её примечание');

    // Отчёт не дал ни плана, ни факта — писать нечего, зовём правку количества.
    written = [];
    var empty = core.itemFromReportRow(row({ gp_id: 'b', qty: '', qty_fact: '' }));
    inst.packNow(empty);
    assertEqual(written, [], 'packNow: нулевое количество в базу не уходит');
    assertEqual(asked, ['b'], 'packNow: вместо нуля открываем правку количества');
    assertEqual(said.length, 1, 'packNow: и говорим, почему отметка не прошла');
})();

// ── #4665: короб и норма укладки на карточке ──
(function() {
    var packing = require('../download/atex/js/packaging-size.js').core;
    var SIZES = packing.sizesFromReport([
        { size_id: '670992', size_name: '31-40 Х 330/450', add_sleeve: '', rows_cnt: '3', per_row: '12', per_box: '36', box: '№125', w_from: '31.00', w_to: '40.00', l_from: '321', l_to: '450', foil: '' },
        { size_id: '671017', size_name: '62-83 Х 330/450', add_sleeve: '', rows_cnt: '2', per_row: '12', per_box: '24', box: '№165', w_from: '62.00', w_to: '83.00', l_from: '321', l_to: '450', foil: '' }
    ]);

    // Обычный случай: типоразмер уже проставлен планированием — берём его по id.
    var stored = core.itemFromReportRow(row({ cut_width: '80.00', cut_length: '450.00', tipo_id: '671017', tipo: '62-83 Х 330/450' }));
    assertEqual(core.sizeForItem(stored, SIZES).name, '62-83 Х 330/450', 'sizeForItem: берёт проставленный типоразмер');

    // Старая партия без ссылки — подбираем на месте по ширине и длине.
    var legacy = core.itemFromReportRow(row({ cut_width: '33.00', cut_length: '450.00', tipo_id: '', tipo: '' }));
    assertEqual(core.sizeForItem(legacy, SIZES).name, '31-40 Х 330/450', 'sizeForItem: без ссылки подбирает сам');

    // Ссылка на запись, которой в справочнике нет, не должна ронять подбор.
    var orphan = core.itemFromReportRow(row({ cut_width: '33.00', cut_length: '450.00', tipo_id: '999999' }));
    assertEqual(core.sizeForItem(orphan, SIZES).name, '31-40 Х 330/450', 'sizeForItem: чужой id — подбираем заново');

    var nothing = core.itemFromReportRow(row({ cut_width: '250.00', cut_length: '450.00', tipo_id: '' }));
    assertEqual(core.sizeForItem(nothing, SIZES), null, 'sizeForItem: нечего подобрать → null');

    var size = core.sizeForItem(stored, SIZES);
    assertEqual(core.packingLabel(size, 24), 'короб №165 · по 24 шт · 1 короб', 'packingLabel: ровно один короб');
    assertEqual(core.packingLabel(size, 50), 'короб №165 · по 24 шт · 3 короба', 'packingLabel: остаток — ещё короб');
    assertEqual(core.packingLabel(size, 200), 'короб №165 · по 24 шт · 9 коробов', 'packingLabel: склонение «коробов»');
    assertEqual(core.packingLabel(null, 10), '', 'packingLabel: без типоразмера — пусто');
})();

// ── #4799: артикул и лидер из отчёта ──
(function() {
    // Обе колонки добавлены в отчёт позже самого рабочего места, поэтому у старых
    // строк их может не быть вовсе — разбор обязан пережить и это, и пустое значение.
    var full = core.itemFromReportRow(row({ art: '0011332', leader: 'Прозрачный' }));
    assertEqual(full.art, '0011332', 'itemFromReportRow: артикул');
    assertEqual(full.leader, 'Прозрачный', 'itemFromReportRow: лидер');

    var blank = core.itemFromReportRow(row({ art: '', leader: '' }));
    assertEqual(blank.art, '', 'itemFromReportRow: пустой артикул → пустая строка');
    assertEqual(blank.leader, '', 'itemFromReportRow: пустой лидер → пустая строка');

    var missing = core.itemFromReportRow(row());
    assertEqual(missing.art, '', 'itemFromReportRow: колонки art нет в строке → пусто');
    assertEqual(missing.leader, '', 'itemFromReportRow: колонки leader нет в строке → пусто');

    // Лидер встаёт в подпись следом за втулкой, доп. втулка остаётся хвостом.
    assertEqual(core.describeItem(full),
        'MWR113L 110 х 600 IN втулка пластик серая для Videojet Прозрачный',
        'describeItem: лидер идёт после втулки');
    assertEqual(core.describeItem(core.itemFromReportRow(row({ leader: 'Прозрачный', add_sleeve: 'Приклеить' }))),
        'MWR113L 110 х 600 IN втулка пластик серая для Videojet Прозрачный + доп. втулка: Приклеить',
        'describeItem: лидер перед хвостом доп. втулки');
    assertEqual(core.describeItem(blank),
        'MWR113L 110 х 600 IN втулка пластик серая для Videojet',
        'describeItem: пустой лидер не оставляет лишнего пробела');
})();

console.log('\n' + passed + ' assertions passed');
