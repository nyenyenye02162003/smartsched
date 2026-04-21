/**
 * SmartSched - System Admin Portal
 * Unit Tests using Node.js built-in test runner (node:test)
 * Run with: node --test smartsched.test.js
 */

const { test, describe, before, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

// ─────────────────────────────────────────────
// Mock Data (mirrors what the dashboard shows)
// ─────────────────────────────────────────────

const mockFaculty = [
  { id: 1, name: "Dr. Alan Turing",   department: "Computer Science", assignedSubjects: 2 },
  { id: 2, name: "Dr. Grace Hopper",  department: "Computer Science", assignedSubjects: 1 },
  { id: 3, name: "Dr. Ada Lovelace",  department: "Mathematics",      assignedSubjects: 1 },
];

const mockSubjects = Array.from({ length: 78 }, (_, i) => ({
  id: i + 1,
  code: `SUBJ-${String(i + 1).padStart(3, "0")}`,
  title: `Subject ${i + 1}`,
  units: (i % 3) + 1,
}));

const mockTeachingLoads = [
  { id: 1, facultyId: 1, subjectId: 1, semester: "1st", academicYear: "2024-2025" },
  { id: 2, facultyId: 1, subjectId: 2, semester: "1st", academicYear: "2024-2025" },
  { id: 3, facultyId: 2, subjectId: 3, semester: "1st", academicYear: "2024-2025" },
  { id: 4, facultyId: 3, subjectId: 4, semester: "1st", academicYear: "2024-2025" },
];

// ─────────────────────────────────────────────
// Service Functions (business logic under test)
// ─────────────────────────────────────────────

/** Dashboard stat helpers */
const DashboardService = {
  getTotalFaculty:   (faculty)  => faculty.length,
  getTotalSubjects:  (subjects) => subjects.length,
  getAssignedLoads:  (loads)    => loads.length,

  getFacultyLoadDistribution(faculty, loads) {
    return faculty.map((f) => ({
      ...f,
      assignedSubjects: loads.filter((l) => l.facultyId === f.id).length,
    }));
  },

  getDashboardStats(faculty, subjects, loads) {
    return {
      totalFaculty:  this.getTotalFaculty(faculty),
      totalSubjects: this.getTotalSubjects(subjects),
      assignedLoads: this.getAssignedLoads(loads),
    };
  },
};

/** Faculty service */
const FacultyService = {
  getAll: (faculty) => [...faculty],

  getById: (faculty, id) => faculty.find((f) => f.id === id) ?? null,

  getByDepartment: (faculty, dept) =>
    faculty.filter((f) => f.department.toLowerCase() === dept.toLowerCase()),

  add(faculty, newFaculty) {
    if (!newFaculty.name?.trim())       throw new Error("Faculty name is required.");
    if (!newFaculty.department?.trim()) throw new Error("Department is required.");
    const id = faculty.length ? Math.max(...faculty.map((f) => f.id)) + 1 : 1;
    const record = { id, assignedSubjects: 0, ...newFaculty };
    return [...faculty, record];
  },

  update(faculty, id, updates) {
    const idx = faculty.findIndex((f) => f.id === id);
    if (idx === -1) throw new Error(`Faculty with id ${id} not found.`);
    const updated = [...faculty];
    updated[idx] = { ...updated[idx], ...updates };
    return updated;
  },

  delete(faculty, id) {
    if (!faculty.some((f) => f.id === id)) throw new Error(`Faculty with id ${id} not found.`);
    return faculty.filter((f) => f.id !== id);
  },
};

/** Teaching load service */
const TeachingLoadService = {
  getAll: (loads) => [...loads],

  getByFaculty: (loads, facultyId) => loads.filter((l) => l.facultyId === facultyId),

  assign(loads, facultyId, subjectId, semester, academicYear) {
    if (!facultyId || !subjectId) throw new Error("Faculty and subject are required.");
    const duplicate = loads.find(
      (l) => l.facultyId === facultyId && l.subjectId === subjectId &&
             l.semester === semester && l.academicYear === academicYear
    );
    if (duplicate) throw new Error("This teaching load is already assigned.");
    const id = loads.length ? Math.max(...loads.map((l) => l.id)) + 1 : 1;
    return [...loads, { id, facultyId, subjectId, semester, academicYear }];
  },

  remove(loads, id) {
    if (!loads.some((l) => l.id === id)) throw new Error(`Load with id ${id} not found.`);
    return loads.filter((l) => l.id !== id);
  },

  countByFaculty: (loads, facultyId) => loads.filter((l) => l.facultyId === facultyId).length,
};

/** Subject service */
const SubjectService = {
  getAll:  (subjects) => [...subjects],
  getById: (subjects, id) => subjects.find((s) => s.id === id) ?? null,

  search: (subjects, query) =>
    subjects.filter(
      (s) =>
        s.title.toLowerCase().includes(query.toLowerCase()) ||
        s.code.toLowerCase().includes(query.toLowerCase())
    ),

  add(subjects, newSubject) {
    if (!newSubject.code?.trim())  throw new Error("Subject code is required.");
    if (!newSubject.title?.trim()) throw new Error("Subject title is required.");
    if (subjects.some((s) => s.code === newSubject.code))
      throw new Error(`Subject code "${newSubject.code}" already exists.`);
    const id = subjects.length ? Math.max(...subjects.map((s) => s.id)) + 1 : 1;
    return [...subjects, { id, ...newSubject }];
  },
};

// ═══════════════════════════════════════════════════════════════
//  TEST SUITES
// ═══════════════════════════════════════════════════════════════

// ── 1. DASHBOARD SERVICE ────────────────────────────────────────
describe("DashboardService", () => {

  describe("getTotalFaculty()", () => {
    test("returns correct count from mock data", () => {
      assert.equal(DashboardService.getTotalFaculty(mockFaculty), 3);
    });

    test("returns 0 for empty array", () => {
      assert.equal(DashboardService.getTotalFaculty([]), 0);
    });
  });

  describe("getTotalSubjects()", () => {
    test("returns 78 total subjects", () => {
      assert.equal(DashboardService.getTotalSubjects(mockSubjects), 78);
    });
  });

  describe("getAssignedLoads()", () => {
    test("returns 4 assigned loads", () => {
      assert.equal(DashboardService.getAssignedLoads(mockTeachingLoads), 4);
    });

    test("returns 0 when no loads", () => {
      assert.equal(DashboardService.getAssignedLoads([]), 0);
    });
  });

  describe("getDashboardStats()", () => {
    test("returns correct combined stats", () => {
      const stats = DashboardService.getDashboardStats(mockFaculty, mockSubjects, mockTeachingLoads);
      assert.deepEqual(stats, { totalFaculty: 3, totalSubjects: 78, assignedLoads: 4 });
    });
  });

  describe("getFacultyLoadDistribution()", () => {
    test("Dr. Alan Turing has 2 assigned subjects", () => {
      const dist = DashboardService.getFacultyLoadDistribution(mockFaculty, mockTeachingLoads);
      const turing = dist.find((f) => f.name === "Dr. Alan Turing");
      assert.equal(turing.assignedSubjects, 2);
    });

    test("Dr. Grace Hopper has 1 assigned subject", () => {
      const dist = DashboardService.getFacultyLoadDistribution(mockFaculty, mockTeachingLoads);
      const hopper = dist.find((f) => f.name === "Dr. Grace Hopper");
      assert.equal(hopper.assignedSubjects, 1);
    });

    test("Dr. Ada Lovelace has 1 assigned subject", () => {
      const dist = DashboardService.getFacultyLoadDistribution(mockFaculty, mockTeachingLoads);
      const lovelace = dist.find((f) => f.name === "Dr. Ada Lovelace");
      assert.equal(lovelace.assignedSubjects, 1);
    });

    test("distribution array length matches faculty count", () => {
      const dist = DashboardService.getFacultyLoadDistribution(mockFaculty, mockTeachingLoads);
      assert.equal(dist.length, mockFaculty.length);
    });
  });
});

// ── 2. FACULTY SERVICE ──────────────────────────────────────────
describe("FacultyService", () => {

  describe("getAll()", () => {
    test("returns all faculty members", () => {
      assert.equal(FacultyService.getAll(mockFaculty).length, 3);
    });

    test("returns a copy, not the original reference", () => {
      const result = FacultyService.getAll(mockFaculty);
      assert.notEqual(result, mockFaculty);
    });
  });

  describe("getById()", () => {
    test("returns correct faculty by id", () => {
      const f = FacultyService.getById(mockFaculty, 1);
      assert.equal(f.name, "Dr. Alan Turing");
    });

    test("returns null for non-existent id", () => {
      assert.equal(FacultyService.getById(mockFaculty, 999), null);
    });
  });

  describe("getByDepartment()", () => {
    test("returns 2 faculty in Computer Science", () => {
      const cs = FacultyService.getByDepartment(mockFaculty, "Computer Science");
      assert.equal(cs.length, 2);
    });

    test("returns 1 faculty in Mathematics", () => {
      const math = FacultyService.getByDepartment(mockFaculty, "Mathematics");
      assert.equal(math.length, 1);
    });

    test("search is case-insensitive", () => {
      const result = FacultyService.getByDepartment(mockFaculty, "computer science");
      assert.equal(result.length, 2);
    });

    test("returns empty array for unknown department", () => {
      const result = FacultyService.getByDepartment(mockFaculty, "Physics");
      assert.equal(result.length, 0);
    });
  });

  describe("add()", () => {
    test("adds a new faculty member with auto-incremented id", () => {
      const updated = FacultyService.add(mockFaculty, {
        name: "Dr. John von Neumann",
        department: "Mathematics",
      });
      assert.equal(updated.length, 4);
      assert.equal(updated[3].id, 4);
      assert.equal(updated[3].name, "Dr. John von Neumann");
    });

    test("new faculty starts with 0 assigned subjects", () => {
      const updated = FacultyService.add(mockFaculty, {
        name: "Dr. John von Neumann",
        department: "Mathematics",
      });
      assert.equal(updated[3].assignedSubjects, 0);
    });

    test("throws if name is empty", () => {
      assert.throws(
        () => FacultyService.add(mockFaculty, { name: "", department: "CS" }),
        { message: "Faculty name is required." }
      );
    });

    test("throws if department is missing", () => {
      assert.throws(
        () => FacultyService.add(mockFaculty, { name: "Someone", department: "" }),
        { message: "Department is required." }
      );
    });
  });

  describe("update()", () => {
    test("updates the department of an existing faculty", () => {
      const updated = FacultyService.update(mockFaculty, 3, { department: "Computer Science" });
      assert.equal(updated.find((f) => f.id === 3).department, "Computer Science");
    });

    test("does not mutate the original array", () => {
      FacultyService.update(mockFaculty, 1, { department: "Physics" });
      assert.equal(mockFaculty[0].department, "Computer Science");
    });

    test("throws for non-existent id", () => {
      assert.throws(
        () => FacultyService.update(mockFaculty, 999, { department: "X" }),
        { message: "Faculty with id 999 not found." }
      );
    });
  });

  describe("delete()", () => {
    test("removes the faculty with the given id", () => {
      const updated = FacultyService.delete(mockFaculty, 2);
      assert.equal(updated.length, 2);
      assert.ok(!updated.some((f) => f.id === 2));
    });

    test("throws for non-existent id", () => {
      assert.throws(
        () => FacultyService.delete(mockFaculty, 999),
        { message: "Faculty with id 999 not found." }
      );
    });
  });
});

// ── 3. TEACHING LOAD SERVICE ────────────────────────────────────
describe("TeachingLoadService", () => {

  describe("getAll()", () => {
    test("returns all 4 teaching loads", () => {
      assert.equal(TeachingLoadService.getAll(mockTeachingLoads).length, 4);
    });
  });

  describe("getByFaculty()", () => {
    test("returns 2 loads for Dr. Alan Turing (id=1)", () => {
      assert.equal(TeachingLoadService.getByFaculty(mockTeachingLoads, 1).length, 2);
    });

    test("returns 1 load for Dr. Grace Hopper (id=2)", () => {
      assert.equal(TeachingLoadService.getByFaculty(mockTeachingLoads, 2).length, 1);
    });

    test("returns empty array for faculty with no loads", () => {
      assert.equal(TeachingLoadService.getByFaculty(mockTeachingLoads, 99).length, 0);
    });
  });

  describe("assign()", () => {
    test("assigns a new teaching load", () => {
      const updated = TeachingLoadService.assign(
        mockTeachingLoads, 2, 10, "2nd", "2024-2025"
      );
      assert.equal(updated.length, 5);
      assert.equal(updated[4].facultyId, 2);
      assert.equal(updated[4].subjectId, 10);
    });

    test("auto-increments the load id", () => {
      const updated = TeachingLoadService.assign(
        mockTeachingLoads, 2, 10, "2nd", "2024-2025"
      );
      assert.equal(updated[4].id, 5);
    });

    test("throws on duplicate assignment", () => {
      assert.throws(
        () => TeachingLoadService.assign(mockTeachingLoads, 1, 1, "1st", "2024-2025"),
        { message: "This teaching load is already assigned." }
      );
    });

    test("throws if facultyId is missing", () => {
      assert.throws(
        () => TeachingLoadService.assign(mockTeachingLoads, null, 5, "1st", "2024-2025"),
        { message: "Faculty and subject are required." }
      );
    });
  });

  describe("remove()", () => {
    test("removes a load by id", () => {
      const updated = TeachingLoadService.remove(mockTeachingLoads, 1);
      assert.equal(updated.length, 3);
      assert.ok(!updated.some((l) => l.id === 1));
    });

    test("throws for non-existent load id", () => {
      assert.throws(
        () => TeachingLoadService.remove(mockTeachingLoads, 999),
        { message: "Load with id 999 not found." }
      );
    });
  });

  describe("countByFaculty()", () => {
    test("counts 2 loads for faculty id 1", () => {
      assert.equal(TeachingLoadService.countByFaculty(mockTeachingLoads, 1), 2);
    });

    test("counts 0 for faculty with no loads", () => {
      assert.equal(TeachingLoadService.countByFaculty(mockTeachingLoads, 99), 0);
    });
  });
});

// ── 4. SUBJECT SERVICE ──────────────────────────────────────────
describe("SubjectService", () => {

  describe("getAll()", () => {
    test("returns all 78 subjects", () => {
      assert.equal(SubjectService.getAll(mockSubjects).length, 78);
    });
  });

  describe("getById()", () => {
    test("returns the correct subject", () => {
      const s = SubjectService.getById(mockSubjects, 1);
      assert.equal(s.code, "SUBJ-001");
    });

    test("returns null for missing id", () => {
      assert.equal(SubjectService.getById(mockSubjects, 9999), null);
    });
  });

  describe("search()", () => {
    test("finds subject by partial title", () => {
      const results = SubjectService.search(mockSubjects, "Subject 1");
      assert.ok(results.length > 0);
    });

    test("finds subject by code", () => {
      const results = SubjectService.search(mockSubjects, "SUBJ-010");
      assert.equal(results.length, 1);
      assert.equal(results[0].id, 10);
    });

    test("search is case-insensitive", () => {
      const upper = SubjectService.search(mockSubjects, "SUBJECT 5");
      const lower = SubjectService.search(mockSubjects, "subject 5");
      assert.equal(upper.length, lower.length);
    });

    test("returns empty array for no match", () => {
      const results = SubjectService.search(mockSubjects, "ZZZNOTFOUND");
      assert.equal(results.length, 0);
    });
  });

  describe("add()", () => {
    const smallList = [{ id: 1, code: "CS101", title: "Intro to CS", units: 3 }];

    test("adds a new subject", () => {
      const updated = SubjectService.add(smallList, { code: "CS102", title: "Data Structures", units: 3 });
      assert.equal(updated.length, 2);
      assert.equal(updated[1].code, "CS102");
    });

    test("throws on duplicate code", () => {
      assert.throws(
        () => SubjectService.add(smallList, { code: "CS101", title: "Duplicate", units: 3 }),
        { message: 'Subject code "CS101" already exists.' }
      );
    });

    test("throws if code is missing", () => {
      assert.throws(
        () => SubjectService.add(smallList, { code: "", title: "No Code", units: 3 }),
        { message: "Subject code is required." }
      );
    });

    test("throws if title is missing", () => {
      assert.throws(
        () => SubjectService.add(smallList, { code: "CS999", title: "", units: 3 }),
        { message: "Subject title is required." }
      );
    });
  });
});