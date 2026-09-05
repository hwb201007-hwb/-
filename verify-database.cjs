const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const database = 'bear_accounting_verify_' + Date.now();
const app = { isPackaged:false, getPath:()=>__filename, requestSingleInstanceLock:()=>true, whenReady:()=>({then(){}}), on(){} };
const context = {require:name=>name==='electron'?{app}:require(name), __dirname, process:{env:{...process.env,BEAR_ACCOUNTING_DB:database}}, console};
vm.createContext(context);
vm.runInContext(fs.readFileSync(require('path').join(__dirname,'main.js'),'utf8')+'\nthis.api={initializeDatabase,readLedger,replaceLedger,getConfig:()=>dbConfig,end:()=>pool.end()};',context);
(async()=>{
  let admin;
  try {
    await context.api.initializeDatabase();
    const initial=await context.api.readLedger();
    assert.equal(initial.categories.length,9);
    const data=JSON.parse(JSON.stringify(initial));
    const now=new Date().toISOString();
    data.records.push({id:'verification-record',type:'expense',amount:12.34,categoryId:'expense-food',date:'2026-09-04',note:'测试账目',createdAt:now,updatedAt:now});
    await context.api.replaceLedger(data);
    let read=await context.api.readLedger();
    assert.equal(read.records[0].amount,12.34);
    assert.equal(read.records[0].createdAt,now);
    assert.equal(read.records[0].date,'2026-09-04');
    read.records[0].amount=56.78;
    read.records[0].categoryId='expense-other';
    read.categories.find(c=>c.id==='expense-food').status='inactive';
    read.merges.push({sourceCategoryId:'expense-food',targetCategoryId:'expense-other',mergedAt:now});
    await context.api.replaceLedger(read);
    read=await context.api.readLedger();
    assert.equal(read.records[0].amount,56.78);
    assert.equal(read.records[0].categoryId,'expense-other');
    assert.equal(read.merges.length,1);
    const broken=JSON.parse(JSON.stringify(read));
    broken.records.push({...broken.records[0]});
    await assert.rejects(()=>context.api.replaceLedger(broken));
    assert.equal((await context.api.readLedger()).records.length,1);
    read.records=[];
    await context.api.replaceLedger(read);
    assert.equal((await context.api.readLedger()).records.length,0);
    console.log('PASS: MySQL initialize, create, read, update, merge, rollback, delete, ISO dates');
  } finally {
    await context.api.end();
    admin=await mysql.createConnection(context.api.getConfig());
    await admin.query('DROP DATABASE `'+database+'`');
    await admin.end();
    console.log('Isolated verification database removed');
  }
})().catch(e=>{console.error(e.message);process.exitCode=1});
