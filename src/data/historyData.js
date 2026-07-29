// A three-level tree of history: eras -> major events -> sub-events.
// Every node carries `era` so descendants can inherit their root's color,
// and `parentId` so the canvas can find children to expand on click.

export const ERA_COLORS = {
  ancient: '#a2845e',
  medieval: '#7d5a50',
  renaissance: '#b8860b',
  exploration: '#2e7d6b',
  industrial: '#4a5568',
  worldwars: '#a13b3b',
  coldwar: '#4a5da1',
  digital: '#0071e3',
};

export const historyData = [
  // ── Ancient Civilizations ────────────────────────────────────────
  {
    id: 'era-ancient',
    parentId: null,
    era: 'ancient',
    label: 'Ancient Civilizations',
    date: '3000 BCE – 500 CE',
    description: 'The rise of the first great cultures along fertile river valleys.',
  },
  {
    id: 'anc-egypt',
    parentId: 'era-ancient',
    era: 'ancient',
    label: 'Ancient Egypt',
    date: 'c. 3100 BCE',
    description: 'Unification of Upper and Lower Egypt under the first pharaohs.',
  },
  {
    id: 'anc-mesopotamia',
    parentId: 'era-ancient',
    era: 'ancient',
    label: 'Mesopotamia',
    date: 'c. 3500 BCE',
    description: 'Sumerian city-states develop cuneiform, the earliest writing system.',
  },
  {
    id: 'anc-greece',
    parentId: 'era-ancient',
    era: 'ancient',
    label: 'Classical Greece',
    date: 'c. 500 BCE',
    description: 'Birthplace of democracy, philosophy, and Western drama.',
  },
  {
    id: 'anc-rome',
    parentId: 'era-ancient',
    era: 'ancient',
    label: 'Roman Empire',
    date: '27 BCE – 476 CE',
    description: 'From republic to empire, Rome shapes law, engineering, and language.',
  },
  {
    id: 'anc-pyramids',
    parentId: 'anc-egypt',
    era: 'ancient',
    label: 'Great Pyramid of Giza',
    date: 'c. 2560 BCE',
    description: 'Built as a tomb for Pharaoh Khufu; the last standing Ancient Wonder.',
  },
  {
    id: 'anc-democracy',
    parentId: 'anc-greece',
    era: 'ancient',
    label: 'Birth of Democracy',
    date: '508 BCE',
    description: 'Cleisthenes reforms Athenian government into a direct democracy.',
  },
  {
    id: 'anc-rome-fall',
    parentId: 'anc-rome',
    era: 'ancient',
    label: 'Fall of Rome',
    date: '476 CE',
    description: 'Romulus Augustulus is deposed, ending the Western Roman Empire.',
  },

  // ── Middle Ages ───────────────────────────────────────────────────
  {
    id: 'era-medieval',
    parentId: null,
    era: 'medieval',
    label: 'Middle Ages',
    date: '500 – 1400',
    description: 'Feudal kingdoms, spreading faiths, and the growth of trade routes.',
  },
  {
    id: 'med-charlemagne',
    parentId: 'era-medieval',
    era: 'medieval',
    label: 'Charlemagne Crowned',
    date: '800 CE',
    description: 'Crowned Holy Roman Emperor, unifying much of Western Europe.',
  },
  {
    id: 'med-crusades',
    parentId: 'era-medieval',
    era: 'medieval',
    label: 'The Crusades',
    date: '1095 – 1291',
    description: 'A series of religious wars between Christians and Muslims for the Holy Land.',
  },
  {
    id: 'med-magnacarta',
    parentId: 'era-medieval',
    era: 'medieval',
    label: 'Magna Carta',
    date: '1215',
    description: 'King John of England limits royal power, seeding constitutional law.',
  },
  {
    id: 'med-blackdeath',
    parentId: 'era-medieval',
    era: 'medieval',
    label: 'The Black Death',
    date: '1347 – 1351',
    description: 'Bubonic plague kills an estimated third of Europe’s population.',
  },

  // ── Renaissance ───────────────────────────────────────────────────
  {
    id: 'era-renaissance',
    parentId: null,
    era: 'renaissance',
    label: 'Renaissance',
    date: '1400 – 1600',
    description: 'A rebirth of art, science, and humanist thought across Europe.',
  },
  {
    id: 'ren-printing',
    parentId: 'era-renaissance',
    era: 'renaissance',
    label: 'Gutenberg’s Printing Press',
    date: '1440',
    description: 'Movable type makes books affordable and knowledge portable.',
  },
  {
    id: 'ren-davinci',
    parentId: 'era-renaissance',
    era: 'renaissance',
    label: 'Leonardo da Vinci',
    date: '1452 – 1519',
    description: 'Painter, inventor, and anatomist embodying the Renaissance ideal.',
  },
  {
    id: 'ren-reformation',
    parentId: 'era-renaissance',
    era: 'renaissance',
    label: 'Protestant Reformation',
    date: '1517',
    description: 'Martin Luther’s 95 Theses fracture the unity of Western Christianity.',
  },
  {
    id: 'ren-monalisa',
    parentId: 'ren-davinci',
    era: 'renaissance',
    label: 'The Mona Lisa',
    date: 'c. 1503',
    description: 'Da Vinci begins his most famous portrait, now housed in the Louvre.',
  },

  // ── Age of Exploration ────────────────────────────────────────────
  {
    id: 'era-exploration',
    parentId: null,
    era: 'exploration',
    label: 'Age of Exploration',
    date: '1400s – 1600s',
    description: 'European voyages open new trade routes and reshape the map of the world.',
  },
  {
    id: 'exp-columbus',
    parentId: 'era-exploration',
    era: 'exploration',
    label: 'Columbus Reaches the Americas',
    date: '1492',
    description: 'Christopher Columbus lands in the Caribbean, beginning sustained contact.',
  },
  {
    id: 'exp-magellan',
    parentId: 'era-exploration',
    era: 'exploration',
    label: 'Magellan Circumnavigates the Globe',
    date: '1519 – 1522',
    description: 'The expedition proves the Earth can be sailed around in one voyage.',
  },
  {
    id: 'exp-columbianexchange',
    parentId: 'exp-columbus',
    era: 'exploration',
    label: 'The Columbian Exchange',
    date: '1492 onward',
    description: 'Crops, animals, and diseases transfer between the Old and New Worlds.',
  },

  // ── Industrial Revolution ─────────────────────────────────────────
  {
    id: 'era-industrial',
    parentId: null,
    era: 'industrial',
    label: 'Industrial Revolution',
    date: '1760 – 1840',
    description: 'Steam power and mechanization transform economies and cities.',
  },
  {
    id: 'ind-steamengine',
    parentId: 'era-industrial',
    era: 'industrial',
    label: 'Watt’s Steam Engine',
    date: '1776',
    description: 'James Watt’s improved steam engine powers factories and locomotives.',
  },
  {
    id: 'ind-americanrev',
    parentId: 'era-industrial',
    era: 'industrial',
    label: 'American Revolution',
    date: '1775 – 1783',
    description: 'Thirteen colonies win independence from Britain, forming the United States.',
  },
  {
    id: 'ind-frenchrev',
    parentId: 'era-industrial',
    era: 'industrial',
    label: 'French Revolution',
    date: '1789 – 1799',
    description: 'Monarchy is overthrown amid calls for liberty, equality, and fraternity.',
  },
  {
    id: 'ind-railways',
    parentId: 'ind-steamengine',
    era: 'industrial',
    label: 'The Railway Boom',
    date: '1830s',
    description: 'Steam locomotives connect cities, collapsing travel times across nations.',
  },

  // ── World Wars ─────────────────────────────────────────────────────
  {
    id: 'era-worldwars',
    parentId: null,
    era: 'worldwars',
    label: 'World Wars',
    date: '1914 – 1945',
    description: 'Two global conflicts redraw borders and reshape geopolitics forever.',
  },
  {
    id: 'ww-wwistart',
    parentId: 'era-worldwars',
    era: 'worldwars',
    label: 'WWI Begins',
    date: '1914',
    description: 'Assassination of Archduke Franz Ferdinand triggers a continental war.',
  },
  {
    id: 'ww-treatyversailles',
    parentId: 'era-worldwars',
    era: 'worldwars',
    label: 'Treaty of Versailles',
    date: '1919',
    description: 'Punitive terms on Germany sow the seeds of future conflict.',
  },
  {
    id: 'ww-wwiistart',
    parentId: 'era-worldwars',
    era: 'worldwars',
    label: 'WWII Begins',
    date: '1939',
    description: 'Germany invades Poland; Britain and France declare war.',
  },
  {
    id: 'ww-pearlharbor',
    parentId: 'ww-wwiistart',
    era: 'worldwars',
    label: 'Attack on Pearl Harbor',
    date: 'Dec 7, 1941',
    description: 'Japan’s surprise attack draws the United States into the war.',
  },
  {
    id: 'ww-dday',
    parentId: 'ww-wwiistart',
    era: 'worldwars',
    label: 'D-Day Landings',
    date: 'Jun 6, 1944',
    description: 'Allied forces land in Normandy, opening a western front in Europe.',
  },
  {
    id: 'ww-hiroshima',
    parentId: 'ww-wwiistart',
    era: 'worldwars',
    label: 'Hiroshima & Nagasaki',
    date: 'Aug 1945',
    description: 'Atomic bombs are dropped, precipitating Japan’s surrender and the war’s end.',
  },

  // ── Cold War ────────────────────────────────────────────────────────
  {
    id: 'era-coldwar',
    parentId: null,
    era: 'coldwar',
    label: 'Cold War',
    date: '1947 – 1991',
    description: 'A decades-long standoff between the United States and the Soviet Union.',
  },
  {
    id: 'cw-berlinwall',
    parentId: 'era-coldwar',
    era: 'coldwar',
    label: 'Berlin Wall Erected',
    date: '1961',
    description: 'East Germany divides Berlin, becoming the era’s starkest symbol.',
  },
  {
    id: 'cw-cubanmissile',
    parentId: 'era-coldwar',
    era: 'coldwar',
    label: 'Cuban Missile Crisis',
    date: '1962',
    description: 'A 13-day standoff brings the world to the brink of nuclear war.',
  },
  {
    id: 'cw-moonlanding',
    parentId: 'era-coldwar',
    era: 'coldwar',
    label: 'Moon Landing',
    date: '1969',
    description: 'Apollo 11 lands astronauts on the Moon, a Space Race milestone.',
  },
  {
    id: 'cw-wallfalls',
    parentId: 'cw-berlinwall',
    era: 'coldwar',
    label: 'Fall of the Berlin Wall',
    date: '1989',
    description: 'Crowds tear down the wall, foreshadowing German reunification.',
  },
  {
    id: 'cw-ussrcollapse',
    parentId: 'era-coldwar',
    era: 'coldwar',
    label: 'Collapse of the USSR',
    date: '1991',
    description: 'The Soviet Union dissolves into fifteen independent states.',
  },

  // ── Digital Age ──────────────────────────────────────────────────────
  {
    id: 'era-digital',
    parentId: null,
    era: 'digital',
    label: 'Digital Age',
    date: '1990 – Present',
    description: 'The internet and personal computing reshape how humanity connects.',
  },
  {
    id: 'dig-www',
    parentId: 'era-digital',
    era: 'digital',
    label: 'World Wide Web',
    date: '1991',
    description: 'Tim Berners-Lee releases the Web to the public, opening the internet era.',
  },
  {
    id: 'dig-iphone',
    parentId: 'era-digital',
    era: 'digital',
    label: 'The iPhone',
    date: '2007',
    description: 'Apple’s touchscreen smartphone redefines personal computing.',
  },
  {
    id: 'dig-socialmedia',
    parentId: 'dig-www',
    era: 'digital',
    label: 'Rise of Social Media',
    date: '2004 – 2010',
    description: 'Facebook, Twitter, and others transform communication and media.',
  },
  {
    id: 'dig-ai',
    parentId: 'era-digital',
    era: 'digital',
    label: 'Generative AI Era',
    date: '2020s',
    description: 'Large language models bring conversational AI into everyday life.',
  },
];

export function getRoots() {
  return historyData.filter((n) => n.parentId === null);
}

export function getChildren(id) {
  return historyData.filter((n) => n.parentId === id);
}

export function hasChildren(id) {
  return historyData.some((n) => n.parentId === id);
}
