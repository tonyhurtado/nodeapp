import express from "express";
import axios from "axios";

const app = express();

// --- routes ---
app.get("/auth/fb/callback",(req,res)=>res.send("Callback OK ✔"));

app.get("/webhook",(req,res)=>res.send(req.query["hub.challenge"]||"OK"));

app.post("/webhook",express.json(),(req,res)=>{
  console.log(req.body);
  res.sendStatus(200);
});

app.get("/auth/fb/login",(req,res)=>{
  const u=new URL("https://www.facebook.com/v21.0/dialog/oauth");
  u.searchParams.set("client_id",process.env.FB_APP_ID);
  u.searchParams.set("redirect_uri",process.env.FB_REDIRECT);
  u.searchParams.set("scope","whatsapp_business_management,whatsapp_business_messaging,business_management");
  u.searchParams.set("state","abc123");
  res.redirect(u.toString());
});

app.get("/auth/fb/token", async (req,res)=>{
  const {code}=req.query;
  const r1=await axios.get("https://graph.facebook.com/v21.0/oauth/access_token",{params:{
    client_id:process.env.FB_APP_ID,
    client_secret:process.env.FB_APP_SECRET,
    redirect_uri:process.env.FB_REDIRECT,
    code}});
  const r2=await axios.get("https://graph.facebook.com/v21.0/oauth/access_token",{params:{
    grant_type:"fb_exchange_token",
    client_id:process.env.FB_APP_ID,
    client_secret:process.env.FB_APP_SECRET,
    fb_exchange_token:r1.data.access_token}});
  res.json(r2.data);
});

// --- start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT,"0.0.0.0",()=>console.log("Listening on "+PORT));
