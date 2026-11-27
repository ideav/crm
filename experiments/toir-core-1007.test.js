// Поведенческие проверки расчётов демо ТОиР (база toir, backlogram#1007).
// rules: none (defect #5757)
// Запуск: node experiments/toir-core-1007.test.js
'use strict';
const path = require('path');
const C = require(path.join(__dirname, '..', 'download', 'toir', 'js', 'toir-core.js'));
let pass = 0, fail = 0;
function check(name, cond, info) { if (cond) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name + (info !== undefined ? ' :: ' + JSON.stringify(info) : '')); } }
const TODAY = '2026-11-26';

// 1. показание против нормы
const vib = { kind: 'Показание', lo: 0, hi: 4.5 }, air = { kind: 'Показание', lo: 5.5, hi: 7 };
check('показание в норме', C.checkReading(vib, '4,4').ok === true);
const r = C.checkReading(vib, 6.8);
check('вибрация 6,8 при норме до 4,5 — отклонение около 51%', !r.ok && Math.abs(r.excess - 0.511) < 0.01, r);
check('давление ниже нижней границы — отклонение от диапазона', C.checkReading(air, 5.2).side === 'low' && Math.abs(C.checkReading(air, 5.2).excess - 0.2) < 0.001);
check('пустое показание не проходит как норма', C.checkReading(vib, '').empty === true && C.checkReading(vib, '').ok === false);
check('осмотр без показания всегда ok', C.checkReading({ kind: 'Осмотр' }, '').ok === true);

// 2. критичность замечания
check('отклонение больше 30% — высокая', C.suggestCriticality({ kind: 'reading', excess: 0.51, eqClass: 'B' }) === 'Высокая');
check('течь на оборудовании класса A — высокая', C.suggestCriticality({ kind: C.remarkKind('Подтекает штуцер, лужа масла'), eqClass: 'A' }) === 'Высокая');
check('«линия встала» — аварийная', C.suggestCriticality({ kind: C.remarkKind('Заклинил редуктор, линия встала'), eqClass: 'C' }) === 'Аварийная');
check('замечание на узле класса C без показаний — низкая', C.suggestCriticality({ kind: C.remarkKind('Не горит подсветка'), eqClass: 'C' }) === 'Низкая');
check('небольшое отклонение показания на классе B — средняя', C.suggestCriticality({ kind: 'reading', excess: 0.05, eqClass: 'B' }) === 'Средняя');

// 3. тренд, срок и состояние дефекта
check('три роста подряд у предела — предупреждение', /Растёт/.test(C.trend([3.1, 3.6, 3.9, 4.2], 4.5) || ''));
check('рост с одним провалом у предела — тоже предупреждение', /Растёт/.test(C.trend([3.9, 4.2, 4.1, 4.4], 4.5) || ''));
check('замеры не выросли за окно — без предупреждения', C.trend([4.4, 4.0, 3.9, 4.2], 4.5) === null);
check('рост далеко от предела — без предупреждения', C.trend([1, 1.2, 1.4, 1.6], 4.5) === null);
check('срок устранения: обнаружен 26.11, высокая (3 дня) — 29.11', C.dueDate(TODAY, 3) === '2026-11-29');
const st = C.defectState({ status: 'Новый', due: '2026-11-24', answer: '' }, TODAY);
check('дефект со сроком 24.11 на 26.11 просрочен на 2 дня и без ответа', st.overdue && st.left === -2 && st.silent, st);
check('устранённый дефект не просрочен', C.defectState({ status: 'Устранён', due: '2026-11-01' }, TODAY).overdue === false);
check('номер дефекта с телефона: дата и время', C.defectNo(TODAY, '08:42:13') === 'Д-261126-084213');
check('следующий номер наряда', C.nextNo('Н-', ['Н-0041', 'Н-0007', 'X'], 4) === 'Н-0042');

// 4. замечания без дефекта и аварии, о которых предупреждали
const marks = [
  { id: '1', eq: 'ТМ-1', date: '2026-11-03', result: 'Замечание' },
  { id: '2', eq: 'РФМ-2', date: '2026-11-21', result: 'Замечание' },
  { id: '3', eq: 'КО-2', date: '2026-11-20', result: 'Замечание' },
  { id: '4', eq: 'КО-2', date: '2026-11-21', result: 'Норма' },
  { id: '5', eq: 'КП-2', date: '2026-11-17', result: 'Замечание' }];
const defects = [{ eq: 'РФМ-2', found: '2026-11-21', mark: '2' }, { eq: 'КП-2', found: '2026-11-18' }, { eq: 'ТМ-1', found: '2026-11-12' }];
const free = C.remarksWithoutDefect(marks, defects).map(m => m.id);
check('без дефекта остаются замечания 1 и 3 (2 связано ссылкой, 5 — дефект узла на следующий день)', free.join() === '1,3', free);
const mw = C.missedWarnings([{ eq: 'ТМ-1', date: '2026-11-12', cause: 'Авария', hours: 7.5 }, { eq: 'УА-3', date: '2026-11-18', cause: 'Нет запчасти', hours: 14 }], marks, defects);
check('авария ТМ-1 12.11 найдена как предупреждённая замечанием за 9 дней', mw.length === 1 && mw[0].days === 9 && mw[0].mark.id === '1', mw);

// 5. ведомость на останов
const eq = { 'ПТ-2': { line: 'Л-2' }, 'КП-2': { line: 'Л-2' }, 'ТМ-2': { line: 'Л-2' }, 'ПТ-3': { line: 'Л-3' } };
const works = { 'Подшипники': { hours: 6, prof: 'Слесарь', stop: 'Да' }, 'Ремень': { hours: 2, prof: 'Слесарь', stop: 'Да' }, 'ТО-1': { hours: 4, prof: 'Слесарь', stop: 'Да' }, 'Концевик': { hours: 0.5, prof: 'КИП', stop: 'Нет' } };
const norms = { 'Подшипники': [{ part: 'Подшипник', qty: 2 }], 'Ремень': [{ part: 'Ремень', qty: 2 }], 'ТО-1': [{ part: 'Масло', qty: 5 }] };
const parts = { 'Подшипник': { stock: 3, reserved: 2, lead: 5 }, 'Ремень': { stock: 0, reserved: 0, lead: 14 }, 'Масло': { stock: 18, reserved: 5, lead: 2 } };
const stop = { name: 'Останов Л-2', line: 'Л-2', from: '2026-12-05', to: '2026-12-06', hours: 36 };
const S = C.statement({ stop, eq, works, norms, parts, today: TODAY,
  defects: [
    { name: 'Д-1', eq: 'ПТ-2', status: 'Новый', crit: 'Высокая', work: 'Подшипники', due: '2026-11-29' },
    { name: 'Д-2', eq: 'КП-2', status: 'Принят', crit: 'Средняя', work: 'Ремень', due: '2026-12-02', stop: 'Останов Л-2' },
    { name: 'Д-3', eq: 'ПТ-3', status: 'Новый', crit: 'Высокая', work: 'Подшипники' },
    { name: 'Д-4', eq: 'ТМ-2', status: 'Устранён', crit: 'Средняя', work: 'Концевик' },
    { name: 'Д-5', eq: 'ТМ-2', status: 'Принят', crit: 'Низкая', work: 'Концевик', stop: 'Другой останов' }],
  ppr: [{ name: 'ППР-1', eq: 'ТМ-2', work: 'ТО-1', plan: '2026-11-20' }, { name: 'ППР-2', eq: 'ТМ-2', work: 'ТО-1', plan: '2027-01-20' }] });
check('в ведомость попали открытые дефекты линии и просроченный ППР, чужая линия, закрытые и чужой останов — нет', S.rows.map(x => x.ref).join() === 'Д-1,Д-2,ППР-1', S.rows.map(x => x.ref));
check('трудоёмкость по нормам 6+2+4 = 12 ч', S.hours === 12);
const P = {}; S.parts.forEach(p => { P[p.part] = p; });
check('подшипник: нужно 2, свободно 1 — заказать сегодня, успевает к 04.12', P['Подшипник'].short === 1 && P['Подшипник'].state === 'order' && P['Подшипник'].arrive === '2026-12-01', P['Подшипник']);
check('ремень: поставка 14 дней — к останову не успеет, строка заблокирована', P['Ремень'].state === 'late' && S.rows[1].blocked === true && S.rows[0].blocked === false);
check('масло: свободный остаток 13 из 18 покрывает 5', P['Масло'].state === 'ok' && P['Масло'].free === 13);

// 6. ППР, доли в срок, простои
const moves = C.pprToStop([{ id: 'a', name: 'ППР-1', eq: 'ТМ-2', plan: '2026-11-20' }, { id: 'b', name: 'ППР-2', eq: 'ТМ-2', plan: '2027-01-20' }, { id: 'c', name: 'ППР-3', eq: 'ПТ-3', plan: '2026-12-01' }], stop, { 'ТМ-2': 'Л-2', 'ПТ-3': 'Л-3' });
check('ППР перестраивается: просроченный ТО-1 ТМ-2 уходит на 05.12, дальний и чужая линия — нет', moves.length === 1 && moves[0].to === '2026-12-05' && moves[0].from === '2026-11-20', moves);
check('состояние ППР: просрочен / скоро / в останове', C.pprState({ plan: '2026-11-20' }, TODAY) === 'overdue' && C.pprState({ plan: '2026-11-30' }, TODAY) === 'soon' && C.pprState({ plan: '2026-11-20', stop: 'x' }, TODAY) === 'stop');
const ot = C.onTime([{ due: '2026-11-10', done: '2026-11-09' }, { due: '2026-11-10', done: '2026-11-12' }, { due: '2026-11-10', done: '2026-11-10' }, { due: '2026-11-10' }]);
check('в срок 2 из 3 закрытых (открытый не считается) — 67%', ot.n === 3 && ot.ok === 2 && ot.pct === 67, ot);
const downs = [{ eq: 'ТМ-1', date: '2026-11-12', cause: 'Авария', hours: 7.5 }, { eq: 'УА-3', date: '2026-11-18', cause: 'Нет запчасти', hours: 14 }, { eq: 'ПТ-1', date: '2026-10-08', cause: 'Авария', hours: '5' }];
const bm = C.downtimeByMonth(downs);
check('простои по месяцам: ноябрь авария 7,5 ч и запчасти 14 ч, октябрь авария 5 ч', bm['2026-11']['Авария'] === 7.5 && bm['2026-11']['Нет запчасти'] === 14 && bm['2026-10']['Авария'] === 5, bm);
check('цена простоев из-за запчастей: 14 ч x 24 000 ₽', C.downtimeCost(downs, { 'ТМ-1': 31000, 'УА-3': 24000, 'ПТ-1': 31000 }, 'Нет запчасти') === 336000);

// 7. выгрузка в 1С и очередь без сети
const ex = C.export1C([{ name: 'Н-1', status: 'Выполнен', done: '2026-11-19', eq: 'УА-3', work: 'Замена датчика; метки', hours: 1.5, exec: 'kip' }, { name: 'Н-2', status: 'Выполнен', done: '2026-11-10', exported: '2026-11-11' }, { name: 'Н-3', status: 'В работе' }], { 'УА-3': '00-0003217' }, { 'Н-1': [{ part: 'Датчик', qty: 1 }] });
const lines = ex.csv.split('\r\n');
check('в 1С уходят только выполненные и не выгруженные', ex.rows.length === 1 && lines.length === 2);
check('строка 1С: дата, код, часы с запятой, «;» в тексте экранирован', lines[1] === 'Н-1;19.11.2026;00-0003217;УА-3;"Замена датчика; метки";1,5;kip;Датчик x 1', lines[1]);
let q = C.queueAdd([], { eq: 'ПТ-2' }); q = C.queueAdd(q, { eq: 'КО-2' });
check('очередь без сети: две отметки ждут, одна ушла — осталась одна', q.length === 2 && C.queueDrop(q, q[0].qid).length === 1 && C.queueDrop(q, q[0].qid)[0].eq === 'КО-2');
const pr = C.routeProgress([{ eq: 'ПТ-2', type: 'Печь' }, { eq: 'КО-2', type: 'Конв' }], { 'Печь': [1, 2], 'Конв': [1, 2] }, [{ eq: 'ПТ-2', item: 'a', result: 'Норма' }, { eq: 'ПТ-2', item: 'b', result: 'Замечание' }, { eq: 'КО-2', item: 'a', result: 'Норма' }]);
check('ход обхода: 1 из 2 точек полностью, 1 замечание', pr.done === 1 && pr.total === 2 && pr.remarks === 1, pr);

console.log('\n' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
