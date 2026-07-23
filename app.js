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

    // 1. Try Query app_users table first
    try {
      const { data: user, error } = await sb.from('app_users')
        .select('*')
        .eq('username', username)
        .eq('password', password)
        .maybeSingle();

      if (!error && user) {
        loggedUser = user;
      }
    } catch (e) {
      console.warn('app_users table check skipped or not created yet:', e);
    }

    // 2. Fallback: Check settings table if app_users query didn't find user or table missing
    if (!loggedUser) {
      const { data: setArr } = await sb.from('settings').select('admin_username, admin_password').eq('id', 1);
      const setData = setArr && setArr[0];
      if (setData && username === setData.admin_username && password === setData.admin_password) {
        // Try to insert admin into app_users if table exists
        try {
          const { data: newUser } = await sb.from('app_users').insert({
            username: setData.admin_username,
            password: setData.admin_password,
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
  navigateTo('dashboard');
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
    const { data, error } = await sb.from('settings').select('*').eq('id', 1).single();
    if (error) throw error;
    cachedSettings = data;
    updatePlantationName();
    return data;
  } catch (err) {
    console.error('Failed to load settings:', err);
    cachedSettings = {
      plantation_name: 'ลานยางพาราชุมชน',
      price_sheet: 45, price_cup: 35, price_latex: 50,
      default_cart_weight: 5, deduction_percent: 0
    };
    return cachedSettings;
  }
}

function updatePlantationName() {
  const name = cachedSettings?.plantation_name || 'ลานยางพาราชุมชน';
  document.getElementById('sidebar-plantation-name').textContent = name;
  document.getElementById('login-plantation-name').textContent = name;
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
      await sb.from('purchase_rounds').update({
        status: 'closed',
        end_date: new Date().toISOString(),
        closed_at: new Date().toISOString(),
        closed_by_name: currentUser.display_name
      }).eq('id', currentRound.id);
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
    const { error } = await sb.from('purchase_rounds').update({
      status: 'closed',
      end_date: new Date().toISOString(),
      closed_at: new Date().toISOString(),
      closed_by_name: currentUser.display_name
    }).eq('id', roundId);

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
      // Query summary for active round
      const { data: roundTx } = await sb.from('transactions')
        .select('net_weight, final_weight, total_price, member_code')
        .eq('round_id', currentRound.id);

      const txArr = roundTx || [];
      const totalCount = txArr.length;
      const uniqueMembers = new Set(txArr.map(t => t.member_code)).size;
      const totalWeight = txArr.reduce((s, t) => s + Number(t.final_weight || t.net_weight || 0), 0);
      const totalAmount = txArr.reduce((s, t) => s + Number(t.total_price || 0), 0);

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
            <div class="card-value" style="font-size:1.3rem;">${formatNumber(totalWeight)} <span class="unit">กก.</span></div>
          </div>
          <div class="glass-card stat-card" style="padding:12px 16px;">
            <div class="card-title">ยอดเงินรวม</div>
            <div class="card-value" style="font-size:1.3rem; color:var(--gold);">${formatNumber(totalAmount)} <span class="unit">บาท</span></div>
          </div>
        </div>
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
            <button class="btn btn-secondary btn-sm" onclick="showRoundReport('${r.id}')">
              📄 สรุปรอบ
            </button>
          </td>
          <td>
            ${r.status === 'open' 
              ? `<button class="btn btn-danger btn-sm" onclick="confirmCloseRound('${r.id}')">🔒 ปิดรอบ</button>` 
              : `<button class="btn btn-secondary btn-sm" onclick="showRoundReport('${r.id}')">🖨️ พิมพ์เอกสาร</button>`}
            ${currentUser?.role === 'admin' 
              ? `<button class="btn btn-danger btn-sm btn-icon" onclick="confirmDeleteRound('${r.id}')" title="ลบรอบนี้" style="margin-left:4px;">🗑️</button>` 
              : ''}
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

    const reportContent = document.getElementById('round-report-content');
    reportContent.innerHTML = `
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

    document.getElementById('round-report-modal').classList.add('show');
  } catch (err) {
    showToast('ไม่สามารถสร้างเอกสารสรุปรอบได้: ' + err.message, 'error');
  }
  hideLoading();
}

function closeRoundReportModal() {
  document.getElementById('round-report-modal').classList.remove('show');
}

function printRoundReport() {
  window.print();
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
  showLoading();
  try {
    // 1. Delete all transactions belonging to this round
    await sb.from('transactions').delete().eq('round_id', roundId);

    // 2. Delete the round record itself
    const { error } = await sb.from('purchase_rounds').delete().eq('id', roundId);
    if (error) throw error;

    closeConfirmModal();
    showToast('ลบรอบการรับซื้อและรายการทั้งหมดในรอบเรียบร้อยแล้ว!');

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

    document.getElementById('member-sales-modal').classList.add('show');
  } catch (err) {
    showToast('ไม่สามารถโหลดประวัติสมาชิกได้: ' + err.message, 'error');
  }
  hideLoading();
}

function closeMemberSalesModal() {
  document.getElementById('member-sales-modal').classList.remove('show');
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
    case 'rounds': renderRounds(); break;
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
async function renderDashboard() {
  showLoading();
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
      tbody.innerHTML = recentTx.map(t => `
        <tr>
          <td>${formatDateTime(t.date)}</td>
          <td><span class="badge badge-green">${t.member_code}</span></td>
          <td>${t.member_name}</td>
          <td>${getRubberTypeBadge(t.rubber_type)}</td>
          <td>${t.trip_count || 1}</td>
          <td>${formatNumber(t.final_weight || t.net_weight)} กก.</td>
          <td style="font-weight:600; color: var(--gold);">${formatNumber(t.total_price)} ฿</td>
          <td><span class="badge" style="background:rgba(255,255,255,0.08);">${t.created_by_name || 'ผู้ดูแลระบบ'}</span></td>
        </tr>
      `).join('');
    }
  } catch (err) {
    showToast('โหลดข้อมูลแดชบอร์ดไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
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
  showLoading();
  try {
    const { error } = await sb.from('members').delete().eq('id', id);
    if (error) throw error;
    closeConfirmModal();
    await renderMembers();
    showToast('ลบสมาชิกสำเร็จ!');
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

  // Start with one trip
  trips = [{ grossWeight: 0 }];
  renderTrips();
  calculatePrice();
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
  container.innerHTML = trips.map((trip, i) => `
    <div class="trip-item">
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
        <div class="trip-net" id="trip-net-${i}">สุทธิ: 0.00 กก.</div>
      </div>
    </div>
  `).join('');
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
    netHint.innerHTML = `ราคาหลังหักค่าจัดการลาน: <strong>${formatNumber(netPricePerKg)}</strong> บาท/กก. (หักค่าจัดการ -${formatNumber(yardFee)} บาท)`;
  }

  const deductionPercent = cachedSettings?.deduction_percent || 0;

  let totalNet = 0;
  const detailHtml = [];

  trips.forEach((trip, i) => {
    const net = Math.max(0, trip.grossWeight - cartWeight);
    trip.netWeight = net;
    totalNet += net;

    const netEl = document.getElementById(`trip-net-${i}`);
    if (netEl) netEl.textContent = `สุทธิ: ${formatNumber(net)} กก.`;

    if (trip.grossWeight > 0) {
      detailHtml.push(`
        <div class="calc-row" style="font-size:0.85rem;">
          <span class="label">เที่ยวที่ ${i + 1}: ${formatNumber(trip.grossWeight)} - ${formatNumber(cartWeight)}</span>
          <span class="value">${formatNumber(net)} กก.</span>
        </div>
      `);
    }
  });

  const deductionAmount = totalNet * deductionPercent / 100;
  const finalWeight = totalNet - deductionAmount;
  const totalPrice = finalWeight * netPricePerKg;

  document.getElementById('calc-trips-detail').innerHTML = detailHtml.join('');
  document.getElementById('calc-total-net').textContent = `${formatNumber(totalNet)} กก.`;
  document.getElementById('calc-deduction-pct').textContent = deductionPercent;
  document.getElementById('calc-deduction-amount').textContent = `- ${formatNumber(deductionAmount)} กก.`;
  document.getElementById('calc-final-weight').textContent = `${formatNumber(finalWeight)} กก.`;
  document.getElementById('calc-price-per-kg').textContent = `${formatNumber(netPricePerKg)} บาท (${formatNumber(auctionPrice)} - ${formatNumber(yardFee)})`;
  document.getElementById('calc-total-price').textContent = `${formatNumber(totalPrice)} บาท`;

  const deductRow = document.getElementById('calc-deduction-row');
  if (deductRow) deductRow.style.display = deductionPercent > 0 ? 'flex' : 'none';
}

async function saveTransaction() {
  if (!selectedMember) { showToast('กรุณาเลือกสมาชิก', 'error'); return; }

  const cartWeight = parseFloat(document.getElementById('cart-weight').value) || 0;
  const auctionPrice = parseFloat(document.getElementById('price-per-kg').value) || 0;
  const yardFee = cachedSettings && cachedSettings.yard_fee !== undefined ? parseFloat(cachedSettings.yard_fee) : 0.50;
  const netPricePerKg = Math.max(0, auctionPrice - yardFee);
  const rubberType = document.getElementById('rubber-type').value;
  const deductionPercent = cachedSettings?.deduction_percent || 0;

  const hasWeight = trips.some(t => t.grossWeight > 0);
  if (!hasWeight) { showToast('กรุณากรอกน้ำหนักอย่างน้อย 1 เที่ยว', 'error'); return; }
  if (auctionPrice <= 0) { showToast('กรุณากรอกราคาประมูลต่อ กก.', 'error'); return; }

  const tripDetails = trips.filter(t => t.grossWeight > 0).map((t, i) => ({
    trip: i + 1,
    gross_weight: t.grossWeight,
    cart_weight: cartWeight,
    net_weight: Math.max(0, t.grossWeight - cartWeight)
  }));

  const totalGross = tripDetails.reduce((s, t) => s + t.gross_weight, 0);
  const totalCart = cartWeight * tripDetails.length;
  const totalNet = tripDetails.reduce((s, t) => s + t.net_weight, 0);
  const deductionAmount = totalNet * deductionPercent / 100;
  const finalWeight = totalNet - deductionAmount;
  const totalPrice = finalWeight * netPricePerKg;

  showLoading();
  try {
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
      trip_count: tripDetails.length,
      round_id: currentRound ? currentRound.id : null,
      created_by_name: currentUser ? currentUser.display_name : 'ผู้ดูแลระบบ',
      date: new Date().toISOString()
    };

    let { data, error } = await sb.from('transactions').insert(payload).select().single();

    // Fallback if auction_price or yard_fee columns don't exist yet in Supabase schema
    if (error && error.message.includes('column')) {
      delete payload.auction_price;
      delete payload.yard_fee;
      const res = await sb.from('transactions').insert(payload).select().single();
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
  } catch (err) {
    showToast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

// ========== RECEIPT (100% IDENTICAL DUAL COPIES ON SINGLE PAGE) ==========
function buildReceiptCopyHTML(tx, plantName) {
  const tripsList = tx.trips || [];

  let tripsHtml = '';
  if (tripsList.length > 0) {
    tripsHtml = `
      <div style="border-top:1px dashed #ccc;margin:6px 0;"></div>
      <div style="font-weight:600;font-size:0.85rem;margin-bottom:4px;">รายละเอียดเที่ยวชั่ง (${tripsList.length} เที่ยว):</div>
      ${tripsList.map(t => `
        <div class="receipt-row" style="font-size:0.8rem;">
          <span>เที่ยวที่ ${t.trip}</span>
          <span>${formatNumber(t.gross_weight)} - ${formatNumber(t.cart_weight)} = <strong>${formatNumber(t.net_weight)}</strong> กก.</span>
        </div>
      `).join('')}
    `;
  }

  const deductPct = Number(tx.deduction_percent || 0);
  const deductionHtml = deductPct > 0 ? `
    <div class="receipt-row">
      <span>หักเปอร์เซ็นต์ (${deductPct}%):</span>
      <span>- ${formatNumber(Number(tx.net_weight) - Number(tx.final_weight))} กก.</span>
    </div>
    <div class="receipt-row">
      <span>น้ำหนักหลังหัก:</span>
      <span><strong>${formatNumber(tx.final_weight)} กก.</strong></span>
    </div>
  ` : `
    <div class="receipt-row">
      <span>น้ำหนักสุทธิ:</span>
      <span><strong>${formatNumber(tx.final_weight || tx.net_weight)} กก.</strong></span>
    </div>
  `;

  return `
    <div class="receipt-single-copy">
      <div class="receipt-header" style="margin-bottom:10px;">
        <h3 style="font-size:1.15rem;">🌿 ${plantName}</h3>
        <p style="font-size:0.9rem;font-weight:600;">ใบเสร็จรับซื้อยางพารา</p>
        <p style="font-size:0.75rem;margin-top:4px;color:#64748b;">${formatDateTime(tx.date)}</p>
      </div>
      <div class="receipt-row"><span>รหัสสมาชิก:</span><span><strong>${tx.member_code}</strong></span></div>
      <div class="receipt-row"><span>ชื่อสมาชิก:</span><span>${tx.member_name}</span></div>
      ${tx.member_account_no ? `<div class="receipt-row"><span>เลขบัญชี:</span><span>${tx.member_account_no}</span></div>` : ''}
      <div class="receipt-row"><span>ประเภทยาง:</span><span>ยางก้อนถ้วย</span></div>
      ${tripsHtml}
      <div style="border-top:1px dashed #ccc;margin:6px 0;"></div>
      <div class="receipt-row"><span>น้ำหนักสุทธิรวม:</span><span>${formatNumber(tx.net_weight)} กก.</span></div>
      ${deductionHtml}
      <div class="receipt-row"><span>ราคาประมูล:</span><span>${formatNumber(tx.auction_price !== undefined ? tx.auction_price : (Number(tx.price_per_kg) + (tx.yard_fee !== undefined ? Number(tx.yard_fee) : 0.50)))} บาท/กก.</span></div>
      <div class="receipt-row" style="color:#ef4444;"><span>หักค่าจัดการลาน:</span><span>-${formatNumber(tx.yard_fee !== undefined ? tx.yard_fee : 0.50)} บาท/กก.</span></div>
      <div class="receipt-row"><span>ราคาสุทธิต่อ กก.:</span><span><strong>${formatNumber(tx.price_per_kg)} บาท/กก.</strong></span></div>
      <div class="receipt-row total" style="padding:6px 0;">
        <span>💰 ยอดเงินรวม:</span>
        <span style="font-size:1.2rem;">${formatNumber(tx.total_price)} บาท</span>
      </div>
      <div style="border-top:1px dashed #ccc;margin:6px 0;"></div>
      <div class="receipt-row" style="font-size:0.8rem;">
        <span>ผู้จัดทำ:</span>
        <span><strong>${tx.created_by_name || 'ผู้ดูแลระบบ'}</strong></span>
      </div>
      <div class="receipt-footer" style="margin-top:8px;">
        <p style="font-size:0.8rem;">ขอบคุณที่ใช้บริการ</p>
        <p style="font-size:0.65rem;margin-top:2px;color:#94a3b8;">Ref: ${(tx.id || '').substring(0, 8).toUpperCase()}</p>
      </div>
    </div>
  `;
}

function showReceipt(tx) {
  const plantName = cachedSettings?.plantation_name || 'ลานยางพาราชุมชน';

  const copy1 = buildReceiptCopyHTML(tx, plantName);
  const copy2 = buildReceiptCopyHTML(tx, plantName);

  const cutLine = `<div class="receipt-cut-line">--------------------------------------------------</div>`;

  document.getElementById('receipt-content').innerHTML = `
    ${copy1}
    ${cutLine}
    ${copy2}
  `;

  document.getElementById('receipt-modal').classList.add('show');
}

function closeReceiptModal() {
  document.getElementById('receipt-modal').classList.remove('show');
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

    const totalCount = filtered.length;
    const totalWeight = filtered.reduce((s, t) => s + Number(t.final_weight || t.net_weight || 0), 0);
    const totalAmount = filtered.reduce((s, t) => s + Number(t.total_price || 0), 0);

    document.getElementById('summary-count').textContent = totalCount;
    document.getElementById('summary-weight').innerHTML = `${formatNumber(totalWeight)} <span class="unit">กก.</span>`;
    document.getElementById('summary-amount').innerHTML = `${formatNumber(totalAmount)} <span class="unit">บาท</span>`;

    const tbody = document.getElementById('history-table-body');
    const emptyState = document.getElementById('history-empty');

    if (filtered.length === 0) {
      tbody.innerHTML = '';
      emptyState.style.display = 'block';
      tbody.closest('.table-container').style.display = 'none';
    } else {
      emptyState.style.display = 'none';
      tbody.closest('.table-container').style.display = 'block';
      tbody.innerHTML = filtered.map(t => `
        <tr>
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
  showLoading();
  try {
    const { error } = await sb.from('transactions').delete().eq('id', id);
    if (error) throw error;
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
    // Verify old password
    const { data: userCheck } = await sb.from('app_users')
      .select('password')
      .eq('id', currentUser.id)
      .single();

    if (!userCheck || userCheck.password !== oldPass) {
      showToast('รหัสผ่านเดิมไม่ถูกต้อง', 'error');
      hideLoading();
      return;
    }

    // Update password
    const { error } = await sb.from('app_users').update({
      password: newPass
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
    passInput.value = u.password;
    roleInput.value = u.role;
  } else {
    titleEl.textContent = 'เพิ่มผู้ใช้งานใหม่';
    hiddenId.value = '';
    usernameInput.value = '';
    usernameInput.disabled = false;
    nameInput.value = '';
    passInput.value = '';
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
  const password = document.getElementById('user-password').value;
  const role = document.getElementById('user-role').value;

  if (!username) { showToast('กรุณากรอกชื่อผู้ใช้ (Username)', 'error'); return; }
  if (!display_name) { showToast('กรุณากรอกชื่อที่แสดง', 'error'); return; }
  if (!password) { showToast('กรุณากรอกรหัสผ่าน', 'error'); return; }

  showLoading();
  try {
    if (hiddenId) {
      const { error } = await sb.from('app_users').update({
        display_name, password, role
      }).eq('id', hiddenId);
      if (error) throw error;

      showToast('แก้ไขผู้ใช้งานสำเร็จ!');
    } else {
      const { error } = await sb.from('app_users').insert({
        username, display_name, password, role
      });
      if (error) throw error;

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
  if (id === currentUser.id) {
    showToast('ไม่สามารถลบบัญชีของตัวเองได้', 'error');
    return;
  }

  showLoading();
  try {
    const { error } = await sb.from('app_users').delete().eq('id', id);
    if (error) throw error;

    closeConfirmModal();
    await renderUsers();
    showToast('ลบผู้ใช้งานสำเร็จ!');
  } catch (err) {
    showToast('ลบผู้ใช้ไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

// ========== SETTINGS ==========
async function renderSettings() {
  if (!cachedSettings) await loadSettings();
  const s = cachedSettings;

  document.getElementById('setting-plantation-name').value = s?.plantation_name || '';
  document.getElementById('setting-price-cup').value = s?.price_cup || '';
  const yardFeeEl = document.getElementById('setting-yard-fee');
  if (yardFeeEl) yardFeeEl.value = s?.yard_fee !== undefined ? s.yard_fee : '0.50';
  document.getElementById('setting-cart-weight').value = s?.default_cart_weight || '';
  document.getElementById('setting-deduction-percent').value = s?.deduction_percent || '';
}

async function saveSettings() {
  const priceCup = parseFloat(document.getElementById('setting-price-cup').value) || 0;
  const yardFeeVal = parseFloat(document.getElementById('setting-yard-fee')?.value) ?? 0.50;

  const updateData = {
    plantation_name: document.getElementById('setting-plantation-name').value.trim() || 'ลานยางพาราชุมชน',
    price_cup: priceCup,
    price_sheet: priceCup,
    price_latex: priceCup,
    yard_fee: yardFeeVal,
    default_cart_weight: parseFloat(document.getElementById('setting-cart-weight').value) || 0,
    deduction_percent: parseFloat(document.getElementById('setting-deduction-percent').value) || 0
  };

  showLoading();
  try {
    let { error } = await sb.from('settings').update(updateData).eq('id', 1);

    if (error && error.message.includes('column')) {
      delete updateData.yard_fee;
      const res = await sb.from('settings').update(updateData).eq('id', 1);
      error = res.error;
    }

    if (error) throw error;

    await loadSettings();
    showToast('บันทึกการตั้งค่าลานยางสำเร็จ!');
    renderSettings();
  } catch (err) {
    showToast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
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
    try { await loadSettings(); } catch (e) { /* ignore */ }
  }
}

document.addEventListener('DOMContentLoaded', init);
