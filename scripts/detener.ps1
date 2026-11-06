#requires -Version 7.0
<#
.SINOPSIS
    Detiene el entorno local de control de alquiler de maquinaria.
.DESCRIPCION
    Lee logs/pids.json y detiene solo esos PIDs. Luego hace un barrido por
    linea de comando para procesos del proyecto y libera los puertos
    3000, 3002, 3003 y 8000 sin tocar procesos ajenos. Detiene MariaDB solo
    si fue iniciada por iniciar.ps1. Termina con exit 1 ante errores graves.
#>
[CmdletBinding()]
param(
    [string]$Raiz = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

$Raiz = (Resolve-Path -LiteralPath $Raiz).Path
$Logs = Join-Path $Raiz 'logs'
$ArchivoPids = Join-Path $Logs 'pids.json'

function Escribir-Info([string]$Texto) { Write-Host "[INFO] $Texto" -ForegroundColor Cyan }
function Escribir-Ok([string]$Texto) { Write-Host "[ OK ] $Texto" -ForegroundColor Green }
function Escribir-Aviso([string]$Texto) { Write-Host "[AVISO] $Texto" -ForegroundColor Yellow }
function Fallar([string]$Texto) { Write-Host "[ERROR] $Texto" -ForegroundColor Red; exit 1 }

function Stop-PorId {
    param([int]$Id, [string]$Nombre)
    try {
        $proceso = Get-Process -Id $Id -ErrorAction Stop
        Stop-Process -Id $Id -Force -ErrorAction Stop
        Escribir-Ok "$Nombre detenido (PID $Id, $($proceso.ProcessName))."
    } catch {
        Escribir-Info "$Nombre (PID $Id) ya no existe. Se omite."
    }
}

function Test-EsDelProyecto {
    param([string]$Linea)
    if ([string]::IsNullOrWhiteSpace($Linea)) { return $false }
    if ($Linea -like '*construccion V2*') { return $true }
    $patrones = @('*enrutador.php*', '*apinode*servidor.js*', '*api-gateway*server.js*', '*frontend-server*server.js*', '*servidor:app*')
    foreach ($patron in $patrones) {
        if ($Linea -like $patron) { return $true }
    }
    return $false
}

# 1. Detener PIDs registrados (solo esos).
$mariadbIniciada = $false
$mariadbPid = $null
if (Test-Path -LiteralPath $ArchivoPids) {
    $pids = Get-Content -LiteralPath $ArchivoPids -Raw -Encoding utf8 | ConvertFrom-Json
    foreach ($clave in @('php', 'node', 'python', 'gateway', 'frontend')) {
        $valor = $pids.$clave
        if ($null -ne $valor) { Stop-PorId -Id ([int]$valor) -Nombre $clave }
    }
    $mariadbIniciada = [bool]$pids.mariadbIniciada
    $mariadbPid = $pids.mariadb
} else {
    Escribir-Aviso "No existe logs/pids.json. Solo se hara barrido por linea de comando."
}

# 2. Barrido por linea de comando (solo php/node/python del proyecto).
# Nunca toca pwsh ni otros ejecutables aunque su linea mencione la carpeta.
$propios = $PID
$procesos = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $propios }
$detenidos = 0
foreach ($proc in $procesos) {
    if (($proc.Name -in @('php.exe', 'node.exe', 'python.exe')) -and (Test-EsDelProyecto -Linea $proc.CommandLine)) {
        try {
            Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
            Escribir-Ok "Barrido: detenido PID $($proc.ProcessId) ($($proc.Name))."
            $detenidos++
        } catch {
            Escribir-Aviso "Barrido: no se pudo detener PID $($proc.ProcessId)."
        }
    }
}
if ($detenidos -eq 0) { Escribir-Info "Barrido: no quedan procesos del proyecto." }

# 3. Liberar puertos del proyecto sin tocar procesos ajenos.
# Los puertos fijos del proyecto son 3000 (gateway), 3002 (API Node),
# 3003 (API Python), 8000 (API PHP), 8443 (frontend) y 8082 (demo Expo Web).
# El dueño del puerto se considera del proyecto si su linea de comando lo
# dice O si es exactamente el entrypoint del proyecto (server.js/
# servidor.js/enrutador.php) escuchando en un puerto fijo: así un arranque
# previo que no dejó pids.json no bloquea el inicio.
foreach ($puerto in @(3000, 3002, 3003, 8000, 8443, 8082)) {
    $conexiones = Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue
    foreach ($conexion in $conexiones) {
        $dueno = Get-CimInstance Win32_Process -Filter "ProcessId = $($conexion.OwningProcess)" -ErrorAction SilentlyContinue
        if ($null -eq $dueno) { continue }
        $linea = $dueno.CommandLine
        $tifica = ($dueno.Name -in @('php.exe', 'node.exe', 'python.exe')) -and
            (($linea -notmatch '^\s*$') -and (
                (Test-EsDelProyecto -Linea $linea) -or
                ($linea -match '(?<![\w/\\])(server\.js|servidor\.js|enrutador\.php)(?=[\s"]*$)')))
        if ($tifica) {
            try {
                Stop-Process -Id $dueno.ProcessId -Force -ErrorAction Stop
                Escribir-Ok "Puerto $puerto liberado (PID $($dueno.ProcessId))."
            } catch {
                Fallar "No se pudo liberar el puerto $puerto (PID $($dueno.ProcessId))."
            }
        } else {
            Escribir-Aviso "Puerto $puerto ocupado por proceso ajeno ($($dueno.Name), PID $($dueno.ProcessId)). No se toca."
        }
    }
}

# 4. MariaDB solo si la inicio este proyecto.
if ($mariadbIniciada -and ($null -ne $mariadbPid)) {
    Stop-PorId -Id ([int]$mariadbPid) -Nombre 'mariadb'
} else {
    Escribir-Info "MariaDB no fue iniciada por este proyecto. Se deja en ejecucion."
}

# 5. Limpiar registro de PIDs.
if (Test-Path -LiteralPath $ArchivoPids) {
    Remove-Item -LiteralPath $ArchivoPids -Force
    Escribir-Ok "Archivo logs/pids.json eliminado."
}

Escribir-Ok "Entorno detenido."
