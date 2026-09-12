/* The workbench, risk overview and audit queue share the same official school keys. */
(()=>{
  let riskPage=0,queuePage=0,queueQuery='',queueDistrict='';
  const pageSize=25;
  const pageControls=(page,count,action)=>`<div class="toolbar pad"><button onclick="${action}(-1)" ${page===0?'disabled':''}>上一頁</button><span>第 ${page+1}／${Math.max(1,Math.ceil(count/pageSize))} 頁 · 共 ${count} 筆</span><button onclick="${action}(1)" ${(page+1)*pageSize>=count?'disabled':''}>下一頁</button></div>`;
  listData=()=>schools.filter(s=>workspaceMatches(s,filters.q)&&(!filters.district||s.district===filters.district)&&(!filters.risk||level(s)===filters.risk)&&(!metric||(metric==='high'?level(s)==='高風險':metric==='rising'?s.anomalies>0:metric==='pending'?!db.reviews[s.id]?.saved:s.complete<60))).sort((a,b)=>filters.sort==='complete'?a.complete-b.complete:(b.anomalies-a.anomalies)||(b.score-a.score));
  Y.riskNext=delta=>{riskPage+=delta;updateResults();};
  setFilter=(key,value)=>{filters[key]=value;riskPage=0;updateResults();};
  overview=()=>{
    $('#page').innerHTML=`<div class="heading"><div><h1>風險總覽</h1><p>新北市真實園所 · 最近公開評鑑與可評估資料</p></div><button onclick="go('data')">園所資料工作台</button></div>
      <div class="metrics">${[['high','高風險園所',schools.filter(s=>level(s)==='高風險').length],['rising','有已知異常',schools.filter(s=>s.anomalies>0).length],['pending','待人工覆核',schools.filter(s=>!db.reviews[s.id]?.saved).length],['missing','資料不足',schools.filter(s=>s.complete<60).length]].map(([key,title,count])=>`<button class="metric ${metric===key?'active':''}" onclick="setMetric('${key}')"><span>${title}</span><strong>${count}</strong><small>${key==='rising'?'保留已知異常，其他構面仍可能缺資料':'依目前來源及人工工作紀錄統計'}</small></button>`).join('')}</div>
      <div class="notice">完整度依可評估規則權重計算；缺少裁罰、財務及輿情資料時顯示「資料不足」。評鑑通過不代表整體低風險。最近公開評鑑的原始日期可在詳情查閱。</div>
      <div class="panel" style="margin-top:18px"><div class="filters"><input class="search" aria-label="搜尋園所或地址" placeholder="搜尋園名、地址或識別碼" value="${esc(filters.q)}" oninput="setFilter('q',this.value)"><select aria-label="行政區" onchange="setFilter('district',this.value)">${options(['全部行政區',...districts],filters.district,true)}</select><select aria-label="風險等級" onchange="setFilter('risk',this.value)">${options(['全部風險','高風險','中高風險','中風險','低風險','資料不足'],filters.risk,true)}</select><button onclick="resetFilters()">清除篩選</button></div><div id="results"></div></div>`;
    updateResults();
  };
  updateResults=()=>{
    const all=listData();riskPage=Math.max(0,Math.min(riskPage,Math.ceil(all.length/pageSize)-1));
    $('#results').innerHTML=`<div class="table-wrap"><table><thead><tr><th>園所／行政區</th><th>最近公開評鑑</th><th>風險／完整度</th><th>人工覆核</th></tr></thead><tbody>${all.slice(riskPage*pageSize,(riskPage+1)*pageSize).map(s=>`<tr><td><button class="link" onclick="go('detail',${s.id})">${esc(s.name)}</button><br><small>${esc(s.district)} · ${esc(schoolLabel(s))}</small></td><td>${esc(s.latestEvaluation?.result||'未提供')}<br><small>${esc(s.latestEvaluation?.date||'')} · ${s.evaluations?.length||0} 筆歷史</small></td><td><span class="pill ${cls(s)}">${level(s)}</span><br><small>可評估 ${s.complete}% · ${s.anomalies} 項已知異常</small></td><td>${esc(status(s))}<br><button class="link" onclick="go('detail',${s.id})">查看資料與覆核</button></td></tr>`).join('')||'<tr><td colspan="4">沒有符合的園所。</td></tr>'}</tbody></table></div>${pageControls(riskPage,all.length,'Y.riskNext')}`;
  };
  const baseDetail=detail;
  detail=()=>{
    baseDetail();const s=schoolById(selected);
    if(s.officialId){const button=document.createElement('button');button.textContent='查看官方欄位與評鑑報告';button.onclick=()=>officialSchoolDetail(s.id);$('#page .heading').append(button);}
  };
  const uploadedEvaluations=Y.evaluations;
  Y.evaluations=(id,year)=>schoolById(id)?.officialId?officialSchoolDetail(id):uploadedEvaluations(id,year);
  const baseAudit=auditPage;
  auditPage=()=>{
    baseAudit();const panel=document.createElement('section');panel.className='panel';panel.style.marginTop='20px';
    panel.innerHTML=`<div class="panel-head"><div><h2>真實園所待覆核清單</h2><p>選取園所確認資料並儲存人工覆核後，建立可追蹤的案件。</p></div></div><div class="filters"><input class="search" aria-label="搜尋待覆核園所" placeholder="園名、地址或識別碼" value="${esc(queueQuery)}" oninput="Y.queueFilter('q',this.value)"><select aria-label="待覆核行政區" onchange="Y.queueFilter('district',this.value)">${options(['全部行政區',...districts],queueDistrict,true)}</select></div><div id="official-audit-queue"></div>`;
    $('#page').append(panel);drawQueue();
  };
  Y.queueFilter=(key,value)=>{if(key==='q')queueQuery=value;else queueDistrict=value;queuePage=0;drawQueue();};
  Y.queueNext=delta=>{queuePage+=delta;drawQueue();};
  function drawQueue(){
    const all=schools.filter(s=>!db.reviews[s.id]?.saved&&workspaceMatches(s,queueQuery)&&(!queueDistrict||s.district===queueDistrict));
    queuePage=Math.max(0,Math.min(queuePage,Math.ceil(all.length/pageSize)-1));
    $('#official-audit-queue').innerHTML=`<div class="table-wrap"><table><thead><tr><th>園所</th><th>行政區／地址</th><th>資料狀態</th><th>操作</th></tr></thead><tbody>${all.slice(queuePage*pageSize,(queuePage+1)*pageSize).map(s=>`<tr><td>${esc(s.name)}<br><small>${esc(schoolLabel(s))}</small></td><td>${esc(s.district)}<br><small>${esc(s.address)}</small></td><td>${level(s)}</td><td><button onclick="go('detail',${s.id})">開始覆核</button></td></tr>`).join('')||'<tr><td colspan="4">沒有符合的待覆核園所。</td></tr>'}</tbody></table></div>${pageControls(queuePage,all.length,'Y.queueNext')}`;
  }
  functionHelp.sources.note='官方名錄與評鑑使用已下載快照；其他資料未提供時保留缺值。';
})();
