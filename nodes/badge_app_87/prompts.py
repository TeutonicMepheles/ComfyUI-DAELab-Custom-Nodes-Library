"""Chinese prompt templates for existing 8.7 calls; no execution policy."""

SURFACES = {
    'baked_enamel': ('形成均匀、不透明、致密平滑的热固化漆膜，以柔和连续高光表现适度光泽。替换旧材质微纹理，保留原有图案。', '透明露底、金属拉丝、闪粉、橘皮和厚塑料感'),
    'transparent_lacquer': ('在现有底层表面叠加薄而清澈的透明保护漆膜，保留底层图案、纹理和材质响应，仅增加清漆高光与轻微光学层次。', '新增拉丝或金属底、雾感、厚胶滴，以及让整个产品透明或透出背景'),
    'satin_gold': ('形成细腻均匀的缎面金属表面，呈现宽而柔和的金属反射、微细哑光纹理和受控高光。', '镜面反射、塑料感、金箔褶皱、粗拉丝和锈蚀'),
    'satin_silver': ('形成细腻均匀的缎面金属表面，呈现宽而柔和的金属反射、微细哑光纹理和清晰曲面层次。', '镜面铬、塑料感、粗喷砂、明显划痕和氧化斑'),
    'glitter': ('在薄透明涂层中均匀嵌入细小闪粉，保留可辨认的底层图案。颗粒形成自然离散的细小反光，尺寸小于附近图案细节，多个区域保持协调尺度。', '大亮片、彩纸、星形光效、白噪声、浮游颗粒和遮盖文字'),
    'rhinestone': ('形成规整排列的小型切面水钻，单颗晶体可辨，具有局部折射、受控点状高光和细小接触阴影。尺寸与区域及徽章比例协调，狭窄处减少数量，晶体完整收在边界内。允许晶体尺度的微小凸起，保留宏观浮雕。', '巨大宝石、珍珠、铆钉、连续玻璃块、拉长或越界晶体和遮盖文字'),
}


def join(*parts):
    return '\n\n'.join(str(p).strip() for p in parts if str(p or '').strip())


def material_details(material_id, material, config):
    surface, avoid = SURFACES.get(material_id, (material.get('semantic', ''), material.get('avoid', '无关表面效果')))
    intrinsic = material.get('intrinsic_color_hex')
    color = (f'颜色：仅在选区内使用{material.get("label", "目标材质")}本色（{intrinsic}），保留图案和颜色区域边界。'
             if config.get('color_policy') == 'material_intrinsic' and intrinsic else
             '颜色：保留输入图对应位置的底色、主要色相和配色关系。材质名称不作为改色依据；允许自然高光和反射造成局部明暗及饱和度变化，不整体染色或调曝光。')
    return join('材质：'+surface, color,
                '材质补充：'+str(config['base_prompt']) if config.get('base_prompt') else '',
                '补充要求：'+str(config['additional_details']) if config.get('additional_details') else '',
                '避免：'+avoid+'。')


def build_prompt(user_prompt, details='', height=None, text_only=False):
    return join('任务：生成写实的徽章产品效果图。',
                '用户要求：'+user_prompt if user_prompt else '',
                '' if text_only else '输入依据：图1提供原稿图案、文字、底色、轮廓与构图。保留这些设计信息，形成合理的产品厚度和表面表现，不新增图形区域。',
                ('高度依据：图2仅提供浮雕高度，不提供底色。黑色代表镂空或无实体，按配置灰阶形成对应高度并保留边界。配置：'+str(height)) if height is not None else '',
                details,
                '摄影表现：徽章底边接触水平台面，主体近乎直立并略向后倾，呈自然斜立姿态；镜头光轴垂直于徽章正面，正面朝向镜头，与原平面图保持一致的正视轮廓、比例和构图，不产生侧视、俯视或梯形透视缩短。纯白无缝背景，柔和棚拍主光与适度补光，轻微自然接触阴影，避免过曝；完整展示产品。',
                '保持项：不新增无关文字、水印、道具或装饰。')


def masked_prompt(details):
    return join('任务：仅替换编辑遮罩指定区域的材质。当前效果图提供图案、底色、宏观几何、视角和光照依据。', details,
                '融合：继承现有光照与视角，按目标材质形成局部高光、反射和阴影，不重新布光。',
                '保持项：保留原有图案、文字内容与字形、位置、比例、外轮廓和宏观浮雕；遮罩外内容不变，不新增边框或装饰。')


def semantic_prompt(user_prompt):
    return join('任务：仅在编辑遮罩指定区域内执行用户要求。', '用户要求：'+user_prompt,
                '保持项：保留本次未要求改变的图案、文字、颜色、几何及光照，保持构图；遮罩外内容不变，不扩大编辑范围。')


def studio_prompt(user_prompt):
    return join('任务：生成白色无缝背景棚拍图。徽章底边接触水平台面，主体近乎直立并略向后倾，呈自然斜立姿态；镜头光轴垂直于徽章正面，正面朝向镜头，与原平面图保持一致的正视轮廓、比例和构图，不产生侧视、俯视或梯形透视缩短；完整展示正面，柔和主光及自然接触阴影，不出现支架。', '用户要求：'+user_prompt,
                '保持项：保留产品轮廓、比例、文字、图案、底色、材质分区和宏观浮雕；按摄影要求调整光照与背景，不替换产品材质或新增装饰。')


def original_color_prompt(index):
    return f'参考分工：图1为当前待处理图，决定结构、图案和现有材质；图{index}为原平面稿，仅作为对应设计区域的底色与配色依据，不复制其平面姿态、背景或光照。除用户明确改色或指定材质本色的区域外，遵从原稿底色；保留合理的材质反射与明暗，不把原稿叠贴到效果图上。'


def color_finish_prompt(user_prompt='', local=False, exceptions=''):
    return join('任务：对图1完成最终底色校正，图2仅提供原平面稿的配色参考。',
                '校色：按对应设计区域修正偏离原稿的底色和主要色相，保留材质高光、金属反射、透明漆、闪粉和水钻的光学表现，不复制原稿背景或平面质感。',
                '保持项：保留图1的文字内容及字形、图案、轮廓、区域边界、材质分区和宏观浮雕，不重绘或抹平细节。',
                '颜色例外：'+exceptions if exceptions else '',
                '用户要求：'+user_prompt if user_prompt else '',
                '保留用户明确要求的改色，其余区域以原稿底色为准。',
                '局部编辑收尾：保持图1的视角、构图、背景和光照，不重新布光；后续仅合成原编辑选区。' if local else
                '摄影表现：徽章底边接触白色台面，近乎直立并略向后倾斜立；镜头光轴垂直于徽章正面，保持原稿的正视轮廓与比例。白色无缝背景、柔和棚拍光和自然接触阴影，不出现支架。')
