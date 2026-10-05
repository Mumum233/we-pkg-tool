@echo off
rem ===========================================================
rem  Wallpaper Engine pkg/tex extractor - drag and drop entry.
rem
rem  Drag a .pkg / .tex file, or a folder, onto this file.
rem  Everything lands in the "output" folder next to this file.
rem
rem  Hard-won constraints, do not "simplify" these away:
rem   1. ASCII only. A UTF-8 .bat containing Chinese is mis-read
rem      by cmd.exe and the script breaks before it even starts.
rem   2. Every node call uses CALL. `node` may resolve to a .cmd
rem      shim, and running a .cmd from a .bat without CALL
rem      transfers control and never returns.
rem   3. No enabledelayedexpansion. It makes cmd eat '!' in paths.
rem   4. %~f1 does NOT strip a trailing backslash, and Explorer
rem      appends one when you drop a FOLDER. A trailing backslash
rem      would escape the closing quote of the node command, so it
rem      is stripped by hand below.
rem   5. Invoked with no argument it looks for a .pkg/.tex sitting
rem      next to itself, so "double-click and follow the prompt"
rem      works as well as dragging.
rem ===========================================================

if not "%~1"=="" goto HAVEARGS

rem --- no argument: look for a package next to this file ---------
setlocal
set "SELF=%~dp0"
set "FOUND="
for %%F in ("%SELF%*.pkg") do if not defined FOUND set "FOUND=%%~fF"
for %%F in ("%SELF%*.tex") do if not defined FOUND set "FOUND=%%~fF"

if not defined FOUND (
  echo.
  echo   Drag a .pkg or .tex file onto this file.
  echo   Or put one in this folder and run this file again.
  echo.
  pause
  exit /b 0
)

echo.
echo   Found: %FOUND%
echo.
call "%~f0" "%FOUND%"
exit /b %errorlevel%

:HAVEARGS
where node >nul 2>nul
if errorlevel 1 goto NONODE

setlocal
set "HERE=%~dp0"
set "OUTROOT=%HERE%output"
set /a N=0

:LOOP
if "%~1"=="" goto DONE

set "ARG=%~f1"
if "%ARG:~-1%"=="\" set "ARG=%ARG:~0,-1%"

rem Derive the bare name from ARG rather than %~n1, which is empty
rem when the original argument ended in a backslash.
for %%I in ("%ARG%") do set "NAME=%%~nI"
set "EXT=%~x1"
set /a N+=1

echo.
echo ==========================================================
echo   [%N%] %ARG%
echo ==========================================================

if exist "%ARG%\" goto ISDIR
if /i "%EXT%"==".tex" goto ISTEX
if /i "%EXT%"==".pkg" goto ISPKG
echo   [skip] unsupported file type
goto NEXT

rem ---------------------------------------------------------------
rem Folder: unpack every package, then pull the images out of
rem every texture, so a single drop produces finished pictures.
rem ---------------------------------------------------------------
:ISDIR
set "DST=%OUTROOT%\%NAME%"
echo   [folder] unpacking every .pkg inside ...
call node "%HERE%pkg.mjs" "%ARG%" --extract "%DST%"
echo.
echo   [folder] extracting images ...
call node "%HERE%tex.mjs" "%DST%" --out "%DST%_images"

if exist "%DST%_images" (
  echo.
  echo   Images are in: %DST%_images\
  if exist "%DST%_images\*.png" explorer "%DST%_images%"
) else (
  echo.
  echo   No images found in this folder.
)
goto NEXT

:ISTEX
set "DST=%OUTROOT%\%NAME%"
call node "%HERE%tex.mjs" "%ARG%" --out "%DST%"
echo.
echo   Images are in: %DST%\
if exist "%DST%\*.png" explorer "%DST%"
if exist "%DST%\*.jpg" explorer "%DST%"
goto NEXT

rem ---------------------------------------------------------------
rem Package: unpack, then immediately pull the images out of the
rem textures that came out. One drop, pictures at the end.
rem ---------------------------------------------------------------
:ISPKG
set "DST=%OUTROOT%\%NAME%"
echo   [pkg] unpacking ...
echo.
call node "%HERE%pkg.mjs" "%ARG%" --extract "%DST%"
echo.
echo   [pkg] extracting images from the textures ...
echo.
call node "%HERE%tex.mjs" "%DST%" --out "%DST%_images"
echo.
if exist "%DST%_images" (
  echo   Done. Images are in:
  echo     %DST%_images\
  echo.
  echo   The folder will open for you now.
  explorer "%DST%_images%"
) else (
  echo   Unpacked to: %DST%\
  echo   No images found inside - this package may hold only scripts
  echo   and effects, not a wallpaper picture.
)
goto NEXT

:NEXT
shift
goto LOOP

:DONE
echo.
echo ==========================================================
echo   All done.
echo   Results: %OUTROOT%\
echo ==========================================================
echo.
pause
exit /b 0

:NONODE
echo.
echo   [ERROR] Node.js not found.
echo.
echo   This tool needs Node.js. Install it from:
echo       https://nodejs.org/
echo   then run this file again.
echo.
pause
exit /b 1
