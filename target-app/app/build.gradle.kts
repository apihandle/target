plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Web app the shell loads. Change here (or pass -PtargetBaseUrl=https://…) to point at another deploy.
val targetBaseUrl: String = (project.findProperty("targetBaseUrl") as String?) ?: "https://gettarget.vercel.app"

// Release versioning: CI passes -PversionCode=<github.run_number> -PversionName=<…>. Local/debug builds stay 1 / 0.1.0.
val appVersionCode: Int = (project.findProperty("versionCode") as String?)?.toIntOrNull() ?: 1
val appVersionName: String = (project.findProperty("versionName") as String?) ?: "0.1.0"

// Where the in-app updater reads version.json. Default: the public Supabase Storage bucket "app-updates".
// Override with -PupdateManifestUrl=https://… (an empty value turns the updater's network check off).
val updateManifestUrl: String = (project.findProperty("updateManifestUrl") as String?)
    ?: "https://eauoflkytzrxbyicvfzu.supabase.co/storage/v1/object/public/app-updates/android/version.json"

// Release signing comes only from the environment (GitHub Actions secrets, decoded to a temp file in CI).
// The keystore and its passwords are never committed. Every release must use this same key, or updates break.
val releaseKeystore: String? = System.getenv("ANDROID_KEYSTORE_FILE")?.takeIf { it.isNotBlank() }

android {
    namespace = "app.target.assistant"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.target.assistant"
        minSdk = 26
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersionName
        buildConfigField("String", "BASE_URL", "\"$targetBaseUrl\"")
        buildConfigField("String", "UPDATE_MANIFEST_URL", "\"$updateManifestUrl\"")
        buildConfigField("String", "APP_PATH", "\"/app\"")
    }

    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore!!)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            if (releaseKeystore != null) signingConfig = signingConfigs.getByName("release")
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
        buildConfig = true
    }

    lint {
        // Report lint problems on release builds without failing the build on them.
        abortOnError = false
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.06.01")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.browser:browser:1.10.0")
    // 2.11.x: newest line whose deps still compile against SDK 36.
    implementation("androidx.work:work-runtime-ktx:2.11.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.compose.ui:ui-tooling-preview")

    testImplementation("junit:junit:4.13.2")
    // Real org.json for JVM unit tests (android.jar only has stubs).
    testImplementation("org.json:json:20240303")
}
