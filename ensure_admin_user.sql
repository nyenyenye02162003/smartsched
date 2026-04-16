-- Run this in phpMyAdmin if login fails with "Invalid username or password"
-- (fixes wrong hash, missing admin row, or password changed by mistake).
-- Password after this script: admin / 1234

USE acadex_db;

INSERT INTO users (username, password_hash, role, faculty_id) VALUES (
  'admin',
  '$2b$10$NkoRqDKmeESGWmaGE7WyFOQxcsWM.KV3WTQ2s36pald9CCfNv4L7O',
  'admin',
  NULL
) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role);
