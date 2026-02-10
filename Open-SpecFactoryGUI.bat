@echo off
setlocal
cd /d "%~dp0"
set "SPEC_FACTORY_ROOT=%cd%"

echo [SpecFactoryGUI] Starting GUI...
python -m pip show streamlit >nul 2>&1
if errorlevel 1 (
  echo [SpecFactoryGUI] Installing Streamlit...
  python -m pip install --upgrade streamlit
)

python -m streamlit run tools\gui\app.py
if errorlevel 1 (
  echo [SpecFactoryGUI] python launch failed, trying py -3...
  py -3 -m streamlit run tools\gui\app.py
)
