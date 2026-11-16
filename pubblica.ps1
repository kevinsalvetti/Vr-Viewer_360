# Aggiorna l'elenco dei tour (tours/index.json) e pubblica tutto su GitHub Pages.
# Uso:  powershell -ExecutionPolicy Bypass -File pubblica.ps1 [-SoloIndice] [-Messaggio "testo"]
param(
  [switch]$SoloIndice,
  [string]$Messaggio = "Aggiorna tour"
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$tours = Join-Path $root 'tours'
if (-not (Test-Path $tours)) { New-Item -ItemType Directory $tours | Out-Null }

$lista = @()
$avvisi = 0
foreach ($dir in Get-ChildItem -LiteralPath $tours -Directory | Sort-Object Name) {
  $json = Join-Path $dir.FullName 'tour.json'
  if (-not (Test-Path -LiteralPath $json)) { Write-Host "  (salto $($dir.Name): manca tour.json)" -ForegroundColor DarkGray; continue }
  try {
    $testo = [System.IO.File]::ReadAllText($json, [System.Text.Encoding]::UTF8)
    $d = $testo | ConvertFrom-Json
  } catch { Write-Host "  ! $($dir.Name)/tour.json non valido: $($_.Exception.Message)" -ForegroundColor Red; $avvisi++; continue }
  $sc = @($d.scene)
  foreach ($s in $sc) {
    $img = Join-Path $dir.FullName ([string]$s.file)
    if (-not $s.file -or -not (Test-Path -LiteralPath $img)) {
      Write-Host "  ! $($dir.Name): immagine mancante '$($s.file)' (scena '$($s.name)')" -ForegroundColor Yellow; $avvisi++
    } elseif ((Get-Item -LiteralPath $img).Length -gt 95MB) {
      Write-Host "  ! $($dir.Name): '$($s.file)' supera i 95 MB, GitHub rifiuta file oltre 100 MB: riducila (es. JPG qualita' 90)" -ForegroundColor Red; $avvisi++
    }
  }
  $nome = if ($d.nome) { [string]$d.nome } else { $dir.Name }
  $lista += [ordered]@{ cartella = $dir.Name; nome = $nome; scene = $sc.Count }
  Write-Host ("  - {0}  ({1} scene)" -f $nome, $sc.Count)
}

$out = [ordered]@{ tour = @($lista) } | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText((Join-Path $tours 'index.json'), $out, (New-Object System.Text.UTF8Encoding $false))
Write-Host "tours/index.json aggiornato: $($lista.Count) tour" -ForegroundColor Green
if ($SoloIndice) { exit 0 }

Set-Location $root
git add -A
$modifiche = git status --porcelain
if (-not $modifiche) { Write-Host "Nessuna modifica da pubblicare." -ForegroundColor Green; exit 0 }
git commit -m $Messaggio
if ($LASTEXITCODE -ne 0) { Write-Host "Commit non riuscito." -ForegroundColor Red; exit 1 }
git push
if ($LASTEXITCODE -ne 0) { Write-Host "Push non riuscito: controlla la connessione o l'accesso a GitHub." -ForegroundColor Red; exit 1 }
$url = (git remote get-url origin) -replace '^https://github.com/([^/]+)/([^/.]+)(\.git)?$', 'https://$1.github.io/$2/'
Write-Host ""
Write-Host "Pubblicato. Tra 1-2 minuti sara' online su: $url" -ForegroundColor Green
if ($avvisi) { Write-Host "Attenzione: $avvisi avvisi qui sopra." -ForegroundColor Yellow }
