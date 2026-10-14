param([string]$DataPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.SpeechSynthesis.SpeechSynthesisStream, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await-WinRT($operation, [Type]$resultType) {
    $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
    $task.Wait()
    return $task.Result
}
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -eq 'zh-CN' -and $_.DisplayName -match 'Huihui' } | Select-Object -First 1
if (-not $voice) { $voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object Language -eq 'zh-CN' | Select-Object -First 1 }
if (-not $voice) { throw 'No installed Chinese Windows voice.' }
$synth.Voice = $voice
$scenes = Get-Content -LiteralPath $DataPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($scene in $scenes) {
    $stream = Await-WinRT ($synth.SynthesizeTextToStreamAsync($scene.voice)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
    $reader = New-Object Windows.Storage.Streams.DataReader($stream)
    $size = [uint32]$stream.Size
    Await-WinRT ($reader.LoadAsync($size)) ([uint32]) | Out-Null
    $bytes = New-Object byte[] $size
    $reader.ReadBytes($bytes)
    [System.IO.File]::WriteAllBytes((Join-Path (Split-Path -Parent $DataPath) ($scene.id + '.wav')), $bytes)
    $reader.Dispose()
    $stream.Dispose()
    Write-Output ($scene.id + ': ' + $voice.DisplayName)
}
$synth.Dispose()
