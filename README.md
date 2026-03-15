# Ideav CRM

Frontend templates, components, and tooling for the [Integram](https://ideav.ru)-based CRM system.

## What's in This Repo

| Path | Description |
|------|-------------|
| `js/` | JavaScript modules (main app controller, table component, cabinet, etc.) |
| `css/` | Stylesheets for all UI components |
| `templates/` | HTML workspace templates deployed to the Integram server |
| `kanban/` | Kanban board template |
| `crm/` | CRM-specific page templates |
| `mcp-server/` | MCP server exposing Integram API to AI assistants (60+ tools) |
| `experiments/` | Developer experiment scripts and prototypes |
| `examples/` | Working usage examples |
| `docs/` | Additional documentation |
| `update.php` | Server-side file sync script (pulls updates from this repo to the hosting) |

## Key Components

### IntegramTable (`js/integram-table.js`)

Feature-rich data table component built on the Integram API:

- Infinite scroll with smart record counter
- Dynamic columns with drag & drop reordering and resizable widths
- 13+ filter types, sorting, grouping
- Inline cell editing and modal edit forms
- Excel/CSV export, shareable links
- Persistent settings via cookies (column order, widths, visibility, filters)
- Material Design styling

See [TABLE_COMPONENT_README.md](TABLE_COMPONENT_README.md) for full documentation.

### MainAppController (`js/main-app.js`)

Application shell controller managing:

- Navigation menu with drag & drop editor
- Modal dialogs (use `showDeleteConfirmModal()` and `showErrorModal()` — **never** `alert()`/`confirm()`/`prompt()`)
- Internationalization (RU/EN)
- Theme management

### MCP Server (`mcp-server/`)

Model Context Protocol server that exposes the Integram API as tools for AI assistants (Claude, etc.). Supports DDL, DML, queries, and high-level helpers.

See [mcp-server/README.md](mcp-server/README.md) for setup and available tools.

## Deployment

Files are deployed to the hosting server via `update.php` using the configuration in `update.conf`:

```bash
# Trigger sync (run on the server)
curl https://ideav.ru/update.php?config=update.conf
```

`update.php` only copies files that are newer than the local version, preserving originals.

See [ASSETS_DEPLOYMENT.md](ASSETS_DEPLOYMENT.md) for details on asset structure and deployment.

## Development Rules

- **Never use** `alert()`, `confirm()`, or `prompt()`. Use the modal methods instead:
  - `showDeleteConfirmModal(message)` — for delete confirmations
  - `showErrorModal(message)` — for errors (in `MainAppController`)
  - `showWarningModal(message)` — for warnings (in `IntegTable`)
- Template variables must have spaces: `{ _global_.version }`, not `{_global_.version}`
- Styles go in `.css` files, scripts in `.js` files — no inline styles or scripts in templates
- Asset URLs must include version for cache busting: `href="/css/file.css?{ _global_.version }"`

## Related Documentation

- [TABLE_COMPONENT_README.md](TABLE_COMPONENT_README.md) — IntegramTable component reference
- [ASSETS_DEPLOYMENT.md](ASSETS_DEPLOYMENT.md) — Asset deployment guide
- [CRM_OVERVIEW_SCENARIO.md](CRM_OVERVIEW_SCENARIO.md) — CRM walkthrough for new users
- [mcp-server/README.md](mcp-server/README.md) — MCP server setup and tools
