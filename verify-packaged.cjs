(async()=>{
  const port=process.env.DEBUG_PORT || '9333';
  const pages=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
  const page=pages.find(p=>p.title==='小熊记账');
  if(!page)throw new Error('Application page missing');
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  const expression=`(async()=>{const ledger=await window.ledgerAPI.read();const location=await window.ledgerAPI.path();state.ledger=ledger;state.page='records';render();const recordsRendered=!!document.querySelector('.table');state.page='categories';render();const categoriesRendered=document.querySelectorAll('.cat').length;state.page='overview';render();return {location,categories:ledger.categories.length,records:ledger.records.length,recordsRendered,categoriesRendered,footer:document.querySelector('.side-foot').textContent,body:document.body.innerText.includes('月度概览')};})()`;
  const result=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Timed out')),15000);
    ws.onmessage=e=>{const msg=JSON.parse(e.data);if(msg.id===1){clearTimeout(timer);resolve(msg)}};
    ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
  });
  if(result.result.exceptionDetails)throw new Error(JSON.stringify(result.result.exceptionDetails));
  const value=result.result.result.value;
  console.log(JSON.stringify(value,null,2));
  if(!value.location.includes('bear_accounting')||!value.recordsRendered||value.categoriesRendered!==value.categories||!value.body)throw new Error('Packaged app checks failed');
  ws.send(JSON.stringify({id:2,method:'Runtime.evaluate',params:{expression:'window.close()'}}));
  await new Promise(resolve=>setTimeout(resolve,500));
  ws.close();
})().catch(e=>{console.error(e.message);process.exitCode=1});
