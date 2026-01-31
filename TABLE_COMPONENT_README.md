# Integram Table Component

Компонент для отображения табличных данных из Integram API с полной поддержкой пагинации, фильтрации и настройки колонок.

## Возможности

- ✅ **Пагинация** - загрузка данных порциями по 20 записей (настраивается)
- ✅ **Динамические колонки** - автоматическая адаптация к структуре данных
- ✅ **Форматы данных** - поддержка SHORT, CHARS, NUMBER, DATE, DATETIME, BOOLEAN, MEMO, HTML, BUTTON, PWD, PATH
- ✅ **Drag & Drop** - перетаскивание колонок для изменения порядка
- ✅ **Настройки колонок** - скрытие/показ колонок через модальное окно
- ✅ **Фильтрация** - 13 типов фильтров для разных типов данных
- ✅ **Автоматическое применение фильтров** - фильтры применяются при вводе текста
- ✅ **Скрытие служебных колонок** - автоматическое скрытие колонок с суффиксами ID и Стиль
- ✅ **Динамическое стилизование** - применение стилей к ячейкам через колонки Стиль
- ✅ **Persistence** - сохранение настроек в cookies браузера
- ✅ **Адаптивность** - корректное отображение на разных устройствах

## Файлы компонента

- `assets/js/integram-table.js` - standalone JS модуль (класс IntegramTable)
- `templates/integram-table.html` - legacy HTML версия (deprecated)
- `templates/table-example.html` - пример использования с демо-данными и документацией

## Быстрый старт

### 1. Подключение

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

## Пагинация

Компонент автоматически добавляет параметр `LIMIT` к запросу:

- Первая страница: `LIMIT=0,20`
- Вторая страница: `LIMIT=20,20`
- Третья страница: `LIMIT=40,20`

Формат: `LIMIT={offset},{count}`

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

| Формат | Описание | Особенности отображения |
|--------|----------|------------------------|
| SHORT | Короткая строка (до 127 символов) | Обычный текст |
| CHARS | Строка без ограничения длины | Обычный текст |
| NUMBER | Целое число | Выравнивание по правому краю |
| SIGNED | Число с десятичной частью | Выравнивание по правому краю |
| DATE | Дата | Формат dd.mm.yyyy |
| DATETIME | Дата и время | Формат dd.mm.yyyy hh:mm:ss |
| BOOLEAN | Логическое значение | "Да" / "Нет" |
| MEMO | Многострочное поле | Max-width 300px, перенос строк |
| HTML | HTML-текст | Рендерится как HTML (осторожно с XSS!) |
| BUTTON | Кнопка действия | Отображается как `<button>` |
| PWD | Пароль | Маскируется звездочками ****** |
| FILE | Файл | Обычный текст |
| PATH | Путь к файлу | Обычный текст |

## Использование в существующих шаблонах

Чтобы добавить таблицу в существующий шаблон (например, в `main.html`):

```html
<!-- В секции content -->
<div class="content">
    <div id="tasks-table"></div>
</div>

<!-- Перед закрывающим тегом body -->
<script src="templates/integram-table.html"></script>
<script>
    const tasksTable = new IntegramTable('tasks-table', {
        apiUrl: '/{_global_.z}/api/tasks',
        pageSize: 20,
        cookiePrefix: 'tasks-table',
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

// Перезагрузить данные
table.loadData();

// Следующая страница
table.nextPage();

// Предыдущая страница
table.prevPage();

// Включить/выключить фильтры
table.toggleFilters();

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
- `.pagination-controls` - элементы управления пагинацией
- `.column-settings-modal` - модальное окно настроек
- `.column-settings-overlay` - затемнение фона

Для кастомизации переопределите эти классы в своем CSS.

## Решение проблем

### Данные не загружаются

1. Проверьте формат ответа API - он должен содержать `columns`, `data` и `total`
2. Откройте Developer Tools → Network и проверьте запрос
3. Убедитесь, что API поддерживает параметр `LIMIT`

### Колонки не перетаскиваются

1. Убедитесь, что подключен jQuery UI: `<script src="/js/jquery-ui.min.js"></script>`
2. Проверьте, что браузер поддерживает HTML5 Drag and Drop API

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
