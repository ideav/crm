# План переписывания CRM на стек Vue + Интеграм

## Контекст и допущения

Issue #2470 сформулирован как "Создай план по переписыванию проекта на стек Vue + Интеграм". В этом документе под Интеграмом понимается существующая платформа и API проекта, а не социальная сеть Instagram.

Цель миграции - заменить текущий набор PHP-шаблонов и крупных plain JavaScript модулей на поддерживаемый Vue-фронтенд, сохранив Интеграм как источник данных, авторизации, прав доступа, DDL/DML операций и серверного деплоя.

План не предполагает "big bang" переписывание. Основной подход - параллельная Vue-оболочка и поэкранная миграция рабочих мест с возможностью быстро вернуться на старую реализацию.

## Текущее состояние проекта

### Серверная часть

- `index.php` обслуживает маршрутизацию, авторизацию, cookie/XSRF, OAuth, работу с шаблонами и JSON-эндпоинтами.
- `include/connection.php` содержит большую часть серверных функций Интеграма.
- `templates/` содержит рабочие места, которые подставляются в `templates/main.html`.
- `update.php` и `update.conf` отвечают за обновление файлов на хостинге.
- API уже используется фронтендом напрямую: `/metadata`, `/terms?JSON`, `/object/{typeId}?JSON_DATA`, `/report/{reportId}?JSON`, `/_m_new`, `/_m_set`, `/_ref_reqs`, `/xsrf?JSON`, `/auth?JSON`.

### Фронтенд

- `templates/main.html` задает общую оболочку: верхняя панель, боковое меню, глобальные переменные `db`, `xsrf`, `token`, `user`, `role`, `grants`, `action`.
- `js/app.js` отвечает за тему, cookies, стартовую авторизацию и вспомогательные функции.
- `js/main-app.js` отвечает за меню, пользовательский dropdown, logout, mobile/sidebar поведение и модальные окна.
- `js/integram-table.js` - сгенерированный файл. Исходники лежат в `js/integram-table/*.js`, сборка выполняется через `bash build.sh`.
- Ключевые рабочие места реализованы отдельными JS/CSS наборами: `js/tables.js`, `js/dash.js`, `js/procvac.js`, `templates/kanban.html`, `css/*.css`.
- В интерфейсе уже используются PrimeIcons, а в экспериментах встречается PrimeVue icon picker. Это делает PrimeVue естественным кандидатом для Vue UI-библиотеки.

### Инструменты и документация

- `mcp-server/` содержит Node MCP-сервер для операций с Интеграм API.
- `docs/INTEGRAM_MCP_GUIDE.md`, `docs/StructureRules.md`, `docs/Roadmap.md` описывают модель данных и работу с Интеграмом.
- В репозитории нет общего `package.json` для фронтенд-сборки; Node-зависимости сейчас ограничены `mcp-server/`.

## Целевая архитектура

### Базовый стек

- Vue 3 + Vite + TypeScript.
- Pinia для клиентского состояния.
- Vue Router для маршрутов рабочих мест.
- PrimeVue + PrimeIcons для базовых компонентов и совместимости с текущей иконографикой.
- Vitest для unit/component тестов.
- Playwright для smoke/e2e и визуальной проверки ключевых рабочих мест.

### Размещение в репозитории

Предлагаемая структура:

```text
frontend/
  src/
    app/
      App.vue
      router.ts
      stores/
    integram/
      client.ts
      auth.ts
      metadata.ts
      permissions.ts
      reports.ts
      objects.ts
    shared/
      components/
      composables/
      styles/
    workspaces/
      shell/
      tables/
      table-view/
      kanban/
      dashboard/
      forms/
      procvac/
  tests/
  package.json
  vite.config.ts
```

Собранные Vite-артефакты должны попадать в версионируемую директорию, пригодную для текущего `update.php`, например `assets/vue/`. На первом этапе старые шаблоны могут подключать Vue bundle как отдельное рабочее место, а не заменять весь `templates/main.html`.

### Граница ответственности

Интеграм остается backend-of-record:

- авторизация и XSRF;
- модель таблиц, реквизитов и объектов;
- права доступа;
- отчеты;
- DDL/DML операции;
- существующие URL и совместимость с внешними ссылками.

Vue берет на себя:

- shell приложения;
- состояние интерфейса;
- рендеринг рабочих мест;
- формы, таблицы, канбан, дашборды;
- клиентские настройки вида;
- тестируемые адаптеры над текущими JSON API.

## Миграционная стратегия

### Этап 0. Инвентаризация и контракт API

1. Зафиксировать список рабочих мест и владельцев функциональности: таблицы, объект/форма, канбан, дашборд, ProcVac, SmartQ, кабинет, стартовая страница.
2. Для каждого рабочего места описать используемые эндпоинты, входные параметры и формат ответа.
3. Сформировать контрактные JSON-fixtures в `examples/` или `frontend/tests/fixtures/`.
4. Отдельно описать права доступа: как `grants`, `role`, `roleId` влияют на видимость действий.
5. Зафиксировать browser storage: cookies, localStorage ключи, настройки таблиц, темы, меню, размеров колонок.

Результат: таблица "экран -> API -> состояние -> критичные сценарии".

### Этап 1. Каркас Vue-приложения

1. Добавить `frontend/package.json`, Vite, Vue, TypeScript, Pinia, Vue Router, PrimeVue, Vitest, Playwright.
2. Настроить сборку в `assets/vue/` с версионированными именами файлов.
3. Добавить shell-страницу в существующий шаблон, которая получает `db`, `xsrf`, `user`, `role`, `grants` из текущего `templates/main.html`.
4. Добавить `integram/client.ts` с единым `fetch`-обработчиком:
   - `credentials: 'include'`;
   - нормализация ошибок;
   - XSRF/token handling;
   - режим debug tracing через query/cookie;
   - abort/retry только там, где это безопасно.
5. Добавить smoke-тест, который открывает Vue shell на mock данных.

Результат: Vue-приложение собирается и может жить рядом со старой оболочкой.

### Этап 2. Совместимый app shell

1. Перенести тему, font size, brand background, cookie consent, user menu и logout из `js/app.js` и `js/main-app.js`.
2. Перенести боковое меню с поддержкой:
   - вложенности;
   - поиска;
   - сворачивания;
   - изменения ширины;
   - mobile drawer;
   - редактирования меню для разрешенных ролей.
3. Сделать адаптер для `menuData`, который принимает текущий серверный формат без изменения backend.
4. Сохранить старые CSS variables или добавить compatibility layer, чтобы текущие рабочие места не ломались при частичной миграции.

Результат: Vue shell способен заменить большую часть `templates/main.html`, но старые рабочие места еще могут открываться внутри текущей структуры.

### Этап 3. Интеграм API SDK для фронтенда

Выделить typed API-слой:

- `auth`: `/xsrf?JSON`, `/auth?JSON`, logout, password change;
- `metadata`: `/metadata`, `/metadata/{typeId}`, `/terms?JSON`;
- `objects`: `/object/{typeId}?JSON_DATA`, `/object/{typeId}?JSON_OBJ`, `/_m_new`, `/_m_set`, delete/move/order operations;
- `reports`: `/report/{reportId}?JSON`, report pagination, filters, sort;
- `references`: `/_ref_reqs/{requisiteId}?JSON`;
- `files`: `/_upload` and file metadata;
- `settings`: object-backed UI settings currently stored in Интеграм records.

Каждый метод должен иметь:

- типы входа/выхода;
- unit tests на нормализацию данных;
- fixture с реальным или обезличенным примером ответа;
- единый формат ошибки для UI.

Результат: дальнейшая миграция компонентов не зависит от разбора URL и JSON прямо внутри Vue-компонентов.

### Этап 4. Общие компоненты

Создать shared UI слой:

- `AppModal`, `ConfirmDialog`, `ErrorDialog`, `Toast`;
- `IconButton`, `Toolbar`, `SearchInput`, `FilterBar`;
- `ReferenceSelect`, `AnyRecordPicker`, `DateInput`, `NumberInput`, `FileInput`;
- `PermissionGate`;
- `ResizablePanel`, `SplitLayout`;
- `TableSkeleton`, `EmptyState`, `ErrorState`.

Правило: новые Vue-компоненты не должны вызывать `alert()`, `confirm()` или `prompt()`. Они используют общие dialog/toast компоненты, как требуют текущие правила проекта.

Результат: рабочие места мигрируются на одинаковые UX-примитивы.

### Этап 5. Миграция рабочих мест

Рекомендуемый порядок - от меньшего риска к большему.

#### 5.1. Tables workspace

Исходные файлы: `templates/tables.html`, `js/tables.js`, `css/tables.css`.

Причины начать здесь:

- понятные API: `/terms?JSON`, создание таблиц, сохранение настроек;
- ограниченный экран;
- хороший кандидат для отработки PrimeVue, permissions и DDL UI.

Критерии готовности:

- поиск таблиц;
- папки, drag-and-drop, сохранение настроек;
- создание таблицы с автодетектом типа;
- скрытие действий без `grants['1'] === 'WRITE'`;
- Playwright smoke на открытие, поиск, модалку создания.

#### 5.2. App shell меню и рабочие ссылки

Перенести фактическое использование меню после того, как Vue Tables уже работает. Это снизит риск, потому что будет хотя бы одно полноценное Vue-рабочее место.

Критерии готовности:

- меню строится из текущего `menuData`;
- активный пункт определяется по URL;
- старые URL продолжают открываться;
- mobile layout не перекрывает контент.

#### 5.3. Kanban

Исходные файлы: `templates/kanban.html`, `crm/kanban.html`, связанные inline-скрипты и стили.

Особое внимание:

- drag-and-drop статусов;
- быстрые действия на карточке;
- связь с формами и задачами;
- фильтры менеджера/продукта/партнера;
- визуальная регрессия light/dark.

#### 5.4. Object forms and IntegramTable

Исходные файлы: `js/integram-table/*.js`, `templates/edit_obj.html`, `templates/table.html`, `css/integram-table.css`.

Это ядро CRM, поэтому миграция должна идти через адаптер:

1. Сначала завернуть текущий `IntegramTable` в Vue-компонент-bridge, чтобы shell мог использовать старый компонент.
2. Затем вынести API, форматирование, фильтры, sort/group, inline edit и subordinate tables в composables.
3. После покрытия тестами заменить рендер на Vue-компоненты.
4. Только в конце удалить bridge и старый generated bundle.

Критерии готовности:

- report/table data sources;
- filters, sort, grouping;
- column settings;
- inline edit;
- edit/create modals;
- subordinate tables;
- Excel/CSV export;
- shareable URLs;
- сохранение пользовательских настроек.

#### 5.5. Dashboard

Исходные файлы: `templates/dash.html`, `js/dash.js`, `css/dash.css`.

Это один из самых рискованных экранов из-за формул, периодов, графиков, pivot/table modes, panel filters и resize settings.

Порядок миграции:

1. Выделить parser/formatter формул в чистые функции с тестами.
2. Перенести загрузку модели и period data в API/composables.
3. Перенести table mode.
4. Перенести chart/pivot modes.
5. Перенести настройки панелей и визуализаций.

Критерии готовности:

- значения совпадают со старым dashboard на одинаковых fixtures;
- формулы покрыты unit tests;
- Playwright сравнивает smoke-сценарии по нескольким периодам;
- light/dark и tile/table modes проверены скриншотами.

#### 5.6. Специализированные рабочие места

Мигрировать после стабилизации общих компонентов:

- `procvac`;
- `smartq`;
- `cabinet`;
- `migr`;
- `info`;
- `calendar`;
- `sportzania/*`.

Для каждого рабочего места сначала описывать сценарии и API, затем мигрировать через Vue route + fixtures + Playwright smoke.

## Тестовая стратегия

### Unit tests

- Нормализация ответов Интеграм API.
- Форматирование дат, чисел, reference values.
- Permissions.
- URL state: filters, sort, grouping, selected records.
- Dashboard formulas.

### Component tests

- Shared modals, reference select, filters.
- Table toolbar and column settings.
- Form fields for each base type.
- Menu/sidebar states.

### E2E and visual checks

- Playwright smoke for each migrated workspace.
- Скриншоты light/dark для table, kanban, dashboard, forms.
- Проверка mobile viewport для shell, меню, table/form modals.
- Regression на "старый URL открывает тот же сценарий".

### Contract tests

На fixtures должны проверяться:

- `/metadata`;
- `/terms?JSON`;
- `/object/{typeId}?JSON_DATA`;
- `/object/{typeId}?JSON_OBJ`;
- `/report/{reportId}?JSON`;
- `/_ref_reqs/{requisiteId}?JSON`;
- ошибки `/_m_set` и `/_m_new`.

## Релизная стратегия

1. Добавить feature flag на уровне базы/роли/URL, например `?vue=1` или настройка в Интеграме.
2. Для каждого рабочего места держать старый и новый URL до прохождения приемки.
3. Начинать с internal/admin пользователей.
4. После приемки переключать рабочее место по умолчанию, но оставить fallback.
5. Удалять старую реализацию только после периода стабильности и проверки внешних ссылок.

Минимальный rollback: отключить feature flag и вернуть старый template/JS для конкретного рабочего места без отката базы и backend.

## Основные риски и меры снижения

| Риск | Почему важно | Мера снижения |
| --- | --- | --- |
| Неявные контракты JSON API | Старый JS часто разбирает ответы локально и терпимо к разным форматам | Fixtures + typed adapters + contract tests |
| Сложность `IntegramTable` | Компонент содержит много поведения и edge cases | Bridge first, then incremental replacement |
| Dashboard formulas | Ошибки меняют бизнес-показатели | Чистые функции + fixtures + сравнение old/new |
| Права доступа | Ошибка может показать лишние действия | PermissionGate + tests на роли |
| Сохраненные настройки пользователей | Cookies/localStorage уже используются в проде | Миграция ключей или compatibility reads |
| Существующие URL | Пользователи и внешние системы могут хранить ссылки | Route compatibility matrix |
| Деплой без npm в корне | Сейчас нет общего frontend toolchain | Изолировать сборку в `frontend/`, публиковать build artifacts |

## Контрольные точки

### Milestone 1. Vue foundation

- Vue app собирается.
- Shell открывается рядом со старой CRM.
- API client работает на fixtures.
- Есть первые unit tests и Playwright smoke.

### Milestone 2. First migrated workspace

- Tables workspace переписан на Vue.
- Старый URL и fallback сохранены.
- PR содержит before/after screenshots.
- Документирован API contract.

### Milestone 3. Shell migration

- Vue shell заменяет основную навигацию для тестовых пользователей.
- Старые рабочие места открываются из Vue shell.
- Logout, theme, sidebar, меню и permissions проверены.

### Milestone 4. Core data UI

- Table/form bridge стабилен.
- Новые Vue формы покрывают основные типы данных.
- Inline edit и subordinate tables работают на тестовой базе.

### Milestone 5. Dashboard and specialized workspaces

- Dashboard совпадает по данным со старой реализацией.
- Kanban, ProcVac и остальные специализированные экраны мигрированы по приоритету.

### Milestone 6. Decommission legacy

- Старые шаблоны и JS отключены для всех ролей.
- Compatibility fallback удален после периода стабильности.
- Документация и onboarding обновлены.

## Definition of Done для всей миграции

- Все рабочие места доступны через Vue shell.
- Старые критичные URL либо работают, либо имеют явный redirect.
- Все DDL/DML операции идут через typed Integram API client.
- Нет прямых `alert()`, `confirm()`, `prompt()` в новом коде.
- Unit, component и Playwright smoke checks проходят локально и в CI.
- Пользовательские настройки темы, меню, таблиц и фильтров сохранены или мигрированы.
- Старые generated/plain JS модули удалены только после подтвержденного fallback period.
