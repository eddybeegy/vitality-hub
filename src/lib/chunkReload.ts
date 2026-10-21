// After a deploy, an open tab still references the old hashed chunk names.
// Loading one of those fails, and the only fix is to reload so the tab picks up
// the new index.html. A short guard window stops a reload loop if the chunk is
// genuinely broken rather than stale.

const RELOAD_KEY = 'vh:chunk-reload-at';
const RELOAD_GUARD_MS = 10_000;

const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Unable to preload CSS/i, // Vite CSS preload
  /Loading (CSS )?chunk [\w-]+ failed/i,
  /'text\/html' is not a valid JavaScript MIME type/i,
];

export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string };
  if (e.name === 'ChunkLoadError') return true;
  const message = typeof err === 'string' ? err : e.message;
  return typeof message === 'string' && CHUNK_ERROR_PATTERNS.some(p => p.test(message));
}

type GuardStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): GuardStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

// Reloads the page unless a chunk-error reload already happened within the guard
// window. Returns true when a reload was triggered.
export function reloadForChunkError(
  storage: GuardStorage | null = defaultStorage(),
  reload: () => void = () => window.location.reload(),
  now: number = Date.now(),
): boolean {
  try {
    const last = Number(storage?.getItem(RELOAD_KEY) ?? 0);
    if (last && now - last < RELOAD_GUARD_MS) return false;
    storage?.setItem(RELOAD_KEY, String(now));
  } catch {
    // Storage unavailable: still reload once; without storage we can't loop-guard,
    // but the guard only matters for a chunk that is broken on the server too.
  }
  reload();
  return true;
}

// Vite fires `vite:preloadError` on window when a dynamic import's preload fails.
// Reloading there catches the stale-chunk case before React ever sees it.
export function installChunkReloadHandler(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForChunkError()) event.preventDefault();
  });
}
