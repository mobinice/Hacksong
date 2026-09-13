/* Shared manual review editing and retained audit history for the demo. */
(()=>{
  const fields={status:'覆核結果',owner:'承辦人',date:'查核日期',note:'承辦人備註',next:'後續處理事項'};
  const statuses=['待查核','已排入查核','持續觀察','已確認無異常','資料不足待補充'];
  const snapshot=r=>r?.saved?Object.fromEntries(Object.keys(fields).map(k=>[k,r[k]||''])):null;
  function writeReview(id,values){
    if(!schoolById(id))throw Error('找不到園所，請重新選擇。');
    if(values&&(!statuses.includes(values.status)||!values.owner?.trim()||(values.status==='已排入查核'&&!values.date)))throw Error('請填寫承辦人；已排入查核時需填寫查核日期。');
    const previous=structuredClone(db.reviews[id]||null),before=snapshot(previous);
    if(!values&&!before)throw Error('目前沒有可刪除的人工覆核。');
    const after=values?Object.fromEntries(Object.keys(fields).map(k=>[k,String(values[k]||'').trim()])):null;
    if(JSON.stringify(before)===JSON.stringify(after))return false;
    const oldCase=structuredClone(db.casework[id]||null),at=stamp(),actor=loginState()||db.profile.name||after?.owner||before?.owner||'示範使用者';
    const operation=after?(before?'編輯':'新增'):'刪除';
    // A tombstone prevents the storage API's review merge from resurrecting deletions.
    db.reviews[id]=after?{...(previous||{}),...after,deletedAt:undefined,saved:at}:{deletedAt:at};
    const c=ensureCase(id);c.timeline||=[];
    const changes=Object.keys(fields).filter(k=>(before?.[k]||'')!==(after?.[k]||''));
    c.timeline.unshift({id:uid(),at,actor,operation,kind:'manual-review',before,after,text:`${operation}人工覆核｜操作者：${actor}。${changes.map(k=>`${fields[k]}：${before?.[k]||'未填寫'} → ${after?.[k]||'已清除'}`).join('；')}`});
    if(!persist()){
      if(previous)db.reviews[id]=previous;else delete db.reviews[id];
      if(oldCase)db.casework[id]=oldCase;else delete db.casework[id];
      throw Error('儲存失敗，本次操作已取消，請重試。');
    }
    return true;
  }
  Y.writeManualReview=writeReview;
  Y.reviewModal=id=>{
    if(id==null){
      const rows=schools.filter(s=>!db.reviews[s.id]?.saved);
      openModal('新增人工覆核',`<form onsubmit="event.preventDefault();Y.reviewModal(this.elements.school.value)"><label class="field">選擇園所<select name="school" required><option value="">請選擇尚未覆核的園所</option>${rows.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}（${esc(s.district)}）</option>`).join('')}</select></label><div class="form-actions"><button type="button" onclick="closeModal()">取消</button><button class="primary">下一步</button></div></form>`);return;
    }
    const s=schoolById(id);if(!s)return;const r=db.reviews[id]?.saved?db.reviews[id]:{};
    openModal(r.saved?'編輯人工覆核':'新增人工覆核',`<form onsubmit="Y.submitManualReview(event,${esc(JSON.stringify(id))})"><p>${esc(s.name)}</p><div id="manual-review-error" class="form-error" role="alert"></div><div class="form-grid"><label class="field full">覆核結果<select name="status" onchange="this.form.elements.date.required=this.value==='已排入查核'">${options(statuses,r.status||'待查核')}</select></label><label class="field">承辦人 *<input name="owner" required maxlength="40" value="${esc(r.owner||db.profile.name||loginState()||'')}"></label><label class="field">查核日期<input name="date" type="date" ${r.status==='已排入查核'?'required':''} value="${esc(r.date||'')}"></label><label class="field full">承辦人備註<textarea name="note" maxlength="6000">${esc(r.note||'')}</textarea></label><label class="field full">後續處理事項<textarea name="next" maxlength="6000">${esc(r.next||'')}</textarea></label></div><div class="form-actions"><button type="button" onclick="closeModal()">取消</button><button class="primary">儲存人工覆核</button></div></form>`);
  };
  Y.submitManualReview=(event,id)=>{
    event.preventDefault();try{const changed=writeReview(id,Object.fromEntries(new FormData(event.target)));closeModal();if(page==='audit')go('case',id);else render();toast(changed?'已儲存人工覆核並記錄操作':'內容沒有變更');}catch(e){$('#manual-review-error').textContent=e.message;}
  };
  Y.deleteManualReview=id=>{
    if(!db.reviews[id]?.saved)return;
    openModal('刪除人工覆核',`<p>確定刪除「${esc(schoolById(id).name)}」的人工覆核？</p><div class="notice">刪除後可重新新增覆核。案件、後續行動與歷次操作紀錄會保留。</div><div id="manual-review-error" class="form-error" role="alert"></div><div class="form-actions"><button onclick="closeModal()">取消</button><button class="primary" onclick="Y.confirmDeleteManualReview(${esc(JSON.stringify(id))})">確認刪除</button></div>`);
  };
  Y.confirmDeleteManualReview=id=>{try{writeReview(id,null);closeModal();render();toast('已刪除人工覆核，操作紀錄已保留');}catch(e){$('#manual-review-error').textContent=e.message;}};
  saveReview=event=>{
    event.preventDefault();try{const changed=writeReview(selected,Object.fromEntries(new FormData(event.target)));event.target.elements.dirty.value='no';detail();toast(changed?'已儲存人工覆核並記錄操作':'內容沒有變更');}catch(e){toast(e.message);}
  };
  const baseAudit=auditPage;
  auditPage=()=>{baseAudit();document.querySelector('#page>.heading .toolbar')?.insertAdjacentHTML('afterbegin','<button class="primary" onclick="Y.reviewModal()">＋ 新增人工覆核</button>');};
  const baseCase=casePage;
  casePage=()=>{
    baseCase();if(page!=='case')return;
    const r=db.reviews[caseId],heading=[...document.querySelectorAll('.case-layout h2')].find(h=>h.textContent==='原始人工覆核');
    if(!heading)return;
    const args=esc(JSON.stringify(caseId));
    heading.closest('.panel').outerHTML=`<section class="panel" id="manual-review-panel"><div class="panel-head"><h2>人工覆核</h2><div class="toolbar">${r?.saved?`<button onclick="Y.reviewModal(${args})">編輯覆核</button><button onclick="Y.deleteManualReview(${args})">刪除覆核</button>`:`<button class="primary" onclick="Y.reviewModal(${args})">＋ 新增人工覆核</button>`}</div></div><div class="pad">${r?.saved?`<small>最近儲存：${esc(r.saved)}</small><dl class="case-meta">${Object.entries(fields).map(([key,label])=>`<div><dt>${label}</dt><dd style="white-space:pre-wrap">${esc(r[key]||'未填寫')}</dd></div>`).join('')}</dl>`:'尚無人工覆核資料，可點擊新增；歷次操作仍保留於下方處理紀錄。'}</div></section>`;
  };
})();
