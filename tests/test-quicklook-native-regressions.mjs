#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const source = await readFile(new URL("../PreviewExtension/Platform/PreviewViewController.swift", import.meta.url), "utf8");
const parser = source.slice(source.indexOf("    private static func countXYZFrames("), source.indexOf("    private static func estimateTrajectoryFrameCount("));
const timeout = source.slice(source.indexOf("private func scheduleRenderTimeout("), source.indexOf("    private func finishPreviewIfNeeded("));
const handler = source.slice(source.indexOf("fileprivate final class WeakPreviewScriptMessageHandler:"), source.indexOf("final class PreviewViewController:"));
assert.ok(parser && timeout, "native regression entrypoints must exist");

// Execute the production parser and timeout method without building the app or
// importing AppKit/WebKit. Stubs observe timeout effects on the active request.
const harness = `
import Foundation
protocol WKScriptMessageHandler: AnyObject {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage)
}
final class WKUserContentController {}
final class WKScriptMessage {}
${handler}
final class MessageRecipient: WKScriptMessageHandler {
    var received = 0
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) { received += 1 }
}
var recipient: MessageRecipient? = MessageRecipient()
weak var observedRecipient = recipient
private let retainedHandler = WeakPreviewScriptMessageHandler(delegate: recipient!)
retainedHandler.userContentController(WKUserContentController(), didReceive: WKScriptMessage())
assert(recipient?.received == 1)
recipient = nil
assert(observedRecipient == nil, "WebKit's retained handler must not retain its owner")
retainedHandler.userContentController(WKUserContentController(), didReceive: WKScriptMessage())
enum PreviewError: Error { case webRenderTimedOut }
final class PreviewHarness {
    var activePreviewRequestID = UUID()
    var renderTimeoutWorkItem: DispatchWorkItem?
    var renderedErrors = 0
    var completedRequests = 0
    func appendLog(_ message: String) {}
    func appendFailedPreviewTrace(requestID: UUID, error: Error, message: String) {}
    func renderNativeError(_ error: Error, fileURL: URL?) { renderedErrors += 1 }
    func finishPreviewIfNeeded(_ error: Error?, requestID: UUID) { completedRequests += 1 }
    ${parser}
    ${timeout}
    static func checkParser() {
        assert(countXYZFrames(lines: [String(Int.max), "comment"], start: 0) == nil)
        assert(countXYZFrames(lines: ["", String(Int.max - 1), "comment"], start: 0) == nil)
        assert(countXYZFrames(lines: ["2", "comment", "C 0 0 0"], start: 0) == nil)
        assert(countXYZFrames(lines: ["0", "comment"], start: 0) == nil)
        assert(countXYZFrames(lines: ["1", "comment", "C 0 0 0"], start: 0) == 1)
        assert(countXYZFrames(lines: ["1", "a", "C 0 0 0", "1", "b", "H 1 0 0"], start: 0) == 2)
    }
    func checkTimeout() {
        scheduleRenderTimeout(for: activePreviewRequestID, timeoutSeconds: 3600)
        activePreviewRequestID = UUID()
        renderTimeoutWorkItem?.perform()
        assert(renderedErrors == 0 && completedRequests == 0, "stale timeout modified current preview")
        scheduleRenderTimeout(for: activePreviewRequestID, timeoutSeconds: 3600)
        renderTimeoutWorkItem?.perform()
        assert(renderedErrors == 1 && completedRequests == 1)
        renderTimeoutWorkItem?.cancel()
    }
}
PreviewHarness.checkParser()
PreviewHarness().checkTimeout()
`;
const directory = await mkdtemp(path.join(tmpdir(), "burette-native-regression-"));
try {
  const file = path.join(directory, "regression.swift");
  await writeFile(file, harness);
  const result = spawnSync("swift", [file], { encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, `Swift regression failed (${result.signal ?? result.error ?? result.status}):\n${result.stderr.slice(0, 2000)}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}

const prepare = source.slice(source.indexOf("    func preparePreviewOfFile("), source.indexOf("    private func appendFileDiagnostics("));
assert.match(prepare, /renderTimeoutWorkItem\?\.cancel\(\)\s*renderTimeoutWorkItem = nil/);
assert.ok(prepare.indexOf("renderTimeoutWorkItem?.cancel()") < prepare.indexOf("webView.stopLoading()"));
assert.match(source, /userContentController\.add\(WeakPreviewScriptMessageHandler\(delegate: self\), name: "burette"\)/);
assert.doesNotMatch(source, /userContentController\.add\(self, name: "burette"\)/);
console.log("Quick Look native parser, timeout, and handler ownership regressions passed.");
