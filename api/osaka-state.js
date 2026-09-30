// Vercel 서버리스 함수: 오사카 여행 전용 Google Apps Script 프록시
// 환경변수 OSAKA_APPS_SCRIPT_URL 에 Apps Script 웹앱 URL을 넣어주세요

export default async function handler(req, res) {
  const APPS_SCRIPT_URL = process.env.OSAKA_APPS_SCRIPT_URL;

  if (!APPS_SCRIPT_URL) {
    return res.status(500).json({ success: false, error: 'OSAKA_APPS_SCRIPT_URL not configured' });
  }

  try {
    if (req.method === 'GET') {
      const key = req.query.key || '';
      const url = `${APPS_SCRIPT_URL}?key=${encodeURIComponent(key)}`;
      const response = await fetch(url);
      const data = await response.json();
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      });
      const data = await response.json();
      return res.status(200).json(data);
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
