// Kept as a small standalone source string so the existing SSR shell needs no bundler.
export const dashboardClient = String.raw`
(()=>{
  const key='betapp_onboarding_completed';
  const panels=[...document.querySelectorAll('[data-page]')];
  const details=[...document.querySelectorAll('[data-detail]')];
  const menu=document.querySelector('.menu-toggle');
  const navigation=document.querySelector('#primary-navigation');
  menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));navigation.classList.toggle('menu-open',open)});
  function route(focus=false){
    const name=location.hash.slice(1);const available=panels.length?panels:details;
    const attr=panels.length?'page':'detail';const anchor=document.getElementById(name);const selected=available.find(p=>p.dataset[attr]===name)||anchor?.closest('[data-page],[data-detail]')||available[0];if(anchor?.tagName==='DETAILS')anchor.open=true;
    available.forEach(p=>p.hidden=p!==selected);
    document.querySelectorAll(panels.length?'[data-page-link]':'[data-detail-link]').forEach(a=>{const active=a.dataset[panels.length?'pageLink':'detailLink']===selected?.dataset[attr];if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
    menu?.setAttribute('aria-expanded','false');navigation?.classList.remove('menu-open');
    if(focus&&selected){const heading=selected.querySelector('h1,h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true})}window.scrollTo(0,0)}
  }
  const database=document.querySelector('[data-system-key="database"]');
  if(database&&typeof fetch==='function'){
    fetch('/health',{signal:AbortSignal.timeout(8000)}).then(r=>r.json()).then(data=>{
      const state=data.database?.status;database.textContent=state==='ok'?'Aktif':state?'Sorun Var':'Bekleniyor';
      database.className='status-badge '+(state==='ok'?'positive':state?'negative':'pending');
    }).catch(()=>{database.textContent='Bekleniyor';database.className='status-badge pending'});
  }
  window.addEventListener('hashchange',()=>route(true));route();
  document.querySelector('[data-start]')?.addEventListener('click',()=>{try{localStorage.setItem(key,'true')}catch{}document.documentElement.classList.add('onboarded');if(location.hash!=='#home')location.hash='home';else route(true);document.querySelector('[data-home-heading]')?.focus()});
  document.querySelector('[data-reset-onboarding]')?.addEventListener('click',()=>{try{localStorage.removeItem(key)}catch{}document.documentElement.classList.remove('onboarded');location.hash='home';document.querySelector('[data-start]')?.focus()});
  document.querySelectorAll('[data-match-search]').forEach(input=>input.addEventListener('input',()=>{const q=input.value.trim().toLocaleLowerCase('tr-TR');input.closest('.product-panel').querySelectorAll('[data-search-row]').forEach(row=>row.classList.toggle('hidden-by-search',!row.textContent.toLocaleLowerCase('tr-TR').includes(q)))}));
})();`;
export const onboardingHead = `<script>try{if(localStorage.getItem('betapp_onboarding_completed')==='true')document.documentElement.classList.add('onboarded')}catch{}</script>`;
