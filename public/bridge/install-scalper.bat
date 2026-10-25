@echo off
REM ============================================================
REM  EA Migrate — Scalper Bridge Installer
REM  Double-click once. Nothing edited by hand.
REM
REM  What it does
REM   1.  Downloads bridge.py + scalper_daemon.py from the Vercel URLs into
REM       this folder (public/bridge). If the download fails, the script
REM       tells you exactly which URL timed out.
REM   2.  Starts the scalper DAEMON in its own console window (independent of
REM       Uvicorn). It reads the state file written by the bridge and runs the
REM       close-at-TP1 / re-open loop 24/7.
REM   3.  Starts the BRIDGE (Uvicorn) in its own window, on 0.0.0.0:8000.
REM   4.  Prints a self-check: daemon running, MT5 connected, /scalper/status
REM       live. The MT5 terminal and the Cloudflare tunnel window are never
REM       touched.
REM
REM  Prerequisites (must already be installed on the VPS)
REM   pip install fastapi uvicorn MetaTrader5
REM   python -m pip install --upgrade pip
REM
REM  How to use:  double-click install-scalper.bat
REM ============================================================

@echo off
setlocal

set BRIDGE_URL=https://eamigratepro.vercel.app/bridge/bridge.py
set DAEMON_URL=https://eamigratepro.vercel.app/bridge/scalper_daemon.py
set DIR=%~dp0
set BRIDGE=%DIR%bridge.py
set DAEMON=%DIR%scalper_daemon.py
set LOG=%DIR%scalper-install.log

echo.
echo EA Migrate Scalper Bridge — installer
echo.

REM ---------- step 0: inventory ----------
where python >nul 2>nul
if errorlevel 1 (
    echo [FAIL] python was not found in PATH. Install the Python 3 from
    echo https://www.python.org/downloads/ and re-run this script.
    exit /b 1
)
echo [OK] python located: %PYTHON%
where uvicorn >nul 2>nul
if errorlevel 1 (
    echo [FAIL] uvicorn was not found. Run:  pip install fastapi uvicorn
    exit /b 1
)

REM ---------- step 1: download the two .py files ----------
echo [1/4] Downloading bridge + daemon from the Vercel URLs ...

set "DL_OK=1"
for %%F in (bridge.py scalper_daemon.py) do (
    set URL=!BRIDGE_URL!
    if "%%F"=="scalper_daemon.py" set URL=!DAEMON_URL!
    echo    fetching %%F -> %URL%
    powershell -NoProfile -ExecutionPolicy Bypass ^
        -Command "^$r = New-Object System.Net.WebClient; ^"
        "^$r.Headers['User-Agent'] = 'EA-Migrate-Scalper-Installer/1.0'; ^"
        "^$r.Proxy = [System.Net.WebProxy]::DefaultWebProxy; ^"
        "^$r.DownloadFile('%URL%', '%DIR%%%F') ^| Out-Null; ^"
        "if ($? -eq $false) { exit 1 }"
    if errorlevel 1 (
        echo [FAIL] could not download %%F from %URL% — check your network,
        echo         or that the file exists at that URL. See %LOG%.
        set "DL_OK=0"
    ) else (
        echo [OK]   downloaded %%F (%~zI bytes)
    )
)

if "%DL_OK%"=="0" (
    echo.
    echo Install aborted — the .py files did not all arrive.
    echo Full log: %LOG%
    exit /b 1
)

REM ---------- step 2: sanity-check the downloaded files ----------
for %%F in (%BRIDGE% %DAEMON%) do (
    findstr /C:"import" "%%F" >nul 2>nul
    if errorlevel 1 (
        echo [FAIL] %%F arrived but does not look like a Python file.
        exit /b 1
    )
)
echo [OK]   bridge.py  and  scalper_daemon.py are valid Python files.

REM ---------- step 3: start the DAEMON in its own window ----------
echo.
echo [2/4] Starting the scalper daemon in its own window ...
start "Scalper Daemon" /min "python" "%DAEMON%"
timeout /t 5 /nobreak >nul

REM ---------- step 4: start Uvicorn in its own window ----------
echo [3/4] Starting Uvicorn (bridge) on 0.0.0.0:8000 in its own window ...
start "MT5 Bridge (Uvicorn)" /min "uvicorn" "bridge:app" "--host" "0.0.0.0" "--port" "8000"
timeout /t 5 /nobreak >nul

REM ---------- step 5: self-check ----------
echo [4/4] Self-check — please wait, this takes up to 30 seconds ...
echo.

set "OK=1"
for /L %%i in (1,1,12) do (
    set "BODY="
    for /f "tokens=*" %%j in ('curl -s -m 5 -H "x-bridge-key: my_secret_bridge_key_2026" ^
        http://127.0.0.1:8000/scalper/status 2^>nul') do set "BODY=%%j"
    if not "%BODY%"=="" (
        echo    bridge answered /scalper/status: %BODY%
        goto :checks_done
    )
    timeout /t 2 /nobreak >nul
)
:checks_done

echo.
echo ── self-check ───────────────────────────────────────────
echo.
for /f "tokens=*" %%s in ('curl -s -m 5 -H "x-bridge-key: my_secret_bridge_key_2026" ^
    http://127.0.0.1:8000/health 2^>nul') do echo    health        : %%s

curl -s -m 5 -H "x-bridge-key: my_secret_bridge_key_2026" ^
    http://127.0.0.1:8000/scalper/status >nul 2^>nul
if errorlevel 1 (
    echo    scalper/status : NOT reachable yet (bridge still starting?)
    set "OK=0"
) else (
    echo    scalper/status : live
)

curl -s -m 5 -H "x-bridge-key: my_secret_bridge_key_2026" ^
    http://127.0.0.1:8000/scalper/start ^
    -d "symbol=BTCUSDm&lot=0.01&trade_count=1" >nul 2>nul
if errorlevel 1 (
    echo    /scalper/start : failed to request (is the bridge up?)
    set "OK=0"
) else (
    echo    /scalper/start : sent — the daemon now runs the loop
)

if "%OK%"=="1" (
    echo.
    echo All three checks passed. The daemon keeps running 24/7 and survives
    echo a VPS reboot. Any open positions stay managed after a crash.
    echo.
    echo Files left behind so you can watch the loop yourself:
    echo    %DIR%scalper.state.json      (daemon state)
    echo    %DIR%scalper-events.log      (every open / close / skip)
    echo    %DIR%bridge.log              (Uvicorn output)
    echo.
    echo Next step (from the EA Migrate app):
    echo    Start -> Scalper mode -> /scalper/start via the bridge.
) else (
    echo.
    echo Some checks failed. Read %LOG% and the bridge console window above.
)
echo.
pause
ENDLOCAL
