import importlib.util
from pathlib import Path

import numpy as np


RUNNER_PATH = Path(__file__).parents[2] / "scripts" / "mdsmooth_runner.py"
SPEC = importlib.util.spec_from_file_location("mdsmooth_runner", RUNNER_PATH)
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


def test_ic1_signal_reports_scalar_lag_robustness():
    time = np.linspace(0.0, 4.0 * np.pi, 80)
    frames = np.zeros((len(time), 4, 3), dtype=float)
    frames[:, 0, 0] = np.sin(time)
    frames[:, 1, 1] = np.cos(time * 0.4)
    frames[:, 2, 2] = np.sin(time * 0.2)
    frames[:, 3, 0] = np.cos(time * 0.7)

    values, diagnostics = runner.signal_series("ic1", frames, 0, 8, None, "")

    assert values.shape == (80,)
    assert isinstance(diagnostics["lagRobustness"], float)
    assert diagnostics["testedLags"] == [4, 8, 16]
    assert len(diagnostics["lagCorrelations"]) == 3
