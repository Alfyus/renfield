/**
 * IRK pairing flow — "pair my phone for presence".
 *
 * Lets an admin open a one-time pairing window on a satellite; the user pairs
 * their phone from its Bluetooth settings, and the satellite captures the IRK
 * (encrypted server-side) so the phone's rotating BLE address resolves to a
 * stable identity for room presence. No app, no hardware.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  usePresenceIrksQuery,
  useCaptureIrk,
  useDeletePresenceIrk,
  usePresenceUsersQuery,
} from '../../api/resources/presence';
import { useSatellitesQuery } from '../../api/resources/satellites';

export default function IrkPairing() {
  const { t } = useTranslation();
  const irksQuery = usePresenceIrksQuery();
  const usersQuery = usePresenceUsersQuery();
  const satellitesQuery = useSatellitesQuery(false);
  const capture = useCaptureIrk();
  const deleteIrk = useDeletePresenceIrk();

  const irks = irksQuery.data ?? [];
  const users = usersQuery.data ?? [];
  const satellites = satellitesQuery.data?.satellites ?? [];

  const [userId, setUserId] = useState<string>('');
  const [satelliteId, setSatelliteId] = useState<string>('');
  const [label, setLabel] = useState<string>('');
  const [message, setMessage] = useState<string | null>(null);

  const room = satellites.find((s) => s.satellite_id === satelliteId)?.room ?? '';
  const canStart = userId && satelliteId && label.trim().length > 0 && !capture.isPending;

  const handlePair = async () => {
    setMessage(null);
    try {
      await capture.mutateAsync({
        satellite_id: satelliteId,
        user_id: Number(userId),
        label: label.trim(),
        window_seconds: 60,
      });
      setMessage(t('presence.irk.captured'));
      setLabel('');
    } catch {
      setMessage(t('presence.irk.failed'));
    }
  };

  return (
    <section className="card mt-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t('presence.irk.title')}
      </h2>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {t('presence.irk.description')}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <select
          className="input"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          aria-label={t('presence.irk.user')}
        >
          <option value="">{t('presence.irk.selectUser')}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.username}</option>
          ))}
        </select>

        <select
          className="input"
          value={satelliteId}
          onChange={(e) => setSatelliteId(e.target.value)}
          aria-label={t('presence.irk.satellite')}
        >
          <option value="">{t('presence.irk.selectSatellite')}</option>
          {satellites.map((s) => (
            <option key={s.satellite_id} value={s.satellite_id}>
              {s.room || s.satellite_id}
            </option>
          ))}
        </select>

        <input
          className="input"
          type="text"
          value={label}
          placeholder={t('presence.irk.labelPlaceholder')}
          onChange={(e) => setLabel(e.target.value)}
          aria-label={t('presence.irk.label')}
        />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button className="btn-primary" disabled={!canStart} onClick={handlePair}>
          {capture.isPending ? t('presence.irk.waiting') : t('presence.irk.startPairing')}
        </button>
        {capture.isPending && (
          <span className="text-sm text-amber-600 dark:text-amber-400">
            {t('presence.irk.instructions', { room: room || t('presence.irk.theSatellite') })}
          </span>
        )}
      </div>

      {message && (
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{message}</p>
      )}

      {irks.length > 0 && (
        <ul className="mt-5 divide-y divide-gray-200 dark:divide-gray-700">
          {irks.map((irk) => {
            const owner = users.find((u) => u.id === irk.user_id)?.username ?? `#${irk.user_id}`;
            return (
              <li key={irk.id} className="flex items-center justify-between py-2">
                <span className="text-sm text-gray-800 dark:text-gray-200">
                  {irk.label} <span className="text-gray-400">· {owner}</span>
                  {!irk.is_enabled && (
                    <span className="ml-2 text-xs text-gray-400">({t('presence.irk.disabled')})</span>
                  )}
                </span>
                <button
                  className="btn-secondary text-sm"
                  onClick={() => deleteIrk.mutate(irk.id)}
                  disabled={deleteIrk.isPending}
                >
                  {t('presence.irk.revoke')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
