package app.target.assistant.web

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * One image (camera photo or screenshot) waiting to be attached in the TARGET web app's composer.
 * The web app uploads it with its own login (Supabase storage + /api/attachments), so the phone
 * needs no extra keys. Kept in memory only, handed out once.
 */
object PendingImage {
    private const val MAX_SIDE = 1600

    @Volatile private var json: String? = null

    fun has() = json != null

    /** JSON {ok,name,mime,b64,autoSend} once; then {ok:false}. */
    fun take(): String {
        val j = json ?: return JSONObject().put("ok", false).toString()
        json = null
        return j
    }

    fun set(context: Context, bitmap: Bitmap, name: String) {
        json = encode(scale(bitmap), name)
    }

    fun setFromFile(context: Context, file: File, name: String): Boolean {
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, opts)
        var sample = 1
        while (maxOf(opts.outWidth, opts.outHeight) / sample > MAX_SIDE * 2) sample *= 2
        val bmp = BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return false
        json = encode(scale(rotateFromExif(file, bmp)), name)
        return true
    }

    private fun rotateFromExif(file: File, bmp: Bitmap): Bitmap = try {
        val exif = android.media.ExifInterface(file.absolutePath)
        val deg = when (exif.getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, 1)) {
            android.media.ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            android.media.ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            android.media.ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
        }
        if (deg == 0f) bmp else Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, android.graphics.Matrix().apply { postRotate(deg) }, true)
    } catch (_: Exception) { bmp }

    private fun scale(b: Bitmap): Bitmap {
        val side = maxOf(b.width, b.height)
        if (side <= MAX_SIDE) return b
        val f = MAX_SIDE.toFloat() / side
        return Bitmap.createScaledBitmap(b, (b.width * f).toInt(), (b.height * f).toInt(), true)
    }

    private fun encode(b: Bitmap, name: String): String {
        val out = ByteArrayOutputStream()
        b.compress(Bitmap.CompressFormat.JPEG, 85, out)
        return JSONObject()
            .put("ok", true)
            .put("name", name)
            .put("mime", "image/jpeg")
            .put("b64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
            .put("autoSend", true)
            .toString()
    }

    /**
     * Runs in the TARGET page: puts the image into the composer's file input (data-testid="file-input"),
     * waits for the upload, then presses Send (data-testid="chat-send") — the question is prefilled via ?q=.
     */
    const val INJECT_JS = """
(function(){
  var tries=0;
  function go(){
    var inp=document.querySelector('[data-testid=file-input]');
    if(!inp){ if(tries++<60) setTimeout(go,250); return; }
    if(!window.TargetAndroid||typeof TargetAndroid.takePendingImage!=='function'){ if(tries++<60) setTimeout(go,250); return; }
    TargetAndroid.takePendingImage().then(function(r){ attach(inp,r); });
  }
  function attach(inp,r){
    if(!r||!r.ok) return;
    var bin=atob(r.b64), arr=new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    var dt=new DataTransfer(); dt.items.add(new File([arr], r.name, {type:r.mime}));
    inp.files=dt.files; inp.dispatchEvent(new Event('change',{bubbles:true}));
    if(!r.autoSend) return;
    var waited=0;
    (function send(){
      var b=document.querySelector('[data-testid=chat-send]');
      if(b && !b.disabled && waited>=1200){ b.click(); return; }
      waited+=300; if(waited<45000) setTimeout(send,300);
    })();
  }
  go();
})();
"""
}
