/**
 * WissenSearchBar — lens-scoped omnisearch (D7 + D9 full-unify).
 *
 * Covers: cross-corpus overlay (scope=everything), scope=lens filtering on a
 * non-consuming lens, overlay suppression on a consuming lens (Documents/Graph
 * run their own inline search off ?q=), and Escape-to-clear.
 */
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import { renderWithRouter, userEvent } from '../test-utils';
import { server } from '../mocks/server';
import { TEST_CONFIG } from '../config';
import WissenSearchBar from '../../../../src/frontend/src/components/wissen/WissenSearchBar';

const BASE_URL = TEST_CONFIG.API_BASE_URL;

const atom = (atom_id: string, atom_type: string, snippet: string) => ({
  atom: { atom_id, atom_type, tier: 2 },
  score: 1,
  snippet,
  rank: 1,
});

function mockAtoms() {
  server.use(
    http.get(`${BASE_URL}/api/atoms`, () =>
      HttpResponse.json([
        atom('a1', 'kg_node', 'Graph entity Mueller'),
        atom('a2', 'kb_document', 'Rechnung 2024 document'),
        atom('a3', 'document_fact', 'Frist 31.12. Steuer'),
      ]),
    ),
  );
}

describe('WissenSearchBar', () => {
  it('scope=everything shows the whole-corpus overlay', async () => {
    mockAtoms();
    renderWithRouter(<WissenSearchBar />, { route: '/wissen/graph?scope=everything' });

    await userEvent.type(screen.getByRole('searchbox'), 'x');

    expect(await screen.findByText('Graph entity Mueller')).toBeInTheDocument();
    expect(screen.getByText('Rechnung 2024 document')).toBeInTheDocument();
    expect(screen.queryByText(/Nichts gefunden/)).not.toBeInTheDocument();
  });

  it('scope=lens filters the overlay to the active lens atom types (non-consuming lens)', async () => {
    mockAtoms();
    // Fristen owns document_fact and has no inline search → overlay, filtered.
    renderWithRouter(<WissenSearchBar />, { route: '/wissen/fristen' });

    await userEvent.type(screen.getByRole('searchbox'), 'x');

    expect(await screen.findByText('Frist 31.12. Steuer')).toBeInTheDocument();
    expect(screen.queryByText('Graph entity Mueller')).not.toBeInTheDocument();
    expect(screen.queryByText('Rechnung 2024 document')).not.toBeInTheDocument();
  });

  it('D9: suppresses the overlay on a consuming lens at scope=lens (lens searches inline)', async () => {
    mockAtoms();
    // Graph consumes ?q= inline (entity-table filter) → no cross-corpus overlay.
    renderWithRouter(<WissenSearchBar />, { route: '/wissen/graph' });

    await userEvent.type(screen.getByRole('searchbox'), 'mueller');

    // Give any (incorrect) overlay fetch a chance to render, then assert absence.
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByText('Graph entity Mueller')).not.toBeInTheDocument();
  });

  it('on the index lens (no atom types) scope=lens still searches the whole corpus', async () => {
    mockAtoms();
    // Übersicht (/wissen, segment '') owns no atom types → must not filter to
    // nothing at the default scope=lens (the landing-page omnisearch bug).
    renderWithRouter(<WissenSearchBar />, { route: '/wissen' });

    await userEvent.type(screen.getByRole('searchbox'), 'x');

    expect(await screen.findByText('Graph entity Mueller')).toBeInTheDocument();
    expect(screen.getByText('Rechnung 2024 document')).toBeInTheDocument();
    expect(screen.queryByText(/Nichts gefunden/)).not.toBeInTheDocument();
  });

  it('Escape clears the query and closes the overlay', async () => {
    mockAtoms();
    renderWithRouter(<WissenSearchBar />, { route: '/wissen/graph?scope=everything' });

    const box = screen.getByRole('searchbox');
    await userEvent.type(box, 'x');
    await screen.findByText('Graph entity Mueller');

    await userEvent.type(box, '{Escape}');

    expect(box).toHaveValue('');
    expect(screen.queryByText('Graph entity Mueller')).not.toBeInTheDocument();
  });
});
