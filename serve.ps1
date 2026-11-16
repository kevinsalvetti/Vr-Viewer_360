# Piccolo server statico per il visualizzatore (nessuna dipendenza, solo PowerShell).
# Uso:  powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8080] [-Apri]
param(
  [int]$Port = 8080,
  [switch]$Apri
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'; '.json' = 'application/json'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'; '.avif' = 'image/avif'; '.bmp' = 'image/bmp'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() } catch {
  Write-Host "Impossibile avviare il server sulla porta $Port : $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
Write-Host "Visualizzatore 360 attivo su http://localhost:$Port/  (Ctrl+C per fermare)" -ForegroundColor Green
if ($Apri) { Start-Process "http://localhost:$Port/" }

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      if ($rel -eq '') { $rel = 'index.html' }
      $path = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
      if (-not $path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $res.StatusCode = 404
      } else {
        $ext = [System.IO.Path]::GetExtension($path).ToLower()
        $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $res.Headers.Add('Cache-Control', 'no-cache')
        $bytes = [System.IO.File]::ReadAllBytes($path)
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    } catch { $res.StatusCode = 500 }
    finally { $res.Close() }
  }
} finally { $listener.Stop() }
