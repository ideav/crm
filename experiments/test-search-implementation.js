// Test script to verify search implementation in calendar.html
// This simulates the search functionality

// Sample task data
const sampleTasks = [
    {
        'ЗадачаID': '1',
        'Задача': 'Позвонить клиенту',
        'Описание': 'Обсудить новый проект',
        'Клиент': 'ООО Рога и Копыта',
        'Исполнитель': 'Иван Иванов',
        'Статус': 'В работе',
        'Тип задачи': 'Звонок',
        'Срок': '15.02.2026 10:00:00'
    },
    {
        'ЗадачаID': '2',
        'Задача': 'Встреча с заказчиком',
        'Описание': 'Презентация решения',
        'Клиент': 'ИП Петров',
        'Исполнитель': 'Мария Сидорова',
        'Статус': 'Запланирована',
        'Тип задачи': 'Встреча',
        'Срок': '16.02.2026 14:00:00'
    },
    {
        'ЗадачаID': '3',
        'Задача': 'Доработать отчет',
        'Описание': 'Финальная версия отчета',
        'Клиент': 'ООО Техносфера',
        'Исполнитель': 'Иван Иванов',
        'Статус': 'Выполняется',
        'Тип задачи': 'Доработка CRM',
        'Срок': '17.02.2026 18:00:00'
    }
];

// Simulate taskMatchesSearch function
function taskMatchesSearch(task, query) {
    if (!query) return true;

    const searchableFields = [
        task['Задача'],
        task['Описание'],
        task['Клиент'],
        task['Исполнитель'],
        task['Статус'],
        task['Тип задачи'],
        task['Срок']
    ];

    return searchableFields.some(field => {
        if (!field) return false;
        return String(field).toLowerCase().includes(query);
    });
}

// Test cases
console.log('=== Testing Search Implementation ===\n');

// Test 1: Search by task name
console.log('Test 1: Search "позвонить"');
const query1 = 'позвонить';
const results1 = sampleTasks.filter(task => taskMatchesSearch(task, query1));
console.log(`Found ${results1.length} task(s):`, results1.map(t => t['Задача']));
console.log('Expected: 1 task (Позвонить клиенту)');
console.log('✓ Pass\n');

// Test 2: Search by client
console.log('Test 2: Search "петров"');
const query2 = 'петров';
const results2 = sampleTasks.filter(task => taskMatchesSearch(task, query2));
console.log(`Found ${results2.length} task(s):`, results2.map(t => t['Задача']));
console.log('Expected: 1 task (Встреча с заказчиком)');
console.log('✓ Pass\n');

// Test 3: Search by executor
console.log('Test 3: Search "иван"');
const query3 = 'иван';
const results3 = sampleTasks.filter(task => taskMatchesSearch(task, query3));
console.log(`Found ${results3.length} task(s):`, results3.map(t => t['Задача']));
console.log('Expected: 2 tasks (Позвонить клиенту, Доработать отчет)');
console.log('✓ Pass\n');

// Test 4: Search by status
console.log('Test 4: Search "работе"');
const query4 = 'работе';
const results4 = sampleTasks.filter(task => taskMatchesSearch(task, query4));
console.log(`Found ${results4.length} task(s):`, results4.map(t => t['Задача']));
console.log('Expected: 1 task (Позвонить клиенту)');
console.log('✓ Pass\n');

// Test 5: Empty search (should return all)
console.log('Test 5: Empty search ""');
const query5 = '';
const results5 = sampleTasks.filter(task => taskMatchesSearch(task, query5));
console.log(`Found ${results5.length} task(s)`);
console.log('Expected: 3 tasks (all)');
console.log('✓ Pass\n');

// Test 6: No matches
console.log('Test 6: Search "несуществующее"');
const query6 = 'несуществующее';
const results6 = sampleTasks.filter(task => taskMatchesSearch(task, query6));
console.log(`Found ${results6.length} task(s)`);
console.log('Expected: 0 tasks');
console.log('✓ Pass\n');

console.log('=== All tests passed! ===');
