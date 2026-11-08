plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
}

// Web app the shell loads. Change here (or pass -PtargetBaseUrl=https://…) to point at another deploy.
val targetBaseUrl: String = (project.findProperty("targetBaseUrl") as String?) ?: "https://gettarget.vercel.app"
// Optional, for "camera se dekho" straight to the chat API: the web app's PUBLIC Supabase URL + anon key
// (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY, the same values every browser gets). Empty = the
// photo goes through the WebView composer. Never put a service-role key here.
val supabaseUrl: String = (project.findProperty("supabaseUrl") as String?) ?: ""
val supabaseAnonKey: String = (project.findProperty("supabaseAnonKey") as String?) ?: ""

// Release versioning: CI passes -PversionCode=<github.run_number> -PversionName=<…>. Local/debug builds stay 1 / 0.2.0.
val appVersionCode: Int = (project.findProperty("versionCode") as String?)?.toIntOrNull() ?: 1
val appVersionName: String = (project.findProperty("versionName") as String?) ?: "0.2.0"

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
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "BASE_URL", "\"$targetBaseUrl\"")
        buildConfigField("String", "UPDATE_MANIFEST_URL", "\"$updateManifestUrl\"")
        buildConfigField("String", "APP_PATH", "\"/app\"")
        buildConfigField("String", "SUPABASE_URL", "\"$supabaseUrl\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"$supabaseAnonKey\"")
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
            // R8 code shrinking + resource shrinking: the release APK ships only the code and
            // resources the app actually uses (the JS bridge and Room classes are kept in
            // proguard-rules.pro). Debug builds stay unshrunk for the emulator tests in CI.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Real phones are ARM: shipping only these two ABIs keeps x86/x86_64 native libs
            // out of the release APK. Debug builds keep every ABI for the x86_64 emulator.
            ndk {
                abiFilters += listOf("arm64-v8a", "armeabi-v7a")
            }
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
        animationsDisabled = true
    }

    packaging {
        resources {
            excludes += setOf("META-INF/LICENSE*", "META-INF/NOTICE*", "META-INF/DEPENDENCIES", "META-INF/*.kotlin_module")
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.06.01")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.browser:browser:1.10.0")
    implementation("androidx.webkit:webkit:1.15.0")
    implementation("androidx.datastore:datastore-preferences:1.1.7")
    implementation("androidx.room:room-runtime:2.8.5")
    ksp("androidx.room:room-compiler:2.8.5")
    // 2.11.x: newest line whose deps still compile against SDK 36.
    implementation("androidx.work:work-runtime-ktx:2.11.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    // Compose tooling is for Android Studio previews only: never ship it in the APK.
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-tooling-preview")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303") // real org.json for JVM tests (android.jar only has stubs)

    androidTestImplementation("androidx.test:core:1.7.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test:rules:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    androidTestImplementation("androidx.test.espresso:espresso-intents:3.7.0")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}
