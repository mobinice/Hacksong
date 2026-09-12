/* Official registry browser. No synthetic risk metrics or demo evidence is mixed in. */
(() => {
  'use strict';
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
  const button=document.createElement('button');
  button.id='nav-real';button.textContent='新北市真實園所';button.onclick=()=>go('real');
  document.querySelector('nav').prepend(button);

  const baseRender=render;
  render=()=>{
    document.querySelector('.topline .demo').textContent='官方資料快照 · 缺值如實標示';
    if(page!=='real') {baseRender();return;}
    document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.id==='nav-real'));
    document.querySelector('#page').innerHTML=`<div class="heading"><div><h1>新北市立案幼兒園</h1><p>新北市政府名錄 × 教育部評鑑紀錄與報告</p></div><button id="real-refresh">重新載入資料</button></div>
      <div class="notice">立案字號、每生月費、實際在園人數如未公開，顯示「未提供」。核定招生人數不等於實際在園人數；本頁未產生推估風險分數。</div>
      <form id="real-search" class="panel pad real-filters" style="margin-top:18px">
        <label class="field">搜尋園名、地址或立案字號<input id="real-q" maxlength="100" placeholder="例如：板橋、悅淨、莒光" value="${html(state.q)}"></label>
        <label class="field">行政區<select id="real-district"><option value="">全部行政區</option></select></label>
        <label class="field">設立別／類型<select id="real-type"><option value="">全部類型</option>${['公立','私立','非營利','準公共'].map(t=>`<option ${state.type===t?'selected':''}>${t}</option>`).join('')}</select></label>
        <button class="primary" type="submit">搜尋</button>
      </form><div id="real-results" aria-live="polite"></div>`;
    document.querySelector('#real-search').onsubmit=e=>{e.preventDefault();clearTimeout(debounce);search();};
    document.querySelector('#real-q').oninput=()=>{clearTimeout(debounce);debounce=setTimeout(search,300);};
    document.querySelector('#real-district').onchange=search;
    document.querySelector('#real-type').onchange=search;
    document.querySelector('#real-refresh').onclick=load;
    draw();load();
  };
  function search() {
    if(page!=='real')return;
    state.q=document.querySelector('#real-q').value;
    state.district=document.querySelector('#real-district').value;
    state.type=document.querySelector('#real-type').value;
    state.page=0;load();
  }
  async function load() {
    const sequence=++request;
    controller?.abort();controller=new AbortController();
    state.busy=true;state.error='';draw();
    try {
      const params=new URLSearchParams({page:state.page,size:state.size,q:state.q,district:state.district,type:state.type});
      const response=await fetch('/api/schools?'+params,{signal:controller.signal});
      if(!response.ok)throw Error(`資料 API 回應 ${response.status}；請使用 python3 server.py 啟動服務。`);
      const data=await response.json();
      if(!Array.isArray(data.data)||!data.metadata||data.metadata.partial)throw Error('尚未建立完整真實資料快照，請先執行 python3 scripts/crawl_moe.py。');
      if(sequence===request)state.result=data;
    } catch(error) {
      if(sequence===request&&error.name!=='AbortError'){state.error=error.message;state.result=null;}
    } finally {if(sequence===request){state.busy=false;draw();}}
  }
  function draw() {
    const target=document.querySelector('#real-results');if(page!=='real'||!target)return;
    if(state.error){target.innerHTML=`<div class="panel pad" role="alert">${html(state.error)}</div>`;return;}
    const result=state.result;
    if(!result){target.innerHTML='<div class="panel pad">正在讀取真實園所資料…</div>';return;}
    const select=document.querySelector('#real-district');
    select.innerHTML='<option value="">全部行政區</option>'+result.districts.map(d=>`<option ${state.district===d?'selected':''}>${html(d)}</option>`).join('');
    const m=result.metadata;
    target.innerHTML=`<p class="muted" style="margin:14px 0">名錄 ${m.registryCount} 間 · 教育部 ${m.moeCount} 間 · 整合 ${m.schoolCount} 筆 · ${html(m.retrievedAt)}${state.busy?' · 更新中…':''}</p>
      <div class="panel"><div class="panel-head"><h2>查詢結果 ${result.total} 筆</h2><small>第 ${result.totalPages?result.page+1:0}／${result.totalPages} 頁</small></div>
      <div class="table-wrap"><table><thead><tr><th>園所／行政區</th><th>設立別／類型</th><th>地址／電話</th><th>立案字號</th><th>核定人數</th><th>每生月費</th><th>評鑑歷史</th></tr></thead><tbody>
      ${result.data.map((s,i)=>`<tr><td><button class="link" data-school="${i}">${html(s.name)}</button><small>${html(s.district)} · ${html(s.id)}</small>${s.registryStatus!=='listed'?'<small>僅教育部紀錄，尚未配對市府名錄</small>':''}</td><td>${show(s.type)}<small>${show(s.serviceType)}</small></td><td>${show(s.address)}<small>${show(s.telephone)}</small></td><td>${show(s.registrationNumber)}</td><td>${show(s.capacity)}${s.capacity==null?'':' 人'}</td><td>${show(s.monthlyFee)}${s.monthlyFee==null?'':' 元／生／月'}</td><td>${s.evaluations.length} 筆<button class="link" data-school="${i}">查看資料與報告</button></td></tr>`).join('')||'<tr><td colspan="7">沒有符合條件的園所，請調整搜尋或行政區。</td></tr>'}
      </tbody></table></div><div class="pad toolbar"><button id="real-prev" ${state.busy||!result.page?'disabled':''}>上一頁</button><button id="real-next" ${state.busy||!result.hasNext?'disabled':''}>下一頁</button><label>每頁 <select id="real-size">${[10,25,50,100].map(n=>`<option ${state.size===n?'selected':''}>${n}</option>`).join('')}</select> 筆</label></div></div>`;
    target.querySelectorAll('[data-school]').forEach(b=>b.onclick=()=>detail(result.data[Number(b.dataset.school)]));
    target.querySelector('#real-prev').onclick=()=>{state.page--;load();};
    target.querySelector('#real-next').onclick=()=>{state.page++;load();};
    target.querySelector('#real-size').onchange=e=>{state.size=Number(e.target.value);state.page=0;load();};
  }
  function detail(s) {
    reportRequest++;
    const metadata=s.fieldMetadata;
    openModal(html(s.name),`<p>${html(s.district)} · ${html(s.id)}</p><div class="table-wrap"><table><thead><tr><th>欄位</th><th>內容</th><th>資料說明</th></tr></thead><tbody>${Object.entries(metadata).filter(([k])=>k!=='evaluations').map(([k,v])=>`<tr><th>${html(v.label)}</th><td>${show(s[k])}${s[k]!=null&&v.unit?' '+html(v.unit):''}</td><td>${html(v.note||({ntpc:'新北市政府名錄',moe:'教育部全國教保資訊網'}[v.source]||''))}</td></tr>`).join('')}</tbody></table></div>
      <h2 style="margin-top:22px">評鑑歷史與公開報告</h2><p class="muted">${html(metadata.evaluations.note||'保留最新及前期評鑑；紀錄日期依來源顯示。')}${s.historyComplete?'':' 歷史尚未完整配對。'}</p>
      ${s.evaluations.map((e,i)=>`<article class="source-card"><h3>${show(e.year)} 學年度 · ${html(e.result)}</h3><p>完成日：${show(e.date)}</p><div class="toolbar">${e.reportStatus==='downloaded'&&reportLink(e.reportPath)?`<button class="primary" data-report="${i}">查看已下載報告</button><a href="${html(e.reportPath)}" download>下載 JSON</a>`:`<span>${html({failed:'報告下載失敗，可重新執行爬蟲',pending:'報告待下載',not_published:'來源未公開報告'}[e.reportStatus]||'未提供報告')}</span>`}${sourceLink(e.reportUrl)?`<a href="${sourceLink(e.reportUrl)}" target="_blank" rel="noopener noreferrer">官方報告 ↗</a>`:''}</div></article>`).join('')||'<p class="notice">沒有已配對的公開評鑑紀錄；不代表低風險或未受評。</p>'}
      <h2 style="margin-top:22px">來源紀錄</h2>${s.sources.map(src=>`<details><summary>${html(src.id==='ntpc'?'新北市政府名錄':'教育部園所資料')}</summary><pre style="white-space:pre-wrap">${html(JSON.stringify(src.record,null,2))}</pre><a href="${sourceLink(src.url)||'#'}" target="_blank" rel="noopener noreferrer">官方來源 ↗</a></details>`).join('')}`);
    document.querySelector('#modal').classList.add('modal-wide');
    document.querySelectorAll('[data-report]').forEach(b=>b.onclick=()=>viewReport(s,s.evaluations[Number(b.dataset.report)]));
  }
  async function viewReport(s,e) {
    const sequence=++reportRequest;
    try {
      const response=await fetch(reportLink(e.reportPath));
      if(!response.ok)throw Error('找不到報告檔案');
      const report=await response.json();
      if(sequence!==reportRequest)return;
      if(report.schoolName!==(e.sourceSchoolName||s.name))throw Error('報告園所名稱不一致');
      openModal(html(s.name+' · '+e.year+' 學年度評鑑報告'),`<p>${html(e.result)} · ${show(e.date)}</p><p class="muted">下載時間：${html(report.retrievedAt)} · 官方網頁檢核表</p><div class="toolbar" style="margin:14px 0"><button id="real-back">返回園所資料</button><a href="${html(e.reportPath)}" download>下載結構化 JSON</a></div>${report.tables.map(rows=>`<div class="table-wrap" style="margin:18px 0"><table class="real-report-table">${rows.map(row=>'<tr>'+row.map(c=>`<td rowspan="${Math.max(1,Math.min(100,Number(c.rowSpan)||1))}" colspan="${Math.max(1,Math.min(20,Number(c.colSpan)||1))}">${html(c.text)}</td>`).join('')+'</tr>').join('')}</table></div>`).join('')}`);
      document.querySelector('#modal').classList.add('modal-wide');
      document.querySelector('#real-back').onclick=()=>detail(s);
    } catch(error) {if(sequence===reportRequest)toast('讀取報告失敗：'+error.message);}
  }
  window.officialSchoolDetail=id=>{const s=schools.find(s=>s.id===Number(id));if(s?.officialId)detail({...s,id:s.officialId});};
  page='data';render();
})();
