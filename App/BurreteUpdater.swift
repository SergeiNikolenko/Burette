import AppKit
import Foundation

enum BurreteUpdateChannel: String, CaseIterable, Identifiable {
    case stable
    case beta

    var id: String { rawValue }

    var title: String {
        switch self {
        case .stable: return "Stable"
        case .beta: return "Beta"
        }
    }

    var description: String {
        switch self {
        case .stable:
            return "Receive only stable, production-ready releases."
        case .beta:
            return "Receive stable releases and prerelease builds."
        }
    }
}

enum BurreteUpdateRepository {
    static let ownerAndName = "SergeiNikolenko/Burette"
    static let releasesURL = URL(string: "https://api.github.com/repos/\(ownerAndName)/releases")!
}

struct BurreteUpdateAsset: Decodable, Equatable {
    let name: String
    let browserDownloadURL: URL
    let size: Int

    enum CodingKeys: String, CodingKey {
        case name
        case browserDownloadURL = "browser_download_url"
        case size
    }
}

struct BurreteUpdateRelease: Decodable, Equatable {
    let tagName: String
    let name: String?
    let htmlURL: URL
    let draft: Bool
    let prerelease: Bool
    let publishedAt: String?
    let assets: [BurreteUpdateAsset]

    enum CodingKeys: String, CodingKey {
        case tagName = "tag_name"
        case name
        case htmlURL = "html_url"
        case draft
        case prerelease
        case publishedAt = "published_at"
        case assets
    }

    var displayName: String {
        let trimmed = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? tagName : trimmed
    }

    var installAsset: BurreteUpdateAsset? {
        let installExtensions = [".dmg", ".zip", ".pkg"]
        let candidates = assets.filter { asset in
            let lower = asset.name.lowercased()
            return asset.size > 0 && installExtensions.contains { lower.hasSuffix($0) }
        }
        return candidates.first {
            $0.name.localizedCaseInsensitiveContains("burrete")
                || $0.name.localizedCaseInsensitiveContains("burette")
        } ?? candidates.first
    }
}

private struct BurreteGitHubReleaseResponse: Decodable {
    let message: String?
}

@MainActor
final class BurreteUpdater: ObservableObject {
    static let shared = BurreteUpdater()

    @Published private(set) var isChecking = false
    @Published private(set) var isDownloading = false
    @Published private(set) var isInstalling = false
    @Published private(set) var statusText: String
    @Published private(set) var availableRelease: BurreteUpdateRelease?
    @Published private(set) var availableReleaseChannel: BurreteUpdateChannel?
    @Published private(set) var downloadedFileURL: URL?

    private let releasesURL = BurreteUpdateRepository.releasesURL
    private let defaults = UserDefaults.standard
    private let automaticCheckInterval: TimeInterval = 12 * 60 * 60
    private let automaticFailureRetryInterval: TimeInterval = 60 * 60
    private var activeUpdateRequestID = UUID()

    private init() {
        if defaults.object(forKey: "checkUpdatesAutomatically") == nil {
            defaults.set(true, forKey: "checkUpdatesAutomatically")
        }
        if defaults.object(forKey: "updateChannel") == nil {
            defaults.set(BurreteUpdateChannel.stable.rawValue, forKey: "updateChannel")
        }
        statusText = defaults.string(forKey: "updateStatusText") ?? "No update check has run yet."
    }

    var currentVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    }

    var primaryActionTitle: String {
        if isChecking {
            return "Checking..."
        }
        if isDownloading {
            return "Downloading..."
        }
        if isInstalling {
            return "Installing..."
        }
        if availableReleaseChannel == storedChannel(), availableRelease?.installAsset != nil {
            return "Download and Install..."
        }
        if availableReleaseChannel == storedChannel(), availableRelease != nil {
            return "Open Release Page..."
        }
        return "Check for Updates..."
    }

    func checkAutomaticallyIfNeeded() {
        guard defaults.bool(forKey: "checkUpdatesAutomatically") else { return }
        let lastSuccess = defaults.object(forKey: "lastAutomaticUpdateSuccessAt") as? Date ?? .distantPast
        let lastFailure = defaults.object(forKey: "lastAutomaticUpdateFailureAt") as? Date ?? .distantPast
        guard Date().timeIntervalSince(lastSuccess) >= automaticCheckInterval,
              Date().timeIntervalSince(lastFailure) >= automaticFailureRetryInterval else { return }
        let channel = storedChannel()
        Task {
            await checkForUpdates(channel: channel, isAutomatic: true)
        }
    }

    func runPrimaryAction(channel: BurreteUpdateChannel) async {
        if let release = availableRelease, availableReleaseChannel == channel {
            if release.installAsset != nil {
                await downloadAndInstallAvailableUpdate()
            } else {
                NSWorkspace.shared.open(release.htmlURL)
            }
            return
        }
        await checkForUpdates(channel: channel, isAutomatic: false)
    }

    func clearAvailableRelease() {
        activeUpdateRequestID = UUID()
        availableRelease = nil
        availableReleaseChannel = nil
        downloadedFileURL = nil
        setStatus("Update channel changed. Check for updates again.")
    }

    func checkForUpdates(channel: BurreteUpdateChannel, isAutomatic: Bool) async {
        guard !isChecking else { return }
        let requestID = UUID()
        activeUpdateRequestID = requestID
        isChecking = true
        if !isAutomatic {
            statusText = "Checking GitHub releases..."
        }
        downloadedFileURL = nil
        defer { isChecking = false }

        do {
            let releases = try await fetchReleases()
            guard isCurrentUpdateRequest(requestID, channel: channel) else { return }
            if let release = newestUpdate(in: releases, channel: channel) {
                availableRelease = release
                availableReleaseChannel = channel
                let assetText = release.installAsset == nil ? " No downloadable app archive is attached to this release." : ""
                setStatus("Update available: \(release.displayName) (\(release.tagName)).\(assetText)")
            } else {
                availableRelease = nil
                availableReleaseChannel = nil
                setStatus("Burrete \(currentVersion) is up to date on \(channel.title).")
            }
            if isAutomatic {
                defaults.set(Date(), forKey: "lastAutomaticUpdateSuccessAt")
                defaults.removeObject(forKey: "lastAutomaticUpdateFailureAt")
            }
        } catch {
            guard isCurrentUpdateRequest(requestID, channel: channel) else { return }
            if !isAutomatic {
                availableRelease = nil
                availableReleaseChannel = nil
            } else {
                defaults.set(Date(), forKey: "lastAutomaticUpdateFailureAt")
            }
            setStatus("Update check failed: \(error.localizedDescription)")
        }
    }

    func downloadAndInstallAvailableUpdate() async {
        guard let release = availableRelease, let asset = release.installAsset else {
            if let release = availableRelease {
                NSWorkspace.shared.open(release.htmlURL)
            }
            return
        }
        guard !isDownloading, !isInstalling else { return }

        isDownloading = true
        statusText = "Downloading \(asset.name)..."

        do {
            let destination = try await download(asset: asset, from: release)
            downloadedFileURL = destination
            isDownloading = false
            isInstalling = true
            setStatus("Installing \(release.displayName)... Burrete will restart when the update is ready.")
            try prepareAndLaunchInstaller(archiveURL: destination, release: release, asset: asset)
            setStatus("Installer launched for \(release.displayName). Burrete will quit and reopen automatically.")
            NSApp.terminate(nil)
        } catch {
            isDownloading = false
            isInstalling = false
            setStatus("Update install failed: \(error.localizedDescription)")
        }
    }

    func revealDownloadedUpdate() {
        guard let downloadedFileURL else { return }
        NSWorkspace.shared.activateFileViewerSelecting([downloadedFileURL])
    }

    private func fetchReleases() async throws -> [BurreteUpdateRelease] {
        var request = URLRequest(url: releasesURL)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("Burrete/\(currentVersion)", forHTTPHeaderField: "User-Agent")
        request.cachePolicy = .reloadIgnoringLocalCacheData

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw BurreteUpdateError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            let apiMessage = try? JSONDecoder().decode(BurreteGitHubReleaseResponse.self, from: data).message
            throw BurreteUpdateError.github(status: httpResponse.statusCode, message: apiMessage)
        }
        return try JSONDecoder().decode([BurreteUpdateRelease].self, from: data)
    }

    private func newestUpdate(in releases: [BurreteUpdateRelease], channel: BurreteUpdateChannel) -> BurreteUpdateRelease? {
        let current = BurreteVersion(currentVersion)
        return releases.filter { release in
            guard !release.draft else { return false }
            guard channel == .beta || !release.prerelease else { return false }
            return BurreteVersion(release.tagName) > current
        }.max {
            BurreteVersion($0.tagName) < BurreteVersion($1.tagName)
        }
    }

    private func download(asset: BurreteUpdateAsset, from release: BurreteUpdateRelease) async throws -> URL {
        guard asset.size > 0 else {
            throw BurreteUpdateError.invalidAsset("Release asset \(asset.name) reports zero bytes.")
        }
        var request = URLRequest(url: asset.browserDownloadURL)
        request.setValue("application/octet-stream", forHTTPHeaderField: "Accept")
        request.setValue("Burrete/\(currentVersion)", forHTTPHeaderField: "User-Agent")

        let (temporaryURL, response) = try await URLSession.shared.download(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            throw BurreteUpdateError.invalidResponse
        }

        let updatesDirectory = try updatesDirectoryURL(for: release)
        let destination = updatesDirectory.appendingPathComponent(asset.name)
        let fileManager = FileManager.default
        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: destination)
        }
        try fileManager.moveItem(at: temporaryURL, to: destination)
        let downloadedSize = ((try? fileManager.attributesOfItem(atPath: destination.path)[.size]) as? NSNumber)?.intValue ?? 0
        guard downloadedSize == asset.size else {
            try? fileManager.removeItem(at: destination)
            throw BurreteUpdateError.downloadedAssetSizeMismatch(expected: asset.size, actual: downloadedSize)
        }
        return destination
    }

    private func prepareAndLaunchInstaller(archiveURL: URL, release: BurreteUpdateRelease, asset: BurreteUpdateAsset) throws {
        guard asset.name.lowercased().hasSuffix(".zip") else {
            throw BurreteUpdateError.unsupportedAsset(asset.name)
        }

        let fileManager = FileManager.default
        let updatesDirectory = try updatesDirectoryURL(for: release)
        let stagingDirectory = updatesDirectory
            .appendingPathComponent("Install-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: stagingDirectory, withIntermediateDirectories: true)

        try runProcess("/usr/bin/ditto", arguments: ["-x", "-k", archiveURL.path, stagingDirectory.path])

        let appURL = try findDownloadedApp(in: stagingDirectory, fileManager: fileManager)
        try validateDownloadedApp(appURL, release: release)

        let scriptURL = updatesDirectory.appendingPathComponent("install-\(safePathComponent(release.tagName)).sh")
        let logURL = updatesDirectory.appendingPathComponent("install-\(safePathComponent(release.tagName)).log")
        let currentAppURL = Bundle.main.bundleURL.standardizedFileURL
        let script = installerScript(
            appPID: ProcessInfo.processInfo.processIdentifier,
            newAppURL: appURL,
            destinationAppURL: currentAppURL,
            logURL: logURL
        )
        try Data(script.utf8).write(to: scriptURL, options: [.atomic])
        try fileManager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: scriptURL.path)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [scriptURL.path]
        do {
            try process.run()
        } catch {
            throw BurreteUpdateError.installerLaunchFailed(error.localizedDescription)
        }
    }

    private func findDownloadedApp(in directory: URL, fileManager: FileManager) throws -> URL {
        guard let enumerator = fileManager.enumerator(
            at: directory,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else {
            throw BurreteUpdateError.appNotFoundInArchive
        }

        for case let url as URL in enumerator {
            guard url.pathExtension == "app" else { continue }
            let infoPlist = url.appendingPathComponent("Contents/Info.plist")
            guard let info = NSDictionary(contentsOf: infoPlist),
                  info["CFBundleIdentifier"] as? String == "com.local.BurreteV10" else {
                continue
            }
            return url
        }
        throw BurreteUpdateError.appNotFoundInArchive
    }

    private func validateDownloadedApp(_ appURL: URL, release: BurreteUpdateRelease) throws {
        let infoPlist = appURL.appendingPathComponent("Contents/Info.plist")
        guard let info = NSDictionary(contentsOf: infoPlist),
              info["CFBundleIdentifier"] as? String == "com.local.BurreteV10" else {
            throw BurreteUpdateError.invalidDownloadedApp("The archive does not contain com.local.BurreteV10.")
        }

        let downloadedVersion = info["CFBundleShortVersionString"] as? String ?? "0"
        guard BurreteVersion(downloadedVersion) > BurreteVersion(currentVersion) else {
            throw BurreteUpdateError.invalidDownloadedApp("Downloaded version \(downloadedVersion) is not newer than \(currentVersion).")
        }
        let releaseVersion = release.tagName.trimmingPrefix("v")
        guard BurreteVersion(downloadedVersion) == BurreteVersion(releaseVersion) else {
            throw BurreteUpdateError.invalidDownloadedApp("Downloaded version \(downloadedVersion) does not match release \(release.tagName).")
        }

        let executable = appURL.appendingPathComponent("Contents/MacOS/Burrete")
        guard FileManager.default.isExecutableFile(atPath: executable.path) else {
            throw BurreteUpdateError.invalidDownloadedApp("The downloaded app executable is missing.")
        }
    }

    private func runProcess(_ executable: String, arguments: [String]) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw BurreteUpdateError.processFailed(URL(fileURLWithPath: executable).lastPathComponent, process.terminationStatus)
        }
    }

    private func installerScript(appPID: Int32, newAppURL: URL, destinationAppURL: URL, logURL: URL) -> String {
        """
        #!/bin/bash
        set -euo pipefail

        APP_PID=\(appPID)
        NEW_APP=\(shellQuote(newAppURL.path))
        DEST_APP=\(shellQuote(destinationAppURL.path))
        APP_ID='com.local.BurreteV10'
        EXT_ID='com.local.BurreteV10.Preview'
        LOG_FILE=\(shellQuote(logURL.path))

        mkdir -p "$(dirname "$LOG_FILE")"
        exec >>"$LOG_FILE" 2>&1
        echo "== Burrete updater $(date) =="
        echo "new app: $NEW_APP"
        echo "destination: $DEST_APP"

        for _ in $(seq 1 80); do
          if ! kill -0 "$APP_PID" 2>/dev/null; then
            break
          fi
          sleep 0.25
        done
        if kill -0 "$APP_PID" 2>/dev/null; then
          echo "error: Burrete did not quit in time"
          exit 1
        fi

        clean_detritus() {
          local path="$1"
          [ -e "$path" ] || return 0
          /usr/bin/xattr -cr "$path" 2>/dev/null || true
          /usr/bin/dot_clean -m "$path" 2>/dev/null || true
          /usr/bin/find "$path" \\( -name '._*' -o -name '.DS_Store' \\) -delete 2>/dev/null || true
        }

        PARENT_DIR="$(dirname "$DEST_APP")"
        TMP_APP="${DEST_APP}.updating"
        BACKUP_APP="${DEST_APP}.previous"
        mkdir -p "$PARENT_DIR"
        rm -rf "$TMP_APP"
        /bin/cp -R "$NEW_APP" "$TMP_APP"
        clean_detritus "$TMP_APP"

        ACTUAL_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$TMP_APP/Contents/Info.plist")"
        if [ "$ACTUAL_ID" != "$APP_ID" ]; then
          echo "error: bundle id mismatch: $ACTUAL_ID"
          rm -rf "$TMP_APP"
          exit 1
        fi

        rm -rf "$BACKUP_APP"
        if [ -d "$DEST_APP" ]; then
          /bin/mv "$DEST_APP" "$BACKUP_APP"
        fi
        if ! /bin/mv "$TMP_APP" "$DEST_APP"; then
          if [ -d "$BACKUP_APP" ]; then
            /bin/mv "$BACKUP_APP" "$DEST_APP"
          fi
          exit 1
        fi
        rm -rf "$BACKUP_APP"

        APPEX="$DEST_APP/Contents/PlugIns/BurretePreview.appex"
        LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
        [ -x "$LSREGISTER" ] && "$LSREGISTER" -f -R "$DEST_APP" || true
        [ -d "$APPEX" ] && /usr/bin/pluginkit -a "$APPEX" 2>/dev/null || true
        /usr/bin/pluginkit -e use -i "$EXT_ID" 2>/dev/null || true
        /usr/bin/qlmanage -r >/dev/null 2>&1 || true
        /usr/bin/qlmanage -r cache >/dev/null 2>&1 || true
        /usr/bin/killall quicklookd >/dev/null 2>&1 || true
        /usr/bin/open "$DEST_APP"
        echo "update installed"
        """
    }

    private func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    private func updatesDirectoryURL(for release: BurreteUpdateRelease) throws -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Burrete", isDirectory: true)
            .appendingPathComponent("Updates", isDirectory: true)
            .appendingPathComponent(safePathComponent(release.tagName), isDirectory: true)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    private func safePathComponent(_ value: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: ".-_"))
        let scalars = value.unicodeScalars.map { allowed.contains($0) ? Character($0) : "-" }
        let result = String(scalars).trimmingCharacters(in: CharacterSet(charactersIn: ".-"))
        return result.isEmpty ? "release" : result
    }

    private func storedChannel() -> BurreteUpdateChannel {
        BurreteUpdateChannel(rawValue: defaults.string(forKey: "updateChannel") ?? "") ?? .stable
    }

    private func isCurrentUpdateRequest(_ requestID: UUID, channel: BurreteUpdateChannel) -> Bool {
        requestID == activeUpdateRequestID && storedChannel() == channel
    }

    private func setStatus(_ status: String) {
        statusText = status
        defaults.set(status, forKey: "updateStatusText")
        defaults.set(Date(), forKey: "lastUpdateCheckAt")
    }
}

private enum BurreteUpdateError: LocalizedError {
    case invalidResponse
    case github(status: Int, message: String?)
    case unsupportedAsset(String)
    case appNotFoundInArchive
    case invalidDownloadedApp(String)
    case processFailed(String, Int32)
    case installerLaunchFailed(String)
    case invalidAsset(String)
    case downloadedAssetSizeMismatch(expected: Int, actual: Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "GitHub returned an invalid response."
        case let .github(status, message):
            if let message, !message.isEmpty {
                return "GitHub returned HTTP \(status): \(message)"
            }
            return "GitHub returned HTTP \(status)."
        case .unsupportedAsset(let name):
            return "Automatic installation supports zip app archives only. Downloaded asset: \(name)"
        case .appNotFoundInArchive:
            return "The update archive does not contain Burrete.app."
        case .invalidDownloadedApp(let reason):
            return "The downloaded app is not a valid Burrete update. \(reason)"
        case .processFailed(let name, let status):
            return "\(name) exited with status \(status)."
        case .installerLaunchFailed(let reason):
            return "Could not launch the updater helper: \(reason)"
        case .invalidAsset(let message):
            return message
        case let .downloadedAssetSizeMismatch(expected, actual):
            return "Downloaded update archive size mismatch: expected \(expected) bytes, got \(actual) bytes."
        }
    }
}

private struct BurreteVersion: Comparable {
    private let parts: [Int]

    init(_ rawValue: String) {
        let cleaned = rawValue
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingPrefix("v")
            .split { $0 == "-" || $0 == "+" }
            .first
            .map(String.init) ?? rawValue
        parts = cleaned
            .split(separator: ".")
            .map { component in
                let digits = component.prefix { $0.isNumber }
                return Int(digits) ?? 0
            }
    }

    static func < (lhs: BurreteVersion, rhs: BurreteVersion) -> Bool {
        let count = max(lhs.parts.count, rhs.parts.count)
        for index in 0..<count {
            let left = index < lhs.parts.count ? lhs.parts[index] : 0
            let right = index < rhs.parts.count ? rhs.parts[index] : 0
            if left != right {
                return left < right
            }
        }
        return false
    }
}

private extension String {
    func trimmingPrefix(_ prefix: String) -> String {
        hasPrefix(prefix) ? String(dropFirst(prefix.count)) : self
    }
}
