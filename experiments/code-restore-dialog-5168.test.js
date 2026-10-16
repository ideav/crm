// Мерка к issue #5168: окно восстановления файлов из архива .code.zip (js/code-restore.js).
// Проверяется поведение, а не текст исходника: решения модуля — что считать составом архива,
// когда применять можно, что показывать в итоге.

const test = require('node:test');
const assert = require('node:assert');
const api = require('../js/code-restore.js');

test('isListing: состав архива от текста ошибки', () => {
    // Ответ GET code_restore: маркер + пути + TOTAL
    const listing = 'CODE BACKUP cb_20261016_120000.code.zip\n'
        + 'templates/main.html 1234\n'
        + 'download/app.js 567\n'
        + 'download/upload/000/x.txt 8910\n'
        + 'TOTAL 3';
    assert.ok(api.isListing(listing), 'состав архива распознан');
    assert.ok(!api.isListing('Архив не читается'), 'текст ошибки — не состав');
    assert.ok(!api.isListing(''), 'пустой ответ — не состав');
    assert.ok(!api.isListing('INSERT INTO `cb` (`id`, `t`, `up`, `ord`, `val`) VALUES (1,1,1,1,\'x\');'),
        'дамп базы — не состав архива файлов');
    assert.ok(!api.isListing('CODE BACKUP x.zip\n...total line missing'), 'без TOTAL — не состав: листинг всегда кончается TOTAL');
});

test('confirmMatches: имя базы дословно', () => {
    assert.ok(api.confirmMatches('MyDb', 'mydb'), 'регистр не важен');
    assert.ok(api.confirmMatches(' mydb ', 'mydb'), 'пробелы по краям не важны');
    assert.ok(!api.confirmMatches('my', 'mydb'), 'частичное имя не проходит');
    assert.ok(!api.confirmMatches('', 'mydb'), 'пустое не проходит');
    assert.ok(!api.confirmMatches('mydb', ''), 'пустое имя базы не проходит');
});

test('previewText: длинный состав обрезается', () =>
    assert.equal(api.previewText('x'.repeat(20001)), 'x'.repeat(20000) + '\n… показано 20000 из 20001 символов'));

test('resultMessage: ok, ошибка сервера и не-JSON', () => {
    const ok = api.resultMessage('{"result":"ok","files":10,"backup":"new5168_20261016_120000.code.zip"}');
    assert.ok(ok.ok, 'ok распознан');
    assert.ok(/10/.test(ok.text) && /backups\/new5168_20261016_120000\.code\.zip/.test(ok.text),
        'в итоге число файлов и имя страховочного архива');
    const err = api.resultMessage('{"error":"чужой путь"}');
    assert.ok(!err.ok && /чужой путь/.test(err.text), 'ошибка сервера показана');
    const raw = api.resultMessage('нет прав');
    assert.ok(!raw.ok && /нет прав/.test(raw.text), 'не-JSON показан как есть');
});
