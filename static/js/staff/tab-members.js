/**
 * Tab 5: ทะเบียนสมาชิก 162 หลัง (Member Directory & Payment Status)
 */
(function() {
  window.StaffTabs = window.StaffTabs || {};

  window.StaffTabs.members = async function() {
    if (!window.StaffApp.HOUSES || !window.StaffApp.HOUSES.length) {
      await window.StaffApp.loadHouses();
    }
    window.StaffApp.renderStaffMembersTable();
  };
})();
