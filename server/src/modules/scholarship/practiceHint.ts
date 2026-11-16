/**
 * practiceHintBn — a short Bangla practice suggestion for a scholarship question type
 * (matched on the topic label). Pure: the same rules the 2026-11-16 class report used,
 * now shared with the data assistant's `scholarship_analysis` tool. Numbers-only data in,
 * advice text out; it never sees a question or a teacher note.
 */
export function practiceHintBn(label: string, subject: string): string {
  const l = label.toLowerCase();
  if (/application|email|composition|letter|paragraph|story|রচনা|আবেদন|পত্র|ফরম|অনুচ্ছেদ|গল্প/.test(l))
    return "কাঠামো শেখান (শুরু – মূল অংশ – শেষ), একটি নমুনা পড়ে কাঠামো চিহ্নিত করুক, তারপর সপ্তাহে দুটি নিজে লিখে জমা দিক; শিক্ষক ভুল চিহ্নিত করে ফেরত দেবেন।";
  if (/বিস্তৃত|long/.test(l)) return "উত্তর পয়েন্ট ধরে সাজানো শেখান (৫–৬ পয়েন্ট); প্রতি অধ্যায়ের সম্ভাব্য বিস্তৃত প্রশ্ন বই বন্ধ রেখে লিখিয়ে যাচাই করুন — সপ্তাহে দুটি।";
  if (/সংক্ষিপ্ত|short answer/.test(l)) return "মূল তথ্য দুই–তিন বাক্যে লেখা অভ্যাস করান; প্রতিদিন পাঁচটি প্রশ্ন, বই বন্ধ রেখে।";
  if (/শূন্যস্থান|fill in the blanks|blank/.test(l)) return "অধ্যায়ের মূল শব্দ ও সংজ্ঞার তালিকা মুখস্থ করান; প্রতিদিন দশটি শূন্যস্থান।";
  if (/সত্য|true|মিলকরণ|match|বহুনির্বাচনি|mcq/.test(l)) return "ভুল হওয়া প্রশ্নগুলোর কারণ খুঁজে বের করুক; মূল তথ্য আবার পড়ে প্রতিদিন দশটি দ্রুত প্রশ্ন।";
  if (/verb|tense|ক্রিয়ার কাল|wh|rearrange|punctuation|capital|parts of speech|পদ|সমার্থক|বিপরীত|এককথায়|বিরাম|ভাষারীতি|article|a, an/.test(l))
    return "নিয়মটি আবার শিখিয়ে দুটি উদাহরণ দেখান; তারপর প্রতিদিন দশটি অনুশীলনী; সমার্থক/বিপরীত/এককথায় শব্দের তালিকা মুখস্থ।";
  if (subject === "MATH") return "এই অধ্যায়ের অনুশীলনী প্রতিদিন ২০ মিনিট; ভুল হওয়া অঙ্ক পরদিন আবার করুক। (গণিতে এখন পর্যন্ত একটিই মডেল টেস্ট — সিদ্ধান্ত সাবধানে।)";
  return "এই ধরনের প্রশ্ন বেশি অনুশীলন করান এবং ভুলগুলো আলাদা খাতায় লিখে রাখুক।";
}
