@echo off
rem Souspli on the command line, for Windows.
rem
rem souspli.exe is a GUI program, so on its own its output never reaches this
rem console. This runs the command line under ELECTRON_RUN_AS_NODE, where
rem Electron attaches the console (cli-entry.ts). With no command it exits 100,
rem meaning "open the app", and the app is started with the same arguments.
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0souspli.exe" "%~dp0resources\app.asar\out\main\shell\cli.js" %*
set "SOUSPLI_CODE=%ERRORLEVEL%"
if not "%SOUSPLI_CODE%"=="100" exit /b %SOUSPLI_CODE%
endlocal
start "" "%~dp0souspli.exe" %*
