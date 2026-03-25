# WYMAGANE: uruchom jako Administrator

$ErrorActionPreference = "Stop"

Write-Host "=== START INSTALACJI POSNET SERVER ==="

# -----------------------------
# 1. Instalacja NVM + Node 20
# -----------------------------
if (!(Get-Command nvm -ErrorAction SilentlyContinue)) {
    Write-Host "Instaluję NVM for Windows..."

    $nvmUrl = "https://github.com/coreybutler/nvm-windows/releases/latest/download/nvm-setup.exe"
    $nvmInstaller = "$env:TEMP\nvm-setup.exe"

    Invoke-WebRequest $nvmUrl -OutFile $nvmInstaller
    Start-Process $nvmInstaller -Wait

    Write-Host "NVM zainstalowany. Uruchom ponownie PowerShell jako Administrator i odpal skrypt ponownie."
    exit
}

Write-Host "Instaluję Node.js 20..."
nvm install 20
nvm use 20

# -----------------------------
# 2. Sprawdzenie Node
# -----------------------------
node -v
npm -v

# -----------------------------
# 3. Pobranie PosnetServer
# -----------------------------
$zipUrl = "https://bigdotsoftware.pl/download.php?fname=posnetserver.win64.5.7.1201.zip"
$zipFile = "$env:TEMP\posnetserver.zip"
$targetDir = "C:\PosnetServer001"

Write-Host "Pobieram PosnetServer..."
Invoke-WebRequest $zipUrl -OutFile $zipFile

# -----------------------------
# 4. Rozpakowanie
# -----------------------------
Write-Host "Rozpakowuję do $targetDir..."

if (Test-Path $targetDir) {
    Remove-Item $targetDir -Recurse -Force
}

Expand-Archive $zipFile -DestinationPath $targetDir

# jeśli zip ma folder w środku → przenieś zawartość
$inner = Get-ChildItem $targetDir | Where-Object { $_.PSIsContainer }
if ($inner.Count -eq 1) {
    Move-Item "$($inner.FullName)\*" $targetDir -Force
    Remove-Item $inner.FullName -Recurse -Force
}

# -----------------------------
# 5. npm install
# -----------------------------
Write-Host "Instaluję zależności npm..."
Set-Location $targetDir
npm install

# -----------------------------
# 6. Instalacja PM2 globalnie
# -----------------------------
Write-Host "Instaluję PM2..."
npm install -g pm2

# -----------------------------
# 7. pm2-windows-service
# -----------------------------
Write-Host "Instaluję pm2-windows-service..."
npm install -g pm2-windows-service

# -----------------------------
# 8. Uruchomienie PM2
# -----------------------------
Write-Host "Uruchamiam aplikację przez PM2..."
pm2 start ecosystem.config.js

# ustawienie katalogu PM2 globalnie (dla wszystkich użytkowników)
$pm2Home = "C:\pm2"
[System.Environment]::SetEnvironmentVariable("PM2_HOME", $pm2Home, "Machine")

if (!(Test-Path $pm2Home)) {
    New-Item -ItemType Directory -Path $pm2Home | Out-Null
}

pm2 save

# -----------------------------
# 9. Instalacja jako Windows Service
# -----------------------------
Write-Host "Instaluję usługę Windows..."
pm2-service-install -n posnetservice

Write-Host "=== GOTOWE ==="
