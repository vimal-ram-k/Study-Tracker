@echo off
cd /d "C:\path\to\your\repo"

:: Get date and time in YYYY-MM-DD HH:MM:SS format via PowerShell
for /f "tokens=*" %%i in ('powershell -Command "Get-Date -Format \"yyyy-MM-dd HH:mm:ss\""') do set TIMESTAMP=%%i

git add .
git commit -m "%TIMESTAMP%"

echo.
echo Commit finished! Press any key to exit.
pause