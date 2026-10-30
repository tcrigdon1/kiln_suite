@echo off
rem Kiln Suite - creates Gesso and Cutline shortcuts on the Desktop (add  -StartMenu  for the Start menu too).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Create Desktop Shortcuts.ps1" %*
pause
