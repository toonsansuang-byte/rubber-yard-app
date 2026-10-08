/**
 * js/store.js - Rubber Yard Store & Inventory Management (Simple POS Complete System)
 * กลุ่มเกษตรกรทำสวนยางพาราท่าสะแก
 * Version: 3.0 (Full POS Front-Counter, Dual-Copy A4 Receipt, Auto Stock Deduction & Member Purchase History)
 */

(function (window) {
  'use strict';

  // Global state for store
  window.currentStoreProducts = window.currentStoreProducts || [];
  window.posCart = window.posCart || [];
  window.selectedPosMember = null;
  window.currentStoreSalesHistory = [];
  window.currentStoreReceiptTx = null;

  let activeStoreTab = 'pos';
  let editingProductId = null;
  let posSearchTimeout = null;
  let posFocusedMemberIndex = -1;
  let posSearchMemberResults = [];

  /**
   * Helper จัดรูปแบบจำนวนสต๊อก/จำนวนสินค้า:
   * จำนวนเต็ม (เช่น 163, 1000) -> '163', '1,000' (ไม่มี .00)
   * ถ้ามีเศษทศนิยม (เช่น 10.5) -> '10.5'
   */
  function formatStock(qty) {
    const n = parseFloat(qty || 0);
    if (isNaN(n)) return '0';
    if (Number.isInteger(n)) {
      return n.toLocaleString('th-TH');
    }
    return parseFloat(n.toFixed(2)).toLocaleString('th-TH');
  }
  window.formatStock = formatStock;

  // ==========================================
  // 1. SUB-TAB NAVIGATION
  // ==========================================

  function switchStoreTab(tabId) {
    activeStoreTab = tabId;

    // Toggle tab button active classes
    const tabs = ['pos', 'inventory', 'history'];
    tabs.forEach(t => {
      const btn = document.getElementById(`tab-btn-${t}`);
      const content = document.getElementById(`store-tab-${t}`);

      if (btn) {
        if (t === tabId) {
          btn.classList.add('active');
          btn.classList.remove('btn-secondary');
          btn.classList.add('btn-primary');
        } else {
          btn.classList.remove('active');
          btn.classList.remove('btn-primary');
          btn.classList.add('btn-secondary');
        }
      }

      if (content) {
        content.style.display = (t === tabId) ? 'block' : 'none';
      }
    });

    // Load data for active tab
    if (tabId === 'pos') {
      renderPosProducts();
      renderPosCart();
      setTimeout(() => {
        const pSearch = document.getElementById('pos-product-search');
        if (pSearch) pSearch.focus();
      }, 100);
    } else if (tabId === 'inventory') {
      renderStoreProducts();
    } else if (tabId === 'history') {
      renderStoreSalesHistory();
    }
  }

  async function initStoreSection() {
    await loadStoreProductsData();
    switchStoreTab(activeStoreTab || 'pos');
  }

  // ==========================================
  // 2. DATA LOADER (PRODUCTS)
  // ==========================================

  async function loadStoreProductsData() {
    try {
      let products = [];
      const isDesktop = typeof isDesktopApp === 'function' && isDesktopApp() && window.desktopDB;
      const isOnline = typeof sb !== 'undefined' && sb && (typeof isAppOffline !== 'function' || !isAppOffline());

      if (isDesktop) {
        // Desktop App: Load from local SQLite
        const local = await window.desktopDB.select('store_products', ['*']);
        products = local || [];

        // If online, sync down any new cloud products
        if (isOnline) {
          try {
            const { data: cloudProducts, error } = await sb.from('store_products').select('*');
            if (!error && cloudProducts && cloudProducts.length > 0) {
              for (const cp of cloudProducts) {
                const cpNameTrim = (cp.name || '').trim().toLowerCase();
                const match = products.find(p => 
                  (p.supabase_id && String(p.supabase_id) === String(cp.id)) || 
                  (p.name && (p.name || '').trim().toLowerCase() === cpNameTrim)
                );
                if (!match) {
                  // Double check SQLite directly to avoid race conditions with Realtime listeners
                  const existingDb = await window.desktopDB.query(
                    'SELECT id FROM store_products WHERE supabase_id = ? OR TRIM(LOWER(name)) = ? LIMIT 1',
                    [String(cp.id), cpNameTrim]
                  );
                  if (existingDb && existingDb.length > 0) {
                    await window.desktopDB.update('store_products', {
                      name: cp.name,
                      unit: cp.unit || 'ชิ้น',
                      price: cp.price,
                      cost_price: cp.cost_price || 0,
                      stock_quantity: cp.stock_quantity || 0,
                      is_active: cp.is_active ? 1 : 0,
                      supabase_id: String(cp.id)
                    }, { id: existingDb[0].id });
                  } else {
                    const ins = await window.desktopDB.insert('store_products', {
                      name: cp.name,
                      unit: cp.unit || 'ชิ้น',
                      cost_price: cp.cost_price || 0,
                      price: cp.price || 0,
                      stock_quantity: cp.stock_quantity || 0,
                      is_active: cp.is_active ? 1 : 0,
                      synced: 1,
                      supabase_id: String(cp.id)
                    });
                    if (ins) products.push(ins);
                  }
                } else {
                  match.name = cp.name;
                  match.unit = cp.unit || 'ชิ้น';
                  match.price = cp.price;
                  match.cost_price = cp.cost_price || 0;
                  match.stock_quantity = cp.stock_quantity || 0;
                  match.is_active = (cp.is_active === 1 || cp.is_active === true) ? 1 : 0;
                  match.supabase_id = String(cp.id);
                  await window.desktopDB.update('store_products', {
                    name: cp.name,
                    unit: cp.unit || 'ชิ้น',
                    price: cp.price,
                    cost_price: cp.cost_price || 0,
                    stock_quantity: cp.stock_quantity || 0,
                    is_active: match.is_active,
                    supabase_id: String(cp.id)
                  }, { id: match.id });
                }
              }
            }
          } catch (cloudErr) {
            console.warn('Store cloud fetch skipped:', cloudErr);
          }
        }
      } else if (isOnline) {
        // Web Mode: Load from Supabase
        const { data, error } = await sb.from('store_products').select('*').order('created_at', { ascending: false });
        if (!error && data) {
          products = data;
        }
      }

      // Auto-deduplicate products in-memory and clean up any redundant SQLite rows
      const uniqueProducts = [];
      const seenKeys = new Set();
      const duplicateIdsToDelete = [];

      for (const p of products) {
        const key = p.supabase_id 
          ? `sup_${String(p.supabase_id)}` 
          : `name_${(p.name || '').trim().toLowerCase()}`;
        if (seenKeys.has(key)) {
          if (isDesktop && p.id) {
            duplicateIdsToDelete.push(p.id);
          }
        } else {
          seenKeys.add(key);
          uniqueProducts.push(p);
        }
      }

      if (duplicateIdsToDelete.length > 0 && isDesktop) {
        for (const dupId of duplicateIdsToDelete) {
          try {
            await window.desktopDB.run('DELETE FROM store_products WHERE id = ?', [dupId]);
          } catch (e) {
            console.warn('Auto-cleanup duplicate product error:', dupId, e);
          }
        }
      }

      products = uniqueProducts;

      // Sort: Active first, then by name
      products.sort((a, b) => {
        const aActive = (a.is_active === 1 || a.is_active === true) ? 1 : 0;
        const bActive = (b.is_active === 1 || b.is_active === true) ? 1 : 0;
        if (bActive !== aActive) return bActive - aActive;
        return (a.name || '').localeCompare(b.name || '', 'th');
      });

      window.currentStoreProducts = products;
      return products;
    } catch (err) {
      console.error('loadStoreProductsData error:', err);
      return [];
    }
  }

  // ==========================================
  // 3. POS CATALOG & SEARCH
  // ==========================================

  function renderPosProducts(productsToRender = null) {
    const grid = document.getElementById('pos-products-grid');
    const emptyEl = document.getElementById('pos-products-empty');
    const countBadge = document.getElementById('pos-products-count-badge');
    if (!grid) return;

    const all = window.currentStoreProducts || [];
    // Only show active products on POS catalog
    const activeProducts = (productsToRender !== null)
      ? productsToRender
      : all.filter(p => (p.is_active === 1 || p.is_active === true));

    if (countBadge) {
      countBadge.innerText = `พร้อมขาย ${activeProducts.length} รายการ`;
    }

    if (!activeProducts || activeProducts.length === 0) {
      grid.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    grid.innerHTML = activeProducts.map(p => {
      const stock = parseFloat(p.stock_quantity || 0);
      const isOutOfStock = stock <= 0;
      const unit = escapeHTML(p.unit || 'ชิ้น');
      const priceText = typeof formatNumber === 'function' ? formatNumber(p.price) : Number(p.price || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 });
      
      const stockBadge = isOutOfStock
        ? `<span class="badge badge-danger" style="font-size:0.75rem; padding:2px 8px; white-space:nowrap;">❌ สินค้าหมด</span>`
        : `<span class="badge badge-green" style="font-size:0.75rem; padding:2px 8px; white-space:nowrap;">คงเหลือ ${formatStock(stock)} ${unit}</span>`;

      return `
        <div class="pos-product-card ${isOutOfStock ? 'out-of-stock' : ''}" onclick="addToPosCart('${p.id}')" title="${isOutOfStock ? 'สินค้าหมด' : 'คลิกเพื่อเพิ่มลงตะกร้า'}">
          <div>
            <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary); margin-bottom: 6px; line-height: 1.35;">
              ${escapeHTML(p.name || '')}
            </div>
            <div style="margin-bottom: 8px;">
              ${stockBadge}
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: flex-end; border-top: 1px solid var(--border); padding-top: 8px; margin-top: 6px;">
            <div>
              <div style="font-size: 0.72rem; color: var(--text-muted);">ราคาขาย</div>
              <div style="font-size: 1.15rem; font-weight: 800; color: var(--gold);">
                ${priceText} <span style="font-size: 0.75rem; font-weight: normal; color: var(--text-muted);">฿/${unit}</span>
              </div>
            </div>
            <button type="button" class="btn btn-sm btn-primary" style="padding: 4px 10px; font-size: 0.8rem; border-radius: 6px;" onclick="event.stopPropagation(); addToPosCart('${p.id}')">
              ➕ ใส่ตะกร้า
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  function filterPosProducts(query) {
    const q = (query || '').trim().toLowerCase();
    const all = (window.currentStoreProducts || []).filter(p => (p.is_active === 1 || p.is_active === true));

    if (!q) {
      renderPosProducts(all);
      return;
    }

    const filtered = all.filter(p => {
      const name = (p.name || '').toLowerCase();
      const unit = (p.unit || '').toLowerCase();
      return name.includes(q) || unit.includes(q);
    });

    renderPosProducts(filtered);
  }

  // ==========================================
  // 4. POS CART MANAGEMENT
  // ==========================================

  function addToPosCart(productId) {
    if (!productId) return;
    const prod = (window.currentStoreProducts || []).find(p => String(p.id) === String(productId));
    if (!prod) return;

    const stock = parseFloat(prod.stock_quantity || 0);
    const existing = window.posCart.find(i => String(i.product_id) === String(productId));

    if (existing) {
      if (existing.quantity >= stock && stock > 0) {
        if (typeof showToast === 'function') {
          showToast(`⚠️ สินค้า "${prod.name}" ในสต๊อกคงเหลือเพียง ${formatStock(stock)} ${prod.unit || 'ชิ้น'}`, 'warning');
        }
      }
      existing.quantity += 1;
    } else {
      if (stock <= 0) {
        if (typeof showToast === 'function') {
          showToast(`⚠️ สินค้า "${prod.name}" สินค้าในสต๊อกหมด (0)`, 'warning');
        }
      }
      window.posCart.push({
        product_id: String(prod.id),
        name: prod.name,
        unit: prod.unit || 'ชิ้น',
        cost_price: parseFloat(prod.cost_price || 0),
        price: parseFloat(prod.price || 0),
        quantity: 1,
        stock_quantity: stock
      });
    }

    renderPosCart();
  }

  function updatePosCartQuantity(productId, delta) {
    const item = window.posCart.find(i => String(i.product_id) === String(productId));
    if (!item) return;

    const newQty = item.quantity + delta;
    if (newQty <= 0) {
      removeFromPosCart(productId);
      return;
    }

    if (delta > 0 && newQty > item.stock_quantity && item.stock_quantity > 0) {
      if (typeof showToast === 'function') {
        showToast(`⚠️ สต๊อกคงเหลือเพียง ${formatStock(item.stock_quantity)} ${item.unit}`, 'warning');
      }
    }

    item.quantity = newQty;
    renderPosCart();
  }

  function setPosCartQuantity(productId, newQty) {
    const qty = parseInt(newQty, 10);
    if (isNaN(qty) || qty <= 0) {
      removeFromPosCart(productId);
      return;
    }
    const item = window.posCart.find(i => String(i.product_id) === String(productId));
    if (!item) return;

    item.quantity = qty;
    renderPosCart();
  }

  function removeFromPosCart(productId) {
    window.posCart = window.posCart.filter(i => String(i.product_id) !== String(productId));
    renderPosCart();
  }

  function clearPosCart() {
    window.posCart = [];
    const cashInput = document.getElementById('pos-cash-received');
    if (cashInput) cashInput.value = '';
    renderPosCart();
  }

  function renderPosCart() {
    const listEl = document.getElementById('pos-cart-items-list');
    const emptyMsg = document.getElementById('pos-cart-empty-message');
    const totalCountEl = document.getElementById('pos-total-items-count');
    const totalAmountEl = document.getElementById('pos-total-amount');

    if (!listEl) return;

    const cart = window.posCart || [];
    let totalItems = 0;
    let totalAmount = 0;

    cart.forEach(item => {
      totalItems += item.quantity;
      totalAmount += (item.price * item.quantity);
    });

    if (totalCountEl) totalCountEl.innerText = `${formatStock(totalItems)} ชิ้น`;
    if (totalAmountEl) {
      const amtStr = typeof formatNumber === 'function' ? formatNumber(totalAmount) : totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 });
      totalAmountEl.innerText = `${amtStr} บาท`;
    }

    if (cart.length === 0) {
      listEl.innerHTML = '';
      if (emptyMsg) emptyMsg.style.display = 'block';
      calculatePosChange();
      return;
    }

    if (emptyMsg) emptyMsg.style.display = 'none';

    listEl.innerHTML = cart.map(item => {
      const lineTotal = item.price * item.quantity;
      const priceStr = typeof formatNumber === 'function' ? formatNumber(item.price) : Number(item.price).toFixed(2);
      const totalStr = typeof formatNumber === 'function' ? formatNumber(lineTotal) : Number(lineTotal).toFixed(2);

      return `
        <div class="pos-cart-row">
          <div style="flex: 1; min-width: 140px;">
            <div style="font-weight: 600; font-size: 0.88rem; color: var(--text-primary); line-height: 1.25;">
              ${escapeHTML(item.name)}
            </div>
            <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 2px;">
              ${priceStr} ฿ / ${escapeHTML(item.unit)}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <button type="button" class="pos-qty-btn" onclick="updatePosCartQuantity('${item.product_id}', -1)">-</button>
            <input type="number" class="form-input" style="width: 44px; padding: 2px 4px; text-align: center; font-size: 0.85rem; font-weight: 700; height: 26px;" value="${formatStock(item.quantity).replace(/,/g, '')}" min="1" step="any" onchange="setPosCartQuantity('${item.product_id}', this.value)">
            <button type="button" class="pos-qty-btn" onclick="updatePosCartQuantity('${item.product_id}', 1)">+</button>
          </div>
          <div style="text-align: right; min-width: 65px;">
            <div style="font-weight: 700; font-size: 0.92rem; color: var(--gold);">
              ${totalStr}
            </div>
            <span style="font-size: 0.7rem; color: var(--text-muted);">บาท</span>
          </div>
          <button type="button" onclick="removeFromPosCart('${item.product_id}')" style="background: transparent; border: none; color: var(--danger); cursor: pointer; padding: 4px; font-size: 0.85rem;" title="ลบรายการนี้">
            🗑️
          </button>
        </div>
      `;
    }).join('');

    calculatePosChange();
  }

  // ==========================================
  // 5. MEMBER SELECTOR ON POS
  // ==========================================

  function searchPosMember(query) {
    clearTimeout(posSearchTimeout);
    const listEl = document.getElementById('pos-member-list');
    const q = (query || '').trim();

    if (!q) {
      if (listEl) {
        listEl.innerHTML = '';
        listEl.style.display = 'none';
      }
      posFocusedMemberIndex = -1;
      posSearchMemberResults = [];
      return;
    }

    posSearchTimeout = setTimeout(() => {
      executeSearchPosMember(q);
    }, 250);
  }

  async function executeSearchPosMember(q) {
    const listEl = document.getElementById('pos-member-list');
    if (!listEl) return;

    try {
      let members = [];
      const isDesktop = typeof isDesktopApp === 'function' && isDesktopApp() && window.desktopDB;

      if (isDesktop) {
        const qNorm = q.padStart(3, '0');
        const qStrip = q.replace(/^0+/, '');
        const res = await window.desktopDB.query(
          "SELECT * FROM members WHERE code LIKE ? OR code LIKE ? OR code LIKE ? OR name LIKE ? ORDER BY code LIMIT 8",
          [`%${q}%`, `%${qNorm}%`, `%${qStrip}%`, `%${q}%`]
        );
        members = res || [];
      } else if (typeof sb !== 'undefined' && sb && (typeof isAppOffline !== 'function' || !isAppOffline())) {
        const { data } = await sb.from('members')
          .select('*')
          .or(`code.ilike.%${q}%,name.ilike.%${q}%`)
          .order('code')
          .limit(8);
        members = data || [];
      }

      if ((!members || members.length === 0) && typeof SEED_MEMBERS !== 'undefined') {
        const qLower = q.toLowerCase();
        const qNorm = q.padStart(3, '0');
        const qStrip = q.replace(/^0+/, '');
        members = SEED_MEMBERS.filter(m =>
          m.code.includes(q) || m.code.includes(qNorm) || m.code.includes(qStrip) || (m.name && m.name.toLowerCase().includes(qLower))
        ).slice(0, 8);
      }

      posSearchMemberResults = members || [];

      if (members.length === 0) {
        listEl.innerHTML = '<div style="padding:10px 14px; color:var(--text-muted); font-size:0.85rem;">ไม่พบรหัสหรือชื่อสมาชิกนี้</div>';
        listEl.style.display = 'block';
        return;
      }

      posFocusedMemberIndex = 0;
      listEl.innerHTML = members.map((m, idx) => `
        <div class="member-search-item ${idx === 0 ? 'keyboard-focused' : ''}" data-index="${idx}" style="padding: 8px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--border);" onclick='selectPosMember(${JSON.stringify(m).replace(/'/g, "&#39;")})'>
          <span class="member-code-badge" style="font-size:0.75rem; padding:2px 6px;">${m.code}</span>
          <span style="font-size:0.88rem; color:var(--text-primary); font-weight:600;">${m.name}</span>
          <span style="font-size:0.78rem; color:var(--text-muted); margin-left:auto;">${m.phone || ''}</span>
        </div>
      `).join('');
      listEl.style.display = 'block';

    } catch (err) {
      console.error('executeSearchPosMember error:', err);
    }
  }

  function handlePosMemberKeydown(e) {
    const listEl = document.getElementById('pos-member-list');
    const items = listEl ? listEl.querySelectorAll('.member-search-item') : [];

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length === 0) return;
      posFocusedMemberIndex = (posFocusedMemberIndex + 1) % items.length;
      updatePosMemberKeyboardFocus(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length === 0) return;
      posFocusedMemberIndex = (posFocusedMemberIndex - 1 + items.length) % items.length;
      updatePosMemberKeyboardFocus(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (posSearchMemberResults.length > 0) {
        const idx = (posFocusedMemberIndex >= 0 && posFocusedMemberIndex < posSearchMemberResults.length) ? posFocusedMemberIndex : 0;
        selectPosMember(posSearchMemberResults[idx]);
      }
    } else if (e.key === 'Escape') {
      if (listEl) listEl.style.display = 'none';
    }
  }

  function updatePosMemberKeyboardFocus(items) {
    items.forEach((item, idx) => {
      if (idx === posFocusedMemberIndex) {
        item.classList.add('keyboard-focused');
        item.style.background = 'rgba(16, 185, 129, 0.15)';
      } else {
        item.classList.remove('keyboard-focused');
        item.style.background = 'transparent';
      }
    });
  }

  function selectPosMember(m) {
    window.selectedPosMember = m;

    const listEl = document.getElementById('pos-member-list');
    if (listEl) {
      listEl.innerHTML = '';
      listEl.style.display = 'none';
    }

    const searchInput = document.getElementById('pos-member-search');
    if (searchInput) searchInput.value = '';

    const card = document.getElementById('pos-selected-member-card');
    const codeEl = document.getElementById('pos-selected-member-code');
    const nameEl = document.getElementById('pos-selected-member-name');
    const phoneEl = document.getElementById('pos-selected-member-phone');
    const badgeEl = document.getElementById('pos-member-type-badge');
    const customBox = document.getElementById('pos-custom-customer-box');

    let formattedCode = String(m.code || '');
    if (!formattedCode.startsWith('ก')) {
      formattedCode = 'ก' + formattedCode.padStart(5, '0');
    }

    if (codeEl) codeEl.innerText = formattedCode;
    if (nameEl) nameEl.innerText = m.name || '-';
    if (phoneEl) phoneEl.innerText = m.phone ? `เบอร์โทร: ${m.phone}` : (m.account_no ? `เลขบัญชี: ${m.account_no}` : '');

    if (card) card.style.display = 'flex';
    if (customBox) customBox.style.display = 'none';
    if (badgeEl) {
      badgeEl.className = 'badge badge-green';
      badgeEl.innerText = '🟢 สมาชิกสวนยาง';
    }
  }

  function clearPosMember() {
    window.selectedPosMember = null;

    const card = document.getElementById('pos-selected-member-card');
    const customBox = document.getElementById('pos-custom-customer-box');
    const badgeEl = document.getElementById('pos-member-type-badge');
    const searchInput = document.getElementById('pos-member-search');

    if (card) card.style.display = 'none';
    if (customBox) customBox.style.display = 'block';
    if (searchInput) searchInput.value = '';
    if (badgeEl) {
      badgeEl.className = 'badge badge-gray';
      badgeEl.innerText = 'ลูกค้าทั่วไป';
    }
  }

  // ==========================================
  // 6. CASH & CHANGE CALCULATION
  // ==========================================

  function calculatePosChange() {
    const cashInput = document.getElementById('pos-cash-received');
    const changeAmountEl = document.getElementById('pos-change-amount');
    const changeBanner = document.getElementById('pos-change-banner');
    if (!changeAmountEl) return;

    const cart = window.posCart || [];
    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const cash = parseFloat(cashInput?.value || '0');

    if (totalAmount === 0 || isNaN(cash) || cash === 0) {
      changeAmountEl.innerText = '0.00 บาท';
      changeAmountEl.style.color = 'var(--text-muted)';
      if (changeBanner) {
        changeBanner.style.borderColor = 'var(--border)';
        changeBanner.style.background = 'rgba(255, 255, 255, 0.04)';
      }
      return;
    }

    const change = cash - totalAmount;
    const changeStr = typeof formatNumber === 'function' ? formatNumber(Math.abs(change)) : Math.abs(change).toLocaleString('th-TH', { minimumFractionDigits: 2 });

    if (change >= 0) {
      changeAmountEl.innerText = `+${changeStr} บาท`;
      changeAmountEl.style.color = '#22c55e';
      if (changeBanner) {
        changeBanner.style.borderColor = 'rgba(34, 197, 94, 0.4)';
        changeBanner.style.background = 'rgba(34, 197, 94, 0.1)';
      }
    } else {
      changeAmountEl.innerText = `⚠️ ขาดอีก ${changeStr} บาท`;
      changeAmountEl.style.color = '#ef4444';
      if (changeBanner) {
        changeBanner.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        changeBanner.style.background = 'rgba(239, 68, 68, 0.1)';
      }
    }
  }

  function setQuickCash(preset) {
    const cashInput = document.getElementById('pos-cash-received');
    if (!cashInput) return;

    const cart = window.posCart || [];
    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    if (preset === 'exact') {
      cashInput.value = totalAmount > 0 ? totalAmount.toFixed(2) : '0';
    } else {
      cashInput.value = Number(preset).toFixed(2);
    }

    calculatePosChange();
  }

  // ==========================================
  // 7. SUBMIT SALE & DEDUCT STOCK
  // ==========================================

  async function submitPosSale() {
    const cart = window.posCart || [];
    if (cart.length === 0) {
      if (typeof showToast === 'function') showToast('กรุณาเลือกสินค้าใส่ตะกร้าก่อนบันทึกการขาย', 'warning');
      return;
    }

    const totalAmount = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const cashInput = document.getElementById('pos-cash-received');
    const cash = parseFloat(cashInput?.value || '0');

    if (isNaN(cash) || cash < totalAmount) {
      const deficit = totalAmount - (isNaN(cash) ? 0 : cash);
      const defStr = typeof formatNumber === 'function' ? formatNumber(deficit) : deficit.toFixed(2);
      if (typeof showToast === 'function') {
        showToast(`ยอดเงินสดที่รับมาไม่เพียงพอ (ยังขาดอีก ${defStr} บาท)`, 'warning');
      }
      if (cashInput) cashInput.focus();
      return;
    }

    const changeAmount = Math.max(0, cash - totalAmount);

    // Customer & Member resolution
    let memberCode = '';
    let customerName = 'ลูกค้าทั่วไป';
    if (window.selectedPosMember) {
      memberCode = window.selectedPosMember.code || '';
      customerName = window.selectedPosMember.name || 'สมาชิก';
    } else {
      const customNameInput = document.getElementById('pos-custom-customer-name');
      const val = (customNameInput?.value || '').trim();
      if (val) customerName = val;
    }

    // Cashier / User resolution
    let creatorName = 'ผู้ดูแลระบบ';
    if (typeof currentUser !== 'undefined' && currentUser) {
      creatorName = currentUser.display_name || currentUser.username || 'ผู้ดูแลระบบ';
    }

    if (typeof showLoading === 'function') showLoading();

    try {
      const now = new Date();
      const isDesktop = typeof isDesktopApp === 'function' && isDesktopApp() && window.desktopDB;
      const isOnline = typeof sb !== 'undefined' && sb && (typeof isAppOffline !== 'function' || !isAppOffline());

      // 1. Generate Receipt No: INV-YYYYMMDD-XXXX
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const datePrefix = `INV-${yyyy}${mm}${dd}`;

      let seqNo = 1;
      if (isDesktop) {
        try {
          const countRes = await window.desktopDB.query(
            "SELECT COUNT(*) as cnt FROM store_transactions WHERE receipt_no LIKE ?",
            [`${datePrefix}-%`]
          );
          if (countRes && countRes[0] && countRes[0].cnt) {
            seqNo = countRes[0].cnt + 1;
          }
        } catch (e) {}
      } else if (isOnline) {
        try {
          const { count } = await sb.from('store_transactions')
            .select('*', { count: 'exact', head: true })
            .ilike('receipt_no', `${datePrefix}-%`);
          if (count) seqNo = count + 1;
        } catch (e) {}
      }

      const receiptNo = `${datePrefix}-${String(seqNo).padStart(4, '0')}`;

      // 2. Prepare items snapshot
      const cartItemsSnapshot = cart.map(i => ({
        product_id: i.product_id,
        name: i.name,
        unit: i.unit,
        cost_price: i.cost_price,
        price: i.price,
        quantity: i.quantity,
        total: (i.price * i.quantity)
      }));

      const txPayload = {
        receipt_no: receiptNo,
        member_code: memberCode,
        customer_name: customerName,
        total_amount: totalAmount,
        cash_received: cash,
        change_amount: changeAmount,
        items: JSON.stringify(cartItemsSnapshot),
        payment_method: 'cash',
        created_by_name: creatorName,
        created_at: now.toISOString()
      };

      let insertedTxId = null;

      // 3. Deduct Stock for each item & save transaction
      if (isDesktop) {
        // A. Insert store transaction locally
        const inserted = await window.desktopDB.insert('store_transactions', txPayload);
        if (inserted && inserted.id) {
          insertedTxId = inserted.id;
          await window.desktopDB.insert('sync_queue', {
            table_name: 'store_transactions',
            action: 'INSERT',
            row_data: JSON.stringify(txPayload),
            local_id: inserted.id
          });
        }

        // B. Deduct stock in SQLite & sync_queue
        for (const item of cart) {
          const prod = (window.currentStoreProducts || []).find(p => String(p.id) === String(item.product_id));
          if (prod) {
            const newStock = Math.max(0, (parseInt(prod.stock_quantity || 0, 10) - item.quantity));
            await window.desktopDB.update('store_products', { stock_quantity: newStock }, { id: prod.id });
            await window.desktopDB.insert('sync_queue', {
              table_name: 'store_products',
              action: 'UPDATE',
              row_data: JSON.stringify({ name: prod.name, stock_quantity: newStock }),
              local_id: Number(prod.id)
            });
            prod.stock_quantity = newStock;

            // Direct cloud stock deduction if online
            if (isOnline && prod.supabase_id) {
              try {
                await sb.from('store_products').update({ stock_quantity: newStock }).eq('id', prod.supabase_id);
              } catch (e) {}
            }
          }
        }

        // C. Direct cloud transaction insert if online
        if (isOnline && insertedTxId) {
          try {
            const { data: cloudRes } = await sb.from('store_transactions').insert({
              ...txPayload,
              items: cartItemsSnapshot
            }).select().single();
            if (cloudRes && cloudRes.id) {
              await window.desktopDB.update('store_transactions', { synced: 1, supabase_id: String(cloudRes.id) }, { id: insertedTxId });
            }
          } catch (cloudErr) {
            console.warn('Store sale cloud sync deferred to queue:', cloudErr);
          }
        }

      } else if (isOnline) {
        // Web Mode: Insert to Supabase directly
        const { data: cloudTx, error: txErr } = await sb.from('store_transactions').insert({
          ...txPayload,
          items: cartItemsSnapshot
        }).select().single();
        if (txErr) throw txErr;
        if (cloudTx) insertedTxId = cloudTx.id;

        // Deduct stock in Supabase
        for (const item of cart) {
          const prod = (window.currentStoreProducts || []).find(p => String(p.id) === String(item.product_id));
          if (prod) {
            const newStock = Math.max(0, (parseInt(prod.stock_quantity || 0, 10) - item.quantity));
            await sb.from('store_products').update({ stock_quantity: newStock }).eq('id', prod.id);
            prod.stock_quantity = newStock;
          }
        }
      }

      const receiptTx = {
        id: insertedTxId || Date.now(),
        receipt_no: receiptNo,
        member_code: memberCode,
        customer_name: customerName,
        total_amount: totalAmount,
        cash_received: cash,
        change_amount: changeAmount,
        items: cartItemsSnapshot,
        payment_method: 'cash',
        created_by_name: creatorName,
        created_at: now.toISOString()
      };

      if (typeof showToast === 'function') {
        showToast(`✅ บันทึกการขายสำเร็จ! เลขที่ ${receiptNo}`, 'success');
      }

      // Open store receipt modal for dual-copy printing
      openStoreReceiptModal(receiptTx);

      // Reset cart and reload catalog
      clearPosCart();
      renderPosProducts();

    } catch (err) {
      console.error('submitPosSale error:', err);
      if (typeof showToast === 'function') {
        showToast('เกิดข้อผิดพลาดในการบันทึกการขาย: ' + err.message, 'error');
      }
    } finally {
      if (typeof hideLoading === 'function') hideLoading();
    }
  }

  // ==========================================
  // 8. DUAL-COPY A4 STORE RECEIPT
  // ==========================================

  function buildStoreReceiptCopyHTML(tx, plantName) {
    const plantAddress = (typeof cachedSettings !== 'undefined' && cachedSettings?.plantation_address)
      || localStorage.getItem('setting_plantation_address')
      || 'เลขที่ 127 หมู่7 ต.ท่าสะแก อ.ชาติตระการ จ.พิษณุโลก';

    // Format date: e.g. "8 ต.ค. 69 15:30 น."
    const d = new Date(tx.created_at || Date.now());
    const monthNamesShort = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const day = d.getDate();
    const month = monthNamesShort[d.getMonth()];
    const yearShort = (d.getFullYear() + 543).toString().substring(2);
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    const dateFormattedStr = `${day} ${month} ${yearShort} ${hours}:${mins} น.`;

    // Member code format: e.g. ก00023
    let memberCodeFormatted = '-';
    if (tx.member_code) {
      memberCodeFormatted = String(tx.member_code);
      if (!memberCodeFormatted.startsWith('ก')) {
        memberCodeFormatted = 'ก' + memberCodeFormatted.padStart(5, '0');
      }
    }

    // Items parsing
    let itemsArr = [];
    if (Array.isArray(tx.items)) {
      itemsArr = tx.items;
    } else if (typeof tx.items === 'string') {
      try { itemsArr = JSON.parse(tx.items); } catch(e){}
    }

    const itemsRowsHtml = itemsArr.map((item, idx) => {
      const priceText = typeof formatNumber === 'function' ? formatNumber(item.price) : Number(item.price || 0).toFixed(2);
      const totalText = typeof formatNumber === 'function' ? formatNumber(item.total || (item.price * item.quantity)) : Number(item.total || 0).toFixed(2);
      return `
        <tr>
          <td style="border: 1px solid #000; padding: 2px 4px; text-align: center; font-size: 11.5px;">${idx + 1}</td>
          <td style="border: 1px solid #000; padding: 2px 6px; font-weight: bold; font-size: 12px;">${escapeHTML(item.name)}</td>
          <td style="border: 1px solid #000; padding: 2px 4px; text-align: right; font-size: 12px; white-space: nowrap;">${formatStock(item.quantity)} ${escapeHTML(item.unit || 'ชิ้น')}</td>
          <td style="border: 1px solid #000; padding: 2px 4px; text-align: right; font-size: 12px;">${priceText}</td>
          <td style="border: 1px solid #000; padding: 2px 6px; text-align: right; font-weight: bold; font-size: 12px;">${totalText}</td>
        </tr>
      `;
    }).join('');

    const totalAmtText = typeof formatNumber === 'function' ? formatNumber(tx.total_amount) : Number(tx.total_amount || 0).toFixed(2);
    const cashText = typeof formatNumber === 'function' ? formatNumber(tx.cash_received) : Number(tx.cash_received || 0).toFixed(2);
    const changeText = typeof formatNumber === 'function' ? formatNumber(tx.change_amount) : Number(tx.change_amount || 0).toFixed(2);
    const cashierName = tx.created_by_name || 'ผู้ดูแลระบบ';

    return `
      <div class="receipt-single-copy" style="font-family:'Sarabun','TH Sarabun New',sans-serif; color:#000; padding:8px 14px; background:#fff; font-size:12.5px; line-height:1.3; border:1px solid #000; margin-bottom:4px; box-sizing:border-box;">
        <!-- Header -->
        <div style="text-align:center; margin-bottom:4px; border-bottom:1.5px solid #000; padding-bottom:3px;">
          <div style="font-size:16px; font-weight:900; color:#000; letter-spacing:0.5px;">${plantName}</div>
          <div style="font-size:11px; color:#222; margin-top:1px;">${plantAddress}</div>
          <div style="font-size:12.5px; font-weight:bold; color:#000; margin-top:2px; text-decoration:underline;">ใบเสร็จรับเงิน / ใบส่งสินค้า (ร้านค้าสหกรณ์ & เคมีภัณฑ์)</div>
        </div>

        <!-- Meta Info Table (2 Columns) -->
        <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:4px;">
          <tr>
            <td style="width:85px; font-weight:bold; padding:1px 0;">เลขที่ใบเสร็จ:</td>
            <td style="border-bottom:1px dotted #000; font-weight:bold; font-size:12.5px;">${escapeHTML(tx.receipt_no || '-')}</td>
            <td style="width:55px; font-weight:bold; padding:1px 0 1px 12px;">วันที่:</td>
            <td style="border-bottom:1px dotted #000; font-size:12px;">${dateFormattedStr}</td>
          </tr>
          <tr>
            <td style="font-weight:bold; padding:1px 0;">ชื่อผู้ซื้อ:</td>
            <td style="border-bottom:1px dotted #000; font-weight:900; font-size:12.5px;">${escapeHTML(tx.customer_name || 'ลูกค้าทั่วไป')}</td>
            <td style="font-weight:bold; padding:1px 0 1px 12px;">รหัสสมาชิก:</td>
            <td style="border-bottom:1px dotted #000; font-weight:bold; font-size:12.5px;">${memberCodeFormatted}</td>
          </tr>
        </table>

        <!-- Items Table -->
        <table style="width:100%; border-collapse:collapse; font-size:11.5px; margin-bottom:4px; border:1px solid #000;">
          <thead>
            <tr style="background:#f4f4f4; border-bottom:1px solid #000;">
              <th style="border:1px solid #000; padding:2px 4px; width:28px; text-align:center;">ลำดับ</th>
              <th style="border:1px solid #000; padding:2px 6px; text-align:left;">รายการสินค้า</th>
              <th style="border:1px solid #000; padding:2px 4px; width:65px; text-align:right;">จำนวน</th>
              <th style="border:1px solid #000; padding:2px 4px; width:65px; text-align:right;">ราคา/หน่วย</th>
              <th style="border:1px solid #000; padding:2px 6px; width:75px; text-align:right;">จำนวนเงิน</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRowsHtml}
          </tbody>
          <tfoot>
            <tr style="border-top:1.5px solid #000; font-weight:bold;">
              <td colspan="4" style="border:1px solid #000; padding:3px 6px; text-align:right; font-size:12.5px;">💰 รวมเป็นเงินทั้งสิ้น:</td>
              <td style="border:1px solid #000; padding:3px 6px; text-align:right; font-size:13.5px; font-weight:900;">${totalAmtText} ฿</td>
            </tr>
            <tr>
              <td colspan="4" style="border:1px solid #000; padding:1px 6px; text-align:right; font-size:11.5px;">รับเงินสด:</td>
              <td style="border:1px solid #000; padding:1px 6px; text-align:right; font-size:11.5px;">${cashText} ฿</td>
            </tr>
            <tr>
              <td colspan="4" style="border:1px solid #000; padding:1px 6px; text-align:right; font-size:11.5px;">เงินทอน:</td>
              <td style="border:1px solid #000; padding:1px 6px; text-align:right; font-size:11.5px; font-weight:bold;">${changeText} ฿</td>
            </tr>
          </tfoot>
        </table>

        <!-- Signatures Footer -->
        <div style="margin-top:6px; display:grid; grid-template-columns:1fr 1fr; gap:20px; text-align:center; font-size:11px;">
          <div>
            <div style="border-bottom:1px solid #000; height:16px;"></div>
            <div style="font-weight:bold; margin-top:2px;">ผู้รับเงิน / พนักงานขาย (${escapeHTML(cashierName)})</div>
          </div>
          <div>
            <div style="border-bottom:1px solid #000; height:16px;"></div>
            <div style="font-weight:bold; margin-top:2px;">ผู้รับสินค้า / ลูกค้า (${escapeHTML(tx.customer_name || 'ลูกค้า')})</div>
          </div>
        </div>
      </div>
    `;
  }

  function openStoreReceiptModal(tx) {
    window.currentStoreReceiptTx = tx;
    const modal = document.getElementById('store-receipt-modal');
    const content = document.getElementById('store-receipt-content');
    if (!modal || !content) return;

    const plantName = (typeof cachedSettings !== 'undefined' && cachedSettings?.plantation_name)
      || localStorage.getItem('setting_plantation_name')
      || 'กลุ่มเกษตรกรชาวสวนยาง กยท.ท่าสะแก';

    const copy1 = buildStoreReceiptCopyHTML(tx, plantName);
    const copy2 = buildStoreReceiptCopyHTML(tx, plantName);
    const cutLine = `<div class="receipt-cut-line" style="text-align:center; font-size:11px; margin:4px 0; color:#222; font-weight:bold;">✂️ ----------------------------------------------------------------------------------------------------</div>`;

    content.innerHTML = `
      ${copy1}
      ${cutLine}
      ${copy2}
    `;

    modal.classList.add('show');
  }

  function closeStoreReceiptModal() {
    const modal = document.getElementById('store-receipt-modal');
    if (modal) modal.classList.remove('show');
  }

  function printStoreReceipt(tx = null) {
    const targetTx = tx || window.currentStoreReceiptTx;
    if (!targetTx) return;

    const plantName = (typeof cachedSettings !== 'undefined' && cachedSettings?.plantation_name)
      || localStorage.getItem('setting_plantation_name')
      || 'กลุ่มเกษตรกรชาวสวนยาง กยท.ท่าสะแก';

    const copy1 = buildStoreReceiptCopyHTML(targetTx, plantName);
    const copy2 = buildStoreReceiptCopyHTML(targetTx, plantName);

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="th">
      <head>
        <meta charset="UTF-8">
        <title>ใบเสร็จรับเงินร้านค้า - ${targetTx.receipt_no || ''}</title>
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
            padding: 8px 14px;
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

    // Print iframe
    let printFrame = document.getElementById('store-receipt-print-iframe');
    if (!printFrame) {
      printFrame = document.createElement('iframe');
      printFrame.id = 'store-receipt-print-iframe';
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

    closeStoreReceiptModal();

    setTimeout(() => {
      printFrame.contentWindow.focus();
      printFrame.contentWindow.print();
    }, 200);
  }

  // ==========================================
  // 9. SALES HISTORY & MEMBER PURCHASES
  // ==========================================

  async function renderStoreSalesHistory() {
    if (typeof showLoading === 'function') showLoading();

    try {
      let sales = [];
      const isDesktop = typeof isDesktopApp === 'function' && isDesktopApp() && window.desktopDB;
      const isOnline = typeof sb !== 'undefined' && sb && (typeof isAppOffline !== 'function' || !isAppOffline());

      if (isDesktop) {
        sales = await window.desktopDB.select('store_transactions', ['*']);
        sales = sales || [];
      } else if (isOnline) {
        const { data, error } = await sb.from('store_transactions').select('*').order('created_at', { ascending: false });
        if (!error && data) sales = data;
      }

      // Sort newest first
      sales.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      window.currentStoreSalesHistory = sales;

      // Populate Member Filter dropdown
      populateStoreMemberFilter(sales);

      // Render table & KPIs
      filterStoreSalesHistory();

    } catch (err) {
      console.error('renderStoreSalesHistory error:', err);
    } finally {
      if (typeof hideLoading === 'function') hideLoading();
    }
  }

  function populateStoreMemberFilter(sales) {
    const filterEl = document.getElementById('store-history-member-filter');
    if (!filterEl) return;

    // Collect all member codes from sales
    const memberMap = new Map();
    sales.forEach(s => {
      if (s.member_code) {
        memberMap.set(String(s.member_code), s.customer_name || `สมาชิก ${s.member_code}`);
      }
    });

    const currentVal = filterEl.value;
    let html = `
      <option value="">-- ทั้งหมด (ทุกสมาชิก / ลูกค้าทั่วไป) --</option>
      <option value="GUEST">-- ลูกค้าทั่วไป (ไม่ระบุสมาชิก) --</option>
    `;

    // Sort member codes
    const sortedCodes = Array.from(memberMap.keys()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    sortedCodes.forEach(code => {
      let formattedCode = code;
      if (!formattedCode.startsWith('ก')) formattedCode = 'ก' + formattedCode.padStart(5, '0');
      html += `<option value="${code}">[${formattedCode}] ${escapeHTML(memberMap.get(code))}</option>`;
    });

    filterEl.innerHTML = html;
    if (currentVal) filterEl.value = currentVal;
  }

  function filterStoreSalesHistory() {
    const memberFilter = document.getElementById('store-history-member-filter')?.value || '';
    const searchText = (document.getElementById('store-history-search')?.value || '').trim().toLowerCase();
    const dateFilter = document.getElementById('store-history-date-filter')?.value || '';

    const allSales = window.currentStoreSalesHistory || [];

    const filtered = allSales.filter(tx => {
      // 1. Member filter
      if (memberFilter === 'GUEST') {
        if (tx.member_code) return false;
      } else if (memberFilter) {
        if (String(tx.member_code) !== String(memberFilter)) return false;
      }

      // 2. Search text
      if (searchText) {
        const rc = (tx.receipt_no || '').toLowerCase();
        const cn = (tx.customer_name || '').toLowerCase();
        const mc = (tx.member_code || '').toLowerCase();
        if (!rc.includes(searchText) && !cn.includes(searchText) && !mc.includes(searchText)) {
          return false;
        }
      }

      // 3. Date filter (YYYY-MM-DD)
      if (dateFilter) {
        const txDate = (tx.created_at || '').substring(0, 10);
        if (txDate !== dateFilter) return false;
      }

      return true;
    });

    // Update KPI Cards
    let totalAmt = 0;
    let totalBills = filtered.length;
    let totalItems = 0;

    filtered.forEach(tx => {
      totalAmt += parseFloat(tx.total_amount || 0);
      let items = [];
      if (Array.isArray(tx.items)) items = tx.items;
      else if (typeof tx.items === 'string') {
        try { items = JSON.parse(tx.items); } catch(e){}
      }
      items.forEach(i => totalItems += parseInt(i.quantity || 0, 10));
    });

    const kpiAmt = document.getElementById('store-kpi-total-amount');
    const kpiBills = document.getElementById('store-kpi-total-bills');
    const kpiItems = document.getElementById('store-kpi-total-items');

    if (kpiAmt) kpiAmt.innerText = (typeof formatNumber === 'function' ? formatNumber(totalAmt) : totalAmt.toFixed(2)) + ' ฿';
    if (kpiBills) kpiBills.innerText = `${totalBills} บิล`;
    if (kpiItems) kpiItems.innerText = `${formatStock(totalItems)} ชิ้น`;

    // Member Specific Banner
    const banner = document.getElementById('store-history-member-banner');
    const bannerCode = document.getElementById('store-history-member-banner-code');
    const bannerName = document.getElementById('store-history-member-banner-name');
    const bannerTotal = document.getElementById('store-history-member-banner-total');
    const bannerCount = document.getElementById('store-history-member-banner-count');

    if (memberFilter && memberFilter !== 'GUEST' && banner) {
      banner.style.display = 'block';
      let formattedCode = memberFilter;
      if (!formattedCode.startsWith('ก')) formattedCode = 'ก' + formattedCode.padStart(5, '0');
      if (bannerCode) bannerCode.innerText = formattedCode;
      
      const firstMatch = filtered.find(t => String(t.member_code) === String(memberFilter));
      if (bannerName) bannerName.innerText = firstMatch ? firstMatch.customer_name : 'สมาชิก';
      if (bannerTotal) bannerTotal.innerText = (typeof formatNumber === 'function' ? formatNumber(totalAmt) : totalAmt.toFixed(2)) + ' บาท';
      if (bannerCount) bannerCount.innerText = totalBills;
    } else if (banner) {
      banner.style.display = 'none';
    }

    renderStoreSalesHistoryTable(filtered);
  }

  function renderStoreSalesHistoryTable(sales) {
    const tableBody = document.getElementById('store-history-table-body');
    const emptyState = document.getElementById('store-history-empty');
    const tableContainer = document.getElementById('store-history-table-container');
    if (!tableBody) return;

    if (!sales || sales.length === 0) {
      tableBody.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      if (tableContainer) tableContainer.style.display = 'none';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (tableContainer) tableContainer.style.display = 'block';

    tableBody.innerHTML = sales.map((tx, idx) => {
      const d = new Date(tx.created_at || Date.now());
      const dateText = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear() + 543} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

      // Customer badge
      let customerHtml = escapeHTML(tx.customer_name || 'ลูกค้าทั่วไป');
      if (tx.member_code) {
        let code = String(tx.member_code);
        if (!code.startsWith('ก')) code = 'ก' + code.padStart(5, '0');
        customerHtml = `<span class="badge badge-green" style="font-size:0.75rem; margin-right:4px;">${code}</span> ${escapeHTML(tx.customer_name || '')}`;
      }

      // Items summary string
      let itemsArr = [];
      if (Array.isArray(tx.items)) itemsArr = tx.items;
      else if (typeof tx.items === 'string') {
        try { itemsArr = JSON.parse(tx.items); } catch(e){}
      }
      const itemsSummary = itemsArr.map(i => `${i.name} (${formatStock(i.quantity)} ${i.unit || 'ชิ้น'})`).join(', ');

      const totalAmtStr = typeof formatNumber === 'function' ? formatNumber(tx.total_amount) : Number(tx.total_amount || 0).toFixed(2);

      return `
        <tr>
          <td style="text-align: center; color: var(--text-muted); font-size: 0.85rem;">${idx + 1}</td>
          <td style="font-size: 0.85rem; color: var(--text-secondary); white-space: nowrap;">${dateText}</td>
          <td style="font-weight: 600; color: var(--text-primary); font-family: monospace; font-size: 0.88rem;">${escapeHTML(tx.receipt_no || '-')}</td>
          <td style="font-weight: 600; color: var(--text-primary);">${customerHtml}</td>
          <td style="font-size: 0.85rem; color: var(--text-secondary); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHTML(itemsSummary)}">${escapeHTML(itemsSummary)}</td>
          <td style="text-align: right; font-weight: 700; color: var(--gold); font-size: 0.95rem;">${totalAmtStr} ฿</td>
          <td style="font-size: 0.82rem; color: var(--text-muted);">${escapeHTML(tx.created_by_name || '-')}</td>
          <td style="text-align: center; white-space: nowrap;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="viewStoreReceiptFromHistory('${tx.id}')" style="padding: 4px 10px; font-size: 0.82rem; margin-right: 4px;" title="ดูใบเสร็จ / สั่งพิมพ์">
              👁️ บิล
            </button>
            <button type="button" class="btn btn-danger btn-sm" onclick="confirmDeleteStoreSale('${tx.id}')" style="padding: 4px 10px; font-size: 0.82rem;" title="ลบบิลขายและคืนสต็อกสินค้า">
              🗑️ ลบ
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function viewStoreReceiptFromHistory(txId) {
    if (!txId) return;
    const tx = (window.currentStoreSalesHistory || []).find(t => String(t.id) === String(txId));
    if (tx) {
      openStoreReceiptModal(tx);
    }
  }

  function confirmDeleteStoreSale(txId) {
    if (!txId) return;
    const tx = (window.currentStoreSalesHistory || []).find(t => String(t.id) === String(txId));
    if (!tx) return;

    let itemsArr = [];
    if (Array.isArray(tx.items)) itemsArr = tx.items;
    else if (typeof tx.items === 'string') {
      try { itemsArr = JSON.parse(tx.items); } catch(e){}
    }
    const itemsCount = itemsArr.length;
    const receiptNo = tx.receipt_no || 'ไม่ระบุเลขที่';
    const custName = tx.customer_name || 'ลูกค้าทั่วไป';
    const totalAmt = typeof formatNumber === 'function' ? formatNumber(tx.total_amount) : Number(tx.total_amount || 0).toFixed(2);

    const confirmModal = document.getElementById('confirm-modal');
    const confirmMessage = document.getElementById('confirm-message');
    const confirmActionBtn = document.getElementById('confirm-action-btn');

    const msgHtml = `
      <span class="confirm-icon" style="color:var(--danger, #ef4444);">🗑️</span>
      <strong style="font-size:1.05rem;">ต้องการลบบิลขายเลขที่ ${escapeHTML(receiptNo)} ใช่หรือไม่?</strong><br><br>
      <div style="text-align:left; background:var(--bg-input, #f3f4f6); padding:10px 14px; border-radius:8px; font-size:0.85rem; line-height:1.6; margin-bottom:8px;">
        <div>👤 <strong>ลูกค้า:</strong> ${escapeHTML(custName)}</div>
        <div>💰 <strong>ยอดเงิน:</strong> <span style="color:var(--gold, #d97706); font-weight:700;">${totalAmt} ฿</span></div>
        <div>📦 <strong>สินค้า:</strong> ${itemsCount} รายการ <small style="color:var(--text-muted);">(ระบบจะคืนสต็อกสินค้ากลับเข้าคลังให้อัตโนมัติ)</small></div>
      </div>
      <span style="font-size:0.82rem; color:var(--danger, #ef4444);">⚠️ เมื่อลบแล้ว ยอดขายจะถูกหักออก และจำนวนสต็อกจะถูกเพิ่มกลับเข้าคลังทันที</span>
    `;

    if (confirmModal && confirmMessage && confirmActionBtn) {
      confirmMessage.innerHTML = msgHtml;
      confirmActionBtn.innerHTML = '🗑️ ยืนยันการลบและคืนสต็อก';
      confirmActionBtn.className = 'btn btn-danger';
      confirmActionBtn.onclick = () => deleteStoreSale(txId);
      confirmModal.classList.add('show');
    } else {
      if (confirm(`ต้องการลบบิลขายเลขที่ ${receiptNo} ยอด ${totalAmt} บาท ใช่หรือไม่?\n(ระบบจะคืนสต็อกสินค้ากลับเข้าคลังให้อัตโนมัติ)`)) {
        deleteStoreSale(txId);
      }
    }
  }

  async function deleteStoreSale(txId) {
    if (!txId) return;
    const confirmModal = document.getElementById('confirm-modal');
    if (confirmModal) confirmModal.classList.remove('show');

    const tx = (window.currentStoreSalesHistory || []).find(t => String(t.id) === String(txId));
    if (!tx) return;

    if (typeof showLoading === 'function') showLoading();

    try {
      const isDesktop = typeof isDesktopApp === 'function' && isDesktopApp() && window.desktopDB;
      const isOnline = typeof sb !== 'undefined' && sb && (typeof isAppOffline !== 'function' || !isAppOffline());

      // Parse items to restore stock
      let itemsArr = [];
      if (Array.isArray(tx.items)) itemsArr = tx.items;
      else if (typeof tx.items === 'string') {
        try { itemsArr = JSON.parse(tx.items); } catch(e){}
      }

      // 1. Restore Stock for each product
      for (const item of itemsArr) {
        const qtyToRestore = parseFloat(item.quantity) || 0;
        if (qtyToRestore <= 0) continue;

        let prod = (window.currentStoreProducts || []).find(p => 
          (item.product_id && String(p.id) === String(item.product_id)) || 
          (p.name && item.name && p.name.trim() === item.name.trim())
        );

        if (isDesktop) {
          let currentStock = prod ? parseFloat(prod.stock_quantity || 0) : 0;
          let prodId = prod ? prod.id : null;
          let prodSupabaseId = prod ? prod.supabase_id : null;
          let prodName = prod ? prod.name : item.name;

          if (!prodId) {
            try {
              const dbProd = await window.desktopDB.get("SELECT id, name, stock_quantity, supabase_id FROM store_products WHERE name = ?", [item.name]);
              if (dbProd) {
                prodId = dbProd.id;
                currentStock = parseFloat(dbProd.stock_quantity || 0);
                prodSupabaseId = dbProd.supabase_id;
                prodName = dbProd.name;
              }
            } catch (e) {}
          }

          if (prodId) {
            const newStock = currentStock + qtyToRestore;
            await window.desktopDB.update('store_products', { stock_quantity: newStock }, { id: prodId });
            await window.desktopDB.insert('sync_queue', {
              table_name: 'store_products',
              action: 'UPDATE',
              row_data: JSON.stringify({ name: prodName, stock_quantity: newStock }),
              local_id: Number(prodId)
            });
            if (prod) prod.stock_quantity = newStock;

            if (isOnline && prodSupabaseId) {
              try {
                await sb.from('store_products').update({ stock_quantity: newStock }).eq('id', prodSupabaseId);
              } catch (e) {}
            }
          }
        } else if (isOnline) {
          try {
            let prodQuery = sb.from('store_products').select('id, stock_quantity');
            if (item.product_id) prodQuery = prodQuery.eq('id', item.product_id);
            else prodQuery = prodQuery.eq('name', item.name);
            const { data: dbProds } = await prodQuery.limit(1);
            if (dbProds && dbProds.length > 0) {
              const p = dbProds[0];
              const newStock = (parseFloat(p.stock_quantity) || 0) + qtyToRestore;
              await sb.from('store_products').update({ stock_quantity: newStock }).eq('id', p.id);
            }
          } catch (e) {}
        }
      }

      // 2. Delete the store transaction
      if (isDesktop) {
        await window.desktopDB.delete('store_transactions', { id: tx.id });
        
        const cloudId = tx.supabase_id;
        if (cloudId) {
          await window.desktopDB.insert('sync_queue', {
            table_name: 'store_transactions',
            action: 'DELETE',
            row_data: JSON.stringify({ id: cloudId, supabase_id: cloudId, receipt_no: tx.receipt_no }),
            local_id: Number(tx.id)
          });
          if (isOnline) {
            try {
              await sb.from('store_transactions').delete().eq('id', cloudId);
            } catch (e) {}
          }
        }
      } else if (isOnline) {
        await sb.from('store_transactions').delete().eq('id', tx.id);
      }

      // 3. Update memory list & re-render
      window.currentStoreSalesHistory = (window.currentStoreSalesHistory || []).filter(t => String(t.id) !== String(txId));
      filterStoreSalesHistory();
      if (typeof renderStoreProducts === 'function') await renderStoreProducts();
      if (typeof renderPosProducts === 'function') renderPosProducts();

      if (typeof showToast === 'function') {
        showToast('🗑️ ลบบิลขายและคืนสต็อกสินค้าเรียบร้อยแล้ว!', 'success');
      }

    } catch (err) {
      console.error('deleteStoreSale error:', err);
      if (typeof showToast === 'function') {
        showToast('เกิดข้อผิดพลาดในการลบบิล: ' + err.message, 'error');
      }
    } finally {
      if (typeof hideLoading === 'function') hideLoading();
    }
  }

  // ==========================================
  // 10. EXISTING INVENTORY FUNCTIONS (PRESERVED)
  // ==========================================

  function calculateProductProfit() {
    const costInput = document.getElementById('product-cost-input');
    const priceInput = document.getElementById('product-price-input');
    const unitInput = document.getElementById('product-unit-input');
    const previewEl = document.getElementById('product-profit-preview');
    const textEl = document.getElementById('product-profit-text');

    if (!previewEl || !textEl) return;

    const cost = parseFloat(costInput?.value || '0');
    const price = parseFloat(priceInput?.value || '0');
    const unit = (unitInput?.value || 'ชิ้น').trim() || 'ชิ้น';

    if (isNaN(price) || price <= 0) {
      textEl.innerText = '+0.00 บาท (+0.0%)';
      textEl.style.color = 'var(--text-muted)';
      previewEl.style.borderColor = 'rgba(255, 255, 255, 0.15)';
      previewEl.style.background = 'rgba(255, 255, 255, 0.03)';
      return;
    }

    const profit = price - (isNaN(cost) ? 0 : cost);
    const marginPercent = cost > 0 ? ((profit / cost) * 100).toFixed(1) : '100.0';
    const profitText = (typeof formatNumber === 'function' ? formatNumber(profit) : profit.toFixed(2));

    if (profit > 0) {
      textEl.innerText = `+${profitText} บาท / ${escapeHTML(unit)} (+${marginPercent}%)`;
      textEl.style.color = '#22c55e';
      previewEl.style.borderColor = 'rgba(34, 197, 94, 0.4)';
      previewEl.style.background = 'rgba(34, 197, 94, 0.1)';
    } else if (profit === 0) {
      textEl.innerText = `0.00 บาท (เท่าทุน)`;
      textEl.style.color = 'var(--text-secondary)';
      previewEl.style.borderColor = 'rgba(255, 255, 255, 0.2)';
      previewEl.style.background = 'rgba(255, 255, 255, 0.05)';
    } else {
      textEl.innerText = `⚠️ ขาดทุน ${(typeof formatNumber === 'function' ? formatNumber(Math.abs(profit)) : Math.abs(profit).toFixed(2))} บาท / ${escapeHTML(unit)}`;
      textEl.style.color = '#ef4444';
      previewEl.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      previewEl.style.background = 'rgba(239, 68, 68, 0.1)';
    }
  }

  async function renderStoreProducts() {
    const tableBody = document.getElementById('store-products-table-body');
    if (!tableBody) return;

    if (typeof showLoading === 'function') showLoading();

    try {
      const products = await loadStoreProductsData();
      renderStoreProductTable(products);
    } catch (err) {
      console.error('renderStoreProducts error:', err);
    } finally {
      if (typeof hideLoading === 'function') hideLoading();
    }
  }

  function filterStoreProducts(query) {
    const q = (query || '').trim().toLowerCase();
    const all = window.currentStoreProducts || [];
    if (!q) {
      renderStoreProductTable(all);
      return;
    }
    const filtered = all.filter(p => {
      const name = (p.name || '').toLowerCase();
      const unit = (p.unit || '').toLowerCase();
      return name.includes(q) || unit.includes(q);
    });
    renderStoreProductTable(filtered);
  }

  function renderStoreProductTable(products) {
    const tableBody = document.getElementById('store-products-table-body');
    const emptyState = document.getElementById('store-products-empty');
    const tableContainer = document.getElementById('store-products-table-container');
    if (!tableBody) return;

    if (!products || products.length === 0) {
      tableBody.innerHTML = '';
      if (emptyState) emptyState.style.display = 'block';
      if (tableContainer) tableContainer.style.display = 'none';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (tableContainer) tableContainer.style.display = 'block';

    tableBody.innerHTML = products.map((p, idx) => {
      const isActive = (p.is_active === 1 || p.is_active === true);
      const statusBadge = isActive
        ? `<span class="badge badge-green" style="cursor:pointer; white-space:nowrap; display:inline-block; padding:4px 10px; font-size:0.8rem;" onclick="toggleProductStatus('${p.id}')" title="คลิกเพื่อสลับสถานะ">🟢 พร้อมขาย</span>`
        : `<span class="badge badge-gray" style="cursor:pointer; white-space:nowrap; display:inline-block; padding:4px 10px; font-size:0.8rem;" onclick="toggleProductStatus('${p.id}')" title="คลิกเพื่อสลับสถานะ">⚪ พักจำหน่าย</span>`;

      const unitText = p.unit || 'ชิ้น';
      const cost = parseFloat(p.cost_price || 0);
      const price = parseFloat(p.price || 0);
      const profit = price - cost;

      const costText = typeof formatNumber === 'function' ? formatNumber(cost) : cost.toLocaleString('th-TH', { minimumFractionDigits: 2 });
      const priceText = typeof formatNumber === 'function' ? formatNumber(price) : price.toLocaleString('th-TH', { minimumFractionDigits: 2 });
      const profitText = typeof formatNumber === 'function' ? formatNumber(profit) : profit.toLocaleString('th-TH', { minimumFractionDigits: 2 });
      const stockText = formatStock(p.stock_quantity);

      const profitColor = profit > 0 ? '#22c55e' : (profit === 0 ? 'var(--text-muted)' : '#ef4444');
      const profitPrefix = profit > 0 ? '+' : '';

      return `
        <tr style="${!isActive ? 'opacity: 0.65;' : ''}">
          <td style="text-align: center; color: var(--text-muted); font-size: 0.85rem;">${idx + 1}</td>
          <td style="font-weight: 600; color: var(--text-primary);">
            ${escapeHTML(p.name || '')}
          </td>
          <td style="text-align: right; color: var(--text-secondary); font-size: 0.9rem;">
            ${costText} <span style="font-size:0.78rem; color:var(--text-muted);">฿</span>
          </td>
          <td style="text-align: right; font-weight: 700; color: var(--gold);">
            ${priceText} <span style="font-size:0.78rem; font-weight:normal; color:var(--text-muted);">฿</span>
          </td>
          <td style="text-align: right; font-weight: 700; color: ${profitColor};">
            ${profitPrefix}${profitText} <span style="font-size:0.78rem; font-weight:normal; color:var(--text-muted);">฿</span>
          </td>
          <td style="text-align: right; font-weight: 700; color: var(--text-primary);">
            ${stockText} <span style="font-size:0.8rem; font-weight:normal; color:var(--text-muted);">${escapeHTML(unitText)}</span>
          </td>
          <td style="text-align: center; white-space: nowrap;">
            ${statusBadge}
          </td>
          <td style="text-align: center; white-space: nowrap;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="openProductModal('${p.id}')" style="padding: 4px 10px; font-size: 0.82rem; margin-right: 4px;">
              ✏️ แก้ไข
            </button>
            <button type="button" class="btn btn-danger btn-sm" onclick="confirmDeleteProduct('${p.id}')" style="padding: 4px 10px; font-size: 0.82rem;">
              🗑️ ลบ
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function openProductModal(productId = null) {
    editingProductId = productId ? String(productId) : null;
    const modal = document.getElementById('product-modal');
    const titleEl = document.getElementById('product-modal-title');
    const nameInput = document.getElementById('product-name-input');
    const costInput = document.getElementById('product-cost-input');
    const priceInput = document.getElementById('product-price-input');
    const stockInput = document.getElementById('product-stock-input');
    const unitInput = document.getElementById('product-unit-input');
    const activeSelect = document.getElementById('product-active-select');

    if (!modal) return;

    if (editingProductId) {
      if (titleEl) titleEl.innerText = '✏️ แก้ไขข้อมูลสินค้า';
      const prod = (window.currentStoreProducts || []).find(p => String(p.id) === editingProductId);
      if (prod) {
        if (nameInput) nameInput.value = prod.name || '';
        if (costInput) costInput.value = prod.cost_price || 0;
        if (priceInput) priceInput.value = prod.price || 0;
        if (stockInput) stockInput.value = prod.stock_quantity !== undefined ? parseFloat(prod.stock_quantity) : 0;
        if (unitInput) unitInput.value = prod.unit || 'ชิ้น';
        if (activeSelect) activeSelect.value = (prod.is_active === 1 || prod.is_active === true) ? '1' : '0';
      }
    } else {
      if (titleEl) titleEl.innerText = '➕ เพิ่มสินค้าใหม่';
      if (nameInput) nameInput.value = '';
      if (costInput) costInput.value = '';
      if (priceInput) priceInput.value = '';
      if (stockInput) stockInput.value = '0';
      if (unitInput) unitInput.value = 'กระสอบ';
      if (activeSelect) activeSelect.value = '1';
    }

    calculateProductProfit();
    modal.classList.add('show');
    if (nameInput) setTimeout(() => nameInput.focus(), 150);
  }

  function closeProductModal() {
    const modal = document.getElementById('product-modal');
    if (modal) modal.classList.remove('show');
    editingProductId = null;
  }

  async function saveProduct() {
    const nameInput = document.getElementById('product-name-input');
    const costInput = document.getElementById('product-cost-input');
    const priceInput = document.getElementById('product-price-input');
    const stockInput = document.getElementById('product-stock-input');
    const unitInput = document.getElementById('product-unit-input');
    const activeSelect = document.getElementById('product-active-select');

    const name = (nameInput?.value || '').trim();
    const costPrice = parseFloat(costInput?.value || '0') || 0;
    const price = parseFloat(priceInput?.value || '0');
    const stock = parseFloat(stockInput?.value || '0');
    const unit = (unitInput?.value || 'ชิ้น').trim() || 'ชิ้น';
    const isActive = activeSelect ? activeSelect.value === '1' : true;

    if (!name) {
      if (typeof showToast === 'function') showToast('กรุณาระบุชื่อสินค้า', 'warning');
      if (nameInput) nameInput.focus();
      return;
    }

    if (isNaN(price) || price < 0) {
      if (typeof showToast === 'function') showToast('กรุณาระบุราคาขายให้ถูกต้อง', 'warning');
      if (priceInput) priceInput.focus();
      return;
    }

    if (isNaN(stock) || stock < 0) {
      if (typeof showToast === 'function') showToast('กรุณาระบุจำนวนสต๊อกให้ถูกต้อง', 'warning');
      if (stockInput) stockInput.focus();
      return;
    }

    if (typeof showLoading === 'function') showLoading();

    try {
      const payload = {
        name,
        unit,
        cost_price: costPrice,
        price,
        stock_quantity: stock,
        is_active: isActive ? 1 : 0
      };

      const isDesktop = typeof isDesktopApp === 'function' && isDesktopApp() && window.desktopDB;
      const isOnline = typeof sb !== 'undefined' && sb && (typeof isAppOffline !== 'function' || !isAppOffline());

      if (editingProductId) {
        if (isDesktop) {
          await window.desktopDB.update('store_products', payload, { id: editingProductId });
          await window.desktopDB.insert('sync_queue', {
            table_name: 'store_products',
            action: 'UPDATE',
            row_data: JSON.stringify({ ...payload, is_active: isActive }),
            local_id: Number(editingProductId)
          });

          if (isOnline) {
            try {
              const current = (window.currentStoreProducts || []).find(p => String(p.id) === editingProductId);
              if (current && current.supabase_id) {
                await sb.from('store_products').update({ ...payload, is_active: isActive }).eq('id', current.supabase_id);
              } else {
                await sb.from('store_products').update({ ...payload, is_active: isActive }).eq('name', name);
              }
            } catch (e) {}
          }
        } else if (isOnline) {
          const { error } = await sb.from('store_products').update({ ...payload, is_active: isActive }).eq('id', editingProductId);
          if (error) throw error;
        }

        if (typeof showToast === 'function') showToast('บันทึกการแก้ไขสินค้าสำเร็จ!', 'success');
      } else {
        if (isDesktop) {
          const inserted = await window.desktopDB.insert('store_products', payload);
          if (inserted && inserted.id) {
            await window.desktopDB.insert('sync_queue', {
              table_name: 'store_products',
              action: 'INSERT',
              row_data: JSON.stringify({ ...payload, is_active: isActive }),
              local_id: inserted.id
            });
          }

          if (isOnline) {
            try {
              const { data: cloudRes } = await sb.from('store_products').insert({ ...payload, is_active: isActive }).select();
              if (cloudRes && cloudRes.length > 0 && inserted) {
                await window.desktopDB.update('store_products', { supabase_id: String(cloudRes[0].id), synced: 1 }, { id: inserted.id });
              }
            } catch (e) {}
          }
        } else if (isOnline) {
          const { error } = await sb.from('store_products').insert({ ...payload, is_active: isActive });
          if (error) throw error;
        }

        if (typeof showToast === 'function') showToast('เพิ่มสินค้าใหม่เรียบร้อยแล้ว!', 'success');
      }

      closeProductModal();
      await renderStoreProducts();
      renderPosProducts();

    } catch (err) {
      console.error('saveProduct error:', err);
      if (typeof showToast === 'function') showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
    } finally {
      if (typeof hideLoading === 'function') hideLoading();
    }
  }

  async function toggleProductStatus(productId) {
    if (!productId) return;
    const prod = (window.currentStoreProducts || []).find(p => String(p.id) === String(productId));
    if (!prod) return;

    const newStatus = !(prod.is_active === 1 || prod.is_active === true);
    if (typeof showLoading === 'function') showLoading();

    try {
      const isDesktop = typeof isDesktopApp === 'function' && isDesktopApp() && window.desktopDB;
      const isOnline = typeof sb !== 'undefined' && sb && (typeof isAppOffline !== 'function' || !isAppOffline());

      if (isDesktop) {
        await window.desktopDB.update('store_products', { is_active: newStatus ? 1 : 0 }, { id: productId });
        await window.desktopDB.insert('sync_queue', {
          table_name: 'store_products',
          action: 'UPDATE',
          row_data: JSON.stringify({ name: prod.name, is_active: newStatus }),
          local_id: Number(productId)
        });
        if (isOnline && prod.supabase_id) {
          try { await sb.from('store_products').update({ is_active: newStatus }).eq('id', prod.supabase_id); } catch(e){}
        }
      } else if (isOnline) {
        await sb.from('store_products').update({ is_active: newStatus }).eq('id', productId);
      }

      prod.is_active = newStatus ? 1 : 0;
      renderStoreProductTable(window.currentStoreProducts);
      renderPosProducts();
      if (typeof showToast === 'function') showToast(newStatus ? 'เปิดขายสินค้าแล้ว' : 'พักจำหน่ายสินค้าแล้ว', 'info');
    } catch (err) {
      console.error('toggleProductStatus error:', err);
    } finally {
      if (typeof hideLoading === 'function') hideLoading();
    }
  }

  function confirmDeleteProduct(productId) {
    if (!productId) return;
    const prod = (window.currentStoreProducts || []).find(p => String(p.id) === String(productId));
    const prodName = prod ? prod.name : 'สินค้านี้';

    const confirmModal = document.getElementById('confirm-modal');
    const confirmMessage = document.getElementById('confirm-message');
    const confirmActionBtn = document.getElementById('confirm-action-btn');

    if (confirmModal && confirmMessage && confirmActionBtn) {
      confirmMessage.innerHTML = `
        <span class="confirm-icon">⚠️</span>
        ต้องการลบสินค้า <strong>${escapeHTML(prodName)}</strong> ใช่หรือไม่?<br>
        <span style="font-size:0.85rem;color:var(--text-muted);">การลบจะไม่สามารถกู้คืนข้อมูลได้</span>
      `;
      confirmActionBtn.onclick = () => deleteProduct(productId);
      confirmModal.classList.add('show');
    } else {
      if (confirm(`ต้องการลบสินค้า "${prodName}" ใช่หรือไม่?`)) {
        deleteProduct(productId);
      }
    }
  }

  async function deleteProduct(productId) {
    if (!productId) return;
    const confirmModal = document.getElementById('confirm-modal');
    if (confirmModal) confirmModal.classList.remove('show');

    if (typeof showLoading === 'function') showLoading();

    try {
      const isDesktop = typeof isDesktopApp === 'function' && isDesktopApp() && window.desktopDB;
      const isOnline = typeof sb !== 'undefined' && sb && (typeof isAppOffline !== 'function' || !isAppOffline());
      const prod = (window.currentStoreProducts || []).find(p => String(p.id) === String(productId));

      if (isDesktop) {
        await window.desktopDB.delete('store_products', { id: productId });
        if (prod && prod.supabase_id) {
          await window.desktopDB.insert('sync_queue', {
            table_name: 'store_products',
            action: 'DELETE',
            row_data: JSON.stringify({ id: prod.supabase_id, name: prod.name }),
            local_id: Number(productId)
          });
        }
        if (isOnline && prod && prod.supabase_id) {
          try { await sb.from('store_products').delete().eq('id', prod.supabase_id); } catch(e){}
        }
      } else if (isOnline) {
        const { error } = await sb.from('store_products').delete().eq('id', productId);
        if (error) throw error;
      }

      if (typeof showToast === 'function') showToast('ลบสินค้าสำเร็จเรียบร้อยแล้ว!');
      await renderStoreProducts();
      renderPosProducts();

    } catch (err) {
      console.error('deleteProduct error:', err);
      if (typeof showToast === 'function') showToast('ลบสินค้าไม่สำเร็จ: ' + err.message, 'error');
    } finally {
      if (typeof hideLoading === 'function') hideLoading();
    }
  }

  // ==========================================
  // 11. KEYBOARD HOTKEYS & SHORTCUTS
  // ==========================================

  window.addEventListener('keydown', function (e) {
    // Only handle if in Store section
    const storeSec = document.getElementById('section-store-inventory');
    if (!storeSec || !storeSec.classList.contains('active')) return;

    // F9 key: Submit POS Sale
    if (e.key === 'F9') {
      e.preventDefault();
      if (activeStoreTab === 'pos') {
        submitPosSale();
      }
    }
  });

  // Export functions to window
  window.switchStoreTab = switchStoreTab;
  window.initStoreSection = initStoreSection;
  window.loadStoreProductsData = loadStoreProductsData;
  window.renderPosProducts = renderPosProducts;
  window.filterPosProducts = filterPosProducts;
  window.addToPosCart = addToPosCart;
  window.updatePosCartQuantity = updatePosCartQuantity;
  window.setPosCartQuantity = setPosCartQuantity;
  window.removeFromPosCart = removeFromPosCart;
  window.clearPosCart = clearPosCart;
  window.renderPosCart = renderPosCart;
  window.searchPosMember = searchPosMember;
  window.handlePosMemberKeydown = handlePosMemberKeydown;
  window.selectPosMember = selectPosMember;
  window.clearPosMember = clearPosMember;
  window.calculatePosChange = calculatePosChange;
  window.setQuickCash = setQuickCash;
  window.submitPosSale = submitPosSale;
  window.buildStoreReceiptCopyHTML = buildStoreReceiptCopyHTML;
  window.openStoreReceiptModal = openStoreReceiptModal;
  window.closeStoreReceiptModal = closeStoreReceiptModal;
  window.printStoreReceipt = printStoreReceipt;
  window.renderStoreSalesHistory = renderStoreSalesHistory;
  window.filterStoreSalesHistory = filterStoreSalesHistory;
  window.renderStoreSalesHistoryTable = renderStoreSalesHistoryTable;
  window.viewStoreReceiptFromHistory = viewStoreReceiptFromHistory;
  window.confirmDeleteStoreSale = confirmDeleteStoreSale;
  window.deleteStoreSale = deleteStoreSale;
  window.renderStoreProducts = renderStoreProducts;
  window.filterStoreProducts = filterStoreProducts;
  window.renderStoreProductTable = renderStoreProductTable;
  window.openProductModal = openProductModal;
  window.closeProductModal = closeProductModal;
  window.saveProduct = saveProduct;
  window.calculateProductProfit = calculateProductProfit;
  window.toggleProductStatus = toggleProductStatus;
  window.confirmDeleteProduct = confirmDeleteProduct;
  window.deleteProduct = deleteProduct;

})(window);
