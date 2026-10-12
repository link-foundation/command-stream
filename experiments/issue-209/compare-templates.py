"""Inventory complete pinned templates and compare every local CI file."""
import csv
import difflib
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'dev/log/issues/209/pulls/210/analysis'
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'template-diffs').mkdir(exist_ok=True)
LANGUAGES = ['js', 'rust', 'python']


def tracked(path):
    return subprocess.check_output(['git', 'ls-files'], cwd=path).decode().splitlines()


def relevant(name):
    return (name.startswith(('.github/', 'scripts/', '.husky/')) or
            name in {'package.json', 'Cargo.toml', 'Cargo.lock', 'pyproject.toml',
                     'eslint.config.js', '.prettierrc', '.prettierignore', '.secretlintrc.json',
                     '.secretlintignore', '.lintstagedrc.json', 'BEST-PRACTICES.md'} or
            'config' in name and not name.startswith(('src/', 'tests/', 'examples/')))


def disposition(name, lang):
    if any(x in name.lower() for x in ['docker', 'helm', 'chart', 'tauri', 'android', 'ios', 'electron', 'desktop']):
        return 'Not applicable: command-stream publishes libraries, no container/chart/mobile/desktop artifacts'
    if relevant(name):
        return ('Compare transferable CI policy; Python distribution/release implementation is not applicable'
                if lang == 'python' else 'Compare/adapt CI policy and language package scripts to monorepo')
    if name.startswith(('src/', 'examples/', 'tests/', 'test/')):
        return 'Template example implementation/fixtures, not command-stream runtime; retain equivalent local behavior/tests'
    return 'Repository documentation/metadata/assets; retain local package-specific content and compare relevant policy'


templates = {}
for lang in LANGUAGES:
    base = Path('/tmp/issue-209-templates') / f'{lang}-ai-driven-development-pipeline-template'
    names = tracked(base)
    templates[lang] = (base, names)
    records = []
    for name in names:
        path = base / name
        payload = path.read_bytes() if path.is_file() else b''
        records.append({'path': name, 'sha256': hashlib.sha256(payload).hexdigest(),
                        'bytes': len(payload), 'ci_related': relevant(name), 'disposition': disposition(name, lang)})
    (OUT / f'{lang}-complete-file-comparison.json').write_text(json.dumps(records, indent=2) + '\n')
    with (OUT / f'{lang}-complete-file-comparison.csv').open('w') as stream:
        writer = csv.DictWriter(stream, fieldnames=records[0].keys())
        writer.writeheader(); writer.writerows(records)

local = sorted(set(tracked(ROOT)) | {str(p.relative_to(ROOT)) for folder in ['.github/scripts', 'js/scripts', 'rust/scripts', 'experiments/issue-209'] for p in (ROOT/folder).rglob('*') if p.is_file()})
local = [name for name in local if name.startswith(('.github/', 'js/scripts/', 'rust/scripts/', '.husky/'))]
rows = []
for name in local:
    path = ROOT/name
    if not path.is_file(): continue
    matches = {}
    for lang, (base, names) in templates.items():
        candidate = name.removeprefix('js/').removeprefix('rust/')
        options = [n for n in names if relevant(n) and (n == candidate or Path(n).name == Path(name).name)]
        role_match = False
        if not options and name.startswith('.github/workflows/') and Path(name).name in {
            'js.yml', 'rust.yml', 'quality.yml', 'parity.yml', 'docs.yml'
        }:
            # Templates keep these validation/release roles in one workflow;
            # this monorepo separates them. Compare roles despite different names.
            release = '.github/workflows/release.yml'
            if release in names:
                options = [release]
                role_match = True
        if not options:
            matches[lang] = 'Local-specific; covered by principle/workflow matrix'
            continue
        upstream = options[0]
        left = (base/upstream).read_text(errors='replace')
        right = path.read_text(errors='replace')
        equal = left == right
        matches[lang] = f'{upstream}: ' + ('identical' if equal else 'adapted/diff preserved')
        if role_match:
            matches[lang] += ' (workflow role comparison)'
        if not equal:
            patch = ''.join(difflib.unified_diff(left.splitlines(True), right.splitlines(True),
                fromfile=f'{lang}-template/{upstream}', tofile=name))
            (OUT/'template-diffs'/f'{lang}--{name.replace("/", "__")}.patch').write_text(patch)
    rows.append({'file': name, **matches})
(OUT/'local-ci-file-comparison.json').write_text(json.dumps(rows, indent=2)+'\n')
with (OUT/'local-ci-file-comparison.csv').open('w') as stream:
    writer = csv.DictWriter(stream, fieldnames=['file', *LANGUAGES]); writer.writeheader(); writer.writerows(rows)
print(json.dumps({'template_files': {lang:len(names) for lang, (_,names) in templates.items()}, 'local_ci_files':len(rows)}))
