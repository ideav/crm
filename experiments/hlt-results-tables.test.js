// Гейт-тест для docs/hlt-stand/results.md (issue #5279): таблицы отчёта нагрузочного
// стенда обязаны рендериться как GFM-таблицы — у всех строк блока (шапка, разделитель,
// данные) одинаковое число ячеек, вторая строка — разделитель из «---».
//
// До починки таблицы «Выборки»/«Агрегация» имели 5 колонок в шапке и 11 в строках
// (три сценария одной группы склеивались в одну ячейку через join(' | '), но JS съедал
// обратный слэш, и каждый сценарий уезжал в отдельную ячейку) — GitHub молча отбрасывал
// 6 из 10 колонок данных при рендеринге.
//
// Run with: node experiments/hlt-results-tables.test.js

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'docs', 'hlt-stand', 'results.md');
const text = fs.readFileSync(file, 'utf8');
const lines = text.split('\n');

let passed = 0, total = 0;
function assertTrue(ok, name, detail) {
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  ' + detail); process.exitCode = 1; }
}

// | a | b |  ->  2 ячейки
const cellsOf = (line) => line.split('|').length - 2;

// блоки таблиц = подряд идущие строки, начинающиеся с '|'
const blocks = [];
let cur = [];
lines.forEach((line, i) => {
    if (line.startsWith('|')) cur.push({ n: i + 1, line });
    else if (cur.length) { blocks.push(cur); cur = []; }
});
if (cur.length) blocks.push(cur);

assertTrue(blocks.length >= 5, 'в results.md есть таблицы',
    `найдено блоков: ${blocks.length}`);

for (const b of blocks) {
    const counts = b.map(r => cellsOf(r.line));
    const uniq = [...new Set(counts)];
    assertTrue(uniq.length === 1,
        `таблица со строки ${b[0].n}: во всех строках поровну ячеек`,
        'число ячеек по строкам: ' + b.map(r => `${r.n}→${cellsOf(r.line)}`).join(', '));

    const sep = (b[1] || {}).line || '';
    assertTrue(/^[|-\s]+$/.test(sep) && sep.includes('---'),
        `таблица со строки ${b[0].n}: вторая строка — разделитель «---»`,
        `строка ${(b[1] || {}).n}: ${JSON.stringify(sep)}`);
}

console.log(`\n${passed}/${total} проверок пройдено`);
