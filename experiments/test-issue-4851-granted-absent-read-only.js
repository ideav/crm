// Test for issue #4851: js/integram-table.js — в табличном компоненте отсутствие
// ключа granted в метаданных таблицы трактуется как READ (read-only), а не как WRITE.
//
// Сценарий тикета: справочник, доступный на чтение через ссылку из другой таблицы
// (например, «Пользователь»), не имеет в метаданных ключа granted. Компонент считал
// tableGranted=null → isTableWritable()=true и показывал кнопки/инлайн-правку, хотя
// сервер любую правку отверг бы. Теперь: только явный granted "WRITE" даёт write-UI;
// отсутствие ключа эквивалентно READ.
//
// Run with: node experiments/test-issue-4851-granted-absent-read-only.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const coreSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'integram-table', '01-core.js'),
    'utf8'
);

function extractMethod(name) {
    const re = new RegExp(`(?:^|\\n)        (async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`);
    const match = coreSource.match(re);
    if (!match) throw new Error(`Could not find method ${name} in module source`);
    const start = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = start; i < coreSource.length; i++) {
        const ch = coreSource[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return coreSource.slice(match.index + 1, i + 1);
        }
    }
    throw new Error(`Could not find matching closing brace for ${name}`);
}

// isTableWritable из модуля — в контексте объекта с this.tableGranted.
const isTableWritable = (function() {
    const methodSrc = extractMethod('isTableWritable').trim();
    const holder = new Function('return { ' + methodSrc + ' };')();
    return function(granted) { return holder.isTableWritable.call({ tableGranted: granted }); };
})();

let passed = 0, failed = 0;
function check(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else { failed++; process.exitCode = 1; }
}

// ── новое правило (#4851): WRITE только при явном granted "WRITE" ──
check(isTableWritable('WRITE') === true, "granted 'WRITE' → модификация доступна");
check(isTableWritable('READ') === false, "granted 'READ' → read-only");
check(isTableWritable(null) === false, '#4851 granted отсутствует (null) → read-only');
check(isTableWritable(undefined) === false, '#4851 granted отсутствует (undefined) → read-only');
check(isTableWritable('') === false, "#4851 granted '' → read-only");

// ── присваивания tableGranted: отсутствующий ключ нормализуется в 'READ' ──
const assignments = coreSource.match(/this\.tableGranted = \w+\.granted !== undefined \? \w+\.granted : 'READ';/g) || [];
check(assignments.length >= 2,
    `#4851 все присваивания tableGranted в 01-core нормализуют отсутствующий ключ в 'READ' (найдено ${assignments.length})`);

// 02-format-helpers: та же логика уровня таблицы
const fmtSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'integram-table', '02-format-helpers.js'), 'utf8');
const fmtAssignments = fmtSource.match(/this\.tableGranted = \w+\.granted !== undefined \? \w+\.granted : 'READ';/g) || [];
check(fmtAssignments.length >= 3, '#4851 02-format-helpers: отсутствующий ключ → READ везде');

// ── форма редактирования (19-form-edit.js): granted отсутствует → форма read-only ──
const formSource = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'integram-table', '19-form-edit.js'), 'utf8');
check(formSource.includes("metadata.granted !== undefined ? metadata.granted : 'READ'"),
    '#4851 форма редактирования: отсутствующий granted нормализован в READ');
check(!formSource.includes("metadataGranted !== null && metadataGranted !== 'WRITE'"),
    '#4851 форма редактирования: прежнее «null → форма редактируется» убрано');
check(formSource.includes("const formIsReadOnly = metadataGranted !== 'WRITE';"),
    '#4851 форма редактирования: formIsReadOnly = (granted !== WRITE)');

// ── прежнее поведение #1508 для явных значений не изменилось ──
check(coreSource.includes("this.tableGranted === 'WRITE'"), 'проверка осталась строгим сравнением с WRITE');

console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);
