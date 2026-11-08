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
          // ============================================================
          check('M-06: 57 labels associados a um campo existente', w2.eval(`
            (() => {
              const labels = Array.from(document.querySelectorAll('label'));
              const semFor = labels.filter(l => !l.getAttribute('for'));
              const orfaos = labels.filter(l => l.getAttribute('for') && !document.getElementById(l.getAttribute('for')));
              return { total: labels.length, semFor: semFor.length, orfaos: orfaos.length };
            })()`).total === 57);
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
