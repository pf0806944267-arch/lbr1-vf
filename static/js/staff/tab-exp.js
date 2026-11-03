/**
 * Tab 2: บันทึกรายจ่ายกองทุน (Expenses & Petty Cash)
 */
(function() {
  window.StaffTabs = window.StaffTabs || {};

  window.StaffTabs.exp = async function() {
    await window.StaffApp.loadRecentExpenses();
  };

  // Helper to trigger expense tab refresh
  window.refreshExpenses = async function() {
    await window.StaffApp.loadRecentExpenses();
    if (window.StaffTabs.ledger) {
      window.StaffTabs.ledger();
    }
  };
})();
