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
    if (!rows.length) return res.status(400).json({ error: "Invalid Username" });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: "Invalid Password" });

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
    const { eform_name, table, fields } = req.body;

    if (!eform_name || !table || !fields || typeof fields !== "object") {
      return res.status(400).json({ error: "eform_name, table and fields are required" });
    }

    const safeTable = table.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!safeTable) return res.status(400).json({ error: "Invalid table name" });

    // ✅ Check if table exists in database
    const tableExists = await pool.query(
      `SELECT to_regclass($1) as exists`, [safeTable]
    );

    if (tableExists.rows[0].exists) {
      // Table exists → Add missing fields
      for (const [col, type] of Object.entries(fields)) {
        const normalizedType = type.toLowerCase();
        const allowedTypes = ["text", "integer", "numeric", "date", "timestamp", "uuid", "blob"];
        if (!allowedTypes.includes(normalizedType)) {
          return res.status(400).json({ error: `Invalid type for ${col}` });
        }
        const pgType = normalizedType === "blob" ? "BYTEA" : type.toUpperCase();

        // Add column if not already there
        await pool.query(
          `ALTER TABLE ${safeTable} ADD COLUMN IF NOT EXISTS ${col} ${pgType}`
        );
      }

      // Update metadata
      await pool.query(
        `UPDATE eform_metadata 
         SET fields = fields || $1::jsonb
         WHERE dbname = $2`,
        [JSON.stringify(fields), safeTable]
      );

      return res.json({ success: true, message: `Fields added to existing table '${safeTable}'` });
    }

    // 🚀 Table does not exist → Create new table
    const columns = [];
    for (const [col, type] of Object.entries(fields)) {
      const normalizedType = type.toLowerCase();
      const pgType = normalizedType === "blob" ? "BYTEA" : type.toUpperCase();
      columns.push(`${col} ${pgType}`);
    }

    // System columns
    columns.unshift("id SERIAL PRIMARY KEY");
    columns.push("created_on TIMESTAMP DEFAULT now()");
    columns.push("modified_on TIMESTAMP DEFAULT now()");
    columns.push("versionid UUID DEFAULT gen_random_uuid()");

    const createQuery = `CREATE TABLE ${safeTable} (${columns.join(", ")})`;
    await pool.query(createQuery);

    await pool.query(
      `INSERT INTO txmaster (eform_name, dbname) VALUES ($1, $2)`,
      [eform_name, safeTable]
    );

    await pool.query(
      `INSERT INTO eform_metadata (eform_name, dbname, fields) VALUES ($1, $2, $3::jsonb)`,
      [eform_name, safeTable, JSON.stringify(fields)]
    );

    res.status(201).json({
      success: true,
      message: `Table '${safeTable}' created successfully`
    });

  } catch (err) {
    console.error("Table create error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------- COMMON SAVE API ----------------
// CREATE
app.post("/api/save", async (req, res) => {
  try {
    const { table, data } = req.body;
    if (!table || !data) {
      return res.status(400).json({ error: "Table and data are required" });
    }

    const fields = Object.keys(data).join(", ");
    const values = Object.values(data);
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");

    const sql = `INSERT INTO ${table} (${fields}) VALUES (${placeholders}) RETURNING *`;
    const result = await pool.query(sql, values);

    res.status(201).json({ message: "Row inserted", data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// READ
app.post("/api/read", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE
app.put("/api/update", async (req, res) => {
  try {
    const { table, data, where } = req.body;

    if (!table || !data || Object.keys(data).length === 0) {
      return res.status(400).json({ error: "Table and data are required" });
    }

    if (!where) {
      return res.status(400).json({ error: "WHERE condition is required to prevent updating all rows" });
    }

    // Build SET part
    const setKeys = Object.keys(data);
    const setValues = Object.values(data);
    const setStr = setKeys.map((k, i) => `${k}=$${i + 1}`).join(", ");

    // Build WHERE part
    // If you pass as string: "state='Tamil Nadu' AND city='Chennai'"
    const sql = `UPDATE ${table} SET ${setStr} WHERE ${where} RETURNING *`;

    const result = await pool.query(sql, setValues);

    res.json({
      message: "Rows updated successfully",
      data: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE
app.delete("/api/delete", async (req, res) => {
  try {
    const { table, where } = req.body;

    if (!table || !where) {
      return res.status(400).json({ error: "Table and WHERE condition are required" });
    }

    const sql = `DELETE FROM ${table} WHERE ${where} RETURNING *`;
    const result = await pool.query(sql);

    res.json({
      message: "Rows deleted successfully",
      data: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------- Menu Click ------------------

app.get("/menuclick/:transid", async (req, res) => {
  const client = await pool.connect();
  try {
    const { transid } = req.params;

    // 1. Fetch stored SQL for this menu ID
    const sqlQuery = await client.query(
      "SELECT sql FROM menuclicksql WHERE transid = $1",
      [transid]
    );

    if (sqlQuery.rows.length === 0) {
      return res.status(404).json({ error: "No SQL found for this menu ID" });
    }

    const sqlToRun = sqlQuery.rows[0].sql; // ✅ use correct column name

    // 🔒 Safety check → only allow SELECT queries
    if (!/^select/i.test(sqlToRun.trim())) {
      return res
        .status(400)
        .json({ error: "Only SELECT queries are allowed." });
    }

    // 2. Execute stored SQL
    const result = await client.query(sqlToRun);

    // 3. Send back JSON result
    res.json({
      menu_id: transid, // ✅ fixed id bug
      rows: result.rows,
      count: result.rowCount,
    });
  } catch (err) {
    console.error("Error:", err.message);
    res.status(500).json({ error: "Database execution error" });
  } finally {
    client.release();
  }
});

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
