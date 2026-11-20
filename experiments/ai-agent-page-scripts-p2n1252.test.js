/*
 * ideav/python2node#1252: ИИ-агент не видел код страницы — не мог объяснить, как планировщик
 * считает наладку и старт, хотя обработчики кнопок лежат в доступном ему скрипте.
 * https://github.com/ideav/python2node/issues/1252
 *
 * Чат кладёт в контекст экрана context.scripts — пути скриптов страницы из статики базы
 * (/download/<база>/…js) без ?версии; сервис агента скачивает их и даёт агенту читать.
 *   1) collectPageScripts — только свой хост и /download/<база>/…js, без дублей и .., до 10;
 *   2) getScreenContext на рабочем месте несёт scripts; на главной контекста нет вовсе;
 *   3) серверная чистка (aiAgentScreenContext, index.php) — experiments/ai-agent-page-scripts-p2n1252.test.php.
 *
 * Run with: node experiments/ai-agent-page-scripts-p2n1252.test.js
 */
'use strict';

const { spawnSync } = require('child_process');
const pathMod = require('path');

var path = require.resolve('../js/ai-agent-chat.js');
var failures = 0;
function expect(cond, name){ if(cond){ console.log('PASS: ' + name); } else { console.log('FAIL: ' + name); failures++; } }

function load(win, scripts){
    global.window = Object.assign({ location: { host: 'ideav.ru', pathname: '/ateh/production-planning', search: '' } }, win);
    global.document = {
        readyState: 'loading', scripts: (scripts || []).map(function(s){ return { src: s }; }),
        getElementById: function(){ return null; }, querySelector: function(){ return null; },
        addEventListener: function(){}, createElement: function(){ return {}; }
    };
    delete require.cache[path];
    return require(path);
}

var SCRIPTS = [
    'https://ideav.ru/js/ai-agent-chat.js?v=1252',
    'https://ideav.ru/download/ateh/js/ref-search.js?260101.1',
    'https://ideav.ru/download/ateh/js/production-planning.js?260101.168',
    'https://ideav.ru/download/ateh/js/production-planning.js?260101.169',
    'https://evil.example/download/ateh/js/x.js',
    'https://ideav.ru/download/ateh/js/../../other/y.js',
    'https://ideav.ru/download/ateh/css/a.css',
    'https://cdn.jsdelivr.net/npm/chart.js',
    ''
];

// 1) чистая функция
var A = load({}, []);
var got = A.collectPageScripts({ scripts: SCRIPTS.map(function(s){ return { src: s }; }) }, { host: 'ideav.ru' });
expect(got.join('|') === '/download/ateh/js/ref-search.js|/download/ateh/js/production-planning.js',
    '#1252: только скрипты статики базы своего хоста, без ?версии и дублей; .., css и чужие хосты отброшены');
var many = [];
for(var i = 0; i < 30; i++) many.push({ src: 'https://ideav.ru/download/ateh/js/m' + i + '.js' });
expect(A.collectPageScripts({ scripts: many }, { host: 'ideav.ru' }).length === 10, '#1252: не больше 10 скриптов');
expect(A.collectPageScripts(null, null).length === 0, '#1252: нет document — пустой список');

// 2) контекст рабочего места
var W = load({ action: 'production-planning', db: 'ateh' }, SCRIPTS);
var ctx = W.getScreenContext();
expect(ctx && ctx.page === 'workplace' && Array.isArray(ctx.scripts) && ctx.scripts.length === 2
    && ctx.scripts[1] === '/download/ateh/js/production-planning.js',
    '#1252: контекст рабочего места несёт scripts страницы');
W.contextDismissed = true;
expect(W.getScreenContext() === null, '#1252: пользователь снял контекст — скриптов тоже нет');
delete global.window; delete global.document;

// 3) серверная чистка — php-мерка
const phpTest = pathMod.join(__dirname, 'ai-agent-page-scripts-p2n1252.test.php');
const probe = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (probe.error) {
    console.log('SKIP — php не найден в PATH, чистка scripts в index.php не проверена: ' + phpTest);
} else {
    const run = spawnSync('php', [phpTest], { encoding: 'utf8' });
    process.stdout.write(run.stdout || '');
    process.stderr.write(run.stderr || '');
    expect(run.status === 0, '#1252: ai-agent-page-scripts-p2n1252.test.php');
}

if(failures){ console.log('\nFAILED: ' + failures); process.exitCode = 1; }
else console.log('\nALL TESTS PASSED');
