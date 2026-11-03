/**
 * Tab 1: บันทึกรับชำระเงินค่ากองทุนพัฒนาหมู่บ้าน (Payment Counter)
 */
(function() {
  window.StaffTabs = window.StaffTabs || {};

  window.StaffTabs.pay = async function() {
    await window.StaffApp.loadHouses();
    await window.StaffApp.loadRecentPayments();
    const sel = document.getElementById('sel-pay-house');
    if (sel && sel.value) sel.onchange();
  };

  // Helper to trigger payment tab refresh
  window.refreshPayments = async function() {
    await window.StaffApp.loadHouses();
    await window.StaffApp.loadRecentPayments();
    if (window.StaffTabs.ledger) {
      window.StaffTabs.ledger();
    }
  };
})();
