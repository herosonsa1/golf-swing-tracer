package com.example.golfswingstudio

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * 캔버스에서 렌더링된 프레임들을 안드로이드 내장 하드웨어 H.264(AVC) 인코더(MediaCodec + MediaMuxer)를 사용해
 * 표준 .mp4 동영상으로 생성하고 MediaStore(Movies/GolfSwingStudio)에 즉시 등록하는 유틸리티입니다.
 * 대용량 비트맵 디코딩 시 inSampleSize 및 RGB_565 옵션을 적용해 OOM을 방어(AP-ANDROID-MLKIT-HIGHRES-OOM)합니다.
 */
class NativeMp4Exporter(private val context: Context) {

    private var encoder: MediaCodec? = null
    private var muxer: MediaMuxer? = null
    private var trackIndex: Int = -1
    private var muxerStarted: Boolean = false
    private var outputFile: File? = null
    private var targetFileName: String = "golf-swing-clip.mp4"
    private var width: Int = 1280
    private var height: Int = 720
    private var fps: Int = 30

    @Synchronized
    fun begin(rawWidth: Int, rawHeight: Int, targetFps: Int, fileName: String): Boolean {
        releaseQuietly()
        return try {
            // H.264 하드웨어 코덱 호환성을 위해 16배수 해상도 정렬
            width = ((rawWidth.coerceIn(320, 1280) + 15) / 16) * 16
            height = ((rawHeight.coerceIn(180, 720) + 15) / 16) * 16
            fps = targetFps.coerceIn(15, 60)
            targetFileName = if (fileName.endsWith(".mp4", true)) fileName else "$fileName.mp4"

            val tempFile = File(context.cacheDir, "latest_exported_clip.mp4")
            if (tempFile.exists()) tempFile.delete()
            outputFile = tempFile

            val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
                setInteger(
                    MediaFormat.KEY_COLOR_FORMAT,
                    MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible
                )
                setInteger(MediaFormat.KEY_BIT_RATE, 5_500_000)
                setInteger(MediaFormat.KEY_FRAME_RATE, fps)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            }

            val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            codec.start()
            encoder = codec

            muxer = MediaMuxer(tempFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            trackIndex = -1
            muxerStarted = false
            true
        } catch (_: Exception) {
            releaseQuietly()
            false
        }
    }

    @Synchronized
    fun encodeFrame(jpegDataUrl: String, frameIndex: Int): Boolean {
        val codec = encoder ?: return false
        return try {
            val cleanBase64 = jpegDataUrl.substringAfter("base64,", jpegDataUrl)
            val jpegBytes = Base64.decode(cleanBase64, Base64.DEFAULT)

            // OOM 방어를 위한 inSampleSize 및 RGB_565 디코딩 (AP-ANDROID-MLKIT-HIGHRES-OOM 준수)
            val boundsOpts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.size, boundsOpts)
            var sampleSize = 1
            while (boundsOpts.outWidth / sampleSize > width * 2 || boundsOpts.outHeight / sampleSize > height * 2) {
                sampleSize *= 2
            }

            val decodeOpts = BitmapFactory.Options().apply {
                inSampleSize = sampleSize
                inPreferredConfig = Bitmap.Config.RGB_565
            }
            val decoded = BitmapFactory.decodeByteArray(jpegBytes, 0, jpegBytes.size, decodeOpts) ?: return false
            val scaled = if (decoded.width == width && decoded.height == height) {
                decoded
            } else {
                val s = Bitmap.createScaledBitmap(decoded, width, height, true)
                if (s !== decoded) decoded.recycle()
                s
            }

            val inputIndex = codec.dequeueInputBuffer(15_000)
            if (inputIndex >= 0) {
                val inputImage = codec.getInputImage(inputIndex)
                if (inputImage != null) {
                    fillYuv420ImageFromBitmap(inputImage, scaled)
                    val ptsUs = (frameIndex.toLong() * 1_000_000L) / fps.toLong()
                    codec.queueInputBuffer(
                        inputIndex,
                        0,
                        width * height * 3 / 2,
                        ptsUs,
                        0
                    )
                } else {
                    val inputBuf = codec.getInputBuffer(inputIndex)
                    inputBuf?.clear()
                    val nv12 = bitmapToNv12(scaled)
                    inputBuf?.put(nv12)
                    val ptsUs = (frameIndex.toLong() * 1_000_000L) / fps.toLong()
                    codec.queueInputBuffer(inputIndex, 0, nv12.size, ptsUs, 0)
                }
            }
            scaled.recycle()
            drainEncoder(false)
            true
        } catch (_: Exception) {
            false
        }
    }

    suspend fun finishAndSaveToGallery(): Pair<String, String>? = withContext(Dispatchers.IO) {
        synchronized(this@NativeMp4Exporter) {
            val codec = encoder ?: return@withContext null
            try {
                val inputIndex = codec.dequeueInputBuffer(15_000)
                if (inputIndex >= 0) {
                    codec.queueInputBuffer(
                        inputIndex,
                        0,
                        0,
                        0L,
                        MediaCodec.BUFFER_FLAG_END_OF_STREAM
                    )
                }
                drainEncoder(true)
            } catch (_: Exception) {
                // EOS 처리 중 예외 무시
            } finally {
                releaseQuietly()
            }
        }

        val outFile = outputFile ?: return@withContext null
        if (!outFile.exists() || outFile.length() <= 0L) return@withContext null

        val galleryPath = MediaStoreHelper.saveVideoFileToGallery(
            context = context,
            sourceFile = outFile,
            fileName = targetFileName,
            mimeType = "video/mp4"
        )
        val previewUrl = "https://appassets.androidplatform.net/local-video/latest_exported_clip.mp4?t=${System.currentTimeMillis()}"
        Pair(previewUrl, galleryPath)
    }

    private fun drainEncoder(endOfStream: Boolean) {
        val codec = encoder ?: return
        val mediaMuxer = muxer ?: return
        val bufferInfo = MediaCodec.BufferInfo()
        var loops = 0

        while (loops < 60) {
            loops++
            val outIndex = codec.dequeueOutputBuffer(bufferInfo, if (endOfStream) 10_000L else 0L)
            if (outIndex == MediaCodec.INFO_TRY_AGAIN_LATER) {
                if (!endOfStream) break
            } else if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                if (!muxerStarted) {
                    trackIndex = mediaMuxer.addTrack(codec.outputFormat)
                    mediaMuxer.start()
                    muxerStarted = true
                }
            } else if (outIndex >= 0) {
                val encodedData = codec.getOutputBuffer(outIndex)
                if (encodedData != null && bufferInfo.size > 0 && muxerStarted &&
                    (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0
                ) {
                    encodedData.position(bufferInfo.offset)
                    encodedData.limit(bufferInfo.offset + bufferInfo.size)
                    mediaMuxer.writeSampleData(trackIndex, encodedData, bufferInfo)
                }
                codec.releaseOutputBuffer(outIndex, false)
                if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                    break
                }
            }
        }
    }

    private fun fillYuv420ImageFromBitmap(image: android.media.Image, bitmap: Bitmap) {
        val w = bitmap.width
        val h = bitmap.height
        val argb = IntArray(w * h)
        bitmap.getPixels(argb, 0, w, 0, 0, w, h)

        val yPlane = image.planes[0]
        val uPlane = image.planes[1]
        val vPlane = image.planes[2]

        val yBuffer = yPlane.buffer
        val uBuffer = uPlane.buffer
        val vBuffer = vPlane.buffer

        val yRowStride = yPlane.rowStride
        val yPixelStride = yPlane.pixelStride
        val uvRowStride = uPlane.rowStride
        val uvPixelStride = uPlane.pixelStride

        for (j in 0 until h) {
            val yRowOffset = j * yRowStride
            val uvRowOffset = (j shr 1) * uvRowStride
            val argbRowOffset = j * w
            for (i in 0 until w) {
                val c = argb[argbRowOffset + i]
                val r = (c shr 16) and 0xFF
                val g = (c shr 8) and 0xFF
                val b = c and 0xFF

                val y = (((66 * r + 129 * g + 25 * b + 128) shr 8) + 16).coerceIn(0, 255)
                yBuffer.put(yRowOffset + i * yPixelStride, y.toByte())

                if ((j and 1) == 0 && (i and 1) == 0) {
                    val u = (((-38 * r - 74 * g + 112 * b + 128) shr 8) + 128).coerceIn(0, 255)
                    val v = (((112 * r - 94 * g - 18 * b + 128) shr 8) + 128).coerceIn(0, 255)
                    val uvOffset = uvRowOffset + (i shr 1) * uvPixelStride
                    uBuffer.put(uvOffset, u.toByte())
                    vBuffer.put(uvOffset, v.toByte())
                }
            }
        }
    }

    private fun bitmapToNv12(bitmap: Bitmap): ByteArray {
        val w = bitmap.width
        val h = bitmap.height
        val argb = IntArray(w * h)
        bitmap.getPixels(argb, 0, w, 0, 0, w, h)
        val yuv = ByteArray(w * h * 3 / 2)
        var yIndex = 0
        var uvIndex = w * h

        for (j in 0 until h) {
            var idx = j * w
            for (i in 0 until w) {
                val c = argb[idx++]
                val r = (c shr 16) and 0xFF
                val g = (c shr 8) and 0xFF
                val b = c and 0xFF

                val y = (((66 * r + 129 * g + 25 * b + 128) shr 8) + 16).coerceIn(0, 255)
                yuv[yIndex++] = y.toByte()

                if ((j and 1) == 0 && (i and 1) == 0 && uvIndex + 1 < yuv.size) {
                    val u = (((-38 * r - 74 * g + 112 * b + 128) shr 8) + 128).coerceIn(0, 255)
                    val v = (((112 * r - 94 * g - 18 * b + 128) shr 8) + 128).coerceIn(0, 255)
                    yuv[uvIndex++] = u.toByte()
                    yuv[uvIndex++] = v.toByte()
                }
            }
        }
        return yuv
    }

    @Synchronized
    fun releaseQuietly() {
        try {
            encoder?.stop()
        } catch (_: Exception) {
        }
        try {
            encoder?.release()
        } catch (_: Exception) {
        }
        encoder = null

        try {
            if (muxerStarted) {
                muxer?.stop()
            }
        } catch (_: Exception) {
        }
        try {
            muxer?.release()
        } catch (_: Exception) {
        }
        muxer = null
        muxerStarted = false
        trackIndex = -1
    }
}
