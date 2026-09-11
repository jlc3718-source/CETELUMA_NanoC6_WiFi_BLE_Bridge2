// Build-only: preserve global bindings, property names, function names and licenses.
const { minify } = require('terser');
const fs = require('node:fs');

async function main() {
  const scripts = JSON.parse(fs.readFileSync(0, 'utf8'));
  const result = [];
  for (const source of scripts) {
    const { code } = await minify(source, {
      ecma: 2020,
      compress: { passes: 3 },
      mangle: { toplevel: false },
      keep_fnames: true,
      format: { comments: 'some', inline_script: true },
    });
    result.push(code);
  }
  process.stdout.write(JSON.stringify(result));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
