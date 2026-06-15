@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Parti
echo ==================================================
echo   Parti 서버 실행
echo ==================================================
echo.

REM 빌드 결과가 없으면(첫 실행) 한 번 빌드합니다.
if exist ".next\BUILD_ID" goto run
echo [준비] 첫 실행이라 빌드를 진행합니다. 잠시만 기다려 주세요...
call npm run build
if errorlevel 1 goto builderror

:run
echo [1/2] 웹 서버를 새 창에서 시작합니다...
start "Parti Web Server (do not close)" cmd /k npm run start

REM ngrok 고정 도메인 읽기 (ngrok-domain.txt 첫 줄)
set "NGROK_DOMAIN="
if exist "ngrok-domain.txt" set /p NGROK_DOMAIN=<"ngrok-domain.txt"
if /i "%NGROK_DOMAIN%"=="PUT-YOUR-DOMAIN-HERE.ngrok-free.app" set "NGROK_DOMAIN="
REM URL 형태로 적어도 동작하도록 scheme/슬래시 제거
set "NGROK_DOMAIN=%NGROK_DOMAIN:https://=%"
set "NGROK_DOMAIN=%NGROK_DOMAIN:http://=%"
if "%NGROK_DOMAIN:~-1%"=="/" set "NGROK_DOMAIN=%NGROK_DOMAIN:~0,-1%"

echo [2/2] ngrok 터널을 새 창에서 시작합니다... (서버 준비를 위해 잠시 대기)
timeout /t 6 /nobreak >nul
if "%NGROK_DOMAIN%"=="" goto randomtunnel
echo  - 고정 도메인: %NGROK_DOMAIN%
start "ngrok tunnel (do not close)" cmd /k ngrok http --domain=%NGROK_DOMAIN% 3000
goto done

:randomtunnel
echo  - 고정 도메인 미설정: 임시 주소로 엽니다. ngrok 창의 Forwarding 줄을 확인하세요.
start "ngrok tunnel (do not close)" cmd /k ngrok http 3000
goto done

:builderror
echo.
echo [오류] 빌드에 실패했습니다. 위 메시지를 확인하거나 개발자에게 문의하세요.
pause
exit /b 1

:done
echo.
echo 완료! 새로 열린 두 창(웹서버 / ngrok)은 사용 중에는 닫지 마세요.
echo  - 내 PC:   http://localhost:3000
echo  - 외부:    ngrok 창의 "Forwarding https://..." 주소
echo  - 종료:    두 창을 모두 닫으면 됩니다.
echo.
pause
