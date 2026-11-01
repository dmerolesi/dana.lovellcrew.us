// Settings and recipe storage.
// Recipes live either on this device only, or in a GitHub repository so a family
// can share one collection and add recipes for each other from anywhere.

const KEY = {
  settings: 'sbs.settings',
  recipes: 'sbs.recipes',
  cache: 'sbs.cache',
  storage: 'sbs.storage',
  timers: 'sbs.timers',
  progress: 'sbs.progress',
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing or storage full: the app still works for this visit.
  }
}

export const DEFAULT_SETTINGS = {
  cookName: '',
  theme: 'dark',
  font: 'atkinson',
  textSize: 48,
  letterSpacing: 0,
  wordSpacing: 0,
  lineHeight: 1.5,
  autoRead: true,
  speechRate: 0.85,
  voiceURI: '',
  highlightWords: true,
  voiceCommands: false,
  checkAlert: true,
  flashAlerts: true,
  showEditing: true,
  keepAwake: true,
};

export const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...readJSON(KEY.settings, {}) });
export const saveSettings = (s) => writeJSON(KEY.settings, s);
export const loadTimers = () => readJSON(KEY.timers, []);
export const saveTimers = (t) => writeJSON(KEY.timers, t);
export const loadProgress = () => readJSON(KEY.progress, {});
export const saveProgress = (p) => writeJSON(KEY.progress, p);

export const DEFAULT_STORAGE = { mode: 'local', owner: '', repo: '', branch: 'main', path: 'recipes.json', token: '' };
export const loadStorageConfig = () => ({ ...DEFAULT_STORAGE, ...readJSON(KEY.storage, {}) });
export const saveStorageConfig = (c) => writeJSON(KEY.storage, c);

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function base64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function normalize(data) {
  const list = Array.isArray(data) ? data : data?.recipes;
  return Array.isArray(list) ? list.filter((r) => r && r.id && r.title) : [];
}

class LocalStore {
  label = 'this device only';
  canEdit = true;
  async load() {
    return readJSON(KEY.recipes, []);
  }
  async apply(change) {
    const next = change(readJSON(KEY.recipes, []));
    writeJSON(KEY.recipes, next);
    return next;
  }
}

class GitHubStore {
  constructor(cfg) {
    this.cfg = cfg;
    this.label = `GitHub (${cfg.owner}/${cfg.repo})`;
    this.canEdit = Boolean(cfg.token);
  }

  get apiUrl() {
    const { owner, repo, path } = this.cfg;
    const cleanPath = path.split('/').map(encodeURIComponent).join('/');
    return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${cleanPath}`;
  }

  headers() {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  async fetchFile() {
    const res = await fetch(`${this.apiUrl}?ref=${encodeURIComponent(this.cfg.branch)}`, { headers: this.headers(), cache: 'no-store' });
    if (res.status === 404) return { recipes: [], sha: null };
    if (res.status === 401 || res.status === 403) throw new Error('GitHub did not accept the access key. Check that it has not expired and can read and write this repository.');
    if (!res.ok) throw new Error(`GitHub answered with an error (${res.status}).`);
    const file = await res.json();
    return { recipes: normalize(JSON.parse(base64ToUtf8(file.content))), sha: file.sha };
  }

  async load() {
    if (this.cfg.token) return (await this.fetchFile()).recipes;
    // No key on this device: read the public file directly. GitHub may take a few minutes to show new changes this way.
    const { owner, repo, branch, path } = this.cfg;
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path}?v=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 404) throw new Error('Could not find the recipe file. If the repository is private, this device needs an access key.');
    if (!res.ok) throw new Error(`Could not load recipes (${res.status}).`);
    return normalize(await res.json());
  }

  // Always starts from the newest copy on GitHub, so two people saving at once don't erase each other's recipes.
  async apply(change, message = 'Update recipes') {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { recipes, sha } = await this.fetchFile();
      const next = change(recipes);
      const body = {
        message,
        content: utf8ToBase64(JSON.stringify({ recipes: next }, null, 2) + '\n'),
        branch: this.cfg.branch,
      };
      if (sha) body.sha = sha;
      const res = await fetch(this.apiUrl, { method: 'PUT', headers: this.headers(), body: JSON.stringify(body) });
      if (res.ok) return next;
      if (res.status !== 409 && res.status !== 422) {
        if (res.status === 401 || res.status === 403 || res.status === 404) throw new Error('GitHub did not let this device save. The access key needs permission to change this repository.');
        throw new Error(`Could not save to GitHub (${res.status}).`);
      }
    }
    throw new Error('Someone else was saving at the same time. Please try again.');
  }
}

export function makeStore(cfg = loadStorageConfig()) {
  if (cfg.mode === 'github' && cfg.owner && cfg.repo) return new GitHubStore(cfg);
  return new LocalStore();
}

// Keeps the last recipes seen, so cooking still works if the wifi drops.
export const loadCachedRecipes = (where) => {
  const cached = readJSON(KEY.cache, null);
  return cached && cached.where === where ? cached : null;
};
export const cacheRecipes = (recipes, where) => writeJSON(KEY.cache, { recipes, where, at: Date.now() });

export function exportRecipes(recipes) {
  const blob = new Blob([JSON.stringify({ recipes }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'recipes.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function readRecipeFile(file) {
  return normalize(JSON.parse(await file.text()));
}

// A setup link carries where the recipes live (never the access key) and a few device choices.
export function makeSetupLink(cfg, extras) {
  const payload = { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, path: cfg.path, ...extras };
  const url = new URL(location.href);
  url.hash = 'kitchen=' + utf8ToBase64(JSON.stringify(payload));
  return url.toString();
}

export function readSetupLink() {
  const m = location.hash.match(/kitchen=([^&]+)/);
  if (!m) return null;
  try {
    return JSON.parse(base64ToUtf8(decodeURIComponent(m[1])));
  } catch {
    return null;
  }
}
