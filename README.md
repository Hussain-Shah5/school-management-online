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
  parent phone, monthly fee, admission date, search + class filter, full profile
  (attendance, fees, results, promotions, leaving record).
- **Attendance** — date-wise Present / Absent / Late / Leave, bulk mark,
  monthly % summary (API: `/api/attendance/summary`).
- **Fees** — generate monthly challans, Cash / JazzCash / EasyPaisa / Bank,
  partial payment, pending list, collected / pending totals.
- **Results** — exam-wise subject marks, auto total / percentage / grade,
  printable result card (Profile → Print Result Card).
- **Teachers & Staff** — 14 demo teachers, designation, qualification, salary,
  phone, class + subject assignments, staff attendance + monthly %, teacher
  profile with **subject-wise student progress % bars computed from real
  Mid Term 2026 results**.
- **Leaving / Promoted** — leaving record (date, reason, last class, SLC number);
  promotion history (from → to class, exam, percentage).
- **Timetable** — all 12 classes, Mon–Sat, 6 periods + break, teacher + subject
  + time, auto-generated from teacher assignments; each teacher's own weekly
  timetable is in their profile. Regenerate any time.

## Demo login (seeded on first run)

| | |
|---|---|
| Username | `admin` |
| Password | `admin123` |
| School | Demo School |

The login page shows this demo login. Change it after first login by
registering a new school account, or edit the seeded user in the DB.
**Do not keep `admin123` in production — create your own account.**

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
2. Login with the demo account, or click **Create Account** with the
   school's own username / password / school name.
3. The dashboard, students, attendance, fees, results, teachers and
   timetable are all saved in the server database — closing the browser
   does not lose data. Each school should have its own deployment (or its
   own account) so schools' data never mixes.

## API (all under `/api`, login required except login/register)

`POST /api/login`, `POST /api/register`, `GET /api/me`,
`GET /api/dashboard`, `GET/POST/PUT/DELETE /api/students`,
`GET /api/students/:id`, `POST /api/students/:id/leave`,
`POST /api/students/:id/promote`, `GET/POST /api/attendance`,
`GET /api/fees`, `POST /api/fees/generate`, `POST /api/fees/:id/pay`,
`GET/POST /api/results`, `GET/POST /api/teachers`,
`GET /api/teachers/:id`, `GET/POST /api/staff-attendance`,
`GET /api/leaving`, `GET /api/promotions`,
`GET /api/timetable`, `POST /api/timetable/regenerate`.

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
