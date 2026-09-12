/* Official registry browser. No synthetic risk metrics or demo evidence is mixed in. */
(() => {
  'use strict';
  if(!window.officialMode)return;
  const state = {page:0, size:25, q:'', district:'', type:'', result:null, error:'', busy:false};
  let request=0, controller, debounce, reportRequest=0;
  const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const show = value => value === null || value === undefined || value === '' ? '未提供' : html(value);
  const reportLink = path => /^data\/reports\/[a-f0-9]{24}\.json$/.test(path || '') ? path : null;
  const sourceLink = value => {
    try {const u=new URL(value); return u.protocol==='https:' && ['ap.ece.moe.edu.tw','data.ntpc.gov.tw'].includes(u.hostname) ? html(u.href) : null;}
    catch {return null;}
  };
  document.querySelector('#modal').addEventListener('close',()=>reportRequest++);
  function detail(s) {
    reportRequest++;
    const metadata=s.fieldMetadata;
    openModal(html(s.name),`<p>${html(s.district)} · ${html(s.id)}</p><div class="table-wrap"><table><thead><tr><th>欄位</th><th>內容</th><th>資料說明</th></tr></thead><tbody>${Object.entries(metadata).filter(([k])=>k!=='evaluations').map(([k,v])=>`<tr><th>${html(v.label)}</th><td>${show(s[k])}${s[k]!=null&&v.unit?' '+html(v.unit):''}</td><td>${html(v.note||({ntpc:'新北市政府名錄',moe:'教育部全國教保資訊網'}[v.source]||''))}</td></tr>`).join('')}</tbody></table></div>
      <h2 style="margin-top:22px">評鑑歷史與公開報告</h2><p class="muted">${html(metadata.evaluations.note||'保留最新及前期評鑑；紀錄日期依來源顯示。')}${s.historyComplete?'':' 歷史尚未完整配對。'}</p>
      ${s.evaluations.map((e,i)=>`<article class="source-card"><h3>${show(e.year)} 學年度 · ${html(e.result)}</h3><p>完成日：${show(e.date)}</p><div class="toolbar">${e.reportStatus==='downloaded'&&reportLink(e.reportPath)?`<button class="primary" data-report="${i}">查看已下載報告</button><a href="${html(API_BASE+'/'+e.reportPath)}" download>下載 JSON</a>`:`<span>${html({failed:'報告下載失敗，可重新執行爬蟲',pending:'報告待下載',not_published:'來源未公開報告'}[e.reportStatus]||'未提供報告')}</span>`}${sourceLink(e.reportUrl)?`<a href="${sourceLink(e.reportUrl)}" target="_blank" rel="noopener noreferrer">官方報告 ↗</a>`:''}</div></article>`).join('')||'<p class="notice">沒有已配對的公開評鑑紀錄；不代表低風險或未受評。</p>'}
      <h2 style="margin-top:22px">來源紀錄</h2>${s.sources.map(src=>`<details><summary>${html(src.id==='ntpc'?'新北市政府名錄':'教育部園所資料')}</summary><pre style="white-space:pre-wrap">${html(JSON.stringify(src.record,null,2))}</pre><a href="${sourceLink(src.url)||'#'}" target="_blank" rel="noopener noreferrer">官方來源 ↗</a></details>`).join('')}`);
    document.querySelector('#modal').classList.add('modal-wide');
    document.querySelectorAll('[data-report]').forEach(b=>b.onclick=()=>viewReport(s,s.evaluations[Number(b.dataset.report)]));
  }
  async function viewReport(s,e) {
    const sequence=++reportRequest;
    try {
      const response=await fetch(API_BASE+'/'+reportLink(e.reportPath));
      if(!response.ok)throw Error('找不到報告檔案');
      const report=await response.json();
      if(sequence!==reportRequest)return;
      if(report.schoolName!==(e.sourceSchoolName||s.name))throw Error('報告園所名稱不一致');
      openModal(html(s.name+' · '+e.year+' 學年度評鑑報告'),`<p>${html(e.result)} · ${show(e.date)}</p><p class="muted">下載時間：${html(report.retrievedAt)} · 官方網頁檢核表</p><div class="toolbar" style="margin:14px 0"><button id="real-back">返回園所資料</button><a href="${html(API_BASE+'/'+e.reportPath)}" download>下載結構化 JSON</a></div>${report.tables.map(rows=>`<div class="table-wrap" style="margin:18px 0"><table class="real-report-table">${rows.map(row=>'<tr>'+row.map(c=>`<td rowspan="${Math.max(1,Math.min(100,Number(c.rowSpan)||1))}" colspan="${Math.max(1,Math.min(20,Number(c.colSpan)||1))}">${html(c.text)}</td>`).join('')+'</tr>').join('')}</table></div>`).join('')}`);
      document.querySelector('#modal').classList.add('modal-wide');
      document.querySelector('#real-back').onclick=()=>detail(s);
    } catch(error) {if(sequence===reportRequest)toast('讀取報告失敗：'+error.message);}
  }
  window.officialSchoolDetail=id=>{const s=schools.find(s=>s.id===Number(id));if(s?.officialId)detail({...s,id:s.officialId});};

})();
