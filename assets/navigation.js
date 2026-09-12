/* Keep in-app navigation in browser history, including the originating view. */
(() => {
  const key='youan-navigation-v1';
  const baseNavigate=navigate,baseClose=closeModal,baseRender=render;
  let restoring=false,undoingPop=false;
  const url=new URL(location.href);
  url.searchParams.delete('dataset'); // Retired official-workspace links use this demo.
  const cleanURL=url.pathname+url.search+url.hash;
  const saved=history.state?.key===key?history.state:null;
  let current=saved||{key,index:0,page:'overview',selected:null,tab:'fields',filters:{...filters},metric:''};
  const capture=()=>({...current,page,selected,tab,filters:{...filters},metric,scroll:scrollY,work:Y.navigationState?.(),
    map:page==='overview'&&leafMap?{center:[leafMap.getCenter().lat,leafMap.getCenter().lng],zoom:leafMap.getZoom()}:null});
  const save=()=>{current=capture();history.replaceState(current,'',cleanURL)};
  function decorate(){
    if(!['detail','case'].includes(page))return;
    const button=document.querySelector('#page .breadcrumb button');
    if(button){button.textContent='← 返回'+({overview:'風險總覽',data:'園所資料工作台',audit:'稽核管理',case:'案件詳情',detail:'園所詳情',settings:'資料與規則設定'}[current.from]||'上一頁');button.onclick=()=>Navigation.back();}
  }
  render=()=>{baseRender();decorate()};
  function apply(state){
    if(['detail','case'].includes(state.page)&&!schoolById(state.selected)){current=state;return;}
    restoring=true;baseClose();current=state;
    Y.restoreNavigationState?.(state.work);
    filters={...state.filters};metric=state.metric||'';tab=state.tab||'fields';
    baseNavigate(state.page,state.selected);
    if(state.map&&page==='overview'&&leafMap)leafMap.setView(state.map.center,state.map.zoom);
    if(state.summary!=null&&schoolById(state.summary))showPopup(state.summary);
    scrollTo(0,state.scroll||0);decorate();restoring=false;
  }
  navigate=(to,id)=>{
    if(restoring){baseNavigate(to,id);return;}
    const wasSummary=current.summary!=null;
    if(!wasSummary)save();
    const origin=wasSummary?current.from:page;
    baseClose();
    current={...capture(),key,index:current.index+(wasSummary?0:1),page:to,selected:id??selected,summary:null,from:origin,scroll:0};
    history[wasSummary?'replaceState':'pushState'](current,'',cleanURL);
    baseNavigate(to,id);decorate();
  };
  window.Navigation={
    summary(id){
      if(restoring)return;
      const replace=current.summary!=null;
      if(!replace)save();
      current={...capture(),index:current.index+(replace?0:1),summary:id,from:page};
      history[replace?'replaceState':'pushState'](current,'',cleanURL);
    },
    back(){if(current.index>0){history.back()}else go('overview')},
    ready(){if(current.selected!=null&&schoolById(current.selected))apply(current)}
  };
  closeModal=()=>{if(!restoring&&current.summary!=null){history.back();return;}baseClose()};
  document.querySelector('#modal').addEventListener('cancel',event=>{if(current.summary!=null){event.preventDefault();closeModal()}});
  addEventListener('popstate',event=>{
    if(undoingPop){undoingPop=false;return;}
    const next=event.state;
    if(next?.key!==key)return;
    if(dirty()&&!confirm('覆核內容尚未儲存，確定放棄修改並返回？')){undoingPop=true;history.go(current.index-next.index);return;}
    apply(next);
  });
  history.replaceState(current,'',cleanURL);
  if(saved&&(saved.selected==null||schoolById(saved.selected)))apply(saved);
  // A restored page must retain this version's route rather than an old dataset URL.
  addEventListener('pageshow',()=>{if(history.state?.key===key)apply(history.state)});
})();
