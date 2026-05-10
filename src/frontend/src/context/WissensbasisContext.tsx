/**
 * Wissensbasis focus context — shared focus entity_id state.
 *
 * Lives at the chat-page level (and the standalone /wissensbasis page).
 * The CitationChip render arm in AdaptiveCardRenderer reads `setFocus`
 * from this context so a chip click in the answer prose refocuses the
 * side panel on the clicked entity.
 *
 * URL-encoded state: when used inside a Routes-aware tree, the provider
 * keeps `?focus=UUID` in sync with state via the `syncWithUrl` prop.
 * Refreshing the page restores the focus entity. Browser back/forward
 * cycles through prior focus picks.
 *
 * No backend write — focus is per-tab, per-browser. Cross-tab
 * coordination is explicitly out of scope for v1 (P3 of /office-hours).
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';

interface WissensbasisContextValue {
  /** Currently focused entity_id, or null if no focus set. */
  focusEntityId: string | null;
  /** Update the focus. Pass null to clear. */
  setFocus: (entityId: string | null) => void;
  /** Whether the side panel is collapsed (per-browser, localStorage). */
  collapsed: boolean;
  toggleCollapsed: () => void;
}

const WissensbasisContext = createContext<WissensbasisContextValue | null>(null);

const COLLAPSE_STORAGE_KEY = 'reva.wissensbasis.collapsed';

interface ProviderProps {
  children: ReactNode;
  /** When true, mirror state into the `?focus=` URL param. Default true. */
  syncWithUrl?: boolean;
  /** Default collapsed state when no localStorage entry exists. */
  defaultCollapsed?: boolean;
}

export function WissensbasisProvider({
  children,
  syncWithUrl = true,
  defaultCollapsed = false,
}: ProviderProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlFocus = syncWithUrl ? searchParams.get('focus') : null;

  // Initialize from URL when syncWithUrl is true; otherwise null.
  const [focusEntityId, setFocusState] = useState<string | null>(urlFocus);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultCollapsed;
    const stored = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
    return stored === null ? defaultCollapsed : stored === 'true';
  });

  // Keep state in sync with URL changes (back/forward navigation).
  useEffect(() => {
    if (!syncWithUrl) return;
    setFocusState(urlFocus);
  }, [urlFocus, syncWithUrl]);

  const setFocus = (entityId: string | null) => {
    setFocusState(entityId);
    if (!syncWithUrl) return;
    const next = new URLSearchParams(searchParams);
    if (entityId) {
      next.set('focus', entityId);
    } else {
      next.delete('focus');
    }
    // `replace: true` keeps each focus pick from polluting the back stack
    // with one entry per chip click — only explicit navigations push.
    setSearchParams(next, { replace: true });
  };

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      }
      return next;
    });
  };

  const value = useMemo(
    () => ({ focusEntityId, setFocus, collapsed, toggleCollapsed }),
    // setFocus + toggleCollapsed close over searchParams; depending on
    // [searchParams] would re-create them every URL change. Stable
    // identities are good enough since they always read the latest state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusEntityId, collapsed],
  );

  return <WissensbasisContext.Provider value={value}>{children}</WissensbasisContext.Provider>;
}

/**
 * Read the current focus state. Returns a no-op shim when called outside
 * a provider so the AdaptiveCardRenderer's CitationChip arm can render
 * citation chips in non-Wissensbasis surfaces (e.g. the standalone Brain
 * page) — chips just become non-interactive in that case.
 */
export function useWissensbasis(): WissensbasisContextValue {
  const ctx = useContext(WissensbasisContext);
  if (ctx) return ctx;
  return {
    focusEntityId: null,
    setFocus: () => {
      /* no-op outside a provider */
    },
    collapsed: false,
    toggleCollapsed: () => {
      /* no-op */
    },
  };
}
