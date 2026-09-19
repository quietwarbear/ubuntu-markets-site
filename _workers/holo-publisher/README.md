# holo-publisher

Cloudflare Worker that turns an approved Holo SEO post into a **pull request**
on this repo. Nothing reaches ubuntu-markets.org until someone merges.

```
Holo (approve) ──webhook, HMAC-signed──▶ Worker ──GitHub API──▶ branch holo/<slug> + PR
                                                                      │ merge
                                                                      ▼
                                             GitHub Pages + journal rebuild (on journal-posts.json change)
```

For each `article.published` / `article.updated` it writes, on `holo/<slug>`:

- `blog/kindred/<slug>.html` — the Village Journal article template (same CSS,
  nav, OG tags, Article JSON-LD, "Plan your gathering" CTA). Holo's HTML is
  sanitized to an allowlist; scripts, frames, event handlers and `javascript:`
  links are dropped, images must be https.
- `journal-posts.json` — entry at the top (dated from Holo's `publishedAt`; a
  future date queues it until the daily rebuild on that date).
- `sitemap.xml` — one line, updated in place on republish.

A second delivery for the same slug updates the open PR instead of opening a
new one. Holo test pings return 200 without touching GitHub. Bad signatures get
401 (Holo won't retry); GitHub errors get 502 (Holo retries with backoff).

## One-time setup

You need a Cloudflare login for the **Ubuntu Village** account (not HGP) and
admin on `quietwarbear/ubuntu-markets-site`.

1. **GitHub token.** github.com → Settings → Developer settings → Fine-grained
   tokens → Generate. Repository access: *only* `ubuntu-markets-site`.
   Permissions: **Contents** read & write, **Pull requests** read & write.
2. **Deploy.**
   ```bash
   cd _workers/holo-publisher
   npx wrangler login          # pick the Ubuntu Village account
   npx wrangler deploy         # prints https://holo-publisher.<subdomain>.workers.dev
   npx wrangler secret put GITHUB_TOKEN
   ```
3. **Holo.** SEO → publishing integrations → **Webhook** → paste the
   workers.dev URL → **HMAC Signature** → Connect. Copy the secret it shows
   once, then:
   ```bash
   npx wrangler secret put HOLO_WEBHOOK_SECRET
   ```
   Back in Holo, **Send test** — it should succeed (2xx).

From then on: approve a post in Holo → a PR appears here → review the claims →
merge.

## Tests

```bash
node --test _workers/holo-publisher/test/publisher.test.mjs
```

No dependencies. Covers sanitizing, the page template, journal/sitemap upserts
against the real repo files, HMAC verification, and the full webhook → branch →
PR flow against a fake GitHub.

This folder starts with `_`, so GitHub Pages (Jekyll) does not publish it.
