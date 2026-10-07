#!/usr/bin/env python3
"""Verify a fresh consumer shares command-stream's current direct crates."""

import argparse
import json
from pathlib import Path
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--rust-root", type=Path, default=Path(__file__).resolve().parents[2] / "rust"
    )
    args = parser.parse_args()
    latest = {"nix": "0.31.3", "vt100": "0.16.2", "which": "8.0.6"}
    with tempfile.TemporaryDirectory(prefix="command-stream-consumer-") as directory:
        root = Path(directory)
        (root / "src").mkdir()
        (root / "src/main.rs").write_text("fn main() {}\n")
        manifest = root / "Cargo.toml"
        manifest.write_text(
            '[package]\nname = "fresh-consumer"\nversion = "0.0.0"\nedition = "2021"\n'
            "[dependencies]\ncommand-stream = { path = "
            + json.dumps(str(args.rust_root.resolve()))
            + " }\n"
            + "".join(f'{name} = "{version}"\n' for name, version in latest.items())
        )
        metadata = json.loads(
            subprocess.check_output(
                ["cargo", "metadata", "--manifest-path", str(manifest), "--format-version", "1"],
                text=True,
            )
        )
        subprocess.run(
            ["cargo", "tree", "--manifest-path", str(manifest), "-d"], check=True
        )
        packages = {package["id"]: package for package in metadata["packages"]}
        stream = next(p for p in packages.values() if p["name"] == "command-stream")
        node = next(n for n in metadata["resolve"]["nodes"] if n["id"] == stream["id"])
        direct = {packages[dep["pkg"]]["name"]: dep["pkg"] for dep in node["deps"]}
        consumer = next(n for n in metadata["resolve"]["nodes"] if n["id"] == metadata["resolve"]["root"])
        shared = {packages[dep["pkg"]]["name"]: dep["pkg"] for dep in consumer["deps"]}
        for name, version in latest.items():
            actual = packages[direct[name]]["version"]
            assert actual == version, f"command-stream uses {name} {actual}, latest is {version}"
            assert direct[name] == shared[name], f"consumer resolves a second direct {name}"
            print(f"Shared direct dependency: {name} {actual}")
        versions = sorted(p["version"] for p in packages.values() if p["name"] == "nix")
        print(f"All nix versions in the graph: {versions}")
        if len(versions) > 1:
            print("Upstream limit: portable-pty 0.9.0 still depends on nix 0.28.0.")


if __name__ == "__main__":
    main()
