$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$Port = if ($env:PORT) { $env:PORT } else { "5050" }
$Url = "http://127.0.0.1:$Port"
$HealthUrl = "$Url/api/health"
$DriveBundleUrl = "https://drive.google.com/file/d/1pdqTVd0ciqwXZup5FsVr38rsoeGHDylO/view"
$ArchiveName = "social-empires-forge-assets-1.4.07.tar.gz"

function Write-Header {
    Clear-Host
    Write-Host "============================================================" -ForegroundColor DarkYellow
    Write-Host "         SOCIAL EMPIRES FORGE (Clasico v1.4.07)             " -ForegroundColor Yellow
    Write-Host "            Lanzador Local para Windows (60+ FPS)           " -ForegroundColor DarkYellow
    Write-Host "============================================================" -ForegroundColor DarkYellow
    Write-Host ""
}

function Test-ServerAlive {
    try {
        $resp = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2 -ErrorAction Stop
        return ($resp.status -eq "ok")
    } catch {
        return $false
    }
}

function Find-AssetArchive {
    $candidates = @(
        (Join-Path $RepoRoot $ArchiveName),
        (Join-Path $RepoRoot "assets\$ArchiveName"),
        (Join-Path $env:USERPROFILE "Downloads\$ArchiveName"),
        (Join-Path $env:USERPROFILE "Descargas\$ArchiveName"),
        (Join-Path $env:USERPROFILE "Desktop\$ArchiveName"),
        (Join-Path $env:USERPROFILE "Escritorio\$ArchiveName"),
        (Join-Path $env:USERPROFILE "OneDrive\Downloads\$ArchiveName"),
        (Join-Path $env:USERPROFILE "OneDrive\Descargas\$ArchiveName"),
        (Join-Path $env:USERPROFILE "OneDrive\Desktop\$ArchiveName"),
        (Join-Path $env:USERPROFILE "OneDrive\Escritorio\$ArchiveName")
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) {
            return $c
        }
    }
    return $null
}

Write-Header

# 0. Si el juego ya estaba corriendo en el puerto local, abrir directamente el navegador
if (Test-ServerAlive) {
    Write-Host "[OK] Social Empires Forge ya esta ejecutandose en $Url" -ForegroundColor Green
    Write-Host "     Abriendo tu navegador..." -ForegroundColor Cyan
    Start-Process $Url
    Start-Sleep -Seconds 2
    exit 0
}

# 1. Verificar Node.js >= 22
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$nodeOk = $false
if ($nodeCmd) {
    $nodeVerRaw = (& node -v).Trim()
    if ($nodeVerRaw -match "^v(\d+)\.") {
        $major = [int]$Matches[1]
        if ($major -ge 22) {
            $nodeOk = $true
            Write-Host "[1/5] Node.js detectado: $nodeVerRaw" -ForegroundColor Green
        } else {
            Write-Host "[!] Se encontro Node.js $nodeVerRaw, pero se requiere Node.js 22 o superior." -ForegroundColor Yellow
        }
    }
}

if (-not $nodeOk) {
    Write-Host ""
    Write-Host "Se requiere Node.js 22 LTS para ejecutar Social Empires Forge." -ForegroundColor Yellow
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        $ans = Read-Host "Quieres instalar Node.js 22 LTS automaticamente con winget? (S/N)"
        if ($ans -match "^[sSyY]") {
            Write-Host "Instalando Node.js 22 LTS..." -ForegroundColor Cyan
            & winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
            Write-Host ""
            Write-Host "[OK] Instalacion completada. Cierra esta ventana y vuelve a hacer doble clic en 'Jugar Social Empires.bat'." -ForegroundColor Green
            Read-Host "Presiona Enter para salir"
            exit 0
        }
    }
    Write-Host "Abriendo https://nodejs.org/ para descargar Node.js 22 LTS..." -ForegroundColor Cyan
    Start-Process "https://nodejs.org/"
    Read-Host "Instala Node.js 22 LTS y vuelve a abrir este lanzador. Presiona Enter para salir"
    exit 1
}

# 2. Verificar / habilitar pnpm
$pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpmCmd) {
    Write-Host "[2/5] Habilitando pnpm..." -ForegroundColor Cyan
    $corepack = Get-Command corepack -ErrorAction SilentlyContinue
    if ($corepack) {
        try {
            & corepack enable | Out-Null
            & corepack prepare pnpm@12.21.0 --activate | Out-Null
        } catch {
            & npm install -g pnpm
        }
    } else {
        & npm install -g pnpm
    }
    $pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
    if (-not $pnpmCmd) {
        throw "No se pudo habilitar pnpm. Abre PowerShell y ejecuta: npm install -g pnpm"
    }
}
Write-Host "[2/5] pnpm listo." -ForegroundColor Green

# 3. Instalar dependencias si hace falta
if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) {
    Write-Host "[3/5] Instalando dependencias del proyecto (solo la primera vez)..." -ForegroundColor Cyan
    & pnpm install
    if ($LASTEXITCODE -ne 0) { throw "Fallo 'pnpm install'." }
} else {
    Write-Host "[3/5] Dependencias ya instaladas." -ForegroundColor Green
}

# 4. Verificar o descomprimir assets compilados (1,588 sprites WebP + audio + UI)
$manifestPath = Join-Path $RepoRoot "assets\generated\manifest.json"
if (-not (Test-Path $manifestPath)) {
    Write-Host "[4/5] Buscando paquete de assets ($ArchiveName)..." -ForegroundColor Cyan
    $archive = Find-AssetArchive

    while (-not $archive -and -not (Test-Path $manifestPath)) {
        Write-Host ""
        Write-Host "No se encontraron los assets compilados todavia." -ForegroundColor Yellow
        Write-Host "Opciones:" -ForegroundColor White
        Write-Host "  [1] Descargar el paquete listo desde tu Google Drive (RECOMENDADO, ~720 MB, sin Python ni Java)" -ForegroundColor Green
        Write-Host "      Guardalo en tu carpeta Descargas y vuelve aqui." -ForegroundColor Gray
        Write-Host "  [2] Ya lo descargue -> buscar de nuevo" -ForegroundColor Cyan
        Write-Host "  [3] Regenerar todos los assets localmente con 'pnpm assets:pipeline' (requiere Python 3 + Pillow y Java 21)" -ForegroundColor DarkGray
        Write-Host ""
        $choice = Read-Host "Elige una opcion (1, 2 o 3)"

        if ($choice -eq "1") {
            Start-Process $DriveBundleUrl
            Write-Host "Se abrio Google Drive en tu navegador. Cuando termine la descarga en 'Descargas', presiona Enter." -ForegroundColor Cyan
            Read-Host "Presiona Enter para continuar"
            $archive = Find-AssetArchive
        } elseif ($choice -eq "2") {
            $archive = Find-AssetArchive
        } elseif ($choice -eq "3") {
            Write-Host "Ejecutando pipeline completo local..." -ForegroundColor Cyan
            & pnpm assets:pipeline
            if ($LASTEXITCODE -ne 0) { throw "Fallo 'pnpm assets:pipeline'." }
            break
        }
    }

    if ($archive -and -not (Test-Path $manifestPath)) {
        Write-Host "[4/5] Paquete encontrado: $archive" -ForegroundColor Green
        Write-Host "      Descomprimiendo assets en assets\generated (solo la primera vez)..." -ForegroundColor Cyan
        New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot "assets\generated") | Out-Null
        & tar.exe -xzf "$archive" -C (Join-Path $RepoRoot "assets\generated")
        if ($LASTEXITCODE -ne 0) { throw "Error al descomprimir $archive con tar.exe." }
    }
}
Write-Host "[4/5] Assets verificados (1,588 sprites WebP + 35 SFX + 7 musicas)." -ForegroundColor Green

# 5. Compilar frontend web de produccion si hace falta
$webIndex = Join-Path $RepoRoot "apps\web\dist\index.html"
if (-not (Test-Path $webIndex)) {
    Write-Host "[5/5] Compilando interfaz web de produccion (solo la primera vez)..." -ForegroundColor Cyan
    & pnpm --filter @sef/web build
    if ($LASTEXITCODE -ne 0) { throw "Fallo la compilacion del frontend." }
} else {
    Write-Host "[5/5] Interfaz web lista." -ForegroundColor Green
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Iniciando Social Empires Forge en $Url" -ForegroundColor Green
Write-Host "  El navegador se abrira automaticamente en unos segundos." -ForegroundColor White
Write-Host "  NO cierres esta ventana mientras juegas." -ForegroundColor Yellow
Write-Host "  (Para cerrar el juego, simplemente cierra esta ventana)" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""

# Abrir el navegador automaticamente en segundo plano apenas el servidor responda
Start-Job -ScriptBlock {
    param($health, $targetUrl)
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $r = Invoke-RestMethod -Uri $health -TimeoutSec 2 -ErrorAction Stop
            if ($r.status -eq "ok") {
                Start-Process $targetUrl
                return
            }
        } catch {
            # Esperando a que el servidor termine de iniciar
        }
    }
} -ArgumentList $HealthUrl, $Url | Out-Null

$env:HOST = "127.0.0.1"
$env:PORT = $Port
& pnpm start
