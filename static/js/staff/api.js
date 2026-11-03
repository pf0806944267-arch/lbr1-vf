/**
 * Staff API & Utilities Helper
 */
(function() {
  window.MONTHS_TH = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];

  window.StaffAPI = {
    getToken: function() {
      return sessionStorage.getItem('token');
    },

    getRole: function() {
      return sessionStorage.getItem('role') || 'staff';
    },

    isAdmin: function() {
      return this.getRole() === 'admin';
    },

    getUsername: function() {
      return sessionStorage.getItem('username') || 'เจ้าหน้าที่กองทุน';
    },

    fmt: function(n) {
      return Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    fmt0: function(n) {
      return Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 });
    },

    call: async function(endpoint, method = 'GET', body = null) {
      const token = this.getToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;

      const url = method === 'GET' ? 
        (endpoint.includes('?') ? `${endpoint}&_=${Date.now()}` : `${endpoint}?_=${Date.now()}`) : 
        endpoint;

      try {
        const res = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : null
        });

        const data = await res.json().catch(() => ({}));
        if (res.status === 401 && token) {
          sessionStorage.clear();
          window.location.reload();
          return null;
        }

        if (!res.ok) {
          throw new Error(data.error || 'เกิดข้อผิดพลาดในการเชื่อมต่อ');
        }

        return data;
      } catch (err) {
        console.error('API Error:', err);
        throw err;
      }
    },

    toast: function(msg, isSuccess = true) {
      const box = document.getElementById('staff-alert-box');
      if (!box) {
        alert((isSuccess ? '✅ ' : '❌ ') + msg);
        return;
      }
      box.innerHTML = `
        <div class="alert ${isSuccess ? 'alert-success' : 'alert-error'}" style="display: flex; align-items: center; justify-content: space-between; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border-radius: 10px; margin-bottom: 20px; animation: slideDown 0.3s ease;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 18px;">${isSuccess ? '✅' : '❌'}</span>
            <span style="font-weight: 500;">${msg}</span>
          </div>
          <button type="button" onclick="this.parentElement.remove()" style="border:none; background:none; cursor:pointer; font-size:16px; color:#64748b;">✕</button>
        </div>
      `;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => {
        if (box.firstElementChild) {
          box.firstElementChild.style.opacity = '0';
          box.firstElementChild.style.transition = 'opacity 0.5s';
          setTimeout(() => box.innerHTML = '', 500);
        }
      }, 5000);
    }
  };
})();
