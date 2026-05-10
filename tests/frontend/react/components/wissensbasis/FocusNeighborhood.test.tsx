import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';

import { FocusNeighborhood } from '../../../../../src/frontend/src/components/wissensbasis/FocusNeighborhood';
import { WissensbasisProvider } from '../../../../../src/frontend/src/context/WissensbasisContext';
import { renderWithRouter } from '../../test-utils';

describe('FocusNeighborhood', () => {
  it('renders empty placeholder when no data', () => {
    renderWithRouter(
      <WissensbasisProvider>
        <FocusNeighborhood data={null} />
      </WissensbasisProvider>,
    );
    expect(screen.getByText(/Klicke auf einen Zitations-Chip/)).toBeInTheDocument();
  });

  it('renders focus card + hop1 chips + overflow link', () => {
    renderWithRouter(
      <WissensbasisProvider>
        <FocusNeighborhood
          data={{
            focus: {
              entity_id: 'r1',
              display_name: 'PRODUCT-A 1.3.5',
              entity_type: 'release',
              importance: 0.5,
            },
            hop1: [
              { entity_id: 'PAY-1', display_name: 'PAY-1', entity_type: 'ticket', importance: 0.3 },
              { entity_id: 'PAY-2', display_name: 'PAY-2', entity_type: 'ticket', importance: 0.2 },
            ],
            hop2: [],
            edges: [],
            overflow_hop1: 5,
            overflow_hop2: 0,
          }}
        />
      </WissensbasisProvider>,
    );

    expect(screen.getByText('PRODUCT-A 1.3.5')).toBeInTheDocument();
    // Tests default to DE — the importance line reads "Wichtigkeit 50%".
    expect(screen.getByText(/Wichtigkeit 50%/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fokus auf PAY-1/ })).toBeInTheDocument();
    // Overflow link with +N more text
    expect(screen.getByText('+5 weitere')).toBeInTheDocument();
  });

  it('shows error message when one is provided', () => {
    renderWithRouter(
      <WissensbasisProvider>
        <FocusNeighborhood data={null} errorMessage="Backend down" />
      </WissensbasisProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Backend down');
  });
});
