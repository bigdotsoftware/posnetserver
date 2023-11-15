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

REM get device ID (request compatible with version >= 4.4; when using older version, comment below request and set DEVICEID manually in this script)
REM curl -s -XGET "%POSNETSERVERHOST%/deviceid?fulldebug=%FULLDEBUG%" -H "Content-type: application/json" > %OUTPUT_DIRECTORY%/result.json
for /f %%i in ('%JQ% -r ".ok" %OUTPUT_DIRECTORY%/result.json') do set ok=%%i
echo  ok: %ok%

if "%ok%"=="true" (
    for /f %%i in ('%JQ% -r ".device.id" %OUTPUT_DIRECTORY%/result.json') do set DEVICEID=%%i
	echo  DEVICEID: %DEVICEID%
) else (
    echo "Error: Cannot read unique device ID. Your device is not connected or is not an ONLINE device"
    GOTO :EOF
)



GOTO :EOF

# --- check if cache exists
result=`curl -s -XGET "$POSNETSERVERHOST/cache/ranges?fulldebug=$FULLDEBUG" -H "Content-type: application/json"`
ok=`echo $result|jq -r '.ok'`

if [ "$ok" == "true" ]; then
    # --- check if existing cache type match to requested type
    cache_type=`echo $result|jq -r '.cache.type'`
    cache_dateFrom=`echo $result|jq -r '.cache.dateFrom'`
    iso_dateFrom=`date -d @$cache_dateFrom '+%Y-%m-%d'`
    if [ "$cache_type" == "$CACHE_TYPE" ]; then
        # --- cache exists, expand it
        echo "Expanding cache from $iso_dateFrom"
        result=`curl -s -XPOST "$POSNETSERVERHOST/cache/update?fulldebug=$FULLDEBUG" -H "Content-type: application/json" -d "
        {
            \"dateFrom\":\"${iso_dateFrom}T00:00:00+02:00\",
            \"dateTo\":\"${TODAY}T23:59:59+02:00\"
        }"`
        ok=`echo $result|jq -r '.ok'`
        
        echo $result
    else
        echo "Error: Cannot extend cache, cache types are different"
        exit 1
    fi
else
    # --- cache doesn't exist, build it
    # --- build cache from yesterday till today
    echo "Building cache from $YESTERDAY"
    result=`curl -s -XPOST "$POSNETSERVERHOST/cache/build?fulldebug=$FULLDEBUG" -H "Content-type: application/json" -d "
    {
       \"dateFrom\":\"${YESTERDAY}T00:00:00+02:00\",
       \"dateTo\":\"${TODAY}T23:59:59+02:00\",
       \"cacheType\" : \"$CACHE_TYPE\"
    }"`
    ok=`echo $result|jq -r '.ok'`
    echo $result
fi

# --- when build/update succeeded, wait for task to be finished
if [ "$ok" == "true" ]; then

    task=`echo $result|jq -r '.task'`
    processing="true"
    while [ "$processing" == "true" ]; do
        sleep 1
        echo "Checking task $task"
        result=`curl -s -XGET "$POSNETSERVERHOST/tasks/get/$task?fulldebug=$FULLDEBUG" -H "Content-type: application/json"`
        processing=`echo $result|jq -r '.hits.task.inprogress'`
        echo $result
    done

else

    echo "Error: Cannot build/update existing cache"
    echo $result
    exit 1
fi

# --- use existing cache to list all daily reports
mkdir -p $OUTPUT_DIRECTORY/$PRETTY_HOSTNAME/posnet/ 2>/dev/null

curl -s -XPOST "$POSNETSERVERHOST/raporty/events/dobowy?fulldebug=$FULLDEBUG" -H "Content-type: application/json" -d "
{
  \"dateFrom\": \"${REPORT_FROM}T00:00:00+02:00\",
  \"mergeSections\": true,
  \"useCache\": true
}" > $OUTPUT_DIRECTORY/$PRETTY_HOSTNAME/posnet/$DEVICEID.json

echo "DONE, results: $OUTPUT_DIRECTORY/$PRETTY_HOSTNAME/posnet/$DEVICEID.json"

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