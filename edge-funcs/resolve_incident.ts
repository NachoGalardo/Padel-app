// Edge Function: resolve_incident
// Responsabilidad: admin resuelve incidencias, actualiza estado y audita.

import * as Sentry from '@sentry/node';
import { getUserAndRole, requireAdmin, withTransaction, isCircuitOpen, recordFailure } from './_shared';

interface ResolvePayload {
  incidentId: string;
  resolution: string;
  newStatus: 'resolved' | 'rejected';
}

export default async function handler(req: Request): Promise<Response> {
  try {
    if (isCircuitOpen()) return new Response('Servicio temporalmente pausado', { status: 503 });
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) return new Response('Falta token', { status: 401 });

    const { userId, role } = await getUserAndRole(token);
    requireAdmin(role);

    const body = (await req.json()) as ResolvePayload;
    if (!body.incidentId || !body.newStatus) return new Response('Datos incompletos', { status: 400 });

    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `select id, match_id, tournament_id from public.incidents where id = $1 for update`,
        [body.incidentId]
      );
      if (rows.length === 0) throw new Error('Incidencia no encontrada');
      const incident = rows[0];

      await client.query(
        `update public.incidents
            set status = $2,
                resolution = $3,
                resolved_by = $4,
                resolved_at = timezone('utc', now()),
                updated_at = timezone('utc', now())
          where id = $1`,
        [body.incidentId, body.newStatus, body.resolution, userId]
      );

      await client.query(
        `insert into public.events(event_type, tournament_id, match_id, team_id, user_id, payload, created_at)
         values ('incident_resolved', $1, $2, null, $3, $4, timezone('utc', now()))`,
        [incident.tournament_id, incident.match_id, userId, { status: body.newStatus }]
      );
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    recordFailure();
    Sentry.captureException(err);
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

