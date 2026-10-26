@echo off
title OpenDictate
cd /d "%~dp0"
rem venv liegt bewusst unter einem kurzen Pfad (Windows-Pfadlimit bei CUDA/onnx-DLLs)
set VENV=%LOCALAPPDATA%\OpenDictate\venv
set HF_HUB_DISABLE_SYMLINKS_WARNING=1

if exist "%VENV%\Scripts\python.exe" goto run

echo.
echo  OpenDictate - erste Einrichtung
echo  ===============================
echo  Das passiert nur beim ersten Start und dauert ein paar Minuten.
echo.

set PY=
for %%v in (3.14 3.13 3.12 3.11) do (
  if not defined PY (
    py -%%v -c "import sys" >nul 2>&1 && set PY=py -%%v
  )
)
if not defined PY (
  python -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1 && set PY=python
)
if not defined PY (
  echo  Python 3.11 oder neuer wurde nicht gefunden.
  echo  Installiere es von https://www.python.org/downloads/ und setz beim Installieren
  echo  den Haken bei "Add python.exe to PATH". Danach start.bat erneut starten.
  echo.
  pause
  exit /b 1
)

echo  [1/2] Lege Python-Umgebung an ...
%PY% -m venv "%VENV%" || goto fail
echo  [2/2] Installiere Pakete (ca. 1,5 GB, einmalig) ...
"%VENV%\Scripts\python" -m pip install --disable-pip-version-check -q -r requirements.txt || goto fail
echo  Fertig.
echo.

:run
"%VENV%\Scripts\python" app.py
if errorlevel 1 pause
exit /b

:fail
echo.
echo  Die Installation ist fehlgeschlagen. Die Meldung oben sagt, woran es lag.
echo  Zum Neuversuch den Ordner %VENV% loeschen und start.bat erneut starten.
rmdir /s /q "%VENV%" >nul 2>&1
pause
exit /b 1
