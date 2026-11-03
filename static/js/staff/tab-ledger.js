/**
 * Tab: บัญชีรายรับ-รายจ่าย (General Ledger - Requirement 3)
 * มีตัวเลือก บัญชีธนาคาร, บัญชีเงินสด, หรือ รวมทุกบัญชี พร้อมคำนวณยอดคงเหลือสะสม (Running Balance)
 */
(function() {
  window.StaffTabs = window.StaffTabs || {};

  let ALL_TRANSACTIONS = [];
  let OPENING_BANK = 82969.73;
  let OPENING_RESERVE = 10049.57;

  window.StaffTabs.ledger = async function() {
    await loadLedgerData();
  };

  async function loadLedgerData() {
    const tableBody = document.getElementById('ledger-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 40px; color: #64748b;">⏳ กำลังโหลดข้อมูลบัญชีรายรับ-รายจ่ายจาก Supabase...</td></tr>';

    try {
      const data = await StaffAPI.call('/api/staff/reports/all');
      if (!data) return;

      const fy = data.fiscal_year || {};
      OPENING_BANK = Number(fy.opening_balance || 82969.73);
      OPENING_RESERVE = Number(fy.opening_reserve || 10049.57);

      const duesMap = {};
      (data.dues || []).forEach(d => duesMap[d.due_id] = d);

      const housesMap = {};
      (data.houses || []).forEach(h => housesMap[h.house_id] = h);

      const categoriesMap = {};
      (data.categories || []).forEach(c => categoriesMap[c.category_id] = c.name);

      const txs = [];

      // 1. Payments (รายรับค่าส่วนกลาง)
      (data.payments || []).forEach(p => {
        const du = duesMap[p.due_id] || {};
        const house = housesMap[du.house_id] || {};
        const hNo = house.house_no ? `บ้าน ${house.house_no}` : (du.house_id || '-');
        const monthName = du.month ? ` (เดือน ${MONTHS_TH[du.month - 1]})` : '';
        const isBank = (p.channel || 'transfer') !== 'cash';

        txs.push({
          id: p.payment_id,
          date: p.paid_date || '2026-01-01',
          time: p.transfer_time || '',
          title: `รับชำระค่าส่วนกลาง ${hNo}${monthName}`,
          category: 'ค่าส่วนกลาง',
          account: isBank ? 'bank' : 'cash',
          account_label: isBank ? 'ธนาคารกรุงเทพ' : 'เงินสด',
          type: 'inflow',
          inflow: Number(p.amount_paid || 0),
          outflow: 0,
          slip_url: p.slip_url || '',
          note: p.note || ''
        });
      });

      // 2. Expenses (รายจ่ายกองทุน)
      (data.expenses || []).forEach(e => {
        const isBank = (e.source || 'bank') !== 'reserve';
        const catName = categoriesMap[e.category_id] || e.category_id || 'ค่าใช้จ่ายทั่วไป';

        txs.push({
          id: e.expense_id,
          doc_no: e.doc_no || '',
          date: e.expense_date || '2026-01-01',
          time: '',
          title: e.description || 'ค่าใช้จ่ายกองทุน',
          category: catName,
          account: isBank ? 'bank' : 'cash',
          account_label: isBank ? 'ธนาคารกรุงเทพ' : 'เงินสดย่อย',
          type: 'outflow',
          inflow: 0,
          outflow: Number(e.amount || 0),
          slip_url: '',
          payee: e.payee || '',
          note: e.payee ? `ผู้รับเงิน: ${e.payee}` : ''
        });
      });

      // 3. Other Incomes (รายได้อื่น เช่น ดอกเบี้ย / บริจาค)
      (data.incomes || []).forEach(i => {
        const isBank = (i.channel || 'bank') !== 'cash';
        const typeLabel = i.type === 'interest' ? 'ดอกเบี้ยเงินฝาก' : (i.type === 'donation' ? 'เงินบริจาค' : (i.type || 'รายได้อื่น'));

        txs.push({
          id: i.income_id,
          date: i.date || '2026-01-01',
          time: '',
          title: `รายรับ: ${typeLabel}`,
          category: typeLabel,
          account: isBank ? 'bank' : 'cash',
          account_label: isBank ? 'ธนาคารกรุงเทพ' : 'เงินสด',
          type: 'inflow',
          inflow: Number(i.amount || 0),
          outflow: 0,
          slip_url: '',
          note: i.note || ''
        });
      });

      // 4. Reserve transfers (โอนเติมเงินสดย่อย)
      (data.reserve || []).forEach(r => {
        if (r.type === 'in' && !r.expense_id) {
          // โอนจากธนาคารมาเติมเงินสดย่อย
          txs.push({
            id: r.rt_id,
            date: r.date || '2026-01-01',
            time: '',
            title: 'เบิกเงินจากธนาคารมาเติมเงินสดย่อย',
            category: 'โอนระหว่างบัญชี',
            account: 'transfer_bank_to_cash',
            account_label: 'โอนย้ายบัญชี',
            type: 'transfer',
            inflow: 0,
            outflow: 0,
            transfer_amount: Number(r.amount || 0),
            slip_url: '',
            note: r.note || ''
          });
        }
      });

      // Sort by date ascending
      txs.sort((a, b) => {
        const da = (a.date || '') + ' ' + (a.time || '');
        const db = (b.date || '') + ' ' + (b.time || '');
        return da.localeCompare(db);
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

    let openBal = 0;
    if (accFilter === 'bank') openBal = OPENING_BANK;
    else if (accFilter === 'cash') openBal = OPENING_RESERVE;
    else openBal = OPENING_BANK + OPENING_RESERVE;

    let runningBal = openBal;
    let totalInflow = 0;
    let totalOutflow = 0;

    const rowsHtml = [];

    // แถวยอดยกมา
    rowsHtml.push(`
      <tr style="background: #f8fafc; font-weight: 600;">
        <td class="c">-</td>
        <td class="c">24 ม.ค. 2569</td>
        <td class="c"><span class="badge" style="background:#e2e8f0; color:#334155;">ยอดยกมา</span></td>
        <td><b>ยอดยกมาจากปี 2568</b> ${accFilter === 'all' ? '(ธนาคาร + เงินสดย่อย)' : (accFilter === 'bank' ? '(ธนาคารกรุงเทพ)' : '(เงินสดย่อย)')}</td>
        <td class="c"><span style="font-size:11px; padding:2px 8px; border-radius:10px; background:#f1f5f9; color:#475569;">ยอดยกมา</span></td>
        <td class="r" style="color: #059669;">+฿${StaffAPI.fmt(openBal)}</td>
        <td class="r" style="color: #94a3b8;">-</td>
        <td class="r" style="color: #1e3a8a; font-weight: 700;">฿${StaffAPI.fmt(runningBal)}</td>
        <td class="c">-</td>
      </tr>
    `);

    let itemIndex = 0;

    ALL_TRANSACTIONS.forEach(tx => {
      // 1. Account filter
      let txInflow = 0;
      let txOutflow = 0;

      if (tx.type === 'transfer') {
        // รายการโอนเงินจากธนาคารมาเติมเงินสดย่อย
        if (accFilter === 'bank') {
          txOutflow = tx.transfer_amount;
        } else if (accFilter === 'cash') {
          txInflow = tx.transfer_amount;
        } else {
          // รวมทุกบัญชี เงินไม่ได้ออกจากระบบ ไม่กระทบยอดรวมสุทธิ
        }
      } else {
        if (accFilter === 'bank' && tx.account !== 'bank') return;
        if (accFilter === 'cash' && tx.account !== 'cash') return;
        txInflow = tx.inflow;
        txOutflow = tx.outflow;
      }

      // 2. Month filter
      if (monthFilter !== 'all') {
        const m = parseInt(tx.date.split('-')[1], 10);
        if (m !== parseInt(monthFilter, 10)) return;
      }

      // 3. Type filter
      if (typeFilter === 'inflow' && txInflow === 0) return;
      if (typeFilter === 'outflow' && txOutflow === 0) return;

      // 4. Keyword search
      if (keyword) {
        const searchStr = `${tx.id} ${tx.doc_no || ''} ${tx.title} ${tx.category} ${tx.note} ${tx.payee || ''}`.toLowerCase();
        if (!searchStr.includes(keyword)) return;
      }

      runningBal += (txInflow - txOutflow);
      totalInflow += txInflow;
      totalOutflow += txOutflow;
      itemIndex++;

      const slipBtn = tx.slip_url ? `
        <button onclick="window.showSlipDirect('${tx.slip_url}', '${tx.title}')" class="btn btn-sm" style="background:#e0f2fe; color:#0284c7; padding:2px 8px; border-radius:6px; font-size:11px; border:none; cursor:pointer;" title="คลิกดูภาพสลิป">
          🖼️ ดูสลิป
        </button>
      ` : '-';

      const accBadge = tx.account === 'bank' ? 
        '<span style="background:#dbeafe; color:#1e40af; font-size:11px; font-weight:600; padding:2px 8px; border-radius:10px;">🏦 ธนาคาร</span>' : 
        (tx.account === 'cash' ? '<span style="background:#fef3c7; color:#92400e; font-size:11px; font-weight:600; padding:2px 8px; border-radius:10px;">💵 เงินสด</span>' : '<span style="background:#f3e8ff; color:#6b21a8; font-size:11px; font-weight:600; padding:2px 8px; border-radius:10px;">🔄 โอนย้าย</span>');

      rowsHtml.push(`
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td class="c" style="color:#94a3b8; font-size:12px;">${itemIndex}</td>
          <td class="c" style="white-space:nowrap; font-size:12px;">
            ${tx.date}
            ${tx.time ? `<div style="font-size:10px; color:#94a3b8;">${tx.time} น.</div>` : ''}
          </td>
          <td class="c">
            <code style="background:#f8fafc; border:1px solid #e2e8f0; padding:1px 6px; border-radius:4px; font-size:11px;">${tx.doc_no || tx.id}</code>
          </td>
          <td>
            <div style="font-weight: 500; color: #1e293b;">${tx.title}</div>
            ${tx.note ? `<div style="font-size: 11px; color: #64748b; margin-top: 2px;">${tx.note}</div>` : ''}
          </td>
          <td class="c">${accBadge}</td>
          <td class="r" style="color: ${txInflow > 0 ? '#059669; font-weight:600;' : '#94a3b8;'}">
            ${txInflow > 0 ? '+฿' + StaffAPI.fmt(txInflow) : '-'}
          </td>
          <td class="r" style="color: ${txOutflow > 0 ? '#dc2626; font-weight:600;' : '#94a3b8;'}">
            ${txOutflow > 0 ? '-฿' + StaffAPI.fmt(txOutflow) : '-'}
          </td>
          <td class="r" style="font-weight: 700; color: #1e3a8a;">
            ฿${StaffAPI.fmt(runningBal)}
          </td>
          <td class="c">${slipBtn}</td>
        </tr>
      `);
    });

    const tableBody = document.getElementById('ledger-table-body');
    if (tableBody) {
      if (itemIndex === 0) {
        tableBody.innerHTML = `
          ${rowsHtml[0]}
          <tr><td colspan="9" style="text-align:center; padding:30px; color:#64748b;">ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา</td></tr>
        `;
      } else {
        tableBody.innerHTML = rowsHtml.join('');
      }
    }

    // Update Top Summary KPI Cards
    const elOpen = document.getElementById('ledger-stat-opening');
    if (elOpen) elOpen.textContent = '฿' + StaffAPI.fmt(openBal);

    const elIn = document.getElementById('ledger-stat-inflow');
    if (elIn) elIn.textContent = '+฿' + StaffAPI.fmt(totalInflow);

    const elOut = document.getElementById('ledger-stat-outflow');
    if (elOut) elOut.textContent = '-฿' + StaffAPI.fmt(totalOutflow);

    const elCur = document.getElementById('ledger-stat-balance');
    if (elCur) elCur.textContent = '฿' + StaffAPI.fmt(runningBal);

    const elCount = document.getElementById('ledger-stat-count');
    if (elCount) elCount.textContent = `แสดง ${itemIndex} รายการ`;
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
      btnDrive.style.display = 'inline-flex';
      btnDrive.href = url;
    }

    if (modal) modal.style.display = 'flex';
  };

  // Export ledger to CSV
  window.exportLedgerCSV = function() {
    const accFilter = (document.getElementById('ledger-filter-account') || {}).value || 'all';
    const accName = accFilter === 'bank' ? 'ธนาคารกรุงเทพ' : (accFilter === 'cash' ? 'เงินสดย่อย' : 'รวมทุกบัญชี');
    const filename = `บัญชีรายรับรายจ่าย_${accName}_${new Date().toISOString().slice(0, 10)}.csv`;

    let csvContent = '\uFEFF'; // BOM
    csvContent += 'ลำดับ,วันที่,เวลา,เลขที่เอกสาร,รายการ,หมวดหมู่,บัญชี,รายรับ(บาท),รายจ่าย(บาท),ยอดคงเหลือ(บาท),หมายเหตุ\n';

    let openBal = accFilter === 'bank' ? OPENING_BANK : (accFilter === 'cash' ? OPENING_RESERVE : OPENING_BANK + OPENING_RESERVE);
    let runningBal = openBal;
    csvContent += `0,2026-01-24,-,OPENING,"ยอดยกมาจากปี 2568","ยอดยกมา","${accName}",${openBal},0,${runningBal},"ยอดยกมาต้นงวด"\n`;

    let idx = 0;
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

      runningBal += (txInflow - txOutflow);
      idx++;
      const safeTitle = (tx.title || '').replace(/"/g, '""');
      const safeCat = (tx.category || '').replace(/"/g, '""');
      const safeNote = (tx.note || '').replace(/"/g, '""');
      csvContent += `${idx},"${tx.date}","${tx.time}","${tx.doc_no || tx.id}","${safeTitle}","${safeCat}","${tx.account_label}",${txInflow},${txOutflow},${runningBal},"${safeNote}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
})();
