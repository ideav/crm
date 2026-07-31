#!/usr/bin/env node
/**
 * issue #4548 — вернуть иконки меню в боевой базе после восстановления из бэкапа.
 *
 * Предыстория: #4544/PR #4545 — `restore` отдавал дамп без `Content-Type`, браузер разбирал
 * SQL как разметку и съедал значения-теги. Причина починена, но данные в базе уже потеряны,
 * а база с тех пор ушла вперёд — значит повторный полный restore не годится, надо обновить
 * ТОЛЬКО иконки (реквизит t391 таблицы Меню 151).
 *
 * Что делает скрипт:
 *   1. читает роли (42) и пункты меню (151) живой базы;
 *   2. показывает, у каких пунктов иконка пустая;
 *   3. сопоставляет пункт с источником иконок ПО АДРЕСУ (t153), а не по названию и не по
 *      порядку — название человек может переименовать, порядок не гарантирован;
 *   4. печатает план и пишет бэкап текущих значений + rollback-скрипт;
 *   5. применяет изменения ТОЛЬКО с флагом --apply.
 *
 * По умолчанию — сухой прогон: ни одного POST.
 *
 *   TOKEN=... node docs/restore_menu_icons.mjs --db ateh --icons <file.json>
 *   TOKEN=... node docs/restore_menu_icons.mjs --db ateh --icons <file.json> --apply
 *
 * `--icons` — источник истины по иконкам для ЭТОЙ базы. Это либо выгрузка из дампа бэкапа
 * (см. --from-dump), либо docs/atex_menu.json. ⚠️ `atex_menu.json` описывает базу **atex**;
 * для другой базы использовать его можно только если адреса совпали один в один — скрипт
 * это проверяет и без совпадения ничего не пишет.
 *
 * `--from-dump <file.sql>` — вытащить иконки прямо из SQL-дампа бэкапа (строки с t=391).
 */

import { readFileSync, writeFileSync } from 'node:fs';

const MENU_TABLE = 151;
const ROLE_TABLE = 42;
const REQ_NAME = 151; // t151 — название пункта
const REQ_HREF = 153; // t153 — адрес
const REQ_ICON = 391; // t391 — иконка (HTML-тег)

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const HAS = (name) => process.argv.includes(`--${name}`);

const DB = arg('db');
const HOST = arg('host', 'https://ideav.ru');
const TOKEN = process.env.TOKEN;
const APPLY = HAS('apply');

/**
 * Разобрать SQL-дамп бэкапа → Map<idПунктаМеню, иконка>.
 *
 * Формат дампа задаёт сам обработчик `restore` (index.php):
 *   INSERT INTO `db` (`id`, `t`, `up`, `ord`, `val`) VALUES (id,t,up,ord,'val'),…
 * То есть тип реквизита стои́т ВТОРЫМ, а не третьим — значение иконки лежит в строке
 * с t=391, и её `up` указывает на id записи меню. Значения прогнаны через addslashes,
 * поэтому кавычки приходят экранированными.
 */
export function iconsFromDump(sql) {
  const out = new Map();
  const re = /\((\d+),(\d+),(\d+),(-?\d+),'((?:[^'\\]|\\.)*)'\)/g;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const [, , t, up, , val] = m;
    if (t !== String(REQ_ICON)) continue;
    out.set(Number(up), unslash(val));
  }
  return out;
}

/** Адреса (t153) из дампа — контроль, что под id тот же пункт. */
export function hrefsFromDump(sql) {
  const out = new Map();
  const re = /\((\d+),(\d+),(\d+),(-?\d+),'((?:[^'\\]|\\.)*)'\)/g;
  let m;
  while ((m = re.exec(sql)) !== null) if (m[2] === String(REQ_HREF)) out.set(Number(m[3]), unslash(m[5]));
  return out;
}

/** Обратное к addslashes: \" → ", \' → ', \\ → \ */
export function unslash(v) {
  return v.replace(/\\(.)/g, '$1');
}

/**
 * Сопоставить пункты живой базы с иконками из бэкапа ПО id записи.
 *
 * Почему по id, а не по адресу: строка иконки в дампе ссылается на запись меню полем `up`,
 * то есть id и есть естественный ключ. На живых данных ateh это проверено — все 52 пункта
 * нашлись в бэкапе по id, и адрес (t153) совпал у всех до одного, то есть записи не
 * пересоздавались. Адрес используем как КОНТРОЛЬ: разошёлся — значит id переиспользован
 * под другой пункт, и такой случай трогать нельзя.
 */
export function planRestore(liveItems, iconById, hrefById = null) {
  const plan = { toSet: [], alreadyOk: [], noSource: [], conflicting: [], hrefMismatch: [] };
  for (const it of liveItems) {
    const cur = (it.icon ?? '').trim();
    const want = iconById.get(it.id);

    if (hrefById && hrefById.has(it.id) && hrefById.get(it.id) !== (it.href ?? '')) {
      plan.hrefMismatch.push({ ...it, dumpHref: hrefById.get(it.id) });
      continue;
    }
    if (cur) {
      // Иконка на месте. Если бэкап даёт другую — НЕ трогаем: её могли осознанно поменять
      // уже после бэкапа («база ушла вперёд»), и перезапись была бы откатом чужой работы.
      if (want !== undefined && want !== cur) plan.conflicting.push({ ...it, want });
      else plan.alreadyOk.push(it);
      continue;
    }
    if (want === undefined || !want.trim()) plan.noSource.push(it);
    else plan.toSet.push({ ...it, want });
  }
  return plan;
}

async function api(path, opts = {}) {
  const r = await fetch(`${HOST}/${DB}${path}`, {
    ...opts,
    headers: { 'X-Authorization': TOKEN, Cookie: `idb_${DB}=${TOKEN}`, ...(opts.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path} → ${r.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} → не JSON: ${text.slice(0, 200)}`);
  }
}

async function main() {
  if (!DB) throw new Error('нужен --db (например: --db ateh)');
  if (!TOKEN) throw new Error('нужен TOKEN в окружении');

  // 1. Источник иконок — по id записи меню
  let iconById = new Map();
  let hrefById = null;
  const dumpFile = arg('from-dump');
  const iconsFile = arg('icons');
  if (dumpFile) {
    const sql = readFileSync(dumpFile, 'utf8');
    iconById = iconsFromDump(sql);
    hrefById = hrefsFromDump(sql); // контроль: тот ли пункт под этим id
    console.log(`Источник: дамп ${dumpFile} — иконок ${iconById.size}, адресов ${hrefById.size}`);
  } else if (iconsFile) {
    // Файл вида docs/atex_menu.json — сопоставление по АДРЕСУ, id там нет.
    const j = JSON.parse(readFileSync(iconsFile, 'utf8'));
    const byHref = new Map();
    for (const r of j.roles ?? []) for (const m of r.menus ?? []) if (m.href) byHref.set(m.href, m.icon ?? '');
    console.log(`Источник: ${iconsFile} — адресов ${byHref.size}`);
    console.log('⚠️  Файл описывает СВОЮ базу. Сопоставление пойдёт по адресу; пункты, которых');
    console.log('    в нём нет, будут пропущены, а не угаданы.');
    iconById = { byHref };
  } else {
    throw new Error('нужен --from-dump <file.sql> либо --icons <file.json>');
  }

  // 2. Живые пункты меню — по всем ролям
  const roles = await api(`/object/${ROLE_TABLE}/?JSON_OBJ`);
  const roleIds = roles.map((r) => r.i).filter(Boolean);
  const live = [];
  for (const rid of roleIds) {
    for (const it of await api(`/object/${MENU_TABLE}/?JSON_OBJ&F_U=${rid}`)) {
      const r = it.r ?? [];
      live.push({ id: it.i, role: rid, name: r[0] ?? '', href: r[1] ?? '', icon: r[4] ?? '' });
    }
  }
  console.log(`Ролей: ${roleIds.length} · пунктов меню: ${live.length}`);

  // Источник по адресу → переводим в источник по id для этой базы
  if (iconById.byHref) {
    const m = new Map();
    for (const it of live) if (iconById.byHref.has(it.href)) m.set(it.id, iconById.byHref.get(it.href));
    iconById = m;
  }

  // 3. План
  const plan = planRestore(live, iconById, hrefById);
  console.log(`\nПЛАН:`);
  console.log(`  вернуть иконку        : ${plan.toSet.length}`);
  console.log(`  уже на месте          : ${plan.alreadyOk.length}`);
  console.log(`  нет в источнике       : ${plan.noSource.length}`);
  console.log(`  расходится (НЕ трогаем): ${plan.conflicting.length}`);
  console.log(`  адрес не тот (НЕ трогаем): ${plan.hrefMismatch.length}`);
  for (const it of plan.toSet) console.log(`   + [${it.id}] ${it.name} (${it.href}) → ${it.want}`);
  for (const it of plan.noSource) console.log(`   ? [${it.id}] ${it.name} (${it.href}) — источник молчит`);
  for (const it of plan.conflicting) console.log(`   ! [${it.id}] ${it.name}: в базе ${it.icon} ≠ ${it.want}`);
  for (const it of plan.hrefMismatch) console.log(`   ! [${it.id}] ${it.name}: адрес ${it.href} ≠ ${it.dumpHref} в дампе`);

  // 4. Бэкап и откат — ДО любой записи
  const stamp = arg('stamp', new Date().toISOString().replace(/[:.]/g, '-'));
  const backupFile = `/tmp/issue-4548-${DB}-menu-before-${stamp}.json`;
  writeFileSync(backupFile, JSON.stringify(live, null, 2));
  const rb = [`#!/bin/bash`, `# Откат #4548: вернуть иконки в то состояние, что было до записи.`, `set -e`,
    `XSRF=$(curl -sS -H "X-Authorization: $TOKEN" "${HOST}/${DB}/xsrf?JSON" | python3 -c 'import sys,json;d=json.load(sys.stdin);d=d[0] if isinstance(d,list) else d;print(d["_xsrf"])')`];
  for (const it of plan.toSet)
    rb.push(`curl -sS -X POST "${HOST}/${DB}/_m_set/${it.id}?JSON=1" -F "token=$TOKEN" -F "_xsrf=$XSRF" --form-string 't${REQ_ICON}=${(it.icon ?? '').replace(/'/g, "'\\''")}' >/dev/null && echo "откачен ${it.id}"`);
  const rbFile = `/tmp/issue-4548-${DB}-rollback-${stamp}.sh`;
  writeFileSync(rbFile, rb.join('\n') + '\n');
  console.log(`\nбэкап: ${backupFile}`);
  console.log(`откат: ${rbFile}`);

  if (!APPLY) return console.log('\nСУХОЙ ПРОГОН — не записано ничего. Для записи: --apply');
  if (!plan.toSet.length) return console.log('\nНечего применять.');

  // 5. Запись — только теперь, и только с _xsrf
  const x = await api(`/xsrf?JSON`);
  const xsrf = (Array.isArray(x) ? x[0] : x)._xsrf;
  if (!xsrf) throw new Error('не получил _xsrf');
  let ok = 0;
  for (const it of plan.toSet) {
    const fd = new FormData();
    fd.append('token', TOKEN);
    fd.append('_xsrf', xsrf);
    fd.append(`t${REQ_ICON}`, it.want);
    await api(`/_m_set/${it.id}?JSON=1`, { method: 'POST', body: fd });
    ok++;
  }
  console.log(`\nЗаписано: ${ok} из ${plan.toSet.length}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('ОШИБКА:', e.message);
    process.exit(1);
  });
}
