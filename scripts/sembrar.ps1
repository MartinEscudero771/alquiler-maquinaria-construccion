#requires -Version 7.0
<#
.SINOPSIS
    Siembra datos de demostracion en la BD del proyecto (idempotente).
.DESCRIPCION
    Agrega clientes, contratos (cerrados, activos y morosos) con sus
    inspecciones, solicitudes, notificaciones y reportes guardados. Las
    fechas se generan relativas a hoy para que el calendario y las
    graficas siempre tengan datos recientes. Es IDEMPOTENTE: cada fila
    lleva una marca unica (documento 'CC/SEM...', clave_idempotencia
    'semilla-N', titulos de reporte) asi que correrlo de nuevo NO duplica.
    Tambien detecta carpetas nuevas en frontend/img/maquinaria y las
    registra como maquinarias con sus unidades y fotos (3 primeras).
    Llamado automaticamente por iniciar.ps1 cada arranque.
#>
[CmdletBinding()]
param(
    [string]$Raiz = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Continue'
$Raiz = (Resolve-Path -LiteralPath $Raiz).Path

function Escribir-Ok { param([string]$t) Write-Host ("[ OK ] " + $t) -ForegroundColor Green }
function Escribir-Info { param([string]$t) Write-Host ("[INFO] " + $t) -ForegroundColor Gray }

# --- Conexion mysql (clave root: .root.env > 0000 > vacia, igual que iniciar) ---
$MysqlExe = 'C:\xampp\mysql\bin\mysql.exe'
if (-not (Test-Path -LiteralPath $MysqlExe)) {
    $cmd = Get-Command mysql -ErrorAction SilentlyContinue
    if ($null -ne $cmd) { $MysqlExe = $cmd.Source } else { Write-Error 'mysql.exe no disponible.'; exit 1 }
}
$ClaveConexion = $null
$ArchivoRoot = Join-Path $Raiz 'basededatos\.root.env'
$ClaveRoot = ''
if (Test-Path -LiteralPath $ArchivoRoot) {
    $linea = (Get-Content -LiteralPath $ArchivoRoot -Encoding UTF8) | Where-Object { $_.StartsWith('DB_ROOT_PASS=') } | Select-Object -First 1
    if ($linea) { $ClaveRoot = $linea.Substring('DB_ROOT_PASS='.Length).Trim() }
}
foreach ($candidata in @($ClaveRoot, '0000', '')) {
    $env:MYSQL_PWD = $candidata
    $out = & $MysqlExe --protocol=TCP -h 127.0.0.1 -P 3306 -u root -N -B -e 'SELECT 1;' 2>$null
    if ($LASTEXITCODE -eq 0 -and "$out".Trim() -eq '1') { $ClaveConexion = $candidata; break }
}
if ($null -eq $ClaveConexion) { Write-Host '[ AVISO ] Sin conexion MariaDB: no se siembran datos.' -ForegroundColor Yellow; exit 0 }
$env:MYSQL_PWD = $ClaveConexion

function Contar { param([string]$Sql) $out = & $MysqlExe --protocol=TCP -h 127.0.0.1 -P 3306 -u root --database=controlalquiler -N -B -e $Sql 2>$null; return [int]("$out".Trim()) }
function Ejecutar { param([string]$Sql) & $MysqlExe --protocol=TCP -h 127.0.0.1 -P 3306 -u root --database=controlalquiler -N -B -e $Sql 2>$null | Out-Null; return $LASTEXITCODE }
function ConsultarFilas { param([string]$Sql) & $MysqlExe --protocol=TCP -h 127.0.0.1 -P 3306 -u root --database=controlalquiler -N -B -e $Sql 2>$null }

# Si la BD no existe todavia (primer arranque), no sembrar.
if ((Contar 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema="controlalquiler" AND table_name="maquinarias";') -eq 0) {
    Write-Host '[ AVISO ] Esquema no aplicado todavia: la siembra se hara en el proximo arranque.' -ForegroundColor Yellow
    exit 0
}

$Ahora = Get-Date
function Fecha { param([int]$Offset) return $Ahora.AddDays($Offset).ToString('yyyy-MM-dd') }

# ------------------------------------------------------------------
# 1) Maquinarias nuevas desde carpetas de frontend/img/maquinaria
# ------------------------------------------------------------------
$carpetasImg = @()
$dirImg = Join-Path $Raiz 'frontend\img\maquinaria'
if (Test-Path -LiteralPath $dirImg) {
    $carpetasImg = Get-ChildItem -LiteralPath $dirImg -Directory | Select-Object -ExpandProperty Name
}
$nuevasMachines = @()
foreach ($carpeta in $carpetasImg) {
    $existe = Contar ("SELECT COUNT(*) FROM maquinarias WHERE carpeta = '" + $carpeta + "';")
    if ($existe -gt 0) { continue }
    $nombreBonito = ($carpeta -replace '(\B[A-Z])', ' $1')
    $nombreBonito = $nombreBonito.Substring(0, 1).ToUpper() + $nombreBonito.Substring(1)
    # Precio referencial por nombre conocido; el resto tiene un estandar.
    $tarifas = @{
        excavadora = 1450000; 'bulldozer' = 1800000; 'gruamovil' = 2200000; 'cargadorfrontal' = 1200000
        compactador = 750000; 'retroexcavadora' = 950000; 'volqueta' = 900000; 'motoniveladora' = 1600000
        minicargador = 650000; 'montacargas' = 380000; 'miniexcavadora' = 520000; 'plataforma' = 480000
    }
    $tarifa = 850000
    if ($tarifas.ContainsKey($carpeta.ToLower())) { $tarifa = $tarifas[$carpeta.ToLower()] }
    $esLiviana = $tarifas.ContainsKey($carpeta.ToLower()) -and @('minicargador','montacargas','miniexcavadora','plataforma').Contains($carpeta.ToLower())
    $null = Ejecutar ("INSERT INTO maquinarias (nombre, categoria, carpeta, tarifadiaria, activo) VALUES ('" + $nombreBonito + "', '" + $(if ($esLiviana) { 'liviana' } else { 'pesada' }) + "', '" + $carpeta + "', " + $tarifa + ", 1);")
    $idNuevo = Contar ("SELECT idmaquinaria FROM maquinarias WHERE carpeta = '" + $carpeta + "' LIMIT 1;")
    if (-not $esLiviana) {
        $null = Ejecutar ("INSERT INTO maquinariaspesadas (idmaquinaria, peso_toneladas, costo_movilizacion) VALUES (" + $idNuevo + ", 12.00, 450000);")
    } else {
        $null = Ejecutar ("INSERT INTO maquinariaslivianas (idmaquinaria, ancho_metros, apta_zona_urbana) VALUES (" + $idNuevo + ", 1.60, 1);")
    }
    for ($u = 1; $u -le 3; $u++) {
        $serial = $carpeta.ToLower() + '-' + $u.ToString('00')
        $null = Ejecutar ("INSERT IGNORE INTO unidades (idmaquinaria, serial, estado) VALUES (" + $idNuevo + ", '" + $serial + "', 'disponible');")
    }
    # Fotos: copia las tres primeras del frontend al directorio servido por apipython.
    $dirFuente = Join-Path $dirImg $carpeta
    $dirDestino = Join-Path $Raiz 'apis\apipython\fotos'
    $dirCarpetaDestino = Join-Path $dirDestino $carpeta
    if ((Test-Path -LiteralPath $dirFuente) -and (-not (Test-Path -LiteralPath $dirCarpetaDestino))) {
        New-Item -ItemType Directory -Path $dirCarpetaDestino | Out-Null
        $fotos = Get-ChildItem -LiteralPath $dirFuente -File | Where-Object { $_.Extension -match '^\.jpe?g$|^\.png$' } | Select-Object -First 3
        $i = 0
        foreach ($f in $fotos) {
            $i++
            Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $dirCarpetaDestino ('foto0' + $i + $f.Extension.ToLower()))
        }
    }
    $nuevasMachines += $nombreBonito
}
if ($nuevasMachines.Count -gt 0) { Escribir-Ok ('Maquinarias nuevas sembradas desde img: ' + ($nuevasMachines -join ', ')) } else { Escribir-Info 'Ninguna maquinaria nueva por sembrar.' }

# ------------------------------------------------------------------
# 2) Clientes de demostracion (documento unicos: CC1001..)
# ------------------------------------------------------------------
$clientesDemo = @(
    @{ Doc = 'CC1001'; Nom = 'Andres Camilo Suarez';    Tel = '3105550111'; Mail = 'andres.suarez@correo.co' },
    @{ Doc = 'CC1002'; Nom = 'Luisa Fernanda Munoz';    Tel = '3205550112'; Mail = 'luisa.munoz@correo.co' },
    @{ Doc = 'CC1003'; Nom = 'Jaime Restrepo Velez';    Tel = '3155550113'; Mail = 'jaime.restrepo@correo.co' },
    @{ Doc = 'CC1004'; Nom = 'Camilo Duarte Ortiz';     Tel = '3185550114'; Mail = 'camilo.duarte@correo.co' },
    @{ Doc = 'CC1005'; Nom = 'Diana Marcela Pineda';    Tel = '3005550115'; Mail = 'diana.pineda@correo.co' },
    @{ Doc = 'CC1006'; Nom = 'Oscar Ivan Quintero';     Tel = '3135550116'; Mail = 'oscar.quintero@correo.co' },
    @{ Doc = 'CC1007'; Nom = 'Julian Andres Betancur';  Tel = '3145550117'; Mail = 'julian.betancur@correo.co' },
    @{ Doc = 'CC1008'; Nom = 'Monica Liliana Zapata';   Tel = '3125550118'; Mail = 'monica.zapata@correo.co' },
    @{ Doc = 'CC1009'; Nom = 'Hernan Giraldo Builes';   Tel = '3175550119'; Mail = 'hernan.giraldo@correo.co' },
    @{ Doc = 'CC1010'; Nom = 'Construcciones El Progreso S.A.S.'; Tel = '6015550120'; Mail = 'obras@elprogreso.co' }
)
$insertadosClientes = 0
$i = 0
foreach ($c in $clientesDemo) {
    $i++
    $fechaRegistro = Fecha (-180 + ($i * 12))
    $sql = "INSERT INTO clientes (nombre, documento, telefono, correo, direccion, fecharegistro) SELECT '" + $c.Nom + "', '" + $c.Doc + "', '" + $c.Tel + "', '" + $c.Mail + "', 'Km 3 via Norte, Bogota D.C.', '" + $fechaRegistro + "' WHERE NOT EXISTS (SELECT 1 FROM clientes WHERE documento = '" + $c.Doc + "');"
    $antes = Contar "SELECT COUNT(*) FROM clientes WHERE documento = '" + $c.Doc + "';"
    $null = Ejecutar $sql
    if ($antes -eq 0) { $insertadosClientes++ }
}
Escribir-Ok ('Clientes sembrados: ' + $insertadosClientes + ' nuevos de ' + $clientesDemo.Count + ' revisados.')

# ------------------------------------------------------------------
# 3) Contratos: 24 cerrados + 2 morosos + 6 activos (según maquinaria)
# ------------------------------------------------------------------
$maqFilas = ConsultarFilas "SELECT m.idmaquinaria, m.nombre, m.carpeta, m.tarifadiaria, COALESCE(p.costo_movilizacion, 0) AS mov FROM maquinarias m LEFT JOIN maquinariaspesadas p ON p.idmaquinaria = m.idmaquinaria ORDER BY m.idmaquinaria;"
$mapaMachines = @()
foreach ($linea in $maqFilas) {
    if ($linea) {
        $partes = "$linea".Split("`t")
        if ($partes.Count -ge 5) {
            $mapaMachines += @{ Id = [int]$partes[0]; Nombre = $partes[1]; Carpeta = $partes[2]; Tarifa = [double]$partes[3]; Mov = [double]$partes[4] }
        }
    }
}
$mapaUnidades = @{}
foreach ($m in $mapaMachines) {
    $uFilas = ConsultarFilas ("SELECT serial, idunidad FROM unidades WHERE idmaquinaria = " + $m.Id + " ORDER BY serial;")
    $lista = @()
    foreach ($ul in $uFilas) {
        if ($ul) {
            $pu = "$ul".Split("`t")
            if ($pu.Count -ge 2) { $lista += @{ Serial = $pu[0]; Id = [int]$pu[1] } }
        }
    }
    $mapaUnidades[$m.Id] = $lista
}
function IdCliente { param([string]$Doc) return Contar ("SELECT idcliente FROM clientes WHERE documento = '" + $Doc + "' LIMIT 1;") }

$rowsAlquileres = @()
$nSemilla = 0
foreach ($m in $mapaMachines) {
    $unidadesM = $mapaUnidades[$m.Id]
    if ($unidadesM.Count -eq 0) { continue }
    $mi = $m.Id
    $u0 = $unidadesM[0]
    # Cerrado 1 (u0)
    $nSemilla++
    $rowsAlquileres += @{ Clave = 'semilla-' + $nSemilla; IdCliente = 'CC1001'; IdUnidad = $u0; Fecha = Fecha (-42 - $mi); Fin = Fecha (-36 - $mi); Tarifa = $m.Tarifa; Mov = $m.Mov; Real = Fecha (-35 - $mi); Obs = 'Obra de pavimentacion; equipo devuelto en buen estado.' }
    # Cerrado 2 (u0)
    $nSemilla++
    $rowsAlquileres += @{ Clave = 'semilla-' + $nSemilla; IdCliente = 'CC1003'; IdUnidad = $u0; Fecha = Fecha (-24 - $mi); Fin = Fecha (-19 - $mi); Tarifa = $m.Tarifa; Mov = $m.Mov; Real = Fecha (-19 - $mi); Obs = 'Acondicionamiento de lote industrial.' }
}
# Morosos: maquinarias cuyo id termina en 1 y 7 (si tienen 2+ unidades).
$uFilaExtra = 0
foreach ($m in $mapaMachines) {
    if (($m.Id % 6) -eq 1) {
        $unidadesM = $mapaUnidades[$m.Id]
        if ($unidadesM.Count -ge 2) {
            $nSemilla++
            $rowsAlquileres += @{ Clave = 'semilla-' + $nSemilla; IdCliente = 'CC1004'; IdUnidad = $unidadesM[1]; Fecha = Fecha (-8 - $m.Id); Fin = Fecha (-2 - $m.Id); Tarifa = $m.Tarifa; Mov = $m.Mov; Real = ''; Obs = 'Contrato vencido sin devolucion registrada.' }
        }
    }
}
# Activos: maquinarias de id par, en la ULTIMA unidad.
foreach ($m in $mapaMachines) {
    if (($m.Id % 2) -eq 0) {
        $unidadesM = $mapaUnidades[$m.Id]
        if ($unidadesM.Count -eq 0) { continue }
        $uUltima = $unidadesM[$unidadesM.Count - 1]
        $nSemilla++
        $rowsAlquileres += @{ Clave = 'semilla-' + $nSemilla; IdCliente = 'CC1010'; IdUnidad = $uUltima; Fecha = Fecha (-1); Fin = Fecha (4); Tarifa = $m.Tarifa; Mov = $m.Mov; Real = ''; Obs = 'Obra en curso; entrega programada en cinco dias.' }
    }
}

$insertadosContratos = 0
foreach ($r in $rowsAlquileres) {
    $idCli = IdCliente $r.IdCliente
    if ($idCli -le 0) { continue }
    $antes = Contar ("SELECT COUNT(*) FROM alquileres WHERE clave_idempotencia = '" + $r.Clave + "';")
    if ($antes -gt 0) { continue }
    $realSql = if ($r.Real -ne '') { "'" + $r.Real + "'" } else { 'NULL' }
    $sql = "INSERT INTO alquileres (idcliente, idunidad, fechalquiler, fechadevolucionprogramada, fechadevolucionreal, tarifa_pactada, costo_movilizacion_pactado, valorreparacion, observaciones, clave_idempotencia) VALUES (" + $idCli + ", " + $r.IdUnidad.Id + ", '" + $r.Fecha + "', '" + $r.Fin + "', " + $realSql + ", " + $r.Tarifa + ", " + $r.Mov + ", 0, '" + $r.Obs + "', '" + $r.Clave + "');"
    $null = Ejecutar $sql
    if ($LASTEXITCODE -eq 0) { $insertadosContratos++ }
}
Escribir-Ok ('Contratos sembrados: ' + $insertadosContratos + ' nuevos de ' + $rowsAlquileres.Count + ' revisados.')

# ------------------------------------------------------------------
# 4) Inspecciones para los contratos cerrados de la siembra
# ------------------------------------------------------------------
$ins = 0
$cerrados = ConsultarFilas "SELECT idalquiler FROM alquileres WHERE clave_idempotencia LIKE 'semilla-%' AND fechadevolucionreal IS NOT NULL;"
$idx = 0
foreach ($linea in $cerrados) {
    if (-not $linea) { continue }
    $idAlq = [int]("$linea".Trim())
    $idx++
    $tiene = Contar ("SELECT COUNT(*) FROM inspecciones WHERE idalquiler = " + $idAlq + ";")
    if ($tiene -gt 0) { continue }
    $fis = @('bueno', 'bueno', 'regular', 'bueno', 'regular')[$idx % 5]
    $des = @('ninguno', 'bajo', 'medio', 'ninguno', 'bajo')[$idx % 5]
    $rep = @(0, 0, 120000, 0, 240000)[$idx % 5]
    $null = Ejecutar ("INSERT INTO inspecciones (idalquiler, estadofisico, niveldesgaste, descripciondanos, observaciones) SELECT " + $idAlq + ", '" + $fis + "', '" + $des + "', '" + $(if ($rep -gt 0) { 'Detalle menor en carcasa.' } else { '' }) + "', 'Inspeccion de entrega de demostracion.' WHERE NOT EXISTS (SELECT 1 FROM inspecciones WHERE idalquiler = " + $idAlq + ");")
    $null = Ejecutar ("UPDATE alquileres SET valorreparacion = " + $rep + " WHERE idalquiler = " + $idAlq + " AND valorreparacion = 0;")
    $ins++
}
Escribir-Info ('Inspecciones creadas/verificadas: ' + $ins)

# ------------------------------------------------------------------
# 5) Solicitudes de demo (2 pendientes + 1 rechazada) por documentos SEM
# ------------------------------------------------------------------
$sols = @(
    @{ Doc = 'SEMSOL01'; Nom = 'Obra Ciudadela del Sur'; M = 3; F1 = Fecha (1); F2 = Fecha (8); Estado = 'pendiente'; Mot = '' },
    @{ Doc = 'SEMSOL02'; Nom = 'Rendering Rios Andinos'; M = 7; F1 = Fecha (4); F2 = Fecha (11); Estado = 'pendiente'; Mot = '' },
    @{ Doc = 'SEMSOL03'; Nom = 'Cliente Ocacional Prueba'; M = 9; F1 = Fecha (-6); F2 = Fecha (-1); Estado = 'rechazada'; Mot = 'Sin disponibilidad de la unidad para esas fechas.' }
)
$insSols = 0
foreach ($s in $sols) {
    $tiene = Contar ("SELECT COUNT(*) FROM solicitudes WHERE documento = '" + $s.Doc + "';")
    if ($tiene -gt 0) { continue }
    $motSql = if ($s.Mot -ne '') { "'" + $s.Mot + "'" } else { 'NULL' }
    $sql = "INSERT INTO solicitudes (nombre, documento, telefono, correo, idmaquinaria, fechalquiler, fechadevolucionprogramada, observaciones, estado, motivo_rechazo) VALUES ('" + $s.Nom + "', '" + $s.Doc + "', '6015550140', 'demo@correo.co', " + $s.M + ", '" + $s.F1 + "', '" + $s.F2 + "', 'Solicitud de demostracion.', '" + $s.Estado + "', " + $motSql + ");"
    $null = Ejecutar $sql
    if ($LASTEXITCODE -eq 0) { $insSols++ }
}
Escribir-Ok ('Solicitudes sembradas: ' + $insSols + ' de ' + $sols.Count + ' revisadas.')

# ------------------------------------------------------------------
# 6) Reportes guardados (2) con totales reales calculados en vivo
# ------------------------------------------------------------------
$totalC = Contar "SELECT COUNT(*) FROM alquileres;"
$cActivos = Contar "SELECT COUNT(*) FROM alquileres WHERE fechadevolucionreal IS NULL AND fechadevolucionprogramada >= CURDATE();"
$cMorosos = Contar "SELECT COUNT(*) FROM alquileres WHERE fechadevolucionreal IS NULL AND fechadevolucionprogramada < CURDATE();"
$ingresos = Contar "SELECT COALESCE(SUM((DATEDIFF(COALESCE(fechadevolucionreal, CURDATE()), fechalquiler) + 1) * tarifa_pactada + costo_movilizacion_pactado + COALESCE(valorreparacion, 0)), 0) FROM alquileres WHERE fechadevolucionreal IS NOT NULL;"
$topMachine = (ConsultarFilas "SELECT m.nombre FROM alquileres a JOIN unidades u ON u.idunidad = a.idunidad JOIN maquinarias m ON m.idmaquinaria = u.idmaquinaria GROUP BY m.nombre ORDER BY COUNT(*) DESC LIMIT 1;")
$uP = Contar "SELECT COUNT(*) FROM unidades u JOIN maquinarias m ON m.idmaquinaria = u.idmaquinaria WHERE m.categoria = 'pesada';"
$dP = Contar "SELECT COUNT(*) FROM unidades u JOIN maquinarias m ON m.idmaquinaria = u.idmaquinaria WHERE m.categoria = 'pesada' AND u.estado = 'disponible';"
$uL = Contar "SELECT COUNT(*) FROM unidades u JOIN maquinarias m ON m.idmaquinaria = u.idmaquinaria WHERE m.categoria = 'liviana';"
$dL = Contar "SELECT COUNT(*) FROM unidades u JOIN maquinarias m ON m.idmaquinaria = u.idmaquinaria WHERE m.categoria = 'liviana' AND u.estado = 'disponible';"
$topNm = if ($topMachine) { "$topMachine".Trim() } else { '' }
$reportesSeed = @('Reporte sembrado N.1', 'Reporte sembrado N.2')
$insRep = 0
foreach ($t in $reportesSeed) {
    $tiene = Contar ("SELECT COUNT(*) FROM reportesguardados WHERE titulo = '" + $t + "';")
    if ($tiene -gt 0) { continue }
    $sql = "INSERT INTO reportesguardados (titulo, total_contratos, contratos_activos, contratos_morosos, ingresos, maquina_mas_alquilada, unidades_pesadas, disponibles_pesadas, unidades_livianas, disponibles_livianas) VALUES ('" + $t + "', " + $totalC + ", " + $cActivos + ", " + $cMorosos + ", " + $ingresos + ", '" + $topNm + "', " + $uP + ", " + $dP + ", " + $uL + ", " + $dL + ");"
    $null = Ejecutar $sql
    if ($LASTEXITCODE -eq 0) { $insRep++ }
}
Escribir-Ok ('Reportes guardados sembrados: ' + $insRep + ' de ' + $reportesSeed.Count + ' revisados.')

# ------------------------------------------------------------------
# 7) Notificaciones de demo: solo si la tabla esta vacia
# ------------------------------------------------------------------
$hayNotif = Contar 'SELECT COUNT(*) FROM notificaciones;'
if ($hayNotif -eq 0) {
    $idContratoReciente = Contar "SELECT COALESCE(MAX(idalquiler), 0) FROM alquileres WHERE clave_idempotencia LIKE 'semilla-%';"
    $conjunto = @(
        @{ T = 'Notificaciones activadas'; M = 'Aqui vera avisos de solicitudes nuevas, contratos y devoluciones. La campana se actualiza cada minuto.'; N = 'info' },
        @{ T = 'Nueva solicitud pendiente de gestion'; M = 'Obra Ciudadela del Sur: solicita montacargas para esta semana. Gestionela en el modulo Solicitudes.'; N = 'aviso' },
        @{ T = 'Nueva solicitud pendiente de gestion'; M = 'Rendering Rios Andinos: solicita gruamovil para la proxima semana.'; N = 'aviso' },
        @{ T = 'Unidad morosa detectada'; M = 'Un contrato vencido sin devolucion esta generando recargos por dia. Revise Devoluciones o registre la entrega.'; N = 'error' },
        @{ T = 'Contratos con obra en curso'; M = 'Seis unidades estan alquiladas ahora mismo. Consulte el Calendario para ver cada rango.'; N = 'exito' },
        @{ T = 'Resumen operativo guardado'; M = 'Los dos reportes de demostracion estan en el modulo Reportes con los totales vivos de la base.'; N = 'info' }
    )
    foreach ($not in $conjunto) {
        $null = Ejecutar ("INSERT INTO notificaciones (titulo, mensaje, rama, nivel) VALUES ('" + $not.T + "', '" + $not.M + "', 'SEMILLA', '" + $not.N + "');")
    }
    Escribir-Ok ('Notificaciones de demostracion sembradas: ' + $conjunto.Count + '.')
} else {
    Escribir-Info 'Notificaciones ya presentes; no se siembran de nuevo.'
}

Escribir-Ok ('Siembra terminada. Totales en BD: clientes=' + (Contar 'SELECT COUNT(*) FROM clientes;') + ', alquileres=' + (Contar 'SELECT COUNT(*) FROM alquileres;') + ', notificaciones=' + (Contar 'SELECT COUNT(*) FROM notificaciones;') + '.')
exit 0
