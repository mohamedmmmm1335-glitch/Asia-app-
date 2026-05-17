const express      = require("express");
const cors         = require("cors");
const jwt          = require("jsonwebtoken");
const multer       = require("multer");
const cloudinary   = require("cloudinary").v2;
const nodemailer   = require("nodemailer");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore }        = require("firebase-admin/firestore");

// =====================================================
// 📧 EMAIL TRANSPORTER
// =====================================================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

// حفظ الكودات مؤقتاً في الذاكرة
const verificationCodes = new Map(); // email -> { code, expires }

// =====================================================
// 🔧 CONFIG
// =====================================================
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const JWT_SECRET     = process.env.JWT_SECRET     || "change_this_secret";
const PORT           = process.env.PORT            || 3000;

// =====================================================
// ☁️ CLOUDINARY CONFIG
// =====================================================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({ storage: multer.memoryStorage() });

// =====================================================
// 🔥 FIREBASE ADMIN INIT
// =====================================================
initializeApp({
  credential: cert({
    projectId:    process.env.FIREBASE_PROJECT_ID,
    clientEmail:  process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:   process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }),
});
const db = getFirestore();

// =====================================================
// 🚀 EXPRESS SETUP
// =====================================================
const app = express();
app.use(cors());
app.use(express.json());

// =====================================================
// 🔐 MIDDLEWARE
// =====================================================
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "غير مصرح" });
  }
  try {
    const token = header.split(" ")[1];
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "توكن منتهي أو غير صحيح" });
  }
}

// =====================================================
// 🔑 AUTH ROUTES
// =====================================================
app.post("/api/admin/verify", (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: "كلمة السر غير صحيحة" });
  }
  const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "8h" });
  res.json({ success: true, token });
});

app.get("/api/admin/me", authMiddleware, (req, res) => {
  res.json({ success: true, role: "admin" });
});

// =====================================================
// 🖼️ IMAGE UPLOAD - Cloudinary (أدمن فقط)
// =====================================================
app.post("/api/upload", authMiddleware, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "لم يتم رفع أي صورة" });

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "digital-menu", resource_type: "image" },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    res.json({ success: true, url: result.secure_url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =====================================================
// 🍔 MENU ROUTES
// =====================================================
app.get("/api/menu", async (req, res) => {
  try {
    const snap  = await db.collection("menuItems").get();
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/menu", authMiddleware, async (req, res) => {
  try {
    const { name, price, description, imageUrl, categoryId, available } = req.body;
    if (!name || !price || !categoryId) {
      return res.status(400).json({ error: "name و price و categoryId مطلوبين" });
    }
    const ref = await db.collection("menuItems").add({
      name,
      price:       parseFloat(price),
      description: description || "",
      imageUrl:    imageUrl    || "",
      categoryId,
      available:   available !== false,
      createdAt:   new Date(),
    });
    res.json({ success: true, id: ref.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/menu/:id", authMiddleware, async (req, res) => {
  try {
    const { name, price, description, imageUrl, categoryId, available } = req.body;
    const updates = {};
    if (name        !== undefined) updates.name        = name;
    if (price       !== undefined) updates.price       = parseFloat(price);
    if (description !== undefined) updates.description = description;
    if (imageUrl    !== undefined) updates.imageUrl    = imageUrl;
    if (categoryId  !== undefined) updates.categoryId  = categoryId;
    if (available   !== undefined) updates.available   = available;
    updates.updatedAt = new Date();

    await db.collection("menuItems").doc(req.params.id).update(updates);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/menu/:id", authMiddleware, async (req, res) => {
  try {
    await db.collection("menuItems").doc(req.params.id).delete();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =====================================================
// 📋 CATEGORIES ROUTES
// =====================================================
app.get("/api/categories", async (req, res) => {
  try {
    const snap = await db.collection("categories").orderBy("order").get();
    const cats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(cats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/categories", authMiddleware, async (req, res) => {
  try {
    const { name, order } = req.body;
    if (!name) return res.status(400).json({ error: "name مطلوب" });
    const ref = await db.collection("categories").add({ name, order: order || 99 });
    res.json({ success: true, id: ref.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =====================================================
// 📦 ORDERS ROUTES
// =====================================================
app.get("/api/orders", authMiddleware, async (req, res) => {
  try {
    const snap   = await db.collection("orders").orderBy("createdAt", "desc").get();
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(orders);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch("/api/orders/:id", authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["pending", "preparing", "done"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "status غير صحيح" });
    }
    await db.collection("orders").doc(req.params.id).update({ status });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =====================================================
// 📧 OTP - إرسال كود التفعيل
// =====================================================
app.post("/api/auth/send-otp", async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ error: "email مطلوب" });

    // كود 6 أرقام عشوائي
    const code    = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 10 * 60 * 1000; // 10 دقايق

    verificationCodes.set(email, { code, expires });

    await transporter.sendMail({
      from: `"مطعم آسيا 🍽️" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "كود تفعيل حسابك - مطعم آسيا",
      html: `
        <div style="font-family:Arial,sans-serif;direction:rtl;text-align:center;padding:30px;background:#0f0e0c;color:#f0ead8;">
          <img src="https://raw.githubusercontent.com/mohamedmmmm1335-glitch/Asia-app-/main/logo.png" width="80" style="border-radius:50%;margin-bottom:16px;"/>
          <h2 style="color:#c9a84c;margin-bottom:8px;">مرحباً ${name || ""} 👋</h2>
          <p style="color:#8c8070;margin-bottom:24px;">كود تفعيل حسابك في مطعم آسيا</p>
          <div style="background:#1a1814;border:2px solid #c9a84c;border-radius:16px;padding:24px;margin:0 auto;max-width:200px;">
            <div style="font-size:36px;font-weight:900;color:#e8c97e;letter-spacing:8px;">${code}</div>
          </div>
          <p style="color:#8c8070;margin-top:20px;font-size:13px;">الكود صالح لمدة 10 دقائق فقط</p>
          <p style="color:#8c8070;font-size:12px;">لو مش أنت اللي طلبت ده، تجاهل الرسالة</p>
        </div>
      `
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/verify-otp - التحقق من الكود
app.post("/api/auth/verify-otp", async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: "email و code مطلوبين" });

    const stored = verificationCodes.get(email);
    if (!stored) return res.status(400).json({ success: false, error: "الكود منتهي أو غير موجود" });
    if (Date.now() > stored.expires) {
      verificationCodes.delete(email);
      return res.status(400).json({ success: false, error: "الكود انتهت صلاحيته" });
    }
    if (stored.code !== code.toString()) {
      return res.status(400).json({ success: false, error: "الكود غلط" });
    }

    verificationCodes.delete(email);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// =====================================================
// ✅ HEALTH CHECK
// =====================================================
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Digital Menu API running 🚀" });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

// =====================================================
// 🔔 PUSH NOTIFICATIONS - FCM
// =====================================================

// إرسال إشعار لزبون معين
app.post("/api/notify/customer", authMiddleware, async (req, res) => {
  try {
    const { token, title, body } = req.body;
    if (!token) return res.status(400).json({ error: "token مطلوب" });

    const message = {
      notification: { title, body },
      token,
      android: { notification: { sound: "default", priority: "high" } },
      apns: { payload: { aps: { sound: "default" } } },
      webpush: {
        notification: { icon: "https://raw.githubusercontent.com/mohamedmmmm1335-glitch/Asia-app-/main/logo.png", dir: "rtl", lang: "ar", vibrate: [200, 100, 200] }
      }
    };

    const { getMessaging } = require("firebase-admin/messaging");
    await getMessaging().send(message);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// إرسال إشعار للأدمن (كل التوكنات من نوع admin)
app.post("/api/notify/admin", async (req, res) => {
  try {
    const snap = await db.collection("fcmTokens")
      .where("type", "==", "admin").get();

    if (snap.empty) return res.json({ success: true, sent: 0 });

    const { getMessaging } = require("firebase-admin/messaging");
    const tokens = snap.docs.map(d => d.data().token);

    await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title: req.body.title || "طلب جديد 🔔", body: req.body.body || "وصل طلب جديد!" },
      webpush: {
        notification: { icon: "https://raw.githubusercontent.com/mohamedmmmm1335-glitch/Asia-app-/main/logo.png", dir: "rtl" }
      }
    });

    res.json({ success: true, sent: tokens.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
