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

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const packageVersion = readJSON('package.json').version;
if (!/^\d+\.\d+\.\d+$/.test(packageVersion)) {
  fail(`package.json version must be a plain semver release, got ${packageVersion}`);
}

const packageLockVersion = readJSON('package-lock.json').version;
if (packageLockVersion !== packageVersion) {
  fail(`package-lock.json version ${packageLockVersion} does not match package.json ${packageVersion}`);
}

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
