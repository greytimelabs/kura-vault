package com.kuravault.app

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

// A fragment activity: the system's fingerprint and face prompt needs one
class MainActivity : FlutterFragmentActivity() {
    private lateinit var saveChannel: SaveChannel

    override fun onCreate(savedInstanceState: Bundle?) {
        // No screenshots, no screen recording, and a blank card in the recent
        // apps list: decrypted photos and passphrase fields never leave the app
        // as pixels. Set before the first frame so nothing is captured early.
        window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE,
        )
        super.onCreate(savedInstanceState)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val messenger = flutterEngine.dartExecutor.binaryMessenger
        saveChannel = SaveChannel(this)
        MethodChannel(messenger, SaveChannel.NAME).setMethodCallHandler(saveChannel)
        MethodChannel(messenger, MediaChannel.NAME).setMethodCallHandler(MediaChannel(this))
        MethodChannel(messenger, BiometricChannel.NAME).setMethodCallHandler(BiometricChannel(this))
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        // Anything that is not ours belongs to a plugin
        if (!saveChannel.onActivityResult(requestCode, resultCode, data)) {
            super.onActivityResult(requestCode, resultCode, data)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        if (!saveChannel.onRequestPermissionsResult(requestCode, grantResults)) {
            super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        }
    }
}
