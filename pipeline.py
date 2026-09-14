"""
Root entry point for the AgentIQ Track 2 Data Rescue Pipeline.
Enables single-command reproducibility: `python pipeline.py`
"""
import sys
from pathlib import Path

# Ensure workspace root is in python path
WORKSPACE_DIR = Path(__file__).resolve().parent
if str(WORKSPACE_DIR) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_DIR))

from agents.pipeline import run_rescue_pipeline

if __name__ == "__main__":
    run_rescue_pipeline()
