// #4998 — Диаграмма Ганта (cut-gantt): альтернативное название Вида сырья.
//
// ТЗ (issue #4998, как #4996): отчёт cut_planning отдаёт `alt_material` — Гант
// показывает его вместо внутреннего `cut_material` в тултипе бара («Сырьё: …»)
// и в подписи строки, когда заполнено; пустой альт — молчаливый фолбэк на
// обычное имя (принятый паттерн #4996).
//
// Run with: node experiments/atex-cut-gantt-4998.test.js

process.env.TZ = 'UTC';

var gantt = require('../download/atex/js/cut-gantt.js').gantt;

var passed = 0, total = 0;
function assertEqual(actual, expected, name) {
    total++;
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    var ok = a === e;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' (ожидалось ' + e + ', получено ' + a + ')'));
    if (ok) passed++; else process.exitCode = 1;
}

var status = { label: 'Запланировано' };

function materialLine(title) {
    var lines = String(title).split('\n');
    for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('Сырьё: ') === 0) return lines[i];
    }
    return '';
}

// ── 1) rowsToCuts несёт alt_material из отчёта ──
var cuts = gantt.rowsToCuts([
    { cut_id: '10', cut_plan_date: '06.05.2026', cut_material: 'MWR113L', alt_material: 'MCHR ZNAK 3 Special' },
    { cut_id: '11', cut_plan_date: '07.05.2026', cut_material: 'MWR113L' }
]);
assertEqual([cuts[0].materialAlt, cuts[1].materialAlt], ['MCHR ZNAK 3 Special', ''],
    '#4998 rowsToCuts читает alt_material (пусто, если колонки нет)');

// ── 2) тултип бара: альт старше обычного имени, пустой — фолбэк ──
assertEqual(materialLine(gantt.cutBarTitle(cuts[0], {}, status)),
    'Сырьё: MCHR ZNAK 3 Special', '#4998 тултип показывает альт, когда заполнен');
assertEqual(materialLine(gantt.cutBarTitle(cuts[1], {}, status)),
    'Сырьё: MWR113L', '#4998 пустой альт — тултип показывает обычное имя');
assertEqual(materialLine(gantt.cutBarTitle({ id: '12', materialAlt: 'АЛЬТ' }, {}, status)),
    'Сырьё: АЛЬТ', '#4998 альт показывается и без обычного имени');

// ── 3) подпись строки: альт (обрезанный до пробела) старше обычного имени ──
assertEqual(gantt.cutRowLabel(cuts[0]), '— / 06.05.2026 / MCHR',
    '#4998 подпись строки показывает короткий альт');
assertEqual(gantt.cutRowLabel(cuts[1]), '— / 07.05.2026 / MWR113L',
    '#4998 пустой альт — подпись показывает обычное имя');

// ── 4) план/расписание не задето: materialId остаётся на cut_material_id ──
assertEqual([cuts[0].materialId, cuts[0].materialName], ['', 'MWR113L'],
    '#4998 materialId остаётся пустым без cut_material_id — витринное имя не влияет на смены сырья');

console.log('\n' + passed + '/' + total + ' passed');
if (process.exitCode) process.exit(process.exitCode);
