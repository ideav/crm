// Issue #5642: универсальный импорт — преобразования Excel перед загрузкой.
// rules: none (defect #5642)
//
// Книга experiments/import-5642.fixture.json (xlsx в base64, генератор openpyxl там же,
// данные обезличены) читается настоящим SheetJS 0.18.5 из js/, преобразования —
// настоящим js/upload-xlsx-transforms.js. Вторая часть прогоняет applyXlsxRange()
// из templates/upload.html и смотрит, что попадает в поле #input.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const XLSX = (function(){
  const src = fs.readFileSync(path.join(ROOT, 'js', 'xlsx0.18.5.full.min.js'), 'utf8');
  const win = {};
  return (new Function('window', 'var module,exports,define;' + src + ';return window.XLSX||XLSX;'))(win);
})();
const U = require(path.join(ROOT, 'js', 'upload-xlsx-transforms.js'));
const wb = XLSX.read(Buffer.from(require('./import-5642.fixture.json').xlsx_base64, 'base64'),
  {type: 'buffer', cellDates: true, cellStyles: true});
const ALL = {r0: 0, c0: 0, r1: null, c1: null};

test('без опций — то же, что прежний sheet_to_json (шапка в одну строку, без разворота)', () => {
  const out = U.build(XLSX, wb, 'Ноябрь', ALL, {}, true).rows;
  assert.deepStrictEqual(out[0], ['Сотрудник', 'Таб. номер', 'Неделя 1', '', '']);
  assert.deepStrictEqual(out[2], ['Сотрудник А', '000123', '8', '', '8']);
  assert.strictEqual(out[3][1], '4.6E+12');
});

test('п.3: объединённые ячейки разносятся, шапка в 2 строки склеивается', () => {
  const out = U.build(XLSX, wb, 'Ноябрь', ALL, {headerRows: 2}, true).rows;
  assert.deepStrictEqual(out[0], ['Сотрудник', 'Таб. номер', 'Неделя 1 1', 'Неделя 1 2', 'Неделя 1 3']);
  assert.deepStrictEqual(out[1], ['Сотрудник А', '000123', '8', '', '8']);
});

test('п.5: колонка «текст как есть» — штрихкод без экспоненты, нули сохранены', () => {
  const out = U.build(XLSX, wb, 'Ноябрь', ALL, {headerRows: 2, textCols: 'B'}, true).rows;
  assert.strictEqual(out[1][1], '000123');
  assert.strictEqual(out[2][1], '4600000000000');
});

test('п.4: цвет заливки → значение справочника (только пустые клетки)', () => {
  const sh = U.readSheet(XLSX, wb.Sheets['Ноябрь'], {});
  assert.deepStrictEqual(U.listFills(sh).map(f => f.key).sort(), ['00B050', 'FFFF00']);
  const out = U.build(XLSX, wb, 'Ноябрь', ALL,
    {headerRows: 2, colors: {'00B050': 'вахта', 'FFFF00': 'отпуск'}}, true).rows;
  assert.deepStrictEqual(out[1].slice(2), ['8', 'вахта', '8']);
  assert.deepStrictEqual(out[2].slice(2), ['отпуск', '12', '']);
});

test('п.6: строка «Итого» пропускается, «Итоговая» — нет', () => {
  const out = U.build(XLSX, wb, 'Ноябрь', ALL, {headerRows: 2, skip: {words: 'Итого, Всего'}}, true).rows;
  assert.strictEqual(out.length, 3);
  assert.ok(!out.some(r => r[0] === 'Итого'));
  const keep = U.skipRowsFilter([['Итоговая аттестация'], ['ИТОГО:'], ['Итого по отделу']], [0, 0, 0], {words: ['Итого']});
  assert.deepStrictEqual(keep, [true, false, false]);
});

test('п.6: только нижний уровень группировки и пустая ключевая колонка', () => {
  const deep = U.build(XLSX, wb, 'Декабрь', ALL, {headerRows: 2, skip: {deepest: true}}, true).rows;
  assert.deepStrictEqual(deep.slice(1).map(r => r[0]), ['Сотрудник В', 'Сотрудник Г']);
  const byKey = U.build(XLSX, wb, 'Декабрь', ALL, {headerRows: 2, skip: {emptyCol: 'B'}}, true).rows;
  assert.deepStrictEqual(byKey.slice(1).map(r => r[0]), ['Сотрудник В', 'Сотрудник Г']);
});

test('п.7: все листы за проход, имя листа — колонка «Лист», шапка одна', () => {
  const out = U.build(XLSX, wb, 'Ноябрь', ALL,
    {headerRows: 2, allSheets: true, textCols: 'B', skip: {words: 'Итого', emptyCol: 'B'}}, true).rows;
  assert.strictEqual(out[0][out[0].length - 1], 'Лист');
  assert.deepStrictEqual(out.slice(1).map(r => [r[0], r[1], r[r.length - 1]]), [
    ['Сотрудник А', '000123', 'Ноябрь'],
    ['Сотрудник Б', '4600000000000', 'Ноябрь'],
    ['Сотрудник В', '000777', 'Декабрь'],
    ['Сотрудник Г', '000778', 'Декабрь'],
  ]);
});

test('п.2: периоды в колонках → строки «объект — период — значение»', () => {
  const out = U.build(XLSX, wb, 'Ноябрь', ALL,
    {headerRows: 2, unpivot: 'C:E', skip: {words: 'Итого'}, colors: {'00B050': 'В'}}, true).rows;
  assert.deepStrictEqual(out, [
    ['Сотрудник', 'Таб. номер', 'Период', 'Значение'],
    ['Сотрудник А', '000123', 'Неделя 1 1', '8'],
    ['Сотрудник А', '000123', 'Неделя 1 2', 'В'],
    ['Сотрудник А', '000123', 'Неделя 1 3', '8'],
    ['Сотрудник Б', '4.6E+12', 'Неделя 1 2', '12'],
  ]);
  // старт диапазона не с A: буквы колонок — по сетке листа
  const fromB = U.build(XLSX, wb, 'Ноябрь', {r0: 1, c0: 1, r1: 3, c1: null}, {unpivot: 'C:E'}, true).rows;
  assert.deepStrictEqual(fromB[0], ['', 'Период', 'Значение']);
  assert.deepStrictEqual(fromB[1], ['000123', '1', '8']);
});

test('п.8: помощники формул', () => {
  const h = U.helpers;
  assert.strictEqual(h.uplFioShort('Иванов Иван Иванович'), 'Иванов И.И.');
  assert.strictEqual(h.uplFioShort('Иванов И.И.'), 'Иванов И.И.');
  assert.strictEqual(h.uplPhone('8 (912) 345-67-89'), '+79123456789');
  assert.strictEqual(h.uplPhone('912 345 67 89'), '+79123456789');
  assert.strictEqual(h.uplMoney('1 234 567,89 руб.'), '1234567.89');
  assert.strictEqual(h.uplMoney('(1 000)'), '-1000');
  assert.strictEqual(h.uplMoney('1,234.5'), '1234.5');
  assert.strictEqual(h.uplMoney(''), '');
  assert.strictEqual(h.uplSigned('', '1 500,50'), '-1500.5');
  assert.strictEqual(h.uplShiftEnd('31.12.2026', '20:00', '08:00'), '01.01.2027 08:00');
  assert.strictEqual(h.uplShiftEnd('05.11.2026', '08:00', '20:00'), '05.11.2026 20:00');
  assert.strictEqual(h.uplDate('5', 'Ноябрь', '2026'), '05.11.2026');
  assert.strictEqual(h.uplDate('31', '2', '2026'), '');
  assert.strictEqual(h.uplMonthDate('Май 2026'), '01.05.2026');
  assert.strictEqual(h.uplMonthDate('03.2026'), '01.03.2026');
  assert.strictEqual(h.uplMonthDate('Март 2026'), '01.03.2026');
  // шаблон формулы, подставленный так, как это делает importDoParse (escape + eval)
  for (const t of U.formulaTemplates) assert.doesNotThrow(() => new Function(...Object.keys(h), 'return ' + t.f.replace(/\[[^\]]+\]/g, 'x'))(...Object.values(h)), t.name);
});

// ── upload.html: applyXlsxRange() отдаёт в #input результат преобразований ─────
function extractFn(src, name){
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(name + '() not found in template');
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unbalanced ' + name);
}

test('upload.html: applyXlsxRange берёт настройки панели и отдаёт развёрнутые строки', () => {
  const tpl = fs.readFileSync(path.join(ROOT, 'templates', 'upload.html'), 'utf8');
  assert.ok(/<script src="\/js\/upload-xlsx-transforms\.js\?\{_global_\.version\}\.\d+"><\/script>/.test(tpl),
    'шаблон подключает модуль преобразований с версией');
  const Papa = require(path.join(ROOT, 'js', 'papaparse5.3.1.min.js'));
  const vals = {'#delim': ',', '#xlsx-sheet': 'Ноябрь'};
  let input = null, parsed = 0;
  const $ = function(sel){
    return {
      val(v){ if (v === undefined) return vals[sel]; if (sel === '#input') input = v; return this; },
      hide(){ return this; }, show(){ return this; }, html(){ return this; },
      prop(){ return sel === '#header'; },
    };
  };
  const names = ['serializeUploadCellValue', 'xlsxEndR', 'xlsxEndC', 'xlsxGetOpts', 'applyXlsxRange'];
  const body = names.map(n => extractFn(tpl, n)).join('\n');
  const run = new Function('$', 'Papa', 'window', 'UploadXlsx', 'importParse', 'xlsxShowError', 'xlsxWorkbook', 'xlsxRows', 'xlsxSel', 'xlsxOpts',
    body + '\nreturn applyXlsxRange();');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Ноябрь'], {header: 1, raw: false, defval: ''});
  const ok = run($, Papa, {XLSX}, U, () => { parsed++; }, (m) => { throw new Error(m); }, wb, rows, {r0: 0, c0: 0, r1: null, c1: null},
    {headerRows: 2, textCols: 'B', unpivot: 'C:E', skip: {words: 'Итого'}, colors: {'00B050': 'вахта'}});
  assert.strictEqual(ok, true);
  assert.strictEqual(parsed, 1);
  const lines = Papa.parse(input).data;
  assert.deepStrictEqual(lines[0], ['Сотрудник', 'Таб. номер', 'Период', 'Значение']);
  assert.deepStrictEqual(lines[2], ['Сотрудник А', '000123', 'Неделя 1 2', 'вахта']);
  assert.deepStrictEqual(lines[4], ['Сотрудник Б', '4600000000000', 'Неделя 1 2', '12']);
});
