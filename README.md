# Repo Vault Archive

> **Live Site → [https://anacondy.github.io/GITHUB-BOARD-profile-icon/](https://anacondy.github.io/GITHUB-BOARD-profile-icon/)**

A monochrome GitHub portfolio viewer built with React, Vite, Tailwind CSS, and Framer Motion. Connect your GitHub account to browse repositories, view READMEs, and access GitHub Pages and Actions—all from a single, self-contained HTML file.

---

## Features

- 🔍 **Instant search** – Filter repos by name, description, or language with green match highlighting
- 📄 **README viewer** – Slide-over panel with raw README content for any repo
- 🚀 **GitHub Pages links** – Direct links to live sites and Actions pipelines
- 🔐 **Optional PAT support** – Classic and fine-grained personal access tokens for private repos and higher rate limits
- ⚡ **Single-file build** – Everything bundled into one `index.html` via `vite-plugin-singlefile`
- 🔄 **Auto-sync** – Repos re-fetched every 24 hours automatically

---

## Screenshots

| Desktop | Mobile |
|---------|--------|
| Connect your GitHub username (with optional PAT) to load all repos | Fully responsive — works on phones, tablets, and ultra-wide monitors |

---

## Quick Start (Local)

### Prerequisites

- [Node.js](https://nodejs.org/) v20 or newer
- npm (comes with Node.js)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/anacondy/GITHUB-BOARD-profile-icon.git
cd GITHUB-BOARD-profile-icon

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

To build for production:

```bash
npm run build
# Output: dist/index.html  (single self-contained file)
```

---

## GitHub Pages Deployment

Deployment is **fully automated** via GitHub Actions (`.github/workflows/deploy.yml`).

Every push to `main` triggers a build-and-deploy pipeline:

1. Installs Node.js 20 and `npm ci`
2. Runs `npm run build` (Vite + viteSingleFile)
3. Uploads the `dist/` folder as a GitHub Pages artifact
4. Deploys to `https://anacondy.github.io/GITHUB-BOARD-profile-icon/`

> **To enable GitHub Pages:** Go to repository **Settings → Pages → Source** and select **GitHub Actions**.

---

## API Integration Guide

### Without a token (public repos only)

Just enter any GitHub username and click **Connect**. The app uses the public GitHub API (60 req/hour limit).

### With a Personal Access Token (recommended)

A PAT removes rate limits and grants access to private repositories.

**Classic token** (simplest):

1. Go to [GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)](https://github.com/settings/tokens/new)
2. Set an expiry, then tick **`repo`** scope (read-only is fine)
3. Click **Generate token** and copy it
4. Paste the token into the **Personal Access Token** field in the app

**Fine-grained token** (more secure):

1. Go to [GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens](https://github.com/settings/personal-access-tokens/new)
2. Under **Repository access**, choose **All repositories** (or select specific ones)
3. Under **Permissions → Repository permissions**, grant **Contents: Read-only** and **Metadata: Read-only**
4. Generate and paste the token into the app

> ⚠️ The token is stored in `localStorage`. Never share your token or commit it to source code.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Invalid Personal Access Token" | Token is expired or revoked — generate a new one |
| "API rate limit exceeded" | Add a PAT to increase to 5,000 req/hour |
| "GitHub user not found" | Check the username spelling; private accounts are not searchable |
| "Failed to fetch repositories" | Network issue or GitHub outage — check [githubstatus.com](https://www.githubstatus.com) |
| Blank page after deploy | Ensure GitHub Pages source is set to **GitHub Actions** in repo Settings |

---

## Performance

- **Build output**: Single `index.html` — zero external network requests for assets
- **Animations**: Framer Motion with GPU-accelerated transforms for 60 FPS on low-end and 120+ FPS on high-end devices
- **Search**: `useMemo` filter runs synchronously with zero network calls
- **Images**: `loading="lazy"` + `decoding="async"` on avatar images

---

## Security

- All external links use `rel="noreferrer noopener"`
- Search highlight uses React element splitting — **no `dangerouslySetInnerHTML`**
- Inputs use `autoComplete="off"` to prevent credential leakage
- Token stored only in `localStorage` (never sent to any server other than `api.github.com`)

---

## License

[MIT](LICENSE)
