// Unit tests: допуск планшета к пультам оператора (ideav/crm#4666).
//
// Проверяем чистый слой сторожа: поиск таблицы «Планшет» в метаданных, право на
// регистрацию, сборку запроса с фильтром по ПЕРВОЙ колонке, разбор строк, формат
// токена и параметры записи нового планшета.
//
// Run with: node experiments/atex-pad-guard.test.js

var guard = require('../download/atex/js/pad-guard.js');

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

// Метаданные таблицы «Планшет» — как в задаче #4666.
var PAD_TABLE = {
    id: '673803', up: '0', type: '3', val: 'Планшет', unique: '1',
    granted: 'WRITE', export: '1', delete: '1',
    reqs: [{ num: 1, id: '673807', val: 'Наименование', orig: '673806', type: '3' }]
};
var METADATA = [
    { id: '1078', val: 'Задание в производство', granted: 'WRITE', reqs: [] },
    PAD_TABLE,
    { id: '1081', val: 'Партия ГП', granted: 'READ', reqs: [] }
];

// ── Поиск таблицы в метаданных ──
assertEqual(guard.findTable(METADATA).id, '673803', 'таблица «Планшет» находится по имени');
assertEqual(guard.findTable([{ id: '9', val: ' планшет ', reqs: [] }]).id, '9', 'имя сверяется без регистра и пробелов');
assertEqual(guard.findTable([{ id: '9', val: 'Планшеты', reqs: [] }]), null, 'похожее имя таблицей не считается');
assertEqual(guard.findTable([]), null, 'пустые метаданные → таблицы нет');
assertEqual(guard.findTable(null), null, 'нет метаданных → таблицы нет');

// ── Право зарегистрировать планшет ──
assertEqual(guard.canRegister(PAD_TABLE), true, 'granted WRITE — регистрировать можно');
assertEqual(guard.canRegister({ val: 'Планшет', granted: 'READ' }), false, 'granted READ — регистрировать нельзя');
assertEqual(guard.canRegister({ val: 'Планшет' }, { user: 'operator', db: 'ateh' }), false,
    'без granted обычному пользователю регистрировать нельзя');
assertEqual(guard.canRegister(null), false, 'нет таблицы — регистрировать нельзя');
// Владельцу базы и админу сервер гранты не выдаёт вовсе (index.php, Check_Grant) —
// по одному лишь полю granted они выглядели бы бесправными.
assertEqual(guard.canRegister({ val: 'Планшет' }, { user: 'ateh', db: 'ateh' }), true,
    'владелец базы регистрирует и без granted');
assertEqual(guard.canRegister({ val: 'Планшет' }, { user: 'admin', db: 'ateh' }), true,
    'админ регистрирует и без granted');
assertEqual(guard.canRegister({ val: 'Планшет' }, { user: 'petrov', db: 'ateh', role: 'admin' }), true,
    'роль admin регистрирует и без granted');
assertEqual(guard.canRegister({ val: 'Планшет', granted: 'READ' }, { user: 'ateh', db: 'ateh' }), false,
    'ЯВНЫЙ грант сильнее владельца: READ — значит нельзя');

// ── Реквизит «Наименование» ──
assertEqual(guard.nameReqId(PAD_TABLE), '673807', 'id реквизита «Наименование»');
assertEqual(guard.nameReqId({ reqs: [] }), '', 'нет реквизита — пусто');
assertEqual(guard.nameColIndex(PAD_TABLE), 1, 'колонка имени идёт сразу за токеном');
assertEqual(guard.nameColIndex({
    reqs: [{ id: '1', val: 'Прочее' }, { id: '2', val: 'Наименование' }]
}), 2, 'колонка имени считается по порядку реквизитов');
// Грабли #4655: имя колонки может лежать в attrs.alias, а `val` нести имя ТИПА.
assertEqual(guard.nameReqId({ reqs: [{ id: '7', val: 'Планшет.Наименование', attrs: '{"alias":"Наименование"}' }] }), '7',
    'реквизит находится по псевдониму attrs.alias');
assertEqual(guard.nameColIndex({ reqs: [{ id: '7', val: 'Планшет.Наименование', attrs: { alias: 'Наименование' } }] }), 1,
    'колонка по псевдониму считается так же');

// ── Запрос на поиск планшета ──
assertEqual(guard.buildLookupPath('673803', 'abc123'),
    'object/673803/?JSON_OBJ&LIMIT=0,2&F_673803=abc123',
    'фильтр по первой колонке — ключ равен id таблицы');

// ── Разбор ответа ──
var ROWS = [{ i: '673900', r: ['9f86d081884c7d65', 'Планшет слиттера №1'] }];
assertEqual(guard.padFromRows(ROWS, '9f86d081884c7d65', 1),
    { id: '673900', token: '9f86d081884c7d65', name: 'Планшет слиттера №1' },
    'запись с токеном разбирается в планшет');
assertEqual(guard.padFromRows({ object: ROWS }, '9f86d081884c7d65', 1).id, '673900',
    'формат {object:[…]} тоже понимается');
assertEqual(guard.padFromRows(ROWS, '9f86d081884c7d6', 1), null,
    'ЧАСТИЧНОЕ совпадение токена планшетом не считается');
assertEqual(guard.padFromRows([], 'abc', 1), null, 'нет записей → планшета нет');
assertEqual(guard.padFromRows([{ i: '1', r: ['other', 'Чужой'] }], 'abc', 1), null,
    'чужой токен планшетом не считается');

// ── Токен ──
var crypto = { getRandomValues: function(arr) { for (var i = 0; i < arr.length; i++) arr[i] = i; return arr; } };
var token = guard.makeToken(crypto);
assertEqual(token.length, 32, 'токен — 32 hex-символа');
assertEqual(/^[a-f0-9]+$/.test(token), true, 'токен состоит только из hex');
assertEqual(guard.isToken(token), true, 'сгенерированный токен проходит проверку формата');
// Символы %, @, !, <, > меняют смысл серверного фильтра F_{tableId} — hex их исключает.
assertEqual(guard.isToken('%'), false, '«%» токеном не считается (иначе фильтр станет LIKE)');
assertEqual(guard.isToken('@123'), false, '«@…» токеном не считается (иначе фильтр уйдёт по id)');
assertEqual(guard.isToken(''), false, 'пустая строка токеном не считается');
assertEqual(guard.isToken('  '), false, 'пробелы токеном не считаются');
var thrown = '';
try { guard.makeToken(null); } catch (e) { thrown = e.message; }
assertEqual(thrown.indexOf('crypto') >= 0, true, 'без crypto токен не выдумывается, а падает с ошибкой');

// ── Параметры записи планшета ──
assertEqual(guard.registerParams(PAD_TABLE, 'deadbeef', 'Планшет №2'),
    { t673803: 'deadbeef', t673807: 'Планшет №2' },
    'токен пишется в первую колонку, имя — в «Наименование»');
assertEqual(guard.registerParams({ id: '5', reqs: [] }, 'deadbeef', 'Имя'),
    { t5: 'deadbeef' },
    'без реквизита «Наименование» пишется только токен');

// ── Ошибки API (Integram отвечает [{error}] и часто с 4xx) ──
assertEqual(guard.apiError({ ok: false, status: 403 }, [{ error: 'Нет доступа' }]), 'Нет доступа',
    'ошибка достаётся из массива');
assertEqual(guard.apiError({ ok: false, status: 403 }, { error: 'Нет доступа' }), 'Нет доступа',
    'ошибка достаётся из объекта');
assertEqual(guard.apiError({ ok: false, status: 500 }, [{ i: '1' }]), 'Сервер ответил 500',
    'ответ не ok без текста ошибки — всё равно ошибка');
assertEqual(guard.apiError({ ok: true, status: 200 }, [{ i: '1', r: ['a'] }]), '',
    'обычный ответ ошибкой не считается');

// ── localStorage ──
var store = (function() {
    var data = {};
    return {
        getItem: function(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
        setItem: function(k, v) { data[k] = String(v); }
    };
})();
assertEqual(guard.readToken(store), '', 'пустое хранилище → токена нет');
guard.writeToken(store, 'deadbeef');
assertEqual(guard.readToken(store), 'deadbeef', 'записанный токен читается');
assertEqual(store.getItem('atehPad'), 'deadbeef', 'токен лежит под ключом atehPad');
var broken = { getItem: function() { throw new Error('disabled'); }, setItem: function() { throw new Error('disabled'); } };
assertEqual(guard.readToken(broken), '', 'отключённый localStorage не роняет пульт при чтении');
assertEqual(guard.writeToken(broken, 'x'), false, 'отключённый localStorage честно возвращает false при записи');

console.log('\n' + passed + ' assertions passed');
