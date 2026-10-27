/**
 * =========================================================================================
 * GOOGLE APPS SCRIPT: ระบบฐานข้อมูลกองทุนพัฒนาหมู่บ้าน ปี 2569 (Clean Relational Schema)
 * รองรับการอ่านและเขียนข้อมูลแบบ Real-time กับ Render.com ฟรี 100%
 * =========================================================================================
 * 
 * โครงสร้างฐานข้อมูล 4 ตารางหลัก:
 * 1. tb_members        : ทะเบียนสมาชิก 162 หลังคาเรือน
 * 2. tb_payments       : ประวัติธุรกรรมรับชำระเงิน (Transaction Ledger)
 * 3. tb_expenses       : รายการเบิกจ่ายค่าใช้จ่ายทั้งหมด
 * 4. tb_summary_config : ค่ายอดยกมา ดอกเบี้ย และเงินกองทุน
 * =========================================================================================
 */

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. อ่านข้อมูลสมาชิก (tb_members)
  var memberSheet = ss.getSheetByName("tb_members");
  var members = [];
  if (memberSheet && memberSheet.getLastRow() >= 2) {
    var mData = memberSheet.getRange(2, 1, memberSheet.getLastRow() - 1, 7).getValues();
    for (var i = 0; i < mData.length; i++) {
      var r = mData[i];
      if (!r[2] && !r[3]) continue;
      members.push({
        member_id: r[0],
        alley: String(r[1] || ""),
        house_no: String(r[2] || "").trim(),
        owner_name: String(r[3] || "").trim(),
        monthly_rate: Number(r[4]) || 300,
        annual_target: Number(r[5]) || 3600,
        remark: String(r[6] || "")
      });
    }
  }

  // 2. อ่านประวัติการชำระเงิน (tb_payments)
  var paySheet = ss.getSheetByName("tb_payments");
  var payments = [];
  if (paySheet && paySheet.getLastRow() >= 2) {
    var pData = paySheet.getRange(2, 1, paySheet.getLastRow() - 1, 10).getValues();
    for (var j = 0; j < pData.length; j++) {
      var pr = pData[j];
      if (!pr[0] && !pr[2]) continue;
      payments.push({
        payment_id: String(pr[0] || ""),
        payment_date: String(pr[1] || ""),
        house_no: String(pr[2] || "").trim(),
        payer_name: String(pr[3] || "").trim(),
        quarters_paid: String(pr[4] || ""),
        months_paid: String(pr[5] || "[]"),
        amount: Number(pr[6]) || 0,
        channel: String(pr[7] || "ธนาคาร"),
        recorded_by: String(pr[8] || "เจ้าหน้าที่"),
        remark: String(pr[9] || "")
      });
    }
  }

  // 3. อ่านรายละเอียดค่าใช้จ่าย (tb_expenses)
  var expSheet = ss.getSheetByName("tb_expenses");
  var expenses = [];
  if (expSheet && expSheet.getLastRow() >= 2) {
    var eData = expSheet.getRange(2, 1, expSheet.getLastRow() - 1, 8).getValues();
    for (var k = 0; k < eData.length; k++) {
      var er = eData[k];
      if (!er[0] && !er[3]) continue;
      expenses.push({
        doc_no: String(er[0] || ""),
        expense_date: String(er[1] || ""),
        category: String(er[2] || "ทั่วไป"),
        title: String(er[3] || ""),
        amount: Number(er[4]) || 0,
        payee: String(er[5] || ""),
        paid_from: String(er[6] || "บัญชีธนาคาร"),
        status: String(er[7] || "จ่ายแล้ว")
      });
    }
  }

  // 4. อ่านการตั้งค่ากองทุน (tb_summary_config)
  var cfgSheet = ss.getSheetByName("tb_summary_config");
  var config = {};
  if (cfgSheet && cfgSheet.getLastRow() >= 2) {
    var cData = cfgSheet.getRange(2, 1, cfgSheet.getLastRow() - 1, 3).getValues();
    for (var c = 0; c < cData.length; c++) {
      config[String(cData[c][0])] = Number(cData[c][1]) || 0;
    }
  }

  var output = {
    status: "success",
    system: "Village Fund 2569 Normalized API",
    updated_at: new Date().toISOString(),
    total_members: members.length,
    total_payments: payments.length,
    total_expenses: expenses.length,
    members: members,
    payments: payments,
    expenses: expenses,
    config: config
  };

  return ContentService.createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else {
      return responseJson({ status: "error", message: "No data payload" });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var action = payload.action;
    var data = payload.data || {};

    // ----------------------------------------------------
    // ACTION 1: บันทึกรับเงิน (PAYMENT)
    // ----------------------------------------------------
    if (action === "PAYMENT") {
      var payHeaders = ["เลขที่ใบเสร็จ", "วันที่ชำระเงิน", "บ้านเลขที่", "ชื่อผู้ชำระ", "งวดที่ชำระ", "เดือนที่ชำระ (JSON)", "จำนวนเงิน (บาท)", "ช่องทาง", "ผู้บันทึก", "หมายเหตุ"];
      var paySheet = getOrCreateSheet(ss, "tb_payments", payHeaders, "#047857");

      paySheet.appendRow([
        data.payment_id || ("REC-69-" + new Date().getTime()),
        data.payment_date || new Date().toLocaleDateString("th-TH"),
        String(data.house_no || "").trim(),
        String(data.payer_name || "").trim(),
        data.quarters_paid || "-",
        JSON.stringify(data.months_paid || []),
        data.amount || 0,
        data.channel || "ธนาคาร",
        data.recorded_by || "เจ้าหน้าที่",
        data.remark || ""
      ]);

      return responseJson({ status: "success", action: "PAYMENT", payment_id: data.payment_id });
    }

    // ----------------------------------------------------
    // ACTION 2: บันทึกรายจ่าย (EXPENSE)
    // ----------------------------------------------------
    else if (action === "EXPENSE") {
      var expHeaders = ["เลขที่เอกสาร", "วันที่จ่าย", "หมวดหมู่ค่าใช้จ่าย", "รายการค่าใช้จ่าย", "จำนวนเงิน (บาท)", "ผู้รับเงิน / ผู้เบิก", "จ่ายจาก", "สถานะ"];
      var expSheet = getOrCreateSheet(ss, "tb_expenses", expHeaders, "#B91C1C");

      expSheet.appendRow([
        data.doc_no || ("EXP-" + new Date().getTime()),
        data.expense_date || new Date().toLocaleDateString("th-TH"),
        data.category || "ทั่วไป",
        data.title || "-",
        data.amount || 0,
        data.payee || "-",
        data.paid_from || "บัญชีธนาคาร",
        data.status || "จ่ายแล้ว"
      ]);

      return responseJson({ status: "success", action: "EXPENSE", doc_no: data.doc_no });
    }

    // ----------------------------------------------------
    // ACTION 3: นำเข้าข้อมูลทั้งหมด (SYNC_ALL)
    // ----------------------------------------------------
    else if (action === "SYNC_ALL") {
      syncAllToSheets(ss, data);
      return responseJson({ status: "success", action: "SYNC_ALL", message: "สร้างและซิงก์ตารางข้อมูลทั้งหมดเรียบร้อย" });
    }

    return responseJson({ status: "error", message: "Unknown action" });

  } catch (err) {
    return responseJson({ status: "error", message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function responseJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet(ss, sheetName, headers, headerColor) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headers && headers.length > 0) {
      sheet.appendRow(headers);
      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setFontWeight("bold").setFontColor("#FFFFFF").setBackground(headerColor || "#1E3A8A");
    }
  }
  return sheet;
}

function syncAllToSheets(ss, data) {
  // 1. tb_members
  if (data.members && data.members.length > 0) {
    var mHeaders = ["รหัสสมาชิก (ID)", "ซอย", "บ้านเลขที่", "ชื่อ-สกุล สมาชิก", "อัตราต่อเดือน (บาท)", "เป้าหมายทั้งปี (บาท)", "หมายเหตุ"];
    var mSheet = getOrCreateSheet(ss, "tb_members", mHeaders, "#1E3A8A");
    mSheet.clearContents();
    mSheet.appendRow(mHeaders);
    var mRows = [];
    for (var i = 0; i < data.members.length; i++) {
      var m = data.members[i];
      mRows.push([
        m.member_id || (i + 1),
        m.alley || "-",
        m.house_no || "-",
        m.owner_name || "-",
        m.monthly_rate || 300,
        m.annual_target || (m.monthly_rate * 12),
        m.remark || ""
      ]);
    }
    if (mRows.length > 0) {
      mSheet.getRange(2, 1, mRows.length, mRows[0].length).setValues(mRows);
      mSheet.getRange(1, 1, 1, mHeaders.length).setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#1E3A8A");
    }
  }

  // 2. tb_payments
  if (data.payments && data.payments.length > 0) {
    var pHeaders = ["เลขที่ใบเสร็จ", "วันที่ชำระเงิน", "บ้านเลขที่", "ชื่อผู้ชำระ", "งวดที่ชำระ", "เดือนที่ชำระ (JSON)", "จำนวนเงิน (บาท)", "ช่องทาง", "ผู้บันทึก", "หมายเหตุ"];
    var pSheet = getOrCreateSheet(ss, "tb_payments", pHeaders, "#047857");
    pSheet.clearContents();
    pSheet.appendRow(pHeaders);
    var pRows = [];
    for (var j = 0; j < data.payments.length; j++) {
      var p = data.payments[j];
      pRows.push([
        p.payment_id || "-",
        p.payment_date || "-",
        p.house_no || "-",
        p.payer_name || "-",
        p.quarters_paid || "-",
        typeof p.months_paid === "string" ? p.months_paid : JSON.stringify(p.months_paid || []),
        p.amount || 0,
        p.channel || "ธนาคาร",
        p.recorded_by || "เจ้าหน้าที่",
        p.remark || ""
      ]);
    }
    if (pRows.length > 0) {
      pSheet.getRange(2, 1, pRows.length, pRows[0].length).setValues(pRows);
      pSheet.getRange(1, 1, 1, pHeaders.length).setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#047857");
    }
  }

  // 3. tb_expenses
  if (data.expenses && data.expenses.length > 0) {
    var eHeaders = ["เลขที่เอกสาร", "วันที่จ่าย", "หมวดหมู่ค่าใช้จ่าย", "รายการค่าใช้จ่าย", "จำนวนเงิน (บาท)", "ผู้รับเงิน / ผู้เบิก", "จ่ายจาก", "สถานะ"];
    var eSheet = getOrCreateSheet(ss, "tb_expenses", eHeaders, "#B91C1C");
    eSheet.clearContents();
    eSheet.appendRow(eHeaders);
    var eRows = [];
    for (var k = 0; k < data.expenses.length; k++) {
      var e = data.expenses[k];
      eRows.push([
        e.doc_no || "-",
        e.expense_date || "-",
        e.category || "-",
        e.title || "-",
        e.amount || 0,
        e.payee || "-",
        e.paid_from || "บัญชีธนาคาร",
        e.status || "จ่ายแล้ว"
      ]);
    }
    if (eRows.length > 0) {
      eSheet.getRange(2, 1, eRows.length, eRows[0].length).setValues(eRows);
      eSheet.getRange(1, 1, 1, eHeaders.length).setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#B91C1C");
    }
  }

  // 4. tb_summary_config
  var cHeaders = ["รหัสค่าตัวแปร", "จำนวนเงิน (บาท)", "คำอธิบาย"];
  var cSheet = getOrCreateSheet(ss, "tb_summary_config", cHeaders, "#475569");
  cSheet.clearContents();
  cSheet.appendRow(cHeaders);
  var cRows = [
    ["initial_balance_2568", 82969.73, "ยอดเงินคงเหลือปี 2568 (ณ 24 ม.ค. 69) ยกมา"],
    ["initial_reserve_cash", 10049.57, "ยอดเงินสดสำรอง ยกมาจากปี 2568"],
    ["support_income", 168.39, "เงินสนับสนุน / ดอกเบี้ยรับปี 2569"],
    ["current_cash_reserve", 13764.47, "เงินสำรองคงเหลือ (เงินสด) ปัจจุบัน"],
    ["current_bank_balance", 54353.55, "เงินคงเหลือในสมุดบัญชีธนาคาร ปัจจุบัน"],
    ["total_ending_balance", 68118.02, "รวมเงินคงเหลือทั้งหมด (เงินสด + ธนาคาร)"]
  ];
  cSheet.getRange(2, 1, cRows.length, cRows[0].length).setValues(cRows);
  cSheet.getRange(1, 1, 1, cHeaders.length).setFontWeight("bold").setFontColor("#FFFFFF").setBackground("#475569");
}
