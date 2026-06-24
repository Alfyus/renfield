import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { BASE_URL } from '../mocks/handlers';
import SatelliteEnrollment from '../../../../src/frontend/src/components/satellites/SatelliteEnrollment';
import { renderWithProviders } from '../test-utils';

/**
 * Security H1 (PR-C) — the enrollment admin UI. Test language is German
 * (test-utils sets 'de'), so assertions use the de.json strings.
 */

describe('SatelliteEnrollment', () => {
  it('mints a token and reveals it exactly once', async () => {
    server.use(
      http.get(`${BASE_URL}/api/satellites`, () =>
        HttpResponse.json({ satellites: [], latest_version: '' }),
      ),
      http.post(`${BASE_URL}/api/satellite-enrollment/enroll`, async ({ request }) => {
        const body = (await request.json()) as { satellite_id: string };
        return HttpResponse.json(
          { satellite_id: body.satellite_id, token: 'psk-secret-shown-once', rotated: false },
          { status: 201 },
        );
      }),
    );

    renderWithProviders(<SatelliteEnrollment />);

    await userEvent.type(screen.getByLabelText('Satelliten-ID'), 'sat-wohnzimmer');
    await userEvent.click(screen.getByRole('button', { name: 'Einschreiben' }));

    // The plaintext PSK is surfaced once, with the satellite id in the header.
    await waitFor(() => {
      expect(screen.getByText('psk-secret-shown-once')).toBeInTheDocument();
    });
    expect(screen.getByText('Schlüssel für sat-wohnzimmer erstellt')).toBeInTheDocument();
  });

  it('maps a 409 to the actionable "use Rotate" hint', async () => {
    server.use(
      http.get(`${BASE_URL}/api/satellites`, () =>
        HttpResponse.json({ satellites: [], latest_version: '' }),
      ),
      http.post(`${BASE_URL}/api/satellite-enrollment/enroll`, () =>
        HttpResponse.json({ detail: 'already enrolled' }, { status: 409 }),
      ),
    );

    renderWithProviders(<SatelliteEnrollment />);
    await userEvent.type(screen.getByLabelText('Satelliten-ID'), 'sat-x');
    await userEvent.click(screen.getByRole('button', { name: 'Einschreiben' }));

    await waitFor(() => {
      expect(screen.getByText(/Neu ausstellen/)).toBeInTheDocument();
    });
  });

  it('lists enrolled satellites with a revoke action', async () => {
    server.use(
      http.get(`${BASE_URL}/api/satellites`, () =>
        HttpResponse.json({ satellites: [], latest_version: '' }),
      ),
      http.get(`${BASE_URL}/api/satellite-enrollment`, () =>
        HttpResponse.json([
          {
            id: 1,
            satellite_id: 'sat-esszimmer',
            room: 'Esszimmer',
            is_enabled: true,
            enrolled_at: '2026-06-24T10:00:00',
            last_authenticated_at: null,
            revoked_at: null,
            connected: true,
          },
        ]),
      ),
    );

    renderWithProviders(<SatelliteEnrollment />);

    await waitFor(() => {
      expect(screen.getByText(/sat-esszimmer/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Widerrufen' })).toBeInTheDocument();
    // never-authenticated row shows the "never" sentinel.
    expect(screen.getByText(/nie/)).toBeInTheDocument();
  });

  it('shows the enforcing status badge when the fleet is enforcing', async () => {
    server.use(
      http.get(`${BASE_URL}/api/satellites`, () =>
        HttpResponse.json({ satellites: [], latest_version: '' }),
      ),
      http.get(`${BASE_URL}/api/satellite-enrollment/status`, () =>
        HttpResponse.json({
          enabled: true,
          autoflip_enabled: true,
          enforcing: true,
          total_enrolled: 3,
          pending_first_auth: 0,
        }),
      ),
    );

    renderWithProviders(<SatelliteEnrollment />);

    await waitFor(() => {
      expect(screen.getByText('Erzwungen')).toBeInTheDocument();
    });
    expect(screen.getByText('Enrollment aktiv')).toBeInTheDocument();
  });
});
