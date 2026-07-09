'use strict';

/**
 * Демо-данные для графиков листа «Инвестор. Финансовые результаты».
 * Сезонность лагерного бизнеса: провал зимой, пик в июне–августе.
 * Все цифры вымышленные.
 */

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

// Выручка, млн ₽
const REVENUE = {
  2024: [9, 8, 11, 13, 18, 46, 62, 55, 16, 12, 10, 14],
  2025: [11, 10, 14, 17, 23, 58, 76, 68, 20, 15, 13, 18],
  '2026:План': [13, 12, 17, 20, 28, 70, 92, 82, 24, 18, 16, 22],
  // Демо-год показан завершённым: иначе Chart.js достраивает недостающие месяцы нулями
  '2026:Факт': [14, 11, 18, 21, 30, 74, 88, 79, 26, 19, 15, 21],
};

// Поступления денег отстают от выручки и чуть выше по объёму
const INFLOW = {
  2024: [10, 9, 12, 14, 20, 41, 58, 60, 22, 13, 11, 15],
  2025: [12, 11, 15, 18, 25, 52, 71, 73, 27, 16, 14, 19],
  '2026:План': [14, 13, 18, 22, 30, 63, 86, 88, 32, 19, 17, 23],
  '2026:Факт': [15, 12, 19, 23, 32, 67, 83, 85, 30, 20, 16, 22],
};

/** report/445106 — «Поступления ДС за 3 года» и «Выручка за 3 года». */
function threeYearSeries() {
  const rows = [];
  // Серия графика берётся из колонки «Год»: у прогноза это «2026 План» / «2026 Факт».
  const push = (year, group, month, sum, kind) => rows.push({
    'Год': group ? `${year} ${group}` : String(year),
    'Месяц': month,
    'Сумма, млн': Number(sum).toFixed(2),
    'Тип движения': kind,
    'Колонка группы': group,
    'Значение GS1': '1',
  });

  for (const [key, revenue] of Object.entries(REVENUE)) {
    const [year, group] = key.includes(':') ? key.split(':') : [key, ''];
    const inflow = INFLOW[key];
    revenue.forEach((v, i) => {
      push(year, group, MONTHS[i], v, 'выручка');
      push(year, group, MONTHS[i], inflow[i], 'поступление');
    });
  }
  return rows;
}

// Сегменты и их доля в выручке
const SEGMENTS = [
  { seg: 'b2c', row: '[Выручка]Выручка (ддл)', share: 0.52 },
  { seg: 'b2b', row: '[Выручка]Выручка (ддо - b2b)', share: 0.24 },
  { seg: 'b2g', row: '[Выручка]Выручка (ддо - b2g)', share: 0.14 },
  { seg: 'ОШ',  row: '[Выручка]Выручка (д.о.п)', share: 0.10 },
];

/** report/452608 — «Поступления за текущий год» (стековые бары по сегментам). */
function currentYearSegments() {
  const rows = [];
  const plan = REVENUE['2026:План'];
  const fact = REVENUE['2026:Факт'];

  // Панель «Поступления» фильтрует «Тип движения», поэтому отдаём оба вида:
  // выручку и поступление денег (последнее чуть выше).
  const KINDS = [['выручка', 1.0], ['поступление', 1.08]];

  MONTHS.forEach((m, i) => {
    for (const s of SEGMENTS) {
      for (const [kind, k] of KINDS) {
        rows.push({
          'Колонка группы': 'План',
          'Строка бюджета': s.row,
          'Сегмент': s.seg,
          'Тип движения': kind,
          'Сумма': (plan[i] * s.share * k).toFixed(2),
          'Значение GS': '1',
          'Месяц': m,
        });
        if (i < fact.length) {
          rows.push({
            'Колонка группы': 'Факт',
            'Строка бюджета': s.row,
            'Сегмент': s.seg,
            'Тип движения': kind,
            'Сумма': (fact[i] * s.share * k).toFixed(2),
            'Значение GS': '1',
            'Месяц': m,
          });
        }
      }
    }
  });
  return rows;
}

/** report/159287 — «Структура и динамика займов / кредитов». */
function loans() {
  const data = { 2022: [0, 12], 2023: [3, 18], 2024: [5, 26] };
  const rows = [];
  for (const [year, [short, long]] of Object.entries(data)) {
    rows.push({ 'год возникновения': year, 'долговые обязательства': String(short), 'вид обязательства': 'краткосрочные заемные средства' });
    rows.push({ 'год возникновения': year, 'долговые обязательства': String(long), 'вид обязательства': 'долгосрочные заемные средства' });
  }
  return rows;
}


// --- Лист «Инвестор. Структура капитала» ---

/** report/158715 — участники и доли. Все лица и компании вымышлены. */
function shareholders() {
  const rows = [
    ['Смирнов А. П.',           34.00, '11.08.2021', 7.30,  15,  167.30],
    ['ООО «Первый Капитал»',    28.50, '12.12.2023', 10.00, 25,  140.20],
    ['Фонд «Развитие»',         15.10, '29.05.2024', 12.50, 90,  74.30],
    ['Ковалёв Д. С.',           12.40, '18.12.2025', 40.00, 280, 61.00],
    ['Опционный пул',           10.00, '18.12.2025', 30.00, 280, 49.20],
  ];
  const valuation = 492;
  return rows.map(([name, share, since, costIn, valIn, costNow]) => ({
    'Дата изменения': '30.12.2025',
    'Участник': name,
    'Доля, %': share.toFixed(2),
    'Дата входа': since,
    'Стоимость доли на момент входа, млн р': costIn.toFixed(2),
    'Оценка бизнеса на момент входа, млн р': String(valIn),
    'Стоимость доли текущая, млн р': costNow.toFixed(2),
    'Оценка бизнеса текущая*, млн р': String(valuation),
    'Изменение, %': String(Math.round((costNow / costIn - 1) * 100)),
    'style': 'background-color:lightgreen',
  }));
}

/** report/158810 — оценка бизнеса по датам. */
function valuationHistory() {
  const points = [
    ['11.08.2021', 15.0], ['18.11.2022', 42.0], ['12.12.2023', 90.0],
    ['29.05.2024', 180.0], ['18.12.2025', 280.0], ['30.06.2026', 492.0],
  ];
  return points.map(([d, v]) => ({ 'Дата оценки компании': d, 'Оценка в млн руб': v.toFixed(2) }));
}

/**
 * Панели-графики запрашивают отчёт как `?JSON` и получают колоночную структуру
 * `{columns, data, header}`, где data[i] — все значения i-й колонки.
 * Здесь мы сохраняем настоящую структуру ответа и подменяем только данные.
 */
function asReport(realJson, rows) {
  let real = null;
  try { real = JSON.parse(realJson); } catch (_) { /* пусто */ }

  // Ответ в виде массива объектов (JSON_KV) — отдаём как есть.
  if (!real || Array.isArray(real) || !Array.isArray(real.columns)) return rows;

  const names = real.columns.map((c) => c.name);
  const data = names.map((name) => rows.map((r) => (r[name] === undefined ? '' : String(r[name]))));
  return { ...real, data };
}

module.exports = { threeYearSeries, currentYearSegments, loans, shareholders, valuationHistory, asReport, MONTHS };

