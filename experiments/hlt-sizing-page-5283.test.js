// Гейт-тест для docs/hlt-stand/sizing.html (issue #5283): страница «подбор конфигурации
// и расчёт параметров» строит модель стоимости запроса из встроенного блока DATA.
// Тест держит DATA в синхроне с сырыми замерами и проверяет саму модель:
//   1) каждый медианный прогон remeasure-2510.json присутствует в DATA.agg;
//   2) sel-опорники DATA.sel.pts совпадают с медианами чистых ячеек results.json (±25 %);
//   3) формулы страницы (исполняется реальный <script> с DOM-заглушкой) воспроизводят
//      все ячейки перезамера и sel-опорники в пределах ±15 % — то, что заявлено на странице;
//   4) справочные константы: ×10 = ×2.3, ×25 = ×5.4, batch100 = 240 строк/с.
//
// До появления sizing.html тест красный (страницы нет — нечего сверять).
//
// Run with: node experiments/hlt-sizing-page-5283.test.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, total = 0;
function assertTrue(ok, name, detail) {
    total++;
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (ok) { passed++; }
    else { console.log('  ' + detail); process.exitCode = 1; }
}
const pct = (a, b) => Math.abs(a / b - 1) * 100;

const pagePath = path.join(__dirname, '..', 'docs', 'hlt-stand', 'sizing.html');
let page = null, readErr = '';
try { page = fs.readFileSync(pagePath, 'utf8'); }
catch (e) { readErr = e.message; /* красный ниже */ }
assertTrue(page !== null, 'sizing.html существует', readErr);

if (page) {
    const dm = page.match(/\/\*DATA-START\*\/([\s\S]*?)\/\*DATA-END\*\//);
    assertTrue(!!dm, 'в странице есть блок DATA между маркерами', 'маркеры /*DATA-START*/…/*DATA-END*/ не найдены');
    let DATA = null;
    if (dm) {
        try { DATA = JSON.parse(dm[1]); assertTrue(true, 'DATA — корректный JSON', ''); }
        catch (e) { assertTrue(false, 'DATA — корректный JSON', e.message); }
    }

    if (DATA) {
        // 1) DATA.agg покрывает все ячейки перезамера
        const rm = JSON.parse(fs.readFileSync(
            path.join(__dirname, '..', 'docs', 'hlt-stand', 'remeasure-2510.json'), 'utf8'));
        let missing = [], drifted = [];
        rm.forEach(r => {
            const w = r.table.slice(-3), j = r.scenario[3], S = parseFloat(r.scenario.split('_')[1]);
            const fam = DATA.agg[w] && DATA.agg[w].j[j];
            const pt = fam && fam.pts.find(p => p[0] === S);
            if (!pt) missing.push(r.table + ' ' + r.scenario);
            else if (Math.abs(pt[1] - r.median / 1000) > 0.05) drifted.push(r.table + ' ' + r.scenario);
        });
        assertTrue(missing.length === 0, 'DATA.agg покрывает все 22 ячейки перезамера',
            'нет точек: ' + missing.join(', '));
        assertTrue(drifted.length === 0, 'медианы в DATA совпадают с remeasure-2510.json',
            'расхождение: ' + drifted.join(', '));

        // 2) sel-опорники против чистых ячеек сетки (×5, W12, без ошибок)
        const res = JSON.parse(fs.readFileSync(
            path.join(__dirname, '..', 'docs', 'hlt-stand', 'results.json'), 'utf8'));
        let bad = [];
        DATA.sel.pts.forEach(p => {
            const v = res.filter(r => r.scenario === 'sel1_' + p[0] && r.threads === 5 &&
                    r.fail === 0 && r.table.endsWith('W12'))
                .map(r => r.p95).sort((a, b) => a - b);
            const med = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
            if (pct(p[1], med) > 25) bad.push('S=' + p[0] + ': ' + p[1] + ' vs ' + med);
        });
        assertTrue(bad.length === 0, 'sel-опорники в пределах 25 % от сетки results.json',
            bad.join('; ') || 'ok');

        // 3) поведение: исполняем скрипт страницы с DOM-заглушкой и сверяем модель
        const script = page.match(/<script>([\s\S]*)<\/script>/)[1];
        function fakeEl(def) {
            const store = Object.assign({ value: '5', innerHTML: '', hidden: true, style: {} }, def || {});
            const f = new Proxy(function () {}, {
                get(t, p) {
                    if (p in store) return store[p];
                    if (p === 'viewBox') return { baseVal: { width: 720, height: 330 } };
                    if (p === 'querySelector' || p === 'appendChild' || p === 'addEventListener' ||
                        p === 'querySelectorAll') return () => fakeEl({});
                    return f;
                },
                set(t, p, v) { store[p] = v; return true; },
                apply() { return f; }
            });
            return f;
        }
        const ids = {};
        ['op', 'join', 'width', 'nrows', 'slice', 'threads', 'cores', 'stats', 'formula', 'flag',
            'nearest', 'mtitle', 'mnote', 'mplot', 'mtable', 'calc',
            'lw', 'lw2', 'lw3', 'lw4', 'lw5'].forEach(id => { ids[id] = fakeEl({}); });
        const sandbox = {
            document: {
                getElementById: id => ids[id],
                querySelectorAll: () => [],
                createElement: () => fakeEl({}),
                createElementNS: () => fakeEl({})
            },
            console: { log: () => {} }
        };
        let evalOk = true;
        try { vm.createContext(sandbox); vm.runInContext(script, sandbox); }
        catch (e) { evalOk = false; assertTrue(false, 'скрипт страницы исполняется', e.message); }
        if (evalOk) {
            assertTrue(true, 'скрипт страницы исполняется', '');
            let worst = ['', 0];
            rm.forEach(r => {
                const w = r.table.slice(-3), j = r.scenario[3], S = parseFloat(r.scenario.split('_')[1]);
                const fam = DATA.agg[w].j[j], aRow = fam.a / DATA.agg[w].refRows;
                const m = (aRow * DATA.agg[w].refRows + fam.b * S) * 1000; // мс, опорный размер таблицы
                const d = pct(m, r.median);
                if (d > worst[1]) worst = [r.table + ' ' + r.scenario, d];
            });
            assertTrue(worst[1] <= 15, 'модель agg воспроизводит перезамер в пределах 15 %',
                'худшая: ' + worst[0] + ' ' + worst[1].toFixed(1) + ' %');
            DATA.sel.pts.forEach(p => {
                const se = vm.runInContext('selEstimate', sandbox)(p[0], '5');
                const d = pct(se.t, p[1]);
                assertTrue(d <= 15, 'модель sel воспроизводит опорник S=' + p[0] + ' в пределах 15 %',
                    'модель ' + Math.round(se.t) + ' vs ' + p[1] + ' (' + d.toFixed(1) + ' %)');
            });
        }

        // 4) справочные константы
        assertTrue(DATA.sel.mul['10'] >= 2.0 && DATA.sel.mul['10'] <= 2.6,
            'множитель ×10 в опорном коридоре 2.0–2.6', String(DATA.sel.mul['10']));
        assertTrue(DATA.sel.mul['25'] >= 4.8 && DATA.sel.mul['25'] <= 6.0,
            'множитель ×25 в опорном коридоре 4.8–6.0', String(DATA.sel.mul['25']));
        assertTrue(DATA.write.batch.rps['5'] * DATA.write.batch.perCall === 240,
            'batch100 = 240 строк/с', String(DATA.write.batch.rps['5'] * DATA.write.batch.perCall));
    }
}

console.log('\n' + passed + '/' + total + ' проверок пройдено');
