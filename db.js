// db.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
  // OR specify user, host, database, password, port here
});

module.exports = pool;
