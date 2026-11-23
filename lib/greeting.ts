/** Alexis's opening message (Behaviour Guide, "Opening"), shown before the customer types. */
export const GREETING =
  "Hi, I'm Alexis, the AI support assistant. I'm happy to help, and a member of the team is available any time you'd prefer. What can I look into for you?";

/** Suggested openers on an empty conversation (Design System, "Empty conversation"). */
export const OPENERS = ["Where is my payout?", "A payment to us hasn't arrived", "I need proof of payment"];

/**
 * The greeting and openers in the languages the customer app offers (Nov 23). Alexis replies in the
 * language chosen. Yoruba, Hausa and Igbo need a native speaker's check before any real use.
 */
export const GREETINGS: Record<string, string> = {
  en: GREETING,
  fr: "Bonjour, je suis Alexis, l'assistante IA du service client. Je suis là pour vous aider, et un membre de l'équipe est disponible à tout moment si vous le préférez. Que puis-je vérifier pour vous ?",
  pcm: "Hello, na me be Alexis, the AI support assistant. I dey here to help you, and if you prefer, person from our team dey available anytime. Wetin you wan make I check for you?",
  yo: "Ẹ n lẹ́, èmi ni Alexis, olùrànlọ́wọ́ AI fún àwọn oníbàárà. Inú mi dùn láti ràn yín lọ́wọ́, ọ̀kan nínú àwọn òṣìṣẹ́ wa sì wà nígbàkúùgbà tí ẹ bá fẹ́. Kí ni mo lè ṣàyẹ̀wò fún yín?",
  ha: "Sannu, ni ce Alexis, mataimakiyar AI ta sashen taimakon abokan ciniki. Ina farin cikin taimaka muku, kuma ma'aikacinmu yana nan a kowane lokaci idan kun fi so. Me zan duba muku?",
  ig: "Ndewo, abụ m Alexis, onye enyemaka AI maka ndị ahịa. Obi dị m ụtọ inyere gị aka, ma onye otu anyị dịkwa njikere mgbe ọ bụla ịchọrọ. Gịnị ka m ga-enyocha maka gị?",
};

export const OPENERS_BY_LANGUAGE: Record<string, string[]> = {
  en: OPENERS,
  fr: ["Où en est mon virement ?", "Un paiement attendu n'est pas arrivé", "J'ai besoin d'une preuve de paiement"],
  pcm: ["Where my payout dey?", "Payment wey dem send us never land", "I need proof of payment"],
};

export const LANGUAGE_NAMES: [string, string][] = [["en", "English"], ["fr", "Français"], ["pcm", "Naijá (Pidgin)"], ["yo", "Yorùbá"], ["ha", "Hausa"], ["ig", "Igbo"]];
