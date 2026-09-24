// ideav/crm#5003: на двух устройствах одного упаковочного места — разные «Следующие
// задания». Причина: страница показывает снимок на момент последней загрузки и сама
// не обновляется (план в течение дня перепланируется — старые задания исчезают из
// очереди, планшет молча показывает уже несуществующие). Фикс: авто-обновление
// (по возврату на вкладку/фокусу окна и раз в 5 минут) с тремя стражами — не
// перечитывать поверх открытого диалога, несохранённой правки количества и сразу
// после свежей загрузки; плюс подпись свежести «данные на ЧЧ:ММ» у кнопки «Обновить».
//
// Run with: node experiments/atex-packer-5003-autorefresh.test.js

var mod = require('../download/atex/js/packer.js');
var core = mod.core;

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

// Строка отчёта в представлении модели (после itemFromReportRow + локальные поля).
function item(over) {
    var base = {
        taskId: '666355', gpId: '666392', orderNo: '4619',
        planQty: 110, factQty: 110, packedQty: 0,
        editedQty: null, editedNote: ''
    };
    Object.keys(over || {}).forEach(function(k) { base[k] = over[k]; });
    return base;
}

// ── hasUnsavedEdits: несохранённая правка количества ──

assertEqual(core.hasUnsavedEdits([]), false, 'hasUnsavedEdits: пустой список → нет правок');
assertEqual(core.hasUnsavedEdits(), false, 'hasUnsavedEdits: без аргумента → нет правок');
assertEqual(core.hasUnsavedEdits([item(), item({ taskId: '2' })]), false,
    'hasUnsavedEdits: свежие позиции из отчёта → нет правок');
assertEqual(core.hasUnsavedEdits([item(), item({ editedQty: 10 })]), true,
    'hasUnsavedEdits: правленное количество у неупакованной → есть');
assertEqual(core.hasUnsavedEdits([item({ editedQty: 108, editedNote: '10 шт в брак' })]), true,
    'hasUnsavedEdits: правка с примечанием → есть');
assertEqual(core.hasUnsavedEdits([item({ editedQty: null, editedNote: '10 шт в брак' })]), true,
    'hasUnsavedEdits: примечание без правки количества тоже несохранённое → есть');
assertEqual(core.hasUnsavedEdits([item({ packedQty: 110, editedQty: 10 })]), false,
    'hasUnsavedEdits: у упакованной позиции локальных правок не бывает → нет');

// ── canAutoRefresh: решение «перечитывать ли данные самим» ──

var base = {
    visible: true, busy: false, modalOpen: false, unsavedEdits: false,
    lastLoadMs: 1000, nowMs: 1000 + 5 * 60 * 1000, minGapMs: 30 * 1000
};
function state(over) {
    var s = {};
    Object.keys(base).forEach(function(k) { s[k] = base[k]; });
    Object.keys(over || {}).forEach(function(k) { s[k] = over[k]; });
    return s;
}

assertEqual(core.canAutoRefresh(state()), true, 'canAutoRefresh: всё спокойно → перечитывать');
assertEqual(core.canAutoRefresh(state({ visible: false })), false,
    'canAutoRefresh: страница скрыта → не перечитывать');
assertEqual(core.canAutoRefresh(state({ busy: true })), false,
    'canAutoRefresh: идёт загрузка/запись → не перечитывать');
assertEqual(core.canAutoRefresh(state({ modalOpen: true })), false,
    'canAutoRefresh: открыт диалог → не перечитывать (останется над чужими данными)');
assertEqual(core.canAutoRefresh(state({ unsavedEdits: true })), false,
    'canAutoRefresh: есть несохранённая правка → не перечитывать (не стирать ввод)');
assertEqual(core.canAutoRefresh(state({ nowMs: base.lastLoadMs + 29 * 1000 })), false,
    'canAutoRefresh: перечитали меньше minGapMs назад → не перечитывать');
assertEqual(core.canAutoRefresh(state({ nowMs: base.lastLoadMs + 30 * 1000 })), true,
    'canAutoRefresh: ровно minGapMs → уже можно');
assertEqual(core.canAutoRefresh(state({ lastLoadMs: 0 })), true,
    'canAutoRefresh: ещё ни одной загрузки → можно');

// ── подпись свежести «данные на ЧЧ:ММ»: unixToLocalTime принимает и миллисекунды ──

assertEqual(core.unixToLocalTime(new Date(2026, 8, 24, 15, 2).getTime()), '15:02',
    'unixToLocalTime: миллисекунды (штамп loadedAt) → ЧЧ:ММ');

console.log('passed: ' + passed);
