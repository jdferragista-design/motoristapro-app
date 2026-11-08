#!/usr/bin/env node
/**
 * Verificação estática dos assets que vão DENTRO do APK.
 *
 * Existe porque o APK instalado estava a falar com o projeto Supabase
 * eliminado (ewmtphddypfcllewkgzl). A causa não era o código: era a cópia
 * congelada em android/app/src/main/assets/public, que é o que o Gradle
 * empacota — `www/` não vai para o APK. Este script falha o build se a cópia
 * Android divergir do código ou se apontar para outro projeto.
 *
 * Uso: node scripts/verify-android-assets.js
 *      PROJETO=ref-esperado node scripts/verify-android-assets.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');
const ASSETS = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'public');
const REF_ESPERADO = process.env.PROJETO || 'xncxzczftetctpazzecu';
const REF_PROIBIDO = 'ewmtphddypfcllewkgzl';

const problemas = [];
const ok = [];

// ---------- 1. o config.js que vai no APK ----------
const configPath = path.join(ASSETS, 'js', 'config.js');
if (!fs.existsSync(configPath)) {
  problemas.push('assets/public/js/config.js não existe (npx cap copy não correu?)');
} else {
  const cfg = fs.readFileSync(configPath, 'utf8');
  const url = (cfg.match(/MP_SUPABASE_URL\s*=\s*'([^']+)'/) || [])[1];
  const key = (cfg.match(/MP_SUPABASE_ANON_KEY\s*=\s*'([^']+)'/) || [])[1];
  if (!url) problemas.push('config.js dos assets sem MP_SUPABASE_URL');
  else if (!url.includes(REF_ESPERADO)) problemas.push(`URL nos assets não é do projeto ${REF_ESPERADO}: ${url}`);
  else ok.push(`URL = ${REF_ESPERADO}`);

  if (!key) problemas.push('config.js dos assets sem MP_SUPABASE_ANON_KEY');
  else {
    if (!/^sb_publishable_/.test(key)) problemas.push('a chave nos assets não é publishable (pode ser uma chave secreta!)');
    else ok.push('chave = publishable (sb_publishable_…)');
    // O ref também vai codificado dentro do JWT das chaves legacy.
    const partes = key.split('.');
    if (partes.length === 3) {
      try {
        const payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
        if (payload.ref && payload.ref !== REF_ESPERADO) problemas.push(`chave com ref ${payload.ref} != ${REF_ESPERADO}`);
        if (payload.role && payload.role !== 'anon') problemas.push(`chave com role ${payload.role} (não anon)`);
      } catch (_) { /* chave publishable nova não é JWT */ }
    }
  }
}

// ---------- 2. nenhum ficheiro do pacote pode referenciar o projeto antigo ----------
function varrer(dir, achados) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { varrer(p, achados); continue; }
    if (!/\.(html|js|json|css)$/.test(e.name)) continue;
    const txt = fs.readFileSync(p, 'utf8');
    if (txt.includes(REF_PROIBIDO)) achados.push(path.relative(ASSETS, p));
  }
}
const achados = [];
if (fs.existsSync(ASSETS)) varrer(ASSETS, achados);
// www/atualizar.html cita o ref antigo de propósito: é a página de diagnóstico
// que denuncia o servidor errado. Só interessa o que está no APK.
if (achados.length) {
  problemas.push(`referências ao projeto antigo dentro do APK: ${achados.join(', ')}`);
} else {
  ok.push('nenhuma referência ao projeto antigo nos assets do APK');
}

// ---------- 3. a cópia do APK tem de ser a do código atual ----------
const ficheiros = ['index.html', 'sw.js', 'js/config.js', 'js/auth.js', 'js/data.js', 'js/render.js', 'js/utils.js', 'js/init.js'];
const divergentes = [];
for (const rel of ficheiros) {
  const a = path.join(WWW, rel);
  const b = path.join(ASSETS, rel);
  if (!fs.existsSync(a) || !fs.existsSync(b)) { divergentes.push(rel + ' (em falta)'); continue; }
  if (fs.readFileSync(a, 'utf8') !== fs.readFileSync(b, 'utf8')) divergentes.push(rel);
}
if (divergentes.length) {
  problemas.push(`assets Android dessincronizados de www/: ${divergentes.join(', ')} — correr "npx cap copy android"`);
} else {
  ok.push('assets Android iguais a www/');
}

// ---------- 4. versão que o APK vai reportar ----------
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const gradle = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8');
const vn = (gradle.match(/versionName\s+"([^"]*)"/) || [])[1];
const vc = Number((gradle.match(/versionCode\s+(\d+)/) || [])[1]);
const [ma, mi, pa] = pkg.version.split('.').map(Number);
if (vn !== pkg.version) problemas.push(`versionName "${vn}" != package.json ${pkg.version}`);
if (vc !== ma * 10000 + mi * 100 + pa) problemas.push(`versionCode ${vc} != esperado ${ma * 10000 + mi * 100 + pa}`);
if (vn === pkg.version && vc === ma * 10000 + mi * 100 + pa) ok.push(`versão ${vn} (versionCode ${vc})`);

// ---------- 5. appId coerente com o deep link OAuth ----------
const capCfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8'));
const manifest = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
const esquema = (manifest.match(/android:scheme="([^"]+)"/) || [])[1];
if (esquema && esquema !== capCfg.appId) problemas.push(`scheme do deep link (${esquema}) != appId (${capCfg.appId})`);
else ok.push(`deep link = ${esquema}`);

// ---------- resultado ----------
console.log('=== verificação dos assets do APK ===');
ok.forEach(o => console.log('  ✔ ' + o));
if (problemas.length) {
  problemas.forEach(p => console.error('  ✘ ' + p));
  console.error(`\n${problemas.length} problema(s) — build NÃO pode continuar.`);
  process.exit(1);
}
console.log('\nTudo consistente: o APK vai falar com ' + REF_ESPERADO + '.');
