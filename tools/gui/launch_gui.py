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


def _ensure_streamlit(python_cmd: list[str], root: Path, env: dict[str, str]) -> tuple[bool, str]:
    check = subprocess.run(
        [*python_cmd, "-c", "import streamlit"],
        cwd=str(root),
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    if check.returncode == 0:
        return True, ""

    print(f"[SpecFactoryGUI] Streamlit not found for `{python_cmd[0]}`. Installing...")
    install = subprocess.run(
        [*python_cmd, "-m", "pip", "install", "--upgrade", "streamlit"],
        cwd=str(root),
        env=env,
        check=False,
    )
    if install.returncode == 0:
        return True, ""
    return False, f"Failed to install Streamlit with: {' '.join(python_cmd)}"


def _try_streamlit_subprocess(app_path: Path, root: Path) -> int:
    env = os.environ.copy()
    env.setdefault("SPEC_FACTORY_ROOT", str(root))
    env.setdefault("STREAMLIT_BROWSER_GATHER_USAGE_STATS", "false")
    env.setdefault("STREAMLIT_SERVER_HEADLESS", "false")

    launchers = [
        ["python"],
        ["py", "-3"],
    ]

    last_error = None
    for launcher in launchers:
        try:
            ok, install_error = _ensure_streamlit(launcher, root, env)
            if not ok:
                last_error = install_error
                continue
            cmd = [*launcher, "-m", "streamlit", "run", str(app_path)]
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

    return _try_streamlit_subprocess(app_path, root)


if __name__ == "__main__":
    raise SystemExit(main())
