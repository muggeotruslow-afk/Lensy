@echo off
cd /d "%~dp0"
start "OCR Translator" "" "node_modules\electron\dist\electron.exe" .
exit
