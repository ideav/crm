#!/usr/bin/env python3
# Пробег и ресурс ножа — в оборотах, а не в метрах (ideav/crm#5376, п.3, решение владельца).
# Один оборот = один раппорт вала = зубья × 3.175 мм; обороты = метры × 1000 / раппорт, мм.
#
# Что делает (по порядку; по умолчанию — сухой прогон безопасен: --dry-run печатает план БЫЛО → СТАЛО):
#   1. «Движение пробега».«Метры пробега» → «Обороты пробега» (_d_save по типу колонки).
#      «Марка ножа».«Ресурс, м» → «Ресурс, об».
#   2. Колонка `meters` отчётов `die_runs` и `die_cutter_runs` → `revs` (_m_set t100).
#   3. Движения вида «вырубка» (их писал пульт высечки в метрах): метры → обороты по раппорту
#      вала задания (нет вала у задания — вала ножа; «Раппорт, мм» вала, нет — зубья × 3.175).
#      Движение, у которого раппорт не определился, не трогается и называется в выводе.
#      «Начальный остаток» НЕ пересчитывается: это «Пробег» из 1С, он уже в оборотах.
#      Сделанные записи пишутся в файл состояния во временной папке (повторный запуск их пропускает,
#      иначе пересчёт прошёл бы дважды).
#   4. Ресурс марок ножей (160 000 / 490 000) — медианы пробега списанных ножей из 1С, то есть
#      уже обороты: значения не меняются, печатаются как есть. Ключ --convert-brand-resources
#      пересчитывает их как метры по раппорту 304.8 мм (96 зубьев) — нужен, только если заказчик
#      скажет, что в справочнике стояли метры.
#   5. «Настройка» (269): ключ DIE_RESOURCE_DEFAULT_REV = 300000 об (медиана пробега списанных
#      ножей). Прежний ключ DIE_RESOURCE_DEFAULT_M код не читает — его строку можно удалить вручную.
#
# Запуск (только база Фазы 2; сначала всегда --dry-run):
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/migrate_die_runs_rev_5376.py --dry-run
#   TOKEN=<X-Authorization> DB=https://ideav.ru/ateh1 python3 docs/scripts/migrate_die_runs_rev_5376.py
# Порядок выкладки: сначала этот скрипт, потом новая сборка download/atex*/ (пульт без колонки
# «Обороты пробега» откажется писать съём, а старая сборка без колонки «Метры пробега» не запишет движение).

import os, sys, json, tempfile, urllib.request, urllib.parse, urllib.error

DB = os.environ.get('DB', 'https://ideav.ru/ateh1').rstrip('/')
TOKEN = os.environ.get('TOKEN', '')
DRY = '--dry-run' in sys.argv
CONVERT_BRANDS = '--convert-brand-resources' in sys.argv
STATE = os.path.join(tempfile.gettempdir(), 'migrate_die_runs_rev_5376.' + DB.replace('://', '_').replace('/', '_') + '.json')

TOOTH_PITCH_MM = 3.175
BRAND_HINT_REPEAT_MM = 96 * TOOTH_PITCH_MM   # 304.8
RUN_TABLE, OLD_RUN_REQ, NEW_RUN_REQ = 'Движение пробега', 'Метры пробега', 'Обороты пробега'
BRAND_TABLE, OLD_RES_REQ, NEW_RES_REQ = 'Марка ножа', 'Ресурс, м', 'Ресурс, об'
DIE_TABLE, CYL_TABLE = 'Нож', 'Вал'
CUT = 'вырубка'
REPORTS = ('die_runs', 'die_cutter_runs')
SETTING_KEY, SETTING_VALUE, SETTING_TYPE = 'DIE_RESOURCE_DEFAULT_REV', '300000', 'ATEH'

XSRF = ''


def call(method, path, fields=None):
    data = urllib.parse.urlencode(fields).encode() if fields is not None else None
    r = urllib.request.Request(f'{DB}/{path}', data=data, method=method,
                               headers={'X-Authorization': TOKEN, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            body = resp.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')
    try:
        return json.loads(body)
    except ValueError:
        raise SystemExit(f'{method} {path}: не JSON: {body[:300]}')


def post(path, fields):
    return call('POST', path, dict(fields, _xsrf=XSRF))


def norm(s):
    return str(s or '').strip().lower()


def alias_of(e):
    fa = e.get('field_attrs') or {}
    if fa.get('alias'):
        return fa['alias']
    if e.get('alias'):
        return e['alias']
    try:
        return (json.loads(e.get('attrs') or '{}') or {}).get('alias') or ''
    except ValueError:
        return ''


def req_by_name(table, name):
    """Реквизит таблицы по псевдониму, затем по имени типа; None — нет."""
    for e in table.get('reqs') or []:
        if norm(alias_of(e)) == norm(name):
            return e
    for e in table.get('reqs') or []:
        if norm(e.get('val')) == norm(name):
            return e
    return None


def table_by_name(meta, name):
    for t in meta:
        if norm(t.get('val')) == norm(name):
            return t
    raise SystemExit(f'в базе нет таблицы «{name}»')


def num(v):
    try:
        return float(str(v if v is not None else '').replace(' ', '').replace('\xa0', '').replace(',', '.'))
    except ValueError:
        return 0.0


def revs_from_meters(meters, repeat_mm):
    return int(round(meters * 1000 / repeat_mm)) if meters >= 0 and repeat_mm > 0 else None


def kv(table_id):
    j = call('GET', f'object/{table_id}/?JSON_KV&LIMIT=0,100000')
    reqs = j.get('reqs') or {}
    return [{'id': str(o['id']), 'val': str(o.get('val') or ''), 'reqs': reqs.get(str(o['id'])) or reqs.get(o['id']) or {}}
            for o in (j.get('object') or [])]


def ref_id(rec, req_id):
    raw = str(rec['reqs'].get('ref_' + str(req_id)) or '').strip()
    if raw == '':
        return ''
    return raw.split(':', 1)[-1].split(',')[0].strip()


def rename_req(table, old, new):
    """Переименовывает тип колонки (_d_save по orig) либо её псевдоним. → True, если что-то нужно/сделано."""
    if req_by_name(table, new):
        print(f'  ∙ «{table["val"]}».«{new}» уже есть')
        return False
    r = req_by_name(table, old)
    if not r:
        raise SystemExit(f'«{table["val"]}»: нет колонки «{old}» (и «{new}» тоже)')
    print(f'  БЫЛО «{table["val"]}».«{old}» → СТАЛО «{new}»' + (' (сухой прогон)' if DRY else ''))
    if DRY:
        return True
    if alias_of(r):
        res = post(f'_d_alias/{r["id"]}?JSON=1', {'val': new})
    else:
        res = post(f'_d_save/{r["orig"]}?JSON', {'val': new, 't': str(r.get('type') or '')})
    print('    ->', json.dumps(res, ensure_ascii=False)[:200])
    return True


def rename_report_columns():
    reports = {str((r.get('r') or [''])[0]).strip(): str(r['i'])
               for r in call('GET', 'object/22/?JSON_OBJ&LIMIT=0,5000') or []}
    for name in REPORTS:
        qid = reports.get(name)
        if not qid:
            print(f'  ~ отчёта {name} нет — пропуск')
            continue
        cols = call('GET', f'object/28/?JSON_OBJ&LIMIT=0,200&F_U={qid}') or []
        names = {str((c.get('r') or ['', ''])[1]).strip(): str(c['i']) for c in cols}
        if 'revs' in names:
            print(f'  ∙ {name}: колонка revs уже есть')
        elif 'meters' in names:
            print(f'  БЫЛО {name}.meters → СТАЛО revs' + (' (сухой прогон)' if DRY else ''))
            if not DRY:
                print('    ->', json.dumps(post(f'_m_set/{names["meters"]}?JSON', {'t100': 'revs'}), ensure_ascii=False)[:200])
        else:
            print(f'  ~ {name}: нет ни meters, ни revs — проверьте отчёт')


def cylinder_repeats(meta):
    t = table_by_name(meta, CYL_TABLE)
    rep = req_by_name(t, 'Раппорт, мм')
    out = {}
    for c in kv(t['id']):
        r = num(c['reqs'].get(str(rep['id']))) if rep else 0
        out[c['id']] = r if r > 0 else (num(c['val']) * TOOTH_PITCH_MM if num(c['val']) > 0 else 0)
    return out


def load_state():
    try:
        with open(STATE, encoding='utf-8') as f:
            return set(json.load(f))
    except (OSError, ValueError):
        return set()


def save_state(done):
    with open(STATE, 'w', encoding='utf-8') as f:
        json.dump(sorted(done), f)


def convert_runs(meta, run_table):
    rev_req = req_by_name(run_table, NEW_RUN_REQ) or req_by_name(run_table, OLD_RUN_REQ)
    reports = {}
    for name in ('die_cutter_runs', 'die_cutter_jobs'):
        rows = call('GET', f'report/{name}?JSON_KV&LIMIT=0,100000')
        if not isinstance(rows, list):
            raise SystemExit(f'нет отчёта {name} (docs/scripts/apply_die_cutter_5326.py)')
        reports[name] = rows
    jobs = {str(r.get('job_id')): r for r in reports['die_cutter_jobs']}
    die_t = table_by_name(meta, DIE_TABLE)
    cyl_req = req_by_name(die_t, 'Вал')
    die_cyl = {d['id']: ref_id(d, cyl_req['id']) for d in kv(die_t['id'])} if cyl_req else {}
    repeats = cylinder_repeats(meta)
    done = load_state()
    n_conv = n_skip = n_init = n_noRep = 0
    for r in reports['die_cutter_runs']:
        kind = norm(str(r.get('kind') or '').split(':', 1)[-1])
        rid = str(r.get('run_id'))
        if kind != CUT:
            n_init += 1
            continue
        if rid in done:
            n_skip += 1
            continue
        meters = num(r.get('meters') if r.get('meters') is not None else r.get('revs'))
        job = jobs.get(str(r.get('job_id'))) or {}
        cyl = str(job.get('cylinder_id') or '') or die_cyl.get(str(r.get('die_id')), '')
        rep = repeats.get(cyl, 0)
        revs = revs_from_meters(meters, rep)
        if revs is None:
            n_noRep += 1
            print(f'  ! движение {rid} (нож {r.get("die_id")}, задание {r.get("job_id")}): раппорт вала не определён, {meters:g} м не пересчитано')
            continue
        print(f'  БЫЛО {meters:g} м → СТАЛО {revs} об   (движение {rid}, вал {cyl}, раппорт {rep:g} мм)')
        n_conv += 1
        if DRY:
            continue
        post(f'_m_set/{rid}?JSON', {f't{rev_req["id"]}': str(revs)})
        done.add(rid)
        save_state(done)
    print(f'  итого: пересчитано {n_conv}, уже пересчитано ранее {n_skip}, без раппорта {n_noRep}; '
          f'«начальный остаток» (уже обороты, не трогается) {n_init}')


def brand_resources(meta):
    t = table_by_name(meta, BRAND_TABLE)
    req = req_by_name(t, NEW_RES_REQ) or req_by_name(t, OLD_RES_REQ)
    for b in kv(t['id']):
        cur = num(b['reqs'].get(str(req['id'])))
        if cur <= 0:
            continue
        hint = revs_from_meters(cur, BRAND_HINT_REPEAT_MM)
        if CONVERT_BRANDS:
            print(f'  БЫЛО {b["val"]}: {cur:g} м → СТАЛО {hint} об (раппорт {BRAND_HINT_REPEAT_MM:g} мм)')
            if not DRY:
                post(f'_m_set/{b["id"]}?JSON', {f't{req["id"]}': str(hint)})
        else:
            print(f'  {b["val"]}: {cur:g} (не меняется; если это метры — {hint} об при раппорте {BRAND_HINT_REPEAT_MM:g} мм, ключ --convert-brand-resources)')


def ensure_setting(meta):
    t = table_by_name(meta, 'Настройка')
    typ, val = req_by_name(t, 'Тип'), req_by_name(t, 'Значение')
    have = {s['val'].strip(): s for s in kv(t['id'])}
    if SETTING_KEY in have:
        cur = str(have[SETTING_KEY]['reqs'].get(str(val['id'])) or '').strip()
        print(f'  ∙ {SETTING_KEY} уже есть: {cur or "пусто"} (id {have[SETTING_KEY]["id"]})')
    else:
        print(f'  СТАЛО {SETTING_KEY} = {SETTING_VALUE}' + (' (сухой прогон)' if DRY else ''))
        if not DRY:
            res = post(f'_m_new/{t["id"]}?JSON&up=1', {f't{t["id"]}': SETTING_KEY, f't{typ["id"]}': SETTING_TYPE, f't{val["id"]}': SETTING_VALUE})
            print('    ->', json.dumps(res, ensure_ascii=False)[:200])
    if 'DIE_RESOURCE_DEFAULT_M' in have:
        print('  ~ строка DIE_RESOURCE_DEFAULT_M больше не читается — можно удалить вручную')


def main():
    global XSRF
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if not TOKEN:
        raise SystemExit('нет TOKEN')
    print(f'База: {DB}' + ('  (сухой прогон)' if DRY else ''))
    meta = call('GET', 'metadata?JSON')
    XSRF = '' if DRY else call('GET', 'xsrf?JSON=1').get('_xsrf', '')
    run_t, brand_t = table_by_name(meta, RUN_TABLE), table_by_name(meta, BRAND_TABLE)

    print('[1] пересчёт «вырубки» метры → обороты (до переименования: сухой прогон читает отчёты как есть)')
    if req_by_name(run_t, OLD_RUN_REQ) or DRY:
        convert_runs(meta, run_t)
    else:
        print('  ∙ колонка уже «Обороты пробега» — пересчёт был в прошлый запуск, повторно не делается')
    print('[2] переименование колонок')
    rename_req(run_t, OLD_RUN_REQ, NEW_RUN_REQ)
    rename_req(brand_t, OLD_RES_REQ, NEW_RES_REQ)
    print('[3] колонки отчётов')
    rename_report_columns()
    print('[4] ресурс марок ножей')
    brand_resources(call('GET', 'metadata?JSON') if not DRY else meta)
    print('[5] настройка')
    ensure_setting(meta)


if __name__ == '__main__':
    main()
