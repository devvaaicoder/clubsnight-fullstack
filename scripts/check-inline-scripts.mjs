import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const rootFiles = ["katalog.html", "login.html", "index.html"].filter((f) => fs.existsSync(f));
const distDir = "dist";
const distFiles = fs.existsSync(distDir)
  ? fs.readdirSync(distDir).filter((f) => f.endsWith(".html")).map((f) => path.join(distDir, f))
  : [];

const files = [...rootFiles, ...distFiles];
const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

let totalScripts = 0;
let failures = 0;

for (const file of files) {
  const html = fs.readFileSync(file, "utf8");
  let match;
  while ((match = scriptRe.exec(html)) !== null) {
    const attrs = match[1] || "";
    const code = match[2] || "";
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const typeMatch = attrs.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const typeVal = (typeMatch && (typeMatch[1] || typeMatch[2] || typeMatch[3]) || "").trim().toLowerCase();
    if (typeVal && typeVal !== "text/javascript" && typeVal !== "application/javascript") continue;
    if (!code.trim()) continue;

    totalScripts++;
    const tagEndOffset = match.index + match[0].indexOf(">") + 1;
    const startLine = html.slice(0, tagEndOffset).split("\n").length;

    try {
      new vm.Script(code, { filename: file, lineOffset: startLine - 1 });
    } catch (err) {
      failures++;
      const stackLine = (err.stack || "").split("\n")[0] || `${file}:${startLine}`;
      console.error(`❌ Syntax error in ${stackLine} (script starts ~line ${startLine}): ${err.message}`);
    }
  }
}

if (failures > 0) {
  console.error(`\nFailed: ${failures} inline script error(s) across ${files.length} HTML file(s).`);
  process.exit(1);
}
console.log(`✅ Checked ${totalScripts} inline script(s) across ${files.length} HTML file(s): 0 syntax errors.`);
