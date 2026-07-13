/* Builds blog/index.html — the cross-app journal for ubuntu-markets.org.
 *
 * Aggregates each product's public content as EXCERPT CARDS that link to the
 * original post on the app's own domain (never full copies — the apps keep
 * the canonical URL, the ranking, and the visitor). Also renders the
 * Featured App of the Week, auto-rotated by ISO week via featured.json
 * (set "override" there to pin one).
 *
 * Run: node scripts/build-blog.mjs   (Node 18+; no dependencies)
 * Runs daily + on demand via .github/workflows/rebuild-blog.yml.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const featuredCfg = JSON.parse(readFileSync(path.join(ROOT, 'featured.json'), 'utf8'));

const esc = (s) => String(s || '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

async function fetchJson(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'ubuntu-markets-blog-build' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn(`[blog] source failed (${url}): ${e.message} — skipping`);
    return null;
  }
}

// ---- Sources (each returns [{app, appName, color, title, excerpt, url, published}])

async function ileUbuntuPosts() {
  const data = await fetchJson('https://ileubuntu-production.up.railway.app/api/blog/posts/public');
  const app = featuredCfg.apps.find((a) => a.id === 'ile-ubuntu');
  return (data?.posts || []).map((p) => ({
    app: 'ile-ubuntu', appName: app.name, color: app.color,
    title: p.title,
    excerpt: (p.excerpt || p.content || '').replace(/<[^>]*>/g, '').slice(0, 220),
    url: `https://www.ile-ubuntu.org/blog/${p.slug}`,
    published: (p.created_at || '').slice(0, 10),
  }));
}

async function legacyTableGuides() {
  const data = await fetchJson('https://legacytable.app/guides/guides.json');
  const app = featuredCfg.apps.find((a) => a.id === 'legacy-table');
  return (data?.guides || []).map((g) => ({
    app: 'legacy-table', appName: app.name, color: app.color,
    title: g.title, excerpt: (g.description || '').slice(0, 220),
    url: g.url, published: g.published || '',
  }));
}

// Kindred joins here the day it has a public feed.
const SOURCES = [ileUbuntuPosts, legacyTableGuides];

// ---- Featured app: manual override, else ISO-week rotation
function isoWeek(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function pickFeatured() {
  if (featuredCfg.override) {
    const found = featuredCfg.apps.find((a) => a.id === featuredCfg.override);
    if (found) return found;
  }
  return featuredCfg.apps[isoWeek() % featuredCfg.apps.length];
}

// ---- Render

const posts = (await Promise.all(SOURCES.map((s) => s()))).flat().filter(Boolean)
  .sort((a, b) => (b.published || '').localeCompare(a.published || ''));
const featured = pickFeatured();
const today = new Date().toISOString().slice(0, 10);

const cards = posts.map((p) => `
      <article class="card">
        <span class="badge" style="--app:${p.color}">${esc(p.appName)}</span>
        <h3><a href="${esc(p.url)}">${esc(p.title)}</a></h3>
        <p>${esc(p.excerpt)}${p.excerpt.length >= 220 ? '…' : ''}</p>
        <div class="card-foot">
          ${p.published ? `<time datetime="${esc(p.published)}">${esc(p.published)}</time>` : '<span></span>'}
          <a class="readmore" href="${esc(p.url)}">Read on ${esc(p.appName)} →</a>
        </div>
      </article>`).join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Village Journal — Ubuntu Markets</title>
<meta name="description" content="Stories and guides from across the Ubuntu Markets family — Legacy Table, Ilé Ubuntu, and Kindred. Preserving recipes, raising learners, gathering kin.">
<link rel="canonical" href="https://ubuntu-markets.org/blog/">
<meta property="og:type" content="website">
<meta property="og:title" content="The Village Journal — Ubuntu Markets">
<meta property="og:description" content="Stories and guides from across the Ubuntu Markets family of apps.">
<meta property="og:url" content="https://ubuntu-markets.org/blog/">
<link rel="icon" href="/icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Outfit:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  :root { --black:#141210; --cream:#FDFCF9; --cream-dim:#C8BFB0; --gold:#C9A84C; --paper:#F5F0E8; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--cream); color:var(--black); font-family:'Outfit',sans-serif; }
  nav { display:flex; justify-content:space-between; align-items:center; padding:1.2rem 3rem; background:var(--black); }
  .nav-logo { display:flex; align-items:center; gap:.75rem; text-decoration:none; }
  .nav-logo img { height:44px; width:44px; object-fit:cover; border-radius:4px; }
  .nav-logo-text { font-family:'Cormorant Garamond',serif; color:var(--cream); font-size:1.15rem; }
  .nav-logo-text span { display:block; font-weight:300; color:var(--cream-dim); font-size:.65rem; letter-spacing:.2em; }
  .nav-links { display:flex; gap:2.5rem; list-style:none; }
  .nav-links a { color:var(--cream-dim); text-decoration:none; font-size:.82rem; letter-spacing:.1em; text-transform:uppercase; }
  .nav-links a:hover { color:var(--gold); }
  header.page { max-width:1080px; margin:0 auto; padding:4rem 2rem 1rem; }
  header.page h1 { font-family:'Cormorant Garamond',serif; font-size:2.6rem; font-weight:500; }
  header.page p { color:#6b6357; margin-top:.4rem; max-width:56ch; }
  .featured { max-width:1080px; margin:2rem auto 0; padding:0 2rem; }
  .featured-inner { border:1px solid var(--gold); border-radius:6px; background:var(--paper); padding:1.6rem 1.8rem; display:flex; flex-wrap:wrap; gap:1.2rem; align-items:center; justify-content:space-between; }
  .featured-label { font-size:.7rem; letter-spacing:.25em; text-transform:uppercase; color:#7A5E1E; }
  .featured h2 { font-family:'Cormorant Garamond',serif; font-size:1.9rem; font-weight:500; margin:.2rem 0; }
  .featured p { color:#6b6357; max-width:52ch; }
  .featured-links { display:flex; gap:.8rem; flex-wrap:wrap; }
  .featured-links a { text-decoration:none; font-size:.8rem; letter-spacing:.08em; text-transform:uppercase; padding:.5rem 1rem; border:1px solid var(--black); border-radius:2px; color:var(--black); }
  .featured-links a.primary { background:var(--black); color:var(--cream); }
  .grid { max-width:1080px; margin:2.5rem auto 4rem; padding:0 2rem; display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:1.4rem; }
  .card { border:1px solid #E4DCCB; border-radius:6px; background:#fff; padding:1.4rem; display:flex; flex-direction:column; gap:.7rem; }
  .badge { align-self:flex-start; font-size:.68rem; letter-spacing:.14em; text-transform:uppercase; color:var(--app); border:1px solid var(--app); border-radius:999px; padding:.18rem .6rem; }
  .card h3 { font-family:'Cormorant Garamond',serif; font-size:1.35rem; font-weight:600; line-height:1.25; }
  .card h3 a { color:var(--black); text-decoration:none; }
  .card h3 a:hover { color:var(--gold); }
  .card p { color:#6b6357; font-size:.9rem; line-height:1.55; flex:1; }
  .card-foot { display:flex; justify-content:space-between; align-items:center; font-size:.78rem; color:#a99f8e; }
  .readmore { color:var(--gold); text-decoration:none; letter-spacing:.04em; }
  .empty { max-width:1080px; margin:3rem auto 5rem; padding:0 2rem; color:#6b6357; }
  footer { background:var(--black); color:var(--cream-dim); text-align:center; padding:2rem; font-size:.8rem; }
  footer a { color:var(--gold); text-decoration:none; }
  @media (max-width:640px) { nav { padding:1rem 1.4rem; } .nav-links { gap:1.2rem; } }
</style>
</head>
<body>
<nav>
  <a class="nav-logo" href="/"><img src="/icon.png" alt=""><span class="nav-logo-text">Ubuntu Markets<span>WE BUILD FOR THE VILLAGE</span></span></a>
  <ul class="nav-links">
    <li><a href="/#products">Products</a></li>
    <li><a href="/blog/">Journal</a></li>
    <li><a href="/#about">About</a></li>
  </ul>
</nav>

<header class="page">
  <h1>The Village Journal</h1>
  <p>Stories and guides from across our family of apps — preserving recipes, raising learners, gathering kin. Every piece lives on its app's own site; this is the table where they're all served.</p>
</header>

<section class="featured" aria-label="Featured app">
  <div class="featured-inner">
    <div>
      <div class="featured-label">Featured App · Week of ${today}</div>
      <h2>${esc(featured.name)}</h2>
      <p>${esc(featured.tagline)}</p>
    </div>
    <div class="featured-links">
      <a class="primary" href="${esc(featured.site)}">Visit ${esc(featured.name)}</a>
      <a href="${esc(featured.appStore)}">App Store</a>
      <a href="${esc(featured.playStore)}">Google Play</a>
    </div>
  </div>
</section>

${posts.length ? `<section class="grid">\n${cards}\n</section>` : `<p class="empty">Fresh stories are on their way — meanwhile, meet this week's featured app above.</p>`}

<footer>Built with love in Oakland · <a href="/">Ubuntu Markets</a> · Legacy Table · Ilé Ubuntu · Kindred</footer>
</body>
</html>
`;

writeFileSync(path.join(ROOT, 'blog', 'index.html'), html);
console.log(`[blog] wrote blog/index.html — ${posts.length} posts, featured: ${featured.name}`);
