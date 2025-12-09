import { supabase } from './supabase';

export async function listMatches(tournamentId: string) {
  const { data, error } = await supabase
    .from('matches')
    .select('*, match_results(*)')
    .eq('tournament_id', tournamentId)
    .order('scheduled_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function reportResult(payload: {
  matchId: string;
  reporterTeamId: string;
  resultType: 'normal' | 'walkover';
  setScores: Array<{ home: number; away: number }>;
}) {
  const { data, error } = await supabase.functions.invoke('report_result', { body: payload });
  if (error) throw error;
  return data;
}

export async function acceptResult(matchId: string) {
  const { data, error } = await supabase.functions.invoke('accept_result', { body: { matchId } });
  if (error) throw error;
  return data;
}

