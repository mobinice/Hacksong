/* P1 assigned issues #8–#13: demonstrable, local-first workflows. */
(() => {
  'use strict';

  db.externalImpacts ||= {};
  db.ocrFindings ||= {};
  db.sentimentEvents ||= {};
  db.auditResults ||= {};
  try{indexedDB.deleteDatabase('youan-evaluation-files')}catch{}

  const stageNames={待處理:'待查核',調查中:'調查中',待補件:'待補件',已完成:'已結案'};
  const apiPost=async(path,payload)=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4500);
    try{
      const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
      if(!response.ok)throw Error('API '+response.status);
      return await response.json();
    }finally{clearTimeout(timer);}
  };
  const safeUrl=value=>{try{const u=new URL(String(value||''),location.href);return ['http:','https:'].includes(u.protocol)?u.href:''}catch{return ''}};
  const setImpact=(id,impact)=>{
    const list=db.externalImpacts[id]||=[];
    const index=list.findIndex(item=>item.id===impact.id);
    if(index<0)list.push(impact);else list[index]=impact;
    db.externalImpacts[id]=list;
  };
  const removeImpact=(id,key)=>{db.externalImpacts[id]=(db.externalImpacts[id]||[]).filter(item=>item.id!==key)};
  const recalculate=reason=>{if(Y.recalculate)Y.recalculate(reason);else{persist();render();}};

  Object.assign(functionHelp,{
    mapping:{title:'AI 語意欄位對應',intro:'AI 依欄位名稱與內容線索，建議對應到平台的標準欄位。',steps:['實際讀取 Excel、CSV 或固定格式文件。','比較不同局處的非標準欄名與平台欄位。','顯示信心分數與判斷理由；低信心項目標示待覆核。','承辦人可調整對應，確認後才寫入 Demo。'],note:'目前使用可解釋的 Demo AI 規則，不呼叫付費模型；所有建議都必須人工確認。'},
    import:{title:'AI 智慧資料匯入',intro:'將不同局處提供的 Excel、CSV 或文件整理為一致的園所資料。',steps:['勾選本次需要的資料類別。','實際讀取本機檔案並找出表頭。','Demo AI 建議欄位對應並標示信心分數。','人工確認資料列後才匯入，並立即重算統計與風險。'],note:'檔案在瀏覽器本機處理；確認匯入後的資料與操作紀錄會保存，重新整理後仍可繼續。'},
    signature:{title:'個人電子簽名',intro:'匯入承辦人的簽名圖片，放入正式 A4 稽核交辦單。',steps:['設定姓名、職稱與所屬局處。','讀取 PNG／JPG 簽名並立即預覽。','匯出前再次確認簽署人與交付局處。','下載的 PDF 帶入簽名影像與產製時間。'],note:'簽名會隨案件設定保存；重新整理後仍會保留，可隨時重新匯入或使用手動重設。'},
    pdf:{title:'含簽名 PDF 交辦',intro:'把案件、覆核、AI 建議與後續行動整理成可交付的 A4 PDF。',steps:['填寫局處、負責人、期限與交辦說明。','預覽園所、覆核摘要、查核清單與行動。','確認承辦人簽名與產製時間。','下載「幼安雷達_稽核交辦單_YA-XXXX.pdf」。'],note:'Demo 會在瀏覽器直接產生真實 PDF 檔，不會寄送或上傳。'},
    ocr:{title:'評鑑 OCR 與合規檢核',intro:'從評鑑文件擷取待改善事項，對照法規並交由承辦人覆核。',steps:['上傳 PDF、掃描圖片或文件。','Demo OCR 擷取關鍵文字與改善事項。','顯示可能涉及的法規與風險影響。','結果加入園所 360 與風險理由，但仍須人工確認。'],note:'掃描件使用合成 OCR 結果展示流程，畫面會清楚標示 Demo AI。'},
    sentiment:{title:'AI 輿情預警',intro:'將公開新聞與討論整理成可查證的事件線索。',steps:['彙整公開來源的標題、摘要與日期。','去除同一事件的重複內容。','標示負向分數與嚴重度。','保留來源連結，供承辦人交叉查證。'],note:'所有項目均標示「未經查證之公開線索」，不能直接作為裁處依據。'},
    lifecycle:{title:'案件生命週期與結果回填',intro:'從待查核到結案，完整保留行動、證據與處理結果。',steps:['待查核案件先指定局處與負責人。','調查中可新增任務、期限與紀錄。','待補件追蹤缺少的文件。','完成行動後回填現場事實、裁處與改善要求，才可結案。'],note:'結案結果會回到園所時間軸並更新風險分數。'},
    security:{title:'敏感資料與檔案保護',intro:'展示部署時如何避免公開檔案、外洩憑證與暴露個資。',steps:['檔案儲存桶阻擋公開存取並使用 SSE-S3 加密。','下載檔案使用短效預簽網址。','API 遮罩身分證、手機與 Email。','CI 掃描常見金鑰與危險 TLS 設定。'],note:'介面只顯示控制狀態；雲端資源由 infra 範本建立。'}
  });

  /* Issue #8: actual file parsing remains in youan-p0.js; this layer adds semantic suggestions. */
  const normalize=value=>{let label=String(value??'').trim().replace(/[\s_\-\/（）()：:\[\]]/g,'').toLowerCase();for(const [source,target] of Object.entries({全稱:'名稱',所在:'',核准:'核定',容量:'人數',聯繫:'聯絡'}))label=label.replaceAll(source,target);return label};
  const localSemanticMapping=()=>{
    const st=importSession,result={};
    for(const field of importFields()){
      let best={index:-1,confidence:0,reason:'找不到可信對應，請人工選擇'};
      for(const [index,header] of st.headers.entries()){
        const h=normalize(header);
        for(const alias of [...field[2],field[1]]){
          const a=normalize(alias);let score=0;
          if(h&&h===a)score=99;
          else if(h&&a&&(h.includes(a)||a.includes(h)))score=88;
          else if(h&&a){const chars=[...new Set(a)],same=chars.filter(c=>h.includes(c)).length;score=Math.round(same/Math.max(chars.length,1)*68);}
          if(score>best.confidence)best={index,confidence:score,reason:`「${header}」與「${alias}」語意接近`};
        }
      }
      result[field[0]]=best;
    }
    return result;
  };
  async function applySemanticMapping(){
    const st=importSession;if(st.step!==2||!st.headers?.length)return;
    st.aiBusy=true;renderImport();
    let provider='瀏覽器內 Demo AI',server=[];
    try{const response=await apiPost('/api/ai/field-map',{headers:st.headers,categories:st.categories});provider=response.provider||provider;server=response.suggestions||[];}catch{}
    const suggestions=localSemanticMapping(),used=new Set();
    for(const field of importFields()){
      const key=field[0],item=suggestions[key];
      const serverHit=server.find(x=>x.source===st.headers[item.index]&&(x.target===key||normalize(x.reason).includes(normalize(field[1]))));
      if(serverHit&&serverHit.confidence>item.confidence){item.confidence=serverHit.confidence;item.reason=serverHit.reason;}
      if(item.index>=0&&item.confidence>=52&&!used.has(item.index)){st.mapping[key]=item.index;st.selected[key]=true;used.add(item.index);}else if(key!=='name'&&st.mapping[key]<0)st.selected[key]=false;
    }
    st.aiMapping=suggestions;st.aiProvider=provider;st.aiBusy=false;renderImport();
    toast('Demo AI 已提出欄位對應；低信心項目請人工覆核');
  }
  const baseRecognize=recognizeFile;
  recognizeFile=async file=>{await baseRecognize(file);if(importSession.step===2)await applySemanticMapping()};
  const baseDemoImport=Y.demoImport;
  Y.demoImport=()=>{baseDemoImport();applySemanticMapping()};
  const baseUploadPanel=uploadPanel;
  uploadPanel=()=>baseUploadPanel()
    .replace('真實讀取本機檔案，人工確認後才更新；未串接 AI 或雲端。','真實讀取本機檔案，由 Demo AI 建議欄位對應，人工確認後才更新。')
    .replace('CSV、Excel、JSON；文字 PDF／Word／TXT 支援一行一欄的固定格式。掃描 PDF 尚不支援。','CSV、Excel、JSON；文字 PDF／Word／TXT 支援固定格式。評鑑掃描件請到園所詳情使用 OCR。')
    .replace('目前只在瀏覽器本機處理，來源摘錄會保存於本機。請使用合規或合成資料；本機功能完成不代表允許將財務或個資上傳競賽 AWS。','檔案內容只在本頁處理；同源 Demo API 只接收欄位名稱。請使用合規或合成資料。');
  const baseSwitchImportSheet=switchImportSheet;
  switchImportSheet=value=>{baseSwitchImportSheet(value);if(importSession.step===2)applySemanticMapping()};
  Y.mappingChanged=(key,value)=>{
    importSession.mapping[key]=Number(value);
    const source=importSession.headers[Number(value)]||'未指定';
    importSession.aiMapping||={};
    importSession.aiMapping[key]={index:Number(value),confidence:100,reason:`承辦人手動指定「${source}」`,manual:true};
    updateMappingExample(key);
    renderImport();
  };
  mappingPanel=()=>{
    const st=importSession,fields=importFields(),recognized=fields.filter(f=>st.mapping[f[0]]>=0).length;
    const review=fields.filter(f=>st.selected[f[0]]&&((st.aiMapping?.[f[0]]?.confidence||0)<75)).length;
    return `<div class="panel"><div class="panel-head"><div><h2>AI 欄位對應，請人工確認</h2><p>${esc(st.file)} · ${st.rows.length} 筆 · 已對應 ${recognized} 個欄位</p></div><button onclick="importSession.step=1;renderImport()">重新選擇檔案</button></div><div class="pad"><label class="field">工作表／資料表<select aria-label="工作表" onchange="switchImportSheet(this.value)">${st.sheets.map((s,i)=>`<option value="${i}" ${st.sheetIndex===i?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label><div class="ai-banner"><div><strong>${st.aiBusy?'Demo AI 正在比對…':'已完成可解釋的語意比對'}</strong><p>${review?`${review} 個低信心項目需要人工覆核。`:'目前建議皆可進一步確認；仍不會自動匯入。'}</p></div><span class="pill">${esc(st.aiProvider||'Demo AI')}</span></div><div id="mapping-error" class="form-error" role="alert"></div></div><div class="table-wrap"><table class="mapping-table"><thead><tr><th>匯入</th><th>平台欄位／AI 理由</th><th>檔案欄位</th><th>內容範例</th></tr></thead><tbody>${fields.map(f=>{const a=st.aiMapping?.[f[0]],confidence=a?.confidence||0,kind=confidence>=75?'':confidence?'review':'none';return `<tr><td><input type="checkbox" aria-label="匯入${esc(f[1])}" ${st.selected[f[0]]?'checked':''} ${f[0]==='name'?'disabled':''} onchange="importSession.selected['${f[0]}']=this.checked"></td><td><b>${esc(f[1])}${f[0]==='name'?' *':''}</b><small>${esc(a?.reason||'尚未執行語意比對')}</small><span class="confidence ${kind}">${a?.manual?'人工指定':confidence?`AI 信心 ${confidence}%`:'待人工選擇'}</span></td><td><select aria-label="對應${esc(f[1])}" onchange="Y.mappingChanged('${f[0]}',this.value)"><option value="-1">請選擇檔案欄位</option>${st.headers.map((h,i)=>`<option value="${i}" ${st.mapping[f[0]]===i?'selected':''}>${esc(h)}</option>`).join('')}</select></td><td><small id="example-${f[0]}">${mappingExample(f[0])}</small></td></tr>`}).join('')}</tbody></table></div><div class="import-actions"><small>AI 只提出建議；園所名稱與資料年度必填，低信心欄位請人工確認。</small><button class="primary" onclick="buildImportPreview()">下一步：預覽整理結果 →</button></div></div>`;
  };

  /* Issue #13: surface implemented controls without exposing deployment secrets. */
  Y.securityDetails=()=>openModal('資安與合規控制',`<div class="security-grid"><div class="security-control"><b>私有檔案</b><small>S3 阻擋所有公開存取</small></div><div class="security-control"><b>靜態加密</b><small>SSE-S3（AES-256）</small></div><div class="security-control"><b>短效下載</b><small>預簽網址到期後失效</small></div><div class="security-control"><b>敏感資料</b><small>身分證、手機、Email 遮罩</small></div></div><div class="notice">Demo 不保存 AWS 金鑰；部署使用執行個體角色或環境密鑰。CI 會掃描常見憑證格式與停用 TLS 驗證的程式碼。</div><div class="form-actions"><button class="primary" onclick="closeModal()">了解</button></div>`);
  const baseAssignedSettings=settings;
  settings=()=>{baseAssignedSettings();if(!document.querySelector('.security-card'))document.querySelector('#page')?.insertAdjacentHTML('beforeend',`<section class="panel security-card"><div class="panel-head"><div><h2>資安與敏感資料保護</h2><p>部署控制已納入範本；Demo 狀態會持久保存。</p></div><button onclick="Y.securityDetails()">查看控制說明</button></div><div class="security-grid"><div class="security-control"><b>Public Access Block</b><small>四項全部啟用</small></div><div class="security-control"><b>SSE-S3</b><small>AES-256 靜態加密</small></div><div class="security-control"><b>PII Masking</b><small>API 回傳前可遮罩</small></div><div class="security-control"><b>Secret Scan</b><small>PR 與部署前檢查</small></div></div></section>`);addFunctionHelp();};

  /* Issue #9: evaluation OCR and compliance findings. */
  const demoOcr=(text,fileName='')=>{
    const content=`${fileName} ${text}`;
    const rules=[
      ['人員與收托管理',['超收','核定人數','師生比','人員編制'],'幼兒教育及照顧法第30條',18],
      ['兒童安全與照顧',['不當管教','體罰','不當對待'],'幼兒教育及照顧法第33條',28],
      ['收費與退費',['收費','退費','超收費用'],'教保服務機構收退費辦法第6條',14],
      ['評鑑改善追蹤',['限期改善','改善事項','追蹤評鑑','待改善'],'教保服務機構評鑑辦法第8條',12],
      ['餐飲衛生',['餐點','廚房','食品','留樣'],'食品安全衛生管理法第8條',16]
    ];
    let findings=rules.flatMap(([category,words,clause,riskImpact])=>{const hits=words.filter(word=>content.includes(word));return hits.length?[{category,summary:`文件提及「${hits.slice(0,3).join('、')}」，建議列入人工覆核。`,clause,riskImpact,evidence:`關鍵詞：${hits.slice(0,3).join('、')}`,verified:false}]:[]});
    if(!findings.length)findings=[{category:'文件完整性',summary:'未辨識明確缺失，請承辦人檢視原始頁面。',clause:'需人工判讀',riskImpact:0,evidence:'Demo OCR 未取得足夠文字',verified:false}];
    return {demo:true,provider:'瀏覽器內 Demo OCR',document:fileName||'未命名文件',findings,notice:'AI 輔助擷取結果須由承辦人覆核後才能作為正式依據。'};
  };
  async function extractEvaluationText(file){
    const ext=(file?.name.split('.').pop()||'').toLowerCase();
    if(['txt','csv','json'].includes(ext))return (await file.text()).slice(0,100000);
    if(ext==='docx'){
      const zip=await JSZip.loadAsync(await file.arrayBuffer()),part=zip.file('word/document.xml');
      if(!part)return '';
      const doc=new DOMParser().parseFromString(await part.async('string'),'application/xml');
      return Array.from(doc.getElementsByTagNameNS('*','t')).map(node=>node.textContent).join(' ').slice(0,100000);
    }
    if(ext==='pdf'){
      const pdfjs=await import('./vendor/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc=new URL('vendor/pdf.worker.mjs',document.querySelector('script[src*="youan-p0.js"]').src).href;
      const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false});
      const doc=await task.promise,parts=[];
      try{for(let i=1;i<=Math.min(doc.numPages,30);i++){const page=await doc.getPage(i),content=await page.getTextContent();parts.push(content.items.map(item=>item.str||'').join(' '));}}finally{await doc.destroy();}
      return parts.join('\n').slice(0,100000);
    }
    return '';
  }
  async function analyzeEvaluation(file,text){
    let content=text;
    if(!content.trim()&&/\.(png|jpe?g|pdf)$/i.test(file?.name||''))content='【掃描影像 Demo OCR】評鑑結果待改善；改善事項：補齊人員編制資料，師生比與核定人數待查。';
    try{return await apiPost('/api/ai/ocr-check',{filename:file?.name||'',text:content})}catch{return demoOcr(content,file?.name||'')}
  }
  function applyOcrFinding(schoolId,recordId,analysis){
    db.ocrFindings[schoolId]||=[];
    const item={recordId,at:stamp(),...analysis};
    const index=db.ocrFindings[schoolId].findIndex(x=>x.recordId===recordId);
    if(index<0)db.ocrFindings[schoolId].unshift(item);else db.ocrFindings[schoolId][index]=item;
    const delta=Math.min(24,Math.max(0,...analysis.findings.map(f=>Number(f.riskImpact||0))));
    if(delta)setImpact(schoolId,{id:'ocr-evaluation',name:'評鑑文件待改善事項',dimension:'法遵／裁罰／評鑑',delta,formula:`Demo OCR 擷取待改善事項，風險調整 +${delta} 分`,action:'查看評鑑原文並覆核法規對照'});
    persist();
  }
  let evaluationContext={schoolId:0,year:115};
  const baseEvaluations=Y.evaluations;
  Y.evaluations=(id,year)=>{evaluationContext={schoolId:id,year:Number(year)||115};baseEvaluations(id,year);setTimeout(()=>{document.querySelectorAll('.evaluation-list .source-card').forEach(card=>{const file=card.querySelector('small')?.textContent;if((db.ocrFindings[evaluationContext.schoolId]||[]).some(x=>x.document===file))card.insertAdjacentHTML('afterbegin','<span class="confidence">AI 已擷取</span> ');});addFunctionHelp();},0)};
  const baseUploadEvaluation=Y.uploadEvaluation;
  Y.uploadEvaluation=async event=>{
    event.preventDefault();
    const form=event.currentTarget||event.target,file=form.elements.file?.files?.[0],id=evaluationContext.schoolId,year=Number(form.elements.year?.value||evaluationContext.year);
    let text='';try{text=await extractEvaluationText(file)}catch{}
    await baseUploadEvaluation(event);
    const record=(db.evaluationFiles?.[id]||[]).filter(r=>!r.demo&&r.fileName===file?.name&&r.year===year).sort((a,b)=>(b.at||'').localeCompare(a.at||''))[0];
    if(!record)return;
    const analysis=await analyzeEvaluation(file,text);record.aiAnalysis=analysis;applyOcrFinding(id,record.id,analysis);recalculate('評鑑 OCR 與合規檢核更新');
    Y.evaluations(id,year);toast(`已擷取 ${analysis.findings.length} 項檢核結果，請人工覆核`);
  };
  const baseViewEvaluation=Y.viewEvaluation;
  Y.viewEvaluation=(schoolId,recordId)=>{
    const record=db.evaluationFiles?.[schoolId]?.find(r=>r.id===recordId);
    if(record?.publicSummary){openModal('教育部評鑑摘要',`<h3>${esc(schoolById(schoolId).name)}</h3><pre style="white-space:pre-wrap">${esc(record.text)}</pre><div class="notice">此為公開結果摘要，非原始評鑑文件；可另上傳文件進行 OCR。</div>`);return;}
    let analysis=record?.aiAnalysis||(db.ocrFindings[schoolId]||[]).find(x=>x.recordId===recordId);
    if(!analysis&&record?.demo){analysis=demoOcr(record.text||'待改善 改善事項 設施設備維護',record.fileName);record.aiAnalysis=analysis;applyOcrFinding(schoolId,recordId,analysis);}
    if(!analysis){baseViewEvaluation(schoolId,recordId);return;}
    const viewer=document.getElementById('evaluation-checklist');
    viewer.innerHTML=`<div class="dialog-head"><div><h2 id="checklist-title">評鑑 OCR 與合規檢核</h2><small>${esc(schoolById(schoolId).name)} · ${esc(record?.title||analysis.document)}</small></div><button aria-label="關閉" onclick="document.getElementById('evaluation-checklist').close()">×</button></div><div class="dialog-body"><div class="ai-banner"><div><strong>${esc(analysis.provider||'Demo OCR')}</strong><p>${esc(analysis.notice||'結果待人工覆核。')}</p></div><span class="pill">Demo AI</span></div>${record?.text?`<details><summary>查看文件原文</summary><pre style="white-space:pre-wrap">${esc(record.text)}</pre></details>`:''}<div class="finding-list">${analysis.findings.map(f=>`<article class="finding ${Number(f.riskImpact)>=20?'high':''}"><h3>${esc(f.category)}</h3><p>${esc(f.summary)}</p><footer><span>${esc(f.clause)}</span><span>風險影響 +${Number(f.riskImpact||0)} 分</span><span>${esc(f.evidence)}</span></footer></article>`).join('')}</div><div class="notice">法規對照為 Demo 輔助結果；承辦人仍須核對原始文件、適用日期與完整條文。</div></div>`;
    viewer.showModal();
  };

  if(!db.ocrFindings[0]?.length){
    const seeded=demoOcr('評鑑結果待改善。改善事項：生師比與人員編制資料待補齊；限期改善。','115年度基本評鑑檢核表_示範.txt');
    applyOcrFinding(0,'demo-initial-0',seeded);
  }

  /* Issue #11: visibly unverified public-clue timeline. */
  const demoClues={
    0:[
      {title:'【合成示範】家長社群討論疑似人力配置不足',source:'示範地方討論區',date:'2026-09-10',url:'https://example.com/demo-clue-001',excerpt:'多則討論提到接送時段人力吃緊，內容尚未查證。'},
      {title:'【合成示範】園所回應人員配置爭議',source:'示範地方新聞',date:'2026-09-10',url:'https://example.com/demo-clue-002',excerpt:'園所表示將補充資料；事件與社群討論可能為同一爭議。'},
      {title:'【合成示範】家長投訴餐點留樣紀錄不完整',source:'示範公開陳情摘要',date:'2026-09-07',url:'https://example.com/demo-clue-003',excerpt:'疑似餐點留樣紀錄缺漏，尚待主管機關查證。'}
    ],
    1:[{title:'【合成示範】收費項目說明引發討論',source:'示範社群貼文',date:'2026-09-08',url:'https://example.com/demo-clue-004',excerpt:'家長詢問延托費與其他收費，尚無違規結論。'}]
  };
  const localSentiment=events=>{
    const terms={受傷:24,體罰:34,不當管教:32,超收:20,違規:18,投訴:12,爭議:10,疑似:5,不足:8};
    const seen=new Set(),rows=[];
    for(const event of events){const key=normalize(event.title).slice(0,24)+'|'+event.date;if(seen.has(key))continue;seen.add(key);const score=Math.min(100,8+Object.entries(terms).reduce((n,[word,value])=>n+(`${event.title} ${event.excerpt}`.includes(word)?value:0),0));rows.push({...event,id:key,negativeScore:score,severity:score>=55?'高':score>=28?'中':'低',label:'未經查證之公開線索',aiSummary:`偵測到${score>=55?'高':score>=28?'中':'低'}度負向訊號，建議與正式陳情或查核紀錄交叉比對。`});}return rows.sort((a,b)=>b.date.localeCompare(a.date));
  };
  for(const [id,items] of Object.entries(demoClues))if(!db.sentimentEvents[id])db.sentimentEvents[id]=localSentiment(items);
  // Deliberately fictional fixtures, separate from public evaluation summaries.
  function seedHaishanDemo(){
    const id='REAL-012';
    db.sentimentEvents||={};db.ocrFindings||={};db.evaluationFiles||={};db.externalImpacts||={};
    const clues=[
      {title:'【虛構示範】接送時段人力安排疑問',date:'2026-09-12',excerpt:'模擬家長詢問接送時段人力是否不足，承辦人可進一步調閱排班表。'},
      {title:'【虛構示範】延托收費說明討論',date:'2026-09-10',excerpt:'模擬家長對延托收費說明提出疑問，待比對公告與收費單據。'},
      {title:'【虛構示範】餐點紀錄補件追蹤',date:'2026-09-08',excerpt:'模擬餐點留樣紀錄補件情境，展示事件追蹤與資料查證流程。'}
    ].map((e,i)=>({...e,demo:true,id:'haishan-demo-clue-'+i,source:'虛構情境，無真實新聞來源',url:'',negativeScore:[36,20,12][i],severity:['中','低','低'][i],aiSummary:e.excerpt}));
    db.sentimentEvents[id]||=[];
    for(const e of clues)if(!db.sentimentEvents[id].some(x=>x.id===e.id))db.sentimentEvents[id].push(e);
    const recordId='haishan-demo-ocr-v1';
    db.evaluationFiles[id]||=[];db.ocrFindings[id]||=[];
    if(!db.evaluationFiles[id].some(r=>r.id===recordId)){
      const text='【完全虛構示範，非海山附幼實際事件或官方評鑑】\n115年度評鑑OCR操作示例\n第1頁：人員編制附件待補齊，請比對排班表。\n第2頁：餐點留樣紀錄待補充，請調閱紀錄。\n第3頁：改善事項列入追蹤，待承辦人覆核。';
      const findings=[
        {category:'【示範】人員編制資料',summary:'模擬辨識：人員編制附件待補齊，建議調閱排班表。',evidence:'第1頁：人員編制附件待補齊',riskImpact:18},
        {category:'【示範】餐飲紀錄',summary:'模擬辨識：餐點留樣紀錄待補充，建議查閱原始紀錄。',evidence:'第2頁：餐點留樣紀錄待補充',riskImpact:16},
        {category:'【示範】改善追蹤',summary:'模擬辨識：改善事項待人工確認與追蹤。',evidence:'第3頁：改善事項列入追蹤',riskImpact:12}
      ].map(f=>({...f,clause:'示範檢核項目；適用法規待承辦人核對',verified:false}));
      const analysis={demo:true,provider:'預先建立的虛構 Demo OCR',document:'海山_OCR操作示例_非官方.txt',findings,notice:'全部內容為虛構，不代表海山附幼存在任何缺失。單項影響供展示，本文件取最高18分，不逐項相加。'};
      db.evaluationFiles[id].push({id:recordId,year:115,date:'2026-09-12',title:'【虛構示範】評鑑 OCR 檢核文件',result:'待確認',demo:true,fileName:analysis.document,text,aiAnalysis:analysis});
      db.ocrFindings[id].push({recordId,at:stamp(),...analysis});
      setImpact(id,{id:'haishan-demo-ocr',name:'【虛構示範】OCR 文件待覆核',dimension:'法遵／裁罰／評鑑',delta:18,formula:'虛構OCR三項結果取最高18分，不累加；非官方評分',action:'開啟示範文件，核對原文與待確認事項'});
    }
  }
  seedHaishanDemo();
  Y.hydrate();persist();
  const hydrateBeforeDemo=Y.hydrate;
  Y.hydrate=()=>{seedHaishanDemo();hydrateBeforeDemo();};
  Y.refreshSentiment=async id=>{
    const raw=demoClues[id]||db.sentimentEvents[id]||[];let result;
    if(String(id)==='REAL-012'){seedHaishanDemo();persist();if(page==='detail')detail();toast('已重新整理虛構示範輿情，未查詢真實新聞');return;}
    try{result=await apiPost('/api/ai/sentiment',{events:raw})}catch{result={events:localSentiment(raw),provider:'瀏覽器內 Demo 情緒分析'}}
    db.sentimentEvents[id]=result.events;persist();if(page==='detail'&&String(id)===String(selected))detail();toast('Demo AI 已完成去重與嚴重度分析');
  };

  function ocrPanel(id){
    const groups=db.ocrFindings[id]||[],findings=groups.flatMap(group=>group.findings||[]);
    return `<section class="panel"><div class="panel-head"><div><h2>評鑑 OCR 與合規檢核</h2><p>從文件擷取待改善事項，連回可能適用的法規。</p></div><button onclick="Y.evaluations(${esc(JSON.stringify(id))})">查看／上傳文件</button></div>${findings.length?`<div class="finding-list">${findings.slice(0,4).map(f=>`<article class="finding ${Number(f.riskImpact)>=20?'high':''}"><h3>${esc(f.category)}</h3><p>${esc(f.summary)}</p><footer><span>${esc(f.clause)}</span><span>風險影響 +${Number(f.riskImpact||0)} 分</span></footer></article>`).join('')}</div>`:'<div class="pad muted">尚無 OCR 擷取結果，可上傳評鑑文件開始分析。</div>'}<div class="notice ocr-notice">Demo AI 輔助結果，須核對原始文件與完整法規。</div><div style="height:14px"></div></section>`;
  }
  function sentimentPanel(id){
    const events=db.sentimentEvents[id]||[];
    return `<section class="panel"><div class="panel-head"><div><h2>AI 輿情預警時間軸</h2><p>事件線索與示範情境分開標示，須人工查證。</p></div><button onclick="Y.refreshSentiment(${esc(JSON.stringify(id))})">重新分析</button></div><div class="clue-timeline">${events.length?events.map(event=>{const url=event.demo?'':safeUrl(event.url);return `<article class="clue ${event.severity==='高'?'high':''}"><div class="clue-meta"><span>${esc(event.date||'日期不明')}</span><span class="unverified">${event.demo?'虛構示範，非真實事件':'未經查證之公開線索'}</span><span>負向 ${Number(event.negativeScore||0)} · ${esc(event.severity||'低')}</span></div><h3>${esc(event.title)}</h3><p>${esc(event.aiSummary||event.excerpt||'')}</p><div class="clue-meta"><span>${esc(event.source||'公開來源')}</span>${url?`<a class="source-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">查看來源 ↗</a>`:''}</div></article>`}).join(''):'<div class="pad muted">目前沒有公開線索。</div>'}</div><div class="notice ocr-notice">公開線索僅供決定是否進一步查核，不代表事件屬實。</div><div style="height:14px"></div></section>`;
  }
  function auditResultPanel(id,forDetail=false){
    const result=db.auditResults[id];if(!result)return '';
    return `<section class="panel"><div class="panel-head"><div><h2>查核結果與回填紀錄</h2><p>${esc(result.closedAt||result.updatedAt)} · ${esc(result.owner||'承辦人')}</p></div><span class="result-badge">${esc(result.conclusion)}</span></div><div class="result-summary"><dl><div><dt>現場事實</dt><dd>${esc(result.facts)}</dd></div><div><dt>裁處金額</dt><dd>${Number(result.penalty||0).toLocaleString('zh-TW')} 元</dd></div><div><dt>改善要求</dt><dd>${esc(result.improvements)}</dd></div><div><dt>後續複查</dt><dd>${esc(result.nextReview||'未設定')}</dd></div></dl>${forDetail?'<div class="notice" style="margin-top:14px">本次查核結果已回寫園所風險與歷史紀錄。</div>':''}</div></section>`;
  }

  const baseAssignedDetail=detail;
  detail=()=>{
    baseAssignedDetail();const id=selected,host=document.querySelector('.detail-grid>div:first-child');if(!host)return;
    const advice=db.bedrockAdvice?.[id];
    if(advice?._provider==='local-fallback'){
      const advicePanel=Array.from(host.querySelectorAll('.panel')).find(panel=>panel.querySelector('h2')?.textContent.includes('AI 輔助查核建議'));
      if(advicePanel){
        const description=advicePanel.querySelector('.panel-head p');if(description)description.textContent='目前使用本機 Demo 專家規則；部署且具備 AWS 權限時才會呼叫 Bedrock。';
        const badge=advicePanel.querySelector('.panel-head .pill');if(badge)badge.textContent='Demo fallback';
      }
    }
    document.querySelector('.heading')?.insertAdjacentHTML('afterend',`<div class="feature-strip"><button class="feature-chip" onclick="Y.evaluations(${esc(JSON.stringify(id))})"><span class="help-icon">!</span><span><b>評鑑 OCR</b><small>上傳文件、擷取缺失與法規</small></span></button><button class="feature-chip" onclick="document.getElementById('sentiment-panel')?.scrollIntoView({behavior:'smooth'})"><span class="help-icon">!</span><span><b>輿情預警</b><small>事件去重、嚴重度與來源</small></span></button><button class="feature-chip" onclick="${db.reviews[id]?.saved?`go('case',${esc(JSON.stringify(id))})`:'arrange()'}"><span class="help-icon">!</span><span><b>查核閉環</b><small>覆核、調查、回填與結案</small></span></button></div>`);
    host.insertAdjacentHTML('beforeend',ocrPanel(id));
    host.insertAdjacentHTML('beforeend',`<div id="sentiment-panel">${sentimentPanel(id)}</div>`);
    const result=auditResultPanel(id,true);if(result)host.insertAdjacentHTML('beforeend',result);
    const headings=host.querySelectorAll('h2');headings.forEach(h=>{if(h.textContent.includes('OCR'))h.append(helpIcon('ocr'));if(h.textContent.includes('輿情'))h.append(helpIcon('sentiment'));});
  };

  /* Issue #12: case lifecycle, Kanban view, and result feedback. */
  function kanbanBoard(){
    const records=auditRecords(),stages=['待處理','調查中','待補件','已完成'];
    return `<section class="panel issue-kanban"><div class="panel-head"><div><h2>案件生命週期</h2><p>從待查核到結案，一眼看出案件卡在哪一步。</p></div></div><div class="kanban-grid">${stages.map(stage=>{const rows=records.filter(({c})=>c.stage===stage);return `<div class="kanban-col"><h3>${stageNames[stage]} <span>${rows.length}</span></h3>${rows.map(({s,c})=>`<button class="kanban-card" onclick="go('case',${esc(JSON.stringify(s.id))})"><b>${esc(s.name)}</b><small>${esc(c.owner||'未指派')} · ${esc(c.due||'未設定期限')}</small><small>${pendingActions(c).length} 項待完成</small></button>`).join('')||'<small class="muted">目前無案件</small>'}</div>`}).join('')}</div></section>`;
  }
  const baseAssignedAudit=auditPage;
  auditPage=()=>{
    baseAssignedAudit();const heading=document.querySelector('#page>.heading');heading?.insertAdjacentHTML('afterend',kanbanBoard());
    document.querySelectorAll('.audit-table .action-status').forEach(el=>{el.textContent=stageNames[el.textContent.trim()]||el.textContent});
    const metric=document.querySelector('.audit-metrics .metric span');if(metric)metric.textContent='待查核／調查中';
    const doneMetric=document.querySelector('.audit-metrics .metric:last-child span');if(doneMetric)doneMetric.textContent='已結案';
    document.querySelector('.issue-kanban h2')?.append(helpIcon('lifecycle'));
  };
  function lifecycleMarkup(stage){
    const stages=['待處理','調查中','待補件','已完成'],index=stages.indexOf(stage);
    return `<div class="lifecycle">${stages.map((item,i)=>`<div class="life-step ${i<index?'done':i===index?'active':''}">${i+1}. ${stageNames[item]}</div>`).join('')}</div>`;
  }
  const baseAssignedCase=casePage;
  casePage=()=>{
    baseAssignedCase();const c=ensureCase(caseId),heading=document.querySelector('#page>.heading');
    heading?.insertAdjacentHTML('afterend',lifecycleMarkup(c.stage));
    const headingStatus=heading?.querySelector('p');if(headingStatus)headingStatus.textContent=`${stageNames[c.stage]||c.stage} · ${c.agency||'尚未指定交辦局處'}`;
    const left=document.querySelector('.case-layout>div:first-child');if(left){const result=auditResultPanel(caseId);if(result)left.insertAdjacentHTML('beforeend',result);left.insertAdjacentHTML('beforeend',`<section class="panel"><div class="panel-head"><div><h2>查核結果回填</h2><p>記錄現場事實、裁處與改善要求；完成所有行動後才可結案。</p></div><button class="primary" onclick="Y.openCaseResult()">${db.auditResults[caseId]?'更新結果':'填寫結果'}</button></div><div class="pad"><span class="result-badge">${db.auditResults[caseId]?esc(db.auditResults[caseId].conclusion):'尚未回填'}</span></div></section>`);}
  };
  Y.openCaseResult=()=>{
    const c=ensureCase(caseId),result=db.auditResults[caseId]||{facts:'',penalty:'0',improvements:'',conclusion:'要求改善',nextReview:c.due||'',owner:c.owner||db.profile.name||''};
    openModal('查核結果回填',`<form onsubmit="Y.saveCaseResult(event)"><div id="case-result-error" class="form-error" role="alert"></div><div class="form-grid"><label class="field full">現場查核事實 *<textarea name="facts" required maxlength="6000" placeholder="記錄現場觀察、文件核對與訪談事實">${esc(result.facts)}</textarea></label><label class="field">處理結論<select name="conclusion">${options(['確認違規','要求改善','查無異常','持續追蹤'],result.conclusion)}</select></label><label class="field">裁處金額（元）<input name="penalty" type="number" min="0" step="1" value="${esc(result.penalty)}"></label><label class="field full">改善要求 *<textarea name="improvements" required maxlength="4000" placeholder="說明改善內容、期限或應補資料">${esc(result.improvements)}</textarea></label><label class="field">後續複查日期<input name="nextReview" type="date" value="${esc(result.nextReview)}"></label><label class="field">回填承辦人 *<input name="owner" required maxlength="50" value="${esc(result.owner)}"></label></div><label class="check"><input type="checkbox" name="closeCase" ${c.stage==='已完成'?'checked':''}> 所有行動完成，儲存後將案件標示為已結案</label><div class="notice">結案結果會寫入園所時間軸並重新計算風險；AI 分數仍是排序輔助。</div><div class="form-actions"><button type="button" onclick="closeModal()">取消</button><button class="primary">儲存查核結果</button></div></form>`);
  };
  Y.saveCaseResult=event=>{
    event.preventDefault();const form=event.currentTarget,data=Object.fromEntries(new FormData(form)),c=ensureCase(caseId),error=document.getElementById('case-result-error');
    if(!data.facts?.trim()||!data.improvements?.trim()||!data.owner?.trim()){error.textContent='請填寫現場事實、改善要求與承辦人。';return;}
    if(Number(data.penalty)<0||!Number.isFinite(Number(data.penalty))){error.textContent='裁處金額不可小於 0。';return;}
    if(data.closeCase&&pendingActions(c).length){error.textContent=`仍有 ${pendingActions(c).length} 項行動未完成，請先填寫處理結果。`;return;}
    const at=stamp();db.auditResults[caseId]={facts:data.facts.trim(),penalty:Number(data.penalty||0),improvements:data.improvements.trim(),conclusion:data.conclusion,nextReview:data.nextReview||'',owner:data.owner.trim(),updatedAt:at,closedAt:data.closeCase?at:''};
    if(data.closeCase)c.stage='已完成';else if(c.stage==='待處理')c.stage='調查中';
    c.timeline.unshift({at,text:`回填查核結果：${data.conclusion}；裁處 ${Number(data.penalty||0).toLocaleString('zh-TW')} 元；改善要求：${data.improvements.trim()}${data.closeCase?'；案件已結案。':''}`});
    const delta={確認違規:24,要求改善:12,持續追蹤:6,'查無異常':-10}[data.conclusion]||0;
    if(delta)setImpact(caseId,{id:'audit-result',name:'人工查核結果回填',dimension:'法遵／裁罰／評鑑',delta,formula:`查核結論「${data.conclusion}」，風險調整 ${delta>0?'+':''}${delta} 分`,action:'依查核結果追蹤改善與複查'});else removeImpact(caseId,'audit-result');
    persist();closeModal();recalculate('查核結果回填');toast(data.closeCase?'查核結果已回寫，案件已結案':'查核結果已回寫園所風險與時間軸');
  };
  const baseCaseEditModal=caseEditModal;
  caseEditModal=()=>{baseCaseEditModal();document.querySelectorAll('#modal select[name="stage"] option').forEach(option=>{option.textContent=stageNames[option.value]||option.textContent})};
  const baseSaveCase=saveCase;
  saveCase=event=>{const stage=new FormData(event.currentTarget).get('stage');if(stage==='已完成'&&!db.auditResults[caseId]){event.preventDefault();const error=document.getElementById('case-error');if(error)error.textContent='請先填寫查核結果，再將案件標示為已結案。';return;}baseSaveCase(event)};

  /* Issue #10: real signature image import and downloadable A4 PDF. */
  const readDataUrl=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('無法讀取圖片'));reader.readAsDataURL(file)});
  const loadImage=src=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('圖片格式無法解析'));image.src=src});
  readSignature=async file=>{
    if(!file)return;const error=document.getElementById('signature-error'),preview=document.getElementById('signature-preview');
    if(!['image/png','image/jpeg'].includes(file.type)||file.size>3*1024*1024){if(error)error.textContent='請選擇 3 MB 內的 PNG 或 JPG 簽名圖片。';return;}
    try{const url=await readDataUrl(file),image=await loadImage(url);if(image.width>4000||image.height>4000)throw Error('圖片尺寸不可超過 4000 × 4000');signatureDraft=url;if(preview){const node=document.createElement('img');node.src=url;node.alt='個人簽名預覽';preview.replaceChildren(node);}if(error)error.textContent='';toast('已讀取簽名圖片；儲存後可帶入 PDF');}catch(err){if(error)error.textContent=err.message;}
  };
  const baseProfileModal=profileModal;
  profileModal=()=>{baseProfileModal();const note=document.querySelector('#modal .notice');if(note)note.textContent='PNG／JPG 會實際讀取、保存並帶入 PDF；重新整理後仍會保留。';};

  function wrappedLines(ctx,text,width){
    const output=[];
    for(const paragraph of String(text??'').split(/\r?\n/)){
      if(!paragraph){output.push('');continue;}let line='';
      for(const character of paragraph){const next=line+character;if(line&&ctx.measureText(next).width>width){output.push(line);line=character;}else line=next;}
      if(line)output.push(line);
    }
    return output;
  }
  async function renderReportCanvases(d){
    const WIDTH=1240,HEIGHT=1754,MARGIN=108,BOTTOM=120,pages=[];let canvas,ctx,y;
    const createPage=()=>{canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,WIDTH,HEIGHT);ctx.fillStyle='#1f3853';ctx.fillRect(0,0,WIDTH,20);ctx.fillStyle='#294b6f';ctx.font='700 24px sans-serif';ctx.fillText('幼安雷達｜稽核交辦單',MARGIN,75);ctx.textAlign='right';ctx.fillStyle='#8b5d19';ctx.font='700 18px sans-serif';ctx.fillText('DEMO 展示文件',WIDTH-MARGIN,72);ctx.textAlign='left';y=118;pages.push(canvas);};
    const ensure=height=>{if(y+height>HEIGHT-BOTTOM)createPage()};
    const rule=()=>{ctx.strokeStyle='#d8e0e8';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(MARGIN,y);ctx.lineTo(WIDTH-MARGIN,y);ctx.stroke();y+=22};
    const title=(text,size=33)=>{ensure(size+30);ctx.fillStyle='#182d43';ctx.font=`700 ${size}px sans-serif`;for(const line of wrappedLines(ctx,text,WIDTH-MARGIN*2)){ctx.fillText(line,MARGIN,y);y+=size+9;}y+=7};
    const label=text=>{ensure(48);ctx.fillStyle='#294b6f';ctx.font='700 22px sans-serif';ctx.fillText(text,MARGIN,y);y+=35};
    const paragraph=(text,{size=20,color='#26394b',indent=0,gap=16}={})=>{ctx.font=`${size}px sans-serif`;ctx.fillStyle=color;const lines=wrappedLines(ctx,text,WIDTH-MARGIN*2-indent);for(const line of lines){ensure(size+13);ctx.fillText(line,MARGIN+indent,y);y+=size+12;}y+=gap};
    const pair=(left,right)=>{ensure(60);ctx.fillStyle='#607386';ctx.font='18px sans-serif';ctx.fillText(left,MARGIN,y);ctx.fillStyle='#1f3347';ctx.font='700 19px sans-serif';ctx.fillText(right,MARGIN+220,y);y+=39};
    createPage();const school=schoolById(d.id),review=db.reviews[d.id]||{},c=ensureCase(d.id),result=db.auditResults[d.id];
    title(school.name,38);paragraph(`案件編號 ${caseNumber(school.id)}　｜　產製時間 ${d.date}`,{size:18,color:'#607386'});rule();
    label('交辦資訊');pair('交付局處',d.agency);pair('負責人',d.owner);pair('處理期限',d.due);pair('案件狀態',stageNames[c.stage]||c.stage);rule();
    label('園所與交辦說明');paragraph(`${school.type}｜${school.district}｜核定 ${school.capacity} 人\n${school.address}`);paragraph(d.purpose,{color:'#1f3347'});rule();
    label('人工覆核摘要');paragraph(`${review.status||'尚未覆核'}｜${review.owner||'未指派'}\n${review.note||'未填寫覆核備註'}`);rule();
    label('AI 輔助查核清單');const checklist=reasons(school).slice(0,6);if(checklist.length)checklist.forEach((item,index)=>paragraph(`${index+1}. ${item.title}\n建議：${item.action}`,{indent:18,size:19,gap:10}));else paragraph('目前沒有 AI 建議。');
    const ocr=(db.ocrFindings[d.id]||[]).flatMap(group=>group.findings||[]).slice(0,4);if(ocr.length){rule();label('評鑑 OCR 待覆核事項');ocr.forEach((item,index)=>paragraph(`${index+1}. ${item.summary}\n法規對照：${item.clause}`,{indent:18,size:18,gap:10}));}
    rule();label('後續調查行動');if(c.actions.length)c.actions.forEach((action,index)=>paragraph(`${index+1}. ${action.title}\n${action.status}｜${action.owner||'未指派'}｜${action.due||'未設定期限'}${action.note?'\n結果：'+action.note:''}`,{indent:18,size:18,gap:10}));else paragraph('尚無後續行動。');
    if(result){rule();label('查核結果回填');paragraph(`結論：${result.conclusion}\n現場事實：${result.facts}\n裁處金額：${Number(result.penalty||0).toLocaleString('zh-TW')} 元\n改善要求：${result.improvements}\n後續複查：${result.nextReview||'未設定'}`);}
    rule();label('承辦人電子簽名');ensure(220);paragraph(`${d.profile.department}｜${d.profile.title||'承辦人'}｜${d.profile.name}\n簽署時間：${d.date}`,{size:18,gap:6});
    try{const signature=await loadImage(d.profile.signature);ctx.drawImage(signature,MARGIN,y,360,Math.min(140,360*signature.height/signature.width));y+=155;}catch{paragraph('簽名影像無法顯示');}
    paragraph('AI 分析與公開線索僅供查核排序及輔助判斷，不作為違法認定或行政裁處的直接依據。',{size:15,color:'#6b7885'});
    pages.forEach((page,index)=>{const g=page.getContext('2d');g.strokeStyle='#d8e0e8';g.beginPath();g.moveTo(MARGIN,HEIGHT-76);g.lineTo(WIDTH-MARGIN,HEIGHT-76);g.stroke();g.fillStyle='#6b7885';g.font='15px sans-serif';g.fillText(`${caseNumber(school.id)}｜幼安雷達 Demo`,MARGIN,HEIGHT-45);g.textAlign='right';g.fillText(`第 ${index+1} / ${pages.length} 頁`,WIDTH-MARGIN,HEIGHT-45);});
    return pages;
  }
  const canvasJpeg=canvas=>new Promise((resolve,reject)=>canvas.toBlob(async blob=>{if(!blob){reject(Error('無法建立 PDF 頁面'));return;}resolve(new Uint8Array(await blob.arrayBuffer()));},'image/jpeg',0.92));
  const concatBytes=arrays=>{const size=arrays.reduce((n,a)=>n+a.length,0),output=new Uint8Array(size);let offset=0;for(const array of arrays){output.set(array,offset);offset+=array.length;}return output};
  async function canvasesToPdf(canvases){
    const images=await Promise.all(canvases.map(canvasJpeg)),encoder=new TextEncoder(),chunks=[];let length=0;
    const add=value=>{const bytes=typeof value==='string'?encoder.encode(value):value;chunks.push(bytes);length+=bytes.length};
    const count=2+images.length*3,offsets=Array(count+1).fill(0),object=(id,body)=>{offsets[id]=length;add(`${id} 0 obj\n${body}\nendobj\n`)};
    add('%PDF-1.4\n%âãÏÓ\n');object(1,'<< /Type /Catalog /Pages 2 0 R >>');
    object(2,`<< /Type /Pages /Count ${images.length} /Kids [${images.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] >>`);
    images.forEach((image,index)=>{const page=3+index*3,content=page+1,imageId=page+2,commands=encoder.encode('q 595.28 0 0 841.89 0 0 cm /Im0 Do Q');object(page,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${content} 0 R >>`);offsets[content]=length;add(`${content} 0 obj\n<< /Length ${commands.length} >>\nstream\n`);add(commands);add('\nendstream\nendobj\n');offsets[imageId]=length;add(`${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width 1240 /Height 1754 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`);add(image);add('\nendstream\nendobj\n');});
    const xref=length;add(`xref\n0 ${count+1}\n0000000000 65535 f \n`);for(let i=1;i<=count;i++)add(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);add(`trailer\n<< /Size ${count+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);return new Blob([concatBytes(chunks)],{type:'application/pdf'});
  }
  const basePrepareReport=prepareReport;
  prepareReport=async event=>{await basePrepareReport(event);const button=Array.from(document.querySelectorAll('#modal button')).find(node=>node.getAttribute('onclick')==='downloadReport()');if(button)button.textContent='下載 A4 PDF';document.querySelector('.report-paper')?.insertAdjacentHTML('afterbegin','<div class="pdf-proof">將產生真實 PDF 與簽名影像</div>');};
  downloadReport=async()=>{
    const d=exportDraft;if(!d?.profile?.signature){toast('請先設定承辦人簽名');return;}const button=Array.from(document.querySelectorAll('#modal button')).find(node=>node.getAttribute('onclick')==='downloadReport()');if(button){button.disabled=true;button.textContent='正在產生 PDF…';}
    try{const canvases=await renderReportCanvases(d),pdf=await canvasesToPdf(canvases),reportNumber=caseNumber(d.id),filename=`幼安雷達_稽核交辦單_${reportNumber}.pdf`,c=ensureCase(d.id);downloadBlob(pdf,filename);Object.assign(c,{agency:d.agency,owner:d.owner,due:d.due});c.timeline.unshift({at:stamp(),text:`已產生含簽名 A4 PDF；交付 ${d.agency}，簽署人 ${d.profile.name}。`});persist();openModal('PDF 已下載',`<div class="success-mark">✓</div><h2>含簽名交辦單已產生</h2><p style="margin-top:12px">${esc(filename)}</p><p class="muted">共 ${canvases.length} 頁 · 已附 ${esc(d.profile.name)} 的簽名與產製時間</p><div class="form-actions"><button class="primary" onclick="closeModal();go('case',${esc(JSON.stringify(d.id))})">回到案件</button></div>`);}catch(error){toast('PDF 產生失敗：'+error.message);if(button){button.disabled=false;button.textContent='重新產生 PDF';}}
  };

  const demoBadge=document.querySelector('.topline .demo');if(demoBadge)demoBadge.textContent='Demo AI · 合成資料 · 自動保存';
  recalculate('載入 OCR 與案件回填示範');
})();
