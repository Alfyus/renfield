import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { useWorkspaceParam } from '../../hooks/useWorkspaceParam';
import { useAtomSearchQuery } from '../../api/resources/brain';
import { ATOM_LENS_SEGMENT, lensForSegment } from '../../pages/wissen/lenses';
import TierBadge from '../TierBadge';

type Scope = 'lens' | 'everything';

const SEARCH_DEBOUNCE_MS = 300;

function activeSegment(pathname: string): string {
  const m = pathname.match(/^\/wissen\/([^/?#]+)/);
  return m ? m[1] : '';
}

/**
 * Persistent lens-scoped omnisearch for the Wissen workspace (D7 + D9).
 *
 * - Live typing; `?q=` is written via `history.replace` (no Back-button
 *   pollution) and the corpus fetch is debounced ~300ms (no per-keystroke
 *   query storm) — `useWorkspaceParam` keeps sibling lens params intact.
 * - Scope toggle: "Diese Ansicht" filters results to the active lens's atom
 *   types; "Alles" searches the whole corpus.
 * - Results overlay LAYERS over the active lens (the parent content column is
 *   `relative`) without unmounting it — toggling search does not tear down the
 *   active lens (e.g. the Graph WebGL scene). Switching to a different lens
 *   does remount that lens; only the shell (rail + this bar) persists.
 *   Clicking a result routes to the owning lens.
 */
export default function WissenSearchBar() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { read, write } = useWorkspaceParam();

  const urlQ = read('q') ?? '';
  const [input, setInput] = useState(urlQ);
  // Scope lives in the URL so the consuming lenses (Documents/Graph) can read it
  // too. Default 'lens' — the single box searches the current view first.
  const scope: Scope = read('scope') === 'everything' ? 'everything' : 'lens';
  const setScope = (s: Scope) => write('scope', s, { replace: true });
  const [debouncedQ, setDebouncedQ] = useState(urlQ);

  // Keep the field in sync if `?q=` changes from the outside (deep-link, back).
  useEffect(() => {
    setInput(urlQ);
  }, [urlQ]);

  // Debounce the value that actually drives the corpus fetch.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(input), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [input]);

  const searchQuery = useAtomSearchQuery(debouncedQ);

  const seg = activeSegment(location.pathname);
  const filtered = useMemo(() => {
    const results = searchQuery.data ?? [];
    if (scope === 'everything') return results;
    return results.filter((r) => ATOM_LENS_SEGMENT[r.atom.atom_type] === seg);
  }, [searchQuery.data, scope, seg]);

  const onChange = (value: string) => {
    setInput(value);
    write('q', value, { replace: true });
  };

  const clear = () => {
    setInput('');
    write('q', null, { replace: true });
  };

  const openResult = (segment: string) => {
    clear();
    navigate(`/wissen/${segment}`);
  };

  const open = input.trim().length > 0;
  // At scope=lens on a lens that runs its own inline search (Documents chunk
  // search, Graph entity-table filter), the lens consumes `?q=` and renders
  // results inline — so suppress the cross-corpus overlay (D9 full-unify).
  const lensConsumesInline = !!lensForSegment(seg)?.consumesQueryInline;
  const overlayActive = open && !(scope === 'lens' && lensConsumesInline);
  // The fetch lags the field by the debounce window; treat "field newer than
  // the fetched query, or fetch in flight" as pending so the empty-state does
  // NOT flash "no results" during the ~300ms gap on every keystroke.
  const pending = input.trim() !== debouncedQ.trim() || searchQuery.isFetching;

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={input}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && open) {
                e.preventDefault();
                clear();
              }
            }}
            placeholder={t('lens.searchAllPlaceholder')}
            aria-label={t('lens.searchAllPlaceholder')}
            aria-expanded={overlayActive}
            aria-controls="wissen-search-results"
            className="input min-h-11 w-full pl-9 pr-11"
          />
          {open && (
            <button
              type="button"
              onClick={clear}
              aria-label={t('common.clear')}
              className="absolute right-1 top-1/2 -translate-y-1/2 min-w-11 min-h-11 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Scope toggle [Diese Ansicht | Alles] — visible on every viewport. */}
        <div
          role="group"
          aria-label={t('lens.scopeLabel')}
          className="inline-flex shrink-0 rounded-sm border border-gray-200 dark:border-gray-700 overflow-hidden text-sm"
        >
          {(['lens', 'everything'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={scope === s}
              onClick={() => setScope(s)}
              className={`min-h-11 px-3 font-medium transition-colors ${
                scope === s
                  ? 'bg-primary-600/20 text-primary-600 dark:text-primary-400'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'
              }`}
            >
              {s === 'lens' ? t('lens.scopeThis') : t('lens.scopeAll')}
            </button>
          ))}
        </div>
      </div>

      {overlayActive && (
        <div
          id="wissen-search-results"
          role="region"
          aria-live="polite"
          aria-label={t('lens.searchAllPlaceholder')}
          className="absolute z-30 mt-2 left-0 right-0 card max-h-[60vh] overflow-y-auto shadow-lg"
        >
          {pending && (
            <p className="text-sm text-gray-500 dark:text-gray-400 p-2">{t('common.loading')}</p>
          )}
          {!pending && filtered.length === 0 && (
            <div className="empty-state">
              <p>{t('lens.searchNoResults', { query: input })}</p>
              {scope === 'lens' && (
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('lens.searchWidenHint')}</p>
              )}
            </div>
          )}
          <ul className="divide-y divide-gray-100 dark:divide-gray-700/60">
            {filtered.map((r) => (
              <li key={r.atom.atom_id}>
                <button
                  type="button"
                  onClick={() => {
                    const targetSeg = ATOM_LENS_SEGMENT[r.atom.atom_type];
                    if (targetSeg) openResult(targetSeg);
                  }}
                  className="atom-row w-full text-left flex items-start gap-3 py-2"
                >
                  {r.atom.tier !== undefined && <TierBadge tier={r.atom.tier} />}
                  <span className="min-w-0 flex-1 text-sm text-gray-700 dark:text-gray-200 truncate">
                    {r.snippet}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
