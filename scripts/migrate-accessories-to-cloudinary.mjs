import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFile } from 'node:fs/promises';
import { readFileSync as readJson } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const serviceAccount = JSON.parse(readJson(path.join(root, 'firebase-service-account.json'), 'utf8'));
const cloudName = 'j7wzqtfr';
const uploadPreset = 'formosa_flashcard_upload';
const assets = [
  { id: 'ribbon', name: 'Pita Merah', price: 0, icon: 'R', previewFile: 'Preview_acc_ribbon.png', layerFile: 'acc_ribbon.PNG', sortOrder: 0 },
  { id: 'hat', name: 'Topi Panda', price: 350, icon: 'H', previewFile: 'Preview_acc_hat.png', layerFile: 'acc_hat.PNG', sortOrder: 1 },
  { id: 'glasses', name: 'Kacamata Hitam', price: 180, icon: 'G', previewFile: 'Preview_acc_blackglasses.png', layerFile: 'acc_blackglasses.PNG', sortOrder: 2 },
  { id: 'leaf', name: 'Daun', price: 120, icon: 'L', previewFile: 'Preview_acc_leaf.png', layerFile: 'acc_leaf.PNG', sortOrder: 3 },
  { id: 'mask', name: 'Masker', price: 220, icon: 'M', previewFile: 'Preview_acc_mask.png', layerFile: 'acc_mask.PNG', sortOrder: 4 },
  { id: 'crown', name: 'Mahkota', price: 400, icon: 'C', previewFile: 'Preview_acc_crown.png', layerFile: 'acc_crown.PNG', sortOrder: 5 },
  { id: 'starclip', name: 'Jepit Bintang', price: 250, icon: 'S', previewFile: 'Preview_acc_starclip.png', layerFile: 'acc_starclip.PNG', sortOrder: 6 },
];

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function upload(fileName, kind) {
  const filePath = path.join(root, 'public', 'assets', fileName);
  const file = await readFile(filePath);
  const body = new FormData();
  body.append('file', new Blob([file], { type: 'image/png' }), fileName);
  body.append('upload_preset', uploadPreset);
  body.append('folder', `accessories/${kind}`);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body });
  const result = await response.json();
  if (!response.ok || !result.secure_url || !result.public_id) {
    throw new Error(result.error?.message ?? `Upload ${fileName} gagal.`);
  }
  return { url: result.secure_url, publicId: result.public_id };
}

for (const asset of assets) {
  const ref = db.collection('accessories').doc(asset.id);
  const snapshot = await ref.get();
  const existing = snapshot.exists ? snapshot.data() : {};
  const preview = await upload(asset.previewFile, 'preview');
  const layer = await upload(asset.layerFile, 'accessory');

  await ref.set({
    id: asset.id,
    name: existing.name ?? asset.name,
    price: typeof existing.price === 'number' ? existing.price : asset.price,
    icon: existing.icon ?? asset.icon,
    category: existing.category ?? 'other',
    layer: existing.layer ?? 'head',
    sortOrder: typeof existing.sortOrder === 'number' ? existing.sortOrder : asset.sortOrder,
    active: existing.active !== false,
    previewUrl: preview.url,
    previewPublicId: preview.publicId,
    accessoryUrl: layer.url,
    accessoryPublicId: layer.publicId,
    migratedFrom: `public/assets/${asset.layerFile}`,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log(`${asset.id}: ${preview.url}`);
}

console.log(`Migrasi selesai: ${assets.length} aksesoris.`);
