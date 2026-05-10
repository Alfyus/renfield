import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';

import { NextActionChip } from '../../../../../src/frontend/src/components/wissensbasis/NextActionChip';
import { renderWithRouter } from '../../test-utils';

describe('NextActionChip', () => {
  it('renders the suggestion and a disabled draft button (T19 v1)', () => {
    renderWithRouter(
      <NextActionChip
        blockerEntityId="acc-1"
        blockerDisplay="Anna Müller"
        suggestion="Anna ist verfügbar — sprich sie zu PAY-901 an."
        available
      />,
    );

    expect(
      screen.getByText('Anna ist verfügbar — sprich sie zu PAY-901 an.'),
    ).toBeInTheDocument();

    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    // T19 v1 stub never ships a usable draft action — verify the contract.
    expect(btn).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows delegate when present', () => {
    renderWithRouter(
      <NextActionChip
        blockerEntityId="acc-1"
        blockerDisplay="Anna"
        suggestion="Anna ist nicht erreichbar."
        delegateDisplay="Marie Klein"
        available={false}
      />,
    );
    expect(screen.getByText(/Vertretung: Marie Klein/)).toBeInTheDocument();
  });
});
