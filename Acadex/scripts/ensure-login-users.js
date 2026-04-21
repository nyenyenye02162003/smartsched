/**
 * Fixes "Invalid username or password" when rows are missing or the DB predates faculty logins.
 * Run from project root:  node scripts/ensure-login-users.js
 * Requires: MySQL running, .env DB_* matching XAMPP (see .env.example).
 */
require("dotenv").config();
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

const HASH_1234 = bcrypt.hashSync("1234", 10);

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : "",
    database: process.env.DB_NAME || "acadex_db",
  });

  const conn = await pool.getConnection();
  try {
    if (!(await columnExists(conn, "users", "faculty_id"))) {
      await conn.query("ALTER TABLE users ADD COLUMN faculty_id INT UNSIGNED NULL AFTER role");
      try {
        await conn.query(
          "ALTER TABLE users ADD CONSTRAINT fk_users_faculty FOREIGN KEY (faculty_id) REFERENCES faculty (id) ON DELETE SET NULL"
        );
      } catch (e) {
        if (e.code !== "ER_DUP_KEYNAME" && e.code !== "ER_CANT_CREATE_TABLE" && e.code !== "ER_CANNOT_ADD_FOREIGN") {
          throw e;
        }
      }
      console.log("Added users.faculty_id");
    }

    if (!(await columnExists(conn, "schedule_events", "is_finalized"))) {
      await conn.query(
        "ALTER TABLE schedule_events ADD COLUMN is_finalized TINYINT(1) NOT NULL DEFAULT 0 AFTER color_index"
      );
      await conn.query("UPDATE schedule_events SET is_finalized = 1");
      console.log("Added schedule_events.is_finalized (existing rows marked published)");
    }

    await conn.query(
      `INSERT INTO faculty (id, name, department, max_hours_per_week)
       VALUES (1, 'Dr. Alan Turing', 'Computer Science', 20)
       ON DUPLICATE KEY UPDATE name = VALUES(name), department = VALUES(department)`
    );

    await conn.query(
      `INSERT INTO users (username, password_hash, role, faculty_id) VALUES ('admin', ?, 'admin', NULL)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), faculty_id = NULL`,
      [HASH_1234]
    );

    await conn.query(
      `INSERT INTO users (username, password_hash, role, faculty_id) VALUES ('prof.turing', ?, 'faculty', 1)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), faculty_id = VALUES(faculty_id)`,
      [HASH_1234]
    );

    console.log("Done. You can sign in as:");
    console.log("  admin / 1234  (registrar)");
    console.log("  prof.turing / 1234  (faculty demo, finalized slots only)");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
