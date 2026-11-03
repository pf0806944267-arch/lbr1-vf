/**
 * Tab 4: บันทึกรายได้อื่น (Other Income - Interest, Donations)
 */
(function() {
  window.StaffTabs = window.StaffTabs || {};

  window.StaffTabs.inc = async function() {
    await window.StaffApp.loadRecentIncome();
  };

  window.refreshIncome = async function() {
    await window.StaffApp.loadRecentIncome();
    if (window.StaffTabs.ledger) {
      window.StaffTabs.ledger();
    }
  };
})();
