// Fotos dos produtos tiradas do site (catálogo da Shopee), casadas pelo SKU.
// Só preenche quem ainda está sem foto: nunca troca uma foto escolhida no sistema.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const pasta = join(dirname(fileURLToPath(import.meta.url)), "fotos");

export async function carregarFotos(prisma) {
  let n = 0;
  for (const arq of readdirSync(pasta).filter((a) => a.endsWith(".jpg"))) {
    const codigo = arq.replace(/\.jpg$/, "");
    const foto = "data:image/jpeg;base64," + readFileSync(join(pasta, arq)).toString("base64");
    const r = await prisma.item.updateMany({ where: { codigo, OR: [{ foto: null }, { foto: "" }] }, data: { foto } });
    n += r.count;
  }
  if (n) console.log(`Fotos do site colocadas em ${n} produto(s).`);
}
