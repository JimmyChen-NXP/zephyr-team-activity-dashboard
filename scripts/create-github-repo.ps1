[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$Repo = "zephyr-team-activity-dashboard",

  [Parameter(Mandatory = $false)]
  [string]$Owner = "JimmyChen-NXP",

  [Parameter(Mandatory = $false)]
  [ValidateSet('public', 'private')]
  [string]$Visibility = "public",

  [Parameter(Mandatory = $false)]
  [string]$Description = "Zephyr team activity dashboard (static snapshots for GitHub Pages)"
)

$ErrorActionPreference = 'Stop'

function Get-Token {
  if ($env:GITHUB_TOKEN) { return $env:GITHUB_TOKEN }
  if ($env:GITHUB_PAT) { return $env:GITHUB_PAT }
  throw "Missing token. Set `$env:GITHUB_TOKEN (or `$env:GITHUB_PAT) in your terminal before running this script."
}

$token = Get-Token

$headers = @{
  Authorization = "Bearer $token"
  Accept        = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
}

$user = Invoke-RestMethod -Method Get -Uri "https://api.github.com/user" -Headers $headers
if (-not $user.login) {
  throw "Failed to identify the authenticated GitHub user."
}

if ($Owner -and ($user.login -ne $Owner)) {
  throw "Token is authenticated as '$($user.login)', but -Owner was '$Owner'. Refusing to create repo under the wrong account."
}

$private = $Visibility -eq 'private'

$body = @{ name = $Repo; private = $private; description = $Description } | ConvertTo-Json

try {
  $created = Invoke-RestMethod -Method Post -Uri "https://api.github.com/user/repos" -Headers $headers -Body $body
  Write-Host "Created repo: $($created.full_name)" -ForegroundColor Green
} catch {
  $message = $_.Exception.Message
  # If repo already exists, GitHub returns 422.
  if ($message -match '422' -or $message -match 'already exists') {
    Write-Host "Repo likely already exists; continuing." -ForegroundColor Yellow
  } else {
    throw
  }
}

$remoteUrl = "https://github.com/$Owner/$Repo.git"

$existingOrigin = git remote get-url origin 2>$null
if ($LASTEXITCODE -eq 0 -and $existingOrigin) {
  if ($existingOrigin -ne $remoteUrl) {
    git remote set-url origin $remoteUrl | Out-Null
    Write-Host "Updated origin -> $remoteUrl" -ForegroundColor Green
  } else {
    Write-Host "Origin already set -> $remoteUrl" -ForegroundColor Green
  }
} else {
  git remote add origin $remoteUrl | Out-Null
  Write-Host "Added origin -> $remoteUrl" -ForegroundColor Green
}

Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1) git add -A" -ForegroundColor Cyan
Write-Host "  2) git commit -m \"feat: GitHub Pages snapshots\"" -ForegroundColor Cyan
Write-Host "  3) git push -u origin master" -ForegroundColor Cyan
