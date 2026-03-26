# WYMAGANE: uruchom jako Administrator

$ErrorActionPreference = "Stop"
$POSNET_SERVER_VERSION="5.7.1201"
$POSNET_DEST_DIR="C:\PosnetServer001"
$NODE_VERSION="20"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())

if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Ten skrypt musi byc uruchomiony jako Administrator!"
    Write-Host "Kliknij PPM -> Uruchom jako administrator"
    exit 1
}

Write-Host "=== START INSTALACJI POSNET SERVER ==="

# -----------------------------
# 1. Instalacja NVM + Node 20
# -----------------------------
if (!(Get-Command nvm -ErrorAction SilentlyContinue)) {
    Write-Host "Instalacja NVM for Windows..."
    Write-Host "Postepuj zgodnie z instrukcjami, klikaj Dalej, Dalej, Dalej ..."

    $nvmUrl = "https://github.com/coreybutler/nvm-windows/releases/latest/download/nvm-setup.exe"
    $nvmInstaller = "$env:TEMP\nvm-setup.exe"

    Invoke-WebRequest $nvmUrl -OutFile $nvmInstaller
    Start-Process $nvmInstaller -Wait

    Write-Host "NVM zainstalowany. Uruchom ponownie PowerShell jako Administrator i odpal skrypt ponownie."
    exit
}

Write-Host "Instalacja Node.js $NODE_VERSION..."

nvm install $NODE_VERSION
nvm use $NODE_VERSION

sleep 2
# -----------------------------
# 2. Sprawdzenie Node
# -----------------------------
Write-Host "Version check..."
node -v
npm -v

# -----------------------------
# 3. Pobranie PosnetServer
# -----------------------------
$zipUrl = "https://bigdotsoftware.pl/download.php?fname=posnetserver.win64.$POSNET_SERVER_VERSION.zip"
$zipFile = "$env:TEMP\posnetserver.zip"
$targetDir = $POSNET_DEST_DIR
Write-Host $zipUrl

if (Test-Path $targetDir) {
    Write-Host "PosnetServer juz istnieje w $targetDir , pomijam pobieranie i rozpakowanie."
}
else {
    Write-Host "Pobieram PosnetServer..."
    Invoke-WebRequest $zipUrl -OutFile $zipFile

    # -----------------------------
    # 4. Rozpakowanie
    # -----------------------------
    Write-Host "Rozpakowywanie do $targetDir..."

    # if (Test-Path $targetDir) {
    #     sleep 2
    #     Remove-Item $targetDir -Recurse -Force
    # }
    Write-Host "Zatrzymuję stare procesy (pm2/node)..."

    # zatrzymaj pm2 jeśli istnieje
    try {
        cmd.exe /c "pm2 stop all"
        cmd.exe /c "pm2 delete all"
    }
    catch {}

    # zabij node.exe (często trzyma pliki)
    Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

    # opcjonalnie zabij pm2
    Get-Process pm2 -ErrorAction SilentlyContinue | Stop-Process -Force

    Start-Sleep -Seconds 2

    # spróbuj usunąć katalog
    if (Test-Path $targetDir) {
        Write-Host "Usuwam stary katalog..."

        try {
            Remove-Item $targetDir -Recurse -Force -ErrorAction Stop
        }
        catch {
            Write-Host "Katalog nadal zablokowany, probuje alternatywnie..."

            # fallback przez cmd (często skuteczniejszy)
            $cmd = "rmdir /s /q `"$POSNET_DEST_DIR`""
            cmd.exe /c $cmd

            Start-Sleep -Seconds 2
        }
    }


    Expand-Archive $zipFile -DestinationPath $targetDir

    # jeśli zip ma folder w środku → przenieś zawartość
    $inner = Get-ChildItem $targetDir | Where-Object { $_.PSIsContainer }
    if ($inner.Count -eq 1) {
        Move-Item "$($inner.FullName)\*" $targetDir -Force
        Remove-Item $inner.FullName -Recurse -Force
    }
}



# -----------------------------
# 5. npm install
# -----------------------------
Write-Host "Instalacja zaleznosci npm..."
Start-Process cmd.exe -ArgumentList "/c npm install" -WorkingDirectory $POSNET_DEST_DIR -Wait


# -----------------------------
# 6. Instalacja PM2 globalnie
# -----------------------------
Write-Host "Instalacja PM2 (cmd.exe)..."
cmd.exe /c "npm install -g pm2"

# -----------------------------
# 7. pm2-windows-service
# -----------------------------
Write-Host "Instalacja pm2-windows-service..."
cmd.exe /c "npm uninstall -g pm2-windows-service"
cmd.exe /c "pm2-service-uninstall"
# cmd.exe /c "npm install -g pm2-installer"
cmd.exe /c "npm install -g pm2-windows-startup"
# cmd.exe /c "npm install -g pm2-windows-service"

# -----------------------------
# 8. Uruchomienie PM2
# -----------------------------
Write-Host "Tworze plik ecosystem.config.js..."
$ecosystemContent = @'
module.exports = {
  apps : [
    {
      name: "PosnetServer001",
      script: "cmd.exe",
      args: "/c serverstart.cmd",
      exec_mode: "fork",
      watch     : false,
      ignore_watch : ["logs", "scripts", "tests"],
      out_file  : "NUL",
      error_file: "NUL",
      log_file  : "NUL",
      env: {
         POSNET_LIB_SHARE_DIR: ".",
         PATH: ".;" + process.env.PATH
      },
      env_production : {
        NODE_ENV: "production"
      }
    }
  ]
}
'@

$ecosystemPath = Join-Path $POSNET_DEST_DIR "ecosystem.config.js"
Set-Content -Path $ecosystemPath -Value $ecosystemContent -Encoding UTF8

Write-Host "Uruchamiam aplikacje przez PM2 (cmd.exe)..."
Start-Process cmd.exe -ArgumentList "/c pm2 start ecosystem.config.js" -WorkingDirectory $POSNET_DEST_DIR -WindowStyle Hidden
Start-Sleep -Seconds 10

# ustawienie katalogu PM2 globalnie (dla wszystkich użytkowników)
$pm2Home = "C:\pm2"
Write-Host "Ustawiam PM2_HOME..."

try {
    # próbuj globalnie (dla wszystkich użytkowników)
    [System.Environment]::SetEnvironmentVariable("PM2_HOME", $pm2Home, "Machine")
    Write-Host "PM2_HOME ustawione globalnie"
}
catch {
    Write-Host "Brak uprawnien do Machine scope , ustawiam PM2_HOME dla biezacego uzytkownika"

    [System.Environment]::SetEnvironmentVariable("PM2_HOME", $pm2Home, "User")
}

# ustaw też w aktualnej sesji (bardzo ważne!)
$env:PM2_HOME = $pm2Home

# utwórz katalog jeśli nie istnieje
if (!(Test-Path $pm2Home)) {
    New-Item -ItemType Directory -Path $pm2Home | Out-Null
}

cmd.exe /c "pm2 save"
Start-Sleep -Seconds 3

# -----------------------------
# 9. Instalacja jako Windows Service
# -----------------------------
# Write-Host "Instalacja uslug Windows..."
# Write-Host "Odpowiadaj:"
# Write-Host "Y"
# Write-Host "Y"
# Write-Host "C:\pm2"
# Write-Host "Y"
# Write-Host "<just enter>"
# Write-Host "Y"
# Write-Host "<just enter>"
# cmd.exe /c "pm2-service-install -n PosnetServer"
# cmd.exe /c "pm2-installer install"
cmd.exe /c "pm2-startup install"

# -----------------------------
# 10. Sprawdzenie działania API
# -----------------------------
Write-Host "Sprawdzam czy PosnetServer dziala..."

$baseUrl = "http://127.0.0.1:3050"
$statusUrl = "$baseUrl/status"

$maxAttempts = 30
$delaySeconds = 3
$success1 = $false
$success2 = $false

for ($i = 1; $i -le $maxAttempts; $i++) {
    Write-Host "Proba $i/$maxAttempts..."

    try {
        $resp1 = Invoke-WebRequest $baseUrl -UseBasicParsing -TimeoutSec 5
        if ($resp1.StatusCode -eq 200) {
            Write-Host "OK ----- PosnetServer dziala poprawnie!"
            $success1 = $true
        }else{
            Write-Host "PosnetServer jeszcze nie odpowiada lub zwraca blad inny 200OK..."
        }
    }
    catch {
        Write-Host "PosnetServer jeszcze nie odpowiada..."
    }

    try {
        $resp2 = Invoke-WebRequest $statusUrl -UseBasicParsing -TimeoutSec 10
        if ($resp2.StatusCode -eq 200) {
            Write-Host "OK ----- PosnetServer dziala polaczenie z drukarka!"
            $success2 = $true
        }else{
            Write-Host "PosnetServer nie moze polaczyc sie z drukarka..."
        }
    }
    catch {
        Write-Host "PosnetServer nie ma jeszcze polaczenia z drukarka..."
    }

    if ($success1 -and $success2) {
        break
    }

    Start-Sleep -Seconds $delaySeconds
}

if (-not $success1) {
    Write-Host "ERROR ----- Nie udalo sie potwierdzic dzialania PosnetServer!"
    Write-Host "Sprawdz logi PM2: pm2 logs"
    exit 1
}
if (-not $success2) {
    Write-Host "ERROR ----- Nie udalo sie potwierdzic dzialania PosnetServer!"
    Write-Host "Sprawdz logi PM2: pm2 logs"
    exit 1
}

Write-Host "=== GOTOWE ==="
