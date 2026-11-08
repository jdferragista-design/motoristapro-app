# MotoristaPro — Diagnóstico Financeiro com Dados Reais

**Fonte:** `motoristapro_backup_2026-11-08.json` (136.658 bytes) — exportado pelo próprio app
**Período:** 01/08/2026 a 07/11/2026 (99 dias, **83 dias trabalhados**)
**Volume:** **199 turnos** · 289 lançamentos de app · 1.063 viagens · 6.848,7 km · 520,1 h
**Despesas:** 32 registros · 17 abastecimentos · 478,6 L
**Veículo:** Corolla híbrido · odômetro 106.068 km
**Método:** dados carregados **no próprio app** (jsdom, assets reais) + análise independente em Python. Nenhum arquivo do repositório foi alterado.

> **Revisão 4 — fatos confirmados pelo proprietário**
> 1. A parcela do carro de **novembro é a 14/60** (vence 05/11), **paga adiantada em 27/10**. Por isso novembro não tem lançamento "fixo".
> 2. Pneus: **financiamento** de R$ 2.828,17 em **10× de R$ 282,82** (compra 19/06/2026, 1ª parcela 10/07). "01/10"…"05/10" são as parcelas 1 a 5.
> 3. Parcela **contratual R$ 3.147,57** no vencimento; pagando ~10 dias antes, paga R$ 3.116–3.123 (desconto de R$ 24,59 a R$ 30,71).
> 4. **"Gol proteção" (R$ 459,23) e MEI/DAS são mensais.** A **internet de R$ 123,71 é bimestral** (dois meses em atraso) → **R$ 61,85/mês**. E o proprietário **não lança essas despesas** porque o app não tem despesa recorrente.

---

## 1. O resultado, corrigido

### 1.1 Custo fixo mensal real

| Item | Valor/mês |
|---|---:|
| Prestação do carro (contratual) | R$ 3.147,57 |
| Gol proteção | R$ 459,23 |
| Internet (R$ 123,71 ÷ 2 meses) | R$ 61,85 |
| MEI / DAS (média dos 2 registros) | R$ 88,06 |
| **Total fixo** | **R$ 3.756,71** |

### 1.2 Resultado dos 3 meses fechados (ago–out)

| Item | Valor/mês | % do bruto |
|---|---:|---:|
| Bruto | **R$ 5.454,99** | 100% |
| Combustível (real, abastecimentos) | −R$ 480,99 | 8,8% |
| Manutenção (inclui parcela dos pneus R$ 282,82) | −R$ 452,82 | 8,3% |
| Lavagem | −R$ 33,33 | 0,6% |
| **Custo fixo** | **−R$ 3.756,71** | **68,9%** |
| **Sobra** | **R$ 731,14** | **13,4%** |

### 1.3 O mesmo número em tempo

| Base | Valor |
|---|---:|
| **Hora na rua** (291 h/mês, inclui ociosidade) | **R$ 2,51/h** |
| Hora trabalhada (157 h/mês) | R$ 4,65/h |
| Dia trabalhado (25/mês) | R$ 29,25 |
| Margem | 13,4% |

**Referência:** um salário mínimo (~R$ 1.500) em 220 h/mês equivale a ~R$ 6,80/h. A atividade rende hoje **R$ 2,51 por hora na rua — cerca de 0,4× o mínimo**, e R$ 4,65/h pelo critério mais generoso (contando só o tempo de turno).

### 1.4 Mês a mês, com o custo fixo correto

| Mês | Bruto | Variável | Fixo | **Sobra** | Margem |
|---|---:|---:|---:|---:|---:|
| Ago/2026 | 5.853,06 | 1.152,50 | 3.756,71 | **943,85** | 16,1% |
| Set/2026 | 5.070,32 | 876,09 | 3.756,71 | **437,52** | 8,6% |
| Out/2026 | 5.441,58 | 872,83 | 3.756,71 | **812,04** | 14,9% |

> Novembro não entra na comparação: são 5 dias de bruto contra uma parcela mensal cheia.

### 1.5 Rateio confirmado: 85% a 95% do carro é atividade

O proprietário confirmou que o Corolla é usado **entre 85% e 95%** para o trabalho de app. Recalculando:

| Rateio | Sobra/mês | R$/h na rua |
|---|---:|---:|
| 85% | R$ 1.203,27 | **R$ 4,13** |
| 90% | R$ 1.045,89 | **R$ 3,59** |
| 95% | R$ 888,52 | **R$ 3,05** |

**A faixa real é R$ 889 a R$ 1.203 por mês, e R$ 3,05 a R$ 4,13 por hora na rua.** Melhor que os R$ 2,51/h do rateio integral, mas ainda abaixo de um salário mínimo por hora (~R$ 6,80).

> **Ponto central:** esse número — 85%, 90% ou 95% — muda o resultado em **R$ 315/mês (43%)**. É a variável mais sensível do negócio, e o app não tem como calculá-la nem deixa o usuário informá-la. Os **1.858 km fora de serviço** são exatamente o dado que permitiria estimá-la automaticamente.

### 1.6 Sensibilidade — e a pergunta que o app deveria responder

O número de R$ 2,51/h assume que **100% do carro é custo da atividade**. Se parte do uso é pessoal, o resultado melhora:

| Rateio do carro à atividade | Sobra/mês | R$/h na rua |
|---|---:|---:|
| 100% (como está hoje) | R$ 731,14 | **R$ 2,51** |
| 85% | R$ 1.203,27 | R$ 4,13 |
| 70% | R$ 1.675,41 | R$ 5,76 |
| 50% | R$ 2.304,92 | R$ 7,92 |

**Nenhum desses cenários é confortável**, e — este é o ponto — **o app tem os dados para calcular o rateio e não usa**: os **1.858 km "fora de serviço"** registrados entre jornadas são exatamente o sinal de uso pessoal, e a provisão de 0,25/km aplicada sobre eles (R$ 465, ≈ 64% da sobra mensal) já os está cobrando como se fossem custo da atividade.

---

## 2. O app exibe R$ 34,22/h. A realidade é R$ 2,51/h.

| Indicador | O app mostra | Realidade | Erro |
|---|---:|---:|---:|
| **R$/h** | R$ 34,22 | **R$ 2,51** | **13,6× inflado** |
| R$/km | R$ 2,64 | **R$ 0,353** (sobra ÷ km) | **7,5× inflado** |
| Lucro (período "tudo") | R$ 2.150,99 | R$ 2.420,06 de sobra acumulada | 12% otimista |
| Lucro (novembro) | R$ 854,81 | **−R$ 2.191,63** (com a prestação) | sinal invertido |
| Meta mensal | "77% ou 123%" | 78% da meta, média histórica | projeção instável |

**A discrepância de R$/km é a mais reveladora.** O app calcula R$/km como *faturamento bruto por km* — R$ 2,64. Mas o motorista quer saber **quanto sobra por km**: R$ 0,353. E como o custo fixo (R$ 3.756,71) é independente de rodar mais ou menos, **cada km adicional melhora muito a sobra marginal** — informação que o app não tem como dar e que mudaria decisões práticas (aceitar corrida longa, compensar dia fraco).

---

## 3. Por que ele "esquece de lançar" — e por que isso é o achado central

O proprietário registrou **199 turnos em 3 meses** com disciplina notável: zero horas zeradas, zero duplicidade, zero divergência de horário. **A disciplina não é o problema.**

O que ele não registrou foi **exatamente aquilo que se repete**: gol proteção (1 registro em 3,3 meses), internet (1), MEI (2). Não por descuido em 199 lançamentos — mas porque **o app obriga a redigitar a mesma despesa todo mês**, e isso é o único tipo de lançamento em que ele falhou.

> **R$ 609,14 por mês — R$ 7.309,68 por ano — estão fora do histórico** simplesmente porque o app não tem despesa recorrente.

E o efeito em cascata:

1. **O painel subestima o custo em R$ 609/mês**, porque o card "Despesas" só soma o que foi lançado.
2. **O usuário não sabe que está abaixo do mínimo por hora** — o número que poderia mudá-lo a decidir está ausente dos dados.
3. **O próprio usuário descobriu isso por conta própria**, numa conversa de diagnóstico, três meses depois. Foi ele quem trouxe as parcelas, o valor contratual e a periodicidade da internet. **O app não perguntou.**

Esse é o teste definitivo de um app de controle financeiro: ele deveria ter percebido que "gol proteção" apareceu uma vez em 90 dias e perguntado *"isso é mensal? quer que eu repita?"*. Não perguntou — e por isso o diagnóstico mais importante da vida financeira do usuário dependeu de uma conversa externa.

---

## 4. Achados confirmados (todos verificados nos dados)

| # | Achado | Evidência | Gravidade |
|---|---|---|---|
| **R1** | **R$/h ignora ociosidade entre turnos** | 34,22 → 18,48 (−46%); 97% dos dias multi-turno com gap > 2h; 443 h ociosas vs 520 h trabalhadas | **Crítica** |
| **R2** | **Sem regime de competência** | 12/60→set, 13/60→out, 14/60→nov, todas pagas ~10 dias antes; novembro exibe prestação R$ 0 | **Crítica** |
| **R3** | **Sem despesa recorrente** | R$ 609,14/mês (R$ 7.309,68/ano) fora do histórico; usuário declara "esqueço de lançar" | **Crítica (nova)** |
| **R4** | **R$/km e R$/h são brutos, não sobra** | R$ 2,64/km e R$ 34,22/h vs R$ 0,353/km e R$ 2,51/h | **Crítica (nova)** |
| **R5** | **Provisão de manutenção exibida como custo realizado** | R$ 1.712 de provisão = 80% do lucro "tudo"; realizado R$ 1.641 | Alta |
| **R6** | **Combustível real substituído por estimativa** (corrigido: não é dupla contagem) | abastecimentos R$ 1.652,69 **ignorados**; app usa estimativa R$ 1.793,04 (erro +R$ 140,35) | Alta |
| **R7** | **Despesa futura deduzida do mês corrente** | parcela do pneu (10/11, −R$ 282,82) já reduz o lucro de novembro | Alta |
| **R8** | **Card "Despesas" incoerente** | 08/11: painel R$ 0,00 com Fundo de Reserva R$ 1.712,18 ao lado | Alta |
| **R9** | **Projeção de meta instável e sem base histórica** | 77% vs 123% vs média real R$ 5.455 (78%) | Alta |
| **R10** | **Sem passivo/parcelamento** | pneus: R$ 1.414,09 a pagar até abr/2027; carro: **R$ 144.788** até set/2030 | Média |
| **R11** | **Desconto por antecipação não registrado** | R$ 27,31/mês, R$ 327,76/ano de ganho invisível | Média |
| **R12** | **Odômetro descarta leitura real** | base manual 101.152 > 1ª leitura 100.244 → **908 km** ignorados | Média |
| **R13** | **Agregação por app quebrada por nome** | "99Pop" (R$ 3.353,00) e "99Pop / 99" (R$ 33,80) viram dois apps | Média |
| **R14** | **Veículo incompatível com o modelo de combustível** | Corolla híbrido; app só entende etanol×gasolina; mediu ~12 km/L, real 18–20 | Média |
| **R15** | **Período/dia soma por turno, não por dia** | nov: turnos 06:14–08:30, 11:27–13:46, 15:55–19:35 | Média |
| **R16** | **km fora de serviço sem rateio pessoal × atividade** | 1.858 km × 0,25 = R$ 465 = 64% da sobra mensal | Média |
| **R17** | **Rótulo de período ≠ hora real** | 44 turnos "Tarde" começam entre 11h e 14h | Baixa |
| **R18** | **km/L implausível não sinalizado** | 03/11: +652 km / 29,3 L = 22,25 km/L | Baixa |

### 4.1 Refutados pelos dados (honestidade de escopo)

| Hipótese (auditoria de código) | O que os dados dizem | Reclassificação |
|---|---|---|
| Máscara de centavos em km/litros | km e litros coerentes; os 2 turnos com km < 5 são legítimos (1 viagem de 3–4 km) | **P1** — risco vivo, sem incidente |
| Turno com 0h vira 8h | **0** turnos com `hours = 8.0`; **0 de 199** com `timeStart == timeEnd` | **P2** — nunca disparou |
| Cálculo automático de horas | **0 divergências** em 199 turnos (tolerância 4 min) | **Aprovado** |
| Integridade / duplicidade | 0 ids duplicados, 0 dias com > 3 turnos, 199 turnos íntegros | **Aprovado** |

### 4.2 Correção à minha auditoria de código: performance

Medi e errei antes. O gargalo **não** é `getKmFora` (3,4 ms):

```
render() completo .............. 542,6 ms
  └─ renderShiftsList() ......... 427,2 ms   ← 79%
  └─ renderChartsView() ........... 3,4 ms
  └─ renderWhatsApp() ............. 2,4 ms
getTotalKmFora() isolado ........ 3,4 ms      ← não é o gargalo
render() com getKmFora stub ..... 482,8 ms    ← só 60 ms de ganho
```
É a construção de DOM de 199 cards a cada mutação. Em WebView real: ~50–100 ms. **Não é incêndio; é custo O(n) por clique.** A prioridade correta é *render por view*.

---

## 5. O que os dados revelam e o código não podia revelar

1. **O app não conhece o custo de estar na rua.** Sem custo fixo recorrente, não há ponto de equilíbrio ("preciso de R$ X/dia só para empatar"), não há margem, não há alerta.
2. **O app mede faturamento, não resultado.** Bruto por km e por hora é o número que interessa ao app de corrida; sobra por km e por hora é o que interessa a quem paga a prestação.
3. **A meta de R$ 7.000 está fora de alcance.** Três meses: R$ 5.853 / R$ 5.070 / R$ 5.442. O app projeta 77% ou 123% conforme o botão, e nunca diz *"sua média é R$ 5.455"*.
4. **A ociosidade é o maior ativo não medido.** 443 h paradas contra 520 h trabalhadas. A R$/h real, ~R$ 1.100 de faturamento potencial não realizado — e nenhum concorrente mede isso.
5. **3 turnos por dia, app desenhado para 1.** 48% dos dias têm 3 turnos; ~24 interações/dia; `notes` vazio em **199 de 199** turnos.
6. **Caixa, provisão e resultado são três coisas e o app mistura as três.** O usuário olha "lucro R$ 854" sem saber se tem R$ 854 ou R$ 1.700 guardados.

---

## 6. Plano priorizado

### P0 — Crítico

| # | Ação | Evidência | Cx |
|---|---|---|---|
| **P0-A** | **Despesa recorrente** (mensal/bimestral/anual) com geração automática e confirmação "isso se repete?" quando uma despesa aparece isolada | R$ 609,14/mês nunca lançados; usuário declara o esquecimento | **M** |
| **P0-B** | **Custo fixo mensal + ponto de equilíbrio** (quanto preciso faturar/dia só para empatar) | fixo = R$ 3.756,71 = 68,9% do bruto | M |
| **P0-C** | **R$/h e R$/km em três leituras**: bruto · líquido (turno) · **sobra real** (após fixo) | 34,22 → 18,48 → **2,51** | M |
| **P0-D** | **Regime de competência**: `competencia` separada de `data_pagamento` | 12/60→set, 13/60→out, 14/60→nov; novembro com R$ 0 | **A** |
| **P0-E** | **Separar caixa / provisão / resultado** | provisão = 80% do lucro exibido | M |
| **P0-F** | **Usar combustível real (abastecimentos) em vez da estimativa por turno** | R$ 1.652,69 ignorados; app usa R$ 1.793,04 (+R$ 140,35) | B |
| **P0-G** | **Não deduzir despesa de data futura**; marcar "a pagar" | −R$ 282,82 no lucro de novembro hoje | B |
| **P0-H** | **Card "Despesas" coerente** | R$ 0,00 vs R$ 1.712,18 na mesma tela | B |
| **P0-I** | **Sync em nuvem** — 199 turnos de histórico real em risco | LWW destrutivo, 81 KB/upload | A |

### P1 — Alta prioridade

| # | Ação | Evidência | Cx |
|---|---|---|---|
| P1-A | **Rateio pessoal × atividade** dos km e do custo fixo, usando o km fora de serviço já registrado | R$ 465 = 64% da sobra, cobrados sem critério | M |
| P1-B | **Passivo/parcelamento** (total, valor contratual, parcelas restantes, saldo) | R$ 144.788 do carro + R$ 1.414 dos pneus | M |
| P1-C | **Reconhecer desconto por antecipação** e acumular a economia | R$ 27,31/mês, R$ 327,76/ano | B |
| P1-D | **Projeção de meta por média histórica**, mostrando as bases | 77% / 123% / R$ 5.455 | B |
| P1-E | **Consolidar apps por `appKey`**, não por `name` | "99Pop" vs "99Pop / 99" | B |
| P1-F | **Onboarding para híbrido** (km/L combinado ou kWh) | medido 12 km/L, real 18–20 | M |
| P1-G | **Odômetro nunca descarta leitura**; avisar divergência | 908 km ignorados | B |
| P1-H | Remover máscara de centavos de km/litros | risco vivo | B |
| P1-I | **Detectar salto implausível** de odômetro/consumo | 22,25 km/L em 03/11 | B |
| P1-J | Render por view | 427 de 542 ms em `renderShiftsList` | M |

### P2 — Maior valor para este usuário
1. **Painel "Tempo na rua"** — trabalhado vs ocioso, com R$/h nas duas formas.
2. **Lançamento rápido de turno** — 3 turnos/dia, 48% dos dias.
3. **Simulador ancorado na sobra real**, não no bruto por hora.
4. **Consolidação semanal** — ele trabalha em semanas de 5 dias.
5. **"Vale a pena continuar?"** — prestação + fixo + média real num veredito. É a pergunta que ele faz e o app não responde.

---

## 7. Notas

| Dimensão | Só código | +199 turnos | +fatos do usuário | Motivo |
|---|---:|---:|---:|---|
| Arquitetura | 5,0 | 5,0 | **5,0** | inalterado |
| Qualidade do código | 5,5 | 6,0 | **6,0** | 0 divergências de horas, 0 corrupção, 0 duplicidade |
| UX/UI | 6,0 | 5,5 | **5,5** | 3 turnos/dia; `notes` vazio em 199/199 |
| Funcionalidades | 7,5 | 7,5 | **6,5** | ↓↓ sem recorrente, sem competência, sem fixo, sem passivo — lacunas de modelo |
| Segurança | 5,5 | 5,5 | **5,5** | inalterado |
| Performance | 5,0 | 6,0 | **6,0** | 542 ms/199 turnos |
| Escalabilidade | 3,5 | 4,0 | **4,0** | 81 KB/199 turnos |
| **Confiabilidade dos números** | — | 4,0 | **2,0** | R$/h **13,6×** inflado; lucro do mês com sinal invertido |
| Potencial comercial | 7,0 | 7,5 | **8,0** | ↑ a lacuna que ele revela é a maior oportunidade de produto do mercado |

**Maturidade geral: 5,0/10.**

O app é tecnicamente sólido para o que se propõe — e o que ele se propõe é **medir faturamento**. Ele faz isso bem: 199 turnos íntegros, R$/km bruto correto, paridade de combustível, fechamento para WhatsApp.

O problema é que **faturamento não é resultado**. Para responder à pergunta que decide a vida do usuário — *"isso está valendo a pena?"* — faltam quatro conceitos no modelo de dados: **despesa recorrente**, **regime de competência**, **custo fixo** e **rateio pessoal × atividade**. Sem eles, o app exibe R$ 34,22/h onde a realidade é R$ 2,51/h, e mostra lucro em um mês que fechou no vermelho.

Para o proprietário, a leitura honesta dos próprios números é esta: **R$ 731/mês de sobra, R$ 2,51 por hora na rua, 13,4% de margem** — e R$ 144.788 de financiamento pela frente. Não é um negócio inviável, mas é um negócio que **só se sustenta enquanto o carro estiver financiado**; no dia em que a parcela terminar, a mesma rotina passa a render **R$ 3.878,71/mês**. Essa é a informação que o app deveria estar dando, e é a razão pela qual ele tem valor.

**Potencial comercial sobe para 8,0** — não apesar da lacuna, mas por causa dela: nenhum app de motorista no mercado mede *sobra por hora na rua* nem detecta despesa recorrente esquecida. Essas duas features resolvem o problema real de 100% dos usuários da categoria.
