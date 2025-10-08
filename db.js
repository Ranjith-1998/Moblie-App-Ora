// db.js
require("dotenv").config();
const oracledb = require("oracledb");

let pool;

async function connectDB() {
  try {
    pool = await oracledb.createPool({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectString: process.env.DB_CONNECT, // e.g. localhost/XEPDB1
    });
    console.log("✅ Connected to Oracle DB");
  } catch (err) {
    console.error("❌ Oracle DB connection error:", err);
  }
}

async function getConnection() {
  if (!pool) {
    await connectDB();
  }
  return await pool.getConnection();
}

module.exports = { connectDB, getConnection };
