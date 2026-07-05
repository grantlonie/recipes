import UIKit
import UniformTypeIdentifiers

private let appUrlScheme = "gerecipes"
private let urlPattern = #"https?://[^\s<>"{}|\\^`[\]]+"#

class ShareViewController: UIViewController {
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        handleSharedContent()
    }

    private func handleSharedContent() {
        guard let extensionItem = extensionContext?.inputItems.first as? NSExtensionItem else {
            complete()
            return
        }

        let attachments = extensionItem.attachments ?? []
        if attachments.isEmpty {
            openImport(with: extractRecipeUrl(from: extensionItem.attributedContentText?.string))
            return
        }

        loadSharedUrl(from: attachments, fallbackText: extensionItem.attributedContentText?.string)
    }

    private func loadSharedUrl(from attachments: [NSItemProvider], fallbackText: String?) {
        let urlTypes = [UTType.url.identifier, UTType.fileURL.identifier, "public.url"]

        for attachment in attachments {
            for typeIdentifier in urlTypes where attachment.hasItemConformingToTypeIdentifier(typeIdentifier) {
                attachment.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { [weak self] item, _ in
                    DispatchQueue.main.async {
                        if let url = item as? URL {
                            self?.openImport(with: url.absoluteString)
                            return
                        }

                        if let urlString = item as? String, let url = URL(string: urlString) {
                            self?.openImport(with: url.absoluteString)
                            return
                        }

                        self?.openImport(with: self?.extractRecipeUrl(from: fallbackText))
                    }
                }
                return
            }
        }

        if attachmentSupportsText(attachments) {
            attachments[0].loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] item, _ in
                DispatchQueue.main.async {
                    let text = item as? String
                    self?.openImport(with: self?.extractRecipeUrl(from: text))
                }
            }
            return
        }

        openImport(with: extractRecipeUrl(from: fallbackText))
    }

    private func attachmentSupportsText(_ attachments: [NSItemProvider]) -> Bool {
        attachments.contains { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }
    }

    private func extractRecipeUrl(from text: String?) -> String? {
        guard let text, !text.isEmpty else {
            return nil
        }

        guard let regex = try? NSRegularExpression(pattern: urlPattern, options: [.caseInsensitive]) else {
            return nil
        }

        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = regex.firstMatch(in: text, options: [], range: range),
              let matchRange = Range(match.range, in: text) else {
            return nil
        }

        return String(text[matchRange]).trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!?)"))
    }

    private func openImport(with recipeUrl: String?) {
        guard let recipeUrl, let deepLink = makeImportDeepLink(recipeUrl: recipeUrl) else {
            complete()
            return
        }

        extensionContext?.open(deepLink) { [weak self] _ in
            self?.complete()
        }
    }

    private func makeImportDeepLink(recipeUrl: String) -> URL? {
        var components = URLComponents()
        components.scheme = appUrlScheme
        components.host = "import"
        components.queryItems = [URLQueryItem(name: "url", value: recipeUrl)]
        return components.url
    }

    private func complete() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
