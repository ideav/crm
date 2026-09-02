// #4852 — ограничение доступа к рабочим местам ролей operator/остальные.
//
// ТЗ (issue #4852):
//   1. роль operator работает только в packer/sleeve-cutter/slitter; попав в любое
//      другое рабочее место, она уводится в пульт, настроенный для ЭТОГО планшета;
//      настройки нет — экран конфигурации с кодом устройства;
//   2. увод выполняет pad-home.js из main.html — теперь с ЛЮБОЙ страницы базы, не
//      только с корня; цикл «страница → редирект → страница» погашен предикатом
//      stayOnTarget (свой пульт → остаёмся, ничего не перезагружаем);
//   3. выбор упаковочного места в packer.html убран — место задаёт планшет.
//
// Проверяем чистую часть: кого уводим, когда остаёмся на месте, и место упаковщика.
//
// Run with: node experiments/atex-pad-4852.test.js

process.env.TZ = 'UTC';

var home = require('../download/atex/js/pad-home.js');
var packer = require('../download/atex/js/packer.js');

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}

// ── 1) кого уводим: роль оператора — с любой страницы, остальные роли не трогаем ──
assertEqual(home.shouldRedirect({ action: '', roleId: '1621', roles: ['1621'] }), true,
    '#4852 оператор на корне — уводим');
assertEqual(home.shouldRedirect({ action: 'object', roleId: '1621', roles: ['1621'] }), true,
    '#4852 оператор во внутреннем рабочем месте — уводим');
assertEqual(home.shouldRedirect({ action: 'orders', roleId: '1621', roles: ['1621'] }), true,
    '#4852 оператор в списке заказов — уводим');
assertEqual(home.shouldRedirect({ action: 'orders', roleId: '2', roles: ['1621'] }), false,
    '#4852 другая роль ходит по базе как раньше');

// ── 2) «уже на месте»: свой пульт — остаёмся без перезагрузки (гашение цикла) ──
assertEqual(home.stayOnTarget({ ok: true, action: 'packer' }, 'packer'), true,
    '#4852 открыт пульт планшета (packer) — остаёмся');
assertEqual(home.stayOnTarget({ ok: true, action: 'slitter' }, 'packer'), false,
    '#4852 открыт чужой/другой пульт — редиректим');
assertEqual(home.stayOnTarget({ ok: false, action: '', reason: 'none' }, 'packer'), false,
    '#4852 настройки нет — не «на месте»: покажем экран конфигурации');

// ── 3) упаковочное место упаковщика — только из планшета (#4852) ──
var core = packer.core;
var Packer = packer.Controller;
global.window = { atexPad: { token: 'abcdef0123', config: { place: { id: '669275', label: '2' } } } };
var withPad = Object.create(Packer.prototype);
withPad.place = null;
withPad.restorePlace();
assertEqual(withPad.place, { id: '669275', label: '2' }, '#4852 место берётся из настройки планшета');
assertEqual(withPad.hasPlace(), true, '#4852 место есть — список позиций показывается');

global.window = { atexPad: { token: 'abcdef0123', config: { place: null } } };
var withoutPad = Object.create(Packer.prototype);
withoutPad.place = null;
withoutPad.restorePlace();
assertEqual(withoutPad.hasPlace(), false, '#4852 настройки нет — места нет (экран конфигурации с кодом)');

// core.itemsPath фильтрует отчёт по НОМЕРУ места (label) — место из планшета подставляется
assertEqual(core.itemsPath({ id: '669275', label: 'пук-275' }).indexOf(encodeURIComponent('пук-275')) >= 0, true,
    '#4852 отчёт позиций фильтруется номером места из планшета');

console.log('\n' + passed + '/' + total + ' passed');
if (process.exitCode) process.exit(process.exitCode);
