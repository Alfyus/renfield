import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { BASE_URL } from '../mocks/handlers';
import SatellitesPage from '../../../../src/frontend/src/pages/SatellitesPage';
import { renderWithProviders } from '../test-utils';
import type { SatelliteData } from '../../../../src/frontend/src/api/resources/satellites';

/**
 * Capability badges must reflect the satellite's REAL reported hardware,
 * not the legacy hardcoded "3 LEDs" for every device. i18n test language
 * is German (test-utils sets 'de'), so assertions use the de.json strings.
 */

function mockSatellites(sat: SatelliteData) {
  server.use(
    http.get(`${BASE_URL}/api/satellites`, () =>
      HttpResponse.json({ satellites: [sat], latest_version: '1.0.0' }),
    ),
  );
}

const base = {
  state: 'idle' as const,
  uptime_seconds: 120,
  heartbeat_ago_seconds: 2,
};

describe('SatellitesPage capability badges', () => {
  it('renders the real hardware of a fully-equipped satellite', async () => {
    mockSatellites({
      ...base,
      satellite_id: 'benszimmer',
      room: 'BensZimmer',
      capabilities: {
        local_wakeword: true,
        speaker: true,
        led_count: 12,
        led_type: 'xvf3800',
        mic_channels: 4,
        has_camera: true,
        has_display: true,
        has_enviro: true,
      },
    });

    renderWithProviders(<SatellitesPage />);

    // Cards render collapsed; capability badges live in the expanded body.
    await waitFor(() => {
      expect(screen.getByText('BensZimmer')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText('BensZimmer'));

    // Data-driven, not the hardcoded 3
    expect(await screen.findByText('12 LEDs')).toBeInTheDocument();
    expect(screen.getByText('4 Mikrofone')).toBeInTheDocument();
    expect(screen.getByText('Kamera')).toBeInTheDocument();
    expect(screen.getByText('Umweltsensor')).toBeInTheDocument();
    expect(screen.getByText('Wake Word')).toBeInTheDocument();
    expect(screen.getByText('Lautsprecher')).toBeInTheDocument();
    expect(screen.queryByText('3 LEDs')).not.toBeInTheDocument();
  });

  it('shows conservative badges for a legacy/minimal satellite', async () => {
    mockSatellites({
      ...base,
      satellite_id: 'old-sat',
      room: 'Wohnzimmer',
      capabilities: {
        local_wakeword: true,
        speaker: true,
        led_count: 3,
        mic_channels: 1,
        has_camera: false,
        has_display: false,
        has_enviro: false,
      },
    });

    renderWithProviders(<SatellitesPage />);

    await waitFor(() => {
      expect(screen.getByText('Wohnzimmer')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText('Wohnzimmer'));

    expect(await screen.findByText('3 LEDs')).toBeInTheDocument();
    // Single-mic → no Mics badge; absent optional hardware → no badges
    expect(screen.queryByText('1 Mikrofone')).not.toBeInTheDocument();
    expect(screen.queryByText('Kamera')).not.toBeInTheDocument();
    expect(screen.queryByText('Umweltsensor')).not.toBeInTheDocument();
  });
});
