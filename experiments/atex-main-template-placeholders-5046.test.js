// #5046 — templates/atex/main.html не должен содержать плейсхолдеров без значения.
//
// Шаблонизатор index.php (Make_tree / Parse_block) режет шаблон на блоки по
// `<!-- Begin: X -->…<!-- End: X -->` и в каждом блоке подставляет `{имя}`. Встретив
// плейсхолдер, которому нет значения, он обрывает подстановку, а порцию блока, где
// остался хоть один плейсхолдер, ВЫБРАСЫВАЕТ (index.php, Parse_block: «Accept only
// fully filled portions»). Для корневого блока это пустая страница у всех.
// Плейсхолдер — это в том числе текст в JS-комментарии: шаблонизатор комментариев
// не различает.
//
// Тест повторяет правило шаблонизатора: делит main.html на блоки так же, как Make_tree,
// и в корневом блоке ищет плейсхолдеры той же регуляркой, что Parse_block. В корне
// значения есть только у `_global_.*` (переменные ядра) и `_block_.*` (вложенные блоки).
//
// Run with: node experiments/atex-main-template-placeholders-5046.test.js

var fs = require('fs');
var path = require('path');

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name
        + (ok ? '' : ' (ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual) + ')'));
    if (ok) passed++; else process.exitCode = 1;
}

// Make_tree: текст режется по «<!-- », кусок с begin:/end:/file: — граница блока.
// Возвращает содержимое блоков; вложенный блок в родителе заменён на {_block_.имя}.
function makeTree(text) {
    var blocks = { '': '' };
    var stack = [''];
    var patt = /^(begin:|end:|file:)[ \t]*(&?[A-ZА-Я0-9_ ]+)[ \t]* -->([\s\S]*)$/i;
    text.split('<!-- ').forEach(function(part, i) {
        var cur = stack[stack.length - 1];
        var m = patt.exec(part);
        if (!m) { blocks[cur] += (i ? '<!-- ' : '') + part; return; }
        var kind = m[1].toLowerCase(), name = m[2].toLowerCase();
        if (kind === 'begin:') {
            var child = cur + '.' + name;
            stack.push(child);
            blocks[child] = m[3];
        } else if (kind === 'end:') {
            stack.pop();
            blocks[stack[stack.length - 1]] += '{_block_.' + cur + '}' + m[3];
        } else {
            blocks[cur] += '{_block_.' + cur + '.' + name + '}' + m[3];
        }
    });
    return blocks;
}

// Parse_block: insertion point — та же регулярка, что в index.php.
function placeholders(content) {
    var out = [], re = /\{([A-ZА-Я0-9.&_ \-]+?)}/gi, m;
    while ((m = re.exec(content))) out.push(m[1]);
    return out;
}

var file = path.join(__dirname, '..', 'templates', 'atex', 'main.html');
var blocks = makeTree(fs.readFileSync(file, 'utf8'));
var orphans = placeholders(blocks['']).filter(function(p) {
    var low = p.toLowerCase();
    return low.indexOf('_global_.') !== 0 && low.indexOf('_block_.') !== 0;
});
assertEqual(orphans, [], '#5046 в корне main.html нет плейсхолдеров без значения (иначе страница пустая)');

// Блок MyPads (отчёт «Планшеты» пользователя) — на месте и с одним полем pads.
var myPads = Object.keys(blocks).filter(function(k) { return /\.mypads$/.test(k); });
assertEqual(myPads.length, 1, '#5046 блок MyPads в main.html есть');
assertEqual(myPads.length ? placeholders(blocks[myPads[0]]) : [], ['pads'],
    '#5046 блок MyPads подставляет только поле pads');

console.log('\n' + passed + '/' + total + ' passed');
