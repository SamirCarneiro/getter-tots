$ErrorActionPreference = 'Stop'
$getterCommand = Join-Path (Split-Path $PSScriptRoot -Parent) 'tools/getterctl'
$getterArguments = @()
$getterHasToolArguments = $false
for ($getterIndex = 0; $getterIndex -lt $args.Count; $getterIndex++) {
    if ($args[$getterIndex] -eq '-GetterHome') {
        $getterIndex++
        if ($getterIndex -ge $args.Count) { [Console]::Error.WriteLine('-GetterHome needs a folder'); exit 2 }
        $getterArguments += @('--getter-home', [string]$args[$getterIndex])
    } elseif ($args[$getterIndex] -ne '--' -or $getterHasToolArguments) {
        $getterArguments += [string]$args[$getterIndex]
        $getterHasToolArguments = $true
    }
}
$getterJson = ConvertTo-Json -InputObject @($getterArguments) -Compress
$getterPacket = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($getterJson))
& node $getterCommand --getter-args-base64 $getterPacket
exit $LASTEXITCODE
