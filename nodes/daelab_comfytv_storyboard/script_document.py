"""Lossless DOCX table inventory for ScriptParser; no ComfyUI or network imports.

Rows/cells are physical XML occurrences. Vertical merges reference their anchor;
image occurrences never collapse merely because their binary data is identical.
"""
import hashlib
import io
import posixpath
import re
import zipfile
from xml.etree import ElementTree as ET

MAX_DOCUMENT_SIZE = 20 * 1024 * 1024
MAX_ARCHIVE_SIZE = 128 * 1024 * 1024
MAX_ROWS = 500
MAX_COLUMNS = 64
NS = {
    'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    'v': 'urn:schemas-microsoft-com:vml',
}
ROLES = ('shot_no', 'time_range', 'scene', 'narration', 'subtitle', 'notes', 'chapter', 'reference', 'other')
ROLE_LABELS = dict(zip(ROLES, ('镜号', '时间', '画面', '旁白', '字幕', '备注', '章节', '参考图', '保留原文')))
KINDS = ('task', 'title', 'header', 'blank', 'review')


def q(name):
    prefix, local = name.split(':')
    return '{' + NS[prefix] + '}' + local


def xml(data):
    if b'<!DOCTYPE' in data or b'<!ENTITY' in data:
        raise ValueError('文档 XML 不允许外部实体')
    return ET.fromstring(data)


def text_content(element):
    """Preserve paragraphs/tabs/breaks, including tracked visible insertions.

Deleted text and instruction text are not displayed Word content. Text boxes
remain visible text but are flagged separately for manual attribution.
"""
    pieces = []
    def walk(e):
        if e.tag == q('w:del'):
            return
        if e.tag == q('w:t'):
            pieces.append(e.text or '')
        elif e.tag == q('w:tab'):
            pieces.append('\t')
        elif e.tag in (q('w:br'), q('w:cr')):
            pieces.append('\n')
        else:
            for child in e:
                walk(child)
            if e.tag == q('w:p'):
                pieces.append('\n')
    walk(element)
    return ''.join(pieces).removesuffix('\n')


def header_role(text):
    value = re.sub(r'\s+', '', text).strip('：:')
    if re.fullmatch(r'(镜号|序号|编号|镜头号|分镜号|序)', value):
        return 'shot_no'
    if value in ('时间', '时长', '时间段', '时码', '秒数'):
        return 'time_range'
    if value in ('旁白', '文案旁白', '配音旁白', '解说', '解说词', '配音', '文案', '旁白文案'):
        return 'narration'
    if value in ('字幕', '屏幕文字'):
        return 'subtitle'
    if value in ('备注', '镜头备注', '运镜', '镜头', '景别'):
        return 'notes'
    if value in ('章节', '段落', '篇章', '章节名称'):
        return 'chapter'
    if value in ('画面参考', '参考图', '图片', '参考图片'):
        return 'reference'
    if value in ('画面', '画面内容', '画面描述', '内容设计', '设计描述', '场景', '内容', '描述', '视觉设计', '创意设计'):
        return 'scene'
    return 'other'


def parse_docx(payload, filename='document.docx'):
    """Return (JSON inventory, {asset_id: original bytes}). No truncation."""
    if not filename.lower().endswith('.docx'):
        raise ValueError('首版仅支持 DOCX 表格')
    if not payload or len(payload) > MAX_DOCUMENT_SIZE:
        raise ValueError('文档为空或超过 20 MiB')
    try:
        archive = zipfile.ZipFile(io.BytesIO(payload))
    except zipfile.BadZipFile as exc:
        raise ValueError('不是有效 DOCX 文件') from exc
    with archive:
        if sum(i.file_size for i in archive.infolist()) > MAX_ARCHIVE_SIZE:
            raise ValueError('文档解压体积超过 128 MiB')
        if len(archive.infolist()) > 10000:
            raise ValueError('文档文件项过多')
        try:
            document = xml(archive.read('word/document.xml'))
        except (KeyError, ET.ParseError) as exc:
            raise ValueError('文档缺少可读取的正文 XML') from exc
        relationships = {}
        if 'word/_rels/document.xml.rels' in archive.namelist():
            for rel in xml(archive.read('word/_rels/document.xml.rels')):
                relationships[rel.get('Id')] = rel.attrib
        fingerprint = hashlib.sha256(payload).hexdigest()
        inventory = dict(version=1, document_id=fingerprint, filename=filename,
                         tables=[], paragraphs=[], assets={}, occurrences=[], warnings=[])
        blobs, parents = {}, {child: parent for parent in document.iter() for child in parent}
        body = document.find('w:body', NS)
        if body is None:
            raise ValueError('文档没有正文')
        table_ids = {t: f't{n + 1}' for n, t in enumerate(body.iter(q('w:tbl')))}
        cell_owners, row_owners = {}, {}
        context = []
        for index, element in enumerate(body):
            if element.tag == q('w:p'):
                value = text_content(element)
                paragraph = dict(id=f'p{index + 1}', text=value, order=index)
                inventory['paragraphs'].append(paragraph)
                if value.strip():
                    context.append(paragraph)
            for table in element.iter(q('w:tbl')):
                tid = table_ids[table]
                nested = any(parent.tag == q('w:tc') for parent in _ancestors(table, parents))
                grid = table.find('w:tblGrid', NS)
                columns = len(grid) if grid is not None else 0
                info = dict(id=tid, order=len(inventory['tables']), nested=nested,
                            context=[p['id'] for p in context], columns=columns, rows=[], header=None)
                inventory['tables'].append(info)
                merges = {}
                for ri, row in enumerate(table.findall('w:tr', NS)):
                    rid = f'{tid}/r{ri + 1}'
                    before = row.find('w:trPr/w:gridBefore', NS)
                    column = int(before.get(q('w:val'), '0')) if before is not None else 0
                    entry = dict(id=rid, index=ri + 1, cells=[], images=[], issues=[])
                    row_owners[row] = entry
                    next_merges = {}
                    for ci, cell in enumerate(row.findall('w:tc', NS)):
                        span = cell.find('w:tcPr/w:gridSpan', NS)
                        width = int(span.get(q('w:val'), '1')) if span is not None else 1
                        if width < 1 or column + width > MAX_COLUMNS:
                            raise ValueError(f'{rid} 原始列数超过 64，未截断')
                        cid = f'{rid}/c{column + 1}'
                        vm = cell.find('w:tcPr/w:vMerge', NS)
                        continuation = vm is not None and vm.get(q('w:val'), 'continue') != 'restart'
                        anchor = merges.get(column) if continuation else None
                        # Nested table text has its own rows; don't duplicate it in parent text.
                        own_text = '\n'.join(text_content(p) for p in cell if p.tag != q('w:tbl') and p.tag != q('w:tcPr'))
                        record = dict(id=cid, column=column, colspan=width, rowspan=1,
                                      text=own_text, anchor=anchor['id'] if anchor else None, images=[])
                        if continuation and not anchor:
                            entry['issues'].append('合并单元格缺少锚点')
                        if anchor:
                            anchor['rowspan'] += 1
                        if vm is not None:
                            for c in range(column, column + width):
                                next_merges[c] = anchor or record
                        entry['cells'].append(record)
                        cell_owners[cell] = record
                        if any(t.tag == q('w:tbl') for t in cell):
                            entry['issues'].append('含嵌套表，需确认父行和子表去向')
                        if cell.find('.//w:txbxContent', NS) is not None:
                            entry['issues'].append('含文本框，需核对原文归属')
                        column += width
                    merges = next_merges
                    info['columns'] = max(info['columns'], column)
                    if info['columns'] > MAX_COLUMNS:
                        raise ValueError(f'{tid} 原始列数超过 64，未截断')
                    info['rows'].append(entry)
                # Avoid an unbounded preview, distinct from the confirmed task-row cap.
                if sum(len(t['rows']) for t in inventory['tables']) > 20000:
                    raise ValueError('原始结构超过 20000 行，无法安全预览，未截断')

        for e in body.iter():
            if e.tag not in (q('a:blip'), q('v:imagedata')):
                continue
            chain = list(_ancestors(e, parents))
            cell = next((cell_owners[p] for p in chain if p in cell_owners), None)
            row = next((row_owners[p] for p in chain if p in row_owners), None)
            floating = any(p.tag == q('wp:anchor') for p in chain)
            rel_id = e.get(q('r:embed')) or e.get(q('r:id')) or e.get(q('r:link'))
            rel = relationships.get(rel_id, {})
            occurrence = dict(id=f'image-{len(inventory['occurrences']) + 1}',
                              order=len(inventory['occurrences']), cell_id=cell['id'] if cell else None,
                              row_id=row['id'] if row else None, floating=floating,
                              asset_id=None, issue='', relationship=rel_id)
            if rel.get('TargetMode') == 'External':
                occurrence['issue'] = '外链图片未下载，待补充'
            else:
                part = posixpath.normpath(posixpath.join('word', rel.get('Target', '')))
                if not part.startswith('word/') or part not in archive.namelist():
                    occurrence['issue'] = '图片引用缺失，待补充'
                else:
                    data = archive.read(part)
                    aid = hashlib.sha256(data).hexdigest()
                    blobs[aid] = data
                    inventory['assets'][aid] = dict(id=aid, name=posixpath.basename(part), part=part, size=len(data))
                    occurrence['asset_id'] = aid
            if floating or not row:
                occurrence['issue'] = occurrence['issue'] or '图片归属需手工确认'
            if cell:
                cell['images'].append(occurrence['id'])
            if row:
                row['images'].append(occurrence['id'])
            inventory['occurrences'].append(occurrence)
        for table in inventory['tables']:
            _suggest(table)
        return inventory, blobs


def _ancestors(e, parents):
    while e in parents:
        e = parents[e]
        yield e


def _suggest(table):
    for row in table['rows'][:10]:
        roles = [header_role(c['text']) for c in row['cells']]
        if sum(r != 'other' for r in roles) >= 2:
            table['header'] = row['id']
            table['mapping'] = {str(c['column']): r for c, r in zip(row['cells'], roles)}
            break
    table.setdefault('mapping', {})
    header_index = next((r['index'] for r in table['rows'] if r['id'] == table['header']), 0)
    for row in table['rows']:
        nonempty = [c for c in row['cells'] if c['text'].strip()]
        if row['id'] == table['header']:
            kind, reason = 'header', '识别到字段名称，请核对表头'
        elif row['index'] < header_index:
            kind, reason = 'title', '位于所选表头之前，保留为标题/上下文'
        elif not nonempty and not row['images'] and not any(c['anchor'] for c in row['cells']):
            kind, reason = 'blank', '没有文字、图片或合并引用'
        elif len(row['cells']) == 1 and row['cells'][0]['colspan'] > 1 and not row['images']:
            kind, reason = 'title', '整行合并文字，建议为章节标题'
        elif not table['header'] or table['nested'] or row['issues']:
            kind, reason = 'review', '结构或字段归属需要确认'
        else:
            kind, reason = 'task', '表头后的数据行，一行一任务'
        row.update(kind=kind, reason=reason)


def normalize_inventory(inventory, choices):
    """Only choose classifications/mappings/occurrence assignments, never rewrite text."""
    if not isinstance(choices, dict):
        raise ValueError('需要选表及映射配置')
    selected = choices.get('tables', {})
    if not isinstance(selected, dict) or set(selected) - {t['id'] for t in inventory['tables']}:
        raise ValueError('所选表来源不存在')
    cells = {c['id']: c for t in inventory['tables'] for r in t['rows'] for c in r['cells']}
    occurrences = {o['id']: o for o in inventory['occurrences']}
    tasks, audit, unknown = [], [], []
    for table in inventory['tables']:
        spec = selected.get(table['id'])
        if spec is None:
            audit.extend(dict(row_id=r['id'], kind='excluded', reason='用户未选此表') for r in table['rows'])
            continue
        if not isinstance(spec, dict):
            raise ValueError('每张表的映射必须是对象')
        mapping = spec.get('mapping', table['mapping'])
        if not isinstance(mapping, dict) or any(str(i) not in {str(n) for n in range(table['columns'])} or role not in ROLES for i, role in mapping.items()):
            raise ValueError(f"{table['id']} 字段映射不合法")
        overrides = spec.get('rows', {})
        if not isinstance(overrides, dict) or set(overrides) - {r['id'] for r in table['rows']}:
            raise ValueError('归类包含不存在的原始行')
        cell_roles = spec.get('cell_roles', {})
        table_cells = {c['id'] for r in table['rows'] for c in r['cells']}
        if not isinstance(cell_roles, dict) or set(cell_roles) - table_cells or any(v not in ROLES for v in cell_roles.values()):
            raise ValueError('单元格归类来源或角色无效')
        header = spec.get('header', table['header'])
        if header is not None and header not in {r['id'] for r in table['rows']}:
            raise ValueError('表头来源不存在')
        header_index = next((r['index'] for r in table['rows'] if r['id'] == header), 0)
        context_text = [p['text'] for p in inventory['paragraphs'] if p['id'] in table['context']]
        chapter = next((p for p in reversed(context_text) if re.match(r'^第.{1,5}篇章|^[一二三四五六七八九十]+[、.]', p)), '')
        for row in table['rows']:
            default = 'header' if row['id'] == header else 'title' if row['index'] < header_index else row['kind']
            if default == 'header' and row['id'] != header:
                default = 'review'
            kind = overrides.get(row['id'], default)
            if kind not in KINDS:
                raise ValueError('未知行去向')
            audit.append(dict(row_id=row['id'], kind=kind, reason='用户确认分类' if row['id'] in overrides else row['reason']))
            if kind == 'title':
                chapter = '\n'.join(c['text'] for c in row['cells'] if c['text'].strip())
            if kind not in ('task', 'review'):
                continue
            values = {role: [] for role in ROLES}
            sources = {role: [] for role in ROLES}
            for cell in row['cells']:
                role = cell_roles.get(cell['id'], mapping.get(str(cell['column']), 'other'))
                anchor = cells.get(cell['anchor']) if cell['anchor'] else None
                value = cell['text'] if cell['text'].strip() or not anchor else anchor['text']
                if value.strip():
                    values[role].append(value)
                    sources[role].append(dict(cell_id=cell['id'], anchor=cell['anchor']))
            values = {k: '\n'.join(v) for k, v in values.items()}
            issues = list(row['issues'])
            if not values['scene'].strip():
                issues.append('缺画面文字，待补充')
            if not values['shot_no'].strip():
                issues.append('缺原始镜号')
            elif not re.fullmatch(r'[\d０-９]+(?:[-—.、][\d０-９]+)*', values['shot_no'].strip()):
                issues.append('镜号含非编号文字，已保留原文，请核对')
            if kind == 'review':
                issues.append('原始行待确认')
            tasks.append(dict(source_key=f"{inventory['document_id']}:{row['id']}", row_id=row['id'],
                              table_id=table['id'], values=values, sources=sources,
                              chapter=values['chapter'] or chapter,
                              context=table['context'], original_cells=row['cells'],
                              images=[], issues=issues))
    if len(tasks) > MAX_ROWS:
        raise ValueError(f'确认任务共 {len(tasks)} 行，超过 500 行，未截断')
    targets = {r['row_id']: r for r in tasks}
    assignments = choices.get('images', {})
    if not isinstance(assignments, dict) or set(assignments) - set(occurrences):
        raise ValueError('图片来源不存在')
    for oid, occurrence in occurrences.items():
        default = occurrence['row_id'] if not occurrence['floating'] and occurrence['row_id'] in targets else None
        target = assignments.get(oid, default)
        if target == 'exclude':
            unknown.append(dict(**occurrence, disposition='用户确认不入任务'))
            continue
        if target is not None and target not in targets:
            raise ValueError(f'{oid} 指定的任务行不存在')
        if target is None:
            unknown.append(dict(**occurrence, disposition='待分配'))
            continue
        targets[target]['images'].append(occurrence)
        if occurrence['issue'] and oid not in assignments:
            targets[target]['issues'].append(occurrence['issue'])
        if not occurrence['asset_id']:
            targets[target]['issues'].append('图片引用缺失，待补充')
    return dict(version=1, document_id=inventory['document_id'], filename=inventory['filename'],
                tasks=tasks, audit=audit, unassigned=unknown, paragraphs=inventory['paragraphs'],
                tables=[dict(id=t['id'], context=t['context'], nested=t['nested'], rows=t['rows']) for t in inventory['tables']])
