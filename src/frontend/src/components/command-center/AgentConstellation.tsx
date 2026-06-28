// Command Center centerpiece — a live, structural constellation of the running
// system. PROTOTYPE: renders standalone with demo data; not yet routed. See
// docs/design/command-center.md for the full spec and the deliberate departure
// from the "glowing orb" reference (DESIGN.md forbids decorative gradients/blobs).
//
// On-brand by construction: DESIGN.md tier/brand tokens only, thin connectors,
// only the *active* edge animates, prefers-reduced-motion honoured, a11y summary.
import { useTranslation } from 'react-i18next';

import type { CommandCenterModel, NodeHealth } from './types';
import { demoModel } from './demoData';

const C = 430; // svg centre (viewBox 860×860)
const R_ROLES = 150;
const R_TOOLS = 255;
const R_ROOMS = 345;
const R_CORE = 70;

const TOKEN = {
  core: 'var(--color-primary-600)',
  coreRing: 'var(--color-primary-700)',
  active: 'var(--color-accent-500)', // turquoise
  cream: 'var(--color-cream)',
  healthy: 'var(--color-accent-500)',
  degraded: 'var(--color-primary-300)',
  down: 'var(--color-primary-700)',
  unknown: 'var(--color-gray-400)',
} as const;

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

function healthColor(h: NodeHealth): string {
  return TOKEN[h];
}

function anchorFor(x: number): 'start' | 'middle' | 'end' {
  const dx = x - C;
  if (dx > 2) return 'start';
  if (dx < -2) return 'end';
  return 'middle';
}

interface Props {
  model?: CommandCenterModel;
  className?: string;
}

/** Read-only live constellation. Feed it a CommandCenterModel (Phase 1 assembles
 *  one from the six admin endpoints + the chat WS `done` frame); defaults to demo. */
export default function AgentConstellation({ model = demoModel, className }: Props) {
  const { t } = useTranslation();
  const { core, roles, tools, rooms, peers = [] } = model;
  const activeRole = roles.find((r) => r.id === core.activeRoleId);

  // even angular spread per ring (0° = top, clockwise)
  const at = (i: number, n: number) => (n > 0 ? (360 / n) * i : 0);
  // peers occupy a top arc (-55°..55°) so they read as an outer cluster, not a ring
  const peerAngle = (i: number, n: number) => (n > 1 ? -55 + (110 / (n - 1)) * i : 0);

  return (
    <div className={className}>
      <svg
        viewBox="0 0 860 860"
        className="w-full h-auto max-h-[70vh]"
        role="img"
        aria-labelledby="cc-title cc-desc"
      >
        <title id="cc-title">{t('commandCenter.title', { defaultValue: 'Command Center' })}</title>
        <desc id="cc-desc">
          {t('commandCenter.srSummary', {
            defaultValue:
              '{{roles}} agent roles, {{tools}} tools, {{rooms}} rooms. Active role: {{active}}.',
            roles: roles.length,
            tools: tools.length,
            rooms: rooms.length,
            active: activeRole?.label ?? t('commandCenter.idle', { defaultValue: 'idle' }),
          })}
        </desc>

        <style>{`
          .cc-core { transform-box: fill-box; transform-origin: center; animation: ccBreathe 5.5s ease-in-out infinite; }
          .cc-active-edge { stroke-dasharray: 6 8; animation: ccDash 1.1s linear infinite; }
          .cc-occupied { animation: ccPulse 2.8s ease-in-out infinite; }
          @keyframes ccBreathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.025); } }
          @keyframes ccDash { to { stroke-dashoffset: -28; } }
          @keyframes ccPulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
          @media (prefers-reduced-motion: reduce) {
            .cc-core, .cc-active-edge, .cc-occupied { animation: none; }
          }
        `}</style>

        {/* faint ring guides — structure, not decoration */}
        {[R_ROLES, R_TOOLS, R_ROOMS].map((r) => (
          <circle
            key={r}
            cx={C}
            cy={C}
            r={r}
            fill="none"
            stroke="var(--color-gray-300)"
            strokeOpacity={0.25}
            strokeWidth={1}
          />
        ))}

        {/* core → role connectors (only the active one animates) */}
        {roles.map((role, i) => {
          const [x, y] = polar(R_ROLES, at(i, roles.length));
          const [cx, cy] = polar(R_CORE + 2, at(i, roles.length));
          const isActive = role.id === core.activeRoleId;
          return (
            <line
              key={`edge-${role.id}`}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke={isActive ? TOKEN.active : 'var(--color-gray-400)'}
              strokeOpacity={isActive ? 0.9 : 0.22}
              strokeWidth={isActive ? 2.5 : 1.5}
              className={isActive ? 'cc-active-edge' : undefined}
            />
          );
        })}

        {/* ROOMS / SATELLITES ring (outermost full ring) */}
        {rooms.map((room, i) => {
          const deg = at(i, rooms.length);
          const [x, y] = polar(R_ROOMS, deg);
          const [lx, ly] = polar(R_ROOMS + 20, deg);
          const occupied = room.online && room.occupants > 0;
          const color = !room.online ? TOKEN.down : occupied ? TOKEN.active : TOKEN.unknown;
          return (
            <g key={`room-${room.id}`}>
              <circle
                cx={x}
                cy={y}
                r={9}
                fill={room.online ? color : 'none'}
                stroke={color}
                strokeWidth={2}
                strokeDasharray={room.online ? undefined : '3 3'}
                className={occupied ? 'cc-occupied' : undefined}
              />
              {occupied && (
                <text x={x} y={y + 3.5} textAnchor="middle" fontSize={10} fill={TOKEN.cream}>
                  {room.occupants}
                </text>
              )}
              <text
                x={lx}
                y={ly + 3}
                textAnchor={anchorFor(lx)}
                fontSize={13}
                fill="currentColor"
                className="text-gray-600 dark:text-gray-300"
              >
                {room.label}
              </text>
            </g>
          );
        })}

        {/* TOOLS / MCP ring */}
        {tools.map((tool, i) => {
          const deg = at(i, tools.length);
          const [x, y] = polar(R_TOOLS, deg);
          const [lx, ly] = polar(R_TOOLS + 18, deg);
          const color = healthColor(tool.health);
          return (
            <g key={`tool-${tool.id}`}>
              <rect
                x={x - 7}
                y={y - 7}
                width={14}
                height={14}
                rx={3}
                transform={`rotate(45 ${x} ${y})`}
                fill={tool.health === 'unknown' ? 'none' : color}
                stroke={color}
                strokeWidth={2}
              />
              <text
                x={lx}
                y={ly + 3}
                textAnchor={anchorFor(lx)}
                fontSize={12}
                fill="currentColor"
                className="text-gray-500 dark:text-gray-400"
              >
                {tool.label}
              </text>
            </g>
          );
        })}

        {/* ROLES ring */}
        {roles.map((role, i) => {
          const deg = at(i, roles.length);
          const [x, y] = polar(R_ROLES, deg);
          const [lx, ly] = polar(R_ROLES - 22, deg);
          const isActive = role.id === core.activeRoleId;
          return (
            <g key={`role-${role.id}`}>
              {isActive && (
                <circle cx={x} cy={y} r={16} fill={TOKEN.active} opacity={0.18} />
              )}
              <circle
                cx={x}
                cy={y}
                r={10}
                fill={isActive ? TOKEN.active : TOKEN.cream}
                stroke={isActive ? TOKEN.active : 'var(--color-gray-400)'}
                strokeWidth={2}
              />
              <text
                x={lx}
                y={ly + 3}
                textAnchor={anchorFor(lx)}
                fontSize={13}
                fontWeight={isActive ? 600 : 400}
                fill="currentColor"
                className={isActive ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-300'}
              >
                {role.label}
              </text>
            </g>
          );
        })}

        {/* PEERS — outer top arc, only when present */}
        {peers.map((peer, i) => {
          const deg = peerAngle(i, peers.length);
          const [x, y] = polar(R_ROOMS + 55, deg);
          return (
            <g key={`peer-${peer.id}`}>
              <circle
                cx={x}
                cy={y}
                r={7}
                fill="none"
                stroke={peer.online ? TOKEN.active : TOKEN.unknown}
                strokeWidth={2}
                strokeDasharray="2 3"
              />
              <text x={x} y={y - 12} textAnchor="middle" fontSize={11} fill="currentColor" className="text-gray-500 dark:text-gray-400">
                {peer.label}
              </text>
            </g>
          );
        })}

        {/* CORE */}
        <g className="cc-core">
          <circle cx={C} cy={C} r={R_CORE} fill={TOKEN.core} stroke={TOKEN.coreRing} strokeWidth={2} />
          <text
            x={C}
            y={C - 4}
            textAnchor="middle"
            fontSize={26}
            fill={TOKEN.cream}
            className="font-display"
          >
            {core.label}
          </text>
          {activeRole && (
            <text x={C} y={C + 20} textAnchor="middle" fontSize={12} fill={TOKEN.active}>
              {activeRole.label}
            </text>
          )}
        </g>
      </svg>

      {/* legend + sr-only enumeration (Tier-0 a11y: status not by colour alone) */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        {(['healthy', 'degraded', 'down', 'unknown'] as NodeHealth[]).map((h) => (
          <span key={h} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: healthColor(h) }} />
            {t(`commandCenter.legend.${h}`, { defaultValue: h })}
          </span>
        ))}
      </div>
    </div>
  );
}
