import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const HUBSPOT_TOKEN = Deno.env.get('HUBSPOT_ACCESS_TOKEN') || '';

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
  try {
    // Fetch contacts with relevant properties
    const contactsData = await fetchHubspot(
      '/crm/v3/objects/contacts?limit=50&properties=firstname,lastname,jobtitle,company,hs_linkedin_url,hs_content_membership_notes,hs_lead_status,createdate&sorts=-createdate'
    );

    const contacts = (contactsData.results || []).filter((c: any) => {
      const p = c.properties;
      // Only show real CrewCast prospects (has LinkedIn URL and outreach notes)
      return p.hs_linkedin_url && p.hs_content_membership_notes;
    });

    // Get company details for each contact via associations
    const enrichedContacts = await Promise.all(contacts.map(async (contact: any) => {
      const p = contact.properties;
      
      // Parse the 3 touches from the notes field
      const notes = p.hs_content_membership_notes || '';
      const touch1Match = notes.match(/TOUCH 1[^:]*:\n([\s\S]*?)(?=\n\nTOUCH 2|$)/);
      const touch2Match = notes.match(/TOUCH 2[^:]*:\n([\s\S]*?)(?=\n\nTOUCH 3|$)/);
      const touch3Match = notes.match(/TOUCH 3[^:]*:\n([\s\S]*?)$/);

      return {
        id: contact.id,
        name: `${p.firstname || ''} ${p.lastname || ''}`.trim(),
        title: p.jobtitle || '',
        company: p.company || '',
        linkedin: p.hs_linkedin_url || '',
        status: p.hs_lead_status || 'NEW',
        created: p.createdate || '',
        touch1: touch1Match ? touch1Match[1].trim() : '',
        touch2: touch2Match ? touch2Match[1].trim() : '',
        touch3: touch3Match ? touch3Match[1].trim() : '',
      };
    }));

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CrewCast — Daily Prospect Review</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f4f8; color: #1a202c; }
    
    header {
      background: #1a202c;
      color: white;
      padding: 20px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    header h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
    header .subtitle { font-size: 13px; color: #a0aec0; margin-top: 2px; }
    .badge { background: #f6ad55; color: #1a202c; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 20px; }

    .container { max-width: 900px; margin: 0 auto; padding: 28px 20px; }

    .stats { display: flex; gap: 12px; margin-bottom: 24px; }
    .stat { background: white; border-radius: 10px; padding: 16px 20px; flex: 1; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .stat .num { font-size: 28px; font-weight: 800; color: #2d3748; }
    .stat .label { font-size: 12px; color: #718096; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.5px; }

    .tabs { display: flex; gap: 8px; margin-bottom: 20px; }
    .tab { padding: 8px 18px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: 2px solid transparent; background: white; color: #4a5568; }
    .tab.active { background: #1a202c; color: white; }

    .prospect-card {
      background: white;
      border-radius: 12px;
      padding: 20px 24px;
      margin-bottom: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      border-left: 4px solid #e2e8f0;
      transition: border-color 0.2s;
    }
    .prospect-card.sent { border-left-color: #68d391; opacity: 0.7; }
    .prospect-card.skipped { border-left-color: #fc8181; opacity: 0.6; }

    .card-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; }
    .person { display: flex; align-items: center; gap: 12px; }
    .avatar {
      width: 44px; height: 44px; border-radius: 50%;
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white; font-weight: 700; font-size: 16px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .person-info h3 { font-size: 16px; font-weight: 700; color: #1a202c; }
    .person-info p { font-size: 13px; color: #718096; margin-top: 2px; }

    .actions { display: flex; gap: 8px; align-items: center; }
    .btn-linkedin {
      background: #0077b5; color: white;
      padding: 8px 16px; border-radius: 8px;
      font-size: 13px; font-weight: 600;
      text-decoration: none; display: inline-flex;
      align-items: center; gap: 6px;
      transition: background 0.2s;
    }
    .btn-linkedin:hover { background: #005e8e; }
    .btn-sent { background: #c6f6d5; color: #276749; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
    .btn-skip { background: #fed7d7; color: #9b2c2c; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; }

    .touch-tabs { display: flex; gap: 6px; margin-bottom: 10px; }
    .touch-tab { padding: 5px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; cursor: pointer; background: #edf2f7; color: #4a5568; border: none; }
    .touch-tab.active { background: #ebf4ff; color: #2b6cb0; }

    .message-box { position: relative; }
    .message-text {
      background: #f7fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 14px 16px;
      font-size: 14px;
      line-height: 1.6;
      color: #2d3748;
      min-height: 80px;
    }
    .copy-btn {
      position: absolute; top: 10px; right: 10px;
      background: #1a202c; color: white;
      border: none; border-radius: 6px;
      padding: 5px 12px; font-size: 12px; font-weight: 600;
      cursor: pointer; transition: background 0.2s;
    }
    .copy-btn:hover { background: #2d3748; }
    .copy-btn.copied { background: #38a169; }

    .timing { font-size: 11px; color: #a0aec0; margin-top: 6px; }

    .empty { text-align: center; padding: 60px 20px; color: #a0aec0; }
    .empty h2 { font-size: 20px; margin-bottom: 8px; }

    .progress-bar { background: #e2e8f0; border-radius: 4px; height: 6px; margin-top: 8px; }
    .progress-fill { background: #48bb78; border-radius: 4px; height: 6px; transition: width 0.4s; }
  </style>
</head>
<body>

<header>
  <div>
    <h1>🏗️ CrewCast — Daily Prospect Review</h1>
    <div class="subtitle">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
  </div>
  <div class="badge">${enrichedContacts.length} Prospects Ready</div>
</header>

<div class="container">
  <div class="stats">
    <div class="stat">
      <div class="num" id="totalCount">${enrichedContacts.length}</div>
      <div class="label">Total Prospects</div>
    </div>
    <div class="stat">
      <div class="num" id="sentCount">0</div>
      <div class="label">Sent Today</div>
    </div>
    <div class="stat">
      <div class="num" id="remainingCount">${enrichedContacts.length}</div>
      <div class="label">Remaining</div>
    </div>
  </div>

  <div class="progress-bar">
    <div class="progress-fill" id="progressFill" style="width: 0%"></div>
  </div>
  <div style="font-size:12px; color:#718096; margin: 6px 0 20px;">Progress: <span id="progressText">0/${enrichedContacts.length} sent</span></div>

  <div id="prospectList">
    ${enrichedContacts.length === 0 ? `
      <div class="empty">
        <h2>No prospects yet</h2>
        <p>The overnight automation will load 10 new ops leaders by 2am ET.</p>
      </div>
    ` : enrichedContacts.map((c, i) => `
      <div class="prospect-card" id="card-${i}">
        <div class="card-header">
          <div class="person">
            <div class="avatar">${(c.name[0] || '?').toUpperCase()}</div>
            <div class="person-info">
              <h3>${c.name}</h3>
              <p>${c.title} · ${c.company}</p>
            </div>
          </div>
          <div class="actions">
            <a href="${c.linkedin}" target="_blank" class="btn-linkedin">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
              Open LinkedIn
            </a>
            <button class="btn-sent" onclick="markSent(${i})">✓ Sent</button>
            <button class="btn-skip" onclick="markSkipped(${i})">✕ Skip</button>
          </div>
        </div>

        <div class="touch-tabs">
          <button class="touch-tab active" onclick="showTouch(${i}, 1, this)">Touch 1 · Connection Request</button>
          <button class="touch-tab" onclick="showTouch(${i}, 2, this)">Touch 2 · Value Message</button>
          <button class="touch-tab" onclick="showTouch(${i}, 3, this)">Touch 3 · Follow-up</button>
        </div>

        <div class="message-box">
          <div class="message-text" id="msg-${i}-1">${c.touch1.replace(/\n/g, '<br>')}</div>
          <div class="message-text" id="msg-${i}-2" style="display:none">${c.touch2.replace(/\n/g, '<br>')}</div>
          <div class="message-text" id="msg-${i}-3" style="display:none">${c.touch3.replace(/\n/g, '<br>')}</div>
          <button class="copy-btn" id="copy-${i}" onclick="copyMessage(${i})">Copy</button>
        </div>
        <div class="timing" id="timing-${i}">Send Touch 1 now → Touch 2 in 3-5 days after they accept → Touch 3 in 5-7 days if no reply</div>
      </div>
    `).join('')}
  </div>
</div>

<script>
  const messages = {
    ${enrichedContacts.map((c, i) => `
    ${i}: {
      1: ${JSON.stringify(c.touch1)},
      2: ${JSON.stringify(c.touch2)},
      3: ${JSON.stringify(c.touch3)}
    }`).join(',')}
  };

  let sentCount = 0;
  const total = ${enrichedContacts.length};

  function showTouch(cardIdx, touch, btn) {
    [1,2,3].forEach(t => {
      const el = document.getElementById('msg-' + cardIdx + '-' + t);
      if (el) el.style.display = t === touch ? 'block' : 'none';
    });
    btn.closest('.touch-tabs').querySelectorAll('.touch-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const timings = ['Send Touch 1 now → Touch 2 in 3-5 days after they accept → Touch 3 in 5-7 days if no reply',
      'Send after they accept your connection request (3-5 days)',
      'Send if no reply to Touch 2 (5-7 days later)'];
    document.getElementById('timing-' + cardIdx).textContent = timings[touch - 1];
  }

  function copyMessage(cardIdx) {
    const activeTouch = [...document.getElementById('card-' + cardIdx).querySelectorAll('.touch-tab')].findIndex(b => b.classList.contains('active')) + 1;
    const text = messages[cardIdx][activeTouch];
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('copy-' + cardIdx);
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
    });
  }

  function markSent(cardIdx) {
    const card = document.getElementById('card-' + cardIdx);
    card.classList.add('sent');
    sentCount++;
    updateProgress();
  }

  function markSkipped(cardIdx) {
    const card = document.getElementById('card-' + cardIdx);
    card.classList.add('skipped');
  }

  function updateProgress() {
    document.getElementById('sentCount').textContent = sentCount;
    document.getElementById('remainingCount').textContent = total - sentCount;
    document.getElementById('progressFill').style.width = (sentCount / total * 100) + '%';
    document.getElementById('progressText').textContent = sentCount + '/' + total + ' sent';
  }
</script>
</body>
</html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
