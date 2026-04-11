/**
 * Test for issue #1531: "Объекты" (Objects) - first column - ends up at the bottom of the form
 *
 * Root cause analysis:
 * - renderAttributesForm (fixed in #1526) correctly interpolates unsaved fields at their
 *   natural metadata position. For a field that is NOT in the saved cookie order, it places
 *   it between its saved neighbors in metadata order.
 * - applyFormFieldSettings is called AFTER renderAttributesForm to re-order the DOM.
 *   But it still uses the OLD logic: unsaved fields are appended at the END.
 *   This undoes renderAttributesForm's correct interpolation.
 *
 * Scenario:
 *   Saved cookie order: ["Маска", "EXPORT", "DELETE"]  (Объекты was added later, not in cookie)
 *   regularFields metadata order: [Объекты, Маска, EXPORT, DELETE]
 *
 *   renderAttributesForm produces DOM order: [main(Доступ), Объекты, Маска, EXPORT, DELETE]
 *   (Объекты placed first among regulars because it has no saved predecessor)
 *
 *   applyFormFieldSettings then re-orders:
 *     - "main" group forced first
 *     - saved order: Маска, EXPORT, DELETE
 *     - remaining (not in saved): Объекты → APPENDED AT END ← BUG
 *   Result DOM: [main(Доступ), Маска, EXPORT, DELETE, Объекты]  ← Объекты at bottom!
 *
 * The fix: applyFormFieldSettings should use the same interpolation logic as
 * renderAttributesForm, OR simply preserve the natural DOM order for unsaved fields
 * (since formGroups already reflects the interpolated order from renderAttributesForm).
 */

// Simulate the bug and fix

// --- Setup: simulate formGroups (as produced by renderAttributesForm after interpolation) ---
// formGroups DOM order after renderAttributesForm: [main, Объекты, Маска, EXPORT, DELETE]
const formGroups = [
    { id: 'field-main', fieldKey: 'main', label: 'Доступ' },
    { id: 'field-1', fieldKey: '1', label: 'Объекты' },   // Not in saved order
    { id: 'field-2', fieldKey: '2', label: 'Маска' },      // In saved order at idx 0
    { id: 'field-3', fieldKey: '3', label: 'EXPORT' },     // In saved order at idx 1
    { id: 'field-4', fieldKey: '4', label: 'DELETE' },     // In saved order at idx 2
];

// Saved order from cookie (Объекты not included - was added after the order was saved)
const savedOrder = ['2', '3', '4'];  // Маска, EXPORT, DELETE

// --- BUGGY applyFormFieldSettings logic ---
function applyFormFieldSettingsBuggy(formGroups, savedOrder) {
    // Build groupMap
    const groupMap = {};
    formGroups.forEach(group => {
        groupMap[group.fieldKey] = group;
    });

    // Force main first
    const mainGroup = groupMap['main'];
    const orderedGroups = [];
    const usedIds = new Set();
    if (mainGroup) {
        orderedGroups.push(mainGroup);
        usedIds.add('main');
    }

    // Apply saved order
    savedOrder.forEach(fieldId => {
        if (groupMap[fieldId] && !usedIds.has(fieldId)) {
            orderedGroups.push(groupMap[fieldId]);
            usedIds.add(fieldId);
        }
    });

    // Append remaining (BUG: appended at end instead of natural position)
    formGroups.forEach(group => {
        if (!usedIds.has(group.fieldKey)) {
            orderedGroups.push(group);
        }
    });

    return orderedGroups;
}

// --- FIXED applyFormFieldSettings logic ---
// Use formGroups (natural DOM order from renderAttributesForm) to determine
// the sort key for unsaved fields.
function applyFormFieldSettingsFixed(formGroups, savedOrder) {
    // Build groupMap
    const groupMap = {};
    formGroups.forEach(group => {
        groupMap[group.fieldKey] = group;
    });

    // Force main first
    const mainGroup = groupMap['main'];
    const usedIds = new Set();
    if (mainGroup) usedIds.add('main');

    const scale = formGroups.length + 1;

    // Compute sort key for each group
    // - Groups in savedOrder: key = savedIndex * scale
    // - Groups NOT in savedOrder: use their natural DOM index (from formGroups),
    //   which already reflects the correct interpolated position from renderAttributesForm.
    //   Key = natural DOM position (but we want to interleave with saved groups).
    //
    //   The correct approach: assign fractional keys by finding the nearest saved
    //   successor in the natural DOM order, same logic as renderAttributesForm.

    // Map fieldKey -> natural DOM index (from formGroups)
    const natOrderMap = new Map();
    formGroups.forEach((group, idx) => {
        natOrderMap.set(group.fieldKey, idx);
    });

    // Map fieldKey -> saved order index (-1 if not in savedOrder)
    const savedIndexMap = new Map();
    formGroups.forEach(group => {
        savedIndexMap.set(group.fieldKey, savedOrder.indexOf(group.fieldKey));
    });

    // Assign sort keys (same algorithm as renderAttributesForm fix for issue #1526)
    // but working on formGroups instead of regularFields
    const sortKey = new Map();
    // We only assign keys for non-main groups
    const nonMainGroups = formGroups.filter(g => g.fieldKey !== 'main');
    nonMainGroups.forEach((group, natIdx) => {
        const idx = savedIndexMap.get(group.fieldKey);
        if (idx !== -1) {
            sortKey.set(group.fieldKey, idx * scale);
        } else {
            // Find saved successor in natural DOM order
            let nextSavedIdx = savedOrder.length;
            for (let i = natIdx + 1; i < nonMainGroups.length; i++) {
                const si = savedIndexMap.get(nonMainGroups[i].fieldKey);
                if (si !== -1) { nextSavedIdx = si; break; }
            }
            sortKey.set(group.fieldKey, nextSavedIdx * scale - scale + natIdx + 1);
        }
    });

    const orderedGroups = [];
    if (mainGroup) orderedGroups.push(mainGroup);

    const sortedNonMain = [...nonMainGroups].sort((a, b) => sortKey.get(a.fieldKey) - sortKey.get(b.fieldKey));
    sortedNonMain.forEach(g => orderedGroups.push(g));

    return orderedGroups;
}

// --- Test ---
console.log('=== Scenario: Объекты not in saved order ===');
console.log('');
console.log('Input:');
console.log('  formGroups (natural DOM order):', formGroups.map(g => g.label).join(', '));
console.log('  savedOrder:', savedOrder.join(', '));
console.log('');

const buggyResult = applyFormFieldSettingsBuggy(formGroups, savedOrder);
console.log('BUGGY result:', buggyResult.map(g => g.label).join(', '));
const buggyObjectsIdx = buggyResult.findIndex(g => g.label === 'Объекты');
const buggyTotal = buggyResult.length - 1;  // 0-indexed
const buggyIsLast = buggyObjectsIdx === buggyTotal;
console.log(`  Объекты at index ${buggyObjectsIdx} of ${buggyTotal} → ${buggyIsLast ? 'LAST (BUG!)' : 'OK'}`);
console.log('');

const fixedResult = applyFormFieldSettingsFixed(formGroups, savedOrder);
console.log('FIXED result:', fixedResult.map(g => g.label).join(', '));
const fixedObjectsIdx = fixedResult.findIndex(g => g.label === 'Объекты');
const fixedExpectedIdx = 1;  // Should be second (after main/Доступ)
console.log(`  Объекты at index ${fixedObjectsIdx} → ${fixedObjectsIdx === fixedExpectedIdx ? 'CORRECT (second after main)' : 'WRONG'}`);
console.log('');

// --- Second scenario: Объекты IS in saved order but at a specific position ---
console.log('=== Scenario 2: Объекты IS in saved order (position 0 = first regular) ===');
const savedOrder2 = ['1', '2', '3', '4'];  // All in order
const formGroups2 = [
    { id: 'field-main', fieldKey: 'main', label: 'Доступ' },
    { id: 'field-1', fieldKey: '1', label: 'Объекты' },
    { id: 'field-2', fieldKey: '2', label: 'Маска' },
    { id: 'field-3', fieldKey: '3', label: 'EXPORT' },
    { id: 'field-4', fieldKey: '4', label: 'DELETE' },
];
const result2 = applyFormFieldSettingsFixed(formGroups2, savedOrder2);
console.log('FIXED result:', result2.map(g => g.label).join(', '));
console.log('Expected:     Доступ, Объекты, Маска, EXPORT, DELETE');
console.log('Match:', result2.map(g => g.label).join(', ') === 'Доступ, Объекты, Маска, EXPORT, DELETE' ? 'YES' : 'NO');
console.log('');

// --- Third scenario: Объекты in saved order but at END (user moved it there) ---
console.log('=== Scenario 3: Объекты in saved order at END ===');
const savedOrder3 = ['2', '3', '4', '1'];  // Объекты at end (user-set position)
const result3 = applyFormFieldSettingsFixed(formGroups2, savedOrder3);
console.log('FIXED result:', result3.map(g => g.label).join(', '));
console.log('Expected:     Доступ, Маска, EXPORT, DELETE, Объекты (user put it last)');
console.log('Match:', result3.map(g => g.label).join(', ') === 'Доступ, Маска, EXPORT, DELETE, Объекты' ? 'YES' : 'NO');

// Summary
console.log('');
console.log('=== Summary ===');
const allPass = buggyIsLast && fixedObjectsIdx === fixedExpectedIdx;
console.log('Bug confirmed:', buggyIsLast ? 'YES' : 'NO');
console.log('Fix works:', fixedObjectsIdx === fixedExpectedIdx ? 'YES' : 'NO');
