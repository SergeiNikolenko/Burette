#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readBunLock } from './bun-lock.mjs';

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const packageVersion = readJSON('package.json').version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageVersion)) {
  fail(`package.json version must be a semver release or prerelease, got ${packageVersion}`);
}

const bunLock = readBunLock();
const workspacePackageVersion = bunLock.workspaces?.['packages/burrete']?.version;
if (workspacePackageVersion !== packageVersion) {
  fail(`bun.lock workspace version ${workspacePackageVersion || 'unknown'} does not match package.json ${packageVersion}`);
}

const tauriVersion = readJSON('apps/desktop/src-tauri/tauri.conf.json').version;
if (tauriVersion !== packageVersion) {
  fail(`Tauri app version ${tauriVersion} does not match package.json ${packageVersion}`);
}

const cargoManifest = readFileSync('apps/desktop/src-tauri/Cargo.toml', 'utf8');
const cargoVersion = cargoManifest.match(/^version = "([^"]+)"$/m)?.[1];
if (cargoVersion !== packageVersion) {
  fail(`Tauri Rust crate version ${cargoVersion || 'unknown'} does not match package.json ${packageVersion}`);
}

const project = readFileSync('Burrete.xcodeproj/project.pbxproj', 'utf8');
const marketingVersions = [...project.matchAll(/MARKETING_VERSION = ([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?);/g)].map(match => match[1]);
if (marketingVersions.length === 0) {
  fail('no MARKETING_VERSION entries found in Xcode project');
}
const mismatchedMarketingVersion = marketingVersions.find(version => version !== packageVersion);
if (mismatchedMarketingVersion) {
  fail(`Xcode MARKETING_VERSION ${mismatchedMarketingVersion} does not match package.json ${packageVersion}`);
}

if (process.env.GITHUB_EVENT_NAME === 'pull_request' && process.env.GITHUB_BASE_REF) {
  const base = process.env.GITHUB_BASE_REF;
  try {
    git(['fetch', '--quiet', 'origin', `+refs/heads/${base}:refs/remotes/origin/${base}`, '--tags']);
  } catch (error) {
    fail(`could not fetch base branch ${base}: ${error.stderr || error.message}`);
  }

  const basePackage = JSON.parse(git(['show', `origin/${base}:package.json`]));
  if (basePackage.version === packageVersion) {
    fail(`every merged PR creates a release, so this PR must bump package.json beyond ${basePackage.version}`);
  }

  try {
    git(['rev-parse', '--verify', `refs/tags/v${packageVersion}`]);
    fail(`release tag v${packageVersion} already exists`);
  } catch (error) {
    if (error.status !== 1 && error.status !== 128) {
      fail(`could not check release tag v${packageVersion}: ${error.stderr || error.message}`);
    }
  }
}
