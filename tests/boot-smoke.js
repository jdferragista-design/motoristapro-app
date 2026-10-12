/**
 * Smoke test de boot do MotoristaPro (jsdom).
 * Uso: npm test  (inicia um servidor estático interno em porta aleatória)
 *
 * Valida:
 *  1. O app arranca sem erros de runtime;
 *  2. Ecrãs de login e de primeiro uso aparecem quando devem;
 *  3. "Começar do zero" limpa a demo;
 *  4. Lucro unificado: painel === fechamento WhatsApp (período "tudo");
 *  5. Odômetro aceita 0;
 *  6. Rótulo dinâmico do Fundo de Reserva.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const WWW = path.join(__dirname, '..', 'www');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json'
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const file = path.join(WWW, rel);
  if (!file.startsWith(WWW) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

let failures = 0;
const out = (k, v) => console.log(k + ':', v);
const check = (label, cond, detail) => {
  console.log((cond ? '✅ ' : '❌ ') + label + (detail !== undefined ? ' → ' + detail : ''));
  if (!cond) failures++;
};

server.listen(0, '127.0.0.1', () => {
  const URL = `http://127.0.0.1:${server.address().port}/index.html`;
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const msg = String((e && e.message) || e);
    if (/Could not load|stylesheet|css/i.test(msg)) return;
    errors.push('jsdomError: ' + msg);
  });
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
  vc.on('warn', () => {});

  const opts = { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc };
  // jsdom não implementa innerText (expando): preferir, com fallback p/ textContent.
  // Intl pt-BR usa NBSP (U+00A0) depois de "R$" → normalizar para comparações.
  const norm = s => String(s == null ? '' : s).replace(/\u00a0/g, ' ');
  const txt = (d, id) => {
    const el = d.getElementById(id);
    if (!el) return null;
    return norm(el.innerText !== undefined ? el.innerText : el.textContent);
  };

  JSDOM.fromURL(URL, opts).then(dom => {
    setTimeout(() => {
      const w = dom.window;
      const d = w.document;
      const g = id => d.getElementById(id);

      check('boot concluído', w.__MP_BOOTED === true);
      check('login NÃO bloqueia abertura', g('mpLoginScreen').style.display !== 'flex');
      check('primeiro uso visível sem dados', g('mpFirstUseScreen').style.display === 'flex');
      check('rótulo dinâmico da reserva', /Fundo de Reserva \(R\$ [\d,]+\/km\)/.test(txt(d, 'healthReserveLabel')), txt(d, 'healthReserveLabel'));

      w.mpFirstUse('zero');
      check('zero oculta ecrã de primeiro uso', g('mpFirstUseScreen').style.display === 'none');
      check('zero zera o lucro do painel', txt(d, 'dashNet') === 'R$ 0,00', txt(d, 'dashNet'));
      check('zero zera o lucro do WhatsApp', /LUCRO LÍQUIDO REAL: R\$ 0,00/.test(txt(d, 'whatsappBox') || ''));
      check('zero esconde carro demo', (g('topCarInfo').innerText || '').startsWith(' • '), g('topCarInfo').innerText);

      // Estado demo novo + período "tudo": painel e WhatsApp têm de coincidir
      JSDOM.fromURL(URL, opts).then(dom2 => {
        setTimeout(() => {
          const w2 = dom2.window;
          const d2 = w2.document;
          w2.mpFirstUse('demo');
          w2.setDashPeriod('all');
          const dashNet = txt(d2, 'dashNet');
          const wa = txt(d2, 'whatsappBox') || '';
          const m = wa.match(/LUCRO LÍQUIDO REAL: ([^\n*]+)/);
          const waNet = m ? m[1].trim() : 'N/A';
          check('painel = WhatsApp (lucro unificado)', String(dashNet).replace(/\s/g, '') === String(waNet).replace(/\s/g, ''), `${dashNet} vs ${waNet}`);
          check('WhatsApp indica o período', /📅 Período:/.test(wa));

          d2.getElementById('cfgOdo').value = '0';
          w2.saveSettings({ preventDefault() {} });
          check('odômetro aceita 0', w2.eval('state.vehicle.odometer') === 0);

          check('sem erros de runtime', errors.length === 0, errors.length ? errors.slice(0, 5) : 'nenhum');

          server.close();
          process.exit(failures ? 1 : 0);
        }, 1800);
      });
    }, 1800);
  }).catch(e => { console.error('FATAL', e); server.close(); process.exit(1); });
});
