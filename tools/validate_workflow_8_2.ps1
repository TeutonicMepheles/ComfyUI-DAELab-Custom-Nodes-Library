param(
    [string]$Root = 'C:\Users\Golajah\Documents\ComfyUI',
    [string]$Workflow = 'C:\Users\Golajah\Documents\ComfyUI\user\default\workflows\#8.2 - 徽章工作流.json'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing

$failures = [System.Collections.Generic.List[string]]::new()
function Fail([string]$Message) { $script:failures.Add($Message) }
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { Fail $Message } }

if (-not (Test-Path -LiteralPath $Workflow)) { throw "Workflow does not exist: $Workflow" }
$wf = Get-Content -LiteralPath $Workflow -Raw | ConvertFrom-Json
$nodes = @{}
$groups = @{}
foreach ($node in $wf.nodes) { $nodes[[int]$node.id] = $node }
foreach ($group in $wf.groups) { $groups[[int]$group.id] = $group }

function Get-Node([int]$Id) { return $script:nodes[$Id] }
function Find-Slot($Slots, [string]$Name) {
    for ($index = 0; $index -lt $Slots.Count; $index++) {
        if ([string]$Slots[$index].name -eq $Name) { return $index }
    }
    return -1
}
function Has-Link([int]$FromId, [string]$FromOutput, [int]$ToId, [string]$ToInput) {
    $from = Get-Node $FromId
    $to = Get-Node $ToId
    if (-not $from -or -not $to) { return $false }
    $originSlot = Find-Slot $from.outputs $FromOutput
    $targetSlot = Find-Slot $to.inputs $ToInput
    if ($originSlot -lt 0 -or $targetSlot -lt 0) { return $false }
    return @($wf.links | Where-Object {
        [int]$_[1] -eq $FromId -and [int]$_[2] -eq $originSlot -and
        [int]$_[3] -eq $ToId -and [int]$_[4] -eq $targetSlot
    }).Count -eq 1
}
function Require-Link([int]$FromId, [string]$FromOutput, [int]$ToId, [string]$ToInput) {
    if (-not (Has-Link $FromId $FromOutput $ToId $ToInput)) {
        Fail "Missing link: $FromId.$FromOutput -> $ToId.$ToInput"
    }
}
function Contains-Fully($Group, $Node) {
    $left = [double]$Node.pos[0]
    $top = [double]$Node.pos[1]
    $right = $left + [double]$Node.size[0]
    $bottom = $top + [double]$Node.size[1]
    $groupLeft = [double]$Group.bounding[0]
    $groupTop = [double]$Group.bounding[1]
    $groupRight = $groupLeft + [double]$Group.bounding[2]
    $groupBottom = $groupTop + [double]$Group.bounding[3]
    return $left -ge $groupLeft -and $top -ge $groupTop -and $right -le $groupRight -and $bottom -le $groupBottom
}
function Rectangles-Overlap($First, $Second, [bool]$AreGroups = $false) {
    $firstBox = if ($AreGroups) { $First.bounding } else { @($First.pos[0], $First.pos[1], $First.size[0], $First.size[1]) }
    $secondBox = if ($AreGroups) { $Second.bounding } else { @($Second.pos[0], $Second.pos[1], $Second.size[0], $Second.size[1]) }
    $firstRight = [double]$firstBox[0] + [double]$firstBox[2]
    $firstBottom = [double]$firstBox[1] + [double]$firstBox[3]
    $secondRight = [double]$secondBox[0] + [double]$secondBox[2]
    $secondBottom = [double]$secondBox[1] + [double]$secondBox[3]
    return [double]$firstBox[0] -lt $secondRight -and $firstRight -gt [double]$secondBox[0] -and
        [double]$firstBox[1] -lt $secondBottom -and $firstBottom -gt [double]$secondBox[1]
}

# Identity and link integrity.
$nodeIds = @($wf.nodes | ForEach-Object { [int]$_.id })
$linkIds = @($wf.links | ForEach-Object { [int]$_[0] })
$groupIds = @($wf.groups | ForEach-Object { [int]$_.id })
Assert (($nodeIds | Sort-Object -Unique).Count -eq $nodeIds.Count) 'Duplicate node IDs'
Assert (($linkIds | Sort-Object -Unique).Count -eq $linkIds.Count) 'Duplicate link IDs'
Assert (($groupIds | Sort-Object -Unique).Count -eq $groupIds.Count) 'Duplicate group IDs'
Assert ([int]$wf.last_node_id -eq ($nodeIds | Measure-Object -Maximum).Maximum) 'last_node_id mismatch'
Assert ([int]$wf.last_link_id -eq ($linkIds | Measure-Object -Maximum).Maximum) 'last_link_id mismatch'
Assert ([string]$wf.id -ne '4e864396-8ef1-4c05-9dc2-292b74cd0117') '#8.2 must not reuse the #8.1 workflow ID'

$seenTargets = @{}
foreach ($link in $wf.links) {
    $linkId = [int]$link[0]
    $origin = Get-Node ([int]$link[1])
    $target = Get-Node ([int]$link[3])
    if (-not $origin) { Fail "Link $linkId has a missing origin"; continue }
    if (-not $target) { Fail "Link $linkId has a missing target"; continue }
    $originSlot = [int]$link[2]
    $targetSlot = [int]$link[4]
    if ($originSlot -lt 0 -or $originSlot -ge $origin.outputs.Count) { Fail "Link $linkId has invalid origin slot"; continue }
    if ($targetSlot -lt 0 -or $targetSlot -ge $target.inputs.Count) { Fail "Link $linkId has invalid target slot"; continue }
    $targetKey = "$($target.id):$targetSlot"
    if ($seenTargets.ContainsKey($targetKey)) { Fail "Multiple links target $targetKey" } else { $seenTargets[$targetKey] = $linkId }
    Assert ([int]$target.inputs[$targetSlot].link -eq $linkId) "Link $linkId target metadata mismatch"
    Assert (@($origin.outputs[$originSlot].links) -contains $linkId) "Link $linkId source metadata mismatch"
}

# Exact horizontal partitioning and spacing.
Assert ($wf.groups.Count -eq 12) 'Expected exactly 12 workflow groups'
$sortedGroups = @($wf.groups | Sort-Object { [double]$_.bounding[0] })
for ($index = 0; $index -lt $sortedGroups.Count; $index++) {
    Assert ([int]$sortedGroups[$index].id -eq $index) "Expected horizontal group order 00-11; got group $($sortedGroups[$index].id) at index $index"
    if ($index -gt 0) {
        $previous = $sortedGroups[$index - 1]
        $gap = [double]$sortedGroups[$index].bounding[0] - ([double]$previous.bounding[0] + [double]$previous.bounding[2])
        Assert ($gap -ge 300) "Group gap is below 300 px between $($previous.id) and $($sortedGroups[$index].id): $gap"
    }
}
for ($first = 0; $first -lt $wf.groups.Count; $first++) {
    for ($second = $first + 1; $second -lt $wf.groups.Count; $second++) {
        if (Rectangles-Overlap $wf.groups[$first] $wf.groups[$second] $true) {
            Fail "Groups $($wf.groups[$first].id) and $($wf.groups[$second].id) overlap"
        }
    }
}
Assert ([string](Get-Node 11).type -eq 'AppModeLoadImage') 'Flat input must be AppModeLoadImage'
Assert ([string](Get-Node 12).type -eq 'AppModeLoadImage') 'Height input must be AppModeLoadImage'
Assert ([string]$groups[1].title -match '\[Input\].*输入节点') 'Input group must be explicitly marked as input nodes'

foreach ($node in $wf.nodes) {
    $containers = @($wf.groups | Where-Object { Contains-Fully $_ $node })
    Assert ($containers.Count -eq 1) "Node $($node.id) ($($node.type)) is not fully contained by exactly one group"
    if ($containers.Count -eq 1) {
        $group = $containers[0]
        $leftMargin = [double]$node.pos[0] - [double]$group.bounding[0]
        $topMargin = [double]$node.pos[1] - [double]$group.bounding[1]
        $rightMargin = ([double]$group.bounding[0] + [double]$group.bounding[2]) - ([double]$node.pos[0] + [double]$node.size[0])
        $bottomMargin = ([double]$group.bounding[1] + [double]$group.bounding[3]) - ([double]$node.pos[1] + [double]$node.size[1])
        Assert ($leftMargin -ge 60 -and $topMargin -ge 60 -and $rightMargin -ge 60 -and $bottomMargin -ge 60) "Node $($node.id) violates the 60 px group inset"
    }
}
foreach ($group in $wf.groups) {
    $members = @($wf.nodes | Where-Object { Contains-Fully $group $_ })
    for ($first = 0; $first -lt $members.Count; $first++) {
        for ($second = $first + 1; $second -lt $members.Count; $second++) {
            if (Rectangles-Overlap $members[$first] $members[$second]) {
                Fail "Nodes $($members[$first].id) and $($members[$second].id) overlap in group $($group.id)"
            }
            $firstTop = [double]$members[$first].pos[1]
            $firstBottom = $firstTop + [double]$members[$first].size[1]
            $secondTop = [double]$members[$second].pos[1]
            $secondBottom = $secondTop + [double]$members[$second].size[1]
            $verticalOverlap = $firstTop -lt $secondBottom -and $firstBottom -gt $secondTop
            if ($verticalOverlap) {
                $firstLeft = [double]$members[$first].pos[0]
                $firstRight = $firstLeft + [double]$members[$first].size[0]
                $secondLeft = [double]$members[$second].pos[0]
                $secondRight = $secondLeft + [double]$members[$second].size[0]
                $horizontalGap = [math]::Max($secondLeft - $firstRight, $firstLeft - $secondRight)
                if ($horizontalGap -ge 0) {
                    Assert ($horizontalGap -ge 100) "Nodes $($members[$first].id) and $($members[$second].id) are horizontally packed below 100 px"
                }
            }
        }
    }
}

# Required mature DAELab and reusable controls.
$requiredTypes = @(
    'BadgeDesignCanvas', 'BadgeRenderPromptBuilder', 'BadgeMasterRegistration',
    'BadgeEditMaskValidator', 'BadgeLocalEditPromptBuilder', 'BadgeHeightPatch',
    'BadgeDeterministicComposite', 'BadgePresentationPromptBuilder',
    'BadgeEditStateSave', 'DAELabBadgeHeightLayer', 'DAELabMultiColorMask',
    'GPTImage2MaterialPrompt', 'BooleanListHierarchy', 'LazyImageStageSwitch',
    'LayerUtility: ImageReel', 'LayerUtility: ImageReelComposit'
)
foreach ($type in $requiredTypes) {
    Assert (@($wf.nodes | Where-Object type -eq $type).Count -gt 0) "Missing required node type: $type"
}
Assert (@($wf.nodes | Where-Object type -eq 'LayerUtility: ImageReel').Count -eq 4) 'Expected four staged ImageReel samplers'
Assert (@($wf.nodes | Where-Object { $_.type -match 'Polygon|Canny' }).Count -eq 0) 'MVP workflow must not include Polygon or Canny nodes'
Assert (@($wf.nodes | Where-Object { [double]$_.pos[0] -lt 0 }).Count -eq 0) 'Workflow contains negative-coordinate trial nodes'

foreach ($node in $wf.nodes | Where-Object { $_.type -like 'Badge*' -or $_.type -like 'DAELab*' -or $_.type -eq 'GPTImage2MaterialPrompt' }) {
    Assert ([string]$node.properties.'Node name for S&R' -eq [string]$node.type) "Node $($node.id) changes its registered node name"
}

# Authoritative design, height, local edit, and lazy routing contracts.
Require-Link 11 'IMAGE' 13 'images'
Require-Link 11 'MASK' 13 'alpha_mask'
Require-Link 12 'IMAGE' 14 'image'
Require-Link 13 'width' 14 'width'
Require-Link 13 'height' 14 'height'
Require-Link 14 'IMAGE' 21 'images'
Require-Link 13 'normalized_flat_image' 40 'images'
Require-Link 21 'unmatched_mask' 28 'unmatched_mask'
Require-Link 13 'design_foreground_mask' 28 'design_foreground_mask'
Require-Link 19 'material_semantics' 28 'material_semantics_input'

Require-Link 2 '使用高度图' 33 'enabled'
Require-Link 31 'IMAGE' 33 'bypass_image'
Require-Link 32 'IMAGE' 33 'processed_image'
Require-Link 33 'image' 34 'candidate_image'
Require-Link 34 'base_render' 41 'base_render'
Require-Link 34 'contour_iou' 41 'registration_iou'
Require-Link 40 'mask' 41 'edit_mask_flat'
Require-Link 13 'design_foreground_mask' 41 'design_foreground_mask'
Require-Link 41 'edit_mask' 49 'edit_mask'
Require-Link 47 'apply_height_patch' 49 'apply_patch'
Require-Link 47 'target_layer_value' 49 'target_layer'
Require-Link 49 'patched_height_image' 61 'model.images.image_3'

Require-Link 2 '使用高度图' 62 'enabled'
Require-Link 60 'IMAGE' 62 'bypass_image'
Require-Link 61 'IMAGE' 62 'processed_image'
Require-Link 41 'should_edit' 66 'enabled'
Require-Link 34 'base_render' 66 'bypass_image'
Require-Link 63 'edited_master' 66 'processed_image'
Require-Link 2 '执行局部修改' 67 'enabled'
Require-Link 34 'base_render' 67 'bypass_image'
Require-Link 66 'image' 67 'processed_image'
Require-Link 63 'edited_master' 66 'processed_image'
Require-Link 34 'base_render' 63 'previous_master'
Require-Link 62 'image' 63 'edit_candidate'
Require-Link 41 'edit_mask' 63 'edit_mask'

Require-Link 2 '执行最终展示后处理' 75 'enabled'
Require-Link 67 'image' 75 'bypass_image'
Require-Link 74 'IMAGE' 75 'processed_image'
Require-Link 56 'MASK' 77 'mask'
Require-Link 67 'image' 78 'image'
Require-Link 77 'MASK' 78 'alpha'
Require-Link 2 '输出正视透明母版' 79 'enabled'
Require-Link 78 'IMAGE' 79 'processed_image'
Require-Link 2 '生成展示图透明预览（非确定性）' 83 'enabled'
Require-Link 82 'IMAGE' 83 'processed_image'

# GPT branch socket discipline.
$baseNoHeight = Get-Node 31
$baseWithHeight = Get-Node 32
$localNoHeight = Get-Node 60
$localWithHeight = Get-Node 61
$post = Get-Node 74
Assert ($null -ne ($baseNoHeight.inputs | Where-Object name -eq 'model.images.image_1').link) 'Base no-height GPT lacks image_1'
Assert ($null -eq ($baseNoHeight.inputs | Where-Object name -eq 'model.images.image_2').link) 'Base no-height GPT must not connect image_2'
Assert ($null -ne ($baseWithHeight.inputs | Where-Object name -eq 'model.images.image_2').link) 'Base height GPT lacks image_2'
Assert ($null -eq ($baseNoHeight.inputs | Where-Object name -eq 'model.mask').link) 'Base GPT must not use a mask'
Assert ($null -eq ($baseWithHeight.inputs | Where-Object name -eq 'model.mask').link) 'Base height GPT must not use a mask'
Assert ($null -eq ($localNoHeight.inputs | Where-Object name -eq 'model.images.image_3').link) 'Local no-height GPT must not connect image_3'
Assert ($null -ne ($localWithHeight.inputs | Where-Object name -eq 'model.images.image_3').link) 'Local height GPT lacks image_3'
Assert ($null -ne ($localNoHeight.inputs | Where-Object name -eq 'model.mask').link) 'Local no-height GPT lacks the validated mask'
Assert ($null -ne ($localWithHeight.inputs | Where-Object name -eq 'model.mask').link) 'Local height GPT lacks the validated mask'
Assert ($null -eq ($post.inputs | Where-Object name -eq 'model.mask').link) 'Presentation GPT must not use a local edit mask'

# Multi Color Mask has one physical output; ImageReel labels are explicit.
$multiMask = Get-Node 40
Assert ($multiMask.outputs.Count -eq 1 -and [string]$multiMask.outputs[0].name -eq 'mask') 'Multi Color Mask must expose only its single selected mask output'
$reelLabels = @($wf.nodes | Where-Object type -eq 'LayerUtility: ImageReel' | ForEach-Object { $_.widgets_values[0..3] })
foreach ($number in 1..16) {
    $prefix = '{0:D2} ' -f $number
    Assert (@($reelLabels | Where-Object { [string]$_ -like "$prefix*" }).Count -eq 1) "Missing or duplicate ImageReel stage label: $prefix"
}

# Input artifact contract: stable copies, identical crop, transparency, and full
# magenta Cut Out faces in the height-ID image.
$referencePath = Join-Path $Root 'input\Badge_8_2\badge_reference_full.png'
$flatPath = Join-Path $Root 'input\Badge_8_2\badge_flat.png'
$heightPath = Join-Path $Root 'input\Badge_8_2\badge_height_id.png'
foreach ($path in $referencePath, $flatPath, $heightPath) { Assert (Test-Path -LiteralPath $path) "Missing stable input artifact: $path" }
if ((Test-Path -LiteralPath $flatPath) -and (Test-Path -LiteralPath $heightPath)) {
    $flat = [System.Drawing.Bitmap]::new($flatPath)
    $height = [System.Drawing.Bitmap]::new($heightPath)
    try {
        Assert ($flat.Width -eq 402 -and $flat.Height -eq 402) 'Flat input must use the 402x402 left reference crop'
        Assert ($height.Width -eq $flat.Width -and $height.Height -eq $flat.Height) 'Flat and height-ID inputs must be pixel-aligned'
        $transparent = 0
        $magenta = 0
        $flatMagenta = 0
        $allowedColors = @('#FF00FF', '#E8F0EC', '#FFFFFF', '#12978B', '#004D43', '#B9CCC4', '#163029', '#DFBD9B')
        $seenColors = [System.Collections.Generic.HashSet[string]]::new()
        for ($y = 0; $y -lt $flat.Height; $y++) {
            for ($x = 0; $x -lt $flat.Width; $x++) {
                $flatPixel = $flat.GetPixel($x, $y)
                $heightPixel = $height.GetPixel($x, $y)
                if ($flatPixel.A -eq 0) { $transparent++ }
                $heightHex = '#{0:X2}{1:X2}{2:X2}' -f $heightPixel.R, $heightPixel.G, $heightPixel.B
                [void]$seenColors.Add($heightHex)
                if ($heightHex -eq '#FF00FF') { $magenta++ }
                if ($flatPixel.R -eq 255 -and $flatPixel.G -eq 0 -and $flatPixel.B -eq 255) { $flatMagenta++ }
            }
        }
        Assert ($transparent -gt 50000) 'Flat input lacks a meaningful deterministic transparent background'
        Assert ($magenta -gt 1500) 'Height-ID input does not contain fully filled Cut Out regions'
        Assert ($flatMagenta -eq 0) 'Pink X/Cut Out color leaked into the flat design input'
        Assert ($height.GetPixel(250, 140).R -eq 255 -and $height.GetPixel(250, 140).B -eq 255) 'Upper Cut Out face is not fully magenta'
        Assert ($height.GetPixel(251, 305).R -eq 255 -and $height.GetPixel(251, 305).B -eq 255) 'Lower Cut Out face is not fully magenta'
        foreach ($color in $seenColors) { Assert ($allowedColors -contains $color) "Unexpected mixed color in nearest-neighbor height-ID input: $color" }
    } finally {
        $flat.Dispose()
        $height.Dispose()
    }
}

# Repository reuse evidence.
$badgeWorkflowNode = Join-Path $Root 'custom_nodes\ComfyUI-DAELab-Custom-Nodes-Library\nodes\badge_workflow\node.py'
$thumbnailSelector = Join-Path $Root 'custom_nodes\ComfyUI-DAELab-Custom-Nodes-Library\web\thumbnail_selector.mjs'
$materialPrompt = Join-Path $Root 'custom_nodes\ComfyUI-DAELab-Custom-Nodes-Library\web\material_prompt.js'
Assert (Test-Path -LiteralPath $badgeWorkflowNode) 'Mature DAELab badge workflow node set is missing'
Assert (Test-Path -LiteralPath $thumbnailSelector) 'Shared thumbnail selector is missing'
Assert (Test-Path -LiteralPath $materialPrompt) 'Material prompt frontend is missing'

if ($failures.Count -gt 0) {
    Write-Output "FAILED: $($failures.Count) validation issue(s)"
    $failures | ForEach-Object { Write-Output " - $_" }
    exit 1
}

Write-Output 'PASS: #8.2 badge workflow validation succeeded.'
Write-Output "Nodes=$($wf.nodes.Count) Links=$($wf.links.Count) Groups=$($wf.groups.Count) Reels=$(@($wf.nodes | Where-Object type -eq 'LayerUtility: ImageReel').Count)"
