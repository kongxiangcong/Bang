@echo off
setlocal DisableDelayedExpansion
set "NODE_OPTIONS="
"%~dp0node\node.exe" "%~dp0release\bang.mjs" %*
