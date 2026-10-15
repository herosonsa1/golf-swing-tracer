package com.example.golfswingstudio

import android.content.Context
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import kotlin.math.min

/**
 * WebView에서 로컬 에셋(assets/www/)과 갤러리에서 선택된 비디오 파일(cacheDir)을
 * CORS 제약 없이 고속 로드하고, 비디오 탐색(Seek)을 위한 HTTP 206 Partial Content Range 요청을 처리합니다.
 */
object LocalWebAssetServer {

    private const val HOST = "appassets.androidplatform.net"

    fun intercept(context: Context, request: WebResourceRequest): WebResourceResponse? {
        val url = request.url ?: return null
        if (!url.host.equals(HOST, ignoreCase = true)) return null

        val path = url.path ?: return null
        return when {
            path.startsWith("/assets/www/") -> {
                val assetRelPath = path.removePrefix("/assets/").trimStart('/')
                serveAssetFile(context, assetRelPath)
            }
            path.startsWith("/local-video/") -> {
                val fileName = path.removePrefix("/local-video/").trimStart('/')
                val videoFile = File(context.cacheDir, fileName)
                serveLocalVideoWithRange(videoFile, request)
            }
            else -> null
        }
    }

    private fun serveAssetFile(context: Context, assetPath: String): WebResourceResponse? {
        return try {
            val stream = context.assets.open(assetPath)
            val mime = guessMimeType(assetPath)
            val headers = mapOf(
                "Access-Control-Allow-Origin" to "*",
                "Cache-Control" to "no-cache"
            )
            WebResourceResponse(mime, "UTF-8", 200, "OK", headers, stream)
        } catch (_: Exception) {
            null
        }
    }

    private fun serveLocalVideoWithRange(file: File, request: WebResourceRequest): WebResourceResponse? {
        if (!file.exists() || !file.isFile) return null
        val totalLen = file.length()
        val mime = guessMimeType(file.name)
        val rangeHeader = request.requestHeaders["Range"] ?: request.requestHeaders["range"]

        return try {
            if (!rangeHeader.isNullOrBlank() && rangeHeader.startsWith("bytes=")) {
                val spec = rangeHeader.removePrefix("bytes=").trim()
                val parts = spec.split("-")
                val start = parts.getOrNull(0)?.toLongOrNull()?.coerceAtLeast(0L) ?: 0L
                val requestedEnd = parts.getOrNull(1)?.takeIf { it.isNotBlank() }?.toLongOrNull()
                val end = (requestedEnd ?: (totalLen - 1L)).coerceAtMost(totalLen - 1L)

                if (start <= end && start < totalLen) {
                    val contentLength = (end - start) + 1L
                    val fis = FileInputStream(file)
                    if (start > 0L) {
                        fis.skip(start)
                    }
                    val boundedStream = BoundedInputStream(fis, contentLength)
                    val headers = mapOf(
                        "Access-Control-Allow-Origin" to "*",
                        "Accept-Ranges" to "bytes",
                        "Content-Range" to "bytes $start-$end/$totalLen",
                        "Content-Length" to contentLength.toString()
                    )
                    return WebResourceResponse(mime, null, 206, "Partial Content", headers, boundedStream)
                }
            }

            val fis = FileInputStream(file)
            val headers = mapOf(
                "Access-Control-Allow-Origin" to "*",
                "Accept-Ranges" to "bytes",
                "Content-Length" to totalLen.toString()
            )
            WebResourceResponse(mime, null, 200, "OK", headers, fis)
        } catch (_: Exception) {
            null
        }
    }

    private fun guessMimeType(path: String): String {
        val lower = path.lowercase()
        return when {
            lower.endsWith(".html") -> "text/html"
            lower.endsWith(".css") -> "text/css"
            lower.endsWith(".js") || lower.endsWith(".mjs") -> "text/javascript"
            lower.endsWith(".json") -> "application/json"
            lower.endsWith(".png") -> "image/png"
            lower.endsWith(".jpg") || lower.endsWith(".jpeg") -> "image/jpeg"
            lower.endsWith(".webp") -> "image/webp"
            lower.endsWith(".svg") -> "image/svg+xml"
            lower.endsWith(".mp4") || lower.endsWith(".m4v") -> "video/mp4"
            lower.endsWith(".webm") -> "video/webm"
            lower.endsWith(".mov") -> "video/quicktime"
            else -> "application/octet-stream"
        }
    }

    private class BoundedInputStream(
        private val delegate: InputStream,
        private var remaining: Long
    ) : InputStream() {
        override fun read(): Int {
            if (remaining <= 0L) return -1
            val b = delegate.read()
            if (b >= 0) remaining--
            return b
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (remaining <= 0L) return -1
            val toRead = min(len.toLong(), remaining).toInt()
            val count = delegate.read(b, off, toRead)
            if (count > 0) remaining -= count.toLong()
            return count
        }

        override fun close() {
            delegate.close()
        }
    }
}
