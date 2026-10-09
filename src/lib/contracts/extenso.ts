/** Valor monetário por extenso em português (ex.: 1.250,50 → "mil duzentos e cinquenta reais e cinquenta centavos"). */
const U = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const D = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const C = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function ate999(n: number): string {
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(C[c]);
  if (r) partes.push(r < 20 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ` e ${U[r % 10]}` : ""));
  return partes.join(" e ");
}

function inteiro(n: number): string {
  if (n === 0) return "zero";
  const grupos: [number, string, string][] = [
    [1e9, "bilhão", "bilhões"],
    [1e6, "milhão", "milhões"],
    [1e3, "mil", "mil"],
    [1, "", ""],
  ];
  const partes: { txt: string; v: number }[] = [];
  let resto = n;
  for (const [base, sing, plur] of grupos) {
    const q = Math.floor(resto / base);
    resto %= base;
    if (!q) continue;
    if (base === 1e3) partes.push({ txt: q === 1 ? "mil" : `${ate999(q)} mil`, v: q * base });
    else if (base === 1) partes.push({ txt: ate999(q), v: q });
    else partes.push({ txt: `${ate999(q)} ${q === 1 ? sing : plur}`, v: q * base });
  }
  // "e" antes do último grupo quando ele é < 100 ou centena redonda
  return partes
    .map((p, i) => (i > 0 && i === partes.length - 1 && (p.v < 100 || p.v % 100 === 0) ? `e ${p.txt}` : p.txt))
    .join(" ")
    .replace(/ {2,}/g, " ");
}

export function valorPorExtenso(valor: number): string {
  const v = Math.round(Math.abs(valor) * 100);
  const reais = Math.floor(v / 100), cent = v % 100;
  const r = reais ? `${inteiro(reais)}${reais >= 1e6 && reais % 1e6 === 0 ? " de" : ""} ${reais === 1 ? "real" : "reais"}` : "";
  const c = cent ? `${inteiro(cent)} ${cent === 1 ? "centavo" : "centavos"}` : "";
  return [r, c].filter(Boolean).join(" e ") || "zero real";
}
