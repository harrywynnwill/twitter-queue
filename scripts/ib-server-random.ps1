#!/usr/bin/env pwsh

# PowerShell script to start IB server with random client ID
Write-Host "🎲 Starting IB server with random client ID..."

$env:USE_RANDOM_CLIENT_ID = "true"
py src/ib/ib_server.py