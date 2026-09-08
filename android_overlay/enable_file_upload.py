from pathlib import Path
import sys

root=Path(sys.argv[1])
p=root/'app/src/main/java/com/andersonhome/controller/MainActivity.kt'
s=p.read_text()

s=s.replace('import android.graphics.Bitmap\n', 'import android.app.Activity\nimport android.content.Intent\nimport android.graphics.Bitmap\n',1)
s=s.replace('import android.webkit.WebViewClient\n', 'import android.webkit.WebViewClient\nimport android.webkit.ValueCallback\n',1)
s=s.replace('import androidx.appcompat.app.AppCompatActivity\n', 'import androidx.appcompat.app.AppCompatActivity\nimport androidx.activity.result.contract.ActivityResultContracts\n',1)

field_anchor='    private var mainFrameLoadFailed = false\n'
fields='''    private var mainFrameLoadFailed = false\n    private var filePathCallback: ValueCallback<Array<Uri>>? = null\n    private val fileChooserLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->\n        val uris = if (result.resultCode == Activity.RESULT_OK) {\n            WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)\n        } else null\n        filePathCallback?.onReceiveValue(uris)\n        filePathCallback = null\n    }\n'''
if field_anchor not in s: raise SystemExit('MainActivity field anchor not found')
s=s.replace(field_anchor,fields,1)

old='        web.webChromeClient = WebChromeClient()\n'
new='''        web.webChromeClient = object : WebChromeClient() {\n            override fun onShowFileChooser(\n                webView: WebView?,\n                callback: ValueCallback<Array<Uri>>?,\n                fileChooserParams: FileChooserParams?\n            ): Boolean {\n                filePathCallback?.onReceiveValue(null)\n                filePathCallback = callback\n                return try {\n                    val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_OPEN_DOCUMENT).apply {\n                        addCategory(Intent.CATEGORY_OPENABLE)\n                        type = "application/octet-stream"\n                    }\n                    fileChooserLauncher.launch(intent)\n                    true\n                } catch (_: Exception) {\n                    filePathCallback?.onReceiveValue(null)\n                    filePathCallback = null\n                    false\n                }\n            }\n        }\n'''
if old not in s: raise SystemExit('WebChromeClient anchor not found')
s=s.replace(old,new,1)
p.write_text(s)
print('Enabled Android WebView file chooser for firmware BIN uploads')
