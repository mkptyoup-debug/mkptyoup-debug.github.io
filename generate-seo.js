// generate-seo.js
// Firestore se glass groups padhta hai aur SEO pages, glass-guide.html aur sitemap.xml banata hai.
// Node 18+ chahiye, koi npm package nahi. Run: node generate-seo.js
// Test (internet ke bina): node generate-seo.js --local data.json

const fs = require('fs');
const path = require('path');

const SITE = 'https://mkptyoup-debug.github.io';
const PROJECT = 'glass-finder-pro';
const API_KEY = 'AIzaSyC_OXACPuxzAerOWiQ6O1BZBL0Du8Axdtg'; // public web key (sw.js me bhi hai)
const COLS = [
  { name: 'flat_glasses', kind: 'flat tempered' },
  { name: 'uv_glasses', kind: 'UV curved' }
];
const ROOT = __dirname;
const TODAY = new Date().toISOString().slice(0, 10);

const CSS = `:root{--bg:#faf6ee;--ink:#2b2418;--mut:#6b5f4b;--gold:#a8741f;--card:#fff;--line:#e6dcc6}
@media(prefers-color-scheme:dark){:root{--bg:#17130c;--ink:#f3ead7;--mut:#b9ab8f;--gold:#e0b25c;--card:#211b11;--line:#3a3120}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 system-ui,Segoe UI,Roboto,sans-serif}
main{max-width:680px;margin:0 auto;padding:28px 20px 60px}
a{color:var(--gold)}h1{font-size:1.6rem;line-height:1.25;margin:.2em 0 .4em}
.lead{color:var(--mut)}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 20px;margin:20px 0}
ul{padding-left:1.2em;margin:.4em 0}li{margin:.25em 0}
.btn{display:inline-block;background:var(--gold);color:#fff;text-decoration:none;padding:13px 22px;border-radius:12px;font-weight:600;margin-top:6px}
.small{font-size:.9rem;color:var(--mut)}nav a{font-size:.95rem}
`;

const APP_CSS = `.appbar{position:fixed;left:0;right:0;bottom:0;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));background:var(--bg);border-top:1px solid var(--line);z-index:9}
.appbar a{display:block;text-align:center;background:var(--gold);color:#fff;text-decoration:none;padding:14px;border-radius:12px;font-weight:700;font-size:1.05rem}
main{padding-bottom:110px}li{cursor:pointer}
`;
// Page par kahin bhi tap karo to app khulta hai (links ko chhod kar). Model naam save hota hai taaki app use khoj sake.
function appScript(model) {
  const q = JSON.stringify(model || '').replace(/</g, '\\u003c');
  return `<script>(function(){var A="${SITE}/",Q=${q};function go(){try{if(Q)localStorage.setItem("uc_pending_q",Q)}catch(e){}location.href=A}document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a");if(a&&!a.hasAttribute("data-open"))return;e.preventDefault();go()})})();</script>`;
}
const APPBAR = `<div class="appbar"><a href="${SITE}/" data-open>📲 Open in App</a></div>`;

// ---------- helpers ----------
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
// app ke parseModels jaisa: comma aur '/' se todta hai, bracket ke andar '/' nahi todta
function parseModels(models) {
  if (!models) return [];
  const arr = Array.isArray(models) ? models : [models];
  const out = [];
  arr.forEach(m => {
    String(m).split(/[,;\n]/).forEach(seg => {
      let depth = 0, cur = '';
      for (const ch of seg) {
        if (ch === '(') depth++;
        else if (ch === ')' && depth > 0) depth--;
        if (ch === '/' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
      if (cur.trim()) out.push(cur.trim());
    });
  });
  return out;
}

// ---------- brand normalisation ----------
// Firestore me kabhi models "Apple", "iPhone 13", "iPhone 13 PRO" jaise alag tukdo me hote hain.
// Bare brand ("Apple", "Oppo") ko header maan kar aage ke models me brand jodta hai.
const BRANDS = {};
['Apple','Realme','Redmi','POCO','Vivo','Oppo','Samsung','OnePlus','Motorola','Moto','Infinix','Tecno','itel','Lava','Nokia','Xiaomi','Honor','Nothing','iQOO','Google','Lenovo','Asus','Huawei','Sony','Micromax'].forEach(b => { BRANDS[b.toLowerCase()] = b; });
const WORDS = { PRO:'Pro', PLUS:'Plus', MAX:'Max', LITE:'Lite', NOTE:'Note', ULTRA:'Ultra', NEO:'Neo', PRIME:'Prime', POWER:'Power', ACE:'Ace', SPARK:'Spark', CAMON:'Camon', GALAXY:'Galaxy' };
function tidy(t) {
  return t.replace(/\s+/g, ' ').trim().split(' ').map(w => { const m = w.match(/^([A-Za-z]+)([^A-Za-z]*)$/); return m && WORDS[m[1]] ? WORDS[m[1]] + m[2] : w; }).join(' ');
}
function normalizeModels(list) {
  const out = [], seen = {};
  let cur = '';
  list.forEach(raw => {
    let t = tidy(raw);
    if (!t) return;
    const low = t.toLowerCase();
    if (BRANDS[low]) { cur = BRANDS[low]; return; }           // bare brand header
    const firstWord = low.split(' ')[0];
    if (BRANDS[firstWord]) { cur = BRANDS[firstWord]; t = cur + t.slice(firstWord.length); }
    else if (firstWord === 'iphone') { cur = 'Apple'; t = 'Apple ' + t; }
    else if (cur) t = cur + ' ' + t;
    const k = t.toLowerCase().replace(/[^a-z0-9+]/g, '');
    if (seen[k]) return;
    seen[k] = 1; out.push(t);
  });
  return out;
}
const setKey = models => models.map(m => m.toLowerCase()).sort().join('|');

// ---------- Firestore REST ----------
function fromValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  return null;
}
async function fetchCollection(col) {
  const docs = [];
  let token = '';
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${col}?pageSize=300&key=${API_KEY}` + (token ? `&pageToken=${encodeURIComponent(token)}` : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${col}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    (j.documents || []).forEach(d => {
      const f = {};
      Object.keys(d.fields || {}).forEach(k => { f[k] = fromValue(d.fields[k]); });
      docs.push({ id: d.name.split('/').pop(), glassName: f.glassName, models: f.models });
    });
    token = j.nextPageToken || '';
  } while (token);
  return docs;
}

// ---------- page template ----------
function pageHtml(g) {
  const n = g.models.length;
  const first = g.models[0];
  const title = `${g.models.slice(0, 3).join(', ')} Tempered Glass Compatibility | Universal Combo`;
  const desc = n > 1
    ? `${first} and ${n - 1} more phone model${n - 1 > 1 ? 's' : ''} ${n - 1 > 1 ? 'use' : 'uses'} the same ${g.kind} glass. Check compatibility with Universal Combo, the one-stop tool for mobile dealers.`
    : `${first} uses a dedicated ${g.kind} glass. Check compatibility with Universal Combo, the one-stop tool for mobile dealers.`;
  const lead = n > 1
    ? `The same ${g.kind} glass fits ${n} phone models. Always match the size against the phone before fitting.`
    : `This ${g.kind} glass is made for this phone model. Always match the size against the phone before fitting.`;
  const url = `${SITE}/${g.file}`;
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${url}">
<meta name="gid2" content="${esc(g.id)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><style>
${CSS}${APP_CSS}</style></head><body><main>
<nav><a href="${SITE}/glass-guide.html">All glass groups</a></nav>
<h1>${esc(first)} tempered glass: compatible models</h1>
<p class="lead">${esc(lead)}</p>
<div class="card"><strong>Also compatible with</strong><ul>${g.models.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>
<p>Universal Combo helps mobile shops and dealers find compatible tempered glass, back covers, displays, batteries and frames by phone model.</p>
<a class="btn" href="${SITE}/" data-open>Open in App</a>
<p class="small">Tap anywhere to open the app and see the complete verified list.</p>
</main>${APPBAR}${appScript(first)}</body></html>`;
}

function guideHtml(groups) {
  const byBrand = {};
  groups.forEach(g => {
    const b = g.models[0].split(/\s+/)[0];
    const k = b.toLowerCase();
    (byBrand[k] = byBrand[k] || { name: b, items: [] }).items.push(g);
  });
  const brands = Object.values(byBrand).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const title = 'Tempered Glass Compatibility Guide by Phone Model | Universal Combo';
  const desc = 'Browse tempered glass compatibility groups for Vivo, Oppo, Realme, Samsung, Redmi, POCO, OnePlus, Apple and more. Made for mobile dealers in India.';
  const body = brands.map(b =>
    `<h2>${esc(b.name)}</h2><ul>` +
    b.items.sort((x, y) => x.models[0].localeCompare(y.models[0], 'en', { numeric: true }))
      .map(g => `<li><a href="${SITE}/${g.file}">${esc(g.models.slice(0, 3).join(', '))}</a></li>`).join('') +
    '</ul>').join('');
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${SITE}/glass-guide.html">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><style>
${CSS}${APP_CSS}</style></head><body><main>
<h1>Tempered glass compatibility guide</h1>
<p class="lead">Pick a phone to see which other models share the same glass.</p>${body}
<a class="btn" href="${SITE}/" data-open>Open in App</a>
</main>${APPBAR}${appScript('')}</body></html>`;
}

// ---------- main ----------
async function main() {
  const localIdx = process.argv.indexOf('--local');
  let raw = [];
  if (localIdx > -1) {
    raw = JSON.parse(fs.readFileSync(process.argv[localIdx + 1], 'utf8'));
  } else {
    for (const c of COLS) {
      const docs = await fetchCollection(c.name);
      docs.forEach(d => raw.push({ ...d, kind: c.kind }));
    }
  }
  // Safety: agar data bahut kam aaya to kuch mat badlo (galti se saare pages na ud jaayein)
  if (raw.length < 10) throw new Error(`Sirf ${raw.length} groups mile, rok diya. Rules/network check karo.`);

  const all = raw
    .map(d => ({ id: d.id, kind: d.kind, models: normalizeModels(parseModels(d.models)) }))
    .filter(g => g.models.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  // Jis group ka pehla naam sirf ek shabd ho (jaise "Apple") uska page nahi banta
  const bad = all.filter(g => !/\s/.test(g.models[0]));
  const groups = all.filter(g => /\s/.test(g.models[0]));
  console.log('Sample data:');
  groups.slice(0, 4).forEach(g => console.log('  ', g.models.slice(0, 4).join(' | ')));
  if (bad.length) { console.log(`Skipped ${bad.length} groups (pehla naam adhura):`); bad.slice(0, 8).forEach(g => console.log('  ', g.models.slice(0, 4).join(' | '))); }
  if (bad.length > all.length * 0.15) throw new Error('Bahut groups ka data ajeeb hai, kuch nahi badla. Upar Sample data dekho.');

  // Purane pages se slug yaad rakho (URL na badle): pehle gid meta se, warna model-list match se
  const files = fs.readdirSync(ROOT).filter(f => /^glass-.+\.html$/.test(f) && f !== 'glass-guide.html');
  const byGid = {}, bySet = {}, junk = new Set();
  files.forEach(f => {
    const h = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const m = h.match(/<meta name="gid2" content="([^"]+)"/);
    if (m) byGid[m[1]] = f;
    else if (/<meta name="gid" /.test(h)) junk.add(f); // galat purane run ke pages
    else {
      const lis = [...h.matchAll(/<li>([^<]*)<\/li>/g)].map(x => x[1].replace(/&amp;/g, '&'));
      if (lis.length) (bySet[setKey(lis)] = bySet[setKey(lis)] || []).push(f);
    }
  });
  const used = new Set();
  groups.forEach(g => {
    let f = byGid[g.id];
    if (!f) { const c = bySet[setKey(g.models)]; if (c && c.length) f = c.shift(); }
    if (f && !used.has(f)) { g.file = f; used.add(f); }
  });
  groups.forEach(g => {
    if (g.file) return;
    const base = 'glass-' + slugify(g.models[0]);
    let f = base + '.html', i = 2;
    while (used.has(f)) f = `${base}-${i++}.html`;
    g.file = f; used.add(f);
  });

  // purani lastmod dates sitemap se
  const oldMod = {};
  try {
    const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
    for (const m of sm.matchAll(/<loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)) oldMod[m[1]] = m[2];
  } catch (e) {}

  // jin groups ko delete kiya gaya, unke pages hatao (safety limit ke saath)
  const stale = files.filter(f => !used.has(f));
  const risky = stale.filter(f => !junk.has(f));
  const force = ['1', 'true'].includes(String(process.env.FORCE || ''));
  if (risky.length > Math.max(5, files.length * 0.25) && !force) {
    throw new Error(`${risky.length} pages delete hone wale the, ye bahut zyada hai. Kuch nahi badla.`);
  }

  const changed = [];
  const write = (file, html) => {
    const p = path.join(ROOT, file);
    const old = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
    if (old !== html) { fs.writeFileSync(p, html); changed.push(file); }
  };
  groups.forEach(g => write(g.file, pageHtml(g)));
  write('glass-guide.html', guideHtml(groups));
  stale.forEach(f => { fs.unlinkSync(path.join(ROOT, f)); changed.push('(deleted) ' + f); });


  // sitemap
  const urls = [`${SITE}/`, `${SITE}/glass-guide.html`].concat(groups.map(g => `${SITE}/${g.file}`).sort());
  const mod = u => {
    const f = u === `${SITE}/` ? null : u.replace(SITE + '/', '');
    return (f && changed.includes(f)) || !oldMod[u] ? TODAY : oldMod[u];
  };
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map(u => `<url><loc>${u}</loc><lastmod>${mod(u)}</lastmod></url>`).join('\n') + '\n</urlset>\n';
  write('sitemap.xml', xml);

  console.log(`Groups: ${groups.length} | Changed files: ${changed.length}`);
  changed.slice(0, 30).forEach(c => console.log(' -', c));
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
