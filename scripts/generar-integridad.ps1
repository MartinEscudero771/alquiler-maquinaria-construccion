#requires -Version 7.0
<#
.SINOPSIS
    Genera integridad.json: huella SHA-256 de cada archivo servido por el
    frontend estatico.
.DESCRIPCION
    frontend-server/server.js carga el frontend en memoria al arrancar y
    compara cada SHA-256 contra integridad.json (raiz del proyecto). Si un
    archivo declarado falta o cambia, se registra en logs/seguridad.log y
    no se sirve la version alterada hasta reiniciar tras regenerar.
    Ejecutar este script despues de cada cambio legítimo del frontend.
#>
[CmdletBinding()]
param(
    [string]$Raiz = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$Raiz = (Resolve-Path -LiteralPath $Raiz).Path
$dirFrontend = Join-Path $Raiz 'frontend'
$salida = Join-Path $Raiz 'integridad.json'

if (-not (Test-Path -LiteralPath $dirFrontend)) {
    Write-Error "No existe $dirFrontend."
}

# Extensiones servidas por frontend-server/server.js (lista blanca).
$extensiones = @('.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.woff', '.woff2', '.txt', '.json')

$archivos = Get-ChildItem -LiteralPath $dirFrontend -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $extensiones -contains $_.Extension.ToLower() }

if ($archivos.Count -eq 0) {
    Write-Error 'El frontend no tiene archivos servibles. No se genera integridad.json.'
}

$huellas = [ordered]@{}
foreach ($archivo in ($archivos | Sort-Object FullName)) {
    $relativa = [System.IO.Path]::GetRelativePath($dirFrontend, $archivo.FullName).Replace('\', '/')
    $hash = (Get-FileHash -LiteralPath $archivo.FullName -Algorithm SHA256).Hash.ToLower()
    $huellas[$relativa] = $hash
}

$json = ConvertTo-Json -InputObject $huellas -Depth 3
Set-Content -LiteralPath $salida -Value $json -Encoding UTF8 -NoNewline

Write-Host "integridad.json generado con $($huellas.Count) huellas SHA-256." -ForegroundColor Green
exit 0
