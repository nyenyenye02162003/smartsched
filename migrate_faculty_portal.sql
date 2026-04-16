-- Run once on existing acadex_db (phpMyAdmin or mysql CLI).
-- Adds faculty accounts, finalized flag on schedule events, and links users to faculty.

USE acadex_db;

-- Link portal logins to a faculty row (NULL = admin / non-teaching accounts)
ALTER TABLE users
  ADD COLUMN faculty_id INT UNSIGNED NULL AFTER role,
  ADD CONSTRAINT fk_users_faculty FOREIGN KEY (faculty_id) REFERENCES faculty (id) ON DELETE SET NULL;

-- Draft vs published: faculty API only returns rows where is_finalized = 1
ALTER TABLE schedule_events
  ADD COLUMN is_finalized TINYINT(1) NOT NULL DEFAULT 0 AFTER color_index;

-- Treat existing data as already published (optional — remove if you want drafts)
UPDATE schedule_events SET is_finalized = 1 WHERE is_finalized = 0;

-- Demo faculty login: username prof.turing / password 1234 — tied to faculty id 1 (Dr. Alan Turing)
INSERT INTO users (username, password_hash, role, faculty_id) VALUES (
  'prof.turing',
  '$2b$10$NkoRqDKmeESGWmaGE7WyFOQxcsWM.KV3WTQ2s36pald9CCfNv4L7O',
  'faculty',
  1
) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), faculty_id = VALUES(faculty_id);
