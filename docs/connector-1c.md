# 1C Connector workplace (`connector-1c`)

Universal connector that links an Integram database to a 1C:Enterprise base
through the **standard OData interface**, exports the data structure
(`$metadata`) and the data itself as JSON, and prepares everything for
subsequent mapping by an AI agent. Requested in
[issue #3370](https://github.com/ideav/crm/issues/3370).

- Workplace template: [`templates/connector-1c.html`](../templates/connector-1c.html)
- Menu wiring: top-menu entry **«1С Коннектор»** → action `connector-1c`
  (`index.php`, `&top_menu` block), shown to users whose `RepoGrant()` is not
  `BARRED` — next to **GS Sync**.

Open it from the top menu, or directly at `https://<host>/<db>/?action=connector-1c`.

## Why OData (and not HTTP services or COM)

OData is the only transport that asks the 1C administrator for **no code** — only
to publish the base and tick one checkbox. The structure is then served
automatically and the data is read with plain GET requests.

| Criterion | OData | HTTP services | COM |
|-----------|-------|---------------|-----|
| 1C admin actions | Publish base + tick the OData checkbox | Write 1C code | Install the 1C platform on the server |
| Get the structure | `$metadata` — automatic | Write a method yourself | Through COM objects |
| Read the data | Ready-made GET requests | Write a method yourself | Direct access |
| Universality | Works with any standard configuration | Depends on the code written | Windows only |

## How it works

```
            ┌─────────────┐
            │  Integram   │
            │  (browser)  │
            └──────┬──────┘
                   │ fetch (JS, HTTP Basic Auth)
                   ▼
┌──────────────────────────────────────────┐
│           1C server (Apache/IIS)          │
│  OData endpoint                           │
│  /base/odata/standard.odata/              │
│  ├─ $metadata               → XML schema  │
│  ├─ Catalog_Номенклатура    → data        │
│  ├─ Document_ЗаказКлиента   → data        │
│  └─ InformationRegister_*   → data        │
└──────────────────────────────────────────┘
```

The browser talks to 1C directly. The workplace:

1. **Connects** to the published OData endpoint (URL + login/password, HTTP Basic Auth).
2. **Loads** `$metadata` and parses the XML into a flat list of catalogs,
   documents and registers with their attributes.
3. **Maps** every 1C type (`Edm.*`) to an Integram base type (see the table below).
4. **Exports the structure** as `1c-structure.json` — the input for the mapping AI agent.
5. **Exports the data** for the selected tables, paginating with `$top`/`$skip`,
   as `1c-data.json`.

The workplace is a self-contained client-side template — it has no server-side
`case` in `index.php` and stores no secrets on the server. Connection settings
(URL + login, never the password) are remembered per database in `localStorage`
when «Запомнить URL и логин» is ticked.

## Type mapping (1C OData → Integram)

Base type codes follow [`docs/StructureRules.md`](StructureRules.md). The pure
mapping function is `window.Connector1C.mapType(edmType, maxLength)`.

| 1C type (OData) | Integram type | Code |
|-----------------|---------------|------|
| `Edm.String` (no `MaxLength` or > 127) | CHARS | 8 |
| `Edm.String` (`MaxLength` ≤ 127) | SHORT | 3 |
| `Edm.Guid` | SHORT | 3 |
| `Edm.Boolean` | BOOLEAN | 11 |
| `Edm.Byte` / `Edm.SByte` / `Edm.Int16` / `Edm.Int32` / `Edm.Int64` | NUMBER | 13 |
| `Edm.Single` / `Edm.Double` / `Edm.Decimal` | SIGNED | 14 |
| `Edm.Date` | DATE | 9 |
| `Edm.DateTime` / `Edm.DateTimeOffset` | DATETIME | 4 |
| `Edm.Binary` | FILE | 10 |
| `NavigationProperty` (link) | SHORT | 3 |

Entity prefixes are classified by `window.Connector1C.classifyEntity(name)`:
`Catalog_*` → Справочник, `Document_*` → Документ, `InformationRegister_*` →
Регистр сведений, `AccumulationRegister_*` → Регистр накопления, and so on.
Service types prefixed `StandardODATA_` are skipped.

## CORS

The browser fetches the 1C server directly, so the request is subject to the
browser's same-origin policy. Either host 1C on the same origin as Integram, or
configure the 1C web server (Apache/IIS) to send CORS headers, for example:

```
Access-Control-Allow-Origin: https://<integram-host>
Access-Control-Allow-Headers: Authorization, Accept
Access-Control-Allow-Methods: GET, OPTIONS
```

If the connection fails with a network error (`Failed to fetch`) while
`$metadata` opens fine in a separate browser tab, the cause is almost always a
missing CORS header.

## Instruction for the 1C administrator

Hand the block below to the 1C administrator. It is the minimum set of actions
required to grant read access.

> ### Шаг 1. Опубликовать базу на веб-сервере
> - Открыть базу в режиме Конфигуратора.
> - Администрирование → Публикация на веб-сервере.
> - Выбрать веб-сервер (Apache 2.4 / IIS).
> - **Обязательно отметить галочку «Публиковать стандартный интерфейс OData».**
> - Нажать ОК.
>
> ### Шаг 2. Создать пользователя для API
> - Зайти в базу в режиме Предприятия под администратором.
> - Администрирование → Пользователи → Создать.
> - **Имя:** `api_integram`.
> - **Пароль:** надёжный (запишите — понадобится для коннектора).
> - **Полные права:** НЕТ — дать только «Чтение» для нужных справочников,
>   документов и регистров.
>
> ### Шаг 3. Проверить доступ
> Открыть в браузере и ввести логин/пароль `api_integram`:
> ```
> https://ваш-сервер/имя-базы/odata/standard.odata/$metadata
> ```
> Должен открыться XML с описанием структуры.
>
> ### Шаг 4. Передать данные администратору Интеграма
> - URL: `https://ваш-сервер/имя-базы/odata/standard.odata/`
> - Логин: `api_integram`
> - Пароль: ________
>
> **Важно.** OData отдаёт только те данные, на которые у пользователя есть права,
> и не позволяет изменять данные (только чтение). Выгрузка структуры
> (`$metadata`) доступна любому пользователю с правом входа.

## Prompt for the mapping AI agent

After the structure and data are exported, a separate mapping AI agent matches
1C entities to Integram tables. Feed it `1c-structure.json` (and, when needed,
`1c-data.json`) together with the prompt below.

> # Задача: сопоставить структуру 1С с таблицами Интеграма
>
> ## Вход
> - `1c-structure.json` — список сущностей 1С (справочники, документы, регистры)
>   с полями и уже проставленным типом Интеграма для каждого поля.
> - При необходимости `1c-data.json` — выгруженные данные по выбранным таблицам.
>
> ## Что сделать
> 1. Для каждой сущности 1С предложить целевую таблицу Интеграма (существующую
>    или новую), например `Catalog_Контрагенты` → `Клиенты`,
>    `Catalog_Номенклатура` → `Товары`.
> 2. Для каждого поля 1С предложить поле целевой таблицы и тип (используя
>    `integramType`/`integramCode` из структуры; GUID → SHORT, длинные строки →
>    CHARS).
> 3. Сохранить результат как пары «сущность → таблица» и «поле → поле».
>
> ## Чего не делать
> - Не писать код на стороне 1С.
> - Не требовать COM-соединения или HTTP-сервисов 1С.
> - Не выполнять синхронизацию в реальном времени — это отложенная задача.

## Scope

This workplace covers everything up to and including the export step described
in the issue: connect, read the structure, map types, paginate the data, and
emit JSON for the mapping stage. Writing the mapped data back into Integram
tables is the mapping AI agent's separate stage and is intentionally out of
scope here.
