/**
 * Staff Router: Manages tabs and preserves active tab state across page reloads using URL hash
 */
(function() {
  window.StaffRouter = {
    validTabs: ['menu', 'pay', 'exp', 'ledger', 'inc', 'members', 'receipts', 'history', 'all-payments', 'all-expenses', 'all-income'],
    currentTab: 'menu',

    init: function() {
      const self = this;

      // Handle browser back/forward and hash navigation
      window.addEventListener('hashchange', function() {
        self.handleRoute();
      });

      // Handle sub-navigation button clicks
      document.querySelectorAll('.staff-menu-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          const tab = this.getAttribute('data-tab');
          if (tab) {
            self.navigate(tab);
          }
        });
      });

      // Initial route on page load / refresh
      this.handleRoute();
    },

    navigate: function(tabName) {
      if (!this.validTabs.includes(tabName)) {
        tabName = 'menu';
      }
      if (window.location.hash !== '#' + tabName) {
        window.location.hash = tabName;
      } else {
        this.activateTab(tabName);
      }
    },

    handleRoute: function() {
      let hash = window.location.hash.replace('#', '').trim();
      if (!hash || !this.validTabs.includes(hash)) {
        hash = sessionStorage.getItem('staff_active_tab') || 'menu';
        if (!this.validTabs.includes(hash)) hash = 'menu';
        window.location.hash = hash;
        return;
      }
      this.activateTab(hash);
    },

    activateTab: function(tabName) {
      this.currentTab = tabName;
      sessionStorage.setItem('staff_active_tab', tabName);

      // Determine nav button association
      const activeNavTab = {
        'all-payments': 'pay',
        'all-expenses': 'exp',
        'all-income': 'inc'
      }[tabName] || tabName;

      // Update Sub-nav buttons active class
      document.querySelectorAll('.staff-menu-btn').forEach(function(btn) {
        if (btn.getAttribute('data-tab') === activeNavTab) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });

      // Show/hide tab contents (supports both .staff-view and .staff-tab-content)
      document.querySelectorAll('.staff-view, .staff-tab-content').forEach(function(content) {
        content.classList.add('hidden');
        content.style.display = 'none';
      });

      const activeEl = document.getElementById('view-' + tabName) || document.getElementById('tab-' + tabName);
      if (activeEl) {
        activeEl.classList.remove('hidden');
        activeEl.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      // Trigger tab-specific data load
      const loaderName = {
        'all-payments': 'allPayments',
        'all-expenses': 'allExpenses',
        'all-income': 'allIncome'
      }[tabName] || tabName;

      if (window.StaffTabs && typeof window.StaffTabs[loaderName] === 'function') {
        window.StaffTabs[loaderName]();
      }
    }
  };

  // Global alias for compatibility
  window.switchTab = function(tabName) {
    window.StaffRouter.navigate(tabName);
  };
})();
