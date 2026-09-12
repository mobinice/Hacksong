/* Public school identity + explicitly labelled demo financial scenarios.
   All pages use Y's shared source records and scoring engine. */
(() => {
  const API='data/map_demo_schools.json';
  const DIMS=[['compliance','法遵／裁罰／評鑑'],['finance','財務／收費'],['consistency','資料／營運一致性'],['sentiment','輿情預警']];
  let real=[],mode='demo';
  function normalize(r){
    const c=Array.isArray(r.coordinates)?r.coordinates:[r.lat,r.lng];
    return {id:String(r.id),external:true,name:String(r.name||'未命名園所'),short:String(r.name||'').replace(/^新北市/,''),
      district:String(r.district||''),address:String(r.address||'').replace(/\[\d+\]/,''),lat:Number(c?.[0]),lng:Number(c?.[1]),
      type:r.type||'未提供',capacity:Number(r.capacity)||0,score:0,complete:Number(r.completeness)||0,trend:0,
      evaluations:Array.isArray(r.evaluations)?r.evaluations:[],domains:Array.isArray(r.domainsStatus)?r.domainsStatus:[],
      telephone:r.telephone||'',sourceUrl:r.sourceUrl||'',auditStatus:r.auditStatus||''};
  }
  window.realSchoolById=id=>real.find(s=>s.id===String(id));
  // These objects are now already in the shared school registry.
  window.realSchoolsForAudit=()=>[];
  window.schoolSource=()=>({mode,count:real.length});
  activeSchools=()=>schools.filter(s=>mode==='real'?s.external:!s.external);
  activeDistricts=()=>[...new Set(activeSchools().map(s=>s.district))];
  findSchool=id=>schoolById(id);
  const baseOpen=openSchool,basePopup=showPopup,baseOverview=overview,baseDetail=detail;
  openSchool=id=>{const s=schoolById(id);if(s?.external)summary(s);else baseOpen(id)};
  showPopup=id=>{const s=schoolById(id);if(s?.external)summary(s);else basePopup(id)};
  function switchMarkup(){return `<button type="button" class="${mode==='real'?'active':''}" aria-pressed="${mode==='real'}" onclick="setSchoolSource('real')">真實園所 ${real.length} 間</button><button type="button" class="${mode==='demo'?'active':''}" aria-pressed="${mode==='demo'}" onclick="setSchoolSource('demo')">示範資料 ${schools.filter(s=>!s.external).length} 間</button><small>基本資料為公開資料；財務與事件加分為示範試算，非官方評分。</small>`;}
  window.setSchoolSource=m=>{if(m===mode)return;mode=m;filters.district='';filters.risk='';metric='';render()};
  overview=()=>{
    baseOverview();const el=document.getElementById('source-switch');if(el&&real.length)el.innerHTML=switchMarkup();
    const note=document.querySelector('.map-chip');if(note)note.textContent='底圖 © OpenStreetMap 貢獻者 · '+(mode==='real'?'真實園所位置':'示範園所位置');
  };
  const baseRender=render;
  render=()=>{baseRender();if(page==='data'&&real.length){const heading=document.querySelector('#page .heading');const box=document.createElement('div');box.className='source-switch';box.style.marginBottom='16px';box.innerHTML=switchMarkup();heading.after(box)}};
  function summary(s){
    const a=Y.assessment(s.id);
    openModal('園所風險摘要',`<div class="real-detail"><h2>${esc(s.name)}</h2><p class="muted">${esc(s.type)} · ${esc(s.district)} · 核定 ${s.capacity} 人<br>${esc(s.address)}</p><div class="compare"><div><small>綜合風險分數</small><strong class="${cls(s)}">${s.complete<60?'—':a.score}</strong><span class="pill ${cls(s)}">${level(s)}</span></div><div><small>資料完整度</small><strong>${s.complete}%</strong></div></div><h3 style="margin-top:16px">分數組成</h3>${DIMS.map(([k,label])=>{const rows=a.rows.filter(r=>r.dimension===label&&r.enabled),max=rows.reduce((n,r)=>n+r.weight,0),score=rows.reduce((n,r)=>n+r.contribution,0);return `<div class="bar-row"><span>${label}<small style="display:block">權重 ${max}%</small></span><div class="bar"><i style="width:${s.complete<60?0:Math.max(0,Math.min(100,max?score/max*100:0))}%"></i></div><span>${s.complete<60?'待補':Math.round(score*100)/100+' 分'}</span></div>`}).join('')}<div class="notice" style="margin-top:18px">財務與事件數值為合成示範。分數由目前規則即時計算，僅供展示查核流程。</div><div class="form-actions"><button onclick="closeModal()">關閉</button><button class="primary" onclick="closeModal();go('detail',${esc(JSON.stringify(s.id))})">查看更多 →</button></div></div>`);
  }
  detail=()=>{
    baseDetail();const s=schoolById(selected);if(!s?.external)return;
    const card=document.querySelector('.detail-grid .panel');
    card.insertAdjacentHTML('afterend',`<section class="panel"><div class="panel-head"><h2>教育部評鑑紀錄</h2><button onclick="Y.evaluations(${esc(JSON.stringify(s.id))})">查看／上傳／下載評鑑</button></div><div class="pad real-detail">${s.evaluations.map(e=>`<p>${esc(e.year||'')} 學年度：${esc(e.result||'')}${e.date?'（'+esc(e.date)+'）':''}</p>`).join('')||'<p class="muted">公開資料尚無評鑑紀錄，可上傳文件補充。</p>'}<div class="domains">${s.domains.map(d=>`<span class="${d.status==='failed'?'failed':''}">${esc(d.name)}：${esc(d.label||'')}</span>`).join('')}</div><small>來源：教育部全國教保資訊網；財務與事件分數另採 Demo 情境資料。</small></div></section>`);
  };
  fetch(API,{headers:{accept:'application/json'}}).then(r=>{if(!r.ok)throw Error(r.status);return r.json()}).then(body=>{
    real=(Array.isArray(body)?body:body.data||[]).map(normalize).filter(s=>s.name&&hasCoords(s));if(!real.length)return;
    Y.registerExternalSchools(real);mode='real';
    document.querySelector('.topline .demo').textContent=`公開園所 ${real.length} 間 · 財務／事件為示範試算`;
    render();
  }).catch(e=>console.info('園所 API 未就緒，使用示範資料：',e));
})();
