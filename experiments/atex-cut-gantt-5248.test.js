// #5248: Гант резок запрашивал /metadata 4 раза за одну загрузку — каждый загрузчик
// (право WRITE на «Задание в производство», «Вид сырья», «Фактическая ширина резки», «Отпуск»)
// делал свой GET. Метаданные одни на всю загрузку: один запрос, ответ получают все потребители.
//
// Run with: node experiments/atex-cut-gantt-5248.test.js

process.env.TZ = 'UTC';

var api = require('../download/atex/js/cut-gantt.js');
var Controller = api.Controller;

var passed = 0;
function assert(cond, name) {
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}

var METADATA = [
    { id: '500', val: 'Отпуск', reqs: [{ id: '501', val: 'Окончание' }, { id: '502', val: 'Примечания' }] },
    { id: '600', val: 'Вид сырья', reqs: [{ id: '601', val: 'Ширина, мм' }, { id: '602', val: 'Номинальная ширина' }] },
    { id: '700', val: 'Фактическая ширина резки', reqs: [{ id: '701', val: 'Ширина в заказе' }, { id: '702', val: 'Код' }] },
    { id: '800', val: 'Задание в производство', granted: 'READ', reqs: [] }
];

function makeInst() {
    var inst = Object.create(Controller.prototype);
    inst.db = 'ateh';
    inst.slitterTable = '1070';
    inst.cutTableWrite = true;   // дефолт конструктора
    inst.calls = [];
    inst.getJson = function(path) {
        inst.calls.push(path);
        if (path === 'metadata') {
            // Асинхронный ответ: все загрузчики стартуют раньше, чем метаданные пришли.
            return new Promise(function(resolve) { setTimeout(function() { resolve(METADATA); }, 5); });
        }
        if (path.indexOf('object/1070/') === 0) return Promise.resolve([{ i: '10', r: ['SL-01'] }]);
        if (path.indexOf('object/500/') === 0) return Promise.resolve([{ i: '900', r: ['1782000000', '1782003600', 'ТО'] }]);
        if (path.indexOf('object/600/') === 0) return Promise.resolve([{ i: '61', r: ['Плёнка', '1000', '1050'] }]);
        return Promise.resolve([]);
    };
    return inst;
}

function count(inst, path) {
    return inst.calls.filter(function(p) { return p === path; }).length;
}

var inst = makeInst();
inst.collect().then(function() {
    assert(count(inst, 'metadata') === 1, 'одна загрузка Ганта → ровно один GET metadata (было 4)');
    assert(inst.cutTableWrite === false, 'право WRITE прочитано из общего ответа (READ → ссылки скрыты)');
    assert(inst.nominalWidthByMaterial['61'] === 1050, '«Вид сырья» найден в общем ответе (номинал 1050)');
    assert(inst.calls.indexOf('object/700/?JSON_OBJ&LIMIT=0,5000') >= 0, '«Фактическая ширина резки» найдена в общем ответе');
    var dt = inst.downtimesBySlitter['10'] || [];
    assert(dt.length === 1 && dt[0].notes === 'ТО', '«Отпуск» найден в общем ответе (окно простоя станка)');
}).then(function() {
    // Ошибка метаданных: каждый потребитель деградирует сам, повторных запросов нет.
    var bad = makeInst();
    var base = bad.getJson;
    bad.getJson = function(path) {
        if (path === 'metadata') { bad.calls.push(path); return Promise.reject(new Error('500')); }
        return base(path);
    };
    return bad.collect().then(function() {
        assert(count(bad, 'metadata') === 1, 'ошибка metadata — тоже один запрос, без повторов');
        assert(bad.cutTableWrite === true, 'ошибка metadata → ссылки остаются (как #4847)');
        assert(Object.keys(bad.nominalWidthByMaterial).length === 0, 'ошибка metadata → пустые номиналы');
    });
}).then(function() {
    console.log('\n' + passed + ' passed');
}).catch(function(err) {
    console.log('FAIL — исключение: ' + (err && err.stack || err));
    process.exitCode = 1;
});
