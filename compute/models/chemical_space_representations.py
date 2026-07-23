#!/usr/bin/env python3
"""Strict Apple-MPS molecular representations for Chemical Space."""

from __future__ import annotations

import base64
import json
import os
import sys
import time
from dataclasses import dataclass
from typing import Any

os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "0"
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "2")
os.environ.setdefault("PYTORCH_MPS_HIGH_WATERMARK_RATIO", "0.8")
os.environ.setdefault("PYTORCH_MPS_LOW_WATERMARK_RATIO", "0.7")

MAX_RECORDS = 20_000
MAX_INPUT_BYTES = 32 * 1024 * 1024
MODEL_SPECS = {
    "chemberta": {
        "label": "ChemBERTa 77M",
        "model_id": "DeepChem/ChemBERTa-77M-MLM",
        "revision": "ed8a5374f2024ec8da53760af91a33fb8f6a15ff",
        "dimensions": 384,
    },
    "molformer": {
        "label": "MoLFormer XL",
        "model_id": "ibm-research/MoLFormer-XL-both-10pct",
        "revision": "361063d0ad524ef77cf39b08469f6be770dc550f",
        "dimensions": 768,
    },
    "unimol2-84m": {
        "label": "Uni-Mol2 84M",
        "dimensions": 768,
    },
    "unimol-v1": {
        "label": "Uni-Mol v1",
        "dimensions": 512,
    },
}


@dataclass(frozen=True)
class ValidRecord:
    source_record_id: int
    smiles: str


def require_mps():
    import torch

    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    if not torch.backends.mps.is_built() or not torch.backends.mps.is_available():
        raise RuntimeError("Apple Metal Performance Shaders are unavailable")
    device = torch.device("mps")
    probe = torch.ones(1, device=device)
    if probe.device.type != "mps":
        raise RuntimeError(f"Metal attestation failed: probe is on {probe.device}")
    return device


def normalize_records(raw_records: Any) -> tuple[list[ValidRecord], int]:
    from rdkit import Chem

    if not isinstance(raw_records, list) or not 2 <= len(raw_records) <= MAX_RECORDS:
        raise ValueError(f"records must contain between 2 and {MAX_RECORDS} molecules")
    valid: list[ValidRecord] = []
    failed = 0
    input_bytes = 0
    for raw in raw_records:
        if not isinstance(raw, dict):
            failed += 1
            continue
        source_record_id = raw.get("sourceRecordId")
        molecule_input = raw.get("input")
        input_format = raw.get("format")
        if (
            not isinstance(source_record_id, int)
            or source_record_id < 0
            or not isinstance(molecule_input, str)
        ):
            failed += 1
            continue
        input_bytes += len(molecule_input.encode("utf-8"))
        if input_bytes > MAX_INPUT_BYTES:
            raise ValueError("molecular inputs exceed the 32 MiB representation limit")
        if input_format == "molblock":
            molecule = Chem.MolFromMolBlock(molecule_input, sanitize=True, removeHs=False)
            smiles = Chem.MolToSmiles(molecule, isomericSmiles=True) if molecule else ""
        elif input_format == "smiles":
            molecule = Chem.MolFromSmiles(molecule_input)
            smiles = Chem.MolToSmiles(molecule, isomericSmiles=True) if molecule else ""
        else:
            smiles = ""
        if smiles:
            valid.append(ValidRecord(source_record_id=source_record_id, smiles=smiles))
        else:
            failed += 1
    if len(valid) < 2:
        raise ValueError("fewer than two molecules can be represented")
    return valid, failed


def transformer_embeddings(engine: str, smiles: list[str], device):
    import torch
    import torch.nn.functional as functional
    from transformers import AutoModel, AutoTokenizer

    spec = MODEL_SPECS[engine]
    trust_remote_code = engine == "molformer"
    shared = {
        "revision": spec["revision"],
        "trust_remote_code": trust_remote_code,
    }
    tokenizer = AutoTokenizer.from_pretrained(spec["model_id"], **shared)
    model_options = {**shared}
    if trust_remote_code:
        model_options["deterministic_eval"] = True
    model = AutoModel.from_pretrained(spec["model_id"], **model_options).eval().to(device)
    batch_size = 16 if trust_remote_code else 32
    outputs = []
    observed_devices: set[str] = set()
    for start in range(0, len(smiles), batch_size):
        encoded = tokenizer(
            smiles[start : start + batch_size],
            padding=True,
            truncation=True,
            return_tensors="pt",
        )
        encoded = {key: value.to(device) for key, value in encoded.items()}
        with torch.inference_mode():
            model_output = model(**encoded)
            if trust_remote_code and getattr(model_output, "pooler_output", None) is not None:
                batch_output = model_output.pooler_output
            else:
                mask = encoded["attention_mask"].unsqueeze(-1)
                batch_output = (
                    (model_output.last_hidden_state * mask).sum(1)
                    / mask.sum(1).clamp_min(1)
                )
            observed_devices.add(batch_output.device.type)
            outputs.append(functional.normalize(batch_output.float(), dim=1).cpu())
    if observed_devices != {"mps"}:
        raise RuntimeError(f"model output left Metal: {sorted(observed_devices)}")
    return torch.cat(outputs, dim=0)


def unimol_embeddings(engine: str, smiles: list[str], device):
    import numpy as np
    import torch
    import torch.nn.functional as functional
    from unimol_tools.data import DataHub
    from unimol_tools.models import UniMolModel, UniMolV2Model
    from unimol_tools.predictor import MolDataset
    from unimol_tools.tasks import Trainer

    model_name = "unimolv2" if engine == "unimol2-84m" else "unimolv1"
    params = {
        "data_type": "molecule",
        "batch_size": 16,
        "remove_hs": False,
        "model_name": model_name,
        "model_size": "84m",
        "smiles_col": "SMILES",
        "use_cuda": False,
        "use_ddp": False,
        "use_gpu": "all",
        "save_path": None,
        "max_atoms": 256,
    }
    model = (
        UniMolV2Model(output_dim=1, model_size="84m")
        if model_name == "unimolv2"
        else UniMolModel(output_dim=1, data_type="molecule", remove_hs=False)
    ).eval().to(device)
    outputs = []
    for start in range(0, len(smiles), 64):
        batch_smiles = smiles[start : start + 64]
        datahub = DataHub(data=batch_smiles, task="repr", is_train=False, **params)
        dataset = MolDataset(
            datahub.data["unimol_input"],
            label=np.zeros((len(batch_smiles), 1), dtype=np.float32),
        )
        trainer = Trainer(task="repr", **params)
        trainer.device = device
        observed_devices: set[str] = set()

        def capture_output_device(_module, _inputs, output):
            if isinstance(output, torch.Tensor):
                observed_devices.add(output.device.type)
            elif isinstance(output, dict):
                observed_devices.update(
                    value.device.type
                    for value in output.values()
                    if isinstance(value, torch.Tensor)
                )

        hook = model.register_forward_hook(capture_output_device)
        try:
            batch_output = trainer.inference(
                model,
                dataset,
                model_name=model_name,
                return_repr=True,
                return_tensor=True,
            )
        finally:
            hook.remove()
        if observed_devices != {"mps"}:
            raise RuntimeError(f"model output left Metal: {sorted(observed_devices)}")
        outputs.append(functional.normalize(batch_output.float(), dim=1))
    return torch.cat(outputs, dim=0)


def cosine_knn(embeddings, neighbors: int, device):
    import numpy as np
    import torch
    import torch.nn.functional as functional

    count = embeddings.shape[0]
    neighbor_count = min(neighbors, count - 1)
    if not 1 <= neighbor_count <= 64:
        raise ValueError("neighbors must be in 1..=64")
    vectors = functional.normalize(embeddings.to(device), dim=1)
    all_indices = []
    all_similarities = []
    started = time.perf_counter()
    with torch.inference_mode():
        for start in range(0, count, 512):
            stop = min(count, start + 512)
            scores = vectors[start:stop] @ vectors.T
            local_rows = torch.arange(stop - start, device=device)
            scores[local_rows, torch.arange(start, stop, device=device)] = -torch.inf
            similarities, indices = torch.topk(
                scores,
                k=neighbor_count,
                dim=1,
                largest=True,
                sorted=True,
            )
            all_indices.append(indices.to(torch.int32).cpu())
            all_similarities.append(((similarities.float() + 1) * 0.5).clamp(0, 1).cpu())
    torch.mps.synchronize()
    elapsed_ms = round((time.perf_counter() - started) * 1_000)
    indices = torch.cat(all_indices).contiguous().numpy().astype("<u4", copy=False)
    similarities = torch.cat(all_similarities).contiguous().numpy().astype("<f4", copy=False)
    return {
        "neighborsPerVertex": neighbor_count,
        "sourceIndicesBase64": base64.b64encode(indices.tobytes()).decode("ascii"),
        "similaritiesBase64": base64.b64encode(similarities.tobytes()).decode("ascii"),
    }, elapsed_ms


def represent(request: dict[str, Any]) -> dict[str, Any]:
    engine = request.get("engine")
    if engine not in MODEL_SPECS:
        raise ValueError(f"unknown representation engine: {engine}")
    neighbors = request.get("neighbors")
    if not isinstance(neighbors, int):
        raise ValueError("neighbors must be an integer")
    records, failed_records = normalize_records(request.get("records"))
    device = require_mps()
    started = time.perf_counter()
    smiles = [record.smiles for record in records]
    if engine in {"chemberta", "molformer"}:
        embeddings = transformer_embeddings(engine, smiles, device)
    else:
        embeddings = unimol_embeddings(engine, smiles, device)
    import torch

    torch.mps.synchronize()
    representation_ms = round((time.perf_counter() - started) * 1_000)
    knn, similarity_ms = cosine_knn(embeddings, neighbors, device)
    return {
        "engine": engine,
        "backend": "metalMps",
        "sourceRecordIds": [record.source_record_id for record in records],
        "failedRecords": failed_records,
        "dimensions": int(embeddings.shape[1]),
        "representationTimeMs": representation_ms,
        "similarityGpuTimeMs": similarity_ms,
        "knnCache": knn,
    }


def status() -> dict[str, Any]:
    try:
        device = require_mps()
        return {
            "available": True,
            "backend": "metalMps",
            "device": str(device),
            "engines": MODEL_SPECS,
        }
    except Exception as error:
        return {
            "available": False,
            "backend": None,
            "error": str(error),
            "engines": MODEL_SPECS,
        }


def main() -> None:
    request = json.load(sys.stdin)
    operation = request.get("operation")
    result = status() if operation == "status" else represent(request)
    json.dump({"ok": True, "result": result}, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        json.dump(
            {"ok": False, "error": f"{type(error).__name__}: {error}"},
            sys.stdout,
            separators=(",", ":"),
        )
        sys.exit(1)
