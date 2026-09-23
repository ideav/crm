// #4996 — альтернативное название Вида сырья в пульте упаковщика.
//
// В отчёт cut_planning добавили колонку alt_material («MCHR ZNAK 3 Special» против
// внутреннего «MWR113L»). В `packer`/`packer_next` колонки может ещё не быть на сервере —
// тогда карточка молча показывает обычное имя (принятый паттерн деградации).
//
// Run with: node experiments/atex-packer-4996-alt-material.test.js

var mod = require('../download/atex/js/packer.js');
var core = mod.core;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; return; }
    console.log('  expected:', JSON.stringify(expected));
    console.log('  actual:  ', JSON.stringify(actual));
    process.exitCode = 1;
}

// Строка отчёта `packer?JSON_KV` — база как в atex-packer.test.js.
function row(over) {
    var base = {
        task: '1786078800', task_id: '666355', gp_id: '666392',
        order_no: '4619', order: '',
        material: 'MWR113L', cut_width: '110.00', cut_length: '600.00',
        wind_direction: 'IN', sleeve: 'втулка пластик серая для Videojet', add_sleeve: '',
        qty: '110', qty_fact: '110', packed: '', notes: '', events: '1'
    };
    Object.keys(over || {}).forEach(function(k) { base[k] = over[k]; });
    return base;
}

// ── разбор: alt_material попадает в item.altMaterial ──
assertEqual(core.itemFromReportRow(row({ alt_material: 'MCHR ZNAK 3 Special' })).altMaterial,
    'MCHR ZNAK 3 Special', '#4996: alt_material разбирается в item.altMaterial');
assertEqual(core.itemFromReportRow(row({ alt_material: { val: 'MCHR ZNAK', id: '2208' } })).altMaterial,
    'MCHR ZNAK', '#4996: alt_material в форме {val,id} → val');
assertEqual(core.itemFromReportRow(row()).altMaterial,
    '', '#4996: колонки нет (packer ещё не отдаёт) → altMaterial пусто');
assertEqual(core.itemFromReportRow(row({ alt_material: '  ' })).altMaterial,
    '', '#4996: пустое альт-имя → пусто, а не пробелы');

// ── подпись позиции: альт-имя старше обычного ──
var withAlt = core.itemFromReportRow(row({ alt_material: 'MCHR ZNAK 3 Special', leader: 'MONOCHROME' }));
assertEqual(core.describeItem(withAlt),
    'MCHR ZNAK 3 Special 110 х 600 IN втулка пластик серая для Videojet MONOCHROME',
    '#4996: describeItem первым ставит альт-имя');
var withoutAlt = core.itemFromReportRow(row({ leader: 'MONOCHROME' }));
assertEqual(core.describeItem(withoutAlt),
    'MWR113L 110 х 600 IN втулка пластик серая для Videojet MONOCHROME',
    '#4996: альта нет — подпись как раньше, с обычным именем');

console.log('\n' + passed + '/' + total + ' assertions passed');
if (passed !== total) process.exitCode = 1;
