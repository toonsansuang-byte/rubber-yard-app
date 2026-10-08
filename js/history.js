/**
 * js/history.js - Transaction History, Batch Operations, Truck Weights & Quick Assign
 * กลุ่มเกษตรกรทำสวนยางพาราท่าสะแก
 * Version: 2.0 (Phase 3 Part 1 Refactoring)
 */

(function (window) {
  'use strict';

  // State Variables
  window.historyCurrentPage = window.historyCurrentPage || 1;
  window.HISTORY_PAGE_SIZE = window.HISTORY_PAGE_SIZE || 100;
  window.historyShowAll = window.historyShowAll || false;
  window.currentHistoryDisplayList = window.currentHistoryDisplayList || [];
  window.currentFilteredHistory = window.currentFilteredHistory || [];
  window.currentTruckWeightsRoundId = window.currentTruckWeightsRoundId || null;
  window.historyFilterOnlyUnassigned = window.historyFilterOnlyUnassigned || false;
  window.quickAssignTargetTxId = window.quickAssignTargetTxId || null;

// ========== HISTORY PAGINATION & EXPAND CONTROLS ==========
let historyCurrentPage = 1;
const HISTORY_PAGE_SIZE = 100;
let historyShowAll = false;
let currentHistoryDisplayList = [];

function renderHistoryRows() {
  const tbody = document.getElementById('history-table-body');
  const emptyState = document.getElementById('history-empty');
  if (!tbody) return;

  // Reset select all checkbox
  const selectAllCb = document.getElementById('history-select-all');
  if (selectAllCb) selectAllCb.checked = false;
  if (typeof updateHistoryBatchDeleteUI === 'function') updateHistoryBatchDeleteUI();

  const displayList = currentHistoryDisplayList || [];
  const totalCount = displayList.length;

  if (totalCount === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    if (tbody.closest('.table-container')) tbody.closest('.table-container').style.display = 'none';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  if (tbody.closest('.table-container')) tbody.closest('.table-container').style.display = 'block';

  const totalPages = Math.ceil(totalCount / HISTORY_PAGE_SIZE) || 1;
  if (historyCurrentPage > totalPages) historyCurrentPage = 1;

  let paginatedList = [];
  let startItem = 1;
  let endItem = totalCount;

  if (historyShowAll) {
    paginatedList = displayList;
    startItem = 1;
    endItem = totalCount;
  } else {
    const startIndex = (historyCurrentPage - 1) * HISTORY_PAGE_SIZE;
    paginatedList = displayList.slice(startIndex, startIndex + HISTORY_PAGE_SIZE);
    startItem = startIndex + 1;
    endItem = Math.min(startIndex + HISTORY_PAGE_SIZE, totalCount);
  }

  let rowsHtml = paginatedList.map(t => {
    const isSynced = t.synced === 1 || !!t.supabase_id || (!isDesktopApp() && !!t.id);
    const statusBadge = isSynced
      ? `<span class="badge" style="background:rgba(34, 197, 94, 0.15); color:#4ade80; border:1px solid rgba(34, 197, 94, 0.3); font-size:0.75rem; padding:3px 8px; font-weight:500; display:inline-flex; align-items:center; gap:5px; border-radius:12px;"><span style="width:6px; height:6px; border-radius:50%; background:#22c55e; display:inline-block;"></span>ซิงค์แล้ว</span>`
      : `<span class="badge" style="background:rgba(245, 158, 11, 0.15); color:#fbbf24; border:1px solid rgba(245, 158, 11, 0.3); font-size:0.75rem; padding:3px 8px; font-weight:500; display:inline-flex; align-items:center; gap:5px; border-radius:12px;"><span style="width:6px; height:6px; border-radius:50%; background:#f59e0b; display:inline-block;"></span>รอซิงค์</span>`;

    const createdBy = t.created_by_display_name || t.created_by_name || 'ผู้ดูแลระบบ';
    const rawConfirmed = (t.confirmed_by_display_name || '').trim();
    const isEdited = rawConfirmed && rawConfirmed.includes('(');
    const authorHtml = isEdited
      ? `<div style="display:inline-flex; flex-direction:column; align-items:flex-start; gap:3px;">
           <span class="badge" style="background:rgba(255,255,255,0.08); font-size:0.8rem;">${createdBy}</span>
           <span style="font-size:0.72rem; color:#fbbf24; font-weight:500; display:inline-flex; align-items:center; gap:2px; background:rgba(245,158,11,0.12); padding:2px 6px; border-radius:4px; border:1px solid rgba(245,158,11,0.25);" title="แก้ไขโดย: ${rawConfirmed}">
             ✏️ ${rawConfirmed}
           </span>
         </div>`
      : `<span class="badge" style="background:rgba(255,255,255,0.08); font-size:0.8rem;">${createdBy}</span>`;

    const rawTruck = (t.truck_number || '').trim();
    const cleanTruck = decodeTripsFromTruckNumber(rawTruck).cleanTruckNumber;
    const isUnassignedTruck = !cleanTruck || cleanTruck === '-- ไม่ระบุ --' || cleanTruck === 'NEW';

    const truckBadge = isUnassignedTruck
      ? `<span class="badge-no-truck" style="margin-left:6px; cursor:pointer;" onclick="openQuickAssignTruckModal('${t.id}')" title="คลิกเพื่อระบุรถพ่วง">⚠️ ยังไม่ระบุรถ (คลิกเลือกรถ) 🚚</span>`
      : `<span class="badge" style="background:rgba(16,185,129,0.12); color:#34d399; border:1px solid rgba(16,185,129,0.25); font-size:0.75rem; padding:2px 6px; border-radius:8px; margin-left:6px; cursor:pointer;" onclick="openQuickAssignTruckModal('${t.id}')" title="คลิกเพื่อเปลี่ยนรถพ่วง">🚚 ${escapeHTML(cleanTruck)}</span>`;

    return `
    <tr class="${isUnassignedTruck ? 'row-no-truck' : ''}">
      <td style="text-align:center;">
        <input type="checkbox" class="history-row-cb" value="${t.id}" onchange="updateHistoryBatchDeleteUI()">
      </td>
      <td>${formatDateTime(t.date)}</td>
      <td><span class="badge badge-green">${t.member_code}</span></td>
      <td>
        <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px;">
          <strong>${escapeHTML(t.member_name)}</strong>
          ${truckBadge}
        </div>
      </td>
      <td>${getRubberTypeBadge(t.rubber_type)}</td>
      <td>${t.trip_count || 1}</td>
      <td>${formatNumber(t.net_weight)} กก.</td>
      <td style="font-weight:600;color:var(--text-accent);">${formatNumber(t.final_weight || t.net_weight)} กก.</td>
      <td>${formatNumber(t.price_per_kg)}</td>
      <td style="font-weight:600;color:var(--gold);">${formatNumber(t.total_price)} ฿</td>
      <td>${authorHtml}</td>
      <td style="text-align:center;">${statusBadge}</td>
      <td>
        <button class="btn btn-secondary btn-sm btn-icon" onclick="showReceiptFromHistory('${t.id}')" title="ใบเสร็จ">🧾</button>
        <button class="btn btn-warning btn-sm btn-icon" onclick="openQuickAssignTruckModal('${t.id}')" title="ระบุรถพ่วง" style="margin-left:4px;">🚚</button>
        <button class="btn btn-primary btn-sm btn-icon" onclick="editTransactionOnPurchasePage('${t.id}')" title="แก้ไขรายการ" style="margin-left:4px;">✏️</button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="confirmDeleteTransaction('${t.id}')" title="ลบ" style="margin-left:4px;">🗑️</button>
      </td>
    </tr>
  `;
  }).join('');

  // แถบควบคุม Pagination และปุ่มแสดงทั้งหมด ท้ายตาราง
  if (totalCount > HISTORY_PAGE_SIZE) {
    let pageButtonsHtml = '';
    for (let p = 1; p <= totalPages; p++) {
      const isCurrent = !historyShowAll && p === historyCurrentPage;
      pageButtonsHtml += `
        <button type="button" class="btn btn-sm ${isCurrent ? 'btn-primary' : 'btn-secondary'}" 
                onclick="setHistoryPage(${p})" 
                style="min-width:36px; padding:3px 8px; font-weight:${isCurrent ? '700' : 'normal'};">
          ${p}
        </button>
      `;
    }

    rowsHtml += `
      <tr>
        <td colspan="13" style="text-align:center; padding:14px 18px; background:rgba(59, 130, 246, 0.08); border-top:1px solid rgba(255,255,255,0.08);">
          <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
            <div style="color:var(--text-accent, #60a5fa); font-size:0.88rem; font-weight:500;">
              ℹ️ แสดงรายการที่ <strong>${startItem} - ${endItem}</strong> จากทั้งหมด <strong>${totalCount}</strong> รายการ
            </div>
            <div style="display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary btn-sm" 
                      onclick="setHistoryPage(${Math.max(1, historyCurrentPage - 1)})" 
                      ${historyCurrentPage === 1 || historyShowAll ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''}>
                ◀ ก่อนหน้า
              </button>
              ${pageButtonsHtml}
              <button type="button" class="btn btn-secondary btn-sm" 
                      onclick="setHistoryPage(${Math.min(totalPages, historyCurrentPage + 1)})" 
                      ${historyCurrentPage === totalPages || historyShowAll ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''}>
                ถัดไป ▶
              </button>
              <button type="button" class="btn ${historyShowAll ? 'btn-warning' : 'btn-primary'} btn-sm" 
                      onclick="toggleHistoryShowAll()" 
                      style="margin-left:8px; font-weight:600; cursor:pointer;">
                ${historyShowAll ? '📄 ย่อแสดงหน้าละ 100' : `📂 แสดงทั้งหมด (${totalCount} รายการ)`}
              </button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  tbody.innerHTML = rowsHtml;
}

function scrollHistoryToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const mainContent = document.getElementById('main-content');
  if (mainContent && typeof mainContent.scrollTo === 'function') {
    mainContent.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const tableContainer = document.querySelector('#section-history .table-container');
  if (tableContainer && typeof tableContainer.scrollTo === 'function') {
    tableContainer.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function setHistoryPage(page) {
  historyCurrentPage = page;
  historyShowAll = false;
  renderHistoryRows();
  scrollHistoryToTop();
}

function toggleHistoryShowAll() {
  historyShowAll = !historyShowAll;
  if (!historyShowAll) historyCurrentPage = 1;
  renderHistoryRows();
  scrollHistoryToTop();
}


// ========== HISTORY ==========
async function renderHistory() {
  // Populate round filter & member filter
  try {
    let rounds = [];
    let members = [];
    if (isDesktopApp()) {
      if (sb && !isAppOffline()) {
        try {
          const { data: cloudRounds } = await sb.from('purchase_rounds').select('*').order('created_at', { ascending: false });
          if (cloudRounds && cloudRounds.length > 0) {
            for (const cr of cloudRounds) {
              const existing = await window.desktopDB.query('SELECT id FROM purchase_rounds WHERE supabase_id = ? OR title = ?', [String(cr.id), cr.title || '']);
              if (existing && existing.length > 0) {
                await window.desktopDB.update('purchase_rounds', {
                  title: cr.title || '',
                  status: cr.status,
                  start_date: cr.start_date,
                  closed_at: cr.closed_at,
                  closed_by_name: cr.closed_by_name || '',
                  supabase_id: String(cr.id)
                }, { id: existing[0].id });
              } else {
                await window.desktopDB.insert('purchase_rounds', {
                  title: cr.title || '',
                  status: cr.status || 'open',
                  start_date: cr.start_date || new Date().toISOString(),
                  closed_at: cr.closed_at || null,
                  closed_by_name: cr.closed_by_name || '',
                  supabase_id: String(cr.id)
                });
              }
            }
          }
        } catch (e) {
          console.warn('Sync cloud rounds in renderHistory error:', e);
        }
      }

      rounds = await window.desktopDB.query('SELECT id, title, status, supabase_id FROM purchase_rounds ORDER BY created_at DESC') || [];
      members = await window.desktopDB.query('SELECT code, name FROM members ORDER BY code') || [];
    } else if (sb && !isAppOffline()) {
      const { data: r } = await sb.from('purchase_rounds').select('id, title, status').order('created_at', { ascending: false });
      rounds = r || [];
      const { data: m } = await sb.from('members').select('code, name').order('code');
      members = m || [];
    }

    const roundFilter = document.getElementById('history-round-filter');
    const currentRoundVal = roundFilter ? roundFilter.value : '';
    if (roundFilter) {
      roundFilter.innerHTML = '<option value="">ทุกรอบการรับซื้อ</option>' +
        (rounds || []).map(r => {
          const val = r.supabase_id || r.id;
          return `<option value="${val}" ${String(val) === String(currentRoundVal) || String(r.id) === String(currentRoundVal) ? 'selected' : ''}>${r.title} (${r.status === 'open' ? '🟢 เปิดอยู่' : '🔒 ปิดแล้ว'})</option>`;
        }).join('');
    }

    const memberFilter = document.getElementById('history-member-filter');
    const currentMemberVal = memberFilter ? memberFilter.value : '';
    if (memberFilter) {
      memberFilter.innerHTML = '<option value="">สมาชิกทั้งหมด</option>' +
        (members || []).map(m => `<option value="${m.code}" ${String(m.code) === String(currentMemberVal) ? 'selected' : ''}>${m.code} - ${m.name}</option>`).join('');
    }
  } catch (err) { /* ignore */ }

  await filterHistory();
}

let currentFilteredHistory = [];

async function filterHistory() {
  showLoading();
  try {
    const roundId = document.getElementById('history-round-filter')?.value;
    const dateFrom = document.getElementById('history-date-from')?.value;
    const dateTo = document.getElementById('history-date-to')?.value;
    const memberCode = document.getElementById('history-member-filter')?.value;

    let filtered = [];

    if (isDesktopApp()) {
      if (sb && !isAppOffline()) {
        try {
          // FIX C1: Download cloud transactions to merge locally WITHOUT destructive delete
          const { data: cloudTxs } = await sb.from('transactions').select('*').order('id', { ascending: false }).limit(500);
          if (cloudTxs && cloudTxs.length > 0) {
            for (const tx of cloudTxs) {
              const existing = await window.desktopDB.query(
                'SELECT id FROM transactions WHERE supabase_id = ? OR (member_code = ? AND (round_id = ? OR round_id = (SELECT id FROM purchase_rounds WHERE supabase_id = ?)) AND ABS(final_weight - ?) < 0.01) LIMIT 1',
                [String(tx.id), tx.member_code, String(tx.round_id), String(tx.round_id), tx.final_weight || tx.net_weight || 0]
              );
              if (!existing || existing.length === 0) {
                const localTx = {
                  ...tx,
                  supabase_id: tx.id,
                  synced: 1,
                  trips: typeof tx.trips === 'string' ? tx.trips : JSON.stringify(tx.trips || []),
                  trips_detail: typeof tx.trips_detail === 'string' ? tx.trips_detail : JSON.stringify(tx.trips_detail || [])
                };
                delete localTx.id;
                await window.desktopDB.insert('transactions', localTx);
              } else {
                // Merge cloud data without overwriting valid local values with 0
                const updateData = {
                  round_id: tx.round_id,
                  supabase_id: tx.id,
                  synced: 1,
                  total_price: tx.total_price,
                  final_weight: tx.final_weight,
                  net_weight: tx.net_weight,
                  truck_number: tx.truck_number,
                  rubber_type: tx.rubber_type,
                  price_per_kg: tx.price_per_kg
                };
                if (tx.gross_weight && Number(tx.gross_weight) > 0) updateData.gross_weight = tx.gross_weight;
                if (tx.cart_weight && Number(tx.cart_weight) > 0) updateData.cart_weight = tx.cart_weight;
                if (tx.auction_price) updateData.auction_price = tx.auction_price;
                if (tx.yard_fee !== undefined && tx.yard_fee !== null) updateData.yard_fee = tx.yard_fee;
                if (tx.buyer_name) updateData.buyer_name = tx.buyer_name;
                if (tx.auction_buyer) updateData.auction_buyer = tx.auction_buyer;
                await window.desktopDB.update('transactions', updateData, { id: existing[0].id });
              }
            }
          }
        } catch (e) {
          console.warn('Sync cloud transactions in filterHistory error:', e);
        }
      }

      let sql = 'SELECT * FROM transactions WHERE 1=1';
      const params = [];
      if (roundId) {
        sql += ' AND (round_id = ? OR round_id = (SELECT id FROM purchase_rounds WHERE supabase_id = ? OR id = ?) OR round_id = (SELECT supabase_id FROM purchase_rounds WHERE id = ?))';
        params.push(roundId, roundId, roundId, roundId);
      }
      if (dateFrom) { sql += ' AND date >= ?'; params.push(dateFrom + 'T00:00:00'); }
      if (dateTo) { sql += ' AND date <= ?'; params.push(dateTo + 'T23:59:59'); }
      if (memberCode) { sql += ' AND member_code = ?'; params.push(memberCode); }
      sql += ' ORDER BY date DESC, id DESC';
      filtered = await window.desktopDB.query(sql, params);
    } else {
      let query = sb.from('transactions').select('*').order('date', { ascending: false });

      if (roundId) query = query.eq('round_id', roundId);
      if (dateFrom) query = query.gte('date', dateFrom + 'T00:00:00');
      if (dateTo) query = query.lte('date', dateTo + 'T23:59:59');
      if (memberCode) query = query.eq('member_code', memberCode);

      const { data, error } = await query;
      if (error) throw error;
      filtered = data || [];
    }

    currentFilteredHistory = filtered || [];

    // Count unassigned transactions across current filtered set
    const unassignedCount = (filtered || []).filter(t => {
      const rawTruck = (t.truck_number || '').trim();
      const clean = decodeTripsFromTruckNumber(rawTruck).cleanTruckNumber;
      return !clean || clean === '-- ไม่ระบุ --' || clean === 'NEW';
    }).length;

    const unassignedCountBadge = document.getElementById('history-unassigned-truck-count');
    if (unassignedCountBadge) unassignedCountBadge.textContent = unassignedCount;

    let displayList = filtered || [];
    if (historyFilterOnlyUnassigned) {
      displayList = displayList.filter(t => {
        const rawTruck = (t.truck_number || '').trim();
        const clean = decodeTripsFromTruckNumber(rawTruck).cleanTruckNumber;
        return !clean || clean === '-- ไม่ระบุ --' || clean === 'NEW';
      });
    }

    const totalCount = displayList.length;
    const syncedCount = displayList.filter(t => t.synced === 1 || !!t.supabase_id || (!isDesktopApp() && !!t.id)).length;
    const pendingCount = totalCount - syncedCount;
    const totalWeight = Math.round(displayList.reduce((s, t) => s + Number(t.final_weight || t.net_weight || 0), 0) * 100) / 100;
    const totalAmount = Math.round(displayList.reduce((s, t) => s + (Math.round(Number(t.total_price || 0) * 100) / 100), 0) * 100) / 100;

    const countSummaryEl = document.getElementById('summary-count');
    if (countSummaryEl) {
      const filterNote = historyFilterOnlyUnassigned ? ' <span style="color:#f59e0b; font-weight:700;">(เฉพาะยังไม่ระบุรถ)</span>' : '';
      countSummaryEl.innerHTML = `${totalCount}${filterNote} <span style="font-size:0.8rem; font-weight:400; color:var(--text-muted); display:block; margin-top:2px;">(ซิงค์แล้ว ${syncedCount} | รอซิงค์ ${pendingCount})</span>`;
    }
    document.getElementById('summary-weight').innerHTML = `${formatNumber(totalWeight)} <span class="unit">กก.</span>`;
    document.getElementById('summary-amount').innerHTML = `${formatNumber(totalAmount)} <span class="unit">บาท</span>`;

    // Admin Delete All button visibility
    const deleteAllBtn = document.getElementById('history-delete-all-btn');
    const totalBadge = document.getElementById('history-total-count-badge');
    if (deleteAllBtn) {
      if (currentUser?.role === 'admin' && displayList.length > 0) {
        deleteAllBtn.style.display = 'inline-flex';
        if (totalBadge) totalBadge.textContent = totalCount;
      } else {
        deleteAllBtn.style.display = 'none';
      }
    }

    // Store display list and render with pagination / show-all support
    currentHistoryDisplayList = displayList || [];
    historyCurrentPage = 1;
    historyShowAll = false;
    renderHistoryRows();
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
  if (!ids || ids.length === 0) return;
  showLoading();
  try {
    if (isDesktopApp()) {
      const placeholders = ids.map(() => '?').join(', ');
      const txRows = await window.desktopDB.query(`SELECT * FROM transactions WHERE id IN (${placeholders})`, ids);

      await window.desktopDB.run(`DELETE FROM transactions WHERE id IN (${placeholders})`, ids);
      await window.desktopDB.run(`DELETE FROM sync_queue WHERE table_name = 'transactions' AND local_id IN (${placeholders})`, ids);

      if (sb && !isAppOffline() && txRows && txRows.length > 0) {
        try {
          const cloudIds = txRows.map(r => r.supabase_id || r.id).filter(Boolean);
          if (cloudIds.length > 0) {
            await sb.from('transactions').delete().in('id', cloudIds);
          }
          for (const tx of txRows) {
            if (tx.member_code && tx.total_price) {
              await sb.from('transactions').delete().match({
                member_code: tx.member_code,
                total_price: tx.total_price,
                date: tx.date
              });
            }
          }
        } catch (cloudErr) {
          console.warn('Cloud batch delete error:', cloudErr);
        }
      }
    } else if (sb && !isAppOffline()) {
      const { error } = await sb.from('transactions').delete().in('id', ids);
      if (error) throw error;
    }

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
    if (isDesktopApp()) {
      const placeholders = ids.map(() => '?').join(', ');
      const txRows = await window.desktopDB.query(`SELECT * FROM transactions WHERE id IN (${placeholders})`, ids);

      await window.desktopDB.run(`DELETE FROM transactions WHERE id IN (${placeholders})`, ids);
      await window.desktopDB.run(`DELETE FROM sync_queue WHERE table_name = 'transactions' AND local_id IN (${placeholders})`, ids);

      if (sb && !isAppOffline() && txRows && txRows.length > 0) {
        try {
          const cloudIds = txRows.map(r => r.supabase_id || r.id).filter(Boolean);
          if (cloudIds.length > 0) {
            await sb.from('transactions').delete().in('id', cloudIds);
          }
          for (const tx of txRows) {
            if (tx.member_code && tx.total_price) {
              await sb.from('transactions').delete().match({
                member_code: tx.member_code,
                total_price: tx.total_price,
                date: tx.date
              });
            }
          }
        } catch (cloudErr) {
          console.warn('Cloud deleteAllFilteredHistory error:', cloudErr);
        }
      }
    } else if (sb && !isAppOffline()) {
      const { error } = await sb.from('transactions').delete().in('id', ids);
      if (error) throw error;
    }

    closeConfirmModal();
    await filterHistory();
    showToast(`ลบประวัติทั้งหมดในตัวกรองสำเร็จ (${ids.length} รายการ)`);
  } catch (err) {
    showToast('ลบไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}

// ========== TRUCK WEIGHTS (ข้อมูลน้ำหนักรถพ่วง อัตโนมัติ 100%) ==========
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
    let roundsList = [];
    if (isDesktopApp()) {
      roundsList = await window.desktopDB.query('SELECT * FROM purchase_rounds ORDER BY created_at DESC') || [];
    } else if (sb && !isAppOffline()) {
      const { data: rounds } = await sb.from('purchase_rounds').select('*').order('created_at', { ascending: false });
      roundsList = rounds || [];
    }

    let selectedRoundId = targetRoundId;
    if (!selectedRoundId && filterEl && filterEl.value) {
      selectedRoundId = filterEl.value;
    }

    if (filterEl) {
      filterEl.innerHTML = `
        ${roundsList.map(r => `<option value="${r.id}">${r.status === 'active' || r.status === 'open' ? '🟢 (กำลังเปิด) ' : '🔒 (ปิดรอบแล้ว) '} ${r.title}</option>`).join('')}
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
        const statusTag = activeRoundObj.status === 'active' || activeRoundObj.status === 'open' ? '🟢 กำลังเปิดรับซื้อ' : '🔒 ปิดรอบส่งมอบแล้ว';
        titleEl.innerHTML = `⚡ ข้อมูลน้ำหนักรถพ่วงประจำรอบ — <strong>${activeRoundObj.title}</strong> <small style="font-size:0.85rem; font-weight:normal; opacity:0.9;">(${statusTag})</small>`;
      } else {
        titleEl.textContent = '⚡ ข้อมูลน้ำหนักรถพ่วง — สรุปรวมทุกรอบส่งมอบยาง';
      }
    }

    // 3. Query all transactions for selected round or all
    let txArr = [];
    if (isDesktopApp()) {
      if (selectedRoundId && selectedRoundId !== 'all') {
        const rObj = (roundsList || []).find(r => String(r.id) === String(selectedRoundId) || String(r.supabase_id) === String(selectedRoundId));
        const sId = rObj?.supabase_id || null;
        const localId = rObj?.id || null;
        txArr = await window.desktopDB.query(
          'SELECT * FROM transactions WHERE round_id = ? OR round_id = ? OR round_id = ? OR round_id = ? ORDER BY date DESC',
          [String(localId), String(sId), String(selectedRoundId), selectedRoundId]
        ) || [];
      } else {
        txArr = await window.desktopDB.query('SELECT * FROM transactions ORDER BY date DESC') || [];
      }
    } else if (sb && !isAppOffline()) {
      let query = sb.from('transactions').select('*');
      if (selectedRoundId && selectedRoundId !== 'all') {
        const rObj = (roundsList || []).find(r => String(r.id) === String(selectedRoundId) || String(r.supabase_id) === String(selectedRoundId));
        const targetId = rObj?.supabase_id || rObj?.id || selectedRoundId;
        query = query.or(`round_id.eq.${targetId},round_id.eq.${selectedRoundId}`);
      }
      const { data: roundTx, error: txErr } = await query;
      if (txErr) throw txErr;
      txArr = roundTx || [];
    }
    const totalPurchasedWeight = txArr.reduce((s, t) => s + Number(t.final_weight || t.net_weight || 0), 0);
    const totalPurchasedAmount = txArr.reduce((s, t) => s + Number(t.total_price || 0), 0);

    // Group transactions by truck_number
    const truckGroups = {};
    let unassignedWeight = 0;

    txArr.forEach(t => {
      const wt = Number(t.final_weight || t.net_weight || 0);
      const rawTruck = (t.truck_number || '').trim();
      const decoded = decodeTripsFromTruckNumber(rawTruck);
      let cleanTruckNum = decoded.cleanTruckNumber;
      if (cleanTruckNum === 'NEW') cleanTruckNum = 'คันที่ 4';

      if (!cleanTruckNum || cleanTruckNum === '-- ไม่ระบุ --') {
        unassignedWeight += wt;
      } else {
        if (!truckGroups[cleanTruckNum]) {
          truckGroups[cleanTruckNum] = {
            truck_number: cleanTruckNum,
            head_weight: 0,
            trailer_weight: 0,
            total_weight: 0,
            tx_count: 0,
            members: new Set(),
            tx_list: []
          };
        }
        const grp = truckGroups[cleanTruckNum];
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
      if (discrepancyText) discrepancyText.innerHTML = `ยางรับซื้อคงเหลือในลานยังไม่ได้ติดป้ายขึ้นรถอีก <strong>${formatNumber(discrepancy)} กก.</strong> <button class="btn btn-warning btn-sm" onclick="goToHistoryForUnassignedTruck('${escapeHTML(selectedRoundId)}')" style="margin-left:8px; padding:2px 10px; font-size:0.75rem; font-weight:600;">🔍 ดูรายการ & แก้ไข</button>`;
      if (discrepancyWeight) { discrepancyWeight.textContent = `${formatNumber(discrepancy)} กก.`; discrepancyWeight.style.color = 'var(--warning)'; }
      if (discrepancySubtext) discrepancySubtext.innerHTML = `ยางที่ชั่งแล้วแต่ยังไม่ระบุรถ <a href="javascript:void(0)" onclick="goToHistoryForUnassignedTruck('${escapeHTML(selectedRoundId)}')" style="color:#f59e0b; text-decoration:underline; font-weight:600; margin-left:4px;">(คลิกดูรายการ)</a>`;
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
            <td><strong style="color:var(--gold); font-size:1rem;">🚛 ${escapeHTML(t.truck_number)}</strong></td>
            <td>${formatNumber(t.head_weight)} กก.</td>
            <td>${formatNumber(t.trailer_weight)} กก.</td>
            <td style="font-weight:700; color:var(--green); font-size:1rem;">${formatNumber(t.total_weight)} กก.</td>
            <td><span class="badge badge-info">${t.tx_count} เที่ยว (${t.members.size} ราย)</span></td>
            <td>
              <button class="btn btn-secondary btn-sm" onclick="showTruckMembersModal('${escapeHTML(t.truck_number)}')">🔍 ดูรายชื่อสมาชิกในรถคันนี้</button>
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

async function showTruckMembersModal(truckNum) {
  let cleanTruckNum = decodeTripsFromTruckNumber(truckNum).cleanTruckNumber;
  if (cleanTruckNum === 'NEW') cleanTruckNum = 'คันที่ 4';
  showLoading();
  try {
    let list = [];
    if (isDesktopApp()) {
      const pattern = `%${cleanTruckNum}%`;
      const extraPattern = cleanTruckNum === 'คันที่ 4' ? '%NEW%' : pattern;
      if (currentTruckWeightsRoundId && currentTruckWeightsRoundId !== 'all') {
        const rObj = (await window.desktopDB.query('SELECT * FROM purchase_rounds WHERE id = ? OR supabase_id = ?', [currentTruckWeightsRoundId, String(currentTruckWeightsRoundId)]))?.[0];
        const sId = rObj?.supabase_id || null;
        const localId = rObj?.id || null;
        list = await window.desktopDB.query(
          'SELECT * FROM transactions WHERE (truck_number LIKE ? OR truck_number LIKE ?) AND (round_id = ? OR round_id = ? OR round_id = ? OR round_id = ?)',
          [pattern, extraPattern, String(localId), String(sId), String(currentTruckWeightsRoundId), currentTruckWeightsRoundId]
        ) || [];
      } else {
        list = await window.desktopDB.query('SELECT * FROM transactions WHERE truck_number LIKE ? OR truck_number LIKE ? ORDER BY date DESC', [pattern, extraPattern]) || [];
      }
    } else if (sb && !isAppOffline()) {
      let query = sb.from('transactions').select('*').ilike('truck_number', `${cleanTruckNum}%`).order('date', { ascending: false });
      if (currentTruckWeightsRoundId && currentTruckWeightsRoundId !== 'all') {
        const { data: rList } = await sb.from('purchase_rounds').select('*');
        const rObj = (rList || []).find(r => String(r.id) === String(currentTruckWeightsRoundId) || String(r.supabase_id) === String(currentTruckWeightsRoundId));
        const targetId = rObj?.supabase_id || rObj?.id || currentTruckWeightsRoundId;
        query = query.or(`round_id.eq.${targetId},round_id.eq.${currentTruckWeightsRoundId}`);
      }
      const { data, error } = await query;
      if (error) throw error;
      list = data || [];
    }

    hideLoading();
    const modal = document.getElementById('truck-members-modal');
    const title = document.getElementById('truck-members-modal-title');
    const body = document.getElementById('truck-members-modal-body');

    if (title) title.textContent = `🚛 รายการสมาชิกใน ${cleanTruckNum} (รวม ${list.length} รายการ)`;
    
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
                  <td><span class="badge badge-green">${escapeHTML(t.member_code)}</span></td>
                  <td><strong>${escapeHTML(t.member_name)}</strong></td>
                  <td>
                    ${t.trailer_type === 'trailer' 
                      ? '<span class="badge badge-warning" style="font-size:0.8rem;">🚚 ตัวลูก</span>' 
                      : '<span class="badge badge-info" style="font-size:0.8rem;">🚛 ตัวแม่</span>'}
                  </td>
                  <td style="font-weight:700; color:var(--gold); font-size:0.95rem;">${formatNumber(t.final_weight || t.net_weight)} กก.</td>
                  <td>${escapeHTML(t.created_by_name || 'ผู้ดูแลระบบ')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
    if (modal) modal.classList.add('show');
  } catch (err) {
    hideLoading();
    showToast('โหลดข้อมูลไม่สำเร็จ: ' + err.message, 'error');
  }
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
    let targetRoundId = currentTruckWeightsRoundId || currentRound?.id || 'all';
    let roundObj = null;
    let txArr = [];

    if (isDesktopApp()) {
      const allRounds = await window.desktopDB.query('SELECT * FROM purchase_rounds ORDER BY created_at DESC') || [];
      if (targetRoundId && targetRoundId !== 'all') {
        roundObj = allRounds.find(r => String(r.id) === String(targetRoundId) || String(r.supabase_id) === String(targetRoundId));
      }
      if (!roundObj && allRounds.length > 0 && targetRoundId !== 'all') {
        roundObj = allRounds[0];
      }

      if (roundObj && roundObj.id !== 'all') {
        const sId = roundObj.supabase_id || null;
        const localId = roundObj.id || null;
        txArr = await window.desktopDB.query(
          'SELECT * FROM transactions WHERE round_id = ? OR round_id = ? OR round_id = ? OR round_id = ? ORDER BY date DESC',
          [String(localId), String(sId), String(targetRoundId), targetRoundId]
        ) || [];
      } else {
        txArr = await window.desktopDB.query('SELECT * FROM transactions ORDER BY date DESC') || [];
        roundObj = { id: 'all', title: 'ทุกรอบส่งมอบยาง (รวมทั้งหมด)', start_date: new Date().toISOString() };
      }
    } else if (sb && !isAppOffline()) {
      const { data: allRounds } = await sb.from('purchase_rounds').select('*').order('created_at', { ascending: false });
      if (targetRoundId && targetRoundId !== 'all') {
        roundObj = (allRounds || []).find(r => String(r.id) === String(targetRoundId) || String(r.supabase_id) === String(targetRoundId));
      }
      if (!roundObj && allRounds && allRounds.length > 0 && targetRoundId !== 'all') {
        roundObj = allRounds[0];
      }

      let query = sb.from('transactions').select('*');
      if (roundObj && roundObj.id !== 'all') {
        const targetId = roundObj.supabase_id || roundObj.id;
        query = query.or(`round_id.eq.${targetId},round_id.eq.${roundObj.id}`);
      }
      const { data: roundTx } = await query;
      txArr = roundTx || [];
      if (!roundObj) {
        roundObj = { id: 'all', title: 'ทุกรอบส่งมอบยาง (รวมทั้งหมด)', start_date: new Date().toISOString() };
      }
    }

    const plantName = cachedSettings?.plantation_name || 'กลุ่มเกษตรกรชาวสวนยาง กยท.ท่าสะแก';
    const totalPurchasedWeight = txArr.reduce((s, t) => s + Number(t.final_weight || t.net_weight || 0), 0);
    const totalPurchasedAmount = txArr.reduce((s, t) => s + Number(t.total_price || 0), 0);

    // Group transactions by truck_number
    const truckGroups = {};
    let unassignedWeight = 0;

    txArr.forEach(t => {
      const wt = Number(t.final_weight || t.net_weight || 0);
      const rawTruck = (t.truck_number || '').trim();
      const decoded = decodeTripsFromTruckNumber(rawTruck);
      const cleanTruckNum = decoded.cleanTruckNumber;

      if (!cleanTruckNum || cleanTruckNum === '-- ไม่ระบุ --') {
        unassignedWeight += wt;
      } else {
        if (!truckGroups[cleanTruckNum]) {
          truckGroups[cleanTruckNum] = {
            truck_number: cleanTruckNum,
            head_weight: 0,
            trailer_weight: 0,
            total_weight: 0,
            tx_count: 0
          };
        }
        const grp = truckGroups[cleanTruckNum];
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
            <td><strong>${escapeHTML(t.truck_number)}</strong></td>
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

let historyFilterOnlyUnassigned = false;

function toggleHistoryOnlyUnassignedTruck() {
  historyFilterOnlyUnassigned = !historyFilterOnlyUnassigned;
  const btn = document.getElementById('history-unassigned-truck-btn');
  if (btn) {
    if (historyFilterOnlyUnassigned) {
      btn.className = 'btn btn-warning';
      btn.style.background = '#f59e0b';
      btn.style.color = '#000';
      btn.style.fontWeight = '700';
    } else {
      btn.className = 'btn btn-secondary';
      btn.style.background = '';
      btn.style.color = '';
      btn.style.fontWeight = 'normal';
    }
  }
  filterHistory();
}

function goToHistoryForUnassignedTruck(roundId) {
  navigateTo('history');
  if (roundId && roundId !== 'all') {
    const roundSelect = document.getElementById('history-round-filter');
    if (roundSelect) roundSelect.value = roundId;
  }
  historyFilterOnlyUnassigned = true;
  const btn = document.getElementById('history-unassigned-truck-btn');
  if (btn) {
    btn.className = 'btn btn-warning';
    btn.style.background = '#f59e0b';
    btn.style.color = '#000';
    btn.style.fontWeight = '700';
  }
  filterHistory();
}

function clearHistoryFilter() {
  document.getElementById('history-round-filter').value = '';
  document.getElementById('history-date-from').value = '';
  document.getElementById('history-date-to').value = '';
  document.getElementById('history-member-filter').value = '';
  historyFilterOnlyUnassigned = false;
  const unassignedBtn = document.getElementById('history-unassigned-truck-btn');
  if (unassignedBtn) {
    unassignedBtn.className = 'btn btn-secondary';
    unassignedBtn.style.background = '';
    unassignedBtn.style.color = '';
    unassignedBtn.style.fontWeight = 'normal';
  }
  filterHistory();
}

// ========== QUICK ASSIGN TRUCK (MODAL IN HISTORY) ==========
let quickAssignTargetTxId = null;

async function openQuickAssignTruckModal(txId) {
  if (!txId) return;
  quickAssignTargetTxId = txId;
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
      return;
    }

    const nameEl = document.getElementById('qat-member-name');
    const detailsEl = document.getElementById('qat-tx-details');
    if (nameEl) nameEl.textContent = `[${tx.member_code}] ${tx.member_name}`;
    if (detailsEl) detailsEl.textContent = `น้ำหนักสุทธิ: ${formatNumber(tx.final_weight || tx.net_weight)} กก. | ยอดเงิน: ${formatNumber(tx.total_price)} บาท`;

    const truckSelect = document.getElementById('qat-truck-number');
    const trailerSelect = document.getElementById('qat-trailer-type');

    // Populate truck options
    let trucks = ['คันที่ 1', 'คันที่ 2', 'คันที่ 3', 'คันที่ 4', 'คันที่ 5'];
    if (isDesktopApp() && tx.round_id) {
      try {
        const rows = await window.desktopDB.query('SELECT DISTINCT truck_number FROM transactions WHERE (round_id = ? OR round_id = (SELECT supabase_id FROM purchase_rounds WHERE id = ?)) AND truck_number != ""', [tx.round_id, tx.round_id]);
        const existing = (rows || []).map(r => decodeTripsFromTruckNumber(r.truck_number).cleanTruckNumber).filter(Boolean);
        trucks = Array.from(new Set([...trucks, ...existing])).filter(t => t !== 'NEW');
      } catch (e) {}
    }
    if (truckSelect) {
      truckSelect.innerHTML = trucks.map(t => `<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`).join('');
      const currentClean = decodeTripsFromTruckNumber(tx.truck_number).cleanTruckNumber;
      if (currentClean && currentClean !== 'NEW' && trucks.includes(currentClean)) {
        truckSelect.value = currentClean;
      } else {
        truckSelect.value = 'คันที่ 4';
      }
    }

    if (trailerSelect) {
      trailerSelect.value = tx.trailer_type || 'head';
    }

    document.getElementById('quick-assign-truck-modal').classList.add('show');
  } catch (err) {
    console.error('openQuickAssignTruckModal error:', err);
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

function closeQuickAssignTruckModal() {
  const modal = document.getElementById('quick-assign-truck-modal');
  if (modal) modal.classList.remove('show');
  quickAssignTargetTxId = null;
}

async function confirmQuickAssignTruck() {
  if (!quickAssignTargetTxId) return;
  const truckSelect = document.getElementById('qat-truck-number');
  const trailerSelect = document.getElementById('qat-trailer-type');
  const chosenTruck = truckSelect?.value?.trim();
  const chosenTrailer = trailerSelect?.value || 'head';

  if (!chosenTruck) {
    showToast('กรุณาเลือกรถพ่วง', 'warning');
    return;
  }

  showLoading();
  try {
    let tx = null;
    if (isDesktopApp()) {
      const res = await window.desktopDB.select('transactions', ['*'], { id: quickAssignTargetTxId });
      tx = res && res.length > 0 ? res[0] : null;
    } else if (sb && !isAppOffline()) {
      const { data } = await sb.from('transactions').select('*').eq('id', quickAssignTargetTxId).single();
      tx = data;
    }
    if (!tx) throw new Error('ไม่พบข้อมูลรายการ');

    // Decode trips from existing truck_number or parse trips
    let tripsArr = [];
    if (tx.truck_number) {
      const decoded = decodeTripsFromTruckNumber(tx.truck_number);
      if (decoded.extractedTrips && decoded.extractedTrips.length > 0) {
        tripsArr = decoded.extractedTrips;
      }
    }
    if (tripsArr.length === 0 && tx.trips_detail) {
      try { tripsArr = typeof tx.trips_detail === 'string' ? JSON.parse(tx.trips_detail) : tx.trips_detail; } catch(e){}
    }
    if (tripsArr.length === 0 && tx.trips) {
      try { tripsArr = typeof tx.trips === 'string' ? JSON.parse(tx.trips) : tx.trips; } catch(e){}
    }

    const newEncodedTruck = encodeTripsIntoTruckNumber(chosenTruck, tripsArr);
    const editorName = currentUser?.display_name || currentUser?.username || 'admin';
    const editorLabel = `${editorName} (${formatDateTime(new Date().toISOString())})`;

    if (isDesktopApp()) {
      await window.desktopDB.update('transactions', {
        truck_number: newEncodedTruck,
        trailer_type: chosenTrailer,
        confirmed_by_display_name: editorLabel,
        synced: 0
      }, { id: tx.id });

      await window.desktopDB.insert('sync_queue', {
        table_name: 'transactions',
        action: 'UPDATE',
        row_data: JSON.stringify({
          ...tx,
          truck_number: newEncodedTruck,
          trailer_type: chosenTrailer,
          confirmed_by_display_name: editorLabel,
          id: tx.supabase_id || tx.id
        }),
        local_id: tx.id
      });

      if (sb && !isAppOffline()) {
        try {
          const targetCloudId = tx.supabase_id || tx.id;
          await sb.from('transactions').update({
            truck_number: newEncodedTruck,
            trailer_type: chosenTrailer,
            confirmed_by_display_name: editorLabel
          }).eq('id', targetCloudId);
        } catch (e) {
          console.warn('Supabase cloud update quick truck failed:', e);
        }
      }
    } else if (sb && !isAppOffline()) {
      await sb.from('transactions').update({
        truck_number: newEncodedTruck,
        trailer_type: chosenTrailer,
        confirmed_by_display_name: editorLabel
      }).eq('id', tx.id);
    }

    closeQuickAssignTruckModal();
    showToast(`✅ ระบุ "${chosenTruck}" ให้คุณ ${tx.member_name} เรียบร้อยแล้ว!`, 'success');
    await filterHistory();
  } catch (err) {
    console.error('confirmQuickAssignTruck error:', err);
    showToast('เกิดข้อผิดพลาดในการบันทึก: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

// ========== EDIT TRANSACTION ON PURCHASE PAGE ==========
// ========== TRANSACTION EDIT & HISTORY RECEIPT (MOVED TO js/purchase.js) ==========
// editingTransaction, editTransactionOnPurchasePage, cancelEditTransaction,
// showReceiptFromHistory are now in js/purchase.js

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
    if (isDesktopApp()) {
      const txRows = await window.desktopDB.select('transactions', ['*'], { id });
      const tx = (txRows && txRows.length > 0) ? txRows[0] : null;

      await window.desktopDB.delete('transactions', { id });
      await window.desktopDB.run('DELETE FROM sync_queue WHERE table_name = "transactions" AND local_id = ?', [id]);

      if (sb && !isAppOffline() && tx) {
        try {
          if (tx.supabase_id) {
            await sb.from('transactions').delete().eq('id', tx.supabase_id);
          } else if (tx.id) {
            await sb.from('transactions').delete().eq('id', tx.id);
          }
          if (tx.member_code && tx.total_price) {
            await sb.from('transactions').delete().match({
              member_code: tx.member_code,
              total_price: tx.total_price,
              date: tx.date
            });
          }
        } catch (cloudErr) {
          console.warn('Cloud deleteTransaction error:', cloudErr);
        }
      } else if (isAppOffline() && tx && tx.supabase_id) {
        // FIX C2: Queue DELETE for cloud sync when back online (prevent resurrection)
        try {
          await window.desktopDB.insert('sync_queue', {
            table_name: 'transactions',
            local_id: id,
            action: 'DELETE',
            row_data: JSON.stringify({ supabase_id: tx.supabase_id, member_code: tx.member_code, date: tx.date, total_price: tx.total_price }),
            retry_count: 0,
            created_at: new Date().toISOString()
          });
        } catch (qErr) {
          console.warn('Failed to queue offline delete:', qErr);
        }
      }
    } else if (sb && !isAppOffline()) {
      const { data, error } = await sb.from('transactions').delete().eq('id', id).select();
      if (error) throw error;
    }

    closeConfirmModal();
    await filterHistory();
    showToast('ลบธุรกรรมสำเร็จ!');
  } catch (err) {
    showToast('ลบไม่สำเร็จ: ' + err.message, 'error');
  }
  hideLoading();
}


  // Export functions to window
  window.renderHistoryRows = renderHistoryRows;
  window.scrollHistoryToTop = scrollHistoryToTop;
  window.setHistoryPage = setHistoryPage;
  window.toggleHistoryShowAll = toggleHistoryShowAll;
  window.renderHistory = renderHistory;
  window.filterHistory = filterHistory;
  window.toggleSelectAllHistory = toggleSelectAllHistory;
  window.deselectAllHistory = deselectAllHistory;
  window.getSelectedHistoryIds = getSelectedHistoryIds;
  window.updateHistoryBatchDeleteUI = updateHistoryBatchDeleteUI;
  window.confirmDeleteSelectedHistory = confirmDeleteSelectedHistory;
  window.deleteSelectedHistory = deleteSelectedHistory;
  window.confirmDeleteAllFilteredHistory = confirmDeleteAllFilteredHistory;
  window.deleteAllFilteredHistory = deleteAllFilteredHistory;
  window.renderTruckWeights = renderTruckWeights;
  window.showTruckMembersModal = showTruckMembersModal;
  window.closeTruckMembersModal = closeTruckMembersModal;
  window.closeEditTruckDeliveryModal = closeEditTruckDeliveryModal;
  window.saveEditTruckDelivery = saveEditTruckDelivery;
  window.closeTruckDetailModal = closeTruckDetailModal;
  window.printTruckWeightsReport = printTruckWeightsReport;
  window.toggleHistoryOnlyUnassignedTruck = toggleHistoryOnlyUnassignedTruck;
  window.goToHistoryForUnassignedTruck = goToHistoryForUnassignedTruck;
  window.clearHistoryFilter = clearHistoryFilter;
  window.openQuickAssignTruckModal = openQuickAssignTruckModal;
  window.closeQuickAssignTruckModal = closeQuickAssignTruckModal;
  window.confirmQuickAssignTruck = confirmQuickAssignTruck;
  window.confirmDeleteTransaction = confirmDeleteTransaction;
  window.deleteTransaction = deleteTransaction;

})(window);
