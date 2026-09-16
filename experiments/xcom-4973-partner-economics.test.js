// #4973 — деньги партнёрского предложения «Сопоставление каталогов».
//
// ЗАЧЕМ. Одни и те же цифры названы в пяти документах: прайс сервиса, документ решений §7,
// презентация партнёру (markdown и слайды) и гайд внедренца. Партнёр читает их вразнобой —
// сначала слайд на встрече, потом гайд, потом прайс. Расхождение в ставке или в сумме выплаты
// обнаруживается на переговорах о деньгах, то есть в худшей возможной точке.
//
// ЧТО ПРОВЕРЯЕТСЯ. Не написание текста, а арифметика прайса и согласованность чисел:
//   1) в таблице тарифов партнёрская цена = публичная − 30%, годовая = 12 месяцев − 20%;
//   2) в таблице партнёрской экономики выплата = база × ставку;
//   3) цена локальной лицензии равна опубликованной цене платформы;
//   4) ни в одном из документов пакета нет денежной суммы или ставки, которой нет в прайсе.
// Проверка 4 ловит ровно тот класс ошибки, ради которого тест написан: правку числа в одном
// документе без правки остальных.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// Цена локальной лицензии — общая для платформы и для сервиса (решение автора 16.09.2026).
// Опубликованный прайс платформы: ideav/backlogram, src/data/services.mjs, услуга `license`.
const PLATFORM_LICENCE = 590000;
// Опубликованные облачные тарифы Интеграма: их можно называть в документах как ориентир.
const PLATFORM_CLOUD = [0, 1950, 4900];

const PRICING = 'docs/xcom-matching/pricing.md';
const DOCS = [
    PRICING,
    'docs/partner-template-4816-decisions.md',
    'docs/xcom-matching/deck-partner.md',
    'docs/xcom-matching/guide-integrator.md',
];
const SLIDES = 'docs/xcom-matching/slides/deck-partner.html';

let checks = 0;
const failures = [];

function check(ok, message) {
    checks += 1;
    if (!ok) failures.push(message);
}

function equal(actual, expected, message) {
    check(actual === expected, message + ' — ожидалось ' + expected + ', получено ' + actual);
}

function read(rel) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return null;
    return fs.readFileSync(abs, 'utf8').replace(/ /g, ' ');
}

// «9 900 ₽/мес» → 9900; «—» → null.
function money(cell) {
    const m = String(cell).match(/(\d[\d ]*)\s*₽/);
    return m ? parseInt(m[1].replace(/ /g, ''), 10) : null;
}

function percent(cell) {
    const m = String(cell).match(/(\d{1,3})\s*%/);
    return m ? parseInt(m[1], 10) : null;
}

function moneyAll(plain) {
    return (plain.match(/\d[\d ]*\s*₽/g) || []).map(function (s) {
        return parseInt(s.replace(/[^\d ]/g, '').replace(/ /g, ''), 10);
    });
}

function percentAll(plain) {
    return (plain.match(/\d{1,3}\s*%/g) || []).map(function (s) { return parseInt(s, 10); });
}

// Таблицы markdown документа: блок подряд идущих строк, начинающихся с «|». Разрыв блока
// обязателен — иначе две соседние таблицы с одинаковым числом колонок слиплись бы в одну.
function tables(doc) {
    const out = [];
    let block = null;
    doc.split('\n').forEach(function (line) {
        if (line.trim().indexOf('|') === 0) {
            if (!block) { block = []; out.push(block); }
            block.push(line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')
                .map(function (c) { return c.trim(); }));
        } else {
            block = null;
        }
    });
    return out;
}

// Таблица, у которой в заголовке есть все переданные слова.
function table(doc, headerWords) {
    const found = tables(doc).find(function (block) {
        const head = block[0].join(' ').toLowerCase();
        return headerWords.every(function (w) { return head.indexOf(w.toLowerCase()) !== -1; });
    });
    if (!found) return null;
    return {
        head: found[0],
        rows: found.slice(1).filter(function (cells) { return !/^:?-{2,}:?$/.test(cells[0]); }),
    };
}

function column(head, word) {
    return head.findIndex(function (cell) { return cell.toLowerCase().indexOf(word.toLowerCase()) !== -1; });
}

const pricing = read(PRICING);
check(pricing !== null, PRICING + ' — прайс сервиса отсутствует, цифры партнёру брать неоткуда');

const allowedMoney = new Set(PLATFORM_CLOUD.concat([PLATFORM_LICENCE]));
const allowedPercent = new Set();

if (pricing) {
    // 1. Тарифы облака: партнёрская цена и годовая складываются из публичной, а не назначаются отдельно.
    const tariffs = table(pricing, ['тариф', 'публичная цена']);
    check(tariffs !== null, PRICING + ' — нет таблицы тарифов с колонкой «Публичная цена»');
    if (tariffs) {
        const cMonth = column(tariffs.head, 'публичная цена');
        const cYear = column(tariffs.head, 'год');
        const cPartner = column(tariffs.head, 'партнёр');
        check(cYear !== -1 && cPartner !== -1, PRICING + ' — в таблице тарифов нет колонок года и партнёрской цены');
        const yearOff = percent(tariffs.head[cYear]);
        const partnerOff = percent(tariffs.head[cPartner]);
        equal(partnerOff, 30, PRICING + ' — партнёрская скидка на облако (Решение 1 §7)');
        equal(yearOff, 20, PRICING + ' — скидка за годовую оплату');
        if (yearOff) allowedPercent.add(yearOff);
        if (partnerOff) allowedPercent.add(partnerOff);
        check(tariffs.rows.length >= 3, PRICING + ' — тарифная сетка короче трёх строк');
        tariffs.rows.forEach(function (cells) {
            const name = cells[0];
            const month = money(cells[cMonth]);
            const year = money(cells[cYear]);
            const partner = money(cells[cPartner]);
            if (month === null || month === 0) {
                equal(year, null, PRICING + ', «' + name + '» — у бесплатного тарифа не бывает годовой цены');
                equal(partner, null, PRICING + ', «' + name + '» — у бесплатного тарифа не бывает партнёрской цены');
                allowedMoney.add(0);
                return;
            }
            allowedMoney.add(month);
            equal(partner, month * (100 - partnerOff) / 100,
                PRICING + ', «' + name + '» — партнёрская цена = публичная минус ' + partnerOff + '%');
            equal(year, month * 12 * (100 - yearOff) / 100,
                PRICING + ', «' + name + '» — годовая цена = 12 месяцев минус ' + yearOff + '%');
            if (partner !== null) allowedMoney.add(partner);
            if (year !== null) allowedMoney.add(year);
            if (partner !== null) allowedMoney.add(month - partner); // маржа партнёра в месяц
        });
    }

    // 2. Партнёрская экономика: выплата считается из базы и ставки, а не пишется от руки.
    const payouts = table(pricing, ['комиссия', 'партнёру']);
    check(payouts !== null, PRICING + ' — нет таблицы партнёрской экономики с колонками «Комиссия» и «Партнёру»');
    if (payouts) {
        const cBase = column(payouts.head, 'база');
        const cRate = column(payouts.head, 'комиссия');
        const cPay = column(payouts.head, 'партнёру');
        check(cBase !== -1, PRICING + ' — в таблице партнёрской экономики нет колонки «База»');
        let licenceSeen = false;
        payouts.rows.forEach(function (cells) {
            const what = cells[0];
            const base = money(cells[cBase]);
            const rate = percent(cells[cRate]);
            const pay = money(cells[cPay]);
            check(base !== null && rate !== null && pay !== null,
                PRICING + ', «' + what + '» — строка партнёрской экономики заполнена не полностью');
            if (base === null || rate === null || pay === null) return;
            allowedPercent.add(rate);
            allowedMoney.add(base);
            allowedMoney.add(pay);
            equal(pay, base * rate / 100, PRICING + ', «' + what + '» — выплата партнёру = ' + rate + '% от базы');
            if (what.toLowerCase().indexOf('лиценз') !== -1) {
                licenceSeen = true;
                equal(base, PLATFORM_LICENCE, PRICING + ' — цена локальной лицензии в сервисе равна цене платформы');
                equal(rate, 40, PRICING + ' — агентская комиссия с продажи локальной лицензии (решение автора 16.09.2026)');
            }
        });
        check(licenceSeen, PRICING + ' — в партнёрской экономике нет строки про локальную лицензию');
    }

    // Цены конкурентов приведены в прайсе как ориентир и живут по своим правилам — они чужие,
    // арифметике нашей сетки не подчиняются, но и «числом мимо прайса» считаться не должны.
    const market = table(pricing, ['решение', 'цена']);
    if (market) {
        market.rows.forEach(function (cells) {
            moneyAll(cells.join(' ')).forEach(function (v) { allowedMoney.add(v); });
        });
    }
}

// 3. Ни одного числа мимо прайса: любая сумма и любая ставка в пакете документов взяты из него.
DOCS.forEach(function (rel) {
    const doc = read(rel);
    check(doc !== null, rel + ' — документ пакета отсутствует');
    if (!doc) return;
    const strayMoney = moneyAll(doc).filter(function (v) { return !allowedMoney.has(v); });
    equal(strayMoney.length, 0, rel + ' — суммы, которых нет в прайсе: ' + strayMoney.join(', '));
    const strayPercent = percentAll(doc).filter(function (v) { return !allowedPercent.has(v); });
    equal(strayPercent.length, 0, rel + ' — ставки, которых нет в прайсе: ' + strayPercent.join(', '));
});

// Слайды — HTML целиком содержит проценты вёрстки, поэтому берём только слайд «Экономика».
const slides = read(SLIDES);
check(slides !== null, SLIDES + ' — слайды партнёра отсутствуют');
if (slides) {
    const section = slides.match(/<section[^>]*data-eyebrow="Экономика"[\s\S]*?<\/section>/);
    check(section !== null, SLIDES + ' — нет слайда «Экономика»');
    if (section) {
        const plain = section[0].replace(/<[^>]+>/g, ' ');
        const strayMoney = moneyAll(plain).filter(function (v) { return !allowedMoney.has(v); });
        equal(strayMoney.length, 0, SLIDES + ' — на слайде «Экономика» суммы мимо прайса: ' + strayMoney.join(', '));
        const strayPercent = percentAll(plain).filter(function (v) { return !allowedPercent.has(v); });
        equal(strayPercent.length, 0, SLIDES + ' — на слайде «Экономика» ставки мимо прайса: ' + strayPercent.join(', '));
        const rates = percentAll(plain);
        check(rates.indexOf(40) !== -1, SLIDES + ' — слайд «Экономика» не называет агентскую комиссию 40%');
        check(rates.indexOf(30) !== -1, SLIDES + ' — слайд «Экономика» не называет скидку на облако 30%');
    }
}

if (failures.length) {
    console.error('FAIL: xcom-4973-partner-economics (' + failures.length + ' из ' + checks + ')');
    failures.forEach(function (f) { console.error('  • ' + f); });
    process.exit(1);
}
console.log('OK: xcom-4973-partner-economics — ' + checks + ' проверок');
