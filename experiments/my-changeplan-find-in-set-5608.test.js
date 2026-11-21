// rules: none (defect #5608)
// Условие «тариф из списка допустимых» в колонке 1302 запроса my/1278 user_changePlan.
// Условие из скрипта правки исполняется на эмуляции MySQL FIND_IN_SET (позиция с 1, 0 — нет в списке).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { OLD, NEW } = require('../docs/scripts/fix_5608_changeplan_find_in_set.js');

function findInSet(needle, list) {
  const i = String(list).split(',').indexOf(String(needle));
  return i + 1;
}

// Подставляет _request_.plan и исполняет сравнение FIND_IN_SET('x','a,b,c')<op><n>.
function evalClause(clause, plan) {
  const m = clause.match(/^FIND_IN_SET\('_request_\.plan','([^']*)'\)(>=|>)(\d+)$/);
  assert.ok(m, 'условие не разобрано: ' + clause);
  const pos = findInSet(plan, m[1]);
  return m[2] === '>=' ? pos >= +m[3] : pos > +m[3];
}

test('тарифы 1146, 1147, 1148 проходят', () => {
  for (const id of ['1146', '1147', '1148']) assert.strictEqual(evalClause(NEW, id), true, id);
});

test('id не из списка отклоняется', () => {
  for (const id of ['1141', '18', '999999', '', '0']) assert.strictEqual(evalClause(NEW, id), false, id);
});

test('прежнее условие пропускало любой id (дефект #5608)', () => {
  assert.strictEqual(evalClause(OLD, '999999'), true);
});
