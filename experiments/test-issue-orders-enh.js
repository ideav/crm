/* Юнит-тесты доработок РМ orders: rowsToOrders / searchOrders / sortOrders. */
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'download', 'atex', 'js', 'orders.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'download', 'atex', 'css', 'orders.css'), 'utf8');
const sandbox = { window: {}, document: { readyState: 'loading', addEventListener(){}, getElementById(){ return null; } },
    console, URLSearchParams, URL, setTimeout, clearTimeout, fetch(){ throw new Error('no fetch'); } };
sandbox.window.window = sandbox.window; sandbox.window.document = sandbox.document;
vm.runInNewContext(source, sandbox, { filename: 'orders.js' });
const H = sandbox.window.AtexOrdersTesting;
let passed = 0;
function eq(a, e, name){ const ok = JSON.stringify(a) === JSON.stringify(e); console.log((ok?'PASS':'FAIL')+' — '+name); if(ok){passed++;}else{console.log('  exp:',JSON.stringify(e));console.log('  got:',JSON.stringify(a));process.exitCode=1;} }

// rowsToOrders: дедуп заказов по order_id; позиции из рядов с непустым position_id;
// заказ без позиций (пустой position_id) остаётся с positions: [].
// «Тип резки» упразднён (docs/atex_data_schema.md §9): position_cut_type* колонок нет.
const rows = [
  { order_id:'10', order_no:'1', order_client:'ООО Ромашка', order_manager:'Иванов', order_created:'01.06.2026', order_approved:'', order_status:'Новый',
    position_id:'100', position_qty:'5', position_raw:'MWR118', position_raw_id:'1237', position_width:'25', position_length:'910', position_sleeve:'25', position_sleeve_id:'8190', position_winding:'IN', position_status:'Новая' },
  { order_id:'10', order_no:'1', order_client:'ООО Ромашка', order_manager:'Иванов', order_created:'01.06.2026', order_approved:'', order_status:'Новый',
    position_id:'101', position_qty:'3', position_raw:'MW308', position_width:'110', position_length:'910', position_sleeve:'40', position_winding:'OUT', position_status:'В работе' },
  { order_id:'20', order_no:'2', order_client:'ИП Петров', order_manager:'Сидоров', order_created:'02.06.2026', order_approved:'02.06.2026', order_status:'Согласован',
    position_id:'', position_qty:'', position_raw:'', position_width:'', position_length:'', position_sleeve:'', position_winding:'', position_status:'' }
];
const out = H.rowsToOrders(rows);
eq(out.length, 2, 'rowsToOrders: 2 заказа (дедуп по order_id)');
eq(out[0].id, '10', 'rowsToOrders: id заказа');
eq(out[0].values.client, 'ООО Ромашка', 'rowsToOrders: значения заказа');
eq(out[0].positions.length, 2, 'rowsToOrders: 2 позиции у заказа 10');
eq(out[0].positions[0].id, '100', 'rowsToOrders: id позиции');
eq(out[0].positions[1].values.raw, 'MW308', 'rowsToOrders: значения позиции (вид сырья)');
eq(out[0].positions[0].refs, { raw:'1237', sleeve:'8190' }, 'rowsToOrders: id ссылок (refs) из отчёта');
eq(out[1].positions.length, 0, 'rowsToOrders: заказ без позиций → пустой список');

// Issue #3179: если все позиции согласованы, заказ выглядит согласованным без
// отдельного клика по заказу; дата согласования заказа — последняя дата позиции.
const allApproved = H.rowsToOrders([
  { order_id:'30', order_no:'3', order_client:'ООО Альфа', order_manager:'Иванов', order_created:'03.06.2026', order_approved:'', order_status:'Новый',
    position_id:'300', position_qty:'1', position_raw:'MWR118', position_width:'25', position_length:'910', position_sleeve:'25', position_winding:'IN', position_status:'Согласована', position_approved:'01.06.2026' },
  { order_id:'30', order_no:'3', order_client:'ООО Альфа', order_manager:'Иванов', order_created:'03.06.2026', order_approved:'', order_status:'Новый',
    position_id:'301', position_qty:'2', position_raw:'MW308', position_width:'110', position_length:'910', position_sleeve:'40', position_winding:'OUT', position_status:'Согласована', position_approved:'03.06.2026' }
])[0];
eq(allApproved.values.status, 'Согласован', 'rowsToOrders: все позиции согласованы → заказ выглядит согласованным');
eq(allApproved.values.approved, '03.06.2026', 'rowsToOrders: дата заказа берётся последней из позиций');

const partlyApproved = H.rowsToOrders([
  { order_id:'31', order_no:'4', order_client:'ООО Бета', order_manager:'Иванов', order_created:'03.06.2026', order_approved:'', order_status:'Новый',
    position_id:'310', position_qty:'1', position_raw:'MWR118', position_width:'25', position_length:'910', position_sleeve:'25', position_winding:'IN', position_status:'Согласована', position_approved:'01.06.2026' },
  { order_id:'31', order_no:'4', order_client:'ООО Бета', order_manager:'Иванов', order_created:'03.06.2026', order_approved:'', order_status:'Новый',
    position_id:'311', position_qty:'2', position_raw:'MW308', position_width:'110', position_length:'910', position_sleeve:'40', position_winding:'OUT', position_status:'Новая', position_approved:'' }
])[0];
eq(partlyApproved.values.status, 'Новый', 'rowsToOrders: не все позиции согласованы → статус заказа не меняется');
eq(partlyApproved.values.approved, '', 'rowsToOrders: не все позиции согласованы → дата заказа не выводится из позиций');

// searchOrders: заказ виден, если запрос совпал с любым полем заказа ИЛИ любой позиции
// (регистронезависимо, по нормализованному тексту). Пустой запрос → весь список.
const list = H.rowsToOrders(rows);
eq(H.searchOrders(list, '').length, 2, 'searchOrders: пустой запрос → все');
eq(H.searchOrders(list, 'ромашка').map(function(o){return o.id;}), ['10'], 'searchOrders: по клиенту (регистр)');
eq(H.searchOrders(list, 'петров').map(function(o){return o.id;}), ['20'], 'searchOrders: по другому клиенту');
eq(H.searchOrders(list, 'mw308').map(function(o){return o.id;}), ['10'], 'searchOrders: по полю позиции (вид сырья)');
eq(H.searchOrders(list, 'нетакого').length, 0, 'searchOrders: нет совпадений → пусто');

// sortOrders: сортировка заказов по ключу значения; dir 'asc'|'desc'.
// Числа — численно, даты DD.MM.YYYY — хронологически, прочее — текст (localeCompare ru).
const sl = H.rowsToOrders(rows);
eq(H.sortOrders(sl, 'client', 'asc').map(function(o){return o.id;}), ['20','10'], 'sortOrders: по клиенту asc (ИП<ООО)');
eq(H.sortOrders(sl, 'client', 'desc').map(function(o){return o.id;}), ['10','20'], 'sortOrders: по клиенту desc');
eq(H.sortOrders(sl, 'created', 'asc').map(function(o){return o.id;}), ['10','20'], 'sortOrders: по дате создания asc');
eq(H.sortOrders(sl, 'created', 'desc').map(function(o){return o.id;}), ['20','10'], 'sortOrders: по дате desc');
// не мутирует исходный список:
H.sortOrders(sl, 'client', 'desc'); eq(sl.map(function(o){return o.id;}), ['10','20'], 'sortOrders: не мутирует вход');

eq(/\.atex-orders-approve\.is-confirm[\s\S]*#f5e6c8/.test(style), true, 'orders.css: кнопка Подтвердить выделяется бежевым');

console.log('\n' + passed + ' assertions passed');
