// Minimal GitHub REST client for one repository (fine-grained token:
// Contents + Pull requests, read & write, this repo only).

const API = "https://api.github.com";

const toBase64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

const fromBase64 = (b64) => {
  const binary = atob(String(b64).replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

export class GitHub {
  constructor(token, repo, fetchImpl = (...args) => fetch(...args)) {
    if (!token) throw new Error("GITHUB_TOKEN is not set");
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo || "")) throw new Error("GITHUB_REPO must be owner/name");
    this.token = token;
    this.repo = repo;
    this.owner = repo.split("/")[0];
    this.fetch = fetchImpl;
  }

  async request(method, path, body) {
    const response = await this.fetch(`${API}/repos/${this.repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "holo-publisher",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`GitHub ${method} ${path} → ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    return response.status === 204 ? {} : response.json();
  }

  async branchSha(branch) {
    const ref = await this.request("GET", `/git/ref/heads/${branch}`);
    return ref?.object?.sha || null;
  }

  createBranch(branch, sha) {
    return this.request("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha });
  }

  resetBranch(branch, sha) {
    return this.request("PATCH", `/git/refs/heads/${branch}`, { sha, force: true });
  }

  async getFile(path, branch) {
    const file = await this.request("GET", `/contents/${path}?ref=${encodeURIComponent(branch)}`);
    return file ? { sha: file.sha, text: fromBase64(file.content) } : null;
  }

  putFile(path, text, { branch, message, sha }) {
    return this.request("PUT", `/contents/${path}`, {
      message,
      branch,
      content: toBase64(text),
      ...(sha ? { sha } : {}),
    });
  }

  async openPullRequest(branch) {
    const pulls = await this.request("GET", `/pulls?state=open&head=${encodeURIComponent(`${this.owner}:${branch}`)}`);
    return Array.isArray(pulls) && pulls.length ? pulls[0] : null;
  }

  createPullRequest({ head, base, title, body }) {
    return this.request("POST", "/pulls", { head, base, title, body });
  }
}
