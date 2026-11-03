/**
 * Tab: บัญชีรายรับ-รายจ่าย (General Ledger - Requirement 3)
 * แสดงรายการความเคลื่อนไหวรายรับ-รายจ่ายตามตัวกรอง (ไม่ตรึงยอดยกมาในตาราง)
 */
(function() {
  window.StaffTabs = window.StaffTabs || {};

  let ALL_TRANSACTIONS = [];
  let OPENING_BANK = 82969.73;
  let OPENING_RESERVE = 10049.57;
  let OPENING_ALL = 93019.30;
  let SERVER_BALANCE = null;

  window.StaffTabs.ledger = async function() {
    await loadLedgerData();
  };

  async function loadLedgerData() {
    const tableBody = document.getElementById('ledger-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 40px; color: #64748b;">⏳ กำลังโหลดข้อมูลบัญชีรายรับ-รายจ่ายจากระบบ...</td></tr>';

    try {
      const data = await StaffAPI.call('/api/staff/reports/all');
      if (!data) return;

      SERVER_BALANCE = data.balance || {};
      const openBank = Number(data.opening_balance || 82969.73);
      const openRes = Number(data.opening_reserve || 10049.57);
      const openTotal = Math.round((openBank + openRes) * 100) / 100;

      OPENING_BANK = openBank;       // 82,969.73 (สมุดบัญชีเงินฝาก ธ.กรุงเทพ)
      OPENING_RESERVE = openRes;     // 10,049.57 (เงินสดสำรองจ่าย/เงินสดย่อย)
      OPENING_ALL = openTotal;       // 93,019.30 (รวมทุกบัญชี)

      const txs = [];

      // 1. Payments (รายรับค่าส่วนกลาง)
      (data.payments || []).forEach(p => {
        const amt = Number(p.amount || p.amount_paid || 0);
        if (amt <= 0) return;

        const hNo = p.house_no ? `บ้าน ${p.house_no}` : (p.house_id ? `บ้าน ${p.house_id}` : '-');
        const mNum = parseInt(p.month, 10);
        const monthName = (!isNaN(mNum) && mNum >= 1 && mNum <= 12) ? 
          ` (งวดเดือน ${window.MONTHS_TH ? window.MONTHS_TH[mNum - 1] : mNum})` : 
          (p.month ? ` (เดือน ${p.month})` : '');
        const ownerStr = (p.owner && p.owner !== '-') ? ` · ${p.owner}` : '';
        const isBank = (p.channel || 'transfer') !== 'cash';

        txs.push({
          id: p.payment_id,
          doc_no: p.payment_id,
          date: p.paid_date || '2026-01-01',
          time: p.transfer_time || '',
          title: `รับชำระค่าส่วนกลาง ${hNo}${monthName}${ownerStr}`,
          category: 'ค่าส่วนกลาง',
          account: isBank ? 'bank' : 'cash',
          account_label: isBank ? 'ธนาคารกรุงเทพ' : 'เงินสด',
          type: 'inflow',
          inflow: amt,
          outflow: 0,
          slip_url: p.slip_url || '',
          note: p.note || ''
        });
      });

      // 2. Expenses (รายจ่ายกองทุน)
      (data.expenses || []).forEach(e => {
        const amt = Number(e.amount || 0);
        if (amt <= 0) return;

        const isBank = (e.source || 'bank') !== 'reserve';
        const catName = e.category_name || (e.category_id || 'ค่าใช้จ่ายทั่วไป');

        txs.push({
          id: e.expense_id,
          doc_no: e.doc_no || e.expense_id,
          date: e.expense_date || '2026-01-01',
          time: '',
          title: e.description || 'ค่าใช้จ่ายกองทุน',
          category: catName,
          account: isBank ? 'bank' : 'cash',
          account_label: isBank ? 'ธนาคารกรุงเทพ' : 'เงินสดย่อย',
          type: 'outflow',
          inflow: 0,
          outflow: amt,
          slip_url: '',
          payee: e.payee || '',
          note: e.payee ? `ผู้รับเงิน: ${e.payee}` : ''
        });
      });

      // 3. Other Incomes (รายได้อื่น เช่น ดอกเบี้ย / บริจาค)
      (data.incomes || []).forEach(i => {
        const amt = Number(i.amount || 0);
        if (amt <= 0) return;

        const isBank = (i.channel || 'bank') !== 'cash';
        const typeLabel = i.type_label || (i.type === 'interest' ? 'ดอกเบี้ยเงินฝาก' : (i.type === 'donation' ? 'เงินบริจาค' : (i.type || 'รายได้อื่น')));

        txs.push({
          id: i.income_id,
          doc_no: i.income_id,
          date: i.date || '2026-01-01',
          time: '',
          title: `รายรับ: ${typeLabel}`,
          category: typeLabel,
          account: isBank ? 'bank' : 'cash',
          account_label: isBank ? 'ธนาคารกรุงเทพ' : 'เงินสด',
          type: 'inflow',
          inflow: amt,
          outflow: 0,
          slip_url: '',
          note: i.note || ''
        });
      });

      // 4. Reserve transfers (โอนจากธนาคารมาเติมเงินสดย่อย - ข้าม RT0001 ที่เป็นยอดยกมา)
      (data.reserve || []).forEach(r => {
        if (r.type === 'in' && r.rt_id !== 'RT0001') {
          const amt = Number(r.amount || 0);
          if (amt <= 0) return;

          txs.push({
            id: r.rt_id,
            doc_no: r.rt_id,
            date: r.date || '2026-01-01',
            time: '',
            title: r.note || 'เบิกเงินจากธนาคารมาเติมเงินสดย่อย',
            category: 'โอนระหว่างบัญชี',
            account: 'transfer',
            account_label: 'โอนย้ายบัญชี',
            type: 'transfer',
            transfer_amount: amt,
            inflow: 0,
            outflow: 0,
            slip_url: '',
            note: r.note || ''
          });
        }
      });

      // Sort chronological ascending (oldest first so running balance increases logically)
      txs.sort((a, b) => {
        const da = (a.date || '') + ' ' + (a.time || '');
        const db = (b.date || '') + ' ' + (b.time || '');
        return da.localeCompare(db) || (a.id || '').localeCompare(b.id || '');
      });

      ALL_TRANSACTIONS = txs;
      window.renderLedgerView();
    } catch (err) {
      console.error('Ledger error:', err);
      tableBody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:30px; color:#ef4444;">❌ โหลดข้อมูลไม่สำเร็จ: ${err.message}</td></tr>`;
    }
  }

  window.renderLedgerView = function() {
    const accFilter = (document.getElementById('ledger-filter-account') || {}).value || 'all';
    const monthFilter = (document.getElementById('ledger-filter-month') || {}).value || 'all';
    const typeFilter = (document.getElementById('ledger-filter-type') || {}).value || 'all';
    const keyword = ((document.getElementById('ledger-filter-search') || {}).value || '').trim().toLowerCase();

    let baseOpen = 0;
    if (accFilter === 'bank') {
      baseOpen = OPENING_BANK;       // 82,969.73
    } else if (accFilter === 'cash') {
      baseOpen = OPENING_RESERVE;   // 10,049.57
    } else {
      baseOpen = OPENING_ALL;       // 93,019.30
    }

    const isSingleMonth = monthFilter !== 'all';
    const selectedMonth = isSingleMonth ? parseInt(monthFilter, 10) : null;

    // คำนวณยอดยกมาสะสมก่อนเริ่มเดือนนั้น (กรณีเลือกดูรายเดือน)
    let priorBal = baseOpen;
    if (isSingleMonth) {
      ALL_TRANSACTIONS.forEach(tx => {
        let txIn = 0;
        let txOut = 0;

        if (tx.type === 'transfer') {
          if (accFilter === 'bank') txOut = tx.transfer_amount;
          else if (accFilter === 'cash') txIn = tx.transfer_amount;
        } else {
          if (accFilter === 'bank' && tx.account !== 'bank') return;
          if (accFilter === 'cash' && tx.account !== 'cash') return;
          txIn = tx.inflow;
          txOut = tx.outflow;
        }

        const parts = (tx.date || '').split('-');
        const m = parseInt(parts[1], 10);
        if (!isNaN(m) && m < selectedMonth) {
          priorBal += (txIn - txOut);
        }
      });
    }

    let runningBal = priorBal;
    let totalInflow = 0;
    let totalOutflow = 0;
    let countInflow = 0;
    let countOutflow = 0;

    const rowsHtml = [];
    let itemIndex = 0;

    // หมายเหตุ: ไม่ตรึงแถวยอดยกมาในตารางตามคำขอ แสดงเฉพาะรายการตามตัวกรอง
    ALL_TRANSACTIONS.forEach(tx => {
      let txInflow = 0;
      let txOutflow = 0;

      if (tx.type === 'transfer') {
        // โอนเงินจากธนาคารมาเติมเงินสดย่อย
        if (accFilter === 'bank') {
          txOutflow = tx.transfer_amount;
        } else if (accFilter === 'cash') {
          txInflow = tx.transfer_amount;
        } else {
          // รวมทุกบัญชี เงินยังอยู่ในกองทุน จึงไม่กระทบยอดสุทธิรวม
        }
      } else {
        if (accFilter === 'bank' && tx.account !== 'bank') return;
        if (accFilter === 'cash' && tx.account !== 'cash') return;
        txInflow = tx.inflow;
        txOutflow = tx.outflow;
      }

      // Month filter: แสดงเฉพาะเดือนที่เลือก
      if (isSingleMonth) {
        const parts = (tx.date || '').split('-');
        const m = parseInt(parts[1], 10);
        if (m !== selectedMonth) return;
      }

      // Type filter
      if (typeFilter === 'inflow' && txInflow === 0) return;
      if (typeFilter === 'outflow' && txOutflow === 0) return;

      // Keyword search
      if (keyword) {
        const searchStr = `${tx.id} ${tx.doc_no || ''} ${tx.title} ${tx.category} ${tx.note} ${tx.payee || ''}`.toLowerCase();
        if (!searchStr.includes(keyword)) return;
      }

      runningBal += (txInflow - txOutflow);
      if (txInflow > 0) {
        totalInflow += txInflow;
        countInflow++;
      }
      if (txOutflow > 0) {
        totalOutflow += txOutflow;
        countOutflow++;
      }
      itemIndex++;

      const slipBtn = tx.slip_url ? `
        <button onclick="window.showSlipDirect('${tx.slip_url}', '${tx.title.replace(/'/g, "\\'")}')" class="btn btn-sm" style="background:#f0f9ff; color:#0284c7; padding:4px 10px; border-radius:6px; font-size:11.5px; font-weight:500; border:1px solid #bae6fd; cursor:pointer; display:inline-flex; align-items:center; gap:4px;" title="คลิกดูภาพสลิป">
          🖼️ ดูสลิป
        </button>
      ` : '<span style="color:#cbd5e1;">-</span>';

      const accBadge = tx.account === 'bank' ? 
        '<span style="background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; font-size:11.5px; font-weight:500; padding:3px 9px; border-radius:9999px; display:inline-block; white-space:nowrap;">🏦 ธนาคาร</span>' : 
        (tx.account === 'cash' ? '<span style="background:#fffbeb; color:#b45309; border:1px solid #fde68a; font-size:11.5px; font-weight:500; padding:3px 9px; border-radius:9999px; display:inline-block; white-space:nowrap;">💵 เงินสด</span>' : '<span style="background:#faf5ff; color:#7e22ce; border:1px solid #e9d5ff; font-size:11.5px; font-weight:500; padding:3px 9px; border-radius:9999px; display:inline-block; white-space:nowrap;">🔄 โอนย้าย</span>');

      rowsHtml.push(`
        <tr>
          <td style="text-align: center; vertical-align: middle;">
            <span class="ledger-index-badge">${itemIndex}</span>
          </td>
          <td style="text-align: center; white-space: nowrap; vertical-align: middle;">
            <div style="font-weight: 500; color: #1e293b; font-size: 12.5px;">${tx.date}</div>
            ${tx.time ? `<div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">${tx.time} น.</div>` : ''}
          </td>
          <td style="text-align: center; vertical-align: middle;">
            <code style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 3px 8px; border-radius: 6px; font-size: 11.5px; color: #475569; font-weight: 600;">${tx.doc_no || tx.id}</code>
          </td>
          <td style="vertical-align: middle; text-align: left;">
            <div class="ledger-desc-text">${tx.title}</div>
            ${tx.note && tx.note !== tx.title ? `<div class="ledger-desc-note">📝 ${tx.note}</div>` : ''}
          </td>
          <td style="text-align: center; vertical-align: middle;">${accBadge}</td>
          <td style="text-align: right; vertical-align: middle; font-size: 13px; color: ${txInflow > 0 ? '#059669; font-weight: 600;' : '#cbd5e1;'}">
            ${txInflow > 0 ? '+฿' + StaffAPI.fmt(txInflow) : '-'}
          </td>
          <td style="text-align: right; vertical-align: middle; font-size: 13px; color: ${txOutflow > 0 ? '#dc2626; font-weight: 600;' : '#cbd5e1;'}">
            ${txOutflow > 0 ? '-฿' + StaffAPI.fmt(txOutflow) : '-'}
          </td>
          <td style="text-align: right; vertical-align: middle; font-size: 13.5px; font-weight: 700; color: #1e3a8a;">
            ฿${StaffAPI.fmt(runningBal)}
          </td>
          <td style="text-align: center; vertical-align: middle;">${slipBtn}</td>
        </tr>
      `);
    });

    const tableBody = document.getElementById('ledger-table-body');
    if (tableBody) {
      if (itemIndex === 0) {
        tableBody.innerHTML = `
          <tr><td colspan="9" style="text-align:center; padding:40px; color:#64748b;">ไม่พบรายการที่ตรงกับเงื่อนไขตัวกรอง</td></tr>
        `;
      } else {
        tableBody.innerHTML = rowsHtml.join('');
      }
    }

    // Update Top Summary KPI Cards dynamically based on filter
    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    const monthLabel = isSingleMonth ? (window.MONTHS_TH ? window.MONTHS_TH[selectedMonth - 1] : `เดือน ${selectedMonth}`) : 'ปี 2569';
    const openTitle = isSingleMonth ? `ยอดยกมาต้นเดือน (${monthLabel})` : 'ยอดยกมาจากปี 2568';
    const openSub = isSingleMonth ? 
      `ยอดคงเหลือสะสมก่อนเริ่มเดือน ${monthLabel}` : 
      (accFilter === 'all' ? 'ธนาคาร ฿82,969.73 + เงินสด ฿10,049.57' : (accFilter === 'bank' ? 'บัญชีเงินฝาก ธ.กรุงเทพ' : 'บัญชีเงินสดสำรองจ่าย'));

    setEl('ledger-stat-opening-title', openTitle);
    setEl('ledger-stat-opening', '฿' + StaffAPI.fmt(priorBal));
    setEl('ledger-stat-opening-sub', openSub);

    setEl('ledger-stat-inflow-title', isSingleMonth ? `รวมรายรับ (${monthLabel})` : 'รวมรายรับทั้งสิ้น (+)');
    setEl('ledger-stat-inflow', '+฿' + StaffAPI.fmt(totalInflow));
    setEl('ledger-stat-inflow-sub', `${countInflow.toLocaleString('th-TH')} รายการ`);

    setEl('ledger-stat-outflow-title', isSingleMonth ? `รวมรายจ่าย (${monthLabel})` : 'รวมรายจ่ายทั้งสิ้น (-)');
    setEl('ledger-stat-outflow', '-฿' + StaffAPI.fmt(totalOutflow));
    setEl('ledger-stat-outflow-sub', `${countOutflow.toLocaleString('th-TH')} รายการ`);

    setEl('ledger-stat-balance-title', isSingleMonth ? `ยอดคงเหลือสิ้นเดือน (${monthLabel})` : 'ยอดคงเหลือสุทธิยกไป');
    setEl('ledger-stat-balance', '฿' + StaffAPI.fmt(runningBal));
    setEl('ledger-stat-balance-sub', accFilter === 'all' ? 'รวมทุกบัญชี' : (accFilter === 'bank' ? 'บัญชีธนาคารกรุงเทพ' : 'บัญชีเงินสดย่อย'));
  };

  // Helper for direct slip viewing
  window.showSlipDirect = function(url, title) {
    if (!url) return;
    const modal = document.getElementById('slip-modal');
    const modalTitle = document.getElementById('slip-modal-title');
    const modalSubtitle = document.getElementById('slip-modal-subtitle');
    const modalBody = document.getElementById('slip-modal-body');
    const btnDrive = document.getElementById('slip-btn-drive');

    if (modalTitle) modalTitle.textContent = 'หลักฐานสลิปการโอนเงิน';
    if (modalSubtitle) modalSubtitle.textContent = title || 'กองทุนพัฒนาหมู่บ้าน ลพบุรีราเมศวร์ธานี';

    if (modalBody) {
      modalBody.innerHTML = `
        <div class="slip-preview-container" style="text-align: center; padding: 15px 0;">
          <a href="${url}" target="_blank" title="คลิกเพื่อเปิดดูภาพขนาดเต็ม">
            <img src="${url}" alt="สลิปการโอนเงิน" style="max-width: 100%; max-height: 480px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
          </a>
        </div>
      `;
    }

    if (btnDrive) {
      btnDrive.href = url;
      btnDrive.style.display = 'inline-flex';
    }

    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('show');
    }
  };

  // Export CSV (Exports filtered transactions strictly)
  window.exportLedgerCSV = function() {
    if (!ALL_TRANSACTIONS.length) {
      alert('ไม่มีข้อมูลสำหรับส่งออก');
      return;
    }

    const accFilter = (document.getElementById('ledger-filter-account') || {}).value || 'all';
    const monthFilter = (document.getElementById('ledger-filter-month') || {}).value || 'all';
    const typeFilter = (document.getElementById('ledger-filter-type') || {}).value || 'all';
    const keyword = ((document.getElementById('ledger-filter-search') || {}).value || '').trim().toLowerCase();

    const isSingleMonth = monthFilter !== 'all';
    const selectedMonth = isSingleMonth ? parseInt(monthFilter, 10) : null;

    let baseOpen = (accFilter === 'bank') ? OPENING_BANK : ((accFilter === 'cash') ? OPENING_RESERVE : OPENING_ALL);
    let prior = baseOpen;

    if (isSingleMonth) {
      ALL_TRANSACTIONS.forEach(tx => {
        let txIn = 0, txOut = 0;
        if (tx.type === 'transfer') {
          if (accFilter === 'bank') txOut = tx.transfer_amount;
          else if (accFilter === 'cash') txIn = tx.transfer_amount;
        } else {
          if (accFilter === 'bank' && tx.account !== 'bank') return;
          if (accFilter === 'cash' && tx.account !== 'cash') return;
          txIn = tx.inflow;
          txOut = tx.outflow;
        }
        const m = parseInt((tx.date || '').split('-')[1], 10);
        if (!isNaN(m) && m < selectedMonth) prior += (txIn - txOut);
      });
    }

    let running = prior;
    let csvContent = '\uFEFF';
    csvContent += 'ลำดับ,วันที่,เวลา,เลขที่เอกสาร,รายการ,บัญชี,รายรับ (+),รายจ่าย (-),คงเหลือสะสม,หมายเหตุ\n';

    let idx = 0;
    ALL_TRANSACTIONS.forEach(tx => {
      let txIn = 0;
      let txOut = 0;

      if (tx.type === 'transfer') {
        if (accFilter === 'bank') txOut = tx.transfer_amount;
        else if (accFilter === 'cash') txIn = tx.transfer_amount;
      } else {
        if (accFilter === 'bank' && tx.account !== 'bank') return;
        if (accFilter === 'cash' && tx.account !== 'cash') return;
        txIn = tx.inflow;
        txOut = tx.outflow;
      }

      if (isSingleMonth) {
        const m = parseInt((tx.date || '').split('-')[1], 10);
        if (m !== selectedMonth) return;
      }

      if (typeFilter === 'inflow' && txIn === 0) return;
      if (typeFilter === 'outflow' && txOut === 0) return;

      if (keyword) {
        const searchStr = `${tx.id} ${tx.doc_no || ''} ${tx.title} ${tx.category} ${tx.note} ${tx.payee || ''}`.toLowerCase();
        if (!searchStr.includes(keyword)) return;
      }

      running += (txIn - txOut);
      idx++;

      const cleanTitle = `"${(tx.title || '').replace(/"/g, '""')}"`;
      const cleanNote = `"${(tx.note || '').replace(/"/g, '""')}"`;
      csvContent += `${idx},"${tx.date}","${tx.time}","${tx.doc_no || tx.id}",${cleanTitle},"${tx.account_label}",${txIn || 0},${txOut || 0},${running},${cleanNote}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Ledger_${accFilter}_month_${monthFilter}_2569.csv`;
    link.click();
  };
})();
