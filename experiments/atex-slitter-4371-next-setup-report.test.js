// #4371 — «оставить конфигурацию» (#3609/#3737/#4370) читает отчёт next_cut_setup, и на базе,
// где этого запроса нет, подсказка молча не появляется.
//
// Запросов ДВА, и путать их нельзя: 643132 `next_cut_setup` — сортировка task_start ↑ («ближайшая
// резка ПОСЛЕ границы»), 93371 `prev_cut_setup` — task_start ↓ («последняя ДО границы»). Одним
// запросом оба сценария не закрыть. Сверено на ateh1 (список запросов типа 22 + определения).
//
// Незаметной поломка была потому, что getJson не смотрел на статус ответа и отдавал тело ошибки
// ВЫЗЫВАЮЩЕМУ КАК ДАННЫЕ: на базе без этого запроса сервер отвечает 400
// `[{"error":"Запрос не найден"}]`, nextDaySetupConfig не находил в такой «строке» task_start,
// возвращал null, computeSeamless тихо выходил, а его .catch глотал бы и настоящее исключение.
// Тесты #3737/#4370 подменяют getJson и до имени отчёта не добираются — поэтому и молчали.
//
// Проверяем: имя отчёта в запросе, падение getJson на отказ сервера, отсутствие подсказки без
// шума в консоли и то, что при живом отчёте всё работает по-прежнему.
//
// Run with: node experiments/atex-slitter-4371-next-setup-report.test.js

process.env.TZ = 'Europe/Moscow';

global.document = {
    createElement: function() { return { style: {}, dataset: {}, childNodes: [],
        classList: { add: function() {}, remove: function() {}, contains: function() { return false; },
                     toggle: function() {} },
        appendChild: function() {}, setAttribute: function() {}, addEventListener: function() {} }; },
    getElementById: function() { return null; },
    addEventListener: function() {}
};
global.window = { db: 'ateh' };

var api = require('../download/atex/js/slitter.js');
var Controller = api.Controller;
var core = api.core;

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var D24 = '2026-07-24', D25 = '2026-07-25';
function stamp(dayISO, hhmm) { return String(Math.floor(new Date(dayISO + 'T' + hhmm + ':00+03:00').getTime() / 1000)); }
function cut(id, dayISO, hhmm) {
    return { id: id, slitterId: 'm1', planDate: stamp(dayISO, hhmm), status: 'Ожидает',
             materialId: '5', material: 'ПЭТ', winding: 'OUT', runLength: 450, plannedRuns: 2 };
}

// Строки отчёта в том виде, в каком их отдаёт ateh (JSON_KV, по строке на «Партию ГП»).
function reportRows() {
    return [
        { task_id: '11', task_start: stamp(D24, '14:00'), width: '145', material_id: '5', batch_ord: '1' },
        { task_id: '20', task_start: stamp(D25, '08:00'), width: '145', material_id: '7', batch_ord: '1' }
    ];
}

function makeInst() {
    var inst = Object.create(Controller.prototype);
    inst.db = 'ateh';
    inst.selectedSlitterId = 'm1';
    inst.selectedDate = D24;
    inst.slitters = [{ id: 'm1', label: 'Станок 1' }];
    inst.cuts = [cut('10', D24, '08:00'), cut('11', D24, '14:00'), cut('20', D25, '08:00')];
    inst.currentStrips = [{ width: 145 }];
    inst.currentCut = inst.cuts[1];      // последняя резка своего дня → подсказка считается
    inst.currentCutId = '11';
    inst.seamlessNotice = null;
    return inst;
}

// ── 1. Запрос уходит по имени, которое РЕАЛЬНО есть в базе ──────────────────────────────────
(function () {
    var inst = makeInst();
    var urls = [];
    inst.getJson = function(path) { urls.push(path); return Promise.resolve(reportRows()); };

    inst.computeSeamless().then(function() {
        assert(urls.length === 1 && urls[0].indexOf('report/next_cut_setup?') === 0,
            '#4371: конфигурация следующей смены читается из report/next_cut_setup (запрос 643132)');
        assert(urls[0].indexOf('report/prev_cut_setup') === -1,
            '#4371: не 93371 prev_cut_setup — у него обратная сортировка (последняя резка ДО границы)');
        assert(urls[0].indexOf('FR_slitter_id=m1') !== -1,
            '#4371: станок передаётся явно — у slitter_id отчёта свой умолчательный станок');
        assert(urls[0].indexOf('FR_task_start=' + encodeURIComponent('>' + core.dayStartTimestamp(stamp(D24, '00:00')))) !== -1,
            '#4371: нижняя граница — полночь дня текущего задания (перекрывает [NOW] из отчёта)');
        assert(inst.seamlessNotice && inst.seamlessNotice.nextCut.id === '20' &&
               inst.seamlessNotice.sameKnives === true && inst.seamlessNotice.sameMaterial === false,
            '#3737: живой отчёт → подсказка про совпавшие ножи первой резки 25.07');
        return runErrorCase();
    }).then(function() {
        console.log('\n' + passed + '/' + total + ' assertions passed');
        if (passed !== total) process.exitCode = 1;
    });
})();

// ── 2. Отказ сервера — это ошибка, а не «данные» ─────────────────────────────────────────────
function runErrorCase() {
    // Ровно то, что отвечал ateh на report/next_cut_setup: 400 и тело [{error: …}].
    var deniedBody = '[{"error":"Запрос не найден"}]';
    var inst = makeInst();
    inst.url = function(path) { return '/ateh/' + path; };
    global.fetch = function() {
        return Promise.resolve({ ok: false, status: 400, text: function() { return Promise.resolve(deniedBody); } });
    };

    return inst.getJson('report/нет-такого?JSON_KV').then(function(data) {
        assert(false, '#4371: getJson обязан упасть на отказе, а вернул ' + JSON.stringify(data));
    }, function(err) {
        assert(/Запрос не найден/.test(err.message),
            '#4371: getJson роняет промис с сообщением сервера, а не выдаёт тело ошибки за строки');
        assert(/нет-такого/.test(err.message),
            '#4371: в сообщении видно, какой запрос отказал');
    }).then(function() {
        // 200 с валидным телом по-прежнему проходит насквозь
        global.fetch = function() {
            return Promise.resolve({ ok: true, status: 200,
                text: function() { return Promise.resolve(JSON.stringify(reportRows())); } });
        };
        return inst.getJson('report/next_cut_setup?JSON_KV').then(function(rows) {
            assert(Array.isArray(rows) && rows.length === 2, '#4371: успешный ответ отдаётся как прежде');
        });
    }).then(function() {
        // Отказ отчёта гасит подсказку, но не молча: пишем в консоль (тост тут был бы шумом —
        // computeSeamless зовётся на каждое открытие резки).
        global.fetch = function() {
            return Promise.resolve({ ok: false, status: 400, text: function() { return Promise.resolve(deniedBody); } });
        };
        var quiet = makeInst();
        quiet.url = function(path) { return '/ateh/' + path; };
        var logged = [];
        var origErr = console.error;
        console.error = function() { logged.push(Array.prototype.join.call(arguments, ' ')); };
        return quiet.computeSeamless().then(function() {
            console.error = origErr;
            assert(quiet.seamlessNotice === null, '#4371: отчёт отказал → подсказки нет (не выдумываем)');
            assert(logged.length === 1 && /Запрос не найден/.test(logged[0]),
                '#4371: отказ отчёта попадает в консоль, а не тонет в пустом catch');
        }, function(e) { console.error = origErr; throw e; });
    });
}
