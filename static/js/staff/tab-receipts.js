/**
 * Tab 6: ออกเอกสารทางการ PDF (Official E-Receipts & Reports)
 */
(function() {
  window.StaffTabs = window.StaffTabs || {};

  window.StaffTabs.receipts = async function() {
    if (!window.StaffApp.HOUSES || !window.StaffApp.HOUSES.length) {
      await window.StaffApp.loadHouses();
    }
    const pdfSel = document.getElementById('pdf-sel-house');
    if (pdfSel && pdfSel.value) {
      window.StaffApp.generateOfficialReceipt();
    }
  };
})();
