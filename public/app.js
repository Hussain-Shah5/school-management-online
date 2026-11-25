// Frontend for School Management System — all data comes from the server API
// (SQLite on the server). Nothing is stored in localStorage as a database.
// Roles: admin (full access), teacher (own classes/subjects only, no fees/salaries),
// parent (only their own child).
const $ = s => document.querySelector(s);
const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || ('Request failed: ' + r.status));
  return d;
};
const apiBlob = async (url) => {
  const r = await fetch(url);
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || ('Download failed: ' + r.status)); }
  return r.blob();
};
const downloadFile = async (url, filename) => {
  const blob = await apiBlob(url);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
let me = null, tab = 'dashboard', studentsCache = [], teachersCache = [], myClasses = [];
let loginRole = 'admin';
const TABS_ADMIN = [['dashboard','Dashboard'],['students','Students'],['attendance','Attendance'],['fees','Fees'],['results','Results'],['teachers','Teachers & Staff'],['timetable','Timetable'],['leaving','Leaving / Promoted'],['backup','Backup & Export']];
const TABS_TEACHER = [['dashboard','Dashboard'],['attendance','My Attendance'],['teachers','My Profile'],['timetable','My Timetable']];
const TABS_PARENT = [['dashboard','Dashboard'],['students','My Child'],['timetable','Child Timetable']];
const tabsFor = () => me && me.role === 'teacher' ? TABS_TEACHER : me && me.role === 'parent' ? TABS_PARENT : TABS_ADMIN;
const CLASSES = ['Nursery','KG','1','2','3','4','5','6','7','8','9','10'];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// Subjects taught in each class (same list as the server's subjectsForClass).
function subjectsForClass(cls) {
  if (cls === 'Nursery' || cls === 'KG') return ['English', 'Urdu', 'Maths', 'Nazra Quran', 'Drawing', 'Rhymes'];
  if (['1', '2', '3', '4', '5'].includes(cls)) return ['English', 'Urdu', 'Maths', 'Science', 'Islamiat', 'Social Studies'];
  if (['6', '7', '8'].includes(cls)) return ['English', 'Urdu', 'Maths', 'Science', 'Islamiat', 'Computer'];
  return ['English', 'Urdu', 'Maths', 'Physics', 'Chemistry', 'Biology'];
}
const TT_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TT_DAY_SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat' };
const TT_TIMES = [['08:00', '08:45'], ['08:45', '09:30'], ['09:30', '10:15'], ['10:45', '11:30'], ['11:30', '12:15'], ['12:15', '13:00']];
// Weekly timetable as a proper table: rows = Period 1-6 (+ Break row),
// columns = Mon-Sat. Each cell: Subject + Class + Time. Empty = "— Free".
// rows: [{day, period, subject, class_name, teacher_name, start_time, end_time}]
// opts: {showClass: true/false, showTeacher: true/false}
function timetableGridHTML(rows, opts = {}) {
  const showClass = opts.showClass !== false, showTeacher = !!opts.showTeacher;
  const cell = (day, period) => {
    const r = (rows || []).find(x => x.day === day && Number(x.period) === period);
    if (!r) return '<td class="tt-free">—<br><small>Free</small></td>';
    return `<td class="tt-cell"><b>${esc(r.subject)}</b>${showClass ? `<br><small>Class ${esc(r.class_name)}</small>` : ''}${showTeacher && r.teacher_name ? `<br><small>${esc(r.teacher_name)}</small>` : ''}<br><small>${esc(r.start_time || '')}${r.end_time ? '–' + esc(r.end_time) : ''}</small></td>`;
  };
  const periodRow = (p) => `<tr><th class="tt-period">Period ${p}<br><small>${TT_TIMES[p - 1][0]}–${TT_TIMES[p - 1][1]}</small></th>${TT_DAYS.map(d => cell(d, p)).join('')}</tr>`;
  return `<div class="tt-wrap"><table class="tt-table"><thead><tr><th class="tt-period">Period</th>${TT_DAYS.map(d => `<th>${TT_DAY_SHORT[d]}<br><small>${d}</small></th>`).join('')}</tr></thead><tbody>
  ${periodRow(1)}${periodRow(2)}${periodRow(3)}
  <tr class="tt-break"><td><b>Break</b></td><td colspan="6">Break — 10:15 to 10:45</td></tr>
  ${periodRow(4)}${periodRow(5)}${periodRow(6)}
  </tbody></table></div><p style="font-size:13px;color:var(--muted)">Periods 1–6, Monday to Saturday. Khaali khana matlab us period mein koi class nahi (Free).</p>`;
}

// ---- Login / role picker ----
const DEMO_HELP = {
  admin: '<b>Demo login (Admin):</b><br>Username: <code>admin</code><br>Password: <code>admin123</code><br>Full access — students, fees, results, teachers, backup.',
  teacher: '<b>Demo login (Teacher):</b><br>Username: <code>ahmed</code> (ya fatima, asif, ayesha, bilal, sana, usman, maryam, hassan, hira, omar, zainab, danish, amna)<br>Password: <code>teacher123</code><br>Teacher sirf apni classes/subjects dekh sakta hai — fees aur salaries nahi.',
  parent: '<b>Demo login (Parent):</b><br>Username: <code>parent1</code> — bacha Sara Qureshi, Nursery<br>Username: <code>parent2</code> — Noor Ali, Class 1 &nbsp;|&nbsp; <code>parent3</code> — Amna Ahmed, Class 5<br>Username: <code>parent4</code> — Laiba Butt, Class 8 &nbsp;|&nbsp; <code>parent5</code> — Noor Hussain, Class 10<br>Password (sab ke liye): <code>parent123</code><br>Parent sirf apna bacha dekh sakta hai. Naya parent account phone + roll no + class se banta hai.',
};
function setRole(role) {
  loginRole = role;
  document.querySelectorAll('.role-btn').forEach(b => { const on = b.dataset.role === role; b.classList.toggle('active', on); b.classList.toggle('secondary', !on); });
  $('#demoBox').innerHTML = DEMO_HELP[role];
  $('#parentFields').classList.toggle('hidden', role !== 'parent');
  $('#adminFields').classList.toggle('hidden', role === 'parent');
  $('#registerBtn').textContent = role === 'parent' ? 'Create Parent Account' : role === 'teacher' ? 'Create Account (admin only for teachers)' : 'Create Account';
  if (role === 'admin') { $('#username').value = 'admin'; $('#password').value = 'admin123'; }
  if (role === 'teacher') { $('#username').value = 'ahmed'; $('#password').value = 'teacher123'; }
  if (role === 'parent') { $('#username').value = 'parent1'; $('#password').value = 'parent123'; }
}
document.querySelectorAll('.role-btn').forEach(b => b.onclick = () => setRole(b.dataset.role));
setRole('admin');

async function checkLogin() {
  try { me = await api('/api/me'); } catch { me = { loggedIn: false }; }
  $('#loginView').classList.toggle('hidden', !!me.loggedIn);
  $('#appView').classList.toggle('hidden', !me.loggedIn);
  if (me.loggedIn) {
    $('#schoolTitle').textContent = me.schoolName + ' — School Management System';
    const heroTitle = $('#heroTitle'); if (heroTitle) heroTitle.textContent = me.schoolName;
    const heroDate = $('#heroDate'); if (heroDate) heroDate.textContent = new Date($('#todayInput').value + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    $('#userLine').textContent = 'Logged in as ' + me.username + ' (' + (me.role || 'admin') + ')';
    if (!tabsFor().some(([k]) => k === tab)) tab = 'dashboard';
    renderTabs(); loadDashboard();
  }
}
$('#loginBtn').onclick = async () => {
  try { await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('#username').value, password: $('#password').value }) }); $('#loginMsg').textContent = ''; checkLogin(); }
  catch (e) { $('#loginMsg').textContent = e.message; }
};
$('#registerBtn').onclick = async () => {
  try {
    const body = { username: $('#username').value, password: $('#password').value, schoolName: $('#schoolName').value || 'My School', role: loginRole };
    if (loginRole === 'parent') { body.phone = $('#parentPhone').value; body.rollNo = $('#parentRoll').value; body.className = $('#parentClass').value; }
    await api('/api/register', { method: 'POST', body: JSON.stringify(body) });
    $('#loginMsg').textContent = ''; checkLogin();
  } catch (e) { $('#loginMsg').textContent = e.message; }
};
$('#logoutBtn').onclick = async () => { await api('/api/logout', { method: 'POST' }); checkLogin(); };
$('#refreshBtn').onclick = () => loadTab(tab);
function renderTabs() {
  const tabs = tabsFor();
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k===tab?'active':''}">${l}</button>`).join('');
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; renderTabs(); loadTab(tab); });
  // Fixed bottom nav (mobile): same tabs, so every section is one tap away on phone.
  const nav = $('#bottomNav');
  if (nav) {
    nav.innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k===tab?'active':''}">${l}</button>`).join('');
    nav.querySelectorAll('button').forEach(b => b.onclick = () => { tab = b.dataset.t; renderTabs(); loadTab(tab); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  }
}
function loadTab(t) { ({ dashboard: loadDashboard, students: loadStudents, attendance: loadAttendance, fees: loadFees, results: loadResults, teachers: loadTeachers, timetable: loadTimetable, leaving: loadLeaving, backup: loadBackup })[t](); }

async function loadDashboard() {
  const d = await api(`/api/dashboard?today=${$('#todayInput').value}&month=${$('#monthInput').value}`);
  if (d.role === 'teacher') {
    myClasses = d.myClasses || [];
    $('#dashCards').innerHTML = [
      [d.myClasses.length, 'My Classes'], [d.myStudents, 'My Students'], [d.present, 'Present Today in my classes'],
      [d.mySubjects.join(', '), 'My Subjects'], [d.attPct + '%', 'My Attendance'],
    ].map(([v, l]) => `<div class="card"><b>${v}</b><span>${l}</span></div>`).join('');
    $('#view').innerHTML = `<div class="card"><h3>Assalam-o-Alaikum, ${esc(d.teacherName)} — Subject-wise student progress (Mid Term 2026)</h3>
    ${d.progress.map(p => `<div class="progress-row"><span>Class ${esc(p.class_name)} ${esc(p.subject)}</span><div class="bar"><i style="width:${p.avg}%"></i></div><b>${p.avg}%</b></div>`).join('') || '<p>No assignments yet.</p>'}
    <p>Attendance sirf apni classes ki mark karein — My Attendance tab se. Fees aur salaries teacher ko nazar nahi aati.</p></div>`;
    return;
  }
  if (d.role === 'parent') {
    const c = d.child;
    $('#dashCards').innerHTML = [
      [esc(c.name), 'My Child'], ['Class ' + esc(c.class_name) + '-' + esc(c.section), 'Class (Roll ' + esc(c.roll_no) + ')'],
      [d.attPct + '%', 'Attendance'], ['Rs ' + d.feesPaid.toLocaleString(), 'Fees Paid'], ['Rs ' + d.feesPending.toLocaleString(), 'Fees Pending'],
      [d.resultPct + '% (' + d.grade + ')', 'Mid Term Result'],
    ].map(([v, l]) => `<div class="card"><b>${v}</b><span>${l}</span></div>`).join('');
    $('#view').innerHTML = `<div class="card"><h3>${esc(c.name)} — poori profile</h3><p>Father: ${esc(c.father_name)} | Class ${esc(c.class_name)}-${esc(c.section)} | Roll ${esc(c.roll_no)}</p>
    <p>Attendance: ${d.attPresent} / ${d.attTotal} days present (${d.attPct}%). Fees: Rs ${d.feesPaid.toLocaleString()} paid of Rs ${d.feesTotal.toLocaleString()}.</p>
    <button onclick="tab='students';renderTabs();loadTab('students')">View Full Profile</button></div>`;
    return;
  }
  $('#dashCards').innerHTML = [
    [d.total, 'Active Students'], [d.present, 'Present Today (' + d.today + ')'], [d.teachers, 'Teachers'],
    ['Rs ' + d.feesCollected.toLocaleString(), 'Fees Collected (' + d.month + ')'],
    ['Rs ' + d.feesPending.toLocaleString(), 'Fees Pending'], [d.left, 'Left School'], [d.promoted, 'Promoted'], [d.staffPresent, 'Staff Present Today'],
  ].map(([v, l]) => `<div class="card"><b>${v}</b><span>${l}</span></div>`).join('');
  $('#view').innerHTML = `<div class="card"><h3>Students per class (active)</h3>${d.byClass.map(c => `<div class="progress-row"><span>Class ${esc(c.class_name)}</span><div class="bar"><i style="width:${Math.min(100, c.c / 25 * 100)}%"></i></div><b>${c.c}</b></div>`).join('')}<p>Total students in system: ${d.totalAll} (249 seeded). Attendance today: ${d.attendance.map(a => a.status + ' ' + a.c).join(', ') || 'not marked yet'}.</p></div>`;
}

// ---- Students ----
let stuFilter = { class: '', search: '', mode: 'name', roll: '' };
async function loadStudents() {
  if (stuFilter.mode === 'classroll' && !stuFilter.class) stuFilter.class = '1'; // Class + Roll search needs a class — default Class 1
  const params = { mode: stuFilter.mode || 'name' };
  if (stuFilter.mode === 'classroll') { params.class = stuFilter.class; params.roll = stuFilter.roll; }
  else { params.class = stuFilter.class; params.search = stuFilter.search; }
  studentsCache = await api('/api/students?' + new URLSearchParams(params));
  const isAdmin = me.role === 'admin';
  const mode = stuFilter.mode || 'name';
  const searchPh = mode === 'bform' ? 'B-Form No. likhein — e.g. 35202-1234567-1' : mode === 'classroll' ? 'Roll No. likhein — e.g. 01' : 'Naam likhein — e.g. Sara, Noor Ali';
  $('#view').innerHTML = `<div class="card">
    <h3 style="margin-top:0">Search Student</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">
    <div><label style="margin:0 0 4px">Search by</label><select id="fMode" style="max-width:190px">
      <option value="name" ${mode === 'name' ? 'selected' : ''}>Naam se (Name)</option>
      <option value="bform" ${mode === 'bform' ? 'selected' : ''}>B-Form No. se</option>
      <option value="classroll" ${mode === 'classroll' ? 'selected' : ''}>Class + Roll No. se</option>
    </select></div>
    <div><label style="margin:0 0 4px">${mode === 'classroll' ? 'Class *' : 'Class (optional)'}</label><select id="fClass" style="max-width:160px">${mode === 'classroll' ? '' : '<option value="">All classes</option>'}${CLASSES.map(c => `<option ${c===stuFilter.class?'selected':''}>${c}</option>`).join('')}</select></div>
    ${mode === 'classroll'
      ? `<div><label style="margin:0 0 4px">Roll No. *</label><input id="fRoll" placeholder="e.g. 01" value="${esc(stuFilter.roll)}" style="max-width:120px"></div>`
      : `<div style="flex:1;min-width:200px"><label style="margin:0 0 4px">${mode === 'bform' ? 'B-Form No.' : 'Search'}</label><input id="fSearch" placeholder="${searchPh}" value="${esc(stuFilter.search)}"></div>`}
    <button id="fGo">Search</button><button id="fClear" class="secondary">Clear</button>${isAdmin ? '<button id="addStu">+ Add Student</button><button id="expStu" class="secondary">Export Students CSV</button>' : ''}</div>
    <p>${studentsCache.length === 0 ? 'Koi student nahi mila — search ya class dobara check karein.' : studentsCache.length + ' student(s) found — Profile button se poori profile kholein.'}</p>
    <div style="overflow-x:auto"><table><tr><th>Roll</th><th>Name</th><th>Father</th><th>Class</th><th>B-Form No</th><th>Phone</th><th>Monthly Fee</th><th>Status</th><th></th></tr>
    ${studentsCache.map(s => `<tr><td>${esc(s.roll_no)}</td><td>${esc(s.name)}</td><td>${esc(s.father_name)}</td><td>${esc(s.class_name)}-${esc(s.section)}</td><td>${esc(s.b_form_no || '—')}</td><td>${esc(s.phone)}</td><td>Rs ${s.monthly_fee}</td><td><span class="badge ${s.status==='left'?'left':''}">${s.status}</span></td><td><button class="secondary" onclick="viewStudent(${s.id})">Profile</button></td></tr>`).join('')}</table></div></div>`;
  const doSearch = () => {
    stuFilter.mode = $('#fMode').value;
    stuFilter.class = $('#fClass').value;
    if (stuFilter.mode === 'classroll') {
      stuFilter.roll = ($('#fRoll').value || '').trim();
      stuFilter.search = '';
      if (!stuFilter.roll) { alert('Class + Roll No. search ke liye Roll No. likhna zaroori hai.'); return; }
    } else {
      stuFilter.search = ($('#fSearch').value || '').trim();
      stuFilter.roll = '';
    }
    loadStudents();
  };
  $('#fGo').onclick = doSearch;
  $('#fMode').onchange = () => { stuFilter.mode = $('#fMode').value; stuFilter.search = ''; stuFilter.roll = ''; loadStudents(); };
  $('#fClear').onclick = () => { stuFilter = { class: '', search: '', mode: 'name', roll: '' }; loadStudents(); };
  const searchInput = $('#fSearch') || $('#fRoll');
  if (searchInput) searchInput.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } };
  if (isAdmin) {
    $('#addStu').onclick = () => studentForm();
    $('#expStu').onclick = () => downloadFile('/api/export/students', 'students.csv').catch(e => alert(e.message));
  }
}
function studentForm(s) {
  s = s || {};
  openModal(`<h3>${s.id ? 'Edit' : 'Add'} Student</h3>
  <label>Name</label><input id="m_name" value="${esc(s.name||'')}">
  <label>Father name</label><input id="m_father" value="${esc(s.father_name||'')}">
  <label>Class</label><select id="m_class">${CLASSES.map(c=>`<option ${c===s.class_name?'selected':''}>${c}</option>`).join('')}</select>
  <label>Section</label><input id="m_section" value="${esc(s.section||'A')}">
  <label>Roll No</label><input id="m_roll" value="${esc(s.roll_no||'')}">
  <label>B-Form No. (Birth Form / B-Form number)</label><input id="m_bform" placeholder="e.g. 35202-1234567-1" value="${esc(s.b_form_no||'')}">
  <label>Parent phone</label><input id="m_phone" value="${esc(s.phone||'')}">
  <label>Monthly fee (Rs)</label><input id="m_fee" type="number" value="${s.monthly_fee||1500}">
  <label>Admission date</label><input id="m_adm" type="date" value="${esc(s.admission_date||'2026-04-01')}">
  <div style="display:flex;gap:8px;margin-top:12px"><button id="m_save">Save (server)</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`);
  $('#m_save').onclick = async () => {
    const body = { name: $('#m_name').value, father_name: $('#m_father').value, class_name: $('#m_class').value, section: $('#m_section').value, roll_no: $('#m_roll').value, b_form_no: $('#m_bform').value.trim(), phone: $('#m_phone').value, monthly_fee: +$('#m_fee').value, admission_date: $('#m_adm').value };
    if (s.id) await api('/api/students/' + s.id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/students', { method: 'POST', body: JSON.stringify(body) });
    closeModal(); loadStudents();
  };
}
const gradeFor = pct => pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : 'F';
const yearOf = (exam, date) => ((exam || '').match(/\b(20\d\d)\b/) || [])[1] || (date ? String(date).slice(0, 4) : '');
window.viewStudent = async (id) => {
  const s = await api('/api/students/' + id);
  // Current class results only — previous-class results live in their own section below.
  const curResults = s.results.filter(r => !r.class_name || r.class_name === s.class_name);
  const prevResults = s.results.filter(r => r.class_name && r.class_name !== s.class_name);
  const totalMarks = curResults.reduce((a, r) => a + r.marks, 0), totalOf = curResults.reduce((a, r) => a + r.total_marks, 0);
  const pct = totalOf ? (totalMarks / totalOf * 100).toFixed(1) : 0;
  // Group previous-class subject results by exam + class: exam, class, %, grade, year.
  const prevGroups = {};
  prevResults.forEach(r => {
    const k = r.exam + '|' + r.class_name;
    (prevGroups[k] = prevGroups[k] || { exam: r.exam, cls: r.class_name, marks: 0, total: 0 });
    prevGroups[k].marks += r.marks; prevGroups[k].total += r.total_marks;
  });
  const prevRows = Object.values(prevGroups).map(g => ({ exam: g.exam, cls: g.cls, pct: (g.marks / g.total * 100).toFixed(1), marks: g.marks + '/' + g.total, year: yearOf(g.exam, ''), source: 'Subject results' }));
  // A promoted student's previous-class exam result also lives in promotions
  // (exam, from_class, percentage, date) — show it here too so it is visible
  // even before any detailed previous-class subject result is added.
  (s.promotions || []).forEach(p => prevRows.push({ exam: p.exam, cls: p.from_class, pct: Number(p.percentage).toFixed(1), marks: '', year: yearOf(p.exam, p.date), source: 'Promotion record' }));
  window._curStudent = s;
  const isAdmin = me.role === 'admin';
  openModal(`<h3>${esc(s.name)} — Class ${esc(s.class_name)}-${esc(s.section)}</h3>
  <p>Roll ${esc(s.roll_no)} | Father: ${esc(s.father_name)} | Phone: ${esc(s.phone)}<br>B-Form No: ${esc(s.b_form_no || '— not recorded yet (Edit se add karein)')} | Monthly fee Rs ${s.monthly_fee} | Admission ${esc(s.admission_date)} | Status ${s.status}</p>
  <h4>Results — Current Class ${esc(s.class_name)} — ${pct}% (${gradeFor(+pct)})</h4><div class="bar"><i style="width:${pct}%"></i></div>
  <table><tr><th>Exam</th><th>Subject</th><th>Marks</th></tr>${curResults.map(r=>`<tr><td>${esc(r.exam)}</td><td>${esc(r.subject)}</td><td>${r.marks}/${r.total_marks}</td></tr>`).join('') || '<tr><td colspan="3">No results yet for the current class.</td></tr>'}</table>
  <h4>Previous Class Results</h4>
  ${prevRows.length ? `<table><tr><th>Exam</th><th>Class</th><th>Total</th><th>%</th><th>Grade</th><th>Year</th></tr>${prevRows.map(r=>`<tr><td>${esc(r.exam)}</td><td>${esc(r.cls)}</td><td>${esc(r.marks)}</td><td>${r.pct}%</td><td>${gradeFor(+r.pct)}</td><td>${esc(r.year)}</td></tr>`).join('')}</table><p style="font-size:13px;color:var(--muted)">Promotion-record rows come from the promotion history; subject-result rows were added with a previous class chosen in Add Result.</p>` : '<p>No previous class results yet. Admin/teacher can add one from Results → + Add Result, class chunein (purani class), aur exam/marks likhein.</p>'}
  <h4>Fees</h4>${s.fees.map(f=>`<p>${f.month}: Rs ${f.paid}/${f.amount} — ${f.status}</p>`).join('')}
  <h4>Promotions</h4>${s.promotions.map(p=>`<p>${esc(p.from_class)} → ${esc(p.to_class)} (${esc(p.exam)}, ${p.percentage}%)</p>`).join('') || '<p>None</p>'}
  ${s.leaving ? `<h4>Leaving record</h4><p>${esc(s.leaving.leaving_date)} — ${esc(s.leaving.reason)} — SLC ${esc(s.leaving.slc_number)}</p>` : ''}
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
  ${isAdmin ? `<button onclick="closeModal();studentForm(window._curStudent)">Edit</button>
  <button class="secondary" onclick="leaveStudent(${s.id})">Mark as Left School</button>
  <button class="secondary" onclick="promoteStudent(${s.id})">Promote</button>` : ''}
  <button class="secondary" onclick="closeModal()">Close</button>
  <button onclick="window.print()">Print Result Card</button></div>`);
};
window.leaveStudent = async (id) => {
  const reason = prompt('Leaving reason?', 'Family shifted'); if (reason === null) return;
  const slc = prompt('SLC number?', 'SLC-2026-009');
  await api(`/api/students/${id}/leave`, { method: 'POST', body: JSON.stringify({ reason, slc_number: slc, leaving_date: $('#todayInput').value }) });
  closeModal(); loadStudents();
};
window.promoteStudent = async (id) => {
  const to = prompt('Promote to class? (Nursery/KG/1..10)', ''); if (!to) return;
  await api(`/api/students/${id}/promote`, { method: 'POST', body: JSON.stringify({ to_class: to, exam: 'Annual Exam', percentage: 75 }) });
  closeModal(); loadStudents();
};

// ---- Attendance ----
async function loadAttendance() {
  const date = $('#todayInput').value;
  const isTeacher = me.role === 'teacher';
  if (isTeacher && !myClasses.length) { try { const t = await api('/api/my-teacher'); myClasses = t.assignments.map(a => a.class_name); myClasses = [...new Set(myClasses)]; } catch { myClasses = []; } }
  const cls = isTeacher ? (stuFilter.class && myClasses.includes(stuFilter.class) ? stuFilter.class : (myClasses[0] || '')) : (stuFilter.class || '');
  const list = await api('/api/students?class=' + cls + '&status=active');
  const classOptions = isTeacher ? myClasses : CLASSES;
  $('#view').innerHTML = `<div class="card"><h3>Attendance — ${date}${isTeacher ? ' (my classes only)' : ''}</h3>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-bottom:8px">
  <div><label style="margin:0 0 4px">Class</label><select id="aClass" style="max-width:160px">${classOptions.map(c=>`<option ${c===cls?'selected':''}>${c}</option>`).join('')}</select></div>
  <div style="flex:1;min-width:200px"><label style="margin:0 0 4px">Search student (naam se)</label><input id="aSearch" placeholder="Naam likhein — e.g. Sara"></div>
  <button id="aAll">Mark all Present</button> <button id="aSave">Save Attendance</button>
  ${isTeacher ? '' : '<button id="expAtt" class="secondary">Export Attendance CSV</button>'}</div>
  <p id="aCount">${list.length} students in this class</p>
  <table id="aTable"><tr><th>Name</th><th>Class</th><th>Status</th></tr>${list.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.class_name)}</td><td><select data-sid="${s.id}" class="aStatus"><option>Present</option><option>Absent</option><option>Late</option><option>Leave</option></select></td></tr>`).join('')}</table></div>`;
  $('#aClass').onchange = e => { stuFilter.class = e.target.value; loadAttendance(); };
  // Name search filters the loaded rows in place (saved Present/Absent choices stay).
  $('#aSearch').oninput = () => {
    const q = $('#aSearch').value.toLowerCase();
    let shown = 0;
    document.querySelectorAll('#aTable tr:not(:first-child)').forEach(tr => { const hit = tr.cells[0].textContent.toLowerCase().includes(q); tr.style.display = hit ? '' : 'none'; if (hit) shown++; });
    $('#aCount').textContent = shown + ' of ' + list.length + ' students shown';
  };
  $('#aAll').onclick = () => document.querySelectorAll('.aStatus').forEach(x => x.value = 'Present');
  $('#aSave').onclick = async () => {
    const records = [...document.querySelectorAll('.aStatus')].map(x => ({ student_id: +x.dataset.sid, status: x.value }));
    await api('/api/attendance', { method: 'POST', body: JSON.stringify({ date, records }) });
    alert('Attendance saved to server database (' + records.length + ' records).');
  };
  const expBtn = $('#expAtt'); if (expBtn) expBtn.onclick = () => downloadFile('/api/export/attendance?date=' + date, 'attendance-' + date + '.csv').catch(e => alert(e.message));
}

// ---- Fees (admin only) ----
let feeFilter = { search: '', class: '' };
async function loadFees() {
  if (me.role !== 'admin') { $('#view').innerHTML = '<div class="card"><h3>Fees</h3><p>Only admin can see fees.</p></div>'; return; }
  const month = $('#monthInput').value;
  const fees = await api('/api/fees?' + new URLSearchParams({ month, search: feeFilter.search, class: feeFilter.class }));
  const total = fees.reduce((a, f) => a + f.amount, 0), collected = fees.reduce((a, f) => a + f.paid, 0);
  $('#view').innerHTML = `<div class="card"><h3>Fees — ${month}</h3>
  <p><b>Total Rs ${total.toLocaleString()}</b> | Collected Rs ${collected.toLocaleString()} | Pending Rs ${(total-collected).toLocaleString()}</p>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-bottom:8px">
  <div><label style="margin:0 0 4px">Class</label><select id="feeClass" style="max-width:160px"><option value="">All classes</option>${CLASSES.map(c => `<option ${c===feeFilter.class?'selected':''}>${c}</option>`).join('')}</select></div>
  <div style="flex:1;min-width:200px"><label style="margin:0 0 4px">Search (naam / roll / B-Form)</label><input id="feeSearch" placeholder="e.g. Sara, 01, 35202-..." value="${esc(feeFilter.search)}"></div>
  <button id="feeGo">Search</button><button id="feeClear" class="secondary">Clear</button></div>
  <p>${fees.length} challan(s) found</p>
  <button id="genFees">Generate challans for this month</button> <button id="expFees" class="secondary">Export Fees CSV</button>
  <table><tr><th>Student</th><th>Class</th><th>Amount</th><th>Paid</th><th>Status</th><th>Method</th><th></th></tr>
  ${fees.map(f=>`<tr><td>${esc(f.name)}</td><td>${esc(f.class_name)}</td><td>${f.amount}</td><td>${f.paid}</td><td><span class="badge ${f.status}">${f.status}</span></td><td>${esc(f.payment_method||'-')}</td><td>${f.status!=='paid'?`<button onclick="payFee(${f.id},${f.amount-f.paid})">Record payment</button>`:''}</td></tr>`).join('')}</table></div>`;
  const feeDoSearch = () => { feeFilter.class = $('#feeClass').value; feeFilter.search = ($('#feeSearch').value || '').trim(); loadFees(); };
  $('#feeGo').onclick = feeDoSearch;
  $('#feeSearch').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); feeDoSearch(); } };
  $('#feeClear').onclick = () => { feeFilter = { search: '', class: '' }; loadFees(); };
  $('#genFees').onclick = async () => { const r = await api('/api/fees/generate', { method: 'POST', body: JSON.stringify({ month }) }); alert('Created ' + r.created + ' new challans.'); loadFees(); };
  $('#expFees').onclick = () => downloadFile('/api/export/fees?month=' + month, 'fees-' + month + '.csv').catch(e => alert(e.message));
}
window.payFee = async (id, remaining) => {
  const amt = +prompt('Payment amount (Rs)?', remaining); if (!amt) return;
  const method = prompt('Method? Cash / JazzCash / EasyPaisa / Bank', 'Cash');
  await api('/api/fees/' + id + '/pay', { method: 'POST', body: JSON.stringify({ amount: amt, method }) });
  loadFees();
};

// ---- Results ----
let resFilter = { search: '', class: '' };
async function loadResults() {
  if (me.role === 'parent') { $('#view').innerHTML = '<div class="card"><h3>Results</h3><p>Apne bachay ka result Dashboard / My Child se dekhein.</p></div>'; return; }
  const rows = await api('/api/results?' + new URLSearchParams({ exam: 'Mid Term 2026', search: resFilter.search, class: resFilter.class }));
  const byStudent = {};
  rows.forEach(r => { (byStudent[r.student_id] = byStudent[r.student_id] || { name: r.name, cls: r.class_name, marks: 0, total: 0 }); byStudent[r.student_id].marks += r.marks; byStudent[r.student_id].total += r.total_marks; });
  const list = Object.values(byStudent).map(s => ({ ...s, pct: (s.marks / s.total * 100).toFixed(1) })).sort((a,b)=>b.pct-a.pct);
  $('#view').innerHTML = `<div class="card"><h3>Results — Mid Term 2026${me.role === 'teacher' ? ' (my subjects only)' : ''}</h3><p>Auto total / percentage / grade from server results.</p>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-bottom:10px">
  <div><label style="margin:0 0 4px">Class</label><select id="resClass" style="max-width:160px"><option value="">All classes</option>${CLASSES.map(c => `<option ${c===resFilter.class?'selected':''}>${c}</option>`).join('')}</select></div>
  <div style="flex:1;min-width:200px"><label style="margin:0 0 4px">Search (naam / roll / subject)</label><input id="resSearch" placeholder="e.g. Sara, 01, Maths" value="${esc(resFilter.search)}"></div>
  <button id="resGo">Search</button><button id="resClear" class="secondary">Clear</button></div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><button id="addRes">+ Add Result</button>
  ${me.role === 'admin' ? '<button id="expRes" class="secondary">Export Results CSV</button>' : ''}</div>
  <table><tr><th>Student</th><th>Class</th><th>Total</th><th>%</th><th>Grade</th></tr>
  ${list.slice(0,120).map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.cls)}</td><td>${s.marks}/${s.total}</td><td>${s.pct}%</td><td>${s.pct>=90?'A+':s.pct>=80?'A':s.pct>=70?'B':s.pct>=60?'C':s.pct>=50?'D':'F'}</td></tr>`).join('')}</table><p>Showing top 120 of ${list.length} students.</p></div>`;
  const expBtn = $('#expRes'); if (expBtn) expBtn.onclick = () => downloadFile('/api/export/results?exam=Mid Term 2026', 'results.csv').catch(e => alert(e.message));
  const resDoSearch = () => { resFilter.class = $('#resClass').value; resFilter.search = ($('#resSearch').value || '').trim(); loadResults(); };
  $('#resGo').onclick = resDoSearch;
  $('#resSearch').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); resDoSearch(); } };
  $('#resClear').onclick = () => { resFilter = { search: '', class: '' }; loadResults(); };
  $('#addRes').onclick = () => resultForm();
}
// ---- Add Result form: pick student (search by name / roll / class), exam, subject, marks ----
let resultStudents = [], resultTeacherAssign = [];
async function resultForm() {
  resultStudents = await api('/api/students?status=active');
  resultTeacherAssign = [];
  if (me.role === 'teacher') {
    try { const t = await api('/api/my-teacher'); resultTeacherAssign = t.assignments || []; } catch { resultTeacherAssign = []; }
  }
  openModal(`<h3>Add Result</h3>
  <label>Search student (name / roll no / class)</label><input id="r_search" placeholder="e.g. Sara, 01, Class 5">
  <label>Student</label><select id="r_student"></select>
  <label>Class (kis class ka result hai?)</label><select id="r_class">${CLASSES.map(c => `<option>${c}</option>`).join('')}</select>
  <p style="font-size:13px;color:var(--muted)">Default: student ki current class. Purani class ka result add karna ho to yahan woh class chunein — woh result student ki profile mein “Previous Class Results” mein dikhega.</p>
  <label>Exam</label><input id="r_exam" value="Mid Term 2026" list="r_exams"><datalist id="r_exams"><option>Mid Term 2026</option><option>Final Term 2026</option><option>Annual Exam 2025</option><option>Monthly Test</option></datalist>
  <label>Subject</label><select id="r_subject"></select>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
    <div><label>Marks obtained</label><input id="r_marks" type="number" min="0" value="70"></div>
    <div><label>Total marks</label><input id="r_total" type="number" min="1" value="100"></div>
  </div>
  <p id="r_hint" style="font-size:13px;color:#64748b"></p>
  <div style="display:flex;gap:8px;margin-top:12px"><button id="r_save">Save Result (server)</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`);
  const fillStudents = () => {
    const q = ($('#r_search').value || '').toLowerCase();
    const filtered = resultStudents.filter(s => !q || s.name.toLowerCase().includes(q) || String(s.roll_no).includes(q) || ('class ' + s.class_name).includes(q) || String(s.class_name) === q);
    $('#r_student').innerHTML = filtered.map(s => `<option value="${s.id}">${esc(s.name)} — Class ${esc(s.class_name)}-${esc(s.section)}, Roll ${esc(s.roll_no)}</option>`).join('') || '<option value="">No student found</option>';
    const sel = resultStudents.find(s => String(s.id) === $('#r_student').value);
    if (sel) $('#r_class').value = sel.class_name;
    fillSubjects();
  };
  const fillSubjects = () => {
    const sel = resultStudents.find(s => String(s.id) === $('#r_student').value);
    const cls = $('#r_class').value;
    let subs = subjectsForClass(cls);
    if (me.role === 'teacher') {
      subs = resultTeacherAssign.filter(a => a.class_name === cls).map(a => a.subject);
      $('#r_hint').textContent = subs.length ? 'Teacher: sirf apne assigned subjects ka result add kar sakte hain (Class ' + cls + ').' : 'Is class (' + cls + ') mein aap ko koi subject assign nahi hai — pehle admin se assignment karwayein.';
    } else if (sel) {
      $('#r_hint').textContent = 'Student: ' + sel.name + ' — current Class ' + sel.class_name + ', Roll ' + sel.roll_no + '. Result Class ' + cls + ' ke liye save hoga.';
    }
    $('#r_subject').innerHTML = subs.map(s => `<option>${s}</option>`).join('') || '<option value="">—</option>';
  };
  $('#r_search').oninput = fillStudents;
  $('#r_student').onchange = fillStudents;
  $('#r_class').onchange = fillSubjects;
  fillStudents();
  $('#r_save').onclick = async () => {
    try {
      const body = { student_id: +$('#r_student').value, exam: $('#r_exam').value.trim(), subject: $('#r_subject').value, marks: +$('#r_marks').value, total_marks: +$('#r_total').value, class_name: $('#r_class').value };
      if (!body.student_id || !body.exam || !body.subject) { alert('Please pick a student, exam and subject.'); return; }
      await api('/api/results', { method: 'POST', body: JSON.stringify(body) });
      closeModal(); alert('Result saved (Class ' + body.class_name + '). Student profile aur Results list mein ab naya result dikhega.' + (body.class_name !== (resultStudents.find(s => s.id === body.student_id) || {}).class_name ? ' Ye previous class ka result hai — profile mein “Previous Class Results” mein dikhega.' : ''));
      loadResults();
    } catch (e) { alert(e.message); }
  };
}

// ---- Teachers ----
let teacherSearch = '';
async function loadTeachers() {
  if (me.role === 'parent') { $('#view').innerHTML = '<div class="card"><h3>Teachers</h3><p>Parents cannot see the teachers list.</p></div>'; return; }
  teachersCache = await api('/api/teachers?' + new URLSearchParams({ search: teacherSearch }));
  const isTeacher = me.role === 'teacher';
  const isAdmin = me.role === 'admin';
  $('#view').innerHTML = `<div class="card"><h3>${isTeacher ? 'My Profile' : 'Teachers & Staff (' + teachersCache.length + ')'}</h3>
  ${isTeacher ? '' : `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-bottom:10px"><div style="flex:1;min-width:220px"><label style="margin:0 0 4px">Search teacher (naam / subject / designation)</label><input id="tSearch" placeholder="e.g. Ahmed, Maths, Senior Teacher" value="${esc(teacherSearch)}"></div><button id="tGo">Search</button><button id="tClear" class="secondary">Clear</button></div>`}
  ${isAdmin ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><button id="addTeacher">+ Add Teacher / Staff</button><span style="font-size:13px;color:var(--muted);align-self:center">Naye teacher ka login khud ban jayega — username = pehla naam (small letters), password <code>teacher123</code>.</span></div>' : ''}
  <table><tr><th>Name</th><th>Designation</th><th>Qualification</th>${isTeacher ? '' : '<th>Salary</th>'}<th>Phone</th><th>Assignments</th><th></th></tr>
  ${teachersCache.length === 0 ? '<p>Koi teacher nahi mila — search dobara check karein.</p>' : ''}
  ${teachersCache.map(t=>`<tr><td>${esc(t.name)}</td><td>${esc(t.designation)}</td><td>${esc(t.qualification)}</td>${isTeacher ? '' : `<td>Rs ${t.salary}</td>`}<td>${esc(t.phone)}</td><td>${t.assignments.map(a=>esc(a.class_name)+' '+esc(a.subject)).join(', ')}</td><td><button class="secondary" onclick="viewTeacher(${t.id})">Profile</button>${isAdmin ? ` <button class="secondary" onclick="editTeacher(${t.id})">Edit</button>` : ''}</td></tr>`).join('')}</table></div>`;
  const tGo = $('#tGo'); if (tGo) tGo.onclick = () => { teacherSearch = ($('#tSearch').value || '').trim(); loadTeachers(); };
  const tSearch = $('#tSearch'); if (tSearch) tSearch.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); teacherSearch = (tSearch.value || '').trim(); loadTeachers(); } };
  const tClear = $('#tClear'); if (tClear) tClear.onclick = () => { teacherSearch = ''; loadTeachers(); };
  const addBtn = $('#addTeacher'); if (addBtn) addBtn.onclick = () => teacherForm();
}
// ---- Add / Edit Teacher / Staff form (admin only) — full-info form ----
// Fields: full name, father name, CNIC / ID card, date of birth, phone,
// email (optional), home address, qualification, experience, salary,
// date of joining, designation/post, class + subject assignments.
let teacherAssignDraft = [];
function teacherForm(t) {
  t = t || {};
  teacherAssignDraft = (t.assignments || []).map(a => ({ class_name: a.class_name, subject: a.subject }));
  const v = k => esc(t[k] || '');
  openModal(`<h3>${t.id ? 'Edit Teacher Profile' : 'Add Teacher / Staff'}</h3>
  <p style="font-size:13px;color:var(--muted)">${t.id ? 'Purane teacher ki khaali fields bhi yahin se bhari ja sakti hain.' : 'Naye teacher ka login khud ban jayega — username = pehla naam (small letters), password <code>teacher123</code>.'}</p>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 10px">
    <div><label>Full name *</label><input id="t_name" placeholder="e.g. Ali Raza" value="${v('name')}"></div>
    <div><label>Father name</label><input id="t_father" placeholder="e.g. Muhammad Raza" value="${v('father_name')}"></div>
    <div><label>CNIC / ID card number</label><input id="t_cnic" placeholder="e.g. 35202-1234567-1" value="${v('cnic')}"></div>
    <div><label>Date of birth</label><input id="t_dob" type="date" value="${v('dob')}"></div>
    <div><label>Phone</label><input id="t_phone" placeholder="e.g. 03001234567" value="${v('phone')}"></div>
    <div><label>Email (optional)</label><input id="t_email" type="email" placeholder="e.g. ali@example.com" value="${v('email')}"></div>
  </div>
  <label>Home address</label><textarea id="t_address" rows="2" placeholder="House / street / area / city">${v('address')}</textarea>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 10px">
    <div><label>Qualification</label><input id="t_qual" placeholder="e.g. M.Sc Maths, B.Ed" value="${v('qualification')}"></div>
    <div><label>Experience</label><input id="t_exp" placeholder="e.g. 5 years" value="${v('experience')}"></div>
    <div><label>Salary (Rs / month)</label><input id="t_sal" type="number" min="0" value="${t.salary || 50000}"></div>
    <div><label>Date of joining</label><input id="t_join" type="date" value="${v('joining_date')}"></div>
  </div>
  <label>Designation / Post</label><input id="t_des" placeholder="e.g. Teacher, Senior Teacher, Computer Teacher" list="t_des_list" value="${v('designation')}"><datalist id="t_des_list"><option>Teacher</option><option>Senior Teacher</option><option>Junior Teacher</option><option>Science Teacher</option><option>Computer Teacher</option><option>Qaria</option></datalist>
  <h4>Classes &amp; Subjects (assignments)</h4>
  <p style="font-size:13px;color:var(--muted)">Class chunein, phir subject chunein, phir “Add assignment” dabayein. Ek teacher ko kayi classes/subjects diye ja sakte hain.</p>
  <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end">
    <div><label>Class</label><select id="t_class">${CLASSES.map(c=>`<option>${c}</option>`).join('')}</select></div>
    <div><label>Subject</label><select id="t_subj"></select></div>
    <button type="button" id="t_addAssign" class="secondary" style="margin-bottom:2px">+ Add assignment</button>
  </div>
  <div id="t_assignList" style="margin-top:8px"></div>
  <div style="display:flex;gap:8px;margin-top:14px"><button id="t_save">${t.id ? 'Update Teacher' : 'Save Teacher (server)'}</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`);
  const fillSubj = () => { $('#t_subj').innerHTML = subjectsForClass($('#t_class').value).map(s => `<option>${s}</option>`).join(''); };
  const renderAssign = () => {
    $('#t_assignList').innerHTML = teacherAssignDraft.length
      ? teacherAssignDraft.map((a, i) => `<span class="chip">Class ${esc(a.class_name)} — ${esc(a.subject)} <button type="button" class="chip-x" onclick="window._delAssign(${i})">×</button></span>`).join(' ')
      : '<p style="font-size:13px;color:var(--muted)">Abhi koi assignment nahi — kam se kam ek assignment add karein taake teacher ki timetable aur classes ban sakein.</p>';
  };
  window._delAssign = (i) => { teacherAssignDraft.splice(i, 1); renderAssign(); };
  $('#t_class').onchange = fillSubj; fillSubj(); renderAssign();
  $('#t_addAssign').onclick = () => {
    const a = { class_name: $('#t_class').value, subject: $('#t_subj').value };
    if (!teacherAssignDraft.some(x => x.class_name === a.class_name && x.subject === a.subject)) teacherAssignDraft.push(a);
    renderAssign();
  };
  $('#t_save').onclick = async () => {
    try {
      const name = $('#t_name').value.trim();
      if (!name) { alert('Please enter the teacher name.'); return; }
      const body = { name, father_name: $('#t_father').value.trim(), cnic: $('#t_cnic').value.trim(), dob: $('#t_dob').value, email: $('#t_email').value.trim(), address: $('#t_address').value.trim(), qualification: $('#t_qual').value.trim(), experience: $('#t_exp').value.trim(), salary: +$('#t_sal').value || 0, joining_date: $('#t_join').value, designation: $('#t_des').value.trim(), phone: $('#t_phone').value.trim(), assignments: teacherAssignDraft };
      if (t.id) {
        body.subjects = [...new Set(teacherAssignDraft.map(a => a.subject))].join(', ');
        await api('/api/teachers/' + t.id, { method: 'PUT', body: JSON.stringify(body) });
        closeModal(); alert('Teacher profile updated! Saari details save ho gayi hain.');
        loadTeachers();
      } else {
        const r = await api('/api/teachers', { method: 'POST', body: JSON.stringify(body) });
        closeModal();
        alert('Teacher saved! Login ban gaya hai — Username: ' + r.loginUsername + ' | Password: teacher123\nAssignments: ' + r.assignmentsSaved + ' saved. Teacher isi login se apni classes dekh sakta hai.');
        loadTeachers();
      }
    } catch (e) { alert(e.message); }
  };
}
window.editTeacher = async (id) => {
  const t = await api('/api/teachers/' + id);
  teacherForm(t);
};
window.viewTeacher = async (id) => {
  const t = await api('/api/teachers/' + id);
  window._curTeacher = t;
  const field = (label, val) => val ? `<p><b>${label}:</b> ${esc(val)}</p>` : '';
  openModal(`<h3>${esc(t.name)} — ${esc(t.designation)}</h3>
  <div class="profile-grid">
    ${field('Father name', t.father_name)}
    ${field('CNIC / ID card', t.cnic)}
    ${field('Date of birth', t.dob)}
    ${field('Phone', t.phone)}
    ${field('Email', t.email)}
    ${field('Home address', t.address)}
    ${field('Qualification', t.qualification)}
    ${field('Experience', t.experience)}
    ${t.salary ? `<p><b>Salary:</b> Rs ${t.salary}</p>` : ''}
    ${field('Date of joining', t.joining_date)}
    ${field('Designation / Post', t.designation)}
    <p><b>Staff attendance:</b> ${t.attPct}%</p>
  </div>
  <p style="font-size:13px;color:var(--muted)">Khaali fields purane teachers ki hain — admin Edit Profile se bhar sakta hai.</p>
  <h4>Subject-wise student progress (from real Mid Term results)</h4>
  ${t.progress.map(p=>`<div class="progress-row"><span>Class ${esc(p.class_name)} ${esc(p.subject)}</span><div class="bar"><i style="width:${p.avg}%"></i></div><b>${p.avg}%</b></div><p style="font-size:13px;color:#64748b">Top: ${p.top.map(x=>esc(x.name)+' '+x.pct.toFixed(0)+'%').join(', ') || '-'}</p>`).join('')}
  <h4>Weekly timetable — Periods (rows) × Days (columns)</h4>
  ${timetableGridHTML(t.timetable, { showClass: true, showTeacher: false })}
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
  ${me.role === 'admin' ? '<button onclick="closeModal();teacherForm(window._curTeacher)">Edit Profile</button>' : ''}
  <button class="secondary" onclick="closeModal()">Close</button></div>`);
};

// ---- Timetable ----
async function loadTimetable() {
  const isAdmin = me.role === 'admin';
  const cls = isAdmin ? (stuFilter.class || '1') : '';
  const rows = await api('/api/timetable' + (isAdmin ? '?class=' + cls : ''));
  const title = isAdmin ? 'Timetable — Class ' + cls : me.role === 'teacher' ? 'My Timetable' : 'Child Timetable';
  $('#view').innerHTML = `<div class="card"><h3>${title} — Periods (rows) × Days (columns)</h3>
  ${isAdmin ? `<select id="tClass" style="max-width:160px">${CLASSES.map(c=>`<option ${c===cls?'selected':''}>${c}</option>`).join('')}</select>
  <button id="regen" class="secondary">Regenerate from teacher assignments</button>` : ''}
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin:10px 0">
  <div style="flex:1;min-width:220px"><label style="margin:0 0 4px">Search timetable (subject / teacher naam)</label><input id="ttSearch" placeholder="e.g. Maths, Ahmed Raza" value="${esc(window._ttSearch || '')}"></div>
  <button id="ttGo">Search</button><button id="ttClear" class="secondary">Clear</button></div>
  <div id="ttMatches"></div>
  ${timetableGridHTML(rows, { showClass: me.role === 'teacher', showTeacher: isAdmin })}</div>`;
  const ttDoSearch = () => {
    const q = ($('#ttSearch').value || '').trim().toLowerCase();
    window._ttSearch = $('#ttSearch').value || '';
    const box = $('#ttMatches');
    if (!q) { box.innerHTML = ''; document.querySelectorAll('.tt-cell').forEach(c => c.classList.remove('tt-match')); return; }
    const hits = rows.filter(r => (r.subject + ' ' + (r.teacher_name || '') + ' ' + r.class_name).toLowerCase().includes(q));
    // Highlight matching cells in the grid (same order as rows in the table).
    document.querySelectorAll('.tt-table tbody tr:not(.tt-break)').forEach(tr => {
      tr.querySelectorAll('td.tt-cell').forEach(td => { td.classList.toggle('tt-match', td.textContent.toLowerCase().includes(q)); });
    });
    box.innerHTML = hits.length
      ? `<p><b>${hits.length} matching period(s) found for “${esc(window._ttSearch)}”:</b></p><table><tr><th>Day</th><th>Period</th><th>Class</th><th>Subject</th><th>Teacher</th><th>Time</th></tr>${hits.map(r => `<tr><td>${r.day}</td><td>${r.period}</td><td>${esc(r.class_name)}</td><td>${esc(r.subject)}</td><td>${esc(r.teacher_name || '—')}</td><td>${esc(r.start_time)}–${esc(r.end_time)}</td></tr>`).join('')}</table>`
      : `<p>Koi period nahi mila for “${esc(window._ttSearch)}”.</p>`;
  };
  $('#ttGo').onclick = ttDoSearch;
  $('#ttSearch').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ttDoSearch(); } };
  $('#ttClear').onclick = () => { window._ttSearch = ''; loadTimetable(); };
  if (window._ttSearch) ttDoSearch();
  if (isAdmin) {
    $('#tClass').onchange = e => { stuFilter.class = e.target.value; loadTimetable(); };
    $('#regen').onclick = async () => { await api('/api/timetable/regenerate', { method: 'POST' }); loadTimetable(); };
  }
}

// ---- Leaving / Promoted (admin only) ----
let leavingSearch = '';
async function loadLeaving() {
  if (me.role !== 'admin') { $('#view').innerHTML = '<div class="card"><h3>Leaving / Promoted</h3><p>Only admin can see this.</p></div>'; return; }
  const [left, promos] = await Promise.all([api('/api/leaving?' + new URLSearchParams({ search: leavingSearch })), api('/api/promotions?' + new URLSearchParams({ search: leavingSearch }))]);
  $('#view').innerHTML = `<div class="card" style="margin-bottom:14px"><h3 style="margin-top:0">Search Leaving / Promoted</h3>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">
  <div style="flex:1;min-width:220px"><label style="margin:0 0 4px">Search (student naam / wajah / SLC / exam)</label><input id="lvSearch" placeholder="e.g. Ahmed, Lahore, SLC-2026-001, Annual Exam" value="${esc(leavingSearch)}"></div>
  <button id="lvGo">Search</button><button id="lvClear" class="secondary">Clear</button></div>
  <p>${left.length} left + ${promos.length} promotions found</p></div>
  <div class="grid2">
  <div class="card"><h3>Left School (${left.length})</h3><table><tr><th>Student</th><th>Last Class</th><th>Date</th><th>Reason</th><th>SLC</th></tr>${left.map(l=>`<tr><td>${esc(l.name)}</td><td>${esc(l.last_class)}</td><td>${esc(l.leaving_date)}</td><td>${esc(l.reason)}</td><td>${esc(l.slc_number)}</td></tr>`).join('')}</table></div>
  <div class="card"><h3>Promotions (${promos.length})</h3><table><tr><th>Student</th><th>From → To</th><th>Exam</th><th>%</th></tr>${promos.slice(0,80).map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.from_class)} → ${esc(p.to_class)}</td><td>${esc(p.exam)}</td><td>${p.percentage}%</td></tr>`).join('')}</table><p>Showing 80 of ${promos.length}.</p></div></div>`;
  const lvDoSearch = () => { leavingSearch = ($('#lvSearch').value || '').trim(); loadLeaving(); };
  $('#lvGo').onclick = lvDoSearch;
  $('#lvSearch').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); lvDoSearch(); } };
  $('#lvClear').onclick = () => { leavingSearch = ''; loadLeaving(); };
}

// ---- Backup & Export (admin only) ----
async function loadBackup() {
  if (me.role !== 'admin') { $('#view').innerHTML = '<div class="card"><h3>Backup & Export</h3><p>Only admin can use backup and export.</p></div>'; return; }
  const month = $('#monthInput').value, date = $('#todayInput').value;
  $('#view').innerHTML = `<div class="card"><h3>Backup &amp; Export — Admin only</h3>
  <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:10px;padding:12px;margin:10px 0">
    <b>📦 Full Database Backup (ye backup hai)</b><br>
    Ye button poori database file (.db) download karta hai — is mein students, attendance, fees, results, teachers, timetable, sab kuch hota hai.
    Is file ko safe jagah (Google Drive / computer) save karein. Agar server ka data kharab ho jaye ya delete ho jaye, to isi file se data wapas laaya ja sakta hai.
    Haftay mein aik dafa backup download karna behtareen aadat hai.
  </div>
  <button id="dlBackup">Download Full Backup (.db)</button>
  <h4>CSV Export (Excel mein khulta hai)</h4>
  <p>CSV files mein Urdu/English naam safe tareeqay se save hote hain.</p>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <button id="expStu2" class="secondary">Export Students CSV</button>
    <button id="expFees2" class="secondary">Export Fees CSV (${month})</button>
    <button id="expRes2" class="secondary">Export Results CSV</button>
    <button id="expAtt2" class="secondary">Export Attendance CSV (${date})</button>
  </div>
  <p style="font-size:13px;color:#64748b">Fees aur Attendance export ke liye upar wala Month / Date use hota hai — pehle woh set karein, phir Refresh dabayein.</p></div>`;
  $('#dlBackup').onclick = () => downloadFile('/api/backup', 'school-backup-' + date + '.db').catch(e => alert(e.message));
  $('#expStu2').onclick = () => downloadFile('/api/export/students', 'students.csv').catch(e => alert(e.message));
  $('#expFees2').onclick = () => downloadFile('/api/export/fees?month=' + month, 'fees-' + month + '.csv').catch(e => alert(e.message));
  $('#expRes2').onclick = () => downloadFile('/api/export/results?exam=Mid Term 2026', 'results.csv').catch(e => alert(e.message));
  $('#expAtt2').onclick = () => downloadFile('/api/export/attendance?date=' + date, 'attendance-' + date + '.csv').catch(e => alert(e.message));
}
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }
window.closeModal = closeModal;
$('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };
checkLogin();
