// Test deriveStatusesFromData logic

var defaultMapping = {
    title: 'Карточка',
    description: 'Описание',
    contact: 'Контакт',
    status: 'Статус',
    statusId: 'СтатусID',
    date: 'Дата',
    phone: 'Телефон',
    email: 'Email',
    amount: 'Сумма',
    activity: 'Activity',
    cardId: 'ID'
};

var defaultStatusMapping = {
    name: 'Статус',
    id: 'СтатусID',
    color: 'Цвет'
};

function deriveStatusesFromData(data, mapping, statusMapping) {
    var seen = {};
    var statuses = [];

    for (var i = 0; i < data.length; i++) {
        var card = data[i];
        var statusId = card[mapping.statusId] || card[statusMapping.id] || '';
        var statusName = card[mapping.status] || card[statusMapping.name] || '';

        if (!statusName) continue;
        var key = String(statusId) + '||' + statusName;
        if (!seen[key]) {
            seen[key] = true;
            var statusObj = {};
            statusObj[statusMapping.name] = statusName;
            statusObj[statusMapping.id] = statusId;
            statusObj[statusMapping.color] = null;
            statuses.push(statusObj);
        }
    }

    return statuses;
}

// Test with report-type data
var reportData = [
    { 'Карточка': 'Card 1', 'Статус': 'В работе', 'СтатусID': '101' },
    { 'Карточка': 'Card 2', 'Статус': 'Завершено', 'СтатусID': '102' },
    { 'Карточка': 'Card 3', 'Статус': 'В работе', 'СтатусID': '101' },
    { 'Карточка': 'Card 4', 'Статус': 'Новый', 'СтатусID': '100' },
];

var statuses = deriveStatusesFromData(reportData, defaultMapping, defaultStatusMapping);
console.log('Derived statuses from report data:');
console.log(JSON.stringify(statuses, null, 2));

// Test with data missing status
var partialData = [
    { 'Карточка': 'Card 1', 'Статус': 'В работе', 'СтатусID': '101' },
    { 'Карточка': 'Card 2' },  // no status
];

var statuses2 = deriveStatusesFromData(partialData, defaultMapping, defaultStatusMapping);
console.log('\nDerived statuses from partial data:');
console.log(JSON.stringify(statuses2, null, 2));
