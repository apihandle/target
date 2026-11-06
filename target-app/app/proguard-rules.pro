# Keep the JS bridge methods (called by name from the web app).
-keepclassmembers class app.target.assistant.web.TargetBridge {
    @android.webkit.JavascriptInterface <methods>;
}
