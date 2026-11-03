from config import FY, INCOME_TYPES, MONTH_TH, PERIOD_NAMES, mask_name, now_th, num
from services.store import store


def current_month():
    n = now_th()
    ce_fy = FY - 543
    if n.year > ce_fy:
        return 12
    if n.year < ce_fy:
        return 0
    return n.month


def build_model():
    d = store.data
    zones = {z["zone_id"]: z for z in d.get("zones", [])}
    houses = {h["house_id"]: h for h in d.get("houses", [])}
    dues = [x for x in d.get("dues", []) if str(x.get("year_be")) == str(FY)]
    paid_by_due = {}
    for p in d.get("payments", []):
        paid_by_due[p["due_id"]] = p
    owners = {}
    members = {m["member_id"]: m["full_name"] for m in d.get("members", [])}
    for hm in d.get("house_members", []):
        owners.setdefault(hm["house_id"], []).append(members.get(hm["member_id"], ""))
    return zones, houses, dues, paid_by_due, owners


def summary():
    d = store.data
    zones, houses, dues, paid_by_due, owners = build_model()
    fy = next((x for x in d.get("fiscal_years", []) if str(x.get("year_be")) == str(FY)), {})
    opening = num(fy.get("opening_balance", 82969.73))
    opening_reserve = num(fy.get("opening_reserve", 10049.57))

    paid_amount = {dd["due_id"]: num(paid_by_due[dd["due_id"]]["amount_paid"]) for dd in dues if dd["due_id"] in paid_by_due}
    received = sum(paid_amount.values())
    other_income = sum(num(x["amount"]) for x in d.get("other_income", []))
    income_by_type = {t: 0.0 for t in INCOME_TYPES}
    cash_income = 0.0
    for x in d.get("other_income", []):
        t = x.get("type") if x.get("type") in INCOME_TYPES else "other"
        income_by_type[t] += num(x["amount"])
        if x.get("channel") == "cash":  # ไม่มีค่า/ข้อมูลเก่า = โอนเข้าธนาคาร
            cash_income += num(x["amount"])
    exp_total = sum(num(e["amount"]) for e in d.get("expenses", []))

    # --- เงินสำรอง (เงินสดในมือ) คำนวณอัตโนมัติ ---
    expense_by_id = {e.get("expense_id"): e for e in d.get("expenses", [])}
    ledger = d.get("reserve_transactions", [])
    ledger_exp_ids = {r.get("expense_id") for r in ledger if r.get("type") == "out" and r.get("expense_id")}
    reserve_in = sum(num(r["amount"]) for r in ledger if r.get("type") == "in")
    reserve_out = sum(num(r["amount"]) for r in ledger if r.get("type") == "out"
                      and (not r.get("expense_id") or r.get("expense_id") in expense_by_id))
    # รายจ่ายใหม่ที่จ่ายจากเงินสำรอง และยังไม่มีในสมุดเงินสำรอง
    reserve_out += sum(num(e["amount"]) for e in d.get("expenses", [])
                       if e.get("source") == "reserve" and e.get("expense_id") not in ledger_exp_ids)
    # รับชำระค่าสมาชิกเป็นเงินสด
    cash_payments = sum(num(p.get("amount_paid")) for p in paid_by_due.values() if p.get("channel") == "cash")
    reserve_bal = reserve_in - reserve_out + cash_income + cash_payments

    # คำนวณยอดเงินฝากธนาคารกรุงเทพที่แท้จริง
    transfers_to_reserve = sum(num(r["amount"]) for r in ledger if r.get("type") == "in" and r.get("rt_id") != "RT0001")
    bank_expenses = sum(num(e["amount"]) for e in d.get("expenses", []) if e.get("source") != "reserve")
    bank_received = received - cash_payments
    bank_income = other_income - cash_income
    bank_bal = opening + bank_received + bank_income - bank_expenses - transfers_to_reserve

    # ยอดเงินคงเหลือสุทธิรวมทุกบัญชี (ธนาคาร + เงินสด)
    total = bank_bal + reserve_bal

    periods = [0.0] * 4
    monthly = [0.0] * 12
    z_stat = {zid: {"zone": z["name"], "houses": 0, "periods": [{"paid": 0, "unpaid": 0} for _ in range(4)],
                    "collected": 0.0, "due_to_date": 0.0, "total_due_year": 0.0} for zid, z in zones.items()}
    house_months = {}
    cm = current_month()
    for dd in dues:
        m = int(dd.get("month", 1))
        pr = int(dd.get("period", 1))
        hid = dd["house_id"]
        paid = dd["due_id"] in paid_by_due
        house_months.setdefault(hid, {})[m] = paid
        if hid in houses and houses[hid]["zone_id"] in z_stat:
            z_stat[houses[hid]["zone_id"]]["total_due_year"] += num(dd["amount_due"])
        if paid:
            a = paid_amount[dd["due_id"]]
            periods[pr - 1] += a
            monthly[m - 1] += a
            if hid in houses and houses[hid]["zone_id"] in z_stat:
                z_stat[houses[hid]["zone_id"]]["collected"] += a
        if m <= cm and hid in houses and houses[hid]["zone_id"] in z_stat:
            z_stat[houses[hid]["zone_id"]]["due_to_date"] += num(dd["amount_due"])

    for hid, h in houses.items():
        if h["zone_id"] not in z_stat:
            continue
        zs = z_stat[h["zone_id"]]
        zs["houses"] += 1
        for pr in range(4):
            months = [pr * 3 + i for i in (1, 2, 3)]
            ok = all(house_months.get(hid, {}).get(m) for m in months)
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
        p_houses_paid = sum(1 for hid in houses if all(house_months.get(hid, {}).get(pr * 3 + i) for i in (1, 2, 3)))
        p_houses_unpaid = len(houses) - p_houses_paid
        pct = round(100 * p_houses_paid / len(houses), 1) if houses else 0
        period_cards.append({
            "period": pr + 1,
            "name": PERIOD_NAMES[pr],
            "amount": round(periods[pr], 2),
            "paid_houses": p_houses_paid,
            "unpaid_houses": p_houses_unpaid,
            "pct": pct,
            "color": p_colors[pr]
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
    for e in d.get("expenses", []):
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
    recent = sorted(d.get("expenses", []), key=lambda e: (e.get("expense_date", ""), e.get("expense_id", "")), reverse=True)[:10]
    full_due = sum(num(x["amount_due"]) for x in dues)

    # Financial Statement rows matching Image 3
    statement = [
        {"date": "24/1/69", "title": "ยอดเงินคงเหลือ ปี 2568 (ยกมา) [ธนาคาร ฿82,969.73 + เงินสด ฿10,049.57]", "amount": round(opening + opening_reserve, 2), "type": "opening"},
        {"date": "-", "title": f"รับเงินจากสมาชิก งวดที่ 1 (ม.ค. - มี.ค. 69) [ชำระแล้ว {period_cards[0]['paid_houses']}/{len(houses)} หลัง]", "amount": periods[0], "type": "income"},
        {"date": "-", "title": f"รับเงินจากสมาชิก งวดที่ 2 (เม.ย. - มิ.ย. 69) [ชำระแล้ว {period_cards[1]['paid_houses']}/{len(houses)} หลัง]", "amount": periods[1], "type": "income"},
        {"date": "-", "title": f"รับเงินจากสมาชิก งวดที่ 3 (ก.ค. - ก.ย. 69) [ชำระแล้ว {period_cards[2]['paid_houses']}/{len(houses)} หลัง]", "amount": periods[2], "type": "income"},
        {"date": "-", "title": f"รับเงินจากสมาชิก งวดที่ 4 (ต.ค. - ธ.ค. 69) [ชำระแล้ว {period_cards[3]['paid_houses']}/{len(houses)} หลัง]", "amount": periods[3], "type": "income"},
        {"date": "-", "title": f"รวมรับเงินจากสมาชิกทั้ง 4 งวด ({len(houses)} หลังคาเรือน)", "amount": received, "type": "total_received", "highlight": "blue"},
        *[{"date": "-", "title": f"รายได้อื่น: {INCOME_TYPES.get(t, t)}", "amount": a, "type": "income"}
          for t, a in income_by_type.items() if a],
        {"date": "-", "title": "รวมรายได้อื่น (บริจาค/ดอกเบี้ย/เงินสนับสนุน/อื่นๆ)", "amount": other_income, "type": "total_received", "highlight": "blue"},
        {"date": "-", "title": "รวมค่าใช้จ่ายตั้งแต่ ม.ค. 2569 - ปัจจุบัน", "amount": exp_total, "type": "total_expense", "highlight": "red"},
        {"date": "-", "title": "เงินสำรองคงเหลือ (เงินสดในมือ)", "amount": reserve_bal, "type": "reserve"},
        {"date": "-", "title": "เงินคงเหลือในสมุดบัญชีธนาคาร (ธนาคารกรุงเทพ)", "amount": bank_bal, "type": "bank"},
        {"date": "ณ ปัจจุบัน", "title": "รวมเงินคงเหลือสุทธิทั้งสิ้น (Real-time)", "amount": total, "type": "final_balance", "highlight": "green"}
    ]

    return {
        "fiscal_year": FY,
        "as_of": now_th().strftime("%Y-%m-%d %H:%M:%S"),
        "as_of_thai": f"{now_th().day} {MONTH_TH[now_th().month - 1]} {FY} เวลา {now_th().strftime('%H:%M:%S')} น.",
        "current_month": cm,
        "balance": {
            "opening": opening,
            "received": received,
            "other_income": other_income,
            "other_income_by_type": {t: round(a, 2) for t, a in income_by_type.items()},
            "expenses": exp_total,
            "total": round(total, 2),
            "reserve": round(reserve_bal, 2),
            "bank": round(bank_bal, 2),
            "opening_reserve": opening_reserve
        },
        "period_cards": period_cards,
        "zone_chart": zone_chart,
        "budget_breakdown": budget_breakdown,
        "statement": statement,
        "monthly": [round(x, 2) for x in monthly],
        "zones": zlist,
        "houses_total": len(houses),
        "year_collected_pct": round(100 * received / full_due, 1) if full_due else 0,
        "recent_expenses": [{"date": e.get("expense_date", ""), "description": e.get("description", ""),
                             "amount": num(e.get("amount", 0)), "payee": e.get("payee", "")} for e in recent],
        "version": store.version,
    }


def houses_view(full=False):
    zones, houses, dues, paid_by_due, owners = build_model()
    hm = {}
    dues_info = {}
    for dd in dues:
        hid = dd["house_id"]
        m = int(dd.get("month", 1))
        pr = int(dd.get("period", 1))
        paid = dd["due_id"] in paid_by_due
        hm.setdefault(hid, {})[m] = paid
        dues_info.setdefault(hid, {})[m] = {
            "due_id": dd["due_id"],
            "period": pr,
            "amount": num(dd["amount_due"]),
            "paid": paid,
            "payment": paid_by_due.get(dd["due_id"])
        }
    cm = current_month()
    out = []
    for hid, h in houses.items():
        months = [bool(hm.get(hid, {}).get(m)) for m in range(1, 13)]
        quarters = []
        house_slips = []
        for pr in range(4):
            q_months = [pr * 3 + i for i in (1, 2, 3)]
            is_full = all(months[m - 1] for m in q_months)
            paid_cnt = sum(1 for m in q_months if months[m - 1])

            # รวบรวมข้อมูลการชำระเงินและสลิปในงวดนี้
            q_payments = [dues_info.get(hid, {}).get(m, {}).get("payment") for m in q_months if dues_info.get(hid, {}).get(m, {}).get("payment")]
            q_slip_url = ""
            q_channel = ""
            q_paid_date = ""
            q_payment_id = ""
            q_transfer_time = ""
            for p in q_payments:
                if p.get("slip_url") and not q_slip_url:
                    q_slip_url = p.get("slip_url")
                if p.get("channel") and not q_channel:
                    q_channel = p.get("channel")
                if p.get("paid_date") and not q_paid_date:
                    q_paid_date = p.get("paid_date")
                if p.get("payment_id") and not q_payment_id:
                    q_payment_id = p.get("payment_id")
                if p.get("transfer_time") and not q_transfer_time:
                    q_transfer_time = p.get("transfer_time")

            has_slip = bool(q_slip_url) or any(p.get("has_slip") == "Y" for p in q_payments)
            if q_slip_url and q_slip_url not in [s["url"] for s in house_slips]:
                house_slips.append({
                    "period": pr + 1,
                    "url": q_slip_url,
                    "date": q_paid_date,
                    "channel": q_channel,
                    "payment_id": q_payment_id
                })

            quarters.append({
                "period": pr + 1,
                "is_full": is_full,
                "paid_count": paid_cnt,
                "has_slip": has_slip,
                "slip_url": q_slip_url,
                "channel": q_channel,
                "paid_date": q_paid_date,
                "payment_id": q_payment_id,
                "transfer_time": q_transfer_time
            })

        rate = 100 if zones.get(h["zone_id"], {}).get("name") == "สายหลัก" else 300
        paid_amount = sum(rate for m in range(12) if months[m])
        overdue_months = sum(1 for m in range(cm) if not months[m])
        overdue_amount = overdue_months * rate

        names = owners.get(hid, [])
        item = {
            "house_id": hid,
            "house_no": h["house_no"],
            "zone": zones.get(h["zone_id"], {}).get("name", ""),
            "name": " / ".join(names) if full else " / ".join(mask_name(n) for n in names),
            "owner": " / ".join(names) if full else " / ".join(mask_name(n) for n in names),
            "owner_full": " / ".join(names),
            "rate": rate,
            "months": months,
            "quarters": quarters,
            "slips": house_slips,
            "paid_count": sum(months),
            "paid_amount": paid_amount,
            "overdue_count": overdue_months,
            "overdue_amount": overdue_amount,
        }
        out.append(item)
    out.sort(key=lambda x: (x["zone"] == "สายหลัก", int(x["zone"].split()[1]) if x["zone"] != "สายหลัก" else 0, x["house_no"]))
    return out
