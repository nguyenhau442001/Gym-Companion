// Exercise catalog. [id, name, muscle, repMin, repMax, isBodyweight]
export const MUSCLES = [
  { id: 'chest', label: 'Ngực' },
  { id: 'back', label: 'Lưng' },
  { id: 'shoulders', label: 'Vai' },
  { id: 'biceps', label: 'Tay trước' },
  { id: 'triceps', label: 'Tay sau' },
  { id: 'quads', label: 'Đùi trước' },
  { id: 'hamstrings', label: 'Đùi sau · Mông' },
  { id: 'calves', label: 'Bắp chân' },
  { id: 'core', label: 'Bụng' }
];

const ROWS = [
  ['bench-press', 'Đẩy ngực ngang (Bench Press)', 'chest', 6, 10],
  ['incline-bench', 'Đẩy ngực dốc lên – đòn', 'chest', 6, 10],
  ['db-bench', 'Đẩy ngực tạ đơn', 'chest', 8, 12],
  ['incline-db-press', 'Đẩy ngực dốc lên – tạ đơn', 'chest', 8, 12],
  ['chest-fly', 'Ép ngực máy / cáp (Fly)', 'chest', 10, 15],
  ['push-up', 'Hít đất (Push-up)', 'chest', 8, 20, true],
  ['dips', 'Dips', 'chest', 6, 12, true],
  ['pull-up', 'Hít xà (Pull-up)', 'back', 5, 10, true],
  ['lat-pulldown', 'Kéo xà máy (Lat Pulldown)', 'back', 8, 12],
  ['barbell-row', 'Chèo tạ đòn (Barbell Row)', 'back', 6, 10],
  ['db-row', 'Chèo tạ đơn (Dumbbell Row)', 'back', 8, 12],
  ['seated-row', 'Kéo cáp ngồi (Seated Row)', 'back', 8, 12],
  ['deadlift', 'Deadlift', 'back', 3, 6],
  ['ohp', 'Đẩy vai đứng (Overhead Press)', 'shoulders', 5, 8],
  ['db-shoulder-press', 'Đẩy vai tạ đơn', 'shoulders', 8, 12],
  ['lateral-raise', 'Dang tạ ngang (Lateral Raise)', 'shoulders', 12, 20],
  ['rear-delt-fly', 'Bay vai sau (Rear Delt Fly)', 'shoulders', 12, 20],
  ['face-pull', 'Face Pull', 'shoulders', 12, 15],
  ['barbell-curl', 'Cuốn tạ đòn (Barbell Curl)', 'biceps', 8, 12],
  ['db-curl', 'Cuốn tạ đơn (Dumbbell Curl)', 'biceps', 8, 12],
  ['hammer-curl', 'Hammer Curl', 'biceps', 10, 12],
  ['cable-curl', 'Cuốn cáp (Cable Curl)', 'biceps', 10, 15],
  ['triceps-pushdown', 'Đè cáp tay sau (Pushdown)', 'triceps', 10, 15],
  ['skull-crusher', 'Skull Crusher', 'triceps', 8, 12],
  ['overhead-ext', 'Duỗi tay sau qua đầu', 'triceps', 10, 15],
  ['close-grip-bench', 'Đẩy ngực tay hẹp', 'triceps', 6, 10],
  ['squat', 'Squat', 'quads', 5, 8],
  ['front-squat', 'Front Squat', 'quads', 5, 8],
  ['leg-press', 'Đạp đùi (Leg Press)', 'quads', 8, 12],
  ['leg-extension', 'Đá đùi (Leg Extension)', 'quads', 12, 15],
  ['bulgarian-split-squat', 'Bulgarian Split Squat', 'quads', 8, 12],
  ['goblet-squat', 'Goblet Squat', 'quads', 8, 12],
  ['lunge', 'Lunge', 'quads', 8, 12],
  ['rdl', 'Romanian Deadlift (RDL)', 'hamstrings', 6, 10],
  ['leg-curl', 'Móc đùi (Leg Curl)', 'hamstrings', 10, 15],
  ['hip-thrust', 'Hip Thrust', 'hamstrings', 8, 12],
  ['calf-raise', 'Nhón bắp chân đứng', 'calves', 10, 15],
  ['seated-calf', 'Nhón bắp chân ngồi', 'calves', 12, 20],
  ['hanging-leg-raise', 'Treo xà gập chân', 'core', 8, 15, true],
  ['cable-crunch', 'Gập bụng cáp', 'core', 10, 15],
  ['crunch', 'Gập bụng (Crunch)', 'core', 15, 25, true],
  ['ab-wheel', 'Lăn bánh xe (Ab Wheel)', 'core', 8, 15, true]
];

export const SEED_EXERCISES = ROWS.map(([id, name, muscle, repMin, repMax, isBodyweight]) =>
  ({ id, name, muscle, repMin, repMax, isBodyweight: !!isBodyweight, isCustom: false }));

const t = (id, name, list) => ({ id, name, isSeed: true, exercises: list.map(([exerciseId, sets]) => ({ exerciseId, sets })) });

// Upper/Lower split, 4 buổi/tuần — fits the default trainingDays.
export const SEED_TEMPLATES = [
  t('tpl-upper-a', 'Upper A', [['bench-press', 3], ['barbell-row', 3], ['ohp', 3], ['lat-pulldown', 3], ['lateral-raise', 3], ['barbell-curl', 2], ['triceps-pushdown', 2]]),
  t('tpl-lower-a', 'Lower A', [['squat', 3], ['rdl', 3], ['leg-press', 3], ['leg-curl', 3], ['calf-raise', 3], ['hanging-leg-raise', 2]]),
  t('tpl-upper-b', 'Upper B', [['incline-db-press', 3], ['pull-up', 3], ['db-shoulder-press', 3], ['seated-row', 3], ['chest-fly', 2], ['hammer-curl', 2], ['overhead-ext', 2]]),
  t('tpl-lower-b', 'Lower B', [['deadlift', 3], ['bulgarian-split-squat', 3], ['leg-extension', 3], ['hip-thrust', 3], ['seated-calf', 3], ['cable-crunch', 2]])
];
