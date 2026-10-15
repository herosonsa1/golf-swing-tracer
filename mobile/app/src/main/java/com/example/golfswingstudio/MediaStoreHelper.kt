package com.example.golfswingstudio

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

/**
 * 안드로이드 로컬 갤러리 비디오 스트림 복사 및
 * 스냅샷(PNG) / 구간 동영상(MP4/WebM) 무다운로드 즉시 저장 헬퍼.
 * 모든 파일 및 미디어 I/O는 Dispatchers.IO에서 수행하여 메인 UI 스레드 블로킹을 원천 차단합니다.
 */
object MediaStoreHelper {

    /**
     * 사용자가 로컬 갤러리에서 선택한 스윙 동영상(content:// URI)을
     * WebView 고속 Range 스트리밍용 앱 캐시 파일로 복사하고 원본 파일명을 반환합니다.
     */
    suspend fun copyGalleryVideoToCache(
        context: Context,
        uri: Uri,
        targetFile: File
    ): String = withContext(Dispatchers.IO) {
        var displayName = "gallery_swing_video.mp4"
        try {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) {
                        val name = cursor.getString(idx)
                        if (!name.isNullOrBlank()) {
                            displayName = name
                        }
                    }
                }
            }
        } catch (_: Exception) {
            // 파일명 조회 실패 시 기본 이름 유지
        }

        context.contentResolver.openInputStream(uri)?.use { input ->
            FileOutputStream(targetFile).use { output ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read <= 0) break
                    output.write(buffer, 0, read)
                }
                output.flush()
            }
        } ?: throw IllegalStateException("갤러리 동영상 스트림을 열 수 없습니다.")

        displayName
    }

    /**
     * 캔버스에서 생성된 PNG DataURL을 브라우저 다운로드 없이
     * 스마트폰 갤러리(Pictures/GolfSwingStudio)에 즉시 저장합니다.
     */
    suspend fun savePngSnapshotToGallery(
        context: Context,
        dataUrl: String,
        fileName: String
    ): String = withContext(Dispatchers.IO) {
        val cleanBase64 = dataUrl.substringAfter("base64,", dataUrl)
        val bytes = Base64.decode(cleanBase64, Base64.DEFAULT)
        val safeName = if (fileName.endsWith(".png", ignoreCase = true)) fileName else "$fileName.png"

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, safeName)
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/GolfSwingStudio")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
            val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            val itemUri = resolver.insert(collection, values)
                ?: throw IllegalStateException("MediaStore 이미지 항목을 생성할 수 없습니다.")

            resolver.openOutputStream(itemUri)?.use { out ->
                out.write(bytes)
                out.flush()
            }

            val completeValues = ContentValues().apply {
                put(MediaStore.Images.Media.IS_PENDING, 0)
            }
            resolver.update(itemUri, completeValues, null, null)
        } else {
            @Suppress("DEPRECATION")
            val dir = File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
                "GolfSwingStudio"
            )
            if (!dir.exists()) dir.mkdirs()
            val outFile = File(dir, safeName)
            FileOutputStream(outFile).use { out ->
                out.write(bytes)
                out.flush()
            }
            MediaScannerConnection.scanFile(
                context,
                arrayOf(outFile.absolutePath),
                arrayOf("image/png"),
                null
            )
        }

        "Pictures/GolfSwingStudio/$safeName"
    }

    /**
     * 렌더링된 스윙 구간 동영상 파일을 브라우저 다운로드 없이
     * 스마트폰 갤러리(Movies/GolfSwingStudio)에 즉시 저장합니다.
     */
    suspend fun saveVideoFileToGallery(
        context: Context,
        sourceFile: File,
        fileName: String,
        mimeType: String = "video/mp4"
    ): String = withContext(Dispatchers.IO) {
        val ext = if (mimeType.contains("webm", ignoreCase = true)) ".webm" else ".mp4"
        val safeName = if (fileName.endsWith(".mp4", true) || fileName.endsWith(".webm", true)) {
            fileName
        } else {
            "$fileName$ext"
        }
        val resolvedMime = if (safeName.endsWith(".webm", true)) "video/webm" else "video/mp4"

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Video.Media.DISPLAY_NAME, safeName)
                put(MediaStore.Video.Media.MIME_TYPE, resolvedMime)
                put(MediaStore.Video.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MOVIES}/GolfSwingStudio")
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }
            val collection = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            val itemUri = resolver.insert(collection, values)
                ?: throw IllegalStateException("MediaStore 동영상 항목을 생성할 수 없습니다.")

            resolver.openOutputStream(itemUri)?.use { out ->
                FileInputStream(sourceFile).use { input ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        out.write(buffer, 0, read)
                    }
                    out.flush()
                }
            }

            val completeValues = ContentValues().apply {
                put(MediaStore.Video.Media.IS_PENDING, 0)
            }
            resolver.update(itemUri, completeValues, null, null)
        } else {
            @Suppress("DEPRECATION")
            val dir = File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES),
                "GolfSwingStudio"
            )
            if (!dir.exists()) dir.mkdirs()
            val outFile = File(dir, safeName)
            FileInputStream(sourceFile).use { input ->
                FileOutputStream(outFile).use { out ->
                    input.copyTo(out)
                }
            }
            MediaScannerConnection.scanFile(
                context,
                arrayOf(outFile.absolutePath),
                arrayOf(resolvedMime),
                null
            )
        }

        "Movies/GolfSwingStudio/$safeName"
    }
}
