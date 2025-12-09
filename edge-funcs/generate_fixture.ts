// Edge Function: generate_fixture
// Responsabilidad: validar rol admin, ejecutar generación de fixture con transacción y locks.

import * as Sentry from '@sentry/node';
import { getUserAndRole, requireAdmin, withTransaction, isCircuitOpen, recordFailure } from './_shared';

export default async function handler(req: Request): Promise<Response> {
  try {
    if (isCircuitOpen()) return new Response('Servicio temporalmente pausado', { status: 503 });
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) return new Response('Falta token', { status: 401 });

    const { role } = await getUserAndRole(token);
    requireAdmin(role);

    const { tournamentId } = (await req.json()) as { tournamentId?: string };
    if (!tournamentId) return new Response('tournamentId requerido', { status: 400 });

    await withTransaction(async (client) => {
      // Lock del torneo para evitar concurrencia
      const { rows } = await client.query(
        'select id, status from public.tournaments where id = $1 for update',
        [tournamentId]
      );
      if (rows.length === 0) throw new Error('Torneo no encontrado');
      if (rows[0].status !== 'open' && rows[0].status !== 'draft') {
        throw new Error('Estado inválido para generar fixture');
      }
      await client.query('select internal.generate_fixture($1)', [tournamentId]);
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    recordFailure();
    Sentry.captureException(err);
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

