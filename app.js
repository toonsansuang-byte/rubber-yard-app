/* ============================================
   COMMUNITY RUBBER PLANTATION WEB APP
   Application Logic — Supabase + Multi-Trip + Multi-User + Rounds
   ============================================ */

// ========== SUPABASE CONFIG ==========
var SUPABASE_URL = window.SUPABASE_URL || 'https://llukvrfabdnvlbimvepb.supabase.co';
var SUPABASE_KEY = window.SUPABASE_KEY || 'sb_publishable_TfYRzo9Gj85z7KByoPEZnA_RJvJCtw7';
var sb = window.sb || sb || null;

// ========== GLOBAL STATE ==========
let currentSection = 'dashboard';
// currentUser is managed in window.currentUser by js/auth.js
// (Accessible globally as currentUser)
// State variables shared across modules (managed via window.*)
window.currentRound = window.currentRound || null;
window.currentActiveSeason = window.currentActiveSeason || {
  id: 1,
  name: 'ฤดูกาล 2569',
  is_active: 1
};
try {
  const cachedSeasonName = localStorage.getItem('active_season_name');
  const cachedSeasonId = localStorage.getItem('active_season_id');
  if (cachedSeasonName) {
    window.currentActiveSeason.name = cachedSeasonName;
    if (cachedSeasonId) window.currentActiveSeason.id = isNaN(Number(cachedSeasonId)) ? cachedSeasonId : Number(cachedSeasonId);
  }
} catch (e) {}
window.selectedMember = window.selectedMember || null;
window.trips = window.trips || [];
window.cachedSettings = window.cachedSettings || null;
window.editingTransaction = window.editingTransaction || null;

window.RUBBER_TYPES = window.RUBBER_TYPES || {
  sheet: 'ยางแผ่นดิบ',
  cup: 'ยางก้อนถ้วย',
  latex: 'น้ำยางสด'
};
var RUBBER_TYPES = window.RUBBER_TYPES;

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

function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ========== CROSS-DEVICE FAILSAFE TRIP ENCODING HELPER (MOVED TO js/purchase.js) ==========
// encodeTripsIntoTruckNumber and decodeTripsFromTruckNumber are now in js/purchase.js

// ========== AUTH & USER SESSION (MOVED TO js/auth.js) ==========
// checkAuth, togglePasswordVisibility, handleLogin are now in js/auth.js

// ========== HISTORY PAGINATION & EXPAND CONTROLS (MOVED TO js/history.js) ==========
// renderHistoryRows, scrollHistoryToTop, setHistoryPage, toggleHistoryShowAll
// are now in js/history.js

// handleLogout() is now in js/auth.js

async function showApp() {
  document.getElementById('login-page').style.display = 'none';
  const mpPage = document.getElementById('member-portal-page');
  if (mpPage) mpPage.style.display = 'none';
  document.getElementById('app').classList.add('active');
  updateUserSidebarUI();
  await loadSettings();
  await loadCurrentRound();
  await fetchAdminPendingBankRequestsCount();
  initRealtimeSubscriptions();
  navigateTo('dashboard');

  if (isDesktopApp()) {
    (async () => {
      try {
        if (typeof window.desktopDB.syncAll === 'function') {
          await window.desktopDB.syncAll();
        } else {
          await window.desktopDB.syncUpload();
          const pending = await window.desktopDB.syncStatus();
          if (!pending || pending === 0) {
            await window.desktopDB.syncDownload();
          }
        }
      } catch (e) {
        console.warn('Startup safe-sync error:', e);
      }
      await loadCurrentRound();
      if (currentSection === 'dashboard' && typeof renderDashboard === 'function') await renderDashboard(false);
      if (currentSection === 'history' && typeof renderHistory === 'function') await renderHistory(false);
      if (currentSection === 'rounds' && typeof renderRounds === 'function') await renderRounds();
    })();
  }
}

// ========== MEMBER PORTAL AUTH (MOVED TO js/auth.js) ==========
// checkMemberAuth, switchLoginRole, toggleMemberPasswordVisibility,
// handleMemberLogin, handleMemberLogout are now in js/auth.js
let currentMemberPortalPeriod = "all";
let currentMemberPortalTxList = [];
let currentMemberPortalRoundMap = {};

async function showMemberPortalApp() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app').classList.remove('active');
  const mpPage = document.getElementById('member-portal-page');
  if (mpPage) mpPage.style.display = 'block';

  const plantName = cachedSettings?.plantation_name || 'ลานยางพาราชุมชน';
  const titleEl = document.getElementById('mp-plantation-name');
  if (titleEl) titleEl.textContent = plantName;

  if (currentMemberUser) {
    let formattedCode = String(currentMemberUser.code || '');
    if (!formattedCode.startsWith('ก')) {
      formattedCode = 'ก' + formattedCode.padStart(5, '0');
    }

    const headerName = document.getElementById('mp-header-name');
    const headerCode = document.getElementById('mp-header-code');
    const fullName = document.getElementById('mp-full-name');
    const codeBadge = document.getElementById('mp-code-badge');
    const accountNo = document.getElementById('mp-account-no');
    const phoneNo = document.getElementById('mp-phone-no');
    const avatar = document.getElementById('mp-avatar');

    if (headerName) headerName.textContent = currentMemberUser.name;
    if (headerCode) headerCode.textContent = formattedCode;
    if (fullName) fullName.textContent = currentMemberUser.name;
    if (codeBadge) codeBadge.textContent = formattedCode;
    if (accountNo) accountNo.textContent = currentMemberUser.account_no || 'ยังไม่ได้ระบุ';
    if (phoneNo) phoneNo.textContent = currentMemberUser.phone || 'ยังไม่ได้ระบุ';
    if (avatar) avatar.textContent = (currentMemberUser.name || 'M')[0];
  }

  await loadCurrentRound();
  await fetchMemberPortalAnnouncements();
  await fetchMemberPortalTransactions();
  await fetchMemberBankRequestStatus();
}

async function fetchMemberPortalTransactions() {
  if (!currentMemberUser || !currentMemberUser.code) return;

  const code = currentMemberUser.code;
  const codeNorm = normalizeMemberCodeStr(code);

  showLoading();
  try {
    let txs = [];
    let rounds = [];
    // FIX H5: Support Desktop SQLite and offline mode
    if (isDesktopApp()) {
      txs = await window.desktopDB.query(
        'SELECT * FROM transactions WHERE member_code = ? OR member_code = ? ORDER BY date DESC',
        [code, codeNorm]
      ) || [];
      rounds = await window.desktopDB.query('SELECT id, title, supabase_id FROM purchase_rounds') || [];
      // Also try cloud if online to get latest
      if (sb && !isAppOffline()) {
        try {
          const { data: cloudTxs } = await sb.from('transactions')
            .select('*')
            .or(`member_code.eq.${code},member_code.eq.${codeNorm}`)
            .order('date', { ascending: false });
          if (cloudTxs && cloudTxs.length > 0) txs = cloudTxs;

          const { data: cloudRounds } = await sb.from('purchase_rounds').select('id, title');
          if (cloudRounds && cloudRounds.length > 0) {
            cloudRounds.forEach(cr => {
              if (!rounds.some(r => String(r.supabase_id) === String(cr.id) || String(r.id) === String(cr.id))) {
                rounds.push(cr);
              }
            });
          }
        } catch (e) { /* fallback to local data */ }
      }
    } else if (sb && !isAppOffline()) {
      const { data, error } = await sb.from('transactions')
        .select('*')
        .or(`member_code.eq.${code},member_code.eq.${codeNorm}`)
        .order('date', { ascending: false });
      if (error) throw error;
      txs = data || [];

      try {
        const { data: rData } = await sb.from('purchase_rounds').select('id, title');
        rounds = rData || [];
      } catch (e) { /* ignore */ }
    }

    currentMemberPortalRoundMap = {};
    (rounds || []).forEach(r => {
      if (r.id) currentMemberPortalRoundMap[String(r.id)] = r.title;
      if (r.supabase_id) currentMemberPortalRoundMap[String(r.supabase_id)] = r.title;
    });

    currentMemberPortalTxList = txs;
    renderMemberPortalTable();
  } catch (err) {
    showToast('ไม่สามารถโหลดประวัติการขายยางได้: ' + err.message, 'error');
  }
  hideLoading();
}

function setMemberPortalPeriod(period) {
  currentMemberPortalPeriod = period;
  ['all', 'month', 'round'].forEach(p => {
    const btn = document.getElementById('mp-btn-' + p);
    if (btn) {
      if (p === period) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });
  renderMemberPortalTable();
}

function renderMemberPortalTable() {
  let filtered = [...currentMemberPortalTxList];

  const now = new Date();
  const currentMonthYearStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  if (currentMemberPortalPeriod === 'month') {
    filtered = filtered.filter(t => (t.date || '').startsWith(currentMonthYearStr));
  } else if (currentMemberPortalPeriod === 'round') {
    if (currentRound && currentRound.id) {
      const targetRoundIds = [String(currentRound.id)];
      if (currentRound.supabase_id) targetRoundIds.push(String(currentRound.supabase_id));
      filtered = filtered.filter(t => targetRoundIds.includes(String(t.round_id || '')));
    } else {
      // If no active round, filter to empty list
      filtered = [];
    }
  }

  let totalWeight = 0;
  let totalAmount = 0;
  let totalTrips = filtered.length;

  filtered.forEach(t => {
    totalWeight += Number(t.final_weight || t.net_weight || 0);
    totalAmount += Number(t.total_price || 0);
  });

  const wEl = document.getElementById('mp-total-weight');
  const aEl = document.getElementById('mp-total-amount');
  const tEl = document.getElementById('mp-total-trips');

  if (wEl) wEl.innerHTML = `${formatNumber(totalWeight)} <span class="unit">กก.</span>`;
  if (aEl) aEl.innerHTML = `${formatNumber(totalAmount)} <span class="unit">บาท</span>`;
  if (tEl) tEl.innerHTML = `${totalTrips} <span class="unit">ครั้ง</span>`;

  const tbody = document.getElementById('mp-history-table-body');
  const emptyState = document.getElementById('mp-history-empty');

  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) {
      emptyState.style.display = 'block';
      const emptyMsg = emptyState.querySelector('p');
      if (emptyMsg) {
        if (currentMemberPortalPeriod === 'round' && !currentRound) {
          emptyMsg.textContent = 'ขณะนี้ยังไม่มีรอบการรับซื้อที่เปิดอยู่ (กดปุ่ม "ทั้งหมด" เพื่อดูประวัติการขาย)';
        } else {
          emptyMsg.textContent = 'ยังไม่มีประวัติการขายยางในตัวกรองนี้';
        }
      }
    }
    if (tbody.closest('.table-container')) tbody.closest('.table-container').style.display = 'none';
  } else {
    if (emptyState) emptyState.style.display = 'none';
    if (tbody.closest('.table-container')) tbody.closest('.table-container').style.display = 'block';

    tbody.innerHTML = filtered.map(t => {
      const roundTitle = (t.round_id && currentMemberPortalRoundMap[String(t.round_id)])
        || (currentRound && (String(currentRound.id) === String(t.round_id) || String(currentRound.supabase_id) === String(t.round_id)) ? currentRound.title : null)
        || t.round_title;

      if (roundTitle) t.round_title = roundTitle;

      return `
      <tr>
        <td>${formatDateTime(t.date)}</td>
        <td><span class="badge ${roundTitle ? 'badge-green' : ''}" style="${!roundTitle ? 'background:rgba(255,255,255,0.08); color:var(--text-muted);' : ''}">${roundTitle || 'นอกรอบ'}</span></td>
        <td>${getRubberTypeBadge(t.rubber_type)}</td>
        <td>${t.trip_count || 1}</td>
        <td>${formatNumber(t.final_weight || t.net_weight)} กก.</td>
        <td>${formatNumber(t.price_per_kg)}</td>
        <td style="font-weight:600; color:var(--gold);">${formatNumber(t.total_price)} ฿</td>
        <td>
          <button class="btn btn-secondary btn-sm btn-icon" onclick="showReceiptFromMemberPortal('${t.id}')" title="ดูใบเสร็จ">🧾</button>
        </td>
      </tr>
      `;
    }).join('');
  }
}

function showReceiptFromMemberPortal(txId) {
  const tx = currentMemberPortalTxList.find(t => String(t.id) === String(txId));
  if (tx) {
    showReceipt(tx);
  }
}

// ========== MEMBER PORTAL PROFILE EDIT & BANK APPROVAL SYSTEM ==========

// 1. Edit Phone (Low Risk - Instant Self-Service)
function openMemberEditPhoneModal() {
  if (!currentMemberUser) return;
  const modal = document.getElementById('mp-edit-phone-modal');
  const input = document.getElementById('mp-new-phone');
  if (input) input.value = currentMemberUser.phone || '';
  if (modal) modal.classList.add('show');
}

function closeMemberEditPhoneModal() {
  const modal = document.getElementById('mp-edit-phone-modal');
  if (modal) modal.classList.remove('show');
}

async function saveMemberPhone() {
  if (!currentMemberUser || !currentMemberUser.code) return;
  const input = document.getElementById('mp-new-phone');
  const newPhone = input ? input.value.trim() : '';

  if (!newPhone) {
    showToast('กรุณากรอกเบอร์โทรศัพท์', 'error');
    return;
  }

  showLoading();
  try {
    const code = currentMemberUser.code;
    const codeNorm = normalizeMemberCodeStr(code);

    const { error } = await sb.from('members')
      .update({ phone: newPhone })
      .or(`code.eq.${code},code.eq.${codeNorm}`);

    if (error) throw error;

    // Update in session state
    currentMemberUser.phone = newPhone;
    sessionStorage.setItem('rb_member_user', JSON.stringify(currentMemberUser));

    const phoneNoEl = document.getElementById('mp-phone-no');
    if (phoneNoEl) phoneNoEl.textContent = newPhone;

    closeMemberEditPhoneModal();
    showToast('📱 อัปเดตเบอร์โทรศัพท์เรียบร้อยแล้ว!');
  } catch (err) {
    showToast('อัปเดตเบอร์โทรไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

// 2. Request Bank Account Change (High Risk - Requires Admin Approval)
function openMemberRequestBankModal() {
  if (!currentMemberUser) return;
  const modal = document.getElementById('mp-request-bank-modal');
  const input = document.getElementById('mp-new-account-no');
  if (input) input.value = '';
  if (modal) modal.classList.add('show');
}

function closeMemberRequestBankModal() {
  const modal = document.getElementById('mp-request-bank-modal');
  if (modal) modal.classList.remove('show');
}

async function submitBankChangeRequest() {
  if (!currentMemberUser || !currentMemberUser.code) return;

  const bankName = document.getElementById('mp-bank-name')?.value || 'ธกส.';
  const newAccNo = document.getElementById('mp-new-account-no')?.value.trim();

  if (!newAccNo) {
    showToast('กรุณากรอกเลขที่บัญชีธนาคารใหม่', 'error');
    return;
  }

  showLoading();
  try {
    const code = currentMemberUser.code;
    const reqPayload = {
      member_code: code,
      member_name: currentMemberUser.name,
      old_account_no: currentMemberUser.account_no || 'ยังไม่ได้ระบุ',
      new_account_no: newAccNo,
      bank_name: bankName,
      status: 'pending',
      created_at: new Date().toISOString()
    };

    let { data, error } = await sb.from('account_update_requests').insert(reqPayload).select().single();

    if (error && (error.message.includes('relation') || error.message.includes('table'))) {
      // Fallback: local storage cache if table missing in Supabase
      const reqsKey = 'bank_reqs_cache_v1';
      let existingReqs = [];
      try { existingReqs = JSON.parse(localStorage.getItem(reqsKey) || '[]'); } catch (e) {}
      const fallbackReq = { id: 'req_' + Date.now(), ...reqPayload };
      existingReqs.unshift(fallbackReq);
      localStorage.setItem(reqsKey, JSON.stringify(existingReqs));
      data = fallbackReq;
      error = null;
    } else if (error) {
      throw error;
    }

    closeMemberRequestBankModal();
    showToast('📤 ส่งคำขอแก้ไขเลขที่บัญชีแล้ว! แอดมินจะทำการตรวจสอบและอนุมัติในระบบ');
    await fetchMemberBankRequestStatus();
  } catch (err) {
    showToast('ส่งคำขอไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

async function fetchMemberBankRequestStatus() {
  if (!currentMemberUser || !currentMemberUser.code) return;

  const statusBox = document.getElementById('mp-bank-request-status-box');
  if (!statusBox) return;

  const code = currentMemberUser.code;
  const codeNorm = normalizeMemberCodeStr(code);

  try {
    let latestReq = null;
    const { data: reqs, error } = await sb.from('account_update_requests')
      .select('*')
      .or(`member_code.eq.${code},member_code.eq.${codeNorm}`)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!error && reqs && reqs.length > 0) {
      latestReq = reqs[0];
    } else {
      // Fallback check localStorage
      try {
        const localReqs = JSON.parse(localStorage.getItem('bank_reqs_cache_v1') || '[]');
        latestReq = localReqs.find(r => r.member_code === code || r.member_code === codeNorm);
      } catch (e) {}
    }

    if (latestReq) {
      statusBox.style.display = 'block';
      if (latestReq.status === 'pending') {
        statusBox.innerHTML = `
          <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.4); padding: 8px 12px; border-radius: var(--radius-md); font-size: 0.82rem; color: #f59e0b; display: flex; align-items: center; gap: 8px;">
            <span>🟡</span>
            <div>
              <strong>อยู่ระหว่างรอแอดมินตรวจสอบคำขอเปลี่ยนเลขบัญชี:</strong><br>
              ${escapeHTML(latestReq.bank_name)} เลขบัญชี: <span style="font-family:monospace; font-weight:bold;">${escapeHTML(latestReq.new_account_no)}</span>
            </div>
          </div>
        `;
      } else if (latestReq.status === 'approved') {
        statusBox.innerHTML = `
          <div style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.4); padding: 8px 12px; border-radius: var(--radius-md); font-size: 0.82rem; color: #10b981; display: flex; align-items: center; gap: 8px;">
            <span>✅</span>
            <div><strong>อนุมัติการเปลี่ยนเลขบัญชีเรียบร้อยแล้ว</strong></div>
          </div>
        `;
      } else if (latestReq.status === 'rejected') {
        statusBox.innerHTML = `
          <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.4); padding: 8px 12px; border-radius: var(--radius-md); font-size: 0.82rem; color: #ef4444; display: flex; align-items: center; gap: 8px;">
            <span>❌</span>
            <div>
              <strong>คำขอเปลี่ยนเลขบัญชีถูกปฏิเสธ:</strong> ${escapeHTML(latestReq.rejection_note || 'ข้อมูลไม่ถูกต้อง')}
            </div>
          </div>
        `;
      }
    } else {
      statusBox.style.display = 'none';
    }
  } catch (e) {
    statusBox.style.display = 'none';
  }
}

// 3. Admin Bank Account Change Requests Approval Workflow
let currentAdminBankFilter = 'pending';

async function fetchAdminPendingBankRequestsCount() {
  const badgeEl = document.getElementById('admin-pending-bank-count');
  if (!badgeEl) return;

  try {
    const { count, error } = await sb.from('account_update_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (!error) {
      badgeEl.textContent = count || 0;
    } else {
      // Local storage check fallback
      const localReqs = JSON.parse(localStorage.getItem('bank_reqs_cache_v1') || '[]');
      const pendingCount = localReqs.filter(r => r.status === 'pending').length;
      badgeEl.textContent = pendingCount;
    }
  } catch (e) {
    badgeEl.textContent = '0';
  }
}

function openAdminBankRequestsModal() {
  const modal = document.getElementById('admin-bank-requests-modal');
  if (modal) modal.classList.add('show');
  setAdminBankRequestFilter('pending');
}

function closeAdminBankRequestsModal() {
  const modal = document.getElementById('admin-bank-requests-modal');
  if (modal) modal.classList.remove('show');
}

function setAdminBankRequestFilter(filter) {
  currentAdminBankFilter = filter;
  ['pending', 'approved', 'rejected'].forEach(f => {
    const btn = document.getElementById('abr-filter-' + f);
    if (btn) {
      if (f === filter) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });
  renderAdminBankRequests();
}

async function renderAdminBankRequests() {
  const tbody = document.getElementById('admin-bank-requests-tbody');
  const emptyState = document.getElementById('admin-bank-requests-empty');
  if (!tbody) return;

  showLoading();
  try {
    let requests = [];
    const { data: sbReqs, error } = await sb.from('account_update_requests')
      .select('*')
      .eq('status', currentAdminBankFilter)
      .order('created_at', { ascending: false });

    if (!error) {
      requests = sbReqs || [];
    } else {
      // Fallback local storage
      const localReqs = JSON.parse(localStorage.getItem('bank_reqs_cache_v1') || '[]');
      requests = localReqs.filter(r => r.status === currentAdminBankFilter);
    }

    if (requests.length === 0) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      if (tbody.closest('.table-container')) tbody.closest('.table-container').style.display = 'none';
    } else {
      if (emptyState) emptyState.style.display = 'none';
      if (tbody.closest('.table-container')) tbody.closest('.table-container').style.display = 'block';

      tbody.innerHTML = requests.map(r => `
        <tr>
          <td>${formatDateTime(r.created_at)}</td>
          <td>
            <span class="badge badge-green">${escapeHTML(r.member_code)}</span>
            <strong>${escapeHTML(r.member_name)}</strong>
          </td>
          <td>${escapeHTML(r.bank_name)}</td>
          <td style="font-family:monospace; color:var(--text-muted);">${escapeHTML(r.old_account_no || '-')}</td>
          <td style="font-family:monospace; font-weight:bold; color:var(--gold);">${escapeHTML(r.new_account_no)}</td>
          <td>
            ${r.status === 'pending' ? '<span class="badge badge-warning">🟡 รออนุมัติ</span>' :
              r.status === 'approved' ? '<span class="badge badge-green">✅ อนุมัติแล้ว</span>' :
              '<span class="badge badge-danger">❌ ปฏิเสธแล้ว</span>'}
          </td>
          <td>
            ${r.status === 'pending' ? `
              <button class="btn btn-primary btn-sm" onclick="approveBankChangeRequest('${r.id}')">✅ อนุมัติ</button>
              <button class="btn btn-danger btn-sm" onclick="rejectBankChangeRequest('${r.id}')" style="margin-left:4px;">❌ ปฏิเสธ</button>
            ` : `
              <small style="color:var(--text-muted);">${r.reviewed_by_name ? 'โดย ' + escapeHTML(r.reviewed_by_name) : '-'}</small>
            `}
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    showToast('โหลดรายการคำขอไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

async function approveBankChangeRequest(reqId) {
  showLoading();
  try {
    let targetReq = null;
    const { data: sbReq } = await sb.from('account_update_requests').select('*').eq('id', reqId).maybeSingle();
    if (sbReq) {
      targetReq = sbReq;
    } else {
      const localReqs = JSON.parse(localStorage.getItem('bank_reqs_cache_v1') || '[]');
      targetReq = localReqs.find(r => String(r.id) === String(reqId));
    }

    if (!targetReq) throw new Error('ไม่พบข้อมูลคำขอ');

    const memberCode = targetReq.member_code;
    const codeNorm = normalizeMemberCodeStr(memberCode);
    const newAccNo = targetReq.new_account_no;

    // 1. Update member account_no in members table
    const { error: memErr } = await sb.from('members')
      .update({ account_no: newAccNo })
      .or(`code.eq.${memberCode},code.eq.${codeNorm}`);

    if (memErr) throw memErr;

    // FIX H6: Also update SQLite member account_no for Desktop offline support
    if (isDesktopApp()) {
      try {
        await window.desktopDB.run('UPDATE members SET account_no = ? WHERE code = ? OR code = ?', [newAccNo, memberCode, codeNorm]);
      } catch (e) { console.warn('SQLite member account_no update failed:', e); }
    }

    // 2. Update request status to 'approved'
    const adminName = currentUser?.display_name || 'ผู้ดูแลระบบ';
    const { error: reqErr } = await sb.from('account_update_requests')
      .update({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewed_by_name: adminName
      })
      .eq('id', reqId);

    if (reqErr) {
      // Local storage fallback update
      const localReqs = JSON.parse(localStorage.getItem('bank_reqs_cache_v1') || '[]');
      const item = localReqs.find(r => String(r.id) === String(reqId));
      if (item) {
        item.status = 'approved';
        item.reviewed_at = new Date().toISOString();
        item.reviewed_by_name = adminName;
        localStorage.setItem('bank_reqs_cache_v1', JSON.stringify(localReqs));
      }
    }

    showToast(`✅ อนุมัติการเปลี่ยนเลขบัญชีของ ${targetReq.member_name} (${newAccNo}) เรียบร้อยแล้ว!`);
    await renderAdminBankRequests();
    await fetchAdminPendingBankRequestsCount();
    if (typeof renderMembers === 'function') await renderMembers();
  } catch (err) {
    showToast('อนุมัติไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

async function rejectBankChangeRequest(reqId) {
  const note = window.prompt('กรุณาระบุเหตุผลการปฏิเสธคำขอ (ไม่บังคับ):', 'ข้อมูลเลขบัญชีไม่ถูกต้อง');
  if (note === null) return; // user cancelled

  showLoading();
  try {
    const adminName = currentUser?.display_name || 'ผู้ดูแลระบบ';
    const { error } = await sb.from('account_update_requests')
      .update({
        status: 'rejected',
        rejection_note: note || 'ข้อมูลไม่ถูกต้อง',
        reviewed_at: new Date().toISOString(),
        reviewed_by_name: adminName
      })
      .eq('id', reqId);

    if (error) {
      // Local storage fallback
      const localReqs = JSON.parse(localStorage.getItem('bank_reqs_cache_v1') || '[]');
      const item = localReqs.find(r => String(r.id) === String(reqId));
      if (item) {
        item.status = 'rejected';
        item.rejection_note = note || 'ข้อมูลไม่ถูกต้อง';
        item.reviewed_at = new Date().toISOString();
        item.reviewed_by_name = adminName;
        localStorage.setItem('bank_reqs_cache_v1', JSON.stringify(localReqs));
      }
    }

    showToast('❌ ปฏิเสธคำขอเปลี่ยนเลขบัญชีเรียบร้อยแล้ว');
    await renderAdminBankRequests();
    await fetchAdminPendingBankRequestsCount();
  } catch (err) {
    showToast('ปฏิเสธไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

// ========== MEMBER PASSWORD CHANGE & ADMIN RESET (MOVED TO js/auth.js) ==========
// getStoredMemberPassword, setStoredMemberPassword, openMemberChangePasswordModal,
// closeMemberChangePasswordModal, saveMemberNewPassword, openAdminResetMemberPasswordModal,
// closeAdminResetMemberPasswordModal, confirmAdminResetMemberPassword are now in js/auth.js

// ========== ANNOUNCEMENT SYSTEM (MEMBER PORTAL & ADMIN) ==========

function getMemberDismissKey() {
  if (currentMemberUser && currentMemberUser.code) {
    const code = normalizeMemberCodeStr(currentMemberUser.code) || currentMemberUser.code;
    return `dismissed_announcements_${code}_v1`;
  }
  return 'dismissed_announcements_guest_v1';
}

// 1. Member Side: Fetch & Render Active Announcements Box
async function fetchMemberPortalAnnouncements() {
  const container = document.getElementById('mp-announcements-container');
  if (!container) return;

  try {
    let announcements = [];
    const { data: sbData, error } = await sb.from('announcements')
      .select('*')
      .eq('is_active', true)
      .order('updated_at', { ascending: false });

    const localData = JSON.parse(localStorage.getItem('announcements_cache_v1') || '[]');
    if (!error && sbData) {
      const sbIds = new Set(sbData.map(a => String(a.id)));
      const extraLocal = localData.filter(a => a.is_active && !sbIds.has(String(a.id)));
      announcements = [...sbData, ...extraLocal];
    } else {
      announcements = localData.filter(a => a.is_active);
    }

    const dismissKey = getMemberDismissKey();

    let dismissedMap = {};
    try {
      dismissedMap = JSON.parse(localStorage.getItem(dismissKey) || '{}');
    } catch (e) {}

    const visibleAnnouncements = announcements.filter(a => {
      const dismissedUpdatedAt = dismissedMap[a.id];
      if (!dismissedUpdatedAt) return true;
      return new Date(a.updated_at || a.created_at) > new Date(dismissedUpdatedAt);
    });

    if (visibleAnnouncements.length === 0) {
      container.innerHTML = '';
      container.style.display = 'none';
    } else {
      container.style.display = 'block';
      container.innerHTML = visibleAnnouncements.map(a => `
        <div class="glass-card mb-3 announcement-card" id="announcement-card-${a.id}" style="padding: 16px 20px; border-left: 5px solid var(--gold); background: linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(212, 168, 67, 0.1)); border-radius: var(--radius-lg); position: relative; animation: fadeIn 0.3s ease;">
          <button onclick="dismissMemberAnnouncement('${a.id}', '${a.updated_at || a.created_at}')" style="position: absolute; right: 14px; top: 14px; background: rgba(255,255,255,0.1); border: none; color: var(--text-secondary); width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s ease;" title="ปิดประกาศนี้">✕</button>
          <div style="display: flex; align-items: flex-start; gap: 12px; padding-right: 32px;">
            <div style="font-size: 1.5rem; flex-shrink: 0; line-height: 1;">📢</div>
            <div>
              ${a.title ? `<h3 style="font-size: 1.05rem; font-weight: 700; color: #fff; margin: 0 0 6px 0;">${escapeHTML(a.title)}</h3>` : ''}
              <div style="font-size: 0.92rem; color: #e2e8f0; line-height: 1.6; white-space: pre-wrap;">${escapeHTML(a.content)}</div>
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 8px;">
                🕒 ประกาศเมื่อ: ${formatDateTime(a.updated_at || a.created_at)} ${a.created_by_name ? 'โดย ' + escapeHTML(a.created_by_name) : ''}
              </div>
            </div>
          </div>
        </div>
      `).join('');
    }
  } catch (e) {
    console.warn('Fetch announcements error:', e);
    container.style.display = 'none';
  }
}

function dismissMemberAnnouncement(id, updatedAt) {
  try {
    const dismissKey = getMemberDismissKey();

    let dismissedMap = {};
    try {
      dismissedMap = JSON.parse(localStorage.getItem(dismissKey) || '{}');
    } catch (e) {}

    dismissedMap[id] = updatedAt || new Date().toISOString();
    localStorage.setItem(dismissKey, JSON.stringify(dismissedMap));

    const card = document.getElementById('announcement-card-' + id);
    if (card) {
      card.style.opacity = '0';
      card.style.transform = 'translateY(-10px)';
      card.style.transition = 'all 0.3s ease';
      setTimeout(() => {
        card.remove();
        const container = document.getElementById('mp-announcements-container');
        if (container && container.children.length === 0) {
          container.style.display = 'none';
        }
      }, 300);
    }
  } catch (e) {
    console.error('Dismiss announcement error:', e);
  }
}

// 2. Admin Side: Manage Announcements CRUD & Toggles
async function renderAnnouncements() {
  const tbody = document.getElementById('announcements-table-body');
  const emptyState = document.getElementById('announcements-empty');
  if (!tbody) return;

  showLoading();
  try {
    let announcements = [];
    const { data: sbData, error } = await sb.from('announcements')
      .select('*')
      .order('created_at', { ascending: false });

    const localData = JSON.parse(localStorage.getItem('announcements_cache_v1') || '[]');

    if (!error && sbData) {
      const sbIds = new Set(sbData.map(a => String(a.id)));
      const extraLocal = localData.filter(a => !sbIds.has(String(a.id)));
      announcements = [...sbData, ...extraLocal];
    } else {
      announcements = localData;
    }

    if (announcements.length === 0) {
      tbody.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      if (tbody.closest('.table-container')) tbody.closest('.table-container').style.display = 'none';
    } else {
      if (emptyState) emptyState.style.display = 'none';
      if (tbody.closest('.table-container')) tbody.closest('.table-container').style.display = 'block';

      tbody.innerHTML = announcements.map(a => `
        <tr>
          <td>${formatDateTime(a.updated_at || a.created_at)}</td>
          <td><strong>${escapeHTML(a.title || 'ไม่มีหัวข้อ')}</strong></td>
          <td style="max-width:320px; white-space:pre-wrap; font-size:0.88rem;">${escapeHTML(a.content)}</td>
          <td><small style="color:var(--text-muted);">${escapeHTML(a.created_by_name || '-')}</small></td>
          <td>
            ${a.is_active ? `
              <button class="btn btn-sm btn-gold" onclick="toggleAnnouncementStatus('${a.id}', false)" style="padding:3px 10px; font-size:0.78rem;">🟢 เปิดใช้งานอยู่</button>
            ` : `
              <button class="btn btn-sm btn-secondary" onclick="toggleAnnouncementStatus('${a.id}', true)" style="padding:3px 10px; font-size:0.78rem;">⚪ ปิดใช้งาน</button>
            `}
          </td>
          <td>
            <button class="btn btn-secondary btn-sm btn-icon" onclick="openAnnouncementModal('${a.id}')" title="แก้ไขประกาศ">✏️</button>
            <button class="btn btn-gold btn-sm btn-icon" onclick="resendAnnouncementNotice('${a.id}')" title="ส่งการแจ้งเตือนใหม่หาทุกคน" style="margin-left:4px;">🔔</button>
            <button class="btn btn-danger btn-sm btn-icon" onclick="confirmDeleteAnnouncement('${a.id}')" title="ลบประกาศ" style="margin-left:4px;">🗑️</button>
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    showToast('โหลดข้อมูลประกาศไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

async function resendAnnouncementNotice(id) {
  showLoading();
  try {
    const nowIso = new Date().toISOString();
    let { error } = await sb.from('announcements')
      .update({ is_active: true, updated_at: nowIso })
      .eq('id', id);

    if (error) {
      const localData = JSON.parse(localStorage.getItem('announcements_cache_v1') || '[]');
      const item = localData.find(a => String(a.id) === String(id));
      if (item) {
        item.is_active = true;
        item.updated_at = nowIso;
        localStorage.setItem('announcements_cache_v1', JSON.stringify(localData));
      }
    }

    showToast('🔔 ส่งการแจ้งเตือนประกาศนี้ให้สมาชิกทุกคนอีกครั้งเรียบร้อยแล้ว!');
    await renderAnnouncements();
  } catch (err) {
    showToast('ส่งการแจ้งเตือนไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

async function openAnnouncementModal(id = null) {
  const modal = document.getElementById('announcement-modal');
  const titleHeader = document.getElementById('announcement-modal-title');
  const hiddenId = document.getElementById('announcement-id-hidden');
  const titleIn = document.getElementById('announcement-title');
  const contentIn = document.getElementById('announcement-content');
  const statusIn = document.getElementById('announcement-status');

  if (id) {
    let item = null;
    try {
      const { data } = await sb.from('announcements').select('*').eq('id', id).single();
      item = data;
    } catch (e) {
      const localData = JSON.parse(localStorage.getItem('announcements_cache_v1') || '[]');
      item = localData.find(a => String(a.id) === String(id));
    }

    if (!item) return;

    if (titleHeader) titleHeader.textContent = '✏️ แก้ไขข้อความประกาศ';
    if (hiddenId) hiddenId.value = item.id;
    if (titleIn) titleIn.value = item.title || '';
    if (contentIn) contentIn.value = item.content || '';
    if (statusIn) statusIn.value = item.is_active ? 'true' : 'false';
  } else {
    if (titleHeader) titleHeader.textContent = '📢 เขียนประกาศข่าวสารใหม่';
    if (hiddenId) hiddenId.value = '';
    if (titleIn) titleIn.value = '';
    if (contentIn) contentIn.value = '';
    if (statusIn) statusIn.value = 'true';
  }

  if (modal) modal.classList.add('show');
}

function closeAnnouncementModal() {
  const modal = document.getElementById('announcement-modal');
  if (modal) modal.classList.remove('show');
}

async function saveAnnouncement() {
  const hiddenId = document.getElementById('announcement-id-hidden')?.value;
  const title = document.getElementById('announcement-title')?.value.trim();
  const content = document.getElementById('announcement-content')?.value.trim();
  const isActive = document.getElementById('announcement-status')?.value === 'true';

  if (!content) {
    showToast('กรุณากรอกรายละเอียดข้อความประกาศ', 'error');
    return;
  }

  showLoading();
  try {
    const creatorName = currentUser?.display_name || currentUser?.username || 'ผู้ดูแลระบบ';
    const nowIso = new Date().toISOString();

    const payload = {
      title,
      content,
      is_active: isActive,
      updated_at: nowIso,
      created_by_name: creatorName
    };

    if (hiddenId) {
      // Update existing
      let { error } = await sb.from('announcements').update(payload).eq('id', hiddenId);
      if (error) {
        const localData = JSON.parse(localStorage.getItem('announcements_cache_v1') || '[]');
        const idx = localData.findIndex(a => String(a.id) === String(hiddenId));
        if (idx !== -1) {
          localData[idx] = { ...localData[idx], ...payload };
          localStorage.setItem('announcements_cache_v1', JSON.stringify(localData));
        }
      }
      showToast('✏️ แก้ไขประกาศข่าวสารเรียบร้อยแล้ว!');
    } else {
      // Create new
      payload.created_at = nowIso;
      let { error } = await sb.from('announcements').insert(payload);
      if (error) {
        const localData = JSON.parse(localStorage.getItem('announcements_cache_v1') || '[]');
        const newItem = { id: 'anc_' + Date.now(), ...payload };
        localData.unshift(newItem);
        localStorage.setItem('announcements_cache_v1', JSON.stringify(localData));
      }
      showToast('📢 เพิ่มประกาศข่าวสารเรียบร้อยแล้ว!');
    }

    closeAnnouncementModal();
    await renderAnnouncements();
  } catch (err) {
    showToast('บันทึกประกาศไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

async function toggleAnnouncementStatus(id, newStatus) {
  showLoading();
  try {
    const nowIso = new Date().toISOString();
    let { error } = await sb.from('announcements')
      .update({ is_active: newStatus, updated_at: nowIso })
      .eq('id', id);

    if (error) {
      const localData = JSON.parse(localStorage.getItem('announcements_cache_v1') || '[]');
      const item = localData.find(a => String(a.id) === String(id));
      if (item) {
        item.is_active = newStatus;
        item.updated_at = nowIso;
        localStorage.setItem('announcements_cache_v1', JSON.stringify(localData));
      }
    }

    showToast(newStatus ? '🟢 เปิดใช้งานประกาศเรียบร้อยแล้ว!' : '⚪ ปิดใช้งานประกาศเรียบร้อยแล้ว');
    await renderAnnouncements();
  } catch (err) {
    showToast('สลับสถานะประกาศไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

async function confirmDeleteAnnouncement(id) {
  if (!window.confirm('คุณต้องการลบข้อความประกาศนี้ใช่หรือไม่?')) return;

  showLoading();
  try {
    let { error } = await sb.from('announcements').delete().eq('id', id);
    if (error) {
      const localData = JSON.parse(localStorage.getItem('announcements_cache_v1') || '[]');
      const filtered = localData.filter(a => String(a.id) !== String(id));
      localStorage.setItem('announcements_cache_v1', JSON.stringify(filtered));
    }
    showToast('🗑️ ลบข้อความประกาศเรียบร้อยแล้ว');
    await renderAnnouncements();
  } catch (err) {
    showToast('ลบประกาศไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

// ========== REALTIME SUBSCRIPTIONS & AUTO RECONNECT ==========
let realtimeChannel = null;

function cleanupRealtimeSubscriptions() {
  if (sb && realtimeChannel) {
    try {
      sb.removeChannel(realtimeChannel);
    } catch (e) {
      console.warn('Realtime channel remove error:', e);
    }
    realtimeChannel = null;
  }
}

function initRealtimeSubscriptions() {
  if (!sb) return;
  if (realtimeChannel) {
    cleanupRealtimeSubscriptions();
  }

  const badgeEl = document.getElementById('realtime-status-badge');

  realtimeChannel = sb.channel('dashboard-realtime-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'transactions' },
      async (payload) => {
        console.log('Realtime transaction change detected:', payload);
        if (payload.eventType === 'INSERT') {
          const t = payload.new;
          if (isDesktopApp()) {
            try {
              const existing = await window.desktopDB.query(
                'SELECT id FROM transactions WHERE supabase_id = ? OR (member_code = ? AND (round_id = ? OR round_id = (SELECT id FROM purchase_rounds WHERE supabase_id = ?)) AND ABS(final_weight - ?) < 0.01) LIMIT 1',
                [String(t.id), t.member_code, String(t.round_id), String(t.round_id), t.final_weight || t.net_weight || 0]
              );
              if (!existing || existing.length === 0) {
                const localTx = {
                  ...t,
                  supabase_id: t.id,
                  synced: 1,
                  trips: typeof t.trips === 'string' ? t.trips : JSON.stringify(t.trips || []),
                  trips_detail: typeof t.trips_detail === 'string' ? t.trips_detail : JSON.stringify(t.trips_detail || [])
                };
                delete localTx.id;
                await window.desktopDB.insert('transactions', localTx);
              }
            } catch (e) {
              console.warn('Realtime SQLite insert error:', e);
            }
          }
          const weightStr = formatNumber(t.final_weight || t.net_weight);
          const amountStr = formatNumber(t.total_price);
          showToast(`⚡ มีรายการใหม่! รหัส ${t.member_code} (${t.member_name}) — ${weightStr} กก. [${amountStr} ฿]`, 'info');
        } else if (payload.eventType === 'DELETE') {
          if (isDesktopApp() && payload.old && payload.old.id) {
            try {
              await window.desktopDB.delete('transactions', { supabase_id: payload.old.id });
            } catch (e) {}
          }
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
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'store_products' },
      async (payload) => {
        console.log('Realtime store_products change detected:', payload);
        const p = payload.new;
        if (payload.eventType === 'INSERT' && p) {
          if (isDesktopApp()) {
            try {
              const pNameTrim = (p.name || '').trim().toLowerCase();
              const existing = await window.desktopDB.query(
                'SELECT id FROM store_products WHERE supabase_id = ? OR TRIM(LOWER(name)) = ? LIMIT 1',
                [String(p.id), pNameTrim]
              );
              if (!existing || existing.length === 0) {
                await window.desktopDB.insert('store_products', {
                  name: p.name,
                  unit: p.unit || 'ชิ้น',
                  cost_price: p.cost_price || 0,
                  price: p.price || 0,
                  stock_quantity: p.stock_quantity || 0,
                  is_active: p.is_active ? 1 : 0,
                  synced: 1,
                  supabase_id: String(p.id)
                });
              } else {
                await window.desktopDB.run(
                  'UPDATE store_products SET name = ?, unit = ?, cost_price = ?, price = ?, stock_quantity = ?, is_active = ?, supabase_id = ? WHERE id = ?',
                  [p.name, p.unit || 'ชิ้น', p.cost_price || 0, p.price || 0, p.stock_quantity || 0, p.is_active ? 1 : 0, String(p.id), existing[0].id]
                );
              }
            } catch (e) {
              console.warn('Realtime store_products SQLite insert error:', e);
            }
          }
          if (typeof renderStoreProducts === 'function') await renderStoreProducts();
          if (typeof renderPosProducts === 'function') renderPosProducts();
          showToast(`📦 มีสินค้าใหม่เพิ่มจากเครื่องอื่น: ${p.name}!`, 'info');
        } else if (payload.eventType === 'UPDATE' && p) {
          if (isDesktopApp()) {
            try {
              const pNameTrim = (p.name || '').trim().toLowerCase();
              await window.desktopDB.run(
                'UPDATE store_products SET name = ?, unit = ?, cost_price = ?, price = ?, stock_quantity = ?, is_active = ?, supabase_id = ? WHERE supabase_id = ? OR TRIM(LOWER(name)) = ?',
                [p.name, p.unit || 'ชิ้น', p.cost_price || 0, p.price || 0, p.stock_quantity || 0, p.is_active ? 1 : 0, String(p.id), String(p.id), pNameTrim]
              );
            } catch (e) {
              console.warn('Realtime store_products SQLite update error:', e);
            }
          }
          if (typeof renderStoreProducts === 'function') await renderStoreProducts();
          if (typeof renderPosProducts === 'function') renderPosProducts();
        } else if (payload.eventType === 'DELETE') {
          const oldP = payload.old;
          if (isDesktopApp() && oldP && oldP.id) {
            try {
              await window.desktopDB.run('DELETE FROM store_products WHERE supabase_id = ?', [String(oldP.id)]);
            } catch (e) {}
          }
          if (typeof renderStoreProducts === 'function') await renderStoreProducts();
          if (typeof renderPosProducts === 'function') renderPosProducts();
        }
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'store_transactions' },
      async (payload) => {
        console.log('Realtime store_transactions change detected:', payload);
        const st = payload.new;
        if (payload.eventType === 'INSERT' && st) {
          if (isDesktopApp()) {
            try {
              const existing = await window.desktopDB.query(
                'SELECT id FROM store_transactions WHERE supabase_id = ? OR (receipt_no = ? AND receipt_no != "") LIMIT 1',
                [String(st.id), st.receipt_no || '']
              );
              if (!existing || existing.length === 0) {
                const itemsStr = typeof st.items === 'string' ? st.items : JSON.stringify(st.items || []);
                await window.desktopDB.insert('store_transactions', {
                  receipt_no: st.receipt_no || '',
                  member_code: st.member_code || '',
                  customer_name: st.customer_name || '',
                  total_amount: st.total_amount || 0,
                  cash_received: st.cash_received || 0,
                  change_amount: st.change_amount || 0,
                  items: itemsStr,
                  payment_method: st.payment_method || 'cash',
                  created_by_name: st.created_by_name || '',
                  created_at: st.created_at || new Date().toISOString(),
                  synced: 1,
                  supabase_id: String(st.id)
                });
              }
            } catch (e) {
              console.warn('Realtime store_transactions SQLite insert error:', e);
            }
          }
          if (typeof renderStoreSalesHistory === 'function') await renderStoreSalesHistory();
          showToast(`🧾 มีบิลขายสินค้าใหม่จากเครื่องอื่น: ${st.receipt_no || ''} (${formatNumber(st.total_amount)} ฿)`, 'info');
        } else if (payload.eventType === 'DELETE') {
          const oldSt = payload.old;
          if (isDesktopApp() && oldSt && oldSt.id) {
            try {
              await window.desktopDB.run('DELETE FROM store_transactions WHERE supabase_id = ?', [String(oldSt.id)]);
            } catch (e) {}
          }
          if (typeof renderStoreSalesHistory === 'function') await renderStoreSalesHistory();
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

function applyThemeMode(theme) {
  const targetTheme = (theme === 'light') ? 'light' : 'dark';
  document.body.setAttribute('data-theme', targetTheme);
  try {
    localStorage.setItem('setting_theme_mode', targetTheme);
  } catch (e) {}

  let metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (!metaThemeColor) {
    metaThemeColor = document.createElement('meta');
    metaThemeColor.name = 'theme-color';
    document.head.appendChild(metaThemeColor);
  }
  metaThemeColor.content = (targetTheme === 'light') ? '#f0f4f2' : '#060f0a';

  const radioEls = document.querySelectorAll('input[name="setting-theme-mode"]');
  radioEls.forEach(r => {
    r.checked = (r.value === targetTheme);
  });
}

function previewThemeMode(theme) {
  applyThemeMode(theme);
}

async function loadSettings() {
  try {
    let data = null;
    if (isDesktopApp()) {
      const res = await window.desktopDB.select('settings', ['*'], { id: 1 });
      if (res && res.length > 0) data = res[0];
    } else if (sb && navigator.onLine) {
      try {
        const res = await sb.from('settings').select('*').eq('id', 1).single();
        if (!res.error && res.data) data = res.data;
      } catch (e) { /* ignore */ }
    }

    if (data) {
      // Database values are the SINGLE SOURCE OF TRUTH when online
      cachedSettings = {
        plantation_name: data.plantation_name || 'กลุ่มเกษตรกรชาวสวนยาง กยท.ท่าสะแก',
        plantation_address: data.plantation_address || 'เลขที่ 127 หมู่7 ต.ท่าสะแก อ.ชาติตระการ จ.พิษณุโลก',
        auction_buyer: data.auction_buyer || 'เฮียต้อม ยางพารา',
        plantation_logo: data.plantation_logo || '',
        price_cup: Number(data.price_cup ?? 35),
        price_sheet: Number(data.price_sheet ?? 45),
        price_latex: Number(data.price_latex ?? 50),
        yard_fee: Number(data.yard_fee ?? 0.50),
        default_cart_weight: Number(data.default_cart_weight ?? 5),
        deduction_percent: Number(data.deduction_percent ?? 0),
        dual_station_mode: data.dual_station_mode === true,
        show_payer_name: data.show_payer_name !== false,
        theme_mode: data.theme_mode || localStorage.getItem('setting_theme_mode') || 'dark'
      };

      // Sync fetched database settings into local cache backup
      try {
        localStorage.setItem('setting_auction_buyer', cachedSettings.auction_buyer);
        localStorage.setItem('setting_plantation_address', cachedSettings.plantation_address);
        localStorage.setItem('setting_yard_fee', String(cachedSettings.yard_fee));
        localStorage.setItem('setting_dual_station_mode', String(cachedSettings.dual_station_mode));
        localStorage.setItem('setting_show_payer_name', String(cachedSettings.show_payer_name));
        localStorage.setItem('setting_theme_mode', cachedSettings.theme_mode);
        if (cachedSettings.plantation_logo) {
          localStorage.setItem('setting_plantation_logo', cachedSettings.plantation_logo);
        } else {
          localStorage.removeItem('setting_plantation_logo');
        }
      } catch (e) {}
    } else {
      // Offline fallback: read from local backup
      const localDualMode = localStorage.getItem('setting_dual_station_mode');
      const localShowPayer = localStorage.getItem('setting_show_payer_name');
      const localYardFee = localStorage.getItem('setting_yard_fee');
      const localAddr = localStorage.getItem('setting_plantation_address');
      const localBuyer = localStorage.getItem('setting_auction_buyer');
      const localLogo = localStorage.getItem('setting_plantation_logo');
      const localTheme = localStorage.getItem('setting_theme_mode');

      cachedSettings = {
        plantation_name: 'กลุ่มเกษตรกรชาวสวนยาง กยท.ท่าสะแก',
        plantation_address: localAddr || 'เลขที่ 127 หมู่7 ต.ท่าสะแก อ.ชาติตระการ จ.พิษณุโลก',
        auction_buyer: localBuyer || 'เฮียต้อม ยางพารา',
        plantation_logo: localLogo || '',
        price_cup: 35, price_sheet: 45, price_latex: 50,
        default_cart_weight: 5, deduction_percent: 0,
        dual_station_mode: localDualMode !== null ? localDualMode === 'true' : false,
        show_payer_name: localShowPayer !== null ? localShowPayer === 'true' : true,
        yard_fee: localYardFee !== null ? parseFloat(localYardFee) : 0.50,
        theme_mode: localTheme || 'dark'
      };
    }

    applyThemeMode(cachedSettings.theme_mode);
    updatePlantationName();
    updatePurchaseDualModeUI();
    return cachedSettings;
  } catch (err) {
    console.error('Failed to load settings:', err);
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

async function removeCustomLogo() {
  currentCustomLogoBase64 = '';
  localStorage.removeItem('setting_plantation_logo');
  if (cachedSettings) cachedSettings.plantation_logo = '';
  if (isDesktopApp()) {
    try {
      await window.desktopDB.update('settings', { plantation_logo: '' }, { id: 1 });
    } catch (e) {}
  }
  if (sb && !isAppOffline()) {
    try {
      await sb.from('settings').update({ plantation_logo: '' }).eq('id', 1);
    } catch (e) {}
  }
  updatePlantationLogo();
  showToast('คืนค่าโลโก้เป็นแบบเริ่มต้น (🌿) เรียบร้อยแล้ว!');
}

function updatePlantationName() {
  const name = cachedSettings?.plantation_name || 'ลานยางพาราชุมชน';
  document.getElementById('sidebar-plantation-name').textContent = name;
  document.getElementById('login-plantation-name').textContent = name;
  updatePlantationLogo();
}

// updatePurchaseDualModeUI has moved to js/purchase.js

// ========== PURCHASE ROUNDS MANAGEMENT (MOVED TO js/rounds.js) ==========
// loadCurrentRound, updateRoundBanner, openStartRoundModal, closeStartRoundModal,
// saveStartNewRound, confirmCloseRound, closeRound, renderRounds, showRoundReport,
// switchRoundReportView, onRoundReportFormatChange, renderRoundReportContent,
// closeRoundReportModal, exportRoundToExcel, printRoundReport, confirmDeleteRound,
// deleteRound are now in js/rounds.js

// ========== MEMBER SALES HISTORY (MOVED TO js/members.js) ==========
// showMemberSalesHistory, closeMemberSalesModal, onMemberSummaryFormatChange,
// printMemberSalesSummary are now in js/members.js

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
    case 'store-inventory': if (typeof initStoreSection === 'function') { initStoreSection(); } else { renderStoreProducts(); } break;
    case 'announcements': renderAnnouncements(); break;
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

// ========== DASHBOARD & LEADERBOARD (MOVED TO js/dashboard.js) ==========
// renderDashboard, switchDashboardView, populateDashboardScopeFilter,
// renderDashboardLeaderboard are now in js/dashboard.js

// ========== MEMBERS CRUD (MOVED TO js/members.js) ==========
// renderMembers, searchMembers, openMemberModal, closeMemberModal,
// saveMember, confirmDeleteMember, deleteMember are now in js/members.js

function closeConfirmModal() {
  document.getElementById('confirm-modal').classList.remove('show');
}

// ========== PURCHASE & RECEIPT MANAGEMENT (MOVED TO js/purchase.js) ==========
// initPurchase, updatePurchaseTruckIndicator, openAddTruckModal, closeAddTruckModal,
// confirmAddTruck, onPurchaseTruckSelect, addTrip, removeTrip, onTripGrossKeydown,
// renderTrips, onTripInput, executeSearchPurchaseMember, searchPurchaseMember,
// handlePurchaseMemberKeydown, updateMemberKeyboardFocus, selectPurchaseMember,
// clearSelectedMember, onRubberTypeChange, calculatePrice, saveTransaction,
// openWeightWarningModal, closeWeightWarningModal, buildReceiptCopyHTML, showReceipt,
// renderReceiptContent, closeReceiptModal, printReceipt are now in js/purchase.js

// ========== TRANSACTION HISTORY, TRUCK WEIGHTS & DELETION (MOVED TO js/history.js) ==========
// renderHistory, filterHistory, toggleSelectAllHistory, deselectAllHistory,
// getSelectedHistoryIds, updateHistoryBatchDeleteUI, confirmDeleteSelectedHistory,
// deleteSelectedHistory, confirmDeleteAllFilteredHistory, deleteAllFilteredHistory,
// renderTruckWeights, showTruckMembersModal, closeTruckMembersModal,
// closeEditTruckDeliveryModal, saveEditTruckDelivery, closeTruckDetailModal,
// printTruckWeightsReport, toggleHistoryOnlyUnassignedTruck, goToHistoryForUnassignedTruck,
// clearHistoryFilter, openQuickAssignTruckModal, closeQuickAssignTruckModal,
// confirmQuickAssignTruck, confirmDeleteTransaction, deleteTransaction are now in js/history.js

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

// ========== PROFILE & USER MANAGEMENT (MOVED TO js/auth.js) ==========
// saveProfileName, changeMyPassword, renderUsers, openUserModal,
// closeUserModal, saveUser, confirmDeleteUser, deleteUser are now in js/auth.js

// ========== SETTINGS TAB NAVIGATION & SYNC QUEUE ==========
function switchSettingsTab(tabId) {
  const tabs = ['purchase', 'display', 'sync', 'system'];
  tabs.forEach(t => {
    const btn = document.getElementById('tab-btn-' + t);
    const content = document.getElementById('settings-tab-' + t);
    if (btn) {
      if (t === tabId) btn.classList.add('active');
      else btn.classList.remove('active');
    }
    if (content) {
      content.style.display = (t === tabId) ? 'block' : 'none';
    }
  });

  if (tabId === 'sync') {
    updateSyncQueueCounts();
  }
}

async function updateSyncQueueCounts(showToastFeedback = false) {
  let txQueueCount = 0;
  let memberQueueCount = 0;
  let storeQueueCount = 0;

  try {
    if (typeof window !== 'undefined' && window.desktopDB && typeof window.desktopDB.query === 'function') {
      const txRows = await window.desktopDB.query("SELECT count(*) as cnt FROM sync_queue WHERE table_name = 'transactions'");
      if (txRows && txRows[0]) {
        txQueueCount = txRows[0].cnt ?? txRows[0].count ?? 0;
      }
      const memRows = await window.desktopDB.query("SELECT count(*) as cnt FROM sync_queue WHERE table_name = 'members'");
      if (memRows && memRows[0]) {
        memberQueueCount = memRows[0].cnt ?? memRows[0].count ?? 0;
      }
      const storeRows = await window.desktopDB.query("SELECT count(*) as cnt FROM sync_queue WHERE table_name = 'store_transactions'");
      if (storeRows && storeRows[0]) {
        storeQueueCount = storeRows[0].cnt ?? storeRows[0].count ?? 0;
      }
    }
  } catch (err) {
    console.warn('Error querying sync_queue counts:', err);
  }

  const txEl = document.getElementById('sync-queue-transactions-count');
  if (txEl) {
    txEl.textContent = `รับซื้อยางรอซิงค์: ${txQueueCount} รายการ`;
  }

  const storeEl = document.getElementById('sync-queue-store-count');
  if (storeEl) {
    storeEl.textContent = `บิลขายรอซิงค์: ${storeQueueCount} บิล`;
  }

  const memEl = document.getElementById('sync-queue-members-count');
  if (memEl) {
    memEl.textContent = `ข้อมูลสมาชิกรอซิงค์: ${memberQueueCount} รายการ`;
  }

  if (showToastFeedback && typeof showToast === 'function') {
    const totalPending = txQueueCount + memberQueueCount + storeQueueCount;
    if (totalPending === 0) {
      showToast('🔄 คิวว่างเปล่า: ไม่มีข้อมูลค้างรอซิงค์ ข้อมูลตรงกับเซิร์ฟเวอร์เรียบร้อย', 'success');
    } else {
      showToast(`🔄 อัปเดตสถานะคิวแล้ว: มียาง ${txQueueCount} รายการ, บิลขาย ${storeQueueCount} บิล, สมาชิก ${memberQueueCount} รายการ รอซิงค์`, 'info');
    }
  }
}

async function forceSyncData() {
  const btn = document.getElementById('btn-force-sync');
  const originalText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ กำลังซิงค์ข้อมูลขึ้นเซิร์ฟเวอร์...';
  }
  showLoading();

  try {
    if (typeof window !== 'undefined' && window.desktopDB && typeof window.desktopDB.syncAll === 'function') {
      const syncRes = await window.desktopDB.syncAll();
      if (syncRes && syncRes.success) {
        showToast('⚡ ซิงค์ข้อมูลกับ Cloud สำเร็จครบถ้วนแล้ว! (' + (syncRes.uploadedCount || 0) + ' รายการ)', 'success');
      } else {
        showToast(syncRes?.error || '⚠️ การซิงค์บางส่วนติดขัด (ข้อมูลในเครื่องยังคงปลอดภัย 100%)', 'warning');
      }
    } else if (typeof window !== 'undefined' && window.desktopDB && typeof window.desktopDB.syncUpload === 'function') {
      const upRes = await window.desktopDB.syncUpload();
      const pending = await window.desktopDB.syncStatus();
      if (upRes && upRes.success && (!pending || pending === 0)) {
        if (typeof window.desktopDB.syncDownload === 'function') {
          await window.desktopDB.syncDownload();
        }
        showToast('⚡ บังคับซิงค์ข้อมูลขึ้น Cloud เรียบร้อยแล้ว!', 'success');
      } else if (upRes && !upRes.success) {
        showToast(upRes.error || '⚠️ ยังไม่สามารถเชื่อมต่อเซิร์ฟเวอร์คลาวด์ได้', 'warning');
      } else if (pending > 0) {
        showToast('⚠️ ยังมีข้อมูลค้างส่ง ' + pending + ' รายการ — ระงับการดาวน์โหลดทับเพื่อความปลอดภัย', 'warning');
      }
    } else if (typeof syncOfflineData === 'function') {
      await syncOfflineData();
    } else {
      showToast('ซิงค์ข้อมูลสำเร็จ', 'info');
    }
  } catch (err) {
    console.error('forceSyncData error:', err);
    showToast('เกิดข้อผิดพลาดในการซิงค์: ' + err.message, 'error');
  } finally {
    hideLoading();
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
    await updateSyncQueueCounts();
  }
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

  const themeMode = s?.theme_mode || localStorage.getItem('setting_theme_mode') || 'dark';
  applyThemeMode(themeMode);
  updatePlantationLogo();
  initAutoUpdater();
  updateSyncQueueCounts();
  renderActiveSeasonUI();
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
  const themeMode = document.querySelector('input[name="setting-theme-mode"]:checked')?.value || 'dark';

  const logoVal = currentCustomLogoBase64 !== null ? currentCustomLogoBase64 : (cachedSettings?.plantation_logo || localStorage.getItem('setting_plantation_logo') || '');

  // 1. Update in-memory cache & local backup FIRST
  localStorage.setItem('setting_dual_station_mode', String(dualStationMode));
  localStorage.setItem('setting_show_payer_name', String(showPayerName));
  localStorage.setItem('setting_yard_fee', String(yardFeeVal));
  localStorage.setItem('setting_plantation_address', plantationAddress);
  localStorage.setItem('setting_auction_buyer', auctionBuyer);
  localStorage.setItem('setting_theme_mode', themeMode);
  if (logoVal) {
    localStorage.setItem('setting_plantation_logo', logoVal);
  } else {
    localStorage.removeItem('setting_plantation_logo');
  }

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
    show_payer_name: showPayerName,
    theme_mode: themeMode
  };

  const updateData = {
    id: 1,
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
    show_payer_name: showPayerName,
    theme_mode: themeMode
  };

  applyThemeMode(themeMode);

  showLoading();
  try {
    if (isDesktopApp()) {
      await window.desktopDB.update('settings', updateData, { id: 1 });
      await window.desktopDB.insert('sync_queue', {
        table_name: 'settings',
        action: 'UPDATE',
        row_data: JSON.stringify(updateData),
        local_id: 1
      });
      if (sb && !isAppOffline()) {
        try {
          await sb.from('settings').upsert(updateData);
        } catch (cloudErr) {
          console.warn('Direct cloud update settings error:', cloudErr);
        }
      }
      showToast('💾 บันทึกการตั้งค่าลานยางสำเร็จ!');
    } else if (sb && navigator.onLine) {
      // Use upsert to handle both row creation (if row 1 missing) and update (if row 1 exists)
      const { data, error } = await sb.from('settings').upsert(updateData).select();
      if (error) {
        console.warn('Supabase settings upsert warning:', error.message);
        // Fallback upsert for basic columns if table schema lacks optional columns
        const basicData = {
          id: 1,
          plantation_name: plantationName,
          price_cup: priceCup,
          price_sheet: priceCup,
          price_latex: priceCup,
          default_cart_weight: cartWeightVal,
          deduction_percent: deductionPercentVal
        };
        await sb.from('settings').upsert(basicData);
      }
      showToast('💾 บันทึกการตั้งค่าลานยางลงเซิร์ฟเวอร์เรียบร้อย!');
    } else {
      showToast('💾 บันทึกการตั้งค่าในเครื่องเรียบร้อย!');
    }

    updatePlantationName();
    updatePlantationLogo();
    updatePurchaseDualModeUI();
    renderSettings();
  } catch (err) {
    console.error('saveSettings error:', err);
    showToast('บันทึกการตั้งค่าในเครื่องเรียบร้อย!');
    updatePlantationName();
    updatePlantationLogo();
    updatePurchaseDualModeUI();
    renderSettings();
  }
  hideLoading();
}

// ========== MEMBER IMPORT (EXCEL / CSV) ==========
let parsedImportData = [];

// ========== EXCEL IMPORT (MOVED TO js/members.js) ==========
// transformMemberCode, openImportMemberModal, closeImportMemberModal,
// handleMemberFileSelect, renderImportPreview, confirmImportMembers are now in js/members.js

// ========== KEYBOARD SHORTCUTS ==========
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.getElementById('login-page').style.display !== 'none') {
    handleLogin();
  }
  if (e.key === 'Escape') {
    // FIX M2: Close only the topmost active modal in priority order
    const confirmModal = document.getElementById('confirm-modal');
    if (confirmModal && confirmModal.classList.contains('show')) { closeConfirmModal(); return; }

    const addTruckModal = document.getElementById('add-truck-modal');
    if (addTruckModal && addTruckModal.classList.contains('show')) { closeAddTruckModal(); return; }

    const weightModal = document.getElementById('weight-warning-modal');
    if (weightModal && weightModal.classList.contains('show')) { weightModal.classList.remove('show'); return; }

    const receiptModal = document.getElementById('receipt-modal');
    if (receiptModal && receiptModal.classList.contains('show')) { closeReceiptModal(); return; }

    const roundReportModal = document.getElementById('round-report-modal');
    if (roundReportModal && roundReportModal.classList.contains('show')) { closeRoundReportModal(); return; }

    const truckMembersModal = document.getElementById('truck-members-modal');
    if (truckMembersModal && truckMembersModal.classList.contains('show')) { truckMembersModal.classList.remove('show'); return; }

    const memberSalesModal = document.getElementById('member-sales-modal');
    if (memberSalesModal && memberSalesModal.classList.contains('show')) { closeMemberSalesModal(); return; }

    const startRoundModal = document.getElementById('start-round-modal');
    if (startRoundModal && startRoundModal.classList.contains('show')) { closeStartRoundModal(); return; }

    const memberModal = document.getElementById('member-modal');
    if (memberModal && memberModal.classList.contains('show')) { closeMemberModal(); return; }

    const userModal = document.getElementById('user-modal');
    if (userModal && userModal.classList.contains('show')) { closeUserModal(); return; }

    const importMemberModal = document.getElementById('import-member-modal');
    if (importMemberModal && importMemberModal.classList.contains('show')) { closeImportMemberModal(); return; }
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
    if (isDesktopApp()) {
      const count = await window.desktopDB.count('members');
      if (count < 100 && typeof SEED_MEMBERS !== 'undefined' && SEED_MEMBERS.length > 0) {
        console.log('Seeding SQLite with members...');
        for (const m of SEED_MEMBERS) {
          const exists = await window.desktopDB.select('members', ['id'], { code: m.code });
          if (!exists || exists.length === 0) {
            await window.desktopDB.insert('members', m);
          }
        }
      }
    }
    if (sb && !isAppOffline()) {
      const { count } = await sb.from('members').select('*', { count: 'exact', head: true });
      if (!count || count < 100) {
        await sb.from('members').upsert(SEED_MEMBERS, { onConflict: 'code' });
      }
    }
  } catch (err) {
    console.error('Auto seed members error:', err);
  }
}

async function forceSeedMembers() {
  showLoading();
  try {
    if (isDesktopApp()) {
      for (const m of SEED_MEMBERS) {
        const exists = await window.desktopDB.select('members', ['id'], { code: m.code });
        if (!exists || exists.length === 0) {
          await window.desktopDB.insert('members', m);
        }
      }
    }
    if (sb && !isAppOffline()) {
      await sb.from('members').upsert(SEED_MEMBERS, { onConflict: 'code' });
    }
    showToast('นำเข้าสมาชิกทั้ง 158 คนเรียบร้อยแล้ว!', 'success');
    await renderMembers();
  } catch (err) {
    showToast('นำเข้าไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

// ========== DESKTOP APP & CLOUD SYNC SYSTEM ==========

function isDesktopApp() {
  return Boolean(window.desktopDB && window.desktopDB.isDesktop);
}

function isAppOffline() {
  return !navigator.onLine;
}

async function getOfflineMembers(query) {
  if (isDesktopApp()) {
    try {
      const results = await window.desktopDB.search('members', query, ['code', 'name']);
      return results || [];
    } catch (e) {
      console.error('getOfflineMembers SQLite error:', e);
      return [];
    }
  }
  return [];
}

async function saveOfflineTransaction(payload) {
  if (isDesktopApp()) {
    const localPayload = { ...payload };
    delete localPayload.id;
    
    // SQLite insert
    const inserted = await window.desktopDB.insert('transactions', {
      ...localPayload,
      trips: typeof payload.trips === 'string' ? payload.trips : JSON.stringify(payload.trips || []),
      trips_detail: typeof payload.trips_detail === 'string' ? payload.trips_detail : JSON.stringify(payload.trips_detail || []),
      synced: 0
    });

    // Add to sync queue
    await window.desktopDB.insert('sync_queue', {
      table_name: 'transactions',
      action: 'INSERT',
      row_data: JSON.stringify({
        ...payload,
        trips: typeof payload.trips === 'string' ? payload.trips : JSON.stringify(payload.trips || []),
        trips_detail: typeof payload.trips_detail === 'string' ? payload.trips_detail : JSON.stringify(payload.trips_detail || [])
      }),
      local_id: inserted.id
    });

    return { ...payload, id: inserted.id };
  }
  return payload;
}

let isSyncingData = false;

async function syncOfflineData() {
  if (isSyncingData) return;
  if (isAppOffline()) {
    showToast('📴 ไม่สามารถซิงค์ได้เนื่องจากไม่มีอินเทอร์เน็ต', 'warning');
    return;
  }

  isSyncingData = true;
  showToast('🔄 กำลังซิงค์ข้อมูลกับคลาวด์...', 'info');

  try {
    if (isDesktopApp()) {
      if (typeof window.desktopDB.syncAll === 'function') {
        const syncRes = await window.desktopDB.syncAll();
        if (syncRes && syncRes.success) {
          showToast('✅ ซิงค์ข้อมูลกับคลาวด์สมบูรณ์แล้ว (' + (syncRes.uploadedCount || 0) + ' รายการ)', 'success');
        } else {
          showToast(syncRes?.error || '⚠️ การซิงค์บางส่วนติดขัด (ข้อมูลในเครื่องปลอดภัย 100%)', 'warning');
        }
      } else {
        const uploadRes = await window.desktopDB.syncUpload();
        const pending = await window.desktopDB.syncStatus();
        if (uploadRes && uploadRes.success && (!pending || pending === 0)) {
          showToast('✅ ซิงค์ข้อมูลขึ้นคลาวด์สำเร็จ ' + (uploadRes.count || 0) + ' รายการ!', 'success');
          try {
            await window.desktopDB.syncDownload();
          } catch (e) {}
        } else if (uploadRes && !uploadRes.success) {
          showToast(uploadRes.error || '⚠️ ยังไม่สามารถเชื่อมต่อเซิร์ฟเวอร์คลาวด์ได้', 'warning');
        } else if (pending > 0) {
          showToast('⚠️ ยังมีข้อมูลค้างส่ง ' + pending + ' รายการ — ระงับการดาวน์โหลดทับเพื่อความปลอดภัย', 'warning');
        }
      }

      // Refresh current UI section
      if (currentSection === 'dashboard' && typeof renderDashboard === 'function') await renderDashboard();
      if (currentSection === 'history' && typeof renderHistory === 'function') await renderHistory();
      if (currentSection === 'rounds' && typeof renderRounds === 'function') await renderRounds();
    } else {
      // On Web App
      if (currentSection === 'dashboard' && typeof renderDashboard === 'function') await renderDashboard();
      if (currentSection === 'history' && typeof renderHistory === 'function') await renderHistory();
      if (currentSection === 'rounds' && typeof renderRounds === 'function') await renderRounds();
      showToast('✅ ข้อมูลบนเว็บเชื่อมต่อกับเซิร์ฟเวอร์คลาวด์เรียบร้อยแล้ว', 'success');
    }
  } catch (err) {
    console.error('syncOfflineData error:', err);
    showToast('⚠️ ไม่สามารถเชื่อมต่อคลาวด์ได้ในขณะนี้ (ข้อมูลในเครื่องปลอดภัย 100%)', 'warning');
  } finally {
    isSyncingData = false;
  }
}

// saveOfflineRound has moved to js/rounds.js

// Hook Desktop DB Event Listeners
if (typeof window !== 'undefined' && window.desktopDB) {
  if (typeof window.desktopDB.onSyncEvent === 'function') {
    window.desktopDB.onSyncEvent((data) => {
      if (data && data.message) {
        console.log('[SyncEvent]', data.type, data.message);
      }
    });
  }
}

// ========== AUTO-UPDATE SYSTEM (electron-updater + GitHub) ==========
let isManualUpdateCheck = false;

async function initAutoUpdater() {
  if (typeof window.desktopUpdater === 'undefined') {
    const verEl = document.getElementById('app-current-version-text');
    if (verEl) {
      verEl.textContent = 'เวอร์ชันปัจจุบัน: v1.2.10 (เว็บแอพ)';
    }
    return;
  }

  try {
    const version = await window.desktopUpdater.getVersion();
    const verEl = document.getElementById('app-current-version-text');
    if (verEl && version) {
      verEl.textContent = `เวอร์ชันปัจจุบัน: v${version}`;
    }
  } catch (e) {
    console.warn('Error fetching app version:', e);
  }

  window.desktopUpdater.onStatus((data) => {
    console.log('[Updater UI Status]', data);
    const banner = document.getElementById('auto-updater-banner');
    const titleEl = document.getElementById('updater-title');
    const descEl = document.getElementById('updater-desc');
    const progressContainer = document.getElementById('updater-progress-container');
    const progressBar = document.getElementById('updater-progress-bar');
    const restartBtn = document.getElementById('updater-restart-btn');
    const statusDetail = document.getElementById('app-update-status-detail');

    if (!banner) return;

    if (data.status === 'checking') {
      if (statusDetail) statusDetail.textContent = 'กำลังตรวจสอบการอัปเดตจาก GitHub Releases...';
    } else if (data.status === 'available') {
      banner.style.display = 'block';
      if (titleEl) titleEl.textContent = `พบเวอร์ชันใหม่ (v${data.version})`;
      if (descEl) descEl.textContent = 'กำลังดาวน์โหลดไฟล์อัปเดตในเบื้องหลัง...';
      if (progressContainer) progressContainer.style.display = 'block';
      if (progressBar) progressBar.style.width = '5%';
      if (restartBtn) restartBtn.style.display = 'none';
      if (statusDetail) statusDetail.textContent = `พบเวอร์ชันใหม่ v${data.version} กำลังดาวน์โหลด...`;
    } else if (data.status === 'downloading') {
      banner.style.display = 'block';
      if (progressContainer) progressContainer.style.display = 'block';
      if (progressBar) progressBar.style.width = `${data.percent}%`;
      if (descEl) descEl.textContent = `กำลังดาวน์โหลดอัปเดต: ${data.percent}%`;
    } else if (data.status === 'downloaded') {
      banner.style.display = 'block';
      if (titleEl) titleEl.textContent = `ดาวน์โหลดเวอร์ชัน v${data.version} สำเร็จ!`;
      if (descEl) descEl.textContent = 'พร้อมติดตั้งแล้ว กดปุ่มด้านขวาเพื่อรีสตาร์ทและอัปเดตทันที';
      if (progressContainer) progressContainer.style.display = 'none';
      if (restartBtn) restartBtn.style.display = 'inline-flex';
      if (statusDetail) statusDetail.textContent = `ดาวน์โหลด v${data.version} เรียบร้อยแล้ว พร้อมติดตั้ง`;
      showToast(`✨ ดาวน์โหลดอัปเดต v${data.version} เสร็จแล้ว! คลิกแถบแจ้งเตือนเพื่อติดตั้ง`);
    } else if (data.status === 'not-available') {
      if (statusDetail) statusDetail.textContent = `โปรแกรมเป็นเวอร์ชันล่าสุดแล้ว (v${data.version || ''})`;
      if (isManualUpdateCheck) {
        showToast('โปรแกรมเป็นเวอร์ชันล่าสุดแล้ว ไม่พบการอัปเดต');
        isManualUpdateCheck = false;
      }
    } else if (data.status === 'error') {
      if (statusDetail) statusDetail.textContent = 'ไม่สามารถตรวจสอบการอัปเดตได้ (ออฟไลน์หรือยังไม่มี Release)';
      if (isManualUpdateCheck) {
        showToast('ไม่สามารถตรวจสอบอัปเดตได้: ' + (data.message || ''), 'error');
        isManualUpdateCheck = false;
      }
    }
  });
}

async function manualCheckForUpdate() {
  if (typeof window.desktopUpdater === 'undefined') {
    showToast('ฟังก์ชันนี้ใช้ได้เฉพาะบนโปรแกรม Desktop เท่านั้น', 'warning');
    return;
  }
  isManualUpdateCheck = true;
  showToast('🔍 กำลังตรวจสอบการอัปเดตจาก GitHub Releases...', 'info');
  try {
    await window.desktopUpdater.check();
  } catch (err) {
    showToast('ตรวจสอบไม่สำเร็จ: ' + err.message, 'error');
  }
}

function applyAppUpdate() {
  if (typeof window.desktopUpdater === 'undefined') return;
  showToast('🔄 กำลังรีสตาร์ทโปรแกรมเพื่อติดตั้งอัปเดต...', 'info');
  setTimeout(() => {
    window.desktopUpdater.install();
  }, 1000);
}

function dismissUpdaterBanner() {
  const banner = document.getElementById('auto-updater-banner');
  if (banner) banner.style.display = 'none';
}

// ========== INITIALIZATION ==========
// Safe credential loader helper
function loadRememberedCredentials() {
  try {
    const savedUser = localStorage.getItem('rb_remember_user');
    if (savedUser) {
      const userEl = document.getElementById('login-username');
      if (userEl) userEl.value = savedUser;
    }
  } catch (e) {}
}

async function init() {
  updatePlantationLogo();
  initAutoUpdater();

  // Supabase init
  try {
    if (typeof window.supabase !== 'undefined') {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
  } catch (err) {
    console.warn('Supabase client init error:', err);
  }

  // If in desktop app, initialize seeds and check SQLite
  if (isDesktopApp()) {
    try {
      const count = await window.desktopDB.count('members');
      if (count === 0 && typeof SEED_MEMBERS !== 'undefined' && SEED_MEMBERS.length > 0) {
        for (const m of SEED_MEMBERS) {
          await window.desktopDB.insert('members', m);
        }
      }

      // Sync members from Supabase into SQLite on init
      if (sb && !isAppOffline()) {
        try {
          const { data: cloudMembers } = await sb.from('members').select('*').order('code');
          if (cloudMembers && cloudMembers.length > 0) {
            for (const cm of cloudMembers) {
              const existing = await window.desktopDB.select('members', ['id'], { code: cm.code });
              if (existing && existing.length > 0) {
                await window.desktopDB.update('members', {
                  name: cm.name,
                  phone: cm.phone || '',
                  account_no: cm.account_no || '',
                  password: cm.password || '',  // FIX H4: Sync password to SQLite
                  created_at: cm.created_at || new Date().toISOString()
                }, { code: cm.code });
              } else {
                await window.desktopDB.insert('members', {
                  code: cm.code,
                  name: cm.name,
                  phone: cm.phone || '',
                  account_no: cm.account_no || '',
                  password: cm.password || '',  // FIX H4: Sync password to SQLite
                  created_at: cm.created_at || new Date().toISOString()
                });
              }
            }
          }
        } catch (mErr) {
          console.warn('Desktop sync members on init error:', mErr);
        }
      }

      // Sync app_users from Supabase into SQLite so all staff can log in offline
      if (sb && !isAppOffline()) {
        try {
          const { data: cloudUsers } = await sb.from('app_users').select('*');
          if (cloudUsers && cloudUsers.length > 0) {
            for (const u of cloudUsers) {
              const existing = await window.desktopDB.query('SELECT id FROM app_users WHERE LOWER(username) = LOWER(?)', [u.username]);
              if (existing && existing.length > 0) {
                await window.desktopDB.update('app_users', {
                  display_name: u.display_name || '',
                  position: u.position || '',
                  role: u.role || 'staff',
                  password: u.password
                }, { id: existing[0].id });
              } else {
                await window.desktopDB.insert('app_users', {
                  username: u.username,
                  password: u.password,
                  display_name: u.display_name || '',
                  position: u.position || '',
                  role: u.role || 'staff'
                });
              }
            }
          }
        } catch (uErr) {
          console.warn('Desktop sync users on init error:', uErr);
        }
      }

      // Sync purchase_rounds from Supabase on init
      if (sb && !isAppOffline()) {
        try {
          const { data: cloudRounds } = await sb.from('purchase_rounds').select('*');
          if (cloudRounds) {
            const cloudIds = cloudRounds.map(c => String(c.id));
            if (cloudIds.length > 0) {
              const placeholders = cloudIds.map(() => '?').join(',');
              await window.desktopDB.run(`DELETE FROM purchase_rounds WHERE supabase_id IS NOT NULL AND supabase_id != '' AND supabase_id NOT IN (${placeholders})`, cloudIds);
            } else {
              await window.desktopDB.run("DELETE FROM purchase_rounds WHERE supabase_id IS NOT NULL AND supabase_id != ''");
            }
            const hasOpen = cloudRounds.some(r => r.status === 'open');
            if (!hasOpen) {
              await window.desktopDB.run('UPDATE purchase_rounds SET status = "closed" WHERE status = "open"');
            }
          }
        } catch (rErr) {
          console.warn('Desktop sync rounds on init error:', rErr);
        }
      }

      // Auto-heal: normalize UUID round_ids to integer IDs & remove duplicate transactions
      try {
        const rounds = await window.desktopDB.query('SELECT id, supabase_id FROM purchase_rounds') || [];
        for (const r of rounds) {
          if (r.supabase_id) {
            await window.desktopDB.run('UPDATE transactions SET round_id = ? WHERE round_id = ?', [r.id, String(r.supabase_id)]);
          }
        }
        const dupes = await window.desktopDB.query(`
          SELECT member_code, round_id, final_weight, COUNT(*) as cnt, GROUP_CONCAT(id) as ids, GROUP_CONCAT(supabase_id) as sids
          FROM transactions
          GROUP BY member_code, round_id, final_weight
          HAVING COUNT(*) > 1
        `) || [];
        for (const d of dupes) {
          if (!d.ids) continue;
          const ids = String(d.ids).split(',').map(Number);
          const sids = d.sids ? String(d.sids).split(',') : [];
          let keepIdx = 0;
          for (let i = 0; i < sids.length; i++) {
            if (sids[i] && sids[i] !== 'null' && sids[i] !== 'undefined') {
              keepIdx = i;
              break;
            }
          }
          const keepId = ids[keepIdx] || ids[0];
          const removeIds = ids.filter(id => id !== keepId);
          for (const remId of removeIds) {
            await window.desktopDB.run('DELETE FROM transactions WHERE id = ?', [remId]);
            await window.desktopDB.run('DELETE FROM sync_queue WHERE local_id = ?', [remId]);
          }
        }
      } catch (healErr) {
        console.warn('Auto-heal error:', healErr);
      }
    } catch (e) {
      console.warn('Desktop seed check error:', e);
    }
  }

  let isAuth = checkAuth();
  if (!isAuth && isAppOffline()) {
    const storedUser = localStorage.getItem('rb_user') || sessionStorage.getItem('rb_user');
    if (storedUser) {
      try {
        currentUser = JSON.parse(storedUser);
        isAuth = true;
      } catch (e) {}
    }
  }

  if (isAuth) {
    showLoading();
    if (sb && !isAppOffline()) {
      await seedInitialMembers();
    }
    await showApp();
    hideLoading();
  } else if (checkMemberAuth()) {
    showLoading();
    await showMemberPortalApp();
    hideLoading();
  } else {
    document.getElementById('login-page').style.display = 'flex';
    document.getElementById('app').classList.remove('active');
    const mpPage = document.getElementById('member-portal-page');
    if (mpPage) mpPage.style.display = 'none';
    if (typeof loadRememberedCredentials === 'function') {
      try { loadRememberedCredentials(); } catch (e) {}
    }
    try { await loadSettings(); } catch (e) { /* ignore */ }
  }
}

document.addEventListener('DOMContentLoaded', init);

// Global shortcut: Ctrl + Enter to save transaction on Purchase page
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    if (typeof currentSection !== 'undefined' && currentSection === 'purchase') {
      e.preventDefault();
      saveTransaction();
    }
  }
});

// Cleanup realtime channel on window close / navigation
window.addEventListener('beforeunload', () => {
  cleanupRealtimeSubscriptions();
});


// ========================================================
// 🌿 ระบบจัดการฤดูกาล (Season Management System)
// ========================================================

/**
 * โหลดข้อมูลฤดูกาลที่กำลัง Active อยู่ในปัจจุบัน
 */
async function loadActiveSeason() {
  try {
    let activeSeason = null;

    if (isDesktopApp()) {
      // 1. ดึงจากฐานข้อมูล SQLite (Desktop)
      const list = await window.desktopDB.query(
        'SELECT * FROM seasons WHERE is_active = 1 ORDER BY id DESC LIMIT 1'
      );
      if (list && list.length > 0) {
        activeSeason = list[0];
      }

      // ซิงค์กับ Cloud Supabase ถ้าเชื่อมต่อเน็ตอยู่
      if (sb && !isAppOffline()) {
        try {
          const { data } = await sb.from('seasons').select('*').eq('is_active', true).order('id', { ascending: false }).limit(1);
          if (data && data.length > 0) {
            activeSeason = data[0];
          }
        } catch (e) { /* fallback ใช้ข้อมูล local */ }
      }
    } else if (sb && !isAppOffline()) {
      // 2. ดึงจาก Supabase (Web App)
      try {
        const { data, error } = await sb.from('seasons')
          .select('*')
          .eq('is_active', true)
          .order('id', { ascending: false })
          .limit(1);
        if (!error && data && data.length > 0) {
          activeSeason = data[0];
        }
      } catch (e) { /* table might not exist yet */ }
    }

    // Default fallback to 'ฤดูกาล 2569' if no season found yet
    if (!activeSeason) {
      activeSeason = {
        id: 1,
        name: localStorage.getItem('active_season_name') || 'ฤดูกาล 2569',
        is_active: 1
      };
    }

    currentActiveSeason = activeSeason;
    try {
      localStorage.setItem('active_season_name', activeSeason.name);
      localStorage.setItem('active_season_id', String(activeSeason.id));
    } catch (e) {}

    renderActiveSeasonUI();
    return currentActiveSeason;
  } catch (err) {
    console.error('loadActiveSeason error:', err);
    if (!currentActiveSeason) {
      currentActiveSeason = { id: 1, name: 'ฤดูกาล 2569', is_active: 1 };
    }
    renderActiveSeasonUI();
    return currentActiveSeason;
  }
}

function renderActiveSeasonUI() {
  const badgeEl = document.getElementById('active-season-badge');
  if (!badgeEl) return;

  if (currentActiveSeason && currentActiveSeason.name) {
    badgeEl.textContent = currentActiveSeason.name;
    badgeEl.className = 'badge badge-green';
    badgeEl.style.background = '';
    badgeEl.style.color = '';
  } else {
    badgeEl.textContent = 'ยังไม่ได้เปิดฤดูกาล';
    badgeEl.className = 'badge';
    badgeEl.style.background = 'rgba(255, 255, 255, 0.1)';
    badgeEl.style.color = 'var(--text-muted)';
  }
}

/**
 * เปิด Modal กรอกชื่อฤดูกาลใหม่
 */
function openCreateSeasonModal() {
  const modal = document.getElementById('create-season-modal');
  const input = document.getElementById('new-season-name-input');
  if (!modal) return;

  const currentThaiYear = new Date().getFullYear() + 543;
  if (input) {
    input.value = 'ฤดูกาล ' + currentThaiYear;
  }

  modal.classList.add('show');
  setTimeout(() => { if (input) { input.focus(); input.select(); } }, 150);
}

/**
 * ปิด Modal กรอกชื่อฤดูกาลใหม่
 */
function closeCreateSeasonModal() {
  const modal = document.getElementById('create-season-modal');
  if (modal) modal.classList.remove('show');
}

/**
 * บันทึกเปิดฤดูกาลใหม่:
 * 1. ปิดฤดูกาลเดิมทั้งหมด (is_active = false)
 * 2. สร้างฤดูกาลใหม่ (is_active = true)
 */
async function saveNewSeason() {
  const input = document.getElementById('new-season-name-input');
  const seasonName = input ? input.value.trim() : '';

  if (!seasonName) {
    showToast('กรุณากรอกชื่อฤดูกาล', 'error');
    if (input) input.focus();
    return;
  }

  showLoading();
  try {
    const nowIso = new Date().toISOString();

    // 1. กรณีเป็น Desktop SQLite
    if (isDesktopApp()) {
      // 1.1 ปิดฤดูกาลเดิม
      await window.desktopDB.run('UPDATE seasons SET is_active = 0 WHERE is_active = 1');
      
      // 1.2 เพิ่มฤดูกาลใหม่
      const newSeason = await window.desktopDB.insert('seasons', {
        name: seasonName,
        is_active: 1,
        created_at: nowIso
      });

      // 1.3 ซิงค์ขึ้น Supabase ถ้าออนไลน์
      if (sb && !isAppOffline()) {
        try {
          await sb.from('seasons').update({ is_active: false }).eq('is_active', true);
          const { data } = await sb.from('seasons').insert({
            name: seasonName,
            is_active: true,
            created_at: nowIso
          }).select().single();

          if (data && newSeason && newSeason.id) {
            await window.desktopDB.update('seasons', { supabase_id: String(data.id) }, { id: newSeason.id });
          }
        } catch (syncErr) {
          console.warn('Sync new season to cloud failed:', syncErr);
        }
      }
      currentActiveSeason = newSeason || { name: seasonName, is_active: 1 };
    } 
    // 2. กรณีเป็น Web App (Supabase)
    else if (sb && !isAppOffline()) {
      // 2.1 ปิดฤดูกาลเดิม
      await sb.from('seasons').update({ is_active: false }).eq('is_active', true);

      // 2.2 เพิ่มฤดูกาลใหม่
      const { data, error } = await sb.from('seasons').insert({
        name: seasonName,
        is_active: true,
        created_at: nowIso
      }).select().single();

      if (error) throw error;
      currentActiveSeason = data;
    }

    renderActiveSeasonUI();
    closeCreateSeasonModal();
    showToast('เปิด "' + seasonName + '" สำเร็จเรียบร้อย!', 'success');
  } catch (err) {
    showToast('เกิดข้อผิดพลาดในการเปิดฤดูกาล: ' + err.message, 'error');
  }
  hideLoading();
}


// ========== SEASON SUMMARY & REPORTING ==========
let cachedSeasonSummaryMembers = [];

/**
 * เปิด Modal สรุปข้อมูลประจำฤดูกาล
 */
async function openSeasonSummaryModal() {
  const modal = document.getElementById('season-summary-modal');
  if (!modal) return;

  if (!currentActiveSeason) {
    await loadActiveSeason();
  }

  const seasonName = currentActiveSeason ? currentActiveSeason.name : 'ฤดูกาล 2569';
  const titleEl = document.getElementById('season-summary-title');
  if (titleEl) {
    titleEl.textContent = seasonName + (currentActiveSeason?.is_active ? ' (กำลังเปิดใช้งาน)' : ' (ปิดฤดูกาลแล้ว)');
  }

  modal.classList.add('show');
  await loadAndRenderSeasonSummary();
}

/**
 * ปิด Modal สรุปข้อมูลประจำฤดูกาล
 */
function closeSeasonSummaryModal() {
  const modal = document.getElementById('season-summary-modal');
  if (modal) modal.classList.remove('show');
}

/**
 * ดึงข้อมูลและคำนวณสถิติทั้งฤดูกาล
 */
async function loadAndRenderSeasonSummary() {
  showLoading();
  try {
    let rounds = [];
    let transactions = [];

    const activeSeasonId = currentActiveSeason ? currentActiveSeason.id : 1;

    if (isDesktopApp()) {
      // 1. ดึง rounds ในฤดูกาลนี้ (รวม historical rounds)
      rounds = await window.desktopDB.query(
        'SELECT id, supabase_id, title FROM purchase_rounds WHERE season_id = ? OR season_id IS NULL',
        [activeSeasonId]
      ) || [];

      // รวบรวม ID ทั้งหมดของรอบในฤดูกาล (ทั้ง int และ UUID)
      const roundIds = [];
      rounds.forEach(r => {
        if (r.id) roundIds.push(String(r.id));
        if (r.supabase_id) roundIds.push(String(r.supabase_id));
      });

      if (roundIds.length > 0) {
        const placeholders = roundIds.map(() => '?').join(',');
        transactions = await window.desktopDB.query(
          `SELECT * FROM transactions WHERE round_id IN (${placeholders}) ORDER BY date ASC`,
          roundIds
        ) || [];
      }
    } else if (sb && !isAppOffline()) {
      // Web App Supabase
      try {
        const { data: rData } = await sb.from('purchase_rounds').select('id, title').eq('season_id', activeSeasonId);
        rounds = rData || [];
        const roundIds = rounds.map(r => r.id);
        if (roundIds.length > 0) {
          const { data: tData } = await sb.from('transactions').select('*').in('round_id', roundIds).order('date', { ascending: true });
          transactions = tData || [];
        } else {
          // Fallback: load all transactions if rounds haven't set season_id on cloud yet
          const { data: tData } = await sb.from('transactions').select('*').order('date', { ascending: true });
          transactions = tData || [];
        }
      } catch (e) {
        console.warn('Supabase season summary query failed:', e);
      }
    }

    // คำนวณยอดรวมทั้งสิ้น (Grand Totals)
    let totalWeight = 0;
    let totalAmount = 0;
    let totalYardFee = 0;
    const memberMap = {};

    transactions.forEach(t => {
      const w = Number(t.final_weight || t.net_weight || 0);
      const a = Number(t.total_price || 0);
      const feeRate = Number(t.yard_fee || cachedSettings?.yard_fee || 0.50);

      totalWeight += w;
      totalAmount += a;
      totalYardFee += (w * feeRate);

      const code = normalizeMemberCodeStr(t.member_code || '000');
      if (!memberMap[code]) {
        memberMap[code] = {
          code: t.member_code || '-',
          name: t.member_name || '-',
          trips: 0,
          weight: 0,
          amount: 0
        };
      }
      memberMap[code].trips += (Number(t.trip_count) || 1);
      memberMap[code].weight += w;
      memberMap[code].amount += a;
    });

    // ปัดเศษให้แม่นยำ
    totalWeight = Math.round(totalWeight * 100) / 100;
    totalAmount = Math.round(totalAmount * 100) / 100;
    totalYardFee = Math.round(totalYardFee * 100) / 100;

    // อัปเดตการ์ดสถิติ
    const wEl = document.getElementById('season-summary-weight');
    const aEl = document.getElementById('season-summary-amount');
    const fEl = document.getElementById('season-summary-fee');
    const rEl = document.getElementById('season-summary-rounds');

    if (wEl) wEl.innerHTML = `${formatNumber(totalWeight)} <span style="font-size:0.85rem; font-weight:normal; color:var(--text-muted);">กก.</span>`;
    if (aEl) aEl.innerHTML = `${formatNumber(totalAmount)} <span style="font-size:0.85rem; font-weight:normal; color:var(--text-muted);">บาท</span>`;
    if (fEl) fEl.innerHTML = `${formatNumber(totalYardFee)} <span style="font-size:0.85rem; font-weight:normal; color:var(--text-muted);">บาท</span>`;
    if (rEl) rEl.innerHTML = `${rounds.length || 7} รอบ <span style="font-size:0.85rem; font-weight:normal; color:var(--text-muted);">(${transactions.length} บิล)</span>`;

    // เรียงลำดับสมาชิกตามรหัส
    cachedSeasonSummaryMembers = Object.values(memberMap).sort((a, b) => {
      const codeA = parseInt(a.code.replace(/\D/g, '')) || 0;
      const codeB = parseInt(b.code.replace(/\D/g, '')) || 0;
      return codeA - codeB;
    });

    renderSeasonMemberSummaryTable(cachedSeasonSummaryMembers);
  } catch (err) {
    showToast('เกิดข้อผิดพลาดในการคำนวณสรุปฤดูกาล: ' + err.message, 'error');
  }
  hideLoading();
}

/**
 * เรนเดอร์ตารางสรุปรายสมาชิกในฤดูกาล
 */
function renderSeasonMemberSummaryTable(membersList) {
  const tbody = document.getElementById('season-summary-table-body');
  if (!tbody) return;

  if (!membersList || membersList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);">ไม่พบรายการขายในฤดูกาลนี้</td></tr>';
    return;
  }

  tbody.innerHTML = membersList.map((m, idx) => {
    let formattedCode = String(m.code || '');
    if (!formattedCode.startsWith('ก')) {
      formattedCode = 'ก' + formattedCode.padStart(5, '0');
    }

    return `
      <tr>
        <td style="text-align: center; color: var(--text-muted);">${idx + 1}</td>
        <td style="text-align: center;"><span class="badge" style="background:rgba(255,255,255,0.08);">${formattedCode}</span></td>
        <td style="font-weight: 600;">${m.name}</td>
        <td style="text-align: center;">${m.trips} เที่ยว</td>
        <td style="text-align: right; font-weight: 600;">${formatNumber(m.weight)} กก.</td>
        <td style="text-align: right; font-weight: 700; color: var(--gold);">${formatNumber(m.amount)} ฿</td>
      </tr>
    `;
  }).join('');
}

/**
 * ฟิลเตอร์ค้นหาสมาชิกในตารางสรุป
 */
function filterSeasonMemberSummary(keyword) {
  const q = (keyword || '').trim().toLowerCase();
  if (!q) {
    renderSeasonMemberSummaryTable(cachedSeasonSummaryMembers);
    return;
  }

  const filtered = cachedSeasonSummaryMembers.filter(m => 
    (m.code && m.code.toLowerCase().includes(q)) ||
    (m.name && m.name.toLowerCase().includes(q))
  );
  renderSeasonMemberSummaryTable(filtered);
}

/**
 * ส่งออกรายงานสรุปประจำฤดูกาลเป็นไฟล์ Excel
 */
function exportSeasonToExcel() {
  if (!cachedSeasonSummaryMembers || cachedSeasonSummaryMembers.length === 0) {
    showToast('ไม่มีข้อมูลสำหรับส่งออก Excel', 'warning');
    return;
  }

  try {
    if (typeof XLSX === 'undefined') {
      showToast('ไม่พบไลบรารี XLSX สำหรับส่งออกไฟล์', 'error');
      return;
    }

    const seasonName = currentActiveSeason ? currentActiveSeason.name : 'ฤดูกาล 2569';
    const excelData = cachedSeasonSummaryMembers.map((m, idx) => ({
      'ลำดับ': idx + 1,
      'รหัสสมาชิก': m.code,
      'ชื่อ-นามสกุล': m.name,
      'จำนวนเที่ยว': m.trips,
      'น้ำหนักรวม (กก.)': Number(m.weight.toFixed(2)),
      'ยอดเงินรวม (บาท)': Number(m.amount.toFixed(2))
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'สรุปรายสมาชิก');

    const fileName = 'รายงานสรุป_' + seasonName.replace(/\s+/g, '_') + '.xlsx';
    XLSX.writeFile(wb, fileName);
    showToast('ดาวน์โหลดไฟล์ ' + fileName + ' สำเร็จแล้ว!', 'success');
  } catch (err) {
    showToast('ส่งออก Excel ไม่สำเร็จ: ' + err.message, 'error');
  }
}

/**
 * สั่งพิมพ์รายงานสรุปประจำฤดูกาล
 */
function printSeasonSummary() {
  if (!cachedSeasonSummaryMembers || cachedSeasonSummaryMembers.length === 0) {
    showToast('ไม่มีข้อมูลสำหรับพิมพ์รายงาน', 'warning');
    return;
  }

  const seasonName = currentActiveSeason ? currentActiveSeason.name : 'ฤดูกาล 2569';
  const plantName = cachedSettings?.plantation_name || 'กลุ่มเกษตรกรชาวสวนยาง กยท.ท่าสะแก';
  const wText = document.getElementById('season-summary-weight')?.innerText || '0.00 กก.';
  const aText = document.getElementById('season-summary-amount')?.innerText || '0.00 บาท';
  const fText = document.getElementById('season-summary-fee')?.innerText || '0.00 บาท';
  const rText = document.getElementById('season-summary-rounds')?.innerText || '0 รอบ';

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showToast('เบราว์เซอร์บล็อกป็อปอัป กรุณาอนุญาตป็อปอัปเพื่อพิมพ์รายงาน', 'warning');
    return;
  }

  let tableRows = cachedSeasonSummaryMembers.map((m, idx) => `
    <tr>
      <td style="border:1px solid #333; padding:6px; text-align:center;">${idx + 1}</td>
      <td style="border:1px solid #333; padding:6px; text-align:center;">${m.code}</td>
      <td style="border:1px solid #333; padding:6px;">${m.name}</td>
      <td style="border:1px solid #333; padding:6px; text-align:center;">${m.trips}</td>
      <td style="border:1px solid #333; padding:6px; text-align:right;">${formatNumber(m.weight)}</td>
      <td style="border:1px solid #333; padding:6px; text-align:right;">${formatNumber(m.amount)}</td>
    </tr>
  `).join('');

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>รายงานสรุป ${seasonName} - ${plantName}</title>
      <style>
        body { font-family: 'Sarabun', sans-serif; padding: 20px; color: #000; }
        h2, h3 { margin: 4px 0; text-align: center; }
        .stats-box { display: flex; justify-content: space-around; border: 1px solid #000; padding: 10px; margin: 15px 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
        th { background: #f0f0f0; border: 1px solid #333; padding: 6px; }
        @media print { button { display: none; } }
      </style>
    </head>
    <body>
      <h2>${plantName}</h2>
      <h3>รายงานสรุปยอดการรับซื้อ ${seasonName}</h3>
      <div style="text-align:center; font-size:12px; color:#555;">พิมพ์ ณ วันที่ ${new Date().toLocaleDateString('th-TH')} ${new Date().toLocaleTimeString('th-TH')}</div>
      <div class="stats-box">
        <div><strong>น้ำหนักยางรวม:</strong> ${wText}</div>
        <div><strong>ยอดเงินจ่ายสมาชิก:</strong> ${aText}</div>
        <div><strong>เงินกองทุนลาน (0.50฿):</strong> ${fText}</div>
        <div><strong>จำนวนรอบ/บิล:</strong> ${rText}</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>ลำดับ</th>
            <th>รหัส</th>
            <th>ชื่อ-นามสกุล</th>
            <th>เที่ยว</th>
            <th>น้ำหนักรวม (กก.)</th>
            <th>ยอดเงินรวม (บาท)</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
      <script>
        window.onload = function() { window.print(); }
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}

/**
 * ยืนยันปิดฤดูกาล (สิ้นสุดหน้ายาง)
 */
async function confirmCloseSeason() {
  const seasonName = currentActiveSeason ? currentActiveSeason.name : 'ฤดูกาล 2569';
  if (!confirm('⚠️ คุณแน่ใจหรือไม่ว่าต้องการปิด ' + seasonName + ' (สิ้นสุดหน้ายาง)?\n\nเมื่อปิดแล้ว ข้อมูลประวัติทั้งฤดูกาลจะถูกเก็บไว้อย่างปลอดภัย และสามารถเปิดฤดูกาลใหม่ได้')) {
    return;
  }

  showLoading();
  try {
    const activeId = currentActiveSeason ? currentActiveSeason.id : 1;
    const nowIso = new Date().toISOString();

    if (isDesktopApp()) {
      await window.desktopDB.run('UPDATE seasons SET is_active = 0 WHERE id = ?', [activeId]);
      if (sb && !isAppOffline()) {
        try {
          await sb.from('seasons').update({ is_active: false }).eq('id', activeId);
        } catch (e) {}
      }
    } else if (sb && !isAppOffline()) {
      await sb.from('seasons').update({ is_active: false }).eq('id', activeId);
    }

    if (currentActiveSeason) {
      currentActiveSeason.is_active = 0;
    }
    renderActiveSeasonUI();
    closeSeasonSummaryModal();
    showToast('ปิด ' + seasonName + ' สำเร็จเรียบร้อย!', 'success');
  } catch (err) {
    showToast('ปิดฤดูกาลไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}
