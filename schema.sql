-- SmartSched (Acadex) — MySQL schema for XAMPP
-- 1) Import this file in phpMyAdmin (or: mysql -u root < sql/schema.sql)
-- 2) Import sql/seed_bsit_game_dev_curriculum.sql for BSIT Game Dev subjects (78 rows).
--    If you already had the OLD subjects table: run sql/migrate_subjects_curriculum.sql first, then the seed.

CREATE DATABASE IF NOT EXISTS acadex_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE acadex_db;

CREATE TABLE IF NOT EXISTS faculty (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  department VARCHAR(120) NOT NULL,
  max_hours_per_week INT UNSIGNED NOT NULL DEFAULT 20,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Note: max_hours_per_week is kept for older DBs; the app does not enforce a weekly hour cap.

-- Portal users (faculty_id links teaching accounts to a faculty row)
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'admin',
  faculty_id INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_faculty FOREIGN KEY (faculty_id) REFERENCES faculty (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS subjects (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  program_name VARCHAR(180) NOT NULL DEFAULT 'BS Information Technology – Major in Game Development',
  curriculum_year VARCHAR(20) NOT NULL DEFAULT '2022-2023',
  year_level TINYINT UNSIGNED NOT NULL,
  semester TINYINT UNSIGNED NOT NULL,
  code VARCHAR(48) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  lec_units DECIMAL(3,1) NOT NULL DEFAULT 0,
  lab_units DECIMAL(3,1) NOT NULL DEFAULT 0,
  total_units DECIMAL(4,1) NOT NULL,
  hours_units DECIMAL(4,1) NOT NULL,
  prerequisite TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_subjects_year_sem (year_level, semester)
);

CREATE TABLE IF NOT EXISTS schedule_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  faculty_id INT UNSIGNED NOT NULL,
  event_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  title VARCHAR(255) NOT NULL,
  room VARCHAR(120) NOT NULL DEFAULT '',
  color_index TINYINT UNSIGNED NOT NULL DEFAULT 0,
  is_finalized TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_schedule_faculty FOREIGN KEY (faculty_id) REFERENCES faculty (id) ON DELETE CASCADE,
  INDEX idx_schedule_date (event_date),
  INDEX idx_schedule_faculty (faculty_id)
);

INSERT INTO faculty (id, name, department, max_hours_per_week) VALUES
  (1, 'Dr. Alan Turing', 'Computer Science', 20),
  (2, 'Dr. Grace Hopper', 'Computer Science', 20),
  (3, 'Dr. Ada Lovelace', 'Mathematics', 20)
ON DUPLICATE KEY UPDATE name = VALUES(name), department = VALUES(department), max_hours_per_week = VALUES(max_hours_per_week);

-- Default admin: username admin / password 1234
INSERT INTO users (username, password_hash, role, faculty_id) VALUES (
  'admin',
  '$2b$10$NkoRqDKmeESGWmaGE7WyFOQxcsWM.KV3WTQ2s36pald9CCfNv4L7O',
  'admin',
  NULL
) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), faculty_id = VALUES(faculty_id);

-- Demo faculty: username prof.turing / password 1234 — sees only finalized slots for faculty #1
INSERT INTO users (username, password_hash, role, faculty_id) VALUES (
  'prof.turing',
  '$2b$10$NkoRqDKmeESGWmaGE7WyFOQxcsWM.KV3WTQ2s36pald9CCfNv4L7O',
  'faculty',
  1
) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), faculty_id = VALUES(faculty_id);

-- Full BSIT Game Development curriculum: import sql/seed_bsit_game_dev_curriculum.sql
