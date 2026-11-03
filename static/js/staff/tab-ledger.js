/**
 * Tab: บัญชีรายรับ-รายจ่าย (General Ledger - Requirement 3)
 * มีตัวเลือก บัญชีธนาคาร, บัญชีเงินสด, หรือ รวมทุกบัญชี พร้อมคำนวณยอดคงเหลือสะสม (Running Balance)
 */
(function() {
  window.StaffTabs = window.StaffTabs || {};

  let ALL_TRANSACTIONS = [];
  let OPENING_ALL = 82969.73;
  let OPENING_BANK = 72920.16;
  let OPENING_RESERVE = 10049.57;
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
      const openTotal = Number(data.opening_balance || SERVER_BALANCE.opening || 82969.73);
      const openRes = Number(data.opening_reserve || SERVER_BALANCE.opening_reserve || 10049.57);

      OPENING_ALL = openTotal;
      OPENING_RESERVE = openRes;
      OPENING_BANK = Math.round((openTotal - openRes) * 100) / 100;

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

    let openBal = 0;
    if (accFilter === 'bank') {
      openBal = OPENING_BANK;
    } else if (accFilter === 'cash') {
      openBal = OPENING_RESERVE;
    } else {
      openBal = OPENING_ALL;
    }

    let runningBal = openBal;
    let totalInflow = 0;
    let totalOutflow = 0;
    let countInflow = 0;
    let countOutflow = 0;

    const rowsHtml = [];

    // Opening Balance Row
    rowsHtml.push(`
      <tr style="background: #f8fafc; font-weight: 600;">
        <td class="c">-</td>
        <td class="c">24 ม.ค. 2569</td>
        <td class="c"><span class="badge" style="background:#e2e8f0; color:#334155; font-size:11px; padding:2px 8px; border-radius:10px;">ยอดยกมา</span></td>
        <td><b>ยอดยกมาจากปี 2568</b> ${accFilter === 'all' ? '(ยอดรวมทั้งสิ้น)' : (accFilter === 'bank' ? '(บัญชีเงินฝาก ธ.กรุงเทพ)' : '(บัญชีเงินสดย่อยสำรองจ่าย)')}</td>
        <td class="c"><span style="font-size:11px; padding:2px 8px; border-radius:10px; background:#f1f5f9; color:#475569;">ยอดยกมา</span></td>
        <td class="r" style="color: #059669; font-weight: 700;">+฿${StaffAPI.fmt(openBal)}</td>
        <td class="r" style="color: #94a3b8;">-</td>
        <td class="r" style="color: #1e3a8a; font-weight: 800;">฿${StaffAPI.fmt(runningBal)}</td>
        <td class="c">-</td>
      </tr>
    `);

    let itemIndex = 0;

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

      // Month filter
      if (monthFilter !== 'all') {
        const parts = (tx.date || '').split('-');
        const m = parseInt(parts[1], 10);
        if (m !== parseInt(monthFilter, 10)) return;
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
        <button onclick="window.showSlipDirect('${tx.slip_url}', '${tx.title.replace(/'/g, "\\'")}')" class="btn btn-sm" style="background:#e0f2fe; color:#0284c7; padding:2px 8px; border-radius:6px; font-size:11px; border:none; cursor:pointer;" title="คลิกดูภาพสลิป">
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
    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setEl('ledger-stat-opening', '฿' + StaffAPI.fmt(openBal));
    setEl('ledger-stat-inflow', '+฿' + StaffAPI.fmt(totalInflow));
    setEl('ledger-stat-inflow-sub', `${countInflow.toLocaleString('th-TH')} รายการ`);
    setEl('ledger-stat-outflow', '-฿' + StaffAPI.fmt(totalOutflow));
    setEl('ledger-stat-outflow-sub', `${countOutflow.toLocaleString('th-TH')} รายการ`);
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

  // Export CSV
  window.exportLedgerCSV = function() {
    if (!ALL_TRANSACTIONS.length) {
      alert('ไม่มีข้อมูลสำหรับส่งออก');
      return;
    }

    const accFilter = (document.getElementById('ledger-filter-account') || {}).value || 'all';
    let openBal = (accFilter === 'bank') ? OPENING_BANK : ((accFilter === 'cash') ? OPENING_RESERVE : OPENING_ALL);
    let running = openBal;

    let csvContent = '\uFEFF';
    csvContent += 'ลำดับ,วันที่,เวลา,เลขที่เอกสาร,รายการ,บัญชี,รายรับ (+),รายจ่าย (-),คงเหลือสะสม,หมายเหตุ\n';
    csvContent += `"-","24/01/2569","-","ยอดยกมา","ยอดยกมาจากปี 2568","${accFilter}","${openBal}","-","${running}","ยอดยกมา"\n`;

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

      running += (txIn - txOut);
      idx++;

      const cleanTitle = `"${(tx.title || '').replace(/"/g, '""')}"`;
      const cleanNote = `"${(tx.note || '').replace(/"/g, '""')}"`;
      csvContent += `${idx},"${tx.date}","${tx.time}","${tx.doc_no || tx.id}",${cleanTitle},"${tx.account_label}",${txIn || 0},${txOut || 0},${running},${cleanNote}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `General_Ledger_${accFilter}_2569.csv`;
    link.click();
  };
})();
