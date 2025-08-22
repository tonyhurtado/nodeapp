import express from "express";
const app = express();

app.get("/auth/fb/callback",(req,res)=>res.send("Callback OK ✔"));
app.get("/webhook",(req,res)=>res.send(req.query["hub.challenge"]||"OK"));
app.post("/webhook",express.json(),(req,res)=>{console.log(req.body);res.sendStatus(200);});

app.listen(3000,()=>console.log("Listening on 3000"));
