# Database Workflow

We have transitioned from manual SQL file management to a version-controlled migration workflow using the Supabase CLI.

## Prerequisites
- Docker installed and running.
- Supabase CLI installed (`npm install -g supabase`).

## Local Development

### Starting the Database
To start the local Supabase stack (Database, Auth, Edge Functions, etc.):
```bash
supabase start
```
This will automatically apply all migrations in `supabase/migrations`.

### Making Schema Changes
1.  **Create a migration file**:
    ```bash
    supabase migration new description_of_change
    ```
    This creates a new SQL file in `supabase/migrations/` with a timestamp.

2.  **Edit the file**: Add your SQL statements (CREATE TABLE, ALTER TABLE, etc.) to the new file.

3.  **Apply changes locally**:
    ```bash
    supabase db reset
    ```
    *Note: This resets the local database and reapplies all migrations. For non-destructive updates, you can use `supabase db push` if connected to a remote, but locally `reset` is cleanest.*

## Deployment to Production

### Automated (CI/CD)
The GitHub Actions workflow is configured to automatically deploy changes when merging to `main`.
- Migrations are applied using `supabase db push`.
- Edge Functions are deployed using `supabase functions deploy`.

### Manual (Emergency)
If CI/CD fails, you can deploy manually:
1.  Login: `supabase login`
2.  Link project: `supabase link --project-ref <project-id>`
3.  Push DB changes: `supabase db push`
