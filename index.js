import express from "express";
import axios from "axios";

const app = express();

// --- sanity check route ---
app.get("/", (_, res) => res.send("OK"));

// --- callback route ---
app.get("/auth/fb/callback", (req, res) => {
  res.send("Callback OK ✔ " + JSON.stringify(req.query));
});

// --- webhook routes ---
app.get("/webhook", (req, res) => {
  res.send(req.query["hub.challenge"] || "OK");
});

app.post("/webhook", express.json(), (req, res) => {
  console.log("Webhook event:", req.body);
  res.sendStatus(200);
});

// --- login route ---
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

// --- token exchange route ---
app.get("/auth/fb/token", async (req, res) => {
  try {
    const { code } = req.query;
    // short-lived token
    const r1 = await axios.get(
      "https://graph.facebook.com/v21.
