#requires -Version 7.0
<#
.SINOPSIS
    Inicia el entorno local de control de alquiler de maquinaria.
.DESCRIPCION
    Verifica requisitos, inicia MariaDB de XAMPP si hace falta, crea la
    base de datos con esquema.sql solo si falta, instala dependencias solo
    si faltan, inicia las 4 API en segundo plano, comprueba /salud y abre
    el frontend. Los registros quedan en logs/ y los PIDs en logs/pids.json.
    Termina con exit 1 ante cualquier error.
#>
[CmdletBinding()]
param(
    [string]$Raiz = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

$Raiz = (Resolve-Path -LiteralPath $Raiz).Path
$Logs = Join-Path $Raiz 'logs'
$ArchivoPids = Join-Path $Logs 'pids.json'
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

function Escribir-Info([string]$Texto) { Write-Host "[INFO] $Texto" -ForegroundColor Cyan }
function Escribir-Ok([string]$Texto) { Write-Host "[ OK ] $Texto" -ForegroundColor Green }
function Escribir-Aviso([string]$Texto) { Write-Host "[AVISO] $Texto" -ForegroundColor Yellow }
function Fallar([string]$Texto) { Write-Host "[ERROR] $Texto" -ForegroundColor Red; exit 1 }

function Test-PuertoLibre {
    param([int]$Puerto)
    $cliente = $null
    try {
        $cliente = New-Object Net.Sockets.TcpClient
        $manejador = $cliente.BeginConnect('127.0.0.1', $Puerto, $null, $null)
        $conectado = $manejador.AsyncWaitHandle.WaitOne(500)
        return -not $conectado
    } catch {
        return $true
    } finally {
        if ($null -ne $cliente) { $cliente.Close() }
    }
}

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

function Test-EsProcesoServicio {
    param($Proceso)
    if ($null -eq $Proceso) { return $false }
    return ($Proceso.Name -in @('php.exe', 'node.exe', 'python.exe'))
}

function Test-EsDelProyecto {
    param([string]$Linea)
    if ([string]::IsNullOrWhiteSpace($Linea)) { return $false }
    if ($Linea -like '*construccion V2*') { return $true }
    $patrones = @('*enrutador.php*', '*apinode*servidor.js*', '*api-gateway*server.js*', '*servidor:app*')
    foreach ($patron in $patrones) {
        if ($Linea -like $patron) { return $true }
    }
    return $false
}

function Test-EsProyectoOriginal {
    param([string]$Linea)
    if ([string]::IsNullOrWhiteSpace($Linea)) { return $false }
    if ($Linea -like '*construccion V2*') { return $false }
    return ($Linea -like '*Control de alquiler de maquinaria*')
}
# NOTA: Test-EsProyectoOriginal ya no se usa para bloquear: iniciar.ps1 ahora
# cierra automaticamente cualquier proceso viejo que tenga los puertos del
# sistema (propio o ajeno), salvo los protegidos de la lista $protegidos.

function Liberar-PuertosProyecto {
    param([int[]]$Puertos)
    # Procesos que NUNCA se cierran: MariaDB compartida, Apache de XAMPP y procesos de sistema.
    $protegidos = @('mysqld.exe', 'httpd.exe', 'apache.exe', 'w3wp.exe', 'svchost.exe', 'spoolsv.exe', 'csrss.exe', 'wininit.exe', 'services.exe')
    foreach ($puerto in $Puertos) {
        $espera = (Get-Date).AddSeconds(10)
        while ((Get-Date) -lt $espera) {
            $ocupantes = Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue
            if ($null -eq $ocupantes) { break }
            $pendiente = $false
            foreach ($conexion in $ocupantes) {
                $dueno = Get-CimInstance Win32_Process -Filter "ProcessId = $($conexion.OwningProcess)" -ErrorAction SilentlyContinue
                if ($null -eq $dueno) { continue }
                $linea = [string]$dueno.CommandLine
                $nombre = [string]$dueno.Name
                $esNodePhpPython = $nombre -in @('php.exe', 'node.exe', 'python.exe')
                $marcaProyecto = ($linea -like '*enrutador.php*') -or ($linea -like '*servidor.js*') -or ($linea -like '*servidor:app*') -or ($linea -like '*uvicorn*')
                $marcaCarpetaV2 = $linea -like '*construccion V2*'
                if ($protegidos -contains $nombre.ToLower()) {
                    Fallar "El puerto $puerto lo tiene un proceso protegido del sistema ($nombre, PID $($dueno.ProcessId)). Cierralo a mano y ejecute iniciar.bat de nuevo."
                }
                $razonViejo = ''
                if ($esNodePhpPython -and ($marcaCarpetaV2 -or (Test-EsDelProyecto -Linea $linea) -or $marcaProyecto)) {
                    $razonViejo = 'propio'
                } else {
                    $razonViejo = 'ajeno'
                }
                try {
                    Stop-Process -Id $dueno.ProcessId -Force -ErrorAction Stop
                    if ($razonViejo -eq 'propio') {
                        Escribir-Info "Proceso viejo del proyecto cerrado (puerto $puerto, PID $($dueno.ProcessId), $nombre)."
                    } else {
                        Escribir-Info "Proceso que tenia el puerto $puerto cerrado para iniciar limpio (PID $($dueno.ProcessId), $nombre)."
                    }
                } catch {
                    Escribir-Aviso "No se pudo cerrar el proceso del puerto $puerto (PID $($dueno.ProcessId), $nombre). Se reintentara."
                }
                $pendiente = $true
            }
            if ($pendiente) { Start-Sleep -Seconds 1 }
        }
        if ($null -ne (Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue)) {
            Fallar "El puerto $puerto quedo ocupado tras el cierre automatico. Reinicie el PC o cierre a mano el proceso en escucha y ejecute iniciar.bat otra vez."
        }
    }
    Escribir-Ok "Puertos $($Puertos -join ', ') liberados para un arranque limpio."
}

function Esperar-Salud {
    param([string]$Nombre, [string]$Url)
    $limite = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $limite) {
        try {
            $respuesta = Invoke-WebRequest -Uri $Url -TimeoutSec 5 -SkipHttpErrorCheck -SkipCertificateCheck
            $codigo = [int]$respuesta.StatusCode
            if ($codigo -eq 200) {
                Escribir-Ok "$Nombre responde en $Url."
                return $true
            }
            if ($Nombre -eq 'API PHP' -and ($codigo -eq 401 -or $codigo -eq 403)) {
                Escribir-Ok "$Nombre protegida por clave interna ($codigo), servicio vivo."
                return $true
            }
        } catch {
            Start-Sleep -Seconds 2
        }
        Start-Sleep -Seconds 2
    }
    Fallar "$Nombre no respondio en $Url despues de 60 segundos. Revise logs/."
    return $false
}

# 1. Versión de PowerShell.
if ($PSVersionTable.PSVersion.Major -lt 7) {
    Fallar "Se requiere PowerShell 7 o superior. Version actual: $($PSVersionTable.PSVersion)."
}
Escribir-Ok "PowerShell $($PSVersionTable.PSVersion) detectado."

# 2. Herramientas obligatorias.
foreach ($herramienta in @('php', 'node', 'python')) {
    if ($null -eq (Get-Command $herramienta -ErrorAction SilentlyContinue)) {
        Fallar "No se encontro '$herramienta' en el PATH. Instale el requisito y reintente."
    }
    Escribir-Ok "Herramienta '$herramienta' disponible."
}
$MysqlExe = 'C:\xampp\mysql\bin\mysql.exe'
if (-not (Test-Path -LiteralPath $MysqlExe)) {
    $enPath = Get-Command mysql -ErrorAction SilentlyContinue
    if ($null -eq $enPath) {
        Fallar "No se encontro mysql.exe (XAMPP) ni en el PATH."
    }
    $MysqlExe = $enPath.Source
}
Escribir-Ok "Cliente MySQL: $MysqlExe."

# 0. Matar procesos viejos del proyecto y liberar sus puertos.
# Solo toca procesos del proyecto (pids.json o linea de comando con
# enrutador.php, servidor.js, servidor:app, uvicorn o la carpeta V2).
# Nunca toca el proyecto original V1 ni procesos ajenos: ante esos falla.
if (Test-Path -LiteralPath $ArchivoPids) {
    try {
        $viejos = Get-Content -LiteralPath $ArchivoPids -Raw -Encoding utf8 | ConvertFrom-Json
        foreach ($clave in @('php', 'node', 'python', 'gateway')) {
            $valor = $viejos.$clave
            if ($null -ne $valor) { Stop-PorId -Id ([int]$valor) -Nombre "viejo $clave" }
        }
    } catch {
        Escribir-Aviso "logs/pids.json ilegible. Se continua con el barrido."
    }
}
$barridos = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessId -ne $PID }
foreach ($proc in $barridos) {
    if ((Test-EsProcesoServicio -Proceso $proc) -and (Test-EsDelProyecto -Linea ([string]$proc.CommandLine))) {
        try {
            Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
            Escribir-Ok "Proceso viejo del proyecto detenido (PID $($proc.ProcessId), $($proc.Name))."
        } catch {
            Escribir-Aviso "No se pudo detener PID $($proc.ProcessId)."
        }
    }
}
Liberar-PuertosProyecto -Puertos @(3000, 3002, 3003, 8000, 8443)
Escribir-Ok "Puertos 3000, 3002, 3003, 8000 y 8443 libres de procesos viejos."

# 3. MariaDB (XAMPP) solo si el puerto 3306 esta libre.
$mariadbPid = $null
$mariadbIniciada = $false
if (Test-PuertoLibre -Puerto 3306) {
    Escribir-Info "Puerto 3306 libre. Iniciando MariaDB de XAMPP..."
    $Ini = 'C:\xampp\mysql\bin\my.ini'
    $Mysqld = 'C:\xampp\mysql\bin\mysqld.exe'
    if (-not (Test-Path -LiteralPath $Ini)) { Fallar "No existe $Ini (ruta defecto XAMPP)." }
    if (-not (Test-Path -LiteralPath $Mysqld)) { Fallar "No existe $Mysqld (ruta defecto XAMPP)." }
    $proceso = Start-Process -FilePath $Mysqld `
        -ArgumentList "--defaults-file=`"$Ini`"", '--standalone' `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $Logs 'mariadb.salida.log') `
        -RedirectStandardError (Join-Path $Logs 'mariadb.error.log') `
        -PassThru
    $mariadbPid = $proceso.Id
    $mariadbIniciada = $true
    $limite = (Get-Date).AddSeconds(30)
    while ((Test-PuertoLibre -Puerto 3306) -and ((Get-Date) -lt $limite)) {
        Start-Sleep -Seconds 1
    }
    if (Test-PuertoLibre -Puerto 3306) {
        Fallar "MariaDB no acepto conexiones en 30 segundos. Revise logs/mariadb.error.log."
    }
    Escribir-Ok "MariaDB iniciada por este script (PID $mariadbPid)."
} else {
    Escribir-Info "Puerto 3306 ocupado. Se usa la instancia existente de MariaDB."
}

# 4. Base de datos: claves propias, esquema con marcadores y endurecimiento.
$Esquema = Join-Path $Raiz 'basededatos\esquema.sql'
if (-not (Test-Path -LiteralPath $Esquema)) { Fallar "No existe $Esquema." }

function Nueva-Clave {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return ([Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', '') + 'aA1*'
}

function Leer-ValorEnv {
    param([string]$Ruta, [string]$Clave)
    if (-not (Test-Path -LiteralPath $Ruta)) { return '' }
    foreach ($linea in Get-Content -LiteralPath $Ruta -Encoding UTF8) {
        if ($linea -match ('^\s*' + [regex]::Escape($Clave) + '\s*=\s*(.+)$')) {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return ''
}

function Escribir-ValorEnv {
    param([string]$Ruta, [string]$Clave, [string]$Valor)
    $contenido = ''
    if (Test-Path -LiteralPath $Ruta) { $contenido = Get-Content -LiteralPath $Ruta -Raw -Encoding UTF8 }
    if ($contenido -match ('(?m)^\s*' + [regex]::Escape($Clave) + '\s*=.*$')) {
        $contenido = [regex]::Replace($contenido, ('(?m)^\s*' + [regex]::Escape($Clave) + '\s*=.*$'), ($Clave + '=' + $Valor))
    } else {
        $contenido = $contenido.TrimEnd() + [Environment]::NewLine + $Clave + '=' + $Valor + [Environment]::NewLine
    }
    Set-Content -LiteralPath $Ruta -Value $contenido -Encoding UTF8 -NoNewline
}

# Clave root: DB_ROOT_PASS > basededatos/.root.env > generada (guardada en .root.env).
$ArchivoRoot = Join-Path $Raiz 'basededatos\.root.env'
$ClaveRoot = ''
if ($env:DB_ROOT_PASS) { $ClaveRoot = $env:DB_ROOT_PASS }
else { $ClaveRoot = Leer-ValorEnv -Ruta $ArchivoRoot -Clave 'DB_ROOT_PASS' }
$RootGenerada = ($ClaveRoot -eq '')
if ($RootGenerada) { $ClaveRoot = Nueva-Clave; Escribir-ValorEnv -Ruta $ArchivoRoot -Clave 'DB_ROOT_PASS' -Valor $ClaveRoot }

# Claves de los 3 usuarios de BD: se leen de cada .env; si faltan, se generan ahi.
$ClavesApi = @{}
foreach ($par in @(
    @{ Dir = 'apis\apiphp'; Usuario = 'usuariophp'; Marcador = '@CLAVE_PHP@' },
    @{ Dir = 'apis\apinode'; Usuario = 'usuarionode'; Marcador = '@CLAVE_NODE@' },
    @{ Dir = 'apis\apipython'; Usuario = 'usuariopython'; Marcador = '@CLAVE_PYTHON@' }
)) {
    $rutaEnv = Join-Path $Raiz ($par.Dir + '\.env')
    $valor = Leer-ValorEnv -Ruta $rutaEnv -Clave 'DB_PASS'
    if ($valor -eq '' -or $valor -in @('TU_CLAVE_AQUI', 'contrasena_segura_aqui')) {
        $valor = Nueva-Clave
        if (-not (Test-Path -LiteralPath $rutaEnv)) {
            $ejemplo = Join-Path $Raiz ($par.Dir + '\.env.example')
            if (Test-Path -LiteralPath $ejemplo) { Copy-Item -LiteralPath $ejemplo -Destination $rutaEnv }
            else { New-Item -ItemType File -Path $rutaEnv -Force | Out-Null }
        }
        Escribir-ValorEnv -Ruta $rutaEnv -Clave 'DB_PASS' -Valor $valor
        Escribir-ValorEnv -Ruta $rutaEnv -Clave 'DB_USER' -Valor $par.Usuario
        Escribir-ValorEnv -Ruta $rutaEnv -Clave 'DB_NAME' -Valor 'controlalquiler'
        Escribir-Ok "Clave de BD generada para $($par.Usuario) (guardada en .env)."
    }
    $ClavesApi[$par.Marcador] = $valor
}

# Conexion al cliente MySQL: MYSQL_PWD (no aparece en la lista de procesos).
function Invoke-MySql {
    param([string]$Sql, [string]$Clave)
    $anterior = $env:MYSQL_PWD
    if ($null -eq $Clave -or $Clave -eq '') { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
    else { $env:MYSQL_PWD = $Clave }
    try {
        $salida = & $MysqlExe --protocol=TCP -h 127.0.0.1 -P 3306 -u root -N -B -e $Sql 2>$null
        return @{ Codigo = $LASTEXITCODE; Salida = ($salida -join [Environment]::NewLine) }
    } finally {
        if ($null -eq $anterior -or $anterior -eq '') { Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue }
        else { $env:MYSQL_PWD = $anterior }
    }
}

# Probar candidata, luego claves legadas de XAMPP.
$ClaveConexion = $null
foreach ($intento in @($ClaveRoot, '0000', '')) {
    $prueba = Invoke-MySql -Sql 'SELECT 1;' -Clave $intento
    if ([int]$prueba.Codigo -eq 0) { $ClaveConexion = $intento; break }
}
if ($null -eq $ClaveConexion) {
    Fallar "No se pudo conectar a MariaDB como root (probada la clave del proyecto y las legadas). Revise basededatos/.root.env."
}
if ($RootGenerada) {
    Escribir-Aviso "Clave root nueva generada y guardada en basededatos/.root.env (no se imprime)."
}

# Modo compartido: si root funciona con una clave distinta de la del
# proyecto (p. ej. '0000' de XAMPP porque otra aplicacion administra la
# misma instancia), el esquema NO rota la clave root ni toca variables
# globales del servidor (event_scheduler/local_infile), para no romper
# a las demas bases en la misma instancia. Ver docs/seguridad.md.
$CompartidaMariaDB = ($ClaveConexion -ne $ClaveRoot)
if ($CompartidaMariaDB) {
    Escribir-Aviso "Instancia compartida de MariaDB detectada (root con clave distinta de basededatos/.root.env). Se respeta la clave vigente de root y no se tocan las variables globales del servidor."
}

# Aplicar esquema SIEMPRE (es idempotente y mantiene el endurecimiento al dia).
# Detecta si la columna de cambio de clave existe (para marcar al admin tras migrar).
# En modo compartido la clave root sustituida es la VIGENTE (no se rota).
$colExiste = Invoke-MySql -Sql "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='controlalquiler' AND TABLE_NAME='usuarios' AND COLUMN_NAME='debe_cambiar_clave';" -Clave $ClaveConexion
$MigrarCambioClave = ($colExiste.Codigo -ne 0 -or $colExiste.Salida.Trim() -ne '1')
$SqlCrudo = Get-Content -Raw -Encoding UTF8 $Esquema
$SqlCrudo = $SqlCrudo.Replace('@CLAVE_ROOT@', $ClaveConexion)
$SqlCrudo = $SqlCrudo.Replace('@CLAVE_PHP@', $ClavesApi['@CLAVE_PHP@'])
$SqlCrudo = $SqlCrudo.Replace('@CLAVE_NODE@', $ClavesApi['@CLAVE_NODE@'])
$SqlCrudo = $SqlCrudo.Replace('@CLAVE_PYTHON@', $ClavesApi['@CLAVE_PYTHON@'])

# Hash y clave iniciales del admin: solo se crean si el usuario admin no existe.
$ExisteAdmin = Invoke-MySql -Sql "SELECT COUNT(*) FROM controlalquiler.usuarios WHERE idusuario = 1;" -Clave $ClaveConexion
$EsAdminNuevo = $false
if ($ExisteAdmin.Codigo -ne 0 -or $ExisteAdmin.Salida.Trim() -ne '1') { $EsAdminNuevo = $true }
if ($EsAdminNuevo) {
    $ClaveAdminInicial = Nueva-Clave
    $hashAdmin = & php -r ("echo password_hash('" + ($ClaveAdminInicial -replace "'", "\'") + "', PASSWORD_BCRYPT, ['cost' => 12]);") 2>$null
    if (-not $hashAdmin) { Fallar "No se pudo generar el hash de la clave inicial del admin (php)." }
    $SqlCrudo = $SqlCrudo.Replace('@HASH_ADMIN@', [string]$hashAdmin)
    Escribir-Ok "Administrador inicial creado. Clave de un solo uso (guarde ahora): usuario 'admin', clave: $ClaveAdminInicial"
    Escribir-Ok "Tambien quedo guardada en basededatos/.admin-inicial.env y exigira cambio al primer ingreso."
    Escribir-ValorEnv -Ruta (Join-Path $Raiz 'basededatos\.admin-inicial.env') -Clave 'ADMIN_INICIAL' -Valor $ClaveAdminInicial
} else {
    $SqlCrudo = $SqlCrudo.Replace('@HASH_ADMIN@', '$2y$12$hashqueyanoexiste00000000000000000000000000000000000')
}

# En instancia compartida, retirar del esquema los SET GLOBAL del servidor
# (event_scheduler/local_infile): cambiar variables globales afectaria a las
# demas bases de datos que viven en la misma instancia.
if ($CompartidaMariaDB) {
    $SqlCrudo = [regex]::Replace($SqlCrudo, '(?m)^\s*SET\s+GLOBAL\s+event_scheduler\s*=.*$', '-- (modo compartido) SET GLOBAL event_scheduler omitido.')
    $SqlCrudo = [regex]::Replace($SqlCrudo, '(?m)^\s*SET\s+GLOBAL\s+local_infile\s*=.*$', '-- (modo compartido) SET GLOBAL local_infile omitido.')
}

$resultadoSql = Invoke-MySql -Sql $SqlCrudo -Clave $ClaveConexion
if ([int]$resultadoSql.Codigo -ne 0) { Fallar "Fallo al aplicar esquema.sql. Revise basededatos/esquema.sql." }
if ($CompartidaMariaDB) {
    Escribir-Ok "Esquema aplicado/verificado (modo compartido: sin cambia root ni globals)."
} else {
    Escribir-Ok "Esquema aplicado/verificado con endurecimiento (usuarios anonimos fuera, root solo local, local_infile=0)."
}

# Tras la primera migracion: el admin existente debe cambiar su clave al ingresar.
if ($MigrarCambioClave) {
    $marca = Invoke-MySql -Sql "UPDATE controlalquiler.usuarios SET debe_cambiar_clave = 1 WHERE usuario = 'admin';" -Clave $ClaveConexion
    if ([int]$marca.Codigo -eq 0) { Escribir-Ok "Admin marcado para cambiar su clave en el primer ingreso." }
}

# Root tambien bajo el nombre de esta maquina (si existe, se elimina).
$hostSql = ($env:COMPUTERNAME -replace "'", '').ToLower()
if ($hostSql -ne 'localhost' -and $hostSql -ne '127.0.0.1') {
    $borrarHost = Invoke-MySql -Sql ("DROP USER IF EXISTS 'root'@'" + $hostSql + "'; FLUSH PRIVILEGES;") -Clave $ClaveConexion
    if ([int]$borrarHost.Codigo -eq 0) { Escribir-Ok "Root remoto por nombre de host eliminado si existia." }
}
Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue

# 4c. Datos de demostracion idempotentes: clientes, contratos (cerrados,
#     activos y morosos), inspecciones, solicitudes, notificaciones y
#     reportes guardados. Tambien registra maquinarias nuevas detectadas
#     como carpetas en frontend/img/maquinaria (con 3 unidades y fotos).
#     Nunca duplica: cada fila lleva su marca unica de siembra.
& (Join-Path $Raiz 'scripts\sembrar.ps1') -Raiz $Raiz

# 4b. Certificado TLS local (frontend y gateway). Se genera si falta y se
#     confia en el almacen del usuario actual (Chrome/Edge lo usan; Firefox
#     requiere importarlo manualmente, ver docs/instalacion.md).
$dirCert = Join-Path $Raiz 'certificados'
if (-not (Test-Path -LiteralPath $dirCert)) { New-Item -ItemType Directory -Path $dirCert | Out-Null }
$rutaPfx = Join-Path $dirCert 'local.pfx'
$rutaClavePfx = Join-Path $dirCert '.clave.env'
$clavePfx = ''
if ((Test-Path -LiteralPath $rutaPfx) -and (Test-Path -LiteralPath $rutaClavePfx)) {
    $lineaClave = (Get-Content -LiteralPath $rutaClavePfx -Encoding UTF8 | Where-Object { $_ -match '^CLAVE_PFX=' } | Select-Object -First 1)
    if ($lineaClave) { $clavePfx = ($lineaClave -replace '^CLAVE_PFX=', '').Trim() }
}
if (-not (Test-Path -LiteralPath $rutaPfx) -or $clavePfx -eq '') {
    $clavePfx = Nueva-Clave
    $cert = New-SelfSignedCertificate -DnsName 'localhost', '127.0.0.1' -CertStoreLocation Cert:\CurrentUser\My `
        -NotAfter (Get-Date).AddYears(1) -KeyAlgorithm RSA -KeyLength 2048 -FriendlyName 'AlquilerMaquinaria-Local'
    Export-PfxCertificate -Cert $cert -FilePath $rutaPfx -Password (ConvertTo-SecureString $clavePfx -AsPlainText -Force) | Out-Null
    Set-Content -LiteralPath $rutaClavePfx -Value ('CLAVE_PFX=' + $clavePfx) -Encoding UTF8
    Escribir-Ok "Certificado TLS local creado (1 ano, RSA 2048)."
    $thumbprint = $cert.Thumbprint
} else {
    try {
        $seguro = ConvertTo-SecureString $clavePfx -AsPlainText -Force
        $thumbprint = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($rutaPfx, $seguro).Thumbprint
    } catch {
        Fallar "No se pudo leer certificados/local.pfx con la clave de .clave.env. Borre ambos y reintente."
    }
}
# Confiar en el almacen del usuario (sin UI).
$yaConfiado = $false
try {
    $almacen = [System.Security.Cryptography.X509Certificates.X509Store]::new('Root', 'CurrentUser')
    $almacen.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
    $yaConfiado = @($almacen.Certificates | Where-Object { $_.Thumbprint -eq $thumbprint }).Count -gt 0
    $almacen.Close()
} catch { $yaConfiado = $false }
if (-not $yaConfiado) {
    try {
        $seguro = ConvertTo-SecureString $clavePfx -AsPlainText -Force
        $certConfianza = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($rutaPfx, $seguro)
        $almacen = [System.Security.Cryptography.X509Certificates.X509Store]::new('Root', 'CurrentUser')
        $almacen.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
        $almacen.Add($certConfianza)
        $almacen.Close()
        Escribir-Ok "Certificado confiado en el almacen del usuario (Chrome/Edge). Firefox: ver docs/instalacion.md."
    } catch {
        Escribir-Aviso "No se pudo confiar el certificado automaticamente. Importelo manualmente en su navegador."
    }
}

# 5. Dependencias solo si faltan.
$dirGateway = Join-Path $Raiz 'api-gateway'
$dirNode = Join-Path $Raiz 'apis\apinode'
$dirPython = Join-Path $Raiz 'apis\apipython'
foreach ($par in @(@{ Dir = $dirGateway; Nombre = 'gateway' }, @{ Dir = $dirNode; Nombre = 'apinode' })) {
    $paquete = Join-Path $par.Dir 'package.json'
    $modulos = Join-Path $par.Dir 'node_modules'
    if (-not (Test-Path -LiteralPath $paquete)) {
        Escribir-Aviso "Sin package.json en $($par.Nombre). Se omite npm install."
        continue
    }
    if (Test-Path -LiteralPath $modulos) {
        Escribir-Info "node_modules ya existe en $($par.Nombre). Se omite npm install."
    } else {
        Escribir-Info "Instalando dependencias de $($par.Nombre)..."
        Push-Location -LiteralPath $par.Dir
        try {
            & npm install
            if ($LASTEXITCODE -ne 0) { Fallar "npm install fallo en $($par.Nombre)." }
        } finally {
            Pop-Location
        }
        Escribir-Ok "Dependencias de $($par.Nombre) instaladas."
    }
}
try {
    & python -c "import fastapi" 2>$null
    Escribir-Info "fastapi ya esta instalado. Se omite pip install."
} catch {
    Escribir-Info "Instalando requirements de apipython..."
    & python -m pip install -r (Join-Path $dirPython 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { Fallar "pip install fallo en apipython." }
    Escribir-Ok "Requirements de apipython instalados."
}

# 6. Iniciar servicios en segundo plano.
function Start-Servicio {
    param([string]$Nombre, [string]$Dir, [string]$Exe, [string[]]$Argumentos, [int]$Puerto)
    if (-not (Test-PuertoLibre -Puerto $Puerto)) {
        # Ultima pasada de liberacion automatica antes de fallar (sin mensajes de "ocupado").
        $protegidos = @('mysqld.exe', 'httpd.exe', 'apache.exe', 'w3wp.exe', 'svchost.exe', 'spoolsv.exe', 'csrss.exe', 'wininit.exe', 'services.exe')
        $ocupantes = Get-NetTCPConnection -LocalPort $Puerto -State Listen -ErrorAction SilentlyContinue
        foreach ($conexion in $ocupantes) {
            $dueno = Get-CimInstance Win32_Process -Filter "ProcessId = $($conexion.OwningProcess)" -ErrorAction SilentlyContinue
            if ($null -eq $dueno) { continue }
            if ($protegidos -contains ([string]$dueno.Name).ToLower()) { continue }
            try { Stop-Process -Id $dueno.ProcessId -Force -ErrorAction Stop; Start-Sleep -Milliseconds 400 } catch { }
        }
        if (-not (Test-PuertoLibre -Puerto $Puerto)) {
            Fallar "No se pudo liberar el puerto $Puerto para $Nombre. Cierre a mano el proceso que lo escucha y ejecute iniciar.bat de nuevo."
        }
    }
    if (-not (Test-Path -LiteralPath $Dir)) { Fallar "No existe el directorio $Dir." }
    $p = Start-Process -FilePath $Exe -ArgumentList $Argumentos `
        -WorkingDirectory $Dir -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $Logs "$Nombre.salida.log") `
        -RedirectStandardError (Join-Path $Logs "$Nombre.error.log") `
        -PassThru
    Escribir-Ok "$Nombre iniciado (PID $($p.Id), puerto $Puerto)."
    return $p.Id
}

$dirPhp = Join-Path $Raiz 'apis\apiphp'
$exePhp = 'php'
if (Test-Path -LiteralPath 'C:\xampp\php\php.exe') { $exePhp = 'C:\xampp\php\php.exe' }
$pidPhp = Start-Servicio -Nombre 'php' -Dir $dirPhp -Exe $exePhp -Argumentos @("-S 127.0.0.1:8000 `"$((Join-Path $dirPhp 'enrutador.php'))`"") -Puerto 8000
$pidNode = Start-Servicio -Nombre 'node' -Dir $dirNode -Exe 'node' -Argumentos @("`"$((Join-Path $dirNode 'servidor.js'))`"") -Puerto 3002
$pidPython = Start-Servicio -Nombre 'python' -Dir $dirPython -Exe 'python' -Argumentos @("-m uvicorn servidor:app --host 127.0.0.1 --port 3003 --app-dir `"$dirPython`"") -Puerto 3003
$pidGateway = $null
if (Test-Path -LiteralPath (Join-Path $dirGateway 'server.js')) {
    $pidGateway = Start-Servicio -Nombre 'gateway' -Dir $dirGateway -Exe 'node' -Argumentos @("`"$((Join-Path $dirGateway 'server.js'))`"") -Puerto 3000
} else {
    Escribir-Aviso "api-gateway/server.js no existe. Se omite el gateway."
}

@{
    php             = $pidPhp
    node            = $pidNode
    python          = $pidPython
    gateway         = $pidGateway
    frontend        = $null
    mariadb         = $mariadbPid
    mariadbIniciada = $mariadbIniciada
    fecha           = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
} | ConvertTo-Json | Set-Content -LiteralPath $ArchivoPids -Encoding utf8
Escribir-Ok "PIDs guardados en logs/pids.json."

# 7. Healthchecks de 60 segundos.
if ($null -ne $pidPhp) { Esperar-Salud -Nombre 'API PHP' -Url 'http://127.0.0.1:8000/salud' }
if ($null -ne $pidNode) { Esperar-Salud -Nombre 'API Node' -Url 'http://127.0.0.1:3002/salud' }
if ($null -ne $pidPython) { Esperar-Salud -Nombre 'API Python' -Url 'http://127.0.0.1:3003/salud' }
if ($null -ne $pidGateway) { Esperar-Salud -Nombre 'Gateway' -Url 'https://127.0.0.1:3000/salud' }

# 8. Servir el frontend en 127.0.0.1:8443 (TLS) y abrirlo en el navegador.
$dirFrontendServer = Join-Path $Raiz 'frontend-server'
$dirFrontend = Join-Path $Raiz 'frontend'
$pidFrontend = $null
if (Test-Path -LiteralPath (Join-Path $dirFrontend 'index.html')) {
    # Integridad del frontend: si no existe la huella se genera ahora.
    # Si existe, NO se regenera (evidencia de alteraciones se conserva);
    # tras un cambio legitimo, generarla con scripts/generar-integridad.ps1.
    $rutaIntegridad = Join-Path $Raiz 'integridad.json'
    if (-not (Test-Path -LiteralPath $rutaIntegridad)) {
        & (Join-Path $Raiz 'scripts\generar-integridad.ps1') -Raiz $Raiz
        Escribir-Ok "integridad.json generado (primera vez)."
    }
    $pidFrontend = Start-Servicio -Nombre 'frontend' -Dir $dirFrontendServer -Exe 'node' -Argumentos @('server.js') -Puerto 8443
    $limiteWeb = (Get-Date).AddSeconds(20)
    while ((Test-PuertoLibre -Puerto 8443) -and ((Get-Date) -lt $limiteWeb)) {
        Start-Sleep -Seconds 1
    }
    if (Test-PuertoLibre -Puerto 8443) {
        Escribir-Aviso "El frontend no respondio en 8443. Revise logs/frontend.error.log."
    } else {
        Escribir-Ok "Frontend servido en https://localhost:8443 (memoria + integridad + cabeceras)."
    }
} else {
    Escribir-Aviso "Sin frontend/index.html. Se omite el servidor web."
}
$pidsFinal = Get-Content -LiteralPath $ArchivoPids -Raw -Encoding utf8 | ConvertFrom-Json
$pidsFinal.frontend = $pidFrontend
$pidsFinal | ConvertTo-Json | Set-Content -LiteralPath $ArchivoPids -Encoding utf8
$urlApp = 'https://localhost:8443'
$firefox = @('C:\Program Files\Mozilla Firefox\firefox.exe', 'C:\Program Files (x86)\Mozilla Firefox\firefox.exe') | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($null -ne $firefox) {
    Start-Process -FilePath $firefox -ArgumentList $urlApp
    Escribir-Ok "Abriendo $urlApp en Firefox."
} else {
    Escribir-Aviso "Firefox no encontrado. Abriendo $urlApp en el navegador por defecto."
    Start-Process -FilePath $urlApp
}

Escribir-Ok "Entorno iniciado. Registros en $Logs."
