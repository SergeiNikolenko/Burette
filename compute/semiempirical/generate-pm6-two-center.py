#!/usr/bin/env python3
"""Generate scalar PM6 YX/YY local-integral Rust equations from pinned PYSEQM AST."""

from __future__ import annotations

import argparse
import ast
import hashlib
from pathlib import Path

PINNED_SHA256 = "aca9f065544fb9aacddf15ace0c0cb03d887481b9fa45f71835b49c95b3b17af"


def expression(node: ast.expr) -> str:
    if isinstance(node, ast.Constant):
        if node.value is Ellipsis:
            return "..."
        if isinstance(node.value, int):
            return f"{node.value}.0_f64"
        if isinstance(node.value, float):
            return f"{node.value!r}_f64"
        return repr(node.value)
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return f"(-{expression(node.operand)})"
    if isinstance(node, ast.BinOp):
        left = expression(node.left)
        right = expression(node.right)
        if isinstance(node.op, ast.Pow):
            if not isinstance(node.right, ast.Constant) or node.right.value != 2:
                raise ValueError(f"unsupported power at line {node.lineno}")
            return f"({left}).powi(2)"
        operator = {
            ast.Add: "+",
            ast.Sub: "-",
            ast.Mult: "*",
            ast.Div: "/",
        }.get(type(node.op))
        if operator is None:
            raise ValueError(f"unsupported operator at line {node.lineno}")
        return f"({left} {operator} {right})"
    if isinstance(node, ast.Call):
        name = ast.unparse(node.func)
        if name not in {"torch.sqrt", "math.sqrt", "numpy.sqrt", "np.sqrt"}:
            raise ValueError(f"unsupported call {name} at line {node.lineno}")
        return f"({expression(node.args[0])}).sqrt()"
    if isinstance(node, ast.Subscript):
        if isinstance(node.value, ast.Name) and isinstance(node.slice, ast.Name):
            return f"input.{node.value.id}"
        raise ValueError(f"unsupported subscript at line {node.lineno}")
    raise ValueError(f"unsupported expression {type(node).__name__} at line {node.lineno}")


def output_index(target: ast.Subscript, array_name: str) -> int:
    if not isinstance(target.value, ast.Name) or target.value.id != array_name:
        raise ValueError(f"unsupported target at line {target.lineno}")
    if not isinstance(target.slice, ast.Tuple):
        raise ValueError(f"unsupported output index at line {target.lineno}")
    index = target.slice.elts[-1]
    if not isinstance(index, ast.Constant) or not isinstance(index.value, int):
        raise ValueError(f"non-constant output index at line {target.lineno}")
    return index.value


def generate(source: Path, branch: str) -> str:
    config = {
        "yx": {
            "array": "riYX",
            "stop": "coreYX",
            "type": "Pm6YxLocalInput",
            "function": "pm6_yx_local",
            "size": 450,
            "fields": [
                "r0", "da0", "db0", "qa0", "qb0", "dpa0", "dsa0", "dda0",
                "rho0a", "rho0b", "rho1a", "rho1b", "rho2a", "rho2b",
                "rho3a", "rho4a", "rho5a", "rho6a",
            ],
        },
        "yy": {
            "array": "riYY",
            "stop": "coreYY",
            "type": "Pm6YyLocalInput",
            "function": "pm6_yy_local",
            "size": 2025,
            "fields": [
                "r0", "da0", "db0", "qa0", "qb0", "dpa0", "dpb0", "dsa0",
                "dsb0", "dda0", "ddb0", "rho0a", "rho0b", "rho1a", "rho1b",
                "rho2a", "rho2b", "rho3a", "rho3b", "rho4a", "rho4b",
                "rho5a", "rho5b", "rho6a", "rho6b",
            ],
        },
    }[branch]
    array_name = config["array"]
    raw = source.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != PINNED_SHA256:
        raise ValueError(f"source SHA-256 {digest} does not match pinned {PINNED_SHA256}")
    tree = ast.parse(raw)
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef))
    block = next(
        node
        for node in ast.walk(function)
        if isinstance(node, ast.If)
        and any(
            isinstance(item, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == array_name for target in item.targets)
            for item in node.body
        )
    )
    start = next(
        index
        for index, item in enumerate(block.body)
        if isinstance(item, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == array_name for target in item.targets)
    )
    statements = []
    for item in block.body[start + 1 :]:
        if not isinstance(item, ast.Assign):
            continue
        target = item.targets[0]
        if isinstance(target, ast.Name) and target.id == config["stop"]:
            break
        if isinstance(target, ast.Name):
            if isinstance(item.value, ast.Subscript):
                statements.append(f"    let {target.id} = input.{target.id};")
            else:
                statements.append(f"    let {target.id} = {expression(item.value)};")
        elif isinstance(target, ast.Subscript):
            statements.append(
                "    output[{}] = {};".format(
                    output_index(target, array_name), expression(item.value)
                )
            )
        else:
            raise ValueError(f"unsupported assignment at line {item.lineno}")
    field_lines = []
    for start_index in range(0, len(config["fields"]), 6):
        fields = config["fields"][start_index : start_index + 6]
        field_lines.append("    " + " ".join(f"pub {field}: f64," for field in fields))
    header = f"""// @generated by compute/semiempirical/generate-pm6-two-center.py; do not edit.
// Source: PYSEQM two_elec_two_center_int_local_frame_d_orbitals.py
// SHA-256: {digest}

#[derive(Clone, Copy, Debug)]
pub(super) struct {config["type"]} {{
{chr(10).join(field_lines)}
}}

#[allow(non_snake_case, unused_variables, unused_parens)]
pub(super) fn {config["function"]}(input: {config["type"]}) -> [f64; {config["size"]}] {{
    let (ev, ev1, ev2, ev3, ev4) = (27.21_f64, 27.21 / 2.0, 27.21 / 4.0, 27.21 / 8.0, 27.21 / 16.0);
    let mut output = [0.0; {config["size"]}];
"""
    return header + "\n".join(statements) + "\n    output\n}\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("branch", choices=("yx", "yy"))
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.write_text(generate(args.source, args.branch))


if __name__ == "__main__":
    main()
