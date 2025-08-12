#!/usr/bin/env pwsh

# PowerShell script to start IB server with standard client ID
Write-Host "🚀 Starting IB server with standard client ID..."

$env:USE_RANDOM_CLIENT_ID = "false"
py src/ib/ib_server.py