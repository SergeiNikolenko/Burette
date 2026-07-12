"""In-venv DeepTICA training worker for the MDSmooth learned-CV signal.

This script runs **inside the dedicated learned-CV virtualenv**, launched as a
subprocess by ``learned.run_deeptica``. It is never imported by ChimeraX's
Python.  It reads a feature matrix + params from an ``input.npz``, trains
``n_seeds`` independently-initialized DeepTICA models with ``mlcolvar``/PyTorch,
and writes their per-seed CV time courses to ``output.npz`` (key ``series``,
shape ``(n_seeds, n_frames, out_dim)``).

Usage (by the orchestrator, not by hand)::

    <venv-python> _deeptica_worker.py input.npz output.npz

.. note::
   Validated against **mlcolvar 1.3.1 / torch 2.2.2** on synthetic data: the
   subprocess worker + consensus recovers a known slow mode buried under a larger
   fast mode (r~0.97, seeds agree ~0.95).  Two production-fatal bugs were fixed
   during that validation, the sys.path shadowing below, and the missing input
   normalization in :func:`_train_one` (without it training does not converge).
   Still to confirm on a real deployment: the ChimeraX venv bootstrap and a run on
   an actual trajectory.  All torch/mlcolvar imports are deferred so this file is
   inert until executed in the venv.
"""

import os
import sys

# CRITICAL: when this file is run as a script its own directory is sys.path[0],
# and it sits next to the bundle's cmd.py.  PyTorch transitively does `import cmd`
# (torch.distributed -> pdb -> stdlib cmd), which would instead pick up that
# cmd.py and fail on `import chimerax` (absent in the venv).  Drop our own dir from
# sys.path so stdlib imports resolve correctly.  (The worker imports only
# numpy/torch/mlcolvar, all in site-packages, so removing it is safe.)
_here = os.path.dirname(os.path.abspath(__file__))
sys.path[:] = [p for p in sys.path if os.path.abspath(p or ".") != _here]


def _train_one(features, lag, out_dim, seed):
    """Train a single DeepTICA model and return its CV time course (n_frames, out_dim).

    ---- mlcolvar / PyTorch section (validated against mlcolvar 1.3.1 on synthetic
    data: recovers a known slow mode buried under a larger fast mode at r~0.96,
    seeds agree). Three details are load-bearing and were verified empirically:
      * input Normalization, WITHOUT it training does not converge (r~0.02);
      * full-batch training (batch_size=0), mini-batches add noise on the small
        feature sets this tool produces;
      * early stopping on valid_loss, the overfitting guard on scarce MD data.
    ----
    """
    import numpy as np
    import torch
    import lightning
    from lightning.pytorch.callbacks import EarlyStopping
    from mlcolvar.cvs import DeepTICA
    from mlcolvar.data import DictModule
    from mlcolvar.utils.timelagged import create_timelagged_dataset
    from mlcolvar.core.transform import Normalization
    from mlcolvar.core.transform.utils import Statistics

    torch.manual_seed(int(seed))
    np.random.seed(int(seed))

    x = np.asarray(features, dtype=np.float32)
    n_frames, d = x.shape
    xt = torch.as_tensor(x)

    # Time-lagged dataset (pairs (x_t, x_{t+lag})) with a train/val split.
    dataset = create_timelagged_dataset(x, lag_time=int(lag))
    datamodule = DictModule(dataset, lengths=[0.8, 0.2], batch_size=0)

    model = DeepTICA(layers=[d, 20, 20, int(out_dim)], n_cvs=int(out_dim))
    # Standardize inputs, essential for convergence (see note above).
    model.norm_in = Normalization(d, stats=Statistics(xt).to_dict())

    early = EarlyStopping(monitor="valid_loss", patience=40, mode="min")
    trainer = lightning.Trainer(
        max_epochs=1000, callbacks=[early],
        enable_checkpointing=False, logger=False,
        enable_progress_bar=False, enable_model_summary=False,
        accelerator="auto",
    )
    trainer.fit(model, datamodule)

    model.eval()
    with torch.no_grad():
        cv = model(xt).cpu().numpy()
    return np.asarray(cv, dtype=float).reshape(n_frames, int(out_dim))
    # ---------------------------- end mlcolvar section -----------------------


def main(inp_path, out_path):
    import numpy as np

    data = np.load(inp_path)
    features = data["features"]
    lag = int(data["lag"])
    n_seeds = int(data["n_seeds"])
    out_dim = int(data["out_dim"])

    series = []
    for seed in range(n_seeds):
        series.append(_train_one(features, lag, out_dim, seed))
    np.savez(out_path, series=np.stack(series, axis=0))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.stderr.write("usage: _deeptica_worker.py input.npz output.npz\n")
        sys.exit(2)
    main(sys.argv[1], sys.argv[2])
