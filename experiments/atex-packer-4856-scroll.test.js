// #4856 — у списка упаковщика есть собственный скролл.
//
// ТЗ (issue #4852… нет, #4856): «В рабочем месте упаковщика сделать скролл списка —
// сейчас его нет». Список позиций длинный, шапка с упаковочным местом уезжала вместе
// со страницей. Приём — как у пульта слиттера (#4783): пульт занимает высоту рабочей
// области целиком (root: height 100%, overflow hidden), прокручивается только
// .atex-pk-main. Проверяем СТИЛИ статически: правила есть и висят на правильных классах.
//
// Run with: node experiments/atex-packer-4856-scroll.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'download', 'atex', 'css', 'packer.css'), 'utf8');

let passed = 0, failed = 0;
function check(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else { failed++; process.exitCode = 1; }
}

// Корень: занимает всю высоту, сам не скроллится (#4783-приём).
const rootBlock = (css.match(/\.atex-pk \{[^}]*\}/) || [])[0] || '';
check(/height:\s*100%/.test(rootBlock), '#4856: .atex-pk { height: 100% } — пульт на всю рабочую область');
check(/overflow:\s*hidden/.test(rootBlock), '#4856: .atex-pk { overflow: hidden } — страница целиком не скроллится');
check(/flex-direction:\s*column/.test(rootBlock), '#4856: .atex-pk — колонка (шапка + список)');

// Шапка: не сжимается.
const headBlock = (css.match(/\.atex-pk-head \{[^}]*\}/) || [])[0] || '';
check(/flex:\s*0 0 auto/.test(headBlock), '#4856: .atex-pk-head { flex: 0 0 auto } — шапка всегда на виду');

// Список: единственный прокручиваемый блок.
const mainBlock = (css.match(/\.atex-pk-main \{[^}]*\}/) || [])[0] || '';
check(/flex:\s*1 1 auto/.test(mainBlock), '#4856: .atex-pk-main { flex: 1 1 auto } — занимает остаток высоты');
check(/min-height:\s*0/.test(mainBlock), '#4856: .atex-pk-main { min-height: 0 } — иначе flex растягивает по содержимому');
check(/overflow-y:\s*auto/.test(mainBlock), '#4856: .atex-pk-main { overflow-y: auto } — скролл списка');

console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);
