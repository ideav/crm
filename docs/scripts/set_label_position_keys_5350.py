#!/usr/bin/env python3
# Ключ позиции «Заказанное количество» для этикетки (ideav/crm#5350): реквизиты этикетки становятся
# ключевыми (field_attrs.key), чтобы разные этикетки одного заказа с одинаковыми рулонами, втулкой и
# намоткой не сливались в одну позицию (_m_new/_m_batch возвращают существующую запись при совпадении
# главного значения и всех ключевых реквизитов под тем же родителем).
#
# _d_key ПЕРЕКЛЮЧАЕТ флаг, поэтому скрипт вызывает его только у реквизитов, где флаг выключен, и
# перечитывает метаданные. Реквизиты ищутся по именам. Идемпотентно.
#
# Запуск (база Фазы 2):
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/set_label_position_keys_5350.py [--dry-run]

import os, sys, json, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
TABLE = 'Заказанное количество'
KEYS = ['Артикул', 'Ширина этикетки, мм', 'Длина этикетки, мм', 'Сырьё этикетки']


def call(method, path, fields=None):
    data = urllib.parse.urlencode(fields).encode() if fields is not None else None
    r = urllib.request.Request(f'{DB}/{path}', data=data, method=method,
                               headers={'X-Authorization': TOKEN, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            body = resp.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')
    try:
        return json.loads(body)
    except ValueError:
        raise SystemExit(f'{method} {path}: не JSON: {body[:300]}')


def reqs_of_table():
    meta = call('GET', 'metadata?JSON')
    table = next((t for t in meta if str(t.get('val')).strip() == TABLE), None)
    if not table:
        raise SystemExit(f'нет таблицы «{TABLE}»')
    out = {}
    for r in table.get('reqs', []):
        name = ((r.get('field_attrs') or {}).get('alias') or str(r.get('val'))).strip()
        out[str(r.get('val')).strip()] = r
        out[name] = r
    return out


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not TOKEN:
        raise SystemExit('нет TOKEN')
    reqs = reqs_of_table()
    missing = [k for k in KEYS if k not in reqs]
    if missing:
        raise SystemExit('нет реквизитов: ' + ', '.join(missing))
    xsrf = '' if DRY else call('GET', 'xsrf?JSON=1').get('_xsrf', '')
    for name in KEYS:
        r = reqs[name]
        if (r.get('field_attrs') or {}).get('key'):
            print(f'{name} ({r["id"]}): уже ключ')
            continue
        print(f'{name} ({r["id"]}): ' + ('сухой прогон' if DRY else 'ставим ключ'))
        if not DRY:
            call('POST', f'_d_key/{r["id"]}?JSON=1', {'_xsrf': xsrf})
    if DRY:
        return
    reqs = reqs_of_table()
    bad = [n for n in KEYS if not (reqs[n].get('field_attrs') or {}).get('key')]
    if bad:
        raise SystemExit('флаг не встал: ' + ', '.join(bad))
    print('готово: ' + ', '.join(KEYS))


if __name__ == '__main__':
    main()
