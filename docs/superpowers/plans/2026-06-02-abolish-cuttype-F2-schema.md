# F2 «Упразднение Типа резки»: схема + отчёты — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** На боевой ateh: очистить тестовые данные (заказы, типы резки), упразднить таблицу «Тип резки» и ссылки на неё, переподчинить «Полоса» к «Производственной резке», добавить «Срок изготовления», поправить отчёты.

**Architecture:** Прямые вызовы Integram API (`_m_del` для данных, `_d_*` для схемы, `_m_new/_m_set` для отчётов). Каждый шаг проверяется повторным `?JSON_META`/прогоном отчёта. Деликатные `_d_*` — по [[feedback_integram_schema_d_commands]]; новый механизм (подчинённая таблица) — сперва на ЧЕРНОВЫХ таблицах, потом на бою. Разрушающие шаги необратимы — выполняются после очистки данных.

**Tech Stack:** Integram REST (`https://ideav.ru/ateh`), `X-Authorization` токен (ротируется), xsrf для POST. curl + python3 для разбора JSON.

**Спека:** `docs/superpowers/specs/2026-06-02-abolish-cuttype-F2-schema-design.md`. Эпик «упразднение Типа резки», подпроект F2. Решение Андрея: полный F2 сейчас (test-фаза, даунтайм ОК); порядок чистки — сначала заказы, потом типы резки.

**Боевые id:** Вид сырья 1069, Тип резки **1072**, Полоса **1073** (подчинена Типу через arr-реквизит 1073 на 1072; сама Полоса up=1), Заказ **1075**, Позиция **1076** (1140 Тип резки), Производственная резка **1078** (подчинённые 1079/1080), Резка 1157 Тип резки. Отчёты: cut_planning 8384, positions_list 8409, order_pipeline 8303, cut_types_index (queryId узнать в Task 7), preferable_widths 8421 (не трогать).

---

## Task 0: Токен/xsrf и снимок состояния

**Files:** none (live).

- [ ] **Step 1: Проверить токен и снять xsrf**

```bash
export TOKEN=76f723b8-dde6-44fb-b906-1dafdbd7a421   # ротируется; при 401 — обновить у Андрея
export DB=https://ideav.ru/ateh
export XSRF=$(curl -s -H "X-Authorization: $TOKEN" "$DB/xsrf?JSON=1" | python3 -c 'import sys,json;print(json.load(sys.stdin)["_xsrf"])')
echo "xsrf=$XSRF"
```
Expected: непустой xsrf.

- [ ] **Step 2: Снимок «до» (для отката-сверки)**

```bash
curl -s -H "X-Authorization: $TOKEN" "$DB/object/1075/?JSON_OBJ&LIMIT=0,5000" | python3 -c 'import sys,json;print("заказов:",len(json.load(sys.stdin)))'
curl -s -H "X-Authorization: $TOKEN" "$DB/object/1072/?JSON_OBJ&LIMIT=0,5000" | python3 -c 'import sys,json;print("типов резки:",len(json.load(sys.stdin)))'
curl -s -H "X-Authorization: $TOKEN" "$DB/object/1073/?JSON_OBJ&LIMIT=0,5000" | python3 -c 'import sys,json;print("полос:",len(json.load(sys.stdin)))'
```
Expected: ~13 заказов; N типов; M полос. Зафиксировать числа.

---

## Task 1: Очистить таблицу Заказы (данные) — ПЕРВОЙ

**Files:** none (live, разрушающее). Позиции — подчинённые Заказа; проверить каскад.

- [ ] **Step 1: Удалить все заказы**

```bash
for id in $(curl -s -H "X-Authorization: $TOKEN" "$DB/object/1075/?JSON_OBJ&LIMIT=0,5000" | python3 -c 'import sys,json;[print(r["i"]) for r in json.load(sys.stdin)]'); do
  curl -s "$DB/_m_del/$id?JSON" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF" >/dev/null
done
```

- [ ] **Step 2: Проверить — заказов 0, позиций 0**

```bash
curl -s -H "X-Authorization: $TOKEN" "$DB/object/1075/?JSON_OBJ&LIMIT=0,5000" | python3 -c 'import sys,json;print("заказов осталось:",len(json.load(sys.stdin)))'
curl -s -H "X-Authorization: $TOKEN" "$DB/object/1076/?JSON_OBJ&LIMIT=0,5000" | python3 -c 'import sys,json;print("позиций осталось:",len(json.load(sys.stdin)))'
```
Expected: заказов 0. Если позиций >0 (каскад не сработал) — удалить их так же через `_m_del` по списку id таблицы 1076, повторить проверку.

---

## Task 2: Очистить таблицу Тип резки (данные) — ВТОРОЙ

**Files:** none (live, разрушающее). Полосы — подчинённые Типа; проверить каскад.

- [ ] **Step 1: Удалить все типы резки**

```bash
for id in $(curl -s -H "X-Authorization: $TOKEN" "$DB/object/1072/?JSON_OBJ&LIMIT=0,5000" | python3 -c 'import sys,json;[print(r["i"]) for r in json.load(sys.stdin)]'); do
  curl -s "$DB/_m_del/$id?JSON" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF" >/dev/null
done
```

- [ ] **Step 2: Проверить — типов 0, полос 0**

```bash
curl -s -H "X-Authorization: $TOKEN" "$DB/object/1072/?JSON_OBJ&LIMIT=0,5000" | python3 -c 'import sys,json;print("типов осталось:",len(json.load(sys.stdin)))'
curl -s -H "X-Authorization: $TOKEN" "$DB/object/1073/?JSON_OBJ&LIMIT=0,5000" | python3 -c 'import sys,json;print("полос осталось:",len(json.load(sys.stdin)))'
```
Expected: типов 0. Полосы (подчинённые) должны уйти; если остались — удалить по id таблицы 1073, повторить. (Пустая Полоса упростит переподчинение в Task 5/6.)

---

## Task 3: A1 — «Срок изготовления» (DATE) на Позицию и Заказ

**Files:** none (live, аддитивно). DATE = база `9` (как Дата согласования). Реквизит добавляется `_d_req/{tableId}` → берём `id` нового реквизита (НЕ `obj`), затем `_d_save/{reqId} t3` для базы DATE если нужно. По [[feedback_integram_schema_d_commands]].

- [ ] **Step 1: Добавить реквизит на Позицию (1076)**

```bash
curl -s "$DB/_d_req/1076?JSON" --data-urlencode "val=Срок изготовления" --data-urlencode "t=9" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF"
```
Expected: JSON с `id` (новый reqId) и `obj=1076`. Если `t=9` не задаёт DATE — доустановить базу через `_d_save/{reqId}` (узнать корректный параметр базы DATE по аналогии с реквизитом 8571/1130: `object/1076/?JSON_META` → req_base нового реквизита должно стать `DATE`).

- [ ] **Step 2: Добавить реквизит на Заказ (1075)**

```bash
curl -s "$DB/_d_req/1075?JSON" --data-urlencode "val=Срок изготовления" --data-urlencode "t=9" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF"
```

- [ ] **Step 3: Проверить метаданные**

```bash
for t in 1076 1075; do curl -s -H "X-Authorization: $TOKEN" "$DB/object/$t/?JSON_META" | python3 -c "import sys,json;d=json.load(sys.stdin);rt=d.get('req_type',{});rb=d.get('req_base',{});print($t,[(k,rb.get(k)) for k,v in rt.items() if 'Срок изготовления'==v])"; done
```
Expected: на 1076 и 1075 есть реквизит «Срок изготовления» с base `DATE`. Зафиксировать reqId-ы.

---

## Task 4: R1/R3 — отчёты: убрать cut_type / position_cut_type, cut_knives→SUM полос

**Files:** none (live, отчёты — таблица 28 колонки). Колонку удаляем `_m_del/{colId}`. colId находим прогоном структуры запроса.

- [ ] **Step 1: Найти colId колонок cut_type (в 8384), position_cut_type/_id (в 8409 и 8303)**

```bash
for q in 8384 8409 8303; do echo "=== query $q колонки ==="; curl -s -H "X-Authorization: $TOKEN" "$DB/object/$q/?JSON_OBJ&LIMIT=0,200" | python3 -c 'import sys,json;[print(r["i"],"|",r.get("r",[None])[0]) for r in json.load(sys.stdin)]'; done
```
Expected: список colId | имя_колонки. Отметить id колонок `cut_type`, `position_cut_type`, `position_cut_type_id`.

- [ ] **Step 2: Удалить эти колонки**

```bash
# подставить найденные colId:
# curl -s "$DB/_m_del/{colId}?JSON" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF"
```
Удалить: `cut_type` (8384); `position_cut_type`,`position_cut_type_id` (8409 и 8303, если есть в обоих).

- [ ] **Step 3: cut_knives — попытаться перевести на SUM(Полоса.Количество)**

После Task 6 (Полоса под Резкой) у колонки `cut_knives` сменить источник на реквизит «Количество» Полосы с агрегатом `t104=73` (SUM). ⚠️ Если отчёт уже джойнит Резка→Обеспечение→Позиция, добавление Резка→Полоса может размножить строки. Прогнать `report/cut_planning?JSON_KV` и сверить SUM вручную. **Если SUM некорректен — удалить колонку `cut_knives` из отчёта (перенос расчёта в F3, клиентом).** Решение зафиксировать. (Этот шаг выполняется ПОСЛЕ Task 6; здесь помечен для полноты — вернуться к нему.)

- [ ] **Step 4: Проверить прогон отчётов**

```bash
for q in cut_planning positions_list order_pipeline; do echo "=== $q ==="; curl -s -H "X-Authorization: $TOKEN" "$DB/report/$q?JSON_KV&LIMIT=0,1" | python3 -c 'import sys,json;d=json.load(sys.stdin);rows=d if isinstance(d,list) else d.get("rows",d);print(sorted(rows[0].keys()) if rows else "пусто (нет данных — ОК)")'; done
```
Expected: в ключах нет `cut_type`/`position_cut_type*`; отчёты исполняются без ошибки (после чистки данных строки могут быть пустыми — это ОК, проверяем что нет 500).

---

## Task 5: Черновой тест механизма «подчинённая таблица под родителем»

**Files:** none (live, на ЧЕРНОВЫХ таблицах — безопасно). Цель: определить рабочий `_d_*`, которым у родителя появляется подчинённая таблица (как 1079 «Расход сырья» у Резки). Решение по B1: т.к. данные Полос стёрты, **переподчинение существующей 1073 рискованно — вместо него СОЗДАТЬ новую подчинённую «Полоса» под Резкой (1078) с теми же полями и удалить старую 1073 вместе с Типом**. Имя резолвится кодом по имени — id роли не играет.

- [ ] **Step 1: Создать черновую родительскую таблицу**

```bash
curl -s "$DB/_d_obj?JSON" --data-urlencode "val=ZZ_test_parent" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF"
```
Expected: JSON с id новой таблицы (TP). Если `_d_obj` не тот эндпоинт — найти как создаётся таблица (сверить с тем, как заведены 1072/1078; при необходимости через UI-эндпоинт `_d_*`). Зафиксировать рабочий способ.

- [ ] **Step 2: Добавить подчинённую таблицу-реквизит к черновому родителю**

Отработать команду, создающую у родителя TP реквизит-`arr`, являющийся подтаблицей (как 1079 у 1078). Кандидаты: `_d_req/{TP}` с типом «таблица»/`arr`; сверить результат `object/{TP}/?JSON_META` → должен появиться `arr_type`. Зафиксировать ТОЧНУЮ рабочую команду (параметры) — она пойдёт в Task 6.

- [ ] **Step 3: Удалить черновые таблицы**

```bash
# curl -s "$DB/_m_del/{TP}?JSON" ... (или _d_ удаление таблицы); проверить object/{TP} → нет
```
Expected: черновые таблицы удалены, метаданные базы целы (прогнать любой существующий отчёт — 200).

---

## Task 6: B1 — Полоса под Производственной резкой (1078)

**Files:** none (live, разрушающее/структурное). Способ — по результату Task 5 (создать новую подчинённую «Полоса» под 1078 с полями Ширина мм / Количество / Назначение).

- [ ] **Step 1: Создать подчинённую «Полоса» под Резкой (1078)**

Командой из Task 5 завести у 1078 подчинённую таблицу «Полоса». Затем добавить ей реквизиты: «Ширина, мм» (SIGNED/число), «Количество» (NUMBER), «Назначение» (SHORT/текст) — `_d_req/{новаяПолоса}` для каждого, база как у старой Полосы 1073 (сверить `object/1073/?JSON_META`).

- [ ] **Step 2: Проверить метаданные Резки**

```bash
curl -s -H "X-Authorization: $TOKEN" "$DB/object/1078/?JSON_META" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("arr_type:",d.get("arr_type"));rt=d.get("req_type",{});print("Полоса-реквизит:",[k for k,v in rt.items() if v=="Полоса"])'
```
Expected: у 1078 появилась подчинённая «Полоса» (в arr_type) с тремя полями. Зафиксировать id новой таблицы Полоса и её реквизитов.

- [ ] **Step 3: Вернуться к Task 4 Step 3** (cut_knives→SUM по НОВОЙ Полосе резки) и довыполнить/решить.

---

## Task 7: C1/C2 + R2 — убрать ссылки Тип резки и отчёт cut_types_index

**Files:** none (live, разрушающее).

- [ ] **Step 1: Удалить реквизит Позиция «Тип резки» (1140)**

```bash
curl -s "$DB/_d_del/1140?JSON" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF"
```
(Если `_d_del` не тот эндпоинт удаления реквизита — определить корректный `_d_*` для удаления реквизита; сверить `object/1076/?JSON_META` → 1140 исчез.)

- [ ] **Step 2: Удалить реквизит Резка «Тип резки» (1157)**

```bash
curl -s "$DB/_d_del/1157?JSON" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF"
```

- [ ] **Step 3: Найти и удалить отчёт cut_types_index**

```bash
curl -s -H "X-Authorization: $TOKEN" "$DB/object/22/?JSON_OBJ&LIMIT=0,200" | python3 -c 'import sys,json;[print(r["i"],"|",r.get("r",[None])[0]) for r in json.load(sys.stdin) if "cut_types_index" in str(r.get("r",[]))]'
# затем _m_del/{queryId}
```

- [ ] **Step 4: Проверить**

```bash
curl -s -H "X-Authorization: $TOKEN" "$DB/object/1076/?JSON_META" | python3 -c 'import sys,json;print("1140 в Позиции:", "1140" in json.load(sys.stdin).get("req_type",{}))'
curl -s -H "X-Authorization: $TOKEN" "$DB/object/1078/?JSON_META" | python3 -c 'import sys,json;print("1157 в Резке:", "1157" in json.load(sys.stdin).get("req_type",{}))'
curl -s -H "X-Authorization: $TOKEN" "$DB/report/cut_types_index?JSON_KV&LIMIT=0,1" | head -c 120
```
Expected: 1140/1157 = False; cut_types_index — ошибка/нет (удалён).

---

## Task 8: C3 — дроп таблицы Тип резки (1072) + старой Полосы (1073)

**Files:** none (live, необратимо). Только после Task 6/7 (нет ссылок, Полоса под Резкой).

- [ ] **Step 1: Удалить таблицу Тип резки (1072)**

```bash
# корректный _d_ дроп таблицы (определить по Task 5; кандидат _d_del/_m_del таблицы)
curl -s "$DB/_d_del/1072?JSON" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF"
```

- [ ] **Step 2: Удалить старую таблицу Полоса (1073)** (если осталась корневой после переподчинения-через-пересоздание)

```bash
curl -s "$DB/_d_del/1073?JSON" --data-urlencode "token=$TOKEN" --data-urlencode "_xsrf=$XSRF"
```

- [ ] **Step 3: Финальная проверка целостности**

```bash
curl -s -H "X-Authorization: $TOKEN" "$DB/object/1072/?JSON_META" | head -c 120   # ожидаем ошибку/нет
for q in cut_planning positions_list order_pipeline preferable_widths material_batches; do echo -n "$q: "; curl -s -o /dev/null -w "%{http_code}\n" -H "X-Authorization: $TOKEN" "$DB/report/$q?JSON_KV&LIMIT=0,1"; done
for t in 1075 1076 1078 1074 1069; do echo -n "meta $t: "; curl -s -H "X-Authorization: $TOKEN" "$DB/object/$t/?JSON_META" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("OK" if d.get("req_type") else "BAD")'; done
```
Expected: 1072 нет; все отчёты 200; метаданные ключевых таблиц целы (req_type непустой).

---

## Task 9: Документация + память

**Files:** Modify `docs/integram-reports.md`, `docs/atex_metadata.json` (если отражает Тип резки/Полосу), память.

- [ ] **Step 1: Обновить `docs/integram-reports.md`** — убрать упоминания `cut_type`/`cut_types_index`/`position_cut_type*`; отметить cut_knives (SUM полос или «в F3»); зафиксировать новую подчинённость Полоса→Резка.

- [ ] **Step 2: Зафиксировать в `atex_metadata.json`** (если используется как фикстура) — удалить Тип резки, перенести Полосу под Резку, добавить «Срок изготовления». (Если ломает тесты — отметить для F3/F4.)

- [ ] **Step 3: Commit**

```bash
git add docs/ && git commit -m "docs(atex): F2 — упразднён Тип резки, Полоса под Резкой, Срок изготовления, отчёты"
```

- [ ] **Step 4: Обновить память** `atex_epic52_planning.md` / новый файл эпика: F2 выполнен (id новой Полосы, reqId Срока изготовления, удалённые колонки/отчёты), что осталось (F1/F3/F4 — код).

---

## Деплой / координация
Схема/отчёты — на боевой (этот план). **Код рабочих мест (F3/F4) — отдельно, деплой `update.php` Андреем.** Между F2 и деплоем кода живые production-planning/cut-calc/cut-map сломаны (test-фаза, принято). ⚠️ Параллельные сессии в общем `/home/hive/crm` уже влили #3089/#3090 — координировать, не дублировать.

## Self-review заметки
- Покрытие спеки: A1=Task3; B1=Task5(тест)+Task6; C1/C2=Task7; C3=Task8; R1=Task4(+Task6 step3); R2=Task7; R3=Task4; чистка данных (заказы→типы) = Task1→Task2 (порядок Андрея). preferable_widths не трогаем.
- ⚠️ Точные `_d_*` эндпоинты (создание/удаление таблицы и реквизита, добавление подтаблицы) НЕ захардкожены жёстко — подтверждаются на черновых таблицах (Task 5) перед боем, т.к. ошибочный `_d_*` ронял метаданные (инцидент Слиттер). Это намеренно: проверка механизма — часть плана.
- Разрушающее — после очистки данных; дроп 1072 — последним; финальная проверка целостности (Task 8 Step 3).
