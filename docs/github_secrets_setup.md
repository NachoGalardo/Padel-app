# GitHub Secrets Setup

To enable the automated CI/CD pipeline, you need to configure the following secrets in your GitHub repository settings.

## Required Secrets

| Secret Name | Description | How to get it |
|-------------|-------------|---------------|
| `SUPABASE_ACCESS_TOKEN` | Personal Access Token for Supabase CLI | Generate at [Supabase Access Tokens](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_DB_PASSWORD` | Password for your database | You set this when creating the project. If lost, reset in Project Settings > Database. |
| `SUPABASE_PROJECT_ID` | The unique ID of your Supabase project | Found in Project Settings > General (Reference ID). |

## Optional Secrets (for App)

| Secret Name | Description |
|-------------|-------------|
| `VITE_SUPABASE_URL` | URL of your Supabase project |
| `VITE_SUPABASE_ANON_KEY` | Anonymous public key |

## How to Add Secrets
1.  Go to your GitHub repository.
2.  Click on **Settings** > **Secrets and variables** > **Actions**.
3.  Click **New repository secret**.
4.  Enter the Name and Secret value.
5.  Click **Add secret**.
