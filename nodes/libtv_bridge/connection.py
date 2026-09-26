"""Machine-local official CLI connection; never read or expose credentials."""
import atexit
from pathlib import Path
import subprocess
import threading

from .runtime import CLI, MODELS


class Connection:
    def __init__(self, directory, cli=None):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.cli = cli or CLI(timeout=25, cwd=self.directory)
        self._lock = threading.Lock()
        self._login = None
        self._login_state = 'idle'
        atexit.register(self.close)

    def close(self):
        if self._login and self._login.poll() is None:
            self._login.terminate()

    def login(self):
        with self._lock:
            if self._login and self._login.poll() is None:
                return {'state': 'waiting'}
            # Browser and callback run on the ComfyUI host. No auth URL/token is returned.
            self._login = subprocess.Popen(
                [self.cli.executable, 'login', 'web', '--open'], cwd=self.directory,
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            self._login_state = 'waiting'
            threading.Thread(target=self._wait, args=(self._login,), daemon=True).start()
            return {'state': 'waiting'}

    def _wait(self, process):
        try:
            code = process.wait(timeout=300)
            state = 'complete' if code == 0 else 'failed'
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait()
            state = 'expired'
        with self._lock:
            if self._login is process:
                self._login_state = state

    def status(self):
        try:
            result = self.cli('account', 'info')
            account = result.get('activeAccount') or {}
            user = result.get('user') or {}
            if not account or not user:
                return {'connected': False, 'state': 'unverified', 'login': self._login_state}
            return {'connected': True, 'state': 'connected', 'login': self._login_state,
                    'account': str(account.get('accountName') or user.get('nickname') or 'LibTV')}
        except FileNotFoundError:
            return {'connected': False, 'state': 'cli_missing', 'login': self._login_state}
        except (RuntimeError, OSError, subprocess.TimeoutExpired):
            # Network failure is not proof of logout. Do not relay CLI stderr (may contain auth data).
            return {'connected': False, 'state': 'unverified', 'login': self._login_state}

    def projects(self, page=1):
        result = self.cli('project', 'list', '--page', str(page), '--page-size', '50')
        rows = result.get('projectMetaList', result.get('projects', result.get('list', [])))
        return {'page': page, 'projects': [
            {'uuid': str(row.get('uuid') or row.get('projectUuid') or ''),
             'name': str(row.get('name') or row.get('projectName') or 'LibTV canvas')}
            for row in rows if row.get('uuid') or row.get('projectUuid')]}

    def capabilities(self, model):
        if model not in MODELS:
            raise ValueError('Unsupported model')
        matches = self.cli('model', 'search', '--type', 'video').get('matches', [])
        match = next((item for item in matches if item.get('modelKey') == MODELS[model]), None)
        if not match:
            raise ValueError('Model unavailable for this account')
        schema = self.cli('model', match['modelName'])['schema']
        props = schema['properties']
        return {'model': model, 'resolution': props.get('resolution', {}).get('enum', []),
                'ratio': props.get('ratio', {}).get('enum', []),
                'duration': {k: v for k, v in props.get('duration', {}).items() if k in ('min', 'max', 'enum')},
                'modes': ['text2video', *props.get('modeType', {}).get('items', {}).keys()],
                'sound': 'enableSound' in schema.get('config', {}).get('settings', [])}
