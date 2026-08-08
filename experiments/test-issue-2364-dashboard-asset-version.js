'use strict';

// Ассеты дэшборда обязаны подключаться с версией, иначе браузер отдаёт закэшированный
// старый файл. Механизм версии — посуффиксный счётчик `?{_global_.version}.N` в шаблоне:
// шаблон выкладывается вместе с ассетом (`update.conf`), а ядровый VERSION из index.php
// деплоится отдельно и на бой не уезжает (issue #2364, форма счётчика — issue #4661,
// правило — docs/WORKSPACE_DEVELOPMENT_GUIDE.md §2).

const fs = require('fs');
const assert = require('assert');

const template = fs.readFileSync('templates/dash.html', 'utf8');

assert(
    /<link\b[^>]*href="\/css\/dash\.css\?\{_global_\.version\}\.\d+"[^>]*>/m.test(template),
    'dashboard stylesheet must include {_global_.version}.N so deployed browsers refresh dash.css'
);

assert(
    /<script\b[^>]*src="\/js\/dash\.js\?\{_global_\.version\}\.\d+"[^>]*><\/script>/m.test(template),
    'dashboard script must include {_global_.version}.N so deployed browsers refresh dash.js close handlers'
);

assert(
    /<script\b[^>]*src="\/js\/dash-optimize\.js\?\{_global_\.version\}\.\d+"[^>]*><\/script>/m.test(template),
    'dash-optimize.js must include {_global_.version}.N — иначе «Оптимизация» останется на старом коде'
);

console.log('issue-2364 dashboard assets are versioned: ok');
