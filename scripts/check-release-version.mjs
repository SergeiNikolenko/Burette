#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function cargoLockVersion(cargoLock, crateName) {
  const match = cargoLock.match(
    new RegExp(`\\[\\[package\\]\\]\\nname = "${escapeRegExp(crateName)}"\\nversion = "([^"]+)"`, 'm'),
  );
  if (!match) {
    fail(`apps/desktop/src-tauri/Cargo.lock must include ${crateName}`);
  }
  return match[1];
}

function pnpmImporterVersion(pnpmLock, packageName) {
  const match = pnpmLock.match(
    new RegExp(`^\\s{6}['"]?${escapeRegExp(packageName)}['"]?:\\n\\s{8}specifier: ([^\\n]+)\\n\\s{8}version: ([^\\n]+)`, 'm'),
  );
  if (!match) {
    fail(`pnpm-lock.yaml apps/desktop importer must include ${packageName}`);
  }
  return {
    specifier: match[1].trim(),
    version: match[2].trim().split('(')[0],
  };
}

function assertPinnedPackage(desktopPackage, pnpmLock, section, packageName, expectedVersion) {
  const actual = desktopPackage[section]?.[packageName];
  if (actual !== expectedVersion) {
    fail(`apps/desktop/package.json ${packageName} must be pinned to ${expectedVersion}, got ${actual || 'missing'}`);
  }

  const locked = pnpmImporterVersion(pnpmLock, packageName);
  if (locked.specifier !== expectedVersion || locked.version !== expectedVersion) {
    fail(
      `pnpm-lock.yaml ${packageName} must use ${expectedVersion}, got specifier ${locked.specifier} and version ${locked.version}`,
    );
  }
}

const packageVersion = readJSON('package.json').version;
if (!/^\d+\.\d+\.\d+$/.test(packageVersion)) {
  fail(`package.json version must be a plain semver release, got ${packageVersion}`);
}

const desktopPackage = readJSON('apps/desktop/package.json');
if (desktopPackage.version !== packageVersion) {
  fail(`apps/desktop/package.json version ${desktopPackage.version} does not match package.json ${packageVersion}`);
}

const tauriConfigVersion = readJSON('apps/desktop/src-tauri/tauri.conf.json').version;
if (tauriConfigVersion !== packageVersion) {
  fail(`apps/desktop/src-tauri/tauri.conf.json version ${tauriConfigVersion} does not match package.json ${packageVersion}`);
}

const pnpmLock = readFileSync('pnpm-lock.yaml', 'utf8');
if (!/^importers:\s*$/m.test(pnpmLock)) {
  fail('pnpm-lock.yaml must define an importers section');
}
if (!/^\s{2}\.\:\s*$/m.test(pnpmLock)) {
  fail('pnpm-lock.yaml must include importer "." for the workspace root');
}
if (!/^\s{2}apps\/desktop\:\s*$/m.test(pnpmLock)) {
  fail('pnpm-lock.yaml must include importer "apps/desktop"');
}

const cargoLock = readFileSync('apps/desktop/src-tauri/Cargo.lock', 'utf8');
assertPinnedPackage(desktopPackage, pnpmLock, 'dependencies', '@tauri-apps/api', cargoLockVersion(cargoLock, 'tauri'));
assertPinnedPackage(
  desktopPackage,
  pnpmLock,
  'dependencies',
  '@tauri-apps/plugin-dialog',
  cargoLockVersion(cargoLock, 'tauri-plugin-dialog'),
);
assertPinnedPackage(
  desktopPackage,
  pnpmLock,
  'dependencies',
  '@tauri-apps/plugin-opener',
  cargoLockVersion(cargoLock, 'tauri-plugin-opener'),
);
assertPinnedPackage(desktopPackage, pnpmLock, 'devDependencies', '@tauri-apps/cli', '2.11.1');

const project = readFileSync('Burrete.xcodeproj/project.pbxproj', 'utf8');
const marketingVersions = [...project.matchAll(/MARKETING_VERSION = ([0-9]+\.[0-9]+\.[0-9]+);/g)].map(match => match[1]);
if (marketingVersions.length === 0) {
  fail('no MARKETING_VERSION entries found in Xcode project');
}
const mismatchedMarketingVersion = marketingVersions.find(version => version !== packageVersion);
if (mismatchedMarketingVersion) {
  fail(`Xcode MARKETING_VERSION ${mismatchedMarketingVersion} does not match package.json ${packageVersion}`);
}

const contentView = readFileSync('App/ContentView.swift', 'utf8');
if (!contentView.includes(`Text("Version ${packageVersion}")`)) {
  fail(`App/ContentView.swift About panel does not show Version ${packageVersion}`);
}

const appDelegate = readFileSync('App/Platform/PlatformBridge.swift', 'utf8');
if (!appDelegate.includes('statusItem(withLength: NSStatusItem.squareLength)')) {
  fail('menu bar status item must use squareLength so it stays icon-only');
}
if (!appDelegate.includes('button.imagePosition = .imageOnly')) {
  fail('menu bar status item must use imageOnly so it does not show a text label');
}
if (/button\.title\s*=\s*"[^"]*\S[^"]*"/.test(appDelegate)) {
  fail('menu bar status item must not set a visible button title');
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
