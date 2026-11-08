#!/usr/bin/env node
/**
 * Fonte única de versão (A-05 / M-09).
 *
 * package.json  →  version
 *              →  meta[name="app-version"] em www/index.html (lido por utils.js)
 *              →  android/app/build.gradle: versionName + versionCode
 *
 * versionCode = major*10000 + minor*100 + patch. Monotónico e derivado: tem de
 * subir a cada envio para a Play Store aceitar a atualização (estava fixo em 1).
 *
 * Uso: npm run version:sync            → sincroniza
 *      npm run version:check           → falha se estiver dessincronizado
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkgPath = path.join(ROOT, 'package.json');
const indexPath = path.join(ROOT, 'www', 'index.html');
const gradlePath = path.join(ROOT, 'android', 'app', 'build.gradle');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
if (!m) {
  console.error(`✖ package.json version "${version}" não é MAJOR.MINOR.PATCH`);
  process.exit(1);
}
const versionCode = Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
const check = process.argv.includes('--check');
const problemas = [];

// 1) index.html
let html = fs.readFileSync(indexPath, 'utf8');
const metaRe = /<meta name="app-version" content="([^"]*)"\s*\/?>/;
const meta = metaRe.exec(html);
if (!meta) {
  problemas.push('www/index.html sem <meta name="app-version">');
} else if (meta[1] !== version) {
  if (check) problemas.push(`index.html app-version=${meta[1]} != package.json ${version}`);
  else {
    fs.writeFileSync(indexPath, html.replace(metaRe, `<meta name="app-version" content="${version}" />`));
    console.log(`✔ index.html app-version -> ${version}`);
  }
}

// 2) build.gradle
let gradle = fs.readFileSync(gradlePath, 'utf8');
const vcRe = /(versionCode\s+)(\d+)/;
const vnRe = /(versionName\s+")([^"]*)(")/;
const vc = vcRe.exec(gradle);
const vn = vnRe.exec(gradle);
if (!vc || !vn) {
  problemas.push('android/app/build.gradle sem versionCode/versionName reconhecíveis');
} else if (check) {
  if (Number(vc[2]) !== versionCode) problemas.push(`build.gradle versionCode=${vc[2]} != esperado ${versionCode}`);
  if (vn[2] !== version) problemas.push(`build.gradle versionName="${vn[2]}" != ${version}`);
} else {
  let mudou = false;
  if (Number(vc[2]) !== versionCode) {
    gradle = gradle.replace(vcRe, `$1${versionCode}`);
    console.log(`✔ build.gradle versionCode ${vc[2]} -> ${versionCode}`);
    mudou = true;
  }
  if (vn[2] !== version) {
    gradle = gradle.replace(vnRe, `$1${version}$3`);
    console.log(`✔ build.gradle versionName "${vn[2]}" -> "${version}"`);
    mudou = true;
  }
  if (mudou) fs.writeFileSync(gradlePath, gradle);
}

if (problemas.length) {
  console.error('✖ Versão dessincronizada:\n  - ' + problemas.join('\n  - '));
  process.exit(1);
}
if (check) console.log(`✔ versão sincronizada: ${version} (versionCode ${versionCode})`);
