"""Look through, read and tidy the user's files.

Every path must sit inside ``files_root`` (your home folder by default, change
it with ``JARVIS_FILES_ROOT``). Reading and listing just happen. Overwriting,
moving and deleting ask the user first. Deleted files go to the Recycle Bin /
Trash when ``send2trash`` is installed (``pip install -e ".[skills]"``);
without it, JARVIS says in the question that the delete is permanent.
"""

from __future__ import annotations

import fnmatch
import os
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..tools import ToolRegistry

if TYPE_CHECKING:
    from . import SkillsConfig

try:
    from send2trash import send2trash  # type: ignore
except ImportError:  # optional
    send2trash = None

MAX_LIST = 200
MAX_FOUND = 50
MAX_READ_BYTES = 50_000
SEARCH_SECONDS = 10
_SKIP_DIRS = {"node_modules", "__pycache__", "AppData", "Library", ".git", "venv", ".venv"}


def _size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return str(n)


class Files:
    def __init__(self, root: Path, registry: ToolRegistry):
        self.root = Path(root).expanduser().resolve()
        self.registry = registry

    def path(self, raw: str) -> Path:
        """Resolve a user path and make sure it stays inside the root."""
        raw = (raw or "").strip() or "."
        p = Path(raw).expanduser()
        if not p.is_absolute():
            p = self.root / p
        p = p.resolve()
        if p != self.root and not p.is_relative_to(self.root):
            raise PermissionError(f"JARVIS can only work with files inside {self.root}")
        return p

    def show(self, p: Path) -> str:
        return "~" if p == self.root else str(p.relative_to(self.root))


    def list(self, folder: str) -> dict[str, Any]:
        d = self.path(folder)
        if not d.is_dir():
            raise NotADirectoryError(f"'{folder}' is not a folder")
        entries = sorted(d.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
        items = []
        for e in entries[:MAX_LIST]:
            try:
                st = e.stat()
            except OSError:
                continue
            items.append(
                {
                    "name": e.name + ("/" if e.is_dir() else ""),
                    "size": "" if e.is_dir() else _size(st.st_size),
                    "modified": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M"),
                }
            )
        out: dict[str, Any] = {"folder": self.show(d), "items": items}
        if len(entries) > MAX_LIST:
            out["note"] = f"showing {MAX_LIST} of {len(entries)} items"
        return out

    def find(self, pattern: str, folder: str) -> dict[str, Any]:
        start = self.path(folder)
        pat = pattern.strip().lower()
        if not any(c in pat for c in "*?["):
            pat = f"*{pat}*"
        found: list[str] = []
        deadline = time.monotonic() + SEARCH_SECONDS
        for dirpath, dirnames, filenames in os.walk(start):
            dirnames[:] = [n for n in dirnames if not n.startswith(".") and n not in _SKIP_DIRS]
            for name in dirnames + filenames:
                if fnmatch.fnmatch(name.lower(), pat):
                    found.append(self.show(Path(dirpath) / name))
                    if len(found) >= MAX_FOUND:
                        return {"matches": found, "note": f"stopped at {MAX_FOUND} matches"}
            if time.monotonic() > deadline:
                return {"matches": found, "note": "search took too long and was stopped early"}
        return {"matches": found} if found else {"matches": [], "note": "nothing matched"}

    def read(self, file: str) -> str:
        p = self.path(file)
        if not p.is_file():
            raise FileNotFoundError(f"no file at '{file}'")
        data = p.read_bytes()[: MAX_READ_BYTES + 1]
        if b"\x00" in data[:4096]:
            raise ValueError("that looks like a binary file, not text")
        text = data[:MAX_READ_BYTES].decode("utf-8", errors="replace")
        if len(data) > MAX_READ_BYTES:
            text += f"\n\n[cut off: only the first {MAX_READ_BYTES // 1000} KB are shown]"
        return text


    def write(self, file: str, content: str, append: bool) -> str:
        p = self.path(file)
        if p.is_dir():
            raise IsADirectoryError(f"'{file}' is a folder")
        if p.exists() and not append:
            self.registry.ask_user(f"Overwrite {self.show(p)}? Its current contents will be lost.")
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a" if append else "w", encoding="utf-8") as f:
            f.write(content)
        return f"{'Added to' if append else 'Saved'} {self.show(p)}."

    def move(self, source: str, destination: str) -> str:
        src, dst = self.path(source), self.path(destination)
        if not src.exists():
            raise FileNotFoundError(f"nothing at '{source}'")
        if dst.is_dir():
            dst = dst / src.name
        question = f"Move {self.show(src)} to {self.show(dst)}?"
        if dst.exists():
            question = f"Move {self.show(src)} to {self.show(dst)}, replacing the file already there?"
        self.registry.ask_user(question)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        return f"Moved to {self.show(dst)}."

    def delete(self, file: str) -> str:
        p = self.path(file)
        if p == self.root:
            raise PermissionError("not deleting the whole files folder")
        if not p.exists():
            raise FileNotFoundError(f"nothing at '{file}'")
        if p.is_dir() and any(p.iterdir()):
            raise IsADirectoryError("that folder isn't empty; delete the files inside first")
        where = "to the Recycle Bin" if send2trash else "permanently"
        self.registry.ask_user(f"Delete {self.show(p)} {where}?")
        if send2trash:
            send2trash(str(p))
        elif p.is_dir():
            p.rmdir()
        else:
            p.unlink()
        return f"Deleted {self.show(p)}" + (" (it's in the Recycle Bin)." if send2trash else ".")


def register(registry: ToolRegistry, config: "SkillsConfig") -> None:
    files = Files(config.files_root, registry)
    where = f"Paths are relative to the user's files folder ({files.root}); '' means that folder."

    @registry.tool(
        description="List what's in a folder (names, sizes, dates). " + where,
        parameters={"folder": {"type": "string", "description": "e.g. 'Downloads' or ''"}},
    )
    def list_files(folder: str) -> dict[str, Any]:
        return files.list(folder)

    @registry.tool(
        description=(
            "Find files or folders by name under a folder. The pattern matches part of "
            "the name ('invoice') or is a wildcard ('*.pdf'). " + where
        ),
        parameters={"pattern": {"type": "string"}, "folder": {"type": "string"}},
    )
    def find_files(pattern: str, folder: str) -> dict[str, Any]:
        return files.find(pattern, folder)

    @registry.tool(
        description="Read a text file (first 50 KB). " + where,
        parameters={"path": {"type": "string"}},
    )
    def read_file(path: str) -> str:
        return files.read(path)

    @registry.tool(
        description=(
            "Write text to a file, creating it (and its folder) if needed. append=true adds "
            "to the end instead of replacing. Replacing an existing file asks the user "
            "first. " + where
        ),
        parameters={
            "path": {"type": "string"},
            "content": {"type": "string"},
            "append": {"type": "boolean"},
        },
    )
    def write_file(path: str, content: str, append: bool) -> str:
        return files.write(path, content, append)

    @registry.tool(
        description="Move or rename a file or folder. Asks the user first. " + where,
        parameters={"source": {"type": "string"}, "destination": {"type": "string"}},
    )
    def move_file(source: str, destination: str) -> str:
        return files.move(source, destination)

    @registry.tool(
        description=(
            "Delete a file or an empty folder. Asks the user first. " + where
        ),
        parameters={"path": {"type": "string"}},
    )
    def delete_file(path: str) -> str:
        return files.delete(path)
