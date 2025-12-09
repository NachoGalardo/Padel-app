## Despliegue y operaciones

### Variables de entorno
- Frontend (Expo): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `SENTRY_DSN`, `EXPO_PROJECT_ID`, `PUSH_PUBLIC_KEY`.
- Edge Functions / backend: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (solo server), `SUPABASE_DB_URL` (para pg pool y transacciones), `SENTRY_DSN`, `JWT_SECRET`.
- Advertencia: nunca exponer `SUPABASE_SERVICE_ROLE_KEY` en cliente.

### Migraciones
1) Preparar `.env` con credenciales de servicio.
2) `supabase db push` o `supabase db reset` (solo entornos no productivos). En producción usar `supabase db push`/`migrate`.
3) Verificar RLS activo en tablas sensibles.

### Edge Functions
1) Empaquetar con `supabase functions deploy <name> --project-ref <ref>`.
2) Establecer variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SENTRY_DSN`, `JWT_SECRET`) en Supabase.
3) Confirmar timeout 8s y 1 retry en plataforma (o manejar en función).

### Backups
- Usar snapshots diarios de Supabase o `pg_dump` programado. Guardar al menos 7-14 días de retención.

### Monitoreo
- Sentry DSN configurado en frontend y funciones.
- Logs estructurados en Edge (agregar contexto de requestId/usuario).

### Mantenimiento
- Programar `maintenance_cleanup` (cron) para archivar torneos completados y purgar `audit_logs` > 90 días. Requiere RPC `delete_old_audit_logs`.

### Tests y CI
- Unit/integ: `npm test`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- CI: workflow `.github/workflows/ci.yml` (lint, typecheck, tests; placeholders para migraciones y edge deploy).


