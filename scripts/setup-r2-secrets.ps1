param([ValidateSet('bot','staging')][string]$Profile = 'bot')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$accountId = (Read-Host 'Cloudflare Account ID').Trim()
if ($accountId -notmatch '^[a-f0-9]{32}$') { throw 'Invalid Account ID' }
$accessKey = Read-Host 'R2 Access Key ID' -AsSecureString
$secretKey = Read-Host 'R2 Secret Access Key' -AsSecureString
function ConvertFrom-SecureValue([Security.SecureString]$secureValue) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
$settings = @{
  R2_ACCOUNT_ID = $accountId
  R2_ENDPOINT = "https://$accountId.r2.cloudflarestorage.com"
  R2_REGION = 'auto'
  R2_BUCKET = $(if ($Profile -eq 'bot') { 'chart-gold-media-prod' } else { 'chart-gold-media-staging' })
  R2_ACCESS_KEY_ID = ConvertFrom-SecureValue $accessKey
  R2_SECRET_ACCESS_KEY = ConvertFrom-SecureValue $secretKey
}
if ($settings.R2_ACCESS_KEY_ID -notmatch '^[A-Za-z0-9_-]{16,128}$' -or $settings.R2_SECRET_ACCESS_KEY -notmatch '^[A-Za-z0-9_+/=-]{20,256}$') { throw 'Invalid R2 credential format' }
$clearBytes = [Text.Encoding]::UTF8.GetBytes(($settings | ConvertTo-Json -Compress))
try {
  $envelope = [Security.Cryptography.ProtectedData]::Protect($clearBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $destination = if ($Profile -eq 'bot') { 'C:\Users\LENOVO\kim-tuyen-ai\data\r2-storage.secret' } else { Join-Path $PSScriptRoot '..\work\r2-staging.secret' }
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($destination))) | Out-Null
  [IO.File]::WriteAllText([IO.Path]::GetFullPath($destination), [Convert]::ToBase64String($envelope), [Text.Encoding]::ASCII)
  Write-Host "Saved $Profile credential using Windows DPAPI. No credential was printed."
} finally { [Array]::Clear($clearBytes, 0, $clearBytes.Length); $settings.Clear() }
