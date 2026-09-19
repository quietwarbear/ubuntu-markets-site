// Run: node --test _workers/holo-publisher/test/publisher.test.mjs   (Node 18+, no dependencies)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import worker, { verifySignature } from "../src/index.js";
import {
  normalizeSlug,
  publishedDate,
  renderArticle,
  sanitizeHtml,
  upsertJournal,
  upsertSitemap,
} from "../src/render.js";

const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const repoFile = (name) => readFileSync(path.join(SITE_ROOT, name), "utf8");
const SECRET = "test-holo-secret";

async function sign(body, secret = SECRET) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `sha256=${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const article = {
  id: "a1",
  slug: "Holiday Meal Checklist!",
  title: "A Holiday Meal Checklist for Big Families",
  excerpt: "Plan the table without the group-text chaos.",
  contentHtml: `<h1>A Holiday Meal Checklist for Big Families</h1>
<p>Start with <strong>a headcount</strong>. <a href="https://www.heykindred.org">Kindred</a> helps.</p>
<script>alert(1)</script><iframe src="https://evil.example"></iframe>
<p onclick="steal()">Hover <a href="javascript:alert(1)">here</a>.</p>
<img src="http://insecure.example/x.png" alt="x"><img src="https://cdn.example/y.png" alt="Table">`,
  metaTitle: "Holiday Meal Checklist",
  metaDescription: "A checklist for hosting the holiday meal.",
  featuredImage: "https://cdn.example/hero.png",
  publishedAt: "2026-11-02T15:00:00Z",
};

// ---- sanitizing --------------------------------------------------------------

test("drops scripts, frames, event handlers and javascript: links", () => {
  const out = sanitizeHtml(article.contentHtml);
  assert.doesNotMatch(out, /<script|alert\(1\)|<iframe|evil\.example|onclick|javascript:/i);
  assert.match(out, /<a href="https:\/\/www\.heykindred\.org" rel="noopener">Kindred<\/a>/);
  assert.match(out, /<strong>a headcount<\/strong>/);
});

test("keeps only https images and demotes h1", () => {
  const out = sanitizeHtml(article.contentHtml);
  assert.doesNotMatch(out, /insecure\.example/);
  assert.match(out, /<img src="https:\/\/cdn\.example\/y\.png" alt="Table" loading="lazy">/);
  assert.doesNotMatch(out, /<h1/);
});

test("split-tag tricks cannot reassemble a script", () => {
  const out = sanitizeHtml("<scr<script></script>ipt>alert(2)</scr<style></style>ipt><SCRIPT SRC=x></SCRIPT>");
  assert.doesNotMatch(out, /<script/i);
});

test("unknown tags vanish but their text stays", () => {
  assert.equal(sanitizeHtml("<div><span>kept</span></div>"), "kept");
});

// ---- slug, date, page ----------------------------------------------------

test("normalizes slugs and dates", () => {
  assert.equal(normalizeSlug("Holiday Meal Checklist!", "x"), "holiday-meal-checklist");
  assert.equal(normalizeSlug("", "Café Reunión 2026"), "cafe-reunion-2026");
  assert.equal(publishedDate("2026-11-02T15:00:00Z"), "2026-11-02");
  assert.equal(publishedDate("not a date", new Date("2026-09-18T01:00:00Z")), "2026-09-18");
});

test("renders the Village Journal template without repeating the title", () => {
  const html = renderArticle(article, { slug: "holiday-meal-checklist", date: "2026-11-02" });
  assert.match(html, /<link rel="canonical" href="https:\/\/ubuntu-markets\.org\/blog\/kindred\/holiday-meal-checklist\.html">/);
  assert.match(html, /<time datetime="2026-11-02">November 2, 2026<\/time>/);
  assert.match(html, /<title>Holiday Meal Checklist — Kindred Journal<\/title>/);
  assert.match(html, /og:image" content="https:\/\/cdn\.example\/hero\.png"/);
  assert.equal((html.match(/A Holiday Meal Checklist for Big Families/g) || []).length, 3); // <h1>, og:title, JSON-LD
  assert.match(html, /href="https:\/\/www\.heykindred\.org\/reunion\/start">Plan your gathering</);
  assert.doesNotMatch(html, /<script>alert/);
});

test("JSON-LD cannot close its own script tag", () => {
  const html = renderArticle({ ...article, title: "</script><script>alert(3)</script>" }, { slug: "x", date: "2026-11-02" });
  const ld = html.split('<script type="application/ld+json">')[1].split("</script>")[0];
  assert.doesNotMatch(ld, /<\/script/i);
  assert.doesNotMatch(html, /<script>alert\(3\)/);
});

// ---- journal + sitemap against the real repo files ----------------------------

test("adds the post to the top of the journal and replaces a same-URL entry", () => {
  const entry = { app: "kindred", title: "T", excerpt: "E", url: "https://ubuntu-markets.org/blog/kindred/t.html", published: "2026-11-02" };
  const once = JSON.parse(upsertJournal(repoFile("journal-posts.json"), entry));
  assert.deepEqual(once.posts[0], entry);
  const twice = JSON.parse(upsertJournal(JSON.stringify(once), { ...entry, title: "T2" }));
  assert.equal(twice.posts.filter((p) => p.url === entry.url).length, 1);
  assert.equal(twice.posts[0].title, "T2");
  assert.equal(twice.posts.length, once.posts.length);
});

test("inserts a sitemap line once and updates it on republish", () => {
  const loc = "https://ubuntu-markets.org/blog/kindred/t.html";
  const added = upsertSitemap(repoFile("sitemap.xml"), loc, "2026-11-02");
  assert.equal(added.split(loc).length - 1, 1);
  const updated = upsertSitemap(added, loc, "2026-11-09");
  assert.equal(updated.split(loc).length - 1, 1);
  assert.match(updated, /t\.html<\/loc><lastmod>2026-11-09</);
  assert.match(updated, /<\/urlset>\s*$/);
});

// ---- signature + end-to-end with a fake GitHub ---------------------------------

test("verifies Holo's HMAC signature", async () => {
  const body = '{"x":1}';
  assert.equal(await verifySignature(body, await sign(body), SECRET), true);
  assert.equal(await verifySignature(body, await sign(body, "other"), SECRET), false);
  assert.equal(await verifySignature(body, await sign(body), ""), false);
  assert.equal(await verifySignature(body, null, SECRET), false);
});

function fakeGitHub({ failOn } = {}) {
  const files = new Map([
    ["main:journal-posts.json", repoFile("journal-posts.json")],
    ["main:sitemap.xml", repoFile("sitemap.xml")],
  ]);
  const branches = new Map([["main", "sha-main"]]);
  const pulls = [];
  const calls = [];
  const reply = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status });
  const fetchImpl = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const method = init.method || "GET";
    const route = pathname.replace("/repos/quietwarbear/ubuntu-markets-site", "");
    calls.push(`${method} ${route}`);
    if (failOn && route.startsWith(failOn)) return reply(500, { message: "boom" });
    const body = init.body ? JSON.parse(init.body) : null;
    let m;
    if ((m = route.match(/^\/git\/ref\/heads\/(.+)$/))) return branches.has(m[1]) ? reply(200, { object: { sha: branches.get(m[1]) } }) : reply(404, {});
    if (route === "/git/refs" && method === "POST") {
      const name = body.ref.replace("refs/heads/", "");
      branches.set(name, body.sha);
      for (const [key, value] of files) if (key.startsWith("main:")) files.set(key.replace("main:", `${name}:`), value);
      return reply(201, {});
    }
    if ((m = route.match(/^\/contents\/(.+)$/))) {
      const filePath = m[1];
      if (method === "GET") {
        const key = `${searchParams.get("ref")}:${filePath}`;
        return files.has(key) ? reply(200, { sha: `sha-${key}`, content: Buffer.from(files.get(key)).toString("base64") }) : reply(404, {});
      }
      files.set(`${body.branch}:${filePath}`, Buffer.from(body.content, "base64").toString("utf8"));
      return reply(200, {});
    }
    if (route === "/pulls" && method === "GET") return reply(200, pulls);
    if (route === "/pulls" && method === "POST") {
      const pr = { html_url: `https://github.com/quietwarbear/ubuntu-markets-site/pull/${pulls.length + 100}`, ...body };
      pulls.push(pr);
      return reply(201, pr);
    }
    return reply(404, {});
  };
  return { fetchImpl, files, pulls, calls };
}

const env = { HOLO_WEBHOOK_SECRET: SECRET, GITHUB_TOKEN: "ghp_test", GITHUB_REPO: "quietwarbear/ubuntu-markets-site", BASE_BRANCH: "main" };

async function deliver(payload, { secret = SECRET, github } = {}) {
  const body = JSON.stringify(payload);
  const request = new Request("https://holo-publisher.example/", {
    method: "POST",
    body,
    headers: { "X-Holo-Signature": await sign(body, secret), "Content-Type": "application/json" },
  });
  const realFetch = globalThis.fetch;
  if (github) globalThis.fetch = github.fetchImpl;
  try {
    return await worker.fetch(request, env);
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("a published article becomes a branch, three files and one pull request", async () => {
  const github = fakeGitHub();
  const response = await deliver({ event: "article.published", test: false, article }, { github });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.slug, "holiday-meal-checklist");
  assert.equal(result.published, "2026-11-02");
  assert.match(result.pullRequest, /\/pull\/100$/);
  const page = github.files.get("holo/holiday-meal-checklist:blog/kindred/holiday-meal-checklist.html");
  assert.match(page, /<h1>A Holiday Meal Checklist for Big Families<\/h1>/);
  assert.doesNotMatch(page, /<script>alert|javascript:/);
  assert.match(github.files.get("holo/holiday-meal-checklist:journal-posts.json"), /holiday-meal-checklist\.html/);
  assert.match(github.files.get("holo/holiday-meal-checklist:sitemap.xml"), /holiday-meal-checklist\.html<\/loc><lastmod>2026-11-02/);
  assert.equal(github.files.get("main:journal-posts.json"), repoFile("journal-posts.json"), "main is never written");
});

test("an update to an open post reuses its branch and pull request", async () => {
  const github = fakeGitHub();
  await deliver({ event: "article.published", article }, { github });
  const second = await deliver({ event: "article.updated", article: { ...article, title: "Updated title" } }, { github });
  assert.equal(second.status, 200);
  assert.equal(github.pulls.length, 1);
  assert.match(github.files.get("holo/holiday-meal-checklist:blog/kindred/holiday-meal-checklist.html"), /Updated title/);
});

test("test pings, bad signatures and bad payloads never touch GitHub", async () => {
  const github = fakeGitHub();
  assert.equal((await deliver({ event: "article.published", test: true, article }, { github })).status, 200);
  assert.equal((await deliver({ event: "article.published", article }, { github, secret: "wrong" })).status, 401);
  assert.equal((await deliver({ event: "article.published", article: { title: "x" } }, { github })).status, 422);
  assert.equal((await deliver({ event: "brand.updated" }, { github })).status, 200);
  assert.deepEqual(github.calls, []);
});

test("a GitHub failure returns 502 so Holo retries", async () => {
  const github = fakeGitHub({ failOn: "/contents/" });
  const response = await deliver({ event: "article.published", article }, { github });
  assert.equal(response.status, 502);
});
