# Export Feature Documentation

## Overview
The IntegramTable component now supports exporting table data to multiple formats:
- **XLSX** - Excel 2007+ format (.xlsx)
- **XLS** - Excel 97-2003 format (.xls)
- **CSV** - Comma-separated values with UTF-8 BOM (.csv)

## User Interface

The export button is located in the table toolbar, next to the "Фильтры" button:

```
┌─────────────────────────────────────────────────────────────┐
│  Table Title                        [Clear] [Фильтры] [📥 Экспорт] [⚙️] [▥ Колонки] │
└─────────────────────────────────────────────────────────────┘
```

When clicked, the export button displays a dropdown menu with three options:

```
┌──────────────────────┐
│ 📊 XLSX (Excel)      │
│ 📗 XLS (Excel 97-2003)│
│ 📄 CSV                │
└──────────────────────┘
```

## Features

### 1. **Complete Data Export**
   - **Exports ALL data** matching current filters, not just visible rows on screen
   - Automatically loads all paginated data in batches of 1000 records
   - Shows progress messages during data loading
   - Safety limit of 100,000 records to prevent browser memory issues

### 2. **Respects Visible Columns & Filters**
   - Only exports columns that are currently visible
   - Respects the current column order set by the user
   - **Honors all active filters** - only exports rows matching current filter criteria
   - **Preserves sort order** - data is exported in the current sort order

### 3. **Smart Data Formatting**
   - **Boolean**: Exported as "Да" / "Нет" (Yes/No in Russian)
   - **Password**: Exported as "******" for security
   - **HTML/Button**: HTML tags are stripped, only text content is exported
   - **Date/DateTime**: Exported as-is from the API
   - **Numbers**: Preserved as numeric values

### 3. **CSV Export Details**
   - UTF-8 BOM (Byte Order Mark) for proper encoding in Excel
   - Proper quote escaping for cells containing commas, quotes, or newlines
   - RFC 4180 compliant

### 4. **Excel Export Details**
   - Uses SheetJS library (loaded dynamically from CDN)
   - Auto-sized columns based on content length
   - Column width capped at 50 characters for readability
   - Headers in first row with bold formatting

### 5. **Performance & Progress**
   - Batch loading for large datasets (1000 records per batch)
   - Progress notifications:
     - "Загрузка всех данных для экспорта..." - When starting data load
     - "Экспорт N записей..." - Before actual export begins
   - Efficient memory management

### 6. **User Feedback**
   - Toast notifications for success/error states
   - Loading indicator when downloading SheetJS library
   - Real-time progress updates for large exports
   - Helpful error messages

## File Naming Convention

Exported files are named using the following pattern:
```
{table-title}_{YYYY-MM-DD}.{ext}
```

Example: `Sample_Data_Table_2024-02-08.xlsx`

## Technical Implementation

### Dependencies
- **SheetJS (xlsx)**: Loaded dynamically from CDN when Excel export is first used
- No other external dependencies for CSV export (pure JavaScript)

### Browser Compatibility
- Works in all modern browsers (Chrome, Firefox, Safari, Edge)
- Uses Blob API for file downloads
- Graceful degradation if features are not available

### Code Structure

The implementation adds the following methods to the `IntegramTable` class:

1. `toggleExportMenu(event)` - Shows/hides the export dropdown
2. `exportTable(format)` - Main export orchestrator
3. `loadAllDataForExport()` - Loads all data matching current filters in batches
4. `loadDataFromReportForExport(offset, limit)` - Batch loader for report data source
5. `loadDataFromTableForExport(offset, limit)` - Batch loader for table data source
6. `prepareExportDataFromRows(rows, columns)` - Converts rows to exportable format
7. `exportToCSV(data, columns)` - CSV export implementation
8. `exportToExcel(data, columns, format)` - Excel export implementation
9. `loadScript(url)` - Dynamic script loader for SheetJS
10. `downloadBlob(blob, filename)` - File download helper

## Usage Example

```javascript
// The export functionality is automatically available on all IntegramTable instances
// Users simply click the "📥 Экспорт" button and select their desired format

// Programmatic export (if needed):
window.myTableInstance.exportTable('xlsx');
window.myTableInstance.exportTable('xls');
window.myTableInstance.exportTable('csv');
```

## Testing

A test file is available at: `experiments/test-export-functionality.html`

This file demonstrates:
- Sample table with various data types
- Working export button with all three formats
- Proper handling of special characters, quotes, and newlines
- Column visibility and ordering

## Future Enhancements

Possible improvements for future versions:
- Custom filename option
- Export selected rows only
- Export with applied filters indicator
- PDF export support
- Custom column mapping/transformation
