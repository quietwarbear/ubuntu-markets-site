// Holo SEO webhook → pull request on ubuntu-markets-site.
//
// Holo POSTs `article.published` / `article.updated` when a post is approved
// (docs.tryholo.ai/seo/seo-webhooks). This Worker verifies the HMAC signature,
// renders the article into the Village Journal template, and opens (or
// updates) a pull request. Nothing reaches the live site until a person merges.
//
// Secrets (wrangler secret put): HOLO_WEBHOOK_SECRET, GITHUB_TOKEN
// Vars (wrangler.toml): GITHUB_REPO, BASE_BRANCH

import { GitHub } from "./github.js";
import {
  articlePath,
  articleUrl,
  journalEntry,
  normalizeSlug,
  publishedDate,
  renderArticle,
  upsertJournal,
  upsertSitemap,
} from "./render.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifySignature(rawBody, header, secret) {
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  return constantTimeEqual(expected, header.slice("sha256=".length).toLowerCase());
}

function pullRequestBody(article, { slug, date, event }) {
  const lines = [
    `From Holo (\`${event}\`). Review before merging — nothing is live until this merges.`,
    "",
    `- **Page:** \`${articlePath(slug)}\` → ${articleUrl(slug)}`,
    `- **Journal date:** ${date}${date > new Date().toISOString().slice(0, 10) ? " (queued: the journal lists it from this date)" : ""}`,
    `- **Meta description:** ${article.metaDescription || article.excerpt || "—"}`,
    "",
    "Check before merging: every product claim matches what Kindred actually does.",
  ];
  return lines.join("\n");
}

export async function publish(article, event, env, fetchImpl) {
  const slug = normalizeSlug(article.slug, article.title);
  const date = publishedDate(article.publishedAt);
  const branch = `holo/${slug}`;
  const base = env.BASE_BRANCH || "main";
  const github = new GitHub(env.GITHUB_TOKEN, env.GITHUB_REPO, fetchImpl);

  const baseSha = await github.branchSha(base);
  if (!baseSha) throw new Error(`base branch ${base} not found`);
  const branchSha = await github.branchSha(branch);
  let pullRequest = branchSha ? await github.openPullRequest(branch) : null;
  if (!branchSha) await github.createBranch(branch, baseSha);
  // A leftover branch from an already-merged post restarts from main.
  else if (!pullRequest) await github.resetBranch(branch, baseSha);

  const message = `Holo: ${article.title}`;
  const page = await github.getFile(articlePath(slug), branch);
  await github.putFile(articlePath(slug), renderArticle(article, { slug, date }), {
    branch, message, sha: page?.sha,
  });
  const journal = await github.getFile("journal-posts.json", branch);
  await github.putFile("journal-posts.json", upsertJournal(journal.text, journalEntry(article, { slug, date })), {
    branch, message: `${message} (journal)`, sha: journal.sha,
  });
  const sitemap = await github.getFile("sitemap.xml", branch);
  await github.putFile("sitemap.xml", upsertSitemap(sitemap.text, articleUrl(slug), date), {
    branch, message: `${message} (sitemap)`, sha: sitemap.sha,
  });

  if (!pullRequest) {
    pullRequest = await github.createPullRequest({
      head: branch,
      base,
      title: `Journal (Holo): ${article.title}`,
      body: pullRequestBody(article, { slug, date, event }),
    });
  }
  return { slug, published: date, branch, pullRequest: pullRequest.html_url };
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ error: "POST only" }, 405);
    const rawBody = await request.text();
    // 401 is terminal for Holo (no retries), which is right for a bad secret.
    if (!(await verifySignature(rawBody, request.headers.get("X-Holo-Signature"), env.HOLO_WEBHOOK_SECRET))) {
      return json({ error: "invalid signature" }, 401);
    }
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ error: "invalid JSON" }, 400);
    }
    if (payload.test) return json({ ok: true, test: true });
    if (!["article.published", "article.updated"].includes(payload.event)) {
      return json({ ok: true, ignored: payload.event || null });
    }
    const article = payload.article || {};
    if (!article.title || !article.contentHtml) {
      return json({ error: "article needs title and contentHtml" }, 422);
    }
    try {
      return json({ ok: true, ...(await publish(article, payload.event, env)) });
    } catch (error) {
      // 5xx: Holo retries with backoff, and the branch/PR steps are idempotent.
      console.error(error);
      return json({ error: "publishing failed" }, 502);
    }
  },
};
