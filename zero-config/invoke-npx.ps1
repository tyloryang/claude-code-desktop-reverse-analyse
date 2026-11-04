param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Arguments
)

$ErrorActionPreference = 'Stop'
& npx.cmd @Arguments
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
