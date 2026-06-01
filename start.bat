@echo off
cd /d "%~dp0"
start "Lensy" "" "node_modules\electron\dist\electron.exe" .
exit
