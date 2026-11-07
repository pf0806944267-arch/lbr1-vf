from config import FY, INCOME_TYPES, MONTH_TH, PERIOD_NAMES, mask_name, now_th, num
from services.store import store


def get_active_fy(d=None):
    if d is None:
        d = store.data
    fys = d.get("fiscal_years", [])
    for fy in fys:
        act = fy.get("is_active")
        if act is True or str(act).lower() in ("true", "t", "1", "y"):
            try:
                return int(fy.get("year_be"))
            except Exception:
                pass
    if fys:
        try:
            return max(int(x.get("year_be", FY)) for x in fys)
        except Exception:
            pass
    return FY


def get_fiscal_years_list(d=None):
    if d is None:
        d = store.data
    fys = d.get("fiscal_years", [])
    out = []
    for f in sorted(fys, key=lambda x: int(x.get("year_be", 0)), reverse=True):
        y = int(f.get("year_be", 0))
        if not y:
            continue
        act = f.get("is_active")
        is_act = (act is True) or str(act).lower() in ("true", "t", "1", "y")
        is_cls = (f.get("is_closed") is True) or str(f.get("is_closed")).lower() in ("true", "t", "1", "y")
        out.append({
            "year_be": y,
            "title": f.get("title") or f"ปีงบประมาณ {y}",
            "opening_balance": num(f.get("opening_balance")),
            "opening_bank": num(f.get("opening_bank", round(num(f.get("opening_balance")) - num(f.get("opening_reserve")), 2))),
            "opening_reserve": num(f.get("opening_reserve")),
            "is_active": is_act,
            "is_closed": is_cls
        })
    if not out:
        out = [{
            "year_be": FY,
            "title": f"ปีงบประมาณ {FY}",
            "opening_balance": 82969.73,
            "opening_bank": 72920.16,
            "opening_reserve": 10049.57,
            "is_active": True,
            "is_closed": False
        }]
    return out


def current_month(target_fy=None):
    fy = int(target_fy or get_active_fy())
    n = now_th()
    ce_fy = fy - 543
    if n.year > ce_fy:
        return 12
    if n.year < ce_fy:
        return 0
    return n.month


def build_model(target_fy=None):
    fy = int(target_fy or get_active_fy())
    d = store.data
    zones = {z["zone_id"]: z for z in d.get("zones", [])}
    houses = {h["house_id"]: h for h in d.get("houses", [])}
    dues = [x for x in d.get("dues", []) if str(x.get("year_be")) == str(fy)]
    paid_by_due = {}
    for p in d.get("payments", []):
        if p.get("due_id") and str(p.get("year_be", fy)) == str(fy):
            paid_by_due[p["due_id"]] = p
    owners = {}
    members = {m["member_id"]: m["full_name"] for m in d.get("members", [])}
    for hm in d.get("house_members", []):
        owners.setdefault(hm["house_id"], []).append(members.get(hm["member_id"], ""))
    return zones, houses, dues, paid_by_due, owners


def summary(target_fy=None):
    d = store.data
    fy = int(target_fy or get_active_fy())
    zones, houses, dues, paid_by_due, owners = build_model(fy)
    actual_houses = {hid: h for hid, h in houses.items() if hid != "NOSLIP"}

    fy_row = next((x for x in d.get("fiscal_years", []) if str(x.get("year_be")) == str(fy)), {})
    opening = num(fy_row.get("opening_balance", 82969.73))
    opening_reserve = num(fy_row.get("opening_reserve", 10049.57))
    opening_bank = num(fy_row.get("opening_bank", round(opening - opening_reserve, 2)))

    # Calculate member payments received
    paid_amount = {dd["due_id"]: num(paid_by_due[dd["due_id"]]["amount_paid"]) for dd in dues if dd["due_id"] in paid_by_due}
    standalone_payments = sum(num(p.get("amount_paid")) for p in d.get("payments", []) if not p.get("due_id") and str(p.get("year_be", fy)) == str(fy))
    received = sum(paid_amount.values()) + standalone_payments

    year_incomes = [x for x in d.get("other_income", []) if str(x.get("year_be", fy)) == str(fy)]
    other_income = sum(num(x["amount"]) for x in year_incomes)
    income_by_type = {t: 0.0 for t in INCOME_TYPES}
    cash_income = 0.0
    for x in year_incomes:
        t = x.get("type") if x.get("type") in INCOME_TYPES else "other"
        income_by_type[t] += num(x["amount"])
        if x.get("channel") == "cash":
            cash_income += num(x["amount"])

    year_expenses = [e for e in d.get("expenses", []) if str(e.get("year_be", fy)) == str(fy)]
    exp_total = sum(num(e["amount"]) for e in year_expenses)

    # --- เงินสำรอง (เงินสดในมือ) ---
    ledger = [r for r in d.get("reserve_transactions", []) if str(r.get("year_be", fy)) == str(fy)]
    reserve_in = sum(num(r["amount"]) for r in ledger if r.get("type") == "in")
    reserve_out = sum(num(r["amount"]) for r in ledger if r.get("type") == "out")
    reserve_bal = round(reserve_in - reserve_out, 2)

    # --- ยอดเงินคงเหลือสุทธิรวม (ตามงบการเงินจริง) ---
    total = round(opening + received + other_income - exp_total, 2)
    bank_bal = round(total - reserve_bal, 2)

    periods = [0.0] * 4
    monthly = [0.0] * 12
    z_stat = {zid: {"zone": z["name"], "houses": 0, "periods": [{"paid": 0, "unpaid": 0} for _ in range(4)],
                    "collected": 0.0, "due_to_date": 0.0, "total_due_year": 0.0} for zid, z in zones.items() if zid != "Z00"}

    house_periods = {}
    cm = current_month(fy)

    for dd in dues:
        hid = dd["house_id"]
        pr = int(dd.get("period", 1))
        paid = dd["due_id"] in paid_by_due
        house_periods.setdefault(hid, {})[pr] = paid

        if hid in actual_houses and actual_houses[hid]["zone_id"] in z_stat:
            z_stat[actual_houses[hid]["zone_id"]]["total_due_year"] += num(dd["amount_due"])

        if paid:
            a = paid_amount[dd["due_id"]]
            periods[pr - 1] += a
            for i in range(3):
                monthly[(pr - 1) * 3 + i] += a / 3.0
            if hid in actual_houses and actual_houses[hid]["zone_id"] in z_stat:
                z_stat[actual_houses[hid]["zone_id"]]["collected"] += a

        current_period = ((cm - 1) // 3) + 1 if cm > 0 else 0
        if pr <= current_period and hid in actual_houses and actual_houses[hid]["zone_id"] in z_stat:
            z_stat[actual_houses[hid]["zone_id"]]["due_to_date"] += num(dd["amount_due"])

    for hid, h in actual_houses.items():
        if h["zone_id"] not in z_stat:
            continue
        zs = z_stat[h["zone_id"]]
        zs["houses"] += 1
        for pr in range(4):
            ok = house_periods.get(hid, {}).get(pr + 1, False)
            zs["periods"][pr]["paid" if ok else "unpaid"] += 1

    for z in z_stat.values():
        for p in z["periods"]:
            t = p["paid"] + p["unpaid"]
            p["pct"] = round(100 * p["paid"] / t, 1) if t else 0

    zlist = sorted(z_stat.values(), key=lambda z: (z["zone"] == "สายหลัก", int(z["zone"].split()[1]) if z["zone"] != "สายหลัก" else 0))

    # Period cards: matching Image 1
    period_cards = []
    p_colors = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b"]
    for pr in range(4):
        p_houses_paid = sum(1 for hid in actual_houses if house_periods.get(hid, {}).get(pr + 1))
        p_houses_unpaid = len(actual_houses) - p_houses_paid
        pct = round(100 * p_houses_paid / len(actual_houses), 1) if actual_houses else 0
        period_cards.append({
            "period": pr + 1,
            "name": PERIOD_NAMES[pr],
            "amount": round(periods[pr], 2),
            "paid_houses": p_houses_paid,
            "unpaid_houses": p_houses_unpaid,
            "pct": pct,
            "color": p_colors[pr]
        })

    # Unknown house card: รายการที่ไม่ทราบบ้านเลขที่ (โอนเงินเข้าบัญชี แต่ยังไม่ส่งสลิป/ไม่ระบุบ้าน)
    unknown_house_payments = [
        p for p in d.get("payments", [])
        if (str(p.get("year_be", fy)) == str(fy) or not p.get("year_be")) and (
            p.get("house_id") == "NOSLIP" or p.get("house_no") == "ไม่มีสลิป" or (not p.get("due_id") and not p.get("house_id"))
        )
    ]
    unknown_house_count = len(unknown_house_payments)
    unknown_house_amount = sum(num(p.get("amount_paid")) for p in unknown_house_payments)
    period_cards.append({
        "period": 0,
        "is_no_slip": True,
        "name": "ไม่ทราบบ้านเลขที่",
        "amount": round(unknown_house_amount, 2),
        "paid_houses": unknown_house_count,
        "unpaid_houses": 0,
        "pct": 100 if unknown_house_count > 0 else 0,
        "color": "#f59e0b",
        "note": "โอนไม่ส่งสลิป / รอระบุลูกบ้าน"
    })

    # Zone Chart: อัตราการชำระเงินแยกตามซอย (%) สรุปรวมทั้ง 4 งวดในแต่ละซอย
    zone_chart = []
    for z in zlist:
        p1 = z["periods"][0]
        p4 = z["periods"][3]
        total_due = z.get("total_due_year", 0.0)
        coll = z["collected"]
        total_pct = round(100 * coll / total_due, 1) if total_due > 0 else 0
        zone_chart.append({
            "zone": z["zone"],
            "houses": z["houses"],
            "total_pct": total_pct,
            "total_due": total_due,
            "collected": coll,
            "p1_pct": p1["pct"],
            "p4_pct": p4["pct"],
        })

    # Expenses Budget Breakdown
    cat_buckets = {
        "ค่า รปภ. รักษาความปลอดภัย": 0.0,
        "บำรุงรักษา & สวน": 0.0,
        "สาธารณูปโภค (ไฟ/น้ำ)": 0.0,
        "ค่าบริการธนาคาร SMS": 0.0,
        "อื่นๆ": 0.0
    }
    for e in year_expenses:
        desc = str(e.get("description", ""))
        a = num(e.get("amount", 0))
        if any(k in desc for k in ["รปภ", "รักษาความปลอดภัย", "ยาม", "พิเชษฐ์"]):
            cat_buckets["ค่า รปภ. รักษาความปลอดภัย"] += a
        elif any(k in desc for k in ["ไฟ", "หลอด", "โคม", "ซ่อม", "ปูน", "สี", "กาว", "ตู้", "เกาะกลาง", "หญ้า", "สวน", "คัทเอาท์"]):
            cat_buckets["บำรุงรักษา & สวน"] += a
        elif any(k in desc for k in ["น้ำ", "ประปา", "การประปา", "การไฟฟ้า"]):
            cat_buckets["สาธารณูปโภค (ไฟ/น้ำ)"] += a
        elif any(k in desc for k in ["SMS", "ธนาคาร", "ธรรมเนียม"]):
            cat_buckets["ค่าบริการธนาคาร SMS"] += a
        else:
            cat_buckets["อื่นๆ"] += a

    budget_breakdown = [{"name": k, "amount": round(v, 2)} for k, v in cat_buckets.items() if v > 0]
    recent = sorted(year_expenses, key=lambda e: (e.get("expense_date", ""), e.get("expense_id", "")), reverse=True)[:10]
    full_due = sum(num(x["amount_due"]) for x in dues if x["house_id"] != "NOSLIP")

    prev_fy = fy - 1
    fy_short = str(fy)[-2:]
    # Financial Statement rows
    statement = [
        {"date": f"1/1/{fy_short}", "title": f"ยอดเงินคงเหลือ ปี {prev_fy} (ยกมา)", "amount": round(opening, 2), "type": "opening"},
        {"date": "-", "title": f"รับเงินจากสมาชิก งวดที่ 1 (ม.ค. - มี.ค. {fy_short}) [ชำระแล้ว {period_cards[0]['paid_houses']}/{len(actual_houses)} หลัง]", "amount": periods[0], "type": "income"},
        {"date": "-", "title": f"รับเงินจากสมาชิก งวดที่ 2 (เม.ย. - มิ.ย. {fy_short}) [ชำระแล้ว {period_cards[1]['paid_houses']}/{len(actual_houses)} หลัง]", "amount": periods[1], "type": "income"},
        {"date": "-", "title": f"รับเงินจากสมาชิก งวดที่ 3 (ก.ค. - ก.ย. {fy_short}) [ชำระแล้ว {period_cards[2]['paid_houses']}/{len(actual_houses)} หลัง]", "amount": periods[2], "type": "income"},
        {"date": "-", "title": f"รับเงินจากสมาชิก งวดที่ 4 (ต.ค. - ธ.ค. {fy_short}) [ชำระแล้ว {period_cards[3]['paid_houses']}/{len(actual_houses)} หลัง]", "amount": periods[3], "type": "income"},
        {"date": "-", "title": f"รวมรับเงินจากสมาชิกทั้งหมด ({len(actual_houses)} หลังคาเรือน)", "amount": received, "type": "total_received", "highlight": "blue"},
        *[{"date": "-", "title": f"รายได้อื่น: {INCOME_TYPES.get(t, t)}", "amount": a, "type": "income"}
          for t, a in income_by_type.items() if a],
        {"date": "-", "title": "รวมรายได้อื่น (เงินสนับสนุน/ดอกเบี้ย)", "amount": other_income, "type": "total_received", "highlight": "blue"},
        {"date": "-", "title": f"รวมค่าใช้จ่ายตั้งแต่ ม.ค. {fy} - ปัจจุบัน", "amount": exp_total, "type": "total_expense", "highlight": "red"},
        {"date": "-", "title": "เงินสำรองคงเหลือ (เงินสดในมือ)", "amount": reserve_bal, "type": "reserve"},
        {"date": "-", "title": "เงินคงเหลือในสมุดบัญชีธนาคาร (ธนาคารกรุงเทพ)", "amount": bank_bal, "type": "bank"},
        {"date": "ณ ปัจจุบัน", "title": "รวมเงินคงเหลือสุทธิทั้งสิ้น (Real-time)", "amount": total, "type": "final_balance", "highlight": "green"}
    ]

    return {
        "fiscal_year": fy,
        "fiscal_years": get_fiscal_years_list(d),
        "active_year": get_active_fy(d),
        "as_of": now_th().strftime("%Y-%m-%d %H:%M:%S"),
        "as_of_thai": f"{now_th().day} {MONTH_TH[now_th().month - 1]} {fy} เวลา {now_th().strftime('%H:%M:%S')} น.",
        "current_month": cm,
        "balance": {
            "opening": opening,
            "opening_reserve": opening_reserve,
            "opening_bank": opening_bank,
            "opening_total": opening,
            "received": received,
            "other_income": other_income,
            "other_income_by_type": {t: round(a, 2) for t, a in income_by_type.items()},
            "expenses": exp_total,
            "total": round(total, 2),
            "reserve": round(reserve_bal, 2),
            "bank": round(bank_bal, 2),
        },
        "period_cards": period_cards,
        "zone_chart": zone_chart,
        "budget_breakdown": budget_breakdown,
        "statement": statement,
        "monthly": [round(x, 2) for x in monthly],
        "zones": zlist,
        "houses_total": len(actual_houses),
        "year_collected_pct": round(100 * received / full_due, 1) if full_due else 0,
        "recent_expenses": [{"date": e.get("expense_date", ""), "description": e.get("description", ""),
                             "amount": num(e.get("amount", 0)), "payee": e.get("payee", "")} for e in recent],
        "version": store.version,
    }


def houses_view(full=False, target_fy=None):
    fy = int(target_fy or get_active_fy())
    zones, houses, dues, paid_by_due, owners = build_model(fy)
    actual_houses = {hid: h for hid, h in houses.items() if hid != "NOSLIP"}

    dues_by_house = {}
    for dd in dues:
        hid = dd["house_id"]
        pr = int(dd.get("period", 1))
        dues_by_house.setdefault(hid, {})[pr] = dd

    out = []
    for hid, h in actual_houses.items():
        quarters = []
        house_slips = []
        rate_monthly = 100 if zones.get(h["zone_id"], {}).get("name") == "สายหลัก" else 300
        rate_quarterly = rate_monthly * 3.0  # 300.0 or 900.0
        months = [False] * 12
        paid_amount = 0.0

        for pr in range(1, 5):
            dd = dues_by_house.get(hid, {}).get(pr)
            did = dd["due_id"] if dd else f"D{fy}-{hid}-P{pr}"
            payment = paid_by_due.get(did)

            p_amt = num(payment.get("amount_paid")) if payment else 0.0
            paid_amount += p_amt
            is_full = (p_amt >= rate_quarterly)
            paid_count = 3 if is_full else (1 if p_amt > 0 else 0)

            for i in range(paid_count):
                months[(pr - 1) * 3 + i] = True

            q_slip_url = payment.get("slip_url", "") if payment else ""
            q_channel = payment.get("channel", "") if payment else ""
            q_paid_date = payment.get("paid_date", "") if payment else ""
            q_payment_id = payment.get("payment_id", "") if payment else ""
            q_transfer_time = payment.get("transfer_time", "") if payment else ""
            has_slip = bool(q_slip_url) or (payment.get("has_slip") == "Y" if payment else False)

            if q_slip_url and q_slip_url not in [s["url"] for s in house_slips]:
                house_slips.append({
                    "period": pr,
                    "url": q_slip_url,
                    "date": q_paid_date,
                    "channel": q_channel,
                    "payment_id": q_payment_id
                })

            quarters.append({
                "period": pr,
                "is_full": is_full,
                "paid_count": paid_count,
                "has_slip": has_slip,
                "slip_url": q_slip_url,
                "channel": q_channel,
                "paid_date": q_paid_date,
                "payment_id": q_payment_id,
                "transfer_time": q_transfer_time,
                "amount": p_amt
            })

        # Requirement 2: ยอดค้างให้คำนวณทั้งปี
        annual_fee = rate_quarterly * 4.0  # 3,600 or 1,200
        overdue_amount = max(0.0, annual_fee - paid_amount)
        overdue_periods = sum(1 for q in quarters if not q["is_full"])

        names = owners.get(hid, [])
        item = {
            "house_id": hid,
            "house_no": h["house_no"],
            "zone": zones.get(h["zone_id"], {}).get("name", ""),
            "name": " / ".join(names) if full else " / ".join(mask_name(n) for n in names),
            "owner": " / ".join(names) if full else " / ".join(mask_name(n) for n in names),
            "owner_full": " / ".join(names),
            "rate": rate_monthly,
            "months": months,
            "quarters": quarters,
            "slips": house_slips,
            "paid_count": sum(1 for q in quarters if q["is_full"]),
            "paid_amount": paid_amount,
            "overdue_count": overdue_periods,
            "overdue_amount": overdue_amount,
            "annual_fee": annual_fee
        }
        out.append(item)

    out.sort(key=lambda x: (x["zone"] == "สายหลัก", int(x["zone"].split()[1]) if x["zone"] != "สายหลัก" else 0, x["house_no"]))
    return out
