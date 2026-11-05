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
    tableBody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px; color: #64748b;">⏳ กำลังโหลดข้อมูลบัญชีรายรับ-รายจ่ายจากระบบ...</td></tr>';
    try {
      const data = await StaffAPI.call('/api/staff/reports/all');
      if (!data) return;
      SERVER_BALANCE = data.balance || {};
      const openTotal = Number(data.opening_balance || 82969.73);
      const openRes = Number(data.opening_reserve || 10049.57);
      const openBank = (data.opening_bank !== undefined) ? Number(data.opening_bank) : Math.round((openTotal - openRes) * 100) / 100;
      OPENING_ALL = openTotal;       // 82,969.73 (รวมทุกบัญชี ยกมาจากปี 2568)
      OPENING_BANK = openBank;       // 72,920.16 (สมุดบัญชีเงินฝาก ธ.กรุงเทพ)
      OPENING_RESERVE = openRes;     // 10,049.57 (เงินสดสำรองจ่าย/เงินสดย่อย)
      const txs = [];
      // 1. Payments (รายรับค่าส่วนกลาง)
      (data.payments || []).forEach(p => {
        const amt = Number(p.amount || p.amount_paid || 0);
        if (amt <= 0) return;
        const hNo = p.house_no ? `บ้าน ${p.house_no}` : (p.house_id ? `บ้าน ${p.house_id}` : '-');
        const pr = p.period || p.quarter || p.month;
        const periodName = pr ? ` (งวด ${pr})` : '';
        const ownerStr = (p.owner && p.owner !== '-') ? ` · ${p.owner}` : '';
        const isNoSlip = !p.house_no || p.house_no === 'ไม่มีสลิป';
        const isBank = (p.channel || 'transfer') !== 'cash';
        const titleStr = isNoSlip ? 
          `รับชำระค่าส่วนกลาง ⚠️ ไม่มีสลิป (ยังไม่ระบุลูกบ้าน)${ownerStr}` : 
          `รับชำระค่าส่วนกลาง ${hNo}${periodName}${ownerStr}`;
        txs.push({
          id: p.payment_id,
          doc_no: p.payment_id,
          date: p.paid_date || '2026-01-01',
          time: p.transfer_time || '',
          title: titleStr,
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
            account_label: `โอนย้าย (฿${StaffAPI.fmt(amt)})`,
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
      tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:#ef4444;">❌ โหลดข้อมูลไม่สำเร็จ: ${err.message}</td></tr>`;
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
    const targetYm = isSingleMonth ? `2026-${String(selectedMonth).padStart(2, '0')}` : null;
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
        const txYm = (tx.date || '').slice(0, 7);
        if (txYm && txYm < targetYm) {
          priorBal += (txIn - txOut);
        }
      });
    }
    let runningBal = priorBal;
    let totalInflow = 0;
    let totalOutflow = 0;
    let countInflow = 0;
    let countOutflow = 0;
    let expenseOutflow = 0;
    let transferOutflow = 0;
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
          transferOutflow += tx.transfer_amount;
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
        if (txOutflow > 0) expenseOutflow += txOutflow;
      }
      // Month filter: แสดงเฉพาะเดือนที่เลือก
      if (isSingleMonth) {
        const txYm = (tx.date || '').slice(0, 7);
        if (txYm !== targetYm) return;
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
        (tx.account === 'cash' ? 
          '<span style="background:#fffbeb; color:#b45309; border:1px solid #fde68a; font-size:11.5px; font-weight:500; padding:3px 9px; border-radius:9999px; display:inline-block; white-space:nowrap;">💵 เงินสด</span>' : 
          `<span style="background:#faf5ff; color:#7e22ce; border:1px solid #e9d5ff; font-size:11.5px; font-weight:500; padding:3px 9px; border-radius:9999px; display:inline-block; white-space:nowrap;">🔄 โอนย้าย (฿${StaffAPI.fmt(tx.transfer_amount)})</span>`);
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
          </tr>
      `);
    });
    const tableBody = document.getElementById('ledger-table-body');
    if (tableBody) {
      if (itemIndex === 0) {
        tableBody.innerHTML = `
          <tr><td colspan="8" style="text-align:center; padding:40px; color:#64748b;">ไม่พบรายการที่ตรงกับเงื่อนไขตัวกรอง</td></tr>
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
      (accFilter === 'all' ? 'ธนาคาร ฿72,920.16 + เงินสด ฿10,049.57' : (accFilter === 'bank' ? 'บัญชีเงินฝาก ธ.กรุงเทพ (ณ 24 ม.ค. 69)' : 'บัญชีเงินสดสำรองจ่าย'));
    setEl('ledger-stat-opening-title', openTitle);
    setEl('ledger-stat-opening', '฿' + StaffAPI.fmt(priorBal));
    setEl('ledger-stat-opening-sub', openSub);
    setEl('ledger-stat-inflow-title', isSingleMonth ? `รวมรายรับ (${monthLabel})` : 'รวมรายรับทั้งสิ้น (+)');
    setEl('ledger-stat-inflow', '+฿' + StaffAPI.fmt(totalInflow));
    setEl('ledger-stat-inflow-sub', `${countInflow.toLocaleString('th-TH')} รายการ`);
    let outflowTitle = isSingleMonth ? `รวมรายจ่าย (${monthLabel})` : 'รวมรายจ่ายทั้งสิ้น (-)';
    let outflowSub = `${countOutflow.toLocaleString('th-TH')} รายการ`;

    if (accFilter === 'bank' && transferOutflow > 0) {
      outflowTitle = isSingleMonth ? `รวมเงินจ่ายออก (${monthLabel})` : 'รวมเงินจ่ายออก (รายจ่าย SMS + โอนเติมเงินสด) (-)';
      outflowSub = `รายจ่าย SMS ฿${StaffAPI.fmt(expenseOutflow)} · โอนเติมเงินสด ฿${StaffAPI.fmt(transferOutflow)}`;
    } else if (accFilter === 'all') {
      outflowSub = `${countOutflow.toLocaleString('th-TH')} รายการ (ตรงกับค่าใช้จ่ายสะสม)`;
    }

    setEl('ledger-stat-outflow-title', outflowTitle);
    setEl('ledger-stat-outflow', '-฿' + StaffAPI.fmt(totalOutflow));
    setEl('ledger-stat-outflow-sub', outflowSub);

    let balSub = '';
    if (isSingleMonth && selectedMonth !== 11) {
      balSub = `ยอดคงเหลือสะสม ณ สิ้นเดือน ${monthLabel}`;
    } else if (accFilter === 'all') {
      balSub = `ธ.กรุงเทพ ฿${StaffAPI.fmt(SERVER_BALANCE ? SERVER_BALANCE.bank : 49438.55)} + เงินสด ฿${StaffAPI.fmt(SERVER_BALANCE ? SERVER_BALANCE.reserve : 11816.82)}`;
    } else if (accFilter === 'bank') {
      balSub = 'ตรงกับเงินคงเหลือ ธ.กรุงเทพ ในแดชบอร์ด (฿49,438.55)';
    } else {
      balSub = 'ตรงกับเงินคงเหลือ เงินสด ในแดชบอร์ด (฿11,816.82)';
    }

    setEl('ledger-stat-balance-title', isSingleMonth ? `ยอดคงเหลือสิ้นเดือน (${monthLabel})` : 'ยอดคงเหลือสุทธิยกไป');
    setEl('ledger-stat-balance', '฿' + StaffAPI.fmt(runningBal));
    setEl('ledger-stat-balance-sub', balSub);
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
    const targetYm = isSingleMonth ? `2026-${String(selectedMonth).padStart(2, '0')}` : null;
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
        const txYm = (tx.date || '').slice(0, 7);
        if (txYm && txYm < targetYm) prior += (txIn - txOut);
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
        const txYm = (tx.date || '').slice(0, 7);
        if (txYm !== targetYm) return;
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

  // Print Official Ledger Report (พิมพ์รายงานสมุดบัญชีรายรับ-รายจ่าย)
  window.printLedgerReport = function() {
    const printArea = document.getElementById('printable-report-area');
    if (!printArea) {
      window.print();
      return;
    }
    if (!ALL_TRANSACTIONS || ALL_TRANSACTIONS.length === 0) {
      alert('กำลังโหลดข้อมูลหรือยังไม่มีรายการสำหรับพิมพ์รายงาน กรุณารอสักครู่แล้วลองใหม่อีกครั้ง');
      return;
    }
    const accFilter = (document.getElementById('ledger-filter-account') || {}).value || 'all';
    const monthFilter = (document.getElementById('ledger-filter-month') || {}).value || 'all';
    const typeFilter = (document.getElementById('ledger-filter-type') || {}).value || 'all';
    const keyword = ((document.getElementById('ledger-filter-search') || {}).value || '').trim().toLowerCase();
    let baseOpen = (accFilter === 'bank') ? OPENING_BANK : ((accFilter === 'cash') ? OPENING_RESERVE : OPENING_ALL);
    const isSingleMonth = monthFilter !== 'all';
    const selectedMonth = isSingleMonth ? parseInt(monthFilter, 10) : null;
    const targetYm = isSingleMonth ? `2026-${String(selectedMonth).padStart(2, '0')}` : null;
    let priorBal = baseOpen;
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
        const txYm = (tx.date || '').slice(0, 7);
        if (txYm && txYm < targetYm) {
          priorBal += (txIn - txOut);
        }
      });
    }
    let runningBal = priorBal;
    let totalInflow = 0;
    let totalOutflow = 0;
    let countInflow = 0;
    let countOutflow = 0;
    let itemIdx = 0;
    const printRows = [];
    ALL_TRANSACTIONS.forEach(tx => {
      let txInflow = 0;
      let txOutflow = 0;
      if (tx.type === 'transfer') {
        if (accFilter === 'bank') txOutflow = tx.transfer_amount;
        else if (accFilter === 'cash') txInflow = tx.transfer_amount;
      } else {
        if (accFilter === 'bank' && tx.account !== 'bank') return;
        if (accFilter === 'cash' && tx.account !== 'cash') return;
        txInflow = tx.inflow;
        txOutflow = tx.outflow;
      }
      if (isSingleMonth) {
        const txYm = (tx.date || '').slice(0, 7);
        if (txYm !== targetYm) return;
      }
      if (typeFilter === 'inflow' && txInflow === 0) return;
      if (typeFilter === 'outflow' && txOutflow === 0) return;
      if (keyword) {
        const searchStr = `${tx.id} ${tx.doc_no || ''} ${tx.title} ${tx.category} ${tx.note} ${tx.payee || ''}`.toLowerCase();
        if (!searchStr.includes(keyword)) return;
      }
      runningBal += (txInflow - txOutflow);
      if (txInflow > 0) { totalInflow += txInflow; countInflow++; }
      if (txOutflow > 0) { totalOutflow += txOutflow; countOutflow++; }
      itemIdx++;
      printRows.push(`
        <tr>
          <td style="text-align: center; font-size: 11px;">${itemIdx}</td>
          <td style="text-align: center; white-space: nowrap; font-size: 11px;">
            ${tx.date}
            ${tx.time ? `<br><span style="font-size: 9px; color: #64748b;">${tx.time} น.</span>` : ''}
          </td>
          <td style="text-align: center; font-family: monospace; font-size: 11px;">${tx.doc_no || tx.id}</td>
          <td style="font-size: 11.5px;">
            <div>${tx.title}</div>
            ${tx.note && tx.note !== tx.title ? `<div style="font-size: 10px; color: #64748b; margin-top: 2px;">${tx.note}</div>` : ''}
          </td>
          <td style="text-align: center; font-size: 11px;">${tx.account_label || (tx.account === 'bank' ? 'ธนาคาร' : 'เงินสด')}</td>
          <td style="text-align: right; font-size: 11.5px; font-weight: 600; color: ${txInflow > 0 ? '#059669;' : '#94a3b8;'}">
            ${txInflow > 0 ? StaffAPI.fmt(txInflow) : '-'}
          </td>
          <td style="text-align: right; font-size: 11.5px; font-weight: 600; color: ${txOutflow > 0 ? '#dc2626;' : '#94a3b8;'}">
            ${txOutflow > 0 ? StaffAPI.fmt(txOutflow) : '-'}
          </td>
          <td style="text-align: right; font-size: 11.5px; font-weight: 700; color: #1e3a8a;">
            ${StaffAPI.fmt(runningBal)}
          </td>
        </tr>
      `);
    });
    const now = new Date();
    const dateFormatted = `${now.getDate()} ${window.MONTHS_TH ? window.MONTHS_TH[now.getMonth()] : (now.getMonth()+1)} ${now.getFullYear() + 543}`;
    const timeFormatted = now.toLocaleTimeString('th-TH');
    const accLabel = (accFilter === 'bank') ? 'บัญชีเงินฝาก ธนาคารกรุงเทพ' : ((accFilter === 'cash') ? 'บัญชีเงินสดสำรองจ่าย' : 'รวมทุกบัญชี (ธนาคาร + เงินสด)');
    const monthLabel = isSingleMonth ? `ประจำเดือน ${window.MONTHS_TH ? window.MONTHS_TH[selectedMonth - 1] : selectedMonth} 2569` : 'ประจำปีงบประมาณ 2569';
    printArea.innerHTML = `
      <div style="font-family: 'Sarabun', 'Prompt', sans-serif; color: #000; padding: 10px;">
        <div style="text-align: center; margin-bottom: 16px;">
          <h2 style="font-size: 18px; margin: 0 0 4px 0; font-weight: 700;">กองทุนพัฒนาหมู่บ้าน ลพบุรีราเมศวร์ธานี</h2>
          <p style="font-size: 12px; margin: 0 0 4px 0; color: #475569;">หมู่ที่ 2 ตำบลน้ำน้อย อำเภอหาดใหญ่ จังหวัดสงขลา</p>
          <h3 style="font-size: 15px; margin: 6px 0; font-weight: 700;">สมุดบัญชีรายรับ-รายจ่าย (${accLabel})</h3>
          <p style="font-size: 12px; margin: 2px 0; color: #334155; font-weight: 600;">${monthLabel}</p>
          <p style="font-size: 11px; margin: 2px 0; color: #64748b;">พิมพ์ออกรายงาน ณ วันที่ ${dateFormatted} เวลา ${timeFormatted}</p>
        </div>
        <div style="display: flex; justify-content: space-between; background: #f8fafc; border: 1px solid #cbd5e1; padding: 8px 14px; border-radius: 6px; font-size: 12px; margin-bottom: 12px; gap: 8px; flex-wrap: wrap;">
          <div>ยอดยกมา: <b>฿${StaffAPI.fmt(priorBal)}</b></div>
          <div>รวมรายรับ: <b style="color:#059669;">+฿${StaffAPI.fmt(totalInflow)}</b> (${countInflow} รายการ)</div>
          <div>รวมรายจ่าย: <b style="color:#dc2626;">-฿${StaffAPI.fmt(totalOutflow)}</b> (${countOutflow} รายการ)</div>
          <div>ยอดคงเหลือสุทธิ: <b style="color:#1e3a8a;">฿${StaffAPI.fmt(runningBal)}</b></div>
        </div>
        <table class="report-paper-table" style="width: 100%; border-collapse: collapse; font-size: 11px;">
          <thead>
            <tr style="background: #f1f5f9;">
              <th style="width: 35px; text-align: center;">ลำดับ</th>
              <th style="width: 75px; text-align: center;">วันที่</th>
              <th style="width: 75px; text-align: center;">เลขที่</th>
              <th>รายการ / คำอธิบาย</th>
              <th style="width: 65px; text-align: center;">บัญชี</th>
              <th style="width: 80px; text-align: right;">รายรับ (+)</th>
              <th style="width: 80px; text-align: right;">รายจ่าย (-)</th>
              <th style="width: 90px; text-align: right;">คงเหลือ</th>
            </tr>
          </thead>
          <tbody>
            ${printRows.join('')}
            <tr class="total-row" style="background: #f8fafc; font-weight: 700;">
              <td colspan="5" style="text-align: right;">รวมยอดทั้งสิ้น (${itemIdx} รายการ):</td>
              <td style="text-align: right; color: #059669;">฿${StaffAPI.fmt(totalInflow)}</td>
              <td style="text-align: right; color: #dc2626;">฿${StaffAPI.fmt(totalOutflow)}</td>
              <td style="text-align: right; color: #1e3a8a;">฿${StaffAPI.fmt(runningBal)}</td>
            </tr>
          </tbody>
        </table>
        <!-- Signatures Block -->
        <div style="display: flex; justify-content: space-around; margin-top: 45px; page-break-inside: avoid; break-inside: avoid; padding: 0 30px;">
          <div style="text-align: center; width: 240px;">
            <p style="margin-bottom: 40px;">ลงชื่อ .....................................................</p>
            <p style="font-weight: 600; margin: 0; font-size: 12px;">(น.ส.วีระออ สุวรรณสิทธิ์)</p>
            <p style="font-size: 11px; color: #64748b; margin: 2px 0;">เหรัญญิก ผู้จัดทำบัญชี</p>
          </div>
          <div style="text-align: center; width: 240px;">
            <p style="margin-bottom: 40px;">ลงชื่อ .....................................................</p>
            <p style="font-weight: 600; margin: 0; font-size: 12px;">(นายสุนทร คำสุข)</p>
            <p style="font-size: 11px; color: #64748b; margin: 2px 0;">ประธานคณะทำงานกองทุนพัฒนาหมู่บ้าน<br>ลพบุรีราเมศวร์ธานี</p>
          </div>
        </div>
      </div>
    `;
    document.body.classList.add('printing-report');
    setTimeout(() => {
      window.print();
      setTimeout(() => {
        document.body.classList.remove('printing-report');
      }, 500);
    }, 150);
  };
})();
