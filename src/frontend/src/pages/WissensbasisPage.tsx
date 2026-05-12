/**
 * WissensbasisPage — standalone /wissensbasis route.
 *
 * Composed A2 + A4 panel (the approved A-LANDING design). Use case
 * per the user: "When I use the wissensbasis directly, I know exactly
 * what I'm looking for as entry point." Chat is the open-ended query
 * surface; this page is the direct-entry surface.
 *
 * Therefore:
 *   - When ?focus= is set (e.g. from a citation chip click), the A4
 *     card fills with that entity's focus neighborhood.
 *   - When ?focus= is NOT set, A4 renders a search input with live
 *     suggestions (the A4 mock's "search-driven" pattern). Pick a
 *     suggestion → ?focus=<id> → focus card.
 *   - The A2 card fills only when ?session= is supplied (chat-driven
 *     flow). On direct entry without a session, A2 shows its empty
 *     placeholder by design.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { Layers, Search } from 'lucide-react';

import {
  useFocusQuery,
  useSearchQuery,
  useTraceQuery,
  type SearchHit,
} from '../api/resources/wissensbasis';
import { WissensbasisProvider, useWissensbasis } from '../context/WissensbasisContext';
import { FocusNeighborhood } from '../components/wissensbasis/FocusNeighborhood';
import { ReasoningSubgraph } from '../components/wissensbasis/ReasoningSubgraph';
import PageHeader from '../components/PageHeader';

export default function WissensbasisPage() {
  return (
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
          {focusEntityId ? (
            <FocusNeighborhood
              data={focusQ.data ?? null}
              isLoading={focusQ.isLoading}
              errorMessage={focusQ.errorMessage}
            />
          ) : (
            <DirectEntrySearch />
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * A4 direct-entry search input + live suggestions.
 *
 * Renders when the page is reached without a ?focus= deep-link. The
 * premise (per the design): the user types the entity name they have
 * in mind, picks a suggestion, the focus card fills. Different code
 * path from chip-click navigation, same destination.
 *
 * Debounce: 180ms — fast enough to feel live, slow enough to avoid
 * one request per keystroke. The hook itself is gated on q.length>0
 * so empty input does no network work.
 */
function DirectEntrySearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rawQ, setRawQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(rawQ), 180);
    return () => clearTimeout(id);
  }, [rawQ]);

  const searchQ = useSearchQuery(debouncedQ);
  const hits: SearchHit[] = searchQ.data?.items ?? [];

  useEffect(() => {
    // Reset highlight whenever the result set changes so the visible
    // top item is always selectable via Enter.
    setActiveIndex(0);
  }, [hits.length]);

  function pick(hit: SearchHit) {
    navigate(`/wissensbasis?focus=${encodeURIComponent(hit.entity_id)}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && hits.length > 0) {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp' && hits.length > 0) {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && hits.length > 0) {
      e.preventDefault();
      pick(hits[activeIndex]);
    } else if (e.key === 'Escape') {
      setRawQ('');
    }
  }

  return (
    <div className="px-1 py-2">
      <label
        htmlFor="wb-search"
        className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5"
      >
        {t(
          'wissensbasis.search.label',
          'Search an entity by name — releases, tickets, people, documents',
        )}
      </label>
      <div className="relative">
        <Search
          className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          id="wb-search"
          type="text"
          value={rawQ}
          onChange={(e) => setRawQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t(
            'wissensbasis.search.placeholder',
            'e.g. PRODUCT-A 1.3.5 or REVA-100',
          )}
          className="input w-full pl-9 pr-3 py-2 text-sm"
          autoComplete="off"
          spellCheck={false}
          aria-controls="wb-search-suggestions"
          aria-expanded={hits.length > 0}
          aria-activedescendant={
            hits.length > 0 ? `wb-search-hit-${activeIndex}` : undefined
          }
        />
      </div>

      {searchQ.isLoading && debouncedQ ? (
        <div className="mt-2 space-y-1">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-8 rounded bg-gray-100 dark:bg-gray-800 animate-pulse"
            />
          ))}
        </div>
      ) : null}

      {debouncedQ && !searchQ.isLoading && hits.length === 0 ? (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400 italic px-1">
          {t(
            'wissensbasis.search.noResults',
            'Nothing found for "{{q}}". Try a different name or paste an ID.',
            { q: debouncedQ },
          )}
        </p>
      ) : null}

      {hits.length > 0 ? (
        <ul
          id="wb-search-suggestions"
          role="listbox"
          className="mt-2 space-y-0.5 max-h-[50vh] overflow-y-auto"
        >
          {hits.map((hit, i) => (
            <li
              key={hit.entity_id}
              id={`wb-search-hit-${i}`}
              role="option"
              aria-selected={i === activeIndex}
            >
              <button
                type="button"
                onClick={() => pick(hit)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`w-full text-left rounded-md px-2.5 py-1.5 transition-colors
                  ${i === activeIndex
                    ? 'bg-accent-100 dark:bg-accent-900/30'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800/60'}`}
              >
                <p className="text-xs text-gray-800 dark:text-gray-100 truncate">
                  {hit.display_name}
                </p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                  {hit.entity_type}
                  {hit.mention_count > 0 && (
                    <>
                      <span className="mx-1 opacity-50">·</span>
                      {t('wissensbasis.search.mentions', '{{count}} mentions', {
                        count: hit.mention_count,
                      })}
                    </>
                  )}
                </p>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {!debouncedQ ? (
        <p className="mt-4 text-xs text-gray-500 dark:text-gray-400 italic px-1">
          {t(
            'wissensbasis.search.hint',
            'Direct entry. Start typing the name of the thing you want to focus on.',
          )}
        </p>
      ) : null}
    </div>
  );
}
