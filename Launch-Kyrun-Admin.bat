@echo off
REM Same as double-clicking Launch-Kyrun-Admin.vbs: UAC, then Kyrun as Administrator.
cd /d "%~dp0"
wscript.exe //nologo "%~dp0Launch-Kyrun-Admin.vbs"
