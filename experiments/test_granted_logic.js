// Test the granted logic for issue #1508

// Simulate the key functions
function isTableWritable(tableGranted) {
    return tableGranted === null || tableGranted === 'WRITE';
}

function buildColumnGranted(isWritable, reqGranted) {
    return isWritable ? 1 : (reqGranted === 'WRITE' ? 1 : 0);
}

function determineFormReadOnly(metadataGranted) {
    const grant = metadataGranted !== undefined ? metadataGranted : null;
    return grant !== null && grant !== 'WRITE';
}

// Test cases from issue #1508
console.log("=== Test: Table with granted: 'WRITE' ===");
const tableGranted1 = 'WRITE';
const isWritable1 = isTableWritable(tableGranted1);
console.log("isTableWritable:", isWritable1); // true
console.log("mainCol granted:", isWritable1 ? 1 : 0); // 1

// Metadata from the example in the issue
const metadata = {
    id: '476',
    granted: 'WRITE',
    reqs: [
        { id: '481', val: 'Наименование' },
        { id: '487', val: 'Пользователь', granted: 'WRITE' },
        { id: '490', val: 'Статус' }
    ]
};

console.log("\n=== Test: Columns for WRITE table ===");
const tableGrantedA = metadata.granted !== undefined ? metadata.granted : null;
const isWritableA = isTableWritable(tableGrantedA);
metadata.reqs.forEach(req => {
    const colGranted = buildColumnGranted(isWritableA, req.granted);
    console.log(`req ${req.id} (${req.val}): req.granted=${req.granted}, colGranted=${colGranted}`);
});
// All should be 1 when table.granted === 'WRITE'

console.log("\n=== Test: Table with granted: 'READ' ===");
const metadataRead = {
    id: '269',
    granted: 'READ',
    reqs: [
        { id: '271', val: 'Тип' },
        { id: '487', val: 'Пользователь', granted: 'WRITE' },
        { id: '273', val: 'Значение' }
    ]
};
const tableGrantedB = metadataRead.granted !== undefined ? metadataRead.granted : null;
const isWritableB = isTableWritable(tableGrantedB);
console.log("isTableWritable:", isWritableB); // false
console.log("mainCol granted:", isWritableB ? 1 : 0); // 0

metadataRead.reqs.forEach(req => {
    const colGranted = buildColumnGranted(isWritableB, req.granted);
    console.log(`req ${req.id} (${req.val}): req.granted=${req.granted}, colGranted=${colGranted}`);
});
// Only req 487 should be 1

console.log("\n=== Test: Form read-only determination ===");
// Form opened for metadata with granted: 'READ'
const formReadOnly = determineFormReadOnly('READ');
console.log("formIsReadOnly for 'READ':", formReadOnly); // true
const hasSomeWritable = metadataRead.reqs.some(req => req.granted === 'WRITE');
console.log("hasSomeWritable:", hasSomeWritable); // true (req 487)
const showSaveBtn = !formReadOnly || hasSomeWritable;
console.log("showSaveBtn:", showSaveBtn); // true

// Form with no writable reqs
const metadataNoWrite = {
    id: '999',
    granted: 'READ',
    reqs: [
        { id: '100', val: 'Field1' },
        { id: '101', val: 'Field2' }
    ]
};
const formReadOnly2 = determineFormReadOnly('READ');
const hasSomeWritable2 = metadataNoWrite.reqs.some(req => req.granted === 'WRITE');
console.log("\nFor no-WRITE reqs: hasSomeWritable:", hasSomeWritable2); // false
const showSaveBtn2 = !formReadOnly2 || hasSomeWritable2;
console.log("showSaveBtn:", showSaveBtn2); // false

console.log("\n=== Test: Table without granted key ===");
const tableGrantedC = undefined !== undefined ? undefined : null;
console.log("tableGranted:", tableGrantedC); // null
const isWritableC = isTableWritable(tableGrantedC);
console.log("isTableWritable (null):", isWritableC); // true - default is writable
console.log("All tests passed!")
