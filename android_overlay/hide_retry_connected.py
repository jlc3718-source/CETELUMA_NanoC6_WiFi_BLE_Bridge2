from pathlib import Path
import sys

root=Path(sys.argv[1])
p=root/'app/src/main/java/com/andersonhome/controller/MainActivity.kt'
s=p.read_text()

s=s.replace('import android.webkit.WebViewClient\n','import android.webkit.WebViewClient\nimport android.view.View\n',1)
s=s.replace('    private lateinit var status: TextView\n','    private lateinit var status: TextView\n    private lateinit var retry: Button\n',1)
s=s.replace('        status = findViewById(R.id.status)\n','        status = findViewById(R.id.status)\n        retry = findViewById(R.id.retry)\n',1)
s=s.replace('                status.text = if (isSetupUrl(url)) "Opening setup…" else "Connecting…"\n','                status.text = if (isSetupUrl(url)) "Opening setup…" else "Connecting…"\n                retry.visibility = View.GONE\n',1)
s=s.replace('                    if (isSetupUrl(request.url?.toString())) {\n','                    retry.visibility = View.VISIBLE\n                    if (isSetupUrl(request.url?.toString())) {\n',1)
s=s.replace('                    status.text = "Setup mode"\n                    return\n','                    status.text = "Setup mode"\n                    retry.visibility = View.GONE\n                    return\n',1)
s=s.replace('                status.text = "Connected"\n','                status.text = "Connected"\n                retry.visibility = View.GONE\n',1)
s=s.replace('        findViewById<Button>(R.id.retry).setOnClickListener { connect() }\n','        retry.setOnClickListener { connect() }\n',1)
s=s.replace('        status.text = "Connecting…"\n        val saved =','        status.text = "Connecting…"\n        retry.visibility = View.GONE\n        val saved =',1)

p.write_text(s)
print('Retry button now appears only after a failed controller connection')
