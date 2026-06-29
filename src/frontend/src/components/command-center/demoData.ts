// Demo model so <AgentConstellation /> renders standalone (prototype / Storybook /
// design review) without backend wiring. Mirrors a realistic Renfield household:
// roles from agent_roles.yaml, the live MCP integrations, the real satellites.
import type { CommandCenterModel } from './types';

export const demoModel: CommandCenterModel = {
  core: { label: 'Renfield', activeRoleId: 'smart_home' },
  roles: [
    { id: 'smart_home', label: 'Smart Home' },
    { id: 'knowledge', label: 'Knowledge' },
    { id: 'media', label: 'Media' },
    { id: 'presence', label: 'Presence' },
    { id: 'conversation', label: 'Conversation' },
    { id: 'general', label: 'General' },
  ],
  tools: [
    { id: 'homeassistant', label: 'Home Assistant', health: 'healthy' },
    { id: 'paperless', label: 'Paperless', health: 'healthy' },
    { id: 'jellyfin', label: 'Jellyfin', health: 'healthy' },
    { id: 'calendar', label: 'Calendar', health: 'healthy' },
    { id: 'email', label: 'Email', health: 'degraded' },
    { id: 'search', label: 'Search', health: 'healthy' },
    { id: 'n8n', label: 'n8n', health: 'healthy' },
    { id: 'dlna', label: 'DLNA', health: 'healthy' },
    { id: 'weather', label: 'Weather', health: 'healthy' },
    { id: 'news', label: 'News', health: 'unknown' },
    { id: 'radio', label: 'Radio', health: 'down' },
  ],
  rooms: [
    { id: 'wohnzimmer', label: 'Wohnzimmer', online: true, occupants: 2 },
    { id: 'esszimmer', label: 'Esszimmer', online: true, occupants: 1 },
    { id: 'arbeitszimmer', label: 'Arbeitszimmer', online: true, occupants: 0 },
    { id: 'kinderbad', label: 'Kinderbad', online: true, occupants: 0 },
    { id: 'fitnessraum', label: 'Fitnessraum', online: false, occupants: 0 },
  ],
  peers: [{ id: 'reva', label: 'Reva', online: true }],
};
