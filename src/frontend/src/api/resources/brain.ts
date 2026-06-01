import { useQueryClient } from '@tanstack/react-query';

import apiClient from '../../utils/axios';
import { useApiQuery, useApiMutation } from '../hooks';
import { keys, STALE } from '../keys';
import type { CircleTier } from '../../components/TierBadge';

export type AtomType =
  | 'kb_document'
  | 'kg_node'
  | 'kg_edge'
  | 'conversation_memory'
  | 'document_fact';

export interface AtomMatch {
  atom: {
    atom_id: string;
    atom_type: AtomType;
    tier?: CircleTier | number;
  };
  score: number;
  snippet: string;
  rank: number;
}

export interface ReviewAtom {
  atom_id: string;
  atom_type: AtomType;
  tier?: CircleTier | number;
  policy?: { tier?: CircleTier | number; [key: string]: unknown };
  title?: string;
  preview?: string;
  created_at?: string;
}

/** A single Schicht A fact — mirrors backend `DocumentFactResponse`. */
export type FactCategory = 'identifier' | 'obligation' | 'universal';
export type FactSource = 'deterministic' | 'llm' | null;

export interface DocumentFact {
  id: number;
  document_id: number;
  atom_id: string | null;
  category: FactCategory | string;
  kind: string;
  value: string;
  normalized_value: string | null;
  excerpt: string | null;
  obligation_date: string | null;
  amount_value: number | null;
  amount_currency: string | null;
  legal_gate: boolean;
  payment_method: string | null;
  confidence: number | null;
  source: FactSource;
  circle_tier: number;
}

export interface ObligationsFilter {
  dueBefore?: string | null;
  limit?: number;
  offset?: number;
}

/** Frontend-visible backend feature flags (allowlist — see api/routes/config.py). */
export interface FeatureFlags {
  schicht_a_extraction_enabled: boolean;
}

async function fetchAtomSearch(query: string): Promise<AtomMatch[]> {
  const response = await apiClient.get<AtomMatch[]>('/api/atoms', {
    params: { q: query, top_k: 20 },
  });
  return response.data ?? [];
}

async function fetchAtomsForReview(days: number): Promise<ReviewAtom[]> {
  const response = await apiClient.get<ReviewAtom[]>('/api/circles/me/atoms-for-review', {
    params: { days, limit: 50 },
  });
  return response.data ?? [];
}

async function fetchDocumentFacts(documentId: number): Promise<DocumentFact[]> {
  const response = await apiClient.get<DocumentFact[]>(
    `/api/atoms/documents/${documentId}/facts`,
  );
  return response.data ?? [];
}

async function fetchObligations(filter: ObligationsFilter): Promise<DocumentFact[]> {
  const params: Record<string, unknown> = {
    limit: filter.limit ?? 200,
    offset: filter.offset ?? 0,
  };
  if (filter.dueBefore) params.due_before = filter.dueBefore;
  const response = await apiClient.get<DocumentFact[]>('/api/atoms/obligations', { params });
  return response.data ?? [];
}

async function fetchFeatureFlags(): Promise<FeatureFlags> {
  const response = await apiClient.get<FeatureFlags>('/api/config/features');
  return response.data;
}

interface PatchAtomTierArgs {
  atomId: string;
  policy: Record<string, unknown>;
}

async function patchAtomTierRequest({ atomId, policy }: PatchAtomTierArgs): Promise<void> {
  await apiClient.patch(`/api/atoms/${atomId}/tier`, { policy });
}

export function useAtomSearchQuery(query: string) {
  return useApiQuery(
    {
      queryKey: keys.brain.search(query),
      queryFn: () => fetchAtomSearch(query),
      staleTime: STALE.DEFAULT,
      enabled: query.trim().length > 0,
    },
    'circles.couldNotLoad',
  );
}

export function useAtomsForReviewQuery(days: number) {
  return useApiQuery(
    {
      queryKey: [...keys.brain.review(), { days }] as const,
      queryFn: () => fetchAtomsForReview(days),
      staleTime: STALE.DEFAULT,
    },
    'circles.couldNotLoad',
  );
}

/**
 * All Schicht A facts for one document. Lazy — pass `enabled: false` until the
 * panel is opened so the list view never fans out a fetch per document.
 */
export function useFactsForDocumentQuery(documentId: number, enabled: boolean) {
  return useApiQuery(
    {
      queryKey: keys.brain.facts(documentId),
      queryFn: () => fetchDocumentFacts(documentId),
      staleTime: STALE.DEFAULT,
      enabled,
    },
    'knowledge.facts.loadError',
  );
}

/**
 * Obligation agenda rows, soonest-first. `offset` pages the stable
 * (obligation_date, id) order for "Mehr laden".
 */
export function useObligationsQuery(filter: ObligationsFilter = {}) {
  return useApiQuery(
    {
      queryKey: keys.brain.obligations({
        dueBefore: filter.dueBefore ?? null,
        limit: filter.limit ?? 200,
        offset: filter.offset ?? 0,
      }),
      queryFn: () => fetchObligations(filter),
      staleTime: STALE.DEFAULT,
    },
    'obligations.loadError',
  );
}

/** Frontend-visible backend feature flags (config-stable). */
export function useFeatureFlags() {
  return useApiQuery(
    {
      queryKey: keys.config.features(),
      queryFn: fetchFeatureFlags,
      staleTime: STALE.CONFIG,
    },
    'common.error',
  );
}

export function usePatchAtomTier() {
  const queryClient = useQueryClient();
  return useApiMutation(
    {
      mutationFn: patchAtomTierRequest,
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: keys.brain.all });
      },
    },
    'circles.couldNotSave',
  );
}
