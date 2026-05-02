import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Users, GraduationCap, Receipt, FileText, Settings, Database,
  ArrowLeft, Lock, Download, CloudUpload, RotateCcw, AlertTriangle,
  Save, Trash2, Printer, Send, Plus, ChevronDown, Eye
} from 'lucide-react';

const API = '';
const YEARS = [2025, 2026, 2027, 2028, 2029, 2030];

function tok() { return sessionStorage.getItem('token') || ''; }

async function api(url, opts = {}) {
  const res = await fetch(API + '/api' + url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + tok(),
      ...(opts.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function withYear(url, year) {
  return url + (url.includes('?') ? '&' : '?') + 'year=' + year;
}

function roleName(r) {
  if (r === 'masteradmin') return 'Master-admin';
  if (r === 'admin') return 'Admin';
  return 'Co-admin';
}

function canFee(user) {
  return ['masteradmin', 'admin'].includes(user?.role);
}

function canUsers(user) {
  return ['masteradmin', 'admin'].includes(user?.role);
}

function age(dob) {
  if (!dob) return '';
  const d = new Date(dob);
  if (isNaN(d)) return '';
  let years = new Date().getFullYear() - d.getFullYear();
  const m = new Date().getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && new Date().getDate() < d.getDate())) years--;
  return years;
}

async function photoFile(e, setForm, form) {
  const f = e.target.files?.[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => setForm({ ...form, photo_url: reader.result });
  reader.readAsDataURL(f);
}

function Login({ setUser, onBack }) {
  const [email, setE] = useState('afong@gmail.com');
  const [password, setP] = useState('123456');
  const [err, setErr] = useState('');
  async function sub() {
    try {
      const d = await api('/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      sessionStorage.setItem('token', d.token);
      setUser(d.user);
    } catch (e) {
      setErr(e.message);
    }
  }
  return (
    <div className="loginPage">
      <div className="loginCard">
        <h1><Lock size={22} /> School Admin Login</h1>
        {err && <div className="alert error">{err}</div>}
        <div className="grid" style={{ gap: '10px' }}>
          <input value={email} onChange={e => setE(e.target.value)} placeholder="Email" />
          <input value={password} onChange={e => setP(e.target.value)} placeholder="Password" type="password" />
          <button onClick={sub}><Lock size={16} /> Login</button>
          <button className="secondary" onClick={onBack}><ArrowLeft size={16} /> Back to Website</button>
        </div>
        <p className="muted">Login is valid for current browser session only.</p>
      </div>
    </div>
  );
}

function YearSelect({ setYear, user, setUser }) {
  return (
    <div className="loginPage">
      <div className="loginCard">
        <h1>Select School Year</h1>
        <p className="muted">Choose the working year. Students, admissions, fees and reports load separately for that year.</p>
        <div className="yearGrid">
          {YEARS.map(y => (
            <button key={y} onClick={() => { sessionStorage.setItem('selectedYear', y); setYear(y); }}>{y}</button>
          ))}
        </div>
        <div className="topInfo">
          <span>Logged in as {user.email} ({roleName(user.role)})</span>
          <button className="secondary small" onClick={() => { sessionStorage.clear(); setUser(null); }}>Logout</button>
        </div>
      </div>
    </div>
  );
}

function Students({ year }) {
  const [rows, setRows] = useState([]), [classes, setClasses] = useState([]);
  const [form, setForm] = useState({ sex: 'Male', class_name: 'Nursery', status: 'active' });
  const [msg, setMsg] = useState('');
  const load = async () => { setRows(await api(withYear('/students', year))); setClasses(await api('/classes')); };
  useEffect(() => { load().catch(e => setMsg(e.message)); }, [year]);
  async function save() {
    await api(withYear(form.id ? '/students/' + form.id : '/students', year), { method: form.id ? 'PUT' : 'POST', body: JSON.stringify({ ...form, academic_year: year }) });
    setForm({ sex: 'Male', class_name: 'Nursery', status: 'active' });
    setMsg('Student saved successfully');
    load();
  }
  return (
    <div>
      <h2>Student Database - {year}</h2>
      {msg && <div className="alert">{msg}</div>}
      <div className="card">
        <div className="grid formGrid">
          <input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Name" />
          <select value={form.sex || 'Male'} onChange={e => setForm({ ...form, sex: e.target.value })}>
            <option>Male</option><option>Female</option><option>Other</option>
          </select>
          <select value={form.class_name || 'Nursery'} onChange={e => setForm({ ...form, class_name: e.target.value })}>
            {classes.map(c => <option key={c.id}>{c.name}</option>)}
          </select>
          <input value={form.guardian_name || ''} onChange={e => setForm({ ...form, guardian_name: e.target.value })} placeholder="Guardian Name" />
          <input value={form.address || ''} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Address" />
          <input type="date" value={form.dob || ''} onChange={e => setForm({ ...form, dob: e.target.value })} placeholder="DOB" />
          <input value={form.contact_no || ''} onChange={e => setForm({ ...form, contact_no: e.target.value })} placeholder="Contact No" />
          <select value={form.status || 'active'} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option value="active">Active</option><option value="inactive">Inactive</option>
          </select>
          <label className="uploadBtn">
            <Plus size={16} /> Photo
            <input type="file" accept="image/*" onChange={e => photoFile(e, setForm, form)} />
          </label>
        </div>
        {form.photo_url && <img className="thumb" src={form.photo_url} alt="" />}
        <div className="toolbar">
          <button onClick={save}><Save size={16} /> {form.id ? 'Update' : 'Add'} Student</button>
          {form.id && <button className="secondary" onClick={() => setForm({ sex: 'Male', class_name: 'Nursery', status: 'active' })}>Cancel</button>}
        </div>
      </div>
      <table>
        <thead>
          <tr><th>Photo</th><th>Name</th><th>Sex</th><th>Class</th><th>Guardian</th><th>DOB</th><th>Age</th><th>Contact</th><th>Action</th></tr>
        </thead>
        <tbody>
          {rows.map(s => (
            <tr key={s.id}>
              <td>{s.photo_url && <img onClick={() => window.open(s.photo_url)} className="thumb" src={s.photo_url} alt="" />}</td>
              <td>{s.name}</td><td>{s.sex}</td><td>{s.class_name}</td><td>{s.guardian_name}</td>
              <td>{String(s.dob || '').slice(0, 10)}</td><td>{s.age ?? age(s.dob)}</td><td>{s.contact_no}</td>
              <td>
                <button className="small" onClick={() => setForm(s)}><Save size={14} /></button>
                <button className="danger small" onClick={async () => { if (confirm('Delete?')) { await api('/students/' + s.id, { method: 'DELETE' }); load(); } }}><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Admissions({ year }) {
  const [rows, setRows] = useState([]), [classes, setClasses] = useState([]);
  const [form, setForm] = useState({ sex: 'Male', class_name: 'Nursery', payment_mode: 'Cash' });
  const [msg, setMsg] = useState('');
  const load = async () => { setRows(await api(withYear('/admissions', year))); setClasses(await api('/classes')); };
  useEffect(() => { load().catch(e => setMsg(e.message)); }, [year]);
  async function save() {
    await api(withYear('/admissions', year), { method: 'POST', body: JSON.stringify({ ...form, academic_year: year }) });
    setForm({ sex: 'Male', class_name: 'Nursery', payment_mode: 'Cash' });
    setMsg('Admission saved and automatically added to Student Database');
    load();
  }
  return (
    <div>
      <h2>Admission Form - {year}</h2>
      {msg && <div className="alert">{msg}</div>}
      <div className="card">
        <div className="grid formGrid">
          <input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Student Name" />
          <select value={form.sex || 'Male'} onChange={e => setForm({ ...form, sex: e.target.value })}>
            <option>Male</option><option>Female</option><option>Other</option>
          </select>
          <select value={form.class_name || 'Nursery'} onChange={e => setForm({ ...form, class_name: e.target.value })}>
            {classes.map(c => <option key={c.id}>{c.name}</option>)}
          </select>
          <input value={form.guardian_name || ''} onChange={e => setForm({ ...form, guardian_name: e.target.value })} placeholder="Guardian Name" />
          <input value={form.address || ''} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Address" />
          <input type="date" value={form.dob || ''} onChange={e => setForm({ ...form, dob: e.target.value })} placeholder="DOB" />
          <input value={form.contact_no || ''} onChange={e => setForm({ ...form, contact_no: e.target.value })} placeholder="Contact No" />
          <label className="uploadBtn">
            <Plus size={16} /> Photo
            <input type="file" accept="image/*" onChange={e => photoFile(e, setForm, form)} />
          </label>
        </div>
        {form.photo_url && <img className="thumb" src={form.photo_url} alt="" />}
        <button onClick={save}><Save size={16} /> Save Admission</button>
      </div>
      <table>
        <thead>
          <tr><th>Name</th><th>Class</th><th>Guardian</th><th>DOB</th><th>Age</th><th>Contact</th></tr>
        </thead>
        <tbody>
          {rows.map(a => (
            <tr key={a.id}>
              <td>{a.name}</td><td>{a.class_name}</td><td>{a.guardian_name}</td>
              <td>{String(a.dob || '').slice(0, 10)}</td><td>{a.age ?? age(a.dob)}</td><td>{a.contact_no}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function printReceipt(type, r) {
  const total = Number(r.base_fee || 0) + Number(r.misc_fee || 0), paid = Number(r.paid_amount || 0), bal = total - paid;
  const dt = type === 'Monthly Fee Receipt' ? (r.fee_month || '') : new Date().toLocaleDateString();
  const copy = label => `
    <div style="padding:20px;border:1px solid #ccc;margin-bottom:20px;">
      <h2 style="text-align:center;margin:0 0 6px;">Bright Future Primary School</h2>
      <h3 style="text-align:center;margin:0 0 14px;">${type} - ${label}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:6px;border:1px solid #ddd;"><b>Name</b></td><td style="padding:6px;border:1px solid #ddd;">${r.name || ''}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ddd;"><b>Class</b></td><td style="padding:6px;border:1px solid #ddd;">${r.class_name || ''}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ddd;"><b>Guardian/Father</b></td><td style="padding:6px;border:1px solid #ddd;">${r.guardian_name || ''}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ddd;"><b>Contact</b></td><td style="padding:6px;border:1px solid #ddd;">${r.contact_no || ''}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ddd;"><b>DOB / Age</b></td><td style="padding:6px;border:1px solid #ddd;">${String(r.dob || '').slice(0, 10)} / ${r.age ?? age(r.dob)}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ddd;"><b>Date/Month</b></td><td style="padding:6px;border:1px solid #ddd;">${dt}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ddd;"><b>Payment Mode</b></td><td style="padding:6px;border:1px solid #ddd;">${r.payment_mode || 'Cash'} ${r.transaction_id ? (' / ' + r.transaction_id) : ''}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ddd;"><b>Base Fee</b></td><td style="padding:6px;border:1px solid #ddd;">₹${Number(r.base_fee || 0).toFixed(2)}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ddd;"><b>Misc Fee</b></td><td style="padding:6px;border:1px solid #ddd;">₹${Number(r.misc_fee || 0).toFixed(2)}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ddd;"><b>Note</b></td><td style="padding:6px;border:1px solid #ddd;">${r.misc_note || ''}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ddd;"><b>Total</b></td><td style="padding:6px;border:1px solid #ddd;">₹${total.toFixed(2)}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ddd;"><b>Paid</b></td><td style="padding:6px;border:1px solid #ddd;">₹${paid.toFixed(2)}</td></tr>
        <tr><td style="padding:6px;border:1px solid #ddd;"><b>Balance</b></td><td style="padding:6px;border:1px solid #ddd;">₹${bal.toFixed(2)}</td></tr>
      </table>
      <p style="margin-top:14px;">Authorized Signature ____________________</p>
    </div>
  `;
  const w = window.open('', '_blank');
  w.document.write(`<html><head><title>${type}</title></head><body>${copy('Student Copy')}<hr/>${copy('Office Copy')}</body></html>`);
  w.document.close();
}

function MonthlyFees({ year }) {
  const [month, setMonth] = useState(`${year}-01`), [rows, setRows] = useState([]), [msg, setMsg] = useState('');
  const load = () => api(withYear('/monthly-fees?month=' + month, year)).then(setRows).catch(e => setMsg(e.message));
  useEffect(() => { setMonth(`${year}-01`); }, [year]);
  useEffect(() => { load(); }, [month, year]);
  async function gen() { await api(withYear('/monthly-fees/generate', year), { method: 'POST', body: JSON.stringify({ month, academic_year: year }) }); setMsg('Monthly fees generated'); load(); }
  async function upd(r, k, v) { const n = { ...r, [k]: v }; await api('/monthly-fees/' + r.id, { method: 'PUT', body: JSON.stringify(n) }); load(); }
  async function sms(r) { try { await api('/sms/fees-due', { method: 'POST', body: JSON.stringify({ contact_no: r.contact_no, message: `Fee due for ${r.name}. Month: ${month}. Please pay soon.` }) }); alert('SMS sent'); } catch (e) { alert(e.message); } }
  return (
    <div>
      <h2>Monthly Fee - {year}</h2>
      {msg && <div className="alert">{msg}</div>}
      <div className="toolbar">
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
        <button onClick={gen}><Plus size={16} /> Generate for {month}</button>
      </div>
      <table>
        <thead>
          <tr><th>Student</th><th>Class</th><th>Base</th><th>Misc</th><th>Note</th><th>Paid</th><th>Mode</th><th>Txn ID</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>{r.name}</td><td>{r.class_name}</td>
              <td>{r.base_fee}</td>
              <td><input value={r.misc_fee || 0} onChange={e => upd(r, 'misc_fee', e.target.value)} style={{ width: 80 }} /></td>
              <td><input value={r.misc_note || ''} onChange={e => upd(r, 'misc_note', e.target.value)} style={{ width: 100 }} /></td>
              <td><input value={r.paid_amount || 0} onChange={e => upd(r, 'paid_amount', e.target.value)} style={{ width: 80 }} /></td>
              <td>
                <select value={r.payment_mode || 'Cash'} onChange={e => upd(r, 'payment_mode', e.target.value)}>
                  <option>Cash</option><option>UPI</option><option>Card</option><option>Bank</option>
                </select>
              </td>
              <td><input value={r.transaction_id || ''} onChange={e => upd(r, 'transaction_id', e.target.value)} style={{ width: 100 }} /></td>
              <td>
                <button className="small" onClick={() => printReceipt('Monthly Fee Receipt', r)}><Printer size={14} /></button>
                <button className="small secondary" onClick={() => sms(r)}><Send size={14} /></button>
                <button className="danger small" onClick={async () => { if (confirm('Delete?')) { await api('/monthly-fees/' + r.id, { method: 'DELETE' }); load(); } }}><Trash2 size={14} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdmissionFees({ year }) {
  const [adms, setAdms] = useState([]), [rows, setRows] = useState([]), [pay, setPay] = useState({ base_fee: 0, misc_fee: 0, paid_amount: 0, misc_note: '', payment_mode: 'Cash' }), [msg, setMsg] = useState('');
  const load = async () => { setAdms(await api(withYear('/admissions', year))); setRows(await api(withYear('/admission-fees', year))); };
  useEffect(() => { load().catch(e => setMsg(e.message)); }, [year]);
  function sel(v) { const a = adms.find(x => String(x.id) === String(v)); setPay(a ? { admission_id: a.id, student_id: a.student_id, base_fee: a.admission_fee || 0, misc_fee: 0, paid_amount: 0, misc_note: '', payment_mode: 'Cash', transaction_id: '', ...a } : { base_fee: 0, misc_fee: 0, paid_amount: 0, misc_note: '', payment_mode: 'Cash' }); }
  async function save() { if (!pay.admission_id) return alert('Select admission first'); await api(withYear('/admission-fees', year), { method: 'POST', body: JSON.stringify({ ...pay, academic_year: year }) }); setMsg('Admission fee saved successfully'); load(); }
  return (
    <div>
      <h2>Admission Fees - {year}</h2>
      {msg && <div className="alert">{msg}</div>}
      <div className="card">
        <div className="grid formGrid">
          <select value={pay.admission_id || ''} onChange={e => sel(e.target.value)}>
            <option value="">-- Select Admission --</option>
            {adms.map(a => <option key={a.id} value={a.id}>{a.name} ({a.class_name})</option>)}
          </select>
          <input value={pay.base_fee || 0} onChange={e => setPay({ ...pay, base_fee: e.target.value })} placeholder="Base Fee" />
          <input value={pay.misc_fee || 0} onChange={e => setPay({ ...pay, misc_fee: e.target.value })} placeholder="Misc Fee" />
          <input value={pay.misc_note || ''} onChange={e => setPay({ ...pay, misc_note: e.target.value })} placeholder="Misc Note" />
          <input value={pay.paid_amount || 0} onChange={e => setPay({ ...pay, paid_amount: e.target.value })} placeholder="Paid Amount" />
          <select value={pay.payment_mode || 'Cash'} onChange={e => setPay({ ...pay, payment_mode: e.target.value })}>
            <option>Cash</option><option>UPI</option><option>Card</option><option>Bank</option>
          </select>
          <input value={pay.transaction_id || ''} onChange={e => setPay({ ...pay, transaction_id: e.target.value })} placeholder="Transaction ID" />
        </div>
        <button onClick={save}><Save size={16} /> Save Admission Fee</button>
      </div>
      <table>
        <thead>
          <tr><th>Name</th><th>Class</th><th>Base</th><th>Misc</th><th>Paid</th><th>Mode</th><th>Print</th><th>Delete</th></tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>{r.name}</td><td>{r.class_name}</td><td>{r.base_fee}</td><td>{r.misc_fee}</td><td>{r.paid_amount}</td><td>{r.payment_mode}</td>
              <td><button className="small" onClick={() => printReceipt('Admission Fee Receipt', r)}><Printer size={14} /></button></td>
              <td><button className="danger small" onClick={async () => { if (confirm('Delete?')) { await api('/admission-fees/' + r.id, { method: 'DELETE' }); load(); } }}><Trash2 size={14} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportCards({ year }) {
  const [students, setStudents] = useState([]), [rows, setRows] = useState([]);
  const [form, setForm] = useState({ exam_name: 'Annual Exam', subjects: [{ name: 'English', marks: 0, total: 100 }, { name: 'Math', marks: 0, total: 100 }] });
  const [msg, setMsg] = useState('');
  const load = async () => { setStudents(await api(withYear('/students', year))); setRows(await api(withYear('/report-cards', year))); };
  useEffect(() => { load().catch(e => setMsg(e.message)); }, [year]);
  function setSub(i, k, v) { const s = [...form.subjects]; s[i] = { ...s[i], [k]: v }; setForm({ ...form, subjects: s }); }
  async function save() { const st = students.find(x => String(x.id) === String(form.student_id)); await api(withYear('/report-cards', year), { method: 'POST', body: JSON.stringify({ ...form, academic_year: year, class_name: st?.class_name }) }); setMsg('Report card saved'); load(); }
  function printReport(r) {
    const subs = typeof r.subjects === 'string' ? JSON.parse(r.subjects || '[]') : (r.subjects || []);
    const trs = subs.map(x => `<tr><td style="padding:6px;border:1px solid #ddd;">${x.name}</td><td style="padding:6px;border:1px solid #ddd;">${x.marks}</td><td style="padding:6px;border:1px solid #ddd;">${x.total}</td></tr>`).join('');
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>Report Card</title></head><body>
      <h2 style="text-align:center;">Bright Future Primary School</h2>
      <h2 style="text-align:center;">Report Card - ${year}</h2>
      <p><b>Name:</b> ${r.name} | <b>Class:</b> ${r.class_name}</p>
      <p><b>Guardian:</b> ${r.guardian_name || ''} | <b>Exam:</b> ${r.exam_name}</p>
      <table style="width:100%;border-collapse:collapse;"><thead><tr><th style="padding:6px;border:1px solid #ddd;">Subject</th><th style="padding:6px;border:1px solid #ddd;">Marks</th><th style="padding:6px;border:1px solid #ddd;">Total</th></tr></thead><tbody>${trs}</tbody></table>
      <h3 style="text-align:center;">Total: ${r.obtained_marks}/${r.total_marks} | ${Number(r.percentage).toFixed(2)}% | Grade: ${r.grade}</h3>
      <p>Remarks: ${r.remarks || ''}</p>
      <p>Class Teacher __________ Principal __________</p>
    </body></html>`);
    w.document.close();
  }
  return (
    <div>
      <h2>Report Cards PDF - {year}</h2>
      {msg && <div className="alert">{msg}</div>}
      <div className="card">
        <div className="grid formGrid">
          <select value={form.student_id || ''} onChange={e => setForm({ ...form, student_id: e.target.value })}>
            <option value="">-- Select Student --</option>
            {students.map(s => <option key={s.id} value={s.id}>{s.name} ({s.class_name})</option>)}
          </select>
          <input value={form.exam_name || ''} onChange={e => setForm({ ...form, exam_name: e.target.value })} placeholder="Exam Name" />
          <input value={form.remarks || ''} onChange={e => setForm({ ...form, remarks: e.target.value })} placeholder="Remarks" />
        </div>
        <h4>Subjects</h4>
        {form.subjects.map((s, i) => (
          <div className="grid formGrid" key={i}>
            <input value={s.name} onChange={e => setSub(i, 'name', e.target.value)} placeholder="Subject" />
            <input value={s.marks} onChange={e => setSub(i, 'marks', e.target.value)} placeholder="Marks" />
            <input value={s.total} onChange={e => setSub(i, 'total', e.target.value)} placeholder="Total" />
          </div>
        ))}
        <button onClick={() => setForm({ ...form, subjects: [...form.subjects, { name: '', marks: 0, total: 100 }] })}><Plus size={16} /> Add Subject</button>
        <button onClick={save}><Save size={16} /> Save Report Card</button>
      </div>
      <table>
        <thead>
          <tr><th>Student</th><th>Class</th><th>Exam</th><th>%</th><th>Grade</th><th>Print</th><th>Delete</th></tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>{r.name}</td><td>{r.class_name}</td><td>{r.exam_name}</td>
              <td>{Number(r.percentage).toFixed(2)}</td><td>{r.grade}</td>
              <td><button className="small" onClick={() => printReport(r)}><Printer size={14} /></button></td>
              <td><button className="danger small" onClick={async () => { if (confirm('Delete?')) { await api('/report-cards/' + r.id, { method: 'DELETE' }); load(); } }}><Trash2 size={14} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChangePassword({ user }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function submit() {
    setMsg('');
    setErr('');
    try {
      const res = await api('/change-password', {
        method: 'POST',
        body: JSON.stringify(form)
      });
      setMsg(res.message || 'Password changed successfully');
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 600 }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0 }}>
        <Lock size={20} /> Change Password
      </h3>
      {msg && <div className="alert">{msg}</div>}
      {err && <div className="alert error">{err}</div>}
      <div className="grid" style={{ gap: '14px' }}>
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 6 }}>Email</label>
          <input value={user?.email || ''} disabled style={{ background: '#f1f5f9' }} />
        </div>
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 6 }}>Current Password</label>
          <div style={{ position: 'relative' }}>
            <input
              type="password"
              value={form.currentPassword}
              onChange={e => setForm({ ...form, currentPassword: e.target.value })}
              placeholder="Enter current password"
              style={{ paddingRight: 40 }}
            />
            <Lock size={16} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          </div>
        </div>
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 6 }}>New Password</label>
          <div style={{ position: 'relative' }}>
            <input
              type="password"
              value={form.newPassword}
              onChange={e => setForm({ ...form, newPassword: e.target.value })}
              placeholder="Enter new password"
              style={{ paddingRight: 40 }}
            />
            <Lock size={16} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          </div>
        </div>
        <div>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 6 }}>Confirm New Password</label>
          <div style={{ position: 'relative' }}>
            <input
              type="password"
              value={form.confirmPassword}
              onChange={e => setForm({ ...form, confirmPassword: e.target.value })}
              placeholder="Confirm new password"
              style={{ paddingRight: 40 }}
            />
            <Lock size={16} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
          </div>
        </div>
        <button onClick={submit} style={{ background: '#2563eb', marginTop: 4 }}>
          <Lock size={16} /> Change Password
        </button>
      </div>
    </div>
  );
}

function SettingsPage({ user }) {
  const [fees, setFees] = useState([]), [classes, setClasses] = useState([]), [users, setUsers] = useState([]);
  const [newClass, setNewClass] = useState(''), [newUser, setNewUser] = useState({ role: 'coadmin' }), [msg, setMsg] = useState('');
  const load = () => {
    api('/fee-structures').then(setFees).catch(e => setMsg(e.message));
    api('/classes').then(setClasses).catch(e => setMsg(e.message));
    if (canUsers(user)) api('/users').then(setUsers).catch(e => setMsg(e.message));
  };
  useEffect(load, []);
  async function saveFee(f) { await api('/fee-structures/' + encodeURIComponent(f.class_name), { method: 'PUT', body: JSON.stringify(f) }); setMsg('Fee structure saved'); load(); }
  return (
    <div>
      <h2>Settings & Roles</h2>
      {msg && <div className="alert">{msg}</div>}

      <ChangePassword user={user} />

      <div className="card">
        <p className="muted">Current role: {roleName(user.role)}. Co-admin has all power except fee structure and user role changes.</p>
        <h3>Class List</h3>
        <div className="toolbar">
          <input value={newClass} onChange={e => setNewClass(e.target.value)} placeholder="New class name" />
          <button onClick={async () => { if (!newClass) return; await api('/classes', { method: 'POST', body: JSON.stringify({ name: newClass }) }); setNewClass(''); setMsg('Class added'); load(); }}><Plus size={16} /> Add Class</button>
        </div>
        <div className="chips">
          {classes.map(c => <span key={c.id}>{c.name}</span>)}
        </div>

        <h3>Fee Structure</h3>
        {!canFee(user) && <div className="alert error">Co-admin cannot change fee structure.</div>}
        <table>
          <thead><tr><th>Class</th><th>Monthly Fee</th><th>Admission Fee</th><th>Save</th></tr></thead>
          <tbody>
            {fees.map(f => (
              <tr key={f.class_name}>
                <td>{f.class_name}</td>
                <td><input value={f.monthly_fee} onChange={e => { const n = [...fees]; const i = n.findIndex(x => x.class_name === f.class_name); n[i] = { ...n[i], monthly_fee: e.target.value }; setFees(n); }} /></td>
                <td><input value={f.admission_fee} onChange={e => { const n = [...fees]; const i = n.findIndex(x => x.class_name === f.class_name); n[i] = { ...n[i], admission_fee: e.target.value }; setFees(n); }} /></td>
                <td><button className="small" onClick={() => saveFee(fees.find(x => x.class_name === f.class_name))}><Save size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>

        {canUsers(user) && <>
          <h3 style={{ marginTop: 24 }}>Master-admin / Admin / Co-admin</h3>
          <div className="toolbar">
            <input value={newUser.email || ''} onChange={e => setNewUser({ ...newUser, email: e.target.value })} placeholder="Email" />
            <input value={newUser.password || ''} onChange={e => setNewUser({ ...newUser, password: e.target.value })} placeholder="Password" type="password" />
            <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
              <option value="coadmin">Co-admin</option>
              <option value="admin">Admin</option>
              {user.role === 'masteradmin' && <option value="masteradmin">Master-admin</option>}
            </select>
            <button onClick={async () => { await api('/users', { method: 'POST', body: JSON.stringify(newUser) }); setNewUser({ role: 'coadmin' }); setMsg('User saved'); load(); }}><Save size={16} /> Save User</button>
          </div>
          <table>
            <thead><tr><th>Email</th><th>Role</th><th>Action</th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>{u.email}</td><td>{roleName(u.role)}</td>
                  <td>{u.role !== 'masteradmin' && <button className="danger small" onClick={async () => { if (confirm('Delete user?')) { await api('/users/' + u.id, { method: 'DELETE' }); load(); } }}><Trash2 size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>}
      </div>
    </div>
  );
}

function Backup({ year }) {
  const [status, setStatus] = useState({});
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [files, setFiles] = useState([]);
  const [history, setHistory] = useState([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api('/backup/status').then(setStatus).catch(e => setMsg(e.message));
    loadFiles();
    loadHistory();
  }, []);

  async function loadFiles() {
    try { const f = await api('/backup/files'); setFiles(f); } catch (e) { console.log(e); }
  }

  async function loadHistory() {
    try { const h = await api('/backup/history'); setHistory(h); } catch (e) { console.log(e); }
  }

  async function createLocal() {
    setLoading(true);
    setMsg(''); setErr('');
    try {
      const r = await api('/backup/local', { method: 'POST', body: JSON.stringify({ year }) });
      setMsg('Local backup created: ' + r.filename);
      loadFiles();
      loadHistory();
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  }

  async function download(selected = year) {
    const data = await api('/backup/download?year=' + selected);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `school-backup-${selected}-encrypted.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function gd() {
    setLoading(true);
    setMsg(''); setErr('');
    try {
      const r = await api('/backup/google-drive', { method: 'POST', body: JSON.stringify({ year }) });
      setMsg('Uploaded encrypted backup to Google Drive: ' + r.fileId);
      loadHistory();
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  }

  async function restoreLocal() {
    if (!selectedFile) return alert('Please select a backup file');
    if (!confirm('Restoring will overwrite all current data. This action cannot be undone. Continue?')) return;
    setLoading(true);
    setMsg(''); setErr('');
    try {
      await api('/backup/restore', { method: 'POST', body: JSON.stringify({ filename: selectedFile }) });
      setMsg('Database restored successfully from ' + selectedFile);
      loadHistory();
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  }

  async function restoreUpload(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!confirm('Restoring will overwrite all current data. This action cannot be undone. Continue?')) return;
    setLoading(true);
    setMsg(''); setErr('');
    try {
      const text = await f.text();
      const payload = JSON.parse(text);
      const r = await api('/backup/upload', { method: 'POST', body: JSON.stringify(payload) });
      setMsg(r.ok ? 'Encrypted backup uploaded/restored successfully.' : 'Restore completed.');
      loadHistory();
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  }

  return (
    <div>
      <h2>Backup & Restore</h2>
      {msg && <div className="alert">{msg}</div>}
      {err && <div className="alert error">{err}</div>}

      <div className="backup-grid">
        {/* Local Backup Card */}
        <div className="backup-card">
          <div className="backup-card-header">
            <Database size={18} />
            <span style={{ fontWeight: 700 }}>Local Backup</span>
          </div>
          <div className="backup-card-body">
            <p className="muted" style={{ margin: '0 0 16px' }}>
              Create a backup file stored locally on the server. Auto-backup runs daily at 2 AM.
            </p>
            <button
              onClick={createLocal}
              disabled={loading}
              style={{ background: '#10b981', width: '100%', justifyContent: 'center' }}
            >
              <Download size={18} /> Create Local Backup Now
            </button>

            <div style={{ marginTop: 20 }}>
              <h4 style={{ margin: '0 0 10px', fontSize: 14, color: '#334155' }}>Local Backup Files</h4>
              {files.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>No local backups found.</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 160, overflow: 'auto' }}>
                  {files.map(f => (
                    <li key={f.name} style={{ padding: '6px 0', borderBottom: '1px solid #e2e8f0', fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#475569' }}>{f.name}</span>
                      <span className="muted">{new Date(f.created_at).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Google Drive Backup Card */}
        <div className="backup-card">
          <div className="backup-card-header">
            <CloudUpload size={18} />
            <span style={{ fontWeight: 700 }}>Google Drive Backup</span>
          </div>
          <div className="backup-card-body">
            <p className="muted" style={{ margin: '0 0 16px' }}>
              Backup to Google Drive for off-site storage. Configure credentials in environment variables.
            </p>
            <button
              onClick={gd}
              disabled={loading}
              style={{ background: '#2563eb', width: '100%', justifyContent: 'center' }}
            >
              <CloudUpload size={18} /> Backup to Google Drive
            </button>
            <div style={{ marginTop: 16, fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
              <b>Setup:</b> Set GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_DRIVE_FOLDER_ID in your .env file.
            </div>
          </div>
        </div>
      </div>

      {/* Restore Database Section */}
      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0 }}>
          <RotateCcw size={20} /> Restore Database
        </h3>
        <div className="restore-warning">
          <AlertTriangle size={18} style={{ flexShrink: 0 }} />
          <span><b>Warning:</b> Restoring will overwrite all current data. This action cannot be undone.</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 16 }}>
          <select value={selectedFile} onChange={e => setSelectedFile(e.target.value)} style={{ maxWidth: 400 }}>
            <option value="">-- Select a backup file --</option>
            {files.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
          </select>
          <button
            onClick={restoreLocal}
            disabled={loading || !selectedFile}
            style={{ background: '#ef4444' }}
          >
            <RotateCcw size={16} /> Restore
          </button>
        </div>
        <div style={{ marginTop: 16 }}>
          <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>Or upload an encrypted backup file from your computer:</p>
          <label className="uploadBtn" style={{ background: '#64748b' }}>
            <Download size={16} /> Upload & Restore Backup
            <input type="file" accept=".json" onChange={restoreUpload} />
          </label>
        </div>
      </div>

      {/* Backup History */}
      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ marginTop: 0 }}>Backup History</h3>
        <table>
          <thead>
            <tr><th>DATE</th><th>TYPE</th><th>STATUS</th><th>MESSAGE</th></tr>
          </thead>
          <tbody>
            {history.length === 0 ? (
              <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>No backup history yet.</td></tr>
            ) : (
              history.map(h => (
                <tr key={h.id}>
                  <td>{new Date(h.created_at).toLocaleString()}</td>
                  <td><span className={`backup-badge backup-badge-${h.type}`}>{h.type}</span></td>
                  <td><span className={`backup-badge backup-badge-${h.status}`}>{h.status}</span></td>
                  <td>{h.message}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminApp({ user, setUser, year, setYear }) {
  const [tab, setTab] = useState(() => sessionStorage.getItem('activeTab') || 'students');
  const items = [
    ['students', 'Students', Users],
    ['admission', 'Admission', GraduationCap],
    ['monthly', 'Monthly Fee', Receipt],
    ['adfee', 'Admission Fee', Receipt],
    ['reports', 'Report Cards', FileText],
    ['settings', 'Settings', Settings],
    ['backup', 'Backup', Database]
  ];
  function open(id) { sessionStorage.setItem('activeTab', id); setTab(id); }
  return (
    <div>
      <header>
        <h1><GraduationCap size={26} /> School Admin</h1>
        <div className="topInfo">
          <span>{user.email}</span>
          <span>{roleName(user.role)}</span>
          <button className="secondary small" onClick={() => { sessionStorage.clear(); setUser(null); setYear(null); }}>Logout</button>
        </div>
      </header>
      <nav>
        {items.map(([id, l, Icon]) => (
          <button key={id} className={tab === id ? 'active' : 'secondary'} onClick={() => open(id)}>
            <Icon size={16} /> {l}
          </button>
        ))}
      </nav>
      <main>
        {tab === 'students' ? <Students year={year} /> :
         tab === 'admission' ? <Admissions year={year} /> :
         tab === 'monthly' ? <MonthlyFees year={year} /> :
         tab === 'adfee' ? <AdmissionFees year={year} /> :
         tab === 'reports' ? <ReportCards year={year} /> :
         tab === 'settings' ? <SettingsPage user={user} /> :
         tab === 'backup' ? <Backup year={year} /> : null}
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null), [screen, setScreen] = useState('home'), [checking, setChecking] = useState(true);
  const [year, setYear] = useState(() => { const y = Number(sessionStorage.getItem('selectedYear')); return YEARS.includes(y) ? y : null; });
  useEffect(() => {
    const t = tok();
    if (!t) { setChecking(false); return; }
    api('/me').then(r => setUser(r.user)).catch(() => sessionStorage.clear()).finally(() => setChecking(false));
  }, []);
  if (checking) return <div className="loginPage"><div className="loginCard">Loading...</div></div>;
  if (user && !year) return <YearSelect setYear={setYear} user={user} setUser={setUser} />;
  if (user && year) return <AdminApp user={user} setUser={setUser} year={year} setYear={setYear} />;
  return screen === 'login' ? <Login setUser={setUser} onBack={() => setScreen('home')} /> : <ChildSchoolHome onLogin={() => setScreen('login')} />;
}

createRoot(document.getElementById('root')).render(<App />);
