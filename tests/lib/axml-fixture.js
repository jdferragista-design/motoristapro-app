// Gera AXML mínimo VÁLIDO (string pool + res map + <manifest> com atributos
// versionCode/versionName/package) para testar o leitor sem Gradle.
// Fixtures de teste: geram um AndroidManifest.xml binário (AXML) mínimo e um
// APK sintético (ZIP), para exercitar scripts/verify-apk.js sem Gradle.
const fs = require('fs');
const zlib = require('zlib');

const RID_VERSION_CODE = 0x0101021b;
const RID_VERSION_NAME = 0x0101021c;

function zip(ficheiros, saida) {
  const loc = [], cen = [];
  let off = 0;
  for (const [n, d] of ficheiros) {
    const c = zlib.deflateRawSync(d), nb = Buffer.from(n, 'utf8');
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(8, 8);
    l.writeUInt32LE(c.length, 18); l.writeUInt32LE(d.length, 22); l.writeUInt16LE(nb.length, 26);
    loc.push(l, nb, c);
    const ce = Buffer.alloc(46);
    ce.writeUInt32LE(0x02014b50, 0); ce.writeUInt16LE(20, 4); ce.writeUInt16LE(20, 6);
    ce.writeUInt16LE(8, 10); ce.writeUInt32LE(c.length, 20); ce.writeUInt32LE(d.length, 24);
    ce.writeUInt16LE(nb.length, 28); ce.writeUInt32LE(off, 42);
    cen.push(ce, nb);
    off += 30 + nb.length + c.length;
  }
  const cd = Buffer.concat(cen), l = Buffer.concat(loc);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(ficheiros.length, 8); e.writeUInt16LE(ficheiros.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(l.length, 16);
  fs.writeFileSync(saida, Buffer.concat([l, cd, e]));
}

function pool(strings){
  const offsets=[]; const corpo=[];
  let off=0;
  for(const s of strings){
    offsets.push(off);
    const b=Buffer.from(s,'utf16le');
    // AXML UTF-16: comprimento de 16 bits (0x8000 indica comprimento alto,
    // nesse caso seguem mais 16 bits). NÃO são dois comprimentos.
    const lenBuf=Buffer.alloc(s.length > 0x7fff ? 4 : 2);
    if (s.length > 0x7fff) { lenBuf.writeUInt16LE(0x8000 | (s.length >> 16),0); lenBuf.writeUInt16LE(s.length & 0xffff,2); }
    else lenBuf.writeUInt16LE(s.length,0);
    corpo.push(lenBuf,b,Buffer.alloc(2)); // +NUL
    off += lenBuf.length+b.length+2;
  }
  const header=Buffer.alloc(28);
  const stringsBlob=Buffer.concat(corpo);
  const size=28+offsets.length*4+stringsBlob.length;
  header.writeUInt16LE(0x0001,0); header.writeUInt16LE(28,2); header.writeUInt32LE(size,4);
  header.writeUInt32LE(strings.length,8); header.writeUInt32LE(0,12); header.writeUInt32LE(0x000,16);
  header.writeUInt32LE(28+offsets.length*4,20); header.writeUInt32LE(0,24);
  const offBuf=Buffer.alloc(offsets.length*4);
  offsets.forEach((o,i)=>offBuf.writeUInt32LE(o,i*4));
  return Buffer.concat([header,offBuf,stringsBlob]);
}

function elemento(nomeIdx, attrs, stringsCount){
  // attr: {nameIdx, resId, type, data|stringIdx}
  const header=Buffer.alloc(16);
  const corpo=Buffer.alloc(20+attrs.length*20);
  corpo.writeUInt32LE(0xFFFFFFFF,0);           // ns
  corpo.writeUInt32LE(nomeIdx,4);
  corpo.writeUInt16LE(20,8);                    // attributeStart
  corpo.writeUInt16LE(20,10);                   // attributeSize
  corpo.writeUInt16LE(attrs.length,12);
  corpo.writeUInt16LE(0,14); corpo.writeUInt16LE(0,16); corpo.writeUInt16LE(0,18);
  attrs.forEach((a,i)=>{
    const b=20+i*20;
    corpo.writeUInt32LE(0xFFFFFFFF,b);           // ns
    corpo.writeUInt32LE(a.nameIdx,b+4);
    corpo.writeUInt32LE(a.rawValue!==undefined?a.rawValue:0xFFFFFFFF,b+8);
    corpo.writeUInt16LE(8,b+12); corpo.writeUInt8(0,b+14); corpo.writeUInt8(a.type||0x03,b+15);
    corpo.writeUInt32LE(a.data,b+16);
  });
  const size=16+corpo.length;
  header.writeUInt16LE(0x0102,0); header.writeUInt16LE(16,2); header.writeUInt32LE(size,4);
  header.writeUInt32LE(1,8); header.writeUInt32LE(0xFFFFFFFF,12);
  return Buffer.concat([header,corpo]);
}

function resmap(resIds){
  const header=Buffer.alloc(8);
  const corpo=Buffer.alloc(resIds.length*4);
  resIds.forEach((r,i)=>corpo.writeUInt32LE(r,i*4));
  header.writeUInt16LE(0x0180,0); header.writeUInt16LE(8,2); header.writeUInt32LE(8+corpo.length,4);
  return Buffer.concat([header,corpo]);
}

function build({pkg, versionName, versionCode}){
  // ordem das strings define os índices; o resMap é indexado pelo MESMO índice
  const strings=['manifest','package','versionCode','versionName',pkg,versionName,'com.pro.driver'];
  const p=pool(strings);
  const el=elemento(0, [
    {nameIdx:1, rawValue:4, type:0x03, data:4},          // package -> "com.pro.driver"
    {nameIdx:2, type:0x10, data:versionCode},
    {nameIdx:3, rawValue:5, type:0x03, data:5}
  ]);
  // o resMap tem de alinhar os índices dos atributos com os resource IDs
  const resIds=[];
  for(let i=0;i<strings.length;i++){
    if(i===2) resIds.push(RID_VERSION_CODE);
    else if(i===3) resIds.push(RID_VERSION_NAME);
    else resIds.push(0);
  }
  const rm2=resmap(resIds);
  const header=Buffer.alloc(8);
  const corpo=Buffer.concat([p,rm2,el]);
  header.writeUInt16LE(0x0003,0); header.writeUInt16LE(8,2); header.writeUInt32LE(8+corpo.length,4);
  return Buffer.concat([header,corpo]);
}

module.exports = { build, zip };
