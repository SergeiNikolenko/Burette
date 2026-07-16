#!/usr/bin/env bun

import { writeFileSync } from "node:fs";

const outputPath = process.argv[2];
if (!outputPath) {
  throw new Error("metadata output path is required");
}

const requiredEnvironment = [
  "SOURCE_SHA256",
  "CONTRACT_SHA256",
  "AIR_SHA256",
  "METALLIB_SHA256",
  "METAL_TOOL_PATH",
  "METAL_TOOL_SHA256",
  "METAL_TOOL_VERSION",
  "METALLIB_TOOL_PATH",
  "METALLIB_TOOL_SHA256",
  "SDK_PATH",
  "SDK_VERSION",
  "SDK_BUILD_VERSION",
];
for (const name of requiredEnvironment) {
  if (!process.env[name]) {
    throw new Error(`${name} is required`);
  }
}
for (const name of requiredEnvironment.filter((name) => name.endsWith("_SHA256"))) {
  if (!/^[0-9a-f]{64}$/u.test(process.env[name])) {
    throw new Error(`${name} must be a lowercase SHA-256 digest`);
  }
}

const normalizedVersion = process.env.METAL_TOOL_VERSION.trim().replace(/\s+/g, " ");
const metadata = {
  schemaVersion: "burrete.compute.metal-build-metadata.v1",
  runtimeVersion: "burrete-native-metal-v1",
  libraryId: "burrete.cluster.tanimoto-neighbors.v1",
  source: {
    path: "compute/metal/tanimoto-neighbors.v1.metal",
    sha256: process.env.SOURCE_SHA256,
  },
  contract: {
    path: "compute/metal/kernel-contract.v1.json",
    sha256: process.env.CONTRACT_SHA256,
  },
  air: { path: "tanimoto-neighbors.v1.air", sha256: process.env.AIR_SHA256 },
  metallib: {
    path: "tanimoto-neighbors.v1.metallib",
    sha256: process.env.METALLIB_SHA256,
  },
  compiler: {
    path: process.env.METAL_TOOL_PATH,
    sha256: process.env.METAL_TOOL_SHA256,
    version: normalizedVersion,
  },
  linker: {
    path: process.env.METALLIB_TOOL_PATH,
    sha256: process.env.METALLIB_TOOL_SHA256,
  },
  sdk: {
    name: "macosx",
    path: process.env.SDK_PATH,
    version: process.env.SDK_VERSION,
    buildVersion: process.env.SDK_BUILD_VERSION,
  },
  deploymentTarget: "14.0",
  compileArguments: ["-std=metal3.1", "-mmacosx-version-min=14.0"],
  entrypoints: [
    "burrete_tanimoto_degree_count_v1",
    "burrete_tanimoto_csr_fill_v1",
  ],
};

writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
