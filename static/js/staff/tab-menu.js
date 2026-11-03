/**
 * Tab: Executive Dashboard Menu (Square Icon Cards - Requirement 2)
 */
(function() {
  window.StaffTabs = window.StaffTabs || {};

  window.StaffTabs.menu = async function() {
    const container = document.getElementById('view-menu') || document.getElementById('tab-menu');
    if (!container) return;

    // Fetch live summary from /api/dashboard via AJAX
    try {
      const data = await StaffAPI.call('/api/dashboard');
      if (!data) return;

      const bal = data.balance || {};
      const totalRec = bal.received || 0;
      const bankBal = bal.bank || 0;
      const resBal = bal.reserve || 0;
      const netTotal = bal.total || 0;
      const pct = data.year_collected_pct || 0;

      // Update KPI widgets
      const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };

      setEl('menu-stat-bank', '฿' + StaffAPI.fmt(bankBal));
      setEl('menu-stat-reserve', '฿' + StaffAPI.fmt(resBal));
      setEl('menu-stat-net', '฿' + StaffAPI.fmt(netTotal));
      setEl('menu-stat-received', '฿' + StaffAPI.fmt(totalRec));
      setEl('menu-stat-pct', pct + '%');
    } catch (e) {
      console.warn('Menu stat load error:', e);
    }
  };
})();
