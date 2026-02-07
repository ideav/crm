# IntegramDataView Debug Guide

## 🐛 Debugging Mode

The `integram-data-view.js` component includes comprehensive tracing and debugging capabilities to help diagnose issues.

## Quick Start

### Enable Debug Mode

Open the browser console (F12) and run:

```javascript
// Enable basic debug mode
IntegramDebug.enable();

// Enable verbose debug mode (shows all details)
IntegramDebug.enable(true);

// Disable debug mode
IntegramDebug.disable();
```

### Enable Debug Mode Before Page Load

Add this script before including `integram-data-view.js`:

```html
<script>
    // This will enable debug mode as soon as the component loads
    window.addEventListener('DOMContentLoaded', () => {
        if (window.IntegramDebug) {
            IntegramDebug.enable(true);
        }
    });
</script>
<script src="/path/to/integram-data-view.js"></script>
```

## Debug Output Categories

The debug system categorizes messages into different areas:

- **INIT** - Initialization and auto-detection of components
- **DataView** - Base class operations (common to all components)
- **Tables** - IntegramTables-specific operations
- **Reports** - IntegramReports-specific operations

## Common Issues and Solutions

### Issue: "Component shows blank screen"

**Diagnosis:**
1. Enable debug mode: `IntegramDebug.enable(true)`
2. Reload the page
3. Check console for initialization messages

**Common causes:**
- Missing required attributes (e.g., `data-table-type-id` for tables)
- Invalid API URL
- Container element has no `id` attribute
- API returns errors or unexpected format

**Example debug output:**
```
[INIT] Found 1 elements with data-integram-table (legacy pattern)
[INIT] Initializing legacy table: tasks-table
[INIT] Legacy element tasks-table detected as: REPORT
[Reports] IntegramReports constructor called for: tasks-table
[DataView] Constructor called for container: tasks-table
[DataView] Container element found: <div id="tasks-table">
```

### Issue: "No data appears after initialization"

**Diagnosis:**
1. Look for `loadData` messages in console
2. Check if API URL is being fetched
3. Verify API response format

**Example debug output:**
```
[Reports] loadData called (append=false)
[Reports] Loading data...
[Reports] Fetching data from: https://api.example.com/report/123?LIMIT=20&OFFSET=0
[Reports] Data response: {f: [...], d: [...]}
[Reports] Loaded 15 columns from response
[Reports] Processed 20 data rows
[Reports] Rendering table...
```

### Issue: "Data loads but table doesn't render"

**Diagnosis:**
1. Check for errors in `render()` phase
2. Verify column metadata is loaded
3. Check if visible columns are configured

**Example debug output:**
```
[Reports] Processing column metadata...
[Reports] Rendering table...
[DataView] Instance registered as window.tasksTable
```

## Debug Levels

### Basic Debug Mode
```javascript
IntegramDebug.enable();
```
Shows:
- Initialization steps
- Data loading progress
- Errors and warnings
- Key state changes

### Verbose Debug Mode
```javascript
IntegramDebug.enable(true);
```
Shows everything in basic mode, plus:
- API URLs being fetched
- Complete API responses
- Detailed column and row data
- All configuration options
- Internal state changes

## API Response Inspection

To inspect the exact API responses without verbose mode:

```javascript
// After enabling debug mode, responses are logged
// Look for messages like:
// [Tables] Data response: {...}
// [Reports] Metadata response: {...}
```

## Tracing Component Lifecycle

A typical successful initialization looks like:

```
1. [INIT] Starting auto-initialization...
2. [INIT] Found 1 elements with data-integram-table
3. [INIT] Initializing legacy table: my-table
4. [Reports] IntegramReports constructor called for: my-table
5. [DataView] Constructor called for container: my-table
6. [DataView] Container element found
7. [DataView] Instance registered as window.myTable
8. [DataView] Calling init() for my-table...
9. [DataView] init() started for my-table
10. [Reports] loadData called (append=false)
11. [Reports] Loading data...
12. [Reports] Fetching data from: [URL]
13. [Reports] Loaded 10 columns from response
14. [Reports] Processed 20 data rows
15. [Reports] Rendering table...
16. [Reports] Data load completed successfully
17. [INIT] Auto-initialization complete. Initialized 1 components.
```

## Manual Testing

### Test Files

Two test files are included in the `experiments/` folder:

1. **test-tbl-debug.html** - Tests table data source with debug UI
2. **test-rep-debug.html** - Tests report data source with legacy attribute pattern

These files include:
- Built-in debug controls
- Console output display in the page
- Example of both initialization patterns

### Running Tests

```bash
# Open test files in browser
firefox experiments/test-tbl-debug.html
firefox experiments/test-rep-debug.html
```

## Supported Initialization Patterns

### Pattern 1: New Explicit Type (Recommended)

```html
<!-- For tables -->
<div id="my-table"
     data-integram-type="table"
     data-api-url="https://api.example.com"
     data-table-type-id="123"
     data-title="My Table">
</div>

<!-- For reports -->
<div id="my-report"
     data-integram-type="report"
     data-api-url="https://api.example.com/report/456"
     data-title="My Report">
</div>
```

### Pattern 2: Legacy Auto-Detection

```html
<!-- Auto-detects as REPORT (no table-type-id) -->
<div id="my-report"
     data-integram-table
     data-api-url="https://api.example.com/report/456"
     data-title="My Report">
</div>

<!-- Auto-detects as TABLE (has table-type-id) -->
<div id="my-table"
     data-integram-table
     data-api-url="https://api.example.com"
     data-table-type-id="123"
     data-title="My Table">
</div>
```

## Performance Debugging

To identify slow operations:

```javascript
// Enable verbose mode and watch for timing
IntegramDebug.enable(true);

// Look for delays between these messages:
// "Fetching data from..." → "Data response:"
// "Processing column metadata..." → "Rendering table..."
```

## Troubleshooting Checklist

- [ ] Container element has unique `id` attribute
- [ ] Required attributes are present:
  - `data-api-url` (always required)
  - `data-table-type-id` (required for tables)
  - `data-integram-type` or `data-integram-table` (required for auto-init)
- [ ] API URL is accessible and returns valid JSON
- [ ] Browser console shows no JavaScript errors
- [ ] Debug mode is enabled to see tracing
- [ ] CSS file is loaded: `integram-data-view.css`

## Getting Help

When reporting issues, include:
1. Full debug console output (with verbose mode enabled)
2. HTML snippet of your component initialization
3. Browser and version
4. Example API response (if possible)

Enable debug mode and capture output:
```javascript
IntegramDebug.enable(true);
// Reload page, then copy all console output
```
