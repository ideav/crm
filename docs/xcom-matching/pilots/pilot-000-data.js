// Генератор обезличенной пары каталогов для пилота #4823: электротехника.
// SKU — каталог поставщика (партнёра), RFP — заявка клиента с «живыми» вариантами написания.
const XLSX = require('xlsx');
const path = require('path');
const out = process.argv[2] || '.';
let seed = 4823;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd() * a.length)];

const sku = [];
let code = 100200;
const add = (name, brand, art, unit, price, kind) => sku.push({ code: 'ЭТ-' + (code++), name, brand, art, unit, price, kind });

// Кабель
const cableTypes = ['ВВГнг(А)-LS', 'ВВГнг(А)', 'ВВГ-Пнг(А)', 'NYM'];
const cores = [2, 3, 4, 5];
const sections = ['1,5', '2,5', '4', '6', '10'];
for (const t of cableTypes) for (const c of cores) for (const s of sections) {
  if (t === 'NYM' && c === 2) continue;
  add(`Кабель ${t} ${c}x${s} ок(N)-0,66 кВ`, pick(['Кольчугино', 'Севкабель', 'Конкорд']), '', 'м', 30 + c * Number(s.replace(',', '.')) * 9, 'cable');
}
// Автоматы
const series = [['IEK', 'ВА47-29', 'MVA20'], ['EKF', 'ВА 47-63', 'mcb4763'], ['Schneider Electric', 'Easy9', 'EZ9F34']];
for (const [b, ser, pre] of series) for (const p of [1, 2, 3]) for (const a of [6, 10, 16, 20, 25, 32, 40, 50]) for (const ch of ['B', 'C']) {
  add(`Выключатель автоматический ${ser} ${p}P ${a}А характеристика ${ch}`, b, `${pre}-${p}-${String(a).padStart(3, '0')}-${ch}`, 'шт', 180 + p * 140 + a * 3, 'mcb');
}
// УЗО / дифавтоматы
for (const [b, ser, pre] of [['IEK', 'ВД1-63', 'MDV10'], ['EKF', 'ВД-100', 'elcb']]) for (const p of [2, 4]) for (const a of [16, 25, 40, 63]) for (const ma of [30, 100]) {
  add(`Выключатель дифференциального тока (УЗО) ${ser} ${p}P ${a}А ${ma}мА тип AC`, b, `${pre}-${p}-${String(a).padStart(3, '0')}-${ma}`, 'шт', 900 + p * 300 + a * 8, 'rcd');
}
// Розетки/выключатели
for (const [b, ser] of [['Schneider Electric', 'Glossa'], ['Legrand', 'Valena'], ['Werkel', 'Atlas']]) for (const col of ['белый', 'бежевый', 'антрацит']) {
  add(`Розетка с заземлением ${ser} 16А 250В механизм ${col}`, b, '', 'шт', 250, 'socket');
  add(`Выключатель одноклавишный ${ser} 10А механизм ${col}`, b, '', 'шт', 210, 'switch');
  add(`Выключатель двухклавишный ${ser} 10А механизм ${col}`, b, '', 'шт', 290, 'switch');
}
// Лампы и светильники
for (const b of ['Gauss', 'Osram', 'ЭРА']) for (const w of [7, 9, 11, 13, 15]) for (const k of [3000, 4000, 6500]) for (const base of ['E27', 'E14']) {
  add(`Лампа светодиодная A60 ${w}Вт ${k}К ${base} 230В`, b, '', 'шт', 60 + w * 9, 'lamp');
}
for (const b of ['Gauss', 'IEK']) for (const w of [18, 36, 40]) {
  add(`Светильник светодиодный ДПО ${w}Вт 4000К IP40 595x595 офисный`, b, '', 'шт', 900 + w * 20, 'panel');
}
// Гофра, кабель-канал
for (const d of [16, 20, 25, 32]) {
  add(`Труба гофрированная ПВХ d${d} мм с зондом серая (бухта 100м)`, pick(['DKC', 'IEK', 'Ruvinil']), '', 'м', 9 + d, 'tube');
  add(`Труба гофрированная ПНД d${d} мм с зондом черная (бухта 50м)`, pick(['DKC', 'IEK']), '', 'м', 12 + d, 'tube');
}
for (const s of ['15x10', '20x10', '25x16', '40x25', '60x40']) add(`Кабель-канал ${s} мм белый (2м)`, pick(['DKC', 'IEK', 'Ecoplast']), '', 'шт', 40, 'duct');

// RFP: берём часть SKU и пишем «как клиент»
const variants = {
  cable: s => s.name.replace('Кабель ', pick(['Кабель силовой ', 'Кабель ', 'Провод '])).replace(/x/, pick(['х', '*', 'x', 'х'])).replace(/ ок\(N\)-0,66 кВ/, pick(['', ' 0,66кВ', ''])).replace('(А)', pick(['(А)', '', 'А'])),
  mcb: s => pick([
    s.name.replace('Выключатель автоматический', 'Автоматический выключатель').replace(' характеристика ', ' ').replace('P', pick(['P', 'П', 'Р'])),
    `Автомат ${s.name.match(/(\d)P/)[1]}п ${s.name.match(/(\d+)А/)[1]}А ${s.name.slice(-1)} ${s.brand}`,
    `Авт. выкл. ${s.brand} ${s.name.match(/(ВА ?47-\d+|Easy9)/)[1]} ${s.name.match(/(\d)P/)[1]}P ${s.name.match(/(\d+)А/)[1]}A хар-ка ${s.name.slice(-1)}`]),
  rcd: s => s.name.replace('Выключатель дифференциального тока (УЗО)', pick(['УЗО', 'Выключатель диф. тока', 'УЗО'])).replace(' тип AC', pick(['', ' AC', ' тип АС'])),
  socket: s => pick([s.name.replace('с заземлением', 'с з/к'), `Розетка ${s.name.split(' ')[3]} с заземлением ${s.name.split(' ').pop()}`]),
  switch: s => s.name.replace(' механизм', '').replace('одноклавишный', pick(['1-клавишный', 'одноклавишный', '1кл.'])).replace('двухклавишный', pick(['2-клавишный', 'двухклавишный', '2кл.'])),
  lamp: s => pick([s.name, s.name.replace('Лампа светодиодная', 'Лампа LED').replace('Вт', 'W').replace('К ', 'K '), s.name.replace(' 230В', '').replace('A60 ', '')]),
  panel: s => pick([`Светильник LED 595*595 ${s.name.match(/(\d+)Вт/)[1]}Вт 4000К`, s.name.replace(' офисный', ' (Армстронг)')]),
  tube: s => s.name.replace(/ \(бухта \d+м\)/, '').replace('Труба гофрированная', pick(['Гофротруба', 'Труба гофр.', 'Гофра'])),
  duct: s => s.name.replace(' (2м)', '').replace('Кабель-канал', pick(['Кабель-канал', 'Кабельный канал', 'Короб'])),
};
const rfp = [];
const used = new Set();
const quota = { cable: 12, mcb: 12, rcd: 5, socket: 4, switch: 4, lamp: 6, panel: 2, tube: 3, duct: 2 };
for (const [kind, n] of Object.entries(quota)) {
  const pool = sku.filter(s => s.kind === kind);
  for (let i = 0; i < n; i++) {
    let s; do { s = pick(pool); } while (used.has(s.code));
    used.add(s.code);
    const brandCol = kind === 'mcb' && rnd() < 0.5 ? s.brand : (rnd() < 0.3 ? s.brand : '');
    rfp.push({ name: variants[kind](s), brand: brandCol, qty: Math.ceil(rnd() * 20) * (s.unit === 'м' ? 50 : 1), unit: s.unit, truth: s.code });
  }
}
// Позиции, которых в каталоге нет
for (const n of ['Щит распределительный ЩРН-24 IP31 навесной', 'Стабилизатор напряжения 10 кВт однофазный', 'Клеммы WAGO 221-413 (упак. 50 шт)']) rfp.push({ name: n, brand: '', qty: 2, unit: 'шт', truth: '' });
rfp.sort(() => rnd() - 0.5);

const skuRows = [['Код', 'Номенклатура', 'Производитель', 'Артикул', 'Ед. изм.', 'Цена, руб.']].concat(sku.map(s => [s.code, s.name, s.brand, s.art, s.unit, Math.round(s.price)]));
const rfpRows = [['Заявка на поставку электротоваров (обезличено)'], [], ['№ п/п', 'Наименование товара', 'Производитель', 'Кол-во', 'Ед.']].concat(rfp.map((r, i) => [i + 1, r.name, r.brand, r.qty, r.unit]));
const w = (rows, file, sheet) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet); XLSX.writeFile(wb, path.join(out, file)); };
w(skuRows, 'sku-elektro.xlsx', 'Прайс');
w(rfpRows, 'rfp-zayavka.xlsx', 'Заявка');
require('fs').writeFileSync(path.join(out, 'truth.json'), JSON.stringify(rfp.map((r, i) => ({ n: i + 1, name: r.name, truth: r.truth })), null, 1));
console.log('SKU', sku.length, 'RFP', rfp.length);
