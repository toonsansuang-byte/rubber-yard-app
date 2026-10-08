/**
 * js/rounds.js - Purchase Rounds & Round Summary Reports Layer
 * กลุ่มเกษตรกรทำสวนยางพาราท่าสะแก
 * Version: 2.0 (Phase 2 Part 2 Refactoring)
 */

(function (window) {
  'use strict';

  // ========== GLOBAL STATE & SEASON GETTERS ==========
  window.currentRound = window.currentRound || null;
  window.currentActiveSeason = window.currentActiveSeason || {
    id: 1,
    name: 'ฤดูกาล 2569',
    is_active: 1
  };

// ========== PURCHASE ROUNDS MANAGEMENT ==========
async function loadCurrentRound() {
  try {
    let data = null;
    if (isDesktopApp()) {
      if (sb && !isAppOffline()) {
        try {
          const res = await sb.from('purchase_rounds').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(1);
          if (res.data && res.data.length > 0) {
            data = res.data;
            const r = res.data[0];
            const existing = await window.desktopDB.query('SELECT id FROM purchase_rounds WHERE supabase_id = ? OR title = ?', [String(r.id), r.title || '']);
            if (!existing || existing.length === 0) {
              await window.desktopDB.insert('purchase_rounds', {
                title: r.title || '',
                status: 'open',
                start_date: r.start_date || new Date().toISOString(),
                supabase_id: String(r.id)
              });
            } else {
              await window.desktopDB.update('purchase_rounds', {
                status: 'open',
                title: r.title || '',
                start_date: r.start_date || new Date().toISOString()
              }, { id: existing[0].id });
            }
          } else {
            // FIX C7: Check if there are pending round syncs before force-closing
            const pendingRoundSync = await window.desktopDB.query(
              'SELECT COUNT(*) as cnt FROM sync_queue WHERE table_name = "purchase_rounds"'
            );
            const hasPending = pendingRoundSync && pendingRoundSync[0] && pendingRoundSync[0].cnt > 0;
            if (!hasPending) {
              // Cloud has NO active open rounds and no pending sync → safe to close local
              await window.desktopDB.run('UPDATE purchase_rounds SET status = "closed" WHERE status = "open"');
            }
            data = hasPending ? 
              await window.desktopDB.query('SELECT * FROM purchase_rounds WHERE status = "open" ORDER BY created_at DESC LIMIT 1') : 
              null;
          }
        } catch (e) {
          console.warn('Sync loadCurrentRound error:', e);
          const openRounds = await window.desktopDB.query('SELECT * FROM purchase_rounds WHERE status = "open" ORDER BY created_at DESC LIMIT 1');
          data = openRounds;
        }
      } else {
        const openRounds = await window.desktopDB.query('SELECT * FROM purchase_rounds WHERE status = "open" ORDER BY created_at DESC LIMIT 1');
        data = openRounds;
      }
    } else if (sb && !isAppOffline()) {
      const res = await sb.from('purchase_rounds')
        .select('*')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1);
      data = res.data;
    }

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

  if (currentRound) {
    titleEl.textContent = `${currentRound.title} (เริ่มเมื่อ ${formatDateTime(currentRound.start_date)})`;
    actionsEl.innerHTML = `
      <button class="btn btn-secondary btn-sm" onclick="navigateTo('rounds')">🔍 ดูรายละเอียดรอบ</button>
      <button class="btn btn-danger btn-sm" onclick="confirmCloseRound('${currentRound.id}')">🔒 ปิดรอบนี้</button>
    `;
  } else {
    titleEl.textContent = 'ยังไม่มีรอบการรับซื้อเปิดอยู่';
    actionsEl.innerHTML = `
      <button class="btn btn-gold btn-sm" onclick="openStartRoundModal()">▶️ เริ่มรอบใหม่</button>
    `;
  }
}

function openStartRoundModal() {
  const modal = document.getElementById('start-round-modal');
  const titleInput = document.getElementById('round-title-input');
  
  // Default round name suggestion: "วันที่ 30 ส.ค. 2569"
  const today = new Date();
  titleInput.value = `วันที่ ${formatDate(today)}`;
  
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
      if (isAppOffline()) {
        closePayload.id = currentRound.id;
        await saveOfflineRound(closePayload, 'round_close');
      } else {
        let { error: closeErr } = await sb.from('purchase_rounds').update(closePayload).eq('id', currentRound.id);
        if (closeErr) {
          delete closePayload.closed_at;
          delete closePayload.closed_by_name;
          await sb.from('purchase_rounds').update(closePayload).eq('id', currentRound.id);
        }
        // FIX C6: Also close the round in local SQLite
        if (isDesktopApp()) {
          try {
            await window.desktopDB.run('UPDATE purchase_rounds SET status = "closed", end_date = ? WHERE id = ? OR supabase_id = ?', 
              [closePayload.end_date, currentRound.id, String(currentRound.id)]);
          } catch (e) { console.warn('Close round in SQLite failed:', e); }
        }
      }
    }

    // Fetch active season if not yet loaded
    if (!currentActiveSeason) {
      await loadActiveSeason();
    }
    const activeSeasonId = currentActiveSeason ? currentActiveSeason.id : null;

    // Insert new open round
    const payload = {
      title: title,
      status: 'open',
      start_date: new Date().toISOString()
    };
    if (activeSeasonId) {
      payload.season_id = activeSeasonId;
    }
    
    let data, error;
    if (isAppOffline()) {
      try {
        data = await saveOfflineRound(payload, 'round_create');
      } catch (err) {
        error = err;
      }
    } else {
      const res = await sb.from('purchase_rounds').insert(payload).select().single();
      data = res.data;
      error = res.error;
      // FIX C6: Also insert the new round into local SQLite
      if (!error && data && isDesktopApp()) {
        try {
          await window.desktopDB.insert('purchase_rounds', {
            title: data.title || title,
            status: 'open',
            start_date: data.start_date || payload.start_date,
            season_id: activeSeasonId,
            supabase_id: String(data.id)
          });
        } catch (e) { console.warn('Insert round into SQLite failed:', e); }
      }
    }

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

    let error = null;
    if (isAppOffline()) {
      updatePayload.id = roundId;
      try {
        await saveOfflineRound(updatePayload, 'round_close');
      } catch (err) {
        error = err;
      }
    } else {
      let res = await sb.from('purchase_rounds').update(updatePayload).eq('id', roundId);
      error = res.error;
      if (error) {
        console.warn('closeRound update fallback executed:', error.message);
        delete updatePayload.closed_at;
        delete updatePayload.closed_by_name;
        res = await sb.from('purchase_rounds').update(updatePayload).eq('id', roundId);
        error = res.error;
      }
      // FIX C6: Also update local SQLite when closing round online
      if (!error && isDesktopApp()) {
        try {
          await window.desktopDB.run('UPDATE purchase_rounds SET status = "closed", end_date = ? WHERE id = ? OR supabase_id = ?',
            [updatePayload.end_date, roundId, String(roundId)]);
        } catch (e) { console.warn('Close round in SQLite failed:', e); }
      }
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
      let txArr = [];
      if (isDesktopApp()) {
        const roundIds = [String(currentRound.id)];
        if (currentRound.supabase_id) roundIds.push(String(currentRound.supabase_id));
        txArr = await window.desktopDB.query('SELECT net_weight, final_weight, total_price, member_code FROM transactions WHERE round_id = ? OR round_id = ?', [roundIds[0], roundIds[1] || roundIds[0]]) || [];
      } else if (sb && !isAppOffline()) {
        const { data: roundTx } = await sb.from('transactions')
          .select('net_weight, final_weight, total_price, member_code')
          .eq('round_id', currentRound.id);
        txArr = roundTx || [];
      }

      const totalCount = txArr.length;
      const uniqueMembers = new Set(txArr.map(t => t.member_code)).size;
      const totalPurchasedWeight = Math.round(txArr.reduce((s, t) => s + Number(t.final_weight || t.net_weight || 0), 0) * 100) / 100;
      const totalPurchasedAmount = Math.round(txArr.reduce((s, t) => s + (Math.round(Number(t.total_price || 0) * 100) / 100), 0) * 100) / 100;

      // 2. Query independent truck_deliveries table for active round
      let truckDeliveries = [];
      try {
        if (isDesktopApp()) {
          truckDeliveries = await window.desktopDB.query('SELECT * FROM truck_deliveries WHERE round_id = ? ORDER BY truck_number ASC', [currentRound.id]) || [];
        } else if (sb && !isAppOffline()) {
          const { data: tdData } = await sb.from('truck_deliveries')
            .select('*')
            .eq('round_id', currentRound.id)
            .order('truck_number', { ascending: true });
          truckDeliveries = tdData || [];
        }
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
    let rounds = [];
    if (isDesktopApp()) {
      if (sb && !isAppOffline()) {
        try {
          const { data: cloudRounds } = await sb.from('purchase_rounds').select('*').order('created_at', { ascending: false });
          if (cloudRounds && cloudRounds.length > 0) {
            const cloudIds = cloudRounds.map(c => String(c.id));
            const placeholders = cloudIds.map(() => '?').join(',');
            await window.desktopDB.run(`DELETE FROM purchase_rounds WHERE supabase_id IS NOT NULL AND supabase_id != '' AND supabase_id NOT IN (${placeholders})`, cloudIds);

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
          console.warn('Sync rounds in renderRounds error:', e);
        }
      }
      rounds = await window.desktopDB.query('SELECT * FROM purchase_rounds ORDER BY created_at DESC') || [];
    } else if (sb && !isAppOffline()) {
      const { data, error } = await sb.from('purchase_rounds')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      rounds = data || [];
    }

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
    let round = null;
    let transactions = [];
    if (isDesktopApp()) {
      let r = await window.desktopDB.query('SELECT * FROM purchase_rounds WHERE id = ? OR supabase_id = ?', [roundId, String(roundId)]);
      round = r && r.length > 0 ? r[0] : null;

      if (!round && sb && !isAppOffline()) {
        try {
          const { data: cloudR } = await sb.from('purchase_rounds').select('*').eq('id', roundId).maybeSingle();
          if (cloudR) round = cloudR;
        } catch (e) {}
      }

      transactions = await window.desktopDB.query(
        'SELECT * FROM transactions WHERE round_id = ? OR round_id = ? OR round_id = (SELECT id FROM purchase_rounds WHERE supabase_id = ?) OR round_id = (SELECT supabase_id FROM purchase_rounds WHERE id = ?) ORDER BY sequence_no ASC, id ASC',
        [String(roundId), String(round?.supabase_id || roundId), String(roundId), roundId]
      ) || [];

      if ((!transactions || transactions.length === 0) && sb && !isAppOffline() && round) {
        try {
          const targetRId = round.supabase_id || round.id;
          const { data: txList } = await sb.from('transactions').select('*').eq('round_id', targetRId).order('created_at', { ascending: true }).limit(2000);
          if (txList && txList.length > 0) {
            transactions = txList;
          }
        } catch (e) {}
      }
    } else if (sb && !isAppOffline()) {
      const { data } = await sb.from('purchase_rounds').select('*').eq('id', roundId).maybeSingle();
      round = data;
      const { data: txList } = await sb.from('transactions')
        .select('*')
        .eq('round_id', roundId)
        .order('created_at', { ascending: true })
        .limit(2000);
      transactions = txList || [];
    }
    if (!round) throw new Error('ไม่พบข้อมูลรอบการรับซื้อ');

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
let currentReportView = 'queue'; // 'queue' (default - เรียงตามคิวชั่ง) or 'member' (สรุปรายสมาชิก)

function switchRoundReportView(view) {
  currentReportView = view;
  const format = localStorage.getItem('print_pref_round_report') || '1';
  if (currentReportRound) {
    renderRoundReportContent(currentReportRound, currentReportTxList, format);
  }
}

function onRoundReportFormatChange(format) {
  localStorage.setItem('print_pref_round_report', format);
  if (currentReportRound) {
    renderRoundReportContent(currentReportRound, currentReportTxList, format);
  }
}

function renderRoundReportContent(round, transactions, format) {
  const plantationName = cachedSettings?.plantation_name || 'ลานยางพาราชุมชน';

  // Ensure transactions are sorted by sequence_no ASC (คิวชั่ง), falling back to creation time
  const sortedTxs = [...transactions].sort((a, b) => {
    const seqA = (a.sequence_no !== undefined && a.sequence_no !== null && !isNaN(Number(a.sequence_no)) && Number(a.sequence_no) > 0) ? Number(a.sequence_no) : null;
    const seqB = (b.sequence_no !== undefined && b.sequence_no !== null && !isNaN(Number(b.sequence_no)) && Number(b.sequence_no) > 0) ? Number(b.sequence_no) : null;
    if (seqA !== null && seqB !== null) return seqA - seqB;
    if (seqA !== null) return -1;
    if (seqB !== null) return 1;
    const timeA = new Date(a.date || a.created_at || 0).getTime();
    const timeB = new Date(b.date || b.created_at || 0).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  // Group transactions by member (using transaction's own historical saved rates)
  const memberSummary = {};
  let grandTotalWeight = 0;
  let grandTotalGross = 0;
  let grandTotalYardFee = 0;
  let grandTotalAmount = 0;

  sortedTxs.forEach(t => {
    const code = t.member_code;
    const weight = Number(t.final_weight || t.net_weight || 0);
    const netRate = Number(t.price_per_kg || 0);
    const yardFeeRate = (t.yard_fee !== undefined && t.yard_fee !== null && !isNaN(Number(t.yard_fee))) ? Number(t.yard_fee) : (cachedSettings?.yard_fee !== undefined ? Number(cachedSettings.yard_fee) : 0.50);
    const auctionRate = (t.auction_price !== undefined && t.auction_price !== null && !isNaN(Number(t.auction_price)) && Number(t.auction_price) > 0) ? Number(t.auction_price) : (netRate + yardFeeRate);

    const grossAmt = Math.round((weight * auctionRate) * 100) / 100;
    const amount = Math.round(Number(t.total_price !== undefined && t.total_price !== null ? t.total_price : (weight * netRate)) * 100) / 100;
    const feeAmt = Math.round((grossAmt - amount) * 100) / 100;

    if (!memberSummary[code]) {
      memberSummary[code] = {
        code: code,
        name: t.member_name,
        account_no: t.member_account_no || '-',
        txCount: 0,
        totalWeight: 0,
        grossAmount: 0,
        yardFeeAmount: 0,
        totalAmount: 0,
        auctionPrice: auctionRate,
        yardFeeRate: yardFeeRate,
        netPrice: netRate
      };
    }
    memberSummary[code].txCount += 1;
    memberSummary[code].totalWeight += weight;
    memberSummary[code].grossAmount += grossAmt;
    memberSummary[code].yardFeeAmount += feeAmt;
    memberSummary[code].totalAmount += amount;

    grandTotalWeight += weight;
    grandTotalGross += grossAmt;
    grandTotalYardFee += feeAmt;
    grandTotalAmount += amount;
  });

  grandTotalWeight = Math.round(grandTotalWeight * 100) / 100;
  grandTotalGross = Math.round(grandTotalGross * 100) / 100;
  grandTotalYardFee = Math.round(grandTotalYardFee * 100) / 100;
  grandTotalAmount = Math.round(grandTotalAmount * 100) / 100;

  // Calculate weighted average prices for members with multiple sales
  Object.values(memberSummary).forEach(m => {
    if (m.totalWeight > 0) {
      m.auctionPrice = m.grossAmount / m.totalWeight;
      m.yardFeeRate = m.yardFeeAmount / m.totalWeight;
      m.netPrice = m.totalAmount / m.totalWeight;
    }
  });

  const memberRows = Object.values(memberSummary).sort((a, b) => a.code.localeCompare(b.code));

  // Determine Table HTML based on active view mode
  let tableHtml = '';
  if (currentReportView === 'queue') {
    tableHtml = `
      <table class="report-table">
        <thead>
          <tr>
            <th style="text-align:center; width:55px;">คิวที่</th>
            <th style="text-align:center; width:65px;">รหัส</th>
            <th>ชื่อ-นามสกุลสมาชิก</th>
            <th style="text-align:right;">น้ำหนัก (กก.)</th>
            <th style="text-align:right;">ราคาประมูล</th>
            <th style="text-align:right;">ยอดรวมก่อนหัก</th>
            <th style="text-align:right;">หักเข้ากลุ่ม</th>
            <th style="text-align:right;">ราคาจ่าย/กก.</th>
            <th style="text-align:right;">ยอดสุทธิ (บาท)</th>
          </tr>
        </thead>
        <tbody>
          ${sortedTxs.length === 0 ? '<tr><td colspan="9" style="text-align:center;color:#64748b;">ไม่มีข้อมูลธุรกรรมในรอบนี้</td></tr>' : 
            sortedTxs.map((t, idx) => {
              const seq = t.sequence_no || t.seq_no || t.queue_no || (idx + 1);
              const wt = Number(t.final_weight || t.net_weight || 0);
              const netRate = Number(t.price_per_kg || 0);
              const yardFeeRate = (t.yard_fee !== undefined && t.yard_fee !== null && !isNaN(Number(t.yard_fee))) ? Number(t.yard_fee) : 0.50;
              const auctionRate = (t.auction_price !== undefined && t.auction_price !== null && !isNaN(Number(t.auction_price)) && Number(t.auction_price) > 0) ? Number(t.auction_price) : (netRate + yardFeeRate);
              const grossAmt = Math.round((wt * auctionRate) * 100) / 100;
              const netAmt = Math.round(Number(t.total_price !== undefined && t.total_price !== null ? t.total_price : (wt * netRate)) * 100) / 100;
              const feeAmt = Math.round((grossAmt - netAmt) * 100) / 100;

              return `
                <tr>
                  <td style="text-align:center; font-weight:bold; color:#0f172a; background:#f8fafc;">${seq}</td>
                  <td style="text-align:center;"><strong>${escapeHTML(t.member_code)}</strong></td>
                  <td>${escapeHTML(t.member_name)}</td>
                  <td style="text-align:right; font-weight:600;">${formatNumber(wt)}</td>
                  <td style="text-align:right;">${formatNumber(auctionRate)}</td>
                  <td style="text-align:right; font-weight:600;">${formatNumber(grossAmt)}</td>
                  <td style="text-align:right; color:#b45309; font-weight:600;">${formatNumber(feeAmt)}</td>
                  <td style="text-align:right;">${formatNumber(netRate)}</td>
                  <td style="text-align:right; font-weight:700; color:#059669;">${formatNumber(netAmt)}</td>
                </tr>
              `;
            }).join('')
          }
          <tr class="total-row">
            <td colspan="3" style="text-align:right;">ยอดรวมสุทธิทั้งรอบ:</td>
            <td style="text-align:right; font-weight:bold;">${formatNumber(grandTotalWeight)} กก.</td>
            <td></td>
            <td style="text-align:right; font-weight:bold;">${formatNumber(grandTotalGross)}</td>
            <td style="text-align:right; color:#b45309; font-weight:bold;">${formatNumber(grandTotalYardFee)}</td>
            <td></td>
            <td style="text-align:right; color:#059669; font-weight:bold;">${formatNumber(grandTotalAmount)} บาท</td>
          </tr>
        </tbody>
      </table>
    `;
  } else {
    tableHtml = `
      <table class="report-table">
        <thead>
          <tr>
            <th style="text-align:center; width:65px;">รหัส</th>
            <th>ชื่อ-นามสกุลสมาชิก</th>
            <th style="text-align:center; width:130px;">เลขที่บัญชี</th>
            <th style="text-align:right;">น้ำหนัก (กก.)</th>
            <th style="text-align:right;">ราคาประมูล</th>
            <th style="text-align:right;">ยอดรวมก่อนหัก</th>
            <th style="text-align:right;">หักเข้ากลุ่ม</th>
            <th style="text-align:right;">ราคาจ่าย/กก.</th>
            <th style="text-align:right;">ยอดสุทธิ (บาท)</th>
          </tr>
        </thead>
        <tbody>
          ${memberRows.length === 0 ? '<tr><td colspan="9" style="text-align:center;color:#64748b;">ไม่มีข้อมูลธุรกรรมในรอบนี้</td></tr>' : 
            memberRows.map(m => `
              <tr>
                <td style="text-align:center;"><strong>${escapeHTML(m.code)}</strong></td>
                <td>${escapeHTML(m.name)}</td>
                <td style="text-align:center; font-family:monospace;">${escapeHTML(m.account_no)}</td>
                <td style="text-align:right;">${formatNumber(m.totalWeight)}</td>
                <td style="text-align:right;">${formatNumber(m.auctionPrice)}</td>
                <td style="text-align:right; font-weight:600;">${formatNumber(m.grossAmount)}</td>
                <td style="text-align:right; color:#b45309; font-weight:600;">${formatNumber(m.yardFeeAmount)}</td>
                <td style="text-align:right;">${formatNumber(m.netPrice)}</td>
                <td style="text-align:right; font-weight:700; color:#059669;">${formatNumber(m.totalAmount)}</td>
              </tr>
            `).join('')
          }
          <tr class="total-row">
            <td colspan="3" style="text-align:right;">ยอดรวมสุทธิทั้งรอบ:</td>
            <td style="text-align:right; font-weight:bold;">${formatNumber(grandTotalWeight)} กก.</td>
            <td></td>
            <td style="text-align:right; font-weight:bold;">${formatNumber(grandTotalGross)}</td>
            <td style="text-align:right; color:#b45309; font-weight:bold;">${formatNumber(grandTotalYardFee)}</td>
            <td></td>
            <td style="text-align:right; color:#059669; font-weight:bold;">${formatNumber(grandTotalAmount)} บาท</td>
          </tr>
        </tbody>
      </table>
    `;
  }

  const singleReportHtml = `
    <div class="no-print" style="display:flex; justify-content:center; gap:10px; margin-bottom:16px;">
      <button class="btn btn-sm ${currentReportView === 'queue' ? 'btn-primary' : 'btn-secondary'}" onclick="switchRoundReportView('queue')" style="${currentReportView === 'queue' ? 'font-weight:bold; box-shadow: 0 0 8px rgba(16,185,129,0.3);' : ''}">
        🚚 เรียงตามลำดับคิวชั่ง (${sortedTxs.length} คิว)
      </button>
      <button class="btn btn-sm ${currentReportView === 'member' ? 'btn-primary' : 'btn-secondary'}" onclick="switchRoundReportView('member')" style="${currentReportView === 'member' ? 'font-weight:bold; box-shadow: 0 0 8px rgba(16,185,129,0.3);' : ''}">
        👤 รวมยอดรายสมาชิก (${memberRows.length} คน)
      </button>
    </div>

    <div class="round-report-header">
      <h2>🌿 ${plantationName}</h2>
      <p>เอกสารสรุปผลการส่งมอบยางพาราประจำรอบ ${currentReportView === 'queue' ? '(เรียงตามลำดับคิวชั่ง)' : '(สรุปยอดรายสมาชิก)'}</p>
      <h3 style="margin-top:6px; color:#0f172a;">${round.title}</h3>
    </div>

    <div class="report-meta-grid" style="display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin-bottom:14px;">
      <div class="report-meta-item">
        <div class="meta-label">วันที่</div>
        <div class="meta-val">${formatDate(round.start_date)}</div>
      </div>
      <div class="report-meta-item">
        <div class="meta-label">จำนวนรายการ</div>
        <div class="meta-val">${sortedTxs.length} คิว (${memberRows.length} คน)</div>
      </div>
      <div class="report-meta-item">
        <div class="meta-label">น้ำหนักสุทธิรวม</div>
        <div class="meta-val" style="color:#0f172a;">${formatNumber(grandTotalWeight)} กก.</div>
      </div>
      <div class="report-meta-item">
        <div class="meta-label">เงินคงเหลือเข้ากลุ่ม</div>
        <div class="meta-val" style="color:#b45309;">${formatNumber(grandTotalYardFee)} บาท</div>
      </div>
    </div>

    ${tableHtml}

    <div class="report-footer-sign">
      <div class="sign-box">
        ลงชื่อ...................................................<br>
        (${round.closed_by_name || currentUser?.display_name || 'ผู้สรุปรอบ'})<br>
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
  let transactions = currentReportTxList;

  if (roundId && (!round || round.id !== roundId)) {
    try {
      if (isDesktopApp()) {
        const r = await window.desktopDB.query('SELECT * FROM purchase_rounds WHERE id = ? OR supabase_id = ?', [roundId, String(roundId)]);
        if (r && r.length > 0) round = r[0];
        transactions = await window.desktopDB.query('SELECT * FROM transactions WHERE round_id = ? OR round_id = ? OR round_id = (SELECT id FROM purchase_rounds WHERE supabase_id = ?) ORDER BY sequence_no ASC, id ASC', [roundId, String(round?.supabase_id || roundId), String(roundId)]) || [];
      } else if (sb && !isAppOffline()) {
        const { data } = await sb.from('purchase_rounds').select('*').eq('id', roundId).single();
        if (data) round = data;
        const { data: txList } = await sb.from('transactions').select('*').eq('round_id', roundId).order('created_at', { ascending: true }).limit(2000);
        transactions = txList || [];
      }
    } catch (e) { /* ignore */ }
  }

  if (!round) {
    showToast('ไม่พบข้อมูลรอบส่งมอบยาง', 'error');
    return;
  }

  if (!transactions || transactions.length === 0) {
    if (isDesktopApp()) {
      transactions = await window.desktopDB.query(
        'SELECT * FROM transactions WHERE round_id = ? OR round_id = ? OR round_id = (SELECT id FROM purchase_rounds WHERE supabase_id = ?) OR round_id = (SELECT supabase_id FROM purchase_rounds WHERE id = ?) ORDER BY sequence_no ASC, id ASC',
        [round.id, String(round.supabase_id || round.id), String(round.id), round.id]
      ) || [];
    }
    if ((!transactions || transactions.length === 0) && sb && !isAppOffline()) {
      try {
        const targetRId = round.supabase_id || round.id;
        const { data: txList } = await sb.from('transactions').select('*').eq('round_id', targetRId).order('created_at', { ascending: true }).limit(2000);
        transactions = txList || [];
      } catch (e) {}
    }
  }

  showLoading();
  try {
    const plantationName = cachedSettings?.plantation_name || 'กลุ่มเกษตรกรชาวสวนยาง กยท.ท่าสะแก';
    const plantationAddress = cachedSettings?.plantation_address || 'เลขที่ 127 หมู่7 ต.ท่าสะแก อ.ชาติตระการ จ.พิษณุโลก';

    // Sort by sequence_no ASC, falling back to creation time
    const sortedTxs = [...transactions].sort((a, b) => {
      const seqA = (a.sequence_no !== undefined && a.sequence_no !== null && !isNaN(Number(a.sequence_no)) && Number(a.sequence_no) > 0) ? Number(a.sequence_no) : null;
      const seqB = (b.sequence_no !== undefined && b.sequence_no !== null && !isNaN(Number(b.sequence_no)) && Number(b.sequence_no) > 0) ? Number(b.sequence_no) : null;
      if (seqA !== null && seqB !== null) return seqA - seqB;
      if (seqA !== null) return -1;
      if (seqB !== null) return 1;
      const timeA = new Date(a.date || a.created_at || 0).getTime();
      const timeB = new Date(b.date || b.created_at || 0).getTime();
      if (timeA !== timeB) return timeA - timeB;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    let grandTotalWeight = 0;
    let grandTotalGross = 0;
    let grandTotalYardFee = 0;
    let grandTotalAmount = 0;

    const memberSummary = {};

    sortedTxs.forEach(t => {
      const code = t.member_code;
      const wt = Number(t.final_weight || t.net_weight || 0);
      const netRate = Number(t.price_per_kg || 0);
      const yardFeeRate = (t.yard_fee !== undefined && t.yard_fee !== null && !isNaN(Number(t.yard_fee))) ? Number(t.yard_fee) : 0.50;
      const auctionRate = (t.auction_price !== undefined && t.auction_price !== null && !isNaN(Number(t.auction_price)) && Number(t.auction_price) > 0) ? Number(t.auction_price) : (netRate + yardFeeRate);
      const grossAmt = Math.round((wt * auctionRate) * 100) / 100;
      const amt = Math.round(Number(t.total_price !== undefined && t.total_price !== null ? t.total_price : (wt * netRate)) * 100) / 100;
      const feeAmt = Math.round((grossAmt - amt) * 100) / 100;

      if (!memberSummary[code]) {
        memberSummary[code] = {
          code: code,
          name: t.member_name,
          account_no: t.member_account_no || '-',
          totalWeight: 0,
          grossAmount: 0,
          yardFeeAmount: 0,
          totalAmount: 0,
          auctionPrice: auctionRate,
          yardFeeRate: yardFeeRate,
          netPrice: netRate
        };
      }
      memberSummary[code].totalWeight += wt;
      memberSummary[code].grossAmount += grossAmt;
      memberSummary[code].yardFeeAmount += feeAmt;
      memberSummary[code].totalAmount += amt;

      grandTotalWeight += wt;
      grandTotalGross += grossAmt;
      grandTotalYardFee += feeAmt;
      grandTotalAmount += amt;
    });

    grandTotalWeight = Math.round(grandTotalWeight * 100) / 100;
    grandTotalGross = Math.round(grandTotalGross * 100) / 100;
    grandTotalYardFee = Math.round(grandTotalYardFee * 100) / 100;
    grandTotalAmount = Math.round(grandTotalAmount * 100) / 100;

    Object.values(memberSummary).forEach(m => {
      if (m.totalWeight > 0) {
        m.auctionPrice = m.grossAmount / m.totalWeight;
        m.yardFeeRate = m.yardFeeAmount / m.totalWeight;
        m.netPrice = m.totalAmount / m.totalWeight;
      }
    });

    const memberRows = Object.values(memberSummary).sort((a, b) => a.code.localeCompare(b.code));

    let tableRowsHtml = '';
    let tableHeaderHtml = '';
    let sheetName = '';
    let filePrefix = '';

    if (currentReportView === 'queue') {
      sheetName = 'สรุปตามคิวชั่ง';
      filePrefix = 'สรุปผลส่งมอบยาง_ตามคิวชั่ง';
      tableHeaderHtml = `
        <tr>
          <th style="width: 55px;">คิวที่</th>
          <th style="width: 80px;">รหัสสมาชิก</th>
          <th style="width: 220px;">ชื่อ-นามสกุลสมาชิก</th>
          <th style="width: 130px;">น้ำหนักยางสุทธิ (กก.)</th>
          <th style="width: 110px;">ราคาประมูล (บาท)</th>
          <th style="width: 150px;">ยอดรวมก่อนหัก (บาท)</th>
          <th style="width: 140px;">หักเข้ากลุ่ม (บาท)</th>
          <th style="width: 110px;">ราคาจ่าย/กก. (บาท)</th>
          <th style="width: 170px;">ยอดสุทธิ (บาท)</th>
        </tr>
      `;
      tableRowsHtml = sortedTxs.map((t, idx) => {
        const seq = t.sequence_no || t.seq_no || t.queue_no || (idx + 1);
        const wt = Number(t.final_weight || t.net_weight || 0);
        const netRate = Number(t.price_per_kg || 0);
        const yardFeeRate = (t.yard_fee !== undefined && t.yard_fee !== null && !isNaN(Number(t.yard_fee))) ? Number(t.yard_fee) : 0.50;
        const auctionRate = (t.auction_price !== undefined && t.auction_price !== null && !isNaN(Number(t.auction_price)) && Number(t.auction_price) > 0) ? Number(t.auction_price) : (netRate + yardFeeRate);
        const grossAmt = Math.round((wt * auctionRate) * 100) / 100;
        const netAmt = Math.round(Number(t.total_price !== undefined && t.total_price !== null ? t.total_price : (wt * netRate)) * 100) / 100;
        const feeAmt = Math.round((grossAmt - netAmt) * 100) / 100;
        const rowClass = idx % 2 === 1 ? 'class="even-row"' : '';

        return `
          <tr ${rowClass}>
            <td class="text-center" style="font-weight:bold;">${seq}</td>
            <td class="member-code">${t.member_code}</td>
            <td class="text-left"><b>${t.member_name}</b></td>
            <td class="num-format">${wt.toFixed(2)}</td>
            <td class="num-format">${auctionRate.toFixed(2)}</td>
            <td class="num-format" style="font-weight:600; color:#1e293b;">${grossAmt.toFixed(2)}</td>
            <td class="num-format" style="font-weight:600; color:#b45309;">${feeAmt.toFixed(2)}</td>
            <td class="num-format">${netRate.toFixed(2)}</td>
            <td class="num-format" style="font-weight:bold; color:#047857;">${netAmt.toFixed(2)}</td>
          </tr>
        `;
      }).join('');
    } else {
      sheetName = 'สรุปรายสมาชิก';
      filePrefix = 'สรุปผลส่งมอบยาง_รายสมาชิก';
      tableHeaderHtml = `
        <tr>
          <th style="width: 55px;">ลำดับ</th>
          <th style="width: 100px;">รหัสสมาชิก</th>
          <th style="width: 240px;">ชื่อ-นามสกุลสมาชิก</th>
          <th style="width: 180px;">เลขที่บัญชีธนาคาร</th>
          <th style="width: 140px;">น้ำหนักยางสุทธิ (กก.)</th>
          <th style="width: 130px;">ราคาประมูล (บาท)</th>
          <th style="width: 170px;">ยอดรวมก่อนหัก (บาท)</th>
          <th style="width: 170px;">หักค่าจัดการเข้ากลุ่ม (บาท)</th>
          <th style="width: 130px;">ราคาโอน/กก. (บาท)</th>
          <th style="width: 200px;">จำนวนเงินที่ต้องโอน (บาท)</th>
        </tr>
      `;
      tableRowsHtml = memberRows.map((m, idx) => {
        const rowClass = idx % 2 === 1 ? 'class="even-row"' : '';
        return `
          <tr ${rowClass}>
            <td class="text-center">${idx + 1}</td>
            <td class="member-code">${m.code}</td>
            <td class="text-left"><b>${m.name}</b></td>
            <td class="bank-acc">${m.account_no}</td>
            <td class="num-format">${m.totalWeight.toFixed(2)}</td>
            <td class="num-format">${m.auctionPrice.toFixed(2)}</td>
            <td class="num-format" style="font-weight:600; color:#1e293b;">${m.grossAmount.toFixed(2)}</td>
            <td class="num-format" style="font-weight:600; color:#b45309;">${m.yardFeeAmount.toFixed(2)}</td>
            <td class="num-format">${m.netPrice.toFixed(2)}</td>
            <td class="num-format" style="font-weight:bold; color:#047857;">${m.totalAmount.toFixed(2)}</td>
          </tr>
        `;
      }).join('');
    }

    const docTitle = currentReportView === 'queue' ? 'เอกสารสรุปผลการส่งมอบยางพาราประจำรอบ (เรียงตามลำดับคิวชั่ง)' : 'เอกสารสรุปผลการส่งมอบยางพาราประจำรอบ (สรุปยอดรายสมาชิก)';

    const excelHtml = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <!--[if gte mso 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>${sheetName}</x:Name>
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
          tr.total-row td { background-color: #d1fae5; font-weight: bold; font-size: 13px; border-top: 2px solid #047857; border-bottom: 2px double #047857; height: 35px; }
        </style>
      </head>
      <body>
        <table>
          <tr><td colspan="10" class="title-header">${plantationName}</td></tr>
          <tr><td colspan="10" class="subtitle-header">${plantationAddress}</td></tr>
          <tr><td colspan="10" class="doc-title">${docTitle}</td></tr>
          <tr>
            <td colspan="10" class="meta-info">
              <b>รอบส่งมอบยาง:</b> ${round.title} &nbsp;&nbsp;|&nbsp;&nbsp; 
              <b>วันที่:</b> ${formatDate(round.start_date)} &nbsp;&nbsp;|&nbsp;&nbsp;
              <b>จำนวนรายการ:</b> ${sortedTxs.length} คิว (${memberRows.length} คน)
            </td>
          </tr>
          <tr><td colspan="${currentReportView === 'queue' ? 9 : 10}"></td></tr>
          <thead>
            ${tableHeaderHtml}
          </thead>
          <tbody>
            ${tableRowsHtml}
            <tr class="total-row">
              <td colspan="${currentReportView === 'queue' ? 3 : 4}" class="text-right"><b>ยอดรวมสุทธิทั้งรอบ:</b></td>
              <td class="num-format" style="font-weight:bold;">${grandTotalWeight.toFixed(2)}</td>
              <td></td>
              <td class="num-format" style="font-weight:bold; color:#1e293b;">${grandTotalGross.toFixed(2)}</td>
              <td class="num-format" style="font-weight:bold; color:#b45309;">${grandTotalYardFee.toFixed(2)}</td>
              <td></td>
              <td class="num-format" style="font-weight:bold; color:#047857;">${grandTotalAmount.toFixed(2)}</td>
            </tr>
            <tr><td colspan="${currentReportView === 'queue' ? 9 : 10}"></td></tr>
            <tr>
              <td colspan="${currentReportView === 'queue' ? 3 : 4}" style="background:#f1f5f9; border:1px solid #94a3b8; padding:8px 12px; font-size:13px;"><b>สรุปภาพรวมการเงินประจำรอบ:</b></td>
              <td colspan="6" style="background:#f8fafc; border:1px solid #94a3b8;"></td>
            </tr>
            <tr>
              <td colspan="${currentReportView === 'queue' ? 3 : 4}" style="border:1px solid #cbd5e1; padding:6px 12px;">⚖️ น้ำหนักยางส่งมอบรวมทั้งรอบ:</td>
              <td colspan="6" class="num-format" style="border:1px solid #cbd5e1; font-weight:bold; color:#0f172a;">${grandTotalWeight.toFixed(2)} กิโลกรัม</td>
            </tr>
            <tr>
              <td colspan="${currentReportView === 'queue' ? 3 : 4}" style="border:1px solid #cbd5e1; padding:6px 12px;">💰 ยอดเงินรวมก่อนหักค่าจัดการ (ยอดขายยางรวม):</td>
              <td colspan="6" class="num-format" style="border:1px solid #cbd5e1; font-weight:bold; color:#1e293b;">${grandTotalGross.toFixed(2)} บาท</td>
            </tr>
            <tr>
              <td colspan="${currentReportView === 'queue' ? 3 : 4}" style="border:1px solid #cbd5e1; padding:6px 12px; background:#fef3c7;">🏢 <b>เงินค่าจัดการคงเหลือเข้ากลุ่ม (รายได้กลุ่มเกษตรกร):</b></td>
              <td colspan="6" class="num-format" style="border:1px solid #cbd5e1; font-weight:bold; color:#b45309; background:#fef3c7;">${grandTotalYardFee.toFixed(2)} บาท</td>
            </tr>
            <tr>
              <td colspan="${currentReportView === 'queue' ? 3 : 4}" style="border:1px solid #cbd5e1; padding:6px 12px; background:#d1fae5;">💳 <b>ยอดเงินสุทธิจ่ายสมาชิกทุกคน:</b></td>
              <td colspan="6" class="num-format" style="border:1px solid #cbd5e1; font-weight:bold; color:#047857; background:#d1fae5;">${grandTotalAmount.toFixed(2)} บาท</td>
            </tr>
          </tbody>
        </table>
      </body>
      </html>
    `;

    const cleanTitle = round.title.replace(/[\/\s]/g, '_');
    const fileName = `${filePrefix}_${cleanTitle}.xls`;

    const blob = new Blob(['\ufeff' + excelHtml], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('ดาวน์โหลดไฟล์ Excel สำเร็จ!');
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
      if (isDesktopApp()) {
        const r = await window.desktopDB.query('SELECT * FROM purchase_rounds WHERE id = ? OR supabase_id = ?', [roundId, String(roundId)]);
        if (r && r.length > 0) round = r[0];
        transactions = await window.desktopDB.query('SELECT * FROM transactions WHERE round_id = ? OR round_id = ? OR round_id = (SELECT id FROM purchase_rounds WHERE supabase_id = ?) ORDER BY sequence_no ASC, id ASC', [roundId, String(round?.supabase_id || roundId), String(roundId)]) || [];
      } else if (sb && !isAppOffline()) {
        const { data: rData } = await sb.from('purchase_rounds').select('*').eq('id', roundId).single();
        const { data: tData } = await sb.from('transactions').select('*').eq('round_id', roundId).order('created_at', { ascending: true }).limit(2000);
        round = rData;
        transactions = tData || [];
      }
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

  // Sort by sequence_no ASC, falling back to creation time
  const sortedTxs = [...transactions].sort((a, b) => {
    const seqA = (a.sequence_no !== undefined && a.sequence_no !== null && !isNaN(Number(a.sequence_no)) && Number(a.sequence_no) > 0) ? Number(a.sequence_no) : null;
    const seqB = (b.sequence_no !== undefined && b.sequence_no !== null && !isNaN(Number(b.sequence_no)) && Number(b.sequence_no) > 0) ? Number(b.sequence_no) : null;
    if (seqA !== null && seqB !== null) return seqA - seqB;
    if (seqA !== null) return -1;
    if (seqB !== null) return 1;
    const timeA = new Date(a.date || a.created_at || 0).getTime();
    const timeB = new Date(b.date || b.created_at || 0).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  const memberSummary = {};
  let grandTotalWeight = 0;
  let grandTotalGross = 0;
  let grandTotalYardFee = 0;
  let grandTotalAmount = 0;

  sortedTxs.forEach(t => {
    const code = t.member_code;
    const weight = Number(t.final_weight || t.net_weight || 0);
    const netRate = Number(t.price_per_kg || 0);
    const yardFeeRate = (t.yard_fee !== undefined && t.yard_fee !== null && !isNaN(Number(t.yard_fee))) ? Number(t.yard_fee) : 0.50;
    const auctionRate = (t.auction_price !== undefined && t.auction_price !== null && !isNaN(Number(t.auction_price)) && Number(t.auction_price) > 0) ? Number(t.auction_price) : (netRate + yardFeeRate);
    const grossAmt = Math.round((weight * auctionRate) * 100) / 100;
    const amount = Math.round(Number(t.total_price !== undefined && t.total_price !== null ? t.total_price : (weight * netRate)) * 100) / 100;
    const feeAmt = Math.round((grossAmt - amount) * 100) / 100;

    if (!memberSummary[code]) {
      memberSummary[code] = {
        code: code,
        name: t.member_name,
        account_no: t.member_account_no || '-',
        txCount: 0,
        totalWeight: 0,
        grossAmount: 0,
        yardFeeAmount: 0,
        totalAmount: 0,
        auctionPrice: auctionRate,
        yardFeeRate: yardFeeRate,
        netPrice: netRate
      };
    }
    memberSummary[code].txCount += 1;
    memberSummary[code].totalWeight += weight;
    memberSummary[code].grossAmount += grossAmt;
    memberSummary[code].yardFeeAmount += feeAmt;
    memberSummary[code].totalAmount += amount;

    grandTotalWeight += weight;
    grandTotalGross += grossAmt;
    grandTotalYardFee += feeAmt;
    grandTotalAmount += amount;
  });

  grandTotalWeight = Math.round(grandTotalWeight * 100) / 100;
  grandTotalGross = Math.round(grandTotalGross * 100) / 100;
  grandTotalYardFee = Math.round(grandTotalYardFee * 100) / 100;
  grandTotalAmount = Math.round(grandTotalAmount * 100) / 100;

  Object.values(memberSummary).forEach(m => {
    if (m.totalWeight > 0) {
      m.auctionPrice = m.grossAmount / m.totalWeight;
      m.yardFeeRate = m.yardFeeAmount / m.totalWeight;
      m.netPrice = m.totalAmount / m.totalWeight;
    }
  });

  const memberRows = Object.values(memberSummary).sort((a, b) => a.code.localeCompare(b.code));

  // Resolve President name for dynamic signature
  let presidentName = '';
  try {
    if (sb) {
      const { data: presUser } = await sb.from('app_users').select('display_name').eq('position', 'ประธานกรรมการ').limit(1);
      if (presUser && presUser.length > 0) presidentName = presUser[0].display_name;
    }
  } catch (e) { /* ignore */ }

  let printTableHtml = '';
  const printDocTitle = currentReportView === 'queue'
    ? 'เอกสารสรุปผลการส่งมอบยางพาราประจำรอบ (เรียงตามลำดับคิวชั่ง)'
    : 'เอกสารสรุปผลการส่งมอบยางพาราประจำรอบ (สรุปยอดรายสมาชิก)';

  if (currentReportView === 'queue') {
    printTableHtml = `
      <table>
        <thead>
          <tr>
            <th style="width:40px;">คิวที่</th>
            <th style="width:55px;">รหัส</th>
            <th>ชื่อ-นามสกุลสมาชิก</th>
            <th style="width:90px; text-align:right;">น้ำหนัก (กก.)</th>
            <th style="width:80px; text-align:right;">ราคาประมูล</th>
            <th style="width:105px; text-align:right;">ยอดรวมก่อนหัก</th>
            <th style="width:95px; text-align:right;">หักเข้ากลุ่ม</th>
            <th style="width:80px; text-align:right;">ราคาจ่าย/กก.</th>
            <th style="width:110px; text-align:right;">ยอดสุทธิ (บาท)</th>
          </tr>
        </thead>
        <tbody>
          ${sortedTxs.length === 0 ? '<tr><td colspan="9" style="text-align:center; padding:15px; color:#64748b;">ไม่มีข้อมูลธุรกรรมในรอบนี้</td></tr>' :
            sortedTxs.map((t, idx) => {
              const seq = t.sequence_no || t.seq_no || t.queue_no || (idx + 1);
              const wt = Number(t.final_weight || t.net_weight || 0);
              const netRate = Number(t.price_per_kg || 0);
              const yardFeeRate = (t.yard_fee !== undefined && t.yard_fee !== null && !isNaN(Number(t.yard_fee))) ? Number(t.yard_fee) : 0.50;
              const auctionRate = (t.auction_price !== undefined && t.auction_price !== null && !isNaN(Number(t.auction_price)) && Number(t.auction_price) > 0) ? Number(t.auction_price) : (netRate + yardFeeRate);
              const grossAmt = Math.round((wt * auctionRate) * 100) / 100;
              const netAmt = Math.round(Number(t.total_price !== undefined && t.total_price !== null ? t.total_price : (wt * netRate)) * 100) / 100;
              const feeAmt = Math.round((grossAmt - netAmt) * 100) / 100;

              return `
                <tr>
                  <td style="text-align:center; font-weight:bold;">${seq}</td>
                  <td style="text-align:center;"><span class="code-badge">${escapeHTML(t.member_code)}</span></td>
                  <td><strong>${escapeHTML(t.member_name)}</strong></td>
                  <td style="text-align:right; font-weight:600;">${formatNumber(wt)}</td>
                  <td style="text-align:right;">${formatNumber(auctionRate)}</td>
                  <td style="text-align:right; font-weight:600;">${formatNumber(grossAmt)}</td>
                  <td style="text-align:right; color:#b45309; font-weight:600;">${formatNumber(feeAmt)}</td>
                  <td style="text-align:right;">${formatNumber(netRate)}</td>
                  <td style="text-align:right; font-weight:bold; color:#047857;">${formatNumber(netAmt)}</td>
                </tr>
              `;
            }).join('')
          }
          <tr class="total-row">
            <td colspan="3" style="text-align:right;">ยอดรวมสุทธิทั้งรอบ:</td>
            <td style="text-align:right;">${formatNumber(grandTotalWeight)} กก.</td>
            <td></td>
            <td style="text-align:right; font-weight:bold;">${formatNumber(grandTotalGross)}</td>
            <td style="text-align:right; color:#b45309; font-weight:bold;">${formatNumber(grandTotalYardFee)}</td>
            <td></td>
            <td style="text-align:right; color:#047857; font-size:13px; font-weight:bold;">${formatNumber(grandTotalAmount)} บาท</td>
          </tr>
        </tbody>
      </table>
    `;
  } else {
    printTableHtml = `
      <table>
        <thead>
          <tr>
            <th style="width:40px;">ลำดับ</th>
            <th style="width:65px;">รหัสสมาชิก</th>
            <th>ชื่อ-นามสกุลสมาชิก</th>
            <th style="width:140px;">เลขที่บัญชีธนาคาร</th>
            <th style="width:100px; text-align:right;">น้ำหนัก (กก.)</th>
            <th style="width:85px; text-align:right;">ราคาประมูล</th>
            <th style="width:110px; text-align:right;">ยอดรวมก่อนหัก</th>
            <th style="width:105px; text-align:right;">หักเข้ากลุ่ม</th>
            <th style="width:85px; text-align:right;">ราคาโอน/กก.</th>
            <th style="width:120px; text-align:right;">ยอดสุทธิ (บาท)</th>
          </tr>
        </thead>
        <tbody>
          ${memberRows.length === 0 ? '<tr><td colspan="10" style="text-align:center; padding:15px; color:#64748b;">ไม่มีข้อมูลสมาชิกในรอบนี้</td></tr>' :
            memberRows.map((m, idx) => `
              <tr>
                <td style="text-align:center;">${idx + 1}</td>
                <td style="text-align:center;"><span class="code-badge">${m.code}</span></td>
                <td><strong>${m.name}</strong></td>
                <td style="text-align:center; font-family:monospace; font-weight:bold; color:#1e293b;">${m.account_no}</td>
                <td style="text-align:right; font-weight:600;">${formatNumber(m.totalWeight)}</td>
                <td style="text-align:right;">${formatNumber(m.auctionPrice)}</td>
                <td style="text-align:right; font-weight:600;">${formatNumber(m.grossAmount)}</td>
                <td style="text-align:right; color:#b45309; font-weight:600;">${formatNumber(m.yardFeeAmount)}</td>
                <td style="text-align:right;">${formatNumber(m.netPrice)}</td>
                <td style="text-align:right; font-weight:bold; color:#047857;">${formatNumber(m.totalAmount)}</td>
              </tr>
            `).join('')
          }
          <tr class="total-row">
            <td colspan="4" style="text-align:right;">ยอดรวมสุทธิทั้งรอบ:</td>
            <td style="text-align:right;">${formatNumber(grandTotalWeight)} กก.</td>
            <td></td>
            <td style="text-align:right; font-weight:bold;">${formatNumber(grandTotalGross)}</td>
            <td style="text-align:right; color:#b45309; font-weight:bold;">${formatNumber(grandTotalYardFee)}</td>
            <td></td>
            <td style="text-align:right; color:#047857; font-size:13px; font-weight:bold;">${formatNumber(grandTotalAmount)} บาท</td>
          </tr>
        </tbody>
      </table>
    `;
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>${printDocTitle} - ${round.title}</title>
      <style>
        @page { size: A4 landscape; margin: 8mm 10mm; }
        * { box-sizing: border-box; }
        body {
          font-family: 'Sarabun', 'TH Sarabun New', sans-serif;
          font-size: 11px;
          color: #0f172a;
          margin: 0;
          padding: 0;
          background: #fff;
        }
        .header { text-align: center; margin-bottom: 10px; border-bottom: 2px solid #0f172a; padding-bottom: 6px; }
        .header h2 { margin: 0 0 3px 0; font-size: 17px; font-weight: bold; color: #064e3b; }
        .header p { margin: 0 0 3px 0; font-size: 11px; color: #475569; }
        .header h3 { margin: 4px 0 0 0; font-size: 13px; font-weight: bold; color: #0f172a; }

        .meta-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
          margin-bottom: 10px;
          border: 1px solid #cbd5e1;
          padding: 6px 10px;
          border-radius: 6px;
          background: #f8fafc;
          font-size: 11px;
        }
        .meta-item strong { display: block; font-size: 10px; color: #64748b; margin-bottom: 1px; }
        .meta-item span { font-size: 12px; font-weight: bold; color: #0f172a; }

        table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 10.5px; }
        th, td { border: 1px solid #cbd5e1; padding: 4px 6px; }
        th { background-color: #f1f5f9; text-align: center; font-weight: bold; color: #1e293b; }
        tr:nth-child(even) td { background-color: #f8fafc; }
        tr.total-row td { font-weight: bold; background-color: #ecfdf5; font-size: 11px; border-top: 2px solid #047857; border-bottom: 2px double #047857; }

        .code-badge {
          display: inline-block;
          background: #e2e8f0;
          color: #0f172a;
          padding: 1px 5px;
          border-radius: 4px;
          font-family: monospace;
          font-weight: bold;
        }
        .badge {
          display: inline-block;
          padding: 1px 5px;
          border-radius: 4px;
          font-size: 9.5px;
          font-weight: 600;
          background: #e0f2fe;
          color: #0369a1;
        }

        .signatures {
          margin-top: 20px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 40px;
          text-align: center;
          page-break-inside: avoid;
        }
        .sig-box { border: 1px solid #cbd5e1; padding: 8px; border-radius: 6px; background: #fff; }
        .sig-line { margin-top: 25px; border-bottom: 1px dotted #0f172a; display: inline-block; width: 75%; }
        .sig-name { margin-top: 5px; font-size: 10.5px; color: #334155; }
        .sig-role { font-size: 11px; font-weight: bold; color: #0f172a; margin-bottom: 2px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>${plantationName}</h2>
        <p>${plantationAddress}</p>
        <h3>${printDocTitle}</h3>
        <p style="margin-top:3px;"><strong>รอบส่งมอบยาง:</strong> ${round.title} &nbsp;|&nbsp; <strong>วันที่:</strong> ${formatDate(round.start_date)}</p>
      </div>

      <div class="meta-grid">
        <div class="meta-item"><strong>จำนวนรายการ:</strong> <span>${sortedTxs.length} คิว (${memberRows.length} คน)</span></div>
        <div class="meta-item"><strong>น้ำหนักสุทธิรวม:</strong> <span style="color:#0f172a;">${formatNumber(grandTotalWeight)} กก.</span></div>
        <div class="meta-item"><strong>เงินคงเหลือเข้ากลุ่ม (ค่าลาน):</strong> <span style="color:#b45309;">${formatNumber(grandTotalYardFee)} บาท</span></div>
        <div class="meta-item"><strong>ยอดเงินสุทธิจ่ายสมาชิก:</strong> <span style="color:#047857;">${formatNumber(grandTotalAmount)} บาท</span></div>
      </div>

      ${printTableHtml}

      <div class="signatures">
        <div class="sig-box">
          <div class="sig-role">ผู้สรุปรอบส่งมอบยาง</div>
          <div class="sig-line"></div>
          <div class="sig-name">(${round.closed_by_name || currentUser?.display_name || 'ผู้สรุปรอบ'})</div>
        </div>
        <div class="sig-box">
          <div class="sig-role">ประธาน / ผู้ตรวจสอบ</div>
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
    if (isDesktopApp()) {
      const r = await window.desktopDB.query('SELECT * FROM purchase_rounds WHERE id = ? OR supabase_id = ?', [roundId, String(roundId)]);
      const roundObj = r && r.length > 0 ? r[0] : null;
      const targetLocalId = roundObj ? roundObj.id : roundId;
      const targetCloudId = roundObj ? roundObj.supabase_id : roundId;

      await window.desktopDB.run(
        'DELETE FROM transactions WHERE round_id = ? OR round_id = ? OR round_id = ?',
        [String(targetLocalId), String(targetCloudId || ''), String(roundId)]
      );
      await window.desktopDB.run(
        'DELETE FROM truck_deliveries WHERE round_id = ? OR round_id = ? OR round_id = ?',
        [String(targetLocalId), String(targetCloudId || ''), String(roundId)]
      );
      await window.desktopDB.run(
        'DELETE FROM purchase_rounds WHERE id = ? OR supabase_id = ? OR id = ?',
        [targetLocalId, String(targetCloudId || ''), roundId]
      );
      await window.desktopDB.run(
        'DELETE FROM sync_queue WHERE (table_name = "transactions" OR table_name = "purchase_rounds" OR table_name = "truck_deliveries") AND (local_id = ? OR local_id = ? OR row_data LIKE ? OR row_data LIKE ?)',
        [targetLocalId, roundId, `%${targetLocalId}%`, `%${targetCloudId || roundId}%`]
      );

      if (sb && !isAppOffline() && targetCloudId) {
        try {
          await sb.from('transactions').delete().eq('round_id', targetCloudId);
          await sb.from('truck_deliveries').delete().eq('round_id', targetCloudId);
          await sb.from('purchase_rounds').delete().eq('id', targetCloudId);
        } catch (e) {}
      }
    } else if (sb && !isAppOffline()) {
      await sb.from('transactions').delete().eq('round_id', roundId);
      await sb.from('truck_deliveries').delete().eq('round_id', roundId);
      const { data, error } = await sb.from('purchase_rounds').delete().eq('id', roundId).select();
      if (error) throw error;
    }

    closeConfirmModal();
    showToast('ลบรอบส่งมอบยางและรายการทั้งหมดในรอบเรียบร้อยแล้ว!');

    if (currentRound && String(currentRound.id) === String(roundId)) {
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



async function saveOfflineRound(roundData, actionType) {
  if (isDesktopApp()) {
    if (actionType === 'round_create') {
      const inserted = await window.desktopDB.insert('purchase_rounds', {
        ...roundData,
        status: 'open'
      });
      await window.desktopDB.insert('sync_queue', {
        table_name: 'purchase_rounds',
        action: 'INSERT',
        row_data: JSON.stringify(roundData),
        local_id: inserted.id
      });
      roundData.id = inserted.id;
    } else if (actionType === 'round_close') {
      await window.desktopDB.update('purchase_rounds', {
        status: 'closed',
        closed_at: roundData.closed_at || new Date().toISOString(),
        closed_by_name: roundData.closed_by_name || ''
      }, { id: roundData.id });

      await window.desktopDB.insert('sync_queue', {
        table_name: 'purchase_rounds',
        action: 'UPDATE',
        row_data: JSON.stringify(roundData),
        local_id: roundData.id
      });
    }
    return roundData;
  }
  return roundData;
}

  // Export functions to window
  window.loadCurrentRound = loadCurrentRound;
  window.updateRoundBanner = updateRoundBanner;
  window.openStartRoundModal = openStartRoundModal;
  window.closeStartRoundModal = closeStartRoundModal;
  window.saveStartNewRound = saveStartNewRound;
  window.confirmCloseRound = confirmCloseRound;
  window.closeRound = closeRound;
  window.renderRounds = renderRounds;
  window.showRoundReport = showRoundReport;
  window.switchRoundReportView = switchRoundReportView;
  window.onRoundReportFormatChange = onRoundReportFormatChange;
  window.renderRoundReportContent = renderRoundReportContent;
  window.closeRoundReportModal = closeRoundReportModal;
  window.exportRoundToExcel = exportRoundToExcel;
  window.printRoundReport = printRoundReport;
  window.confirmDeleteRound = confirmDeleteRound;
  window.deleteRound = deleteRound;
  window.saveOfflineRound = saveOfflineRound;

})(window);
