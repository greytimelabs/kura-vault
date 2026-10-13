package com.kuravault.app

import android.Manifest
import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File
import kotlin.concurrent.thread

/**
 * Hands a decrypted file to the device: into the photo gallery, or wherever the
 * user points the system's save dialog. The bytes are written straight to the
 * destination; no plaintext copy is left in this app's storage.
 */
class SaveChannel(private val activity: Activity) : MethodChannel.MethodCallHandler {
    companion object {
        const val NAME = "kura/save"
        private const val REQUEST_CREATE_DOCUMENT = 4101
        private const val REQUEST_STORAGE_PERMISSION = 4102
        private const val ALBUM = "Kura Vault"
    }

    private class Pending(
        val bytes: ByteArray,
        val name: String,
        val mimeType: String,
        val result: MethodChannel.Result,
    )

    /** The one save waiting on a system dialog. */
    private var pending: Pending? = null

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        val bytes = call.argument<ByteArray>("bytes")
        val name = call.argument<String>("name")
        val mimeType = call.argument<String>("mimeType")
        if (bytes == null || name == null || mimeType == null) {
            result.error("invalid", "Missing arguments", null)
            return
        }
        if (pending != null) {
            result.error("busy", "Another save is in progress", null)
            return
        }
        // Only a file name: a stored name must never steer where the file lands
        val request = Pending(bytes, File(name).name.ifBlank { "photo.jpg" }, mimeType, result)
        when (call.method) {
            "gallery" -> saveToGallery(request)
            "files" -> askWhereToSave(request)
            else -> result.notImplemented()
        }
    }

    private fun saveToGallery(request: Pending) {
        // Android 10+ lets an app add its own media without any permission
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            pending = request
            activity.requestPermissions(
                arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE),
                REQUEST_STORAGE_PERMISSION,
            )
            return
        }
        inBackground(request) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                writeToMediaStore(request)
            } else {
                writeToPictures(request)
            }
        }
    }

    private fun writeToMediaStore(request: Pending) {
        val resolver = activity.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, request.name)
            put(MediaStore.Images.Media.MIME_TYPE, galleryMimeType(request.mimeType))
            put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/$ALBUM")
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val uri = resolver.insert(collection, values) ?: throw IllegalStateException("No gallery")
        try {
            write(uri, request.bytes)
            values.clear()
            values.put(MediaStore.Images.Media.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } catch (e: Exception) {
            // Never leave half a photo behind
            resolver.delete(uri, null, null)
            throw e
        }
    }

    /** Android 7 to 9: a plain file in Pictures, then tell the gallery about it. */
    @Suppress("DEPRECATION")
    private fun writeToPictures(request: Pending) {
        val pictures = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)
        val folder = File(pictures, ALBUM).apply { mkdirs() }
        var file = File(folder, request.name)
        var n = 1
        while (file.exists()) {
            val base = request.name.substringBeforeLast('.', request.name)
            val extension = request.name.substringAfterLast('.', "")
            file = File(folder, if (extension.isEmpty()) "$base ($n)" else "$base ($n).$extension")
            n++
        }
        try {
            file.writeBytes(request.bytes)
        } catch (e: Exception) {
            file.delete()
            throw e
        }
        MediaScannerConnection.scanFile(activity, arrayOf(file.path), null, null)
    }

    /** The gallery only takes image types; an unknown one is filed by its extension. */
    private fun galleryMimeType(mimeType: String): String =
        if (mimeType.startsWith("image/")) mimeType else "image/jpeg"

    private fun askWhereToSave(request: Pending) {
        pending = request
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = request.mimeType
            putExtra(Intent.EXTRA_TITLE, request.name)
        }
        try {
            activity.startActivityForResult(intent, REQUEST_CREATE_DOCUMENT)
        } catch (e: Exception) {
            pending = null
            request.result.error("failed", "No app can save files", null)
        }
    }

    /** True when the result was for a save started here. */
    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        if (requestCode != REQUEST_CREATE_DOCUMENT) return false
        val request = pending ?: return true
        pending = null
        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) {
            request.result.success(false)
            return true
        }
        inBackground(request, value = true) {
            try {
                write(uri, request.bytes)
            } catch (e: Exception) {
                // The dialog already created the empty file: do not leave it
                runCatching { android.provider.DocumentsContract.deleteDocument(activity.contentResolver, uri) }
                throw e
            }
        }
        return true
    }

    /** True when the answer was for a permission asked here. */
    fun onRequestPermissionsResult(requestCode: Int, grantResults: IntArray): Boolean {
        if (requestCode != REQUEST_STORAGE_PERMISSION) return false
        val request = pending ?: return true
        pending = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            saveToGallery(request)
        } else {
            request.result.error("denied", "Storage permission was refused", null)
        }
        return true
    }

    private fun write(uri: Uri, bytes: ByteArray) {
        val stream = activity.contentResolver.openOutputStream(uri)
            ?: throw IllegalStateException("Cannot open destination")
        stream.use { it.write(bytes) }
    }

    /** Run [work] off the main thread and answer on it. Error text never includes the file's name. */
    private fun inBackground(request: Pending, value: Any? = null, work: () -> Unit) {
        thread {
            val error = runCatching(work).exceptionOrNull()
            activity.runOnUiThread {
                if (error == null) request.result.success(value)
                else request.result.error("failed", "Could not save the file", null)
            }
        }
    }
}
