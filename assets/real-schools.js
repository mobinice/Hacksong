/* 真實園所模式：讀取後端 /api/schools（同步自教育部全國教保資訊網），
   風險總覽的地圖、清單、摘要卡與詳情彈窗改用真實園所資料。
   內建 22 間示範園所仍保留，供規則引擎、資料工作台、查核流程等展示使用；
   API 不可用時自動停留在示範資料，畫面不會空白。 */
(function(){
  if(window.officialMode)return;
  const API='/api/schools';
  let real=[],mode='demo';
  const DIMS=[['compliance','法遵／裁罰／評鑑'],['finance','財務／收費'],['consistency','資料一致性'],['sentiment','輿情預警']];

  function shortName(name,district){let n=String(name||'').replace(/^新北市/,'');if(district)n=n.replace(district,'');n=n.replace(/國民小學附設幼兒園$/,'國小附幼').replace(/附設幼兒園$/,'附幼');return n.length>12?n.slice(0,11)+'…':n}
  const anomalous=s=>s.domains.some(d=>d.status==='failed')||s.evidences.some(e=>/高/.test(e.impact||''));
  function normalize(r){
    const c=Array.isArray(r.coordinates)?r.coordinates:[r.lat,r.lng];
    const score=r.totalScore==null?null:Number(r.totalScore);
    const incomplete=r.riskLevel==='incomplete'||score==null;
    let complete=Number(r.completeness)||0;if(incomplete)complete=Math.min(complete,59);
    return {id:String(r.id),external:true,name:String(r.name||'未命名園所'),district:String(r.district||''),
      address:String(r.address||'').replace(/\[\d+\]/,''),short:shortName(r.name,r.district),lat:Number(c?.[0]),lng:Number(c?.[1]),
      type:r.type||'未提供',capacity:Number(r.capacity)||0,score:score??0,incomplete,complete,trend:0,
      factors:Array.isArray(r.keyFactors)?r.keyFactors:[],scores:r.scores||{},domains:Array.isArray(r.domainsStatus)?r.domainsStatus:[],
      evaluations:Array.isArray(r.evaluations)?r.evaluations:[],evidences:Array.isArray(r.detailedEvidences)?r.detailedEvidences:[],
      checklist:Array.isArray(r.aiChecklist)?r.aiChecklist:[],notes:r.auditNotes||'',sourceUrl:r.sourceUrl||'',
      telephone:r.telephone||'',auditStatus:r.auditStatus||'',auditDue:r.auditDueDate||'',caseId:r.caseId||''};
  }

  /* 覆寫資料層入口 */
  const baseActive=activeSchools,baseDistricts=activeDistricts,baseFind=findSchool,baseOpen=openSchool;
  activeSchools=()=>mode==='real'?real:baseActive();
  activeDistricts=()=>mode==='real'?[...new Set(real.map(s=>s.district))].filter(Boolean):baseDistricts();
  findSchool=id=>mode==='real'?real.find(s=>s.id===String(id)):baseFind(id);
  openSchool=id=>{const s=mode==='real'?real.find(s=>s.id===String(id)):null;if(s)openRealDetail(s);else baseOpen(id)};

  /* 覆寫判斷函式：真實園所沒有前端規則引擎的原始觀測值，等級直接依後端分數與門檻 */
  const baseLevel=level,baseCls=cls,baseReasons=reasons,baseList=listData,baseOverview=overview,baseUpdate=updateResults;
  updateResults=()=>{baseUpdate();if(mode!=='real')return;const rows=listData();document.querySelectorAll('#results .school-row').forEach((el,i)=>{const s=rows[i];if(!s)return;const sm=el.querySelector('small');if(sm)sm.textContent=`${status(s)} · 資料完整度 ${s.complete}%`;const sc=el.querySelector('.score');if(sc)sc.textContent=s.incomplete?'—':s.score})};
  const thresholds=()=>Array.isArray(db?.thresholds)&&db.thresholds.length===3?db.thresholds:[40,60,75];
  level=s=>{if(!(s&&s.external))return baseLevel(s);if(s.incomplete)return '資料不足';const t=thresholds();return s.score>=t[2]?'高風險':s.score>=t[1]?'中高風險':s.score>=t[0]?'中風險':'低風險'};
  cls=s=>s&&s.external?(s.incomplete?'unknown':level(s)==='高風險'?'high':level(s)==='低風險'?'low':'mid'):baseCls(s);
  reasons=s=>s&&s.external?(s.factors.length?s.factors:['目前公開資料未見風險因子']).map(t=>({title:t,summary:'',source:'教育部全國教保資訊網'})):baseReasons(s);
  listData=()=>{
    if(mode!=='real')return baseList();
    return real.filter(s=>(!filters.q||(s.name+s.address).includes(filters.q))
      &&(!filters.district||s.district===filters.district)
      &&(!filters.risk||level(s)===filters.risk)
      &&(!metric||(metric==='high'?level(s)==='高風險':metric==='rising'?anomalous(s):metric==='pending'?status(s)==='待查核':s.incomplete)))
      .sort((a,b)=>filters.sort==='complete'?a.complete-b.complete:b.score-a.score);
  };
  overview=()=>{
    baseOverview();
    const cards=document.querySelectorAll('.metrics .metric');
    if(mode==='real'&&cards.length>=4){
      const strong1=cards[1].querySelector('strong'),strong3=cards[3].querySelector('strong');
      if(strong1)strong1.innerHTML=`${real.filter(anomalous).length}<small> 間</small>`;
      if(strong3)strong3.innerHTML=`${real.filter(s=>s.incomplete).length}<span> 間</span>`;
      const sub1=cards[1].querySelectorAll('small')[1];if(sub1)sub1.textContent='評鑑有待改善類別或高影響事證';
    }
    renderSwitch();
  };

  function renderSwitch(){
    const el=document.getElementById('source-switch');if(!el)return;
    if(!real.length){el.innerHTML='';return}
    el.innerHTML=`<button type="button" class="${mode==='real'?'active':''}" aria-pressed="${mode==='real'}" onclick="setSchoolSource('real')">真實園所 ${real.length} 間</button><button type="button" class="${mode==='demo'?'active':''}" aria-pressed="${mode==='demo'}" onclick="setSchoolSource('demo')">示範資料 ${schools.length} 間</button><small>${mode==='real'?'資料同步自教育部全國教保資訊網，座標為真實園所位置。':'示範資料用於展示規則設定與查核流程。'}</small>`;
  }
  window.schoolSource=()=>({mode,count:real.length});
  window.setSchoolSource=m=>{if(m===mode)return;mode=m;filters.district='';filters.risk='';metric='';overview()};

  function openRealDetail(s){
    const lv=level(s),c=cls(s);
    const dims=DIMS.map(([k,label])=>{const d=s.scores[k]||{};const sc=Number(d.score)||0,max=Number(d.max)||1;return `<div class="bar-row"><span>${esc(d.label||label)}</span><div class="bar"><i style="width:${Math.min(100,sc/max*100)}%"></i></div><span>${s.incomplete?'待補':sc+' / '+max}</span></div>`}).join('');
    const domains=s.domains.length?`<h3>評鑑六大類別</h3><div class="domains">${s.domains.map(d=>`<span class="${d.status==='failed'?'failed':''}">${esc(d.name)}：${esc(d.label||'')}</span>`).join('')}</div>`:'';
    const evals=s.evaluations.length?`<h3>教育部評鑑紀錄</h3><ul>${s.evaluations.map(e=>`<li>${esc(e.year||'')} 學年度：${esc(e.result||'')}${e.date?`（${esc(e.date)}）`:''}</li>`).join('')}</ul>`:'';
    const evid=s.evidences.length?`<h3>判斷依據</h3><ul>${s.evidences.map(e=>`<li><b>${esc(e.title||'')}</b>｜${esc(e.rule||'')}<br><small>${esc(e.observed||'')} · 來源：${esc(e.source||'')} · ${esc(e.impact||'')}</small></li>`).join('')}</ul>`:'';
    const check=s.checklist.length?`<h3>AI 建議查核項目 <small class="muted">（由後端 Bedrock 產生，僅供承辦人參考）</small></h3><ul>${s.checklist.map(i=>`<li>${i.checked?'☑':'☐'} ${esc(i.text||'')}</li>`).join('')}</ul>`:'';
    openModal('園所風險詳情（真實資料）',`<div class="real-detail">
      <h2 style="margin:0 0 4px">${esc(s.name)} <span class="pill ${c}">${lv}</span></h2>
      <p class="muted" style="font-size:13px">${esc(s.type)} · ${esc(s.district)} · 核定 ${s.capacity} 人${s.telephone?` · ${esc(s.telephone)}`:''}<br>${esc(s.address)}</p>
      <div class="compare" style="margin-top:12px"><div><small>綜合風險分數</small><strong class="${c}">${s.incomplete?'—':s.score}</strong></div><div><small>資料完整度</small><strong>${s.complete}%</strong></div><div><small>案件狀態</small><strong style="font-size:16px">${esc(s.auditStatus||status(s))}</strong></div></div>
      <div class="dims">${dims}</div>
      <h3>主要風險因子</h3><ul>${reasons(s).map(r=>`<li>${esc(r.title)}</li>`).join('')}</ul>
      ${domains}${evals}${evid}${check}
      ${s.notes?`<div class="notice" style="margin-top:14px">${esc(s.notes)}</div>`:''}
      <p class="muted" style="font-size:12px;margin-top:12px">風險分數僅供查核排序，不是違法認定。${s.sourceUrl?`<a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">查看教育部原始資料 ↗</a>`:''}</p>
      <div class="form-actions"><button onclick="closeModal()">關閉</button><button class="primary" onclick="closeModal();locateSchool(${JSON.stringify(s.id)})">在地圖上定位</button></div>
    </div>`);
  }
  window.locateSchool=id=>{const s=findSchool(id);if(!s||!hasCoords(s))return;if(page!=='overview')go('overview');if(typeof leafMap!=='undefined'&&leafMap){leafMap.flyTo([s.lat,s.lng],16,{duration:.8});setTimeout(()=>showPopup(s.id),900)}};

  fetch(API,{headers:{accept:'application/json'}}).then(r=>r.ok?r.json():Promise.reject(r.status)).then(body=>{
    const rows=Array.isArray(body)?body:Array.isArray(body?.data)?body.data:[];
    real=rows.map(normalize).filter(s=>s.name&&hasCoords(s));
    if(!real.length)return;
    mode='real';
    const top=document.querySelector('.topline .demo');if(top)top.textContent=`真實園所 ${real.length} 間（教育部教保資訊網）· 分數僅供查核排序`;
    if(page==='overview')overview();
  }).catch(e=>console.info('園所 API 未就緒，使用示範資料：',e));
})();
