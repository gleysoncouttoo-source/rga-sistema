// Leitura simples de planilhas (.xlsx e .csv) sem dependências pesadas: devolve a 1ª aba como linhas de texto.
import "server-only";
import { unzipSync, strFromU8 } from "fflate";

const ent = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");

const textos = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => ent(m[1])).join("");

function colIndex(ref: string) {
  const l = ref.replace(/\d+/g, "");
  let n = 0;
  for (const c of l) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function lerXlsx(buf: Uint8Array): string[][] {
  const z = unzipSync(buf, { filter: (f) => f.name.startsWith("xl/") });
  const shared = z["xl/sharedStrings.xml"] ? [...strFromU8(z["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textos(m[1])) : [];
  // primeira aba pela ordem do workbook
  let caminho = "xl/worksheets/sheet1.xml";
  const wb = z["xl/workbook.xml"] && strFromU8(z["xl/workbook.xml"]);
  const rels = z["xl/_rels/workbook.xml.rels"] && strFromU8(z["xl/_rels/workbook.xml.rels"]);
  const rid = wb?.match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  const alvo = rid ? (rels?.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1]
    ?? rels?.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1]) : undefined;
  if (alvo) caminho = alvo.startsWith("/") ? alvo.slice(1) : "xl/" + alvo.replace(/^\.\//, "");
  const folha = z[caminho] ?? Object.entries(z).find(([k]) => k.startsWith("xl/worksheets/sheet"))?.[1];
  if (!folha) throw new Error("A planilha não tem nenhuma aba.");
  const xml = strFromU8(folha);
  const linhas: string[][] = [];
  for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const linha: string[] = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const at = c[1], corpo = c[2] ?? "";
      const ref = at.match(/\br="([A-Z]+\d+)"/)?.[1];
      const t = at.match(/\bt="([^"]+)"/)?.[1];
      let v = "";
      if (t === "inlineStr") v = textos(corpo);
      else {
        const raw = corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (raw != null) v = t === "s" ? shared[Number(raw)] ?? "" : ent(raw);
      }
      linha[ref ? colIndex(ref) : linha.length] = v;
    }
    linhas.push(Array.from(linha, (x) => x ?? ""));
  }
  return linhas;
}

function lerCsv(txt: string): string[][] {
  // separador: o que mais aparece numa mesma linha (relatórios da Shopee têm linhas de título antes do cabeçalho)
  const topo = txt.split("\n").slice(0, 20);
  const max = (c: string) => Math.max(0, ...topo.map((l) => l.split(c).length - 1));
  const sep = max(";") > max(",") ? ";" : max("\t") > max(",") ? "\t" : ",";
  const out: string[][] = [];
  let linha: string[] = [], campo = "", aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (aspas) {
      if (ch === '"' && txt[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ""; }
    else if (ch === "\n") { linha.push(campo.replace(/\r$/, "")); out.push(linha); linha = []; campo = ""; }
    else campo += ch;
  }
  if (campo || linha.length) { linha.push(campo); out.push(linha); }
  return out;
}

export function lerPlanilha(nome: string, buf: Uint8Array): string[][] {
  if (buf[0] === 0x50 && buf[1] === 0x4b) return lerXlsx(buf); // zip = xlsx
  if (/\.xls$/i.test(nome)) throw new Error("Arquivo .xls antigo: abra no Excel e salve como .xlsx ou .csv.");
  return lerCsv(new TextDecoder("utf-8").decode(buf).replace(/^﻿/, ""));
}
