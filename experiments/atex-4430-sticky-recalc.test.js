// Tests for ideav/crm#4430 — «Кнопку "↻ Пересчитать наладку (заданий: N)" сделать липкой
// сверху экрана, чтобы было видно».
//
// Кнопка стоит ПЕРВОЙ строкой очереди станка и чинит расхождение хранимого тайминга с
// текущим порядком заданий (#4401/#4408). В длинном дне её уносило вверх при прокрутке —
// оператор её не видел и уходил с разъехавшимся расписанием. Покрываем:
//   1) вид и липкость живут в CSS (.atex-pp-recalc-setup), а не в inline-стиле JS: inline бьёт
//      правило .is-plan-preview (оно снимает липкость под плашкой плана) и разводит вид врозь;
//   2) кнопка приклеена к верху экрана: position: sticky + top: 0 + непрозрачный фон
//      (иначе сквозь неё просвечивают карточки) + z-index выше карточек и правой панели,
//      но ниже липкой плашки плана «Упорядочить» (#4402);
//   3) при непринятом плане («Упорядочить») кнопка НЕ липнет — иначе пряталась бы под
//      плашкой плана, которая липнет к тому же top: 0;
//   4) JS по-прежнему вешает на кнопку класс .atex-pp-recalc-setup и обработчик пересчёта
//      (связь JS↔CSS: переименуют класс — тест упадёт).
//
// Run with: node experiments/atex-4430-sticky-recalc.test.js

process.env.TZ = 'UTC';

var fs = require('fs');
var path = require('path');

var passed = 0, total = 0;
function assert(cond, name) {
    total++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + name);
    if (cond) passed++; else process.exitCode = 1;
}
function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; } else {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

var cssPath = path.join(__dirname, '..', 'download', 'atex', 'css', 'production-planning.css');
var css = fs.readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
var ctrlPath = path.join(__dirname, '..', 'download', 'atex', 'js', 'production-planning', '20-controller.js');
var ctrl = fs.readFileSync(ctrlPath, 'utf8');
var tplPath = path.join(__dirname, '..', 'templates', 'atex', 'production-planning.html');
var tpl = fs.readFileSync(tplPath, 'utf8');

// селектор → объединённые объявления (правил на селектор может быть несколько)
var rules = {};
css.replace(/([^{}]+)\{([^}]*)\}/g, function (m, sel, body) {
    sel.split(',').map(function (s) { return s.trim(); }).forEach(function (s) {
        rules[s] = (rules[s] || '') + ';' + body;
    });
    return m;
});
function decl(sel, prop) {
    var body = rules[sel];
    if (!body) return null;
    var re = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'g');
    var last = null, m;
    while ((m = re.exec(body))) last = m[1].trim();
    return last;
}

// ── 1) Оформление кнопки — в CSS, не в inline-стиле JS ──────────────────────
(function () {
    var block = /var recalcBtn = el\('button', \{[\s\S]*?\}\);/.exec(ctrl);
    assert(!!block, 'кнопка «↻ Пересчитать наладку» создаётся в renderQueue');
    assert(block && block[0].indexOf("class: 'atex-pp-recalc-setup'") >= 0,
        '#4430: на кнопке класс .atex-pp-recalc-setup — по нему её и стилизует CSS');
    assert(block && !/style\s*:/.test(block[0]),
        '#4430: inline-стиля у кнопки нет — он бил бы правило .is-plan-preview (position: static), ' +
        'и под липкой плашкой плана кнопка пряталась бы за ней');
    assert(block && block[0].indexOf('Пересчитать наладку (заданий: ') >= 0,
        'подпись со счётчиком заданий сохранена');
    assert(/recalcBtn\.addEventListener\('click'[\s\S]{0,200}recalcSetupTiming\(actDirtyId\)/.test(ctrl),
        'клик по-прежнему запускает пересчёт тайминга станка (#4401)');
})();

// ── 2) Кнопка приклеена к верху экрана ──────────────────────────────────────
(function () {
    assertEqual(decl('.atex-pp-recalc-setup', 'position'), 'sticky',
        '#4430: .atex-pp-recalc-setup — position: sticky');
    assertEqual(decl('.atex-pp-recalc-setup', 'top'), '0',
        'липнет к самому верху области прокрутки (.app-content)');

    var bg = decl('.atex-pp-recalc-setup', 'background');
    assert(!!bg && !/transparent|none/.test(bg),
        'фон непрозрачный — сквозь приклеенную кнопку не должны просвечивать карточки');
    assertEqual(decl('.atex-pp-recalc-setup', 'color'), '#fff', 'текст белый — на красном читается');

    var z = Number(decl('.atex-pp-recalc-setup', 'z-index'));
    var zLink = Number(decl('.atex-pp-link', 'z-index'));
    var zPlan = Number(decl('.atex-pp-plan-bar-host', 'z-index'));
    assert(isFinite(z) && z > zLink, 'z-index выше правой панели «Связанные позиции» (' + zLink + ')');
    assert(isFinite(z) && z < zPlan, 'но ниже липкой плашки плана «Упорядочить» (' + zPlan + ')');
    assert(/box-shadow/.test(rules['.atex-pp-recalc-setup'] || ''),
        'у приклеенной кнопки есть тень — она лежит поверх карточек и должна от них отделяться');

    // Ширина/отступы/скругление не потерялись при переезде из inline-стиля.
    assertEqual([decl('.atex-pp-recalc-setup', 'display'), decl('.atex-pp-recalc-setup', 'width'),
        decl('.atex-pp-recalc-setup', 'padding'), decl('.atex-pp-recalc-setup', 'border-radius'),
        decl('.atex-pp-recalc-setup', 'cursor')],
        ['block', '100%', '11px 16px', '6px', 'pointer'],
        'вид кнопки прежний: во всю ширину, те же отступы, скругление и курсор');
    assertEqual(decl('.atex-pp-recalc-setup', 'font-weight'), '700', 'подпись по-прежнему жирная');
})();

// ── 3) Непринятый план «Упорядочить»: кнопка не липнет (и погашена) ─────────
(function () {
    assertEqual(decl('.atex-pp.is-plan-preview .atex-pp-recalc-setup', 'position'), 'static',
        '#4430: под липкой плашкой плана кнопка не липнет — иначе пряталась бы под ней');
    var muted = rules['.atex-pp.is-plan-preview .atex-pp-panel-actions .atex-pp-btn'] || '';
    assert(/pointer-events\s*:\s*none/.test(muted),
        'пока план не принят, действия очереди по-прежнему погашены (#4402)');
})();

// ── 4) Версии ресурсов подняты (иначе браузер отдаст старый CSS) ────────────
(function () {
    var cssV = /production-planning\.css\?\{_global_\.version\}\.(\d+)/.exec(tpl);
    var jsV = /production-planning\.js\?\{_global_\.version\}\.(\d+)/.exec(tpl);
    assert(cssV && Number(cssV[1]) >= 13, 'версия CSS поднята (#4058): было .12, стало .' + (cssV && cssV[1]));
    assert(jsV && Number(jsV[1]) >= 60, 'версия JS поднята: было .59, стало .' + (jsV && jsV[1]));
})();

console.log('\n' + passed + '/' + total + ' passed');
