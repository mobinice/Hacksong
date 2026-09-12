window.workspaceMatches=(school,query)=>{
  const normalize=v=>String(v||'').normalize('NFKC').replaceAll('臺','台').replace(/\s+/g,'').toLowerCase();
  const q=normalize(query);if(!q)return true;
  if(normalize([school.name,school.address,school.officialId,school.registrationNumber].join(' ')).includes(q))return true;
  let i=0;for(const char of normalize(school.name))if(char===q[i])i++;
  return q.length>=2&&i===q.length;
};
/* Load the official snapshot and user state before initializing any workspace. */
window.workspaceSerialize = function(db) {
  const result=structuredClone(db);
  if(result.p0){
    result.p0.assessments={};
    result.p0.history=[];
    for(const years of Object.values(result.p0.data||{}))for(const fields of Object.values(years)){
      for(const [key,record] of Object.entries(fields)){
        record.candidates=record.candidates.filter(c=>c.sourceKind!=='official');
        if(!record.candidates.length)delete fields[key];
      }
    }
  }
  return JSON.stringify(result);
};
(async()=>{
  const host=document.getElementById('page');
  host.innerHTML='<div class="loading" role="status">正在載入新北市官方園所及人工工作紀錄…</div>';
  try{
    const response=await fetch('/api/workspace');
    if(!response.ok)throw Error('官方園所資料載入失敗（HTTP '+response.status+'）');
    window.workspaceSnapshot=await response.json();
    if(!Array.isArray(workspaceSnapshot.schools)||!workspaceSnapshot.schools.length)throw Error('官方資料快照為空');
    const stateResponse=await fetch('/api/storage/state');
    if(!stateResponse.ok)throw Error('人工工作紀錄載入失敗');
    const saved=await stateResponse.json();
    let local;
    try{local=JSON.parse(localStorage.getItem('youan-official-v1'));}catch{}
    const remote=saved.data?.workspace==='ntpc-official-v1'?saved.data:null;
    window.workspaceState=remote || (local?.workspace==='ntpc-official-v1'?local:null);
    for(const src of ['assets/app.js','assets/vendor/jszip.min.js','assets/youan-p0.js','assets/evaluations.js','assets/workbench-ui.js','assets/real-schools.js','assets/workspace-ui.js']){
      await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src+'?v=9';script.onload=resolve;script.onerror=()=>reject(Error('無法載入 '+src));document.body.append(script);});
    }
    dbBackend=saved.backend||'本地資料庫';
    go('data');
  }catch(error){
    host.replaceChildren();const box=document.createElement('div');box.className='notice';box.textContent=error.message+'。請確認本地服務後重新整理；未載入任何示範資料。';host.append(box);
  }
})();
