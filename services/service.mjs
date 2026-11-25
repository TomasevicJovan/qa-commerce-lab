import { createServer } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { database, defaults, products, categoryTree, popularSubcategories, CATALOG_VERSION, priceOrder, PAYMENT_METHODS, validateCard, isExpired, MAX_SAVED_CARDS, call, post, fail, body, json, id, ports, host, basePort } from './common.mjs';
import { emit, eventLoop } from './events.mjs';
const name=process.env.SERVICE; const store=database(name);
const timestamp=()=>new Date().toISOString();
function hash(password,salt) { return scryptSync(password,salt,32).toString('hex'); }
function seed() {
  if (name==='identity' && !store.get('users',null)) {
    const salt=randomBytes(16).toString('hex');
    store.set('users',[{id:'demo-user',email:'qa@example.com',name:'QA Engineer',salt,password:hash('Testing123!',salt),role:'customer'}]);
  }
  // Catalog is reference data: a newer seed version replaces it. Inventory keeps existing counts and only adds new products,
  // so upgrading the catalog never restocks or resets the current timeline.
  if (name==='catalog' && (!store.get('products',null) || store.get('catalogVersion',1)!==CATALOG_VERSION)) { store.set('products',products); store.set('catalogVersion',CATALOG_VERSION); }
  // Demo customer starts with saved cards covering every outcome: approved Visa, approved Mastercard, declined Visa, expired Mastercard.
  if (name==='orders' && !store.get('cardsSeeded',false)) {
    const at=timestamp(), card=(id,brand,last4,expMonth,expYear,outcome)=>({id,holder:'QA Engineer',brand,last4,expMonth,expYear,outcome,createdAt:at});
    store.set('cards:demo-user',[card('card-demo-visa','visa','4242',12,2030,'approve'),card('card-demo-mastercard','mastercard','4444',8,2029,'approve'),card('card-demo-declined','visa','0002',5,2029,'card_declined'),card('card-demo-expired','mastercard','5100',1,2025,'approve')]);
    store.set('cardsSeeded',true);
  }
  if (name==='inventory') { const stock=store.get('stock',{}); let changed=false; for (const p of products) if (!Object.hasOwn(stock,p.id)) { stock[p.id]=p.stock; changed=true; } if (changed || !store.get('stock',null)) store.set('stock',stock); }
}
seed();
async function user(req) {
  return call('identity','/api/auth/me',{headers:{authorization:req.headers.authorization || ''}});
}
const publicCard=c=>({id:c.id,holder:c.holder,brand:c.brand,last4:c.last4,expMonth:c.expMonth,expYear:c.expYear,expired:isExpired(c.expMonth,c.expYear),createdAt:c.createdAt});
const fingerprint=input=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
function ownOrder(orderId,userId) { const order=store.get('orders',{})[orderId]; if (!order || order.userId!==userId) fail(404,'Order not found'); return order; }
function handleEvent(event,config) {
  const {type,orderId,data}=event;
  if (name==='inventory' && type==='OrderPlaced') {
    const reservations=store.get('reservations',{}); if (reservations[orderId]) return;
    const stock=store.get('stock',{});
    if (data.items.some(item=>(stock[item.productId] || 0)<item.quantity)) { reservations[orderId]={status:'rejected'}; emit(store,'InventoryRejected',orderId,{reason:'Insufficient stock'}); }
    else { for (const item of data.items) stock[item.productId]-=item.quantity; reservations[orderId]={status:'reserved',items:data.items}; store.set('stock',stock); emit(store,'InventoryReserved',orderId,{total:data.total,paymentMethod:data.paymentMethod,payment:data.payment}); }
    store.set('reservations',reservations);
  }
  if (name==='inventory' && type==='PaymentFailed') {
    const reservations=store.get('reservations',{}); const reservation=reservations[orderId];
    if (reservation?.status==='reserved') { const stock=store.get('stock',{}); for (const item of reservation.items) stock[item.productId]+=item.quantity; reservation.status='released'; store.set('stock',stock); store.set('reservations',reservations); emit(store,'InventoryReleased',orderId,{reason:data.reason}); }
  }
  if (name==='payments' && type==='InventoryReserved') {
    const records=store.get('payments',{}); if (records[orderId]) return;
    // The lab scenario wins over the card: decline/timeout fail every payment. Otherwise the simulated processor verdict decides.
    const reason=config.paymentMode!=='approve'?config.paymentMode:data.payment?.outcome==='card_declined'?'card_declined':null; const success=!reason;
    records[orderId]={id:id(),orderId,amount:data.total,method:data.paymentMethod,...(data.payment?.brand?{brand:data.payment.brand,last4:data.payment.last4}:{}),status:success?'approved':'failed',reason,createdAt:timestamp()}; store.set('payments',records);
    emit(store,success?'PaymentApproved':'PaymentFailed',orderId,{reason,amount:data.total});
  }
  if (name==='orders' && ['InventoryReserved','InventoryRejected','PaymentApproved','PaymentFailed','InventoryReleased'].includes(type)) {
    const orders=store.get('orders',{}); const order=orders[orderId]; if (!order) return;
    const next={InventoryReserved:'payment_pending',InventoryRejected:'rejected',PaymentApproved:'confirmed',PaymentFailed:'compensating',InventoryReleased:'cancelled'}[type];
    const allowed={pending:['InventoryReserved','InventoryRejected'],payment_pending:['PaymentApproved','PaymentFailed'],compensating:['InventoryReleased']};
    if (!(allowed[order.status] || []).includes(type)) return;
    order.status=next; order.reason=['rejected','compensating','cancelled'].includes(next)?data.reason:null; order.updatedAt=timestamp(); order.history.push({status:next,at:timestamp(),eventId:event.id}); store.set('orders',orders);
    if (next==='confirmed') emit(store,'OrderConfirmed',orderId,{total:order.total});
  }
}
if (['orders','inventory','payments'].includes(name)) eventLoop(name,store,handleEvent).catch(e=>{console.error(`${name} event loop:`,e.message);process.exit(1);});
createServer(async(req,res)=>{try {
  const u=new URL(req.url,'http://local'); const path=u.pathname; const method=req.method;
  if (path==='/health') return json(res,200,{status:store.get('eventError',null)?'degraded':'ok',service:name,eventError:store.get('eventError',null),pendingEvents:store.get('outbox',[]).length});
  if (name==='identity') {
    if (method==='POST' && ['/api/auth/login','/api/auth/register'].includes(path)) {
      const input=await body(req); const email=String(input.email || '').trim().toLowerCase(); const password=String(input.password || '');
      const users=store.get('users',[]); let account=users.find(x=>x.email===email);
      if (path.endsWith('register')) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length<8 || password.length>128 || !String(input.name || '').trim()) fail(422,'Name, valid email and password of 8–128 characters required');
        if (account) fail(409,'Email already registered'); const salt=randomBytes(16).toString('hex');
        account={id:id(),email,name:String(input.name).trim().slice(0,100),salt,password:hash(password,salt),role:'customer'}; users.push(account); store.set('users',users);
      } else if (!account || password.length>128 || !timingSafeEqual(Buffer.from(hash(password,account.salt),'hex'),Buffer.from(account.password,'hex'))) fail(401,'Invalid email or password');
      const config=await call('broker','/config'); const token=randomBytes(32).toString('hex'); const sessions=store.get('sessions',{}); sessions[token]={userId:account.id,expiresAt:Date.now()+config.sessionSeconds*1000}; store.set('sessions',sessions);
      return json(res,path.endsWith('register')?201:200,{token,user:{id:account.id,email:account.email,name:account.name,role:account.role},expiresAt:sessions[token].expiresAt});
    }
    if (path==='/api/auth/me' || path==='/api/auth/logout') {
      const token=(req.headers.authorization || '').replace(/^Bearer /,''); const sessions=store.get('sessions',{}); const session=sessions[token];
      if (!session || session.expiresAt<=Date.now()) fail(401,'Session expired. Please sign in.');
      if (path.endsWith('logout') && method==='POST') { delete sessions[token]; store.set('sessions',sessions); return json(res,200,{loggedOut:true}); }
      if (method!=='GET') fail(405,'Method not allowed');
      const account=store.get('users',[]).find(x=>x.id===session.userId); return json(res,200,{id:account.id,email:account.email,name:account.name,role:account.role});
    }
  }
  if (name==='catalog' && method==='GET' && path==='/api/products/categories') {
    const list=store.get('products',[]);
    return json(res,200,categoryTree.map(c=>({name:c.name,productCount:list.filter(p=>p.category===c.name).length,subcategories:c.subcategories.map(sub=>({name:sub,popular:popularSubcategories.includes(sub),productCount:list.filter(p=>p.subcategory===sub).length}))})));
  }
  if (name==='catalog' && method==='GET' && path.startsWith('/api/products')) {
    let list=store.get('products',[]); const productId=path.split('/')[3] && decodeURIComponent(path.split('/')[3]);
    if (productId) { const product=list.find(p=>p.id===productId); if (!product) fail(404,'Product not found'); return json(res,200,product); }
    const query=(u.searchParams.get('q') || '').trim().toLowerCase(); const category=u.searchParams.get('category'),subcategory=u.searchParams.get('subcategory');
    const deal=u.searchParams.get('deal'),freeShipping=u.searchParams.get('freeShipping'),sort=u.searchParams.get('sort');
    if (deal && deal!=='black-friday') fail(422,'Unknown deal. Use black-friday');
    if (freeShipping && !['true','false'].includes(freeShipping)) fail(422,'freeShipping must be true or false');
    list=list.filter(p=>[p.name,p.category,p.subcategory].some(t=>t.toLowerCase().includes(query)) && (!category || p.category===category) && (!subcategory || p.subcategory===subcategory) && (!deal || p.deal===deal) && (!freeShipping || p.freeShipping===(freeShipping==='true')));
    if (sort==='price') list.sort((a,b)=>a.price-b.price); else if (sort==='price-desc') list.sort((a,b)=>b.price-a.price); else if (sort==='popular') list.sort((a,b)=>b.popularity-a.popularity);
    const page=Number(u.searchParams.get('page') || 1),limit=Number(u.searchParams.get('limit') || 6);
    if (!Number.isInteger(page) || page<1 || !Number.isInteger(limit) || limit<1 || limit>50) fail(422,'Invalid pagination');
    const config=await call('broker','/config');
    return json(res,200,{items:list.slice((page-1)*limit,page*limit).map(p=>({...p,price:config.stalePrice?p.price-100:p.price})),total:list.length,page,limit});
  }
  if (name==='inventory' && method==='GET' && path==='/api/inventory') return json(res,200,store.get('stock',{}));
  if (name==='payments' && method==='GET' && /^\/api\/payments\/[^/]+$/.test(path)) {
    const account=await user(req); const orderId=path.split('/')[3]; await call('orders',`/api/orders/${orderId}`,{headers:{authorization:req.headers.authorization}});
    return json(res,200,store.get('payments',{})[orderId] || {orderId,status:'pending'});
  }
  if (name==='orders') {
    const account=await user(req);
    if (path==='/api/cart' && method==='GET') return json(res,200,store.get(`cart:${account.id}`,[]));
    if (path==='/api/cart' && method==='PUT') {
      const input=await body(req); if (!Array.isArray(input.items) || input.items.length>20) fail(422,'items must contain at most 20 products');
      const seen=new Set();
      for (const item of input.items) { if (!item || typeof item.productId!=='string' || !Number.isInteger(item.quantity) || item.quantity<1 || item.quantity>10 || seen.has(item.productId)) fail(422,'Unique products with quantities 1–10 required'); seen.add(item.productId); await call('catalog',`/api/products/${encodeURIComponent(item.productId)}`); }
      store.set(`cart:${account.id}`,input.items.map(({productId,quantity})=>({productId,quantity}))); return json(res,200,store.get(`cart:${account.id}`,[]));
    }
    if (path==='/api/wishlist' && method==='GET') return json(res,200,store.get(`wishlist:${account.id}`,[]));
    if (/^\/api\/wishlist\/[^/]+$/.test(path) && ['PUT','DELETE'].includes(method)) {
      const productId=decodeURIComponent(path.split('/')[3]); const list=store.get(`wishlist:${account.id}`,[]);
      if (method==='DELETE') { const next=list.filter(i=>i.productId!==productId); store.set(`wishlist:${account.id}`,next); return json(res,200,next); }
      if (list.some(i=>i.productId===productId)) return json(res,200,list);
      await call('catalog',`/api/products/${encodeURIComponent(productId)}`);
      if (list.length>=50) fail(422,'Wishlist can hold at most 50 products');
      const next=[{productId,addedAt:timestamp()},...list]; store.set(`wishlist:${account.id}`,next); return json(res,200,next);
    }
    if (path==='/api/cards' && method==='GET') return json(res,200,store.get(`cards:${account.id}`,[]).map(publicCard));
    if (path==='/api/cards' && method==='POST') {
      const card=validateCard(await body(req)); const cards=store.get(`cards:${account.id}`,[]);
      const same=cards.find(c=>c.brand===card.brand && c.last4===card.last4 && c.expMonth===card.expMonth && c.expYear===card.expYear);
      if (same) return json(res,200,publicCard(same));
      if (cards.length>=MAX_SAVED_CARDS) fail(422,`You can save at most ${MAX_SAVED_CARDS} cards`,'card');
      const saved={id:id(),...card,createdAt:timestamp()}; store.set(`cards:${account.id}`,[...cards,saved]); return json(res,201,publicCard(saved));
    }
    if (/^\/api\/cards\/[^/]+$/.test(path) && method==='DELETE') {
      const cardId=decodeURIComponent(path.split('/')[3]); const cards=store.get(`cards:${account.id}`,[]);
      if (!cards.some(c=>c.id===cardId)) fail(404,'Card not found');
      const next=cards.filter(c=>c.id!==cardId); store.set(`cards:${account.id}`,next); return json(res,200,next.map(publicCard));
    }
    if (path==='/api/orders' && method==='GET') return json(res,200,Object.values(store.get('orders',{})).filter(o=>o.userId===account.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
    if (path==='/api/orders' && method==='POST') {
      const input=await body(req); const key=req.headers['idempotency-key'];
      if (!key || key.length>100) fail(422,'Idempotency-Key header required (max 100 characters)');
      const existing=store.get('idempotency',{})[`${account.id}:${key}`];
      if (existing) { if (existing.fingerprint!==fingerprint(input)) fail(409,'Idempotency key already used with different request'); return json(res,200,ownOrder(existing.orderId,account.id)); }
      if (!input.address || ['name','line1','city','postalCode','country'].some(k=>typeof input.address[k]!=='string' || !input.address[k].trim() || input.address[k].length>200)) fail(422,'Complete shipping address required');
      if (!PAYMENT_METHODS.includes(input.paymentMethod)) fail(422,'Choose a payment method: card or test-wallet','paymentMethod');
      // Resolve the card before anything is saved. New card details are validated, then reduced to brand, last4 and verdict.
      let payment={method:input.paymentMethod},cardToSave=null;
      if (input.paymentMethod==='card') {
        if (Boolean(input.savedCardId)===Boolean(input.card)) fail(422,'Pay with either a saved card or a new card','card');
        if (input.savedCardId) {
          const saved=store.get(`cards:${account.id}`,[]).find(c=>c.id===input.savedCardId); if (!saved) fail(422,'Saved card not found','savedCardId');
          if (isExpired(saved.expMonth,saved.expYear)) fail(422,'This saved card has expired. Choose another card','savedCardId');
          payment={method:'card',brand:saved.brand,last4:saved.last4,savedCardId:saved.id,outcome:saved.outcome};
        } else {
          const card=validateCard(input.card); payment={method:'card',brand:card.brand,last4:card.last4,outcome:card.outcome};
          if (input.saveCard===true) cardToSave=card;
        }
      } else if (input.savedCardId || input.card) fail(422,'Card details are only accepted with the card payment method','paymentMethod');
      if (input.coupon && !['SAVE10','EXPIRED'].includes(input.coupon)) fail(422,'Unknown coupon'); if (input.coupon==='EXPIRED') fail(422,'Coupon has expired');
      const cart=store.get(`cart:${account.id}`,[]); if (!cart.length) fail(422,'Cart is empty');
      const items=await Promise.all(cart.map(async item=>{const p=await call('catalog',`/api/products/${encodeURIComponent(item.productId)}`);return {...item,name:p.name,unitPrice:p.price,freeShipping:p.freeShipping};}));
      const {subtotal,couponDiscount,paymentDiscount,discount,shipping,total}=priceOrder(items,{coupon:input.coupon || '',cardBrand:payment.brand});
      if (!Number.isInteger(input.expectedTotal) || input.expectedTotal!==total) fail(409,`Price changed. Current total is ${total} cents. Refresh your cart.`);
      let order;
      store.transaction(()=>{
        // Recheck inside transaction after asynchronous catalog requests.
        const keys=store.get('idempotency',{}); const prior=keys[`${account.id}:${key}`];
        if (prior) { if (prior.fingerprint!==fingerprint(input)) fail(409,'Idempotency conflict'); order=ownOrder(prior.orderId,account.id); return; }
        if (JSON.stringify(store.get(`cart:${account.id}`,[]))!==JSON.stringify(cart)) fail(409,'Cart changed during checkout');
                if (cardToSave) {
          const cards=store.get(`cards:${account.id}`,[]); const same=cards.find(c=>c.brand===cardToSave.brand && c.last4===cardToSave.last4 && c.expMonth===cardToSave.expMonth && c.expYear===cardToSave.expYear);
          if (same) payment.savedCardId=same.id;
          else { if (cards.length>=MAX_SAVED_CARDS) fail(422,`You can save at most ${MAX_SAVED_CARDS} cards. Untick "Save this card" or remove one`,'saveCard'); const saved={id:id(),...cardToSave,createdAt:timestamp()}; store.set(`cards:${account.id}`,[...cards,saved]); payment.savedCardId=saved.id; }
        }
        const {outcome,...publicPayment}=payment;
        order={id:id(),userId:account.id,items,address:input.address,paymentMethod:input.paymentMethod,payment:publicPayment,coupon:input.coupon || '',subtotal,couponDiscount,paymentDiscount,discount,shipping,total,status:'pending',createdAt:timestamp(),updatedAt:timestamp(),history:[{status:'pending',at:timestamp()}]};
        const orders=store.get('orders',{}); orders[order.id]=order; store.set('orders',orders); keys[`${account.id}:${key}`]={orderId:order.id,fingerprint:fingerprint(input)}; store.set('idempotency',keys); store.set(`cart:${account.id}`,[]); emit(store,'OrderPlaced',order.id,{items,total,paymentMethod:input.paymentMethod,payment});
      });
      return json(res,202,order);
    }
    if (method==='GET' && /^\/api\/orders\/[^/]+$/.test(path)) return json(res,200,ownOrder(path.split('/')[3],account.id));
  }
  json(res,404,{error:'Not found'});
}catch(e){json(res,e.status || 500,{error:e.status?e.message:'Internal service error',...(e.field?{field:e.field}:{})}); if (!e.status) console.error(name,e);}}).listen(ports[name]+basePort,host,()=>console.log(`${name}: ${ports[name]+basePort}`));
