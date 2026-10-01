param(
  [switch]$Quiet
)

$ErrorActionPreference = 'SilentlyContinue'
$root = (Get-Location).Path
$files = Get-ChildItem -Recurse -Path "$root\server", "$root\public" -Filter *.js |
  Where-Object { $_.FullName -notmatch '\\vendor\\|\\server\\data\\' }

$results = $files | ForEach-Object -Parallel {
  $out = & cs review $_.FullName --output-format json 2>$null
  if ($LASTEXITCODE -eq 0 -and $out) {
    try {
      $j = $out | ConvertFrom-Json
      if ($null -ne $j.score) {
        [pscustomobject]@{
          rel     = $_.FullName.Replace("$using:root\", '')
          isTest  = ($_.Name -like '*.test.js')
          score   = [double]$j.score
          loc     = (Get-Content $_.FullName | Measure-Object -Line).Lines
        }
      }
    } catch {}
  }
} -ThrottleLimit 8

$results = @($results)
$source = @($results | Where-Object { -not $_.isTest })
$tests  = @($results | Where-Object { $_.isTest })

$mean = { param($s) if ($s.Count -eq 0) { 0 } else { [math]::Round(($s | Measure-Object -Property score -Average).Average, 3) } }

Write-Output "================ CODESCENE SCAN ================"
Write-Output ("files scored      : {0}  (source {1}, tests {2})" -f $results.Count, $source.Count, $tests.Count)
Write-Output ("mean source       : {0}" -f (& $mean $source))
Write-Output ("mean tests        : {0}" -f (& $mean $tests))
Write-Output ("source at 10.0    : {0}" -f @($source | Where-Object { $_.score -ge 10 }).Count)
Write-Output ("source < 9.0      : {0}" -f @($source | Where-Object { $_.score -lt 9 }).Count)
Write-Output ("source < 6.0      : {0}" -f @($source | Where-Object { $_.score -lt 6 }).Count)
Write-Output ("source < 4.0      : {0}" -f @($source | Where-Object { $_.score -lt 4 }).Count)

Write-Output ""
Write-Output "--- worst 20 source files ---"
$source | Sort-Object score, rel | Select-Object -First 20 |
  ForEach-Object { "{0,6:N2}  {1,5} LOC  {2}" -f $_.score, $_.loc, $_.rel }

if (-not $Quiet) {
  $top = $source | Sort-Object score | Select-Object -First 1
  if ($top) {
    Write-Output ""
    Write-Output ("--- worst file detail: {0} ---" -f $top.rel)
    cs review $top.rel 2>$null |
      Where-Object { $_ -match '^\s*\[!\]|^\s*Issue:|at line \d+ \(|Nesting depth|Arguments =|bumps =|Overall Code Health score' } |
      ForEach-Object { $_.TrimEnd() } | Select-Object -First 25
  }
}
Write-Output "==============================================="
