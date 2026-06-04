# Спецификация: dashboards на отчётах (минимум серверных запросов)

Дата: 2026-06-01. Приложение: atex/ateh (Integram, ideav/crm).

## Цель и принцип

Рабочее место «Дашборды и отчёты» (`download/atex/js/dashboards.js`) сейчас тянет
данные **~10 запросами** (6 полных выгрузок таблиц `object/` + 4 `_count`) и
джойнит/агрегирует на клиенте. Перевести на **минимум серверных запросов**: тянуть
данные отчётами (`report/`), а агрегации/счётчики считать на клиенте.

**Правило проекта (вносится в инструкцию):** минимизируй число серверных запросов —
данные тяни минимумом отчётов `report/`, агрегации и счётчики считай на клиенте.
Фронт-вычисления дёшевы; разовая трудоёмкость кода окупается годами сниженной
нагрузки на сервер.

## Что рисует dashboards (5 виджетов)

1. **Поток (flow)** — Заказ→Позиция→Обеспечение→Резка→ГП (`productionFlow`/`makeRow`).
2. **Заказы по статусам** (`ordersByStatus`).
3. **Загрузка слиттеров** (`slitterLoad`) — резки по слиттеру: count + погонаж + by-status.
4. **Выпуск ГП** (`gpOutput`) — партии ГП: count + рулоны + метраж + by-status.
5. **Остатки сырья** (`materialStock`) — Партия сырья по виду: Получено/Остаток м².

Виджеты 1–4 строятся вокруг цепочки заказ→…→ГП. Виджет 5 — отдельный корень
(Партия сырья не привязана к заказу, в pipeline её нет).

## Решение: 2 отчёта, агрегации на клиенте

### Отчёт A: `order_pipeline` (queryId 8303) — расширить

К существующим 15 колонкам добавить (питают и поток, и агрегации 2–4):

| Колонка (`t100`) | Источник `t28` | Функция |
|---|---|---|
| position_status | 1146 | — |
| position_length_m | 1143 | — |
| cut_slitter | 1156 Слиттер (ref) | — |
| cut_footage_m | 1168 Погонаж факт | — |
| gp_status | 1192 | — |
| gp_rolls | 1188 | — |
| gp_footage_m | 1189 | — |
| gp_address | 1191 | — |
| gp_cut_id | 1185 ГП→Резка (ref) | abn_ID (t104=85) — для fallback flow `gpByCut` |
| order_deadline | Срок выполнения (date) Заказа | фильтр диапазона дат сверху (ideav/crm#3073) |

Один запрос `report/order_pipeline?JSON_KV` кормит виджеты 1–4.

> **#3073 — `order_deadline`:** колонка читается как `order.deadline` в
> `rowsToEntities`. Если в боевой таблице «Заказ» нет реквизита «Срок выполнения»
> (date), его нужно завести и добавить колонкой в отчёт `order_pipeline`. Пока
> колонки нет, диапазон дат корректно деградирует: при пустых границах виден срез
> актуальных заказов, при заполненных — пустой срез (срок выполнения не задан).

### Отчёт B: `material_stock` (новый) — Партия сырья (1074)

| Колонка | Источник `t28` | Функция |
|---|---|---|
| material | 1117 Вид сырья (ref) | — |
| material_received_m2 | 1121 Получено, м² | — |
| material_remainder_m2 | 1123 Остаток, м² | — |

Один запрос `report/material_stock?JSON_KV` кормит виджет 5.

### dashboards.js

- Загрузка: вместо `loadAll`×6 + `count`×4 — два `report/{имя}?JSON_KV`.
- Новый чистый слой **`rowsToEntities(pipelineRows)`** → `{ orders, positions,
  provisions, cuts, gpBatches }`: dedup по `*_id`, родительские ссылки из колонок
  строки (`position.orderId = order_id`, `provision.positionId = position_id`,
  `provision.cutId = cut_id`, `provision.gpId = gp_id`, `gp.cutId = gp_cut_id`).
  Поля сущностей — под ключи существующих функций (`status`, `slitter`, `footage`,
  `rolls`, `address`, `number`, `cutType`, `width`, `length`).
- Сырьё: `materialRows` → `[{ material, received, remainder }]`.
- **Существующие функции `productionFlow`, `ordersByStatus`, `slitterLoad`,
  `gpOutput`, `materialStock`, `groupBy` и рендер — не меняются.** Меняется только
  источник данных (отчёты) и добавляется `rowsToEntities`.
- Счётчики (`_count`) убираются — берутся как длины массивов сущностей.

## Тесты

- Юнит-тест `rowsToEntities`: dedup по id; родительские ссылки; пустые поздние
  стадии (LEFT JOIN) не создают фантомных cut/gp.
- Существующие тесты агрегации (`ordersByStatus`/`slitterLoad`/`gpOutput`/
  `materialStock`) остаются зелёными (функции не тронуты).

## Деплой

- Отчёты создаются/расширяются в боевой ateh через API (как `order_pipeline`).
- Код dashboards — PR в ideav/crm через форк unidel2035; форму деплоит Андрей
  (update.php). Имена отчётов (`order_pipeline`, `material_stock`) хардкодятся в
  dashboards по соглашению (латиница snake_case, без префикса БД).

## Вне объёма

- Серверная агрегация в отчётах (SUM/COUNT) — не нужна: считаем на клиенте.
- Прочие РМ (production-planning, portal) — отдельные задачи.
