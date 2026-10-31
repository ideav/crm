// ideav/crm#5308 — импорт из 1С заказов этикетки и базы ножей (Фаза 2, шаг 2, блок 1.2 плана #5301).
//
//   1. предпросмотр: новые / обновлённые / пропущенные дубли / ошибки строк — счётчики сходятся с
//      фикстурой; разбор и план ничего не пишут, запись — только вызовом runBatches («Подтвердить»);
//   2. ключи сверки: заказ = «Заказ клиента» + артикул, нож = «Номер ножа»;
//   3. повторный импорт того же файла: 0 новых, 0 обновлённых, пробег не удвоен (одна запись
//      «начальный остаток» на нож);
//   4. повторный импорт с изменённым пробегом перезаписывает «начальный остаток», движения
//      «вырубка» не трогаются: пробег = новое значение + вырубка;
//   5. решения по данным ножей (#5308): вал «0» → нож без вала + предупреждение; раппорт 1С не
//      сходится с валом → вал по номеру, предупреждение; состояние «нет данных» → пустое;
//   6. пустое значение в файле поле не стирает (вал, заполненный в Интеграме, переживает повторный
//      импорт); состояние ножа пишется только при создании — дальше его ведёт «Ножи и валы»;
//   7. ~2 350 ножей: план быстрый, пакеты не длиннее предела _m_batch (1000 операций), нож и его
//      «начальный остаток» — в одном пакете.
//
// Фикстуры обезличены: номера ножей, заказов, артикулов и клиент вымышлены.
//
// Run with: node experiments/atex-p2-5308-label-import.test.js

process.env.TZ = 'UTC';

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}

var LP = require('../download/atex/js/label-production.js').core;
var LI;
try { LI = require('../download/atex-p2/js/label-import-core.js'); } catch (e) { LI = null; }
assert(LI !== null, 'модуль download/atex-p2/js/label-import-core.js загружается');
if (!LI) { console.log('\n' + passed + '/' + total + ' passed'); return; }

// ── Поддельная база: метаданные, object/JSON_KV, отчёт die_runs и _m_batch ──────────────────

var SCHEMA = [
    ['Нож', ['Дата поставки', 'Ширина этикетки, мм', 'Длина этикетки, мм', 'Ручьёв', 'Этикеток на раппорте',
        'М/э расстояние, мм', 'Между ручьями, мм', 'Ширина кромки, мм', ['Вал', 'Вал'], ['Основа сырья', 'Основа сырья', 'Основа'],
        'Минимальный формат, мм', 'Оптимальный формат, мм', 'Исп. формат, мм', 'Ширина втулки, мм', 'Высота ножа, мкм',
        'Угол заточки', ['Состояние ножа', 'Состояние ножа'], ['Марка ножа', 'Марка ножа']]],
    ['Движение пробега', ['Метры пробега', ['Вид движения пробега', 'Вид движения пробега']]],
    ['Вал', ['Раппорт, мм']],
    ['Основа сырья', []], ['Марка ножа', ['Ресурс, м']], ['Состояние ножа', ['Нож подбирается']],
    ['Вид движения пробега', []],
    ['Заказ', [['Клиент', 'Клиент'], 'Дата создания', ['Статус заказа', 'Статус заказа'], 'Примечания']],
    ['Заказанное количество', [['Вид продукции', 'Вид продукции'], ['Артикул', 'Артикул'], 'Заказ клиента',
        'Ширина этикетки, мм', 'Длина этикетки, мм', 'Этикеток в рулоне', 'Тип ножей', ['Диаметр втулки', 'Диаметр втулки'],
        'Тип намотки', ['Ед.изм.', 'Ед.изм.'], ['Статус позиции', 'Статус позиции'], 'Примечание']],
    ['Клиент', []], ['Артикул', []], ['Вид продукции', []], ['Статус заказа', []], ['Статус позиции', []],
    ['Диаметр втулки', []], ['Ед.изм.', []]
];

function FakeDb() {
    var self = this;
    this.nextId = 5000;
    this.meta = [];
    this.byName = {};
    this.refReq = {};          // reqId → id таблицы-цели
    this.rows = {};            // tableId → [{ id, up, val, reqs }]
    this.writes = 0;
    this.batchSizes = [];
    var tid = 100;
    SCHEMA.forEach(function(t) { self.byName[t[0]] = String(tid); self.rows[String(tid)] = []; tid += 100; });
    SCHEMA.forEach(function(t) {
        var id = self.byName[t[0]];
        var reqs = t[1].map(function(r, i) {
            var rid = String(Number(id) + i + 1);
            if (Array.isArray(r)) {
                self.refReq[rid] = self.byName[r[1]];
                return { id: rid, val: r[0], type: '3', ref: self.byName[r[1]], field_attrs: { alias: r[2] || null } };
            }
            return { id: rid, val: r, type: '3', field_attrs: { alias: null } };
        });
        self.meta.push({ id: id, val: t[0], reqs: reqs });
    });
}
FakeDb.prototype.tid = function(name) { return this.byName[name]; };
FakeDb.prototype.req = function(table, name) {
    var t = this.meta.filter(function(x) { return x.val === table; })[0];
    return t.reqs.filter(function(r) { return r.val === name || (r.field_attrs.alias === name); })[0].id;
};
FakeDb.prototype.find = function(id) {
    var self = this;
    var out = null;
    Object.keys(this.rows).forEach(function(t) { self.rows[t].forEach(function(r) { if (r.id === String(id)) out = r; }); });
    return out;
};
FakeDb.prototype.add = function(table, val, reqs, up) {
    var rec = { id: String(this.nextId++), up: String(up || 1), val: String(val), reqs: {}, table: this.tid(table) };
    var self = this;
    Object.keys(reqs || {}).forEach(function(k) { rec.reqs[k] = String(reqs[k]); });
    this.rows[rec.table].push(rec);
    return rec.id;
};
FakeDb.prototype.label = function(id) { var r = this.find(id); return r ? r.val : ''; };
// object/{t}/?JSON_KV: главные значения в object[], реквизиты в reqs[id]; ссылка — подпись + ref_{req}
FakeDb.prototype.kv = function(table) {
    var self = this;
    var t = this.tid(table);
    var json = { object: [], reqs: {} };
    this.rows[t].forEach(function(r) {
        json.object.push({ id: r.id, up: r.up, val: r.val });
        var out = {};
        Object.keys(r.reqs).forEach(function(k) {
            if (self.refReq[k]) { out[k] = self.label(r.reqs[k]); out['ref_' + k] = self.refReq[k] + ':' + r.reqs[k]; }
            else out[k] = r.reqs[k];
        });
        json.reqs[r.id] = out;
    });
    return json;
};
FakeDb.prototype.records = function(table) { return LI.kvRecords(this.kv(table)); };
FakeDb.prototype.dieRuns = function() {
    var self = this;
    var kindReq = this.req('Движение пробега', 'Вид движения пробега');
    var mReq = this.req('Движение пробега', 'Метры пробега');
    return this.rows[this.tid('Движение пробега')].map(function(r) {
        return { die_id: r.up, run_id: r.id, run_date: r.val, run_kind: self.label(r.reqs[kindReq]), meters: r.reqs[mReq] || '' };
    });
};
FakeDb.prototype.applyFields = function(rec, fields) {
    var self = this;
    Object.keys(fields || {}).forEach(function(k) {
        var rid = k.replace(/^t/, '');
        var v = String(fields[k]);
        if (rid === rec.table) rec.val = v;
        else if (v === '') delete rec.reqs[rid];
        else rec.reqs[rid] = v;
    });
};
// _m_batch: { op, id, up, fields }; ":idN" — запись операции new номер N, ":id" — последней new
FakeDb.prototype.batch = function(ops) {
    var self = this;
    this.batchSizes.push(ops.length);
    var created = {}, last = null, results = [];
    function sub(v) {
        if (typeof v !== 'string') return v;
        var m = /^:id(\d*)$/.exec(v.trim());
        if (!m) return v;
        var n = m[1] === '' ? last : Number(m[1]);
        if (n === null || !(n in created)) throw new Error('ссылка ' + v + ' не на созданную запись');
        return created[n];
    }
    ops.forEach(function(op, n) {
        try {
            var fields = {};
            Object.keys(op.fields || {}).forEach(function(k) { fields[k] = sub(op.fields[k]); });
            if (op.op === 'new') {
                var table = String(sub(op.id));
                var rec = { id: String(self.nextId++), up: String(sub(op.up) || 1), val: '', reqs: {}, table: table };
                self.applyFields(rec, fields);
                self.rows[table].push(rec);
                created[n] = rec.id; last = n;
                self.writes++;
                results.push({ n: n, op: 'new', id: rec.id, type: table, ok: true });
            } else if (op.op === 'set' || op.op === 'save') {
                var r = self.find(sub(op.id));
                if (!r) throw new Error('нет записи ' + op.id);
                self.applyFields(r, fields);
                self.writes++;
                results.push({ n: n, op: op.op, id: r.id, ok: true });
            } else throw new Error('op ' + op.op);
        } catch (e) { results.push({ n: n, op: op.op, ok: false, error: e.message }); }
    });
    return Promise.resolve({ results: results, ok: results.filter(function(r) { return r.ok; }).length, failed: results.filter(function(r) { return !r.ok; }).length });
};

function seedDirectories(db) {
    db.add('Вал', '96', {}); db.add('Вал', '104', {});
    db.add('Основа сырья', 'Бумага', {}); db.add('Основа сырья', 'ПП', {});
    db.add('Марка ножа', 'AI(Standard)', {}); db.add('Марка ножа', 'BLACK TOP 3in1', {});
    ['Рабочий', 'Резерв', 'На экспертизе', 'Списан'].forEach(function(s) { db.add('Состояние ножа', s, {}); });
    db.add('Вид движения пробега', 'вырубка', {}); db.add('Вид движения пробега', 'начальный остаток', {});
    db.add('Вид продукции', 'рулон', {}); db.add('Вид продукции', 'этикетка', {});
    db.add('Статус заказа', 'Новый', {}); db.add('Статус позиции', 'Новая', {});
    db.add('Диаметр втулки', 'Втулка картонная (40мм/3,5мм/1000мм) беленная для этикеток', {});
    db.add('Диаметр втулки', 'Втулка картонная (76мм/5мм/1000мм) беленная для этикеток', {});
    db.add('Диаметр втулки', 'Втулка картонная (76мм/10мм/1000мм)', {});
    db.add('Ед.изм.', 'шт', {});
}

function knifeCtx(db) {
    var res = LI.resolveImportTables(db.meta);
    return LI.knifeContext(res.tables, {
        dies: db.records('Нож'), runs: db.dieRuns(), cylinders: db.records('Вал'), bases: db.records('Основа сырья'),
        brands: db.records('Марка ножа'), states: db.records('Состояние ножа'), runKinds: db.records('Вид движения пробега')
    });
}

function orderCtx(db) {
    var res = LI.resolveImportTables(db.meta);
    return LI.orderContext(res.tables, {
        orders: db.records('Заказ'), positions: db.records('Заказанное количество'), clients: db.records('Клиент'),
        articles: db.records('Артикул'), productKinds: db.records('Вид продукции'), orderStatuses: db.records('Статус заказа'),
        positionStatuses: db.records('Статус позиции'), cores: db.records('Диаметр втулки'), units: db.records('Ед.изм.')
    });
}

function send(db) { return function(ops) { return db.batch(ops); }; }

function mileageOf(db, no) {
    var die = db.records('Нож').filter(function(d) { return d.val === no; })[0];
    var idx = LP.dieMileageIndex(db.dieRuns());
    return die && idx[die.id] ? idx[die.id] : { meters: 0, runs: 0 };
}

function initialCount(db, no) {
    var die = db.records('Нож').filter(function(d) { return d.val === no; })[0];
    return db.dieRuns().filter(function(r) { return die && r.die_id === die.id && r.run_kind === 'начальный остаток'; }).length;
}

// ── Фикстуры: лист «Ножи» и лист «План» (тот же набор колонок, что в выгрузке) ─────────────

var KNIFE_HEAD = ['Дата поставки', 'Номер ножа', 'Размер этикетки', 'Ширина этикетки', 'Длинна этикетки ', 'Нож',
    'ширина, мм', 'Длинна этикетки _1', 'кол-во ручев', 'этикеток на раппорте', 'м/э расстояние, мм', 'между ручьями, мм',
    'ширина кромки, мм', 'Вал', 'раппорт', 'Кол-во рапортов на рол', 'высота ножа, мкм', 'угол заточки', 'сырье ',
    'толщина подложки, мкм', 'Доп', 'Состояние ножа (В работе, списан, резерв)', 'Пробег ', 'Минимальный формат ',
    'Оптимальный формат', 'ширина втулки', 'Исп. Формат', 'Коэф.использования сырья'];

function knifeRow(o) {
    return [o.date == null ? 45000 : o.date, o.no, '', o.w == null ? 85 : o.w, o.l == null ? 38 : o.l, '', '', '',
        o.streams == null ? 3 : o.streams, o.per == null ? 6 : o.per, 2.5, 3, 2, o.val == null ? 96 : o.val,
        o.rep == null ? 304.8 : o.rep, '', 445, o.angle == null ? 80 : o.angle, o.base == null ? 'Бумага' : o.base, '55',
        o.brand == null ? 'AI(Standard)' : o.brand, o.state == null ? 'Рабочий' : o.state, o.mileage == null ? '' : o.mileage,
        265, 270, 76, 268, 0.98];
}

var KNIVES = [
    KNIFE_HEAD,
    knifeRow({ no: '900001' }),
    knifeRow({ no: '900002', val: 0, state: 'Резерв' }),
    knifeRow({ no: '900003', val: 104, rep: 311.2 }),
    knifeRow({ no: '900004', state: 'нет данных', brand: 'нет' }),
    knifeRow({ no: '900005', val: 142, rep: 450.85 }),
    knifeRow({ no: '900001', w: 100 }),                                      // повтор номера в файле
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '#VALUE!', '#VALUE!', '#VALUE!', '#VALUE!', ''],
    knifeRow({ no: '900008', w: 'abc' }),                                    // ошибка строки
    knifeRow({ no: '900009', w: 'D', l: 40, base: 'пп', brand: 'BLACK TOP 3in1' }),
    knifeRow({ no: '', state: 'нет данных' }),                               // нож с данными, но без номера — ошибка
    [45000, '', ' х ', '', '', ' х ', '', '', '', '', '', '', 0, 0, '', '', '', '', '', '', '', '', '', 2, 0, 0, 5, '']  // шаблонная строка
];

var PLAN_HEAD = ['№ заказа', 'Готовность', 'номер ножа', 'Пробег реальный', 'Суммарный пробег ножа'];
function planRows(m1) {
    return [PLAN_HEAD, ['5001', 'Готов', '900001', 7000, m1], ['5002', 'Готов', '900001', 5000, m1],
        ['5003', 'Готов', '900002', 5000, 5000], ['5004', 'готов', '900009', 7000.5, 7000.5]];
}

// ── 1, 2, 5. Предпросмотр ножей на пустой базе ───────────────────────────────────────────
var db = new FakeDb();
seedDirectories(db);

(function() {
    var res = LI.resolveImportTables(db.meta);
    assert(res.ok, 'таблицы и колонки импорта находятся по именам /metadata', res.missing.join('; '));

    var parsed = LI.parseKnifeSheet(KNIVES, planRows(12000));
    assert(parsed.ok, 'лист «Ножи» разобран: найдена строка заголовков', parsed.error || '');
    assert(parsed.items.length === 8 && parsed.empty === 2 && parsed.duplicates.length === 1,
        'строк с ножами 8 (из них две с ошибкой: без номера и кривая ширина), пустых 2 (шаблонные строки с «0» в вале), повтор номера 1',
        'items=' + parsed.items.length + ' empty=' + parsed.empty + ' dup=' + parsed.duplicates.length);
    assert(parsed.duplicates[0] && parsed.duplicates[0].key === '900001' && parsed.duplicates[0].firstRow === 2,
        'повтор номера называет строку первого вхождения');

    var writesBefore = db.writes;
    var plan = LI.planKnives(parsed, knifeCtx(db), { now: 1790000000 });
    assert(db.writes === writesBefore, 'разбор и предпросмотр ничего не пишут');
    var c = plan.counts;
    assert(c.new === 6 && c.update === 0 && c.same === 0 && c.duplicate === 1 && c.error === 2,
        'счётчики предпросмотра: 6 новых, 0 обновлённых, 1 дубль, 2 ошибки', JSON.stringify(c));
    var noNum = plan.rows.filter(function(r) { return r.key === '' && r.status === 'error'; })[0];
    assert(noNum && /номер/i.test(noNum.errors.join(' ')), 'нож с размером, но без номера — ошибка строки «нет номера ножа», а не пустая строка');

    var row = function(no) { return plan.rows.filter(function(r) { return r.key === no && r.status !== 'duplicate'; })[0] || {}; };
    var cylReq = res.tables.die.reqs.cylinder, stateReq = res.tables.die.reqs.state;
    var newOp = function(no) {
        return plan.ops.filter(function(o) { return o.op === 'new' && o.table === res.tables.die.id && o.fields['t' + res.tables.die.id] === no; })[0];
    };
    assert(row('900008').status === 'error' && /ширина этикетки/i.test(row('900008').errors.join(' ')),
        'нечисловая ширина — ошибка строки, нож не записывается');
    assert(!newOp('900008'), 'для строки с ошибкой операции нет');

    assert(newOp('900002') && !('t' + cylReq in newOp('900002').fields) && /вал/i.test(row('900002').warnings.join(' ')),
        'вал «0» → нож без вала и предупреждение (решение 1 #5308)');
    var cyl104 = db.records('Вал').filter(function(v) { return v.val === '104'; })[0].id;
    assert(newOp('900003') && newOp('900003').fields['t' + cylReq] === cyl104 && /раппорт/i.test(row('900003').warnings.join(' ')),
        'раппорт 1С не сходится с валом → вал по номеру, предупреждение (решение 2)');
    assert(newOp('900004') && !('t' + stateReq in newOp('900004').fields),
        'состояние «нет данных» → пустое (решение 3)');
    assert(newOp('900009') && newOp('900009').fields['t' + res.tables.die.reqs.labelWidth] === '40',
        'круглый нож «D»: ширина = длине (диаметр)');

    var cylNew = plan.ops.filter(function(o) { return o.op === 'new' && o.table === res.tables.cylinder.id; });
    assert(cylNew.length === 1 && cylNew[0].fields['t' + res.tables.cylinder.id] === '142' &&
        cylNew[0].fields['t' + res.tables.cylinder.reqs.repeat] === String(LP.cylinderRepeatMm(142)),
        'вала 142 нет в справочнике → создаётся один раз, раппорт = зубья × 3.175');
    assert(newOp('900005') && newOp('900005').fields['t' + cylReq] && newOp('900005').fields['t' + cylReq].ref === cylNew[0].ref,
        'новый нож ссылается на создаваемый вал');

    var runs = plan.ops.filter(function(o) { return o.op === 'new' && o.table === res.tables.dieRun.id; });
    assert(runs.length === 3, 'начальный остаток — у трёх ножей с пробегом в «Плане»', 'runs=' + runs.length);
    assert(row('900001').mileage === 12000 && row('900001').mileageSource === 'План',
        'пробег без колонки «Пробег» берётся из «Суммарного пробега ножа» листа «План»');
})();

// ── 3. Запись и повторный импорт того же файла ────────────────────────────────────────────
var flow = Promise.resolve().then(function() {
    var plan = LI.planKnives(LI.parseKnifeSheet(KNIVES, planRows(12000)), knifeCtx(db), { now: 1790000000 });
    return LI.runBatches(plan.ops, send(db), { batchSize: 1000 }).then(function(r) {
        assert(r.ok && r.failed.length === 0, 'запись прошла без ошибок', JSON.stringify(r.failed).slice(0, 200));
        assert(db.records('Нож').length === 6, 'в базе 6 ножей');
        var again = LI.planKnives(LI.parseKnifeSheet(KNIVES, planRows(12000)), knifeCtx(db), { now: 1790090000 });
        assert(again.counts.new === 0 && again.counts.update === 0 && again.counts.same === 6,
            'повторный импорт того же файла: 0 новых, 0 обновлённых, 6 без изменений', JSON.stringify(again.counts));
        assert(again.ops.length === 0, 'повторный импорт того же файла не даёт операций');
        assert(mileageOf(db, '900001').meters === 12000 && initialCount(db, '900001') === 1,
            'пробег не удвоен: одна запись «начальный остаток», 12 000 м');
        assert(mileageOf(db, '900009').meters === 7001, 'пробег округляется до метра: 7000.5 → 7001');
    });
}).then(function() {
    // ── 4. Пульт записал вырубку, в 1С пробег изменился ──
    var res = LI.resolveImportTables(db.meta);
    var die1 = db.records('Нож').filter(function(d) { return d.val === '900001'; })[0];
    var cut = db.records('Вид движения пробега').filter(function(k) { return k.val === 'вырубка'; })[0];
    var f = {}; f[res.tables.dieRun.reqs.meters] = 300; f[res.tables.dieRun.reqs.kind] = cut.id;
    var cutId = db.add('Движение пробега', '1790100000', f, die1.id);
    var plan = LI.planKnives(LI.parseKnifeSheet(KNIVES, planRows(15000)), knifeCtx(db), { now: 1790200000 });
    assert(plan.counts.update === 1 && plan.counts.new === 0, 'изменённый пробег — одна обновлённая строка', JSON.stringify(plan.counts));
    var setRun = plan.ops.filter(function(o) { return o.op === 'set'; });
    assert(setRun.length === 1 && setRun[0].id !== cutId, 'перезаписывается запись «начальный остаток», вырубка не трогается');
    return LI.runBatches(plan.ops, send(db), {}).then(function() {
        assert(mileageOf(db, '900001').meters === 15300 && initialCount(db, '900001') === 1,
            'пробег = новое значение из 1С + вырубка: 15 000 + 300', String(mileageOf(db, '900001').meters));
        assert(db.find(cutId).reqs[res.tables.dieRun.reqs.meters] === '300', 'движение «вырубка» осталось 300 м');
    });
}).then(function() {
    // ── 6. Ручная правка в Интеграме переживает повторный импорт ──
    var res = LI.resolveImportTables(db.meta);
    var die2 = db.find(db.records('Нож').filter(function(d) { return d.val === '900002'; })[0].id);
    var die1 = db.find(db.records('Нож').filter(function(d) { return d.val === '900001'; })[0].id);
    var cyl96 = db.records('Вал').filter(function(v) { return v.val === '96'; })[0].id;
    var off = db.records('Состояние ножа').filter(function(s) { return s.val === 'Списан'; })[0].id;
    die2.reqs[res.tables.die.reqs.cylinder] = cyl96;
    die1.reqs[res.tables.die.reqs.state] = off;
    var plan = LI.planKnives(LI.parseKnifeSheet(KNIVES, planRows(15000)), knifeCtx(db), { now: 1790300000 });
    assert(plan.counts.update === 0 && plan.ops.length === 0,
        'вал, заполненный вручную при «0» в 1С, и списание ножа повторный импорт не трогает', JSON.stringify(plan.counts));
    // а изменённая геометрия в 1С — обновление с перечнем изменений
    var k = KNIVES.slice(); k[1] = knifeRow({ no: '900001', streams: 4 });
    var p2 = LI.planKnives(LI.parseKnifeSheet(k, planRows(15000)), knifeCtx(db), { now: 1790300000 });
    var r1 = p2.rows.filter(function(r) { return r.key === '900001' && r.status === 'update'; })[0];
    assert(p2.counts.update === 1 && r1 && r1.changes.length === 1 && /ручь/i.test(r1.changes[0].field) &&
        String(r1.changes[0].from) === '3' && String(r1.changes[0].to) === '4',
        'изменение в 1С → обновление с «было → стало»', r1 ? JSON.stringify(r1.changes) : '');
});

// ── 1, 2, 3. Заказы: ключ «Заказ клиента» + артикул ─────────────────────────────────────
var ORDER_HEAD = ['Партнер', 'Заказ Клиента', 'Заказ поставщику', 'Артикул', 'Номенклатура', 'Заказ.Комментарий',
    'Заказ.Дата поступления', 'Тип ножей', 'Короб', 'Единица хранения', 'Заказано количество'];
var CLIENT = 'ООО ТЕСТОВЫЙ КЛИЕНТ';
function orderRows(qty2) {
    return [
        ORDER_HEAD,
        [CLIENT, '', '', '', '', '', '', '', '', '', '644'],
        [CLIENT, '7001', '8001', 'A-01', '85 х 38 5000 шт. П/Гл каучук намотка внутрь вт 76 (П)', '', '22.09.2026', '85 х 38 (80)', '', 'шт', '50'],
        [CLIENT, '7001', '8002', 'A-02', '18 х 18 10000 шт. П/Гл каучук вт 40 (П)', 'срочно', '22.09.2026', '18 х 18 (80)15 ручъев', '', 'шт', String(qty2)],
        [CLIENT, '7002', '8003', 'A-03', 'D х 40 2000 шт. П/П каучук вт 76 (П)', '', '23.09.2026', 'D х 40 (76)', '', 'шт', '10'],
        [CLIENT, '7001', '8001', 'A-01', '85 х 38 5000 шт. П/Гл каучук намотка внутрь вт 76 (П)', '', '22.09.2026', '85 х 38 (80)', '', 'шт', '50'],
        [CLIENT, '7002', '8004', 'A-04', '58 х 60 1000 шт. П/Гл каучук вт 76 (П)', '', '23.09.2026', '58 х 60 (80)', '', 'шт', '0'],
        [CLIENT, '7002', '8005', 'A-05', 'Наклейка круглая', '', '23.09.2026', '', '', 'шт', '5'],
        ['Итого', '', '', '', '', '', '', '', '', '', '644']
    ];
}

flow = flow.then(function() {
    var odb = new FakeDb();
    seedDirectories(odb);
    var res = LI.resolveImportTables(odb.meta);
    var parsed = LI.parseOrderSheet(orderRows(294));
    assert(parsed.ok, 'лист заказов разобран', parsed.error || '');
    var plan = LI.planOrders(parsed, orderCtx(odb), {});
    var c = plan.counts;
    assert(c.ordersNew === 2 && c.new === 3 && c.update === 0 && c.same === 0 && c.duplicate === 1 && c.error === 2,
        'заказы: 2 новых заказа, 3 новые позиции, 1 дубль, 2 ошибки', JSON.stringify(c));
    var errs = plan.rows.filter(function(r) { return r.status === 'error'; }).map(function(r) { return r.errors.join(' '); }).join(' | ');
    assert(/количеств/i.test(errs) && /номенклатур/i.test(errs), 'ошибки называют причину: количество и номенклатура', errs);
    var posNew = plan.ops.filter(function(o) { return o.op === 'new' && o.table === res.tables.position.id; });
    var a02 = posNew.filter(function(o) { return o.fields['t' + res.tables.position.reqs.clientOrder] === '7001' && o.fields['t' + res.tables.position.reqs.labelWidth] === '18'; })[0];
    assert(a02 && a02.fields['t' + res.tables.position.id] === '294' && a02.fields['t' + res.tables.position.reqs.labelsPerRoll] === '10000',
        'позиция: рулонов — главное значение, этикеток в рулоне — из номенклатуры');
    var core40 = odb.records('Диаметр втулки').filter(function(x) { return /40мм/.test(x.val); })[0].id;
    assert(a02 && a02.fields['t' + res.tables.position.reqs.core] === core40, 'втулка «вт 40» → запись справочника «Диаметр втулки» 40 мм');
    return LI.runBatches(plan.ops, send(odb), {}).then(function(r) {
        assert(r.ok, 'заказы записаны', JSON.stringify(r.failed).slice(0, 300));
        assert(odb.records('Заказ').length === 2 && odb.records('Заказанное количество').length === 3 &&
            odb.records('Клиент').length === 1 && odb.records('Артикул').length === 3,
            'в базе 2 заказа, 3 позиции, клиент и 3 артикула');
        var pos = odb.records('Заказанное количество');
        assert(pos.every(function(p) { return odb.find(p.id).up !== '1'; }), 'позиции подчинены заказам');
        var again = LI.planOrders(LI.parseOrderSheet(orderRows(294)), orderCtx(odb), {});
        assert(again.counts.ordersNew === 0 && again.counts.new === 0 && again.counts.update === 0 && again.counts.same === 3,
            'повторный импорт заказов: 0 новых, 0 обновлённых', JSON.stringify(again.counts));
        // ручная правка примечания позиции и изменённое количество в 1С
        var p2 = pos.filter(function(p) { return p.val === '294'; })[0];
        odb.find(p2.id).reqs[res.tables.position.reqs.note] = 'правка менеджера';
        var upd = LI.planOrders(LI.parseOrderSheet(orderRows(300)), orderCtx(odb), {});
        assert(upd.counts.update === 1 && upd.counts.new === 0, 'изменённое количество — одна обновлённая позиция', JSON.stringify(upd.counts));
        return LI.runBatches(upd.ops, send(odb), {}).then(function() {
            var rec = odb.find(p2.id);
            assert(rec.val === '300' && rec.reqs[res.tables.position.reqs.note] === 'правка менеджера',
                'количество обновлено, примечание менеджера не тронуто');
        });
    });
});

// ── 7. ~2 350 ножей: план и пакеты ────────────────────────────────────────────────────────
flow = flow.then(function() {
    var big = [KNIFE_HEAD], plan = [PLAN_HEAD];
    for (var i = 0; i < 2350; i++) {
        var no = String(800000 + i);
        big.push(knifeRow({ no: no, val: [96, 104][i % 2], rep: [304.8, 330.2][i % 2] }));
        plan.push(['6' + i, 'Готов', no, 100, 1000 + i]);
    }
    var bdb = new FakeDb();
    seedDirectories(bdb);
    var t0 = Date.now();
    var p = LI.planKnives(LI.parseKnifeSheet(big, plan), knifeCtx(bdb), { now: 1790000000 });
    var ms = Date.now() - t0;
    assert(p.counts.new === 2350 && ms < 3000, '2 350 ножей: разбор и план быстрее 3 с', ms + ' мс');
    return LI.runBatches(p.ops, send(bdb), { batchSize: 1000 }).then(function(r) {
        assert(r.ok && bdb.batchSizes.every(function(n) { return n <= 1000; }) && bdb.batchSizes.length >= 5,
            'пакеты не длиннее 1000 операций', bdb.batchSizes.join(','));
        assert(bdb.records('Нож').length === 2350 && bdb.dieRuns().length === 2350,
            'все ножи и их «начальный остаток» записаны (нож и движение — в одном пакете)');
        var again = LI.planKnives(LI.parseKnifeSheet(big, plan), knifeCtx(bdb), { now: 1790000000 });
        assert(again.counts.new === 0 && again.counts.update === 0, 'повторный прогон 2 350 ножей: 0 новых, 0 обновлённых', JSON.stringify(again.counts));
    });
});

flow.catch(function(e) { assert(false, 'тест упал: ' + (e && e.stack || e)); }).then(function() {
    console.log('\n' + passed + '/' + total + ' passed');
});
