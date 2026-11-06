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
    window.CURRENT_PUBLIC_YEAR = null;

    window.onPublicYearChange = function(yr) {
      loadData(parseInt(yr));
    };

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

    async function loadData(targetYear = null) {
      try {
        const yParam = targetYear ? `&year=${targetYear}` : '';
        const [dashRes, housesRes] = await Promise.all([
          fetch('/api/dashboard?_=' + Date.now() + yParam).then(r => r.json()),
          fetch('/api/houses?_=' + Date.now() + yParam).then(r => r.json())
        ]);
        DASH_DATA = dashRes;
        HOUSES_DATA = housesRes;
        window.CURRENT_PUBLIC_YEAR = dashRes.fiscal_year;

        renderDashboard(dashRes);
        renderHousesTable(housesRes);
        renderFinancialStatement(dashRes);
      } catch (err) {
        console.error("Fetch data error:", err);
      }
    }

    function renderDashboard(data) {
      const yrSel = document.getElementById('nav-year-select');
      if (yrSel) {
        const list = (data.fiscal_years && data.fiscal_years.length > 0)
          ? data.fiscal_years
          : [{ year_be: data.fiscal_year, title: `ปี ${data.fiscal_year}` }];
        yrSel.innerHTML = list.map(y => {
          const yr = typeof y === 'object' ? y.year_be : y;
          const title = typeof y === 'object' ? (y.title || `ปี ${yr}`) : `ปี ${yr}`;
          return `<option value="${yr}" ${yr == data.fiscal_year ? 'selected' : ''}>${title}</option>`;
        }).join('');
      } else if (document.getElementById('nav-year')) {
        document.getElementById('nav-year').textContent = 'ปี ' + data.fiscal_year;
      }

      // Update dynamic labels with current fiscal year
      const fy = data.fiscal_year;
      const prevFy = fy - 1;
      const elExp = document.getElementById('lbl-expenses-year');
      if (elExp) elExp.textContent = `ค่าใช้จ่ายสะสมปี ${fy}`;

      const elOp = document.getElementById('lbl-opening-year');
      if (elOp) elOp.textContent = `ยอดยกมาจากปี ${prevFy} (รวม)`;

      const elProg = document.getElementById('lbl-period-progress');
      if (elProg) elProg.textContent = `ความคืบหน้าการจัดเก็บเงินตามงวด (ปี ${fy})`;

      const elStmt = document.getElementById('stmt-heading');
      if (elStmt) elStmt.textContent = `📑 รายงานสรุปงบการเงินประจำปี ${fy} (ฉบับประชาชน)`;

      const elPaperStmt = document.getElementById('stmt-paper-heading');
      if (elPaperStmt) elPaperStmt.textContent = `รายงานสรุปการรับ-จ่ายเงินของกองทุนพัฒนาหมู่บ้าน ปี ${fy}`;

      const bal = data.balance;

      // 4 Main Stats
      document.getElementById('val-total').textContent = '฿' + fmt(bal.total);
      document.getElementById('val-bank').textContent = '฿' + fmt(bal.bank);
      document.getElementById('val-reserve').textContent = '฿' + fmt(bal.reserve);
      document.getElementById('val-received').textContent = '฿' + fmt(bal.received);
      document.getElementById('val-houses').textContent = data.houses_total + ' หลังคาเรือน';
      document.getElementById('val-expenses').textContent = '฿' + fmt(bal.expenses);
      const openTotal = (bal.opening_total !== undefined) ? bal.opening_total : (bal.opening || 82969.73);
      document.getElementById('val-opening').textContent = '฿' + fmt(openTotal);
      if (document.getElementById('val-open-bank')) {
        const ob = (bal.opening_bank !== undefined) ? bal.opening_bank : ((bal.opening || 82969.73) - (bal.opening_reserve || 10049.57));
        document.getElementById('val-open-bank').textContent = '฿' + fmt(ob);
      }
      if (document.getElementById('val-open-reserve')) document.getElementById('val-open-reserve').textContent = '฿' + fmt(bal.opening_reserve);
      if (document.getElementById('val-interest')) document.getElementById('val-interest').textContent = '฿' + fmt(bal.other_income);
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
      if (!container) return;

      let cardList = Array.isArray(cards) ? [...cards] : [];
      if (!cardList.some(c => c && c.is_no_slip)) {
        cardList.push({
          period: 0,
          is_no_slip: true,
          name: 'ยังไม่มีสลิป',
          amount: 0,
          paid_houses: 0,
          unpaid_houses: 0,
          pct: 0,
          color: '#f59e0b',
          note: 'โอนไม่ส่งสลิป / รอระบุลูกบ้าน'
        });
      }

      container.innerHTML = cardList.map(c => {
        if (c.is_no_slip) {
          const count = c.paid_houses || 0;
          const amt = c.amount || 0;
          return `
            <div class="period-card" style="border-top: 3px solid #f59e0b; background: linear-gradient(180deg, #fffbeb 0%, #ffffff 100%);">
              <div class="period-top">
                <span class="period-name" style="color: #b45309; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                  <span>⚠️</span> ${c.name}
                </span>
                <span class="period-pct" style="color: ${count > 0 ? '#d97706' : '#10b981'}; font-size: 11.5px; font-weight: 600;">
                  ${count > 0 ? 'รอตรวจสอบ' : 'เรียบร้อย'}
                </span>
              </div>
              <div class="period-amt" style="color: #b45309;">฿${fmt0(amt)}</div>
              <div class="progress-track" style="background: #fde68a;">
                <div class="progress-fill" style="width: ${count > 0 ? 100 : 0}%; background: #f59e0b;"></div>
              </div>
              <div class="period-foot">
                <span style="font-weight: 600; color: #475569;">${count} รายการ</span>
                <span style="color: #92400e; font-size: 11px;">${c.note || 'โอนไม่ส่งสลิป'}</span>
              </div>
            </div>
          `;
        }
        return `
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
        `;
      }).join('');
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
                ${match.overdue_count === 0 ? '✅ ชำระครบทั้งปี 2569' : '⚠️ ค้างชำระ ' + match.overdue_count + ' งวด (฿' + fmt(match.overdue_amount) + ')'}
              </span>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px;">
            <div style="background: #f8fafc; padding: 12px; border-radius: 8px;">
              <small style="color: #64748b;">ชำระแล้วทั้งปี</small>
              <div style="font-size: 18px; font-weight: 700; color: #059669;">฿${fmt(match.paid_amount)} (${match.paid_count}/4 งวด)</div>
            </div>
            <div style="background: #f8fafc; padding: 12px; border-radius: 8px;">
              <small style="color: #64748b;">ยอดค้างชำระทั้งปี 2569</small>
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

    // Realtime SSE stream + 30s auto-refresh fallback
    loadData();
    setInterval(loadData, 30000);
    try {
      const es = new EventSource('/api/stream');
      es.onmessage = () => loadData();
      es.addEventListener('update', () => loadData());
      es.onerror = () => {
        const dot = document.getElementById('live-dot');
        const st = document.getElementById('live-status');
        if (dot) dot.style.background = '#f59e0b';
        if (st) st.textContent = 'กำลังเชื่อมต่อใหม่...';
      };
      es.onopen = () => {
        const dot = document.getElementById('live-dot');
        const st = document.getElementById('live-status');
        if (dot) dot.style.background = '#10b981';
        if (st) st.textContent = 'ข้อมูลแบบเรียลไทม์';
      };
    } catch (e) {
      console.warn('SSE error:', e);
    }
