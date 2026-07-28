/* ============================================
   COMMUNITY RUBBER PLANTATION WEB APP
   Application Logic — Supabase + Multi-Trip + Multi-User + Rounds
   ============================================ */

// ========== SUPABASE CONFIG ==========
const SUPABASE_URL = 'https://llukvrfabdnvlbimvepb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_TfYRzo9Gj85z7KByoPEZnA_RJvJCtw7';

let sb; // Supabase client — initialized in init()

// ========== GLOBAL STATE ==========
let currentSection = 'dashboard';
let currentUser = null;    // { id, username, display_name, role }
let currentRound = null;   // Active open round object or null
let selectedMember = null;
let trips = [];            // [{grossWeight: 0}]
let cachedSettings = null; // Cached settings from Supabase

const RUBBER_TYPES = {
  sheet: 'ยางแผ่นดิบ',
  cup: 'ยางก้อนถ้วย',
  latex: 'น้ำยางสด'
};

// ========== LOADING ==========
function showLoading() {
  document.getElementById('loading-overlay').classList.add('show');
}
function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('show');
}

// ========== TOAST NOTIFICATIONS ==========
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || '✅'}</span> ${message}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

// ========== AUTH & USER SESSION ==========
function checkAuth() {
  const isLogged = sessionStorage.getItem('rb_session') === 'logged_in';
  const storedUser = sessionStorage.getItem('rb_user');
  if (isLogged && storedUser) {
    try {
      currentUser = JSON.parse(storedUser);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

// ========== PASSWORD HASHING (WEB CRYPTO SHA-256) ==========
async function hashPassword(text) {
  if (!text) return '';
  const msgUint8 = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Toggle password visibility (Show/Hide) with SVG icons
function togglePasswordVisibility() {
  const pwdInput = document.getElementById('login-password');
  const openEye = document.getElementById('eye-icon-open');
  const closedEye = document.getElementById('eye-icon-closed');
  if (!pwdInput) return;
  if (pwdInput.type === 'password') {
    pwdInput.type = 'text';
    if (openEye) openEye.style.display = 'none';
    if (closedEye) closedEye.style.display = 'block';
  } else {
    pwdInput.type = 'password';
    if (openEye) openEye.style.display = 'block';
    if (closedEye) closedEye.style.display = 'none';
  }
}
window.togglePasswordVisibility = togglePasswordVisibility;

async function handleLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');

  if (!username || !password) {
    errorEl.textContent = 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน';
    errorEl.classList.add('show');
    return;
  }

  showLoading();
  try {
    let loggedUser = null;
    const hashedInput = await hashPassword(password);

    // 1. Query app_users table (matches hashed password or migrates legacy plain text)
    try {
      const { data: users, error } = await sb.from('app_users')
        .select('*')
        .eq('username', username);

      if (!error && users && users.length > 0) {
        const user = users.find(u => u.password === hashedInput || u.password === password);
        if (user) {
          loggedUser = user;
          // Auto upgrade legacy plain text password to SHA-256 hash in Supabase
          if (user.password === password) {
            await sb.from('app_users').update({ password: hashedInput }).eq('id', user.id);
          }
        }
      }
    } catch (e) {
      console.warn('app_users table check skipped or not created yet:', e);
    }

    // 2. Fallback: Check settings table if app_users query didn't find user or table missing
    if (!loggedUser) {
      const { data: setArr } = await sb.from('settings').select('admin_username, admin_password').eq('id', 1);
      const setData = setArr && setArr[0];
      if (setData && username === setData.admin_username && (password === setData.admin_password || hashedInput === setData.admin_password)) {
        // Try to insert admin into app_users with hashed password
        try {
          const { data: newUser } = await sb.from('app_users').insert({
            username: setData.admin_username,
            password: hashedInput,
            display_name: 'ผู้ดูแลระบบ',
            role: 'admin'
          }).select().maybeSingle();
          if (newUser) loggedUser = newUser;
        } catch { /* ignore */ }

        if (!loggedUser) {
          loggedUser = {
            id: 'admin-fallback',
            username: setData.admin_username,
            display_name: 'ผู้ดูแลระบบ',
            role: 'admin'
          };
        }
      }
    }

    if (loggedUser) {
      currentUser = {
        id: loggedUser.id,
        username: loggedUser.username,
        display_name: loggedUser.display_name,
        role: loggedUser.role
      };
      sessionStorage.setItem('rb_session', 'logged_in');
      sessionStorage.setItem('rb_user', JSON.stringify(currentUser));
      errorEl.classList.remove('show');
      await showApp();
      showToast(`ยินดีต้อนรับ คุณ${currentUser.display_name}!`);
    } else {
      errorEl.textContent = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
      errorEl.classList.add('show');
    }
  } catch (err) {
    errorEl.textContent = 'เกิดข้อผิดพลาดในการเชื่อมต่อ: ' + (err.message || err);
    errorEl.classList.add('show');
  }
  hideLoading();
}

function handleLogout() {
  sessionStorage.removeItem('rb_session');
  sessionStorage.removeItem('rb_user');
  currentUser = null;
  document.getElementById('app').classList.remove('active');
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').classList.remove('show');
}

async function showApp() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app').classList.add('active');
  updateUserSidebarUI();
  await loadSettings();
  await loadCurrentRound();
  initRealtimeSubscriptions();
  navigateTo('dashboard');
}

// ========== REALTIME SUBSCRIPTIONS & AUTO RECONNECT ==========
let realtimeChannel = null;

function initRealtimeSubscriptions() {
  if (!sb || realtimeChannel) return;

  const badgeEl = document.getElementById('realtime-status-badge');

  realtimeChannel = sb.channel('dashboard-realtime-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'transactions' },
      async (payload) => {
        console.log('Realtime transaction change detected:', payload);
        if (payload.eventType === 'INSERT') {
          const t = payload.new;
          const weightStr = formatNumber(t.final_weight || t.net_weight);
          const amountStr = formatNumber(t.total_price);
          showToast(`⚡ มีรายการใหม่! รหัส ${t.member_code} (${t.member_name}) — ${weightStr} กก. [${amountStr} ฿]`, 'info');
        } else if (payload.eventType === 'DELETE') {
          showToast('ℹ️ มีการลบรายการรับซื้อในระบบ', 'info');
        }

        // Live update dashboard metrics silently without screen flicker
        if (currentSection === 'dashboard') {
          await renderDashboard(false, payload.eventType === 'INSERT' ? payload.new : null);
        }
        if (currentSection === 'history') {
          filterHistory();
        }
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'members' },
      () => {
        if (currentSection === 'dashboard') renderDashboard(false);
        if (currentSection === 'members') renderMembers();
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'purchase_rounds' },
      async () => {
        await loadCurrentRound();
        if (currentSection === 'dashboard') renderDashboard(false);
        if (currentSection === 'rounds') renderRounds();
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'pending_transactions' },
      (payload) => {
        renderPendingTransactions();
        if (payload.eventType === 'INSERT') {
          showToast(`📥 มีรายการส่งมาให้ตรวจสอบใหม่จาก ${payload.new.created_by_display_name || 'เครื่อง 1'}! (${payload.new.member_code} - ${payload.new.member_name})`, 'info');
        } else if (payload.eventType === 'UPDATE' && payload.new.status === 'rejected') {
          showToast(`⚠️ รายการของ ${payload.new.member_name} ถูกตีกลับ: ${payload.new.rejection_note || 'กรุณาตรวจสอบข้อมูล'}`, 'warning');
        }
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'settings' },
      async (payload) => {
        console.log('Realtime settings change detected:', payload);
        await loadSettings();
        updatePurchaseDualModeUI();
        renderSettings();
        if (payload.eventType === 'UPDATE') {
          showToast('⚡ มีการอัปเดตตั้งค่าลานยาง/ชื่อผู้ประมูลจากเครื่องอื่นแล้ว!', 'info');
        }
      }
    )
    .subscribe((status) => {
      if (badgeEl) {
        if (status === 'SUBSCRIBED') {
          badgeEl.className = 'realtime-status-badge';
          badgeEl.innerHTML = `<span class="live-dot"></span> <span class="live-text">Realtime เชื่อมต่อแล้ว</span>`;
          badgeEl.title = 'ระบบเชื่อมต่อ Realtime เรียบร้อยแล้ว ข้อมูลจะอัปเดตอัตโนมัติ';
        } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          badgeEl.className = 'realtime-status-badge connecting';
          badgeEl.innerHTML = `<span class="live-dot yellow"></span> <span class="live-text">Realtime กำลังเชื่อมต่อใหม่...</span>`;
          badgeEl.title = 'กำลังพยายามเชื่อมต่อระบบ Realtime ใหม่อีกครั้ง';
        }
      }
    });

  window.removeEventListener('online', handleNetworkReconnect);
  window.removeEventListener('offline', handleNetworkOffline);
  window.addEventListener('online', handleNetworkReconnect);
  window.addEventListener('offline', handleNetworkOffline);
}

function handleNetworkOffline() {
  const badgeEl = document.getElementById('realtime-status-badge');
  if (badgeEl) {
    badgeEl.className = 'realtime-status-badge offline';
    badgeEl.innerHTML = `<span class="live-dot red"></span> <span class="live-text">ไม่มีสัญญาณอินเทอร์เน็ต</span>`;
    badgeEl.title = 'ขาดการเชื่อมต่ออินเทอร์เน็ต ระบบจะเชื่อมต่อใหม่อัตโนมัติเมื่ออินเทอร์เน็ตกลับมา';
  }
}

async function handleNetworkReconnect() {
  showToast('🔄 เชื่อมต่ออินเทอร์เน็ตอีกครั้ง กำลังซิงค์ข้อมูลล่าสุด...', 'info');
  if (currentSection === 'dashboard') await renderDashboard(false);

  if (realtimeChannel) {
    try { sb.removeChannel(realtimeChannel); } catch (e) { /* ignore */ }
    realtimeChannel = null;
  }
  initRealtimeSubscriptions();
}

function updateUserSidebarUI() {
  if (!currentUser) return;

  const avatarEl = document.getElementById('sidebar-user-avatar');
  const nameEl = document.getElementById('sidebar-user-name');
  const roleEl = document.getElementById('sidebar-user-role');
  const navUsersLink = document.getElementById('nav-users');

  if (avatarEl) avatarEl.textContent = (currentUser.display_name || '?').charAt(0).toUpperCase();
  if (nameEl) nameEl.textContent = currentUser.display_name || currentUser.username;
  
  const isAdmin = currentUser.role === 'admin';
  if (roleEl) {
    roleEl.textContent = isAdmin ? 'แอดมิน (Admin)' : 'พนักงาน (User)';
    roleEl.className = isAdmin ? 'badge badge-admin' : 'badge badge-user';
  }

  // Only Admin can see and access User Management menu
  if (navUsersLink) {
    navUsersLink.style.display = isAdmin ? 'flex' : 'none';
  }
}

async function loadSettings() {
  try {
    let data = null;
    if (sb) {
      try {
        const res = await sb.from('settings').select('*').eq('id', 1).single();
        if (!res.error && res.data) data = res.data;
      } catch (e) { /* ignore */ }
    }

    const localDualMode = localStorage.getItem('setting_dual_station_mode');
    const localShowPayer = localStorage.getItem('setting_show_payer_name');
    const localYardFee = localStorage.getItem('setting_yard_fee');
    const localAddr = localStorage.getItem('setting_plantation_address');
    const localBuyer = localStorage.getItem('setting_auction_buyer');
    const localLogo = localStorage.getItem('setting_plantation_logo');

    const baseSettings = data || {
      plantation_name: 'กลุ่มเกษตรกรชาวสวนยาง กยท.ท่าสะแก',
      price_sheet: 45, price_cup: 35, price_latex: 50,
      default_cart_weight: 5, deduction_percent: 0,
      dual_station_mode: false, show_payer_name: true, yard_fee: 0.50
    };

    cachedSettings = {
      ...baseSettings,
      dual_station_mode: localDualMode !== null ? localDualMode === 'true' : (baseSettings.dual_station_mode === true),
      show_payer_name: localShowPayer !== null ? localShowPayer === 'true' : (baseSettings.show_payer_name !== false),
      yard_fee: localYardFee !== null ? parseFloat(localYardFee) : (baseSettings.yard_fee !== undefined ? baseSettings.yard_fee : 0.50),
      plantation_address: localAddr || baseSettings.plantation_address || 'เลขที่ 127 หมู่7 ต.ท่าสะแก อ.ชาติตระการ จ.พิษณุโลก',
      auction_buyer: localBuyer || baseSettings.auction_buyer || 'เฮียต้อม ยางพารา',
      plantation_logo: localLogo || baseSettings.plantation_logo || ''
    };

    updatePlantationName();
    updatePurchaseDualModeUI();
    return cachedSettings;
  } catch (err) {
    console.error('Failed to load settings:', err);
    const localDualMode = localStorage.getItem('setting_dual_station_mode');
    cachedSettings = {
      plantation_name: 'กลุ่มเกษตรกรชาวสวนยาง กยท.ท่าสะแก',
      price_sheet: 45, price_cup: 35, price_latex: 50,
      default_cart_weight: 5, deduction_percent: 0,
      dual_station_mode: localDualMode !== null ? localDualMode === 'true' : false,
      show_payer_name: true, yard_fee: 0.50
    };
    updatePurchaseDualModeUI();
    return cachedSettings;
  }
}

let currentCustomLogoBase64 = null;

function updatePlantationLogo() {
  const logoUrl = currentCustomLogoBase64 !== null ? currentCustomLogoBase64 : (cachedSettings?.plantation_logo || localStorage.getItem('setting_plantation_logo'));
  
  const loginLogoEl = document.getElementById('login-logo-icon');
  const sidebarLogoEl = document.getElementById('sidebar-logo-icon');
  const previewLogoEl = document.getElementById('setting-logo-preview');

  if (logoUrl) {
    const imgHtml = `<img src="${logoUrl}" alt="Logo" style="width:100%; height:100%; object-fit:cover; border-radius:inherit;">`;
    if (loginLogoEl) loginLogoEl.innerHTML = imgHtml;
    if (sidebarLogoEl) sidebarLogoEl.innerHTML = imgHtml;
    if (previewLogoEl) previewLogoEl.innerHTML = imgHtml;
  } else {
    if (loginLogoEl) loginLogoEl.textContent = '🌿';
    if (sidebarLogoEl) sidebarLogoEl.textContent = '🌿';
    if (previewLogoEl) previewLogoEl.textContent = '🌿';
  }
}

function handleLogoFileSelect(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (file.size > 3 * 1024 * 1024) {
    showToast('ขนาดไฟล์รูปภาพใหญ่เกินไป (กรุณาใช้ไฟล์ภาพขนาดไม่เกิน 3MB)', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    currentCustomLogoBase64 = e.target.result;
    updatePlantationLogo();
    showToast('อัปโหลดรูปโลโก้เรียบร้อยแล้ว! (อย่าลืมกดปุ่ม "💾 บันทึกการตั้งค่า" ด้านล่าง)', 'info');
  };
  reader.readAsDataURL(file);
}

function removeCustomLogo() {
  currentCustomLogoBase64 = '';
  localStorage.removeItem('setting_plantation_logo');
  if (cachedSettings) cachedSettings.plantation_logo = '';
  updatePlantationLogo();
  showToast('คืนค่าโลโก้เป็นแบบเริ่มต้น (🌿) เรียบร้อยแล้ว!');
}

function updatePlantationName() {
  const name = cachedSettings?.plantation_name || 'ลานยางพาราชุมชน';
  document.getElementById('sidebar-plantation-name').textContent = name;
  document.getElementById('login-plantation-name').textContent = name;
  updatePlantationLogo();
}

function updatePurchaseDualModeUI() {
  const badgeEl = document.getElementById('dual-mode-purchase-badge');
  const btnEl = document.getElementById('save-transaction-btn') || document.getElementById('save-tx-btn');
  const isDual = cachedSettings?.dual_station_mode === true;

  if (badgeEl) {
    if (isDual) {
      badgeEl.className = 'dual-mode-badge active';
      badgeEl.innerHTML = `<span class="live-dot"></span> ⚡ โหมด 2 เครื่อง: <strong>เปิดใช้งานอยู่</strong> (เครื่องนี้ = สถานีชั่ง ส่งข้อมูลไปสถานีออกใบเสร็จ)`;
    } else {
      badgeEl.className = 'dual-mode-badge inactive';
      badgeEl.innerHTML = `<span class="live-dot yellow"></span> ⚪ โหมด 2 เครื่อง: <strong>ปิดอยู่</strong> (บันทึกและพิมพ์ในเครื่องเดียว)`;
    }
  }

  if (btnEl) {
    btnEl.innerHTML = isDual ? '📤 ส่งข้อมูลไปสถานีออกใบเสร็จ' : '💾 บันทึกธุรกรรม';
  }
}

// ========== PURCHASE ROUNDS MANAGEMENT ==========
async function loadCurrentRound() {
  try {
    const { data } = await sb.from('purchase_rounds')
      .select('*')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1);

    if (data && data.length > 0) {
      currentRound = data[0];
    } else {
      currentRound = null;
    }
    updateRoundBanner();
  } catch (err) {
    console.error('Error loading round:', err);
    currentRound = null;
    updateRoundBanner();
  }
}

function updateRoundBanner() {
  const titleEl = document.getElementById('banner-round-title');
  const actionsEl = document.getElementById('banner-round-actions');
  const subtitleEl = document.getElementById('dashboard-subtitle');

  if (currentRound) {
    titleEl.textContent = `${currentRound.title} (เริ่มเมื่อ ${formatDateTime(currentRound.start_date)})`;
    actionsEl.innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="navigateTo('rounds')">🔍 ดูรายละเอียดรอบ</button>
      <button class="btn btn-danger btn-sm" onclick="confirmCloseRound('${currentRound.id}')">🔒 ปิดรอบนี้</button>
    `;
    if (subtitleEl) subtitleEl.textContent = `ภาพรวมของ ${currentRound.title}`;
  } else {
    titleEl.textContent = 'ยังไม่มีรอบการรับซื้อเปิดอยู่';
    actionsEl.innerHTML = `
      <button class="btn btn-gold btn-sm" onclick="openStartRoundModal()">▶️ เริ่มรอบใหม่</button>
    `;
    if (subtitleEl) subtitleEl.textContent = 'ยังไม่มีรอบการรับซื้อที่เปิดใช้งาน';
  }
}

function openStartRoundModal() {
  const modal = document.getElementById('start-round-modal');
  const titleInput = document.getElementById('round-title-input');
  
  // Default round name suggestion
  const today = new Date();
  const monthNames = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const monthStr = monthNames[today.getMonth()];
  const yearStr = today.getFullYear() + 543;
  titleInput.value = `รอบที่ 1 - ${monthStr} ${yearStr}`;
  
  modal.classList.add('show');
  titleInput.focus();
}

function closeStartRoundModal() {
  document.getElementById('start-round-modal').classList.remove('show');
}

async function saveStartNewRound() {
  const title = document.getElementById('round-title-input').value.trim();
  if (!title) {
    showToast('กรุณากรอกชื่อรอบการรับซื้อ', 'error');
    return;
  }

  showLoading();
  try {
    // If there is an active round, close it first
    if (currentRound) {
      let closePayload = {
        status: 'closed',
        end_date: new Date().toISOString(),
        closed_at: new Date().toISOString(),
        closed_by_name: currentUser ? currentUser.display_name : 'ผู้ดูแลระบบ'
      };
      let { error: closeErr } = await sb.from('purchase_rounds').update(closePayload).eq('id', currentRound.id);
      if (closeErr) {
        delete closePayload.closed_at;
        delete closePayload.closed_by_name;
        await sb.from('purchase_rounds').update(closePayload).eq('id', currentRound.id);
      }
    }

    // Insert new open round
    const { data, error } = await sb.from('purchase_rounds').insert({
      title: title,
      status: 'open',
      start_date: new Date().toISOString()
    }).select().single();

    if (error) throw error;

    currentRound = data;
    showToast(`เริ่มรอบใหม่ "${title}" สำเร็จ!`);
    closeStartRoundModal();
    updateRoundBanner();

    if (currentSection === 'rounds') renderRounds();
    if (currentSection === 'dashboard') renderDashboard();
  } catch (err) {
    showToast('ไม่สามารถเริ่มรอบใหม่ได้: ' + err.message, 'error');
  }
  hideLoading();
}

function confirmCloseRound(roundId) {
  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-message').innerHTML = `
    <span class="confirm-icon">🔒</span>
    คุณต้องการ <strong>ปิดรอบการรับซื้อ</strong> นี้ใช่หรือไม่?<br>
    <small style="color:var(--text-muted);">เมื่อปิดรอบแล้ว ธุรกรรมใหม่หลังจากนี้จะต้องสร้างในรอบถัดไป</small>
  `;
  document.getElementById('confirm-action-btn').onclick = () => closeRound(roundId);
  modal.classList.add('show');
}

async function closeRound(roundId) {
  showLoading();
  try {
    let updatePayload = {
      status: 'closed',
      end_date: new Date().toISOString(),
      closed_at: new Date().toISOString(),
      closed_by_name: currentUser ? currentUser.display_name : 'ผู้ดูแลระบบ'
    };

    let { error } = await sb.from('purchase_rounds').update(updatePayload).eq('id', roundId);
    if (error) {
      console.warn('closeRound update fallback executed:', error.message);
      delete updatePayload.closed_at;
      delete updatePayload.closed_by_name;
      const res = await sb.from('purchase_rounds').update(updatePayload).eq('id', roundId);
      error = res.error;
    }

    if (error) throw error;

    closeConfirmModal();
    showToast('ปิดรอบการรับซื้อสำเร็จ!');
    await loadCurrentRound();

    if (currentSection === 'rounds') renderRounds();
    if (currentSection === 'dashboard') renderDashboard();
  } catch (err) {
    showToast('ปิดรอบไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

async function renderRounds() {
  showLoading();
  try {
    // Render active round detail card
    const activeDetailEl = document.getElementById('active-round-detail');
    if (currentRound) {
      // 1. Query member transactions summary for active round
      const { data: roundTx } = await sb.from('transactions')
        .select('net_weight, final_weight, total_price, member_code')
        .eq('round_id', currentRound.id);

      const txArr = roundTx || [];
      const totalCount = txArr.length;
      const uniqueMembers = new Set(txArr.map(t => t.member_code)).size;
      const totalPurchasedWeight = txArr.reduce((s, t) => s + Number(t.final_weight || t.net_weight || 0), 0);
      const totalPurchasedAmount = txArr.reduce((s, t) => s + Number(t.total_price || 0), 0);

      // 2. Query independent truck_deliveries table for active round
      let truckDeliveries = [];
      try {
        const { data: tdData } = await sb.from('truck_deliveries')
          .select('*')
          .eq('round_id', currentRound.id)
          .order('truck_number', { ascending: true });
        truckDeliveries = tdData || [];
      } catch (e) { /* ignore if table missing */ }

      const sumHeadWeight = truckDeliveries.reduce((s, t) => s + Number(t.head_weight || 0), 0);
      const sumTrailerWeight = truckDeliveries.reduce((s, t) => s + Number(t.trailer_weight || 0), 0);
      const sumTotalTruckWeight = truckDeliveries.reduce((s, t) => s + Number(t.total_weight || 0), 0);
      const discrepancy = totalPurchasedWeight - sumTotalTruckWeight;

      let discrepancyBadge = '';
      let discrepancyText = '';

      if (sumTotalTruckWeight === 0 && totalPurchasedWeight === 0) {
        discrepancyBadge = '<span class="badge" style="background:rgba(255,255,255,0.08); font-size:0.85rem;">ยังไม่มีรายการ</span>';
        discrepancyText = 'ยังไม่มีข้อมูลการรับซื้อหรือจัดขึ้นรถ';
      } else if (Math.abs(discrepancy) < 0.01) {
        discrepancyBadge = '<span class="badge badge-green" style="font-size:0.85rem; padding:4px 12px;">🟢 ยอดตรงกัน 100%</span>';
        discrepancyText = 'ยอดรับซื้อรวมเท่ากับยอดจัดขึ้นรถพอดี';
      } else if (discrepancy > 0) {
        discrepancyBadge = '<span class="badge badge-warning" style="font-size:0.85rem; padding:4px 12px;">🟡 ยอดรับซื้อมากกว่าขึ้นรถ</span>';
        discrepancyText = `ยางรับซื้อคงเหลือในลานยังไม่ได้ขึ้นรถ <strong>${formatNumber(discrepancy)} กก.</strong>`;
      } else {
        discrepancyBadge = '<span class="badge badge-info" style="font-size:0.85rem; padding:4px 12px;">🔵 ยอดขึ้นรถมากกว่ารับซื้อ</span>';
        discrepancyText = `น้ำหนักขึ้นรถพ่วงเกินยอดรับซื้อ <strong>${formatNumber(Math.abs(discrepancy))} กก.</strong>`;
      }

      let truckTableHtml = '';
      if (truckDeliveries.length === 0) {
        truckTableHtml = `<p style="font-size:0.85rem; color:var(--text-muted); padding:10px 0; margin:0;">ยังไม่มีการบันทึกจัดส่งมอบขึ้นรถพ่วงในรอบนี้</p>`;
      } else {
        truckTableHtml = `
          <div class="table-container" style="margin-top:12px;">
            <table class="data-table" style="font-size:0.85rem;">
              <thead>
                <tr>
                  <th>รถคันที่ / ทะเบียน</th>
                  <th>🚛 พ่วงตัวแม่ (กก.)</th>
                  <th>🚚 พ่วงตัวลูก (กก.)</th>
                  <th>📊 รวมทั้งคัน (กก.)</th>
                  <th>🎯 เป้าหมายคันนี้</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                ${truckDeliveries.map(t => {
                  const target = Number(t.target_weight || 0);
                  const total = Number(t.total_weight || 0);
                  let targetText = '-';
                  if (target > 0) {
                    const pct = Math.round((total / target) * 100);
                    targetText = `${formatNumber(target)} กก. <span class="badge ${pct > 100 ? 'badge-warning' : 'badge-green'}" style="font-size:0.7rem;">${pct}%</span>`;
                  }
                  return `
                    <tr>
                      <td><strong style="color:var(--gold); font-size:0.95rem;">🚛 ${t.truck_number}</strong></td>
                      <td>${formatNumber(t.head_weight || 0)} กก.</td>
                      <td>${formatNumber(t.trailer_weight || 0)} กก.</td>
                      <td style="font-weight:700; color:var(--green);">${formatNumber(t.total_weight || 0)} กก.</td>
                      <td>${targetText}</td>
                      <td>
                        <button class="btn btn-secondary btn-sm" onclick="openEditTruckDeliveryModal('${t.id}', '${t.truck_number}', ${t.head_weight || 0}, ${t.trailer_weight || 0}, ${t.target_weight || 0})" style="font-size:0.75rem; padding:3px 8px;">✏️ แก้ไข</button>
                        <button class="btn btn-danger btn-sm" onclick="confirmDeleteTruckDelivery('${t.id}', '${t.truck_number}')" style="font-size:0.75rem; padding:3px 8px; margin-left:4px;">🗑️ ลบ</button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `;
      }

      const reconciliationHtml = `
        <div style="margin-top:20px; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px 18px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:8px;">
            <h5 style="font-size:1.05rem; margin:0; color:var(--text-accent);">🚚 สรุปยอดจัดขึ้นรถพ่วง & ตรวจสอบผลต่างยาง (ประจำรอบ)</h5>
            ${discrepancyBadge}
          </div>
          <div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:12px;">
            ${discrepancyText}
          </div>

          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:12px; font-size:0.85rem; margin-top:10px; margin-bottom:14px;">
            <div style="background:rgba(255,255,255,0.02); padding:10px; border-radius:var(--radius-sm);">
              <span style="color:var(--text-muted); display:block; font-size:0.75rem;">📦 ยอดรับซื้อรวมจากสมาชิก</span>
              <strong style="font-size:1.1rem; color:var(--text-primary);">${formatNumber(totalPurchasedWeight)} กก.</strong>
              <div style="font-size:0.75rem; color:var(--gold);">${formatNumber(totalPurchasedAmount)} บาท</div>
            </div>
            <div style="background:rgba(16,185,129,0.05); border:1px solid rgba(16,185,129,0.2); padding:10px; border-radius:var(--radius-sm);">
              <span style="color:var(--green); display:block; font-size:0.75rem;">🚚 ยอดรวมจัดขึ้นรถพ่วงทุกคัน</span>
              <strong style="font-size:1.1rem; color:var(--green);">${formatNumber(sumTotalTruckWeight)} กก.</strong>
              <div style="font-size:0.75rem; color:var(--text-muted);">ตัวแม่: ${formatNumber(sumHeadWeight)} | ตัวลูก: ${formatNumber(sumTrailerWeight)}</div>
            </div>
            <div style="background:${discrepancy > 0 ? 'rgba(245,158,11,0.08)' : (discrepancy < 0 ? 'rgba(56,189,248,0.08)' : 'rgba(255,255,255,0.02)')}; border:1px solid ${discrepancy > 0 ? 'rgba(245,158,11,0.3)' : (discrepancy < 0 ? 'rgba(56,189,248,0.3)' : 'var(--border)')}; padding:10px; border-radius:var(--radius-sm);">
              <span style="color:${discrepancy !== 0 ? 'var(--text-accent)' : 'var(--text-muted)'}; display:block; font-size:0.75rem;">⚖️ ผลต่าง (ขาด/เกิน)</span>
              <strong style="font-size:1.1rem; color:${discrepancy > 0 ? 'var(--warning)' : (discrepancy < 0 ? 'var(--text-accent)' : 'var(--green)')};">${formatNumber(Math.abs(discrepancy))} กก.</strong>
              <div style="font-size:0.75rem; color:var(--text-muted);">${discrepancy > 0 ? 'ยางรับซื้อยังไม่ออก' : (discrepancy < 0 ? 'ยางออกเกินรับซื้อ' : 'ตรงกัน 100%')}</div>
            </div>
          </div>

          ${truckTableHtml}
        </div>
      `;

      activeDetailEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
          <div>
            <h4 style="font-size:1.2rem; font-weight:700; color:var(--text-accent);">${currentRound.title}</h4>
            <p style="color:var(--text-secondary); font-size:0.85rem; margin-top:4px;">
              เริ่มวันที่: ${formatDateTime(currentRound.start_date)}
            </p>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-secondary btn-sm" onclick="showRoundReport('${currentRound.id}')">📊 ดูเอกสารสรุปรอบนี้</button>
            <button class="btn btn-danger btn-sm" onclick="confirmCloseRound('${currentRound.id}')">🔒 ปิดรอบนี้</button>
          </div>
        </div>
        <div class="stats-grid" style="margin-top:16px; margin-bottom:0;">
          <div class="glass-card stat-card" style="padding:12px 16px;">
            <div class="card-title">สมาชิกที่ขาย</div>
            <div class="card-value" style="font-size:1.3rem;">${uniqueMembers} <span class="unit">คน</span></div>
          </div>
          <div class="glass-card stat-card" style="padding:12px 16px;">
            <div class="card-title">รายการรับซื้อ</div>
            <div class="card-value" style="font-size:1.3rem;">${totalCount} <span class="unit">รายการ</span></div>
          </div>
          <div class="glass-card stat-card" style="padding:12px 16px;">
            <div class="card-title">น้ำหนักรวม</div>
            <div class="card-value" style="font-size:1.3rem;">${formatNumber(totalPurchasedWeight)} <span class="unit">กก.</span></div>
          </div>
          <div class="glass-card stat-card" style="padding:12px 16px;">
            <div class="card-title">ยอดเงินรวม</div>
            <div class="card-value" style="font-size:1.3rem; color:var(--gold);">${formatNumber(totalPurchasedAmount)} <span class="unit">บาท</span></div>
          </div>
        </div>
        ${reconciliationHtml}
      `;
    } else {
      activeDetailEl.innerHTML = `
        <div class="empty-state" style="padding:20px;">
          <div class="empty-icon">⏸️</div>
          <p>ยังไม่มีรอบการรับซื้อที่เปิดอยู่ กดปุ่ม "เริ่มรอบใหม่" เพื่อเปิดรอบ</p>
        </div>
      `;
    }

    // Render rounds table
    const { data: rounds, error } = await sb.from('purchase_rounds')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const tbody = document.getElementById('rounds-table-body');
    const emptyState = document.getElementById('rounds-empty');
    const list = rounds || [];

    if (list.length === 0) {
      tbody.innerHTML = '';
      emptyState.style.display = 'block';
      tbody.closest('.table-container').style.display = 'none';
    } else {
      emptyState.style.display = 'none';
      tbody.closest('.table-container').style.display = 'block';

      tbody.innerHTML = list.map(r => `
        <tr>
          <td><strong>${r.title}</strong></td>
          <td>
            ${r.status === 'open' 
              ? '<span class="badge badge-green">▶️ เปิดรับซื้ออยู่</span>' 
              : '<span class="badge" style="background:rgba(148,163,184,0.2);color:#cbd5e1;">🔒 ปิดรอบแล้ว</span>'}
          </td>
          <td>${formatDateTime(r.start_date)}</td>
          <td>${r.end_date ? formatDateTime(r.end_date) : '-'}</td>
          <td>${r.closed_by_name || '-'}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="showRoundReport('${r.id}')" title="ดูสรุปรอบ">
              📄 สรุปรอบ
            </button>
          </td>
          <td>
            <div style="display:flex; gap:4px; align-items:center;">
              <button class="btn btn-gold btn-sm" onclick="exportRoundToExcel('${r.id}')" title="ดาวน์โหลด Excel สำหรับธนาคาร">📊 Excel</button>
              <button class="btn btn-primary btn-sm" onclick="printRoundReport('${r.id}')" title="พิมพ์ A4 / บันทึก PDF สำหรับธนาคาร">🖨️ PDF/พิมพ์</button>
              ${r.status === 'open' 
                ? `<button class="btn btn-danger btn-sm" onclick="confirmCloseRound('${r.id}')" style="margin-left:4px;">🔒 ปิดรอบ</button>` 
                : ''}
              ${currentUser?.role === 'admin' 
                ? `<button class="btn btn-danger btn-sm btn-icon" onclick="confirmDeleteRound('${r.id}')" title="ลบรอบนี้" style="margin-left:4px;">🗑️</button>` 
                : ''}
            </div>
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    showToast('โหลดข้อมูลรอบไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

async function showRoundReport(roundId) {
  showLoading();
  try {
    const { data: round } = await sb.from('purchase_rounds').select('*').eq('id', roundId).single();
    if (!round) throw new Error('ไม่พบข้อมูลรอบการรับซื้อ');

    // Fetch all transactions in this round
    const { data: txList } = await sb.from('transactions')
      .select('*')
      .eq('round_id', roundId)
      .order('date');

    const transactions = txList || [];
    currentReportRound = round;
    currentReportTxList = transactions;

    const format = localStorage.getItem('print_pref_round_report') || '1';
    const formatSelect = document.getElementById('round-report-print-format');
    if (formatSelect) formatSelect.value = format;

    renderRoundReportContent(round, transactions, format);
    document.getElementById('round-report-modal').classList.add('show');
  } catch (err) {
    showToast('ไม่สามารถสร้างเอกสารสรุปรอบได้: ' + err.message, 'error');
  }
  hideLoading();
}

let currentReportRound = null;
let currentReportTxList = [];

function onRoundReportFormatChange(format) {
  localStorage.setItem('print_pref_round_report', format);
  if (currentReportRound) {
    renderRoundReportContent(currentReportRound, currentReportTxList, format);
  }
}

function renderRoundReportContent(round, transactions, format) {
  const plantationName = cachedSettings?.plantation_name || 'ลานยางพาราชุมชน';

  // Group transactions by member
  const memberSummary = {};
  let grandTotalWeight = 0;
  let grandTotalAmount = 0;

  transactions.forEach(t => {
    const code = t.member_code;
    const weight = Number(t.final_weight || t.net_weight || 0);
    const amount = Number(t.total_price || 0);

    if (!memberSummary[code]) {
      memberSummary[code] = {
        code: code,
        name: t.member_name,
        account_no: t.member_account_no || '-',
        txCount: 0,
        totalWeight: 0,
        totalAmount: 0
      };
    }
    memberSummary[code].txCount += 1;
    memberSummary[code].totalWeight += weight;
    memberSummary[code].totalAmount += amount;

    grandTotalWeight += weight;
    grandTotalAmount += amount;
  });

  const memberRows = Object.values(memberSummary).sort((a, b) => a.code.localeCompare(b.code));

  const singleReportHtml = `
    <div class="round-report-header">
      <h2>🌿 ${plantationName}</h2>
      <p>เอกสารสรุปผลการส่งมอบยางพาราประจำรอบ</p>
      <h3 style="margin-top:6px; color:#0f172a;">${round.title}</h3>
    </div>

    <div class="report-meta-grid">
      <div class="report-meta-item">
        <div class="meta-label">วันที่เริ่มรอบ</div>
        <div class="meta-val">${formatDateTime(round.start_date)}</div>
      </div>
      <div class="report-meta-item">
        <div class="meta-label">วันที่ปิดรอบ</div>
        <div class="meta-val">${round.end_date ? formatDateTime(round.end_date) : 'กำลังเปิดรับซื้อ'}</div>
      </div>
      <div class="report-meta-item">
        <div class="meta-label">จำนวนสมาชิกที่ขาย</div>
        <div class="meta-val">${memberRows.length} คน</div>
      </div>
      <div class="report-meta-item">
        <div class="meta-label">จำนวนรายการรวม</div>
        <div class="meta-val">${transactions.length} รายการ</div>
      </div>
    </div>

    <table class="report-table">
      <thead>
        <tr>
          <th>รหัส</th>
          <th>ชื่อ-นามสกุลสมาชิก</th>
          <th>เลขที่บัญชี</th>
          <th>จำนวนครั้ง</th>
          <th style="text-align:right;">น้ำหนักสุทธิรวม (กก.)</th>
          <th style="text-align:right;">ยอดเงินรวม (บาท)</th>
        </tr>
      </thead>
      <tbody>
        ${memberRows.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:#64748b;">ไม่มีข้อมูลธุรกรรมในรอบนี้</td></tr>' : 
          memberRows.map(m => `
            <tr>
              <td><strong>${m.code}</strong></td>
              <td>${m.name}</td>
              <td>${m.account_no}</td>
              <td>${m.txCount} ครั้ง</td>
              <td style="text-align:right;">${formatNumber(m.totalWeight)}</td>
              <td style="text-align:right; font-weight:600;">${formatNumber(m.totalAmount)}</td>
            </tr>
          `).join('')
        }
        <tr class="total-row">
          <td colspan="4" style="text-align:right;">ยอดรวมสุทธิทั้งรอบ:</td>
          <td style="text-align:right;">${formatNumber(grandTotalWeight)} กก.</td>
          <td style="text-align:right; color:#059669;">${formatNumber(grandTotalAmount)} บาท</td>
        </tr>
      </tbody>
    </table>

    <div class="report-footer-sign">
      <div class="sign-box">
        ลงชื่อ...................................................<br>
        (${round.closed_by_name || currentUser.display_name})<br>
        ผู้สรุปรอบส่งมอบยาง
      </div>
      <div class="sign-box">
        ลงชื่อ...................................................<br>
        (...................................................)<br>
        ประธาน / ผู้ตรวจสอบ
      </div>
    </div>
  `;

  const reportContent = document.getElementById('round-report-content');
  if (format === '2') {
    const cutLine = `<div class="receipt-cut-line" style="margin:20px 0;">--------------------------------------------------</div>`;
    reportContent.innerHTML = `${singleReportHtml}${cutLine}${singleReportHtml}`;
  } else {
    reportContent.innerHTML = singleReportHtml;
  }
}

function closeRoundReportModal() {
  document.getElementById('round-report-modal').classList.remove('show');
}

async function exportRoundToExcel(roundId = null) {
  let round = currentReportRound;
  if (roundId && (!round || round.id !== roundId)) {
    try {
      const { data } = await sb.from('purchase_rounds').select('*').eq('id', roundId).single();
      if (data) round = data;
    } catch (e) { /* ignore */ }
  }

  if (!round) {
    showToast('ไม่พบข้อมูลรอบส่งมอบยาง', 'error');
    return;
  }

  showLoading();
  try {
    const { data: txList } = await sb.from('transactions').select('*').eq('round_id', round.id).order('member_code');
    const transactions = txList || [];
    const plantationName = cachedSettings?.plantation_name || 'กลุ่มเกษตรกรชาวสวนยาง กยท.ท่าสะแก';
    const plantationAddress = cachedSettings?.plantation_address || 'เลขที่ 127 หมู่7 ต.ท่าสะแก อ.ชาติตระการ จ.พิษณุโลก';

    // Group transactions by member
    const memberSummary = {};
    let grandTotalWeight = 0;
    let grandTotalAmount = 0;

    transactions.forEach(t => {
      const code = t.member_code;
      const wt = Number(t.final_weight || t.net_weight || 0);
      const amt = Number(t.total_price || 0);

      if (!memberSummary[code]) {
        memberSummary[code] = {
          code: code,
          name: t.member_name,
          account_no: t.member_account_no || '-',
          totalWeight: 0,
          totalAmount: 0,
          pricePerKg: t.price_per_kg || 0
        };
      }
      memberSummary[code].totalWeight += wt;
      memberSummary[code].totalAmount += amt;
      grandTotalWeight += wt;
      grandTotalAmount += amt;
    });

    const memberRows = Object.values(memberSummary).sort((a, b) => a.code.localeCompare(b.code));

    // Construct full MSO-styled Excel HTML Document
    const excelHtml = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <!--[if gte mso 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>สรุปยอดโอนเงินธนาคาร</x:Name>
                <x:WorksheetOptions>
                  <x:DisplayGridlines/>
                </x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
        <style>
          body { font-family: 'Sarabun', 'Segoe UI', Tahoma, sans-serif; font-size: 13px; }
          .title-header { font-size: 18px; font-weight: bold; color: #064e3b; text-align: center; height: 30px; }
          .subtitle-header { font-size: 12px; color: #475569; text-align: center; height: 22px; }
          .doc-title { font-size: 14px; font-weight: bold; color: #0f172a; text-align: center; background-color: #ecfdf5; height: 28px; border: 1px solid #10b981; }
          .meta-info { font-size: 12px; color: #334155; height: 24px; text-align: center; }
          
          table { border-collapse: collapse; width: 100%; font-family: 'Sarabun', 'Segoe UI', sans-serif; }
          th { background-color: #064e3b; color: #ffffff; font-weight: bold; font-size: 13px; text-align: center; border: 1px solid #000000; padding: 8px; height: 32px; }
          td { border: 1px solid #cbd5e1; padding: 6px 10px; font-size: 12px; vertical-align: middle; }
          
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .text-left { text-align: left; }
          
          .member-code { mso-number-format:"\\@"; text-align: center; font-weight: bold; background-color: #f1f5f9; }
          .bank-acc { mso-number-format:"\\@"; text-align: center; font-family: monospace; font-weight: bold; }
          .num-format { mso-number-format:"\\#\\,\\#\\#0\\.00"; text-align: right; }
          
          tr.even-row td { background-color: #f8fafc; }
          tr.total-row td { background-color: #d1fae5; font-weight: bold; font-size: 14px; border-top: 2px solid #047857; border-bottom: 2px double #047857; height: 35px; }
        </style>
      </head>
      <body>
        <table>
          <tr>
            <td colspan="7" class="title-header">${plantationName}</td>
          </tr>
          <tr>
            <td colspan="7" class="subtitle-header">${plantationAddress}</td>
          </tr>
          <tr>
            <td colspan="7" class="doc-title">เอกสารสรุปยอดเงินส่งมอบยางพาราประจำรอบ (สำหรับยื่นโอนเงินธนาคาร)</td>
          </tr>
          <tr>
            <td colspan="7" class="meta-info">
              <b>รอบส่งมอบยาง:</b> ${round.title} &nbsp;&nbsp;|&nbsp;&nbsp; 
              <b>วันที่เริ่ม:</b> ${formatDate(round.start_date)} &nbsp;&nbsp;|&nbsp;&nbsp; 
              <b>วันที่ปิดรอบ:</b> ${round.end_date ? formatDate(round.end_date) : 'กำลังเปิดรับซื้อ'}
            </td>
          </tr>
          <tr><td colspan="7"></td></tr>
          <thead>
            <tr>
              <th style="width: 70px;">ลำดับ</th>
              <th style="width: 120px;">รหัสสมาชิก</th>
              <th style="width: 260px;">ชื่อ-นามสกุลสมาชิก</th>
              <th style="width: 220px;">เลขที่บัญชีธนาคาร</th>
              <th style="width: 160px;">น้ำหนักยางสุทธิ (กก.)</th>
              <th style="width: 140px;">ราคา/กก. (บาท)</th>
              <th style="width: 200px;">จำนวนเงินที่ต้องโอน (บาท)</th>
            </tr>
          </thead>
          <tbody>
            ${memberRows.map((m, idx) => {
              const avgPrice = m.totalWeight > 0 ? (m.totalAmount / m.totalWeight) : m.pricePerKg;
              const rowClass = idx % 2 === 1 ? 'class="even-row"' : '';
              return `
                <tr ${rowClass}>
                  <td class="text-center">${idx + 1}</td>
                  <td class="member-code">${m.code}</td>
                  <td class="text-left"><b>${m.name}</b></td>
                  <td class="bank-acc">${m.account_no}</td>
                  <td class="num-format">${m.totalWeight.toFixed(2)}</td>
                  <td class="num-format">${avgPrice.toFixed(2)}</td>
                  <td class="num-format" style="font-weight:bold; color:#047857;">${m.totalAmount.toFixed(2)}</td>
                </tr>
              `;
            }).join('')}
            <tr class="total-row">
              <td colspan="4" class="text-right"><b>ยอดรวมสุทธิทั้งรอบที่ต้องโอน:</b></td>
              <td class="num-format" style="font-weight:bold;">${grandTotalWeight.toFixed(2)}</td>
              <td></td>
              <td class="num-format" style="font-weight:bold; color:#047857;">${grandTotalAmount.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;

    const cleanTitle = round.title.replace(/[\/\s]/g, '_');
    const fileName = `สรุปยอดโอนเงินธนาคาร_${cleanTitle}.xls`;

    const blob = new Blob(['\ufeff' + excelHtml], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('ดาวน์โหลดไฟล์ Excel สำหรับธนาคารสำเร็จ!');
  } catch (err) {
    showToast('ดาวน์โหลด Excel ไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

async function printRoundReport(roundId = null) {
  let round = currentReportRound;
  let transactions = currentReportTxList;

  if (roundId && (!round || round.id !== roundId)) {
    showLoading();
    try {
      const { data: rData } = await sb.from('purchase_rounds').select('*').eq('id', roundId).single();
      const { data: tData } = await sb.from('transactions').select('*').eq('round_id', roundId).order('member_code');
      round = rData;
      transactions = tData || [];
    } catch (e) { /* ignore */ }
    hideLoading();
  }

  if (!round) {
    showToast('ไม่พบข้อมูลรอบส่งมอบยาง', 'error');
    return;
  }

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showToast('เบราว์เซอร์บล็อกป๊อปอัพ กรุณาอนุญาตป๊อปอัพเพื่อพิมพ์', 'error');
    return;
  }

  const plantationName = cachedSettings?.plantation_name || 'กลุ่มเกษตรกรชาวสวนยาง กยท.ท่าสะแก';
  const plantationAddress = cachedSettings?.plantation_address || 'เลขที่ 127 หมู่7 ต.ท่าสะแก อ.ชาติตระการ จ.พิษณุโลก';

  // Group transactions by member
  const memberSummary = {};
  let grandTotalWeight = 0;
  let grandTotalAmount = 0;

  transactions.forEach(t => {
    const code = t.member_code;
    const weight = Number(t.final_weight || t.net_weight || 0);
    const amount = Number(t.total_price || 0);

    if (!memberSummary[code]) {
      memberSummary[code] = {
        code: code,
        name: t.member_name,
        account_no: t.member_account_no || '-',
        txCount: 0,
        totalWeight: 0,
        totalAmount: 0
      };
    }
    memberSummary[code].txCount += 1;
    memberSummary[code].totalWeight += weight;
    memberSummary[code].totalAmount += amount;

    grandTotalWeight += weight;
    grandTotalAmount += amount;
  });

  const memberRows = Object.values(memberSummary).sort((a, b) => a.code.localeCompare(b.code));

  // Resolve President name for dynamic signature
  let presidentName = '';
  try {
    const { data: presUser } = await sb.from('app_users').select('display_name').eq('position', 'ประธานกรรมการ').limit(1);
    if (presUser && presUser.length > 0) {
      presidentName = presUser[0].display_name;
    }
  } catch (e) { /* ignore */ }

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>เอกสารสรุปยอดโอนเงินธนาคาร - ${round.title}</title>
      <style>
        @page { size: A4 portrait; margin: 12mm 15mm; }
        * { box-sizing: border-box; }
        body {
          font-family: 'Sarabun', 'TH Sarabun New', sans-serif;
          font-size: 13px;
          color: #0f172a;
          margin: 0;
          padding: 0;
          background: #fff;
        }
        .header { text-align: center; margin-bottom: 16px; border-bottom: 2px solid #0f172a; padding-bottom: 8px; }
        .header h2 { margin: 0 0 4px 0; font-size: 20px; font-weight: bold; color: #064e3b; }
        .header p { margin: 0 0 4px 0; font-size: 12px; color: #475569; }
        .header h3 { margin: 6px 0 0 0; font-size: 16px; font-weight: bold; color: #0f172a; }

        .meta-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr 1fr;
          gap: 10px;
          margin-bottom: 16px;
          border: 1px solid #cbd5e1;
          padding: 10px 14px;
          border-radius: 6px;
          background: #f8fafc;
          font-size: 12px;
        }
        .meta-item strong { display: block; font-size: 11px; color: #64748b; margin-bottom: 2px; }
        .meta-item span { font-size: 14px; font-weight: bold; color: #0f172a; }

        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px; }
        th, td { border: 1px solid #cbd5e1; padding: 7px 10px; }
        th { background-color: #f1f5f9; text-align: center; font-weight: bold; color: #1e293b; }
        tr:nth-child(even) td { background-color: #f8fafc; }
        tr.total-row td { font-weight: bold; background-color: #ecfdf5; font-size: 13px; border-top: 2px solid #047857; border-bottom: 2px double #047857; }

        .code-badge {
          display: inline-block;
          background: #e2e8f0;
          color: #0f172a;
          padding: 2px 8px;
          border-radius: 4px;
          font-family: monospace;
          font-weight: bold;
        }

        .signatures {
          margin-top: 35px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 40px;
          text-align: center;
          page-break-inside: avoid;
        }
        .sig-box { border: 1px solid #cbd5e1; padding: 14px; border-radius: 6px; background: #fff; }
        .sig-line { margin-top: 40px; border-bottom: 1px dotted #0f172a; display: inline-block; width: 75%; }
        .sig-name { margin-top: 8px; font-size: 12px; color: #334155; }
        .sig-role { font-size: 13px; font-weight: bold; color: #0f172a; margin-bottom: 4px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>${plantationName}</h2>
        <p>${plantationAddress}</p>
        <h3>เอกสารสรุปยอดเงินส่งมอบยางพาราประจำรอบ (สำหรับยื่นโอนเงินธนาคาร)</h3>
        <p style="margin-top:4px;"><strong>รอบส่งมอบยาง:</strong> ${round.title} &nbsp;|&nbsp; <strong>วันที่เริ่ม:</strong> ${formatDate(round.start_date)} &nbsp;|&nbsp; <strong>วันที่ปิดรอบ:</strong> ${round.end_date ? formatDate(round.end_date) : 'กำลังเปิดรับซื้อ'}</p>
      </div>

      <div class="meta-grid">
        <div class="meta-item"><strong>จำนวนสมาชิกที่ขาย:</strong> <span>${memberRows.length} คน</span></div>
        <div class="meta-item"><strong>จำนวนเที่ยวชั่งรวม:</strong> <span>${transactions.length} เที่ยว</span></div>
        <div class="meta-item"><strong>น้ำหนักสุทธิรวม:</strong> <span style="color:#047857;">${formatNumber(grandTotalWeight)} กก.</span></div>
        <div class="meta-item"><strong>ยอดเงินต้องโอนรวม:</strong> <span style="color:#b45309;">${formatNumber(grandTotalAmount)} บาท</span></div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:45px;">ลำดับ</th>
            <th style="width:80px;">รหัสสมาชิก</th>
            <th>ชื่อ-นามสกุลสมาชิก</th>
            <th style="width:170px;">เลขที่บัญชีธนาคาร</th>
            <th style="width:85px; text-align:center;">จำนวนเที่ยว</th>
            <th style="width:120px; text-align:right;">น้ำหนักสุทธิ (กก.)</th>
            <th style="width:140px; text-align:right;">ยอดเงินที่ต้องโอน (บาท)</th>
          </tr>
        </thead>
        <tbody>
          ${memberRows.length === 0 ? '<tr><td colspan="7" style="text-align:center; padding:15px; color:#64748b;">ไม่มีข้อมูลสมาชิกในรอบนี้</td></tr>' :
            memberRows.map((m, idx) => `
              <tr>
                <td style="text-align:center;">${idx + 1}</td>
                <td style="text-align:center;"><span class="code-badge">${m.code}</span></td>
                <td><strong>${m.name}</strong></td>
                <td style="text-align:center; font-family:monospace; font-weight:bold; font-size:13px; color:#1e293b;">${m.account_no}</td>
                <td style="text-align:center;">${m.txCount}</td>
                <td style="text-align:right; font-weight:600;">${formatNumber(m.totalWeight)}</td>
                <td style="text-align:right; font-weight:bold; color:#047857; font-size:13px;">${formatNumber(m.totalAmount)}</td>
              </tr>
            `).join('')
          }
          <tr class="total-row">
            <td colspan="5" style="text-align:right;">ยอดรวมสุทธิทั้งรอบที่ต้องโอน:</td>
            <td style="text-align:right;">${formatNumber(grandTotalWeight)} กก.</td>
            <td style="text-align:right; color:#047857; font-size:14px;">${formatNumber(grandTotalAmount)} บาท</td>
          </tr>
        </tbody>
      </table>

      <div class="signatures">
        <div class="sig-box">
          <div class="sig-role">ผู้สรุปรายงาน / ผู้จัดทำ</div>
          <div class="sig-line"></div>
          <div class="sig-name">(${round.closed_by_name || currentUser?.display_name || '...................................................'})</div>
        </div>
        <div class="sig-box">
          <div class="sig-role">ประธานกรรมการ / ผู้ตรวจสอบอนุมัติ</div>
          <div class="sig-line"></div>
          <div class="sig-name">(${presidentName || '...................................................'})</div>
        </div>
      </div>
    </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(htmlContent);
  printWindow.document.close();

  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 350);
}

function confirmDeleteRound(roundId) {
  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-message').innerHTML = `
    <span class="confirm-icon">🗑️</span>
    ต้องการ <strong>ลบประวัติรอบส่งมอบยาง</strong> นี้ใช่หรือไม่?<br>
    <span style="font-size:0.85rem;color:var(--danger);">⚠️ การลบรอบจะทำการลบรายการรับซื้อทั้งหมดที่อยู่ในรอบนี้ออกจากระบบด้วย</span>
  `;
  document.getElementById('confirm-action-btn').onclick = () => deleteRound(roundId);
  modal.classList.add('show');
}

async function deleteRound(roundId) {
  if (!roundId) return;
  showLoading();
  try {
    // 1. Delete all transactions belonging to this round
    await sb.from('transactions').delete().eq('round_id', roundId);

    // 2. Delete the round record itself
    const { data, error } = await sb.from('purchase_rounds').delete().eq('id', roundId).select();
    if (error) throw error;

    if (!data || data.length === 0) {
      throw new Error('ไม่สามารถลบรอบได้ ข้อมูลไม่ถูกลบออกจากฐานข้อมูล (กรุณาเช็ค RLS Policy)');
    }

    closeConfirmModal();
    showToast('ลบรอบส่งมอบยางและรายการทั้งหมดในรอบเรียบร้อยแล้ว!');

    if (currentRound && currentRound.id === roundId) {
      currentRound = null;
      updateRoundBanner();
    }

    await loadCurrentRound();
    if (currentSection === 'rounds') renderRounds();
    if (currentSection === 'dashboard') renderDashboard();
    if (currentSection === 'history') filterHistory();
  } catch (err) {
    showToast('ลบรอบไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

async function showMemberSalesHistory(memberCode) {
  showLoading();
  try {
    // 1. Fetch member details
    const { data: member } = await sb.from('members').select('*').eq('code', memberCode).single();
    if (!member) throw new Error('ไม่พบข้อมูลสมาชิก');

    // 2. Fetch member's transactions
    const { data: txList } = await sb.from('transactions')
      .select('*')
      .eq('member_code', memberCode)
      .order('date', { ascending: false });

    const transactions = txList || [];

    // 3. Fetch purchase_rounds for title mapping
    const { data: rounds } = await sb.from('purchase_rounds').select('id, title');
    const roundTitleMap = {};
    (rounds || []).forEach(r => { roundTitleMap[r.id] = r.title; });

    // Calculate stats
    const distinctRounds = new Set(transactions.map(t => t.round_id).filter(Boolean)).size;
    const txCount = transactions.length;
    const totalWeight = transactions.reduce((s, t) => s + Number(t.final_weight || t.net_weight || 0), 0);
    const totalAmount = transactions.reduce((s, t) => s + Number(t.total_price || 0), 0);

    // Set UI
    document.getElementById('m-history-avatar').textContent = member.name.charAt(0);
    document.getElementById('m-history-name').textContent = member.name;
    document.getElementById('m-history-code-account').textContent = `รหัสสมาชิก: ${member.code} | เลขที่บัญชี: ${member.account_no || '-'}`;

    document.getElementById('m-stat-rounds-count').innerHTML = `${distinctRounds} <span class="unit">รอบ</span>`;
    document.getElementById('m-stat-tx-count').innerHTML = `${txCount} <span class="unit">ครั้ง</span>`;
    document.getElementById('m-stat-total-weight').innerHTML = `${formatNumber(totalWeight)} <span class="unit">กก.</span>`;
    document.getElementById('m-stat-total-amount').innerHTML = `${formatNumber(totalAmount)} <span class="unit">บาท</span>`;

    const tbody = document.getElementById('m-history-table-body');
    const emptyState = document.getElementById('m-history-empty');

    if (transactions.length === 0) {
      tbody.innerHTML = '';
      emptyState.style.display = 'block';
      tbody.closest('.table-container').style.display = 'none';
    } else {
      emptyState.style.display = 'none';
      tbody.closest('.table-container').style.display = 'block';
      tbody.innerHTML = transactions.map(t => `
        <tr>
          <td>${formatDateTime(t.date)}</td>
          <td><span class="badge badge-green">${roundTitleMap[t.round_id] || 'นอกรอบ'}</span></td>
          <td>${getRubberTypeBadge(t.rubber_type)}</td>
          <td>${t.trip_count || 1}</td>
          <td>${formatNumber(t.final_weight || t.net_weight)} กก.</td>
          <td style="font-weight:600; color:var(--gold);">${formatNumber(t.total_price)} ฿</td>
          <td><span class="badge" style="background:rgba(255,255,255,0.08);">${t.created_by_name || 'ผู้ดูแลระบบ'}</span></td>
          <td>
            <button class="btn btn-secondary btn-sm btn-icon" onclick="showReceiptFromHistory('${t.id}')" title="ใบเสร็จ">🧾</button>
          </td>
        </tr>
      `).join('');
    }

    const prefFormat = localStorage.getItem('print_pref_member_summary') || '1';
    const formatSelect = document.getElementById('member-summary-print-format');
    if (formatSelect) formatSelect.value = prefFormat;

    document.getElementById('member-sales-modal').classList.add('show');
  } catch (err) {
    showToast('ไม่สามารถโหลดประวัติสมาชิกได้: ' + err.message, 'error');
  }
  hideLoading();
}

function closeMemberSalesModal() {
  document.getElementById('member-sales-modal').classList.remove('show');
}

function onMemberSummaryFormatChange(format) {
  localStorage.setItem('print_pref_member_summary', format);
}

async function printMemberSalesSummary() {
  const name = document.getElementById('m-history-name').textContent;
  const codeAccount = document.getElementById('m-history-code-account').textContent;
  const rounds = document.getElementById('m-stat-rounds-count').textContent;
  const txCount = document.getElementById('m-stat-tx-count').textContent;
  const totalWeight = document.getElementById('m-stat-total-weight').textContent;
  const totalAmount = document.getElementById('m-stat-total-amount').textContent;
  const plantName = cachedSettings?.plantation_name || 'ลานยางพาราชุมชน';

  const format = document.getElementById('member-summary-print-format')?.value || localStorage.getItem('print_pref_member_summary') || '1';
  localStorage.setItem('print_pref_member_summary', format);

  // Fetch Chairman display name dynamically from app_users where position contains 'ประธาน'
  let chairmanName = '..................................';
  try {
    const { data: chairmen } = await sb.from('app_users')
      .select('display_name')
      .ilike('position', '%ประธาน%')
      .order('created_at', { ascending: true })
      .limit(1);

    if (chairmen && chairmen.length > 0 && chairmen[0].display_name) {
      chairmanName = chairmen[0].display_name;
    }
  } catch (err) {
    console.warn('Could not fetch chairman name from app_users:', err);
  }

  // Get table rows from the member sales history table
  const tableBody = document.getElementById('m-history-table-body');
  const rows = tableBody ? tableBody.querySelectorAll('tr') : [];
  const rowCount = rows.length;

  // Dynamic font size: scale down if too many rows or if 2-copy mode
  let fontSize = '11px';
  let rowPadding = '4px 6px';
  if (format === '2' || rowCount > 20) { fontSize = '9px'; rowPadding = '2px 4px'; }
  else if (rowCount > 12) { fontSize = '10px'; rowPadding = '3px 5px'; }

  let tableRowsHtml = '';
  rows.forEach((row, idx) => {
    const cells = row.querySelectorAll('td');
    if (cells.length >= 6) {
      tableRowsHtml += `<tr>
        <td style="padding:${rowPadding};">${idx + 1}</td>
        <td style="padding:${rowPadding};">${cells[0].textContent}</td>
        <td style="padding:${rowPadding};">${cells[1].textContent}</td>
        <td style="padding:${rowPadding};text-align:center;">${cells[3].textContent}</td>
        <td style="padding:${rowPadding};text-align:right;">${cells[4].textContent}</td>
        <td style="padding:${rowPadding};text-align:right;font-weight:600;">${cells[5].textContent}</td>
      </tr>`;
    }
  });

  const singleDocHtml = `
    <div style="page-break-inside: avoid;">
      <div class="header">
        <h2>🌿 ${plantName}</h2>
        <h3>เอกสารสรุปรายการขายยางพารา</h3>
        <p>${codeAccount}</p>
        <p style="font-size:13px;font-weight:600;margin-top:4px;">${name}</p>
      </div>

      <div class="stats">
        <div class="stat-item"><div class="stat-label">จำนวนรอบ</div><div class="stat-value">${rounds}</div></div>
        <div class="stat-item"><div class="stat-label">จำนวนครั้ง</div><div class="stat-value">${txCount}</div></div>
        <div class="stat-item"><div class="stat-label">น้ำหนักรวม</div><div class="stat-value">${totalWeight}</div></div>
        <div class="stat-item"><div class="stat-label">ยอดเงินรวม</div><div class="stat-value">${totalAmount}</div></div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:30px;">#</th>
            <th>วันเวลา</th>
            <th>รอบ</th>
            <th style="text-align:center;">เที่ยว</th>
            <th style="text-align:right;">น้ำหนักสุทธิ</th>
            <th style="text-align:right;">ยอดเงิน</th>
          </tr>
        </thead>
        <tbody>${tableRowsHtml}</tbody>
      </table>

      <div class="footer-sign">
        <div class="sign-box">
          <div class="dots">ลงชื่อ..................................</div>
          <div style="margin-top:4px;">(${name})</div>
          <div style="font-weight:600;margin-top:2px;">สมาชิก</div>
        </div>
        <div class="sign-box">
          <div class="dots">ลงชื่อ..................................</div>
          <div style="margin-top:4px;">(${chairmanName})</div>
          <div style="font-weight:600;margin-top:2px;">ประธานกรรมการ</div>
        </div>
      </div>
    </div>
  `;

  let bodyContent = singleDocHtml;
  if (format === '2') {
    bodyContent = `
      ${singleDocHtml}
      <div style="border-top:1px dashed #666; margin:15px 0; text-align:center; font-size:10px; color:#888;">✂️ ---------------------------------------------------------------------------------------------------</div>
      ${singleDocHtml}
    `;
  }

  const printHtml = `
    <html>
    <head>
      <title>สรุปรายการขาย - ${name}</title>
      <style>
        @page { size: A4 portrait; margin: 8mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Sarabun', sans-serif; font-size: ${fontSize}; color: #000; }
        .header { text-align: center; margin-bottom: 6px; }
        .header h2 { font-size: 15px; margin-bottom: 2px; }
        .header h3 { font-size: 12px; margin-bottom: 2px; }
        .header p { font-size: 10px; color: #555; }
        .stats { display: flex; justify-content: space-around; margin: 6px 0; padding: 5px; border: 1px solid #ccc; border-radius: 4px; }
        .stat-item { text-align: center; }
        .stat-label { font-size: 9px; color: #666; }
        .stat-value { font-size: 12px; font-weight: 700; }
        table { width: 100%; border-collapse: collapse; margin-top: 4px; }
        th { background: #f0f0f0; font-weight: 600; padding: ${rowPadding}; border: 1px solid #ccc; text-align: left; font-size: ${fontSize}; }
        td { padding: ${rowPadding}; border: 1px solid #ddd; font-size: ${fontSize}; }
        tr:nth-child(even) { background: #fafafa; }
        .footer-sign { display: flex; justify-content: space-around; margin-top: 14px; font-size: 10px; text-align: center; }
        .sign-box { flex: 0 0 40%; }
        .sign-box .dots { margin-top: 18px; }
      </style>
    </head>
    <body>
      ${bodyContent}
    </body>
    </html>
  `;

  const printWindow = window.open('', '_blank', 'width=800,height=600');
  printWindow.document.write(printHtml);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => { printWindow.print(); }, 500);
}

// ========== NAVIGATION ==========
function navigateTo(section) {
  // Check admin security for users section
  if (section === 'users' && currentUser?.role !== 'admin') {
    showToast('เฉพาะแอดมินเท่านั้นที่สามารถเข้าถึงหน้านี้ได้', 'error');
    return;
  }

  currentSection = section;
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`section-${section}`);
  if (target) target.classList.add('active');

  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  const link = document.getElementById(`nav-${section}`);
  if (link) link.classList.add('active');

  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('show');

  switch (section) {
    case 'dashboard': renderDashboard(); break;
    case 'members': renderMembers(); break;
    case 'purchase': initPurchase(); break;
    case 'pending': renderPendingTransactions(); break;
    case 'rounds': renderRounds(); break;
    case 'truck-weights': renderTruckWeights(); break;
    case 'history': renderHistory(); break;
    case 'profile': renderProfile(); break;
    case 'users': renderUsers(); break;
    case 'settings': renderSettings(); break;
  }
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('show');
}

// ========== FORMATTING HELPERS ==========
function formatNumber(num) {
  return Number(num || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  return formatDate(dateStr) + ' ' + formatTime(dateStr);
}

function getRubberTypeBadge(type) {
  const classes = { sheet: 'badge-green', cup: 'badge-gold', latex: 'badge-blue' };
  return `<span class="badge ${classes[type] || 'badge-green'}">${RUBBER_TYPES[type] || type}</span>`;
}

// ========== DASHBOARD ==========
async function renderDashboard(showSpinner = true, newTransaction = null) {
  if (showSpinner) showLoading();
  try {
    await loadCurrentRound();

    let todayTx = [];
    let monthTx = [];
    let recentTx = [];

    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();

    if (currentRound) {
      // Fetch active round transactions
      const { data: rTx } = await sb.from('transactions')
        .select('*')
        .eq('round_id', currentRound.id)
        .order('date', { ascending: false });

      todayTx = rTx || [];
      recentTx = (rTx || []).slice(0, 10);
    }

    // Fetch this month's total payout
    const { data: mTx } = await sb.from('transactions')
      .select('total_price')
      .gte('date', startOfMonth);
    monthTx = mTx || [];

    // Fetch member count
    const { count: memberCount } = await sb.from('members')
      .select('*', { count: 'exact', head: true });

    const roundCount = todayTx.length;
    const roundWeight = todayTx.reduce((s, t) => s + Number(t.final_weight || t.net_weight || 0), 0);
    const roundAmount = todayTx.reduce((s, t) => s + Number(t.total_price || 0), 0);
    const monthAmount = monthTx.reduce((s, t) => s + Number(t.total_price || 0), 0);

    document.getElementById('stat-round-count').innerHTML = `${roundCount} <span class="unit">รายการ</span>`;
    document.getElementById('stat-round-weight').innerHTML = `${formatNumber(roundWeight)} <span class="unit">กก.</span>`;
    document.getElementById('stat-round-amount').innerHTML = `${formatNumber(roundAmount)} <span class="unit">บาท</span>`;
    document.getElementById('stat-month-amount').innerHTML = `${formatNumber(monthAmount)} <span class="unit">บาท</span>`;
    document.getElementById('stat-total-members').innerHTML = `${memberCount || 0} <span class="unit">คน</span>`;

    // Recent transactions table
    const tbody = document.getElementById('recent-transactions');
    const emptyState = document.getElementById('recent-empty');

    if (recentTx.length === 0) {
      tbody.innerHTML = '';
      emptyState.style.display = 'block';
      tbody.closest('.table-container').style.display = 'none';
    } else {
      emptyState.style.display = 'none';
      tbody.closest('.table-container').style.display = 'block';
      tbody.innerHTML = recentTx.map(t => {
        const isNew = newTransaction && String(t.id) === String(newTransaction.id);
        return `
        <tr class="${isNew ? 'new-row-flash' : ''}">
          <td>${formatDateTime(t.date)}</td>
          <td><span class="badge badge-green">${t.member_code}</span></td>
          <td>${t.member_name}</td>
          <td>${getRubberTypeBadge(t.rubber_type)}</td>
          <td>${t.trip_count || 1}</td>
          <td>${formatNumber(t.final_weight || t.net_weight)} กก.</td>
          <td style="font-weight:600; color: var(--gold);">${formatNumber(t.total_price)} ฿</td>
          <td><span class="badge" style="background:rgba(255,255,255,0.08);">${t.created_by_name || 'ผู้ดูแลระบบ'}</span></td>
        </tr>
      `;
      }).join('');
    }
  } catch (err) {
    showToast('โหลดข้อมูลแดชบอร์ดไม่สำเร็จ: ' + err.message, 'error');
  }
  if (showSpinner) hideLoading();
}

// ========== MEMBERS ==========
async function renderMembers(filter = '') {
  showLoading();
  try {
    let query = sb.from('members').select('*').order('code');
    if (filter) {
      query = query.or(`code.ilike.%${filter}%,name.ilike.%${filter}%`);
    }
    const { data, error } = await query;
    if (error) throw error;

    const members = data || [];
    const tbody = document.getElementById('members-table-body');
    const emptyState = document.getElementById('members-empty');

    if (members.length === 0) {
      tbody.innerHTML = '';
      emptyState.style.display = 'block';
      tbody.closest('.table-container').style.display = 'none';
    } else {
      emptyState.style.display = 'none';
      tbody.closest('.table-container').style.display = 'block';
      tbody.innerHTML = members.map(m => `
        <tr>
          <td><span class="badge badge-green" style="font-family:'Inter',monospace;font-size:0.85rem;">${m.code}</span></td>
          <td>${m.name}</td>
          <td>${m.phone || '-'}</td>
          <td>${m.account_no || '-'}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="showMemberSalesHistory('${m.code}')">
              📊 ประวัติขาย
            </button>
          </td>
          <td>${formatDate(m.created_at)}</td>
          <td>
            <button class="btn btn-secondary btn-sm btn-icon" onclick="openMemberModal('${m.id}')" title="แก้ไข">✏️</button>
            <button class="btn btn-danger btn-sm btn-icon" onclick="confirmDeleteMember('${m.id}')" title="ลบ" style="margin-left:4px;">🗑️</button>
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    showToast('โหลดข้อมูลสมาชิกไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

let memberSearchTimeout;
function searchMembers(query) {
  clearTimeout(memberSearchTimeout);
  memberSearchTimeout = setTimeout(() => renderMembers(query), 300);
}

async function openMemberModal(id = null) {
  const modal = document.getElementById('member-modal');
  const titleEl = document.getElementById('member-modal-title');
  const codeInput = document.getElementById('member-code');
  const nameInput = document.getElementById('member-name');
  const phoneInput = document.getElementById('member-phone');
  const accountInput = document.getElementById('member-account');
  const hiddenId = document.getElementById('member-id-hidden');

  if (id) {
    const { data: member } = await sb.from('members').select('*').eq('id', id).single();
    if (!member) return;
    titleEl.textContent = 'แก้ไขข้อมูลสมาชิก';
    hiddenId.value = member.id;
    codeInput.value = member.code;
    nameInput.value = member.name;
    phoneInput.value = member.phone || '';
    accountInput.value = member.account_no || '';
  } else {
    titleEl.textContent = 'เพิ่มสมาชิกใหม่';
    hiddenId.value = '';
    nameInput.value = '';
    phoneInput.value = '';
    accountInput.value = '';

    // Auto-suggest next code
    const { data: members } = await sb.from('members').select('code').order('code', { ascending: false }).limit(1);
    if (members && members.length > 0) {
      const maxCode = parseInt(members[0].code) || 0;
      codeInput.value = String(maxCode + 1).padStart(3, '0');
    } else {
      codeInput.value = '001';
    }
  }

  modal.classList.add('show');
  codeInput.focus();
}

function closeMemberModal() {
  document.getElementById('member-modal').classList.remove('show');
}

async function saveMember() {
  const hiddenId = document.getElementById('member-id-hidden').value;
  const code = document.getElementById('member-code').value.trim();
  const name = document.getElementById('member-name').value.trim();
  const phone = document.getElementById('member-phone').value.trim();
  const account_no = document.getElementById('member-account').value.trim();

  if (!code) { showToast('กรุณากรอกรหัสสมาชิก', 'error'); return; }
  if (!name) { showToast('กรุณากรอกชื่อ-นามสกุล', 'error'); return; }

  // Check duplicate code
  const { data: existing } = await sb.from('members').select('id, name').eq('code', code);
  const duplicate = existing?.find(m => m.id !== hiddenId);
  if (duplicate) {
    showToast(`รหัส ${code} ถูกใช้แล้วโดย ${duplicate.name}`, 'error');
    return;
  }

  showLoading();
  try {
    if (hiddenId) {
      const { error } = await sb.from('members').update({ code, name, phone, account_no }).eq('id', hiddenId);
      if (error) throw error;
      showToast('แก้ไขข้อมูลสมาชิกสำเร็จ!');
    } else {
      const { error } = await sb.from('members').insert({ code, name, phone, account_no });
      if (error) throw error;
      showToast('เพิ่มสมาชิกใหม่สำเร็จ!');
    }
    closeMemberModal();
    await renderMembers();
  } catch (err) {
    showToast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

function confirmDeleteMember(id) {
  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-message').innerHTML = `
    <span class="confirm-icon">⚠️</span>
    ต้องการลบสมาชิกคนนี้ใช่หรือไม่?
  `;
  document.getElementById('confirm-action-btn').onclick = () => deleteMember(id);
  modal.classList.add('show');
}

async function deleteMember(id) {
  if (!id) return;
  showLoading();
  try {
    const { data, error } = await sb.from('members').delete().eq('id', id).select();
    if (error) throw error;

    if (!data || data.length === 0) {
      throw new Error('ไม่สามารถลบสมาชิกได้ ข้อมูลไม่ถูกลบออกจากฐานข้อมูล (กรุณาเช็ค RLS Policy)');
    }

    closeConfirmModal();
    await renderMembers();
    showToast('ลบสมาชิกเรียบร้อยแล้ว!');
  } catch (err) {
    showToast('ลบไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

function closeConfirmModal() {
  document.getElementById('confirm-modal').classList.remove('show');
}

// ========== PURCHASE — MULTI-TRIP ==========
async function initPurchase() {
  await loadCurrentRound();
  clearSelectedMember();
  document.getElementById('purchase-member-search').value = '';
  document.getElementById('purchase-member-list').innerHTML = '';
  document.getElementById('rubber-type').value = 'cup';

  if (!cachedSettings) await loadSettings();

  document.getElementById('cart-weight').value = cachedSettings?.default_cart_weight || '';
  document.getElementById('price-per-kg').value = cachedSettings?.price_cup || cachedSettings?.price_sheet || '';

  const truckSelect = document.getElementById('purchase-truck-number');
  const trailerSelect = document.getElementById('purchase-trailer-type');

  // Preserve previously selected truck & trailer
  const savedTruck = truckSelect ? truckSelect.value : '';
  const savedTrailer = trailerSelect ? trailerSelect.value : 'head';

  if (currentRound && truckSelect) {
    try {
      const { data: tData } = await sb.from('transactions')
        .select('truck_number')
        .eq('round_id', currentRound.id)
        .neq('truck_number', '');

      const existingTrucks = Array.from(new Set((tData || []).map(t => t.truck_number).filter(Boolean)));
      const defaultSet = new Set(['คันที่ 1', 'คันที่ 2', 'คันที่ 3', ...existingTrucks]);

      if (savedTruck && savedTruck !== 'NEW') {
        defaultSet.add(savedTruck);
      }

      truckSelect.innerHTML = '<option value="">-- ไม่ระบุ --</option>' +
        Array.from(defaultSet).map(t => `<option value="${t}">${t}</option>`).join('') +
        '<option value="NEW">➕ เพิ่มรถคันใหม่...</option>';

      if (savedTruck && savedTruck !== 'NEW') {
        truckSelect.value = savedTruck;
      } else {
        truckSelect.value = '';
      }
    } catch (e) { /* ignore */ }
  }

  if (trailerSelect && savedTrailer) {
    trailerSelect.value = savedTrailer;
  }

  // Start with one trip
  trips = [{ grossWeight: 0 }];
  renderTrips();
  calculatePrice();
  updatePurchaseDualModeUI();
  updatePurchaseTruckIndicator();
}

function updatePurchaseTruckIndicator() {
  const truckNum = document.getElementById('purchase-truck-number')?.value;
  const trailerType = document.getElementById('purchase-trailer-type')?.value;
  const indicatorEl = document.getElementById('purchase-truck-indicator');

  if (!indicatorEl) return;

  if (truckNum && truckNum !== 'NEW') {
    const trailerText = trailerType === 'trailer' ? 'ตัวลูก' : 'ตัวแม่';
    indicatorEl.innerHTML = `<span class="badge badge-green" style="font-size:0.8rem; padding:4px 10px;">✅ ระบุรถเรียบร้อย: ${truckNum} (${trailerText})</span>`;
  } else {
    indicatorEl.innerHTML = `<span class="badge badge-warning" style="font-size:0.8rem; padding:4px 10px;">⚠️ ยังไม่ได้เลือกรถ</span>`;
  }
}

function onPurchaseTruckSelect(val) {
  if (val === 'NEW') {
    const name = window.prompt('กรุณากรอกชื่อหรือหมายเลขรถคันใหม่ (เช่น คันที่ 4 หรือ ทะเบียนรถ):', 'คันที่ 4');
    const selectEl = document.getElementById('purchase-truck-number');
    if (name && name.trim() && selectEl) {
      const trimmed = name.trim();
      const newOpt = document.createElement('option');
      newOpt.value = trimmed;
      newOpt.textContent = trimmed;
      newOpt.selected = true;
      selectEl.insertBefore(newOpt, selectEl.lastElementChild);
    } else if (selectEl) {
      selectEl.value = '';
    }
  }
  updatePurchaseTruckIndicator();
}

function addTrip() {
  trips.push({ grossWeight: 0 });
  renderTrips();
  calculatePrice();
  setTimeout(() => {
    const inputs = document.querySelectorAll('.trip-gross-input');
    if (inputs.length > 0) inputs[inputs.length - 1].focus();
  }, 100);
}

function removeTrip(index) {
  if (trips.length <= 1) return;
  trips.splice(index, 1);
  renderTrips();
  calculatePrice();
}

function renderTrips() {
  const container = document.getElementById('trips-container');
  const cartWeight = parseFloat(document.getElementById('cart-weight')?.value) || 0;

  container.innerHTML = trips.map((trip, i) => {
    const isDirectRubber = trip.grossWeight > 0 && trip.grossWeight <= cartWeight;
    const net = isDirectRubber ? trip.grossWeight : Math.max(0, trip.grossWeight - cartWeight);

    return `
      <div class="trip-item ${isDirectRubber ? 'trip-item-direct' : ''}">
        <div class="trip-header">
          <span class="trip-number">🚛 เที่ยวที่ ${i + 1}</span>
          ${trips.length > 1 ? `<button class="btn btn-danger btn-icon btn-sm" onclick="removeTrip(${i})" title="ลบเที่ยวนี้">✕</button>` : ''}
        </div>
        <div class="trip-inputs">
          <div style="flex:1;">
            <input type="number" class="form-input trip-gross-input" data-index="${i}"
                   placeholder="น้ำหนักชั่งได้ (กก.)" step="0.01" min="0"
                   value="${trip.grossWeight || ''}"
                   oninput="onTripInput(${i}, this.value)">
          </div>
          <div class="trip-net ${isDirectRubber ? 'direct-net' : ''}" id="trip-net-${i}">
            ${isDirectRubber 
              ? `💡 สุทธิ: ${formatNumber(net)} กก. (ชั่งเฉพาะยาง)` 
              : `สุทธิ: ${formatNumber(net)} กก.`}
          </div>
        </div>
        ${isDirectRubber ? `
          <div class="trip-info-box" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.4); color: #10b981; padding: 8px 12px; border-radius: var(--radius-sm); font-size: 0.82rem; margin-top: 10px;">
            💡 <strong>ชั่งเฉพาะยาง / เศษยาง:</strong> น้ำหนักชั่ง (${formatNumber(trip.grossWeight)} กก.) น้อยกว่ารถเข็น (${formatNumber(cartWeight)} กก.) ระบบจึงคิดสุทธิ <strong>${formatNumber(net)} กก.</strong> โดยไม่หักรถเข็น
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function onTripInput(index, value) {
  trips[index].grossWeight = parseFloat(value) || 0;
  calculatePrice();
}

async function searchPurchaseMember(query) {
  const listEl = document.getElementById('purchase-member-list');
  if (!query.trim()) { listEl.innerHTML = ''; return; }

  try {
    const { data } = await sb.from('members')
      .select('*')
      .or(`code.ilike.%${query}%,name.ilike.%${query}%`)
      .order('code')
      .limit(8);

    const members = data || [];
    if (members.length === 0) {
      listEl.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:0.85rem;">ไม่พบสมาชิก</div>';
      return;
    }

    listEl.innerHTML = members.map(m => `
      <div class="member-search-item" onclick='selectPurchaseMember(${JSON.stringify(m).replace(/'/g, "&#39;")})'>
        <span class="member-code-badge">${m.code}</span>
        <span>${m.name}</span>
      </div>
    `).join('');
  } catch (err) {
    listEl.innerHTML = '<div style="padding:12px;color:var(--danger);font-size:0.85rem;">เกิดข้อผิดพลาด</div>';
  }
}

function selectPurchaseMember(member) {
  selectedMember = member;
  document.getElementById('purchase-member-search').value = '';
  document.getElementById('purchase-member-list').innerHTML = '';

  const card = document.getElementById('selected-member-info');
  card.classList.add('show');
  document.getElementById('selected-member-avatar').textContent = member.name.charAt(0);
  document.getElementById('selected-member-name').textContent = member.name;
  document.getElementById('selected-member-code').textContent = `รหัส: ${member.code}`;
}

function clearSelectedMember() {
  selectedMember = null;
  document.getElementById('selected-member-info').classList.remove('show');
}

function onRubberTypeChange() {
  const type = document.getElementById('rubber-type').value;
  if (cachedSettings) {
    const prices = { sheet: cachedSettings.price_sheet, cup: cachedSettings.price_cup, latex: cachedSettings.price_latex };
    document.getElementById('price-per-kg').value = prices[type] || 0;
  }
  calculatePrice();
}

function calculatePrice() {
  const cartWeight = parseFloat(document.getElementById('cart-weight').value) || 0;
  const auctionPrice = parseFloat(document.getElementById('price-per-kg').value) || 0;
  const yardFee = cachedSettings && cachedSettings.yard_fee !== undefined ? parseFloat(cachedSettings.yard_fee) : 0.50;
  const netPricePerKg = Math.max(0, auctionPrice - yardFee);

  const netHint = document.getElementById('net-price-hint');
  if (netHint) {
    if (auctionPrice > 0 && auctionPrice <= yardFee) {
      netHint.innerHTML = `<span style="color:#f87171;font-weight:700;">⚠️ คำเตือน: ราคาประมูล (${formatNumber(auctionPrice)} บาท) น้อยกว่าหรือเท่ากับค่าบริหารจัดการ (${formatNumber(yardFee)} บาท)!</span>`;
    } else {
      netHint.innerHTML = `ราคาหลังหักค่าบริหารจัดการ: <strong>${formatNumber(netPricePerKg)}</strong> บาท/กก. (หักค่าจัดการ -${formatNumber(yardFee)} บาท)`;
    }
  }

  const deductionPercent = cachedSettings?.deduction_percent || 0;

  let totalNet = 0;
  const detailHtml = [];

  trips.forEach((trip, i) => {
    if (trip.grossWeight > 0) {
      const isDirectRubber = trip.grossWeight <= cartWeight;
      const net = isDirectRubber ? trip.grossWeight : Math.max(0, trip.grossWeight - cartWeight);
      trip.netWeight = net;
      totalNet += net;

      const netEl = document.getElementById(`trip-net-${i}`);
      if (netEl) {
        netEl.textContent = isDirectRubber 
          ? `💡 สุทธิ: ${formatNumber(net)} กก. (ชั่งเฉพาะยาง)` 
          : `สุทธิ: ${formatNumber(net)} กก.`;
      }

      detailHtml.push(`
        <div class="calc-row" style="font-size:0.85rem;">
          <span class="label">เที่ยวที่ ${i + 1}: ${isDirectRubber ? `${formatNumber(trip.grossWeight)} กก. (ชั่งเฉพาะยาง ไม่หักรถเข็น)` : `${formatNumber(trip.grossWeight)} - ${formatNumber(cartWeight)}`}</span>
          <span class="value">${formatNumber(net)} กก.</span>
        </div>
      `);
    }
  });

  const deductionAmount = totalNet * deductionPercent / 100;
  const finalWeight = Math.max(0, totalNet - deductionAmount);
  const totalPrice = finalWeight * netPricePerKg;

  document.getElementById('calc-trips-detail').innerHTML = detailHtml.join('');
  document.getElementById('calc-total-net').textContent = `${formatNumber(totalNet)} กก.`;
  document.getElementById('calc-final-weight').textContent = `${formatNumber(finalWeight)} กก.`;
  document.getElementById('calc-total-price').textContent = `${formatNumber(totalPrice)} บาท`;

  document.getElementById('calc-deduction-pct').textContent = deductionPercent;
  document.getElementById('calc-deduction-amount').textContent = `- ${formatNumber(deductionAmount)} กก.`;
  document.getElementById('calc-price-per-kg').textContent = `${formatNumber(netPricePerKg)} บาท (${formatNumber(auctionPrice)} - ${formatNumber(yardFee)})`;

  const deductRow = document.getElementById('calc-deduction-row');
  if (deductRow) deductRow.style.display = deductionPercent > 0 ? 'flex' : 'none';
}

async function saveTransaction(confirmedOverride = false) {
  if (!selectedMember) { showToast('กรุณาเลือกสมาชิก', 'error'); return; }

  const cartWeight = parseFloat(document.getElementById('cart-weight').value) || 0;
  const auctionPrice = parseFloat(document.getElementById('price-per-kg').value) || 0;
  const yardFee = cachedSettings && cachedSettings.yard_fee !== undefined ? parseFloat(cachedSettings.yard_fee) : 0.50;
  const netPricePerKg = Math.max(0, auctionPrice - yardFee);
  const rubberType = document.getElementById('rubber-type').value;
  const deductionPercent = cachedSettings?.deduction_percent || 0;

  const activeTrips = trips.filter(t => t.grossWeight > 0);
  if (activeTrips.length === 0) { showToast('กรุณากรอกน้ำหนักอย่างน้อย 1 เที่ยว', 'error'); return; }
  if (auctionPrice <= 0) { showToast('กรุณากรอกราคาประมูลต่อ กก.', 'error'); return; }

  // Check warning for auction price
  const warnings = [];
  if (auctionPrice > 0 && auctionPrice <= yardFee) {
    warnings.push(`<strong>ราคาประมูล:</strong> ราคาประมูล (${formatNumber(auctionPrice)} บาท) น้อยกว่าหรือเท่ากับค่าบริหารจัดการ (${formatNumber(yardFee)} บาท)`);
  }

  if (warnings.length > 0 && !confirmedOverride) {
    openWeightWarningModal(warnings, () => saveTransaction(true));
    return;
  }

  const truckNumber = document.getElementById('purchase-truck-number')?.value || '';
  const trailerType = document.getElementById('purchase-trailer-type')?.value || 'head';

  if (!truckNumber && !confirmedOverride) {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-message').innerHTML = `
      <span class="confirm-icon" style="color:var(--warning);">⚠️</span>
      <strong style="font-size:1.05rem;">ยังไม่ได้เลือก "รถพ่วงที่จะจัดส่งมอบ"</strong><br><br>
      รายการนี้จะถูกบันทึกโดย <strong>"ไม่ได้ระบุรถพ่วง"</strong><br>
      <small style="color:var(--text-muted);">หากต้องการจัดขึ้นรถพ่วง ให้ย้อนกลับไปเลือกรถคันที่ก่อนครับ</small>
    `;
    const actionBtn = document.getElementById('confirm-action-btn');
    actionBtn.textContent = '💾 ยืนยันบันทึก (ไม่ระบุรถพ่วง)';
    actionBtn.onclick = () => {
      closeConfirmModal();
      saveTransaction(true);
    };
    modal.classList.add('show');
    return;
  }

  const tripDetails = activeTrips.map((t, i) => {
    const isDirectRubber = t.grossWeight <= cartWeight;
    const appliedCart = isDirectRubber ? 0 : cartWeight;
    const net = isDirectRubber ? t.grossWeight : Math.max(0, t.grossWeight - cartWeight);

    return {
      trip: i + 1,
      gross_weight: t.grossWeight,
      cart_weight: appliedCart,
      net_weight: net,
      is_direct_rubber: isDirectRubber
    };
  });

  const totalGross = tripDetails.reduce((s, t) => s + t.gross_weight, 0);
  const totalCart = tripDetails.reduce((s, t) => s + t.cart_weight, 0);
  const totalNet = tripDetails.reduce((s, t) => s + t.net_weight, 0);
  const deductionAmount = totalNet * deductionPercent / 100;
  const finalWeight = Math.max(0, totalNet - deductionAmount);
  const totalPrice = finalWeight * netPricePerKg;

  const isDualMode = cachedSettings?.dual_station_mode === true;

  showLoading();

  try {
    if (isDualMode) {
      // Station 1: Submit data to pending_transactions table
      const pendingPayload = {
        member_code: selectedMember.code,
        member_name: selectedMember.name,
        member_account_no: selectedMember.account_no || '',
        rubber_type: rubberType,
        gross_weight: totalGross,
        cart_weight: totalCart,
        net_weight: totalNet,
        deduction_percent: deductionPercent,
        final_weight: finalWeight,
        auction_price: auctionPrice,
        yard_fee: yardFee,
        price_per_kg: netPricePerKg,
        total_price: totalPrice,
        trips: tripDetails,
        trips_detail: tripDetails,
        trip_count: tripDetails.length,
        round_id: currentRound ? currentRound.id : null,
        truck_number: truckNumber,
        trailer_type: trailerType,
        status: 'pending',
        created_by_user_id: currentUser ? currentUser.id : null,
        created_by_username: currentUser ? currentUser.username : 'user',
        created_by_display_name: currentUser ? currentUser.display_name : 'ผู้ดูแลระบบ',
        date: new Date().toISOString()
      };

      let { data, error } = await sb.from('pending_transactions').insert(pendingPayload).select().single();

      if (error && error.message.includes('column')) {
        delete pendingPayload.trips;
        delete pendingPayload.cart_weight;
        delete pendingPayload.auction_price;
        delete pendingPayload.yard_fee;
        let res = await sb.from('pending_transactions').insert(pendingPayload).select().single();
        if (res.error && res.error.message.includes('column')) {
          delete pendingPayload.trips_detail;
          res = await sb.from('pending_transactions').insert(pendingPayload).select().single();
        }
        data = res.data;
        error = res.error;
      }

      if (error) {
        if (error.message.includes('relation') || error.message.includes('pending_transactions')) {
          throw new Error('ตาราง "pending_transactions" ยังไม่มีใน Supabase — กรุณารัน SQL สร้างตารางใน Supabase SQL Editor ก่อน');
        }
        throw error;
      }

      showToast(`📤 ส่งข้อมูลของ ${selectedMember.name} (${formatNumber(finalWeight)} กก. ยอด ${formatNumber(totalPrice)} ฿) ไปสถานีออกใบเสร็จเรียบร้อยแล้ว!`);
      await initPurchase();
    } else {
      // Single Station Mode: Save directly & Print
      const payload = {
        member_code: selectedMember.code,
        member_name: selectedMember.name,
        member_account_no: selectedMember.account_no || '',
        rubber_type: rubberType,
        gross_weight: totalGross,
        cart_weight: totalCart,
        net_weight: totalNet,
        deduction_percent: deductionPercent,
        final_weight: finalWeight,
        auction_price: auctionPrice,
        yard_fee: yardFee,
        price_per_kg: netPricePerKg,
        total_price: totalPrice,
        trips: tripDetails,
        trips_detail: tripDetails,
        trip_count: tripDetails.length,
        round_id: currentRound ? currentRound.id : null,
        truck_number: truckNumber,
        trailer_type: trailerType,
        created_by_name: currentUser ? currentUser.display_name : 'ผู้ดูแลระบบ',
        created_by_display_name: currentUser ? currentUser.display_name : 'ผู้ดูแลระบบ',
        confirmed_by_display_name: currentUser ? currentUser.display_name : 'ผู้ดูแลระบบ',
        date: new Date().toISOString()
      };

      let { data, error } = await sb.from('transactions').insert(payload).select().single();

      if (error && error.message.includes('column')) {
        delete payload.trips;
        delete payload.cart_weight;
        delete payload.auction_price;
        delete payload.yard_fee;
        delete payload.created_by_display_name;
        delete payload.confirmed_by_display_name;
        let res = await sb.from('transactions').insert(payload).select().single();
        if (res.error && res.error.message.includes('column')) {
          delete payload.trips_detail;
          res = await sb.from('transactions').insert(payload).select().single();
        }
        data = res.data;
        error = res.error;
      }

      if (error) throw error;

      if (data && data.auction_price === undefined) {
        data.auction_price = auctionPrice;
        data.yard_fee = yardFee;
      }

      showToast(`บันทึกธุรกรรมสำเร็จ! ${tripDetails.length} เที่ยว ยอดเงิน ${formatNumber(totalPrice)} บาท`);
      showReceipt(data);
      await initPurchase();
    }
  } catch (err) {
    showToast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

// ========== PENDING TRANSACTIONS (DUAL STATION MODE) ==========
async function renderPendingTransactions() {
  try {
    const { data: pendingList, error } = await sb.from('pending_transactions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Pending transactions table check skipped:', error);
      return;
    }

    const list = pendingList || [];
    const tbody = document.getElementById('pending-table-body');
    const emptyState = document.getElementById('pending-empty');
    const badgeEl = document.getElementById('pending-badge-count');

    if (badgeEl) {
      if (list.length > 0) {
        badgeEl.textContent = list.length;
        badgeEl.style.display = 'inline-block';
      } else {
        badgeEl.style.display = 'none';
      }
    }

    if (!tbody) return;

    if (list.length === 0) {
      tbody.innerHTML = '';
      emptyState.style.display = 'block';
      tbody.closest('.table-container').style.display = 'none';
    } else {
      emptyState.style.display = 'none';
      tbody.closest('.table-container').style.display = 'block';
      tbody.innerHTML = list.map(p => `
        <tr style="cursor:pointer;" onclick="openPendingDetailModal('${p.id}')">
          <td>${formatDateTime(p.date || p.created_at)}</td>
          <td><span class="badge badge-green">${p.member_code}</span></td>
          <td>
            <strong style="color: #38bdf8; text-decoration: underline;" title="คลิกเพื่อดูรายละเอียด">
              ${p.member_name} 🔍
            </strong>
          </td>
          <td>${formatNumber(p.final_weight || p.net_weight)} กก.</td>
          <td style="font-weight:600; color: var(--gold);">${formatNumber(p.total_price)} ฿</td>
          <td><span class="badge" style="background:rgba(255,255,255,0.08);">${p.created_by_display_name || 'เครื่อง 1'}</span></td>
          <td><span class="badge badge-warning">⏳ รอยืนยัน</span></td>
          <td onclick="event.stopPropagation()">
            <button class="btn btn-info btn-sm" onclick="openPendingDetailModal('${p.id}')">🔍 ดูรายละเอียด</button>
            <button class="btn btn-primary btn-sm" onclick="confirmPendingTransaction('${p.id}')" style="margin-left:4px;">✅ ยืนยัน & พิมพ์</button>
            <button class="btn btn-danger btn-sm" onclick="rejectPendingTransaction('${p.id}')" style="margin-left:4px;">↩️ ตีกลับ</button>
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('renderPendingTransactions error:', err);
  }
}

let currentPendingDetailItem = null;

async function openPendingDetailModal(pendingId) {
  showLoading();
  try {
    const { data: p, error } = await sb.from('pending_transactions').select('*').eq('id', pendingId).single();
    if (error || !p) throw new Error('ไม่พบข้อมูลรายการรอยืนยัน');

    currentPendingDetailItem = p;
    const bodyEl = document.getElementById('pending-detail-body');
    const footerEl = document.getElementById('pending-detail-actions');

    const tripsList = p.trips || [];
    let tripsHtml = '';
    if (tripsList.length > 0) {
      tripsHtml = `
        <div style="margin-top:14px; border-top:1px dashed var(--border); padding-top:10px;">
          <div style="font-weight:600; margin-bottom:8px; font-size:0.9rem;">⚖️ รายละเอียดเที่ยวชั่งน้ำหนัก (${tripsList.length} เที่ยว):</div>
          <table class="data-table" style="font-size:0.85rem;">
            <thead>
              <tr>
                <th>เที่ยวที่</th>
                <th>น้ำหนักชั่งรวม</th>
                <th>หักรถเข็น</th>
                <th>น้ำหนักสุทธิ</th>
              </tr>
            </thead>
            <tbody>
              ${tripsList.map(t => `
                <tr>
                  <td>เที่ยวที่ ${t.trip}</td>
                  <td>${formatNumber(t.gross_weight)} กก.</td>
                  <td>${formatNumber(t.cart_weight)} กก.</td>
                  <td><strong>${formatNumber(t.net_weight)} กก.</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    const deductPct = Number(p.deduction_percent || 0);

    bodyEl.innerHTML = `
      <div style="background:rgba(255,255,255,0.03); padding:16px; border-radius:var(--radius-md); border:1px solid var(--border);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid var(--border); padding-bottom:10px;">
          <div>
            <span class="badge badge-green" style="font-size:0.95rem;">${p.member_code}</span>
            <strong style="font-size:1.15rem; margin-left:8px;">${p.member_name}</strong>
          </div>
          <span class="badge badge-warning" style="font-size:0.85rem;">⏳ รอยืนยัน (จากเครื่อง 1)</span>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:0.9rem;">
          <div><strong>📅 วันเวลาที่ชั่ง:</strong> ${formatDateTime(p.date || p.created_at)}</div>
          <div><strong>👤 ผู้ชั่ง (เครื่อง 1):</strong> ${p.created_by_display_name || 'พนักงานชั่ง'}</div>
          <div><strong>💳 เลขบัญชี:</strong> ${p.member_account_no || 'ไม่มีเลขบัญชี'}</div>
          <div><strong>🍃 ประเภทยาง:</strong> ยางก้อนถ้วย (100%)</div>
        </div>

        ${tripsHtml}

        <div style="margin-top:14px; border-top:1px dashed var(--border); padding-top:10px; display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:0.9rem;">
          <div><strong>น้ำหนักสุทธิรวม:</strong> ${formatNumber(p.net_weight)} กก.</div>
          <div><strong>หักเปอร์เซ็นต์ (${deductPct}%):</strong> -${formatNumber(Number(p.net_weight) - Number(p.final_weight))} กก.</div>
          <div style="grid-column: span 2; font-size:1.05rem; font-weight:600; color:var(--green);">
            ⚖️ น้ำหนักสุทธิหลังหัก: ${formatNumber(p.final_weight)} กก.
          </div>
        </div>

        <div style="margin-top:14px; border-top:1px dashed var(--border); padding-top:10px; display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:0.9rem;">
          <div><strong>ราคาประมูล:</strong> ${formatNumber(p.auction_price !== undefined ? p.auction_price : (Number(p.price_per_kg) + Number(p.yard_fee || 0.5)))} บาท/กก.</div>
          <div><strong>หักค่าบริหารจัดการ:</strong> -${formatNumber(p.yard_fee !== undefined ? p.yard_fee : 0.5)} บาท/กก.</div>
          <div><strong>ราคาสุทธิต่อ กก.:</strong> ${formatNumber(p.price_per_kg)} บาท/กก.</div>
          <div style="font-size:1.25rem; font-weight:700; color:var(--gold);">
            💰 ยอดเงินรวม: ${formatNumber(p.total_price)} บาท
          </div>
        </div>
      </div>
    `;

    footerEl.innerHTML = `
      <button class="btn btn-primary" onclick="confirmPendingTransactionFromModal('${p.id}')">
        ✅ ยืนยัน & พิมพ์ใบเสร็จ
      </button>
      <button class="btn btn-danger" onclick="rejectPendingTransactionFromModal('${p.id}')">
        ↩️ ตีกลับรายการ
      </button>
      <button class="btn btn-secondary" onclick="closePendingDetailModal()">
        ปิด
      </button>
    `;

    document.getElementById('pending-detail-modal').classList.add('show');
  } catch (err) {
    showToast('เปิดดูรายละเอียดไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

function closePendingDetailModal() {
  document.getElementById('pending-detail-modal').classList.remove('show');
}

async function confirmPendingTransactionFromModal(id) {
  closePendingDetailModal();
  await confirmPendingTransaction(id);
}

async function rejectPendingTransactionFromModal(id) {
  closePendingDetailModal();
  await rejectPendingTransaction(id);
}

async function confirmPendingTransaction(pendingId) {
  showLoading();
  try {
    const { data: p, error: fetchErr } = await sb.from('pending_transactions').select('*').eq('id', pendingId).single();
    if (fetchErr || !p) throw new Error('ไม่พบข้อมูลรายการรอยืนยัน');

    const txPayload = {
      member_code: p.member_code,
      member_name: p.member_name,
      member_account_no: p.member_account_no || '',
      rubber_type: p.rubber_type || 'cup',
      gross_weight: p.gross_weight,
      cart_weight: p.cart_weight,
      net_weight: p.net_weight,
      deduction_percent: p.deduction_percent,
      final_weight: p.final_weight,
      auction_price: p.auction_price,
      yard_fee: p.yard_fee,
      price_per_kg: p.price_per_kg,
      total_price: p.total_price,
      trips: p.trips,
      trip_count: p.trip_count,
      round_id: p.round_id,
      truck_number: p.truck_number || '',
      trailer_type: p.trailer_type || 'head',
      created_by_name: p.created_by_display_name || 'ผู้ดูแลระบบ',
      created_by_display_name: p.created_by_display_name || 'ผู้ดูแลระบบ',
      confirmed_by_display_name: currentUser ? currentUser.display_name : 'ผู้ดูแลระบบ',
      date: p.date || new Date().toISOString()
    };

    let { data: newTx, error: txErr } = await sb.from('transactions').insert(txPayload).select().single();

    if (txErr && txErr.message.includes('column')) {
      delete txPayload.auction_price;
      delete txPayload.yard_fee;
      delete txPayload.created_by_display_name;
      delete txPayload.confirmed_by_display_name;
      const res = await sb.from('transactions').insert(txPayload).select().single();
      newTx = res.data;
      txErr = res.error;
    }

    if (txErr) throw txErr;

    // Delete or remove from pending_transactions
    await sb.from('pending_transactions').delete().eq('id', pendingId);

    if (newTx && newTx.auction_price === undefined) {
      newTx.auction_price = p.auction_price;
      newTx.yard_fee = p.yard_fee;
    }
    newTx.created_by_display_name = p.created_by_display_name;
    newTx.confirmed_by_display_name = currentUser ? currentUser.display_name : 'ผู้ดูแลระบบ';

    showToast(`✅ ยืนยันรายการสำเร็จ! ออกใบเสร็จของคุณ${p.member_name}`);
    showReceipt(newTx);
    await renderPendingTransactions();
  } catch (err) {
    showToast('ยืนยันไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

async function rejectPendingTransaction(pendingId) {
  const note = window.prompt('กรุณาระบุเหตุผลที่ตีกลับรายการ (ส่งกลับแก้ไข):', 'ข้อมูลไม่ถูกต้อง');
  if (note === null) return;

  showLoading();
  try {
    const { error } = await sb.from('pending_transactions')
      .update({ status: 'rejected', rejection_note: note })
      .eq('id', pendingId);

    if (error) throw error;
    showToast('↩️ ตีกลับรายการส่งกลับแก้ไขเรียบร้อยแล้ว');
    await renderPendingTransactions();
  } catch (err) {
    showToast('ตีกลับไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

function openWeightWarningModal(warnings, onConfirm) {
  const modal = document.getElementById('weight-warning-modal');
  const listEl = document.getElementById('weight-warning-list');
  const confirmBtn = document.getElementById('weight-warning-confirm-btn');

  if (listEl) {
    listEl.innerHTML = warnings.map(w => `<div style="margin-bottom:8px;">⚠️ ${w}</div>`).join('');
  }

  if (confirmBtn) {
    confirmBtn.onclick = () => {
      closeWeightWarningModal();
      onConfirm();
    };
  }

  if (modal) modal.classList.add('show');
}

function closeWeightWarningModal() {
  const modal = document.getElementById('weight-warning-modal');
  if (modal) modal.classList.remove('show');
}

// ========== RECEIPT (100% IDENTICAL DUAL COPIES ON SINGLE PAGE) ==========
function buildReceiptCopyHTML(tx, plantName) {
  const plantAddress = cachedSettings?.plantation_address || localStorage.getItem('setting_plantation_address') || 'เลขที่ 127 หมู่7 ต.ท่าสะแก อ.ชาติตระการ จ.พิษณุโลก';
  const auctionBuyer = cachedSettings?.auction_buyer || localStorage.getItem('setting_auction_buyer') || 'เฮียต้อม ยางพารา';

  // Format date: e.g. "9 มิ.ย. 69"
  const d = new Date(tx.date || Date.now());
  const monthNamesShort = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const day = d.getDate();
  const month = monthNamesShort[d.getMonth()];
  const yearShort = (d.getFullYear() + 543).toString().substring(2);
  const dateFormattedStr = `${day} ${month} ${yearShort}`;

  // Member Code format: e.g. ก00089 if code is 89
  let memberCodeFormatted = String(tx.member_code || '');
  if (!memberCodeFormatted.startsWith('ก')) {
    memberCodeFormatted = 'ก' + memberCodeFormatted.padStart(5, '0');
  }

  // Sequence No & Queue No
  const sequenceNo = tx.sequence_no || tx.seq_no || tx.queue_no || 1;
  const queueNo = tx.queue_no !== undefined ? tx.queue_no : 0;

  // Trips calculation (8 grid boxes matching paper form)
  let tripsArr = [];
  if (Array.isArray(tx.trips) && tx.trips.length > 0) {
    tripsArr = tx.trips;
  } else if (tx.trip_details && Array.isArray(tx.trip_details)) {
    tripsArr = tx.trip_details;
  } else {
    tripsArr = [{ gross_weight: tx.gross_weight || tx.net_weight, cart_weight: tx.cart_weight || 0, net_weight: tx.net_weight }];
  }

  let tripGridCellsHtml = '';
  const maxBoxes = 8;
  for (let i = 0; i < maxBoxes; i++) {
    const trip = tripsArr[i];
    const val = trip ? (trip.gross_weight || trip.gross || trip.net_weight) : undefined;
    const displayVal = (val !== undefined && Number(val) > 0) ? formatNumber(val) : '-';
    tripGridCellsHtml += `<td style="border:1px solid #000; padding:2px 1px; width:12.5%; text-align:center; font-size:11px;">${displayVal}</td>`;
  }

  const totalGross = tripsArr.reduce((s, t) => s + Number(t.gross_weight || t.gross || t.net_weight || 0), 0);
  const totalCart = tripsArr.reduce((s, t) => s + Number(t.cart_weight || 0), 0);
  const finalNetWeight = Number(tx.final_weight || tx.net_weight || 0);

  const isDual = cachedSettings?.dual_station_mode === true;
  const showPayer = cachedSettings?.show_payer_name !== false;

  let payerName = '..................................';
  if (showPayer) {
    if (isDual) {
      payerName = tx.confirmed_by_display_name || currentUser?.display_name || 'ผู้ดูแลระบบ';
    } else {
      payerName = tx.confirmed_by_display_name || tx.created_by_name || tx.created_by_display_name || currentUser?.display_name || 'ผู้ดูแลระบบ';
    }
  }

  let creatorName = tx.created_by_display_name || tx.created_by_name || 'ผู้ดูแลระบบ';

  return `
    <div class="receipt-single-copy" style="font-family:'Sarabun','TH Sarabun New',sans-serif; color:#000; padding:6px 12px; background:#fff; font-size:11px; line-height:1.3; border:1px solid #000; margin-bottom:4px; box-sizing:border-box;">
      <!-- Header -->
      <div style="text-align:center; margin-bottom:6px; border-bottom:1px solid #000; padding-bottom:4px;">
        <div style="font-size:14px; font-weight:bold; color:#000;">${plantName}</div>
        <div style="font-size:11px; color:#000; margin-top:1px;">${plantAddress}</div>
      </div>

      <!-- Main Form Table -->
      <table style="width:100%; border-collapse:collapse; font-size:11px;">
        <tr>
          <td style="width:130px; font-weight:bold; padding:1px 0;">วันที่ขายยาง</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; text-align:center;">${dateFormattedStr}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:1px 0;">ผู้ประมูล</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; text-align:center;">${auctionBuyer}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:1px 0;">ลำดับที่</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; text-align:center;">${sequenceNo}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:1px 0;">เลขที่บิล/คิว</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; text-align:center;">${queueNo}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:1px 0;">รหัสสมาชิก</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; text-align:center;">${memberCodeFormatted}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:1px 0;">ชื่อสมาชิก</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; text-align:center;">${tx.member_name}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:1px 0;">ชื่อคนกรีด</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; text-align:center;">${tx.member_name}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:2px 0; vertical-align:middle;">น้ำหนักชั่งแต่ละครั้ง</td>
          <td style="padding:2px 0;">
            <table style="width:100%; border-collapse:collapse;">
              <tr>
                ${tripGridCellsHtml}
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:1px 0;">น้ำหนักยางรวมรถ</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; text-align:center;">${formatNumber(totalGross)}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:1px 0;">น้ำหนักรวมรถเข็น</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; text-align:center;">${formatNumber(totalCart)}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:1px 0;">น้ำหนักยางสุทธิ</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; text-align:center;">${formatNumber(finalNetWeight)}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:1px 0;">ราคา / กิโลกรัม</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; text-align:center;">${formatNumber(tx.price_per_kg)}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:2px 0; font-size:12px;">จำนวนเงิน</td>
          <td style="border-bottom:1px solid #000; font-weight:bold; text-align:center; font-size:13px;">${formatNumber(tx.total_price)}</td>
        </tr>
      </table>

      <!-- Signatures Footer -->
      <div style="margin-top:12px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; text-align:center; font-size:10px;">
        <div>
          <div style="border-bottom:1px solid #000; height:16px; font-size:9px; display:flex; align-items:flex-end; justify-content:center;">${creatorName}</div>
          <div style="font-weight:bold; margin-top:1px;">ผู้จัดทำ</div>
        </div>
        <div>
          <div style="border-bottom:1px solid #000; height:16px; font-size:9px; display:flex; align-items:flex-end; justify-content:center;">${payerName}</div>
          <div style="font-weight:bold; margin-top:1px;">ผู้จ่ายเงิน</div>
        </div>
        <div>
          <div style="border-bottom:1px solid #000; height:16px; font-size:9px;"></div>
          <div style="font-weight:bold; margin-top:1px;">ผู้รับเงิน</div>
        </div>
      </div>
    </div>
  `;
}

let currentReceiptTx = null;

function showReceipt(tx) {
  currentReceiptTx = tx;
  renderReceiptContent();
  document.getElementById('receipt-modal').classList.add('show');
}

function renderReceiptContent() {
  if (!currentReceiptTx) return;
  const plantName = cachedSettings?.plantation_name || 'กลุ่มเกษตรกรชาวสวนยาง กยท.ท่าสะแก';
  const copy1 = buildReceiptCopyHTML(currentReceiptTx, plantName);
  const copy2 = buildReceiptCopyHTML(currentReceiptTx, plantName);
  const cutLine = `<div class="receipt-cut-line" style="text-align:center; font-size:9px; margin:3px 0; color:#333; font-weight:bold;">----------------------------------------------------------------------------------------------------</div>`;

  document.getElementById('receipt-content').innerHTML = `
    ${copy1}
    ${cutLine}
    ${copy2}
  `;
}

function closeReceiptModal() {
  document.getElementById('receipt-modal').classList.remove('show');
}

function printReceipt() {
  if (!currentReceiptTx) return;

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showToast('เบราว์เซอร์บล็อกป๊อปอัพ กรุณาอนุญาตป๊อปอัพเพื่อพิมพ์', 'error');
    return;
  }

  const plantName = cachedSettings?.plantation_name || 'กลุ่มเกษตรกรชาวสวนยาง กยท.ท่าสะแก';
  const copy1 = buildReceiptCopyHTML(currentReceiptTx, plantName);
  const copy2 = buildReceiptCopyHTML(currentReceiptTx, plantName);

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>ใบเสร็จรับเงิน - ${currentReceiptTx.member_name}</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 4mm 5mm;
        }
        * {
          box-sizing: border-box;
        }
        html, body {
          width: 100%;
          height: 100%;
          margin: 0;
          padding: 0;
          background: #fff;
          font-family: 'Sarabun', 'TH Sarabun New', sans-serif;
          overflow: hidden;
        }
        .page-container {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          height: 100%;
          max-height: 288mm;
          padding: 1mm;
          box-sizing: border-box;
        }
        .receipt-single-copy {
          height: 48.5%;
          border: 1px solid #000;
          padding: 10px 14px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          box-sizing: border-box;
          background: #fff;
        }
        .receipt-cut-line {
          height: 2%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: bold;
          color: #000;
          letter-spacing: 2px;
          margin: 2px 0;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12.5px;
        }
        td {
          padding: 2.5px 0;
        }
      </style>
    </head>
    <body>
      <div class="page-container">
        ${copy1}
        <div class="receipt-cut-line">----------------------------------------------------------------------------------------------------</div>
        ${copy2}
      </div>
    </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(htmlContent);
  printWindow.document.close();

  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 350);
}

// ========== HISTORY ==========
async function renderHistory() {
  // Populate round filter & member filter
  try {
    const { data: rounds } = await sb.from('purchase_rounds').select('id, title, status').order('created_at', { ascending: false });
    const roundFilter = document.getElementById('history-round-filter');
    const currentRoundVal = roundFilter.value;
    roundFilter.innerHTML = '<option value="">ทุกรอบการรับซื้อ</option>' +
      (rounds || []).map(r => `<option value="${r.id}" ${r.id === currentRoundVal ? 'selected' : ''}>${r.title} (${r.status === 'open' ? 'กำลังเปิด' : 'ปิดแล้ว'})</option>`).join('');

    const { data: members } = await sb.from('members').select('code, name').order('code');
    const memberFilter = document.getElementById('history-member-filter');
    const currentMemberVal = memberFilter.value;
    memberFilter.innerHTML = '<option value="">สมาชิกทั้งหมด</option>' +
      (members || []).map(m => `<option value="${m.code}" ${m.code === currentMemberVal ? 'selected' : ''}>${m.code} - ${m.name}</option>`).join('');
  } catch (err) { /* ignore */ }

  await filterHistory();
}

let currentFilteredHistory = [];

async function filterHistory() {
  showLoading();
  try {
    let query = sb.from('transactions').select('*').order('date', { ascending: false });

    const roundId = document.getElementById('history-round-filter').value;
    const dateFrom = document.getElementById('history-date-from').value;
    const dateTo = document.getElementById('history-date-to').value;
    const memberCode = document.getElementById('history-member-filter').value;

    if (roundId) query = query.eq('round_id', roundId);
    if (dateFrom) query = query.gte('date', dateFrom + 'T00:00:00');
    if (dateTo) query = query.lte('date', dateTo + 'T23:59:59');
    if (memberCode) query = query.eq('member_code', memberCode);

    const { data, error } = await query;
    if (error) throw error;

    const filtered = data || [];
    currentFilteredHistory = filtered;

    const totalCount = filtered.length;
    const totalWeight = filtered.reduce((s, t) => s + Number(t.final_weight || t.net_weight || 0), 0);
    const totalAmount = filtered.reduce((s, t) => s + Number(t.total_price || 0), 0);

    document.getElementById('summary-count').textContent = totalCount;
    document.getElementById('summary-weight').innerHTML = `${formatNumber(totalWeight)} <span class="unit">กก.</span>`;
    document.getElementById('summary-amount').innerHTML = `${formatNumber(totalAmount)} <span class="unit">บาท</span>`;

    // Admin Delete All button visibility
    const deleteAllBtn = document.getElementById('history-delete-all-btn');
    const totalBadge = document.getElementById('history-total-count-badge');
    if (deleteAllBtn) {
      if (currentUser?.role === 'admin' && filtered.length > 0) {
        deleteAllBtn.style.display = 'inline-flex';
        if (totalBadge) totalBadge.textContent = totalCount;
      } else {
        deleteAllBtn.style.display = 'none';
      }
    }

    const tbody = document.getElementById('history-table-body');
    const emptyState = document.getElementById('history-empty');

    // Reset select all checkbox
    const selectAllCb = document.getElementById('history-select-all');
    if (selectAllCb) selectAllCb.checked = false;
    updateHistoryBatchDeleteUI();

    if (filtered.length === 0) {
      tbody.innerHTML = '';
      emptyState.style.display = 'block';
      tbody.closest('.table-container').style.display = 'none';
    } else {
      emptyState.style.display = 'none';
      tbody.closest('.table-container').style.display = 'block';
      tbody.innerHTML = filtered.map(t => `
        <tr>
          <td style="text-align:center;">
            <input type="checkbox" class="history-row-cb" value="${t.id}" onchange="updateHistoryBatchDeleteUI()">
          </td>
          <td>${formatDateTime(t.date)}</td>
          <td><span class="badge badge-green">${t.member_code}</span></td>
          <td>${t.member_name}</td>
          <td>${getRubberTypeBadge(t.rubber_type)}</td>
          <td>${t.trip_count || 1}</td>
          <td>${formatNumber(t.net_weight)} กก.</td>
          <td style="font-weight:600;color:var(--text-accent);">${formatNumber(t.final_weight || t.net_weight)} กก.</td>
          <td>${formatNumber(t.price_per_kg)}</td>
          <td style="font-weight:600;color:var(--gold);">${formatNumber(t.total_price)} ฿</td>
          <td><span class="badge" style="background:rgba(255,255,255,0.08);">${t.created_by_name || 'ผู้ดูแลระบบ'}</span></td>
          <td>
            <button class="btn btn-secondary btn-sm btn-icon" onclick="showReceiptFromHistory('${t.id}')" title="ใบเสร็จ">🧾</button>
            <button class="btn btn-danger btn-sm btn-icon" onclick="confirmDeleteTransaction('${t.id}')" title="ลบ" style="margin-left:4px;">🗑️</button>
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    showToast('โหลดประวัติไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

function toggleSelectAllHistory(isChecked) {
  const checkboxes = document.querySelectorAll('.history-row-cb');
  checkboxes.forEach(cb => cb.checked = isChecked);
  updateHistoryBatchDeleteUI();
}

function deselectAllHistory() {
  const selectAllCb = document.getElementById('history-select-all');
  if (selectAllCb) selectAllCb.checked = false;
  toggleSelectAllHistory(false);
}

function getSelectedHistoryIds() {
  const checkboxes = document.querySelectorAll('.history-row-cb:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

function updateHistoryBatchDeleteUI() {
  const selectedIds = getSelectedHistoryIds();
  const bar = document.getElementById('history-batch-action-bar');
  const countEl = document.getElementById('history-selected-count');
  const btnCountEl = document.getElementById('history-btn-count');

  if (bar) {
    if (selectedIds.length > 0) {
      bar.style.display = 'flex';
      if (countEl) countEl.textContent = selectedIds.length;
      if (btnCountEl) btnCountEl.textContent = selectedIds.length;
    } else {
      bar.style.display = 'none';
    }
  }
}

function confirmDeleteSelectedHistory() {
  const selectedIds = getSelectedHistoryIds();
  if (selectedIds.length === 0) return;

  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-message').innerHTML = `
    <span class="confirm-icon">🗑️</span>
    คุณต้องการ <strong>ลบประวัติธุรกรรมที่เลือกทั้งหมด ${selectedIds.length} รายการ</strong> ใช่หรือไม่?<br>
    <small style="color:var(--danger);">⚠️ การลบนี้จะไม่สามารถกู้คืนกลับมาได้</small>
  `;
  document.getElementById('confirm-action-btn').onclick = () => deleteSelectedHistory(selectedIds);
  modal.classList.add('show');
}

async function deleteSelectedHistory(ids) {
  showLoading();
  try {
    const { error } = await sb.from('transactions').delete().in('id', ids);
    if (error) throw error;

    closeConfirmModal();
    await filterHistory();
    showToast(`ลบธุรกรรมที่เลือกเรียบร้อยแล้ว (${ids.length} รายการ)`);
  } catch (err) {
    showToast('ลบไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

function confirmDeleteAllFilteredHistory() {
  if (currentUser?.role !== 'admin') {
    showToast('เฉพาะแอดมินเท่านั้นที่สามารถลบประวัติทั้งหมดได้', 'error');
    return;
  }

  const count = currentFilteredHistory.length;
  if (count === 0) return;

  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-message').innerHTML = `
    <span class="confirm-icon" style="color:var(--danger);">⚠️</span>
    <strong style="color:var(--danger); font-size:1.1rem;">คำเตือนสำคัญมาก!</strong><br><br>
    คุณกำลังจะ <strong>ลบประวัติธุรกรรมทั้งหมดตามตัวกรองนี้ (${count} รายการ)</strong><br>
    <small style="color:var(--text-muted);">ข้อมูลทั้งหมดจะถูกลบออกจากฐานข้อมูลและไม่สามารถกู้คืนได้</small>
  `;
  document.getElementById('confirm-action-btn').onclick = () => deleteAllFilteredHistory();
  modal.classList.add('show');
}

async function deleteAllFilteredHistory() {
  const ids = currentFilteredHistory.map(t => t.id);
  if (ids.length === 0) return;

  showLoading();
  try {
    const { error } = await sb.from('transactions').delete().in('id', ids);
    if (error) throw error;

    closeConfirmModal();
    await filterHistory();
    showToast(`ลบประวัติทั้งหมดในตัวกรองสำเร็จ (${ids.length} รายการ)`);
  } catch (err) {
    showToast('ลบไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

// ========== TRUCK WEIGHTS (ข้อมูลน้ำหนักรถพ่วง อัตโนมัติ 100%) ==========
function onPurchaseTruckSelect(val) {
  if (val === 'NEW') {
    const name = window.prompt('กรุณากรอกชื่อหรือหมายเลขรถคันใหม่ (เช่น คันที่ 4 หรือ ทะเบียน 82-1234):', 'คันที่ 4');
    const selectEl = document.getElementById('purchase-truck-number');
    if (name && name.trim() && selectEl) {
      const trimmed = name.trim();
      const newOpt = document.createElement('option');
      newOpt.value = trimmed;
      newOpt.textContent = trimmed;
      newOpt.selected = true;
      selectEl.insertBefore(newOpt, selectEl.lastElementChild);
    } else if (selectEl) {
      selectEl.value = '';
    }
  }
}

let currentTruckWeightsRoundId = null;

async function renderTruckWeights(targetRoundId = null) {
  await loadCurrentRound();
  
  const titleEl = document.getElementById('tw-round-title');
  const tbody = document.getElementById('tw-table-body');
  const emptyState = document.getElementById('tw-empty-state');
  const filterEl = document.getElementById('tw-round-filter');

  showLoading();
  try {
    // 1. Load round options into dropdown
    const { data: rounds } = await sb.from('purchase_rounds').select('*').order('created_at', { ascending: false });
    const roundsList = rounds || [];

    let selectedRoundId = targetRoundId;
    if (!selectedRoundId && filterEl && filterEl.value) {
      selectedRoundId = filterEl.value;
    }

    if (filterEl) {
      filterEl.innerHTML = `
        ${roundsList.map(r => `<option value="${r.id}">${r.status === 'active' ? '🟢 (กำลังเปิด) ' : '🔒 (ปิดรอบแล้ว) '} ${r.title}</option>`).join('')}
        <option value="all">📦 ทุกรอบส่งมอบยาง (รวมทั้งหมด)</option>
      `;

      if (selectedRoundId) {
        filterEl.value = selectedRoundId;
      } else if (currentRound) {
        filterEl.value = currentRound.id;
      } else if (roundsList.length > 0) {
        filterEl.value = roundsList[0].id;
      }
      selectedRoundId = filterEl.value;
    }

    currentTruckWeightsRoundId = selectedRoundId;

    // 2. Fetch the target round details
    let activeRoundObj = null;
    if (selectedRoundId && selectedRoundId !== 'all') {
      activeRoundObj = (roundsList || []).find(r => String(r.id) === String(selectedRoundId));
    }

    if (titleEl) {
      if (activeRoundObj) {
        const statusTag = activeRoundObj.status === 'active' ? '🟢 กำลังเปิดรับซื้อ' : '🔒 ปิดรอบส่งมอบแล้ว';
        titleEl.innerHTML = `⚡ ข้อมูลน้ำหนักรถพ่วงประจำรอบ — <strong>${activeRoundObj.title}</strong> <small style="font-size:0.85rem; font-weight:normal; opacity:0.9;">(${statusTag})</small>`;
      } else {
        titleEl.textContent = '⚡ ข้อมูลน้ำหนักรถพ่วง — สรุปรวมทุกรอบส่งมอบยาง';
      }
    }

    // 3. Query all transactions for selected round or all
    let query = sb.from('transactions').select('*');
    if (selectedRoundId && selectedRoundId !== 'all') {
      query = query.eq('round_id', selectedRoundId);
    }
    const { data: roundTx, error: txErr } = await query;

    if (txErr) throw txErr;

    const txArr = roundTx || [];
    const totalPurchasedWeight = txArr.reduce((s, t) => s + Number(t.final_weight || t.net_weight || 0), 0);
    const totalPurchasedAmount = txArr.reduce((s, t) => s + Number(t.total_price || 0), 0);

    // Group transactions by truck_number
    const truckGroups = {};
    let unassignedWeight = 0;

    txArr.forEach(t => {
      const wt = Number(t.final_weight || t.net_weight || 0);
      const truckNum = (t.truck_number || '').trim();
      if (!truckNum || truckNum === '-- ไม่ระบุ --') {
        unassignedWeight += wt;
      } else {
        if (!truckGroups[truckNum]) {
          truckGroups[truckNum] = {
            truck_number: truckNum,
            head_weight: 0,
            trailer_weight: 0,
            total_weight: 0,
            tx_count: 0,
            members: new Set(),
            tx_list: []
          };
        }
        const grp = truckGroups[truckNum];
        const trailer = t.trailer_type || 'head';
        if (trailer === 'trailer') {
          grp.trailer_weight += wt;
        } else {
          grp.head_weight += wt;
        }
        grp.total_weight += wt;
        grp.tx_count += 1;
        grp.members.add(t.member_name);
        grp.tx_list.push(t);
      }
    });

    const truckList = Object.values(truckGroups).sort((a, b) => a.truck_number.localeCompare(b.truck_number));
    const sumHeadWeight = truckList.reduce((s, t) => s + t.head_weight, 0);
    const sumTrailerWeight = truckList.reduce((s, t) => s + t.trailer_weight, 0);
    const sumTotalTruckWeight = truckList.reduce((s, t) => s + t.total_weight, 0);
    const discrepancy = unassignedWeight;

    // Update summary metrics
    const totalPurchasedEl = document.getElementById('tw-total-purchased');
    const totalAmountEl = document.getElementById('tw-total-amount');
    const totalTrucksEl = document.getElementById('tw-total-trucks');
    const truckBreakdownEl = document.getElementById('tw-truck-breakdown');

    if (totalPurchasedEl) totalPurchasedEl.textContent = `${formatNumber(totalPurchasedWeight)} กก.`;
    if (totalAmountEl) totalAmountEl.textContent = `${formatNumber(totalPurchasedAmount)} บาท`;

    if (totalTrucksEl) totalTrucksEl.textContent = `${formatNumber(sumTotalTruckWeight)} กก.`;
    if (truckBreakdownEl) truckBreakdownEl.textContent = `ตัวแม่: ${formatNumber(sumHeadWeight)} | ตัวลูก: ${formatNumber(sumTrailerWeight)}`;

    const discrepancyBadge = document.getElementById('tw-discrepancy-badge');
    const discrepancyText = document.getElementById('tw-discrepancy-text');
    const discrepancyWeight = document.getElementById('tw-discrepancy-weight');
    const discrepancySubtext = document.getElementById('tw-discrepancy-subtext');

    if (Math.abs(discrepancy) < 0.01) {
      if (discrepancyBadge) discrepancyBadge.innerHTML = '<span class="badge badge-green">🟢 ยอดตรงกัน 100%</span>';
      if (discrepancyText) discrepancyText.textContent = 'ยางรับซื้อจากสมาชิกจัดขึ้นรถพ่วงครบถ้วนแล้วทุกรายการ';
      if (discrepancyWeight) { discrepancyWeight.textContent = '0.00 กก.'; discrepancyWeight.style.color = 'var(--green)'; }
      if (discrepancySubtext) discrepancySubtext.textContent = 'ไม่มีคงเหลือในลาน';
    } else {
      if (discrepancyBadge) discrepancyBadge.innerHTML = '<span class="badge badge-warning">🟡 ยางคงเหลือในลาน</span>';
      if (discrepancyText) discrepancyText.innerHTML = `ยางรับซื้อคงเหลือในลานยังไม่ได้ติดป้ายขึ้นรถอีก <strong>${formatNumber(discrepancy)} กก.</strong>`;
      if (discrepancyWeight) { discrepancyWeight.textContent = `${formatNumber(discrepancy)} กก.`; discrepancyWeight.style.color = 'var(--warning)'; }
      if (discrepancySubtext) discrepancySubtext.textContent = 'ยางที่ชั่งแล้วแต่ยังไม่ระบุรถ';
    }

    // Populate table
    if (truckList.length === 0) {
      if (tbody) tbody.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      if (tbody) tbody.closest('.table-container').style.display = 'none';
    } else {
      if (emptyState) emptyState.style.display = 'none';
      if (tbody) tbody.closest('.table-container').style.display = 'block';
      if (tbody) {
        tbody.innerHTML = truckList.map(t => `
          <tr>
            <td><strong style="color:var(--gold); font-size:1rem;">🚛 ${t.truck_number}</strong></td>
            <td>${formatNumber(t.head_weight)} กก.</td>
            <td>${formatNumber(t.trailer_weight)} กก.</td>
            <td style="font-weight:700; color:var(--green); font-size:1rem;">${formatNumber(t.total_weight)} กก.</td>
            <td><span class="badge badge-info">${t.tx_count} เที่ยว (${t.members.size} ราย)</span></td>
            <td>
              <button class="btn btn-secondary btn-sm" onclick="showTruckMembersModal('${t.truck_number}')">🔍 ดูรายชื่อสมาชิกในรถคันนี้</button>
            </td>
          </tr>
        `).join('');
      }
    }
  } catch (err) {
    showToast('โหลดข้อมูลน้ำหนักรถพ่วงไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

function showTruckMembersModal(truckNum) {
  showLoading();
  let query = sb.from('transactions').select('*').eq('truck_number', truckNum).order('date', { ascending: false });
  if (currentTruckWeightsRoundId && currentTruckWeightsRoundId !== 'all') {
    query = query.eq('round_id', currentTruckWeightsRoundId);
  }

  query.then(({ data, error }) => {
    hideLoading();
    if (error) { showToast('โหลดข้อมูลไม่สำเร็จ: ' + error.message, 'error'); return; }
    
    const list = data || [];
    const modal = document.getElementById('truck-members-modal');
    const title = document.getElementById('truck-members-modal-title');
    const body = document.getElementById('truck-members-modal-body');

    if (title) title.textContent = `🚛 รายการสมาชิกใน ${truckNum} (รวม ${list.length} รายการ)`;
    
    if (body) {
      body.innerHTML = `
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>วันเวลา</th>
                <th>รหัสสมาชิก</th>
                <th>ชื่อสมาชิก</th>
                <th>ลักษณะพ่วง</th>
                <th>น้ำหนักสุทธิ</th>
                <th>ผู้บันทึก/ผู้ชั่ง</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(t => `
                <tr>
                  <td>${formatDateTime(t.date)}</td>
                  <td><span class="badge badge-green">${t.member_code}</span></td>
                  <td><strong>${t.member_name}</strong></td>
                  <td>
                    ${t.trailer_type === 'trailer' 
                      ? '<span class="badge badge-warning" style="font-size:0.8rem;">🚚 ตัวลูก</span>' 
                      : '<span class="badge badge-info" style="font-size:0.8rem;">🚛 ตัวแม่</span>'}
                  </td>
                  <td style="font-weight:700; color:var(--gold); font-size:0.95rem;">${formatNumber(t.final_weight || t.net_weight)} กก.</td>
                  <td>${t.created_by_name || 'ผู้ดูแลระบบ'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
    if (modal) modal.classList.add('show');
  });
}

function closeTruckMembersModal() {
  const modal = document.getElementById('truck-members-modal');
  if (modal) modal.classList.remove('show');
}

function closeEditTruckDeliveryModal() {
  const modal = document.getElementById('edit-truck-delivery-modal');
  if (modal) modal.classList.remove('show');
}

function saveEditTruckDelivery() {
  showToast('ระบบรวบรวมน้ำหนักรถพ่วงแบบคำนวณให้อัตโนมัติ 100% จากใบเสร็จรับซื้อของสมาชิกแล้วครับ');
  closeEditTruckDeliveryModal();
}

function closeTruckDetailModal() {
  const modal = document.getElementById('truck-detail-modal');
  if (modal) modal.classList.remove('show');
}

async function printTruckWeightsReport() {
  showLoading();
  try {
    let roundObj = currentRound;
    if (!roundObj) {
      try {
        const { data: rData } = await sb.from('purchase_rounds').select('*').order('created_at', { ascending: false }).limit(1);
        if (rData && rData.length > 0) roundObj = rData[0];
      } catch (e) { /* ignore */ }
    }
    if (!roundObj) {
      roundObj = { id: 'all', title: 'รอบส่งมอบยางประจำวัน', start_date: new Date().toISOString() };
    }

    const plantName = cachedSettings?.plantation_name || 'กลุ่มเกษตรกรชาวสวนยาง กยท.ท่าสะแก';

    // 1. Query purchased totals from member transactions
    let query = sb.from('transactions').select('*');
    if (roundObj.id && roundObj.id !== 'all') {
      query = query.eq('round_id', roundObj.id);
    }
    const { data: roundTx } = await query;

    const txArr = roundTx || [];
    const totalPurchasedWeight = txArr.reduce((s, t) => s + Number(t.final_weight || t.net_weight || 0), 0);
    const totalPurchasedAmount = txArr.reduce((s, t) => s + Number(t.total_price || 0), 0);

    // Group transactions by truck_number
    const truckGroups = {};
    let unassignedWeight = 0;

    txArr.forEach(t => {
      const wt = Number(t.final_weight || t.net_weight || 0);
      const truckNum = (t.truck_number || '').trim();
      if (!truckNum || truckNum === '-- ไม่ระบุ --') {
        unassignedWeight += wt;
      } else {
        if (!truckGroups[truckNum]) {
          truckGroups[truckNum] = {
            truck_number: truckNum,
            head_weight: 0,
            trailer_weight: 0,
            total_weight: 0,
            tx_count: 0
          };
        }
        const grp = truckGroups[truckNum];
        if (t.trailer_type === 'trailer') {
          grp.trailer_weight += wt;
        } else {
          grp.head_weight += wt;
        }
        grp.total_weight += wt;
        grp.tx_count += 1;
      }
    });

    const truckList = Object.values(truckGroups).sort((a, b) => a.truck_number.localeCompare(b.truck_number));
    const sumHeadWeight = truckList.reduce((s, t) => s + t.head_weight, 0);
    const sumTrailerWeight = truckList.reduce((s, t) => s + t.trailer_weight, 0);
    const sumTotalTruckWeight = truckList.reduce((s, t) => s + t.total_weight, 0);
    const discrepancy = unassignedWeight;

    // 2. Resolve President name for dynamic signature
    let presidentName = '';
    try {
      const { data: users } = await sb.from('app_users').select('display_name, position').order('created_at');
      if (users && users.length > 0) {
        const presUser = users.find(u => u.position && u.position.includes('ประธาน'));
        presidentName = presUser ? presUser.display_name : users[0].display_name;
      }
    } catch (e) { /* ignore */ }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showToast('เบราว์เซอร์บล็อกป๊อปอัพ กรุณาอนุญาตป๊อปอัพเพื่อพิมพ์', 'error');
      hideLoading();
      return;
    }

    const printDateStr = formatDateTime(new Date());

    let discrepancyStatusText = 'ตรงกันพอดี 100%';
    if (discrepancy > 0) {
      discrepancyStatusText = `ยางรับซื้อคงเหลือในลาน ${formatNumber(discrepancy)} กก.`;
    }

    const tableRowsHtml = truckList.length === 0
      ? `<tr><td colspan="6" style="text-align:center; padding:15px; color:#666;">ยังไม่มีการติดป้ายรถพ่วงให้รายการรับซื้อในรอบนี้</td></tr>`
      : truckList.map((t, idx) => `
          <tr>
            <td style="text-align:center;">${idx + 1}</td>
            <td><strong>${t.truck_number}</strong></td>
            <td style="text-align:right;">${formatNumber(t.head_weight)} กก.</td>
            <td style="text-align:right;">${formatNumber(t.trailer_weight)} กก.</td>
            <td style="text-align:right; font-weight:bold;">${formatNumber(t.total_weight)} กก.</td>
            <td style="text-align:center;">${t.tx_count} รายการ</td>
          </tr>
        `).join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="th">
      <head>
        <meta charset="UTF-8">
        <title>เอกสารสรุปน้ำหนักรถพ่วง - ${roundObj.title}</title>
        <style>
          @page { size: A4 portrait; margin: 15mm; }
          body {
            font-family: 'Sarabun', 'TH Sarabun New', sans-serif;
            font-size: 14px;
            color: #000;
            margin: 0;
            padding: 0;
            background: #fff;
          }
          .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 10px; }
          .header h2 { margin: 0 0 5px 0; font-size: 20px; }
          .header h3 { margin: 0 0 5px 0; font-size: 16px; font-weight: normal; }
          .header p { margin: 0; font-size: 13px; color: #333; }

          .summary-box {
            border: 1px solid #000;
            padding: 12px 16px;
            margin-bottom: 20px;
            border-radius: 4px;
            background: #fafafa;
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 10px;
            font-size: 13px;
          }
          .summary-box div { line-height: 1.6; }

          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px; }
          th, td { border: 1px solid #000; padding: 8px 10px; }
          th { background-color: #f0f0f0; text-align: center; font-weight: bold; }
          tr.total-row td { font-weight: bold; background-color: #f9f9f9; }

          .signatures {
            margin-top: 40px;
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 15px;
            text-align: center;
            page-break-inside: avoid;
          }
          .sig-box { border: 1px solid #ccc; padding: 15px 10px; border-radius: 4px; }
          .sig-line { margin-top: 35px; border-bottom: 1px dotted #000; display: inline-block; width: 80%; }
          .sig-name { margin-top: 6px; font-size: 12px; }
          .sig-role { font-size: 12px; font-weight: bold; margin-bottom: 4px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>${plantName}</h2>
          <h3>เอกสารสรุปน้ำหนักจัดส่งมอบยางขึ้นรถพ่วง</h3>
          <p><strong>รอบส่งมอบยาง:</strong> ${roundObj.title} | <strong>วันที่พิมพ์:</strong> ${printDateStr}</p>
        </div>

        <div class="summary-box">
          <div>
            <strong>ยอดรับซื้อรวมจากสมาชิก:</strong><br>
            ${formatNumber(totalPurchasedWeight)} กก. (${formatNumber(totalPurchasedAmount)} บาท)
          </div>
          <div>
            <strong>ยอดจัดขึ้นรถพ่วงรวมทุกคัน:</strong><br>
            ${formatNumber(sumTotalTruckWeight)} กก. (ตัวแม่: ${formatNumber(sumHeadWeight)} | ตัวลูก: ${formatNumber(sumTrailerWeight)})
          </div>
          <div>
            <strong>ผลต่างยาง (คงเหลือในลาน):</strong><br>
            ${formatNumber(Math.abs(discrepancy))} กก. (${discrepancyStatusText})
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width:40px;">#</th>
              <th>รถคันที่ / ทะเบียนรถ</th>
              <th style="width:120px;">พ่วงตัวแม่</th>
              <th style="width:120px;">พ่วงตัวลูก</th>
              <th style="width:130px;">รวมทั้งคัน</th>
              <th style="width:110px;">จำนวนรายการ</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
            <tr class="total-row">
              <td colspan="2" style="text-align:center;">รวมทั้งสิ้น (ทุกคันในรอบ)</td>
              <td style="text-align:right;">${formatNumber(sumHeadWeight)} กก.</td>
              <td style="text-align:right;">${formatNumber(sumTrailerWeight)} กก.</td>
              <td style="text-align:right;">${formatNumber(sumTotalTruckWeight)} กก.</td>
              <td style="text-align:center;">-</td>
            </tr>
          </tbody>
        </table>

        <div class="signatures">
          <div class="sig-box">
            <div class="sig-role">ผู้จัดทำเอกสาร / พนักงานชั่ง</div>
            <div class="sig-line"></div>
            <div class="sig-name">(${currentUser ? currentUser.display_name : '..................................'})</div>
          </div>
          <div class="sig-box">
            <div class="sig-role">พนักงานขับรถ / ผู้รับมอบ</div>
            <div class="sig-line"></div>
            <div class="sig-name">(..................................)</div>
          </div>
          <div class="sig-box">
            <div class="sig-role">ประธานกรรมการ</div>
            <div class="sig-line"></div>
            <div class="sig-name">(${presidentName || '..................................'})</div>
          </div>
        </div>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();

    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 400);

  } catch (err) {
    showToast('สร้างเอกสารพิมพ์ไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

function clearHistoryFilter() {
  document.getElementById('history-round-filter').value = '';
  document.getElementById('history-date-from').value = '';
  document.getElementById('history-date-to').value = '';
  document.getElementById('history-member-filter').value = '';
  filterHistory();
}

async function showReceiptFromHistory(txId) {
  try {
    const { data } = await sb.from('transactions').select('*').eq('id', txId).single();
    if (data) showReceipt(data);
  } catch (err) {
    showToast('โหลดใบเสร็จไม่สำเร็จ', 'error');
  }
}

function confirmDeleteTransaction(id) {
  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-message').innerHTML = `
    <span class="confirm-icon">⚠️</span>
    ต้องการลบธุรกรรมนี้ใช่หรือไม่?<br>
    <span style="font-size:0.85rem;color:var(--text-muted);">การลบจะไม่สามารถกู้คืนได้</span>
  `;
  document.getElementById('confirm-action-btn').onclick = () => deleteTransaction(id);
  modal.classList.add('show');
}

async function deleteTransaction(id) {
  if (!id) return;
  showLoading();
  try {
    const { data, error } = await sb.from('transactions').delete().eq('id', id).select();
    if (error) throw error;

    if (!data || data.length === 0) {
      throw new Error('ไม่สามารถลบธุรกรรมได้ ข้อมูลไม่ถูกลบออกจากฐานข้อมูล (กรุณาเช็ค RLS Policy)');
    }

    closeConfirmModal();
    await filterHistory();
    showToast('ลบธุรกรรมสำเร็จ!');
  } catch (err) {
    showToast('ลบไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

// ========== PROFILE MANAGEMENT ==========
function renderProfile() {
  if (!currentUser) return;
  document.getElementById('profile-username').value = currentUser.username;
  document.getElementById('profile-role').value = currentUser.role === 'admin' ? 'แอดมิน (Admin)' : 'ผู้ใช้งานทั่วไป (User)';
  document.getElementById('profile-display-name').value = currentUser.display_name || '';

  document.getElementById('profile-old-password').value = '';
  document.getElementById('profile-new-password').value = '';
  document.getElementById('profile-confirm-password').value = '';
}

async function saveProfileName() {
  const newName = document.getElementById('profile-display-name').value.trim();
  if (!newName) {
    showToast('กรุณากรอกชื่อที่แสดง', 'error');
    return;
  }

  showLoading();
  try {
    const { error } = await sb.from('app_users').update({
      display_name: newName
    }).eq('id', currentUser.id);

    if (error) throw error;

    currentUser.display_name = newName;
    sessionStorage.setItem('rb_user', JSON.stringify(currentUser));
    updateUserSidebarUI();

    showToast('อัปเดตชื่อที่แสดงสำเร็จ!');
  } catch (err) {
    showToast('ไม่สามารถอัปเดตโปรไฟล์ได้: ' + err.message, 'error');
  }
  hideLoading();
}

async function changeMyPassword() {
  const oldPass = document.getElementById('profile-old-password').value;
  const newPass = document.getElementById('profile-new-password').value;
  const confirmPass = document.getElementById('profile-confirm-password').value;

  if (!oldPass || !newPass || !confirmPass) {
    showToast('กรุณากรอกข้อมูลรหัสผ่านให้ครบทุกช่อง', 'error');
    return;
  }

  if (newPass !== confirmPass) {
    showToast('รหัสผ่านใหม่กับยืนยันรหัสผ่านไม่ตรงกัน', 'error');
    return;
  }

  showLoading();
  try {
    const hashedOld = await hashPassword(oldPass);
    const hashedNew = await hashPassword(newPass);

    // Verify old password
    const { data: userCheck } = await sb.from('app_users')
      .select('password')
      .eq('id', currentUser.id)
      .single();

    if (!userCheck || (userCheck.password !== hashedOld && userCheck.password !== oldPass)) {
      showToast('รหัสผ่านเดิมไม่ถูกต้อง', 'error');
      hideLoading();
      return;
    }

    // Update password with SHA-256 hash
    const { error } = await sb.from('app_users').update({
      password: hashedNew
    }).eq('id', currentUser.id);

    if (error) throw error;

    showToast('เปลี่ยนรหัสผ่านส่วนตัวสำเร็จ!');
    document.getElementById('profile-old-password').value = '';
    document.getElementById('profile-new-password').value = '';
    document.getElementById('profile-confirm-password').value = '';
  } catch (err) {
    showToast('เปลี่ยนรหัสผ่านไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

// ========== USER MANAGEMENT (ADMIN ONLY) ==========
async function renderUsers() {
  if (currentUser?.role !== 'admin') return;

  showLoading();
  try {
    const { data: users, error } = await sb.from('app_users').select('*').order('created_at');
    if (error) throw error;

    const list = users || [];
    const tbody = document.getElementById('users-table-body');
    const emptyState = document.getElementById('users-empty');

    if (list.length === 0) {
      tbody.innerHTML = '';
      emptyState.style.display = 'block';
      tbody.closest('.table-container').style.display = 'none';
    } else {
      emptyState.style.display = 'none';
      tbody.closest('.table-container').style.display = 'block';
      tbody.innerHTML = list.map(u => `
        <tr>
          <td><strong>${u.username}</strong></td>
          <td>${u.display_name}</td>
          <td><span class="badge" style="background:rgba(255,255,255,0.08);">${u.position || '-'}</span></td>
          <td>
            ${u.role === 'admin' 
              ? '<span class="badge badge-admin">แอดมิน (Admin)</span>' 
              : '<span class="badge badge-user">พนักงาน (User)</span>'}
          </td>
          <td>${formatDate(u.created_at)}</td>
          <td>
            <button class="btn btn-secondary btn-sm btn-icon" onclick="openUserModal('${u.id}')" title="แก้ไข">✏️</button>
            ${u.id !== currentUser.id 
              ? `<button class="btn btn-danger btn-sm btn-icon" onclick="confirmDeleteUser('${u.id}')" title="ลบ" style="margin-left:4px;">🗑️</button>` 
              : ''}
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    showToast('โหลดรายชื่อผู้ใช้ไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

async function openUserModal(id = null) {
  const modal = document.getElementById('user-modal');
  const titleEl = document.getElementById('user-modal-title');
  const usernameInput = document.getElementById('user-username');
  const nameInput = document.getElementById('user-display-name');
  const posInput = document.getElementById('user-position');
  const passInput = document.getElementById('user-password');
  const roleInput = document.getElementById('user-role');
  const hiddenId = document.getElementById('user-id-hidden');

  if (id) {
    const { data: u } = await sb.from('app_users').select('*').eq('id', id).single();
    if (!u) return;
    titleEl.textContent = 'แก้ไขข้อมูลผู้ใช้งาน';
    hiddenId.value = u.id;
    usernameInput.value = u.username;
    usernameInput.disabled = true;
    nameInput.value = u.display_name;
    if (posInput) posInput.value = u.position || '';
    passInput.value = ''; // Leave password blank unless updating
    passInput.placeholder = 'กรอกรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)';
    roleInput.value = u.role;
  } else {
    titleEl.textContent = 'เพิ่มผู้ใช้งานใหม่';
    hiddenId.value = '';
    usernameInput.value = '';
    usernameInput.disabled = false;
    nameInput.value = '';
    if (posInput) posInput.value = '';
    passInput.value = '';
    passInput.placeholder = 'กรอกรหัสผ่าน';
    roleInput.value = 'user';
  }

  modal.classList.add('show');
  usernameInput.focus();
}

function closeUserModal() {
  document.getElementById('user-modal').classList.remove('show');
}

async function saveUser() {
  const hiddenId = document.getElementById('user-id-hidden').value;
  const username = document.getElementById('user-username').value.trim();
  const display_name = document.getElementById('user-display-name').value.trim();
  const position = document.getElementById('user-position')?.value.trim() || '';
  const password = document.getElementById('user-password').value;
  const role = document.getElementById('user-role').value;

  if (!username) { showToast('กรุณากรอกชื่อผู้ใช้ (Username)', 'error'); return; }
  if (!display_name) { showToast('กรุณากรอกชื่อที่แสดง', 'error'); return; }
  if (!hiddenId && !password) { showToast('กรุณากรอกรหัสผ่าน', 'error'); return; }

  showLoading();
  try {
    if (hiddenId) {
      const updatePayload = { display_name, position, role };
      if (password) {
        updatePayload.password = await hashPassword(password);
      }

      let { data, error } = await sb.from('app_users').update(updatePayload).eq('id', hiddenId).select();

      // If position column does not exist yet in Supabase PostgreSQL schema
      if (error && error.message && error.message.includes('position')) {
        throw new Error('คอลัมน์ "position" ยังไม่มีในตาราง app_users — กรุณารัน SQL เพิ่มคอลัมน์ใน Supabase SQL Editorก่อน:\nALTER TABLE app_users ADD COLUMN IF NOT EXISTS position text DEFAULT \'\';');
      }

      if (error) throw error;

      if (!data || data.length === 0) {
        throw new Error('ไม่สามารถบันทึกผู้ใช้ได้ (0 แถวถูกอัปเดต) — กรุณาตรวจสอบ RLS Policy ของตาราง app_users');
      }

      showToast('แก้ไขผู้ใช้งานสำเร็จ!');
    } else {
      const hashedPass = await hashPassword(password);
      const insertPayload = { username, display_name, position, password: hashedPass, role };

      let { data, error } = await sb.from('app_users').insert(insertPayload).select();

      // If position column does not exist yet in Supabase PostgreSQL schema
      if (error && error.message && error.message.includes('position')) {
        throw new Error('คอลัมน์ "position" ยังไม่มีในตาราง app_users — กรุณารัน SQL เพิ่มคอลัมน์ใน Supabase SQL Editorก่อน:\nALTER TABLE app_users ADD COLUMN IF NOT EXISTS position text DEFAULT \'\';');
      }

      if (error) throw error;

      if (!data || data.length === 0) {
        throw new Error('ไม่สามารถเพิ่มผู้ใช้ใหม่ได้ — กรุณาตรวจสอบ RLS Policy ของตาราง app_users');
      }

      showToast('เพิ่มผู้ใช้งานใหม่สำเร็จ!');
    }
    closeUserModal();
    await renderUsers();
  } catch (err) {
    showToast('บันทึกผู้ใช้ไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

function confirmDeleteUser(id) {
  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-message').innerHTML = `
    <span class="confirm-icon">⚠️</span>
    ต้องการลบบัญชีผู้ใช้งานนี้ใช่หรือไม่?
  `;
  document.getElementById('confirm-action-btn').onclick = () => deleteUser(id);
  modal.classList.add('show');
}

async function deleteUser(id) {
  if (!id) return;
  if (currentUser && id === currentUser.id) {
    showToast('ไม่สามารถลบบัญชีของตัวเองได้', 'error');
    return;
  }

  showLoading();
  try {
    const { data, error } = await sb.from('app_users').delete().eq('id', id).select();
    if (error) throw error;

    if (!data || data.length === 0) {
      throw new Error('ไม่สามารถลบผู้ใช้งานได้ ข้อมูลไม่ถูกลบออกจากฐานข้อมูล (กรุณาเช็ค RLS Policy)');
    }

    closeConfirmModal();
    await renderUsers();
    showToast('ลบผู้ใช้งานออกจากระบบเรียบร้อยแล้ว!');
  } catch (err) {
    showToast('ลบผู้ใช้ไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

// ========== SETTINGS ==========
async function renderSettings() {
  if (!cachedSettings) await loadSettings();
  const s = cachedSettings;

  const plantNameEl = document.getElementById('setting-plantation-name');
  if (plantNameEl) plantNameEl.value = s?.plantation_name || '';

  const plantAddrEl = document.getElementById('setting-plantation-address');
  if (plantAddrEl) plantAddrEl.value = s?.plantation_address || localStorage.getItem('setting_plantation_address') || 'เลขที่ 127 หมู่7 ต.ท่าสะแก อ.ชาติตระการ จ.พิษณุโลก';

  const buyerEl = document.getElementById('setting-auction-buyer');
  if (buyerEl) buyerEl.value = s?.auction_buyer || localStorage.getItem('setting_auction_buyer') || 'เฮียต้อม ยางพารา';

  const priceCupEl = document.getElementById('setting-price-cup');
  if (priceCupEl) priceCupEl.value = s?.price_cup || '';

  const yardFeeEl = document.getElementById('setting-yard-fee');
  if (yardFeeEl) yardFeeEl.value = s?.yard_fee !== undefined ? s.yard_fee : '0.50';

  const cartWeightEl = document.getElementById('setting-cart-weight');
  if (cartWeightEl) cartWeightEl.value = s?.default_cart_weight || '';

  const deductPctEl = document.getElementById('setting-deduction-percent');
  if (deductPctEl) deductPctEl.value = s?.deduction_percent || '';

  const dualModeEl = document.getElementById('setting-dual-station-mode');
  if (dualModeEl) dualModeEl.checked = s?.dual_station_mode === true;

  const showPayerEl = document.getElementById('setting-show-payer-name');
  if (showPayerEl) showPayerEl.checked = s?.show_payer_name !== false;

  updatePlantationLogo();
}

async function saveSettings() {
  const plantationName = document.getElementById('setting-plantation-name')?.value?.trim() || 'กลุ่มเกษตรกรชาวสวนยาง กยท.ท่าสะแก';
  const plantationAddress = document.getElementById('setting-plantation-address')?.value?.trim() || 'เลขที่ 127 หมู่7 ต.ท่าสะแก อ.ชาติตระการ จ.พิษณุโลก';
  const auctionBuyer = document.getElementById('setting-auction-buyer')?.value?.trim() || 'เฮียต้อม ยางพารา';

  const priceCup = parseFloat(document.getElementById('setting-price-cup')?.value) || 0;
  const yardFeeVal = parseFloat(document.getElementById('setting-yard-fee')?.value) ?? 0.50;
  const cartWeightVal = parseFloat(document.getElementById('setting-cart-weight')?.value) || 0;
  const deductionPercentVal = parseFloat(document.getElementById('setting-deduction-percent')?.value) || 0;
  const dualStationMode = document.getElementById('setting-dual-station-mode')?.checked || false;
  const showPayerName = document.getElementById('setting-show-payer-name')?.checked !== false;

  const logoVal = currentCustomLogoBase64 !== null ? currentCustomLogoBase64 : (cachedSettings?.plantation_logo || localStorage.getItem('setting_plantation_logo') || '');

  // 1. Save preferences to localStorage FIRST
  localStorage.setItem('setting_dual_station_mode', String(dualStationMode));
  localStorage.setItem('setting_show_payer_name', String(showPayerName));
  localStorage.setItem('setting_yard_fee', String(yardFeeVal));
  localStorage.setItem('setting_plantation_address', plantationAddress);
  localStorage.setItem('setting_auction_buyer', auctionBuyer);
  if (logoVal) {
    localStorage.setItem('setting_plantation_logo', logoVal);
  } else {
    localStorage.removeItem('setting_plantation_logo');
  }

  // Update in-memory cachedSettings immediately
  cachedSettings = {
    ...(cachedSettings || {}),
    plantation_name: plantationName,
    plantation_address: plantationAddress,
    auction_buyer: auctionBuyer,
    plantation_logo: logoVal,
    price_cup: priceCup,
    price_sheet: priceCup,
    price_latex: priceCup,
    yard_fee: yardFeeVal,
    default_cart_weight: cartWeightVal,
    deduction_percent: deductionPercentVal,
    dual_station_mode: dualStationMode,
    show_payer_name: showPayerName
  };

  const updateData = {
    plantation_name: plantationName,
    plantation_address: plantationAddress,
    auction_buyer: auctionBuyer,
    plantation_logo: logoVal,
    price_cup: priceCup,
    price_sheet: priceCup,
    price_latex: priceCup,
    yard_fee: yardFeeVal,
    default_cart_weight: cartWeightVal,
    deduction_percent: deductionPercentVal,
    dual_station_mode: dualStationMode,
    show_payer_name: showPayerName
  };

  showLoading();
  try {
    if (sb && navigator.onLine) {
      let { data, error } = await sb.from('settings').update(updateData).eq('id', 1).select();

      // Fallback if newly added columns do not exist yet in Supabase schema
      if (error) {
        console.warn('Supabase update failed with new columns, executing fallback:', error.message);
        delete updateData.plantation_address;
        delete updateData.auction_buyer;
        delete updateData.plantation_logo;
        delete updateData.dual_station_mode;
        delete updateData.show_payer_name;
        delete updateData.yard_fee;
        const res = await sb.from('settings').update(updateData).eq('id', 1).select();
        data = res.data;
        error = res.error;
      }
    }

    updatePlantationName();
    updatePlantationLogo();
    updatePurchaseDualModeUI();
    showToast('บันทึกการตั้งค่าลานยางสำเร็จ!');
    renderSettings();
  } catch (err) {
    console.error('saveSettings error:', err);
    showToast('บันทึกการตั้งค่าในเครื่องสำเร็จ!');
    updatePlantationName();
    updatePlantationLogo();
    updatePurchaseDualModeUI();
    renderSettings();
  }
  hideLoading();
}

// ========== MEMBER IMPORT (EXCEL / CSV) ==========
let parsedImportData = [];

function transformMemberCode(raw) {
  if (raw === undefined || raw === null) return '';
  let str = String(raw).trim();
  if (!str) return '';

  const match = str.match(/(\d+)\s*$/);
  if (match) {
    const num = parseInt(match[1], 10);
    if (!isNaN(num)) {
      return String(num).padStart(3, '0');
    }
  }
  return str.padStart(3, '0');
}

function openImportMemberModal() {
  if (currentUser?.role !== 'admin') {
    showToast('เฉพาะแอดมินเท่านั้นที่สามารถนำเข้าสมาชิกได้', 'error');
    return;
  }

  parsedImportData = [];
  document.getElementById('member-file-input').value = '';
  document.getElementById('import-preview-section').style.display = 'none';
  document.getElementById('confirm-import-btn').disabled = true;

  document.getElementById('import-member-modal').classList.add('show');
}

function closeImportMemberModal() {
  document.getElementById('import-member-modal').classList.remove('show');
}

async function handleMemberFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  showLoading();
  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    if (!rawRows || rawRows.length === 0) {
      showToast('ไฟล์ไม่มีข้อมูล หรือรูปแบบไม่ถูกต้อง', 'error');
      hideLoading();
      return;
    }

    // Fetch existing member codes from Supabase
    const { data: existingMembers } = await sb.from('members').select('code');
    const existingCodes = new Set((existingMembers || []).map(m => m.code));
    const codesInFile = new Set();

    parsedImportData = [];

    rawRows.forEach((row, idx) => {
      // Find columns dynamically
      const rawCode = String(
        row['รหัสสมาชิก'] || row['รหัส'] || row['code'] || row['member_code'] || row['Code'] || row['CODE'] || ''
      ).trim();

      const name = String(
        row['ชื่อ-นามสกุล'] || row['ชื่อนามสกุล'] || row['ชื่อ'] || row['name'] || row['full_name'] || row['Name'] || ''
      ).trim();

      const phone = String(
        row['เบอร์โทร'] || row['เบอร์โทรศัพท์'] || row['phone'] || row['Tel'] || ''
      ).trim();

      const accountNo = String(
        row['เลขที่บัญชี'] || row['เลขบัญชี'] || row['account'] || row['account_no'] || row['Account'] || ''
      ).trim();

      const transformedCode = transformMemberCode(rawCode);

      let isValid = true;
      let errorReason = '';

      if (!transformedCode) {
        isValid = false;
        errorReason = 'ไม่มีรหัสสมาชิก';
      } else if (!name) {
        isValid = false;
        errorReason = 'ไม่มีชื่อ-นามสกุล';
      } else if (existingCodes.has(transformedCode)) {
        isValid = false;
        errorReason = `รหัส ${transformedCode} ซ้ำกับในระบบ`;
      } else if (codesInFile.has(transformedCode)) {
        isValid = false;
        errorReason = `รหัส ${transformedCode} ซ้ำในไฟล์`;
      } else {
        codesInFile.add(transformedCode);
      }

      parsedImportData.push({
        rowNum: idx + 1,
        rawCode,
        transformedCode,
        name,
        phone,
        accountNo,
        isValid,
        errorReason
      });
    });

    renderImportPreview();
  } catch (err) {
    showToast('อ่านไฟล์ไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

function renderImportPreview() {
  const container = document.getElementById('import-preview-section');
  const tbody = document.getElementById('import-preview-table-body');
  const countTotalEl = document.getElementById('import-count-total');
  const badgeValidEl = document.getElementById('import-badge-valid');
  const badgeInvalidEl = document.getElementById('import-badge-invalid');
  const confirmBtn = document.getElementById('confirm-import-btn');

  const validRows = parsedImportData.filter(r => r.isValid);
  const invalidRows = parsedImportData.filter(r => !r.isValid);

  countTotalEl.textContent = parsedImportData.length;
  badgeValidEl.textContent = `🟢 พร้อมนำเข้า: ${validRows.length}`;
  badgeInvalidEl.textContent = `🔴 มีปัญหา: ${invalidRows.length}`;

  confirmBtn.disabled = validRows.length === 0;
  confirmBtn.innerHTML = `💾 ยืนยันนำเข้าข้อมูล (${validRows.length} รายการ)`;

  tbody.innerHTML = parsedImportData.map(r => `
    <tr>
      <td>
        ${r.isValid 
          ? '<span class="badge badge-green">🟢 พร้อม</span>' 
          : '<span class="badge badge-danger">🔴 มีปัญหา</span>'}
      </td>
      <td>${r.rawCode || '-'}</td>
      <td><strong>${r.transformedCode || '-'}</strong></td>
      <td>${r.name || '<span style="color:var(--danger);">[ไม่มีชื่อ]</span>'}</td>
      <td>${r.accountNo || '-'}</td>
      <td>${r.isValid ? '<span style="color:var(--success);">ผ่าน</span>' : `<span style="color:var(--danger);">${r.errorReason}</span>`}</td>
    </tr>
  `).join('');

  container.style.display = 'block';
}

async function confirmImportMembers() {
  const validRows = parsedImportData.filter(r => r.isValid);
  if (validRows.length === 0) {
    showToast('ไม่มีรายการที่พร้อมนำเข้า', 'error');
    return;
  }

  showLoading();
  try {
    const insertPayload = validRows.map(r => ({
      code: r.transformedCode,
      name: r.name,
      phone: r.phone || '',
      account_no: r.accountNo || '',
      created_at: new Date().toISOString()
    }));

    const { data, error } = await sb.from('members').insert(insertPayload).select();
    if (error) throw error;

    const successCount = data ? data.length : validRows.length;
    const failCount = parsedImportData.length - successCount;

    showToast(`นำเข้าสำเร็จ ${successCount} รายการ! ${failCount > 0 ? `(ล้มเหลว/ข้าม ${failCount} รายการ)` : ''}`);
    closeImportMemberModal();
    await renderMembers();
  } catch (err) {
    showToast('นำเข้าไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

// ========== KEYBOARD SHORTCUTS ==========
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.getElementById('login-page').style.display !== 'none') {
    handleLogin();
  }
  if (e.key === 'Escape') {
    closeMemberModal();
    closeMemberSalesModal();
    closeImportMemberModal();
    closeUserModal();
    closeStartRoundModal();
    closeConfirmModal();
    closeReceiptModal();
    closeRoundReportModal();
  }
});

const SEED_MEMBERS = [
  { code: '001', name: 'นางเลิง สีกุม' },
  { code: '002', name: 'นางอารี เพียอินตา' },
  { code: '003', name: 'นางทองบุตร สุปะมา' },
  { code: '004', name: 'สมยศ จันทะคุณ' },
  { code: '005', name: 'นางบัวรมภ์ จันทะกาว' },
  { code: '006', name: 'นายไกรสร มาพันนะ' },
  { code: '007', name: 'นายรัฐมนูญ บุญผาง' },
  { code: '008', name: 'นายชิตร์ ม่วงเงิน' },
  { code: '009', name: 'นางนารี สีกุม' },
  { code: '010', name: 'นายวิเชียร ทาสีดา' },
  { code: '011', name: 'นางสุธาทิพย์ บัวลา' },
  { code: '012', name: 'นางศรีไพร พาสุวัน' },
  { code: '013', name: 'นางรัสดา จันทร์หอม' },
  { code: '014', name: 'นางจรรยาลักษณ์ คำมีถา' },
  { code: '015', name: 'นางนำ จันทะคุณ' },
  { code: '016', name: 'น.ส.วิไลลักษณ์ สีหะวงษ์' },
  { code: '017', name: 'น.ส.ประภัสสร โสภา' },
  { code: '018', name: 'นายสีนวล สีไพร' },
  { code: '019', name: 'นายบุญมี จันทะคุณ' },
  { code: '020', name: 'นางนึง ผาเดา' },
  { code: '021', name: 'นางคุณ หล่ออินทร์' },
  { code: '022', name: 'นางสฤษดิ์ จันทะคุณ' },
  { code: '023', name: 'นายสมชาย จันทะคุณ' },
  { code: '024', name: 'นางสด สีหะวงษ์' },
  { code: '025', name: 'นายบุญเลิศ อยู่ทิม' },
  { code: '026', name: 'นางผด สุดาสุด' },
  { code: '027', name: 'นางวันดี ไมลา' },
  { code: '028', name: 'นางนิภาพร ม่วงทิม' },
  { code: '029', name: 'นายอาทร เพียอินตา' },
  { code: '030', name: 'นางหลัน บุญผาง' },
  { code: '031', name: 'นางหยาด พิมพ์ดี' },
  { code: '032', name: 'นางม้วน แสงจันทร์' },
  { code: '033', name: 'นายเสวียน จันทะกาว' },
  { code: '034', name: 'นางบุญเวียง เพียอินตา' },
  { code: '035', name: 'นางวันดี มาคงทอง' },
  { code: '036', name: 'นางนรินทร์ทร ขำดี' },
  { code: '037', name: 'นางดรุณี ทองเพ็ง' },
  { code: '038', name: 'นายบุญเลิศ เอี่ยมพงดี' },
  { code: '039', name: 'น.ส.ไพลิน พุทธรักษ์' },
  { code: '040', name: 'นายบุญชัย ผาเดา' },
  { code: '041', name: 'นายตะวัน นันตะวงษ์' },
  { code: '042', name: 'นายไวพจน์ มาคงทอง' },
  { code: '043', name: 'น.ส.พรชนก คงสมบูรณ์' },
  { code: '044', name: 'นางต่วน เพียอินตา' },
  { code: '045', name: 'นางประทุมทอง คำพัน' },
  { code: '046', name: 'น.ส.พรรณิกา พลจอย' },
  { code: '047', name: 'นายสอาด ขาวผ่อง' },
  { code: '048', name: 'น.ส.หทัยรัตน์ ผะสม' },
  { code: '049', name: 'นางคำแพง โสพรม' },
  { code: '050', name: 'นางสังเวียน มั่นคง' },
  { code: '051', name: 'นาง เต็ม ภูสิตตา' },
  { code: '052', name: 'นางชญานุช ลิ่มมั่น' },
  { code: '053', name: 'นายฟ้อน ปู่อินทร์' },
  { code: '054', name: 'นางเตือนใจ ศิริ' },
  { code: '055', name: 'นายชัยนาท ขำนาพึง' },
  { code: '056', name: 'นางรถชรินทร์ จันทะคุณ' },
  { code: '057', name: 'นางสาวโสภา ตาสุรินทร์' },
  { code: '058', name: 'นายสิงห์ ตาสุรินทร์' },
  { code: '059', name: 'นายสมคิด สุขขุน' },
  { code: '060', name: 'นายชาตรี สิงห์สอน' },
  { code: '061', name: 'นายขาว บุญผาง' },
  { code: '062', name: 'นายสุพจน์ นิจจอหอ' },
  { code: '063', name: 'น.ส.สุจิตรา จันทะกาว' },
  { code: '064', name: 'นายดนุนันท์ จันทะคุณ' },
  { code: '065', name: 'นายสมชาย นุ่มเวร' },
  { code: '066', name: 'นางรุ้งทิพย์ โสภา' },
  { code: '067', name: 'นายพัฒนพงษ์ จันทะคุณ' },
  { code: '068', name: 'นางสมัคร ปู่อินทร์' },
  { code: '069', name: 'นางคำเหมือน ขาวผ่อง' },
  { code: '070', name: 'นายเสวียน จันทะกาว' },
  { code: '071', name: 'น.ส.กันหา จันทะคุณ' },
  { code: '072', name: 'น.ส.ประกายกุล จันทะคุณ' },
  { code: '073', name: 'นางไทย วงพิมเสน' },
  { code: '074', name: 'นายพอน แสนคำ' },
  { code: '075', name: 'นางนภาพร สีสัน' },
  { code: '076', name: 'นางสายหยุด จันทะคุณ' },
  { code: '077', name: 'นายเส็ง ตาสุรินทร์' },
  { code: '078', name: 'นางออรัชฎา ดวงอุปะ' },
  { code: '079', name: 'นางบุญมี ชุ่มวงศ์' },
  { code: '080', name: 'นายทะวีป เดชเทศ' },
  { code: '081', name: 'น.ส.รัตน์ดาวัลย์ ปูจิปา' },
  { code: '082', name: 'นายจั่น เที่ยงคำ' },
  { code: '083', name: 'นางสาวรินรดา เทพวงค์' },
  { code: '084', name: 'นางสาวณัฏฐณิชา ทองคง' },
  { code: '085', name: 'นางนงค์ราม คุ้มวันดี' },
  { code: '086', name: 'นางสาวสำรวย โคตะมี' },
  { code: '087', name: 'นายเซนวิทย์ ม่วงทิม' },
  { code: '088', name: 'นางศิริภูษา นิจจอหอ' },
  { code: '089', name: 'นางสาวทิพวรรณ นิจจอหอ' },
  { code: '090', name: 'นางรำพรรณ เขตา' },
  { code: '091', name: 'ศิริยากร' },
  { code: '092', name: 'บุญทัน คำยวง' },
  { code: '093', name: 'สมศักดิ์ หล่ออินทร์' },
  { code: '094', name: 'วิโรจน์ สีไพร' },
  { code: '095', name: 'บุญส่ง เพียอินตา' },
  { code: '096', name: 'นางทองเหลา มาคงทอง' },
  { code: '097', name: 'นาย วิสุทธิ์ ลินำ' },
  { code: '098', name: 'นาง เปลี่ยน คุ้มวันดี' },
  { code: '100', name: 'นายอุดม ดวงอุปะ' },
  { code: '102', name: 'นางพาด มาพันนะ' },
  { code: '103', name: 'พงษ์เพชร โคกน้อย' },
  { code: '104', name: 'สมปอง จันทะคุณ' },
  { code: '105', name: 'นายอ๊อด กันล้อม' },
  { code: '106', name: 'นางสาวมาริสา โสภา' },
  { code: '107', name: 'นางสาววารินทร์ จันทะกาว' },
  { code: '108', name: 'นายศรี พรมขัน' },
  { code: '109', name: 'นางพักดี จันทะคุณ' },
  { code: '110', name: 'นางบุญร่วม คุ้มวันดี' },
  { code: '111', name: 'นายกิตติภณ ปานแก้ว' },
  { code: '112', name: 'นาง ศรีลา ดวงอุปะ' },
  { code: '113', name: 'นาย เตือนใหม่ อ่อนนามือง' },
  { code: '114', name: 'นาง สุธิกานต์ เกตุสุธรรม' },
  { code: '115', name: 'นาย ชาติ ดวงอุปะ' },
  { code: '116', name: 'นาย เดชา ดวงอุปะ' },
  { code: '117', name: 'นายสุภาพ แจ่มเพ็ง' },
  { code: '118', name: 'นายพิษชัย ทองเพ็ง' },
  { code: '119', name: 'นางสาวน้ำฝน เงินยิ่ง' },
  { code: '120', name: 'นาย สมร วงษ์แก้วมูล' },
  { code: '121', name: 'นาง แสงมณี แสงสิงห์' },
  { code: '122', name: 'นาง ขันที คีลาวงษ์' },
  { code: '123', name: 'นาง ปรานี จันทะคุณ' },
  { code: '124', name: 'นาง พรรรณิภา วัฒนธรรม' },
  { code: '125', name: 'นางนเรศ มั่งอ่อน' },
  { code: '126', name: 'นายบุญมี แตงอ่อน' },
  { code: '127', name: 'นาง บังอร แสงคำ' },
  { code: '128', name: 'นางวุ่น ศรียศ' },
  { code: '129', name: 'นาย พันธิ์ ม่วงทิม' },
  { code: '130', name: 'ทัศนีย์ มณีศรี' },
  { code: '131', name: 'ฤทธิพร จันทะคุณ' },
  { code: '132', name: 'สันทัศน์ สีสุราช' },
  { code: '133', name: 'กรกช เกตุสุธรรม' },
  { code: '134', name: 'นางลำดวน ฟองจางวาง' },
  { code: '135', name: 'ฮัก เสนานุช' },
  { code: '136', name: 'นางสมเผื่อน จันทร์แสง' },
  { code: '137', name: 'นายพยุง เม่นขาว' },
  { code: '138', name: 'นางบุญหลาย โทจำปา' },
  { code: '139', name: 'นางขวัญเรือน มหาการเกตุ' },
  { code: '140', name: 'นางวิลาวัลย์ จันทะคุณ' },
  { code: '141', name: 'ประดับ จันทะคุณ' },
  { code: '142', name: 'ยลดา ป้องคูหลวง' },
  { code: '143', name: 'ไกรสร เขียวใจยา' },
  { code: '144', name: 'ชำรุด มาคงทอง' },
  { code: '145', name: 'ฟอง อินปัน' },
  { code: '146', name: 'เสี่ยน คำพัน' },
  { code: '147', name: 'สมนึก อุ้ยสละ' },
  { code: '148', name: 'อารี จันทะวงษ์' },
  { code: '149', name: 'ภัทรวุฒิ สีฟอง' },
  { code: '150', name: 'ดุจดาว เนตรแสงสี' },
  { code: '151', name: 'ศุภร จันทะคุณ' },
  { code: '152', name: 'สุนันทา จันทะคุณ' },
  { code: '153', name: 'ลอด สิริมาตร' },
  { code: '154', name: 'วัชรินทร์ สีไพร' },
  { code: '155', name: 'ประฐม บัวองค์' },
  { code: '156', name: 'นาย หมู่ จันทะคุณ' },
  { code: '157', name: 'นาง ไหว ยั่งยืน' },
  { code: '158', name: 'นาย จีรศักดิ์ มาคงทอง' },
  { code: '159', name: 'นาง เต็ม ภูสิตตา' },
  { code: '160', name: 'ประทุมทิพ บุญผาง' }
];

async function seedInitialMembers() {
  try {
    const { count } = await sb.from('members').select('*', { count: 'exact', head: true });
    if (!count || count < 100) {
      console.log('Auto seeding 158 members...');
      await sb.from('members').upsert(SEED_MEMBERS, { onConflict: 'code' });
    }
  } catch (err) {
    console.error('Auto seed members error:', err);
  }
}

async function forceSeedMembers() {
  showLoading();
  try {
    const { data, error } = await sb.from('members').upsert(SEED_MEMBERS, { onConflict: 'code' }).select();
    if (error) throw error;
    showToast('นำเข้าสมาชิกทั้ง 158 คนเรียบร้อยแล้ว!');
    await renderMembers();
  } catch (err) {
    showToast('นำเข้าไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

// ========== INITIALIZATION ==========
async function init() {
  updatePlantationLogo();
  try {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (err) {
    showToast('ไม่สามารถเชื่อมต่อ Supabase ได้', 'error');
    hideLoading();
    return;
  }

  if (checkAuth()) {
    showLoading();
    await seedInitialMembers();
    await showApp();
    hideLoading();
  } else {
    document.getElementById('login-page').style.display = 'flex';
    document.getElementById('app').classList.remove('active');
    loadRememberedCredentials();
    try { await loadSettings(); } catch (e) { /* ignore */ }
  }
}

document.addEventListener('DOMContentLoaded', init);
