const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { sendEmail } = require("./email");
const crypto = require("crypto");
const fetch = require("node-fetch");

require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

let transactions = {}; // merchantOrderId -> {email, amount, status}

// Endpoint kirim OTP
app.post("/send-otp", async (req,res)=>{
  const { email, otp } = req.body;
  if(!email || !otp) return res.status(400).json({ error:"Email & OTP wajib" });

  try {
    await sendEmail(email, "Kode OTP Anda", `<p>Kode OTP Anda: <b>${otp}</b></p>`);
    res.json({ success:true });
  } catch(err){
    res.status(500).json({ error:"Gagal kirim OTP" });
  }
});

// Generate QRIS
app.post("/generate-qris", async (req,res)=>{
  const { amount, email } = req.body;
  if(!amount || !email) return res.status(400).json({ error:"Amount & email wajib" });

  const merchantCode = process.env.DUITKU_MERCHANT_CODE;
  const apiKey = process.env.DUITKU_API_KEY;
  const paymentAmount = amount;
  const merchantOrderId = "INV"+Date.now();

  const signature = crypto.createHash("sha256")
                          .update(`${merchantCode}${merchantOrderId}${paymentAmount}${apiKey}`)
                          .digest("hex");

  const data = {
    merchantCode,
    paymentAmount,
    merchantOrderId,
    productDetails: "Deposit Saldo",
    email,
    signature,
    paymentMethod: "QRIS"
  };

  try{
    const response = await fetch("https://sandbox.duitku.com/webapi/api/merchant/v2/inquiry", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if(result.success){
      transactions[merchantOrderId] = { email, amount, status:"pending" };
      res.json({ success:true, qrUrl: result.qrisUrl || result.paymentUrl, merchantOrderId });
    } else {
      res.json({ success:false, error: result.errorMessage || "Gagal generate QRIS" });
    }
  } catch(err){
    console.error(err);
    res.status(500).json({ error:"Gagal generate QRIS" });
  }
});

// Cek status pembayaran
app.post("/check-payment", async (req,res)=>{
  const { merchantOrderId } = req.body;
  if(!merchantOrderId || !transactions[merchantOrderId])
    return res.status(400).json({ error:"Transaksi tidak ditemukan" });

  const txn = transactions[merchantOrderId];
  const merchantCode = process.env.DUITKU_MERCHANT_CODE;
  const apiKey = process.env.DUITKU_API_KEY;
  const signature = crypto.createHash("sha256")
                          .update(`${merchantCode}${merchantOrderId}${apiKey}`)
                          .digest("hex");

  try{
    const response = await fetch("https://sandbox.duitku.com/webapi/api/merchant/v2/paymentStatus", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ merchantCode, merchantOrderId, signature })
    });
    const result = await response.json();

    if(result.paymentStatus === "SUCCESS" && txn.status==="pending"){
      txn.status = "success";
      res.json({ success:true, message:"Pembayaran sukses" });
    } else {
      res.json({ success:false, status:txn.status });
    }
  } catch(err){
    console.error(err);
    res.status(500).json({ error:"Gagal cek status pembayaran" });
  }
});

app.listen(PORT, ()=>console.log(`Server running on http://localhost:${PORT}`));