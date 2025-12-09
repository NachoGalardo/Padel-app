import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { acceptResult, listMatches, reportResult } from '@app/services/matches';
import { generateFixture, getTournament, listTournaments, registerTeam, withdrawTeam } from '@app/services/tournaments';

const tournamentsKey = ['tournaments'];

export function useTournaments() {
  const queryClient = useQueryClient();
  const listQuery = useQuery({
    queryKey: tournamentsKey,
    queryFn: listTournaments,
  });

  const registerMutation = useMutation({
    mutationFn: ({ tournamentId, teamId }: { tournamentId: string; teamId: string }) =>
      registerTeam(tournamentId, teamId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tournamentsKey }),
  });

  const withdrawMutation = useMutation({
    mutationFn: ({ tournamentId, teamId }: { tournamentId: string; teamId: string }) =>
      withdrawTeam(tournamentId, teamId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tournamentsKey }),
  });

  const fixtureMutation = useMutation({
    mutationFn: (tournamentId: string) => generateFixture(tournamentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tournamentsKey }),
  });

  return { listQuery, registerMutation, withdrawMutation, fixtureMutation };
}

export function useTournament(tournamentId?: string) {
  return useQuery({
    queryKey: ['tournament', tournamentId],
    queryFn: () => {
      if (!tournamentId) throw new Error('tournamentId requerido');
      return getTournament(tournamentId);
    },
    enabled: Boolean(tournamentId),
  });
}

export function useTournamentMatches(tournamentId?: string) {
  return useQuery({
    queryKey: ['matches', tournamentId],
    queryFn: () => {
      if (!tournamentId) throw new Error('tournamentId requerido');
      return listMatches(tournamentId);
    },
    enabled: Boolean(tournamentId),
  });
}

export function useMatchActions() {
  const queryClient = useQueryClient();
  const report = useMutation({
    mutationFn: reportResult,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['matches', variables.matchId] });
    },
  });
  const accept = useMutation({
    mutationFn: acceptResult,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['matches'] }),
  });
  return { report, accept };
}

