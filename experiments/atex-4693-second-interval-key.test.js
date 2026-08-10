// Ключ второго перерыва — SECOND_INTERVAL (ideav/crm#4693).
//
// В таблице «Настройка» боевой базы ateh лежат три записи о коротких перерывах:
// FIRST_INTERVAL 10:00, SECOND_INTERVAL 15:00, INTERVAL_DURATION_MN 10. Написание
// ключа — SECOND_INTERVAL; удвоенной «C» нет ни в базе, ни в ТЗ, ни в коде.
//
// Тест держит две стороны правила: движок и Гант читают SECOND_INTERVAL, а опечатка
// SECCOND_INTERVAL не признаётся ни настройкой, ни строкой исходников — иначе она
// вернётся первой же копипастой и снова расползётся по коду и документам.
//
// Run with: node experiments/atex-4693-second-interval-key.test.js

process.env.TZ = 'UTC';

var fs = require('fs');
var path = require('path');
var planning = require('../download/atex/js/production-planning.js').planning;

var ROOT = path.join(__dirname, '..');
var passed = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) {
        passed++;
    } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}
function assertTrue(cond, name) { assertEqual(!!cond, true, name); }

// ── Настройка читается по правильному ключу ──
var LUNCH = { LUNCH_START: '12:20', LUNCH_DURATION: '40' };
function breaksWith(extra) {
    var cfg = { FIRST_INTERVAL: '10:00', INTERVAL_DURATION_MN: 10 };
    Object.keys(LUNCH).forEach(function(k) { cfg[k] = LUNCH[k]; });
    Object.keys(extra).forEach(function(k) { cfg[k] = extra[k]; });
    return planning.intraDayBreaks(cfg);
}

var good = breaksWith({ SECOND_INTERVAL: '15:00' });
assertEqual(good.map(function(b) { return [b.startMin, b.kind]; }),
    [[600, 'break'], [740, 'lunch'], [900, 'break']],
    'SECOND_INTERVAL 15:00 → второй перерыв в 900-й минуте (боевая настройка ateh)');

var typo = breaksWith({ SECCOND_INTERVAL: '15:00' });
assertEqual(typo.map(function(b) { return [b.startMin, b.kind]; }),
    [[600, 'break'], [740, 'lunch']],
    'опечатка SECCOND_INTERVAL настройкой не считается — второго перерыва нет');

// ── Опечатки нет в исходниках, тестах и документах ──
// Правило живёт не только в поведении: одна оставшаяся строка «SECCOND» — готовый образец
// для копипасты, и ключ снова разъедется по коду, ТЗ и фикстурам (так он и появился).
var SCAN = [
    ['download/atex/js', /\.js$/],
    ['experiments', /\.(js|md)$/],
    ['docs', /\.md$/]
];
var hits = [];
function walk(dir, re) {
    var abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return;
    fs.readdirSync(abs, { withFileTypes: true }).forEach(function(e) {
        var rel = dir + '/' + e.name;
        if (e.isDirectory()) { walk(rel, re); return; }
        if (!re.test(e.name)) return;
        if (e.name === path.basename(__filename)) return;   // сам сторож опечатку называет по делу
        fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n').forEach(function(line, i) {
            if (line.indexOf('SECCOND') !== -1) hits.push(rel + ':' + (i + 1));
        });
    });
}
SCAN.forEach(function(s) { walk(s[0], s[1]); });
assertTrue(hits.length === 0,
    'строки «SECCOND» не осталось ни в коде, ни в тестах, ни в документах'
        + (hits.length ? '\n      ' + hits.join('\n      ') : ''));

// Бандл — сборка из модулей: правка модуля без пересборки оставила бы опечатку в том файле,
// который реально грузит рабочее место.
var bundle = fs.readFileSync(path.join(ROOT, 'download/atex/js/production-planning.js'), 'utf8');
assertTrue(bundle.indexOf('SECOND_INTERVAL') !== -1 && bundle.indexOf('SECCOND') === -1,
    'бандл production-planning.js пересобран из модулей (SECOND_INTERVAL есть, опечатки нет)');

console.log('\n' + passed + ' проверок прошли');
