// Standalone verification of the funnel calculation rules from issue #2400.
// Run with: node experiments/funnel-logic.test.js

function funnelNum(v) {
    var n = parseInt(v, 10);
    return isNaN(n) ? 0 : n;
}

function funnelSumStage(rows, stage) {
    return rows.reduce(function(s, r) { return s + funnelNum(r[stage]); }, 0);
}

function funnelVisibleStageIndices(totals) {
    var lastNonZero = -1;
    for (var i = totals.length - 1; i >= 0; i--) {
        if (totals[i] > 0) { lastNonZero = i; break; }
    }
    var visible = [];
    for (var j = 0; j < totals.length; j++) {
        if (totals[j] > 0 || j > lastNonZero) visible.push(j);
    }
    return visible;
}

function compute(stages, rows) {
    var totals = stages.map(function(s) { return funnelSumStage(rows, s); });
    var visible = funnelVisibleStageIndices(totals);
    var entries = visible.map(function(idx, pos) {
        var prev = pos > 0 ? totals[visible[pos - 1]] : null;
        var conv = (prev !== null && prev > 0) ? Math.round(totals[idx] / prev * 100) + '%' : null;
        return { stage: stages[idx], count: totals[idx], conv: conv };
    });
    return entries;
}

function assertEqual(actual, expected, name) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name);
    if (!ok) {
        console.log('  expected:', JSON.stringify(expected));
        console.log('  actual:  ', JSON.stringify(actual));
        process.exitCode = 1;
    }
}

var stages = ['Первый контакт', 'Анкета', 'Интервью', 'Оффер', 'Оффер принят', 'Старт обучения'];

// Case 1: stage with 0 in middle but later stages non-zero — middle stage hidden.
// Counts are NOT cumulative.
var rows1 = [{
    'Первый контакт': 10,
    'Анкета': 8,
    'Интервью': 0,    // skipped for this vacancy
    'Оффер': 5,
    'Оффер принят': 3,
    'Старт обучения': 2
}];
assertEqual(compute(stages, rows1), [
    { stage: 'Первый контакт', count: 10, conv: null },
    { stage: 'Анкета', count: 8, conv: '80%' },
    { stage: 'Оффер', count: 5, conv: '63%' },
    { stage: 'Оффер принят', count: 3, conv: '60%' },
    { stage: 'Старт обучения', count: 2, conv: '67%' }
], 'middle zero-stage is hidden, conversion uses previous visible stage');

// Case 2: trailing zeros — funnel didn't complete, keep them visible.
var rows2 = [{
    'Первый контакт': 10,
    'Анкета': 6,
    'Интервью': 4,
    'Оффер': 0,
    'Оффер принят': 0,
    'Старт обучения': 0
}];
assertEqual(compute(stages, rows2), [
    { stage: 'Первый контакт', count: 10, conv: null },
    { stage: 'Анкета', count: 6, conv: '60%' },
    { stage: 'Интервью', count: 4, conv: '67%' },
    { stage: 'Оффер', count: 0, conv: '0%' },
    { stage: 'Оффер принят', count: 0, conv: null },
    { stage: 'Старт обучения', count: 0, conv: null }
], 'trailing zero stages remain visible');

// Case 3: counts must NOT be cumulative — sum across rows is the raw stage count.
var rows3 = [
    { 'Первый контакт': 10, 'Анкета': 6, 'Интервью': 4, 'Оффер': 2, 'Оффер принят': 1, 'Старт обучения': 1 },
    { 'Первый контакт':  5, 'Анкета': 3, 'Интервью': 2, 'Оффер': 1, 'Оффер принят': 0, 'Старт обучения': 0 }
];
assertEqual(compute(stages, rows3), [
    { stage: 'Первый контакт', count: 15, conv: null },
    { stage: 'Анкета', count: 9, conv: '60%' },
    { stage: 'Интервью', count: 6, conv: '67%' },
    { stage: 'Оффер', count: 3, conv: '50%' },
    { stage: 'Оффер принят', count: 1, conv: '33%' },
    { stage: 'Старт обучения', count: 1, conv: '100%' }
], 'counts are raw sums, not cumulative');

// Case 4: multiple zero stages in middle, all hidden.
var rows4 = [{
    'Первый контакт': 100,
    'Анкета': 0,
    'Интервью': 0,
    'Оффер': 20,
    'Оффер принят': 10,
    'Старт обучения': 5
}];
assertEqual(compute(stages, rows4), [
    { stage: 'Первый контакт', count: 100, conv: null },
    { stage: 'Оффер', count: 20, conv: '20%' },
    { stage: 'Оффер принят', count: 10, conv: '50%' },
    { stage: 'Старт обучения', count: 5, conv: '50%' }
], 'multiple middle zero stages all hidden');
