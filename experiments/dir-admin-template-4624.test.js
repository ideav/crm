// Tests for ideav/crm#4624 — точка вставки, которой старое ядро не знает, не должна стоять
// в общем блоке шаблона.
//
// Шаблоны едут на сервер сами (update.php по update.conf), index.php — отдельно и вручную,
// поэтому шаблон какое-то время работает со СТАРЫМ ядром. Движок обрывает разбор блока на
// первой точке вставки, для которой ядро не дало значения, а подблоки разбираются последними
// (index.php, Parse_block) — одна незнакомая ядру переменная уносит с собой списки файлов и
// каталогов, и dir_admin, которым чинят сервер, перестаёт открываться.
//
// Здесь сторожатся инварианты ТЕКСТА обоих шаблонов; поведение самого движка меряет
// experiments/dir-admin-template-4624.test.php (php:8.2-cli, движок берётся из index.php).
//
// Run with: node experiments/dir-admin-template-4624.test.js

var fs = require('fs');
var path = require('path');

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

var files = ['templates/dir_admin.html', 'templates/upsound/dir_admin.html'];

files.forEach(function (rel) {
    var text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

    // 1. Секция сессий (#4590) целиком лежит в собственном подблоке.
    var section = text.match(/<!-- Begin:&Sessions -->([\s\S]*?)<!-- End:&Sessions -->/);
    assert(!!section, rel + ': секция сессий обёрнута в подблок &Sessions');
    if (!section) return;

    // 2. Счётчик сессий берётся у родителя и стоит ВНУТРИ подблока: в общем блоке он
    //    оборвал бы разбор на старом ядре (issue #4624).
    assert(text.indexOf('{SESSIONS}') === -1, rel + ': голой точки вставки {SESSIONS} нет');
    assert(section[1].indexOf('{_parent_.SESSIONS}') !== -1,
        rel + ': счётчик сессий берётся у родителя внутри подблока');

    // 3. Список сессий — вложенный подблок: пустой список прячет таблицу, а не ломает страницу.
    assert(/<!-- Begin:&Processlist -->[\s\S]*<!-- End:&Processlist -->/.test(section[1]),
        rel + ': строки сессий — вложенный подблок &Processlist');

    // 4. Точка вставки в комментарии — та же мина: движок читает {ЧТО-УГОДНО} где угодно.
    var withPoints = [];
    (text.match(/<!--[\s\S]*?-->/g) || []).forEach(function (c) {
        var body = c.slice(4, -3);
        if (/^\s*(begin|end|file)\s*:/i.test(body)) return;   // маркер блока, не пояснение
        if (/\{[A-Za-zА-Яа-я0-9_ -]/.test(body)) withPoints.push(body.trim().slice(0, 40));
    });
    assertEqual(withPoints, [], rel + ': ни одного комментария с фигурной скобкой');
});

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
