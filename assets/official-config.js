/* Opt-in official workspace. Existing demo URLs and storage remain compatible. */
window.officialMode=new URLSearchParams(location.search).get('dataset')==='official';
window.officialReady=false;
window.workspaceStorageKey=officialMode?'youan-official-v1':'youan-demo-v2';
window.workspaceSerialize=db=>{
  if(!officialMode)return JSON.stringify(db);
  const result=structuredClone(db);
  if(result.p0){
    result.p0.assessments={};result.p0.history=[];
    for(const years of Object.values(result.p0.data||{}))for(const fields of Object.values(years))for(const [key,r] of Object.entries(fields)){
      r.candidates=r.candidates.filter(c=>c.sourceKind!=='official');
      if(!r.candidates.length)delete fields[key];
    }
  }
  return JSON.stringify(result);
};
window.workspaceMatches=(s,q)=>{
  const norm=v=>String(v||'').normalize('NFKC').replaceAll('臺','台').replace(/\s+/g,'').toLowerCase();
  q=norm(q);if(!q)return true;
  if(norm([s.name,s.address,s.officialId,s.registrationNumber].join(' ')).includes(q))return true;
  let i=0;for(const c of norm(s.name))if(c===q[i])i++;
  return q.length>=2&&i===q.length;
};
if(officialMode){
  const originalFetch=window.fetch.bind(window);
  window.fetch=(input,options)=>{
    if(typeof input==='string'){
      if(input.startsWith('/api/')&&typeof API_BASE==='string')input=API_BASE+input;
      const u=new URL(input,location.href);
      if(/^\/api\/(storage|risk)\//.test(u.pathname)){u.searchParams.set('workspace','official');input=u.href;}
    }
    return originalFetch(input,options);
  };
}
