/**
 * Satellite enrollment admin API (security review H1, PR-C).
 *
 * Mints / lists / revokes the per-satellite enrollment PSK. The plaintext token
 * is returned exactly once by the enroll mutation — the UI surfaces it and never
 * re-fetches it (only the bcrypt hash is stored server-side).
 */
import { useQueryClient } from '@tanstack/react-query';

import apiClient from '../../utils/axios';
import { useApiQuery, useApiMutation } from '../hooks';
import { keys, STALE } from '../keys';

export interface EnrolledSatellite {
  id: number;
  satellite_id: string;
  room: string | null;
  is_enabled: boolean;
  enrolled_at: string | null;
  last_authenticated_at: string | null;
  revoked_at: string | null;
  connected: boolean;
}

export interface EnrollmentStatus {
  enabled: boolean;
  autoflip_enabled: boolean;
  enforcing: boolean;
  total_enrolled: number;
  pending_first_auth: number;
}

export interface EnrollPayload {
  satellite_id: string;
  room?: string | null;
  rotate?: boolean;
}

export interface EnrollResult {
  satellite_id: string;
  token: string;
  rotated: boolean;
}

async function fetchEnrollments(): Promise<EnrolledSatellite[]> {
  const res = await apiClient.get<EnrolledSatellite[]>('/api/satellite-enrollment');
  return Array.isArray(res.data) ? res.data : [];
}

async function fetchStatus(): Promise<EnrollmentStatus> {
  const res = await apiClient.get<EnrollmentStatus>('/api/satellite-enrollment/status');
  return res.data;
}

async function enrollRequest(input: EnrollPayload): Promise<EnrollResult> {
  const res = await apiClient.post<EnrollResult>('/api/satellite-enrollment/enroll', input);
  return res.data;
}

async function revokeRequest(satelliteId: string): Promise<void> {
  await apiClient.delete(`/api/satellite-enrollment/${encodeURIComponent(satelliteId)}`);
}

export function useSatelliteEnrollmentsQuery() {
  return useApiQuery(
    {
      queryKey: keys.satellites.enrollment(),
      queryFn: fetchEnrollments,
      staleTime: STALE.DEFAULT,
    },
    'common.error',
  );
}

export function useEnrollmentStatusQuery() {
  return useApiQuery(
    {
      queryKey: keys.satellites.enrollmentStatus(),
      queryFn: fetchStatus,
      staleTime: STALE.DEFAULT,
    },
    'common.error',
  );
}

export function useEnrollSatellite() {
  const queryClient = useQueryClient();
  return useApiMutation(
    {
      mutationFn: enrollRequest,
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: keys.satellites.all });
      },
    },
    'common.error',
  );
}

export function useRevokeSatelliteEnrollment() {
  const queryClient = useQueryClient();
  return useApiMutation(
    {
      mutationFn: revokeRequest,
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: keys.satellites.all });
      },
    },
    'common.error',
  );
}
