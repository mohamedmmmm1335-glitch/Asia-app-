const express    = require("express");
const cors       = require("cors");
const jwt        = require("jsonwebtoken");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore }        = require("firebase-admin/firestore");

// =====================================================
// 🔧 CONFIG - غيّر القيم دي في Railway Environment Variables
// =====================================================
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const JWT_SECRET     = process.env.JWT_SECRET     || "change_this_secret";
const PORT           = process.env.PORT            || 3000;

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
// 🔐 MIDDLEWARE - التحقق من الـ JWT Token
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

// POST /api/admin/verify - التحقق من كلمة السر
app.post("/api/admin/verify", (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: "كلمة السر غير صحيحة" });
  }
  const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "8h" });
  res.json({ success: true, token });
});

// GET /api/admin/me - التحقق من صلاحية التوكن
app.get("/api/admin/me", authMiddleware, (req, res) => {
  res.json({ success: true, role: "admin" });
});

// =====================================================
// 🍔 MENU ROUTES (محمية بالـ Auth)
// =====================================================

// GET /api/menu - جلب كل الأصناف
app.get("/api/menu", async (req, res) => {
  try {
    const snap  = await db.collection("menuItems").get();
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/menu - إضافة صنف جديد (أدمن فقط)
app.post("/api/menu", authMiddleware, async (req, res) => {
  try {
    const { name, price, description, imageUrl, categoryId, available } = req.body;
    if (!name || !price || !categoryId) {
      return res.status(400).json({ error: "name و price و categoryId مطلوبين" });
    }
    const ref = await db.collection("menuItems").add({
      name,
      price: parseFloat(price),
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

// PUT /api/menu/:id - تعديل صنف (أدمن فقط)
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

// DELETE /api/menu/:id - حذف صنف (أدمن فقط)
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

// GET /api/categories
app.get("/api/categories", async (req, res) => {
  try {
    const snap = await db.collection("categories").orderBy("order").get();
    const cats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(cats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/categories (أدمن فقط)
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

// GET /api/orders (أدمن فقط)
app.get("/api/orders", authMiddleware, async (req, res) => {
  try {
    const snap   = await db.collection("orders").orderBy("createdAt", "desc").get();
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(orders);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/orders/:id - تحديث حالة الطلب (أدمن فقط)
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
// ✅ HEALTH CHECK
// =====================================================
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Digital Menu API running 🚀" });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
