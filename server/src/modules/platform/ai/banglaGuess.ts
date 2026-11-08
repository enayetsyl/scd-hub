/**
 * English → Bangla name guess (D-#1151) — so a name can be hidden before an AI call even
 * when nobody has typed the child's Bangla name yet (PRD P11).
 *
 *   guessBanglaName("Md. Tahsin Karim") → "মোঃ তাহসিন করিম"
 *
 * Common name parts come from a fixed list (the usual spelling); anything else is spelled
 * out sound by sound. The guess is only a GUESS: the de-identifier matches it loosely
 * (`deidentify.ts`, skeleton match for the child the text is about), and the Office can
 * check / correct it on the Bangla-name screen, where it is offered pre-filled.
 *
 * Pure: no database, no network.
 */

/** Usual Bangla spelling of common name parts (lower-case English key). */
const KNOWN: Record<string, string> = {
  md: "মোঃ", mohammad: "মোহাম্মদ", mohammed: "মোহাম্মদ", muhammad: "মুহাম্মদ", mohd: "মোঃ", mst: "মোছাঃ", mosammat: "মোছাম্মৎ",
  abdul: "আব্দুল", abdullah: "আব্দুল্লাহ", abu: "আবু", al: "আল", bin: "বিন", binte: "বিনতে", bint: "বিনতে", ibn: "ইবনে",
  ahmed: "আহমেদ", ahmad: "আহমাদ", akter: "আক্তার", akhter: "আখতার", aktar: "আক্তার", alam: "আলম", ali: "আলী", amin: "আমিন",
  anwar: "আনোয়ার", ashraf: "আশরাফ", ayesha: "আয়েশা", aysha: "আয়শা", aisha: "আয়েশা", begum: "বেগম", chowdhury: "চৌধুরী",
  fatema: "ফাতেমা", fatima: "ফাতিমা", faruk: "ফারুক", farhan: "ফারহান", ferdous: "ফেরদৌস", habib: "হাবিব", haque: "হক", hoque: "হক",
  hasan: "হাসান", hassan: "হাসান", hossain: "হোসেন", hussain: "হুসাইন", hosen: "হোসেন", islam: "ইসলাম", jahan: "জাহান",
  kabir: "কবির", karim: "করিম", khan: "খান", khatun: "খাতুন", mahmud: "মাহমুদ", mahmood: "মাহমুদ", mia: "মিয়া", miah: "মিয়া",
  nur: "নূর", noor: "নূর", rahman: "রহমান", rahim: "রহিম", rashid: "রশিদ", sultana: "সুলতানা", uddin: "উদ্দিন", ullah: "উল্লাহ",
  zaman: "জামান", siddika: "সিদ্দিকা", siddique: "সিদ্দিক", siddiqui: "সিদ্দিকী", tuz: "তুজ", tuj: "তুজ", zohra: "জোহরা", johra: "জোহরা",
  jannat: "জান্নাত", jannatul: "জান্নাতুল", nusrat: "নুসরাত", tasnim: "তাসনিম", tasneem: "তাসনিম", tahsin: "তাহসিন", tahmid: "তাহমিদ",
  rafi: "রাফি", rafiq: "রফিক", rafique: "রফিক", sabbir: "সাব্বির", sakib: "সাকিব", shakib: "সাকিব", tamim: "তামিম", tanvir: "তানভীর",
  tanveer: "তানভীর", arif: "আরিফ", ariful: "আরিফুল", ashik: "আশিক", ayan: "আয়ান", ayaan: "আয়ান", zarif: "জারিফ", zahid: "জাহিদ",
  jahid: "জাহিদ", zayan: "জায়ান", zain: "জাইন", rayan: "রায়ান", rayyan: "রাইয়ান", raiyan: "রাইয়ান", arham: "আরহাম", abrar: "আবরার",
  ahnaf: "আহনাফ", nafis: "নাফিস", nafisa: "নাফিসা", nabil: "নাবিল", nabila: "নাবিলা", samiha: "সামিহা", samia: "সামিয়া", sadia: "সাদিয়া",
  sumaiya: "সুমাইয়া", sumaya: "সুমাইয়া", umme: "উম্মে", habiba: "হাবিবা", maryam: "মারইয়াম", mariam: "মরিয়ম", marium: "মরিয়ম",
  khadija: "খাদিজা", zainab: "যয়নব", zaynab: "যয়নব", hafsa: "হাফসা", ruqayya: "রুকাইয়া", ruqaiya: "রুকাইয়া", rukaiya: "রুকাইয়া",
  ayat: "আয়াত", fariha: "ফারিহা", farzana: "ফারজানা", tahmina: "তাহমিনা", taslima: "তাসলিমা", sharmin: "শারমিন", shirin: "শিরিন",
  nazia: "নাজিয়া", nazifa: "নাজিফা", raisa: "রাইসা", rifat: "রিফাত", riya: "রিয়া", ria: "রিয়া", mim: "মিম", meem: "মীম",
  ridwan: "রিদওয়ান", rizwan: "রিজওয়ান", rezwan: "রেজওয়ান", imran: "ইমরান", irfan: "ইরফান", ishraq: "ইশরাক", istiak: "ইশতিয়াক",
  ishtiaq: "ইশতিয়াক", omar: "ওমর", umar: "উমর", usman: "উসমান", osman: "ওসমান", yusuf: "ইউসুফ", yousuf: "ইউসুফ", yasin: "ইয়াসিন",
  yasir: "ইয়াসির", yeasin: "ইয়াসিন", ibrahim: "ইব্রাহিম", ismail: "ইসমাইল", ishaq: "ইসহাক", yahya: "ইয়াহইয়া", musa: "মুসা",
  isa: "ঈসা", idris: "ইদ্রিস", hamza: "হামজা", hasib: "হাসিব", hasin: "হাসিন", hridoy: "হৃদয়", hridita: "হৃদিতা", saad: "সাদ",
  safwan: "সাফওয়ান", sami: "সামি", samin: "সামিন", sanjida: "সানজিদা", sadman: "সাদমান", shahriar: "শাহরিয়ার",
  shahadat: "শাহাদাত", shams: "শামস", tasfia: "তাসফিয়া", tasfiya: "তাসফিয়া", tabassum: "তাবাসসুম", maliha: "মালিহা", mahi: "মাহি",
  mahira: "মাহিরা", mahir: "মাহির", mehedi: "মেহেদী", mehjabin: "মেহজাবিন", mushfiq: "মুশফিক", munira: "মুনিরা",
   parvez: "পারভেজ", rabeya: "রাবেয়া", rabia: "রাবিয়া", ruhi: "রুহি", sabrina: "সাবরিনা",
  sabiha: "সাবিহা", sajid: "সাজিদ", salman: "সালমান", wasif: "ওয়াসিফ", wasi: "ওয়াসি", zarin: "জারিন", zareen: "জারিন",
  ahsan: "আহসান", azan: "আজান", adnan: "আদনান", afnan: "আফনান", afia: "আফিয়া", afiya: "আফিয়া", afra: "আফরা", afrin: "আফরিন",
  anika: "আনিকা", arisha: "আরিশা", ariba: "আরিবা", ayra: "আইরা", ilma: "ইলমা", inaya: "ইনায়া", labiba: "লাবিবা", lamia: "লামিয়া",
  mehreen: "মেহরিন", mehrin: "মেহরিন", nowshin: "নওশিন", nawshin: "নওশিন", nishat: "নিশাত", orpa: "অর্পা", prova: "প্রভা",
  roza: "রোজা", rokeya: "রোকেয়া", sumi: "সুমি", tanha: "তানহা", tasmia: "তাসমিয়া", tuba: "তুবা", wafa: "ওয়াফা", zara: "জারা",
  tonmoy: "তন্ময়", tanmoy: "তন্ময়", shawkat: "শওকত", saukat: "শওকত", aiman: "আইমান", ayman: "আইমান",
  rayhan: "রায়হান", raihan: "রায়হান", sohan: "সোহান", towhid: "তাওহীদ", tawhid: "তাওহীদ", tauhid: "তাওহীদ",
};

// Sound-by-sound fallback ---------------------------------------------------------------

const CONS: Array<[string, string]> = [
  ["kh", "খ"], ["gh", "ঘ"], ["ch", "চ"], ["jh", "ঝ"], ["th", "থ"], ["dh", "ধ"], ["ph", "ফ"], ["bh", "ভ"], ["sh", "শ"], ["ck", "ক"],
  ["b", "ব"], ["d", "দ"], ["f", "ফ"], ["g", "গ"], ["h", "হ"], ["j", "জ"], ["k", "ক"], ["l", "ল"], ["m", "ম"], ["n", "ন"],
  ["p", "প"], ["q", "ক"], ["r", "র"], ["s", "স"], ["t", "ত"], ["v", "ভ"], ["x", "ক্স"], ["z", "জ"],
];
/** [English, vowel sign after a consonant, letter on its own]. */
const VOWELS: Array<[string, string, string]> = [
  ["aa", "া", "আ"], ["ee", "ি", "ই"], ["ea", "ি", "ই"], ["oo", "ু", "উ"], ["ou", "ৌ", "ঔ"], ["au", "ৌ", "ঔ"],
  ["ai", "াই", "আই"], ["ei", "েই", "এই"], ["oi", "ই", "ওই"],
  ["a", "া", "আ"], ["i", "ি", "ই"], ["u", "ু", "উ"], ["e", "ে", "এ"], ["o", "ো", "ও"],
];
/** Double letters that make a conjunct (ব্ব, ল্ল …); other doubles are written once. */
const DOUBLE_CONJUNCT = new Set(["b", "d", "k", "l", "m", "n", "t", "j", "p"]);

function spellOut(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  let out = "";
  let prev: "start" | "cons" | "vowel" = "start";
  let lastCons = "";
  let i = 0;
  const startsWith = (s: string) => w.startsWith(s, i);
  while (i < w.length) {
    const ch = w[i];
    // y / w glide between sounds.
    if (ch === "y" || ch === "w") {
      const nextIsVowel = i + 1 < w.length && "aeiou".includes(w[i + 1]);
      if (ch === "y") {
        if (prev === "cons" && !nextIsVowel) out += "ি";
        else if (prev === "cons") out += "িয়"; // Ilyas → ইলিয়াস
        else if (prev === "start" && nextIsVowel) out += "ইয়";
        else if (prev === "vowel" && !nextIsVowel && i + 1 < w.length) out += "ই"; // Fayzaan → ফাইজান
        else out += "য়";
        // য় carries the next vowel as a sign.
        prev = nextIsVowel ? "cons" : "vowel";
      } else {
        out += nextIsVowel ? "ওয়" : "ও";
        prev = nextIsVowel ? "cons" : "vowel";
      }
      lastCons = "";
      i += 1;
      continue;
    }
    if (ch === "q" && w[i + 1] === "u" && "aeio".includes(w[i + 2] ?? "")) {
      // Rafique → রফিক, Taqua → তাকা: the u is silent; a final -que is just ক.
      const finalQue = startsWith("que") && i + 3 === w.length;
      out += "ক";
      prev = "cons";
      lastCons = "q";
      i += finalQue ? 3 : 2;
      continue;
    }
    if (ch === "c") {
      // c before e / i / y sounds like s.
      const soft = i + 1 < w.length && "eiy".includes(w[i + 1]);
      if (!startsWith("ch") && !startsWith("ck")) {
        out += soft ? "স" : "ক";
        prev = "cons";
        lastCons = "c";
        i += 1;
        continue;
      }
    }
    const v = VOWELS.find(([e]) => startsWith(e));
    if (v) {
      const [e, sign, own] = v;
      if (prev === "cons") out += sign;
      else if (prev === "vowel" && (e[0] === "a" || e[0] === "e" || e[0] === "o")) out += `য়${sign}`;
      else out += own;
      prev = "vowel";
      lastCons = "";
      i += e.length;
      continue;
    }
    const c = CONS.find(([e]) => startsWith(e));
    if (c) {
      const [e, bn] = c;
      if (e === lastCons && e.length === 1) {
        // A doubled letter: a conjunct for some, otherwise written once.
        if (DOUBLE_CONJUNCT.has(e)) out += `্${bn}`;
      } else if (e === "h" && prev === "vowel" && i === w.length - 1) {
        out += "হ";
      } else {
        out += bn;
      }
      prev = "cons";
      lastCons = e;
      i += e.length;
      continue;
    }
    i += 1;
  }
  return out;
}

function guessPart(part: string): string {
  const key = part.toLowerCase().replace(/[^a-z]/g, "");
  if (!key) return "";
  return KNOWN[key] ?? spellOut(key);
}

/**
 * A Bangla spelling guess for an English name ("" when there are no Latin letters).
 * A name already in Bangla comes back unchanged.
 */
export function guessBanglaName(english: string | null | undefined): string {
  const s = (english ?? "").normalize("NFC").trim();
  if (!s) return "";
  if (!/[A-Za-z]/.test(s)) return /[ঀ-৿]/.test(s) ? s.replace(/\s+/g, " ") : "";
  return s
    .split(/[\s.\-_,]+/)
    .map(guessPart)
    .filter(Boolean)
    .join(" ");
}
