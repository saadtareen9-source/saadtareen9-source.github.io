// Shared vocabularies. The AI planner, the heuristic planner, the QC pass and
// the renderer all speak this exact language, which is what keeps characters
// and scenes consistent: a character is a small set of attributes, not a
// free-form image prompt.

export const SEGMENT_TYPES = ['face', 'scene', 'scene_bubble'];

export const SETTINGS = [
  'blank', 'kitchen', 'living_room', 'bedroom', 'bathroom', 'office', 'school',
  'street', 'park', 'store', 'restaurant', 'car', 'beach', 'night', 'party', 'hospital',
];

export const POSES = [
  'stand', 'walk', 'run', 'point', 'freeze', 'arms_up', 'sit', 'facepalm',
  'shrug', 'fall', 'wave', 'hold', 'hands_on_hips', 'cower', 'dance', 'phone',
];

export const EXPRESSIONS = [
  'neutral', 'happy', 'laughing', 'shocked', 'angry', 'sad', 'scared', 'confused', 'smug', 'crying',
];

export const HAIR = ['none', 'spiky', 'short', 'long', 'bun', 'curly', 'ponytail', 'bald'];

export const ACCESSORIES = ['none', 'glasses', 'hat', 'cap', 'bow', 'tie', 'beard', 'mustache', 'headphones'];

export const PROPS = [
  'door', 'table', 'chair', 'stove', 'pan', 'phone', 'cup', 'laptop', 'book', 'bag',
  'car', 'dog', 'cat', 'cake', 'gift', 'money', 'ball', 'sign', 'tree', 'bed', 'tv', 'plant',
];

export const EFFECTS = [
  'smoke', 'fire', 'sweat', 'exclamation', 'question', 'hearts', 'zzz', 'motion_lines',
  'stars', 'rain', 'sparkles', 'anger',
];

export const FACINGS = ['left', 'right'];

export const COLORS = [
  '#e4572e', '#2e86de', '#20bf6b', '#f7b731', '#8854d0', '#eb3b5a', '#0fb9b1', '#fa8231', '#4b6584', '#a55eea',
];
