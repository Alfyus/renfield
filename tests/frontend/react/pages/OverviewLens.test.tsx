/**
 * OverviewLens — the /wissen Übersicht dashboard (PR2).
 *
 * Editorial, list-led: real Fristen + review surfaces + a quiet corpus count,
 * composed from existing hooks. Covers the populated path and the cold-start
 * empty-state (the worst first impression the design review flagged).
 */
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';
import { server } from '../mocks/server';
import { TEST_CONFIG } from '../config';
import { useAuth } from '../../../../src/frontend/src/context/AuthContext';
import OverviewLens from '../../../../src/frontend/src/pages/wissen/OverviewLens';

const BASE_URL = TEST_CONFIG.API_BASE_URL;

// OverviewLens gates its stat queries via useAuth().isFeatureEnabled.
vi.mock('../../../../src/frontend/src/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mocked(useAuth).mockReturnValue({
  isFeatureEnabled: () => true,
} as unknown as ReturnType<typeof useAuth>);

function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function mockOverview(opts: {
  obligations?: unknown[];
  review?: unknown[];
  docs?: number;
  entities?: number;
  relations?: number;
}) {
  server.use(
    http.get(`${BASE_URL}/api/atoms/obligations`, () => HttpResponse.json(opts.obligations ?? [])),
    http.get(`${BASE_URL}/api/circles/me/atoms-for-review`, () => HttpResponse.json(opts.review ?? [])),
    http.get(`${BASE_URL}/api/knowledge/stats`, () =>
      HttpResponse.json({
        document_count: opts.docs ?? 0,
        completed_documents: opts.docs ?? 0,
        chunk_count: 0,
        knowledge_base_count: opts.docs ? 1 : 0,
      }),
    ),
    http.get(`${BASE_URL}/api/knowledge-graph/stats`, () =>
      HttpResponse.json({ entity_count: opts.entities ?? 0, relation_count: opts.relations ?? 0 }),
    ),
  );
}

const obligation = {
  id: 1,
  document_id: 7,
  atom_id: 'o1',
  category: 'obligation',
  kind: 'rechnung',
  value: 'Stromrechnung',
  normalized_value: null,
  excerpt: null,
  obligation_date: isoInDays(2),
  amount_value: 42.5,
  amount_currency: 'EUR',
  legal_gate: false,
  payment_method: null,
  confidence: 0.9,
  source: 'llm',
  circle_tier: 2,
};

describe('OverviewLens', () => {
  it('renders corpus counts, upcoming Fristen, and the review count', async () => {
    mockOverview({ obligations: [obligation], review: [{ atom_id: 'r1' }, { atom_id: 'r2' }], docs: 5, entities: 9, relations: 3 });
    renderWithRouter(<OverviewLens />, { route: '/wissen' });

    expect(await screen.findByText(/5 Dokumente/)).toBeInTheDocument();
    expect(screen.getByText(/9 Entitäten/)).toBeInTheDocument();
    // Review count link (2 items awaiting review).
    expect(await screen.findByText(/2 Einträge/)).toBeInTheDocument();
    // The "no deadlines" hint must NOT show when there's an upcoming Frist.
    expect(screen.queryByText(/Keine Fristen/)).not.toBeInTheDocument();
  });

  it('shows the cold-start empty-state with an upload CTA when the corpus is empty', async () => {
    mockOverview({});
    renderWithRouter(<OverviewLens />, { route: '/wissen' });

    expect(await screen.findByText(/zweites Gehirn ist noch leer/)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /Dokument hochladen/ });
    expect(cta).toHaveAttribute('href', '/wissen/dokumente');
  });
});
