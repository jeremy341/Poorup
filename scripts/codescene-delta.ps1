[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$OutputPath = "qa-artifacts/codescene/delta.json"
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedOutput = [IO.Path]::GetFullPath((Join-Path $repoRoot $OutputPath))
$artifactRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot "qa-artifacts"))

if (-not $env:CS_ACCESS_TOKEN) {
  throw "CS_ACCESS_TOKEN is required; no CodeScene command was run."
}

if (-not $resolvedOutput.StartsWith($artifactRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "OutputPath must stay inside qa-artifacts/ (an ignored review artifact)."
}

& git -C $repoRoot rev-parse --verify origin/main *> $null
if ($LASTEXITCODE -ne 0) {
  throw "origin/main is not available; fetch the merge base before running CodeScene."
}

$parent = Split-Path -Parent $resolvedOutput
New-Item -ItemType Directory -Force -Path $parent | Out-Null

$env:CS_DISABLE_VERSION_CHECK = "1"
$output = & cs delta origin/main --include-metadata --output-format json --pretty 2>&1
$exitCode = $LASTEXITCODE
$output | Out-File -LiteralPath $resolvedOutput -Encoding utf8

if ($exitCode -ne 0) {
  throw "CodeScene delta failed (exit $exitCode). See the ignored artifact at $OutputPath."
}

Write-Output "CodeScene delta written to $OutputPath"
