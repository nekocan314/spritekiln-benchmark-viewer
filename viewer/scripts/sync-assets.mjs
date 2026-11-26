import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const presets = [
  'preset_a_light_ponytail_sword',
  'preset_b_light_short_staff',
  'preset_c_heavy_helm_sword',
  'preset_d_robe_long_staff',
  'preset_e_base_hair_compare',
];

const destRoot = path.join(root, 'viewer', 'public', 'assets', 'sprites');
fs.mkdirSync(destRoot, { recursive: true });

for (const id of presets) {
  const srcDir = path.join(root, 'art', 'specs', 'characters', id, 'out', id);
  const dstDir = path.join(destRoot, id);
  fs.mkdirSync(dstDir, { recursive: true });

  const files = [`${id}.png`, `${id}_normal.png`, `${id}_emissive.png`, `${id}.json`];
  for (const f of files) {
    const src = path.join(srcDir, f);
    const dst = path.join(dstDir, f);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing rendered asset: ${src}`);
    }
    fs.copyFileSync(src, dst);
  }
  console.log(`Synced ${id} -> viewer/public/assets/sprites/${id}`);
}
