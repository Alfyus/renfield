/**
 * Wissensbasis focus context — shared focus entity_id state.
 *
 * Mounted at the chat-page level (with syncWithUrl=false to keep the
 * chat URL clean) and at the standalone /wissensbasis page (with
 * syncWithUrl=true so refresh + back/forward + shareable URLs work).
 * The CitationChip render arm in AdaptiveCardRenderer reads `setFocus`
 * from this context so a chip click in the answer prose refocuses the
 * side panel on the clicked entity.
 *
 * No backend write — focus is per-tab, per-browser. Cross-tab
 * coordination is explicitly out of scope for v1.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
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
  // Only sample the URL when this provider is configured to sync with it.
  // The chat-page mount uses syncWithUrl=false because chat URLs already
  // encode the conversation; clicking chips shouldn't pollute that bar.
  const urlFocus = syncWithUrl ? searchParams.get('focus') : null;

  const [focusEntityId, setFocusState] = useState<string | null>(urlFocus);

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultCollapsed;
    const stored = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
    return stored === null ? defaultCollapsed : stored === 'true';
  });

  // Keep state in sync with URL changes (back/forward navigation).
  // useState bails out on same-value updates, so this won't loop with
  // the state→URL write below.
  useEffect(() => {
    if (!syncWithUrl) return;
    setFocusState(urlFocus);
  }, [urlFocus, syncWithUrl]);

  const setFocus = useCallback(
    (entityId: string | null) => {
      setFocusState(entityId);
      if (!syncWithUrl) return;
      // Functional setSearchParams: read the LATEST params at call time
      // instead of closing over a snapshot. Closing over `searchParams`
      // would silently drop sibling params (e.g. ?session=) when the
      // closure was created before the user navigated to add them.
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (entityId) {
            next.set('focus', entityId);
          } else {
            next.delete('focus');
          }
          return next;
        },
        // replace: true keeps each chip click out of the back stack —
        // only explicit navigations push, so back/forward feels natural.
        { replace: true },
      );
    },
    [syncWithUrl, setSearchParams],
  );

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ focusEntityId, setFocus, collapsed, toggleCollapsed }),
    [focusEntityId, setFocus, collapsed, toggleCollapsed],
  );

  return <WissensbasisContext.Provider value={value}>{children}</WissensbasisContext.Provider>;
}

/**
 * Read the current focus state.
 *
 * Throws in development when called outside a provider — matches the
 * useAuth / useTheme pattern in this codebase. Catching the misuse at
 * dev-time prevents the silent "chip click does nothing" failure mode
 * the previous shim allowed. In production, returns a no-op shim so
 * citation chips on non-Wissensbasis surfaces (e.g. legacy /brain) at
 * worst render as visually correct but inert pills rather than crashing
 * the page.
 */
export function useWissensbasis(): WissensbasisContextValue {
  const ctx = useContext(WissensbasisContext);
  if (ctx) return ctx;

  if (import.meta.env.DEV) {
    throw new Error(
      'useWissensbasis must be used within a WissensbasisProvider. ' +
        'Mount <WissensbasisProvider> above the component tree (e.g. inside ChatPage ' +
        'or WissensbasisPage). On surfaces that intentionally render chips without ' +
        'focus interactivity, this hook still falls back to a no-op shim in production.',
    );
  }

  return {
    focusEntityId: null,
    setFocus: () => {
      /* no-op outside a provider in production */
    },
    collapsed: false,
    toggleCollapsed: () => {
      /* no-op */
    },
  };
}
