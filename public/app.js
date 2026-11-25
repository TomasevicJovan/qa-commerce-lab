// FORMA storefront. Framework-free on purpose: the DOM you test is the DOM this file writes.
const $ = s => document.querySelector(s);
const main = $('#main'), dialog = $('#dialog');
const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wait = ms => new Promise(r => setTimeout(r, ms));
const shortId = id => String(id).slice(0, 8);

let token = sessionStorage.getItem('qa-token') || '', account = null, cart = [], wishlist = [], categories = [], stock = {}, config = {};
let viewVersion = 0, authRegister = false, searchTimer, pollBusy = false, checkoutKey = null;
const catalog = new Map(); // every product seen so far, so a bag or wishlist can span pages
const PAGE_SIZE = 8;
const SORTS = [['', 'Featured'], ['popular', 'Most popular'], ['price', 'Price: low to high'], ['price-desc', 'Price: high to low']];
const BRANDS = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express' };
const REASONS = { card_declined: 'Your card was declined', decline: 'The payment was declined', timeout: 'The payment timed out', 'Insufficient stock': 'A product in your order is out of stock' };
const STATUS_LABELS = { pending: 'Order received', payment_pending: 'Processing payment', confirmed: 'Confirmed', rejected: 'Not completed', compensating: 'Payment failed', cancelled: 'Cancelled' };
const TERMINAL = ['confirmed', 'rejected', 'cancelled'];

// ---------- Notifications ----------
// One place for every message in the app. Success and info messages are announced politely; errors interrupt (role=alert).
function notify(message, type = 'success', title = '') {
  const box = document.createElement('div');
  box.className = `notification ${type}`; box.setAttribute('role', type === 'error' ? 'alert' : 'status'); box.dataset.type = type;
  box.innerHTML = `<span class="notification-icon" aria-hidden="true">${{ success: '✓', error: '!', info: 'i', warning: '!' }[type] || 'i'}</span><div class="notification-body">${title ? `<strong>${esc(title)}</strong>` : ''}<p>${esc(message)}</p></div><button class="notification-close" aria-label="Dismiss notification">×</button>`;
  const close = () => { box.classList.add('leaving'); setTimeout(() => box.remove(), 200); };
  box.querySelector('button').onclick = close;
  $('#notifications').prepend(box);
  while ($('#notifications').children.length > 4) $('#notifications').lastElementChild.remove();
  setTimeout(close, type === 'error' ? 9000 : 5000);
}

// ---------- API ----------
async function api(path, options = {}) {
  let res;
  try { res = await fetch('/api' + path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } }); }
  catch { throw Object.assign(new Error('We could not reach the store. Check your connection and try again.'), { network: true }); }
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && token) { clearSession(); updateHeader(); notify('Your session has expired. Please sign in again.', 'warning', 'Signed out'); }
    throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, field: data.field });
  }
  return data;
}
const payload = (data, method = 'POST') => ({ method, body: JSON.stringify(data) });
function clearSession() { token = ''; account = null; cart = []; wishlist = []; sessionStorage.removeItem('qa-token'); }
function remember(products) { for (const p of products) catalog.set(p.id, p); return products; }
async function product(id) { return catalog.get(id) || remember([await api(`/products/${encodeURIComponent(id)}`)])[0]; }

// ---------- Pricing (mirrors the backend; the backend stays authoritative) ----------
function total(lines, coupon = '', cardBrand = '') {
  const subtotal = lines.reduce((n, l) => n + l.price * l.quantity, 0);
  const couponDiscount = coupon === 'SAVE10' ? Math.round(subtotal * 0.1) : 0;
  const paymentDiscount = cardBrand === 'mastercard' ? Math.round((subtotal - couponDiscount) * 0.1) : 0;
  const discount = couponDiscount + paymentDiscount;
  const allFreeShipping = lines.length > 0 && lines.every(l => l.freeShipping);
  const shipping = subtotal - discount >= 15000 || allFreeShipping ? 0 : 700;
  return { subtotal, couponDiscount, paymentDiscount, discount, shipping, total: subtotal - discount + shipping };
}
function totalsHtml(t) {
  return `<div class="totals"><div><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
    ${t.couponDiscount ? `<div class="sub-line"><span>Coupon SAVE10</span><span>−${money(t.couponDiscount)}</span></div>` : ''}
    ${t.paymentDiscount ? `<div class="sub-line"><span>Mastercard 10%</span><span>−${money(t.paymentDiscount)}</span></div>` : ''}
    <div><span>Discount</span><span>−${money(t.discount)}</span></div>
    <div><span>Shipping</span><span>${t.shipping ? money(t.shipping) : 'On us'}</span></div>
    <div class="grand"><span>Total</span><span>${money(t.total)}</span></div></div>`;
}

// ---------- Shared UI ----------
function updateHeader() {
  $('#account').textContent = account ? `${account.name} ▾` : 'Sign in';
  $('#account').setAttribute('aria-haspopup', account ? 'true' : 'false');
  $('#register-open').hidden = Boolean(account);
  $('#cart-count').textContent = cart.reduce((n, i) => n + i.quantity, 0);
  $('#wishlist-count').textContent = wishlist.length;
}
function modal(title, html) {
  $('#dialog-content').innerHTML = `<div class="modal-head"><h2>${esc(title)}</h2><button class="close" aria-label="Close dialog">×</button></div><div class="modal-body">${html}</div>`;
  $('#dialog-content .close').onclick = () => dialog.close();
  if (!dialog.open) dialog.showModal();
}
function openMenu(button, menu, open) {
  menu.hidden = !open; button.setAttribute('aria-expanded', String(open));
  if (open) menu.querySelector('a,button')?.focus();
}
function closeMenus() {
  openMenu($('#categories-toggle'), $('#categories-menu'), false);
  openMenu($('#account'), $('#account-menu'), false);
}
const categoryHash = (category, subcategory = '') => shopHash({ category, subcategory });

// ---------- Product card ----------
function productCard(p) {
  const dynamic = config.locatorMode === 'dynamic', available = stock[p.id] ?? 0, wished = wishlist.includes(p.id);
  const percent = p.compareAtPrice ? Math.round((1 - p.price / p.compareAtPrice) * 100) : 0;
  return `<article class="product ${dynamic ? `product-${crypto.randomUUID().slice(0, 8)}` : ''}" ${dynamic ? '' : `data-testid="product-${p.id}"`} aria-label="${esc(p.name)}" data-product="${p.id}">
    <div class="product-art ${esc(p.color)}">
      <div class="product-tags">${p.deal ? `<span class="product-tag deal">Black Friday −${percent}%</span>` : ''}${available === 1 ? '<span class="product-tag">Last one</span>' : ''}</div>
      <button class="wish-button ${wished ? 'active' : ''}" data-wish="${p.id}" aria-pressed="${wished}" aria-label="${wished ? 'Remove' : 'Add'} ${esc(p.name)} ${wished ? 'from' : 'to'} wishlist">${wished ? '♥' : '♡'}</button>
      <span class="object" aria-hidden="true">${esc(p.icon)}</span>
    </div>
    <div class="product-meta">
      <div><h3>${esc(p.name)}</h3><a class="category" href="${categoryHash(p.category, p.subcategory)}">${esc(p.subcategory)}</a></div>
      <div class="price-box"><span class="price ${p.deal ? 'sale' : ''}">${money(p.price)}</span>${p.compareAtPrice ? `<s class="compare-price" aria-label="Was ${money(p.compareAtPrice)}">${money(p.compareAtPrice)}</s>` : ''}</div>
    </div>
    ${p.freeShipping ? '<span class="free-shipping">✓ Free shipping</span>' : ''}
    <div class="product-bottom"><span class="${available <= 3 ? 'stock-low' : ''}">${available > 0 ? `${available} available` : 'Sold out'}</span>
      <button class="add-button" id="add-${dynamic ? crypto.randomUUID() : p.id}" ${dynamic ? '' : `data-testid="add-${p.id}"`} data-add="${p.id}" ${available <= 0 ? 'disabled' : ''}>Add to bag +</button></div>
  </article>`;
}
function bindCards(root) {
  root.querySelectorAll('[data-add]').forEach(b => b.onclick = () => add(b.dataset.add, b));
  root.querySelectorAll('[data-wish]').forEach(b => b.onclick = () => toggleWish(b.dataset.wish, b));
}
async function fetchProducts(params) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString();
  const [data, inventory, settings] = await Promise.all([api(`/products?${query}`), api('/inventory'), api('/lab/config')]);
  if (settings.renderDelay) await wait(settings.renderDelay);
  config = settings; stock = inventory; remember(data.items);
  return data;
}

// ---------- Bag ----------
async function saveCart(next) { cart = await api('/cart', payload({ items: next }, 'PUT')); checkoutKey = null; updateHeader(); }
async function cartDetails() { return Promise.all(cart.map(async item => ({ ...(await product(item.productId)), ...item }))); }
async function add(productId, button) {
  if (!account) { notify('Sign in to add products to your bag.', 'info'); return authModal(); }
  button.disabled = true;
  try {
    const next = structuredClone(cart), item = next.find(i => i.productId === productId);
    if (item) item.quantity++; else next.push({ productId, quantity: 1 });
    await saveCart(next); notify(`${(await product(productId)).name} was added to your bag.`, 'success', 'Added to your bag');
  } catch (e) { notify(e.message, 'error', 'Could not add to bag'); } finally { button.disabled = false; }
}
async function cartModal() {
  try {
    const items = await cartDetails(), t = total(items);
    modal('Your shopping bag', items.length ? `${items.map(i => `<div class="cart-item" data-cart-product="${esc(i.id)}"><div class="cart-icon ${esc(i.color)}" aria-hidden="true">${esc(i.icon)}</div><div class="cart-detail"><h3>${esc(i.name)}</h3><p>${money(i.price)}${i.compareAtPrice ? ` <s>${money(i.compareAtPrice)}</s>` : ''}${i.freeShipping ? ' · Free shipping' : ''}</p></div><div class="qty"><button data-minus="${esc(i.id)}" aria-label="Remove one ${esc(i.name)}">−</button><span>${i.quantity}</span><button data-plus="${esc(i.id)}" aria-label="Add one ${esc(i.name)}">+</button></div></div>`).join('')}
      ${totalsHtml(t)}<p class="hint">Free shipping from $150 after discounts, or when every item in your bag ships free. Pay with a Mastercard at checkout for an extra 10% off.</p><a id="checkout-open" class="btn" href="#checkout">Continue to checkout →</a>`
      : '<div class="empty">Your bag is waiting for a good find.</div>');
    dialog.querySelectorAll('[data-minus],[data-plus]').forEach(b => b.onclick = async () => {
      b.disabled = true; const productId = b.dataset.minus || b.dataset.plus, removing = b.dataset.minus && cart.find(i => i.productId === productId)?.quantity === 1;
      const next = cart.map(i => ({ ...i, quantity: i.quantity + (i.productId === productId ? (b.dataset.plus ? 1 : -1) : 0) })).filter(i => i.quantity > 0);
      try { await saveCart(next); if (removing) notify(`${(await product(productId)).name} was removed from your bag.`, 'info'); await cartModal(); } catch (e) { notify(e.message, 'error', 'Could not update your bag'); b.disabled = false; }
    });
  } catch (e) { notify(e.message, 'error'); }
}

// ---------- Wishlist ----------
async function toggleWish(productId, button) {
  if (!account) { notify('Sign in to save products to your wishlist.', 'info'); return authModal(); }
  button.disabled = true;
  const adding = !wishlist.includes(productId);
  try {
    const list = await api(`/wishlist/${encodeURIComponent(productId)}`, { method: adding ? 'PUT' : 'DELETE' });
    wishlist = list.map(i => i.productId); updateHeader();
    const name = (await product(productId)).name;
    document.querySelectorAll(`[data-wish="${CSS.escape(productId)}"]`).forEach(b => {
      b.classList.toggle('active', adding); b.setAttribute('aria-pressed', String(adding)); b.textContent = adding ? '♥' : '♡';
      b.setAttribute('aria-label', `${adding ? 'Remove' : 'Add'} ${name} ${adding ? 'from' : 'to'} wishlist`);
    });
    notify(adding ? `${name} was saved to your wishlist.` : `${name} was removed from your wishlist.`, adding ? 'success' : 'info');
    if (route().name === 'wishlist') wishlistView();
  } catch (e) { notify(e.message, 'error', 'Wishlist not updated'); } finally { button.disabled = false; }
}
async function wishlistView() {
  if (!account) return signedOutView('Your wishlist', 'Sign in to save products you love and find them again later.');
  const version = viewVersion;
  try {
    const list = await api('/wishlist'); wishlist = list.map(i => i.productId); updateHeader();
    const [products, inventory] = await Promise.all([Promise.all(list.map(i => product(i.productId))), api('/inventory')]);
    if (version !== viewVersion) return; stock = inventory;
    main.innerHTML = `<div class="wrap page"><div class="page-head"><div><div class="eyebrow">Saved for later</div><h1>Your wishlist.</h1><p>${products.length} saved ${products.length === 1 ? 'product' : 'products'}. Prices and stock are live.</p></div></div>
      ${products.length ? `<div class="grid" id="wishlist-grid">${products.map(productCard).join('')}</div>` : '<div class="empty"><h2>Nothing saved yet.</h2><p>Tap the heart on any product to keep it here.</p><a class="btn" href="#home">Discover products →</a></div>'}</div>`;
    bindCards(main);
  } catch (e) { main.innerHTML = `<div class="wrap page"><div class="inline-error">${esc(e.message)}</div></div>`; }
}

// ---------- Authentication ----------
// Registration rules mirror the identity service: name 1–100, valid email, password 8–128. Confirmation is checked in the browser.
function validateAuthField(name, value, form) {
  const v = String(value ?? '');
  if (name === 'name') return v.trim() ? (v.trim().length > 100 ? 'Use at most 100 characters' : '') : 'Enter your name';
  if (name === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : 'Enter a valid email address, for example name@example.com';
  if (name === 'password') return !v ? 'Enter a password' : v.length < 8 ? 'Use at least 8 characters' : v.length > 128 ? 'Use at most 128 characters' : '';
  if (name === 'confirm') return v === form.elements.password.value ? '' : 'The passwords do not match';
  return '';
}
function authModal(mode) {
  if (mode) authRegister = mode === 'register';
  const r = authRegister;
  modal(r ? 'Create your account' : 'Welcome back', `<form id="auth-form" class="form" novalidate>${r ? `<p class="hint">Create an account to save your bag, wishlist and cards, and to follow your orders.</p><label>Your name<input name="name" maxlength="100" autocomplete="name" aria-describedby="error-name"></label><span class="field-error" id="error-name"></span>` : ''}
    <label>Email address<input name="email" type="email" autocomplete="email" value="${r ? '' : 'qa@example.com'}" aria-describedby="error-email"></label><span class="field-error" id="error-email"></span>
    <label>Password<input name="password" type="password" maxlength="128" autocomplete="${r ? 'new-password' : 'current-password'}" value="${r ? '' : 'Testing123!'}" aria-describedby="error-password${r ? ' password-hint' : ''}"></label>${r ? '<span class="hint" id="password-hint">At least 8 characters.</span>' : ''}<span class="field-error" id="error-password"></span>
    ${r ? '<label>Confirm password<input name="confirm" type="password" maxlength="128" autocomplete="new-password" aria-describedby="error-confirm"></label><span class="field-error" id="error-confirm"></span>' : ''}
    <div class="form-error" role="alert"></div><button class="btn" type="submit">${r ? 'Create account' : 'Sign in'} →</button><button id="auth-toggle" type="button" class="text-button">${r ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>
    ${r ? '' : '<div class="demo">Demo account: <strong>qa@example.com</strong><br>Password: <strong>Testing123!</strong><br>Use separate accounts to test order ownership.</div>'}</form>`);
  $('#auth-toggle').onclick = () => authModal(r ? 'login' : 'register');
  const form = $('#auth-form'), fields = r ? ['name', 'email', 'password', 'confirm'] : ['email', 'password'];
  for (const name of fields) form.elements[name].onblur = () => { if (form.elements[name].value) showFieldError(form, name, validateAuthField(name, form.elements[name].value, form)); };
  form.elements[fields[0]].focus();
  form.onsubmit = async event => {
    event.preventDefault(); const button = form.querySelector('[type=submit]'); form.querySelector('.form-error').textContent = '';
    const invalid = (r ? fields : []).filter(name => { const m = validateAuthField(name, form.elements[name].value, form); showFieldError(form, name, m); return m; });
    if (invalid.length) { form.elements[invalid[0]].focus(); return; }
    button.disabled = true;
    try {
      const registering = r, { confirm, ...values } = Object.fromEntries(new FormData(form));
      const data = await api(`/auth/${registering ? 'register' : 'login'}`, payload(values));
      token = data.token; account = data.user; sessionStorage.setItem('qa-token', token);
      [cart, wishlist] = await Promise.all([api('/cart'), api('/wishlist').then(l => l.map(i => i.productId))]);
      updateHeader(); dialog.close(); notify(registering ? `Your account was created. Welcome, ${account.name}!` : `Signed in as ${account.name}.`, 'success', registering ? 'Account created' : 'Welcome back'); render();
    } catch (e) {
      form.querySelector('.form-error').textContent = e.status === 409 ? 'An account with this email already exists. Sign in instead.' : e.message;
      if (e.status === 409) showFieldError(form, 'email', 'This email is already registered');
    } finally { button.disabled = false; }
  };
}
async function signOut() {
  closeMenus();
  try { await api('/auth/logout', payload({})); } catch { /* the token may already be gone */ }
  clearSession(); updateHeader(); render(); notify('You have been signed out.', 'info');
}
function signedOutView(title, text) {
  main.innerHTML = `<div class="wrap page"><div class="empty"><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="buttons center"><button id="view-signin" class="btn">Sign in</button><button id="view-register" class="btn secondary">Create account</button></div></div></div>`;
  $('#view-signin').onclick = () => authModal('login'); $('#view-register').onclick = () => authModal('register');
}

// ---------- Card helpers (mirror the backend rules; the backend decides) ----------
const digits = v => String(v).replace(/\D/g, '');
function detectBrand(n) {
  if (/^4/.test(n)) return 'visa';
  if (/^(5[1-5]|2(2[2-9][1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720))/.test(n)) return 'mastercard';
  if (/^3[47]/.test(n)) return 'amex';
  return null;
}
function luhn(n) { let sum = 0; for (let i = 0; i < n.length; i++) { let d = Number(n[n.length - 1 - i]); if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; } return n.length > 0 && sum % 10 === 0; }
function formatCardNumber(n) { const brand = detectBrand(n); return (brand === 'amex' ? [n.slice(0, 4), n.slice(4, 10), n.slice(10, 15)] : n.slice(0, 19).match(/.{1,4}/g) || []).filter(Boolean).join(' '); }
function validateField(name, value, form) {
  const v = String(value ?? '').trim();
  if (['name', 'line1', 'city', 'postalCode'].includes(name)) return v ? (v.length > 200 ? 'Use at most 200 characters' : '') : { name: 'Enter the recipient name', line1: 'Enter the street address', city: 'Enter the city', postalCode: 'Enter the postal code' }[name];
  if (name === 'holder') return v.length >= 2 && v.length <= 100 && /^[\p{L}][\p{L} .'-]*$/u.test(v) ? '' : 'Enter the cardholder name as it appears on the card';
  if (name === 'number') { const n = digits(v); if (!/^\d{13,19}$/.test(n) || !luhn(n)) return 'Enter a valid card number'; return detectBrand(n) && (detectBrand(n) === 'amex' ? n.length === 15 : n.length === 16) ? '' : 'We accept Visa, Mastercard and American Express'; }
  if (name === 'expiry') {
    const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(v); if (!m) return 'Enter the expiry date as MM/YY';
    const month = Number(m[1]), year = 2000 + Number(m[2]), now = new Date();
    if (month < 1 || month > 12) return 'Expiry month must be between 01 and 12';
    if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) return 'This card has expired';
    if (year > now.getFullYear() + 20) return 'Expiry date is too far in the future';
    return '';
  }
  if (name === 'cvc') { const amex = detectBrand(digits(form.elements.number.value)) === 'amex'; return (amex ? /^\d{4}$/ : /^\d{3}$/).test(v) ? '' : `Enter the ${amex ? 4 : 3}-digit security code`; }
  return '';
}
function showFieldError(form, name, message) {
  const input = form.elements[name], error = form.querySelector(`#error-${name}`); if (!input || !error) return;
  error.textContent = message || ''; if (input instanceof Element) input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

// ---------- Checkout page ----------
let checkoutState = null;
async function checkoutView() {
  if (!account) return signedOutView('Sign in to check out', 'Your bag is saved to your account. Sign in to continue to checkout.');
  const version = viewVersion;
  try {
    const [items, cards] = await Promise.all([cartDetails(), api('/cards')]);
    if (version !== viewVersion) return;
    if (!items.length) { main.innerHTML = '<div class="wrap page"><div class="empty"><h2>Your bag is empty.</h2><p>Add something you like, then come back to check out.</p><a class="btn" href="#home">Continue shopping →</a></div></div>'; return; }
    checkoutKey ||= crypto.randomUUID();
    const usable = cards.filter(c => !c.expired);
    checkoutState = { items, cards, payment: checkoutState?.payment && (checkoutState.payment === 'new' || checkoutState.payment === 'wallet' || usable.some(c => `saved:${c.id}` === checkoutState.payment)) ? checkoutState.payment : usable[0] ? `saved:${usable[0].id}` : 'new' };
    main.innerHTML = `<div class="wrap page checkout-page"><a class="back-link" href="#home">← Continue shopping</a><div class="eyebrow">Secure checkout</div><h1>Checkout</h1>
      <form id="checkout-form" class="checkout-grid" novalidate>
        <div class="checkout-main">
          <section class="panel" aria-labelledby="address-title"><h2 id="address-title"><span class="step">1</span> Delivery address</h2><div class="form">
            ${field('name', 'Recipient', 'Alex Tester', 'shipping name')}${field('line1', 'Street address', '12 Test Avenue', 'shipping address-line1')}
            <div class="form-row">${field('city', 'City', 'Sarajevo', 'shipping address-level2')}${field('postalCode', 'Postal code', '71000', 'shipping postal-code')}</div>
            <label>Country<select name="country" autocomplete="shipping country"><option value="BA">Bosnia and Herzegovina</option value="DE">Germany</option><option value="US">United States</option></select></label>
          </div></section>
          <section class="panel" aria-labelledby="payment-title"><h2 id="payment-title"><span class="step">2</span> Payment</h2><div id="payment-options"></div></section>
          <section class="panel" aria-labelledby="coupon-title"><h2 id="coupon-title"><span class="step">3</span> Discount code</h2><div class="form"><label>Discount code<input name="coupon" placeholder="Optional" autocomplete="off" aria-describedby="coupon-status"></label><p id="coupon-status" class="coupon-status" aria-live="polite"></p></div></section>
        </div>
        <aside class="panel checkout-summary" aria-labelledby="summary-title"><h2 id="summary-title">Order summary</h2>
          <div class="summary-items">${items.map(i => `<div class="summary-item"><div class="cart-icon ${esc(i.color)}" aria-hidden="true">${esc(i.icon)}</div><div><strong>${esc(i.name)}</strong><span>${i.quantity} × ${money(i.price)}${i.freeShipping ? ' · Free shipping' : ''}</span></div><span>${money(i.price * i.quantity)}</span></div>`).join('')}</div>
          <div id="checkout-total"></div><div class="form-error" id="checkout-error" role="alert"></div>
          <button type="submit" class="btn place-order">Place order →</button><p class="hint">Simulated checkout. No real money is charged. <a href="#help/test-cards">Which test cards work?</a></p></aside>
      </form></div>`;
    const form = $('#checkout-form');
    renderPaymentOptions(form);
    form.elements.coupon.oninput = () => { refreshCheckoutTotals(form); checkoutKey = crypto.randomUUID(); };
    for (const name of ['name', 'line1', 'city', 'postalCode']) form.elements[name].onblur = e => showFieldError(form, name, validateField(name, e.target.value, form));
    form.onsubmit = event => { event.preventDefault(); placeOrder(form); };
    refreshCheckoutTotals(form);
  } catch (e) { main.innerHTML = `<div class="wrap page"><div class="inline-error">${esc(e.message)}</div></div>`; }
}
function field(name, label, value, autocomplete, extra = '') {
  return `<label>${label}<input name="${name}" value="${esc(value)}" maxlength="200" autocomplete="${autocomplete}" aria-describedby="error-${name}" ${extra}></label><span class="field-error" id="error-${name}"></span>`;
}
function cardLabel(c) { return `${BRANDS[c.brand]} •••• ${c.last4}`; }
function renderPaymentOptions(form) {
  const { cards, payment } = checkoutState, box = form.querySelector('#payment-options');
  box.innerHTML = `<fieldset class="payment-list"><legend class="sr-only">Payment method</legend>
    ${cards.length ? `<p class="group-label">Saved cards</p>${cards.map(c => `<div class="payment-option ${c.expired ? 'expired' : ''}"><label><input type="radio" name="payment" value="saved:${c.id}" ${payment === `saved:${c.id}` ? 'checked' : ''} ${c.expired ? 'disabled' : ''}><span class="card-brand ${c.brand}">${esc(BRANDS[c.brand])}</span><span><strong>•••• ${esc(c.last4)}</strong> <small>${esc(c.holder)} · expires ${String(c.expMonth).padStart(2, '0')}/${String(c.expYear).slice(-2)}${c.expired ? ' · Expired' : ''}</small></span>${c.brand === 'mastercard' && !c.expired ? '<span class="perk">−10%</span>' : ''}</label><button type="button" class="text-button remove-card" data-remove-card="${c.id}" aria-label="Remove ${esc(cardLabel(c))}">Remove</button></div>`).join('')}` : ''}
    <p class="group-label">Other ways to pay</p>
    <div class="payment-option"><label><input type="radio" name="payment" value="new" ${payment === 'new' ? 'checked' : ''}><span class="card-brand">Card</span><span><strong>Add a new card</strong> <small>Visa, Mastercard or American Express</small></span></label></div>
    <div id="new-card" class="new-card form" ${payment === 'new' ? '' : 'hidden'}>
      ${field('holder', 'Cardholder name', '', 'cc-name')}
      <label>Card number<span class="input-with-brand"><input name="number" inputmode="numeric" autocomplete="cc-number" maxlength="23" placeholder="1234 5678 9012 3456" aria-describedby="error-number card-brand-hint"><span id="card-brand-hint" class="brand-hint" aria-live="polite"></span></span></label><span class="field-error" id="error-number"></span>
      <div class="form-row"><div class="stack">${field('expiry', 'Expiry date (MM/YY)', '', 'cc-exp', 'inputmode="numeric" maxlength="5" placeholder="MM/YY"')}</div><div class="stack">${field('cvc', 'Security code (CVC)', '', 'cc-csc', 'inputmode="numeric" maxlength="4" placeholder="123"')}</div></div>
      <label class="checkbox"><input type="checkbox" name="saveCard" checked> Save this card for next time</label>
    </div>
    <div class="payment-option"><label><input type="radio" name="payment" value="wallet" ${payment === 'wallet' ? 'checked' : ''}><span class="card-brand">Wallet</span><span><strong>Test wallet</strong> <small>Simulated digital wallet</small></span></label></div>
    <span class="field-error" id="error-payment"></span></fieldset>`;
  box.querySelectorAll('[name=payment]').forEach(r => r.onchange = () => { checkoutState.payment = r.value; checkoutKey = crypto.randomUUID(); box.querySelector('#new-card').hidden = r.value !== 'new'; showFieldError(form, 'payment', ''); refreshCheckoutTotals(form); });
  box.querySelectorAll('[data-remove-card]').forEach(b => b.onclick = async () => {
    b.disabled = true; const card = cards.find(c => c.id === b.dataset.removeCard);
    try {
      checkoutState.cards = await api(`/cards/${encodeURIComponent(card.id)}`, { method: 'DELETE' });
      if (checkoutState.payment === `saved:${card.id}`) { const next = checkoutState.cards.find(c => !c.expired); checkoutState.payment = next ? `saved:${next.id}` : 'new'; }
      notify(`${cardLabel(card)} was removed from your saved cards.`, 'info'); renderPaymentOptions(form); refreshCheckoutTotals(form);
    } catch (e) { notify(e.message, 'error', 'Card not removed'); b.disabled = false; }
  });
  const number = form.elements.number, expiry = form.elements.expiry, cvc = form.elements.cvc;
  number.oninput = () => { const n = digits(number.value); number.value = formatCardNumber(n); const brand = detectBrand(n); $('#card-brand-hint').textContent = brand ? BRANDS[brand] + (brand === 'mastercard' ? ' · 10% off' : '') : ''; refreshCheckoutTotals(form); };
  expiry.oninput = e => { let d = digits(expiry.value).slice(0, 4); if (d.length > 2 || (d.length === 2 && e.inputType !== 'deleteContentBackward')) d = `${d.slice(0, 2)}/${d.slice(2)}`; expiry.value = d; };
  cvc.oninput = () => { cvc.value = digits(cvc.value).slice(0, 4); };
  for (const name of ['holder', 'number', 'expiry', 'cvc']) form.elements[name].onblur = () => { if (form.elements[name].value) showFieldError(form, name, validateField(name, form.elements[name].value, form)); };
}
function selectedBrand(form) {
  const p = checkoutState.payment;
  if (p.startsWith('saved:')) return checkoutState.cards.find(c => `saved:${c.id}` === p)?.brand || '';
  if (p === 'new') return detectBrand(digits(form.elements.number?.value || '')) || '';
  return '';
}
function refreshCheckoutTotals(form) {
  const coupon = form.elements.coupon.value.trim().toUpperCase(), status = $('#coupon-status');
  status.className = 'coupon-status';
  if (!coupon) status.textContent = '';
  else if (coupon === 'SAVE10') { status.textContent = '✓ SAVE10 applied: 10% off your subtotal.'; status.classList.add('ok'); }
  else { status.textContent = coupon === 'EXPIRED' ? '✗ This code has expired. Remove it to place your order.' : '✗ We do not recognise this code. Remove it to place your order.'; status.classList.add('bad'); }
  $('#checkout-total').innerHTML = totalsHtml(total(checkoutState.items, coupon, selectedBrand(form)));
}
async function placeOrder(form) {
  const errorBox = $('#checkout-error'); errorBox.textContent = '';
  const values = Object.fromEntries(new FormData(form)), coupon = values.coupon.trim().toUpperCase(), p = checkoutState.payment;
  const fields = ['name', 'line1', 'city', 'postalCode', ...(p === 'new' ? ['holder', 'number', 'expiry', 'cvc'] : [])];
  const invalid = fields.filter(name => { const message = validateField(name, form.elements[name].value, form); showFieldError(form, name, message); return message; });
  if (invalid.length) { form.elements[invalid[0]].focus(); notify(`Please fix ${invalid.length === 1 ? 'the highlighted field' : `the ${invalid.length} highlighted fields`} before placing your order.`, 'error', 'Order not placed'); return; }
  const body = { address: { name: values.name.trim(), line1: values.line1.trim(), city: values.city.trim(), postalCode: values.postalCode.trim(), country: values.country }, paymentMethod: p === 'wallet' ? 'test-wallet' : 'card', coupon, expectedTotal: total(checkoutState.items, coupon, selectedBrand(form)).total };
  if (p.startsWith('saved:')) body.savedCardId = p.slice(6);
  if (p === 'new') { body.card = { holder: values.holder.trim(), number: digits(values.number), expiry: values.expiry.trim(), cvc: values.cvc.trim() }; body.saveCard = form.elements.saveCard.checked; }
  const button = form.querySelector('[type=submit]'); button.disabled = true; button.textContent = 'Placing order…';
  try {
    const order = await api('/orders', { ...payload(body), headers: { 'Idempotency-Key': checkoutKey } });
    cart = []; checkoutKey = null; checkoutState = null; updateHeader(); watchOrder(order.id);
    notify(`Order ${shortId(order.id)} was placed successfully. We are processing your payment now.`, 'success', 'Order placed');
    location.hash = `#order/${order.id}`;
  } catch (e) {
    const target = { holder: 'holder', number: 'number', expiry: 'expiry', cvc: 'cvc', savedCardId: 'payment', paymentMethod: 'payment', card: 'payment', saveCard: 'payment' }[e.field];
    if (target) showFieldError(form, target, e.message);
    errorBox.textContent = e.message + (e.message.includes('Price changed') ? ' Refresh the page to see the current prices.' : '');
    notify(e.message, 'error', 'Order was not placed');
  } finally { button.disabled = false; button.textContent = 'Place order →'; }
}

// ---------- Order watching: tells the customer how the payment ended, wherever they are ----------
const watched = new Set(JSON.parse(sessionStorage.getItem('qa-watch') || '[]'));
function watchOrder(id) { watched.add(id); sessionStorage.setItem('qa-watch', JSON.stringify([...watched])); }
function unwatch(id) { watched.delete(id); sessionStorage.setItem('qa-watch', JSON.stringify([...watched])); }
function announceOutcome(order) {
  const reason = REASONS[order.reason] || order.reason || '';
  if (order.status === 'confirmed') notify(`Payment of ${money(order.total)} was successful. Order ${shortId(order.id)} is confirmed.`, 'success', 'Payment successful');
  else if (order.status === 'cancelled') notify(`${reason}. Order ${shortId(order.id)} was cancelled and you were not charged.`, 'error', 'Payment failed');
  else if (order.status === 'rejected') notify(`${reason}. Order ${shortId(order.id)} could not be completed and you were not charged.`, 'error', 'Order not completed');
}
async function checkWatchedOrders() {
  if (!account) return;
  for (const id of [...watched]) {
    try { const order = await api(`/orders/${encodeURIComponent(id)}`); if (TERMINAL.includes(order.status)) { unwatch(id); announceOutcome(order); if (route().name === 'order' && route().sub === id) orderView(id, true); } }
    catch (e) { if (e.status === 404) unwatch(id); }
  }
}

// ---------- Order confirmation page ----------
function orderBanner(o) {
  const reason = REASONS[o.reason] || o.reason;
  if (o.status === 'confirmed') return `<div class="status-banner success" data-status="confirmed"><strong>Payment successful</strong><p>Thank you! Your payment of ${money(o.total)} went through and the order is confirmed.</p></div>`;
  if (o.status === 'cancelled') return `<div class="status-banner error" data-status="cancelled"><strong>Payment failed</strong><p>${esc(reason)}. The order was cancelled, the products went back into stock and you were not charged.</p></div>`;
  if (o.status === 'rejected') return `<div class="status-banner error" data-status="rejected"><strong>Order not completed</strong><p>${esc(reason)}. You were not charged.</p></div>`;
  if (o.status === 'compensating') return `<div class="status-banner warning" data-status="compensating"><span class="spinner" aria-hidden="true"></span><strong>Payment failed</strong><p>We are releasing the reserved products. This takes a moment.</p></div>`;
  return `<div class="status-banner info" data-status="${o.status}"><span class="spinner" aria-hidden="true"></span><strong>${o.status === 'pending' ? 'Order received' : 'Processing your payment'}</strong><p>${o.status === 'pending' ? 'We are reserving your products.' : 'Your products are reserved. We are confirming the payment.'} This page updates by itself.</p></div>`;
}
function paymentText(o) { return o.payment?.brand ? `${BRANDS[o.payment.brand]} •••• ${o.payment.last4}` : o.paymentMethod === 'test-wallet' ? 'Test wallet' : o.paymentMethod; }
async function orderView(id, silent = false) {
  if (!account) return signedOutView('Sign in to see this order', 'Orders are visible only to the customer who placed them.');
  const version = viewVersion;
  try {
    const o = await api(`/orders/${encodeURIComponent(id)}`); if (version !== viewVersion || route().name !== 'order') return;
    main.innerHTML = `<div class="wrap page order-page" data-order-id="${o.id}"><a class="back-link" href="#orders">← All orders</a><div class="eyebrow">Order ${shortId(o.id)}</div><h1>${o.status === 'confirmed' ? 'Thank you for your order.' : TERMINAL.includes(o.status) ? 'About your order.' : 'Almost there.'}</h1>
      <div id="order-banner" aria-live="polite">${orderBanner(o)}</div>
      <div class="order-layout"><section class="panel"><h2>Progress</h2><ol class="timeline">${o.history.map(h => `<li data-status="${h.status}"><strong>${esc(STATUS_LABELS[h.status] || h.status)}</strong><time>${new Date(h.at).toLocaleTimeString()}</time></li>`).join('')}</ol>
        <h2>Products</h2><div class="order-items">${o.items.map(i => `${i.quantity} × ${esc(i.name)} · ${money(i.unitPrice * i.quantity)}`).join('<br>')}</div></section>
        <aside class="panel"><h2>Summary</h2>${totalsHtml({ subtotal: o.subtotal, couponDiscount: o.couponDiscount || 0, paymentDiscount: o.paymentDiscount || 0, discount: o.discount, shipping: o.shipping, total: o.total })}
          <dl class="order-facts"><dt>Payment</dt><dd>${esc(paymentText(o))}</dd><dt>Deliver to</dt><dd>${esc(o.address.name)}<br>${esc(o.address.line1)}<br>${esc(o.address.postalCode)} ${esc(o.address.city)}, ${esc(o.address.country)}</dd><dt>Placed</dt><dd>${new Date(o.createdAt).toLocaleString()}</dd></dl>
          ${['cancelled', 'rejected'].includes(o.status) ? '<button id="retry-order" class="btn">Put these products back in my bag</button>' : ''}</aside></div></div>`;
    if (!TERMINAL.includes(o.status)) watchOrder(o.id);
    if ($('#retry-order')) $('#retry-order').onclick = async () => {
      try { await saveCart(o.items.map(i => ({ productId: i.productId, quantity: i.quantity }))); notify('The products are back in your bag. Try another payment method.', 'success', 'Bag restored'); location.hash = '#checkout'; }
      catch (e) { notify(e.message, 'error', 'Bag not restored'); }
    };
  } catch (e) { if (!silent) main.innerHTML = `<div class="wrap page"><div class="inline-error">${esc(e.message)}</div><p><a class="btn" href="#orders">Back to my orders</a></p></div>`; }
}

// ---------- Navigation: categories mega menu and promotions ----------
let activeTop = '';
async function loadCategories() {
  try {
    categories = await api('/products/categories');
    activeTop = categories[0]?.name || '';
    const menu = $('#categories-menu');
    menu.innerHTML = `<ul class="mega-top">${categories.map(c => `<li><a href="${categoryHash(c.name)}" data-top="${esc(c.name)}" data-menu-link>${esc(c.name)} <span>${c.productCount} ›</span></a></li>`).join('')}<li><a href="#categories" class="mega-all" data-menu-link>All categories →</a></li></ul><div class="mega-panel" id="mega-panel"></div>`;
    drawMegaPanel();
    menu.querySelectorAll('[data-top]').forEach(a => { a.onmouseenter = () => { activeTop = a.dataset.top; drawMegaPanel(); }; a.onfocus = () => { activeTop = a.dataset.top; drawMegaPanel(); }; });
    menu.onkeydown = e => {
      const tops = [...menu.querySelectorAll('.mega-top a')], i = tops.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && i >= 0) { e.preventDefault(); tops[(i + 1) % tops.length].focus(); }
      if (e.key === 'ArrowUp' && i >= 0) { e.preventDefault(); tops[(i - 1 + tops.length) % tops.length].focus(); }
      if (e.key === 'ArrowRight' && i >= 0) { e.preventDefault(); menu.querySelector('#mega-panel a')?.focus(); }
      if (e.key === 'ArrowLeft' && e.target.closest('#mega-panel')) { e.preventDefault(); menu.querySelector(`[data-top="${CSS.escape(activeTop)}"]`)?.focus(); }
    };
    $('#popular-categories').innerHTML = categories.flatMap(c => c.subcategories.filter(s => s.popular).map(s => `<a class="nav-link" href="${categoryHash(c.name, s.name)}" data-nav-link="${esc(s.name)}">${esc(s.name)}</a>`)).join('');
    highlightNav();
    if (route().name === 'categories') categoriesView();
  } catch (e) { $('#categories-menu').innerHTML = `<p class="inline-error">${esc(e.message)}</p>`; }
}
function drawMegaPanel() {
  const c = categories.find(x => x.name === activeTop); if (!c) return;
  document.querySelectorAll('[data-top]').forEach(a => a.classList.toggle('active', a.dataset.top === activeTop));
  $('#mega-panel').innerHTML = `<a class="mega-title" href="${categoryHash(c.name)}" data-menu-link>Shop all ${esc(c.name)} →</a><ul>${c.subcategories.map(s => `<li><a href="${categoryHash(c.name, s.name)}" data-menu-link>${esc(s.name)} <span>${s.productCount}</span></a></li>`).join('')}</ul>`;
}
async function categoriesView() {
  if (!categories.length) { main.innerHTML = '<div class="wrap page"><div class="empty">Loading categories…</div></div>'; return; }
  const version = viewVersion;
  main.innerHTML = `<div class="wrap page"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="#home">Home</a> › <span aria-current="page">All categories</span></nav><div class="eyebrow">Browse</div><h1>All categories</h1>
    <div class="category-grid">${categories.map(c => `<section class="category-card" aria-labelledby="cat-${slug(c.name)}"><div class="category-icon" data-icon-for="${esc(c.name)}" aria-hidden="true"></div><h2 id="cat-${slug(c.name)}"><a href="${categoryHash(c.name)}">${esc(c.name)}</a></h2><p class="count">${c.productCount} products</p><ul>${c.subcategories.map(s => `<li><a href="${categoryHash(c.name, s.name)}">${esc(s.name)}</a> <span>${s.productCount}</span></li>`).join('')}</ul><a class="see-all" href="${categoryHash(c.name)}">Shop all ${esc(c.name)} →</a></section>`).join('')}</div></div>`;
  // Use the most popular product of each category as its icon.
  try {
    const data = await fetchProducts({ sort: 'popular', limit: 50 }); if (version !== viewVersion) return;
    for (const c of categories) { const p = data.items.find(x => x.category === c.name); const el = main.querySelector(`[data-icon-for="${CSS.escape(c.name)}"]`); if (p && el) { el.textContent = p.icon; el.className = `category-icon ${p.color}`; } }
  } catch { /* icons are decoration */ }
}
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const PROMOTIONS = [
  'Pay with a Mastercard and save 10% on every order, even on top of SAVE10.',
  '<a href="#shop?deal=black-friday">Black Friday: up to 40% off selected products →</a>',
  'Free shipping from $150, or when every item in your bag ships free.',
  'Use code <strong>SAVE10</strong> at checkout for 10% off.'
];
let promoIndex = 0, promoPaused = false, promoHover = false;
function showPromo(i) { promoIndex = (i + PROMOTIONS.length) % PROMOTIONS.length; $('#promo-message').innerHTML = `<span class="promo-count">${promoIndex + 1}/${PROMOTIONS.length}</span> ${PROMOTIONS[promoIndex]}`; }
function setupPromotions() {
  showPromo(0);
  $('#promo-prev').onclick = () => showPromo(promoIndex - 1);
  $('#promo-next').onclick = () => showPromo(promoIndex + 1);
  $('#promo-pause').onclick = e => { promoPaused = !promoPaused; e.currentTarget.setAttribute('aria-pressed', String(promoPaused)); e.currentTarget.textContent = promoPaused ? 'Play' : 'Pause'; };
  const bar = $('.promo-bar');
  bar.addEventListener('mouseenter', () => promoHover = true); bar.addEventListener('mouseleave', () => promoHover = false);
  bar.addEventListener('focusin', () => promoHover = true); bar.addEventListener('focusout', () => promoHover = false);
  setInterval(() => { if (!promoPaused && !promoHover && !document.hidden) showPromo(promoIndex + 1); }, 5000);
}

// ---------- Routing ----------
function route() {
  const [path, query = ''] = location.hash.slice(1).split('?');
  const [name, ...rest] = (path || 'home').split('/');
  return { name, sub: rest.join('/'), params: Object.fromEntries(new URLSearchParams(query)) };
}
function shopHash(params) { const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString(); return `#shop${q ? `?${q}` : ''}`; }
function highlightNav() {
  const r = route(), key = r.name === 'shop' ? (r.params.deal === 'black-friday' ? 'black-friday' : r.params.freeShipping === 'true' ? 'free-shipping' : r.params.subcategory) : null;
  document.querySelectorAll('[data-nav-link]').forEach(a => a.classList.toggle('active', a.dataset.navLink === key));
  if (document.activeElement !== $('#search')) $('#search').value = r.name === 'shop' ? r.params.q || '' : '';
}
function render() {
  viewVersion++; closeMenus(); highlightNav();
  const r = route();
  if (r.name === 'shop') shopView(r.params);
  else if (r.name === 'categories') categoriesView();
  else if (r.name === 'wishlist') wishlistView();
  else if (r.name === 'checkout') checkoutView();
  else if (r.name === 'orders') ordersView();
  else if (r.name === 'order') orderView(r.sub);
  else if (r.name === 'help') helpView(r.sub);
  else if (r.name === 'lab') labView();
  else homeView();
}

// ---------- Home: carousels ----------
const SHELVES = [
  { id: 'black-friday', title: 'Black Friday deals', subtitle: 'Up to 40% off, while stock lasts', params: { deal: 'black-friday', sort: 'popular' } },
  { id: 'popular', title: 'Most popular', subtitle: 'What everyone is adding to their bag', params: { sort: 'popular' } },
  { id: 'free-shipping', title: 'Free shipping picks', subtitle: 'Fill a bag with these and shipping is on us', params: { freeShipping: 'true', sort: 'popular' } },
  { id: 'workspace', title: 'Better desk days', subtitle: 'Workspace essentials', params: { category: 'Office & School', subcategory: 'Workspace' } }
];
const carousels = new Map();
function visibleCount() { const w = window.innerWidth; return w >= 1100 ? 4 : w >= 800 ? 3 : w >= 520 ? 2 : 1; }
function homeView() {
  main.innerHTML = `<div class="wrap home">${SHELVES.map(s => `<section class="shelf" aria-labelledby="shelf-${s.id}-title" data-shelf="${s.id}">
    <div class="shelf-head"><div><h2 id="shelf-${s.id}-title">${esc(s.title)}</h2><p>${esc(s.subtitle)}</p></div><a class="see-all" href="${shopHash(s.params)}">See all →</a></div>
    <div class="carousel"><button class="carousel-arrow prev" data-carousel-prev="${s.id}" aria-label="Show previous products in ${esc(s.title)}" disabled>‹</button>
      <div class="carousel-track grid" id="carousel-${s.id}" aria-live="polite">${'<div class="skeleton" aria-label="Loading product"></div>'.repeat(visibleCount())}</div>
      <button class="carousel-arrow next" data-carousel-next="${s.id}" aria-label="Show next products in ${esc(s.title)}" disabled>›</button></div></section>`).join('')}</div>`;
  const version = viewVersion;
  for (const shelf of SHELVES) {
    fetchProducts({ ...shelf.params, limit: 12 }).then(data => {
      if (version !== viewVersion) return;
      carousels.set(shelf.id, { items: data.items, start: 0 }); drawCarousel(shelf.id);
    }).catch(e => { const t = $(`#carousel-${shelf.id}`); if (t) t.innerHTML = `<div class="inline-error">${esc(e.message)}</div>`; });
  }
  main.querySelectorAll('[data-carousel-prev]').forEach(b => b.onclick = () => moveCarousel(b.dataset.carouselPrev, -1));
  main.querySelectorAll('[data-carousel-next]').forEach(b => b.onclick = () => moveCarousel(b.dataset.carouselNext, 1));
}
function drawCarousel(id) {
  const state = carousels.get(id), track = $(`#carousel-${id}`); if (!state || !track) return;
  const n = visibleCount(); state.start = Math.max(0, Math.min(state.start, Math.max(0, state.items.length - n)));
  track.style.setProperty('--columns', n);
  track.innerHTML = state.items.length ? state.items.slice(state.start, state.start + n).map(productCard).join('') : '<div class="empty">Nothing here right now.</div>';
  track.dataset.position = `${state.start + 1}-${Math.min(state.start + n, state.items.length)} of ${state.items.length}`;
  $(`[data-carousel-prev="${id}"]`).disabled = state.start === 0;
  $(`[data-carousel-next="${id}"]`).disabled = state.start + n >= state.items.length;
  bindCards(track);
}
function moveCarousel(id, direction) { const state = carousels.get(id); if (!state) return; state.start += direction * visibleCount(); drawCarousel(id); }
let lastVisible = visibleCount();
window.addEventListener('resize', () => { const n = visibleCount(); if (n === lastVisible) return; lastVisible = n; if (route().name === 'home') for (const id of carousels.keys()) drawCarousel(id); });

// ---------- Shop: filtered list with pagination ----------
function shopTitle(p) {
  if (p.q) return `Results for “${p.q}”`;
  if (p.deal === 'black-friday') return 'Black Friday deals';
  if (p.freeShipping === 'true') return 'Free shipping';
  return p.subcategory || p.category || 'All products';
}
let productRequest = 0;
async function shopView(params) {
  const page = Math.max(1, Number.parseInt(params.page, 10) || 1);
  const cat = categories.find(c => c.name === params.category);
  const chips = [['category', params.category], ['subcategory', params.subcategory], ['q', params.q && `“${params.q}”`], ['deal', params.deal && 'Black Friday'], ['freeShipping', params.freeShipping === 'true' && 'Free shipping']].filter(([, label]) => label);
  const crumbs = [`<a href="#home">Home</a>`, `<a href="#categories">All categories</a>`, ...(params.category ? [params.subcategory ? `<a href="${categoryHash(params.category)}">${esc(params.category)}</a>` : `<span aria-current="page">${esc(params.category)}</span>`] : []), ...(params.subcategory ? [`<span aria-current="page">${esc(params.subcategory)}</span>`] : [])];
  main.innerHTML = `<div class="wrap page shop"><nav class="breadcrumb" aria-label="Breadcrumb">${crumbs.join(' › ')}</nav><div class="shop-head"><div><div class="eyebrow">The collection</div><h1>${esc(shopTitle(params))}</h1></div>
    <div class="shop-tools"><span class="count" id="result-count"></span><label class="sr-only" for="sort">Sort products</label><select id="sort">${SORTS.map(([v, l]) => `<option value="${v}" ${(params.sort || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    ${cat ? `<nav class="subcategory-chips" aria-label="${esc(cat.name)} subcategories"><a class="chip ${params.subcategory ? '' : 'active'}" href="${shopHash({ ...params, subcategory: '', page: '' })}">All ${esc(cat.name)}</a>${cat.subcategories.map(s => `<a class="chip ${params.subcategory === s.name ? 'active' : ''}" href="${shopHash({ ...params, subcategory: s.name, page: '' })}" ${params.subcategory === s.name ? 'aria-current="page"' : ''}>${esc(s.name)} <span>${s.productCount}</span></a>`).join('')}</nav>` : ''}
    ${chips.length ? `<div class="active-filters" aria-label="Active filters">${chips.map(([key, label]) => `<a class="chip outline" href="${shopHash({ ...params, [key]: '', ...(key === 'category' ? { subcategory: '' } : {}), page: '' })}" aria-label="Remove filter ${esc(label)}">${esc(label)} ×</a>`).join('')}<a class="text-button" href="#shop">Clear all</a></div>` : ''}
    <div id="products" class="grid" aria-live="polite"></div><div id="pagination"></div></div>`;
  $('#sort').onchange = e => { location.hash = shopHash({ ...params, sort: e.target.value, page: '' }); };
  const target = $('#products'), request = ++productRequest;
  target.innerHTML = '<div class="skeleton" aria-label="Loading product"></div>'.repeat(4); target.setAttribute('aria-busy', 'true');
  try {
    const data = await fetchProducts({ q: params.q, category: params.category, subcategory: params.subcategory, deal: params.deal, freeShipping: params.freeShipping, sort: params.sort, page, limit: PAGE_SIZE });
    if (request !== productRequest || !target.isConnected) return;
    target.innerHTML = data.items.length ? data.items.map(productCard).join('') : '<div class="empty">No products found. Try another search or category.</div>';
    $('#result-count').textContent = `${data.total} ${data.total === 1 ? 'product' : 'products'}`;
    const pages = Math.ceil(data.total / PAGE_SIZE);
    $('#pagination').innerHTML = pages > 1 ? `<nav class="page-controls" aria-label="Pagination"><a id="prev" class="chip ${page === 1 ? 'disabled' : ''}" ${page === 1 ? 'aria-disabled="true"' : `href="${shopHash({ ...params, page: page - 1 })}"`}>Previous</a><span id="page-indicator">Page ${page} of ${pages}</span><a id="next" class="chip ${page >= pages ? 'disabled' : ''}" ${page >= pages ? 'aria-disabled="true"' : `href="${shopHash({ ...params, page: page + 1 })}"`}>Next</a></nav>` : '';
    bindCards(target);
  } catch (e) {
    if (request === productRequest && target.isConnected) { target.innerHTML = `<div class="inline-error">${esc(e.message)} <button class="text-button" id="retry">Try again</button></div>`; $('#retry').onclick = render; }
  } finally { target.removeAttribute('aria-busy'); }
}

// ---------- Orders ----------
async function ordersView(silent = false) {
  if (!account) return signedOutView('Your next good thing starts here.', 'Sign in to see your orders.');
  const version = viewVersion;
  try {
    const orders = await api('/orders'); if (route().name !== 'orders' || version !== viewVersion) return;
    main.innerHTML = `<div class="wrap page"><div class="page-head"><div><div class="eyebrow">From bag to doorstep</div><h1>Your orders.</h1><p>Follow every step of the asynchronous checkout.</p></div><button id="refresh-orders" class="btn secondary">Refresh</button></div>${orders.length ? orders.map(o => `<article class="panel order" data-order-id="${o.id}"><div class="order-head"><div><h3><a href="#order/${o.id}">Order ${shortId(o.id)}</a></h3><p class="hint">${new Date(o.createdAt).toLocaleString()} · ${money(o.total)} · ${esc(paymentText(o))}${o.discount ? ` · saved ${money(o.discount)}` : ''}</p></div><span class="badge ${o.status}" data-testid="order-status">${o.status.replaceAll('_', ' ')}</span></div><div class="order-items">${o.items.map(i => `${i.quantity} × ${esc(i.name)} · ${money(i.unitPrice * i.quantity)}`).join('<br>')}</div>${o.reason ? `<p class="inline-error">${esc(REASONS[o.reason] || o.reason)}</p>` : ''}<div class="history">${o.history.map(h => `<span>● ${esc(h.status.replaceAll('_', ' '))} <time>${new Date(h.at).toLocaleTimeString()}</time></span>`).join('<span>→</span>')}</div></article>`).join('') : '<div class="empty"><h2>A fresh start.</h2><p>No orders yet. Discover something in the collection.</p><a class="btn" href="#home">Explore the collection →</a></div>'}</div>`;
    $('#refresh-orders').onclick = () => ordersView();
  } catch (e) { if (!silent) main.innerHTML = `<div class="wrap page"><div class="inline-error">${esc(e.message)}</div></div>`; }
}

// ---------- Help pages ----------
const figure = (file, caption, width, height) => `<figure><img src="/help/${file}" alt="${esc(caption)}" loading="lazy" width="${width}" height="${height}"><figcaption>${esc(caption)}</figcaption></figure>`;
const TEST_CARDS = [['Visa', '4242 4242 4242 4242'], ['Visa', '4111 1111 1111 1111'], ['Visa', '4012 8888 8888 1881'], ['Visa', '4000 0566 5566 5556'], ['Mastercard', '5555 5555 5555 4444'], ['Mastercard', '5105 1051 0510 5100'], ['Mastercard', '2223 0031 2200 3222'], ['Mastercard', '5200 8282 8282 8210'], ['American Express', '3782 822463 10005'], ['American Express', '3714 496353 98431']];
const HELP = {
  notices: { title: 'Platform notices', intro: 'Updates about the store, planned maintenance and active promotions.', body: `
    <article class="notice"><time>November 2026</time><h2>New checkout with saved cards</h2><p>Checkout now has its own page. Save a card once and pay with it next time in one click. You can save up to 5 cards and remove them at any time.</p></article>
    <article class="notice"><time>November 2026</time><h2>Black Friday is live</h2><p>Selected products are reduced by up to 40%. The reduced price is the price you pay, and the original price is shown struck through. Deals end when stock runs out.</p></article>
    <article class="notice"><time>November 2026</time><h2>New: wishlist and categories</h2><p>Tap the heart on any product to save it. Browse every department from <a href="#categories">All categories</a>.</p></article>
    <article class="notice"><time>November 2026</time><h2>Mastercard saves you 10%</h2><p>Pay with any Mastercard, saved or new, and 10% comes off your order. It combines with the SAVE10 code and with Black Friday prices.</p></article>
    <article class="notice"><time>Ongoing</time><h2>This is a practice store</h2><p>All products, addresses and payments are fictional. No real money is charged and nothing is shipped.</p></article>` },
  'delivery-and-payment': { title: 'Delivery and payment methods', intro: 'How much shipping costs, when it is free, and how you can pay.', body: `
    <h2>Shipping costs</h2><table class="help-table"><thead><tr><th>Your bag</th><th>Shipping</th></tr></thead><tbody>
      <tr><td>Total after discounts is $150.00 or more</td><td>Free</td></tr>
      <tr><td>Every product in the bag is marked “Free shipping”</td><td>Free</td></tr>
      <tr><td>Anything else</td><td>$7.00 flat</td></tr></tbody></table>
    <p>The $150 limit is checked <strong>after</strong> all discounts. A bag that drops below $150 because of a coupon or the Mastercard discount pays shipping again. One product without free shipping is enough to make the whole bag pay the $7 fee, unless the bag reaches $150.</p>
    <h2>Payment methods</h2><ul><li><strong>Saved card</strong>: choose one of your saved cards. Expired cards are shown but cannot be selected.</li><li><strong>New card</strong>: Visa, Mastercard or American Express. Tick “Save this card for next time” to keep it in your account.</li><li><strong>Test wallet</strong>: simulated digital wallet.</li></ul>
    <p>Paying with a <strong>Mastercard</strong> takes 10% off your order. We never store your full card number or security code; a saved card keeps only the brand, the last four digits, the expiry date and the name.</p>
    <h2>When is my order paid?</h2><p>Placing an order only means we accepted it. Stock is reserved and the payment is processed in the background, and you get a message when it succeeds or fails. An order is paid when it shows <strong>confirmed</strong>. If the payment fails, the order is cancelled automatically, nothing is charged and the products go back into stock.</p>` },
  'test-cards': { title: 'Test cards', intro: 'This is a practice store. Use these card numbers to see a successful payment.', body: `
    <table class="help-table"><thead><tr><th>Brand</th><th>Number</th><th>Result</th></tr></thead><tbody>${TEST_CARDS.map(([b, n]) => `<tr><td>${b}</td><td><code>${n}</code></td><td>Payment approved</td></tr>`).join('')}</tbody></table>
    <p>Use any cardholder name, any future expiry date and any security code (3 digits, or 4 for American Express).</p>
    <h2>Everything else is declined</h2><p>Any other number that passes the checks is accepted at checkout but <strong>declined by the bank</strong>. The order is cancelled and you are not charged. Try <code>4000 0000 0000 0002</code> to see it.</p>
    <h2>What the form checks</h2><ul><li>The card number must be a valid Visa (16 digits, starts with 4), Mastercard (16 digits, starts with 51–55 or 2221–2720) or American Express (15 digits, starts with 34 or 37) number.</li><li>The expiry date uses MM/YY, the month is 01–12, and the card must not be expired.</li><li>The security code has 3 digits, or 4 for American Express.</li><li>The cardholder name has 2–100 letters, spaces, apostrophes, dots or hyphens.</li></ul>` },
  returns: { title: 'Complaints and returns', intro: 'What to do if something is wrong with your order.', body: `
    <h2>Return a product</h2><ol class="steps"><li>Open <a href="#orders">My orders</a> and find the confirmed order.</li><li>Note the 8-character order number, for example <code>3d2611e7</code>.</li><li>Contact support with the order number and the product you want to return.</li><li>We confirm the return and refund the full amount you paid, including your discounts as applied.</li></ol>
    <h2>Rules</h2><ul><li>You can return any product within 14 days of confirmation.</li><li>Only <strong>confirmed</strong> orders can be returned. Cancelled and rejected orders were never charged.</li><li>Shipping is refunded only if the whole order is returned.</li></ul>
    <p class="callout">Returns are handled by support. There is no self-service return button in the store yet.</p>` },
  faq: { title: 'Frequently asked questions', intro: 'Quick answers to the questions we hear most.', body: [
    ['Do I need an account to shop?', 'You can browse and search without an account. To add products to your bag or wishlist, check out or see your orders, you need to sign in.'],
    ['Why does my order say “processing payment”?', 'Orders are processed in the background. We reserve your products first, then confirm the payment, usually within a few seconds. You get a message when it is done.'],
    ['My payment failed. Was I charged?', 'No. When a payment fails the order is cancelled automatically, nothing is charged and the products go back into stock. Open the order and choose “Put these products back in my bag” to try another card.'],
    ['Can I combine SAVE10, Mastercard and Black Friday?', 'Yes. Black Friday is already in the product price. SAVE10 takes 10% off the subtotal, then a Mastercard takes 10% off what remains.'],
    ['Why am I paying shipping when a product says “Free shipping”?', 'Shipping is free only when every product in your bag has free shipping, or when your total after discounts is $150 or more.'],
    ['Do you store my card?', 'Only if you tick “Save this card for next time”, and even then only the brand, last four digits, expiry date and name. Never the full number or the security code.'],
    ['Does adding a product to my bag reserve it?', 'No. Stock is reserved when you place the order. If someone else buys the last unit first, your order is not completed and you are not charged.'],
    ['Why was my checkout rejected with “Price changed”?', 'Prices are checked again when you place the order. If a price changed after you opened the page, refresh the page and review your bag.']
  ].map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('') },
  'how-to-shop': { title: 'How to shop online', intro: 'From finding a product to tracking your order, in five steps.', body: `
    <ol class="steps big">
      <li><h2>Find a product</h2><p>Search from the bar at the top, open <strong>All categories</strong>, or use the Black Friday and Free shipping links. On the home page, use the arrows to browse each row.</p>${figure('step-1-find.png', 'The home page with the categories menu open', 1200, 760)}</li>
      <li><h2>Sign in or create an account</h2><p>Click <strong>Sign in</strong> at the top right. New customers choose <strong>Create an account</strong> and enter a name, email and a password of at least 8 characters.</p>${figure('step-2-sign-in.png', 'The sign-in dialog', 550, 492)}</li>
      <li><h2>Add to bag or save for later</h2><p>Click <strong>Add to bag +</strong> on a product. Click the heart to save it to your wishlist instead. Open the bag to change quantities.</p>${figure('step-3-bag.png', 'The shopping bag with totals', 550, 576)}</li>
      <li><h2>Check out</h2><p>Choose <strong>Continue to checkout</strong>. Enter the delivery address, pick a saved card or add a new one, and add a discount code if you have one. The total updates before you pay.</p>${figure('step-4-checkout.png', 'The checkout page with saved cards and the order summary', 1200, 900)}</li>
      <li><h2>Follow your order</h2><p>After you place the order you see its page. It shows each step and tells you when the payment succeeded or failed.</p>${figure('step-5-order.png', 'The order page after a successful payment', 1200, 760)}</li>
    </ol>` }
};
function helpView(slugName) {
  const page = HELP[slugName] ? slugName : 'faq', help = HELP[page];
  main.innerHTML = `<div class="wrap page help"><nav class="help-nav" aria-label="Help pages"><h2>Shopping help</h2>${Object.entries(HELP).map(([key, h]) => `<a href="#help/${key}" ${key === page ? 'aria-current="page" class="active"' : ''}>${esc(h.title)}</a>`).join('')}</nav>
    <article class="help-content"><div class="eyebrow">Shopping help</div><h1>${esc(help.title)}</h1><p class="lead">${esc(help.intro)}</p>${help.body}</article></div>`;
}

// ---------- QA laboratory (hidden in the footer) ----------
const controlDefinitions = [
  ['locatorMode', 'Locator mode', 'Dynamic mode changes IDs and removes test IDs.', 'select', ['stable', 'dynamic']],
  ['renderDelay', 'Rendering delay', 'Delay product rendering by 0–5000 ms.', 'number'],
  ['apiDelay', 'API latency', 'Delay business API requests by 0–5000 ms.', 'number'],
  ['paymentMode', 'Payment outcome', 'Decline or timeout fails every payment, even with an approved test card.', 'select', ['approve', 'decline', 'timeout']],
  ['paymentDelay', 'Payment delay', 'Wait 0–5000 ms before handling payment.', 'number'],
  ['sessionSeconds', 'New session lifetime', '1–86400 seconds. Sign in again after changing.', 'number'],
  ['pauseInventory', 'Pause inventory consumer', 'Orders remain pending until resumed.', 'checkbox'],
  ['pausePayments', 'Pause payment consumer', 'Reservations remain held until resumed.', 'checkbox'],
  ['duplicateEvents', 'Duplicate deliveries', 'Exercise inbox deduplication.', 'checkbox'],
  ['stalePrice', 'Stale storefront prices', 'Show prices $1 below authoritative catalog prices.', 'checkbox'],
  ['rateLimit', 'Enable rate limit', '12 business requests / 10 seconds per token/IP.', 'checkbox']
];
async function labView() {
  const version = viewVersion;
  try {
    config = await api('/lab/config'); if (route().name !== 'lab' || version !== viewVersion) return;
    main.innerHTML = `<div class="wrap page"><div class="page-head"><div><div class="eyebrow">The engine room</div><h1>Curiosity, in control.</h1><p>Set the conditions. Observe the system. Find the edge cases.</p></div><span class="transport" id="transport">Connecting…</span></div><div class="lab-grid"><section class="panel"><h3>Scenario controls</h3><div class="scenario-list"><button class="chip" data-preset="baseline">Baseline</button><button class="chip" data-preset="locators">Locator challenge</button><button class="chip" data-preset="failure">Payment failure</button><button class="chip" data-preset="async">Slow checkout</button></div><form id="lab-form">${controlDefinitions.map(([key, label, hint, type, options]) => `<label class="control"><span>${label}<small>${hint}</small></span>${type === 'select' ? `<select name="${key}">${options.map(v => `<option ${config[key] === v ? 'selected' : ''}>${v}</option>`).join('')}</select>` : type === 'checkbox' ? `<input name="${key}" type="checkbox" ${config[key] ? 'checked' : ''}>` : `<input name="${key}" type="number" min="${key === 'sessionSeconds' ? 1 : 0}" max="${key === 'sessionSeconds' ? 86400 : 5000}" value="${config[key]}">`}</label>`).join('')}<div class="buttons"><button class="btn" type="submit">Apply scenario</button><button class="btn secondary" id="defaults" type="button">Restore baseline</button></div><p class="hint">Controls are global across all accounts. They persist between restarts. Restoring baseline keeps orders and stock.</p></form></section><div><section class="panel"><h3>Service health & event stream</h3><div id="services" class="service-list"></div><div id="events" class="events"><div class="empty">Waiting for the first event…</div></div><p class="hint">Latest 100 mirrored events · refreshes every 2 seconds. In Kafka mode this is an application audit view; use Kafka tooling for offsets and lag.</p></section><section class="panel challenge"><h3>Try this: one item, two customers</h3><ol><li>Open two separate browser sessions and sign in with different accounts.</li><li>Add the Pocket Mini Speaker to each bag. Only one is in stock.</li><li>Place both orders. Exactly one should be confirmed.</li><li>Verify the loser is rejected and stock never becomes negative.</li></ol><p>Read <strong>docs/CHALLENGES.md</strong> for the full exercise catalogue, API examples, and expected results.</p></section></div></div></div>`;
    $('#lab-form').onsubmit = async e => { e.preventDefault(); const values = {}; for (const [key, , , type] of controlDefinitions) { const f = e.currentTarget.elements[key]; values[key] = type === 'checkbox' ? f.checked : type === 'number' ? Number(f.value) : f.value; } try { config = await api('/lab/config', payload(values)); notify('The scenario settings were applied.', 'success', 'Scenario applied'); } catch (err) { notify(err.message, 'error', 'Scenario not applied'); } };
    $('#defaults').onclick = async () => { try { await api('/lab/defaults', payload({})); await labView(); notify('All scenario settings are back to baseline.', 'success', 'Baseline restored'); } catch (e) { notify(e.message, 'error'); } };
    main.querySelectorAll('[data-preset]').forEach(b => b.onclick = async () => { try { await api('/lab/defaults', payload({})); const values = { baseline: {}, locators: { locatorMode: 'dynamic', renderDelay: 1500 }, failure: { paymentMode: 'decline' }, async: { paymentDelay: 4000 } }[b.dataset.preset]; await api('/lab/config', payload(values)); await labView(); notify(`Preset “${b.textContent}” is active.`, 'success', 'Preset applied'); } catch (e) { notify(e.message, 'error'); } });
    await refreshLab();
  } catch (e) { main.innerHTML = `<div class="wrap page"><div class="inline-error">${esc(e.message)}</div></div>`; }
}
async function refreshLab() {
  const version = viewVersion;
  try {
    const [status, events] = await Promise.all([api('/lab/status'), api('/lab/events')]); if (route().name !== 'lab' || version !== viewVersion || !$('#events')) return;
    $('#transport').textContent = `${status.transport.toUpperCase()} TRANSPORT`;
    $('#services').innerHTML = status.services.map(s => `<span class="service-pill ${s.status !== 'ok' ? 'bad' : ''}" title="${esc(s.eventError || s.status)}">● ${s.service} · ${s.status}</span>`).join('');
    $('#events').innerHTML = events.length ? events.map(e => `<div class="event"><div class="event-top"><strong>${esc(e.type)}</strong><time>${new Date(e.createdAt).toLocaleTimeString()}</time></div><code>order ${esc(e.orderId)}<br>event ${esc(e.id)}</code></div>`).join('') : '<div class="empty">No events yet. Place a test order to start the story.</div>';
  } catch (e) { if ($('#services')) $('#services').textContent = e.message; }
}

// ---------- Wiring ----------
$('#search-form').onsubmit = e => { e.preventDefault(); clearTimeout(searchTimer); location.hash = shopHash({ ...(route().name === 'shop' ? route().params : {}), q: $('#search').value.trim(), page: '' }); };
$('#search').oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { const q = $('#search').value.trim(), r = route(); if (q || r.name === 'shop') location.hash = shopHash({ ...(r.name === 'shop' ? r.params : {}), q, page: '' }); }, 350);
};
$('#account').onclick = e => { e.stopPropagation(); if (!account) return authModal('login'); const menu = $('#account-menu'), open = menu.hidden; closeMenus(); openMenu($('#account'), menu, open); };
$('#sign-out').onclick = signOut;
$('#categories-toggle').onclick = e => { e.stopPropagation(); const menu = $('#categories-menu'), open = menu.hidden; closeMenus(); openMenu($('#categories-toggle'), menu, open); };
document.addEventListener('click', e => { const t = e.target.closest('[data-open-register]'); if (!t) return; e.preventDefault(); if (account) return notify(`You are already signed in as ${account.name}.`, 'info'); authModal('register'); });
document.querySelector('.skip-link').onclick = e => { e.preventDefault(); main.focus(); };
$('#cart-open').onclick = () => { if (account) return cartModal(); notify('Sign in to see your bag.', 'info'); authModal(); };
$('#wishlist-open').onclick = e => { if (!account) { e.preventDefault(); notify('Sign in to see your wishlist.', 'info'); authModal(); } };
document.addEventListener('click', e => { if (!e.target.closest('.menu')) closeMenus(); else if (e.target.closest('[data-menu-link]')) closeMenus(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  for (const [button, menu] of [['#categories-toggle', '#categories-menu'], ['#account', '#account-menu']]) if (!$(menu).hidden) { openMenu($(button), $(menu), false); $(button).focus(); }
});
dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
window.addEventListener('hashchange', () => { dialog.close(); render(); window.scrollTo(0, 0); });
window.addEventListener('offline', () => notify('You are offline. Changes will fail until the connection is back.', 'warning', 'No connection'));
window.addEventListener('online', () => notify('The connection is back.', 'success'));
setInterval(async () => {
  if (pollBusy || document.hidden) return; pollBusy = true;
  try {
    await checkWatchedOrders();
    const r = route();
    if (r.name === 'lab') await refreshLab();
    if (r.name === 'orders' && !dialog.open) await ordersView(true);
    if (r.name === 'order' && !dialog.open && !TERMINAL.includes($('#order-banner [data-status]')?.dataset.status)) await orderView(r.sub, true);
  } finally { pollBusy = false; }
}, 2000);

if (token) { try { account = await api('/auth/me'); [cart, wishlist] = await Promise.all([api('/cart'), api('/wishlist').then(l => l.map(i => i.productId))]); } catch (e) { notify(e.message, 'error'); } }
setupPromotions(); updateHeader(); loadCategories(); render();
