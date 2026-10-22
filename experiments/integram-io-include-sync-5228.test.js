// #5228: integram.io/include/ — набор файлов, выкладываемых в include/ хоста integram.io.
// funcs.php и import_reconcile.php у хоста общие с ideav.ru: правка в include/ без переноса
// в integram.io/include/ (и наоборот) молча развела бы хосты. connection.php и .htaccess —
// свои у хоста, в репо лежат шаблонами без секретов.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

for (const f of ['funcs.php', 'import_reconcile.php']) {
    assert.strictEqual(read('integram.io/include/' + f), read('include/' + f),
        'integram.io/include/' + f + ' разошёлся с include/' + f + ' — перенеси правку в оба файла');
    console.log('PASS — integram.io/include/' + f + ' = include/' + f);
}

for (const f of ['connection.php', '.htaccess']) {
    assert.ok(fs.existsSync(path.join(root, 'integram.io', 'include', f)), 'нет шаблона integram.io/include/' + f);
    console.log('PASS — есть шаблон integram.io/include/' + f);
}
