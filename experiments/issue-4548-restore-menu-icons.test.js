// #4548 — ВОЗВРАТ ИКОНОК МЕНЮ НЕ ОТКАТЫВАЕТ БАЗУ, УШЕДШУЮ ВПЕРЁД.
//
// КОНТЕКСТ. #4544/PR #4545: `restore` отдавал дамп без `Content-Type`, браузер разбирал SQL
// как разметку и съедал значения-теги — у всех пунктов меню боевой базы ateh пропали иконки.
// Причина починена, но ДАННЫЕ уже потеряны, а база с тех пор ушла вперёд (issue #4548).
// Значит повторный полный restore недопустим: он затрёт всё, что появилось после бэкапа.
// Возвращать надо ТОЛЬКО реквизит t391 (иконка) таблицы Меню 151.
//
// ЧЕМ ЭТО ОПАСНО. Скрипт восстановления пишет в прод. Две ошибки стоят дороже самой поломки:
//   1. перезаписать иконку, которую ОСОЗНАННО поменяли после бэкапа — это тихий откат чужой
//      работы, ровно та «половина „опять“», о которой предупреждает причинная цепь;
//   2. сопоставить пункт с иконкой по названию или по порядку — название человек
//      переименовывает, порядок не гарантирован, и иконки разъедутся по чужим пунктам.
// Отсюда правила, которые здесь и проверяются: сопоставление ТОЛЬКО по адресу (t153),
// непустая иконка НЕ трогается никогда, отсутствие источника — это «не знаю», а не «пусто».
//
// Что проверяем:
//   A — из SQL-дампа берутся только строки реквизита 391, экранированные кавычки разэкранируются;
//   B — пустая иконка + источник → в план на запись;
//   C — НЕПУСТАЯ иконка, отличная от источника → в «расхождения», НЕ в запись (защита от отката);
//   D — сопоставление по адресу: переименованный пункт получает свою иконку, а не соседскую;
//   E — пустая иконка без источника → «источник молчит», ничего не выдумываем.
//
// Run with: node experiments/issue-4548-restore-menu-icons.test.js
// Проверяемый инструмент: docs/restore_menu_icons.mjs (рядом с docs/create_atex_menu.ps1).

import { iconsFromDump, planRestore } from '../docs/restore_menu_icons.mjs';

let failed = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) return console.log(`  ✓ ${name}`);
  failed++;
  console.log(`  ✗ ${name}\n      получено: ${g}\n      ожидали:  ${w}`);
};

console.log('\nA — разбор дампа: берём только t391');
{
  const sql = [
    "INSERT INTO rep VALUES (100, 55, 151, 'Приём заказов');",
    "INSERT INTO rep VALUES (101, 55, 153, 'orders');",
    `INSERT INTO rep VALUES (102, 55, 391, '<i class="pi pi-shopping-cart"></i>');`,
    "INSERT INTO rep VALUES (103, 56, 391, 'it''s fine');",
    "INSERT INTO rep VALUES (104, 57, 3910, 'не тот реквизит');",
  ].join('\n');
  const got = iconsFromDump(sql);
  eq('иконка пункта 55', got.get(55), '<i class="pi pi-shopping-cart"></i>');
  eq("'' разэкранировано", got.get(56), "it's fine");
  eq('t3910 не спутан с t391', got.has(57), false);
  eq('лишнего не взяли', got.size, 2);
}

console.log('\nB — пустая иконка + источник → в запись');
{
  const live = [{ id: 1, name: 'Заказы', href: 'orders', icon: '' }];
  const src = new Map([['orders', '<i class="pi pi-shopping-cart"></i>']]);
  const p = planRestore(live, src);
  eq('одна на запись', p.toSet.length, 1);
  eq('значение из источника', p.toSet[0].want, '<i class="pi pi-shopping-cart"></i>');
  eq('в расхождения не попала', p.conflicting.length, 0);
}

console.log('\nC — непустая иконка НЕ перезаписывается (база ушла вперёд)');
{
  const live = [{ id: 2, name: 'Склад', href: 'warehouse', icon: '<i class="pi pi-truck"></i>' }];
  const src = new Map([['warehouse', '<i class="pi pi-box"></i>']]); // в бэкапе была другая
  const p = planRestore(live, src);
  eq('НЕ в записи', p.toSet.length, 0);
  eq('помечено как расхождение', p.conflicting.length, 1);
  eq('видно обе стороны', [p.conflicting[0].icon, p.conflicting[0].want], [
    '<i class="pi pi-truck"></i>',
    '<i class="pi pi-box"></i>',
  ]);
}

console.log('\nD — сопоставление по адресу, а не по названию/порядку');
{
  // Пункт переименован после бэкапа и стоит в другом порядке — иконка обязана прийти своя.
  const live = [
    { id: 10, name: 'Склад ГП (новое имя)', href: 'warehouse', icon: '' },
    { id: 11, name: 'Заказы', href: 'orders', icon: '' },
  ];
  const src = new Map([
    ['orders', '<i class="pi pi-shopping-cart"></i>'],
    ['warehouse', '<i class="pi pi-box"></i>'],
  ]);
  const p = planRestore(live, src);
  const byId = Object.fromEntries(p.toSet.map((x) => [x.id, x.want]));
  eq('переименованный получил СВОЮ', byId[10], '<i class="pi pi-box"></i>');
  eq('соседний не перепутан', byId[11], '<i class="pi pi-shopping-cart"></i>');
}

console.log('\nE — нет источника → не выдумываем');
{
  const live = [{ id: 20, name: 'Новый пункт', href: 'brand-new', icon: '' }];
  const p = planRestore(live, new Map());
  eq('НЕ в записи', p.toSet.length, 0);
  eq('помечен как «источник молчит»', p.noSource.length, 1);
}

console.log(failed ? `\nПАДЕНИЙ: ${failed}\n` : '\nВсе проверки пройдены.\n');
process.exit(failed ? 1 : 0);
