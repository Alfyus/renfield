/**
 * Wissensbasis API resource — composed memory UX surface (A-LANDING).
 *
 * Backend lives in Reva (`src/reva/wissensbasis/routes.py`). All endpoints
 * gate on `REVA_WISSENSBASIS_ENABLED`; queries enabled=false until the
 * settings hook reports the feature is on.
 *
 * - GET /api/wissensbasis/focus  → 1-hop + 2-hop neighborhood for an entity
 * - GET /api/wissensbasis/trace  → last reasoning trace for a session
 * - GET /api/wissensbasis/me/mix → A2/A4 layout split for the user's role
 */

import apiClient from '../../utils/axios';
import { useApiQuery } from '../hooks';
import { STALE } from '../keys';

export type EntityType =
  | 'release'
  | 'ticket'
  | 'person'
  | 'document'
  | 'incident'
  | 'concept'
  | 'unknown';

export interface TraceEntity {
  entity_id: string;
  display_name: string;
  entity_type: string;
}

export interface TraceEdge {
  from_entity: string;
  to_entity: string;
  relation: string;
  weight: number;
}

export interface ReasoningTrace {
  entities: TraceEntity[];
  edges: TraceEdge[];
}

export interface TracePeek {
  session_id: string;
  trace: ReasoningTrace;
  is_empty: boolean;
}

export interface FocusEntity {
  entity_id: string;
  display_name: string;
  entity_type: string;
  importance: number;
}

export interface FocusEdge {
  from_entity: string;
  to_entity: string;
  relation: string;
}

export interface FocusNeighborhood {
  focus: FocusEntity;
  hop1: FocusEntity[];
  hop2: FocusEntity[];
  edges: FocusEdge[];
  overflow_hop1: number;
  overflow_hop2: number;
}

export interface RoleMix {
  a2: number;
  a4: number;
  source: 'role' | 'user_override' | 'default';
  role: string | null;
}

// Query key factories. Keep keys local to this resource — `keys.ts` is
// shared and would couple the platform to a Reva-only feature flag.
const wbKeys = {
  all: ['wissensbasis'] as const,
  trace: (sessionId: string) => ['wissensbasis', 'trace', sessionId] as const,
  focus: (entityId: string, hops: number, maxPerHop: number | null) =>
    ['wissensbasis', 'focus', entityId, { hops, maxPerHop }] as const,
  mix: (role: string | null) => ['wissensbasis', 'mix', role] as const,
};

async function fetchTrace(sessionId: string): Promise<TracePeek> {
  const { data } = await apiClient.get<TracePeek>('/api/wissensbasis/trace', {
    params: { session_id: sessionId },
  });
  return data;
}

async function fetchFocus(
  entityId: string,
  opts: { hops?: number; maxPerHop?: number | null } = {},
): Promise<FocusNeighborhood> {
  const { data } = await apiClient.get<FocusNeighborhood>('/api/wissensbasis/focus', {
    params: {
      entity_id: entityId,
      hops: opts.hops ?? 2,
      ...(opts.maxPerHop ? { max_per_hop: opts.maxPerHop } : {}),
    },
  });
  return data;
}

async function fetchMix(role: string | null): Promise<RoleMix> {
  const { data } = await apiClient.get<RoleMix>('/api/wissensbasis/me/mix', {
    params: role ? { role } : {},
  });
  return data;
}

export function useTraceQuery(sessionId: string | null, enabled = true) {
  return useApiQuery(
    {
      queryKey: wbKeys.trace(sessionId ?? ''),
      queryFn: () => fetchTrace(sessionId!),
      // Trace is rebuilt every agent turn; LIVE keeps the panel current
      // without spamming the backend during quiet periods.
      staleTime: STALE.LIVE,
      enabled: enabled && !!sessionId,
    },
    'wissensbasis.trace.couldNotLoad',
  );
}

export function useFocusQuery(
  entityId: string | null,
  opts: { hops?: number; maxPerHop?: number | null } = {},
  enabled = true,
) {
  return useApiQuery(
    {
      queryKey: wbKeys.focus(entityId ?? '', opts.hops ?? 2, opts.maxPerHop ?? null),
      queryFn: () => fetchFocus(entityId!, opts),
      // Focus neighborhood depends on relatively stable KG topology;
      // DEFAULT (30s) gives breathing room without going stale during a
      // single session.
      staleTime: STALE.DEFAULT,
      enabled: enabled && !!entityId,
    },
    'wissensbasis.focus.couldNotLoad',
  );
}

export function useRoleMixQuery(role: string | null, enabled = true) {
  return useApiQuery(
    {
      queryKey: wbKeys.mix(role),
      // CONFIG (5min) — role mix only changes when an operator edits
      // agent_roles.yaml + restarts the pod.
      queryFn: () => fetchMix(role),
      staleTime: STALE.CONFIG,
      enabled,
    },
    'wissensbasis.mix.couldNotLoad',
  );
}
