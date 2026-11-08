#!/usr/bin/env node
/**
 * Verificação do APK JÁ COMPILADO (não do código-fonte).
 *
 * Um APK é um ZIP. Aqui abre-se o pacote, lê-se o AndroidManifest.xml binário
 * (AXML) para extrair package, versionCode e versionName realmente gravados, e
 * lê-se assets/public/js/config.js como está dentro do pacote — a única prova
 * de que o app instalado vai falar com o projeto Supabase correto.
 *
 * Uso: node scripts/verify-apk.js android/app/build/outputs/apk/debug/app-debug.apk
 */
const fs = require('fs');
const zlib = require('zlib');

const REF_ESPERADO = process.env.PROJETO || 'xncxzczftetctpazzecu';
const REF_PROIBIDO = 'ewmtphddypfcllewkgzl';
const APK = process.argv[2];

if (!APK || !fs.existsSync(APK)) {
  console.error('✘ APK não encontrado: ' + (APK || '(sem argumento)'));
  process.exit(1);
}

const buf = fs.readFileSync(APK);
const problemas = [];
const ok = [];
const info = [];

// ============================================================
// ZIP (leitura pela central directory)
// ============================================================
function lerEntradas(zip) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0 && i > zip.length - 66000; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('não é um ZIP válido (sem EOCD)');
  const total = zip.readUInt16LE(eocd + 10);
  let off = zip.readUInt32LE(eocd + 16);
  const entradas = new Map();
  for (let i = 0; i < total; i++) {
    if (zip.readUInt32LE(off) !== 0x02014b50) break;
    const compMethod = zip.readUInt16LE(off + 10);
    const compSize = zip.readUInt32LE(off + 20);
    const nomeLen = zip.readUInt16LE(off + 28);
    const extraLen = zip.readUInt16LE(off + 30);
    const comentLen = zip.readUInt16LE(off + 32);
    const localOff = zip.readUInt32LE(off + 42);
    const nome = zip.toString('utf8', off + 46, off + 46 + nomeLen);
    entradas.set(nome, { compMethod, compSize, localOff });
    off += 46 + nomeLen + extraLen + comentLen;
  }
  return entradas;
}

function extrair(zip, entrada) {
  const off = entrada.localOff;
  if (zip.readUInt32LE(off) !== 0x04034b50) throw new Error('cabeçalho local inválido');
  const nomeLen = zip.readUInt16LE(off + 26);
  const extraLen = zip.readUInt16LE(off + 28);
  const inicio = off + 30 + nomeLen + extraLen;
  const dados = zip.subarray(inicio, inicio + entrada.compSize);
  return entrada.compMethod === 0 ? dados : zlib.inflateRawSync(dados);
}

// ============================================================
// AXML — leitor mínimo de AndroidManifest.xml binário
// ============================================================
const T_STRING_POOL = 0x0001;
const T_RES_MAP = 0x0180;
const T_START_ELEMENT = 0x0102;
const UTF8_FLAG = 0x100;
// IDs de atributo do framework android
const ATTR_VERSION_CODE = 0x0101021b;
const ATTR_VERSION_NAME = 0x0101021c;

function lerStringPool(axml, base) {
  const count = axml.readUInt32LE(base + 8);
  const flags = axml.readUInt32LE(base + 16);
  const stringsStart = axml.readUInt32LE(base + 20);
  const utf8 = (flags & UTF8_FLAG) !== 0;
  const pool = [];
  const dados = base + stringsStart;
  for (let i = 0; i < count; i++) {
    let p = dados + axml.readUInt32LE(base + 28 + i * 4);
    if (utf8) {
      // comprimento em "chars" e em bytes, cada um 1 ou 2 bytes
      let lenBytes = axml[p++];
      if (lenBytes & 0x80) { lenBytes = ((lenBytes & 0x7f) << 8) | axml[p++]; }
      let lenChars = axml[p++];
      if (lenChars & 0x80) { lenChars = ((lenChars & 0x7f) << 8) | axml[p++]; }
      pool.push(axml.toString('utf8', p, p + lenBytes));
    } else {
      let len = axml.readUInt16LE(p); p += 2;
      if (len & 0x8000) { len = ((len & 0x7fff) << 16) | axml.readUInt16LE(p); p += 2; }
      pool.push(axml.toString('utf16le', p, p + len * 2));
    }
  }
  return pool;
}

function lerManifest(axml) {
  if (axml.readUInt16LE(0) !== 0x0003) throw new Error('não é AXML (header 0x0003 em falta)');
  const total = axml.readUInt32LE(4);
  let p = axml.readUInt16LE(2); // headerSize do ficheiro
  let strings = [];
  let resMap = [];
  const elems = [];
  while (p + 8 <= Math.min(total, axml.length)) {
    const tipo = axml.readUInt16LE(p);
    const headerSize = axml.readUInt16LE(p + 2);
    const size = axml.readUInt32LE(p + 4);
    if (size === 0) break;
    if (tipo === T_STRING_POOL) strings = lerStringPool(axml, p);
    else if (tipo === T_RES_MAP) {
      const n = (size - headerSize) / 4;
      for (let i = 0; i < n; i++) resMap.push(axml.readUInt32LE(p + headerSize + i * 4));
    } else if (tipo === T_START_ELEMENT) {
      const corpo = p + headerSize;
      const ns = axml.readUInt32LE(corpo);
      const nome = strings[axml.readUInt32LE(corpo + 4)] || '';
      const attrStart = axml.readUInt16LE(corpo + 8);
      const attrSize = axml.readUInt16LE(corpo + 10);
      const attrCount = axml.readUInt16LE(corpo + 12);
      const attrs = [];
      for (let i = 0; i < attrCount; i++) {
        const a = corpo + attrStart + i * attrSize;
        const nameIdx = axml.readUInt32LE(a + 4);
        const rawValue = axml.readUInt32LE(a + 8);
        const dataType = axml[a + 15];
        const data = axml.readUInt32LE(a + 16);
        attrs.push({
          nome: strings[nameIdx] || '',
          resourceId: resMap[nameIdx] || 0,
          valor: (dataType === 0x03 ? strings[data] : data),
          dataType
        });
      }
      elems.push({ ns, nome, attrs });
      if (nome === 'manifest') return { elems, strings, primeiro: elems[0] };
    }
    p += size;
  }
  if (!elems.length) throw new Error('nenhum elemento no manifesto');
  return { elems, strings, primeiro: elems[0] };
}

// ============================================================
// 1. estrutura do pacote
// ============================================================
let entradas;
try {
  entradas = lerEntradas(buf);
  ok.push(`ZIP válido, ${entradas.size} entradas`);
} catch (e) {
  console.error('✘ ' + e.message);
  process.exit(1);
}

// ============================================================
// 2. versão e package REALMENTE gravados no manifesto
// ============================================================
const manifestEntrada = entradas.get('AndroidManifest.xml');
let apkPackage = null, apkVersionName = null, apkVersionCode = null;
if (!manifestEntrada) {
  problemas.push('AndroidManifest.xml ausente do APK');
} else {
  try {
    const { strings } = lerManifest(extrair(buf, manifestEntrada));
    // o atributo pacote fica no elemento <manifest>
    const { primeiro } = lerManifest(extrair(buf, manifestEntrada));
    const attrPkg = primeiro.attrs.find(a => a.nome === 'package');
    apkPackage = attrPkg ? String(attrPkg.valor) : null;
    const aVc = primeiro.attrs.find(a => a.resourceId === ATTR_VERSION_CODE);
    const aVn = primeiro.attrs.find(a => a.resourceId === ATTR_VERSION_NAME);
    if (aVc) apkVersionCode = Number(aVc.valor);
    if (aVn) apkVersionName = String(aVn.valor);

    if (!apkPackage) problemas.push('atributo package não encontrado no manifesto');
    else if (apkPackage !== 'com.pro.driver') problemas.push(`package ${apkPackage} != com.pro.driver`);
    else ok.push('package = com.pro.driver');

    const pkg = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'package.json'), 'utf8'));
    const [ma, mi, pa] = pkg.version.split('.').map(Number);
    const vcEsperado = ma * 10000 + mi * 100 + pa;

    if (apkVersionName === null) problemas.push('versionName não encontrado no manifesto do APK');
    else if (apkVersionName !== pkg.version) problemas.push(`versionName no APK (${apkVersionName}) != package.json (${pkg.version})`);
    else ok.push(`versionName no APK = ${apkVersionName}`);

    if (apkVersionCode === null) problemas.push('versionCode não encontrado no manifesto do APK');
    else if (apkVersionCode !== vcEsperado) problemas.push(`versionCode no APK (${apkVersionCode}) != esperado (${vcEsperado})`);
    else ok.push(`versionCode no APK = ${apkVersionCode}`);

    const esquema = strings.includes('com.pro.driver') && strings.find(s => s === 'com.pro.driver');
    if (!esquema) problemas.push('esquema do deep link (com.pro.driver) não está no manifesto');
    else ok.push('deep link com.pro.driver presente');
  } catch (e) {
    problemas.push('não foi possível ler o manifesto do APK: ' + e.message);
  }
}

// ============================================================
// 3. o config.js que está DENTRO do APK
// ============================================================
const cfgEntrada = entradas.get('assets/public/js/config.js');
if (!cfgEntrada) {
  problemas.push('assets/public/js/config.js ausente do APK');
} else {
  const cfg = extrair(buf, cfgEntrada).toString('utf8');
  const url = (cfg.match(/MP_SUPABASE_URL\s*=\s*'([^']+)'/) || [])[1];
  const key = (cfg.match(/MP_SUPABASE_ANON_KEY\s*=\s*'([^']+)'/) || [])[1];
  if (!url) problemas.push('config.js dentro do APK sem URL');
  else if (!url.includes(REF_ESPERADO)) problemas.push(`URL dentro do APK errada: ${url}`);
  else ok.push(`URL dentro do APK = ${url}`);
  if (!key) problemas.push('config.js dentro do APK sem chave pública');
  else if (/sb_secret|service_role/.test(key)) problemas.push('chave secreta dentro do APK — inaceitável');
  else if (!/^sb_publishable_/.test(key)) problemas.push('chave dentro do APK não é publishable');
  else ok.push('chave pública (sb_publishable_) dentro do APK, sem segredos');
}

// ============================================================
// 4. varredura do conteúdo textual do pacote
// ============================================================
let comProjetoAntigo = [];
for (const [nome, ent] of entradas) {
  if (!/^assets\/public\/.*\.(js|html|json)$/.test(nome)) continue;
  try {
    if (extrair(buf, ent).toString('utf8').includes(REF_PROIBIDO)) comProjetoAntigo.push(nome);
  } catch (_) { /* entrada não abre: ignorar */ }
}
if (comProjetoAntigo.length) problemas.push('referências ao projeto antigo no APK: ' + comProjetoAntigo.join(', '));
else ok.push('nenhuma referência ao projeto antigo no conteúdo do APK');

// ============================================================
// resultado
// ============================================================
console.log('=== verificação do APK ===');
console.log(`  ficheiro: ${APK} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
ok.forEach(o => console.log('  ✔ ' + o));
info.forEach(o => console.log('  · ' + o));
if (problemas.length) {
  problemas.forEach(p => console.error('  ✘ ' + p));
  console.error(`\n${problemas.length} problema(s).`);
  process.exit(1);
}
console.log('\nAPK validado: fala com ' + REF_ESPERADO + ', versão correta, sem segredos.');
