[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
if (-not $root) {
    $root = Split-Path -Parent $MyInvocation.MyCommand.Path
}

$port = 8765
$listener = $null

for ($tryPort = 8765; $tryPort -le 8775; $tryPort++) {
    try {
        $candidate = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $tryPort)
        $candidate.Start()
        $listener = $candidate
        $port = $tryPort
        break
    } catch {
        continue
    }
}

if (-not $listener) {
    Write-Host "[Error] Available loopback port not found (8765-8775)." -ForegroundColor Red
    exit 1
}

$url = "http://127.0.0.1:$port/index.html"
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host " Golf Swing Afterimage Studio Server Running" -ForegroundColor Green
Write-Host " URL: $url" -ForegroundColor Yellow
Write-Host " (Press Ctrl+C to stop the server)" -ForegroundColor Gray
Write-Host "================================================================" -ForegroundColor Cyan

Start-Process $url

$mimeMap = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.mjs'  = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
}

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
            $requestLine = $reader.ReadLine()

            if ($requestLine) {
                $parts = $requestLine.Split(' ')
                $rawTarget = if ($parts.Length -ge 2) { $parts[1].Split('?')[0] } else { '/index.html' }
                $relPath = [System.Uri]::UnescapeDataString($rawTarget)
                if ($relPath -eq '/' -or [string]::IsNullOrWhiteSpace($relPath)) {
                    $relPath = '/index.html'
                }

                $safeRel = $relPath.TrimStart('/').Replace('/', '\')
                $filePath = Join-Path $root $safeRel

                if (Test-Path -LiteralPath $filePath -PathType Leaf) {
                    $bytes = [System.IO.File]::ReadAllBytes($filePath)
                    $ext = [System.IO.Path]::GetExtension($filePath).ToLowerInvariant()
                    $ctype = if ($mimeMap.ContainsKey($ext)) { $mimeMap[$ext] } else { 'application/octet-stream' }

                    $header = "HTTP/1.1 200 OK`r`nContent-Type: $ctype`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
                    $hBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
                    $stream.Write($hBytes, 0, $hBytes.Length)
                    $stream.Write($bytes, 0, $bytes.Length)
                } else {
                    $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $relPath")
                    $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($msg.Length)`r`nConnection: close`r`n`r`n"
                    $hBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
                    $stream.Write($hBytes, 0, $hBytes.Length)
                    $stream.Write($msg, 0, $msg.Length)
                }
            }
        } catch {
            # Ignore client socket reset
        } finally {
            if ($stream) { $stream.Dispose() }
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
