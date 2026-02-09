# Integram MCP Server

Model Context Protocol (MCP) server that exposes Integram API functionality as tools for AI assistants like Claude.

## Features

- **60+ MCP Tools** for full Integram API access
- **Authentication** - session management with auto-reconnect
- **DDL Operations** - create/modify types (tables), requisites (columns)
- **DML Operations** - CRUD for objects (records)
- **Query Operations** - smart queries, natural language search
- **High-level Helpers** - create tables with columns, batch operations

## Installation

```bash
cd mcp-server
npm install
```

## Usage

### With Claude Desktop

Add to your `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "integram": {
      "command": "node",
      "args": ["/path/to/crm/mcp-server/index.js"],
      "env": {
        "NODE_ENV": "development"
      }
    }
  }
}
```

### Standalone

```bash
npm start
```

## Available Tools

### Authentication (2 tools)

| Tool | Description |
|------|-------------|
| `integram_authenticate` | Login with credentials |
| `integram_set_context` | Set existing token/session |

### DDL - Data Definition (11 tools)

| Tool | Description |
|------|-------------|
| `integram_create_type` | Create new table |
| `integram_save_type` | Update table properties |
| `integram_delete_type` | Delete table |
| `integram_add_requisite` | Add column to table |
| `integram_delete_requisite` | Delete column |
| `integram_save_requisite_alias` | Set column display name |
| `integram_toggle_requisite_null` | Toggle NULL constraint |
| `integram_toggle_requisite_multi` | Toggle multi-select |
| `integram_rename_requisite` | Rename column |
| `integram_modify_requisite_attributes` | Modify multiple attributes |
| `integram_set_requisite_order` | Set column order |

### DML - Data Manipulation (8 tools)

| Tool | Description |
|------|-------------|
| `integram_create_object` | Create new record |
| `integram_save_object` | Update record |
| `integram_set_object_requisites` | Update specific fields |
| `integram_delete_object` | Delete record |
| `integram_move_object_up` | Move record up in list |
| `integram_move_object_to_parent` | Move to different parent |
| `integram_set_object_order` | Set record order |
| `integram_set_object_id` | Change record ID |

### Query Operations (11 tools)

| Tool | Description |
|------|-------------|
| `integram_get_dictionary` | List all tables |
| `integram_get_type_metadata` | Get table structure |
| `integram_get_object_list` | Get records (paginated) |
| `integram_get_all_objects` | Get all records |
| `integram_get_object_count` | Count records |
| `integram_get_object_edit_data` | Get record with form data |
| `integram_get_type_editor_data` | Get type editor config |
| `integram_execute_report` | Execute saved report |
| `integram_get_reference_options` | Get dropdown options |
| `integram_smart_query` | SQL-like query builder |
| `integram_natural_query` | Natural language search |

### Multiselect Operations (3 tools)

| Tool | Description |
|------|-------------|
| `integram_add_multiselect_item` | Add item to multiselect |
| `integram_remove_multiselect_item` | Remove from multiselect |
| `integram_get_multiselect_items` | Get multiselect values |

### High-level Helpers (23+ tools)

| Tool | Description |
|------|-------------|
| `integram_create_table_with_columns` | Create table with all columns |
| `integram_create_lookup_table` | Create reference/dictionary table |
| `integram_add_reference_column` | Add foreign key column |
| `integram_create_lookup_with_reference` | Create lookup and add reference |
| `integram_get_table_structure` | Get full table info |
| `integram_clone_table_structure` | Clone table schema |
| `integram_rename_table` | Rename table |
| `integram_add_columns_to_table` | Add multiple columns |
| `integram_delete_table_cascade` | Delete table with data |
| `integram_create_objects_batch` | Create multiple records |
| `integram_create_parent_with_children` | Create hierarchical data |
| `integram_get_schema` | Get database schema |
| `integram_create_report` | Create query/report |
| `integram_add_report_column` | Add column to report |
| `integram_add_report_from` | Add FROM table to report |
| `integram_clone_report` | Clone report |
| `integram_get_report_structure` | Get report structure |
| `integram_create_database` | Create new database |
| `integram_create_backup` | Create database backup |
| `integram_get_dir_admin` | Get directory admin data |
| `integram_get_ref_reqs` | Get reference requisites |
| `integram_execute_connector` | Execute external connector |
| `integram_get_object_meta` | Get object metadata |
| `integram_get_all_types_metadata` | Get all types metadata |

## Requisite Types

| ID | Name | Description |
|----|------|-------------|
| 3 | SHORT | Text up to 255 chars |
| 8 | CHARS | Text |
| 2 | LONG | Long text |
| 13 | NUMBER | Numeric |
| 14 | SIGNED | Signed number |
| 4 | DATETIME | Date and time |
| 9 | DATE | Date only |
| 7 | BOOL | Boolean |
| 10 | FILE | File attachment |
| 12 | MEMO | Large text |

For reference/lookup columns, pass target table ID as `requisiteTypeId`.

## Examples

### Create a Table with Columns

```javascript
// Using integram_create_table_with_columns
{
  "tableName": "Products",
  "columns": [
    { "requisiteTypeId": 3, "alias": "SKU" },
    { "requisiteTypeId": 2, "alias": "Description" },
    { "requisiteTypeId": 13, "alias": "Price" },
    { "requisiteTypeId": 7, "alias": "In Stock" }
  ]
}
```

### Create Reference Column

```javascript
// Link Products to Categories
{
  "typeId": 994762,        // Products table
  "referenceTableId": 994769,  // Categories table
  "alias": "Category"
}
```

### Natural Language Query

```javascript
// Using integram_natural_query
{
  "question": "Find all products with price > 1000",
  "targetTable": 994762
}
```

## License

MIT
