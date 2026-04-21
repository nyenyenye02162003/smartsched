const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const username = (req.body.username || "").trim();
    const password = req.body.password || "";
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    let rows;
    try {
      [rows] = await pool.query(
        "SELECT id, username, password_hash, role, faculty_id AS facultyId FROM users WHERE username = ?",
        [username]
      );
    } catch (err) {
      // Older databases imported before `faculty_id` was added — still allow admin login.
      if (err && err.code === "ER_BAD_FIELD_ERROR") {
        [rows] = await pool.query(
          "SELECT id, username, password_hash, role FROM users WHERE username = ?",
          [username]
        );
        rows = rows.map((r) => ({ ...r, facultyId: null }));
      } else {
        throw err;
      }
    }
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const secret = process.env.JWT_SECRET || "dev-only-change-me";
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      facultyId: user.facultyId != null ? Number(user.facultyId) : null,
    };
    const token = jwt.sign(payload, secret, { expiresIn: "8h" });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        facultyId: user.facultyId != null ? Number(user.facultyId) : null,
      },
    });
  } catch (err) {
    console.error(err);
    const code = err && err.code;
    if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
      return res.status(503).json({
        error:
          "Cannot reach MySQL. Start MySQL in XAMPP and check DB_HOST / DB_PORT in your .env file.",
      });
    }
    if (code === "ER_ACCESS_DENIED_ERROR" || code === "ER_DBACCESS_DENIED_ERROR") {
      return res.status(503).json({
        error: "MySQL rejected the login. Check DB_USER and DB_PASSWORD in .env (XAMPP default is often root with no password).",
      });
    }
    if (code === "ER_BAD_DB_ERROR") {
      return res.status(503).json({
        error: "Database not found. Import sql/schema.sql in phpMyAdmin or create acadex_db.",
      });
    }
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
