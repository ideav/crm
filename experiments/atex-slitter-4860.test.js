// #4860 — РМ слиттера: расход джамбо (номер, рабочий расход, к списанию) и запись
// в таблицу «Номер джамбо» (82374, up = задание).
//
// ТЗ (issue #4860): «Прибавлять Рабочий расход и К списанию к разнице значений
// счетчика — конечное будет за их вычетом». Счётчик мотает назад (#4321):
// потребление джамбо = разница счётчиков, и в неё входят рабочий расход (протяжка
// перед резкой) и списание остатка. Проверяем чистую арифметику и решение
// «создать / обновить / пропустить» запись «Номера джамбо».
//
// Run with: node experiments/atex-slitter-4860.test.js

var slitter = require('../download/atex/js/slitter.js');
var core = slitter.core;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}

// ── 1) финальный счётчик: конечная длина джамбо — за вычетом расхода и списания ──
assertEqual(core.jumboFinalCounter(100, 5, 15), 80, '#4860 кон = счётчик − рабочий расход − к списанию');
assertEqual(core.jumboFinalCounter(18200, 30, 60), 18110, '#4860 дробные метры считаются так же');
assertEqual(core.jumboFinalCounter(100, 0, 0), 100, '#4860 без расхода/списания счётчик не меняется');

// ── 2) расход джамбо входит в разницу счётчиков (погонаж) ──
// Сценарий тикета в перевёрнутых счётчиках: нач. 20000, кон. после резки 18200
// (нарезано 1800), рабочий расход 30, к списанию 60 → финал 18110, а разница
// (погонаж/расход сырья) = 20000 − 18110 = 1890 = 1800 + 30 + 60.
var start = 20000, end = 18200, work = 30, off = 60;
var finalCounter = core.jumboFinalCounter(end, work, off);
assertEqual(core.meterageFromCounters(start, finalCounter), 1890,
    '#4860 разница счётчиков = резка + рабочий расход + к списанию (1800+30+60=1890)');

// ── 3) есть ли что учитывать ──
assertEqual(core.hasJumboData('JUMBO-1', '', ''), true, '#4860 номер заполнен — учитывать');
assertEqual(core.hasJumboData('', 5, ''), true, '#4860 рабочий расход > 0 — учитывать');
assertEqual(core.hasJumboData('', '', 7.5), true, '#4860 к списанию > 0 — учитывать');
assertEqual(core.hasJumboData('', '', ''), false, '#4860 пусто — записи не создаём');
assertEqual(core.hasJumboData('', '0', '0'), false, '#4860 явные нули — ничего не списываем');

// ── 4) создать / обновить / пропустить ──
assertEqual(core.jumboSaveAction('', true), 'new', '#4860 данные есть, записи нет → создаём');
assertEqual(core.jumboSaveAction('90771238', true), 'set', '#4860 запись есть → обновляем');
assertEqual(core.jumboSaveAction('', false), null, '#4860 данных и записи нет → ничего не делаем');
assertEqual(core.jumboSaveAction('90771238', false), 'set',
    '#4860 запись есть, данные стёрли → обновляем пустым (оператор передумал)');

// ── 5) поля записи — по БОЕВОЙ схеме 82374 (метаданные ateh на 03.09.2026) ──
// Гл. значение = номер джамбо (t82374); реквизиты ищутся по имени, «Фото» коду
// не нужна и в поля не попадает; конечная длина — за вычетом расхода и списания.
var JUMBO_82374 = {
    id: '82374',
    reqs: [
        { id: '82376', val: 'Начальная длина, м' },
        { id: '82378', val: 'Кол-во резок' },
        { id: '82380', val: 'Конечная длина, м' },
        { id: '82382', val: 'Рабочий расход, м' },
        { id: '82384', val: 'К списанию, м' },
        { id: '82386', val: 'Брак, м' },
        { id: '82388', val: 'Фото' }   // есть в таблице, slitter её не пишет
    ]
};
var parsed = core.jumboRecordFields(JUMBO_82374, {
    jumboNo: ' JUMBO-7 ', counterStart: 20000, counterEnd: 18200,
    jumboWorkSpent: '30', jumboWriteOff: '60', defectM: '12', actualRuns: '3'
});
assertEqual(parsed.missing, [], '#4860 все нужные реквизиты в боевой схеме на месте');
assertEqual(parsed.fields, {
    't82374': 'JUMBO-7',      // гл. значение, обрезано от пробелов
    't82376': 20000,          // начальная = счётчик нач.
    't82378': '3',            // резки — факт
    't82380': 18110,          // конечная = 18200 − 30 − 60
    't82382': 30,             // рабочий расход
    't82384': 60,             // к списанию
    't82386': '12'            // брак задания дублируется в историю джамбо
}, '#4860 запись собирается по именам реквизитов боевой схемы 82374');

// Резок факт нет — падаем на план задания.
var parsedPlan = core.jumboRecordFields(JUMBO_82374, {
    jumboNo: 'J', counterStart: '', counterEnd: '', jumboWorkSpent: '', jumboWriteOff: '',
    actualRuns: '', plannedRuns: '45'
});
assertEqual(parsedPlan.fields['t82378'], 45, '#4860 нет факта резок — пишем план');

// Схема без части реквизитов: они пропускаются, но имена докладываются вызывающему
// (молча терять поля нельзя — #4564).
var parsedShort = core.jumboRecordFields({ id: '1', reqs: [{ id: '9', val: 'Брак, м' }] },
    { jumboNo: 'X', counterStart: 5, counterEnd: 4, jumboWorkSpent: '', jumboWriteOff: '' });
assertEqual(parsedShort.fields, { 't1': 'X', 't9': '' }, '#4860 есть только знакомый реквизит — пишем его');
assertEqual(parsedShort.missing.sort(), ['Кол-во резок', 'Начальная длина, м', 'Рабочий расход, м', 'К списанию, м', 'Конечная длина, м'].sort(),
    '#4860 отсутствующие реквизиты названы поимённо');

// ── 6) подпись расхода: след правки для автосохранения ──
assertEqual(core.jumboSignature({ jumboNo: 'A', jumboWorkSpent: ' 5 ', jumboWriteOff: '' }), 'A|5|',
    '#4860 подпись — три поля ввода, обрезанные по краям');
assertEqual(core.jumboSignature({ jumboNo: 'A', jumboWorkSpent: '5', jumboWriteOff: '' }),
    core.jumboSignature({ jumboNo: ' A ', jumboWorkSpent: ' 5', jumboWriteOff: null }),
    '#4860 пробелы и null не меняют подпись — лишней записи нет');
assertEqual(core.jumboSignature(null), '', '#4860 без резки подпись пустая');

console.log('\n' + passed + '/' + total + ' passed');
if (process.exitCode) process.exit(process.exitCode);
