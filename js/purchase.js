/**
 * js/purchase.js - Rubber Purchase, Multi-Trip Scale, Truck Selection & Receipts
 * กลุ่มเกษตรกรทำสวนยางพาราท่าสะแก
 * Version: 2.0 (Phase 2 Part 2 Refactoring)
 */

(function (window) {
  'use strict';

  // ========== GLOBAL STATE REFS ==========
  window.selectedMember = window.selectedMember || null;
  window.trips = window.trips || [];
  window.editingTransaction = window.editingTransaction || null;
  window.cachedSettings = window.cachedSettings || null;
  window.RUBBER_TYPES = window.RUBBER_TYPES || {
    sheet: 'ยางแผ่นดิบ',
    cup: 'ยางก้อนถ้วย',
    latex: 'น้ำยางสด'
  };

// ========== CROSS-DEVICE FAILSAFE TRIP ENCODING HELPER ==========
function encodeTripsIntoTruckNumber(truckNum, tripDetails) {
  const baseTruck = (truckNum || '').split('__TRIPS__')[0].trim();
  if (Array.isArray(tripDetails) && tripDetails.length > 0) {
    try {
      const jsonStr = JSON.stringify(tripDetails);
      return `${baseTruck}__TRIPS__:${jsonStr}`;
    } catch (e) {
      return baseTruck;
    }
  }
  return baseTruck;
}

function decodeTripsFromTruckNumber(truckNumStr) {
  if (!truckNumStr || typeof truckNumStr !== 'string') {
    return { cleanTruckNumber: truckNumStr || '', extractedTrips: null };
  }
  if (truckNumStr.includes('__TRIPS__:')) {
    const parts = truckNumStr.split('__TRIPS__:');
    const cleanTruckNumber = parts[0].trim();
    try {
      const extractedTrips = JSON.parse(parts[1]);
      return { cleanTruckNumber, extractedTrips };
    } catch (e) {
      return { cleanTruckNumber, extractedTrips: null };
    }
  }
  return { cleanTruckNumber: truckNumStr, extractedTrips: null };
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

async function initPurchase(forceReset = false) {
  if (editingTransaction && !forceReset) {
    return;
  }

  editingTransaction = null;
  const banner = document.getElementById('purchase-edit-banner');
  const saveBtn = document.getElementById('save-transaction-btn');
  if (banner) banner.style.display = 'none';
  if (saveBtn) {
    saveBtn.innerHTML = '💾 บันทึกธุรกรรม (Ctrl+Enter)';
    saveBtn.style.background = '';
    saveBtn.style.borderColor = '';
  }

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

  if (truckSelect) {
    try {
      let existingTrucks = [];
      if (isDesktopApp()) {
        let rows = [];
        if (currentRound) {
          rows = await window.desktopDB.query('SELECT DISTINCT truck_number FROM transactions WHERE (round_id = ? OR round_id = (SELECT supabase_id FROM purchase_rounds WHERE id = ?)) AND truck_number != ""', [currentRound.id, currentRound.id]);
        } else {
          rows = await window.desktopDB.query('SELECT DISTINCT truck_number FROM transactions WHERE truck_number != "" ORDER BY id DESC LIMIT 100');
        }
        existingTrucks = Array.from(new Set((rows || []).map(t => decodeTripsFromTruckNumber(t.truck_number).cleanTruckNumber).filter(Boolean)));
      } else if (sb && !isAppOffline()) {
        let query = sb.from('transactions').select('truck_number').neq('truck_number', '');
        if (currentRound) query = query.eq('round_id', currentRound.id);
        const { data: tData } = await query;
        existingTrucks = Array.from(new Set((tData || []).map(t => decodeTripsFromTruckNumber(t.truck_number).cleanTruckNumber).filter(Boolean)));
      }

      // Filter out invalid/NEW values
      const validExistingTrucks = existingTrucks.filter(t => t && t !== 'NEW');

      // Find max truck number (e.g. คันที่ 3 -> max is 3)
      let maxTruckNo = 3;
      for (const t of validExistingTrucks) {
        const m = t.match(/คันที่\s*(\d+)/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > maxTruckNo) maxTruckNo = n;
        }
      }

      // Provide at least คันที่ 1 ถึง คันที่ 5 by default, or up to maxTruckNo + 1
      const targetLimit = Math.max(5, maxTruckNo + 1);
      const truckList = [];
      for (let i = 1; i <= targetLimit; i++) {
        truckList.push(`คันที่ ${i}`);
      }
      for (const t of validExistingTrucks) {
        if (!truckList.includes(t)) {
          truckList.push(t);
        }
      }

      if (savedTruck && savedTruck !== 'NEW') {
        const cleanSaved = decodeTripsFromTruckNumber(savedTruck).cleanTruckNumber;
        if (cleanSaved && !truckList.includes(cleanSaved)) {
          truckList.push(cleanSaved);
        }
      }

      truckSelect.innerHTML = '<option value="">-- ไม่ระบุ --</option>' +
        truckList.map(t => `<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`).join('') +
        '<option value="NEW">➕ เพิ่มรถคันใหม่...</option>';

      if (savedTruck && savedTruck !== 'NEW') {
        truckSelect.value = savedTruck;
        truckSelect.dataset.prevTruck = savedTruck;
      } else {
        truckSelect.value = '';
        truckSelect.dataset.prevTruck = '';
      }
    } catch (e) {
      console.warn('Populate truck options error:', e);
    }
  }

  if (trailerSelect && savedTrailer) {
    trailerSelect.value = savedTrailer;
  }

  // Attach keyboard event listener to member search input if needed
  const searchInput = document.getElementById('purchase-member-search');
  if (searchInput && !searchInput.dataset.hasKeydownListener) {
    searchInput.dataset.hasKeydownListener = 'true';
    searchInput.addEventListener('keydown', handlePurchaseMemberKeydown);
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

function openAddTruckModal() {
  const selectEl = document.getElementById('purchase-truck-number');
  const modal = document.getElementById('add-truck-modal');
  const input = document.getElementById('new-truck-input');

  if (!modal || !selectEl) return;

  // Calculate next suggested truck number from select options
  let maxNo = 3;
  for (const opt of selectEl.options) {
    const m = opt.value.match(/คันที่\s*(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxNo) maxNo = n;
    }
  }
  const nextSuggested = `คันที่ ${maxNo + 1}`;

  if (input) {
    input.value = nextSuggested;
  }

  modal.classList.add('show');
  setTimeout(() => {
    if (input) {
      input.focus();
      input.select();
    }
  }, 100);
}

function closeAddTruckModal() {
  const modal = document.getElementById('add-truck-modal');
  if (modal) modal.classList.remove('show');

  const selectEl = document.getElementById('purchase-truck-number');
  if (selectEl && selectEl.value === 'NEW') {
    selectEl.value = selectEl.dataset.prevTruck || '';
    updatePurchaseTruckIndicator();
  }
}

function confirmAddTruck() {
  const input = document.getElementById('new-truck-input');
  const name = (input?.value || '').trim();
  const selectEl = document.getElementById('purchase-truck-number');

  if (!name || name === 'NEW') {
    showToast('กรุณาระบุชื่อหรือหมายเลขรถ', 'warning');
    return;
  }

  if (selectEl) {
    let existingOpt = Array.from(selectEl.options).find(o => o.value === name);
    if (!existingOpt) {
      existingOpt = document.createElement('option');
      existingOpt.value = name;
      existingOpt.textContent = name;
      selectEl.insertBefore(existingOpt, selectEl.lastElementChild);
    }
    existingOpt.selected = true;
    selectEl.value = name;
    selectEl.dataset.prevTruck = name;
  }

  closeAddTruckModal();
  updatePurchaseTruckIndicator();
  showToast(`✅ เพิ่มและเลือก "${name}" เรียบร้อยแล้ว`, 'success');
}

function onPurchaseTruckSelect(val) {
  const selectEl = document.getElementById('purchase-truck-number');
  if (val === 'NEW') {
    openAddTruckModal();
  } else {
    if (selectEl) selectEl.dataset.prevTruck = val;
    updatePurchaseTruckIndicator();
  }
}

function addTrip() {
  trips.push({ grossWeight: 0 });
  renderTrips();
  calculatePrice();
  setTimeout(() => {
    const inputs = document.querySelectorAll('.trip-gross-input');
    if (inputs.length > 0) {
      inputs[inputs.length - 1].focus();
      inputs[inputs.length - 1].select();
    }
  }, 100);
}

function removeTrip(index) {
  if (trips.length <= 1) return;
  trips.splice(index, 1);
  renderTrips();
  calculatePrice();
}

function onTripGrossKeydown(e, index) {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (index === trips.length - 1) {
      addTrip();
    } else {
      const inputs = document.querySelectorAll('.trip-gross-input');
      if (inputs[index + 1]) {
        inputs[index + 1].focus();
        inputs[index + 1].select();
      }
    }
  }
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
                   oninput="onTripInput(${i}, this.value)"
                   onkeydown="onTripGrossKeydown(event, ${i})">
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

let searchTimeout;
let currentSearchMembersResults = [];
let focusedMemberIndex = -1;

async function executeSearchPurchaseMember(q) {
  const listEl = document.getElementById('purchase-member-list');
  focusedMemberIndex = -1;
  currentSearchMembersResults = [];

  if (!q) {
    if (listEl) listEl.innerHTML = '';
    return;
  }

  try {
    let members = [];
    if (isDesktopApp()) {
      const qNorm = q.padStart(3, '0');
      const qStrip = q.replace(/^0+/, '');
      
      const res = await window.desktopDB.query(
        "SELECT * FROM members WHERE code LIKE ? OR code LIKE ? OR code LIKE ? OR name LIKE ? ORDER BY code LIMIT 8",
        [`%${q}%`, `%${qNorm}%`, `%${qStrip}%`, `%${q}%`]
      );
      members = res || [];

      // If SQLite is empty, auto-seed and retry
      if (members.length === 0 && typeof SEED_MEMBERS !== 'undefined') {
        const count = await window.desktopDB.count('members');
        if (count === 0) {
          for (const sm of SEED_MEMBERS) {
            await window.desktopDB.insert('members', sm);
          }
          const retry = await window.desktopDB.query(
            "SELECT * FROM members WHERE code LIKE ? OR code LIKE ? OR code LIKE ? OR name LIKE ? ORDER BY code LIMIT 8",
            [`%${q}%`, `%${qNorm}%`, `%${qStrip}%`, `%${q}%`]
          );
          members = retry || [];
        }
      }
    } else if (sb && !isAppOffline()) {
      const { data } = await sb.from('members')
        .select('*')
        .or(`code.ilike.%${q}%,name.ilike.%${q}%`)
        .order('code')
        .limit(8);
      members = data || [];
    }

    // Always fallback to memory SEED_MEMBERS if still not found
    if ((!members || members.length === 0) && typeof SEED_MEMBERS !== 'undefined') {
      const qLower = q.toLowerCase();
      const qNorm = q.padStart(3, '0');
      const qStrip = q.replace(/^0+/, '');
      members = SEED_MEMBERS.filter(m => 
        m.code.includes(q) || m.code.includes(qNorm) || m.code.includes(qStrip) || (m.name && m.name.toLowerCase().includes(qLower))
      ).slice(0, 8);
    }

    currentSearchMembersResults = members || [];

    if (members.length === 0) {
      listEl.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:0.85rem;">ไม่พบสมาชิก</div>';
      return;
    }

    focusedMemberIndex = 0; // Default highlight first candidate!

    listEl.innerHTML = members.map((m, idx) => `
      <div class="member-search-item ${idx === 0 ? 'keyboard-focused' : ''}" data-index="${idx}" onclick='selectPurchaseMember(${JSON.stringify(m).replace(/'/g, "&#39;")})'>
        <span class="member-code-badge">${m.code}</span>
        <span>${m.name}</span>
      </div>
    `).join('');
  } catch (err) {
    console.error('searchPurchaseMember error:', err);
    listEl.innerHTML = '<div style="padding:12px;color:var(--danger);font-size:0.85rem;">เกิดข้อผิดพลาด</div>';
  }
}

function searchPurchaseMember(query) {
  clearTimeout(searchTimeout);

  const listEl = document.getElementById('purchase-member-list');
  const q = (query || '').trim();

  // If query is empty, clear results immediately without waiting 300ms
  if (!q) {
    if (listEl) listEl.innerHTML = '';
    focusedMemberIndex = -1;
    currentSearchMembersResults = [];
    return;
  }

  // Debounce 300ms before querying the database
  searchTimeout = setTimeout(() => {
    executeSearchPurchaseMember(q);
  }, 300);
}

async function handlePurchaseMemberKeydown(e) {
  const listEl = document.getElementById('purchase-member-list');
  const items = listEl ? listEl.querySelectorAll('.member-search-item') : [];

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (items.length === 0) return;
    focusedMemberIndex = (focusedMemberIndex + 1) % items.length;
    updateMemberKeyboardFocus(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (items.length === 0) return;
    focusedMemberIndex = (focusedMemberIndex - 1 + items.length) % items.length;
    updateMemberKeyboardFocus(items);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (searchTimeout) {
      clearTimeout(searchTimeout);
      if (currentSearchMembersResults.length === 0) {
        const searchInput = document.getElementById('purchase-member-search');
        if (searchInput && searchInput.value.trim()) {
          await executeSearchPurchaseMember(searchInput.value.trim());
        }
      }
    }
    if (currentSearchMembersResults.length === 0) return;

    const targetIndex = (focusedMemberIndex >= 0 && focusedMemberIndex < currentSearchMembersResults.length)
      ? focusedMemberIndex
      : 0;

    selectPurchaseMember(currentSearchMembersResults[targetIndex]);
  } else if (e.key === 'Escape') {
    listEl.innerHTML = '';
    focusedMemberIndex = -1;
  }
}

function updateMemberKeyboardFocus(items) {
  items.forEach((item, idx) => {
    if (idx === focusedMemberIndex) {
      item.classList.add('keyboard-focused');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('keyboard-focused');
    }
  });
}

function selectPurchaseMember(member) {
  selectedMember = member;
  document.getElementById('purchase-member-search').value = '';
  document.getElementById('purchase-member-list').innerHTML = '';
  currentSearchMembersResults = [];
  focusedMemberIndex = -1;

  const card = document.getElementById('selected-member-info');
  card.classList.add('show');
  document.getElementById('selected-member-avatar').textContent = member.name.charAt(0);
  document.getElementById('selected-member-name').textContent = member.name;
  document.getElementById('selected-member-code').textContent = `รหัส: ${member.code}`;

  // AUTO FOCUS TRANSFER: Focus on weight input immediately!
  setTimeout(() => {
    const inputs = document.querySelectorAll('.trip-gross-input');
    if (inputs.length > 0) {
      inputs[0].focus();
      inputs[0].select();
    }
  }, 100);
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

  const deductionAmount = Math.round((totalNet * deductionPercent / 100) * 100) / 100;
  const finalWeight = Math.round(Math.max(0, totalNet - deductionAmount) * 100) / 100;
  const totalPrice = Math.round((finalWeight * netPricePerKg) * 100) / 100;

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
  if (!currentRound) {
    showToast('❌ ยังไม่ได้เปิดรอบการรับซื้อ กรุณาเปิดรอบการรับซื้อก่อนทำรายการ', 'error');
    return;
  }
  if (!selectedMember) { showToast('กรุณาเลือกสมาชิก', 'error'); return; }

  const cartWeight = parseFloat(document.getElementById('cart-weight').value) || 0;
  const auctionPrice = parseFloat(document.getElementById('price-per-kg').value) || 0;
  const yardFee = cachedSettings && cachedSettings.yard_fee !== undefined ? parseFloat(cachedSettings.yard_fee) : 0.50;
  const netPricePerKg = Math.max(0, auctionPrice - yardFee);
  const rubberType = document.getElementById('rubber-type').value;
  const deductionPercent = cachedSettings?.deduction_percent || 0;

  // Direct DOM trip input reading to guarantee all on-screen trip boxes are captured
  const tripInputEls = document.querySelectorAll('.trip-gross-input');
  const domTrips = [];
  tripInputEls.forEach((inputEl) => {
    const val = parseFloat(inputEl.value) || 0;
    if (val > 0) {
      domTrips.push({ grossWeight: val });
    }
  });

  const activeTrips = domTrips.length > 0 ? domTrips : trips.filter(t => t.grossWeight > 0);
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

  let truckNumber = document.getElementById('purchase-truck-number')?.value || '';
  if (truckNumber === 'NEW') {
    truckNumber = '';
  }
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
  const deductionAmount = Math.round((totalNet * deductionPercent / 100) * 100) / 100;
  const finalWeight = Math.round(Math.max(0, totalNet - deductionAmount) * 100) / 100;
  const totalPrice = Math.round((finalWeight * netPricePerKg) * 100) / 100;

  const isDualMode = cachedSettings?.dual_station_mode === true;

  const encodedTruckNumber = encodeTripsIntoTruckNumber(truckNumber, tripDetails);

  showLoading();

  if (editingTransaction) {
    const editorName = currentUser?.display_name || currentUser?.username || 'ผู้ดูแลระบบ';
    const editTimestamp = formatDateTime(new Date().toISOString());
    const editorLabel = `${editorName} (${editTimestamp})`;

    const updateDataSQLite = {
      rubber_type: rubberType,
      gross_weight: totalGross,
      cart_weight: totalCart,
      net_weight: totalNet,
      deduction_percent: deductionPercent,  // FIX H2: Use actual calculated value instead of 0
      final_weight: finalWeight,
      auction_price: auctionPrice,
      yard_fee: yardFee,
      price_per_kg: netPricePerKg,
      total_price: totalPrice,
      trip_count: tripDetails.length,
      trips: JSON.stringify(tripDetails),
      trips_detail: JSON.stringify(tripDetails),
      member_code: selectedMember.code,
      member_name: selectedMember.name,
      member_account_no: selectedMember.account_no || '',
      buyer_name: cachedSettings?.auction_buyer || '',
      auction_buyer: cachedSettings?.auction_buyer || '',
      truck_number: encodedTruckNumber,
      trailer_type: trailerType,
      confirmed_by_display_name: editorLabel
    };

    // FIX H1: Include ALL important fields in cloud update payload
    const updateDataCloud = {
      rubber_type: rubberType,
      gross_weight: totalGross,
      cart_weight: totalCart,
      net_weight: totalNet,
      deduction_percent: deductionPercent,  // FIX H2
      final_weight: finalWeight,
      auction_price: auctionPrice,
      yard_fee: yardFee,
      price_per_kg: netPricePerKg,
      total_price: totalPrice,
      trip_count: tripDetails.length,
      member_code: selectedMember.code,
      member_name: selectedMember.name,
      member_account_no: selectedMember.account_no || '',
      buyer_name: cachedSettings?.auction_buyer || '',
      auction_buyer: cachedSettings?.auction_buyer || '',
      truck_number: encodedTruckNumber,
      trailer_type: trailerType,
      confirmed_by_display_name: editorLabel
    };

    try {
      if (isDesktopApp()) {
        await window.desktopDB.update('transactions', { ...updateDataSQLite, synced: 0 }, { id: editingTransaction.id });
        
        const isUUID = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
        const targetCloudId = isUUID(editingTransaction.supabase_id) ? editingTransaction.supabase_id : (isUUID(editingTransaction.id) ? editingTransaction.id : '');

        await window.desktopDB.insert('sync_queue', {
          table_name: 'transactions',
          action: 'UPDATE',
          row_data: JSON.stringify({
            ...editingTransaction,
            ...updateDataCloud,
            supabase_id: targetCloudId,
            id: targetCloudId || editingTransaction.id
          }),
          local_id: editingTransaction.id
        });

        if (sb && !isAppOffline()) {
          try {
            if (targetCloudId) {
              await sb.from('transactions').update(updateDataCloud).eq('id', targetCloudId);
            } else if (editingTransaction.member_code) {
              const txDatePrefix = (editingTransaction.date || '').slice(0, 19);
              const { data: matchTxs } = await sb.from('transactions').select('id, date').eq('member_code', editingTransaction.member_code).limit(10);
              const match = (matchTxs || []).find(t => t.date && t.date.startsWith(txDatePrefix)) || (matchTxs && matchTxs[0]);
              if (match) {
                await sb.from('transactions').update(updateDataCloud).eq('id', match.id);
                await window.desktopDB.update('transactions', { supabase_id: match.id }, { id: editingTransaction.id });
              }
            }
          } catch (e) {
            console.warn('Direct cloud update tx error:', e);
          }
        }
      } else if (sb && !isAppOffline()) {
        const { error } = await sb.from('transactions').update(updateDataCloud).eq('id', editingTransaction.id);
        if (error) throw error;
      }

      const receiptObj = {
        ...editingTransaction,
        ...updateDataSQLite
      };

      // Reset edit mode
      editingTransaction = null;
      const banner = document.getElementById('purchase-edit-banner');
      const saveBtn = document.getElementById('save-transaction-btn');
      if (banner) banner.style.display = 'none';
      if (saveBtn) {
        saveBtn.innerHTML = '💾 บันทึกธุรกรรม (Ctrl+Enter)';
        saveBtn.style.background = '';
        saveBtn.style.borderColor = '';
      }

      hideLoading();
      showToast('✅ บันทึกการแก้ไขธุรกรรมสำเร็จ!', 'success');
      showReceipt(receiptObj);
      return;
    } catch (updateErr) {
      hideLoading();
      console.error('Save edited transaction error:', updateErr);
      showToast('เกิดข้อผิดพลาดในการบันทึกการแก้ไข: ' + updateErr.message, 'error');
      return;
    }
  }

  const currentAuctionBuyer = cachedSettings?.auction_buyer || localStorage.getItem('setting_auction_buyer') || 'เฮียต้อม ยางพารา';

  let nextSeqNo = 1;
  try {
    const targetRoundId = currentRound ? currentRound.id : null;
    if (isDesktopApp()) {
      const count = await window.desktopDB.count('transactions', targetRoundId ? { round_id: targetRoundId } : {});
      nextSeqNo = (count || 0) + 1;
    } else if (sb && !isAppOffline()) {
      let seqQuery = sb.from('transactions').select('id', { count: 'exact', head: true });
      if (targetRoundId) seqQuery = seqQuery.eq('round_id', targetRoundId);
      const { count } = await seqQuery;
      nextSeqNo = (count || 0) + 1;
    }
  } catch (e) {
    nextSeqNo = 1;
  }

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
        buyer_name: currentAuctionBuyer,
        auction_buyer: currentAuctionBuyer,
        sequence_no: nextSeqNo,
        seq_no: nextSeqNo,
        queue_no: 0,
        trips: tripDetails,
        trips_detail: tripDetails,
        trip_count: tripDetails.length,
        round_id: currentRound ? currentRound.id : null,
        truck_number: encodedTruckNumber,
        trailer_type: trailerType,
        status: 'pending',
        created_by_user_id: currentUser ? currentUser.id : null,
        created_by_username: currentUser ? currentUser.username : 'user',
        created_by_display_name: currentUser ? currentUser.display_name : 'ผู้ดูแลระบบ',
        date: new Date().toISOString()
      };

      let data, error;
      if (isDesktopApp()) {
        data = await window.desktopDB.insert('pending_transactions', {
          ...pendingPayload,
          trips_detail: JSON.stringify(tripDetails)
        });
        // Also send to Supabase so Station 2 sees it in Realtime!
        if (sb && !isAppOffline()) {
          try {
            await sb.from('pending_transactions').insert(pendingPayload);
          } catch (pe) {
            console.warn('Pending tx cloud sync error:', pe);
          }
        }
      } else {
        let res = await sb.from('pending_transactions').insert(pendingPayload).select().single();
        data = res.data;
        error = res.error;
      }

      if (error) throw error;

      showToast(`📤 ส่งข้อมูลของ ${selectedMember.name} (${formatNumber(finalWeight)} กก. ยอด ${formatNumber(totalPrice)} ฿) ไปสถานีออกใบเสร็จเรียบร้อยแล้ว!`);
      await initPurchase();
    } else {
      // Single Station Mode: Save directly to SQLite & Print immediately
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
        buyer_name: currentAuctionBuyer,
        auction_buyer: currentAuctionBuyer,
        sequence_no: nextSeqNo,
        seq_no: nextSeqNo,
        queue_no: 0,
        trips: tripDetails,
        trips_detail: tripDetails,
        trip_count: tripDetails.length,
        round_id: currentRound ? currentRound.id : null,
        truck_number: encodedTruckNumber,
        trailer_type: trailerType,
        created_by_name: currentUser ? currentUser.display_name : 'ผู้ดูแลระบบ',
        created_by_display_name: currentUser ? currentUser.display_name : 'ผู้ดูแลระบบ',
        confirmed_by_display_name: '',
        date: new Date().toISOString()
      };

      let data, error;
      if (isDesktopApp()) {
        try {
          payload.sequence_no = nextSeqNo;
          payload.seq_no = nextSeqNo;

          let cloudSaved = false;
          let supabaseId = null;

          // If online, insert directly to Supabase so Machine 2 sees it via Realtime immediately!
          if (sb && !isAppOffline()) {
            try {
              const cloudPayload = { ...payload };
              if (cloudPayload.round_id && typeof cloudPayload.round_id === 'number') {
                const r = await window.desktopDB.select('purchase_rounds', ['supabase_id'], { id: cloudPayload.round_id });
                if (r && r[0] && r[0].supabase_id) cloudPayload.round_id = r[0].supabase_id;
              }
              const res = await sb.from('transactions').insert(cloudPayload).select().single();
              if (!res.error && res.data) {
                cloudSaved = true;
                supabaseId = res.data.id;
              } else {
                console.warn('Direct Supabase insert error, fallback to local queue:', res.error);
              }
            } catch (cloudErr) {
              console.warn('Direct Supabase insert network error, fallback to local queue:', cloudErr);
            }
          }

          if (cloudSaved && supabaseId) {
            // Save to SQLite as synced
            const localPayload = { ...payload };
            delete localPayload.id;
            const inserted = await window.desktopDB.insert('transactions', {
              ...localPayload,
              trips: typeof payload.trips === 'string' ? payload.trips : JSON.stringify(payload.trips || []),
              trips_detail: typeof payload.trips_detail === 'string' ? payload.trips_detail : JSON.stringify(payload.trips_detail || []),
              synced: 1,
              supabase_id: supabaseId
            });
            data = { ...payload, id: inserted.id, supabase_id: supabaseId };
          } else {
            // Offline or network error during push -> save to SQLite & sync_queue (Failsafe guarantee!)
            data = await saveOfflineTransaction(payload);
            if (!isAppOffline()) {
              window.desktopDB.syncUpload().catch(() => {});
            }
          }
        } catch (err) {
          console.error('Desktop transaction save error, emergency fallback:', err);
          data = await saveOfflineTransaction(payload);
        }
      } else if (isAppOffline()) {
        try {
          const pendingCount = await getOfflinePendingCount();
          payload.sequence_no = nextSeqNo + pendingCount;
          payload.seq_no = payload.sequence_no;
          payload.id = 'off_tx_' + Date.now();
          data = await saveOfflineTransaction(payload);
          showToast('📴 บันทึกออฟไลน์สำเร็จ! (รอซิงค์)');
        } catch (err) {
          error = err;
        }
      } else {
        try {
          let res = await sb.from('transactions').insert(payload).select().single();

          if (res.error && res.error.message && res.error.message.includes('column')) {
            delete payload.trips;
            delete payload.cart_weight;
            delete payload.auction_price;
            delete payload.yard_fee;
            delete payload.created_by_display_name;
            delete payload.confirmed_by_display_name;
            delete payload.buyer_name;
            delete payload.auction_buyer;
            delete payload.sequence_no;
            delete payload.seq_no;
            delete payload.queue_no;
            res = await sb.from('transactions').insert(payload).select().single();
            if (res.error && res.error.message && res.error.message.includes('column')) {
              delete payload.trips_detail;
              res = await sb.from('transactions').insert(payload).select().single();
            }
          }
          data = res.data;
          error = res.error;
        } catch (fetchErr) {
          console.warn('Online save failed, falling back to local:', fetchErr);
          data = await saveOfflineTransaction(payload);
        }
      }

      if (error) throw error;

      const receiptObj = {
        ...(data || payload),
        buyer_name: currentAuctionBuyer,
        auction_buyer: currentAuctionBuyer,
        sequence_no: nextSeqNo,
        seq_no: nextSeqNo,
        queue_no: 0,
        trips: tripDetails,
        trips_detail: tripDetails,
        gross_weight: totalGross,
        cart_weight: totalCart,
        net_weight: totalNet,
        final_weight: finalWeight,
        price_per_kg: netPricePerKg,
        total_price: totalPrice,
        auction_price: auctionPrice,
        yard_fee: yardFee
      };

      // Save to local memory trips cache
      if (!window._transactionTripsCache) window._transactionTripsCache = {};
      if (receiptObj.id) {
        window._transactionTripsCache[String(receiptObj.id)] = tripDetails;
      }
      if (receiptObj.member_code && receiptObj.date) {
        window._transactionTripsCache[`${receiptObj.member_code}_${receiptObj.date}`] = tripDetails;
      }

      showToast(`บันทึกธุรกรรมสำเร็จ! ${tripDetails.length} เที่ยว ยอดเงิน ${formatNumber(totalPrice)} บาท`);
      showReceipt(receiptObj);
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

    let recoveredTrips = p.trips || p.trips_detail || p.trip_details;
    if (!recoveredTrips || (Array.isArray(recoveredTrips) && recoveredTrips.length === 0)) {
      if (p.truck_number) {
        const decoded = decodeTripsFromTruckNumber(p.truck_number);
        if (Array.isArray(decoded.extractedTrips) && decoded.extractedTrips.length > 0) {
          recoveredTrips = decoded.extractedTrips;
        }
      }
    }

    if (!recoveredTrips || (Array.isArray(recoveredTrips) && recoveredTrips.length === 0)) {
      try {
        const key1 = p.id ? localStorage.getItem('pending_trips_' + p.id) : null;
        const key2 = (p.member_code && p.gross_weight) ? localStorage.getItem('pending_trips_v2_' + p.member_code + '_' + p.gross_weight) : null;
        const key3 = (p.member_code && p.gross_weight) ? localStorage.getItem('tx_trips_v2_' + p.member_code + '_' + p.gross_weight) : null;
        const memCache = window._transactionTripsCache && window._transactionTripsCache[`${p.member_code}_${p.gross_weight}`];
        
        const rawStr = key1 || key2 || key3;
        if (Array.isArray(memCache) && memCache.length > 0) recoveredTrips = memCache;
        else if (rawStr && rawStr.startsWith('[')) recoveredTrips = JSON.parse(rawStr);
      } catch (e) {}
    }

    const frozenBuyerName = p.buyer_name || p.auction_buyer || (p.id ? localStorage.getItem('tx_buyer_' + p.id) : null) || cachedSettings?.auction_buyer || localStorage.getItem('setting_auction_buyer') || '';

    let nextSeqNo = p.sequence_no || p.seq_no || p.queue_no;
    if (!nextSeqNo) {
      try {
        let seqQuery = sb.from('transactions').select('id', { count: 'exact', head: true });
        if (p.round_id) seqQuery = seqQuery.eq('round_id', p.round_id);
        const { count } = await seqQuery;
        nextSeqNo = (count || 0) + 1;
      } catch (e) {
        nextSeqNo = 1;
      }
    }

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
      total_price: Math.round(Number(p.total_price || 0) * 100) / 100,
      buyer_name: frozenBuyerName,
      auction_buyer: frozenBuyerName,
      sequence_no: nextSeqNo,
      seq_no: nextSeqNo,
      queue_no: 0,
      trips: recoveredTrips,
      trips_detail: recoveredTrips,
      trip_count: p.trip_count,
      round_id: p.round_id,
      truck_number: p.truck_number || '',
      trailer_type: p.trailer_type || 'head',
      created_by_name: p.created_by_display_name || 'ผู้ดูแลระบบ',
      created_by_display_name: p.created_by_display_name || 'ผู้ดูแลระบบ',
      confirmed_by_display_name: currentUser ? currentUser.display_name : 'ผู้ดูแลระบบ',
      date: p.date || new Date().toISOString()
    };

    let newTx = null;
    let txErr = null;
    let cloudConfirmed = false;

    if (sb && !isAppOffline()) {
      try {
        let res = await sb.from('transactions').insert(txPayload).select().single();
        if (res.error && res.error.message && res.error.message.includes('column')) {
          delete txPayload.auction_price;
          delete txPayload.yard_fee;
          delete txPayload.created_by_display_name;
          delete txPayload.confirmed_by_display_name;
          delete txPayload.trips;
          delete txPayload.trips_detail;
          delete txPayload.buyer_name;
          delete txPayload.auction_buyer;
          delete txPayload.sequence_no;
          delete txPayload.seq_no;
          delete txPayload.queue_no;
          res = await sb.from('transactions').insert(txPayload).select().single();
        }
        newTx = res.data;
        txErr = res.error;
        if (!txErr && newTx) {
          cloudConfirmed = true;
          await sb.from('pending_transactions').delete().eq('id', pendingId).catch(() => {});
        }
      } catch (netErr) {
        console.warn('Network dropped during pending confirm, falling back to local queue:', netErr);
      }
    }

    if (isDesktopApp()) {
      try {
        const localTx = {
          ...txPayload,
          trips: JSON.stringify(recoveredTrips || []),
          trips_detail: JSON.stringify(recoveredTrips || []),
          synced: cloudConfirmed ? 1 : 0,
          supabase_id: newTx ? newTx.id : null
        };
        delete localTx.id;
        const inserted = await window.desktopDB.insert('transactions', localTx);
        await window.desktopDB.delete('pending_transactions', { id: pendingId });

        // If network dropped, add to sync_queue to guarantee no data loss!
        if (!cloudConfirmed) {
          await window.desktopDB.insert('sync_queue', {
            table_name: 'transactions',
            action: 'INSERT',
            row_data: JSON.stringify(txPayload),
            local_id: inserted.id
          });
        }
        if (inserted && inserted.id && !newTx?.id) {
          txPayload.id = inserted.id;
        }
      } catch (localErr) {
        console.warn('Confirm save to local SQLite error:', localErr);
      }
    } else if (!cloudConfirmed && txErr) {
      throw txErr;
    }

    const receiptObj = {
      ...(newTx || txPayload),
      buyer_name: frozenBuyerName,
      auction_buyer: frozenBuyerName,
      sequence_no: nextSeqNo,
      seq_no: nextSeqNo,
      queue_no: 0,
      trips: recoveredTrips,
      trips_detail: recoveredTrips,
      gross_weight: p.gross_weight,
      cart_weight: p.cart_weight,
      net_weight: p.net_weight,
      final_weight: p.final_weight,
      auction_price: p.auction_price !== undefined ? p.auction_price : (newTx?.auction_price),
      yard_fee: p.yard_fee !== undefined ? p.yard_fee : (newTx?.yard_fee),
      created_by_display_name: p.created_by_display_name,
      confirmed_by_display_name: currentUser ? currentUser.display_name : 'ผู้ดูแลระบบ'
    };

    showToast(`✅ ยืนยันรายการสำเร็จ! ออกใบเสร็จของคุณ${p.member_name}`);
    showReceipt(receiptObj);
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
  
  // 1. Resolve Frozen Buyer Name (Immune to future settings modification)
  let auctionBuyer = tx.buyer_name || tx.auction_buyer;
  if (!auctionBuyer) {
    auctionBuyer = cachedSettings?.auction_buyer || localStorage.getItem('setting_auction_buyer') || '';
  }

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

  // Sequence No & Queue No (Per round sequence)
  let sequenceNo = tx.sequence_no || tx.seq_no || tx.queue_no || tx.sequence_number;
  if (!sequenceNo || Number(sequenceNo) === 0) {
    if (typeof currentFilteredHistory !== 'undefined' && Array.isArray(currentFilteredHistory) && currentFilteredHistory.length > 0) {
      const sameRoundTxs = currentFilteredHistory
        .filter(t => String(t.round_id || '') === String(tx.round_id || ''))
        .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
      const idx = sameRoundTxs.findIndex(t => String(t.id) === String(tx.id) || (t.member_code === tx.member_code && t.date === tx.date));
      if (idx !== -1) {
        sequenceNo = idx + 1;
      }
    }
  }
  if (!sequenceNo || Number(sequenceNo) === 0) {
    if (typeof currentMemberPortalTxList !== 'undefined' && Array.isArray(currentMemberPortalTxList) && currentMemberPortalTxList.length > 0) {
      const sameRoundTxs = currentMemberPortalTxList
        .filter(t => String(t.round_id || '') === String(tx.round_id || ''))
        .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
      const idx = sameRoundTxs.findIndex(t => String(t.id) === String(tx.id));
      if (idx !== -1) {
        sequenceNo = idx + 1;
      }
    }
  }
  if (!sequenceNo || Number(sequenceNo) === 0) {
    sequenceNo = 1;
  }
  const queueNo = 0;

  // Trips calculation (8 grid boxes matching paper form)
  let tripsArr = [];
  try {
    // Priority 1: Extract real trips embedded in truck_number column (Single Source of Truth across all devices)
    if (tx.truck_number) {
      const decoded = decodeTripsFromTruckNumber(tx.truck_number);
      if (Array.isArray(decoded.extractedTrips) && decoded.extractedTrips.length > 0) {
        tripsArr = decoded.extractedTrips;
      }
    }

    // Priority 2: Direct transaction trips array or JSON string
    if (!tripsArr || tripsArr.length === 0) {
      if (Array.isArray(tx.trips) && tx.trips.length > 0) {
        tripsArr = tx.trips;
      } else if (typeof tx.trips === 'string' && tx.trips.trim().startsWith('[') && tx.trips.trim() !== '[]') {
        tripsArr = JSON.parse(tx.trips);
      } else if (Array.isArray(tx.trips_detail) && tx.trips_detail.length > 0) {
        tripsArr = tx.trips_detail;
      } else if (typeof tx.trips_detail === 'string' && tx.trips_detail.trim().startsWith('[') && tx.trips_detail.trim() !== '[]') {
        tripsArr = JSON.parse(tx.trips_detail);
      } else if (typeof tx.trip_details === 'string' && tx.trip_details.trim().startsWith('[') && tx.trip_details.trim() !== '[]') {
        tripsArr = JSON.parse(tx.trip_details);
      }
    }

    // Priority 3: Fallback by ID/memory
    if ((!tripsArr || tripsArr.length === 0) && tx.id) {
      try {
        const cached = window._transactionTripsCache && window._transactionTripsCache[String(tx.id)];
        if (Array.isArray(cached) && cached.length > 0) tripsArr = cached;
      } catch (e) {}
    }
  } catch (e) {
    tripsArr = [];
  }

  if (!Array.isArray(tripsArr) || tripsArr.length === 0) {
    tripsArr = [{ gross_weight: tx.gross_weight || tx.net_weight, cart_weight: tx.cart_weight || 0, net_weight: tx.net_weight }];
  }

  let tripGridCellsHtml = '';
  const maxBoxes = 8;
  for (let i = 0; i < maxBoxes; i++) {
    const trip = tripsArr[i];
    let val = undefined;
    if (typeof trip === 'number') {
      val = trip;
    } else if (typeof trip === 'string' && !isNaN(parseFloat(trip))) {
      val = parseFloat(trip);
    } else if (trip && typeof trip === 'object') {
      val = trip.gross_weight !== undefined ? trip.gross_weight :
            (trip.grossWeight !== undefined ? trip.grossWeight :
            (trip.gross !== undefined ? trip.gross :
            (trip.net_weight !== undefined ? trip.net_weight : trip.netWeight)));
    }
    const displayVal = (val !== undefined && Number(val) > 0) ? formatNumber(val) : '-';
    tripGridCellsHtml += `<td style="border:1px solid #000; padding:3px 2px; width:12.5%; text-align:center; font-size:13px; font-weight:bold;">${displayVal}</td>`;
  }

  const totalGross = tripsArr.reduce((s, t) => s + Number(t.gross_weight || t.gross || t.net_weight || 0), 0);
  const totalCart = tripsArr.reduce((s, t) => s + Number(t.cart_weight || 0), 0);
  const finalNetWeight = Number(tx.final_weight !== undefined && tx.final_weight !== null ? tx.final_weight : (tx.net_weight !== undefined && tx.net_weight !== null ? tx.net_weight : Math.max(0, totalGross - totalCart)));

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
    <div class="receipt-single-copy" style="font-family:'Sarabun','TH Sarabun New',sans-serif; color:#000; padding:8px 14px; background:#fff; font-size:13px; line-height:1.35; border:1px solid #000; margin-bottom:4px; box-sizing:border-box;">
      <!-- Header -->
      <div style="text-align:center; margin-bottom:6px; border-bottom:1.5px solid #000; padding-bottom:4px;">
        <div style="font-size:17px; font-weight:900; color:#000; letter-spacing:0.5px;">${plantName}</div>
        <div style="font-size:12px; color:#111; margin-top:2px;">${plantAddress}</div>
      </div>

      <!-- Main Form Table -->
      <table style="width:100%; border-collapse:collapse; font-size:13.5px;">
        <tr>
          <td style="width:145px; font-weight:bold; padding:2px 0;">วันที่ขายยาง</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; font-size:14px; text-align:center;">${dateFormattedStr}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:2px 0;">ผู้ประมูล</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; font-size:14px; text-align:center;">${auctionBuyer}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:2px 0;">ลำดับที่</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; font-size:14px; text-align:center;">${sequenceNo}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:2px 0;">เลขที่บิล/คิว</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; font-size:14px; text-align:center;">${queueNo}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:2px 0;">รหัสสมาชิก</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; font-size:15px; text-align:center; color:#000;">${memberCodeFormatted}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:2px 0;">ชื่อสมาชิก</td>
          <td style="border-bottom:1px dotted #000; font-weight:900; font-size:15px; text-align:center;">${tx.member_name}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:2px 0;">ชื่อคนกรีด</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; font-size:14px; text-align:center;">${tx.member_name}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:3px 0; vertical-align:middle;">น้ำหนักชั่งแต่ละครั้ง</td>
          <td style="padding:2px 0;">
            <table style="width:100%; border-collapse:collapse;">
              <tr>
                ${tripGridCellsHtml}
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:2px 0;">น้ำหนักยางรวมรถ</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; font-size:14px; text-align:center;">${formatNumber(totalGross)}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:2px 0;">น้ำหนักรวมรถเข็น</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; font-size:14px; text-align:center;">${formatNumber(totalCart)}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:2px 0;">น้ำหนักยางสุทธิ</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; font-size:14px; text-align:center;">${formatNumber(finalNetWeight)}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding:2px 0;">ราคา / กิโลกรัม</td>
          <td style="border-bottom:1px dotted #000; font-weight:bold; font-size:14px; text-align:center;">${formatNumber(tx.price_per_kg)}</td>
        </tr>
        <tr>
          <td style="font-weight:900; padding:4px 0; font-size:15px;">จำนวนเงิน</td>
          <td style="border-bottom:2px solid #000; font-weight:900; text-align:center; font-size:18px; color:#000;">${formatNumber(tx.total_price)} บาท</td>
        </tr>
      </table>

      <!-- Signatures Footer -->
      <div style="margin-top:14px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; text-align:center; font-size:11.5px;">
        <div>
          <div style="border-bottom:1px solid #000; height:18px;"></div>
          <div style="font-weight:bold; margin-top:2px;">ผู้จัดทำ</div>
        </div>
        <div>
          <div style="border-bottom:1px solid #000; height:18px;"></div>
          <div style="font-weight:bold; margin-top:2px;">ผู้จ่ายเงิน</div>
        </div>
        <div>
          <div style="border-bottom:1px solid #000; height:18px;"></div>
          <div style="font-weight:bold; margin-top:2px;">ผู้รับเงิน</div>
        </div>
      </div>
    </div>
  `;
}

let currentReceiptTx = null;
let receiptSourceSection = 'purchase';

function showReceipt(tx, source = null) {
  currentReceiptTx = tx;
  receiptSourceSection = source || currentSection || 'purchase';
  renderReceiptContent();
  document.getElementById('receipt-modal').classList.add('show');
}

function renderReceiptContent() {
  if (!currentReceiptTx) return;
  const plantName = cachedSettings?.plantation_name || 'กลุ่มเกษตรกรชาวสวนยาง กยท.ท่าสะแก';
  const copy1 = buildReceiptCopyHTML(currentReceiptTx, plantName);
  const copy2 = buildReceiptCopyHTML(currentReceiptTx, plantName);
  const cutLine = `<div class="receipt-cut-line" style="text-align:center; font-size:11px; margin:4px 0; color:#222; font-weight:bold;">✂️ ----------------------------------------------------------------------------------------------------</div>`;

  document.getElementById('receipt-content').innerHTML = `
    ${copy1}
    ${cutLine}
    ${copy2}
  `;
}

function closeReceiptModal() {
  document.getElementById('receipt-modal').classList.remove('show');
  if (window.returnToHistoryAfterEdit) {
    window.returnToHistoryAfterEdit = false;
    navigateTo('history');
    if (typeof filterHistory === 'function') {
      filterHistory();
    }
    return;
  }
  if (receiptSourceSection === 'purchase') {
    navigateTo('purchase');
    if (typeof initPurchase === 'function') {
      initPurchase();
    }
    setTimeout(() => {
      const memberSearchInput = document.getElementById('purchase-member-search');
      if (memberSearchInput) memberSearchInput.focus();
    }, 200);
  }
}

function printReceipt() {
  if (!currentReceiptTx) return;

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
          margin: 4mm 6mm;
        }
        * {
          box-sizing: border-box;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        html, body {
          width: 100%;
          margin: 0;
          padding: 0;
          background: #fff;
          font-family: 'Sarabun', 'TH Sarabun New', sans-serif;
        }
        .page-container {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          height: 280mm;
          max-height: 282mm;
          padding: 1mm;
          box-sizing: border-box;
        }
        .receipt-single-copy {
          height: 48.5%;
          border: 1.5px solid #000;
          padding: 10px 16px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          box-sizing: border-box;
          background: #fff;
        }
        .receipt-cut-line {
          text-align: center;
          font-size: 11px;
          font-weight: bold;
          color: #000;
          letter-spacing: 2px;
          margin: 2px 0;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13.5px;
        }
        td {
          padding: 2.5px 0;
        }
      </style>
    </head>
    <body>
      <div class="page-container">
        ${copy1}
        <div class="receipt-cut-line">✂️ ----------------------------------------------------------------------------------------------------</div>
        ${copy2}
      </div>
    </body>
    </html>
  `;

  // Hidden iframe to prevent any popup windows from sticking around
  let printFrame = document.getElementById('receipt-print-iframe');
  if (!printFrame) {
    printFrame = document.createElement('iframe');
    printFrame.id = 'receipt-print-iframe';
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    document.body.appendChild(printFrame);
  }

  const frameDoc = printFrame.contentWindow.document;
  frameDoc.open();
  frameDoc.write(htmlContent);
  frameDoc.close();

  // Close receipt modal immediately
  closeReceiptModal();

  if (receiptSourceSection === 'purchase') {
    navigateTo('purchase');
    if (typeof initPurchase === 'function') {
      initPurchase();
    }
    setTimeout(() => {
      const memberSearchInput = document.getElementById('purchase-member-search');
      if (memberSearchInput) memberSearchInput.focus();
    }, 250);
  }

  // Trigger print via iframe without popup window
  setTimeout(() => {
    printFrame.contentWindow.focus();
    printFrame.contentWindow.print();
  }, 200);
}



async function editTransactionOnPurchasePage(txId) {
  if (!txId) return;
  showLoading();
  try {
    let tx = null;
    if (isDesktopApp()) {
      const res = await window.desktopDB.select('transactions', ['*'], { id: txId });
      tx = res && res.length > 0 ? res[0] : null;
    } else if (sb && !isAppOffline()) {
      const { data } = await sb.from('transactions').select('*').eq('id', txId).single();
      tx = data;
    }

    if (!tx) {
      showToast('ไม่พบข้อมูลรายการนี้', 'error');
      hideLoading();
      return;
    }

    editingTransaction = tx;
    window.returnToHistoryAfterEdit = true;

    // Navigate to purchase page
    navigateTo('purchase');

    // Populate Member
    selectedMember = {
      id: tx.member_id || tx.id,
      code: tx.member_code,
      name: tx.member_name,
      account_no: tx.member_account_no || ''
    };

    const searchInput = document.getElementById('purchase-member-search');
    const searchList = document.getElementById('purchase-member-list');
    if (searchInput) searchInput.value = '';
    if (searchList) searchList.innerHTML = '';

    const selInfo = document.getElementById('selected-member-info');
    const selName = document.getElementById('selected-member-name');
    const selCode = document.getElementById('selected-member-code');
    const selAvatar = document.getElementById('selected-member-avatar');
    if (selInfo) selInfo.classList.add('show');
    if (selName) selName.textContent = tx.member_name || '-';
    if (selCode) selCode.textContent = `รหัส: ${tx.member_code || '-'}`;
    if (selAvatar) selAvatar.textContent = (tx.member_name || '?').charAt(0);

    // FIX C5+H3: Use HISTORICAL yard_fee from the transaction, not current settings
    const yardFee = (tx.yard_fee !== undefined && tx.yard_fee !== null && !isNaN(Number(tx.yard_fee))) ? parseFloat(tx.yard_fee) : (cachedSettings && cachedSettings.yard_fee !== undefined ? parseFloat(cachedSettings.yard_fee) : 0.50);
    const cartEl = document.getElementById('cart-weight');
    const priceEl = document.getElementById('price-per-kg');
    if (cartEl) cartEl.value = tx.cart_weight || cachedSettings?.default_cart_weight || 0;
    // Use tx.auction_price if available, otherwise reconstruct from price_per_kg + yard_fee
    if (priceEl) priceEl.value = tx.auction_price ? Number(tx.auction_price).toFixed(2) : (Number(tx.price_per_kg || 0) + yardFee).toFixed(2);

    // FIX C5: Set rubber_type dropdown to match original transaction
    const rubberTypeEl = document.getElementById('rubber-type');
    if (rubberTypeEl && tx.rubber_type) {
      rubberTypeEl.value = tx.rubber_type;
    }

    // FIX C5: Decode trips from truck_number FIRST (primary source of truth)
    let tripsArr = [];
    try {
      // Priority 1: Decode from truck_number (same as buildReceiptCopyHTML)
      if (tx.truck_number && typeof decodeTripsFromTruckNumber === 'function') {
        const decoded = decodeTripsFromTruckNumber(tx.truck_number);
        const extracted = decoded.extractedTrips || decoded.trips;
        if (extracted && extracted.length > 0) {
          tripsArr = extracted;
        }
      }
      // Priority 2: Parse from trips/trips_detail fields
      if (tripsArr.length === 0) {
        if (tx.trips && typeof tx.trips === 'string' && tx.trips.startsWith('[')) tripsArr = JSON.parse(tx.trips);
        else if (tx.trips_detail && typeof tx.trips_detail === 'string' && tx.trips_detail.startsWith('[')) tripsArr = JSON.parse(tx.trips_detail);
        else if (Array.isArray(tx.trips)) tripsArr = tx.trips;
        else if (Array.isArray(tx.trips_detail)) tripsArr = tx.trips_detail;
      }
    } catch (e) {}

    if (!tripsArr || tripsArr.length === 0) {
      tripsArr = [{ gross_weight: tx.gross_weight || tx.net_weight, cart_weight: tx.cart_weight || 0 }];
    }

    trips = tripsArr.map(t => ({
      grossWeight: Number(t.gross_weight || t.grossWeight || t.gross || t.net_weight || 0)
    }));

    renderTrips();
    calculatePrice();

    // Populate Truck & Trailer
    const truckSelect = document.getElementById('purchase-truck-number');
    const trailerSelect = document.getElementById('purchase-trailer-type');
    if (truckSelect && tx.truck_number) {
      const cleanTruck = decodeTripsFromTruckNumber(tx.truck_number).cleanTruckNumber;
      if (cleanTruck && cleanTruck !== 'NEW') {
        truckSelect.value = cleanTruck;
      } else {
        truckSelect.value = '';
      }
    }
    if (trailerSelect && tx.trailer_type) {
      trailerSelect.value = tx.trailer_type;
    }
    updatePurchaseTruckIndicator();

    // Update Banner and Save Button UI
    const banner = document.getElementById('purchase-edit-banner');
    const desc = document.getElementById('purchase-edit-banner-desc');
    const saveBtn = document.getElementById('save-transaction-btn');

    if (banner) banner.style.display = 'flex';
    if (desc) desc.textContent = `สมาชิก: [${tx.member_code}] ${tx.member_name} | บันทึกเมื่อ: ${formatDateTime(tx.date || tx.created_at)}`;
    if (saveBtn) {
      saveBtn.innerHTML = '✏️ บันทึกการแก้ไขธุรกรรม (Ctrl+Enter)';
      saveBtn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
      saveBtn.style.borderColor = '#10b981';
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast(`✏️ เข้าสู่โหมดแก้ไขรายการของ ${tx.member_name}`, 'info');
  } catch (err) {
    console.error('editTransactionOnPurchasePage error:', err);
    showToast('ไม่สามารถเปิดแก้ไขรายการได้: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

function cancelEditTransaction() {
  editingTransaction = null;
  const banner = document.getElementById('purchase-edit-banner');
  const saveBtn = document.getElementById('save-transaction-btn');
  if (banner) banner.style.display = 'none';
  if (saveBtn) {
    saveBtn.innerHTML = '💾 บันทึกธุรกรรม (Ctrl+Enter)';
    saveBtn.style.background = '';
    saveBtn.style.borderColor = '';
  }
  initPurchase(true);
  navigateTo('history');
  showToast('ยกเลิกการแก้ไขรายการแล้ว');
}

async function showReceiptFromHistory(txId) {
  try {
    let tx = null;
    if (isDesktopApp()) {
      const res = await window.desktopDB.query('SELECT * FROM transactions WHERE id = ? OR supabase_id = ?', [txId, String(txId)]);
      tx = res && res.length > 0 ? res[0] : null;
    } else if (sb && !isAppOffline()) {
      const { data } = await sb.from('transactions').select('*').eq('id', txId).single();
      tx = data;
    }
    if (tx) showReceipt(tx, 'history');
  } catch (err) {
    showToast('โหลดใบเสร็จไม่สำเร็จ', 'error');
  }
}



  // Export functions to window
  window.encodeTripsIntoTruckNumber = encodeTripsIntoTruckNumber;
  window.decodeTripsFromTruckNumber = decodeTripsFromTruckNumber;
  window.updatePurchaseDualModeUI = updatePurchaseDualModeUI;
  window.initPurchase = initPurchase;
  window.updatePurchaseTruckIndicator = updatePurchaseTruckIndicator;
  window.openAddTruckModal = openAddTruckModal;
  window.closeAddTruckModal = closeAddTruckModal;
  window.confirmAddTruck = confirmAddTruck;
  window.onPurchaseTruckSelect = onPurchaseTruckSelect;
  window.addTrip = addTrip;
  window.removeTrip = removeTrip;
  window.onTripGrossKeydown = onTripGrossKeydown;
  window.renderTrips = renderTrips;
  window.onTripInput = onTripInput;
  window.executeSearchPurchaseMember = executeSearchPurchaseMember;
  window.searchPurchaseMember = searchPurchaseMember;
  window.handlePurchaseMemberKeydown = handlePurchaseMemberKeydown;
  window.updateMemberKeyboardFocus = updateMemberKeyboardFocus;
  window.selectPurchaseMember = selectPurchaseMember;
  window.clearSelectedMember = clearSelectedMember;
  window.onRubberTypeChange = onRubberTypeChange;
  window.calculatePrice = calculatePrice;
  window.saveTransaction = saveTransaction;
  window.openWeightWarningModal = openWeightWarningModal;
  window.closeWeightWarningModal = closeWeightWarningModal;
  window.buildReceiptCopyHTML = buildReceiptCopyHTML;
  window.showReceipt = showReceipt;
  window.renderReceiptContent = renderReceiptContent;
  window.closeReceiptModal = closeReceiptModal;
  window.printReceipt = printReceipt;
  window.editTransactionOnPurchasePage = editTransactionOnPurchasePage;
  window.cancelEditTransaction = cancelEditTransaction;
  window.showReceiptFromHistory = showReceiptFromHistory;

})(window);
