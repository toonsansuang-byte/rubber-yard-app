/**
 * js/members.js - Member Management, Excel Import & Sales History Layer
 * กลุ่มเกษตรกรทำสวนยางพาราท่าสะแก
 * Version: 2.0 (Phase 2 Refactoring)
 */

(function (window) {
  'use strict';

  // Shared Module State
  let memberSearchTimeout = null;
  let parsedImportData = [];

  // ========== 1. MEMBER CRUD OPERATIONS ==========

  /**
   * ดึงและแสดงผลตารางรายชื่อสมาชิกทั้งหมด (รองรับค้นหาแบบ Filter)
   */
  async function renderMembers(filter = '') {
    if (typeof window.showLoading === 'function') window.showLoading('กำลังโหลดรายชื่อสมาชิก...');
    try {
      let members = [];
      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        // ซิงค์สมาชิกจาก Cloud ลง SQLite ถ้าออนไลน์และไม่ได้ค้นหา
        if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline() && !filter) {
          try {
            const { data: cloudMembers } = await window.sb.from('members').select('*').order('code');
            if (cloudMembers && cloudMembers.length > 0) {
              for (const cm of cloudMembers) {
                const existing = await window.desktopDB.select('members', ['id'], { code: cm.code });
                if (existing && existing.length > 0) {
                  await window.desktopDB.update('members', {
                    name: cm.name,
                    phone: cm.phone || '',
                    account_no: cm.account_no || '',
                    password: cm.password || '',
                    created_at: cm.created_at || new Date().toISOString()
                  }, { code: cm.code });
                } else {
                  await window.desktopDB.insert('members', {
                    code: cm.code,
                    name: cm.name,
                    phone: cm.phone || '',
                    account_no: cm.account_no || '',
                    password: cm.password || '',
                    created_at: cm.created_at || new Date().toISOString()
                  });
                }
              }
            }
          } catch (mErr) {
            console.warn('[members.js] Render members sync error:', mErr);
          }
        }

        if (filter) {
          members = await window.desktopDB.search('members', filter, ['code', 'name']);
        } else {
          members = await window.desktopDB.query('SELECT * FROM members ORDER BY CAST(code AS INTEGER) ASC, code ASC');
          // หากฐานข้อมูล SQLite ว่างเปล่า ให้เติมค่าเริ่มต้นจาก SEED_MEMBERS
          if ((!members || members.length === 0) && typeof window.SEED_MEMBERS !== 'undefined' && window.SEED_MEMBERS.length > 0) {
            for (const sm of window.SEED_MEMBERS) {
              const exists = await window.desktopDB.select('members', ['id'], { code: sm.code });
              if (!exists || exists.length === 0) {
                await window.desktopDB.insert('members', sm);
              }
            }
            members = await window.desktopDB.query('SELECT * FROM members ORDER BY CAST(code AS INTEGER) ASC, code ASC');
          }
        }
      } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        let query = window.sb.from('members').select('*').order('code');
        if (filter) {
          query = query.or(`code.ilike.%${filter}%,name.ilike.%${filter}%`);
        }
        const { data, error } = await query;
        if (error) throw error;
        members = data || [];
      }

      const tbody = document.getElementById('members-table-body');
      const emptyState = document.getElementById('members-empty');
      const countEl = document.getElementById('member-total-count');

      if (countEl) {
        if (filter) {
          let totalAll = members.length;
          if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
            totalAll = await window.desktopDB.count('members');
          } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
            const { count } = await window.sb.from('members').select('*', { count: 'exact', head: true });
            totalAll = count || members.length;
          }
          countEl.textContent = `${members.length} / ${totalAll} คน`;
        } else {
          countEl.textContent = `${members.length} คน`;
        }
      }

      if (!tbody) return;

      if (members.length === 0) {
        tbody.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
        const tbl = tbody.closest('.table-container');
        if (tbl) tbl.style.display = 'none';
      } else {
        if (emptyState) emptyState.style.display = 'none';
        const tbl = tbody.closest('.table-container');
        if (tbl) tbl.style.display = 'block';

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
            <td>${window.formatDate ? window.formatDate(m.created_at) : (m.created_at || '-')}</td>
            <td>
              <button class="btn btn-secondary btn-sm btn-icon" onclick="openMemberModal('${m.id}')" title="แก้ไขข้อมูล">✏️</button>
              <button class="btn btn-warning btn-sm btn-icon" onclick="openAdminResetMemberPasswordModal('${m.id}')" title="รีเซ็ตรหัสผ่าน" style="margin-left:4px;">🔑</button>
              <button class="btn btn-danger btn-sm btn-icon" onclick="confirmDeleteMember('${m.id}', '${m.code}', '${(m.name || '').replace(/'/g, "\\'")}')" title="ลบสมาชิก" style="margin-left:4px;">🗑️</button>
            </td>
          </tr>
        `).join('');
      }
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast('โหลดข้อมูลสมาชิกไม่สำเร็จ: ' + err.message, 'error');
    }
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  /**
   * ค้นหาสมาชิกแบบ Debounce 300ms
   */
  function searchMembers(query) {
    clearTimeout(memberSearchTimeout);
    memberSearchTimeout = setTimeout(() => renderMembers(query), 300);
  }

  /**
   * เปิด Modal เพิ่ม/แก้ไข ข้อมูลสมาชิก
   */
  async function openMemberModal(id = null) {
    const modal = document.getElementById('member-modal');
    const titleEl = document.getElementById('member-modal-title');
    const codeInput = document.getElementById('member-code');
    const nameInput = document.getElementById('member-name');
    const phoneInput = document.getElementById('member-phone');
    const accountInput = document.getElementById('member-account');
    const passwordInput = document.getElementById('member-password');
    const hiddenId = document.getElementById('member-id-hidden');

    if (id) {
      let member = null;
      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        const res = await window.desktopDB.select('members', ['*'], { id });
        member = res && res.length > 0 ? res[0] : null;
      } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        const { data } = await window.sb.from('members').select('*').eq('id', id).single();
        member = data;
      }
      if (!member) return;
      if (titleEl) titleEl.textContent = 'แก้ไขข้อมูลสมาชิก';
      if (hiddenId) hiddenId.value = member.id;
      if (codeInput) codeInput.value = member.code;
      if (nameInput) nameInput.value = member.name;
      if (phoneInput) phoneInput.value = member.phone || '';
      if (accountInput) accountInput.value = member.account_no || '';
      if (passwordInput) passwordInput.value = member.password || '';
    } else {
      if (titleEl) titleEl.textContent = 'เพิ่มสมาชิกใหม่';
      if (hiddenId) hiddenId.value = '';
      if (nameInput) nameInput.value = '';
      if (phoneInput) phoneInput.value = '';
      if (accountInput) accountInput.value = '';
      if (passwordInput) passwordInput.value = '';

      // แนะนำรหัสสมาชิกลำดับถัดไปแบบอัตโนมัติ
      let members = [];
      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        members = await window.desktopDB.query('SELECT code FROM members ORDER BY CAST(code AS INTEGER) DESC LIMIT 1') || [];
      } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        const { data } = await window.sb.from('members').select('code').order('code', { ascending: false }).limit(1);
        members = data || [];
      }
      if (members && members.length > 0) {
        const maxCode = parseInt(members[0].code) || 0;
        if (codeInput) codeInput.value = String(maxCode + 1).padStart(3, '0');
      } else {
        if (codeInput) codeInput.value = '001';
      }
    }

    if (modal) modal.classList.add('show');
    if (codeInput) codeInput.focus();
  }

  /**
   * ปิด Modal ข้อมูลสมาชิก
   */
  function closeMemberModal() {
    const modal = document.getElementById('member-modal');
    if (modal) modal.classList.remove('show');
  }

  /**
   * บันทึกข้อมูลสมาชิก (เพิ่มใหม่ / แก้ไข)
   */
  async function saveMember() {
    const hiddenId = document.getElementById('member-id-hidden').value;
    const code = document.getElementById('member-code').value.trim();
    const name = document.getElementById('member-name').value.trim();
    const phone = document.getElementById('member-phone').value.trim();
    const account_no = document.getElementById('member-account').value.trim();
    const passwordInput = document.getElementById('member-password');
    const password = passwordInput ? passwordInput.value.trim() : '';

    if (!code) { if (typeof window.showToast === 'function') window.showToast('กรุณากรอกรหัสสมาชิก', 'error'); return; }
    if (!name) { if (typeof window.showToast === 'function') window.showToast('กรุณากรอกชื่อ-นามสกุล', 'error'); return; }

    // ตรวจสอบรหัสสมาชิกซ้ำ
    let existing = [];
    if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
      existing = await window.desktopDB.select('members', ['id', 'name', 'code'], { code }) || [];
    } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
      const { data } = await window.sb.from('members').select('id, name').eq('code', code);
      existing = data || [];
    }
    const duplicate = existing?.find(m => String(m.id) !== String(hiddenId));
    if (duplicate) {
      if (typeof window.showToast === 'function') window.showToast(`รหัส ${code} ถูกใช้แล้วโดย ${duplicate.name}`, 'error');
      return;
    }

    if (typeof window.showLoading === 'function') window.showLoading();
    try {
      const payload = { code, name, phone, account_no };
      if (password) payload.password = password;
      const cloudPayload = { code, name, phone, account_no };

      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        if (hiddenId) {
          await window.desktopDB.update('members', payload, { id: hiddenId });
          await window.desktopDB.insert('sync_queue', {
            table_name: 'members',
            action: 'UPDATE',
            row_data: JSON.stringify(cloudPayload),
            local_id: hiddenId
          });
          if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
            try {
              await window.sb.from('members').update(cloudPayload).eq('code', code);
            } catch (cloudErr) {
              console.warn('[members.js] Direct cloud update member error:', cloudErr);
            }
          }
          if (typeof window.showToast === 'function') window.showToast('แก้ไขข้อมูลสมาชิกสำเร็จ!', 'success');
        } else {
          const inserted = await window.desktopDB.insert('members', payload);
          await window.desktopDB.insert('sync_queue', {
            table_name: 'members',
            action: 'INSERT',
            row_data: JSON.stringify(cloudPayload),
            local_id: inserted.id
          });
          if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
            try {
              await window.sb.from('members').upsert(cloudPayload, { onConflict: 'code' });
            } catch (cloudErr) {
              console.warn('[members.js] Direct cloud insert member error:', cloudErr);
            }
          }
          if (typeof window.showToast === 'function') window.showToast('เพิ่มสมาชิกใหม่สำเร็จ!', 'success');
        }

        try {
          if (typeof window.desktopDB.syncUpload === 'function') {
            window.desktopDB.syncUpload().catch(() => {});
          }
        } catch (e) {}

      } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        if (hiddenId) {
          const { error } = await window.sb.from('members').update(cloudPayload).eq('id', hiddenId);
          if (error) throw error;
          if (typeof window.showToast === 'function') window.showToast('แก้ไขข้อมูลสมาชิกสำเร็จ!', 'success');
        } else {
          const { error } = await window.sb.from('members').upsert(cloudPayload, { onConflict: 'code' });
          if (error) throw error;
          if (typeof window.showToast === 'function') window.showToast('เพิ่มสมาชิกใหม่สำเร็จ!', 'success');
        }
      }
      closeMemberModal();
      await renderMembers();
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
    }
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  /**
   * เปิด Modal ยืนยันการลบสมาชิก
   */
  function confirmDeleteMember(id, code, name) {
    const modal = document.getElementById('confirm-modal');
    const msg = document.getElementById('confirm-message');
    const btn = document.getElementById('confirm-action-btn');
    if (msg) {
      msg.innerHTML = `
        <span class="confirm-icon">⚠️</span>
        ต้องการลบสมาชิก <strong>${code} - ${name || ''}</strong> ใช่หรือไม่?
      `;
    }
    if (btn) btn.onclick = () => deleteMember(id);
    if (modal) modal.classList.add('show');
  }

  /**
   * ลบสมาชิกออกจากระบบ
   */
  async function deleteMember(id) {
    if (!id) return;
    if (typeof window.showLoading === 'function') window.showLoading();
    try {
      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        const memberRows = await window.desktopDB.select('members', ['*'], { id });
        const member = (memberRows && memberRows.length > 0) ? memberRows[0] : null;

        await window.desktopDB.delete('members', { id });
        await window.desktopDB.run('DELETE FROM sync_queue WHERE table_name = "members" AND local_id = ?', [id]);

        if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline() && member) {
          try {
            await window.sb.from('members').delete().eq('code', member.code);
          } catch (e) {
            console.warn('[members.js] Cloud delete member error:', e);
          }
        }

        try {
          if (typeof window.desktopDB.syncUpload === 'function') {
            window.desktopDB.syncUpload().catch(() => {});
          }
        } catch (e) {}
      } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        const { error } = await window.sb.from('members').delete().eq('id', id);
        if (error) throw error;
      }

      if (typeof window.closeConfirmModal === 'function') {
        window.closeConfirmModal();
      } else {
        const modal = document.getElementById('confirm-modal');
        if (modal) modal.classList.remove('show');
      }

      await renderMembers();
      if (typeof window.showToast === 'function') window.showToast('ลบสมาชิกเรียบร้อยแล้ว!', 'success');
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast('ลบสมาชิกไม่สำเร็จ: ' + err.message, 'error');
    }
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  // ========== 2. EXCEL / CSV IMPORT SYSTEM ==========

  /**
   * แปลงรหัสสมาชิกให้เป็นตัวเลข 3 หลักเสมอ (เช่น 1 -> 001)
   */
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

  /**
   * เปิด Modal นำเข้าสมาชิกจาก Excel/CSV
   */
  function openImportMemberModal() {
    if (window.currentUser?.role !== 'admin') {
      if (typeof window.showToast === 'function') window.showToast('เฉพาะแอดมินเท่านั้นที่สามารถนำเข้าสมาชิกได้', 'error');
      return;
    }

    parsedImportData = [];
    const fileIn = document.getElementById('member-file-input');
    const previewSec = document.getElementById('import-preview-section');
    const confirmBtn = document.getElementById('confirm-import-btn');

    if (fileIn) fileIn.value = '';
    if (previewSec) previewSec.style.display = 'none';
    if (confirmBtn) confirmBtn.disabled = true;

    const modal = document.getElementById('import-member-modal');
    if (modal) modal.classList.add('show');
  }

  /**
   * ปิด Modal นำเข้าสมาชิก
   */
  function closeImportMemberModal() {
    const modal = document.getElementById('import-member-modal');
    if (modal) modal.classList.remove('show');
  }

  /**
   * อ่านไฟล์ Excel/CSV และแปลงข้อมูลเพื่อ Preview
   */
  async function handleMemberFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (typeof window.showLoading === 'function') window.showLoading('กำลังอ่านไฟล์ Excel/CSV...');
    try {
      const data = await file.arrayBuffer();
      const workbook = window.XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      const rawRows = window.XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (!rawRows || rawRows.length === 0) {
        if (typeof window.showToast === 'function') window.showToast('ไฟล์ไม่มีข้อมูล หรือรูปแบบไม่ถูกต้อง', 'error');
        if (typeof window.hideLoading === 'function') window.hideLoading();
        return;
      }

      // ดึงรหัสสมาชิกที่มีอยู่เดิมในระบบมาตรวจสอบความซ้ำซ้อน
      let existingCodes = new Set();
      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        const existingMembers = await window.desktopDB.query('SELECT code FROM members') || [];
        existingCodes = new Set(existingMembers.map(m => m.code));
      } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        const { data: existingMembers } = await window.sb.from('members').select('code');
        existingCodes = new Set((existingMembers || []).map(m => m.code));
      }

      const codesInFile = new Set();
      parsedImportData = [];

      rawRows.forEach((row, idx) => {
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
      if (typeof window.showToast === 'function') window.showToast('อ่านไฟล์ไม่สำเร็จ: ' + err.message, 'error');
    }
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  /**
   * แสดงตารางพรีวิวข้อมูลที่จะนำเข้า
   */
  function renderImportPreview() {
    const container = document.getElementById('import-preview-section');
    const tbody = document.getElementById('import-preview-table-body');
    const countTotalEl = document.getElementById('import-count-total');
    const badgeValidEl = document.getElementById('import-badge-valid');
    const badgeInvalidEl = document.getElementById('import-badge-invalid');
    const confirmBtn = document.getElementById('confirm-import-btn');

    if (!container || !tbody) return;

    const validRows = parsedImportData.filter(r => r.isValid);
    const invalidRows = parsedImportData.filter(r => !r.isValid);

    if (countTotalEl) countTotalEl.textContent = parsedImportData.length;
    if (badgeValidEl) badgeValidEl.textContent = `🟢 พร้อมนำเข้า: ${validRows.length}`;
    if (badgeInvalidEl) badgeInvalidEl.textContent = `🔴 มีปัญหา: ${invalidRows.length}`;

    if (confirmBtn) {
      confirmBtn.disabled = validRows.length === 0;
      confirmBtn.innerHTML = `💾 ยืนยันนำเข้าข้อมูล (${validRows.length} รายการ)`;
    }

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

  /**
   * ยืนยันการนำเข้ารายชื่อสมาชิกเข้าฐานข้อมูล
   */
  async function confirmImportMembers() {
    const validRows = parsedImportData.filter(r => r.isValid);
    if (validRows.length === 0) {
      if (typeof window.showToast === 'function') window.showToast('ไม่มีรายการที่พร้อมนำเข้า', 'error');
      return;
    }

    if (typeof window.showLoading === 'function') window.showLoading('กำลังบันทึกข้อมูลสมาชิก...');
    try {
      const insertPayload = validRows.map(r => ({
        code: r.transformedCode,
        name: r.name,
        phone: r.phone || '',
        account_no: r.accountNo || '',
        created_at: new Date().toISOString()
      }));

      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        for (const item of insertPayload) {
          const inserted = await window.desktopDB.insert('members', item);
          await window.desktopDB.insert('sync_queue', {
            table_name: 'members',
            action: 'INSERT',
            row_data: JSON.stringify(item),
            local_id: inserted.id
          });
        }
        if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
          try {
            await window.sb.from('members').insert(insertPayload);
          } catch (e) {
            console.warn('[members.js] Cloud import insert error:', e);
          }
        }
        try {
          if (typeof window.desktopDB.syncUpload === 'function') {
            window.desktopDB.syncUpload().catch(() => {});
          }
        } catch (e) {}
      } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        const { error } = await window.sb.from('members').insert(insertPayload);
        if (error) throw error;
      }

      if (typeof window.showToast === 'function') {
        window.showToast(`นำเข้าสำเร็จ ${insertPayload.length} รายการ!`, 'success');
      }
      closeImportMemberModal();
      await renderMembers();
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast('นำเข้าไม่สำเร็จ: ' + err.message, 'error');
    }
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  // ========== 3. MEMBER SALES HISTORY & PRINTING ==========

  /**
   * เปิดหน้าต่างประวัติการขายยางของสมาชิกรายคน
   */
  async function showMemberSalesHistory(memberCode) {
    if (typeof window.showLoading === 'function') window.showLoading('กำลังโหลดประวัติการขาย...');
    try {
      let member = null;
      let transactions = [];
      let rounds = [];

      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        const mList = await window.desktopDB.select('members', ['*'], { code: memberCode });
        member = mList && mList.length > 0 ? mList[0] : null;
        transactions = await window.desktopDB.query('SELECT * FROM transactions WHERE member_code = ? ORDER BY date DESC', [memberCode]) || [];
        rounds = await window.desktopDB.query('SELECT id, title, supabase_id FROM purchase_rounds') || [];
      } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        const { data: mData } = await window.sb.from('members').select('*').eq('code', memberCode).single();
        member = mData;
        const { data: txList } = await window.sb.from('transactions')
          .select('*')
          .eq('member_code', memberCode)
          .order('date', { ascending: false });
        transactions = txList || [];
        const { data: rData } = await window.sb.from('purchase_rounds').select('id, title');
        rounds = rData || [];
      }

      if (!member) throw new Error('ไม่พบข้อมูลสมาชิก');

      const roundTitleMap = {};
      (rounds || []).forEach(r => {
        if (r.id) roundTitleMap[String(r.id)] = r.title;
        if (r.supabase_id) roundTitleMap[String(r.supabase_id)] = r.title;
      });

      const distinctRounds = new Set(transactions.map(t => t.round_id).filter(Boolean)).size;
      const txCount = transactions.length;
      const totalWeight = Math.round(transactions.reduce((s, t) => s + Number(t.final_weight || t.net_weight || 0), 0) * 100) / 100;
      const totalAmount = Math.round(transactions.reduce((s, t) => s + (Math.round(Number(t.total_price || 0) * 100) / 100), 0) * 100) / 100;

      const avatarEl = document.getElementById('m-history-avatar');
      const nameEl = document.getElementById('m-history-name');
      const codeAccEl = document.getElementById('m-history-code-account');

      if (avatarEl) avatarEl.textContent = member.name.charAt(0);
      if (nameEl) nameEl.textContent = member.name;
      if (codeAccEl) codeAccEl.textContent = `รหัสสมาชิก: ${member.code} | เลขที่บัญชี: ${member.account_no || '-'}`;

      const rCountEl = document.getElementById('m-stat-rounds-count');
      const txCountEl = document.getElementById('m-stat-tx-count');
      const tWeightEl = document.getElementById('m-stat-total-weight');
      const tAmountEl = document.getElementById('m-stat-total-amount');

      if (rCountEl) rCountEl.innerHTML = `${distinctRounds} <span class="unit">รอบ</span>`;
      if (txCountEl) txCountEl.innerHTML = `${txCount} <span class="unit">ครั้ง</span>`;
      if (tWeightEl) tWeightEl.innerHTML = `${window.formatNumber ? window.formatNumber(totalWeight) : totalWeight} <span class="unit">กก.</span>`;
      if (tAmountEl) tAmountEl.innerHTML = `${window.formatNumber ? window.formatNumber(totalAmount) : totalAmount} <span class="unit">บาท</span>`;

      const tbody = document.getElementById('m-history-table-body');
      const emptyState = document.getElementById('m-history-empty');

      if (tbody) {
        if (transactions.length === 0) {
          tbody.innerHTML = '';
          if (emptyState) emptyState.style.display = 'block';
          const tbl = tbody.closest('.table-container');
          if (tbl) tbl.style.display = 'none';
        } else {
          if (emptyState) emptyState.style.display = 'none';
          const tbl = tbody.closest('.table-container');
          if (tbl) tbl.style.display = 'block';

          const renderLimit = 100;
          const paginatedTx = transactions.slice(0, renderLimit);

          let rowsHtml = paginatedTx.map(t => `
            <tr>
              <td>${window.formatDateTime ? window.formatDateTime(t.date) : (t.date || '-')}</td>
              <td><span class="badge badge-green">${roundTitleMap[t.round_id] || 'นอกรอบ'}</span></td>
              <td>${window.getRubberTypeBadge ? window.getRubberTypeBadge(t.rubber_type) : (t.rubber_type || '-')}</td>
              <td>${t.trip_count || 1}</td>
              <td>${window.formatNumber ? window.formatNumber(t.final_weight || t.net_weight) : (t.final_weight || t.net_weight)} กก.</td>
              <td style="font-weight:600; color:var(--gold);">${window.formatNumber ? window.formatNumber(t.total_price) : t.total_price} ฿</td>
              <td><span class="badge" style="background:rgba(255,255,255,0.08);">${t.created_by_name || 'ผู้ดูแลระบบ'}</span></td>
              <td>
                <button class="btn btn-secondary btn-sm btn-icon" onclick="showReceiptFromHistory('${t.id}')" title="ใบเสร็จ">🧾</button>
              </td>
            </tr>
          `).join('');

          if (transactions.length > renderLimit) {
            rowsHtml += `
              <tr>
                <td colspan="8" style="text-align:center; padding:10px 14px; background:rgba(59, 130, 246, 0.08); color:var(--text-accent, #60a5fa); font-size:0.8rem; font-weight:500; border-top:1px solid rgba(255,255,255,0.08);">
                  ℹ️ แสดงข้อมูลล่าสุด 100 รายการ จากทั้งหมด ${txCount} ครั้ง (กรุณาพิมพ์ค้นหาหากต้องการดูข้อมูลที่เก่ากว่านี้)
                </td>
              </tr>
            `;
          }

          tbody.innerHTML = rowsHtml;
        }
      }

      const prefFormat = localStorage.getItem('print_pref_member_summary') || '1';
      const formatSelect = document.getElementById('member-summary-print-format');
      if (formatSelect) formatSelect.value = prefFormat;

      const modal = document.getElementById('member-sales-modal');
      if (modal) modal.classList.add('show');
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast('ไม่สามารถโหลดประวัติสมาชิกได้: ' + err.message, 'error');
    }
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  /**
   * ปิด Modal ประวัติการขายยางของสมาชิก
   */
  function closeMemberSalesModal() {
    const modal = document.getElementById('member-sales-modal');
    if (modal) modal.classList.remove('show');
  }

  /**
   * บันทึก Preference รูปแบบพิมพ์สรุปยอดขายสมาชิก (ฉบับเดียว หรือ 2 ฉบับ)
   */
  function onMemberSummaryFormatChange(format) {
    localStorage.setItem('print_pref_member_summary', format);
  }

  /**
   * พิมพ์เอกสารสรุปยอดขายของสมาชิก (A4 สวยงาม พร้อมลายเซ็น)
   */
  async function printMemberSalesSummary() {
    const name = document.getElementById('m-history-name')?.textContent || '';
    const codeAccount = document.getElementById('m-history-code-account')?.textContent || '';
    const rounds = document.getElementById('m-stat-rounds-count')?.textContent || '0';
    const txCount = document.getElementById('m-stat-tx-count')?.textContent || '0';
    const totalWeight = document.getElementById('m-stat-total-weight')?.textContent || '0';
    const totalAmount = document.getElementById('m-stat-total-amount')?.textContent || '0';
    const plantName = window.cachedSettings?.plantation_name || 'ลานยางพาราชุมชน';

    const format = document.getElementById('member-summary-print-format')?.value || localStorage.getItem('print_pref_member_summary') || '1';
    localStorage.setItem('print_pref_member_summary', format);

    let chairmanName = '..................................';
    try {
      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        const chairmen = await window.desktopDB.query("SELECT display_name FROM app_users WHERE position LIKE '%ประธาน%' ORDER BY created_at ASC LIMIT 1");
        if (chairmen && chairmen.length > 0 && chairmen[0].display_name) chairmanName = chairmen[0].display_name;
      } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        const { data: chairmen } = await window.sb.from('app_users')
          .select('display_name')
          .ilike('position', '%ประธาน%')
          .order('created_at', { ascending: true })
          .limit(1);

        if (chairmen && chairmen.length > 0 && chairmen[0].display_name) {
          chairmanName = chairmen[0].display_name;
        }
      }
    } catch (err) {
      console.warn('[members.js] Could not fetch chairman name:', err);
    }

    const tableBody = document.getElementById('m-history-table-body');
    const rows = tableBody ? tableBody.querySelectorAll('tr') : [];
    const rowCount = rows.length;

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
    if (printWindow) {
      printWindow.document.write(printHtml);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => { printWindow.print(); }, 500);
    }
  }

  // ส่งออกฟังก์ชันไปยัง Global window scope เพื่อให้ HTML onclick และไฟล์อื่นๆ เรียกใช้ได้
  window.renderMembers = renderMembers;
  window.searchMembers = searchMembers;
  window.openMemberModal = openMemberModal;
  window.closeMemberModal = closeMemberModal;
  window.saveMember = saveMember;
  window.confirmDeleteMember = confirmDeleteMember;
  window.deleteMember = deleteMember;
  window.transformMemberCode = transformMemberCode;
  window.openImportMemberModal = openImportMemberModal;
  window.closeImportMemberModal = closeImportMemberModal;
  window.handleMemberFileSelect = handleMemberFileSelect;
  window.renderImportPreview = renderImportPreview;
  window.confirmImportMembers = confirmImportMembers;
  window.showMemberSalesHistory = showMemberSalesHistory;
  window.closeMemberSalesModal = closeMemberSalesModal;
  window.onMemberSummaryFormatChange = onMemberSummaryFormatChange;
  window.printMemberSalesSummary = printMemberSalesSummary;

})(window);
