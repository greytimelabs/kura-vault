import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  /// One cover per window, shown while its scene is not active.
  private var privacyCovers: [ObjectIdentifier: UIView] = [:]
  private let saveChannel = SaveChannel()
  private let mediaChannel = MediaChannel()
  private let biometricChannel = BiometricChannel()

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    observeSceneActivity()
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    saveChannel.register(with: engineBridge.applicationRegistrar.messenger())
    mediaChannel.register(with: engineBridge.applicationRegistrar.messenger())
    biometricChannel.register(with: engineBridge.applicationRegistrar.messenger())
  }

  /// Cover every window while the app is not active, so the snapshot iOS takes
  /// for the app switcher never shows a photo or a passphrase field. Listening
  /// for the notifications leaves Flutter's own scene delegate untouched.
  private func observeSceneActivity() {
    let center = NotificationCenter.default
    center.addObserver(
      forName: UIScene.willDeactivateNotification, object: nil, queue: .main
    ) { [weak self] note in
      guard let scene = note.object as? UIWindowScene else { return }
      for window in scene.windows { self?.cover(window) }
    }
    center.addObserver(
      forName: UIScene.didActivateNotification, object: nil, queue: .main
    ) { [weak self] note in
      guard let scene = note.object as? UIWindowScene else { return }
      for window in scene.windows { self?.uncover(window) }
    }
  }

  private func cover(_ window: UIWindow) {
    let id = ObjectIdentifier(window)
    guard privacyCovers[id] == nil else { return }
    let view = UIView(frame: window.bounds)
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.backgroundColor = .systemBackground
    window.addSubview(view)
    privacyCovers[id] = view
  }

  private func uncover(_ window: UIWindow) {
    privacyCovers.removeValue(forKey: ObjectIdentifier(window))?.removeFromSuperview()
  }
}
