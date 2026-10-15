// #5166 — окно восстановления из архива в dir_admin (js/restore-backup.js).
//
// Проверяем решения окна, от которых зависит, уйдёт ли в базу разрушающий POST:
//   A — «Восстановить» доступно только для настоящего дампа (INSERT архива), а не для текста ошибки;
//   B — подтверждение — только точное имя базы (регистр и пробелы по краям не важны);
//   C — длинный дамп показывается обрезанным, с пометкой сколько показано;
//   D — итог: ok называет число строк и страховочный бэкап, ошибка — тоже бэкап, если он снят.
//
// Run with: node experiments/restore-backup-dialog-5166.test.js

const assert = require('assert');
const path = require('path');
const RB = require(path.join(__dirname, '..', 'js', 'restore-backup.js'));

let passed = 0;
function check(name, fn) {
    fn();
    passed++;
    console.log('PASS — ' + name);
}

check('A: дамп архива распознан', () => {
    assert.strictEqual(RB.isDump("INSERT INTO `acme` (`id`, `t`, `up`, `ord`, `val`) VALUES (1,1,1,1,'ROOT');"), true);
});
check('A: текст ошибки сервера — не дамп', () => {
    assert.strictEqual(RB.isDump('У вас нет прав на импорт базы'), false);
    assert.strictEqual(RB.isDump('Загрузите файл для восстановления'), false);
    assert.strictEqual(RB.isDump(''), false);
    assert.strictEqual(RB.isDump(undefined), false);
});

check('B: имя базы подтверждает', () => {
    assert.strictEqual(RB.confirmMatches('acme', 'acme'), true);
    assert.strictEqual(RB.confirmMatches('  ACME ', 'acme'), true);
});
check('B: другое имя, пусто или без базы — не подтверждает', () => {
    assert.strictEqual(RB.confirmMatches('acm', 'acme'), false);
    assert.strictEqual(RB.confirmMatches('', 'acme'), false);
    assert.strictEqual(RB.confirmMatches('', ''), false);
});

check('C: короткий дамп показывается целиком', () => {
    assert.strictEqual(RB.previewText('INSERT x'), 'INSERT x');
});
check('C: длинный дамп обрезан с пометкой', () => {
    const big = 'x'.repeat(50000);
    const shown = RB.previewText(big);
    assert.ok(shown.length < 21000);
    assert.ok(shown.indexOf('20000 из 50000') !== -1);
});

check('D: ok — строки, владелец и страховочный бэкап', () => {
    const r = RB.resultMessage(JSON.stringify({ result: 'ok', rows: 1234, backup: 'acme_20261016_101500.dmp.zip', user: 'acme', role: 145 }));
    assert.strictEqual(r.ok, true);
    assert.ok(r.text.indexOf('1234') !== -1);
    assert.ok(r.text.indexOf('acme_20261016_101500.dmp.zip') !== -1);
});
check('D: обрыв — ошибка и бэкап, из которого вернуть базу', () => {
    const r = RB.resultMessage(JSON.stringify({ error: 'Восстановление прервано', backup: 'acme_1.dmp.zip' }));
    assert.strictEqual(r.ok, false);
    assert.ok(r.text.indexOf('Восстановление прервано') !== -1);
    assert.ok(r.text.indexOf('acme_1.dmp.zip') !== -1);
});
check('D: ошибка ядра массивом [{error}] и сырой текст — не успех', () => {
    assert.strictEqual(RB.resultMessage(JSON.stringify([{ error: 'Неверный токен CSRF' }])).ok, false);
    const raw = RB.resultMessage('Неверный или устаревший токен CSRF');
    assert.strictEqual(raw.ok, false);
    assert.ok(raw.text.indexOf('токен CSRF') !== -1);
});

console.log('\n' + passed + ' проверок пройдено');
