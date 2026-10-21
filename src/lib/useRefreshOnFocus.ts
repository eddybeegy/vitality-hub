import { useEffect, useRef } from 'react';

// Sweep item 26: the dashboard fetched once at mount and then never again, so a tab
// left open overnight kept showing yesterday's numbers until a manual reload.
// This calls `onRefresh` when the tab becomes visible again or the window regains
// focus. Both events usually fire together on a tab switch, and focus also fires
// on every alt-tab, so refreshes are throttled to one per `minIntervalMs`.
export const FOCUS_REFRESH_MIN_INTERVAL_MS = 60 * 1000;

export function useRefreshOnFocus(
  onRefresh: () => void,
  enabled = true,
  minIntervalMs = FOCUS_REFRESH_MIN_INTERVAL_MS
) {
  // Mount counts as a refresh: the caller has just done its initial fetch.
  const lastRefresh = useRef(Date.now());
  const callback = useRef(onRefresh);
  callback.current = onRefresh;

  useEffect(() => {
    if (!enabled) return;

    const maybeRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastRefresh.current < minIntervalMs) return;
      lastRefresh.current = now;
      callback.current();
    };

    document.addEventListener('visibilitychange', maybeRefresh);
    window.addEventListener('focus', maybeRefresh);
    return () => {
      document.removeEventListener('visibilitychange', maybeRefresh);
      window.removeEventListener('focus', maybeRefresh);
    };
  }, [enabled, minIntervalMs]);
}
