/**
 * WissensbasisSidePanel — chat-page right-side panel showing the
 * composed A2 (reasoning subgraph) + A4 (focus neighborhood) layout.
 *
 * - Reads role mix from /api/wissensbasis/me/mix to size A2/A4 split.
 * - Reads trace from /api/wissensbasis/trace?session_id=…
 * - Reads focus from /api/wissensbasis/focus?entity_id=… (driven by
 *   WissensbasisContext, which a CitationChip click updates).
 * - Collapsible (per-browser localStorage); collapsed state shows a
 *   floating expand button bottom-right.
 * - On mobile (<768px), auto-collapses and exposes a bottom-sheet open
 *   button instead of inline panel.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronLeft, Layers } from 'lucide-react';

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

  // Collapsed (or mobile collapsed) — render only the floating expand button.
  if (collapsed || isMobile) {
    return (
      <button
        type="button"
        onClick={toggleCollapsed}
        className="fixed bottom-4 right-4 z-30 inline-flex items-center gap-1.5
          rounded-full bg-blue-600 text-white shadow-lg px-4 py-2 text-sm font-medium
          hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2
          focus-visible:ring-blue-300"
        aria-label={t('wissensbasis.panel.expand', 'Open Wissensbasis panel')}
      >
        <Layers className="h-4 w-4" aria-hidden="true" />
        {t('wissensbasis.panel.expandShort', 'Wissensbasis')}
      </button>
    );
  }

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
    </aside>
  );
}

function SectionHeading({
  label,
  source,
}: {
  label: string;
  source?: 'role' | 'user_override' | 'default';
}) {
  return (
    <div className="px-3 pt-2 pb-1 flex items-baseline justify-between">
      <h3 className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold">
        {label}
      </h3>
      {source === 'default' && (
        <span className="text-[10px] text-gray-400 dark:text-gray-500">default mix</span>
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
      <ChevronLeft className="h-3 w-3" aria-hidden="true" />
      {t('wissensbasis.panel.expandShort', 'Wissensbasis')}
    </button>
  );
}
