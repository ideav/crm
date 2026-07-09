// Unit-тесты для ideav/crm#4120 — кнопка «Копировать в буфер» (.subordinate-copy-buffer-btn)
// подчинённой таблицы клала в clipboard сырой unix-штамп вместо даты:
//
//     1782968400	1782975600	ТО
//   вместо
//     02.07.2026 08:00:00	02.07.2026 10:00:00	ТО
//
// Ячейка таблицы дату показывала правильно (formatSubordinateCellValue → parseDDMMYYYYHHMMSS →
// parseUnixTimestamp), а copySubordinateToBuffer шла мимо форматирования: String(values[i]).
// Проверяем плоский форматтер formatIntegramDateCellPlain и обе реализации копирования —
// IntegramTable (форма редактирования) и IntegramCreateFormHelper (standalone-форма создания).
//
// Run with: node experiments/integram-table-4120.test.js

process.env.TZ = 'Europe/Moscow';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  expected:', JSON.stringify(expected)); console.log('  actual:  ', JSON.stringify(actual)); process.exitCode = 1; }
}

// ── Загрузка бандла в песочницу ──────────────────────────────────────────────
// js/integram-table.js — браузерный скрипт без module.exports. Классы объявлены через
// `class` (лексическая область global-скрипта, не свойства globalThis), поэтому забираем
// их выражением, дописанным в конец того же скрипта.
const bundlePath = path.join(__dirname, '..', 'js', 'integram-table.js');
const source = fs.readFileSync(bundlePath, 'utf8');

let copied = null;   // последний текст, отданный в clipboard
const sandbox = {
    console,
    navigator: { clipboard: { writeText: async (text) => { copied = text; } } },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const exported = vm.runInContext(
    source + '\n;({ IntegramTable, IntegramCreateFormHelper, formatIntegramDateCellPlain });',
    sandbox,
    { filename: 'integram-table.js' }
);
const { IntegramTable, IntegramCreateFormHelper, formatIntegramDateCellPlain } = exported;

// Типы колонок Integram (normalizeFormat): 4 = DATETIME, 9 = DATE, 3 = SHORT, 13 = NUMBER.
const DATETIME = 4, DATE = 9, SHORT = 3, NUMBER = 13;

// ── 1. formatIntegramDateCellPlain: штампы, прочие форматы, не-даты ──────────
assertEqual(formatIntegramDateCellPlain('1782968400', 'DATETIME'), '02.07.2026 08:00:00',
    'unix-штамп (секунды, строка) → DD.MM.YYYY hh:mm:ss');
assertEqual(formatIntegramDateCellPlain(1782975600, 'DATETIME'), '02.07.2026 10:00:00',
    'unix-штамп числом → DD.MM.YYYY hh:mm:ss');
assertEqual(formatIntegramDateCellPlain(1782968400000, 'DATETIME'), '02.07.2026 08:00:00',
    'JS-штамп в миллисекундах (>= 1e12) → та же дата');
assertEqual(formatIntegramDateCellPlain('1782968400', 'DATE'), '02.07.2026',
    'DATE-колонка со штампом → только дата, без времени');
assertEqual(formatIntegramDateCellPlain('20260702', 'DATE'), '02.07.2026',
    'YYYYMMDD (8 цифр, < 1e9) → не принимается за штамп');
assertEqual(formatIntegramDateCellPlain('02.07.2026 08:00:00', 'DATETIME'), '02.07.2026 08:00:00',
    'уже форматированная дата-время остаётся собой');
assertEqual(formatIntegramDateCellPlain('02.07.2026', 'DATE'), '02.07.2026',
    'уже форматированная дата остаётся собой');

assertEqual(formatIntegramDateCellPlain('1782968400', 'NUMBER'), null,
    'не дата-колонка → null (значение берётся как есть)');
assertEqual(formatIntegramDateCellPlain('', 'DATETIME'), null, 'пустое значение → null');
assertEqual(formatIntegramDateCellPlain(null, 'DATETIME'), null, 'null → null');
assertEqual(formatIntegramDateCellPlain('ТО', 'DATETIME'), null, 'нераспознанный текст → null');
assertEqual(formatIntegramDateCellPlain('12345', 'DATETIME'), null,
    'короткое число (< 1e9) не штамп → null');
assertEqual(formatIntegramDateCellPlain('999999999999999', 'DATETIME'), null,
    'штамп вне 2001–2100 → null');

// ── 2. IntegramTable.copySubordinateToBuffer (форма редактирования) ──────────
// Метаданные из issue: главное значение DATETIME + реквизиты «Окончание» (DATETIME) и
// «Вид работ» (ссылка "5:ТО"). arr_id-реквизит (вложенная таблица) в буфер не попадает.
const metadata = {
    val: 'ТО оборудования',
    type: DATETIME,
    reqs: [
        { val: 'Окончание', type: DATETIME, attrs: '' },
        { val: 'Вид работ',  type: SHORT,    attrs: '' },
        { val: 'Детали',     type: NUMBER,   attrs: '', arr_id: 999 },
    ],
};
const rows = [
    { i: 1, r: ['1782968400', '1782975600', '5:ТО', 3] },
    { i: 2, r: ['1783054800', '1783062000', '6:Ремонт', 0] },
];

function makeTable() {
    const self = Object.create(IntegramTable.prototype);
    self.showToast = () => {};
    self.getMetadataName = (m) => m.val;
    return self;
}

copied = null;
const container = { _subordinateData: rows, _subordinateMetadata: metadata };
IntegramTable.prototype.copySubordinateToBuffer.call(makeTable(), container).then(() => {
    assertEqual(copied,
        '02.07.2026 08:00:00\t02.07.2026 10:00:00\tТО\n' +
        '03.07.2026 08:00:00\t03.07.2026 10:00:00\tРемонт',
        'IntegramTable: даты форматированы, ссылка без "id:", вложенная колонка пропущена');

    // ── 3. IntegramCreateFormHelper.copySubordinateToBuffer (форма создания) ─
    const helper = Object.create(IntegramCreateFormHelper.prototype);
    helper.showToast = () => {};

    copied = null;
    const container2 = { _subordinateData: rows, _subordinateMetadata: metadata };
    return IntegramCreateFormHelper.prototype.copySubordinateToBuffer.call(helper, container2);
}).then(() => {
    assertEqual(copied,
        '02.07.2026 08:00:00\t02.07.2026 10:00:00\tТО\n' +
        '03.07.2026 08:00:00\t03.07.2026 10:00:00\tРемонт',
        'IntegramCreateFormHelper: тот же результат, что у IntegramTable');

    // ── 4. Не-дата колонки не портятся ──────────────────────────────────────
    const plainMeta = {
        val: 'Позиция',
        type: SHORT,
        reqs: [{ val: 'Количество', type: NUMBER, attrs: '' }],
    };
    copied = null;
    const container3 = {
        _subordinateData: [{ i: 1, r: ['Втулка 0.5"', '1782968400'] }],
        _subordinateMetadata: plainMeta,
    };
    return IntegramTable.prototype.copySubordinateToBuffer.call(makeTable(), container3);
}).then(() => {
    assertEqual(copied, 'Втулка 0.5"\t1782968400',
        'NUMBER-колонка со «штампоподобным» числом не превращается в дату');

    console.log(`\n${passed}/${total} passed`);
    if (passed !== total) process.exitCode = 1;
}).catch(err => {
    console.error('FAIL — необработанная ошибка:', err);
    process.exitCode = 1;
});
