const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const fmt = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmt0 = n => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 });


    function renderVisits(s) {
      const el = document.getElementById('visit-stats');
      if (!el || !s) return;
      const n = v => Number(v || 0).toLocaleString('th-TH');
      el.innerHTML =
        `<span class="visit-chip">👁️ วันนี้ <b>${n(s.today_views)}</b> ครั้ง</span>` +
        `<span class="visit-chip">👤 ผู้เข้าชมวันนี้ <b>${n(s.today_visitors)}</b> คน</span>` +
        `<span class="visit-chip">📊 ทั้งหมด <b>${n(s.total_views)}</b> ครั้ง / <b>${n(s.total_visitors)}</b> คน</span>`;
    }

    fetch('/api/visits').then(r => r.json()).then(renderVisits).catch(() => {});

    let TOKEN = sessionStorage.getItem('token');
    let HOUSES = [];
    let DASH_DATA = null;
    let SELECTED_QUARTERS = new Set();
    let CURRENT_SLIP_FILE = null;

    window.toggleSlipUploadField = function() {
      const ch = document.getElementById('sel-pay-channel')?.value;
      const grp = document.getElementById('group-pay-slip');
      if (grp) {
        if (ch === 'transfer') {
          grp.style.display = 'block';
        } else {
          // cash
          grp.style.display = 'none';
          window.removeSlipFile();
        }
      }
    };

    window.handleSlipFileSelected = function(input) {
      if (!input.files || input.files.length === 0) return;
      const file = input.files[0];
      if (file.size > 15 * 1024 * 1024) {
        alert('ไฟล์มีขนาดเกิน 15MB กรุณาเลือกไฟล์รูปภาพขนาดเล็กลง');
        input.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = function(e) {
        CURRENT_SLIP_FILE = {
          data: e.target.result,
          filename: file.name,
          mimeType: file.type || 'image/jpeg'
        };
        document.getElementById('slip-preview-img').src = e.target.result;
        document.getElementById('slip-file-name').textContent = file.name;
        document.getElementById('slip-file-size').textContent = (file.size / 1024).toFixed(1) + ' KB';
        document.getElementById('slip-upload-placeholder').style.display = 'none';
        document.getElementById('slip-upload-preview').style.display = 'flex';
      };
      reader.readAsDataURL(file);
    };

    window.removeSlipFile = function() {
      CURRENT_SLIP_FILE = null;
      const inp = document.getElementById('input-pay-slip-file');
      if (inp) inp.value = '';
      const ph = document.getElementById('slip-upload-placeholder');
      const pv = document.getElementById('slip-upload-preview');
      if (ph) ph.style.display = 'block';
      if (pv) pv.style.display = 'none';
    };
    let ALL_AUDIT_LOGS = [];
    let AUDIT_CURRENT_PAGE = 1;
    const AUDIT_PAGE_SIZE = 10;

    function todayStr() {
      const d = new Date(Date.now() + 7 * 3600e3);
      return d.toISOString().slice(0, 10);
    }

    function formatThaiDate(dStr) {
      if (!dStr) return '-';
      const parts = dStr.split('-');
      if (parts.length < 3) return dStr;
      const y = parseInt(parts[0]);
      const m = parseInt(parts[1]) - 1;
      const d = parseInt(parts[2]);
      const thYear = y > 2400 ? y : y + 543;
      const monthsFull = [
        "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
        "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
      ];
      return `${d} ${monthsFull[m] || ''} ${thYear}`;
    }

    function thaiBaht(num) {
      num = Number(num || 0).toFixed(2);
      const parts = num.split('.');
      const intPart = parts[0];
      const decPart = parts[1];
      const digits = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
      const units = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน", "ล้าน"];

      function convertGroup(n) {
        let s = "";
        const len = n.length;
        for (let i = 0; i < len; i++) {
          const d = parseInt(n[i]);
          const pos = len - i - 1;
          if (d !== 0) {
            if (pos === 1 && d === 1) {
              s += "สิบ";
            } else if (pos === 1 && d === 2) {
              s += "ยี่สิบ";
            } else if (pos === 0 && d === 1 && len > 1 && n[len - 2] !== '0') {
              s += "เอ็ด";
            } else {
              s += digits[d] + units[pos];
            }
          }
        }
        return s;
      }

      let text = "";
      if (parseInt(intPart) === 0) {
        text = "ศูนย์บาท";
      } else {
        text = convertGroup(intPart) + "บาท";
      }

      if (parseInt(decPart) === 0) {
        text += "ถ้วน";
      } else {
        text += convertGroup(decPart) + "สตางค์";
      }
      return text;
    }

    function printActiveDoc() {
      document.body.classList.add('printing-active-doc');
      window.print();
      setTimeout(() => {
        document.body.classList.remove('printing-active-doc');
      }, 1000);
    }

    async function apiCall(endpoint, method = 'GET', body = null) {
      const headers = { 'Content-Type': 'application/json' };
      if (TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
      const res = await fetch(endpoint, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && TOKEN) {
        logout();
      }
      if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
      return data;
    }

    function showAlert(msg, isSuccess = true) {
      const box = document.getElementById('staff-alert-box');
      if (!box) return;
      box.innerHTML = `<div class="alert ${isSuccess ? 'alert-success' : 'alert-error'}">${isSuccess ? '✅' : '❌'} ${msg}</div>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => box.innerHTML = '', 6000);
    }

    function logout() {
      sessionStorage.clear();
      TOKEN = null;
      location.reload();
    }
    document.getElementById('btn-logout').onclick = logout;

    // Login Submission
    document.getElementById('btn-login-submit').onclick = async () => {
      const u = document.getElementById('input-username').value.trim();
      const p = document.getElementById('input-password').value;
      const alertEl = document.getElementById('login-alert');
      try {
        const res = await apiCall('/api/login', 'POST', { username: u, password: p });
        sessionStorage.setItem('token', res.token);
        sessionStorage.setItem('username', res.username);
        sessionStorage.setItem('role', res.role);
        location.reload();
      } catch (err) {
        alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
      }
    };
    document.getElementById('input-password').onkeydown = e => { if (e.key === 'Enter') document.getElementById('btn-login-submit').click(); };

    // Tab Navigation
    function switchTab(tabName) {
      const activeMenu = {
        'all-payments': 'pay',
        'all-expenses': 'exp',
        'all-income': 'inc'
      }[tabName] || tabName;

      document.querySelectorAll('.staff-menu-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === activeMenu);
      });
      document.querySelectorAll('.staff-view').forEach(v => v.classList.add('hidden'));

      const view = document.getElementById('view-' + tabName);
      if (view) view.classList.remove('hidden');

      if (tabName === 'history') loadAuditHistory();
      if (tabName === 'inc') loadRecentIncome();
      if (tabName === 'all-payments') loadAllPaymentsReport();
      if (tabName === 'all-expenses') loadAllExpensesReport();
      if (tabName === 'all-income') loadAllIncomeReport();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    document.querySelectorAll('.staff-menu-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
      });
    });

    async function initStaff() {
      if (!TOKEN) {
        document.getElementById('login-container').classList.remove('hidden');
        document.getElementById('staff-app').classList.add('hidden');
        return;
      }

      document.getElementById('login-container').classList.add('hidden');
      document.getElementById('staff-app').classList.remove('hidden');

      const uName = sessionStorage.getItem('username') || 'นายสุนทร คำสุข';
      const uRole = sessionStorage.getItem('role') === 'admin' ? 'ผู้ดูแลระบบ' : 'เจ้าหน้าที่การเงิน';
      document.getElementById('staff-display-name').textContent = `${uName} (${uRole})`;

      document.getElementById('input-pay-date').value = todayStr();
      document.getElementById('input-exp-date').value = todayStr();
      document.getElementById('input-inc-date').value = todayStr();

      await loadHouses();
      loadRecentPayments();
      loadRecentExpenses();
      fetchDashboard();
    }

    async function fetchDashboard() {
      try {
        DASH_DATA = await fetch('/api/dashboard').then(r => r.json());
      } catch (e) {}
    }

    async function loadHouses() {
      try {
        HOUSES = await apiCall('/api/staff/houses');
        populateHouseDropdown(HOUSES);
        populateZoneFilter(HOUSES);
        renderStaffMembersTable();
      } catch (err) {
        console.error(err);
      }
    }

    function populateZoneFilter(houses) {
      const zSel = document.getElementById('staff-filter-zone');
      if (!zSel || zSel.options.length > 1) return;
      const zones = [...new Set(houses.map(h => h.zone))];
      zones.forEach(z => {
        const opt = document.createElement('option');
        opt.value = z;
        opt.textContent = z;
        zSel.appendChild(opt);
      });
    }

    function populateHouseDropdown(houses) {
      const sel = document.getElementById('sel-pay-house');
      sel.innerHTML = '<option value="">-- ค้นหาหรือเลือกลูกบ้าน (162 หลัง) --</option>' +
        houses.map(h => `<option value="${h.house_id}">${h.house_no} · ${h.zone} · ${h.owner_full} (ค้าง ${h.overdue_count} ด.)</option>`).join('');

      // Also populate PDF Tab Dropdown (Only houses with actual payments)
      const pdfSel = document.getElementById('pdf-sel-house');
      if (pdfSel) {
        const paidHouses = houses.filter(h => h.paid_amount > 0);
        pdfSel.innerHTML = '<option value="">-- เลือกลูกบ้านที่มีประวัติชำระเงิน (' + paidHouses.length + ' หลัง) --</option>' +
          paidHouses.map(h => `<option value="${h.house_id}">${h.house_no} - ${h.owner_full} (${h.zone}) [ชำระแล้ว ฿${fmt0(h.paid_amount)}]</option>`).join('');
      }
    }

    document.getElementById('pdf-sel-house')?.addEventListener('change', () => {
      updatePdfPeriodOptions();
      generateOfficialReceipt();
    });

    document.getElementById('pdf-sel-period')?.addEventListener('change', () => {
      generateOfficialReceipt();
    });

    function updateQuarterCardUI(q, isPaid, isSelected) {
      const card = document.querySelector(`.period-check-card[data-q="${q}"]`);
      const pill = document.getElementById(`q-status-${q}`);
      if (!card || !pill) return;

      if (isPaid) {
        card.classList.add('paid-already');
        card.classList.remove('selected');
        pill.className = 'period-status-pill paid';
        pill.textContent = '✓ ชำระครบแล้ว';
      } else if (isSelected) {
        card.classList.remove('paid-already');
        card.classList.add('selected');
        pill.className = 'period-status-pill selected';
        pill.textContent = '✓ เลือกชำระ';
      } else {
        card.classList.remove('paid-already', 'selected');
        pill.className = 'period-status-pill unpaid';
        pill.textContent = 'รอชำระ';
      }
    }

    function toggleQuarter(q) {
      const card = document.querySelector(`.period-check-card[data-q="${q}"]`);
      if (card.classList.contains('paid-already')) return;

      if (SELECTED_QUARTERS.has(q)) {
        SELECTED_QUARTERS.delete(q);
        updateQuarterCardUI(q, false, false);
      } else {
        SELECTED_QUARTERS.add(q);
        updateQuarterCardUI(q, false, true);
      }
      calcPaymentAmount();
    }

    document.getElementById('sel-pay-house').onchange = () => {
      const hid = document.getElementById('sel-pay-house').value;
      const h = HOUSES.find(x => x.house_id === hid);
      SELECTED_QUARTERS.clear();

      for (let i = 1; i <= 4; i++) {
        updateQuarterCardUI(i, false, false);
      }

      if (h && h.quarters) {
        h.quarters.forEach(q => {
          if (q.is_full) {
            updateQuarterCardUI(q.period, true, false);
          }
        });
      }
      calcPaymentAmount();
    };

    function calcPaymentAmount() {
      const hid = document.getElementById('sel-pay-house').value;
      const h = HOUSES.find(x => x.house_id === hid);
      const ratePerQuarter = h ? (h.rate * 3) : 900;
      const totalAmt = SELECTED_QUARTERS.size * ratePerQuarter;
      document.getElementById('input-pay-amount').value = fmt(totalAmt);
    }

    // Submit Payment
    document.getElementById('btn-submit-payment').onclick = async () => {
      const hid = document.getElementById('sel-pay-house').value;
      if (!hid) return showAlert('กรุณาเลือกลูกบ้าน / บ้านเลขที่', false);
      if (SELECTED_QUARTERS.size === 0) return showAlert('กรุณาเลือกงวดที่ต้องการชำระ', false);

      const months = [];
      SELECTED_QUARTERS.forEach(q => {
        months.push((q - 1) * 3 + 1, (q - 1) * 3 + 2, (q - 1) * 3 + 3);
      });

      const channel = document.getElementById('sel-pay-channel').value;
      const body = {
        house_id: hid,
        months: months,
        paid_date: document.getElementById('input-pay-date').value,
        channel: channel,
        note: document.getElementById('input-pay-note').value,
        has_slip: !!CURRENT_SLIP_FILE,
        slip_file: CURRENT_SLIP_FILE
      };

      try {
        document.getElementById('btn-submit-payment').disabled = true;
        const res = await apiCall('/api/staff/payments', 'POST', body);
        showAlert('บันทึกการรับชำระเงินสำเร็จ บันทึกสลิปและออกใบเสร็จเรียบร้อย!');

        SELECTED_QUARTERS.clear();
        document.getElementById('input-pay-note').value = '';
        window.removeSlipFile();
        await loadHouses();
        loadRecentPayments();

        // Switch to Tab 4 and show receipt preview for newly paid quarters
        openReceiptModal(hid);
      } catch (err) {
        showAlert(err.message, false);
      } finally {
        document.getElementById('btn-submit-payment').disabled = false;
      }
    };

    // Submit Expense (Image 3)
    document.getElementById('btn-submit-expense').onclick = async () => {
      const desc = document.getElementById('input-exp-desc').value.trim();
      const amt = document.getElementById('input-exp-amount').value;
      const payee = document.getElementById('input-exp-payee').value.trim();
      const cat = document.getElementById('sel-exp-cat').value;
      const src = document.getElementById('sel-exp-src').value;
      const dte = document.getElementById('input-exp-date').value;

      if (!desc || !amt || Number(amt) <= 0) {
        return showAlert('กรุณากรอกรายการและจำนวนเงินที่ถูกต้อง', false);
      }

      try {
        document.getElementById('btn-submit-expense').disabled = true;
        const res = await apiCall('/api/staff/expenses', 'POST', {
          description: desc,
          amount: amt,
          payee: payee,
          category_id: cat,
          source: src,
          expense_date: dte
        });
        showAlert(`บันทึกรายจ่ายเลขที่ ${res.expense.doc_no} เรียบร้อย!`);
        document.getElementById('input-exp-desc').value = '';
        document.getElementById('input-exp-amount').value = '';
        document.getElementById('input-exp-payee').value = '';
        loadRecentExpenses();
      } catch (err) {
        showAlert(err.message, false);
      } finally {
        document.getElementById('btn-submit-expense').disabled = false;
      }
    };

    const INCOME_TYPE_TH = {donation: 'เงินบริจาค', interest: 'ดอกเบี้ยเงินฝาก', support: 'เงินสนับสนุน', other: 'รายได้ทางอื่นๆ'};

    document.getElementById('btn-submit-income').onclick = async () => {
      const amt = document.getElementById('input-inc-amount').value;
      const dte = document.getElementById('input-inc-date').value;
      if (!amt || Number(amt) <= 0 || !dte) {
        return showAlert('กรุณากรอกจำนวนเงินและวันที่ให้ถูกต้อง', false);
      }
      const btn = document.getElementById('btn-submit-income');
      try {
        btn.disabled = true;
        const res = await apiCall('/api/staff/income', 'POST', {
          type: document.getElementById('sel-inc-type').value,
          channel: document.getElementById('sel-inc-channel').value,
          amount: amt,
          date: dte,
          note: document.getElementById('input-inc-note').value.trim()
        });
        showAlert(`บันทึกรายได้ ${res.income.income_id} เรียบร้อย!`);
        document.getElementById('input-inc-amount').value = '';
        document.getElementById('input-inc-note').value = '';
        loadRecentIncome();
      } catch (err) {
        showAlert(err.message, false);
      } finally {
        btn.disabled = false;
      }
    };

    async function deleteIncome(id, amount) {
      if (!confirm(`⚠️ ยืนยันการลบรายได้?\n\nรหัสรายการ: ${id}\nจำนวนเงิน: ฿${fmt(amount)}`)) return;
      try {
        await apiCall(`/api/admin/other_income/${id}`, 'DELETE');
        showAlert(`ลบรายได้รหัส ${id} สำเร็จ`);
        loadRecentIncome();
        if (typeof loadAuditHistory === 'function') loadAuditHistory();
      } catch (err) {
        showAlert(err.message || 'ไม่สามารถลบรายการได้', false);
      }
    }

    async function loadRecentIncome() {
      ALL_REPORTS_CACHE = null;
      try {
        const data = await apiCall('/api/staff/recent');
        const feed = document.getElementById('recent-income-feed');
        if (!feed) return;
        const isAdmin = sessionStorage.getItem('role') === 'admin';
        const list = data.incomes || [];
        document.getElementById('inc-total-badge').textContent =
          list.length ? 'รวม ฿' + fmt(list.reduce((s, i) => s + Number(i.amount || 0), 0)) : '';
        if (!list.length) {
          feed.innerHTML = '<p style="color:#64748b; padding: 10px 0;">ยังไม่มีรายการรายได้อื่น</p>';
          return;
        }
        feed.innerHTML = list.slice(0, 30).map(i => `
          <div style="border-bottom: 1px solid #f1f5f9; padding: 10px 0; display:flex; justify-content:space-between; align-items:center; gap: 8px;">
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 600; color: #0f172a;">${INCOME_TYPE_TH[i.type] || i.type}
                <span style="font-size:11px; font-weight:600; padding:1px 8px; border-radius:10px; margin-left:6px; ${i.channel === 'cash' ? 'background:#fef3c7; color:#92400e;' : 'background:#dbeafe; color:#1e40af;'}">${i.channel === 'cash' ? 'เงินสด' : 'โอนธนาคาร'}</span></div>
              <div style="color: #64748b; font-size: 11px; margin-top: 2px;">
                <span>${i.date}</span>${i.note ? ' · <span>' + i.note + '</span>' : ''}
                <span style="color:#94a3b8; font-family: monospace;"> (${i.income_id})</span>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
              <span style="color: #059669; font-weight: 700;">+฿${fmt(i.amount)}</span>
              ${isAdmin ? `<button onclick="deleteIncome('${i.income_id}', ${Number(i.amount)})" class="btn-del-record">🗑️ ลบ</button>` : ''}
            </div>
          </div>`).join('');
      } catch (err) {
        console.error(err);
      }
    }

    async function deletePayment(payId, houseNo, amount) {
      if (!confirm(`⚠️ ยืนยันการลบรายการรับชำระเงิน?\n\nรหัสรายการ: ${payId}\nบ้านเลขที่: ${houseNo}\nจำนวนเงิน: ฿${fmt(amount)}\n\n(เมื่อลบแล้ว ยอดชำระของบ้านนี้จะถูกคำนวณใหม่และย้อนกลับเป็นค้างชำระทันที)`)) {
        return;
      }
      try {
        await apiCall(`/api/admin/payments/${payId}`, 'DELETE');
        showAlert(`ลบรายการรับเงินรหัส ${payId} เรียบร้อยแล้ว`);
        ALL_REPORTS_CACHE = null;
        await loadHouses();
        loadRecentPayments();
        const sel = document.getElementById('sel-pay-house');
        if (sel && sel.value) sel.onchange();
        if (typeof CURRENT_TAB !== 'undefined' && CURRENT_TAB === 'all-payments') {
          loadAllPaymentsReport();
        }
        if (typeof loadAuditHistory === 'function') loadAuditHistory();
      } catch (err) {
        showAlert(err.message || 'ไม่สามารถลบรายการได้', false);
      }
    }

    async function deleteExpense(expId, desc, amount) {
      if (!confirm(`⚠️ ยืนยันการลบรายการรายจ่าย?\n\nรหัสรายการ: ${expId}\nรายการ: ${desc}\nจำนวนเงิน: ฿${fmt(amount)}\n\n(เมื่อลบแล้ว ยอดค่าใช้จ่ายสะสมและยอดคงเหลือสุทธิจะถูกคำนวณใหม่ทันที)`)) {
        return;
      }
      try {
        await apiCall(`/api/admin/expenses/${expId}`, 'DELETE');
        showAlert(`ลบรายการรายจ่ายรหัส ${expId} สำเร็จ`);
        loadRecentExpenses();
        if (typeof loadAuditHistory === 'function') loadAuditHistory();
      } catch (err) {
        showAlert(err.message || 'ไม่สามารถลบรายการได้', false);
      }
    }

    async function loadRecentPayments() {
      ALL_REPORTS_CACHE = null;
      try {
        const data = await apiCall('/api/staff/recent');
        const feed = document.getElementById('recent-payments-feed');
        if (!feed) return;
        const isAdmin = sessionStorage.getItem('role') === 'admin';

        if (!data.payments || data.payments.length === 0) {
          feed.innerHTML = '<p style="color:#64748b; padding: 10px 0;">ยังไม่มีรายการล่าสุด</p>';
          return;
        }

        feed.innerHTML = data.payments.slice(0, 15).map(p => {
          const delBtn = isAdmin ? `
            <button onclick="deletePayment('${p.payment_id}', '${p.house_no}', ${p.amount})" class="btn-del-record" title="ลบรายการรับเงินนี้ (เฉพาะผู้ดูแลระบบ)">
              🗑️ ลบ
            </button>
          ` : '';

          return `
            <div style="border-bottom: 1px solid #f1f5f9; padding: 8px 0; display:flex; justify-content:space-between; align-items:center; gap: 8px;">
              <div style="flex: 1; min-width: 0;">
                <div><b>บ้าน ${p.house_no}</b> (งวดเดือน ${MONTHS_TH[p.month - 1]})</div>
                <div style="color: #64748b; font-size: 11px;">
                  <span>${p.paid_date}</span> · <span>${p.channel === 'transfer' ? 'โอน' : 'เงินสด'}</span>
                  <span style="color:#94a3b8; font-family: monospace;"> (${p.payment_id})</span>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                <span style="color: #059669; font-weight: 700;">+฿${fmt0(p.amount)}</span>
                ${delBtn}
              </div>
            </div>
          `;
        }).join('');
      } catch (err) {
        console.error(err);
      }
    }

    async function loadRecentExpenses() {
      ALL_REPORTS_CACHE = null;
      try {
        const data = await apiCall('/api/staff/recent');
        const feed = document.getElementById('recent-expenses-feed');
        if (!feed) return;
        const isAdmin = sessionStorage.getItem('role') === 'admin';

        if (!data.expenses || data.expenses.length === 0) {
          feed.innerHTML = '<p style="color:#64748b; padding: 10px 0;">ยังไม่มีรายการรายจ่ายล่าสุด</p>';
          return;
        }

        feed.innerHTML = data.expenses.slice(0, 15).map(e => {
          const delBtn = isAdmin ? `
            <button onclick="deleteExpense('${e.expense_id}', '${(e.description || '').replace(/'/g, "\\'")}', ${e.amount})" class="btn-del-record" title="ลบรายการรายจ่ายนี้ (เฉพาะผู้ดูแลระบบ)">
              🗑️ ลบ
            </button>
          ` : '';

          return `
            <div style="border-bottom: 1px solid #f1f5f9; padding: 10px 0; display:flex; justify-content:space-between; align-items:center; gap: 8px;">
              <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 600; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${e.description}</div>
                <div style="color: #64748b; font-size: 11px; margin-top: 2px;">
                  <span>${e.expense_date}</span> · <span>ผู้รับ: ${e.payee || '-'}</span>
                  ${e.doc_no ? ` · <span style="color:#2563eb; font-weight:600;">ใบสำคัญ ${e.doc_no}</span>` : ''}
                  <span style="color:#94a3b8; font-family: monospace;"> (${e.expense_id})</span>
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                <span style="color: #dc2626; font-weight: 700;">-฿${fmt(e.amount)}</span>
                ${delBtn}
              </div>
            </div>
          `;
        }).join('');
      } catch (err) {
        console.error(err);
      }
    }

    // ==================== TAB 3: ทะเบียนสมาชิก 162 หลัง (Image 2) ====================
    function renderStaffMembersTable() {
      const q = document.getElementById('staff-members-search')?.value.trim().toLowerCase() || '';
      const zoneFilter = document.getElementById('staff-filter-zone')?.value || '';
      const statusFilter = document.getElementById('staff-filter-status')?.value || '';

      const filtered = HOUSES.filter(h => {
        const matchQ = !q || h.house_no.toLowerCase().includes(q) || h.owner_full.toLowerCase().includes(q) || h.zone.toLowerCase().includes(q);
        const matchZ = !zoneFilter || h.zone === zoneFilter;
        let matchS = true;
        if (statusFilter === 'paid') matchS = (h.paid_count === 12);
        else if (statusFilter === 'partial') matchS = (h.paid_count > 0 && h.paid_count < 12);
        else if (statusFilter === 'unpaid') matchS = (h.paid_count === 0);
        return matchQ && matchZ && matchS;
      });

      let html = `
        <thead>
          <tr>
            <th>ซอย</th>
            <th>บ้านเลขที่</th>
            <th>ชื่อ-สกุล</th>
            <th class="c">งวด 1</th>
            <th class="c">งวด 2</th>
            <th class="c">งวด 3</th>
            <th class="c">งวด 4</th>
            <th class="r">ชำระแล้ว</th>
            <th class="r">ยอดค้าง</th>
            <th class="c">สถานะ</th>
            <th class="c">พิมพ์ใบเสร็จ</th>
          </tr>
        </thead>
        <tbody>
      `;

      html += filtered.map(h => {
        let badgeHtml = '';
        if (h.paid_count === 12) badgeHtml = '<span class="badge-status badge-paid">ชำระครบ</span>';
        else if (h.paid_count > 0) badgeHtml = '<span class="badge-status badge-partial">ชำระบางส่วน</span>';
        else badgeHtml = '<span class="badge-status badge-unpaid">ยังไม่ชำระ</span>';

        const q0 = h.quarters[0];
        const q1 = h.quarters[1];
        const q2 = h.quarters[2];
        const q3 = h.quarters[3];

        if (h.paid_count === 12) {
          badgeHtml = `<span class="badge-status badge-paid" onclick="showSlipModal('${h.house_id}', 0)" title="คลิกเพื่อดูสลิป/หลักฐานการชำระ">ชำระครบ</span>`;
        } else if (h.paid_count > 0) {
          badgeHtml = `<span class="badge-status badge-partial" onclick="showSlipModal('${h.house_id}', 0)" title="คลิกเพื่อดูสลิป/หลักฐานการชำระ">ชำระบางส่วน</span>`;
        } else {
          badgeHtml = '<span class="badge-status badge-unpaid">ยังไม่ชำระ</span>';
        }

        return `
          <tr>
            <td>${h.zone}</td>
            <td><b>${h.house_no}</b></td>
            <td>${h.owner_full}</td>
            <td class="c"><span class="q-check ${q0.is_full ? 'paid' : 'unpaid'}" ${q0.is_full ? `onclick="showSlipModal('${h.house_id}', 1)" title="คลิกเพื่อดูสลิปงวดที่ 1"` : ''}>${q0.is_full ? '✔' : '⚪'}</span></td>
            <td class="c"><span class="q-check ${q1.is_full ? 'paid' : 'unpaid'}" ${q1.is_full ? `onclick="showSlipModal('${h.house_id}', 2)" title="คลิกเพื่อดูสลิปงวดที่ 2"` : ''}>${q1.is_full ? '✔' : '⚪'}</span></td>
            <td class="c"><span class="q-check ${q2.is_full ? 'paid' : 'unpaid'}" ${q2.is_full ? `onclick="showSlipModal('${h.house_id}', 3)" title="คลิกเพื่อดูสลิปงวดที่ 3"` : ''}>${q2.is_full ? '✔' : '⚪'}</span></td>
            <td class="c"><span class="q-check ${q3.is_full ? 'paid' : 'unpaid'}" ${q3.is_full ? `onclick="showSlipModal('${h.house_id}', 4)" title="คลิกเพื่อดูสลิปงวดที่ 4"` : ''}>${q3.is_full ? '✔' : '⚪'}</span></td>
            <td class="r" style="color: #059669; font-weight: 700;">฿${fmt0(h.paid_amount)}</td>
            <td class="r" style="color: ${h.overdue_amount > 0 ? '#dc2626' : '#64748b'}; font-weight: 700;">
              ${h.overdue_amount > 0 ? '฿' + fmt0(h.overdue_amount) : '฿0'}
            </td>
            <td class="c">${badgeHtml}</td>
            <td class="c">
              ${h.paid_amount > 0 ? `
                <button class="btn-icon-print" onclick="openReceiptModal('${h.house_id}')" title="พิมพ์ใบเสร็จรับเงิน (ชำระแล้ว ฿${fmt0(h.paid_amount)})">
                  🖨️
                </button>
              ` : `
                <span style="color: #cbd5e1; font-size: 14px;" title="ยังไม่มีประวัติการชำระเงิน">-</span>
              `}
            </td>
          </tr>
        `;
      }).join('');

      html += '</tbody>';
      document.getElementById('staff-members-table').innerHTML = html;
    }

    document.getElementById('staff-members-search')?.addEventListener('input', renderStaffMembersTable);
    document.getElementById('staff-filter-zone')?.addEventListener('change', renderStaffMembersTable);
    document.getElementById('staff-filter-status')?.addEventListener('change', renderStaffMembersTable);

    function exportToExcel() {
      let csv = "\uFEFFซอย,บ้านเลขที่,ชื่อ-สกุล,งวด 1,งวด 2,งวด 3,งวด 4,ชำระแล้ว,ยอดค้าง,สถานะ\n";
      HOUSES.forEach(h => {
        const q1 = h.quarters[0].is_full ? "ชำระครบ" : (h.quarters[0].paid_count + "/3");
        const q2 = h.quarters[1].is_full ? "ชำระครบ" : (h.quarters[1].paid_count + "/3");
        const q3 = h.quarters[2].is_full ? "ชำระครบ" : (h.quarters[2].paid_count + "/3");
        const q4 = h.quarters[3].is_full ? "ชำระครบ" : (h.quarters[3].paid_count + "/3");
        const st = h.paid_count === 12 ? "ชำระครบ" : (h.paid_count > 0 ? "ชำระบางส่วน" : "ยังไม่ชำระ");
        csv += `"${h.zone}","${h.house_no}","${h.owner_full}","${q1}","${q2}","${q3}","${q4}",${h.paid_amount},${h.overdue_amount},"${st}"\n`;
      });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `รายงานสมาชิกกองทุนหมู่บ้าน_2569_${todayStr()}.csv`;
      link.click();
    }

    // ==================== TAB 4: PDF Generation (Image 4) ====================
    function updatePdfPeriodOptions(selectedPeriod = null) {
      const hid = document.getElementById('pdf-sel-house').value;
      const periodSel = document.getElementById('pdf-sel-period');
      if (!periodSel) return;
      periodSel.innerHTML = '';

      const h = HOUSES.find(x => x.house_id === hid);
      if (!h || h.paid_amount <= 0) {
        periodSel.innerHTML = '<option value="">(ยังไม่มีประวัติการชำระเงิน — ไม่ออกใบเสร็จ)</option>';
        return;
      }

      const paidQuarters = h.quarters.filter(q => q.paid_count > 0);
      const qNames = paidQuarters.map(q => `งวด ${q.period}`).join(', ');
      const optAll = document.createElement('option');
      optAll.value = 'all';
      optAll.textContent = `ทุกงวดที่ชำระแล้ว (${qNames}) — รวม ฿${fmt(h.paid_amount)}`;
      periodSel.appendChild(optAll);

      paidQuarters.forEach(q => {
        const opt = document.createElement('option');
        opt.value = String(q.period);
        const qAmt = h.rate * q.paid_count;
        const fullTxt = q.is_full ? 'ชำระเต็มงวด' : `ชำระ ${q.paid_count}/3 เดือน`;
        opt.textContent = `งวดที่ ${q.period} (${fullTxt}) — ฿${fmt(qAmt)}`;
        periodSel.appendChild(opt);
      });

      if (selectedPeriod && periodSel.querySelector(`option[value="${selectedPeriod}"]`)) {
        periodSel.value = selectedPeriod;
      }
    }

    function openReceiptModal(houseId, defaultPeriod = null) {
      const h = HOUSES.find(x => x.house_id === houseId);
      if (!h || h.paid_amount <= 0) {
        showAlert(`บ้านเลขที่ ${h ? h.house_no : houseId} ยังไม่มีประวัติการชำระเงิน ไม่สามารถออกใบเสร็จรับเงินได้`, false);
        return;
      }
      document.querySelector('.staff-menu-btn[data-tab="receipts"]').click();
      document.getElementById('pdf-sel-house').value = houseId;
      updatePdfPeriodOptions(defaultPeriod);
      generateOfficialReceipt();
    }

    function generateOfficialReceipt() {
      const hid = document.getElementById('pdf-sel-house').value;
      const h = HOUSES.find(x => x.house_id === hid);
      if (!h) return showAlert('กรุณาเลือกลูกบ้านที่มีประวัติการชำระเงิน', false);

      if (h.paid_amount <= 0 || h.paid_count === 0) {
        showAlert(`บ้านเลขที่ ${h.house_no} ยังไม่มีประวัติการชำระเงิน ไม่สามารถออกใบเสร็จรับเงินได้`, false);
        document.getElementById('pdf-preview-box').classList.add('hidden');
        return;
      }

      const periodChoice = document.getElementById('pdf-sel-period').value;
      let quartersTxt = '';
      let amount = 0;

      if (periodChoice === 'all' || !periodChoice) {
        const paidQ = h.quarters.filter(q => q.paid_count > 0).map(q => `งวดที่ ${q.period} (${q.is_full ? 'ครบ' : q.paid_count + '/3 ด.'})`);
        quartersTxt = paidQ.join(', ');
        amount = h.paid_amount;
      } else {
        const qNum = parseInt(periodChoice);
        const targetQ = h.quarters.find(q => q.period === qNum);
        if (!targetQ || targetQ.paid_count === 0) {
          showAlert(`บ้านเลขที่ ${h.house_no} ยังไม่ได้ชำระเงินในงวดที่ ${qNum} ไม่สามารถออกใบเสร็จได้`, false);
          document.getElementById('pdf-preview-box').classList.add('hidden');
          return;
        }
        quartersTxt = `งวดที่ ${qNum} (${targetQ.is_full ? 'ชำระเต็มงวด 3 เดือน' : 'ชำระ ' + targetQ.paid_count + ' เดือน'})`;
        amount = h.rate * targetQ.paid_count;
      }

      if (amount <= 0) {
        showAlert('ยอดเงินที่ชำระเป็น 0 ไม่สามารถออกใบเสร็จได้', false);
        document.getElementById('pdf-preview-box').classList.add('hidden');
        return;
      }

      const canvas = document.getElementById('pdf-render-canvas');
      canvas.innerHTML = `
        <div class="receipt-box" style="border: 2px solid #0f172a; padding: 36px 32px; border-radius: 12px; background: #fff;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 20px;">
            <div style="display: flex; align-items: center; gap: 14px;">
              <div style="font-size: 38px;">🏛️</div>
              <div>
                <h2 style="font-size: 22px; font-weight: 700; color: #0f172a; margin-bottom: 2px;">ใบเสร็จรับเงิน</h2>
                <div style="font-size: 15px; font-weight: 600; color: #1e3a8a;">กองทุนหมู่บ้าน ลพบุรีราเมศวร์โครงการ 1 ประจำปี 2569</div>
                <div style="font-size: 12px; color: #64748b;">เอกสารหลักฐานการรับเงินกองทุนตามระเบียบการเงินและบัญชี</div>
              </div>
            </div>
            <div style="text-align: right; font-size: 13px;">
              <div style="font-weight: 700; color: #0f172a; font-size: 14px;">เลขที่: <b>REC-2569-${h.house_no.replace('/', '')}</b></div>
              <div style="color: #475569; margin-top: 4px;">วันที่ออกใบเสร็จ: <b>${formatThaiDate(todayStr())}</b></div>
            </div>
          </div>

          <table class="table-statement" style="margin: 20px 0; border: 1px solid #cbd5e1;">
            <tbody>
              <tr>
                <td style="width: 25%; background: #f8fafc; font-weight: 600;">ได้รับเงินจาก:</td>
                <td style="font-size: 15px; font-weight: 700; color: #0f172a;">${h.owner_full}</td>
              </tr>
              <tr>
                <td style="background: #f8fafc; font-weight: 600;">บ้านเลขที่ / ซอย:</td>
                <td><b>${h.house_no}</b> (ซอย: ${h.zone} | อัตราเดือนละ ${fmt0(h.rate)} บาท)</td>
              </tr>
              <tr>
                <td style="background: #f8fafc; font-weight: 600;">รายการที่ชำระแล้ว:</td>
                <td><span style="display:inline-block; background:#ecfdf5; color:#065f46; padding:2px 8px; border-radius:4px; font-weight:600; font-size:12px;">ชำระแล้ว</span> ค่าบำรุงกองทุนพัฒนาหมู่บ้าน ปี 2569 (${quartersTxt})</td>
              </tr>
              <tr>
                <td style="background: #f8fafc; font-weight: 600;">จำนวนเงินที่ชำระ (ตัวเลข):</td>
                <td style="font-size: 18px; font-weight: 700; color: #059669;">฿${fmt(amount)} บาท</td>
              </tr>
              <tr style="background: #f0fdf4;">
                <td style="background: #ecfdf5; font-weight: 600; color: #065f46;">จำนวนเงินที่ชำระ (ตัวอักษร):</td>
                <td style="font-size: 15px; font-weight: 700; color: #065f46;">(${thaiBaht(amount)})</td>
              </tr>
            </tbody>
          </table>

          <div class="signatures-area" style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 50px; padding: 0 20px;">
            <div class="sig-block" style="text-align: center; width: 220px;">
              <div class="sig-line" style="border-bottom: 1px dotted #64748b; height: 35px; margin-bottom: 8px;"></div>
              <div><b>(น.ส.วีระออ สุวรรณสิทธิ์)</b></div>
              <div style="color: #64748b; font-size: 12px; margin-top: 2px;">เหรัญญิก ผู้รับเงิน</div>
            </div>
          <!--  <div style="text-align: center; font-size: 11px; color: #94a3b8; max-width: 220px;">
              ใบเสร็จรับเงินฉบับนี้ออกให้เฉพาะยอดที่ชำระจริง<br>สมบูรณ์เมื่อมีลายมือชื่อผู้รับเงินครบถ้วน
            </div>-->
            <div class="sig-block" style="text-align: center; width: 220px;">
              <div class="sig-line" style="border-bottom: 1px dotted #64748b; height: 35px; margin-bottom: 8px;"></div>
              <div><b>(นายสุนทร คำสุข)</b></div>
              <div style="color: #64748b; font-size: 12px; margin-top: 2px;">ประธานคณะทำงานกองทุนพัฒนาหมู่บ้าน<br>ลพบุรีราเมศวร์โครงการ 1</div>
            </div>
          </div>
        </div>
      `;

      document.getElementById('pdf-preview-box').classList.remove('hidden');
      document.getElementById('pdf-preview-box').scrollIntoView({ behavior: 'smooth' });
    }

    function generateFinancialReport() {
      if (!DASH_DATA || !DASH_DATA.statement) return;
      const canvas = document.getElementById('pdf-render-canvas');
      canvas.innerHTML = `
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="font-size: 20px; font-weight: 700;">รายงานสรุปการรับ-จ่ายเงินของกองทุนพัฒนาหมู่บ้าน ปี 2569</h2>
          <p style="font-size: 13px; color: #64748b;">ข้อมูลสรุปยอดเงินและเงินฝากธนาคาร ณ วันที่ ${DASH_DATA.as_of_thai || formatThaiDate(todayStr())}</p>
        </div>
        <table class="table-statement">
          <thead>
            <tr>
              <th class="c" style="width: 15%;">ว/ด/ป</th>
              <th style="width: 60%;">รายการ</th>
              <th class="r" style="width: 25%;">จำนวนเงิน (บาท)</th>
            </tr>
          </thead>
          <tbody>
            ${DASH_DATA.statement.map(row => `
              <tr class="${row.highlight ? 'tr-highlight-' + row.highlight : ''}">
                <td class="c">${row.date}</td>
                <td>${row.title}</td>
                <td class="r">${fmt(row.amount)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="signatures-area" style="display: flex; justify-content: space-between; margin-top: 50px;">
          <div class="sig-block" style="text-align: center; width: 220px;">
            <div class="sig-line"></div>
            <div><b>(น.ส.วีระออ สุวรรณสิทธิ์)</b></div>
            <div style="color: #64748b; font-size: 12px; margin-top: 2px;">เหรัญญิก ผู้รับเงิน</div>
          </div>
          <div class="sig-block" style="text-align: center; width: 220px;">
            <div class="sig-line"></div>
            <div><b>(นายสุนทร คำสุข)</b></div>
            <div style="color: #64748b; font-size: 12px; margin-top: 2px;">ประธานคณะทำงานกองทุนพัฒนาหมู่บ้าน<br>ลพบุรีราเมศวร์โครงการ 1</div>
          </div>
        </div>
      `;
      document.getElementById('pdf-preview-box').classList.remove('hidden');
      document.getElementById('pdf-preview-box').scrollIntoView({ behavior: 'smooth' });
    }

    function generateOverdueReport() {
      const overdueList = HOUSES.filter(h => h.overdue_amount > 0);
      const canvas = document.getElementById('pdf-render-canvas');
      canvas.innerHTML = `
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="font-size: 20px; font-weight: 700; color: #dc2626;">รายงานบัญชีรายชื่อบ้านที่ค้างชำระเงินแยกซอย</h2>
          <p style="font-size: 13px; color: #64748b;">สำหรับคณะกรรมการลงพื้นที่ติดตาม ณ วันที่ ${formatThaiDate(todayStr())} (พบทั้งหมด ${overdueList.length} หลังคาเรือน)</p>
        </div>
        <table class="table-statement">
          <thead>
            <tr>
              <th>ซอย</th>
              <th>บ้านเลขที่</th>
              <th>ชื่อ-สกุล</th>
              <th class="c">งวดที่ค้าง</th>
              <th class="r">ยอดค้างชำระ (บาท)</th>
            </tr>
          </thead>
          <tbody>
            ${overdueList.map(h => `
              <tr>
                <td>${h.zone}</td>
                <td><b>${h.house_no}</b></td>
                <td>${h.owner_full}</td>
                <td class="c">ค้าง ${h.overdue_count} เดือน</td>
                <td class="r" style="color: #dc2626; font-weight: 700;">฿${fmt0(h.overdue_amount)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="signatures-area" style="display: flex; justify-content: space-between; margin-top: 50px;">
          <div class="sig-block" style="text-align: center; width: 220px;">
            <div class="sig-line"></div>
            <div><b>(น.ส.วีระออ สุวรรณสิทธิ์)</b></div>
            <div style="color: #64748b; font-size: 12px; margin-top: 2px;">เหรัญญิก ผู้รับเงิน</div>
          </div>
          <div class="sig-block" style="text-align: center; width: 220px;">
            <div class="sig-line"></div>
            <div><b>(นายสุนทร คำสุข)</b></div>
            <div style="color: #64748b; font-size: 12px; margin-top: 2px;">ประธานคณะทำงานกองทุนพัฒนาหมู่บ้าน<br>ลพบุรีราเมศวร์โครงการ 1</div>
          </div>
        </div>
      `;
      document.getElementById('pdf-preview-box').classList.remove('hidden');
      document.getElementById('pdf-preview-box').scrollIntoView({ behavior: 'smooth' });
    }

    // ==================== TAB 5: Audit Log (Image 5) ====================
    async function loadAuditHistory() {
      try {
        const feed = document.getElementById('audit-log-feed');
        if (!feed) return;

        const data = await apiCall('/api/staff/recent');
        let logs = [];

        // Parse official audit logs from server
        if (data.audit_logs && data.audit_logs.length > 0) {
          data.audit_logs.forEach(al => {
            let title = '';
            let sub = '';
            let icon = '📝';
            let iconBg = '#f1f5f9';
            let iconColor = '#475569';

            if (al.action === 'create' && al.table === 'payments') {
              icon = '💵';
              iconBg = '#ecfdf5';
              iconColor = '#059669';
              let extra = '';
              try {
                const val = typeof al.new_value === 'string' ? JSON.parse(al.new_value) : al.new_value;
                extra = `จำนวน ฿${fmt0(val.amount_paid)} บาท`;
              } catch (e) {}
              title = `บันทึกรับเงิน รหัส ${al.record_id} ${extra ? '(' + extra + ')' : ''}`;
              sub = `ACTION: CREATE_PAYMENT · ตาราง: payments · รหัสรายการ: ${al.record_id} · บันทึกโดย: ${al.user_id}`;
            } else if (al.action === 'delete' && al.table === 'payments') {
              icon = '🗑️';
              iconBg = '#fef2f2';
              iconColor = '#dc2626';
              title = `ลบรายการรับเงิน รหัส ${al.record_id}`;
              sub = `ACTION: DELETE_PAYMENT · ตาราง: payments · รหัสรายการ: ${al.record_id} · ดำเนินการโดย: ${al.user_id} (Admin)`;
            } else if (al.action === 'create' && al.table === 'expenses') {
              icon = '🔴';
              iconBg = '#fee2e2';
              iconColor = '#b91c1c';
              let extra = '';
              try {
                const val = typeof al.new_value === 'string' ? JSON.parse(al.new_value) : al.new_value;
                extra = `${val.description || ''} ฿${fmt(val.amount)}`;
              } catch (e) {}
              title = `บันทึกรายจ่าย รหัส ${al.record_id} ${extra ? '(' + extra + ')' : ''}`;
              sub = `ACTION: CREATE_EXPENSE · ตาราง: expenses · รหัสรายการ: ${al.record_id} · บันทึกโดย: ${al.user_id}`;
            } else if (al.action === 'delete' && al.table === 'expenses') {
              icon = '🗑️';
              iconBg = '#fef2f2';
              iconColor = '#dc2626';
              title = `ลบรายการรายจ่าย รหัส ${al.record_id}`;
              sub = `ACTION: DELETE_EXPENSE · ตาราง: expenses · รหัสรายการ: ${al.record_id} · ดำเนินการโดย: ${al.user_id} (Admin)`;
            } else if (al.action === 'create' && al.table === 'users') {
              icon = '👤';
              iconBg = '#eff6ff';
              iconColor = '#2563eb';
              title = `สร้างบัญชีผู้ใช้งานใหม่: ${al.new_value}`;
              sub = `ACTION: CREATE_USER · รหัสผู้ใช้: ${al.record_id} · ดำเนินการโดย: ${al.user_id}`;
            } else {
              title = `ทำรายการ ${al.action} บนตาราง ${al.table} รหัส ${al.record_id}`;
              sub = `ACTION: ${al.action.toUpperCase()} · ตาราง: ${al.table} · ดำเนินการโดย: ${al.user_id}`;
            }

            logs.push({
              id: al.log_id || Math.random(),
              title: title,
              sub: sub,
              time: al.timestamp,
              icon: icon,
              iconBg: iconBg,
              iconColor: iconColor
            });
          });
        }

        // Also append recent payments not in audit log
        const seenPayIds = new Set(data.audit_logs?.filter(a => a.table === 'payments').map(a => a.record_id) || []);
        if (data.payments) {
          data.payments.forEach(p => {
            if (!seenPayIds.has(p.payment_id)) {
              logs.push({
                id: p.payment_id,
                title: `บันทึกรับเงิน บ้าน ${p.house_no} (งวดเดือน ${MONTHS_TH[p.month - 1]}) จำนวน ฿${fmt0(p.amount)} บาท`,
                sub: `PAYMENT_RECORD · รหัส: ${p.payment_id} · ช่องทาง: ${p.channel === 'transfer' ? 'โอนเงิน' : 'เงินสด'} · ผู้บันทึก: ${p.recorded_by || 'เจ้าหน้าที่'}`,
                time: p.paid_date + " 09:30:00",
                icon: '💵',
                iconBg: '#ecfdf5',
                iconColor: '#059669'
              });
            }
          });
        }

        // Also append recent expenses not in audit log
        const seenExpIds = new Set(data.audit_logs?.filter(a => a.table === 'expenses').map(a => a.record_id) || []);
        if (data.expenses) {
          data.expenses.forEach(e => {
            if (!seenExpIds.has(e.expense_id)) {
              logs.push({
                id: e.expense_id,
                title: `บันทึกรายจ่าย เลขที่ ${e.doc_no || '-'}: ${e.description} จำนวน ฿${fmt(e.amount)} บาท`,
                sub: `EXPENSE_RECORD · แหล่งเงิน: ${e.source === 'bank' ? 'บัญชีธนาคาร' : 'เงินสำรอง'} · ผู้รับเงิน: ${e.payee || '-'}`,
                time: e.expense_date + " 10:15:00",
                icon: '🔴',
                iconBg: '#fee2e2',
                iconColor: '#b91c1c'
              });
            }
          });
        }

        // Base database initialization event
        logs.push({
          id: 'SYS-INIT',
          title: 'นำเข้าข้อมูลตั้งต้นจากเอกสารกองทุนพัฒนาหมู่บ้าน ปี 2569 จำนวน 162 หลังคาเรือน',
          sub: 'INITIALIZE_DATABASE · นำเข้าทะเบียนลูกบ้าน ยอดยกมา และประวัติการจัดเก็บงวด 1-4 · ผู้ดำเนินการ: system',
          time: '2026-10-26 18:44:06',
          icon: '🏛️',
          iconBg: '#f1f5f9',
          iconColor: '#1e295d'
        });

        // Sort descending by time
        logs.sort((a, b) => b.time.localeCompare(a.time));
        ALL_AUDIT_LOGS = logs;
        renderAuditPage(1);
      } catch (err) {
        console.error(err);
      }
    }

    function renderAuditPage(page) {
      AUDIT_CURRENT_PAGE = page;
      const feed = document.getElementById('audit-log-feed');
      const pageInfo = document.getElementById('audit-page-info');
      const pageBtns = document.getElementById('audit-page-btns');
      const totalBadge = document.getElementById('audit-total-badge');
      if (!feed) return;

      const total = ALL_AUDIT_LOGS.length;
      if (totalBadge) totalBadge.textContent = `ทั้งหมด ${total} รายการ`;

      if (total === 0) {
        feed.innerHTML = '<p style="color: #64748b; padding: 24px 0; text-align: center;">ยังไม่มีประวัติการทำรายการ</p>';
        if (pageInfo) pageInfo.textContent = '';
        if (pageBtns) pageBtns.innerHTML = '';
        return;
      }

      const totalPages = Math.ceil(total / AUDIT_PAGE_SIZE);
      if (page < 1) page = 1;
      if (page > totalPages) page = totalPages;

      const startIdx = (page - 1) * AUDIT_PAGE_SIZE;
      const endIdx = Math.min(startIdx + AUDIT_PAGE_SIZE, total);
      const items = ALL_AUDIT_LOGS.slice(startIdx, endIdx);

      // Render items with no card border, separated by dashed border bottom
      feed.innerHTML = items.map(l => `
        <div class="audit-item">
          <div class="audit-item-left">
            <div class="audit-icon-box" style="background: ${l.iconBg}; color: ${l.iconColor};">
              ${l.icon}
            </div>
            <div style="min-width: 0;">
              <div class="audit-item-title">${l.title}</div>
              <div class="audit-item-sub">${l.sub}</div>
            </div>
          </div>
          <div class="audit-item-time">${l.time}</div>
        </div>
      `).join('');

      // Page information
      if (pageInfo) {
        pageInfo.textContent = `แสดงรายการที่ ${startIdx + 1} - ${endIdx} จากทั้งหมด ${total} รายการ (หน้า ${page}/${totalPages})`;
      }

      // Pagination buttons
      if (pageBtns) {
        let btnsHtml = '';
        btnsHtml += `<button class="pagination-btn" onclick="renderAuditPage(${page - 1})" ${page === 1 ? 'disabled' : ''}>◀ ก่อนหน้า</button>`;

        const maxButtons = 5;
        let startPage = Math.max(1, page - 2);
        let endPage = Math.min(totalPages, startPage + maxButtons - 1);
        if (endPage - startPage + 1 < maxButtons) {
          startPage = Math.max(1, endPage - maxButtons + 1);
        }

        if (startPage > 1) {
          btnsHtml += `<button class="pagination-btn" onclick="renderAuditPage(1)">1</button>`;
          if (startPage > 2) btnsHtml += `<span style="padding: 0 4px; color: #94a3b8;">...</span>`;
        }

        for (let p = startPage; p <= endPage; p++) {
          btnsHtml += `<button class="pagination-btn ${p === page ? 'active' : ''}" onclick="renderAuditPage(${p})">${p}</button>`;
        }

        if (endPage < totalPages) {
          if (endPage < totalPages - 1) btnsHtml += `<span style="padding: 0 4px; color: #94a3b8;">...</span>`;
          btnsHtml += `<button class="pagination-btn" onclick="renderAuditPage(${totalPages})">${totalPages}</button>`;
        }

        btnsHtml += `<button class="pagination-btn" onclick="renderAuditPage(${page + 1})" ${page === totalPages ? 'disabled' : ''}>ถัดไป ▶</button>`;

        pageBtns.innerHTML = btnsHtml;
      }
    }

    // =========================================================================
    // REPORTS & ALL TRANSACTIONS LOGIC (ปี 2569)
    // =========================================================================
    let ALL_REPORTS_CACHE = null;
    let FILTERED_PAYMENTS = [];
    let FILTERED_EXPENSES = [];
    let FILTERED_INCOME = [];

    async function fetchReportsData(force = false) {
      if (!ALL_REPORTS_CACHE || force) {
        try {
          ALL_REPORTS_CACHE = await apiCall('/api/staff/reports/all');
        } catch (e) {
          console.error('Error fetching reports all:', e);
          ALL_REPORTS_CACHE = { payments: [], expenses: [], incomes: [], categories: [] };
        }
      }
      return ALL_REPORTS_CACHE;
    }

    // --- 1. รายการรายรับ ปี 2569 ---
    async function loadAllPaymentsReport() {
      const data = await fetchReportsData();
      FILTERED_PAYMENTS = data.payments || [];
      filterAllPayments();
    }

    function filterAllPayments() {
      const all = (ALL_REPORTS_CACHE && ALL_REPORTS_CACHE.payments) || [];
      const qVal = document.getElementById('filter-pay-quarter')?.value || '';
      const mVal = document.getElementById('filter-pay-month')?.value || '';
      const cVal = document.getElementById('filter-pay-channel')?.value || '';
      const sVal = (document.getElementById('filter-pay-search')?.value || '').trim().toLowerCase();

      FILTERED_PAYMENTS = all.filter(p => {
        if (qVal && String(p.quarter) !== String(qVal)) return false;
        if (mVal && String(p.month) !== String(mVal)) return false;
        if (cVal && p.channel !== cVal) return false;
        if (sVal) {
          const text = `${p.payment_id} ${p.house_no} ${p.owner} ${p.recorded_by} ${p.note}`.toLowerCase();
          if (!text.includes(sVal)) return false;
        }
        return true;
      });

      renderAllPaymentsTable();
    }

    function resetPayFilter() {
      if (document.getElementById('filter-pay-search')) document.getElementById('filter-pay-search').value = '';
      if (document.getElementById('filter-pay-quarter')) document.getElementById('filter-pay-quarter').value = '';
      if (document.getElementById('filter-pay-month')) document.getElementById('filter-pay-month').value = '';
      if (document.getElementById('filter-pay-channel')) document.getElementById('filter-pay-channel').value = '';
      filterAllPayments();
    }

    function renderAllPaymentsTable() {
      const tbody = document.getElementById('tbody-all-payments');
      if (!tbody) return;

      const total = FILTERED_PAYMENTS.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const count = FILTERED_PAYMENTS.length;
      const transfer = FILTERED_PAYMENTS.filter(p => p.channel === 'transfer').reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const cash = FILTERED_PAYMENTS.filter(p => p.channel === 'cash').reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const isAdmin = sessionStorage.getItem('role') === 'admin';

      document.getElementById('rep-pay-total').textContent = '฿' + fmt(total);
      document.getElementById('rep-pay-count').textContent = count.toLocaleString('th-TH') + ' รายการ';
      document.getElementById('rep-pay-transfer').textContent = '฿' + fmt(transfer);
      document.getElementById('rep-pay-cash').textContent = '฿' + fmt(cash);

      if (!FILTERED_PAYMENTS.length) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; color: #64748b; padding: 30px;">ไม่พบข้อมูลรายการรายรับตามเงื่อนไขที่เลือก</td></tr>';
        return;
      }

      tbody.innerHTML = FILTERED_PAYMENTS.map((p, idx) => {
        const chBadge = p.channel === 'cash'
          ? '<span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">💵 เงินสด</span>'
          : '<span style="background: #eff6ff; color: #1e40af; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">🏦 โอนเงิน</span>';
        const qText = p.quarter ? `งวดที่ ${p.quarter} (${MONTHS_TH[parseInt(p.month)-1] || p.month})` : (p.month ? `ด.${p.month}` : '-');

        return `
          <tr>
            <td style="text-align: center; color: #94a3b8;">${idx + 1}</td>
            <td style="text-align: center; font-weight: 600; color: #2563eb;">${p.payment_id}</td>
            <td style="text-align: center; font-size: 12px;">${p.paid_date || '-'}</td>
            <td style="text-align: center; font-weight: 700;">${p.house_no || '-'}</td>
            <td>${p.owner || '-'}</td>
            <td style="text-align: center; font-size: 12px;">${qText}</td>
            <td style="text-align: center;">${chBadge}</td>
            <td style="text-align: right; font-weight: 700; color: #059669;">฿${fmt(p.amount)}</td>
            <td style="text-align: center; font-size: 12px; color: #64748b;">${p.recorded_by || '-'}</td>
            <td style="font-size: 12px; color: #64748b;">${p.note || '-'}</td>
            <td style="text-align: center;">
              ${isAdmin ? `
                <button onclick="deletePayment('${p.payment_id}', '${p.house_no}', ${p.amount})" class="btn-del-record" style="padding: 2px 8px; font-size: 11px;" title="ลบรายการรับเงินนี้">
                  🗑️ ลบ
                </button>
              ` : '-'}
            </td>
          </tr>
        `;
      }).join('');
    }

    // --- 2. รายการรายจ่าย ปี 2569 ---
    async function loadAllExpensesReport() {
      const data = await fetchReportsData();
      const catSel = document.getElementById('filter-exp-cat');
      if (catSel && catSel.options.length <= 1 && data.categories) {
        catSel.innerHTML = '<option value="">ทุกหมวดหมู่ค่าใช้จ่าย</option>' +
          data.categories.map(c => `<option value="${c.category_id}">${c.name}</option>`).join('');
      }
      FILTERED_EXPENSES = data.expenses || [];
      filterAllExpenses();
    }

    function filterAllExpenses() {
      const all = (ALL_REPORTS_CACHE && ALL_REPORTS_CACHE.expenses) || [];
      const mVal = document.getElementById('filter-exp-month')?.value || '';
      const catVal = document.getElementById('filter-exp-cat')?.value || '';
      const srcVal = document.getElementById('filter-exp-source')?.value || '';
      const sVal = (document.getElementById('filter-exp-search')?.value || '').trim().toLowerCase();

      FILTERED_EXPENSES = all.filter(e => {
        if (mVal) {
          const expM = e.expense_date ? String(parseInt(e.expense_date.split('-')[1], 10)) : '';
          if (expM !== String(mVal)) return false;
        }
        if (catVal && e.category_id !== catVal) return false;
        if (srcVal && e.source !== srcVal) return false;
        if (sVal) {
          const text = `${e.doc_no} ${e.description} ${e.payee} ${e.expense_id} ${e.recorded_by}`.toLowerCase();
          if (!text.includes(sVal)) return false;
        }
        return true;
      });

      renderAllExpensesTable();
    }

    function resetExpFilter() {
      if (document.getElementById('filter-exp-search')) document.getElementById('filter-exp-search').value = '';
      if (document.getElementById('filter-exp-month')) document.getElementById('filter-exp-month').value = '';
      if (document.getElementById('filter-exp-cat')) document.getElementById('filter-exp-cat').value = '';
      if (document.getElementById('filter-exp-source')) document.getElementById('filter-exp-source').value = '';
      filterAllExpenses();
    }

    function renderAllExpensesTable() {
      const tbody = document.getElementById('tbody-all-expenses');
      if (!tbody) return;

      const total = FILTERED_EXPENSES.reduce((sum, e) => sum + Number(e.amount || 0), 0);
      const count = FILTERED_EXPENSES.length;
      const bank = FILTERED_EXPENSES.filter(e => e.source === 'bank').reduce((sum, e) => sum + Number(e.amount || 0), 0);
      const reserve = FILTERED_EXPENSES.filter(e => e.source === 'reserve').reduce((sum, e) => sum + Number(e.amount || 0), 0);

      document.getElementById('rep-exp-total').textContent = '฿' + fmt(total);
      document.getElementById('rep-exp-count').textContent = count.toLocaleString('th-TH') + ' รายการ';
      document.getElementById('rep-exp-bank').textContent = '฿' + fmt(bank);
      document.getElementById('rep-exp-reserve').textContent = '฿' + fmt(reserve);

      if (!FILTERED_EXPENSES.length) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; color: #64748b; padding: 30px;">ไม่พบข้อมูลรายการรายจ่ายตามเงื่อนไขที่เลือก</td></tr>';
        return;
      }

      tbody.innerHTML = FILTERED_EXPENSES.map((e, idx) => {
        const srcBadge = e.source === 'reserve'
          ? '<span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">💵 เงินสำรอง</span>'
          : '<span style="background: #eff6ff; color: #1e40af; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">🏦 บัญชีธนาคาร</span>';

        return `
          <tr>
            <td style="text-align: center; color: #94a3b8;">${idx + 1}</td>
            <td style="text-align: center; font-weight: 700; color: #b91c1c;">${e.doc_no || e.expense_id}</td>
            <td style="text-align: center; font-size: 12px;">${e.expense_date || '-'}</td>
            <td style="font-weight: 600;">${e.description}</td>
            <td><span style="font-size: 12px; color: #475569; background: #f1f5f9; padding: 2px 8px; border-radius: 4px;">${e.category_name}</span></td>
            <td>${e.payee || '-'}</td>
            <td style="text-align: center;">${srcBadge}</td>
            <td style="text-align: right; font-weight: 700; color: #dc2626;">฿${fmt(e.amount)}</td>
            <td style="text-align: center; font-size: 12px;"><span style="color: #059669; font-weight: 600;">${e.status || 'อนุมัติ'}</span></td>
            <td style="text-align: center; font-size: 12px; color: #64748b;">${e.recorded_by || '-'}</td>
          </tr>
        `;
      }).join('');
    }

    // --- 3. รายการรายได้อื่น ปี 69 ---
    async function loadAllIncomeReport() {
      const data = await fetchReportsData();
      FILTERED_INCOME = data.incomes || [];
      filterAllIncome();
    }

    function filterAllIncome() {
      const all = (ALL_REPORTS_CACHE && ALL_REPORTS_CACHE.incomes) || [];
      const mVal = document.getElementById('filter-inc-month')?.value || '';
      const typeVal = document.getElementById('filter-inc-type')?.value || '';
      const chVal = document.getElementById('filter-inc-channel')?.value || '';
      const sVal = (document.getElementById('filter-inc-search')?.value || '').trim().toLowerCase();

      FILTERED_INCOME = all.filter(i => {
        if (mVal) {
          const incM = i.date ? String(parseInt(i.date.split('-')[1], 10)) : '';
          if (incM !== String(mVal)) return false;
        }
        if (typeVal && i.type !== typeVal) return false;
        if (chVal && i.channel !== chVal) return false;
        if (sVal) {
          const text = `${i.income_id} ${i.type_label} ${i.note}`.toLowerCase();
          if (!text.includes(sVal)) return false;
        }
        return true;
      });

      renderAllIncomeTable();
    }

    function resetIncFilter() {
      if (document.getElementById('filter-inc-search')) document.getElementById('filter-inc-search').value = '';
      if (document.getElementById('filter-inc-month')) document.getElementById('filter-inc-month').value = '';
      if (document.getElementById('filter-inc-type')) document.getElementById('filter-inc-type').value = '';
      if (document.getElementById('filter-inc-channel')) document.getElementById('filter-inc-channel').value = '';
      filterAllIncome();
    }

    function renderAllIncomeTable() {
      const tbody = document.getElementById('tbody-all-income');
      if (!tbody) return;

      const total = FILTERED_INCOME.reduce((sum, i) => sum + Number(i.amount || 0), 0);
      const count = FILTERED_INCOME.length;
      const transfer = FILTERED_INCOME.filter(i => i.channel === 'transfer').reduce((sum, i) => sum + Number(i.amount || 0), 0);
      const cash = FILTERED_INCOME.filter(i => i.channel === 'cash').reduce((sum, i) => sum + Number(i.amount || 0), 0);

      document.getElementById('rep-inc-total').textContent = '฿' + fmt(total);
      document.getElementById('rep-inc-count').textContent = count.toLocaleString('th-TH') + ' รายการ';
      document.getElementById('rep-inc-transfer').textContent = '฿' + fmt(transfer);
      document.getElementById('rep-inc-cash').textContent = '฿' + fmt(cash);

      if (!FILTERED_INCOME.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #64748b; padding: 30px;">ไม่พบข้อมูลรายการรายได้อื่นตามเงื่อนไขที่เลือก</td></tr>';
        return;
      }

      tbody.innerHTML = FILTERED_INCOME.map((i, idx) => {
        const chBadge = i.channel === 'cash'
          ? '<span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">💵 เงินสด</span>'
          : '<span style="background: #eff6ff; color: #1e40af; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">🏦 บัญชีธนาคาร</span>';

        return `
          <tr>
            <td style="text-align: center; color: #94a3b8;">${idx + 1}</td>
            <td style="text-align: center; font-weight: 600; color: #059669;">${i.income_id}</td>
            <td style="text-align: center; font-size: 12px;">${i.date || '-'}</td>
            <td><span style="font-weight: 600; color: #0f172a;">${i.type_label}</span></td>
            <td>${i.note || '-'}</td>
            <td style="text-align: center;">${chBadge}</td>
            <td style="text-align: right; font-weight: 700; color: #059669;">฿${fmt(i.amount)}</td>
          </tr>
        `;
      }).join('');
    }

    // --- 4. ฟังก์ชันพิมพ์รายงานทางการ (Official Print Report) ---
    function printReport(type) {
      const printArea = document.getElementById('printable-report-area');
      if (!printArea) return;

      const now = new Date();
      const printTimeStr = `${formatThaiDate(todayStr())} เวลา ${now.toLocaleTimeString('th-TH')}`;

      let title = '';
      let tableHtml = '';
      let summaryText = '';

      if (type === 'payments') {
        title = 'รายงานรายการรายรับค่ากองทุนพัฒนาหมู่บ้าน';
        const total = FILTERED_PAYMENTS.reduce((sum, p) => sum + Number(p.amount || 0), 0);
        summaryText = `รวมรายการรับชำระทั้งสิ้น <b>${FILTERED_PAYMENTS.length.toLocaleString('th-TH')}</b> รายการ รวมเป็นเงินทั้งสิ้น <b>฿${fmt(total)}</b> (${thaiBaht(total)})`;

        tableHtml = `
          <table class="report-paper-table">
            <thead>
              <tr>
                <th style="width: 40px;">ลำดับ</th>
                <th style="width: 70px;">รหัส</th>
                <th style="width: 80px;">วันที่</th>
                <th style="width: 75px;">บ้านเลขที่</th>
                <th>ชื่อ-สกุล สมาชิก</th>
                <th style="width: 90px;">งวด/เดือน</th>
                <th style="width: 70px;">ช่องทาง</th>
                <th style="width: 90px; text-align: right;">จำนวนเงิน</th>
                <th style="width: 70px;">ผู้บันทึก</th>
              </tr>
            </thead>
            <tbody>
              ${FILTERED_PAYMENTS.map((p, idx) => `
                <tr>
                  <td style="text-align: center;">${idx + 1}</td>
                  <td style="text-align: center; font-weight: 600;">${p.payment_id}</td>
                  <td style="text-align: center;">${p.paid_date || '-'}</td>
                  <td style="text-align: center; font-weight: 600;">${p.house_no}</td>
                  <td>${p.owner}</td>
                  <td style="text-align: center;">${p.quarter ? 'งวดที่ ' + p.quarter : (p.month || '-')}</td>
                  <td style="text-align: center;">${p.channel === 'cash' ? 'เงินสด' : 'โอนเงิน'}</td>
                  <td style="text-align: right; font-weight: 600;">฿${fmt(p.amount)}</td>
                  <td style="text-align: center; font-size: 11px;">${p.recorded_by || '-'}</td>
                </tr>
              `).join('')}
              <tr class="total-row">
                <td colspan="7" style="text-align: right; font-weight: 700;">รวมยอดเงินรายรับทั้งสิ้น (${FILTERED_PAYMENTS.length} รายการ):</td>
                <td style="text-align: right; font-weight: 700; color: #059669;">฿${fmt(total)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        `;
      } else if (type === 'expenses') {
        title = 'รายงานรายการรายจ่ายกองทุนพัฒนาหมู่บ้าน';
        const total = FILTERED_EXPENSES.reduce((sum, e) => sum + Number(e.amount || 0), 0);
        summaryText = `รวมรายการเบิกจ่ายทั้งสิ้น <b>${FILTERED_EXPENSES.length.toLocaleString('th-TH')}</b> รายการ รวมเป็นเงินทั้งสิ้น <b>฿${fmt(total)}</b> (${thaiBaht(total)})`;

        tableHtml = `
          <table class="report-paper-table">
            <thead>
              <tr>
                <th style="width: 40px;">ลำดับ</th>
                <th style="width: 70px;">เลขที่</th>
                <th style="width: 80px;">วันที่จ่าย</th>
                <th>รายการค่าใช้จ่าย</th>
                <th style="width: 120px;">หมวดหมู่</th>
                <th style="width: 120px;">ผู้รับเงิน / หน่วยงาน</th>
                <th style="width: 85px;">แหล่งเงิน</th>
                <th style="width: 90px; text-align: right;">จำนวนเงิน</th>
                <th style="width: 65px;">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              ${FILTERED_EXPENSES.map((e, idx) => `
                <tr>
                  <td style="text-align: center;">${idx + 1}</td>
                  <td style="text-align: center; font-weight: 600;">${e.doc_no || e.expense_id}</td>
                  <td style="text-align: center;">${e.expense_date || '-'}</td>
                  <td style="font-weight: 600;">${e.description}</td>
                  <td>${e.category_name}</td>
                  <td>${e.payee || '-'}</td>
                  <td style="text-align: center;">${e.source === 'reserve' ? 'เงินสำรอง' : 'ธนาคาร'}</td>
                  <td style="text-align: right; font-weight: 600;">฿${fmt(e.amount)}</td>
                  <td style="text-align: center; font-size: 11px;">${e.status || 'อนุมัติ'}</td>
                </tr>
              `).join('')}
              <tr class="total-row">
                <td colspan="7" style="text-align: right; font-weight: 700;">รวมยอดเงินรายจ่ายทั้งสิ้น (${FILTERED_EXPENSES.length} รายการ):</td>
                <td style="text-align: right; font-weight: 700; color: #dc2626;">฿${fmt(total)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        `;
      } else if (type === 'income') {
        title = 'รายงานรายการรายได้อื่นกองทุนพัฒนาหมู่บ้าน';
        const total = FILTERED_INCOME.reduce((sum, i) => sum + Number(i.amount || 0), 0);
        summaryText = `รวมรายการรายได้อื่นทั้งสิ้น <b>${FILTERED_INCOME.length.toLocaleString('th-TH')}</b> รายการ รวมเป็นเงินทั้งสิ้น <b>฿${fmt(total)}</b> (${thaiBaht(total)})`;

        tableHtml = `
          <table class="report-paper-table">
            <thead>
              <tr>
                <th style="width: 40px;">ลำดับ</th>
                <th style="width: 75px;">รหัส</th>
                <th style="width: 85px;">วันที่ได้รับ</th>
                <th style="width: 120px;">ประเภทรายได้</th>
                <th>รายละเอียด / ผู้บริจาค / แหล่งที่มา</th>
                <th style="width: 90px;">ช่องทาง</th>
                <th style="width: 100px; text-align: right;">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              ${FILTERED_INCOME.map((i, idx) => `
                <tr>
                  <td style="text-align: center;">${idx + 1}</td>
                  <td style="text-align: center; font-weight: 600;">${i.income_id}</td>
                  <td style="text-align: center;">${i.date || '-'}</td>
                  <td style="font-weight: 600;">${i.type_label}</td>
                  <td>${i.note || '-'}</td>
                  <td style="text-align: center;">${i.channel === 'cash' ? 'เงินสด' : 'บัญชีธนาคาร'}</td>
                  <td style="text-align: right; font-weight: 600;">฿${fmt(i.amount)}</td>
                </tr>
              `).join('')}
              <tr class="total-row">
                <td colspan="6" style="text-align: right; font-weight: 700;">รวมยอดเงินรายได้อื่นทั้งสิ้น (${FILTERED_INCOME.length} รายการ):</td>
                <td style="text-align: right; font-weight: 700; color: #059669;">฿${fmt(total)}</td>
              </tr>
            </tbody>
          </table>
        `;
      }

      printArea.innerHTML = `
        <div style="font-family: 'Sarabun', 'Prompt', sans-serif; color: #000; padding: 10px;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="font-size: 19px; margin: 0 0 4px 0; font-weight: 700;">กองทุนพัฒนาหมู่บ้าน ลพบุรีราเมศวร์ โครงการ 1</h2>
            <p style="font-size: 13px; margin: 0 0 4px 0; color: #475569;">หมู่ที่ 2 ตำบลน้ำน้อย อำเภอหาดใหญ่ จังหวัดสงขลา</p>
            <h3 style="font-size: 16px; margin: 6px 0; font-weight: 700; text-decoration: underline;">${title} ประจำปีงบประมาณ 2569</h3>
            <p style="font-size: 12px; margin: 4px 0; color: #64748b;">พิมพ์ออกรายงาน ณ วันที่ ${printTimeStr}</p>
          </div>

          <div style="background: #f8fafc; border: 1px solid #cbd5e1; padding: 8px 14px; border-radius: 6px; font-size: 12px; margin-bottom: 12px;">
            ${summaryText}
          </div>

          ${tableHtml}

          <!-- Signatures Block -->
          <div style="display: flex; justify-content: space-between; margin-top: 45px; page-break-inside: avoid; break-inside: avoid;">
            <div style="text-align: center; width: 30%;">
              <p style="margin-bottom: 45px;">ลงชื่อ .....................................................</p>
              <p style="font-weight: 600; margin: 0; font-size: 13px;">( ..................................................... )</p>
              <p style="font-size: 12px; color: #64748b; margin: 2px 0;">ผู้จัดทำรายงาน / เจ้าหน้าที่การเงิน</p>
            </div>
            <div style="text-align: center; width: 30%;">
              <p style="margin-bottom: 45px;">ลงชื่อ .....................................................</p>
              <p style="font-weight: 600; margin: 0; font-size: 13px;">(น.ส.วีระออ สุวรรณสิทธิ์)</p>
              <p style="font-size: 12px; color: #64748b; margin: 2px 0;">เหรัญญิก ผู้รับเงิน</p>
            </div>
            <div style="text-align: center; width: 30%;">
              <p style="margin-bottom: 45px;">ลงชื่อ .....................................................</p>
              <p style="font-weight: 600; margin: 0; font-size: 13px;">(นายสุนทร คำสุข)</p>
              <p style="font-size: 12px; color: #64748b; margin: 2px 0;">ประธานคณะทำงานกองทุนพัฒนาหมู่บ้าน<br>ลพบุรีราเมศวร์โครงการ 1</p>
            </div>
          </div>
        </div>
      `;

      document.body.classList.add('printing-report');
      window.print();
      setTimeout(() => {
        document.body.classList.remove('printing-report');
      }, 1000);
    }

    // --- 5. ฟังก์ชันส่งออก Excel (CSV with BOM) ---
    function exportReportExcel(type) {
      let csv = '\uFEFF';
      let filename = 'report_2569.csv';

      if (type === 'payments') {
        filename = 'รายรับ_ปี2569.csv';
        csv += 'ลำดับ,รหัสรายการ,วันที่รับชำระ,บ้านเลขที่,สมาชิก/เจ้าของ,งวด/เดือน,ช่องทาง,จำนวนเงิน,ผู้บันทึก,หมายเหตุ\n';
        FILTERED_PAYMENTS.forEach((p, idx) => {
          const ch = p.channel === 'cash' ? 'เงินสด' : 'โอนเงิน';
          const q = p.quarter ? `งวดที่ ${p.quarter}` : (p.month || '');
          csv += `"${idx + 1}","${p.payment_id}","${p.paid_date || ''}","${p.house_no}","${p.owner}","${q}","${ch}",${p.amount},"${p.recorded_by || ''}","${p.note || ''}"\n`;
        });
      } else if (type === 'expenses') {
        filename = 'รายจ่าย_ปี2569.csv';
        csv += 'ลำดับ,เลขที่,วันที่จ่าย,รายการค่าใช้จ่าย,หมวดหมู่,ผู้รับเงิน/หน่วยงาน,แหล่งเงิน,จำนวนเงิน,สถานะ,ผู้บันทึก\n';
        FILTERED_EXPENSES.forEach((e, idx) => {
          const src = e.source === 'reserve' ? 'เงินสำรอง' : 'บัญชีธนาคาร';
          csv += `"${idx + 1}","${e.doc_no || e.expense_id}","${e.expense_date || ''}","${e.description}","${e.category_name}","${e.payee || ''}","${src}",${e.amount},"${e.status || 'อนุมัติ'}","${e.recorded_by || ''}"\n`;
        });
      } else if (type === 'income') {
        filename = 'รายได้อื่น_ปี69.csv';
        csv += 'ลำดับ,รหัสรายการ,วันที่ได้รับ,ประเภทรายได้,รายละเอียด/แหล่งที่มา,ช่องทาง,จำนวนเงิน\n';
        FILTERED_INCOME.forEach((i, idx) => {
          const ch = i.channel === 'cash' ? 'เงินสด' : 'บัญชีธนาคาร';
          csv += `"${idx + 1}","${i.income_id}","${i.date || ''}","${i.type_label}","${i.note || ''}","${ch}",${i.amount}\n`;
        });
      }

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    initStaff();

    window.showSlipModal = function(houseId, periodNum = 0) {
      const h = HOUSES.find(x => x.house_id === houseId);
      if (!h) return;

      const modal = document.getElementById('slip-modal');
      const title = document.getElementById('slip-modal-title');
      const subtitle = document.getElementById('slip-modal-subtitle');
      const body = document.getElementById('slip-modal-body');
      const btnDrive = document.getElementById('slip-btn-drive');

      title.innerHTML = `หลักฐานการชำระเงิน · บ้านเลขที่ ${h.house_no}`;
      const periodLabel = periodNum > 0 ? `งวดที่ ${periodNum}` : 'ประวัติทั้งหมด';
      subtitle.innerHTML = `${h.zone} · เจ้าของ: ${h.owner_full || '-'} · ${periodLabel}`;

      let slipUrl = '';
      let targetDate = '';
      let targetChannel = '';
      let targetTime = '';
      let targetPid = '';

      if (periodNum > 0 && h.quarters && h.quarters[periodNum - 1]) {
        const q = h.quarters[periodNum - 1];
        slipUrl = q.slip_url || '';
        targetDate = q.paid_date || '';
        targetChannel = q.channel || '';
        targetTime = q.transfer_time || '';
        targetPid = q.payment_id || '';
      }

      if (!slipUrl && h.slips && h.slips.length > 0) {
        slipUrl = h.slips[0].url || '';
        targetDate = targetDate || h.slips[0].date;
        targetChannel = targetChannel || h.slips[0].channel;
        targetPid = targetPid || h.slips[0].payment_id;
      }

      if (slipUrl) {
        body.innerHTML = `
          <div class="slip-preview-container">
            <a href="${slipUrl}" target="_blank" title="คลิกเพื่อเปิดดูภาพขนาดเต็ม">
              <img src="${slipUrl}" alt="สลิปการโอนเงิน" class="slip-preview-image">
            </a>
          </div>
          <div style="background: #f8fafc; border-radius: 10px; padding: 12px 16px; font-size: 13px; text-align: left; line-height: 1.8; border: 1px solid #e2e8f0;">
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748b;">วันที่ชำระเงิน:</span>
              <b>${targetDate || '-'}</b>
            </div>
            ${targetTime ? `
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748b;">เวลาโอน:</span>
              <b>${targetTime} น.</b>
            </div>` : ''}
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748b;">ช่องทางชำระ:</span>
              <span style="color: #059669; font-weight: 600;">${targetChannel === 'cash' ? '💵 เงินสด' : '🏦 โอนผ่านธนาคาร'}</span>
            </div>
            ${targetPid ? `
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #64748b;">รหัสรายการ:</span>
              <code>${targetPid}</code>
            </div>` : ''}
          </div>
        `;
        if (btnDrive) {
          btnDrive.style.display = 'inline-flex';
          btnDrive.href = slipUrl;
        }
      } else {
        body.innerHTML = `
          <div class="slip-empty-state">
            <div class="slip-empty-icon">🧾</div>
            <h3 style="margin: 0 0 8px 0; color: #1e293b; font-size: 18px;">ไม่มีสลิป</h3>
            <p style="margin: 0 0 16px 0; font-size: 13px; color: #64748b; line-height: 1.6;">
              รายการชำระนี้ <b>ไม่มีไฟล์ภาพสลิปแนบไว้ในระบบ</b><br>
              (อาจชำระด้วย <b>เงินสด</b> หรือเจ้าหน้าที่บันทึกรับเงินโดยตรง)
            </p>
            <div style="background: #ffffff; border-radius: 8px; padding: 12px 16px; font-size: 13px; text-align: left; line-height: 1.8; border: 1px solid #e2e8f0; display: inline-block; min-width: 260px;">
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #64748b;">สถานะในระบบ:</span>
                <b style="color: #059669;">✓ บันทึกรับชำระแล้ว</b>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #64748b;">วันที่ชำระ:</span>
                <span>${targetDate || '-'}</span>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: #64748b;">ช่องทาง:</span>
                <span>${targetChannel === 'cash' ? '💵 เงินสด' : '🏦 โอนเงิน'}</span>
              </div>
            </div>
          </div>
        `;
        if (btnDrive) btnDrive.style.display = 'none';
      }

      if (modal) modal.style.display = 'flex';
    };

    window.closeSlipModal = function(e) {
      if (e && e.target && e.target.classList && !e.target.classList.contains('slip-modal-backdrop') && !e.target.closest('.btn-icon') && !e.target.classList.contains('btn-secondary')) {
        return;
      }
      const modal = document.getElementById('slip-modal');
      if (modal) modal.style.display = 'none';
    };
