-- Run this ONCE if you already created the database with the OLD `subjects` table
-- (only code, title, hours_units). Then import seed_bsit_game_dev_curriculum.sql.

USE acadex_db;

ALTER TABLE subjects
  ADD COLUMN program_name VARCHAR(180) NOT NULL DEFAULT 'BS Information Technology – Major in Game Development' AFTER id,
  ADD COLUMN curriculum_year VARCHAR(20) NOT NULL DEFAULT '2022-2023' AFTER program_name,
  ADD COLUMN year_level TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER curriculum_year,
  ADD COLUMN semester TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER year_level,
  ADD COLUMN lec_units DECIMAL(3,1) NOT NULL DEFAULT 0 AFTER title,
  ADD COLUMN lab_units DECIMAL(3,1) NOT NULL DEFAULT 0 AFTER lec_units,
  ADD COLUMN total_units DECIMAL(4,1) NOT NULL DEFAULT 0 AFTER lab_units,
  ADD COLUMN prerequisite TEXT NULL AFTER total_units;

UPDATE subjects SET total_units = hours_units, lec_units = hours_units WHERE total_units = 0 AND lec_units = 0 AND lab_units = 0;

ALTER TABLE subjects MODIFY code VARCHAR(48) NOT NULL;

-- If the above ADD fails with "Duplicate column", your table is already migrated; skip to importing the seed.
