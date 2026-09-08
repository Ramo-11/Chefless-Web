export const INGREDIENT_CATEGORIES = [
  "Produce",
  "Dairy",
  "Meat",
  "Seafood",
  "Bakery",
  "Pantry",
  "Spices",
  "Canned",
  "Frozen",
  "Other",
] as const;

export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number];

export const INGREDIENT_CATEGORY_MAP: Record<string, string> = {
  chicken: "Meat",
  beef: "Meat",
  lamb: "Meat",
  pork: "Meat",
  turkey: "Meat",
  steak: "Meat",
  sausage: "Meat",
  bacon: "Meat",
  "ground beef": "Meat",
  "ground turkey": "Meat",
  "ground chicken": "Meat",
  veal: "Meat",
  duck: "Meat",

  salmon: "Seafood",
  shrimp: "Seafood",
  tuna: "Seafood",
  cod: "Seafood",
  tilapia: "Seafood",
  crab: "Seafood",
  lobster: "Seafood",
  fish: "Seafood",
  prawns: "Seafood",

  milk: "Dairy",
  cheese: "Dairy",
  butter: "Dairy",
  cream: "Dairy",
  yogurt: "Dairy",
  "sour cream": "Dairy",
  "cream cheese": "Dairy",
  mozzarella: "Dairy",
  parmesan: "Dairy",
  cheddar: "Dairy",
  eggs: "Dairy",
  egg: "Dairy",
  "heavy cream": "Dairy",
  "whipping cream": "Dairy",

  onion: "Produce",
  onions: "Produce",
  tomato: "Produce",
  tomatoes: "Produce",
  lettuce: "Produce",
  spinach: "Produce",
  garlic: "Produce",
  ginger: "Produce",
  carrot: "Produce",
  carrots: "Produce",
  potato: "Produce",
  potatoes: "Produce",
  pepper: "Produce",
  peppers: "Produce",
  "bell pepper": "Produce",
  cucumber: "Produce",
  broccoli: "Produce",
  celery: "Produce",
  mushroom: "Produce",
  mushrooms: "Produce",
  avocado: "Produce",
  lemon: "Produce",
  lime: "Produce",
  corn: "Produce",
  zucchini: "Produce",
  cabbage: "Produce",
  kale: "Produce",
  cilantro: "Produce",
  parsley: "Produce",
  basil: "Produce",
  mint: "Produce",
  "green onion": "Produce",
  "green onions": "Produce",
  scallions: "Produce",
  jalapeño: "Produce",
  jalapeno: "Produce",
  banana: "Produce",
  apple: "Produce",
  orange: "Produce",
  berries: "Produce",
  strawberries: "Produce",
  blueberries: "Produce",

  flour: "Pantry",
  sugar: "Pantry",
  oil: "Pantry",
  "olive oil": "Pantry",
  "vegetable oil": "Pantry",
  "coconut oil": "Pantry",
  salt: "Pantry",
  "black pepper": "Pantry",
  vinegar: "Pantry",
  "soy sauce": "Pantry",
  rice: "Pantry",
  pasta: "Pantry",
  noodles: "Pantry",
  "baking powder": "Pantry",
  "baking soda": "Pantry",
  vanilla: "Pantry",
  "vanilla extract": "Pantry",
  honey: "Pantry",
  "maple syrup": "Pantry",
  "tomato paste": "Pantry",
  "tomato sauce": "Pantry",
  broth: "Pantry",
  "chicken broth": "Pantry",
  "beef broth": "Pantry",
  stock: "Pantry",
  "bread crumbs": "Pantry",
  breadcrumbs: "Pantry",
  cornstarch: "Pantry",

  cumin: "Spices",
  paprika: "Spices",
  "chili powder": "Spices",
  oregano: "Spices",
  thyme: "Spices",
  rosemary: "Spices",
  cinnamon: "Spices",
  nutmeg: "Spices",
  turmeric: "Spices",
  cayenne: "Spices",
  "garlic powder": "Spices",
  "onion powder": "Spices",
  "bay leaf": "Spices",
  "bay leaves": "Spices",
  cloves: "Spices",
  coriander: "Spices",

  bread: "Bakery",
  tortilla: "Bakery",
  tortillas: "Bakery",
  pita: "Bakery",
  buns: "Bakery",
  rolls: "Bakery",

  "canned tomatoes": "Canned",
  "diced tomatoes": "Canned",
  "crushed tomatoes": "Canned",
  "canned beans": "Canned",
  "black beans": "Canned",
  "kidney beans": "Canned",
  chickpeas: "Canned",
  lentils: "Canned",
  "coconut milk": "Canned",

  "frozen peas": "Frozen",
  "frozen corn": "Frozen",
  "frozen berries": "Frozen",
};

export function categorizeIngredient(name: string): string {
  const lower = name.toLowerCase().trim();

  if (INGREDIENT_CATEGORY_MAP[lower]) {
    return INGREDIENT_CATEGORY_MAP[lower];
  }

  for (const [keyword, category] of Object.entries(INGREDIENT_CATEGORY_MAP)) {
    if (lower.includes(keyword) || keyword.includes(lower)) {
      return category;
    }
  }

  return "Other";
}

export function normalizeIngredientKey(raw: string): string {
  return raw.toLowerCase().trim();
}

const UNIT_WORDS = new Set([
  "cup",
  "cups",
  "tablespoon",
  "tablespoons",
  "tbsp",
  "tbsps",
  "teaspoon",
  "teaspoons",
  "tsp",
  "tsps",
  "ounce",
  "ounces",
  "oz",
  "pound",
  "pounds",
  "lb",
  "lbs",
  "gram",
  "grams",
  "g",
  "kilogram",
  "kilograms",
  "kg",
  "milliliter",
  "milliliters",
  "ml",
  "liter",
  "liters",
  "litre",
  "litres",
  "l",
  "pint",
  "pints",
  "quart",
  "quarts",
  "gallon",
  "gallons",
  "pinch",
  "pinches",
  "dash",
  "dashes",
  "clove",
  "cloves",
  "slice",
  "slices",
  "piece",
  "pieces",
  "can",
  "cans",
  "jar",
  "jars",
  "package",
  "packages",
  "pkg",
  "bag",
  "bags",
  "bunch",
  "bunches",
  "head",
  "heads",
  "stick",
  "sticks",
  "stalk",
  "stalks",
  "sprig",
  "sprigs",
]);

const DESCRIPTOR_WORDS = new Set([
  "fresh",
  "chopped",
  "diced",
  "minced",
  "sliced",
  "large",
  "small",
  "medium",
  "ripe",
  "boneless",
  "skinless",
  "ground",
  "finely",
  "roughly",
  "optional",
  "to",
  "taste",
  "peeled",
  "crushed",
  "shredded",
  "grated",
  "melted",
  "softened",
  "thinly",
  "coarsely",
  "cubed",
  "halved",
  "quartered",
  "julienned",
  "trimmed",
  "seeded",
  "deveined",
  "cooked",
  "raw",
  "drained",
  "rinsed",
  "thawed",
  "frozen",
  "dried",
  "room",
  "temperature",
  "packed",
  "extra",
  "virgin",
  "unsalted",
  "salted",
  "warm",
  "cold",
  "chilled",
  "whole",
  "of",
]);

const SINGULARIZE_EXCEPTIONS = new Set([
  "hummus",
  "couscous",
  "molasses",
  "asparagus",
  "watercress",
  "swiss",
  "brussels",
]);

function singularizeWord(word: string): string {
  if (SINGULARIZE_EXCEPTIONS.has(word)) return word;
  if (word.endsWith("ies") && word.length > 4) {
    return word.slice(0, -3) + "y";
  }
  if (word.endsWith("ves") && word.length > 4) {
    return word.slice(0, -3) + "f";
  }
  if (word.endsWith("oes") && word.length > 4) {
    return word.slice(0, -2);
  }
  if (word.endsWith("es") && !word.endsWith("ss") && word.length > 4) {
    return word.slice(0, -2);
  }
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) {
    return word.slice(0, -1);
  }
  return word;
}

const APOSTROPHE_REGEX = /['’]/g;
const PUNCTUATION_REGEX = /[,.()[\]{}!?;:"`*]/g;
const WHITESPACE_REGEX = /\s+/g;
const PURE_NUMBER_REGEX = /^\d+$/;
const DECIMAL_REGEX = /^\d*\.\d+$/;
const FRACTION_REGEX = /^\d+\/\d+$/;
const RANGE_REGEX = /^\d+-\d+$/;

function isDroppableToken(token: string): boolean {
  if (UNIT_WORDS.has(token)) return true;
  if (DESCRIPTOR_WORDS.has(token)) return true;
  if (PURE_NUMBER_REGEX.test(token)) return true;
  if (DECIMAL_REGEX.test(token)) return true;
  if (FRACTION_REGEX.test(token)) return true;
  if (RANGE_REGEX.test(token)) return true;
  return false;
}

export function normalizeIngredientName(raw: string): string {
  let value = raw.toLowerCase();
  value = value.replace(APOSTROPHE_REGEX, "");
  value = value.replace(PUNCTUATION_REGEX, " ");
  value = value.replace(WHITESPACE_REGEX, " ").trim();

  if (!value) return "";

  const tokens = value.split(" ");
  const filtered = tokens.filter((token) => !isDroppableToken(token));
  const kept = filtered.length > 0 ? filtered : tokens;
  const singularized = kept.map(singularizeWord);

  return singularized.join(" ");
}

export const ALWAYS_AVAILABLE_INGREDIENTS = new Set<string>([
  normalizeIngredientName("water"),
  normalizeIngredientName("salt"),
]);

export const PANTRY_STAPLES: readonly string[] = [
  "salt",
  "black pepper",
  "olive oil",
  "vegetable oil",
  "butter",
  "sugar",
  "flour",
  "garlic",
  "onion",
  "rice",
  "eggs",
  "milk",
  "water",
];
