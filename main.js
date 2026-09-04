const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
const dataDir = path.join(portableRoot, 'data');
const dataFile = path.join(dataDir, 'ledger.json');
const devDataFile = path.join(__dirname, 'data', 'ledger.json');

function activeFile() { return app.isPackaged ? dataFile : devDataFile; }
function defaults() {
  const now = new Date().toISOString();
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
  ], records: [], merges: [], updatedAt: now };
}
function readLedger() {
  const file = activeFile();
  try { if (!fs.existsSync(file)) { fs.mkdirSync(path.dirname(file), {recursive:true}); writeLedger(defaults()); } const data = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(data.categories) || data.categories.length === 0) { const fresh = defaults(); fresh.records = Array.isArray(data.records) ? data.records : []; writeLedger(fresh); return fresh; } return data; }
  catch (e) { throw new Error('数据文件无法读取，请不要删除 data\\ledger.json，并先复制应用文件夹做备份。'); }
}
function writeLedger(data) {
  const file = activeFile(); fs.mkdirSync(path.dirname(file), {recursive:true});
  const tmp = file + '.tmp'; data.updatedAt = new Date().toISOString();
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8'); fs.renameSync(tmp, file);
}
function createWindow() { const win = new BrowserWindow({width:1280,height:820,minWidth:1040,minHeight:680,backgroundColor:'#fffaf0',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false}}); win.loadFile('index.html'); }
app.whenReady().then(() => { ipcMain.handle('ledger:read', () => readLedger()); ipcMain.handle('ledger:write', (_, data) => { writeLedger(data); return data; }); ipcMain.handle('ledger:path', () => activeFile()); createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length===0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
