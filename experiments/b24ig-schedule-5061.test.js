// Расписание коннектора b24ig: sportzania синхронизируется раз в сутки в 6:00 (ideav/crm#5061).
//
// Расписание живёт в двух местах — в `runtime.schedule_hint` конфига базы и в строке crontab на
// сервере. Проверять строку crontab из репозитория нельзя, поэтому тест держит сторону конфига:
// эталон `templates/<проект>/connector/<имя>.default.json` обязан описывать то же расписание,
// что стоит в cron, и это же значение прочитает будущий диспетчер (`b24ig_cron.php`).
//
// Проверка — не сравнение строк, а ПРОГОН выражения по всем 1440 минутам суток: сколько раз и в
// какие минуты оно срабатывает. Так тест видит любую запись одного и того же расписания
// (`0 6 * * *`, `0 06 * * *`, `0 6 * * 0-6`) и ловит подмену периода, а не переформатирование.
//
// Run with: node experiments/b24ig-schedule-5061.test.js

var fs = require('fs');
var path = require('path');

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

// Одно поле cron → множество значений. Понимает `*`, `a`, `a-b`, списки через запятую и шаг `/n`.
function fieldValues(field, min, max) {
    var out = {};
    field.split(',').forEach(function(part) {
        var step = 1, m = /^(.*)\/(\d+)$/.exec(part);
        if (m) { part = m[1]; step = parseInt(m[2], 10); }
        if (!(step >= 1)) throw new Error('шаг: ' + field);
        var lo, hi, r;
        if (part === '*') {
            lo = min; hi = max;
        } else if ((r = /^(\d+)-(\d+)$/.exec(part))) {
            lo = parseInt(r[1], 10); hi = parseInt(r[2], 10);
        } else if (/^\d+$/.test(part)) {
            lo = hi = parseInt(part, 10);
            if (step !== 1) hi = max;
        } else {
            throw new Error('поле cron: ' + field);
        }
        if (lo < min || hi > max || lo > hi) throw new Error('диапазон: ' + field);
        for (var v = lo; v <= hi; v += step) out[v] = true;
    });
    return Object.keys(out).map(Number).sort(function(a, b) { return a - b; });
}

// Минуты суток, в которые выражение срабатывает, для указанной даты. day_of_month и day_of_week в
// cron объединяются по ИЛИ, когда оба заданы; здесь нужны только `*`/`*`, но правило соблюдаем.
function firesOn(expr, date) {
    var f = String(expr).trim().split(/\s+/);
    if (f.length !== 5) throw new Error('в cron-выражении должно быть 5 полей: ' + expr);
    var minutes = fieldValues(f[0], 0, 59), hours = fieldValues(f[1], 0, 23);
    var dom = fieldValues(f[2], 1, 31), mon = fieldValues(f[3], 1, 12), dow = fieldValues(f[4], 0, 7);
    if (mon.indexOf(date.getMonth() + 1) < 0) return [];
    var domStar = f[2].trim() === '*', dowStar = f[4].trim() === '*';
    var w = date.getDay(), inDom = dom.indexOf(date.getDate()) >= 0;
    var inDow = dow.indexOf(w) >= 0 || (w === 0 && dow.indexOf(7) >= 0);
    var dayOk = domStar && dowStar ? true : (domStar ? inDow : (dowStar ? inDom : inDom || inDow));
    if (!dayOk) return [];
    var out = [];
    hours.forEach(function(h) {
        minutes.forEach(function(mi) {
            out.push((h < 10 ? '0' + h : h) + ':' + (mi < 10 ? '0' + mi : mi));
        });
    });
    return out.sort();
}

// Сам матчер: на известных выражениях даёт известный ответ.
assertEqual(firesOn('0 6 * * *', new Date(2026, 9, 3)), ['06:00'], 'матчер: `0 6 * * *` — один раз в 6:00');
assertEqual(firesOn('0 * * * *', new Date(2026, 9, 3)).length, 24, 'матчер: `0 * * * *` — 24 раза в сутки');
assertEqual(firesOn('*/30 6 * * *', new Date(2026, 9, 3)), ['06:00', '06:30'], 'матчер: шаг в минутах');
assertEqual(firesOn('0 6 * * 1', new Date(2026, 9, 3)), [], 'матчер: день недели не подошёл — не срабатывает');
assertEqual(firesOn('0 6 * * 1', new Date(2026, 9, 5)), ['06:00'], 'матчер: день недели подошёл');

// Эталоны конфигов проектов: расписание обязано разбираться, и у каждого дня суток оно одно и то же.
var tplRoot = path.join(ROOT, 'templates');
var configs = [];
fs.readdirSync(tplRoot).forEach(function(proj) {
    var cdir = path.join(tplRoot, proj, 'connector');
    if (!fs.existsSync(cdir) || !fs.statSync(cdir).isDirectory()) return;
    fs.readdirSync(cdir).filter(function(n) { return /\.default\.json$/.test(n); }).forEach(function(n) {
        configs.push({ rel: 'templates/' + proj + '/connector/' + n,
                       cfg: JSON.parse(fs.readFileSync(path.join(cdir, n), 'utf8')) });
    });
});
assertEqual(configs.length > 0, true, 'эталоны конфигов найдены: ' + configs.length);

configs.forEach(function(c) {
    var hint = c.cfg.runtime && c.cfg.runtime.schedule_hint;
    assertEqual(typeof hint, 'string', c.rel + ': runtime.schedule_hint задан');
    var perDay = [];
    for (var d = 0; d < 7; d++) perDay.push(firesOn(hint, new Date(2026, 9, 5 + d)).length);
    assertEqual(perDay.filter(function(n) { return n !== perDay[0]; }), [],
        c.rel + ': расписание одинаково во все дни недели (' + hint + ')');
    assertEqual(c.cfg.runtime.timezone, 'Europe/Moscow',
        c.rel + ': runtime.timezone — Москва, в этом же поясе штампы в логе');
});

// Боевая sportzania: решение Алексея от 03.10.2026 — один прогон в сутки, в 6:00 по Москве.
var spz = configs.filter(function(c) { return /sportzania\.default\.json$/.test(c.rel); })[0];
assertEqual(!!spz, true, 'эталон sportzania на месте');
assertEqual(firesOn(spz.cfg.runtime.schedule_hint, new Date(2026, 9, 3)), ['06:00'],
    'sportzania: прогон один в сутки и ровно в 6:00');

// Период прогонов больше защитного интервала запуска по URL — иначе ручной повтор упёрся бы в него.
assertEqual(spz.cfg.runtime.min_interval_sec < 24 * 3600, true,
    'sportzania: min_interval_sec меньше суток — ручной повтор в тот же день возможен');

console.log('\n' + passed + ' passed' + (process.exitCode ? ', есть FAIL' : ''));
