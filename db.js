// db.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
  ssl: {
    rejectUnauthorized: false,  // needed for Render
  },
  // OR specify user, host, database, password, port here
});

module.exports = pool;
