/**
 * FactProvenance — provenance glyph + confidence label (eng-review D6/D-DETAIL).
 * German is the test default.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import FactProvenance from '../../../../src/frontend/src/components/FactProvenance';
import { renderWithRouter } from '../test-utils';

describe('FactProvenance', () => {
  it('deterministic → ✓ with the "verlässlich" label and no low-confidence hint', () => {
    renderWithRouter(<FactProvenance source="deterministic" confidence={1} />);
    expect(screen.getByLabelText('verlässlich')).toHaveTextContent('✓');
    expect(screen.queryByText('(geringes Vertrauen)')).not.toBeInTheDocument();
  });

  it('llm → ~ with the advisory label', () => {
    renderWithRouter(<FactProvenance source="llm" confidence={0.9} />);
    expect(screen.getByLabelText('Modell-Vorschlag')).toHaveTextContent('~');
  });

  it('shows the low-confidence hint only for advisory facts below 0.7', () => {
    renderWithRouter(<FactProvenance source="llm" confidence={0.5} />);
    expect(screen.getByText('(geringes Vertrauen)')).toBeInTheDocument();
  });

  it('does NOT show the hint for advisory facts at/above 0.7', () => {
    renderWithRouter(<FactProvenance source="llm" confidence={0.7} />);
    expect(screen.queryByText('(geringes Vertrauen)')).not.toBeInTheDocument();
  });

  it('never shows the hint for deterministic facts even if confidence is low', () => {
    renderWithRouter(<FactProvenance source="deterministic" confidence={0.1} />);
    expect(screen.queryByText('(geringes Vertrauen)')).not.toBeInTheDocument();
  });
});
