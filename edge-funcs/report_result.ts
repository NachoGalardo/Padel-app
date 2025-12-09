// Edge Function: report_result
// Responsabilidad: reportar resultado, insertar match_results pendiente de aceptación, notificar.

import * as Sentry from '@sentry/node';
import { getUserAndRole, withTransaction, isCircuitOpen, recordFailure, adminClient } from './_shared';

interface ReportPayload {
  matchId: string;
  reporterTeamId: string;
  resultType: 'normal' | 'walkover';
  setScores: Array<{ home: number; away: number }>;
}

export default async function handler(req: Request): Promise<Response> {
  try {
    if (isCircuitOpen()) return new Response('Servicio temporalmente pausado', { status: 503 });
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) return new Response('Falta token', { status: 401 });

    const { userId } = await getUserAndRole(token);
    const body = (await req.json()) as ReportPayload;
    if (!body.matchId || !body.reporterTeamId) return new Response('Datos incompletos', { status: 400 });

    // Validar pertenencia al equipo (fuera de tx para respuesta rápida)
    const { data: member, error: memberError } = await adminClient
      .from('team_members')
      .select('id')
      .eq('team_id', body.reporterTeamId)
      .eq('user_id', userId)
      .single();
    if (memberError || !member) return new Response('No sos miembro del equipo', { status: 403 });

    await withTransaction(async (client) => {
      // Lock del partido
      const { rows: matches } = await client.query(
        `select m.id, m.home_team_id, m.away_team_id, m.status, m.tournament_id,
                t.final_match_deadline, t.allow_post_deadline_edits
           from public.matches m
           join public.tournaments t on t.id = m.tournament_id
          where m.id = $1
          for update`,
        [body.matchId]
      );
      if (matches.length === 0) throw new Error('Partido no encontrado');
      const match = matches[0];

      const nowUtc = new Date();
      if (!match.allow_post_deadline_edits && nowUtc > new Date(match.final_match_deadline)) {
        throw new Error('Fuera de plazo de reporte');
      }

      const isHome = match.home_team_id === body.reporterTeamId;
      const isAway = match.away_team_id === body.reporterTeamId;
      if (!isHome && !isAway) throw new Error('Equipo no pertenece al partido');

      // Upsert resultado pendiente
      await client.query(
        `insert into public.match_results
           (match_id, reporter_team_id, reporter_user_id, result_type, set_scores, sets_won_home, sets_won_away, accepted, created_at, updated_at)
         values ($1,$2,$3,$4,$5,
                 (select coalesce(sum((sc->>'home')::int > (sc->>'away')::int)::int,0) from jsonb_array_elements($5) sc),
                 (select coalesce(sum((sc->>'away')::int > (sc->>'home')::int)::int,0) from jsonb_array_elements($5) sc),
                 null, timezone('utc', now()), timezone('utc', now()))
         on conflict (match_id) do update
           set reporter_team_id = excluded.reporter_team_id,
               reporter_user_id = excluded.reporter_user_id,
               result_type = excluded.result_type,
               set_scores = excluded.set_scores,
               sets_won_home = excluded.sets_won_home,
               sets_won_away = excluded.sets_won_away,
               accepted = null,
               accepted_by = null,
               accepted_at = null,
               updated_at = timezone('utc', now())`,
        [body.matchId, body.reporterTeamId, userId, body.resultType, JSON.stringify(body.setScores)]
      );

      await client.query('update public.matches set status = $1, updated_at = timezone(\'utc\', now()) where id = $2', [
        'reported',
        body.matchId,
      ]);

      await client.query(
        `insert into public.events(event_type, tournament_id, match_id, team_id, user_id, payload, created_at)
         values ('result_reported', $1, $2, $3, $4, $5, timezone('utc', now()))`,
        [match.tournament_id, body.matchId, body.reporterTeamId, userId, { setScores: body.setScores }]
      );
    });

    // TODO: notificar rival (realtime + push)
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    recordFailure();
    Sentry.captureException(err);
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

