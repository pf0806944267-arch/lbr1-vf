/**
 * Tab: ถอนเงินสด / โอนย้ายเงิน (Bank to Cash Transfer)
 * บันทึกการถอนเงินจากบัญชี ธ.กรุงเทพ มาเติมเงินสดสำรองจ่าย
 * - เงินในธนาคารลดลง
 * - เงินสดสำรองจ่ายเพิ่มขึ้น
 * - ยอดเงินคงเหลือสุทธิรวมของกองทุนคงเดิม (ไม่นับเป็นรายจ่าย)
 */
(function() {
  window.StaffTabs = window.StaffTabs || {};

  window.StaffTabs.transfer = async function() {
    initTransferForm();
    await loadRecentTransfers();
  };

  function initTransferForm() {
    const dateInput = document.getElementById('input-trans-date');
    if (dateInput && !dateInput.value) {
      dateInput.value = StaffAPI.todayStr();
    }

    const btnSubmit = document.getElementById('btn-submit-transfer');
    if (btnSubmit && !btnSubmit.dataset.bound) {
      btnSubmit.dataset.bound = 'true';
      btnSubmit.addEventListener('click', handleTransferSubmit);
    }
  }

  async function handleTransferSubmit() {
    const dateEl = document.getElementById('input-trans-date');
    const amtEl = document.getElementById('input-trans-amount');
    const noteEl = document.getElementById('input-trans-note');
    const alertEl = document.getElementById('transfer-form-alert');

    const date = (dateEl ? dateEl.value : '').trim();
    const amount = parseFloat(amtEl ? amtEl.value : '0');
    const note = (noteEl ? noteEl.value : '').trim();

    if (alertEl) alertEl.innerHTML = '';

    if (!date) {
      StaffAPI.showAlert(alertEl, 'danger', '⚠️ กรุณาระบุวันที่ถอนเงิน');
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      StaffAPI.showAlert(alertEl, 'danger', '⚠️ กรุณาระบุจำนวนเงินที่ถูกต้อง (มากกว่า 0 บาท)');
      return;
    }

    const defaultNote = 'ถอนเงินจากบัญชีธนาคารมาเติมเงินสดสำรองจ่าย';
    const finalNote = note || defaultNote;

    const confirmMsg = `ยืนยันการบันทึกการถอนเงินจากธนาคารมาเป็นเงินสด?\n\n` +
      `📅 วันที่: ${date}\n` +
      `💵 จำนวนเงิน: ฿${StaffAPI.fmt(amount)} บาท\n` +
      `🏦 จาก: บัญชีเงินฝาก ธ.กรุงเทพ\n` +
      `💵 เข้า: บัญชีเงินสดสำรองจ่าย\n` +
      `📝 หมายเหตุ: ${finalNote}\n\n` +
      `* หมายเหตุ: ยอดเงินคงเหลือรวมของกองทุนจะเท่าเดิม โดยเงินในธนาคารจะลดลง และเงินสดจะเพิ่มขึ้น`;

    if (!confirm(confirmMsg)) return;

    const btn = document.getElementById('btn-submit-transfer');
    if (btn) btn.disabled = true;

    try {
      const res = await StaffAPI.call('/api/staff/transfers', 'POST', {
        date: date,
        amount: amount,
        note: finalNote
      });

      if (res && res.ok) {
        StaffAPI.showAlert(alertEl, 'success', `✔️ บันทึกการถอนเงิน ฿${StaffAPI.fmt(amount)} สำเร็จเรียบร้อย (รหัส: ${res.transfer ? res.transfer.rt_id : ''})`);
        if (amtEl) amtEl.value = '';
        if (noteEl) noteEl.value = '';
        await loadRecentTransfers();
      }
    } catch (err) {
      console.error('Transfer submit error:', err);
      StaffAPI.showAlert(alertEl, 'danger', `❌ บันทึกไม่สำเร็จ: ${err.message}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function loadRecentTransfers() {
    const feed = document.getElementById('recent-transfers-feed');
    if (!feed) return;

    feed.innerHTML = '<div style="padding: 20px; text-align: center; color: #64748b;">⏳ กำลังโหลดประวัติการถอนเงิน...</div>';

    try {
      const data = await StaffAPI.call('/api/staff/reports/all');
      if (!data) return;

      const transfers = (data.reserve || []).filter(r => r.type === 'in' && r.rt_id !== 'RT0001');

      // Sort descending (newest first)
      transfers.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.rt_id || '').localeCompare(a.rt_id || ''));

      const totalTransferAmt = transfers.reduce((sum, r) => sum + Number(r.amount || 0), 0);
      const totalCount = transfers.length;

      const statTotalEl = document.getElementById('transfer-stat-total');
      if (statTotalEl) statTotalEl.textContent = '฿' + StaffAPI.fmt(totalTransferAmt);

      const statCountEl = document.getElementById('transfer-stat-count');
      if (statCountEl) statCountEl.textContent = totalCount.toLocaleString('th-TH') + ' รายการ';

      if (!transfers.length) {
        feed.innerHTML = '<div style="padding: 30px; text-align: center; color: #94a3b8;">ยังไม่มีประวัติการถอนเงินจากธนาคาร</div>';
        return;
      }

      feed.innerHTML = transfers.map(t => `
        <div style="background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; gap: 10px;">
          <div>
            <div style="font-size: 13.5px; font-weight: 600; color: #1e293b;">
              🔄 ${t.note || 'ถอนเงินจากธนาคารมาเติมเงินสดสำรองจ่าย'}
            </div>
            <div style="font-size: 11.5px; color: #64748b; margin-top: 3px; display: flex; align-items: center; gap: 8px;">
              <span>📅 ${t.date || '-'}</span>
              <span>·</span>
              <code style="background: #f1f5f9; padding: 1px 6px; border-radius: 4px;">${t.rt_id}</code>
            </div>
          </div>
          <div style="text-align: right; white-space: nowrap;">
            <div style="font-size: 15px; font-weight: 700; color: #0284c7;">
              +฿${StaffAPI.fmt(t.amount)}
            </div>
            <div style="font-size: 11px; color: #64748b;">
              🏦 ธ.กรุงเทพ ➔ 💵 เงินสด
            </div>
            <div style="margin-top: 6px; display: flex; gap: 6px; justify-content: flex-end;">
              <button onclick="openEditTransferModal('${t.rt_id}')" class="btn-edit-record" style="padding: 2px 7px; font-size: 11px; background: #e0f2fe; color: #0284c7; border: 1px solid #bae6fd; border-radius: 4px; cursor: pointer; font-weight: 600;" title="แก้ไข">
                ✏️ แก้ไข
              </button>
              <button onclick="deleteTransfer('${t.rt_id}', ${t.amount})" class="btn-del-record" style="padding: 2px 7px; font-size: 11px; border-radius: 4px;" title="ลบ">
                🗑️ ลบ
              </button>
            </div>
          </div>
        </div>
      `).join('');
    } catch (err) {
      console.error('Load transfers error:', err);
      feed.innerHTML = `<div style="padding: 20px; color: #ef4444;">❌ โหลดข้อมูลไม่สำเร็จ: ${err.message}</div>`;
    }
  }
})();
