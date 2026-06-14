// #3401 demo — лидер (BETWEEN_CUTS) учитывается перед КАЖДОЙ резкой цуга, а не один раз.
// Раньше «резка» состояла из проходов; в терминологии заказчика цуг состоит из множества
// резок (бывших проходов), и каждая включает этап BETWEEN_CUTS — его множим на их число.
//
// Run with: node experiments/atex-production-planning-3401.demo.js
process.env.TZ = 'UTC';
var planning = require('../download/atex/js/production-planning.js').planning;

var pts = [{ m: 600, min: 4 }];            // норма намотки: 600 м → 4 мин/проход
var times = { BETWEEN_CUTS: 2 };           // лидер 2 мин на резку

// Цуг из 5 резок (проходов) по 600 м.
var cut = { id: 'C', plannedRuns: 5 };
var sched = planning.buildSchedule([cut], { windPoints: pts, times: times, runLengthByCut: { C: 600 }, shiftStartMin: 480 });

console.log('=== #3401: лидер на каждую резку цуга ===');
console.log('Цуг: 5 резок × (намотка 4 мин + лидер 2 мин)');
console.log('Расписание buildSchedule:', JSON.stringify(sched[0]));
console.log('  setupMin =', sched[0].setupMin, '(лидер 2 × 5 резок = 10; было бы 2 при разовом лидере)');
console.log('  durationMin =', sched[0].durationMin, '(намотка 4 × 5 = 20)');

var breakdown = planning.setupBreakdown(null, cut, times);
console.log('Разбивка setup (модалка тайминга):', JSON.stringify(breakdown));

// Раскладка по дням: каждый проход стоит perPass + leader.
var segs = planning.splitMachineQueue([{ id: 'C' }], {
    dayStartMin: 480, dayEndMin: 510, times: times, perPassByCut: { C: 4 }, runsByCut: { C: 5 }
});
console.log('\nРаскладка по дням splitMachineQueue (окно всего 30 мин):');
segs.forEach(function (s) {
    console.log('  день', s.dayOffset, '— резок:', s.runs, ', длительность:', s.durationMin, 'мин');
});
console.log('  (проход = 4 + 2 = 6 мин → в 30 мин влезает 5 резок ровно)');
