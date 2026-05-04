'use strict';

const fs = require('fs');
const assert = require('assert');

const template = fs.readFileSync('templates/dash.html', 'utf8');

assert(
    /<link\b[^>]*href="\/css\/dash\.css\?\{_global_\.version\}"[^>]*>/m.test(template),
    'dashboard stylesheet must include {_global_.version} so deployed browsers refresh dash.css'
);

assert(
    /<script\b[^>]*src="\/js\/dash\.js\?\{_global_\.version\}"[^>]*><\/script>/m.test(template),
    'dashboard script must include {_global_.version} so deployed browsers refresh dash.js close handlers'
);

console.log('issue-2364 dashboard assets are versioned: ok');
