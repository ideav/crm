// Test for issue #4892: табличный компонент — супер-пользователь (uid='0') правит всё.
//
// Сценарий тикета: сервер для супер-пользователя (admin, user_id=0) не строит карту
// грантов (Validate_Token не зовёт getGrants), поэтому в метаданных /metadata/{id}
// нет ключа granted вовсе, а window.grants пуст. После #4854/#4855 «granted нет»
// трактуется как READ → у супер-пользователя пропали кнопки создания/правки записей
// и элементы изменения структуры. Теперь isTableWritable()/isStructureWritable()
// и нормализация granted в форме редактирования дают супер-пользователю полный доступ.
// Сервер при этом по-прежнему свой: Check_Grant для admin возвращает TRUE (index.php).
//
// Методы читаются из модуля и исполняются с подставными глобальными uid/window —
// ровно так компонент живёт на странице main.html (uid и window.grants — глобальные).
//
// Run with: node experiments/test-issue-4892-superuser-editable.js

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
        else if (ch === '}' ) {
            depth--;
            if (depth === 0) return coreSource.slice(match.index + 1, i + 1);
        }
    }
    throw new Error(`Could not find matching closing brace for ${name}`);
}

function loadMethods(names) {
    const holder = {};
    for (const name of names) {
        const methodSrc = extractMethod(name).trim();
        Object.assign(holder, new Function('return { ' + methodSrc + ' };')());
    }
    return holder;
}

let passed = 0, failed = 0;
function check(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else { failed++; process.exitCode = 1; }
}

const helpers = loadMethods(['isTableWritable', 'isStructureWritable']);
// this = заглушка компонента { tableGranted: ... } — как в тесте #4851: методы
// решают по глобальным uid/window и состоянию this, не зовут других методов.
const call = (name, self, ...args) => helpers[name].call(self, ...args);

// ── супер-пользователь: uid='0' → правка записей и структуры доступна всегда ──
global.uid = '0'; global.window = {};

check(call('isTableWritable', { tableGranted: 'READ' }) === true, "uid='0', granted READ → правка записей доступна (#4892)");
check(call('isTableWritable', { tableGranted: undefined }) === true, "uid='0', granted нет → правка записей доступна (#4892)");
check(call('isTableWritable', {}) === true, "uid='0', tableGranted не выставлен → правка записей доступна");
check(call('isTableWritable', { tableGranted: 'WRITE' }) === true, "uid='0', granted WRITE → правка записей доступна");
check(call('isStructureWritable', {}) === true, "uid='0', window.grants пуст → правка структуры доступна (#4892)");
global.window = { grants: { 1: 'READ' } };
check(call('isStructureWritable', {}) === true, "uid='0', grants['1']=READ → правка структуры всё равно доступна (#4892)");

// Числовой uid 0 — тоже супер-пользователь (uid приходит строкой из шаблона, но не везде)
global.uid = 0; global.window = {};
check(call('isTableWritable', { tableGranted: 'READ' }) === true, "uid=0 (число), granted READ → правка доступна");

// ── обычный пользователь: прежние правила #1508/#4851/#1536 не изменились ──
global.uid = '42'; global.window = { grants: { 1: 'WRITE' } };

check(call('isTableWritable', { tableGranted: 'WRITE' }) === true, "uid!='0': granted WRITE → правка доступна");
check(call('isTableWritable', { tableGranted: 'READ' }) === false, "uid!='0': granted READ → read-only");
check(call('isTableWritable', { tableGranted: undefined }) === false, "#4851 не сломан: uid!='0', granted нет → read-only");
check(call('isStructureWritable', {}) === true, "uid!='0': grants['1']=WRITE → структура доступна");

global.window = { grants: { 1: 'READ' } };
check(!call('isStructureWritable', {}), "uid!='0': grants['1']=READ → структура скрыта");

global.window = {};
check(!call('isStructureWritable', {}), "uid!='0': grants пуст → структура скрыта");

// ── хост-страница без глобального uid — не супер-пользователь ──
global.uid = undefined; global.window = {};

check(call('isTableWritable', { tableGranted: undefined }) === false, "uid не определён, granted нет → read-only");

console.log(`\n${passed} passed, ${failed} failed`);
