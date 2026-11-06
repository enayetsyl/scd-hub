# Convert the .docx originals in a reference-paper manifest to PDF with Word (D-#1030).
#   powershell -NoProfile -ExecutionPolicy Bypass -File server/scripts/exam-papers/convert-docx-to-pdf.ps1 -Manifest <manifest.json>
# Only entries with needsConversion = true whose target PDF does not exist yet are converted
# (re-runnable). Needs Microsoft Word on this machine. Bangla papers typed in Bijoy fonts
# (SutonnyMJ) render correctly only when that font is installed here.
param([Parameter(Mandatory = $true)][string]$Manifest)

$m = Get-Content -Raw -Encoding UTF8 $Manifest | ConvertFrom-Json
New-Item -ItemType Directory -Force $m.pdfCache | Out-Null
$todo = @($m.entries | Where-Object { $_.needsConversion -and -not (Test-Path $_.pdf) })
Write-Output ("{0} to convert" -f $todo.Count)
if ($todo.Count -eq 0) { exit 0 }

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$ok = 0; $fail = 0
try {
  foreach ($e in $todo) {
    try {
      $doc = $word.Documents.Open($e.source, $false, $true)
      $doc.SaveAs([ref]$e.pdf, [ref]17)   # 17 = wdFormatPDF
      $doc.Close([ref]0)
      $ok++
    } catch {
      $fail++
      Write-Output ("FAIL {0}: {1}" -f $e.source, $_.Exception.Message)
    }
  }
} finally {
  $word.Quit()
}
Write-Output ("converted {0}, failed {1}" -f $ok, $fail)
