# Script de Despliegue Manual
# Uso: .\deploy.ps1

Write-Host "Iniciando despliegue manual a Supabase..." -ForegroundColor Cyan

# 1. Verificar login
$loginCheck = supabase projects list 2>&1
if ($loginCheck -match "You are not logged in") {
    Write-Host "No estas logueado. Por favor inicia sesion:" -ForegroundColor Yellow
    supabase login
}

# 2. Desplegar Migraciones de Base de Datos
Write-Host "Desplegando migraciones de base de datos..." -ForegroundColor Cyan
supabase db push

if ($LASTEXITCODE -eq 0) {
    Write-Host "Base de datos actualizada correctamente." -ForegroundColor Green
} else {
    Write-Host "Error al actualizar base de datos." -ForegroundColor Red
    exit 1
}

# 3. Desplegar Edge Functions
Write-Host "Desplegando Edge Functions..." -ForegroundColor Cyan
supabase functions deploy

if ($LASTEXITCODE -eq 0) {
    Write-Host "Edge Functions desplegadas correctamente." -ForegroundColor Green
} else {
    Write-Host "Error al desplegar funciones." -ForegroundColor Red
    exit 1
}

Write-Host "Despliegue completado con exito!" -ForegroundColor Green
