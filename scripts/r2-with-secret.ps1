param(
  [ValidateSet('bot','staging')][string]$Profile = 'staging',
  [ValidateSet('preflight','acceptance','configure-vercel','bot-upload-acceptance')][string]$Task = 'preflight'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$secretPath = if ($Profile -eq 'bot') { 'C:\Users\LENOVO\kim-tuyen-ai\data\r2-storage.secret' } else { Join-Path $PSScriptRoot '..\work\r2-staging.secret' }
$envelope = [Convert]::FromBase64String([IO.File]::ReadAllText($secretPath).Trim())
$clearBytes = [Security.Cryptography.ProtectedData]::Unprotect($envelope, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
try {
  $settings = [Text.Encoding]::UTF8.GetString($clearBytes) | ConvertFrom-Json
  foreach ($entry in $settings.PSObject.Properties) {
    [Environment]::SetEnvironmentVariable($entry.Name, [string]$entry.Value, 'Process')
  }
  if ($Task -eq 'preflight') { & node --import tsx scripts/r2-media-ops.ts preflight --apply }
  elseif ($Task -eq 'bot-upload-acceptance') {
    if ($Profile -ne 'bot') { throw 'Production bot credential required' }
    & node --import tsx scripts/r2-bot-upload-acceptance.ts
  } elseif ($Task -eq 'configure-vercel') {
    if ($Profile -ne 'staging') { throw 'Only staging configuration is allowed here' }
    & node scripts/r2-configure-vercel.mjs staging
  } else {
    if ($Profile -ne 'staging') { throw 'Acceptance only uses the staging bucket' }
    & node --conditions=react-server --import tsx scripts/r2-staging-acceptance.ts
  }
  $taskExit = $LASTEXITCODE
} finally {
  [Array]::Clear($clearBytes, 0, $clearBytes.Length)
  if ($settings) { foreach ($entry in $settings.PSObject.Properties) { [Environment]::SetEnvironmentVariable($entry.Name, $null, 'Process') } }
}
exit $taskExit
