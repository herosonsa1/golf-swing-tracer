package com.example.golfswingstudio

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Galaxy S24+ 등 최신 스마트폰에서 촬영된 HEVC(H.265) / HDR10+ (10-bit) / 세로(720x1280) 스윙 영상을
 * WebView 내부 <video> 디코더의 코덱·스트림 제약 없이 안드로이드 OS 네이티브 하드웨어 디코더(MediaMetadataRetriever)로
 * 직접 디코딩하여 8-bit SDR 프레임 시퀀스로 변환하는 디코더입니다.
 */
object NativeVideoDecoder {

    data class DecodedVideoPayload(
        val displayName: String,
        val durationSec: Double,
        val width: Int,
        val height: Int,
        val fps: Int,
        val frameUrls: List<String>
    ) {
        fun toJsonString(): String {
            val arr = JSONArray()
            frameUrls.forEach { arr.put(it) }
            return JSONObject().apply {
                put("displayName", displayName)
                put("duration", durationSec)
                put("width", width)
                put("height", height)
                put("fps", fps)
                put("frameCount", frameUrls.size)
                put("frameUrls", arr)
            }.toString()
        }
    }

    suspend fun decodeGalleryVideoToFrames(
        context: Context,
        uri: Uri,
        cachedVideoFile: File,
        displayName: String,
        onProgress: suspend (Int, Int, Int) -> Unit
    ): DecodedVideoPayload = withContext(Dispatchers.IO) {
        val framesDir = File(context.cacheDir, "decoded_frames")
        if (framesDir.exists()) {
            framesDir.listFiles()?.forEach { it.delete() }
        } else {
            framesDir.mkdirs()
        }

        val retriever = MediaMetadataRetriever()
        var fis: FileInputStream? = null

        try {
            // FileDescriptor 기반 랜덤 액세스를 최우선 연결 (moov atom이 파일 끝에 있는 갤럭시 촬영 MP4 완벽 지원)
            try {
                if (cachedVideoFile.exists() && cachedVideoFile.length() > 0L) {
                    fis = FileInputStream(cachedVideoFile)
                    retriever.setDataSource(fis.fd)
                } else {
                    retriever.setDataSource(context, uri)
                }
            } catch (_: Exception) {
                retriever.setDataSource(context, uri)
            }

            val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                ?.toLongOrNull()?.coerceAtLeast(300L) ?: 2500L
            val rawW = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)
                ?.toIntOrNull()?.coerceAtLeast(180) ?: 720
            val rawH = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)
                ?.toIntOrNull()?.coerceAtLeast(180) ?: 1280
            val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)
                ?.toIntOrNull() ?: 0

            val isRotatedPortrait = (rotation == 90 || rotation == 270)
            val orientedW = if (isRotatedPortrait) rawH else rawW
            val orientedH = if (isRotatedPortrait) rawW else rawH

            // OOM 방어를 위해 장축 최대 720px로 스케일링 (예: 720x1280 -> 406x720)
            val maxEdge = 720.0
            val scale = (maxEdge / max(orientedW, orientedH).toDouble()).coerceAtMost(1.0)
            var outW = ((orientedW * scale).roundToInt() / 2) * 2
            var outH = ((orientedH * scale).roundToInt() / 2) * 2
            outW = outW.coerceAtLeast(240)
            outH = outH.coerceAtLeast(240)

            val durationSec = (durationMs.toDouble() / 1000.0).coerceIn(0.4, 10.0)
            val targetFps = 24
            val totalSteps = (durationSec * targetFps).roundToInt().coerceIn(24, 150)

            val frameUrls = ArrayList<String>(totalSteps + 1)
            val batchTimestamp = System.currentTimeMillis()
            var lastValidFrameFile: File? = null

            for (step in 0..totalSteps) {
                val ratio = step.toDouble() / totalSteps.toDouble()
                // 마지막 프레임에서 EOS 초과로 null이 반환되지 않도록 durationMs - 30ms 이내로 클램핑
                val safeTimeMs = (ratio * (durationMs - 30L).coerceAtLeast(100L)).toLong()
                val timeUs = safeTimeMs * 1000L

                val rawFrame = extractSingleFrameSafely(retriever, timeUs, outW, outH)
                val frameFile = File(framesDir, "frame_$step.jpg")

                if (rawFrame != null) {
                    val sdrBitmap = ensureSdrSoftwareBitmap(rawFrame, outW, outH)
                    if (sdrBitmap !== rawFrame) {
                        rawFrame.recycle()
                    }
                    // 첫 유효 프레임의 실제 가로/세로 비율로 출력 해상도 확정
                    if (step == 0 && sdrBitmap.width > 0 && sdrBitmap.height > 0) {
                        outW = (sdrBitmap.width / 2) * 2
                        outH = (sdrBitmap.height / 2) * 2
                    }
                    FileOutputStream(frameFile).use { out ->
                        sdrBitmap.compress(Bitmap.CompressFormat.JPEG, 88, out)
                        out.flush()
                    }
                    sdrBitmap.recycle()
                    lastValidFrameFile = frameFile
                } else if (lastValidFrameFile != null && lastValidFrameFile.exists()) {
                    lastValidFrameFile.copyTo(frameFile, overwrite = true)
                }

                if (frameFile.exists() && frameFile.length() > 0L) {
                    frameUrls.add("https://appassets.androidplatform.net/native-frame/frame_$step.jpg?b=$batchTimestamp")
                }

                val pct = (((step + 1) * 100) / (totalSteps + 1)).coerceIn(1, 100)
                if (step % 3 == 0 || step == totalSteps) {
                    onProgress(pct, step + 1, totalSteps + 1)
                }
            }

            if (frameUrls.isEmpty()) {
                throw IllegalStateException("비디오 프레임을 추출할 수 없습니다.")
            }

            DecodedVideoPayload(
                displayName = displayName,
                durationSec = durationSec,
                width = outW,
                height = outH,
                fps = targetFps,
                frameUrls = frameUrls
            )
        } finally {
            try {
                retriever.release()
            } catch (_: Exception) {
            }
            try {
                fis?.close()
            } catch (_: Exception) {
            }
        }
    }

    private fun extractSingleFrameSafely(
        retriever: MediaMetadataRetriever,
        timeUs: Long,
        dstW: Int,
        dstH: Int
    ): Bitmap? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            try {
                val bmp = retriever.getScaledFrameAtTime(
                    timeUs,
                    MediaMetadataRetriever.OPTION_CLOSEST,
                    dstW,
                    dstH
                )
                if (bmp != null) return bmp
            } catch (_: Throwable) {
            }
            try {
                val bmp = retriever.getScaledFrameAtTime(
                    timeUs,
                    MediaMetadataRetriever.OPTION_CLOSEST_SYNC,
                    dstW,
                    dstH
                )
                if (bmp != null) return bmp
            } catch (_: Throwable) {
            }
        }
        try {
            val bmp = retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST)
            if (bmp != null) return bmp
        } catch (_: Throwable) {
        }
        return try {
            retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
        } catch (_: Throwable) {
            null
        }
    }

    /**
     * HDR10+ (10-bit RGBA_1010102 / RGBA_F16) 또는 HARDWARE Bitmap을
     * WebView 2D Canvas 호환 표준 8-bit ARGB_8888 소프트웨어 Bitmap으로 안전하게 변환합니다.
     */
    private fun ensureSdrSoftwareBitmap(src: Bitmap, targetW: Int, targetH: Int): Bitmap {
        val soft = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && src.config == Bitmap.Config.HARDWARE) {
            src.copy(Bitmap.Config.ARGB_8888, false) ?: src
        } else if (src.config != Bitmap.Config.ARGB_8888 && src.config != Bitmap.Config.RGB_565) {
            src.copy(Bitmap.Config.ARGB_8888, false) ?: src
        } else {
            src
        }

        // 세로/가로 방향에 맞춰 타깃 크기 조정
        val isSrcPortrait = soft.height > soft.width
        val isTargetPortrait = targetH > targetW
        val finalW = if (isSrcPortrait == isTargetPortrait) targetW else targetH
        val finalH = if (isSrcPortrait == isTargetPortrait) targetH else targetW

        return if (soft.width == finalW && soft.height == finalH) {
            soft
        } else {
            val scaled = Bitmap.createScaledBitmap(soft, finalW, finalH, true)
            if (scaled !== soft && soft !== src) {
                soft.recycle()
            }
            scaled
        }
    }
}
