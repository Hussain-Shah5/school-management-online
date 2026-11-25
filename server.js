// School Management System — Online (Express + real SQLite file database)
// Node >= 22.5 required for built-in node:sqlite (no native compile step).
//   better-sqlite3 was tried first: it fails to compile in locked-down
//   sandboxes (node-gyp cannot download node headers). node:sqlite IS
//   real SQLite (same .db file format) and needs no build step, so the
//   app runs identically on Railway (Dockerfile pins node:24) and locally.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'school.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

// ---------- schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  school_name TEXT NOT NULL DEFAULT 'Demo School',
  role TEXT NOT NULL DEFAULT 'admin',
  teacher_id INTEGER,
  student_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, father_name TEXT DEFAULT '', class_name TEXT NOT NULL,
  section TEXT DEFAULT 'A', roll_no TEXT DEFAULT '', phone TEXT DEFAULT '',
  monthly_fee INTEGER DEFAULT 0, admission_date TEXT DEFAULT '',
  b_form_no TEXT DEFAULT '',
  status TEXT DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL, class_name TEXT NOT NULL,
  UNIQUE(student_id, date)
);
CREATE TABLE IF NOT EXISTS fees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL, month TEXT NOT NULL, amount INTEGER NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT DEFAULT '', payment_date TEXT DEFAULT '',
  UNIQUE(student_id, month)
);
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL, exam TEXT NOT NULL, subject TEXT NOT NULL,
  marks INTEGER NOT NULL, total_marks INTEGER NOT NULL DEFAULT 100,
  class_name TEXT DEFAULT '',
  UNIQUE(student_id, exam, subject, class_name)
);
CREATE TABLE IF NOT EXISTS teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, designation TEXT DEFAULT '', qualification TEXT DEFAULT '',
  salary INTEGER DEFAULT 0, phone TEXT DEFAULT '', subjects TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS teacher_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL, class_name TEXT NOT NULL, subject TEXT NOT NULL,
  UNIQUE(teacher_id, class_name, subject)
);
CREATE TABLE IF NOT EXISTS staff_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL,
  UNIQUE(teacher_id, date)
);
CREATE TABLE IF NOT EXISTS leaving_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL UNIQUE, leaving_date TEXT NOT NULL,
  reason TEXT DEFAULT '', last_class TEXT NOT NULL, slc_number TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL, from_class TEXT NOT NULL, to_class TEXT NOT NULL,
  exam TEXT NOT NULL, percentage REAL NOT NULL, date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS timetable (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL, day TEXT NOT NULL, period INTEGER NOT NULL,
  subject TEXT NOT NULL, teacher_id INTEGER, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
  UNIQUE(class_name, day, period)
);
`);

// ---------- helpers ----------
function hashPassword(pw, salt) {
  return crypto.scryptSync(pw, salt, 64).toString('hex');
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const CLASSES = ['Nursery', 'KG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const CLASS_COUNTS = { Nursery: 18, KG: 20, '1': 22, '2': 19, '3': 24, '4': 21, '5': 23, '6': 18, '7': 25, '8': 20, '9': 22, '10': 17 };
const CLASS_FEES = { Nursery: 1500, KG: 1500, '1': 1500, '2': 1700, '3': 1800, '4': 2000, '5': 2100, '6': 2300, '7': 2400, '8': 2500, '9': 2500, '10': 2700 };
// Sum check: 18*1500+20*1500+22*1500+19*1700+24*1800+21*2000+23*2100+18*2300+25*2400+20*2500+22*2500+17*2700 = 508100
function subjectsForClass(cls) {
  if (cls === 'Nursery' || cls === 'KG') return ['English', 'Urdu', 'Maths', 'Nazra Quran', 'Drawing', 'Rhymes'];
  if (['1', '2', '3', '4', '5'].includes(cls)) return ['English', 'Urdu', 'Maths', 'Science', 'Islamiat', 'Social Studies'];
  if (['6', '7', '8'].includes(cls)) return ['English', 'Urdu', 'Maths', 'Science', 'Islamiat', 'Computer'];
  return ['English', 'Urdu', 'Maths', 'Physics', 'Chemistry', 'Biology'];
}
function grade(pct) {
  if (pct >= 90) return 'A+'; if (pct >= 80) return 'A'; if (pct >= 70) return 'B';
  if (pct >= 60) return 'C'; if (pct >= 50) return 'D'; return 'F';
}

// ---------- roles, CSV, backup helpers ----------
// Existing databases (already deployed on Railway) have a users table
// without role/teacher_id/student_id — add the columns on startup.
function ensureUserColumns() {
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!cols.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
  if (!cols.includes('teacher_id')) db.exec('ALTER TABLE users ADD COLUMN teacher_id INTEGER');
  if (!cols.includes('student_id')) db.exec('ALTER TABLE users ADD COLUMN student_id INTEGER');
}
// New teacher-profile fields (full-info form): father_name, cnic, dob,
// email, address, experience, joining_date. Older databases (already
// deployed on Railway) do not have these columns — add them on startup
// so the 14 seeded teachers keep working with the new fields empty.
function ensureTeacherColumns() {
  const cols = db.prepare("PRAGMA table_info(teachers)").all().map(c => c.name);
  const add = [
    ['father_name', "ALTER TABLE teachers ADD COLUMN father_name TEXT DEFAULT ''"],
    ['cnic', "ALTER TABLE teachers ADD COLUMN cnic TEXT DEFAULT ''"],
    ['dob', "ALTER TABLE teachers ADD COLUMN dob TEXT DEFAULT ''"],
    ['email', "ALTER TABLE teachers ADD COLUMN email TEXT DEFAULT ''"],
    ['address', "ALTER TABLE teachers ADD COLUMN address TEXT DEFAULT ''"],
    ['experience', "ALTER TABLE teachers ADD COLUMN experience TEXT DEFAULT ''"],
    ['joining_date', "ALTER TABLE teachers ADD COLUMN joining_date TEXT DEFAULT ''"],
  ];
  for (const [col, sql] of add) if (!cols.includes(col)) db.exec(sql);
}
// Results now record the class they belong to, so a student's profile can
// show previous-class results separately from the current class. Older
// databases have no class_name column on results — add it on startup and
// backfill existing rows with the student's current class (Mid Term 2026
// was taken in the current class). Promotion records already carry the
// previous class + exam + percentage, and are shown alongside.
function ensureResultsClassColumn() {
  const cols = db.prepare("PRAGMA table_info(results)").all().map(c => c.name);
  if (!cols.includes('class_name')) db.exec("ALTER TABLE results ADD COLUMN class_name TEXT DEFAULT ''");
  db.prepare("UPDATE results SET class_name=(SELECT class_name FROM students WHERE students.id=results.student_id) WHERE class_name IS NULL OR class_name=''").run();
  // Old databases have UNIQUE(student_id, exam, subject) — without the
  // class, adding the same exam+subject for a previous class would
  // overwrite the current-class result. Rebuild the table once so the
  // unique key becomes (student_id, exam, subject, class_name).
  const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='results'").get() || {}).sql || '';
  if (/UNIQUE\(student_id,\s*exam,\s*subject\)/.test(sql)) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE results_new (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, exam TEXT NOT NULL, subject TEXT NOT NULL, marks INTEGER NOT NULL, total_marks INTEGER NOT NULL DEFAULT 100, class_name TEXT DEFAULT '', UNIQUE(student_id, exam, subject, class_name));
      INSERT INTO results_new (id, student_id, exam, subject, marks, total_marks, class_name) SELECT id, student_id, exam, subject, marks, total_marks, class_name FROM results;
      DROP TABLE results;
      ALTER TABLE results_new RENAME TO results;
      COMMIT;`);
  }
}
// B-Form (Birth Form) number per student, e.g. 35202-1234567-1. Older
// databases have no b_form_no column — add it on startup. Demo/seeding
// note: seeded demo students get deterministic demo B-Form numbers
// (35202-1000000+id-1) so the field, search and profile can be shown;
// a real school must replace them with the child's real B-Form via Edit.
function ensureStudentBFormColumn() {
  const cols = db.prepare("PRAGMA table_info(students)").all().map(c => c.name);
  if (!cols.includes('b_form_no')) db.exec("ALTER TABLE students ADD COLUMN b_form_no TEXT DEFAULT ''");
  const rows = db.prepare("SELECT id FROM students WHERE b_form_no IS NULL OR b_form_no=''").all();
  const upd = db.prepare('UPDATE students SET b_form_no=? WHERE id=?');
  for (const r of rows) upd.run('35202-' + String(1000000 + r.id).padStart(7, '0') + '-' + (r.id % 10), r.id);
}
function createUser(username, password, schoolName, role, teacherId, studentId) {
  const salt = crypto.randomBytes(16).toString('hex');
  try {
    const r = db.prepare('INSERT INTO users (username,password_hash,salt,school_name,role,teacher_id,student_id,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(username, hashPassword(password, salt), salt, schoolName || 'Demo School', role || 'admin', teacherId || null, studentId || null, new Date().toISOString().slice(0, 10));
    return Number(r.lastInsertRowid);
  } catch (e) { return null; } // username already exists — keep the existing account
}
function teacherUsername(name) {
  if (name === 'Muhammad Asif') return 'asif'; // known by his second name
  return name.split(' ')[0].toLowerCase();
}
// Demo parent accounts: parent1..parent5, each linked to the first active
// student (lowest roll no) in Nursery, 1, 5, 8, 10. Password: parent123.
const PARENT_DEMO_CLASSES = ['Nursery', '1', '5', '8', '10'];
function ensureRoleAccounts() {
  ensureUserColumns();
  db.prepare("UPDATE users SET role='admin' WHERE username='admin' AND (role IS NULL OR role='')").run();
  const teachers = db.prepare('SELECT id, name FROM teachers ORDER BY id').all();
  for (const t of teachers) {
    const uname = teacherUsername(t.name);
    const existing = db.prepare('SELECT id FROM users WHERE username=?').get(uname);
    if (!existing) createUser(uname, 'teacher123', 'Demo School', 'teacher', t.id, null);
    else db.prepare('UPDATE users SET role=?, teacher_id=? WHERE id=?').run('teacher', t.id, existing.id);
  }
  PARENT_DEMO_CLASSES.forEach((cls, i) => {
    const st = db.prepare("SELECT id FROM students WHERE status='active' AND class_name=? ORDER BY CAST(roll_no AS INTEGER) LIMIT 1").get(cls);
    if (!st) return;
    const uname = 'parent' + (i + 1);
    const existing = db.prepare('SELECT id FROM users WHERE username=?').get(uname);
    if (!existing) createUser(uname, 'parent123', 'Demo School', 'parent', null, st.id);
    else db.prepare('UPDATE users SET role=?, student_id=? WHERE id=?').run('parent', st.id, existing.id);
  });
}
function setSession(req, u) {
  req.session.userId = u.id; req.session.username = u.username;
  req.session.role = u.role || 'admin';
  req.session.teacherId = u.teacher_id || null;
  req.session.studentId = u.student_id || null;
}
function teacherClasses(req) {
  if (!req.session.teacherId) return [];
  return db.prepare('SELECT DISTINCT class_name FROM teacher_assignments WHERE teacher_id=?').all(req.session.teacherId).map(r => r.class_name);
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Login required' });
    if (!roles.includes(req.session.role || 'admin')) return res.status(403).json({ error: 'Only ' + roles.join(' or ') + ' can do this' });
    next();
  };
}
const requireAdmin = requireRole('admin');
function csvCell(v) {
  const str = String(v ?? '');
  return /[",\n\r]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}
function sendCsv(res, filename, columns, rows) {
  const lines = [columns.map(csvCell).join(',')];
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.send('\uFEFF' + lines.join('\r\n'));
}
function studentProfile(id) {
  const st = db.prepare('SELECT * FROM students WHERE id=?').get(id);
  if (!st) return null;
  st.attendance = db.prepare('SELECT * FROM attendance WHERE student_id=? ORDER BY date DESC LIMIT 60').all(id);
  st.fees = db.prepare('SELECT * FROM fees WHERE student_id=? ORDER BY month').all(id);
  st.results = db.prepare('SELECT * FROM results WHERE student_id=? ORDER BY exam, subject').all(id);
  st.promotions = db.prepare('SELECT * FROM promotions WHERE student_id=? ORDER BY date DESC').all(id);
  st.leaving = db.prepare('SELECT * FROM leaving_records WHERE student_id=?').get(id) || null;
  return st;
}
function teacherProfile(id) {
  const t = db.prepare('SELECT * FROM teachers WHERE id=?').get(id);
  if (!t) return null;
  const assignments = db.prepare('SELECT * FROM teacher_assignments WHERE teacher_id=?').all(id);
  const progress = assignments.map(a => {
    const row = db.prepare("SELECT AVG(CAST(r.marks AS REAL)/r.total_marks*100) avg, COUNT(*) n FROM results r JOIN students s ON s.id=r.student_id WHERE r.exam='Mid Term 2026' AND r.subject=? AND s.class_name=? AND s.status='active'").get(a.subject, a.class_name);
    const top = db.prepare("SELECT s.name, CAST(r.marks AS REAL)/r.total_marks*100 pct FROM results r JOIN students s ON s.id=r.student_id WHERE r.exam='Mid Term 2026' AND r.subject=? AND s.class_name=? AND s.status='active' ORDER BY pct DESC LIMIT 3").all(a.subject, a.class_name);
    return { ...a, avg: row && row.avg ? Math.round(row.avg * 10) / 10 : 0, students: row ? row.n : 0, top };
  });
  const staffAtt = db.prepare('SELECT * FROM staff_attendance WHERE teacher_id=? ORDER BY date DESC LIMIT 30').all(id);
  const attPct = staffAtt.length ? Math.round(staffAtt.filter(a => a.status === 'Present').length / staffAtt.length * 1000) / 10 : 0;
  const timetable = db.prepare('SELECT * FROM timetable WHERE teacher_id=? ORDER BY day, period').all(id);
  return { ...t, assignments, progress, staffAtt, attPct, timetable };
}

// ---------- seed (runs once, only when DB is empty) ----------
function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM students').get().c > 0) return;
  console.log('Seeding demo data (249 students, 14 teachers, fees, results, timetable)...');
  db.exec('BEGIN IMMEDIATE');
  const rnd = mulberry32(20261125);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  // admin user
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO users (username,password_hash,salt,school_name,role,created_at) VALUES (?,?,?,?,?,?)')
    .run('admin', hashPassword('admin123', salt), salt, 'Demo School', 'admin', '2026-04-01');
  const firstM = ['Ahmed', 'Ali', 'Bilal', 'Hassan', 'Usman', 'Hamza', 'Omar', 'Zain', 'Danish', 'Saad', 'Fahad', 'Arslan', 'Taha', 'Rayyan', 'Ibrahim', 'Mustafa', 'Abdullah', 'Ayan'];
  const firstF = ['Ayesha', 'Fatima', 'Zainab', 'Maryam', 'Hira', 'Sara', 'Mahnoor', 'Amna', 'Iqra', 'Laiba', 'Noor', 'Khadija', 'Hafsa', 'Amina', 'Sana', 'Rania'];
  const last = ['Khan', 'Ali', 'Ahmed', 'Malik', 'Hussain', 'Shah', 'Raza', 'Butt', 'Chaudhry', 'Sheikh', 'Mirza', 'Qureshi', 'Siddiqui', 'Akhtar', 'Nawaz', 'Iqbal'];
  const studentIds = [];
  const addStudent = db.prepare('INSERT INTO students (name,father_name,class_name,section,roll_no,phone,monthly_fee,admission_date,status) VALUES (?,?,?,?,?,?,?,?,?)');
  for (const cls of CLASSES) {
    for (let i = 1; i <= CLASS_COUNTS[cls]; i++) {
      const female = rnd() < 0.45;
      const fn = female ? pick(firstF) : pick(firstM);
      const ln = pick(last);
      const name = `${fn} ${ln}`;
      const father = `${pick(firstM)} ${ln}`;
      const phone = `03${String(Math.floor(rnd() * 9) + 1)}${String(Math.floor(rnd() * 9000000) + 1000000)}`;
      const r = addStudent.run(name, father, cls, rnd() < 0.8 ? 'A' : 'B', String(i).padStart(2, '0'), phone, CLASS_FEES[cls], `2026-04-${String(Math.floor(rnd() * 20) + 1).padStart(2, '0')}`, 'active');
      studentIds.push({ id: Number(r.lastInsertRowid), cls, fee: CLASS_FEES[cls] });
    }
  }
  // results: Mid Term 2026, 6 subjects each
  const addResult = db.prepare('INSERT INTO results (student_id,exam,subject,marks,total_marks) VALUES (?,?,?,?,100)');
  for (const s of studentIds) {
    for (const subj of subjectsForClass(s.cls)) {
      addResult.run(s.id, 'Mid Term 2026', subj, 45 + Math.floor(rnd() * 54));
    }
  }
  // fees: Oct + Nov 2026. Nov must total 508100, collected 317150, pending 190950.
  const addFee = db.prepare('INSERT INTO fees (student_id,month,amount,paid,status,payment_method,payment_date) VALUES (?,?,?,?,?,?,?)');
  const feeStatus = (paid, amount) => paid === 0 ? 'pending' : paid >= amount ? 'paid' : 'partial';
  // October: 70% paid, 15% partial (half), 15% pending
  for (const s of studentIds) {
    const r = rnd();
    const paid = r < 0.7 ? s.fee : r < 0.85 ? Math.floor(s.fee / 2) : 0;
    addFee.run(s.id, '2026-10', s.fee, paid, feeStatus(paid, s.fee), paid ? pick(['Cash', 'JazzCash', 'EasyPaisa', 'Bank']) : '', paid ? '2026-10-10' : '');
  }
  // November: start with same pattern, then adjust paid amounts (in Rs 100 steps,
  // staying within [0, amount]) until collected == 317150 exactly.
  const novPaid = new Map();
  let collected = 0;
  for (const s of studentIds) {
    const r = rnd();
    const paid = r < 0.62 ? s.fee : r < 0.78 ? Math.floor(s.fee / 2) : 0;
    novPaid.set(s.id, paid); collected += paid;
  }
  const TARGET = 317150;
  let guard = 0;
  while (collected !== TARGET && guard++ < 10000) {
    for (const s of studentIds) {
      if (collected === TARGET) break;
      const cur = novPaid.get(s.id);
      if (collected < TARGET && cur < s.fee) { const d = Math.min(100, TARGET - collected, s.fee - cur); novPaid.set(s.id, cur + d); collected += d; }
      else if (collected > TARGET && cur > 0) { const d = Math.min(100, collected - TARGET, cur); novPaid.set(s.id, cur - d); collected -= d; }
    }
  }
  for (const s of studentIds) {
    const paid = novPaid.get(s.id);
    addFee.run(s.id, '2026-11', s.fee, paid, feeStatus(paid, s.fee), paid ? pick(['Cash', 'JazzCash', 'EasyPaisa', 'Bank']) : '', paid ? '2026-11-10' : '');
  }
  console.log('Nov fees check: total=508100 collected=' + collected + ' pending=' + (508100 - collected));
  console.log('seed: teachers start');
  // teachers (14)
  const teachers = [
    ['Ahmed Raza', 'Senior Teacher', 'M.Sc Maths', 65000, 'Maths'],
    ['Fatima Zahra', 'Senior Teacher', 'M.A English', 62000, 'English'],
    ['Muhammad Asif', 'Teacher', 'M.A Urdu', 55000, 'Urdu'],
    ['Ayesha Khan', 'Science Teacher', 'M.Sc Physics', 60000, 'Science'],
    ['Bilal Hussain', 'Teacher', 'M.Sc Chemistry', 60000, 'Chemistry'],
    ['Sana Malik', 'Teacher', 'M.Sc Biology', 58000, 'Biology'],
    ['Usman Ghani', 'Teacher', 'M.Sc Physics', 58000, 'Physics'],
    ['Maryam Nawaz', 'Junior Teacher', 'B.Ed', 45000, 'Islamiat'],
    ['Hassan Ali', 'Computer Teacher', 'BCS', 55000, 'Computer'],
    ['Hira Shah', 'Junior Teacher', 'M.A Social Studies', 48000, 'Social Studies'],
    ['Omar Farooq', 'Junior Teacher', 'B.A', 42000, 'Drawing'],
    ['Zainab Bibi', 'Qaria', 'Hafiz-e-Quran', 40000, 'Nazra Quran'],
    ['Danish Iqbal', 'Junior Teacher', 'B.Ed', 44000, 'Rhymes'],
    ['Amna Tariq', 'Teacher', 'M.Sc Maths', 56000, 'Maths'],
  ];
  const addTeacher = db.prepare('INSERT INTO teachers (name,designation,qualification,salary,phone,subjects) VALUES (?,?,?,?,?,?)');
  const teacherIds = [];
  teachers.forEach(([name, des, qual, sal, subj], i) => {
    const phone = `03${String(10 + i)}${String(2000000 + i * 111111)}`;
    const r = addTeacher.run(name, des, qual, sal, phone, subj);
    teacherIds.push({ id: Number(r.lastInsertRowid), subject: subj });
  });
  console.log('seed: assignments start');
  // assignments: each teacher 5 class+subject combos = 70
  const addAssign = db.prepare('INSERT OR IGNORE INTO teacher_assignments (teacher_id,class_name,subject) VALUES (?,?,?)');
  const classForSubject = (subj) => CLASSES.filter(c => subjectsForClass(c).includes(subj));
  teacherIds.forEach((t, ti) => {
    // 5 UNIQUE (class, subject) assignments per teacher = 70 total.
    // Prefer the teacher's own subject when that class teaches it.
    let made = 0, idx = ti;
    while (made < 5 && idx < ti + 60) {
      const cls = CLASSES[idx % CLASSES.length];
      const subs = subjectsForClass(cls);
      const subj = subs.includes(t.subject) ? t.subject : subs[idx % subs.length];
      const r = addAssign.run(t.id, cls, subj);
      if (r.changes) made++;
      idx++;
    }
  });
  console.log('seed: staff attendance start');
  // staff attendance 24-25 Nov 2026 (28 rows)
  const addStaffAtt = db.prepare('INSERT INTO staff_attendance (teacher_id,date,status) VALUES (?,?,?)');
  for (const t of teacherIds) {
    addStaffAtt.run(t.id, '2026-11-24', rnd() < 0.95 ? 'Present' : 'Leave');
    addStaffAtt.run(t.id, '2026-11-25', rnd() < 0.95 ? 'Present' : 'Leave');
  }
  console.log('seed: leaving start');
  // leaving records: 8 students (mark status left)
  const leaving = [
    ['Family shifted to Lahore', '2026-10-15', 'SLC-2026-001'],
    ['Family shifted to Karachi', '2026-10-20', 'SLC-2026-002'],
    ['Admission in another school', '2026-11-05', 'SLC-2026-003'],
    ['Family shifted abroad', '2026-09-28', 'SLC-2026-004'],
    ['Financial problems', '2026-10-30', 'SLC-2026-005'],
    ['Family shifted to Islamabad', '2026-11-12', 'SLC-2026-006'],
    ['Admission in another school', '2026-10-08', 'SLC-2026-007'],
    ['Family shifted to Multan', '2026-11-18', 'SLC-2026-008'],
  ];
  const leftIds = [];
  for (let i = 0; i < 8; i++) {
    const s = studentIds[20 + i * 28];
    leftIds.push(s.id);
    db.prepare("UPDATE students SET status='left' WHERE id=?").run(s.id);
    db.prepare('INSERT INTO leaving_records (student_id,leaving_date,reason,last_class,slc_number) VALUES (?,?,?,?,?)')
      .run(s.id, leaving[i][1], leaving[i][0], s.cls, leaving[i][2]);
  }
  console.log('seed: promotions start');
  // promotions: 224 records for active students
  const prevClass = { Nursery: 'Playgroup', KG: 'Nursery', '1': 'KG', '2': '1', '3': '2', '4': '3', '5': '4', '6': '5', '7': '6', '8': '7', '9': '8', '10': '9' };
  const addPromo = db.prepare('INSERT INTO promotions (student_id,from_class,to_class,exam,percentage,date) VALUES (?,?,?,?,?,?)');
  const active = studentIds.filter(s => !leftIds.includes(s.id));
  active.slice(0, 224).forEach(s => {
    addPromo.run(s.id, prevClass[s.cls], s.cls, 'Annual Exam 2025', Math.round((55 + rnd() * 38) * 10) / 10, '2026-03-31');
  });
  console.log('seed: attendance start');
  // attendance 24-25 Nov 2026 for active students (241)
  const addAtt = db.prepare('INSERT INTO attendance (student_id,date,status,class_name) VALUES (?,?,?,?)');
  const mkDay = (date, nPresent, nAbsent, nLate) => {
    const shuffled = [...active];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    shuffled.forEach((s, idx) => {
      const st = idx < nPresent ? 'Present' : idx < nPresent + nAbsent ? 'Absent' : idx < nPresent + nAbsent + nLate ? 'Late' : 'Leave';
      addAtt.run(s.id, date, st, s.cls);
    });
  };
  mkDay('2026-11-24', 228, 8, 4); // +1 Leave = 241
  mkDay('2026-11-25', 230, 7, 3); // +1 Leave = 241
  console.log('seed: timetable start');
  // timetable: 12 classes x Mon-Sat x 6 periods = 432
  const addTT = db.prepare('INSERT INTO timetable (class_name,day,period,subject,teacher_id,start_time,end_time) VALUES (?,?,?,?,?,?,?)');
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const times = [['08:00', '08:45'], ['08:45', '09:30'], ['09:30', '10:15'], ['10:45', '11:30'], ['11:30', '12:15'], ['12:15', '13:00']];
  const teacherFor = (cls, subj) => {
    const row = db.prepare('SELECT teacher_id FROM teacher_assignments WHERE class_name=? AND subject=? LIMIT 1').get(cls, subj);
    if (row) return row.teacher_id;
    const row2 = db.prepare('SELECT teacher_id FROM teacher_assignments WHERE subject=? LIMIT 1').get(subj);
    return row2 ? row2.teacher_id : teacherIds[0].id;
  };
  for (const cls of CLASSES) {
    const subs = subjectsForClass(cls);
    days.forEach((day, di) => {
      for (let p = 1; p <= 6; p++) {
        const subj = subs[(di * 6 + p - 1) % subs.length];
        addTT.run(cls, day, p, subj, teacherFor(cls, subj), times[p - 1][0], times[p - 1][1]);
      }
    });
  }
  db.exec('COMMIT');
  console.log('Seed complete: students=' + studentIds.length + ', active=' + active.length + ', teachers=' + teacherIds.length);
}
ensureTeacherColumns();
ensureStudentBFormColumn();
seed();
ensureTeacherColumns();
ensureResultsClassColumn();
ensureStudentBFormColumn();
ensureRoleAccounts();

// ---------- app ----------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'school-management-dev-secret-change-me',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 },
}));
app.use(express.static(path.join(__dirname, 'public')));

const requireAuth = (req, res, next) => {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Login required' });
};

// auth (roles: admin / teacher / parent — server decides the role from the account, never from the client)
app.post('/api/register', (req, res) => {
  const { username, password, schoolName, role, phone, rollNo, className } = req.body || {};
  const wantRole = role || 'admin';
  if (!password || password.length < 4) return res.status(400).json({ error: 'Password (min 4 chars) required' });
  if (wantRole === 'teacher') return res.status(403).json({ error: 'Teacher accounts are created by admin. Demo teacher login: e.g. ahmed / teacher123' });
  if (wantRole === 'parent') {
    if (!phone || !rollNo || !className) return res.status(400).json({ error: 'Parent registration needs parent phone, student roll no and class' });
    const st = db.prepare("SELECT * FROM students WHERE phone=? AND roll_no=? AND class_name=? AND status='active'").get(String(phone).trim(), String(rollNo).trim(), className);
    if (!st) return res.status(400).json({ error: 'No active student found with that phone, roll no and class. Check the details with the school office.' });
    const uname = (username || String(phone).trim());
    const id = createUser(uname, password, schoolName || 'Demo School', 'parent', null, st.id);
    if (!id) return res.status(400).json({ error: 'Username already exists — try another username' });
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    setSession(req, u);
    return res.json({ ok: true, username: u.username, schoolName: u.school_name, role: 'parent', studentId: st.id, studentName: st.name });
  }
  if (!username) return res.status(400).json({ error: 'Username required' });
  const id = createUser(username, password, schoolName || 'My School', 'admin', null, null);
  if (!id) return res.status(400).json({ error: 'Username already exists' });
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  setSession(req, u);
  res.json({ ok: true, username: u.username, schoolName: u.school_name, role: 'admin' });
});
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!u || hashPassword(password || '', u.salt) !== u.password_hash) return res.status(401).json({ error: 'Wrong username or password' });
  setSession(req, u);
  res.json({ ok: true, username: u.username, schoolName: u.school_name, role: u.role || 'admin', teacherId: u.teacher_id || null, studentId: u.student_id || null });
});
app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });
app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  const u = db.prepare('SELECT username, school_name, role, teacher_id, student_id FROM users WHERE id=?').get(req.session.userId);
  if (!u) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, username: u.username, schoolName: u.school_name, role: u.role || 'admin', teacherId: u.teacher_id || null, studentId: u.student_id || null });
});
// scoped self endpoints (no other student's / teacher's data)
app.get('/api/my-child', requireRole('parent'), (req, res) => {
  if (!req.session.studentId) return res.status(403).json({ error: 'No child linked to this parent account' });
  const prof = studentProfile(req.session.studentId);
  if (!prof) return res.status(404).json({ error: 'Child not found' });
  res.json(prof);
});
app.get('/api/my-teacher', requireRole('teacher'), (req, res) => {
  if (!req.session.teacherId) return res.status(403).json({ error: 'No teacher linked to this account' });
  const prof = teacherProfile(req.session.teacherId);
  if (!prof) return res.status(404).json({ error: 'Teacher not found' });
  delete prof.salary; // teachers never see salaries, even their own, in the UI
  res.json(prof);
});

// dashboard (scoped by role — teachers never get fees/salaries, parents only get their child)
app.get('/api/dashboard', requireAuth, (req, res) => {
  const today = req.query.today || '2026-11-25';
  const month = req.query.month || '2026-11';
  const role = req.session.role || 'admin';
  if (role === 'teacher') {
    const my = teacherClasses(req);
    const myAssign = db.prepare('SELECT * FROM teacher_assignments WHERE teacher_id=?').all(req.session.teacherId);
    const myStudents = my.length ? db.prepare("SELECT COUNT(*) c FROM students WHERE status='active' AND class_name IN (" + my.map(() => '?').join(',') + ')').get(...my).c : 0;
    const att = my.length ? db.prepare('SELECT status, COUNT(*) c FROM attendance WHERE date=? AND class_name IN (' + my.map(() => '?').join(',') + ') GROUP BY status').all(today, ...my) : [];
    const present = (att.find(a => a.status === 'Present') || { c: 0 }).c;
    const prof = teacherProfile(req.session.teacherId);
    const staffAtt = db.prepare('SELECT * FROM staff_attendance WHERE teacher_id=? ORDER BY date DESC LIMIT 30').all(req.session.teacherId);
    const attPct = staffAtt.length ? Math.round(staffAtt.filter(a => a.status === 'Present').length / staffAtt.length * 1000) / 10 : 0;
    return res.json({ role, today, month, myClasses: my, mySubjects: [...new Set(myAssign.map(a => a.subject))], myStudents, present, attendance: att, progress: prof ? prof.progress : [], attPct, teacherName: prof ? prof.name : '' });
  }
  if (role === 'parent') {
    const prof = studentProfile(req.session.studentId);
    if (!prof) return res.status(404).json({ error: 'Child not found' });
    const attTotal = prof.attendance.length;
    const attPresent = prof.attendance.filter(a => a.status === 'Present').length;
    const feesTotal = prof.fees.reduce((a, f) => a + f.amount, 0);
    const feesPaid = prof.fees.reduce((a, f) => a + f.paid, 0);
    const totalMarks = prof.results.reduce((a, r) => a + r.marks, 0), totalOf = prof.results.reduce((a, r) => a + r.total_marks, 0);
    const pct = totalOf ? Math.round(totalMarks / totalOf * 1000) / 10 : 0;
    return res.json({ role, today, month, child: { id: prof.id, name: prof.name, class_name: prof.class_name, section: prof.section, roll_no: prof.roll_no, father_name: prof.father_name }, attPct: attTotal ? Math.round(attPresent / attTotal * 1000) / 10 : 0, attTotal, attPresent, feesTotal, feesPaid, feesPending: feesTotal - feesPaid, resultPct: pct, grade: grade(pct) });
  }
  const total = db.prepare("SELECT COUNT(*) c FROM students WHERE status='active'").get().c;
  const totalAll = db.prepare('SELECT COUNT(*) c FROM students').get().c;
  const att = db.prepare('SELECT status, COUNT(*) c FROM attendance WHERE date=? GROUP BY status').all(today);
  const present = (att.find(a => a.status === 'Present') || { c: 0 }).c;
  const fees = db.prepare('SELECT COALESCE(SUM(amount),0) total, COALESCE(SUM(paid),0) collected FROM fees WHERE month=?').get(month);
  const pending = db.prepare("SELECT COUNT(*) c FROM fees WHERE month=? AND status!='paid'").get(month).c;
  const teachers = db.prepare('SELECT COUNT(*) c FROM teachers').get().c;
  const staffPresent = db.prepare("SELECT COUNT(*) c FROM staff_attendance WHERE date=? AND status='Present'").get(today).c;
  const left = db.prepare('SELECT COUNT(*) c FROM leaving_records').get().c;
  const promoted = db.prepare('SELECT COUNT(*) c FROM promotions').get().c;
  const byClass = db.prepare("SELECT class_name, COUNT(*) c FROM students WHERE status='active' GROUP BY class_name").all();
  res.json({ role, total, totalAll, today, month, present, attendance: att, feesTotal: fees.total, feesCollected: fees.collected, feesPending: fees.total - fees.collected, feesPendingCount: pending, teachers, staffPresent, left, promoted, byClass });
});

// students
app.get('/api/students', requireAuth, (req, res) => {
  const { class: cls, search, status, mode, roll } = req.query;
  const role = req.session.role || 'admin';
  if (role === 'parent') {
    if (!req.session.studentId) return res.status(403).json({ error: 'No child linked to this parent account' });
    return res.json(db.prepare('SELECT * FROM students WHERE id=?').all(req.session.studentId));
  }
  let sql = 'SELECT * FROM students WHERE 1=1'; const p = [];
  if (cls) { sql += ' AND class_name=?'; p.push(cls); }
  if (status) { sql += ' AND status=?'; p.push(status); }
  // Search modes (Students tab search bar): name (default), bform, classroll.
  // - name: name / father name / roll no contains the text.
  // - bform: B-Form number contains the text (dashes optional in the query).
  // - classroll: exact Class + Roll No. (class comes from ?class=, roll from ?roll=).
  if (mode === 'bform' && search) {
    const q = String(search).replace(/[-\s]/g, '');
    sql += ' AND REPLACE(REPLACE(b_form_no, \'-\', \'\'), \' \', \'\') LIKE ?'; p.push(`%${q}%`);
  } else if (mode === 'classroll') {
    if (roll) { const r = String(roll).trim(); sql += ' AND (roll_no=? OR roll_no=?)'; p.push(r, r.padStart(2, '0')); }
  } else if (search) { sql += ' AND (name LIKE ? OR father_name LIKE ? OR roll_no LIKE ? OR b_form_no LIKE ?)'; p.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
  if (role === 'teacher') {
    const my = teacherClasses(req);
    if (!my.length) return res.json([]);
    if (cls && !my.includes(cls)) return res.json([]);
    sql += ' AND class_name IN (' + my.map(() => '?').join(',') + ')'; p.push(...my);
  }
  sql += ' ORDER BY class_name, CAST(roll_no AS INTEGER)';
  res.json(db.prepare(sql).all(...p));
});
app.get('/api/classes', requireAuth, (req, res) => res.json(CLASSES));
app.post('/api/students', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.class_name) return res.status(400).json({ error: 'Name and class required' });
  const r = db.prepare('INSERT INTO students (name,father_name,class_name,section,roll_no,phone,monthly_fee,admission_date,b_form_no,status) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(b.name, b.father_name || '', b.class_name, b.section || 'A', b.roll_no || '', b.phone || '', b.monthly_fee || 0, b.admission_date || '', (b.b_form_no || '').trim(), 'active');
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
});
app.put('/api/students/:id', requireAdmin, (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE students SET name=?,father_name=?,class_name=?,section=?,roll_no=?,phone=?,monthly_fee=?,admission_date=?,b_form_no=? WHERE id=?')
    .run(b.name, b.father_name || '', b.class_name, b.section || 'A', b.roll_no || '', b.phone || '', b.monthly_fee || 0, b.admission_date || '', (b.b_form_no || '').trim(), req.params.id);
  res.json({ ok: true });
});
app.delete('/api/students/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM students WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
app.get('/api/students/:id', requireAuth, (req, res) => {
  const s = db.prepare('SELECT * FROM students WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const role = req.session.role || 'admin';
  if (role === 'parent' && Number(req.params.id) !== req.session.studentId) return res.status(403).json({ error: 'You can only see your own child' });
  if (role === 'teacher' && !teacherClasses(req).includes(s.class_name)) return res.status(403).json({ error: 'This student is not in your classes' });
  res.json(studentProfile(s.id));
});
app.post('/api/students/:id/leave', requireAdmin, (req, res) => {
  const b = req.body || {};
  db.prepare("UPDATE students SET status='left' WHERE id=?").run(req.params.id);
  const s = db.prepare('SELECT class_name FROM students WHERE id=?').get(req.params.id);
  db.prepare('INSERT OR REPLACE INTO leaving_records (student_id,leaving_date,reason,last_class,slc_number) VALUES (?,?,?,?,?)')
    .run(req.params.id, b.leaving_date || new Date().toISOString().slice(0, 10), b.reason || '', s.class_name, b.slc_number || '');
  res.json({ ok: true });
});
app.post('/api/students/:id/promote', requireAdmin, (req, res) => {
  const b = req.body || {};
  const s = db.prepare('SELECT class_name FROM students WHERE id=?').get(req.params.id);
  db.prepare('INSERT INTO promotions (student_id,from_class,to_class,exam,percentage,date) VALUES (?,?,?,?,?,?)')
    .run(req.params.id, s.class_name, b.to_class, b.exam || 'Annual Exam', b.percentage || 0, b.date || new Date().toISOString().slice(0, 10));
  db.prepare("UPDATE students SET class_name=? WHERE id=?").run(b.to_class, req.params.id);
  res.json({ ok: true });
});

// attendance
app.get('/api/attendance', requireAuth, (req, res) => {
  const { date, class: cls } = req.query;
  if (!date) return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
  const role = req.session.role || 'admin';
  let sql = 'SELECT a.*, s.name FROM attendance a JOIN students s ON s.id=a.student_id WHERE a.date=?'; const p = [date];
  if (role === 'parent') { sql += ' AND a.student_id=?'; p.push(req.session.studentId); }
  else if (role === 'teacher') {
    const my = teacherClasses(req);
    if (cls && !my.includes(cls)) return res.status(403).json({ error: 'This class is not yours' });
    if (!my.length) return res.json([]);
    sql += ' AND a.class_name IN (' + my.map(() => '?').join(',') + ')'; p.push(...my);
  }
  if (cls) { sql += ' AND a.class_name=?'; p.push(cls); }
  res.json(db.prepare(sql + ' ORDER BY a.class_name, s.name').all(...p));
});
app.post('/api/attendance', requireRole('admin', 'teacher'), (req, res) => {
  const { date, records } = req.body || {};
  if (!date || !Array.isArray(records)) return res.status(400).json({ error: 'date and records required' });
  const my = (req.session.role || 'admin') === 'teacher' ? teacherClasses(req) : null;
  const ins = db.prepare('INSERT INTO attendance (student_id,date,status,class_name) VALUES (?,?,?,?) ON CONFLICT(student_id,date) DO UPDATE SET status=excluded.status');
  for (const r of records) {
    const s = db.prepare('SELECT class_name FROM students WHERE id=?').get(r.student_id);
    if (!s) continue;
    if (my && !my.includes(s.class_name)) return res.status(403).json({ error: 'You can only mark attendance for your own classes' });
    ins.run(r.student_id, date, r.status, s.class_name);
  }
  res.json({ ok: true, saved: records.length });
});
app.get('/api/attendance/summary', requireAuth, (req, res) => {
  const { month, class: cls } = req.query;
  if (!month) return res.status(400).json({ error: 'month required (YYYY-MM)' });
  let rows = db.prepare("SELECT student_id, COUNT(*) total, SUM(CASE WHEN status='Present' THEN 1 ELSE 0 END) present FROM attendance WHERE substr(date,1,7)=? GROUP BY student_id").all(month);
  const role = req.session.role || 'admin';
  if (role === 'parent') rows = rows.filter(r => r.student_id === req.session.studentId);
  if (role === 'teacher') {
    const my = teacherClasses(req);
    const ids = new Set(db.prepare("SELECT id FROM students WHERE class_name IN (" + my.map(() => '?').join(',') + ')').all(...my).map(x => x.id));
    rows = rows.filter(r => ids.has(r.student_id));
  }
  res.json(rows.map(r => ({ student_id: r.student_id, total: r.total, present: r.present, pct: r.total ? Math.round(r.present / r.total * 1000) / 10 : 0 })));
});

// fees
app.get('/api/fees', requireAdmin, (req, res) => {
  const month = req.query.month || '2026-11';
  const { search, class: cls } = req.query;
  let sql = 'SELECT f.*, s.name, s.class_name, s.father_name, s.b_form_no FROM fees f JOIN students s ON s.id=f.student_id WHERE f.month=?'; const p = [month];
  if (cls) { sql += ' AND s.class_name=?'; p.push(cls); }
  if (search) { sql += ' AND (s.name LIKE ? OR s.father_name LIKE ? OR s.roll_no LIKE ? OR s.b_form_no LIKE ?)'; p.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
  res.json(db.prepare(sql + ' ORDER BY s.class_name, s.name').all(...p));
});
app.post('/api/fees/generate', requireAdmin, (req, res) => {
  const month = (req.body || {}).month || '2026-11';
  const students = db.prepare('SELECT id, monthly_fee FROM students').all();
  const ins = db.prepare('INSERT OR IGNORE INTO fees (student_id,month,amount,paid,status) VALUES (?,?,?,0,?)');
  let n = 0; for (const s of students) { const r = ins.run(s.id, month, s.monthly_fee, 'pending'); if (r.changes) n++; }
  res.json({ ok: true, created: n, month });
});
app.post('/api/fees/:id/pay', requireAdmin, (req, res) => {
  const { amount, method } = req.body || {};
  const f = db.prepare('SELECT * FROM fees WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  const paid = Math.min(f.amount, f.paid + (Number(amount) || 0));
  const status = paid === 0 ? 'pending' : paid >= f.amount ? 'paid' : 'partial';
  db.prepare('UPDATE fees SET paid=?, status=?, payment_method=?, payment_date=? WHERE id=?')
    .run(paid, status, method || f.payment_method || 'Cash', new Date().toISOString().slice(0, 10), req.params.id);
  res.json({ ok: true, paid, status });
});

// results
app.get('/api/results', requireAuth, (req, res) => {
  const { exam, class: cls, search } = req.query;
  let sql = 'SELECT r.*, s.name, s.class_name, s.roll_no FROM results r JOIN students s ON s.id=r.student_id WHERE 1=1'; const p = [];
  if (exam) { sql += ' AND r.exam=?'; p.push(exam); }
  if (cls) { sql += ' AND s.class_name=?'; p.push(cls); }
  if (search) { sql += ' AND (s.name LIKE ? OR s.roll_no LIKE ? OR r.subject LIKE ?)'; p.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  let rows = db.prepare(sql + ' ORDER BY s.class_name, s.name, r.subject').all(...p);
  const role = req.session.role || 'admin';
  if (role === 'parent') rows = rows.filter(r => r.student_id === req.session.studentId);
  if (role === 'teacher') {
    const allowed = new Set(db.prepare('SELECT class_name, subject FROM teacher_assignments WHERE teacher_id=?').all(req.session.teacherId).map(a => a.class_name + '|' + a.subject));
    rows = rows.filter(r => allowed.has(r.class_name + '|' + r.subject));
  }
  res.json(rows);
});
app.post('/api/results', requireRole('admin', 'teacher'), (req, res) => {
  const b = req.body || {};
  if (!b.student_id || !b.exam || !b.subject) return res.status(400).json({ error: 'student, exam and subject required' });
  const marks = Number(b.marks), totalMarks = Number(b.total_marks) || 100;
  if (!Number.isFinite(marks) || marks < 0 || marks > totalMarks) return res.status(400).json({ error: 'Marks must be between 0 and total marks (' + totalMarks + ')' });
  const st = db.prepare('SELECT * FROM students WHERE id=?').get(b.student_id);
  if (!st) return res.status(404).json({ error: 'Student not found' });
  // The result can belong to the student's current class OR a previous
  // class (chosen in the Add Result form) — that is how previous-class
  // results are added. Default: the student's current class.
  const resultClass = CLASSES.includes(b.class_name) ? b.class_name : st.class_name;
  // Teachers may only add results for their own assigned class+subject.
  if ((req.session.role || 'admin') === 'teacher') {
    const ok = db.prepare('SELECT 1 FROM teacher_assignments WHERE teacher_id=? AND class_name=? AND subject=?').get(req.session.teacherId, resultClass, b.subject);
    if (!ok) return res.status(403).json({ error: 'You can only add results for your own assigned subjects (Class ' + resultClass + ' ' + b.subject + ' is not assigned to you)' });
  }
  db.prepare('INSERT INTO results (student_id,exam,subject,marks,total_marks,class_name) VALUES (?,?,?,?,?,?) ON CONFLICT(student_id,exam,subject,class_name) DO UPDATE SET marks=excluded.marks, total_marks=excluded.total_marks')
    .run(b.student_id, b.exam, b.subject, marks, totalMarks, resultClass);
  res.json({ ok: true, class_name: resultClass });
});
app.delete('/api/results/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM results WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// teachers & staff
app.get('/api/teachers', requireAuth, (req, res) => {
  const role = req.session.role || 'admin';
  if (role === 'parent') return res.status(403).json({ error: 'Parents cannot see the teachers list' });
  if (role === 'teacher') {
    const t = db.prepare('SELECT * FROM teachers WHERE id=?').get(req.session.teacherId);
    if (!t) return res.json([]);
    delete t.salary;
    return res.json([{ ...t, assignments: db.prepare('SELECT * FROM teacher_assignments WHERE teacher_id=?').all(t.id) }]);
  }
  const { search } = req.query;
  let teachers = db.prepare('SELECT * FROM teachers ORDER BY name').all();
  if (search) {
    const q = String(search).toLowerCase();
    teachers = teachers.filter(t => (t.name + ' ' + (t.designation || '') + ' ' + (t.qualification || '') + ' ' + (t.subjects || '') + ' ' + (t.phone || '')).toLowerCase().includes(q));
  }
  res.json(teachers.map(t => ({
    ...t,
    assignments: db.prepare('SELECT * FROM teacher_assignments WHERE teacher_id=?').all(t.id),
  })));
});
app.post('/api/teachers', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Name required' });
  // Assignments may come as an array [{class_name, subject}] — derive the
  // teacher's subjects list from them; fall back to the plain subjects string.
  const assignments = Array.isArray(b.assignments) ? b.assignments.filter(a => a && a.class_name && a.subject) : [];
  const subjects = assignments.length
    ? [...new Set(assignments.map(a => a.subject))].join(', ')
    : (b.subjects || '');
  const r = db.prepare('INSERT INTO teachers (name,father_name,cnic,dob,email,address,experience,joining_date,designation,qualification,salary,phone,subjects) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(b.name, b.father_name || '', b.cnic || '', b.dob || '', b.email || '', b.address || '', b.experience || '', b.joining_date || '', b.designation || '', b.qualification || '', b.salary || 0, b.phone || '', subjects);
  const teacherId = Number(r.lastInsertRowid);
  const insAssign = db.prepare('INSERT OR IGNORE INTO teacher_assignments (teacher_id,class_name,subject) VALUES (?,?,?)');
  for (const a of assignments) insAssign.run(teacherId, a.class_name, a.subject);
  // Create the teacher's login immediately (no server restart needed).
  // Username = first name, lowercase (Muhammad Asif -> asif, as in the seed);
  // if that username is taken, append 2, 3, ... Password is teacher123.
  let loginUsername = teacherUsername(b.name);
  let suffix = 2;
  while (db.prepare('SELECT id FROM users WHERE username=?').get(loginUsername)) {
    loginUsername = teacherUsername(b.name) + suffix++;
  }
  createUser(loginUsername, 'teacher123', 'Demo School', 'teacher', teacherId, null);
  res.json({ ok: true, id: teacherId, loginUsername, loginPassword: 'teacher123', assignmentsSaved: assignments.length });
});
app.put('/api/teachers/:id', requireAdmin, (req, res) => {
  const b = req.body || {};
  const t = db.prepare('SELECT * FROM teachers WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Teacher not found' });
  if (!b.name) return res.status(400).json({ error: 'Name required' });
  // Full-info edit: every profile field is editable, including for the 14
  // seeded teachers whose new fields start empty.
  db.prepare('UPDATE teachers SET name=?,father_name=?,cnic=?,dob=?,email=?,address=?,experience=?,joining_date=?,designation=?,qualification=?,salary=?,phone=?,subjects=? WHERE id=?')
    .run(b.name, b.father_name || '', b.cnic || '', b.dob || '', b.email || '', b.address || '', b.experience || '', b.joining_date || '', b.designation || '', b.qualification || '', b.salary || 0, b.phone || '', b.subjects || t.subjects || '', req.params.id);
  // If assignments were sent, replace them (so edits can change classes/subjects).
  if (Array.isArray(b.assignments)) {
    db.prepare('DELETE FROM teacher_assignments WHERE teacher_id=?').run(req.params.id);
    const ins = db.prepare('INSERT OR IGNORE INTO teacher_assignments (teacher_id,class_name,subject) VALUES (?,?,?)');
    const subs = [...new Set(b.assignments.filter(a => a && a.class_name && a.subject).map(a => { ins.run(req.params.id, a.class_name, a.subject); return a.subject; }))];
    if (subs.length) db.prepare('UPDATE teachers SET subjects=? WHERE id=?').run(subs.join(', '), req.params.id);
  }
  res.json({ ok: true });
});
app.get('/api/teachers/:id', requireAuth, (req, res) => {
  const role = req.session.role || 'admin';
  if (role === 'parent') return res.status(403).json({ error: 'Parents cannot see teacher profiles' });
  if (role === 'teacher' && Number(req.params.id) !== req.session.teacherId) return res.status(403).json({ error: 'You can only see your own profile' });
  const prof = teacherProfile(Number(req.params.id));
  if (!prof) return res.status(404).json({ error: 'Not found' });
  if (role !== 'admin') delete prof.salary;
  res.json(prof);
});
app.post('/api/teachers/:id/assignments', requireAdmin, (req, res) => {
  const b = req.body || {};
  db.prepare('INSERT OR IGNORE INTO teacher_assignments (teacher_id,class_name,subject) VALUES (?,?,?)').run(req.params.id, b.class_name, b.subject);
  res.json({ ok: true });
});
app.get('/api/staff-attendance', requireAdmin, (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  res.json(db.prepare('SELECT sa.*, t.name FROM staff_attendance sa JOIN teachers t ON t.id=sa.teacher_id WHERE sa.date=? ORDER BY t.name').all(date));
});
app.post('/api/staff-attendance', requireAdmin, (req, res) => {
  const { date, records } = req.body || {};
  if (!date || !Array.isArray(records)) return res.status(400).json({ error: 'date and records required' });
  const ins = db.prepare('INSERT INTO staff_attendance (teacher_id,date,status) VALUES (?,?,?) ON CONFLICT(teacher_id,date) DO UPDATE SET status=excluded.status');
  for (const r of records) ins.run(r.teacher_id, date, r.status);
  res.json({ ok: true, saved: records.length });
});

// leaving / promotions
app.get('/api/leaving', requireAdmin, (req, res) => {
  const { search } = req.query;
  let sql = 'SELECT l.*, s.name, s.father_name, s.phone FROM leaving_records l JOIN students s ON s.id=l.student_id WHERE 1=1'; const p = [];
  if (search) { sql += ' AND (s.name LIKE ? OR s.father_name LIKE ? OR l.reason LIKE ? OR l.slc_number LIKE ?)'; p.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
  res.json(db.prepare(sql + ' ORDER BY l.leaving_date DESC').all(...p));
});
app.get('/api/promotions', requireAdmin, (req, res) => {
  const { search } = req.query;
  let sql = 'SELECT p.*, s.name, s.class_name FROM promotions p JOIN students s ON s.id=p.student_id WHERE 1=1'; const p = [];
  if (search) { sql += ' AND (s.name LIKE ? OR p.exam LIKE ?)'; p.push(`%${search}%`, `%${search}%`); }
  res.json(db.prepare(sql + ' ORDER BY p.date DESC, s.name LIMIT 500').all(...p));
});

// timetable
app.get('/api/timetable', requireAuth, (req, res) => {
  const { class: cls } = req.query;
  const role = req.session.role || 'admin';
  let sql = 'SELECT tt.*, t.name teacher_name FROM timetable tt LEFT JOIN teachers t ON t.id=tt.teacher_id WHERE 1=1'; const p = [];
  if (role === 'teacher') { sql += ' AND tt.teacher_id=?'; p.push(req.session.teacherId); }
  if (role === 'parent') {
    const child = db.prepare('SELECT class_name FROM students WHERE id=?').get(req.session.studentId);
    if (!child) return res.json([]);
    sql += ' AND tt.class_name=?'; p.push(child.class_name);
  }
  if (cls) { sql += ' AND tt.class_name=?'; p.push(cls); }
  res.json(db.prepare(sql + ' ORDER BY tt.day, tt.period').all(...p));
});
app.post('/api/timetable/regenerate', requireAdmin, (req, res) => {
  // Rebuild timetable from current teacher assignments (same rotation as seed)
  db.prepare('DELETE FROM timetable').run();
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const times = [['08:00', '08:45'], ['08:45', '09:30'], ['09:30', '10:15'], ['10:45', '11:30'], ['11:30', '12:15'], ['12:15', '13:00']];
  const teacherFor = (cls, subj) => {
    const row = db.prepare('SELECT teacher_id FROM teacher_assignments WHERE class_name=? AND subject=? LIMIT 1').get(cls, subj);
    if (row) return row.teacher_id;
    const row2 = db.prepare('SELECT teacher_id FROM teacher_assignments WHERE subject=? LIMIT 1').get(subj);
    return row2 ? row2.teacher_id : null;
  };
  const addTT = db.prepare('INSERT INTO timetable (class_name,day,period,subject,teacher_id,start_time,end_time) VALUES (?,?,?,?,?,?,?)');
  for (const cls of CLASSES) {
    const subs = subjectsForClass(cls);
    days.forEach((day, di) => {
      for (let p = 1; p <= 6; p++) {
        const subj = subs[(di * 6 + p - 1) % subs.length];
        addTT.run(cls, day, p, subj, teacherFor(cls, subj), times[p - 1][0], times[p - 1][1]);
      }
    });
  }
  res.json({ ok: true, periods: 432 });
});

// ---------- export & backup (admin only) ----------
// CSVs use proper quoting (names with commas/quotes stay intact) and a
// UTF-8 BOM so Urdu/English names open correctly in Excel.
app.get('/api/export/students', requireAdmin, (req, res) => {
  const { class: cls, search } = req.query;
  let sql = 'SELECT * FROM students WHERE 1=1'; const p = [];
  if (cls) { sql += ' AND class_name=?'; p.push(cls); }
  if (search) { sql += ' AND (name LIKE ? OR father_name LIKE ? OR roll_no LIKE ? OR b_form_no LIKE ?)'; p.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
  const rows = db.prepare(sql + ' ORDER BY class_name, CAST(roll_no AS INTEGER)').all(...p);
  sendCsv(res, 'students.csv', ['ID', 'Name', 'Father Name', 'Class', 'Section', 'Roll No', 'Parent Phone', 'B-Form No', 'Monthly Fee (Rs)', 'Admission Date', 'Status'],
    rows.map(s => [s.id, s.name, s.father_name, s.class_name, s.section, s.roll_no, s.phone, s.b_form_no || '', s.monthly_fee, s.admission_date, s.status]));
});
app.get('/api/export/fees', requireAdmin, (req, res) => {
  const month = req.query.month || '2026-11';
  const rows = db.prepare('SELECT f.*, s.name, s.class_name FROM fees f JOIN students s ON s.id=f.student_id WHERE f.month=? ORDER BY s.class_name, s.name').all(month);
  sendCsv(res, 'fees-' + month + '.csv', ['Student', 'Class', 'Month', 'Amount (Rs)', 'Paid (Rs)', 'Pending (Rs)', 'Status', 'Payment Method', 'Payment Date'],
    rows.map(f => [f.name, f.class_name, f.month, f.amount, f.paid, f.amount - f.paid, f.status, f.payment_method || '', f.payment_date || '']));
});
app.get('/api/export/results', requireAdmin, (req, res) => {
  const exam = req.query.exam || 'Mid Term 2026';
  const rows = db.prepare('SELECT r.*, s.name, s.class_name FROM results r JOIN students s ON s.id=r.student_id WHERE r.exam=? ORDER BY s.class_name, s.name, r.subject').all(exam);
  sendCsv(res, 'results.csv', ['Student', 'Class', 'Exam', 'Subject', 'Marks', 'Total Marks', 'Percentage'],
    rows.map(r => [r.name, r.class_name, r.exam, r.subject, r.marks, r.total_marks, Math.round(r.marks / r.total_marks * 1000) / 10]));
});
app.get('/api/export/attendance', requireAdmin, (req, res) => {
  const { date, month, class: cls } = req.query;
  let sql = 'SELECT a.*, s.name FROM attendance a JOIN students s ON s.id=a.student_id WHERE 1=1'; const p = [];
  if (date) { sql += ' AND a.date=?'; p.push(date); }
  else if (month) { sql += ' AND substr(a.date,1,7)=?'; p.push(month); }
  else { sql += ' AND a.date=?'; p.push('2026-11-25'); }
  if (cls) { sql += ' AND a.class_name=?'; p.push(cls); }
  const rows = db.prepare(sql + ' ORDER BY a.date, a.class_name, s.name').all(...p);
  sendCsv(res, 'attendance.csv', ['Student', 'Class', 'Date', 'Status'],
    rows.map(a => [a.name, a.class_name, a.date, a.status]));
});
app.get('/api/backup', requireAdmin, (req, res) => {
  // Flush the WAL file into the main DB file so the download is complete.
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) { /* best effort */ }
  const name = 'school-backup-' + new Date().toISOString().slice(0, 10) + '.db';
  res.setHeader('Content-Type', 'application/x-sqlite3');
  res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
  res.sendFile(path.resolve(DB_PATH));
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`School Management System running on http://localhost:${PORT} — DB: ${DB_PATH}`));
