/** Sentinel site value for recipes with no `site` (shown as Personal in the source filter). */
export const PERSONAL_SITE = 'personal'

/** Host → display label for common recipe sources. Unknown hosts fall back to the host. */
export const SITE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  [PERSONAL_SITE]: 'Personal',
  '100daysofrealfood.com': '100 Days of Real Food',
  'acouplecooks.com': 'A Couple Cooks',
  'alexandracooks.com': 'Alexandra Cooks',
  'allrecipes.com': 'Allrecipes',
  'americastestkitchen.com': "America's Test Kitchen",
  'bakingamoment.com': 'Baking a Moment',
  'bbc.co.uk': 'BBC Food',
  'bbcgoodfood.com': 'BBC Good Food',
  'bhg.com': 'Better Homes & Gardens',
  'bonappetit.com': 'Bon Appétit',
  'bromabakery.com': 'Broma Bakery',
  'budgetbytes.com': 'Budget Bytes',
  'cafedelites.com': 'Cafe Delites',
  'chelseasmessyapron.com': "Chelsea's Messy Apron",
  'chilipeppermadness.com': 'Chili Pepper Madness',
  'cookieandkate.com': 'Cookie and Kate',
  'cooking.nytimes.com': 'NYT Cooking',
  'cookinglight.com': 'Cooking Light',
  'cookpad.com': 'Cookpad',
  'damndelicious.net': 'Damn Delicious',
  'delish.com': 'Delish',
  'diffordsguide.com': "Difford's Guide",
  'downshiftology.com': 'Downshiftology',
  'eatingwell.com': 'EatingWell',
  'epicurious.com': 'Epicurious',
  'feelgoodfoodie.net': 'Feel Good Foodie',
  'food.com': 'Food.com',
  'food52.com': 'Food52',
  'foodandwine.com': 'Food & Wine',
  'foodnetwork.com': 'Food Network',
  'geniuskitchen.com': 'Genius Kitchen',
  'gimmesomeoven.com': 'Gimme Some Oven',
  'halfbakedharvest.com': 'Half Baked Harvest',
  'handletheheat.com': 'Handle the Heat',
  'heygrillhey.com': 'Hey Grill Hey',
  'hot-thai-kitchen.com': 'Hot Thai Kitchen',
  'howsweeteats.com': 'How Sweet Eats',
  'indianhealthyrecipes.com': 'Indian Healthy Recipes',
  'inspiredtaste.net': 'Inspired Taste',
  'isabeleats.com': 'Isabel Eats',
  'jessicainthekitchen.com': 'Jessica in the Kitchen',
  'joythebaker.com': 'Joy the Baker',
  'kingarthurbaking.com': 'King Arthur Baking',
  'lecremedelacrumb.com': 'Le Creme de la Crumb',
  'loveandlemons.com': 'Love and Lemons',
  'marthastewart.com': 'Martha Stewart',
  'minimalistbaker.com': 'Minimalist Baker',
  'momontimeout.com': 'Mom On Timeout',
  'myrecipes.com': 'MyRecipes',
  'natashaskitchen.com': "Natasha's Kitchen",
  'onceuponachef.com': 'Once Upon a Chef',
  'pinchofyum.com': 'Pinch of Yum',
  'preppykitchen.com': 'Preppy Kitchen',
  'recipetineats.com': 'RecipeTin Eats',
  'sallysbakingaddiction.com': "Sally's Baking Addiction",
  'saveur.com': 'Saveur',
  'seriouseats.com': 'Serious Eats',
  'simplyrecipes.com': 'Simply Recipes',
  'sipandfeast.com': 'Sip and Feast',
  'skinnytaste.com': 'Skinnytaste',
  'smittenkitchen.com': 'Smitten Kitchen',
  'spendwithpennies.com': 'Spend With Pennies',
  'sugarspunrun.com': 'Sugar Spun Run',
  'tasteofhome.com': 'Taste of Home',
  'tastesbetterfromscratch.com': 'Tastes Better From Scratch',
  'tasty.co': 'Tasty',
  'thekitchn.com': 'The Kitchn',
  'themediterraneandish.com': 'The Mediterranean Dish',
  'thepioneerwoman.com': 'The Pioneer Woman',
  'therecipecritic.com': 'The Recipe Critic',
  'twopeasandtheirpod.com': 'Two Peas & Their Pod',
  'washingtonpost.com': 'Washington Post',
  'whatsgabycooking.com': "What's Gaby Cooking",
  'yummly.com': 'Yummly',
}

/** Host used for recipe `site` metadata (www stripped; food52.com stays food52.com). */
export function siteFromUrl(url: string): string | null {
  let host = ''
  try {
    host = new URL(url.trim()).hostname.toLowerCase()
  } catch {
    return null
  }
  if (host.startsWith('www.')) {
    host = host.slice(4)
  }
  return host || null
}

export function siteFromMetadata(metadata: Record<string, unknown>): string | null {
  const explicit = metadata.site
  if (typeof explicit === 'string' && explicit.trim()) {
    return explicit.trim().toLocaleLowerCase()
  }
  for (const key of ['source', 'image_source'] as const) {
    const value = metadata[key]
    if (typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))) {
      const site = siteFromUrl(value)
      if (site) {
        return site
      }
    }
  }
  return null
}

export function formatSiteLabel(site: string): string {
  const key = site.trim().toLocaleLowerCase()
  return SITE_DISPLAY_NAMES[key] ?? site
}
