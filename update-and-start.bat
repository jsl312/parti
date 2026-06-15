@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Parti (update)
echo ==================================================
echo   Parti 서버 실행 (업데이트 적용 - 빌드 포함)
echo ==================================================
echo.
echo [빌드] 최신 코드로 빌드 중... 시간이 좀 걸립니다.
call npm run build
if errorlevel 1 goto builderror

REM 빌드 성공 후 일반 실행 스크립트로 서버 + ngrok 시작
call "start-server.bat"
goto end

:builderror
echo.
echo [오류] 빌드에 실패했습니다. 위 메시지를 확인하세요.
pause
exit /b 1

:end
