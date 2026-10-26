import UIKit
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var controller: ShellViewController?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let controller = ShellViewController()
        self.controller = controller
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = controller
        self.window = window
        window.makeKeyAndVisible()
        let incoming = connectionOptions.userActivities.compactMap(\.webpageURL).first
            ?? connectionOptions.urlContexts.map(\.url).first
        controller.loadShellURL(incoming ?? ShellURL.defaultURL)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        guard let url = userActivity.webpageURL else { return }
        controller?.loadShellURL(url)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url else { return }
        controller?.loadShellURL(url)
    }
}

