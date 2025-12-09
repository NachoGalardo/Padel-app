// Edge Function: accept_result
// Responsabilidad: validar rival, marcar resultado aceptado y confirmar match.

import * as Sentry from '@sentry/node';
import {
  getUserAndRole,
  withTransaction,
  isCircuitOpen,
  recordFailure,
  adminClient,
} from './_shared';

interface AcceptPayload {
  matchId: string;
}

export default async function handler(req: Request): Promise<Response> {
  try {
    if (isCircuitOpen()) return new Response('Servicio temporalmente pausado', { status: 503 });
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) return new Response('Falta token', { status: 401 });

    const { userId } = await getUserAndRole(token);
    const body = (await req.json()) as AcceptPayload;
    if (!body.matchId) return new Response('matchId requerido', { status: 400 });

    // Validar que el usuario pertenece al equipo rival y que el resultado está pendiente
    const { data: match, error: matchError } = await adminClient
      .from('matches')
      .select('id, home_team_id, away_team_id, status, tournament_id')
      .eq('id', body.matchId)
      .single();
    if (matchError || !match) return new Response('Partido no encontrado', { status: 404 });

    const { data: membership } = await adminClient
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId)
      .in('team_id', [match.home_team_id, match.away_team_id]);
    if (!membership || membership.length === 0) return new Response('No sos rival', { status: 403 });

    await withTransaction(async (client) => {
      const { rows: results } = await client.query(
        `select mr.id, mr.accepted, mr.set_scores, mr.sets_won_home, mr.sets_won_away,
                m.home_team_id, m.away_team_id, m.tournament_id
           from public.match_results mr
           join public.matches m on m.id = mr.match_id
          where mr.match_id = $1
          for update`,
        [body.matchId]
      );
      if (results.length === 0) throw new Error('Resultado no encontrado');
      const result = results[0];
      if (result.accepted === true) throw new Error('Resultado ya aceptado');

      await client.query(
        `update public.match_results
            set accepted = true,
                accepted_by = $2,
                accepted_at = timezone('utc', now()),
                updated_at = timezone('utc', now())
          where match_id = $1`,
        [body.matchId, userId]
      );

      const winnerTeamId =
        result.sets_won_home > result.sets_won_away
          ? result.home_team_id
          : result.sets_won_home < result.sets_won_away
          ? result.away_team_id
          : null;

      await client.query(
        `update public.matches
            set status = 'confirmed',
                winner_team_id = $2,
                updated_at = timezone('utc', now())
          where id = $1`,
        [body.matchId, winnerTeamId]
      );

      await client.query(
        `insert into public.events(event_type, tournament_id, match_id, team_id, user_id, payload, created_at)
         values ('result_request', $1, $2, null, $3, $4, timezone('utc', now()))`,
        [match.tournament_id, body.matchId, userId, { accepted: true }]
      );
    });

    // TODO: notificar ambos equipos (realtime + push)
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    recordFailure();
    Sentry.captureException(err);
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

