"""Audit publishable project files and build a clean ComfyUI installation ZIP."""
from pathlib import Path
import getpass
import hashlib
import os
import re
import struct
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SKIP = {".git", "node_modules", "__pycache__", "test-results", "playwright-report", "dist", ".venv", ".idea", ".vscode"}
TEXT_SUFFIXES = {".py", ".js", ".mjs", ".css", ".json", ".toml", ".md", ".yml", ".yaml", ".html", ""}
PATTERNS = {
    "personal absolute path": re.compile(r"(?i)(?:[a-z]:[\\/](?:Users|Code)[\\/]|/(?:Users|home)/[a-z0-9_.-]+/)"),
    "GitHub token": re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b"),
    "API secret": re.compile(r"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b"),
    "AWS key": re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
}


def repository_files():
    for folder, dirs, files in os.walk(ROOT):
        dirs[:] = [name for name in dirs if name not in SKIP]
        for name in sorted(files):
            path = Path(folder) / name
            if path.suffix.lower() in TEXT_SUFFIXES and not name.startswith(".env"):
                yield path


def audit():
    username = getpass.getuser()
    local_name = re.compile(r"(?i)(?<![a-z0-9_-])" + re.escape(username) + r"(?![a-z0-9_-])") if len(username) > 3 else None
    files = list(repository_files())
    problems = []
    for path in files:
        text = path.read_text(encoding="utf-8")
        for label, pattern in PATTERNS.items():
            if pattern.search(text):
                problems.append((path.relative_to(ROOT).as_posix(), label))
        if local_name and local_name.search(text):
            problems.append((path.relative_to(ROOT).as_posix(), "local account name"))
    # Browser screenshots should contain pixels only, with no text or EXIF metadata.
    preview = ROOT / "docs" / "preview.png"
    data = preview.read_bytes()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        problems.append(("docs/preview.png", "not a PNG"))
    cursor = 8
    while cursor + 12 <= len(data):
        size = struct.unpack(">I", data[cursor:cursor + 4])[0]
        kind = data[cursor + 4:cursor + 8]
        if kind in {b"tEXt", b"zTXt", b"iTXt", b"eXIf"}:
            problems.append(("docs/preview.png", "image metadata"))
        cursor += size + 12
    if problems:
        for relative, label in problems:
            print(f"FAIL {relative}: {label}")
        raise SystemExit("Privacy audit failed; no archive was created.")
    print(f"Privacy audit passed: {len(files)} text files; preview has no text/EXIF metadata.")


def build():
    files = [ROOT / name for name in ("README.md", "CHANGELOG.md", "LICENSE", "pyproject.toml")]
    files.extend(sorted(ROOT.glob("*.py")))
    for directory in ("web", "examples", "docs", "modules"):
        folder = ROOT / directory
        if folder.exists():
            files.extend(sorted(path for path in folder.rglob("*")
                if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc"))
    version = re.search(r'^version\s*=\s*"([^"]+)"', (ROOT / "pyproject.toml").read_text(encoding="utf-8"), re.MULTILINE).group(1)
    output = ROOT / "dist" / f"node-perfector-{version}.zip"
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(set(files)):
            relative = path.relative_to(ROOT).as_posix()
            info = zipfile.ZipInfo("node-perfector/" + relative)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())
    print(f"Built dist/{output.name}: {len(set(files))} files, {output.stat().st_size:,} bytes.")
    print("SHA256 " + hashlib.sha256(output.read_bytes()).hexdigest())


if __name__ == "__main__":
    audit()
    if "--check-only" not in sys.argv:
        build()
