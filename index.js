import express from "express";
const app = express();

// existing routes
app.get("/auth/fb/callback",(req,res)=>res.send("Callback OK ✔"));
app.get("/webhook",(req,res)=>res.send(req.query["hub.challenge"]||"OK"));
app.post("/webhook",express.json(),(req,res)=>{console.log(req.body);res.sendStatus(200);});

// new login route
app.get("/auth/fb/login",(req,res)=>{
  const u=new URL("https://www.facebook.com/v21.0/dialog/oauth");
  u.searchParams.set("client_id",process.env.FB_APP_ID);
  u.searchParams.set("redirect_uri",process.env.FB_REDIRECT);
  u.searchParams.set("scope","whatsapp_business_management,whatsapp_business_messaging,business_management");
  u.searchParams.set("state","abc123");
  res.redirect(u.toString());
});

// listen
const PORT = process.env.PORT || 3000;
app.listen(PORT,"0.0.0.0",()=>console.log("Listening on "+PORT));
