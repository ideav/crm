/*
 * Issue #5176: ссылка правки строки дэшборда не должна содержать id таблицы.
 * База, развёрнутая из шаблона, получает свои id (в finmo таблица «Строка» — 509,
 * а в коде было зашито 997 → «Invalid Term id 997»). Ссылка строится по имени
 * таблицы: /{db}/table/Строка?F_U={панель}&F_I={строка} — table/ и object/
 * принимают имя типа так же, как id.
 *
 * Тест вырезает itemTpl из js/dash.js и вычисляет его с заданным db.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'dash.js'), 'utf8');
const m = source.match(/, itemTpl\s*=\s*([\s\S]*?)\n\s*, cellTpl/);
assert.ok(m, 'itemTpl не найден в js/dash.js');

const db = 'finmo';
const itemTpl = eval(m[1]);
const html = itemTpl.replace(/:panel-id:/g, '4977').replace(/:id:/g, '5058');
const href = (html.match(/<a href="([^"]+)"/) || [])[1];

assert.ok(href, 'в строке нет ссылки правки');
assert.ok(!/\/table\/\d+/.test(href), 'ссылка правки строки содержит числовой id таблицы: ' + href);
assert.strictEqual(decodeURIComponent(href), '/finmo/table/Строка?F_U=4977&F_I=5058');

console.log('OK: ссылка правки строки строится по имени таблицы —', decodeURIComponent(href));
