const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

const DB_NAME = process.env.BEAR_ACCOUNTING_DB || 'bear_accounting';
let dbConfig;
let pool;

function runtimeDataDirectory() {
  const root = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
  return app.isPackaged ? path.join(root, 'data') : path.join(__dirname, 'data');
}
function loadDatabaseConfig() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(path.join(runtimeDataDirectory(), 'mysql-config.json'), 'utf8')); } catch (_) {}
  return {
    host: process.env.BEAR_ACCOUNTING_HOST || saved.host || '127.0.0.1',
    port: Number(process.env.BEAR_ACCOUNTING_PORT || saved.port || 3306),
    user: process.env.BEAR_ACCOUNTING_USER || saved.user || 'root',
    password: process.env.BEAR_ACCOUNTING_PASSWORD || saved.password || '',
    charset: 'utf8mb4', timezone: 'Z'
  };
}

function defaults() {
  return { version: 1, categories: [
    {id:'income-salary',name:'工资',type:'income',parentId:null,status:'active',isFrequent:true,sortOrder:1},
    {id:'income-bonus',name:'奖金',type:'income',parentId:null,status:'active',isFrequent:false,sortOrder:2},
    {id:'income-other',name:'其他收入',type:'income',parentId:null,status:'active',isFrequent:false,sortOrder:3},
    {id:'expense-food',name:'餐饮',type:'expense',parentId:null,status:'active',isFrequent:true,sortOrder:1},
    {id:'expense-shopping',name:'购物',type:'expense',parentId:null,status:'active',isFrequent:true,sortOrder:2},
    {id:'expense-transport',name:'交通',type:'expense',parentId:null,status:'active',isFrequent:false,sortOrder:3},
    {id:'expense-home',name:'居住',type:'expense',parentId:null,status:'active',isFrequent:false,sortOrder:4},
    {id:'expense-entertainment',name:'娱乐',type:'expense',parentId:null,status:'active',isFrequent:false,sortOrder:5},
    {id:'expense-other',name:'其他支出',type:'expense',parentId:null,status:'active',isFrequent:false,sortOrder:6}
  ], records: [], merges: [], updatedAt: new Date().toISOString() };
}

function legacyFile() {
  return path.join(runtimeDataDirectory(), 'ledger.json');
}
function readLegacyLedger() { const file = legacyFile(); if (!fs.existsSync(file)) return defaults(); return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sqlDate(value) { return new Date(value || Date.now()); }

async function initializeDatabase() {
  if (!/^[a-zA-Z0-9_]+$/.test(DB_NAME)) throw new Error('数据库名称无效');
  dbConfig = loadDatabaseConfig();
  if (!dbConfig.password) throw new Error('未找到 MySQL 密码。请在 data\\mysql-config.json 中填写连接信息。');
  const bootstrap = await mysql.createConnection(dbConfig);
  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await bootstrap.end();
  pool = mysql.createPool({ ...dbConfig, database: DB_NAME, waitForConnections: true, connectionLimit: 5 });
  await pool.query(`CREATE TABLE IF NOT EXISTS categories (
    id VARCHAR(100) PRIMARY KEY, name VARCHAR(100) NOT NULL, type ENUM('income','expense') NOT NULL,
    parent_id VARCHAR(100) NULL, status ENUM('active','inactive') NOT NULL DEFAULT 'active',
    is_frequent BOOLEAN NOT NULL DEFAULT FALSE, sort_order INT NOT NULL DEFAULT 99, updated_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS records (
    id VARCHAR(100) PRIMARY KEY, type ENUM('income','expense') NOT NULL, amount DECIMAL(15,2) NOT NULL,
    category_id VARCHAR(100) NOT NULL, record_date DATE NOT NULL, note TEXT NULL,
    created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL,
    INDEX idx_records_date (record_date), INDEX idx_records_category (category_id)
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS category_merges (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, source_category_id VARCHAR(100) NOT NULL,
    target_category_id VARCHAR(100) NOT NULL, merged_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB`);
  const [[row]] = await pool.query('SELECT COUNT(*) AS count FROM categories');
  if (Number(row.count) === 0) await replaceLedger(readLegacyLedger());
}

async function replaceLedger(data) {
  if (!data || !Array.isArray(data.categories) || !data.categories.length || !Array.isArray(data.records) || !Array.isArray(data.merges)) throw new Error('账本结构无效');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM records');
    await conn.query('DELETE FROM category_merges');
    await conn.query('DELETE FROM categories');
    for (const c of (data.categories || [])) await conn.query(
      'INSERT INTO categories (id,name,type,parent_id,status,is_frequent,sort_order,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [c.id, c.name, c.type, c.parentId, c.status || 'active', !!c.isFrequent, c.sortOrder || 99, sqlDate(c.updatedAt)]);
    for (const r of (data.records || [])) await conn.query(
      'INSERT INTO records (id,type,amount,category_id,record_date,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [r.id, r.type, r.amount, r.categoryId, r.date, r.note || null, sqlDate(r.createdAt), sqlDate(r.updatedAt)]);
    for (const m of (data.merges || [])) await conn.query(
      'INSERT INTO category_merges (source_category_id,target_category_id,merged_at) VALUES (?,?,?)',
      [m.sourceCategoryId, m.targetCategoryId, sqlDate(m.mergedAt)]);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

async function readLedger() {
  const [categories] = await pool.query('SELECT id,name,type,parent_id AS parentId,status,is_frequent AS isFrequent,sort_order AS sortOrder FROM categories ORDER BY type,sort_order,name');
  const [records] = await pool.query("SELECT id,type,amount,category_id AS categoryId,DATE_FORMAT(record_date, '%Y-%m-%d') AS date,note,created_at AS createdAt,updated_at AS updatedAt FROM records ORDER BY record_date DESC,created_at DESC");
  const [merges] = await pool.query('SELECT source_category_id AS sourceCategoryId,target_category_id AS targetCategoryId,merged_at AS mergedAt FROM category_merges ORDER BY id');
  return { version: 1, categories: categories.map(c => ({...c, isFrequent: !!c.isFrequent})), records: records.map(r => ({...r, amount: Number(r.amount), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString()})), merges: merges.map(m => ({...m, mergedAt: m.mergedAt.toISOString()})), updatedAt: new Date().toISOString() };
}

function createWindow() {
  const win = new BrowserWindow({width:1280,height:820,minWidth:1040,minHeight:680,backgroundColor:'#fffaf0',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false}});
  win.loadFile('index.html');
}

if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  try {
    await initializeDatabase();
    ipcMain.handle('ledger:read', readLedger);
    ipcMain.handle('ledger:write', async (_, data) => { await replaceLedger(data); return readLedger(); });
    ipcMain.handle('ledger:path', () => `MySQL: ${dbConfig.host}:${dbConfig.port}/${DB_NAME}`);
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  } catch (error) {
    dialog.showErrorBox('数据库连接失败', `无法连接 MySQL 或初始化数据库。\n\n${error.message}`);
    app.quit();
  }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
