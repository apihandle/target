// Top-level build file. AGP 9 compiles Kotlin itself (built-in Kotlin), so only the
// Compose compiler plugin needs a Kotlin version.
plugins {
    id("com.android.application") version "9.5.1" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.21" apply false
    // Room's annotation processor (local chat history + offline queue).
    id("com.google.devtools.ksp") version "2.3.13" apply false
}
