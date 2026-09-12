/* Annual evaluation documents. Uploaded bytes stay in IndexedDB on this device. */
(() => {
  db.evaluationFiles ||= {};
  let currentSchool=null, currentYear=115, busy=false;
  const dateLabel=y=>`${y} 年（${y+1911}）`;
  function entries(id){
    if(!db.evaluationFiles[id]){
      db.evaluationFiles[id]=Number(id)<22?[
        {id:'demo-initial-'+id,year:115,date:'2026-03-18',title:'115 年度基本評鑑檢核表',result:'待改善',demo:true,fileName:'115年度基本評鑑檢核表_示範.txt',text:'【合成示範文件，非官方評鑑紀錄】\n115 年度基本評鑑檢核表\n園所：'+schoolById(id).name+'\n評鑑日期：2026-03-18\n評鑑結果：待改善\n示範待確認事項：設施設備維護紀錄未齊全。\n資料僅供原型操作展示。'},
        {id:'demo-followup-'+id,year:115,date:'2026-08-20',title:'115 年度改善追蹤紀錄',result:'符合',demo:true,fileName:'115年度改善追蹤紀錄_示範.txt',text:'【合成示範文件，非官方評鑑紀錄】\n115 年度改善追蹤紀錄\n園所：'+schoolById(id).name+'\n評鑑日期：2026-08-20\n評鑑結果：符合\n示範追蹤結果：已補齊設施設備維護紀錄。\n資料僅供原型操作展示。'},
        {id:'demo-previous-'+id,year:114,date:'2025-05-15',title:'114 年度基本評鑑檢核表',result:'符合',demo:true,fileName:'114年度基本評鑑檢核表_示範.txt',text:'【合成示範文件，非官方評鑑紀錄】\n114 年度基本評鑑檢核表\n園所：'+schoolById(id).name+'\n評鑑日期：2025-05-15\n評鑑結果：符合\n資料僅供原型操作展示。'}
      ]:[];
      persist();
    }
    const s=schoolById(id);
    for(const [i,e] of (s?.external?s.evaluations:[]).entries()){
      const rid='public-'+id+'-'+i;
      if(!db.evaluationFiles[id].some(r=>r.id===rid))db.evaluationFiles[id].push({id:rid,year:Number(e.year)||115,date:e.date||'',title:`${e.year||''} 學年度教育部評鑑摘要`,result:e.result||'待確認',publicSummary:true,fileName:`${e.year||''}_教育部評鑑摘要.txt`,text:`園所：${s.name}\n學年度：${e.year||'未提供'}\n結果：${e.result||'未提供'}\n來源：${s.sourceUrl||'教育部全國教保資訊網'}\n此為公開結果摘要，非原始評鑑文件。`});
    }
    return db.evaluationFiles[id];
  }
  function openStorage(){return new Promise((resolve,reject)=>{const request=indexedDB.open('youan-evaluation-files',1);request.onupgradeneeded=()=>request.result.createObjectStore('files');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  async function storage(mode,key,value){const conn=await openStorage();try{return await new Promise((resolve,reject)=>{const t=conn.transaction('files',mode),store=t.objectStore('files');const r=mode==='readonly'?store.get(key):value===undefined?store.delete(key):store.put(value,key);let result;r.onsuccess=()=>result=r.result;t.oncomplete=()=>resolve(result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('檔案保存失敗'));});}finally{conn.close();}}
  Y.evaluations=(id,year)=>{currentSchool=id;const all=entries(id);currentYear=Number(year)||Math.max(...all.map(r=>r.year),...(all.length?[]:[115]));draw();};
  function draw(){
    const all=entries(currentSchool),rows=all.filter(x=>x.year===currentYear).sort((a,b)=>b.date.localeCompare(a.date));
    const years=[...new Set([115,114,113,currentYear,...all.map(x=>x.year)])].sort((a,b)=>b-a);
    openModal(schoolById(currentSchool).name+' · 年度評鑑資料',`<div class="evaluation-toolbar"><label>評鑑年度 <select aria-label="評鑑年度" onchange="Y.evaluations(${esc(JSON.stringify(currentSchool))},this.value)">${years.map(y=>`<option value="${y}" ${y===currentYear?'selected':''}>${dateLabel(y)}</option>`).join('')}</select></label></div><p class="data-hint">預設顯示最新有紀錄年度。教育部摘要與上傳原始文件分開標示，可切換年度查看。</p><div class="evaluation-list">${rows.map(r=>`<article class="source-card"><h3>${esc(r.title)} <span class="data-status ${r.result==='不符合'||r.result==='待改善'?'conflict':''}">${esc(r.result)}</span></h3><p>${esc(r.date)} · ${r.publicSummary?'教育部公開摘要（非原始文件）':r.demo?'合成示範文件':'本機上傳文件'}</p><small>${esc(r.fileName)}</small><div class="form-actions"><button onclick="Y.viewEvaluation(${esc(JSON.stringify(currentSchool))},'${r.id}')">查看</button><button onclick="Y.downloadEvaluation('${r.id}')">${r.publicSummary?'下載摘要 TXT':'下載評鑑資料'}</button></div></article>`).join('')||'<div class="empty-inline">此年度尚無評鑑資料，可在下方上傳。</div>'}</div><details class="evaluation-upload" open><summary>上傳評鑑資料</summary><form onsubmit="Y.uploadEvaluation(event)"><div class="form-grid" style="margin-top:16px"><label class="field full">文件名稱<input name="title" required maxlength="100" placeholder="例如：年度基本評鑑檢核表"></label><label class="field">民國年度<input name="year" type="number" min="1" max="300" required value="${currentYear}"></label><label class="field">評鑑日期<input name="date" type="date" required min="${currentYear+1911}-01-01" max="${currentYear+1911}-12-31" value="${currentYear+1911}-01-01"></label><label class="field">評鑑結果<select name="result">${options(['符合','待改善','不符合','免檢核','待確認'],'待確認')}</select></label><label class="field full">評鑑文件（最多 10 MB）<input name="file" type="file" required accept=".pdf,.xlsx,.docx,.csv,.txt,.png,.jpg,.jpeg"></label></div><p class="data-hint">只保存於此瀏覽器，不會上傳 AWS。清除網站資料會移除文件。上傳結果保留為年度紀錄；Demo OCR 擷取的事件加分會另列於風險詳情，不覆寫教育部原始摘要。</p><div id="evaluation-error" class="form-error" role="alert"></div><div class="form-actions"><button class="primary" ${busy?'disabled':''}>${busy?'儲存中…':'上傳並保存'}</button></div></form></details>`);
    $('#modal').classList.add('modal-wide');
    const form=$('#modal form');form.elements.year.oninput=()=>{const year=Number(form.elements.year.value)+1911;form.elements.date.min=year+'-01-01';form.elements.date.max=year+'-12-31';};
  }
  Y.uploadEvaluation=async event=>{
    event.preventDefault();if(busy)return;const f=event.target,data=new FormData(f),file=data.get('file'),year=Number(data.get('year')),date=data.get('date'),title=String(data.get('title')).trim(),id=currentSchool;
    const fail=text=>{const el=$('#evaluation-error');if(el)el.textContent=text;};
    if(!title||!Number.isInteger(year)||year<1||year>300||Number(date.slice(0,4))!==year+1911){fail('請確認名稱、民國年度與評鑑日期相符。');return;}
    if(!file?.size||file.size>10*1024*1024||! /\.(pdf|xlsx|docx|csv|txt|png|jpe?g)$/i.test(file.name)){fail('請選擇支援的非空文件，且不超過 10 MB。');return;}
    const record={id:uid(),year,date,title,result:String(data.get('result')),fileName:file.name,size:file.size,at:new Date().toISOString(),demo:false};
    busy=true;f.querySelector('button').disabled=true;fail('');
    try{await storage('readwrite',record.id,file);entries(id).push(record);if(!persist()){db.evaluationFiles[id]=entries(id).filter(x=>x.id!==record.id);await storage('readwrite',record.id);throw Error('本機儲存空間不足，未保存紀錄。');}currentYear=year;busy=false;draw();Y.refreshWork?.();toast('已保存評鑑文件，可切換年度查看或下載');}
    catch(e){fail('保存失敗：'+e.message);}finally{busy=false;if(f.isConnected)f.querySelector('button').disabled=false;}
  };
  Y.downloadEvaluation=async id=>{const record=entries(currentSchool).find(r=>r.id===id);if(!record)return;try{const blob=(record.demo||record.publicSummary)?new Blob([record.text],{type:'text/plain;charset=utf-8'}):await storage('readonly',id);if(!blob)throw Error('找不到本機文件，可能已清除網站資料，請重新上傳。');downloadBlob(blob,record.fileName);}catch(e){toast('下載失敗：'+e.message);}};
  const source=Y.source;Y.source=(id,key)=>key==='evaluationResult'?Y.evaluations(id):source(id,key);
  Y.decorateEvaluations=()=>{document.querySelectorAll('#work-results button[onclick*="evaluationResult"]').forEach(b=>{b.classList.add('evaluation-button');b.innerHTML='查看評鑑資料 <small>依年度查看結果／上傳／下載</small>';});};
  Y.decorateEvaluations();
})();
