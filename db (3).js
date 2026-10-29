/**
 * ========================================================
 * 🗄️ DATABASE ACCESS LAYER (js/db.js)
 * Unified Storage Engine (Desktop SQLite + Cloud Supabase)
 * ========================================================
 */

// ========== SUPABASE CLOUD CONFIG ==========
var SUPABASE_URL = window.SUPABASE_URL || 'https://llukvrfabdnvlbimvepb.supabase.co';
var SUPABASE_KEY = window.SUPABASE_KEY || 'sb_publishable_TfYRzo9Gj85z7KByoPEZnA_RJvJCtw7';
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_KEY = SUPABASE_KEY;

// Global Supabase Client Instance
var sb = window.sb || null;

/**
 * กำหนดค่าและสร้าง Supabase Client
 */
function initSupabaseClient() {
  if (typeof window.supabase !== 'undefined' && !sb) {
    try {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false }
      });
      window.sb = sb;
    } catch (err) {
      console.warn('Failed to init Supabase client in db.js:', err);
    }
  }
  return sb;
}

// ========================================================
// 1. ENVIRONMENT & STATUS HELPERS
// ========================================================

/**
 * ตรวจสอบว่ากำลังทำงานอยู่บนโปรแกรม Desktop (Electron + SQLite) หรือไม่
 * @returns {boolean}
 */
function isDesktopApp() {
  return Boolean(window.desktopDB && window.desktopDB.isDesktop);
}

/**
 * ตรวจสอบว่าระบบอยู่ในสถานะออฟไลน์ (ไม่มีเน็ต) หรือไม่
 * @returns {boolean}
 */
function isAppOffline() {
  return !navigator.onLine;
}

// ========================================================
// 2. UNIFIED CRUD WRAPPERS (Data Access Layer)
// ========================================================

/**
 * ดึงข้อมูลจากฐานข้อมูลแบบรวมศูนย์ (Unified Query)
 * @param {string} table - ชื่อตาราง (เช่น 'members', 'purchase_rounds', 'seasons')
 * @param {Object} options - ตัวเลือกการค้นหา { select, filters, orderBy, ascending, limit }
 * @returns {Promise<{ data: Array|null, error: Error|null }>}
 */
async function dbQuery(table, options = {}) {
  const selectCols = options.select || '*';
  const filters = options.filters || {};
  const orderBy = options.orderBy || 'id';
  const ascending = options.ascending !== false;
  const limit = options.limit || null;

  try {
    // 1. กรณีเป็น Desktop SQLite
    if (isDesktopApp()) {
      let sql = `SELECT ${selectCols} FROM ${table}`;
      const whereClauses = [];
      const params = [];

      for (const [key, val] of Object.entries(filters)) {
        whereClauses.push(`${key} = ?`);
        params.push(val);
      }

      if (whereClauses.length > 0) {
        sql += ` WHERE ${whereClauses.join(' AND ')}`;
      }

      sql += ` ORDER BY ${orderBy} ${ascending ? 'ASC' : 'DESC'}`;
      if (limit) sql += ` LIMIT ${limit}`;

      const list = await window.desktopDB.query(sql, params);
      return { data: list || [], error: null };
    }

    // 2. กรณีเป็น Web App / Supabase
    if (sb && !isAppOffline()) {
      let query = sb.from(table).select(selectCols);

      for (const [key, val] of Object.entries(filters)) {
        query = query.eq(key, val);
      }

      query = query.order(orderBy, { ascending });
      if (limit) query = query.limit(limit);

      const { data, error } = await query;
      return { data: data || [], error: error || null };
    }

    // ออฟไลน์บนเบราว์เซอร์
    return { data: [], error: new Error('ออฟไลน์และไม่พบฐานข้อมูลท้องถิ่น') };
  } catch (err) {
    console.error(`dbQuery error on table ${table}:`, err);
    return { data: null, error: err };
  }
}

/**
 * บันทึกข้อมูลใหม่ลงฐานข้อมูลแบบรวมศูนย์ (Unified Insert)
 * จัดการบันทึกทั้ง SQLite (ถ้าเป็น Desktop) และ Supabase (ถ้าออนไลน์) อัตโนมัติ
 * 
 * @param {string} table - ชื่อตาราง
 * @param {Object} payload - ข้อมูลที่ต้องการบันทึก
 * @returns {Promise<{ data: Object|null, error: Error|null }>}
 */
async function dbInsert(table, payload) {
  try {
    let insertedLocal = null;
    let insertedCloud = null;

    // 1. บันทึกลง Desktop SQLite
    if (isDesktopApp()) {
      insertedLocal = await window.desktopDB.insert(table, payload);
    }

    // 2. บันทึกขึ้น Cloud Supabase (ถ้าออนไลน์)
    if (sb && !isAppOffline()) {
      try {
        const { data, error } = await sb.from(table).insert(payload).select().single();
        if (error) throw error;
        insertedCloud = data;

        // ถ้าบันทึกทั้งสองฝั่ง และมี supabase_id ให้ผูกเชื่อมกันใน SQLite
        if (insertedLocal && insertedLocal.id && insertedCloud && insertedCloud.id) {
          try {
            await window.desktopDB.update(table, { supabase_id: String(insertedCloud.id) }, { id: insertedLocal.id });
          } catch (e) {}
        }
      } catch (cloudErr) {
        console.warn(`Cloud sync insert failed for ${table}:`, cloudErr);
        if (!insertedLocal) throw cloudErr;
      }
    }

    return { 
      data: insertedCloud || insertedLocal || payload, 
      error: null 
    };
  } catch (err) {
    console.error(`dbInsert error on table ${table}:`, err);
    return { data: null, error: err };
  }
}

/**
 * อัปเดตข้อมูลในฐานข้อมูลแบบรวมศูนย์ (Unified Update)
 * @param {string} table - ชื่อตาราง
 * @param {Object} payload - ข้อมูลที่ต้องการอัปเดต
 * @param {Object} matchFilters - เงื่อนไข WHERE เช่น { id: 1 } หรือ { code: '001' }
 * @returns {Promise<{ data: Object|null, error: Error|null }>}
 */
async function dbUpdate(table, payload, matchFilters = {}) {
  try {
    // 1. อัปเดตบน Desktop SQLite
    if (isDesktopApp()) {
      await window.desktopDB.update(table, payload, matchFilters);
    }

    // 2. อัปเดตบน Cloud Supabase
    if (sb && !isAppOffline()) {
      let query = sb.from(table).update(payload);
      for (const [key, val] of Object.entries(matchFilters)) {
        query = query.eq(key, val);
      }
      const { data, error } = await query.select();
      if (error) console.warn(`Cloud update warning on ${table}:`, error);
    }

    return { data: payload, error: null };
  } catch (err) {
    console.error(`dbUpdate error on table ${table}:`, err);
    return { data: null, error: err };
  }
}

// ========================================================
// GLOBAL EXPORT
// ========================================================
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_KEY = SUPABASE_KEY;
window.sb = sb;
window.initSupabaseClient = initSupabaseClient;
window.isDesktopApp = isDesktopApp;
window.isAppOffline = isAppOffline;
window.dbQuery = dbQuery;
window.dbInsert = dbInsert;
window.dbUpdate = dbUpdate;

// Auto-initialize Supabase client immediately when script loads
if (typeof window !== 'undefined') {
  initSupabaseClient();
}
