/**
 * FaktenPanel — empty states (D2/D11), grouped render, and lazy fetch (D-IA-1).
 * German default.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import FaktenPanel from '../../../../../src/frontend/src/components/knowledge/FaktenPanel';
import { renderWithRouter, createMockResponse } from '../../test-utils';
import apiClient from '../../../../../src/frontend/src/utils/axios';
import type { DocumentFact } from '../../../../../src/frontend/src/api/resources/brain';

vi.mock('../../../../../src/frontend/src/utils/axios', () => ({
  default: { get: vi.fn() },
  extractApiError: (_e: unknown, fallback: string) => fallback,
  extractFieldErrors: () => ({}),
}));

const mockedGet = vi.mocked(apiClient.get);

function fact(overrides: Partial<DocumentFact>): DocumentFact {
  return {
    id: 1, document_id: 9, atom_id: null, category: 'identifier', kind: 'steuernummer',
    value: '114/5876/5293', normalized_value: null, excerpt: null, obligation_date: null,
    amount_value: null, amount_currency: null, legal_gate: false, payment_method: null,
    confidence: null, source: 'deterministic', circle_tier: 0, ...overrides,
  };
}

function wire({ flagsEnabled, facts }: { flagsEnabled: boolean; facts: DocumentFact[] }) {
  mockedGet.mockImplementation((url: string) => {
    if (url.includes('/api/config/features')) {
      return Promise.resolve(createMockResponse({ schicht_a_extraction_enabled: flagsEnabled }));
    }
    if (url.includes('/facts')) return Promise.resolve(createMockResponse(facts));
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

describe('FaktenPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockReset();
  });

  it('does NOT fetch facts while collapsed (lazy)', () => {
    wire({ flagsEnabled: true, facts: [] });
    renderWithRouter(<FaktenPanel documentId={9} status="completed" open={false} onToggle={() => {}} />);
    expect(mockedGet.mock.calls.some(([u]) => String(u).includes('/facts'))).toBe(false);
  });

  it('shows the disabled state when extraction is off and there are no facts (D11)', async () => {
    wire({ flagsEnabled: false, facts: [] });
    renderWithRouter(<FaktenPanel documentId={9} status="completed" open onToggle={() => {}} />);
    expect(await screen.findByText('Fakten-Extraktion ist deaktiviert.')).toBeInTheDocument();
  });

  it('shows the plain empty state when extraction is on but no facts', async () => {
    wire({ flagsEnabled: true, facts: [] });
    renderWithRouter(<FaktenPanel documentId={9} status="completed" open onToggle={() => {}} />);
    expect(await screen.findByText('Keine Fakten gefunden.')).toBeInTheDocument();
  });

  it('renders grouped facts with the value', async () => {
    wire({
      flagsEnabled: true,
      facts: [fact({ id: 1, kind: 'steuernummer', value: '114/5876/5293' })],
    });
    renderWithRouter(<FaktenPanel documentId={9} status="completed" open onToggle={() => {}} />);
    expect(await screen.findByText('114/5876/5293')).toBeInTheDocument();
    // identifier group label (Kennzeichen)
    expect(screen.getByText('Kennzeichen')).toBeInTheDocument();
  });

  it('shows the extracting state while the document is still processing', async () => {
    wire({ flagsEnabled: true, facts: [] });
    renderWithRouter(<FaktenPanel documentId={9} status="processing" open onToggle={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText('Fakten werden extrahiert …')).toBeInTheDocument(),
    );
  });
});
