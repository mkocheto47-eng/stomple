// Сканирует public/music и пишет src/tracks.json — список треков для плеера.
// Название берётся из имени файла: "Artist - Title.mp3" → "Artist — Title".
import { readdirSync, writeFileSync } from 'node:fs';
const files = readdirSync('public/music').filter(f => /\.(mp3|m4a|ogg|wav)$/i.test(f)).sort();
const tracks = files.map(f => {
  const base = f.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s*\(.*?\)\s*$/g, '').replace(/\s+-\s+/, ' — ').trim();
  return { file: '/music/' + encodeURIComponent(f), title: base };
});
writeFileSync('src/tracks.json', JSON.stringify(tracks, null, 2) + '\n');
console.log(`tracks.json: ${tracks.length} трек(ов)`);
tracks.forEach((t, i) => console.log(`  ${i + 1}. ${t.title}`));
