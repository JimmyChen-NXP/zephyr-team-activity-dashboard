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

$token = (Get-Token).Trim()

function New-Headers([string]$authorizationValue) {
  return @{
    Authorization         = $authorizationValue
    Accept                = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
  }
}

function Invoke-GhRestMethod {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('Get', 'Post', 'Put', 'Patch', 'Delete')][string]$Method,
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $false)][string]$Body
  )

  $attempts = @(
    (New-Headers -authorizationValue "Bearer $token"),
    (New-Headers -authorizationValue "token $token")
  )

  foreach ($headers in $attempts) {
    try {
      if ($PSBoundParameters.ContainsKey('Body') -and $null -ne $Body) {
        return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers -Body $Body
      }
      return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers
    } catch {
      $message = $_.Exception.Message
      if ($message -match '\(401\) Unauthorized') {
        continue
      }
      throw
    }
  }

  throw "GitHub API returned 401 Unauthorized for both Bearer and token auth schemes. Your GITHUB_TOKEN may be expired/invalid or not permitted by your org SSO settings."
}

$user = Invoke-GhRestMethod -Method Get -Uri "https://api.github.com/user"
if (-not $user.login) {
  throw "Failed to identify the authenticated GitHub user."
}

if ($Owner -and ($user.login -ne $Owner)) {
  throw "Token is authenticated as '$($user.login)', but -Owner was '$Owner'. Refusing to create repo under the wrong account."
}

$private = $Visibility -eq 'private'

$body = @{ name = $Repo; private = $private; description = $Description } | ConvertTo-Json

try {
  $created = Invoke-GhRestMethod -Method Post -Uri "https://api.github.com/user/repos" -Body $body
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
