/**
 * OverviewLens — the /wissen Übersicht dashboard.
 *
 * Editorial, list-led: a quiet corpus figure (incl. memories), the real Fristen
 * list with tier rings, real "Zu prüfen" preview rows that open the detail
 * drawer, and a gated "Bereiche" nav. Covers the populated path, the cold-start
 * empty-state, the memory-only corpus (the gating bug this redesign fixed), the
 * drawer-open click, and the tier-ring signal.
 */
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';
import { server } from '../mocks/server';
import { TEST_CONFIG } from '../config';
import { useAuth } from '../../../../src/frontend/src/context/AuthContext';
import { useWissenDrawer } from '../../../../src/frontend/src/context/WissenDrawerContext';
import OverviewLens from '../../../../src/frontend/src/pages/wissen/OverviewLens';

const BASE_URL = TEST_CONFIG.API_BASE_URL;

// OverviewLens gates stat queries + lens visibility via useAuth. authEnabled
// false → all lenses visible (single-user), so the Bereiche nav lists every lens.
vi.mock('../../../../src/frontend/src/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mocked(useAuth).mockReturnValue({
  isFeatureEnabled: () => true,
  hasAnyPermission: () => true,
  authEnabled: false,
} as unknown as ReturnType<typeof useAuth>);

// Spy the drawer so the review-row click is observable.
const openAtomSpy = vi.fn();
vi.mock('../../../../src/frontend/src/context/WissenDrawerContext', () => ({
  useWissenDrawer: vi.fn(),
}));
vi.mocked(useWissenDrawer).mockReturnValue({ openAtom: openAtomSpy });

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
  memories?: number;
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
    http.get(`${BASE_URL}/api/memory`, () =>
      HttpResponse.json({ memories: [], total: opts.memories ?? 0 }),
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

const reviewAtom = {
  atom_id: 'r1',
  atom_type: 'conversation_memory',
  tier: 1,
  title: 'Lieblingsrestaurant',
  preview: 'mag Sushi am Freitag',
  created_at: new Date().toISOString(),
};

describe('OverviewLens', () => {
  it('renders corpus figures (incl. memories), Fristen with tier ring, review previews, and lens nav', async () => {
    mockOverview({
      obligations: [obligation],
      review: [reviewAtom, { atom_id: 'r2', atom_type: 'kb_document', tier: 2 }],
      docs: 5,
      entities: 9,
      relations: 3,
      memories: 42,
    });
    const { container } = renderWithRouter(<OverviewLens />, { route: '/wissen' });

    // Corpus line: memories are now counted (was the omitted figure). Each
    // figure shows twice (corpus lead + the per-area Bereiche subline), so
    // assert on all matches rather than a single one.
    expect((await screen.findAllByText(/5 Dokumente/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/9 Entitäten/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/42 Erinnerungen/).length).toBeGreaterThan(0);

    // Fristen row carries the tier ring (the signal the old bare <li> dropped).
    expect(container.querySelector('.tier-ring-2')).toBeTruthy();
    expect(screen.queryByText(/Keine Fristen/)).not.toBeInTheDocument();

    // Review section shows a real preview row, not just a count.
    expect(await screen.findByText('Lieblingsrestaurant')).toBeInTheDocument();
    expect(screen.getByText('mag Sushi am Freitag')).toBeInTheDocument();

    // Bereiche nav deep-links into the lenses.
    expect(screen.getByRole('link', { name: /Graph/ })).toHaveAttribute('href', '/wissen/graph');
  });

  it('opens the detail drawer when a review preview row is clicked', async () => {
    openAtomSpy.mockClear();
    mockOverview({ review: [reviewAtom], memories: 1 });
    renderWithRouter(<OverviewLens />, { route: '/wissen' });

    const row = await screen.findByText('Lieblingsrestaurant');
    fireEvent.click(row);
    expect(openAtomSpy).toHaveBeenCalledTimes(1);
    expect(openAtomSpy.mock.calls[0][0].atom.atom_id).toBe('r1');
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
