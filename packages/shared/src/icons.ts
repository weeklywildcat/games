/**
 * Icon keys Mini Match themes may use. The kiosk maps each key to a bundled
 * Lucide (ISC) drawing, so themes work offline and validation can catch typos.
 */
export const MATCH_ICON_KEYS = [
  "Newspaper", "Camera", "Mic", "PenLine", "Printer", "Megaphone", "NotebookPen", "Radio",
  "BookOpen", "Bookmark", "Library", "Glasses", "LampDesk", "ScrollText", "Feather", "BookMarked",
  "Backpack", "Pencil", "Ruler", "Calculator", "AlarmClock", "GraduationCap", "Apple", "Bus",
  "Trophy", "Medal", "Volleyball", "Dumbbell", "Timer", "Flag", "Target", "Award", "Bike", "Goal",
  "Rocket", "Moon", "Sun", "Star", "Orbit", "Satellite", "Telescope", "Sparkles",
  "CloudRain", "CloudSun", "Snowflake", "Umbrella", "Wind", "CloudLightning", "Rainbow", "Thermometer",
  "CookingPot", "Coffee", "Cookie", "Pizza", "Croissant", "EggFried", "Sandwich", "IceCreamCone", "Popcorn", "Soup",
  "Flower", "Flower2", "Sprout", "Leaf", "TreePine", "Carrot", "Shovel", "Clover", "TreeDeciduous", "Wheat",
  "Fish", "Shell", "Anchor", "Sailboat", "Waves", "Ship", "Turtle", "Shrimp",
  "Cat", "Dog", "Rabbit", "Bird", "Squirrel", "Snail", "Bug", "PawPrint",
  "Music", "Guitar", "Piano", "Drum", "Headphones", "MicVocal", "Disc3",
  "Plane", "Map", "Compass", "Luggage", "Tent", "Mountain", "TrainFront", "Car", "Truck", "Tractor",
  "Hammer", "Wrench", "Scissors", "Paintbrush", "Drill", "Axe", "Pickaxe",
  "Aperture", "Film", "Image", "Focus", "Zap", "Clapperboard",
  "Laptop", "Smartphone", "Gamepad2", "Keyboard", "Mouse", "Monitor", "BatteryFull", "Wifi",
  "PartyPopper", "Cake", "Gift", "Crown", "Candy", "Ticket",
  "MountainSnow", "FlameKindling", "Footprints", "Binoculars", "MapPin",
  "Circle", "Triangle", "Square", "Hexagon", "Heart", "Diamond", "Pentagon", "Octagon",
  "Cherry", "Citrus", "Grape", "Banana", "Nut",
  "Joystick", "Dice5", "Puzzle", "Swords", "Ghost",
  "Flame", "Droplet", "Eye", "Key", "Lock", "Bell", "Lightbulb",
  "Palette", "PenTool", "Shapes", "Frame", "SprayCan",
  "Atom", "FlaskConical", "Microscope", "Dna", "Magnet", "Globe",
  "Landmark", "Castle", "Hourglass", "Paperclip", "Stamp", "Mail", "Watch", "Shirt",
] as const;

export type MatchIconKey = (typeof MATCH_ICON_KEYS)[number];

const ICON_SET: ReadonlySet<string> = new Set(MATCH_ICON_KEYS);

export function isMatchIconKey(value: string): value is MatchIconKey {
  return ICON_SET.has(value);
}
