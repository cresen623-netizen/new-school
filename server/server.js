import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import crypto from 'crypto';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const BACKUP_SECRET = process.env.BACKUP_SECRET || JWT_SECRET || 'school-backup-secret-change-me';
const YEARS = [2025, 2026, 2027, 2028, 2029, 2030];
const BACKUP_DIR = path.join(__dirname, '../backups');

app.use(cors());
app.use(express.json({ limit: '50mb' }));

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

let pool;

function mysqlUrlWithMultiStatements(url) {
  if (!url) return url;
  return url + (url.includes('?') ? '&' : '?') + 'multipleStatements=true';
}

async function getPool() {
  if (!pool) {
    try {
      if (process.env.MYSQL_URL) {
        console.log('Using MYSQL_URL for database connection.');
        pool = mysql.createPool(mysqlUrlWithMultiStatements(process.env.MYSQL_URL));
      } else {
        const host = process.env.DB_HOST || process.env.MYSQLHOST;
        const user = process.env.DB_USER || process.env.MYSQLUSER;
        const password = process.env.DB_PASSWORD || process.env.MYSQLPASSWORD;
        const database = process.env.DB_NAME || process.env.MYSQLDATABASE;
        const port = Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306);

        if (!host || !user || !database) {
          throw new Error('Database variables missing. Set MYSQL_URL or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME/DB_PORT.');
        }

        console.log('Using individual DB variables for database connection.');
        pool = mysql.createPool({
          host, user, password, database, port,
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
          multipleStatements: true
        });
      }

      const conn = await pool.getConnection();
      conn.release();
      console.log('Database connected successfully.');
    } catch (e) {
      console.error('DATABASE CONNECTION ERROR:', e.message);
      throw e;
    }
  }
  return pool;
}

async function query(sql, params = []) {
  const p = await getPool();
  const [rows] = await p.query(sql, params);
  return rows;
}

async function tryQuery(sql) {
  try { await query(sql); } catch (e) { console.log('Migration notice:', e.message); }
}

function safeJsonRoute(fn) {
  return async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (e) {
      console.error('API ERROR:', req.method, req.originalUrl, e);
      res.status(500).json({ error: e.message || 'Request failed' });
    }
  };
}

function selectedYear(req) {
  const raw = Number(req.query.year || req.body?.academic_year || req.body?.year || 2025);
  return YEARS.includes(raw) ? raw : 2025;
}

async function columnExists(table, column) {
  const rows = await query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [table, column]
  );
  return Number(rows[0]?.c || 0) > 0;
}

async function addColumnIfMissing(table, column, definition) {
  if (!(await columnExists(table, column))) {
    await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function sqlDate(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const raw = String(v).trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  throw new Error('Invalid DOB format. Please select date again.');
}

function tokenFor(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
}

function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : '';
    req.user = jwt.verify(t, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Login required' });
  }
}

function canManageUsers(req, res, next) {
  if (!['masteradmin', 'admin'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Only Master-admin/Admin can manage users' });
  }
  next();
}

function adminFeeOnly(req, res, next) {
  if (!['masteradmin', 'admin'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Co-admin cannot change fee structure' });
  }
  next();
}

function normalizeRole(role, actorRole) {
  if (role === 'masteradmin' && actorRole !== 'masteradmin') return 'coadmin';
  if (role === 'admin' || role === 'masteradmin' || role === 'coadmin') return role;
  return 'coadmin';
}

function backupKey() {
  return crypto.createHash('sha256').update(String(BACKUP_SECRET)).digest();
}

function encryptBackupObject(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', backupKey(), iv);
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { encrypted: true, algorithm: 'aes-256-gcm', version: 1, iv: iv.toString('base64'), tag: tag.toString('base64'), data: encrypted.toString('base64') };
}

function decryptBackupObject(obj) {
  if (!obj?.encrypted) return obj;
  if (obj.algorithm !== 'aes-256-gcm') throw new Error('Unsupported backup encryption algorithm');
  const decipher = crypto.createDecipheriv('aes-256-gcm', backupKey(), Buffer.from(obj.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(obj.tag, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(obj.data, 'base64')), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

async function logBackupHistory(type, status, message) {
  try {
    await query('INSERT INTO backup_history (type, status, message) VALUES (?,?,?)', [type, status, message]);
  } catch (e) { console.log('Backup history log error:', e.message); }
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(190) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(30) NOT NULL DEFAULT 'coadmin',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS classes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(80) UNIQUE NOT NULL,
      sort_order INT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS students (
      id INT AUTO_INCREMENT PRIMARY KEY,
      admission_id INT NULL,
      academic_year INT NOT NULL DEFAULT 2025,
      name VARCHAR(190) NOT NULL,
      sex VARCHAR(20),
      class_name VARCHAR(80),
      guardian_name VARCHAR(190),
      address TEXT,
      dob DATE,
      contact_no VARCHAR(50),
      photo_url LONGTEXT,
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_students_year (academic_year)
    );
    CREATE TABLE IF NOT EXISTS admissions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      student_id INT NULL,
      academic_year INT NOT NULL DEFAULT 2025,
      name VARCHAR(190) NOT NULL,
      sex VARCHAR(20),
      class_name VARCHAR(80),
      guardian_name VARCHAR(190),
      address TEXT,
      dob DATE,
      contact_no VARCHAR(50),
      photo_url LONGTEXT,
      admission_fee DECIMAL(10,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_admissions_year (academic_year)
    );
    CREATE TABLE IF NOT EXISTS fee_structures (
      id INT AUTO_INCREMENT PRIMARY KEY,
      class_name VARCHAR(80) UNIQUE NOT NULL,
      monthly_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
      admission_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS monthly_fee_payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      student_id INT NOT NULL,
      academic_year INT NOT NULL DEFAULT 2025,
      fee_month VARCHAR(7) NOT NULL,
      base_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
      misc_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
      misc_note VARCHAR(255),
      paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      payment_mode VARCHAR(20) NOT NULL DEFAULT 'Cash',
      payment_provider VARCHAR(40) NULL,
      transaction_id VARCHAR(120) NULL,
      paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_student_year_month (student_id, academic_year, fee_month),
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      INDEX idx_monthly_year (academic_year)
    );
    CREATE TABLE IF NOT EXISTS admission_fee_payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      admission_id INT NULL,
      student_id INT NULL,
      academic_year INT NOT NULL DEFAULT 2025,
      base_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
      misc_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
      misc_note VARCHAR(255),
      paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      payment_mode VARCHAR(20) NOT NULL DEFAULT 'Cash',
      payment_provider VARCHAR(40) NULL,
      transaction_id VARCHAR(120) NULL,
      paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_admission_fee_year (academic_year)
    );
    CREATE TABLE IF NOT EXISTS report_cards (
      id INT AUTO_INCREMENT PRIMARY KEY,
      student_id INT NOT NULL,
      academic_year INT NOT NULL DEFAULT 2025,
      exam_name VARCHAR(120) NOT NULL,
      class_name VARCHAR(80),
      subjects JSON NULL,
      total_marks DECIMAL(10,2) DEFAULT 0,
      obtained_marks DECIMAL(10,2) DEFAULT 0,
      percentage DECIMAL(6,2) DEFAULT 0,
      grade VARCHAR(40),
      remarks TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      INDEX idx_reports_year (academic_year)
    );
    CREATE TABLE IF NOT EXISTS backup_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      type VARCHAR(40) NOT NULL,
      status VARCHAR(40) NOT NULL,
      message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await tryQuery("ALTER TABLE users MODIFY COLUMN role VARCHAR(30) NOT NULL DEFAULT 'coadmin'");
  await addColumnIfMissing('students', 'admission_id', 'INT NULL AFTER id');
  await addColumnIfMissing('students', 'academic_year', 'INT NOT NULL DEFAULT 2025 AFTER admission_id');
  await addColumnIfMissing('students', 'class_name', 'VARCHAR(80) NULL AFTER sex');
  await addColumnIfMissing('students', 'guardian_name', 'VARCHAR(190) NULL AFTER class_name');
  await addColumnIfMissing('students', 'address', 'TEXT NULL AFTER guardian_name');
  await addColumnIfMissing('students', 'dob', 'DATE NULL AFTER address');
  await addColumnIfMissing('students', 'contact_no', 'VARCHAR(50) NULL AFTER dob');
  await addColumnIfMissing('students', 'photo_url', 'LONGTEXT NULL AFTER contact_no');
  await addColumnIfMissing('students', 'status', "VARCHAR(20) NOT NULL DEFAULT 'active' AFTER photo_url");
  await addColumnIfMissing('admissions', 'student_id', 'INT NULL AFTER id');
  await addColumnIfMissing('admissions', 'academic_year', 'INT NOT NULL DEFAULT 2025 AFTER student_id');
  await addColumnIfMissing('admissions', 'class_name', 'VARCHAR(80) NULL AFTER sex');
  await addColumnIfMissing('admissions', 'photo_url', 'LONGTEXT NULL AFTER contact_no');
  await addColumnIfMissing('monthly_fee_payments', 'academic_year', 'INT NOT NULL DEFAULT 2025 AFTER student_id');
  await addColumnIfMissing('monthly_fee_payments', 'payment_mode', "VARCHAR(20) NOT NULL DEFAULT 'Cash' AFTER paid_amount");
  await addColumnIfMissing('monthly_fee_payments', 'payment_provider', 'VARCHAR(40) NULL AFTER payment_mode');
  await addColumnIfMissing('monthly_fee_payments', 'transaction_id', 'VARCHAR(120) NULL AFTER payment_provider');
  await addColumnIfMissing('admission_fee_payments', 'academic_year', 'INT NOT NULL DEFAULT 2025 AFTER student_id');
  await addColumnIfMissing('admission_fee_payments', 'payment_mode', "VARCHAR(20) NOT NULL DEFAULT 'Cash' AFTER paid_amount");
  await addColumnIfMissing('admission_fee_payments', 'payment_provider', 'VARCHAR(40) NULL AFTER payment_mode');
  await addColumnIfMissing('admission_fee_payments', 'transaction_id', 'VARCHAR(120) NULL AFTER payment_provider');
  await addColumnIfMissing('report_cards', 'academic_year', 'INT NOT NULL DEFAULT 2025 AFTER student_id');

  await tryQuery("ALTER TABLE students MODIFY COLUMN photo_url LONGTEXT");
  await tryQuery("ALTER TABLE admissions MODIFY COLUMN photo_url LONGTEXT");
  await tryQuery("UPDATE students SET status='active' WHERE status IS NULL OR status=''");
  await tryQuery("UPDATE students SET academic_year=2025 WHERE academic_year IS NULL OR academic_year=0");
  await tryQuery("UPDATE admissions SET academic_year=2025 WHERE academic_year IS NULL OR academic_year=0");
  await tryQuery("UPDATE monthly_fee_payments SET academic_year=2025 WHERE academic_year IS NULL OR academic_year=0");
  await tryQuery("UPDATE admission_fee_payments SET academic_year=2025 WHERE academic_year IS NULL OR academic_year=0");
  await tryQuery("UPDATE report_cards SET academic_year=2025 WHERE academic_year IS NULL OR academic_year=0");

  const classes = ['Nursery', 'KG', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5'];
  for (let i = 0; i < classes.length; i++) {
    await query('INSERT IGNORE INTO classes(name, sort_order) VALUES(?,?)', [classes[i], i + 1]);
    await query('INSERT IGNORE INTO fee_structures(class_name, monthly_fee, admission_fee) VALUES(?,?,?)', [classes[i], 0, 0]);
  }

  const hash = await bcrypt.hash('123456', 10);
  await query(
    "INSERT INTO users(email,password_hash,role) VALUES(?,?,?) ON DUPLICATE KEY UPDATE role=IF(role='coadmin',VALUES(role),role)",
    ['afong@gmail.com', hash, 'masteradmin']
  );
}

async function syncAdmissionsToStudents(year) {
  const missing = await query(`
    SELECT a.* FROM admissions a
    LEFT JOIN students s ON s.id = a.student_id
    WHERE a.academic_year=? AND (a.student_id IS NULL OR s.id IS NULL)
  `, [year]);
  for (const a of missing) {
    const sr = await query(
      "INSERT INTO students(admission_id,academic_year,name,sex,class_name,guardian_name,address,dob,contact_no,photo_url,status) VALUES(?,?,?,?,?,?,?,?,?,?,'active')",
      [a.id, year, a.name, a.sex, a.class_name || 'Nursery', a.guardian_name, a.address, sqlDate(a.dob), a.contact_no, a.photo_url]
    );
    await query('UPDATE admissions SET student_id=? WHERE id=?', [sr.insertId, a.id]);
  }
  await tryQuery('UPDATE students s JOIN admissions a ON a.student_id=s.id SET s.admission_id=a.id WHERE s.admission_id IS NULL');
}

app.post('/api/login', safeJsonRoute(async (req, res) => {
  const { email, password } = req.body;
  const rows = await query('SELECT * FROM users WHERE email=?', [email]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  res.json({ token: tokenFor(user), user: { id: user.id, email: user.email, role: user.role } });
}));

app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));
app.get('/api/years', auth, (req, res) => res.json({ years: YEARS }));

app.post('/api/change-password', auth, safeJsonRoute(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const userId = req.user.id;
  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'New password and confirm password do not match' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }
  const rows = await query('SELECT * FROM users WHERE id=?', [userId]);
  const user = rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const match = await bcrypt.compare(currentPassword, user.password_hash);
  if (!match) return res.status(400).json({ error: 'Current password is incorrect' });
  const hash = await bcrypt.hash(newPassword, 10);
  await query('UPDATE users SET password_hash=? WHERE id=?', [hash, userId]);
  res.json({ ok: true, message: 'Password changed successfully' });
}));

app.get('/api/users', auth, canManageUsers, safeJsonRoute(async (req, res) => {
  res.json(await query('SELECT id,email,role,created_at FROM users ORDER BY FIELD(role,"masteradmin","admin","coadmin"), id DESC'));
}));

app.post('/api/users', auth, canManageUsers, safeJsonRoute(async (req, res) => {
  const { email, password } = req.body;
  const role = normalizeRole(req.body.role, req.user.role);
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (role === 'masteradmin' && req.user.role !== 'masteradmin') {
    return res.status(403).json({ error: 'Only Master-admin can create Master-admin' });
  }
  const hash = await bcrypt.hash(password, 10);
  await query(
    'INSERT INTO users(email,password_hash,role) VALUES(?,?,?) ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), role=VALUES(role)',
    [email, hash, role]
  );
  res.json({ ok: true });
}));

app.delete('/api/users/:id', auth, canManageUsers, safeJsonRoute(async (req, res) => {
  const rows = await query('SELECT * FROM users WHERE id=?', [req.params.id]);
  const u = rows[0];
  if (!u) return res.json({ ok: true });
  if (u.role === 'masteradmin') return res.status(403).json({ error: 'Master-admin cannot be deleted' });
  if (req.user.role !== 'masteradmin' && u.role === 'admin') return res.status(403).json({ error: 'Only Master-admin can delete Admin' });
  await query('DELETE FROM users WHERE id=?', [req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/classes', auth, safeJsonRoute(async (req, res) => {
  res.json(await query('SELECT * FROM classes ORDER BY sort_order,id'));
}));

app.post('/api/classes', auth, adminFeeOnly, safeJsonRoute(async (req, res) => {
  await query('INSERT INTO classes(name,sort_order) VALUES(?,?)', [req.body.name, req.body.sort_order || 99]);
  await query('INSERT IGNORE INTO fee_structures(class_name) VALUES(?)', [req.body.name]);
  res.json({ ok: true });
}));

app.put('/api/classes/:id', auth, adminFeeOnly, safeJsonRoute(async (req, res) => {
  await query('UPDATE classes SET name=?,sort_order=? WHERE id=?', [req.body.name, req.body.sort_order || 99, req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/fee-structures', auth, safeJsonRoute(async (req, res) => {
  res.json(await query("SELECT * FROM fee_structures ORDER BY FIELD(class_name,'Nursery','KG','Class 1','Class 2','Class 3','Class 4','Class 5'), class_name"));
}));

app.put('/api/fee-structures/:className', auth, adminFeeOnly, safeJsonRoute(async (req, res) => {
  await query(
    'INSERT INTO fee_structures(class_name,monthly_fee,admission_fee) VALUES(?,?,?) ON DUPLICATE KEY UPDATE monthly_fee=VALUES(monthly_fee), admission_fee=VALUES(admission_fee)',
    [req.params.className, req.body.monthly_fee || 0, req.body.admission_fee || 0]
  );
  res.json({ ok: true });
}));

app.get('/api/students', auth, safeJsonRoute(async (req, res) => {
  const year = selectedYear(req);
  await syncAdmissionsToStudents(year);
  res.set('Cache-Control', 'no-store');
  const rows = await query(`
    SELECT id, admission_id, academic_year, name, sex, class_name, guardian_name, address, dob, contact_no, photo_url,
    COALESCE(status,'active') AS status, created_at,
    TIMESTAMPDIFF(YEAR, dob, CURDATE()) AS age
    FROM students
    WHERE academic_year=?
    ORDER BY id DESC
  `, [year]);
  res.json(rows);
}));

app.post('/api/students', auth, safeJsonRoute(async (req, res) => {
  const b = req.body;
  const year = selectedYear(req);
  if (!b.name) return res.status(400).json({ error: 'Name is required' });
  if (!b.dob) return res.status(400).json({ error: 'DOB is required' });
  await query(
    'INSERT INTO students(academic_year,name,sex,class_name,guardian_name,address,dob,contact_no,photo_url,status) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [year, b.name, b.sex, b.class_name || 'Nursery', b.guardian_name, b.address, sqlDate(b.dob), b.contact_no, b.photo_url, b.status || 'active']
  );
  res.json({ ok: true });
}));

app.put('/api/students/:id', auth, safeJsonRoute(async (req, res) => {
  const b = req.body;
  const year = selectedYear(req);
  if (!b.dob) return res.status(400).json({ error: 'DOB is required' });
  await query(
    'UPDATE students SET academic_year=?,name=?,sex=?,class_name=?,guardian_name=?,address=?,dob=?,contact_no=?,photo_url=?,status=? WHERE id=?',
    [year, b.name, b.sex, b.class_name || 'Nursery', b.guardian_name, b.address, sqlDate(b.dob), b.contact_no, b.photo_url, b.status || 'active', req.params.id]
  );
  res.json({ ok: true });
}));

app.delete('/api/students/:id', auth, safeJsonRoute(async (req, res) => {
  await query('DELETE FROM students WHERE id=?', [req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/admissions', auth, safeJsonRoute(async (req, res) => {
  const year = selectedYear(req);
  res.json(await query('SELECT *, TIMESTAMPDIFF(YEAR, dob, CURDATE()) AS age FROM admissions WHERE academic_year=? ORDER BY id DESC', [year]));
}));

app.post('/api/admissions', auth, safeJsonRoute(async (req, res) => {
  const b = req.body;
  const year = selectedYear(req);
  if (!b.name) return res.status(400).json({ error: 'Student name is required' });
  if (!b.dob) return res.status(400).json({ error: 'DOB is required' });
  const cls = b.class_name || 'Nursery';
  const fs = (await query('SELECT admission_fee FROM fee_structures WHERE class_name=?', [cls]))[0];
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    const [studentResult] = await conn.query(
      "INSERT INTO students(academic_year,name,sex,class_name,guardian_name,address,dob,contact_no,photo_url,status) VALUES(?,?,?,?,?,?,?,?,?,'active')",
      [year, b.name, b.sex, cls, b.guardian_name, b.address, sqlDate(b.dob), b.contact_no, b.photo_url]
    );
    const studentId = studentResult.insertId;
    const [admResult] = await conn.query(
      'INSERT INTO admissions(student_id,academic_year,name,sex,class_name,guardian_name,address,dob,contact_no,photo_url,admission_fee) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      [studentId, year, b.name, b.sex, cls, b.guardian_name, b.address, sqlDate(b.dob), b.contact_no, b.photo_url, fs?.admission_fee || 0]
    );
    await conn.query('UPDATE students SET admission_id=? WHERE id=?', [admResult.insertId, studentId]);
    await conn.commit();
    res.json({ ok: true, student_id: studentId, admission_id: admResult.insertId });
  } catch (e) {
    await conn.rollback();
    console.error('ADMISSION SAVE ERROR:', e);
    res.status(500).json({ error: 'Admission saved failed: ' + e.message });
  } finally {
    conn.release();
  }
}));

app.post('/api/monthly-fees/generate', auth, safeJsonRoute(async (req, res) => {
  const { month } = req.body;
  const year = selectedYear(req);
  if (!month) return res.status(400).json({ error: 'Month required' });
  const students = await query("SELECT * FROM students WHERE academic_year=? AND COALESCE(status,'active')='active'", [year]);
  let created = 0;
  for (const s of students) {
    const fs = (await query('SELECT monthly_fee FROM fee_structures WHERE class_name=?', [s.class_name]))[0];
    await query('INSERT IGNORE INTO monthly_fee_payments(student_id,academic_year,fee_month,base_fee,paid_amount) VALUES(?,?,?,?,0)', [
      s.id, year, month, fs?.monthly_fee || 0
    ]);
    created++;
  }
  res.json({ ok: true, created });
}));

app.get('/api/monthly-fees', auth, safeJsonRoute(async (req, res) => {
  const year = selectedYear(req);
  res.json(await query(
    `SELECT p.*,s.name,s.sex,s.class_name,s.guardian_name,s.address,s.dob,s.contact_no,TIMESTAMPDIFF(YEAR, s.dob, CURDATE()) AS age
    FROM monthly_fee_payments p
    JOIN students s ON s.id=p.student_id
    WHERE p.academic_year=? AND (?='' OR p.fee_month=?)
    ORDER BY p.id DESC`,
    [year, req.query.month || '', req.query.month || '']
  ));
}));

app.put('/api/monthly-fees/:id', auth, safeJsonRoute(async (req, res) => {
  const b = req.body;
  await query(
    'UPDATE monthly_fee_payments SET misc_fee=?,misc_note=?,paid_amount=?,payment_mode=?,payment_provider=?,transaction_id=? WHERE id=?',
    [b.misc_fee || 0, b.misc_note || '', b.paid_amount || 0, b.payment_mode || 'Cash', b.payment_provider || '', b.transaction_id || '', req.params.id]
  );
  res.json({ ok: true });
}));

app.delete('/api/monthly-fees/:id', auth, safeJsonRoute(async (req, res) => {
  await query('DELETE FROM monthly_fee_payments WHERE id=?', [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/admission-fees', auth, safeJsonRoute(async (req, res) => {
  const b = req.body;
  const year = selectedYear(req);
  await query(
    'INSERT INTO admission_fee_payments(admission_id,student_id,academic_year,base_fee,misc_fee,misc_note,paid_amount,payment_mode,payment_provider,transaction_id) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [b.admission_id || null, b.student_id || null, year, b.base_fee || 0, b.misc_fee || 0, b.misc_note || '', b.paid_amount || 0, b.payment_mode || 'Cash', b.payment_provider || '', b.transaction_id || '']
  );
  res.json({ ok: true });
}));

app.get('/api/admission-fees', auth, safeJsonRoute(async (req, res) => {
  const year = selectedYear(req);
  res.json(await query(
    'SELECT p.*, a.name, a.sex, a.class_name, a.guardian_name, a.address, a.dob, a.contact_no, TIMESTAMPDIFF(YEAR, a.dob, CURDATE()) AS age FROM admission_fee_payments p LEFT JOIN admissions a ON a.id=p.admission_id WHERE p.academic_year=? ORDER BY p.id DESC',
    [year]
  ));
}));

app.delete('/api/admission-fees/:id', auth, safeJsonRoute(async (req, res) => {
  await query('DELETE FROM admission_fee_payments WHERE id=?', [req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/report-cards', auth, safeJsonRoute(async (req, res) => {
  const year = selectedYear(req);
  res.json(await query(
    'SELECT r.*, s.name, s.guardian_name, s.contact_no, s.dob, TIMESTAMPDIFF(YEAR, s.dob, CURDATE()) AS age FROM report_cards r JOIN students s ON s.id=r.student_id WHERE r.academic_year=? ORDER BY r.id DESC',
    [year]
  ));
}));

app.post('/api/report-cards', auth, safeJsonRoute(async (req, res) => {
  const b = req.body;
  const year = selectedYear(req);
  const subjects = Array.isArray(b.subjects) ? b.subjects : [];
  const total = subjects.reduce((a, x) => a + Number(x.total || 0), 0);
  const obtained = subjects.reduce((a, x) => a + Number(x.marks || 0), 0);
  const pct = total ? (obtained / total) * 100 : 0;
  const grade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B+' : pct >= 60 ? 'B' : pct >= 50 ? 'C' : 'Needs Improvement';
  await query(
    'INSERT INTO report_cards(student_id,academic_year,exam_name,class_name,subjects,total_marks,obtained_marks,percentage,grade,remarks) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [b.student_id, year, b.exam_name, b.class_name, JSON.stringify(subjects), total, obtained, pct, grade, b.remarks || '']
  );
  res.json({ ok: true });
}));

app.delete('/api/report-cards/:id', auth, safeJsonRoute(async (req, res) => {
  await query('DELETE FROM report_cards WHERE id=?', [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/sms/fees-due', auth, canManageUsers, safeJsonRoute(async (req, res) => {
  const { contact_no, message } = req.body;
  if (!contact_no) return res.status(400).json({ error: 'Contact number required' });
  const text = message || 'School fee is due. Please pay soon.';
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) {
    const body = new URLSearchParams({ To: contact_no, From: process.env.TWILIO_FROM, Body: text });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(process.env.TWILIO_ACCOUNT_SID + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
    const d = await r.json();
    if (!r.ok) return res.status(400).json({ error: d.message || 'Twilio SMS error' });
    return res.json({ ok: true, provider: 'twilio', sid: d.sid });
  }
  if (process.env.FAST2SMS_API_KEY) {
    const r = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: { authorization: process.env.FAST2SMS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        route: process.env.FAST2SMS_ROUTE || 'q',
        message: text,
        language: 'english',
        flash: 0,
        numbers: String(contact_no).replace(/\D/g, '')
      })
    });
    const d = await r.json();
    if (!r.ok || d.return === false) return res.status(400).json({ error: d.message || 'Fast2SMS error' });
    return res.json({ ok: true, provider: 'fast2sms', response: d });
  }
  return res.status(400).json({ error: 'SMS not configured. Add Twilio variables OR FAST2SMS_API_KEY in Railway.' });
}));

async function collectBackup(year = null) {
  const yearWhere = year ? ' WHERE academic_year=' + Number(year) : '';
  return {
    exported_at: new Date().toISOString(),
    selected_year: year || 'all',
    users: await query('SELECT id,email,role,created_at FROM users'),
    classes: await query('SELECT * FROM classes'),
    students: await query('SELECT * FROM students' + yearWhere),
    admissions: await query('SELECT * FROM admissions' + yearWhere),
    fee_structures: await query('SELECT * FROM fee_structures'),
    monthly_fee_payments: await query('SELECT * FROM monthly_fee_payments' + yearWhere),
    admission_fee_payments: await query('SELECT * FROM admission_fee_payments' + yearWhere),
    report_cards: await query('SELECT * FROM report_cards' + yearWhere)
  };
}

app.get('/api/backup/status', auth, safeJsonRoute(async (req, res) => {
  res.json({
    encryption: 'AES-256-GCM',
    backup_secret_set: !!process.env.BACKUP_SECRET,
    configured_service_account: !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_DRIVE_FOLDER_ID),
    configured_google_login: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN && process.env.GOOGLE_DRIVE_FOLDER_ID)
  });
}));

app.get('/api/backup/download', auth, canManageUsers, safeJsonRoute(async (req, res) => {
  const year = req.query.year === 'all' ? null : selectedYear(req);
  const encrypted = encryptBackupObject(await collectBackup(year));
  res.setHeader('Content-Disposition', `attachment; filename=school-backup-${year || 'all'}-encrypted.json`);
  res.json(encrypted);
}));

app.post('/api/backup/local', auth, canManageUsers, safeJsonRoute(async (req, res) => {
  const year = req.body.year === 'all' ? null : selectedYear(req);
  const filename = `school-backup-${year || 'all'}-${Date.now()}-encrypted.json`;
  const filepath = path.join(BACKUP_DIR, filename);
  const encrypted = encryptBackupObject(await collectBackup(year));
  fs.writeFileSync(filepath, JSON.stringify(encrypted, null, 2));
  await logBackupHistory('local', 'success', `Local backup created: ${filename}`);
  res.json({ ok: true, filename });
}));

app.get('/api/backup/files', auth, canManageUsers, safeJsonRoute(async (req, res) => {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, size: stat.size, created_at: stat.mtime.toISOString() };
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(files);
}));

app.post('/api/backup/restore', auth, canManageUsers, safeJsonRoute(async (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ error: 'Filename required' });
  const filepath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Backup file not found' });
  const text = fs.readFileSync(filepath, 'utf8');
  const payload = decryptBackupObject(JSON.parse(text));
  if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'Invalid backup file' });

  const p = await getPool();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    if (Array.isArray(payload.classes)) {
      for (const c of payload.classes) {
        await conn.query('INSERT INTO classes(id,name,sort_order) VALUES(?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name), sort_order=VALUES(sort_order)', [c.id, c.name, c.sort_order || 99]);
      }
    }
    if (Array.isArray(payload.fee_structures)) {
      for (const f of payload.fee_structures) {
        await conn.query('INSERT INTO fee_structures(class_name,monthly_fee,admission_fee) VALUES(?,?,?) ON DUPLICATE KEY UPDATE monthly_fee=VALUES(monthly_fee), admission_fee=VALUES(admission_fee)', [f.class_name, f.monthly_fee || 0, f.admission_fee || 0]);
      }
    }
    if (Array.isArray(payload.students)) {
      for (const s of payload.students) {
        await conn.query(
          `INSERT INTO students(id,admission_id,academic_year,name,sex,class_name,guardian_name,address,dob,contact_no,photo_url,status,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE admission_id=VALUES(admission_id),academic_year=VALUES(academic_year),name=VALUES(name),sex=VALUES(sex),class_name=VALUES(class_name),guardian_name=VALUES(guardian_name),address=VALUES(address),dob=VALUES(dob),contact_no=VALUES(contact_no),photo_url=VALUES(photo_url),status=VALUES(status)`,
          [s.id, s.admission_id || null, s.academic_year || 2025, s.name, s.sex, s.class_name, s.guardian_name, s.address, sqlDate(s.dob), s.contact_no, s.photo_url, s.status || 'active', s.created_at || new Date()]
        );
      }
    }
    if (Array.isArray(payload.admissions)) {
      for (const a of payload.admissions) {
        await conn.query(
          `INSERT INTO admissions(id,student_id,academic_year,name,sex,class_name,guardian_name,address,dob,contact_no,photo_url,admission_fee,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE student_id=VALUES(student_id),academic_year=VALUES(academic_year),name=VALUES(name),sex=VALUES(sex),class_name=VALUES(class_name),guardian_name=VALUES(guardian_name),address=VALUES(address),dob=VALUES(dob),contact_no=VALUES(contact_no),photo_url=VALUES(photo_url),admission_fee=VALUES(admission_fee)`,
          [a.id, a.student_id || null, a.academic_year || 2025, a.name, a.sex, a.class_name, a.guardian_name, a.address, sqlDate(a.dob), a.contact_no, a.photo_url, a.admission_fee || 0, a.created_at || new Date()]
        );
      }
    }
    if (Array.isArray(payload.monthly_fee_payments)) {
      for (const m of payload.monthly_fee_payments) {
        await conn.query(
          `INSERT INTO monthly_fee_payments(id,student_id,academic_year,fee_month,base_fee,misc_fee,misc_note,paid_amount,payment_mode,payment_provider,transaction_id,paid_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE base_fee=VALUES(base_fee),misc_fee=VALUES(misc_fee),misc_note=VALUES(misc_note),paid_amount=VALUES(paid_amount),payment_mode=VALUES(payment_mode),payment_provider=VALUES(payment_provider),transaction_id=VALUES(transaction_id)`,
          [m.id, m.student_id, m.academic_year || 2025, m.fee_month, m.base_fee || 0, m.misc_fee || 0, m.misc_note || '', m.paid_amount || 0, m.payment_mode || 'Cash', m.payment_provider || '', m.transaction_id || '', m.paid_at || new Date()]
        );
      }
    }
    if (Array.isArray(payload.admission_fee_payments)) {
      for (const a of payload.admission_fee_payments) {
        await conn.query(
          `INSERT INTO admission_fee_payments(id,admission_id,student_id,academic_year,base_fee,misc_fee,misc_note,paid_amount,payment_mode,payment_provider,transaction_id,paid_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE base_fee=VALUES(base_fee),misc_fee=VALUES(misc_fee),misc_note=VALUES(misc_note),paid_amount=VALUES(paid_amount),payment_mode=VALUES(payment_mode),payment_provider=VALUES(payment_provider),transaction_id=VALUES(transaction_id)`,
          [a.id, a.admission_id || null, a.student_id || null, a.academic_year || 2025, a.base_fee || 0, a.misc_fee || 0, a.misc_note || '', a.paid_amount || 0, a.payment_mode || 'Cash', a.payment_provider || '', a.transaction_id || '', a.paid_at || new Date()]
        );
      }
    }
    if (Array.isArray(payload.report_cards)) {
      for (const r of payload.report_cards) {
        await conn.query(
          `INSERT INTO report_cards(id,student_id,academic_year,exam_name,class_name,subjects,total_marks,obtained_marks,percentage,grade,remarks,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE academic_year=VALUES(academic_year),exam_name=VALUES(exam_name),class_name=VALUES(class_name),subjects=VALUES(subjects),total_marks=VALUES(total_marks),obtained_marks=VALUES(obtained_marks),percentage=VALUES(percentage),grade=VALUES(grade),remarks=VALUES(remarks)`,
          [r.id, r.student_id, r.academic_year || 2025, r.exam_name, r.class_name, typeof r.subjects === 'string' ? r.subjects : JSON.stringify(r.subjects || []), r.total_marks || 0, r.obtained_marks || 0, r.percentage || 0, r.grade || '', r.remarks || '', r.created_at || new Date()]
        );
      }
    }
    await conn.commit();
    await logBackupHistory('restore', 'success', `Restored from local file: ${filename}`);
    res.json({ ok: true, restored: true });
  } catch (e) {
    await conn.rollback();
    await logBackupHistory('restore', 'failed', e.message);
    throw e;
  } finally {
    conn.release();
  }
}));

app.post('/api/backup/upload', auth, canManageUsers, safeJsonRoute(async (req, res) => {
  const payload = decryptBackupObject(req.body);
  if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'Invalid backup file' });
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    if (Array.isArray(payload.classes)) {
      for (const c of payload.classes) {
        await conn.query('INSERT INTO classes(id,name,sort_order) VALUES(?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name), sort_order=VALUES(sort_order)', [c.id, c.name, c.sort_order || 99]);
      }
    }
    if (Array.isArray(payload.fee_structures)) {
      for (const f of payload.fee_structures) {
        await conn.query('INSERT INTO fee_structures(class_name,monthly_fee,admission_fee) VALUES(?,?,?) ON DUPLICATE KEY UPDATE monthly_fee=VALUES(monthly_fee), admission_fee=VALUES(admission_fee)', [f.class_name, f.monthly_fee || 0, f.admission_fee || 0]);
      }
    }
    if (Array.isArray(payload.students)) {
      for (const s of payload.students) {
        await conn.query(
          `INSERT INTO students(id,admission_id,academic_year,name,sex,class_name,guardian_name,address,dob,contact_no,photo_url,status,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE admission_id=VALUES(admission_id),academic_year=VALUES(academic_year),name=VALUES(name),sex=VALUES(sex),class_name=VALUES(class_name),guardian_name=VALUES(guardian_name),address=VALUES(address),dob=VALUES(dob),contact_no=VALUES(contact_no),photo_url=VALUES(photo_url),status=VALUES(status)`,
          [s.id, s.admission_id || null, s.academic_year || 2025, s.name, s.sex, s.class_name, s.guardian_name, s.address, sqlDate(s.dob), s.contact_no, s.photo_url, s.status || 'active', s.created_at || new Date()]
        );
      }
    }
    if (Array.isArray(payload.admissions)) {
      for (const a of payload.admissions) {
        await conn.query(
          `INSERT INTO admissions(id,student_id,academic_year,name,sex,class_name,guardian_name,address,dob,contact_no,photo_url,admission_fee,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE student_id=VALUES(student_id),academic_year=VALUES(academic_year),name=VALUES(name),sex=VALUES(sex),class_name=VALUES(class_name),guardian_name=VALUES(guardian_name),address=VALUES(address),dob=VALUES(dob),contact_no=VALUES(contact_no),photo_url=VALUES(photo_url),admission_fee=VALUES(admission_fee)`,
          [a.id, a.student_id || null, a.academic_year || 2025, a.name, a.sex, a.class_name, a.guardian_name, a.address, sqlDate(a.dob), a.contact_no, a.photo_url, a.admission_fee || 0, a.created_at || new Date()]
        );
      }
    }
    if (Array.isArray(payload.monthly_fee_payments)) {
      for (const m of payload.monthly_fee_payments) {
        await conn.query(
          `INSERT INTO monthly_fee_payments(id,student_id,academic_year,fee_month,base_fee,misc_fee,misc_note,paid_amount,payment_mode,payment_provider,transaction_id,paid_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE base_fee=VALUES(base_fee),misc_fee=VALUES(misc_fee),misc_note=VALUES(misc_note),paid_amount=VALUES(paid_amount),payment_mode=VALUES(payment_mode),payment_provider=VALUES(payment_provider),transaction_id=VALUES(transaction_id)`,
          [m.id, m.student_id, m.academic_year || 2025, m.fee_month, m.base_fee || 0, m.misc_fee || 0, m.misc_note || '', m.paid_amount || 0, m.payment_mode || 'Cash', m.payment_provider || '', m.transaction_id || '', m.paid_at || new Date()]
        );
      }
    }
    if (Array.isArray(payload.admission_fee_payments)) {
      for (const a of payload.admission_fee_payments) {
        await conn.query(
          `INSERT INTO admission_fee_payments(id,admission_id,student_id,academic_year,base_fee,misc_fee,misc_note,paid_amount,payment_mode,payment_provider,transaction_id,paid_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE base_fee=VALUES(base_fee),misc_fee=VALUES(misc_fee),misc_note=VALUES(misc_note),paid_amount=VALUES(paid_amount),payment_mode=VALUES(payment_mode),payment_provider=VALUES(payment_provider),transaction_id=VALUES(transaction_id)`,
          [a.id, a.admission_id || null, a.student_id || null, a.academic_year || 2025, a.base_fee || 0, a.misc_fee || 0, a.misc_note || '', a.paid_amount || 0, a.payment_mode || 'Cash', a.payment_provider || '', a.transaction_id || '', a.paid_at || new Date()]
        );
      }
    }
    if (Array.isArray(payload.report_cards)) {
      for (const r of payload.report_cards) {
        await conn.query(
          `INSERT INTO report_cards(id,student_id,academic_year,exam_name,class_name,subjects,total_marks,obtained_marks,percentage,grade,remarks,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE academic_year=VALUES(academic_year),exam_name=VALUES(exam_name),class_name=VALUES(class_name),subjects=VALUES(subjects),total_marks=VALUES(total_marks),obtained_marks=VALUES(obtained_marks),percentage=VALUES(percentage),grade=VALUES(grade),remarks=VALUES(remarks)`,
          [r.id, r.student_id, r.academic_year || 2025, r.exam_name, r.class_name, typeof r.subjects === 'string' ? r.subjects : JSON.stringify(r.subjects || []), r.total_marks || 0, r.obtained_marks || 0, r.percentage || 0, r.grade || '', r.remarks || '', r.created_at || new Date()]
        );
      }
    }
    await conn.commit();
    await logBackupHistory('upload', 'success', 'Encrypted backup uploaded/restored successfully');
    res.json({ ok: true, restored: true });
  } catch (e) {
    await conn.rollback();
    await logBackupHistory('upload', 'failed', e.message);
    throw e;
  } finally {
    conn.release();
  }
}));

app.post('/api/backup/google-drive', auth, canManageUsers, safeJsonRoute(async (req, res) => {
  if (!process.env.GOOGLE_DRIVE_FOLDER_ID) return res.status(400).json({ error: 'GOOGLE_DRIVE_FOLDER_ID is not configured' });
  let authClient;
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) {
    authClient = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    authClient.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    authClient = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/drive.file'] });
  } else {
    return res.status(400).json({ error: 'Google Drive variables not configured.' });
  }
  const year = req.body.year === 'all' ? null : selectedYear(req);
  const drive = google.drive({ version: 'v3', auth: authClient });
  const data = JSON.stringify(encryptBackupObject(await collectBackup(year)), null, 2);
  const r = await drive.files.create({
    requestBody: { name: `school-backup-${year || 'all'}-${Date.now()}-encrypted.json`, parents: [process.env.GOOGLE_DRIVE_FOLDER_ID], mimeType: 'application/json' },
    media: { mimeType: 'application/json', body: data }
  });
  await logBackupHistory('google-drive', 'success', `Google Drive backup uploaded: ${r.data.id}`);
  res.json({ ok: true, fileId: r.data.id });
}));

app.get('/api/backup/history', auth, canManageUsers, safeJsonRoute(async (req, res) => {
  const rows = await query('SELECT * FROM backup_history ORDER BY created_at DESC LIMIT 100');
  res.json(rows);
}));

app.get('/api/db-check', auth, safeJsonRoute(async (req, res) => {
  const year = selectedYear(req);
  const rows = await query('SELECT COUNT(*) AS students FROM students WHERE academic_year=?', [year]);
  res.json({ ok: true, year, students: rows[0]?.students || 0 });
}));

app.get('/api/health', (req, res) => res.json({ ok: true }));

const dist = path.join(__dirname, '../frontend/dist');
app.use(express.static(dist));
app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));

initDb()
  .then(() => app.listen(PORT, () => console.log('School app running on ' + PORT)))
  .catch((e) => { console.error('DATABASE INITIALIZATION ERROR:', e.message); process.exit(1); });
