param(
    [string]$Source = 'C:\Users\Golajah\Documents\ComfyUI\user\default\workflows\#8 - 徽章工作流.json',
    [string]$Destination = 'C:\Users\Golajah\Documents\ComfyUI\user\default\workflows\#8.1 - 徽章工作流.json'
)

$ErrorActionPreference = 'Stop'

$wf = Get-Content -Raw -LiteralPath $Source | ConvertFrom-Json -AsHashtable
$wf['id'] = '4e864396-8ef1-4c05-9dc2-292b74cd0117'

function Get-Node([int]$Id) {
    return $script:wf['nodes'] | Where-Object { [int]$_['id'] -eq $Id } | Select-Object -First 1
}

function Get-InputIndex($Node, [string]$Name) {
    for ($i = 0; $i -lt $Node['inputs'].Count; $i++) {
        if ([string]$Node['inputs'][$i]['name'] -eq $Name) { return $i }
    }
    throw "Input '$Name' not found on node $($Node['id']) ($($Node['type']))"
}

function Get-OutputIndex($Node, [string]$Name) {
    for ($i = 0; $i -lt $Node['outputs'].Count; $i++) {
        if ([string]$Node['outputs'][$i]['name'] -eq $Name) { return $i }
    }
    throw "Output '$Name' not found on node $($Node['id']) ($($Node['type']))"
}

function Remove-Node([int]$Id) {
    $script:wf['nodes'] = @($script:wf['nodes'] | Where-Object { [int]$_['id'] -ne $Id })
    $script:wf['links'] = @($script:wf['links'] | Where-Object {
        [int]$_[1] -ne $Id -and [int]$_[3] -ne $Id
    })
}

function Set-NodeBox(
    [int]$Id,
    [double]$X,
    [double]$Y,
    [double]$Width = -1,
    [double]$Height = -1
) {
    $node = Get-Node $Id
    if (-not $node) { throw "Cannot position missing node $Id" }
    $node['pos'] = @($X, $Y)
    if ($Width -ge 0 -and $Height -ge 0) { $node['size'] = @($Width, $Height) }
}

function Set-GroupBox(
    [int]$Id,
    [double]$X,
    [double]$Y,
    [double]$Width,
    [double]$Height,
    [string]$Title = ''
) {
    $group = $script:wf['groups'] | Where-Object { [int]$_['id'] -eq $Id } | Select-Object -First 1
    if (-not $group) { throw "Cannot position missing group $Id" }
    $group['bounding'] = @($X, $Y, $Width, $Height)
    if ($Title) { $group['title'] = $Title }
}

function Add-Node($Node) {
    if (Get-Node ([int]$Node['id'])) { throw "Duplicate node id $($Node['id'])" }
    $script:wf['nodes'] += ,$Node
}

function Connect(
    [int]$FromId,
    [string]$FromOutput,
    [int]$ToId,
    [string]$ToInput,
    [string]$Type
) {
    $from = Get-Node $FromId
    $to = Get-Node $ToId
    if (-not $from -or -not $to) { throw "Cannot connect missing node: $FromId -> $ToId" }
    $originSlot = Get-OutputIndex $from $FromOutput
    $targetSlot = Get-InputIndex $to $ToInput

    $script:wf['links'] = @($script:wf['links'] | Where-Object {
        -not ([int]$_[3] -eq $ToId -and [int]$_[4] -eq $targetSlot)
    })
    $script:nextLinkId += 1
    $script:wf['links'] += ,@($script:nextLinkId, $FromId, $originSlot, $ToId, $targetSlot, $Type)
}

function New-Input([string]$Name, [string]$Type, [bool]$Optional = $false) {
    $input = [ordered]@{
        localized_name = $Name
        name = $Name
        type = $Type
        link = $null
    }
    if ($Optional) { $input['shape'] = 7 }
    return $input
}

function New-WidgetInput([string]$Name, [string]$Type) {
    return [ordered]@{
        localized_name = $Name
        name = $Name
        type = $Type
        widget = [ordered]@{ name = $Name }
        link = $null
    }
}

function New-Output([string]$Name, [string]$Type) {
    return [ordered]@{
        localized_name = $Name
        name = $Name
        type = $Type
        links = $null
    }
}

function New-PrimitiveStringNode([int]$Id, [double]$X, [double]$Y, [string]$Title, [string]$Value, [int]$Order) {
    return [ordered]@{
        id = $Id
        type = 'PrimitiveStringMultiline'
        pos = @($X, $Y)
        size = @(420, 155)
        flags = [ordered]@{}
        order = $Order
        mode = 0
        inputs = @([ordered]@{
            localized_name = '值'; name = 'value'; type = 'STRING'
            widget = [ordered]@{ name = 'value' }; link = $null
        })
        outputs = @([ordered]@{
            localized_name = '字符串'; name = 'STRING'; type = 'STRING'; links = $null
        })
        title = $Title
        properties = [ordered]@{ 'Node name for S&R' = 'PrimitiveStringMultiline' }
        widgets_values = @($Value)
    }
}

function New-TextConcatNode([int]$Id, [double]$X, [double]$Y, [string]$Title, [int]$Order) {
    return [ordered]@{
        id = $Id
        type = 'Text Concatenate'
        pos = @($X, $Y)
        size = @(280, 225)
        flags = [ordered]@{}
        order = $Order
        mode = 0
        inputs = @(
            (New-Input 'text_a' 'STRING' $true),
            (New-Input 'text_b' 'STRING' $true),
            (New-Input 'text_c' 'STRING' $true),
            (New-Input 'text_d' 'STRING' $true),
            (New-WidgetInput 'delimiter' 'STRING'),
            (New-WidgetInput 'clean_whitespace' 'COMBO')
        )
        outputs = @((New-Output 'STRING' 'STRING'))
        title = $Title
        properties = [ordered]@{ 'Node name for S&R' = 'Text Concatenate' }
        widgets_values = @("\n", 'true')
    }
}

function New-GPTImageNode([int]$Id, [double]$X, [double]$Y, [string]$Title, [int]$Order, [int]$ImageCount = 2) {
    $nodeInputs = @(
        (New-WidgetInput 'prompt' 'STRING'),
        (New-WidgetInput 'model' 'COMFY_DYNAMICCOMBO_V3'),
        (New-WidgetInput 'model.size' 'COMBO'),
        (New-WidgetInput 'model.custom_width' 'INT'),
        (New-WidgetInput 'model.custom_height' 'INT'),
        (New-WidgetInput 'model.background' 'COMBO'),
        (New-WidgetInput 'model.quality' 'COMBO')
    )
    foreach ($index in 1..$ImageCount) {
        $inputName = "model.images.image_$index"
        $nodeInputs += ,([ordered]@{
            label = "image_$index"; localized_name = $inputName; name = $inputName
            shape = 7; type = 'IMAGE'; link = $null
        })
    }
    $nodeInputs += ,([ordered]@{
        label = 'mask'; localized_name = 'model.mask'; name = 'model.mask'
        shape = 7; type = 'MASK'; link = $null
    })
    $nodeInputs += ,(New-WidgetInput 'n' 'INT')
    $nodeInputs += ,(New-WidgetInput 'seed' 'INT')

    return [ordered]@{
        id = $Id
        type = 'OpenAIGPTImageNodeV2'
        pos = @($X, $Y)
        size = @(420, 455)
        flags = [ordered]@{}
        order = $Order
        mode = 0
        inputs = $nodeInputs
        outputs = @([ordered]@{
            localized_name = '图像'; name = 'IMAGE'; type = 'IMAGE'; links = $null
        })
        title = $Title
        properties = [ordered]@{ 'Node name for S&R' = 'OpenAIGPTImageNodeV2' }
        widgets_values = @('', 'gpt-image-2', 'auto', 1024, 1024, 'auto', 'low', 1, 0, 'randomize')
        color = '#432'
        bgcolor = '#653'
    }
}

function New-MaskCompositeNode([int]$Id, [double]$X, [double]$Y, [string]$Title, [string]$Operation, [int]$Order) {
    return [ordered]@{
        id = $Id
        type = 'MaskComposite'
        pos = @($X, $Y)
        size = @(280, 155)
        flags = [ordered]@{}
        order = $Order
        mode = 0
        inputs = @(
            (New-Input 'destination' 'MASK'),
            (New-Input 'source' 'MASK'),
            (New-WidgetInput 'x' 'INT'),
            (New-WidgetInput 'y' 'INT'),
            (New-WidgetInput 'operation' 'COMBO')
        )
        outputs = @((New-Output 'MASK' 'MASK'))
        title = $Title
        properties = [ordered]@{ 'Node name for S&R' = 'MaskComposite' }
        widgets_values = @(0, 0, $Operation)
    }
}

function New-MaskOverlayNode([int]$Id, [double]$X, [double]$Y, [string]$Title, [string]$Color, [int]$Order) {
    return [ordered]@{
        id = $Id
        type = 'AILab_MaskOverlay'
        pos = @($X, $Y)
        size = @(420, 300)
        flags = [ordered]@{}
        order = $Order
        mode = 0
        inputs = @(
            (New-Input 'image' 'IMAGE' $true),
            (New-Input 'mask' 'MASK' $true),
            (New-WidgetInput 'mask_opacity' 'FLOAT'),
            (New-WidgetInput 'mask_color' 'COLORCODE')
        )
        outputs = @((New-Output 'IMAGE' 'IMAGE'), (New-Output 'MASK' 'MASK'))
        title = $Title
        properties = [ordered]@{ 'Node name for S&R' = 'AILab_MaskOverlay' }
        widgets_values = @(0.85, $Color)
        color = '#2e3e57'
        bgcolor = '#4b5b73'
    }
}

function New-ControllerNode([int]$Id, [double]$X, [double]$Y, [string]$Title, [string]$TargetGroupId, [bool]$Invert, [int]$Order) {
    return [ordered]@{
        id = $Id
        type = 'BooleanGroupBypassController'
        pos = @($X, $Y)
        size = @(380, 230)
        flags = [ordered]@{}
        order = $Order
        mode = 0
        inputs = @((New-Input 'boolean' 'BOOLEAN'))
        outputs = @()
        title = $Title
        properties = [ordered]@{
            'Node name for S&R' = 'BooleanGroupBypassController'
            target_group_id = $TargetGroupId
            invert = $Invert
        }
        widgets_values = @()
    }
}

function New-HierarchyGetNode([int]$Id, [double]$X, [double]$Y, [string]$Title, $Snapshot, [int]$Order) {
    $encoded = $Snapshot | ConvertTo-Json -Compress -Depth 20
    $outputs = @()
    foreach ($itemId in $Snapshot['output_item_ids']) {
        $item = $Snapshot['items'] | Where-Object { [string]$_['id'] -eq [string]$itemId } | Select-Object -First 1
        $outputs += ,[ordered]@{
            label = [string]$item['label']
            localized_name = [string]$item['label']
            name = [string]$item['label']
            type = 'BOOLEAN'
            links = $null
        }
    }
    return [ordered]@{
        id = $Id
        type = 'BooleanListHierarchyGet'
        pos = @($X, $Y)
        size = @(410, 205)
        flags = [ordered]@{}
        order = $Order
        mode = 0
        inputs = @([ordered]@{
            localized_name = 'config_json'; name = 'config_json'; shape = 7; type = 'STRING'
            widget = [ordered]@{ name = 'config_json' }; link = $null
        })
        outputs = $outputs
        title = $Title
        properties = [ordered]@{
            boolean_get_source_node_id = '61'
            boolean_get_root_item_id = [string]$Snapshot['root_item_id']
            boolean_get_include_root = $true
            boolean_get_width = 410
            'Node name for S&R' = 'BooleanListHierarchyGet'
            boolean_get_snapshot = $encoded
        }
        widgets_values = @($encoded)
    }
}

function Rebuild-LinkMetadata {
    foreach ($node in $script:wf['nodes']) {
        foreach ($input in $node['inputs']) { $input['link'] = $null }
        foreach ($output in $node['outputs']) { $output['links'] = $null }
    }
    foreach ($link in $script:wf['links']) {
        $origin = Get-Node ([int]$link[1])
        $target = Get-Node ([int]$link[3])
        if (-not $origin -or -not $target) { throw "Dangling link id $($link[0])" }
        $originSlot = [int]$link[2]
        $targetSlot = [int]$link[4]
        if ($originSlot -ge $origin['outputs'].Count) { throw "Bad origin slot on link $($link[0])" }
        if ($targetSlot -ge $target['inputs'].Count) { throw "Bad target slot on link $($link[0])" }
        $target['inputs'][$targetSlot]['link'] = [int]$link[0]
        $existing = $origin['outputs'][$originSlot]['links']
        if ($null -eq $existing) { $existing = @() }
        $origin['outputs'][$originSlot]['links'] = @($existing) + [int]$link[0]
    }
}

$script:nextLinkId = [int]$wf['last_link_id']
$nextOrder = (($wf['nodes'] | ForEach-Object { [int]$_['order'] } | Measure-Object -Maximum).Maximum) + 1

# Remove the old hybrid GPT/Badge node. It mixed both approaches instead of
# providing two independently bypassable relief branches.
foreach ($id in 81, 62, 63, 76, 77, 79, 119) { Remove-Node $id }

# The two input images now have explicit, separate responsibilities.
$node60 = Get-Node 60
$node60['title'] = '徽章色块分区图｜仅用于遮罩'
$node124 = Get-Node 124
$node124['title'] = '徽章平面图｜颜色与设计唯一基准'
$node75 = Get-Node 75
$node75['title'] = '浮雕准备 RMBG｜徽章主体 + 前景遮罩'
$node64 = Get-Node 64
$node64['title'] = '最终效果图生成｜原图颜色约束'
$node98 = Get-Node 98
$node98['title'] = '最终效果图｜生成结果'
$node104 = Get-Node 104
$node104['title'] = '局部材质修改区域（多选颜色）'
$group1 = $wf['groups'] | Where-Object { [int]$_['id'] -eq 1 } | Select-Object -First 1
$group1['title'] = '[Input] 徽章平面图 + 色块分区图'

# Align the color partition image to the flat artwork with nearest-neighbour
# sampling, preserving exact categorical colors.
$node137 = [ordered]@{
    id = 137; type = 'ImageScale'; pos = @(700, 4690); size = @(330, 235)
    flags = [ordered]@{}; order = $nextOrder; mode = 0
    inputs = @(
        (New-Input 'image' 'IMAGE'),
        (New-WidgetInput 'upscale_method' 'COMBO'),
        (New-WidgetInput 'width' 'INT'),
        (New-WidgetInput 'height' 'INT'),
        (New-WidgetInput 'crop' 'COMBO')
    )
    outputs = @((New-Output 'IMAGE' 'IMAGE'))
    title = '色块分区图对齐｜最近邻'
    properties = [ordered]@{ 'Node name for S&R' = 'ImageScale' }
    widgets_values = @('nearest-exact', 1024, 1024, 'disabled')
}
$nextOrder += 1
Add-Node $node137

$node138 = [ordered]@{
    id = 138; type = 'MaskToImage'; pos = @(1590, 4380); size = @(225, 60)
    flags = [ordered]@{}; order = $nextOrder; mode = 0
    inputs = @((New-Input 'mask' 'MASK'))
    outputs = @((New-Output 'IMAGE' 'IMAGE'))
    title = 'RMBG 前景遮罩图'
    properties = [ordered]@{ 'Node name for S&R' = 'MaskToImage' }
    widgets_values = @()
}
$nextOrder += 1
Add-Node $node138

$group5 = $wf['groups'] | Where-Object { [int]$_['id'] -eq 5 } | Select-Object -First 1
$group5['title'] = '[Prep] 色块对齐 + RMBG 前景提取'
$group5['bounding'] = @(660, 3900, 1160, 1350)

# Three foreground intersections plus two detail-priority subtractions.
Add-Node (New-MaskCompositeNode 128 1790 4460 '凸起遮罩 ∩ RMBG 前景' 'multiply' $nextOrder); $nextOrder += 1
Add-Node (New-MaskCompositeNode 129 2140 4460 '凹陷遮罩 ∩ RMBG 前景' 'multiply' $nextOrder); $nextOrder += 1
Add-Node (New-MaskCompositeNode 130 2490 4460 '细节遮罩 ∩ RMBG 前景' 'multiply' $nextOrder); $nextOrder += 1
Add-Node (New-MaskCompositeNode 131 1790 4650 '有效凸起遮罩｜扣除细节' 'subtract' $nextOrder); $nextOrder += 1
Add-Node (New-MaskCompositeNode 132 2140 4650 '有效凹陷遮罩｜扣除细节' 'subtract' $nextOrder); $nextOrder += 1

$group10 = $wf['groups'] | Where-Object { [int]$_['id'] -eq 10 } | Select-Object -First 1
$group10['title'] = '[Mask] Multi Color Mask｜凸起 / 凹陷 / 细节'
$group10['bounding'] = @(1750, 3900, 1100, 1260)
$node120 = Get-Node 120
$node120['pos'] = @(2490, 4860)
$node120['size'] = @(330, 260)
$node120['title'] = '细节有效遮罩'
$node121 = Get-Node 121
$node121['pos'] = @(1790, 4860)
$node121['size'] = @(330, 260)
$node121['title'] = '凸起有效遮罩'
$node122 = Get-Node 122
$node122['pos'] = @(2140, 4860)
$node122['size'] = @(330, 260)
$node122['title'] = '凹陷有效遮罩'

Add-Node (New-GPTImageNode 125 3500 3950 'GPT 浮雕 1/3｜仅处理红色凸部标记' $nextOrder); $nextOrder += 1
Add-Node (New-GPTImageNode 126 3950 3950 'GPT 浮雕 2/3｜仅处理蓝色凹部标记' $nextOrder); $nextOrder += 1
Add-Node (New-GPTImageNode 127 4400 3950 'GPT 浮雕 3/3｜仅处理绿色细节标记' $nextOrder); $nextOrder += 1

# These three marked references are shared by both relief branches. Each is
# always painted over the untouched flat artwork, so neither branch inherits
# marker colors or image edits from the other branch.
Add-Node (New-MaskOverlayNode 165 3500 3750 'Mask Overlay｜红色凸部标记' '#FF0033' $nextOrder); $nextOrder += 1
Add-Node (New-MaskOverlayNode 166 3950 3750 'Mask Overlay｜蓝色凹部标记' '#0066FF' $nextOrder); $nextOrder += 1
Add-Node (New-MaskOverlayNode 167 4400 3750 'Mask Overlay｜绿色细节标记' '#00FF66' $nextOrder); $nextOrder += 1

# Badge Relief uses a combined RGB marker reference in addition to its
# deterministic edited preview, height field, and normal map.
Add-Node (New-MaskOverlayNode 168 5860 3950 'Badge 参考｜叠加蓝色凹部' '#0066FF' $nextOrder); $nextOrder += 1
Add-Node (New-MaskOverlayNode 169 6310 3950 'Badge 参考｜叠加绿色细节' '#00FF66' $nextOrder); $nextOrder += 1

# Split GPT settings by function to avoid nine long backward-running wires
# from the final-render configuration area into the relief branch.
$node171 = (Get-Node 65) | ConvertTo-Json -Compress -Depth 100 | ConvertFrom-Json -AsHashtable
$node171['id'] = 171
$node171['pos'] = @(2990, 4350)
$node171['order'] = $nextOrder
$node171['title'] = 'GPT 浮雕编辑设置'
foreach ($input in $node171['inputs']) { $input['link'] = $null }
foreach ($output in $node171['outputs']) { $output['links'] = $null }
Add-Node $node171
$nextOrder += 1

$badgeRenderPrompt = 'Image 1 是未经修改的徽章平面图，是图案、文字、轮廓、布局和固有颜色的唯一基准。Image 2 是 Badge Relief 计算得到的浮雕光影预览，仅提供立体结构与材质光影参考。Image 3 是高度图：白色更高、黑色更低。Image 4 是法线图，用于约束表面朝向、倒角和细节起伏。Image 5 是三区联合标记参考：红色代表凸部、蓝色代表凹部、绿色代表细节部；这些鲜明颜色只用于定位，绝不是成品颜色。请严格依据 Image 2、Image 3 和 Image 4 生成浮雕几何与光影，只在 Image 5 标出的三区落实对应高度关系；完整保留 Image 1 的固有颜色、文字、图案和比例，并在输出中彻底移除所有红蓝绿标记色。'
Add-Node (New-PrimitiveStringNode 173 7090 3950 'Badge 生图说明｜高度图 + 法线图职责' $badgeRenderPrompt $nextOrder); $nextOrder += 1
Add-Node (New-GPTImageNode 172 7540 3950 'Badge Relief 生图｜高度图 + 法线图定向生成' $nextOrder 5); $nextOrder += 1

$node175 = (Get-Node 65) | ConvertTo-Json -Compress -Depth 100 | ConvertFrom-Json -AsHashtable
$node175['id'] = 175
$node175['pos'] = @(7090, 4200)
$node175['order'] = $nextOrder
$node175['title'] = 'Badge Relief 生图设置'
foreach ($input in $node175['inputs']) { $input['link'] = $null }
foreach ($output in $node175['outputs']) { $output['links'] = $null }
Add-Node $node175
$nextOrder += 1

# Repurpose the existing Badge node as the second serial, bypassable branch.
$node112 = Get-Node 112
$node112['pos'] = @(5330, 3950)
$node112['title'] = 'Badge Relief｜确定性分区浮雕'
$node113 = Get-Node 113
$node113['pos'] = @(5860, 4290)
$node114 = Get-Node 114
$node114['pos'] = @(6200, 4290)
$node80 = Get-Node 80
$node80['pos'] = @(8530, 3950)
$node80['title'] = '当前启用的浮雕结果'

# Height branch groups: one parent group and two mutually exclusive children.
$group8 = $wf['groups'] | Where-Object { [int]$_['id'] -eq 8 } | Select-Object -First 1
$group8['title'] = '[Relief] 浮雕高度编辑｜总控'
$group8['bounding'] = @(3430, 3880, 4820, 1160)
$wf['groups'] += ,[ordered]@{
    id = 16; title = '[Relief A] OpenAI GPT Image 2 语义浮雕'
    bounding = @(3460, 4360, 1490, 650); color = '#6b5f8f'; flags = [ordered]@{}
}
$wf['groups'] += ,[ordered]@{
    id = 17; title = '[Relief B] Badge Relief｜高度图 + 法线图生图'
    bounding = @(5300, 3910, 2900, 1090); color = '#6b8e5e'; flags = [ordered]@{}
}
$wf['groups'] += ,[ordered]@{
    id = 26; title = '[Shared] 三区 Mask Overlay｜A / B 共用'
    bounding = @(3460, 3910, 1490, 400); color = '#4d718d'; flags = [ordered]@{}
}

# Boolean hierarchy. Height editing and transparent output are independent.
$heightId = '3b04f4b4-ee73-4a87-981e-a535d0b1c462'
$cutoutId = '7b0f00f3-7445-4ea0-974c-fdc562686140'
$localId = '62fbf77e-1d36-48c3-8a9e-5752c9092507'
$localRefId = '9820e84f-5fc0-4f45-a3d5-14a7b2f9e5e1'
$gptReliefId = '8d8fb69c-2275-4ab9-bb56-8ac98cc1f301'
$badgeReliefId = 'e2a4f73d-1457-4e99-8e12-4599b9f2a3f8'
$reliefExclusiveId = '4d6f7d67-7c30-4de8-8b32-8b6556fe6e9f'

$booleanItems = @(
    [ordered]@{ id = $heightId; label = '是否进行高度编辑？'; value = $true; parent_id = $null },
    [ordered]@{ id = $gptReliefId; label = '使用 OpenAI GPT Image 2 语义浮雕'; value = $true; parent_id = $heightId; exclusive_group_id = $reliefExclusiveId },
    [ordered]@{ id = $badgeReliefId; label = '使用 Badge Relief 高度图 / 法线图生图'; value = $false; parent_id = $heightId; exclusive_group_id = $reliefExclusiveId },
    [ordered]@{ id = $cutoutId; label = '是否输出透明背景结果？'; value = $false; parent_id = $null },
    [ordered]@{ id = $localId; label = '是否进行局部修改？'; value = $false; parent_id = $null },
    [ordered]@{ id = $localRefId; label = '是否使用修改参考图？'; value = $false; parent_id = $localId }
)
$encodedBooleanItems = $booleanItems | ConvertTo-Json -Compress -Depth 20
$node61 = Get-Node 61
$node61['size'] = @(510, 430)
$node61['properties']['boolean_list_width'] = 510
$node61['properties']['boolean_list_count'] = $booleanItems.Count
$node61['properties']['boolean_list_items'] = $encodedBooleanItems
$node61['widgets_values'] = @($encodedBooleanItems)
$node61['outputs'] = @()
foreach ($item in $booleanItems) {
    $node61['outputs'] += ,[ordered]@{
        label = $item['label']; localized_name = $item['label']; name = $item['label']
        type = 'BOOLEAN'; links = $null
    }
}

$heightSnapshot = [ordered]@{
    version = 2; valid = $true; source_node_id = '61'; root_item_id = $heightId; include_root = $true
    items = @($booleanItems[0], $booleanItems[1], $booleanItems[2])
    output_item_ids = @($heightId, $gptReliefId, $badgeReliefId)
}
$localSnapshot = [ordered]@{
    version = 2; valid = $true; source_node_id = '61'; root_item_id = $localId; include_root = $true
    items = @($booleanItems[4], $booleanItems[5])
    output_item_ids = @($localId, $localRefId)
}
Add-Node (New-HierarchyGetNode 135 580 2980 '高度编辑分支控制' $heightSnapshot $nextOrder); $nextOrder += 1
Add-Node (New-HierarchyGetNode 136 580 3240 '局部修改分支控制' $localSnapshot $nextOrder); $nextOrder += 1

Add-Node (New-ControllerNode 153 1040 2980 '总控｜高度编辑' '8' $false $nextOrder); $nextOrder += 1
Add-Node (New-ControllerNode 154 1440 2980 '分支｜OpenAI 语义浮雕' '16' $false $nextOrder); $nextOrder += 1
Add-Node (New-ControllerNode 155 1840 2980 '分支｜Badge Relief + 生图' '17' $false $nextOrder); $nextOrder += 1
Add-Node (New-ControllerNode 156 2240 2980 '输出｜透明背景' '18' $false $nextOrder); $nextOrder += 1
Add-Node (New-ControllerNode 157 1040 3240 '总控｜局部修改' '13' $false $nextOrder); $nextOrder += 1
Add-Node (New-ControllerNode 158 1440 3240 '局部修改｜无参考图' '19' $true $nextOrder); $nextOrder += 1
Add-Node (New-ControllerNode 159 1840 3240 '局部修改｜使用参考图' '20' $false $nextOrder); $nextOrder += 1

$group2 = $wf['groups'] | Where-Object { [int]$_['id'] -eq 2 } | Select-Object -First 1
$group2['title'] = '[Input] Boolean 控制面板与自动 Bypass'
$group2['bounding'] = @(0, 2880, 2660, 650)

# Local material modification becomes a parent-controlled chain with two
# child modes selected by the reference-image boolean and controller invert.
$group13 = $wf['groups'] | Where-Object { [int]$_['id'] -eq 13 } | Select-Object -First 1
$group13['title'] = '[Post] 局部材质修改｜总控'
$group13['bounding'] = @(950, 6235, 2700, 1350)
$wf['groups'] += ,[ordered]@{
    id = 19; title = '[Post A] 局部修改｜无参考图（Mask Inpaint）'
    bounding = @(1360, 6270, 460, 1000); color = '#6b5f8f'; flags = [ordered]@{}
}
$wf['groups'] += ,[ordered]@{
    id = 20; title = '[Post B] 局部修改｜使用材质参考图'
    bounding = @(1830, 6270, 880, 1000); color = '#6b8e5e'; flags = [ordered]@{}
}

$node74 = Get-Node 74
$node74['pos'] = @(1400, 6318)
$node74['title'] = '局部修改 A｜遮罩内编辑'
$node99 = Get-Node 99
$node99['pos'] = @(1400, 6810)
$node102 = Get-Node 102
$node102['pos'] = @(1850, 6318)
$node102['title'] = '局部修改 B｜红色区域标记'
$node103 = Get-Node 103
$node103['pos'] = @(2750, 6810)
$node103['title'] = '当前局部修改结果'

$node145 = New-GPTImageNode 145 2260 6318 '局部修改 B｜结合材质参考图' $nextOrder
$nextOrder += 1
# The reference-image variant uses a visual red overlay rather than the mask
# input because GPT Image requires exactly one image when a mask is supplied.
$node145['inputs'] = @(
    (New-WidgetInput 'prompt' 'STRING'),
    (New-WidgetInput 'model' 'COMFY_DYNAMICCOMBO_V3'),
    (New-WidgetInput 'model.size' 'COMBO'),
    (New-WidgetInput 'model.custom_width' 'INT'),
    (New-WidgetInput 'model.custom_height' 'INT'),
    (New-WidgetInput 'model.background' 'COMBO'),
    (New-WidgetInput 'model.quality' 'COMBO'),
    ([ordered]@{ label = 'image_1'; localized_name = 'model.images.image_1'; name = 'model.images.image_1'; shape = 7; type = 'IMAGE'; link = $null }),
    ([ordered]@{ label = 'image_2'; localized_name = 'model.images.image_2'; name = 'model.images.image_2'; shape = 7; type = 'IMAGE'; link = $null }),
    ([ordered]@{ label = 'mask'; localized_name = 'model.mask'; name = 'model.mask'; shape = 7; type = 'MASK'; link = $null }),
    (New-WidgetInput 'n' 'INT'),
    (New-WidgetInput 'seed' 'INT')
)
Add-Node $node145

# Optional final transparent-background output, independent from relief RMBG.
$node141 = [ordered]@{
    id = 141; type = 'RMBG'; pos = @(3690, 6400); size = @(340, 425.3125)
    flags = [ordered]@{}; order = $nextOrder; mode = 4
    inputs = @(
        (New-Input 'image' 'IMAGE'),
        (New-WidgetInput 'model' 'COMBO'),
        (New-WidgetInput 'sensitivity' 'FLOAT'),
        (New-WidgetInput 'process_res' 'INT'),
        (New-WidgetInput 'mask_blur' 'INT'),
        (New-WidgetInput 'mask_offset' 'INT'),
        (New-WidgetInput 'invert_output' 'BOOLEAN'),
        (New-WidgetInput 'refine_foreground' 'BOOLEAN'),
        (New-WidgetInput 'background' 'COMBO'),
        (New-WidgetInput 'background_color' 'COLORCODE')
    )
    outputs = @((New-Output 'IMAGE' 'IMAGE'), (New-Output 'MASK' 'MASK'), (New-Output 'MASK_IMAGE' 'IMAGE'))
    title = '最终效果图透明背景输出'
    properties = [ordered]@{ 'Node name for S&R' = 'RMBG' }
    widgets_values = @('RMBG-2.0', 1, 1024, 0, 0, $false, $true, 'Alpha', '#000000')
}
$nextOrder += 1
Add-Node $node141

$node142 = [ordered]@{
    id = 142; type = 'PreviewImage'; pos = @(4090, 6300); size = @(760, 600)
    flags = [ordered]@{}; order = $nextOrder; mode = 0
    inputs = @((New-Input 'images' 'IMAGE'))
    outputs = @((New-Output 'images' 'IMAGE'))
    title = '最终输出｜可选透明背景'
    properties = [ordered]@{ 'Node name for S&R' = 'PreviewImage' }
    widgets_values = @()
}
$nextOrder += 1
Add-Node $node142

$node143 = [ordered]@{
    id = 143; type = 'SaveImage'; pos = @(4090, 6940); size = @(760, 520)
    flags = [ordered]@{}; order = $nextOrder; mode = 0
    inputs = @((New-Input 'images' 'IMAGE'), (New-WidgetInput 'filename_prefix' 'STRING'))
    outputs = @((New-Output 'images' 'IMAGE'))
    title = '保存 #8.1 最终结果'
    properties = [ordered]@{ 'Node name for S&R' = 'SaveImage' }
    widgets_values = @('Badge_8_1/final')
}
$nextOrder += 1
Add-Node $node143

$wf['groups'] += ,[ordered]@{
    id = 18; title = '[Output] 最终效果图透明背景｜可选'
    bounding = @(3650, 6330, 420, 540); color = '#8A8'; flags = [ordered]@{}
}

# Strong final reference-role prompt.
$node66 = Get-Node 66
$node66['widgets_values'] = @('生成可用于方案展示的真实徽章效果图。Image 1 是徽章图案、文字、轮廓、比例、布局和颜色的唯一基准；Image 2 只提供浮雕高度、倒角、材质立体感及光影关系。严格保持 Image 1 的全部设计内容和固有颜色，不得采用遮罩图、色块分区图、高度图或法线图中的颜色，不得增加、删除或改写任何文字与图案。')
$node70 = Get-Node 70
$node70['widgets_values'][1] = '仅修改指定区域；若输入包含红色覆盖标记，红色仅用于指示编辑区域并必须在输出中完全移除；若使用 Mask，则仅修改白色遮罩范围。遮罩外图形、文字、轮廓与颜色保持不变。'

# Data-flow rewiring.
Connect 124 'IMAGE' 57 'image' 'IMAGE'
Connect 60 'IMAGE' 137 'image' 'IMAGE'
Connect 57 'width' 137 'width' 'INT'
Connect 57 'height' 137 'height' 'INT'
Connect 124 'IMAGE' 75 'image' 'IMAGE'
Connect 75 'MASK' 138 'mask' 'MASK'

Connect 137 'IMAGE' 109 'images' 'IMAGE'
Connect 137 'IMAGE' 110 'images' 'IMAGE'
Connect 137 'IMAGE' 111 'images' 'IMAGE'

Connect 109 'mask' 128 'destination' 'MASK'
Connect 75 'MASK' 128 'source' 'MASK'
Connect 110 'mask' 129 'destination' 'MASK'
Connect 75 'MASK' 129 'source' 'MASK'
Connect 111 'mask' 130 'destination' 'MASK'
Connect 75 'MASK' 130 'source' 'MASK'
Connect 128 'MASK' 131 'destination' 'MASK'
Connect 130 'MASK' 131 'source' 'MASK'
Connect 129 'MASK' 132 'destination' 'MASK'
Connect 130 'MASK' 132 'source' 'MASK'

Connect 131 'MASK' 121 'mask' 'MASK'
Connect 132 'MASK' 122 'mask' 'MASK'
Connect 130 'MASK' 120 'mask' 'MASK'

Connect 85 'prompt' 125 'prompt' 'STRING'
Connect 85 'prompt' 126 'prompt' 'STRING'
Connect 85 'prompt' 127 'prompt' 'STRING'
foreach ($gptId in 125, 126, 127) {
    Connect 171 'size' $gptId 'model.size' 'COMBO'
    Connect 171 'background' $gptId 'model.background' 'COMBO'
    Connect 171 'quality' $gptId 'model.quality' 'COMBO'
}
Connect 124 'IMAGE' 165 'image' 'IMAGE'
Connect 131 'MASK' 165 'mask' 'MASK'
Connect 124 'IMAGE' 166 'image' 'IMAGE'
Connect 132 'MASK' 166 'mask' 'MASK'
Connect 124 'IMAGE' 167 'image' 'IMAGE'
Connect 130 'MASK' 167 'mask' 'MASK'

Connect 124 'IMAGE' 125 'model.images.image_1' 'IMAGE'
Connect 165 'IMAGE' 125 'model.images.image_2' 'IMAGE'
Connect 125 'IMAGE' 126 'model.images.image_1' 'IMAGE'
Connect 166 'IMAGE' 126 'model.images.image_2' 'IMAGE'
Connect 126 'IMAGE' 127 'model.images.image_1' 'IMAGE'
Connect 167 'IMAGE' 127 'model.images.image_2' 'IMAGE'

# Branch B builds one combined red / blue / green marker reference from the
# same shared overlays, then uses Badge Relief geometry as explicit generation
# guidance. Image 1 stays on the A-output chain so bypassing branch B forwards
# the active A result unchanged to the common selector.
Connect 165 'IMAGE' 168 'image' 'IMAGE'
Connect 132 'MASK' 168 'mask' 'MASK'
Connect 168 'IMAGE' 169 'image' 'IMAGE'
Connect 130 'MASK' 169 'mask' 'MASK'

Connect 127 'IMAGE' 112 'image' 'IMAGE'
Connect 75 'MASK' 112 'foreground_mask' 'MASK'
Connect 131 'MASK' 112 'raised_mask' 'MASK'
Connect 132 'MASK' 112 'recessed_mask' 'MASK'
Connect 130 'MASK' 112 'detail_mask' 'MASK'
Connect 173 'STRING' 172 'prompt' 'STRING'
Connect 175 'size' 172 'model.size' 'COMBO'
Connect 175 'background' 172 'model.background' 'COMBO'
Connect 175 'quality' 172 'model.quality' 'COMBO'
Connect 127 'IMAGE' 172 'model.images.image_1' 'IMAGE'
Connect 112 'edited_image' 172 'model.images.image_2' 'IMAGE'
Connect 112 'height_preview' 172 'model.images.image_3' 'IMAGE'
Connect 112 'normal_preview' 172 'model.images.image_4' 'IMAGE'
Connect 169 'IMAGE' 172 'model.images.image_5' 'IMAGE'
Connect 172 'IMAGE' 80 'images' 'IMAGE'

# Final generator always receives the untouched flat art as Image 1 and only
# the selected relief candidate as Image 2.
Connect 124 'IMAGE' 64 'model.images.image_1' 'IMAGE'
Connect 80 'images' 64 'model.images.image_2' 'IMAGE'
Connect 66 'STRING' 64 'prompt' 'STRING'

# Local modification A: one image + true mask. Local modification B: visual
# overlay + material reference, no mask, satisfying the GPT Image API rule.
Connect 70 'prompt' 74 'prompt' 'STRING'
Connect 98 'images' 74 'model.images.image_1' 'IMAGE'
Connect 104 'mask' 74 'model.mask' 'MASK'
Connect 74 'IMAGE' 99 'images' 'IMAGE'
Connect 74 'IMAGE' 102 'image' 'IMAGE'
Connect 104 'mask' 102 'mask' 'MASK'
Connect 70 'prompt' 145 'prompt' 'STRING'
Connect 102 'IMAGE' 145 'model.images.image_1' 'IMAGE'
Connect 70 'preview_image' 145 'model.images.image_2' 'IMAGE'
Connect 145 'IMAGE' 103 'images' 'IMAGE'

Connect 103 'images' 141 'image' 'IMAGE'
Connect 78 'background' 141 'background' 'COMBO'
Connect 78 'background_color' 141 'background_color' 'COLORCODE'
Connect 141 'IMAGE' 142 'images' 'IMAGE'
Connect 142 'images' 143 'images' 'IMAGE'

# Controller wiring.
Connect 135 '是否进行高度编辑？' 153 'boolean' 'BOOLEAN'
Connect 135 '使用 OpenAI GPT Image 2 语义浮雕' 154 'boolean' 'BOOLEAN'
Connect 135 '使用 Badge Relief 高度图 / 法线图生图' 155 'boolean' 'BOOLEAN'
Connect 61 '是否输出透明背景结果？' 156 'boolean' 'BOOLEAN'
Connect 136 '是否进行局部修改？' 157 'boolean' 'BOOLEAN'
Connect 136 '是否使用修改参考图？' 158 'boolean' 'BOOLEAN'
Connect 136 '是否使用修改参考图？' 159 'boolean' 'BOOLEAN'

# Reel 1: inputs and foreground preparation.
$node105 = Get-Node 105
$node105['title'] = '记录 1｜输入与前景'
$node105['widgets_values'] = @('徽章平面图', '对齐后的色块分区图', 'RMBG 徽章主体', 'RMBG 前景遮罩', 1024, 60)
Connect 124 'IMAGE' 105 'image1' 'IMAGE'
Connect 137 'IMAGE' 105 'image2' 'IMAGE'
Connect 75 'IMAGE' 105 'image3' 'IMAGE'
Connect 138 'IMAGE' 105 'image4' 'IMAGE'

# Reel 2: three visible marker overlays plus the combined B-branch reference.
$node108 = Get-Node 108
$node108['title'] = '记录 2｜A / B 共用 Mask Overlay'
$node108['widgets_values'] = @('红色凸部标记图', '蓝色凹部标记图', '绿色细节标记图', '红蓝绿三区联合标记图', 1024, 60)
Connect 165 'IMAGE' 108 'image1' 'IMAGE'
Connect 166 'IMAGE' 108 'image2' 'IMAGE'
Connect 167 'IMAGE' 108 'image3' 'IMAGE'
Connect 169 'IMAGE' 108 'image4' 'IMAGE'

# Reel 3: both relief approaches and deterministic diagnostics.
$node115 = Get-Node 115
$node115['title'] = '记录 3｜双浮雕方案与几何诊断'
$node115['widgets_values'] = @('GPT 语义浮雕分支结果', 'Badge Relief 高度 / 法线生图结果', 'Badge 高度图', 'Badge 法线图', 1024, 60)
Connect 127 'IMAGE' 115 'image1' 'IMAGE'
Connect 172 'IMAGE' 115 'image2' 'IMAGE'
Connect 112 'height_preview' 115 'image3' 'IMAGE'
Connect 112 'normal_preview' 115 'image4' 'IMAGE'

# Reel 4: reference, selected relief, generated render and post output.
$node116 = Get-Node 116
$node116['title'] = '记录 4｜最终效果与后处理'
$node116['widgets_values'] = @('原始平面图', '当前浮雕结果', '最终效果图', '局部修改 / 透明背景输出', 1024, 60)
Connect 124 'IMAGE' 116 'image1' 'IMAGE'
Connect 80 'images' 116 'image2' 'IMAGE'
Connect 98 'images' 116 'image3' 'IMAGE'
Connect 142 'images' 116 'image4' 'IMAGE'

# Saved node modes mirror the default booleans before the frontend controller
# performs its first synchronization.
foreach ($id in 112, 113, 114, 168, 169, 172, 173, 175) { (Get-Node $id)['mode'] = 4 }
foreach ($id in 74, 99, 102, 103, 104, 72, 145) { (Get-Node $id)['mode'] = 4 }
(Get-Node 141)['mode'] = 4

# Canonical layout follows the product flow diagram: inputs and optional
# preparation on the left, relief branches in the middle, first render then
# optional local editing on the right. Controls and diagnostics live on
# separate rows so they cannot collide with the main graph.
$wf['groups'] = @($wf['groups'] | Where-Object { [int]$_['id'] -ne 6 })
$wf['groups'] += ,[ordered]@{
    id = 21; title = '[Output] 最终结果预览与保存'
    bounding = @(13000, 0, 850, 1250); color = '#8A8'; flags = [ordered]@{}
}
$wf['groups'] += ,[ordered]@{
    id = 23; title = '[Stage 1] 凸部 GPT 编辑｜红色参考'
    bounding = @(3490, 490, 440, 560); color = '#a83b4d'; flags = [ordered]@{}
}
$wf['groups'] += ,[ordered]@{
    id = 24; title = '[Stage 2] 凹部 GPT 编辑｜蓝色参考'
    bounding = @(3940, 490, 440, 560); color = '#356fc4'; flags = [ordered]@{}
}
$wf['groups'] += ,[ordered]@{
    id = 25; title = '[Stage 3] 细节 GPT 编辑｜绿色参考'
    bounding = @(4390, 490, 440, 560); color = '#37945c'; flags = [ordered]@{}
}

Set-GroupBox 1 0 0 700 1250 '[Input] 徽章平面图 + 色块分区图'
Set-GroupBox 5 750 0 800 650 '[Prep] 色块对齐 + RMBG 前景提取'
Set-GroupBox 10 1600 0 1200 1250 '[Mask] Multi Color Mask｜凸起 / 凹陷 / 细节'
Set-GroupBox 7 2900 0 500 720 '[Input] 浮雕 Slider 语义 + GPT A 设置'
Set-GroupBox 8 3450 0 4800 1150 '[Relief] 双路浮雕高度编辑｜Bypass 总控'
Set-GroupBox 26 3490 40 1460 380 '[Shared] 三区 Mask Overlay｜A / B 共用'
Set-GroupBox 16 3490 450 1460 650 '[Relief A] GPT Slider 语义编辑'
Set-GroupBox 17 5300 40 2900 1070 '[Relief B] Badge Relief｜高度图 + 法线图生图'
Set-GroupBox 12 8500 0 1850 1000 '[Generate] 首次徽章实物效果图'
Set-GroupBox 13 10400 0 2080 1050 '[Post] 可选局部材质修改｜总控'
Set-GroupBox 19 10420 40 460 880 '[Post A] 无参考图｜Mask Inpaint'
Set-GroupBox 20 10890 40 880 600 '[Post B] 使用材质参考图'
Set-GroupBox 18 12550 40 420 520 '[Output] 可选透明背景'
Set-GroupBox 3 8500 1100 500 350 '[Input] 效果图提示词'
Set-GroupBox 11 9050 1100 350 350 '[Input] GPT 效果图设置'
Set-GroupBox 4 10400 1100 1250 600 '[Input] 局部修改区域 + 材质参考'
Set-GroupBox 2 0 1350 2650 560 '[Input] Boolean 控制面板与自动 Bypass'
Set-GroupBox 14 0 2150 2700 900 '[Record] 主流程关键步骤 Image Reel'
Set-GroupBox 9 2750 2150 3000 1000 '[Record] 浮雕等级参考 Image Reel'
Set-GroupBox 15 0 3300 2200 1200 '[Reference] 未接入参考图（保留）'

Set-NodeBox 60 30 50
Set-NodeBox 124 30 580
Set-NodeBox 57 30 1090
Set-NodeBox 58 290 1100
Set-NodeBox 59 290 1150

Set-NodeBox 137 780 50
Set-NodeBox 78 780 320
Set-NodeBox 75 1150 50
Set-NodeBox 138 1150 500

Set-NodeBox 109 1630 50 330 445
Set-NodeBox 110 1990 50 330 445
Set-NodeBox 111 2350 50 330 445
Set-NodeBox 128 1630 530
Set-NodeBox 129 1990 530
Set-NodeBox 130 2350 530
Set-NodeBox 131 1630 710
Set-NodeBox 132 1990 710
Set-NodeBox 121 1630 890 330 260
Set-NodeBox 122 1990 890 330 260
Set-NodeBox 120 2350 890 330 260

Set-NodeBox 85 2930 50
Set-NodeBox 171 2930 400

Set-NodeBox 165 3510 90 420 270
Set-NodeBox 166 3960 90 420 270
Set-NodeBox 167 4410 90 420 270
Set-NodeBox 125 3510 530 420 455
Set-NodeBox 126 3960 530 420 455
Set-NodeBox 127 4410 530 420 455

Set-NodeBox 112 5330 80 500 900
Set-NodeBox 113 5860 80 320 300
Set-NodeBox 168 5860 410 420 270
Set-NodeBox 169 6310 410 420 270
Set-NodeBox 114 5860 700 850 330
Set-NodeBox 173 6780 80 420 250
Set-NodeBox 175 6780 360
Set-NodeBox 172 7250 80 500 650

Set-NodeBox 80 8530 50 500 350
Set-NodeBox 64 9060 50
Set-NodeBox 98 9500 50 780 600

Set-NodeBox 74 10430 80 420 455
Set-NodeBox 99 10430 560 420 300
Set-NodeBox 102 10920 80
Set-NodeBox 145 11310 80
Set-NodeBox 103 11810 80 630 550
Set-NodeBox 141 12580 80
Set-NodeBox 142 13030 50 760 600
Set-NodeBox 143 13030 690 760 520

Set-NodeBox 66 8530 1150
Set-NodeBox 65 9080 1150
Set-NodeBox 104 10430 1150
Set-NodeBox 72 10810 1150 400 300
Set-NodeBox 70 11240 1150

Set-NodeBox 61 30 1400 510 430
Set-NodeBox 135 570 1400
Set-NodeBox 136 570 1640
Set-NodeBox 153 1010 1400
Set-NodeBox 154 1410 1400
Set-NodeBox 155 1810 1400
Set-NodeBox 156 2210 1400
Set-NodeBox 157 1010 1650
Set-NodeBox 158 1410 1650
Set-NodeBox 159 1810 1650

Set-NodeBox 105 30 2200
Set-NodeBox 108 340 2200
Set-NodeBox 115 650 2200
Set-NodeBox 116 960 2200
Set-NodeBox 106 1270 2200
Set-NodeBox 107 1590 2200

Set-NodeBox 92 2780 2200
Set-NodeBox 93 3070 2200
Set-NodeBox 94 3360 2200
Set-NodeBox 95 2780 2570
Set-NodeBox 96 3070 2570
Set-NodeBox 97 3360 2570
Set-NodeBox 88 3650 2200
Set-NodeBox 91 3960 2200
Set-NodeBox 89 4270 2400
Set-NodeBox 90 4580 2200

Set-NodeBox 56 30 3350
$wf['extra']['ds']['scale'] = 0.12
$wf['extra']['ds']['offset'] = @(100, 100)

# Recompute all serialized input/output link metadata from the authoritative
# link table, then perform structural checks before writing the new workflow.
Rebuild-LinkMetadata

$nodeIds = @($wf['nodes'] | ForEach-Object { [int]$_['id'] })
if (($nodeIds | Sort-Object -Unique).Count -ne $nodeIds.Count) { throw 'Duplicate node ids found' }
$linkIds = @($wf['links'] | ForEach-Object { [int]$_[0] })
if (($linkIds | Sort-Object -Unique).Count -ne $linkIds.Count) { throw 'Duplicate link ids found' }
$groupIds = @($wf['groups'] | ForEach-Object { [int]$_['id'] })
if (($groupIds | Sort-Object -Unique).Count -ne $groupIds.Count) { throw 'Duplicate group ids found' }

$wf['last_node_id'] = ($nodeIds | Measure-Object -Maximum).Maximum
$wf['last_link_id'] = ($linkIds | Measure-Object -Maximum).Maximum
$wf['revision'] = [int]$wf['revision'] + 1

$json = $wf | ConvertTo-Json -Compress -Depth 100
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($Destination, $json, $utf8NoBom)

Write-Output "Created: $Destination"
Write-Output "Nodes: $($wf['nodes'].Count); Links: $($wf['links'].Count); Groups: $($wf['groups'].Count)"
