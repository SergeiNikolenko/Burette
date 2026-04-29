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
            return installExtensions.contains { lower.hasSuffix($0) }
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
    @Published private(set) var statusText: String
    @Published private(set) var availableRelease: BurreteUpdateRelease?
    @Published private(set) var downloadedFileURL: URL?

    private let releasesURL = BurreteUpdateRepository.releasesURL
    private let defaults = UserDefaults.standard
    private let automaticCheckInterval: TimeInterval = 12 * 60 * 60

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
        if availableRelease?.installAsset != nil {
            return "Download Update..."
        }
        if availableRelease != nil {
            return "Open Release Page..."
        }
        return "Check for Updates..."
    }

    func checkAutomaticallyIfNeeded() {
        guard defaults.bool(forKey: "checkUpdatesAutomatically") else { return }
        let lastCheck = defaults.object(forKey: "lastAutomaticUpdateCheckAt") as? Date ?? .distantPast
        guard Date().timeIntervalSince(lastCheck) >= automaticCheckInterval else { return }
        defaults.set(Date(), forKey: "lastAutomaticUpdateCheckAt")
        let channel = storedChannel()
        Task {
            await checkForUpdates(channel: channel, isAutomatic: true)
        }
    }

    func runPrimaryAction(channel: BurreteUpdateChannel) async {
        if let release = availableRelease {
            if release.installAsset != nil {
                await downloadAvailableUpdate()
            } else {
                NSWorkspace.shared.open(release.htmlURL)
            }
            return
        }
        await checkForUpdates(channel: channel, isAutomatic: false)
    }

    func checkForUpdates(channel: BurreteUpdateChannel, isAutomatic: Bool) async {
        guard !isChecking else { return }
        isChecking = true
        if !isAutomatic {
            statusText = "Checking GitHub releases..."
        }
        downloadedFileURL = nil
        defer { isChecking = false }

        do {
            let releases = try await fetchReleases()
            if let release = newestUpdate(in: releases, channel: channel) {
                availableRelease = release
                let assetText = release.installAsset == nil ? " No downloadable app archive is attached to this release." : ""
                setStatus("Update available: \(release.displayName) (\(release.tagName)).\(assetText)")
            } else {
                availableRelease = nil
                setStatus("Burrete \(currentVersion) is up to date on \(channel.title).")
            }
        } catch {
            if !isAutomatic {
                availableRelease = nil
            }
            setStatus("Update check failed: \(error.localizedDescription)")
        }
    }

    func downloadAvailableUpdate() async {
        guard let release = availableRelease, let asset = release.installAsset else {
            if let release = availableRelease {
                NSWorkspace.shared.open(release.htmlURL)
            }
            return
        }
        guard !isDownloading else { return }

        isDownloading = true
        statusText = "Downloading \(asset.name)..."
        defer { isDownloading = false }

        do {
            let destination = try await download(asset: asset, from: release)
            downloadedFileURL = destination
            setStatus("Downloaded \(asset.name). The update archive is selected in Finder.")
            NSWorkspace.shared.activateFileViewerSelecting([destination])
        } catch {
            setStatus("Update download failed: \(error.localizedDescription)")
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
        return destination
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

    private func setStatus(_ status: String) {
        statusText = status
        defaults.set(status, forKey: "updateStatusText")
        defaults.set(Date(), forKey: "lastUpdateCheckAt")
    }
}

private enum BurreteUpdateError: LocalizedError {
    case invalidResponse
    case github(status: Int, message: String?)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "GitHub returned an invalid response."
        case let .github(status, message):
            if let message, !message.isEmpty {
                return "GitHub returned HTTP \(status): \(message)"
            }
            return "GitHub returned HTTP \(status)."
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
