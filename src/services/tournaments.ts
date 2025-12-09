import { supabase } from './supabase';

export async function listTournaments() {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*')
    .order('start_date', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getTournament(id: string) {
  const { data, error } = await supabase.from('tournaments').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export async function registerTeam(tournamentId: string, teamId: string) {
  const { error } = await supabase.from('tournament_entries').insert({ tournament_id: tournamentId, team_id: teamId });
  if (error) throw error;
}

export async function withdrawTeam(tournamentId: string, teamId: string) {
  const { error } = await supabase.from('tournament_entries').delete().eq('tournament_id', tournamentId).eq('team_id', teamId);
  if (error) throw error;
}

export async function generateFixture(tournamentId: string) {
  const { data, error } = await supabase.functions.invoke('generate_fixture', {
    body: { tournamentId },
  });
  if (error) throw error;
  return data;
}

