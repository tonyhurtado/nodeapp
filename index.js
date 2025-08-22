import express from "express";
const app = express();

app.get("/auth/fb/callback", (req, res) => res.send("Callback OK ✔"));
app.get("/webhook", (req, res) => res.send(req.query["hub.challenge"] || "OK"));
app.post("/webhook", express.json(), (req, res) => {
  console.log(req.body);
  res.sendStatus(200);
});

// ✅ use the platform-assigned port
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log("Listening on " + PORT));
