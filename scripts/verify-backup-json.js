#!/usr/bin/env node
/**
 * Verificação de integridade de um backup JSON exportado pelo app
 * ("☁️ Exportar ficheiro" / "☁️ Salvar Backup").
 *
 * Uso:
 *   node scripts/verify-backup-json.js <backup.json>
 *   node scripts/verify-backup-json.js <backup.json> --turnos 200 --despesas 32 --manutencoes 4
 *   TURNOS=200 DESPESAS=32 MANUTENCOES=4 node scripts/verify-backup-json.js <backup.json>
 *
 * O que verifica (exit 0 = OK, exit 1 = FALHA):
 *  - ficheiro existe, não vazio, JSON válido;
 *  - estrutura: vehicle (objeto) + shifts/expenses/maintenance (arrays);
 *  - cada turno é objeto com data YYYY-MM-DD; cada despesa tem data e valor
 *    numérico; cada manutenção tem nome (registos malformados quebram o
 *    render/import — por isso falham aqui);
 *  - contagens exatas, quando esperadas via --turnos/--despesas/--manutencoes
 *    (ou env TURNOS/DESPESAS/MANUTENCOES);
 *  - avisa (sem falhar): ids duplicados, recorrentes/parceladas ausentes.
 *
 * Imprime no fim: contagens, intervalo de datas, totais em R$ e RESULTADO.
 */
const fs = require('fs');

const ARQ = process.argv[2];
const problemas = [];
const avisos = [];
const ok = [];

function arg(nome) {
  const i = process.argv.indexOf('--' + nome);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : null;
}
const esp = {
  turnos: arg('turnos') ?? (process.env.TURNOS ? Number(process.env.TURNOS) : null),
  despesas: arg('despesas') ?? (process.env.DESPESAS ? Number(process.env.DESPESAS) : null),
  manutencoes: arg('manutencoes') ?? (process.env.MANUTENCOES ? Number(process.env.MANUTENCOES) : null)
};

if (!ARQ || !fs.existsSync(ARQ)) {
  console.error('✘ ficheiro não encontrado: ' + (ARQ || '(sem argumento)'));
  process.exit(1);
}
const bytes = fs.statSync(ARQ).size;
if (bytes === 0) { console.error('✘ ficheiro vazio'); process.exit(1); }
ok.push(`ficheiro ${(bytes / 1024).toFixed(1)} KB`);

let st;
try {
  st = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
  ok.push('JSON válido');
} catch (e) {
  console.error('✘ JSON inválido: ' + e.message);
  process.exit(1);
}

if (!st || typeof st !== 'object') { console.error('✘ raiz não é um objeto'); process.exit(1); }
if (!st.vehicle || typeof st.vehicle !== 'object') problemas.push('vehicle ausente ou inválido');
else ok.push('vehicle presente');
for (const c of ['shifts', 'expenses', 'maintenance']) {
  if (!Array.isArray(st[c])) problemas.push(`coleção "${c}" ausente ou não é array`);
}
if (problemas.length) { console.error('✘ ' + problemas.join(' | ')); process.exit(1); }
const n = {
  turnos: st.shifts.length,
  despesas: st.expenses.length,
  manutencoes: st.maintenance.length
};
const pl = (v, s, p) => `${v} ${v === 1 ? s : p}`;
ok.push(`${pl(n.turnos, 'turno', 'turnos')} · ${pl(n.despesas, 'despesa', 'despesas')} · ${pl(n.manutencoes, 'manutenção', 'manutenções')}`);

const dataOk = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
let turnosInvalidos = 0, despesasInvalidas = 0, manutInvalidas = 0;
st.shifts.forEach(s => { if (!s || typeof s !== 'object' || !dataOk(s.date)) turnosInvalidos++; });
st.expenses.forEach(e => {
  if (!e || typeof e !== 'object' || !dataOk(e.date) || !(Number(e.amount) >= 0)) despesasInvalidas++;
});
st.maintenance.forEach(m => { if (!m || typeof m !== 'object' || !m.name) manutInvalidas++; });
if (turnosInvalidos) problemas.push(`${turnosInvalidos} turno(s) sem data válida`);
if (despesasInvalidas) problemas.push(`${despesasInvalidas} despesa(s) sem data/valor válido`);
if (manutInvalidas) problemas.push(`${manutInvalidas} manutenção(ões) sem nome`);
if (!turnosInvalidos && !despesasInvalidas && !manutInvalidas) ok.push('todos os registos bemformados');

for (const [campo, chave] of [['turnos', 'shifts'], ['despesas', 'expenses'], ['manutencoes', 'maintenance']]) {
  if (esp[campo] !== null && esp[campo] !== undefined && !Number.isNaN(esp[campo])) {
    if (n[campo] !== esp[campo]) problemas.push(`${campo}: esperado ${esp[campo]}, encontrado ${n[campo]}`);
    else ok.push(`${campo} = ${esp[campo]} (confere)`);
  }
}

for (const [campo, chave] of [['turnos', 'shifts'], ['despesas', 'expenses'], ['manutencoes', 'maintenance']]) {
  const vistos = new Set(); let dup = 0;
  st[chave].forEach(x => {
    if (x && x.id != null) {
      const k = String(x.id);
      if (vistos.has(k)) dup++; else vistos.add(k);
    }
  });
  if (dup) avisos.push(`${dup} id(s) duplicado(s) em ${campo}`);
}
if (!Array.isArray(st.recurring)) avisos.push('sem coleção "recurring" (backup de versão antiga?)');
if (!Array.isArray(st.installments)) avisos.push('sem coleção "installments" (backup de versão antiga?)');

const datas = st.shifts.map(s => s.date).filter(dataOk).sort();
const soma = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const bruto = soma(st.shifts, s => (s.apps || []).reduce((a, ap) => a + (Number(ap.gross) || 0) + (Number(ap.tips) || 0), 0));
const gasto = soma(st.expenses, e => e.amount);
const brl = v => 'R$ ' + v.toFixed(2).replace('.', ',');

console.log('--- backup: ' + ARQ + ' ---');
ok.forEach(o => console.log('✔ ' + o));
avisos.forEach(a => console.log('! ' + a));
if (datas.length) console.log(`período: ${datas[0]} → ${datas[datas.length - 1]}`);
console.log(`bruto somado (apps+ganhos): ${brl(bruto)} · despesas somadas: ${brl(gasto)}`);
if (problemas.length) {
  problemas.forEach(p => console.log('✘ ' + p));
  console.log('RESULTADO: FALHA');
  process.exit(1);
}
console.log('RESULTADO: OK');
