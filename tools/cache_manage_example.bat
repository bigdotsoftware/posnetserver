@echo off
setlocal enableextensions
SETLOCAL EnableDelayedExpansion

REM ---------------------------------------------------------------------------
REM | Environment preparation
REM | Make sure that both 3rd party commands are available
REM | - curl (https://curl.se/)
REM | - jq (https://jqlang.github.io/jq/)  -> Portable version https://github.com/jqlang/jq/releases/download/jq-1.7/jq-windows-amd64.exe
REM |
REM ---------------------------------------------------------------------------

REM --- configuration
SET POSNETSERVERHOST=http://192.168.0.31:3050
call :getYesterdayDate yesterday
SET YESTERDAY=%yesterday%
SET TODAY=%DATE:~10,4%-%DATE:~4,2%-%DATE:~7,2%
SET REPORT_FROM=2020-01-01
SET FULLDEBUG=true
SET CACHE_TYPE=full
SET OUTPUT_DIRECTORY=C:/tmp
SET PRETTY_HOSTNAME=%COMPUTERNAME%
SET DEVICEID=
SET JQ=jq-windows-amd64.exe

echo  YESTERDAY: %YESTERDAY%
echo  TODAY: %TODAY%

REM --- get device ID (request compatible with version >= 4.4; when using older version, comment below request and set DEVICEID manually in this script)
REM curl -s -XGET "%POSNETSERVERHOST%/deviceid?fulldebug=%FULLDEBUG%" -H "Content-type: application/json" > %OUTPUT_DIRECTORY%/result.json
REM for /f %%i in ('%JQ% -r ".ok" %OUTPUT_DIRECTORY%/result.json') do set ok=%%i
REM echo  ok: %ok%
REM 
REM if "%ok%"=="true" (
REM     for /f %%i in ('%JQ% -r ".device.id" %OUTPUT_DIRECTORY%/result.json') do set DEVICEID=%%i
REM     echo  DEVICEID: %DEVICEID%
REM ) else (
REM     echo "Error: Cannot read unique device ID. Your device is not connected or is not an ONLINE device"
REM     GOTO :EOF
REM )

REM --- check if cache exists
curl -s -XGET "%POSNETSERVERHOST%/cache/ranges?fulldebug=%FULLDEBUG%" -H "Content-type: application/json" > %OUTPUT_DIRECTORY%/result.json
for /f %%i in ('%JQ% -r ".ok" %OUTPUT_DIRECTORY%/result.json') do set ok=%%i
echo  ok: %ok%

if "%ok%"=="true" (
    REM --- check if existing cache type match to requested type
	for /f %%i in ('%JQ% -r ".cache.type" %OUTPUT_DIRECTORY%/result.json') do set cache_type=%%i
	REM for /f %%i in ('%JQ% -r ".cache.dateFrom" %OUTPUT_DIRECTORY%/result.json') do set cache_dateFrom=%%i
	for /f %%i in ('%JQ% -r ".cache.dateFrom|strflocaltime(\"%Y-%m-%d\")" %OUTPUT_DIRECTORY%/result.json') do set iso_dateFrom=%%i

    if "%cache_type%"=="%CACHE_TYPE%" (
        REM --- cache exists, expand it
        echo "Expanding cache from %iso_dateFrom%"
        curl -s -XPOST "%POSNETSERVERHOST%/cache/update?fulldebug=%FULLDEBUG%" -H "Content-type: application/json" -d "
        {
            \"dateFrom\":\"%iso_dateFrom%T00:00:00+02:00\",
            \"dateTo\":\"%TODAY%T23:59:59+02:00\"
        }" > %OUTPUT_DIRECTORY%/result.json
        for /f %%i in ('%JQ% -r ".ok" %OUTPUT_DIRECTORY%/result.json') do set ok=%%i
        echo  /cache/update ok: %ok%
    ) else (
        echo "Error: Cannot extend cache, cache types are different"
        GOTO :EOF
    )
) else (
    REM --- cache doesn't exist, build it
    REM --- build cache from yesterday till today
    echo "Building cache from %YESTERDAY%"
    curl -s -XPOST "%POSNETSERVERHOST%/cache/build?fulldebug=%FULLDEBUG%" -H "Content-type: application/json" -d "
    {
       \"dateFrom\":\"%YESTERDAY%T00:00:00+02:00\",
       \"dateTo\":\"%TODAY%T23:59:59+02:00\",
       \"cacheType\" : \"%CACHE_TYPE%\"
    }" > %OUTPUT_DIRECTORY%/result.json
    for /f %%i in ('%JQ% -r ".ok" %OUTPUT_DIRECTORY%/result.json') do set ok=%%i
    echo  /cache/build ok: %ok%
)

REM --- when build/update succeeded, wait for task to be finished
if "%ok%"=="true" (
    for /f %%i in ('%JQ% -r ".task" %OUTPUT_DIRECTORY%/result.json') do set task=%%i
    SET processing=true
    :still_processing
        timeout /t 1 /nobreak >nul
        echo "Checking task %task%"
        curl -s -XGET "%POSNETSERVERHOST%/tasks/get/%task%?fulldebug=%FULLDEBUG%" -H "Content-type: application/json" > %OUTPUT_DIRECTORY%/result.json
        for /f %%i in ('%JQ% -r ".hits.task.inprogress" %OUTPUT_DIRECTORY%/result.json') do set processing=%%i
        more %OUTPUT_DIRECTORY%/result.json
        if "%processing%"=="true" goto :still_processing

) else (

    echo "Error: Cannot build/update existing cache"
    GOTO :EOF
)


REM --- use existing cache to list all daily reports
mkdir -p %OUTPUT_DIRECTORY%/%PRETTY_HOSTNAME%/posnet/

curl -s -XPOST "%POSNETSERVERHOST%/raporty/events/dobowy?fulldebug=%FULLDEBUG%" -H "Content-type: application/json" -d "
{
  \"dateFrom\": \"%REPORT_FROM%T00:00:00+02:00\",
  \"mergeSections\": true,
  \"useCache\": true
}" > %OUTPUT_DIRECTORY%/%PRETTY_HOSTNAME%/posnet/%DEVICEID%.json

echo "DONE, results: %OUTPUT_DIRECTORY%/%PRETTY_HOSTNAME%/posnet/%DEVICEID%.json"

GOTO :EOF

:getYesterdayDate ret
    setlocal enableextensions disabledelayedexpansion
    call :getTodayDate today
    for /f "tokens=1-3 delims=/ " %%a in ("%today%") do set /a "y=%%a", "m=1%%b-100", "d=1%%c-100"
    if %d% gtr 1 ( set /a "d-=1" ) else (
        if %m% equ 1 ( set /a "y-=1" , "m=12" ) else ( set /a "m-=1" )
        set /a "d=30+((m+m/8) %% 2)"
        if %m%==3 set /a "d=d-2+!(y%%4)-!(y%%100)+!(y%%400)"
    )
    set "d=0%d%" & set "m=0%m%"
    endlocal & set "%~1=%y%-%m:~-2%-%d:~-2%" & exit /b

:getTodayDate ret
    setlocal enableextensions disabledelayedexpansion
    set "today=" & for /f %%a in ('robocopy "|" . /njh') do if not defined today set "today=%%a"
    endlocal & set "%~1=%today%" & exit /b