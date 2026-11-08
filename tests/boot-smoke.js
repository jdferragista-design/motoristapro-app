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

          check('sem erros de runtime', errors.length === 0, errors.length ? errors.slice(0, 5) : 'nenhum');

          server.close();
          process.exit(failures ? 1 : 0);
        }, 1800);
      });
    }, 1800);
  }).catch(e => { console.error('FATAL', e); server.close(); process.exit(1); });
});
