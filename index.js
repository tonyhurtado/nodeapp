import express from "express";
import axios from "axios";

const app = express();

/* ---- debug logger (see paths in logs) ---- */
app.use((req, _res, next) => {
  console.log("REQ", req.method, req.path);
  next();
});

/* ---- sanity check ---- */
app.get("/", (_req,res)=>res.send("OK v5"));

/* ---- webhook verify/receive ---- */
app.get("/webhook", (req, res) => {
  res.send(req.query["hub.challenge"] || "OK");
});
app.post("/webhook", express.json(), (req, res) => {
  console.log("Webhook event:", req.body);
  res.sendStatus(200);
});

/* ---- OAuth callback (shows code) ---- */
app.get("/auth/fb/callback", (req, res) => {
  res.send("Callback OK ✔ " + JSON.stringify(req.query));
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
