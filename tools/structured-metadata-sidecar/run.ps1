param(
  [string]$Host = "127.0.0.1",
  [int]$Port = 8011
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not (Test-Path ".venv")) {
  python -m venv .venv
}

& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt | Out-Host
& ".\.venv\Scripts\python.exe" -m uvicorn app:app --host $Host --port $Port
