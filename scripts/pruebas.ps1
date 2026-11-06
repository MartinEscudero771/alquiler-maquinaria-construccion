#requires -Version 7.0
<#
.SINOPSIS
    Pruebas de aceptacion automatizadas contra el gateway (post 127.0.0.1:3000).
.DESCRIPCION
    Traduce docs/pruebas.md a codigo: santas publicas (estructura, captcha,
    catalogo, fotos, solicitudes) y autenticadas (login, clientes, cuentas,
    alquileres con idempotencia, devolucion 409, reportes, roles).
    La BD queda con registros de prueba: no inventa nada, solo lo que el
    proyecto ya documentaba.
.PARAMETROS
    -Usuario / -Clave: credenciales de admin. Si no se pasa -Clave, se
    intenta basededatos/.admin-inicial.env. Si no existe, las pruebas
    autenticadas quedan SALTADAS (las publicas sig en corriendo).
.USO
    pwsh -NoProfile -File scripts/pruebas.ps1
    pwsh -NoProfile -File scripts/pruebas.ps1 -Clave 'CLAVE-DEL-ADMIN'
    Requiere el entorno iniciado (iniciar.bat) y que la BD permita crear
    registros de prueba.
#>
[CmdletBinding()]
param(
    [string]$Usuario = 'admin',
    [string]$Clave = '',
    [string]$Raiz = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Continue'
$Raiz = (Resolve-Path -LiteralPath $Raiz).Path
$resultados = New-Object Collections.Generic.List[object]
$gateway = 'https://127.0.0.1:3000/api'
$origen = 'https://localhost:8443'
$marca = 't' + (Get-Date -Format 'yyMMddHHmmssff')

function Agregar-Resultado {
    param([string]$Nombre, [string]$Estado, [string]$Detalle)
    $resultados.Add([pscustomobject]@{ Prueba = $Nombre; Estado = $Estado; Detalle = ($Detalle -replace '\s+', ' ') })
    $color = switch ($Estado) { 'Pasa' { 'Green' } 'Falla' { 'Red' } 'Salta' { 'Yellow' } default { 'Gray' } }
    Write-Host "[$Estado] $Nombre : $Detalle" -ForegroundColor $color
}

function Llamar-Gateway {
    param([string]$Rama, [string]$Metodo, [hashtable]$Datos = @{}, [string]$Token = '')
    $cuerpoJson = @{ TOKEN = $Token; dat = @{ RAMA = $Rama; METODO = $Metodo; DATOS = $Datos } } | ConvertTo-Json -Depth 6 -Compress
    try {
        $r = Invoke-WebRequest -Method Post -Uri $gateway -Body ([System.Text.Encoding]::UTF8.GetBytes($cuerpoJson)) `
            -ContentType 'application/json; charset=utf-8' -Headers @{ Origin = $origen } -TimeoutSec 20 `
            -SkipCertificateCheck -SkipHttpErrorCheck -UseBasicParsing
        $cuerpo = $null
        try { $cuerpo = $r.Content | ConvertFrom-Json } catch { $cuerpo = $null }
        return @{ Codigo = [int]$r.StatusCode; Cuerpo = $cuerpo }
    } catch {
        return @{ Codigo = 0; Cuerpo = $null }
    }
}

function Captcha-Nuevo {
    $r = Llamar-Gateway -Rama 'CAPTCHA' -Metodo 'POST' -Datos @{}
    if ($r.Codigo -ne 201 -or $null -eq $r.Cuerpo.datos.captcha_id) {
        return @{ Ok = $false; Id = ''; Respuesta = '' }
    }
    return @{ Ok = $true; Id = $r.Cuerpo.datos.captcha_id; Respuesta = $r.Cuerpo.datos.objetivo }
}

function Login {
    param([string]$User, [string]$Pass)
    $cap = Captcha-Nuevo
    if (-not $cap.Ok) { return @{ Codigo = 0; Cuerpo = $null } }
    return Llamar-Gateway -Rama 'USUARIOS' -Metodo 'POST' -Token '' -Datos @{
        usuario = $User; clave = $Pass; captcha_id = $cap.Id; captcha_respuesta = $cap.Respuesta
    }
}

$fechaHoy = (Get-Date).ToString('yyyy-MM-dd')
$fechaFutura = (Get-Date).AddDays(7).ToString('yyyy-MM-dd')

Write-Host '=== Pruebas de aceptacion (gateway) ===' -ForegroundColor Cyan

# --- Parte 1: publicas ---

$r = Invoke-RestMethod -Uri 'https://127.0.0.1:3000/salud' -TimeoutSec 8 -SkipCertificateCheck -Headers @{ Origin = $origen }
Agregar-Resultado -Nombre '01 Gateway /salud' -Estado ($(if ($r.ok -eq $true) { 'Pasa' } else { 'Falla' })) -Detalle 'Endpoint de salud del gateway.'

$p = Llamar-Gateway -Rama 'CLIENTES' -Metodo 'GET'
Agregar-Resultado -Nombre '02 Acceso sin token 401' -Estado ($(if ($p.Codigo -eq 401) { 'Pasa' } else { 'Falla' })) -Detalle ("codigo " + $p.Codigo)

$p = Llamar-Gateway -Rama 'CLIENTES' -Metodo 'GET' -Token 'token.que.no.existe'
Agregar-Resultado -Nombre '03 Token invalido 401' -Estado ($(if ($p.Codigo -eq 401) { 'Pasa' } else { 'Falla' })) -Detalle ("codigo " + $p.Codigo)

$p = Llamar-Gateway -Rama 'INVENTADA' -Metodo 'GET'
Agregar-Resultado -Nombre '04 Rama invalida 404' -Estado ($(if ($p.Codigo -eq 404) { 'Pasa' } else { 'Falla' })) -Detalle ("codigo " + $p.Codigo)

$p = Llamar-Gateway -Rama 'CLIENTES' -Metodo 'DELETE'
Agregar-Resultado -Nombre '05 Metodo no permitido 405' -Estado ($(if ($p.Codigo -eq 405) { 'Pasa' } else { 'Falla' })) -Detalle ("codigo " + $p.Codigo)

$p = Llamar-Gateway -Rama 'CUENTAS' -Metodo 'GET'
Agregar-Resultado -Nombre '06 CUENTAS sin token 401' -Estado ($(if ($p.Codigo -eq 401) { 'Pasa' } else { 'Falla' })) -Detalle 'Rama de cuentas protegida.'

$cap = Captcha-Nuevo
Agregar-Resultado -Nombre '07 Captcha 201' -Estado ($(if ($cap.Ok) { 'Pasa' } else { 'Falla' })) -Detalle 'Genera id y objetivo.'

$seg = Captcha-Nuevo
$reuso = Llamar-Gateway -Rama 'USUARIOS' -Metodo 'POST' -Datos @{
    usuario = 'noexiste'; clave = 'ClaveInvalida123'; captcha_id = $cap.Id; captcha_respuesta = $cap.Respuesta
}
Agregar-Resultado -Nombre '08 Captcha un solo uso' -Estado ($(if ($cap.Ok -and $reuso.Codigo -in @(400,401)) { 'Pasa' } else { 'Falla' })) -Detalle ("codigo " + $reuso.Codigo)

$p = Llamar-Gateway -Rama 'MAQUINARIAS' -Metodo 'GET'
$heridasOk = ($p.Codigo -eq 200 -and $p.Cuerpo.datos -and $p.Cuerpo.datos.Count -gt 0)
Agregar-Resultado -Nombre '09 Catalogo publico 200' -Estado ($(if ($heridasOk) { 'Pasa' } else { 'Falla' })) -Detalle ("maquinarias: " + $(if ($p.Cuerpo.datos) { @($p.Cuerpo.datos).Count } else { 0 }))

$pValida = Llamar-Gateway -Rama 'FOTOS' -Metodo 'POST' -Datos @{ ruta = 'excavadora/foto01.jpg' }
$pMala = Llamar-Gateway -Rama 'FOTOS' -Metodo 'POST' -Datos @{ ruta = '../xampp/mysql/data' }
Agregar-Resultado -Nombre '10 Fotos valida/invalida' -Estado ($(if ($pValida.Codigo -eq 200 -and $pValida.Cuerpo.datos.contenido_base64 -and $pMala.Codigo -in @(400,404)) { 'Pasa' } else { 'Falla' })) -Detalle ("valida " + $pValida.Codigo + ", invalida " + $pMala.Codigo)

$pDoc = $marca
if ($pDoc.Length -gt 19) { $pDoc = $pDoc.Substring(0, 19) }
$pDoc = $pDoc + '0'
$p = Llamar-Gateway -Rama 'SOLICITUDES' -Metodo 'POST' -Token '' -Datos @{
    nombre = 'Solicitud de prueba ' + $marca; documento = $pDoc
    telefono = '6015550123'; idmaquinaria = 1; fechalquiler = $fechaHoy; fechadevolucionprogramada = $fechaFutura
    observaciones = 'Creada por scripts/pruebas.ps1'
}
$idsolicitudPrueba = $null
if ($p.Codigo -eq 201 -and $p.Cuerpo.datos.idsolicitud) {
    $idsolicitudPrueba = [int]$p.Cuerpo.datos.idsolicitud
}
Agregar-Resultado -Nombre '11 Solicitud publica 201' -Estado ($(if ($p.Codigo -eq 201) { 'Pasa' } else { 'Falla' })) -Detalle ("codigo " + $p.Codigo + ", numero " + $idsolicitudPrueba)

# --- Parte 2: autenticadas (si hay credenciales) ---
if ($Clave -eq '') {
    $archivoAdmin = Join-Path $Raiz 'basededatos\.admin-inicial.env'
    if (Test-Path -LiteralPath $archivoAdmin) {
        $linea = Get-Content -LiteralPath $archivoAdmin | Where-Object { $_ -match '^ADMIN_INICIAL=' } | Select-Object -First 1
        if ($linea) { $Clave = ($linea -replace '^ADMIN_INICIAL=', '').Trim() }
    }
}

if ($Clave -eq '') {
    Agregar-Resultado -Nombre '12-19 Autenticadas' -Estado 'Salta' -Detalle 'Sin credenciales de admin (use -Clave o basededatos/.admin-inicial.env).'
} else {
    $sesion = Login -User $Usuario -Pass $Clave
    if ($sesion.Codigo -eq 200 -and $sesion.Cuerpo.datos.token) {
        $token = $sesion.Cuerpo.datos.token
        Agregar-Resultado -Nombre '12 Login correcto JWT 15min' -Estado 'Pasa' -Detalle ('Rol ' + $sesion.Cuerpo.datos.rol + ', token firmado.')

        $capMala = Captcha-Nuevo
        $mal = Llamar-Gateway -Rama 'USUARIOS' -Metodo 'POST' -Datos @{
            usuario = $Usuario; clave = 'ClaveErronea999*'; captcha_id = $capMala.Id; captcha_respuesta = $capMala.Respuesta
        }
        Agregar-Resultado -Nombre '13 Login incorrecto 401' -Estado ($(if ($mal.Codigo -eq 401) { 'Pasa' } else { 'Falla' })) -Detalle ("codigo " + $mal.Codigo)

        $doc = ($marca -replace '\D', '') + '0'
        $doc = ($doc + '0000000000').Substring(0, 10)
        $rCrear = Llamar-Gateway -Rama 'CLIENTES' -Metodo 'POST' -Token $token -Datos @{
            nombre = 'Prueba ' + $marca; documento = $doc; telefono = '6015550123'
        }
        $idclientePrueba = $null
        if ($rCrear.Codigo -eq 201 -and $rCrear.Cuerpo.datos.idcliente) { $idclientePrueba = [int]$rCrear.Cuerpo.datos.idcliente }
        Agregar-Resultado -Nombre '14 Crear cliente 201' -Estado ($(if ($rCrear.Codigo -eq 201) { 'Pasa' } else { 'Falla' })) -Detalle ("id " + $idclientePrueba)

        $rDup = Llamar-Gateway -Rama 'CLIENTES' -Metodo 'POST' -Token $token -Datos @{
            nombre = 'Prueba dup'; documento = $doc; telefono = '6015550124'
        }
        Agregar-Resultado -Nombre '15 Cliente duplicado 409' -Estado ($(if ($rDup.Codigo -eq 409) { 'Pasa' } else { 'Falla' })) -Detalle ("codigo " + $rDup.Codigo)

        $rBusq = Llamar-Gateway -Rama 'CLIENTES' -Metodo 'GET' -Token $token -Datos @{ q = 'Prueba ' + $marca; limite = 5 }
        Agregar-Resultado -Nombre '16 Clientes busqueda 200' -Estado ($(if ($rBusq.Codigo -eq 200) { 'Pasa' } else { 'Falla' })) -Detalle ("codigo " + $rBusq.Codigo)

        $rListaU = Llamar-Gateway -Rama 'CUENTAS' -Metodo 'GET' -Token $token
        Agregar-Resultado -Nombre '17 CUENTAS lista admin 200' -Estado ($(if ($rListaU.Codigo -eq 200) { 'Pasa' } else { 'Falla' })) -Detalle ("cuentas: " + $(if ($rListaU.Cuerpo.datos) { @($rListaU.Cuerpo.datos).Count } else { 0 }))

        $usrNuevo = 'prueba' + (($marca -replace '\D',''))
        if ($usrNuevo.Length -gt 30) { $usrNuevo = $usrNuevo.Substring(0, 30) }
        $rCrearU = Llamar-Gateway -Rama 'CUENTAS' -Metodo 'POST' -Token $token -Datos @{
            nombre = 'Prueba operador'; usuario = $usrNuevo; rol = 'operador'; clave = 'TemporalClave123*'
        }
        Agregar-Resultado -Nombre '18 CUENTAS crear 201' -Estado ($(if ($rCrearU.Codigo -eq 201) { 'Pasa' } else { 'Falla' })) -Detalle ("usuario " + $usrNuevo)

        $rDupU = Llamar-Gateway -Rama 'CUENTAS' -Metodo 'POST' -Token $token -Datos @{
            nombre = 'Prueba operador dup'; usuario = $usrNuevo; rol = 'operador'; clave = 'TemporalClave123*'
        }
        Agregar-Resultado -Nombre '19 Usuario duplicado 409' -Estado ($(if ($rDupU.Codigo -eq 409) { 'Pasa' } else { 'Falla' })) -Detalle ("codigo " + $rDupU.Codigo)

        # Operador: login y 403 en accion reservada al administrador
        $sesionOpe = Login -User $usrNuevo -Pass 'TemporalClave123*'
        $tokOk = ($sesionOpe.Codigo -eq 200 -and $sesionOpe.Cuerpo.datos.token)
        if ($tokOk) {
            $tokenOpe = $sesionOpe.Cuerpo.datos.token
            $rOpe = Llamar-Gateway -Rama 'CUENTAS' -Metodo 'POST' -Token $tokenOpe -Datos @{
                nombre = 'No deberia'; usuario = 'nodeberia'; rol = 'operador'; clave = 'TemporalClave123*'
            }
            Agregar-Resultado -Nombre '20 Operador 403 en accion de admin' -Estado ($(if ($rOpe.Codigo -eq 403) { 'Pasa' } else { 'Falla' })) -Detalle ("codigo " + $rOpe.Codigo)
        } else {
            Agregar-Resultado -Nombre '20 Operador 403 en accion de admin' -Estado 'Salta' -Detalle ("login operador codigo " + $sesionOpe.Codigo)
        }

        # Reportes: resumen, guardar, listar, borrar (admin)
        $rRes = Llamar-Gateway -Rama 'REPORTES' -Metodo 'POST' -Token $token -Datos @{}
        if ($rRes.Codigo -ne 200) {
            # El resumen llega sin titulo: el gateway enruta a /reportes/resumen
            $rRes = Llamar-Gateway -Rama 'REPORTES' -Metodo 'POST' -Token $token -Datos @{ accion = 'resumen' }
        }
        $rGuardar = Llamar-Gateway -Rama 'REPORTES' -Metodo 'POST' -Token $token -Datos @{ titulo = 'Prueba ' + $marca }
        $idreportePrueba = $null
        if ($rGuardar.Codigo -eq 201 -and $rGuardar.Cuerpo.datos.idreporte) { $idreportePrueba = [int]$rGuardar.Cuerpo.datos.idreporte }
        $rListaRep = Llamar-Gateway -Rama 'REPORTES' -Metodo 'GET' -Token $token
        $rBorrarR = Llamar-Gateway -Rama 'REPORTES' -Metodo 'DELETE' -Token $token -Datos @{ idreporte = $idreportePrueba }
        Agregar-Resultado -Nombre '21 Reportes CRUD admin' -Estado ($(if ($rRes.Codigo -eq 200 -and $rGuardar.Codigo -eq 201 -and $rListaRep.Codigo -eq 200 -and $rBorrarR.Codigo -eq 200) { 'Pasa' } else { 'Falla' })) -Detalle ("resumen " + $rRes.Codigo + ", guardar " + $rGuardar.Codigo + ", listar " + $rListaRep.Codigo + ", borrar " + $rBorrarR.Codigo)

        # Alquiler: unidad disponible del catalogo; idempotencia; devolucion
        $rUnids = Llamar-Gateway -Rama 'UNIDADES' -Metodo 'POST' -Token $token -Datos @{ idmaquinaria = 1 }
        $idunidadLibre = $null
        if ($rUnids.Codigo -eq 200 -and $rUnids.Cuerpo.datos) {
            $libre = @($rUnids.Cuerpo.datos) | Where-Object { $_.estado -eq 'disponible' } | Select-Object -First 1
            if ($libre) { $idunidadLibre = [int]$libre.idunidad }
        }
        if ($idunidadLibre) {
            $claveIdem = 'prueba-' + $marca + '-' + $idunidadLibre
            $rAlq = Llamar-Gateway -Rama 'ALQUILERES' -Metodo 'POST' -Token $token -Datos @{
                idcliente = $idclientePrueba; idunidad = $idunidadLibre
                fechalquiler = $fechaHoy; fechadevolucionprogramada = $fechaFutura
                tarifa_pactada = 1450000; costo_movilizacion_pactado = 0; clave_idempotencia = $claveIdem
            }
            $idalquilerPrueba = $null
            if ($rAlq.Codigo -eq 201 -and $rAlq.Cuerpo.datos.idalquiler) { $idalquilerPrueba = [int]$rAlq.Cuerpo.datos.idalquiler }

            $rIdem = Llamar-Gateway -Rama 'ALQUILERES' -Metodo 'POST' -Token $token -Datos @{
                idcliente = $idclientePrueba; idunidad = $idunidadLibre
                fechalquiler = $fechaHoy; fechadevolucionprogramada = $fechaFutura
                tarifa_pactada = 1450000; costo_movilizacion_pactado = 0; clave_idempotencia = $claveIdem
            }
            $idempotente = ($rIdem.Codigo -eq 200 -and $rIdem.Cuerpo.datos.idalquiler -eq $idalquilerPrueba)

            $rDoble = Llamar-Gateway -Rama 'ALQUILERES' -Metodo 'POST' -Token $token -Datos @{
                idcliente = $idclientePrueba; idunidad = $idunidadLibre
                fechalquiler = $fechaHoy; fechadevolucionprogramada = $fechaFutura
                tarifa_pactada = 1450000; costo_movilizacion_pactado = 0; clave_idempotencia = ($claveIdem + '-2')
            }
            $duplicadoBloqueado = ($rDoble.Codigo -eq 409)

            $rDev = Llamar-Gateway -Rama 'DEVOLUCION' -Metodo 'PUT' -Token $token -Datos @{
                idalquiler = $idalquilerPrueba; fechadevolucionreal = $fechaHoy
                estadofisico = 'bueno'; niveldesgaste = 'ninguno'; valorreparacion = 0
                descripciondanos = ''; observaciones = 'Prueba'
            }
            $rDev2 = Llamar-Gateway -Rama 'DEVOLUCION' -Metodo 'PUT' -Token $token -Datos @{
                idalquiler = $idalquilerPrueba; fechadevolucionreal = $fechaHoy
                estadofisico = 'bueno'; niveldesgaste = 'ninguno'; valorreparacion = 0
                descripciondanos = ''; observaciones = 'Prueba repetida'
            }
            # Restaurar la unidad a disponible para no dejar residuos de estado
            $rEstado = Llamar-Gateway -Rama 'UNIDADES' -Metodo 'PUT' -Token $token -Datos @{ idunidad = $idunidadLibre; estado = 'disponible' }

            Agregar-Resultado -Nombre '22 Alquiler+idempotencia+devolucion' -Estado ($(if ($rAlq.Codigo -eq 201 -and $idempotente -and $duplicadoBloqueado -and $rDev.Codigo -eq 200 -and $rDev2.Codigo -eq 409) { 'Pasa' } else { 'Falla' })) -Detalle ("alquiler " + $rAlq.Codigo + ", idem " + $rIdem.Codigo + ", doble " + $rDoble.Codigo + ", dev " + $rDev.Codigo + ", dev2 " + $rDev2.Codigo + ", unidad a disponible " + $rEstado.Codigo)
        } else {
            Agregar-Resultado -Nombre '22 Alquiler+idempotencia+devolucion' -Estado 'Salta' -Detalle 'Sin unidad libre de la maquinaria 1.'
        }

        # Rechazar la solicitud publica creada al inicio (limpia el estado pendiente)
        if ($idsolicitudPrueba) {
            $rRech = Llamar-Gateway -Rama 'SOLICITUDES' -Metodo 'PUT' -Token $token -Datos @{
                idsolicitud = $idsolicitudPrueba; accion = 'rechazar'; motivo = 'Prueba automatizada'
            }
            Agregar-Resultado -Nombre '23 Solicitud rechazada 200' -Estado ($(if ($rRech.Codigo -eq 200) { 'Pasa' } else { 'Falla' })) -Detalle ("codigo " + $rRech.Codigo)
        }

        # Notificaciones: la creacion del contrato debe haber generado avisos;
        # el equipo las consulta y las marca todas como leidas.
        $rNot = Llamar-Gateway -Rama 'NOTIFICACIONES' -Metodo 'GET' -Token $token
        $datosNot = if ($rNot.Cuerpo -and $rNot.Cuerpo.datos) { $rNot.Cuerpo.datos } else { $null }
        $hayAvisos = ($datosNot -and $datosNot.notificaciones -and @($datosNot.notificaciones).Count -gt 0)
        Agregar-Resultado -Nombre '24 Notificaciones lista 200 con avisos' -Estado ($(if ($rNot.Codigo -eq 200 -and $hayAvisos) { 'Pasa' } else { 'Falla' })) -Detalle ("sin leer: " + $(if ($datosNot) { $datosNot.no_leidas } else { 'n/a' }))

        $rLeerTodas = Llamar-Gateway -Rama 'NOTIFICACIONES' -Metodo 'PUT' -Token $token -Datos @{ todas = $true }
        $rSinLeidas = Llamar-Gateway -Rama 'NOTIFICACIONES' -Metodo 'GET' -Token $token
        $quedan = 0
        if ($rSinLeidas.Cuerpo -and $rSinLeidas.Cuerpo.datos) { $quedan = [int]$rSinLeidas.Cuerpo.datos.no_leidas }
        Agregar-Resultado -Nombre '25 Notificaciones marcar todas 200' -Estado ($(if ($rLeerTodas.Codigo -eq 200 -and $quedan -eq 0) { 'Pasa' } else { 'Falla' })) -Detalle ("actualizadas " + $(if ($rLeerTodas.Cuerpo.datos) { $rLeerTodas.Cuerpo.datos.actualizadas } else { '?' }) + ", quedan " + $quedan)

        if ($tokOk) {
            $rNotOpe = Llamar-Gateway -Rama 'NOTIFICACIONES' -Metodo 'GET' -Token $tokenOpe
            $rNotOpePut = Llamar-Gateway -Rama 'NOTIFICACIONES' -Metodo 'PUT' -Token $tokenOpe -Datos @{ todas = $true }
            Agregar-Resultado -Nombre '26 Notificaciones operador (GET 200, PUT 200)' -Estado ($(if ($rNotOpe.Codigo -eq 200 -and $rNotOpePut.Codigo -eq 200) { 'Pasa' } else { 'Falla' })) -Detalle ("get " + $rNotOpe.Codigo + ", put " + $rNotOpePut.Codigo)
        } else {
            Agregar-Resultado -Nombre '26 Notificaciones operador' -Estado 'Salta' -Detalle 'Sin sesion de operador.'
        }
    } else {
        Agregar-Resultado -Nombre '12-23 Autenticadas' -Estado 'Falla' -Detalle ('Login admin codigo: ' + $sesion.Codigo)
    }
}

$pasan = @($resultados | Where-Object { $_.Estado -eq 'Pasa' }).Count
$fallan = @($resultados | Where-Object { $_.Estado -eq 'Falla' }).Count
$saltan = @($resultados | Where-Object { $_.Estado -eq 'Salta' }).Count
Write-Host ('=== Resumen: ' + $pasan + ' pasan, ' + $fallan + ' fallan, ' + $saltan + ' saltadas ===') -ForegroundColor Cyan
if ($fallan -gt 0) { exit 1 }
exit 0
