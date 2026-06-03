import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { useWorkspaceParam } from '../../hooks/useWorkspaceParam';
import { useAtomSearchQuery, type AtomType } from '../../api/resources/brain';
import TierBadge from '../TierBadge';

type Scope = 'lens' | 'everything';

const SEARCH_DEBOUNCE_MS = 300;

/** Which lens segment owns each atom type — drives the scope filter + routing. */
const ATOM_LENS_SEGMENT: Record<AtomType, string> = {
  kb_document: 'dokumente',
  document_fact: 'fristen',
  kg_node: 'graph',
  kg_edge: 'graph',
  conversation_memory: 'erinnerungen',
};

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
 *   `relative`) — it never unmounts the lens, so the Graph WebGL scene behind
 *   it survives. Clicking a result routes to the owning lens.
 */
export default function WissenSearchBar() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { read, write } = useWorkspaceParam();

  const urlQ = read('q') ?? '';
  const [input, setInput] = useState(urlQ);
  const [scope, setScope] = useState<Scope>('everything');
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

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={input}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t('lens.searchAllPlaceholder')}
            aria-label={t('lens.searchAllPlaceholder')}
            className="input min-h-11 w-full pl-9 pr-9"
          />
          {open && (
            <button
              type="button"
              onClick={clear}
              aria-label={t('common.clear')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Scope toggle [Diese Ansicht | Alles] */}
        <div
          role="group"
          aria-label={t('lens.scopeLabel')}
          className="hidden sm:inline-flex shrink-0 rounded-sm border border-gray-200 dark:border-gray-700 overflow-hidden text-sm"
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

      {open && (
        <div className="absolute z-30 mt-2 left-0 right-0 card max-h-[60vh] overflow-y-auto shadow-lg">
          {searchQuery.isLoading && (
            <p className="text-sm text-gray-500 dark:text-gray-400 p-2">{t('common.loading')}</p>
          )}
          {!searchQuery.isLoading && filtered.length === 0 && (
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
                  onClick={() => openResult(ATOM_LENS_SEGMENT[r.atom.atom_type])}
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
