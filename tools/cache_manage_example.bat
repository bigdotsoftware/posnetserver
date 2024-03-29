@echo off
REM setlocal enableextensions
REM SETLOCAL EnableDelayedExpansion

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
call :getPrevMonthDate prevmonthdate
SET CACHEFROM=%prevmonthdate%
REM assume format Fri 11/17/2023
SET TODAY=%DATE:~10,4%-%DATE:~4,2%-%DATE:~7,2%
IF "%TODAY:~0,1%"=="-" (
    REM then format can be YYYY-MM-DD
    SET TODAY=%DATE:~0,4%-%DATE:~5,2%-%DATE:~8,2%
)
SET REPORT_FROM=2020-01-01T00:00:00
SET FULLDEBUG=true
SET CACHE_TYPE=full
SET OUTPUT_DIRECTORY=C:\tmp
SET REPORT_DIRECTORY=C:\tmp
SET PRETTY_HOSTNAME=%COMPUTERNAME%
SET DEVICEID=
SET JQ=jq-windows-amd64.exe

SET EMAIL_SEND=true
SET EMAIL_PASS=aaaaaa
SET EMAIL_FROM=sample@sample.com
SET EMAIL_TO=sample@sample.com
SET EMAIL_HOST=mail.sample.com
SET EMAIL_PORT=587

echo   CACHEFROM: %CACHEFROM%
echo   TODAY: %TODAY%

REM ###################### Block to get DEVICEID from PosnetServer ###########################
REM # get device ID (request compatible with version >= 4.4; when using older version, comment below request and set DEVICEID manually in this script)
REM 
REM curl -s -XGET "%POSNETSERVERHOST%/deviceid?fulldebug=%FULLDEBUG%" -H "Content-type: application/json" > %OUTPUT_DIRECTORY%\\result.json
REM if %ERRORLEVEL% GEQ 1 GOTO command_error
REM more %OUTPUT_DIRECTORY%\\result.json
REM 
REM call :getJSONValue ok ".ok"
REM echo   /deviceid ok: %ok%
REM 
REM IF NOT "%ok%"=="true" (
REM     call :exit_with_action "Cannot read unique device ID. Your device is not connected or is not an ONLINE device"
REM     GOTO :EOF
REM )
REM 
REM for /f %%i in ('%JQ% -r ".device.nu|.=gsub("" "";""_"")" %OUTPUT_DIRECTORY%\result.json') do set DEVICEID=%%i
REM echo   DEVICEID: %DEVICEID%
REM 
REM ################## End of block to get DEVICEID from PosnetServer #######################

IF "%DEVICEID%"=="" (
    echo "set DEVICEID variable manually or uncomment above block (PosnetServer version must be >=4.4)"
    GOTO :EOF
)

echo ""
echo ""
REM ---------------------------------------------------------------------------------
REM --- check if cache exists
REM ---------------------------------------------------------------------------------
curl -s -XGET "%POSNETSERVERHOST%/cache/ranges?fulldebug=%FULLDEBUG%" -H "Content-type: application/json" > %OUTPUT_DIRECTORY%\\result.json
if %ERRORLEVEL% GEQ 1 GOTO command_error
more %OUTPUT_DIRECTORY%\\result.json

call :getJSONValue ok ".ok"
echo   /cache/ranges ok: %ok%

IF NOT "%ok%"=="true" (
    call :exit_with_action "Cannot read cache ranges"
    GOTO :EOF
)

call :getJSONValue cachetype ".cache.type"
echo   cachetype: %cachetype%

call :getJSONValue dateFrom ".cache.dateFrom"
echo   dateFrom: %dateFrom%

call :getJSONValue dateTo ".cache.dateTo"
echo   dateTo: %dateTo%


REM if dateFrom is 0 then we must build a new cache
if "%dateFrom%"=="0" GOTO build_cache_start
REM else we update existing cache
goto update_cache_start

:build_cache_start
    REM --- cache doesn't exist, build it
    REM --- build cache from CACHEFROM till today
    echo   Building cache from %CACHEFROM%
    curl -s -XPOST "%POSNETSERVERHOST%/cache/build?fulldebug=%FULLDEBUG%" -H "Content-type: application/json" -d "{""dateFrom"":""%CACHEFROM%T00:00:00+02:00"",""dateTo"":""%TODAY%T23:59:59+02:00"",""cacheType"" : ""%CACHE_TYPE%""}" > %OUTPUT_DIRECTORY%\\result.json
    more %OUTPUT_DIRECTORY%\\result.json

    REM for /f %%i in ('%JQ% -r ".ok" %OUTPUT_DIRECTORY%\\result.json') do set ok=%%i
    call :getJSONValue ok ".ok"
    echo   /cache/build ok: %ok%
    goto wait_for_cache_to_be_build

:update_cache_start
    echo   Converting %dateFrom% to ISO format ....
    for /f %%i in ('%JQ% -r ".cache.dateFrom | tonumber | strflocaltime(""%%Y-%%m-%%d"")" %OUTPUT_DIRECTORY%\result.json') do set iso_dateFrom=%%i
    echo   iso_dateFrom: %iso_dateFrom%

    IF "%iso_dateFrom%"=="" (
        call :exit_with_action "Cannot read ISO_DATE from /cache/ranges"
        GOTO :EOF
    )

    if NOT "%cachetype%"=="%CACHE_TYPE%" (
        echo   Error: Cannot extend cache, cache types are different %CACHE_TYPE% != %cachetype%
        more %OUTPUT_DIRECTORY%\\result.json
        call :exit_with_action "Cannot extend cache, cache types are different %CACHE_TYPE% != %cachetype%"
        GOTO :EOF
    )

    REM --- cache exists, expand it
    echo   Expanding cache from %iso_dateFrom%
    curl -s -XPOST "%POSNETSERVERHOST%/cache/update?fulldebug=%FULLDEBUG%" -H "Content-type: application/json" -d "{""dateFrom"":""%iso_dateFrom%T00:00:00+02:00"", ""dateTo"":""%TODAY%T23:59:59+02:00""}" > %OUTPUT_DIRECTORY%\\result.json
    more %OUTPUT_DIRECTORY%\\result.json
    call :getJSONValue ok ".ok"
    echo   /cache/update ok: %ok%

REM ---------------------------------------------------------------------------------
REM wait_for_cache_to_be_build
REM ---------------------------------------------------------------------------------
:wait_for_cache_to_be_build
    echo   Waiting for cache to be built/updated...
    REM --- when build/update succeeded, wait for task to be finished
    if NOT "%ok%"=="true" (
        call :exit_with_action "Cannot build/update existing cache"
        GOTO :EOF
    )

    call :getJSONValue task ".task"
    REM for /f %%i in ('%JQ% -r ".task" %OUTPUT_DIRECTORY%\result.json') do set task=%%i

    IF "%task%"=="" (
        echo  Error, cannot read task ID
        more %OUTPUT_DIRECTORY%\\result.json
        call :exit_with_action "cannot read task ID"
        GOTO :EOF
    )

SET processing=true
:still_processing
    timeout /t 1 /nobreak >nul
    echo   Checking task %task%
    curl -s -XGET "%POSNETSERVERHOST%/tasks/get/%task%?fulldebug=%FULLDEBUG%" -H "Content-type: application/json" > %OUTPUT_DIRECTORY%\\result.json
    more %OUTPUT_DIRECTORY%\\result.json
    REM for /f %%i in ('%JQ% -r ".hits.task.inprogress" %OUTPUT_DIRECTORY%\result.json') do set processing=%%i
    call :getJSONValue processing ".hits.task.inprogress"
    if "%processing%"=="true" goto :still_processing


:task_cache_is_finished
    call :getJSONValue success ".hits.task.success"
    echo   /cache/build or /cache/update success: %success%
    if NOT "%success%"=="true" (
        call :exit_with_action "Cache cannot be build, interrupting"
        GOTO :EOF
    )


:request_for_report_with_cache
    echo ""
    echo ""
    REM --- use existing cache to list all daily reports
    

    REM --- make sure that REPORT_FROM>=cache dateFrom
    curl -s -XGET "%POSNETSERVERHOST%/cache/ranges?fulldebug=%FULLDEBUG%" -H "Content-type: application/json" > %OUTPUT_DIRECTORY%\\result.json
    more %OUTPUT_DIRECTORY%\\result.json
    call :getJSONValue ok ".ok"
    echo   /cache/ranges ok: %ok%

    IF NOT "%ok%"=="true" (
        call :exit_with_action "Cannot read cache ranges. It is needed to validate that %REPORT_FROM% >= cache %REPORT_FROM%"
        GOTO :EOF
    )

    call :getJSONValue dateFrom ".cache.dateFrom"
    call :convertToTimestamp reportFromTs %REPORT_FROM%
    echo   reportFromTs: %reportFromTs%
    echo   dateFrom: %dateFrom%
    echo   reportFromTs: %reportFromTs% must be gte %dateFrom%
    if %reportFromTs% GEQ %dateFrom% goto request_for_report_with_cache_dates_ok

    for /f %%i in ('%JQ% -r ".cache.dateFrom | tonumber | strflocaltime(""%%Y-%%m-%%dT%%H:%%M:%%S"")" %OUTPUT_DIRECTORY%\result.json') do set iso_dateFromWithTime=%%i
    echo   iso_dateFromWithTime: %iso_dateFromWithTime%

    echo   adjusting %REPORT_FROM% to %iso_dateFromWithTime%
    set REPORT_FROM=%iso_dateFromWithTime%
    echo   new REPORT_FROM: %REPORT_FROM%

:request_for_report_with_cache_dates_ok
    echo   requesting /raporty/events/dobowy from %REPORT_FROM%+00:00
    curl -s -XPOST "%POSNETSERVERHOST%/raporty/events/dobowy?fulldebug=%FULLDEBUG%" -H "Content-type: application/json" -d "{""dateFrom"": ""%REPORT_FROM%+00:00"", ""mergeSections"": true, ""useCache"": true }" > %OUTPUT_DIRECTORY%\\result.json
    more %OUTPUT_DIRECTORY%\\result.json
    call :getJSONValue ok ".ok"
    echo   /raporty/events/dobowy ok: %ok%
    if NOT "%ok%"=="true" (
        call :exit_with_action "Cannot request /raporty/events/dobowy from %REPORT_FROM%+00:00"
        GOTO :EOF
    )

    call :getJSONValue task ".task"
    REM for /f %%i in ('%JQ% -r ".task" %OUTPUT_DIRECTORY%\result.json') do set task=%%i

    IF "%task%"=="" (
        echo "Error, cannot read task ID"
        more %OUTPUT_DIRECTORY%\\result.json
        call :exit_with_action "cannot read task ID"
        GOTO :EOF
    )


SET processing=true
:still_processing_final
    timeout /t 1 /nobreak >nul
    echo "Checking task %task%"
    curl -s -XGET "%POSNETSERVERHOST%/tasks/get/%task%?fulldebug=%FULLDEBUG%" -H "Content-type: application/json" > %OUTPUT_DIRECTORY%\\result.json
    for /f %%i in ('%JQ% -r ".hits.task.inprogress" %OUTPUT_DIRECTORY%\result.json') do set processing=%%i
    more %OUTPUT_DIRECTORY%\\result.json
    if "%processing%"=="true" goto :still_processing_final


:save_final_report
    call :getJSONValue success ".hits.task.success"
    echo   /raporty/events/dobowy success: %success%
    if NOT "%success%"=="true" (
        call :exit_with_action "Cache cannot be build, see error above, interrupting"
        GOTO :EOF
    )

    mkdir %REPORT_DIRECTORY%\\%PRETTY_HOSTNAME%\\posnet\\
    copy %OUTPUT_DIRECTORY%\\result.json %REPORT_DIRECTORY%\\%PRETTY_HOSTNAME%\\posnet\\%DEVICEID%.json
    echo "DONE, results: %REPORT_DIRECTORY%\\%PRETTY_HOSTNAME%\\posnet\\%DEVICEID%.json"


GOTO :EOF

:command_error
    echo   ERROR - cannot exeute command
    call :exit_with_action "cannot exeute command"
    exit /b

:exit_with_action ret
    echo   ERROR: %~1
    if "%EMAIL_SEND%"=="true" swithmail.exe /s /from "%EMAIL_FROM%" /pass "%EMAIL_PASS%" /server "%EMAIL_HOST%" /p "%EMAIL_PORT%" /to "%EMAIL_TO%" /sub "Fiscal log %computername%" /btxt "%OUTPUT_DIRECTORY%\\result.json"
    exit /b

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

:getPrevMonthDate ret
    setlocal enableextensions disabledelayedexpansion
    call :getTodayDate today
    for /f "tokens=1-3 delims=/ " %%a in ("%today%") do set /a "y=%%a", "m=1%%b-100", "d=1%%c-100"
    if %m% gtr 1 ( set /a "m-=1" ) else ( set /a "m=12" )
    set "m=0%m%"
    endlocal & set "%~1=%y%-%m:~-2%-01" & exit /b

:getTodayDate ret
    setlocal enableextensions disabledelayedexpansion
    set "today=" & for /f %%a in ('robocopy "|" . /njh') do if not defined today set "today=%%a"
    endlocal & set "%~1=%today%" & exit /b

:convertToTimestamp ret
    setlocal enableextensions disabledelayedexpansion
    REM set "todayy=" & for /f %%a in ('%JQ% -n ""{""message"":""%~2T00:00:00Z""}"" "|" %JQ% -r """.message | fromdate"""') do if not defined todayy set "todayy=%%a"
    set "todayy=" & for /f %%a in ('%JQ% -n """%~2Z"" | fromdate"') do if not defined todayy set "todayy=%%a"
    endlocal & set "%~1=%todayy%" & exit /b

:getJSONValue ret
    setlocal enableextensions disabledelayedexpansion
    set "rrrr=" & for /f %%a in ('%JQ% -r %~2 %OUTPUT_DIRECTORY%\result.json') do if not defined rrrr set "rrrr=%%a"
    endlocal & set "%~1=%rrrr%" & exit /b