// index.js
import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

/* ---------- Debug: envs ---------- */
console.log("FB_APP_ID:", process.env.FB_APP_ID);
console.log("FB_REDIRECT:", process.env.FB_REDIRECT);
console.log("BASE_URL:", process.env.BASE_URL);

/* ---------- tiny HTML UI ---------- */
app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><title>WA Onboarding</title>

<style>
  body{font-family:system-ui;margin:32px}
  input{padding:8px;width:360px}
  button,a.btn{padding:10px 14px;margin-left:6px;cursor:pointer}
  small{color:#555}
  pre{background:#f6f6f6;padding:12px;border:1px solid #ddd;max-width:900px;overflow:auto;margin-top:14px}

  /* steps UI */
  .steps{display:grid;gap:10px;margin:16px 0;max-width:900px}
  .step{padding:12px;border:1px solid #ddd;border-radius:10px;background:#f8fafc}
  .step .hdr{display:flex;align-items:center;gap:10px;margin-bottom:8px}
  .step .num{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;border:1px solid #ccc;font-weight:600}
  .step.wait{background:#f8fafc;border-color:#e2e8f0}
  .step.action{background:#fffaf0;border-color:#dd6b20}
  .step.done{background:#f0fff4;border-color:#38a169}
  .step.done .num{background:#38a169;color:#fff;border-color:#38a169}
  .content{display:grid;gap:8px;margin-left:38px}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
</style>

</head><body>
  <h1>WhatsApp Onboarding</h1>

  <div class="steps" id="steps">

    <!-- STEP 1 -->
    <div id="s1" class="step wait">
      <div class="hdr"><div class="num">1</div><div><b>Connect</b><br><small>Sign in to get a token.</small></div></div>
      <div class="content">
        <div class="row">
          <a class="btn" href="/auth/fb/login">Connect with Facebook</a>
          <small>→ runs OAuth and returns token</small>
        </div>
      </div>
    </div>

    <!-- STEP 2 -->
    <div id="s2" class="step wait">
      <div class="hdr"><div class="num">2</div><div><b>Business</b><br><small>Create/verify your Business.</small></div></div>
      <div class="content">
        <div class="row">
          <input id="token" placeholder="Access token (auto-filled after login)" />
          <button onclick="verify()">Verify Business</button>
          <span id="busy" style="display:none">⏳</span>
        </div>
      </div>
    </div>

    <!-- STEP 3 -->
    <div id="s3" class="step wait">
      <div class="hdr"><div class="num">3</div><div><b>WABA & Phone</b><br><small>Add a WhatsApp account and phone.</small></div></div>
      <div class="content">
        <div class="row">
          <button onclick="onboard()">Onboard</button>
          <input id="phoneId" placeholder="Phone Number ID (auto-filled after Onboard)" />
        </div>
      </div>
    </div>

    <!-- STEP 4 -->
    <div id="s4" class="step wait">
      <div class="hdr"><div class="num">4</div><div><b>Webhooks</b><br><small>Subscribe WABA to this app.</small></div></div>
      <div class="content">
        <div class="row">
          <small>Callback URL must be set in Meta → WhatsApp → Configuration:<br>
          <code>https://YOUR_HOST/webhook</code> with your verify token.</small>
        </div>
      </div>
    </div>

    <!-- STEP 5 -->
    <div id="s5" class="step wait">
      <div class="hdr"><div class="num">5</div><div><b>Send a Test</b><br><small>Use your Phone Number ID and the recipient wa_id.</small></div></div>
      <div class="content">
        <div class="row">
          <input id="to" placeholder="Customer wa_id (e.g. 1XXXXXXXXXX)" />
          <input id="text" placeholder="Message text" />
          <button onclick="sendText()">Send</button>
        </div>
      </div>
    </div>

  </div>

  <pre id="out"></pre>

<script>
const out = (x) => document.getElementById('out').textContent = typeof x==='string'?x:JSON.stringify(x,null,2);

/* STEP WIZARD HELPERS */
function mark(id, state, msg){
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('wait','action','done');
  el.classList.add(state);
  if (msg) {
    const sm = el.querySelector('small'); if (sm) sm.textContent = msg;
  }
}
function updateAfterToken(){ mark('s1','done','Connected. Token received.'); mark('s2','wait','Checking your Business…'); }

function reflectVerify(j){
  if (!j) return;

  // No business yet
  if (j.status === 'no_business' || j.step === 'create_business') {
    mark('s2','action','No Business found. Create it, then Verify again.');

    // Add a button that opens the Meta creation page
    const step = document.getElementById('s2').querySelector('.content');
    step.innerHTML = `
      <div class="row">
        <button onclick="window.open('${j.next_url || 'https://business.facebook.com/overview'}','_blank','noopener')">
          Create Business in Meta
        </button>
        <button onclick="verify()">Verify Again</button>
      </div>
    `;

    mark('s3','wait','Waiting for Business…');
    return;
  }

  // Needs verification
  if ((j.verification_status && j.verification_status !== 'verified') || j.step === 'verify_business') {
    const status = j.verification_status || 'unknown';
    mark('s2','action','Business verification: ' + status + '. Complete it, then Verify again.');

    const step = document.getElementById('s2').querySelector('.content');
    step.innerHTML = `
      <div class="row">
        <button onclick="window.open('${j.next_url || ''}','_blank','noopener')">Open Verification</button>
        <button onclick="verify()">Verify Again</button>
      </div>
    `;

    mark('s3','wait','Waiting for verification…');
    return;
  }

  // Verified
  mark('s2','done','Business verified.');
  // keep default input + button here (no need to override content)
  mark('s3','wait','Looking for WABA & phone…');
}


function reflectOnboard(j){
  if (!j) return;
  if (j.step === 'verify_business') { reflectVerify(j); return; }
  if (j.step === 'create_waba') {
    mark('s3','action','No WhatsApp account/phone. Add a phone in WhatsApp Manager, then Onboard again.');
    return;
  }
  if (j.waba_id) {
    mark('s3','done', j.display_phone_number ? ('Phone: ' + j.display_phone_number) : 'WABA found. Add a phone for inbound.');
    mark('s4','done','Webhooks subscribed.');
    mark('s5','action','Enter wa_id below and send a test.');
  }
}

/* ACTIONS */
async function verify(){
  const token = document.getElementById('token').value.trim();
  if(!token) return out('Missing token');
  document.getElementById('busy').style.display = 'inline';
  try{
    const r = await fetch('/verify-status?token='+encodeURIComponent(token));
    const j = await r.json(); out(j); reflectVerify(j);
  } finally { document.getElementById('busy').style.display = 'none'; }
}

async function onboard(){
  const token = document.getElementById('token').value.trim();
  if(!token) return out('Missing token');
  const r = await fetch('/onboard?token='+encodeURIComponent(token));
  const j = await r.json(); out(j);
  if(j.phone_number_id) document.getElementById('phoneId').value = j.phone_number_id;
  reflectOnboard(j);
}

async function sendText(){
  const token = document.getElementById('token').value.trim();
  const phoneId = document.getElementById('phoneId').value.trim();
  const to = document.getElementById('to').value.trim();
  const text = document.getElementById('text').value.trim();
  if(!token || !phoneId || !to || !text) return out('Missing token/phoneId/to/text');
  const r = await fetch('/send-text', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ token, phone_number_id: phoneId, to, body: text }) });
  out(await r.json());
}

/* Auto-fill token from ?token=... and auto-verify */
function autofill(){
  const t = new URLSearchParams(location.search).get('token');
  if (t) {
    document.getElementById('token').value = t;
    history.replaceState(null, '', location.pathname);
    updateAfterToken();
    verify();
  }
}
window.addEventListener('DOMContentLoaded', autofill);
</script>

</body></html>`);
});



/* ---------- simple logger ---------- */
app.use((req, _res, next) => {
  console.log("REQ", req.method, req.path);
  next();
});

/* ---------- sanity check ---------- */
app.get("/health", (_req,res)=>res.send("OK v10"));

/* ---------- webhook verify/receive ---------- */
app.get("/webhook", (req, res) => {
  const {["hub.mode"]: mode, ["hub.verify_token"]: token, ["hub.challenge"]: challenge} = req.query;
  if (mode === "subscribe" && token === process.env.WH_VERIFY) return res.status(200).send(challenge);
  res.sendStatus(403);
});
app.post("/webhook", (req, res) => {
  console.log("Webhook event:", JSON.stringify(req.body));
  res.sendStatus(200);
});

/* ---------- OAuth: login ---------- */
app.get("/auth/fb/login", (req, res) => {
  const u = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  u.searchParams.set("client_id", process.env.FB_APP_ID);
  u.searchParams.set("redirect_uri", process.env.FB_REDIRECT);
  u.searchParams.set("scope","whatsapp_business_management,whatsapp_business_messaging,business_management");
  u.searchParams.set("state", "abc123");
  res.redirect(u.toString());
});

/* ---------- OAuth: callback ---------- */
app.get("/auth/fb/callback", (req, res) => {
  console.log("FB CALLBACK:", req.query);  // { code, state }
  const { code } = req.query;
  if (!code) return res.status(400).send("No code received");
  res.redirect("/auth/fb/token?code=" + encodeURIComponent(code));
});

/* ---------- OAuth: exchange code -> long-lived token ---------- */
app.get("/auth/fb/token", async (req, res) => {
  try {
    const { code } = req.query;

    // short-lived
    const r1 = await axios.get("https://graph.facebook.com/v21.0/oauth/access_token", {
      params: {
        client_id: process.env.FB_APP_ID,
        client_secret: process.env.FB_APP_SECRET,
        redirect_uri: process.env.FB_REDIRECT,
        code,
      },
    });

    // long-lived
    const r2 = await axios.get("https://graph.facebook.com/v21.0/oauth/access_token", {
      params: {
        grant_type: "fb_exchange_token",
        client_id: process.env.FB_APP_ID,
        client_secret: process.env.FB_APP_SECRET,
        fb_exchange_token: r1.data.access_token,
      },
    });

    // ✅ redirect back to home with token
    res.redirect(`/?token=${encodeURIComponent(r2.data.access_token)}`);
  } catch (e) {
    console.error("TOKEN ERROR:", e.response?.data || e.message);
    res.status(500).send("Error exchanging token");
  }
});


/* ---------- Graph helpers ---------- */
async function gfetch(path, token) {
  const url = `https://graph.facebook.com/v21.0/${path}`;
  try {
    const r = await axios.get(url, { params: { access_token: token } });
    return r.data;
  } catch (e) {
    const err = e.response?.data?.error || e.message;
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
}

// Resolve first business for the logged-in user
async function getBusiness(token) {
  const me = await gfetch("me?fields=businesses{id,name}", token);
  const biz = me.businesses?.data?.[0] || null;
  return biz; // { id, name } or null
}

/* ---------- verify-status ---------- */
// GET /verify-status?token=...
app.get("/verify-status", async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(400).send("Missing token");

    const biz = await getBusiness(token);
    if (!biz) {
      return res.json({
        status: "no_business",
        action: "create_business",
        next_url: "https://business.facebook.com/overview",
        note: "User has no Business yet. Create one first."
      });
    }

    const info = await gfetch(`${biz.id}?fields=verification_status`, token);
    const status = info.verification_status || "unknown";
    const securityCenter = `https://business.facebook.com/settings/security?business_id=${biz.id}`;

    res.json({
      business_id: biz.id,
      business_name: biz.name,
      verification_status: status, // verified | unverified | pending | rejected | in_review | unknown
      is_ready: status === "verified",
      next_url: status === "verified" ? null : securityCenter,
      message: status === "verified"
        ? "Business is verified. You can proceed to WhatsApp onboarding."
        : "Business not verified. Complete verification at next_url."
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Failed to check verification");
  }
});

/* ---------- onboard (discover + subscribe) ---------- */
// GET /onboard?token=...
app.get("/onboard", async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(400).send("Missing token");

    // 1) Business
    const biz = await getBusiness(token);
    if (!biz) {
      return res.json({
        step: "create_business",
        message: "User has no Business. Create one first.",
        next_url: "https://business.facebook.com/overview"
      });
    }

    // 2) Verification check
    const info = await gfetch(`${biz.id}?fields=verification_status`, token);
    if (info.verification_status !== "verified") {
      return res.json({
        step: "verify_business",
        business_id: biz.id,
        verification_status: info.verification_status,
        next_url: `https://business.facebook.com/settings/security?business_id=${biz.id}`,
        note: "Complete Business Verification, then run Onboard again."
      });
    }

    // 3) WABA
    const wabas = await gfetch(`${biz.id}/owned_whatsapp_business_accounts?fields=id,name`, token);
    const waba = wabas?.data?.[0];
    if (!waba) {
      return res.json({
        step: "create_waba",
        message: "No WABA found. Use Embedded Signup or WhatsApp Manager to create one.",
        next_url: "https://business.facebook.com/wa/manage/phone_numbers"
      });
    }

    // 4) Phone(s)
    const phones = await gfetch(`${waba.id}/phone_numbers?fields=id,display_phone_number,verified_name`, token);
    const phone = phones?.data?.[0] || null;

    // 5) Subscribe your app to this WABA
    await axios.post(`https://graph.facebook.com/v21.0/${waba.id}/subscribed_apps`, null, {
      headers: { Authorization: `Bearer ${token}` }
    });

    res.json({
      business_id: biz.id,
      business_name: biz.name,
      waba_id: waba.id,
      waba_name: waba.name,
      phone_number_id: phone?.id || null,
      display_phone_number: phone?.display_phone_number || null,
      note: phone ? "Ready for inbound. Set webhook in Meta → WhatsApp → Configuration."
                  : "No phone yet — add one in WhatsApp Manager."
    });
  } catch (e) {
    console.error("ONBOARD ERROR:", e.message);
    res.status(500).send("Onboarding failed");
  }
});

/* ---------- send-text (test message) ---------- */
// POST { token, phone_number_id, to, body }
app.post("/send-text", async (req, res) => {
  try {
    const { token, phone_number_id, to, body } = req.body || {};
    if (!token || !phone_number_id || !to || !body) {
      return res.status(400).json({ error: "Missing token/phone_number_id/to/body" });
    }
    const url = `https://graph.facebook.com/v21.0/${phone_number_id}/messages`;
    const r = await axios.post(url, {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body }
    }, { headers: { Authorization: `Bearer ${token}` }});
    res.json(r.data);
  } catch (e) {
    console.error("SEND ERROR:", e.response?.data || e.message);
    res.status(500).json({ error: "send failed", details: e.response?.data || e.message });
  }
});

/* ---------- start server ---------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log("Listening on " + PORT));

app.get("/privacy", (_req,res)=>res.type("html").send("<h1>Privacy Policy</h1><p>We only use your Facebook/WhatsApp data to connect your WABA and send/receive messages at your request. Contact: support@yourdomain.com</p>"));

app.get("/data-deletion", (_req,res)=>res.type("html").send("<h1>Data Deletion</h1><p>To delete your data, email support@yourdomain.com from the account used. We will remove stored tokens/IDs within 48 hours.</p>"));

