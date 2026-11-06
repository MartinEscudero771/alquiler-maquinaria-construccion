#requires -Version 7.0
<#
.SINOPSIS
    Verifica la salud del proyecto: sintaxis, dependencias, estructura,
    puertos, /salud y ausencia de secretos en el codigo.
.DESCRIPCION
    Ejecuta todas las comprobaciones y muestra un reporte pasa/falla.
    Termina con exit 0 si todo pasa y exit 1 si hay al menos una falla.
#>
[CmdletBinding()]
param(
    [string]$Raiz = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Continue'

$Raiz = (Resolve-Path -LiteralPath $Raiz).Path
$resultados = New-Object Collections.Generic.List[object]

function Agregar-Resultado {
    param([string]$Nombre, [string]$Estado, [string]$Detalle)
    $resultados.Add([pscustomobject]@{ Prueba = $Nombre; Estado = $Estado; Detalle = $Detalle })
    $color = switch ($Estado) { 'Pasa' { 'Green' } 'Falla' { 'Red' } default { 'Yellow' } }
    Write-Host "[$Estado] $Nombre : $Detalle" -ForegroundColor $color
}

function Test-PuertoEnUso {
    param([int]$Puerto)
    $cliente = $null
    try {
        $cliente = New-Object Net.Sockets.TcpClient
        $manejador = $cliente.BeginConnect('127.0.0.1', $Puerto, $null, $null)
        return $manejador.AsyncWaitHandle.WaitOne(500)
    } catch {
        return $false
    } finally {
        if ($null -ne $cliente) { $cliente.Close() }
    }
}

Write-Host "=== Verificacion del proyecto ===" -ForegroundColor Cyan

# 1. Sintaxis PHP.
$phpArchivos = Get-ChildItem -LiteralPath (Join-Path $Raiz 'apis\apiphp') -Filter '*.php' -ErrorAction SilentlyContinue
if ($null -eq $phpArchivos -or $phpArchivos.Count -eq 0) {
    Agregar-Resultado -Nombre 'PHP lint' -Estado 'Falla' -Detalle 'No hay archivos PHP.'
} else {
    foreach ($archivo in $phpArchivos) {
        & php -l $archivo.FullName 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Agregar-Resultado -Nombre "PHP lint $($archivo.Name)" -Estado 'Pasa' -Detalle 'Sin errores de sintaxis.'
        } else {
            Agregar-Resultado -Nombre "PHP lint $($archivo.Name)" -Estado 'Falla' -Detalle 'Error de sintaxis.'
        }
    }
}

# 1b. Sintaxis PowerShell de los scripts del proyecto.
$psArchivos = Get-ChildItem -LiteralPath (Join-Path $Raiz 'scripts') -Filter '*.ps1' -ErrorAction SilentlyContinue
if ($null -eq $psArchivos -or $psArchivos.Count -eq 0) {
    Agregar-Resultado -Nombre 'PowerShell parse' -Estado 'Omitido' -Detalle 'No hay scripts .ps1.'
} else {
    foreach ($archivo in $psArchivos) {
        $erroresParse = $null
        [System.Management.Automation.Language.Parser]::ParseFile($archivo.FullName, [ref]$null, [ref]$erroresParse) | Out-Null
        if ($erroresParse.Count -eq 0) {
            Agregar-Resultado -Nombre "PowerShell parse $($archivo.Name)" -Estado 'Pasa' -Detalle 'Parseo sin errores.'
        } else {
            Agregar-Resultado -Nombre "PowerShell parse $($archivo.Name)" -Estado 'Falla' -Detalle $erroresParse[0].Message
        }
    }
}

# 2. Sintaxis Node (gateway + apinode + frontend-server).
$jsArchivos = @()
$jsArchivos += Get-ChildItem -LiteralPath (Join-Path $Raiz 'api-gateway') -Filter 'server.js' -ErrorAction SilentlyContinue
$jsArchivos += Get-ChildItem -LiteralPath (Join-Path $Raiz 'api-gateway\src') -Filter '*.js' -Recurse -ErrorAction SilentlyContinue
$jsArchivos += Get-ChildItem -LiteralPath (Join-Path $Raiz 'apis\apinode') -Filter '*.js' -ErrorAction SilentlyContinue
$jsArchivos += Get-ChildItem -LiteralPath (Join-Path $Raiz 'frontend-server') -Filter '*.js' -ErrorAction SilentlyContinue
if ($jsArchivos.Count -eq 0) {
    Agregar-Resultado -Nombre 'Node check' -Estado 'Omitido' -Detalle 'No hay archivos JS que revisar.'
} else {
    foreach ($archivo in $jsArchivos) {
        & node --check $archivo.FullName 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Agregar-Resultado -Nombre "Node check $($archivo.Name)" -Estado 'Pasa' -Detalle 'Sintaxis valida.'
        } else {
            Agregar-Resultado -Nombre "Node check $($archivo.Name)" -Estado 'Falla' -Detalle 'Error de sintaxis.'
        }
    }
}

# 3. Sintaxis Python.
$pyArchivos = Get-ChildItem -LiteralPath (Join-Path $Raiz 'apis\apipython') -Filter '*.py' -ErrorAction SilentlyContinue
if ($null -eq $pyArchivos -or $pyArchivos.Count -eq 0) {
    Agregar-Resultado -Nombre 'Python compile' -Estado 'Falla' -Detalle 'No hay archivos Python.'
} else {
    foreach ($archivo in $pyArchivos) {
        & python -m py_compile $archivo.FullName 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Agregar-Resultado -Nombre "Python compile $($archivo.Name)" -Estado 'Pasa' -Detalle 'Compila sin errores.'
        } else {
            Agregar-Resultado -Nombre "Python compile $($archivo.Name)" -Estado 'Falla' -Detalle 'Error de compilacion.'
        }
    }
}

# 4. npm audit en gateway y apinode (solo si hay dependencias instaladas).
foreach ($nombre in @('api-gateway', 'apis\apinode')) {
    $dir = Join-Path $Raiz $nombre
    $etiqueta = $nombre.Replace('\', '/')
    if (-not (Test-Path -LiteralPath (Join-Path $dir 'package.json'))) {
        Agregar-Resultado -Nombre "npm audit $etiqueta" -Estado 'Omitido' -Detalle 'Sin package.json.'
        continue
    }
    if (-not (Test-Path -LiteralPath (Join-Path $dir 'node_modules'))) {
        Agregar-Resultado -Nombre "npm audit $etiqueta" -Estado 'Omitido' -Detalle 'Sin node_modules. Ejecute iniciar.ps1.'
        continue
    }
    Push-Location -LiteralPath $dir
    try {
        & npm audit --audit-level=high 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Agregar-Resultado -Nombre "npm audit $etiqueta" -Estado 'Pasa' -Detalle 'Sin vulnerabilidades altas o criticas.'
        } else {
            Agregar-Resultado -Nombre "npm audit $etiqueta" -Estado 'Falla' -Detalle 'Hay vulnerabilidades altas o criticas.'
        }
    } finally {
        Pop-Location
    }
}

# 4b. pip-audit para la rama Python (solo si esta instalado).
$hayPython = $true
try { & pip --version 2>&1 | Out-Null } catch { $hayPython = $false }
if (-not $hayPython) {
    Agregar-Resultado -Nombre 'pip-audit Python' -Estado 'Omitido' -Detalle 'pip no disponible.'
} else {
    & pip show pip-audit 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Agregar-Resultado -Nombre 'pip-audit Python' -Estado 'Omitido' -Detalle 'pip-audit no instalado (instalable con: pip install pip-audit).'
    } else {
        Push-Location -LiteralPath (Join-Path $Raiz 'apis\apipython')
        try {
            & pip-audit -r requirements.txt --disable-pip 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Agregar-Resultado -Nombre 'pip-audit Python' -Estado 'Pasa' -Detalle 'Sin vulnerabilidades conocidas en requirements.txt.'
            } else {
                Agregar-Resultado -Nombre 'pip-audit Python' -Estado 'Falla' -Detalle 'Vulnerabilidades en requirements.txt.'
            }
        } finally {
            Pop-Location
        }
    }
}

# 5. .env.example presentes y .env no versionado.
$ejemplos = @('apis\apiphp\.env.example', 'apis\apinode\.env.example', 'apis\apipython\.env.example')
foreach ($rel in $ejemplos) {
    if (Test-Path -LiteralPath (Join-Path $Raiz $rel)) {
        Agregar-Resultado -Nombre "Existe $rel" -Estado 'Pasa' -Detalle 'Plantilla de variables presente.'
    } else {
        Agregar-Resultado -Nombre "Existe $rel" -Estado 'Falla' -Detalle 'Falta la plantilla.'
    }
}
$gitignore = Join-Path $Raiz '.gitignore'
$ignoraEnv = (Test-Path -LiteralPath $gitignore) -and ((Get-Content -LiteralPath $gitignore -Raw) -match '(?m)^\.env\s*$')
if ($ignoraEnv) {
    Agregar-Resultado -Nombre '.env ignorado por Git' -Estado 'Pasa' -Detalle '.gitignore excluye .env.'
} else {
    Agregar-Resultado -Nombre '.env ignorado por Git' -Estado 'Falla' -Detalle '.gitignore no excluye .env.'
}
$respaldosIgnorados = (Test-Path -LiteralPath $gitignore) -and ((Get-Content -LiteralPath $gitignore -Raw) -match 'respaldos/')
if ($respaldosIgnorados) {
    Agregar-Resultado -Nombre 'Respaldos fuera de Git' -Estado 'Pasa' -Detalle '.gitignore excluye respaldos/*.sql.'
} else {
    Agregar-Resultado -Nombre 'Respaldos fuera de Git' -Estado 'Falla' -Detalle '.gitignore no excluye los respaldos.'
}

# 6. Estructura de carpetas.
$requeridas = @('api-gateway', 'apis\apiphp', 'apis\apinode', 'apis\apipython', 'basededatos', 'docs', 'frontend', 'logs', 'respaldos', 'scripts')
foreach ($rel in $requeridas) {
    if (Test-Path -LiteralPath (Join-Path $Raiz $rel)) {
        Agregar-Resultado -Nombre "Carpeta $rel" -Estado 'Pasa' -Detalle 'Existe.'
    } else {
        Agregar-Resultado -Nombre "Carpeta $rel" -Estado 'Falla' -Detalle 'No existe.'
    }
}
if (Test-Path -LiteralPath (Join-Path $Raiz 'basededatos\esquema.sql')) {
    Agregar-Resultado -Nombre 'Archivo esquema.sql' -Estado 'Pasa' -Detalle 'Existe.'
} else {
    Agregar-Resultado -Nombre 'Archivo esquema.sql' -Estado 'Falla' -Detalle 'No existe.'
}

# 6b. Huella de integridad del frontend.
$rutaHuella = Join-Path $Raiz 'integridad.json'
if (Test-Path -LiteralPath $rutaHuella) {
    try {
        $huella = Get-Content -LiteralPath $rutaHuella -Raw | ConvertFrom-Json
        $cuantas = @($huella.PSObject.Properties.Name).Count
        if ($cuantas -gt 0) {
            Agregar-Resultado -Nombre 'integridad.json' -Estado 'Pasa' -Detalle ("Huella presente con $cuantas archivos.")
        } else {
            Agregar-Resultado -Nombre 'integridad.json' -Estado 'Falla' -Detalle 'Vacía. Regénere con scripts/generar-integridad.ps1.'
        }
    } catch {
        Agregar-Resultado -Nombre 'integridad.json' -Estado 'Falla' -Detalle 'JSON inválido.'
    }
} else {
    Agregar-Resultado -Nombre 'integridad.json' -Estado 'Falla' -Detalle 'Falta. Ejecute scripts/generar-integridad.ps1.'
}

# 7. Puertos (informativo).
foreach ($puerto in @(3306, 8000, 3002, 3003, 3000, 8443)) {
    $estado = if (Test-PuertoEnUso -Puerto $puerto) { 'en uso' } else { 'libre' }
    Agregar-Resultado -Nombre "Puerto $puerto" -Estado 'Pasa' -Detalle "Puerto $estado."
}

# 8. Endpoints /salud (solo si el puerto esta en uso).
$saludes = @(
    @{ Nombre = 'API PHP'; Puerto = 8000 },
    @{ Nombre = 'API Node'; Puerto = 3002 },
    @{ Nombre = 'API Python'; Puerto = 3003 },
    @{ Nombre = 'Gateway'; Puerto = 3000 }
)
foreach ($s in $saludes) {
    if (-not (Test-PuertoEnUso -Puerto $s.Puerto)) {
        Agregar-Resultado -Nombre "Salud $($s.Nombre)" -Estado 'Omitido' -Detalle 'Servicio detenido.'
        continue
    }
    try {
        try {
            $esquema = if ($s.Puerto -eq 3000) { 'https' } else { 'http' }
            $r = Invoke-RestMethod -Uri "$esquema`://127.0.0.1:$($s.Puerto)/salud" -TimeoutSec 5 -SkipCertificateCheck
            if ($r.ok -eq $true -or $r.codigo -eq 200) {
                Agregar-Resultado -Nombre "Salud $($s.Nombre)" -Estado 'Pasa' -Detalle 'Responde 200.'
            } else {
                Agregar-Resultado -Nombre "Salud $($s.Nombre)" -Estado 'Falla' -Detalle 'Respuesta inesperada.'
            }
        } catch {
            $codigoHttp = $null
            try { $codigoHttp = [int]$_.Exception.Response.StatusCode } catch { $codigoHttp = $null }
            if ($s.Nombre -eq 'API PHP' -and ($codigoHttp -eq 403 -or $codigoHttp -eq 401)) {
                Agregar-Resultado -Nombre "Salud $($s.Nombre)" -Estado 'Pasa' -Detalle 'Protegida por clave interna (403), servicio vivo.'
            } else {
                throw
            }
        }
    } catch {
        Agregar-Resultado -Nombre "Salud $($s.Nombre)" -Estado 'Falla' -Detalle 'No responde /salud.'
    }
}

# 8b. Frontend: TLS, cabeceras de seguridad, SRI y sin handlers en linea.
if (-not (Test-PuertoEnUso -Puerto 8443)) {
    Agregar-Resultado -Nombre 'Frontend TLS y cabeceras' -Estado 'Omitido' -Detalle 'Servicio detenido.'
} else {
    try {
        $w = Invoke-WebRequest -Uri 'https://localhost:8443/index.html' -TimeoutSec 8 -SkipCertificateCheck -UseBasicParsing
        $fallosCab = @()
        if ([int]$w.StatusCode -ne 200) { $fallosCab += 'estado ' + $w.StatusCode }
        if (-not $w.Headers['Content-Security-Policy']) { $fallosCab += 'sin CSP' }
        if (-not $w.Headers['X-Content-Type-Options']) { $fallosCab += 'sin nosniff' }
        if (-not $w.Headers['Strict-Transport-Security']) { $fallosCab += 'sin HSTS' }
        if (-not $w.Headers['X-Frame-Options']) { $fallosCab += 'sin X-Frame-Options' }
        if ($w.Headers['Cache-Control'] -notmatch 'no-store') { $fallosCab += 'HTML sin no-store' }
        if ($w.Content -notmatch 'integrity="sha384-') { $fallosCab += 'sin SRI en vendor' }
        if ($w.Content -match 'onerror=|onclick=|style="--') { $fallosCab += 'handlers/estilos en linea' }
        $css = Invoke-WebRequest -Uri 'https://localhost:8443/css/estilos.css' -TimeoutSec 8 -SkipCertificateCheck -UseBasicParsing
        if ([int]$css.StatusCode -ne 200) { $fallosCab += 'css no responde' }
        if (-not $css.Headers['ETag']) { $fallosCab += 'css sin ETag' }
        if ($css.Headers['Cache-Control'] -notmatch 'no-cache') { $fallosCab += 'css sin revalidacion no-cache' }
        if ($css.Headers['Content-Encoding'] -and $css.Headers['Content-Encoding'] -notmatch 'gzip') { $fallosCab += 'encoding raro' }
        # Revalidacion por ETag: si hay ETag, una segunda peticion debe dar 304.
        if ($css.Headers['ETag']) {
            $etagValor = [string]$css.Headers['ETag']
            $res304 = Invoke-WebRequest -Uri 'https://localhost:8443/css/estilos.css' -TimeoutSec 8 -SkipCertificateCheck -UseBasicParsing -SkipHttpErrorCheck -Headers @{ 'If-None-Match' = $etagValor } -ErrorAction SilentlyContinue
            if ($res304 -and [int]$res304.StatusCode -ne 304) { $fallosCab += 'ETag no devuelve 304' }
        }
        if ($fallosCab.Count -eq 0) {
            Agregar-Resultado -Nombre 'Frontend TLS y cabeceras' -Estado 'Pasa' -Detalle 'HTTPS + CSP/HSTS/nosniff/SRI, sin handlers en linea.'
        } else {
            Agregar-Resultado -Nombre 'Frontend TLS y cabeceras' -Estado 'Falla' -Detalle ($fallosCab -join '; ')
        }
    } catch {
        Agregar-Resultado -Nombre 'Frontend TLS y cabeceras' -Estado 'Falla' -Detalle ('No responde por HTTPS: ' + $_.Exception.Message)
    }
}

# 9. Codigo prohibido: 0.0.0.0, localStorage, .sesiones.json y secretos escritos.
$dirsCodigo = @((Join-Path $Raiz 'apis'), (Join-Path $Raiz 'api-gateway\src'), (Join-Path $Raiz 'frontend\js'))
$patronProhibido = '0\.0\.0\.0|localStorage|\.sesiones\.json'
$archivosRevisar = @()
foreach ($dir in $dirsCodigo) {
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    $archivosRevisar += Get-ChildItem -LiteralPath $dir -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch 'node_modules|vendor|\.example' -and $_.Extension -match '\.(php|js|py|json|html|css)$' }
}
$hallazgos = @()
if ($archivosRevisar.Count -gt 0) {
    $hallazgos = @(Select-String -Path $archivosRevisar.FullName -Pattern $patronProhibido -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty Path -Unique)
}
$patronSecreto = '(?i)(DB_PASS|CLAVE_INTERNA[A-Z_]*)\s*=\s*[''"][^''"]+[''"]'
$archivosCodigo = @()
foreach ($dir in $dirsCodigo) {
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    $archivosCodigo += Get-ChildItem -LiteralPath $dir -Include '*.php', '*.js', '*.py' -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch 'node_modules|vendor|\.example' }
}
$secretos = @()
foreach ($archivo in $archivosCodigo) {
    $contenido = Get-Content -LiteralPath $archivo.FullName -Raw -ErrorAction SilentlyContinue
    if ($null -ne $contenido -and ($contenido -match $patronSecreto)) {
        if ($contenido -notmatch 'getenv|os\.getenv|process\.env') {
            $secretos += $archivo.FullName
        }
    }
}
if ($hallazgos.Count -eq 0) {
    Agregar-Resultado -Nombre 'Sin 0.0.0.0/localStorage/.sesiones.json' -Estado 'Pasa' -Detalle 'Codigo limpio.'
} else {
    Agregar-Resultado -Nombre 'Sin 0.0.0.0/localStorage/.sesiones.json' -Estado 'Falla' -Detalle ($hallazgos -join '; ')
}
if ($secretos.Count -eq 0) {
    Agregar-Resultado -Nombre 'Sin secretos escritos' -Estado 'Pasa' -Detalle 'Claves solo por entorno.'
} else {
    Agregar-Resultado -Nombre 'Sin secretos escritos' -Estado 'Falla' -Detalle ($secretos -join '; ')
}

# 5. Secretos en archivos versionados: esquema SQL, docs, scripts, frontend.
#    (IDENTIFIED BY con valor literal, hashes bcrypt $2y$, credenciales de prueba.)
$patronSecretoVersionado = 'IDENTIFIED BY\s+''(?!@)[^'']+''|\$2y\$\d{2}\$[./A-Za-z0-9]{53}|[A]dmin123\*|[L]ector123\*|[O]perador123\*|[P]hpClave123|[N]odeClave123|[P]ythonClave'
$dirsVersionados = @(
    (Join-Path $Raiz 'basededatos'),
    (Join-Path $Raiz 'docs'),
    (Join-Path $Raiz 'scripts'),
    (Join-Path $Raiz 'frontend')
)
$archivosVersionados = @()
foreach ($dir in $dirsVersionados) {
    if (-not (Test-Path -LiteralPath $dir)) { continue }
    $archivosVersionados += Get-ChildItem -LiteralPath $dir -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch 'node_modules|vendor|respaldos|\.env' -and $_.Extension -match '\.(sql|md|ps1|html|css|js)$' }
}
$secretosVersionados = @()
foreach ($archivo in $archivosVersionados) {
    $contenido = Get-Content -LiteralPath $archivo.FullName -Raw -ErrorAction SilentlyContinue
    if ($null -ne $contenido -and ($contenido -match $patronSecretoVersionado)) {
        $secretosVersionados += $archivo.FullName
    }
}
if ($secretosVersionados.Count -eq 0) {
    Agregar-Resultado -Nombre 'Sin secretos en archivos versionados' -Estado 'Pasa' -Detalle 'Sin claves ni hashes en SQL/docs/scripts/frontend.'
} else {
    Agregar-Resultado -Nombre 'Sin secretos en archivos versionados' -Estado 'Falla' -Detalle ($secretosVersionados -join '; ')
}

# Reporte final.
$pasan = @($resultados | Where-Object { $_.Estado -eq 'Pasa' }).Count
$fallan = @($resultados | Where-Object { $_.Estado -eq 'Falla' }).Count
$omiten = @($resultados | Where-Object { $_.Estado -eq 'Omitido' }).Count
Write-Host "=== Resumen: $pasan pasan, $fallan fallan, $omiten omitidos ===" -ForegroundColor Cyan
if ($fallan -gt 0) { exit 1 }
exit 0
