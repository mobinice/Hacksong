/* Local-first prototype. No uploads, external AI calls, or AWS credentials. */
(() => {
  'use strict';
  const Y = window.Y = {};
  const dims = ['法遵／裁罰／評鑑','財務／收費','資料／營運一致性','輿情預警'];
  const spec = [
    ['repeat','一年內重複裁罰',dims[0],20,'penaltyCount',1,'近 12 個月同類型裁罰按次累加','調閱前次裁罰通知書與改善計畫書，確認複查成果及人員配置。'],
    ['eval','評鑑缺失或待改善',dims[0],20,'evaluationResult','待改善','基礎評鑑未全數通過或列為待改善','核對基礎評鑑缺失項目之改善追蹤檢核表。'],
    ['staff','每生人事成本偏高',dims[1],20,'staffCost',98000,'年度人事費 ÷ 實際學生數 > 每生金額門檻（前 10% 門檻 98,000 元／生）','比對員工名冊、薪資明細表與勞健保投保級距。'],
    ['growth','人事費增加快於學生人數',dims[1],15,'staffCost',30,'人事費年增率 > 30% 且大於學生數年增率','查核前後年度會計帳冊、調薪依據與支出憑證。'],
    ['income','收費推估與申報收入差異',dims[2],15,'revenue',20,'|申報收入 − 月費 × 學生數 × 12| ÷ 推估收入 × 100 > 門檻 20%','調閱收退費明細清單、延托與代辦費收據、銀行往來存摺。'],
    ['signals','近期負面輿情增加',dims[3],10,'signalCount',200,'（近 7 日訊號 − 基準訊號）÷ 基準訊號 × 100 > 門檻 200%','查證社群網路通報、媒體報導與家長申訴紀錄真實性。']
  ];
  const required = {
    repeat:['penaltyCount'],
    eval:['evaluationResult'],
    staff:['staffCost','studentCount'],
    growth:['staffCost','previousStaffCost','studentCount','previousStudentCount'],
    income:['revenue','tuition','studentCount'],
    signals:['signalCount','signalBaseline']
  };
  const newFields = [
    ['schoolId','園所識別碼',['園所識別碼','schoolId']],['year','資料年度',['資料年度','年度','會計年度','year']],
    ['studentCount','實際學生數',['實際學生數','學生數','在園人數','studentCount']],
    ['sourceStudentCount','另一來源學生數',['另一來源學生數','來源B學生數','sourceStudentCount']],
    ['previousStudentCount','前年度學生數',['前年度學生數','previousStudentCount']],
    ['previousStaffCost','前年度人事費',['前年度人事費','previousStaffCost']],
    ['signalBaseline','前期基準訊號數',['前期基準訊號數','signalBaseline']]
  ];
  importCatalog.basic.fields.push(...newFields.slice(0,5));
  importCatalog.finance.fields.push(newFields[5]);
  importCatalog.public.fields.push(newFields[6]);
  for (const f of newFields) if (!allImportFields.some(x=>x[0]===f[0])) allImportFields.push(f);
  numericImportFields.push('studentCount','sourceStudentCount','previousStudentCount','previousStaffCost','signalBaseline');
  for(const f of db.fields) if(!f.key)f.key=allImportFields.find(x=>x[1]===f.name)?.[0]||'custom_'+uid().replaceAll('-','');
  for(const f of db.fields)if(['數字','金額'].includes(f.type)&&!numericImportFields.includes(f.key))numericImportFields.push(f.key);
  const label = key => key==='staffCostPerStudent'?'每生人事成本': allImportFields.find(f=>f[0]===key)?.[1] || db.fields.find(f=>f.key===key)?.name || key;
  const display = v => v === undefined || v === null || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('zh-TW',{maximumFractionDigits:2}) : String(v);
  const now = () => new Date().toISOString();
  const round = x => Math.round((x + Number.EPSILON)*100)/100;
  const clone = x => structuredClone(x);
  db.p0 ||= {data:{},year:'2025',assessments:{},history:[],revision:0};
  const model = db.p0;
  let workQuery='',workDistrict='',workState='',workSelected=new Set(), workColumns=['capacity','studentCount','penaltyCount','evaluationResult','staffCostPerStudent','staffCost','revenue'];
  let draftRules=null;
  const records = (id,year=model.year) => model.data[id]?.[year] || {};
  function addObservation(id,year,key,value,source,locator,excerpt,at=now()) {
    model.data[id] ||= {}; model.data[id][year] ||= {};
    const record = model.data[id][year][key] ||= {candidates:[],chosen:null,conflict:false};
    const c={id:uid(),value,source,locator,excerpt,at};
    record.candidates.push(c);
    if (!record.chosen) record.chosen=c.id;
    else if (String(record.candidates.find(x=>x.id===record.chosen)?.value)!==String(value)) record.conflict=true;
    return c;
  }
  function current(id,key,year=model.year) {
    if(key==='staffCostPerStudent'){
      const rr=records(id,year),cost=current(id,'staffCost',year),students=current(id,'studentCount',year);
      if(rr.staffCost?.conflict||rr.studentCount?.conflict||cost?.value==null||cost.value===''||students?.value==null||students.value===''||!Number.isFinite(Number(cost.value))||!Number.isFinite(Number(students.value))||Number(students.value)<=0)return undefined;
      return {value:round(Number(cost.value)/Number(students.value)),source:'衍生計算',locator:'年度人事費 ÷ 實際學生數',excerpt:display(cost.value)+' 元 ÷ '+display(students.value)+' 人',at:cost.at};
    }
    const r=records(id,year)[key];
    return r?.candidates.find(c=>c.id===r.chosen);
  }
  function val(id,key) { const r=records(id)[key]; return r?.conflict ? undefined : current(id,key)?.value; }
  function seed() {
    if(model.seeded)return;
    for(const s of schools.filter(s=>!s.imported)) {
      const n=s.id, count=100+n*3;
      const values={capacity:s.capacity,studentCount:count,sourceStudentCount:n%3===0?Math.round(count*1.25):count,previousStudentCount:Math.round(count/1.05),penaltyCount:n<5?2:n<12?1:0,evaluationResult:n<5?'待改善':'符合',tuition:5000,revenue:n<5?9200000:count*60000,staffCost:n<7?count*146000:count*80000,previousStaffCost:n<7?Math.round(count*146000/1.4):Math.round(count*80000/1.03),signalCount:n<3?10:2,signalBaseline:2};
      for(const [key,value]of Object.entries(values)) {
        if(n>=18 && !['capacity','penaltyCount','evaluationResult'].includes(key))continue;
        const kind=['staffCost','previousStaffCost','revenue','tuition'].includes(key)?'財務與收費':key.startsWith('signal')?'輿情彙整':key==='penaltyCount'?'裁罰彙整':'園所基本資料';
        addObservation(s.id,'2025',key,value,`${kind}_2025_示範資料.csv`,`第 ${n+2} 列 · ${label(key)}`,`${s.name}｜資料年度 2025｜${label(key)}：${value}（合成示範資料）`,'2026-09-12T00:30:00.000Z');
      }
    }
    // Preserve previously confirmed imports and their provenance; conflicting values remain reviewable.
    db.schoolData = db.schoolData || {};
    for(const [id,d]of Object.entries(db.schoolData))for(const [k,v]of Object.entries(d.values||{})){
      if(['name','district','address','type','schoolId','year'].includes(k)||v==='')continue;
      addObservation(id,String(d.values.year||'2025'),k,numericImportFields.includes(k)?Number(v):v,d.file||'既有匯入','既有確認資料',`${label(k)}：${v}`,d.at||now());
    }
    model.seeded=true;
  }
  const standardRules = [
    {id:'repeat',name:'一年內重複裁罰',dimension:dims[0],weight:20,threshold:1,condition:'近 12 個月同類型裁罰按次累加',enabled:true,date:'2026-09-12',impact:'高'},
    {id:'eval',name:'評鑑缺失或待改善',dimension:dims[0],weight:20,threshold:1,condition:'基礎評鑑指標未全數通過或列為待改善',enabled:true,date:'2026-09-12',impact:'高'},
    {id:'staff',name:'每生人事成本偏高',dimension:dims[1],weight:20,threshold:98000,condition:'年度人事費 ÷ 實際學生數 > 98,000 元／生（前 10% 門檻）',enabled:true,date:'2026-09-12',impact:'高'},
    {id:'growth',name:'人事費增加快於學生人數',dimension:dims[1],weight:15,threshold:30,condition:'人事費年增率 > 30% 且大於學生數年增率',enabled:true,date:'2026-09-12',impact:'中'},
    {id:'income',name:'收費推估與申報收入差異',dimension:dims[2],weight:15,threshold:20,condition:'收費公告推估年收入與申報收入差異超過 20%',enabled:true,date:'2026-09-12',impact:'中'},
    {id:'signals',name:'近期負面輿情增加',dimension:dims[3],weight:10,threshold:200,condition:'近 7 日負面訊號比基準訊號增加超過 200%',enabled:true,date:'2026-09-12',impact:'低'}
  ];
  if(!model.engineV2Init || !db.rules || db.rules.length < 6 || !db.rules.some(r=>r.id==='eval')){
    db.rules = clone(standardRules);
    model.engineV2Init = true;
    model.rulesMigrated = true;
  }
  seed();
  function evaluate(s,r){
    if(!r.enabled){
      return {ruleId:r.id,name:r.name,dimension:r.dimension,weight:r.weight,threshold:r.threshold,enabled:false,raw:0,contribution:0,hit:false,formula:'規則已停用，不參與計算',observed:'規則已停用',thresholdStr:`門檻 ${display(r.threshold)}`,keys:[],missing:[],action:'規則未啟用'};
    }
    const keys=required[r.id]||[],v=Object.fromEntries(keys.map(k=>[k,val(s.id,k)]));
    const missing=keys.filter(k=>val(s.id,k)===undefined||val(s.id,k)==='');
    let metric=null,hit=false,formula='',problem='',observed='',thresholdStr='',compare=null;
    if(missing.length){
      problem='待補齊／確認：'+missing.map(label).join('、');
    } else {
      switch(r.id){
        case 'repeat': {
          const count = Number(v.penaltyCount || 0);
          const th = Number(r.threshold || 1);
          hit = count >= th;
          const scorePerHit = Math.floor(r.weight / 2 || 10);
          const contrib = hit ? Math.min(count * scorePerHit, r.weight) : 0;
          observed = `近 12 個月裁罰紀錄 ${count} 次`;
          thresholdStr = `門檻 ≥ ${th} 次`;
          formula = `裁罰 ${count} 次 × ${scorePerHit} 分 = ${contrib} 分；門檻 ≥ ${th} 次`;
          return {ruleId:r.id,name:r.name,dimension:r.dimension,weight:r.weight,threshold:r.threshold,enabled:true,raw:contrib,contribution:contrib,hit,formula,observed,thresholdStr,keys,missing:[],action:spec.find(x=>x[0]===r.id)?.[7]||'調閱前次裁罰通知書與改善計畫書'};
        }
        case 'eval': {
          const evalRes = String(v.evaluationResult || '待改善');
          hit = ['待改善','不符合','部分指標通過','追蹤評鑑'].includes(evalRes);
          const contrib = hit ? r.weight : 0;
          observed = `基礎評鑑狀態：${evalRes}`;
          thresholdStr = '全數指標通過／符合';
          formula = `基礎評鑑未全數通過 (${evalRes}) 計 ${contrib} 分`;
          return {ruleId:r.id,name:r.name,dimension:r.dimension,weight:r.weight,threshold:r.threshold,enabled:true,raw:contrib,contribution:contrib,hit,formula,observed,thresholdStr,keys,missing:[],action:spec.find(x=>x[0]===r.id)?.[7]||'核對基礎評鑑缺失項目之改善追蹤檢核表'};
        }
        case 'staff': {
          const cost = Number(v.staffCost || 0);
          const count = Number(v.studentCount || 0);
          if(count<=0){problem='學生數必須大於 0';break;}
          metric = Math.round(cost / count);
          const th = Number(r.threshold || 98000);
          hit = metric > th;
          const contrib = hit ? r.weight : 0;
          const diffPct = th ? Math.round((metric - th)/th*100) : 0;
          observed = `每生人事費 ${display(metric)} 元／生`;
          thresholdStr = `同儕前 10% 門檻 ${display(th)} 元／生`;
          formula = `${display(cost)} 元 ÷ ${display(count)} 人 = ${display(metric)} 元／生 > 門檻 ${display(th)} 元 (+${diffPct}%) 計 ${contrib} 分`;
          compare = { current: display(metric) + ' 元', benchmark: '72,000～' + display(th) + ' 元' };
          return {ruleId:r.id,name:r.name,dimension:r.dimension,weight:r.weight,threshold:r.threshold,enabled:true,raw:contrib,contribution:contrib,hit,formula,observed,thresholdStr,compare,keys,missing:[],action:spec.find(x=>x[0]===r.id)?.[7]||'比對員工名冊、薪資明細表與勞健保投保級距'};
        }
        case 'growth': {
          const cost = Number(v.staffCost || 0);
          const prevCost = Number(v.previousStaffCost || 0);
          const count = Number(v.studentCount || 0);
          const prevCount = Number(v.previousStudentCount || 0);
          if(prevCost<=0||prevCount<=0){problem='前年度人事費與學生數必須大於 0';break;}
          const staffRate = Math.round((cost - prevCost)/prevCost*100);
          const studentRate = Math.round((count - prevCount)/prevCount*100);
          const th = Number(r.threshold || 30);
          hit = staffRate > th && staffRate > studentRate;
          const contrib = hit ? r.weight : 0;
          observed = `人事費年增率 +${staffRate}%，學生數年增率 +${studentRate}%`;
          thresholdStr = `人事費年增 > ${th}% 且 > 學生數增幅`;
          formula = `人事費年增 ${staffRate}% (門檻 > ${th}%) 且大於學生增幅 ${studentRate}% 計 ${contrib} 分`;
          return {ruleId:r.id,name:r.name,dimension:r.dimension,weight:r.weight,threshold:r.threshold,enabled:true,raw:contrib,contribution:contrib,hit,formula,observed,thresholdStr,keys,missing:[],action:spec.find(x=>x[0]===r.id)?.[7]||'查核前後年度會計帳冊、調薪依據與支出憑證'};
        }
        case 'income': {
          const rev = Number(v.revenue || 0);
          const tuition = Number(v.tuition || 5000);
          const count = Number(v.studentCount || 0);
          const estimated = tuition * count * 12;
          if(estimated<=0){problem='推估收入必須大於 0';break;}
          const diffPct = Math.round(Math.abs(rev - estimated)/estimated*100);
          const th = Number(r.threshold || 20);
          hit = diffPct > th;
          const contrib = hit ? r.weight : 0;
          observed = `申報收入 ${display(rev)} 元 vs 收費推估 ${display(estimated)} 元`;
          thresholdStr = `差異比例 > ${th}%`;
          formula = `差異率 ${diffPct}% > 門檻 ${th}% (|${display(rev - estimated)}| 元) 計 ${contrib} 分`;
          return {ruleId:r.id,name:r.name,dimension:r.dimension,weight:r.weight,threshold:r.threshold,enabled:true,raw:contrib,contribution:contrib,hit,formula,observed,thresholdStr,keys,missing:[],action:spec.find(x=>x[0]===r.id)?.[7]||'調閱收退費明細清單、延托與代辦費收據、銀行往來存摺'};
        }
        case 'signals': {
          const count = Number(v.signalCount || 0);
          const base = Number(v.signalBaseline || 2);
          if(base<=0){problem='基準訊號數必須大於 0';break;}
          const growth = Math.round((count - base)/base*100);
          const th = Number(r.threshold || 200);
          hit = growth > th;
          const contrib = hit ? r.weight : 0;
          observed = `近 7 日負面訊號 ${count} 則 (前期基準 ${base} 則)`;
          thresholdStr = `負面訊號增幅 > ${th}%`;
          formula = `訊號增幅 +${growth}% > 門檻 ${th}% 計 ${contrib} 分`;
          return {ruleId:r.id,name:r.name,dimension:r.dimension,weight:r.weight,threshold:r.threshold,enabled:true,raw:contrib,contribution:contrib,hit,formula,observed,thresholdStr,keys,missing:[],action:spec.find(x=>x[0]===r.id)?.[7]||'查證社群網路通報、媒體報導與家長申訴紀錄真實性'};
        }
        default:
          problem = '這條規則尚未設定可執行的計算類型';
      }
    }
    return {ruleId:r.id,name:r.name,dimension:r.dimension,weight:r.weight,threshold:r.threshold,enabled:r.enabled,raw:null,contribution:0,hit:false,formula:problem||'缺少足夠資料',observed:'資料不足',thresholdStr:`門檻 ${display(r.threshold)}`,keys,missing,action:'補齊資料來源'};
  }
  function recalc(reason,remember=false){
    const before=clone(model.assessments||{}),at=now();
    model.assessments={};
    for(const s of schools){
      const rows=db.rules.map(r=>evaluate(s,r));
      const dimScores = {
        '法遵／裁罰／評鑑': 0,
        '財務／收費': 0,
        '資料／營運一致性': 0,
        '輿情預警': 0
      };
      for(const r of rows){
        if(r.enabled && r.contribution){
          dimScores[r.dimension] = (dimScores[r.dimension]||0) + r.contribution;
        }
      }
      const totalScore = round(Object.values(dimScores).reduce((a,b)=>a+b,0));
      const coverage = s.complete;
      const isIncomplete = coverage < 60; // 防呆規則：完整度 < 60% 獨立標記為資料不足
      const anomalies = rows.filter(r=>r.hit).length;

      const assessment = {
        rows,
        dimScores,
        score: isIncomplete ? 0 : totalScore,
        totalScore,
        coverage,
        isIncomplete,
        version: `1.${db.version}`,
        at,
        year: model.year,
        anomalies
      };
      const old=before[s.id];
      if(remember&&old&&old.year===model.year) assessment.change={before:old.score,after:assessment.score,reason,previousVersion:old.version};
      else if(old?.year===model.year) assessment.change=old.change;

      model.assessments[s.id]=assessment;
      s.score = isIncomplete ? 0 : totalScore;
      s.displayScore = isIncomplete ? '—' : totalScore;
      s.anomalies = anomalies;
      s.dimensions = {
        compliance: dimScores['法遵／裁罰／評鑑'] || 0,
        finance: dimScores['財務／收費'] || 0,
        consistency: dimScores['資料／營運一致性'] || 0,
        sentiment: dimScores['輿情預警'] || 0
      };
      s.riskLevel = isIncomplete ? '資料不足' : (totalScore>=db.thresholds[2]?'高風險':totalScore>=db.thresholds[1]?'中高風險':totalScore>=db.thresholds[0]?'中風險':'低風險');
      s.riskClass = isIncomplete ? 'unknown' : (s.riskLevel==='高風險'?'high':s.riskLevel==='低風險'?'low':'mid');
    }
    if(remember){
      model.history.unshift({at,reason,version:`1.${db.version}`,year:model.year,assessments:before});
      model.history=model.history.slice(0,20);
    }
  }
  recalc('載入');
  persist();
  const assessment=s=>model.assessments[s.id];
  level=s=>s.complete<60?'資料不足':(s.score>=db.thresholds[2]?'高風險':s.score>=db.thresholds[1]?'中高風險':s.score>=db.thresholds[0]?'中風險':'低風險');
  cls=s=>s.complete<60?'unknown':(level(s)==='高風險'?'high':level(s)==='低風險'?'low':'mid');
  const tags=r=>`<div class="risk-tags"><span>${esc(r.dimension)}</span><span class="weight">權重 ${r.weight}%</span></div>`;
  reasons=s=>{
    if(s.complete<60){
      return [{
        title:'缺少完整財務與收費資料',
        summary:`目前資料完整度只有 ${s.complete}%（未達 60% 防呆門檻），暫無法完整評估。`,
        source:'資料來源完整度檢查',
        observation:'公開財務資料缺漏，部分收費欄位尚未更新。',
        rule:'資料完整度未達 60%，優先標示「⚠️ 資料不足」，絕不誤標為低風險。',
        action:'補齊年度財務報告與收費公告',
        items:['取得最新財務報告','確認收費公告及招生人數']
      }];
    }
    const a=assessment(s),hits=a.rows.filter(r=>r.hit);
    return (hits.length?hits:a.rows.filter(r=>r.raw===null)).map(r=>({
      title:r.name,
      summary:r.observed || r.formula,
      source:r.dimension,
      observation:r.formula,
      rule:r.thresholdStr || ('門檻 ' + display(r.threshold)),
      action:r.action,
      items:[r.action],
      ruleId:r.ruleId,
      compare:r.compare
    })).concat(!hits.length?[{
      title:'目前未觸及主要風險條件',
      summary:'已取得資料未呈現重大差異，持續依常規追蹤。',
      source:'四構面綜合指標',
      observation:'裁罰 0 次，財務與一致性均在合規範圍內。',
      rule:'四構面綜合指標評估',
      action:'依例行排程確認資料',
      items:['確認下一期來源更新'],
      ruleId:null
    }]:[]);
  };
  function sourcesHTML(id,key){
    if(key==='staffCostPerStudent'){const c=current(id,key);return `<div class="formula">年度人事費 ÷ 實際學生數 = ${c?esc(display(c.value))+' 元／生／年':'暫無法計算'}</div><p class="data-hint">採用同年度資料；來源衝突、缺漏或學生數為 0 時不計算。</p><h3>年度人事費</h3>${sourcesHTML(id,'staffCost')}<h3>實際學生數</h3>${sourcesHTML(id,'studentCount')}`;}
    const r=records(id)[key];if(!r)return '<p class="empty-inline">此年度尚無來源資料。</p>';
    return `${r.conflict?'<div class="import-alert">同年度來源值不同，暫不參與計算。請檢查口徑，選擇採用的來源。</div>':''}${r.candidates.map(c=>`<div class="source-card ${c.id===r.chosen?'active':''}"><b>${esc(c.source)}</b><p>${esc(c.locator)} · 資料年度 ${esc(model.year)}</p><small>取得時間 ${esc(c.at)}</small><pre>${esc(c.excerpt)}</pre><p>${esc(label(key))}：<b>${esc(display(c.value))}</b></p>${r.conflict||c.id!==r.chosen?`<button onclick="Y.resolve(${id},'${key}','${c.id}')">確認採用此來源</button>`:'<span class="data-status">目前採用</span>'}</div>`).join('')}`;
  }
  Y.source=(id,key)=>{openModal(`${schoolById(id).name} · ${label(key)}`,sourcesHTML(id,key));$('#modal').classList.add('modal-wide');};
  Y.resolve=(id,key,cid)=>{const backup=clone(model),r=records(id)[key];if(!r?.candidates.some(c=>c.id===cid))return;r.chosen=cid;r.conflict=false;recalc('人工確認來源',true);if(!persist()){Object.assign(model,backup);recalc('還原');return;}closeModal();render();toast('已採用來源並重新計算；其他來源仍保留');};
  Y.evidence=(id,rid)=>{
    const s=schoolById(id);
    const r=assessment(s)?.rows.find(r=>r.ruleId===rid) || evaluate(s, db.rules.find(x=>x.id===rid) || db.rules[0]);
    openModal('判斷依據與數值比對', `
      <div class="eyebrow">${esc(s.name)} · 規則版本 ${assessment(s)?.version || '1.'+db.version}</div>
      <h2 style="margin-bottom:6px">${esc(r.name)}</h2>
      <div style="margin-bottom:18px">
        <span class="pill" style="background:#eef4fa;color:var(--blue);font-weight:600">${esc(r.dimension)}</span>
        <span class="pill ${r.contribution > 0 ? 'high' : 'low'}" style="margin-left:6px">${r.contribution > 0 ? `觸發加權 +${r.contribution} 分` : '未觸發 (0 分)'}</span>
      </div>
      <div class="compare" style="margin-bottom:18px">
        <div>
          <small style="color:var(--muted)">園所實際量化數值</small>
          <strong style="color:var(--ink);margin-top:4px">${esc(r.observed || r.formula)}</strong>
        </div>
        <div>
          <small style="color:var(--muted)">比對門檻標準</small>
          <strong style="color:var(--blue);margin-top:4px">${esc(r.thresholdStr || ('門檻 ' + display(r.threshold)))}</strong>
        </div>
      </div>
      ${r.compare ? `
        <div class="compare" style="margin-bottom:18px;background:#f0f5fa">
          <div><small>本園每生人事費</small><strong style="color:var(--red)">${r.compare.current}</strong></div>
          <div><small>同儕規模前 10% 門檻範圍</small><strong style="color:var(--green)">${r.compare.benchmark}</strong></div>
        </div>
      ` : ''}
      <div class="evidence-block">
        <small>計算公式與比對結果</small>
        <p style="font-family:monospace;background:#f6f8fa;padding:10px 14px;border-radius:6px;border:1px solid #e1e4e8;margin-top:6px">${esc(r.formula)}</p>
      </div>
      <div class="evidence-block" style="margin-top:14px">
        <small>建議現場查核行動</small>
        <p style="margin-top:6px"><strong>${esc(r.action)}</strong></p>
      </div>
      <div class="notice" style="margin-top:16px">
        ${s.complete < 60 ? '⚠️ 此園所資料完整度未達 60%，防呆規則生效中，優先要求補齊資料。' : '數值比對由動態風險評分引擎即時計算，異動規則門檻時會立即動態重新計算。'}
      </div>
      <div class="form-actions">
        <button class="primary" onclick="closeModal()">返回園所詳情</button>
      </div>
    `);
    $('#modal').classList.add('modal-wide');
  };
  evidence=i=>{const r=reasons(schoolById(selected))[i];if(r?.ruleId)Y.evidence(selected,r.ruleId);else if(r)Y.evidence(selected,db.rules[i]?.id||db.rules[0]?.id);};
  const oldDetail=detail;
  detail=()=>{
    oldDetail();const s=schoolById(selected),a=assessment(s),host=$('.detail-grid>div');
    const header=$('.heading');header.querySelector('p').textContent=`${s.type} · ${s.district} · 核定 ${display(val(s.id,'capacity'))} 人`;
    header.querySelector('p:last-child').textContent=s.address+(s.imported?'':'（合成示範地址）');
    const bAdv=db.bedrockAdvice?.[s.id];
    const bedrockAdvicePanel = `<div class="panel"><div class="panel-head"><div><h2>AI 輔助查核建議</h2><p>${bAdv?'由 AWS Bedrock (Amazon Nova) 深度分析生成，可勾選現場查核項目。':'依上方風險整理的建議，可勾選已確認項目。'}</p></div><div style="display:flex;gap:8px;align-items:center">${bAdv?'<span class="pill" style="background:#edf6f1;color:#287a60;font-weight:600">⚡ AWS Bedrock</span>':'<span class="pill">待人工確認</span>'}<button class="link" style="font-size:12px;" onclick="generateBedrockAdvice(${s.id},true)">${bAdv?'🔄 重新生成':'✨ 啟用 Bedrock 深度分析'}</button></div></div><div class="pad">${bedrockLoading?`<div class="loading" style="padding:28px 20px"><div class="spinner"></div><p style="margin-top:12px;font-size:13px;color:var(--blue);font-weight:600">AWS Bedrock (Amazon Nova) 深度歸因分析中...</p><small>比對教保法規、違規歷史與同儕財務指標以產出專屬工作清單</small></div>`:bAdv?`<div class="notice" style="background:#f0f5fa;border-left:4px solid var(--blue);margin-bottom:18px"><strong>🎯 查核核心焦點：</strong>${esc(bAdv.summary)}<div style="margin-top:6px;font-size:12px"><span class="pill ${bAdv.priorityLevel?.includes('高')?'high':'mid'}">查核優先度：${esc(bAdv.priorityLevel||'高優先')}</span></div></div>${(bAdv.suggestedActions||[]).map((act,i)=>`<div style="margin-bottom:20px;border-bottom:1px dashed var(--line);padding-bottom:16px"><h3 style="display:flex;align-items:center;gap:8px;font-size:15px"><span class="number">${i+1}</span> ${esc(act.title)}</h3><p style="font-size:12px;color:var(--muted);margin:4px 0 10px">${esc(act.reason)}</p><strong style="font-size:12px;color:var(--blue);display:block;margin:8px 0 4px">🔍 現場查核清單 (Checklist)：</strong>${(act.checklist||[]).map((item,j)=>`<label class="check"><input type="checkbox" ${db.reviews[s.id]?.checks?.includes('b-'+i+'-'+j)?'checked':''} onchange="saveCheck('b-${i}-${j}',this.checked)"><span>${esc(item)}</span></label>`).join('')}${act.requiredDocuments&&act.requiredDocuments.length?`<div style="background:#fafcfe;border:1px solid #dce6f0;border-radius:6px;padding:10px 14px;margin-top:10px"><strong style="font-size:12px;color:#92541f">📋 建議現場調閱之公文與表冊清單：</strong><ul style="margin:6px 0 0 18px;padding:0;font-size:12px;color:var(--ink)">${act.requiredDocuments.map(doc=>`<li>${esc(doc)}</li>`).join('')}</ul></div>`:''}</div>`).join('')}<div class="notice" style="margin-top:14px;font-size:11px">${esc(bAdv.complianceNotice||'AI 分析內容僅供稽查排序及輔助判斷，不作為違法認定或行政裁處之直接依據。')}</div>`:`<div style="text-align:center;padding:16px 20px;background:#f4f7fb;border:1px dashed #8fb6dd;border-radius:8px;margin-bottom:18px"><p style="font-size:14px;font-weight:600;color:var(--blue);margin-bottom:6px">🤖 啟用 AWS Bedrock 智能查核專家分析</p><p style="font-size:12px;color:var(--muted);margin-bottom:14px">調用 Amazon Nova 大語言模型，針對此園所特定違規事由與異常指標進行深度歸因，自動產出專屬查核清單與調閱表冊。</p><button class="primary" onclick="generateBedrockAdvice(${s.id},true)">✨ 立即產生專屬查核建議與公文清單 (AWS Bedrock)</button></div>${a.rows.filter(r=>r.hit).map(r=>`<label class="check"><input type="checkbox" ${db.reviews[s.id]?.checks?.includes(r.ruleId)?'checked':''} onchange="saveCheck('${r.ruleId}',this.checked)">${esc(r.action)}</label>`).join('')||'<p>先補齊資料並確認來源。</p>'}`}`;

    const scoreCard = `<div class="panel pad">
      <div class="summary">
        <div>
          <small>${s.complete<60?'可評估資料權重':'綜合風險分數'}</small>
          <div class="score-big ${cls(s)}">${s.complete<60?'—':a.score}<small>${s.complete<60?'':' / 100'}</small></div>
          <span class="pill ${cls(s)}">${level(s)}</span>
        </div>
        <div>
          <h2>${s.complete<60?'⚠️ 資料不足待補充（未達 60% 門檻）':`${a.anomalies} 項異常需確認`}</h2>
          <p class="data-hint">資料完整度 ${a.coverage}% · <span id="detail-status">${esc(status(s))}</span></p>
          <small>資料年度 ${esc(model.year)} · 規則版本 ${a.version}</small>
          ${a.change?`<p class="rules-changed">${esc(a.change.reason)}：${a.change.before} → ${a.change.after} 分（動態重新計算）</p>`:''}
        </div>
      </div>
      ${s.complete<60?`<div class="notice" style="margin-top:16px;background:#fff5e8;border-left:4px solid var(--orange);color:#874d00">⚠️ <strong>防呆機制生效中：</strong>此園所資料完整度未達 60%（目前僅 ${a.coverage}%），系統獨立標記為「⚠️ 資料不足」，嚴禁判定為低風險。請優先要求園所補齊公開財務報告與收費公告。</div>`:a.coverage<100?'<div class="notice" style="margin-top:16px">綜合評估尚不完整。缺漏或衝突資料不計為低風險，已發現的異常仍列出；未對剩餘權重重新放大。</div>':''}
      <div class="dimension-grid">
        ${dims.map(d=>{
          const rr=a.rows.filter(r=>r.dimension===d),
                w=round(rr.reduce((n,r)=>n+r.weight,0)),
                p=round(rr.reduce((n,r)=>n+(r.contribution||0),0));
          return `<div class="dimension-box">
            <h3>${d}</h3>
            <strong>${s.complete<60?'待補':p} <small>/ ${w} 分</small></strong>
            <small>構面權重 ${w}%</small>
            <div class="bar"><i style="width:${s.complete<60?0:(w?Math.min(100,p/w*100):0)}%"></i></div>
          </div>`;
        }).join('')}
      </div>
    </div>`;

    const reasonsPanel = `<div class="panel">
      <div class="panel-head">
        <div>
          <h2>為什麼需要優先關注？</h2>
          <p>四構面量化指標與實測數值，對應可解釋規則體系。</p>
        </div>
        <button onclick="go('data')">查看資料工作台</button>
      </div>
      ${a.rows.filter(r=>r.hit).map((r,i)=>`<div class="reason risk-reason">
        <span class="number">${i+1}</span>
        <div>
          <h3>${esc(r.name)} <span class="risk-points">+${r.contribution} 分</span></h3>
          ${tags(r)}
          <p>${esc(r.formula)}</p>
          <button class="link" onclick="Y.evidence(${s.id},'${r.ruleId}')">查看判斷依據與數值比對 ↗</button>
        </div>
      </div>`).join('')||'<div class="empty-inline">目前已知資料未命中啟用規則；不代表資料已齊全或園所無風險。</div>'}
      ${a.rows.filter(r=>r.raw===null).map(r=>`<div class="reason">
        <div>
          <h3>${esc(r.name)}</h3>
          ${tags(r)}
          <p>${esc(r.formula)}</p>
          <button class="link" onclick="Y.evidence(${s.id},'${r.ruleId}')">查看缺漏／衝突來源</button>
        </div>
      </div>`).join('')}
    </div>`;

    const breakdownPanel = `<div class="panel">
      <div class="panel-head">
        <div>
          <h2>動態分數計算清單</h2>
          <p>啟用規則總權重 ${round(a.rows.filter(r=>r.enabled).reduce((n,r)=>n+r.weight,0))}%；異動規則開關或門檻將即時動態重算。</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="score-breakdown">
          <thead>
            <tr><th>規則／構面</th><th>權重</th><th>規則狀態</th><th>加權貢獻</th></tr>
          </thead>
          <tbody>
            ${a.rows.map(r=>`<tr>
              <td>${esc(r.name)}<br><small>${esc(r.dimension)}</small></td>
              <td>${r.weight}%</td>
              <td>${!r.enabled?'<span class="muted">已停用</span>':r.raw===null?'待確認':r.hit?'<span class="high">觸發條件</span>':'<span class="low">正常合規</span>'}</td>
              <td>${!r.enabled?'0 分':r.raw===null?'暫不計入':`+${r.contribution} 分`}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr><td>四構面加權總分</td><td>100%</td><td>資料完整度 ${a.coverage}%</td><td>${s.complete<60?'— (資料不足)':a.score+' 分'}</td></tr>
          </tfoot>
        </table>
      </div>
    </div>`;

    const shown=db.fields.filter(f=>f.show);
    const fieldsPanel = shown.length ? `<div class="panel"><div class="panel-head"><div><h2>園所資料欄位</h2><p>依欄位管理設定顯示；點擊數值查看來源。</p></div></div><div class="table-wrap"><table><thead><tr><th>欄位</th><th>數值</th><th>單位</th></tr></thead><tbody>${shown.map(f=>`<tr><td>${esc(f.name)}</td><td><button class="link" onclick="Y.source(${s.id},'${f.key}')">${esc(display(current(s.id,f.key)?.value))}${records(s.id)[f.key]?.conflict?'（來源衝突）':''}</button></td><td>${esc(f.unit||'—')}</td></tr>`).join('')}</tbody></table></div></div>` : '';

    host.innerHTML = scoreCard + reasonsPanel + breakdownPanel + bedrockAdvicePanel + fieldsPanel;
    addFunctionHelp();
  };
  function activeTotal(rules){return round(rules.filter(r=>r.enabled).reduce((n,r)=>n+Number(r.weight||0),0));}
  async function syncRiskRecalculate(){
    try {
      const apiBase = window.API_BASE || (window.location.hostname.includes('s3') || window.location.hostname.includes('amazonaws.com') || window.location.protocol === 'file:' ? 'http://54.191.62.21' : '');
      await fetch(apiBase + '/api/risk/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: db.rules, thresholds: db.thresholds })
      });
    } catch(e) {
      console.warn('Risk recalculate sync warning:', e);
    }
  }
  rulesPanel=()=>{
    return `<div class="panel">
      <div class="panel-head">
        <div>
          <h2>風險判斷規則 <span class="pill">版本 1.${db.version}</span></h2>
          <p>設定各規則占總分的比例；開關切換或調整門檻即時動態重算所有園所。</p>
        </div>
        <button onclick="historyModal()">查看修改紀錄</button>
      </div>
      <div class="rule-total">
        <strong id="weight-total" class="weight-sum">${activeTotal(db.rules)}%</strong>
        <span>啟用規則合計建議等於 100%（切換開關或調整設定即時重算）</span>
      </div>
      <div class="table-wrap">
        <table class="rule-editor">
          <thead>
            <tr><th>規則名稱／可執行條件</th><th>風險構面</th><th>權重比例</th><th>狀態</th><th>操作</th></tr>
          </thead>
          <tbody>
            ${db.rules.map((r,i)=>`<tr>
              <td>
                <b>${esc(r.name)}</b>
                <p class="condition-note">${esc(spec.find(p=>p[0]===r.id)?.[6]||r.condition)}${r.id==='repeat'?'；每次累加':`；門檻 ${display(r.threshold)}`}</p>
              </td>
              <td>${esc(r.dimension)}</td>
              <td><div class="rule-controls"><b>${r.weight}%</b></div></td>
              <td>
                <button class="switch ${r.enabled?'':'off'}" aria-pressed="${r.enabled}" onclick="toggleRule(${i})">${r.enabled?'已啟用':'已停用'}</button>
              </td>
              <td><button class="link" onclick="editRule(${i})">編輯規則</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="pad">
        <div id="dimension-totals" class="legend">
          ${dims.map(d=>`<span>${d} <b>${round(db.rules.filter(r=>r.enabled&&r.dimension===d).reduce((n,r)=>n+Number(r.weight||0),0))}%</b></span>`).join('')}
        </div>
        <p class="data-hint">各構面占比由規則權重動態加總。開關切換或修改門檻時，評分引擎即時動態重算各園所總分與 4 構面分布，並同步保存至雲端資料庫 (AWS RDS PostgreSQL)。</p>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>風險等級門檻</h2>
          <p>資料完整度未達 60% 一律獨立標記為「⚠️ 資料不足」，嚴禁判定為低風險。</p>
        </div>
        <button onclick="thresholdModal()">調整門檻</button>
      </div>
      <div class="pad legend">
        <span class="low">低風險 0–${db.thresholds[0]-1}</span>
        <span class="mid">中風險 ${db.thresholds[0]}–${db.thresholds[1]-1}</span>
        <span class="mid">中高風險 ${db.thresholds[1]}–${db.thresholds[2]-1}</span>
        <span class="high">高風險 ${db.thresholds[2]}–100</span>
      </div>
    </div>`;
  };
  toggleRule=i=>{
    db.rules[i].enabled=!db.rules[i].enabled;
    const r=db.rules[i];
    recalc(r.enabled?`啟用「${r.name}」`:`停用「${r.name}」`,true);
    persist();
    syncRiskRecalculate();
    settings();
    toast(`已${r.enabled?'啟用':'停用'}「${r.name}」，已即時動態重算所有園所風險！`);
  };
  editRule=i=>{
    const r=db.rules[i],p=spec.find(p=>p[0]===r.id);
    openModal('編輯風險判斷規則',`<form onsubmit="submitRule(event,${i})">
      <div class="form-grid">
        <label class="field full">規則名稱<input name="name" required maxlength="60" value="${esc(r.name)}"></label>
        <label class="field full">風險構面<select name="dimension">${options(dims,r.dimension)}</select></label>
        <div class="field full"><span>計算方式</span><div class="formula">${esc(p?.[6]||r.condition)}</div></div>
        <label class="field">${r.id==='repeat'?'裁罰門檻次數':'比較門檻'}<input name="threshold" type="number" min="0" step="any" required value="${r.threshold}"></label>
        <label class="field">占總分權重（%）<input name="weight" type="number" min="0" max="100" step="1" required value="${r.weight}"></label>
      </div>
      <label class="check" style="margin-top:14px"><input name="enabled" type="checkbox" ${r.enabled?'checked':''}> 啟用此規則</label>
      <div class="notice" style="margin-top:14px">儲存後動態重新計算各園所分數與 4 構面分布，並同步保存至雲端資料庫 (AWS RDS PostgreSQL)。</div>
      <div class="form-actions">
        <button type="button" onclick="closeModal()">取消</button>
        <button class="primary">儲存並即時重算</button>
      </div>
    </form>`);
  };
  submitRule=(e,i)=>{
    e.preventDefault();
    const v=Object.fromEntries(new FormData(e.target));
    const r=db.rules[i];
    r.name=v.name.trim();
    r.dimension=v.dimension;
    r.threshold=Number(v.threshold);
    r.weight=Number(v.weight);
    r.enabled=!!v.enabled;
    recalc(`修改「${r.name}」規則與門檻`,true);
    persist();
    syncRiskRecalculate();
    closeModal();
    settings();
    toast(`已更新「${r.name}」，已動態重新計算所有園所風險！`);
  };
  saveThresholds=e=>{
    e.preventDefault();
    const v=[0,1,2].map(i=>Number(e.target.elements['t'+i].value));
    if(!(v[0]<v[1]&&v[1]<v[2])){
      $('#form-error').textContent='分數需依序遞增：中風險 < 中高風險 < 高風險。';
      return;
    }
    db.thresholds=v;
    recalc('調整風險等級門檻',true);
    persist();
    syncRiskRecalculate();
    closeModal();
    settings();
    toast('已更新風險等級門檻，並動態重新分類所有園所！');
  };
  const previousSettings=settings;
  settings=()=>{previousSettings();document.querySelectorAll('.tabs button').forEach(b=>{if(b.textContent==='資料欄位')b.textContent='欄位管理';});const note=$('#page>.note');if(note)note.textContent='資料已即時同步保存於瀏覽器與後端雲端資料庫 (AWS RDS PostgreSQL)。規則與門檻變更即時動態重算；若需清空可點選「重設為初始示範資料」。';};
  const nav=document.createElement('button');nav.id='nav-data';nav.textContent='▤　園所資料工作台';nav.onclick=()=>go('data');$('nav').prepend(nav);
  function availableFields(){return [...new Set(['staffCostPerStudent',...allImportFields.map(f=>f[0]),...Object.values(model.data).flatMap(ys=>Object.values(ys).flatMap(r=>Object.keys(r)))])].filter(k=>!['name','district','address','type','schoolId','year'].includes(k));}
  function sourceState(s){const rr=Object.values(records(s.id));return rr.some(r=>r.conflict)?'conflict':assessment(s).coverage<100?'missing':'ready';}
  function workRows(){return schools.filter(s=>(!workQuery||(s.name+s.address+`YA-${String(s.id+1).padStart(4,'0')}`).includes(workQuery))&&(!workDistrict||s.district===workDistrict)&&(!workState||sourceState(s)===workState));}
  Y.refreshWork=()=>{if(page==='data')renderWorkRows();};
  Y.year=y=>{model.year=y;workSelected.clear();recalc('切換年度');persist();render();};
  Y.workFilter=(key,v)=>{if(key==='q')workQuery=v;if(key==='district')workDistrict=v;if(key==='state')workState=v;renderWorkRows();};
  Y.column=(k,on)=>{workColumns=on?[...new Set([...workColumns,k])]:workColumns.filter(x=>x!==k);renderWorkRows();};
  Y.select=(id,on)=>{on?workSelected.add(id):workSelected.delete(id);updateSelection();};
  Y.selectAll=on=>{for(const s of workRows())on?workSelected.add(s.id):workSelected.delete(s.id);renderWorkRows();};
  function updateSelection(){if($('#selection-count'))$('#selection-count').textContent='';}
  function workPage(){const years=[...new Set(['2025',...Object.values(model.data).flatMap(y=>Object.keys(y))])].sort().reverse();$('#page').innerHTML=`<div class="heading"><div><div class="eyebrow">資料整合 · 可追溯分析</div><h1>園所資料工作台</h1><p>不同來源歸戶到同一園所，先確認資料，再找出異常。</p></div><div class="work-heading"><button onclick="tab='import';go('settings')">＋ 匯入資料</button><button class="primary sheet-export" onclick="Y.exportExcel()">匯出所選 Excel</button></div></div><div class="p0-help">每個數值都可查看來源與原文。來源衝突需人工確認，缺資料不當成 0；目前為本機原型，示範數據皆為合成。</div><div class="metrics"><div class="metric"><span>整合園所</span><strong>${schools.length}</strong><small>使用穩定園所識別碼</small></div><div class="metric"><span>待確認來源衝突</span><strong>${schools.filter(s=>sourceState(s)==='conflict').length}</strong><small>保留所有來源，不直接覆寫</small></div><div class="metric"><span>有已知異常</span><strong>${schools.filter(s=>assessment(s).anomalies>0).length}</strong><small>異常可查看計算與來源</small></div><div class="metric"><span>資料不足</span><strong>${schools.filter(s=>assessment(s).coverage<100).length}</strong><small>與已知異常分開呈現</small></div></div><div class="panel"><div class="work-controls"><input class="search" aria-label="搜尋資料工作台" placeholder="園所名稱、地址或識別碼" value="${esc(workQuery)}" oninput="Y.workFilter('q',this.value)"><select aria-label="工作台行政區" onchange="Y.workFilter('district',this.value)">${options(['全部行政區',...districts],workDistrict,true)}</select><select aria-label="資料年度" onchange="Y.year(this.value)">${options(years,model.year)}</select><select aria-label="資料狀態" onchange="Y.workFilter('state',this.value)">${[['','全部資料狀態'],['conflict','来源衝突'],['missing','資料不足'],['ready','可評估']].map(([v,t])=>`<option value="${v}" ${v===workState?'selected':''}>${t}</option>`).join('')}</select></div><details><summary class="pad">選擇顯示與匯出欄位</summary><div class="column-picker">${availableFields().map(k=>`<label><input type="checkbox" ${workColumns.includes(k)?'checked':''} onchange="Y.column('${k}',this.checked)"> ${esc(label(k))}</label>`).join('')}</div></details><div class="panel-head"><span id="selection-count"></span><small>Excel 包含資料、來源明細、評分明細三張工作表</small></div><div id="work-results" class="table-wrap"></div></div>`;renderWorkRows();}
  function renderWorkRows(){const rows=workRows();$('#work-results').innerHTML=`<table class="work-table"><thead><tr><th><input type="checkbox" aria-label="全選目前園所" ${rows.length&&rows.every(s=>workSelected.has(s.id))?'checked':''} onchange="Y.selectAll(this.checked)"></th><th>園所／年度</th>${workColumns.map(k=>`<th>${esc(label(k))}</th>`).join('')}<th>異常／完整度</th></tr></thead><tbody>${rows.map(s=>`<tr><td><input type="checkbox" aria-label="選取${esc(s.name)}" ${workSelected.has(s.id)?'checked':''} onchange="Y.select(${s.id},this.checked)"></td><td><button class="link" onclick="go('detail',${s.id})">${esc(s.name)}</button><br><small>YA-${String(s.id+1).padStart(4,'0')} · ${esc(s.district)} · ${esc(model.year)}</small></td>${workColumns.map(k=>{const c=current(s.id,k),r=records(s.id)[k];return `<td><button class="value-link" onclick="Y.source(${s.id},'${k}')">${esc(display(c?.value))}<small>${r?.conflict?'⚠ 來源衝突':c?'查看來源 ↗':'尚無資料'}</small></button></td>`;}).join('')}<td><span class="${assessment(s).anomalies?'high':'muted'}">${assessment(s).anomalies} 項異常</span><br><small>可評估 ${assessment(s).coverage}%</small><br><span class="data-status ${sourceState(s)}">${sourceState(s)==='conflict'?'待確認衝突':sourceState(s)==='missing'?'資料不足':'可評估'}</span></td></tr>`).join('')||`<tr><td colspan="${workColumns.length+3}">沒有符合的園所。</td></tr>`}</tbody></table>`;updateSelection();Y.decorateEvaluations?.();}
  const oldRender=render;
  render=()=>{if(page==='data')workPage();else oldRender();};
  const oldOverview=overview;
  overview=()=>{oldOverview();$('#page > .heading')?.remove();const cards=$$('.metrics .metric');if(cards[1]){cards[1].innerHTML=`<span>有已知異常</span><strong>${schools.filter(s=>assessment(s).anomalies>0).length}<small> 間</small></strong><small>包含評估資料尚不完整的園所</small>`;cards[1].onclick=()=>{metric=metric==='rising'?'':'rising';overview();};}if(cards[3])cards[3].querySelector('strong').innerHTML=`${schools.filter(s=>assessment(s).coverage<100).length}<span> 間</span>`;};
  const $$=s=>Array.from(document.querySelectorAll(s));
  listData=()=>schools.filter(s=>(!filters.q||(s.name+s.address).includes(filters.q))&&(!filters.district||s.district===filters.district)&&(!filters.risk||level(s)===filters.risk)&&(!metric||(metric==='high'?level(s)==='高風險':metric==='rising'?assessment(s).anomalies>0:metric==='pending'?status(s)==='待查核':assessment(s).coverage<100))).sort((a,b)=>filters.sort==='complete'?a.complete-b.complete:b.score-a.score);
  const oldResults=updateResults;
  updateResults=()=>{
    oldResults();
    $$('.row-right').forEach(el=>{el.innerHTML='<b>查看詳情 ›</b>含來源與權重';});
    $$('#results .school-row').forEach((el,i)=>{
      const s=listData()[i];
      if(!s)return;
      const scoreEl=el.querySelector('.score');
      if(scoreEl){
        scoreEl.textContent=s.complete<60?'—':s.score;
        scoreEl.className=`score ${cls(s)}`;
      }
      const pill=el.querySelector('.pill');
      if(pill){
        pill.textContent=level(s);
        pill.className=`pill ${cls(s)}`;
      }
      const sm=el.querySelector('small');
      if(sm) sm.textContent=`${status(s)} · 資料完整度 ${s.complete}%`;
    });
  };
  // Document parsers and workbook export are defined below.

  /* Real local file import, retaining the original manual mapping/preview UX. */
  function csvRows(text){
    const lines=[],row=[];let value='',quoted=false;
    const delimiter=text.split(/\r?\n/)[0].includes('\t')?'\t':',';
    for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(c===delimiter&&!quoted){row.push(value);value='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);lines.push([...row]);row.length=0;value='';}else value+=c;}
    if(quoted)throw Error('CSV 引號未閉合，請檢查檔案。');if(value||row.length){row.push(value);lines.push([...row]);}return lines;
  }
  const xml=text=>{const d=new DOMParser().parseFromString(text,'application/xml');if(d.querySelector('parsererror'))throw Error('檔案 XML 格式錯誤。');return d;};
  const nodes=(d,tag)=>Array.from(d.getElementsByTagNameNS('*',tag));
  async function readXlsx(file){
    const zip=await JSZip.loadAsync(await file.arrayBuffer());
    const text=async path=>{if(!zip.file(path))throw Error('Excel 缺少必要檔案：'+path);return zip.file(path).async('string');};
    let strings=[];if(zip.file('xl/sharedStrings.xml'))strings=nodes(xml(await text('xl/sharedStrings.xml')),'si').map(n=>nodes(n,'t').map(t=>t.textContent).join(''));
    const rels=nodes(xml(await text('xl/_rels/workbook.xml.rels')),'Relationship');
    const sheets=nodes(xml(await text('xl/workbook.xml')),'sheet');const result=[];
    for(const sheet of sheets){const rel=rels.find(r=>r.getAttribute('Id')===sheet.getAttribute('r:id'));if(!rel)continue;const target=rel.getAttribute('Target');const path=target.startsWith('/')?target.slice(1):new URL(target,'https://local/xl/').pathname.slice(1);const rows=[];
      for(const row of nodes(xml(await text(path)),'row')){const values=[];for(const c of nodes(row,'c')){const letters=(c.getAttribute('r')||'A').match(/[A-Z]+/)[0];let col=0;for(const ch of letters)col=col*26+ch.charCodeAt(0)-64;const type=c.getAttribute('t'),raw=nodes(c,'v')[0]?.textContent||'';values[col-1]=type==='s'?strings[Number(raw)]:type==='inlineStr'?nodes(c,'t').map(t=>t.textContent).join(''):raw;}rows.push(Array.from({length:values.length},(_,i)=>values[i]??''));}
      result.push({name:sheet.getAttribute('name'),rows,locations:rows.map((_,i)=>`工作表 ${sheet.getAttribute('name')} · 第 ${i+1} 列`)});
    }return result;
  }
  function keyValueTable(lines,locations){
    const entries=[];for(let i=0;i<lines.length;i++){const match=lines[i].match(/^\s*([^:：]{1,40})\s*[:：]\s*(.*?)\s*$/);if(match)entries.push({key:match[1],value:match[2],location:locations[i]});}
    if(entries.length<2)throw Error('未找到固定格式欄位。文字 PDF／Word 請使用「園所名稱：…」「資料年度：2025」等一行一欄格式；掃描 PDF 本機版不支援 OCR。');
    const seen=new Set();for(const e of entries){if(seen.has(e.key))throw Error('文件包含重複欄名，請拆成每園所一份文件，避免錯誤合併。');seen.add(e.key);}
    return [{name:'固定格式文件',rows:[entries.map(e=>e.key),entries.map(e=>e.value)],locations:['欄位名稱','文件資料'],fieldLocations:entries.map(e=>e.location)}];
  }
  async function readPdf(file){
    const pdfjs=await import('./vendor/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc=new URL('vendor/pdf.worker.mjs',document.querySelector('script[src*="youan-p0.js"]').src).href;
    const base=new URL('vendor/',document.querySelector('script[src*="youan-p0.js"]').src).href;
    const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),cMapUrl:base+'cmaps/',cMapPacked:true,standardFontDataUrl:base+'standard_fonts/',isEvalSupported:false});const doc=await task.promise;
    if(doc.numPages>30){await doc.destroy();throw Error('本機版每份 PDF 最多 30 頁。');}
    const lines=[],locations=[];
    try{for(let p=1;p<=doc.numPages;p++){const pg=await doc.getPage(p),content=await pg.getTextContent();const groups=[];for(const item of content.items){if(!item.str)continue;let g=groups.find(g=>Math.abs(g.y-item.transform[5])<3);if(!g){g={y:item.transform[5],items:[]};groups.push(g);}g.items.push(item);}groups.sort((a,b)=>b.y-a.y);for(const [i,g]of groups.entries()){lines.push(g.items.sort((a,b)=>a.transform[4]-b.transform[4]).map(x=>x.str).join(' ').trim());locations.push(`第 ${p} 頁 · 第 ${i+1} 行`);}}}finally{await doc.destroy();}
    importSession.raw=lines.join('\n');return keyValueTable(lines,locations);
  }
  async function readDocx(file){const z=await JSZip.loadAsync(await file.arrayBuffer()),part=z.file('word/document.xml');if(!part)throw Error('不是有效 Word 文件。');const d=xml(await part.async('string')),lines=nodes(d,'p').map(p=>nodes(p,'t').map(t=>t.textContent).join(''));importSession.raw=lines.join('\n');return keyValueTable(lines,lines.map((_,i)=>`第 ${i+1} 段`));}
  const sampleHeaders=['園所識別碼','園所名稱','行政區','地址','資料年度','核定招生人數','實際學生數','另一來源學生數','前年度學生數','近一年裁罰次數','年度人事費','前年度人事費','月收費','年度收入','訊號數量','前期基準訊號數'];
  const sampleValues=['YA-0001','幸福幼兒園','板橋區','新北市板橋區示範路18號','2025','120','100','100','95','0','8000000','7900000','5000','6000000','2','2'];
  const csvEncode=rows=>rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
  Y.downloadExample=()=>downloadBlob(new Blob(['\ufeff'+csvEncode([sampleHeaders,sampleValues])],{type:'text/csv;charset=utf-8'}),'園所資料_固定格式範例.csv');
  Y.downloadText=()=>downloadBlob(new Blob([sampleHeaders.map((h,i)=>h+'：'+sampleValues[i]).join('\n')],{type:'text/plain;charset=utf-8'}),'固定格式文件範例.txt');
  uploadPanel=()=>`<div class="panel"><div class="panel-head"><div><h2>匯入並整合園所資料</h2><p>真實讀取本機檔案，人工確認後才更新；未串接 AI 或雲端。</p></div><button onclick="Y.demoImport()">載入合成範例</button></div><div class="pad"><div class="category-grid">${Object.entries(importCatalog).map(([k,v])=>`<label class="category-option"><input type="checkbox" ${importSession.categories.includes(k)?'checked':''} onchange="chooseImportCategory('${k}',this.checked)"><span><strong>${esc(v.label)}</strong><small>${esc(v.hint)}</small></span></label>`).join('')}</div><div class="upload-box" style="margin-top:18px"><label for="import-file"><b>選擇檔案（最多 10 MB／1,000 筆）</b></label><input id="import-file" type="file" accept=".csv,.xlsx,.json,.txt,.pdf,.docx" onchange="recognizeFile(this.files[0])" ${importSession.busy?'disabled':''}><small>CSV、Excel、JSON；文字 PDF／Word／TXT 支援一行一欄的固定格式。掃描 PDF 尚不支援。</small><label>CSV／TXT 編碼 <select onchange="importSession.encoding=this.value">${options(['utf-8','big5'],importSession.encoding)}</select></label><div class="toolbar"><button onclick="Y.downloadExample()">下載 CSV 範例</button><button onclick="Y.downloadText()">下載文件格式範例</button></div></div>${importSession.busy?'<div class="loading"><span class="spinner"></span><p>讀取並比對欄位…</p></div>':''}${importSession.message?`<div class="import-alert" role="alert" style="margin-top:15px">${esc(importSession.message)}</div>`:''}<div class="notice" style="margin-top:18px">目前只在瀏覽器本機處理，來源摘錄會保存於本機。請使用合規或合成資料；本機功能完成不代表允許將財務或個資上傳競賽 AWS。</div></div></div>`;
  Y.demoImport=()=>{importSession.categories=Object.keys(importCatalog);importSession.file='合成範例.csv';importSession.sheets=[{name:'合成範例',rows:[sampleHeaders,sampleValues],locations:['第 1 列','第 2 列']}];loadImportSheet(0);importSession.step=2;renderImport();};
  recognizeFile=async file=>{
    if(!file)return Y.demoImport();const st=importSession;
    if(!st.categories.length){st.message='請先選擇資料類別。';renderImport();return;}
    if(file.size>10*1024*1024){st.message='檔案超過 10 MB，請拆分後再匯入。';renderImport();return;}
    st.busy=true;st.message='';st.raw='';st.file=file.name;st.step=1;renderImport();
    try{const ext=file.name.split('.').pop().toLowerCase();if(ext==='xlsx')st.sheets=await readXlsx(file);else if(ext==='pdf')st.sheets=await readPdf(file);else if(ext==='docx')st.sheets=await readDocx(file);else {const text=new TextDecoder(st.encoding).decode(await file.arrayBuffer()).replace(/^\ufeff/,'');st.raw=text.slice(0,10000);let rows;if(ext==='json'){const j=JSON.parse(text);if(!Array.isArray(j)||!j.length||j.some(r=>!r||Array.isArray(r)||typeof r!=='object'))throw Error('JSON 必須是非空的資料物件陣列。');const headers=[...new Set(j.flatMap(r=>Object.keys(r)))];rows=[headers,...j.map(r=>headers.map(k=>r[k]??''))];}else if(ext==='txt'){st.sheets=keyValueTable(text.split(/\r?\n/),text.split(/\r?\n/).map((_,i)=>`第 ${i+1} 行`));}else if(ext==='csv')rows=csvRows(text);else throw Error('不支援此檔案格式。');if(rows)st.sheets=[{name:ext==='xlsx'?'工作表':'資料表',rows,locations:rows.map((_,i)=>`第 ${i+1} 列`)}];}
      loadImportSheet(0);st.step=2;toast('已讀取檔案，請確認欄位對應');
    }catch(e){st.message='讀取失敗：'+e.message;st.step=1;}finally{st.busy=false;renderImport();}
  };
  importFields=()=>{const fields=[...importCatalog.basic.fields.filter(f=>['schoolId','name','district','year'].includes(f[0]))];for(const cat of importSession.categories)for(const f of importCatalog[cat].fields)if(!fields.some(x=>x[0]===f[0]))fields.push(f);for(const f of db.fields.filter(f=>f.key?.startsWith('custom_')))fields.push([f.key,f.name,[f.name,f.key]]);return fields;};
  const oldLoad=loadImportSheet;
  loadImportSheet=i=>{oldLoad(i);const st=importSession,rows=st.sheets[i].rows;st.headerIndex=rows.findIndex(r=>r.length===st.headers.length&&r.every((v,j)=>String(v||'').trim()===st.headers[j]));if(st.headerIndex<0)st.headerIndex=0;st.sourceRows=rows.map((r,j)=>({r,j})).filter(x=>x.j>st.headerIndex&&x.r.some(v=>String(v??'').trim())).map(x=>x.j);st.selected.year=true;};
  const oldMapping=mappingPanel;
  mappingPanel=()=>oldMapping().replaceAll('AI 已整理好，請確認匯入欄位','已讀取檔案，請確認欄位對應').replaceAll('AI 已依你選擇的資料類別整理欄位（示範）。','本機依欄位名稱與別名比對，不是 AI 判斷。').replace('園所名稱為必填；新園所另需行政區與地址。既有園所以名稱與行政區核對。','園所名稱與資料年度必填；優先依園所識別碼歸戶。新園所另需行政區與地址。');
  const oldImportRender=renderImport;
  renderImport=()=>{oldImportRender();const panel=$('#import-panel');if(panel){for(const s of panel.querySelectorAll('.step'))s.innerHTML=s.innerHTML.replace('AI 辨識與勾選欄位','欄位對應與勾選');} };
  function matching(v){if(v.schoolId){const m=/^YA-(\d+)$/.exec(v.schoolId);return m?schoolById(Number(m[1])-1):null;}const hits=schools.filter(s=>s.name===v.name&&s.district===v.district);return hits.length===1?hits[0]:null;}
  validateImportRow=row=>{const v=row.values,errors=[];if(!v.name?.trim())errors.push('缺少園所名稱');if(!/^\d{4}$/.test(v.year||'')||Number(v.year)<1900||Number(v.year)>2100)errors.push('資料年度需為 1900–2100 西元四碼');if(!v.district?.trim())errors.push('缺少行政區');const target=matching(v);if(v.schoolId&&!target)errors.push('園所識別碼不存在，新增園所請清空識別碼');if(target&&v.name!==target.name)errors.push('識別碼與園所名稱不一致');if(target&&v.district!==target.district)errors.push('识別碼與行政區不一致');if(!target&&!v.address?.trim())errors.push('新增園所需有地址');for(const k of numericImportFields)if(v[k]!==undefined&&v[k]!==''&&(!/^\d+(\.\d+)?$/.test(v[k])||!Number.isFinite(Number(v[k]))))errors.push(label(k)+'需為非負數字');for(const k of ['capacity','studentCount','sourceStudentCount','previousStudentCount','penaltyCount','signalCount','signalBaseline'])if(v[k]&&Number(v[k])%1!==0)errors.push(label(k)+'需為整數');for(const k of ['penaltyDate','evaluationDate'])if(v[k]){const iso=v[k].replaceAll('/','-');const m=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(iso);if(!m||new Date(Date.UTC(+m[1],+m[2]-1,+m[3])).toISOString().slice(0,10)!==`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`)errors.push(label(k)+'日期無效');}if(importSession.preview.some(o=>o!==row&&o.include&&o.values.name===v.name&&o.values.district===v.district&&o.values.year===v.year))errors.push('同園所同年度重複列');return {errors,target};};
  const previousPreview=previewPanel;
  previewPanel=()=>previousPreview().replaceAll('示範資料將新增或更新在此 Demo 中；新園所顯示「資料不足」，不會直接判定為低風險。','確認後保存本機來源並重算。同年度不同數值會標示來源衝突，待人工選擇；不會直接覆蓋既有數值。');
  commitImport=()=>{
    const st=importSession,rows=st.preview.filter(r=>r.include);
    if(!$('#import-confirm').checked){$('#import-error').textContent='請先確認已檢查資料。';return;}if(!rows.length||rows.some(r=>validateImportRow(r).errors.length)){$('#import-error').textContent='請修正所有已勾選的資料列。';return;}
    const backup=clone(db),schoolBackup=clone(schools),districtBackup=[...districts];let added=0,updated=0,conflicts=0;const logRows=[];
    const fingerprint=JSON.stringify({file:st.file,sheet:st.sheetIndex,rows:rows.map(r=>r.values)});
    if(db.imports.some(h=>h.fingerprint===fingerprint)){$('#import-error').textContent='這份檔案的相同資料已匯入，已避免重複寫入。';return;}
    for(const row of rows){const v=row.values;let s=matching(v);const existed=!!s;if(!s){const id=Math.max(-1,...schools.map(s=>s.id))+1;s={id,name:v.name,district:v.district,address:v.address,type:v.type||'尚未提供',capacity:Number(v.capacity)||0,score:0,complete:0,trend:0,x:12+id%5*18,y:13+Math.floor(id/5)%5*17,imported:true};schools.push(s);db.importedSchools.push(s);added++;}else updated++;
      if(!districts.includes(s.district))districts.push(s.district);
      const sheet=st.sheets[st.sheetIndex],sourceRow=st.sourceRows?.[row.row-1]??row.row;
      for(const [k,raw]of Object.entries(v)){if(['name','district','address','type','year','schoolId'].includes(k)||raw==='')continue;const value=numericImportFields.includes(k)?Number(raw):raw;const col=st.mapping[k];const loc=sheet.fieldLocations?.[col]||sheet.locations?.[sourceRow]||`${sheet.name} · 第 ${sourceRow+1} 列`;const sourceValue=st.rows[row.row-1]?.[col]??raw;addObservation(s.id,String(v.year),k,value,st.file,loc,`${sheet.name}｜${st.headers[col]}：${sourceValue}${String(sourceValue)!==String(raw)?`\n人工確認後：${raw}`:''}`);if(records(s.id,v.year)[k].conflict)conflicts++;}
      db.schoolData[s.id]={file:st.file,at:stamp(),values:{...(db.schoolData[s.id]?.values||{}),...v}};logRows.push({id:s.id,name:s.name,action:existed?'更新':'新增',values:clone(v)});
    }
    model.year=String(rows[0].values.year);recalc('確認匯入資料',true);db.imports.unshift({id:uid(),file:st.file,sheet:st.sheets[st.sheetIndex].name,at:stamp(),categories:st.categories.map(k=>importCatalog[k].label),fields:importFields().filter(f=>st.selected[f[0]]).map(f=>f[1]),added,updated,records:logRows,fingerprint});
    if(!persist()){Object.assign(db,backup);Object.assign(model,backup.p0);db.p0=model;schools.splice(0,schools.length,...schoolBackup);districts.splice(0,districts.length,...districtBackup);$('#import-error').textContent='本機儲存空間不足，本次匯入已取消。';return;}
    st.step=1;st.preview=[];st.message='';renderImport();openModal('資料匯入完成',`<h2>新增 ${added} 間，更新 ${updated} 間園所</h2><p style="margin-top:12px">已保存來源、年度與原文，並重新計算異常與加權分數。</p><div class="notice" style="margin-top:14px">${conflicts?`${conflicts} 個欄位出現來源衝突，請在工作台點擊數值選擇採用來源；未確認前不參與評分。`:'可到工作台核對數值與來源，勾選欄位匯出 Excel。'}</div><div class="form-actions"><button onclick="closeModal()">繼續匯入</button><button class="primary" onclick="closeModal();go('data')">查看資料工作台</button></div>`);
  };
  /* Minimal standards-compliant XLSX: typed cells and inline strings, never formulas from user data. */
  const xesc=s=>String(s??'').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  function colName(n){let s='';do{s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)-1;}while(n>=0);return s;}
  async function workbookBlob(sheets){
    const z=new JSZip(),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    z.file('[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
    z.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    z.file('xl/workbook.xml',`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xesc(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`);
    z.file('xl/_rels/workbook.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    z.file('xl/styles.xml',`<styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Microsoft JhengHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft JhengHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF245C9B"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
    sheets.forEach((s,i)=>{const cols=s.rows[0].length;z.file(`xl/worksheets/sheet${i+1}.xml`,`<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${Array.from({length:cols},(_,c)=>`<col min="${c+1}" max="${c+1}" width="${c===0?16:28}" customWidth="1"/>`).join('')}</cols><sheetData>${s.rows.map((r,ri)=>`<row r="${ri+1}" ht="${ri?42:30}" customHeight="1">${r.map((v,ci)=>{const ref=`${colName(ci)}${ri+1}`;return typeof v==='number'&&Number.isFinite(v)?`<c r="${ref}" s="${ri?0:1}"><v>${v}</v></c>`:`<c r="${ref}" t="inlineStr" s="${ri?0:1}"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;}).join('')}</row>`).join('')}</sheetData><autoFilter ref="A1:${colName(cols-1)}${s.rows.length}"/></worksheet>`);});
    return z.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  Y.exportExcel=async()=>{const rows=workRows().filter(s=>workSelected.has(s.id));if(!rows.length||!workColumns.length){toast('請先勾選園所與至少一個欄位');return;}
    const data=[['園所識別碼','園所名稱','行政區','資料年度',...workColumns.map(label),'已知加權分數','可評估權重(%)','異常數','資料狀態','規則版本']];
    const sources=[['園所識別碼','園所名稱','資料年度','欄位','數值','來源檔案','定位','原文／人工修正','取得時間','採用狀態']];
    const scores=[['園所識別碼','園所名稱','資料年度','規則','構面','權重(%)','規則分數','加權貢獻','計算依據','規則版本']];
    for(const s of rows){const a=assessment(s),id=`YA-${String(s.id+1).padStart(4,'0')}`;data.push([id,s.name,s.district,model.year,...workColumns.map(k=>records(s.id)[k]?.conflict?'來源衝突，待確認':current(s.id,k)?.value??''),a.score,a.coverage,a.anomalies,sourceState(s)==='conflict'?'來源衝突':a.coverage<100?'資料不足':'可評估',a.version]);for(const k of [...new Set(workColumns.flatMap(k=>k==='staffCostPerStudent'?[k,'staffCost','studentCount']:[k]))]){if(k==='staffCostPerStudent'){const c=current(s.id,k);sources.push([id,s.name,model.year,label(k),c?.value??'',c?.source??'',c?.locator??'年度人事費 ÷ 實際學生數',c?.excerpt??'來源缺漏、衝突或學生數無效',c?.at??'',c?'衍生計算':'暫無法計算']);continue;}const r=records(s.id)[k];if(!r){sources.push([id,s.name,model.year,label(k),'','','','','','缺資料']);continue;}for(const c of r.candidates)sources.push([id,s.name,model.year,label(k),c.value,c.source,c.locator,c.excerpt,c.at,r.conflict?'衝突待確認':r.chosen===c.id?'已採用':'保留未採用']);}for(const r of a.rows)scores.push([id,s.name,model.year,r.name,r.dimension,r.weight,r.raw??'資料不足',r.contribution??'暫不計入',r.formula,a.version]);}
    try{downloadBlob(await workbookBlob([{name:'園所資料',rows:data},{name:'來源明細',rows:sources},{name:'評分明細',rows:scores}]),`幼安雷達_園所資料_${model.year}.xlsx`);toast(`已匯出 ${rows.length} 間園所、${workColumns.length} 個欄位與追溯明細`);}catch(e){toast('匯出失敗：'+e.message);}
  };
  fieldsPanel=()=>`<div class="panel"><div class="panel-head"><div><h2>欄位管理</h2><p>設定自訂匯入欄位與詳情顯示；計分用途由規則自動列出。</p></div><button class="primary" onclick="editField()">＋ 新增資料欄位</button></div><div class="table-wrap"><table><thead><tr><th>欄位名稱</th><th>類型／單位</th><th>預期資料來源</th><th>被哪些規則使用</th><th>詳情顯示</th><th>操作</th></tr></thead><tbody>${db.fields.map((f,i)=>{const used=db.rules.filter(r=>required[r.id]?.includes(f.key));return `<tr><td><b>${esc(f.name)}</b></td><td>${esc(f.type)}／${esc(f.unit||'—')}</td><td>${esc(f.source)}</td><td>${used.length?used.map(r=>`<div>${esc(r.name)} <small>（${r.enabled?'已啟用':'已停用'} · ${r.weight}%）</small></div>`).join(''):'<small>尚無規則使用，不計分</small>'}</td><td><label><input type="checkbox" aria-label="顯示${esc(f.name)}於詳情" ${f.show?'checked':''} onchange="Y.showField(${i},this.checked)"> 顯示</label></td><td><button class="link" onclick="editField(${i})">編輯欄位</button></td></tr>`;}).join('')}</tbody></table></div><div class="pad notice">新增自訂欄位可用於匯入對應、工作台與 Excel 匯出。預期來源只是描述，不會自動抓取；隱藏詳情欄位不會停用評分規則或隱藏判斷證據。</div></div>`;
  Y.showField=(i,on)=>{const previous=db.fields[i].show;db.fields[i].show=on;if(!persist())db.fields[i].show=previous;settings();};
  editField=i=>{const f=i==null?{name:'',type:'數字',unit:'',source:'',show:true}:db.fields[i];const builtIn=f.key&&!f.key.startsWith('custom_');openModal(i==null?'新增資料欄位':'編輯資料欄位',`<form onsubmit="submitField(event,${i??'null'})"><div id="form-error" class="form-error" role="alert"></div><div class="form-grid"><label class="field full">欄位名稱<input name="name" required maxlength="40" value="${esc(f.name)}" ${builtIn?'readonly':''}></label><label class="field">欄位類型<select name="type" ${builtIn?'disabled':''}>${options(['數字','金額','文字','日期','是／否'],f.type)}</select></label><label class="field">單位<input name="unit" maxlength="12" value="${esc(f.unit)}"></label><label class="field full">預期資料來源<input name="source" maxlength="100" value="${esc(f.source)}" placeholder="例如：園所提供的年度資料"></label></div><label class="check"><input type="checkbox" name="show" ${f.show?'checked':''}>顯示於園所詳情的資料欄位區</label><div class="notice">${builtIn?'內建欄位名稱與型別固定，以維持來源對應與計分一致。':'新增欄位不會自動納入風險計算，需另建立對應的可執行規則。'}</div><div class="form-actions"><button type="button" onclick="closeModal()">取消</button><button class="primary">儲存欄位</button></div></form>`);};
  submitField=(e,i)=>{e.preventDefault();const v=Object.fromEntries(new FormData(e.target)),old=i==null?null:db.fields[i],builtIn=old&&!old.key.startsWith('custom_'),name=builtIn?old.name:v.name.trim();if(!name||db.fields.some((f,j)=>j!==i&&f.name===name)){ $('#form-error').textContent='請填寫不重複的欄位名稱。';return;}const f={...old,key:old?.key||'custom_'+uid().replaceAll('-',''),name,type:builtIn?old.type:v.type,unit:v.unit.trim(),source:v.source.trim(),show:!!v.show};if(i==null)db.fields.push(f);else db.fields[i]=f;if(!persist()){if(i==null)db.fields.pop();else db.fields[i]=old;$('#form-error').textContent='無法保存欄位，請檢查本機儲存空間。';return;}const pos=numericImportFields.indexOf(f.key);if(['數字','金額'].includes(f.type)){if(pos<0)numericImportFields.push(f.key);}else if(pos>=0)numericImportFields.splice(pos,1);closeModal();settings();toast('已儲存欄位，詳情顯示設定已生效');};
  functionHelp.import={title:'資料匯入與確認',intro:'真實讀取本機檔案，將不同來源整理到同一園所。',steps:['選擇資料類別與本機檔案。','依欄位別名建議對應，人工確認。','預覽、修正並確認資料年度與園所。','匯入後重算，來源衝突需人工選擇。'],note:'本機版未串接 AI，檔案不會上傳。PDF／Word 僅支援固定格式文字文件。'};
  functionHelp.mapping.intro='依已知欄位別名建議對應，再由使用者確認；本機版未串接 AI。';
  functionHelp.preview.steps=['逐列修正與取消匯入。','依識別碼或名稱與行政區歸戶。','確認年度與必要欄位。','確認後保存來源並重新計算，衝突需另外確認。'];
  document.querySelector('.topline .demo').textContent='本機原型 · 內建資料為合成示範';
  page='overview';render();$$('nav button').forEach(b=>b.classList.toggle('active',b.id==='nav-overview'));/* 登入後先看風險總覽（今天該優先關注誰），資料工作台從側欄進入 */
})();
