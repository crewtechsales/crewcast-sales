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

  if (url.searchParams.get('action') === 'updateStatus') {
    const id = url.searchParams.get('id');
    const status = url.searchParams.get('status');
    if (!id || !status) return Response.json({ error: 'missing id or status' }, { status: 400 });
    await fetchHubspot(`/crm/v3/objects/contacts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: { hs_lead_status: status } }),
    });
    return Response.json({ ok: true });
  }

  try {
    let allContacts: any[] = [];
    let after: string | undefined;
    do {
      const pagePath = `/crm/v3/objects/contacts?limit=100&properties=firstname,lastname,jobtitle,company,hs_linkedin_url,hs_content_membership_notes,hs_lead_status,createdate${after ? `&after=${after}` : ''}`;
      const data = await fetchHubspot(pagePath);
      const batch = (data.results || []).filter((c: any) => c.properties.hs_linkedin_url && c.properties.hs_content_membership_notes);
      allContacts = allContacts.concat(batch);
      after = data.paging?.next?.after;
    } while (after && allContacts.length < 200);

    const unsent = allContacts.filter((c: any) => {
      const s = (c.properties.hs_lead_status || '').toUpperCase();
      return !s || s === 'NEW' || s === 'OPEN';
    });
    const done = allContacts.filter((c: any) => {
      const s = (c.properties.hs_lead_status || '').toUpperCase();
      return s === 'SENT' || s === 'SKIPPED' || s === 'CONNECTED';
    });

    unsent.sort((a: any, b: any) => new Date(b.properties.createdate).getTime() - new Date(a.properties.createdate).getTime());

    function parse(contact: any) {
      const p = contact.properties;
      const notes = p.hs_content_membership_notes || '';
      const t1 = notes.match(/TOUCH 1[^:]*:\s*\n([\s\S]*?)(?=\n\nTOUCH 2|$)/i);
      const t2 = notes.match(/TOUCH 2[^:]*:\s*\n([\s\S]*?)(?=\n\nTOUCH 3|$)/i);
      const t3 = notes.match(/TOUCH 3[^:]*:\s*\n([\s\S]*?)$/i);
      return {
        id: contact.id,
        name: `${p.firstname || ''} ${p.lastname || ''}`.trim() || 'Unknown',
        title: p.jobtitle || '',
        company: p.company || '',
        linkedin: p.hs_linkedin_url || '',
        status: (p.hs_lead_status || 'NEW').toUpperCase(),
        touch1: t1 ? t1[1].trim() : notes.slice(0, 300),
        touch2: t2 ? t2[1].trim() : '',
        touch3: t3 ? t3[1].trim() : '',
      };
    }

    const up = unsent.map(parse);
    const dp = done.map(parse);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' });

    // Escape HTML entities in text content
    function esc(s: string) {
      return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CrewCast — Prospect Review</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f4f8;color:#1a202c}
header{background:#1a202c;color:white;padding:20px 32px;display:flex;align-items:center;justify-content:space-between}
header h1{font-size:20px;font-weight:700}
header .sub{font-size:13px;color:#a0aec0;margin-top:2px}
.badge{background:#f6ad55;color:#1a202c;font-size:12px;font-weight:700;padding:4px 10px;border-radius:20px}
.wrap{max-width:920px;margin:0 auto;padding:28px 20px}
.stats{display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap}
.stat{background:white;border-radius:10px;padding:16px 20px;flex:1;min-width:110px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.stat .n{font-size:28px;font-weight:800;color:#2d3748}
.stat .l{font-size:11px;color:#718096;margin-top:2px;text-transform:uppercase;letter-spacing:.5px}
.pbar{background:#e2e8f0;border-radius:4px;height:6px;margin-bottom:6px}
.pfill{background:#48bb78;border-radius:4px;height:6px;transition:width .4s}
.sec{font-size:13px;font-weight:700;color:#718096;text-transform:uppercase;letter-spacing:.5px;margin:24px 0 12px}
.card{background:white;border-radius:12px;padding:20px 24px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,.08);border-left:4px solid #e2e8f0}
.card.sent{border-left-color:#68d391;opacity:.6}
.card.skipped{border-left-color:#fc8181;opacity:.5}
.ch{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px}
.person{display:flex;align-items:center;gap:12px}
.av{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);color:white;font-weight:700;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.pi h3{font-size:16px;font-weight:700}
.pi p{font-size:13px;color:#718096;margin-top:2px}
.acts{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.bli{background:#0077b5;color:white;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
.bsent{background:#c6f6d5;color:#276749;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none}
.bskip{background:#fed7d7;color:#9b2c2c;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none}
.ttabs{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap}
.ttab{padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;background:#edf2f7;color:#4a5568;border:none}
.ttab.active{background:#ebf4ff;color:#2b6cb0}
.mbox{position:relative}
.msg{background:#f7fafc;border:2px solid #e2e8f0;border-radius:8px;padding:14px 16px;font-size:14px;line-height:1.6;color:#2d3748;width:100%;resize:none;font-family:inherit;cursor:pointer;box-sizing:border-box;transition:border-color .15s}
.msg:focus{border-color:#4299e1;outline:none;background:#ebf8ff}
.copybtn{position:absolute;top:10px;right:10px;background:#1a202c;color:white;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;z-index:2}
.copybtn.ok{background:#38a169}
.hint{font-size:11px;color:#a0aec0;margin-top:5px}
.timing{font-size:11px;color:#a0aec0;margin-top:6px}
.empty{text-align:center;padding:60px 20px;color:#a0aec0}
.spill{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;margin-left:8px}
.s-SENT{background:#c6f6d5;color:#276749}
.s-SKIPPED{background:#fed7d7;color:#9b2c2c}
.s-CONNECTED{background:#bee3f8;color:#2a69ac}
details summary{cursor:pointer;font-size:13px;font-weight:700;color:#718096;text-transform:uppercase;letter-spacing:.5px;margin:24px 0 12px}
</style>
</head>
<body>
<header>
  <div><h1>🏗️ CrewCast — Individual Prospect Review</h1><div class="sub">${today}</div></div>
  <div class="badge">${up.length} Unsent</div>
</header>
<div class="wrap">
  <div class="stats">
    <div class="stat"><div class="n" id="nUnsent">${up.length}</div><div class="l">Unsent</div></div>
    <div class="stat"><div class="n" id="nSent">0</div><div class="l">Sent</div></div>
    <div class="stat"><div class="n" id="nSkipped">0</div><div class="l">Skipped</div></div>
    <div class="stat"><div class="n">${dp.length}</div><div class="l">Total Done</div></div>
  </div>
  <div class="pbar"><div class="pfill" id="pfill" style="width:0%"></div></div>
  <div style="font-size:12px;color:#718096;margin-bottom:20px"><span id="ptxt">0 / ${up.length} sent</span></div>
  <div class="sec">📬 Unsent Prospects (${up.length})</div>
  ${up.length === 0
    ? '<div class="empty"><h2>🎉 All caught up!</h2><p>New prospects arrive every night at 2am ET.</p></div>'
    : up.map((c, i) => `
  <div class="card" id="card-${i}">
    <div class="ch">
      <div class="person">
        <div class="av">${esc(c.name[0] || '?').toUpperCase()}</div>
        <div class="pi"><h3>${esc(c.name)}</h3><p>${esc(c.title)}${c.company ? ' · ' + esc(c.company) : ''}</p></div>
      </div>
      <div class="acts">
        <a href="${c.linkedin.startsWith('http') ? esc(c.linkedin) : 'https://' + esc(c.linkedin)}" target="_blank" rel="noopener" class="bli">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
          Open LinkedIn
        </a>
        <button class="bsent" onclick="markSent(${i},'${c.id}')">✓ Sent</button>
        <button class="bskip" onclick="markSkip(${i},'${c.id}')">✕ Skip</button>
      </div>
    </div>
    <div class="ttabs">
      <button class="ttab active" onclick="swTab(${i},1,this)">Touch 1 · Connection</button>
      <button class="ttab" onclick="swTab(${i},2,this)">Touch 2 · Value</button>
      <button class="ttab" onclick="swTab(${i},3,this)">Touch 3 · Follow-up</button>
    </div>
    <div class="mbox">
      <textarea class="msg" id="m${i}-1" readonly rows="5" onclick="selAll(this)">${esc(c.touch1)}</textarea>
      <textarea class="msg" id="m${i}-2" style="display:none" readonly rows="5" onclick="selAll(this)">${esc(c.touch2)}</textarea>
      <textarea class="msg" id="m${i}-3" style="display:none" readonly rows="5" onclick="selAll(this)">${esc(c.touch3)}</textarea>
      <button class="copybtn" id="cb${i}" onclick="doCopy(${i})">Copy</button>
    </div>
    <div class="hint">👆 Click text to select all &nbsp;·&nbsp; or use Copy button &nbsp;·&nbsp; then ⌘C / Ctrl+C</div>
    <div class="timing" id="tm${i}">Touch 1 now · Touch 2 in 3-5 days after accept · Touch 3 in 5-7 days if no reply</div>
  </div>`).join('')}

  ${dp.length > 0 ? `
  <details>
    <summary>✅ Already Done (${dp.length})</summary>
    ${dp.map(c => `
    <div class="card ${c.status.toLowerCase()}">
      <div class="ch">
        <div class="person">
          <div class="av">${esc(c.name[0] || '?').toUpperCase()}</div>
          <div class="pi"><h3>${esc(c.name)}<span class="spill s-${c.status}">${c.status}</span></h3><p>${esc(c.title)}${c.company ? ' · '+esc(c.company):''}</p></div>
        </div>
        <a href="${c.linkedin.startsWith('http')?esc(c.linkedin):'https://'+esc(c.linkedin)}" target="_blank" rel="noopener" class="bli">Open LinkedIn</a>
      </div>
    </div>`).join('')}
  </details>` : ''}
</div>

<script>
const BASE = '${BASE_URL}';
const MSGS = ${JSON.stringify(Object.fromEntries(up.map((c,i)=>[i,{1:c.touch1,2:c.touch2,3:c.touch3}])))};
let nSent=0, nSkip=0;
const total=${up.length};

function selAll(ta){
  ta.focus();
  ta.select();
  ta.setSelectionRange(0,99999);
}

function doCopy(i){
  const tabs=[...document.getElementById('card-'+i).querySelectorAll('.ttab')];
  const t=tabs.findIndex(b=>b.classList.contains('active'))+1||1;
  const text=MSGS[i]&&MSGS[i][t]||'';
  const btn=document.getElementById('cb'+i);

  // Method 1: modern async clipboard (works on https if permitted)
  if(navigator.clipboard){
    navigator.clipboard.writeText(text).then(()=>flash(btn)).catch(()=>legacyCopy(text,btn));
    return;
  }
  legacyCopy(text,btn);
}

function legacyCopy(text,btn){
  // Method 2: off-screen textarea + execCommand (Safari-compatible when called from click)
  const d=document.createElement('textarea');
  d.value=text;
  d.style='position:fixed;left:-9999px;top:-9999px;opacity:0';
  document.body.appendChild(d);
  d.focus();
  d.select();
  d.setSelectionRange(0,99999);
  let ok=false;
  try{ok=document.execCommand('copy');}catch(e){}
  document.body.removeChild(d);
  if(ok){flash(btn);}else{btn.textContent='⌘C to copy';}
}

function flash(btn){
  btn.textContent='✓ Copied!';
  btn.classList.add('ok');
  setTimeout(()=>{btn.textContent='Copy';btn.classList.remove('ok');},2000);
}

function swTab(i,t,btn){
  [1,2,3].forEach(n=>{
    const el=document.getElementById('m'+i+'-'+n);
    if(el)el.style.display=n===t?'block':'none';
  });
  btn.closest('.ttabs').querySelectorAll('.ttab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const tips=['Touch 1 now · Touch 2 in 3-5 days after accept · Touch 3 in 5-7 days if no reply',
    'Send after they accept (3-5 days later)','Send if no reply to Touch 2 (5-7 days later)'];
  document.getElementById('tm'+i).textContent=tips[t-1];
}

async function markSent(i,id){
  const c=document.getElementById('card-'+i);
  c.classList.add('sent');
  c.querySelectorAll('button').forEach(b=>b.disabled=true);
  nSent++;
  document.getElementById('nSent').textContent=nSent;
  document.getElementById('nUnsent').textContent=Math.max(0,total-nSent-nSkip);
  document.getElementById('pfill').style.width=(nSent/total*100)+'%';
  document.getElementById('ptxt').textContent=nSent+' / '+total+' sent';
  try{await fetch(BASE+'?action=updateStatus&id='+id+'&status=SENT');}catch(e){}
}

async function markSkip(i,id){
  const c=document.getElementById('card-'+i);
  c.classList.add('skipped');
  c.querySelectorAll('button').forEach(b=>b.disabled=true);
  nSkip++;
  document.getElementById('nSkipped').textContent=nSkip;
  document.getElementById('nUnsent').textContent=Math.max(0,total-nSent-nSkip);
  try{await fetch(BASE+'?action=updateStatus&id='+id+'&status=SKIPPED');}catch(e){}
}
</script>
</body>
</html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});
