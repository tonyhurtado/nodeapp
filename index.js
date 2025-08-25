import express from "express";
import axios from "axios";

const app = express();

// Debug: check if env vars are loaded
console.log("FB_APP_ID:", process.env.FB_APP_ID);
console.log("FB_REDIRECT:", process.env.FB_REDIRECT);

/* ---- debug logger (see paths in logs) ---- */
app.use((req, _res, next) => {
  console.log("REQ", req.method, req.path);
  next();
});

/* ---- sanity check ---- */
app.get("/", (_req,res)=>res.send("OK v9"));

/* ---- webhook verify/receive ---- */
app.get("/webhook", (req, res) => {
  const {["hub.mode"]: mode, ["hub.verify_token"]: token, ["hub.challenge"]: challenge} = req.query;
  if (mode === "subscribe" && token === process.env.WH_VERIFY) return res.status(200).send(challenge);
  res.sendStatus(403);
});

app.post("/webhook", express.json(), (req, res) => {
  console.log("Webhook event:", req.body);
  res.sendStatus(200);
});

/* ---- OAuth callback (shows code) ---- */
app.get("/auth/fb/callback", (req, res) => {
  console.log("FB CALLBACK:", req.query);  // should log { code, state }
  const { code } = req.query;
  if (!code) return res.status(400).send("No code received");
  // forward to the token-exchange endpoint you already have
  res.redirect("/auth/fb/token?code=" + encodeURIComponent(code));
});


/* ---- FB login (redirect to Facebook) ---- */
app.get("/auth/fb/login", (req, res) => {
  const u = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  u.searchParams.set("client_id", process.env.FB_APP_ID);
  u.searchParams.set("redirect_uri", process.env.FB_REDIRECT);
  u.searchParams.set(
    "scope",
    "whatsapp_business_management,whatsapp_business_messaging,business_management"
  );
  u.searchParams.set("state", "abc123");
  res.redirect(u.toString());
});

/* ---- exchange code -> long-lived token ---- */
app.get("/auth/fb/token", async (req, res) => {
  try {
    const { code } = req.query;
    const r1 = await axios.get(
      "https://graph.facebook.com/v21.0/oauth/access_token",
      {
        params: {
          client_id: process.env.FB_APP_ID,
          client_secret: process.env.FB_APP_SECRET,
          redirect_uri: process.env.FB_REDIRECT,
          code,
        },
      }
    );
    const r2 = await axios.get(
      "https://graph.facebook.com/v21.0/oauth/access_token",
      {
        params: {
          grant_type: "fb_exchange_token",
          client_id: process.env.FB_APP_ID,
          client_secret: process.env.FB_APP_SECRET,
          fb_exchange_token: r1.data.access_token,
        },
      }
    );
    res.json(r2.data);
  } catch (e) {
    console.error("TOKEN ERROR:", e.response?.data || e.message);
    res.status(500).send("Error exchanging token");
  }
});

/* ---- auth debug helpers ---- */
app.get("/auth/ping", (_req, res) => res.send("AUTH PING"));
app.get("/auth/*", (req, res) => res.send("AUTH CATCH " + req.path));

/* ---- start server ---- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log("Listening on " + PORT));

async function gfetch(path, token) {
  const r = await fetch(`https://graph.facebook.com/v21.0/${path}${path.includes("?")?"&":"?"}access_token=${token}`);
  const j = await r.json();
  if (j.error) throw new Error(`${j.error.message}`);
  return j;
}

// Resolve first business for the logged-in user
async function getBusiness(token) {
  const me = await gfetch("me?fields=businesses{id,name}", token);
  const biz = me.businesses?.data?.[0] || null;
  return biz; // { id, name } or null
}

// GET /verify-status?token=...   (token = user access token you already obtained)
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
        note: "User has no Business yet. Send them to create one."
      });
    }

    const info = await gfetch(`${biz.id}?fields=verification_status`, token);
    const status = info.verification_status || "unknown";

    // Direct link to Meta’s Security Center for this Business
    const securityCenter = `https://business.facebook.com/settings/security?business_id=${biz.id}`;

    res.json({
      business_id: biz.id,
      business_name: biz.name,
      verification_status: status,              // verified | unverified | pending | rejected | in_review | unknown
      is_ready: status === "verified",
      next_url: status === "verified" ? null : securityCenter,
      message:
        status === "verified"
          ? "Business is verified. You can proceed to WhatsApp onboarding."
          : "Business is not verified. Ask the user to complete verification at the link in next_url."
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Failed to check verification");
  }
});

