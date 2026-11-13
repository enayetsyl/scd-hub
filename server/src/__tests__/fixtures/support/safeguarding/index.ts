/**
 * Safeguarding fixtures F-30 … F-39 (docs/prd-child-support-profile.md §16.9). Invented text,
 * Bangla with an English twin. `field` is where the words sit in the report.
 */
export interface SgFixture {
  id: string;
  field: "behaviour" | "settingNote" | "situation";
  bn: string;
  en: string;
  /** Expected from the deterministic term list at intake. */
  termHit: boolean;
}

export const SAFEGUARDING_FIXTURES: SgFixture[] = [
  { id: "F-30", field: "behaviour", bn: "টিফিনের সময় সে কাঁদছিল; জিজ্ঞেস করলে বলল, \"বাসায় মারে\"।", en: "At tiffin he was crying; asked, he said, \"they beat me at home\".", termHit: true },
  { id: "F-31", field: "settingNote", bn: "ডান হাতে একটি পোড়া দাগ দেখেছি; কীভাবে হলো বলতে পারেনি।", en: "I saw a burn mark on his right hand; he could not say how it happened.", termHit: true },
  { id: "F-32", field: "behaviour", bn: "খাতা বন্ধ করে বলেছে, 'আমি মরে যেতে চাই'।", en: "He closed his copy and said, 'I want to die'.", termHit: true },
  { id: "F-33", field: "behaviour", bn: "খেলার সময় সে বয়সের সাথে মেলে না এমন যৌন কথা বলছিল।", en: "At play she was using sexual talk that does not fit her age.", termHit: true },
  { id: "F-34", field: "settingNote", bn: "এ সপ্তাহে তিন দিন সে না খেয়ে এসেছে বলেছে; জামা অপরিচ্ছন্ন ছিল।", en: "Three days this week he said he came without eating; his clothes were unwashed.", termHit: true },
  { id: "F-35", field: "behaviour", bn: "সে বলেছে, অন্য ক্লাসের এক স্যার মেরেছে।", en: "He said a teacher of another class hit him.", termHit: true },
  { id: "F-36", field: "behaviour", bn: "লাইনে দাঁড়ানোর সময় সে এক সহপাঠীকে হাত দিয়ে মেরেছে।", en: "Lining up, he hit a classmate with his hand.", termHit: false },
  { id: "F-37", field: "behaviour", bn: "খেলতে গিয়ে পড়ে হাঁটু ছিলে গেছে; আমি অফিসে নিয়ে গেছি।", en: "He fell while playing and scraped his knee; I took him to the office.", termHit: false },
  { id: "F-38", field: "behaviour", bn: "ভুল উত্তর দিয়ে সে লজ্জায় মরে যাচ্ছিল, মুখ ঢেকে বসেছিল।", en: "After a wrong answer she was dying of shame and sat with her face covered.", termHit: false },
];

/** F-39: three reports over two weeks — sleepy, hungry, a bruise (a batch-level pattern, SG-6). */
export const F39 = [
  { day: -14, bn: "প্রথম পিরিয়ডে সে বেঞ্চে মাথা রেখে ঘুমিয়ে পড়েছিল।" },
  { day: -7, bn: "সে বলেছে সকালে কিছু খায়নি, টিফিনের আগেই খেতে চেয়েছে।" },
  { day: -1, bn: "বাঁ হাতে একটি কালশিটে দেখেছি।" },
];
