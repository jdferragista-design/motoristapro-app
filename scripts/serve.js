#!/usr/bin/env node
// Servidor estático de desenvolvimento para a preview do app.
//
// Porque existe: `python3 -m http.server` servia a pasta, mas (a) devolve 304
// com base em Last-Modified, e o browser do preview fica a reutilizar JS antigo
// entre turnos, e (b) não distingue o MIME de alguns ficheiros. Aqui os ficheiros
// de código são sempre servidos com no-store, que é o mesmo que o index.html já
// tenta forçar (sw.js?t=…, caches.delete).
//
// Não é um servidor de produção: serve apenas www/ em modo leitura.
//
// Uso:  node scripts/serve.js [porta]
//       PORT=8080 node scripts/serve.js

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', 'www');
const PORTA = Number(process.env.PORT || process.argv[2] || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

// Cache: o HTML, os scripts e o service worker nunca podem vir do cache, senão
// a preview mostra o build anterior. Imagens podem ser cacheadas um pouco.
const SEM_CACHE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest']);

function resolver(urlPath) {
  // Ignora a query (?v=28) e descodifica eventuais %20.
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const alvo = path.join(RAIZ, path.normalize(rel));
  // Impede sair de www/ (../.. e caminhos absolutos).
  if (alvo !== RAIZ && !alvo.startsWith(RAIZ + path.sep)) return null;
  return alvo;
}

function enviar(req, res, ficheiro, estatuto) {
  const ext = path.extname(ficheiro).toLowerCase();
  const cabecalhos = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': SEM_CACHE.has(ext) ? 'no-store, must-revalidate' : 'public, max-age=300',
    'Content-Length': estatuto === 200 ? fs.statSync(ficheiro).size : 0
  };
  // Sem CSP nem X-Frame-Options: o app usa scripts inline e tem de poder ser
  // embutido no iframe da preview.
  res.writeHead(estatuto, cabecalhos);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(ficheiro).on('error', () => res.end()).pipe(res);
}

const servidor = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    return res.end('Método não suportado');
  }

  const alvo = resolver(req.url || '/');
  if (!alvo) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Fora da pasta servida');
  }

  fs.stat(alvo, (err, info) => {
    if (!err && info.isFile()) {
      console.log(`${req.method} ${req.url} → 200 ${path.relative(RAIZ, alvo)}`);
      return enviar(req, res, alvo, 200);
    }
    // Diretório → index.html lá dentro; rota sem extensão → index.html (o app
    // usa navegação por hash, isto é só uma rede de segurança).
    const semExtensao = !path.extname(alvo);
    const fallback = semExtensao ? path.join(RAIZ, 'index.html') : null;
    if (fallback && fs.existsSync(fallback)) {
      console.log(`${req.method} ${req.url} → 200 index.html (fallback)`);
      return enviar(req, res, fallback, 200);
    }
    console.log(`${req.method} ${req.url} → 404`);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Não encontrado');
  });
});

servidor.listen(PORTA, HOST, () => {
  console.log(`MotoristaPro (www/) em http://${HOST}:${PORTA}`);
  console.log(`Raiz: ${RAIZ}`);
});

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => servidor.close(() => process.exit(0)));
}
