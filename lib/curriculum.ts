/**
 * A1 curriculum: Goethe Start Deutsch 1 themes, one unit every ~4 practice days.
 * Each session: your introduction -> chat about you (unit focus) -> a role-play scene -> review questions.
 * Scenes rotate per session, so every conversation is different.
 */
export interface Scene {
  label: string;     // short, shown in the app header
  setup: string;     // for Maria: where we are, who plays whom, what happens
  phrases: string;   // useful phrases to bring in
}

export interface Unit {
  title: string;     // German unit name
  en: string;        // English name
  chat: string;      // what to ask about after the introduction
  review: string;    // what a review question from this unit looks like
  scenes: Scene[];
}

export const DAYS_PER_UNIT = 4;
export const MAX_EXTRA_DAYS = 2;
export const TARGET_START_MS = 6000;   // A1: start answering within ~6 s on average to move on
export const MAX_HELPS_TO_ADVANCE = 2;

export const UNITS: Unit[] = [
  {
    title: "Ich und meine Familie",
    en: "Me and my family",
    chat: "their family: parents (where they live, what they do), brothers and sisters (names, age, jobs), whether they are married or have children; also their own job and where they live",
    review: "a simple question about their family or job (Hast du Geschwister? Was macht dein Vater?)",
    scenes: [
      { label: "New neighbour", setup: "the stairs of an apartment building in Hamburg. Maria is the learner's new neighbour; they meet for the first time and get to know each other.", phrases: "Ich wohne im zweiten Stock. Woher kommst du? Wohnst du allein?" },
      { label: "First day of German class", setup: "the first day of a German course in Berlin. Maria is a classmate sitting next to the learner; they chat in the break.", phrases: "Wie heißt du? Was machst du beruflich? Warum lernst du Deutsch?" },
      { label: "Party", setup: "a small birthday party at a friend's flat. Maria is a friend of the host; she meets the learner and asks about him and his family.", phrases: "Woher kennst du Anna? Hast du Kinder? Wie alt ist dein Bruder?" },
      { label: "Host family video call", setup: "a video call. Maria is the mother of a German host family; the learner will stay with them next month, and they introduce their families to each other.", phrases: "Das ist mein Mann. Wir haben zwei Kinder. Und deine Familie?" },
      { label: "Family photos", setup: "a café. Maria and the learner are friends; Maria shows a family photo on her phone and asks the learner about his family photos.", phrases: "Wer ist das? Das ist meine Schwester. Sie ist Lehrerin." },
    ],
  },
  {
    title: "Im Café und Restaurant",
    en: "Café and restaurant",
    chat: "food and drinks: what they like to eat and drink, breakfast, coffee or tea, cooking at home, favourite food from their country",
    review: "a simple question about food or drinks (Was trinkst du gern? Was isst du zum Frühstück?)",
    scenes: [
      { label: "Café · you're the customer", setup: "a café in Berlin. Maria is the waitress; the learner is a customer who orders a drink and cake, asks the price and pays.", phrases: "Was möchten Sie? Ich möchte einen Kaffee, bitte. Was kostet das? Zahlen, bitte." },
      { label: "Bakery", setup: "a bakery in Munich in the morning. Maria is the baker; the learner buys bread and rolls for breakfast.", phrases: "Ich hätte gern drei Brötchen. Noch etwas? Das macht 2,40 Euro." },
      { label: "Restaurant dinner", setup: "a restaurant in Cologne. Maria is the waitress; the learner orders a starter, a main dish and a drink, then asks for the bill.", phrases: "Die Speisekarte, bitte. Ich nehme die Suppe. Die Rechnung, bitte." },
      { label: "Snack stand", setup: "a snack stand (Imbiss) at a train station. Maria works there; the learner orders food to take away.", phrases: "Eine Currywurst mit Pommes, bitte. Zum Mitnehmen oder hier essen?" },
      { label: "Cooking with a friend", setup: "Maria's kitchen. Maria and the learner want to cook dinner together and decide what to make and what they need.", phrases: "Was kochen wir? Wir brauchen Reis und Tomaten. Isst du gern Fisch?" },
    ],
  },
  {
    title: "Einkaufen",
    en: "Shopping",
    chat: "shopping: where they buy food, what they buy every week, prices in their city, whether they like shopping",
    review: "a simple question about shopping (Wo kaufst du ein? Was kostet ein Kaffee in Dubai?)",
    scenes: [
      { label: "Supermarket", setup: "a supermarket. Maria works there; the learner asks where things are (milk, rice, eggs) and how much they cost.", phrases: "Entschuldigung, wo ist die Milch? Im Regal links. Was kostet das?" },
      { label: "Clothes shop", setup: "a clothes shop in Frankfurt. Maria is the shop assistant; the learner looks for a shirt or jacket and talks about size, colour and price.", phrases: "Ich suche eine Jacke. Welche Größe? Haben Sie das in Blau? Das ist zu teuer." },
      { label: "Farmers' market", setup: "a weekly farmers' market in Stuttgart. Maria sells fruit and vegetables; the learner buys amounts (ein Kilo, 500 Gramm).", phrases: "Ein Kilo Äpfel, bitte. Was kosten die Tomaten? Sonst noch etwas?" },
      { label: "Phone shop", setup: "an electronics shop. Maria is the shop assistant; the learner needs a phone charger and asks about it.", phrases: "Ich brauche ein Ladekabel. Für welches Handy? Kann ich mit Karte zahlen?" },
      { label: "Gift for a friend", setup: "a small gift shop. Maria is the shop assistant; the learner looks for a birthday present for a friend.", phrases: "Ich suche ein Geschenk. Für wen? Wie viel möchten Sie ausgeben?" },
    ],
  },
  {
    title: "Wohnen",
    en: "Home",
    chat: "their flat or house: how many rooms, big or small, what is in the living room, the neighbourhood, who they live with",
    review: "a simple question about their home (Wie viele Zimmer hat deine Wohnung? Wohnst du allein?)",
    scenes: [
      { label: "Flat viewing", setup: "an empty flat in Hamburg. Maria is the landlady showing the flat; the learner asks about rooms, rent and the kitchen.", phrases: "Wie groß ist die Wohnung? Wie hoch ist die Miete? Gibt es einen Balkon?" },
      { label: "Furniture shop", setup: "a furniture shop. Maria is the shop assistant; the learner needs a table, a bed or a sofa for a new flat.", phrases: "Ich brauche einen Tisch. Wie viel kostet das Sofa? Liefern Sie auch?" },
      { label: "Neighbour borrows something", setup: "the learner's front door. Maria is the neighbour and wants to borrow something (salt, a drill); then they chat about the building.", phrases: "Hast du Salz für mich? Natürlich! Wohnst du schon lange hier?" },
      { label: "Showing your flat", setup: "the learner's flat. Maria is a friend visiting for the first time; the learner shows her around.", phrases: "Das ist das Wohnzimmer. Die Küche ist klein. Schön hell!" },
      { label: "Calling the caretaker", setup: "a phone call. Maria is the caretaker (Hausmeister) of the building; the learner reports that something is broken (heating, light, tap).", phrases: "Die Heizung ist kaputt. Wann können Sie kommen? Morgen um zehn?" },
    ],
  },
  {
    title: "Freizeit und Termine",
    en: "Free time and appointments",
    chat: "free time: hobbies, sport, what they do at the weekend, days and times, what they like to do in the evening",
    review: "a simple question about free time or times (Was machst du am Wochenende? Wann stehst du auf?)",
    scenes: [
      { label: "Weekend plans", setup: "a phone call. Maria is a friend; they plan to do something together at the weekend and agree on a day and time.", phrases: "Hast du am Samstag Zeit? Um wie viel Uhr? Treffen wir uns am Bahnhof?" },
      { label: "Cinema tickets", setup: "a cinema ticket desk. Maria sells tickets; the learner buys tickets for a film and asks about times and prices.", phrases: "Zwei Karten für acht Uhr, bitte. Wann beginnt der Film?" },
      { label: "Joining a sports club", setup: "the office of a sports club. Maria works there; the learner wants to join and asks about times, days and cost.", phrases: "Ich möchte Mitglied werden. Wann ist das Training? Was kostet das pro Monat?" },
      { label: "Hairdresser appointment", setup: "a phone call to a hairdresser. Maria is the receptionist; the learner makes an appointment.", phrases: "Ich möchte einen Termin. Geht Dienstag um drei? Ja, das passt." },
      { label: "Museum visit", setup: "a museum entrance. Maria works at the information desk; the learner asks about opening hours, tickets and where things are.", phrases: "Wann ist das Museum geöffnet? Gibt es eine Ermäßigung?" },
    ],
  },
  {
    title: "Unterwegs",
    en: "Out and about",
    chat: "travel and transport: how they go to work, car or metro, trips they have made, their favourite city",
    review: "a simple question about transport or travel (Wie fährst du zur Arbeit? Fährst du gern Zug?)",
    scenes: [
      { label: "Train ticket", setup: "the ticket office at a train station in Leipzig. Maria sells tickets; the learner buys a ticket and asks about the time and platform.", phrases: "Eine Fahrkarte nach Berlin, bitte. Einfach oder hin und zurück? Von welchem Gleis?" },
      { label: "Asking the way", setup: "a street in Munich. Maria is a local; the learner asks the way to the station, a bank or a pharmacy.", phrases: "Entschuldigung, wo ist der Bahnhof? Geradeaus und dann links. Ist das weit?" },
      { label: "Hotel check-in", setup: "a hotel reception in Dresden. Maria is the receptionist; the learner checks in.", phrases: "Ich habe ein Zimmer reserviert. Wie ist Ihr Name? Wann gibt es Frühstück?" },
      { label: "Taxi", setup: "a taxi. Maria is the driver; the learner says where to go and asks how long it takes and what it costs.", phrases: "Zum Flughafen, bitte. Wie lange dauert das? Kann ich mit Karte zahlen?" },
      { label: "Tourist information", setup: "a tourist information office. Maria works there; the learner asks what to see and how to get there.", phrases: "Was kann man hier sehen? Haben Sie einen Stadtplan? Fährt ein Bus dorthin?" },
    ],
  },
  {
    title: "Gesundheit",
    en: "Health",
    chat: "health: sport, healthy food, what they do when they feel sick, how they feel today",
    review: "a simple question about health (Machst du Sport? Was machst du, wenn du krank bist?)",
    scenes: [
      { label: "Doctor's appointment by phone", setup: "a phone call to a doctor's practice. Maria is the receptionist; the learner makes an appointment and says what is wrong.", phrases: "Ich brauche einen Termin. Was fehlt Ihnen? Ich habe Kopfschmerzen." },
      { label: "At the doctor", setup: "a doctor's office. Maria is the doctor; the learner explains what hurts.", phrases: "Wo tut es weh? Mein Bauch tut weh. Seit wann?" },
      { label: "Pharmacy", setup: "a pharmacy. Maria is the pharmacist; the learner asks for something against a cold or headache.", phrases: "Haben Sie etwas gegen Husten? Wie oft nehme ich das? Dreimal am Tag." },
      { label: "Calling in sick", setup: "a phone call. Maria is the learner's manager; the learner calls to say he is sick and cannot come to work.", phrases: "Ich bin krank. Ich komme heute nicht. Gute Besserung!" },
      { label: "Gym sign-up", setup: "a gym reception. Maria works there; the learner asks about classes, times and prices.", phrases: "Welche Kurse gibt es? Wann ist Yoga? Was kostet ein Monat?" },
    ],
  },
  {
    title: "Arbeit und Alltag",
    en: "Work and daily life",
    chat: "work and daily routine: when they get up, working hours, what they do at work, their evenings",
    review: "a simple question about work or the day (Wann beginnt deine Arbeit? Was machst du am Abend?)",
    scenes: [
      { label: "New colleague", setup: "an office kitchen. Maria is a new colleague on her first day; she and the learner get to know each other.", phrases: "Ich bin neu hier. In welcher Abteilung arbeitest du? Seit wann bist du hier?" },
      { label: "A normal day", setup: "a lunch break. Maria and the learner are colleagues and talk about their normal day.", phrases: "Wann stehst du auf? Ich fange um neun an. Und nach der Arbeit?" },
      { label: "Job fair", setup: "a stand at a job fair. Maria is a recruiter; the learner introduces himself and asks about the job.", phrases: "Was sind Ihre Arbeitszeiten? Ich arbeite im Marketing. Ich spreche Englisch." },
      { label: "Asking a colleague for help", setup: "the office. Maria is a colleague; the learner asks for help with the printer or a meeting time.", phrases: "Kannst du mir helfen? Der Drucker geht nicht. Wann ist das Meeting?" },
      { label: "Language school sign-up", setup: "the reception of a language school in Cologne. Maria is the receptionist; the learner signs up for a course and gives personal details (name, address, phone number, spelling).", phrases: "Wie schreibt man das? Wie ist Ihre Telefonnummer? Der Kurs beginnt am Montag." },
    ],
  },
];

export interface UnitChoice {
  unit: number;      // index into UNITS
  session: number;   // sessions done in this unit (picks the scene, so each session differs)
}

export function sceneFor(choice: UnitChoice): { unit: Unit; scene: Scene; reviews: Unit[] } {
  const u = Math.min(Math.max(0, choice.unit), UNITS.length - 1);
  const unit = UNITS[u];
  const s = Math.max(0, choice.session);
  const scene = s < unit.scenes.length ? unit.scenes[s] : unit.scenes[Math.floor(Math.random() * unit.scenes.length)];
  // review: up to 3 earlier units, most recent first, plus random older ones
  const earlier = UNITS.slice(0, u).reverse();
  const reviews = earlier.length <= 3 ? earlier : [earlier[0], ...earlier.slice(1).sort(() => Math.random() - 0.5).slice(0, 2)];
  return { unit, scene, reviews };
}
