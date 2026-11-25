# School Management System — Online

A complete, deployable online School Management System for a Pakistan school.
Real login + real server-side database (SQLite file). **No localStorage database** —
all data is saved on the server in `data/school.db` via the Express API.

## Features (all working)

- **Login / Register** — a school creates its own account and logs in.
  Sessions are server-side (express-session cookie).
- **Dashboard** — active students, present today, fees collected / pending,
  teachers, staff present, left / promoted counts, students per class.
- **Students** — add / edit / delete, Nursery, KG, 1–10, roll no, father name,
  parent phone, monthly fee, admission date, **B-Form No.** (Birth Form number,
  e.g. `35202-1234567-1`), search + class filter, full profile
  (attendance, fees, results, promotions, leaving record).
  - **B-Form No.:** Add/Edit Student form mein B-Form No. ka field hai; ye
    save hota hai, student ki profile mein dikhta hai, students list mein
    B-Form column hai, aur search bhi B-Form number se hoti hai (name /
    roll no / B-Form). Column `students.b_form_no` purani databases mein
    startup par automatically add ho jata hai; seeded demo students ko
    demo B-Form numbers milte hain (format `35202-1000000+id-1`) — real
    school inhein Edit se asal B-Form se badal le. Students CSV export
    mein B-Form No. column bhi hai.
  - **Search Student (Students tab search bar):** "Search by" dropdown
    mein 3 options hain — **Naam se** (name / father name), **B-Form No.
    se** (dashes ke saath ya baghair — `3520212345671` bhi chal jata hai),
    aur **Class + Roll No. se** (class select karein + roll no likhein,
    e.g. Class 1 + Roll 01). Search karte hi sirf wohi student(s) list
    mein dikhte hain, aur **Profile** button se us student ki poori
    profile khulti hai. Server API: `GET /api/students?mode=name|bform|
    classroll&search=...&class=...&roll=...` (teacher sirf apni classes
    mein search kar sakta hai; parent sirf apna bacha dekhta hai).
  - **Search in every section:** har list wale section mein kaam karne
    wala search bar hai (sirf dikhane ke liye nahi):
    - **Fees** — student naam / roll / B-Form se + class filter.
    - **Results** — student naam / roll / subject se + class filter.
    - **Teachers & Staff** — teacher naam / subject / designation se.
    - **Attendance** — naam se (is class ki list mein foran filter hota
      hai; mark ki hui Present/Absent choice filter se nahi badalti).
    - **Timetable** — subject / teacher naam se; matching periods grid
      mein gold highlight hote hain aur neeche un ki list (Day, Period,
      Class, Subject, Teacher, Time) dikhti hai.
    - **Leaving / Promoted** — student naam / wajah / SLC number / exam se
      (dono tables ek saath filter hoti hain).
    Server APIs: `GET /api/fees?search=&class=`,
    `GET /api/results?search=&class=`, `GET /api/teachers?search=`,
    `GET /api/leaving?search=`, `GET /api/promotions?search=`.
- **Attendance** — date-wise Present / Absent / Late / Leave, bulk mark,
  monthly % summary (API: `/api/attendance/summary`).
  - **Dashboard updates immediately after an edit:** the dashboard is
    refetched after every attendance save (student or staff), and also
    whenever the Date / Month at the top is changed or Refresh is pressed.
    Previously the dashboard was only fetched once at login, so an
    attendance edit never changed the figures until re-login. The
    Attendance tab also prefills the already-saved values for the chosen
    date/class, so an edit shows the real saved values instead of
    resetting everything to Present.
  - **1st-period rule (student attendance):** only the teacher who has
    Period 1 for a class on that day may mark that class's attendance.
    The timetable is the source of truth (Period 1, 08:00–08:45). The
    marking option is **hidden entirely** for a teacher who does not hold
    Period 1 for that class — no Save button, no status dropdowns, no
    “Mark all Present”; only a red notice naming the Period 1 teacher
    (“Sirf 1st period wale teacher attendance laga sakte hain”) plus a
    read-only view of the already-saved attendance. A teacher who holds
    Period 1 sees a green notice and the full marking sheet. When a
    teacher opens the Attendance tab it defaults to a class where they
    hold Period 1 today, if they have one. The server enforces the same
    rule (403) so it cannot be bypassed from the browser. Admin can mark
    attendance for any class. NOTE: subjects are staggered by class and
    day, so Period 1 is a different subject (and teacher) in different
    classes — e.g. on Monday Fatima Zahra holds Period 1 only for
    Nursery, Ahmed Raza for Class 1, Maryam Nawaz for Class 10. If a
    school wants a different teacher to mark attendance, change the
    Period 1 teacher in the timetable (or regenerate it after changing
    assignments).
  - **Staff Attendance (separate tab, not student attendance):** admin
    gets a **Staff Attendance** tab and teachers get **My Staff
    Attendance**. Admin lists all teachers, marks Present / Absent / Late
    / Leave per date, saves, and sees a monthly summary (Present / Total
    / %) per teacher. A teacher sees only their own record + monthly %.
    Marking is admin-only; the dashboard card “Staff Present Today”
    updates as soon as staff attendance is saved. APIs:
    `GET /api/staff-attendance?date=`, `POST /api/staff-attendance`,
    `GET /api/staff-attendance/summary?month=`.
- **Fees** — generate monthly challans, Cash / JazzCash / EasyPaisa / Bank,
  partial payment, pending list, collected / pending totals.
- **Results** — exam-wise subject marks, auto total / percentage / grade,
  printable result card (Profile → Print Result Card).
- **Teachers & Staff** — 14 demo teachers, designation, qualification, salary,
  phone, class + subject assignments, staff attendance + monthly %, teacher
  profile with **subject-wise student progress % bars computed from real
  Mid Term 2026 results**.
  - **Add Teacher / Staff (admin only):** Teachers & Staff tab → **+ Add Teacher / Staff**.
    Full-info form: full name, father name, CNIC / ID card number, date of
    birth, phone, email (optional), home address, qualification, experience,
    salary, date of joining, designation/post, and class + subject
    assignments (add as many as needed). Saving creates the teacher AND
    their login immediately — username = first name in small letters
    (e.g. `ali` for Ali Raza), password `teacher123`. No server restart
    needed. The new fields are stored in the `teachers` table
    (`father_name`, `cnic`, `dob`, `email`, `address`, `experience`,
    `joining_date` — added automatically on startup for older databases,
    so the 14 seeded teachers keep working with those fields empty).
    Any teacher's profile can be edited later (Profile → Edit Profile,
    or Edit button in the list) — this is how the seeded teachers'
    empty fields are filled in.
  - **Add Result (admin, or teacher for their own subjects):** Results tab →
    **+ Add Result**. Search the student by name / roll no / class, pick
    **class** (default: the student's current class — change it to a
    previous class to add a previous-class result), exam, subject and
    marks obtained / total marks, Save. Teachers only see their own
    assigned subjects for the chosen class (the server rejects anything
    else with 403). The new result shows at once in the Results list,
    in the student's profile, and updates their total / percentage / grade.
    Results are stored with their class (`results.class_name`, added
    automatically on startup for older databases; existing Mid Term 2026
    results are backfilled to each student's current class, and the
    unique key is now student + exam + subject + class, so the same
    exam/subject in two different classes no longer overwrites each other).
  - **Previous Class Results (student profile):** opening a student's
    profile shows the current class result first, then a separate
    **“Previous Class Results”** section — exam, class, total marks,
    percentage, grade and year, with a **“View Report Card”** button on
    every previous row. Clicking it opens that previous class/exam's full
    report card — subjects, marks, total, percentage and grade, printable
    just like the current report card (with a “Back to Profile” button).
    For promotion-only rows with no saved subject breakdown, the card
    shows the exam / class / percentage / grade from the promotion record
    with a note saying so. It lists (a) grouped subject results
    added for a previous class, and (b) the student's promotion
    records (exam, previous class, percentage, year), so a promoted
    student's old class result is visible even before any detailed
    previous-class result is added.
  - **Teacher timetable as a table:** in a teacher's profile AND in My
    Timetable, the weekly timetable is a proper table — rows = Period 1–6
    (with a Break row after Period 3), columns = Mon, Tue, Wed, Thu, Fri,
    Sat. Each cell shows Subject + Class + Time; empty cells show
    "— Free". On a phone it scrolls sideways with clear headers.
- **Leaving / Promoted** — leaving record (date, reason, last class, SLC number);
  promotion history (from → to class, exam, percentage).
- **Timetable** — all 12 classes, Mon–Sat, 6 periods + break, teacher + subject
  + time, auto-generated from teacher assignments; each teacher's own weekly
  timetable is in their profile. Regenerate any time.
- **Timetable rule (no double-booking):** a teacher can teach at most ONE class
  in the same Day + Period slot. Subjects are staggered by class so different
  classes need different subjects at the same time; if the teacher for a
  class+subject is already booked then, the next available teacher for that
  subject is used, otherwise that period is left **Free**. The old timetable
  booked e.g. the only English teacher in 10 classes at 08:00 — that can no
  longer happen. On startup, any existing double-booked timetable is rebuilt
  conflict-free. In the Timetable tab, admin can **Edit a period**: the teacher
  dropdown only offers teachers free at that Day + Period (booked teachers are
  shown disabled, with the class they are already teaching); the server also
  refuses a booked teacher with a clear error.
- **Timetable rule (one teacher = one subject):** a teacher teaches exactly
  ONE subject in every class (Ahmed Raza only Maths, Fatima Zahra only
  English, …). The old seed gave teachers assignments in subjects that are
  not theirs — e.g. Bilal Hussain (Chemistry) was shown teaching English,
  Islamiat, Maths, Social Studies and Urdu — so a teacher's subject kept
  changing from class to class. Now assignments are only ever in the
  teacher's own subject; a wrong-subject assignment is deleted on startup
  (33 deleted in the shipped seed) and refused when added (the old seed
  never gave Bilal/Hira/Sana any assignment in their own subject at all —
  13 such assignments are repaired on startup). If no teacher of that
  subject is free, the period is left **Free** rather than giving it to a
  teacher of another subject. Edit-a-period only offers free teachers
  qualified for the chosen subject (others are shown disabled, e.g. “sirf
  Maths parhate hain”). Result: 336 of 432 periods filled, 96 Free — the
  Free periods are exactly the supply shortfall (English and Urdu each
  need 72 slots/week but have 1 teacher = 36; Science and Islamiat each
  need 48 but have 1 teacher = 36), so they are honest, not a bug. A
  teacher of a second subject can only be added as a new teacher.

## Demo logins (seeded on first run / on startup)

The login page has a role picker — Admin / Teacher / Parent. The server
decides the role from the account itself, never from what the browser sends.

### Admin — full access

| | |
|---|---|
| Username | `admin` |
| Password | `admin123` |
| School | Demo School |

Change it after first login by registering a new school account, or edit
the seeded user in the DB.
**Do not keep `admin123` in production — create your own account.**

### Teachers — own classes/subjects only (password `teacher123` for all)

| Username | Teacher | Classes (Maths unless noted) |
|---|---|---|
| `ahmed` | Ahmed Raza | Nursery, KG, 1, 2, 3 |
| `fatima` | Fatima Zahra | English classes |
| `asif` | Muhammad Asif | Urdu classes |
| `ayesha` | Ayesha Khan | Science classes |
| `bilal` | Bilal Hussain | Chemistry classes |
| `sana` | Sana Malik | Biology classes |
| `usman` | Usman Ghani | Physics classes |
| `maryam` | Maryam Nawaz | Islamiat classes |
| `hassan` | Hassan Ali | Computer classes |
| `hira` | Hira Shah | Social Studies classes |
| `omar` | Omar Farooq | Drawing classes |
| `zainab` | Zainab Bibi | Nazra Quran classes |
| `danish` | Danish Iqbal | Rhymes classes |
| `amna` | Amna Tariq | Maths classes |

Teacher accounts are created automatically on startup (and on first seed)
for all 14 teachers. Teacher accounts are **not** self-registered —
admin creates them; the demo ones above already exist. Change the demo
password by editing the user in the DB or by adding a password-change
flow before real use.

### Parents — only their own child (password `parent123` for all)

| Username | Child | Class | Roll | Parent phone |
|---|---|---|---|---|
| `parent1` | Sara Qureshi | Nursery | 01 | 0314941079 |
| `parent2` | Noor Ali | 1 | 01 | 0378713488 |
| `parent3` | Amna Ahmed | 5 | 01 | 0325868560 |
| `parent4` | Laiba Butt | 8 | 01 | 0321443194 |
| `parent5` | Noor Hussain | 10 | 01 | 0357749725 |

A real parent can also **register their own account**: on the login page
pick role **Parent**, enter parent phone + student roll no + class (exactly
as in the school record), a username and a password. The server links the
account to that one student only — a wrong phone/roll/class is rejected.

### Role permissions

| Feature | Admin | Teacher | Parent |
|---|---|---|---|
| Dashboard (full: fees, all students) | ✅ | — | — |
| Students: add / edit / delete | ✅ | — | — |
| Students: view | all | only own classes | only own child |
| Attendance: mark | ✅ all | ✅ own classes only | — |
| Fees (view / challans / payments) | ✅ | — (never sees fees) | own child only, via child profile |
| Results | ✅ all | own subjects only | own child only |
| Teachers & salaries | ✅ | own profile only, salary hidden | — |
| Staff attendance | ✅ | own % in own profile | — |
| Timetable | ✅ all classes | own timetable only | child's class only |
| Leaving / Promoted records | ✅ | — | own child, via child profile |
| Backup & CSV Export | ✅ | — | — |

## Backup & Export (admin only)

In the app: **Backup & Export** tab (admin only), plus Export buttons
inside Students / Fees / Results / Attendance.

- **Full database backup** — `GET /api/backup` downloads the whole SQLite
  file (`school-backup-YYYY-MM-DD.db`). This is the backup: save it
  somewhere safe (Google Drive / computer) once a week. If the server
  data is lost or corrupted, the school can be restored from this file.
  The server flushes the WAL file before sending, so the download is complete.
- **CSV exports** (proper quoting, UTF-8 BOM so Urdu/English names open
  correctly in Excel):
  - `GET /api/export/students` — all students (optional `?class=` / `?search=`)
  - `GET /api/export/fees?month=2026-11` — challans for a month
  - `GET /api/export/results?exam=Mid Term 2026` — subject marks + %
  - `GET /api/export/attendance?date=2026-11-25` (or `?month=2026-11`) — attendance
- All export/backup endpoints are login-required and **admin-only**
  (teachers and parents get 403).

> **Existing deployments:** the new `role` / `teacher_id` / `student_id`
> columns and the teacher + parent demo accounts are created automatically
> on server startup (`ensureRoleAccounts()`), so a Railway redeploy of
> this code upgrades the existing database in place — the 249 seeded
> students, fees and results are NOT touched.

## Demo data (seeded automatically on first run, only when the DB is empty)

- **249 students** — Nursery 18, KG 20, Class 1: 22, 2: 19, 3: 24, 4: 21,
  5: 23, 6: 18, 7: 25, 8: 20, 9: 22, 10: 17 — all with full details.
- **Mid Term 2026 results** for every student (6 subjects each).
- **Fees Oct + Nov 2026** for every student. November totals are exact:
  total **Rs 508,100**, collected **Rs 317,150**, pending **Rs 190,950**.
- **14 teachers**, 70 class/subject assignments, staff attendance 24–25 Nov 2026.
- **8 leaving records**, **224 promotions**, attendance 24–25 Nov 2026
  (25 Nov: 230 present out of 241 active students).
- **432 timetable periods** (12 classes × 6 days × 6 periods).

Monthly fees used: Nursery 1500, KG 1500, 1: 1500, 2: 1700, 3: 1800,
4: 2000, 5: 2100, 6: 2300, 7: 2400, 8: 2500, 9: 2500, 10: 2700.

## Run locally

```bash
cd school-management-online
npm install
npm start
# open http://localhost:3000  — login: admin / admin123
```

Requires Node **>= 22.5** (uses built-in `node:sqlite` — real SQLite, no
native compile step). `npm install` only needs `express` + `express-session`.

> Note: `better-sqlite3` was tried first but fails to compile in locked-down
> sandboxes (node-gyp cannot download Node headers). `node:sqlite` is the
> same SQLite file format and needs no build step, so it is used instead.
> The Dockerfile pins Node 24, so it works on Railway too.

## Deploy on Railway (preferred, free tier)

1. Push this folder to GitHub (new repo, e.g. `school-management-online`).
2. Railway → **New Project → Deploy from GitHub repo** → pick the repo.
   Railway detects the `Dockerfile` (see `railway.json`).
3. **Add a persistent volume** (Railway → service → Variables / Volumes):
   mount it at `/data`, then add a Variable:
   `DATABASE_PATH=/data/school.db`
   Without a volume, redeploys wipe the SQLite file.
4. Add a Variable: `SESSION_SECRET=<a long random string>`
5. Railway → **Settings → Networking → Generate Domain**.
   Open the domain → login `admin` / `admin123` → create your own school
   account (Register) and use that from then on.

## Deploy on Vercel

Vercel's serverless functions have **no persistent disk**, so the SQLite
file would reset on every deploy — Vercel is **not recommended** for this
app as-is. If you must use Vercel, use it only as a demo and expect data
to reset, or swap the SQLite layer for a hosted database (e.g. Turso /
Supabase Postgres) first. Railway (above) is the correct free host for
this app because it keeps the SQLite file on a volume.

## How a school logs in

1. Open the deployed link.
2. Pick a role (Admin / Teacher / Parent) and login with that role's
   demo account, or click **Create Account** with the school's own
   username / password / school name (admin) — or, for a parent, with
   parent phone + student roll no + class.
3. The dashboard, students, attendance, fees, results, teachers and
   timetable are all saved in the server database — closing the browser
   does not lose data. Each school should have its own deployment (or its
   own account) so schools' data never mixes.

## API (all under `/api`, login required except login/register)

`POST /api/login`, `POST /api/register`, `GET /api/me`,
`GET /api/my-child` (parent), `GET /api/my-teacher` (teacher),
`GET /api/dashboard`, `GET/POST/PUT/DELETE /api/students`,
`GET /api/students/:id`, `POST /api/students/:id/leave`,
`POST /api/students/:id/promote`, `GET/POST /api/attendance`,
`GET /api/attendance/summary`,
`GET /api/fees`, `POST /api/fees/generate`, `POST /api/fees/:id/pay`,
`GET/POST /api/results` (POST: admin, or teacher for own subjects),
`DELETE /api/results/:id` (admin),
`GET/POST /api/teachers`, `PUT /api/teachers/:id` (admin, full-info edit),
`GET /api/teachers/:id`, `POST /api/teachers/:id/assignments`,
`GET/POST /api/staff-attendance`,
`GET /api/leaving`, `GET /api/promotions`,
`GET /api/timetable`, `POST /api/timetable/regenerate`,
`GET /api/export/students`, `GET /api/export/fees`,
`GET /api/export/results`, `GET /api/export/attendance`,
`GET /api/backup` (admin only, downloads the SQLite file).

Write operations (add/edit/delete students, fees, results, teachers,
timetable regenerate, leaving/promote) are admin-only, except attendance
marking which teachers may also do for their own classes.

## Files

```
server.js            Express API + SQLite schema + seed data
public/index.html    Login page + app shell
public/app.js        Frontend (fetch API only, no localStorage DB)
public/style.css     Styling
Dockerfile           Railway build (node:24)
railway.json         Railway deploy config
Procfile             web: node server.js
.env.example         PORT / DATABASE_PATH / SESSION_SECRET
```

## Security note

This is a demo-grade app: passwords are scrypt-hashed, sessions are
httpOnly cookies, but there is no HTTPS enforcement in-app (Railway
provides HTTPS), no rate limiting and no per-school data isolation
beyond separate accounts. For real paid use, put each school on its own
deployment and change the demo password immediately.
