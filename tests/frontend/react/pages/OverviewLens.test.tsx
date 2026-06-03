/**
 * OverviewLens — the /wissen Übersicht dashboard.
 *
 * A grid of uniform area cards: every area (Fristen, Prüfen, Dokumente, Graph,
 * Erinnerungen) renders through AreaCard with the SAME shape — a count, preview
 * rows, and one consistently-placed "Öffnen" link. Covers the populated grid,
 * the memory-only corpus (the gating-bug regression), and the cold-start empty.
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

// OverviewLens gates stat queries + per-card visibility via useAuth. authEnabled
// false → all lenses visible (single-user), so every area card renders.
vi.mock('../../../../src/frontend/src/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mocked(useAuth).mockReturnValue({
  isFeatureEnabled: () => true,
  hasAnyPermission: () => true,
  authEnabled: false,
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
  documents?: unknown[];
  entities?: number;
  relations?: number;
  topEntities?: unknown[];
  memories?: number;
  memoryList?: unknown[];
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
    http.get(`${BASE_URL}/api/knowledge/documents`, () => HttpResponse.json(opts.documents ?? [])),
    http.get(`${BASE_URL}/api/knowledge-graph/stats`, () =>
      HttpResponse.json({
        entity_count: opts.entities ?? 0,
        relation_count: opts.relations ?? 0,
        top_entities: opts.topEntities ?? [],
      }),
    ),
    http.get(`${BASE_URL}/api/memory`, () =>
      HttpResponse.json({ memories: opts.memoryList ?? [], total: opts.memories ?? 0 }),
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
  it('renders every area as a uniform card with count, preview, and one Öffnen link', async () => {
    mockOverview({
      obligations: [obligation],
      review: [
        { atom_id: 'r1', atom_type: 'conversation_memory', tier: 1, title: 'Lieblingsrestaurant', created_at: new Date().toISOString() },
      ],
      docs: 5,
      documents: [{ id: 11, filename: 'vertrag.pdf', title: 'Stromvertrag', status: 'completed', created_at: new Date().toISOString() }],
      entities: 9,
      relations: 3,
      topEntities: [{ id: 21, name: 'Jutta', entity_type: 'person' }],
      memories: 42,
      memoryList: [{ id: 31, content: 'mag Mango', category: 'preference', importance: 0.8, created_at: new Date().toISOString() }],
    });
    const { container } = renderWithRouter(<OverviewLens />, { route: '/wissen' });

    // Corpus lead counts memories (the gating-bug fix).
    expect((await screen.findAllByText(/42 Erinnerungen/)).length).toBeGreaterThan(0);

    // All five area cards present.
    expect(screen.getByRole('heading', { name: 'Nächste Fristen' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Zu prüfen' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dokumente' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Graph' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Erinnerungen' })).toBeInTheDocument();

    // Each card carries exactly one consistently-placed "Öffnen" link.
    expect(screen.getAllByRole('link', { name: /Öffnen/ })).toHaveLength(5);

    // Each card shows preview detail (the same level across areas).
    expect(container.querySelector('.tier-ring-2')).toBeTruthy(); // Fristen obligation row
    expect(screen.getByText('Lieblingsrestaurant')).toBeInTheDocument(); // review
    expect(screen.getByText('Stromvertrag')).toBeInTheDocument(); // document
    expect(screen.getByText('Jutta')).toBeInTheDocument(); // graph entity
    expect(screen.getByText('mag Mango')).toBeInTheDocument(); // memory
  });

  it('does NOT show the empty-state when only memories exist (gating-bug regression)', async () => {
    mockOverview({ docs: 0, entities: 0, relations: 0, review: [], obligations: [], memories: 5 });
    renderWithRouter(<OverviewLens />, { route: '/wissen' });

    expect((await screen.findAllByText(/5 Erinnerungen/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/zweites Gehirn ist noch leer/)).not.toBeInTheDocument();
  });

  it('shows the cold-start empty-state with an upload CTA when the corpus is truly empty', async () => {
    mockOverview({});
    renderWithRouter(<OverviewLens />, { route: '/wissen' });

    expect(await screen.findByText(/zweites Gehirn ist noch leer/)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /Dokument hochladen/ });
    expect(cta).toHaveAttribute('href', '/wissen/dokumente');
  });
});
