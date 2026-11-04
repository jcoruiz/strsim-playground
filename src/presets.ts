// Built-in examples for each view.

import type { AlgoId, MetricId } from './types';

export interface PairExample {
  a: string;
  b: string;
  /** The algorithm the example is best at showing. */
  algo: AlgoId;
  note: string;
}

export const PAIRS: readonly PairExample[] = [
  { a: 'martha', b: 'marhta', algo: 'jarowinkler', note: 'The classic Jaro-Winkler example: one swap, shared prefix' },
  { a: 'kitten', b: 'sitting', algo: 'levenshtein', note: 'The classic Levenshtein example: three edits' },
  { a: 'ca', b: 'abc', algo: 'damerau', note: 'OSA says 3, Damerau-Levenshtein 2: it may insert between swapped letters' },
  { a: 'Muñoz', b: 'Munoz', algo: 'soundex', note: 'Phonetic encoders fold accents; edit distances see a different letter' },
  { a: 'Horwicz', b: 'Horowitz', algo: 'doublemetaphone', note: 'Polish -WICZ and -WITZ: Double Metaphone matches them (v0.1.0 did not)' },
  { a: 'Smith', b: 'Schmidt', algo: 'doublemetaphone', note: 'The alternate code matches the anglicized form' },
  { a: 'Catherine', b: 'Kathryn', algo: 'metaphone', note: 'Same sound, different spelling' },
  { a: 'night', b: 'nacht', algo: 'cosine', note: 'Only the shared n-grams count' },
  { a: 'Robert', b: 'Rupert', algo: 'soundex', note: 'The Soundex textbook pair' },
  { a: 'dixon', b: 'dicksonx', algo: 'jaro', note: 'Jaro on a longer, noisier pair' },
];

export interface ListPreset {
  key: string;
  name: string;
  query: string;
  metric: MetricId;
  items: string[];
}

export const LISTS: readonly ListPreset[] = [
  {
    key: 'packages',
    name: 'Go standard library packages',
    query: 'strng',
    metric: 'jarowinkler',
    items: [
      'bufio', 'bytes', 'cmp', 'context', 'crypto', 'embed', 'encoding', 'errors', 'expvar', 'flag', 'fmt', 'hash', 'html', 'image', 'io',
      'iter', 'log', 'maps', 'math', 'mime', 'net', 'os', 'path', 'plugin', 'reflect', 'regexp', 'runtime', 'slices', 'sort', 'strconv',
      'strings', 'structs', 'sync', 'syscall', 'testing', 'text', 'time', 'unicode', 'unique', 'unsafe',
    ],
  },
  {
    key: 'countries',
    name: 'Countries',
    query: 'Untied States',
    metric: 'damerau',
    items: [
      'Argentina', 'Australia', 'Austria', 'Belgium', 'Bolivia', 'Brazil', 'Canada', 'Chile', 'China', 'Colombia', 'Costa Rica', 'Croatia',
      'Cuba', 'Denmark', 'Ecuador', 'Egypt', 'Finland', 'France', 'Germany', 'Greece', 'Guatemala', 'Honduras', 'Hungary', 'Iceland', 'India',
      'Indonesia', 'Ireland', 'Israel', 'Italy', 'Japan', 'Kenya', 'Mexico', 'Morocco', 'Netherlands', 'New Zealand', 'Nigeria', 'Norway',
      'Panama', 'Paraguay', 'Peru', 'Poland', 'Portugal', 'South Africa', 'South Korea', 'Spain', 'Sweden', 'Switzerland', 'Thailand',
      'Turkey', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Venezuela', 'Vietnam',
    ],
  },
  {
    key: 'surnames',
    name: 'Surnames',
    query: 'Jonson',
    metric: 'jarowinkler',
    items: [
      'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez',
      'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris',
      'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen',
      'Hill', 'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts', 'Jonas',
      'Johnston', 'Johns', 'Jansen', 'Janson', 'Jensen', 'Hanson', 'Munoz', 'Muñoz', 'Schmidt', 'Schmitt', 'Smyth', 'Smythe',
    ],
  },
  {
    key: 'commands',
    name: 'Git commands',
    query: 'comit',
    metric: 'damerau',
    items: [
      'add', 'am', 'archive', 'bisect', 'blame', 'branch', 'bundle', 'checkout', 'cherry-pick', 'clean', 'clone', 'commit', 'config',
      'describe', 'diff', 'fetch', 'format-patch', 'gc', 'grep', 'init', 'log', 'merge', 'mv', 'notes', 'pull', 'push', 'rebase',
      'reflog', 'remote', 'reset', 'restore', 'revert', 'rm', 'shortlog', 'show', 'stash', 'status', 'submodule', 'switch', 'tag', 'worktree',
    ],
  },
];

export interface Dataset {
  key: string;
  name: string;
  about: string;
  text: string;
}

export const DATASETS: readonly Dataset[] = [
  {
    key: 'names',
    name: 'Name variants',
    about: 'First names and surnames: spelling variants of the same name, and different names that look alike.',
    text: `# a, b, same name?
Jon, John, yes
Catherine, Katherine, yes
Kathryn, Catherine, yes
Steven, Stephen, yes
Philip, Phillip, yes
Geoffrey, Jeffrey, yes
Mohammed, Muhammad, yes
Smith, Smyth, yes
Schmidt, Schmitt, yes
Muñoz, Munoz, yes
Zoë, Zoe, yes
Lee, Leigh, yes
Thompson, Thomson, yes
Johnson, Jonson, yes
Reid, Read, yes
Rodriguez, Rodrigues, yes
Gonzalez, González, yes
Ann, Anne, yes
Sara, Sarah, yes
Isabel, Isabelle, yes
Alexandr, Aleksandr, yes
Nicolas, Nikolas, yes
Martin, Marvin, no
John, Joan, no
Karen, Carl, no
Mark, Mary, no
Smith, Smithers, no
Lena, Elena, no
Daniel, Danielle, no
Peter, Petra, no
Jackson, Jameson, no
Brown, Brownlee, no
Allen, Ellen, no
Bryan, Ryan, no
Robert, Roberta, no
Jensen, Jenson, yes
Hansen, Hanson, yes
Ruth, Root, no
Gary, Mary, no
Paula, Paul, no`,
  },
  {
    key: 'typos',
    name: 'Search typos',
    about: 'Words typed in a search box and the word meant, against words that are close but mean something else.',
    text: `# typed, meant, the same word?
recieve, receive, yes
adress, address, yes
seperate, separate, yes
definately, definitely, yes
occured, occurred, yes
untill, until, yes
wierd, weird, yes
beleive, believe, yes
calender, calendar, yes
goverment, government, yes
accomodate, accommodate, yes
teh, the, yes
form, from, yes
iphnoe, iphone, yes
samsnug, samsung, yes
keybaord, keyboard, yes
labtop, laptop, yes
monitro, monitor, yes
headphnes, headphones, yes
charger, charge, no
laptop, lapdog, no
mouse, moose, no
cable, table, no
case, cast, no
phone, phony, no
screen, scream, no
tablet, tablets, yes
speaker, sneaker, no
camera, cameo, no
watch, match, no
battery, battle, no
router, rooter, no
desk, disk, no
lamp, lump, no
chair, chain, no`,
  },
];
