"""Demonstrate an unverified npm publisher passing the actual JS preflight."""
import os
from pathlib import Path
import subprocess
import tempfile

base = Path('/tmp/issue-209-templates/js-ai-driven-development-pipeline-template')
with tempfile.TemporaryDirectory(prefix='preflight-probe-') as directory:
    fixture = Path(directory)
    (fixture/'token.json').write_text('{"token":"stub-token"}')
    (fixture/'post_status').write_text('202')
    (fixture/'whoami_status').write_text('403')
    (fixture/'whoami.json').write_text('{}')
    result = subprocess.run(['bash', 'scripts/preflight-credentials.sh'], cwd=base,
        env={**os.environ, 'PATH': f'{base}/tests/fixtures/preflight-stub:{os.environ["PATH"]}',
             'PREFLIGHT_FIXTURE_DIR': str(fixture), 'PREFLIGHT_MODE':'release',
             'ACTIONS_ID_TOKEN_REQUEST_URL':'https://example.invalid/oidc', 'NPM_TOKEN':'',
             'DOCKERHUB_USERNAME':'acme', 'DOCKERHUB_TOKEN':'test-password', 'DOCKERHUB_IMAGE':'acme/widget'},
        capture_output=True, text=True)
    print(result.stdout)
    print(f'Exit status: {result.returncode}; no request to npm package-specific token exchange was performed.')
    if result.returncode != 0:
        raise SystemExit('Unexpected reproduction outcome')
