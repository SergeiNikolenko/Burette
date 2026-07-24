import SwiftUI

/// A single command surfaced in the palette (mockup 14: ⌘P parity).
struct MobileCommand: Identifiable {
    enum Group: String, CaseIterable {
        case representation = "Representation"
        case view = "View"
        case actions = "Actions"
    }

    let id = UUID()
    let title: String
    let systemImage: String
    let group: Group
    let perform: () -> Void
}

/// Command palette (mockup 14). A searchable list of viewer actions —
/// representations, view modes, and export — mirroring the desktop ⌘P palette.
struct MobileCommandPalette: View {
    let commands: [MobileCommand]
    let shareURL: URL?
    @Binding var searchText: String
    let dismiss: () -> Void

    var body: some View {
        NavigationStack {
            List {
                ForEach(MobileCommand.Group.allCases, id: \.self) { group in
                    let groupCommands = filtered.filter { $0.group == group }
                    if !groupCommands.isEmpty {
                        Section(group.rawValue) {
                            ForEach(groupCommands) { command in
                                Button {
                                    command.perform()
                                    dismiss()
                                } label: {
                                    Label(command.title, systemImage: command.systemImage)
                                }
                            }
                        }
                    }
                }

                if let shareURL {
                    Section("Share") {
                        ShareLink(item: shareURL) {
                            Label("Share / Open In…", systemImage: "square.and.arrow.up")
                        }
                    }
                }

                if filtered.isEmpty {
                    ContentUnavailableView.search(text: searchText)
                }
            }
            .navigationTitle("Commands")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search commands")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    private var filtered: [MobileCommand] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return commands }
        return commands.filter { $0.title.localizedCaseInsensitiveContains(query) }
    }
}
