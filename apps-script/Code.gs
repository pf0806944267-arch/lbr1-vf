/**
 * Apps Script API ของระบบกองทุนหมู่บ้าน (ผูกกับ Google Sheet)
 * ขั้นตอนติดตั้ง: เปิดชีต > ส่วนขยาย > Apps Script > วางโค้ดนี้
 *  1) Project Settings > Script properties: เพิ่ม API_KEY = (รหัสลับยาวๆ ที่ตั้งเอง)
 *  2) Deploy > New deployment > Web app > Execute as: Me, Who has access: Anyone
 *  3) คัดลอก Web App URL ให้ผม และใส่ API_KEY เดียวกันใน Render (env)
 * Node.js บน Render เป็นตัวเดียวที่เรียก API นี้ (ผู้ใช้ทั่วไปไม่เรียกตรง)
 */

/**
 * ฟังก์ชันสำหรับกด "เรียกใช้ (Run)" 1 ครั้งในหน้า Apps Script Editor
 * เพื่อให้ Google แสดงหน้าต่างขออนุญาต (Authorize) สิทธิ์เข้าถึง Google Drive
 */
function testDriveAuth() {
  var folderId = '12jT6GUua6hwJvl_xe1IJ64J-dSxGwzD3';
  var folder = DriveApp.getFolderById(folderId);
  Logger.log('เชื่อมต่อ Google Drive สำเร็จ! ชื่อโฟลเดอร์: ' + folder.getName());
}

var TABLES = ['fiscal_years', 'zones', 'fee_rates', 'houses', 'members', 'house_members',
  'dues', 'payments', 'bank_ref', 'expense_categories', 'expenses',
  'reserve_transactions', 'other_income', 'users', 'audit_log', 'site_stats'];

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function checkKey_(k) {
  var key = PropertiesService.getScriptProperties().getProperty('API_KEY');
  return key && k === key;
}

function sheet_(name) {
  if (TABLES.indexOf(name) < 0) throw new Error('unknown table');
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function readTable_(name) {
  var values = sheet_(name).getDataRange().getValues();
  if (values.length === 0) return [];
  var head = values[0];
  return values.slice(1).map(function (r) {
    var o = {};
    head.forEach(function (h, i) { o[h] = r[i] instanceof Date ? Utilities.formatDate(r[i], 'Asia/Bangkok', 'yyyy-MM-dd') : r[i]; });
    return o;
  });
}

// GET ?key=...&table=houses  -> อ่านทั้งตาราง ; ?key=...&tables=a,b,c -> อ่านหลายตารางในครั้งเดียว
function doGet(e) {
  try {
    if (!checkKey_(e.parameter.key)) return json_({ok: false, error: 'unauthorized'});
    if (e.parameter.tables) {
      var data = {};
      e.parameter.tables.split(',').forEach(function (t) { data[t] = readTable_(t); });
      return json_({ok: true, data: data});
    }
    return json_({ok: true, rows: readTable_(e.parameter.table)});
  } catch (err) { return json_({ok: false, error: String(err)}); }
}

/**
 * POST body (JSON): {key, action, table, ...}
 *  action=replace : {header:[...], rows:[[...]]}   ใช้ตอน import ครั้งแรก (เขียนทับทั้งตาราง)
 *  action=append  : {row:{col:value}}
 *  action=update  : {idCol, id, patch:{col:value}}
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var b = JSON.parse(e.postData.contents);
    if (!checkKey_(b.key)) return json_({ok: false, error: 'unauthorized'});

    // อัปโหลดไฟล์สลิปเข้า Google Drive โฟลเดอร์ที่กำหนด
    if (b.action === 'upload_slip') {
      var folderId = b.folder_id || '12jT6GUua6hwJvl_xe1IJ64J-dSxGwzD3';
      var folder = DriveApp.getFolderById(folderId);
      var rawData = String(b.data || '');
      if (rawData.indexOf('base64,') > -1) {
        rawData = rawData.split('base64,')[1];
      }
      var decoded = Utilities.base64Decode(rawData);
      var blob = Utilities.newBlob(decoded, b.mimeType || 'image/jpeg', b.filename || ('slip_' + new Date().getTime() + '.jpg'));
      var file = folder.createFile(blob);
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (e) {}
      var fileId = file.getId();
      return json_({
        ok: true,
        file_id: fileId,
        url: file.getUrl(),
        direct_url: 'https://lh3.googleusercontent.com/d/' + fileId
      });
    }

    var sh = sheet_(b.table);
    if (b.action === 'incr') {
      // บวกยอดสถิติรายวันแบบ atomic (อยู่ใน script lock) — ใช้กับตาราง site_stats (date, views, visitors)
      if (sh.getLastColumn() === 0) sh.getRange(1, 1, 1, 3).setNumberFormat('@').setValues([['date', 'views', 'visitors']]);
      var iv = sh.getDataRange().getValues();
      for (var k = 1; k < iv.length; k++) {
        var cell = iv[k][0] instanceof Date ? Utilities.formatDate(iv[k][0], 'Asia/Bangkok', 'yyyy-MM-dd') : String(iv[k][0]);
        if (cell === String(b.date)) {
          sh.getRange(k + 1, 2, 1, 2).setNumberFormat('@').setValues([[String((Number(iv[k][1]) || 0) + Number(b.views || 0)), String((Number(iv[k][2]) || 0) + Number(b.visitors || 0))]]);
          return json_({ok: true});
        }
      }
      sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setNumberFormat('@').setValues([[String(b.date), String(Number(b.views || 0)), String(Number(b.visitors || 0))]]);
      return json_({ok: true});
    }
    if (b.action === 'replace') {
      sh.clear();
      var data = [b.header].concat(b.rows);
      sh.getRange(1, 1, data.length, b.header.length).setNumberFormat('@').setValues(data);
      return json_({ok: true, rows: b.rows.length});
    }
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    if (b.action === 'append') {
      // ถ้า row มี field ใหม่ที่ชีตยังไม่มีคอลัมน์ ให้เพิ่มหัวคอลัมน์ต่อท้ายอัตโนมัติ (เช่น channel)
      Object.keys(b.row).forEach(function (k) {
        if (head.indexOf(k) < 0) { head.push(k); sh.getRange(1, head.length).setNumberFormat('@').setValue(k); }
      });
      // เขียนเป็นข้อความเสมอ (กัน 3/69 หรือ 448/12 ถูกแปลงเป็นวันที่)
      var rowVals = head.map(function (h) { return b.row[h] === undefined ? '' : String(b.row[h]); });
      sh.getRange(sh.getLastRow() + 1, 1, 1, head.length).setNumberFormat('@').setValues([rowVals]);
      return json_({ok: true});
    }
    if (b.action === 'delete') {
      var di = head.indexOf(b.idCol);
      var dv = sh.getDataRange().getValues();
      for (var j = 1; j < dv.length; j++) {
        if (String(dv[j][di]) === String(b.id)) { sh.deleteRow(j + 1); return json_({ok: true}); }
      }
      return json_({ok: false, error: 'not found'});
    }
    if (b.action === 'update') {
      var idx = head.indexOf(b.idCol);
      var vals = sh.getDataRange().getValues();
      for (var i = 1; i < vals.length; i++) {
        if (String(vals[i][idx]) === String(b.id)) {
          Object.keys(b.patch).forEach(function (k) {
            var c = head.indexOf(k);
            if (c >= 0) sh.getRange(i + 1, c + 1).setNumberFormat('@').setValue(String(b.patch[k]));
          });
          return json_({ok: true});
        }
      }
      return json_({ok: false, error: 'not found'});
    }
    return json_({ok: false, error: 'unknown action'});
  } catch (err) {
    return json_({ok: false, error: String(err)});
  } finally { lock.releaseLock(); }
}
