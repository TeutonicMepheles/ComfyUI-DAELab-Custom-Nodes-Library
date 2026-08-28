param(
    [string]$Workflow = 'C:\Users\Golajah\Documents\ComfyUI\user\default\workflows\#8.1 - 徽章工作流.json',
    [switch]$RequireRunningServer
)

$ErrorActionPreference = 'Stop'
$wf = Get-Content -Raw -LiteralPath $Workflow | ConvertFrom-Json
$sourceWorkflow = Get-Content -Raw -LiteralPath 'C:\Users\Golajah\Documents\ComfyUI\user\default\workflows\#8 - 徽章工作流.json' | ConvertFrom-Json
$nodes = @{}
$groups = @{}
foreach ($node in $wf.nodes) { $nodes[[int]$node.id] = $node }
foreach ($group in $wf.groups) { $groups[[int]$group.id] = $group }
$failures = [System.Collections.Generic.List[string]]::new()

function Get-Node([int]$Id) { return $script:nodes[$Id] }

function Find-Slot($Slots, [string]$Name) {
    for ($index = 0; $index -lt $Slots.Count; $index++) {
        if ([string]$Slots[$index].name -eq $Name) { return $index }
    }
    return -1
}

function Has-Link([int]$From, [string]$OutputName, [int]$To, [string]$InputName) {
    $fromNode = Get-Node $From
    $toNode = Get-Node $To
    if (-not $fromNode -or -not $toNode) { return $false }
    $originSlot = Find-Slot $fromNode.outputs $OutputName
    $targetSlot = Find-Slot $toNode.inputs $InputName
    if ($originSlot -lt 0 -or $targetSlot -lt 0) { return $false }
    return @($wf.links | Where-Object {
        [int]$_[1] -eq $From -and [int]$_[2] -eq $originSlot -and
        [int]$_[3] -eq $To -and [int]$_[4] -eq $targetSlot
    }).Count -eq 1
}

function Require-Link([int]$From, [string]$OutputName, [int]$To, [string]$InputName) {
    if (-not (Has-Link $From $OutputName $To $InputName)) {
        $script:failures.Add("Missing link: $From.$OutputName -> $To.$InputName")
    }
}

function Contains-Fully([int]$GroupId, [int]$NodeId) {
    $group = $groups[$GroupId]
    $node = $nodes[$NodeId]
    if (-not $group -or -not $node) { return $false }
    $left = [double]$node.pos[0]
    $top = [double]$node.pos[1]
    $right = $left + [double]$node.size[0]
    $bottom = $top + [double]$node.size[1]
    $groupLeft = [double]$group.bounding[0]
    $groupTop = [double]$group.bounding[1]
    $groupRight = $groupLeft + [double]$group.bounding[2]
    $groupBottom = $groupTop + [double]$group.bounding[3]
    return $left -ge $groupLeft -and $top -ge $groupTop -and
        $right -le $groupRight -and $bottom -le $groupBottom
}

function Groups-Overlap([int]$FirstId, [int]$SecondId) {
    $first = $groups[$FirstId]
    $second = $groups[$SecondId]
    if (-not $first -or -not $second) { return $false }
    $firstLeft = [double]$first.bounding[0]
    $firstTop = [double]$first.bounding[1]
    $firstRight = $firstLeft + [double]$first.bounding[2]
    $firstBottom = $firstTop + [double]$first.bounding[3]
    $secondLeft = [double]$second.bounding[0]
    $secondTop = [double]$second.bounding[1]
    $secondRight = $secondLeft + [double]$second.bounding[2]
    $secondBottom = $secondTop + [double]$second.bounding[3]
    return $firstLeft -lt $secondRight -and $firstRight -gt $secondLeft -and
        $firstTop -lt $secondBottom -and $firstBottom -gt $secondTop
}

function Nodes-Overlap([int]$FirstId, [int]$SecondId) {
    $first = $nodes[$FirstId]
    $second = $nodes[$SecondId]
    if (-not $first -or -not $second) { return $false }
    $firstLeft = [double]$first.pos[0]
    $firstTop = [double]$first.pos[1]
    $firstRight = $firstLeft + [double]$first.size[0]
    $firstBottom = $firstTop + [double]$first.size[1]
    $secondLeft = [double]$second.pos[0]
    $secondTop = [double]$second.pos[1]
    $secondRight = $secondLeft + [double]$second.size[0]
    $secondBottom = $secondTop + [double]$second.size[1]
    return $firstLeft -lt $secondRight -and $firstRight -gt $secondLeft -and
        $firstTop -lt $secondBottom -and $firstBottom -gt $secondTop
}

# Structural integrity.
$nodeIds = @($wf.nodes | ForEach-Object { [int]$_.id })
$linkIds = @($wf.links | ForEach-Object { [int]$_[0] })
$groupIds = @($wf.groups | ForEach-Object { [int]$_.id })
if (($nodeIds | Sort-Object -Unique).Count -ne $nodeIds.Count) { $failures.Add('Duplicate node IDs') }
if (($linkIds | Sort-Object -Unique).Count -ne $linkIds.Count) { $failures.Add('Duplicate link IDs') }
if (($groupIds | Sort-Object -Unique).Count -ne $groupIds.Count) { $failures.Add('Duplicate group IDs') }
if ([int]$wf.last_node_id -ne ($nodeIds | Measure-Object -Maximum).Maximum) { $failures.Add('last_node_id mismatch') }
if ([int]$wf.last_link_id -ne ($linkIds | Measure-Object -Maximum).Maximum) { $failures.Add('last_link_id mismatch') }
if ([string]$wf.id -eq [string]$sourceWorkflow.id) { $failures.Add('Workflow #8.1 reuses the source #8 workflow id') }

$targetLinks = @{}
foreach ($link in $wf.links) {
    $linkId = [int]$link[0]
    $origin = $nodes[[int]$link[1]]
    $target = $nodes[[int]$link[3]]
    if (-not $origin) { $failures.Add("Link $linkId has missing origin"); continue }
    if (-not $target) { $failures.Add("Link $linkId has missing target"); continue }
    $originSlot = [int]$link[2]
    $targetSlot = [int]$link[4]
    if ($originSlot -ge $origin.outputs.Count) { $failures.Add("Link $linkId has invalid origin slot"); continue }
    if ($targetSlot -ge $target.inputs.Count) { $failures.Add("Link $linkId has invalid target slot"); continue }
    $targetKey = "$($target.id):$targetSlot"
    if ($targetLinks.ContainsKey($targetKey)) {
        $failures.Add("Multiple links target $targetKey")
    } else {
        $targetLinks[$targetKey] = $linkId
    }
    if ([int]$target.inputs[$targetSlot].link -ne $linkId) {
        $failures.Add("Link $linkId target metadata mismatch")
    }
    if ($origin.outputs[$originSlot].links -notcontains $linkId) {
        $failures.Add("Link $linkId source metadata mismatch")
    }
}

# Authoritative data flow.
Require-Link 60 'IMAGE' 137 'image'
Require-Link 124 'IMAGE' 57 'image'
Require-Link 124 'IMAGE' 75 'image'
Require-Link 137 'IMAGE' 109 'images'
Require-Link 137 'IMAGE' 110 'images'
Require-Link 137 'IMAGE' 111 'images'
Require-Link 75 'MASK' 128 'source'
Require-Link 75 'MASK' 129 'source'
Require-Link 75 'MASK' 130 'source'
Require-Link 85 'prompt' 125 'prompt'
Require-Link 85 'prompt' 126 'prompt'
Require-Link 85 'prompt' 127 'prompt'
foreach ($gptId in 125, 126, 127) {
    Require-Link 171 'size' $gptId 'model.size'
    Require-Link 171 'background' $gptId 'model.background'
    Require-Link 171 'quality' $gptId 'model.quality'
}
Require-Link 124 'IMAGE' 165 'image'
Require-Link 131 'MASK' 165 'mask'
Require-Link 124 'IMAGE' 166 'image'
Require-Link 132 'MASK' 166 'mask'
Require-Link 124 'IMAGE' 167 'image'
Require-Link 130 'MASK' 167 'mask'
Require-Link 124 'IMAGE' 125 'model.images.image_1'
Require-Link 165 'IMAGE' 125 'model.images.image_2'
Require-Link 125 'IMAGE' 126 'model.images.image_1'
Require-Link 166 'IMAGE' 126 'model.images.image_2'
Require-Link 126 'IMAGE' 127 'model.images.image_1'
Require-Link 167 'IMAGE' 127 'model.images.image_2'
Require-Link 165 'IMAGE' 168 'image'
Require-Link 132 'MASK' 168 'mask'
Require-Link 168 'IMAGE' 169 'image'
Require-Link 130 'MASK' 169 'mask'
Require-Link 127 'IMAGE' 112 'image'
Require-Link 75 'MASK' 112 'foreground_mask'
Require-Link 131 'MASK' 112 'raised_mask'
Require-Link 132 'MASK' 112 'recessed_mask'
Require-Link 130 'MASK' 112 'detail_mask'
Require-Link 173 'STRING' 172 'prompt'
Require-Link 175 'size' 172 'model.size'
Require-Link 175 'background' 172 'model.background'
Require-Link 175 'quality' 172 'model.quality'
Require-Link 127 'IMAGE' 172 'model.images.image_1'
Require-Link 112 'edited_image' 172 'model.images.image_2'
Require-Link 112 'height_preview' 172 'model.images.image_3'
Require-Link 112 'normal_preview' 172 'model.images.image_4'
Require-Link 169 'IMAGE' 172 'model.images.image_5'
Require-Link 172 'IMAGE' 80 'images'
Require-Link 124 'IMAGE' 64 'model.images.image_1'
Require-Link 80 'images' 64 'model.images.image_2'
Require-Link 66 'STRING' 64 'prompt'
Require-Link 70 'prompt' 74 'prompt'
Require-Link 98 'images' 74 'model.images.image_1'
Require-Link 104 'mask' 74 'model.mask'
Require-Link 102 'IMAGE' 145 'model.images.image_1'
Require-Link 70 'preview_image' 145 'model.images.image_2'
Require-Link 103 'images' 141 'image'
Require-Link 141 'IMAGE' 142 'images'
Require-Link 165 'IMAGE' 108 'image1'
Require-Link 166 'IMAGE' 108 'image2'
Require-Link 167 'IMAGE' 108 'image3'
Require-Link 169 'IMAGE' 108 'image4'
Require-Link 127 'IMAGE' 115 'image1'
Require-Link 172 'IMAGE' 115 'image2'
Require-Link 112 'height_preview' 115 'image3'
Require-Link 112 'normal_preview' 115 'image4'

# Overlay-guided relief stages must receive the clean current image plus its
# marked copy, with the API mask disconnected. Local edit A remains a true
# one-image masked edit.
foreach ($nodeId in 125, 126, 127) {
    $gptNode = Get-Node $nodeId
    $connectedImages = @($gptNode.inputs | Where-Object {
        $_.name -like 'model.images.image_*' -and $null -ne $_.link
    }).Count
    $maskInput = $gptNode.inputs | Where-Object name -eq 'model.mask' | Select-Object -First 1
    if ($connectedImages -ne 2 -or $null -ne $maskInput.link) {
        $failures.Add("Overlay-guided GPT node $nodeId must have two images and no API mask")
    }
}
$badgeRenderGpt = Get-Node 172
$badgeRenderImages = @($badgeRenderGpt.inputs | Where-Object {
    $_.name -like 'model.images.image_*' -and $null -ne $_.link
}).Count
$badgeRenderMask = $badgeRenderGpt.inputs | Where-Object name -eq 'model.mask' | Select-Object -First 1
if ($badgeRenderImages -ne 5 -or $null -ne $badgeRenderMask.link) {
    $failures.Add('Badge Relief render node 172 must have five reference images and no API mask')
}
$maskedLocalGpt = Get-Node 74
$maskedLocalImages = @($maskedLocalGpt.inputs | Where-Object {
    $_.name -like 'model.images.image_*' -and $null -ne $_.link
}).Count
$maskedLocalMask = $maskedLocalGpt.inputs | Where-Object name -eq 'model.mask' | Select-Object -First 1
if ($maskedLocalImages -ne 1 -or $null -eq $maskedLocalMask.link) {
    $failures.Add('Local masked GPT node 74 violates the one-image mask contract')
}
$referenceGpt = Get-Node 145
$referenceImages = @($referenceGpt.inputs | Where-Object {
    $_.name -like 'model.images.image_*' -and $null -ne $_.link
}).Count
$referenceMask = $referenceGpt.inputs | Where-Object name -eq 'model.mask' | Select-Object -First 1
if ($referenceImages -ne 2 -or $null -ne $referenceMask.link) {
    $failures.Add('Material-reference GPT node must have two images and no mask')
}

# The partition reference must not leak into generation or RMBG.
$partitionTargets = @($wf.links | Where-Object { [int]$_[1] -eq 60 } | ForEach-Object { [int]$_[3] })
if ($partitionTargets.Count -ne 1 -or $partitionTargets[0] -ne 137) {
    $failures.Add('Color partition image has an unexpected downstream target')
}

# Redundant prompt chains and other orphaned nodes from the source workflow
# must stay removed; the Slider semantic output is authoritative.
foreach ($nodeId in 62, 63, 76, 77, 79, 81, 119, 147, 148, 149, 150, 151, 152,
    160, 161, 163, 164, 170) {
    if ($nodes.ContainsKey($nodeId)) { $failures.Add("Removed node $nodeId unexpectedly remains") }
}
foreach ($entry in @(
    @(165, '#FF0033'),
    @(166, '#0066FF'),
    @(167, '#00FF66'),
    @(168, '#0066FF'),
    @(169, '#00FF66')
)) {
    $overlayNode = Get-Node ([int]$entry[0])
    if (-not $overlayNode -or $overlayNode.type -ne 'AILab_MaskOverlay') {
        $failures.Add("Missing Mask Overlay node $($entry[0])")
        continue
    }
    if ([double]$overlayNode.widgets_values[0] -ne 0.85 -or
        [string]$overlayNode.widgets_values[1] -ne [string]$entry[1]) {
        $failures.Add("Mask Overlay node $($entry[0]) has wrong opacity or marker color")
    }
}
$finalConfigTargets = @($wf.links | Where-Object { [int]$_[1] -eq 65 } | ForEach-Object { [int]$_[3] } | Sort-Object -Unique)
if ($finalConfigTargets.Count -ne 1 -or $finalConfigTargets[0] -ne 64) {
    $failures.Add('Final GPT config node 65 has unexpected relief-branch targets')
}
$semanticConfigTargets = @($wf.links | Where-Object { [int]$_[1] -eq 171 } | ForEach-Object { [int]$_[3] } | Sort-Object -Unique)
if (($semanticConfigTargets -join ',') -ne '125,126,127') {
    $failures.Add('GPT A config node 171 must target only nodes 125, 126, and 127')
}
$badgeConfigTargets = @($wf.links | Where-Object { [int]$_[1] -eq 175 } | ForEach-Object { [int]$_[3] } | Sort-Object -Unique)
if ($badgeConfigTargets.Count -ne 1 -or $badgeConfigTargets[0] -ne 172) {
    $failures.Add('Badge GPT config node 175 must target only node 172')
}
if (-not (Contains-Fully 7 85) -or -not (Contains-Fully 7 171)) {
    $failures.Add('Relief Slider or dedicated GPT config is outside group 7')
}

# Boolean hierarchy relationships.
$items = (Get-Node 61).widgets_values[0] | ConvertFrom-Json
$height = $items | Where-Object label -eq '是否进行高度编辑？'
$cutout = $items | Where-Object label -eq '是否输出透明背景结果？'
$gpt = $items | Where-Object label -like '使用 OpenAI*'
$badge = $items | Where-Object label -like '使用 Badge*'
$local = $items | Where-Object label -eq '是否进行局部修改？'
$localRef = $items | Where-Object label -eq '是否使用修改参考图？'
if ($height.exclusive_group_id -or $cutout.exclusive_group_id) {
    $failures.Add('Height editing and transparent output are incorrectly exclusive')
}
if (-not $gpt.exclusive_group_id -or $gpt.exclusive_group_id -ne $badge.exclusive_group_id) {
    $failures.Add('Relief approaches are not mutually exclusive')
}
if ($gpt.parent_id -ne $height.id -or $badge.parent_id -ne $height.id) {
    $failures.Add('Relief approaches are not children of height editing')
}
if ($localRef.parent_id -ne $local.id) {
    $failures.Add('Local reference toggle is not a child of local editing')
}
foreach ($nodeId in 125, 126, 127, 165, 166, 167) {
    if ([int](Get-Node $nodeId).mode -ne 0) { $failures.Add("Default GPT A/shared node $nodeId is not active") }
}
foreach ($nodeId in 112, 113, 114, 168, 169, 172, 173, 175) {
    if ([int](Get-Node $nodeId).mode -ne 4) { $failures.Add("Default Badge branch node $nodeId is not bypassed") }
}

# Controller mapping.
$expectedControllers = @{
    153 = @('8', $false)
    154 = @('16', $false)
    155 = @('17', $false)
    156 = @('18', $false)
    157 = @('13', $false)
    158 = @('19', $true)
    159 = @('20', $false)
}
foreach ($entry in $expectedControllers.GetEnumerator()) {
    $controller = Get-Node ([int]$entry.Key)
    if (-not $controller -or $controller.type -ne 'BooleanGroupBypassController') {
        $failures.Add("Missing controller node $($entry.Key)")
        continue
    }
    if ([string]$controller.properties.target_group_id -ne [string]$entry.Value[0]) {
        $failures.Add("Controller $($entry.Key) targets wrong group")
    }
    if ([bool]$controller.properties.invert -ne [bool]$entry.Value[1]) {
        $failures.Add("Controller $($entry.Key) has wrong invert setting")
    }
    if ($null -eq $controller.inputs[0].link) {
        $failures.Add("Controller $($entry.Key) is unconnected")
    }
}

# Full geometric containment is stricter than the frontend group's point test
# and proves parent groups contain all nodes controlled by their child groups.
foreach ($nodeId in 125, 126, 127) {
    if (-not (Contains-Fully 16 $nodeId)) { $failures.Add("Node $nodeId is not fully inside relief group A") }
    if (-not (Contains-Fully 8 $nodeId)) { $failures.Add("Node $nodeId is not fully inside relief parent group") }
}
foreach ($nodeId in 165, 166, 167) {
    if (-not (Contains-Fully 26 $nodeId)) { $failures.Add("Node $nodeId is outside shared Mask Overlay group") }
    if (-not (Contains-Fully 8 $nodeId)) { $failures.Add("Node $nodeId is not fully inside relief parent group") }
}
foreach ($stage in @(@(23, 125), @(24, 126), @(25, 127))) {
    $stageId = [int]$stage[0]
    $nodeId = [int]$stage[1]
    if (-not (Contains-Fully $stageId $nodeId)) {
        $failures.Add("Node $nodeId is outside stage group $stageId")
    }
}
foreach ($nodeId in 112, 113, 114, 168, 169, 172, 173, 175) {
    if (-not (Contains-Fully 17 $nodeId)) { $failures.Add("Node $nodeId is not fully inside relief group B") }
    if (-not (Contains-Fully 8 $nodeId)) { $failures.Add("Node $nodeId is not fully inside relief parent group") }
}
foreach ($nodeId in 74, 99) {
    if (-not (Contains-Fully 19 $nodeId) -or -not (Contains-Fully 13 $nodeId)) {
        $failures.Add("Local no-reference node $nodeId is outside its parent/child groups")
    }
}
foreach ($nodeId in 102, 145) {
    if (-not (Contains-Fully 20 $nodeId) -or -not (Contains-Fully 13 $nodeId)) {
        $failures.Add("Local reference node $nodeId is outside its parent/child groups")
    }
}
if (-not (Contains-Fully 18 141)) { $failures.Add('Final RMBG node is outside its controlled group') }
foreach ($nodeId in 142, 143) {
    if (-not (Contains-Fully 21 $nodeId)) { $failures.Add("Final output node $nodeId is outside group 21") }
}
# Parent/child nesting is intentional; every other group pair must be
# separated, preventing a recurrence of the overlapping canvas layout.
if ($groups.ContainsKey(6)) { $failures.Add('Obsolete RMBG settings group 6 remains') }
if (-not $groups.ContainsKey(21)) { $failures.Add('Final output group 21 is missing') }
if ($groups.ContainsKey(22)) { $failures.Add('Obsolete mask-extraction reference group 22 remains') }
foreach ($groupId in 23, 24, 25, 26) {
    if (-not $groups.ContainsKey($groupId)) { $failures.Add("Overlay stage group $groupId is missing") }
}
$allowedNestedPairs = @(
    '8:16', '8:17', '8:23', '8:24', '8:25', '8:26',
    '13:19', '13:20',
    '16:23', '16:24', '16:25'
)
$sortedGroupIds = @($groups.Keys | Sort-Object)
for ($firstIndex = 0; $firstIndex -lt $sortedGroupIds.Count; $firstIndex++) {
    for ($secondIndex = $firstIndex + 1; $secondIndex -lt $sortedGroupIds.Count; $secondIndex++) {
        $firstId = [int]$sortedGroupIds[$firstIndex]
        $secondId = [int]$sortedGroupIds[$secondIndex]
        $pair = if ($firstId -lt $secondId) { "${firstId}:${secondId}" } else { "${secondId}:${firstId}" }
        if ($allowedNestedPairs -notcontains $pair -and (Groups-Overlap $firstId $secondId)) {
            $failures.Add("Unexpected group overlap: $firstId and $secondId")
        }
    }
}
$sortedNodeIds = @($nodes.Keys | Sort-Object)
for ($firstIndex = 0; $firstIndex -lt $sortedNodeIds.Count; $firstIndex++) {
    for ($secondIndex = $firstIndex + 1; $secondIndex -lt $sortedNodeIds.Count; $secondIndex++) {
        $firstId = [int]$sortedNodeIds[$firstIndex]
        $secondId = [int]$sortedNodeIds[$secondIndex]
        if (Nodes-Overlap $firstId $secondId) {
            $failures.Add("Unexpected node overlap: $firstId and $secondId")
        }
    }
}

# All newly introduced node types must exist in the running ComfyUI instance.
try {
    $raw = (Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8000/object_info' -TimeoutSec 10).Content
    $objectInfo = $raw | ConvertFrom-Json -AsHashtable
    foreach ($type in 'ImageScale', 'MaskComposite', 'MaskToImage', 'AILab_MaskOverlay',
        'OpenAIGPTImageNodeV2', 'BooleanListHierarchyGet',
        'BooleanGroupBypassController', 'RMBG') {
        if (-not $objectInfo.ContainsKey($type)) { $failures.Add("Installed node type missing: $type") }
    }
} catch {
    if ($RequireRunningServer) {
        $failures.Add("Could not query ComfyUI object_info: $($_.Exception.Message)")
    } else {
        Write-Output "RUNTIME NODE CHECK SKIPPED: ComfyUI is not running on port 8000"
    }
}

if ($failures.Count) {
    Write-Output "VALIDATION FAILED ($($failures.Count))"
    $failures | ForEach-Object { Write-Output "- $_" }
    exit 1
}

Write-Output 'VALIDATION PASSED'
Write-Output "Nodes=$($wf.nodes.Count) Links=$($wf.links.Count) Groups=$($wf.groups.Count)"
