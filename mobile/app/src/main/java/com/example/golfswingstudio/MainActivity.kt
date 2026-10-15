package com.example.golfswingstudio

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.util.Base64
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

class MainActivity : ComponentActivity() {

    private var webViewRef: WebView? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var nativeMp4Exporter: NativeMp4Exporter? = null

    private var pendingChunkFile: File? = null
    private var pendingChunkStream: FileOutputStream? = null
    private var pendingVideoFileName: String = "golf-swing-clip.mp4"
    private var pendingVideoMimeType: String = "video/mp4"

    // 1) 안드로이드 포토/갤러리 피커 (PickVisualMedia VideoOnly)
    private val pickGalleryVideoLauncher = registerForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri: Uri? ->
        if (uri != null) {
            filePathCallback?.onReceiveValue(arrayOf(uri))
            filePathCallback = null
            handlePickedGalleryVideo(uri)
        } else {
            filePathCallback?.onReceiveValue(null)
            filePathCallback = null
        }
    }

    // 2) 구형 기기 호환 갤러리 인텐트 런처 (ACTION_PICK fallback)
    private val legacyGalleryIntentLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val uri = result.data?.data
        if (result.resultCode == RESULT_OK && uri != null) {
            filePathCallback?.onReceiveValue(arrayOf(uri))
            filePathCallback = null
            handlePickedGalleryVideo(uri)
        } else {
            filePathCallback?.onReceiveValue(null)
            filePathCallback = null
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        enableEdgeToEdge()
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = true
            isAppearanceLightNavigationBars = true
        }

        nativeMp4Exporter = NativeMp4Exporter(applicationContext)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val wv = webViewRef
                if (wv != null) {
                    wv.evaluateJavascript(
                        "(function(){const m=document.getElementById('snapshotModal');if(m&&m.open){m.close();return true;}return false;})()"
                    ) { res ->
                        if (res != "true") {
                            if (wv.canGoBack()) wv.goBack() else finish()
                        }
                    }
                } else {
                    finish()
                }
            }
        })

        setContent {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.White)
                    .systemBarsPadding()
            ) {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { ctx ->
                        createStudioWebView(ctx).also { webViewRef = it }
                    }
                )
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createStudioWebView(context: android.content.Context): WebView {
        return WebView(context).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(android.graphics.Color.WHITE)

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = true
                allowContentAccess = true
                loadWithOverviewMode = true
                useWideViewPort = true
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                cacheMode = WebSettings.LOAD_DEFAULT
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            }

            addJavascriptInterface(AndroidNativeBridge(), "AndroidNativeBridge")

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? {
                    return LocalWebAssetServer.intercept(context.applicationContext, request)
                        ?: super.shouldInterceptRequest(view, request)
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {
                    this@MainActivity.filePathCallback?.onReceiveValue(null)
                    this@MainActivity.filePathCallback = filePathCallback
                    launchNativeGalleryVideoPicker()
                    return true
                }
            }

            loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
        }
    }

    private fun launchNativeGalleryVideoPicker() {
        try {
            pickGalleryVideoLauncher.launch(
                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly)
            )
        } catch (_: Exception) {
            try {
                val pickIntent = Intent(Intent.ACTION_PICK, MediaStore.Video.Media.EXTERNAL_CONTENT_URI).apply {
                    type = "video/*"
                }
                legacyGalleryIntentLauncher.launch(pickIntent)
            } catch (e: Exception) {
                Toast.makeText(this, "갤러리 앱을 열 수 없습니다: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }

    /**
     * 갤러리에서 선택된 동영상 URI를 Dispatchers.IO 백그라운드 스레드에서
     * 로컬 Range 스트리밍 캐시로 복사한 후 WebView 스윙 분석 엔진으로 전달합니다.
     */
    private fun handlePickedGalleryVideo(uri: Uri) {
        lifecycleScope.launch(Dispatchers.IO) {
            try {
                val targetFile = File(cacheDir, "picked_swing_video.mp4")
                val displayName = MediaStoreHelper.copyGalleryVideoToCache(
                    context = applicationContext,
                    uri = uri,
                    targetFile = targetFile
                )
                val streamUrl = "https://appassets.androidplatform.net/local-video/picked_swing_video.mp4?t=${System.currentTimeMillis()}"

                withContext(Dispatchers.Main) {
                    Toast.makeText(
                        this@MainActivity,
                        "갤러리 스윙 영상 불러오기 완료: $displayName",
                        Toast.LENGTH_SHORT
                    ).show()
                    val safeUrl = JSONObject.quote(streamUrl)
                    val safeName = JSONObject.quote(displayName)
                    webViewRef?.evaluateJavascript(
                        "window.onAndroidVideoPicked && window.onAndroidVideoPicked($safeUrl, $safeName);",
                        null
                    )
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    Toast.makeText(
                        this@MainActivity,
                        "갤러리 비디오 로드 실패: ${e.message}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }

    private fun notifyMediaSavedOnUi(mediaType: String, fileName: String, galleryPath: String) {
        val label = if (mediaType == "video") "동영상" else "스냅샷"
        Toast.makeText(
            this@MainActivity,
            "갤러리 즉시 저장 완료 ($label): $galleryPath",
            Toast.LENGTH_SHORT
        ).show()

        val qType = JSONObject.quote(mediaType)
        val qName = JSONObject.quote(fileName)
        val qPath = JSONObject.quote(galleryPath)
        webViewRef?.evaluateJavascript(
            "window.onAndroidMediaSaved && window.onAndroidMediaSaved($qType, $qName, $qPath);",
            null
        )
    }

    inner class AndroidNativeBridge {

        @JavascriptInterface
        fun pickVideoFromGallery() {
            runOnUiThread {
                launchNativeGalleryVideoPicker()
            }
        }

        @JavascriptInterface
        fun saveSnapshotToGallery(dataUrl: String, fileName: String) {
            lifecycleScope.launch(Dispatchers.IO) {
                try {
                    val savedPath = MediaStoreHelper.savePngSnapshotToGallery(
                        context = applicationContext,
                        dataUrl = dataUrl,
                        fileName = fileName
                    )
                    withContext(Dispatchers.Main) {
                        notifyMediaSavedOnUi("image", fileName, savedPath)
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(
                            this@MainActivity,
                            "스냅샷 갤러리 저장 오류: ${e.message}",
                            Toast.LENGTH_LONG
                        ).show()
                    }
                }
            }
        }

        @JavascriptInterface
        fun beginNativeMp4Export(width: Int, height: Int, fps: Int, fileName: String): Boolean {
            pendingVideoFileName = fileName
            return nativeMp4Exporter?.begin(width, height, fps, fileName) ?: false
        }

        @JavascriptInterface
        fun encodeNativeMp4Frame(jpegDataUrl: String, frameIndex: Int): Boolean {
            return nativeMp4Exporter?.encodeFrame(jpegDataUrl, frameIndex) ?: false
        }

        @JavascriptInterface
        fun finishNativeMp4Export(): String {
            val exporter = nativeMp4Exporter ?: return ""
            val fileName = pendingVideoFileName
            val previewUrl = "https://appassets.androidplatform.net/local-video/latest_exported_clip.mp4?t=${System.currentTimeMillis()}"
            lifecycleScope.launch(Dispatchers.IO) {
                try {
                    val resultPair = exporter.finishAndSaveToGallery()
                    if (resultPair != null) {
                        val (_, galleryPath) = resultPair
                        withContext(Dispatchers.Main) {
                            notifyMediaSavedOnUi("video", fileName, galleryPath)
                        }
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(
                            this@MainActivity,
                            "MP4 동영상 갤러리 저장 오류: ${e.message}",
                            Toast.LENGTH_LONG
                        ).show()
                    }
                }
            }
            return previewUrl
        }

        @JavascriptInterface
        fun beginVideoSave(fileName: String, mimeType: String) {
            try {
                pendingChunkStream?.close()
            } catch (_: Exception) {
            }
            pendingVideoFileName = fileName
            pendingVideoMimeType = mimeType
            val ext = if (mimeType.contains("webm", true)) "webm" else "mp4"
            val tempFile = File(cacheDir, "latest_exported_clip.$ext")
            if (tempFile.exists()) tempFile.delete()
            pendingChunkFile = tempFile
            pendingChunkStream = FileOutputStream(tempFile, true)
        }

        @JavascriptInterface
        fun appendVideoChunk(base64Chunk: String) {
            val stream = pendingChunkStream ?: return
            val bytes = Base64.decode(base64Chunk, Base64.DEFAULT)
            stream.write(bytes)
        }

        @JavascriptInterface
        fun finishVideoSave() {
            try {
                pendingChunkStream?.flush()
                pendingChunkStream?.close()
            } catch (_: Exception) {
            }
            pendingChunkStream = null

            val file = pendingChunkFile ?: return
            val fName = pendingVideoFileName
            val mime = pendingVideoMimeType

            lifecycleScope.launch(Dispatchers.IO) {
                try {
                    val savedPath = MediaStoreHelper.saveVideoFileToGallery(
                        context = applicationContext,
                        sourceFile = file,
                        fileName = fName,
                        mimeType = mime
                    )
                    withContext(Dispatchers.Main) {
                        notifyMediaSavedOnUi("video", fName, savedPath)
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(
                            this@MainActivity,
                            "동영상 갤러리 저장 오류: ${e.message}",
                            Toast.LENGTH_LONG
                        ).show()
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        nativeMp4Exporter?.releaseQuietly()
        webViewRef?.destroy()
        webViewRef = null
        super.onDestroy()
    }
}
