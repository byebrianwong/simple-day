// Picks a picture for an event from words in its title, so "Dinner with
// Susan" gets a plate and "Doctor: Dr. Lee" gets a stethoscope.
//
// Rules are checked from top to bottom and the first match wins, so more
// specific rules come first: "Eye doctor" is glasses, not a stethoscope, and
// "Pickup for doctor" is the doctor, not the car.
//
// To add a word, add it to a rule's list (lowercase; several words are fine,
// such as "pick up"). To add a new picture, also add its Lucide name to ICONS
// in scripts/update-icons.mjs and run that script.

export type IconRule = { icon: string; words: string[] };

export const ICON_RULES: IconRule[] = [
  { icon: 'scissors', words: ['hair', 'haircut', 'hairdresser', 'salon', 'barber', 'perm', 'trim'] },
  { icon: 'toothbrush', words: ['dentist', 'dental', 'teeth', 'tooth', 'hygienist', 'orthodontist'] },
  { icon: 'glasses', words: ['eye', 'eyes', 'optometrist', 'ophthalmologist', 'optician', 'glasses'] },
  {
    icon: 'stethoscope',
    words: [
      'doctor', 'doctors', 'dr', 'physician', 'clinic', 'hospital', 'checkup', 'check up', 'physio',
      'physiotherapy', 'physical therapy', 'therapy', 'therapist', 'nurse', 'specialist', 'cardiologist',
      'podiatrist', 'dermatologist', 'audiologist', 'hearing', 'medical', 'surgery', 'blood test', 'labs',
      'x ray', 'xray', 'mri', 'scan', 'vaccine', 'flu shot', 'appointment with dr',
    ],
  },
  {
    icon: 'pill',
    words: ['pill', 'pills', 'medicine', 'medicines', 'medication', 'medications', 'meds', 'prescription', 'pharmacy', 'vitamins'],
  },
  { icon: 'cake', words: ['birthday', 'bday', 'anniversary'] },
  { icon: 'party-popper', words: ['party', 'celebration', 'celebrate'] },
  { icon: 'phone', words: ['call', 'calls', 'phone', 'facetime', 'zoom', 'skype', 'video call'] },
  { icon: 'dices', words: ['bingo', 'cards', 'card game', 'game', 'games', 'puzzle', 'puzzles', 'bridge', 'mahjong', 'canasta', 'scrabble', 'chess'] },
  { icon: 'book-open', words: ['book', 'books', 'book club', 'reading', 'read', 'library'] },
  { icon: 'music', words: ['music', 'concert', 'choir', 'piano', 'singing', 'sing', 'symphony', 'opera'] },
  { icon: 'church', words: ['church', 'mass', 'temple', 'synagogue', 'mosque', 'worship', 'prayer', 'bible study'] },
  {
    icon: 'utensils',
    words: ['breakfast', 'lunch', 'dinner', 'brunch', 'supper', 'meal', 'meals', 'restaurant', 'eat', 'potluck'],
  },
  { icon: 'coffee', words: ['coffee', 'tea', 'cafe', 'café'] },
  { icon: 'footprints', words: ['walk', 'walking', 'stroll', 'hike'] },
  {
    icon: 'dumbbell',
    words: ['exercise', 'exercises', 'gym', 'workout', 'yoga', 'pilates', 'tai chi', 'swim', 'swimming', 'aerobics', 'fitness', 'stretching'],
  },
  { icon: 'shopping-cart', words: ['shopping', 'shop', 'groceries', 'grocery', 'supermarket', 'market', 'store'] },
  { icon: 'plane', words: ['flight', 'fly', 'airport', 'plane', 'trip', 'travel', 'vacation'] },
  { icon: 'bus', words: ['bus', 'shuttle'] },
  { icon: 'car', words: ['pickup', 'pick up', 'ride', 'drive', 'driver', 'car', 'taxi', 'uber', 'lyft'] },
  { icon: 'paw-print', words: ['dog', 'dogs', 'cat', 'cats', 'vet', 'pet', 'pets', 'groomer'] },
  { icon: 'gift', words: ['gift', 'gifts', 'present', 'presents'] },
  { icon: 'mail', words: ['mail', 'post office', 'letter', 'letters', 'package', 'parcel'] },
  { icon: 'landmark', words: ['bank', 'lawyer', 'attorney', 'notary'] },
  { icon: 'trash-2', words: ['trash', 'garbage', 'rubbish', 'recycling', 'bins', 'bin'] },
  { icon: 'bath', words: ['bath', 'shower', 'bathe'] },
  { icon: 'shirt', words: ['laundry', 'clothes', 'dry cleaning'] },
  { icon: 'spray-can', words: ['cleaning', 'cleaner', 'cleaners', 'housekeeping', 'housekeeper'] },
  { icon: 'flower-2', words: ['garden', 'gardening', 'flowers', 'plants', 'water plants'] },
  { icon: 'tv', words: ['tv', 'television', 'news', 'show', 'movie', 'movies', 'film', 'jeopardy'] },
  { icon: 'bed', words: ['nap', 'sleep', 'bedtime', 'bed', 'rest'] },
  {
    icon: 'users',
    words: ['visit', 'visits', 'visiting', 'visitor', 'visitors', 'guests', 'family', 'friends', 'grandkids', 'grandchildren', 'club', 'group'],
  },
];

/** Lowercase words separated by single spaces, with a space at each end. */
function normalise(text: string): string {
  return ' ' + text.toLowerCase().replace(/[^a-z0-9À-ɏ]+/g, ' ').trim() + ' ';
}

/** The name of the picture for a title, or undefined if no rule matches. */
export function iconForTitle(title: string, rules: IconRule[] = ICON_RULES): string | undefined {
  if (!title) return undefined;
  const text = normalise(title);
  for (let i = 0; i < rules.length; i++) {
    const words = rules[i].words;
    for (let j = 0; j < words.length; j++) {
      if (text.indexOf(normalise(words[j])) >= 0) return rules[i].icon;
    }
  }
  return undefined;
}
