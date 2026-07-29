# Seth VII — Painel público

Painel estático que exibe o **registro mensurável** de parlamentares a partir de
dados abertos oficiais. Este repositório contém **apenas a camada de
apresentação**: HTML, CSS, JS e o arquivo de dados gerado. O código de coleta e
análise fica em repositório privado separado.

**Site:** https://blkxacsa.github.io/seth-vii-painel/

## Como ler os números

O destaque de cada card é a **presença em sessões**, porque é o dado apurado
para todos os parlamentares analisados.

O **score de viabilidade** só aparece quando uma promessa foi detectada em
discurso. Discurso de plenário é quase todo procedimental — orientação de voto,
questão de ordem, homenagem, fala regimental. Por isso **“sem promessa
detectada” é o resultado comum, e não uma falha de medição**.

Duas regras valem em todo o painel:

1. **Dado ausente nunca vira zero.** Fatores sem dado público são excluídos do
   cálculo e o peso é redistribuído entre os medidos. Cada dossiê lista o que
   não pôde ser medido.
2. **Nada aqui mede honestidade ou intenção.** O que se mede é registro
   público: presença, produção legislativa, votos nominais, despesas de cota e
   divergência entre tema falado e tema legislado.

Valores de referência fixos no código (por exemplo, “média estimada de N
proposições”) **não são exibidos**. Número inventado apresentado como apuração
foi o defeito mais grave já corrigido neste projeto.

## Fontes

| Fonte | Uso |
|---|---|
| [Dados Abertos da Câmara dos Deputados](https://dadosabertos.camara.leg.br/) | perfil, proposições, discursos, votos nominais, presença por sessão, despesas de cota |
| [SICONFI — Tesouro Nacional](https://siconfi.tesouro.gov.br/) | receita e despesa por ente federativo |

## Estrutura

```
index.html    estrutura da página
styles.css    tema escuro, grade de cards, modal
app.js        busca, filtros, ordenação, modal do dossiê
data.json     dataset gerado pelo pipeline (repositório privado)
```

O front-end **não calcula nada**. Score, percentil e cobertura chegam prontos no
`data.json`. Se o JavaScript fizesse contas, haveria duas fontes de verdade
capazes de divergir.

## Atualização dos dados

O `data.json` é publicado aqui por um workflow do repositório privado, que roda
o pipeline contra as APIs oficiais e faz commit apenas deste arquivo.

## Aviso

Análise probabilística e não acusatória, baseada exclusivamente em dados
públicos e sujeita à incompletude das fontes. Não constitui julgamento de
caráter ou intenção, e não substitui investigação jornalística.
