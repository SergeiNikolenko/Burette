#!/usr/bin/env bun

import { writeFileSync } from "node:fs";

const outputPath = process.argv[2];
if (!outputPath) {
  throw new Error("metadata output path is required");
}

const requiredEnvironment = [
  "TANIMOTO_SOURCE_SHA256",
  "CONFORMER_SOURCE_SHA256",
  "DISTANCE_SOURCE_SHA256",
  "OPTIMIZER_SOURCE_SHA256",
  "STEREO_SOURCE_SHA256",
  "ETK_SOURCE_SHA256",
  "ETK_OPTIMIZER_SOURCE_SHA256",
  "MMFF_SOURCE_SHA256",
  "TANIMOTO_CONTRACT_SHA256",
  "CONFORMER_CONTRACT_SHA256",
  "DISTANCE_CONTRACT_SHA256",
  "OPTIMIZER_CONTRACT_SHA256",
  "STEREO_CONTRACT_SHA256",
  "ETK_CONTRACT_SHA256",
  "ETK_OPTIMIZER_CONTRACT_SHA256",
  "MMFF_CONTRACT_SHA256",
  "TANIMOTO_AIR_SHA256",
  "CONFORMER_AIR_SHA256",
  "DISTANCE_AIR_SHA256",
  "OPTIMIZER_AIR_SHA256",
  "STEREO_AIR_SHA256",
  "ETK_AIR_SHA256",
  "ETK_OPTIMIZER_AIR_SHA256",
  "MMFF_AIR_SHA256",
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
  schemaVersion: "burrete.compute.metal-build-metadata.v2",
  runtimeVersion: "burrete-native-metal-v9",
  libraryId: "burrete.compute.native.v9",
  sources: [
    { path: "compute/metal/tanimoto.v2.metal", sha256: process.env.TANIMOTO_SOURCE_SHA256 },
    { path: "compute/metal/conformer-initialize.v1.metal", sha256: process.env.CONFORMER_SOURCE_SHA256 },
    { path: "compute/metal/conformer-distance.v1.metal", sha256: process.env.DISTANCE_SOURCE_SHA256 },
    { path: "compute/metal/conformer-optimize.v1.metal", sha256: process.env.OPTIMIZER_SOURCE_SHA256 },
    { path: "compute/metal/conformer-stereo.v1.metal", sha256: process.env.STEREO_SOURCE_SHA256 },
    { path: "compute/metal/conformer-etk.v1.metal", sha256: process.env.ETK_SOURCE_SHA256 },
    { path: "compute/metal/conformer-etk-optimize.v1.metal", sha256: process.env.ETK_OPTIMIZER_SOURCE_SHA256 },
    { path: "compute/metal/mmff-energy.v1.metal", sha256: process.env.MMFF_SOURCE_SHA256 },
  ],
  contracts: [
    { path: "compute/metal/tanimoto-kernel-contract.v2.json", sha256: process.env.TANIMOTO_CONTRACT_SHA256 },
    { path: "compute/metal/conformer-initialize-kernel-contract.v1.json", sha256: process.env.CONFORMER_CONTRACT_SHA256 },
    { path: "compute/metal/conformer-distance-kernel-contract.v1.json", sha256: process.env.DISTANCE_CONTRACT_SHA256 },
    { path: "compute/metal/conformer-optimize-kernel-contract.v1.json", sha256: process.env.OPTIMIZER_CONTRACT_SHA256 },
    { path: "compute/metal/conformer-stereo-kernel-contract.v1.json", sha256: process.env.STEREO_CONTRACT_SHA256 },
    { path: "compute/metal/conformer-etk-kernel-contract.v1.json", sha256: process.env.ETK_CONTRACT_SHA256 },
    { path: "compute/metal/conformer-etk-optimize-kernel-contract.v1.json", sha256: process.env.ETK_OPTIMIZER_CONTRACT_SHA256 },
    { path: "compute/metal/mmff-energy-kernel-contract.v1.json", sha256: process.env.MMFF_CONTRACT_SHA256 },
  ],
  air: [
    { path: "tanimoto.v2.air", sha256: process.env.TANIMOTO_AIR_SHA256 },
    { path: "conformer-initialize.v1.air", sha256: process.env.CONFORMER_AIR_SHA256 },
    { path: "conformer-distance.v1.air", sha256: process.env.DISTANCE_AIR_SHA256 },
    { path: "conformer-optimize.v1.air", sha256: process.env.OPTIMIZER_AIR_SHA256 },
    { path: "conformer-stereo.v1.air", sha256: process.env.STEREO_AIR_SHA256 },
    { path: "conformer-etk.v1.air", sha256: process.env.ETK_AIR_SHA256 },
    { path: "conformer-etk-optimize.v1.air", sha256: process.env.ETK_OPTIMIZER_AIR_SHA256 },
    { path: "mmff-energy.v1.air", sha256: process.env.MMFF_AIR_SHA256 },
  ],
  metallib: {
    path: "native-compute.v9.metallib",
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
    "burrete_tanimoto_query_counts_v1",
    "burrete_conformer_initialize_v1",
    "burrete_conformer_distance_v1",
    "burrete_conformer_optimize_v1",
    "burrete_conformer_stereo_validate_v1",
    "burrete_conformer_etk_v1",
    "burrete_conformer_etk_optimize_v1",
    "burrete_mmff_energy_v1",
    "burrete_mmff_reference_gradient_v1",
  ],
};

writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
