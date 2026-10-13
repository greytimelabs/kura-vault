package com.kuravault.app

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import android.util.Log
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Keeps one small secret per account behind the phone's fingerprint or face
 * check.
 *
 * The secret is encrypted with an AES key that lives in the Android Keystore
 * and that the hardware lets be used only right after a successful strong
 * biometric check: the prompt is bound to the key operation itself, so there
 * is no "if" in this app that a patched build could skip. The device PIN is
 * never accepted instead, and the key is destroyed by the system when a
 * fingerprint or face is added.
 */
class BiometricChannel(private val activity: FragmentActivity) : MethodChannel.MethodCallHandler {
    companion object {
        const val NAME = "kura/biometric"
        private const val KEYSTORE = "AndroidKeyStore"
        private const val PREFS = "kura_biometric"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_LENGTH = 12
        private const val TAG_BITS = 128
        private const val LOG = "KuraBiometric"
    }

    /** Why something failed, for the device log. Never includes key material. */
    private fun note(what: String, e: Exception) = Log.w(LOG, "$what: ${e.javaClass.simpleName}: ${e.message}")

    private val prefs get() = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun alias(id: String) = "kura.biometric.$id"

    /** One prompt at a time. */
    private var busy = false

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        if (call.method == "status") {
            result.success(status())
            return
        }
        val id = call.argument<String>("id")
        if (id == null) {
            result.error("invalid", "Missing arguments", null)
            return
        }
        when (call.method) {
            "has" -> result.success(prefs.contains(id))
            "delete" -> {
                delete(id)
                result.success(null)
            }
            "store" -> {
                val secret = call.argument<ByteArray>("secret")
                val title = call.argument<String>("title")
                if (secret == null || title == null) {
                    result.error("invalid", "Missing arguments", null)
                } else {
                    store(id, secret, title, result)
                }
            }
            "read" -> {
                val title = call.argument<String>("title")
                if (title == null) result.error("invalid", "Missing arguments", null) else read(id, title, result)
            }
            else -> result.notImplemented()
        }
    }

    private fun status(): String =
        when (BiometricManager.from(activity).canAuthenticate(BIOMETRIC_STRONG)) {
            BiometricManager.BIOMETRIC_SUCCESS -> "available"
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "notEnrolled"
            else -> "unsupported"
        }

    private fun delete(id: String) {
        prefs.edit().remove(id).apply()
        try {
            KeyStore.getInstance(KEYSTORE).apply { load(null) }.deleteEntry(alias(id))
        } catch (_: Exception) {
            // No key, nothing to delete
        }
    }

    private fun newKey(id: String): SecretKey {
        fun spec(strongBox: Boolean): KeyGenParameterSpec {
            val builder = KeyGenParameterSpec.Builder(
                alias(id),
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                // Usable only right after a biometric check, once per check
                .setUserAuthenticationRequired(true)
                // A new fingerprint or face destroys the key: whoever adds one
                // does not inherit the unlock
                .setInvalidatedByBiometricEnrollment(true)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
            }
            if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                builder.setIsStrongBoxBacked(true)
            }
            return builder.build()
        }

        fun generate(strongBox: Boolean): SecretKey =
            KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
                .apply { init(spec(strongBox)) }
                .generateKey()

        val hasStrongBox = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
            activity.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)
        if (hasStrongBox) {
            try {
                return generate(true)
            } catch (e: Exception) {
                // Announced but not usable for this kind of key: the ordinary
                // hardware keystore is still hardware
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P || e !is StrongBoxUnavailableException) throw e
            }
        }
        return generate(false)
    }

    private fun store(id: String, secret: ByteArray, title: String, result: MethodChannel.Result) {
        if (status() != "available") {
            secret.fill(0)
            result.error("unavailable", "No fingerprint or face is set up on this phone", null)
            return
        }
        val cipher: Cipher
        try {
            delete(id)
            cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, newKey(id)) }
        } catch (e: Exception) {
            note("creating the key", e)
            secret.fill(0)
            delete(id)
            result.error("failed", "Could not create a protected key", null)
            return
        }
        prompt(title, cipher, result, onCancel = { secret.fill(0); delete(id) }) { unlocked ->
            try {
                val sealed = unlocked.doFinal(secret)
                val blob = unlocked.iv + sealed
                prefs.edit().putString(id, Base64.encodeToString(blob, Base64.NO_WRAP)).apply()
                result.success(true)
            } catch (e: Exception) {
                note("sealing", e)
                delete(id)
                result.error("failed", "Could not protect the key", null)
            } finally {
                secret.fill(0)
            }
        }
    }

    private fun read(id: String, title: String, result: MethodChannel.Result) {
        val stored = prefs.getString(id, null)
        if (stored == null) {
            result.error("invalidated", "Nothing is stored for this account", null)
            return
        }
        val blob = Base64.decode(stored, Base64.NO_WRAP)
        val cipher: Cipher
        try {
            val key = KeyStore.getInstance(KEYSTORE).apply { load(null) }.getKey(alias(id), null) as SecretKey?
                ?: throw KeyPermanentlyInvalidatedException()
            cipher = Cipher.getInstance(TRANSFORMATION).apply {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, blob, 0, IV_LENGTH))
            }
        } catch (e: KeyPermanentlyInvalidatedException) {
            // Fingerprints or faces changed, or the screen lock was removed
            delete(id)
            result.error("invalidated", "Fingerprints or faces on this phone changed", null)
            return
        } catch (e: Exception) {
            note("preparing to open", e)
            result.error("failed", "Could not use the protected key", null)
            return
        }
        prompt(title, cipher, result, onCancel = {}) { unlocked ->
            try {
                result.success(unlocked.doFinal(blob, IV_LENGTH, blob.size - IV_LENGTH))
            } catch (e: Exception) {
                note("opening", e)
                result.error("failed", "Could not open the protected key", null)
            }
        }
    }

    /**
     * Ask for a fingerprint or face to release [cipher]. When the user backs
     * out, [onCancel] cleans up and the call is answered with null.
     */
    private fun prompt(
        title: String,
        cipher: Cipher,
        result: MethodChannel.Result,
        onCancel: () -> Unit,
        onUnlocked: (Cipher) -> Unit,
    ) {
        if (busy) {
            onCancel()
            result.error("busy", "Another check is in progress", null)
            return
        }
        busy = true
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(auth: BiometricPrompt.AuthenticationResult) {
                busy = false
                val unlocked = auth.cryptoObject?.cipher
                if (unlocked == null) {
                    onCancel()
                    result.error("failed", "The check did not release the key", null)
                } else {
                    onUnlocked(unlocked)
                }
            }

            override fun onAuthenticationError(code: Int, message: CharSequence) {
                busy = false
                onCancel()
                when (code) {
                    BiometricPrompt.ERROR_USER_CANCELED,
                    BiometricPrompt.ERROR_NEGATIVE_BUTTON,
                    BiometricPrompt.ERROR_CANCELED,
                    BiometricPrompt.ERROR_TIMEOUT -> result.success(null)
                    BiometricPrompt.ERROR_LOCKOUT,
                    BiometricPrompt.ERROR_LOCKOUT_PERMANENT ->
                        result.error("lockout", "Too many attempts", null)
                    else -> result.error("failed", "The check could not be completed", null)
                }
            }
            // A finger that did not match: the system prompt says so and waits
        }
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setNegativeButtonText("Use passphrase")
            .setAllowedAuthenticators(BIOMETRIC_STRONG)
            .setConfirmationRequired(false)
            .build()
        try {
            BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback)
                .authenticate(info, BiometricPrompt.CryptoObject(cipher))
        } catch (e: Exception) {
            note("starting the check", e)
            busy = false
            onCancel()
            result.error("failed", "The check could not be started", null)
        }
    }
}
