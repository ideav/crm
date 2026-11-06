// #5427: справочник «Тип ножа» — подбор типа ножу и значения типа (docs/scripts/knife_types_5427.py).
// Поведение проверяется вызовом функций скрипта на синтетических ножах (python3; нет — пропуск).
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'docs', 'scripts', 'knife_types_5427.py');
const PY = ['python3', 'python'].find(p => spawnSync(p, ['-c', 'import sys; assert sys.version_info >= (3, 8)']).status === 0);

function run(body) {
    const code = `import json, runpy, sys\nm = runpy.run_path(${JSON.stringify(SCRIPT)}, run_name='lib')\n` +
        `globals().update(m)\nout = {}\n${body}\nprint(json.dumps(out, ensure_ascii=False))\n`;
    const r = spawnSync(PY, ['-c', code], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
}

const KNIFE = `
def knife(n, w, l, ang, sg, lg, streams='3', cyl='1'):
    k = {f: '' for f in TYPE_REQS}
    k.update({'id': n, 'num': n, W: w, L: l, ANG: ang, SG: sg, LG: lg, 'Ручьёв': streams, 'Вал': cyl})
    return k
def entry(name, *rows, codes=()):
    w, l = size_of(name)
    return {'codes': list(codes), 'rows': list(rows), 'w': w, 'l': l, 'new': False, 'base': name}
`;

// Минимальный xlsx: sheet1.xml со строками inlineStr.
const XLSX = `
import zipfile, tempfile, os
def xlsx(rows):
    cell = lambda c, v: '<c r="%s1" t="inlineStr"><is><t>%s</t></is></c>' % (c, v)
    body = ''.join('<row>%s</row>' % ''.join(cell(chr(65 + i), v) for i, v in enumerate(r)) for r in rows)
    p = os.path.join(tempfile.mkdtemp(), 't.xlsx')
    with zipfile.ZipFile(p, 'w') as z:
        z.writestr('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/'
                   'spreadsheetml/2006/main"><sheetData>%s</sheetData></worksheet>' % body)
    return p
`;

test('одноимённые строки каталога: одинаковые параметры сливаются, разные — отдельные типы с кодом', { skip: !PY }, () => {
    const o = run(XLSX + KNIFE + `
cat = load_catalog(xlsx([['Наименование', 'Код', 'Угол', 'Ручьи', 'М/э'],
    ['40 х 30 (80)', '071', '80', '3', '2.52'], ['40 х 30 (80)', '248', '80', '3', '2.52'],
    ['30 х 20 (70)', '186', '70', '3', '3.28'], ['30 х 20 (70)', '339', '70', '3', '3.44']]))
ks = [knife('1', '30.00', '20.00', '70°', '3.00', '3.44'), knife('2', '30.00', '20.00', '70°', '3.00', '3.28')]
assign(ks, cat, {'1': ['30 х 20 (70)'], '2': ['30 х 20 (70)']})
out = {'types': {n: e['codes'] for n, e in cat.items()}, 'knives': [k['type'] for k in ks]}
`);
    assert.deepStrictEqual(o.types, { '40 х 30 (80)': ['071', '248'],
        '30 х 20 (70) [186]': ['186'], '30 х 20 (70) [339]': ['339'] });
    assert.deepStrictEqual(o.knives, ['30 х 20 (70) [339]', '30 х 20 (70) [186]']);
});

test('размер типа читается из наименования, в том числе круглые D и латинская x', { skip: !PY }, () => {
    const o = run(`out = [size_of(n) for n in ['100 х 150 (70/4/2,4)', 'D 20 (80)', '73 x 67,8', 'Нож']]`);
    assert.deepStrictEqual(o, [[100, 150], [20, 20], [73, 67.8], [null, null]]);
});

test('тип: из списка по номеру, иначе по параметрам с ближайшим размером, иначе новый', { skip: !PY }, () => {
    const o = run(KNIFE + `
cat = {'102 х 120,5 (80)': entry('102 х 120,5 (80)', (80, 3, 2.27)),
       '102 х 121 (80)': entry('102 х 121 (80)', (80, 3, 2.27)),
       '58 х 40 (80)': entry('58 х 40 (80)', (80, 3, 1.98))}
ks = [knife('1', '102.00', '120.50', '80°', '3.00', '2.267'),
      knife('2', '58.00', '40.00', '80°', '3.00', '1.975'),
      knife('3', '58.00', '40.00', '90°', '3.00', '1.975'),
      knife('4', '58.00', '40.00', '90°', '3.00', '1.975')]
assign(ks, cat, {'2': ['102 х 121 (80)']})
out = {'types': [[k['type'], k['src']] for k in ks], 'new': sorted(n for n, e in cat.items() if e['new'])}
`);
    assert.deepStrictEqual(o.types, [['102 х 120,5 (80)', 'params'], ['102 х 121 (80)', 'list'],
        ['58 х 40 (90/3/1,975)', 'new'], ['58 х 40 (90/3/1,975)', 'new']]);
    assert.deepStrictEqual(o.new, ['58 х 40 (90/3/1,975)']);
});

test('значения типа: каталог задаёт размер/угол/ручьи, округлённый м/э не перебивает точный у ножей', { skip: !PY }, () => {
    const o = run(KNIFE + `
e = entry('80 х 40 (80)', (80, 3, 1.98), codes=['000000134', '000000135'])
ks = [knife('1', '80.00', '40.00', '80°', '3.00', '1.975', '4'), knife('2', '80.00', '40.00', '80°', '3.00', '1.975', '4'),
      knife('3', '80.00', '40.00', '80°', '4.00', '2.5', '3')]
out = type_values('80 х 40 (80)', e, ks)
`);
    assert.strictEqual(o['М/э расстояние, мм'], '1.975');
    assert.strictEqual(Number(o['Между ручьями, мм']), 3);
    assert.strictEqual(o['Угол заточки'], '80°');
    assert.strictEqual(o['Ширина этикетки, мм'], '80');
    assert.strictEqual(o['Ручьёв'], '4');
    assert.strictEqual(o['Код 1С'], '000000134, 000000135');
});
