# scripts/generate-og-cover.ps1
# Genera public/og-cover.png (1200x630) — imagen de respaldo para og:image
# cuando un local no tiene bannerUrl ni logoUrl. Determinista, sin dependencias.
# Uso: powershell -ExecutionPolicy Bypass -File scripts/generate-og-cover.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outPath = Join-Path $root 'public\og-cover.png'
$logoPath = Join-Path $root 'public\logo-scango.png'

$W = 1200; $H = 630
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

# Fondo: gradiente diagonal pizarra oscura -> verde profundo
$rect = New-Object System.Drawing.Rectangle(0, 0, $W, $H)
$c1 = [System.Drawing.Color]::FromArgb(255, 14, 21, 18)
$c2 = [System.Drawing.Color]::FromArgb(255, 30, 58, 47)
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 45.0)
$g.FillRectangle($bg, $rect)

# Aro dorado sutil
$gold = [System.Drawing.Color]::FromArgb(255, 236, 201, 75)
$pen = New-Object System.Drawing.Pen($gold, 3)
$g.DrawRectangle($pen, 32, 32, ($W - 64), ($H - 64))

# Logo centrado
if (Test-Path $logoPath) {
  $logo = [System.Drawing.Image]::FromFile($logoPath)
  $logoH = 190
  $logoW = [int]($logo.Width * ($logoH / $logo.Height))
  $g.DrawImage($logo, [int](($W - $logoW) / 2), 96, $logoW, $logoH)
  $logo.Dispose()
}

# Regla dorada
$g.DrawLine($pen, 500, 330, 700, 330)

# Tagline
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$font = New-Object System.Drawing.Font('Segoe UI', 30, [System.Drawing.FontStyle]::Regular)
$light = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 230, 237, 233))
$taglineRect = New-Object System.Drawing.RectangleF(0, 350, $W, 70)
$g.DrawString('Menú digital por QR · Pedidos por WhatsApp', $font, $light, $taglineRect, $sf)

$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)

$font.Dispose(); $light.Dispose(); $sf.Dispose(); $pen.Dispose(); $bg.Dispose(); $g.Dispose(); $bmp.Dispose()
Write-Output "og-cover.png generado: $outPath"
