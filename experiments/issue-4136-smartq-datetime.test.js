// Regression test for issue #4136.
//
// templates/smartq.html — кнопка .sq-export-toggle (XLSX/XLS/CSV/буфер) выгружала
// DATETIME-колонки сырым unix-штампом (1782882000), потому что report/?JSON отдаёт их
// как есть: Format_Val_View (index.php) форматирует дату-время только для HTML-рендера,
// а при isApi() пропускает. Ту же сырую величину печатала и ячейка таблицы (drawLine).
//
// Фикс: sqFormatDateTime() переводит штамп в «ДД.ММ.ГГГГ ЧЧ:ММ:СС» — и в drawLine,
// и в sqExportCell (единый вид ячейки и файла, как в js/integram-table.js после #3763).
//
// Тест вытаскивает настоящие функции из шаблона и исполняет их в vm-контексте.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function check(name, ok){
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if(ok) passed++; else { failed++; process.exitCode = 1; }
}

const template = fs.readFileSync(path.join(__dirname, '..', 'templates', 'smartq.html'), 'utf8');

// ── Вытащить объявление функции целиком, считая фигурные скобки ──────────────
function extract(name){
    const start = template.indexOf('function ' + name + '(');
    if(start < 0) throw new Error('function ' + name + '() not found in templates/smartq.html');
    let depth = 0;
    for(let i = template.indexOf('{', start); i < template.length; i++){
        if(template[i] === '{') depth++;
        else if(template[i] === '}' && --depth === 0) return template.slice(start, i + 1);
    }
    throw new Error('unbalanced braces in ' + name + '()');
}

const ctx = { Intl, console };
vm.createContext(ctx);
vm.runInContext([
    extract('isNumeric'),
    extract('sqUnixToDate'),
    extract('sqFormatDateTime'),
    extract('formatNum'),
    extract('sqExportCell'),
].join('\n'), ctx);

// Ожидаемый вид считаем через Date, чтобы тест не зависел от TZ машины.
const p = n => String(n).padStart(2, '0');
function humanize(ts){
    const d = new Date(ts * 1000);
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear()
        + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

// Штампы из экспорта в issue #4136 (колонка «Задание в производство»).
const TS = '1782882000';
const TS_FRACTIONAL = '1782884880.0';

// ── Экспорт: DATETIME-штамп → дата-время ────────────────────────────────────
check('DATETIME-штамп экспортируется как ДД.ММ.ГГГГ ЧЧ:ММ:СС',
    /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$/.test(ctx.sqExportCell(TS, 'DATETIME')));
check('DATETIME-штамп НЕ остаётся сырым числом',
    ctx.sqExportCell(TS, 'DATETIME') !== TS);
check('DATETIME-экспорт совпадает с датой штампа в локальной зоне',
    ctx.sqExportCell(TS, 'DATETIME') === humanize(Number(TS)));
check('дробный штамп (секунды с точкой) тоже разбирается',
    ctx.sqExportCell(TS_FRACTIONAL, 'DATETIME') === humanize(Number(TS_FRACTIONAL)));
check('миллисекундный штамп (>= 1e12) разбирается как мс',
    ctx.sqExportCell(String(Number(TS) * 1000), 'DATETIME') === humanize(Number(TS)));

// ── Ячейка таблицы и файл показывают одно и то же ───────────────────────────
const drawLine = extract('drawLine');
check('drawLine форматирует значение через sqFormatDateTime',
    /value=sqFormatDateTime\(json\.data\[j\]\[i\],col\.format\)/.test(drawLine));
check('drawLine больше не печатает сырое json.data[j][i]',
    !/else\s*\n?\s*value=json\.data\[j\]\[i\];/.test(drawLine));

// ── Ничего постороннего не форматируем ──────────────────────────────────────
check('пустое значение остаётся пустым', ctx.sqExportCell('', 'DATETIME') === '');
check('null → пустая строка', ctx.sqExportCell(null, 'DATETIME') === '');
check('готовая строка даты-времени проходит как есть',
    ctx.sqExportCell('01.07.2026 08:00:00', 'DATETIME') === '01.07.2026 08:00:00');
check('DATE (сервер уже отформатировал) не трогаем',
    ctx.sqExportCell('01.07.2026', 'DATE') === '01.07.2026');
check('DATE-число YYYYMMDD (< 1e9) не превращается в дату',
    ctx.sqFormatDateTime('20260701', 'DATE') === '20260701');
check('штамп в колонке НЕ-DATETIME остаётся числом',
    ctx.sqExportCell(TS, 'SHORT') === TS);
check('id объекта (66414) в DATETIME-колонке не становится 1970-м',
    ctx.sqExportCell('66414', 'DATETIME') === '66414');
check('NUMBER по-прежнему идёт через formatNum',
    ctx.sqExportCell('1234', 'NUMBER') === ctx.formatNum('1234', 'NUMBER'));
check('текст не трогаем', ctx.sqExportCell('Станок 1', 'SHORT') === 'Станок 1');

// ── Границы года ────────────────────────────────────────────────────────────
check('штамп 2100+ не форматируется (защита от больших чисел)',
    ctx.sqFormatDateTime('4200000000', 'DATETIME') === '4200000000');
check('отрицательные/знаковые строки не разбираются',
    ctx.sqFormatDateTime('-1782882000', 'DATETIME') === '-1782882000');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
