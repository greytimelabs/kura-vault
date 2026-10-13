package com.kuravault.app

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.view.WindowManager
import androidx.exifinterface.media.ExifInterface
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlin.concurrent.thread
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Builds the two derived tiers of an upload from the original's bytes, and
 * reads when and where it was taken. Everything stays in memory; nothing is
 * written to disk. Sizes and quality match web/src/lib/media/imageProcessing.ts
 * so uploads look the same whichever client made them.
 */
class MediaChannel(private val activity: Activity) : MethodChannel.MethodCallHandler {
    companion object {
        const val NAME = "kura/media"
        private const val THUMB_EDGE = 200
        private const val THUMB_QUALITY = 80
        private const val PREVIEW_EDGE = 1080
        private const val PREVIEW_QUALITY = 85
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "process" -> {
                val bytes = call.argument<ByteArray>("bytes")
                if (bytes == null) {
                    result.error("invalid", "Missing arguments", null)
                    return
                }
                thread {
                    val outcome = runCatching { process(bytes) }
                    activity.runOnUiThread {
                        outcome.fold(
                            { result.success(it) },
                            // Out of memory on a huge image lands here too
                            { result.error("unsupported", "This image cannot be read", null) },
                        )
                    }
                }
            }
            "keepAwake" -> {
                // While uploads run, so the screen turning off does not pause them
                if (call.arguments == true) {
                    activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                } else {
                    activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    private fun process(bytes: ByteArray): Map<String, Any?> {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IllegalArgumentException("Not an image")

        val exif = runCatching { ExifInterface(ByteArrayInputStream(bytes)) }.getOrNull()
        val orientation = exif?.getAttributeInt(
            ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL,
        ) ?: ExifInterface.ORIENTATION_NORMAL
        val swapsAxes = orientation in setOf(
            ExifInterface.ORIENTATION_ROTATE_90, ExifInterface.ORIENTATION_ROTATE_270,
            ExifInterface.ORIENTATION_TRANSPOSE, ExifInterface.ORIENTATION_TRANSVERSE,
        )
        // As it should be looked at, which is how the web client reports it
        val width = if (swapsAxes) bounds.outHeight else bounds.outWidth
        val height = if (swapsAxes) bounds.outWidth else bounds.outHeight

        // Decode no larger than the preview needs: a 100-megapixel photo at full
        // size would not fit in memory
        var sample = 1
        while (min(bounds.outWidth, bounds.outHeight) / (sample * 2) >= PREVIEW_EDGE) sample *= 2
        val decoded = BitmapFactory.decodeByteArray(
            bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample },
        ) ?: throw IllegalArgumentException("Cannot decode")

        val upright = upright(decoded, orientation)
        if (upright !== decoded) decoded.recycle()
        try {
            return mapOf(
                "thumb" to jpeg(upright, width, height, THUMB_EDGE, THUMB_QUALITY),
                "preview" to jpeg(upright, width, height, PREVIEW_EDGE, PREVIEW_QUALITY),
                "width" to width,
                "height" to height,
                // Parsed in Dart, the same way for both platforms
                "exifDate" to (exif?.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL)
                    ?: exif?.getAttribute(ExifInterface.TAG_DATETIME_DIGITIZED)),
                "exifOffset" to (exif?.getAttribute(ExifInterface.TAG_OFFSET_TIME_ORIGINAL)
                    ?: exif?.getAttribute(ExifInterface.TAG_OFFSET_TIME_DIGITIZED)),
                "gpsLatitude" to exif?.latLong?.getOrNull(0),
                "gpsLongitude" to exif?.latLong?.getOrNull(1),
            )
        } finally {
            upright.recycle()
        }
    }

    private fun upright(bitmap: Bitmap, orientation: Int): Bitmap {
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.setRotate(90f); matrix.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.setRotate(270f); matrix.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(270f)
            else -> return bitmap
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }

    /**
     * Scale so the SHORTEST edge is [edge] pixels, never enlarging. The target
     * size comes from the original's dimensions, not from the sampled bitmap's.
     */
    private fun jpeg(source: Bitmap, width: Int, height: Int, edge: Int, quality: Int): ByteArray {
        val scale = min(1.0, edge.toDouble() / min(width, height))
        val w = max(1, (width * scale).roundToInt())
        val h = max(1, (height * scale).roundToInt())
        val canvasBitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        try {
            val canvas = Canvas(canvasBitmap)
            // JPEG has no alpha; without this, transparent areas would come out black
            canvas.drawColor(Color.WHITE)
            val scaled = Bitmap.createScaledBitmap(source, w, h, true)
            canvas.drawBitmap(scaled, 0f, 0f, null)
            if (scaled !== source) scaled.recycle()
            val out = ByteArrayOutputStream()
            if (!canvasBitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)) {
                throw IllegalStateException("Could not encode image")
            }
            return out.toByteArray()
        } finally {
            canvasBitmap.recycle()
        }
    }
}
