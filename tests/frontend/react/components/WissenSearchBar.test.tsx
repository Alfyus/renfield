/**
 * WissenSearchBar — lens-scoped omnisearch (plan-eng-review D9 + /review follow-up).
 *
 * Covers the logic-dense bits the review flagged as untested: the scope filter
 * (Diese Ansicht vs Alles), Escape-to-clear, and that results render after the
 * debounce without the empty-state flashing first.
 */
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
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
      ]),
    ),
  );
}

describe('WissenSearchBar', () => {
  it('shows corpus results after the debounce (scope = Alles)', async () => {
    mockAtoms();
    renderWithRouter(<WissenSearchBar />, { route: '/wissen/graph' });

    await userEvent.type(screen.getByRole('searchbox'), 'rechnung');

    expect(await screen.findByText('Graph entity Mueller')).toBeInTheDocument();
    expect(screen.getByText('Rechnung 2024 document')).toBeInTheDocument();
    // The empty-state must NOT be present once results arrive (debounce-flash fix).
    expect(screen.queryByText(/Nichts gefunden/)).not.toBeInTheDocument();
  });

  it('scope "Diese Ansicht" filters results to the active lens atom types', async () => {
    mockAtoms();
    renderWithRouter(<WissenSearchBar />, { route: '/wissen/graph' });

    await userEvent.type(screen.getByRole('searchbox'), 'x');
    await screen.findByText('Graph entity Mueller');

    await userEvent.click(screen.getByRole('button', { name: 'Diese Ansicht' }));

    // graph lens owns kg_node/kg_edge → kb_document is filtered out.
    expect(screen.getByText('Graph entity Mueller')).toBeInTheDocument();
    expect(screen.queryByText('Rechnung 2024 document')).not.toBeInTheDocument();
  });

  it('Escape clears the query and closes the results overlay', async () => {
    mockAtoms();
    renderWithRouter(<WissenSearchBar />, { route: '/wissen/graph' });

    const box = screen.getByRole('searchbox');
    await userEvent.type(box, 'rechnung');
    await screen.findByText('Graph entity Mueller');

    await userEvent.type(box, '{Escape}');

    expect(box).toHaveValue('');
    await waitFor(() =>
      expect(screen.queryByText('Graph entity Mueller')).not.toBeInTheDocument(),
    );
  });
});
