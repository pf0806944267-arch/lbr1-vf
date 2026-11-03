/**
 * Tab 7: ประวัติการทำรายการ (Audit Trail & Activity Log)
 */
(function() {
  window.StaffTabs = window.StaffTabs || {};

  window.StaffTabs.history = async function() {
    await window.StaffApp.loadAuditHistory();
  };
})();
