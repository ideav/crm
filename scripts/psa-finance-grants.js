#!/usr/bin/env node
/* PSA-демо (ideav/backlogram#986): включает или выключает права ролей «Руководитель ресурсного пула» и «Руководитель проекта»
   на финансовые поля (себестоимость часа, выручка по договору, таблица «Ставка продажи»).
   Нужно для варианта опции «Кому видна финансовая часть = Все руководители»: экран только скрывает данные, а отдавать их
   роли должно ядро, поэтому грант включается отдельно.

   Использование:
     PSA_TOKEN=<токен администратора базы> node scripts/psa-finance-grants.js on|off [https://ideav.ru/psa]
   on  - READ на поля и таблицу, off - BARRED (как в исходной схеме демо). Повторный запуск безопасен. */
'use strict';
const mode = process.argv[2];
const base = (process.argv[3] || 'https://ideav.ru/psa').replace(/\/$/, '');
const token = process.env.PSA_TOKEN;
if (!/^(on|off)$/.test(mode || '') || !token) {
    console.error('Использование: PSA_TOKEN=... node scripts/psa-finance-grants.js on|off [base-url]');
    process.exit(2);
}
const ROLES = ['Руководитель ресурсного пула', 'Руководитель проекта'];
const level = mode === 'on' ? 'READ' : 'BARRED';

async function main() {
    const hdr = { 'X-Authorization': token };
    const xs = (await (await fetch(base + '/xsrf?JSON', { headers: hdr })).json())._xsrf;
    const schema = {
        roles: ROLES.map(function (name) {
            return {
                name: name,
                grants: [
                    { table: 'Сотрудник', field: 'Себестоимость часа', level: level },
                    { table: 'Проект', field: 'Выручка по договору', level: level },
                    { table: 'Ставка продажи', level: level }
                ]
            };
        })
    };
    const fd = new FormData();
    fd.append('_xsrf', xs);
    fd.append('json', JSON.stringify(schema));
    const res = await (await fetch(base + '/_d_schema?JSON', { method: 'POST', headers: hdr, body: fd })).json();
    if (!res.ok) { console.error('Ошибка:', JSON.stringify(res.errors || res)); process.exit(1); }
    console.log('Готово: права на финансовые поля = ' + level + ' для ролей: ' + ROLES.join(', '));
}
main().catch(function (e) { console.error(e.message); process.exit(1); });
