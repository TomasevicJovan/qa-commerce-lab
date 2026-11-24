import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
export const host = process.env.BIND_HOST || '127.0.0.1';
export const ports = { gateway: 3000, broker: 4100, identity: 4101, catalog: 4102, orders: 4103, inventory: 4104, payments: 4105 };
export const basePort = Number(process.env.PORT_OFFSET || 0);
export const url = name => process.env[`${name.toUpperCase()}_URL`] || `http://127.0.0.1:${ports[name] + basePort}`;
export const id = () => randomUUID();
export function database(name) {
  const dir = resolve(process.env.DATA_DIR || 'data'); mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(resolve(dir, `${name}.sqlite`));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  return {
    db,
    get(key, fallback) { const r = db.prepare('SELECT value FROM state WHERE key=?').get(key); return r ? JSON.parse(r.value) : structuredClone(fallback); },
    set(key, value) { db.prepare('INSERT INTO state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); },
    transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const out = fn(); db.exec('COMMIT'); return out; } catch(e) { db.exec('ROLLBACK'); throw e; } }
  };
}
export function fail(status, message, field) { throw Object.assign(new Error(message), { status, ...(field ? { field } : {}) }); }
export async function body(req) {
  let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 100_000) fail(413, 'Request too large'); }
  let value; try { value = text ? JSON.parse(text) : {}; } catch { fail(400, 'Invalid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'JSON object required');
  return value;
}
export function json(res, status, data) { res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store' }); res.end(JSON.stringify(data)); }
export async function call(name, path, options = {}) {
  const response = await fetch(url(name) + path, { ...options, signal: AbortSignal.timeout(8000), headers: { 'Content-Type':'application/json', ...options.headers } });
  const data = await response.json(); if (!response.ok) fail(response.status, data.error || 'Service request failed'); return data;
}
export const post = data => ({ method:'POST', body:JSON.stringify(data) });
export const defaults = { locatorMode:'stable', renderDelay:0, apiDelay:0, paymentMode:'approve', paymentDelay:0, pauseInventory:false, pausePayments:false, duplicateEvents:false, stalePrice:false, rateLimit:false, sessionSeconds:3600 };
// Catalog seed. Prices are USD cents. `price` is always the price charged at checkout; `compareAtPrice` is the
// pre-sale price shown struck through for Black Friday deals. Bump CATALOG_VERSION when the seed changes.
export const CATALOG_VERSION = 4;
// Two levels: category > subcategory. Popular subcategories appear as one-click links in the navigation row.
export const categoryTree = [
  { name:'Electronics', subcategories:['Audio','Gaming','Phones & Tablets','Smart Home','Computer Accessories'] },
  { name:'Home & Living', subcategories:['Kitchen','Lighting','Decor','Textiles'] },
  { name:'Office & School', subcategories:['Workspace','Stationery'] },
  { name:'Sports & Outdoors', subcategories:['Fitness','Outdoor & Camping','Cycling'] },
  { name:'Travel & Bags', subcategories:['Bags & Backpacks','Travel Accessories'] },
  { name:'Garden', subcategories:['Plants & Seeds','Garden Tools'] },
  { name:'Kids & Toys', subcategories:['Toys & Games','Learning'] },
  { name:'Beauty & Health', subcategories:['Personal Care','Wellness'] },
  { name:'Pets', subcategories:['Dogs','Cats'] }
];
export const popularSubcategories = ['Audio','Gaming','Smart Home','Fitness','Phones & Tablets'];
const parentOf = Object.fromEntries(categoryTree.flatMap(c => c.subcategories.map(s => [s, c.name])));
const item = (id, name, subcategory, price, stock, icon, color, popularity, description, { compareAtPrice = null, freeShipping = false } = {}) =>
  ({ id, name, category: parentOf[subcategory], subcategory, price, compareAtPrice, deal: compareAtPrice ? 'black-friday' : null, freeShipping, popularity, stock, icon, color, description });
export const products = [
  item('p1','Arc Wireless Headphones','Audio',12900,12,'◉','lavender',95,'Room-filling sound. A little space to yourself.'),
  item('p2','Orbit Desk Lamp','Workspace',7900,8,'◠','peach',71,'A warmer light for your next bright idea.'),
  item('p3','Loop Mechanical Keyboard','Computer Accessories',14900,5,'▦','mint',80,'Every keystroke, a small satisfaction.'),
  item('p4','Field Everyday Backpack','Bags & Backpacks',8900,3,'▣','sand',56,'For the commute and the scenic route.'),
  item('p5','Still Ceramic Mug','Kitchen',2400,20,'◡','rose',65,'Make a little room for your morning ritual.'),
  item('p6','Pocket Mini Speaker','Audio',5900,1,'▥','blue',78,'Big enough for the soundtrack. Small enough to go.'),
  item('p7','Pebble Desk Clock','Workspace',4500,7,'◷','sand',38,'A quieter way to keep time.'),
  item('p8','Fold Travel Organizer','Travel Accessories',3500,9,'▤','mint',46,'A place for the little things.'),
  item('p9','Halo Glass Vase','Decor',6200,4,'♧','lavender',42,'Something special for a single stem.'),
  item('p10','Brew Pour-Over Kettle','Kitchen',6900,10,'◬','peach',70,'A slow pour for a better cup.',{compareAtPrice:9900}),
  item('p11',"Crisp Chef's Knife",'Kitchen',5400,6,'◢','sand',55,'Balanced, sharp and ready for dinner.'),
  item('p12','Grain Bamboo Board Set','Kitchen',2900,15,'▭','mint',48,'Three boards for every kind of prep.',{freeShipping:true}),
  item('p13','Glow Bedside Light','Lighting',4900,9,'☾','lavender',66,'Soft light for the last chapter of the day.',{compareAtPrice:6900}),
  item('p14','Beam LED Strip 5 m','Lighting',3200,18,'═','blue',52,'Colour along every edge.',{freeShipping:true}),
  item('p15','Dome Pendant Lamp','Lighting',11900,4,'◓','peach',40,'A calm centre for the dining table.'),
  item('p16','Pulse Wireless Controller','Gaming',5900,14,'◎','blue',92,'Low latency. High score.',{compareAtPrice:7900}),
  item('p17','Arena Gaming Mouse','Gaming',4900,11,'◖','rose',88,'Precise, light and quick to the click.'),
  item('p18','Deck Headset Stand','Gaming',2500,20,'⊓','sand',60,'A proper home for your headset.',{freeShipping:true}),
  item('p19','Nova Gaming Chair','Gaming',24900,3,'▙','lavender',85,'Long sessions, better posture.',{compareAtPrice:34900}),
  item('p20','Sense Smart Plug (2-pack)','Smart Home',2900,25,'◘','mint',90,'Schedule anything with a plug.',{compareAtPrice:3900,freeShipping:true}),
  item('p21','Hub Home Assistant','Smart Home',9900,7,'◍','blue',82,'One voice for every room.'),
  item('p22','Eye Indoor Camera','Smart Home',6900,8,'◕','rose',87,'Check in on home from anywhere.',{compareAtPrice:11500}),
  item('p23','Flow Yoga Mat','Fitness',3900,16,'▬','mint',75,'Grip for every pose.',{freeShipping:true}),
  item('p24','Core Adjustable Dumbbells','Fitness',17900,4,'◫','sand',72,'A full rack in two handles.'),
  item('p25','Stride Fitness Band','Fitness',7900,12,'◌','peach',84,'Steps, sleep and heart rate.',{compareAtPrice:9900}),
  item('p26','Trail Insulated Bottle','Outdoor & Camping',2900,30,'▯','blue',68,'Cold for a day. Hot for a morning.',{freeShipping:true}),
  item('p27','Summit Camping Lantern','Outdoor & Camping',3900,10,'✦','peach',45,'Warm light for the campsite.'),
  item('p28','Ridge Two-Person Tent','Outdoor & Camping',15900,3,'△','mint',50,'Up in five minutes, dry all night.'),
  item('p29','Note Dotted Journal','Stationery',1800,40,'▢','sand',58,'For lists, plans and better ideas.',{freeShipping:true}),
  item('p30','Ink Fountain Pen','Stationery',4200,9,'✎','lavender',35,'Write slower. Think clearer.'),
  item('p31','Stack Wooden Blocks','Toys & Games',3400,11,'▩','peach',62,'Forty blocks, endless towers.',{compareAtPrice:4500}),
  item('p32','Puzzle Planet 500','Toys & Games',2200,14,'◔','blue',47,'Five hundred pieces of the world.',{freeShipping:true}),
  item('p33','Calm Aroma Diffuser','Wellness',4400,9,'◇','rose',64,'A quiet mist for a slower evening.'),
  item('p34','Pure Bamboo Toothbrush Set','Personal Care',1200,50,'❘','mint',41,'Four brushes, no plastic handles.',{freeShipping:true}),
  item('p35','Paws Cozy Pet Bed','Dogs',5900,6,'◒','sand',57,'The best seat in the house.',{compareAtPrice:7900}),
  item('p36','Fetch Ball Launcher','Dogs',3900,5,'●','peach',44,'Throws further than your arm.'),
  item('p37','Sprout Herb Garden Kit','Plants & Seeds',3600,12,'♣','mint',54,'Basil, mint and thyme on the windowsill.',{freeShipping:true}),
  item('p38','Prune Garden Shears','Garden Tools',2800,8,'✂','rose',30,'Clean cuts for healthy plants.'),
  item('p39','Charge 3-in-1 Stand','Phones & Tablets',6400,10,'▮','lavender',86,'Phone, watch and earbuds in one place.',{compareAtPrice:8900}),
  item('p40','Shell Phone Case','Phones & Tablets',1900,35,'▯','rose',79,'Slim, grippy and drop-tested.',{freeShipping:true}),
  item('p41','Volt Power Bank 20K','Phones & Tablets',4900,13,'▰','blue',81,'Four full charges in your pocket.'),
  item('p42','Studio Bookshelf Speakers','Audio',21900,4,'◙','sand',74,'Big sound for small rooms.',{compareAtPrice:27900}),
  item('p43','Rise Laptop Stand','Workspace',4900,12,'◿','mint',77,'Eye level, all day.',{freeShipping:true}),
  item('p44','Drift Neck Pillow','Travel Accessories',2400,18,'◡','lavender',49,'Sleep on the long haul.',{freeShipping:true}),
  item('p45','Weave Throw Blanket','Textiles',5500,7,'▧','peach',63,'Warmth for the sofa season.',{compareAtPrice:6900}),
  item('p46','Dock USB-C Hub','Computer Accessories',5900,15,'▤','blue',76,'Seven ports from one cable.',{freeShipping:true}),
  item('p47','Glide Wireless Mouse','Computer Accessories',3400,20,'◖','sand',69,'Quiet clicks, all-day battery.'),
  item('p48','View Monitor Arm','Computer Accessories',8900,6,'⌐','mint',58,'Float your screen at the right height.',{compareAtPrice:11900}),
  item('p49','Bud True Wireless Earbuds','Audio',7900,15,'◦','rose',89,'Small buds, big sound, no wires.',{compareAtPrice:9900}),
  item('p50','Lumen Smart Bulb (4-pack)','Smart Home',3900,22,'◯','peach',73,'Warm or cool, from your phone.',{freeShipping:true}),
  item('p51','Frame Wall Mirror','Decor',9900,5,'▢','sand',51,'Make any room look bigger.'),
  item('p52','Tide Scented Candle','Decor',1600,30,'◊','rose',61,'Forty hours of sea breeze.',{freeShipping:true}),
  item('p53','Moss Wall Planter','Decor',4200,8,'♠','mint',39,'A little green on a blank wall.'),
  item('p54','Linen Cushion Cover','Textiles',2200,25,'▣','lavender',47,'Washed linen, soft from day one.',{freeShipping:true}),
  item('p55','Cloud Bath Towel Set','Textiles',4900,12,'▥','blue',59,'Two towels that dry fast and stay soft.',{compareAtPrice:6500}),
  item('p56','Rest Cotton Bedding Set','Textiles',8900,7,'▭','sand',55,'Cool in summer, cosy in winter.'),
  item('p57','Press Coffee Grinder','Kitchen',6400,9,'◍','peach',67,'Fresh grounds, every morning.'),
  item('p58','Board Cork Pinboard','Workspace',2700,14,'▦','sand',33,'Plans, photos and reminders.',{freeShipping:true}),
  item('p59','Tidy Desk Organizer','Workspace',3100,16,'▤','mint',44,'A place for every pen.'),
  item('p60','Mark Highlighter Set','Stationery',900,60,'▮','peach',52,'Six colours, no smudges.',{freeShipping:true}),
  item('p61','Sketch A4 Sketchbook','Stationery',1500,35,'▯','lavender',43,'Heavy paper for every medium.',{freeShipping:true}),
  item('p62','Jump Speed Rope','Fitness',1400,40,'∞','rose',66,'Ten minutes, real cardio.',{freeShipping:true}),
  item('p63','Peak Hiking Backpack 30 L','Outdoor & Camping',9900,6,'▲','mint',63,'Light, ventilated, trail-ready.',{compareAtPrice:12900}),
  item('p64','Spoke Bike Light Set','Cycling',2900,20,'✧','blue',64,'Be seen, front and back.',{freeShipping:true}),
  item('p65','Shield Cycling Helmet','Cycling',6900,8,'◓','peach',60,'Light protection for every ride.'),
  item('p66','Lock Folding Bike Lock','Cycling',4500,10,'◫','sand',42,'Folds small, locks strong.'),
  item('p67','Pedal Bottle Cage','Cycling',1200,30,'◡','mint',29,'Keeps your bottle in place.',{freeShipping:true}),
  item('p68','Carry Cabin Suitcase','Bags & Backpacks',15900,5,'▯','lavender',71,'Fits the overhead bin, every time.',{compareAtPrice:19900}),
  item('p69','City Crossbody Bag','Bags & Backpacks',4400,11,'◒','rose',53,'Phone, keys, wallet. Done.'),
  item('p70','Roll Weekender Duffel','Bags & Backpacks',7900,6,'▭','sand',48,'Two nights, one bag.'),
  item('p71','Plug Universal Travel Adapter','Travel Accessories',2900,24,'⊕','blue',62,'One adapter for 150 countries.',{freeShipping:true}),
  item('p72','Bloom Wildflower Seed Pack','Plants & Seeds',900,50,'✿','peach',46,'A meadow for bees and butterflies.',{freeShipping:true}),
  item('p73','Grow Self-Watering Pot','Plants & Seeds',2600,15,'◡','mint',41,'Water once a week, not every day.'),
  item('p74','Dig Hand Trowel Set','Garden Tools',2200,12,'◣','sand',34,'Three tools for planting and weeding.'),
  item('p75','Rain Watering Can','Garden Tools',3200,9,'◭','blue',37,'A gentle shower for seedlings.',{compareAtPrice:4200}),
  item('p76','Roll Wooden Train Set','Toys & Games',5400,7,'▬','peach',58,'Tracks, bridges and a tunnel.'),
  item('p77','Spark Science Kit','Learning',4900,10,'◈','lavender',61,'Twenty experiments to try at home.',{compareAtPrice:6500}),
  item('p78','Letters Magnetic Alphabet','Learning',1900,25,'◩','rose',40,'First words on the fridge.',{freeShipping:true}),
  item('p79','Globe Light-Up Globe','Learning',6900,6,'◍','blue',45,'Explore the world, then switch it on.'),
  item('p80','Glow Facial Roller','Personal Care',2400,20,'◖','rose',50,'Cool stone for a calm morning.',{freeShipping:true}),
  item('p81','Trim Beard Trimmer','Personal Care',5900,9,'▮','sand',57,'Twenty lengths, one charge a month.'),
  item('p82','Breathe Massage Gun','Wellness',11900,5,'◢','mint',70,'Deep relief after a long day.',{compareAtPrice:15900}),
  item('p83','Purr Cat Scratching Post','Cats',4900,8,'▮','sand',54,'Saves the sofa.'),
  item('p84','Feather Wand Cat Toy','Cats',900,40,'⌇','peach',49,'Ten minutes of pure chaos.',{freeShipping:true}),
  item('p85','Nest Cat Window Perch','Cats',3900,7,'◠','lavender',43,'Front-row seat to the birds.'),
  item('p86','Walk Reflective Dog Leash','Dogs',2400,18,'∽','blue',52,'Safe evening walks.',{freeShipping:true}),
  // Prices with cents exercise the rounding rule: 10% of these amounts ends in half a cent.
  item('p87','Pocket Notebook 3-pack','Stationery',1995,30,'▤','sand',50,'Three notebooks for every pocket.'),
  item('p88','Twist Phone Grip','Phones & Tablets',1295,40,'◎','lavender',55,'A better hold on your phone.'),
  item('p89','Glow Night Light','Lighting',2495,15,'☾','peach',48,'A soft glow for the hallway.',{compareAtPrice:3495})
];
export const FREE_SHIPPING_THRESHOLD = 15000, SHIPPING_FEE = 700, COUPONS = ['SAVE10','EXPIRED'], PAYMENT_METHODS = ['card','test-wallet'];
// Authoritative pricing. Lines carry unitPrice, quantity and freeShipping. Black Friday is already part of unitPrice.
// The 10% card discount applies when the order is paid with a Mastercard (saved or new).
export function priceOrder(lines, { coupon = '', cardBrand = '' } = {}) {
  const subtotal = lines.reduce((n, l) => n + l.unitPrice * l.quantity, 0);
  const couponDiscount = coupon === 'SAVE10' ? Math.round(subtotal * 0.1) : 0;
  const paymentDiscount = cardBrand === 'mastercard' ? Math.round((subtotal - couponDiscount) * 0.1) : 0;
  const discount = couponDiscount + paymentDiscount;
  const allFreeShipping = lines.length > 0 && lines.every(l => l.freeShipping);
  const shipping = subtotal - discount >= FREE_SHIPPING_THRESHOLD || allFreeShipping ? 0 : SHIPPING_FEE;
  return { subtotal, couponDiscount, paymentDiscount, discount, shipping, total: subtotal - discount + shipping };
}

// ---------- Simulated cards ----------
// Only these ten numbers are approved. Every other number that passes validation is declined by the simulated processor.
// Full card numbers and security codes are never stored: a saved card keeps brand, last four digits, expiry and holder.
export const APPROVED_TEST_CARDS = [
  '4242424242424242', '4111111111111111', '4012888888881881', '4000056655665556',
  '5555555555554444', '5105105105105100', '2223003122003222', '5200828282828210',
  '378282246310005', '371449635398431'
];
export const MAX_SAVED_CARDS = 5;
export function cardBrand(number) {
  if (/^4\d{15}$/.test(number)) return 'visa';
  if (/^(5[1-5]\d{14}|2(2[2-9][1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720)\d{12})$/.test(number)) return 'mastercard';
  if (/^3[47]\d{13}$/.test(number)) return 'amex';
  return null;
}
export function luhn(number) {
  let sum = 0;
  for (let i = 0; i < number.length; i++) { let d = Number(number[number.length - 1 - i]); if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return number.length > 0 && sum % 10 === 0;
}
// Validates a new card. Returns the normalized card or throws 422 with the failing field name.
export function validateCard(input, now = new Date()) {
  if (!input || typeof input !== 'object') fail(422, 'Card details required', 'card');
  const holder = String(input.holder ?? '').trim().replace(/\s+/g, ' ');
  if (holder.length < 2 || holder.length > 100 || !/^[\p{L}][\p{L} .'-]*$/u.test(holder)) fail(422, 'Enter the cardholder name as it appears on the card', 'holder');
  const number = String(input.number ?? '').replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(number) || !luhn(number)) fail(422, 'Enter a valid card number', 'number');
  const brand = cardBrand(number);
  if (!brand) fail(422, 'We accept Visa, Mastercard and American Express', 'number');
  const match = /^(\d{2})\s*\/\s*(\d{2})$/.exec(String(input.expiry ?? '').trim());
  if (!match) fail(422, 'Enter the expiry date as MM/YY', 'expiry');
  const expMonth = Number(match[1]), expYear = 2000 + Number(match[2]);
  if (expMonth < 1 || expMonth > 12) fail(422, 'Expiry month must be between 01 and 12', 'expiry');
  if (isExpired(expMonth, expYear, now)) fail(422, 'This card has expired', 'expiry');
  if (expYear > now.getFullYear() + 20) fail(422, 'Expiry date is too far in the future', 'expiry');
  const cvc = String(input.cvc ?? '').trim();
  if (!(brand === 'amex' ? /^\d{4}$/ : /^\d{3}$/).test(cvc)) fail(422, brand === 'amex' ? 'Enter the 4-digit security code' : 'Enter the 3-digit security code', 'cvc');
  return { holder, brand, last4: number.slice(-4), expMonth, expYear, outcome: APPROVED_TEST_CARDS.includes(number) ? 'approve' : 'card_declined' };
}
// A card is valid through the last day of its expiry month.
export function isExpired(expMonth, expYear, now = new Date()) { return expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < now.getMonth() + 1); }
