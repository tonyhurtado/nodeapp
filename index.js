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
  .row{margin:10px 0}
  input{padding:8px;width:360px}
  button,a.btn{padding:10px 14px;margin-left:6px;cursor:pointer}
  pre{background:#f6f6f6;padding:12px;border:1px solid #ddd;max-width:820px;overflow:auto}
</style>
</head><body>
  <h1>WhatsApp Onboarding</h1>

  <div class="row">
    <a class="btn" href="/auth/fb/login">Connect with Facebook</a>
    <small>→ runs OAuth and returns access token JSON</small>
  </div>

  <div class="row">
    <input id="token" placeholder="Paste access token here" />
    <button onclick="verify()">Verify Business</button>
    <button onclick="onboard()">Onboard</button>
  </div>

  <h3>Send test WhatsApp message</h3>
  <div class="row">
    <input id="phoneId" placeholder="Phone Number ID (auto-filled after Onboard)" />
  </div>
  <div class="row">
    <input id="to" placeholder="Customer wa_id (e.g. 1XXXXXXXXXX)" />
  </div>
  <div class="row">
    <input id="text" placeholder="Message text" />
    <button onclick="sendText()">Send</button>
  </div>

  <pre id="out"></pre>

<script>
const out = (x) => document.getElementById('out').textContent = typeof x==='string'?x:JSON.stringify(x,null,2);

async function verify(){
  const token = document.getElementById('token').value.trim();
  if(!token) return out("Missing token");
  const r = await fetch('/verify-status?token='+encodeURIComponent(token));
  out(await r.json());
}

async function onboard(){
  const token = document.getElementById('token').value.trim();
  if(!token) return out("Missing token");
  const r = await fetch('/onboard?token='+encodeURIComponent(token));
  const j = await r.json();
  out(j);
  if(j.phone_number_id) document.getElementById('phoneId').value = j.phone_number_id;
}

async function sendText(){
  const token = document.getElementById('token').value.trim();
  const phoneId = document.getElementById('phoneId').value.trim();
  const to = document.getElementById('to').value.trim();
  const text = document.getElementById('text').value.trim();
  if(!token || !phoneId || !to || !text) return out("Missing token/phoneId/to/text");
  const r = await fetch('/send-text', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ token, phone_number_id: phoneId, to, body: text })
  });
  out(await r.json());
}

/* ---------- NEW: autofill token from ?token=... and auto-verify ---------- */
function autofill(){
  const t = new URLSearchParams(location.search).get('token');
  if (t) {
    document.getElementById('token').value = t;
    // clean the URL (no query string)
    history.replaceState(null, '', location.pathname);
    // auto-run verify
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

