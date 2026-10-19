import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.TaskAction
import org.gradle.work.DisableCachingByDefault
import java.io.File
import java.util.Properties

plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.compose.compiler)
  alias(libs.plugins.kotlin.serialization)
}

val versionPropsFile = rootProject.file("version.properties")
val versionProps = Properties().apply {
  if (versionPropsFile.exists()) {
    versionPropsFile.inputStream().use { load(it) }
  }
}
val currentMajor = versionProps.getProperty("VERSION_MAJOR", "1").toIntOrNull() ?: 1
val currentMinor = versionProps.getProperty("VERSION_MINOR", "0").toIntOrNull() ?: 0
val currentCode = versionProps.getProperty("VERSION_CODE", "1").toIntOrNull() ?: 1

android {
    namespace = "com.example.golfswingstudio"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.example.golfswingstudio"
        minSdk = 26
        targetSdk = 36
        versionCode = currentCode + 1
        versionName = "$currentMajor.${currentMinor + 1}"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
      compose = true
      aidl = false
      buildConfig = false
      shaders = false
    }

    packaging {
      resources {
        excludes += "/META-INF/{AL2.0,LGPL2.1}"
      }
    }
}

kotlin {
    jvmToolchain(17)
}

@DisableCachingByDefault(because = "Always sync latest web studio assets before Android APK packaging")
abstract class SyncWebStudioAssetsTask : DefaultTask() {
    @get:Internal
    abstract val webRootDir: DirectoryProperty

    @get:Internal
    abstract val androidAssetsWwwDir: DirectoryProperty

    @TaskAction
    fun syncAssets() {
        val srcDir = webRootDir.get().asFile
        val dstDir = androidAssetsWwwDir.get().asFile
        if (!dstDir.exists()) dstDir.mkdirs()

        val targetFiles = listOf(
            "index.html",
            "styles.css",
            "app.js",
            "shot-tracer-engine.js",
            "renderer-exporter.js",
            "video-stabilizer.js",
            "project-archive.js",
            "swing-engine.js",
            "demo-generator.js",
            "favicon.ico",
            "app-icon.png"
        )
        for (name in targetFiles) {
            val f = File(srcDir, name)
            if (f.exists()) {
                f.copyTo(File(dstDir, name), overwrite = true)
            }
        }
    }
}

@DisableCachingByDefault(because = "Publish version-stamped 나만의골프스윙_vX.Y.apk to ./ root on every build while preserving previous builds")
abstract class PublishVersionedGolfSwingApkTask : DefaultTask() {
    @get:Internal
    abstract val apkSourceFile: RegularFileProperty

    @get:Internal
    abstract val versionFile: RegularFileProperty

    @get:Internal
    abstract val workspaceRootDir: DirectoryProperty

    @get:Internal
    abstract val mobileRootDir: DirectoryProperty

    private fun renameLegacyApksInDir(dir: File, appTitlePrefix: String) {
        if (!dir.exists()) return
        dir.listFiles()?.forEach { file ->
            if (file.isFile && file.name.startsWith("GolfSwing_v") && file.name.endsWith(".apk")) {
                val versionSuffix = file.name.removePrefix("GolfSwing_")
                val targetFile = File(dir, "${appTitlePrefix}_$versionSuffix")
                if (targetFile.exists()) {
                    file.delete()
                } else {
                    file.renameTo(targetFile)
                }
            }
        }
    }

    @TaskAction
    fun publishApk() {
        val src = apkSourceFile.get().asFile
        if (!src.exists()) {
            logger.warn("APK source file not found: ${src.absolutePath}")
            return
        }

        val appTitlePrefix = "나만의골프스윙"
        val wsDir = workspaceRootDir.get().asFile
        val mbDir = mobileRootDir.get().asFile

        renameLegacyApksInDir(wsDir, appTitlePrefix)
        renameLegacyApksInDir(mbDir, appTitlePrefix)

        val vf = versionFile.get().asFile
        val props = Properties()
        if (vf.exists()) {
            vf.inputStream().use { props.load(it) }
        }
        val major = props.getProperty("VERSION_MAJOR", "1").toIntOrNull() ?: 1
        val nextMinor = (props.getProperty("VERSION_MINOR", "0").toIntOrNull() ?: 0) + 1
        val nextCode = (props.getProperty("VERSION_CODE", "1").toIntOrNull() ?: 1) + 1

        props.setProperty("VERSION_MAJOR", major.toString())
        props.setProperty("VERSION_MINOR", nextMinor.toString())
        props.setProperty("VERSION_CODE", nextCode.toString())
        vf.outputStream().use { props.store(it, "MyOwnGolfSwing APK Auto-Version") }

        val versionedFileName = "${appTitlePrefix}_v$major.$nextMinor.apk"
        val destWorkspace = File(wsDir, versionedFileName)
        val destMobile = File(mbDir, versionedFileName)

        src.copyTo(destWorkspace, overwrite = true)
        src.copyTo(destMobile, overwrite = true)

        logger.lifecycle("==================================================================")
        logger.lifecycle("[${appTitlePrefix} APK 배포 완료] 버전: v$major.$nextMinor (Build #$nextCode)")
        logger.lifecycle(" -> 프로젝트 루트(.\\): ${destWorkspace.absolutePath}")
        logger.lifecycle(" -> 모바일 루트(mobile\\.\\): ${destMobile.absolutePath}")
        logger.lifecycle("==================================================================")
    }
}

val syncWebAssetsTask = tasks.register<SyncWebStudioAssetsTask>("syncWebStudioAssets") {
    webRootDir.set(rootProject.projectDir.parentFile)
    androidAssetsWwwDir.set(project.layout.projectDirectory.dir("src/main/assets/www"))
    outputs.upToDateWhen { false }
}

val publishVersionedApkTask = tasks.register<PublishVersionedGolfSwingApkTask>("publishVersionedGolfSwingApk") {
    apkSourceFile.set(project.layout.buildDirectory.file("outputs/apk/debug/app-debug.apk"))
    versionFile.set(versionPropsFile)
    workspaceRootDir.set(rootProject.projectDir.parentFile)
    mobileRootDir.set(rootProject.projectDir)
    outputs.upToDateWhen { false }
}

tasks.matching { it.name == "preBuild" }.configureEach {
    dependsOn(syncWebAssetsTask)
}

tasks.matching { it.name == "assembleDebug" }.configureEach {
    finalizedBy(publishVersionedApkTask)
}

dependencies {
  val composeBom = platform(libs.androidx.compose.bom)
  implementation(composeBom)
  androidTestImplementation(composeBom)

  // Core Android dependencies
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.activity.compose)

  // Arch Components
  implementation(libs.androidx.lifecycle.runtime.compose)
  implementation(libs.androidx.lifecycle.viewmodel.compose)

  // Compose
  implementation(libs.androidx.compose.ui)
  implementation(libs.androidx.compose.ui.tooling.preview)
  implementation(libs.androidx.compose.material3)
  // Tooling
  debugImplementation(libs.androidx.compose.ui.tooling)
  // Instrumented tests
  androidTestImplementation(libs.androidx.compose.ui.test.junit4)
  debugImplementation(libs.androidx.compose.ui.test.manifest)

  // Local tests: jUnit, coroutines, Android runner
  testImplementation(libs.junit)
  testImplementation(libs.kotlinx.coroutines.test)

  // Instrumented tests: jUnit rules and runners
  androidTestImplementation(libs.androidx.test.core)
  androidTestImplementation(libs.androidx.test.ext.junit)
  androidTestImplementation(libs.androidx.test.runner)
  androidTestImplementation(libs.androidx.test.espresso.core)

  // Navigation
  implementation(libs.androidx.navigation3.ui)
  implementation(libs.androidx.navigation3.runtime)
  implementation(libs.androidx.lifecycle.viewmodel.navigation3)
}
