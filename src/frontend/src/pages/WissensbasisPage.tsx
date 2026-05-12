/**
 * WissensbasisPage — standalone /wissensbasis route.
 *
 * Composed A2 + A4 panel (the approved A-LANDING design). When the
 * page is reached with no URL params, the cards become browse-everything
 * pickers — recent sessions on the A2 side, top entities on the A4
 * side — so the user lands on actual content instead of placeholders.
 * URL deep-links (`?focus=`, `?session=`) take precedence and fill
 * the respective card directly.
 */

import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { Layers, MessageSquare, MessageSquareText, Sparkles } from 'lucide-react';

import {
  useFocusQuery,
  useRecentEntitiesQuery,
  useRecentSessionsQuery,
  useTraceQuery,
} from '../api/resources/wissensbasis';
import { WissensbasisProvider, useWissensbasis } from '../context/WissensbasisContext';
import { FocusNeighborhood } from '../components/wissensbasis/FocusNeighborhood';
import { ReasoningSubgraph } from '../components/wissensbasis/ReasoningSubgraph';
import PageHeader from '../components/PageHeader';

export default function WissensbasisPage() {
  return (
    // syncWithUrl=true lets the page hydrate from `?focus=` and write
    // it back when the user clicks chips inside the page.
    <WissensbasisProvider syncWithUrl>
      <WissensbasisPageInner />
    </WissensbasisProvider>
  );
}

function WissensbasisPageInner() {
  const { t } = useTranslation();
  const { focusEntityId } = useWissensbasis();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session');

  const traceQ = useTraceQuery(sessionId);
  const focusQ = useFocusQuery(focusEntityId);

  // Catalog queries fire only when the corresponding deep-link is
  // absent — keeps the request load minimal for the chip-driven flow.
  const sessionsQ = useRecentSessionsQuery(50, !sessionId);
  const entitiesQ = useRecentEntitiesQuery(60, !focusEntityId);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('wissensbasis.page.title', 'Wissensbasis')}
        subtitle={t(
          'wissensbasis.page.description',
          'Composed view of recent reasoning and focused entity neighborhood.',
        )}
        icon={Layers}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section
          className="card p-3"
          aria-label={t('wissensbasis.page.reasoningSection', 'Reasoning subgraph')}
        >
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
            {sessionId
              ? t('wissensbasis.page.reasoningHeading', 'Recent reasoning')
              : t('wissensbasis.page.recentSessionsHeading', 'Recent conversations')}
          </h2>
          {sessionId ? (
            <ReasoningSubgraph
              trace={traceQ.data?.trace ?? { entities: [], edges: [] }}
              isLoading={traceQ.isLoading}
            />
          ) : (
            <SessionsCatalog
              items={sessionsQ.data?.items ?? []}
              isLoading={sessionsQ.isLoading}
            />
          )}
        </section>

        <section
          className="card p-3"
          aria-label={t('wissensbasis.page.focusSection', 'Focus neighborhood')}
        >
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
            {focusEntityId
              ? t('wissensbasis.page.focusHeading', 'Entity neighborhood')
              : t('wissensbasis.page.recentEntitiesHeading', 'Browse entities')}
          </h2>
          {focusEntityId ? (
            <FocusNeighborhood
              data={focusQ.data ?? null}
              isLoading={focusQ.isLoading}
              errorMessage={focusQ.errorMessage}
            />
          ) : (
            <EntitiesCatalog
              items={entitiesQ.data?.items ?? []}
              isLoading={entitiesQ.isLoading}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Browse-everything: recent sessions list.
 *
 * Shows the user's chats newest-first with the opening question as
 * preview text. Clicking navigates to /wissensbasis?session=<id>,
 * which fills the A2 panel with that conversation's reasoning trace.
 */
function SessionsCatalog({
  items,
  isLoading,
}: {
  items: Array<{
    session_id: string;
    preview: string;
    updated_at: string;
    message_count: number;
  }>;
  isLoading: boolean;
}) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="space-y-2 px-1 py-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-10 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-xs text-gray-500 dark:text-gray-400 italic px-3 py-6 text-center">
        <MessageSquare className="h-4 w-4 inline-block mr-1" aria-hidden="true" />
        {t(
          'wissensbasis.sessions.empty',
          'No conversations yet. Start one to populate the knowledge base.',
        )}
      </div>
    );
  }

  return (
    <ul className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
      {items.map((s) => (
        <li key={s.session_id}>
          <Link
            to={`/wissensbasis?session=${encodeURIComponent(s.session_id)}`}
            className="block rounded-md px-2.5 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <p className="text-xs text-gray-800 dark:text-gray-100 truncate">
              {s.preview || (
                <span className="italic text-gray-400 dark:text-gray-500">
                  {t('wissensbasis.sessions.noPreview', '(no preview)')}
                </span>
              )}
            </p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
              {t('wissensbasis.sessions.meta', '{{count}} msg · {{when}}', {
                count: s.message_count,
                when: formatRelativeOrDate(s.updated_at),
              })}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Browse-everything: top entities list.
 *
 * Mention-count ordered, clickable. Clicking sets ?focus= which the
 * existing FocusNeighborhood path picks up.
 */
function EntitiesCatalog({
  items,
  isLoading,
}: {
  items: Array<{
    entity_id: string;
    display_name: string;
    entity_type: string;
    mention_count: number;
  }>;
  isLoading: boolean;
}) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="flex flex-wrap gap-1.5 px-1 py-2">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-6 w-20 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-xs text-gray-500 dark:text-gray-400 italic px-3 py-6 text-center">
        <Sparkles className="h-4 w-4 inline-block mr-1" aria-hidden="true" />
        {t(
          'wissensbasis.entities.empty',
          'No entities yet. Talk to Reva and they will appear here.',
        )}
      </div>
    );
  }

  return (
    <div className="max-h-[60vh] overflow-y-auto pr-1">
      <div className="flex flex-wrap gap-1.5">
        {items.map((e) => (
          <Link
            key={e.entity_id}
            to={`/wissensbasis?focus=${encodeURIComponent(e.entity_id)}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs
              bg-gray-100 dark:bg-gray-800/60 text-gray-800 dark:text-gray-100
              hover:bg-accent-100 dark:hover:bg-accent-900/30 transition-colors"
            title={t('wissensbasis.entities.mentionCount', '{{count}} mentions', {
              count: e.mention_count,
            })}
          >
            <MessageSquareText className="h-3 w-3 opacity-50" aria-hidden="true" />
            <span className="truncate max-w-[14ch]">{e.display_name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function formatRelativeOrDate(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const deltaMin = (Date.now() - t) / 60000;
    if (deltaMin < 60) return `${Math.max(1, Math.floor(deltaMin))}m`;
    if (deltaMin < 60 * 24) return `${Math.floor(deltaMin / 60)}h`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return '';
  }
}
