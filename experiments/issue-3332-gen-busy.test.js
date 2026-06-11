// Regression test for ideav/crm#3332.
//
// Когда нажимаешь «Сгенерировать резки», generateCuts сначала догружает ходовые
// ширины отчётом preferable_widths (AJAX). До фикса на это время кнопка
// оставалась активной, а крутилка не показывалась — клик «глохнул» без реакции.
// Фикс: setGenBusy(true) перед Promise.all(preloads) и setGenBusy(false) после.
//
// Проверяем:
//   1) во время запросов preferable_widths кнопка деактивирована и крутилка видна;
//   2) после завершения запросов кнопка снова активна и крутилка скрыта.
//
// Run with: node experiments/issue-3332-gen-busy.test.js

process.env.TZ = 'UTC';

// Минимальный «window» с заглушкой модуля раскладки (проверяется в начале
// generateCuts). document не нужен: ветка «нет раскладок» уходит в notify (стаб)
// до построения DOM.
global.window = { AtexCutLayout: { layout: { planLayouts: function() { return { layouts: [], skipped: [] }; } } } };

var api = require('../download/atex/js/production-planning.js');
var Controller = api.Controller;

var passed = 0, failed = 0;
function assert(cond, name) {
    if (cond) { passed++; console.log('PASS — ' + name); }
    else { failed++; console.log('FAIL — ' + name); process.exitCode = 1; }
}

// Управляемый Promise, чтобы «заморозить» фазу запросов preferable_widths.
var resolvePreload;
var preloadPromise = new Promise(function(resolve) { resolvePreload = resolve; });

// Фейковые кнопка/крутилка — setGenBusy трогает только .disabled и .style.display.
var genBtn = { disabled: false };
var genSpinner = { style: { display: 'none' } };

var ctrl = Object.create(Controller.prototype);
ctrl.busy = false;
ctrl.genBtn = genBtn;
ctrl.genSpinner = genSpinner;
ctrl.meta = { cut: {}, supply: {}, finishedBatch: {} };
ctrl.preferredByMaterial = {};
ctrl.jumboWidthByMaterial = {};       // нет ширины джамбо → ветка «нет раскладок»
ctrl.filter = { date: '' };
ctrl.supplies = [];                   // ничего не обеспечено
ctrl.genPositions = [
    { id: '1', materialId: 'M1', width: 100, qty: 5, approved: true,
      windDir: '', windLength: '', dueKey: Infinity, length: 1000 }
];

// Стаб AJAX-загрузки ходовых ширин: возвращает «зависший» Promise.
var loadCalls = 0;
ctrl.loadPreferredWidths = function() { loadCalls++; return preloadPromise; };
// Стаб уведомления (без DOM).
var notified = [];
ctrl.notify = function(msg, kind) { notified.push({ msg: msg, kind: kind }); };

assert(genBtn.disabled === false, 'до клика кнопка активна');
assert(genSpinner.style.display === 'none', 'до клика крутилка скрыта');

ctrl.generateCuts(null);

// Синхронно после клика: запрос ушёл, кнопка деактивирована, крутилка видна.
assert(loadCalls === 1, 'loadPreferredWidths вызван (идёт запрос preferable_widths)');
assert(genBtn.disabled === true, 'во время запросов кнопка деактивирована');
assert(genSpinner.style.display === '', 'во время запросов крутилка видна');

// Завершаем запросы — кнопка должна снова стать активной, крутилка скрыться.
resolvePreload([]);
preloadPromise.then(function() {}).then(function() {
    assert(genBtn.disabled === false, 'после запросов кнопка снова активна');
    assert(genSpinner.style.display === 'none', 'после запросов крутилка скрыта');
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    if (failed) process.exitCode = 1;
});
