param([string]$ImagePath, [string]$OutPath)
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]

function Await($WinRtTask, $ResultType) {
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and !$_.IsGenericMethod } |
        Select-Object -First 1
    $asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod } |
        Select-Object -First 1
    If ($ResultType) {
        $asTaskGenericBound = $asTaskGeneric.MakeGenericMethod($ResultType)
        $netTask = $asTaskGenericBound.Invoke($null, @($WinRtTask))
    } Else {
        $netTask = $asTask.Invoke($null, @($WinRtTask))
    }
    $netTask.Wait(-1) | Out-Null
    If ($ResultType) { return $netTask.Result }
}

try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if (-not $engine) {
        $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage(
            [Windows.Globalization.Language]::new("en-US"))
    }

    $ocrResult = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

    $words = @()
    foreach ($line in $ocrResult.Lines) {
        foreach ($word in $line.Words) {
            $bounds = $word.BoundingRect
            $words += @{
                text = $word.Text
                x    = [math]::Round($bounds.X)
                y    = [math]::Round($bounds.Y)
                w    = [math]::Round($bounds.Width)
                h    = [math]::Round($bounds.Height)
            }
        }
    }

    $output = @{
        words    = $words
        fullText = $ocrResult.Text
    }

    $json = $output | ConvertTo-Json -Compress -Depth 5
    if ($OutPath) {
        [System.IO.File]::WriteAllText($OutPath, $json, [System.Text.UTF8Encoding]::new($false))
    } else {
        $json
    }
} catch {
    $err = @{ words = @(); fullText = ""; error = $_.Exception.Message } | ConvertTo-Json -Compress
    if ($OutPath) {
        [System.IO.File]::WriteAllText($OutPath, $err, [System.Text.UTF8Encoding]::new($false))
    } else {
        $err
    }
}
