/**
 * WissensbasisSidePanel — chat-page right-side panel showing the
 * composed A2 (reasoning subgraph) + A4 (focus neighborhood) layout.
 *
 * - Reads role mix from /api/wissensbasis/me/mix to size A2/A4 split.
 * - Reads trace from /api/wissensbasis/trace?session_id=…
 * - Reads focus from /api/wissensbasis/focus?entity_id=… (driven by
 *   WissensbasisContext, which a CitationChip click updates).
 * - Desktop (≥768px): collapsible aside docked right.
 * - Mobile (<768px): floating FAB; tapping opens a full-width bottom
 *   sheet overlay with backdrop + close affordance.
 *
 * The four (collapsed × isMobile) states map cleanly:
 *   - desktop + expanded → inline aside
 *   - desktop + collapsed → floating FAB to expand
 *   - mobile + collapsed → floating FAB to open the sheet
 *   - mobile + expanded → bottom-sheet overlay
 *
 * The earlier implementation routed mobile to the FAB regardless of
 * `collapsed`, which left the panel permanently inaccessible on phones.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Layers, X } from 'lucide-react';

import {
  useFocusQuery,
  useRoleMixQuery,
  useTraceQuery,
} from '../../api/resources/wissensbasis';
import { useWissensbasis } from '../../context/WissensbasisContext';

import { FocusNeighborhood } from './FocusNeighborhood';
import { ReasoningSubgraph } from './ReasoningSubgraph';

const MOBILE_BREAKPOINT_PX = 768;

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

  // Collapsed → render only the floating expand button. On mobile this
  // is the only entry point; on desktop the user can also use the
  // header chevron (rendered when expanded).
  if (collapsed) {
    return <ExpandFab onClick={toggleCollapsed} label={t('wissensbasis.panel.expand', 'Open Wissensbasis panel')} shortLabel={t('wissensbasis.panel.expandShort', 'Wissensbasis')} />;
  }

  // Mobile + expanded → bottom-sheet overlay with backdrop.
  if (isMobile) {
    return (
      <MobileBottomSheet
        onClose={toggleCollapsed}
        ariaLabel={t('wissensbasis.panel.ariaLabel', 'Wissensbasis composed view')}
        heading={t('wissensbasis.panel.heading', 'Wissensbasis')}
        closeLabel={t('wissensbasis.panel.collapse', 'Collapse panel')}
      >
        {panelBody}
      </MobileBottomSheet>
    );
  }

  // Desktop + expanded → inline aside.
  return (
    <aside
      className="hidden md:flex flex-col h-full w-96 shrink-0 border-l border-gray-200
        dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden"
      aria-label={t('wissensbasis.panel.ariaLabel', 'Wissensbasis composed view')}
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          {t('wissensbasis.panel.heading', 'Wissensbasis')}
        </h2>
        <button
          type="button"
          onClick={toggleCollapsed}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
          aria-label={t('wissensbasis.panel.collapse', 'Collapse panel')}
        >
          <ChevronRight className="h-4 w-4 text-gray-600 dark:text-gray-300" />
        </button>
      </header>
      {panelBody}
    </aside>
  );
}

interface ExpandFabProps {
  onClick: () => void;
  label: string;
  shortLabel: string;
}

function ExpandFab({ onClick, label, shortLabel }: ExpandFabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-1.5
        rounded-full bg-primary-600 text-white shadow-lg px-4 py-2 text-sm font-medium
        hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2
        focus-visible:ring-primary-300"
      aria-label={label}
    >
      <Layers className="h-4 w-4" aria-hidden="true" />
      {shortLabel}
    </button>
  );
}

interface MobileBottomSheetProps {
  children: ReactNode;
  onClose: () => void;
  ariaLabel: string;
  heading: string;
  closeLabel: string;
}

// Selector for everything Tab can normally land on. Used by the focus
// trap to find the first/last focusable element inside the sheet.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function MobileBottomSheet({
  children,
  onClose,
  ariaLabel,
  heading,
  closeLabel,
}: MobileBottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  // Body scroll lock while the sheet is open — without this, scrolling
  // inside the sheet cascades up to the chat list once the sheet content
  // is at its top, which feels broken on touch devices.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // WCAG SC 2.4.3 — initial focus moves into the dialog on open.
  // Lands on the close button: predictable, doesn't focus a content
  // chip the user has to dismiss before getting back to the close
  // affordance.
  useEffect(() => {
    closeBtnRef.current?.focus();
  }, []);

  // WCAG SC 2.1.2 — focus trap. Esc closes; Tab/Shift+Tab cycle within
  // the sheet's focusable elements rather than escaping to the chat
  // input behind the backdrop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
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
        // Focus drifted outside the sheet (e.g. a hidden tabbable link
        // in the underlying chat). Pull it back in.
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 md:hidden motion-safe:transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] flex flex-col
          bg-white dark:bg-gray-900 rounded-t-xl shadow-2xl border-t border-gray-200
          dark:border-gray-700 md:hidden motion-safe:transition-transform"
      >
        {/* Drag handle pill — purely visual cue that this is a sheet,
            not a fixed dialog. Drag-to-dismiss is deferred to v2. */}
        <div className="pt-2 pb-1 flex justify-center" aria-hidden="true">
          <span className="block w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
        </div>
        <header className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{heading}</h2>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label={closeLabel}
          >
            <X className="h-4 w-4 text-gray-600 dark:text-gray-300" />
          </button>
        </header>
        <div className="flex-1 flex flex-col overflow-hidden">{children}</div>
      </div>
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

/**
 * Convenience back-button variant for use inside a left-collapsed layout —
 * shown in the chat header when the panel is collapsed and the user is
 * NOT on a mobile breakpoint, so they have a non-floating affordance too.
 */
export function WissensbasisExpandButton() {
  const { t } = useTranslation();
  const { collapsed, toggleCollapsed } = useWissensbasis();
  if (!collapsed) return null;
  return (
    <button
      type="button"
      onClick={toggleCollapsed}
      className="hidden md:inline-flex items-center gap-1 px-2 py-1 text-xs rounded
        bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600
        text-gray-700 dark:text-gray-200"
      aria-label={t('wissensbasis.panel.expand', 'Open Wissensbasis panel')}
    >
      <Layers className="h-3 w-3" aria-hidden="true" />
      {t('wissensbasis.panel.expandShort', 'Wissensbasis')}
    </button>
  );
}
