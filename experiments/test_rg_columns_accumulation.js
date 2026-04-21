// Simulate the bug and the fix

// Test data from the issue: each row has one RGcolumns value
var jsonData = [
    { panelID: '1035', RG: '1', RGtype: 'rg', rgHead: '', RGsourceID: '', RGcolumns: 'План', RGcolumnsID: '1126', itemID: '1055', item: 'Вовлеченность', value: '' },
    { panelID: '1035', RG: '1', RGtype: 'rg', rgHead: '', RGsourceID: '', RGcolumns: 'Факт', RGcolumnsID: '1127', itemID: '1055', item: 'Вовлеченность', value: '' },
    { panelID: '1035', RG: '1', RGtype: 'rg', rgHead: '', RGsourceID: '', RGcolumns: 'План', RGcolumnsID: '1126', itemID: '1056', item: 'eNPS', value: '' },
    { panelID: '1035', RG: '1', RGtype: 'rg', rgHead: '', RGsourceID: '', RGcolumns: 'Факт', RGcolumnsID: '1127', itemID: '1056', item: 'eNPS', value: '' },
];

// OLD behavior (bug):
var oldModelData = {};
for (var i = 0; i < jsonData.length; i++) {
    var row = jsonData[i];
    var key = 'fp' + row.panelID;
    if (!oldModelData[key]) oldModelData[key] = { items: {}, rgs: {} };
    if (!oldModelData[key].rgs[row.RG])
        oldModelData[key].rgs[row.RG] = { type: row.RGtype, head: row.rgHead, src: row.RGsourceID, columns: row.RGcolumns || '' };
}
console.log('OLD columns:', oldModelData['fp1035'].rgs['1'].columns);  // Expected bug: "План" only

// NEW behavior (fix):
var newModelData = {};
for (var i = 0; i < jsonData.length; i++) {
    var row = jsonData[i];
    var key = 'fp' + row.panelID;
    if (!newModelData[key]) newModelData[key] = { items: {}, rgs: {} };
    if (!newModelData[key].rgs[row.RG])
        newModelData[key].rgs[row.RG] = { type: row.RGtype, head: row.rgHead, src: row.RGsourceID, columns: row.RGcolumns || '' };
    else if (row.RGcolumns) {
        var existingCols = newModelData[key].rgs[row.RG].columns
            .split(',').map(function(c) { return c.trim(); }).filter(Boolean);
        row.RGcolumns.split(',').map(function(c) { return c.trim(); }).filter(Boolean).forEach(function(col) {
            if (existingCols.indexOf(col) === -1) existingCols.push(col);
        });
        newModelData[key].rgs[row.RG].columns = existingCols.join(',');
    }
}
console.log('NEW columns:', newModelData['fp1035'].rgs['1'].columns);  // Expected fix: "План,Факт"

var newCols = newModelData['fp1035'].rgs['1'].columns.split(',').map(function(c) { return c.trim(); }).filter(Boolean);
console.log('NEW rgCols array:', newCols);  // ["План", "Факт"]
console.log('Test PASSED:', newCols.length === 2 && newCols[0] === 'План' && newCols[1] === 'Факт');
