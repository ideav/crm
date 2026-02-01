# Integram Table Component

Компонент для отображения табличных данных из Integram API с полной поддержкой пагинации, фильтрации и настройки колонок.

## Возможности

- ✅ **Бесконечный скролл** - автоматическая подгрузка данных при прокрутке
- ✅ **Умный счетчик записей** - показывает загруженные записи, общее количество по клику
- ✅ **Динамические колонки** - автоматическая адаптация к структуре данных
- ✅ **Форматы данных** - поддержка SHORT, CHARS, NUMBER, DATE, DATETIME, BOOLEAN, MEMO, HTML, BUTTON, PWD, PATH
- ✅ **Drag & Drop** - перетаскивание колонок для изменения порядка
- ✅ **Настройки колонок** - скрытие/показ колонок через модальное окно
- ✅ **Фильтрация** - 13 типов фильтров для разных типов данных
- ✅ **Автоматическое применение фильтров** - фильтры применяются при вводе текста
- ✅ **Очистка фильтров** - кнопка очистки всех фильтров появляется при наличии активных фильтров
- ✅ **Скрытие служебных колонок** - автоматическое скрытие колонок с суффиксами ID и Стиль
- ✅ **Динамическое стилизование** - применение стилей к ячейкам через колонки Стиль
- ✅ **Persistence** - сохранение настроек в cookies браузера
- ✅ **Адаптивность** - корректное отображение на разных устройствах

## Файлы компонента

- `assets/js/integram-table.js` - standalone JS модуль (класс IntegramTable)
- `templates/integram-table.html` - legacy HTML версия (deprecated)
- `templates/table-example.html` - пример использования с демо-данными и документацией

## Быстрый старт

### 1. Подключение (рекомендуемый способ - data-атрибуты)

Просто добавьте атрибут `data-integram-table` к контейнеру и укажите параметры через data-атрибуты:

```html
<!DOCTYPE html>
<html>
<head>
    <link rel="stylesheet" href="/css/bootstrap.min.css">
    <link rel="stylesheet" href="/css/info.css">
</head>
<body>
    <div id="my-table"
         data-integram-table
         data-api-url="/api/tasks"
         data-page-size="20"
         data-cookie-prefix="my-table"
         data-title="Мои задачи"
         data-instance-name="myTable"></div>

    <script src="/js/integram-table.js"></script>
    <!-- Таблица инициализируется автоматически! -->
</body>
</html>
```

**Преимущества:**
- ✅ Конфигурация в одном месте (в HTML)
- ✅ Не нужно писать JavaScript код
- ✅ Автоматическая инициализация при загрузке страницы
- ✅ Легко редактировать параметры

### 1б. Подключение (программный способ)

Если нужен контроль через JavaScript:

```html
<!DOCTYPE html>
<html>
<head>
    <link rel="stylesheet" href="/css/bootstrap.min.css">
    <link rel="stylesheet" href="/css/info.css">
</head>
<body>
    <div id="my-table"></div>

    <script src="/js/integram-table.js"></script>
    <script>
        const myTable = new IntegramTable('my-table', {
            apiUrl: '/api/tasks',
            pageSize: 20,
            cookiePrefix: 'my-table',
            instanceName: 'myTable'
        });
    </script>
</body>
</html>
```

**Примечание:** Теперь компонент - это standalone JS модуль, не требующий jQuery!

### 2. Формат данных API

API должен принимать параметр `LIMIT` для пагинации и возвращать JSON:

```json
{
  "columns": [
    {
      "id": "4284",
      "type": "3596",
      "format": "CHARS",
      "name": "Задача",
      "granted": 1,
      "ref": 0
    }
  ],
  "data": [
    ["Значение 1"],
    ["Значение 2"]
  ],
  "total": 100
}
```

### 3. Параметры конфигурации

```javascript
new IntegramTable('container-id', {
    apiUrl: '/api/endpoint',       // URL API для загрузки данных
    pageSize: 20,                  // Количество записей на странице
    cookiePrefix: 'table-name',    // Префикс для cookies
    title: 'Название таблицы',     // Опциональный заголовок
    instanceName: 'myTable',       // Имя экземпляра для window (обязательно!)
    onCellClick: (row, col, val) => {},  // Обработчик клика по ячейке
    onDataLoad: (data) => {}       // Обработчик загрузки данных
});
```

**ВАЖНО:** Параметр `instanceName` обязателен для корректной работы event handlers (кнопки, пагинация, настройки).

### Data-атрибуты (декларативная инициализация)

При использовании data-атрибутов компонент автоматически инициализируется при загрузке страницы:

| Data-атрибут | Назначение | Пример |
|--------------|------------|--------|
| `data-integram-table` | Маркер для авто-инициализации (обязательно) | - |
| `data-api-url` | URL API для загрузки данных | `"/api/tasks"` |
| `data-page-size` | Количество записей на порции | `"20"` |
| `data-cookie-prefix` | Префикс для cookies | `"my-table"` |
| `data-title` | Заголовок таблицы | `"Задачи"` |
| `data-instance-name` | Имя переменной в window | `"myTable"` |

**Пример:**
```html
<div id="tasks"
     data-integram-table
     data-api-url="/crm/report/123?JSON"
     data-page-size="50"
     data-cookie-prefix="tasks-table"
     data-title="Список задач"
     data-instance-name="tasksTable"></div>
```

После загрузки доступ к таблице: `window.tasksTable.loadData()`

**Преимущества:**
- Все параметры в одном месте (в HTML-разметке)
- Не нужно писать отдельный скрипт инициализации
- Удобно для Integram шаблонов с подстановкой `{_global_.z}`

## Автоматическое скрытие колонок

Компонент автоматически скрывает служебные колонки по определенным правилам:

### Колонки с суффиксом "ID"

Если в таблице есть колонка "Клиент" и "КлиентID", колонка "КлиентID" будет автоматически скрыта. Значение ID остается доступным для сохранения изменений, но не отображается пользователю.

### Колонки со стилями

Если в таблице есть колонка "Статус" и "СтатусСтиль" (или "Status" и "StatusStyle"), колонка со стилями будет скрыта, а её значение будет применено как CSS-стиль к соответствующей ячейке в колонке "Статус".

**Пример:**
```
Колонки в API:
- Статус (значение: "Активен")
- СтатусСтиль (значение: "color: green; font-weight: bold;")

Результат:
- Отображается только колонка "Статус"
- Ячейка "Активен" отображается зеленым жирным шрифтом
```

Поиск колонок со стилями **не зависит от регистра** (Style, style, Стиль, стиль - все варианты работают).

## Бесконечный скролл

Компонент использует бесконечный скролл вместо традиционной пагинации:

- **Автоматическая подгрузка** - при прокрутке вниз (за 200px до конца таблицы) автоматически загружаются следующие записи
- **Умное определение наличия данных** - запрашивается `pageSize + 1` записей (например, 21 вместо 20), если пришло 21 - значит есть еще данные
- **Счетчик записей** - внизу отображается "Показано M из N", где:
  - M - количество загруженных записей
  - N - изначально "?" (кликабельный), при клике запрашивается через `RECORD_COUNT=1`
- **Сброс при фильтрации** - при изменении фильтров данные загружаются заново

### Технические детали

Компонент добавляет параметр `LIMIT` к запросу:

- Первая порция: `LIMIT=0,21` (запрашивается 21, отображается 20)
- Вторая порция: `LIMIT=20,21` (если была загружена 21 запись)
- Третья порция: `LIMIT=40,21`

Формат: `LIMIT={offset},{count}`

### Запрос общего количества

Для получения общего количества записей используется параметр `RECORD_COUNT=1`:

```
/api/tasks?RECORD_COUNT=1&FR_4284=test%
```

API возвращает JSON объект с полем `count`:

```json
{
    "count": "142"
}
```

## Фильтрация

Фильтры автоматически применяются при вводе текста с задержкой 500мс (debounce) для оптимизации количества запросов к API.

**Новый дизайн фильтров:** Иконка типа фильтра теперь находится внутри поля ввода слева.

### Типы фильтров

Доступные операторы зависят от типа данных колонки:

#### Для текстовых полей (CHARS, SHORT, MEMO):
- `^` - начинается с... → `FR_{T}={X}%`
- `=` - равно → `FR_{T}={X}`
- `≠` - не равно → `FR_{T}=!{X}`
- `~` - содержит → `FR_{T}=%{X}%`
- `!` - не содержит → `FR_{T}=!%{X}%`
- `!^` - не начинается → `FR_{T}=!%{X}`
- `$` - заканчивается → `FR_{T}=%{X}`
- `(,)` - в списке → `FR_{T}=IN({X})`

#### Для числовых полей (NUMBER, SIGNED):
- `^` - начинается с... → `FR_{T}={X}%`
- `=` - равно
- `≠` - не равно
- `>` - больше
- `<` - меньше
- `≥` - не меньше
- `≤` - не больше
- `...` - в диапазоне → `FR_{T}={X1}&TO_{T}={X2}`

#### Для дат (DATE, DATETIME):
- Аналогично числовым полям

#### Общие:
- `%` - не пустое → `FR_{T}=%`
- `!%` - пустое → `FR_{T}=!%`

### Пример запроса с фильтрами

```
/api/tasks?LIMIT=0,20&FR_4284=test%&FR_4290=>=100
```

Где:
- `FR_4284=test%` - задачи, начинающиеся с "test"
- `FR_4290=>=100` - ID исполнителя >= 100

## Форматы колонок

| Формат | ID | Описание | Особенности отображения |
|--------|-------|----------|------------------------|
| SHORT | 3 | Короткая строка (до 127 символов) | Обычный текст |
| CHARS | 8 | Строка без ограничения длины | Обычный текст |
| DATE | 9 | Дата | Формат dd.mm.yyyy (парсинг из API: DD.MM.YYYY) |
| NUMBER | 13 | Целое число | Выравнивание по правому краю |
| SIGNED | 14 | Число с десятичной частью | Выравнивание по правому краю |
| BOOLEAN | 11 | Логическое значение | "Да" / "Нет" |
| MEMO | 12 | Многострочное поле | Max-width 300px, перенос строк |
| DATETIME | 4 | Дата и время | Формат dd.mm.yyyy hh:mm:ss (парсинг из API: DD.MM.YYYY HH:MM:SS) |
| FILE | 10 | Файл | Обычный текст |
| HTML | 2 | HTML-текст | Рендерится как HTML (осторожно с XSS!) |
| BUTTON | 7 | Кнопка действия | Отображается как `<button>` |
| PWD | 6 | Пароль | Маскируется звездочками ****** |
| GRANT | 5 | Права доступа | Обычный текст |
| CALCULATABLE | 15 | Вычисляемое поле | Обычный текст |
| REPORT_COLUMN | 16 | Колонка отчета | Обычный текст |
| PATH | 17 | Путь к файлу | Обычный текст |

## Использование в существующих шаблонах

### Способ 1: Data-атрибуты (рекомендуется)

```html
<!-- В секции content -->
<div class="content">
    <div id="tasks-table"
         data-integram-table
         data-api-url="/{_global_.z}/report/4283?JSON"
         data-page-size="20"
         data-cookie-prefix="tasks-table"
         data-title="Задачи"
         data-instance-name="tasksTable"></div>
</div>

<!-- Перед закрывающим тегом body -->
<link rel="stylesheet" href="/download/{_global_.z}/css/info.css" />
<script src="/download/{_global_.z}/js/integram-table.js"></script>
<!-- Таблица инициализируется автоматически! -->
```

### Способ 2: Программная инициализация

Если нужны обработчики событий (onCellClick, onDataLoad):

```html
<!-- В секции content -->
<div class="content">
    <div id="tasks-table"></div>
</div>

<!-- Перед закрывающим тегом body -->
<link rel="stylesheet" href="/download/{_global_.z}/css/info.css" />
<script src="/download/{_global_.z}/js/integram-table.js"></script>
<script>
    const tasksTable = new IntegramTable('tasks-table', {
        apiUrl: '/{_global_.z}/report/4283?JSON',
        pageSize: 20,
        cookiePrefix: 'tasks-table',
        title: 'Задачи',
        instanceName: 'tasksTable',
        onCellClick: function(row, col, value) {
            // Обработка клика по ячейке
            console.log('Clicked:', row, col, value);
        }
    });
</script>
```

## Сохранение состояния

Компонент автоматически сохраняет в cookies:
- Порядок колонок
- Видимость колонок

Cookie имеет формат: `{cookiePrefix}-state={"order":[...],"visible":[...]}`

Срок хранения: 1 год

## События

### onCellClick

Вызывается при клике на ячейку таблицы:

```javascript
onCellClick: function(rowIndex, colIndex, value) {
    console.log('Row:', rowIndex);
    console.log('Column:', colIndex);
    console.log('Value:', value);
}
```

### onDataLoad

Вызывается после успешной загрузки данных:

```javascript
onDataLoad: function(data) {
    console.log('Loaded columns:', data.columns);
    console.log('Loaded rows:', data.data.length);
    console.log('Total rows:', data.total);
}
```

## Методы API

После создания экземпляра доступны следующие методы:

```javascript
const table = new IntegramTable('my-table', {...});

// Перезагрузить данные (сброс до начала)
table.loadData();

// Загрузить следующую порцию (append mode)
table.loadData(true);

// Запросить общее количество записей
table.fetchTotalCount();

// Включить/выключить фильтры
table.toggleFilters();

// Проверить наличие активных фильтров
table.hasActiveFilters(); // возвращает true/false

// Очистить все фильтры
table.clearAllFilters();

// Открыть настройки колонок
table.openColumnSettings();

// Закрыть настройки колонок
table.closeColumnSettings();

// Сохранить состояние в cookies
table.saveColumnState();

// Загрузить состояние из cookies
table.loadColumnState();
```

## Стилизация

Компонент использует встроенные стили Bootstrap и дополнительные CSS-классы:

- `.integram-table-wrapper` - обертка таблицы
- `.integram-table` - сама таблица
- `.integram-table-header` - заголовок с кнопками
- `.integram-table-settings` - иконка настроек
- `.filter-row` - строка с фильтрами
- `.filter-cell` - ячейка фильтра
- `.filter-type` - кнопка выбора типа фильтра
- `.filter-input` - поле ввода фильтра
- `.filter-icon-inside` - иконка типа фильтра внутри поля ввода
- `.filter-input-with-icon` - поле ввода с иконкой слева
- `.scroll-counter` - счетчик записей внизу таблицы
- `.total-count-unknown` - кликабельный "?" для запроса общего количества
- `.column-settings-modal` - модальное окно настроек
- `.column-settings-overlay` - затемнение фона

Для кастомизации переопределите эти классы в своем CSS.

## Решение проблем

### Данные не загружаются

1. Проверьте формат ответа API - он должен содержать `columns`, `data` и `total`
2. Откройте Developer Tools → Network и проверьте запрос
3. Убедитесь, что API поддерживает параметр `LIMIT`
4. Для получения общего количества API должен поддерживать `RECORD_COUNT=1` и возвращать простое число

### Бесконечный скролл не работает

1. Проверьте, что API возвращает `pageSize + 1` записей при наличии данных
2. Убедитесь, что не заблокированы события `scroll` на window
3. Проверьте в консоли браузера наличие ошибок JavaScript

### Колонки не перетаскиваются

1. Проверьте, что браузер поддерживает HTML5 Drag and Drop API
2. Убедитесь, что не заблокированы события dragstart/dragover/drop

### Фильтры не работают

1. Проверьте, что API корректно обрабатывает параметры `FR_{columnId}`
2. Для диапазонов также должен поддерживаться параметр `TO_{columnId}`

### Настройки не сохраняются

1. Проверьте, что cookies разрешены в браузере
2. Убедитесь, что `cookiePrefix` уникален для каждой таблицы на странице

## Пример интеграции с Integram API

```javascript
// Для запроса: GET /{db}/type/{typeId}?LIMIT=0,20&FR_4284=test%

const table = new IntegramTable('my-table', {
    apiUrl: '/' + db + '/type/' + typeId,
    pageSize: 20,
    cookiePrefix: 'type-' + typeId,
    onDataLoad: function(data) {
        // Обновить счетчик записей
        document.getElementById('total-count').textContent = data.total;
    },
    onCellClick: function(row, col, value) {
        // Открыть форму редактирования записи
        const rowId = data.data[row][0]; // Предполагаем, что ID в первой колонке
        openEditForm(rowId);
    }
});
```

## Лицензия

Этот компонент разработан для использования с Integram CRM.

## Автор

Создано для решения issue #2 в репозитории ideav/crm
