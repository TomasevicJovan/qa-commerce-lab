const $=s=>document.querySelector(s);
const main=$('#main'),dialog=$('#dialog');
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let token=sessionStorage.getItem('qa-token') || '',account=null,cart=[],catalog=[],stock={},config={},category='',search='',sort='',page=1,viewVersion=0,authRegister=false;
let toastTimer,searchTimer,pollBusy=false,checkoutKey=null;
async function api(path,options={}) {
  const res=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,...options.headers}});
  const data=await res.json();
  if (!res.ok) { if (res.status===401) {token='';account=null;cart=[];sessionStorage.removeItem('qa-token');updateHeader();} throw new Error(data.error || 'Request failed'); }
  return data;
}
const payload=(data,method='POST')=>({method,body:JSON.stringify(data)});
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3500);}
function updateHeader(){$('#account').textContent=account?`${account.name} · Sign out`:'Sign in';$('#cart-count').textContent=cart.reduce((n,i)=>n+i.quantity,0);}
function modal(title,html){$('#dialog-content').innerHTML=`<div class="modal-head"><h2>${esc(title)}</h2><button class="close" aria-label="Close dialog">×</button></div><div class="modal-body">${html}</div>`;$('#dialog-content .close').onclick=()=>dialog.close();if(!dialog.open)dialog.showModal();}
function total(items,coupon=''){const subtotal=items.reduce((n,i)=>n+i.price*i.quantity,0),discount=coupon==='SAVE10'?Math.round(subtotal*.1):0,shipping=subtotal-discount>=15000?0:700;return {subtotal,discount,shipping,total:subtotal-discount+shipping};}
async function cartDetails(){return Promise.all(cart.map(async item=>{let product=catalog.find(p=>p.id===item.productId);if(!product)product=await api(`/products/${encodeURIComponent(item.productId)}`);return {...product,...item};}));}
function totalsHtml(t){return `<div class="totals"><div><span>Subtotal</span><span>${money(t.subtotal)}</span></div><div><span>Discount</span><span>−${money(t.discount)}</span></div><div><span>Shipping</span><span>${t.shipping?money(t.shipping):'On us'}</span></div><div class="grand"><span>Total</span><span>${money(t.total)}</span></div></div>`;}
async function saveCart(next){cart=await api('/cart',payload({items:next},'PUT'));checkoutKey=null;updateHeader();}
async function add(productId,button){if(!account){authModal();return;}button.disabled=true;try{const next=structuredClone(cart),item=next.find(i=>i.productId===productId);if(item)item.quantity++;else next.push({productId,quantity:1});await saveCart(next);toast('Added to your bag');}catch(e){toast(e.message);}finally{button.disabled=false;}}
async function cartModal(){
  try{const items=await cartDetails();modal('Your shopping bag',items.length?`${items.map(i=>`<div class="cart-item" data-cart-product="${esc(i.id)}"><div class="cart-icon ${esc(i.color)}" aria-hidden="true">${esc(i.icon)}</div><div class="cart-detail"><h3>${esc(i.name)}</h3><p>${money(i.price)}</p></div><div class="qty"><button data-minus="${esc(i.id)}" aria-label="Remove one ${esc(i.name)}">−</button><span>${i.quantity}</span><button data-plus="${esc(i.id)}" aria-label="Add one ${esc(i.name)}">+</button></div></div>`).join('')}${totalsHtml(total(items))}<p class="hint">Free shipping from $150 after discounts. Test payments only.</p><button id="checkout-open" class="btn">Continue to checkout →</button>`:'<div class="empty">Your bag is waiting for a good find.</div>');
    dialog.querySelectorAll('[data-minus],[data-plus]').forEach(b=>b.onclick=async()=>{b.disabled=true;const productId=b.dataset.minus || b.dataset.plus;const next=cart.map(i=>({...i,quantity:i.quantity+(i.productId===productId?(b.dataset.plus?1:-1):0)})).filter(i=>i.quantity>0);try{await saveCart(next);await cartModal();}catch(e){toast(e.message);b.disabled=false;}});
    if($('#checkout-open'))$('#checkout-open').onclick=checkoutModal;
  }catch(e){toast(e.message);}
}
function authModal(){
  modal(authRegister?'Create your account':'Welcome back',`<form id="auth-form" class="form">${authRegister?'<label>Your name<input name="name" required maxlength="100" autocomplete="name"></label>':''}<label>Email address<input name="email" type="email" required autocomplete="email" value="${authRegister?'':'qa@example.com'}"></label><label>Password<input name="password" type="password" minlength="8" maxlength="128" required autocomplete="${authRegister?'new-password':'current-password'}" value="${authRegister?'':'Testing123!'}"></label><div class="form-error" role="alert"></div><button class="btn" type="submit">${authRegister?'Create account':'Sign in'} →</button><button id="auth-toggle" type="button" class="text-button">${authRegister?'Already registered? Sign in':'New here? Create an account'}</button><div class="demo">Demo account: <strong>qa@example.com</strong><br>Password: <strong>Testing123!</strong><br>Use separate accounts to test order ownership.</div></form>`);
  $('#auth-toggle').onclick=()=>{authRegister=!authRegister;authModal();};
  $('#auth-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type=submit]');button.disabled=true;try{const data=await api(`/auth/${authRegister?'register':'login'}`,payload(Object.fromEntries(new FormData(form))));token=data.token;account=data.user;sessionStorage.setItem('qa-token',token);cart=await api('/cart');updateHeader();dialog.close();toast(`Welcome, ${account.name}`);if(location.hash==='#orders')render();}catch(e){form.querySelector('.form-error').textContent=e.message;}finally{button.disabled=false;}};
}
async function checkoutModal(){
  try{
    const items=await cartDetails();if(!items.length)return cartModal();
    checkoutKey ||= crypto.randomUUID();
    modal('A few final details',`<form id="checkout-form" class="form"><div class="demo">Simulated checkout. Use fictional information.<br><strong>SAVE10</strong> = 10% off · <strong>EXPIRED</strong> = validation exercise.</div><label>Recipient<input name="name" required value="Alex Tester" maxlength="200" autocomplete="shipping name"></label><label>Street address<input name="line1" required value="12 Test Avenue" maxlength="200" autocomplete="shipping address-line1"></label><div class="form-row"><label>City<input name="city" required value="Sarajevo" maxlength="200" autocomplete="shipping address-level2"></label><label>Postal code<input name="postalCode" required value="71000" maxlength="200" autocomplete="shipping postal-code"></label></div><div class="form-row"><label>Country<select name="country"><option value="BA">Bosnia and Herzegovina</option value="DE">Germany</option><option value="US">United States</option></select></label><label>Payment method<select name="paymentMethod"><option value="test-card">Test card</option><option value="test-wallet">Test wallet</option></select></label></div><label>Discount code<input name="coupon" placeholder="Optional" autocomplete="off"></label><div id="checkout-total">${totalsHtml(total(items))}</div><div class="form-error" role="alert"></div><button type="submit" class="btn">Place test order →</button></form>`);
    const form=$('#checkout-form');form.elements.coupon.oninput=()=>{$('#checkout-total').innerHTML=totalsHtml(total(items,form.elements.coupon.value.trim().toUpperCase()));checkoutKey=crypto.randomUUID();};
    form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;const values=Object.fromEntries(new FormData(form));const coupon=values.coupon.trim().toUpperCase();
      try{const order=await api('/orders',{...payload({address:{name:values.name,line1:values.line1,city:values.city,postalCode:values.postalCode,country:values.country},paymentMethod:values.paymentMethod,coupon,expectedTotal:total(items,coupon).total}),headers:{'Idempotency-Key':checkoutKey}});cart=[];checkoutKey=null;updateHeader();dialog.close();toast(`Order ${order.id.slice(0,8)} placed. Processing asynchronously…`);location.hash='#orders';render();}
      catch(e){form.querySelector('.form-error').textContent=e.message;if(e.message.includes('Price changed'))form.querySelector('.form-error').textContent+=' Close checkout, refresh the collection, then reopen your bag.';}
      finally{button.disabled=false;}
    };
  }catch(e){toast(e.message);}
}
function shopShell(){main.innerHTML=`<div class="wrap"><section class="hero"><div><div class="eyebrow">Objects for a better everyday</div><h1>Good things.<br><em>Great little details.</em></h1><p>A considered collection for your desk, your home,<br>and wherever the day takes you.</p></div><div class="hero-art" role="img" aria-label="Abstract green ring and terracotta object"><div class="art-ring"></div><div class="art-cube"></div></div></section><section class="collection" aria-label="Product collection"><div class="section-heading"><h2>The collection <small>Made for everyday</small></h2><div class="search-wrap"><label class="sr-only" for="search">Search products</label><input id="search" placeholder="Search the collection…" value="${esc(search)}" type="search"><label class="sr-only" for="sort">Sort products</label><select id="sort"><option value="">Featured</option><option value="price" ${sort==='price'?'selected':''}>Price: low to high</option></select></div></div><div class="catalog-tools"><div class="filters">${['','Audio','Workspace','Travel','Home'].map(c=>`<button class="chip ${category===c?'active':''}" data-category="${c}">${c || 'All objects'}</button>`).join('')}</div><span class="count" id="result-count"></span></div><div id="products" class="grid" aria-live="polite"></div><div id="pagination"></div></section><div class="note-strip"><span>↗ <strong>Considered design</strong> for real life</span><span>□ <strong>Free shipping</strong> on orders $150+</span><span>◇ <strong>100% simulated</strong> payments</span></div></div>`;
  $('#search').oninput=e=>{search=e.target.value;page=1;clearTimeout(searchTimer);searchTimer=setTimeout(loadProducts,350);};$('#sort').onchange=e=>{sort=e.target.value;page=1;loadProducts();};
  main.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{category=b.dataset.category;page=1;main.querySelectorAll('[data-category]').forEach(x=>x.classList.toggle('active',x===b));loadProducts();});loadProducts();
}
let productRequest=0;
async function loadProducts(){
  const target=$('#products');if(!target)return;const request=++productRequest;
  target.innerHTML=Array.from({length:6},()=>'<div class="skeleton" aria-label="Loading product"></div>').join('');target.setAttribute('aria-busy','true');
  try{
    const [data,inventory,settings]=await Promise.all([api(`/products?q=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}&sort=${sort}&page=${page}`),api('/inventory'),api('/lab/config')]);
    if(settings.renderDelay)await new Promise(r=>setTimeout(r,settings.renderDelay));
    if(request!==productRequest || !target.isConnected)return;config=settings;stock=inventory;
    // Keep previously loaded products to support a bag spanning multiple pages.
    for(const p of data.items){catalog=catalog.filter(x=>x.id!==p.id);catalog.push(p);}
    target.innerHTML=data.items.length?data.items.map(p=>`<article class="product ${config.locatorMode==='dynamic'?`product-${crypto.randomUUID().slice(0,8)}`:''}" ${config.locatorMode==='stable'?`data-testid="product-${p.id}"`:''} aria-label="${esc(p.name)}" data-product="${p.id}"><div class="product-art ${p.color}"><span class="product-tag">${stock[p.id]===1?'LAST ONE':p.category.toUpperCase()}</span><span class="object" aria-hidden="true">${p.icon}</span></div><div class="product-meta"><div><h3>${esc(p.name)}</h3><span class="category">${esc(p.category)}</span></div><span class="price">${money(p.price)}</span></div><div class="product-bottom"><span class="${stock[p.id]<=3?'stock-low':''}">${stock[p.id]>0?`${stock[p.id]} available`:'Sold out'}</span><button class="add-button" id="add-${config.locatorMode==='dynamic'?crypto.randomUUID():p.id}" ${config.locatorMode==='stable'?`data-testid="add-${p.id}"`:''} data-add="${p.id}" ${stock[p.id]<=0?'disabled':''}>Add to bag +</button></div></article>`).join(''):'<div class="empty">No objects found. Try another search.</div>';
    $('#result-count').textContent=`${data.total} objects`;$('#pagination').innerHTML=data.total>6?`<div class="page-controls"><button id="prev" class="chip" ${page===1?'disabled':''}>Previous</button><span>Page ${page}</span><button id="next" class="chip" ${page*6>=data.total?'disabled':''}>Next</button></div>`:'';
    target.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>add(b.dataset.add,b));
    if($('#prev'))$('#prev').onclick=()=>{page--;loadProducts();};if($('#next'))$('#next').onclick=()=>{page++;loadProducts();};
  }catch(e){if(request===productRequest && target.isConnected)target.innerHTML=`<div class="inline-error">${esc(e.message)} <button class="text-button" id="retry">Try again</button></div>`;if($('#retry'))$('#retry').onclick=loadProducts;}
  finally{target.removeAttribute('aria-busy');}
}
async function ordersView(silent=false){
  if(!account){main.innerHTML='<div class="wrap page"><div class="empty"><h2>Your next good thing starts here.</h2><p>Sign in to see your orders.</p><button id="orders-signin" class="btn">Sign in</button></div></div>';$('#orders-signin').onclick=authModal;return;}
  const version=viewVersion;
  try{const orders=await api('/orders');if(location.hash!=='#orders' || version!==viewVersion)return;
    main.innerHTML=`<div class="wrap page"><div class="page-head"><div><div class="eyebrow">From bag to doorstep</div><h1>Your orders.</h1><p>Follow every step of the asynchronous checkout.</p></div><button id="refresh-orders" class="btn secondary">Refresh</button></div>${orders.length?orders.map(o=>`<article class="panel order" data-order-id="${o.id}"><div class="order-head"><div><h3>Order ${o.id.slice(0,8)}</h3><p class="hint">${new Date(o.createdAt).toLocaleString()} · ${money(o.total)}</p></div><span class="badge ${o.status}" data-testid="order-status">${o.status.replaceAll('_',' ')}</span></div><div class="order-items">${o.items.map(i=>`${i.quantity} × ${esc(i.name)} · ${money(i.unitPrice*i.quantity)}`).join('<br>')}</div>${o.reason?`<p class="inline-error">${esc(o.reason)}</p>`:''}<div class="history">${o.history.map(h=>`<span>● ${esc(h.status.replaceAll('_',' '))} <time>${new Date(h.at).toLocaleTimeString()}</time></span>`).join('<span>→</span>')}</div></article>`).join(''):'<div class="empty"><h2>A fresh start.</h2><p>No orders yet. Discover something in the collection.</p><a class="btn" href="#shop">Explore the collection →</a></div>'}</div>`;$('#refresh-orders').onclick=()=>ordersView();
  }catch(e){if(!silent)main.innerHTML=`<div class="wrap page"><div class="inline-error">${esc(e.message)}</div></div>`;}
}
const controlDefinitions=[
 ['locatorMode','Locator mode','Dynamic mode changes IDs and removes test IDs.','select',['stable','dynamic']],
 ['renderDelay','Rendering delay','Delay product rendering by 0–5000 ms.','number'],
 ['apiDelay','API latency','Delay business API requests by 0–5000 ms.','number'],
 ['paymentMode','Payment outcome','Timeout simulates a definitive timeout failure.','select',['approve','decline','timeout']],
 ['paymentDelay','Payment delay','Wait 0–5000 ms before handling payment.','number'],
 ['sessionSeconds','New session lifetime','1–86400 seconds. Sign in again after changing.','number'],
 ['pauseInventory','Pause inventory consumer','Orders remain pending until resumed.','checkbox'],
 ['pausePayments','Pause payment consumer','Reservations remain held until resumed.','checkbox'],
 ['duplicateEvents','Duplicate deliveries','Exercise inbox deduplication.','checkbox'],
 ['stalePrice','Stale storefront prices','Show prices $1 below authoritative catalog prices.','checkbox'],
 ['rateLimit','Enable rate limit','12 business requests / 10 seconds per token/IP.','checkbox']
];
async function labView(){
  const version=viewVersion;
  try{config=await api('/lab/config');if(location.hash!=='#lab' || version!==viewVersion)return;
    main.innerHTML=`<div class="wrap page"><div class="page-head"><div><div class="eyebrow">The engine room</div><h1>Curiosity, in control.</h1><p>Set the conditions. Observe the system. Find the edge cases.</p></div><span class="transport" id="transport">Connecting…</span></div><div class="lab-grid"><section class="panel"><h3>Scenario controls</h3><div class="scenario-list"><button class="chip" data-preset="baseline">Baseline</button><button class="chip" data-preset="locators">Locator challenge</button><button class="chip" data-preset="failure">Payment failure</button><button class="chip" data-preset="async">Slow checkout</button></div><form id="lab-form">${controlDefinitions.map(([key,label,hint,type,options])=>`<label class="control"><span>${label}<small>${hint}</small></span>${type==='select'?`<select name="${key}">${options.map(v=>`<option ${config[key]===v?'selected':''}>${v}</option>`).join('')}</select>`:type==='checkbox'?`<input name="${key}" type="checkbox" ${config[key]?'checked':''}>`:`<input name="${key}" type="number" min="${key==='sessionSeconds'?1:0}" max="${key==='sessionSeconds'?86400:5000}" value="${config[key]}">`}</label>`).join('')}<div class="buttons"><button class="btn" type="submit">Apply scenario</button><button class="btn secondary" id="defaults" type="button">Restore baseline</button></div><p class="hint">Controls are global across all accounts. They persist between restarts. Restoring baseline keeps orders and stock.</p></form></section><div><section class="panel"><h3>Service health & event stream</h3><div id="services" class="service-list"></div><div id="events" class="events"><div class="empty">Waiting for the first event…</div></div><p class="hint">Latest 100 mirrored events · refreshes every 2 seconds. In Kafka mode this is an application audit view; use Kafka tooling for offsets and lag.</p></section><section class="panel challenge"><h3>Try this: one item, two customers</h3><ol><li>Open two separate browser sessions and sign in with different accounts.</li><li>Add the Pocket Mini Speaker to each bag. Only one is in stock.</li><li>Place both orders. Exactly one should be confirmed.</li><li>Verify the loser is rejected and stock never becomes negative.</li></ol><p>Read <strong>docs/CHALLENGES.md</strong> for the full exercise catalogue, API examples, and expected results.</p></section></div></div></div>`;
    $('#lab-form').onsubmit=async e=>{e.preventDefault();const values={};for(const [key,,,type]of controlDefinitions){const field=e.currentTarget.elements[key];values[key]=type==='checkbox'?field.checked:type==='number'?Number(field.value):field.value;}try{config=await api('/lab/config',payload(values));toast('Scenario applied');}catch(e){toast(e.message);}};
    $('#defaults').onclick=async()=>{try{await api('/lab/defaults',payload({}));await labView();toast('Baseline restored');}catch(e){toast(e.message);}};
    main.querySelectorAll('[data-preset]').forEach(b=>b.onclick=async()=>{try{await api('/lab/defaults',payload({}));const values={baseline:{},locators:{locatorMode:'dynamic',renderDelay:1500},failure:{paymentMode:'decline'},async:{paymentDelay:4000}}[b.dataset.preset];await api('/lab/config',payload(values));await labView();toast('Preset applied');}catch(e){toast(e.message);}});await refreshLab();
  }catch(e){main.innerHTML=`<div class="wrap page"><div class="inline-error">${esc(e.message)}</div></div>`;}
}
async function refreshLab(){
  const version=viewVersion;
  try{const [status,events]=await Promise.all([api('/lab/status'),api('/lab/events')]);if(location.hash!=='#lab' || version!==viewVersion || !$('#events'))return;
    $('#transport').textContent=`${status.transport.toUpperCase()} TRANSPORT`;
    $('#services').innerHTML=status.services.map(s=>`<span class="service-pill ${s.status!=='ok'?'bad':''}" title="${esc(s.eventError || s.status)}">● ${s.service} · ${s.status}</span>`).join('');
    $('#events').innerHTML=events.length?events.map(e=>`<div class="event"><div class="event-top"><strong>${esc(e.type)}</strong><time>${new Date(e.createdAt).toLocaleTimeString()}</time></div><code>order ${esc(e.orderId)}<br>event ${esc(e.id)}</code></div>`).join(''):'<div class="empty">No events yet. Place a test order to start the story.</div>';
  }catch(e){if($('#services'))$('#services').textContent=e.message;}
}
function render(){viewVersion++;const route=location.hash.slice(1) || 'shop';document.querySelectorAll('[data-nav]').forEach(a=>a.classList.toggle('active',a.dataset.nav===route));if(route==='orders')ordersView();else if(route==='lab')labView();else shopShell();}
$('#account').onclick=async()=>{if(!account)return authModal();try{await api('/auth/logout',payload({}));}catch{}token='';account=null;cart=[];sessionStorage.removeItem('qa-token');updateHeader();render();toast('Signed out');};
$('#cart-open').onclick=()=>account?cartModal():authModal();
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom)dialog.close();}});
window.addEventListener('hashchange',()=>{dialog.close();render();});
setInterval(async()=>{if(pollBusy || document.hidden)return;pollBusy=true;try{if(location.hash==='#lab')await refreshLab();if(location.hash==='#orders' && !dialog.open)await ordersView(true);}finally{pollBusy=false;}},2000);
if(token){try{account=await api('/auth/me');cart=await api('/cart');}catch(e){toast(e.message);}}
updateHeader();render();
