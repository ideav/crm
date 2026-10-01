// #5046 — в «Планшет-кандидате» всегда ОДНА строка.
//
// Дубли на боевой ateh (три строки с одним кодом) появились так: список кандидатов
// читается `object/{id}/?JSON_OBJ`, а этот ответ строится разбором шаблона main.html
// (index.php: Parse_block("&main") перед выдачей API). Пока шаблон был сломан
// плейсхолдером, разбор обрывался до блоков со строками, и сервер отдавал не список, а
// пустоту — сторож принимал её за пустую таблицу и создавал новую строку.
//
// Правило: ответ — не список строк → не пишем ничего (ошибка на экране); строк больше
// одной → лишние удаляются, ПОТОМ первая переписывается (поле уникальное: дубль нового
// кода в лишних строках не дал бы сохранить); пусто → создаётся одна строка.
//
// Проверяем ПОВЕДЕНИЕ: какие запросы и в каком порядке ушли на сервер из publishCandidate.
//
// Run with: node experiments/atex-pad-5046-candidate-single-row.test.js

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name
        + (ok ? '' : ' (ожидалось ' + JSON.stringify(expected) + ', получено ' + JSON.stringify(actual) + ')'));
    if (ok) passed++; else process.exitCode = 1;
}

global.window = undefined;
var guard = require('../download/atex/js/pad-guard.js');

var CAND_TABLE = { id: '804338', up: '0', type: '3', val: 'Планшет-кандидат', unique: '1', granted: 'WRITE', reqs: [] };
var METADATA = [CAND_TABLE];
var TOKEN = 'aaaa0000bbbb1111cccc2222dddd3333';
var OLD = '99998888777766665555444433332222';
var CTX = { db: 'ateh', xsrf: 'xsrf-token' };

// Сервер: GET списка отдаёт `listing` как есть (строкой JSON), POST пишутся в журнал.
function serve(listing) {
    var log = [];
    global.fetch = function(url, init) {
        var path = String(url).replace('/ateh/', '');
        if (init && init.method === 'POST') {
            log.push(path.replace(/\?.*$/, ''));
            return Promise.resolve({ ok: true, text: function() { return Promise.resolve('{"id":"1","obj":"1"}'); } });
        }
        return Promise.resolve({ ok: true, text: function() { return Promise.resolve(JSON.stringify(listing)); } });
    };
    return log;
}

function publish(listing) {
    var log = serve(listing);
    return guard.publishCandidate(CTX, METADATA, TOKEN).then(
        function(res) { return { log: log, saved: res.saved, error: '' }; },
        function(err) { return { log: log, saved: false, error: String(err && err.message || err) }; });
}

function row(id, token) { return { i: Number(id), u: 1, o: 1, r: [token] }; }

var scenario = Promise.resolve();

scenario = scenario.then(function() { return publish(null); }).then(function(res) {
    assertEqual(res.log, [], '#5046 сервер вместо списка вернул null (сломанный шаблон) — ничего не пишем');
    assertEqual(res.saved, false, '#5046 null — код не считается переданным');
});

scenario = scenario.then(function() { return publish({ '&main.a': {} }); }).then(function(res) {
    assertEqual(res.log, [], '#5046 вместо списка — структура страницы — ничего не пишем');
});

scenario = scenario.then(function() { return publish([]); }).then(function(res) {
    assertEqual(res.log, ['_m_new/804338'], '#5046 таблица пуста — создаётся одна строка');
});

scenario = scenario.then(function() { return publish([row(822373, OLD)]); }).then(function(res) {
    assertEqual(res.log, ['_m_save/822373'], '#5046 одна строка с чужим кодом — переписывается, без удалений');
});

scenario = scenario.then(function() { return publish([row(822373, TOKEN)]); }).then(function(res) {
    assertEqual(res.log, [], '#5046 одна строка с этим кодом — писать нечего');
});

scenario = scenario.then(function() {
    return publish([row(822373, OLD), row(905602, TOKEN), row(905603, TOKEN)]);
}).then(function(res) {
    assertEqual(res.log, ['_m_del/905602', '_m_del/905603', '_m_save/822373'],
        '#5046 строк три — лишние удаляются ДО перезаписи первой (поле уникальное)');
    assertEqual(res.saved, true, '#5046 после чистки код передан');
});

scenario = scenario.then(function() {
    return publish([row(822373, TOKEN), row(905602, TOKEN)]);
}).then(function(res) {
    assertEqual(res.log, ['_m_del/905602'], '#5046 первая строка уже с этим кодом — удаляется только дубль');
});

scenario = scenario.then(function() {
    return publish({ object: [row(822373, OLD), row(905602, OLD)] });
}).then(function(res) {
    assertEqual(res.log, ['_m_del/905602', '_m_save/822373'], '#5046 обёртка { object: [...] } разбирается так же');
});

scenario.then(function() {
    console.log('\n' + passed + '/' + total + ' passed');
    if (process.exitCode) process.exit(process.exitCode);
}).catch(function(err) {
    console.log('FAIL — сценарий упал: ' + (err && err.message ? err.message : err));
    process.exitCode = 1;
});
