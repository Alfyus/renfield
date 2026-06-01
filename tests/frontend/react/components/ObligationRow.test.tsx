/**
 * ObligationRow — currency formatting (incl. the /review P1 regression: an
 * invalid LLM-extracted currency code must NOT crash the render), legal flag,
 * and frist labels. German default.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import ObligationRow from '../../../../src/frontend/src/components/ObligationRow';
import { renderWithRouter } from '../test-utils';
import type { DocumentFact } from '../../../../src/frontend/src/api/resources/brain';

const NOW = new Date(2026, 5, 1); // 2026-06-01 local

function fact(overrides: Partial<DocumentFact> = {}): DocumentFact {
  return {
    id: 1, document_id: 9, atom_id: null, category: 'obligation', kind: 'zahlung',
    value: 'Zahlung', normalized_value: null, excerpt: null,
    obligation_date: '2026-06-03', amount_value: 89.9, amount_currency: 'EUR',
    legal_gate: false, payment_method: null, confidence: null, source: 'deterministic',
    circle_tier: 0, ...overrides,
  };
}

describe('ObligationRow', () => {
  it('formats a valid currency amount (de)', () => {
    renderWithRouter(<ObligationRow fact={fact({ amount_value: 89.9, amount_currency: 'EUR' })} now={NOW} />);
    expect(screen.getByText('89,90 €')).toBeInTheDocument();
  });

  it('REGRESSION (/review P1): an invalid currency code does NOT throw — falls back to number + code', () => {
    // "EURO" is not a valid ISO-4217 code; Intl.NumberFormat would throw.
    expect(() =>
      renderWithRouter(<ObligationRow fact={fact({ amount_value: 12.5, amount_currency: 'EURO' })} now={NOW} />),
    ).not.toThrow();
    expect(screen.getByText(/12,50\s+EURO/)).toBeInTheDocument();
  });

  it('renders no amount when amount_value is null', () => {
    renderWithRouter(<ObligationRow fact={fact({ amount_value: null, amount_currency: null })} now={NOW} />);
    expect(screen.queryByText(/€/)).not.toBeInTheDocument();
  });

  it('shows the ⚑ rechtlich flag for legal_gate facts', () => {
    renderWithRouter(<ObligationRow fact={fact({ legal_gate: true })} now={NOW} />);
    expect(screen.getByText('rechtlich')).toBeInTheDocument();
    expect(screen.getByLabelText('Rechtliche Frist — erfordert Bestätigung')).toBeInTheDocument();
  });

  it('labels an overdue date with "seit"', () => {
    renderWithRouter(<ObligationRow fact={fact({ obligation_date: '2026-05-29' })} now={NOW} />);
    expect(screen.getByText(/seit 3 Tagen/)).toBeInTheDocument();
  });

  it('labels a future date with "in"', () => {
    renderWithRouter(<ObligationRow fact={fact({ obligation_date: '2026-06-05' })} now={NOW} />);
    expect(screen.getByText(/in 4 Tagen/)).toBeInTheDocument();
  });

  it('strikes the kind label when confirmed', () => {
    renderWithRouter(<ObligationRow fact={fact()} now={NOW} confirmed />);
    expect(screen.getByText('Zahlung').className).toContain('line-through');
  });
});
