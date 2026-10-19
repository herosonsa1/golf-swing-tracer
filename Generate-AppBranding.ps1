# ============================================================================
# Generate-AppBranding.ps1
# Generates App Icons, Android Adaptive/Mipmap Icons, and favicon.ico
# Title Line 1: 0xB098 0xB9CC 0xC758
# Title Line 2: 0xACE8 0xD504 0xC2A4 0xC719
# ============================================================================

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Drawing

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$MobileResDir = Join-Path $RootDir "mobile\app\src\main\res"

# Exact Korean strings via Unicode code points (100% encoding-safe)
$TextLine1 = -join ([char[]]@(0xB098, 0xB9CC, 0xC758))
$TextLine2 = -join ([char[]]@(0xACE8, 0xD504, 0xC2A4, 0xC719))

function New-Color([int]$a, [int]$r, [int]$g, [int]$b) {
    return [System.Drawing.Color]::FromArgb($a, $r, $g, $b)
}

function New-RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    if ($r -le 0) {
        $path.AddRectangle((New-Object System.Drawing.RectangleF($x, $y, $w, $h)))
        return $path
    }
    $d = $r * 2.0
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function Draw-CartoonGolfBackground([int]$size) {
    $lowSize = 180
    $lowBmp = New-Object System.Drawing.Bitmap($lowSize, $lowSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($lowBmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $rect = New-Object System.Drawing.RectangleF(0, 0, $lowSize, $lowSize)

    # 1. Cartoon Sky Gradient
    $skyBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF(0, 0)),
        (New-Object System.Drawing.PointF(0, ($lowSize * 0.72))),
        (New-Color 255 48 144 232),
        (New-Color 255 162 228 248)
    )
    $g.FillRectangle($skyBrush, $rect)
    $skyBrush.Dispose()

    # 2. Warm Sun Glow
    $sunBrush = New-Object System.Drawing.SolidBrush(New-Color 195 255 236 140)
    $g.FillEllipse($sunBrush, ($lowSize * 0.60), ($lowSize * 0.07), ($lowSize * 0.30), ($lowSize * 0.30))
    $sunCoreBrush = New-Object System.Drawing.SolidBrush(New-Color 235 255 250 195)
    $g.FillEllipse($sunCoreBrush, ($lowSize * 0.66), ($lowSize * 0.13), ($lowSize * 0.18), ($lowSize * 0.18))
    $sunBrush.Dispose()
    $sunCoreBrush.Dispose()

    # 3. Cartoon Clouds
    $cloudBrush = New-Object System.Drawing.SolidBrush(New-Color 215 255 255 255)
    $g.FillEllipse($cloudBrush, ($lowSize * 0.06), ($lowSize * 0.17), ($lowSize * 0.26), ($lowSize * 0.13))
    $g.FillEllipse($cloudBrush, ($lowSize * 0.14), ($lowSize * 0.12), ($lowSize * 0.22), ($lowSize * 0.15))
    $g.FillEllipse($cloudBrush, ($lowSize * 0.25), ($lowSize * 0.16), ($lowSize * 0.20), ($lowSize * 0.12))
    $cloudBrush.Dispose()

    # 4. Cartoon Golf Course Rolling Hills & Fairway
    $comicOutlinePen = New-Object System.Drawing.Pen((New-Color 155 18 62 42), 2.2)

    $hillBackBrush = New-Object System.Drawing.SolidBrush(New-Color 255 92 196 130)
    $g.FillEllipse($hillBackBrush, (-$lowSize * 0.25), ($lowSize * 0.49), ($lowSize * 0.95), ($lowSize * 0.55))
    $g.DrawArc($comicOutlinePen, (-$lowSize * 0.25), ($lowSize * 0.49), ($lowSize * 0.95), ($lowSize * 0.55), 200, 140)
    $hillBackBrush.Dispose()

    $hillRightBrush = New-Object System.Drawing.SolidBrush(New-Color 255 58 178 102)
    $g.FillEllipse($hillRightBrush, ($lowSize * 0.28), ($lowSize * 0.47), ($lowSize * 0.95), ($lowSize * 0.60))
    $g.DrawArc($comicOutlinePen, ($lowSize * 0.28), ($lowSize * 0.47), ($lowSize * 0.95), ($lowSize * 0.60), 190, 150)
    $hillRightBrush.Dispose()

    $sandBrush = New-Object System.Drawing.SolidBrush(New-Color 235 246 226 164)
    $g.FillEllipse($sandBrush, ($lowSize * 0.62), ($lowSize * 0.57), ($lowSize * 0.24), ($lowSize * 0.08))
    $sandBrush.Dispose()

    $fairwayBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF(0, ($lowSize * 0.60))),
        (New-Object System.Drawing.PointF(0, $lowSize)),
        (New-Color 255 42 162 86),
        (New-Color 255 20 102 54)
    )
    $g.FillEllipse($fairwayBrush, (-$lowSize * 0.15), ($lowSize * 0.61), ($lowSize * 1.30), ($lowSize * 0.58))
    $g.DrawArc($comicOutlinePen, (-$lowSize * 0.15), ($lowSize * 0.61), ($lowSize * 1.30), ($lowSize * 0.58), 195, 150)
    $fairwayBrush.Dispose()

    # 5. Pin Flag on Green (Bottom-Right & Mid-Right visible area)
    $flagPolePen = New-Object System.Drawing.Pen((New-Color 235 255 255 255), 2.5)
    $fx = [float]($lowSize * 0.84)
    $fyTop = [float]($lowSize * 0.28)
    $fyBot = [float]($lowSize * 0.56)
    $g.DrawLine($flagPolePen, $fx, $fyTop, $fx, $fyBot)
    $flagPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $flagPts = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF($fx, $fyTop)),
        (New-Object System.Drawing.PointF(($fx + $lowSize * 0.13), ($fyTop + $lowSize * 0.05))),
        (New-Object System.Drawing.PointF($fx, ($fyTop + $lowSize * 0.10)))
    )
    $flagPath.AddPolygon($flagPts)
    $flagBrush = New-Object System.Drawing.SolidBrush(New-Color 250 244 63 94)
    $g.FillPath($flagBrush, $flagPath)
    $flagPolePen.Dispose()
    $flagBrush.Dispose()
    $flagPath.Dispose()

    # 6. Golden Shot Tracer Arc sweeping across upper sky to top-right ball
    $arcGlowPen = New-Object System.Drawing.Pen((New-Color 210 253 224 71), 10.5)
    $arcGlowPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $arcGlowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $arcCorePen = New-Object System.Drawing.Pen((New-Color 250 255 255 255), 4.5)
    $arcCorePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $arcCorePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    $p0 = New-Object System.Drawing.PointF(($lowSize * 0.42), ($lowSize * 0.88))
    $p1 = New-Object System.Drawing.PointF(($lowSize * 0.46), ($lowSize * 0.22))
    $p2 = New-Object System.Drawing.PointF(($lowSize * 0.62), ($lowSize * 0.05))
    $p3 = New-Object System.Drawing.PointF(($lowSize * 0.82), ($lowSize * 0.12))
    $g.DrawBezier($arcGlowPen, $p0, $p1, $p2, $p3)
    $g.DrawBezier($arcCorePen, $p0, $p1, $p2, $p3)
    $arcGlowPen.Dispose()
    $arcCorePen.Dispose()

    # 7. Cartoon Golfer Character in Dynamic Swing Finish
    $golferOutline = New-Object System.Drawing.Pen((New-Color 230 15 23 42), 3.2)
    $golferOutline.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $golferOutline.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $golferOutline.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    # Dynamic Cyan/Emerald Club Swing Swoosh
    $swingWhooshPen = New-Object System.Drawing.Pen((New-Color 205 56 189 248), 9.0)
    $swingWhooshPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $swingWhooshPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawArc($swingWhooshPen, ($lowSize * 0.10), ($lowSize * 0.08), ($lowSize * 0.64), ($lowSize * 0.78), 200, 225)
    $swingWhooshPen.Dispose()

    # Golfer Legs (Visible in lower fairway section too)
    $pantsPen = New-Object System.Drawing.Pen((New-Color 250 30 58 138), 8.5)
    $pantsPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pantsPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($pantsPen, ($lowSize * 0.31), ($lowSize * 0.56), ($lowSize * 0.24), ($lowSize * 0.90))
    $g.DrawLine($pantsPen, ($lowSize * 0.37), ($lowSize * 0.56), ($lowSize * 0.43), ($lowSize * 0.89))
    $pantsPen.Dispose()

    # Golfer Shoes
    $shoeBrush = New-Object System.Drawing.SolidBrush(New-Color 250 255 255 255)
    $g.FillEllipse($shoeBrush, ($lowSize * 0.19), ($lowSize * 0.87), ($lowSize * 0.09), ($lowSize * 0.045))
    $g.FillEllipse($shoeBrush, ($lowSize * 0.40), ($lowSize * 0.86), ($lowSize * 0.09), ($lowSize * 0.045))
    $shoeBrush.Dispose()

    # Golfer Torso (Red/Coral Polo Shirt visible in center gap)
    $shirtBrush = New-Object System.Drawing.SolidBrush(New-Color 250 239 68 68)
    $torsoPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $torsoPts = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF(($lowSize * 0.26), ($lowSize * 0.34))),
        (New-Object System.Drawing.PointF(($lowSize * 0.41), ($lowSize * 0.35))),
        (New-Object System.Drawing.PointF(($lowSize * 0.39), ($lowSize * 0.57))),
        (New-Object System.Drawing.PointF(($lowSize * 0.29), ($lowSize * 0.57)))
    )
    $torsoPath.AddPolygon($torsoPts)
    $g.FillPath($shirtBrush, $torsoPath)
    $g.DrawPath($golferOutline, $torsoPath)
    $shirtBrush.Dispose()
    $torsoPath.Dispose()

    # Golfer Head & White Visor Cap
    $skinBrush = New-Object System.Drawing.SolidBrush(New-Color 250 254 215 170)
    $headRect = New-Object System.Drawing.RectangleF(($lowSize * 0.28), ($lowSize * 0.20), ($lowSize * 0.12), ($lowSize * 0.12))
    $g.FillEllipse($skinBrush, $headRect)
    $g.DrawEllipse($golferOutline, $headRect)
    $skinBrush.Dispose()

    $capBrush = New-Object System.Drawing.SolidBrush(New-Color 255 255 255 255)
    $g.FillPie($capBrush, ($lowSize * 0.27), ($lowSize * 0.18), ($lowSize * 0.14), ($lowSize * 0.10), 180, 180)
    $g.DrawLine($golferOutline, ($lowSize * 0.28), ($lowSize * 0.23), ($lowSize * 0.44), ($lowSize * 0.21))
    $capBrush.Dispose()

    # Golfer Arms & Golf Club Overhead Finish
    $armPen = New-Object System.Drawing.Pen((New-Color 250 254 215 170), 6.0)
    $armPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $armPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawLine($armPen, ($lowSize * 0.37), ($lowSize * 0.37), ($lowSize * 0.48), ($lowSize * 0.24))
    $armPen.Dispose()

    $clubShaftPen = New-Object System.Drawing.Pen((New-Color 245 241 245 249), 3.0)
    $g.DrawLine($clubShaftPen, ($lowSize * 0.48), ($lowSize * 0.24), ($lowSize * 0.18), ($lowSize * 0.09))
    $clubHeadBrush = New-Object System.Drawing.SolidBrush(New-Color 250 30 41 59)
    $g.FillEllipse($clubHeadBrush, ($lowSize * 0.14), ($lowSize * 0.06), ($lowSize * 0.075), ($lowSize * 0.055))
    $clubShaftPen.Dispose()
    $clubHeadBrush.Dispose()

    # Flying Cartoon Golf Ball at Top-Right + Tee Ball at Bottom
    $ballBrush = New-Object System.Drawing.SolidBrush(New-Color 255 255 255 255)
    $ballRect = New-Object System.Drawing.RectangleF(($lowSize * 0.76), ($lowSize * 0.06), ($lowSize * 0.13), ($lowSize * 0.13))
    $g.FillEllipse($ballBrush, $ballRect)
    $g.DrawEllipse($golferOutline, $ballRect)
    $ballBrush.Dispose()

    $golferOutline.Dispose()
    $comicOutlinePen.Dispose()
    $g.Dispose()

    # Soft-blur pass via multi-stage bicubic resampling + soft contrast veil
    $blurMidSize = 92
    $midBmp = New-Object System.Drawing.Bitmap($blurMidSize, $blurMidSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $gm = [System.Drawing.Graphics]::FromImage($midBmp)
    $gm.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
    $gm.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $gm.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $gm.DrawImage($lowBmp, 0, 0, $blurMidSize, $blurMidSize)
    $gm.Dispose()

    $finalBmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $gf = [System.Drawing.Graphics]::FromImage($finalBmp)
    $gf.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gf.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $gf.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $gf.DrawImage($midBmp, 0, 0, $size, $size)

    $imgAttr = New-Object System.Drawing.Imaging.ImageAttributes
    $colorMatrix = New-Object System.Drawing.Imaging.ColorMatrix
    $colorMatrix.Matrix33 = 0.50
    $imgAttr.SetColorMatrix($colorMatrix)
    $destRect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $gf.DrawImage($lowBmp, $destRect, 0, 0, $lowSize, $lowSize, [System.Drawing.GraphicsUnit]::Pixel, $imgAttr)
    $imgAttr.Dispose()

    $veilBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF(0, 0)),
        (New-Object System.Drawing.PointF(0, $size)),
        (New-Color 32 12 28 52),
        (New-Color 78 10 26 44)
    )
    $gf.FillRectangle($veilBrush, 0, 0, $size, $size)
    $veilBrush.Dispose()

    $lowBmp.Dispose()
    $midBmp.Dispose()
    $gf.Dispose()
    return $finalBmp
}

function New-FittedTextPath(
    [string]$text,
    [System.Drawing.FontFamily]$fontFamily,
    [int]$fontStyle,
    [System.Drawing.RectangleF]$targetRect,
    [float]$charTrackingRatio = 0.0
) {
    $rawPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $sf = [System.Drawing.StringFormat]::GenericTypographic
    $sf.FormatFlags = $sf.FormatFlags -bor [System.Drawing.StringFormatFlags]::MeasureTrailingSpaces

    if ($charTrackingRatio -le 0.001) {
        $rawPath.AddString($text, $fontFamily, $fontStyle, 100.0, (New-Object System.Drawing.PointF(0, 0)), $sf)
    } else {
        $chars = $text.ToCharArray()
        $curX = 0.0
        for ($i = 0; $i -lt $chars.Length; $i++) {
            $chPath = New-Object System.Drawing.Drawing2D.GraphicsPath
            $chStr = [string]$chars[$i]
            $chPath.AddString($chStr, $fontFamily, $fontStyle, 100.0, (New-Object System.Drawing.PointF($curX, 0)), $sf)
            $b = $chPath.GetBounds()
            $rawPath.AddPath($chPath, $false)
            $curX = $b.Right + (100.0 * $charTrackingRatio)
            $chPath.Dispose()
        }
    }

    $bounds = $rawPath.GetBounds()
    if ($bounds.Width -le 0.1 -or $bounds.Height -le 0.1) {
        return $rawPath
    }

    $scaleX = $targetRect.Width / $bounds.Width
    $scaleY = $targetRect.Height / $bounds.Height

    $matrix = New-Object System.Drawing.Drawing2D.Matrix
    $matrix.Translate($targetRect.X - ($bounds.X * $scaleX), $targetRect.Y - ($bounds.Y * $scaleY))
    $matrix.Scale($scaleX, $scaleY)
    $rawPath.Transform($matrix)
    $matrix.Dispose()

    return $rawPath
}

function Draw-ForegroundTypography(
    [System.Drawing.Graphics]$g,
    [System.Drawing.RectangleF]$contentRect
) {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $fontName = "Malgun Gothic"
    $fontFamily = New-Object System.Drawing.FontFamily($fontName)
    $boldStyle = [int][System.Drawing.FontStyle]::Bold

    $cx = $contentRect.X
    $cy = $contentRect.Y
    $cw = $contentRect.Width
    $ch = $contentRect.Height

    # Top trajectory accent arc
    $topArcPen = New-Object System.Drawing.Pen((New-Color 235 253 224 71), ($cw * 0.020))
    $topArcPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $topArcPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawArc($topArcPen, ($cx + $cw * 0.10), ($cy + $ch * 0.04), ($cw * 0.80), ($ch * 0.16), 195, 150)
    $topArcPen.Dispose()

    # Row 1: Upper smaller title fitted across width
    $line1Rect = New-Object System.Drawing.RectangleF(
        ($cx + $cw * 0.10),
        ($cy + $ch * 0.14),
        ($cw * 0.80),
        ($ch * 0.185)
    )
    $pathLine1 = New-FittedTextPath -text $TextLine1 -fontFamily $fontFamily -fontStyle $boldStyle -targetRect $line1Rect -charTrackingRatio 0.24

    $shadowOffset1 = [Math]::Max(2.0, ($cw * 0.015))
    $shadowMatrix1 = New-Object System.Drawing.Drawing2D.Matrix
    $shadowMatrix1.Translate(0, $shadowOffset1)
    $shadowPath1 = $pathLine1.Clone()
    $shadowPath1.Transform($shadowMatrix1)
    $shadowMatrix1.Dispose()

    $shadowPen1 = New-Object System.Drawing.Pen((New-Color 220 8 20 38), ($cw * 0.044))
    $shadowPen1.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawPath($shadowPen1, $shadowPath1)
    $shadowPen1.Dispose()
    $shadowPath1.Dispose()

    $outerPen1 = New-Object System.Drawing.Pen((New-Color 255 12 28 52), ($cw * 0.040))
    $outerPen1.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawPath($outerPen1, $pathLine1)
    $outerPen1.Dispose()

    $fillBrush1 = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF(0, $line1Rect.Top)),
        (New-Object System.Drawing.PointF(0, $line1Rect.Bottom)),
        (New-Color 255 255 252 220),
        (New-Color 255 251 191 36)
    )
    $innerBoldPen1 = New-Object System.Drawing.Pen($fillBrush1, ($cw * 0.006))
    $innerBoldPen1.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawPath($innerBoldPen1, $pathLine1)
    $g.FillPath($fillBrush1, $pathLine1)
    $innerBoldPen1.Dispose()
    $fillBrush1.Dispose()
    $pathLine1.Dispose()

    # Row 2: Lower edge-to-edge full width ultra-bold title
    $line2Rect = New-Object System.Drawing.RectangleF(
        ($cx + $cw * 0.03),
        ($cy + $ch * 0.41),
        ($cw * 0.94),
        ($ch * 0.44)
    )
    $pathLine2 = New-FittedTextPath -text $TextLine2 -fontFamily $fontFamily -fontStyle $boldStyle -targetRect $line2Rect -charTrackingRatio 0.04

    $shadowOffset2 = [Math]::Max(3.0, ($cw * 0.026))
    $shadowMatrix2 = New-Object System.Drawing.Drawing2D.Matrix
    $shadowMatrix2.Translate(0, $shadowOffset2)
    $shadowPath2 = $pathLine2.Clone()
    $shadowPath2.Transform($shadowMatrix2)
    $shadowMatrix2.Dispose()

    $shadowPen2 = New-Object System.Drawing.Pen((New-Color 240 6 18 34), ($cw * 0.072))
    $shadowPen2.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawPath($shadowPen2, $shadowPath2)
    $shadowBrush2 = New-Object System.Drawing.SolidBrush(New-Color 240 6 18 34)
    $g.FillPath($shadowBrush2, $shadowPath2)
    $shadowPen2.Dispose()
    $shadowBrush2.Dispose()
    $shadowPath2.Dispose()

    $outerPen2 = New-Object System.Drawing.Pen((New-Color 255 10 25 46), ($cw * 0.066))
    $outerPen2.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawPath($outerPen2, $pathLine2)
    $outerPen2.Dispose()

    $fillBrush2 = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF(0, $line2Rect.Top)),
        (New-Object System.Drawing.PointF(0, $line2Rect.Bottom)),
        (New-Color 255 255 255 255),
        (New-Color 255 225 252 240)
    )
    $ultraBoldPen2 = New-Object System.Drawing.Pen($fillBrush2, ($cw * 0.017))
    $ultraBoldPen2.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawPath($ultraBoldPen2, $pathLine2)
    $g.FillPath($fillBrush2, $pathLine2)
    $ultraBoldPen2.Dispose()
    $fillBrush2.Dispose()
    $pathLine2.Dispose()

    $fontFamily.Dispose()
}

function New-CompleteAppIconBitmap([int]$size, [bool]$roundMask = $false, [float]$cornerRadiusRatio = 0.21, [float]$paddingRatio = 0.03) {
    $bgBmp = Draw-CartoonGolfBackground -size $size
    $outBmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($outBmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    if ($roundMask) {
        $clipPath = New-Object System.Drawing.Drawing2D.GraphicsPath
        $clipPath.AddEllipse(0, 0, ($size - 1), ($size - 1))
    } else {
        $r = [float]($size * $cornerRadiusRatio)
        $clipPath = New-RoundedRectPath -x 0 -y 0 -w $size -h $size -r $r
    }

    $g.SetClip($clipPath)
    $g.DrawImage($bgBmp, 0, 0, $size, $size)

    $pad = [float]($size * $paddingRatio)
    $contentRect = New-Object System.Drawing.RectangleF($pad, $pad, ($size - $pad * 2.0), ($size - $pad * 2.0))
    Draw-ForegroundTypography -g $g -contentRect $contentRect

    $g.ResetClip()

    $borderPen = New-Object System.Drawing.Pen((New-Color 145 255 255 255), [Math]::Max(1.5, ($size * 0.018)))
    $g.DrawPath($borderPen, $clipPath)
    $borderPen.Dispose()
    $clipPath.Dispose()

    $bgBmp.Dispose()
    $g.Dispose()
    return $outBmp
}

function Save-MultiSizeIco([string]$icoPath) {
    $sizes = @(16, 32, 48, 64, 256)
    $pngBlobs = New-Object System.Collections.Generic.List[byte[]]

    foreach ($sz in $sizes) {
        $padRatio = if ($sz -le 32) { 0.01 } else { 0.025 }
        $bmp = New-CompleteAppIconBitmap -size $sz -roundMask $false -cornerRadiusRatio 0.18 -paddingRatio $padRatio
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $pngBlobs.Add($ms.ToArray())
        $ms.Dispose()
        $bmp.Dispose()
    }

    $fs = [System.IO.File]::Create($icoPath)
    $bw = New-Object System.IO.BinaryWriter($fs)

    $bw.Write([uint16]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]$sizes.Count)

    $offset = 6 + (16 * $sizes.Count)
    for ($i = 0; $i -lt $sizes.Count; $i++) {
        $sz = $sizes[$i]
        $blob = $pngBlobs[$i]
        $wByte = if ($sz -ge 256) { [byte]0 } else { [byte]$sz }
        $hByte = if ($sz -ge 256) { [byte]0 } else { [byte]$sz }

        $bw.Write($wByte)
        $bw.Write($hByte)
        $bw.Write([byte]0)
        $bw.Write([byte]0)
        $bw.Write([uint16]1)
        $bw.Write([uint16]32)
        $bw.Write([uint32]$blob.Length)
        $bw.Write([uint32]$offset)
        $offset += $blob.Length
    }

    for ($i = 0; $i -lt $sizes.Count; $i++) {
        $bw.Write($pngBlobs[$i])
    }

    $bw.Flush()
    $bw.Close()
    $fs.Close()
}

$AppIconPngPath = Join-Path $RootDir "app-icon.png"
$FaviconIcoPath = Join-Path $RootDir "favicon.ico"

$masterBmp = New-CompleteAppIconBitmap -size 512 -roundMask $false -cornerRadiusRatio 0.20 -paddingRatio 0.025
$masterBmp.Save($AppIconPngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$masterBmp.Dispose()

Save-MultiSizeIco -icoPath $FaviconIcoPath

$DrawableNoDpiDir = Join-Path $MobileResDir "drawable-nodpi"
if (-not (Test-Path $DrawableNoDpiDir)) {
    New-Item -ItemType Directory -Path $DrawableNoDpiDir -Force | Out-Null
}

$adaptiveSize = 1080
$bgLayerBmp = Draw-CartoonGolfBackground -size $adaptiveSize
$bgLayerPath = Join-Path $DrawableNoDpiDir "ic_launcher_bg_cartoon.png"
$bgLayerBmp.Save($bgLayerPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bgLayerBmp.Dispose()

$fgLayerBmp = New-Object System.Drawing.Bitmap($adaptiveSize, $adaptiveSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gFg = [System.Drawing.Graphics]::FromImage($fgLayerBmp)
$safeInset = [float]($adaptiveSize * 0.175)
$safeRect = New-Object System.Drawing.RectangleF($safeInset, $safeInset, ($adaptiveSize - $safeInset * 2.0), ($adaptiveSize - $safeInset * 2.0))
Draw-ForegroundTypography -g $gFg -contentRect $safeRect
$gFg.Dispose()
$fgLayerPath = Join-Path $DrawableNoDpiDir "ic_launcher_fg_typography.png"
$fgLayerBmp.Save($fgLayerPath, [System.Drawing.Imaging.ImageFormat]::Png)
$fgLayerBmp.Dispose()

$mipmapSpecs = @(
    @{ Dir = "mipmap-mdpi";    Size = 48  },
    @{ Dir = "mipmap-hdpi";    Size = 72  },
    @{ Dir = "mipmap-xhdpi";   Size = 96  },
    @{ Dir = "mipmap-xxhdpi";  Size = 144 },
    @{ Dir = "mipmap-xxxhdpi"; Size = 192 }
)

foreach ($spec in $mipmapSpecs) {
    $mDir = Join-Path $MobileResDir $spec.Dir
    if (-not (Test-Path $mDir)) {
        New-Item -ItemType Directory -Path $mDir -Force | Out-Null
    }
    Get-ChildItem -Path $mDir -Filter "ic_launcher*.webp" -ErrorAction SilentlyContinue | Remove-Item -Force

    $sqBmp = New-CompleteAppIconBitmap -size $spec.Size -roundMask $false -cornerRadiusRatio 0.20 -paddingRatio 0.025
    $sqBmp.Save((Join-Path $mDir "ic_launcher.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $sqBmp.Dispose()

    $rdBmp = New-CompleteAppIconBitmap -size $spec.Size -roundMask $true -cornerRadiusRatio 0.50 -paddingRatio 0.085
    $rdBmp.Save((Join-Path $mDir "ic_launcher_round.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $rdBmp.Dispose()
}

Write-Host "ICON_GENERATION_OK" -ForegroundColor Green
Write-Host " - $AppIconPngPath"
Write-Host " - $FaviconIcoPath"
Write-Host " - $bgLayerPath"
Write-Host " - $fgLayerPath"
