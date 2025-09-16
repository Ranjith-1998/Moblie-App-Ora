const pool = require("./db");

async function initDb() {
  try {
    // Company Master
    await pool.query(`
      CREATE TABLE IF NOT EXISTS companymast (
        id int4 DEFAULT nextval('companymast_companymastid_seq'::regclass) NOT NULL,
	companyname varchar(255) NOT NULL,
	state varchar(100) NOT NULL,
	country varchar(100) NOT NULL,
	city varchar(150) NOT NULL,
	pincode numeric NOT NULL,
	add1 varchar(255) NOT NULL,
	add2 varchar(255) NOT NULL,
	add3 varchar(255) NULL,
	phone numeric NULL,
	email varchar(255) NULL,
	gstnumber varchar(50) NULL,
	pannumber varchar(50) NULL,
	logo bytea NULL,
	logofilename varchar(255) NULL,
	logofiletype varchar(100) NULL,
	logofilesize numeric NULL,
	created_at timestamp DEFAULT CURRENT_TIMESTAMP NULL,
	updated_at timestamp DEFAULT CURRENT_TIMESTAMP NULL,
	CONSTRAINT companymast_pkey PRIMARY KEY (id)  
      )
    `);

    // Menu click sql 
    await pool.query(`
      CREATE TABLE IF NOT EXISTS menuclicksql (
        menuclicksqlid  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        transid char(70),
        sql TEXT
      )
    `);

    // Users
    await pool.query(`
      CREATE TABLE users (  
      id serial4 NOT NULL,
      email text NOT NULL,
      "password" text NOT NULL,
      firstname text NOT NULL,
      lastname text NOT NULL,
      created_on timestamp DEFAULT now() NULL,
      CONSTRAINT users_email_key UNIQUE (email),
      CONSTRAINT users_pkey PRIMARY KEY (id)
      )
    `);

    // reportsql
    await pool.query(`
      CREATE TABLE reportsql ( (
        reportsqlid  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        reportslug bpchar(70) NULL,
        "sql" text NULL
      )
    `);

    // txmaster
    await pool.query(`
      CREATE TABLE txmaster (
        id serial4 NOT NULL,
        eform_name text NOT NULL,
        dbname text NOT NULL,
        created_on timestamp DEFAULT now() NULL
      )
    `);

    // citydetail
    await pool.query(`
      create table citydetail (
        citydetailid  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        stateid  integer,
        cityid varchar(10),
        cityname  varchar(30)
      )
    `);

    // statedetail
    await pool.query(`
      create table statedetail (
        statedetailid serial primary key,
        posgst  varchar(100),
        statecodegst  varchar(10),
        statename     varchar(50),
        countryid     integer,
        stateid       varchar(10)
      )
    `);

     await pool.query(`
      create table country (
        countrydetailid integer generated always as identity primary key,
        countrycode     varchar(12),
        countryname     varchar(50),
        countryid       varchar(10),
        created_on      timestamp DEFAULT now() NULL
      )
    `);

    console.log("✅ All tables created successfully for new project!");
  } catch (err) {
    console.error("❌ Error creating tables:", err.message);
  }
}

initDb();
