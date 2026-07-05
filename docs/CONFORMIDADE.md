# Relatório de Conformidade — Automação HVAC para Hospitais e Biotérios

Revisão do projeto (dashboard React + API + automação VAV) frente às normas e leis
brasileiras aplicáveis a climatização de ambientes de saúde (EAS) e de instalações para
animais de laboratório (biotérios). Data da revisão: julho/2026.

> **Resumo executivo.** O projeto cobre bem o **núcleo** (monitoramento de temperatura,
> umidade e CO₂ por sala, faixas configuráveis, alertas, controle VAV automático e
> rastreabilidade/log de auditoria). Para **conformidade plena** em ambiente hospitalar e,
> principalmente, em biotério, faltam parâmetros exigidos pelas normas: **trocas de ar por
> hora (renovação)**, **pressão diferencial (pressurização)**, **monitoramento de filtragem
> (HEPA)** e, para biotério, **fotoperíodo (ciclo claro/escuro)**. Detalhes abaixo.

---

## 1. Normas e leis de referência

**Ambiente hospitalar (EAS):**
- **ABNT NBR 7256** — Tratamento de ar em Estabelecimentos Assistenciais de Saúde (projeto e
  execução): temperatura, umidade, **trocas de ar/hora**, **pressão diferencial**, **filtragem
  (HEPA/ISO 35H)**, registro contínuo e rastreabilidade.
- **ABNT NBR 16401** — Instalações de ar-condicionado (conforto e qualidade do ar interior),
  aplicável às áreas não assistenciais.
- **Lei 13.589/2018 + Portaria MS 3.523/1998** — obrigatoriedade do **PMOC** e seus registros.
- **ANVISA RE 09/2003** — parâmetros de referência do ar interior (CO₂ ≤ 1000 ppm, umidade,
  temperatura). **ANVISA RDC 50/2002** — estrutura física dos EAS.

**Biotério (animais de laboratório):**
- **CONCEA** — Guia Brasileiro de Produção, Manutenção ou Utilização de Animais; Fascículo de
  Roedores e Lagomorfos; Resoluções Normativas (RN 15/2013, RN 30/2016 e correlatas).
- **ILAR — Guide for the Care and Use of Laboratory Animals** (referência internacional
  adotada pelo CONCEA): temperatura, umidade, **trocas de ar/hora**, **fotoperíodo**,
  pressurização direcional.

---

## 2. Parâmetros normativos (referência)

### Hospital — exemplos por ambiente (NBR 7256 / RE 09)

| Ambiente | Temperatura | Umidade | Trocas de ar | Pressão | Filtragem |
|---|---|---|---|---|---|
| Sala cirúrgica | 20–24 °C | 45–55 % | ~15 trocas/h | Positiva | HEPA (ISO 35H) |
| UTI | 22–26 °C | 40–60 % | mín. definida | Positiva | G4 + F8 |
| Isolamento (contágio) | 20–24 °C | 40–60 % | elevada | **Negativa** | conforme risco |
| Áreas comuns | 20–26 °C | 40–60 % | ≥ renovação mín. | Neutra | G4/F |
| CO₂ (ar interior) | — | — | — | — | ≤ 1000 ppm (RE 09) |

### Biotério — roedores (CONCEA / ILAR, valores usuais)

| Parâmetro | Faixa de referência |
|---|---|
| Temperatura (camundongo/rato) | 20–24 °C (ILAR admite até 26 °C) |
| Umidade relativa | 30–70 % (comum 45–65 %) |
| Trocas de ar/hora (renovação) | 10–15 trocas/h (algumas instalações 15–20) |
| Fotoperíodo | ciclo claro/escuro 12 h / 12 h, regulável |
| Pressão | direcional (limpo positivo / sujo-quarentena negativo) |
| Ruído | controlado/minimizado |

> Os valores exatos dependem da espécie e da edição vigente do Guia CONCEA/ILAR e devem ser
> confirmados no projeto específico do biotério.

---

## 3. O que o projeto JÁ atende (conformidades)

- **Monitoramento de temperatura, umidade e CO₂ por sala**, com **faixas de alerta
  configuráveis por ambiente** — atende o princípio de controle da NBR 7256 e da RE 09, e
  permite ajustar limites por tipo de sala (cirúrgica, UTI, sala de animais).
- **Padrões default já alinhados**: umidade 40–60 % (NBR 7256) e CO₂ crítico 1000 ppm (RE 09).
- **Alertas de desvio** (temperatura, umidade, CO₂, falha de VAV) com notificação **ntfy.sh** —
  atende a exigência de alarme/ação em situação fora de faixa.
- **Controle VAV automático por zona** com setpoint individual — coerente com sistema VAV
  multizona; respeita o limite físico (não resfria abaixo do ar insuflado).
- **Rastreabilidade / log de auditoria** com registros de eventos e ambientais periódicos,
  **identificação do estabelecimento e responsável técnico** e **exportação CSV** — atende
  RNF07, a rastreabilidade da NBR 7256 e o registro exigido pelo PMOC (Lei 13.589/2018).
- **Registro contínuo** (histórico de telemetria + snapshots periódicos).

---

## 4. Lacunas para conformidade plena (o que falta)

Ordenadas por prioridade normativa. Nenhuma delas está implementada hoje.

1. **Trocas de ar por hora / renovação de ar (ACH)** — *exigência central* tanto da NBR 7256
   (mín. por ambiente; ~15/h em sala cirúrgica) quanto do CONCEA/ILAR (10–15/h em sala de
   animais). O sistema mede CO₂ (indicador indireto) mas **não monitora nem controla vazão de
   renovação**. **Impacto: alto.**
2. **Pressão diferencial (pressurização)** — NBR 7256 exige pressão **positiva** (proteção:
   cirúrgica, UTI) ou **negativa** (contenção: isolamento); biotérios de barreira exigem
   pressão direcional. **Não há sensor/indicador de pressão.** **Impacto: alto.**
3. **Monitoramento de filtragem (HEPA/classe, pressão diferencial do filtro, data de troca)** —
   a NBR 7256 exige identificação e acompanhamento dos filtros. **Não implementado.**
   **Impacto: médio/alto.**
4. **Fotoperíodo (ciclo claro/escuro 12/12 e intensidade)** — *específico de biotério*
   (CONCEA/ILAR). O sistema não controla nem registra iluminação. **Impacto: alto para
   biotério**, não aplicável a hospital.
5. **Perfis de ambiente com presets normativos** — hoje as faixas são genéricas e editáveis
   manualmente. Falta selecionar o **tipo de ambiente** (cirúrgica, UTI, sala de animais…) e
   carregar os limites da norma automaticamente. **Impacto: médio (usabilidade/erro humano).**
6. **Ruído** (biotério) — parâmetro citado pelo CONCEA; monitoramento opcional. **Impacto: baixo.**
7. **Política de retenção dos registros** — definir prazo de guarda dos logs/leituras compatível
   com o PMOC do EAS/instituição. Hoje o mock mantém os últimos registros em memória; o backend
   real deve persistir (SQLite/BD) com retenção definida. **Impacto: médio (documental).**

---

## 5. Recomendações

- **Prioridade 1 (segurança + norma):** adicionar **pressão diferencial** e **trocas de ar/hora**
  como grandezas monitoradas (sensores de pressão/vazão no ESP32), com faixas e alertas por sala —
  fecha as duas maiores lacunas para hospital e biotério.
- **Prioridade 2:** **fotoperíodo** (para biotério) — controle/registro do ciclo 12/12 e alerta de
  falha de iluminação; e **monitoramento de filtros** (Δpressão do filtro + data de troca).
- **Prioridade 3:** **perfis de ambiente** com presets da NBR 7256 / CONCEA (selecionar o tipo de
  sala aplica os limites automaticamente, reduzindo erro humano).
- **Documental:** registrar no TCC a **matriz de rastreabilidade** requisito→norma e a **política
  de retenção** dos logs; anexar que laudo de qualidade do ar (laboratório credenciado) e
  certificados de calibração dos sensores são complementares e externos ao software.

> As lacunas acima envolvem novas grandezas (pressão, vazão, luz) e, portanto, novos sensores e
> telas. Podem ser implementadas de forma incremental — a arquitetura atual (parâmetros por sala,
> alertas, log de auditoria) já comporta essas adições.

---

## 6. Referências

- ABNT NBR 7256 — Tratamento de ar em EAS. Ver panorama em
  <https://www.hepafiltros.com.br/abnt-nbr-7256-norma-climatizacao-hospitalar/> e
  <https://microblau.com.br/nbr-7256-seguranca-ambiental-em-hospitais-com-a-solucao-exxa>.
- ANVISA RE 09/2003 —
  <https://antigo.anvisa.gov.br/documents/10181/2718376/RE_09_2003_.pdf/8ccafc91-1437-4695-8e3a-2a97deca4e10>.
- Lei 13.589/2018 (PMOC) — <https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13589.htm>.
- CONCEA — Fascículo Roedores e Lagomorfos (Guia Brasileiro):
  <https://antigo.mctic.gov.br/mctic/export/sites/institucional/institucional/concea/arquivos/publicacoes/Fasciculo-02.-Roedores-e-Lagomorfos-2019.pdf>.
- CONCEA — normativas: <https://www.sbcal.org.br/conteudo/view?ID_CONTEUDO=41>.
- ILAR — Guide for the Care and Use of Laboratory Animals (referência internacional adotada pelo CONCEA).
