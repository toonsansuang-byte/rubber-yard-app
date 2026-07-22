/* ============================================
   COMMUNITY RUBBER PLANTATION WEB APP
   Application Logic — Supabase + Multi-Trip
   ============================================ */

// ========== SUPABASE CONFIG ==========
const SUPABASE_URL = 'https://llukvrfabdnvlbimvepb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_TfYRzo9Gj85z7KByoPEZnA_RJvJCtw7';

let sb; // Supabase client — initialized in init()

// ========== GLOBAL STATE ==========
let currentSection = 'dashboard';
let selectedMember = null;
let trips = [];           // [{grossWeight: 0}]
let cachedSettings = null; // cached settings from Supabase

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

// ========== AUTH ==========
function checkAuth() {
  return sessionStorage.getItem('rb_session') === 'logged_in';
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
    const { data, error } = await sb.from('settings').select('admin_username, admin_password').eq('id', 1).single();
    if (error) throw error;

    if (data && username === data.admin_username && password === data.admin_password) {
      sessionStorage.setItem('rb_session', 'logged_in');
      errorEl.classList.remove('show');
      await showApp();
      showToast('เข้าสู่ระบบสำเร็จ!');
    } else {
      errorEl.textContent = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
      errorEl.classList.add('show');
    }
  } catch (err) {
    errorEl.textContent = 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้: ' + (err.message || err);
    errorEl.classList.add('show');
  }
  hideLoading();
}

function handleLogout() {
  sessionStorage.removeItem('rb_session');
  document.getElementById('app').classList.remove('active');
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').classList.remove('show');
}

async function showApp() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app').classList.add('active');
  await loadSettings();
  navigateTo('dashboard');
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

// ========== NAVIGATION ==========
function navigateTo(section) {
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
    case 'history': renderHistory(); break;
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
  const d = new Date(dateStr);
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(dateStr) {
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
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();

    // Fetch today's transactions
    const { data: todayTx } = await sb.from('transactions')
      .select('net_weight, total_price, final_weight')
      .gte('date', startOfDay);

    // Fetch this month's transactions
    const { data: monthTx } = await sb.from('transactions')
      .select('total_price')
      .gte('date', startOfMonth);

    // Fetch member count
    const { count: memberCount } = await sb.from('members')
      .select('*', { count: 'exact', head: true });

    // Fetch recent 10 transactions
    const { data: recentTx } = await sb.from('transactions')
      .select('*')
      .order('date', { ascending: false })
      .limit(10);

    const todayArr = todayTx || [];
    const monthArr = monthTx || [];

    const todayCount = todayArr.length;
    const todayWeight = todayArr.reduce((s, t) => s + Number(t.final_weight || t.net_weight || 0), 0);
    const todayAmount = todayArr.reduce((s, t) => s + Number(t.total_price || 0), 0);
    const monthAmount = monthArr.reduce((s, t) => s + Number(t.total_price || 0), 0);

    document.getElementById('stat-today-count').innerHTML = `${todayCount} <span class="unit">รายการ</span>`;
    document.getElementById('stat-today-weight').innerHTML = `${formatNumber(todayWeight)} <span class="unit">กก.</span>`;
    document.getElementById('stat-today-amount').innerHTML = `${formatNumber(todayAmount)} <span class="unit">บาท</span>`;
    document.getElementById('stat-month-amount').innerHTML = `${formatNumber(monthAmount)} <span class="unit">บาท</span>`;
    document.getElementById('stat-total-members').innerHTML = `${memberCount || 0} <span class="unit">คน</span>`;

    // Recent transactions table
    const tbody = document.getElementById('recent-transactions');
    const emptyState = document.getElementById('recent-empty');
    const recent = recentTx || [];

    if (recent.length === 0) {
      tbody.innerHTML = '';
      emptyState.style.display = 'block';
      tbody.closest('.table-container').style.display = 'none';
    } else {
      emptyState.style.display = 'none';
      tbody.closest('.table-container').style.display = 'block';
      tbody.innerHTML = recent.map(t => `
        <tr>
          <td>${formatDateTime(t.date)}</td>
          <td><span class="badge badge-green">${t.member_code}</span></td>
          <td>${t.member_name}</td>
          <td>${getRubberTypeBadge(t.rubber_type)}</td>
          <td>${t.trip_count || 1}</td>
          <td>${formatNumber(t.final_weight || t.net_weight)} กก.</td>
          <td style="font-weight:600; color: var(--gold);">${formatNumber(t.total_price)} ฿</td>
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
  clearSelectedMember();
  document.getElementById('purchase-member-search').value = '';
  document.getElementById('purchase-member-list').innerHTML = '';
  document.getElementById('rubber-type').value = 'sheet';

  if (!cachedSettings) await loadSettings();

  document.getElementById('cart-weight').value = cachedSettings?.default_cart_weight || '';
  document.getElementById('price-per-kg').value = cachedSettings?.price_sheet || '';

  // Start with one trip
  trips = [{ grossWeight: 0 }];
  renderTrips();
  calculatePrice();
}

function addTrip() {
  trips.push({ grossWeight: 0 });
  renderTrips();
  calculatePrice();
  // Focus on the new input
  setTimeout(() => {
    const inputs = document.querySelectorAll('.trip-gross-input');
    if (inputs.length > 0) inputs[inputs.length - 1].focus();
  }, 100);
}

function removeTrip(index) {
  if (trips.length <= 1) return; // keep at least 1
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
  const pricePerKg = parseFloat(document.getElementById('price-per-kg').value) || 0;
  const deductionPercent = cachedSettings?.deduction_percent || 0;

  let totalNet = 0;
  const detailHtml = [];

  trips.forEach((trip, i) => {
    const net = Math.max(0, trip.grossWeight - cartWeight);
    trip.netWeight = net;
    totalNet += net;

    // Update individual trip net display
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
  const totalPrice = finalWeight * pricePerKg;

  // Render calculation details
  document.getElementById('calc-trips-detail').innerHTML = detailHtml.join('');
  document.getElementById('calc-total-net').textContent = `${formatNumber(totalNet)} กก.`;
  document.getElementById('calc-deduction-pct').textContent = deductionPercent;
  document.getElementById('calc-deduction-amount').textContent = `- ${formatNumber(deductionAmount)} กก.`;
  document.getElementById('calc-final-weight').textContent = `${formatNumber(finalWeight)} กก.`;
  document.getElementById('calc-price-per-kg').textContent = `${formatNumber(pricePerKg)} บาท`;
  document.getElementById('calc-total-price').textContent = `${formatNumber(totalPrice)} บาท`;

  // Show/hide deduction row
  const deductRow = document.getElementById('calc-deduction-row');
  if (deductRow) deductRow.style.display = deductionPercent > 0 ? 'flex' : 'none';
}

async function saveTransaction() {
  if (!selectedMember) { showToast('กรุณาเลือกสมาชิก', 'error'); return; }

  const cartWeight = parseFloat(document.getElementById('cart-weight').value) || 0;
  const pricePerKg = parseFloat(document.getElementById('price-per-kg').value) || 0;
  const rubberType = document.getElementById('rubber-type').value;
  const deductionPercent = cachedSettings?.deduction_percent || 0;

  // Validate at least one trip has weight
  const hasWeight = trips.some(t => t.grossWeight > 0);
  if (!hasWeight) { showToast('กรุณากรอกน้ำหนักอย่างน้อย 1 เที่ยว', 'error'); return; }
  if (pricePerKg <= 0) { showToast('กรุณากรอกราคาต่อ กก.', 'error'); return; }

  // Build trip details
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
  const totalPrice = finalWeight * pricePerKg;

  showLoading();
  try {
    const { data, error } = await sb.from('transactions').insert({
      member_code: selectedMember.code,
      member_name: selectedMember.name,
      member_account_no: selectedMember.account_no || '',
      rubber_type: rubberType,
      gross_weight: totalGross,
      cart_weight: totalCart,
      net_weight: totalNet,
      deduction_percent: deductionPercent,
      final_weight: finalWeight,
      price_per_kg: pricePerKg,
      total_price: totalPrice,
      trips: tripDetails,
      trip_count: tripDetails.length,
      date: new Date().toISOString()
    }).select().single();

    if (error) throw error;

    showToast(`บันทึกธุรกรรมสำเร็จ! ${tripDetails.length} เที่ยว ยอดเงิน ${formatNumber(totalPrice)} บาท`);
    showReceipt(data);
    await initPurchase();
  } catch (err) {
    showToast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

// ========== RECEIPT ==========
function showReceipt(tx) {
  const plantName = cachedSettings?.plantation_name || 'ลานยางพาราชุมชน';
  const tripsList = tx.trips || [];

  let tripsHtml = '';
  if (tripsList.length > 0) {
    tripsHtml = `
      <div style="border-top:1px dashed #ccc;margin:8px 0;"></div>
      <div style="font-weight:600;font-size:0.9rem;margin-bottom:6px;">รายละเอียดเที่ยวชั่ง (${tripsList.length} เที่ยว):</div>
      ${tripsList.map(t => `
        <div class="receipt-row" style="font-size:0.85rem;">
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

  document.getElementById('receipt-content').innerHTML = `
    <div class="receipt-header">
      <h3>🌿 ${plantName}</h3>
      <p>ใบเสร็จรับซื้อยางพารา</p>
      <p style="font-size:0.8rem;margin-top:4px;">${formatDateTime(tx.date)}</p>
    </div>
    <div class="receipt-row"><span>รหัสสมาชิก:</span><span>${tx.member_code}</span></div>
    <div class="receipt-row"><span>ชื่อสมาชิก:</span><span>${tx.member_name}</span></div>
    ${tx.member_account_no ? `<div class="receipt-row"><span>เลขบัญชี:</span><span>${tx.member_account_no}</span></div>` : ''}
    <div class="receipt-row"><span>ประเภทยาง:</span><span>${RUBBER_TYPES[tx.rubber_type]}</span></div>
    ${tripsHtml}
    <div style="border-top:1px dashed #ccc;margin:8px 0;"></div>
    <div class="receipt-row"><span>น้ำหนักสุทธิรวม:</span><span>${formatNumber(tx.net_weight)} กก.</span></div>
    ${deductionHtml}
    <div class="receipt-row"><span>ราคาต่อ กก.:</span><span>${formatNumber(tx.price_per_kg)} บาท</span></div>
    <div class="receipt-row total">
      <span>💰 ยอดเงินรวม:</span>
      <span>${formatNumber(tx.total_price)} บาท</span>
    </div>
    <div class="receipt-footer">
      <p>ขอบคุณที่ใช้บริการ</p>
      <p style="font-size:0.7rem;margin-top:4px;">Ref: ${(tx.id || '').substring(0, 8).toUpperCase()}</p>
    </div>
  `;

  document.getElementById('receipt-modal').classList.add('show');
}

function closeReceiptModal() {
  document.getElementById('receipt-modal').classList.remove('show');
}

// ========== HISTORY ==========
async function renderHistory() {
  // Populate member filter dropdown
  try {
    const { data: members } = await sb.from('members').select('code, name').order('code');
    const memberFilter = document.getElementById('history-member-filter');
    const currentVal = memberFilter.value;
    memberFilter.innerHTML = '<option value="">ทั้งหมด</option>' +
      (members || []).map(m => `<option value="${m.code}" ${m.code === currentVal ? 'selected' : ''}>${m.code} - ${m.name}</option>`).join('');
  } catch (err) { /* ignore */ }

  await filterHistory();
}

async function filterHistory() {
  showLoading();
  try {
    let query = sb.from('transactions').select('*').order('date', { ascending: false });

    const dateFrom = document.getElementById('history-date-from').value;
    const dateTo = document.getElementById('history-date-to').value;
    const memberCode = document.getElementById('history-member-filter').value;

    if (dateFrom) query = query.gte('date', dateFrom + 'T00:00:00');
    if (dateTo) query = query.lte('date', dateTo + 'T23:59:59');
    if (memberCode) query = query.eq('member_code', memberCode);

    const { data, error } = await query;
    if (error) throw error;

    const filtered = data || [];

    // Summary
    const totalCount = filtered.length;
    const totalWeight = filtered.reduce((s, t) => s + Number(t.final_weight || t.net_weight || 0), 0);
    const totalAmount = filtered.reduce((s, t) => s + Number(t.total_price || 0), 0);

    document.getElementById('summary-count').textContent = totalCount;
    document.getElementById('summary-weight').innerHTML = `${formatNumber(totalWeight)} <span class="unit">กก.</span>`;
    document.getElementById('summary-amount').innerHTML = `${formatNumber(totalAmount)} <span class="unit">บาท</span>`;

    // Table
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

// ========== SETTINGS ==========
async function renderSettings() {
  if (!cachedSettings) await loadSettings();
  const s = cachedSettings;

  document.getElementById('setting-plantation-name').value = s?.plantation_name || '';
  document.getElementById('setting-price-sheet').value = s?.price_sheet || '';
  document.getElementById('setting-price-cup').value = s?.price_cup || '';
  document.getElementById('setting-price-latex').value = s?.price_latex || '';
  document.getElementById('setting-cart-weight').value = s?.default_cart_weight || '';
  document.getElementById('setting-deduction-percent').value = s?.deduction_percent || '';

  document.getElementById('setting-old-password').value = '';
  document.getElementById('setting-new-password').value = '';
  document.getElementById('setting-confirm-password').value = '';
}

async function saveSettings() {
  const updateData = {
    plantation_name: document.getElementById('setting-plantation-name').value.trim() || 'ลานยางพาราชุมชน',
    price_sheet: parseFloat(document.getElementById('setting-price-sheet').value) || 0,
    price_cup: parseFloat(document.getElementById('setting-price-cup').value) || 0,
    price_latex: parseFloat(document.getElementById('setting-price-latex').value) || 0,
    default_cart_weight: parseFloat(document.getElementById('setting-cart-weight').value) || 0,
    deduction_percent: parseFloat(document.getElementById('setting-deduction-percent').value) || 0
  };

  // Handle password change
  const oldPass = document.getElementById('setting-old-password').value;
  const newPass = document.getElementById('setting-new-password').value;
  const confirmPass = document.getElementById('setting-confirm-password').value;

  if (oldPass || newPass || confirmPass) {
    if (oldPass !== cachedSettings?.admin_password) {
      showToast('รหัสผ่านเดิมไม่ถูกต้อง', 'error');
      return;
    }
    if (!newPass) { showToast('กรุณากรอกรหัสผ่านใหม่', 'error'); return; }
    if (newPass !== confirmPass) { showToast('รหัสผ่านใหม่ไม่ตรงกัน', 'error'); return; }
    updateData.admin_password = newPass;
  }

  showLoading();
  try {
    const { error } = await sb.from('settings').update(updateData).eq('id', 1);
    if (error) throw error;

    // Refresh cache
    await loadSettings();
    showToast('บันทึกการตั้งค่าสำเร็จ!');
    renderSettings();
  } catch (err) {
    showToast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
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
    closeConfirmModal();
    closeReceiptModal();
  }
});

// ========== INITIALIZATION ==========
async function init() {
  // Initialize Supabase client
  try {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (err) {
    showToast('ไม่สามารถเชื่อมต่อ Supabase ได้', 'error');
    hideLoading();
    return;
  }

  if (checkAuth()) {
    showLoading();
    await showApp();
    hideLoading();
  } else {
    document.getElementById('login-page').style.display = 'flex';
    document.getElementById('app').classList.remove('active');
    // Try to load settings for plantation name on login page
    try { await loadSettings(); } catch (e) { /* ignore */ }
  }
}

document.addEventListener('DOMContentLoaded', init);
