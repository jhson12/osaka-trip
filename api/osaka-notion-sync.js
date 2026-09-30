// Vercel 서버리스 함수: 오사카 여행 경비를 Notion 데이터베이스로 동기화
//
// 필요한 환경변수:
//   NOTION_API_KEY              - Notion 내부 통합(Integration) 시크릿 (ntn_... 또는 secret_...)
//   OSAKA_NOTION_DATABASE_ID    - (선택) 대상 DB ID. 없으면 아래 기본값(🍁 오사카 여행 경비 DB) 사용
//
// 동작 방식: 대상 DB의 기존 행을 모두 보관(archive) 처리한 뒤, 웹앱의 현재 경비 목록으로 새로 채웁니다.
//            (노션은 웹앱의 '거울' 역할이므로, 노션에서 직접 수정한 내용은 다음 동기화 때 덮어써집니다.)

const NOTION_VERSION = '2022-06-28';
const DEFAULT_DATABASE_ID = 'be71b00d7fbf4560a95b4a9882c4298b';
const TRIP_START = '2026-10-03';
const CONCURRENCY = 3;

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function notionFetch(url, options, attempt) {
  const tries = attempt || 0;
  const resp = await fetch(url, options);
  if ((resp.status === 429 || resp.status >= 500) && tries < 4) {
    const retryAfter = parseFloat(resp.headers.get('retry-after')) || 1;
    await sleep(Math.max(retryAfter, 0.5) * 1000);
    return notionFetch(url, options, tries + 1);
  }
  return resp;
}

// items를 CONCURRENCY개씩 병렬로 처리
async function runPool(items, worker) {
  let index = 0;
  const results = [];
  async function next() {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current], current);
    }
  }
  const runners = [];
  for (let i = 0; i < Math.min(CONCURRENCY, items.length); i++) runners.push(next());
  await Promise.all(runners);
  return results;
}

export default async function handler(req, res) {
  const NOTION_API_KEY = process.env.NOTION_API_KEY;
  const DATABASE_ID = process.env.OSAKA_NOTION_DATABASE_ID || DEFAULT_DATABASE_ID;

  if (!NOTION_API_KEY) {
    return res.status(500).json({ success: false, error: 'NOTION_API_KEY 환경변수가 설정되지 않았어요.' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const headers = {
    'Authorization': 'Bearer ' + NOTION_API_KEY,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json'
  };

  try {
    const body = req.body || {};
    const expenses = body.expenses;
    const rate = body.rate;

    if (!Array.isArray(expenses)) {
      return res.status(400).json({ success: false, error: 'expenses 배열이 필요해요.' });
    }
    // 안전장치: 앱에서 데이터를 못 불러와 빈 목록이 넘어왔을 때 노션 데이터를 통째로 지우지 않도록 막음
    if (expenses.length === 0) {
      return res.status(200).json({ success: true, synced: 0, total: 0, skipped: true, note: '등록된 경비가 없어서 동기화를 건너뛰었어요.' });
    }

    const sortedExpenses = expenses.slice().sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date));
    });

    // 1. 기존 페이지 전부 조회
    let allPages = [];
    let cursor = undefined;
    do {
      const q = await notionFetch('https://api.notion.com/v1/databases/' + DATABASE_ID + '/query', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(cursor ? { start_cursor: cursor } : {})
      });
      const qd = await q.json();
      if (!q.ok) {
        return res.status(500).json({
          success: false,
          error: '노션 DB 조회 실패 (' + q.status + '). DB에 통합(Connection)이 연결돼 있는지 확인해 주세요.',
          detail: qd
        });
      }
      allPages = allPages.concat(qd.results || []);
      cursor = qd.has_more ? qd.next_cursor : undefined;
    } while (cursor);

    // 2. 기존 페이지 보관 처리
    await runPool(allPages, function (page) {
      return notionFetch('https://api.notion.com/v1/pages/' + page.id, {
        method: 'PATCH',
        headers: headers,
        body: JSON.stringify({ archived: true })
      });
    });

    // 3. 새 데이터로 페이지 생성
    const results = await runPool(sortedExpenses, async function (e) {
      const krw = e.currency === 'KRW'
        ? e.amount
        : Math.round(e.amount / 100 * (e.rateAtEntry || rate || 890));

      const properties = {
        '항목명': { title: [{ text: { content: e.desc || '(제목 없음)' } }] },
        '날짜': { date: { start: e.date } },
        '금액(원화)': { number: krw },
        '원본금액': { number: e.amount },
        '통화': { select: { name: e.currency === 'JPY' ? 'JPY' : 'KRW' } },
        '카테고리': { select: { name: e.category || '기타' } },
        '결제수단': { select: { name: e.payMethod === 'cash' ? '현금' : '카드' } },
        '구분': { select: { name: e.date < TRIP_START ? '사전결제' : '현지사용' } }
      };

      const createResp = await notionFetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ parent: { database_id: DATABASE_ID }, properties: properties })
      });
      return createResp.ok;
    });

    const created = results.filter(Boolean).length;
    return res.status(200).json({ success: created === sortedExpenses.length, synced: created, total: sortedExpenses.length });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
