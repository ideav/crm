// Пора — расписание консультаций (issue #5465): из правила записи «Консультация» строятся дни и слоты.
// Дни не заводятся записями: день есть, если он попадает в правило и не отменён исключением.
//   дни = (дни недели внутри периода «с … по …») ∪ (явный список дат) − исключения;
//   слоты дня = от «Время с» шагом «Шаг» до «Время до», кроме тех, что задевают перерыв.
// Время — московское (UTC+3 без перехода на летнее), как у событий афиши.
(function(root){
'use strict';
var MSK = 3 * 3600;
var HORIZON_DAYS = 60;   // без «Период по» дни недели строятся на столько дней вперёд
var WD = { 'пн': 1, 'вт': 2, 'ср': 3, 'чт': 4, 'пт': 5, 'сб': 6, 'вс': 7,
           'пон': 1, 'вто': 2, 'сре': 3, 'чет': 4, 'пят': 5, 'суб': 6, 'вос': 7 };

function pad(n){ return (n < 10 ? '0' : '') + n; }
// День — строка YYYY-MM-DD; из неё же ключ слота и время в unix
function iso(y, m, d){ return y + '-' + pad(m) + '-' + pad(d); }
// Дата из поля базы: DD.MM.YYYY, YYYY-MM-DD, YYYYMMDD или unix-время (московский день)
function parseDate(v){
  var s = String(v == null ? '' : v).trim(), m;
  if(!s) return '';
  if((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/))) return valid(+m[3], +m[2], +m[1]);
  if((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return valid(+m[1], +m[2], +m[3]);
  if((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return valid(+m[1], +m[2], +m[3]);
  if(/^\d{9,11}$/.test(s)) return dayOf(+s);
  return '';
}
function valid(y, m, d){
  var t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? iso(y, m, d) : '';
}
function dayOf(ts){ var t = new Date((ts + MSK) * 1000); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
function dayNum(day){ var p = day.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000; }
function numDay(n){ var t = new Date(n * 86400000); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
function weekdayOf(day){ var w = new Date(dayNum(day) * 86400000).getUTCDay(); return w === 0 ? 7 : w; }
// Список дат — через запятую, точку с запятой, пробелы или переводы строк
function parseDates(v){
  var out = [];
  String(v == null ? '' : v).split(/[\s,;]+/).forEach(function(p){ var d = parseDate(p); if(d) out.push(d); });
  return out;
}
// Дни недели: «пн, ср, пт», «Понедельник», «1,3,5» (1 — понедельник, 7 — воскресенье)
function parseWeekdays(v){
  var out = {};
  String(v == null ? '' : v).toLowerCase().split(/[\s,;.]+/).forEach(function(p){
    if(/^[1-7]$/.test(p)) out[+p] = 1;
    else if(WD[p.slice(0, 3)] || (p.length === 2 && WD[p])) out[WD[p.slice(0, 3)] || WD[p]] = 1;
  });
  return Object.keys(out).map(Number).sort();
}
// Время «10:00», «9.30», «930», «9» → минуты от полуночи; пусто или мусор — null
function parseTime(v){
  var s = String(v == null ? '' : v).trim(), m;
  if(!s) return null;
  if((m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?$/)) || (m = s.match(/^(\d{1,2})(\d{2})$/))){
    var h = +m[1], mi = +(m[2] || 0);
    if(h <= 24 && mi < 60 && h * 60 + mi <= 1440) return h * 60 + mi;
  }
  return null;
}
function hhmm(min){ return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }

// Дни расписания от from до to включительно (YYYY-MM-DD), по возрастанию, без повторов
function days(rule, from, to){
  var set = {}, wds = parseWeekdays(rule.weekdays), ex = {};
  parseDates(rule.except).forEach(function(d){ ex[d] = 1; });
  (rule.exceptions || []).forEach(function(d){ d = parseDate(d); if(d) ex[d] = 1; });
  if(wds.length){
    var a = parseDate(rule.periodFrom) || from, b = parseDate(rule.periodTo) || numDay(dayNum(from) + HORIZON_DAYS);
    if(a < from) a = from;
    if(b > to) b = to;
    for(var n = dayNum(a), e = b ? dayNum(b) : n - 1; n <= e; n++){
      var d = numDay(n);
      if(wds.indexOf(weekdayOf(d)) >= 0) set[d] = 1;
    }
  }
  parseDates(rule.dates).forEach(function(d){ if(d >= from && d <= to) set[d] = 1; });
  return Object.keys(set).filter(function(d){ return !ex[d]; }).sort();
}
// Слоты одного дня: [{ time:'10:00', start:unix, end:unix }]
function slots(rule, day){
  var a = parseTime(rule.timeFrom), b = parseTime(rule.timeTo), step = Math.floor(+rule.step || 0);
  var bs = parseTime(rule.breakFrom), be = parseTime(rule.breakTo), out = [];
  if(a == null || b == null || step < 5 || b <= a) return out;
  var base = dayNum(day) * 86400 - MSK;
  for(var t = a; t + step <= b; t += step){
    if(bs != null && be != null && be > bs && t < be && t + step > bs) continue;   // слот задевает перерыв
    out.push({ time: hhmm(t), start: base + t * 60, end: base + (t + step) * 60 });
  }
  return out;
}
// Ключ слота — первое поле таблицы «Слот», уникальное: второй записи на тот же ключ ядро не даст
function slotKey(consId, day, time){ return consId + '|' + day + '|' + time; }
function today(nowTs){ return dayOf(nowTs == null ? Math.floor(Date.now() / 1000) : nowTs); }

var api = { days: days, slots: slots, slotKey: slotKey, today: today, dayOf: dayOf,
            parseDate: parseDate, parseDates: parseDates, parseWeekdays: parseWeekdays, parseTime: parseTime,
            addDays: function(day, n){ return numDay(dayNum(day) + n); }, HORIZON_DAYS: HORIZON_DAYS };
if(typeof module === 'object' && module && module.exports) module.exports = api;
else root.PoraSchedule = api;
})(this);
