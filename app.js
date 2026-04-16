/**
 * SmartSched — admin + Google Calendar–style scheduling (rooms / availability)
 * Data loads from the Node + MySQL API; localStorage is optional offline fallback.
 */

const GC_COLORS = ["#1a73e8", "#d93025", "#f9ab00", "#1e8e3e", "#9334e6", "#e8710a", "#c5221f"];

const GC_START_HOUR = 6;
const GC_END_HOUR = 22;
const GC_SLOT_MIN = 30;
const GC_PX_PER_SLOT = 24;

const appData = {
  faculty: [
    { id: 1, name: "Dr. Alan Turing", department: "Computer Science", hoursUsed: 0, assignedCount: 0 },
    { id: 2, name: "Dr. Grace Hopper", department: "Computer Science", hoursUsed: 0, assignedCount: 0 },
    { id: 3, name: "Dr. Ada Lovelace", department: "Mathematics", hoursUsed: 0, assignedCount: 0 },
  ],
  subjects: [],
};

/** @type {{ id: string, date: string, start: string, end: string, title: string, room: string, facultyId: number, colorIndex: number, isFinalized?: boolean }[]} */
let scheduleEvents = [];

let currentDate = new Date();
let calendarView = "month";
let selectedDate = "";
let gcControlsBound = false;
/** Server-side error message while schedule modal is open (shown inline, not alert). */
let modalScheduleApiError = "";

function getToken() {
  return localStorage.getItem("acadex_token");
}

function getPortalUser() {
  try {
    const raw = localStorage.getItem("acadex_user");
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isFacultyPortal() {
  const u = getPortalUser();
  return u && u.role === "faculty";
}

function facultyPortalId() {
  const u = getPortalUser();
  if (!u || u.role !== "faculty" || u.facultyId == null) {
    return null;
  }
  return Number(u.facultyId);
}

/** If `acadex_user` is missing (older sessions), recover role from the JWT payload for UI routing. */
function syncUserFromToken() {
  if (getPortalUser() || !getToken()) {
    return;
  }
  try {
    const part = getToken().split(".")[1];
    if (!part) {
      return;
    }
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64));
    if (json && json.role) {
      localStorage.setItem(
        "acadex_user",
        JSON.stringify({
          id: json.sub,
          username: json.username,
          role: json.role,
          facultyId: json.facultyId != null ? Number(json.facultyId) : null,
        })
      );
    }
  } catch {
    /* ignore */
  }
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  let body = options.body;
  const rest = { ...options };
  delete rest.body;
  if (body && typeof body === "object" && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const res = await fetch(path, { ...rest, headers, body });
  if (res.status === 401) {
    localStorage.removeItem("acadex_token");
    localStorage.removeItem("loggedIn");
    localStorage.removeItem("acadex_user");
    window.location.href = "login.html";
    throw new Error("Unauthorized");
  }
  return res;
}

async function loadAppDataFromApi() {
  const [fr, sr, er] = await Promise.all([
    apiFetch("/api/faculty").then((r) => r.json()),
    apiFetch("/api/subjects").then((r) => r.json()),
    apiFetch("/api/schedule-events").then((r) => r.json()),
  ]);
  appData.faculty = fr;
  appData.subjects = sr;
  scheduleEvents = er;
}

/** Offline fallback if the API is unreachable (previous localStorage export). */
function loadStateLocalFallback() {
  try {
    const raw = localStorage.getItem("fs_appData");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed.faculty && Array.isArray(parsed.faculty)) {
      appData.faculty = parsed.faculty;
    }
    if (parsed.subjects && Array.isArray(parsed.subjects)) {
      appData.subjects = parsed.subjects;
    }
    if (parsed.scheduleEvents && Array.isArray(parsed.scheduleEvents)) {
      scheduleEvents = parsed.scheduleEvents;
    }
  } catch (_) {
    /* keep defaults */
  }
}

function totalAssignedLoads() {
  return appData.faculty.reduce((sum, f) => sum + (f.assignedCount || 0), 0);
}

function showView(viewId) {
  document.querySelectorAll(".view-panel").forEach((el) => {
    el.hidden = el.id !== `view-${viewId}`;
  });

  document.querySelectorAll(".sidebar-nav .nav-item").forEach((btn) => {
    const isActive = btn.getAttribute("data-view") === viewId;
    btn.classList.toggle("active", isActive);
    if (isActive) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });

  if (viewId === "schedules") {
    renderScheduleView();
  }
  if (viewId === "subjects") {
    renderSubjectsTable();
  }
  if (viewId === "faculty-timetable") {
    fillProfSchedulePicker();
  }
}

function initNavigation() {
  document.querySelectorAll(".sidebar-nav .nav-item[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showView(btn.getAttribute("data-view"));
    });
  });
}

function renderDashboardStats() {
  document.getElementById("statFacultyCount").textContent = String(appData.faculty.length);
  document.getElementById("statSubjectsCount").textContent = String(appData.subjects.length);
  document.getElementById("statAssignedLoads").textContent = String(totalAssignedLoads());
}

function renderFacultyLoadTable() {
  const tbody = document.getElementById("facultyLoadBody");
  tbody.innerHTML = appData.faculty
    .map(
      (f) => `
        <tr>
          <td><strong>${escapeHtml(f.name)}</strong></td>
          <td>${escapeHtml(f.department)}</td>
          <td>${f.assignedCount ?? 0}</td>
        </tr>`
    )
    .join("");
}

function renderFacultyList() {
  const tbody = document.getElementById("facultyListBody");
  tbody.innerHTML = appData.faculty
    .map(
      (f) => `
    <tr>
      <td>${escapeHtml(f.name)}</td>
      <td>${escapeHtml(f.department)}</td>
    </tr>`
    )
    .join("");
}

function getFilteredSubjects() {
  const yEl = document.getElementById("subjectFilterYear");
  const sEl = document.getElementById("subjectFilterSem");
  const y = yEl && yEl.value;
  const sem = sEl && sEl.value;
  return appData.subjects.filter((s) => {
    if (y && String(s.yearLevel ?? "") !== y) {
      return false;
    }
    if (sem && String(s.semester ?? "") !== sem) {
      return false;
    }
    return true;
  });
}

function renderSubjectsTable() {
  const tbody = document.getElementById("subjectsBody");
  if (!tbody) {
    return;
  }
  const list = getFilteredSubjects();
  tbody.innerHTML = list
    .map((s) => {
      const yr = s.yearLevel != null ? String(s.yearLevel) : "—";
      const sm = s.semester != null ? String(s.semester) : "—";
      const lec = s.lecUnits != null ? String(s.lecUnits) : "—";
      const lab = s.labUnits != null ? String(s.labUnits) : "—";
      const tot =
        s.totalUnits != null
          ? String(s.totalUnits)
          : s.hours != null
            ? String(s.hours)
            : "—";
      const pre = s.prerequisite ? escapeHtml(s.prerequisite) : "—";
      return `
    <tr>
      <td>${yr}</td>
      <td>${sm}</td>
      <td><strong>${escapeHtml(s.code)}</strong></td>
      <td>${escapeHtml(s.title)}</td>
      <td>${lec}</td>
      <td>${lab}</td>
      <td>${tot}</td>
      <td class="cell-prereq">${pre}</td>
    </tr>`;
    })
    .join("");
}

function initSubjectFilters() {
  const yEl = document.getElementById("subjectFilterYear");
  const sEl = document.getElementById("subjectFilterSem");
  const rerender = () => renderSubjectsTable();
  yEl?.addEventListener("change", rerender);
  sEl?.addEventListener("change", rerender);
}

function renderTeachingLoadTable() {
  const tbody = document.getElementById("teachingLoadBody");
  tbody.innerHTML = appData.faculty
    .map((f) => {
      const used = f.hoursUsed || 0;
      return `
    <tr>
      <td>${escapeHtml(f.name)}</td>
      <td>${f.assignedCount ?? 0}</td>
      <td>${used}</td>
    </tr>`;
    })
    .join("");
}

function formatScheduleDateLabel(isoDate) {
  try {
    const d = new Date(isoDate + "T12:00:00");
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch (_) {
    return String(isoDate || "");
  }
}

function setProfScheduleNotice(message) {
  const el = document.getElementById("profScheduleNotice");
  if (!el) {
    return;
  }
  if (message) {
    el.textContent = message;
    el.hidden = false;
  } else {
    el.textContent = "";
    el.hidden = true;
  }
}

function fillProfSchedulePicker() {
  const sel = document.getElementById("profSchedulePicker");
  if (!sel) {
    return;
  }
  const prev = sel.value;
  const fid = facultyPortalId();
  if (fid != null && !Number.isNaN(fid)) {
    const me = appData.faculty.find((f) => String(f.id) === String(fid));
    const label = me ? escapeHtml(me.name) : "Your account";
    sel.innerHTML = `<option value="${fid}">${label}</option>`;
    sel.value = String(fid);
    sel.disabled = true;
  } else {
    sel.disabled = false;
    const first = `<option value="">Choose a faculty member…</option>`;
    const opts = appData.faculty
      .map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`)
      .join("");
    sel.innerHTML = first + opts;
    if (prev && appData.faculty.some((f) => String(f.id) === String(prev))) {
      sel.value = prev;
    } else {
      sel.value = "";
    }
  }
  renderFacultyTimetable();
}

function renderFacultyTimetable() {
  const sel = document.getElementById("profSchedulePicker");
  const tbody = document.getElementById("profScheduleBody");
  const emptyEl = document.getElementById("profScheduleEmpty");
  const titleEl = document.getElementById("profScheduleDocTitle");
  const subEl = document.getElementById("profScheduleDocSub");
  const metaEl = document.getElementById("profScheduleDocMeta");
  const printBtn = document.getElementById("btnPrintProfSchedule");
  if (!sel || !tbody || !emptyEl || !titleEl || !subEl || !metaEl) {
    return;
  }

  const fid = sel.value;
  if (printBtn) {
    printBtn.disabled = !fid;
  }

  if (!fid) {
    titleEl.textContent = "Class schedule";
    subEl.textContent = "";
    metaEl.textContent = "";
    tbody.innerHTML = "";
    emptyEl.hidden = false;
    emptyEl.textContent = "Select a faculty member above to see their full schedule.";
    return;
  }

  const fac = appData.faculty.find((f) => String(f.id) === String(fid));
  const name = fac ? fac.name : "Faculty";
  const dept = fac ? fac.department : "";

  const rows = scheduleEvents
    .filter((e) => String(e.facultyId) === String(fid))
    .sort((a, b) => {
      if (a.date !== b.date) {
        return a.date.localeCompare(b.date);
      }
      return a.start.localeCompare(b.start);
    });

  titleEl.textContent = `${name} — class schedule`;
  subEl.textContent = dept ? `${dept}` : "";
  metaEl.textContent = `Generated ${new Date().toLocaleString()}`;

  if (!rows.length) {
    tbody.innerHTML = "";
    emptyEl.hidden = false;
    emptyEl.textContent = isFacultyPortal()
      ? "No finalized classes on your schedule yet. The registrar will publish your slots when the timetable is approved."
      : "No classes on file for this faculty member yet.";
    return;
  }

   const admin = !isFacultyPortal();
  emptyEl.hidden = true;
  tbody.innerHTML = rows
    .map((e) => {
      const draft = e.isFinalized === false;
      const draftBadge = admin && draft ? ` <span class="sched-draft-pill">Draft</span>` : "";
      const finalizeBtn =
        admin && draft
          ? `<button type="button" class="btn-link" data-finalize-event="${escapeHtml(e.id)}">Finalize</button> `
          : "";
      const removeBtn = admin
        ? `<button type="button" class="btn-link-danger" data-del-event="${escapeHtml(e.id)}">Remove</button>`
        : "";
      const actionsCell = admin ? `<td class="col-actions no-print">${finalizeBtn}${removeBtn}</td>` : "";
      return `
    <tr>
      <td>${escapeHtml(formatScheduleDateLabel(e.date))}</td>
      <td>${escapeHtml(e.start)}–${escapeHtml(e.end)}</td>
      <td>${escapeHtml(e.title)}${draftBadge}</td>
      <td>${escapeHtml(e.room || "—")}</td>
      ${actionsCell}
    </tr>`;
    })
    .join("");
}

async function finalizeScheduleEventById(eventId) {
  setProfScheduleNotice("");
  try {
    const res = await apiFetch(`/api/schedule-events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFinalized: true }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      setProfScheduleNotice(errBody.error || "Could not finalize this entry.");
      return;
    }
    await loadAppDataFromApi();
    refreshAllLists();
    const sched = document.getElementById("view-schedules");
    if (sched && !sched.hidden) {
      renderScheduleView();
    }
  } catch (e) {
    if (e.message === "Unauthorized") {
      return;
    }
    setProfScheduleNotice("Network error — check that the server is running.");
  }
}

async function deleteScheduleEventById(eventId) {
  if (!confirm("Remove this class from the professor's schedule?")) {
    return;
  }
  setProfScheduleNotice("");
  try {
    const res = await apiFetch(`/api/schedule-events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      setProfScheduleNotice(errBody.error || "Could not remove this schedule entry.");
      return;
    }
    await loadAppDataFromApi();
    refreshAllLists();
    const sched = document.getElementById("view-schedules");
    if (sched && !sched.hidden) {
      renderScheduleView();
    }
  } catch (e) {
    if (e.message === "Unauthorized") {
      return;
    }
    setProfScheduleNotice("Network error — check that the server is running.");
  }
}

function initFacultyTimetable() {
  const picker = document.getElementById("profSchedulePicker");
  picker?.addEventListener("change", () => {
    setProfScheduleNotice("");
    renderFacultyTimetable();
  });

  document.getElementById("btnPrintProfSchedule")?.addEventListener("click", () => {
    const sel = document.getElementById("profSchedulePicker");
    if (!sel || !sel.value) {
      return;
    }
    const prevTitle = document.title;
    const name =
      appData.faculty.find((f) => String(f.id) === String(sel.value))?.name || "Faculty";
    document.title = `${name} — timetable`;
    const afterPrint = () => {
      document.title = prevTitle;
      window.removeEventListener("afterprint", afterPrint);
    };
    window.addEventListener("afterprint", afterPrint);
    window.print();
  });

  document.getElementById("profScheduleBody")?.addEventListener("click", (e) => {
    const fin = e.target.closest("[data-finalize-event]");
    if (fin) {
      const id = fin.getAttribute("data-finalize-event");
      if (id) {
        finalizeScheduleEventById(id);
      }
      return;
    }
    const btn = e.target.closest("[data-del-event]");
    if (!btn) {
      return;
    }
    const id = btn.getAttribute("data-del-event");
    if (id) {
      deleteScheduleEventById(id);
    }
  });
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function refreshAllLists() {
  renderDashboardStats();
  renderFacultyLoadTable();
  renderFacultyList();
  renderSubjectsTable();
  renderTeachingLoadTable();
  fillSubjectSelect();
  fillFacultySelect();
  fillProfSchedulePicker();
}

/**
 * Schedule modal: subjects from curriculum (same pattern as professor select).
 */
function fillSubjectSelect() {
  const sel = document.getElementById("mSubject");
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = "";
  const first = document.createElement("option");
  first.value = "";
  first.textContent = "Select subject";
  sel.appendChild(first);

  const sorted = [...appData.subjects].sort((a, b) => {
    if (a.yearLevel !== b.yearLevel) return a.yearLevel - b.yearLevel;
    if (a.semester !== b.semester) return a.semester - b.semester;
    return String(a.code).localeCompare(String(b.code), undefined, { numeric: true });
  });
  for (const s of sorted) {
    const label = `${s.code} — ${s.title}`;
    const opt = document.createElement("option");
    opt.value = label;
    opt.textContent = label;
    sel.appendChild(opt);
  }

  if (prev && Array.from(sel.options).some((o) => o.value === prev)) {
    sel.value = prev;
  } else {
    sel.value = "";
  }

  const modal = document.getElementById("modal");
  if (modal && modal.style.display === "flex") {
    updateModalSaveState();
  }
}

function fillFacultySelect() {
  const sel = document.getElementById("mFaculty");
  if (!sel) return;
  const modal = document.getElementById("modal");
  const modalOpen = modal && modal.style.display === "flex";
  if (modalOpen) {
    refreshFacultySelectForModal();
  } else {
    const first = `<option value="">Select professor</option>`;
    const opts = appData.faculty.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join("");
    sel.innerHTML = first + opts;
  }
}

/* ---------- Date helpers ---------- */

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toISODate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function parseTimeToMinutes(t) {
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function hoursBetween(start, end) {
  const a = parseTimeToMinutes(start);
  const b = parseTimeToMinutes(end);
  if (a == null || b == null || b <= a) return 0;
  return (b - a) / 60;
}

function timeRangesOverlap(startA, endA, startB, endB) {
  const a1 = parseTimeToMinutes(startA);
  const b1 = parseTimeToMinutes(endA);
  const a2 = parseTimeToMinutes(startB);
  const b2 = parseTimeToMinutes(endB);
  if (a1 == null || b1 == null || a2 == null || b2 == null) {
    return false;
  }
  return a1 < b2 && a2 < b1;
}

function normalizeRoomKey(room) {
  return String(room || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function roomSlotTaken(room, dateStr, start, end) {
  const key = normalizeRoomKey(room);
  if (!key) {
    return false;
  }
  return scheduleEvents.some(
    (e) =>
      normalizeRoomKey(e.room) === key &&
      e.date === dateStr &&
      timeRangesOverlap(start, end, e.start, e.end)
  );
}

function facultySlotTaken(facultyId, dateStr, start, end) {
  const id = Number(facultyId);
  return scheduleEvents.some(
    (e) =>
      Number(e.facultyId) === id &&
      e.date === dateStr &&
      timeRangesOverlap(start, end, e.start, e.end)
  );
}

/**
 * Professors who can still be assigned this slot (hide if time overlaps another class).
 */
function getAssignableFacultyForModal() {
  const start = document.getElementById("mStart")?.value;
  const end = document.getElementById("mEnd")?.value;
  const room = document.getElementById("mRoom")?.value.trim() || "";
  const dateStr = selectedDate;

  if (!start || !end || parseTimeToMinutes(end) <= parseTimeToMinutes(start)) {
    return {
      list: appData.faculty,
      hint: "Set a valid start and end time to see which professors are available.",
    };
  }

  if (room && roomSlotTaken(room, dateStr, start, end)) {
    return {
      list: [],
      hint: "This room is already booked for this date and time. Change the room or time — no professor can be added without a conflict.",
    };
  }

  const available = appData.faculty.filter((f) => !facultySlotTaken(f.id, dateStr, start, end));

  let hint = "";
  if (!available.length && appData.faculty.length) {
    hint = "No professor is free for this time slot — each already has a class that overlaps. Try another time.";
  } else if (!room) {
    hint = "Enter the room code — the server requires it to block double-booking if two classes share the same room and time.";
  }

  return { list: available, hint };
}

function refreshFacultySelectForModal() {
  const sel = document.getElementById("mFaculty");
  const hintEl = document.getElementById("modalScheduleHint");
  if (!sel) {
    return;
  }

  const prev = sel.value;
  const { list, hint } = getAssignableFacultyForModal();

  const first = `<option value="">Select professor</option>`;
  const opts = list.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join("");
  sel.innerHTML = first + opts;

  if (prev && list.some((f) => String(f.id) === String(prev))) {
    sel.value = prev;
  } else {
    sel.value = "";
  }

  if (hintEl) {
    if (hint) {
      hintEl.textContent = hint;
      hintEl.hidden = false;
    } else {
      hintEl.textContent = "";
      hintEl.hidden = true;
    }
  }
  updateModalSaveState();
}

/**
 * Returns a short message if the booking cannot be saved yet (client-side),
 * or empty string if the form is consistent enough to attempt save.
 */
function getModalSaveBlockReason() {
  const facultyId = document.getElementById("mFaculty")?.value;
  const title = document.getElementById("mSubject")?.value.trim() || "";
  const room = document.getElementById("mRoom")?.value.trim() || "";
  const start = document.getElementById("mStart")?.value;
  const end = document.getElementById("mEnd")?.value;

  if (!title) {
    return "Select a subject to enable Save.";
  }
  if (!facultyId) {
    return "Select a professor to enable Save.";
  }
  if (!start || !end) {
    return "Set start and end times to enable Save.";
  }
  if (parseTimeToMinutes(end) <= parseTimeToMinutes(start)) {
    return "End time must be after start time.";
  }
  if (!room) {
    return "Enter a room or lab code — Save stays off until the slot can be checked for double-booking.";
  }
  if (roomSlotTaken(room, selectedDate, start, end)) {
    return "This room is already booked for this date and time. Change the room or time.";
  }
  const fid = parseInt(facultyId, 10);
  if (!Number.isNaN(fid) && facultySlotTaken(fid, selectedDate, start, end)) {
    return "This professor already has a class that overlaps this time.";
  }
  return "";
}

/**
 * Disables Save until the form passes conflict checks (no pop-up needed).
 */
function updateModalSaveState() {
  const btn = document.getElementById("mSave");
  const block = document.getElementById("modalSaveBlock");
  if (!btn || !block) {
    return;
  }

  const reason = getModalSaveBlockReason();
  if (reason) {
    btn.disabled = true;
    btn.title = reason;
    block.textContent = reason;
    block.hidden = false;
    return;
  }

  btn.disabled = false;
  btn.title = "";
  if (modalScheduleApiError) {
    block.textContent = modalScheduleApiError;
    block.hidden = false;
  } else {
    block.textContent = "";
    block.hidden = true;
  }
}

function initModalScheduleListeners() {
  ["mStart", "mEnd", "mRoom"].forEach((id) => {
    const el = document.getElementById(id);
    const onEdit = () => {
      modalScheduleApiError = "";
      refreshFacultySelectForModal();
    };
    el?.addEventListener("input", onEdit);
    el?.addEventListener("change", onEdit);
  });
  ["mSubject", "mFaculty"].forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener("change", () => {
      modalScheduleApiError = "";
      updateModalSaveState();
    });
  });
}

function eventsOnDate(dateStr) {
  return scheduleEvents.filter((e) => e.date === dateStr).sort((a, b) => a.start.localeCompare(b.start));
}

/* ---------- Google Calendar UI ---------- */

function initGcControls() {
  if (gcControlsBound) return;
  const todayBtn = document.getElementById("gcToday");
  const prevBtn = document.getElementById("gcPrev");
  const nextBtn = document.getElementById("gcNext");
  const createBtn = document.getElementById("gcCreateEvent");
  if (!todayBtn || !prevBtn || !nextBtn) return;

  todayBtn.addEventListener("click", () => {
    currentDate = new Date();
    renderScheduleView();
  });

  prevBtn.addEventListener("click", () => {
    if (calendarView === "month") {
      currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    } else {
      currentDate.setDate(currentDate.getDate() - 7);
      currentDate = new Date(currentDate);
    }
    renderScheduleView();
  });

  nextBtn.addEventListener("click", () => {
    if (calendarView === "month") {
      currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    } else {
      currentDate.setDate(currentDate.getDate() + 7);
      currentDate = new Date(currentDate);
    }
    renderScheduleView();
  });

  if (createBtn) {
    createBtn.addEventListener("click", () => {
      openModal(toISODate(new Date()));
    });
  }

  document.querySelectorAll(".gc-view-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      calendarView = tab.getAttribute("data-cal-view") || "month";
      document.querySelectorAll(".gc-view-tab").forEach((t) => {
        const on = t === tab;
        t.classList.toggle("active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      renderScheduleView();
    });
  });

  gcControlsBound = true;
}

function updateGcTitle() {
  const el = document.getElementById("gcTitle");
  if (!el) return;

  if (calendarView === "month") {
    el.textContent = currentDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    return;
  }

  const start = startOfWeekSunday(currentDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const y0 = start.getFullYear();
  const y1 = end.getFullYear();
  if (y0 === y1) {
    el.textContent = `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${y1}`;
  } else {
    el.textContent = `${start.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  }
}

function startOfWeekSunday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  return x;
}

function renderScheduleView() {
  initGcControls();
  updateGcTitle();

  const monthRoot = document.getElementById("gcMonthRoot");
  const weekRoot = document.getElementById("gcWeekRoot");
  if (!monthRoot || !weekRoot) return;

  if (calendarView === "month") {
    monthRoot.hidden = false;
    weekRoot.hidden = true;
    renderGcMonthGrid(monthRoot);
  } else {
    monthRoot.hidden = true;
    weekRoot.hidden = false;
    renderGcWeek(weekRoot);
  }

  renderMiniCalendar();
}

function renderGcMonthGrid(container) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const today = new Date();

  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let html = `<div class="gc-dow-row" role="row">`;
  dows.forEach((d) => {
    html += `<div class="gc-dow-cell" role="columnheader">${d}</div>`;
  });
  html += `</div><div class="gc-month-grid" role="grid">`;

  let cursor = new Date(year, month, 1 - startPad);
  for (let i = 0; i < 42; i++) {
    const dateStr = toISODate(cursor);
    const isOther = cursor.getMonth() !== month;
    const isToday = sameDay(cursor, today);
    const list = eventsOnDate(dateStr);
    const maxShow = 3;
    const shown = list.slice(0, maxShow);
    const more = list.length - shown.length;

    let chips = shown
      .map((ev) => {
        const accent = GC_COLORS[(ev.colorIndex || 0) % GC_COLORS.length];
        const room = ev.room ? ` · ${escapeHtml(ev.room)}` : "";
        return `<div class="gc-event-chip" style="--ev-accent:${accent}" title="${escapeHtml(ev.title)}">${escapeHtml(ev.start)} ${escapeHtml(ev.title)}${room}</div>`;
      })
      .join("");

    if (more > 0) {
      chips += `<div class="gc-event-more">${more} more</div>`;
    }

    const otherClass = isOther ? " other-month" : "";
    const todayClass = isToday ? " today" : "";

    html += `
      <div class="gc-day-cell${otherClass}" role="gridcell" data-date="${dateStr}" tabindex="0">
        <div class="gc-day-num-wrap">
          <span class="gc-day-num${todayClass}">${cursor.getDate()}</span>
        </div>
        <div class="gc-day-events">${chips}</div>
      </div>`;

    cursor.setDate(cursor.getDate() + 1);
  }

  html += `</div>`;
  container.innerHTML = html;

  container.querySelectorAll(".gc-day-cell").forEach((cell) => {
    const ds = cell.getAttribute("data-date");
    const open = () => openModal(ds);
    cell.addEventListener("click", (e) => {
      if (e.target.closest(".gc-event-chip")) return;
      open();
    });
    cell.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });
}

function renderGcWeek(container) {
  const start = startOfWeekSunday(currentDate);
  const today = new Date();
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }

  const totalSlots = (GC_END_HOUR - GC_START_HOUR) * (60 / GC_SLOT_MIN);
  const colHeight = totalSlots * GC_PX_PER_SLOT;

  let html = `<div class="gc-week-header">`;
  html += `<div class="gc-week-corner"></div>`;
  days.forEach((d) => {
    const isToday = sameDay(d, today);
    html += `<div class="gc-week-dayhead">
      <div class="gc-week-dow">${d.toLocaleDateString(undefined, { weekday: "short" })}</div>
      <div class="gc-week-daynum${isToday ? " is-today" : ""}">${d.getDate()}</div>
    </div>`;
  });
  html += `</div>`;

  html += `<div class="gc-week-body" style="min-height:${colHeight}px">`;

  html += `<div class="gc-week-times">`;
  for (let s = 0; s < totalSlots; s++) {
    const minutesFromStart = s * GC_SLOT_MIN;
    const totalMin = GC_START_HOUR * 60 + minutesFromStart;
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const isHour = m === 0;
    const label = isHour
      ? new Date(2000, 0, 1, h, 0).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
      : "";
    html += `<div class="gc-week-time-slot${isHour ? " hour-mark" : ""}">${label}</div>`;
  }
  html += `</div>`;

  const gridStartMin = GC_START_HOUR * 60;
  const gridEndMin = GC_END_HOUR * 60;

  days.forEach((d) => {
    const dateStr = toISODate(d);
    html += `<div class="gc-week-col" style="height:${colHeight}px" data-date="${dateStr}">`;

    eventsOnDate(dateStr).forEach((ev) => {
      let sm = parseTimeToMinutes(ev.start);
      let em = parseTimeToMinutes(ev.end);
      if (sm == null || em == null) return;
      sm = Math.max(sm, gridStartMin);
      em = Math.min(em, gridEndMin);
      if (em <= sm) return;

      const top = ((sm - gridStartMin) / GC_SLOT_MIN) * GC_PX_PER_SLOT;
      const height = Math.max(((em - sm) / GC_SLOT_MIN) * GC_PX_PER_SLOT, 20);
      const accent = GC_COLORS[(ev.colorIndex || 0) % GC_COLORS.length];
      const roomLine = ev.room ? `<span class="ev-room">${escapeHtml(ev.room)}</span>` : "";
      html += `<div class="gc-week-event" style="top:${top}px;height:${height}px;--ev-accent:${accent}" title="${escapeHtml(ev.title)}">
        <strong>${escapeHtml(ev.start)}–${escapeHtml(ev.end)}</strong> ${escapeHtml(ev.title)}
        ${roomLine}
      </div>`;
    });

    html += `</div>`;
  });

  html += `</div>`;
  container.innerHTML = html;

  container.querySelectorAll(".gc-week-col").forEach((col) => {
    const ds = col.getAttribute("data-date");
    col.addEventListener("click", (e) => {
      if (e.target.closest(".gc-week-event")) return;
      openModal(ds);
    });
  });
}

function renderMiniCalendar() {
  const wrap = document.getElementById("miniCalendar");
  if (!wrap) return;

  const y = currentDate.getFullYear();
  const m = currentDate.getMonth();
  const first = new Date(y, m, 1);
  const pad = first.getDay();
  const label = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const today = new Date();

  const dows = ["S", "M", "T", "W", "T", "F", "S"];
  let html = `<div class="gc-mini-month-label">${label}</div>`;
  html += `<div class="gc-mini-dow">${dows.map((d) => `<span>${d}</span>`).join("")}</div>`;
  html += `<div class="gc-mini-grid">`;

  let cur = new Date(y, m, 1 - pad);
  for (let i = 0; i < 42; i++) {
    const iso = toISODate(cur);
    const isOther = cur.getMonth() !== m;
    const isToday = sameDay(cur, today);
    const isSelected = sameDay(cur, currentDate);
    let cls = "gc-mini-day";
    if (isOther) cls += " other-month";
    if (isToday) cls += " today";
    if (isSelected && !isToday) cls += " selected";
    html += `<button type="button" class="${cls}" data-date="${iso}">${cur.getDate()}</button>`;
    cur.setDate(cur.getDate() + 1);
  }
  html += `</div>`;
  wrap.innerHTML = html;

  wrap.querySelectorAll(".gc-mini-day").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ds = btn.getAttribute("data-date");
      const [yy, mm, dd] = ds.split("-").map((x) => parseInt(x, 10));
      currentDate = new Date(yy, mm - 1, dd);
      renderScheduleView();
    });
  });
}

/* ---------- Modal ---------- */

function resetModalDefaults() {
  const st = document.getElementById("mStart");
  const en = document.getElementById("mEnd");
  if (st && !st.value) st.value = "09:00";
  if (en && !en.value) en.value = "10:30";
}

function openModal(dateStr) {
  selectedDate = dateStr;
  modalScheduleApiError = "";
  const label = document.getElementById("modalDate");
  if (label) {
    const d = new Date(dateStr + "T12:00:00");
    label.textContent = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }
  document.getElementById("mSubject").value = "";
  document.getElementById("mRoom").value = "";
  document.getElementById("mStart").value = "09:00";
  document.getElementById("mEnd").value = "10:30";
  document.getElementById("modal").style.display = "flex";
  resetModalDefaults();
  refreshFacultySelectForModal();
}

function closeModal() {
  document.getElementById("modal").style.display = "none";
}

async function saveSchedule() {
  modalScheduleApiError = "";
  const blockReason = getModalSaveBlockReason();
  if (blockReason) {
    updateModalSaveState();
    return;
  }

  const facultyId = document.getElementById("mFaculty").value;
  const title = document.getElementById("mSubject").value.trim();
  const room = document.getElementById("mRoom").value.trim();
  const start = document.getElementById("mStart").value;
  const end = document.getElementById("mEnd").value;

  try {
    const res = await apiFetch("/api/schedule-events", {
      method: "POST",
      body: {
        facultyId: parseInt(facultyId, 10),
        date: selectedDate,
        start,
        end,
        title,
        room,
      },
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      modalScheduleApiError = errBody.error || "Could not save booking.";
      updateModalSaveState();
      if (res.status === 409) {
        await loadAppDataFromApi().catch(() => {});
        refreshFacultySelectForModal();
        refreshAllLists();
      }
      return;
    }
    modalScheduleApiError = "";
    await loadAppDataFromApi();
    refreshAllLists();
    closeModal();
    const sched = document.getElementById("view-schedules");
    if (sched && !sched.hidden) {
      renderScheduleView();
    }
  } catch (e) {
    if (e.message === "Unauthorized") {
      return;
    }
    modalScheduleApiError = "Network error — is the server running? (npm start)";
    updateModalSaveState();
  }
}

function logout() {
  localStorage.removeItem("loggedIn");
  localStorage.removeItem("acadex_token");
  localStorage.removeItem("acadex_user");
  window.location.href = "login.html";
}

function applyFacultyPortalShell() {
  if (!isFacultyPortal()) {
    return;
  }
  document.body.classList.add("portal-faculty");
  const portalTitle = document.querySelector(".portal-title");
  if (portalTitle) {
    portalTitle.textContent = "Faculty Portal";
  }
  const roleEl = document.querySelector(".user-role");
  if (roleEl) {
    roleEl.textContent = "FACULTY";
  }
  const u = getPortalUser();
  const av = document.querySelector(".user-avatar");
  if (av && u && u.username) {
    av.textContent = String(u.username).charAt(0).toUpperCase();
  }
  const fttSub = document.querySelector("#view-faculty-timetable .page-subtitle");
  if (fttSub) {
    fttSub.textContent =
      "Published (finalized) class times only. Draft slots are managed by the registrar.";
  }
}

/* ---------- Init ---------- */
window.onload = async function () {
  if (localStorage.getItem("loggedIn") !== "true" || !getToken()) {
    window.location.href = "login.html";
    return;
  }

  syncUserFromToken();

  try {
    await loadAppDataFromApi();
  } catch (e) {
    loadStateLocalFallback();
    if (e.message !== "Unauthorized") {
      console.warn(e);
      alert(
        "Could not load from the API. Using saved browser data if any.\n\n" +
          "For full setup: start MySQL in XAMPP, import sql/schema.sql, copy .env.example to .env, run npm start, open http://localhost:3000"
      );
    } else {
      return;
    }
  }

  applyFacultyPortalShell();
  initNavigation();
  initSubjectFilters();
  initModalScheduleListeners();
  initFacultyTimetable();
  refreshAllLists();

  const refreshBtn = document.getElementById("btnRefreshFaculty");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      try {
        await loadAppDataFromApi();
      } catch (_) {
        /* ignore */
      }
      refreshAllLists();
      if (document.getElementById("view-schedules") && !document.getElementById("view-schedules").hidden) {
        renderScheduleView();
      }
    });
  }

  if (isFacultyPortal()) {
    showView("faculty-timetable");
  } else {
    showView("dashboard");
  }
};

window.openModal = openModal;
window.closeModal = closeModal;
window.saveSchedule = saveSchedule;
window.logout = logout;

/** Legacy no-op (old HTML selects removed) */
window.changeDate = function () {
  renderScheduleView();
};
