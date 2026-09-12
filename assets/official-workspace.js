/* Extend the original application; login, map, uploads and case tools stay in place. */
(()=>{
  const toggle=document.createElement('button');toggle.textContent=officialMode?'返回原有示範工作區':'官方資料工作區';
  toggle.onclick=()=>{const u=new URL(location.href);if(officialMode)u.searchParams.delete('dataset');else u.searchParams.set('dataset','official');location.href=u.href;};
  document.querySelector('nav').append(toggle);
  if(!officialMode)return;
  const badge=document.querySelector('.topline .demo');if(badge)badge.textContent='官方園所快照 · 缺值如實標示';
  const originalDetail=detail;
  detail=()=>{
    originalDetail();const s=schoolById(selected);if(!s?.officialId)return;
    const b=document.createElement('button');b.textContent='官方欄位與評鑑報告';b.onclick=()=>officialSchoolDetail(s.id);document.querySelector('#page .heading').append(b);
  };
  const originalEvaluations=Y.evaluations;
  Y.evaluations=(id,year)=>{
    if(!schoolById(id)?.officialId)return originalEvaluations(id,year);
    officialSchoolDetail(id);
    const b=document.createElement('button');b.textContent='上傳／管理補充評鑑文件';b.onclick=()=>originalEvaluations(id,year);document.querySelector('#modal .dialog-body').append(b);
  };
  const originalDecorate=Y.decorateEvaluations;
  Y.decorateEvaluations=()=>{originalDecorate();document.querySelectorAll('#work-results .evaluation-button small').forEach(el=>el.textContent='官方歷史報告／補充文件');};
  const originalOverview=overview;
  overview=()=>{originalOverview();const chip=document.querySelector('.map-chip');if(chip)chip.textContent='底圖 © OpenStreetMap · 官方來源未提供座標，請使用行政區與園所清單';};
  const baseAudit=auditPage;
  let queueQuery='',queuePage=0;
  Y.officialQueueFilter=q=>{queueQuery=q;queuePage=0;drawQueue();};
  Y.officialQueuePage=d=>{queuePage+=d;drawQueue();};
  function drawQueue(){
    const all=schools.filter(s=>!db.reviews[s.id]?.saved&&workspaceMatches(s,queueQuery));
    queuePage=Math.max(0,Math.min(queuePage,Math.ceil(all.length/25)-1));
    document.querySelector('#official-queue').innerHTML=`<div class="table-wrap"><table><thead><tr><th>園所</th><th>行政區／地址</th><th>資料狀態</th><th>覆核</th></tr></thead><tbody>${all.slice(queuePage*25,(queuePage+1)*25).map(s=>`<tr><td>${esc(s.name)}<br><small>${esc(s.officialId||s.id)}</small></td><td>${esc(s.district)}<br><small>${esc(s.address)}</small></td><td>${level(s)}</td><td><button onclick="go('detail',${s.id})">開始覆核</button></td></tr>`).join('')||'<tr><td colspan="4">沒有符合的待覆核園所</td></tr>'}</tbody></table></div><div class="toolbar pad"><button onclick="Y.officialQueuePage(-1)" ${queuePage===0?'disabled':''}>上一頁</button><span>第 ${queuePage+1} 頁 · 共 ${all.length} 筆</span><button onclick="Y.officialQueuePage(1)" ${(queuePage+1)*25>=all.length?'disabled':''}>下一頁</button></div>`;
  }
  auditPage=()=>{baseAudit();const section=document.createElement('section');section.className='panel';section.innerHTML=`<div class="panel-head"><div><h2>官方園所待覆核清單</h2><p>確認園所資料並儲存人工覆核後，沿用原有案件流程。</p></div></div><div class="filters"><input class="search" aria-label="搜尋官方待覆核園所" value="${esc(queueQuery)}" placeholder="園名、行政區或地址" oninput="Y.officialQueueFilter(this.value)"></div><div id="official-queue"></div>`;document.querySelector('#page').append(section);drawQueue();};
  const oldReset=confirmResetDemo;
  confirmResetDemo=()=>{oldReset();document.querySelector('#modal .notice').textContent='僅重設官方工作區的人工工作紀錄；官方快照與原有示範工作區保留。';};
  (async()=>{
    const host=document.querySelector('#page');host.innerHTML='<div class="loading" role="status">正在載入官方園所與人工工作紀錄…</div>';
    try{
      const [response,stateResponse]=await Promise.all([fetch(API_BASE+'/api/workspace'),fetch(API_BASE+'/api/storage/state')]);
      if(!response.ok||!stateResponse.ok)throw Error('官方資料或人工紀錄載入失敗');
      const data=await response.json(),saved=await stateResponse.json();
      if(!Array.isArray(data.schools)||!data.schools.length)throw Error('官方快照為空');
      const local=db.workspace==='ntpc-official-v1'?db:null;
      Y.installOfficial(data.schools,saved.data?.workspace==='ntpc-official-v1'?saved.data:local);
      dbBackend=saved.backend||dbBackend;
      if(badge)badge.textContent='官方園所快照 · 缺值如實標示';
      render();
    }catch(error){host.replaceChildren();const box=document.createElement('div');box.className='notice';box.textContent=error.message+'。可切回原有工作區；官方模式不會補入示範園所。';host.append(box);}
  })();
})();
