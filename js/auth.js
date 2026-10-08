/**
 * js/auth.js - Authentication & User Management Layer
 * กลุ่มเกษตรกรทำสวนยางพาราท่าสะแก
 * Version: 2.0 (Phase 2 Refactoring)
 */

(function (window) {
  'use strict';

  // ========== 1. GLOBAL STATE & SESSION GETTERS ==========
  // แชร์ State ผ่าน window เพื่อให้ทุกโมดูลและ index.html เข้าถึงข้อมูลชุดเดียวกัน
  window.currentUser = window.currentUser || null;
  window.currentMemberUser = window.currentMemberUser || null;

  /**
   * ตรวจสอบ Session การล็อกอินของเจ้าหน้าที่ (Staff / Admin)
   */
  function checkAuth() {
    const isLogged = sessionStorage.getItem('rb_session') === 'logged_in';
    const storedUser = sessionStorage.getItem('rb_user');
    if (isLogged && storedUser) {
      try {
        window.currentUser = JSON.parse(storedUser);
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  /**
   * ตรวจสอบ Session การล็อกอินของสมาชิก (Member Portal)
   */
  function checkMemberAuth() {
    const isMemberLogged = sessionStorage.getItem('rb_member_session') === 'logged_in';
    const storedMember = sessionStorage.getItem('rb_member_user');
    if (isMemberLogged && storedMember) {
      try {
        window.currentMemberUser = JSON.parse(storedMember);
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  /**
   * สลับแท็บฟอร์มล็อกอินระหว่าง เจ้าหน้าที่ <-> สมาชิก
   */
  function switchLoginRole(role) {
    const staffBtn = document.getElementById('role-btn-staff');
    const memberBtn = document.getElementById('role-btn-member');
    const staffForm = document.getElementById('login-form');
    const memberForm = document.getElementById('member-login-form');
    const errorEl = document.getElementById('login-error');

    if (errorEl) errorEl.classList.remove('show');

    if (role === 'member') {
      if (staffBtn) staffBtn.classList.remove('active');
      if (memberBtn) memberBtn.classList.add('active');
      if (staffForm) staffForm.style.display = 'none';
      if (memberForm) memberForm.style.display = 'block';
    } else {
      if (memberBtn) memberBtn.classList.remove('active');
      if (staffBtn) staffBtn.classList.add('active');
      if (memberForm) memberForm.style.display = 'none';
      if (staffForm) staffForm.style.display = 'block';
    }
  }

  /**
   * ซ่อน/แสดงรหัสผ่านฟอร์มเจ้าหน้าที่
   */
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

  /**
   * ซ่อน/แสดงรหัสผ่านฟอร์มสมาชิก
   */
  function toggleMemberPasswordVisibility() {
    const pwdInput = document.getElementById('member-login-password');
    if (!pwdInput) return;
    pwdInput.type = pwdInput.type === 'password' ? 'text' : 'password';
  }

  /**
   * โหลด Username เจ้าหน้าที่ที่บันทึกไว้ในจำรหัสผ่าน
   */
  function loadRememberedCredentials() {
    try {
      const savedUser = localStorage.getItem('rb_remember_user');
      if (savedUser) {
        const userEl = document.getElementById('login-username');
        if (userEl) userEl.value = savedUser;
      }
    } catch (e) {}
  }

  // ========== 2. STAFF / ADMIN LOGIN & LOGOUT ==========

  /**
   * จัดการการล็อกอินของเจ้าหน้าที่ (Desktop SQLite / Supabase Cloud / Fallback)
   * ใช้ Progressive Password Migration ผ่าน window.verifyPassword()
   */
  async function handleLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

    if (!username || !password) {
      if (errorEl) {
        errorEl.textContent = 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน';
        errorEl.classList.add('show');
      }
      return;
    }

    if (typeof window.showLoading === 'function') window.showLoading('กำลังเข้าสู่ระบบ...');
    try {
      let loggedUser = null;
      let needsRehash = false;
      let newHash = null;

      // 1. Desktop SQLite Authentication (Instant offline 100%)
      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        try {
          const users = await window.desktopDB.query('SELECT * FROM app_users WHERE LOWER(username) = LOWER(?)', [username]);
          if (users && users.length > 0) {
            for (const u of users) {
              const verifyRes = await window.verifyPassword(password, u.password, u.username);
              if (verifyRes.isValid) {
                loggedUser = u;
                if (verifyRes.needsRehash && verifyRes.newHash) {
                  needsRehash = true;
                  newHash = verifyRes.newHash;
                  await window.desktopDB.update('app_users', { password: newHash }, { id: u.id });
                }
                break;
              }
            }
          }
        } catch (e) {
          console.warn('[auth.js] Desktop login SQLite error:', e);
        }

        // If not found in SQLite, try Supabase cloud lookup (if online) and cache into SQLite!
        if (!loggedUser && window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
          try {
            const { data: cloudUsers } = await window.sb.from('app_users').select('*').ilike('username', username);
            if (cloudUsers && cloudUsers.length > 0) {
              for (const u of cloudUsers) {
                const verifyRes = await window.verifyPassword(password, u.password, u.username);
                if (verifyRes.isValid) {
                  loggedUser = u;
                  if (verifyRes.needsRehash && verifyRes.newHash) {
                    needsRehash = true;
                    newHash = verifyRes.newHash;
                    await window.sb.from('app_users').update({ password: newHash }).eq('id', u.id);
                  }
                  const existing = await window.desktopDB.query('SELECT id FROM app_users WHERE LOWER(username) = LOWER(?)', [u.username]);
                  if (existing && existing.length > 0) {
                    await window.desktopDB.update('app_users', {
                      display_name: u.display_name || '',
                      position: u.position || '',
                      role: u.role || 'staff',
                      password: newHash || u.password
                    }, { id: existing[0].id });
                  } else {
                    await window.desktopDB.insert('app_users', {
                      username: u.username,
                      password: newHash || u.password,
                      display_name: u.display_name || '',
                      position: u.position || '',
                      role: u.role || 'staff'
                    });
                  }
                  break;
                }
              }
            }
          } catch (cloudErr) {
            console.warn('[auth.js] Desktop cloud fallback login error:', cloudErr);
          }
        }

        // Default Admin User fallback in Desktop mode
        if (!loggedUser) {
          const isDefaultAdmin = (username.toUpperCase() === 'SANSUANG' || username.toLowerCase() === 'admin');
          if (isDefaultAdmin && (password === 'admin' || password === 'SANSUANG')) {
            loggedUser = {
              id: 'desktop-admin',
              username: username,
              display_name: 'ผู้ดูแลระบบ (Admin)',
              role: 'admin'
            };
          }
        }
      } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        // 2. Web Mode: Try Supabase authentication
        try {
          const { data: users, error } = await window.sb.from('app_users')
            .select('*')
            .ilike('username', username);

          if (!error && users && users.length > 0) {
            for (const u of users) {
              const verifyRes = await window.verifyPassword(password, u.password, u.username);
              if (verifyRes.isValid) {
                loggedUser = u;
                if (verifyRes.needsRehash && verifyRes.newHash) {
                  await window.sb.from('app_users').update({ password: verifyRes.newHash }).eq('id', u.id);
                }
                break;
              }
            }
          }
        } catch (e) {
          console.warn('[auth.js] app_users online check error:', e);
        }

        // Fallback: Check settings table if app_users query didn't find user
        if (!loggedUser) {
          try {
            const { data: setArr } = await window.sb.from('settings').select('admin_username, admin_password').eq('id', 1);
            const setData = setArr && setArr[0];
            if (setData && username.toLowerCase() === (setData.admin_username || '').toLowerCase()) {
              const verifyRes = await window.verifyPassword(password, setData.admin_password, username);
              if (verifyRes.isValid) {
                const finalHash = verifyRes.newHash || (await window.hashPassword(password, username));
                try {
                  const { data: newUser } = await window.sb.from('app_users').insert({
                    username: setData.admin_username,
                    password: finalHash,
                    display_name: 'ผู้ดูแลระบบ',
                    role: 'admin'
                  }).select().maybeSingle();
                  if (newUser) loggedUser = newUser;
                } catch (e) { /* ignore */ }

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
          } catch (e) {}
        }
      }

      // 3. Offline Authentication Fallback: Check local cache
      if (!loggedUser) {
        try {
          const cachedUsers = JSON.parse(localStorage.getItem('cached_app_users') || '[]');
          for (const u of cachedUsers) {
            if (u.username?.toLowerCase() === username.toLowerCase()) {
              const verifyRes = await window.verifyPassword(password, u.password, u.username);
              if (verifyRes.isValid) {
                loggedUser = u;
                break;
              }
            }
          }
        } catch (e) {}

        if (!loggedUser) {
          const isDefaultAdminUser = (username.toUpperCase() === 'SANSUANG' || username.toLowerCase() === 'admin');
          if (isDefaultAdminUser && (password === 'admin' || password === 'SANSUANG')) {
            loggedUser = {
              id: 'offline-admin',
              username: username,
              display_name: 'ผู้ดูแลระบบ (Admin)',
              role: 'admin'
            };
          }
        }
      }

      if (loggedUser) {
        window.currentUser = {
          id: loggedUser.id,
          username: loggedUser.username,
          display_name: loggedUser.display_name || loggedUser.username,
          role: loggedUser.role || 'staff'
        };
        sessionStorage.setItem('rb_session', 'logged_in');
        sessionStorage.setItem('rb_user', JSON.stringify(window.currentUser));
        localStorage.setItem('rb_user', JSON.stringify(window.currentUser));
        if (errorEl) errorEl.classList.remove('show');

        // Show App UI
        if (typeof window.showApp === 'function') {
          await window.showApp();
        }
        if (typeof window.showToast === 'function') {
          window.showToast(`ยินดีต้อนรับ คุณ${window.currentUser.display_name}!`, 'success');
        }
      } else {
        if (errorEl) {
          errorEl.textContent = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
          errorEl.classList.add('show');
        }
      }
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = 'เกิดข้อผิดพลาด: ' + (err.message || err);
        errorEl.classList.add('show');
      }
    }
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  /**
   * จัดการการออกจากระบบของเจ้าหน้าที่
   */
  function handleLogout() {
    if (typeof window.cleanupRealtimeSubscriptions === 'function') {
      window.cleanupRealtimeSubscriptions();
    }
    sessionStorage.removeItem('rb_session');
    sessionStorage.removeItem('rb_user');
    window.currentUser = null;

    const appEl = document.getElementById('app');
    if (appEl) appEl.classList.remove('active');

    const mpPage = document.getElementById('member-portal-page');
    if (mpPage) mpPage.style.display = 'none';

    const loginPage = document.getElementById('login-page');
    if (loginPage) loginPage.style.display = 'flex';

    const userIn = document.getElementById('login-username');
    const passIn = document.getElementById('login-password');
    if (userIn) userIn.value = '';
    if (passIn) passIn.value = '';

    const errorEl = document.getElementById('login-error');
    if (errorEl) errorEl.classList.remove('show');
  }

  // ========== 3. MEMBER LOGIN & LOGOUT ==========

  /**
   * ดึงรหัสผ่านสมาชิกที่เก็บไว้ใน LocalStorage Cache
   */
  function getStoredMemberPassword(code) {
    if (!code) return null;
    try {
      const pwdMap = JSON.parse(localStorage.getItem('member_passwords_cache_v1') || '{}');
      const norm = window.normalizeMemberCodeStr ? window.normalizeMemberCodeStr(code) : code;
      return pwdMap[code] || pwdMap[norm] || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * บันทึกรหัสผ่านสมาชิกลงใน LocalStorage Cache
   */
  function setStoredMemberPassword(code, hashedPwd) {
    if (!code) return;
    try {
      const pwdMap = JSON.parse(localStorage.getItem('member_passwords_cache_v1') || '{}');
      const norm = window.normalizeMemberCodeStr ? window.normalizeMemberCodeStr(code) : code;
      pwdMap[code] = hashedPwd;
      pwdMap[norm] = hashedPwd;
      localStorage.setItem('member_passwords_cache_v1', JSON.stringify(pwdMap));
    } catch (e) {}
  }

  /**
   * จัดการการล็อกอินของสมาชิก (Member Portal)
   * รองรับทั้งรหัสผ่านที่ตั้งใหม่, เบอร์โทร, หรือรหัสสมาชิกตั้งต้น
   */
  async function handleMemberLogin() {
    const rawCode = document.getElementById('member-login-code').value.trim();
    const rawPassword = document.getElementById('member-login-password').value.trim();
    const errorEl = document.getElementById('login-error');

    if (!rawCode || !rawPassword) {
      if (errorEl) {
        errorEl.textContent = 'กรุณากรอกรหัสสมาชิกและรหัสผ่าน';
        errorEl.classList.add('show');
      }
      return;
    }

    if (typeof window.showLoading === 'function') window.showLoading('กำลังเข้าสู่ระบบสมาชิก...');
    try {
      const codeNormalized = window.normalizeMemberCodeStr ? window.normalizeMemberCodeStr(rawCode) : rawCode;

      // ค้นหาข้อมูลสมาชิกจาก Desktop SQLite, Supabase หรือ IndexedDB
      let memberMatch = null;
      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        try {
          const members = await window.desktopDB.query('SELECT * FROM members WHERE code = ? OR code = ?', [codeNormalized, rawCode]);
          if (members && members.length > 0) memberMatch = members[0];
        } catch (e) {}
      } else if (typeof window.isAppOffline === 'function' && window.isAppOffline()) {
        try {
          if (typeof window.getOfflineMembers === 'function') {
            const offlineMembers = await window.getOfflineMembers(rawCode);
            if (offlineMembers && offlineMembers.length > 0) {
              memberMatch = offlineMembers.find(m => (window.normalizeMemberCodeStr ? window.normalizeMemberCodeStr(m.code) : m.code) === codeNormalized || m.code === rawCode) || offlineMembers[0];
            }
          }
        } catch (e) {}
      } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        try {
          const { data: members, error } = await window.sb.from('members')
            .select('*')
            .or(`code.eq.${codeNormalized},code.eq.${rawCode}`);

          if (!error && members && members.length > 0) {
            memberMatch = members[0];
          }
        } catch (e) {
          console.warn('[auth.js] Members table query error:', e);
        }
      }

      // Fallback: check SEED_MEMBERS array
      if (!memberMatch && typeof window.SEED_MEMBERS !== 'undefined') {
        const seedFound = window.SEED_MEMBERS.find(m => (window.normalizeMemberCodeStr ? window.normalizeMemberCodeStr(m.code) : m.code) === codeNormalized || m.code === rawCode);
        if (seedFound) {
          memberMatch = { ...seedFound, phone: '', account_no: '', password: '' };
        }
      }

      if (!memberMatch) {
        if (errorEl) {
          errorEl.textContent = `ไม่พบรหัสสมาชิก "${rawCode}" ในระบบ`;
          errorEl.classList.add('show');
        }
        if (typeof window.hideLoading === 'function') window.hideLoading();
        return;
      }

      const storedLocalPwd = getStoredMemberPassword(memberMatch.code);
      const passInputNorm = window.normalizeMemberCodeStr ? window.normalizeMemberCodeStr(rawPassword) : rawPassword;
      const codeNorm = window.normalizeMemberCodeStr ? window.normalizeMemberCodeStr(memberMatch.code) : memberMatch.code;

      let isPasswordValid = false;
      let needsRehash = false;
      let newSaltedHash = null;

      const targetStoredPwd = storedLocalPwd || memberMatch.password;

      if (targetStoredPwd) {
        const verifyRes = await window.verifyPassword(rawPassword, targetStoredPwd, memberMatch.code);
        if (verifyRes.isValid) {
          isPasswordValid = true;
          if (verifyRes.needsRehash && verifyRes.newHash) {
            needsRehash = true;
            newSaltedHash = verifyRes.newHash;
          }
        } else if (targetStoredPwd === passInputNorm) {
          isPasswordValid = true;
          needsRehash = true;
          newSaltedHash = await window.hashPassword(rawPassword, memberMatch.code);
        }
      } else {
        // Phone and code fallback ONLY when no custom password is set
        if (memberMatch.phone && memberMatch.phone.trim() === rawPassword) {
          isPasswordValid = true;
        } else if (rawPassword === memberMatch.code || passInputNorm === codeNorm || rawPassword === codeNorm) {
          isPasswordValid = true;
        }
      }

      if (isPasswordValid) {
        // Background upgrade password hash silently
        if (needsRehash && newSaltedHash) {
          setStoredMemberPassword(memberMatch.code, newSaltedHash);
          if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
            try {
              await window.desktopDB.run('UPDATE members SET password = ? WHERE code = ? OR code = ?', [newSaltedHash, memberMatch.code, codeNorm]);
            } catch (e) {}
          }
          if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
            try {
              await window.sb.from('members').update({ password: newSaltedHash }).or(`code.eq.${memberMatch.code},code.eq.${codeNorm}`);
            } catch (e) {}
          }
        }

        window.currentMemberUser = {
          code: memberMatch.code,
          name: memberMatch.name,
          account_no: memberMatch.account_no || '',
          phone: memberMatch.phone || ''
        };

        sessionStorage.setItem('rb_member_session', 'logged_in');
        sessionStorage.setItem('rb_member_user', JSON.stringify(window.currentMemberUser));
        if (errorEl) errorEl.classList.remove('show');

        if (typeof window.showMemberPortalApp === 'function') {
          await window.showMemberPortalApp();
        }
        if (typeof window.showToast === 'function') {
          window.showToast(`ยินดีต้อนรับ คุณ${window.currentMemberUser.name}!`, 'success');
        }
      } else {
        if (errorEl) {
          errorEl.textContent = 'รหัสผ่านไม่ถูกต้อง (รหัสผ่านเริ่มต้นคือ รหัสสมาชิกของคุณ)';
          errorEl.classList.add('show');
        }
      }
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ: ' + (err.message || err);
        errorEl.classList.add('show');
      }
    }
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  /**
   * จัดการออกจากระบบของสมาชิก
   */
  function handleMemberLogout() {
    sessionStorage.removeItem('rb_member_session');
    sessionStorage.removeItem('rb_member_user');
    window.currentMemberUser = null;

    const mpPage = document.getElementById('member-portal-page');
    if (mpPage) mpPage.style.display = 'none';

    const appEl = document.getElementById('app');
    if (appEl) appEl.classList.remove('active');

    const loginPage = document.getElementById('login-page');
    if (loginPage) loginPage.style.display = 'flex';

    const codeIn = document.getElementById('member-login-code');
    const passIn = document.getElementById('member-login-password');
    if (codeIn) codeIn.value = '';
    if (passIn) passIn.value = '';

    const errorEl = document.getElementById('login-error');
    if (errorEl) errorEl.classList.remove('show');
  }

  // ========== 4. PASSWORD & PROFILE MANAGEMENT ==========

  /**
   * บันทึกแก้ไขชื่อแสดงส่วนตัวของเจ้าหน้าที่ (Profile)
   */
  async function saveProfileName() {
    const newName = document.getElementById('profile-display-name').value.trim();
    if (!newName) {
      if (typeof window.showToast === 'function') window.showToast('กรุณากรอกชื่อที่แสดง', 'error');
      return;
    }

    if (typeof window.showLoading === 'function') window.showLoading();
    try {
      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        await window.desktopDB.update('app_users', { display_name: newName }, { id: window.currentUser.id });
      } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        const { error } = await window.sb.from('app_users').update({
          display_name: newName
        }).eq('id', window.currentUser.id);
        if (error) throw error;
      }

      window.currentUser.display_name = newName;
      sessionStorage.setItem('rb_user', JSON.stringify(window.currentUser));
      if (typeof window.updateUserSidebarUI === 'function') window.updateUserSidebarUI();

      if (typeof window.showToast === 'function') window.showToast('อัปเดตชื่อที่แสดงสำเร็จ!', 'success');
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast('ไม่สามารถอัปเดตโปรไฟล์ได้: ' + err.message, 'error');
    }
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  /**
   * เปลี่ยนรหัสผ่านของเจ้าหน้าที่ (My Password)
   */
  async function changeMyPassword() {
    const oldPass = document.getElementById('profile-old-password').value;
    const newPass = document.getElementById('profile-new-password').value;
    const confirmPass = document.getElementById('profile-confirm-password').value;

    if (!oldPass || !newPass || !confirmPass) {
      if (typeof window.showToast === 'function') window.showToast('กรุณากรอกข้อมูลรหัสผ่านให้ครบทุกช่อง', 'error');
      return;
    }

    if (newPass !== confirmPass) {
      if (typeof window.showToast === 'function') window.showToast('รหัสผ่านใหม่กับยืนยันรหัสผ่านไม่ตรงกัน', 'error');
      return;
    }

    if (typeof window.showLoading === 'function') window.showLoading();
    try {
      let userCheck = null;
      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        const res = await window.desktopDB.select('app_users', ['password', 'username'], { id: window.currentUser.id });
        userCheck = res && res.length > 0 ? res[0] : null;
      } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        const { data } = await window.sb.from('app_users')
          .select('password, username')
          .eq('id', window.currentUser.id)
          .single();
        userCheck = data;
      }

      const verifyOld = await window.verifyPassword(oldPass, userCheck ? userCheck.password : '', window.currentUser.username);
      if (!userCheck || !verifyOld.isValid) {
        if (typeof window.showToast === 'function') window.showToast('รหัสผ่านเดิมไม่ถูกต้อง', 'error');
        if (typeof window.hideLoading === 'function') window.hideLoading();
        return;
      }

      const hashedNew = await window.hashPassword(newPass, window.currentUser.username);

      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        await window.desktopDB.update('app_users', { password: hashedNew }, { id: window.currentUser.id });
      } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        const { error } = await window.sb.from('app_users').update({
          password: hashedNew
        }).eq('id', window.currentUser.id);
        if (error) throw error;
      }

      if (typeof window.showToast === 'function') window.showToast('เปลี่ยนรหัสผ่านส่วนตัวสำเร็จ!', 'success');
      document.getElementById('profile-old-password').value = '';
      document.getElementById('profile-new-password').value = '';
      document.getElementById('profile-confirm-password').value = '';
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast('เปลี่ยนรหัสผ่านไม่สำเร็จ: ' + err.message, 'error');
    }
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  /**
   * เปิด Modal เปลี่ยนรหัสผ่านของสมาชิก (Member Self-Service)
   */
  function openMemberChangePasswordModal() {
    if (!window.currentMemberUser) return;
    const modal = document.getElementById('mp-change-password-modal');
    const oldPwd = document.getElementById('mp-old-pwd');
    const newPwd = document.getElementById('mp-new-pwd');
    const confirmPwd = document.getElementById('mp-confirm-pwd');
    if (oldPwd) oldPwd.value = '';
    if (newPwd) newPwd.value = '';
    if (confirmPwd) confirmPwd.value = '';
    if (modal) modal.classList.add('show');
  }

  /**
   * ปิด Modal เปลี่ยนรหัสผ่านของสมาชิก
   */
  function closeMemberChangePasswordModal() {
    const modal = document.getElementById('mp-change-password-modal');
    if (modal) modal.classList.remove('show');
  }

  /**
   * บันทึกรหัสผ่านใหม่ของสมาชิก (Member Self-Service)
   */
  async function saveMemberNewPassword() {
    if (!window.currentMemberUser || !window.currentMemberUser.code) return;

    const oldPwd = document.getElementById('mp-old-pwd')?.value.trim();
    const newPwd = document.getElementById('mp-new-pwd')?.value.trim();
    const confirmPwd = document.getElementById('mp-confirm-pwd')?.value.trim();

    if (!oldPwd || !newPwd || !confirmPwd) {
      if (typeof window.showToast === 'function') window.showToast('กรุณากรอกข้อมูลให้ครบถ้วนทุกช่อง', 'error');
      return;
    }

    if (newPwd !== confirmPwd) {
      if (typeof window.showToast === 'function') window.showToast('รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน', 'error');
      return;
    }

    if (newPwd.length < 3) {
      if (typeof window.showToast === 'function') window.showToast('รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 3 ตัวอักษร', 'error');
      return;
    }

    if (typeof window.showLoading === 'function') window.showLoading();
    try {
      const code = window.currentMemberUser.code;
      const codeNorm = window.normalizeMemberCodeStr ? window.normalizeMemberCodeStr(code) : code;

      let member = null;
      try {
        if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
          const { data: memberData } = await window.sb.from('members')
            .select('*')
            .or(`code.eq.${code},code.eq.${codeNorm}`)
            .maybeSingle();
          if (memberData) member = memberData;
        }
      } catch (e) {}

      if (!member) {
        member = { code: code, name: window.currentMemberUser.name };
      }

      const storedLocalPwd = getStoredMemberPassword(code);
      const passInputNorm = window.normalizeMemberCodeStr ? window.normalizeMemberCodeStr(oldPwd) : oldPwd;
      const codeNormTarget = window.normalizeMemberCodeStr ? window.normalizeMemberCodeStr(member.code) : member.code;

      let isOldValid = false;
      const targetStoredPwd = storedLocalPwd || member.password;

      if (targetStoredPwd) {
        const verifyRes = await window.verifyPassword(oldPwd, targetStoredPwd, code);
        if (verifyRes.isValid || targetStoredPwd === passInputNorm) {
          isOldValid = true;
        }
      } else {
        if (member.phone && member.phone.trim() === oldPwd) {
          isOldValid = true;
        } else if (oldPwd === member.code || passInputNorm === codeNormTarget || oldPwd === codeNormTarget) {
          isOldValid = true;
        }
      }

      if (!isOldValid) {
        if (typeof window.showToast === 'function') window.showToast('รหัสผ่านปัจจุบันไม่ถูกต้อง', 'error');
        if (typeof window.hideLoading === 'function') window.hideLoading();
        return;
      }

      const hashedNewPwd = await window.hashPassword(newPwd, code);

      // Save to local cache first
      setStoredMemberPassword(code, hashedNewPwd);

      // Update SQLite local DB for offline member login
      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        try {
          await window.desktopDB.run(
            'UPDATE members SET password = ? WHERE code = ? OR code = ?',
            [hashedNewPwd, code, codeNorm]
          );
        } catch (dbErr) {
          console.warn('[auth.js] desktopDB member password update error:', dbErr);
        }
      }

      // Update Supabase members table
      if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        try {
          await window.sb.from('members')
            .update({ password: hashedNewPwd })
            .or(`code.eq.${code},code.eq.${codeNorm}`);
        } catch (e) {
          console.warn('[auth.js] Supabase password update skipped:', e);
        }
      }

      closeMemberChangePasswordModal();
      if (typeof window.showToast === 'function') {
        window.showToast('🔐 เปลี่ยนรหัสผ่านใหม่เรียบร้อยแล้ว! กรุณาใช้รหัสผ่านใหม่ในการเข้าสู่ระบบครั้งถัดไป', 'success');
      }
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast('เปลี่ยนรหัสผ่านไม่สำเร็จ: ' + err.message, 'error');
    }
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  // ========== 5. ADMIN RESET MEMBER PASSWORD WORKFLOW ==========
  let currentResetTargetMember = null;

  /**
   * เปิด Modal แอดมินรีเซ็ตรหัสผ่านให้สมาชิก
   */
  async function openAdminResetMemberPasswordModal(memberIdOrCode) {
    if (!memberIdOrCode) return;
    if (typeof window.showLoading === 'function') window.showLoading();
    try {
      let member = null;
      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        const rows = await window.desktopDB.query('SELECT * FROM members WHERE id = ? OR code = ?', [memberIdOrCode, memberIdOrCode]);
        if (rows && rows.length > 0) member = rows[0];
      } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        const { data } = await window.sb.from('members')
          .select('*')
          .or(`id.eq.${memberIdOrCode},code.eq.${memberIdOrCode}`)
          .maybeSingle();
        member = data;
      }

      if (!member) {
        if (typeof window.showToast === 'function') window.showToast('ไม่พบข้อมูลสมาชิก', 'error');
        if (typeof window.hideLoading === 'function') window.hideLoading();
        return;
      }

      currentResetTargetMember = member;

      const titleEl = document.getElementById('armp-member-title');
      if (titleEl) {
        titleEl.textContent = `รหัส ${member.code} - ${member.name}`;
      }

      const input = document.getElementById('armp-new-pwd');
      if (input) input.value = '';

      const modal = document.getElementById('admin-reset-member-pwd-modal');
      if (modal) modal.classList.add('show');
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
    }
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  /**
   * ปิด Modal แอดมินรีเซ็ตรหัสผ่านให้สมาชิก
   */
  function closeAdminResetMemberPasswordModal() {
    const modal = document.getElementById('admin-reset-member-pwd-modal');
    if (modal) modal.classList.remove('show');
    currentResetTargetMember = null;
  }

  /**
   * สุ่มรหัสผ่าน 6 หลักสำหรับรีเซ็ตรหัสผ่านสมาชิก
   */
  function generateRandomPassword6Digits() {
    const randomCode = Math.floor(100000 + Math.random() * 900000).toString();
    const input = document.getElementById('armp-new-pwd');
    if (input) input.value = randomCode;
  }

  /**
   * ยืนยันแอดมินรีเซ็ตรหัสผ่านให้สมาชิก
   */
  async function confirmAdminResetMemberPassword() {
    if (!currentResetTargetMember) return;

    const newPwdPlain = document.getElementById('armp-new-pwd')?.value.trim();
    if (!newPwdPlain) {
      if (typeof window.showToast === 'function') window.showToast('กรุณากรอกหรือกดสุ่มรหัสผ่านใหม่', 'error');
      return;
    }

    if (typeof window.showLoading === 'function') window.showLoading();
    try {
      const member = currentResetTargetMember;
      const hashedPwd = await window.hashPassword(newPwdPlain, member.code);

      // บันทึกลงใน local cache
      setStoredMemberPassword(member.code, hashedPwd);

      // อัปเดตใน SQLite local DB
      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        try {
          await window.desktopDB.run(
            'UPDATE members SET password = ? WHERE id = ? OR code = ?',
            [hashedPwd, member.id, member.code]
          );
        } catch (dbErr) {
          console.warn('[auth.js] desktopDB admin reset member password update error:', dbErr);
        }
      }

      // อัปเดตใน Supabase members table
      if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        try {
          await window.sb.from('members')
            .update({ password: hashedPwd })
            .eq('id', member.id);
        } catch (e) {
          console.warn('[auth.js] Supabase password column update skipped:', e);
        }
      }

      const staffName = window.currentUser?.display_name || window.currentUser?.username || 'เจ้าหน้าที่';
      try {
        if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
          await window.sb.from('activity_logs').insert({
            action: 'reset_member_password',
            user_name: staffName,
            details: `รีเซ็ตรหัสผ่านสมาชิก ${member.code} (${member.name})`,
            created_at: new Date().toISOString()
          });
        }
      } catch (e) {
        const logs = JSON.parse(localStorage.getItem('audit_logs_cache') || '[]');
        logs.unshift({
          action: 'reset_member_password',
          staff: staffName,
          target_member: `${member.code} - ${member.name}`,
          reset_at: new Date().toISOString()
        });
        localStorage.setItem('audit_logs_cache', JSON.stringify(logs));
      }

      closeAdminResetMemberPasswordModal();

      alert(`🔑 รีเซ็ตรหัสผ่านให้คุณ ${member.name} (รหัส ${member.code}) เรียบร้อยแล้ว!\n\nรหัสผ่านใหม่คือ: ${newPwdPlain}\n\nกรุณาแจ้งรหัสผ่านใหม่นี้แก่สมาชิก และแนะนำให้สมาชิกเปลี่ยนรหัสผ่านเองอีกครั้งหลังเข้าสู่ระบบ`);

      if (typeof window.renderMembers === 'function') await window.renderMembers();
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast('รีเซ็ตรหัสผ่านไม่สำเร็จ: ' + err.message, 'error');
    }
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  // ========== 6. USER MANAGEMENT (ADMIN ONLY) ==========

  /**
   * แสดงรายการผู้ใช้งานระบบ (app_users)
   */
  async function renderUsers() {
    if (window.currentUser?.role !== 'admin') return;

    if (typeof window.showLoading === 'function') window.showLoading();
    try {
      let users = [];
      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
          try {
            const { data: cloudUsers } = await window.sb.from('app_users').select('*').order('created_at');
            if (cloudUsers && cloudUsers.length > 0) {
              for (const u of cloudUsers) {
                const existing = await window.desktopDB.query('SELECT id FROM app_users WHERE LOWER(username) = LOWER(?)', [u.username]);
                if (existing && existing.length > 0) {
                  await window.desktopDB.update('app_users', {
                    display_name: u.display_name || '',
                    position: u.position || '',
                    role: u.role || 'user',
                    password: u.password
                  }, { id: existing[0].id });
                } else {
                  await window.desktopDB.insert('app_users', {
                    username: u.username,
                    password: u.password,
                    display_name: u.display_name || '',
                    position: u.position || '',
                    role: u.role || 'user'
                  });
                }
              }
            }
          } catch (e) {
            console.warn('[auth.js] Desktop fetch cloud users error:', e);
          }
        }
        users = await window.desktopDB.query('SELECT * FROM app_users ORDER BY created_at ASC') || [];
      } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        const { data, error } = await window.sb.from('app_users').select('*').order('created_at');
        if (error) throw error;
        users = data || [];
      }

      const list = users || [];
      const tbody = document.getElementById('users-table-body');
      const emptyState = document.getElementById('users-empty');

      if (!tbody) return;

      if (list.length === 0) {
        tbody.innerHTML = '';
        if (emptyState) emptyState.style.display = 'block';
        const tbl = tbody.closest('.table-container');
        if (tbl) tbl.style.display = 'none';
      } else {
        if (emptyState) emptyState.style.display = 'none';
        const tbl = tbody.closest('.table-container');
        if (tbl) tbl.style.display = 'block';

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
            <td>${window.formatDate ? window.formatDate(u.created_at) : (u.created_at || '-')}</td>
            <td>
              <button class="btn btn-secondary btn-sm btn-icon" onclick="openUserModal('${u.id}')" title="แก้ไข">✏️</button>
              ${String(u.id) !== String(window.currentUser?.id) 
                ? `<button class="btn btn-danger btn-sm btn-icon" onclick="confirmDeleteUser('${u.id}', '${u.username}')" title="ลบ" style="margin-left:4px;">🗑️</button>` 
                : ''}
            </td>
          </tr>
        `).join('');
      }
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast('โหลดรายชื่อผู้ใช้ไม่สำเร็จ: ' + err.message, 'error');
    }
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  /**
   * เปิด Modal เพิ่ม/แก้ไข ผู้ใช้งานระบบ
   */
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
      let u = null;
      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        const res = await window.desktopDB.select('app_users', ['*'], { id });
        u = res && res.length > 0 ? res[0] : null;
      } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        const { data } = await window.sb.from('app_users').select('*').eq('id', id).single();
        u = data;
      }
      if (!u) return;
      if (titleEl) titleEl.textContent = 'แก้ไขข้อมูลผู้ใช้งาน';
      if (hiddenId) hiddenId.value = u.id;
      if (usernameInput) {
        usernameInput.value = u.username;
        usernameInput.disabled = true;
      }
      if (nameInput) nameInput.value = u.display_name;
      if (posInput) posInput.value = u.position || '';
      if (passInput) {
        passInput.value = '';
        passInput.placeholder = 'กรอกรหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)';
      }
      if (roleInput) roleInput.value = u.role;
    } else {
      if (titleEl) titleEl.textContent = 'เพิ่มผู้ใช้งานใหม่';
      if (hiddenId) hiddenId.value = '';
      if (usernameInput) {
        usernameInput.value = '';
        usernameInput.disabled = false;
      }
      if (nameInput) nameInput.value = '';
      if (posInput) posInput.value = '';
      if (passInput) {
        passInput.value = '';
        passInput.placeholder = 'กรอกรหัสผ่าน';
      }
      if (roleInput) roleInput.value = 'user';
    }

    if (modal) modal.classList.add('show');
    if (usernameInput) usernameInput.focus();
  }

  /**
   * ปิด Modal ผู้ใช้งานระบบ
   */
  function closeUserModal() {
    const modal = document.getElementById('user-modal');
    if (modal) modal.classList.remove('show');
  }

  /**
   * บันทึกข้อมูลผู้ใช้งานระบบ (เพิ่ม/แก้ไข)
   */
  async function saveUser() {
    const hiddenId = document.getElementById('user-id-hidden').value;
    const username = document.getElementById('user-username').value.trim();
    const display_name = document.getElementById('user-display-name').value.trim();
    const position = document.getElementById('user-position')?.value.trim() || '';
    const password = document.getElementById('user-password').value;
    const role = document.getElementById('user-role').value;

    if (!username) { if (typeof window.showToast === 'function') window.showToast('กรุณากรอกชื่อผู้ใช้ (Username)', 'error'); return; }
    if (!display_name) { if (typeof window.showToast === 'function') window.showToast('กรุณากรอกชื่อที่แสดง', 'error'); return; }
    if (!hiddenId && !password) { if (typeof window.showToast === 'function') window.showToast('กรุณากรอกรหัสผ่าน', 'error'); return; }

    if (typeof window.showLoading === 'function') window.showLoading();
    try {
      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        if (hiddenId) {
          const updatePayload = { display_name, position, role };
          if (password) {
            updatePayload.password = await window.hashPassword(password, username);
          }
          await window.desktopDB.update('app_users', updatePayload, { id: hiddenId });
          await window.desktopDB.insert('sync_queue', {
            table_name: 'app_users',
            action: 'UPDATE',
            row_data: JSON.stringify({ id: hiddenId, username, ...updatePayload }),
            local_id: hiddenId
          });

          if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
            try {
              await window.sb.from('app_users').update(updatePayload).eq('username', username);
            } catch (cloudErr) {
              console.warn('[auth.js] Direct cloud update user error:', cloudErr);
            }
          }
          if (typeof window.showToast === 'function') window.showToast('แก้ไขข้อมูลผู้ใช้งานสำเร็จ!', 'success');
        } else {
          const hashedPass = await window.hashPassword(password, username);
          const insertPayload = { username, display_name, position, password: hashedPass, role };
          const inserted = await window.desktopDB.insert('app_users', insertPayload);
          await window.desktopDB.insert('sync_queue', {
            table_name: 'app_users',
            action: 'INSERT',
            row_data: JSON.stringify(insertPayload),
            local_id: inserted.id
          });

          if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
            try {
              await window.sb.from('app_users').upsert(insertPayload, { onConflict: 'username' });
            } catch (cloudErr) {
              console.warn('[auth.js] Direct cloud insert user error:', cloudErr);
            }
          }
          if (typeof window.showToast === 'function') window.showToast('เพิ่มผู้ใช้งานใหม่สำเร็จ!', 'success');
        }

        try {
          if (typeof window.desktopDB.syncUpload === 'function') {
            window.desktopDB.syncUpload().catch(() => {});
          }
        } catch (e) {}

      } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        if (hiddenId) {
          const updatePayload = { display_name, position, role };
          if (password) {
            updatePayload.password = await window.hashPassword(password, username);
          }

          let { data, error } = await window.sb.from('app_users').update(updatePayload).eq('id', hiddenId).select();

          if (error && error.message && error.message.includes('position')) {
            delete updatePayload.position;
            const res = await window.sb.from('app_users').update(updatePayload).eq('id', hiddenId).select();
            error = res.error;
            data = res.data;
          }

          if (error) throw error;
          if (typeof window.showToast === 'function') window.showToast('แก้ไขข้อมูลผู้ใช้งานสำเร็จ!', 'success');
        } else {
          const hashedPass = await window.hashPassword(password, username);
          const insertPayload = { username, display_name, position, password: hashedPass, role };

          let { data, error } = await window.sb.from('app_users').insert(insertPayload).select();

          if (error && error.message && error.message.includes('position')) {
            delete insertPayload.position;
            const res = await window.sb.from('app_users').insert(insertPayload).select();
            error = res.error;
            data = res.data;
          }

          if (error) throw error;
          if (typeof window.showToast === 'function') window.showToast('เพิ่มผู้ใช้งานใหม่สำเร็จ!', 'success');
        }
      }
      closeUserModal();
      await renderUsers();
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast('บันทึกผู้ใช้ไม่สำเร็จ: ' + err.message, 'error');
    }
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  /**
   * เปิด Modal ยืนยันการลบผู้ใช้งาน
   */
  function confirmDeleteUser(id, username = null) {
    const modal = document.getElementById('confirm-modal');
    const msg = document.getElementById('confirm-message');
    const btn = document.getElementById('confirm-action-btn');
    if (msg) {
      msg.innerHTML = `
        <span class="confirm-icon">⚠️</span>
        ต้องการลบบัญชีผู้ใช้งาน <strong>${username || ''}</strong> ใช่หรือไม่?
      `;
    }
    if (btn) btn.onclick = () => deleteUser(id, username);
    if (modal) modal.classList.add('show');
  }

  /**
   * ลบผู้ใช้งานออกจากระบบ
   */
  async function deleteUser(id, username = null) {
    if (!id && !username) return;
    if (window.currentUser && (id === window.currentUser.id || username === window.currentUser.username)) {
      if (typeof window.showToast === 'function') window.showToast('ไม่สามารถลบบัญชีของตัวเองได้', 'error');
      return;
    }

    if (typeof window.showLoading === 'function') window.showLoading();
    try {
      if (typeof window.isDesktopApp === 'function' && window.isDesktopApp()) {
        let targetUsername = username;
        if (!targetUsername && id) {
          const userRows = await window.desktopDB.select('app_users', ['*'], { id });
          const u = (userRows && userRows.length > 0) ? userRows[0] : null;
          if (u) targetUsername = u.username;
        }

        if (id) {
          await window.desktopDB.delete('app_users', { id });
          await window.desktopDB.run('DELETE FROM sync_queue WHERE table_name = "app_users" AND local_id = ?', [id]);
        }
        if (targetUsername) {
          await window.desktopDB.delete('app_users', { username: targetUsername });
          await window.desktopDB.run('DELETE FROM sync_queue WHERE table_name = "app_users" AND row_data LIKE ?', [`%"username":"${targetUsername}"%`]);
        }

        if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline() && targetUsername) {
          try {
            await window.sb.from('app_users').delete().eq('username', targetUsername);
          } catch (e) {
            console.warn('[auth.js] Cloud delete user error:', e);
          }
        }

        try {
          if (typeof window.desktopDB.syncUpload === 'function') {
            window.desktopDB.syncUpload().catch(() => {});
          }
        } catch (e) {}
      } else if (window.sb && typeof window.isAppOffline === 'function' && !window.isAppOffline()) {
        if (id) await window.sb.from('app_users').delete().eq('id', id);
        if (username) await window.sb.from('app_users').delete().eq('username', username);
      }

      if (typeof window.closeConfirmModal === 'function') {
        window.closeConfirmModal();
      } else {
        const modal = document.getElementById('confirm-modal');
        if (modal) modal.classList.remove('show');
      }

      await renderUsers();
      if (typeof window.showToast === 'function') window.showToast('ลบผู้ใช้งานออกจากระบบเรียบร้อยแล้ว!', 'success');
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast('ลบผู้ใช้ไม่สำเร็จ: ' + err.message, 'error');
    }
    if (typeof window.hideLoading === 'function') window.hideLoading();
  }

  // ส่งออกฟังก์ชันไปยัง Global window scope เพื่อให้ HTML onclick และไฟล์อื่นๆ เรียกใช้ได้
  window.checkAuth = checkAuth;
  window.checkMemberAuth = checkMemberAuth;
  window.switchLoginRole = switchLoginRole;
  window.togglePasswordVisibility = togglePasswordVisibility;
  window.toggleMemberPasswordVisibility = toggleMemberPasswordVisibility;
  window.loadRememberedCredentials = loadRememberedCredentials;
  window.handleLogin = handleLogin;
  window.handleLogout = handleLogout;
  window.getStoredMemberPassword = getStoredMemberPassword;
  window.setStoredMemberPassword = setStoredMemberPassword;
  window.handleMemberLogin = handleMemberLogin;
  window.handleMemberLogout = handleMemberLogout;
  window.saveProfileName = saveProfileName;
  window.changeMyPassword = changeMyPassword;
  window.openMemberChangePasswordModal = openMemberChangePasswordModal;
  window.closeMemberChangePasswordModal = closeMemberChangePasswordModal;
  window.saveMemberNewPassword = saveMemberNewPassword;
  window.openAdminResetMemberPasswordModal = openAdminResetMemberPasswordModal;
  window.closeAdminResetMemberPasswordModal = closeAdminResetMemberPasswordModal;
  window.generateRandomPassword6Digits = generateRandomPassword6Digits;
  window.confirmAdminResetMemberPassword = confirmAdminResetMemberPassword;
  window.renderUsers = renderUsers;
  window.openUserModal = openUserModal;
  window.closeUserModal = closeUserModal;
  window.saveUser = saveUser;
  window.confirmDeleteUser = confirmDeleteUser;
  window.deleteUser = deleteUser;

})(window);
