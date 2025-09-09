// db.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    require: true,
    rejectUnauthorized: false, // Render does not provide CA certs
  },
  max: 10, // limit number of clients
  idleTimeoutMillis: 30000,
  // OR specify user, host, database, password, port here
});

module.exports = pool;
