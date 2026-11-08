# Keep the JS bridge methods (called by name from the web app).
-keepclassmembers class app.target.assistant.web.TargetBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# Room builds the database implementation by name at runtime; keep it and its constructor.
-keep class * extends androidx.room.RoomDatabase {
    <init>();
}
-keep class **_Impl {
    <init>();
    *;
}
