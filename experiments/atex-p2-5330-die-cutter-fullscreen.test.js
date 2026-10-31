// ideav/crm#5330 — пульт высечки полноэкранный, как пульты Фазы 1 (#4783 п.2): левого меню на
// его странице нет.
//
// Проверяется поведение head-скрипта templates/atex/main.html: блок исполняется с разными
// `action`, и смотрим, добавил ли он в head стиль, прячущий меню (так же, как
// experiments/atex-sc-4798-fullscreen.test.js).
//
// Run with: node experiments/atex-p2-5330-die-cutter-fullscreen.test.js

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

function runFullscreenHeadScript(action) {
    var tpl = fs.readFileSync(path.join(__dirname, '..', 'templates/atex/main.html'), 'utf8');
    var head = tpl.slice(0, tpl.indexOf('</head>'));
    var block = head.split(/<script>/).filter(function(s) { return s.indexOf('FULLSCREEN_ACTIONS') !== -1; })[0];
    if (!block) return null;
    var appended = [];
    vm.runInNewContext(block.split('</script>')[0], {
        action: action,
        document: {
            createElement: function() { return { id: '', textContent: '' }; },
            head: { appendChild: function(node) { appended.push(node); } }
        }
    });
    return appended;
}

var dc = runFullscreenHeadScript('die-cutter');
assert(!!dc && dc.length === 1 && dc[0].id === 'fullscreen-workspace-style'
    && dc[0].textContent.indexOf('.app-sidebar') !== -1 && dc[0].textContent.indexOf('display:none!important') !== -1,
    'на пульте высечки head прячет левое меню');
var other = runFullscreenHeadScript('label-orders');
assert(!!other && other.length === 0, 'обычному рабочему месту Фазы 2 меню не трогаем');

console.log('\n' + passed + '/' + total + ' passed');
