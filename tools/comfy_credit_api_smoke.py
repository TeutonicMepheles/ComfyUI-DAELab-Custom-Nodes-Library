"""No-spend HTTP checks against the isolated UI-test server and its receipts."""
import hashlib
import json
from pathlib import Path
import sys
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode

base, user_dir, output_dir = sys.argv[1:]


def request(path, body=None):
    req = Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                  headers={'Content-Type': 'application/json'})
    try:
        with urlopen(req, timeout=20) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


queue_before = request('/queue')[1]
assert not queue_before['queue_running'] and not queue_before['queue_pending']
for model in ('Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini', 'Seedance 2.5', 'Minimax H3',
              'GPT Image 2', 'GPT Image 2.5 Flare', 'GPT Image 2.5 Sunburst'):
    status, caps = request('/daelab/libtv/table/capabilities?' + urlencode(dict(
        kind='image' if model.startswith('GPT') else 'video', model=model)))
    assert status == 200 and caps['provider'] == 'comfy', (model, caps)
assert request('/daelab/libtv/connection/status')[0] == 410
assert request('/daelab/libtv/table/capabilities?kind=image&model=Lib%20Image')[0] == 400

original = dict(config=dict(model='Seedance 2.0 Fast', kind='video', mode='text2video', settings={}),
                project='legacy-test-project', segments=[dict(type='text', text='validation fixture')], assets=[])
for provider in ('libtv', 'comfy'):
    data = dict(original, config=dict(original['config'], provider=provider))
    status, response = request('/daelab/libtv/table/submit', dict(jobs=[dict(
        requestId='credit-no-auth-validation-' + provider, input=data)]))
    assert status == 400 and response['submitted'] is False, response

receipts = Path(user_dir) / 'daelab/libtv/table-jobs'
receipts.mkdir(parents=True, exist_ok=True)
fingerprint = hashlib.sha256(json.dumps(original, sort_keys=True).encode()).hexdigest()
for phase in ('complete', 'needs_recovery'):
    request_id = 'credit-legacy-fixture-' + phase.replace('_', '-')
    state = dict(requestId=request_id, input=original, fingerprint=fingerprint, phase=phase, provider='libtv')
    if phase == 'complete':
        file = Path(output_dir) / 'credit-validation-fixture.txt'
        assert not file.exists(), 'Refusing to overwrite an existing fixture'
        file.write_text('Existing result fixture; not generated media.', encoding='utf-8')
        state['result'] = dict(kind='video', name=file.name, url='/view?' + urlencode(dict(filename=file.name, type='output')))
    (receipts / (request_id + '.json')).write_text(json.dumps(state), encoding='utf-8')
    status, response = request('/daelab/libtv/table/submit', dict(jobs=[dict(requestId=request_id, input=original)]))
    if phase == 'complete':
        assert status == 200 and response['jobs'][0]['phase'] == 'complete', response
        file.unlink()
    else:
        assert status == 400 and response['submitted'] is False and 'LibTV' in response['error'], response
assert request('/queue')[1] == queue_before
print('PASS exact Comfy models, no-auth rejection, disabled LibTV, completed legacy receipt reuse, unfinished legacy recovery blocked; queue unchanged')
