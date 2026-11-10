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

  JSDOM.fromURL(URL, opts).then(async dom => {
    setTimeout(async () => {
      const w = dom.window;
      const d = w.document;
      const g = id => d.getElementById(id);

      check('boot concluído', w.__MP_BOOTED === true);
      // Fase 3: sem sessão guardada o arranque NÃO libera a área financeira.
      check('login bloqueia abertura sem sessão', g('mpLoginScreen').style.display === 'flex');
      check('área financeira fica fechada no arranque',
        d.documentElement.getAttribute('data-mp-locked') === '1' &&
        !!d.querySelector('main.container[inert]'));
      check('primeiro uso visível sem dados', g('mpFirstUseScreen').style.display === 'flex');
      check('rótulo dinâmico da reserva', /Fundo de Reserva \(R\$ [\d,]+\/km\)/.test(txt(d, 'healthReserveLabel')), txt(d, 'healthReserveLabel'));

      w.mpFirstUse('zero');
      check('zero oculta ecrã de primeiro uso', g('mpFirstUseScreen').style.display === 'none');
      check('zero zera o lucro do painel', txt(d, 'dashNet') === 'R$ 0,00', txt(d, 'dashNet'));
      check('zero zera o lucro do WhatsApp', /LUCRO LÍQUIDO REAL: R\$ 0,00/.test(txt(d, 'whatsappBox') || ''));
      check('zero esconde carro demo', (g('topCarInfo').innerText || '').startsWith(' • '), g('topCarInfo').innerText);

      // Estado demo novo + período "tudo": painel e WhatsApp têm de coincidir
      JSDOM.fromURL(URL, opts).then(dom2 => {
        setTimeout(async () => {
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

          // ---------- P0: ociosidade entre turnos (R$/h honesto) ----------
          check('ociosidade entre turnos (2 turnos, 2h de gap)',
            w2.eval(`getIdleMinutes([
              {date:'2026-05-01',timeStart:'06:00',timeEnd:'09:00'},
              {date:'2026-05-01',timeStart:'11:00',timeEnd:'14:00'}])`) === 120);
          check('ociosidade entre dias diferentes não conta',
            w2.eval(`getIdleMinutes([
              {date:'2026-05-01',timeStart:'06:00',timeEnd:'09:00'},
              {date:'2026-05-02',timeStart:'11:00',timeEnd:'14:00'}])`) === 0);
          check('turnos sobrepostos não geram ociosidade negativa',
            w2.eval(`getIdleMinutes([
              {date:'2026-05-01',timeStart:'06:00',timeEnd:'12:00'},
              {date:'2026-05-01',timeStart:'09:00',timeEnd:'14:00'}])`) === 0);

          // ---------- P0: despesa recorrente (o que o usuário esquece) ----------
          w2.eval(`state.recurring = [{ id: 501, nome: 'Internet', valor: 123.71,
            categoria: 'fixo', periodicidade: 'bimestral', diaVencimento: 21,
            competenciaInicio: '2026-01', ativo: true }]; state.expenses = [];`);
          check('custo fixo mensal normaliza bimestral (÷2)',
            Math.abs(w2.eval('getCustoFixoMensal()') - 61.855) < 0.01,
            w2.eval('getCustoFixoMensal()'));
          const criadas = w2.eval('syncRecurringExpenses()');
          check('recorrente bimestral gera lançamentos', criadas > 0, criadas);
          check('sync recorrente é idempotente (2ª execução não cria nada)',
            w2.eval('syncRecurringExpenses()') === 0);
          check('recorrente aparece na competência do mês',
            w2.eval(`expensesInCompetence(state.expenses, '2026-01').length`) === 1);

          // reconciliação: não duplicar o que o usuário já digitou à mão
          w2.eval(`state.recurring = [{ id: 502, nome: 'Prestação do carro', valor: 3147.57,
            categoria: 'fixo', periodicidade: 'mensal', diaVencimento: 5,
            competenciaInicio: '2026-03', ativo: true }];
            state.expenses = [{ id: 1, date: '2026-03-27', competencia: '2026-03', category: 'fixo',
              title: 'Prestação do carro parcela 12/60 desconto 24.59', amount: 3122.98 }];`);
          w2.eval('syncRecurringExpenses()');
          check('não duplica despesa fixa que já existia (reconcilia por título)',
            w2.eval(`expensesInCompetence(state.expenses, '2026-03').length`) === 1);

          // ---------- P0: provisão × manutenção real (mesmo dinheiro) ----------
          check('manutenção real consome a provisão, não soma',
            w2.eval(`(() => {
              state.vehicle.maintenanceReservePerKm = 0.25;
              const p = costPartsForRange(
                [{ date: '2026-06-10', apps: [{ gross: 1000, tips: 0 }], km: 1000, hours: 10, fuelCost: 0 }],
                [{ id: 2, date: '2026-06-15', competencia: '2026-06', category: 'manutencao', title: 'Pneus', amount: 200 }],
                '2026-06-01', '2026-06-30');
              return p.reserveConsumedC === 20000 && p.reserveOpenC === 5000 && p.excessMaintC === 0;
            })()`) === true);

          // ---------- P0: competência (pagamento adiantado) ----------
          check('competência separa pagamento de mês do custo',
            w2.eval(`competenceOf({ date: '2026-10-27', competencia: '2026-11' })`) === '2026-11');

          // ---------- P1: configs aceitam 0 ----------
          d2.getElementById('cfgReserve').value = '0,00';
          d2.getElementById('cfgMonthlyGoal').value = '0';
          w2.saveSettings({ preventDefault() {} });
          check('provisão aceita 0 (não reverte para 0,18)',
            w2.eval('state.vehicle.maintenanceReservePerKm') === 0);
          check('meta aceita 0 (não reverte para 7.000)',
            w2.eval('state.vehicle.monthlyGoal') === 0);

          // ---------- Compras parceladas (valor total ÷ N) ----------
          check('parcela divide exato: 2.828,17 em 10x = 282,81 + 1ª com 7 centavos',
            w2.eval('parcelaCents(2828.17, 10)') === 28281 &&
            w2.eval('installmentAmountC({valorTotal:2828.17,numParcelas:10}, 1)') === 28288);
          check('soma das parcelas bate exatamente com o total pago',
            w2.eval(`(() => {
              const p = {valorTotal: 2828.17, numParcelas: 10};
              let s = 0;
              for (let i = 1; i <= p.numParcelas; i++) s += installmentAmountC(p, i);
              return s;
            })()`) === 282817);
          check('parcela única não inventa divisão',
            w2.eval('installmentAmountC({valorTotal:500,numParcelas:1}, 1)') === 50000);

          w2.eval(`state.installments = [{ id: 700, nome: 'Pneus', valorTotal: 2828.17,
            numParcelas: 10, categoria: 'manutencao', competenciaInicio: '2026-01',
            diaVencimento: 10, ativo: true }]; state.expenses = [];`);
          const parCriadas = w2.eval('syncInstallmentExpenses()');
          check('parcelada gera uma despesa por mês já vencido', parCriadas > 0, parCriadas);
          check('sync de parcelas é idempotente',
            w2.eval('syncInstallmentExpenses()') === 0);
          // NOTA: dentro de template literal, \d viraria d — a regex precisa
          // de quatro barras para chegar ao eval como \d.
          check('cada parcela tem competência própria e numeração', w2.eval(`(() => {
              const ps = state.expenses.filter(e => e.parcelaId === 700);
              return ps.every(e => /^\\d{4}-\\d{2}$/.test(e.competencia) && e.parcelaNumero >= 1)
                && new Set(ps.map(e => e.competencia)).size === ps.length;
            })()`) === true);
          check('parcela não é lançada em mês futuro',
            w2.eval(`state.expenses.filter(e => e.parcelaId === 700)
              .every(e => e.competencia <= getTodayString().slice(0,7))`) === true);

          // Reconciliação: parcelas já lançadas à mão NÃO são duplicadas.
          // Cenário real do usuário: pneus R$ 2.828,17 em 10x de 282,82,
          // já lançados um a um em jul..nov.
          check('parcelada reconcilia o que já foi digitado à mão', w2.eval(`(() => {
            const manuais = [
              { id: 'm1', date: '2026-07-10', competencia: '2026-07', category: 'manutencao', title: 'Pneus 1/10', amount: 282.82 },
              { id: 'm2', date: '2026-08-10', competencia: '2026-08', category: 'manutencao', title: 'Pneus 2/10', amount: 282.82 },
              { id: 'm3', date: '2026-09-10', competencia: '2026-09', category: 'manutencao', title: 'Pneus 3/10', amount: 282.82 }
            ];
            state.expenses = manuais.slice();
            state.installments = [{ id: 800, nome: 'Pneus', valorTotal: 2828.17,
              numParcelas: 10, categoria: 'manutencao', competenciaInicio: '2026-07',
              diaVencimento: 10, ativo: true }];
            syncInstallmentExpenses();
            const doMesmo = (ym) => state.expenses.filter(e => e.competencia === ym).length;
            const manual = (id) => state.expenses.find(e => e.id === id);
            // jul/ago/set continuam com 1 lançamento cada: o manual, agora vinculado
            return doMesmo('2026-07') === 1 && doMesmo('2026-08') === 1 && doMesmo('2026-09') === 1
              && manual('m1').parcelaId === 800 && manual('m1').parcelaNumero === 1
              && manual('m2').parcelaNumero === 2 && manual('m3').parcelaNumero === 3
              && state.expenses.filter(e => e.id === 'm1' || e.id === 'm2' || e.id === 'm3').length === 3;
          })()`) === true);

          // ---------- Modelos pré-cadastrados ----------
          check('preset não duplica: cadastrar prestação 2x cria 1',
            w2.eval(`(() => {
              state.recurring = []; state.expenses = [];
              addRecurringPreset('prestacao');
              addRecurringPreset('prestacao');
              return state.recurring.length;
            })()`) === 1);
          check('preset usa o valor real do usuário (3.147,57)',
            w2.eval("state.recurring.find(r=>r.nome==='Prestação do carro').valor") === 3147.57);

          // ---------- Guarda contra dupla contagem fixa x parcelada ----------
          check('não deixa a mesma despesa ser fixa e parcelada ao mesmo tempo',
            w2.eval(`(() => {
              const alertas = [];
              const alertOriginal = window.alert;
              window.alert = (m) => alertas.push(m);
              state.recurring = []; state.installments = []; state.expenses = [];
              addRecurringPreset('prestacao');                    // ok
              const antes = state.recurring.length;
              // tenta cadastrar a MESMA prestação como parcelada
              const criou = saveInstallmentFromValues({
                nome: 'Prestação do carro', valorTotal: 188854.20, numParcelas: 60,
                categoria: 'fixo', competenciaInicio: '2025-10', diaVencimento: 5
              });
              window.alert = alertOriginal;
              return antes === 1 && criou === false && alertas.length === 1
                && (state.installments || []).length === 0;
            })()`) === true);

          // ---------- Lançamentos órfãos não ficam no histórico ----------
          check('excluir a origem apaga os lançamentos gerados',
            w2.eval(`(() => {
              state.recurring = [{ id: 900, nome: 'Teste', valor: 100,
                categoria: 'fixo', periodicidade: 'mensal', diaVencimento: 1,
                competenciaInicio: '2026-01', ativo: true }];
              state.expenses = []; syncRecurringExpenses();
              const antes = state.expenses.length;
              state.recurring = [];
              const removidos = pruneOrphanGeneratedExpenses();
              return antes > 0 && removidos === antes && state.expenses.length === 0;
            })()`) === true);

          // ---------- Nomes de app: variantes não partem o histórico ----------
          check('"99Pop / 99" vira "99Pop" na migração', w2.eval(`(() => {
            const m = migrateState({ shifts: [{ date: '2026-05-01', apps: [
              { name: '🚕 99Pop', gross: 100, trips: 2 },
              { name: '🚕 99Pop / 99', gross: 50, trips: 1 }
            ]}]});
            const nomes = m.shifts[0].apps.map(a => a.name);
            return nomes.length === 2 && nomes.every(n => n === '🚕 99Pop');
          })()`) === true);
          check('nomes fora do alias não são tocados', w2.eval(`(() => {
            const m = migrateState({ shifts: [{ date: '2026-05-01', apps: [
              { name: '🚗 Uber', gross: 10, trips: 1 },
              { name: '🚙 InDrive', gross: 10, trips: 1 }
            ]}]});
            return m.shifts[0].apps.map(a => a.name).join('|') === '🚗 Uber|🚙 InDrive';
          })()`) === true);

          // ---------- SYNC: as regras que evitam apagar histórico ----------
          // Antes: if (String(row.updated_at) > lastSync) adotava a nuvem.
          // Com lastSync '' (aparelho novo/reinstalado) isso é sempre verdade,
          // então qualquer estado remoto — mesmo vazio — substituía o local.
          check('timestamp vazio não é "mais novo" que nada', w2.eval(`
            (() => {
              const remoto = mpParseTime('2026-11-08T21:30:00+00:00');
              const lastSync = mpParseTime(localStorage.getItem('nao_existe_xyz'));
              return lastSync === null && (lastSync === null || remoto > lastSync) === true;
            })()`) === true);
          check('mpParseTime rejeita lixo (não trata como data)', w2.eval(`
            mpParseTime('') === null && mpParseTime(null) === null &&
            mpParseTime('banana') === null && mpParseTime('2026-11-08T00:00:00Z') > 0`) === true);

          check('união por id não perde turnos de nenhum lado', w2.eval(`
            (() => {
              const local  = [{id:'a'},{id:'b'},{id:'c'}];
              const remoto = [{id:'a'},{id:'d'}];
              const r = mpMergeLists(local, remoto);
              const ids = r.lista.map(x=>x.id).sort().join(',');
              return ids === 'a,b,c,d' && r.recuperados === 2;
            })()`) === true);

          check('estado local NUNCA é substituído por nuvem vazia', w2.eval(`
            (() => {
              const local = { shifts: [{id:1},{id:2}], expenses: [], maintenance: [] };
              const remotoVazio = { shifts: [], expenses: [], maintenance: [] };
              // simula a decisão: !remotoTemDados && localTemDados -> push, não adota
              return mpLocalHasData(local) === true && mpLocalHasData(remotoVazio) === false;
            })()`) === true);

          check('junção preserva o veículo com odómetro mais avançado', w2.eval(`
            (() => {
              const local  = { shifts: [], vehicle: { odometer: 115000 }, fuelSettings: { a: 1 } };
              const remoto = { shifts: [], vehicle: { odometer: 100000 }, fuelSettings: { a: 2 } };
              const r = mpMergeStates(local, remoto);
              return r.estado.vehicle.odometer === 115000 && r.estado.fuelSettings.a === 1;
            })()`) === true);

          check('junção não duplica ids iguais', w2.eval(`
            (() => {
              const r = mpMergeStates(
                { shifts: [{id:'x', gross: 10}] },
                { shifts: [{id:'x', gross: 10}] });
              return r.estado.shifts.length === 1 && r.recuperados === 0;
            })()`) === true);

          // ---------- Service worker: código nunca cache-first ----------
          const swSrc = fs.readFileSync(path.join(WWW, 'sw.js'), 'utf8');
          check('sw.js serve JS/CSS pela rede primeiro', /const NETWORK_FIRST = \/\\\/\(js\|css\)/.test(swSrc));
          check('cache do sw tem versão explícita (bump manual)', /const CACHE = 'motoristapro-v\d+'/.test(swSrc));
          check('config.js aponta para o projeto atual', (() => {
            const cfg = fs.readFileSync(path.join(WWW, 'js', 'config.js'), 'utf8');
            return /xncxzczftetctpazzecu/.test(cfg) && !/ewmtphddypfcllewkgzl/.test(cfg);
          })());

          // A versão mostrada tem de vir do código, não de texto fixo no HTML.
          // O cabeçalho dizia "v1.18" hardcoded: nunca mudava, e por isso um
          // utilizador preso em cache antiga E um com cache nova viam o mesmo.
          check('versão do cabeçalho é a real (não texto fixo)', (() => {
            const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
            const el = d2.getElementById('brandVersion');
            return /id="brandVersion"/.test(html) && !!el && el.textContent === w2.eval('APP_VERSION');
          })());
          check('a versão não voltou a ser hardcoded no cabeçalho',
            !/class="brand-title">Motorista<span>Pro<\/span>\s*<span[^>]*>v\d/.test(
              fs.readFileSync(path.join(WWW, 'index.html'), 'utf8')));

          // O install do SW tem de ignorar o HTTP cache do browser; sem
          // cache:'reload', uma cache nova enchia-se com ficheiros velhos.
          check('install do sw usa cache reload (não herda ficheiros velhos)', (() => {
            const sw = fs.readFileSync(path.join(WWW, 'sw.js'), 'utf8');
            return /new Request\(url, \{ cache: 'reload' \}\)/.test(sw);
          })());
          check('sw não reescreve a cache de JS/CSS a cada visita', (() => {
            const sw = fs.readFileSync(path.join(WWW, 'sw.js'), 'utf8');
            const blocoCodigo = sw.slice(sw.indexOf('if (ehCodigo)'), sw.indexOf('Restantes assets'));
            return !/cache\.put/.test(blocoCodigo);
          })());

          // Auto-resgate: se o JS não carregar, o HTML limpa a cache e
          // recarrega sozinho uma vez (com marcador para não entrar em loop).
          check('HTML tem auto-resgate de cache com marcador anti-loop', (() => {
            const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
            return /mp_selfheal_v1/.test(html) && /caches\.delete/.test(html)
              && /location\.replace/.test(html);
          })());
          check('query strings dos scripts não ficam para trás', (() => {
            const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
            const versoes = [...html.matchAll(/\.(?:js|css)\?v=(\d+)/g)].map(m => m[1]);
            return versoes.length > 5 && new Set(versoes).size === 1;
          })());

          // ============================================================
          // FASE 2 — C-01: manutenção inválida não pode derrubar o render
          // ============================================================
          check('C-01: migrateState normaliza manutenção sem interval', w2.eval(`
            (() => {
              const m = migrateState({ maintenance: [
                { id: 1, name: 'X' },
                { id: 2, name: 'Y', interval: null, lastKm: null },
                { id: 3, name: 'Z', interval: '10000', lastKm: '5000' }
              ]});
              return m.maintenance.every(x =>
                Number.isFinite(x.interval) && x.interval > 0 &&
                Number.isFinite(x.lastKm) && x.lastKm >= 0 &&
                typeof x.name === 'string');
            })()`) === true);
          check('C-01: manutenção inválida NÃO impede render()', w2.eval(`
            (() => {
              const bk = JSON.parse(JSON.stringify(state));
              try {
                state.maintenance.push({ id: 99, name: 'Sem interval' });
                render();
                return true;
              } catch (e) {
                return false;
              } finally {
                state = bk; render();
              }
            })()`) === true);
          check('C-01: os outros blocos continuam a renderizar quando um falha', w2.eval(`
            (() => {
              const bk = JSON.parse(JSON.stringify(state));
              try {
                state.shifts.push({ id: 'quebrado', date: '2026-11-01', apps: [], km: 1, hours: 1, fuelCost: 0 });
                state.maintenance.push({ id: 98, name: null, interval: undefined });
                render();
                // o painel tem de refletir o turno novo apesar da manutenção inválida
                return document.getElementById('dashGross').innerText.length > 0;
              } catch (e) { return false; }
              finally { state = bk; render(); }
            })()`) === true);

          // ============================================================
          // FASE 2 — M-04: falha de persistência não anuncia sucesso
          // ============================================================
          check('M-04: saveState devolve false quando a gravação falha', w2.eval(`
            (() => {
              // jsdom implementa Storage como Proxy: substituir setItem não tem
              // efeito. O ponto de gravação (mpLocalSet) é a costura de teste.
              const original = mpLocalSet;
              mpLocalSet = () => { throw new Error('QuotaExceededError'); };
              let ok;
              try { ok = saveState(); } finally { mpLocalSet = original; }
              return ok === false && lastPersistError !== null;
            })()`) === true);
          check('M-04: saveState devolve true no caminho normal', w2.eval(`
            (() => { const ok = saveState();
              return ok === true && lastPersistError === null; })()`) === true);
          check('M-04: sync para nuvem NÃO é agendado após falha local', w2.eval(`
            (() => {
              let agendado = 0;
              const orig = scheduleCloudSync;
              scheduleCloudSync = () => { agendado++; };
              const origSet = mpLocalSet;
              mpLocalSet = () => { throw new Error('quota'); };
              try { saveState(); } finally { mpLocalSet = origSet; scheduleCloudSync = orig; }
              return agendado === 0;
            })()`) === true);

          // ============================================================
          // FASE 2 — C-02: backup rotativo de 3 cópias
          // ============================================================
          check('C-02: rotação mantém exatamente 3 cópias', w2.eval(`
            (() => {
              ['1','2','3','pre_restore'].forEach(s => localStorage.removeItem('mp_backup_v8_' + s));
              state.shifts = [{ id: 'a' }];
              const r1 = mpBackupRotate();
              state.shifts = [{ id: 'a' }, { id: 'b' }];
              const r2 = mpBackupRotate();
              state.shifts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
              const r3 = mpBackupRotate();
              state.shifts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
              const r4 = mpBackupRotate();
              const n = mpBackupList().length;
              const slots = mpBackupList().map(b => b.slot).sort().join(',');
              return r1.ok && r4.ok && n === 3 && slots === '1,2,3';
            })()`) === true);
          check('C-02: a cópia 1 é sempre a mais recente', w2.eval(`
            (() => {
              ['1','2','3','pre_restore'].forEach(s => localStorage.removeItem('mp_backup_v8_' + s));
              state.shifts = [{ id: 'um' }]; mpBackupRotate();
              state.shifts = [{ id: 'um' }, { id: 'dois' }]; mpBackupRotate();
              const c1 = mpBackupList().find(b => b.slot === 1);
              const c2 = mpBackupList().find(b => b.slot === 2);
              return c1.stats.turnos === 2 && c2.stats.turnos === 1;
            })()`) === true);
          check('C-02: estado vazio não ocupa slot', w2.eval(`
            (() => {
              ['1','2','3','pre_restore'].forEach(s => localStorage.removeItem('mp_backup_v8_' + s));
              const bk = JSON.parse(JSON.stringify(state));
              state.shifts = []; state.expenses = []; state.maintenance = [];
              const r = mpBackupRotate();
              state = bk;
              return r.ok === false && mpBackupList().length === 0;
            })()`) === true);
          check('C-02: restauro recupera o histórico e é reversível', w2.eval(`
            (() => {
              ['1','2','3','pre_restore'].forEach(s => localStorage.removeItem('mp_backup_v8_' + s));
              const bk = JSON.parse(JSON.stringify(state));
              state.shifts = [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }];
              state.expenses = [{ id: 'e1', date: '2026-11-01', amount: 10, category: 'outros', title: 'x' }];
              mpBackupRotate();
              // simula perda: estado vazio
              state.shifts = []; state.expenses = [];
              const r = mpBackupRestore(1);
              const recuperado = state.shifts.length;
              // desfazer volta ao estado vazio guardado antes do restauro
              const u = mpBackupUndoRestore();
              const desfeito = state.shifts.length;
              state = bk; render();
              return r.ok === true && recuperado === 3 && u.ok === true && desfeito === 0;
            })()`) === true);
          check('C-02: restauro recusa cópia vazia', w2.eval(`
            (() => {
              localStorage.setItem('mp_backup_v8_1', JSON.stringify({ at: new Date().toISOString(),
                state: { shifts: [], expenses: [], maintenance: [] } }));
              const r = mpBackupRestore(1);
              localStorage.removeItem('mp_backup_v8_1');
              return r.ok === false && /vazia/.test(r.motivo);
            })()`) === true);
          check('C-02: painel lista as cópias existentes', w2.eval(`
            (() => {
              ['1','2','3','pre_restore'].forEach(s => localStorage.removeItem('mp_backup_v8_' + s));
              state.shifts = [{ id: 'p1' }];
              onForceBackup();
              const box = document.getElementById('backupListBox');
              const txt = (box.innerText !== undefined ? box.innerText : box.textContent) || '';
              return /Cópia 1/.test(txt) && /Restaurar/.test(txt) && /Nenhuma cópia/.test(txt) === false;
            })()`) === true);
          check('C-02: botão de restauro funciona pela UI (com confirmação)', w2.eval(`
            (() => {
              ['1','2','3','pre_restore'].forEach(s => localStorage.removeItem('mp_backup_v8_' + s));
              const bk = JSON.parse(JSON.stringify(state));
              state.shifts = [{ id: 'b1' }, { id: 'b2' }];
              onForceBackup();          // cópia com 2 turnos
              state.shifts = [{ id: 'b1' }];  // estado atual com 1
              const confirmOriginal = confirm;
              confirm = () => true;
              const notifyOriginal = mpNotify;
              let aviso = '';
              mpNotify = (m, tipo) => { aviso = m + '|' + (tipo || ''); };
              try { onRestoreBackup(1); } finally { confirm = confirmOriginal; mpNotify = notifyOriginal; }
              const turnos = state.shifts.length;
              state = bk; render();
              return turnos === 2 && /restaurada/i.test(aviso);
            })()`) === true);
          check('C-02: lista reflete escrita e remoção externas (cache coerente)', w2.eval(`
            (() => {
              ['1','2','3','pre_restore'].forEach(s => localStorage.removeItem('mp_backup_v8_' + s));
              mpBackupList(); // aquece a cache
              localStorage.setItem('mp_backup_v8_2', JSON.stringify({ at: new Date().toISOString(),
                state: { shifts: [{ id: 'e1' }], expenses: [], maintenance: [] } }));
              const comCopia = mpBackupList().map(b => b.slot).join(',');
              localStorage.removeItem('mp_backup_v8_2');
              const semCopia = mpBackupList().length;
              return comCopia === '2' && semCopia === 0;
            })()`) === true);
          check('C-02: restauro falha de forma visível quando a gravação não passa', w2.eval(`
            (() => {
              ['1','2','3','pre_restore'].forEach(s => localStorage.removeItem('mp_backup_v8_' + s));
              const bk = JSON.parse(JSON.stringify(state));
              state.shifts = [{ id: 'r1' }];
              onForceBackup();
              state.shifts = [];
              const original = mpLocalSet;
              mpLocalSet = () => { throw new Error('quota'); };
              let r;
              try { r = mpBackupRestore(1); } finally { mpLocalSet = original; }
              state = bk;
              for (const s of ['1','2','3','pre_restore']) localStorage.removeItem('mp_backup_v8_' + s);
              render();
              return r.ok === false && /quota/.test(r.motivo);
            })()`) === true);
          check('C-02: backup nunca altera o estado atual', w2.eval(`
            (() => {
              const antes = JSON.stringify(state.shifts);
              mpBackupRotate();
              return JSON.stringify(state.shifts) === antes;
            })()`) === true);

          // ============================================================
          // FASE 2 — M-06: todos os <label> de formulário apontam para o campo
          // (57 originais + 9 da janela de autenticação: entrar, criar conta,
          //  esqueci e redefinir senha)
          // ============================================================
          check('M-06: 66 labels associados a um campo existente', w2.eval(`
            (() => {
              const labels = Array.from(document.querySelectorAll('label'));
              const semFor = labels.filter(l => !l.getAttribute('for'));
              const orfaos = labels.filter(l => l.getAttribute('for') && !document.getElementById(l.getAttribute('for')));
              return { total: labels.length, semFor: semFor.length, orfaos: orfaos.length };
            })()`).total === 66);
          check('M-06: nenhum label sem for= nem a apontar para id inexistente', w2.eval(`
            (() => {
              const labels = Array.from(document.querySelectorAll('label'));
              return labels.every(l => {
                const alvo = l.getAttribute('for');
                return alvo ? !!document.getElementById(alvo) : l.querySelector('input,select,textarea') !== null;
              });
            })()`) === true);
          // O jsdom não implementa a ativação de <label> (verificado: click em
          // label com for= não move o foco), por isso a asserção é estrutural:
          // o for= tem de ser o id do primeiro campo que vem a seguir ao label.
          check('M-06: o for= corresponde ao campo imediatamente a seguir', w2.eval(`
            (() => {
              const comFor = Array.from(document.querySelectorAll('label[for]'));
              const mal = comFor.filter(l => {
                let n = l.nextElementSibling;
                if (n && /^(input|select|textarea)$/i.test(n.tagName)) return n.id !== l.getAttribute('for');
                if (!n) return true;
                const campo = n.querySelector('input,select,textarea');
                return !campo || campo.id !== l.getAttribute('for');
              });
              return { total: comFor.length, mal: mal.map(l => l.getAttribute('for')) };
            })()`).mal.length === 0);

          // ============================================================
          // FASE 2 — M-07: idioma declarado
          // ============================================================
          check('M-07: <html lang> = pt-BR', w2.eval('document.documentElement.lang') === 'pt-BR');

          // ============================================================
          // FASE 2 — A-05/M-09: versão única e versionCode incremental
          // ============================================================
          const versaoPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
          check('A-05: UI mostra a versão do package.json', w2.eval('APP_VERSION') === 'v' + versaoPkg,
            w2.eval('APP_VERSION') + ' vs v' + versaoPkg);
          check('A-05: meta app-version == package.json', w2.eval(`document.querySelector('meta[name="app-version"]').content`) === versaoPkg);
          const gradle = fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'build.gradle'), 'utf8');
          const [vmaj, vmin, vpat] = versaoPkg.split('.').map(Number);
          const vcEsperado = vmaj * 10000 + vmin * 100 + vpat;
          check('A-05: versionCode derivado da versão (não fixo em 1)', Number((/versionCode\s+(\d+)/.exec(gradle) || [])[1]) === vcEsperado,
            (/versionCode\s+(\d+)/.exec(gradle) || [])[1] + ' vs ' + vcEsperado);
          check('M-09: versionName == package.json', (/versionName\s+"([^"]*)"/.exec(gradle) || [])[1] === versaoPkg,
            (/versionName\s+"([^"]*)"/.exec(gradle) || [])[1]);
          check('A-05: versionCode > 1 (permite atualização na Play Store)', vcEsperado > 1);

          // ============================================================
          // APK — assinatura debug persistente (atualiza por cima)
          // Sem signingConfigs o CI gerava uma chave aleatória por run e o
          // Android recusava instalar por cima ("signatures do not match").
          // ============================================================
          const keystoreP12 = path.join(__dirname, '..', 'android', 'app', 'motoristapro-debug.p12');
          check('APK: keystore de assinatura persistente existe e não está vazio',
            fs.existsSync(keystoreP12) && fs.statSync(keystoreP12).size > 0);
          check('APK: build.gradle usa o keystore persistente no signingConfigs debug',
            /signingConfigs\s*\{[\s\S]*?motoristapro-debug\.p12/.test(gradle) &&
            /keyAlias\s+['"]androiddebugkey['"]/.test(gradle));

          // ============================================================
          // FASE 2 — A-06: backup do Android restrito, sem o WebView
          // ============================================================
          const raiz = path.join(__dirname, '..');
          const manifest = fs.readFileSync(path.join(raiz, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
          check('A-06: manifest declara regras de backup', /android:fullBackupContent="@xml\/backup_rules"/.test(manifest) &&
            /android:dataExtractionRules="@xml\/data_extraction_rules"/.test(manifest));
          const backupRules = fs.readFileSync(path.join(raiz, 'android/app/src/main/res/xml/backup_rules.xml'), 'utf8');
          const extractRules = fs.readFileSync(path.join(raiz, 'android/app/src/main/res/xml/data_extraction_rules.xml'), 'utf8');
          check('A-06: backup_rules exclui app_webview (localStorage)', /<exclude domain="root" path="app_webview"/.test(backupRules));
          check('A-06: data_extraction_rules exclui app_webview no cloud e na transferência',
            (extractRules.match(/<exclude domain="root" path="app_webview"/g) || []).length === 2);
          check('A-06: nenhuma das regras inclui todo o sistema de ficheiros',
            !/<include domain="file" path="\."/.test(backupRules) && !/<include domain="file" path="\."/.test(extractRules));

          // ============================================================
          // FASE 2 — M-10: @capacitor/android sem a vulnerabilidade crítica
          // ============================================================
          const pkgDeps = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).dependencies;
          const capAndroid = (pkgDeps['@capacitor/android'] || '');
          const numVersao = s => String(s).replace(/[^0-9.]/g, '').split('.').map(Number);
          const [cMaj, cMin, cPat] = numVersao(capAndroid);
          const vulneravel = cMaj === 8 && cMin === 5 && cPat === 0; // >=8.5.0 <8.5.1
          check('M-10: @capacitor/android fora do intervalo vulnerável (>=8.5.0 <8.5.1)', !vulneravel && cMaj >= 8, capAndroid);
          check('M-10: @capacitor/android e core na mesma minor', (() => {
            const core = numVersao(pkgDeps['@capacitor/core'] || '');
            return core[0] === cMaj && core[1] === cMin;
          })(), capAndroid + ' / ' + pkgDeps['@capacitor/core']);

          // ============================================================
          // FASE 2 — sincronização dos assets Android e cache
          // ============================================================
          const semBackupNoAndroid = !fs.existsSync(path.join(raiz, 'android/app/src/main/assets/public/js/backup.js'));
          check('assets Android sincronizados (backup.js presente)', !semBackupNoAndroid);
          const sw = fs.readFileSync(path.join(raiz, 'www/sw.js'), 'utf8');
          check('SW: versão da cache avançou para v32 ou mais', Number((/motoristapro-v(\d+)/.exec(sw) || [])[1]) >= 32,
            (/motoristapro-v(\d+)/.exec(sw) || [])[1]);
          // Todo o JS carregado pelo index.html tem de estar na lista offline do
          // SW, senão em modo avião o script não carrega e as funções que dele
          // dependem (ex.: backup) desaparecem sem aviso.
          const scriptsHtml = [...fs.readFileSync(path.join(WWW, 'index.html'), 'utf8')
            .matchAll(/<script src="([^"]+?)(?:\?[^"]*)?"/g)].map(m => m[1]);
          const assetsSw = [...(/const ASSETS = \[([\s\S]*?)\]/.exec(sw) || [, ''])[1]
            .matchAll(/'([^']+)'/g)].map(m => m[1]);
          const foraDoSw = scriptsHtml.filter(s => !assetsSw.includes(s));
          check('SW: todos os scripts do index.html estão na lista offline', foraDoSw.length === 0, foraDoSw.join(', ') || 'nenhum em falta');

          // ============================================================
          // GOOGLE OAUTH (PKCE) — T1 a T9
          // ------------------------------------------------------------
          // NOTA DE HONESTIDADE: estes testes usam o vendor real do app
          // (supabase-js) mas com fetch substituído. Verificam o que o CÓDIGO
          // envia (desafio PKCE, code_verifier, troca do código, deduplicação),
          // não que o GoTrue aceite a troca. Isso exige rede e aparelho, e está
          // listado como teste pendente no relatório.
          // ============================================================
          const pkce = (() => {
            // janela limpa, só com o vendor + o auth.js real do app
            const janela = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>', {
              url: 'https://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true
            }).window;

            const pedidos = [];
            let respostaToken = { ok: true, status: 200 };
            janela.eval(`
              window.__pedidos = [];
              window.__respostaToken = null;
              window.fetch = async (url, opts) => {
                const u = String(url);
                window.__pedidos.push({ url: u, body: opts && opts.body });
                const falha = window.__respostaToken;
                if (u.includes('grant_type=pkce') || u.includes('/token')) {
                  if (falha) {
                    return { ok: false, status: 400, headers: { get: () => 'application/json' },
                      json: async () => ({ error: 'invalid_grant', error_description: falha }), text: async () => '' };
                  }
                  return { ok: true, status: 200, headers: { get: () => 'application/json' },
                    json: async () => ({ access_token: 'AT', refresh_token: 'RT', token_type: 'bearer',
                                        expires_in: 3600, user: { id: 'u-1', email: 'a@b.c' } }),
                    text: async () => '' };
                }
                return { ok: true, status: 200, headers: { get: () => 'application/json' },
                  json: async () => ({}), text: async () => '' };
              };
              // plugins nativos simulados (Browser sempre disponível)
              window.__browserAberto = []; window.__browserFechado = 0;
              window.__listeners = {};
              window.Capacitor = {
                isNativePlatform: () => true,
                Plugins: {
                  Browser: {
                    open: async ({ url }) => { window.__browserAberto.push(url); },
                    close: async () => { window.__browserFechado++; }
                  },
                  App: {
                    addListener: (evento, cb) => { (window.__listeners[evento] = window.__listeners[evento] || []).push(cb); },
                    getLaunchUrl: async () => window.__launchUrl ? { url: window.__launchUrl } : undefined
                  }
                }
              };
            `);

            // dependências mínimas que o auth.js usa (state/saveState/render ficam de fora)
            janela.eval(`
              window.state = { shifts: [], expenses: [], maintenance: [] };
              window.logEvent = function () {};
              window.mpNotify = function () {};
              window.mpReconcile = async function () { window.__reconcileados = (window.__reconcileados||0)+1; };
              window.mpApplySessionUI = function () {};
              window.MP_SUPABASE_URL = 'https://projeto.supabase.co';
              window.MP_SUPABASE_ANON_KEY = 'sb_publishable_teste';
              window.MP_OAUTH_REDIRECT_NATIVE = 'com.pro.driver://oauth-callback';
            `);

            // carregar o vendor e o auth.js REAIS
            janela.eval(fs.readFileSync(path.join(WWW, 'js/vendor/supabase.js'), 'utf8'));
            // o auth.js referencia elementos do DOM que não existem aqui: os
            // acessos são todos guardados por if (el), por isso não parte.
            janela.eval(fs.readFileSync(path.join(WWW, 'js/auth.js'), 'utf8'));
            return { janela, pedidos };
          })();
          const wPkce = pkce.janela;

          // T1 — o caminho REAL do botão: mpLoginWithGoogle() tem de produzir
          // uma URL de autorização com desafio PKCE e abri-la no browser.
          // (Não se usa mpSupabase diretamente: é uma variável `let` interna
          // do script e o jsdom não a expõe entre avaliações. O comportamento
          // observado é o que o utilizador provoca ao tocar no botão.)
          await wPkce.eval(`mpLoginWithGoogle()`);
          const urlAuth = (wPkce.__browserAberto || [])[0] || '';
          check('T1 Google: URL de autorização inclui code_challenge e método', (() => {
            try {
              // NOTA: neste ficheiro a variável URL é o endereço do servidor
              // de teste; usa-se o construtor global explicitamente.
              const u = new (require('url').URL)(urlAuth);
              return u.searchParams.get('code_challenge') !== null &&
                     ['s256', 'plain'].includes((u.searchParams.get('code_challenge_method') || '').toLowerCase());
            } catch (_) { return false; }
          })(), String(urlAuth).replace(/code_challenge=[^&]+/, 'code_challenge=…').slice(0, 140));

          // o verificador ficou persistido no storage do cliente
          const chavesVerifier = Object.keys(wPkce.localStorage).filter(k => k.includes('code-verifier'));
          check('T2 Google: code_verifier persistido no storage do cliente', chavesVerifier.length > 0, chavesVerifier.length + ' chave(s)');

          // T2/T3 — retorno com ?code=: o verificador correto tem de ser enviado
          const antesToken = (wPkce.__pedidos || []).length;
          const r1 = await wPkce.eval(`mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-1')`);
          const pedidoToken = (wPkce.__pedidos || []).slice(antesToken).find(p => p.url.includes('grant_type=pkce'));
          let corpo = null;
          try { corpo = JSON.parse(pedidoToken.body); } catch (_) {}
          check('T2 Google: retorno com ?code= processado como PKCE', r1.ok === true && r1.modo === 'pkce');
          check('T3 Google: exchangeCodeForSession enviou auth_code e code_verifier não vazio',
            !!corpo && corpo.auth_code === 'CODIGO-1' && typeof corpo.code_verifier === 'string' && corpo.code_verifier.length > 20,
            corpo ? ('verifier de ' + String(corpo.code_verifier || '').length + ' caracteres') : 'sem pedido /token');
          check('T3 Google: o verificador enviado é o que estava guardado', (() => {
            if (!corpo) return false;
            const guardados = Object.keys(wPkce.localStorage)
              .filter(k => k.includes('code-verifier'))
              .map(k => wPkce.localStorage.getItem(k))
              .join('|');
            return guardados.includes(corpo.code_verifier);
          })());

          // T4 — sessão persistida no storage
          const chaveSessao = wPkce.localStorage.getItem('mp_sb_auth_v1');
          check('T4 Google: sessão persistida em localStorage (mp_sb_auth_v1)', !!chaveSessao && /access_token/.test(chaveSessao || ''));
          check('T4 Google: a sessão traz o utilizador autenticado', (() => {
            try { return JSON.parse(chaveSessao).user.id === 'u-1'; } catch (_) { return false; }
          })());

          // T5 — reinicialização simulada: novo cliente, mesmo storage
          check('T5 Google: sessão recuperável após reabrir o app (novo cliente, mesmo storage)', await wPkce.eval(`(async () => {
            const c2 = supabase.createClient('https://projeto.supabase.co', 'sb_publishable_teste', {
              auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: false,
                      detectSessionInUrl: true, storageKey: 'mp_sb_auth_v1' }
            });
            const { data } = await c2.auth.getSession();
            return !!(data && data.session && data.session.user && data.session.user.id === 'u-1');
          })()`));

          // T8 — deep link duplicado não volta a trocar o mesmo código
          const antesDup = (wPkce.__pedidos || []).length;
          const rDup = await wPkce.eval(`mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-1')`);
          const novosPedidos = (wPkce.__pedidos || []).length - antesDup;
          check('T8 Google: retorno duplicado é ignorado sem novo pedido ao servidor',
            rDup.duplicado === true && novosPedidos === 0, 'duplicado=' + rDup.duplicado + ', pedidos=' + novosPedidos);

          // esquema/host errados não são processados
          const rEsquema = await wPkce.eval(`mpTratarRetornoOAuth('evil://oauth-callback?code=OUTRO')`);
          const rHost = await wPkce.eval(`mpTratarRetornoOAuth('com.pro.driver://outro-host?code=OUTRO2')`);
          check('Google: esquema ou host diferente é recusado',
            rEsquema.ok === false && rHost.ok === false && /esquema/.test(rEsquema.motivo));

          // erro devolvido pelo provedor é tratado, não ignorado
          const rErroProv = await wPkce.eval(`mpTratarRetornoOAuth('com.pro.driver://oauth-callback?error=access_denied')`);
          check('Google: erro do provedor é tratado e mostrado', rErroProv.ok === false && /provedor/.test(rErroProv.motivo));

          // falha na troca (sem rede / código inválido) não cria sessão falsa
          wPkce.eval(`window.__respostaToken = 'invalid grant'`);
          const rFalha = await wPkce.eval(`mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-FALHA')`);
          check('Google: falha na troca do código é reportada (sem sessão inventada)',
            rFalha.ok === false && /trocar o código/.test(rFalha.motivo), rFalha.erro || '');
          wPkce.eval(`window.__respostaToken = null`);

          // Verificador em falta (ex.: app reinstalado, storage limpo): o código
          // não é trocável. Tem de ser detetado ANTES de incomodar o servidor.
          wPkce.eval(`Object.keys(localStorage).filter(k => k.indexOf('code-verifier') !== -1)
            .forEach(k => localStorage.removeItem(k))`);
          const antesSemVerif = (wPkce.__pedidos || []).length;
          const rSemVerif = await wPkce.eval(`mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-SEM-VERIFICADOR')`);
          check('Google: sem verificador no aparelho a falha é explicada e não há pedido ao servidor',
            rSemVerif.ok === false && /verificador PKCE ausente/.test(rSemVerif.motivo) &&
            (wPkce.__pedidos || []).length === antesSemVerif,
            rSemVerif.motivo || '');

          // o browser é fechado em qualquer desfecho
          check('Google: o browser é fechado após o processamento', wPkce.eval('window.__browserFechado') >= 2,
            wPkce.eval('window.__browserFechado') + ' fecho(s)');

          // T9 — arranque a frio: app aberto pelo link, listener registado depois
          const janelaFria = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>', {
            url: 'https://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true
          }).window;
          janelaFria.eval(`
            window.__pedidos = [];
            window.fetch = async (u, o) => { window.__pedidos.push({ url: String(u), body: o && o.body });
              return { ok: true, status: 200, headers: { get: () => 'application/json' },
                json: async () => ({ access_token: 'AT', refresh_token: 'RT', token_type: 'bearer', expires_in: 3600,
                                     user: { id: 'u-frio', email: 'f@rio' } }), text: async () => '' }; };
            // O verificador é gravado pelo PRÓPRIO supabase-js ao iniciar o
            // fluxo (signInWithOAuth). Num arranque a frio real ele já está no
            // armazenamento persistente, porque o login foi iniciado nesta
            // mesma instalação antes de o app ser fechado. Semeia-se com um
            // valor fixo, sem nunca imprimir o do fluxo real.
            window.__verifierFrio = 'verificador-frio-de-teste-0123456789';
            // O supabase-js guarda os valores em JSON (JSON.stringify), por isso
            // o verificador tem de ser semeado como string JSON — não em bruto.
            localStorage.setItem('mp_sb_auth_v1-code-verifier', JSON.stringify(window.__verifierFrio));
            window.__launchUrl = 'com.pro.driver://oauth-callback?code=CODIGO-FRIO';
            window.Capacitor = { isNativePlatform: () => true, Plugins: {
              Browser: { open: async () => {}, close: async () => {} },
              App: { addListener: () => {}, getLaunchUrl: async () => ({ url: window.__launchUrl }) } } };
            window.state = { shifts: [], expenses: [], maintenance: [] };
            window.logEvent = function () {}; window.mpNotify = function () {};
            window.mpReconcile = async function () {}; window.mpApplySessionUI = function () {};
            window.MP_SUPABASE_URL = 'https://projeto.supabase.co';
            window.MP_SUPABASE_ANON_KEY = 'sb_publishable_teste';
            window.MP_OAUTH_REDIRECT_NATIVE = 'com.pro.driver://oauth-callback';
          `);
          janelaFria.eval(fs.readFileSync(path.join(WWW, 'js/vendor/supabase.js'), 'utf8'));
          janelaFria.eval(fs.readFileSync(path.join(WWW, 'js/auth.js'), 'utf8'));
          await new Promise(r => setTimeout(r, 60));
          const pedidoFrio = (janelaFria.__pedidos || []).find(p => p.url.includes('grant_type=pkce'));
          const corpoFrio = (() => { try { return JSON.parse(pedidoFrio.body); } catch (_) { return null; } })();
          const sessaoFria = (() => { try { return JSON.parse(janelaFria.localStorage.getItem('mp_sb_auth_v1')); } catch (_) { return null; } })();
          check('T9 Google: arranque a frio usa getLaunchUrl (pedido /token com o code do link)',
            !!corpoFrio && corpoFrio.auth_code === 'CODIGO-FRIO');
          check('T9 Google: arranque a frio conclui o login e persiste a sessão',
            !!sessaoFria && sessaoFria.user && sessaoFria.user.id === 'u-frio' && !!sessaoFria.access_token);

          // ============================================================
          // T10 — registo IDEMPOTENTE do deep link e retorno único
          // ============================================================
          // Janela própria: aqui interessa contar listeners e consultas, não
          // o fluxo de tokens.
          const wReg = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>', {
            url: 'https://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true
          }).window;
          wReg.eval(`
            window.__pedidos = [];
            window.fetch = async (u, o) => {
              window.__pedidos.push({ url: String(u), body: o && o.body });
              return { ok: true, status: 200, headers: { get: () => 'application/json' },
                json: async () => ({ access_token: 'AT', refresh_token: 'RT', token_type: 'bearer',
                                     expires_in: 3600, user: { id: 'u-reg', email: 'r@eg' } }), text: async () => '' };
            };
            // Contadores do que o app pede ao nativo.
            window.__listeners = 0;
            window.__consultasLaunch = 0;
            window.__callbacks = [];
            window.__browserAberto = [];
            window.Capacitor = {
              isNativePlatform: () => true,
              Plugins: {
                Browser: { open: async ({ url }) => { window.__browserAberto.push(url); }, close: async () => {} },
                App: {
                  addListener: (evento, cb) => {
                    if (evento === 'appUrlOpen') { window.__listeners++; window.__callbacks.push(cb); }
                    return { remove: async () => {} };
                  },
                  getLaunchUrl: async () => { window.__consultasLaunch++; return undefined; }
                }
              }
            };
            window.state = { shifts: [], expenses: [], maintenance: [] };
            window.logEvent = function () {}; window.mpNotify = function () {};
            window.mpReconcile = async function () {}; window.mpApplySessionUI = function () {};
            window.MP_SUPABASE_URL = 'https://projeto.supabase.co';
            window.MP_SUPABASE_ANON_KEY = 'sb_publishable_teste';
            window.MP_OAUTH_REDIRECT_NATIVE = 'com.pro.driver://oauth-callback';
          `);
          wReg.eval(fs.readFileSync(path.join(WWW, 'js/vendor/supabase.js'), 'utf8'));
          wReg.eval(fs.readFileSync(path.join(WWW, 'js/auth.js'), 'utf8'));
          await new Promise(r => setTimeout(r, 60));

          // o arranque (mpInitSupabase) já registou uma vez
          check('T10 deep link: listener registado uma vez no arranque',
            wReg.__listeners === 1, wReg.__listeners + ' listener(s)');
          check('T10 deep link: getLaunchUrl consultado uma vez no arranque',
            wReg.__consultasLaunch === 1, wReg.__consultasLaunch + ' consulta(s)');

          // chamar o registo várias vezes não acumula listeners
          wReg.eval(`mpRegisterDeepLink(); mpRegisterDeepLink(); mpRegisterDeepLink();`);
          await new Promise(r => setTimeout(r, 40));
          check('T10 deep link: chamadas repetidas não registam outro listener',
            wReg.__listeners === 1, wReg.__listeners + ' listener(s)');
          check('T10 deep link: chamadas repetidas não repetem getLaunchUrl',
            wReg.__consultasLaunch === 1, wReg.__consultasLaunch + ' consulta(s)');

          // várias tentativas de login também não acumulam
          for (let i = 0; i < 3; i++) await wReg.eval(`mpLoginWithGoogle()`);
          check('T10 deep link: três tentativas de login continuam com um só listener',
            wReg.__listeners === 1, wReg.__listeners + ' listener(s)');
          check('T10 deep link: três tentativas de login não repetem getLaunchUrl',
            wReg.__consultasLaunch === 1, wReg.__consultasLaunch + ' consulta(s)');
          check('T10 deep link: o login continuou a abrir o browser em cada tentativa',
            (wReg.__browserAberto || []).length === 3, (wReg.__browserAberto || []).length + ' abertura(s)');

          // um único retorno entregue com o listener registado: uma troca só
          wReg.eval(`localStorage.setItem('mp_sb_auth_v1-code-verifier', JSON.stringify('verificador-reg-0123456789abcdef'))`);
          const antesRetorno = (wReg.__pedidos || []).length;
          wReg.eval(`window.__callbacks[0]({ url: 'com.pro.driver://oauth-callback?code=CODIGO-UNICO' })`);
          await new Promise(r => setTimeout(r, 250));
          const trocas = (wReg.__pedidos || []).slice(antesRetorno).filter(p => p.url.includes('grant_type=pkce'));
          check('T10 deep link: um retorno produz exactamente uma troca de código',
            trocas.length === 1, trocas.length + ' troca(s)');

          // dois caminhos em simultâneo para o MESMO link: um processa, o outro
          // espera — nunca duas trocas concorrentes
          wReg.eval(`localStorage.setItem('mp_sb_auth_v1-code-verifier', JSON.stringify('verificador-reg-2-0123456789ab'))`);
          const antesDuplo = (wReg.__pedidos || []).length;
          const resultadosDuplos = await wReg.eval(`(async () => {
            const [a, b] = await Promise.all([
              mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-CONCORRENTE'),
              mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-CONCORRENTE')
            ]);
            return [a, b];
          })()`);
          const trocasDuplas = (wReg.__pedidos || []).slice(antesDuplo).filter(p => p.url.includes('grant_type=pkce'));
          check('T10 deep link: retorno em simultâneo por dois caminhos gera uma só troca',
            trocasDuplas.length === 1, trocasDuplas.length + ' troca(s)');
          check('T10 deep link: o segundo caminho recebe o desfecho do primeiro',
            resultadosDuplos[0].ok === true && resultadosDuplos[1].ok === true &&
            resultadosDuplos[1].concorrente === true);

          // o mesmo link entregue outra vez pelo listener não volta a trocar
          const antesRepetido = (wReg.__pedidos || []).length;
          wReg.eval(`window.__callbacks.forEach(cb => cb({ url: 'com.pro.driver://oauth-callback?code=CODIGO-UNICO' }))`);
          await new Promise(r => setTimeout(r, 200));
          const trocasRepetidas = (wReg.__pedidos || []).slice(antesRepetido).filter(p => p.url.includes('grant_type=pkce'));
          check('T10 deep link: reentrega do mesmo link não repete a troca',
            trocasRepetidas.length === 0, trocasRepetidas.length + ' troca(s)');
          check('T10 deep link: nenhum listener extra apareceu no fim do percurso',
            wReg.__listeners === 1 && wReg.__callbacks.length === 1,
            wReg.__listeners + ' registo(s) / ' + wReg.__callbacks.length + ' callback(s)');

          // ============================================================
          // T11 — retornos OAuth DIFERENTES em simultâneo
          // ============================================================
          // Dois códigos distintos a chegar ao mesmo tempo: o segundo não pode
          // correr outra troca nem herdar o sucesso do primeiro.
          wReg.eval(`
            localStorage.setItem('mp_sb_auth_v1-code-verifier', JSON.stringify('verificador-t11-0123456789ab'));
            // o leque de verificadores foi consumido pela troca anterior
            window.__pedidos.length = 0;
          `);
          const doisCodigos = await wReg.eval(`(async () => {
            const [a, b] = await Promise.all([
              mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-AAA'),
              mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-BBB')
            ]);
            return [a, b];
          })()`);
          const trocasDois = (wReg.__pedidos || []).filter(p => p.url.includes('grant_type=pkce'));
          check('T11: dois códigos diferentes em simultâneo produzem uma única troca',
            trocasDois.length === 1, trocasDois.length + ' troca(s)');
          check('T11: o segundo código único não devolve sucesso emprestado do primeiro',
            doisCodigos[1].ok === false, 'ok=' + doisCodigos[1].ok);
          check('T11: o conflito é explícito e identificável',
            doisCodigos[1].conflito === true && /processado/.test(doisCodigos[1].motivo),
            doisCodigos[1].motivo || '');
          check('T11: o segundo retorno não é classificado como duplicado nem como sucesso',
            doisCodigos[1].duplicado === false && doisCodigos[1].modo === null);
          check('T11: a única troca enviada é a do primeiro código',
            !!trocasDois[0] && JSON.parse(trocasDois[0].body).auth_code === 'CODIGO-AAA',
            trocasDois[0] ? JSON.parse(trocasDois[0].body).auth_code : 'sem pedido');

          // o código recusado por conflito NÃO foi marcado como usado: uma nova
          // tentativa depois do conflito consegue processá-lo
          wReg.eval(`localStorage.setItem('mp_sb_auth_v1-code-verifier', JSON.stringify('verificador-t11b-0123456789'))`);
          const retryConflito = await wReg.eval(`mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-BBB')`);
          check('T11: o código posto de lado por conflito é processável depois',
            retryConflito.ok === true && retryConflito.conflito === undefined,
            'ok=' + retryConflito.ok);

          // e o mesmo código continua a ser tratado como duplicado (não regrediu)
          const antesMesmoCodigo = (wReg.__pedidos || []).length;
          const mesmoCodigo = await wReg.eval(`mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-AAA')`);
          check('T11: a deduplicação por código continua a funcionar',
            mesmoCodigo.duplicado === true &&
            (wReg.__pedidos || []).length === antesMesmoCodigo,
            'duplicado=' + mesmoCodigo.duplicado);

          // ============================================================
          // T12 — registo ASSÍNCRONO do listener (App.addListener devolve Promise)
          // ============================================================
          // Confirmado na versão instalada: @capacitor/app 8.1.2 declara
          // addListener(...): Promise<PluginListenerHandle>.
          const dtsApp = fs.readFileSync(path.join(path.join(__dirname, '..'), 'node_modules/@capacitor/app/dist/esm/definitions.d.ts'), 'utf8');
          check('T12: a versão instalada documenta addListener como Promise',
            /addListener\(eventName: 'appUrlOpen'[^)]*\): Promise<PluginListenerHandle>/.test(dtsApp),
            JSON.stringify(String(dtsApp).length) + ' bytes de tipos');

          // janela controlada: o addListener pode resolver, rejeitar (async) ou
          // atirar (sync), e conta quantas vezes foi chamado.
          function janelaRegisto(modo) {
            const w = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>', {
              url: 'https://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true
            }).window;
            w.eval(`
              window.__chamadasAddListener = 0;
              window.__callbacks = [];
              window.__modo = ${JSON.stringify(modo)};
              window.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' },
                json: async () => ({}), text: async () => '' });
              window.Capacitor = { isNativePlatform: () => true, Plugins: {
                Browser: { open: async () => {}, close: async () => {} },
                App: {
                  addListener: (evento, cb) => {
                    window.__chamadasAddListener++;
                    window.__callbacks.push(cb);
                    if (window.__modo === 'sync-throw') throw new Error('plugin indisponível');
                    if (window.__modo === 'async-reject') return Promise.reject(new Error('falha nativa simulada'));
                    return Promise.resolve({ remove: async () => {} });
                  },
                  getLaunchUrl: async () => undefined
                } } };
              window.state = { shifts: [], expenses: [], maintenance: [] };
              window.logEvent = function () {}; window.mpNotify = function () {};
              window.mpReconcile = async function () {}; window.mpApplySessionUI = function () {};
              window.MP_SUPABASE_URL = 'https://projeto.supabase.co';
              window.MP_SUPABASE_ANON_KEY = 'sb_publishable_teste';
              window.MP_OAUTH_REDIRECT_NATIVE = 'com.pro.driver://oauth-callback';
            `);
            w.eval(fs.readFileSync(path.join(WWW, 'js/vendor/supabase.js'), 'utf8'));
            w.eval(fs.readFileSync(path.join(WWW, 'js/auth.js'), 'utf8'));
            return w;
          }

          // (a) sucesso — registo confirmado só depois de a promessa resolver
          const wOk = janelaRegisto('resolve');
          await new Promise(r => setTimeout(r, 60));
          check('T12: registo bem-sucedido liga o listener uma vez',
            wOk.__chamadasAddListener === 1 && (await wOk.eval(`mpRegisterDeepLink()`)) === true,
            wOk.__chamadasAddListener + ' chamada(s)');
          check('T12: chamadas simultâneas partilham um único addListener',
            (await wOk.eval(`Promise.all([mpRegisterDeepLink(), mpRegisterDeepLink(), mpRegisterDeepLink()])`)).every(Boolean) &&
            wOk.__chamadasAddListener === 1,
            wOk.__chamadasAddListener + ' chamada(s) após 3 pedidos simultâneos');

          // (b) rejeição assíncrona — não pode ficar marcado como registado
          const wRej = janelaRegisto('async-reject');
          await new Promise(r => setTimeout(r, 60));
          check('T12: rejeição assíncrona não conta como registado',
            (await wRej.eval(`mpRegisterDeepLink()`)) === false);
          const tentativasRej = wRej.__chamadasAddListener;
          await wRej.eval(`mpRegisterDeepLink()`);
          check('T12: depois de falhar, uma nova tentativa volta a tentar registar',
            wRej.__chamadasAddListener === tentativasRej + 1,
            tentativasRej + ' → ' + wRej.__chamadasAddListener + ' chamada(s)');

          // (c) erro síncrono do plugin — também permite nova tentativa
          const wSync = janelaRegisto('sync-throw');
          await new Promise(r => setTimeout(r, 60));
          const antesSync = wSync.__chamadasAddListener;
          const okSync = await wSync.eval(`mpRegisterDeepLink()`);
          await wSync.eval(`mpRegisterDeepLink()`);
          check('T12: erro síncrono não marca registado e permite nova tentativa',
            okSync === false && wSync.__chamadasAddListener === antesSync + 2,
            'resultado=' + okSync + ', ' + wSync.__chamadasAddListener + ' chamada(s)');

          // (d) depois de recuperar, passa a ser idempotente
          wSync.eval(`window.Capacitor.Plugins.App.addListener = (evento, cb) => {
            window.__chamadasAddListener++; return Promise.resolve({ remove: async () => {} }); }`);
          const recuperou = await wSync.eval(`mpRegisterDeepLink()`);
          const chamadasAposRecuperar = wSync.__chamadasAddListener;
          await wSync.eval(`mpRegisterDeepLink(); mpRegisterDeepLink();`);
          check('T12: após recuperar o registo, deixa de haver novas chamadas ao plugin',
            recuperou === true && wSync.__chamadasAddListener === chamadasAposRecuperar,
            'recuperou=' + recuperou + ', ' + wSync.__chamadasAddListener + ' chamada(s)');

          // (e) se o registo falhou no arranque, o login tem de o confirmar
          // ANTES de abrir o browser (é a última rede antes de sair do app).
          const wLogin = janelaRegisto('async-reject');
          await new Promise(r => setTimeout(r, 80));
          wLogin.eval(`
            window.__ordem = [];
            window.Capacitor.Plugins.App.addListener = (e, cb) => {
              window.__ordem.push('addListener');
              return new Promise(res => setTimeout(() => { window.__ordem.push('registado'); res({ remove: async () => {} }); }, 80));
            };
            window.Capacitor.Plugins.Browser.open = async () => { window.__ordem.push('browser'); };
          `);
          await wLogin.eval(`mpLoginWithGoogle()`);
          check('T12: com o registo em falta, o login confirma-o antes de abrir o browser',
            JSON.stringify(wLogin.__ordem) === JSON.stringify(['addListener', 'registado', 'browser']),
            JSON.stringify(wLogin.__ordem));

          // e quando o registo já está confirmado não há nova chamada ao plugin
          wLogin.eval(`window.__ordem = [];`);
          await wLogin.eval(`mpLoginWithGoogle()`);
          check('T12: com o registo já confirmado o login não volta a registar',
            JSON.stringify(wLogin.__ordem) === JSON.stringify(['browser']),
            JSON.stringify(wLogin.__ordem));

          // ============================================================
          // T13 / T14 — o navegador só abre com o retorno confirmado
          // ============================================================
          // Observáveis reais (sem inspecionar código):
          //  - Browser.open e o URL que recebeu;
          //  - chamadas a auth.signInWithOAuth (o client é embrulhado ANTES de o
          //    auth.js o criar, por isso o login iniciado é contado de verdade —
          //    em nativo a URL de autorização é gerada localmente, sem pedido);
          //  - estado do botão e texto do #mpLoginStatus.
          function janelaLogin(modoRegistoInicial) {
            const w = new (require('jsdom').JSDOM)(
              '<!doctype html><html><body>' +
              '<button id="mpBtnGoogle">Entrar com Google</button>' +
              '<button id="mpBtnGoogleLogin">Entrar com Google</button>' +
              '<div id="mpLoginStatus"></div><div id="mpAccountEmail"></div>' +
              '<div id="mpAccountActions"></div><div id="mpNotify"></div>' +
              '</body></html>',
              { url: 'https://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true }
            ).window;
            w.eval(`
              window.__browserAberto = [];
              window.__oauthIniciados = 0;
              window.__modoAddListener = ${JSON.stringify(modoRegistoInicial || 'resolve')};
              window.fetch = async () => ({ ok: true, status: 200, headers: { get: () => 'application/json' },
                json: async () => ({}), text: async () => '' });
              window.Capacitor = { isNativePlatform: () => true, Plugins: {
                Browser: {
                  open: async ({ url }) => { window.__browserAberto.push(url); },
                  close: async () => {}
                },
                App: {
                  addListener: (evento, cb) => {
                    if (window.__modoAddListener === 'rejeitar') {
                      return Promise.reject(new Error('registro nativo falhou (detalhe interno)'));
                    }
                    return Promise.resolve({ remove: async () => {} });
                  },
                  getLaunchUrl: async () => undefined
                } } };
              window.state = { shifts: [], expenses: [], maintenance: [] };
              window.logEvent = function () {}; window.mpNotify = function () {};
              window.mpReconcile = async function () {}; window.mpApplySessionUI = function () {};
              window.MP_SUPABASE_URL = 'https://projeto.supabase.co';
              window.MP_SUPABASE_ANON_KEY = 'sb_publishable_teste';
              window.MP_OAUTH_REDIRECT_NATIVE = 'com.pro.driver://oauth-callback';
            `);
            w.eval(fs.readFileSync(path.join(WWW, 'js/vendor/supabase.js'), 'utf8'));
            // Embrulhar o client antes de o auth.js o criar: conta as tentativas
            // reais de iniciar o OAuth (nativo gera a URL sem pedido de rede).
            w.eval(`
              const criarOriginal = window.supabase.createClient.bind(window.supabase);
              window.supabase.createClient = function () {
                const c = criarOriginal.apply(null, arguments);
                const iniciarOriginal = c.auth.signInWithOAuth.bind(c.auth);
                c.auth.signInWithOAuth = function (o) {
                  window.__oauthIniciados++;
                  return iniciarOriginal(o);
                };
                return c;
              };
            `);
            w.eval(fs.readFileSync(path.join(WWW, 'js/auth.js'), 'utf8'));
            return w;
          }
          const estadoLogin = (w) => ({
            browser: (w.__browserAberto || []).length,
            oauth: w.__oauthIniciados || 0,
            ocupado: w.document.getElementById('mpBtnGoogle').disabled,
            textoBotao: w.document.getElementById('mpBtnGoogle').textContent,
            status: w.document.getElementById('mpLoginStatus').textContent
          });

          // --- T13 — o registo falha no arranque: nada arranca --------------
          const wT13 = janelaLogin('rejeitar');
          await new Promise(r => setTimeout(r, 100)); // arranque: registo falha
          await wT13.eval(`mpLoginWithGoogle()`);      // login: nova tentativa falha
          const dep13 = estadoLogin(wT13);

          check('T13: Browser.open NÃO é chamado sem retorno confirmado',
            dep13.browser === 0, dep13.browser + ' abertura(s)');
          check('T13: o login OAuth não é iniciado (signInWithOAuth não é chamado)',
            dep13.oauth === 0, dep13.oauth + ' chamada(s) a signInWithOAuth');
          check('T13: o botão Google sai do estado de carregamento',
            dep13.ocupado === false && dep13.textoBotao === 'Entrar com Google',
            'disabled=' + dep13.ocupado + ', texto=' + JSON.stringify(dep13.textoBotao));
          check('T13: é apresentada uma mensagem compreensível ao utilizador',
            /não foi possível preparar o retorno do Google/i.test(dep13.status) && /tente novamente/i.test(dep13.status),
            JSON.stringify(dep13.status));
          check('T13: a mensagem não expõe detalhes internos do plugin',
            !/registro nativo falhou|detalhe interno|\bError\b|addListener|appUrlOpen/i.test(dep13.status),
            JSON.stringify(dep13.status));

          // tentativa posterior, já com o registo a funcionar
          wT13.eval(`window.__modoAddListener = 'resolve'`);
          await wT13.eval(`mpLoginWithGoogle()`);
          const dep13b = estadoLogin(wT13);
          check('T13: depois do registo passar a funcionar, o login arranca normalmente',
            dep13b.browser === 1 && dep13b.oauth === 1,
            dep13b.browser + ' abertura(s), ' + dep13b.oauth + ' chamada(s) a signInWithOAuth');

          // --- T14 — registo confirmado: fluxo normal ---------------------
          const wT14 = janelaLogin('resolve');
          await new Promise(r => setTimeout(r, 100)); // arranque confirma o registo
          await wT14.eval(`mpLoginWithGoogle()`);
          const dep14 = estadoLogin(wT14);
          check('T14: Browser.open é chamado uma única vez', dep14.browser === 1, dep14.browser + ' abertura(s)');
          check('T14: o login OAuth é iniciado uma única vez', dep14.oauth === 1, dep14.oauth + ' chamada(s)');

          const urlT14 = (wT14.__browserAberto || [])[0] || '';
          const params14 = (() => { try { return new (require('url').URL)(urlT14).searchParams; } catch (_) { return null; } })();
          check('T14: a URL mantém o fluxo PKCE (code_challenge + método)',
            !!params14 && params14.get('code_challenge') !== null &&
            ['s256', 'plain'].includes((params14.get('code_challenge_method') || '').toLowerCase()),
            params14 ? ('método=' + params14.get('code_challenge_method')) : 'sem URL');
          check('T14: a URL mantém o redirect nativo atual',
            !!params14 && params14.get('redirect_to') === 'com.pro.driver://oauth-callback',
            params14 ? String(params14.get('redirect_to')) : 'sem URL');
          check('T14: a interface entra no estado de espera do Google (sem regressão)',
            dep14.ocupado === true && /Aguardando autenticação/.test(dep14.textoBotao) &&
            /Aguardando autenticação/.test(dep14.status),
            'texto=' + JSON.stringify(dep14.textoBotao));

          // --- em web o guard não se aplica (não há deep link) ------------
          const wWeb = janelaLogin('rejeitar');
          wWeb.eval(`window.Capacitor.isNativePlatform = () => false;`);
          await wWeb.eval(`mpLoginWithGoogle()`);
          const statusWeb = wWeb.document.getElementById('mpLoginStatus').textContent;
          check('T13/T14: em web uma falha de registo não bloqueia o login',
            (wWeb.__oauthIniciados || 0) === 1 && !/preparar o retorno do Google/i.test(statusWeb),
            'oauth=' + wWeb.__oauthIniciados + ', status=' + JSON.stringify(statusWeb));

          // ============================================================
          // T6 / T7 — o que NÃO podia mudar (regressões)
          // ============================================================
          const wLocal = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>', {
            url: 'https://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true
          }).window;
          wLocal.eval(`
            window.__pedidos = [];
            window.fetch = async (u, o) => {
              window.__pedidos.push({ url: String(u), body: o && o.body });
              const u2 = String(u);
              if (u2.includes('grant_type=password')) {
                return { ok: true, status: 200, headers: { get: () => 'application/json' },
                  json: async () => ({ access_token: 'AT-E', refresh_token: 'RT-E', token_type: 'bearer',
                                       expires_in: 3600, user: { id: 'u-email', email: 'e@mail' } }), text: async () => '' };
              }
              return { ok: true, status: 200, headers: { get: () => 'application/json' },
                json: async () => ({}), text: async () => '' };
            };
            window.Capacitor = { isNativePlatform: () => true, Plugins: {
              Browser: { open: async () => {}, close: async () => {} },
              App: { addListener: () => {}, getLaunchUrl: async () => undefined } } };
            window.state = { shifts: [], expenses: [], maintenance: [] };
            window.logEvent = function () {}; window.mpNotify = function () {};
            window.mpReconcile = async function () {}; window.mpApplySessionUI = function () {};
            window.MP_SUPABASE_URL = 'https://projeto.supabase.co';
            window.MP_SUPABASE_ANON_KEY = 'sb_publishable_teste';
            window.MP_OAUTH_REDIRECT_NATIVE = 'com.pro.driver://oauth-callback';
          `);
          wLocal.eval(fs.readFileSync(path.join(WWW, 'js/vendor/supabase.js'), 'utf8'));
          wLocal.eval(fs.readFileSync(path.join(WWW, 'js/auth.js'), 'utf8'));

          // T6 — logout não apaga o histórico financeiro local
          const historico = {
            shifts: [{ id: 's1', date: '2026-11-01', km: 120, gross: 250, net: 180 }],
            expenses: [{ id: 'e1', date: '2026-11-02', category: 'Combustível', value: 90 }],
            maintenance: [{ id: 'm1', date: '2026-11-03', desc: 'Óleo', value: 120 }],
            vehicle: { odometer: 54321 }, fuelSettings: { price: 5.89 }
          };
          const antesLogout = JSON.stringify(historico);
          wLocal.eval(`
            window.state = ${JSON.stringify(historico)};
            localStorage.setItem('mp_html_state_v8', JSON.stringify(window.state));
          `);
          check('T6 logout: dados financeiros gravados antes do logout', JSON.stringify(wLocal.state) === antesLogout);
          await wLocal.eval(`mpLogout()`);
          check('T6 logout: histórico em memória intacto (turnos, despesas, manutenções)',
            JSON.stringify(wLocal.state) === antesLogout,
            'turnos=' + wLocal.state.shifts.length + ', despesas=' + wLocal.state.expenses.length +
            ', manutenções=' + wLocal.state.maintenance.length);
          check('T6 logout: histórico continua gravado no armazenamento local',
            (() => {
              try {
                const s = JSON.parse(wLocal.localStorage.getItem('mp_html_state_v8'));
                return s.shifts.length === 1 && s.expenses.length === 1 && s.maintenance.length === 1 &&
                       s.vehicle.odometer === 54321;
              } catch (_) { return false; }
            })());
          // Fase 3: o logout NÃO deixa atalho para entrar sem conta.
          check('T6 logout: não deixa atalho de acesso sem conta',
            wLocal.localStorage.getItem('mp_offline_mode_v8') === null);
          check('T6 logout: nada é enviado ao servidor para apagar dados',
            !(wLocal.__pedidos || []).some(p => /DELETE|\/rest\/v1\/user_states/.test(p.url + ' ' + (p.body || ''))));

          // T7 — login por email/senha continua a funcionar e usar o fluxo de senha
          wLocal.document.body.innerHTML =
            '<input id="mpEmailInput" value="e@mail.com"><input id="mpPasswordInput" value="segredo">' +
            '<button id="mpBtnEmail"></button><div id="mpLoginStatus"></div><div id="mpNotify"></div>';
          const antesEmail = (wLocal.__pedidos || []).length;
          await wLocal.eval(`mpLoginWithEmail()`);
          const pedidoSenha = (wLocal.__pedidos || []).slice(antesEmail).find(p => p.url.includes('grant_type=password'));
          check('T7 email/senha: envia grant_type=password com email e senha',
            !!pedidoSenha && (() => {
              try { const b = JSON.parse(pedidoSenha.body); return b.email === 'e@mail.com' && b.password === 'segredo'; }
              catch (_) { return false; }
            })());
          check('T7 email/senha: sessão criada e persistida', (() => {
            try { return JSON.parse(wLocal.localStorage.getItem('mp_sb_auth_v1')).user.id === 'u-email'; }
            catch (_) { return false; }
          })());
          check('T7 email/senha: campo da senha é limpo após entrar',
            wLocal.document.getElementById('mpPasswordInput').value === '');
          check('T7 email/senha: nenhum pedido OAuth foi disparado',
            !(wLocal.__pedidos || []).some(p => /grant_type=pkce|\/authorize/.test(p.url)));

          // ============================================================
          // JANELA DE AUTENTICAÇÃO — 23 cenários
          // ------------------------------------------------------------
          // O que estes testes provam (e o que NÃO provam):
          //  - markup real de www/index.html (campos, vistas, ids);
          //  - vendor supabase-js verdadeiro + fetch simulado → o pedido HTTP
          //    que o app produz (grant_type, redirect_to, corpo) é real;
          //  - mensagens em pt-BR e ausência de pedido quando a validação local
          //    reprova.
          // NÃO provam: entrega de e-mail (SMTP), deep link no Android físico,
          // nem o Google no Google Cloud. Isso está separado no relatório.
          // ============================================================
          const authFx = require('./lib/auth-fixtures.js');
          const SENHA_OK = 'Motorista1';
          const SENHA_FRACA = 'motorista1'; // sem maiúscula

          const authPadrao = () => ({
            '/auth/v1/token?grant_type=password': {
              status: 200,
              json: { access_token: 'AT-1', refresh_token: 'RT-1', token_type: 'bearer',
                expires_in: 3600, user: { id: 'u-login', email: 'motorista@exemplo.com' } }
            },
            '/auth/v1/signup': {
              status: 200,
              json: { id: 'u-novo', email: 'novo@exemplo.com', role: 'authenticated',
                aud: 'authenticated', identities: [{ id: 'id-1', provider: 'email' }],
                app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {} }
            },
            '/auth/v1/recover': { status: 200, json: {} },
            '/auth/v1/user': {
              status: 200,
              json: { id: 'u-login', email: 'motorista@exemplo.com', aud: 'authenticated' }
            }
          });

          // --- A01 — a janela tem as quatro vistas e abre em "entrar" ------
          {
            const wA = authFx.criarJanelaAuth({ respostas: authPadrao() });
            ['login', 'signup', 'forgot', 'reset'].forEach((v) => {
              const id = 'mpAuthView' + v.charAt(0).toUpperCase() + v.slice(1);
              check('A01: a vista "' + v + '" existe no markup',
                !!wA.document.getElementById(id));
            });
            wA.eval(`mpAuthAbrir('login')`);
            check('A01: abrir mostra a janela de autenticação',
              wA.document.getElementById('mpLoginScreen').style.display === 'flex');
            check('A01: só a vista de entrar fica visível',
              authFx.visivel(wA, 'mpAuthViewLogin') &&
              !authFx.visivel(wA, 'mpAuthViewSignup') &&
              !authFx.visivel(wA, 'mpAuthViewForgot') &&
              !authFx.visivel(wA, 'mpAuthViewReset'));
            wA.eval(`mpAuthMostrarVista('signup')`);
            check('A01: trocar para "criar conta" esconde as outras vistas',
              authFx.visivel(wA, 'mpAuthViewSignup') && !authFx.visivel(wA, 'mpAuthViewLogin'));
            check('A01: os campos de e-mail e senha existem na vista de entrar',
              !!wA.document.getElementById('mpAuthEmail') &&
              !!wA.document.getElementById('mpAuthSenha') &&
              !!wA.document.getElementById('mpBtnGoogle') &&
              !!wA.document.getElementById('mpBtnEmail'));
            // Configurações → Conta & Nuvem é a porta de entrada da janela.
            wA.eval(`mpAuthFechar(); mpUpdateAccountUI();`);
            const botaoConta = wA.document.getElementById('mpBtnAbrirAuth');
            check('A01: sem sessão, Conta & Nuvem oferece "Entrar ou criar conta"',
              !!botaoConta && /Entrar ou criar conta/.test(botaoConta.textContent));
            if (botaoConta) botaoConta.dispatchEvent(new wA.Event('click'));
            wA.eval(`mpAuthAbrir('login')`);
            check('A01: a partir de Conta & Nuvem a janela abre na vista de entrar',
              wA.document.getElementById('mpLoginScreen').style.display === 'flex' &&
              authFx.visivel(wA, 'mpAuthViewLogin'));
          }

          // --- A02 — fechar limpa senha e status ---------------------------
          // A janela só se fecha com o acesso liberado (Fase 3): a janela usada
          // aqui arranca já com sessão válida guardada.
          {
            const wA = authFx.criarJanelaPortao({
              respostas: authPadrao(),
              local: { mp_sb_auth_v1: authFx.sessaoGuardada('u-A', 3600) }
            });
            await new Promise(r => setTimeout(r, 600));
            wA.eval(`
              mpAuthAbrir('login');
              document.getElementById('mpAuthSenha').value = 'segredo-digitado';
              mpSetLoginStatus('mensagem qualquer', true);
            `);
            wA.eval(`mpAuthFechar()`);
            check('A02: fechar limpa a senha digitada',
              wA.document.getElementById('mpAuthSenha').value === '');
            check('A02: fechar limpa a mensagem de estado',
              authFx.statusDe(wA, 'mpLoginStatus') === '' &&
              wA.document.getElementById('mpLoginStatus').style.display === 'none');
            check('A02: fechar esconde a janela',
              wA.document.getElementById('mpLoginScreen').style.display === 'none');
          }

          // --- A03/A04/A05 — validação local do login ----------------------
          {
            const wA = authFx.criarJanelaAuth({ respostas: authPadrao() });
            wA.eval(`mpAuthAbrir('login')`);
            wA.eval(`mpLoginWithEmail()`);
            await new Promise(r => setTimeout(r, 30));
            check('A03: login sem e-mail mostra mensagem',
              /e-mail/i.test(authFx.statusDe(wA, 'mpLoginStatus')), authFx.statusDe(wA, 'mpLoginStatus'));
            check('A03: login sem e-mail não faz pedido',
              authFx.pedidosCom(wA, '/auth/v1/token').length === 0);

            wA.eval(`document.getElementById('mpAuthEmail').value = 'sem-arroba';`);
            wA.eval(`mpLoginWithEmail()`);
            await new Promise(r => setTimeout(r, 30));
            check('A04: e-mail com formato inválido é recusado antes da rede',
              /E-mail inválido/i.test(authFx.statusDe(wA, 'mpLoginStatus')) &&
              authFx.pedidosCom(wA, '/auth/v1/token').length === 0,
              authFx.statusDe(wA, 'mpLoginStatus'));

            wA.eval(`
              document.getElementById('mpAuthEmail').value = 'motorista@exemplo.com';
              document.getElementById('mpAuthSenha').value = '';
            `);
            wA.eval(`mpLoginWithEmail()`);
            await new Promise(r => setTimeout(r, 30));
            check('A05: login sem senha mostra mensagem e não pede ao servidor',
              /senha/i.test(authFx.statusDe(wA, 'mpLoginStatus')) &&
              authFx.pedidosCom(wA, '/auth/v1/token').length === 0,
              authFx.statusDe(wA, 'mpLoginStatus'));
          }

          // --- A06 — login com sucesso ------------------------------------
          {
            const wA = authFx.criarJanelaAuth({ respostas: authPadrao() });
            wA.eval(`
              mpAuthAbrir('login');
              document.getElementById('mpAuthEmail').value = 'motorista@exemplo.com';
              document.getElementById('mpAuthSenha').value = ${JSON.stringify(SENHA_OK)};
            `);
            await wA.eval(`mpLoginWithEmail()`);
            const ped = authFx.ultimoPedido(wA, '/auth/v1/token');
            const corpo = ped && authFx.jsonDoCorpo(ped);
            check('A06: o login envia grant_type=password com e-mail e senha',
              !!ped && ped.url.indexOf('grant_type=password') !== -1 &&
              !!corpo && corpo.email === 'motorista@exemplo.com' && corpo.password === SENHA_OK);
            check('A06: a sessão fica guardada no aparelho', (() => {
              try {
                const s = JSON.parse(wA.localStorage.getItem('mp_sb_auth_v1'));
                return s && s.user && s.user.id === 'u-login';
              } catch (_) { return false; }
            })());
            check('A06: ao entrar a janela fecha e a senha não fica no campo',
              wA.document.getElementById('mpLoginScreen').style.display === 'none' &&
              wA.document.getElementById('mpAuthSenha').value === '');
            check('A06: nenhum pedido OAuth é disparado no login por senha',
              authFx.pedidosCom(wA, 'grant_type=pkce').length === 0 &&
              authFx.pedidosCom(wA, '/authorize').length === 0);
          }

          // --- A07/A08 — erros de login traduzidos -------------------------
          {
            const wA = authFx.criarJanelaAuth({
              respostas: {
                '/auth/v1/token?grant_type=password': {
                  status: 400,
                  json: { error: 'invalid_grant', error_code: 'invalid_credentials',
                    error_description: 'Invalid login credentials', msg: 'Invalid login credentials' }
                }
              }
            });
            wA.eval(`
              mpAuthAbrir('login');
              document.getElementById('mpAuthEmail').value = 'naoexiste@exemplo.com';
              document.getElementById('mpAuthSenha').value = 'SenhaErrada1';
            `);
            await wA.eval(`mpLoginWithEmail()`);
            const msg = authFx.statusDe(wA, 'mpLoginStatus');
            check('A07: credenciais inválidas → mensagem em pt-BR',
              /E-mail ou senha incorretos/i.test(msg), msg);
            check('A07: a mensagem não revela se o e-mail existe',
              !/não existe|não cadastrado|not found/i.test(msg), msg);
            check('A07: a sessão não é criada com credenciais inválidas',
              !wA.localStorage.getItem('mp_sb_auth_v1'));

            const wB = authFx.criarJanelaAuth({
              respostas: {
                '/auth/v1/token?grant_type=password': {
                  status: 400,
                  json: { error: 'invalid_grant', error_code: 'email_not_confirmed',
                    error_description: 'Email not confirmed', msg: 'Email not confirmed' }
                }
              }
            });
            wB.eval(`
              mpAuthAbrir('login');
              document.getElementById('mpAuthEmail').value = 'pendente@exemplo.com';
              document.getElementById('mpAuthSenha').value = ${JSON.stringify(SENHA_OK)};
            `);
            await wB.eval(`mpLoginWithEmail()`);
            check('A08: e-mail não confirmado → pede confirmação em pt-BR',
              /Confirme seu e-mail/i.test(authFx.statusDe(wB, 'mpLoginStatus')),
              authFx.statusDe(wB, 'mpLoginStatus'));
          }

          // --- A09 — clique repetido no login gera um único pedido ---------
          {
            const wA = authFx.criarJanelaAuth({ respostas: authPadrao() });
            wA.eval(`
              mpAuthAbrir('login');
              document.getElementById('mpAuthEmail').value = 'motorista@exemplo.com';
              document.getElementById('mpAuthSenha').value = ${JSON.stringify(SENHA_OK)};
              mpLoginWithEmail(); mpLoginWithEmail(); mpLoginWithEmail();
            `);
            await new Promise(r => setTimeout(r, 300));
            check('A09: três toques em "Entrar" geram um único pedido',
              authFx.pedidosCom(wA, '/auth/v1/token').length === 1,
              authFx.pedidosCom(wA, '/auth/v1/token').length + ' pedido(s)');
          }

          // --- A10/A11/A12 — validação do cadastro ------------------------
          {
            const wA = authFx.criarJanelaAuth({ respostas: authPadrao() });
            wA.eval(`
              mpAuthAbrir('signup');
              document.getElementById('mpSignupEmail').value = 'novo@exemplo.com';
              document.getElementById('mpSignupSenha').value = ${JSON.stringify(SENHA_FRACA)};
              document.getElementById('mpSignupSenha2').value = ${JSON.stringify(SENHA_FRACA)};
            `);
            await wA.eval(`mpSignupWithEmail()`);
            const msg = authFx.statusDe(wA, 'mpLoginStatus');
            check('A10: senha sem maiúscula é recusada citando a regra',
              /MAIÚSCULA/i.test(msg), msg);
            check('A10: senha fraca não chega a criar conta no servidor',
              authFx.pedidosCom(wA, '/auth/v1/signup').length === 0);

            wA.eval(`
              document.getElementById('mpSignupSenha').value = ${JSON.stringify(SENHA_OK)};
              document.getElementById('mpSignupSenha2').value = 'Motorista2';
            `);
            await wA.eval(`mpSignupWithEmail()`);
            check('A11: confirmação diferente é recusada antes da rede',
              /não são iguais/i.test(authFx.statusDe(wA, 'mpLoginStatus')) &&
              authFx.pedidosCom(wA, '/auth/v1/signup').length === 0,
              authFx.statusDe(wA, 'mpLoginStatus'));

            wA.eval(`
              document.getElementById('mpSignupEmail').value = 'invalido@';
              document.getElementById('mpSignupSenha').value = ${JSON.stringify(SENHA_OK)};
              document.getElementById('mpSignupSenha2').value = ${JSON.stringify(SENHA_OK)};
            `);
            await wA.eval(`mpSignupWithEmail()`);
            check('A12: e-mail inválido no cadastro é recusado antes da rede',
              /E-mail inválido/i.test(authFx.statusDe(wA, 'mpLoginStatus')) &&
              authFx.pedidosCom(wA, '/auth/v1/signup').length === 0,
              authFx.statusDe(wA, 'mpLoginStatus'));
          }

          // --- A13 — cadastro com confirmação de e-mail obrigatória -------
          {
            const wA = authFx.criarJanelaAuth({ respostas: authPadrao() });
            wA.eval(`
              mpAuthAbrir('signup');
              document.getElementById('mpSignupNome').value = 'João';
              document.getElementById('mpSignupEmail').value = 'novo@exemplo.com';
              document.getElementById('mpSignupSenha').value = ${JSON.stringify(SENHA_OK)};
              document.getElementById('mpSignupSenha2').value = ${JSON.stringify(SENHA_OK)};
            `);
            await wA.eval(`mpSignupWithEmail()`);
            const ped = authFx.ultimoPedido(wA, '/auth/v1/signup');
            const corpo = ped && authFx.jsonDoCorpo(ped);
            check('A13: o cadastro envia e-mail, senha e nome',
              !!corpo && corpo.email === 'novo@exemplo.com' && corpo.password === SENHA_OK &&
              !!corpo.data && corpo.data.nome === 'João',
              JSON.stringify(corpo && { email: corpo.email, data: corpo.data }));
            check('A13: o cadastro pede retorno explícito para o app (sem confiar no site_url)',
              /redirect_to=com\.pro\.driver%3A%2F%2Foauth-callback|redirect_to=com\.pro\.driver:\/\/oauth-callback/.test(ped.url),
              ped.url);
            check('A13: sem confirmação, nenhuma sessão é criada',
              !wA.localStorage.getItem('mp_sb_auth_v1'));
            check('A13: a mensagem pede confirmação por e-mail',
              /link de confirmação/i.test(authFx.statusDe(wA, 'mpLoginStatus')),
              authFx.statusDe(wA, 'mpLoginStatus'));
            check('A13: depois de criar conta volta ao ecrã de entrar com o e-mail preenchido',
              authFx.visivel(wA, 'mpAuthViewLogin') &&
              wA.document.getElementById('mpAuthEmail').value === 'novo@exemplo.com');
            check('A13: as senhas digitadas não ficam nos campos',
              wA.document.getElementById('mpSignupSenha').value === '' &&
              wA.document.getElementById('mpSignupSenha2').value === '');
          }

          // --- A14 — e-mail que já tem conta (sem enumeração) --------------
          {
            const wA = authFx.criarJanelaAuth({
              respostas: {
                '/auth/v1/signup': {
                  status: 200,
                  json: { id: 'u-existente', email: 'ja@exemplo.com', identities: [] }
                }
              }
            });
            wA.eval(`
              mpAuthAbrir('signup');
              document.getElementById('mpSignupEmail').value = 'ja@exemplo.com';
              document.getElementById('mpSignupSenha').value = ${JSON.stringify(SENHA_OK)};
              document.getElementById('mpSignupSenha2').value = ${JSON.stringify(SENHA_OK)};
            `);
            await wA.eval(`mpSignupWithEmail()`);
            const msg = authFx.statusDe(wA, 'mpLoginStatus');
            check('A14: e-mail já registado recebe mensagem neutra (sem confirmar existência)',
              /Se este e-mail já tiver conta/i.test(msg), msg);
            check('A14: não afirma que criou a conta quando não criou',
              !/Conta criada/i.test(msg), msg);
          }

          // --- A15 — limite de e-mails do Supabase ------------------------
          {
            const wA = authFx.criarJanelaAuth({
              respostas: {
                '/auth/v1/signup': {
                  status: 429,
                  json: { code: 429, error_code: 'over_email_send_rate_limit',
                    msg: 'email rate limit exceeded' }
                }
              }
            });
            wA.eval(`
              mpAuthAbrir('signup');
              document.getElementById('mpSignupEmail').value = 'novo@exemplo.com';
              document.getElementById('mpSignupSenha').value = ${JSON.stringify(SENHA_OK)};
              document.getElementById('mpSignupSenha2').value = ${JSON.stringify(SENHA_OK)};
            `);
            await wA.eval(`mpSignupWithEmail()`);
            const msg = authFx.statusDe(wA, 'mpLoginStatus');
            check('A15: limite de envio → mensagem compreensível, não erro técnico',
              /Muitas tentativas/i.test(msg), msg);
            check('A15: o botão de criar conta é reativado depois do erro',
              wA.document.getElementById('mpBtnSignup').disabled === false);
          }

          // --- A16 — clique repetido no cadastro --------------------------
          {
            const wA = authFx.criarJanelaAuth({ respostas: authPadrao() });
            wA.eval(`
              mpAuthAbrir('signup');
              document.getElementById('mpSignupEmail').value = 'novo@exemplo.com';
              document.getElementById('mpSignupSenha').value = ${JSON.stringify(SENHA_OK)};
              document.getElementById('mpSignupSenha2').value = ${JSON.stringify(SENHA_OK)};
              mpSignupWithEmail(); mpSignupWithEmail();
            `);
            await new Promise(r => setTimeout(r, 300));
            check('A16: dois toques em "Criar conta" geram um único pedido',
              authFx.pedidosCom(wA, '/auth/v1/signup').length === 1,
              authFx.pedidosCom(wA, '/auth/v1/signup').length + ' pedido(s)');
          }

          // --- A17/A18 — recuperação de senha -----------------------------
          {
            const wA = authFx.criarJanelaAuth({ respostas: authPadrao() });
            wA.eval(`
              mpAuthAbrir('forgot');
              document.getElementById('mpForgotEmail').value = 'motorista@exemplo.com';
            `);
            await wA.eval(`mpRequestPasswordReset()`);
            const ped = authFx.ultimoPedido(wA, '/auth/v1/recover');
            check('A17: a recuperação pede o link ao Supabase com o e-mail',
              !!ped && !!authFx.jsonDoCorpo(ped) &&
              authFx.jsonDoCorpo(ped).email === 'motorista@exemplo.com');
            check('A17: a recuperação usa redirectTo explícito (não o site_url localhost)',
              !!ped && /redirect_to=com\.pro\.driver%3A%2F%2Foauth-callback|redirect_to=com\.pro\.driver:\/\/oauth-callback/.test(ped.url),
              ped ? ped.url : 'sem pedido');
            check('A17: a intenção "recovery" fica registada para o retorno do link',
              wA.localStorage.getItem('mp_auth_intent_v1') === 'recovery',
              String(wA.localStorage.getItem('mp_auth_intent_v1')));
            check('A17: a mensagem de recuperação não revela se o e-mail tem conta',
              /Se este e-mail tiver conta/i.test(authFx.statusDe(wA, 'mpLoginStatus')),
              authFx.statusDe(wA, 'mpLoginStatus'));

            const wB = authFx.criarJanelaAuth({ respostas: authPadrao() });
            wB.eval(`
              mpAuthAbrir('forgot');
              document.getElementById('mpForgotEmail').value = 'ninguem@exemplo.com';
              mpRequestPasswordReset(); mpRequestPasswordReset();
            `);
            await new Promise(r => setTimeout(r, 300));
            check('A18: dois toques em "Enviar link" geram um único pedido',
              authFx.pedidosCom(wB, '/auth/v1/recover').length === 1,
              authFx.pedidosCom(wB, '/auth/v1/recover').length + ' pedido(s)');
          }

          // --- A19 — redefinição sem sessão válida ------------------------
          {
            const wA = authFx.criarJanelaAuth({ respostas: authPadrao() });
            wA.eval(`
              mpAuthAbrir('reset');
              document.getElementById('mpResetSenha').value = 'SemSessao1';
              document.getElementById('mpResetSenha2').value = 'SemSessao1';
            `);
            await wA.eval(`mpUpdatePassword()`);
            check('A19: redefinir sem sessão de recuperação pede novo link',
              /expirou|solicite um novo link/i.test(authFx.statusDe(wA, 'mpLoginStatus')),
              authFx.statusDe(wA, 'mpLoginStatus'));
            check('A19: sem sessão nenhum pedido é enviado ao servidor',
              authFx.pedidosCom(wA, '/auth/v1/user').length === 0);

            // Com sessão, mas senha fora da política
            wA.eval(`
              mpAuthAbrir('login');
              document.getElementById('mpAuthEmail').value = 'motorista@exemplo.com';
              document.getElementById('mpAuthSenha').value = ${JSON.stringify(SENHA_OK)};
            `);
            await wA.eval(`mpLoginWithEmail()`);
            wA.eval(`
              mpAuthAbrir('reset');
              document.getElementById('mpResetSenha').value = 'curta1';
              document.getElementById('mpResetSenha2').value = 'curta1';
            `);
            await wA.eval(`mpUpdatePassword()`);
            check('A19: senha fora da política é recusada antes da rede',
              /precisa de/i.test(authFx.statusDe(wA, 'mpLoginStatus')) &&
              authFx.pedidosCom(wA, '/auth/v1/user').length === 0,
              authFx.statusDe(wA, 'mpLoginStatus'));

            wA.eval(`
              document.getElementById('mpResetSenha').value = ${JSON.stringify(SENHA_OK)};
              document.getElementById('mpResetSenha2').value = 'OutraSenha9';
            `);
            await wA.eval(`mpUpdatePassword()`);
            check('A19: confirmação diferente na redefinição é recusada',
              /não são iguais/i.test(authFx.statusDe(wA, 'mpLoginStatus')) &&
              authFx.pedidosCom(wA, '/auth/v1/user').length === 0,
              authFx.statusDe(wA, 'mpLoginStatus'));
          }

          // --- A20 — redefinição concluída --------------------------------
          {
            const wA = authFx.criarJanelaAuth({ respostas: authPadrao() });
            // Sessão real obtida por login (o estado interno do app não é
            // forçado de fora: a sessão nasce do fluxo verdadeiro).
            wA.eval(`
              mpAuthAbrir('login');
              document.getElementById('mpAuthEmail').value = 'motorista@exemplo.com';
              document.getElementById('mpAuthSenha').value = ${JSON.stringify(SENHA_OK)};
            `);
            await wA.eval(`mpLoginWithEmail()`);
            wA.eval(`
              localStorage.setItem('mp_auth_intent_v1', 'recovery');
              mpAuthAbrir('reset');
              document.getElementById('mpResetSenha').value = 'NovaSenha9';
              document.getElementById('mpResetSenha2').value = 'NovaSenha9';
            `);
            await wA.eval(`mpUpdatePassword()`);
            const ped = authFx.ultimoPedido(wA, '/auth/v1/user');
            const corpo = ped && authFx.jsonDoCorpo(ped);
            check('A20: a nova senha é enviada ao Supabase',
              !!corpo && corpo.password === 'NovaSenha9', JSON.stringify(corpo && { password: corpo.password }));
            check('A20: a intenção de recuperação é consumida ao concluir',
              wA.localStorage.getItem('mp_auth_intent_v1') === null);
            check('A20: ao concluir a janela fecha e os campos de senha são limpos',
              wA.document.getElementById('mpLoginScreen').style.display === 'none' &&
              wA.document.getElementById('mpResetSenha').value === '' &&
              wA.document.getElementById('mpResetSenha2').value === '');
            check('A20: o utilizador é avisado de que a senha mudou',
              (wA.__avisos || []).some(a => /Senha alterada/i.test(a)),
              JSON.stringify(wA.__avisos || []));
          }

          // --- A21 — retorno do link de recuperação abre o ecrã certo -----
          {
            const wA = authFx.criarJanelaAuth({
              respostas: Object.assign(authPadrao(), {
                '/auth/v1/token?grant_type=pkce': {
                  status: 200,
                  json: { access_token: 'AT-R', refresh_token: 'RT-R', token_type: 'bearer',
                    expires_in: 3600, user: { id: 'u-rec', email: 'motorista@exemplo.com' } }
                }
              })
            });
            // Fluxo real: iniciar o login gera o verificador PKCE no aparelho,
            // como acontece quando o utilizador toca em "Entrar com Google".
            wA.eval(`mpAuthAbrir('login')`);
            await wA.eval(`mpLoginWithGoogle()`);
            const temVerificador = wA.eval(`mpTemVerificadorPkce()`);
            wA.eval(`localStorage.setItem('mp_auth_intent_v1', 'recovery')`);
            const rel = await wA.eval(`mpTratarRetornoOAuth('com.pro.driver://oauth-callback?code=CODIGO-RECUPERACAO')`);
            check('A21: o login deixa o verificador PKCE guardado no aparelho', temVerificador === true);
            check('A21: o código do link de recuperação é trocado por sessão (PKCE)',
              !!(rel && rel.ok === true), JSON.stringify(rel));
            check('A21: o retorno de recuperação abre a vista de nova senha',
              authFx.visivel(wA, 'mpAuthViewReset') &&
              wA.document.getElementById('mpLoginScreen').style.display === 'flex');
            check('A21: a intenção é consumida (não reabre o ecrã num novo arranque)',
              wA.localStorage.getItem('mp_auth_intent_v1') === null);
            check('A21: a mensagem pede a nova senha',
              /nova senha/i.test(authFx.statusDe(wA, 'mpLoginStatus')),
              authFx.statusDe(wA, 'mpLoginStatus'));
            // Regressão real detetada na revisão: o evento de sessão chegava
            // DEPOIS de abrir o ecrã de nova senha e fechava a janela.
            wA.eval(`mpApplySessionUI()`);
            check('A21: uma mudança de sessão não fecha a janela aberta',
              wA.document.getElementById('mpLoginScreen').style.display === 'flex' &&
              authFx.visivel(wA, 'mpAuthViewReset'));
          }

          // --- A22 — em web o retorno é a própria página ------------------
          {
            const wA = authFx.criarJanelaAuth({ respostas: authPadrao(), nativo: false });
            wA.eval(`
              mpAuthAbrir('forgot');
              document.getElementById('mpForgotEmail').value = 'motorista@exemplo.com';
            `);
            await wA.eval(`mpRequestPasswordReset()`);
            const ped = authFx.ultimoPedido(wA, '/auth/v1/recover');
            check('A22: em web o redirectTo é a página atual (não o deep link)',
              !!ped && /redirect_to=https%3A%2F%2Flocalhost%2Findex\.html|redirect_to=https:\/\/localhost\/index\.html/.test(ped.url),
              ped ? ped.url : 'sem pedido');
          }

          // --- A23 — mostrar senha e checklist dos requisitos -------------
          {
            const wA = authFx.criarJanelaAuth({ respostas: authPadrao() });
            wA.eval(`mpAuthAbrir('signup')`);
            const campo = wA.document.getElementById('mpSignupSenha');
            const olho = wA.document.querySelector('#mpAuthViewSignup .mp-auth-eye');
            wA.eval(`mpAuthVerSenha(document.querySelector('#mpAuthViewSignup .mp-auth-eye'))`);
            check('A23: o botão do olho revela a senha digitada',
              campo.type === 'text', campo.type);
            wA.eval(`mpAuthVerSenha(document.querySelector('#mpAuthViewSignup .mp-auth-eye'))`);
            check('A23: o mesmo botão volta a ocultar', campo.type === 'password', campo.type);

            wA.eval(`
              const i = document.getElementById('mpSignupSenha');
              i.value = 'abc';
              i.dispatchEvent(new Event('input'));
            `);
            const marcados3 = wA.document.querySelectorAll('#mpSignupReq li.ok').length;
            wA.eval(`
              const i = document.getElementById('mpSignupSenha');
              i.value = ${JSON.stringify(SENHA_OK)};
              i.dispatchEvent(new Event('input'));
            `);
            const marcadosOk = wA.document.querySelectorAll('#mpSignupReq li.ok').length;
            check('A23: o checklist marca apenas o que a senha cumpre',
              marcados3 === 1 && marcadosOk === 4,
              'fraca=' + marcados3 + '/4, válida=' + marcadosOk + '/4');
            check('A23: existem quatro requisitos visíveis na política',
              wA.document.querySelectorAll('#mpSignupReq li[data-req]').length === 4);
            check('A23: o campo de senha usa input de senha por padrão',
              (() => {
                const wB = authFx.criarJanelaAuth({ respostas: authPadrao() });
                return wB.document.getElementById('mpSignupSenha').type === 'password';
              })());
          }

          // ============================================================
          // FASE 3 — PORTÃO DE ACESSO (A24 a A32)
          // Nenhuma tela financeira antes da autenticação; dados locais
          // preservados; nada enviado para a nuvem sem sessão validada.
          // ============================================================
          const portao = authFx.criarJanelaPortao;
          const sessaoGuardada = authFx.sessaoGuardada;
          const diaMs = 86400000;
          const pedidosRest = (w) => (w.__pedidos || []).filter(p => /\/rest\/v1\//.test(p.url));
          const escritasRest = (w) => pedidosRest(w).filter(p => p.method !== 'GET');
          const travado = (w) => w.document.documentElement.getAttribute('data-mp-locked') === '1';
          const podeSincronizar = (w) => w.eval(`mpPodeSincronizar()`);

          // --- A24 — arranque sem sessão: portão fechado ------------------
          {
            const w = portao({});
            await new Promise(r => setTimeout(r, 400));
            check('A24: sem sessão a área principal fica invisível (data-mp-locked)',
              travado(w));
            check('A24: sem sessão o conteúdo principal fica inerte (fora da tabulação)',
              !!w.document.querySelector('main.container[inert]') &&
              !!w.document.querySelector('header[inert]'));
            check('A24: sem sessão a janela de autenticação abre na vista de entrar',
              w.document.getElementById('mpLoginScreen').style.display === 'flex' &&
              authFx.visivel(w, 'mpAuthViewLogin'));
            check('A24: sem sessão nada pode ser sincronizado', podeSincronizar(w) === false);
            await w.eval(`mpPushCore()`);
            check('A24: o envio para a nuvem é recusado mesmo chamado à força',
              escritasRest(w).length === 0 && pedidosRest(w).length === 0,
              pedidosRest(w).length + ' pedido(s) à API de dados');
            check('A24: o botão \"continuar sem conta\" já não existe',
              !w.document.getElementById('mpBtnOffline') &&
              !/continuar sem conta/i.test(w.document.body.textContent || ''));
          }

          // --- A25 — sessão válida libera o app ---------------------------
          {
            const w = portao({
              local: {
                mp_sb_auth_v1: sessaoGuardada('u-A', 3600),
                mp_html_state_v8: '{"shifts":[{"id":"s-1"}]}'
              }
            });
            await new Promise(r => setTimeout(r, 600));
            check('A25: sessão válida abre a área financeira', travado(w) === false &&
              !w.document.querySelector('main.container[inert]'));
            check('A25: sessão válida fecha a janela de autenticação',
              w.document.getElementById('mpLoginScreen').style.display === 'none');
            check('A25: sessão validada passa a permitir sincronização', podeSincronizar(w) === true);
            check('A25: o aparelho fica associado à conta que entrou',
              w.localStorage.getItem('mp_device_owner_v1') === 'u-A',
              String(w.localStorage.getItem('mp_device_owner_v1')));
            check('A25: a validação fica datada para a tolerância offline',
              !!w.localStorage.getItem('mp_auth_last_ok_v1') &&
              w.localStorage.getItem('mp_auth_last_user_v1') === 'u-A');
            check('A25: sem demo marcada, os dados locais não são substituídos',
              w.eval('state.shifts.length') === 1);
            // Com acesso liberado o "✕" volta a poder fechar a janela.
            w.eval(`mpAuthAbrir('login')`);
            w.eval(`mpAuthFechar()`);
            check('A25: com acesso liberado o "✕" fecha a janela',
              w.document.getElementById('mpLoginScreen').style.display === 'none');
          }

          // --- A24b — o "✕" não deixa o utilizador num ecrã vazio ---------
          {
            const w = portao({});
            await new Promise(r => setTimeout(r, 400));
            w.eval(`mpAuthFechar()`);
            check('A24b: com o portão fechado o "✕" não fecha a janela',
              w.document.getElementById('mpLoginScreen').style.display === 'flex');
            check('A24b: fechar à força recebe explicação em vez de silêncio',
              /Entre com sua conta/i.test(authFx.statusDe(w, 'mpLoginStatus')),
              authFx.statusDe(w, 'mpLoginStatus'));
          }

          // --- A26 — sessão expirada + offline, validada há 2 dias --------
          {
            const w = portao({
              offline: true,
              falharRede: true,
              local: {
                mp_sb_auth_v1: sessaoGuardada('u-A', -3600),
                mp_auth_last_ok_v1: new Date(Date.now() - 2 * diaMs).toISOString(),
                mp_device_owner_v1: 'u-A'
              }
            });
            await new Promise(r => setTimeout(r, 700));
            check('A26: offline dentro da tolerância abre com os dados locais', travado(w) === false);
            check('A26: acesso por tolerância NÃO é sessão validada (nada sincroniza)',
              podeSincronizar(w) === false && pedidosRest(w).length === 0);
            check('A26: o utilizador é avisado de que a sessão não foi confirmada',
              /Sem conexão: sessão não validada/i.test(w.document.getElementById('mpNotify').textContent || ''),
              (w.document.getElementById('mpNotify').textContent || '').slice(0, 90));
            check('A26: nenhum dado local é apagado por falta de internet',
              w.eval('state.shifts.length') === 1 &&
              !!w.localStorage.getItem('mp_sb_auth_v1'));
            check('A26: ficar offline não é tratado como logout (nada removido)',
              w.localStorage.getItem('mp_device_owner_v1') === 'u-A' &&
              w.localStorage.getItem('mp_offline_mode_v8') === null);
          }

          // --- A27 — sessão expirada + offline, última validação há 8 dias -
          {
            const w = portao({
              offline: true,
              falharRede: true,
              local: {
                mp_sb_auth_v1: sessaoGuardada('u-A', -3600),
                mp_auth_last_ok_v1: new Date(Date.now() - 8 * diaMs).toISOString(),
                mp_device_owner_v1: 'u-A'
              }
            });
            await new Promise(r => setTimeout(r, 700));
            check('A27: tolerância vencida mantém o portão fechado', travado(w));
            check('A27: aparece a vista de falta de conexão com botão de tentar de novo',
              authFx.visivel(w, 'mpAuthViewOffline') &&
              !!w.document.getElementById('mpBtnRetryAuth'));
            check('A27: a mensagem explica que falta internet para validar',
              /internet/i.test(w.document.getElementById('mpAuthViewOffline').textContent || ''));
            check('A27: mesmo bloqueado, os dados locais continuam intactos',
              w.eval('state.shifts.length') === 1 && podeSincronizar(w) === false);
          }

          // --- A28 — reconectar e tentar novamente libera a sessão --------
          {
            const w = portao({
              offline: true,
              falharRede: true,
              local: {
                mp_sb_auth_v1: sessaoGuardada('u-A', -3600),
                mp_auth_last_ok_v1: new Date(Date.now() - 8 * diaMs).toISOString(),
                mp_device_owner_v1: 'u-A'
              }
            });
            await new Promise(r => setTimeout(r, 700));
            Object.defineProperty(w.navigator, 'onLine', { value: true, configurable: true });
            w.eval(`window.__falharRede = false;
              window.__respostas['grant_type=refresh_token'] = ${JSON.stringify(authFx.respostaRefresh('u-A', 3600))};`);
            await w.eval(`mpAuthTentarNovamente()`);
            await new Promise(r => setTimeout(r, 300));
            check('A28: depois de voltar a rede, renovar a sessão libera o app', travado(w) === false);
            check('A28: a sessão renovada volta a permitir sincronização', podeSincronizar(w) === true);
            check('A28: a fila de espera não perde a janela de autenticação',
              w.document.getElementById('mpLoginScreen').style.display === 'none');
          }

          // --- A29 — conta diferente: bloqueia sem apagar nem enviar ------
          {
            const w = portao({
              local: {
                mp_sb_auth_v1: sessaoGuardada('u-B', 3600),
                mp_device_owner_v1: 'u-A',
                mp_html_state_v8: '{"shifts":[{"id":"s-1"}],"expenses":[{"id":"e-1"}]}'
              }
            });
            await new Promise(r => setTimeout(r, 600));
            check('A29: conta diferente da dona do aparelho fica bloqueada', travado(w));
            check('A29: o bloqueio explica o motivo e mostra o que está em risco',
              authFx.visivel(w, 'mpAuthViewBlocked') &&
              /1 turnos · 1 despesas/.test(w.document.getElementById('mpBlockedResumo').textContent || ''),
              (w.document.getElementById('mpBlockedResumo').textContent || '').trim());
            check('A29: conta diferente não sincroniza nada', podeSincronizar(w) === false &&
              escritasRest(w).length === 0);
            check('A29: conta diferente não apaga nem reescreve os dados locais',
              w.eval('state.shifts.length') === 1 &&
              /s-1/.test(w.localStorage.getItem('mp_html_state_v8') || ''));
            check('A29: o bloqueio não associa o aparelho à conta intrusa',
              w.localStorage.getItem('mp_device_owner_v1') === 'u-A');
          }

          // --- A30 — demonstração nunca sobe para a nuvem -----------------
          {
            const w = portao({
              local: { mp_sb_auth_v1: sessaoGuardada('u-A', 3600), mp_demo_data_v1: '1' }
            });
            await new Promise(r => setTimeout(r, 600));
            check('A30: entrar com demo marcada descarta a demonstração',
              w.eval('mpEstadoEhDemo()') === false && w.eval('state.shifts.length') === 0);
            check('A30: a demonstração não gera nenhum envio para a nuvem',
              escritasRest(w).length === 0, escritasRest(w).length + ' escrita(s)');
            check('A30: a conta que entrou fica registada como dona', 
              w.localStorage.getItem('mp_device_owner_v1') === 'u-A');
          }

          // --- A30b — demonstração já editada é preservada -----------------
          {
            const editado = JSON.stringify({ shifts: [{ id: 's-1' }, { id: 's-2' }],
              expenses: [{ id: 'e-1' }], maintenance: [] });
            const w = portao({
              estado: { vehicle: {}, shifts: [{ id: 's-1' }, { id: 's-2' }],
                expenses: [{ id: 'e-1' }], maintenance: [] },
              local: {
                mp_sb_auth_v1: sessaoGuardada('u-A', 3600),
                mp_demo_data_v1: '1',
                // cópia do exemplo original ≠ estado atual → foi o utilizador que editou
                mp_demo_snapshot_v1: JSON.stringify({ shifts: [], expenses: [], maintenance: [] }),
                mp_html_state_v8: editado
              }
            });
            await new Promise(r => setTimeout(r, 600));
            check('A30b: demonstração editada não é apagada ao entrar',
              w.eval('state.shifts.length') === 2,
              w.eval('state.shifts.length') + ' turno(s)');
            check('A30b: o histórico editado continua gravado no aparelho',
              /s-2/.test(w.localStorage.getItem('mp_html_state_v8') || ''));
            check('A30b: a marca de demonstração cai (passa a ser histórico do dono)',
              w.eval('mpEstadoEhDemo()') === false);
            check('A30b: nada é enviado só por causa da demonstração antiga',
              escritasRest(w).length === 0);
          }

          // --- A31 — logout volta ao login sem apagar finanças ------------
          {
            const w = portao({
              local: {
                mp_sb_auth_v1: sessaoGuardada('u-A', 3600),
                mp_device_owner_v1: 'u-A',
                mp_html_state_v8: '{"shifts":[{"id":"s-1"}],"expenses":[{"id":"e-1"}]}'
              }
            });
            await new Promise(r => setTimeout(r, 600));
            await w.eval(`mpLogout()`);
            await new Promise(r => setTimeout(r, 200));
            check('A31: o logout volta a fechar a área financeira', travado(w) &&
              w.document.getElementById('mpLoginScreen').style.display === 'flex');
            check('A31: o logout encerra a sessão guardada',
              w.localStorage.getItem('mp_sb_auth_v1') === null);
            check('A31: o logout preserva o histórico financeiro local',
              /s-1/.test(w.localStorage.getItem('mp_html_state_v8') || '') &&
              w.eval('state.shifts.length') === 1);
            check('A31: o logout não pede ao servidor para apagar dados',
              w.__pedidos.filter(p => p.method === 'DELETE').length === 0);
            check('A31: o logout não deixa atalho para entrar sem conta',
              w.localStorage.getItem('mp_offline_mode_v8') === null &&
              podeSincronizar(w) === false);
          }

          // --- A32 — rede pendurada: o arranque não fica preso ------------
          {
            // navigator.onLine diz \"online\", mas os pedidos morrem. O cliente
            // do Supabase repetiria a renovação por ~26 s; o prazo do portão
            // tem de decidir antes disso.
            const inicio = Date.now();
            const w = portao({
              falharRede: true,
              local: {
                mp_sb_auth_v1: sessaoGuardada('u-A', -3600),
                mp_auth_last_ok_v1: new Date(Date.now() - 1 * diaMs).toISOString(),
                mp_device_owner_v1: 'u-A'
              }
            });
            await new Promise(r => setTimeout(r, 8000));
            const decorrido = Date.now() - inicio;
            check('A32: com a rede pendurada o portão decide em segundos (não 26 s)',
              decorrido < 12000 && travado(w) === false, decorrido + ' ms');
            check('A32: decidiu pela tolerância offline e não ficou em \"Verificando…\"',
              podeSincronizar(w) === false &&
              w.document.getElementById('mpLoginScreen').style.display === 'none');
          }

          // ============================================================
          // ANDROID — consistência dos assets e do APK (verificação estática)
          // ============================================================
          const { execFileSync } = require('child_process');
          const raizProj = path.join(__dirname, '..');
          let assetsOk = false, assetsSaida = '';
          try {
            assetsSaida = execFileSync(process.execPath, [path.join(raizProj, 'scripts/verify-android-assets.js')],
              { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
            assetsOk = true;
          } catch (e) {
            assetsSaida = String((e.stdout || '') + (e.stderr || ''));
          }
          check('Android: assets empacotados apontam para o projeto correto e estão sincronizados',
            assetsOk, assetsOk ? '' : assetsSaida.split('\n').filter(l => l.includes('✘')).join(' | '));

          // O verificador tem de REPROVAR um APK com o projeto antigo ou versão
          // errada — senão é um selo que aprova tudo e não protege nada.
          const axml = require('./lib/axml-fixture.js');
          const cfgTexto = fs.readFileSync(path.join(WWW, 'js/config.js'), 'utf8');
          const versaoAtual = JSON.parse(fs.readFileSync(path.join(raizProj, 'package.json'), 'utf8')).version;
          const [pmaj, pmin, ppat] = versaoAtual.split('.').map(Number);
          const vcAtual = pmaj * 10000 + pmin * 100 + ppat;
          const manifestOk = () => axml.build({ pkg: 'com.pro.driver', versionName: versaoAtual, versionCode: vcAtual });
          const tmpApk = (nome, ficheiros) => {
            const destino = path.join(require('os').tmpdir(), 'mp-teste-' + nome + '.zip');
            axml.zip(ficheiros, destino);
            return destino;
          };
          const correrVerificador = apk => {
            try {
              execFileSync(process.execPath, [path.join(raizProj, 'scripts/verify-apk.js'), apk],
                { encoding: 'utf8', stdio: 'pipe' });
              return { ok: true, saida: '' };
            } catch (e) {
              return { ok: false, saida: String((e.stdout || '') + (e.stderr || '')) };
            }
          };
          check('Android: verificador APROVA um APK correto (fixture)', correrVerificador(tmpApk('bom', [
            ['AndroidManifest.xml', manifestOk()],
            ['assets/public/js/config.js', Buffer.from(cfgTexto)]
          ])).ok === true);
          const rVelho = correrVerificador(tmpApk('velho', [
            ['AndroidManifest.xml', axml.build({ pkg: 'com.pro.driver', versionName: '1.0', versionCode: 1 })],
            ['assets/public/js/config.js', Buffer.from(cfgTexto)]
          ]));
          check('Android: verificador REPROVA versionCode/versionName antigos', rVelho.ok === false && /versionCode/.test(rVelho.saida));
          const rAntigo = correrVerificador(tmpApk('antigo', [
            ['AndroidManifest.xml', manifestOk()],
            ['assets/public/js/config.js', Buffer.from(cfgTexto.replace('xncxzczftetctpazzecu', 'ewmtphddypfcllewkgzl'))]
          ]));
          check('Android: verificador REPROVA o projeto Supabase antigo', rAntigo.ok === false && /projeto antigo/.test(rAntigo.saida));
          const rSegredo = correrVerificador(tmpApk('segredo', [
            ['AndroidManifest.xml', manifestOk()],
            ['assets/public/js/config.js', Buffer.from(cfgTexto.replace(/sb_publishable_[A-Za-z0-9_]+/, 'sb_secret_abc123'))]
          ]));
          check('Android: verificador REPROVA chave secreta no pacote', rSegredo.ok === false && /secreta/.test(rSegredo.saida));

          check('sem erros de runtime', errors.length === 0, errors.length ? errors.slice(0, 5) : 'nenhum');

          server.close();
          process.exit(failures ? 1 : 0);
        }, 1800);
      });
    }, 1800);
  }).catch(e => { console.error('FATAL', e); server.close(); process.exit(1); });
});
