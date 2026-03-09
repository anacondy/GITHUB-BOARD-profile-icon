import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Github,
  GitCommit,
  Monitor,
  Calendar,
  Key,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// --- UTILS ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Escape a string so it is safe for use in a RegExp */
function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split `text` around all case-insensitive occurrences of `query` and return
 * an array of React nodes where matches are wrapped in a green <mark> span.
 * Safe against XSS – no dangerouslySetInnerHTML used.
 *
 * When split() is called with a capturing group, the captured text appears at
 * odd indices (1, 3, 5, …) in the result array, so we use index parity to
 * identify matches instead of re-testing with a global regex (which would
 * misfire due to lastIndex advancing on each .test() call).
 */
function HighlightText({
  text,
  query,
}: {
  text: string;
  query: string;
}): ReactNode {
  if (!query) return text;
  const regex = new RegExp(`(${escapeRegExp(query)})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="bg-transparent text-green-400 font-bold not-italic"
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

const DAY_IN_MS = 86_400_000;

type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  homepage: string | null;
  has_pages: boolean;
  stargazers_count: number;
  language: string | null;
  updated_at: string;
  default_branch: string;
};

type UserProfile = {
  login: string;
  avatar_url: string;
  name: string | null;
  public_repos: number;
};

type NotificationType = "success" | "error" | "info";

type AppState = {
  user: UserProfile | null;
  repos: GitHubRepo[];
  lastSyncedAt: number | null;
  token: string | null;
};

// --- API ---
async function fetchUserProfile(username: string, token: string | null) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  // If token is present, we prefer /user endpoint to verify identity
  const url = token
    ? "https://api.github.com/user"
    : `https://api.github.com/users/${encodeURIComponent(username)}`;

  const res = await fetch(url, { headers });

  if (!res.ok) {
    if (res.status === 401) throw new Error("Invalid Personal Access Token.");
    if (res.status === 404) throw new Error("GitHub user not found.");
    if (res.status === 403)
      throw new Error("API rate limit exceeded or scope missing.");
    throw new Error("Failed to connect to GitHub.");
  }

  return (await res.json()) as UserProfile;
}

async function fetchUserRepos(username: string, token: string | null) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  // Fetch up to 100 repos sorted by updated date
  const res = await fetch(
    `https://api.github.com/users/${encodeURIComponent(
      username
    )}/repos?sort=updated&per_page=100&type=all`,
    { headers }
  );

  if (!res.ok) {
    throw new Error("Failed to fetch repositories.");
  }

  return (await res.json()) as GitHubRepo[];
}

// --- COMPONENTS ---

function NotificationToast({
  message,
  type,
  onClose,
}: {
  message: string;
  type: NotificationType;
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      className={cn(
        "fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded border bg-black/90 px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur-sm md:bottom-8 md:right-8",
        type === "success"
          ? "border-green-500/30 text-green-400"
          : type === "error"
          ? "border-red-500/30 text-red-400"
          : "border-neutral-700 text-neutral-300"
      )}
    >
      {type === "success" && <CheckCircle2 className="h-5 w-5" />}
      {type === "error" && <AlertCircle className="h-5 w-5" />}
      {type === "info" && <Loader2 className="h-5 w-5 animate-spin" />}
      <span className="uppercase tracking-wider">{message}</span>
    </motion.div>
  );
}

export function App() {
  // --- STATE ---
  const [usernameInput, setUsernameInput] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [appState, setAppState] = useState<AppState>(() => {
    try {
      const stored = localStorage.getItem("repo-vault-state");
      return stored
        ? (JSON.parse(stored) as AppState)
        : { user: null, repos: [], lastSyncedAt: null, token: null };
    } catch {
      return { user: null, repos: [], lastSyncedAt: null, token: null };
    }
  });

  const [isLoading, setIsLoading] = useState(false);
  const [notification, setNotification] = useState<{
    message: string;
    type: NotificationType;
  } | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [readmeContent, setReadmeContent] = useState<string | null>(null);
  const [readmeLoading, setReadmeLoading] = useState(false);
  const [nextSyncIn, setNextSyncIn] = useState<string>("--h --m");

  const searchInputRef = useRef<HTMLInputElement>(null);

  // --- HELPERS ---
  const showNotification = useCallback(
    (message: string, type: NotificationType) => {
      setNotification({ message, type });
    },
    []
  );

  const saveState = useCallback((newState: AppState) => {
    setAppState(newState);
    try {
      localStorage.setItem("repo-vault-state", JSON.stringify(newState));
    } catch {
      // Ignore storage errors (e.g. private browsing quota)
    }
  }, []);

  // --- ACTIONS ---
  const connectToGitHub = async (e?: FormEvent) => {
    e?.preventDefault();
    const userToTry = usernameInput.trim() || "octocat";
    const tokenToTry = tokenInput.trim() || null;

    setIsLoading(true);
    showNotification("Connecting to GitHub...", "info");

    try {
      // Verify user first
      const userProfile = await fetchUserProfile(userToTry, tokenToTry);

      // If token provided, use the authenticated user's login, otherwise use input
      const confirmedUsername = userProfile.login;

      // Fetch repos
      const repos = await fetchUserRepos(confirmedUsername, tokenToTry);

      const newState: AppState = {
        user: userProfile,
        repos,
        lastSyncedAt: Date.now(),
        token: tokenToTry, // Store token in state (persisted to localStorage)
      };

      saveState(newState);
      setUsernameInput("");
      setTokenInput("");
      showNotification(`Connected as ${userProfile.login}`, "success");
    } catch (error) {
      console.error(error);
      showNotification(
        error instanceof Error ? error.message : "Connection failed",
        "error"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const syncData = useCallback(async () => {
    if (!appState.user) return;

    try {
      const repos = await fetchUserRepos(appState.user.login, appState.token);
      const newState = {
        ...appState,
        repos,
        lastSyncedAt: Date.now(),
      };
      saveState(newState);
    } catch (err) {
      console.error("Auto-sync failed:", err);
    }
  }, [appState, saveState]);

  const openRepoDetail = async (repo: GitHubRepo) => {
    setSelectedRepo(repo);
    setReadmeLoading(true);
    setReadmeContent(null);

    try {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.raw+json",
      };
      if (appState.token) {
        headers.Authorization = `Bearer ${appState.token}`;
      }

      const res = await fetch(
        `https://api.github.com/repos/${repo.full_name}/readme`,
        { headers }
      );

      if (!res.ok) throw new Error("No README found");
      const text = await res.text();
      setReadmeContent(text);
    } catch {
      setReadmeContent("README unavailable for this repository.");
    } finally {
      setReadmeLoading(false);
    }
  };

  // --- EFFECTS ---

  // Keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Auto-sync loop
  useEffect(() => {
    if (!appState.user) return;
    const interval = setInterval(syncData, DAY_IN_MS);
    return () => clearInterval(interval);
  }, [appState.user, syncData]);

  // Countdown timer
  useEffect(() => {
    const updateCountdown = () => {
      if (!appState.lastSyncedAt) return;
      const now = Date.now();
      const nextSync = appState.lastSyncedAt + DAY_IN_MS;
      const diff = nextSync - now;

      if (diff <= 0) {
        setNextSyncIn("Syncing now...");
        return;
      }

      const h = Math.floor(diff / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setNextSyncIn(`${h}h ${m}m`);
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 60000);
    return () => clearInterval(timer);
  }, [appState.lastSyncedAt]);

  // --- RENDER HELPERS ---
  const filteredRepos = useMemo(() => {
    if (!searchQuery) return appState.repos;
    const q = searchQuery.toLowerCase();
    return appState.repos.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q) ||
        (r.language || "").toLowerCase().includes(q)
    );
  }, [appState.repos, searchQuery]);

  const getPagesUrl = (repo: GitHubRepo) => {
    if (repo.homepage && repo.homepage.startsWith("http")) return repo.homepage;
    if (repo.has_pages)
      return `https://${repo.full_name.split("/")[0]}.github.io/${repo.name}/`;
    return null;
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans selection:bg-white selection:text-black">
      {/* Background Texture */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.08),transparent_40%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,rgba(0,0,0,0.8)_100%)]" />
        <div className="absolute inset-0 opacity-[0.03] bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
        {/* Grid lines */}
        <div
          className="absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.1) 1px, transparent 1px)",
            backgroundSize: "4rem 4rem",
          }}
        />
      </div>

      <main className="relative z-10 mx-auto max-w-7xl px-6 py-12 md:px-12 lg:px-16">
        {/* Header Section */}
        <motion.header
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "circOut" }}
          className="mb-16 space-y-8"
        >
          <div className="flex items-start justify-between">
            <div className="space-y-4">
              <p className="text-xs font-bold uppercase tracking-[0.4em] text-neutral-500">
                Repo Vault Archive
              </p>
              <h1 className="font-['Bebas_Neue',sans-serif] text-7xl uppercase leading-[0.85] tracking-tight text-white md:text-9xl lg:text-[10rem]">
                The Source
                <br />
                <span className="text-neutral-500">Of Your GitHub</span>
              </h1>
            </div>
            {appState.user && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="hidden md:block"
              >
                <img
                  src={appState.user.avatar_url}
                  alt={appState.user.login}
                  className="h-24 w-24 rounded-full border border-neutral-800 bg-neutral-900 object-cover opacity-80 grayscale transition hover:grayscale-0"
                  loading="lazy"
                  decoding="async"
                />
              </motion.div>
            )}
          </div>

          <p className="max-w-2xl text-sm font-medium uppercase leading-relaxed tracking-[0.15em] text-neutral-400">
            {appState.user
              ? `Viewing ${appState.repos.length} repositories for @${appState.user.login}.`
              : "Connect your account to explore repositories, readmes, live pages, and action pipelines in a monochrome interface."}
          </p>
        </motion.header>

        {/* Controls Section */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="mb-12 grid gap-6 border-y border-neutral-800 py-8 lg:grid-cols-[1.5fr_1fr]"
        >
          {/* Connection Form */}
          <form
            onSubmit={connectToGitHub}
            className="flex flex-col gap-4 md:flex-row"
          >
            <div className="relative flex-1 group">
              <div className="absolute inset-y-0 left-3 flex items-center text-neutral-600">
                <Github className="h-4 w-4" />
              </div>
              <input
                type="text"
                placeholder="GitHub Username"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="h-12 w-full rounded-none border border-neutral-800 bg-black/40 pl-10 pr-4 text-xs font-bold uppercase tracking-[0.1em] text-white outline-none transition placeholder:text-neutral-700 focus:border-white focus:bg-black group-hover:border-neutral-600"
              />
            </div>
            <div className="relative flex-[1.5] group">
              <div className="absolute inset-y-0 left-3 flex items-center text-neutral-600">
                <Key className="h-4 w-4" />
              </div>
              <input
                type="password"
                placeholder="Personal Access Token (Optional)"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                autoComplete="off"
                className="h-12 w-full rounded-none border border-neutral-800 bg-black/40 pl-10 pr-4 text-xs font-bold uppercase tracking-[0.1em] text-white outline-none transition placeholder:text-neutral-700 focus:border-white focus:bg-black group-hover:border-neutral-600"
              />
            </div>
            <button
              disabled={isLoading}
              type="submit"
              className="h-12 whitespace-nowrap border border-white bg-white px-8 text-xs font-bold uppercase tracking-[0.2em] text-black transition hover:bg-neutral-200 disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Connect"
              )}
            </button>
          </form>

          {/* Search & Status */}
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-end">
            <div className="relative flex-1 md:max-w-xs group">
              <div className="absolute inset-y-0 left-3 flex items-center text-neutral-600">
                <Search className="h-4 w-4" />
              </div>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search Repos (Ctrl+K)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="h-12 w-full rounded-none border border-neutral-800 bg-black/40 pl-10 pr-4 text-xs font-bold uppercase tracking-[0.1em] text-white outline-none transition placeholder:text-neutral-700 focus:border-white focus:bg-black group-hover:border-neutral-600"
              />
            </div>
            <div className="hidden text-right text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-600 lg:block">
              <p>Next Sync: {nextSyncIn}</p>
              <p className="mt-1">
                {filteredRepos.length < appState.repos.length
                  ? `${filteredRepos.length} of ${appState.repos.length} repos`
                  : "Secure Connection"}
              </p>
            </div>
          </div>
        </motion.section>

        {/* Repository List */}
        <section className="min-h-[40vh]">
          {appState.repos.length === 0 && !isLoading ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Github className="mb-4 h-12 w-12 text-neutral-800" />
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-neutral-600">
                No repositories found
              </p>
              <p className="mt-2 text-xs text-neutral-700">
                Connect a GitHub account to view projects
              </p>
            </div>
          ) : filteredRepos.length === 0 && searchQuery ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <Search className="mb-4 h-12 w-12 text-neutral-800" />
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-neutral-600">
                No results for &ldquo;{searchQuery}&rdquo;
              </p>
              <p className="mt-2 text-xs text-neutral-700">
                Try a different name, language, or description
              </p>
            </div>
          ) : (
            <motion.ul
              layout
              className="divide-y divide-neutral-900 border-b border-neutral-900"
            >
              <AnimatePresence>
                {filteredRepos.map((repo, i) => (
                  <motion.li
                    layout
                    key={repo.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.8) }}
                    className="group grid gap-6 py-8 transition md:grid-cols-[2fr_1fr_auto] md:items-start hover:bg-white/[0.02]"
                  >
                    {/* Main Info */}
                    <div className="space-y-2">
                      <button
                        onClick={() => openRepoDetail(repo)}
                        className="text-left font-['Bebas_Neue',sans-serif] text-4xl uppercase leading-none tracking-wide text-neutral-300 transition group-hover:text-white md:text-5xl"
                      >
                        <HighlightText
                          text={repo.name}
                          query={searchQuery}
                        />
                      </button>
                      <p className="line-clamp-2 max-w-xl text-sm leading-relaxed text-neutral-500 transition group-hover:text-neutral-400">
                        <HighlightText
                          text={repo.description || "No description provided."}
                          query={searchQuery}
                        />
                      </p>
                    </div>

                    {/* Metadata */}
                    <div className="space-y-1 text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-600">
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-neutral-700" />
                        <HighlightText
                          text={repo.language || "Unknown"}
                          query={searchQuery}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <GitCommit className="h-3 w-3" />
                        {repo.default_branch}
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3 w-3" />
                        {formatDate(repo.updated_at)}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-3 self-center md:justify-end">
                      {getPagesUrl(repo) && (
                        <a
                          href={getPagesUrl(repo)!}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="flex items-center gap-2 border border-neutral-800 bg-black/50 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400 transition hover:border-white hover:text-white"
                        >
                          <Monitor className="h-3 w-3" />
                          Live
                        </a>
                      )}
                      <a
                        href={`${repo.html_url}/actions`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex items-center gap-2 border border-neutral-800 bg-black/50 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400 transition hover:border-white hover:text-white"
                      >
                        Actions
                      </a>
                      <a
                        href={repo.html_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex items-center gap-2 border border-neutral-800 bg-black/50 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400 transition hover:border-white hover:text-white"
                      >
                        Repo
                      </a>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </motion.ul>
          )}
        </section>
      </main>

      {/* Slide-over Panel */}
      <AnimatePresence>
        {selectedRepo && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedRepo(null)}
              className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl border-l border-neutral-800 bg-black shadow-2xl"
              aria-label={`Details for ${selectedRepo.name}`}
              role="complementary"
            >
              <div className="flex h-full flex-col">
                <div className="flex items-start justify-between border-b border-neutral-800 p-8">
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-500">
                      Repo Details
                    </p>
                    <h2 className="font-['Bebas_Neue',sans-serif] text-6xl uppercase leading-[0.8] text-white">
                      {selectedRepo.name}
                    </h2>
                  </div>
                  <button
                    onClick={() => setSelectedRepo(null)}
                    aria-label="Close panel"
                    className="border border-neutral-700 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400 transition hover:border-white hover:text-white"
                  >
                    Close
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-8">
                  {readmeLoading ? (
                    <div className="flex h-full flex-col items-center justify-center space-y-4 text-neutral-600">
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <p className="text-xs font-bold uppercase tracking-[0.2em]">
                        Loading Readme...
                      </p>
                    </div>
                  ) : (
                    <div className="prose prose-invert max-w-none">
                      <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-neutral-300">
                        {readmeContent || "No README available."}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Notification Toast */}
      <AnimatePresence>
        {notification && (
          <NotificationToast
            message={notification.message}
            type={notification.type}
            onClose={() => setNotification(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
