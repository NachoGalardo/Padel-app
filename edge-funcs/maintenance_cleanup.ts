// Edge Function: maintenance_cleanup
// Responsabilidad: archivar torneos completados y purgar audit_logs > 90 días.

import * as Sentry from '@sentry/node';
import { adminClient, isCircuitOpen, recordFailure } from './_shared';

export default async function handler(): Promise<Response> {
  try {
    if (isCircuitOpen()) return new Response('Servicio temporalmente pausado', { status: 503 });
    // Archivar torneos completados
    const { error: archiveError } = await adminClient
      .from('tournaments')
      .update({ status: 'archived' })
      .eq('status', 'completed')
      .lte('final_match_deadline', new Date().toISOString());
    if (archiveError) throw archiveError;

    // Purgar audit_logs > 90 días
    const { error: purgeError } = await adminClient.rpc('delete_old_audit_logs', { days_threshold: 90 });
    if (purgeError) throw purgeError;

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    recordFailure();
    Sentry.captureException(err);
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
}

