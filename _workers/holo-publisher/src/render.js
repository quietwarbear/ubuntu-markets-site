// Turns a Holo SEO article into a Village Journal page, plus the matching
// journal-posts.json entry and sitemap line. Pure functions: no network.

export const SITE = "https://ubuntu-markets.org";
export const APP = "kindred";
const DEFAULT_OG_IMAGE = `${SITE}/assets/kindred-preview.png`;
const CTA_URL = "https://www.heykindred.org/reunion/start";

const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

// ---- Slug, dates, paths ----------------------------------------------------

export function normalizeSlug(slug, title) {
  const clean = (value) =>
    String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100)
      .replace(/-+$/g, "");
  return clean(slug) || clean(title) || "untitled";
}

export function publishedDate(publishedAt, now = new Date()) {
  const parsed = publishedAt ? new Date(publishedAt) : now;
  const date = Number.isNaN(parsed.getTime()) ? now : parsed;
  return date.toISOString().slice(0, 10);
}

export const articlePath = (slug) => `blog/${APP}/${slug}.html`;
export const articleUrl = (slug) => `${SITE}/${articlePath(slug)}`;

const longDate = (isoDate) =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

// ---- HTML sanitizing --------------------------------------------------------
// Allowlist: anything not listed is dropped (its text stays, the tag goes).
// This last pass is the real guard; the first pass only removes the *contents*
// of elements whose text should never appear at all.

const ALLOWED_TAGS = new Set([
  "p", "h2", "h3", "h4", "ul", "ol", "li", "strong", "em", "b", "i", "a",
  "blockquote", "code", "pre", "br", "hr", "img", "figure", "figcaption",
  "table", "thead", "tbody", "tr", "th", "td",
]);
const VOID_TAGS = new Set(["br", "hr", "img"]);
const DROP_WITH_CONTENT = [
  "script", "style", "iframe", "object", "embed", "noscript", "template",
  "svg", "math", "form", "textarea", "select", "head", "title",
];

function safeUrl(value, { allowRelative, allowMailto, httpsOnly }) {
  const url = value.trim();
  if (/^https:\/\//i.test(url)) return true;
  if (!httpsOnly && /^http:\/\//i.test(url)) return true;
  if (allowMailto && /^mailto:/i.test(url)) return true;
  if (allowRelative && (/^\/(?!\/)/.test(url) || url.startsWith("#"))) return true;
  return false;
}

function keepAttributes(tag, raw) {
  const kept = [];
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = attrRe.exec(raw))) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (tag === "a" && name === "href" && safeUrl(value, { allowRelative: true, allowMailto: true })) {
      kept.push(`href="${esc(value.trim())}"`);
    } else if (tag === "img" && name === "src" && safeUrl(value, { httpsOnly: true })) {
      kept.push(`src="${esc(value.trim())}"`);
    } else if (tag === "img" && name === "alt") {
      kept.push(`alt="${esc(value)}"`);
    } else if ((tag === "th" || tag === "td") && (name === "colspan" || name === "rowspan") && /^\d{1,2}$/.test(value)) {
      kept.push(`${name}="${value}"`);
    }
  }
  if (tag === "a" && kept.some((attr) => attr.startsWith('href="http'))) kept.push('rel="noopener"');
  if (tag === "img") kept.push('loading="lazy"');
  return kept.length ? ` ${kept.join(" ")}` : "";
}

export function sanitizeHtml(html) {
  let out = String(html ?? "").replace(/<!--[\s\S]*?-->/g, "");
  let previous;
  do {
    previous = out;
    for (const tag of DROP_WITH_CONTENT) {
      out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "");
      out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), "");
    }
  } while (out !== previous);

  return out.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (full, rawName, rawAttrs) => {
    let tag = rawName.toLowerCase();
    if (tag === "h1") tag = "h2"; // the page template owns the one <h1>
    if (!ALLOWED_TAGS.has(tag)) return "";
    if (full.startsWith("</")) return VOID_TAGS.has(tag) ? "" : `</${tag}>`;
    return `<${tag}${keepAttributes(tag, rawAttrs)}>`;
  });
}

const textOf = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

// Holo's body may open by repeating the title; the template already shows it.
function dropLeadingTitle(body, title) {
  const match = body.match(/^\s*<h2>([\s\S]*?)<\/h2>/);
  if (match && textOf(match[1]).toLowerCase() === String(title).trim().toLowerCase()) {
    return body.slice(match[0].length);
  }
  return body;
}

export function readMinutes(bodyHtml) {
  const words = textOf(bodyHtml).split(" ").filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

// ---- Page, journal entry, sitemap ------------------------------------------

export function renderArticle(article, { slug, date }) {
  const title = String(article.title).trim();
  const description = String(article.metaDescription || article.excerpt || "").trim();
  const dek = String(article.excerpt || article.metaDescription || "").trim();
  const url = articleUrl(slug);
  const image = safeUrl(String(article.featuredImage || ""), { httpsOnly: true })
    ? String(article.featuredImage).trim()
    : DEFAULT_OG_IMAGE;
  const body = dropLeadingTitle(sanitizeHtml(article.contentHtml), title);
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    datePublished: date,
    author: { "@type": "Organization", name: "Kindred" },
    publisher: { "@type": "Organization", name: "Ubuntu Markets", url: `${SITE}/` },
    mainEntityOfPage: url,
  }).replaceAll("<", "\\u003c"); // no "<" at all inside the script element

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(article.metaTitle || title)} — Kindred Journal</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(url)}">
  <link rel="icon" href="/icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&amp;family=Outfit:wght@300;400;500;600&amp;display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/blog/article.css">
  <style>:root { --accent: #2a9bad; }</style>
  <meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(image)}">
  <script type="application/ld+json">${jsonLd}</script>
</head>
<body>
  <nav class="site-nav"><a class="brand" href="/">Ubuntu Markets</a><div class="site-nav-links"><a href="/blog/">Journal</a><a href="/#products">Products</a><a href="https://www.heykindred.org">Kindred</a></div></nav>
  <main class="article-shell">
    <p class="app-label">Kindred · Journal</p>
    <h1>${esc(title)}</h1>
${dek ? `    <p class="dek">${esc(dek)}</p>\n` : ""}    <p class="meta"><time datetime="${date}">${longDate(date)}</time> · ${readMinutes(body)} minute read</p>
    <article class="article-body">
${body.trim()}

      <section class="product-cta"><h2>Plan the gathering where your family already is.</h2><p>Kindred is invitation-only: relatives RSVP from a private link without creating an account, and the plan, sign-ups, photos, and stories stay together. No public profiles, no ads, no data sales.</p><a class="button" href="${CTA_URL}">Plan your gathering</a></section>
    </article>
    <a class="back" href="/blog/">← Back to the Village Journal</a>
  </main>
  <footer>Built for the village · <a href="https://www.heykindred.org">Visit Kindred</a></footer>
</body>
</html>
`;
}

export function journalEntry(article, { slug, date }) {
  return {
    app: APP,
    title: String(article.title).trim(),
    excerpt: String(article.excerpt || article.metaDescription || "").trim(),
    url: articleUrl(slug),
    published: date,
  };
}

export function upsertJournal(jsonText, entry) {
  const data = JSON.parse(jsonText);
  const posts = Array.isArray(data.posts) ? data.posts : [];
  data.posts = [entry, ...posts.filter((post) => post.url !== entry.url)];
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function upsertSitemap(xml, loc, date) {
  const line = `  <url><loc>${loc}</loc><lastmod>${date}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>\n`;
  const existing = new RegExp(`^[^\\n]*<loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</loc>[^\\n]*\\n`, "m");
  if (existing.test(xml)) return xml.replace(existing, line);
  const firstAppPost = xml.indexOf(`  <url><loc>${SITE}/blog/${APP}/`);
  const at = firstAppPost !== -1 ? firstAppPost : xml.indexOf("</urlset>");
  if (at === -1) throw new Error("sitemap.xml has no </urlset>");
  return xml.slice(0, at) + line + xml.slice(at);
}
