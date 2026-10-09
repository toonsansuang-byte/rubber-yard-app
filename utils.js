/**
 * ========================================================
 * 🛠️ UTILITIES & SECURITY LAYER (js/utils.js)
 * Community Rubber Plantation System (ลานยางพาราชุมชน)
 * ========================================================
 */

// Secret Salt for Password Hashing (App-Level Pepper)
const APP_SECRET_SALT = 'RUBBER_YARD_SECURE_SALT_v1_2026';

// Rubber Types Mapping
const RUBBER_TYPES_MAP = {
  sheet: 'ยางแผ่น',
  cup: 'ยางก้อนถ้วย',
  latex: 'น้ำยางสด'
};

// ========================================================
// 1. UI FEEDBACK HELPERS
// ========================================================

/**
 * แสดง Overlay โหลดข้อมูล
 */
function showLoading() {
  const el = document.getElementById('loading-overlay');
  if (el) el.classList.add('show');
}

/**
 * ซ่อน Overlay โหลดข้อมูล
 */
function hideLoading() {
  const el = document.getElementById('loading-overlay');
  if (el) el.classList.remove('show');
}

/**
 * แสดงข้อความแจ้งเตือน Toast Notification
 * @param {string} message - ข้อความที่ต้องการแสดง
 * @param {'success'|'error'|'info'|'warning'} type - ประเภทของข้อความ
 */
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

// ========================================================
// 2. STRING & FORMATTING HELPERS
// ========================================================

/**
 * ป้องกัน XSS Injection โดยแปลงอักขระพิเศษเป็น HTML Entity
 */
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * จัดรูปแบบตัวเลข ทศนิยม 2 ตำแหน่ง พร้อมใส่ลูกน้ำจุลภาค
 * @param {number|string} num 
 * @returns {string} เช่น "1,234.50"
 */
function formatNumber(num) {
  return Number(num || 0).toLocaleString('th-TH', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  });
}

/**
 * จัดรูปแบบวันที่เป็นภาษาไทย (เช่น 27 ก.ย. 2569)
 */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * จัดรูปแบบเวลา (เช่น 14:30)
 */
function formatTime(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

/**
 * จัดรูปแบบวันและเวลาต่อกัน (เช่น 27 ก.ย. 2569 14:30)
 */
function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  return formatDate(dateStr) + ' ' + formatTime(dateStr);
}

/**
 * สร้าง HTML Badge สำหรับประเภทยาง
 */
function getRubberTypeBadge(type) {
  const classes = { sheet: 'badge-green', cup: 'badge-gold', latex: 'badge-blue' };
  const label = RUBBER_TYPES_MAP[type] || type || 'ยางก้อนถ้วย';
  return `<span class="badge ${classes[type] || 'badge-green'}">${label}</span>`;
}

/**
 * จัดการแปลงรหัสสมาชิกให้เป็นตัวเลข 3 หลักเสมอ (เช่น '1' -> '001', 'ก00052' -> '052')
 */
function normalizeMemberCodeStr(codeRaw) {
  if (!codeRaw) return '';
  let str = String(codeRaw).trim();
  const digits = str.replace(/\D/g, '');
  if (digits) {
    return digits.padStart(3, '0');
  }
  return str;
}

// ========================================================
// 3. SECURITY & PROGRESSIVE PASSWORD HASHING
// ========================================================

/**
 * แฮชรหัสผ่านแบบเดิม (SHA-256 ไม่มี Salt) เพื่อตรวจสอบข้อมูลประวัติเดิม
 * @param {string} text - รหัสผ่านตัวเปล่า
 * @returns {Promise<string>} Hex string ของ SHA-256
 */
async function hashPasswordLegacy(text) {
  if (!text) return '';
  const msgUint8 = new TextEncoder().encode(String(text));
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * แฮชรหัสผ่านเวอร์ชันใหม่แบบใช้ Salt (App Secret + Unique Identifier)
 * ป้องกัน Rainbow Table Attack และการชนกันของรหัสผ่าน
 * @param {string} text - รหัสผ่าน
 * @param {string} identifier - ค่าเอกลักษณ์คงที่ เช่น username หรือ member code (ห้ามใช้เบอร์โทร)
 * @returns {Promise<string>} Salted SHA-256 Hex String
 */
async function hashPassword(text, identifier = '') {
  if (!text) return '';
  const normalizedId = String(identifier || '').trim().toLowerCase();
  const saltedPayload = `${APP_SECRET_SALT}::${normalizedId}::${String(text)}`;
  
  const msgUint8 = new TextEncoder().encode(saltedPayload);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * ตรวจสอบรหัสผ่านแบบ Progressive Migration (Backward Compatibility)
 * ตรวจทั้งแบบ Salted และ Legacy หากตรงกับแบบเดิม จะแจ้งเตือนให้แอปอัปเดต Hash ลง DB อัตโนมัติ
 * 
 * @param {string} inputPassword - รหัสผ่านที่ผู้ใช้พิมพ์เข้ามา
 * @param {string} storedHash - ค่าที่เก็บอยู่ใน Database
 * @param {string} identifier - username หรือ member code
 * @returns {Promise<{ isValid: boolean, needsRehash: boolean, newHash: string|null }>}
 */
async function verifyPassword(inputPassword, storedHash, identifier = '') {
  if (!inputPassword || !storedHash) {
    return { isValid: false, needsRehash: false, newHash: null };
  }

  const rawInput = String(inputPassword).trim();
  const currentHash = String(storedHash).trim();
  const normalizedId = String(identifier || '').trim().toLowerCase();

  // 1. ตรวจสอบแบบ Salted Hash เวอร์ชันใหม่ก่อน (Priority 1)
  const calculatedSaltedHash = await hashPassword(rawInput, normalizedId);
  if (calculatedSaltedHash === currentHash) {
    return { isValid: true, needsRehash: false, newHash: null };
  }

  // 2. ตรวจสอบแบบ Legacy Hash เดิม (SHA-256 เพียวๆ)
  const calculatedLegacyHash = await hashPasswordLegacy(rawInput);
  if (calculatedLegacyHash === currentHash) {
    return { 
      isValid: true, 
      needsRehash: true, 
      newHash: calculatedSaltedHash // ส่งค่า Salted Hash ใหม่กลับไปเพื่อบันทึกลง DB
    };
  }

  // 3. ตรวจสอบแบบ Plaintext (สำหรับผู้ใช้เริ่มต้นที่ยังไม่เคยผ่านการแฮช เช่น password == code)
  if (rawInput === currentHash) {
    return { 
      isValid: true, 
      needsRehash: true, 
      newHash: calculatedSaltedHash 
    };
  }

  // ไม่ผ่านทุกเงื่อนไข
  return { isValid: false, needsRehash: false, newHash: null };
}

// ========================================================
// GLOBAL EXPORT (สำหรับ Vanilla JS และ HTML onclick)
// ========================================================
window.APP_SECRET_SALT = APP_SECRET_SALT;
window.RUBBER_TYPES_MAP = RUBBER_TYPES_MAP;
window.showLoading = showLoading;
window.hideLoading = hideLoading;
window.showToast = showToast;
window.escapeHTML = escapeHTML;
window.formatNumber = formatNumber;
window.formatDate = formatDate;
window.formatTime = formatTime;
window.formatDateTime = formatDateTime;
window.getRubberTypeBadge = getRubberTypeBadge;
window.normalizeMemberCodeStr = normalizeMemberCodeStr;
window.hashPasswordLegacy = hashPasswordLegacy;
window.hashPassword = hashPassword;
window.verifyPassword = verifyPassword;
