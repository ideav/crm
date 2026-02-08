# Debugging Object Format Editable Cells Issue

## Problem Description
In object format (альтернативном/объектном формате), cells have the `editable-cell` class but are not actually editable when clicked.

## Root Cause Analysis

### The Issue
The code has TWO sections for determining `recordId` in the `renderCell` function:

1. **Lines 1065-1073** - For rendering edit icons (works correctly for object format)
2. **Lines 1095-1125** - For setting inline editing data attributes (MISSING object format handling!)

### Current Logic (BROKEN for object format)
```javascript
// Lines 1095-1108 - Missing object format check!
if (isEditable && !customStyle.includes('edit-icon')) {
    const idColId = this.editableColumns.get(column.id);
    let recordId = '';

    if (idColId !== null) {
        // Get from ID column
        recordId = ...;
    } else {
        // Try to determine from parent
        recordId = this.determineParentRecordId(column, rowIndex);
    }
    // ... rest of logic
}
```

The problem: **It doesn't check for object format** (`this.rawObjectData` and `this.objectTableId`)!

In object format, ALL columns (including requisites) should get `recordId` from `rawObjectData[rowIndex].i`, not from ID columns or parent determination.

### Expected Logic (FIX)
```javascript
if (isEditable && !customStyle.includes('edit-icon')) {
    const idColId = this.editableColumns.get(column.id);
    let recordId = '';

    // CHECK FOR OBJECT FORMAT FIRST!
    if (this.rawObjectData.length > 0 && this.objectTableId) {
        // Use 'i' from rawObjectData for ALL columns
        const rawItem = this.rawObjectData[rowIndex];
        recordId = rawItem && rawItem.i ? String(rawItem.i) : '';
    } else if (idColId !== null) {
        // Get from ID column
        recordId = ...;
    } else {
        // Try to determine from parent
        recordId = this.determineParentRecordId(column, rowIndex);
    }
    // ... rest of logic
}
```

## How to Enable Debug Tracing

### Method 1: Via JavaScript console
Open browser console and type:
```javascript
window.INTEGRAM_DEBUG = true;
```

Then reload or navigate to trigger cell rendering.

### Method 2: Via IntegramTable options
When initializing the table:
```javascript
const table = new IntegramTable('container-id', {
    apiUrl: '/api/report',
    debug: true  // Enable debug tracing
});
```

### Method 3: Via URL parameter
Add `?debug=1` to the URL (requires implementation in the page).

## Debug Output

With `window.INTEGRAM_DEBUG = true`, you'll see console logs like:

### When Rendering Cells:
```
[TRACE] renderCell - Inline editing check for column 123 (Название), row 0:
  - isEditable: true
  - isInObjectFormat: true
  - objectTableId: 456
  - idColId (ID column reference): null
  - Object format detected - using rawObjectData[0].i = 5151
  - isRefField: false
  - canEdit: true
  ✓ Cell will be editable with recordId=5151
```

### When Clicking Cells:
```
[TRACE] Cell click - EDITABLE cell clicked: {
  colId: "123",
  colName: "Название",
  recordId: "5151",
  rowIndex: "0",
  isRefField: false
}
```

OR (if cell is not editable):
```
[TRACE] Cell click - NON-editable cell clicked: {
  colId: "123",
  colName: "Название",
  colGranted: 1,
  isInEditableColumns: true,
  isInObjectFormat: true,
  hasClassEditableCell: true,
  dataEditableAttr: undefined,
  rowIndex: 0
}
  ✗ Cell not editable because data-editable="undefined" (not "true")
  ⚠️ WARNING: Cell has editable-cell class and column is in editableColumns, but data-editable is not "true"!
  This indicates the recordId was not found during rendering.
```

## Testing the Fix

1. Enable debug mode
2. Navigate to a table in object format
3. Check console logs when page loads (cell rendering)
4. Click on editable cells and check console logs
5. Verify that `recordId` is correctly determined from `rawObjectData[i].i`

## Files Modified
- `assets/js/integram-table.js` - Added object format handling and debug tracing
