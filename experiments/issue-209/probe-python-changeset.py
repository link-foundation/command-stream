"""Offline reproduction of the template's documented changelog gate contract."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

source = Path(os.environ.get("PYTHON_TEMPLATE", "/tmp/issue-209-templates/python-ai-driven-development-pipeline-template")) / "scripts/validate_changeset.py"
with tempfile.TemporaryDirectory(prefix="python-fragment-") as directory:
    root = Path(directory)
    (root / "scripts").mkdir()
    shutil.copy(source, root / "scripts/validate_changeset.py")
    (root / "src").mkdir()
    (root / "src/code.py").write_text('print("changed source")\n')
    result = subprocess.run(["python3", str(root / "scripts/validate_changeset.py")], capture_output=True, text=True)
    print(result.stdout)
    print("Exit status:", result.returncode, "with source changes and zero fragments")
    assert result.returncode == 0, "reproduction no longer holds"
