#requires -Version 7.0
<#
.SINOPSIS
    Crea un respaldo logico de la base de datos controlalquiler.
.DESCRIPCION
    Usa mysqldump con --single-transaction --routines --events --triggers
    --hex-blob. La clave se toma de la variable de entorno DB_PASS o del
    primer .env que la defina (nunca esta escrita en este script). Verifica
    que el archivo pese mas de 0 bytes y conserva solo los ultimos 7
    respaldos. Termina con exit 1 ante cualquier error.
#>
[CmdletBinding()]
param(
    [string]$Raiz = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

$Raiz = (Resolve-Path -LiteralPath $Raiz).Path
$DirRespaldos = Join-Path $Raiz 'respaldos'
New-Item -ItemType Directory -Force -Path $DirRespaldos | Out-Null

function Escribir-Info([string]$Texto) { Write-Host "[INFO] $Texto" -ForegroundColor Cyan }
function Escribir-Ok([string]$Texto) { Write-Host "[ OK ] $Texto" -ForegroundColor Green }
function Fallar([string]$Texto) { Write-Host "[ERROR] $Texto" -ForegroundColor Red; exit 1 }

function Leer-Env([string]$Ruta, [string]$Clave) {
    if (-not (Test-Path -LiteralPath $Ruta)) { return $null }
    foreach ($linea in (Get-Content -LiteralPath $Ruta -Encoding utf8)) {
        $recortada = $linea.Trim()
        if ($recortada -eq '' -or $recortada.StartsWith('#')) { continue }
        $partes = $recortada -split '=', 2
        if ($partes.Count -eq 2 -and $partes[0].Trim() -eq $Clave) {
            return $partes[1].Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

# 1. Credenciales sin hardcodear: entorno primero, .env despues.
$usuario = if ($env:DB_USER) { $env:DB_USER } else { $null }
$clave = if ($env:DB_PASS) { $env:DB_PASS } else { $null }
$base = if ($env:DB_NAME) { $env:DB_NAME } else { 'controlalquiler' }
if ([string]::IsNullOrWhiteSpace($usuario) -or [string]::IsNullOrWhiteSpace($clave)) {
    $candidatos = @(
        (Join-Path $Raiz '.env'),
        (Join-Path $Raiz 'apis\apinode\.env'),
        (Join-Path $Raiz 'apis\apipython\.env'),
        (Join-Path $Raiz 'apis\apiphp\.env'),
        (Join-Path $Raiz 'api-gateway\.env')
    )
    foreach ($ruta in $candidatos) {
        if ([string]::IsNullOrWhiteSpace($usuario)) { $usuario = Leer-Env -Ruta $ruta -Clave 'DB_USER' }
        if ([string]::IsNullOrWhiteSpace($clave)) { $clave = Leer-Env -Ruta $ruta -Clave 'DB_PASS' }
        if ([string]::IsNullOrWhiteSpace($base) -or $base -eq 'controlalquiler') {
            $otro = Leer-Env -Ruta $ruta -Clave 'DB_NAME'
            if (-not [string]::IsNullOrWhiteSpace($otro)) { $base = $otro }
        }
    }
}
if ([string]::IsNullOrWhiteSpace($usuario)) { $usuario = 'root' }
if ([string]::IsNullOrWhiteSpace($clave)) {
    Fallar "No se encontro DB_PASS en el entorno ni en ningun .env. Defina la variable e reintente."
}

$Mysqldump = 'C:\xampp\mysql\bin\mysqldump.exe'
if (-not (Test-Path -LiteralPath $Mysqldump)) {
    $enPath = Get-Command mysqldump -ErrorAction SilentlyContinue
    if ($null -eq $enPath) { Fallar "No se encontro mysqldump.exe (XAMPP) ni en el PATH." }
    $Mysqldump = $enPath.Source
}

# 2. Generar respaldo.
$nombre = "controlalquiler_$(Get-Date -Format 'yyyy-MM-dd_HHmm').sql"
$destino = Join-Path $DirRespaldos $nombre
Escribir-Info "Respaldando base '$base' en $nombre ..."
# La clave viaja por MYSQL_PWD (no aparece en la lista de procesos).
$env:MYSQL_PWD = $clave
$argumentos = @(
    '--protocol=TCP', '-h', '127.0.0.1', '-P', '3306',
    '-u', $usuario,
    '--single-transaction', '--routines', '--events', '--triggers', '--hex-blob',
    $base
)
try {
    & $Mysqldump @argumentos | Set-Content -LiteralPath $destino -Encoding utf8
} finally {
    Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
}
if ($LASTEXITCODE -ne 0) {
    if (Test-Path -LiteralPath $destino) { Remove-Item -LiteralPath $destino -Force }
    Fallar "mysqldump fallo. Verifique credenciales y servicio MySQL."
}

# 3. Verificar tamaño mayor que 0.
$peso = (Get-Item -LiteralPath $destino).Length
if ($peso -le 0) {
    Remove-Item -LiteralPath $destino -Force
    Fallar "El respaldo quedo vacio (0 bytes). Se elimino el archivo."
}
Escribir-Ok "Respaldo creado: $nombre ($peso bytes)."

# 4. Conservar solo los ultimos 7.
$antiguos = Get-ChildItem -LiteralPath $DirRespaldos -Filter 'controlalquiler_*.sql' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 7
foreach ($archivo in $antiguos) {
    Remove-Item -LiteralPath $archivo.FullName -Force
    Escribir-Info "Respaldo antiguo eliminado: $($archivo.Name)."
}

Escribir-Ok "Respaldo verificado. No se sube a Git (ver .gitignore)."
