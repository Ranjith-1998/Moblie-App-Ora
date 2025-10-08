require("dotenv").config();
const express = require("express");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const oracledb = require("oracledb"); // ✅ Fixed: Import oracledb
const { connectDB, getConnection } = require("./db");

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const PORT = process.env.PORT || 5000;
const bcrypt = require("bcryptjs");

app.use(express.json());

// ✅ CORS configuration for Expo Android
app.use(
  cors({
    origin: [
      "http://localhost:8081",     // web dev
      "exp://127.0.0.1:19000",     // Expo dev URL
      "http://10.0.2.2:5000",      // Android emulator
      "http://192.168.1.5:19000",  // replace with your laptop IP
    ],
    credentials: true,
  })
);

// ✅ Connect to Oracle DB once
connectDB();

// ---------------- TEST ROUTE ----------------
app.get("/", (req, res) => {
  res.json({ status: "Backend is running" });
});

// ---------------- REGISTER ----------------
app.post("/api/register", async (req, res) => {
  try {
    const { userid, email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const conn = await getConnection();

    // Check if user already exists
    const result = await conn.execute(
      "SELECT * FROM USERBASIC WHERE EMAIL = :email",
      { email },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (result.rows.length > 0) {
      await conn.close();
      return res.status(400).json({ error: "User already exists" });
    }

    // 🔒 Hash the password before storing
    const salt = await bcrypt.genSalt(10);  // 10 rounds is safe default
    const hashedPassword = await bcrypt.hash(password, salt);

    // Insert new user
    await conn.execute(
      "INSERT INTO USERBASIC (USERID, EMAIL, PASSWORD) VALUES (:userid, :email, :password)",
      { userid, email, password: hashedPassword },
      { autoCommit: true }
    );

    await conn.close();
    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    console.error("Register error:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ---------------- LOGIN ----------------
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const conn = await getConnection();

    const result = await conn.execute(
      "SELECT * FROM USERBASIC WHERE EMAIL = :email",
      { email },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    await conn.close();

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Invalid Username" });
    }

    const user = result.rows[0];

    // 🔒 Compare entered password with stored hash
    const isMatch = await bcrypt.compare(password, user.PASSWORD);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid Password" });
    }

    // ✅ Generate JWT
    const token = jwt.sign(
      { userId: user.USERID, email: user.EMAIL },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({
      success: true,
      token,
      user: {
        userid: user.USERID,
        email: user.EMAIL,
      },
    });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ---------------- SAVE ----------------
app.post("/api/save", async (req, res) => {
  try {
    const { table, data } = req.body;
    if (!table || !data) {
      return res.status(400).json({ error: "Table name and data required" });
    }

    const authHeader = req.headers["authorization"];
    if (!authHeader) return res.status(401).json({ error: "Missing token" });
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const conn = await getConnection();

    const columns = Object.keys(data);
    const values = columns.map((c) => `:${c}`).join(", ");
    const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values})`;

    await conn.execute(sql, data, { autoCommit: true });
    await conn.close();

    res.status(201).json({ message: "Row inserted successfully" });
  } catch (err) {
    console.error("Save API error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------- READ ----------------
app.post("/api/read", async (req, res) => {
  try {
    const { table, filter } = req.body;
    if (!table) return res.status(400).json({ error: "Table required" });

    const conn = await getConnection();

    let sql = `SELECT * FROM ${table}`;
    let binds = {};

    if (filter && Object.keys(filter).length > 0) {
      const where = Object.keys(filter)
        .map((k) => `${k} = :${k}`)
        .join(" AND ");
      sql += ` WHERE ${where}`;
      binds = filter;
    }

    const result = await conn.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
    });

    await conn.close();
    res.json(result.rows);
  } catch (err) {
    console.error("Read error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------- START SERVER ----------------
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
