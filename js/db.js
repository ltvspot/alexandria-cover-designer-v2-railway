// db.js — In-memory storage for Alexandria Cover Designer v2
// Settings persist to server via CGI-bin endpoint so API keys survive page refreshes

const _stores = {
  books: {},
  jobs: {},
  winners: {},
  prompts: {},
  settings: {},
  cost_ledger: {},
  batches: {},
};

// --- Server-side persistence for settings ---
// Uses CGI-bin endpoint so settings survive page refreshes
const CGI_SETTINGS_URL = '/cgi-bin/settings.py';

// Debounced save — batches rapid setSetting calls into one request
let _saveTimer = null;
function _persistSettings() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try {
      // Convert internal store format { key: { key, value } } → flat { key: value }
      const flat = {};
      for (const [k, row] of Object.entries(_stores.settings)) {
        flat[k] = row.value;
      }
      await fetch(CGI_SETTINGS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(flat),
      });
    } catch (e) {
      console.warn('[db] Failed to persist settings to server:', e.message);
    }
  }, 300);
}

// Load persisted settings from server on startup
let _serverSettingsLoaded = false;
async function _loadServerSettings() {
  try {
    const resp = await fetch(CGI_SETTINGS_URL);
    if (resp.ok) {
      const flat = await resp.json();
      if (flat && typeof flat === 'object' && Object.keys(flat).length > 0) {
        // Convert flat { key: value } → internal format { key: { key, value } }
        for (const [k, v] of Object.entries(flat)) {
          _stores.settings[k] = { key: k, value: v };
        }
        _serverSettingsLoaded = true;
        return true;
      }
    }
  } catch (e) {
    console.warn('[db] Could not load settings from server:', e.message);
  }
  return false;
}

const _counters = {};

// Store configs — which field is the keyPath, and which auto-increment
const STORE_CONFIG = {
  books:       { keyPath: 'id', autoIncrement: false },
  jobs:        { keyPath: 'id', autoIncrement: false },
  winners:     { keyPath: 'book_id', autoIncrement: false },
  prompts:     { keyPath: 'id', autoIncrement: true },
  settings:    { keyPath: 'key', autoIncrement: false },
  cost_ledger: { keyPath: 'id', autoIncrement: true },
  batches:     { keyPath: 'id', autoIncrement: false },
};

function _nextId(storeName) {
  _counters[storeName] = (_counters[storeName] || 0) + 1;
  return _counters[storeName];
}

// Generic CRUD — same interface as the IndexedDB version
async function dbPut(storeName, item) {
  const config = STORE_CONFIG[storeName] || { keyPath: 'id', autoIncrement: false };
  if (!_stores[storeName]) _stores[storeName] = {};

  // Handle auto-increment
  if (config.autoIncrement && (item[config.keyPath] === undefined || item[config.keyPath] === null)) {
    item[config.keyPath] = _nextId(storeName);
  }

  const key = String(item[config.keyPath]);
  _stores[storeName][key] = item;
  return item[config.keyPath];
}

async function dbGet(storeName, key) {
  if (!_stores[storeName]) return undefined;
  return _stores[storeName][String(key)] || undefined;
}

async function dbGetAll(storeName) {
  if (!_stores[storeName]) return [];
  return Object.values(_stores[storeName]);
}

async function dbDelete(storeName, key) {
  if (_stores[storeName]) {
    delete _stores[storeName][String(key)];
  }
}

async function dbClear(storeName) {
  _stores[storeName] = {};
}

async function dbGetByIndex(storeName, indexName, value) {
  const all = Object.values(_stores[storeName] || {});
  return all.filter(item => item[indexName] === value);
}

async function dbCount(storeName) {
  return Object.keys(_stores[storeName] || {}).length;
}

// Settings helpers
async function getSetting(key, defaultValue = null) {
  const row = await dbGet('settings', key);
  return row ? row.value : defaultValue;
}

async function setSetting(key, value) {
  const result = await dbPut('settings', { key, value });
  _persistSettings();  // save to server after every settings change
  return result;
}

// Initialize default settings
// Only fills in missing keys — never overwrites user-changed values
async function initDefaults() {
  // First, try to load persisted settings from the server
  if (!_serverSettingsLoaded) {
    await _loadServerSettings();
  }

  const defaults = {
    google_api_key: 'AIzaSyAY6XvPxrdS_fMNMZEUkJd7UW9b9yuJDgI',
    drive_source_folder: '1ybFYDJk7Y3VlbsEjRAh1LOfdyVsHM_cS',
    drive_output_folder: '1Vr184ZsX3k38xpmZkd8g2vwB5y9LYMRC',
    drive_winner_folder: '1vOGdGjryzErrzB0kT3qmu3PJrRLOoqBg',
    budget_limit: 50,
    default_variant_count: 1,
    quality_threshold: 0.6,
    medallion_cx: 2850,
    medallion_cy: 1350,
    medallion_radius: 520,
  };
  let needsPersist = false;
  for (const [k, v] of Object.entries(defaults)) {
    const existing = await getSetting(k);
    if (existing === null || existing === undefined) {
      await dbPut('settings', { key: k, value: v });
      needsPersist = true;
    }
  }
  if (needsPersist) {
    _persistSettings();  // persist any newly-added defaults
  }
}

// No-op for compatibility
async function openDB() {
  return true;
}

// Export globally
window.DB = {
  openDB, dbPut, dbGet, dbGetAll, dbDelete, dbClear, dbGetByIndex, dbCount,
  getSetting, setSetting, initDefaults
};
