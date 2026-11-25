// Frontend for School Management System — all data comes from the server API
// (SQLite on the server). Nothing is stored in localStorage as a database.
const $ = s => document.querySelector(s);
const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || ('Request failed: ' + r.status));
  return d;
};
let me = null, tab = 'dashboard', studentsCache = [], teachersCache = [];
const TABS = [['dashboard','Dashboard'],['students','Students'],['attendance','Attendance'],['fees','Fees'],['results','Results'],['teachers','Teachers & Staff'],['timetable','Timetable'],['leaving','Leaving / Promoted']];
const CLASSES = ['Nursery','KG','1','2','3','4','5','6','7','8','9','10'];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

async function checkLogin() {
  try { me = await api('/api/me'); } catch { me = { loggedIn: false }; }
  $('#loginView').classList.toggle('hidden', !!me.loggedIn);
  $('#appView').classList.toggle('hidden', !me.loggedIn);
  if (me.loggedIn) { $('#schoolTitle').textContent = me.schoolName + ' — School Management System'; $('#userLine').textContent = 'Logged in as ' + me.username; renderTabs(); loadDashboard(); }
}
$('#loginBtn').onclick = async () => {
  try { await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('#username').value, password: $('#password').value }) }); $('#loginMsg').textContent = ''; checkLogin(); }
  catch (e) { $('#loginMsg').textContent = e.message; }
};
$('#registerBtn').onclick = async () => {
  try { await api('/api/register', { method: 'POST', body: JSON.stringify({ username: $('#username').value, password: $('#password').value, schoolName: $('#schoolName').value || 'My School' }) }); $('#loginMsg').textContent = ''; checkLogin(); }
  catch (e) { $('#loginMsg').textContent = e.message; }
};
$('#logoutBtn').onclick = async () => { await api('/api/logout', { method: 'POST' }); checkLogin(); };
$('#refreshBtn').onclick = () => loadTab(tab);
function renderTabs() { $('#tabs').innerHTML = TABS.map(([k, l]) => `<button data-t="${k}" class="${k===tab?'active':''}">${l}</button>`).join(''); document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; renderTabs(); loadTab(tab); }); }
function loadTab(t) { ({ dashboard: loadDashboard, students: loadStudents, attendance: loadAttendance, fees: loadFees, results: loadResults, teachers: loadTeachers, timetable: loadTimetable, leaving: loadLeaving })[t](); }

async function loadDashboard() {
  const d = await api(`/api/dashboard?today=${$('#todayInput').value}&month=${$('#monthInput').value}`);
  $('#dashCards').innerHTML = [
    [d.total, 'Active Students'], [d.present, 'Present Today (' + d.today + ')'], [d.teachers, 'Teachers'],
    ['Rs ' + d.feesCollected.toLocaleString(), 'Fees Collected (' + d.month + ')'],
    ['Rs ' + d.feesPending.toLocaleString(), 'Fees Pending'], [d.left, 'Left School'], [d.promoted, 'Promoted'], [d.staffPresent, 'Staff Present Today'],
  ].map(([v, l]) => `<div class="card"><b>${v}</b><span>${l}</span></div>`).join('');
  $('#view').innerHTML = `<div class="card"><h3>Students per class (active)</h3>${d.byClass.map(c => `<div class="progress-row"><span>Class ${esc(c.class_name)}</span><div class="bar"><i style="width:${Math.min(100, c.c / 25 * 100)}%"></i></div><b>${c.c}</b></div>`).join('')}<p>Total students in system: ${d.totalAll} (249 seeded). Attendance today: ${d.attendance.map(a => a.status + ' ' + a.c).join(', ') || 'not marked yet'}.</p></div>`;
}

// ---- Students ----
let stuFilter = { class: '', search: '' };
async function loadStudents() {
  studentsCache = await api('/api/students?' + new URLSearchParams({ class: stuFilter.class, search: stuFilter.search }));
  $('#view').innerHTML = `<div class="card"><div style="display:flex;gap:8px;flex-wrap:wrap">
    <select id="fClass" style="max-width:160px"><option value="">All classes</option>${CLASSES.map(c => `<option ${c===stuFilter.class?'selected':''}>${c}</option>`).join('')}</select>
    <input id="fSearch" placeholder="Search name / roll no" value="${esc(stuFilter.search)}" style="max-width:260px">
    <button id="fGo">Filter</button><button id="addStu">+ Add Student</button></div>
    <p>${studentsCache.length} students</p>
    <div style="overflow-x:auto"><table><tr><th>Roll</th><th>Name</th><th>Father</th><th>Class</th><th>Phone</th><th>Monthly Fee</th><th>Status</th><th></th></tr>
    ${studentsCache.map(s => `<tr><td>${esc(s.roll_no)}</td><td>${esc(s.name)}</td><td>${esc(s.father_name)}</td><td>${esc(s.class_name)}-${esc(s.section)}</td><td>${esc(s.phone)}</td><td>Rs ${s.monthly_fee}</td><td><span class="badge ${s.status==='left'?'left':''}">${s.status}</span></td><td><button class="secondary" onclick="viewStudent(${s.id})">Profile</button></td></tr>`).join('')}</table></div></div>`;
  $('#fGo').onclick = () => { stuFilter.class = $('#fClass').value; stuFilter.search = $('#fSearch').value; loadStudents(); };
  $('#addStu').onclick = () => studentForm();
}
function studentForm(s) {
  s = s || {};
  openModal(`<h3>${s.id ? 'Edit' : 'Add'} Student</h3>
  <label>Name</label><input id="m_name" value="${esc(s.name||'')}">
  <label>Father name</label><input id="m_father" value="${esc(s.father_name||'')}">
  <label>Class</label><select id="m_class">${CLASSES.map(c=>`<option ${c===s.class_name?'selected':''}>${c}</option>`).join('')}</select>
  <label>Section</label><input id="m_section" value="${esc(s.section||'A')}">
  <label>Roll No</label><input id="m_roll" value="${esc(s.roll_no||'')}">
  <label>Parent phone</label><input id="m_phone" value="${esc(s.phone||'')}">
  <label>Monthly fee (Rs)</label><input id="m_fee" type="number" value="${s.monthly_fee||1500}">
  <label>Admission date</label><input id="m_adm" type="date" value="${esc(s.admission_date||'2026-04-01')}">
  <div style="display:flex;gap:8px;margin-top:12px"><button id="m_save">Save (server)</button><button class="secondary" onclick="closeModal()">Cancel</button></div>`);
  $('#m_save').onclick = async () => {
    const body = { name: $('#m_name').value, father_name: $('#m_father').value, class_name: $('#m_class').value, section: $('#m_section').value, roll_no: $('#m_roll').value, phone: $('#m_phone').value, monthly_fee: +$('#m_fee').value, admission_date: $('#m_adm').value };
    if (s.id) await api('/api/students/' + s.id, { method: 'PUT', body: JSON.stringify(body) });
    else await api('/api/students', { method: 'POST', body: JSON.stringify(body) });
    closeModal(); loadStudents();
  };
}
window.viewStudent = async (id) => {
  const s = await api('/api/students/' + id);
  const totalMarks = s.results.reduce((a, r) => a + r.marks, 0), totalOf = s.results.reduce((a, r) => a + r.total_marks, 0);
  const pct = totalOf ? (totalMarks / totalOf * 100).toFixed(1) : 0;
  window._curStudent = s;
  openModal(`<h3>${esc(s.name)} — Class ${esc(s.class_name)}-${esc(s.section)}</h3>
  <p>Roll ${esc(s.roll_no)} | Father: ${esc(s.father_name)} | Phone: ${esc(s.phone)}<br>Monthly fee Rs ${s.monthly_fee} | Admission ${esc(s.admission_date)} | Status ${s.status}</p>
  <h4>Results (Mid Term 2026) — ${pct}%</h4><div class="bar"><i style="width:${pct}%"></i></div>
  <table><tr><th>Subject</th><th>Marks</th></tr>${s.results.map(r=>`<tr><td>${esc(r.subject)}</td><td>${r.marks}/${r.total_marks}</td></tr>`).join('')}</table>
  <h4>Fees</h4>${s.fees.map(f=>`<p>${f.month}: Rs ${f.paid}/${f.amount} — ${f.status}</p>`).join('')}
  <h4>Promotions</h4>${s.promotions.map(p=>`<p>${esc(p.from_class)} → ${esc(p.to_class)} (${esc(p.exam)}, ${p.percentage}%)</p>`).join('') || '<p>None</p>'}
  ${s.leaving ? `<h4>Leaving record</h4><p>${esc(s.leaving.leaving_date)} — ${esc(s.leaving.reason)} — SLC ${esc(s.leaving.slc_number)}</p>` : ''}
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
  <button onclick="closeModal();studentForm(window._curStudent)">Edit</button>
  <button class="secondary" onclick="leaveStudent(${s.id})">Mark as Left School</button>
  <button class="secondary" onclick="promoteStudent(${s.id})">Promote</button>
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
  const date = $('#todayInput').value, cls = stuFilter.class || '';
  const list = await api('/api/students?class=' + cls + '&status=active');
  $('#view').innerHTML = `<div class="card"><h3>Attendance — ${date}</h3>
  <select id="aClass" style="max-width:160px"><option value="">All classes</option>${CLASSES.map(c=>`<option ${c===cls?'selected':''}>${c}</option>`).join('')}</select>
  <button id="aAll">Mark all Present</button> <button id="aSave">Save Attendance</button>
  <table><tr><th>Name</th><th>Class</th><th>Status</th></tr>${list.map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.class_name)}</td><td><select data-sid="${s.id}" class="aStatus"><option>Present</option><option>Absent</option><option>Late</option><option>Leave</option></select></td></tr>`).join('')}</table></div>`;
  $('#aClass').onchange = e => { stuFilter.class = e.target.value; loadAttendance(); };
  $('#aAll').onclick = () => document.querySelectorAll('.aStatus').forEach(x => x.value = 'Present');
  $('#aSave').onclick = async () => {
    const records = [...document.querySelectorAll('.aStatus')].map(x => ({ student_id: +x.dataset.sid, status: x.value }));
    await api('/api/attendance', { method: 'POST', body: JSON.stringify({ date, records }) });
    alert('Attendance saved to server database (' + records.length + ' records).');
  };
}

// ---- Fees ----
async function loadFees() {
  const month = $('#monthInput').value;
  const fees = await api('/api/fees?month=' + month);
  const total = fees.reduce((a, f) => a + f.amount, 0), collected = fees.reduce((a, f) => a + f.paid, 0);
  $('#view').innerHTML = `<div class="card"><h3>Fees — ${month}</h3>
  <p><b>Total Rs ${total.toLocaleString()}</b> | Collected Rs ${collected.toLocaleString()} | Pending Rs ${(total-collected).toLocaleString()}</p>
  <button id="genFees">Generate challans for this month</button>
  <table><tr><th>Student</th><th>Class</th><th>Amount</th><th>Paid</th><th>Status</th><th>Method</th><th></th></tr>
  ${fees.map(f=>`<tr><td>${esc(f.name)}</td><td>${esc(f.class_name)}</td><td>${f.amount}</td><td>${f.paid}</td><td><span class="badge ${f.status}">${f.status}</span></td><td>${esc(f.payment_method||'-')}</td><td>${f.status!=='paid'?`<button onclick="payFee(${f.id},${f.amount-f.paid})">Record payment</button>`:''}</td></tr>`).join('')}</table></div>`;
  $('#genFees').onclick = async () => { const r = await api('/api/fees/generate', { method: 'POST', body: JSON.stringify({ month }) }); alert('Created ' + r.created + ' new challans.'); loadFees(); };
}
window.payFee = async (id, remaining) => {
  const amt = +prompt('Payment amount (Rs)?', remaining); if (!amt) return;
  const method = prompt('Method? Cash / JazzCash / EasyPaisa / Bank', 'Cash');
  await api('/api/fees/' + id + '/pay', { method: 'POST', body: JSON.stringify({ amount: amt, method }) });
  loadFees();
};

// ---- Results ----
async function loadResults() {
  const rows = await api('/api/results?exam=Mid Term 2026');
  const byStudent = {};
  rows.forEach(r => { (byStudent[r.student_id] = byStudent[r.student_id] || { name: r.name, cls: r.class_name, marks: 0, total: 0 }); byStudent[r.student_id].marks += r.marks; byStudent[r.student_id].total += r.total_marks; });
  const list = Object.values(byStudent).map(s => ({ ...s, pct: (s.marks / s.total * 100).toFixed(1) })).sort((a,b)=>b.pct-a.pct);
  $('#view').innerHTML = `<div class="card"><h3>Results — Mid Term 2026</h3><p>Auto total / percentage / grade from server results.</p>
  <table><tr><th>Student</th><th>Class</th><th>Total</th><th>%</th><th>Grade</th></tr>
  ${list.slice(0,120).map(s=>`<tr><td>${esc(s.name)}</td><td>${esc(s.cls)}</td><td>${s.marks}/${s.total}</td><td>${s.pct}%</td><td>${s.pct>=90?'A+':s.pct>=80?'A':s.pct>=70?'B':s.pct>=60?'C':s.pct>=50?'D':'F'}</td></tr>`).join('')}</table><p>Showing top 120 of ${list.length} students.</p></div>`;
}

// ---- Teachers ----
async function loadTeachers() {
  teachersCache = await api('/api/teachers');
  $('#view').innerHTML = `<div class="card"><h3>Teachers & Staff (${teachersCache.length})</h3>
  <table><tr><th>Name</th><th>Designation</th><th>Qualification</th><th>Salary</th><th>Phone</th><th>Assignments</th><th></th></tr>
  ${teachersCache.map(t=>`<tr><td>${esc(t.name)}</td><td>${esc(t.designation)}</td><td>${esc(t.qualification)}</td><td>Rs ${t.salary}</td><td>${esc(t.phone)}</td><td>${t.assignments.map(a=>esc(a.class_name)+' '+esc(a.subject)).join(', ')}</td><td><button class="secondary" onclick="viewTeacher(${t.id})">Profile</button></td></tr>`).join('')}</table></div>`;
}
window.viewTeacher = async (id) => {
  const t = await api('/api/teachers/' + id);
  openModal(`<h3>${esc(t.name)} — ${esc(t.designation)}</h3>
  <p>${esc(t.qualification)} | Salary Rs ${t.salary} | Phone ${esc(t.phone)} | Staff attendance ${t.attPct}%</p>
  <h4>Subject-wise student progress (from real Mid Term results)</h4>
  ${t.progress.map(p=>`<div class="progress-row"><span>Class ${esc(p.class_name)} ${esc(p.subject)}</span><div class="bar"><i style="width:${p.avg}%"></i></div><b>${p.avg}%</b></div><p style="font-size:13px;color:#64748b">Top: ${p.top.map(x=>esc(x.name)+' '+x.pct.toFixed(0)+'%').join(', ') || '-'}</p>`).join('')}
  <h4>Weekly timetable</h4><table><tr><th>Day</th><th>Period</th><th>Class</th><th>Subject</th><th>Time</th></tr>${t.timetable.map(x=>`<tr><td>${x.day}</td><td>${x.period}</td><td>${esc(x.class_name)}</td><td>${esc(x.subject)}</td><td>${x.start_time}-${x.end_time}</td></tr>`).join('')}</table>
  <button class="secondary" onclick="closeModal()" style="margin-top:10px">Close</button>`);
};

// ---- Timetable ----
async function loadTimetable() {
  const cls = stuFilter.class || '1';
  const rows = await api('/api/timetable?class=' + cls);
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  $('#view').innerHTML = `<div class="card"><h3>Timetable — Class ${cls}</h3>
  <select id="tClass" style="max-width:160px">${CLASSES.map(c=>`<option ${c===cls?'selected':''}>${c}</option>`).join('')}</select>
  <button id="regen" class="secondary">Regenerate from teacher assignments</button>
  <table><tr><th>Day</th><th>P1 08:00</th><th>P2 08:45</th><th>P3 09:30</th><th>Break</th><th>P4 10:45</th><th>P5 11:30</th><th>P6 12:15</th></tr>
  ${days.map(d=>`<tr><td><b>${d}</b></td>${[1,2,3].map(p=>{const r=rows.find(x=>x.day===d&&x.period===p);return `<td>${r?esc(r.subject)+'<br><small>'+esc(r.teacher_name||'')+'</small>':''}</td>`}).join('')}<td>Break 10:15-10:45</td>${[4,5,6].map(p=>{const r=rows.find(x=>x.day===d&&x.period===p);return `<td>${r?esc(r.subject)+'<br><small>'+esc(r.teacher_name||'')+'</small>':''}</td>`}).join('')}</tr>`).join('')}</table></div>`;
  $('#tClass').onchange = e => { stuFilter.class = e.target.value; loadTimetable(); };
  $('#regen').onclick = async () => { await api('/api/timetable/regenerate', { method: 'POST' }); loadTimetable(); };
}

// ---- Leaving / Promoted ----
async function loadLeaving() {
  const [left, promos] = await Promise.all([api('/api/leaving'), api('/api/promotions')]);
  $('#view').innerHTML = `<div class="grid2">
  <div class="card"><h3>Left School (${left.length})</h3><table><tr><th>Student</th><th>Last Class</th><th>Date</th><th>Reason</th><th>SLC</th></tr>${left.map(l=>`<tr><td>${esc(l.name)}</td><td>${esc(l.last_class)}</td><td>${esc(l.leaving_date)}</td><td>${esc(l.reason)}</td><td>${esc(l.slc_number)}</td></tr>`).join('')}</table></div>
  <div class="card"><h3>Promotions (${promos.length})</h3><table><tr><th>Student</th><th>From → To</th><th>Exam</th><th>%</th></tr>${promos.slice(0,80).map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.from_class)} → ${esc(p.to_class)}</td><td>${esc(p.exam)}</td><td>${p.percentage}%</td></tr>`).join('')}</table><p>Showing 80 of ${promos.length}.</p></div></div>`;
}
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }
window.closeModal = closeModal;
$('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };
checkLogin();
