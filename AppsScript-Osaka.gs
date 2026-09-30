/**
 * 오사카 가족여행 - 일정표 + 경비 정산 공용 Apps Script
 * (푸꾸옥 여행과는 완전히 별도의 새 Google Sheet에 연결하세요)
 *
 * 사용법:
 * 1. 새 Google Sheet 만들기 (예: "오사카_여행_상태저장")
 * 2. 시트 이름을 "state" 로 변경 (기본 "시트1"을 더블클릭해서 이름 변경)
 * 3. 확장 프로그램 > Apps Script 클릭
 * 4. 기본 코드 지우고 이 파일 내용 전체 붙여넣기
 * 5. 저장 (Ctrl+S)
 * 6. 배포 > 새 배포 > 유형: 웹앱
 *    - 실행 사용자: 나(본인)
 *    - 액세스 권한: 모든 사용자
 * 7. 배포 후 나오는 웹앱 URL을 Vercel 환경변수 OSAKA_APPS_SCRIPT_URL 에 등록
 */

const SHEET_NAME = 'state';

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['key', 'value', 'updatedAt']);
  }
  return sheet;
}

function findRow(sheet, key) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) return i + 1;
  }
  return -1;
}

function serialize(value) {
  return JSON.stringify(value);
}

function deserialize(raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return raw;
  }
}

function doGet(e) {
  const sheet = getSheet();
  const key = e.parameter.key;

  if (!key) {
    const data = sheet.getDataRange().getValues();
    const result = {};
    for (let i = 1; i < data.length; i++) {
      result[data[i][0]] = {
        value: deserialize(data[i][1]),
        updatedAt: data[i][2]
      };
    }
    return ContentService.createTextOutput(JSON.stringify({ success: true, data: result }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const row = findRow(sheet, key);
  if (row === -1) {
    return ContentService.createTextOutput(JSON.stringify({ success: true, value: null }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const rowData = sheet.getRange(row, 1, 1, 3).getValues()[0];
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    key: rowData[0],
    value: deserialize(rowData[1]),
    updatedAt: rowData[2]
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const sheet = getSheet();
  const body = JSON.parse(e.postData.contents);
  const key = body.key;
  const value = body.value;

  if (!key) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'key required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const now = new Date().toISOString();
  const serialized = serialize(value);
  const row = findRow(sheet, key);
  if (row === -1) {
    sheet.appendRow([key, serialized, now]);
  } else {
    sheet.getRange(row, 2, 1, 2).setValues([[serialized, now]]);
  }

  return ContentService.createTextOutput(JSON.stringify({ success: true, key: key, value: value, updatedAt: now }))
    .setMimeType(ContentService.MimeType.JSON);
}
