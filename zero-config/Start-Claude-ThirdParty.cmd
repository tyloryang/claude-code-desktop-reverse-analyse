@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Claude-ThirdParty.ps1"
if errorlevel 1 pause
