#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const routePath = resolve('apps/burrete-public-plugin/api/xyzrender.py');
const testProgram = String.raw`
import base64
import importlib.util
import pathlib
import sys

route_path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("burrete_hosted_xyzrender", route_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

calls = []
def fake_renderer(source_path, output_path, preset):
    source = pathlib.Path(source_path)
    assert source.suffix == ".smi"
    assert source.read_bytes() == b"CCCC\\n"
    calls.append((source.name, preset))
    pathlib.Path(output_path).write_text("<svg><text>four carbons</text></svg>", encoding="utf-8")

payload = {
    "path": "../../must-not-be-read.smi",
    "inputDataBase64": base64.b64encode(b"CCCC\\n").decode("ascii"),
    "inputExtension": "smiles",
    "preset": "flat",
}
result = module.render_request(payload, renderer=fake_renderer)
assert result["svg"] == "<svg><text>four carbons</text></svg>"
assert result["preset"] == "flat"
assert result["configArgument"] == "flat"
assert calls == [("input.smi", "flat")]

original_input_limit = module.MAX_INPUT_BYTES
module.MAX_INPUT_BYTES = 1
try:
    module.render_request({
        "inputDataBase64": base64.b64encode(b"CC").decode("ascii"),
        "inputExtension": "smi",
    }, renderer=fake_renderer)
except module.RequestError as error:
    assert error.status == 413
else:
    raise AssertionError("Expected oversized input to be rejected")
finally:
    module.MAX_INPUT_BYTES = original_input_limit

def oversized_renderer(source_path, output_path, preset):
    pathlib.Path(output_path).write_text("<svg>oversized</svg>", encoding="utf-8")

original_output_limit = module.MAX_SVG_BYTES
module.MAX_SVG_BYTES = 5
try:
    module.render_request(payload, renderer=oversized_renderer)
except module.RequestError as error:
    assert error.status == 413
else:
    raise AssertionError("Expected oversized SVG output to be rejected")
finally:
    module.MAX_SVG_BYTES = original_output_limit

for invalid_payload, expected_status in [
    ({"path": "/tmp/private.xyz", "inputExtension": "xyz"}, 400),
    ({"inputDataBase64": "%%%", "inputExtension": "xyz"}, 400),
    ({"inputDataBase64": base64.b64encode(b"x").decode("ascii"), "inputExtension": "txt"}, 400),
    ({"inputDataBase64": base64.b64encode(b"x").decode("ascii"), "inputExtension": "xyz", "preset": "custom"}, 400),
]:
    try:
        module.render_request(invalid_payload, renderer=fake_renderer)
    except module.RequestError as error:
        assert error.status == expected_status
    else:
        raise AssertionError(f"Expected RequestError for {invalid_payload}")
`;

const result = spawnSync('python3', ['-', routePath], {
  cwd: process.cwd(),
  input: testProgram,
  encoding: 'utf8',
});

assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
console.log('hosted xyzrender route tests passed');
