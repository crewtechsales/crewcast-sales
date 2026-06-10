import { createClient } from 'npm:@base44/sdk@0.8.31';

const BASE_URL = 'https://base44.app/api/apps/6a274334d6b0962f39294123/functions/companyReview';

// Base44 SDK client for entity reads
const base44 = createClient({ appId: '6a274334d6b0962f39294123', serviceRoleToken: Deno.env.get('SERVICE_ROLE_TOKEN') });

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ── API: mark company as followed / skipped ─────────────────────────────────
  if (url.searchParams.get('action') === 'updateStatus') {
    const id = url.searchParams.get('id');
    const status = url.searchParams.get('status');
    if (!id || !status) return Response.json({ error: 'missing id or status' }, { status: 400 });

    try {
      await base44.entities.CompanyProspect.update(id, { status });
      return Response.json({ ok: true });
    } catch (e: any) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  }

  try {
    // Fetch all company prospects
    let allCompanies: any[] = [];
    let skip = 0;
    let hasMore = true;
    while (hasMore && allCompanies.length < 300) {
      const result = await base44.entities.CompanyProspect.list({ limit: 100, skip });
      allCompanies = allCompanies.concat(result.results || result || []);
      hasMore = (result.has_more === true);
      skip += 100;
    }

    // Split into unsent (NEW / null) vs done (FOLLOWED / SKIPPED)
    const unsent = allCompanies.filter((c: any) => {
      const s = (c.status || 'NEW').toUpperCase();
      return s === 'NEW' || s === '' || !s;
    });
    const done = allCompanies.filter((c: any) => {
      const s = (c.status || '').toUpperCase();
      return s === 'FOLLOWED' || s === 'SKIPPED';
    });

    // Sort unsent: newest first
    unsent.sort((a: any, b: any) => new Date(b.date_added || b.created_date).getTime() - new Date(a.date_added || a.created_date).getTime());

    const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' });

    function sectorColor(sector: string) {
      const s = (sector || '').toLowerCase();
      if (s.includes('civil')) return '#4299e1';
      if (s.includes('concrete')) return '#ed8936';
      if (s.includes('electric')) return '#9f7aea';
      return '#667eea';
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CrewCast — Company Prospect Review</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f4f8; color: #1a202c; }
    header { background: #1a202c; color: white; padding: 20px 32px; display: flex; align-items: center; justify-content: space-between; }
    header h1 { font-size: 20px; font-weight: 700; }
    header .subtitle { font-size: 13px; color: #a0aec0; margin-top: 2px; }
    .badge { background: #f6ad55; color: #1a202c; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 20px; }
    .container { max-width: 960px; margin: 0 auto; padding: 28px 20px; }
    .stats { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .stat { background: white; border-radius: 10px; padding: 16px 20px; flex: 1; min-width: 120px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .stat .num { font-size: 28px; font-weight: 800; color: #2d3748; }
    .stat .label { font-size: 11px; color: #718096; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }
    .section-title { font-size: 13px; font-weight: 700; color: #718096; text-transform: uppercase; letter-spacing: 0.5px; margin: 24px 0 12px; }
    .company-card { background: white; border-radius: 12px; padding: 22px 24px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border-left: 4px solid #667eea; }
    .company-card.followed { border-left-color: #68d391; opacity: 0.6; }
    .company-card.skipped { border-left-color: #fc8181; opacity: 0.5; }
    .card-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; flex-wrap: wrap; gap: 10px; }
    .company-info h3 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
    .sector-tag { display: inline-block; color: white; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
    .card-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .btn-li { background: #0077b5; color: white; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
    .btn-follow { background: #c6f6d5; color: #276749; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
    .btn-skip { background: #fed7d7; color: #9b2c2c; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin: 14px 0; }
    .meta-item { background: #f7fafc; border-radius: 8px; padding: 10px 14px; }
    .meta-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #718096; margin-bottom: 3px; }
    .meta-value { font-size: 14px; color: #2d3748; font-weight: 500; }
    .strategy-block { margin-top: 12px; }
    .strat { background: #f7fafc; border-radius: 8px; padding: 12px 14px; margin-top: 8px; }
    .strat-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #667eea; margin-bottom: 4px; }
    .strat-text { font-size: 14px; color: #4a5568; line-height: 1.5; }
    .empty { text-align: center; padding: 60px 20px; color: #a0aec0; }
    .status-pill { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; margin-left: 8px; }
    .status-FOLLOWED { background: #c6f6d5; color: #276749; }
    .status-SKIPPED { background: #fed7d7; color: #9b2c2c; }
    details summary { cursor: pointer; font-size: 13px; font-weight: 700; color: #718096; text-transform: uppercase; letter-spacing: 0.5px; margin: 24px 0 12px; }
    .progress-bar { background: #e2e8f0; border-radius: 4px; height: 6px; margin-bottom: 6px; }
    .progress-fill { background: #48bb78; border-radius: 4px; height: 6px; transition: width 0.4s; }
  </style>
</head>
<body>
<header>
  <div>
    <h1>🏢 CrewCast — Company Prospect Review</h1>
    <div class="subtitle">${todayStr}</div>
  </div>
  <div class="badge">${unsent.length} To Follow</div>
</header>
<div class="container">
  <div class="stats">
    <div class="stat"><div class="num" id="unsentNum">${unsent.length}</div><div class="label">To Follow</div></div>
    <div class="stat"><div class="num" id="followedNum">0</div><div class="label">Followed This Session</div></div>
    <div class="stat"><div class="num">${done.length}</div><div class="label">Total Done</div></div>
    <div class="stat"><div class="num">${allCompanies.length}</div><div class="label">All Time</div></div>
  </div>
  <div class="progress-bar"><div class="progress-fill" id="progressFill" style="width:0%"></div></div>
  <div style="font-size:12px;color:#718096;margin-bottom:20px;"><span id="progressText">0 / ${unsent.length} followed this session</span></div>

  <div class="section-title">🏢 Companies to Follow (${unsent.length})</div>

  ${unsent.length === 0 ? `<div class="empty"><h2>🎉 All caught up!</h2><p>10 new companies added every night at 2am ET.</p></div>` :
    unsent.map((c: any, i: number) => `
    <div class="company-card" id="card-${i}">
      <div class="card-top">
        <div class="company-info">
          <h3>${c.company_name || 'Unknown Company'}</h3>
          <span class="sector-tag" style="background:${sectorColor(c.sector)}">${c.sector || 'General Contracting'}</span>
        </div>
        <div class="card-actions">
          <a href="${(c.linkedin_url || '').startsWith('http') ? c.linkedin_url : 'https://' + (c.linkedin_url || 'linkedin.com')}" target="_blank" rel="noopener" class="btn-li">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
            Open LinkedIn
          </a>
          <button class="btn-follow" onclick="markFollowed(${i}, '${c.id}')">✓ Followed</button>
          <button class="btn-skip" onclick="markSkipped(${i}, '${c.id}')">✕ Skip</button>
        </div>
      </div>
      <div class="meta-grid">
        <div class="meta-item"><div class="meta-label">HQ</div><div class="meta-value">${c.headquarters || '—'}</div></div>
        <div class="meta-item"><div class="meta-label">Revenue</div><div class="meta-value">${c.revenue_estimate || '—'}</div></div>
        <div class="meta-item"><div class="meta-label">Employees</div><div class="meta-value">${c.employee_count || '—'}</div></div>
        <div class="meta-item"><div class="meta-label">Added</div><div class="meta-value">${c.date_added ? new Date(c.date_added).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</div></div>
      </div>
      ${c.specialties ? `<div class="strat"><div class="strat-label">Specialties</div><div class="strat-text">${c.specialties}</div></div>` : ''}
      ${c.follow_strategy ? `<div class="strat"><div class="strat-label">📌 Follow Strategy</div><div class="strat-text">${c.follow_strategy}</div></div>` : ''}
      ${c.engagement_angle ? `<div class="strat"><div class="strat-label">💬 Engagement Angle</div><div class="strat-text">${c.engagement_angle}</div></div>` : ''}
    </div>`).join('')}

  ${done.length > 0 ? `
  <details>
    <summary>✅ Already Done (${done.length})</summary>
    ${done.map((c: any) => `
    <div class="company-card ${(c.status || '').toLowerCase()}">
      <div class="card-top">
        <div class="company-info">
          <h3>${c.company_name} <span class="status-pill status-${(c.status || '').toUpperCase()}">${c.status}</span></h3>
          <span class="sector-tag" style="background:${sectorColor(c.sector)}">${c.sector || 'General Contracting'}</span>
        </div>
        ${c.linkedin_url ? `<a href="${c.linkedin_url.startsWith('http') ? c.linkedin_url : 'https://' + c.linkedin_url}" target="_blank" rel="noopener" class="btn-li">Open LinkedIn</a>` : ''}
      </div>
    </div>`).join('')}
  </details>` : ''}
</div>

<script>
  const BASE_URL = '${BASE_URL}';
  let sessionFollowed = 0;
  const total = ${unsent.length};

  async function markFollowed(cardIdx, companyId) {
    const card = document.getElementById('card-' + cardIdx);
    card.classList.add('followed');
    card.querySelectorAll('button').forEach(b => b.disabled = true);
    sessionFollowed++;
    document.getElementById('followedNum').textContent = sessionFollowed;
    document.getElementById('unsentNum').textContent = Math.max(0, total - sessionFollowed);
    document.getElementById('progressFill').style.width = ((sessionFollowed / total) * 100) + '%';
    document.getElementById('progressText').textContent = sessionFollowed + ' / ' + total + ' followed this session';
    try { await fetch(BASE_URL + '?action=updateStatus&id=' + companyId + '&status=FOLLOWED'); } catch(e) {}
  }

  async function markSkipped(cardIdx, companyId) {
    const card = document.getElementById('card-' + cardIdx);
    card.classList.add('skipped');
    card.querySelectorAll('button').forEach(b => b.disabled = true);
    try { await fetch(BASE_URL + '?action=updateStatus&id=' + companyId + '&status=SKIPPED'); } catch(e) {}
  }
</script>
</body>
</html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });

  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
