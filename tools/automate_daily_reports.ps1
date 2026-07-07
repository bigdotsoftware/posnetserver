#requires -Version 5.1

[CmdletBinding()]
param(
    [ValidateSet('dobowy', 'miesieczny')]
    [string]$Type = 'dobowy',

    [string]$StartDate,
    [string]$EndDate,

    [switch]$Detailed,
    [switch]$PrintPast,
    [switch]$PrintCurrent,
    [switch]$ReportPastMonth,
    [switch]$ReportCurrentMonth,
    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Show-Usage {
    Write-Host "Użycie: .\\automate_daily_reports.ps1 [opcje]"
    Write-Host ""
    Write-Host "Opcje:"
    Write-Host "  -Type TYPE              Typ raportu: 'dobowy' lub 'miesieczny' (domyslnie: dobowy)"
    Write-Host "  -Help                   Pokaz te wiadomosc pomocy"
    Write-Host "Opcje raportu dobowego:"
    Write-Host "  -PrintPast              Drukuj raport z poprzedniego dnia (lub z poprzedniego miesiaca) na drukarce"
    Write-Host "  -PrintCurrent           Drukuj raport z dzisiejszego dnia (lub aktualnego miesiaca) na drukarce"
    Write-Host "  -Detailed               Raport szczegolowy dla raportu miesiecznego"
    Write-Host "Opcje raportu miesiecznego:"
    Write-Host "  -StartDate YYYY-MM-DD   Data poczatkowa dla raportu miesiecznego"
    Write-Host "  -EndDate YYYY-MM-DD     Data koncowa dla raportu miesiecznego"
    Write-Host "  -Detailed               Raport szczegolowy dla raportu miesiecznego"
    Write-Host "  -PrintPast              Drukuj raport z poprzedniego dnia (lub z poprzedniego miesiaca) na drukarce"
    Write-Host "  -PrintCurrent           Drukuj raport z dzisiejszego dnia (lub aktualnego miesiaca) na drukarce"
    Write-Host "  -ReportPastMonth        Automatycznie ustaw daty poczatkowa i koncowa dla raportu miesiecznego na poprzedni miesiac. Przekazane parametry -StartDate i -EndDate zostana zignorowane."
    Write-Host "  -ReportCurrentMonth     Automatycznie ustaw daty poczatkowa i koncowa dla raportu miesiecznego na aktualny miesiac. Przekazane parametry -StartDate i -EndDate zostana zignorowane."
    Write-Host ""
    Write-Host "Przyklady:"
    Write-Host "  .\\automate_daily_reports.ps1"
    Write-Host "  .\\automate_daily_reports.ps1 -PrintPast"
    Write-Host "  .\\automate_daily_reports.ps1 -PrintCurrent"
    Write-Host "  .\\automate_daily_reports.ps1 -Type miesieczny -StartDate 2026-01-01 -EndDate 2026-01-31 -Detailed -PrintPast"
    Write-Host "  .\\automate_daily_reports.ps1 -Type miesieczny -StartDate 2026-01-01 -EndDate 2026-01-31 -Detailed -PrintCurrent"
    Write-Host "  .\\automate_daily_reports.ps1 -Type miesieczny -PrintPast -ReportPastMonth"
    Write-Host "  .\\automate_daily_reports.ps1 -Type miesieczny -PrintCurrent -ReportCurrentMonth"
    exit 0
}

if ($Help) {
    Show-Usage
}

function Test-DateString {
    param([string]$Value)

    return $Value -match '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
}

function Get-PrettyHostname {
    try {
        return [System.Net.Dns]::GetHostByName($env:COMPUTERNAME).HostName
    }
    catch {
        return $env:COMPUTERNAME
    }
}

function ConvertTo-FlatCsvRows {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Rows
    )

    if (-not $Rows -or $Rows.Count -eq 0) {
        return @()
    }

    $allKeys = @($Rows | ForEach-Object {
        if ($null -ne $_ -and $_.PSObject.Properties) {
            $_.PSObject.Properties.Name
        }
    } | Where-Object { $_ -ne $null } | Select-Object -Unique)

    $filteredKeys = @($allKeys | Where-Object { $_ -notmatch '(_65|_112)$' } | Sort-Object)

    $csvRows = foreach ($row in $Rows) {
        if ($null -eq $row) {
            continue
        }

        $obj = [ordered]@{}
        foreach ($key in $filteredKeys) {
            if ($row.PSObject.Properties.Name -contains $key) {
                $value = $row.$key
                if ($null -eq $value) {
                    $obj[$key] = ''
                }
                elseif ($value -is [string]) {
                    $obj[$key] = $value
                }
                elseif ($value -is [System.Collections.IEnumerable] -and -not ($value -is [string])) {
                    $obj[$key] = ($value | ConvertTo-Json -Compress -Depth 10)
                }
                else {
                    $obj[$key] = [string]$value
                }
            }
            else {
                $obj[$key] = ''
            }
        }

        [pscustomobject]$obj
    }

    return $csvRows
}

function ConvertTo-AggregatedObject {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Rows
    )

    if (-not $Rows -or $Rows.Count -eq 0) {
        return @()
    }

    $aggregated = @{}

    foreach ($row in $Rows) {
        if ($null -eq $row) {
            continue
        }

        foreach ($property in $row.PSObject.Properties) {
            $name = $property.Name
            $value = $property.Value

            if ($name -match 'date|ts' -or $name -match '(_65|_112)$') {
                continue
            }

            if (-not $aggregated.ContainsKey($name)) {
                $aggregated[$name] = $value
                continue
            }

            if ($value -is [System.Collections.IEnumerable] -and -not ($value -is [string])) {
                continue
            }

            if ($value -is [int] -or $value -is [long] -or $value -is [double] -or $value -is [decimal]) {
                $aggregated[$name] = [decimal]$aggregated[$name] + [decimal]$value
            }
        }
    }

    return [pscustomobject]$aggregated
}

$REPORT_TYPE = $Type
$PRINT_PAST_REPORT = [string]$PrintPast.IsPresent
$PRINT_CURRENT_REPORT = [string]$PrintCurrent.IsPresent
$REPORT_PAST_MONTH = [string]$ReportPastMonth.IsPresent
$REPORT_CURRENT_MONTH = [string]$ReportCurrentMonth.IsPresent
$DETAILED_REPORT = [string]$Detailed.IsPresent
$START_DATE = if ($PSBoundParameters.ContainsKey('StartDate')) { $StartDate } else { '' }
$END_DATE = if ($PSBoundParameters.ContainsKey('EndDate')) { $EndDate } else { '' }

if ($REPORT_TYPE -ne 'dobowy' -and $REPORT_TYPE -ne 'miesieczny') {
    Write-Error 'Blad: typ raportu musi być ''dobowy'' lub ''miesieczny'''
    exit 1
}

if ($REPORT_PAST_MONTH -eq 'True') {
    $previousMonth = (Get-Date).AddMonths(-1)
    $year = $previousMonth.Year
    $month = $previousMonth.Month
    $START_DATE = '{0}-{1:00}-01' -f $year, $month
    $END_DATE = '{0}-{1:00}-{2:00}' -f $year, $month, [DateTime]::DaysInMonth($year, $month)
}
if ($REPORT_CURRENT_MONTH -eq 'True') {
    $currentMonth = Get-Date
    $year = $currentMonth.Year
    $month = $currentMonth.Month
    $START_DATE = '{0}-{1:00}-01' -f $year, $month
    $END_DATE = '{0}-{1:00}-{2:00}' -f $year, $month, [DateTime]::DaysInMonth($year, $month)
}


if ($REPORT_TYPE -eq 'miesieczny') {
    if ([string]::IsNullOrWhiteSpace($START_DATE) -or [string]::IsNullOrWhiteSpace($END_DATE)) {
        Write-Error 'Blad: dla raportu miesiecznego wymagane sa opcje -StartDate i -EndDate'
        exit 1
    }

    if (-not (Test-DateString -Value $START_DATE)) {
        Write-Error 'Blad: nieprawidlowy format daty poczatkowej, wymagany format: YYYY-MM-DD'
        exit 1
    }

    if (-not (Test-DateString -Value $END_DATE)) {
        Write-Error 'Blad: nieprawidlowy format daty końcowej, wymagany format: YYYY-MM-DD'
        exit 1
    }
}

$FULLDEBUG = 'true'
# $POSNETSERVERHOST = 'http://192.168.0.103:80/api/posnetserver'
$POSNETSERVERHOST = 'http://127.0.0.1:3050'
$OUTPUT_DIRECTORY = $env:TEMP
$PRETTY_HOSTNAME = Get-PrettyHostname
$DEVICEID = ''

$targetDir = Join-Path $OUTPUT_DIRECTORY "$PRETTY_HOSTNAME/posnet"
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

if ($REPORT_TYPE -eq 'dobowy') {
    $yesterday = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
    $today = (Get-Date).ToString('yyyy-MM-dd')
    $REPORT_DATE = $today
    $DATE_FROM = $yesterday + 'T00:00:00+02:00'
    $DATE_TO = $yesterday + 'T23:59:59+02:00'
    $REPORT_NAME = "raport_dobowy_$today"
}
else {
    $REPORT_DATE = "$START_DATE`_do_$END_DATE"
    $DATE_FROM = $START_DATE + 'T00:00:00+02:00'
    $DATE_TO = $END_DATE + 'T23:59:59+02:00'
    $REPORT_NAME = "raport_miesieczny_$REPORT_DATE"
}

Write-Host '=========================================='
Write-Host "POSNET Raport - Typ: $REPORT_TYPE"
Write-Host "Data raportu: $REPORT_DATE"
Write-Host "Drukowanie (za wczorajszy dzien/poprzedni miesiac): $PRINT_PAST_REPORT"
Write-Host "Drukowanie (za dzis/aktualny miesiac): $PRINT_CURRENT_REPORT"

if ($REPORT_TYPE -eq 'miesieczny') {
    Write-Host "Szczegolowy: $DETAILED_REPORT"
    Write-Host "Od: $START_DATE"
    Write-Host "Do: $END_DATE"
    
}
Write-Host '=========================================='
$requiredVersion = [Version]"5.1"
if ($PSVersionTable.PSVersion -ge $requiredVersion) {
    Write-Host "PowerShell $($PSVersionTable.PSVersion) - OK"
}
else {
    Write-Host "PowerShell $($PSVersionTable.PSVersion) - wymagany jest PowerShell 5.1 lub nowszy."
    exit 1
}

try {
    $result = Invoke-RestMethod -Method Get -Uri "${POSNETSERVERHOST}/deviceid?fulldebug=${FULLDEBUG}" -ContentType 'application/json'
    Write-Host "Device ID Response: $($result | ConvertTo-Json -Depth 20 -Compress)"

    if ($result.ok -ne $true) {
        throw 'Error: Cannot read unique device ID'
    }

    $DEVICEID = $result.device.id
    Write-Host "Device ID: $DEVICEID"
}
catch {
    Write-Error $_
    exit 1
}

if ($PRINT_PAST_REPORT -eq 'True' -or $PRINT_CURRENT_REPORT -eq 'True') {
    Write-Host ''
    

    if ($REPORT_TYPE -eq 'dobowy') {
        if ($PRINT_PAST_REPORT -eq 'True' ) {
            Write-Host "Drukowanie raportu $REPORT_TYPE z dnia $yesterday ..."
            $printBody = @{ da = $yesterday } | ConvertTo-Json -Compress
        }else{
            Write-Host "Drukowanie raportu $REPORT_TYPE z dnia $today ..."
            $printBody = @{ da = $today } | ConvertTo-Json -Compress
        }
        $result = Invoke-RestMethod -Method Post -Uri "${POSNETSERVERHOST}/raporty/dobowy?fulldebug=true" -ContentType 'application/json' -Body $printBody
        Write-Host "Response: $($result | ConvertTo-Json -Depth 20 -Compress)"
    }
    else 
    {
        Write-Host "Drukowanie raportu $REPORT_TYPE za miesiac $START_DATE ..."
        $printParams = [ordered]@{ da = $START_DATE }
        if ($Detailed) {
            $printParams['su'] = $false
        }
        else {
            $printParams['su'] = $true
        }

        $printBody = $printParams | ConvertTo-Json -Compress
        $result = Invoke-RestMethod -Method Post -Uri "${POSNETSERVERHOST}/raporty/miesieczny?fulldebug=true" -ContentType 'application/json' -Body $printBody
        Write-Host "Response: $($result | ConvertTo-Json -Depth 20 -Compress)"
    }

    Write-Host ''
}

Write-Host ''
Write-Host "Pobieranie danych z pamieci fiskalnej od $DATE_FROM..."

$body = [ordered]@{
    mergeSections = $true
    useCache = $false
}

if ($REPORT_TYPE -eq 'dobowy') {
    $body['dateFrom'] = $DATE_FROM
}
else {
    $body['dateFrom'] = $DATE_FROM
    $body['dateTo'] = $DATE_TO
}

try {
    Write-Host "Payload: $($body | ConvertTo-Json -Depth 10 -Compress)"
    $result = Invoke-RestMethod -Method Post -Uri "${POSNETSERVERHOST}/raporty/events/dobowy?fulldebug=${FULLDEBUG}" -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 10 -Compress)
    Write-Host "Response: $($result | ConvertTo-Json -Depth 20 -Compress)"
}
catch {
    # Write-Error 'Error: Cannot read fiscal memory events'
    # Write-Error $_
    # Write-Host "Response: $($result | ConvertTo-Json -Depth 20 -Compress)"
    Write-Host ""
    Write-Host "===== EXCEPTION ====="

    $_ | Format-List * -Force

    if ($_.Exception.Response) {

        $reader = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
        $body = $reader.ReadToEnd()

        Write-Host ""
        Write-Host "===== SERVER RESPONSE ====="
        Write-Host $body
    }

    # throw
    exit 1
}

$task = $result.task
if ([string]::IsNullOrWhiteSpace($task) -or $task -eq 'null') {
    Write-Error 'Blad: nie otrzymano identyfikatora zadania'
    Write-Error "Response: $($result | ConvertTo-Json -Depth 20 -Compress)"
    exit 1
}

$processing = $true
$counter = 0
while ($processing) {
    Start-Sleep -Seconds 1
    $counter++
    Write-Host "[$counter] checking task $task..."

    $result = Invoke-RestMethod -Method Get -Uri "${POSNETSERVERHOST}/tasks/get/${task}?fulldebug=${FULLDEBUG}" -ContentType 'application/json'
    # Write-Host ($result | ConvertTo-Json -Depth 100)
    $processing = [bool]$result.hits.task.inprogress

    $taskObject = $result.hits.task
    if ($taskObject.PSObject.Properties.Name -contains 'progress' -and $null -ne $taskObject.progress) {
        $progress = [int]$taskObject.progress
        Write-Host "Processing: $progress %"
    }
    else {
        Write-Host 'Processing: brak danych'
    }

    if ($taskObject.PSObject.Properties.Name -contains 'status') {
        $taskStatus = $result.hits.task.status
        if ($taskStatus -eq 'error') {
            Write-Error 'Blad: zadanie zakończylo sie bledem'
            Write-Error ($result | ConvertTo-Json -Depth 40 -Compress)
            exit 1
        }
    }
}

Write-Host 'Zadanie ukonczone'
Write-Host ($result | ConvertTo-Json -Depth 60 -Compress)

$JSON_FILE = Join-Path $targetDir "$REPORT_NAME`_$DEVICEID.json"
$JSON_FILE_AGG = Join-Path $targetDir "$REPORT_NAME`_aggregated_$DEVICEID.json"
$CSV_FILE = Join-Path $targetDir "$REPORT_NAME`_$DEVICEID.csv"
$CSV_FILE_AGG = Join-Path $targetDir "$REPORT_NAME`_aggregated_$DEVICEID.csv"

$result | ConvertTo-Json -Depth 100 | Set-Content -Path $JSON_FILE -Encoding utf8
Write-Host ''
Write-Host 'DONE, results saved:'
Write-Host "JSON: $JSON_FILE"

$rows = @($result.hits.task.result.results | ForEach-Object { $_.sections[0] })
if ($rows.Count -gt 0) {
    $csvRows = ConvertTo-FlatCsvRows -Rows $rows
    $csvRows | Export-Csv -Path $CSV_FILE -NoTypeInformation -Encoding utf8
    Write-Host "  CSV: $CSV_FILE"
}
else {
    Write-Host '  Uwaga: brak danych do wygenerowania CSV'
}

$aggregatedRows = @($rows | ForEach-Object { $_ })
if ($aggregatedRows.Count -gt 0) {
    $aggregated = ConvertTo-AggregatedObject -Rows $aggregatedRows
    $aggregated | ConvertTo-Json -Depth 100 | Set-Content -Path $JSON_FILE_AGG -Encoding utf8
    $aggregated | ConvertTo-Csv -NoTypeInformation | Set-Content -Path $CSV_FILE_AGG -Encoding utf8
    Write-Host "  CSV: $CSV_FILE_AGG"
}

# Write-Host ''
# Write-Host '=========================================='
# Write-Host 'Raport JSON:'
# Write-Host '=========================================='
# $result | ConvertTo-Json -Depth 100
