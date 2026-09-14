// Инварианты секции «Задачи cron» в шаблонах dir_admin (блок crontab-dir-admin в ядре).
//
// Шаблоны едут на сервер сами (update.php), index.php — отдельно, поэтому секция, которой
// нужны данные нового ядра, обязана жить в собственном подблоке (правило issue #4624), иначе
// на старом ядре пропадёт вся страница. Поведение движка меряет
// experiments/crontab-dir-admin.test.php (php-cli, движок берётся из index.php).
//
// Run with: node experiments/dir-admin-crontab.test.js

var fs = require('fs');
var path = require('path');

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

['templates/dir_admin.html', 'templates/upsound/dir_admin.html'].forEach(function (rel) {
    var text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

    var section = text.match(/<!-- Begin:&Crontab -->([\s\S]*?)<!-- End:&Crontab -->/);
    assert(!!section, rel + ': секция задач cron обёрнута в подблок &Crontab');
    if (!section) return;

    assert(text.indexOf('{CRONTASKS}') === -1, rel + ': голой точки вставки {CRONTASKS} нет');
    assert(section[1].indexOf('{_parent_.CRONTASKS}') !== -1, rel + ': счётчик задач берётся у родителя внутри подблока');
    assert(/<!-- Begin:&Cronlist -->[\s\S]*\{SCHEDULE\}[\s\S]*\{COMMAND\}[\s\S]*\{NOTE\}[\s\S]*<!-- End:&Cronlist -->/.test(section[1]),
        rel + ': строки задач — вложенный подблок &Cronlist с расписанием, командой и пояснением');
    assert(!/<form/i.test(section[1]) && !/<button/i.test(section[1]), rel + ': секция только для просмотра — без форм и кнопок');

    // секция стоит внутри &Dir_Admin: вне блока страницы подблок не разберётся
    var crontabAt = text.indexOf('<!-- Begin:&Crontab -->');
    var dirAdminEnd = text.indexOf('<!-- End:&Dir_Admin -->');
    assert(crontabAt !== -1 && dirAdminEnd !== -1 && crontabAt < dirAdminEnd, rel + ': секция внутри блока &Dir_Admin');

    var sessionsEnd = text.indexOf('<!-- End:&Sessions -->');
    assert(sessionsEnd !== -1 && sessionsEnd < crontabAt, rel + ': секция не вложена в &Sessions, а идёт после неё');
});

process.on('exit', function () {
    console.log('\n' + passed + '/' + total + ' passed');
});
