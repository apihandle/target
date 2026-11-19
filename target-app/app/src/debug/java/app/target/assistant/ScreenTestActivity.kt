package app.target.assistant

import android.app.Activity
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/** Debug builds only: fixed text, a button and a text box for the accessibility instrumented test. */
class ScreenTestActivity : Activity() {
    lateinit var button: Button
    lateinit var input: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40, 200, 40, 40) }
        root.addView(TextView(this).apply { text = "Hello TARGET screen test" })
        button = Button(this).apply { text = "Press me"; setOnClickListener { text = "Pressed" } }
        root.addView(button)
        input = EditText(this).apply { hint = "type here" }
        root.addView(input)
        setContentView(root)
    }
}
