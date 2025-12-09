import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createIncident, listIncidents, resolveIncident } from '@app/services/incidents';

export function useIncidents(tournamentId?: string) {
  return useQuery({
    queryKey: ['incidents', tournamentId],
    queryFn: () => {
      if (!tournamentId) throw new Error('tournamentId requerido');
      return listIncidents(tournamentId);
    },
    enabled: Boolean(tournamentId),
  });
}

export function useIncidentActions(tournamentId?: string) {
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: createIncident,
    onSuccess: () => {
      if (tournamentId) queryClient.invalidateQueries({ queryKey: ['incidents', tournamentId] });
    },
  });

  const resolve = useMutation({
    mutationFn: resolveIncident,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['incidents', tournamentId] });
      queryClient.invalidateQueries({ queryKey: ['incidents', variables.incidentId] });
    },
  });

  return { create, resolve };
}

