/**
 * js/dashboard.js - Rubber Plantation Dashboard, Overview & Leaderboard
 * กลุ่มเกษตรกรทำสวนยางพาราท่าสะแก
 * Version: 2.0 (Phase 3 Part 1 Refactoring)
 */

(function (window) {
  'use strict';

  // Global State Reference
  window.currentDashboardView = window.currentDashboardView || 'leaderboard';

// ========== DASHBOARD ==========
async function renderDashboard(showSpinner = true, newTransaction = null) {
  if (showSpinner) showLoading();
  try {
    await loadCurrentRound();

    let allTx = [];
    let recentTx = [];
    let memberCount = 0;
    let totalRoundsCount = 0;

    if (isDesktopApp()) {
      allTx = await window.desktopDB.query(
        'SELECT * FROM transactions ORDER BY date DESC, id DESC'
      ) || [];
      recentTx = allTx.slice(0, 10);
      memberCount = await window.desktopDB.count('members') || 0;
      const rounds = await window.desktopDB.query('SELECT id FROM purchase_rounds') || [];
      totalRoundsCount = rounds.length;
    } else {
      if (sb && !isAppOffline()) {
        const { data: txList } = await sb.from('transactions')
          .select('*')
          .order('date', { ascending: false });
        allTx = txList || [];
        recentTx = allTx.slice(0, 10);

        const { count: mCount } = await sb.from('members')
          .select('*', { count: 'exact', head: true });
        memberCount = mCount || 0;

        const { count: rCount } = await sb.from('purchase_rounds')
          .select('*', { count: 'exact', head: true });
        totalRoundsCount = rCount || 0;
      }
    }

    const totalTxCount = allTx.length;
    const totalWeight = allTx.reduce((s, t) => s + Number(t.final_weight || t.net_weight || 0), 0);

    // ยอดเงินรวมทุกรอบ: ราคายางจากพ่อค้า ก่อนหักค่าจัดการ (final_weight * auction_price)
    const totalGrossMerchantAmount = allTx.reduce((s, t) => {
      const wt = Number(t.final_weight || t.net_weight || 0);
      const auctionPrice = Number(t.auction_price || 0);
      const yardFee = (t.yard_fee !== undefined && t.yard_fee !== null && !isNaN(Number(t.yard_fee))) ? Number(t.yard_fee) : (cachedSettings?.yard_fee || 0.5);
      const pricePerKg = Number(t.price_per_kg || 0);
      const merchantPrice = auctionPrice > 0 ? auctionPrice : (pricePerKg + yardFee);
      return s + Math.round((wt * merchantPrice) * 100) / 100;
    }, 0);

    // ยอดจ่ายสมาชิกรวมทุกรอบ: ราคาขายทั้งหมดให้สมาชิก (หักค่าจัดการแล้ว)
    const totalNetMemberAmount = allTx.reduce((s, t) => {
      const price = Number(t.total_price !== undefined && t.total_price !== null ? t.total_price : 0);
      return s + price;
    }, 0);

    document.getElementById('stat-round-count').innerHTML = `${totalTxCount} <span class="unit">รายการ</span>`;
    document.getElementById('stat-round-weight').innerHTML = `${formatNumber(totalWeight)} <span class="unit">กก.</span>`;
    document.getElementById('stat-round-amount').innerHTML = `${formatNumber(totalGrossMerchantAmount)} <span class="unit">บาท</span>`;
    document.getElementById('stat-month-amount').innerHTML = `${formatNumber(totalNetMemberAmount)} <span class="unit">บาท</span>`;
    document.getElementById('stat-total-members').innerHTML = `${memberCount || 0} <span class="unit">คน</span>`;

    // Update subtitle under แดชบอร์ด
    const subtitleEl = document.getElementById('dashboard-subtitle');
    if (subtitleEl) {
      if (currentRound && currentRound.status === 'open') {
        subtitleEl.innerHTML = `<span style="color:#0284c7; font-weight:600;">🌐 สรุปภาพรวมสะสมทุกรอบการรับซื้อ (ทั้งหมด ${totalRoundsCount} รอบ)</span> &nbsp;•&nbsp; <span style="color:#22c55e; font-weight:600;">🟢 กำลังเปิดรอบ: ${escapeHTML(currentRound.title)}</span>`;
      } else {
        subtitleEl.innerHTML = `<span style="color:#0284c7; font-weight:600;">🌐 สรุปภาพรวมสะสมทุกรอบการรับซื้อ (ทั้งหมด ${totalRoundsCount} รอบ)</span>`;
      }
    }

    // Populate scope filter and render Leaderboard
    try {
      await populateDashboardScopeFilter();
      await renderDashboardLeaderboard();
    } catch (lbErr) {
      console.warn('Leaderboard render error:', lbErr);
    }

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

// ========== DASHBOARD LEADERBOARD & TABS ==========
let currentDashboardView = 'leaderboard';

function switchDashboardView(viewName) {
  currentDashboardView = viewName;
  const tabLeaderboard = document.getElementById('dashboard-tab-leaderboard');
  const tabRecent = document.getElementById('dashboard-tab-recent');
  const viewLeaderboard = document.getElementById('dashboard-view-leaderboard');
  const viewRecent = document.getElementById('dashboard-view-recent');

  if (viewName === 'leaderboard') {
    if (tabLeaderboard) {
      tabLeaderboard.className = 'btn btn-primary btn-sm';
      tabLeaderboard.style.fontWeight = '700';
    }
    if (tabRecent) {
      tabRecent.className = 'btn btn-secondary btn-sm';
      tabRecent.style.fontWeight = 'normal';
    }
    if (viewLeaderboard) viewLeaderboard.style.display = 'block';
    if (viewRecent) viewRecent.style.display = 'none';
  } else {
    if (tabLeaderboard) {
      tabLeaderboard.className = 'btn btn-secondary btn-sm';
      tabLeaderboard.style.fontWeight = 'normal';
    }
    if (tabRecent) {
      tabRecent.className = 'btn btn-primary btn-sm';
      tabRecent.style.fontWeight = '700';
    }
    if (viewLeaderboard) viewLeaderboard.style.display = 'none';
    if (viewRecent) viewRecent.style.display = 'block';
  }
}

async function populateDashboardScopeFilter() {
  const selectEl = document.getElementById('dashboard-scope-filter');
  if (!selectEl) return;

  const currentVal = selectEl.value || 'current';

  let rounds = [];
  try {
    if (isDesktopApp()) {
      rounds = await window.desktopDB.query('SELECT id, title, start_date, closed_at, status FROM purchase_rounds ORDER BY id DESC LIMIT 20') || [];
    } else if (sb && !isAppOffline()) {
      const { data } = await sb.from('purchase_rounds').select('id, title, start_date, closed_at, status').order('id', { ascending: false }).limit(20);
      rounds = data || [];
    }
  } catch (e) {
    console.warn('Load rounds for dashboard filter error:', e);
  }

  let html = `
    <option value="current">⚡ รอบส่งมอบปัจจุบัน</option>
    <option value="season">🏆 รวมตลอดทั้งปี / ปิดหน้ายาง</option>
  `;

  if (rounds && rounds.length > 0) {
    html += '<optgroup label="📜 เลือกรอบส่งมอบยางย้อนหลัง">';
    rounds.forEach(r => {
      const statusText = r.status === 'open' ? '🟢 เปิดอยู่' : '🔒 ปิดแล้ว';
      const title = r.title || `รอบที่ ${r.id}`;
      html += `<option value="round_${r.id}">${title} (${statusText})</option>`;
    });
    html += '</optgroup>';
  }

  selectEl.innerHTML = html;
  if (Array.from(selectEl.options).some(o => o.value === currentVal)) {
    selectEl.value = currentVal;
  } else {
    selectEl.value = 'current';
  }
}

async function renderDashboardLeaderboard() {
  const selectEl = document.getElementById('dashboard-scope-filter');
  const scope = selectEl ? selectEl.value : 'current';

  const podiumEl = document.getElementById('dashboard-podium');
  const tbodyEl = document.getElementById('dashboard-leaderboard-body');
  const emptyEl = document.getElementById('dashboard-leaderboard-empty');
  const tableContainer = tbodyEl ? tbodyEl.closest('.table-container') : null;

  try {
    let txs = [];
    const today = new Date();
    const startOfYear = new Date(today.getFullYear(), 0, 1).toISOString();

    if (isDesktopApp()) {
      if (scope === 'current') {
        let targetRound = currentRound;
        if (!targetRound) {
          const rounds = await window.desktopDB.query('SELECT * FROM purchase_rounds ORDER BY id DESC LIMIT 10');
          for (const r of (rounds || [])) {
            const check = await window.desktopDB.query('SELECT id FROM transactions WHERE round_id = ? OR round_id = ? LIMIT 1', [r.id, r.supabase_id || '']);
            if (check && check.length > 0) { targetRound = r; break; }
          }
          if (!targetRound && rounds && rounds.length > 0) targetRound = rounds[0];
        }

        if (targetRound) {
          txs = await window.desktopDB.query('SELECT * FROM transactions WHERE round_id = ? OR round_id = ?', [targetRound.id, targetRound.supabase_id || '']) || [];
        } else {
          txs = await window.desktopDB.query('SELECT * FROM transactions ORDER BY id DESC LIMIT 50') || [];
        }
      } else if (scope === 'season') {
        txs = await window.desktopDB.query('SELECT * FROM transactions WHERE date >= ?', [startOfYear]) || [];
        if (txs.length === 0) {
          txs = await window.desktopDB.select('transactions', ['*']) || [];
        }
      } else if (scope.startsWith('round_')) {
        const targetRoundId = scope.replace('round_', '');
        txs = await window.desktopDB.query(
          'SELECT * FROM transactions WHERE round_id = ? OR round_id = (SELECT supabase_id FROM purchase_rounds WHERE id = ?) OR round_id = (SELECT id FROM purchase_rounds WHERE supabase_id = ?)',
          [targetRoundId, targetRoundId, targetRoundId]
        ) || [];
      }
    } else if (sb && !isAppOffline()) {
      if (scope === 'current') {
        let targetRound = currentRound;
        if (!targetRound) {
          const { data: rounds } = await sb.from('purchase_rounds').select('*').order('created_at', { ascending: false }).limit(10);
          for (const r of (rounds || [])) {
            const { data: check } = await sb.from('transactions').select('id').or(`round_id.eq.${r.id},round_id.eq.${r.supabase_id || r.id}`).limit(1);
            if (check && check.length > 0) { targetRound = r; break; }
          }
          if (!targetRound && rounds && rounds.length > 0) targetRound = rounds[0];
        }

        if (targetRound) {
          const tId = targetRound.supabase_id || targetRound.id;
          const { data } = await sb.from('transactions').select('*').or(`round_id.eq.${tId},round_id.eq.${targetRound.id}`);
          txs = data || [];
        } else {
          const { data } = await sb.from('transactions').select('*').order('id', { ascending: false }).limit(50);
          txs = data || [];
        }
      } else if (scope === 'season') {
        const { data } = await sb.from('transactions').select('*').gte('date', startOfYear);
        txs = data || [];
        if (txs.length === 0) {
          const { data: allData } = await sb.from('transactions').select('*');
          txs = allData || [];
        }
      } else if (scope.startsWith('round_')) {
        const targetRoundId = scope.replace('round_', '');
        const { data: rList } = await sb.from('purchase_rounds').select('*');
        const rObj = (rList || []).find(r => String(r.id) === String(targetRoundId) || String(r.supabase_id) === String(targetRoundId));
        const sId = rObj?.supabase_id || targetRoundId;
        const { data } = await sb.from('transactions').select('*').or(`round_id.eq.${sId},round_id.eq.${targetRoundId}`);
        txs = data || [];
      }
    }

    if (!txs || txs.length === 0) {
      if (podiumEl) podiumEl.innerHTML = '';
      if (tbodyEl) tbodyEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
      if (tableContainer) tableContainer.style.display = 'none';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    if (tableContainer) tableContainer.style.display = 'block';

    // Group by member_code (or member_name)
    const memberMap = {};
    txs.forEach(t => {
      const code = t.member_code || 'NON_MEMBER';
      if (!memberMap[code]) {
        memberMap[code] = {
          code: t.member_code || '-',
          name: t.member_name || 'ไม่ระบุชื่อ',
          account_no: t.member_account_no || '',
          total_weight: 0,
          total_price: 0,
          delivery_count: 0
        };
      }
      const weight = Number(t.final_weight || t.net_weight || 0);
      const price = Number(t.total_price || 0);
      memberMap[code].total_weight += weight;
      memberMap[code].total_price += price;
      memberMap[code].delivery_count += (t.trip_count || 1);
    });

    // Sort descending by total_weight
    const ranked = Object.values(memberMap).sort((a, b) => b.total_weight - a.total_weight);

    // 1. Render Top 3 Podium Cards
    if (podiumEl) {
      const top3 = ranked.slice(0, 3);
      const podiumConfig = [
        {
          rank: 1,
          trophy: '🥇',
          title: 'อันดับ 1 (ถ้วยทอง)',
          borderColor: 'rgba(234, 179, 8, 0.6)',
          bgGradient: 'linear-gradient(135deg, rgba(234, 179, 8, 0.18) 0%, rgba(202, 138, 4, 0.06) 100%)',
          textColor: '#fbbf24'
        },
        {
          rank: 2,
          trophy: '🥈',
          title: 'อันดับ 2 (ถ้วยเงิน)',
          borderColor: 'rgba(203, 213, 225, 0.5)',
          bgGradient: 'linear-gradient(135deg, rgba(203, 213, 225, 0.14) 0%, rgba(148, 163, 184, 0.05) 100%)',
          textColor: '#e2e8f0'
        },
        {
          rank: 3,
          trophy: '🥉',
          title: 'อันดับ 3 (ถ้วยทองแดง)',
          borderColor: 'rgba(217, 119, 6, 0.5)',
          bgGradient: 'linear-gradient(135deg, rgba(217, 119, 6, 0.14) 0%, rgba(180, 83, 9, 0.05) 100%)',
          textColor: '#f59e0b'
        }
      ];

      podiumEl.innerHTML = top3.map((m, idx) => {
        const conf = podiumConfig[idx] || podiumConfig[0];
        return `
          <div style="background:${conf.bgGradient}; border:1.5px solid ${conf.borderColor}; border-radius:var(--radius-lg); padding:16px 18px; position:relative; box-shadow:0 4px 16px rgba(0,0,0,0.15); display:flex; flex-direction:column; justify-content:space-between;">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <span style="font-size:1.05rem; font-weight:800; color:${conf.textColor};">${conf.trophy} ${conf.title}</span>
                <span class="badge badge-green" style="font-size:0.85rem; padding:3px 8px;">${m.code}</span>
              </div>
              <div style="font-size:1.15rem; font-weight:700; color:var(--text-primary); margin-bottom:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${escapeHTML(m.name)}
              </div>
            </div>

            <div style="background:rgba(0,0,0,0.25); border-radius:var(--radius-md); padding:10px 14px; border:1px solid rgba(255,255,255,0.06);">
              <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
                <span style="font-size:0.8rem; color:var(--text-secondary);">น้ำหนักยางรวม:</span>
                <strong style="font-size:1.3rem; font-weight:900; color:${conf.textColor};">${formatNumber(m.total_weight)} <span style="font-size:0.85rem; font-weight:600;">กก.</span></strong>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.85rem; color:var(--text-secondary); border-top:1px dashed rgba(255,255,255,0.1); padding-top:4px;">
                <span>ยอดเงินรวม:</span>
                <span style="font-weight:700; color:var(--gold);">${formatNumber(m.total_price)} ฿</span>
              </div>
              <div style="font-size:0.75rem; color:var(--text-muted); text-align:right; margin-top:2px;">
                ส่งทั้งหมด ${m.delivery_count} เที่ยว
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    // 2. Render Leaderboard Table
    if (tbodyEl) {
      tbodyEl.innerHTML = ranked.map((m, idx) => {
        let rankBadge = '';
        let rowStyle = '';
        if (idx === 0) {
          rankBadge = `<span style="font-size:1.15rem;" title="อันดับ 1">🥇 1</span>`;
          rowStyle = 'background:rgba(234, 179, 8, 0.08); font-weight:600;';
        } else if (idx === 1) {
          rankBadge = `<span style="font-size:1.15rem;" title="อันดับ 2">🥈 2</span>`;
          rowStyle = 'background:rgba(203, 213, 225, 0.06); font-weight:600;';
        } else if (idx === 2) {
          rankBadge = `<span style="font-size:1.15rem;" title="อันดับ 3">🥉 3</span>`;
          rowStyle = 'background:rgba(217, 119, 6, 0.06); font-weight:600;';
        } else {
          rankBadge = `<span class="badge" style="background:rgba(255,255,255,0.06); font-size:0.9rem; padding:2px 8px;">${idx + 1}</span>`;
        }

        return `
          <tr style="${rowStyle}">
            <td style="text-align:center;">${rankBadge}</td>
            <td><span class="badge badge-green">${m.code}</span></td>
            <td style="font-size:0.95rem; font-weight:600;">${escapeHTML(m.name)}</td>
            <td style="text-align:right; font-size:1.05rem; font-weight:800; color:var(--text-accent);">${formatNumber(m.total_weight)} กก.</td>
            <td style="text-align:right; font-weight:700; color:var(--gold);">${formatNumber(m.total_price)} ฿</td>
            <td style="text-align:center; color:var(--text-secondary);">${m.delivery_count} เที่ยว</td>
          </tr>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('renderDashboardLeaderboard error:', err);
  }
}

  // Export functions to window
  window.renderDashboard = renderDashboard;
  window.switchDashboardView = switchDashboardView;
  window.populateDashboardScopeFilter = populateDashboardScopeFilter;
  window.renderDashboardLeaderboard = renderDashboardLeaderboard;

})(window);
