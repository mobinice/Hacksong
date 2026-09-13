/* UI refinements; checklist is the user's shared sample, not parsed upload data. */
(() => {
  Object.assign(functionHelp, {
    fields: {title:'欄位管理',intro:'定義平台要整理的資料，統一欄位名稱、型別與單位。',steps:['新增或編輯欄位名稱、類型、單位與預期來源。','查看欄位被哪些風險規則使用。','工作台可另勾選顯示與匯出欄位。'],note:'新增欄位不會自動計分，也不會自動抓取資料。每生人事成本由年度人事費與實際學生數計算。'},
    rules: {title:'風險判斷規則',intro:'設定異常的判斷条件、風險構面及權重，讓分數可以解釋與追溯。',steps:['編輯規則門檻、構面與權重，或調整啟用狀態。','點「調整權重」一起修改規則比例；全部規則合計 100%，停用規則不計分。','儲存後重新計算分數，詳情的「分數詳情」可查看公式與來源。'],note:'裁罰按次累加：每次為該規則權重的一半，上限為該規則權重。人工回填另列加減分；缺資料不當成 0。權重為示範設定，非官方評鑑標準。'},
    sources: {title:'資料來源',intro:'了解資料從哪裡來、何時更新，以及是否有缺漏或來源衝突。',steps:['查看各資料來源的狀態與更新時間。','到資料工作台點擊數值，查看來源檔案、原文及定位。','同年度數值有衝突時，由承辦人確認採用來源；其他來源仍保留。'],note:'目前是本機原型，來源設定不會自動連線抓取資料；內建來源為示範資料。'}
  });
  const baseSettings=settings;
  settings=()=>{
    baseSettings();
    const tabs=document.querySelector('#page .tabs');
    const buttons=Array.from(tabs.querySelectorAll('[role="tab"]'));
    tabs.replaceChildren();
    for(const [key,title] of [['fields','欄位管理'],['import','資料匯入'],['rules','風險判斷規則'],['sources','資料來源']]){
      const button=buttons.find(b=>b.textContent.trim()===title);
      if(!button)continue;
      const group=document.createElement('div');group.className='settings-tab';group.setAttribute('role','presentation');
      group.append(button,helpIcon(key));tabs.append(group);
    }
    document.querySelectorAll('#page h2 small').forEach(el=>{if(/^共\s*\d/.test(el.textContent.trim()))el.remove();});
  };
  const baseAudit=auditPage;
  auditPage=()=>{baseAudit();document.querySelectorAll('#page .panel-head>.pill').forEach(el=>{if(/^共\s*\d/.test(el.textContent.trim()))el.remove();});};
  const baseResults=updateResults;
  updateResults=()=>{baseResults();const count=document.getElementById('result-count');if(count)count.textContent=metric?'已套用統計篩選':'';};

  const categories=['設立與營運','總務與財務管理','教保活動課程','人事管理','餐飲與衛生管理','安全管理'];
  const items={'1.1':'設立名稱及地址','1.2':'生師比例','1.3':'資訊公開','2.1':'收費規定','2.2':'環境設備維護','3.1':'課程規劃與實施','3.2':'幼兒發展篩檢','3.3':'活動室環境','3.4':'午休','4.1':'員工保險','4.2':'退休制度','4.3':'出勤管理','5.1':'餐飲管理','5.2':'衛生保健','6.1':'交通安全','6.2':'場地安全','6.3':'緊急事件處理'};
  const checklist=[
    ['1.1.1','招牌、對外銜稱及使用地址與樓層應與設立許可證書所載相符。'],
    ['1.2.1','生師比例應符合幼兒教育及照顧法之規定。'],
    ['1.3.1','設立許可證書應懸掛於園內足資辨識之處所。'],
    ['1.3.2','教保服務人員之學歷證書或資格證書應懸掛於園內足資辨識之處所。'],
    ['2.1.1','收退費基準及減免收費規定應於每學期開始前一個月公告，並告知家長。'],
    ['2.1.2','各項收費應列有明細，並開立收據，且未逾報送直轄市、縣(市)主管機關之數額。'],
    ['2.2.1','每學期應至少實施一次全園環境消毒，並留有紀錄。'],
    ['2.2.2','每學期應至少自我檢核一次全園室內、外設施設備之安全性；對於不符安全，待修繕或汰換者，應留有處理情形之紀錄；設有戶外固定式遊戲設施者，每月應定期進行遊戲場及設施檢查工作。'],
    ['3.1.1','每學期應至少召開一次全園性教保活動課程發展會議。'],
    ['3.1.2','各班課程應採統整不分科方式進行教學。'],
    ['3.1.3','每日應實施連續三十分鐘以上之幼兒大肌肉活動時間。'],
    ['3.2.1','每學年應對全園幼兒實施發展篩檢，並對疑似發展遲緩幼兒，留有處理紀錄。'],
    ['3.3.1','室內活動室平均照度至少五百勒克斯（lux）以上，並不得高於七百五十勒克斯（lux）。'],
    ['3.3.2','每名幼兒均有獨立區隔及通風透氣之棉被收納空間或每二週應清洗一次幼兒使用之棉被，並留有紀錄。'],
    ['3.4.1','全日班應規劃適宜之午睡時間；二歲至未滿三歲幼兒之午睡時間不超過兩小時、三歲至入國民小學前幼兒不超過一小時三十分鐘。'],
    ['4.1.1','教職員工均辦理保險，且投保薪資未有低報情形。'],
    ['4.2.1','依規定提撥勞工退休準備金或提繳勞工退休金。'],
    ['4.3.1','雇主應依相關規定備製及保存勞工出勤紀錄，並依規定核予例假、休息日及休假。'],
    ['5.1.1','應公布每個月餐點表，並告知家長，且每日餐點均含全穀雜糧類、豆魚蛋肉類、蔬菜類及水果類等四大類食物。'],
    ['5.1.2','點心與正餐之供應時間，規劃至少間隔二小時。'],
    ['5.1.3','幼兒使用之餐具不得為塑膠或美耐皿材質。'],
    ['5.1.4','廚房之出入口應設置病媒防治設施，且無損壞。'],
    ['5.1.5','飲用水連續供水固定設備每個月至少維護一次，並留有紀錄。'],
    ['5.1.6','經飲用水連續供水固定設備處理後之水質，每三個月至少檢測一次大腸桿菌群，水質符合標準並留有紀錄。'],
    ['5.2.1','盥洗室(包括廁所)應保持通風良好，且未有積水之情形。'],
    ['5.2.2','廁所應有隔間設計；若無隔間設計者，男、女廁應分別設置。'],
    ['5.2.3','應建立幼兒託藥措施，並告知家長。'],
    ['6.1.1','幼童專用車應依交通管理相關法規所定期限接受定期檢驗，檢驗合格並留有紀錄。','免檢核'],
    ['6.1.2','幼童專用車至少每半年應實施保養，並留有紀錄。','免檢核'],
    ['6.1.3','幼童專用車之駕駛均應具備職業駕照且年齡為六十五歲以下，並應配有具教保服務人員資格或成年之隨車人員。','免檢核'],
    ['6.1.4','幼童專用車均應配置對內外行車影像紀錄器及合於規定之滅火器。','免檢核'],
    ['6.1.5','幼童專用車之駕駛應於每次發車前均確實檢查車況及安全門，並留有紀錄。','免檢核'],
    ['6.1.6','幼兒上下車時，均應依乘坐幼兒名冊逐一清點，並留有紀錄。','免檢核'],
    ['6.1.7','每半年應至少辦理一次幼童專用車逃生演練，並留有紀錄。','免檢核'],
    ['6.2.1','設置於二樓或三樓（直上方無頂蓋之平臺）之室外活動空間及園內樓梯扶手，其欄杆間距不得大於十公分、不得設置橫條，且幼兒不易穿越或攀爬；露臺欄杆高度不得低於一百一十公分。'],
    ['6.2.2','戶外固定式遊戲設施應經兒童遊戲場主管機關備查。經備查後，每三年並應委託專業檢驗機構進行檢驗工作。','免檢核'],
    ['6.3.1','訂有緊急事件處理機制並留有處理通報紀錄。','未填']
  ];
  const viewer=document.createElement('dialog');viewer.id='evaluation-checklist';viewer.setAttribute('aria-labelledby','checklist-title');document.body.append(viewer);
  Y.viewEvaluation=(schoolId,recordId)=>{
    const record=db.evaluationFiles[schoolId]?.find(r=>r.id===recordId);if(!record)return;
    viewer.innerHTML=`<div class="dialog-head"><div><h2 id="checklist-title">評鑑檢核表</h2><small>${esc(schoolById(schoolId).name)} · ${record.year} 年 · ${esc(record.title)}</small></div><button aria-label="關閉評鑑檢核表" onclick="document.getElementById('evaluation-checklist').close()">×</button></div><div class="dialog-body"><div class="notice">以下依你提供的同一份檢核表展示，非本文件解析結果；不據此推算文件整體評鑑結果。原表 6.3.1 未勾選，保留為未填。</div><div class="table-wrap checklist-scroll"><table class="checklist-table"><thead><tr><th rowspan="2">類別</th><th rowspan="2">項目</th><th rowspan="2">細項</th><th colspan="3">檢核情形</th><th rowspan="2">備註</th></tr><tr><th>符合</th><th>不符合</th><th>免檢核</th></tr></thead><tbody>${checklist.map(([code,text,result='符合'])=>{const item=code.slice(0,3),cat=Number(code[0]);return `<tr><td>${cat}. ${categories[cat-1]}</td><td>${item}<br>${items[item]}</td><td><b>${code}</b><p>${esc(text)}</p></td>${['符合','不符合','免檢核'].map(v=>`<td class="checkmark" aria-label="${v}：${result===v?'已勾選':'未勾選'}">${result===v?'✓':''}</td>`).join('')}<td>${result==='未填'?'未填':''}</td></tr>`;}).join('')}</tbody></table></div></div>`;
    viewer.showModal();
  };
})();
