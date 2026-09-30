param(
    [string]$Root = 'C:\Users\Golajah\Documents\ComfyUI',
    [string]$SourceImage = 'C:\Users\Golajah\AppData\Local\Temp\codex-clipboard-f90c9ef9-d7b3-4955-a6bd-b53648abffbc.png'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$inputDir = Join-Path $Root 'input\Badge_8_2'
$workflowDir = Join-Path $Root 'user\default\workflows'
$workflowPath = Join-Path $workflowDir '#8.2 - 徽章工作流.json'
$referencePath = Join-Path $inputDir 'badge_reference_full.png'
$flatPath = Join-Path $inputDir 'badge_flat.png'
$heightIdPath = Join-Path $inputDir 'badge_height_id.png'

if (-not (Test-Path -LiteralPath $SourceImage)) {
    throw "Badge reference image does not exist: $SourceImage"
}
New-Item -ItemType Directory -Force -Path $inputDir, $workflowDir | Out-Null
Copy-Item -LiteralPath $SourceImage -Destination $referencePath -Force

Add-Type -AssemblyName System.Drawing

function Test-NearWhite([System.Drawing.Color]$Color, [int]$Tolerance = 18) {
    $dr = 255 - [int]$Color.R
    $dg = 255 - [int]$Color.G
    $db = 255 - [int]$Color.B
    return (($dr * $dr) + ($dg * $dg) + ($db * $db)) -le ($Tolerance * $Tolerance)
}

function Test-CutoutPixel([System.Drawing.Bitmap]$Mask, [int]$X, [int]$Y) {
    return $Mask.GetPixel($X, $Y).R -lt 128
}

# The source is 762x402. A 402x402 left crop excludes the legend while retaining
# the complete badge and its original aspect ratio. Both derived inputs use this
# exact crop and pixel grid.
$cropWidth = 402
$cropHeight = 402
$source = [System.Drawing.Bitmap]::new($referencePath)
try {
    if ($source.Width -lt $cropWidth -or $source.Height -lt $cropHeight) {
        throw "Reference image is smaller than the required $cropWidth x $cropHeight crop."
    }
    $crop = [System.Drawing.Bitmap]::new(
        $cropWidth,
        $cropHeight,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($crop)
    try {
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.DrawImage(
            $source,
            [System.Drawing.Rectangle]::new(0, 0, $cropWidth, $cropHeight),
            [System.Drawing.Rectangle]::new(0, 0, $cropWidth, $cropHeight),
            [System.Drawing.GraphicsUnit]::Pixel
        )
    } finally {
        $graphics.Dispose()
    }
} finally {
    $source.Dispose()
}

# Full Cut Out faces. The upper quadrilateral is the clearly bounded white face;
# the lower polygon is the narrow face indicated by the second X. The mask is
# deliberately filled, so the X glyph itself is never used as the topology.
$cutoutMask = [System.Drawing.Bitmap]::new($cropWidth, $cropHeight)
$cutoutGraphics = [System.Drawing.Graphics]::FromImage($cutoutMask)
try {
    $cutoutGraphics.Clear([System.Drawing.Color]::White)
    $brush = [System.Drawing.Brushes]::Black
    $upper = [System.Drawing.Point[]]@(
        [System.Drawing.Point]::new(232, 119),
        [System.Drawing.Point]::new(268, 119),
        [System.Drawing.Point]::new(283, 163),
        [System.Drawing.Point]::new(241, 163)
    )
    $lower = [System.Drawing.Point[]]@(
        [System.Drawing.Point]::new(237, 300),
        [System.Drawing.Point]::new(252, 286),
        [System.Drawing.Point]::new(268, 299),
        [System.Drawing.Point]::new(253, 321),
        [System.Drawing.Point]::new(239, 316)
    )
    $cutoutGraphics.FillPolygon($brush, $upper)
    $cutoutGraphics.FillPolygon($brush, $lower)
} finally {
    $cutoutGraphics.Dispose()
}

# Find only the near-white region connected to the crop boundary. Enclosed white
# artwork remains solid; the exterior becomes transparent. Cut Out polygons are
# subtracted independently below.
$background = [bool[,]]::new($cropWidth, $cropHeight)
$queue = [System.Collections.Generic.Queue[System.Drawing.Point]]::new()
function Add-BackgroundSeed([int]$X, [int]$Y) {
    if ($X -lt 0 -or $Y -lt 0 -or $X -ge $cropWidth -or $Y -ge $cropHeight) { return }
    if ($background[$X, $Y]) { return }
    if (-not (Test-NearWhite $crop.GetPixel($X, $Y))) { return }
    $background[$X, $Y] = $true
    $queue.Enqueue([System.Drawing.Point]::new($X, $Y))
}
for ($x = 0; $x -lt $cropWidth; $x++) {
    Add-BackgroundSeed $x 0
    Add-BackgroundSeed $x ($cropHeight - 1)
}
for ($y = 0; $y -lt $cropHeight; $y++) {
    Add-BackgroundSeed 0 $y
    Add-BackgroundSeed ($cropWidth - 1) $y
}
$directions = @(@(1, 0), @(-1, 0), @(0, 1), @(0, -1))
while ($queue.Count -gt 0) {
    $point = $queue.Dequeue()
    foreach ($direction in $directions) {
        Add-BackgroundSeed ($point.X + $direction[0]) ($point.Y + $direction[1])
    }
}

$flat = [System.Drawing.Bitmap]::new(
    $cropWidth,
    $cropHeight,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
)
$heightId = [System.Drawing.Bitmap]::new(
    $cropWidth,
    $cropHeight,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
)
$palette = [System.Drawing.Color[]]@(
    [System.Drawing.Color]::FromArgb(255, 223, 189, 155), # raised metal
    [System.Drawing.Color]::FromArgb(255, 0, 77, 67),     # Pantone 3305
    [System.Drawing.Color]::FromArgb(255, 22, 48, 41),    # Pantone 5535
    [System.Drawing.Color]::FromArgb(255, 185, 204, 196), # Pantone 622
    [System.Drawing.Color]::FromArgb(255, 18, 151, 139),  # Pantone 7473
    [System.Drawing.Color]::FromArgb(255, 232, 240, 236), # Pantone 621
    [System.Drawing.Color]::White
)
$magenta = [System.Drawing.Color]::FromArgb(255, 255, 0, 255)
try {
    for ($y = 0; $y -lt $cropHeight; $y++) {
        for ($x = 0; $x -lt $cropWidth; $x++) {
            $isCutout = Test-CutoutPixel $cutoutMask $x $y
            $isBackground = $background[$x, $y]
            $sourceColor = $crop.GetPixel($x, $y)

            if ($isBackground -or $isCutout) {
                $flat.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 255, 255, 255))
            } else {
                $flat.SetPixel(
                    $x,
                    $y,
                    [System.Drawing.Color]::FromArgb(255, $sourceColor.R, $sourceColor.G, $sourceColor.B)
                )
            }

            if ($isCutout) {
                $heightId.SetPixel($x, $y, $magenta)
                continue
            }
            if ($isBackground) {
                $heightId.SetPixel($x, $y, [System.Drawing.Color]::White)
                continue
            }
            $bestColor = $palette[0]
            $bestDistance = [double]::PositiveInfinity
            foreach ($candidate in $palette) {
                $dr = [int]$sourceColor.R - [int]$candidate.R
                $dg = [int]$sourceColor.G - [int]$candidate.G
                $db = [int]$sourceColor.B - [int]$candidate.B
                $distance = ($dr * $dr) + ($dg * $dg) + ($db * $db)
                if ($distance -lt $bestDistance) {
                    $bestDistance = $distance
                    $bestColor = $candidate
                }
            }
            $heightId.SetPixel($x, $y, $bestColor)
        }
    }
    $flat.Save($flatPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $heightId.Save($heightIdPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $flat.Dispose()
    $heightId.Dispose()
    $cutoutMask.Dispose()
    $crop.Dispose()
}

function New-Input([string]$Name, [string]$Type, [bool]$Widget = $false, [bool]$Optional = $false, [string]$Label = '') {
    $input = [ordered]@{ localized_name = $Name; name = $Name; type = $Type; link = $null }
    if ($Label) { $input['label'] = $Label }
    if ($Widget) { $input['widget'] = [ordered]@{ name = $Name } }
    if ($Optional) { $input['shape'] = 7 }
    return $input
}

function New-Output([string]$Name, [string]$Type, [string]$Label = '') {
    $output = [ordered]@{ localized_name = $Name; name = $Name; type = $Type; links = @() }
    if ($Label) { $output['label'] = $Label }
    return $output
}

function New-Node(
    [int]$Id,
    [string]$Type,
    [double]$X,
    [double]$Y,
    [double]$Width,
    [double]$Height,
    [object[]]$Inputs = @(),
    [object[]]$Outputs = @(),
    [object[]]$Widgets = @(),
    [hashtable]$Properties = $null,
    [string]$Title = '',
    [hashtable]$Flags = $null,
    [int]$Mode = 0,
    [string]$Color = '',
    [string]$BackgroundColor = ''
) {
    if ($null -eq $Properties) { $Properties = [ordered]@{} }
    if (-not $Properties.Contains('Node name for S&R')) { $Properties['Node name for S&R'] = $Type }
    if ($null -eq $Flags) { $Flags = [ordered]@{} }
    $node = [ordered]@{
        id = $Id
        type = $Type
        pos = @($X, $Y)
        size = @($Width, $Height)
        flags = $Flags
        order = $Id - 1
        mode = $Mode
        inputs = $Inputs
        outputs = $Outputs
        properties = $Properties
        widgets_values = $Widgets
    }
    if ($Title) { $node['title'] = $Title }
    if ($Color) { $node['color'] = $Color }
    if ($BackgroundColor) { $node['bgcolor'] = $BackgroundColor }
    return $node
}

function New-Preview([int]$Id, [double]$X, [double]$Y, [double]$Width = 430, [double]$Height = 360) {
    return New-Node $Id 'PreviewImage' $X $Y $Width $Height @(
        (New-Input 'images' 'IMAGE')
    ) @((New-Output 'images' 'IMAGE'))
}

function New-MaskToImage([int]$Id, [double]$X, [double]$Y) {
    return New-Node $Id 'MaskToImage' $X $Y 240 70 @((New-Input 'mask' 'MASK')) @((New-Output 'IMAGE' 'IMAGE'))
}

function New-ImageToMask([int]$Id, [double]$X, [double]$Y) {
    return New-Node $Id 'ImageToMask' $X $Y 270 85 @(
        (New-Input 'image' 'IMAGE'),
        (New-Input 'channel' 'COMBO' $true)
    ) @((New-Output 'MASK' 'MASK')) @('red')
}

function New-LazySwitch([int]$Id, [double]$X, [double]$Y) {
    return New-Node $Id 'LazyImageStageSwitch' $X $Y 340 150 @(
        (New-Input 'enabled' 'BOOLEAN' $true),
        (New-Input 'bypass_image' 'IMAGE' $false $false),
        (New-Input 'processed_image' 'IMAGE' $false $false)
    ) @((New-Output 'image' 'IMAGE')) @($true)
}

function New-GPTImage([int]$Id, [double]$X, [double]$Y, [int]$ImageCount) {
    $inputs = @(
        (New-Input 'prompt' 'STRING' $true),
        (New-Input 'model' 'COMFY_DYNAMICCOMBO_V3' $true),
        (New-Input 'model.size' 'COMBO' $true),
        (New-Input 'model.custom_width' 'INT' $true),
        (New-Input 'model.custom_height' 'INT' $true),
        (New-Input 'model.background' 'COMBO' $true),
        (New-Input 'model.quality' 'COMBO' $true)
    )
    foreach ($index in 1..$ImageCount) {
        $name = "model.images.image_$index"
        $inputs += ,(New-Input $name 'IMAGE' $false $true "image_$index")
    }
    $inputs += ,(New-Input 'model.mask' 'MASK' $false $true 'mask')
    $inputs += ,(New-Input 'n' 'INT' $true)
    $inputs += ,(New-Input 'seed' 'INT' $true)
    return New-Node $Id 'OpenAIGPTImageNodeV2' $X $Y 420 485 $inputs @(
        (New-Output 'IMAGE' 'IMAGE')
    ) @('', 'gpt-image-2', 'auto', 1024, 1024, 'auto', 'medium', 1, 0, 'randomize') $null '' $null 0 '#432' '#653'
}

function New-ImageReel([int]$Id, [double]$X, [double]$Y, [string[]]$Labels) {
    return New-Node $Id 'LayerUtility: ImageReel' $X $Y 300 360 @(
        (New-Input 'image1' 'IMAGE' $false $false 'image1'),
        (New-Input 'image2' 'IMAGE' $false $true 'image2'),
        (New-Input 'image3' 'IMAGE' $false $true 'image3'),
        (New-Input 'image4' 'IMAGE' $false $true 'image4'),
        (New-Input 'image1_text' 'STRING' $true $false 'image1_text'),
        (New-Input 'image2_text' 'STRING' $true $false 'image2_text'),
        (New-Input 'image3_text' 'STRING' $true $false 'image3_text'),
        (New-Input 'image4_text' 'STRING' $true $false 'image4_text'),
        (New-Input 'reel_height' 'INT' $true $false 'reel_height'),
        (New-Input 'border' 'INT' $true $false 'border')
    ) @((New-Output 'reel' 'Reel' 'reel')) @($Labels[0], $Labels[1], $Labels[2], $Labels[3], 900, 48) ([ordered]@{
        'Node name for S&R' = 'LayerUtility: ImageReel'
        cnr_id = 'comfyui_layerstyle'
    }) '' $null 0 '#322' '#533'
}

function New-ImageReelComposite([int]$Id, [double]$X, [double]$Y) {
    return New-Node $Id 'LayerUtility: ImageReelComposit' $X $Y 300 290 @(
        (New-Input 'reel_1' 'Reel' $false $false 'reel_1'),
        (New-Input 'reel_2' 'Reel' $false $true 'reel_2'),
        (New-Input 'reel_3' 'Reel' $false $true 'reel_3'),
        (New-Input 'reel_4' 'Reel' $false $true 'reel_4'),
        (New-Input 'font_file' 'COMBO' $true $false 'font_file'),
        (New-Input 'font_size' 'INT' $true $false 'font_size'),
        (New-Input 'border' 'INT' $true $false 'border'),
        (New-Input 'color_theme' 'COMBO' $true $false 'color_theme')
    ) @((New-Output 'image1' 'IMAGE' 'image1')) @('Alibaba-PuHuiTi-Heavy.ttf', 34, 48, 'light') ([ordered]@{
        'Node name for S&R' = 'LayerUtility: ImageReelComposit'
        cnr_id = 'comfyui_layerstyle'
    }) '' $null 0 '#322' '#533'
}

$nodes = [System.Collections.ArrayList]::new()
$links = [System.Collections.ArrayList]::new()
function Add-Node($Node) { [void]$nodes.Add($Node) }
function Get-Node([int]$Id) { return $nodes | Where-Object { [int]$_['id'] -eq $Id } | Select-Object -First 1 }
function Find-Slot($Slots, [string]$Name) {
    for ($index = 0; $index -lt $Slots.Count; $index++) {
        if ([string]$Slots[$index]['name'] -eq $Name) { return $index }
    }
    throw "Slot '$Name' not found."
}
$nextLinkId = 0
function Connect([int]$FromId, [string]$FromOutput, [int]$ToId, [string]$ToInput, [string]$Type) {
    $from = Get-Node $FromId
    $to = Get-Node $ToId
    if (-not $from -or -not $to) { throw "Cannot connect missing node $FromId -> $ToId" }
    $originSlot = Find-Slot $from['outputs'] $FromOutput
    $targetSlot = Find-Slot $to['inputs'] $ToInput
    $script:nextLinkId++
    $linkId = $script:nextLinkId
    $to['inputs'][$targetSlot]['link'] = $linkId
    $existing = @($from['outputs'][$originSlot]['links'])
    $from['outputs'][$originSlot]['links'] = @($existing + $linkId)
    [void]$links.Add([object[]]@($linkId, $FromId, $originSlot, $ToId, $targetSlot, $Type))
}

$controlItems = @(
    [ordered]@{ id = 'use-material'; label = '使用全局材质'; value = $true; parent_id = $null },
    [ordered]@{ id = 'use-height'; label = '使用高度图'; value = $true; parent_id = $null },
    [ordered]@{ id = 'local-edit'; label = '执行局部修改'; value = $false; parent_id = $null },
    [ordered]@{ id = 'post-process'; label = '执行最终展示后处理'; value = $false; parent_id = $null },
    [ordered]@{ id = 'transparent-master'; label = '输出正视透明母版'; value = $true; parent_id = $null },
    [ordered]@{ id = 'rmbg-preview'; label = '生成展示图透明预览（非确定性）'; value = $false; parent_id = $null },
    [ordered]@{ id = 'save-state'; label = '保存完整编辑状态包'; value = $false; parent_id = $null },
    [ordered]@{ id = 'allow-full-mask'; label = '专家：允许全遮罩编辑'; value = $false; parent_id = $null }
)
$controlJson = $controlItems | ConvertTo-Json -Compress -Depth 10
$noteText = @'
## #8.2 徽章工作流

1. **输入节点**只在 `[Input]` 分区：平面图与层次 ID 图必须来自同一裁剪框。
2. 平面图是颜色、文字、结构与局部取色的唯一基准；层次图只表达高度与 Cut Out。
3. 基础 GPT 仅生成正视中性母版，配准通过后才可局部编辑。
4. 局部 GPT 只生成候选；`Badge Deterministic Composite` 保证遮罩外像素不变。
5. 展示光影、景深和特写只在最终后处理分区加入。
6. ImageReel 已按阶段标注采样图名。默认关闭局部编辑、展示后处理、RMBG 和状态保存，避免无意 API 调用或写盘。
'@
Add-Node (New-Node 1 'MarkdownNote' 60 60 440 590 @() @() @($noteText) ([ordered]@{
    'Node name for S&R' = 'MarkdownNote'; text = $noteText
}) '使用说明')
$controlOutputs = foreach ($item in $controlItems) { New-Output $item.label 'BOOLEAN' $item.label }
Add-Node (New-Node 2 'BooleanListHierarchy' 600 60 430 570 @(
    (New-Input 'config_json' 'STRING' $true $true)
) $controlOutputs @($controlJson) ([ordered]@{
    'Node name for S&R' = 'BooleanListHierarchy'
    boolean_list_width = 430
    boolean_list_count = $controlItems.Count
    boolean_list_items = $controlJson
}) '[Control] Boolean List Hierarchy')

$controllerTargets = @(
    @(3, 0, 2, $false),
    @(4, 1, 3, $false),
    @(5, 2, 6, $false),
    @(6, 2, 7, $false),
    @(7, 2, 8, $false),
    @(8, 2, 9, $false),
    @(9, 3, 10, $false)
)
foreach ($entry in $controllerTargets) {
    $id = [int]$entry[0]
    $index = [int]$entry[1]
    $target = [int]$entry[2]
    $x = 60 + ((($id - 3) % 2) * 490)
    $y = 700 + ([math]::Floor(($id - 3) / 2) * 150)
    Add-Node (New-Node $id 'BooleanGroupBypassController' $x $y 390 115 @(
        (New-Input 'boolean' 'BOOLEAN')
    ) @() @() ([ordered]@{
        'Node name for S&R' = 'BooleanGroupBypassController'
        target_group_id = [string]$target
        invert = [bool]$entry[3]
    }))
    Connect 2 $controlItems[$index].label $id 'boolean' 'BOOLEAN'
}

Add-Node (New-Node 11 'AppModeLoadImage' 1460 60 470 500 @(
    (New-Input 'image' 'COMBO' $true $false '上传徽章平面图'),
    (New-Input 'upload' 'IMAGEUPLOAD' $true)
) @((New-Output 'IMAGE' 'IMAGE'), (New-Output 'MASK' 'MASK')) @('Badge_8_2/badge_flat.png', 'image'))
Add-Node (New-Node 12 'AppModeLoadImage' 2030 60 470 500 @(
    (New-Input 'image' 'COMBO' $true $false '上传徽章层次 ID 图'),
    (New-Input 'upload' 'IMAGEUPLOAD' $true)
) @((New-Output 'IMAGE' 'IMAGE'), (New-Output 'MASK' 'MASK')) @('Badge_8_2/badge_height_id.png', 'image'))
Add-Node (New-Node 13 'BadgeDesignCanvas' 1460 650 470 520 @(
    (New-Input 'images' 'IMAGE'),
    (New-Input 'canvas_width' 'INT' $true),
    (New-Input 'canvas_height' 'INT' $true),
    (New-Input 'image_resampling' 'COMBO' $true),
    (New-Input 'foreground_source' 'COMBO' $true),
    (New-Input 'background_color' 'STRING' $true),
    (New-Input 'cutout_color' 'STRING' $true),
    (New-Input 'color_tolerance' 'INT' $true),
    (New-Input 'alpha_mask' 'MASK' $false $true)
) @(
    (New-Output 'normalized_flat_image' 'IMAGE'),
    (New-Output 'design_foreground_mask' 'MASK'),
    (New-Output 'width' 'INT'),
    (New-Output 'height' 'INT'),
    (New-Output 'diagnostic' 'STRING')
) @(1024, 1024, 'bicubic', 'Load Image alpha', '#ffffff', '#ff00ff', 8))
Add-Node (New-Node 14 'ImageScale' 2030 650 330 235 @(
    (New-Input 'image' 'IMAGE'),
    (New-Input 'upscale_method' 'COMBO' $true),
    (New-Input 'width' 'INT' $true),
    (New-Input 'height' 'INT' $true),
    (New-Input 'crop' 'COMBO' $true)
) @((New-Output 'IMAGE' 'IMAGE')) @('nearest-exact', 1024, 1024, 'disabled'))
Add-Node (New-Preview 15 2600 60 440 500)
Add-Node (New-Preview 16 2600 620 440 500)
Add-Node (New-MaskToImage 17 2030 950)
Add-Node (New-Preview 18 2600 1160 440 180)

Add-Node (New-Node 19 'GPTImage2MaterialPrompt' 3460 60 470 560 @(
    (New-Input 'material_id' 'COMBO' $true),
    (New-Input 'material_color' 'STRING' $true),
    (New-Input 'base_prompt' 'STRING' $true),
    (New-Input 'additional_details' 'STRING' $true)
) @(
    (New-Output 'prompt' 'STRING'),
    (New-Output 'material_semantics' 'STRING'),
    (New-Output 'preview_image' 'IMAGE'),
    (New-Output 'selected_color' 'STRING')
) @('亚金', 'auto', '将所选材质作为徽章的全局制造材质语义，不改变设计结构。', '保持文字、图案、颜色分区与高度关系。') ([ordered]@{
    'Node name for S&R' = 'GPTImage2MaterialPrompt'; gpt_image2_material_id = 'satin_gold'
}))
Add-Node (New-Preview 20 4030 60 510 500)

$heightConfig = [ordered]@{
    version = 1
    groups = @(
        [ordered]@{ enabled = $true; color = '#ff00ff'; threshold = 0; layer = 0 },
        [ordered]@{ enabled = $true; color = '#e8f0ec'; threshold = 0; layer = 1 },
        [ordered]@{ enabled = $true; color = '#ffffff'; threshold = 0; layer = 1 },
        [ordered]@{ enabled = $true; color = '#12978b'; threshold = 0; layer = 2 },
        [ordered]@{ enabled = $true; color = '#004d43'; threshold = 0; layer = 3 },
        [ordered]@{ enabled = $true; color = '#b9ccc4'; threshold = 0; layer = 3 },
        [ordered]@{ enabled = $true; color = '#163029'; threshold = 0; layer = 4 },
        [ordered]@{ enabled = $true; color = '#dfbd9b'; threshold = 0; layer = 5 }
    )
} | ConvertTo-Json -Compress -Depth 10
Add-Node (New-Node 21 'DAELabBadgeHeightLayer' 4960 60 430 590 @(
    (New-Input 'images' 'IMAGE')
) @(
    (New-Output 'height_mask' 'MASK'),
    (New-Output 'height_image' 'IMAGE'),
    (New-Output 'unmatched_mask' 'MASK'),
    (New-Output 'height_profile' 'BADGE_HEIGHT_PROFILE')
) @() ([ordered]@{
    'Node name for S&R' = 'DAELabBadgeHeightLayer'; badge_height_layer_config = $heightConfig
}))
Add-Node (New-Preview 22 5490 60 450 440)
Add-Node (New-MaskToImage 23 4960 720)
Add-Node (New-Preview 24 5490 560 450 440)
Add-Node (New-ImageReel 25 6040 60 @('01 平面设计基准', '02 层次 ID 图', '03 离散高度图', '04 前景拓扑'))
Add-Node (New-ImageReelComposite 26 6040 480)
Add-Node (New-Preview 27 6040 830 500 580)

Add-Node (New-Node 28 'BadgeRenderPromptBuilder' 6960 60 520 480 @(
    (New-Input 'use_material' 'BOOLEAN' $true),
    (New-Input 'use_height' 'BOOLEAN' $true),
    (New-Input 'unmatched_limit_percent' 'FLOAT' $true),
    (New-Input 'user_prompt' 'STRING' $true),
    (New-Input 'material_semantics_input' 'STRING' $false $true),
    (New-Input 'unmatched_mask' 'MASK' $false $true),
    (New-Input 'design_foreground_mask' 'MASK' $false $true)
) @(
    (New-Output 'prompt' 'STRING'),
    (New-Output 'structure_constraints' 'STRING'),
    (New-Output 'material_semantics' 'STRING'),
    (New-Output 'height_semantics' 'STRING')
) @($true, $true, 0.5, '制造为真实珐琅金属徽章；保持原始中文、数字、图案与色彩分区。'))
Add-Node (New-Node 29 'PreviewAny' 7580 60 650 450 @(
    (New-Input 'source' '*')
) @((New-Output 'STRING' 'STRING')))
Add-Node (New-Node 30 'GPTImage2Config' 6960 620 340 250 @(
    (New-Input 'size' 'COMBO' $true),
    (New-Input 'background' 'COMBO' $true),
    (New-Input 'quality' 'COMBO' $true)
) @(
    (New-Output 'size' 'COMBO'),
    (New-Output 'background' 'COMBO'),
    (New-Output 'quality' 'COMBO')
) @('1024x1024', 'opaque', 'medium'))
Add-Node (New-Node 91 'BadgeHeightEstablishPromptBuilder' 7580 560 620 260 @(
    (New-Input 'height_profile' 'BADGE_HEIGHT_PROFILE')
) @(
    (New-Output 'prompt' 'STRING'),
    (New-Output 'height_report' 'STRING')
))

Add-Node (New-GPTImage 31 8660 60 2)
Add-Node (New-GPTImage 32 8660 600 2)
Add-Node (New-LazySwitch 33 9180 300)
Add-Node (New-Node 34 'BadgeMasterRegistration' 9620 300 540 500 @(
    (New-Input 'design_image' 'IMAGE'),
    (New-Input 'design_foreground_mask' 'MASK'),
    (New-Input 'candidate_image' 'IMAGE'),
    (New-Input 'minimum_iou' 'FLOAT' $true),
    (New-Input 'max_rotation_degrees' 'FLOAT' $true),
    (New-Input 'max_scale_delta' 'FLOAT' $true),
    (New-Input 'background_tolerance' 'FLOAT' $true),
    (New-Input 'enforce_threshold' 'BOOLEAN' $true),
    (New-Input 'candidate_foreground_mask' 'MASK' $false $true)
) @(
    (New-Output 'base_render' 'IMAGE'),
    (New-Output 'transform' 'STRING'),
    (New-Output 'contour_iou' 'FLOAT'),
    (New-Output 'boundary_error' 'FLOAT'),
    (New-Output 'diagnostic' 'IMAGE'),
    (New-Output 'registration_valid' 'BOOLEAN')
) @(0.97, 3.0, 0.10, 0.08, $true))
Add-Node (New-Preview 35 10260 60 280 400)
Add-Node (New-Preview 36 10260 560 280 390)
Add-Node (New-ImageReel 37 9180 1050 @('05 全局材质预览', '06 基础 GPT 候选', '07 配准正视母版', '08 配准叠加诊断'))
Add-Node (New-ImageReelComposite 38 9580 1050)
Add-Node (New-Preview 39 9980 1050 560 430)

$maskConfig = [ordered]@{
    version = 1
    groups = @([ordered]@{ enabled = $true; color = '#12978b'; threshold = 18; invert = $false })
    output = 'combined_mask'
} | ConvertTo-Json -Compress -Depth 10
Add-Node (New-Node 40 'DAELabMultiColorMask' 10960 60 430 520 @(
    (New-Input 'images' 'IMAGE')
) @((New-Output 'mask' 'MASK' 'combined_mask')) @() ([ordered]@{
    'Node name for S&R' = 'DAELabMultiColorMask'; multi_color_mask_config = $maskConfig; multi_color_mask_width = 430
}))
Add-Node (New-Node 41 'BadgeEditMaskValidator' 11500 60 520 500 @(
    (New-Input 'edit_mask_flat' 'MASK'),
    (New-Input 'design_foreground_mask' 'MASK'),
    (New-Input 'base_render' 'IMAGE'),
    (New-Input 'registration_iou' 'FLOAT' $true),
    (New-Input 'minimum_registration_iou' 'FLOAT' $true),
    (New-Input 'allow_full_mask' 'BOOLEAN' $true),
    (New-Input 'full_mask_threshold' 'FLOAT' $true)
) @(
    (New-Output 'edit_mask' 'MASK'),
    (New-Output 'should_edit' 'BOOLEAN'),
    (New-Output 'coverage' 'FLOAT'),
    (New-Output 'bounding_box' 'STRING'),
    (New-Output 'validation_status' 'STRING'),
    (New-Output 'diagnostic' 'IMAGE')
) @(1.0, 0.97, $false, 0.995))
Add-Node (New-Node 42 'MaskPreview+' 12120 60 430 360 @(
    (New-Input 'mask' 'MASK')
) @((New-Output 'images' 'IMAGE')))
Add-Node (New-Preview 43 12120 500 760 560)
Add-Node (New-LazySwitch 44 12500 1140)

Add-Node (New-Node 45 'GPTImage2MaterialPrompt' 13360 60 470 560 @(
    (New-Input 'material_id' 'COMBO' $true),
    (New-Input 'material_color' 'STRING' $true),
    (New-Input 'base_prompt' 'STRING' $true),
    (New-Input 'additional_details' 'STRING' $true)
) @(
    (New-Output 'prompt' 'STRING'),
    (New-Output 'material_semantics' 'STRING'),
    (New-Output 'preview_image' 'IMAGE'),
    (New-Output 'selected_color' 'STRING')
) @('烤漆', '#C62828', '仅为局部操作提供材质与颜色参数。', '不改变遮罩外内容。') ([ordered]@{
    'Node name for S&R' = 'GPTImage2MaterialPrompt'; gpt_image2_material_id = 'baked_enamel'
}))
Add-Node (New-Node 47 'BadgeLocalEditPromptBuilder' 13940 60 520 520 @(
    (New-Input 'operation_type' 'COMBO' $true),
    (New-Input 'user_prompt' 'STRING' $true),
    (New-Input 'target_color' 'STRING' $true),
    (New-Input 'target_layer' 'COMBO' $true),
    (New-Input 'height_enabled' 'BOOLEAN' $true),
    (New-Input 'material_semantics' 'STRING' $false $true)
) @(
    (New-Output 'prompt' 'STRING'),
    (New-Output 'apply_height_patch' 'BOOLEAN'),
    (New-Output 'target_layer_value' 'BADGE_HEIGHT_LAYER'),
    (New-Output 'operation_summary' 'STRING')
) @('color', '仅优化遮罩内对象，不改变文字和结构。', '#C62828', 'Layer 3 (0.6)', $true))
Add-Node (New-Preview 46 13360 700 470 420)
Add-Node (New-Node 48 'PreviewAny' 13940 700 710 420 @(
    (New-Input 'source' '*')
) @((New-Output 'STRING' 'STRING')))

Add-Node (New-Node 49 'BadgeHeightPatch' 15160 60 500 460 @(
    (New-Input 'current_height' 'MASK'),
    (New-Input 'current_foreground_mask' 'MASK'),
    (New-Input 'edit_mask' 'MASK'),
    (New-Input 'apply_patch' 'BOOLEAN' $true),
    (New-Input 'target_layer' 'BADGE_HEIGHT_LAYER')
) @(
    (New-Output 'patched_height' 'MASK'),
    (New-Output 'patched_height_image' 'IMAGE'),
    (New-Output 'patched_foreground_mask' 'MASK'),
    (New-Output 'change_preview' 'IMAGE'),
    (New-Output 'difference_report' 'STRING')
) @($false))
Add-Node (New-Preview 50 15760 60 430 360)
Add-Node (New-Preview 51 15760 520 430 360)
Add-Node (New-MaskToImage 53 15160 950)
Add-Node (New-LazySwitch 54 15500 950)
Add-Node (New-LazySwitch 55 15940 950)
Add-Node (New-Node 56 'ImageToMask' 16380 980 260 85 @(
    (New-Input 'image' 'IMAGE'),
    (New-Input 'channel' 'COMBO' $true)
) @((New-Output 'MASK' 'MASK')) @('red'))
Add-Node (New-LazySwitch 57 15160 1200)
Add-Node (New-LazySwitch 58 15600 1200)
Add-Node (New-ImageToMask 59 16040 1230)

Add-Node (New-GPTImage 60 17060 60 3)
Add-Node (New-GPTImage 61 17060 600 3)
Add-Node (New-LazySwitch 62 17580 300)
Add-Node (New-Node 63 'BadgeDeterministicComposite' 18020 300 520 420 @(
    (New-Input 'previous_master' 'IMAGE'),
    (New-Input 'edit_candidate' 'IMAGE'),
    (New-Input 'edit_mask' 'MASK')
) @(
    (New-Output 'edited_master' 'IMAGE'),
    (New-Output 'outside_max_diff' 'FLOAT'),
    (New-Output 'outside_mean_diff' 'FLOAT'),
    (New-Output 'boundary_diagnostic' 'IMAGE'),
    (New-Output 'report' 'STRING')
))
Add-Node (New-LazySwitch 64 18640 60)
Add-Node (New-LazySwitch 65 18640 290)
Add-Node (New-LazySwitch 66 18020 800)
Add-Node (New-LazySwitch 67 18460 800)
Add-Node (New-ImageReel 70 17060 1165 @('09 编辑遮罩诊断', '10 局部 GPT 候选', '11 高度与拓扑修补', '12 确定性当前母版'))
Add-Node (New-ImageReelComposite 71 17460 1165)
Add-Node (New-Preview 72 17860 1165 1340 535)

Add-Node (New-Node 73 'BadgePresentationPromptBuilder' 19660 60 520 350 @(
    (New-Input 'presentation_direction' 'STRING' $true)
) @((New-Output 'prompt' 'STRING')) @('高端徽章影棚产品摄影，轻微微距，克制景深，深色高级背景，真实接触阴影。'))
Add-Node (New-GPTImage 74 20280 60 1)
Add-Node (New-LazySwitch 75 20800 60)
Add-Node (New-Preview 76 20730 650 560 620)

Add-Node (New-Node 77 'InvertMask' 21760 60 270 70 @(
    (New-Input 'mask' 'MASK')
) @((New-Output 'MASK' 'MASK')))
Add-Node (New-Node 78 'JoinImageWithAlpha' 22130 60 310 90 @(
    (New-Input 'image' 'IMAGE'),
    (New-Input 'alpha' 'MASK')
) @((New-Output 'IMAGE' 'IMAGE')))
Add-Node (New-LazySwitch 79 22540 60)
Add-Node (New-Preview 80 22980 60 360 360)
Add-Node (New-Node 81 'RMBGConfig' 21760 230 310 190 @(
    (New-Input 'background' 'COMBO' $true),
    (New-Input 'background_color' 'COLORCODE' $true)
) @(
    (New-Output 'background' '*'),
    (New-Output 'background_color' 'COLORCODE')
) @('Alpha', '#000000'))
Add-Node (New-Node 82 'RMBG' 21760 480 340 430 @(
    (New-Input 'image' 'IMAGE'),
    (New-Input 'model' 'COMBO' $true),
    (New-Input 'sensitivity' 'FLOAT' $true $true),
    (New-Input 'process_res' 'INT' $true $true),
    (New-Input 'mask_blur' 'INT' $true $true),
    (New-Input 'mask_offset' 'INT' $true $true),
    (New-Input 'invert_output' 'BOOLEAN' $true $true),
    (New-Input 'refine_foreground' 'BOOLEAN' $true $true),
    (New-Input 'background' 'COMBO' $true $true),
    (New-Input 'background_color' 'COLORCODE' $true $true)
) @(
    (New-Output 'IMAGE' 'IMAGE'),
    (New-Output 'MASK' 'MASK'),
    (New-Output 'MASK_IMAGE' 'IMAGE')
) @('RMBG-2.0', 1.0, 1024, 0, 0, $false, $false, 'Alpha', '#000000') $null '' $null 0 '#222e40' '#364254')
Add-Node (New-LazySwitch 83 22200 480)
Add-Node (New-Preview 84 22640 480 700 430)
Add-Node (New-Node 85 'SaveImage' 21760 980 460 430 @(
    (New-Input 'images' 'IMAGE'),
    (New-Input 'filename_prefix' 'STRING' $true)
) @((New-Output 'images' 'IMAGE')) @('Badge_8_2/final'))
Add-Node (New-Node 86 'SaveImage' 22320 980 460 430 @(
    (New-Input 'images' 'IMAGE'),
    (New-Input 'filename_prefix' 'STRING' $true)
) @((New-Output 'images' 'IMAGE')) @('Badge_8_2/transparent_master'))
Add-Node (New-Node 87 'BadgeEditStateSave' 22880 980 460 430 @(
    (New-Input 'current_master' 'IMAGE'),
    (New-Input 'normalized_flat_image' 'IMAGE'),
    (New-Input 'current_foreground_mask' 'MASK'),
    (New-Input 'height_enabled' 'BOOLEAN' $true),
    (New-Input 'registration_info' 'STRING' $true),
    (New-Input 'current_prompt' 'STRING' $true),
    (New-Input 'enabled' 'BOOLEAN' $true),
    (New-Input 'filename_prefix' 'STRING' $true),
    (New-Input 'current_height' 'MASK' $false $true)
) @(
    (New-Output 'state_path' 'STRING'),
    (New-Output 'report' 'STRING')
) @($true, '', '', $false, 'Badge_8_2/state'))
Add-Node (New-ImageReel 88 21760 1490 @('13 当前编辑母版', '14 正视透明母版', '15 最终展示图', '16 RMBG 透明预览'))
Add-Node (New-ImageReelComposite 89 22160 1490)
Add-Node (New-Preview 90 22560 1490 780 600)

# Data flow connections.
Connect 11 'IMAGE' 13 'images' 'IMAGE'
Connect 11 'MASK' 13 'alpha_mask' 'MASK'
Connect 12 'IMAGE' 14 'image' 'IMAGE'
Connect 13 'width' 14 'width' 'INT'
Connect 13 'height' 14 'height' 'INT'
Connect 13 'normalized_flat_image' 15 'images' 'IMAGE'
Connect 14 'IMAGE' 16 'images' 'IMAGE'
Connect 13 'design_foreground_mask' 17 'mask' 'MASK'
Connect 17 'IMAGE' 18 'images' 'IMAGE'
Connect 19 'preview_image' 20 'images' 'IMAGE'
Connect 14 'IMAGE' 21 'images' 'IMAGE'
Connect 21 'height_image' 22 'images' 'IMAGE'
Connect 21 'unmatched_mask' 23 'mask' 'MASK'
Connect 23 'IMAGE' 24 'images' 'IMAGE'
Connect 13 'normalized_flat_image' 25 'image1' 'IMAGE'
Connect 14 'IMAGE' 25 'image2' 'IMAGE'
Connect 21 'height_image' 25 'image3' 'IMAGE'
Connect 17 'IMAGE' 25 'image4' 'IMAGE'
Connect 25 'reel' 26 'reel_1' 'Reel'
Connect 26 'image1' 27 'images' 'IMAGE'

Connect 2 $controlItems[0].label 28 'use_material' 'BOOLEAN'
Connect 2 $controlItems[1].label 28 'use_height' 'BOOLEAN'
Connect 19 'material_semantics' 28 'material_semantics_input' 'STRING'
Connect 21 'unmatched_mask' 28 'unmatched_mask' 'MASK'
Connect 13 'design_foreground_mask' 28 'design_foreground_mask' 'MASK'
Connect 28 'prompt' 29 'source' 'STRING'
Connect 21 'height_profile' 91 'height_profile' 'BADGE_HEIGHT_PROFILE'

foreach ($gpt in 31, 32, 60, 61, 74) {
    Connect 30 'size' $gpt 'model.size' 'COMBO'
    Connect 30 'background' $gpt 'model.background' 'COMBO'
    Connect 30 'quality' $gpt 'model.quality' 'COMBO'
}
Connect 28 'prompt' 31 'prompt' 'STRING'
Connect 91 'prompt' 32 'prompt' 'STRING'
Connect 13 'normalized_flat_image' 31 'model.images.image_1' 'IMAGE'
Connect 13 'normalized_flat_image' 32 'model.images.image_1' 'IMAGE'
Connect 21 'height_image' 32 'model.images.image_2' 'IMAGE'
Connect 2 $controlItems[1].label 33 'enabled' 'BOOLEAN'
Connect 31 'IMAGE' 33 'bypass_image' 'IMAGE'
Connect 32 'IMAGE' 33 'processed_image' 'IMAGE'
Connect 13 'normalized_flat_image' 34 'design_image' 'IMAGE'
Connect 13 'design_foreground_mask' 34 'design_foreground_mask' 'MASK'
Connect 33 'image' 34 'candidate_image' 'IMAGE'
Connect 34 'base_render' 35 'images' 'IMAGE'
Connect 34 'diagnostic' 36 'images' 'IMAGE'
Connect 19 'preview_image' 37 'image1' 'IMAGE'
Connect 33 'image' 37 'image2' 'IMAGE'
Connect 34 'base_render' 37 'image3' 'IMAGE'
Connect 34 'diagnostic' 37 'image4' 'IMAGE'
Connect 37 'reel' 38 'reel_1' 'Reel'
Connect 38 'image1' 39 'images' 'IMAGE'

Connect 13 'normalized_flat_image' 40 'images' 'IMAGE'
Connect 40 'mask' 41 'edit_mask_flat' 'MASK'
Connect 13 'design_foreground_mask' 41 'design_foreground_mask' 'MASK'
Connect 34 'base_render' 41 'base_render' 'IMAGE'
Connect 34 'contour_iou' 41 'registration_iou' 'FLOAT'
Connect 2 $controlItems[7].label 41 'allow_full_mask' 'BOOLEAN'
Connect 41 'edit_mask' 42 'mask' 'MASK'
Connect 41 'diagnostic' 43 'images' 'IMAGE'
Connect 2 $controlItems[2].label 44 'enabled' 'BOOLEAN'
Connect 34 'diagnostic' 44 'bypass_image' 'IMAGE'
Connect 41 'diagnostic' 44 'processed_image' 'IMAGE'

Connect 45 'preview_image' 46 'images' 'IMAGE'
Connect 45 'selected_color' 47 'target_color' 'STRING'
Connect 2 $controlItems[1].label 47 'height_enabled' 'BOOLEAN'
Connect 45 'material_semantics' 47 'material_semantics' 'STRING'
Connect 47 'prompt' 48 'source' 'STRING'
Connect 21 'height_mask' 49 'current_height' 'MASK'
Connect 13 'design_foreground_mask' 49 'current_foreground_mask' 'MASK'
Connect 41 'edit_mask' 49 'edit_mask' 'MASK'
Connect 47 'apply_height_patch' 49 'apply_patch' 'BOOLEAN'
Connect 47 'target_layer_value' 49 'target_layer' 'BADGE_HEIGHT_LAYER'
Connect 49 'patched_height_image' 50 'images' 'IMAGE'
Connect 49 'change_preview' 51 'images' 'IMAGE'
Connect 49 'patched_foreground_mask' 53 'mask' 'MASK'

# Current foreground and height are lazily routed so disabling local edit does
# not evaluate its validator, patcher, or GPT branches.
Connect 41 'should_edit' 54 'enabled' 'BOOLEAN'
Connect 17 'IMAGE' 54 'bypass_image' 'IMAGE'
Connect 53 'IMAGE' 54 'processed_image' 'IMAGE'
Connect 2 $controlItems[2].label 55 'enabled' 'BOOLEAN'
Connect 17 'IMAGE' 55 'bypass_image' 'IMAGE'
Connect 54 'image' 55 'processed_image' 'IMAGE'
Connect 55 'image' 56 'image' 'IMAGE'
Connect 41 'should_edit' 57 'enabled' 'BOOLEAN'
Connect 21 'height_image' 57 'bypass_image' 'IMAGE'
Connect 49 'patched_height_image' 57 'processed_image' 'IMAGE'
Connect 2 $controlItems[2].label 58 'enabled' 'BOOLEAN'
Connect 21 'height_image' 58 'bypass_image' 'IMAGE'
Connect 57 'image' 58 'processed_image' 'IMAGE'
Connect 58 'image' 59 'image' 'IMAGE'

Connect 47 'prompt' 60 'prompt' 'STRING'
Connect 47 'prompt' 61 'prompt' 'STRING'
Connect 34 'base_render' 60 'model.images.image_1' 'IMAGE'
Connect 13 'normalized_flat_image' 60 'model.images.image_2' 'IMAGE'
Connect 34 'base_render' 61 'model.images.image_1' 'IMAGE'
Connect 13 'normalized_flat_image' 61 'model.images.image_2' 'IMAGE'
Connect 49 'patched_height_image' 61 'model.images.image_3' 'IMAGE'
Connect 41 'edit_mask' 60 'model.mask' 'MASK'
Connect 41 'edit_mask' 61 'model.mask' 'MASK'
Connect 2 $controlItems[1].label 62 'enabled' 'BOOLEAN'
Connect 60 'IMAGE' 62 'bypass_image' 'IMAGE'
Connect 61 'IMAGE' 62 'processed_image' 'IMAGE'
Connect 34 'base_render' 63 'previous_master' 'IMAGE'
Connect 62 'image' 63 'edit_candidate' 'IMAGE'
Connect 41 'edit_mask' 63 'edit_mask' 'MASK'
Connect 41 'should_edit' 64 'enabled' 'BOOLEAN'
Connect 34 'base_render' 64 'bypass_image' 'IMAGE'
Connect 62 'image' 64 'processed_image' 'IMAGE'
Connect 2 $controlItems[2].label 65 'enabled' 'BOOLEAN'
Connect 34 'base_render' 65 'bypass_image' 'IMAGE'
Connect 64 'image' 65 'processed_image' 'IMAGE'
Connect 41 'should_edit' 66 'enabled' 'BOOLEAN'
Connect 34 'base_render' 66 'bypass_image' 'IMAGE'
Connect 63 'edited_master' 66 'processed_image' 'IMAGE'
Connect 2 $controlItems[2].label 67 'enabled' 'BOOLEAN'
Connect 34 'base_render' 67 'bypass_image' 'IMAGE'
Connect 66 'image' 67 'processed_image' 'IMAGE'
Connect 44 'image' 70 'image1' 'IMAGE'
Connect 65 'image' 70 'image2' 'IMAGE'
Connect 58 'image' 70 'image3' 'IMAGE'
Connect 67 'image' 70 'image4' 'IMAGE'
Connect 70 'reel' 71 'reel_1' 'Reel'
Connect 71 'image1' 72 'images' 'IMAGE'

Connect 73 'prompt' 74 'prompt' 'STRING'
Connect 67 'image' 74 'model.images.image_1' 'IMAGE'
Connect 2 $controlItems[3].label 75 'enabled' 'BOOLEAN'
Connect 67 'image' 75 'bypass_image' 'IMAGE'
Connect 74 'IMAGE' 75 'processed_image' 'IMAGE'
Connect 75 'image' 76 'images' 'IMAGE'

Connect 56 'MASK' 77 'mask' 'MASK'
Connect 67 'image' 78 'image' 'IMAGE'
Connect 77 'MASK' 78 'alpha' 'MASK'
Connect 2 $controlItems[4].label 79 'enabled' 'BOOLEAN'
Connect 67 'image' 79 'bypass_image' 'IMAGE'
Connect 78 'IMAGE' 79 'processed_image' 'IMAGE'
Connect 79 'image' 80 'images' 'IMAGE'
Connect 75 'image' 82 'image' 'IMAGE'
Connect 81 'background' 82 'background' '*'
Connect 81 'background_color' 82 'background_color' 'COLORCODE'
Connect 2 $controlItems[5].label 83 'enabled' 'BOOLEAN'
Connect 75 'image' 83 'bypass_image' 'IMAGE'
Connect 82 'IMAGE' 83 'processed_image' 'IMAGE'
Connect 83 'image' 84 'images' 'IMAGE'
Connect 75 'image' 85 'images' 'IMAGE'
Connect 79 'image' 86 'images' 'IMAGE'
Connect 67 'image' 87 'current_master' 'IMAGE'
Connect 13 'normalized_flat_image' 87 'normalized_flat_image' 'IMAGE'
Connect 56 'MASK' 87 'current_foreground_mask' 'MASK'
Connect 2 $controlItems[1].label 87 'height_enabled' 'BOOLEAN'
Connect 34 'transform' 87 'registration_info' 'STRING'
Connect 47 'prompt' 87 'current_prompt' 'STRING'
Connect 2 $controlItems[6].label 87 'enabled' 'BOOLEAN'
Connect 59 'MASK' 87 'current_height' 'MASK'
Connect 67 'image' 88 'image1' 'IMAGE'
Connect 79 'image' 88 'image2' 'IMAGE'
Connect 75 'image' 88 'image3' 'IMAGE'
Connect 83 'image' 88 'image4' 'IMAGE'
Connect 88 'reel' 89 'reel_1' 'Reel'
Connect 89 'image1' 90 'images' 'IMAGE'

$groups = @(
    [ordered]@{ id = 0; title = '[Control] 使用说明与总控'; bounding = @(0, 0, 1100, 1380); color = '#3f789e'; flags = [ordered]@{} },
    [ordered]@{ id = 1; title = '[Input] 徽章源图与设计坐标（输入节点）'; bounding = @(1400, 0, 1700, 1400); color = '#3f789e'; flags = [ordered]@{} },
    [ordered]@{ id = 2; title = '[Material] 材质与颜色'; bounding = @(3400, 0, 1200, 1000); color = '#76558f'; flags = [ordered]@{} },
    [ordered]@{ id = 3; title = '[Height] 高度与前景拓扑'; bounding = @(4900, 0, 1700, 1500); color = '#4f7f55'; flags = [ordered]@{} },
    [ordered]@{ id = 4; title = '[Prompt] 基础效果图约束'; bounding = @(6900, 0, 1400, 1100); color = '#76558f'; flags = [ordered]@{} },
    [ordered]@{ id = 5; title = '[Generate] 正视母版生成与配准'; bounding = @(8600, 0, 2000, 1600); color = '#55436f'; flags = [ordered]@{} },
    [ordered]@{ id = 6; title = '[Mask] 颜色选区与遮罩验证'; bounding = @(10900, 0, 2100, 1700); color = '#a06532'; flags = [ordered]@{} },
    [ordered]@{ id = 7; title = '[Edit] 局部修改参数'; bounding = @(13300, 0, 1500, 1600); color = '#a06532'; flags = [ordered]@{} },
    [ordered]@{ id = 8; title = '[Height Edit] 高度与拓扑修补'; bounding = @(15100, 0, 1600, 1500); color = '#4f7f55'; flags = [ordered]@{} },
    [ordered]@{ id = 9; title = '[Generate] 局部候选与确定性合成'; bounding = @(17000, 0, 2300, 1800); color = '#55436f'; flags = [ordered]@{} },
    [ordered]@{ id = 10; title = '[Post] 最终影棚与特写后处理'; bounding = @(19600, 0, 1800, 1500); color = '#9a7a32'; flags = [ordered]@{} },
    [ordered]@{ id = 11; title = '[Output] 预览、状态包与保存'; bounding = @(21700, 0, 1700, 2150); color = '#287f79'; flags = [ordered]@{} }
)

$workflow = [ordered]@{
    id = 'db604b4f-0fd9-4c94-8e7a-4862a3628200'
    revision = 0
    last_node_id = ($nodes | ForEach-Object { [int]$_['id'] } | Measure-Object -Maximum).Maximum
    last_link_id = $nextLinkId
    nodes = @($nodes)
    links = @($links)
    groups = $groups
    config = [ordered]@{}
    extra = [ordered]@{
        frontendVersion = '1.45.21'
        VHS_latentpreview = $false
        VHS_latentpreviewrate = 0
        VHS_MetadataImage = $true
        VHS_KeepIntermediate = $true
        ds = [ordered]@{ scale = 0.055; offset = @(-50, 80) }
    }
    version = 0.4
}

$workflow | ConvertTo-Json -Depth 60 -Compress | Set-Content -LiteralPath $workflowPath -Encoding utf8NoBOM
Write-Output "Created: $workflowPath"
Write-Output "Created: $flatPath"
Write-Output "Created: $heightIdPath"
Write-Output "Nodes: $($nodes.Count); links: $($links.Count); groups: $($groups.Count)"
