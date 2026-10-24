// --- QURAN REFERENCE (app-native; Saturday-Revision SR-5 — D-#833/#834) ----------
// The fixed surah / ayah / juz table a revision portion (a surah:ayah range) is
// measured against. NO wire-contract twin: this is reference data, not an enum the
// import envelope carries. Ayah counts (total 6,236) and the juz start points are
// from quran.com (api/v4/chapters, api/v4/juzs); the Bangla short names are from
// Bangla Wikipedia's surah list, cross-checked against the ayah counts, lightly
// normalised to the school's spelling. Spellings are provisional (owner review).

export interface SurahInfo {
  /** Mushaf number 1–114. */
  n: number;
  /** Bangla short name, as teachers write it ("বাকারা", "নাবা"). */
  bn: string;
  /** Arabic name. */
  ar: string;
  ayahs: number;
}

export const SURAHS: readonly SurahInfo[] = [
  { n: 1, bn: "ফাতিহা", ar: "الفاتحة", ayahs: 7 },
  { n: 2, bn: "বাকারা", ar: "البقرة", ayahs: 286 },
  { n: 3, bn: "আলে ইমরান", ar: "آل عمران", ayahs: 200 },
  { n: 4, bn: "নিসা", ar: "النساء", ayahs: 176 },
  { n: 5, bn: "মায়িদাহ", ar: "المائدة", ayahs: 120 },
  { n: 6, bn: "আনআম", ar: "الأنعام", ayahs: 165 },
  { n: 7, bn: "আরাফ", ar: "الأعراف", ayahs: 206 },
  { n: 8, bn: "আনফাল", ar: "الأنفال", ayahs: 75 },
  { n: 9, bn: "তাওবাহ", ar: "التوبة", ayahs: 129 },
  { n: 10, bn: "ইউনুস", ar: "يونس", ayahs: 109 },
  { n: 11, bn: "হুদ", ar: "هود", ayahs: 123 },
  { n: 12, bn: "ইউসুফ", ar: "يوسف", ayahs: 111 },
  { n: 13, bn: "রাদ", ar: "الرعد", ayahs: 43 },
  { n: 14, bn: "ইব্রাহীম", ar: "ابراهيم", ayahs: 52 },
  { n: 15, bn: "হিজর", ar: "الحجر", ayahs: 99 },
  { n: 16, bn: "নাহল", ar: "النحل", ayahs: 128 },
  { n: 17, bn: "বনি ইসরাইল", ar: "الإسراء", ayahs: 111 },
  { n: 18, bn: "কাহফ", ar: "الكهف", ayahs: 110 },
  { n: 19, bn: "মারইয়াম", ar: "مريم", ayahs: 98 },
  { n: 20, bn: "ত্বোয়া-হা", ar: "طه", ayahs: 135 },
  { n: 21, bn: "আম্বিয়া", ar: "الأنبياء", ayahs: 112 },
  { n: 22, bn: "হাজ্জ্ব", ar: "الحج", ayahs: 78 },
  { n: 23, bn: "মু'মিনূন", ar: "المؤمنون", ayahs: 118 },
  { n: 24, bn: "নূর", ar: "النور", ayahs: 64 },
  { n: 25, bn: "ফুরকান", ar: "الفرقان", ayahs: 77 },
  { n: 26, bn: "শুআরা", ar: "الشعراء", ayahs: 227 },
  { n: 27, bn: "নম্ল", ar: "النمل", ayahs: 93 },
  { n: 28, bn: "কাসাস", ar: "القصص", ayahs: 88 },
  { n: 29, bn: "আনকাবুত", ar: "العنكبوت", ayahs: 69 },
  { n: 30, bn: "রুম", ar: "الروم", ayahs: 60 },
  { n: 31, bn: "লোকমান", ar: "لقمان", ayahs: 34 },
  { n: 32, bn: "সিজদাহ", ar: "السجدة", ayahs: 30 },
  { n: 33, bn: "আহযাব", ar: "الأحزاب", ayahs: 73 },
  { n: 34, bn: "সাবা", ar: "سبإ", ayahs: 54 },
  { n: 35, bn: "ফাতির", ar: "فاطر", ayahs: 45 },
  { n: 36, bn: "ইয়াসীন", ar: "يس", ayahs: 83 },
  { n: 37, bn: "সাফফাত", ar: "الصافات", ayahs: 182 },
  { n: 38, bn: "ছোয়াদ", ar: "ص", ayahs: 88 },
  { n: 39, bn: "যুমার", ar: "الزمر", ayahs: 75 },
  { n: 40, bn: "মু'মিন", ar: "غافر", ayahs: 85 },
  { n: 41, bn: "হা-মীম সাজদাহ", ar: "فصلت", ayahs: 54 },
  { n: 42, bn: "শূরা", ar: "الشورى", ayahs: 53 },
  { n: 43, bn: "যুখরুফ", ar: "الزخرف", ayahs: 89 },
  { n: 44, bn: "দোখান", ar: "الدخان", ayahs: 59 },
  { n: 45, bn: "জাসিয়াহ", ar: "الجاثية", ayahs: 37 },
  { n: 46, bn: "আহকাফ", ar: "الأحقاف", ayahs: 35 },
  { n: 47, bn: "মুহাম্মাদ", ar: "محمد", ayahs: 38 },
  { n: 48, bn: "ফাতহ", ar: "الفتح", ayahs: 29 },
  { n: 49, bn: "হুজুরাত", ar: "الحجرات", ayahs: 18 },
  { n: 50, bn: "ক্বাফ", ar: "ق", ayahs: 45 },
  { n: 51, bn: "যারিয়াত", ar: "الذاريات", ayahs: 60 },
  { n: 52, bn: "তূর", ar: "الطور", ayahs: 49 },
  { n: 53, bn: "নাজম", ar: "النجم", ayahs: 62 },
  { n: 54, bn: "ক্বামার", ar: "القمر", ayahs: 55 },
  { n: 55, bn: "আর-রহমান", ar: "الرحمن", ayahs: 78 },
  { n: 56, bn: "ওয়াকিয়াহ", ar: "الواقعة", ayahs: 96 },
  { n: 57, bn: "হাদীদ", ar: "الحديد", ayahs: 29 },
  { n: 58, bn: "মুজাদালাহ", ar: "المجادلة", ayahs: 22 },
  { n: 59, bn: "হাশর", ar: "الحشر", ayahs: 24 },
  { n: 60, bn: "মুমতাহিনাহ", ar: "الممتحنة", ayahs: 13 },
  { n: 61, bn: "সাফ", ar: "الصف", ayahs: 14 },
  { n: 62, bn: "জুমুআ", ar: "الجمعة", ayahs: 11 },
  { n: 63, bn: "মুনাফিকুন", ar: "المنافقون", ayahs: 11 },
  { n: 64, bn: "তাগাবুন", ar: "التغابن", ayahs: 18 },
  { n: 65, bn: "তালাক", ar: "الطلاق", ayahs: 12 },
  { n: 66, bn: "তাহরীম", ar: "التحريم", ayahs: 12 },
  { n: 67, bn: "মুলক", ar: "الملك", ayahs: 30 },
  { n: 68, bn: "কলম", ar: "القلم", ayahs: 52 },
  { n: 69, bn: "হাক্কাহ", ar: "الحاقة", ayahs: 52 },
  { n: 70, bn: "মাআরিজ", ar: "المعارج", ayahs: 44 },
  { n: 71, bn: "নূহ", ar: "نوح", ayahs: 28 },
  { n: 72, bn: "জ্বিন", ar: "الجن", ayahs: 28 },
  { n: 73, bn: "মুজাম্মিল", ar: "المزمل", ayahs: 20 },
  { n: 74, bn: "মুদ্দাস্সির", ar: "المدثر", ayahs: 56 },
  { n: 75, bn: "কিয়ামাহ", ar: "القيامة", ayahs: 40 },
  { n: 76, bn: "দাহর", ar: "الانسان", ayahs: 31 },
  { n: 77, bn: "মুরসালাত", ar: "المرسلات", ayahs: 50 },
  { n: 78, bn: "নাবা", ar: "النبإ", ayahs: 40 },
  { n: 79, bn: "নাযিয়াত", ar: "النازعات", ayahs: 46 },
  { n: 80, bn: "আবাসা", ar: "عبس", ayahs: 42 },
  { n: 81, bn: "তাকভীর", ar: "التكوير", ayahs: 29 },
  { n: 82, bn: "ইনফিতার", ar: "الإنفطار", ayahs: 19 },
  { n: 83, bn: "মুতাফ্ফিফীন", ar: "المطففين", ayahs: 36 },
  { n: 84, bn: "ইনশিকাক", ar: "الإنشقاق", ayahs: 25 },
  { n: 85, bn: "বুরুজ", ar: "البروج", ayahs: 22 },
  { n: 86, bn: "তারিক্ব", ar: "الطارق", ayahs: 17 },
  { n: 87, bn: "আ’লা", ar: "الأعلى", ayahs: 19 },
  { n: 88, bn: "গাশিয়াহ", ar: "الغاشية", ayahs: 26 },
  { n: 89, bn: "ফাজ্র", ar: "الفجر", ayahs: 30 },
  { n: 90, bn: "বালাদ", ar: "البلد", ayahs: 20 },
  { n: 91, bn: "শাম্স", ar: "الشمس", ayahs: 15 },
  { n: 92, bn: "লাইল", ar: "الليل", ayahs: 21 },
  { n: 93, bn: "দোহা", ar: "الضحى", ayahs: 11 },
  { n: 94, bn: "ইনশিরাহ", ar: "الشرح", ayahs: 8 },
  { n: 95, bn: "ত্বীন", ar: "التين", ayahs: 8 },
  { n: 96, bn: "আলাক্ব", ar: "العلق", ayahs: 19 },
  { n: 97, bn: "ক্বদর", ar: "القدر", ayahs: 5 },
  { n: 98, bn: "বাইয়্যিনাহ", ar: "البينة", ayahs: 8 },
  { n: 99, bn: "যিলযাল", ar: "الزلزلة", ayahs: 8 },
  { n: 100, bn: "আদিয়াত", ar: "العاديات", ayahs: 11 },
  { n: 101, bn: "কারিয়াহ", ar: "القارعة", ayahs: 11 },
  { n: 102, bn: "তাকাসুর", ar: "التكاثر", ayahs: 8 },
  { n: 103, bn: "আছর", ar: "العصر", ayahs: 3 },
  { n: 104, bn: "হুমাযাহ", ar: "الهمزة", ayahs: 9 },
  { n: 105, bn: "ফীল", ar: "الفيل", ayahs: 5 },
  { n: 106, bn: "কুরাইশ", ar: "قريش", ayahs: 4 },
  { n: 107, bn: "মাউন", ar: "الماعون", ayahs: 7 },
  { n: 108, bn: "কাওসার", ar: "الكوثر", ayahs: 3 },
  { n: 109, bn: "কাফিরুন", ar: "الكافرون", ayahs: 6 },
  { n: 110, bn: "নাসর", ar: "النصر", ayahs: 3 },
  { n: 111, bn: "লাহাব", ar: "المسد", ayahs: 5 },
  { n: 112, bn: "ইখলাস", ar: "الإخلاص", ayahs: 4 },
  { n: 113, bn: "ফালাক", ar: "الفلق", ayahs: 5 },
  { n: 114, bn: "নাস", ar: "الناس", ayahs: 6 },
];

/** The first [surah, ayah] of each juz, juz 1 → 30. */
export const JUZ_STARTS: readonly (readonly [number, number])[] = [
  [1, 1], // 1
  [2, 142], // 2
  [2, 253], // 3
  [3, 93], // 4
  [4, 24], // 5
  [4, 148], // 6
  [5, 82], // 7
  [6, 111], // 8
  [7, 88], // 9
  [8, 41], // 10
  [9, 93], // 11
  [11, 6], // 12
  [12, 53], // 13
  [15, 1], // 14
  [17, 1], // 15
  [18, 75], // 16
  [21, 1], // 17
  [23, 1], // 18
  [25, 21], // 19
  [27, 56], // 20
  [29, 46], // 21
  [33, 31], // 22
  [36, 28], // 23
  [39, 32], // 24
  [41, 47], // 25
  [46, 1], // 26
  [51, 31], // 27
  [58, 1], // 28
  [67, 1], // 29
  [78, 1], // 30
];

export const SURAH_COUNT = 114;
export const JUZ_COUNT = 30;

/** A portion's range in mushaf order (inclusive at both ends). */
export interface AyahRange {
  fromSurah: number;
  fromAyah: number;
  toSurah: number;
  toAyah: number;
}

/** surah n → global index of its first ayah (1-based); built once. */
const SURAH_FIRST: number[] = (() => {
  const out: number[] = [0];
  let acc = 1;
  for (const s of SURAHS) {
    out[s.n] = acc;
    acc += s.ayahs;
  }
  return out;
})();

export const TOTAL_AYAHS = SURAHS.reduce((sum, s) => sum + s.ayahs, 0);

const JUZ_FIRST: number[] = JUZ_STARTS.map(([s, a]) => SURAH_FIRST[s] + a - 1);

export function surahInfo(n: number): SurahInfo | undefined {
  return Number.isInteger(n) && n >= 1 && n <= SURAH_COUNT ? SURAHS[n - 1] : undefined;
}

export function isValidAyah(surah: number, ayah: number): boolean {
  const s = surahInfo(surah);
  return !!s && Number.isInteger(ayah) && ayah >= 1 && ayah <= s.ayahs;
}

/** Global 1-based position of surah:ayah in the mushaf (1 … 6,236). */
export function ayahIndex(surah: number, ayah: number): number {
  return SURAH_FIRST[surah] + ayah - 1;
}

/** Inverse of `ayahIndex`. */
export function ayahAt(index: number): { surah: number; ayah: number } {
  let surah = SURAH_COUNT;
  while (surah > 1 && SURAH_FIRST[surah] > index) surah--;
  return { surah, ayah: index - SURAH_FIRST[surah] + 1 };
}

function juzOfIndex(index: number): number {
  let j = JUZ_COUNT;
  while (j > 1 && JUZ_FIRST[j - 1] > index) j--;
  return j;
}

export function juzOf(surah: number, ayah: number): number {
  return juzOfIndex(ayahIndex(surah, ayah));
}

/** Number of ayahs in juz j. */
export function juzAyahCount(j: number): number {
  const first = JUZ_FIRST[j - 1];
  const next = j < JUZ_COUNT ? JUZ_FIRST[j] : TOTAL_AYAHS + 1;
  return next - first;
}

/** The whole of juz j as a range (the "পুরো পারা" shortcut). */
export function wholeJuzRange(j: number): AyahRange {
  const from = ayahAt(JUZ_FIRST[j - 1]);
  const to = ayahAt(j < JUZ_COUNT ? JUZ_FIRST[j] - 1 : TOTAL_AYAHS);
  return { fromSurah: from.surah, fromAyah: from.ayah, toSurah: to.surah, toAyah: to.ayah };
}

/** Why a range is unusable, or null when it is valid. */
export function rangeError(r: AyahRange): string | null {
  if (!isValidAyah(r.fromSurah, r.fromAyah)) return "start surah/ayah is out of range";
  if (!isValidAyah(r.toSurah, r.toAyah)) return "end surah/ayah is out of range";
  if (ayahIndex(r.toSurah, r.toAyah) < ayahIndex(r.fromSurah, r.fromAyah)) {
    return "the end comes before the start";
  }
  return null;
}

export function rangeAyahCount(r: AyahRange): number {
  return ayahIndex(r.toSurah, r.toAyah) - ayahIndex(r.fromSurah, r.fromAyah) + 1;
}

/** The range cut at surah boundaries: one row per surah touched. */
export function splitRangeBySurah(r: AyahRange): Array<{ surah: number; fromAyah: number; toAyah: number; ayahs: number }> {
  const out: Array<{ surah: number; fromAyah: number; toAyah: number; ayahs: number }> = [];
  for (let s = r.fromSurah; s <= r.toSurah; s++) {
    const fromAyah = s === r.fromSurah ? r.fromAyah : 1;
    const toAyah = s === r.toSurah ? r.toAyah : SURAHS[s - 1].ayahs;
    out.push({ surah: s, fromAyah, toAyah, ayahs: toAyah - fromAyah + 1 });
  }
  return out;
}

/** The range cut at juz boundaries: one row per juz touched, with that juz's size. */
export function splitRangeByJuz(r: AyahRange): Array<{ juz: number; ayahs: number; juzAyahs: number }> {
  const start = ayahIndex(r.fromSurah, r.fromAyah);
  const end = ayahIndex(r.toSurah, r.toAyah);
  const out: Array<{ juz: number; ayahs: number; juzAyahs: number }> = [];
  for (let j = juzOfIndex(start); j <= juzOfIndex(end); j++) {
    const lo = Math.max(start, JUZ_FIRST[j - 1]);
    const hi = Math.min(end, j < JUZ_COUNT ? JUZ_FIRST[j] - 1 : TOTAL_AYAHS);
    out.push({ juz: j, ayahs: hi - lo + 1, juzAyahs: juzAyahCount(j) });
  }
  return out;
}

/** How much of a juz the range is, summed over the juz it touches (e.g. 0.15). */
export function rangeJuzAmount(r: AyahRange): number {
  return splitRangeByJuz(r).reduce((sum, p) => sum + p.ayahs / p.juzAyahs, 0);
}

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
function bnDigits(n: number): string {
  return String(n).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

/** Bangla text of a range: "বাকারা ১৭৩–১৮১", "নাবা ১ – নাযিয়াত ৪৬", "পারা ৩০ (পুরো)". */
export function formatRangeBn(r: AyahRange): string {
  for (let j = 1; j <= JUZ_COUNT; j++) {
    const w = wholeJuzRange(j);
    if (w.fromSurah === r.fromSurah && w.fromAyah === r.fromAyah && w.toSurah === r.toSurah && w.toAyah === r.toAyah) {
      return `পারা ${bnDigits(j)} (পুরো)`;
    }
  }
  const from = SURAHS[r.fromSurah - 1]?.bn ?? `সূরা ${bnDigits(r.fromSurah)}`;
  const to = SURAHS[r.toSurah - 1]?.bn ?? `সূরা ${bnDigits(r.toSurah)}`;
  if (r.fromSurah === r.toSurah) {
    const whole = r.fromAyah === 1 && r.toAyah === SURAHS[r.fromSurah - 1]?.ayahs;
    return whole ? from : `${from} ${bnDigits(r.fromAyah)}–${bnDigits(r.toAyah)}`;
  }
  return `${from} ${bnDigits(r.fromAyah)} – ${to} ${bnDigits(r.toAyah)}`;
}
