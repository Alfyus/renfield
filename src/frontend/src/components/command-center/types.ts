// Command Center — typed model for the live constellation.
// See docs/design/command-center.md. The component is fed this shape; Phase 1
// assembles it from the six existing admin endpoints + the chat WS `done` frame.

export type NodeHealth = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface CoreNode {
  /** Display name of the orchestrator, e.g. "Renfield". */
  label: string;
  /** id of the agent role answering the current turn, if any (live pulse). */
  activeRoleId?: string;
}

export interface RoleNode {
  id: string;
  /** Human label, already localized by the caller (roles come from agent_roles.yaml). */
  label: string;
}

export interface ToolNode {
  id: string;
  label: string;
  health: NodeHealth;
}

export interface RoomNode {
  id: string;
  label: string;
  online: boolean;
  /** Number of people the presence service currently places in this room. */
  occupants: number;
}

export interface PeerNode {
  id: string;
  label: string;
  online: boolean;
}

export interface CommandCenterModel {
  core: CoreNode;
  roles: RoleNode[];
  tools: ToolNode[];
  rooms: RoomNode[];
  /** Federation instances — optional; the outer arc is omitted when empty. */
  peers?: PeerNode[];
}
