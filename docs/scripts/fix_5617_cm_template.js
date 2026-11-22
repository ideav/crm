#!/usr/bin/env node
// Правка схемы, отчётов и меню шаблона «Сопоставление каталогов» (cm) — issue #5617.
//
//   node docs/scripts/fix_5617_cm_template.js --db <база> --token <токен> [--base https://ideav.ru] [--apply]
//
// Без --apply печатает план «БЫЛО → СТАЛО» и ничего не пишет. Повторный запуск после применения
// печатает «нечего менять». Таблицы, поля, отчёты и роли ищутся по имени: id в базах разные.
//
// Что правится:
//   Д7  отчёты mass_match и «Сопоставление»: колонки таблицы «Бренд» и полей «Бренд» RFP/SKU
//       заставляют ядро соединять RFP и SKU через бренд, а не через общие токены, и SKU не
//       находится; вшитый фильтр «Значение (от)» колонки строки RFP — id из базы кейса.
//   Д4  у SKU «Бренд» — подчинённая таблица, колонкой файла не загружается: заводится ссылка
//       на справочник «Бренд», подчинённые таблицы «Бренд» у SKU и RFP снимаются.
//   дубли полей RFP/SKU с тем же именем и другим типом (MEMO-«Наименование», «Кандидаты»,
//       «Точность подбора»): снимаются, если на них нет колонок отчётов и в них нет значений.
//   Д9  меню: у admin — «Первичная настройка» и «Настройки сопоставления», у «Партнёра» —
//       «Загрузка», «Токенизация SKU», «Токенизация RFP».
'use strict';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const BASE = (opt('base') || 'https://ideav.ru').replace(/\/$/, '');
const DB = opt('db');
const TOKEN = opt('token');
const APPLY = args.includes('--apply');
if (!DB || !TOKEN) {
    console.error('Нужны --db и --token. Пример: node docs/scripts/fix_5617_cm_template.js --db pilot4823a --token … [--apply]');
    process.exit(2);
}

const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
const MEMO = '12';
let xsrf = '';

async function get(path) {
    const res = await fetch(`${BASE}/${DB}/${path}`, { headers: { 'X-Authorization': TOKEN } });
    const text = await res.text();
    if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status} ${text.slice(0, 200)}`);
    try { return JSON.parse(text); } catch (e) { throw new Error(`GET ${path}: не JSON: ${text.slice(0, 200)}`); }
}

async function post(path, fields) {
    const body = new URLSearchParams({ token: TOKEN, _xsrf: xsrf, ...fields });
    const res = await fetch(`${BASE}/${DB}/${path}`, {
        method: 'POST', headers: { 'X-Authorization': TOKEN, 'Content-Type': 'application/x-www-form-urlencoded' }, body
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* ответ не JSON — ниже ошибка */ }
    if (!res.ok || !json || json.error) throw new Error(`POST ${path}: ${text.slice(0, 300)}`);
    return json;
}

const rows = json => (Array.isArray(json) ? json : []).map(x => ({ id: String(x.i), up: String(x.u), r: x.r || [] }));
const plan = [];
function step(what, before, after, run) { plan.push({ what, before, after, run }); }

async function main() {
    xsrf = (await get('xsrf?JSON'))._xsrf || '';
    const meta = await get('metadata?JSON=1');
    const table = name => meta.find(t => norm(t.val) === norm(name));
    const SKU = table('SKU'), RFP = table('RFP'), BRAND = table('Бренд');
    if (!SKU || !RFP || !BRAND) throw new Error('В базе нет таблиц SKU, RFP и «Бренд» — это не шаблон cm.');
    const brandId = String(BRAND.id);
    const isSubBrand = r => String(r.arr_id || '') === brandId && !r.ref;
    const isRefBrand = r => String(r.ref || '') === brandId || String(r.ref_id || '') === brandId && !!r.ref;

    // Колонки всех отчётов: [{ id, report, source, name, from }]
    const reports = rows(await get('object/22/?JSON_OBJ&LIMIT=0,500'));
    const reportByName = name => reports.find(q => norm(q.r[0]) === norm(name));
    const columns = [];
    for (const q of reports) {
        for (const c of rows(await get(`object/28/?JSON_OBJ&F_U=${q.id}&LIMIT=0,500`))) {
            columns.push({ id: c.id, report: q.r[0], source: String(c.r[0]).split(':')[0], label: c.r[0], name: c.r[1], from: c.r[3] });
        }
    }
    const usedReqs = new Set(columns.map(c => c.source));

    // --- Д7: отчёты подбора --------------------------------------------------------------
    const brandReqIds = new Set([...SKU.reqs, ...RFP.reqs].filter(r => isSubBrand(r) || isRefBrand(r)).map(r => String(r.id)));
    for (const reportName of ['mass_match', 'Сопоставление']) {
        const q = reportByName(reportName);
        if (!q) { console.log(`отчёта «${reportName}» нет — пропуск`); continue; }
        for (const c of columns.filter(c => c.report === q.r[0])) {
            if (c.source === brandId || brandReqIds.has(c.source)) {
                step(`${reportName}: колонка «${c.name}» (${c.label})`, 'есть', 'удалена', () => post(`_m_del/${c.id}?JSON=1`, {}));
                usedReqs.delete(c.source);
            } else if (String(c.from || '').trim() !== '' && c.source === String(RFP.id)) {
                step(`${reportName}: колонка «${c.name}», «Значение (от)»`, String(c.from), '(пусто)', () => post(`_m_set/${c.id}?JSON=1`, { t102: '' }));
            }
        }
    }
    // колонки, оставшиеся на полях после удаления выше
    for (const c of columns) if (!plan.some(p => p.what.includes(`(${c.label})`))) usedReqs.add(c.source);

    // --- дубли полей и подчинённые таблицы «Бренд» ---------------------------------------
    for (const T of [SKU, RFP]) {
        const byName = {};
        for (const r of T.reqs) (byName[norm(r.val)] = byName[norm(r.val)] || []).push(r);
        for (const r of T.reqs) {
            const twins = byName[norm(r.val)].filter(x => x !== r);
            const dupMemo = twins.length && String(r.type) === MEMO && twins.some(x => String(x.type) !== MEMO);
            const dupNum = twins.length && norm(r.val) === norm('Точность подбора') && String(r.type) === '13' && twins.some(x => String(x.type) !== '13');
            const sub = isSubBrand(r);
            if (!dupMemo && !dupNum && !sub) continue;
            const id = String(r.id);
            if (usedReqs.has(id)) { console.log(`ВНИМАНИЕ: ${T.val}.«${r.val}» (${id}) — на него есть колонки отчётов, не трогаю`); continue; }
            if (!sub) {
                const filled = rows(await get(`object/${T.id}/?JSON_OBJ&F_${id}=%25&LIMIT=0,1`)).length;
                if (filled) { console.log(`ВНИМАНИЕ: ${T.val}.«${r.val}» (${id}) — есть значения, не трогаю`); continue; }
            }
            step(`${T.val}: поле «${r.val}» (${id}, ${sub ? 'подчинённая таблица' : 'тип ' + r.type})`, 'есть', 'удалено',
                () => post(`_d_del_req/${id}?JSON=1`, { forced: 1 }));
        }
    }

    // --- Д4: ссылка SKU → «Бренд» ---------------------------------------------------------
    if (!SKU.reqs.some(isRefBrand)) {
        step('SKU: поле «Бренд» — ссылка на справочник «Бренд»', 'нет', 'есть', async () => {
            const ref = await post(`_d_ref/${brandId}?JSON=1`, {});
            return post(`_d_req/${SKU.id}?JSON=1`, { t: String(ref.obj) });
        });
    }

    // --- Д9: меню -------------------------------------------------------------------------
    const roles = rows(await get('object/42/?JSON_OBJ&LIMIT=0,100'));
    const role = name => roles.find(x => norm(x.r[0]) === norm(name));
    const menusOf = async up => rows(await get(`object/151/?JSON_OBJ&F_U=${up}&LIMIT=0,200`));
    const tokSku = reportByName('Токенизация SKU'), tokRfp = reportByName('Токенизация RFP');
    const wanted = [
        { role: 'admin', group: 'XCOM', items: [['Первичная настройка', 'wizard'], ['Настройки сопоставления', 'settings']] },
        { role: 'Партнёр', items: [['Загрузка', 'upload']]
            .concat(tokSku ? [['Токенизация SKU', 'report/' + tokSku.id]] : [])
            .concat(tokRfp ? [['Токенизация RFP', 'report/' + tokRfp.id]] : []) }
    ];
    for (const w of wanted) {
        const r = role(w.role);
        if (!r) { console.log(`роли «${w.role}» нет — меню пропущено`); continue; }
        let up = r.id;
        if (w.group) {
            const g = (await menusOf(r.id)).find(m => norm(m.r[0]) === norm(w.group));
            if (g) up = g.id;
        }
        const existing = await menusOf(up);
        for (const [title, action] of w.items) {
            if (existing.some(m => norm(m.r[1]) === norm(action))) continue;
            step(`меню ${w.role}${w.group ? ' / ' + w.group : ''}: «${title}» → ${action}`, 'нет', 'есть',
                () => post(`_m_new/151?JSON=1&up=${up}`, { t151: title, t153: action }));
        }
    }

    // --- вывод и применение ----------------------------------------------------------------
    if (!plan.length) { console.log(`${DB}: нечего менять`); return; }
    console.log(`${DB}: ${plan.length} правок${APPLY ? '' : ' (dry-run, для записи --apply)'}`);
    for (const p of plan) {
        console.log(`  ${p.what}: БЫЛО ${p.before} → СТАЛО ${p.after}`);
        if (APPLY) await p.run();
    }
    if (APPLY) console.log('Применено. Повторный запуск без --apply должен ответить «нечего менять».');
}

main().catch(error => { console.error(error.message || error); process.exit(1); });
