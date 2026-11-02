const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    const fmt = n => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmt0 = n => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 });


    function renderVisits(s) {
      const el = document.getElementById('visit-stats');
      if (!el || !s) return;
      const n = v => Number(v || 0).toLocaleString('th-TH');
      el.innerHTML =
        `<span class="visit-chip">👁️ วันนี้ <b>${n(s.today_views)}</b> ครั้ง</span>` +
        `<span class="visit-chip">👤 ผู้เข้าชมวันนี้ <b>${n(s.today_visitors)}</b> คน</span>` +
        `<span class="visit-chip">📊 ทั้งหมด <b>${n(s.total_views)}</b> ครั้ง / <b>${n(s.total_visitors)}</b> คน</span>`;
    }

    fetch('/api/visit', { method: 'POST' }).then(r => r.json()).then(renderVisits).catch(() => {});

    let DASH_DATA = null;
    let HOUSES_DATA = [];
    let chartZonesInstance = null;
    let chartExpensesInstance = null;

    // Tab Navigation
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));

        btn.classList.add('active');
        const targetTab = document.getElementById('tab-' + btn.dataset.tab);
        if (targetTab) targetTab.classList.remove('hidden');
      });
    });

    async function loadData() {
      try {
        const [dashRes, housesRes] = await Promise.all([
          fetch('/api/dashboard').then(r => r.json()),
          fetch('/api/houses').then(r => r.json())
        ]);
        DASH_DATA = dashRes;
        HOUSES_DATA = housesRes;

        renderDashboard(dashRes);
        renderHousesTable(housesRes);
        renderFinancialStatement(dashRes);
      } catch (err) {
        console.error("Fetch data error:", err);
      }
    }

    function renderDashboard(data) {
      document.getElementById('nav-year').textContent = 'ปี ' + data.fiscal_year;
      const bal = data.balance;

      // 4 Main Stats
      document.getElementById('val-total').textContent = '฿' + fmt(bal.total);
      document.getElementById('val-bank').textContent = '฿' + fmt(bal.bank);
      document.getElementById('val-reserve').textContent = '฿' + fmt(bal.reserve);
      document.getElementById('val-received').textContent = '฿' + fmt(bal.received);
      document.getElementById('val-houses').textContent = data.houses_total + ' หลังคาเรือน';
      document.getElementById('val-expenses').textContent = '฿' + fmt(bal.expenses);
      document.getElementById('val-opening').textContent = '฿' + fmt(bal.opening);
      document.getElementById('val-interest').textContent = '฿' + fmt(bal.other_income);
      document.getElementById('badge-collected-rate').textContent = 'จัดเก็บแล้ว ' + data.year_collected_pct + '%';
      if (document.getElementById('comm-bank-bal')) {
        document.getElementById('comm-bank-bal').textContent = '฿' + fmt(bal.bank);
      }

      // 4 Period Progress Cards
      renderPeriodCards(data.period_cards);

      // Render Charts
      renderZoneChart(data.zone_chart);
      renderExpensesChart(data.budget_breakdown);

      // Zone filter dropdown in Tab 2
      const zSel = document.getElementById('zone-filter-select');
      if (zSel && zSel.options.length <= 1) {
        data.zones.forEach(z => {
          const opt = document.createElement('option');
          opt.value = z.zone;
          opt.textContent = z.zone;
          zSel.appendChild(opt);
        });
      }
    }

    function renderPeriodCards(cards) {
      const container = document.getElementById('period-cards-container');
      if (!container || !cards) return;

      container.innerHTML = cards.map(c => `
        <div class="period-card">
          <div class="period-top">
            <span class="period-name">${c.name}</span>
            <span class="period-pct" style="color: ${c.color}">${c.pct}%</span>
          </div>
          <div class="period-amt">฿${fmt0(c.amount)}</div>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${c.pct}%; background: ${c.color};"></div>
          </div>
          <div class="period-foot">
            <span>ชำระแล้ว ${c.paid_houses} หลัง</span>
            <span>ค้าง ${c.unpaid_houses} หลัง</span>
          </div>
        </div>
      `).join('');
    }

    function renderZoneChart(zoneChart) {
      const ctx = document.getElementById('chart-zones');
      if (!ctx || !zoneChart) return;

      const labels = zoneChart.map(z => z.zone);
      const totalData = zoneChart.map(z => z.total_pct);

      if (chartZonesInstance) chartZonesInstance.destroy();

      chartZonesInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'อัตราการชำระรวมทั้ง 4 งวด (%)',
              data: totalData,
              backgroundColor: '#059669',
              hoverBackgroundColor: '#047857',
              borderRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              max: 100,
              ticks: { callback: v => v + '%' }
            }
          },
          plugins: {
            legend: { position: 'top' },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const z = zoneChart[context.dataIndex];
                  return [
                    ` อัตราการชำระรวมทั้ง 4 งวด: ${z.total_pct}%`,
                    ` ยอดเก็บได้: ฿${Number(z.collected || 0).toLocaleString()} / ฿${Number(z.total_due || 0).toLocaleString()}`,
                    ` จำนวนบ้านในซอย: ${z.houses} หลัง`
                  ];
                }
              }
            }
          }
        }
      });
    }

    function renderExpensesChart(breakdown) {
      const ctx = document.getElementById('chart-expenses');
      if (!ctx || !breakdown) return;

      const labels = breakdown.map(b => b.name);
      const values = breakdown.map(b => b.amount);
      const colors = ['#2563eb', '#10b981', '#f59e0b', '#64748b', '#8b5cf6'];

      if (chartExpensesInstance) chartExpensesInstance.destroy();

      chartExpensesInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: labels,
          datasets: [{
            data: values,
            backgroundColor: colors.slice(0, values.length),
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { boxWidth: 12, font: { size: 11 } }
            }
          },
          cutout: '68%'
        }
      });
    }

    // ==================== Search House Feature (Image 2) ====================
    function doSearchHouse() {
      const q = document.getElementById('house-search-input').value.trim();
      const resultBox = document.getElementById('search-result-box');
      if (!q) {
        resultBox.innerHTML = '';
        return;
      }

      const match = HOUSES_DATA.find(h => h.house_no.toLowerCase() === q.toLowerCase()) ||
                    HOUSES_DATA.find(h => h.house_no.toLowerCase().includes(q.toLowerCase()));

      if (!match) {
        resultBox.innerHTML = `
          <div class="content-section" style="text-align: center; color: var(--danger);">
            <p>❌ ไม่พบข้อมูลบ้านเลขที่ "${q}" กรุณาตรวจสอบเลขที่บ้านอีกครั้ง</p>
          </div>
        `;
        return;
      }

      const cm = DASH_DATA ? DASH_DATA.current_month : 10;
      resultBox.innerHTML = `
        <div class="house-detail-card">
          <div class="house-detail-header">
            <div>
              <h3 style="font-size: 20px; font-weight: 700; color: #0f172a;">บ้านเลขที่ ${match.house_no}</h3>
              <p style="font-size: 13px; color: #64748b;">${match.zone} · เจ้าของ/ผู้พักอาศัย: <b>${match.owner}</b></p>
            </div>
            <div class="house-badges">
              <span class="badge-tag" style="background: #e0f2fe; color: #0369a1;">อัตรา ${match.rate} บ./เดือน</span>
              <span class="badge-tag ${match.overdue_count === 0 ? 'alert-success' : 'alert-error'}">
                ${match.overdue_count === 0 ? '✅ ชำระครบตามกำหนด' : '⚠️ ค้างชำระ ' + match.overdue_count + ' เดือน (฿' + fmt(match.overdue_amount) + ')'}
              </span>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px;">
            <div style="background: #f8fafc; padding: 12px; border-radius: 8px;">
              <small style="color: #64748b;">ชำระแล้วทั้งปี</small>
              <div style="font-size: 18px; font-weight: 700; color: #059669;">฿${fmt(match.paid_amount)} (${match.paid_count}/12 เดือน)</div>
            </div>
            <div style="background: #f8fafc; padding: 12px; border-radius: 8px;">
              <small style="color: #64748b;">ยอดค้างถึงปัจจุบัน</small>
              <div style="font-size: 18px; font-weight: 700; color: ${match.overdue_amount > 0 ? '#dc2626' : '#059669'};">
                ฿${fmt(match.overdue_amount)}
              </div>
            </div>
          </div>

          <div style="font-size: 13px; font-weight: 600; margin-bottom: 8px;">ประวัติการชำระเงินรายเดือน (ม.ค. - ธ.ค. 2569):</div>
          <div class="month-chips">
            ${match.months.map((paid, idx) => {
              const isPast = idx < cm;
              let cls = paid ? 'paid' : (isPast ? 'overdue' : 'pending');
              let statusTxt = paid ? 'ชำระแล้ว' : (isPast ? 'ค้างชำระ' : 'ยังไม่ถึง');
              return `
                <div class="m-chip ${cls}">
                  <span>${MONTHS_TH[idx]}</span>
                  <span style="font-size: 10px;">${statusTxt}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    document.getElementById('btn-search-trigger').onclick = doSearchHouse;
    document.getElementById('house-search-input').onkeydown = e => { if (e.key === 'Enter') doSearchHouse(); };

    function renderQuarterDot(q) {
      if (q.is_full) {
        return '<span class="circle-dot dot-green" title="ชำระครบงวด"></span>';
      } else if (q.paid_count > 0) {
        return '<span class="circle-dot dot-yellow" title="ชำระบางส่วน (' + q.paid_count + '/3 เดือน)"></span>';
      } else {
        return '<span class="circle-dot dot-gray" title="ยังไม่ชำระ"></span>';
      }
    }

    function renderHousesTable(houses) {
      const zVal = document.getElementById('zone-filter-select').value;
      const filtered = zVal ? houses.filter(h => h.zone === zVal) : houses;

      let html = `
        <thead>
          <tr>
            <th class="c">บ้านเลขที่</th>
            <th>ซอย / โซน</th>
            <th>เจ้าของ (ตัวย่อ)</th>
            <th class="c">งวด 1</th>
            <th class="c">งวด 2</th>
            <th class="c">งวด 3</th>
            <th class="c">งวด 4</th>
            <th class="r">จ่ายแล้ว</th>
            <th class="r">ค้างชำระ</th>
          </tr>
        </thead>
        <tbody>
      `;

      html += filtered.map(h => `
        <tr style="cursor: pointer;" onclick="document.getElementById('house-search-input').value='${h.house_no}'; doSearchHouse(); window.scrollTo({top: 100, behavior: 'smooth'});">
          <td class="c"><b>${h.house_no}</b></td>
          <td>${h.zone}</td>
          <td>${h.owner}</td>
          <td class="c">${renderQuarterDot(h.quarters[0])}</td>
          <td class="c">${renderQuarterDot(h.quarters[1])}</td>
          <td class="c">${renderQuarterDot(h.quarters[2])}</td>
          <td class="c">${renderQuarterDot(h.quarters[3])}</td>
          <td class="r" style="color: #059669; font-weight: 600;">฿${fmt0(h.paid_amount)}</td>
          <td class="r" style="color: ${h.overdue_amount > 0 ? '#dc2626' : '#64748b'}; font-weight: 600;">
            ${h.overdue_amount > 0 ? '฿' + fmt0(h.overdue_amount) : '-'}
          </td>
        </tr>
      `).join('');

      html += '</tbody>';
      document.getElementById('houses-table').innerHTML = html;
    }

    document.getElementById('zone-filter-select').onchange = () => renderHousesTable(HOUSES_DATA);

    // ==================== Financial Statement (Image 3) ====================
    function renderFinancialStatement(data) {
      if (!data || !data.statement) return;
      document.getElementById('stmt-date-txt').textContent = data.as_of_thai;
      document.getElementById('stmt-as-of-header').textContent = 'ข้อมูลสรุปการรับ-จ่ายเงินของกองทุนพัฒนาหมู่บ้าน ณ ' + data.as_of_thai;

      const tbody = document.getElementById('statement-tbody');
      tbody.innerHTML = data.statement.map(row => {
        let trClass = '';
        if (row.highlight === 'blue') trClass = 'tr-highlight-blue';
        else if (row.highlight === 'red') trClass = 'tr-highlight-red';
        else if (row.highlight === 'green') trClass = 'tr-highlight-green';

        return `
          <tr class="${trClass}">
            <td class="c">${row.date}</td>
            <td>${row.title}</td>
            <td class="r">${fmt(row.amount)}</td>
          </tr>
        `;
      }).join('');
    }

    // Realtime SSE stream
    loadData();
    const es = new EventSource('/api/stream');
    es.addEventListener('update', () => loadData());
    es.onerror = () => {
      document.getElementById('live-dot').style.background = '#f59e0b';
      document.getElementById('live-status').textContent = 'กำลังเชื่อมต่อใหม่...';
    };
    es.onopen = () => {
      document.getElementById('live-dot').style.background = '#10b981';
      document.getElementById('live-status').textContent = 'ข้อมูลแบบเรียลไทม์';
    };
