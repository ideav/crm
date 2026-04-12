# Asset Deployment Guide for Info.html Template

## Overview

The `templates/info.html` has been refactored according to BASIC_RULES.md to follow best practices:
- Minimal template containing only workspace-specific content
- Styles extracted to separate CSS file
- Scripts extracted to separate JS file
- Versioned asset loading

## Asset Files

### CSS File
**Location:** `/css/info.css`
**Source:** See `css/info.css` in this repository

This file contains all styles specific to the info.html workspace:
- Quick links badges styling
- Tasks table integration styles
- Loading spinner animations
- Responsive layouts

### JavaScript File
**Location:** `/js/info.js`
**Source:** See `js/info.js` in this repository

This file contains:
- Quick links loader (`loadQuickLinks()`)
- IntegramTable component class
- Automatic initialization on DOM ready

## Deployment Instructions

1. **Copy CSS file:**
   ```bash
   cp css/info.css /path/to/integram/public/css/info.css
   ```

2. **Copy JavaScript file:**
   ```bash
   cp js/info.js /path/to/integram/public/js/info.js
   ```

3. **The template file** `templates/info.html` references these assets with versioning:
   ```html
   <link rel="stylesheet" href="/css/info.css?{_global_.version}" />
   <script src="/js/info.js?{_global_.version}"></script>
   ```

## Changes from Previous Version

### Before (BASIC_RULES violation):
- Full HTML structure duplicating main.html
- Inline styles (1000+ lines)
- Inline scripts (500+ lines)
- No asset versioning

### After (BASIC_RULES compliant):
- Minimal template with only workspace content
- Separated CSS file (modular and cacheable)
- Separated JS file (modular and cacheable)
- Versioned asset loading for cache busting

## Template Variables

All files in the `templates` folder are processed by the Integram template engine. The engine treats any construction matching this pattern as an insertion point:

```
\{([A-ZА-Я0-9\.&_ \-]*?[^ ;\r\n])}
```

Examples of valid template variables (context variables):
- `{_global_.z}` — current user zone
- `{_global_.version}` — asset version for cache busting
- `{_global_.xsrf}` — XSRF token

These are defined in [Integram globals](https://help.integram.io/#globals).

> **Important:** Do not add spaces inside these standard insertion points. `{_global_.z}` is the correct form. Writing `{ _global_.z }` (with spaces) would prevent the template engine from recognizing it as an insertion point, and the variable would not be substituted.

### Curly Braces in JavaScript (ES6 and Other Languages)

If you use ES6 template literals or other syntax that includes curly braces in JS files referenced from templates (or inline scripts inside templates), **add spaces inside the curly braces** so the template engine does not mistake them for unfilled insertion points:

```js
// ❌ Wrong — template engine may interpret this as an insertion point
const hello = `Hello ${name}`;

// ✅ Correct — spaces prevent misinterpretation
const hello = `Hello ${ name }`;
```

If a curly brace expression is not recognized as a known insertion point, the block containing it will simply not be rendered.

## API Endpoints Used

The info.html workspace uses:
- `GET /{db}/report/299?JSON_KV` - Quick links data
- `GET /{db}/report/4283?JSON` - Tasks table data

Both follow BASIC_RULES:
- Use `JSON_KV` for report/ commands
- Use `JSON` for other commands

## Testing

After deployment, test:
1. Quick links load correctly
2. Priority links show red icon (🔴)
3. Tasks table displays with pagination
4. Column settings persist in cookies
5. Filters work correctly
6. All links open in new tabs

## Browser Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- ES6+ JavaScript features used
- CSS Grid and Flexbox for layouts
- No polyfills required for Integram's target environment
