#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") {
  console.log("SKIP Quick Look native regressions: requires macOS Swift runtime (covered by macOS CI).");
  process.exit(0);
}

const source = await readFile(new URL("../PreviewExtension/Platform/PreviewViewController.swift", import.meta.url), "utf8");
const parser = source.slice(source.indexOf("    private static func countXYZFrames("), source.indexOf("    private static func estimateTrajectoryFrameCount("));
const cubeParser = source.slice(source.indexOf("    private static func parseCube("), source.indexOf("    private static func parseABINIT("));
const abinitParser = source.slice(source.indexOf("    private static func parseABINIT("), source.indexOf("    private static func parseFDF("));
const orientationParser = source.slice(source.indexOf("    private static func normalizedXyzrenderOrientationRef("), source.indexOf("    private func reloadCurrentPreview("));
const navigationFailures = source.slice(source.indexOf("func webView(_ webView: WKWebView, didFail navigation:"), source.indexOf("    func webViewWebContentProcessDidTerminate("));
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
final class WKNavigation {}
final class WKWebView {}
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
    struct Atom { let symbol: String; let x: Double; let y: Double; let z: Double }
    static func fields(_ line: String) -> [String] { line.split(whereSeparator: \\.isWhitespace).map(String.init) }
    static func symbol(for number: Int) -> String { number == 6 ? "C" : "O" }
    static func stripInlineComment(_ line: String) -> String { line }
    static func describe(_ error: Error) -> String { error.localizedDescription }
    var activePreviewRequestID = UUID()
    var activePreviewNavigation: WKNavigation?
    var renderTimeoutWorkItem: DispatchWorkItem?
    var renderedErrors = 0
    var completedRequests = 0
    func appendLog(_ message: String) {}
    func appendFailedPreviewTrace(requestID: UUID, error: Error, message: String) {}
    func renderNativeError(_ error: Error, fileURL: URL?) { renderedErrors += 1 }
    func finishPreviewIfNeeded(_ error: Error?, requestID: UUID? = nil) { completedRequests += 1 }
    ${parser}
    ${cubeParser}
    ${abinitParser}
    ${orientationParser}
    ${navigationFailures}
    ${timeout}
    static func checkParser() {
        assert(countXYZFrames(lines: [String(Int.max), "comment"], start: 0) == nil)
        assert(countXYZFrames(lines: ["", String(Int.max - 1), "comment"], start: 0) == nil)
        assert(countXYZFrames(lines: ["2", "comment", "C 0 0 0"], start: 0) == nil)
        assert(countXYZFrames(lines: ["0", "comment"], start: 0) == nil)
        assert(countXYZFrames(lines: ["1", "comment", "C 0 0 0"], start: 0) == 1)
        assert(countXYZFrames(lines: ["1", "a", "C 0 0 0", "1", "b", "H 1 0 0"], start: 0) == 2)
        let cube = ["", "", "2 0 0 0", "1 1 0 0", "1 0 1 0", "1 0 0 1", "6 0 0 0 0", "8 0 2 0 0"]
        assert(parseCube(cube)?.count == 2)
        for count in [Int.min, Int.max, 3] {
            var malformed = cube
            malformed[2] = "\\(count) 0 0 0"
            assert(parseCube(malformed) == nil, "Malformed cube count must not overflow")
        }
        assert(normalizedXyzrenderOrientationRef("\\(Int.max)\\ncomment\\n") == nil)
        assert(normalizedXyzrenderOrientationRef("1\\ncomment\\nC 0 0 0") == "1\\ncomment\\nC 0 0 0\\n")
        assert(parseABINIT(["natom 1", "znucl 6", "typat \\(Int.min)", "xangst", "0 0 0"]) == nil)
        assert(parseABINIT(["natom 1", "znucl 6", "typat 1", "xangst", "0 0 0"])?.count == 1)
    }
    func checkNavigationFailures() {
        let view = WKWebView()
        let stale = WKNavigation()
        let current = WKNavigation()
        activePreviewNavigation = current
        let failure = NSError(domain: NSURLErrorDomain, code: NSURLErrorCannotOpenFile)
        webView(view, didFail: stale, withError: failure)
        webView(view, didFailProvisionalNavigation: stale, withError: failure)
        let cancelled = NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled)
        webView(view, didFail: current, withError: cancelled)
        webView(view, didFailProvisionalNavigation: current, withError: cancelled)
        assert(renderedErrors == 0 && completedRequests == 0, "Stale or cancelled navigation must not replace the new preview")
        webView(view, didFailProvisionalNavigation: current, withError: failure)
        assert(renderedErrors == 1 && completedRequests == 1)
        webView(view, didFail: current, withError: failure)
        assert(renderedErrors == 2 && completedRequests == 2)
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
PreviewHarness().checkNavigationFailures()
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
console.log("Quick Look native parsers, stale navigation, timeout, and handler ownership regressions passed.");
