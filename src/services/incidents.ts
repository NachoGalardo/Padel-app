import { supabase } from './supabase';

export async function listIncidents(tournamentId: string) {
  const { data, error } = await supabase
    .from('incidents')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createIncident(payload: { matchId: string; tournamentId: string; teamId: string; description: string }) {
  const { error } = await supabase.from('incidents').insert({
    match_id: payload.matchId,
    tournament_id: payload.tournamentId,
    raised_by_team_id: payload.teamId,
    description: payload.description,
  });
  if (error) throw error;
}

export async function resolveIncident(payload: { incidentId: string; resolution: string; newStatus: 'resolved' | 'rejected' }) {
  const { data, error } = await supabase.functions.invoke('resolve_incident', { body: payload });
  if (error) throw error;
  return data;
}

