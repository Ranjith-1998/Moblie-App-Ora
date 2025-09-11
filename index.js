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

// ---------------- CREATE TABLE API ----------------
app.post("/api/create-table", async (req, res) => {
  try {
    const {eform_name, table, fields } = req.body;

    if (!table || !fields || typeof fields !== "object") {
      return res.status(400).json({ error: "Table name and fields are required" });
    }

    // Ensure safe table name (only lowercase letters, numbers, underscores)
    const safeTable = table.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!safeTable) return res.status(400).json({ error: "Invalid table name" });

    // Build field definitions
    const columns = [];
    for (const [col, type] of Object.entries(fields)) {
      // Whitelist supported types
      const allowedTypes = ["text", "integer", "numeric", "date", "timestamp", "uuid", "blob"];
      const normalizedType = type.toLowerCase();

      if (!allowedTypes.includes(normalizedType)) {
        return res.status(400).json({ error: `Invalid type for ${col}` });
      }

      // Map blob → BYTEA in PostgreSQL
      const pgType = normalizedType === "blob" ? "BYTEA" : type.toUpperCase();
      columns.push(`${col} ${pgType}`);
    }

    // Add default system columns
    columns.unshift("id SERIAL PRIMARY KEY");
    columns.push("created_on TIMESTAMP DEFAULT now()");
    columns.push("modified_on TIMESTAMP DEFAULT now()");
    columns.push("versionid UUID DEFAULT gen_random_uuid()");

    
    const query = `CREATE TABLE IF NOT EXISTS ${safeTable} (${columns.join(", ")})`;

    // 1️⃣ Create the actual form table
    await pool.query(query);

    // 2️⃣ Insert into txmaster and return the new row
    const { rows } = await pool.query(
      `INSERT INTO txmaster (eform_name, dbname) 
       VALUES ($1, $2) RETURNING id, eform_name, dbname, created_on`,
      [eform_name, safeTable]
    );

    res.status(201).json({
      success: true,
      message: `Table '${safeTable}' created and registered in txmaster`,
      txmaster: rows[0]  // includes id, eform_name, dbname, created_on
    });
  } catch (err) {
    console.error("Table create error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------- COMMON SAVE API ----------------
app.post("/api/save", async (req, res) => {
  try {
    const { table, action, data } = req.body;

    if (!table || !action) {
      return res.status(400).json({ error: "Table name and action are required" });
    }

    // TODO: whitelist allowed tables to prevent SQL injection
    // const allowedTables = ["users", "orders", "products"];
    // if (!allowedTables.includes(table)) {
    //   return res.status(400).json({ error: "Invalid table name" });
    // }

    if (action === "create") {
      if (!data || Object.keys(data).length === 0) {
        return res.status(400).json({ error: "Data is required for create" });
      }

      const fields = Object.keys(data).join(", ");
      const values = Object.values(data);
      const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");

      const sql = `INSERT INTO ${table} (${fields}) VALUES (${placeholders}) RETURNING *`;
      const result = await pool.query(sql, values);

      return res.status(201).json({
        message: "Data inserted successfully",
        data: result.rows[0],
      });
    }

    if (action === "read") {
      const sql = `SELECT * FROM ${table}`;
      const result = await pool.query(sql);
      return res.json(result.rows);
    }

    if (action === "update") {
      if (!data || !data.id) {
        return res.status(400).json({ error: "id is required for update" });
      }

      const id = data.id;
      delete data.id;

      if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: "No fields provided to update" });
      }

      const setStr = Object.keys(data)
        .map((k, i) => `${k}=$${i + 1}`)
        .join(", ");
      const values = [...Object.values(data), id];

      const sql = `UPDATE ${table} SET ${setStr} WHERE id=$${values.length} RETURNING *`;
      const result = await pool.query(sql, values);

      return res.json({
        message: "Data updated successfully",
        data: result.rows[0],
      });
    }

    if (action === "delete") {
      if (!data || !data.id) {
        return res.status(400).json({ error: "id is required for delete" });
      }

      const sql = `DELETE FROM ${table} WHERE id=$1 RETURNING *`;
      const result = await pool.query(sql, [data.id]);

      return res.json({
        message: "Data deleted successfully",
        data: result.rows[0],
      });
    }

    return res.status(400).json({ error: "Invalid action" });
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
