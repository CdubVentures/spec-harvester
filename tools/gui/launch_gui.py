from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def _repo_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def _pause_with_error(message: str) -> None:
    print(f"[SpecFactoryGUI] {message}")
    if os.name == "nt":
        os.system("pause")


def _try_streamlit_subprocess(app_path: Path, root: Path) -> int:
    env = os.environ.copy()
    env.setdefault("SPEC_FACTORY_ROOT", str(root))
    env.setdefault("STREAMLIT_BROWSER_GATHER_USAGE_STATS", "false")
    env.setdefault("STREAMLIT_SERVER_HEADLESS", "false")

    commands = [
        ["python", "-m", "streamlit", "run", str(app_path)],
        ["py", "-3", "-m", "streamlit", "run", str(app_path)]
    ]

    last_error = None
    for cmd in commands:
        try:
            completed = subprocess.run(
                cmd,
                cwd=str(root),
                env=env,
                check=False
            )
            if completed.returncode == 0:
                return 0
            last_error = f"Command failed ({completed.returncode}): {' '.join(cmd)}"
        except FileNotFoundError as exc:
            last_error = str(exc)
            continue

    _pause_with_error(
        "Failed to launch Streamlit with system Python. "
        "Install Streamlit (`python -m pip install streamlit`) and retry. "
        f"Last error: {last_error}"
    )
    return 1


def main() -> int:
    root = _repo_root()
    app_path = root / "tools" / "gui" / "app.py"

    if not app_path.exists():
        _pause_with_error(f"GUI app not found: {app_path}")
        return 1

    os.chdir(root)
    os.environ.setdefault("SPEC_FACTORY_ROOT", str(root))
    os.environ.setdefault("STREAMLIT_BROWSER_GATHER_USAGE_STATS", "false")
    os.environ.setdefault("STREAMLIT_SERVER_HEADLESS", "false")

    if getattr(sys, "frozen", False):
        return _try_streamlit_subprocess(app_path, root)

    try:
        from streamlit.web import bootstrap
    except Exception as exc:  # pragma: no cover
        _pause_with_error(f"Streamlit is missing or failed to import: {exc}")
        return 1

    try:
        bootstrap.run(str(app_path), "", [], {})
        return 0
    except Exception as exc:  # pragma: no cover
        _pause_with_error(f"Failed to start GUI: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
