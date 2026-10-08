"""context-copy.v1: explicit text copying guard, not a semantic correctness check."""
import re
import unicodedata

VERSION = 'context-copy.v1'
REASON = '建议疑似将动态引用内容写入固定文字，不能应用'
WINDOW = 6


def _normalize(text):
    # Match JS NFKC -> toLowerCase -> Unicode Letter/Number filtering.
    return ''.join(c for c in unicodedata.normalize('NFKC', text).lower()
                   if unicodedata.category(c)[0] in ('L', 'N'))


def _ordinary_segments(text, protected):
    # Preserve boundaries: never join ordinary text across a protected anchor.
    segments = re.split('|'.join(re.escape(t) for t in protected), text) if protected else [text]
    return [_normalize(segment) for segment in segments]


def _fragments(segments):
    return {segment[i:i + WINDOW] for segment in segments
            for i in range(len(segment) - WINDOW + 1)}


def context_copy_reason(inp, result_text):
    """Inputs are already schema/anchor validated; return a fixed reason or None.

    Only source fragments absent from the original ordinary text are blocked.
    Short details and paraphrases can evade this check; common phrases can match.
    """
    sources = [_normalize(ref['text']) for ref in inp['reference_context']
               if ref.get('kind') == 'text' and isinstance(ref.get('text'), str)]
    if not sources:
        return None
    protected = inp['protected_tokens']
    copied = _fragments(sources) - _fragments(_ordinary_segments(inp['prompt_text'], protected))
    if copied.intersection(_fragments(_ordinary_segments(result_text, protected))):
        return REASON
    return None
