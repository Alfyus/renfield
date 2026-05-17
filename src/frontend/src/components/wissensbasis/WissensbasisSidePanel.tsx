/**
 * WissensbasisSidePanel — chat-page RIGHT-side panel showing the
 * composed A2 (reasoning subgraph) + A4 (focus neighborhood) layout.
 *
 * Interaction mirrors the left nav rail (components/Layout.tsx) but
 * stays IN-FLOW on desktop (the old panel was a `md:flex w-96 shrink-0`
 * flex child; making it `position: fixed` would overlay the chat
 * messages + input — there is no right-side gutter compensation on the
 * chat page, unlike the left rail whose width the page shell reserves):
 *
 *   - Desktop (lg+): an in-flow flex child. Collapsed → a slim w-14
 *     rail showing only a hamburger; the chat column keeps its space.
 *     Clicking the hamburger expands it to w-96 (chat column shrinks
 *     beside it, exactly like the original); the header X collapses
 *     back to the rail. The heavy interactive body is mounted ONLY
 *     when expanded, so the collapsed rail has no off-screen/hidden
 *     tabbables (WCAG 2.4.3 — matches the original's conditional
 *     render). No floating FAB.
 *   - Mobile (<lg): the rail has no room, so a fixed right-edge
 *     hamburger opens a full-height slide-over from the right with a
 *     dimmed backdrop (same pattern as the left nav on mobile). The
 *     sheet is a real modal: scroll lock + focus trap + Esc + initial
 *     focus, and it is unmounted when closed (no hidden tabbables).
 *
 * `collapsed` (from WissensbasisContext) is the single source of truth.
 * A CitationChip click sets the focus entity via the same context.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu, X } from 'lucide-react';

import {
  useFocusQuery,
  useRoleMixQuery,
  useTraceQuery,
} from '../../api/resources/wissensbasis';
import { useWissensbasis } from '../../context/WissensbasisContext';

import { FocusNeighborhood } from './FocusNeighborhood';
import { ReasoningSubgraph } from './ReasoningSubgraph';

const MOBILE_BREAKPOINT_PX = 1024; // Tailwind lg

// Everything Tab can land on — used by the mobile focus trap.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface WissensbasisSidePanelProps {
  sessionId: string | null;
  /**
   * Active routing role for this conversation, e.g. 'release', 'jira'.
   * Drives the A2/A4 mix lookup. Pass null to fall back to the default
   * 60/40 mix.
   */
  role: string | null;
}

export function WissensbasisSidePanel({ sessionId, role }: WissensbasisSidePanelProps) {
  const { t } = useTranslation();
  const { focusEntityId, collapsed, toggleCollapsed } = useWissensbasis();
  const open = !collapsed;

  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT_PX,
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT_PX);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const traceQ = useTraceQuery(sessionId);
  const focusQ = useFocusQuery(focusEntityId);
  const mixQ = useRoleMixQuery(role);
  const mix = mixQ.data ?? { a2: 60, a4: 40, source: 'default' as const, role: null };

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  // The mobile slide-over is a true modal. All of these effects are
  // gated on `isMobile && open` so the desktop in-flow rail is never a
  // focus trap and never captures global keys.
  const mobileSheetOpen = isMobile && open;

  useEffect(() => {
    if (!mobileSheetOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileSheetOpen]);

  useEffect(() => {
    if (mobileSheetOpen) closeBtnRef.current?.focus();
  }, [mobileSheetOpen]);

  useEffect(() => {
    if (!mobileSheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        toggleCollapsed();
        return;
      }
      if (e.key !== 'Tab') return;
      const sheet = sheetRef.current;
      if (!sheet) return;
      const focusables = Array.from(
        sheet.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (active && !sheet.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileSheetOpen, toggleCollapsed]);

  const panelBody = (
    <>
      <div
        className="overflow-y-auto"
        style={{ flexBasis: `${mix.a2}%`, flexGrow: 0, flexShrink: 0 }}
      >
        <SectionHeading
          label={t('wissensbasis.panel.reasoningHeading', 'Reasoning')}
          source={mix.source}
        />
        <ReasoningSubgraph
          trace={traceQ.data?.trace ?? { entities: [], edges: [] }}
          isLoading={traceQ.isLoading}
        />
      </div>

      <div
        className="border-t border-gray-200 dark:border-gray-700 overflow-y-auto"
        style={{ flexBasis: `${mix.a4}%`, flexGrow: 1 }}
      >
        <SectionHeading label={t('wissensbasis.panel.focusHeading', 'Focus')} />
        <FocusNeighborhood
          data={focusQ.data ?? null}
          isLoading={focusQ.isLoading}
          errorMessage={focusQ.errorMessage}
        />
      </div>
    </>
  );

  const headerBar = (
    <header className="flex items-center justify-between h-12 px-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
      <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100 whitespace-nowrap overflow-hidden">
        {t('wissensbasis.panel.heading', 'Wissensbasis')}
      </h2>
      <button
        ref={closeBtnRef}
        type="button"
        onClick={toggleCollapsed}
        className="shrink-0 p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-900
          dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-hidden
          focus:ring-2 focus:ring-primary-500 transition-colors"
        aria-label={t('wissensbasis.panel.collapse', 'Collapse panel')}
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </header>
  );

  return (
    <>
      {/* ---------- Desktop: in-flow flex child (no overlay) ---------- */}
      <aside
        className={`hidden lg:flex flex-col h-full shrink-0 bg-white dark:bg-gray-900
          border-l border-gray-200 dark:border-gray-700 overflow-hidden
          transition-[width] duration-300 ease-out ${collapsed ? 'w-14' : 'w-96'}`}
        aria-label={t('wissensbasis.panel.ariaLabel', 'Wissensbasis composed view')}
        role="complementary"
      >
        {collapsed ? (
          <div className="flex items-center justify-center h-12 border-b border-gray-200 dark:border-gray-700 shrink-0">
            <button
              type="button"
              onClick={toggleCollapsed}
              className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-900
                dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors active:scale-95"
              aria-label={t('wissensbasis.panel.expand', 'Open Wissensbasis panel')}
            >
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <>
            {headerBar}
            {panelBody}
          </>
        )}
      </aside>

      {/* ---------- Mobile: fixed right slide-over (modal) ---------- */}
      {/* Closed → just a fixed right-edge hamburger opener. The sheet
          itself is unmounted while closed, so no off-screen tabbables. */}
      {collapsed && (
        <button
          type="button"
          onClick={toggleCollapsed}
          className="lg:hidden fixed top-1/2 -translate-y-1/2 right-0 z-30 p-2.5
            rounded-l-lg bg-primary-600 text-white shadow-lg hover:bg-primary-700
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
          aria-label={t('wissensbasis.panel.expand', 'Open Wissensbasis panel')}
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      )}

      {mobileSheetOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-40 bg-black/50 dark:bg-black/60
              backdrop-blur-xs motion-safe:transition-opacity"
            aria-hidden="true"
            onClick={toggleCollapsed}
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('wissensbasis.panel.ariaLabel', 'Wissensbasis composed view')}
            className="lg:hidden fixed inset-y-0 right-0 z-50 w-80 max-w-[85vw] flex flex-col
              bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-2xl
              motion-safe:transition-transform"
          >
            {headerBar}
            <div className="flex-1 flex flex-col overflow-hidden">{panelBody}</div>
          </div>
        </>
      )}
    </>
  );
}

function SectionHeading({
  label,
  source,
}: {
  label: string;
  source?: 'role' | 'user_override' | 'default';
}) {
  const { t } = useTranslation();
  return (
    <div className="px-3 pt-2 pb-1 flex items-baseline justify-between">
      <h3 className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold">
        {label}
      </h3>
      {source === 'default' && (
        <span className="text-[10px] text-gray-400 dark:text-gray-500">
          {t('wissensbasis.panel.defaultMix', 'default mix')}
        </span>
      )}
    </div>
  );
}
