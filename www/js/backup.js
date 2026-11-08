// MotoristaPro — Backup automático rotativo (C-02 da auditoria)
//
// Problema corrigido: o histórico (199 turnos, 3,3 meses) só existia em
// localStorage. "Limpar dados do site", modo privado, falha de gravação ou
// desinstalação apagavam tudo, sem cópia.
//
// Princípios:
//  - NUNCA apaga nem substitui o estado atual. Só escreve cópias.
//  - 3 cópias rotativas (1 = mais recente), em dois destinos quando há
//    armazenamento nativo (DOCUMENTS) e sempre no localStorage como rede
//    de segurança que funciona até no browser.
//  - Verificação de integridade ao restaurar: se a cópia estiver corrompida
//    ou mais pobre que o estado atual, recusa e diz porquê.
//  - Silencioso: não interrompe o utilizador; só avisa quando falha.

const MP_BACKUP_PREFIX = 'mp_backup_v8_';
const MP_BACKUP_SLOTS = 3;
const MP_BACKUP_META = 'mp_backup_meta_v8';
const MP_BACKUP_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

// ---------- modelo de uma cópia ----------
function mpBackupStats(st) {
  const s = st || {};
  return {
    turnos: (s.shifts || []).length,
    despesas: (s.expenses || []).length,
    manutencoes: (s.maintenance || []).length,
    brutoC: (s.shifts || []).reduce((a, x) => a + (Number(x && x.gross) || 0), 0)
  };
}

function mpBackupRead(slot) {
  try {
    const raw = localStorage.getItem(MP_BACKUP_PREFIX + slot);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.state) return null;
    return parsed;
  } catch (e) {
    logEvent('warn', 'Cópia de segurança ilegível', { slot, message: e && e.message });
    return null;
  }
}

// A lista é pedida pelo render() a cada alteração. Sem cache, cada render fazia
// JSON.parse de 3 cópias de ~81 KB. A cache é indexada por uma assinatura
// barata do conteúdo cru (tamanho + prefixo): continua correta se algo apagar
// ou escrever slots por fora desta função, sem pagar o parse.
let mpBackupCache = null;

function mpBackupList() {
  const crus = [];
  for (let i = 1; i <= MP_BACKUP_SLOTS; i++) {
    crus.push(localStorage.getItem(MP_BACKUP_PREFIX + i) || '');
  }
  const assinatura = crus.map(r => r.length + ':' + r.slice(0, 24)).join('|');
  if (mpBackupCache && mpBackupCache.assinatura === assinatura) return mpBackupCache.lista;

  const lista = [];
  crus.forEach((raw, idx) => {
    if (!raw) return;
    try {
      const b = JSON.parse(raw);
      if (b && b.state) {
        lista.push({ slot: idx + 1, at: b.at, stats: mpBackupStats(b.state), bytes: raw.length });
      }
    } catch (e) {
      logEvent('warn', 'Cópia de segurança ilegível', { slot: idx + 1, message: e && e.message });
    }
  });
  mpBackupCache = { assinatura, lista };
  return lista;
}

// Escreve uma cópia, deslocando as anteriores. A mais antiga (slot 3) sai.
// Devolve um relatório do que aconteceu, para poder ser testado.
function mpBackupRotate() {
  const relatorio = { ok: false, escrito: null, deslocadas: 0, erro: null, destinoNativo: null };
  let payload;
  try {
    payload = JSON.stringify({ at: new Date().toISOString(), version: APP_VERSION, state });
  } catch (e) {
    relatorio.erro = 'serializacao: ' + (e && e.message);
    return relatorio;
  }

  // Se o estado está vazio, uma cópia de "vazio" destruiria a rotação ao
  // ocupar um slot útil. Só fazemos backup de estados com conteúdo.
  const stats = mpBackupStats(state);
  if (stats.turnos === 0 && stats.despesas === 0 && stats.manutencoes === 0) {
    relatorio.erro = 'estado vazio — cópia ignorada para não ocupar slot';
    return relatorio;
  }

  try {
    // desloca 2->3, 1->2
    for (let i = MP_BACKUP_SLOTS - 1; i >= 1; i--) {
      const anterior = localStorage.getItem(MP_BACKUP_PREFIX + i);
      if (anterior) {
        localStorage.setItem(MP_BACKUP_PREFIX + (i + 1), anterior);
        relatorio.deslocadas++;
      }
    }
    localStorage.setItem(MP_BACKUP_PREFIX + 1, payload);
    relatorio.escrito = 1;
    relatorio.ok = true;
    relatorio.bytes = payload.length;
    localStorage.setItem(MP_BACKUP_META, JSON.stringify({
      ultimo: new Date().toISOString(), stats, bytes: payload.length, version: APP_VERSION
    }));
  } catch (e) {
    // Quota: a rotação pode falhar por espaço. Não propagar — o backup é
    // acessório e não pode impedir o utilizador de gravar o turno.
    relatorio.erro = 'quota: ' + (e && e.message);
    logEvent('warn', 'Backup rotativo falhou (quota?)', { message: e && e.message });
    return relatorio;
  }

  // Segunda cópia no sistema de ficheiros (só no app nativo). Assíncrono,
  // sem bloquear e sem falhar o fluxo se não estiver disponível.
  if (typeof isNativeCapacitorApp === 'function' && isNativeCapacitorApp()) {
    try {
      const Filesystem = typeof getCapacitorPlugin === 'function' ? getCapacitorPlugin('Filesystem') : null;
      if (Filesystem) {
        const nome = `backup-rotativo-${new Date().toISOString().slice(0, 10)}.json`;
        Promise.resolve(Filesystem.writeFile({
          path: `MotoristaPro/backups/${nome}`,
          data: payload,
          directory: 'DOCUMENTS',
          encoding: 'utf8',
          recursive: true
        })).then(() => { relatorio.destinoNativo = 'DOCUMENTS/MotoristaPro/backups/' + nome; })
          .catch(() => {});
      }
    } catch (_) { /* opcional */ }
  }

  return relatorio;
}

// Backup condicionado por tempo e por alteração real do estado.
function mpBackupMaybe(force) {
  let meta = null;
  try { meta = JSON.parse(localStorage.getItem(MP_BACKUP_META) || 'null'); } catch (_) {}
  const agora = Date.now();
  const ultimo = meta && meta.ultimo ? Date.parse(meta.ultimo) : 0;
  const stats = mpBackupStats(state);
  const mudou = !meta || !meta.stats ||
    meta.stats.turnos !== stats.turnos || meta.stats.despesas !== stats.despesas ||
    meta.stats.manutencoes !== stats.manutencoes;

  if (!force) {
    if (!mudou) return { ok: false, erro: 'sem alterações desde a última cópia' };
    if (ultimo && (agora - ultimo) < MP_BACKUP_MIN_INTERVAL_MS) {
      return { ok: false, erro: 'cópia recente (intervalo mínimo de 6h)' };
    }
  }
  return mpBackupRotate();
}

// ---------- restauro ----------
// Só aplica se a cópia for válida E não representar uma perda grande face ao
// estado atual. Devolve {ok, motivo, stats}.
function mpBackupRestore(slot) {
  const bk = mpBackupRead(slot);
  if (!bk) return { ok: false, motivo: 'cópia inexistente ou ilegível' };

  const statsCopia = mpBackupStats(bk.state);
  const statsAtual = mpBackupStats(state);
  // "Vazia" = sem turnos, despesas E manutenções. Contar só os dois primeiros
  // recusava desfazer um restauro quando o estado de origem tinha apenas
  // manutenções (caso real: base de demonstração com 0 turnos).
  if (statsCopia.turnos === 0 && statsCopia.despesas === 0 && statsCopia.manutencoes === 0) {
    return { ok: false, motivo: 'cópia vazia — restauro recusado' };
  }

  // Guarda o estado atual antes de o substituir, para o restauro ser reversível.
  const antes = JSON.stringify({ at: new Date().toISOString(), version: APP_VERSION, state });
  try { localStorage.setItem(MP_BACKUP_PREFIX + 'pre_restore', antes); } catch (_) {}

  let migrado;
  try {
    migrado = migrateState(bk.state);
  } catch (e) {
    return { ok: false, motivo: 'cópia inválida: ' + (e && e.message) };
  }

  state = migrado;
  try {
    localStorage.setItem('mp_html_state_v8', JSON.stringify(state));
  } catch (e) {
    return { ok: false, motivo: 'não foi possível gravar o restauro (quota)' };
  }
  if (typeof syncVehicleOdometer === 'function') syncVehicleOdometer();
  if (typeof render === 'function') render();
  logEvent('info', 'Restauro de cópia aplicado', { slot, de: statsAtual, para: statsCopia });
  return { ok: true, motivo: 'restaurado', de: statsAtual, para: statsCopia, at: bk.at };
}

// Desfazer o último restauro (a cópia guardada antes de substituir).
function mpBackupUndoRestore() {
  return mpBackupRestore('pre_restore');
}

// ---------- UI ----------
function renderBackupPanel() {
  const box = document.getElementById('backupListBox');
  const meta = document.getElementById('backupMetaBox');
  if (!box || !meta) return;

  const lista = mpBackupList();
  const stats = mpBackupStats(state);
  let m = null;
  try { m = JSON.parse(localStorage.getItem(MP_BACKUP_META) || 'null'); } catch (_) {}

  meta.innerHTML = m
    ? `Última cópia: <strong>${new Date(m.ultimo).toLocaleString('pt-BR')}</strong> · ` +
      `${m.stats.turnos} turnos · ${(m.bytes / 1024).toFixed(0)} KB · automática a cada 6h quando há alterações`
    : 'Ainda não há cópia automática. A primeira é criada ao gravar o próximo registro.';

  if (lista.length === 0) {
    box.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:16px;background:rgba(0,0,0,.2);border-radius:10px;">Nenhuma cópia guardada ainda.</div>';
    return;
  }

  box.innerHTML = lista.map(b => `
    <div class="list-item" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
      <div>
        <strong style="font-size:13px;color:#fff;">Cópia ${b.slot}${b.slot === 1 ? ' (mais recente)' : ''}</strong>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
          ${new Date(b.at).toLocaleString('pt-BR')} · ${b.stats.turnos} turnos · ${b.stats.despesas} despesas · ${(b.bytes / 1024).toFixed(0)} KB
        </div>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="onRestoreBackup(${b.slot})">Restaurar</button>
    </div>`).join('') +
    (localStorage.getItem(MP_BACKUP_PREFIX + 'pre_restore')
      ? '<button class="btn btn-secondary btn-sm" style="margin-top:8px;width:100%;" onclick="onUndoRestore()">↩ Desfazer último restauro</button>'
      : '') +
    `<div style="font-size:10px;color:var(--text-dim);margin-top:8px;">Estado atual: ${stats.turnos} turnos · ${stats.despesas} despesas. O restauro guarda o estado atual antes de substituir.</div>`;
}

function onRestoreBackup(slot) {
  const lista = mpBackupList().find(b => b.slot === slot);
  if (!lista) { alert('Cópia não encontrada.'); return; }
  const stats = mpBackupStats(state);
  const msg = `Restaurar a cópia de ${new Date(lista.at).toLocaleString('pt-BR')}?\n\n` +
    `A cópia tem ${lista.stats.turnos} turnos e ${lista.stats.despesas} despesas.\n` +
    `O estado atual tem ${stats.turnos} turnos e ${stats.despesas} despesas — ` +
    `será guardado e poderá ser recuperado com "Desfazer".`;
  if (!confirm(msg)) return;
  const r = mpBackupRestore(slot);
  if (r.ok) {
    mpNotify(`Cópia restaurada: ${r.para.turnos} turnos.`);
  } else {
    mpNotify('Restauro recusado: ' + r.motivo, 'error');
  }
  renderBackupPanel();
}

function onUndoRestore() {
  const r = mpBackupUndoRestore();
  mpNotify(r.ok ? 'Restauro desfeito.' : 'Nada a desfazer: ' + r.motivo, r.ok ? undefined : 'error');
  renderBackupPanel();
}

function onForceBackup() {
  const r = mpBackupRotate();
  if (r.ok) mpNotify(`Cópia criada (${(r.bytes / 1024).toFixed(0)} KB).`);
  else mpNotify('Não foi possível criar a cópia: ' + r.erro, 'error');
  renderBackupPanel();
}
