// Сид локальной установки и стенда: корень ROOT и удаление записей верхнего уровня.
//
// Корень Интеграма — строка (1, up=1, t=1, 'ROOT'). Запись верхнего уровня висит на нём
// (up=1), тип — строка с up=0. Сид с корнем (1, up=0, …) делает строку 1 «метаданными»:
// проверка родителя в _m_del (index.php, ApplyMDel: `pup == 0`) и в _m_del_batch
// отвечала «Нельзя удалить метаданные» на ЛЮБУЮ запись верхнего уровня.
//
// Тест берёт строки сида как данные и прогоняет на них те же условия, что ядро ставит
// при удалении: родитель обязан существовать и не быть метаданными (par.up != 0), на
// объект не должно быть ссылок (строк с t = id), а пакетное удаление берёт только строки
// нужного типа с t != up. Правила общие для любого сида Интеграма:
//   • корень ROOT есть и равен (1, 1, 1);
//   • ROOT удалить нельзя ни одиночным, ни пакетным удалением;
//   • новую запись верхнего уровня любой таблицы удалить можно — обоими путями;
//   • тип (up=0) одиночным удалением не удаляется.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const SEEDS = [
  'docker/mysql/010-integram-bootstrap.sql',
  'docs/scripts/prepare_cm_template.stand.sql',
];

// Строки вида (id, up, ord, t, 'val') из INSERT … VALUES.
function seedRows(rel) {
  const sql = fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');
  const rows = [];
  const re = /\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(-?\d+)\s*,\s*(\d+)\s*,\s*'((?:[^']|'')*)'\s*\)/g;
  let m;
  while ((m = re.exec(sql))) {
    rows.push({ id: +m[1], up: +m[2], ord: +m[3], t: +m[4], val: m[5] });
  }
  return rows;
}

// _m_del (ApplyMDel): SELECT … FROM obj LEFT JOIN r ON r.t=obj.id JOIN par ON par.id=obj.up.
function singleDelete(rows, id) {
  const obj = rows.find((r) => r.id === id);
  const par = obj && rows.find((r) => r.id === obj.up);
  if (!obj || !par) return 'not-found';
  if (par.up === 0) return 'metadata';
  if (rows.some((r) => r.t === id)) return 'has-refs';
  return 'deleted';
}

// _m_del_batch: WHERE obj.id IN (ids) AND obj.t=$type AND obj.t!=obj.up, затем те же проверки.
function batchDelete(rows, type, ids) {
  const out = {};
  for (const id of ids) {
    const obj = rows.find((r) => r.id === id && r.t === type && r.t !== r.up);
    if (!obj) { out[id] = 'not-found'; continue; }
    const par = rows.find((r) => r.id === obj.up);
    if (!par || par.up === 0) { out[id] = 'metadata'; continue; }
    out[id] = rows.some((r) => r.t === id) ? 'has-refs' : 'deleted';
  }
  return out;
}

for (const rel of SEEDS) {
  const rows = seedRows(rel);
  const types = rows.filter((r) => r.up === 0 && r.id !== r.t);

  test(`${rel}: корень ROOT = (1, up=1, t=1)`, () => {
    const root = rows.find((r) => r.id === 1);
    assert.deepStrictEqual(root && { up: root.up, t: root.t, val: root.val },
      { up: 1, t: 1, val: 'ROOT' });
  });

  test(`${rel}: ROOT не удаляется ни одиночным, ни пакетным удалением`, () => {
    assert.notStrictEqual(singleDelete(rows, 1), 'deleted');
    assert.notStrictEqual(batchDelete(rows, 1, [1])[1], 'deleted');
  });

  test(`${rel}: новая запись верхнего уровня любой таблицы удаляется`, () => {
    assert.ok(types.length > 0, 'в сиде нет таблиц');
    const nextId = Math.max(...rows.map((r) => r.id)) + 1;
    for (const type of types) {
      const withRec = rows.concat({ id: nextId, up: 1, ord: 1, t: type.id, val: 'запись' });
      assert.strictEqual(singleDelete(withRec, nextId), 'deleted', `_m_del, таблица ${type.val}`);
      assert.strictEqual(batchDelete(withRec, type.id, [nextId])[nextId], 'deleted',
        `_m_del_batch, таблица ${type.val}`);
    }
  });

  test(`${rel}: тип (up=0) одиночным удалением не удаляется`, () => {
    for (const type of types) {
      assert.notStrictEqual(singleDelete(rows, type.id), 'deleted', type.val);
    }
  });
}
