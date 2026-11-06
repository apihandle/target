package app.target.assistant.brain

import android.content.Context
import android.content.Intent
import android.net.Uri
import app.target.assistant.BuildConfig
import app.target.assistant.MainActivity
import app.target.assistant.R
import app.target.assistant.tools.DeviceTools
import org.json.JSONObject

/** Result of handling one utterance: what to say back, and whether the overlay can close. */
data class Outcome(val reply: String, val handledLocally: Boolean)

/** Runs a parsed [Command] with [DeviceTools]; anything unknown opens the TARGET web app with the query. */
class CommandRunner(private val context: Context) {
    private val tools = DeviceTools(context)

    fun handle(text: String): Outcome = run(IntentParser.parse(text), text)

    fun run(cmd: Command, original: String): Outcome {
        val s = context.resources
        fun okOf(json: String) = runCatching { JSONObject(json).optBoolean("ok") }.getOrDefault(false)
        fun errOf(json: String) = runCatching { JSONObject(json).optString("error") }.getOrDefault("")
        return when (cmd) {
            is Command.Alarm -> tools.setAlarm(cmd.hour, cmd.minute, cmd.label).let {
                if (okOf(it)) Outcome(s.getString(R.string.reply_alarm, "%d:%02d".format(cmd.hour, cmd.minute)), true)
                else Outcome(errOf(it), true)
            }
            is Command.Timer -> tools.setTimer(cmd.seconds, cmd.label).let {
                if (okOf(it)) Outcome(s.getString(R.string.reply_timer, humanDuration(cmd.seconds)), true) else Outcome(errOf(it), true)
            }
            is Command.Flashlight -> tools.flashlight(cmd.on).let {
                if (okOf(it)) Outcome(s.getString(if (cmd.on) R.string.reply_torch_on else R.string.reply_torch_off), true) else Outcome(errOf(it), true)
            }
            is Command.OpenApp -> tools.openApp(cmd.name).let {
                if (okOf(it)) Outcome(s.getString(R.string.reply_open, cmd.name), true) else Outcome(errOf(it), true)
            }
            is Command.Dial -> tools.dial(cmd.number).let {
                if (okOf(it)) Outcome(s.getString(R.string.reply_dial, cmd.number), true) else Outcome(errOf(it), true)
            }
            is Command.Sms -> tools.composeSms(cmd.number, cmd.text).let {
                if (okOf(it)) Outcome(s.getString(R.string.reply_sms), true) else Outcome(errOf(it), true)
            }
            is Command.Navigate -> tools.navigate(cmd.place).let {
                if (okOf(it)) Outcome(s.getString(R.string.reply_navigate, cmd.place), true) else Outcome(errOf(it), true)
            }
            is Command.OpenUrl -> tools.openUrl(cmd.url).let { Outcome(if (okOf(it)) s.getString(R.string.reply_open, cmd.url) else errOf(it), true) }
            Command.Battery -> tools.batteryLevel().let { (level, charging) ->
                Outcome(s.getString(if (charging) R.string.reply_battery_charging else R.string.reply_battery, level), true)
            }
            is Command.Ask -> {
                openWebApp(context, original)
                Outcome(s.getString(R.string.reply_web), false)
            }
        }
    }

    private fun humanDuration(sec: Int): String {
        val h = sec / 3600; val m = (sec % 3600) / 60; val ss = sec % 60
        return listOfNotNull(
            if (h > 0) "$h ghante" else null,
            if (m > 0) "$m minute" else null,
            if (ss > 0) "$ss second" else null,
        ).joinToString(" ")
    }

    companion object {
        /** https://…/app?q=<text>&send=1 — the web app prefills and sends the message (see src/app/app/page.tsx). */
        fun webUrlFor(query: String?): String {
            val base = BuildConfig.BASE_URL.trimEnd('/') + BuildConfig.APP_PATH
            if (query.isNullOrBlank()) return base
            return base + "?q=" + Uri.encode(query.take(2000)) + "&send=1"
        }

        fun openWebApp(context: Context, query: String?) {
            val i = Intent(context, MainActivity::class.java)
                .setAction(Intent.ACTION_VIEW)
                .putExtra(MainActivity.EXTRA_URL, webUrlFor(query))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            context.startActivity(i)
        }
    }
}
