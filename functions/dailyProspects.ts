import { createClient } from 'npm:@base44/sdk@0.8.31';

const HUBSPOT_TOKEN = Deno.env.get('HUBSPOT_ACCESS_TOKEN') || '';
const BASE_URL = 'https://base44.app/api/apps/6a274334d6b0962f39294123/functions/dailyProspects';

async function fetchHubspot(path: string, options: RequestInit = {}) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  return res.json();
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ── API: update contact status ──────────────────────────────────────────────
  if (url.searchParams.get('action') === 'updateStatus') {
    const id = url.searchParams.get('id');
    const status = url.searchParams.get('status'); // SENT or SKIPPED
    if (!id || !status) return Response.json({ error: 'missing id or status' }, { status: 400 });

    await fetchHubspot(`/crm/v3/objects/contacts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: { hs_lead_status: status } }),
    });
    return Response.json({ ok: true });
  }

  try {
    // Fetch ALL contacts (paginate up to 200 to catch carryover)
    let allContacts: any[] = [];
    let after: string | undefined;
    do {
      const pagePath = `/crm/v3/objects/contacts?limit=100&properties=firstname,lastname,jobtitle,company,hs_linkedin_url,hs_content_membership_notes,hs_lead_status,createdate${after ? `&after=${after}` : ''}`;
      const data = await fetchHubspot(pagePath);
      const batch = (data.results || []).filter((c: any) => {
        const p = c.properties;
        return p.hs_linkedin_url && p.hs_content_membership_notes;
      });
      allContacts = allContacts.concat(batch);
      after = data.paging?.next?.after;
    } while (after && allContacts.length < 200);

    // Split: unsent (NEW + null) carry over; sent/skipped go to done section
    const unsent = allContacts.filter((c: any) => {
      const s = (c.properties.hs_lead_status || '').toUpperCase();
      return s === 'NEW' || s === '' || s === 'OPEN' || !s;
    });
    const done = allContacts.filter((c: any) => {
      const s = (c.properties.hs_lead_status || '').toUpperCase();
      return s === 'SENT' || s === 'SKIPPED' || s === 'CONNECTED';
    });

    // Sort unsent: newest first
    unsent.sort((a: any, b: any) => new Date(b.properties.createdate).getTime() - new Date(a.properties.createdate).getTime());

    function parseContact(contact: any) {
      const p = contact.properties;
      const notes = p.hs_content_membership_notes || '';
      const touch1Match = notes.match(/TOUCH 1[^:]*:\s*\n([\s\S]*?)(?=\n\nTOUCH 2|$)/i);
      const touch2Match = notes.match(/TOUCH 2[^:]*:\s*\n([\s\S]*?)(?=\n\nTOUCH 3|$)/i);
      const touch3Match = notes.match(/TOUCH 3[^:]*:\s*\n([\s\S]*?)$/i);
      return {
        id: contact.id,
        name: `${p.firstname || ''} ${p.lastname || ''}`.trim() || 'Unknown',
        title: p.jobtitle || '',
        company: p.company || '',
        linkedin: p.hs_linkedin_url || '',
        status: (p.hs_lead_status || 'NEW').toUpperCase(),
        created: p.createdate || '',
        touch1: touch1Match ? touch1Match[1].trim() : notes.slice(0, 300),
        touch2: touch2Match ? touch2Match[1].trim() : '',
        touch3: touch3Match ? touch3Match[1].trim() : '',
      };
    }

    const unsentParsed = unsent.map(parseContact);
    const doneParsed = done.map(parseContact);

    const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CrewCast — Daily Prospect Review</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f4f8; color: #1a202c; }
    header { background: #1a202c; color: white; padding: 20px 32px; display: flex; align-items: center; justify-content: space-between; }
    header h1 { font-size: 20px; font-weight: 700; }
    header .subtitle { font-size: 13px; color: #a0aec0; margin-top: 2px; }
    .badge { background: #f6ad55; color: #1a202c; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 20px; }
    .container { max-width: 920px; margin: 0 auto; padding: 28px 20px; }
    .stats { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .stat { background: white; border-radius: 10px; padding: 16px 20px; flex: 1; min-width: 120px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .stat .num { font-size: 28px; font-weight: 800; color: #2d3748; }
    .stat .label { font-size: 11px; color: #718096; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }
    .progress-bar { background: #e2e8f0; border-radius: 4px; height: 6px; margin-bottom: 6px; }
    .progress-fill { background: #48bb78; border-radius: 4px; height: 6px; transition: width 0.4s; }
    .section-title { font-size: 13px; font-weight: 700; color: #718096; text-transform: uppercase; letter-spacing: 0.5px; margin: 24px 0 12px; }
    .prospect-card { background: white; border-radius: 12px; padding: 20px 24px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border-left: 4px solid #e2e8f0; }
    .prospect-card.sent { border-left-color: #68d391; opacity: 0.6; }
    .prospect-card.skipped { border-left-color: #fc8181; opacity: 0.5; }
    .card-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; flex-wrap: wrap; gap: 10px; }
    .person { display: flex; align-items: center; gap: 12px; }
    .avatar { width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, #667eea, #764ba2); color: white; font-weight: 700; font-size: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .person-info h3 { font-size: 16px; font-weight: 700; }
    .person-info p { font-size: 13px; color: #718096; margin-top: 2px; }
    .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .btn-linkedin { background: #0077b5; color: white; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
    .btn-sent { background: #c6f6d5; color: #276749; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
    .btn-skip { background: #fed7d7; color: #9b2c2c; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
    .touch-tabs { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
    .touch-tab { padding: 5px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; cursor: pointer; background: #edf2f7; color: #4a5568; border: none; }
    .touch-tab.active { background: #ebf4ff; color: #2b6cb0; }
    .message-box { position: relative; }
    .message-text { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 50px 14px 16px; font-size: 14px; line-height: 1.6; color: #2d3748; min-height: 80px; white-space: pre-wrap; width: 100%; resize: none; font-family: inherit; cursor: text; }
    .copy-btn { position: absolute; top: 10px; right: 10px; background: #1a202c; color: white; border: none; border-radius: 6px; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .copy-btn.copied { background: #38a169; }
    .timing { font-size: 11px; color: #a0aec0; margin-top: 6px; }
    .empty { text-align: center; padding: 60px 20px; color: #a0aec0; }
    .status-pill { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; margin-left: 8px; }
    .status-SENT { background: #c6f6d5; color: #276749; }
    .status-SKIPPED { background: #fed7d7; color: #9b2c2c; }
    .status-CONNECTED { background: #bee3f8; color: #2a69ac; }
    details summary { cursor: pointer; font-size: 13px; font-weight: 700; color: #718096; text-transform: uppercase; letter-spacing: 0.5px; margin: 24px 0 12px; }
  </style>
</head>
<body>
<header>
  <div>
    <h1>🏗️ CrewCast — Individual Prospect Review</h1>
    <div class="subtitle">${todayStr}</div>
  </div>
  <div class="badge">${unsentParsed.length} Unsent</div>
</header>
<div class="container">
  <div class="stats">
    <div class="stat"><div class="num" id="unsentNum">${unsentParsed.length}</div><div class="label">Unsent</div></div>
    <div class="stat"><div class="num" id="sentNum">0</div><div class="label">Sent This Session</div></div>
    <div class="stat"><div class="num" id="skippedNum">0</div><div class="label">Skipped This Session</div></div>
    <div class="stat"><div class="num">${doneParsed.length}</div><div class="label">Total Done</div></div>
  </div>
  <div class="progress-bar"><div class="progress-fill" id="progressFill" style="width:0%"></div></div>
  <div style="font-size:12px;color:#718096;margin-bottom:20px;"><span id="progressText">0 / ${unsentParsed.length} sent this session</span></div>

  <div class="section-title">📬 Unsent Prospects (${unsentParsed.length})</div>
  <div id="prospectList">
    ${unsentParsed.length === 0 ? `<div class="empty"><h2>🎉 All caught up!</h2><p>New prospects arrive every night at 2am ET.</p></div>` :
      unsentParsed.map((c, i) => `
      <div class="prospect-card" id="card-${i}" data-id="${c.id}">
        <div class="card-header">
          <div class="person">
            <div class="avatar">${c.name[0].toUpperCase()}</div>
            <div class="person-info">
              <h3>${c.name}</h3>
              <p>${c.title}${c.company ? ' · ' + c.company : ''}</p>
            </div>
          </div>
          <div class="actions">
            <a href="${c.linkedin.startsWith('http') ? c.linkedin : 'https://' + c.linkedin}" target="_blank" rel="noopener" class="btn-linkedin">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
              Open LinkedIn
            </a>
            <button class="btn-sent" onclick="markSent(${i}, '${c.id}')">✓ Sent</button>
            <button class="btn-skip" onclick="markSkipped(${i}, '${c.id}')">✕ Skip</button>
          </div>
        </div>
        <div class="touch-tabs">
          <button class="touch-tab active" onclick="showTouch(${i}, 1, this)">Touch 1 · Connection</button>
          <button class="touch-tab" onclick="showTouch(${i}, 2, this)">Touch 2 · Value</button>
          <button class="touch-tab" onclick="showTouch(${i}, 3, this)">Touch 3 · Follow-up</button>
        </div>
        <div class="message-box">
          <textarea class="message-text" id="msg-${i}-1" readonly rows="4">${c.touch1 || '(no message)'}</textarea>
          <textarea class="message-text" id="msg-${i}-2" style="display:none" readonly rows="4">${c.touch2 || '(no message)'}</textarea>
          <textarea class="message-text" id="msg-${i}-3" style="display:none" readonly rows="4">${c.touch3 || '(no message)'}</textarea>
          <button class="copy-btn" id="copy-${i}" onclick="copyMessage(${i})">Select All ✓</button>
        </div>
        <div class="timing" id="timing-${i}">Send Touch 1 now · Touch 2 in 3-5 days after they accept · Touch 3 in 5-7 days if no reply</div>
      </div>`).join('')}
  </div>

  ${doneParsed.length > 0 ? `
  <details>
    <summary>✅ Already Done (${doneParsed.length})</summary>
    ${doneParsed.map(c => `
    <div class="prospect-card ${c.status.toLowerCase()}">
      <div class="card-header">
        <div class="person">
          <div class="avatar">${c.name[0].toUpperCase()}</div>
          <div class="person-info">
            <h3>${c.name} <span class="status-pill status-${c.status}">${c.status}</span></h3>
            <p>${c.title}${c.company ? ' · ' + c.company : ''}</p>
          </div>
        </div>
        <a href="${c.linkedin.startsWith('http') ? c.linkedin : 'https://' + c.linkedin}" target="_blank" rel="noopener" class="btn-linkedin">Open LinkedIn</a>
      </div>
    </div>`).join('')}
  </details>` : ''}
</div>

<script>
  const messages = ${JSON.stringify(Object.fromEntries(unsentParsed.map((c, i) => [i, { 1: c.touch1, 2: c.touch2, 3: c.touch3 }])))};
  const BASE_URL = '${BASE_URL}';
  let sessionSent = 0, sessionSkipped = 0;
  const total = ${unsentParsed.length};

  function showTouch(cardIdx, touch, btn) {
    [1,2,3].forEach(t => {
      const el = document.getElementById('msg-' + cardIdx + '-' + t);
      if (el) el.style.display = t === touch ? 'block' : 'none';
    });
    btn.closest('.touch-tabs').querySelectorAll('.touch-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const timings = [
      'Send Touch 1 now · Touch 2 in 3-5 days after they accept · Touch 3 in 5-7 days if no reply',
      'Send after they accept your connection request (3-5 days later)',
      'Send if no reply to Touch 2 (5-7 days later)'
    ];
    document.getElementById('timing-' + cardIdx).textContent = timings[touch - 1];
  }

  function copyMessage(cardIdx) {
    const tabs = [...document.getElementById('card-' + cardIdx).querySelectorAll('.touch-tab')];
    const activeIdx = tabs.findIndex(b => b.classList.contains('active'));
    const touch = activeIdx >= 0 ? activeIdx + 1 : 1;
    const ta = document.getElementById('msg-' + cardIdx + '-' + touch);
    if (ta) {
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, 99999);
    }
    const btn = document.getElementById('copy-' + cardIdx);
    btn.textContent = 'Selected! Ctrl+C';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Select All ✓'; btn.classList.remove('copied'); }, 3000);
  }


  async function markSent(cardIdx, contactId) {
    const card = document.getElementById('card-' + cardIdx);
    card.classList.add('sent');
    card.querySelectorAll('button').forEach(b => b.disabled = true);
    sessionSent++;
    document.getElementById('sentNum').textContent = sessionSent;
    document.getElementById('unsentNum').textContent = Math.max(0, total - sessionSent - sessionSkipped);
    document.getElementById('progressFill').style.width = ((sessionSent / total) * 100) + '%';
    document.getElementById('progressText').textContent = sessionSent + ' / ' + total + ' sent this session';
    try {
      await fetch(BASE_URL + '?action=updateStatus&id=' + contactId + '&status=SENT');
    } catch(e) { console.error('Failed to save status', e); }
  }

  async function markSkipped(cardIdx, contactId) {
    const card = document.getElementById('card-' + cardIdx);
    card.classList.add('skipped');
    card.querySelectorAll('button').forEach(b => b.disabled = true);
    sessionSkipped++;
    document.getElementById('skippedNum').textContent = sessionSkipped;
    document.getElementById('unsentNum').textContent = Math.max(0, total - sessionSent - sessionSkipped);
    try {
      await fetch(BASE_URL + '?action=updateStatus&id=' + contactId + '&status=SKIPPED');
    } catch(e) { console.error('Failed to save status', e); }
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
