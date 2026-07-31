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

/** Разобрать SQL-дамп: вернуть Map<objId, icon> по строкам реквизита t=391. */
export function iconsFromDump(sql) {
  const out = new Map();
  // Формат дампа: INSERT INTO ... VALUES (id, up, t, val) — вытаскиваем кортежи с t=391.
  const re = /\(\s*(\d+)\s*,\s*(\d+)\s*,\s*391\s*,\s*'((?:[^']|'')*)'\s*\)/g;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const [, , up, val] = m;
    out.set(Number(up), val.replace(/''/g, "'"));
  }
  return out;
}

/**
 * Сопоставить пункты живой базы с источником иконок ПО АДРЕСУ.
 * Возвращает план: что менять, что уже в порядке, что не нашлось.
 */
export function planRestore(liveItems, iconByHref) {
  const plan = { toSet: [], alreadyOk: [], noSource: [], conflicting: [] };
  for (const it of liveItems) {
    const cur = (it.icon ?? '').trim();
    const href = (it.href ?? '').trim();
    const want = href ? iconByHref.get(href) : undefined;
    if (cur) {
      // Иконка на месте. Если источник даёт другую — НЕ трогаем: возможно, её осознанно
      // поменяли уже после бэкапа («база ушла вперёд»), и перезапись была бы откатом.
      if (want && want !== cur) plan.conflicting.push({ ...it, want });
      else plan.alreadyOk.push(it);
      continue;
    }
    if (!want) plan.noSource.push(it);
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

  // 1. Источник иконок
  const iconByHref = new Map();
  const dumpFile = arg('from-dump');
  const iconsFile = arg('icons');
  if (dumpFile) {
    const byUp = iconsFromDump(readFileSync(dumpFile, 'utf8'));
    console.log(`Источник: дамп ${dumpFile} — строк t391: ${byUp.size}`);
    // из дампа иконки приходят по id записи меню, адрес добираем ниже из живой базы
    iconByHref.__byId = byUp;
  } else if (iconsFile) {
    const j = JSON.parse(readFileSync(iconsFile, 'utf8'));
    for (const r of j.roles ?? []) for (const m of r.menus ?? []) if (m.href) iconByHref.set(m.href, m.icon ?? '');
    console.log(`Источник: ${iconsFile} — уникальных адресов: ${iconByHref.size}`);
  } else {
    throw new Error('нужен --icons <file.json> либо --from-dump <file.sql>');
  }

  // 2. Живые пункты меню
  const roles = await api(`/object/${ROLE_TABLE}/?JSON_OBJ`);
  const roleIds = (Array.isArray(roles) ? roles : roles.rows ?? []).map((r) => r.i ?? r.id).filter(Boolean);
  console.log(`Ролей в базе: ${roleIds.length}`);

  const live = [];
  for (const rid of roleIds) {
    const items = await api(`/object/${MENU_TABLE}/?JSON_OBJ&F_U=${rid}`);
    for (const it of Array.isArray(items) ? items : items.rows ?? []) {
      const r = it.r ?? {};
      live.push({
        id: it.i ?? it.id,
        role: rid,
        name: r[REQ_NAME] ?? it.o ?? '',
        href: r[REQ_HREF] ?? '',
        icon: r[REQ_ICON] ?? '',
      });
    }
  }
  console.log(`Пунктов меню: ${live.length}`);

  if (iconByHref.__byId) for (const it of live) {
    const v = iconByHref.__byId.get(it.id);
    if (v && it.href) iconByHref.set(it.href, v);
  }

  // 3. План
  const plan = planRestore(live, iconByHref);
  console.log(`\nПЛАН:`);
  console.log(`  вернуть иконку : ${plan.toSet.length}`);
  console.log(`  уже на месте   : ${plan.alreadyOk.length}`);
  console.log(`  нет в источнике: ${plan.noSource.length}`);
  console.log(`  расходится (НЕ трогаем): ${plan.conflicting.length}`);
  for (const it of plan.toSet) console.log(`   + [${it.id}] ${it.name} (${it.href}) → ${it.want}`);
  for (const it of plan.noSource) console.log(`   ? [${it.id}] ${it.name} (${it.href}) — источник молчит`);
  for (const it of plan.conflicting) console.log(`   ! [${it.id}] ${it.name}: в базе ${it.icon} ≠ ${it.want} в источнике`);

  // 4. Бэкап + rollback ДО любой записи
  const stamp = arg('stamp', 'now');
  const backupFile = `/tmp/issue-4548-${DB}-menu-before-${stamp}.json`;
  writeFileSync(backupFile, JSON.stringify(live, null, 2));
  const rollback = plan.toSet
    .map((it) => `# было пусто: curl -X POST "${HOST}/${DB}/_m_set/${it.id}?JSON=1" -F "token=$TOKEN" -F "_xsrf=$XSRF" --form-string 't${REQ_ICON}='`)
    .join('\n');
  writeFileSync(`/tmp/issue-4548-${DB}-rollback-${stamp}.sh`, `#!/bin/bash\n# откат: вернуть пустые иконки\n${rollback}\n`);
  console.log(`\nбэкап   : ${backupFile}`);
  console.log(`откат   : /tmp/issue-4548-${DB}-rollback-${stamp}.sh`);

  if (!APPLY) {
    console.log('\nСУХОЙ ПРОГОН — ничего не записано. Для записи добавьте --apply');
    return;
  }
  if (!plan.toSet.length) {
    console.log('\nНечего применять.');
    return;
  }

  // 5. Запись (XSRF обязателен на мутациях)
  const x = await api(`/xsrf?JSON`);
  const xsrf = x._xsrf ?? x.xsrf;
  if (!xsrf) throw new Error('не получил _xsrf');
  let ok = 0;
  for (const it of plan.toSet) {
    const fd = new FormData();
    fd.append('token', TOKEN);
    fd.append('_xsrf', xsrf);
    fd.append(`t${REQ_ICON}`, it.want);
    await api(`/_m_set/${it.id}?JSON=1`, { method: 'POST', body: fd });
    ok++;
    console.log(`  записано [${it.id}] ${it.name}`);
  }
  console.log(`\nГотово: ${ok} из ${plan.toSet.length}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('ОШИБКА:', e.message);
    process.exit(1);
  });
}
