// Tests for ideav/crm#5381 — dash: числа показываются округлёнными (без хвостов плавающей точки).
//
// Правило по умолчанию (когда формат не задан явно): |n| >= 1 — 2 знака после запятой,
// |n| < 1 — 4 знака, хвостовые нули не дописываются. Округляется только строка для экрана;
// полное значение ячейки лежит в data-raw и берётся расчётами через dashCellText.
// Функции берутся из ИСХОДНИКА js/dash.js.
//
// Run with: node experiments/dash-display-rounding-5381.test.js

const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'dash.js'), 'utf8');

let passed = 0;
function eq(actual, expected, msg) {
    if (actual !== expected) throw new Error('FAIL: ' + msg + ' — ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual));
    passed++;
}

function fnSource(name) {
    const start = SRC.indexOf('\nfunction ' + name + '(');
    if (start === -1) throw new Error('FAIL: в js/dash.js нет функции ' + name);
    const next = SRC.indexOf('\nfunction ', start + 1);
    return SRC.slice(start, next === -1 ? SRC.length : next);
}

const names = ['dashAttr', 'dashNormalizeNumberText', 'dashRoundNumberText', 'dashCellRawAttr',
    'dashFormatNumberText', 'dashGetFloat', 'dashCellText', 'dashFormatTooltipValue'];
const code = names.map(fnSource).join('\n')
    + '\nreturn { ' + names.map(n => n + ': ' + n).join(', ') + ' };';
const d = new Function(code)();

// --- общее правило: шум плавающей точки убирается
eq(d.dashFormatNumberText(100.000000001), '100', 'число 100.000000001');
eq(d.dashFormatNumberText(-124975112.49999994), '-124 975 112.5', 'число -124975112.49999994');
eq(d.dashFormatNumberText('100.000000001'), '100', 'строка 100.000000001');
eq(d.dashFormatNumberText('-124975112.49999994'), '-124 975 112.5', 'строка -124975112.49999994');
eq(d.dashFormatNumberText(0.1 + 0.2), '0.3', '0.1+0.2');
eq(d.dashFormatNumberText(1.1 * 3), '3.3', '1.1*3');
eq(d.dashFormatNumberText(4), '4', 'целое без нулей');
eq(d.dashFormatNumberText('4.00'), '4.00', 'уже короткая дробь не трогается');
eq(d.dashFormatNumberText(12.345678), '12.35', '2 знака при |n|>=1');
eq(d.dashFormatNumberText(1234567.891), '1 234 567.89', 'разделитель тысяч + 2 знака');

// --- доли: |n| < 1 — 4 знака, а не 0.31
eq(d.dashFormatNumberText(0.3098), '0.3098', 'доля 0.3098 не схлопывается в 0.31');
eq(d.dashFormatNumberText('0,3098'), '0,3098', 'доля с запятой');
eq(d.dashFormatNumberText(0.30980000001), '0.3098', 'доля с шумом');
eq(d.dashFormatNumberText(-0.123456), '-0.1235', 'отрицательная доля');
eq(d.dashFormatNumberText(0.99999), '1', 'округление до единицы');
eq(d.dashFormatNumberText(0.00001), '0', 'ниже 4 знаков -> 0');
eq(d.dashFormatNumberText(-0.00001), '0', 'без «-0»');
eq(d.dashFormatNumberText(-1e-12), '0', 'экспонента без «-0»');

// --- формат и разделитель сохраняются
eq(d.dashFormatNumberText('1 234,5678'), '1 234,57', 'запятая как разделитель дроби');
eq(d.dashFormatNumberText('12.3456%'), '12.35%', 'процент');
eq(d.dashFormatNumberText('+5.123456'), '+5.12', 'знак плюс');
eq(d.dashFormatNumberText(''), '', 'пусто');
eq(d.dashFormatNumberText(null), '', 'null');
eq(d.dashFormatNumberText('abc'), 'abc', 'не число — как есть');
eq(d.dashFormatNumberText('007.12345'), '007.12345', 'ведущие нули (код) — как есть');

// --- тултип графика: без tooltipDecimals — то же правило, явный формат главнее
eq(d.dashFormatTooltipValue(100.000000001, { tooltipSuffix: ' ₽' }), '100 ₽', 'тултип без decimals');
eq(d.dashFormatTooltipValue(0.30980000001, { tooltipPrefix: '~' }), '~0.3098', 'тултип доля');
eq(d.dashFormatTooltipValue(100.000000001, { tooltipDecimals: 3 }), '100.000', 'явный tooltipDecimals главнее');
eq(d.dashFormatTooltipValue(1234.5, { tooltipDecimals: 0 }), '1235', 'явный tooltipDecimals=0');

// --- расчёты не округляются: data-raw
const attr = d.dashCellRawAttr('100.123456');
eq(attr, ' data-raw="100.123456"', 'data-raw нужен, когда экран округлён');
eq(d.dashCellRawAttr('100.12'), '', 'data-raw не нужен, если округления нет');
eq(d.dashCellRawAttr('abc'), '', 'data-raw не нужен для не-чисел');
function cell(text, raw) {
    return { textContent: text, getAttribute: n => (n === 'data-raw' ? raw : null) };
}
eq(d.dashCellText(cell('100.12', '100.123456')), '100.123456', 'расчёт берёт полное значение');
eq(d.dashCellText(cell('105', '100.123456')), '105', 'после ручной правки data-raw не используется');
eq(d.dashCellText(cell('100.12', null)), '100.12', 'без data-raw — текст ячейки');
eq(d.dashGetFloat(d.dashCellText(cell('1 000.54', '1000.5432'))), 1000.5432, 'сумма читает полное число');

console.log('dash-display-rounding-5381: ' + passed + ' проверок, 0 падений');
