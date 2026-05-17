/**
 * WissensbasisSidePanel — chat-page RIGHT-side panel showing the
 * composed A2 (reasoning subgraph) + A4 (focus neighborhood) layout.
 *
 * Interaction mirrors the left nav rail (components/Layout.tsx):
 *   - Desktop (lg+): a persistent slim rail docked on the right edge
 *     with a hamburger icon. Hovering the rail expands it (pure CSS,
 *     group/wb), and clicking the hamburger PINS it open. The header X
 *     collapses it back to the rail. No floating FAB.
 *   - Mobile (<lg): the rail has no room, so a small fixed hamburger on
 *     the right edge opens a full-height slide-over (from the right)
 *     with a dimmed backdrop — same pattern as the left nav on mobile.
 *
 * `collapsed` (from WissensbasisContext) is the single source of truth:
 *   collapsed = rail / closed; !collapsed = pinned open / sheet open.
 * A CitationChip click sets the focus entity via the same context.
 *
 * Accessibility: the mobile slide-over is a real modal (scroll lock +
 * focus trap + Esc + initial focus). The desktop rail is a persistent
 * complementary region — NOT modal — so those traps are gated to mobile
 * to avoid trapping the whole page behind a hover panel.
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

const MOBILE_BREAKPOINT_PX = 1024; // Tailwind lg — matches the rail's lg: prefixes

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

  const panelRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  // Mobile slide-over is modal: lock body scroll while it's open.
  useEffect(() => {
    if (!isMobile || !open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isMobile, open]);

  // WCAG 2.4.3 — move focus into the sheet on open (mobile only).
  useEffect(() => {
    if (isMobile && open) closeBtnRef.current?.focus();
  }, [isMobile, open]);

  // Esc closes (both breakpoints — harmless on desktop). Tab/Shift+Tab
  // are trapped only on the mobile modal, never on the desktop rail.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        toggleCollapsed();
        return;
      }
      if (e.key !== 'Tab' || !isMobile) return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
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
      } else if (active && !panel.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isMobile, toggleCollapsed]);

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

  // Content fades in when the rail is hovered or pinned; in the
  // collapsed rail state it's hidden so the w-14 strip stays clean.
  const revealOnHover = collapsed
    ? 'lg:opacity-0 lg:group-hover/wb:opacity-100'
    : '';

  return (
    <>
      {/* Mobile backdrop — only when the sheet is open */}
      <div
        className={`fixed inset-0 bg-black/50 dark:bg-black/60 backdrop-blur-xs z-40 transition-opacity duration-300 lg:hidden ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
        onClick={toggleCollapsed}
      />

      {/* Mobile opener — fixed right-edge hamburger, only when closed.
          The rail has no room on phones, so this is the entry point
          (the old floating FAB stranded users; this mirrors the left
          nav's mobile hamburger). */}
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

      <aside
        ref={panelRef}
        className={`group/wb fixed top-0 right-0 h-full flex flex-col bg-white dark:bg-gray-900
          border-l border-gray-200 dark:border-gray-700 z-50 transform transition-all duration-300 ease-out
          w-80 ${collapsed ? 'lg:w-14 lg:hover:w-96' : 'lg:w-96'} lg:translate-x-0
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
        aria-label={t('wissensbasis.panel.ariaLabel', 'Wissensbasis composed view')}
        role={isMobile && open ? 'dialog' : 'complementary'}
        aria-modal={isMobile && open ? true : undefined}
      >
        <header className="relative flex items-center h-12 px-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          {/* Rail hamburger — desktop, collapsed, hidden on hover */}
          {collapsed && (
            <div className="hidden lg:flex lg:group-hover/wb:hidden items-center justify-center absolute inset-0">
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
          )}

          {/* Title + collapse — mobile always; desktop on hover or when pinned */}
          <div
            className={`flex items-center justify-between w-full ${revealOnHover} transition-opacity duration-200`}
          >
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
          </div>
        </header>

        <div
          className={`flex-1 flex flex-col overflow-hidden ${revealOnHover} transition-opacity duration-200`}
        >
          {panelBody}
        </div>
      </aside>
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
