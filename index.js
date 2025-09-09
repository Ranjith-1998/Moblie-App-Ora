// index.js
require("dotenv").config();
const express = require("express");
const pool = require("./db"); // PostgreSQL pool
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const app = express();

// Middlewares
app.use(
  cors({
    origin: "http://localhost:3000", // frontend origin
    credentials: true, // ✅ allow cookies
  })
);
app.use(express.json());
app.use(cookieParser());

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

// ---------------- REGISTER ----------------
app.post("/api/register", async (req, res) => {
  try {
    const { email, password, firstname, lastname } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password required" });

    const { rows: existing } = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );
    if (existing.length)
      return res.status(400).json({ error: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password, firstname, lastname)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, firstname, lastname, created_on`,
      [email, hashed, firstname || null, lastname || null]
    );

    res.status(201).json({ user: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------------- LOGIN ----------------
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password required" });

    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    if (!rows.length) return res.status(400).json({ error: "Invalid credentials" });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: "Invalid credentials" });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "1h" });

    // ✅ Set cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", // true in production
      sameSite: "strict",
      maxAge: 60 * 60 * 1000, // 1 hour
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------------- LOGOUT ----------------
app.post("/api/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
});

// ---------------- AUTH Middleware ----------------
function authenticate(req, res, next) {
  const token = req.cookies.token; // ✅ from cookie
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ---------------- PROTECTED ROUTE ----------------
app.get("/api/me", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, email, firstname, lastname, created_on FROM users WHERE id = $1",
      [req.user.userId]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------------- COMMON SAVE API ----------------
const allowedTables = ["users", "employees", "customers","jobasic"]; // whitelist tables

app.post("/api/save", async (req, res) => {
  try {
    const { table, data } = req.body;

    if (!table || !data || Object.keys(data).length === 0) {
      return res.status(400).json({ error: "Table name and data are required" });
    }

    if (!allowedTables.includes(table)) {
      return res.status(400).json({ error: "Invalid table name" });
    }

    const columns = Object.keys(data).join(", ");
    const values = Object.values(data);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");

    const query = `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING *`;
    const result = await pool.query(query, values);

    res.status(201).json({
      message: "Data inserted successfully",
      data: result.rows[0],
    });
  } catch (err) {
    console.error("Error inserting data:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
