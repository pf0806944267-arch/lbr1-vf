/**
 * =========================================================================================
 * GOOGLE APPS SCRIPT: Village Fund 2569 Cloud Data Sync Webhook
 * ระบบเชื่อมต่อและซิงก์ข้อมูลกองทุนหมู่บ้าน 2569 แบบ Real-time ลง Google Sheets ฟรี 100%
 * =========================================================================================
 * 
 * วิธีการติดตั้ง (ครั้งแรกเพียง 2 นาที):
 * 1. เปิด Google Sheets ที่ต้องการใช้ (หรือ Import ไฟล์ village_fund_2569.xlsx ขึ้น Google Drive)
 * 2. ไปที่เมนู: ส่วนขยาย (Extensions) > Apps Script
 * 3. ลบโค้ดเดิมทั้งหมดออก แล้ววางโค้ดชุดนี้ลงไปทั้งหมด
 * 4. กดปุ่มบันทึก (รูปแผ่นดิสก์ Save)
 * 5. กดปุ่มสีน้ำเงินมุมขวาบน "ทำให้ใช้งานได้" (Deploy) > "การทำให้ใช้งานได้ใหม่" (New deployment)
 * 6. เลือกประเภท (Gear icon): "เว็บแอป" (Web app)
 *    - คำอธิบาย (Description): Village Fund Webhook
 *    - ดำเนินการในฐานะ (Execute as): ตัวฉัน (Me)
 *    - ผู้มีสิทธิ์เข้าถึง (Who has access): ทุกคน (Anyone)  <--- สำคัญมาก ต้องเลือก ทุกคน (Anyone)
 * 7. กด "ทำให้ใช้งานได้" (Deploy) แล้วอนุญาตสิทธิ์ (Authorize access)
 * 8. คัดลอก "URL ของเว็บแอป" (Web app URL) ที่ลงท้ายด้วย /exec
 * 9. นำ URL ไปใส่ในตัวแปรสภาพแวดล้อม (Environment Variable) บน Render.com:
 *    ชื่อตัวแปร: GOOGLE_SHEET_WEBHOOK_URL
 *    ค่า: URL ที่คัดลอกมา
 * =========================================================================================
 */

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. อ่านข้อมูลชีท ทะเบียนสมาชิกและการชำระ
  var memberSheet = ss.getSheetByName("ทะเบียนสมาชิกและการชำระ");
  var members = [];
  if (memberSheet && memberSheet.getLastRow() >= 2) {
    var mData = memberSheet.getRange(2, 1, memberSheet.getLastRow() - 1, 24).getValues();
    for (var i = 0; i < mData.length; i++) {
      var r = mData[i];
      if (!r[2] && !r[3]) continue; // ข้ามแถวว่าง
      members.push({
        id: r[0] || (i + 1),
        alley: String(r[1] || ""),
        house_no: String(r[2] || ""),
        name: String(r[3] || ""),
        fee_monthly: Number(r[4]) || 50,
        m1: Number(r[5]) || 0,
        m2: Number(r[6]) || 0,
        m3: Number(r[7]) || 0,
        q1_total: Number(r[8]) || 0,
        m4: Number(r[9]) || 0,
        m5: Number(r[10]) || 0,
        m6: Number(r[11]) || 0,
        q2_total: Number(r[12]) || 0,
        m7: Number(r[13]) || 0,
        m8: Number(r[14]) || 0,
        m9: Number(r[15]) || 0,
        q3_total: Number(r[16]) || 0,
        m10: Number(r[17]) || 0,
        m11: Number(r[18]) || 0,
        m12: Number(r[19]) || 0,
        q4_total: Number(r[20]) || 0,
        year_total: Number(r[21]) || 0,
        due_amount: Number(r[22]) || 0,
        status: String(r[23] || "ยังไม่ชำระ")
      });
    }
  }

  // 2. อ่านข้อมูลชีท รายละเอียดค่าใช้จ่าย
  var expSheet = ss.getSheetByName("รายละเอียดค่าใช้จ่าย");
  var expenses = [];
  if (expSheet && expSheet.getLastRow() >= 2) {
    var eData = expSheet.getRange(2, 1, expSheet.getLastRow() - 1, 7).getValues();
    for (var j = 0; j < eData.length; j++) {
      var er = eData[j];
      if (!er[3]) continue;
      expenses.push({
        doc_no: String(er[0] || ""),
        date: String(er[1] || ""),
        category: String(er[2] || "ค่าใช้จ่ายทั่วไป"),
        title: String(er[3] || ""),
        amount: Number(er[4]) || 0,
        payee: String(er[5] || ""),
        status: String(er[6] || "จ่ายแล้ว")
      });
    }
  }

  var output = {
    status: "success",
    system: "Village Fund 2569 Google Sheets Live Database",
    updated_at: new Date().toISOString(),
    total_members: members.length,
    total_expenses: expenses.length,
    members: members,
    expenses: expenses
  };

  return ContentService.createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // ล็อก script สูงสุด 10 วินาทีเพื่อป้องกันการเขียนชนกันพร้อมกัน
    lock.waitLock(10000);
    
    var payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else {
      return responseJson({ status: "error", message: "No data payload received" });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var action = payload.action;
    var data = payload.data || {};

    // ----------------------------------------------------
    // ACTION 1: บันทึกการรับชำระเงิน (PAYMENT)
    // ----------------------------------------------------
    if (action === "PAYMENT") {
      var memberSheet = getOrCreateSheet(ss, "ทะเบียนสมาชิกและการชำระ", getMemberHeaders());
      var logSheet = getOrCreateSheet(ss, "ประวัติการชำระเงิน_Log", [
        "วันเวลาบันทึก", "เลขที่ใบเสร็จ", "รหัสสมาชิก", "ชื่อ-นามสกุล", "บ้านเลขที่", 
        "ซอย", "จำนวนเงิน (บาท)", "งวดเดือนที่จ่าย", "ช่องทาง", "สถานะใหม่", "ยอดคงค้าง", "ผู้บันทึก"
      ]);

      // 1. เพิ่มประวัติใน Log Sheet
      logSheet.appendRow([
        new Date().toLocaleString("th-TH"),
        data.receipt_no || "-",
        data.member_id || "-",
        data.member_name || "-",
        data.house_no || "-",
        data.alley || "-",
        data.amount || 0,
        JSON.stringify(data.months || []),
        data.channel === "bank" ? "โอนเงินเข้าธนาคาร" : "เงินสด",
        data.new_status || "-",
        data.remaining_due || 0,
        data.actor || "เจ้าหน้าที่"
      ]);

      // 2. อัปเดตในชีทสมาชิกหลัก (ถ้ามีแถวของสมาชิกอยู่)
      updateMemberRow(memberSheet, data);

      return responseJson({ status: "success", action: "PAYMENT", receipt_no: data.receipt_no });
    }

    // ----------------------------------------------------
    // ACTION 2: บันทึกรายจ่าย (EXPENSE)
    // ----------------------------------------------------
    else if (action === "EXPENSE") {
      var expenseSheet = getOrCreateSheet(ss, "รายละเอียดค่าใช้จ่าย", [
        "เลขที่เอกสาร", "วันที่", "หมวดหมู่", "รายการค่าใช้จ่าย", "จำนวนเงิน (บาท)", "ผู้รับเงิน", "สถานะ", "ผู้บันทึก"
      ]);

      expenseSheet.appendRow([
        data.doc_no || "-",
        data.date || new Date().toLocaleDateString("th-TH"),
        data.category || "ค่าใช้จ่ายทั่วไป",
        data.title || "-",
        data.amount || 0,
        data.payee || "-",
        data.status || "จ่ายแล้ว",
        data.actor || "เจ้าหน้าที่"
      ]);

      return responseJson({ status: "success", action: "EXPENSE", doc_no: data.doc_no });
    }

    // ----------------------------------------------------
    // ACTION 3: ซิงก์ข้อมูลทั้งหมด (SYNC_ALL)
    // ----------------------------------------------------
    else if (action === "SYNC_ALL") {
      if (data.members && data.members.length > 0) {
        syncAllMembers(ss, data.members);
      }
      if (data.expenses && data.expenses.length > 0) {
        syncAllExpenses(ss, data.expenses);
      }
      return responseJson({ status: "success", action: "SYNC_ALL", message: "ซิงก์ข้อมูลทั้งหมดเรียบร้อย" });
    }

    return responseJson({ status: "error", message: "Unknown action: " + action });

  } catch (err) {
    return responseJson({ status: "error", message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

// ----------------------------------------------------
// HELPER FUNCTIONS
// ----------------------------------------------------

function responseJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headers && headers.length > 0) {
      sheet.appendRow(headers);
      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setFontWeight("bold");
      headerRange.setBackground("#E8F0FE");
    }
  }
  return sheet;
}

function getMemberHeaders() {
  return [
    "ลำดับ", "ซอย", "บ้านเลขที่", "ชื่อ-นามสกุล", "อัตรา/เดือน",
    "ม.ค.", "ก.พ.", "มี.ค.", "รวมงวด 1",
    "เม.ย.", "พ.ค.", "มิ.ย.", "รวมงวด 2",
    "ก.ค.", "ส.ค.", "ก.ย.", "รวมงวด 3",
    "ต.ค.", "พ.ย.", "ธ.ค.", "รวมงวด 4",
    "รวมชำระทั้งปี", "ยอดคงค้าง", "สถานะ", "อัปเดตล่าสุด"
  ];
}

function updateMemberRow(sheet, data) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var values = sheet.getRange(2, 1, lastRow - 1, 3).getValues(); // ค้นหาจาก ลำดับ หรือ บ้านเลขที่
  var targetRow = -1;

  for (var i = 0; i < values.length; i++) {
    var rowMemberId = values[i][0];
    var rowHouseNo = String(values[i][2]).trim();
    if (rowMemberId == data.member_id || rowHouseNo == String(data.house_no).trim()) {
      targetRow = i + 2; // +2 เพราะ offset header 1 แถว และ 0-indexed
      break;
    }
  }

  if (targetRow > 0) {
    // ถ้าเจอแถว ให้ปรับยอดรวมและสถานะ
    var p = data.payments || [];
    if (p.length === 12) {
      var rowData = [
        p[0], p[1], p[2], data.q1,
        p[3], p[4], p[5], data.q2,
        p[6], p[7], p[8], data.q3,
        p[9], p[10], p[11], data.q4,
        data.year_total, data.remaining_due, data.new_status, new Date().toLocaleString("th-TH")
      ];
      sheet.getRange(targetRow, 6, 1, rowData.length).setValues([rowData]);
    } else {
      // อัปเดตเฉพาะคอลัมน์สรุป
      sheet.getRange(targetRow, 22, 1, 4).setValues([[
        data.year_total, data.remaining_due, data.new_status, new Date().toLocaleString("th-TH")
      ]]);
    }
  }
}

function syncAllMembers(ss, members) {
  var sheet = getOrCreateSheet(ss, "ทะเบียนสมาชิกและการชำระ", getMemberHeaders());
  sheet.clearContents();
  sheet.appendRow(getMemberHeaders());

  var rows = [];
  for (var i = 0; i < members.length; i++) {
    var m = members[i];
    rows.push([
      m.id || (i + 1),
      m.alley || "-",
      m.house_no || "-",
      m.name || "-",
      m.fee_monthly || 50,
      m.m1 || 0, m.m2 || 0, m.m3 || 0, m.q1_total || 0,
      m.m4 || 0, m.m5 || 0, m.m6 || 0, m.q2_total || 0,
      m.m7 || 0, m.m8 || 0, m.m9 || 0, m.q3_total || 0,
      m.m10 || 0, m.m11 || 0, m.m12 || 0, m.q4_total || 0,
      m.year_total || 0,
      m.due_amount || 0,
      m.status || "ยังไม่ชำระ",
      new Date().toLocaleString("th-TH")
    ]);
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    sheet.getRange(1, 1, 1, getMemberHeaders().length).setFontWeight("bold").setBackground("#E8F0FE");
  }
}

function syncAllExpenses(ss, expenses) {
  var headers = ["เลขที่เอกสาร", "วันที่", "หมวดหมู่", "รายการค่าใช้จ่าย", "จำนวนเงิน (บาท)", "ผู้รับเงิน", "สถานะ"];
  var sheet = getOrCreateSheet(ss, "รายละเอียดค่าใช้จ่าย", headers);
  sheet.clearContents();
  sheet.appendRow(headers);

  var rows = [];
  for (var i = 0; i < expenses.length; i++) {
    var ex = expenses[i];
    rows.push([
      ex.doc_no || "-",
      ex.date || "-",
      ex.category || "-",
      ex.title || "-",
      ex.amount || 0,
      ex.payee || "-",
      ex.status || "จ่ายแล้ว"
    ]);
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#FEF3C7");
  }
}
