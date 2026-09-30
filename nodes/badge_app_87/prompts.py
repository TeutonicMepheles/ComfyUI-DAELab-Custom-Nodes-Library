"""Compatibility entry points: select content by roles, never by Chinese wording."""
from .prompt_assembler import assemble, join, manifest, render

# Keep the existing iterable contract for callers, including Badge 8.8.
SURFACES = {key: (render(f'materials/{key}/surface'), render(f'materials/{key}/avoid'))
            for key in manifest()['materials']}


def material_details(material_id, material, config):
    if material_id in manifest()['materials']:
        surface = render(f'materials/{material_id}/surface')
        avoid = render(f'materials/{material_id}/avoid')
    else:
        surface = material.get('semantic', '')
        avoid = material.get('avoid', render('fragments/default_avoid'))
    intrinsic = material.get('intrinsic_color_hex')
    color = (render('constraints/material_intrinsic', material_label=material.get('label', render('fragments/default_material_label')), intrinsic_color_hex=intrinsic)
             if config.get('color_policy') == 'material_intrinsic' and intrinsic else render('constraints/preserve_color'))
    result = assemble('material', dict(surface=surface, avoid=avoid,
                      base_prompt=config.get('base_prompt', ''), additional_details=config.get('additional_details', '')),
                      flags={'has_base_prompt': bool(config.get('base_prompt')), 'has_additional_details': bool(config.get('additional_details'))},
                      slots={'color_rule': color})
    return result


def build_prompt(user_prompt, details='', height=None, text_only=False):
    return assemble('build', dict(user_prompt=user_prompt, height=height, product_image_index=1, height_image_index=2),
                    flags={'has_user_prompt': bool(user_prompt), 'has_design': not text_only, 'has_height': height is not None},
                    slots={'details': details})


def masked_prompt(details):
    return assemble('local_material', slots={'details': details})


def semantic_prompt(user_prompt):
    return assemble('local_semantic', {'user_prompt': user_prompt})


def studio_prompt(user_prompt):
    return assemble('studio', {'user_prompt': user_prompt})


def original_color_prompt(index, custom=False, reference_only=False):
    if custom:
        role = render('references/text_product_role' if reference_only else 'references/current_product_role')
        result = render('references/uploaded_color', color_image_index=index, product_role=role)
        return result
    return render('references/original_color', color_image_index=index)


def color_finish_prompt(user_prompt='', local=False, exceptions='', custom=False):
    suffix = '_uploaded' if custom else ''
    return assemble('color_finish', {'user_prompt': user_prompt, 'exceptions': exceptions},
                    flags={'has_user_prompt': bool(user_prompt), 'has_exceptions': bool(exceptions), 'has_photography': not local},
                    slots={'color_rule': render('constraints/color_finish' + suffix),
                           'color_exceptions': render('constraints/color_exceptions' + suffix),
                           'finish_rule': render('constraints/local_finish' if local else 'photography/color_finish')})


def material_strength_prompt(prompt, strength):
    return join(prompt, render('fragments/material_strength', percent=f'{float(strength)*100:.0f}'), separator='\n')


def color_exception(config, material):
    return render('fragments/color_exception', source_color=config.get('color', render('fragments/default_source_color')),
                  material_label=material.get('label', ''), intrinsic_color_hex=material.get('intrinsic_color_hex', ''))
