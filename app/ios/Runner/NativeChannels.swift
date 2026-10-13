import Flutter
import ImageIO
import LocalAuthentication
import Photos
import UIKit

/// Hands a decrypted file to the device: into the photo library, or wherever
/// the user points the system's export dialog.
final class SaveChannel: NSObject, UIDocumentPickerDelegate {
  static let name = "kura/save"

  /// The export dialog needs a file to copy from. It lives here, protected
  /// while the device is locked, and is deleted the moment the dialog closes.
  private static let exportFolder = FileManager.default.temporaryDirectory
    .appendingPathComponent("kura-export", isDirectory: true)

  private var pendingResult: FlutterResult?
  private var pendingFolder: URL?

  func register(with messenger: FlutterBinaryMessenger) {
    // Anything left by a run that was killed mid-export
    try? FileManager.default.removeItem(at: SaveChannel.exportFolder)

    FlutterMethodChannel(name: SaveChannel.name, binaryMessenger: messenger)
      .setMethodCallHandler { [weak self] call, result in
        guard
          let args = call.arguments as? [String: Any],
          let bytes = args["bytes"] as? FlutterStandardTypedData,
          let rawName = args["name"] as? String
        else {
          result(FlutterError(code: "invalid", message: "Missing arguments", details: nil))
          return
        }
        // Only a file name: a stored name must never steer where the file lands
        let last = (rawName as NSString).lastPathComponent
        let name = last.isEmpty || last == "/" ? "photo.jpg" : last
        switch call.method {
        case "gallery": self?.saveToGallery(bytes.data, name: name, result: result)
        case "files": self?.export(bytes.data, name: name, result: result)
        default: result(FlutterMethodNotImplemented)
        }
      }
  }

  private func saveToGallery(_ data: Data, name: String, result: @escaping FlutterResult) {
    // Add-only: the app can put a photo in the library but never read it
    PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
      guard status == .authorized || status == .limited else {
        DispatchQueue.main.async {
          result(FlutterError(code: "denied", message: "Photo library access was refused", details: nil))
        }
        return
      }
      PHPhotoLibrary.shared().performChanges({
        let options = PHAssetResourceCreationOptions()
        options.originalFilename = name
        PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: options)
      }) { saved, _ in
        DispatchQueue.main.async {
          // Error text never includes the file's name
          saved
            ? result(nil)
            : result(FlutterError(code: "failed", message: "Could not save the file", details: nil))
        }
      }
    }
  }

  private func export(_ data: Data, name: String, result: @escaping FlutterResult) {
    guard pendingResult == nil, let presenter = SaveChannel.topViewController() else {
      result(FlutterError(code: "busy", message: "Another save is in progress", details: nil))
      return
    }
    let folder = SaveChannel.exportFolder.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let file = folder.appendingPathComponent(name)
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      try data.write(to: file, options: [.atomic, .completeFileProtection])
    } catch {
      try? FileManager.default.removeItem(at: folder)
      result(FlutterError(code: "failed", message: "Could not save the file", details: nil))
      return
    }
    pendingResult = result
    pendingFolder = folder
    let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
    picker.delegate = self
    presenter.present(picker, animated: true)
  }

  private func finishExport(saved: Bool) {
    if let folder = pendingFolder { try? FileManager.default.removeItem(at: folder) }
    pendingFolder = nil
    pendingResult?(saved)
    pendingResult = nil
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    finishExport(saved: true)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    finishExport(saved: false)
  }

  private static func topViewController() -> UIViewController? {
    let windows = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
    var top = (windows.first { $0.isKeyWindow } ?? windows.first)?.rootViewController
    while let presented = top?.presentedViewController { top = presented }
    return top
  }
}

/// Builds the two derived tiers of an upload from the original's bytes, and
/// reads when and where it was taken. Everything stays in memory. Sizes and
/// quality match web/src/lib/media/imageProcessing.ts so uploads look the same
/// whichever client made them.
final class MediaChannel {
  static let name = "kura/media"
  private static let thumbEdge = 200.0
  private static let thumbQuality = 0.8
  private static let previewEdge = 1080.0
  private static let previewQuality = 0.85

  func register(with messenger: FlutterBinaryMessenger) {
    FlutterMethodChannel(name: MediaChannel.name, binaryMessenger: messenger)
      .setMethodCallHandler { call, result in
        switch call.method {
        case "process":
          guard
            let args = call.arguments as? [String: Any],
            let bytes = args["bytes"] as? FlutterStandardTypedData
          else {
            result(FlutterError(code: "invalid", message: "Missing arguments", details: nil))
            return
          }
          DispatchQueue.global(qos: .userInitiated).async {
            let processed = MediaChannel.process(bytes.data)
            DispatchQueue.main.async {
              result(processed ?? FlutterError(code: "unsupported", message: "This image cannot be read", details: nil))
            }
          }
        case "keepAwake":
          // While uploads run, so the screen turning off does not pause them
          UIApplication.shared.isIdleTimerDisabled = (call.arguments as? Bool) ?? false
          result(nil)
        default:
          result(FlutterMethodNotImplemented)
        }
      }
  }

  private static func process(_ data: Data) -> [String: Any]? {
    guard
      let source = CGImageSourceCreateWithData(data as CFData, nil),
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let pixelWidth = properties[kCGImagePropertyPixelWidth] as? Double,
      let pixelHeight = properties[kCGImagePropertyPixelHeight] as? Double,
      pixelWidth > 0, pixelHeight > 0
    else { return nil }

    // Orientations 5 to 8 are turned on their side
    let orientation = (properties[kCGImagePropertyOrientation] as? Int) ?? 1
    let swapsAxes = orientation >= 5 && orientation <= 8
    // As it should be looked at, which is how the web client reports it
    let width = swapsAxes ? pixelHeight : pixelWidth
    let height = swapsAxes ? pixelWidth : pixelHeight

    guard
      let thumb = jpeg(source, width: width, height: height, edge: thumbEdge, quality: thumbQuality),
      let preview = jpeg(source, width: width, height: height, edge: previewEdge, quality: previewQuality)
    else { return nil }

    var out: [String: Any] = [
      "thumb": FlutterStandardTypedData(bytes: thumb),
      "preview": FlutterStandardTypedData(bytes: preview),
      "width": Int(width),
      "height": Int(height),
    ]
    if let exif = properties[kCGImagePropertyExifDictionary] as? [CFString: Any] {
      // Parsed in Dart, the same way for both platforms
      if let date = (exif[kCGImagePropertyExifDateTimeOriginal] ?? exif[kCGImagePropertyExifDateTimeDigitized]) as? String {
        out["exifDate"] = date
      }
      if let offset = (exif[kCGImagePropertyExifOffsetTimeOriginal] ?? exif[kCGImagePropertyExifOffsetTimeDigitized]) as? String {
        out["exifOffset"] = offset
      }
    }
    if let gps = properties[kCGImagePropertyGPSDictionary] as? [CFString: Any],
      let latitude = gps[kCGImagePropertyGPSLatitude] as? Double,
      let longitude = gps[kCGImagePropertyGPSLongitude] as? Double
    {
      out["gpsLatitude"] = (gps[kCGImagePropertyGPSLatitudeRef] as? String) == "S" ? -latitude : latitude
      out["gpsLongitude"] = (gps[kCGImagePropertyGPSLongitudeRef] as? String) == "W" ? -longitude : longitude
    }
    return out
  }

  /// Scale so the SHORTEST edge is `edge` pixels, never enlarging.
  private static func jpeg(_ source: CGImageSource, width: Double, height: Double, edge: Double, quality: Double) -> Data? {
    let scale = min(1, edge / min(width, height))
    let w = max(1, (width * scale).rounded())
    let h = max(1, (height * scale).rounded())
    // ImageIO decodes straight to the size asked for and turns the image upright
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: max(w, h),
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }

    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    // JPEG has no alpha; without this, transparent areas would come out black
    format.opaque = true
    let size = CGSize(width: w, height: h)
    return UIGraphicsImageRenderer(size: size, format: format).jpegData(withCompressionQuality: quality) { context in
      UIColor.white.setFill()
      context.fill(CGRect(origin: .zero, size: size))
      UIImage(cgImage: image).draw(in: CGRect(origin: .zero, size: size))
    }
  }
}

/// Keeps one small secret per account behind Face ID or Touch ID.
///
/// The secret is a Keychain item that the Secure Enclave releases only after a
/// biometric match against the faces or fingers enrolled when it was stored:
/// adding one makes the item unreadable for good. The device passcode is never
/// accepted instead, and the item never leaves this device.
final class BiometricChannel {
  static let name = "kura/biometric"
  private static let service = "com.kuravault.app.biometric"

  func register(with messenger: FlutterBinaryMessenger) {
    FlutterMethodChannel(name: BiometricChannel.name, binaryMessenger: messenger)
      .setMethodCallHandler { [weak self] call, result in
        guard let self = self else { return }
        if call.method == "status" {
          result(self.status())
          return
        }
        guard let args = call.arguments as? [String: Any], let id = args["id"] as? String else {
          result(FlutterError(code: "invalid", message: "Missing arguments", details: nil))
          return
        }
        switch call.method {
        case "has":
          result(self.has(id))
        case "delete":
          self.delete(id)
          result(nil)
        case "store":
          guard
            let secret = args["secret"] as? FlutterStandardTypedData,
            let title = args["title"] as? String
          else {
            result(FlutterError(code: "invalid", message: "Missing arguments", details: nil))
            return
          }
          self.store(id, secret: secret.data, reason: title, result: result)
        case "read":
          guard let title = args["title"] as? String else {
            result(FlutterError(code: "invalid", message: "Missing arguments", details: nil))
            return
          }
          self.read(id, reason: title, result: result)
        default:
          result(FlutterMethodNotImplemented)
        }
      }
  }

  private func status() -> String {
    var error: NSError?
    if LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) {
      return "available"
    }
    return error?.code == LAError.biometryNotEnrolled.rawValue ? "notEnrolled" : "unsupported"
  }

  private func baseQuery(_ id: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: BiometricChannel.service,
      kSecAttrAccount as String: id,
    ]
  }

  /// Whether an item exists, without asking for a face or finger.
  private func has(_ id: String) -> Bool {
    var query = baseQuery(id)
    let context = LAContext()
    context.interactionNotAllowed = true
    query[kSecUseAuthenticationContext as String] = context
    let status = SecItemCopyMatching(query as CFDictionary, nil)
    return status == errSecSuccess || status == errSecInteractionNotAllowed
  }

  private func delete(_ id: String) {
    SecItemDelete(baseQuery(id) as CFDictionary)
  }

  private func store(_ id: String, secret: Data, reason: String, result: @escaping FlutterResult) {
    let context = LAContext()
    // No "Enter Passcode" button: the way out is the master passphrase
    context.localizedFallbackTitle = ""
    // Whoever switches this on proves they are enrolled, as they will have to later
    context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { ok, error in
      guard ok else {
        DispatchQueue.main.async { result(BiometricChannel.answer(for: error)) }
        return
      }
      self.delete(id)
      var failure: Unmanaged<CFError>?
      guard
        let access = SecAccessControlCreateWithFlags(
          nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, &failure)
      else {
        DispatchQueue.main.async {
          result(FlutterError(code: "failed", message: "Could not create a protected item", details: nil))
        }
        return
      }
      var query = self.baseQuery(id)
      query[kSecValueData as String] = secret
      query[kSecAttrAccessControl as String] = access
      let status = SecItemAdd(query as CFDictionary, nil)
      DispatchQueue.main.async {
        status == errSecSuccess
          ? result(true)
          : result(FlutterError(code: "failed", message: "Could not protect the key (\(status))", details: nil))
      }
    }
  }

  private func read(_ id: String, reason: String, result: @escaping FlutterResult) {
    let context = LAContext()
    context.localizedFallbackTitle = ""
    context.localizedReason = reason
    var query = baseQuery(id)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    query[kSecUseAuthenticationContext as String] = context
    // The Keychain call waits for the face or finger: not on the main thread
    DispatchQueue.global(qos: .userInitiated).async {
      var item: CFTypeRef?
      let status = SecItemCopyMatching(query as CFDictionary, &item)
      DispatchQueue.main.async {
        switch status {
        case errSecSuccess:
          if let data = item as? Data {
            result(FlutterStandardTypedData(bytes: data))
          } else {
            result(FlutterError(code: "failed", message: "Could not open the protected key", details: nil))
          }
        case errSecUserCanceled:
          result(nil)
        case errSecItemNotFound:
          // Faces or fingers changed since it was stored, or it was never there
          self.delete(id)
          result(FlutterError(code: "invalidated", message: "Face ID or Touch ID on this device changed", details: nil))
        case errSecAuthFailed:
          result(FlutterError(code: "lockout", message: "Too many attempts", details: nil))
        default:
          result(FlutterError(code: "failed", message: "Could not open the protected key (\(status))", details: nil))
        }
      }
    }
  }

  /// What a failed check means to the caller: nil for "the user backed out".
  private static func answer(for error: Error?) -> Any? {
    switch (error as? LAError)?.code {
    case .userCancel, .systemCancel, .appCancel, .userFallback:
      return nil
    case .biometryLockout:
      return FlutterError(code: "lockout", message: "Too many attempts", details: nil)
    case .biometryNotEnrolled, .biometryNotAvailable, .passcodeNotSet:
      return FlutterError(code: "unavailable", message: "Face ID or Touch ID is not set up on this device", details: nil)
    default:
      return FlutterError(code: "failed", message: "The check could not be completed", details: nil)
    }
  }
}
