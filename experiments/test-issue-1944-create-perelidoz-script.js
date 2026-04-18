const assert = require('assert');
const fs = require('fs');
const path = require('path');

const scriptPath = path.join(__dirname, '..', 'docs', 'create_perelidoz.ps1');
const script = fs.readFileSync(scriptPath, 'utf8');

assert(script.includes('[string]$BaseUrl = "https://integram.io"'), 'default API host should match MCP docs');
assert(script.includes('$script:Tables["User"]'), 'script should reuse the existing system User table');
assert(!script.includes('"Users"'), 'script should not create a duplicate plural Users table');
assert(!script.includes('"Projects"'), 'script should use singular Russian table names, not plural English names');

assert(script.includes('$response.id'), 'script must store _d_req response id values');
assert(script.includes('$table.Requisites[$columnKey]'), 'records must use requisite IDs for non-primary fields');
assert(script.includes('$formData["t$fieldId"]'), 'record payload keys must be t{tableId} or t{requisiteId}');
assert(!script.includes('$formData["t$i"]'), 'record payload must not use positional t1/t2/t3 keys');

assert(script.includes('_d_alias/$requisiteId'), 'reference requisites should get user-facing aliases');
assert(script.includes('_m_set/$ObjectId'), 'seed data references should be assigned with _m_set');
assert(script.includes('Проект + Дата оценки'), 'Health Score must use a composite first column, not a non-unique date');

console.log('PASS issue-1944 create_perelidoz.ps1 static API contract checks');
