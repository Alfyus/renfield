/**
 * ReasoningSubgraph (A2 panel) — entities + edges the agent traversed
 * during the last turn. Source: GET /api/wissensbasis/trace.
 *
 * Render strategy:
 *   - Few entities (≤6): inline list of CitationChip pills (no graph).
 *     Faster to scan, no canvas overhead, screen-reader friendly.
 *   - Many entities (>6): force-directed graph via react-force-graph-2d
 *     with a parallel <ul> alt-list under a <details> for screen readers
 *     and prefers-reduced-motion users.
 *
 * Empty state: "No reasoning steps captured" placeholder. Renders when
 * the agent answered without tool calls (training-data-only response).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ForceGraph2D, { ForceGraphMethods } from 'react-force-graph-2d';
import { Brain, Network } from 'lucide-react';

import { CitationChip } from './CitationChip';
import type { ReasoningTrace } from '../../api/resources/wissensbasis';

interface FGNode {
  id: string;
  name: string;
  type: string;
}

interface FGLink {
  source: string;
  target: string;
  relation: string;
}

const INLINE_THRESHOLD = 6;

export interface ReasoningSubgraphProps {
  trace: ReasoningTrace;
  isLoading?: boolean;
}

/**
 * Subscribe to the prefers-reduced-motion media query. Reactive to OS
 * toggles mid-session, which a one-shot `matchMedia(...).matches` read
 * misses. DESIGN.md requires this surface to honor the setting.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function ReasoningSubgraph({ trace, isLoading }: ReasoningSubgraphProps) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();

  if (isLoading) {
    return <SubgraphSkeleton label={t('wissensbasis.subgraph.loading', 'Loading…')} />;
  }

  if (!trace || trace.entities.length === 0) {
    return (
      <div
        className="text-xs text-gray-500 dark:text-gray-400 italic px-3 py-4 text-center"
        role="status"
      >
        <Brain className="h-4 w-4 inline-block mr-1" aria-hidden="true" />
        {t(
          'wissensbasis.subgraph.empty',
          'No reasoning steps captured for this answer.',
        )}
      </div>
    );
  }

  if (trace.entities.length <= INLINE_THRESHOLD || reducedMotion) {
    return <InlineSubgraph trace={trace} />;
  }

  return <GraphSubgraph trace={trace} />;
}

function SubgraphSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-2 px-2 py-3" aria-label={label}>
      <div className="h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
      <div className="h-4 w-1/2 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
      <div className="h-4 w-2/3 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
    </div>
  );
}

function InlineSubgraph({ trace }: { trace: ReasoningTrace }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 px-3 py-2">
      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        {t('wissensbasis.subgraph.inlineHeading', 'Entities the agent used')}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {trace.entities.map((e) => (
          <CitationChip
            key={e.entity_id}
            entity={e.entity_id}
            label={e.display_name}
            entityType={e.entity_type}
          />
        ))}
      </div>
      {trace.edges.length > 0 && (
        <details className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          <summary className="cursor-pointer">
            {t('wissensbasis.subgraph.relationsToggle', 'Relations ({{count}})', {
              count: trace.edges.length,
            })}
          </summary>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            {trace.edges.map((edge, i) => (
              <li key={i}>
                {nameOf(trace, edge.from_entity)} <span className="opacity-60">→</span>{' '}
                <code className="text-[10px] bg-gray-100 dark:bg-gray-700/50 px-1 rounded">
                  {edge.relation}
                </code>{' '}
                <span className="opacity-60">→</span> {nameOf(trace, edge.to_entity)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function GraphSubgraph({ trace }: { trace: ReasoningTrace }) {
  const { t } = useTranslation();
  const fgRef = useRef<ForceGraphMethods<FGNode, FGLink> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 320, h: 240 });

  // Track container size so the canvas resizes with the panel.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(200, Math.floor(r.width)), h: Math.max(180, Math.floor(r.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(
    () => ({
      nodes: trace.entities.map((e) => ({
        id: e.entity_id,
        name: e.display_name,
        type: e.entity_type,
      })),
      links: trace.edges.map((e) => ({
        source: e.from_entity,
        target: e.to_entity,
        relation: e.relation,
      })),
    }),
    [trace],
  );

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="h-64 rounded border border-gray-200 dark:border-gray-700 overflow-hidden"
        role="img"
        aria-label={t('wissensbasis.subgraph.canvasLabel', 'Reasoning graph visualization')}
      >
        <ForceGraph2D
          ref={fgRef}
          graphData={data}
          width={size.w}
          height={size.h}
          nodeLabel={(n) => (n as FGNode).name}
          nodeAutoColorBy="type"
          linkLabel={(l) => (l as FGLink).relation}
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={1}
          enableNodeDrag={false}
          cooldownTicks={50}
        />
      </div>
      <details className="text-xs text-gray-500 dark:text-gray-400">
        <summary className="cursor-pointer">
          {t('wissensbasis.subgraph.altListToggle', 'Show as list ({{count}} entities)', {
            count: trace.entities.length,
          })}
        </summary>
        <ul className="mt-1 list-disc pl-5 space-y-0.5">
          {trace.entities.map((e) => (
            <li key={e.entity_id}>
              <span className="font-medium">{e.display_name}</span>{' '}
              <span className="opacity-60">({e.entity_type})</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function nameOf(trace: ReasoningTrace, entityId: string): string {
  const ent = trace.entities.find((e) => e.entity_id === entityId);
  return ent?.display_name ?? entityId;
}
