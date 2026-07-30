import { autoLayout } from './layout';

// Starter canvases, so a new user never faces an empty grid. The content is
// the historical dataset this app originally shipped with — it was wrong as
// the app's fixed content, but it makes good example material. Every block
// arrives with notes, which also means study mode works on them immediately.
const TEMPLATES = [
  {
    key: 'world-wars',
    title: 'World Wars',
    blurb: 'Two global conflicts and the events that connected them.',
    blocks: [
      {
        id: 'ww-root',
        parentId: null,
        category: 'period',
        label: 'World Wars',
        date: '1914 – 1945',
        notes: 'Two global conflicts redrew borders and reshaped geopolitics forever.',
      },
      {
        id: 'ww-wwi',
        parentId: 'ww-root',
        category: 'event',
        label: 'WWI Begins',
        date: '1914',
        notes: 'The assassination of Archduke Franz Ferdinand triggered a continental war.',
      },
      {
        id: 'ww-versailles',
        parentId: 'ww-root',
        category: 'source',
        label: 'Treaty of Versailles',
        date: '1919',
        notes: 'Punitive terms on Germany sowed the seeds of a future conflict.',
      },
      {
        id: 'ww-wwii',
        parentId: 'ww-root',
        category: 'event',
        label: 'WWII Begins',
        date: '1939',
        notes: 'Germany invaded Poland; Britain and France declared war.',
      },
      {
        id: 'ww-pearl',
        parentId: 'ww-wwii',
        category: 'event',
        label: 'Attack on Pearl Harbor',
        date: 'Dec 7, 1941',
        notes: 'Japan’s surprise attack drew the United States into the war.',
      },
      {
        id: 'ww-dday',
        parentId: 'ww-wwii',
        category: 'event',
        label: 'D-Day Landings',
        date: 'Jun 6, 1944',
        notes: 'Allied forces landed in Normandy, opening a western front in Europe.',
      },
      {
        id: 'ww-hiroshima',
        parentId: 'ww-wwii',
        category: 'event',
        label: 'Hiroshima & Nagasaki',
        date: 'Aug 1945',
        notes: 'Atomic bombs precipitated Japan’s surrender and the war’s end.',
      },
    ],
  },
  {
    key: 'renaissance',
    title: 'The Renaissance',
    blurb: 'A rebirth of art, science, and humanist thought.',
    blocks: [
      {
        id: 'ren-root',
        parentId: null,
        category: 'period',
        label: 'Renaissance',
        date: '1400 – 1600',
        notes: 'A rebirth of art, science, and humanist thought across Europe.',
      },
      {
        id: 'ren-press',
        parentId: 'ren-root',
        category: 'idea',
        label: 'Gutenberg’s Printing Press',
        date: '1440',
        notes: 'Movable type made books affordable and knowledge portable.',
      },
      {
        id: 'ren-davinci',
        parentId: 'ren-root',
        category: 'person',
        label: 'Leonardo da Vinci',
        date: '1452 – 1519',
        notes: 'Painter, inventor, and anatomist embodying the Renaissance ideal.',
      },
      {
        id: 'ren-reformation',
        parentId: 'ren-root',
        category: 'event',
        label: 'Protestant Reformation',
        date: '1517',
        notes: 'Martin Luther’s 95 Theses fractured the unity of Western Christianity.',
      },
      {
        id: 'ren-monalisa',
        parentId: 'ren-davinci',
        category: 'source',
        label: 'The Mona Lisa',
        date: 'c. 1503',
        notes: 'Da Vinci began his most famous portrait, now housed in the Louvre.',
      },
    ],
  },
  {
    key: 'cold-war',
    title: 'The Cold War',
    blurb: 'A decades-long standoff and the flashpoints along the way.',
    blocks: [
      {
        id: 'cw-root',
        parentId: null,
        category: 'period',
        label: 'Cold War',
        date: '1947 – 1991',
        notes: 'A decades-long standoff between the United States and the Soviet Union.',
      },
      {
        id: 'cw-wall',
        parentId: 'cw-root',
        category: 'place',
        label: 'Berlin Wall Erected',
        date: '1961',
        notes: 'East Germany divided Berlin, creating the era’s starkest symbol.',
      },
      {
        id: 'cw-cuba',
        parentId: 'cw-root',
        category: 'event',
        label: 'Cuban Missile Crisis',
        date: '1962',
        notes: 'A 13-day standoff brought the world to the brink of nuclear war.',
      },
      {
        id: 'cw-moon',
        parentId: 'cw-root',
        category: 'event',
        label: 'Moon Landing',
        date: '1969',
        notes: 'Apollo 11 landed astronauts on the Moon, a Space Race milestone.',
      },
      {
        id: 'cw-ussr',
        parentId: 'cw-root',
        category: 'event',
        label: 'Collapse of the USSR',
        date: '1991',
        notes: 'The Soviet Union dissolved into fifteen independent states.',
      },
      {
        id: 'cw-wallfalls',
        parentId: 'cw-wall',
        category: 'event',
        label: 'Fall of the Berlin Wall',
        date: '1989',
        notes: 'Crowds tore down the wall, foreshadowing German reunification.',
      },
    ],
  },
];

// Topic suggestions for the empty-canvas state — deliberately spread beyond
// history so the app doesn't read as history-only.
export const STARTER_TOPICS = [
  'Roman Empire',
  'Photosynthesis',
  'The French Revolution',
  'How the internet works',
  'Jazz',
];

export function listTemplates() {
  return TEMPLATES.map(({ key, title, blurb, blocks }) => ({
    key,
    title,
    blurb,
    blockCount: blocks.length,
  }));
}

export function buildTemplateGraph(key) {
  const template = TEMPLATES.find((t) => t.key === key);
  if (!template) return null;

  // Seed x by declaration order so autoLayout keeps siblings in the order
  // they're written here, then let it compute the real tidy positions.
  const nodes = template.blocks.map((block, i) => ({
    id: block.id,
    type: 'knowledge',
    position: { x: i * 320, y: 90 },
    data: {
      label: block.label,
      notes: block.notes,
      date: block.date,
      category: block.category,
      unsure: false,
      parentId: block.parentId,
      isRoot: block.parentId === null,
      aiFilled: false,
      aiCorrection: null,
      aiSuggested: false,
      collapsed: false,
    },
  }));

  const edges = template.blocks
    .filter((block) => block.parentId)
    .map((block) => ({
      id: `e-${block.parentId}-${block.id}`,
      source: block.parentId,
      target: block.id,
    }));

  return { title: template.title, nodes: autoLayout(nodes), edges };
}
