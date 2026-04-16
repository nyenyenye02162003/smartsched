const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

const GC_COLOR_COUNT = 7;

function isAdmin(req) {
  return req.user && req.user.role === "admin";
}

function isFaculty(req) {
  return req.user && req.user.role === "faculty";
}

function facultyScopeId(req) {
  const id = req.user && req.user.facultyId;
  if (id == null || Number.isNaN(Number(id))) {
    return null;
  }
  return Number(id);
}

/**
 * Block double-booked rooms and overlapping faculty classes (same time slot).
 */
async function assertNoScheduleConflict(pool, { date, facultyId, start, end, room }) {
  const roomNorm = (room || "").trim().toLowerCase();
  if (!roomNorm) {
    return { ok: false, error: "Room is required so the system can prevent double-booking." };
  }

  const [rows] = await pool.query(
    `SELECT faculty_id, start_time, end_time, room FROM schedule_events
     WHERE event_date = ? AND start_time < ? AND end_time > ?`,
    [date, end, start]
  );

  for (const row of rows) {
    if (Number(row.faculty_id) === Number(facultyId)) {
      return { ok: false, error: "This professor already has a class that overlaps this time slot." };
    }
    const r2 = (row.room || "").trim().toLowerCase();
    if (r2 && roomNorm === r2) {
      return { ok: false, error: "This room is already booked for this date and time." };
    }
  }

  return { ok: true };
}

function normalizeTime(t) {
  if (!t || typeof t !== "string") return null;
  const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = String(Math.min(23, parseInt(m[1], 10))).padStart(2, "0");
  const min = String(Math.min(59, parseInt(m[2], 10))).padStart(2, "0");
  return `${h}:${min}:00`;
}

router.get("/faculty", async (req, res) => {
  try {
    if (isFaculty(req)) {
      const fid = facultyScopeId(req);
      if (!fid) {
        return res.status(403).json({ error: "Faculty account is not linked to a professor profile." });
      }
      const [rows] = await pool.query(
        `SELECT
          f.id,
          f.name,
          f.department,
          COALESCE(COUNT(e.id), 0) AS assignedCount,
          COALESCE(ROUND(SUM(TIMESTAMPDIFF(MINUTE, e.start_time, e.end_time)) / 60.0, 2), 0) AS hoursUsed
        FROM faculty f
        LEFT JOIN schedule_events e ON e.faculty_id = f.id AND e.is_finalized = 1
        WHERE f.id = ?
        GROUP BY f.id, f.name, f.department`,
        [fid]
      );
      const out = rows.map((r) => ({
        id: r.id,
        name: r.name,
        department: r.department,
        assignedCount: Number(r.assignedCount),
        hoursUsed: Number(r.hoursUsed),
      }));
      return res.json(out);
    }

    const [rows] = await pool.query(
      `SELECT
        f.id,
        f.name,
        f.department,
        COALESCE(COUNT(e.id), 0) AS assignedCount,
        COALESCE(ROUND(SUM(TIMESTAMPDIFF(MINUTE, e.start_time, e.end_time)) / 60.0, 2), 0) AS hoursUsed
      FROM faculty f
      LEFT JOIN schedule_events e ON e.faculty_id = f.id
      GROUP BY f.id, f.name, f.department
      ORDER BY f.id`
    );
    const out = rows.map((r) => ({
      id: r.id,
      name: r.name,
      department: r.department,
      assignedCount: Number(r.assignedCount),
      hoursUsed: Number(r.hoursUsed),
    }));
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load faculty" });
  }
});

router.get("/subjects", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, program_name AS programName, curriculum_year AS curriculumYear,
              year_level AS yearLevel, semester,
              code, title, lec_units AS lecUnits, lab_units AS labUnits,
              total_units AS totalUnits, hours_units AS hours, prerequisite
       FROM subjects
       ORDER BY year_level, semester, code`
    );
    const out = rows.map((r) => ({
      id: r.id,
      programName: r.programName,
      curriculumYear: r.curriculumYear,
      yearLevel: Number(r.yearLevel),
      semester: Number(r.semester),
      code: r.code,
      title: r.title,
      lecUnits: Number(r.lecUnits),
      labUnits: Number(r.labUnits),
      totalUnits: Number(r.totalUnits),
      hours: Number(r.hours),
      prerequisite: r.prerequisite || "",
    }));
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load subjects" });
  }
});

router.get("/schedule-events", async (req, res) => {
  try {
    let sql = `SELECT id, faculty_id AS facultyId, event_date AS d, start_time AS st, end_time AS et,
              title, room, color_index AS colorIndex, is_finalized AS isFinalized
       FROM schedule_events`;
    const params = [];
    if (isFaculty(req)) {
      const fid = facultyScopeId(req);
      if (!fid) {
        return res.status(403).json({ error: "Faculty account is not linked to a professor profile." });
      }
      sql += " WHERE faculty_id = ? AND is_finalized = 1";
      params.push(fid);
    }
    sql += " ORDER BY event_date, start_time";
    const [rows] = await pool.query(sql, params);
    const out = rows.map((r) => ({
      id: String(r.id),
      facultyId: r.facultyId,
      date: typeof r.d === "string" ? r.d.split("T")[0] : r.d,
      start: String(r.st).slice(0, 5),
      end: String(r.et).slice(0, 5),
      title: r.title,
      room: r.room || "",
      colorIndex: Number(r.colorIndex) || 0,
      isFinalized: Boolean(r.isFinalized),
    }));
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load schedule events" });
  }
});

router.post("/schedule-events", async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: "Only administrators can create schedule entries." });
    }
    const { facultyId, date, start, end, title, room } = req.body;
    const fid = parseInt(facultyId, 10);
    if (!fid || !date || !start || !end) {
      return res.status(400).json({ error: "facultyId, date, start, and end are required" });
    }
    const titleStr = (title && String(title).trim()) || "Untitled class";
    const roomStr = room != null ? String(room).trim() : "";

    const st = normalizeTime(start);
    const et = normalizeTime(end);
    if (!st || !et) {
      return res.status(400).json({ error: "Invalid start or end time format (use HH:MM)" });
    }

    const [frows] = await pool.query("SELECT id FROM faculty WHERE id = ?", [fid]);
    if (!frows.length) {
      return res.status(400).json({ error: "Invalid faculty" });
    }

    const conflict = await assertNoScheduleConflict(pool, {
      date: typeof date === "string" ? date.split("T")[0] : date,
      facultyId: fid,
      start: st,
      end: et,
      room: roomStr,
    });
    if (!conflict.ok) {
      return res.status(409).json({ error: conflict.error });
    }

    const colorIndex = fid % GC_COLOR_COUNT;

    const [result] = await pool.query(
      `INSERT INTO schedule_events (faculty_id, event_date, start_time, end_time, title, room, color_index, is_finalized)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [fid, date, st, et, titleStr, roomStr, colorIndex]
    );

    res.status(201).json({
      id: String(result.insertId),
      facultyId: fid,
      date: typeof date === "string" ? date.split("T")[0] : date,
      start: st.slice(0, 5),
      end: et.slice(0, 5),
      title: titleStr,
      room: roomStr,
      colorIndex,
      isFinalized: false,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not save schedule event" });
  }
});

router.patch("/schedule-events/:id", async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: "Only administrators can update schedule entries." });
    }
    const id = parseInt(req.params.id, 10);
    if (!id || id < 1) {
      return res.status(400).json({ error: "Invalid schedule id" });
    }
    const next = req.body && req.body.isFinalized;
    if (typeof next !== "boolean") {
      return res.status(400).json({ error: "Body must include isFinalized (boolean)" });
    }
    const [result] = await pool.query("UPDATE schedule_events SET is_finalized = ? WHERE id = ?", [
      next ? 1 : 0,
      id,
    ]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Schedule entry not found" });
    }
    const [rows] = await pool.query(
      `SELECT id, faculty_id AS facultyId, event_date AS d, start_time AS st, end_time AS et,
              title, room, color_index AS colorIndex, is_finalized AS isFinalized
       FROM schedule_events WHERE id = ?`,
      [id]
    );
    const r = rows[0];
    res.json({
      id: String(r.id),
      facultyId: r.facultyId,
      date: typeof r.d === "string" ? r.d.split("T")[0] : r.d,
      start: String(r.st).slice(0, 5),
      end: String(r.et).slice(0, 5),
      title: r.title,
      room: r.room || "",
      colorIndex: Number(r.colorIndex) || 0,
      isFinalized: Boolean(r.isFinalized),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update schedule entry" });
  }
});

router.delete("/schedule-events/:id", async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: "Only administrators can remove schedule entries." });
    }
    const id = parseInt(req.params.id, 10);
    if (!id || id < 1) {
      return res.status(400).json({ error: "Invalid schedule id" });
    }
    const [result] = await pool.query("DELETE FROM schedule_events WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Schedule entry not found" });
    }
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete schedule entry" });
  }
});

module.exports = router;
