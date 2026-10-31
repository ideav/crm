// ideav/crm#5324 — рабочее место «Заказы этикетки» (менеджер по продажам), шаг 4 Фазы 2.
//
//   1. автоподбор ножа под позицию: точное совпадение размера этикетки, основа сырья,
//      состояние, в котором нож подбирается, ручьёв ножа кратно ручьям заказа (и равно
//      числу ручьёв из «Типа ножей» 1С, если оно указано); из подходящих — наименьший пробег;
//      ручной выбор перекрывает автоподбор; нет ножа — позиция с отметкой «нет ножа» и
//      причиной, какое условие не выполнено;
//   2. минимальная партия — этикеток с одного мастер-рулона через подобранный нож:
//      floor(длина МР / раппорт) × этикеток на раппорте × ручьёв ножа;
//   3. подтверждение ИТС нужно, если ширина или длина этикетки вне [мин, макс] из настроек;
//   4. позиция без ножа или с неподтверждённым ИТС в планирование не идёт; меньше
//      минимальной партии — предупреждение, не блокировка;
//   5. поля позиции объявлены в схеме и названы в конфигурации модуля.
//
// Run with: node experiments/atex-p2-5324-label-orders.test.js

process.env.TZ = 'UTC';
var fs = require('fs');
var path = require('path');

var passed = 0, total = 0;
function assert(cond, name, extra) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name + (extra ? '  ' + extra : ''));
    if (cond) passed++; else process.exitCode = 1;
}
function fn(name) { return typeof LP[name] === 'function'; }

var LP = require('../download/atex/js/label-production.js').core;

// Ножи теста: 148×210 — два бумажных рабочих с разным пробегом, один ПП, один списанный;
// 18×18 — 15 ручьёв; 85×38 — 3 ручья.
function die(id, w, l, base, streams, selectable, meters, extra) {
    var d = { id: id, no: 'N' + id, width: w, length: l, base: base, streams: streams, selectable: selectable, meters: meters };
    Object.keys(extra || {}).forEach(function(k) { d[k] = extra[k]; });
    return d;
}
var DIES = [
    die('1', 148, 210, 'Бумага', 2, true, 120000),
    die('2', 148, 210, 'Бумага', 2, true, 40000),
    die('3', 148, 210, 'ПП', 2, true, 0),
    die('4', 148, 210, 'Бумага', 2, false, 0),
    die('5', 18, 18, 'Бумага', 15, true, 5000),
    die('6', 85, 38, 'Бумага', 3, true, 1000),
    die('7', 102, 120.5, 'Бумага', 3, true, 7000)
];

// ── 1. Подбор ножа ───────────────────────────────────────────────────────────
(function() {
    assert(fn('pickDie'), 'pickDie экспортирована');
    if (!fn('pickDie')) return;
    var r = LP.pickDie({ width: 148, length: 210, base: 'Бумага', orderStreams: 1 }, DIES);
    assert(r.ok && r.die.id === '2', '148×210 бумага: из двух рабочих — с меньшим пробегом', JSON.stringify(r.die && r.die.id));
    assert(r.ok && r.candidates.map(function(d) { return d.id; }).join(',') === '2,1',
        'кандидаты — только подходящие, по пробегу', JSON.stringify(r.candidates && r.candidates.map(function(d) { return d.id; })));

    var pp = LP.pickDie({ width: 148, length: 210, base: '1000297:ПП', orderStreams: 1 }, DIES);
    assert(pp.ok && pp.die.id === '3', 'основа сравнивается по подписи, «id:подпись» тоже');

    var none = LP.pickDie({ width: 101, length: 101, base: 'ПП', orderStreams: 1 }, DIES);
    assert(!none.ok && none.die == null && /101/.test(none.reason), '101×101: ножа нет, причина называет размер', none.reason);

    var rot = LP.pickDie({ width: 210, length: 148, base: 'Бумага', orderStreams: 1 }, DIES);
    assert(!rot.ok, 'размер — точное совпадение ширины и длины, поворот не подбирается');

    var frac = LP.pickDie({ width: '102', length: '120,5', base: 'Бумага', orderStreams: 1 }, DIES);
    assert(frac.ok && frac.die.id === '7', 'дробный размер «120,5» совпадает с 120.5');

    var base = LP.pickDie({ width: 85, length: 38, base: 'ПП', orderStreams: 1 }, DIES);
    assert(!base.ok && /основ/i.test(base.reason), '85×38 есть только на бумаге — причина про основу', base.reason);

    var state = LP.pickDie({ width: 148, length: 210, base: 'Бумага', orderStreams: 1 },
        DIES.filter(function(d) { return d.id === '4'; }));
    assert(!state.ok && /состоян/i.test(state.reason), 'нож в неподбираемом состоянии не выбирается — причина про состояние', state.reason);

    var mult = LP.pickDie({ width: 85, length: 38, base: 'Бумага', orderStreams: 3 }, DIES);
    assert(mult.ok && mult.die.id === '6', 'ручьёв ножа 3 кратно ручьям заказа 3');
    var notMult = LP.pickDie({ width: 85, length: 38, base: 'Бумага', orderStreams: 2 }, DIES);
    assert(!notMult.ok && /руч/i.test(notMult.reason), 'ручьёв ножа 3 не кратно 2 — нет ножа, причина про ручьи', notMult.reason);
    var dflt = LP.pickDie({ width: 85, length: 38, base: 'Бумага' }, DIES);
    assert(dflt.ok, 'ручьёв в заказе не указано — считается 1');

    var k15 = LP.pickDie({ width: 18, length: 18, base: 'Бумага', orderStreams: 1, knifeStreams: 15 }, DIES);
    assert(k15.ok && k15.die.id === '5', '«18 х 18 (80)15 ручъев»: нож с 15 ручьями подходит');
    var k12 = LP.pickDie({ width: 18, length: 18, base: 'Бумага', orderStreams: 1, knifeStreams: 12 }, DIES);
    assert(!k12.ok, 'число ручьёв из «Типа ножей» не совпало — ножа нет');

    var noBase = LP.pickDie({ width: 148, length: 210, base: '', orderStreams: 1 }, DIES);
    assert(!noBase.ok && /основ/i.test(noBase.reason), 'у сырья позиции нет основы — не угадываем, причина названа', noBase.reason);

    var noSize = LP.pickDie({ width: '', length: 210, base: 'Бумага' }, DIES);
    assert(!noSize.ok && /размер/i.test(noSize.reason), 'размер не задан — ножа нет, причина названа', noSize.reason);
})();

// ── 1б. Ручной выбор перекрывает автоподбор ──────────────────────────────────
(function() {
    assert(fn('positionDie'), 'positionDie экспортирована');
    if (!fn('positionDie')) return;
    var pos = { width: 148, length: 210, base: 'Бумага', orderStreams: 1 };
    var auto = LP.positionDie(pos, DIES);
    assert(auto.ok && auto.pick === LP.DIE_PICK.FOUND && auto.die.id === '2', 'без ручного выбора — автоподбор, отметка «подобран»');
    var man = LP.positionDie(Object.assign({ pick: LP.DIE_PICK.MANUAL, dieId: '1' }, pos), DIES);
    assert(man.ok && man.pick === LP.DIE_PICK.MANUAL && man.die.id === '1', 'ручной выбор держится, хотя у ножа 1 пробег больше');
    var gone = LP.positionDie(Object.assign({ pick: LP.DIE_PICK.MANUAL, dieId: '99' }, pos), DIES);
    assert(!gone.ok && gone.pick === LP.DIE_PICK.NONE && /99/.test(gone.reason), 'выбранного вручную ножа нет в базе — «нет ножа», не подмена другим', gone.reason);
    var none = LP.positionDie({ width: 101, length: 101, base: 'ПП' }, DIES);
    assert(!none.ok && none.pick === LP.DIE_PICK.NONE, 'не найден — отметка «нет ножа»');
})();

// ── 2. Минимальная партия ────────────────────────────────────────────────────
(function() {
    assert(fn('labelMinBatch'), 'labelMinBatch экспортирована');
    if (!fn('labelMinBatch')) return;
    // вал 96 → раппорт 304.8 мм; 2000 м / 0.3048 = 6561.68 → 6561 раппорт × 3 × 2 = 39366
    var r = LP.labelMinBatch({ repeatMm: 304.8, labelsPerRepeat: 3, streams: 2 }, 2000);
    assert(r.ok && r.repeats === 6561 && r.labels === 39366, 'один МР 2000 м через нож: 6561 раппорт × 3 × 2 = 39366', JSON.stringify(r));
    var m1500 = LP.labelMinBatch({ repeatMm: 304.8, labelsPerRepeat: 3, streams: 2 }, 1500);
    assert(m1500.ok && m1500.labels === Math.floor(1500000 / 304.8) * 6, 'длина МР — параметр (настройка)');
    var bad = LP.labelMinBatch({ repeatMm: '', labelsPerRepeat: 3, streams: 2 }, 2000);
    assert(!bad.ok && /раппорт/i.test(bad.error), 'нет раппорта — ошибка, а не ноль', bad.error);
    var noDie = LP.labelMinBatch(null, 2000);
    assert(!noDie.ok, 'нет ножа — минимальная партия не считается');
})();

// ── 3. Подтверждение ИТС по размеру ──────────────────────────────────────────
(function() {
    assert(fn('labelItsCheck'), 'labelItsCheck экспортирована');
    if (!fn('labelItsCheck')) return;
    assert(LP.labelItsCheck(148, 210, 20, 250).needed === false, '148×210 в [20, 250] — ИТС не нужен');
    var small = LP.labelItsCheck(18, 18, 20, 250);
    assert(small.needed === true && /18/.test(small.reason), '18×18 меньше 20 — нужно подтверждение ИТС', small.reason);
    assert(LP.labelItsCheck(100, 300, 20, 250).needed === true, 'длина 300 больше 250 — нужно');
    assert(LP.labelItsCheck(20, 250, 20, 250).needed === false, 'границы включительно');
    assert(LP.labelItsCheck(18, 18, 20, '').needed === true, 'задан только минимум — проверяется минимум');
    var off = LP.labelItsCheck(18, 18, '', '');
    assert(off.needed === false && off.configured === false, 'пороги не заданы — не требуется, но configured=false (рабочее место скажет)');
})();

// ── 2б. Потребность позиции ──────────────────────────────────────────────────
(function() {
    assert(fn('labelPositionDemand'), 'labelPositionDemand экспортирована');
    if (!fn('labelPositionDemand')) return;
    // 120 рул × 5000 = 600 000 этикеток; нож 3 на раппорте × 2 ручья = 6 за раппорт → 100 000
    // раппортов × 304.8 мм = 30 480 м → 16 МР по 2000 м; коэфф. 85×2/180 = 0.944
    var d = LP.labelPositionDemand({ rolls: 120, labelsPerRoll: 5000, width: 85 },
        { repeatMm: 304.8, labelsPerRepeat: 3, streams: 2, usedFormat: 180 }, 2000);
    assert(d.ok && d.labels === 600000 && d.repeats === 100000, 'этикеток и раппортов', JSON.stringify(d));
    assert(d.ok && Math.abs(d.meters - 30480) < 0.01 && d.masterRolls === 16, 'метраж вырубки и мастер-рулоны 2 км');
    assert(d.ok && d.useRatio === 0.944, 'коэффициент использования сырья = ширина × ручьи / исп. формат', String(d.useRatio));
})();

// ── 4. Блокировки и предупреждения позиции ───────────────────────────────────
(function() {
    assert(fn('labelPositionFlags'), 'labelPositionFlags экспортирована');
    if (!fn('labelPositionFlags')) return;
    var ok = LP.labelPositionFlags({ pick: LP.DIE_PICK.FOUND, itsNeeded: false, labels: 50000, minBatch: 39366 });
    assert(ok.ready === true && ok.blocks.length === 0 && ok.warnings.length === 0, 'нож есть, ИТС не нужен, партия больше минимума — готова');
    var noDie = LP.labelPositionFlags({ pick: LP.DIE_PICK.NONE, labels: 50000 });
    assert(noDie.ready === false && noDie.blocks.indexOf('нет ножа') !== -1, 'нет ножа — блокировка');
    var its = LP.labelPositionFlags({ pick: LP.DIE_PICK.FOUND, itsNeeded: true, itsConfirmed: false, labels: 50000, minBatch: 1 });
    assert(its.ready === false && its.blocks.some(function(b) { return /ИТС/.test(b); }), 'ИТС нужен и не подтверждён — блокировка');
    var itsOk = LP.labelPositionFlags({ pick: LP.DIE_PICK.MANUAL, itsNeeded: true, itsConfirmed: true, labels: 50000, minBatch: 1 });
    assert(itsOk.ready === true, 'ИТС подтвердил, нож выбран вручную — готова');
    var small = LP.labelPositionFlags({ pick: LP.DIE_PICK.FOUND, itsNeeded: false, labels: 1000, minBatch: 39366 });
    assert(small.ready === true && small.warnings.some(function(w) { return /минимальн/i.test(w); }),
        'меньше минимальной партии — предупреждение, не блокировка');
})();

// ── 5. Схема и конфигурация ──────────────────────────────────────────────────
(function() {
    var schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'atex_phase2_schema.json'), 'utf8'));
    var flat = [];
    (function walk(list) { (list || []).forEach(function(t) { flat.push(t); walk(t.children); }); })(schema.tables);
    function field(tname, fname) {
        var t = flat.filter(function(x) { return x.name === tname; })[0];
        return ((t && t.fields) || []).filter(function(f) { return f.name === fname; })[0];
    }
    var cfg = LP.PRODUCTION_CONFIGS['этикетка'].tables;
    var want = {
        orderStreams: ['Ручьёв в заказе', 'NUMBER'],
        die: ['Нож', null, 'Нож'],
        diePick: ['Подбор ножа', 'SHORT'],
        minBatch: ['Мин. партия, шт', 'NUMBER'],
        itsNeeded: ['Нужно подтверждение ИТС', 'BOOLEAN'],
        itsConfirmed: ['Подтверждено ИТС', 'BOOLEAN']
    };
    Object.keys(want).forEach(function(k) {
        var w = want[k];
        var f = field('Заказанное количество', w[0]);
        assert(f && (w[1] ? f.type === w[1] : f.ref === w[2]), 'схема: «Заказанное количество» → «' + w[0] + '»', JSON.stringify(f));
        assert(cfg.position.reqs[k] === w[0], 'конфигурация: position.reqs.' + k + ' = «' + w[0] + '»');
    });
    var liner = field('Сырьё этикетки', 'Тип подложки');
    assert(liner && liner.type === 'SHORT', 'схема: «Сырьё этикетки» → «Тип подложки»');
    assert(cfg.material.reqs.linerType === 'Тип подложки', 'конфигурация: material.reqs.linerType');
})();

// ── 6. Рабочее место: строка отчёта label_positions → расчёт → что записать ─────
(function() {
    var LO;
    try { LO = require('../download/atex-p2/js/label-orders.js').core; } catch (e) { LO = null; }
    assert(!!LO, 'модуль download/atex-p2/js/label-orders.js грузится');
    if (!LO) return;
    var materials = { '177': { name: '0043 SG/HM/YG', base: 'Бумага' } };
    var row = {
        'РулоновID': '488', 'ЗаказID': '437', 'Заказ': '3259', 'СырьёID': '177', 'Сырьё': '0043 SG/HM/YG',
        'Ширина, мм': '148.00', 'Длина, мм': '210.00', 'Ручьёв': '', 'Шт в рулоне': '900', 'Рулонов': '900',
        'Тип ножей': '148 х 210 (80)', 'Подбор ножа': '', 'НожID': '', 'Мин. партия': '', 'ИТС нужен': '', 'ИТС подтв.': '', 'Втулка, мм': ''
    };
    var pos = LO.positionFromRow(row, materials);
    assert(pos.id === '488' && pos.base === 'Бумага' && pos.knifeStreams === null, 'основа позиции — из её сырья; ручьёв в «Типе ножей» нет', JSON.stringify(pos));
    var dies = DIES.map(function(d) { return Object.assign({ repeatMm: 666.75, labelsPerRepeat: 3, usedFormat: 305, sleeveWidth: 80 }, d); });
    var plan = LO.planPosition(pos, dies, { mrLength: '2000', itsMin: '20', itsMax: '250' });
    assert(plan.die.ok && plan.die.die.id === '2', 'подобран нож 2 (меньший пробег)');
    assert(plan.write.die === '2' && plan.write.diePick === LP.DIE_PICK.FOUND && plan.write.itsNeeded === '' &&
        plan.write.minBatch === String(Math.floor(2000000 / 666.75) * 3 * 2), 'в позицию пишется нож, «подобран», мин. партия, ИТС не нужен', JSON.stringify(plan.write));
    assert(plan.write.sleeveWidth === '80', 'ширины втулки в позиции нет — берётся из ножа');
    assert(LO.writeDiffers(pos, plan.write) === true, 'записанное отличается от расчёта — нужно записать');
    var written = LO.positionFromRow(Object.assign({}, row, { 'Подбор ножа': 'подобран', 'НожID': '2', 'Мин. партия': plan.write.minBatch, 'Втулка, мм': '80.00' }), materials);
    assert(LO.writeDiffers(written, LO.planPosition(written, dies, { mrLength: '2000', itsMin: '20', itsMax: '250' }).write) === false,
        'после записи повторный подбор ничего не меняет');

    var small = LO.positionFromRow(Object.assign({}, row, { 'Ширина, мм': '18', 'Длина, мм': '18', 'ИТС подтв.': 'X' }), materials);
    var sp = LO.planPosition(small, dies, { mrLength: '2000', itsMin: '20', itsMax: '250' });
    assert(sp.write.itsNeeded === '1' && sp.die.die.id === '5' && sp.flags.ready === true,
        '18×18: ИТС нужен и подтверждён («X»), нож 5 — позиция готова', JSON.stringify(sp.flags));
    var unconfirmed = LO.positionFromRow(Object.assign({}, row, { 'Ширина, мм': '18', 'Длина, мм': '18' }), materials);
    var up = LO.planPosition(unconfirmed, dies, { mrLength: '2000', itsMin: '20', itsMax: '250' });
    assert(up.flags.ready === false && up.flags.blocks.length === 1 && /ИТС/.test(up.flags.blocks[0]), '18×18 без подтверждения ИТС — держит только ИТС');

    var err = LO.validatePositionForm({ width: '0', length: 'abc', labelsPerRoll: '', rolls: '1.5', orderStreams: '0', materialId: '', orderId: '', newOrderNo: '', knifeType: '85 на 38' });
    assert(['width', 'length', 'labelsPerRoll', 'rolls', 'orderStreams', 'materialId', 'orderId', 'knifeType'].every(function(k) { return !!err[k]; }),
        'форма: каждое неверное поле названо', JSON.stringify(Object.keys(err)));
    var okForm = LO.validatePositionForm({ width: '102', length: '120,5', labelsPerRoll: '3300', rolls: '471', orderStreams: '', materialId: '177', orderId: '437', knifeType: '102 х 120,5 (80)' });
    assert(Object.keys(okForm).length === 0, 'форма: верные поля проходят (ручьёв пусто = 1, дробь через запятую)', JSON.stringify(okForm));
    assert(LO.isoToRu('2026-11-10') === '10.11.2026' && LO.ruToIso('10.11.2026') === '2026-11-10', 'дата формы ↔ ДД.ММ.ГГГГ');
    assert(LO.bool('X') && !LO.bool('') && !LO.bool('0'), 'BOOLEAN Интеграма: «X» — да');
})();

// ── 7. «Подтвердить ИТС» — только роли из LABEL_ITS_ROLES (комментарий владельца в PR #5329) ──
(function() {
    var LO;
    try { LO = require('../download/atex-p2/js/label-orders.js').core; } catch (e) { LO = null; }
    if (!LO) return Promise.resolve();
    assert(typeof LO.canConfirmIts === 'function', 'canConfirmIts экспортирована');
    if (typeof LO.canConfirmIts !== 'function') return Promise.resolve();
    var c = LO.canConfirmIts;
    assert(c({ role: 'Диспетчер', user: 'ivanov', db: 'ateh1' }, '') === true, 'ИТС — это Диспетчер: подтверждает при пустой настройке');
    assert(c({ role: 'ИТС', user: 'ivanov', db: 'ateh1' }, '') === false, 'отдельной роли «ИТС» нет — по умолчанию она не пускается');
    assert(c({ role: 'Менеджер', user: 'petrova', db: 'ateh1' }, '') === false, 'Менеджер не подтверждает');
    assert(c({ role: 'Менеджер', user: 'petrova', db: 'ateh1' }, 'Диспетчер, Менеджер') === true, 'роль из списка настройки подтверждает');
    assert(c({ role: '  диспетчер ', user: 'x', db: 'ateh1' }, 'Главный технолог;Диспетчер') === true, 'сравнение без регистра и пробелов, разделитель «;» тоже');
    assert(c({ role: 'Диспетчер', user: 'x', db: 'ateh1' }, 'Главный технолог') === false, 'настройка задана — «Диспетчер» по умолчанию не добавляется');
    assert(c({ role: 'admin', user: 'x', db: 'ateh1' }, '') === true && c({ role: 'Менеджер', user: 'ateh1', db: 'ateh1' }, '') === true,
        'admin и владелец базы подтверждают всегда (ядро пускает их в обход грантов)');
    assert(c({ role: '', user: '', db: 'ateh1' }, '') === false, 'роль не определена — нельзя');
    var html = fs.readFileSync(path.join(__dirname, '../templates/atex-p2/label-orders.html'), 'utf8');
    assert(html.indexOf('data-role="{_global_.role}"') >= 0 && html.indexOf('data-user="{_global_.user}"') >= 0, 'шаблон передаёт роль и пользователя');
    // Без права toggleIts ничего не пишет и не спрашивает подтверждения — даже если кнопку вызвали в обход разметки.
    var M = require('../download/atex-p2/js/label-orders.js');
    var posted = 0, asked = 0, said = '';
    var fake = {
        settings: { itsRoles: '' }, ctx: { role: 'Менеджер', user: 'petrova', db: 'ateh1' },
        tables: { position: { reqs: { itsConfirmed: '999' } } },
        canIts: M.AtexLabelOrders.prototype.canIts,
        confirm: function() { asked++; return Promise.resolve(true); },
        post: function() { posted++; return Promise.resolve({}); },
        reload: function() { return Promise.resolve(); },
        message: function(t) { said = t; }
    };
    var pos = { id: '488', orderNo: '3259', width: 18, length: 18, itsConfirmed: false };
    return Promise.resolve(M.AtexLabelOrders.prototype.toggleIts.call(fake, pos)).then(function() {
        assert(posted === 0 && asked === 0 && /ИТС/.test(said), 'Менеджер: toggleIts не пишет, объясняет, чья кнопка', said);
        fake.ctx = { role: 'Диспетчер', user: 'ivanov', db: 'ateh1' };
        return M.AtexLabelOrders.prototype.toggleIts.call(fake, pos);
    }).then(function() {
        assert(posted === 1 && asked === 1, 'Диспетчер: toggleIts спрашивает и пишет');
    });
})().then(function() {
    console.log('\n' + passed + '/' + total + ' проверок пройдено.');
}, function(err) {
    assert(false, 'блок 7 упал', err && err.message);
    console.log('\n' + passed + '/' + total + ' проверок пройдено.');
});
