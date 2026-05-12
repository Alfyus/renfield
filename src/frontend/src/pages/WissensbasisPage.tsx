/**
 * WissensbasisPage — standalone /wissensbasis route.
 *
 * Reuses the same A2 + A4 components as the chat-page side panel.
 * Vertical stack on mobile, side-by-side on desktop. URL-encoded
 * `?focus=<atom_id>` deep-link is read by WissensbasisProvider.
 *
 * Use case: power-user browse mode — open the page, paste an entity
 * link from elsewhere, get the full focus neighborhood without going
 * through the chat.
 *
 * No search input in v1; v2 may add one. Today the page expects to be
 * navigated to with a `?focus=` param (from CitationChip overflow links,
 * shared URLs, or bookmarks).
 */

import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Layers } from 'lucide-react';

import {
  useFocusQuery,
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
  // Optional `?session=` param to preview an existing trace alongside
  // the focus neighborhood. Without it the A2 panel renders the empty
  // state — that's fine for the deep-browse use case.
  const sessionId = searchParams.get('session');

  const traceQ = useTraceQuery(sessionId);
  const focusQ = useFocusQuery(focusEntityId);

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
            {t('wissensbasis.page.reasoningHeading', 'Recent reasoning')}
          </h2>
          <ReasoningSubgraph
            trace={traceQ.data?.trace ?? { entities: [], edges: [] }}
            isLoading={traceQ.isLoading}
          />
        </section>

        <section
          className="card p-3"
          aria-label={t('wissensbasis.page.focusSection', 'Focus neighborhood')}
        >
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
            {t('wissensbasis.page.focusHeading', 'Entity neighborhood')}
          </h2>
          <FocusNeighborhood
            data={focusQ.data ?? null}
            isLoading={focusQ.isLoading}
            errorMessage={focusQ.errorMessage}
          />
        </section>
      </div>
    </div>
  );
}
