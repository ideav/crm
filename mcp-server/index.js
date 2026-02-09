#!/usr/bin/env node

/**
 * Integram MCP Server
 *
 * Model Context Protocol (MCP) server that exposes Integram API functionality as tools.
 * Based on src/services/integramApiClient.js
 *
 * This server provides tools for:
 * - Authentication and session management
 * - DDL operations (data structure changes)
 * - DML operations (data modifications)
 * - Query operations (data retrieval)
 * - Multiselect operations
 * - File and backup operations
 *
 * ==================== IMPORTANT USAGE PATTERNS ====================
 *
 * 1. CREATING REFERENCE COLUMNS (Foreign Keys / Lookup Dropdowns):
 *    Reference columns are created via `integram_add_requisite` by passing
 *    the TARGET TABLE ID as `requisiteTypeId` (not a standard type like 3/8/13).
 *
 *    Example: Create "Category" column in "Products" table linking to "Categories" table (ID: 994769):
 *    ```
 *    integram_add_requisite({
 *      typeId: 994762,        // Products table ID
 *      requisiteTypeId: 994769 // Categories table ID (NOT standard type 3/8/13!)
 *    })
 *    // Then set alias:
 *    integram_save_requisite_alias({ requisiteId: <new_id>, alias: "Category" })
 *    ```
 *
 * 2. RELATED/SUBORDINATE TABLES:
 *    In Integram, table relationships are implemented via REFERENCE COLUMNS,
 *    NOT via the parentId parameter!
 *
 *    CORRECT:
 *    - Create "ProductCharacteristics" table
 *    - Add a reference column pointing to "Products" table
 *    - When creating objects, pass the Product ID into this reference column
 *
 *    WRONG:
 *    - Using parentId for table relationships (parentId is for hierarchy within ONE table)
 *
 *    Example creating a linked object:
 *    ```
 *    integram_create_object({
 *      typeId: 994783,           // Characteristics table
 *      value: "Screen diagonal",
 *      requisites: {
 *        "994790": "994777"       // Reference column -> Product object ID
 *      }
 *    })
 *    ```
 *
 * 3. WORKING WITH REFERENCE FIELDS:
 *    - When READING: returns display name (e.g., "Smartphones")
 *    - When WRITING: pass the target object ID as string (e.g., "994770")
 *    - Use `integram_set_object_requisites` for reliable saving of reference fields
 *
 * 4. REQUISITE TYPES:
 *    Standard types (for regular fields):
 *    - 3  = SHORT (short text up to 255 chars)
 *    - 8  = CHARS (text)
 *    - 2  = LONG (long text)
 *    - 13 = NUMBER (numeric)
 *    - 14 = SIGNED (signed number)
 *    - 4  = DATETIME (date and time)
 *    - 9  = DATE (date only)
 *    - 7  = BOOL (boolean)
 *    - 11 = BOOLEAN (alt boolean)
 *    - 12 = MEMO (large text)
 *    - 10 = FILE (file attachment)
 *
 *    For reference/lookup columns: pass target table ID as requisiteTypeId
 *
 * ========================================================================
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

/**
 * Validate that baseTypeId is a SYSTEM base type, not a custom table ID.
 *
 * CRITICAL: In Integram, baseTypeId must be a SYSTEM type (typically 3 for standard tables).
 * Custom table IDs (e.g., 994762) CANNOT be used as baseTypeId!
 *
 * To create related/subordinate tables:
 * 1. Create table with baseTypeId: 3 (standard)
 * 2. Add a reference column (requisiteTypeId = parent table ID)
 *
 * @param {number} baseTypeId - The base type ID to validate
 * @param {string} toolName - Name of the tool for error message
 * @throws {Error} If baseTypeId looks like a custom table ID
 */
function validateBaseTypeId(baseTypeId, toolName) {
  // System base types are small numbers (0-20 range)
  // Custom table IDs are typically > 100 (often > 100000)
  const SYSTEM_BASE_TYPE_MAX = 50;

  if (baseTypeId && baseTypeId > SYSTEM_BASE_TYPE_MAX) {
    throw new Error(
      `[${toolName}] Invalid baseTypeId: ${baseTypeId}. ` +
      `This looks like a custom table ID, not a SYSTEM base type. ` +
      `\n\n` +
      `⚠️ baseTypeId must be a SYSTEM type (typically 3 for standard tables). ` +
      `\n\n` +
      `To create a SUBORDINATE/RELATED table, use this approach:\n` +
      `1. Create table with baseTypeId: 3 (standard)\n` +
      `2. Add a REFERENCE column using integram_add_requisite with:\n` +
      `   - typeId: <your new table ID>\n` +
      `   - requisiteTypeId: ${baseTypeId} (the parent table ID)\n` +
      `3. Set alias for the reference column\n` +
      `\n` +
      `Example:\n` +
      `  // Step 1: Create child table\n` +
      `  integram_create_table_with_columns({ tableName: "Tasks", baseTypeId: 3, columns: [...] })\n` +
      `  // Step 2: Add reference to parent\n` +
      `  integram_add_requisite({ typeId: <new_table_id>, requisiteTypeId: ${baseTypeId} })\n` +
      `  integram_save_requisite_alias({ requisiteId: <ref_id>, alias: "Parent" })`
    );
  }
}

/**
 * Format requisite value for Integram API.
 * Handles date/datetime normalization.
 *
 * CRITICAL: Integram PHP's date handling is specific!
 * - "YYYYMMDD" (compact without dashes) is interpreted as Unix timestamp → WRONG dates!
 * - "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS" (ISO format with dashes) → WORKS correctly!
 *
 * SOLUTION: Use ISO format "YYYY-MM-DD HH:MM:SS" (with dashes, always with time).
 * This format is correctly parsed by Integram's PHP backend.
 *
 * @param {any} value - The value to format
 * @param {string} reqId - The requisite ID (for logging)
 * @returns {any} - Formatted value (dates in YYYY-MM-DD HH:MM:SS format for Integram PHP)
 */
function formatRequisiteValue(value, reqId) {
  if (value === null || value === undefined || value === '') {
    return value;
  }

  // Convert value to string for pattern matching
  const strValue = String(value);

  // Check if value looks like a date string (ISO format)
  // Patterns: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, YYYY-MM-DDTHH:MM:SS
  const isoDateRegex = /^(\d{4})[-\/.](\d{2})[-\/.](\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
  const match = strValue.match(isoDateRegex);

  if (match) {
    const [, year, month, day, hours, minutes, seconds] = match;

    // Convert to datetime-local format YYYY-MM-DDTHH:MM
    // This format works with both _m_new and _m_save endpoints
    const formattedHours = hours !== undefined ? hours : '00';
    const formattedMinutes = minutes !== undefined ? minutes : '00';
    return `${year}-${month}-${day}T${formattedHours}:${formattedMinutes}`;
  }

  // Check for Russian/European date format: DD.MM.YYYY
  const ruDateRegex = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/;
  const ruMatch = strValue.match(ruDateRegex);

  if (ruMatch) {
    const [, day, month, year, hours, minutes, seconds] = ruMatch;
    // Convert to datetime-local format YYYY-MM-DDTHH:MM
    const formattedHours = hours !== undefined ? hours : '00';
    const formattedMinutes = minutes !== undefined ? minutes : '00';
    return `${year}-${month}-${day}T${formattedHours}:${formattedMinutes}`;
  }

  return value;
}

/**
 * Integram API Client for MCP
 */
class IntegramMCPClient {
  constructor() {
    this.baseURL = null;
    this.database = null;
    this.token = null;
    this.xsrfToken = null;
    this.userId = null;
    this.userRole = null;
    this.userName = null;
    // Store credentials for auto-reconnect
    this._credentials = null;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 3;
  }

  /**
   * Check if response is a login page (session expired)
   */
  isLoginPageResponse(data) {
    if (typeof data === 'string') {
      return data.includes('<!doctype html>') &&
             (data.includes('Вход в Интеграм') || data.includes('Integram Sign'));
    }
    return false;
  }

  /**
   * Auto-reconnect if session expired
   */
  async reconnect() {
    if (!this._credentials) {
      throw new Error('Session expired and no credentials stored for auto-reconnect. Please authenticate again.');
    }
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      this._reconnectAttempts = 0;
      throw new Error('Max reconnect attempts reached. Please authenticate again.');
    }
    this._reconnectAttempts++;
    console.error(`[Integram MCP] Session expired, auto-reconnecting (attempt ${this._reconnectAttempts})...`);

    const { serverURL, database, login, password } = this._credentials;
    await this.authenticate(serverURL, database, login, password);
    this._reconnectAttempts = 0;
    console.error('[Integram MCP] Auto-reconnect successful');
  }

  /**
   * Build API URL based on server type
   *
   * Supports multiple URL structures:
   * - dronedoc.ru: https://xn--80afflxcxn.xn--p1ai/{database}/{endpoint}?JSON_KV
   * - integram.io: https://integram.io/api/{database}/{endpoint}
   * - app.integram.io: https://app.integram.io/api/{database}/{endpoint}
   * - Any custom domain: Auto-detects format based on domain patterns
   */
  buildURL(endpoint) {
    if (!this.database || !this.baseURL) {
      throw new Error('Database and baseURL must be set. Use authenticate or setContext first.');
    }

    // Remove trailing slash from baseURL to prevent double slashes
    let cleanBaseURL = this.baseURL.replace(/\/$/, '');

    // Check if baseURL already contains the database path
    const dbPathRegex = new RegExp(`/${this.database}$`);
    const hasDbInPath = dbPathRegex.test(cleanBaseURL);

    // Detect server type by domain name
    const isDronedoc = cleanBaseURL.includes('dronedoc.ru') ||
                       cleanBaseURL.includes('xn--80afflxcxn.xn--p1ai') || // интеграм.рф punycode
                       cleanBaseURL.includes('интеграм.рф'); // интеграм.рф Cyrillic - uses same format as dronedoc
    const isIntegram = cleanBaseURL.includes('integram.io');

    // Build URL based on server type
    if (isDronedoc) {
      // DronDoc format: https://xn--80afflxcxn.xn--p1ai/{database}/{endpoint}?JSON_KV
      // Issue #6480: ALWAYS add JSON_KV - it's required for X-Authorization to work!
      if (hasDbInPath) {
        const url = `${cleanBaseURL}/${endpoint}`;
        return endpoint.includes('?') ? `${url}&JSON_KV` : `${url}?JSON_KV`;
      }

      const url = `${cleanBaseURL}/${this.database}/${endpoint}`;
      return endpoint.includes('?') ? `${url}&JSON_KV` : `${url}?JSON_KV`;
    }

    if (isIntegram) {
      // Integram format: https://[app.]integram.io/api/{database}/{endpoint}

      // Remove database from baseURL if it's there (e.g., /positrack)
      if (hasDbInPath) {
        // Remove /database from the end
        cleanBaseURL = cleanBaseURL.replace(dbPathRegex, '');
      }

      // Always use /api/{database}/{endpoint} format for integram.io
      return `${cleanBaseURL}/api/${this.database}/${endpoint}`;
    }

    // Default format for unknown domains (assumes Integram-like API structure)
    // This provides compatibility with any custom Integram installation
    if (hasDbInPath) {
      return `${cleanBaseURL}/${endpoint}`;
    }

    return `${cleanBaseURL}/api/${this.database}/${endpoint}`;
  }

  /**
   * Execute raw GET request without auto-reconnect (for internal use)
   */
  async _getRaw(endpoint, params = {}) {
    const url = this.buildURL(endpoint);
    const headers = {};

    if (this.token) {
      headers['X-Authorization'] = this.token;
      headers['Cookie'] = `token=${this.token}`;
    }

    const response = await axios.get(url, { params, headers });
    return response.data;
  }

  /**
   * Execute GET request with auto-reconnect on session expiration
   */
  async get(endpoint, params = {}) {
    if (!this.token && endpoint !== 'xsrf') {
      throw new Error('Not authenticated. Call authenticate first.');
    }

    const data = await this._getRaw(endpoint, params);

    // Check for session expiration (login page response)
    if (this.isLoginPageResponse(data)) {
      await this.reconnect();
      return this._getRaw(endpoint, params);
    }

    return data;
  }

  /**
   * Execute raw POST request without auto-reconnect (for internal use)
   */
  async _postRaw(endpoint, data = {}, options = {}) {
    const url = this.buildURL(endpoint);

    // Build form data manually with proper encoding
    // URLSearchParams encodes space as '+' but Integram PHP expects '%20'
    const parts = [`_xsrf=${encodeURIComponent(this.xsrfToken)}`];
    for (const [key, value] of Object.entries(data)) {
      if (value !== null && value !== undefined) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
      }
    }
    const postData = parts.join('&');

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Authorization': this.token,
      // Issue #6480: dronedoc.ru uses Cookie, not just X-Authorization
      'Cookie': `token=${this.token}`
    };

    const response = await axios.post(url, postData, { headers, ...options });
    return response.data;
  }

  /**
   * Execute POST request with auto-reconnect on session expiration
   */
  async post(endpoint, data = {}, options = {}) {
    if (!this.token) {
      throw new Error('Not authenticated. Call authenticate first.');
    }

    const responseData = await this._postRaw(endpoint, data, options);

    // Check for session expiration (login page response)
    if (this.isLoginPageResponse(responseData)) {
      await this.reconnect();
      return this._postRaw(endpoint, data, options);
    }

    return responseData;
  }

  /**
   * Authenticate with Integram API
   */
  async authenticate(serverURL, database, login, password) {
    let cleanURL = serverURL.replace(/\/$/, '');
    if (cleanURL.includes('интеграм.рф')) {
      cleanURL = cleanURL.replace('интеграм.рф', 'xn--80afflxcxn.xn--p1ai');
    }
    this.baseURL = cleanURL;
    this.database = database;

    // Store credentials for auto-reconnect
    this._credentials = { serverURL: cleanURL, database, login, password };

    const url = this.buildURL('auth');
    console.error(`[Integram MCP DEBUG] Authenticating to: ${url}`);
    console.error(`[Integram MCP DEBUG] serverURL: ${serverURL}, database: ${database}, login: ${login}`);
    const formData = new URLSearchParams();
    formData.append('login', login);
    formData.append('pwd', password);

    const response = await axios.post(url, formData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (response.data.failed) {
      throw new Error('Invalid login or password');
    }

    this.token = response.data.token;
    this.xsrfToken = response.data._xsrf;

    // Fetch session info (bypass auto-reconnect check for this internal call)
    const sessionInfo = await this._getRaw('xsrf', {});
    this.userId = sessionInfo.id;
    this.userName = sessionInfo.user;
    this.userRole = sessionInfo.role;
    this.xsrfToken = sessionInfo._xsrf;
    this.token = sessionInfo.token;

    return {
      success: true,
      token: this.token,
      xsrf: this.xsrfToken,
      userId: this.userId,
      userName: this.userName,
      userRole: this.userRole
    };
  }

  /**
   * Set authentication context from existing session
   */
  setContext(serverURL, database, token, xsrfToken) {
    let cleanURL = serverURL.replace(/\/$/, '');
    if (cleanURL.includes('интеграм.рф')) {
      cleanURL = cleanURL.replace('интеграм.рф', 'xn--80afflxcxn.xn--p1ai');
    }
    this.baseURL = cleanURL;
    this.database = database;
    this.token = token;
    this.xsrfToken = xsrfToken;
  }
}

// Global client instance for MCP tools
const client = new IntegramMCPClient();

/**
 * MCP Server implementation
 */
const server = new Server(
  {
    name: 'integram-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * Tool definitions
 */
const TOOLS = [
  // ==================== Authentication ====================
  {
    name: 'integram_authenticate',
    description: 'Authenticate with Integram API and establish a session',
    inputSchema: {
      type: 'object',
      properties: {
        serverURL: {
          type: 'string',
          description: 'Integram server URL (e.g., https://xn--80afflxcxn.xn--p1ai or https://app.integram.io)'
        },
        database: {
          type: 'string',
          description: 'Database name (e.g., a2025)'
        },
        login: {
          type: 'string',
          description: 'Username'
        },
        password: {
          type: 'string',
          description: 'Password'
        }
      },
      required: ['serverURL', 'database', 'login', 'password']
    }
  },
  {
    name: 'integram_set_context',
    description: 'Set authentication context from existing session (token and xsrf)',
    inputSchema: {
      type: 'object',
      properties: {
        serverURL: {
          type: 'string',
          description: 'Integram server URL'
        },
        database: {
          type: 'string',
          description: 'Database name'
        },
        token: {
          type: 'string',
          description: 'Authentication token'
        },
        xsrfToken: {
          type: 'string',
          description: 'XSRF token'
        }
      },
      required: ['serverURL', 'database', 'token', 'xsrfToken']
    }
  },

  // ==================== DDL Operations ====================
  // ⚠️ baseTypeId MUST be SYSTEM base type (3=standard), NEVER a custom table ID!
  // To create related tables, use reference columns (requisiteTypeId = parent table ID)
  {
    name: 'integram_create_type',
    description: 'Create new type (table) in Integram',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Type name'
        },
        baseTypeId: {
          type: 'number',
          description: 'Base type ID (default 3 for standard tables, 0 is NOT allowed). ⚠️ MUST be SYSTEM type (3), never a custom table ID!',
          default: 3
        },
        unique: {
          type: 'boolean',
          description: 'First column is unique',
          default: false
        }
      },
      required: ['name']
    }
  },
  {
    name: 'integram_save_type',
    description: 'Save type properties',
    inputSchema: {
      type: 'object',
      properties: {
        typeId: {
          type: 'number',
          description: 'Type ID to save'
        },
        name: {
          type: 'string',
          description: 'Type name'
        },
        baseTypeId: {
          type: 'number',
          description: 'Base type ID (default 3 for standard tables, 0 is NOT allowed). ⚠️ MUST be SYSTEM type (3), never a custom table ID!',
          default: 3
        },
        unique: {
          type: 'boolean',
          description: 'First column is unique',
          default: false
        }
      },
      required: ['typeId', 'name']
    }
  },
  {
    name: 'integram_delete_type',
    description: 'Delete a type',
    inputSchema: {
      type: 'object',
      properties: {
        typeId: {
          type: 'number',
          description: 'Type ID to delete'
        }
      },
      required: ['typeId']
    }
  },
  {
    name: 'integram_add_requisite',
    description: 'Add requisite (column) to type',
    inputSchema: {
      type: 'object',
      properties: {
        typeId: {
          type: 'number',
          description: 'Type ID to add requisite to'
        },
        requisiteTypeId: {
          type: 'number',
          description: 'Requisite type ID'
        }
      },
      required: ['typeId', 'requisiteTypeId']
    }
  },
  {
    name: 'integram_delete_requisite',
    description: 'Delete a requisite',
    inputSchema: {
      type: 'object',
      properties: {
        requisiteId: {
          type: 'number',
          description: 'Requisite ID to delete'
        }
      },
      required: ['requisiteId']
    }
  },
  {
    name: 'integram_save_requisite_alias',
    description: 'Save requisite alias',
    inputSchema: {
      type: 'object',
      properties: {
        requisiteId: {
          type: 'number',
          description: 'Requisite ID'
        },
        alias: {
          type: 'string',
          description: 'Alias name'
        }
      },
      required: ['requisiteId', 'alias']
    }
  },
  {
    name: 'integram_toggle_requisite_null',
    description: 'Toggle requisite null flag',
    inputSchema: {
      type: 'object',
      properties: {
        requisiteId: {
          type: 'number',
          description: 'Requisite ID'
        }
      },
      required: ['requisiteId']
    }
  },
  {
    name: 'integram_toggle_requisite_multi',
    description: 'Toggle requisite multi-select flag',
    inputSchema: {
      type: 'object',
      properties: {
        requisiteId: {
          type: 'number',
          description: 'Requisite ID'
        }
      },
      required: ['requisiteId']
    }
  },
  {
    name: 'integram_rename_requisite',
    description: 'Rename requisite (column) name. This changes the actual name of the requisite, not its alias. Use _d_save endpoint.',
    inputSchema: {
      type: 'object',
      properties: {
        requisiteId: {
          type: 'number',
          description: 'Requisite ID to rename'
        },
        name: {
          type: 'string',
          description: 'New name for the requisite'
        },
        typeId: {
          type: 'number',
          description: 'Requisite type ID (e.g., 3=SHORT, 2=LONG, 13=NUMBER, 4=DATETIME, 7=BOOL, 8=REFERENCE)'
        }
      },
      required: ['requisiteId', 'name', 'typeId']
    }
  },

  // ==================== DML Operations ====================
  {
    name: 'integram_create_object',
    description: 'Create new object in Integram. Automatically sets up=1 for independent objects. For reference requisites (foreign keys), pass the target object ID as string value. The tool automatically applies requisites via _m_set after creation to ensure reference fields are saved correctly.',
    inputSchema: {
      type: 'object',
      properties: {
        typeId: {
          type: 'number',
          description: 'Object type ID (table ID)'
        },
        value: {
          type: 'string',
          description: 'Object name/value (main field)'
        },
        requisites: {
          type: 'object',
          description: 'Requisites as key-value pairs. Key is requisiteId (string), value is the field value. For reference fields, pass target object ID as string (e.g., {"197038": "197039"})',
          additionalProperties: true
        },
        parentId: {
          type: 'number',
          description: 'Parent ID for subordinate objects. If not provided, object is created as independent (up=1)'
        }
      },
      required: ['typeId', 'value']
    }
  },
  {
    name: 'integram_save_object',
    description: 'Save object value and requisites',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: {
          type: 'number',
          description: 'Object ID'
        },
        typeId: {
          type: 'number',
          description: 'Object type ID'
        },
        value: {
          type: 'string',
          description: 'Object value'
        },
        requisites: {
          type: 'object',
          description: 'Requisites as key-value pairs',
          additionalProperties: true
        }
      },
      required: ['objectId', 'typeId', 'value']
    }
  },
  {
    name: 'integram_set_object_requisites',
    description: 'Update object requisites (RECOMMENDED method for updating fields). Uses _m_save endpoint which correctly handles all field types including datetime and reference fields. Only updates specified requisites, leaves others unchanged.',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: {
          type: 'number',
          description: 'Object ID to update'
        },
        requisites: {
          type: 'object',
          description: 'Requisites to set as key-value pairs. Key is requisiteId (string), value is the new value. For reference fields, pass target object ID as string (e.g., {"197038": "197039"})',
          additionalProperties: true
        }
      },
      required: ['objectId', 'requisites']
    }
  },
  {
    name: 'integram_delete_object',
    description: 'Delete an object',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: {
          type: 'number',
          description: 'Object ID to delete'
        }
      },
      required: ['objectId']
    }
  },
  {
    name: 'integram_move_object_up',
    description: 'Move object up in order',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: {
          type: 'number',
          description: 'Object ID'
        }
      },
      required: ['objectId']
    }
  },
  {
    name: 'integram_move_object_to_parent',
    description: 'Move subordinate object to another parent',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: {
          type: 'number',
          description: 'Object ID to move'
        },
        newParentId: {
          type: 'number',
          description: 'New parent ID'
        }
      },
      required: ['objectId', 'newParentId']
    }
  },

  // ==================== Query Operations ====================
  {
    name: 'integram_get_dictionary',
    description: 'Get dictionary (list of independent types)',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'integram_get_type_metadata',
    description: 'Get type metadata',
    inputSchema: {
      type: 'object',
      properties: {
        typeId: {
          type: 'number',
          description: 'Type ID'
        }
      },
      required: ['typeId']
    }
  },
  {
    name: 'integram_get_object_list',
    description: '⚠️ FOR BROWSING ONLY - DO NOT USE FOR SEARCHING!\n\nGet ONE PAGE of objects for displaying lists to user. Returns 20 objects by default.\n\n❌ DO NOT USE when user asks "find X" or "search for X"\n✅ USE ONLY when user asks "show list" or "display objects"\n\nFor SEARCHING use: integram_natural_query (recommended) or integram_smart_query\n\nPagination params:\n- pg: page number (1-based, default: 1)\n- LIMIT: objects per page (default: 20)\n- F_U: filter unique objects (default: 1)\n\nExample: {typeId: 18, params: {pg: 2, LIMIT: 50}} - get 50 users from page 2',
    inputSchema: {
      type: 'object',
      properties: {
        typeId: {
          type: 'number',
          description: 'Type ID'
        },
        params: {
          type: 'object',
          description: 'Pagination & filter parameters: {pg: 1, LIMIT: 20, F_U: 1, ...other filters}',
          additionalProperties: true,
          properties: {
            pg: {
              type: 'number',
              description: 'Page number (1-based). Default: 1'
            },
            LIMIT: {
              type: 'number',
              description: 'Objects per page. Default: 20'
            },
            F_U: {
              type: 'number',
              description: 'Filter unique objects. Default: 1'
            }
          }
        }
      },
      required: ['typeId']
    }
  },
  {
    name: 'integram_get_all_objects',
    description: '✅ ALTERNATIVE SEARCH - Get ALL objects for type with automatic pagination. Fetches all pages until no more data available. Can be used for searching when you need all objects to filter/search through.',
    inputSchema: {
      type: 'object',
      properties: {
        typeId: {
          type: 'number',
          description: 'Type ID'
        },
        pageSize: {
          type: 'number',
          description: 'Number of objects per page (default: 100)',
          default: 100
        },
        maxPages: {
          type: 'number',
          description: 'Maximum pages to fetch (default: 50, safety limit)',
          default: 50
        }
      },
      required: ['typeId']
    }
  },
  {
    name: 'integram_get_object_count',
    description: 'Get count of objects in a type (table) without fetching all data. Fast way to check how many records exist.',
    inputSchema: {
      type: 'object',
      properties: {
        typeId: {
          type: 'number',
          description: 'Type ID to count objects for'
        }
      },
      required: ['typeId']
    }
  },
  {
    name: 'integram_get_object_edit_data',
    description: 'Get object edit form data',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: {
          type: 'number',
          description: 'Object ID'
        }
      },
      required: ['objectId']
    }
  },
  {
    name: 'integram_get_type_editor_data',
    description: 'Get type editor data',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'integram_execute_report',
    description: 'Execute a report',
    inputSchema: {
      type: 'object',
      properties: {
        reportId: {
          type: 'number',
          description: 'Report ID'
        },
        params: {
          type: 'object',
          description: 'Report parameters',
          additionalProperties: true
        }
      },
      required: ['reportId']
    }
  },
  {
    name: 'integram_get_reference_options',
    description: 'Get reference options for select dropdowns',
    inputSchema: {
      type: 'object',
      properties: {
        requisiteId: {
          type: 'number',
          description: 'Requisite ID'
        },
        objectId: {
          type: 'number',
          description: 'Object ID being edited'
        },
        restrict: {
          type: 'number',
          description: 'Optional restriction filter'
        },
        query: {
          type: 'string',
          description: 'Optional search query'
        }
      },
      required: ['requisiteId', 'objectId']
    }
  },

  // ==================== Multiselect Operations ====================
  {
    name: 'integram_add_multiselect_item',
    description: 'Add item to multiselect field',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: {
          type: 'number',
          description: 'Object ID being edited'
        },
        requisiteId: {
          type: 'number',
          description: 'Requisite ID of multiselect field'
        },
        value: {
          type: ['number', 'string'],
          description: 'ID of item to add'
        }
      },
      required: ['objectId', 'requisiteId', 'value']
    }
  },
  {
    name: 'integram_remove_multiselect_item',
    description: 'Remove item from multiselect field',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: {
          type: 'number',
          description: 'Multiselect item ID (NOT the referenced object ID)'
        }
      },
      required: ['itemId']
    }
  },
  {
    name: 'integram_get_multiselect_items',
    description: 'Get multiselect items for an object\'s field. Returns array of {id, value} for each selected item.',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: {
          type: 'number',
          description: 'Object ID to get multiselect items from'
        },
        requisiteId: {
          type: 'number',
          description: 'Requisite ID of multiselect field'
        }
      },
      required: ['objectId', 'requisiteId']
    }
  },

  // ==================== File Operations ====================
  {
    name: 'integram_get_dir_admin',
    description: 'Get directory admin data',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path',
          default: ''
        }
      }
    }
  },
  {
    name: 'integram_create_backup',
    description: 'Create database backup',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },

  // ==================== Legacy API Operations ====================
  // These tools provide full parity with the legacy Integram PHP API
  {
    name: 'integram_modify_requisite_attributes',
    description: 'Modify requisite attributes in one operation (_d_attrs / _modifiers). Sets alias, null flag, and multi flag for a requisite in a single API call.',
    inputSchema: {
      type: 'object',
      properties: {
        requisiteId: {
          type: 'number',
          description: 'Requisite ID to modify'
        },
        alias: {
          type: 'string',
          description: 'Alias to set for the requisite (optional)'
        },
        setNull: {
          type: 'boolean',
          description: 'Set NOT_NULL constraint (optional)',
          default: false
        },
        multi: {
          type: 'boolean',
          description: 'Set MULTI (multiselect) flag (optional)',
          default: false
        }
      },
      required: ['requisiteId']
    }
  },
  {
    name: 'integram_create_database',
    description: `Create new database (_new_db).

⚠️ CRITICAL: Must authenticate to database "my" first!
Use: integram_authenticate with database="my"
Calling from any other database returns: "Создайте базу в Личном кабинете!"

Limitations:
- Free plan: max 3 databases per account
- Name: 3-15 latin letters/digits, must start with letter
- Reserved/occupied names are blocked

Possible errors:
- "Создайте базу в Личном кабинете!" - wrong database (not "my")
- "Недопустимое имя базы" - invalid name format
- "Имя базы занято" - name already taken
- "В бесплатном тарифе доступно не более 3 баз" - free plan limit exceeded`,
    inputSchema: {
      type: 'object',
      properties: {
        dbName: {
          type: 'string',
          description: 'New database name. Requirements: 3-15 chars, latin letters (a-z) and digits (0-9) only, must start with a letter. Examples: "mydb", "project1", "testdb"'
        },
        template: {
          type: 'string',
          description: 'Template: "ru" (Russian), "en" (English), or existing database name to clone structure from',
          default: 'ru'
        },
        description: {
          type: 'string',
          description: 'Optional database description (stored in personal cabinet)'
        }
      },
      required: ['dbName']
    }
  },
  {
    name: 'integram_get_ref_reqs',
    description: 'Get reference requisites/options for dropdown lists (_ref_reqs). Returns options for reference (lookup) fields including related requisite values.',
    inputSchema: {
      type: 'object',
      properties: {
        requisiteId: {
          type: 'number',
          description: 'Requisite ID of the reference field'
        },
        objectId: {
          type: 'number',
          description: 'Object ID being edited (optional, default 0)',
          default: 0
        },
        query: {
          type: 'string',
          description: 'Search query to filter options (optional)'
        },
        restrict: {
          type: 'number',
          description: 'Restriction filter / parent ID (optional)'
        },
        limit: {
          type: 'number',
          description: 'Maximum options to return (default 100)',
          default: 100
        }
      },
      required: ['requisiteId']
    }
  },
  {
    name: 'integram_execute_connector',
    description: 'Execute external connector (_connect). Fetches data from an external URL defined in the object\'s CONNECT requisite. Allows Integram to act as a proxy to external APIs.',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: {
          type: 'number',
          description: 'Object ID that has a CONNECT requisite with external URL'
        },
        params: {
          type: 'object',
          description: 'Query parameters to pass to the external URL',
          additionalProperties: true
        }
      },
      required: ['objectId']
    }
  },

  // ==================== High-Level Table Operations ====================
  //
  // ⚠️ CRITICAL WARNING: baseTypeId MUST be a SYSTEM base type (3 or 0), NEVER a custom table ID!
  //
  // Common Mistake: Using custom table ID as baseTypeId when creating "child" tables
  // ❌ WRONG: baseTypeId: 994762 (custom table ID) → Error: "Неверный базовый тип: 994762"
  // ✅ CORRECT: baseTypeId: 3 (standard) + add reference column with requisiteTypeId: 994762
  //
  // To create related/subordinate tables in Integram:
  // 1. Always use baseTypeId: 3 (standard) or appropriate system type
  // 2. Add a REFERENCE COLUMN using requisiteTypeId = parent table ID
  // 3. Parent-child relationships are at OBJECT level (parentId/up field), not TYPE level
  //
  {
    name: 'integram_create_table_with_columns',
    description: 'Create complete table with columns in one operation. This is a high-level tool that creates a type and adds all requisites (columns) with their aliases.',
    inputSchema: {
      type: 'object',
      properties: {
        tableName: {
          type: 'string',
          description: 'Table name (Russian name recommended)'
        },
        baseTypeId: {
          type: 'number',
          description: 'Base type ID (default 3 for standard tables, 0 is NOT allowed). ⚠️ MUST be SYSTEM type (3), never a custom table ID!',
          default: 3
        },
        parentTableId: {
          type: 'number',
          description: 'OPTIONAL: ID of parent table for creating SUBORDINATE tables. When provided, automatically adds a reference column to the parent table. This is the CORRECT way to create related/child tables in Integram.'
        },
        parentColumnAlias: {
          type: 'string',
          description: 'Alias for the parent reference column (default: "Родительская запись")',
          default: 'Родительская запись'
        },
        unique: {
          type: 'boolean',
          description: 'First column is unique',
          default: false
        },
        columns: {
          type: 'array',
          description: 'Array of columns to create',
          items: {
            type: 'object',
            properties: {
              requisiteTypeId: {
                type: 'number',
                description: 'Requisite type ID (3=SHORT, 2=LONG, 13=NUMBER, 4=DATETIME, 7=BOOL, 8=REFERENCE, etc.)'
              },
              alias: {
                type: 'string',
                description: 'Column alias (Russian name recommended)'
              },
              allowNull: {
                type: 'boolean',
                description: 'Allow NULL values',
                default: true
              },
              multiSelect: {
                type: 'boolean',
                description: 'Enable multi-select for this column',
                default: false
              }
            },
            required: ['requisiteTypeId', 'alias']
          }
        }
      },
      required: ['tableName', 'columns']
    }
  },
  {
    name: 'integram_delete_table_cascade',
    description: 'Delete table and all its data (cascade deletion). WARNING: This permanently deletes the type and all objects of this type.',
    inputSchema: {
      type: 'object',
      properties: {
        typeId: {
          type: 'number',
          description: 'Type ID to delete'
        },
        confirm: {
          type: 'boolean',
          description: 'Confirmation flag (must be true to proceed)',
          default: false
        }
      },
      required: ['typeId', 'confirm']
    }
  },
  {
    name: 'integram_get_table_structure',
    description: 'Get complete table structure including type metadata, all columns (requisites) with their properties, and column statistics',
    inputSchema: {
      type: 'object',
      properties: {
        typeId: {
          type: 'number',
          description: 'Type ID to get structure for'
        }
      },
      required: ['typeId']
    }
  },
  {
    name: 'integram_clone_table_structure',
    description: 'Clone table structure (create new table with same columns as existing table)',
    inputSchema: {
      type: 'object',
      properties: {
        sourceTypeId: {
          type: 'number',
          description: 'Source type ID to clone from'
        },
        newTableName: {
          type: 'string',
          description: 'New table name'
        },
        baseTypeId: {
          type: 'number',
          description: 'Base type ID for new table (default 3, type 0 is NOT allowed). ⚠️ MUST be SYSTEM type (3), never a custom table ID!',
          default: 3
        }
      },
      required: ['sourceTypeId', 'newTableName']
    }
  },
  {
    name: 'integram_rename_table',
    description: 'Rename existing table',
    inputSchema: {
      type: 'object',
      properties: {
        typeId: {
          type: 'number',
          description: 'Type ID to rename'
        },
        newName: {
          type: 'string',
          description: 'New table name'
        }
      },
      required: ['typeId', 'newName']
    }
  },
  {
    name: 'integram_add_columns_to_table',
    description: 'Add multiple columns to existing table in one operation',
    inputSchema: {
      type: 'object',
      properties: {
        typeId: {
          type: 'number',
          description: 'Type ID to add columns to'
        },
        columns: {
          type: 'array',
          description: 'Array of columns to add',
          items: {
            type: 'object',
            properties: {
              requisiteTypeId: {
                type: 'number',
                description: 'Requisite type ID'
              },
              alias: {
                type: 'string',
                description: 'Column alias (Russian name recommended)'
              },
              allowNull: {
                type: 'boolean',
                description: 'Allow NULL values',
                default: true
              },
              multiSelect: {
                type: 'boolean',
                description: 'Enable multi-select',
                default: false
              }
            },
            required: ['requisiteTypeId', 'alias']
          }
        }
      },
      required: ['typeId', 'columns']
    }
  },

  // ==================== Reference/Lookup Column Operations ====================
  {
    name: 'integram_add_reference_column',
    description: 'Add a reference (lookup/dropdown) column to a table that links to another table (справочник). This creates a proper reference field with ref attribute that displays as a dropdown selector. Use referenceTableId to specify which table to link to.',
    inputSchema: {
      type: 'object',
      properties: {
        typeId: {
          type: 'number',
          description: 'Table ID to add the reference column to'
        },
        referenceTableId: {
          type: 'number',
          description: 'ID of the table to reference (the lookup/справочник table). This table must exist and be independent (up=0).'
        },
        alias: {
          type: 'string',
          description: 'Column alias/name (Russian name recommended, e.g., "Статус ФНС", "Тип организации")'
        },
        multiSelect: {
          type: 'boolean',
          description: 'Enable multi-select (allows selecting multiple values from the reference table)',
          default: false
        },
        allowNull: {
          type: 'boolean',
          description: 'Allow NULL values (optional field)',
          default: true
        }
      },
      required: ['typeId', 'referenceTableId', 'alias']
    }
  },
  {
    name: 'integram_create_lookup_table',
    description: 'Create a new lookup/reference table (справочник) with initial values. This is a high-level tool that creates a table suitable for use as a dropdown reference, and optionally populates it with values.',
    inputSchema: {
      type: 'object',
      properties: {
        tableName: {
          type: 'string',
          description: 'Lookup table name (Russian name recommended, e.g., "Статус ФНС", "Тип организации")'
        },
        values: {
          type: 'array',
          description: 'Optional array of initial values to populate the lookup table',
          items: {
            type: 'string'
          }
        },
        baseTypeId: {
          type: 'number',
          description: 'Base type ID (default 3, type 0 is NOT allowed). ⚠️ MUST be SYSTEM type (3), never a custom table ID!',
          default: 3
        },
        unique: {
          type: 'boolean',
          description: 'Make values unique (recommended for lookup tables)',
          default: true
        }
      },
      required: ['tableName']
    }
  },
  {
    name: 'integram_create_lookup_with_reference',
    description: 'Create a lookup table AND add it as a reference column to another table in one operation. This combines integram_create_lookup_table and integram_add_reference_column.',
    inputSchema: {
      type: 'object',
      properties: {
        targetTableId: {
          type: 'number',
          description: 'Table ID where the reference column will be added'
        },
        lookupTableName: {
          type: 'string',
          description: 'Name for the new lookup table (Russian name recommended)'
        },
        columnAlias: {
          type: 'string',
          description: 'Alias for the reference column (if different from lookup table name)'
        },
        values: {
          type: 'array',
          description: 'Optional initial values for the lookup table',
          items: {
            type: 'string'
          }
        },
        multiSelect: {
          type: 'boolean',
          description: 'Enable multi-select for the reference column',
          default: false
        },
        baseTypeId: {
          type: 'number',
          description: 'Base type ID for the lookup table (default 3, type 0 is NOT allowed). ⚠️ MUST be SYSTEM type (3), never a custom table ID!',
          default: 3
        }
      },
      required: ['targetTableId', 'lookupTableName']
    }
  },

  // ==================== Report/Query Operations (typeId=22) ====================
  {
    name: 'integram_create_report',
    description: 'Create a new report/query (Запрос, typeId=22) with optional FROM tables and columns. This is a high-level tool for creating reports.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Report name (Russian name recommended)'
        },
        fromTables: {
          type: 'array',
          description: 'Array of FROM tables to add. Each entry can be a table ID or an object with {tableId, alias, joinOn}',
          items: {
            type: 'object',
            properties: {
              tableId: { type: 'number', description: 'Table type ID to add to FROM' },
              alias: { type: 'string', description: 'Optional ALIAS for the table' },
              joinOn: { type: 'string', description: 'Optional JOIN ON condition' }
            },
            required: ['tableId']
          }
        },
        columns: {
          type: 'array',
          description: 'Array of columns to add. See integram_add_report_column for column format',
          items: {
            type: 'object',
            properties: {
              fieldId: { type: 'number', description: 'Field ID (0 for calculated column)' },
              nameInReport: { type: 'string', description: 'Column name in report (req 100)' },
              formula: { type: 'string', description: 'Formula/alias (req 101)' },
              functionId: { type: 'number', description: 'Function ID, e.g., 85 for abn_ID (req 104)' },
              set: { type: 'string', description: 'SET expression for calculated columns (req 132)' },
              hide: { type: 'boolean', description: 'Hide column (req 107)' },
              alias: { type: 'string', description: 'ALIAS (req 58)' }
            }
          }
        },
        where: { type: 'string', description: 'WHERE clause (req 262)' },
        having: { type: 'string', description: 'HAVING clause (req 263)' },
        orderBy: { type: 'string', description: 'ORDER BY clause (req 264)' },
        limit: { type: 'string', description: 'LIMIT value (req 134)' },
        execute: { type: 'boolean', description: 'Set EXECUTE flag (req 228)', default: false }
      },
      required: ['name']
    }
  },
  {
    name: 'integram_add_report_column',
    description: 'Add a column to an existing report (typeId=28). Columns are subordinate objects of the report with specific requisites for field configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        reportId: {
          type: 'number',
          description: 'Report ID (parent) to add column to'
        },
        fieldId: {
          type: 'number',
          description: 'Field ID from rep_col_list. Use 0 for calculated/computed columns'
        },
        nameInReport: {
          type: 'string',
          description: 'Column display name in report (requisite 100 - Имя в отчете)'
        },
        formula: {
          type: 'string',
          description: 'Formula or alias reference (requisite 101 - Формула). For calculated columns, use [field_alias] syntax'
        },
        functionId: {
          type: 'number',
          description: 'Function ID (requisite 104 - Функция). Use 85 for abn_ID (ID function)'
        },
        set: {
          type: 'string',
          description: 'SET expression for calculated columns (requisite 132 - Присвоить). E.g., RAND(), IF(...), POWER(...)'
        },
        hide: {
          type: 'boolean',
          description: 'Hide column from output (requisite 107 - Скрыть)',
          default: false
        },
        alias: {
          type: 'string',
          description: 'Column ALIAS (requisite 58)'
        },
        format: {
          type: 'number',
          description: 'Display format ID (requisite 84)'
        },
        sort: {
          type: 'number',
          description: 'Sort order (requisite 109 - Сорт.)'
        },
        total: {
          type: 'number',
          description: 'Total/aggregate function ID (requisite 72 - Итог)'
        }
      },
      required: ['reportId', 'fieldId']
    }
  },
  {
    name: 'integram_add_report_from',
    description: 'Add a FROM table to an existing report (typeId=44). FROM entries define which tables the report queries.',
    inputSchema: {
      type: 'object',
      properties: {
        reportId: {
          type: 'number',
          description: 'Report ID (parent) to add FROM table to'
        },
        tableId: {
          type: 'number',
          description: 'Table type ID to add to FROM clause'
        },
        alias: {
          type: 'string',
          description: 'Table ALIAS in the query (requisite 265)'
        },
        joinOn: {
          type: 'string',
          description: 'JOIN ON condition (requisite 266)'
        }
      },
      required: ['reportId', 'tableId']
    }
  },
  {
    name: 'integram_clone_report',
    description: 'Clone an existing report with all its FROM tables and columns. Creates a complete copy with a new name.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceReportId: {
          type: 'number',
          description: 'Source report ID to clone'
        },
        newName: {
          type: 'string',
          description: 'Name for the cloned report'
        },
        setExecute: {
          type: 'boolean',
          description: 'Set EXECUTE flag on cloned report',
          default: false
        }
      },
      required: ['sourceReportId', 'newName']
    }
  },
  {
    name: 'integram_get_report_structure',
    description: 'Get complete structure of a report including FROM tables and all columns with their requisites.',
    inputSchema: {
      type: 'object',
      properties: {
        reportId: {
          type: 'number',
          description: 'Report ID to get structure for'
        }
      },
      required: ['reportId']
    }
  },
  // === HIGH-LEVEL BATCH TOOLS ===
  {
    name: 'integram_create_objects_batch',
    description: 'Create multiple objects (rows) in a table in one operation. Each object includes its value and all requisites. Returns array of created object IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        typeId: {
          type: 'number',
          description: 'Table type ID to create objects in'
        },
        objects: {
          type: 'array',
          description: 'Array of objects to create. Each object has "value" (main field) and "requisites" (key-value pairs where key is requisiteId)',
          items: {
            type: 'object',
            properties: {
              value: {
                type: 'string',
                description: 'Object name/value (main field)'
              },
              requisites: {
                type: 'object',
                description: 'Requisites as key-value pairs. Key is requisiteId (string), value is the field value.',
                additionalProperties: true
              }
            },
            required: ['value']
          }
        },
        parentId: {
          type: 'number',
          description: 'Parent ID for subordinate objects. If not provided, objects are created as independent (up=1)'
        }
      },
      required: ['typeId', 'objects']
    }
  },
  {
    name: 'integram_create_parent_with_children',
    description: 'Create a parent object and its subordinate (child) objects in one operation. Useful for creating hierarchical data like report with columns, or order with items.',
    inputSchema: {
      type: 'object',
      properties: {
        parentTypeId: {
          type: 'number',
          description: 'Type ID of the parent table'
        },
        parentValue: {
          type: 'string',
          description: 'Name/value for the parent object'
        },
        parentRequisites: {
          type: 'object',
          description: 'Requisites for the parent object (key=requisiteId, value=field value)',
          additionalProperties: true
        },
        childTypeId: {
          type: 'number',
          description: 'Type ID of the child table'
        },
        children: {
          type: 'array',
          description: 'Array of child objects to create under the parent',
          items: {
            type: 'object',
            properties: {
              value: {
                type: 'string',
                description: 'Child object name/value'
              },
              requisites: {
                type: 'object',
                description: 'Requisites for the child object',
                additionalProperties: true
              }
            },
            required: ['value']
          }
        }
      },
      required: ['parentTypeId', 'parentValue', 'childTypeId', 'children']
    }
  },
  // === SMART QUERY TOOLS (LLM-Optimized) ===
  {
    name: 'integram_get_schema',
    description: `Get compact database schema for LLM context. Returns all tables with their fields in a format optimized for AI understanding.

Output format per table:
- id: Table type ID (use in queries)
- name: Table name (Russian)
- fields: Array of {id, name, type, ref?} where ref is target table ID for references

Field types: SHORT=text, LONG=longtext, NUMBER=number, DATETIME=datetime, BOOL=boolean, REF=reference

Use this to understand available data before creating queries.`,
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'string',
          description: 'Optional filter string to match table names (case-insensitive)'
        },
        includeSystemTables: {
          type: 'boolean',
          description: 'Include system tables like User, Query, Role (default: false)'
        }
      },
      required: []
    }
  },
  {
    name: 'integram_smart_query',
    description: `✅ PRIMARY SEARCH TOOL - Use this to search across ENTIRE table!

Execute a smart query with WHERE clause. Automatically searches ALL objects in table, not just one page.

🔍 USE THIS WHEN:
- User asks "find X" or "search for X"
- Need to locate specific object by name/value
- Need to filter/search across entire dataset

Input JSON structure:
{
  "tables": [{"id": 204210, "alias": "c"}],           // FROM tables
  "columns": [                                         // SELECT columns
    {"field": 204210, "name": "Клиент"},              // field=tableId for main value
    {"field": 204214, "name": "Телефон"},             // field=requisiteId for requisite
    {"field": 0, "formula": "COUNT(*)", "name": "Количество"}  // field=0 for computed
  ],
  "where": "c.204214 IS NOT NULL",                    // WHERE clause (MySQL syntax)
  "having": "",                                        // HAVING clause
  "orderBy": "c.204210 DESC",                         // ORDER BY clause
  "limit": 100                                         // LIMIT
}

Returns query results as JSON array with headers and rows.`,
    inputSchema: {
      type: 'object',
      properties: {
        tables: {
          type: 'array',
          description: 'FROM tables. Each: {id: tableTypeId, alias?: "t1"}',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number', description: 'Table type ID' },
              alias: { type: 'string', description: 'Table alias in query (optional)' },
              joinOn: { type: 'string', description: 'JOIN ON condition (optional, for 2nd+ tables)' }
            },
            required: ['id']
          }
        },
        fromTable: {
          type: 'string',
          description: 'Shorthand: single table name or ID. Alternative to "tables" array for simple queries.'
        },
        columns: {
          type: 'array',
          description: 'SELECT columns. Each: {field: fieldId, name?: "name", total?: "COUNT", groupBy?: true}',
          items: {
            type: 'object',
            properties: {
              field: { type: ['number', 'string'], description: 'Field ID from rep_col_list (use integram_get_type_metadata to get IDs). Use 0 for computed columns. Can be "tableId.requisiteId" format.' },
              name: { type: 'string', description: 'Column display name (alias: "alias")' },
              alias: { type: 'string', description: 'Column display name (same as "name")' },
              formula: { type: 'string', description: 'MySQL formula for computed column (when field=0). Prefer using "total" for aggregates.' },
              total: { type: 'string', description: 'Aggregate function: SUM, AVG, MIN, MAX, COUNT. Use this instead of formula for standard aggregates.' },
              sort: { type: 'string', description: 'Sort order: ASC or DESC' },
              hide: { type: 'boolean', description: 'Hide column from output' },
              groupBy: { type: 'boolean', description: 'Set to true for GROUP BY columns (SET field). Required when using aggregate functions.' },
              valueFrom: { type: 'string', description: 'Filter: minimum value (Значение от). For references, use object ID.' },
              valueTo: { type: 'string', description: 'Filter: maximum value (Значение до). For references, use object ID. Set same as valueFrom for exact match.' },
              function: { type: 'string', description: 'Transform function: SUM, COUNT, MAX, MIN, AVG, ROUND, MONTH, YEAR, GROUP_CONCAT, or abn_* functions. Applied to column values.' },
              functionFrom: { type: 'string', description: 'Function parameter FROM (Функция от). Used with ROUND, etc.' },
              functionTo: { type: 'string', description: 'Function parameter TO (Функция до). Used with ROUND, etc.' }
            },
            required: ['field']
          }
        },
        where: {
          type: 'string',
          description: 'WHERE clause in MySQL syntax. Use alias.fieldId format, e.g., "t1.204214 LIKE \\"%test%\\"". Supports: =, <>, <, >, LIKE, IN, IS NULL, IS NOT NULL, AND, OR'
        },
        having: {
          type: 'string',
          description: 'HAVING clause for aggregate filtering'
        },
        orderBy: {
          type: 'string',
          description: 'ORDER BY clause, e.g., "t1.204210 DESC"'
        },
        limit: {
          type: 'number',
          description: 'Maximum rows to return (default: 100)'
        },
        reportName: {
          type: 'string',
          description: 'Optional name for the report (for debugging). Auto-generated if not provided.'
        }
      },
      required: ['tables', 'columns']
    }
  },
  {
    name: 'integram_natural_query',
    description: `✅ EASIEST SEARCH TOOL - Perfect for finding objects by natural language!

Convert natural language question to database query and search ENTIRE table automatically.

🔍 USE THIS WHEN:
- User asks simple questions: "найди пользователя X", "покажи клиентов с телефоном"
- Easiest option for searching - no SQL knowledge needed
- Automatically searches ALL objects, not just first page

Examples:
- "Найди пользователя dmi" → searches ALL users in table
- "Покажи всех клиентов с телефоном"
- "Сколько сделок в каждом статусе?"

This tool:
1. Gets database schema
2. Analyzes the question
3. Builds appropriate query with WHERE clause
4. Searches ENTIRE table and returns results

Best for: Simple search queries. For complex joins/aggregations, use integram_smart_query.`,
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Natural language question about the data'
        },
        targetTable: {
          type: 'number',
          description: 'Optional: specific table ID to query (helps with ambiguous questions)'
        },
        limit: {
          type: 'number',
          description: 'Maximum rows to return (default: 50)'
        }
      },
      required: ['question']
    }
  },

  // ==================== Additional Operations (from Vue clients) ====================
  {
    name: 'integram_set_object_order',
    description: 'Set object order in list',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: {
          type: 'number',
          description: 'Object ID'
        },
        order: {
          type: 'number',
          description: 'New order value'
        }
      },
      required: ['objectId', 'order']
    }
  },
  {
    name: 'integram_set_object_id',
    description: 'Set new ID for an object',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: {
          type: 'number',
          description: 'Current object ID'
        },
        newId: {
          type: 'number',
          description: 'New ID to set'
        }
      },
      required: ['objectId', 'newId']
    }
  },
  {
    name: 'integram_set_requisite_order',
    description: 'Set requisite order in type',
    inputSchema: {
      type: 'object',
      properties: {
        requisiteId: {
          type: 'number',
          description: 'Requisite ID'
        },
        order: {
          type: 'number',
          description: 'New order value'
        }
      },
      required: ['requisiteId', 'order']
    }
  },
  {
    name: 'integram_get_all_types_metadata',
    description: 'Get metadata for all types in database',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'integram_get_object_meta',
    description: 'Get object metadata (type, parent, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: {
          type: 'number',
          description: 'Object ID'
        }
      },
      required: ['objectId']
    }
  }
];

/**
 * List tools handler
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS,
  };
});

/**
 * Call tool handler
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      // Authentication
      case 'integram_authenticate':
        result = await client.authenticate(
          args.serverURL,
          args.database,
          args.login,
          args.password
        );
        break;

      case 'integram_set_context':
        client.setContext(
          args.serverURL,
          args.database,
          args.token,
          args.xsrfToken
        );
        result = { success: true, message: 'Context set successfully' };
        break;

      // DDL Operations
      // ⚠️ CRITICAL: baseTypeId MUST be a SYSTEM base type (3=standard), NEVER a custom table ID!
      // To create related tables: use baseTypeId:3 + add reference column (requisiteTypeId = parent table ID)
      case 'integram_create_type':
        {
          // Never use baseTypeId=0, it creates invisible system tables. Default is 3 (SHORT)
          const effectiveBaseTypeId = args.baseTypeId && args.baseTypeId !== 0 ? args.baseTypeId : 3;
          // HARD VALIDATION: Reject custom table IDs as baseTypeId
          validateBaseTypeId(effectiveBaseTypeId, 'integram_create_type');
          result = await client.post('_d_new', {
            val: args.name,
            t: effectiveBaseTypeId,
            ...(args.unique && { unique: 1 })
          });
        }
        break;

      case 'integram_save_type':
        {
          // Never use baseTypeId=0, it creates invisible system tables. Default is 3 (SHORT)
          const effectiveBaseTypeId = args.baseTypeId && args.baseTypeId !== 0 ? args.baseTypeId : 3;
          // HARD VALIDATION: Reject custom table IDs as baseTypeId
          validateBaseTypeId(effectiveBaseTypeId, 'integram_save_type');
          result = await client.post(`_d_save/${args.typeId}`, {
            val: args.name,
            t: effectiveBaseTypeId,
            ...(args.unique && { unique: 1 })
          });
        }
        break;

      case 'integram_delete_type':
        result = await client.post(`_d_del/${args.typeId}`);
        break;

      case 'integram_add_requisite':
        result = await client.post(`_d_req/${args.typeId}`, {
          t: args.requisiteTypeId
        });
        break;

      case 'integram_delete_requisite':
        result = await client.post(`_d_del_req/${args.requisiteId}`);
        break;

      case 'integram_save_requisite_alias':
        result = await client.post(`_d_alias/${args.requisiteId}`, {
          val: args.alias
        });
        break;

      case 'integram_toggle_requisite_null':
        result = await client.post(`_d_null/${args.requisiteId}`);
        break;

      case 'integram_toggle_requisite_multi':
        result = await client.post(`_d_multi/${args.requisiteId}`);
        break;

      case 'integram_rename_requisite':
        result = await client.post(`_d_save/${args.requisiteId}`, {
          val: args.name,
          t: args.typeId
        });
        break;

      // DML Operations
      case 'integram_create_object':
        {
          const data = {
            [`t${args.typeId}`]: args.value
          };
          // up=1 для независимых объектов, или parentId для подчинённых
          data.up = args.parentId || 1;
          if (args.requisites) {
            for (const [reqId, reqValue] of Object.entries(args.requisites)) {
              // Format date values to Unix timestamps
              data[`t${reqId}`] = formatRequisiteValue(reqValue, reqId);
            }
          }
          // Issue #6451: full=1 MUST be in URL params to prevent 127 char truncation
          result = await client.post(`_m_new/${args.typeId}?full=1`, data);
          // Note: _m_new correctly saves all requisites including dates
          // Do NOT call _m_set after _m_new as it can corrupt datetime values
        }
        break;

      case 'integram_save_object':
        {
          const data = {
            [`t${args.typeId}`]: args.value
          };
          if (args.requisites) {
            for (const [reqId, reqValue] of Object.entries(args.requisites)) {
              // Format date values to Unix timestamps
              const formatted = formatRequisiteValue(reqValue, reqId);
              data[`t${reqId}`] = formatted !== null && formatted !== undefined ? formatted : '';
            }
          }
          // Issue #6451: full=1 MUST be in URL params to prevent 127 char truncation
          result = await client.post(`_m_save/${args.objectId}?full=1`, data);
        }
        break;

      case 'integram_set_object_requisites':
        {
          // First, get object metadata (typeId and current value)
          // _m_save requires t{typeId}=value to work correctly
          const objMeta = await client.get(`edit_obj/${args.objectId}`);
          const typeId = objMeta.obj?.typ;
          const objValue = objMeta.obj?.val || '';

          const data = {};
          // Add required t{typeId}=value for _m_save
          if (typeId) {
            data[`t${typeId}`] = objValue;
          }
          for (const [reqId, reqValue] of Object.entries(args.requisites)) {
            // Format date values to datetime-local format
            const formatted = formatRequisiteValue(reqValue, reqId);
            data[`t${reqId}`] = formatted !== null && formatted !== undefined ? formatted : '';
          }
          // Use _m_save instead of _m_set - _m_set doesn't handle datetime correctly
          // Issue #6451: full=1 MUST be in URL params to prevent 127 char truncation
          result = await client.post(`_m_save/${args.objectId}?full=1`, data);
        }
        break;

      case 'integram_delete_object':
        result = await client.post(`_m_del/${args.objectId}`);
        break;

      case 'integram_move_object_up':
        result = await client.post(`_m_up/${args.objectId}`);
        break;

      case 'integram_move_object_to_parent':
        result = await client.post(`_m_move/${args.objectId}`, {
          up: args.newParentId
        });
        break;

      // Query Operations
      case 'integram_get_dictionary':
        result = await client.get('dict');
        break;

      case 'integram_get_type_metadata':
        result = await client.get(`metadata/${args.typeId}`);
        break;

      case 'integram_search_objects':
        // Simplified search tool that automatically applies filter
        // Search in main field (field ID = table ID) by default
        const searchFieldId = args.searchField || args.typeId;
        const searchParams = {
          [`F_${searchFieldId}`]: args.searchValue,
          LIMIT: 100  // Higher limit for search results
        };
        result = await client.get(`object/${args.typeId}`, searchParams);
        break;

      case 'integram_get_object_list':
        // Default pagination to prevent massive responses
        const params = {
          pg: 1,           // Default to page 1
          LIMIT: 20,       // Default page size (20 objects)
          F_U: 1,          // Default filter for unique objects
          ...(args.params || {})  // Override with user-provided params
        };

        // Convert filter object to Integram API format: {"18": "dmi"} → F_18: "dmi"
        if (args.params?.filter) {
          const filterObj = args.params.filter;
          Object.entries(filterObj).forEach(([fieldId, value]) => {
            params[`F_${fieldId}`] = value;
          });
          // Remove the filter object itself as it's not valid Integram API param
          delete params.filter;
        }

        result = await client.get(`object/${args.typeId}`, params);
        break;

      case 'integram_get_all_objects':
        {
          // Integram pagination uses LIMIT and pg (page number, 1-based)
          // Format: object/{typeId}?JSON_KV=&LIMIT=25&pg=2
          // NOTE: Integram API may return overlapping records between pages,
          // so we deduplicate by object ID
          const pageSize = args.pageSize || 50;
          const maxPages = args.maxPages || 50;
          let allObjects = [];
          let allReqs = {};
          let page = 1; // Integram uses 1-based page numbering
          let hasMore = true;
          let typeInfo = null;
          const seenIds = new Set(); // Track seen object IDs for deduplication

          while (hasMore && page <= maxPages) {
            const pageResult = await client.get(`object/${args.typeId}`, {
              LIMIT: pageSize,
              pg: page
            });

            // Save type info from first page
            if (page === 1) {
              typeInfo = pageResult.type;
            }

            // Check if we got objects
            const pageObjects = pageResult.object || [];
            if (pageObjects.length === 0) {
              hasMore = false;
            } else {
              // Deduplicate objects by ID
              for (const obj of pageObjects) {
                const objId = obj.id || obj.ID;
                if (objId && !seenIds.has(objId)) {
                  seenIds.add(objId);
                  allObjects.push(obj);
                }
              }

              // Merge requisites (only for non-duplicate objects)
              if (pageResult.reqs) {
                for (const [objId, reqData] of Object.entries(pageResult.reqs)) {
                  if (seenIds.has(objId) && !allReqs[objId]) {
                    allReqs[objId] = reqData;
                  }
                }
              }

              // Check if we got less than pageSize (last page)
              if (pageObjects.length < pageSize) {
                hasMore = false;
              }
            }

            page++;
          }

          result = {
            type: typeInfo,
            totalCount: allObjects.length,
            uniqueCount: seenIds.size,
            pagesLoaded: page - 1,
            object: allObjects,
            reqs: allReqs
          };
        }
        break;

      case 'integram_get_object_count':
        {
          // Use _count parameter to get object count without fetching all data
          const countResult = await client.get(`object/${args.typeId}`, { _count: '' });
          result = {
            typeId: args.typeId,
            count: parseInt(countResult.count, 10) || 0
          };
        }
        break;

      case 'integram_get_object_edit_data':
        // Issue #6451: full=1 prevents truncation of LONG/HTML fields to 127 chars
        result = await client.get(`edit_obj/${args.objectId}`, { full: 1 });
        break;

      case 'integram_get_type_editor_data':
        result = await client.get('edit_types');
        break;

      case 'integram_execute_report':
        if (args.params?._m_confirmed) {
          result = await client.post(`report/${args.reportId}`, args.params);
        } else {
          result = await client.get(`report/${args.reportId}`, args.params || {});
        }
        break;

      case 'integram_get_reference_options':
        {
          const params = { id: args.objectId };
          if (args.restrict) {
            params.r = args.restrict;
          }
          if (args.query) {
            params.type = 'query';
            params.q = args.query;
          }
          result = await client.get(`_ref_reqs/${args.requisiteId}`, params);
        }
        break;

      // Multiselect Operations
      case 'integram_add_multiselect_item':
        // Issue #6451: full=1 MUST be in URL params to prevent 127 char truncation
        result = await client.post(`_m_set/${args.objectId}?full=1`, {
          [`t${args.requisiteId}`]: args.value
        });
        break;

      case 'integram_remove_multiselect_item':
        result = await client.post(`_m_del/${args.itemId}`);
        break;

      case 'integram_get_multiselect_items':
        {
          const editData = await client.get(`edit_obj/${args.objectId}`);
          const reqData = editData.reqs?.[args.requisiteId];

          if (!reqData || !reqData.multi) {
            result = { items: [], count: 0 };
          } else {
            // Format multiselect items as array of {id, value}
            const items = Array.isArray(reqData.multi)
              ? reqData.multi.map(item => ({
                  id: item.id || item,
                  value: item.val || item.value || item
                }))
              : [];
            result = { items, count: items.length };
          }
        }
        break;

      // File Operations
      case 'integram_get_dir_admin':
        result = await client.get('dir_admin', { path: args.path || '' });
        break;

      case 'integram_create_backup':
        result = await client.post('backup');
        break;

      // Legacy API Operations
      case 'integram_modify_requisite_attributes':
        {
          const { requisiteId, alias, setNull, multi } = args;
          const data = {};

          if (alias !== undefined && alias !== null) {
            data.alias = alias;
          }

          if (setNull) {
            data.set_null = 1;
          }

          if (multi) {
            data.multi = 1;
          }

          result = await client.post(`_d_attrs/${requisiteId}`, data);
        }
        break;

      case 'integram_create_database':
        {
          const { dbName, template = 'ru', description = '' } = args;
          const endpoint = `_new_db?JSON&db=${encodeURIComponent(dbName)}&template=${encodeURIComponent(template)}`;
          const data = {};

          if (description) {
            data.descr = description;
          }

          const createResult = await client.post(endpoint, data);
          result = {
            success: createResult.status === 'Ok',
            id: createResult.id,
            database: dbName,
            ...createResult
          };
        }
        break;

      case 'integram_get_ref_reqs':
        {
          const { requisiteId, objectId = 0, query = '', restrict, limit = 100 } = args;
          const params = {
            id: objectId,
            LIMIT: limit
          };

          if (query) {
            params.q = query;
          }

          if (restrict !== undefined && restrict !== null) {
            params.r = restrict;
          }

          result = await client.get(`_ref_reqs/${requisiteId}`, params);
        }
        break;

      case 'integram_execute_connector':
        {
          const { objectId, params = {} } = args;
          result = await client.get(`_connect/${objectId}`, params);
        }
        break;

      // High-Level Table Operations
      case 'integram_create_table_with_columns':
        {
          /*
           * ═══════════════════════════════════════════════════════════════════════════════
           * INTEGRAM TABLE ARCHITECTURE (discovered from legacy PHP code analysis):
           * ═══════════════════════════════════════════════════════════════════════════════
           *
           * All data in Integram is stored in ONE table with structure: (id, up, t, val, ord)
           *
           * - id: unique object ID
           * - up: parent object ID (0 = independent/root object, >0 = subordinate to parent)
           * - t:  type ID (what kind of object this is)
           * - val: value/name of the object
           * - ord: order/position
           *
           * TYPES (Tables):
           * - Types are objects with up=0 (independent)
           * - t points to base type (3=SHORT, 13=NUMBER, etc.) or another type
           * - Columns (requisites) are objects with up=typeId
           *
           * SUBORDINATE TABLES:
           * - To make table B subordinate to table A:
           *   1. Create table B as normal independent type (up=0)
           *   2. Add type B as REQUISITE to type A via _d_req/{typeA}?t={typeB}
           *   3. Now objects of type B can be created with up=objectIdOfTypeA
           *
           * REFERENCE COLUMNS (справочники/dropdowns):
           * - To create a dropdown column pointing to lookup table:
           *   1. Call _d_ref/{lookupTableId} - creates intermediate type with t=lookupTableId
           *   2. Call _d_req/{targetTypeId}?t={intermediateTypeId}
           *   3. Column now has 'ref' attribute and works as dropdown
           *
           * MULTISELECT:
           * - Call _d_multi/{requisiteId} to enable multiple selection
           * - Values stored as separate objects with up=parentObjectId
           * ═══════════════════════════════════════════════════════════════════════════════
           */

          // ⚠️ SMART HANDLING: Auto-detect if user is trying to create a subordinate table
          // If baseTypeId looks like a custom table ID, check if we should auto-convert to parentTableId
          const SYSTEM_BASE_TYPE_MAX = 50;
          let effectiveBaseTypeId = args.baseTypeId && args.baseTypeId !== 0 ? args.baseTypeId : 3;
          let effectiveParentTableId = args.parentTableId;

          // AUTO-FIX: If baseTypeId looks like a custom table ID, convert it to parentTableId
          if (effectiveBaseTypeId > SYSTEM_BASE_TYPE_MAX && !effectiveParentTableId) {
            console.log(`[integram_create_table_with_columns] AUTO-FIX: baseTypeId ${effectiveBaseTypeId} looks like custom table ID.`);
            console.log(`  Converting to: baseTypeId=3, parentTableId=${effectiveBaseTypeId}`);
            effectiveParentTableId = effectiveBaseTypeId;
            effectiveBaseTypeId = 3;
          }

          // HARD VALIDATION: Ensure baseTypeId is now a system type
          validateBaseTypeId(effectiveBaseTypeId, 'integram_create_table_with_columns');

          // Step 1: Create the type (never use baseTypeId=0). Default is 3 (SHORT)
          const typeResult = await client.post('_d_new', {
            val: args.tableName,
            t: effectiveBaseTypeId,
            ...(args.unique && { unique: 1 })
          });

          // Check for API error (returns array with error object)
          if (Array.isArray(typeResult) && typeResult[0]?.error) {
            throw new Error(`Failed to create table: ${typeResult[0].error}`);
          }

          // API returns 'obj' not 'id' for new type
          const typeId = typeResult.obj || typeResult.id;

          if (!typeId) {
            throw new Error(`Failed to create table: no type ID returned. Response: ${JSON.stringify(typeResult)}`);
          }

          const createdColumns = [];

          // Base types that need a new requisite type to be created first
          const BASE_TYPES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

          // Step 2: Add all requisites (columns)
          for (const column of args.columns || []) {
            let requisiteTypeToAdd = column.requisiteTypeId;

            // If it's a base type, create a new requisite type first
            if (BASE_TYPES.includes(column.requisiteTypeId)) {
              const newTypeResult = await client.post('_d_new', {
                val: column.alias || '',
                t: column.requisiteTypeId,
                unique: 0
              });
              requisiteTypeToAdd = newTypeResult.obj || newTypeResult.id;
            }

            // Add requisite to target table
            const reqResult = await client.post(`_d_req/${typeId}`, {
              t: requisiteTypeToAdd
            });

            const requisiteId = reqResult.id;

            // Set alias
            await client.post(`_d_alias/${requisiteId}`, {
              val: column.alias
            });

            // Toggle null flag if needed (default is allow null)
            if (column.allowNull === false) {
              await client.post(`_d_null/${requisiteId}`);
            }

            // Toggle multi flag if needed
            if (column.multiSelect === true) {
              await client.post(`_d_multi/${requisiteId}`);
            }

            createdColumns.push({
              requisiteId,
              requisiteTypeId: column.requisiteTypeId,
              alias: column.alias,
              allowNull: column.allowNull !== false,
              multiSelect: column.multiSelect === true
            });
          }

          // Step 3: If parentTableId provided, make this a SUBORDINATE table
          // ═══════════════════════════════════════════════════════════════════════════════
          // CRITICAL: For subordinate tables to work, the child type must be added as a
          // REQUISITE to the parent type. This allows creating objects with up=parentObjectId.
          // Without this step, creating subordinate objects will fail with access error:
          // "У вас нет доступа к реквизиту объекта"
          // ═══════════════════════════════════════════════════════════════════════════════
          let subordinateInfo = null;
          if (effectiveParentTableId) {
            // Add THIS table as requisite to PARENT table
            // This is the KEY step that makes subordinate objects possible!
            const subReqResult = await client.post(`_d_req/${effectiveParentTableId}`, {
              t: typeId  // Add our new table type as requisite to parent
            });

            const subordinateReqId = subReqResult.id;

            if (subordinateReqId) {
              // Set alias for the subordinate table column in parent
              const subordinateAlias = args.parentColumnAlias || args.tableName;
              await client.post(`_d_alias/${subordinateReqId}`, {
                val: subordinateAlias
              });

              subordinateInfo = {
                parentTableId: effectiveParentTableId,
                requisiteIdInParent: subordinateReqId,
                alias: subordinateAlias,
                note: 'Child type added as requisite to parent. Objects can now be created with parentId=parentObjectId'
              };
            }
          }

          result = {
            success: true,
            typeId,
            tableName: args.tableName,
            baseTypeId: effectiveBaseTypeId,
            columnsCreated: createdColumns.length,
            columns: createdColumns,
            ...(subordinateInfo && {
              subordinateTable: subordinateInfo,
              note: `Subordinate table created. To create child objects, use parentId parameter with parent object ID.`
            }),
            ...(effectiveParentTableId && args.baseTypeId > SYSTEM_BASE_TYPE_MAX && {
              autoFixed: true,
              autoFixNote: `baseTypeId ${args.baseTypeId} was automatically converted to parentTableId.`
            })
          };
        }
        break;

      case 'integram_delete_table_cascade':
        {
          if (!args.confirm) {
            throw new Error('Deletion not confirmed. Set confirm=true to proceed.');
          }

          // Delete the type (this cascades to all objects and requisites)
          await client.post(`_d_del/${args.typeId}`);

          result = {
            success: true,
            typeId: args.typeId,
            message: 'Table deleted successfully (cascade)'
          };
        }
        break;

      case 'integram_get_table_structure':
        {
          // Get type metadata
          const metadata = await client.get(`metadata/${args.typeId}`);

          // Get dictionary to find type name
          const dict = await client.get('dict');
          const typeInfo = dict.types?.find(t => t.id === args.typeId) || {};

          result = {
            typeId: args.typeId,
            tableName: typeInfo.name || metadata.name || 'Unknown',
            baseTypeId: metadata.base_type_id,
            unique: metadata.unique || false,
            requisites: metadata.requisites || [],
            columnCount: (metadata.requisites || []).length,
            metadata
          };
        }
        break;

      case 'integram_clone_table_structure':
        {
          // Get source table structure
          const sourceMetadata = await client.get(`metadata/${args.sourceTypeId}`);

          // Create new type (never use baseTypeId=0). Default is 3 (SHORT)
          const cloneBaseTypeId = args.baseTypeId && args.baseTypeId !== 0 ? args.baseTypeId : 3;
          // HARD VALIDATION: Reject custom table IDs as baseTypeId
          validateBaseTypeId(cloneBaseTypeId, 'integram_clone_table_structure');
          const typeResult = await client.post('_d_new', {
            val: args.newTableName,
            t: cloneBaseTypeId,
            unique: sourceMetadata.unique ? 1 : 0
          });

          const newTypeId = typeResult.id;
          const clonedColumns = [];

          // Clone all requisites
          for (const req of sourceMetadata.requisites || []) {
            // Add requisite with same type
            const reqResult = await client.post(`_d_req/${newTypeId}`, {
              t: req.requisite_type_id
            });

            const newRequisiteId = reqResult.id;

            // Set same alias
            if (req.alias) {
              await client.post(`_d_alias/${newRequisiteId}`, {
                val: req.alias
              });
            }

            // Clone null flag
            if (req.not_null) {
              await client.post(`_d_null/${newRequisiteId}`);
            }

            // Clone multi flag
            if (req.multi) {
              await client.post(`_d_multi/${newRequisiteId}`);
            }

            clonedColumns.push({
              originalRequisiteId: req.id,
              newRequisiteId,
              alias: req.alias,
              requisiteTypeId: req.requisite_type_id
            });
          }

          result = {
            success: true,
            sourceTypeId: args.sourceTypeId,
            newTypeId,
            newTableName: args.newTableName,
            columnsCloned: clonedColumns.length,
            columns: clonedColumns
          };
        }
        break;

      case 'integram_rename_table':
        {
          // Get current type info
          const metadata = await client.get(`metadata/${args.typeId}`);

          // Save type with new name
          await client.post(`_d_save/${args.typeId}`, {
            val: args.newName,
            t: metadata.base_type_id,
            ...(metadata.unique && { unique: 1 })
          });

          result = {
            success: true,
            typeId: args.typeId,
            oldName: metadata.name,
            newName: args.newName
          };
        }
        break;

      case 'integram_add_columns_to_table':
        {
          const addedColumns = [];

          // Base types that need a new requisite type to be created first
          const BASE_TYPES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

          // Add all columns
          for (const column of args.columns || []) {
            let requisiteTypeToAdd = column.requisiteTypeId;

            // If it's a base type, create a new requisite type first
            if (BASE_TYPES.includes(column.requisiteTypeId)) {
              const newTypeResult = await client.post('_d_new', {
                val: column.alias || '',
                t: column.requisiteTypeId,
                unique: 0
              });
              requisiteTypeToAdd = newTypeResult.obj || newTypeResult.id;
            }

            // Add requisite to target table
            const reqResult = await client.post(`_d_req/${args.typeId}`, {
              t: requisiteTypeToAdd
            });

            const requisiteId = reqResult.id;

            // Set alias
            await client.post(`_d_alias/${requisiteId}`, {
              val: column.alias
            });

            // Toggle null flag if needed
            if (column.allowNull === false) {
              await client.post(`_d_null/${requisiteId}`);
            }

            // Toggle multi flag if needed
            if (column.multiSelect === true) {
              await client.post(`_d_multi/${requisiteId}`);
            }

            addedColumns.push({
              requisiteId,
              requisiteTypeId: column.requisiteTypeId,
              alias: column.alias,
              allowNull: column.allowNull !== false,
              multiSelect: column.multiSelect === true
            });
          }

          result = {
            success: true,
            typeId: args.typeId,
            columnsAdded: addedColumns.length,
            columns: addedColumns
          };
        }
        break;

      // Reference/Lookup Column Operations
      case 'integram_add_reference_column':
        {
          // Verify the reference table exists and is independent (up=0, t!=id)
          const refTableMetadata = await client.get(`metadata/${args.referenceTableId}`);
          if (!refTableMetadata || !refTableMetadata.id) {
            throw new Error(`Reference table with ID ${args.referenceTableId} not found`);
          }
          if (refTableMetadata.up !== '0' && refTableMetadata.up !== 0) {
            throw new Error(`Table ${args.referenceTableId} is not an independent table (up=${refTableMetadata.up}). Reference columns can only link to independent tables.`);
          }

          // Step 1: Create or get the intermediate reference type using _d_ref endpoint
          // This creates a type with t=referenceTableId and val="" which is required
          // for the reference column to have the 'ref' attribute
          const refResult = await client.post(`_d_ref/${args.referenceTableId}`, {});

          const intermediateTypeId = refResult.obj;
          if (!intermediateTypeId) {
            throw new Error(`Failed to create intermediate reference type: no obj ID returned. Response: ${JSON.stringify(refResult)}`);
          }

          // Step 2: Add the intermediate type as a requisite to the target table
          const reqResult = await client.post(`_d_req/${args.typeId}`, {
            t: intermediateTypeId
          });

          const requisiteId = reqResult.id;
          if (!requisiteId) {
            throw new Error(`Failed to create reference column: no requisite ID returned. Response: ${JSON.stringify(reqResult)}`);
          }

          // Step 3: Set alias
          if (args.alias) {
            await client.post(`_d_alias/${requisiteId}`, {
              val: args.alias
            });
          }

          // Step 4: Toggle null flag if needed (default is allow null)
          if (args.allowNull === false) {
            await client.post(`_d_null/${requisiteId}`);
          }

          // Step 5: Toggle multi-select flag if needed
          if (args.multiSelect === true) {
            await client.post(`_d_multi/${requisiteId}`);
          }

          // Verify the column was created correctly by getting updated metadata
          const updatedMetadata = await client.get(`metadata/${args.typeId}`);
          const createdReq = updatedMetadata.reqs?.find(r => r.id === String(requisiteId));

          result = {
            success: true,
            typeId: args.typeId,
            referenceTableId: args.referenceTableId,
            referenceTableName: refTableMetadata.val,
            intermediateTypeId,
            requisiteId,
            alias: args.alias,
            multiSelect: args.multiSelect === true,
            allowNull: args.allowNull !== false,
            hasRefAttribute: createdReq?.ref ? true : false,
            createdRequisite: createdReq || null
          };
        }
        break;

      case 'integram_create_lookup_table':
        {
          // Create the lookup table with unique=true by default (never use baseTypeId=0). Default is 3 (SHORT)
          const lookupBaseTypeId = args.baseTypeId && args.baseTypeId !== 0 ? args.baseTypeId : 3;
          // HARD VALIDATION: Reject custom table IDs as baseTypeId
          validateBaseTypeId(lookupBaseTypeId, 'integram_create_lookup_table');
          const typeResult = await client.post('_d_new', {
            val: args.tableName,
            t: lookupBaseTypeId,
            unique: args.unique !== false ? 1 : 0
          });

          // Check for API error (returns array with error object)
          if (Array.isArray(typeResult) && typeResult[0]?.error) {
            throw new Error(`Failed to create lookup table: ${typeResult[0].error}`);
          }

          // API returns 'obj' not 'id' for new type
          const lookupTableId = typeResult.obj || typeResult.id;

          if (!lookupTableId) {
            throw new Error(`Failed to create lookup table: no type ID returned. Response: ${JSON.stringify(typeResult)}`);
          }
          const createdValues = [];

          // Add initial values if provided
          if (args.values && Array.isArray(args.values)) {
            for (const value of args.values) {
              const objResult = await client.post(`_m_new/${lookupTableId}`, {
                [`t${lookupTableId}`]: value,
                up: 1 // Independent object
              });
              createdValues.push({
                id: objResult.id,
                value
              });
            }
          }

          result = {
            success: true,
            lookupTableId,
            tableName: args.tableName,
            unique: args.unique !== false,
            valuesCreated: createdValues.length,
            values: createdValues
          };
        }
        break;

      case 'integram_create_lookup_with_reference':
        {
          // Step 1: Create the lookup table (never use baseTypeId=0). Default is 3 (SHORT)
          const lookupRefBaseTypeId = args.baseTypeId && args.baseTypeId !== 0 ? args.baseTypeId : 3;
          // HARD VALIDATION: Reject custom table IDs as baseTypeId
          validateBaseTypeId(lookupRefBaseTypeId, 'integram_create_lookup_with_reference');
          const typeResult = await client.post('_d_new', {
            val: args.lookupTableName,
            t: lookupRefBaseTypeId,
            unique: 1 // Lookup tables should have unique values
          });

          // Check for API error (returns array with error object)
          if (Array.isArray(typeResult) && typeResult[0]?.error) {
            throw new Error(`Failed to create lookup table: ${typeResult[0].error}`);
          }

          // API returns 'obj' not 'id' for new type
          const lookupTableId = typeResult.obj || typeResult.id;

          if (!lookupTableId) {
            throw new Error(`Failed to create lookup table: no type ID returned. Response: ${JSON.stringify(typeResult)}`);
          }

          const createdValues = [];

          // Step 2: Add initial values if provided
          if (args.values && Array.isArray(args.values)) {
            for (const value of args.values) {
              const objResult = await client.post(`_m_new/${lookupTableId}`, {
                [`t${lookupTableId}`]: value,
                up: 1
              });
              createdValues.push({
                id: objResult.obj || objResult.id,
                value
              });
            }
          }

          // Step 3: Create intermediate reference type
          // This is required for proper 'ref' attribute on the requisite
          const refTypeResult = await client.post('_d_new', {
            val: '', // Empty name - hidden reference type
            t: lookupTableId, // Base type is the lookup table
            unique: 0
          });

          // Check for API error
          if (Array.isArray(refTypeResult) && refTypeResult[0]?.error) {
            throw new Error(`Failed to create intermediate type: ${refTypeResult[0].error}`);
          }

          // API returns 'obj' not 'id' for new type
          const intermediateTypeId = refTypeResult.obj || refTypeResult.id;

          if (!intermediateTypeId) {
            throw new Error(`Failed to create intermediate type: no type ID returned. Response: ${JSON.stringify(refTypeResult)}`);
          }

          // Step 4: Add the intermediate type as a requisite to the target table
          const columnAlias = args.columnAlias || args.lookupTableName;

          const reqResult = await client.post(`_d_req/${args.targetTableId}`, {
            t: intermediateTypeId // Use intermediate type, not the lookup table directly
          });

          const requisiteId = reqResult.id;

          // Step 5: CRITICAL - Set the 'ref' attribute using _d_save
          // This is what makes the column a proper reference/dropdown (справочник)
          await client.post(`_d_save/${requisiteId}`, {
            val: columnAlias || '',
            t: intermediateTypeId,
            ref: lookupTableId  // This sets the 'ref' attribute to point to the lookup table!
          });

          // Set alias (may be redundant but ensures alias is set correctly)
          await client.post(`_d_alias/${requisiteId}`, {
            val: columnAlias
          });

          // Toggle multi-select flag if needed
          if (args.multiSelect === true) {
            await client.post(`_d_multi/${requisiteId}`);
          }

          // Verify the column was created correctly
          const updatedMetadata = await client.get(`metadata/${args.targetTableId}`);
          const createdReq = updatedMetadata.reqs?.find(r => r.id === String(requisiteId));

          result = {
            success: true,
            lookupTable: {
              id: lookupTableId,
              name: args.lookupTableName,
              valuesCreated: createdValues.length,
              values: createdValues
            },
            referenceColumn: {
              requisiteId,
              intermediateTypeId, // The hidden reference type
              alias: columnAlias,
              multiSelect: args.multiSelect === true,
              hasRefAttribute: createdReq?.ref ? true : false,
              createdRequisite: createdReq || null
            },
            targetTableId: args.targetTableId
          };
        }
        break;

      // ==================== Report/Query Operations ====================
      case 'integram_create_report':
        {
          // Constants for report structure
          const REPORT_TYPE_ID = 22;     // Запрос
          const COLUMN_TYPE_ID = 28;     // Колонки запроса
          const FROM_TYPE_ID = 44;       // FROM

          // Step 1: Create the report (Запрос)
          const reportResult = await client.post(`_m_new/${REPORT_TYPE_ID}`, {
            [`t${REPORT_TYPE_ID}`]: args.name,
            up: 1 // Independent object
          });

          const reportId = reportResult.id || reportResult.obj;
          if (!reportId) {
            throw new Error(`Failed to create report: ${JSON.stringify(reportResult)}`);
          }

          // Step 2: Set report requisites (WHERE, HAVING, ORDER BY, LIMIT, EXECUTE)
          const reportReqs = {};
          if (args.where) reportReqs['t262'] = args.where;
          if (args.having) reportReqs['t263'] = args.having;
          if (args.orderBy) reportReqs['t264'] = args.orderBy;
          if (args.limit) reportReqs['t134'] = args.limit;
          if (args.execute) reportReqs['t228'] = '1';

          if (Object.keys(reportReqs).length > 0) {
            await client.post(`_m_set/${reportId}`, reportReqs);
          }

          // Step 3: Add FROM tables
          const createdFromTables = [];
          if (args.fromTables && Array.isArray(args.fromTables)) {
            for (const fromEntry of args.fromTables) {
              const fromResult = await client.post(`_m_new/${FROM_TYPE_ID}`, {
                [`t${FROM_TYPE_ID}`]: String(fromEntry.tableId),
                up: reportId
              });
              const fromId = fromResult.id || fromResult.obj;

              // Set FROM requisites (ALIAS, JOIN ON)
              const fromReqs = {};
              if (fromEntry.alias) fromReqs['t265'] = fromEntry.alias;
              if (fromEntry.joinOn) fromReqs['t266'] = fromEntry.joinOn;

              if (Object.keys(fromReqs).length > 0 && fromId) {
                await client.post(`_m_set/${fromId}`, fromReqs);
              }

              createdFromTables.push({
                id: fromId,
                tableId: fromEntry.tableId,
                alias: fromEntry.alias,
                joinOn: fromEntry.joinOn
              });
            }
          }

          // Step 4: Add columns
          const createdColumns = [];
          if (args.columns && Array.isArray(args.columns)) {
            for (const col of args.columns) {
              const colResult = await client.post(`_m_new/${COLUMN_TYPE_ID}`, {
                [`t${COLUMN_TYPE_ID}`]: String(col.fieldId || 0),
                up: reportId
              });
              const colId = colResult.id || colResult.obj;

              // Set column requisites
              const colReqs = {};
              if (col.nameInReport) colReqs['t100'] = col.nameInReport;
              if (col.formula) colReqs['t101'] = col.formula;
              if (col.functionId) colReqs['t104'] = String(col.functionId);
              if (col.set) colReqs['t132'] = col.set;
              if (col.hide) colReqs['t107'] = '1';
              if (col.alias) colReqs['t58'] = col.alias;
              if (col.format) colReqs['t84'] = String(col.format);
              if (col.sort !== undefined) colReqs['t109'] = String(col.sort);
              if (col.total) colReqs['t72'] = String(col.total);

              if (Object.keys(colReqs).length > 0 && colId) {
                await client.post(`_m_set/${colId}`, colReqs);
              }

              createdColumns.push({
                id: colId,
                fieldId: col.fieldId,
                nameInReport: col.nameInReport,
                formula: col.formula
              });
            }
          }

          result = {
            success: true,
            reportId,
            name: args.name,
            fromTablesCreated: createdFromTables.length,
            fromTables: createdFromTables,
            columnsCreated: createdColumns.length,
            columns: createdColumns
          };
        }
        break;

      case 'integram_add_report_column':
        {
          const COLUMN_TYPE_ID = 28;

          // Create column as subordinate object of report
          const colResult = await client.post(`_m_new/${COLUMN_TYPE_ID}`, {
            [`t${COLUMN_TYPE_ID}`]: String(args.fieldId),
            up: args.reportId
          });

          const colId = colResult.id || colResult.obj;
          if (!colId) {
            throw new Error(`Failed to create column: ${JSON.stringify(colResult)}`);
          }

          // Set column requisites
          const colReqs = {};
          if (args.nameInReport) colReqs['t100'] = args.nameInReport;
          if (args.formula) colReqs['t101'] = args.formula;
          if (args.functionId) colReqs['t104'] = String(args.functionId);
          if (args.set) colReqs['t132'] = args.set;
          if (args.hide) colReqs['t107'] = '1';
          if (args.alias) colReqs['t58'] = args.alias;
          if (args.format) colReqs['t84'] = String(args.format);
          if (args.sort !== undefined) colReqs['t109'] = String(args.sort);
          if (args.total) colReqs['t72'] = String(args.total);

          if (Object.keys(colReqs).length > 0) {
            await client.post(`_m_set/${colId}`, colReqs);
          }

          result = {
            success: true,
            columnId: colId,
            reportId: args.reportId,
            fieldId: args.fieldId,
            nameInReport: args.nameInReport,
            formula: args.formula,
            functionId: args.functionId,
            set: args.set
          };
        }
        break;

      case 'integram_add_report_from':
        {
          const FROM_TYPE_ID = 44;

          // Create FROM entry as subordinate object of report
          const fromResult = await client.post(`_m_new/${FROM_TYPE_ID}`, {
            [`t${FROM_TYPE_ID}`]: String(args.tableId),
            up: args.reportId
          });

          const fromId = fromResult.id || fromResult.obj;
          if (!fromId) {
            throw new Error(`Failed to create FROM entry: ${JSON.stringify(fromResult)}`);
          }

          // Set FROM requisites
          const fromReqs = {};
          if (args.alias) fromReqs['t265'] = args.alias;
          if (args.joinOn) fromReqs['t266'] = args.joinOn;

          if (Object.keys(fromReqs).length > 0) {
            await client.post(`_m_set/${fromId}`, fromReqs);
          }

          result = {
            success: true,
            fromId,
            reportId: args.reportId,
            tableId: args.tableId,
            alias: args.alias,
            joinOn: args.joinOn
          };
        }
        break;

      case 'integram_get_report_structure':
        {
          // Get report edit data
          const reportData = await client.get(`edit_obj/${args.reportId}`);

          // Get ALL subordinate columns via F_U filter with pagination (type 28 = columns)
          const columns = [];
          try {
            let page = 1;
            let hasMoreData = true;
            const PAGE_SIZE = 100; // Fetch more items per page
            const seenColumnIds = new Set(); // Deduplicate columns

            while (hasMoreData) {
              // Use correct pagination params: LIMIT and pg passed as query params
              const columnsData = await client.get(`object/28`, {
                F_U: args.reportId,
                LIMIT: PAGE_SIZE,
                pg: page
              });
              if (columnsData && columnsData.object && Array.isArray(columnsData.object) && columnsData.object.length > 0) {
                let newColumnsCount = 0;
                for (const col of columnsData.object) {
                  // Deduplicate by ID
                  if (seenColumnIds.has(col.id)) continue;
                  seenColumnIds.add(col.id);
                  newColumnsCount++;

                  const colReqs = columnsData.reqs?.[col.id] || {};
                  columns.push({
                    id: col.id,
                    fieldId: col.val,
                    fieldName: col.ref_val || col['val:val'],
                    nameInReport: colReqs['100'],
                    formula: colReqs['101'],
                    functionId: colReqs['104'],
                    set: colReqs['132'],
                    hide: colReqs['107'],
                    alias: colReqs['58'],
                    format: colReqs['84'],
                    sort: colReqs['109'],
                    total: colReqs['72']
                  });
                }
                // Check if we got new columns (not all duplicates) and full page
                if (newColumnsCount === 0 || columnsData.object.length < PAGE_SIZE) {
                  hasMoreData = false;
                } else {
                  page++;
                }
              } else {
                hasMoreData = false;
              }
            }
          } catch (e) {
            // Fallback: columns count from reqs
            if (reportData.reqs?.['99']?.arr) {
              result = { note: `Report has ${reportData.reqs['99'].arr} columns but couldn't fetch details` };
            }
          }

          // Get subordinate FROM tables via F_U filter (type 44 = FROM)
          const fromTables = [];
          try {
            const fromData = await client.get(`object/44`, { F_U: args.reportId });
            if (fromData && fromData.object && Array.isArray(fromData.object)) {
              for (const fromEntry of fromData.object) {
                const fromReqs = fromData.reqs?.[fromEntry.id] || {};
                fromTables.push({
                  id: fromEntry.id,
                  tableId: fromEntry.val,
                  tableName: fromEntry.ref_val || fromEntry['val:val'],
                  alias: fromReqs['265'],
                  joinOn: fromReqs['266']
                });
              }
            }
          } catch (e) {
            // Ignore - FROM might be empty
          }

          result = {
            reportId: args.reportId,
            name: reportData.obj?.val,
            where: reportData.reqs?.['262']?.value || reportData.reqs?.['262']?.val,
            having: reportData.reqs?.['263']?.value || reportData.reqs?.['263']?.val,
            orderBy: reportData.reqs?.['264']?.value || reportData.reqs?.['264']?.val,
            limit: reportData.reqs?.['134']?.value || reportData.reqs?.['134']?.val,
            execute: reportData.reqs?.['228']?.value === 'X' || reportData.reqs?.['228']?.val === '1',
            fromTablesCount: fromTables.length,
            fromTables,
            columnsCount: columns.length,
            columns
          };
        }
        break;

      case 'integram_clone_report':
        {
          const REPORT_TYPE_ID = 22;
          const COLUMN_TYPE_ID = 28;
          const FROM_TYPE_ID = 44;

          // Step 1: Get source report basic data
          const sourceData = await client.get(`edit_obj/${args.sourceReportId}`);

          if (!sourceData.obj) {
            throw new Error(`Source report ${args.sourceReportId} not found`);
          }

          // Step 2: Get ALL columns via F_U filter with pagination (type 28 = columns)
          let sourceColumns = [];
          let repColList = []; // Save rep_col_list from first request for later use
          try {
            let page = 1;
            let hasMoreData = true;
            const PAGE_SIZE = 100; // Fetch more items per page
            const seenColumnIds = new Set(); // Deduplicate columns

            while (hasMoreData) {
              // Use correct pagination params: LIMIT and pg passed as query params
              const columnsData = await client.get(`object/28`, {
                F_U: args.sourceReportId,
                LIMIT: PAGE_SIZE,
                pg: page
              });

              // Save rep_col_list from first page (it's the same for all pages)
              if (page === 1 && columnsData?.rep_col_list && Array.isArray(columnsData.rep_col_list)) {
                repColList = columnsData.rep_col_list;
              }

              if (columnsData?.object && Array.isArray(columnsData.object) && columnsData.object.length > 0) {
                let newColumnsCount = 0;
                for (const col of columnsData.object) {
                  // Deduplicate by ID
                  if (seenColumnIds.has(col.id)) continue;
                  seenColumnIds.add(col.id);
                  newColumnsCount++;

                  const colReqs = columnsData.reqs?.[col.id] || {};
                  sourceColumns.push({
                    id: col.id,
                    val: col.val,
                    ref: col.ref, // CRITICAL: Field ID from rep_col_list (links column to data source)
                    reqs: colReqs
                  });
                }
                // Check if we got new columns (not all duplicates) and full page
                if (newColumnsCount === 0 || columnsData.object.length < PAGE_SIZE) {
                  hasMoreData = false;
                } else {
                  page++;
                }
              } else {
                hasMoreData = false;
              }
            }
          } catch (e) {
            // Columns fetch failed
          }

          // Step 3: Get FROM tables via F_U filter (type 44 = FROM)
          let sourceFromTables = [];
          try {
            const fromData = await client.get(`object/44`, { F_U: args.sourceReportId });
            if (fromData?.object && Array.isArray(fromData.object)) {
              for (const fromEntry of fromData.object) {
                const fromReqs = fromData.reqs?.[fromEntry.id] || {};
                sourceFromTables.push({
                  id: fromEntry.id,
                  val: fromEntry.val,
                  reqs: fromReqs
                });
              }
            }
          } catch (e) {
            // FROM fetch failed
          }

          // Step 3b: If no explicit FROM tables, extract tables from rep_col_list (saved from Step 2)
          // This is CRITICAL for reports that don't have explicit FROM entries but have columns
          // The rep_col_list is dynamically filtered based on existing columns
          let tablesFromRepColList = [];
          if (sourceFromTables.length === 0 && repColList.length > 0) {
            // Extract unique table IDs from rep_col_list (already fetched in Step 2)
            const tableIds = new Set();
            for (const field of repColList) {
              if (field.table && field.table !== '0' && field.id !== '0') {
                tableIds.add(String(field.table));
              }
            }
            tablesFromRepColList = Array.from(tableIds);
          }

          // Step 4: Create new report
          const newReportResult = await client.post(`_m_new/${REPORT_TYPE_ID}`, {
            [`t${REPORT_TYPE_ID}`]: args.newName,
            up: 1
          });

          const newReportId = newReportResult.id || newReportResult.obj;
          if (!newReportId) {
            throw new Error(`Failed to create new report: ${JSON.stringify(newReportResult)}`);
          }

          // Step 5: Copy report requisites (WHERE, HAVING, ORDER BY, LIMIT, EXECUTE)
          const reportReqs = {};
          if (sourceData.reqs?.['262']?.value) reportReqs['t262'] = sourceData.reqs['262'].value;
          if (sourceData.reqs?.['263']?.value) reportReqs['t263'] = sourceData.reqs['263'].value;
          if (sourceData.reqs?.['264']?.value) reportReqs['t264'] = sourceData.reqs['264'].value;
          if (sourceData.reqs?.['134']?.value) reportReqs['t134'] = sourceData.reqs['134'].value;
          // Copy EXECUTE from source or set explicitly
          if (sourceData.reqs?.['228']?.value === 'X' || sourceData.reqs?.['228']?.value === '1' || args.setExecute) {
            reportReqs['t228'] = '1';
          }

          if (Object.keys(reportReqs).length > 0) {
            await client.post(`_m_set/${newReportId}`, reportReqs);
          }

          // Step 6: Clone FROM tables (explicit ones OR inferred from rep_col_list)
          const clonedFromTables = [];

          // First, clone explicit FROM tables if any
          for (const fromEntry of sourceFromTables) {
            const fromResult = await client.post(`_m_new/${FROM_TYPE_ID}`, {
              [`t${FROM_TYPE_ID}`]: String(fromEntry.val),
              up: newReportId
            });

            const fromId = fromResult.id || fromResult.obj;
            if (fromId) {
              const fromReqs = {};
              if (fromEntry.reqs['265']) fromReqs['t265'] = fromEntry.reqs['265'];
              if (fromEntry.reqs['266']) fromReqs['t266'] = fromEntry.reqs['266'];

              if (Object.keys(fromReqs).length > 0) {
                await client.post(`_m_set/${fromId}`, fromReqs);
              }

              clonedFromTables.push({
                sourceId: fromEntry.id,
                newId: fromId,
                tableId: fromEntry.val,
                source: 'explicit'
              });
            }
          }

          // If no explicit FROM tables, add tables inferred from rep_col_list
          // This ensures the new report has the correct context for column field references
          if (sourceFromTables.length === 0 && tablesFromRepColList.length > 0) {
            for (const tableId of tablesFromRepColList) {
              const fromResult = await client.post(`_m_new/${FROM_TYPE_ID}`, {
                [`t${FROM_TYPE_ID}`]: tableId,
                up: newReportId
              });

              const fromId = fromResult.id || fromResult.obj;
              if (fromId) {
                clonedFromTables.push({
                  sourceId: null,
                  newId: fromId,
                  tableId: tableId,
                  source: 'rep_col_list'
                });
              }
            }
          }

          // Step 7: Clone columns
          // CRITICAL: Use col.ref (field ID from rep_col_list), NOT col.val (display name)
          // The ref field is what links the column to the actual data source
          // For calculated columns ("Вычисляемое"), ref is 0 or undefined
          const clonedColumns = [];
          for (const col of sourceColumns) {
            const fieldRef = col.ref || '0'; // 0 for calculated columns
            const colResult = await client.post(`_m_new/${COLUMN_TYPE_ID}`, {
              [`t${COLUMN_TYPE_ID}`]: fieldRef, // Use field ID (ref), not display name (val)
              up: newReportId
            });

            const colId = colResult.id || colResult.obj;
            if (colId) {
              const colReqs = {};
              if (col.reqs['100']) colReqs['t100'] = col.reqs['100'];
              if (col.reqs['101']) colReqs['t101'] = col.reqs['101'];
              // For reference requisite 104 (functionId), use ref_104 which contains "typeId:objectId" format
              // Need to extract object ID from "63:85" format -> "85"
              if (col.reqs['ref_104']) {
                const refParts = col.reqs['ref_104'].split(':');
                if (refParts.length === 2) {
                  colReqs['t104'] = refParts[1]; // Use the object ID (e.g., "85" for abn_ID)
                }
              } else if (col.reqs['104']) {
                colReqs['t104'] = col.reqs['104'];
              }
              if (col.reqs['132']) colReqs['t132'] = col.reqs['132'];
              if (col.reqs['107']) colReqs['t107'] = col.reqs['107'];
              if (col.reqs['58']) colReqs['t58'] = col.reqs['58'];
              // For reference requisite 84 (Format), use ref_84 if available
              if (col.reqs['ref_84']) {
                const refParts = col.reqs['ref_84'].split(':');
                if (refParts.length === 2) {
                  colReqs['t84'] = refParts[1];
                }
              } else if (col.reqs['84']) {
                colReqs['t84'] = col.reqs['84'];
              }
              if (col.reqs['109']) colReqs['t109'] = col.reqs['109'];
              // For reference requisite 72 (Итог), use ref_72 if available
              if (col.reqs['ref_72']) {
                const refParts = col.reqs['ref_72'].split(':');
                if (refParts.length === 2) {
                  colReqs['t72'] = refParts[1];
                }
              } else if (col.reqs['72']) {
                colReqs['t72'] = col.reqs['72'];
              }

              if (Object.keys(colReqs).length > 0) {
                await client.post(`_m_set/${colId}`, colReqs);
              }

              clonedColumns.push({
                sourceId: col.id,
                newId: colId,
                fieldRef: fieldRef, // Field ID used (from col.ref)
                displayName: col.val, // Original display name
                nameInReport: col.reqs['100'],
                formula: col.reqs['101']
              });
            }
          }

          result = {
            success: true,
            sourceReportId: args.sourceReportId,
            newReportId,
            newName: args.newName,
            fromTablesCloned: clonedFromTables.length,
            fromTables: clonedFromTables,
            tablesInferredFromRepColList: tablesFromRepColList.length,
            columnsCloned: clonedColumns.length,
            columns: clonedColumns
          };
        }
        break;

      // === HIGH-LEVEL BATCH TOOLS ===
      case 'integram_create_objects_batch':
        {
          const createdObjects = [];
          const errors = [];

          for (let i = 0; i < args.objects.length; i++) {
            const obj = args.objects[i];
            try {
              // Build request data
              const data = {
                [`t${args.typeId}`]: obj.value,
                up: args.parentId || 1
              };

              // Add requisites with date formatting
              if (obj.requisites) {
                for (const [reqId, reqValue] of Object.entries(obj.requisites)) {
                  data[`t${reqId}`] = formatRequisiteValue(reqValue, reqId);
                }
              }

              // Create object
              // Issue #6451: full=1 MUST be in URL params to prevent 127 char truncation
              const createResult = await client.post(`_m_new/${args.typeId}?full=1`, data);
              const newId = createResult.id || createResult.obj;

              if (newId) {
                // Apply requisites via _m_set for reliable reference field handling
                if (obj.requisites && Object.keys(obj.requisites).length > 0) {
                  const setData = {};
                  for (const [reqId, reqValue] of Object.entries(obj.requisites)) {
                    if (reqValue !== null && reqValue !== undefined) {
                      setData[`t${reqId}`] = formatRequisiteValue(reqValue, reqId);
                    }
                  }
                  if (Object.keys(setData).length > 0) {
                    // Issue #6451: full=1 MUST be in URL params to prevent 127 char truncation
                    await client.post(`_m_set/${newId}?full=1`, setData);
                  }
                }

                createdObjects.push({
                  index: i,
                  id: newId,
                  value: obj.value
                });
              } else {
                errors.push({
                  index: i,
                  value: obj.value,
                  error: 'No ID returned from API'
                });
              }
            } catch (err) {
              errors.push({
                index: i,
                value: obj.value,
                error: err.message
              });
            }
          }

          result = {
            success: errors.length === 0,
            typeId: args.typeId,
            parentId: args.parentId || null,
            totalRequested: args.objects.length,
            created: createdObjects.length,
            failed: errors.length,
            objects: createdObjects,
            errors: errors.length > 0 ? errors : undefined
          };
        }
        break;

      case 'integram_create_parent_with_children':
        {
          // Step 1: Create parent object
          const parentData = {
            [`t${args.parentTypeId}`]: args.parentValue,
            up: 1
          };

          if (args.parentRequisites) {
            for (const [reqId, reqValue] of Object.entries(args.parentRequisites)) {
              parentData[`t${reqId}`] = formatRequisiteValue(reqValue, reqId);
            }
          }

          // Issue #6451: full=1 MUST be in URL params to prevent 127 char truncation
          const parentResult = await client.post(`_m_new/${args.parentTypeId}?full=1`, parentData);
          const parentId = parentResult.id || parentResult.obj;

          if (!parentId) {
            throw new Error('Failed to create parent object: no ID returned');
          }

          // Apply parent requisites via _m_set
          if (args.parentRequisites && Object.keys(args.parentRequisites).length > 0) {
            const setData = {};
            for (const [reqId, reqValue] of Object.entries(args.parentRequisites)) {
              if (reqValue !== null && reqValue !== undefined) {
                setData[`t${reqId}`] = formatRequisiteValue(reqValue, reqId);
              }
            }
            if (Object.keys(setData).length > 0) {
              // Issue #6451: full=1 MUST be in URL params to prevent 127 char truncation
              await client.post(`_m_set/${parentId}?full=1`, setData);
            }
          }

          // Step 2: Create child objects
          const createdChildren = [];
          const childErrors = [];

          for (let i = 0; i < args.children.length; i++) {
            const child = args.children[i];
            try {
              const childData = {
                [`t${args.childTypeId}`]: child.value,
                up: parentId  // Link to parent
              };

              if (child.requisites) {
                for (const [reqId, reqValue] of Object.entries(child.requisites)) {
                  childData[`t${reqId}`] = formatRequisiteValue(reqValue, reqId);
                }
              }

              // Issue #6451: full=1 MUST be in URL params to prevent 127 char truncation
              const childResult = await client.post(`_m_new/${args.childTypeId}?full=1`, childData);
              const childId = childResult.id || childResult.obj;

              if (childId) {
                // Apply requisites via _m_set
                if (child.requisites && Object.keys(child.requisites).length > 0) {
                  const setData = {};
                  for (const [reqId, reqValue] of Object.entries(child.requisites)) {
                    if (reqValue !== null && reqValue !== undefined) {
                      setData[`t${reqId}`] = formatRequisiteValue(reqValue, reqId);
                    }
                  }
                  if (Object.keys(setData).length > 0) {
                    // Issue #6451: full=1 MUST be in URL params to prevent 127 char truncation
                    await client.post(`_m_set/${childId}?full=1`, setData);
                  }
                }

                createdChildren.push({
                  index: i,
                  id: childId,
                  value: child.value
                });
              } else {
                childErrors.push({
                  index: i,
                  value: child.value,
                  error: 'No ID returned from API'
                });
              }
            } catch (err) {
              childErrors.push({
                index: i,
                value: child.value,
                error: err.message
              });
            }
          }

          result = {
            success: childErrors.length === 0,
            parent: {
              typeId: args.parentTypeId,
              id: parentId,
              value: args.parentValue
            },
            children: {
              typeId: args.childTypeId,
              totalRequested: args.children.length,
              created: createdChildren.length,
              failed: childErrors.length,
              objects: createdChildren,
              errors: childErrors.length > 0 ? childErrors : undefined
            }
          };
        }
        break;

      // === SMART QUERY TOOLS (LLM-Optimized) ===
      case 'integram_get_schema':
        {
          // System tables to exclude by default
          const SYSTEM_TABLES = new Set([18, 22, 28, 42, 44, 47, 63, 65, 137, 1141, 2974]);

          // Get dictionary
          const dict = await client.get('dict');
          const tables = [];

          // Type ID to name mapping for references
          const typeIdMap = {};
          if (dict && typeof dict === 'object') {
            for (const [id, name] of Object.entries(dict)) {
              typeIdMap[id] = name;
            }
          }

          // Requisite type mapping
          const REQ_TYPES = {
            '2': 'LONG', '3': 'SHORT', '4': 'DATETIME', '5': 'DATE',
            '6': 'TIME', '7': 'BOOL', '8': 'CHARS', '13': 'NUMBER', '14': 'FILE'
          };

          // Process each table
          for (const [typeId, typeName] of Object.entries(dict || {})) {
            const numId = parseInt(typeId);

            // Skip system tables unless requested
            if (!args.includeSystemTables && SYSTEM_TABLES.has(numId)) continue;

            // Apply filter if provided
            if (args.filter) {
              const filterLower = args.filter.toLowerCase();
              if (!typeName.toLowerCase().includes(filterLower)) continue;
            }

            // Get table metadata (use metadata endpoint, not dict)
            try {
              const metadata = await client.get(`metadata/${typeId}`);
              const fields = [];

              if (metadata?.reqs && Array.isArray(metadata.reqs)) {
                for (const req of metadata.reqs) {
                  const field = {
                    id: parseInt(req.id),
                    name: req.attrs?.match(/:ALIAS=([^:]+):/)?.[1] || req.val || `field_${req.id}`
                  };

                  // Determine field type
                  if (req.ref) {
                    field.type = 'REF';
                    field.ref = parseInt(req.ref);
                    field.refName = typeIdMap[req.ref] || `type_${req.ref}`;
                  } else {
                    field.type = REQ_TYPES[req.type] || 'SHORT';
                  }

                  fields.push(field);
                }
              }

              tables.push({
                id: numId,
                name: typeName,
                fields
              });
            } catch (e) {
              // Skip tables we can't get metadata for
            }
          }

          // Sort by name for easier reading
          tables.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

          result = {
            tablesCount: tables.length,
            tables,
            usage: 'Use table.id and field.id in integram_smart_query. For REF fields, ref shows target table ID.'
          };
        }
        break;

      case 'integram_smart_query':
        {
          const REPORT_TYPE_ID = 22;
          const FROM_TYPE_ID = 44;
          const COLUMN_TYPE_ID = 28;

          // Generate unique report name
          const reportName = args.reportName || `SmartQuery_${Date.now()}`;

          // Support both 'tables' array and 'fromTable' string for convenience
          let tables = args.tables;
          if (!tables && args.fromTable) {
            // Convert fromTable (table name or ID) to tables array
            let tableId = args.fromTable;

            // If fromTable is a string (name), find its ID in dictionary
            if (typeof args.fromTable === 'string' && isNaN(args.fromTable)) {
              const dictData = await client.get('dict');
              // Dict returns {id: name} format, e.g., {"806": "Мой Дрон"}
              let foundId = null;
              for (const [id, name] of Object.entries(dictData)) {
                if (name === args.fromTable) {
                  foundId = id;
                  break;
                }
              }
              if (foundId) {
                tableId = foundId;
              } else {
                throw new Error(`Table not found: ${args.fromTable}`);
              }
            }
            tables = [{ id: Number(tableId) }];
          }

          if (!tables || tables.length === 0) {
            throw new Error('No tables specified. Use "tables" array or "fromTable" parameter.');
          }

          // Step 1: Create report
          const reportResult = await client.post(`_m_new/${REPORT_TYPE_ID}`, {
            [`t${REPORT_TYPE_ID}`]: reportName,
            up: 1
          });

          const reportId = reportResult.id || reportResult.obj;
          if (!reportId) {
            throw new Error('Failed to create report');
          }

          try {
            // Step 2: Add FROM tables
            const tableAliases = {};
            for (let i = 0; i < tables.length; i++) {
              const table = tables[i];
              const alias = table.alias || `t${i + 1}`;
              tableAliases[table.id] = alias;

              const fromData = {
                [`t${FROM_TYPE_ID}`]: table.id,
                up: reportId
              };

              const fromResult = await client.post(`_m_new/${FROM_TYPE_ID}`, fromData);
              const fromId = fromResult.id || fromResult.obj;

              if (fromId) {
                // Set alias and join condition
                const fromReqs = {};
                if (table.alias) fromReqs['t265'] = table.alias;
                if (table.joinOn) fromReqs['t266'] = table.joinOn;
                if (Object.keys(fromReqs).length > 0) {
                  await client.post(`_m_set/${fromId}`, fromReqs);
                }
              }
            }

            // Step 3: Add columns
            // Field value = ID from rep_col_list (or 0 for computed columns)
            for (const col of args.columns) {
              // Use field ID directly (from rep_col_list), or 0 for computed
              const fieldValue = String(col.field);

              const colData = {
                [`t${COLUMN_TYPE_ID}`]: fieldValue,
                up: reportId
              };

              const colResult = await client.post(`_m_new/${COLUMN_TYPE_ID}`, colData);
              const colId = colResult.id || colResult.obj;

              if (colId) {
                const colReqs = {};
                if (col.name || col.alias) colReqs['t100'] = col.name || col.alias;  // Name in report
                if (col.formula) colReqs['t101'] = col.formula;  // Formula
                if (col.valueFrom !== undefined) colReqs['t102'] = String(col.valueFrom); // Значение (от) - filter
                if (col.valueTo !== undefined) colReqs['t103'] = String(col.valueTo);     // Значение (до) - filter
                if (col.sort === 'ASC') colReqs['t109'] = '1';
                if (col.sort === 'DESC') colReqs['t109'] = '2';
                if (col.hide) colReqs['t107'] = '1';
                if (col.groupBy) colReqs['t132'] = '1';          // SET (GROUP BY)

                // Total/aggregate function (requisite 72)
                // Values: 67=SUM, 68=AVG, 69=MIN, 70=MAX, 71=COUNT
                if (col.total) {
                  const totalMap = {
                    'SUM': '67', 'AVG': '68', 'MIN': '69', 'MAX': '70', 'COUNT': '71'
                  };
                  const totalId = totalMap[col.total.toUpperCase()] || col.total;
                  colReqs['t72'] = totalId;
                }

                // Function (requisite 104) - transforms column values
                // Reference to type 63: 73=SUM, 74=COUNT, 75=MAX, 76=MIN, 77=AVG, 140=ROUND, 141=MONTH, 142=YEAR, 235=GROUP_CONCAT
                if (col.function) {
                  const funcMap = {
                    'SUM': '73', 'COUNT': '74', 'MAX': '75', 'MIN': '76', 'AVG': '77',
                    'ROUND': '140', 'MONTH': '141', 'YEAR': '142', 'GROUP_CONCAT': '235',
                    'abn_ID': '85', 'abn_UP': '86', 'abn_TYP': '87', 'abn_REQ': '88',
                    'abn_DATE2STR': '89', 'abn_NUM2STR': '90', 'abn_URL': '91',
                    'abn_ROWNUM': '92', 'abn_ORD': '93', 'abn_BT': '98'
                  };
                  const funcId = funcMap[col.function.toUpperCase()] || funcMap[col.function] || col.function;
                  colReqs['t104'] = funcId;
                }
                // Function parameters (requisites 105, 106)
                if (col.functionFrom !== undefined) colReqs['t105'] = String(col.functionFrom);
                if (col.functionTo !== undefined) colReqs['t106'] = String(col.functionTo);

                if (Object.keys(colReqs).length > 0) {
                  await client.post(`_m_set/${colId}`, colReqs);
                }
              }
            }

            // Step 4: Set report clauses
            const reportReqs = {};
            if (args.where) reportReqs['t262'] = args.where;
            if (args.having) reportReqs['t263'] = args.having;
            if (args.orderBy) reportReqs['t264'] = args.orderBy;
            if (args.limit) reportReqs['t134'] = String(args.limit);
            reportReqs['t228'] = '1'; // Set EXECUTE flag

            await client.post(`_m_set/${reportId}`, reportReqs);

            // Step 5: Execute report
            const reportData = await client.get(`report/${reportId}`, {
              LIMIT: args.limit || 100
            });

            // Parse results - report can return different formats:
            // 1. Array of objects directly (most common)
            // 2. Object with response.headers and response.rows
            let data = [];
            let headers = [];

            if (Array.isArray(reportData)) {
              // Format 1: Direct array of objects
              data = reportData;
              if (data.length > 0) {
                headers = Object.keys(data[0]);
              }
            } else if (reportData?.response?.headers) {
              // Format 2: Structured response
              headers = reportData.response.headers || [];
              const rows = reportData.response.rows || [];
              data = rows.map(row => {
                const obj = {};
                const values = row.values || [];
                for (let i = 0; i < headers.length; i++) {
                  obj[headers[i]] = values[i] || null;
                }
                return obj;
              });
            }

            result = {
              success: true,
              reportId,
              reportName,
              rowsCount: data.length,
              headers,
              data
            };

          } catch (execError) {
            // Clean up on error - delete the report
            try {
              await client.post(`_m_del/${reportId}`);
            } catch (e) { /* ignore cleanup errors */ }

            throw execError;
          }

          // Optionally delete report after execution (to avoid clutter)
          // Uncomment if you want auto-cleanup:
          // try { await client.post(`_m_del/${reportId}`); } catch (e) {}
        }
        break;

      case 'integram_natural_query':
        {
          // This is a simplified implementation
          // In production, you would call an LLM to parse the question

          // Step 1: Get schema for context
          const SYSTEM_TABLES = new Set([18, 22, 28, 42, 44, 47, 63, 65, 137, 1141, 2974]);
          const dict = await client.get('dict');
          const availableTables = [];

          for (const [typeId, typeName] of Object.entries(dict || {})) {
            const numId = parseInt(typeId);
            if (SYSTEM_TABLES.has(numId)) continue;

            try {
              const metadata = await client.get(`metadata/${typeId}`);
              const fields = [];

              if (metadata?.reqs && Array.isArray(metadata.reqs)) {
                for (const req of metadata.reqs) {
                  fields.push({
                    id: parseInt(req.id),
                    name: req.attrs?.match(/:ALIAS=([^:]+):/)?.[1] || req.val
                  });
                }
              }

              availableTables.push({
                id: numId,
                name: typeName,
                fields
              });
            } catch (e) { /* skip */ }
          }

          // Step 2: Find matching table
          const question = args.question.toLowerCase();
          let targetTable = args.targetTable ? availableTables.find(t => t.id === args.targetTable) : null;

          if (!targetTable) {
            // Simple keyword matching
            const keywords = {
              'клиент': 'CRM Клиенты',
              'сделк': 'CRM Сделки',
              'задач': 'CRM Задачи',
              'контакт': 'CRM Контакты',
              'организаци': 'Организация',
              'пользовател': 'User',
              'агент': 'Агент'
            };

            for (const [keyword, tableName] of Object.entries(keywords)) {
              if (question.includes(keyword)) {
                targetTable = availableTables.find(t => t.name === tableName);
                if (targetTable) break;
              }
            }
          }

          if (!targetTable) {
            result = {
              success: false,
              error: 'Не удалось определить таблицу для запроса',
              hint: 'Укажите targetTable или используйте ключевые слова: клиент, сделка, задача, контакт, организация',
              availableTables: availableTables.map(t => ({ id: t.id, name: t.name }))
            };
            break;
          }

          // Step 3: Build simple query (all fields, no filter)
          // A real implementation would parse the question for filters
          const columns = [
            { field: targetTable.id, name: targetTable.name }  // Main value
          ];

          // Add first 5 fields
          for (const field of targetTable.fields.slice(0, 5)) {
            columns.push({ field: field.id, name: field.name });
          }

          // Step 4: Execute via smart_query logic
          const REPORT_TYPE_ID = 22;
          const FROM_TYPE_ID = 44;
          const COLUMN_TYPE_ID = 28;
          const reportName = `NaturalQuery_${Date.now()}`;

          const reportResult = await client.post(`_m_new/${REPORT_TYPE_ID}`, {
            [`t${REPORT_TYPE_ID}`]: reportName,
            up: 1
          });

          const reportId = reportResult.id || reportResult.obj;
          if (!reportId) throw new Error('Failed to create report');

          try {
            // Add FROM
            await client.post(`_m_new/${FROM_TYPE_ID}`, {
              [`t${FROM_TYPE_ID}`]: targetTable.id,
              up: reportId
            });

            // Add columns
            for (const col of columns) {
              const colResult = await client.post(`_m_new/${COLUMN_TYPE_ID}`, {
                [`t${COLUMN_TYPE_ID}`]: col.field,
                up: reportId
              });
              const colId = colResult.id || colResult.obj;
              if (colId && col.name) {
                await client.post(`_m_set/${colId}`, { 't100': col.name });
              }
            }

            // Set EXECUTE and LIMIT
            await client.post(`_m_set/${reportId}`, {
              't228': '1',
              't134': String(args.limit || 50)
            });

            // Execute
            const reportData = await client.get(`report/${reportId}`, {
              LIMIT: args.limit || 50
            });

            // Parse results - support both array and structured formats
            let data = [];
            let headers = [];

            if (Array.isArray(reportData)) {
              data = reportData;
              if (data.length > 0) {
                headers = Object.keys(data[0]);
              }
            } else if (reportData?.response?.headers) {
              headers = reportData.response.headers || [];
              const rows = reportData.response.rows || [];
              data = rows.map(row => {
                const obj = {};
                const values = row.values || [];
                for (let i = 0; i < headers.length; i++) {
                  obj[headers[i]] = values[i] || null;
                }
                return obj;
              });
            }

            result = {
              success: true,
              question: args.question,
              interpretedAs: `SELECT из таблицы "${targetTable.name}"`,
              reportId,
              rowsCount: data.length,
              headers,
              data
            };

          } catch (execError) {
            try { await client.post(`_m_del/${reportId}`); } catch (e) {}
            throw execError;
          }
        }
        break;

      // Additional Operations (from Vue clients)
      case 'integram_set_object_order':
        result = await client.post(`_m_set/${args.objectId}`, {
          ord: args.order
        });
        break;

      case 'integram_set_object_id':
        result = await client.post(`_m_set/${args.objectId}`, {
          id: args.newId
        });
        break;

      case 'integram_set_requisite_order':
        result = await client.post(`_d_set/${args.requisiteId}`, {
          ord: args.order
        });
        break;

      case 'integram_get_all_types_metadata':
        result = await client.get('metadata');
        break;

      case 'integram_get_object_meta':
        result = await client.get(`meta/${args.objectId}`);
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: error.message,
            tool: name,
            arguments: args
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

/**
 * Start the server
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Integram MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
