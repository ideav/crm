// Мерка к issue #5660: заявка портала «Решения» уходит и в Telegram-чат заявок (поля /telegram-notify.php).
// rules: none (defect #5660)
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '..', 'download', 'solutions', 'app.js'));

assert.strictEqual(typeof C.buildNotify, 'function', 'buildNotify: поля уведомления о заявке');

// решение с адресом: название и ссылка на страницу, комментарий отдельным абзацем
const a = C.buildNotify({ name: ' Иван ', company: 'ООО Р', contact: 'i@x.ru', comment: ' нужна НСИ ' },
  { id: 578, title: 'MDM', slug: 'mdm' }, 'https://ideav.ru', 'solutions');
assert.deepStrictEqual(a, { source: 'solutions', name: 'Иван', company: 'ООО Р', contact: 'i@x.ru',
  task: 'Решение: MDM\nСтраница: https://ideav.ru/solutions/mdm\n\nнужна НСИ' });

// решение без адреса — ссылка каталога; без решения и комментария — одна строка
assert.strictEqual(C.buildNotify({ name: 'a', contact: 'b' }, { id: 7, title: 'X', slug: '' }, 'https://ideav.ru', 'solutions').task,
  'Решение: X\nСтраница: https://ideav.ru/solutions/catalog#/s/7');
const b = C.buildNotify({ name: 'a', contact: 'b' }, null, 'https://ideav.ru', 'solutions');
assert.strictEqual(b.task, 'Решение: не выбрано'); assert.strictEqual(b.company, '');

console.log('solutions-5660: ok');
