import java.io.ByteArrayOutputStream

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

/** Kurzer Commit-Hash für die Update-Prüfung in der App (wie zuvor über build.json). */
fun gitBuildId(): String {
    val fromCi = System.getenv("GITHUB_SHA")
    if (!fromCi.isNullOrBlank()) return fromCi.take(7)
    return try {
        val out = ByteArrayOutputStream()
        exec {
            commandLine("git", "rev-parse", "--short=7", "HEAD")
            standardOutput = out
            isIgnoreExitValue = true
        }
        out.toString().trim().ifBlank { "dev" }
    } catch (e: Exception) {
        "dev"
    }
}

val appVersionName = file("../../../package.json").let { pkg ->
    Regex(""""version"\s*:\s*"([^"]+)"""").find(pkg.readText())?.groupValues?.get(1) ?: "0.0.0"
}

android {
    namespace = "app.anmachacast.studio"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.anmachacast.studio"
        minSdk = 26
        targetSdk = 35
        // Steigt mit jedem CI-Lauf, damit Updates über die installierte App als neuere Version gelten
        versionCode = (System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1)
        // Versions-Tag-Builds (ANDROID_CLEAN_VERSION=1) tragen die reine Version, alle anderen Builds hängen den Commit an
        versionName = if (System.getenv("ANDROID_CLEAN_VERSION") == "1") appVersionName else "$appVersionName-${gitBuildId()}"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "BUILD_ID", "\"${gitBuildId()}\"")
    }

    signingConfigs {
        create("release") {
            val ksPath = System.getenv("ANDROID_KEYSTORE")
            if (!ksPath.isNullOrBlank()) {
                storeFile = file(ksPath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (!System.getenv("ANDROID_KEYSTORE").isNullOrBlank()) signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = null
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // Reine Handy-Engine (Mixer, MP3-Encoder, Icecast-Quelle, Android-Schicht) liegt außerhalb von
    // app/src, damit sie unabhängig von der App auch mit engine/test.sh testbar bleibt (eine einzige
    // Quelle statt einer Kopie, die bei Änderungen auseinanderlaufen könnte).
    sourceSets {
        getByName("main") {
            java.srcDirs("../engine/src", "../native")
        }
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.security.crypto)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.coil.compose)
    // MP3-Encoder für den Handy-Sender (LAME als reines Java, LGPL 2.1+)
    implementation("de.sciss:jump3r:1.0.5")
    // QR-Scanner ohne Google-Dienste (ZXing, Apache-2.0) für „Per QR-Code koppeln“
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")

    testImplementation(libs.junit)
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    debugImplementation(libs.androidx.ui.tooling)
}
