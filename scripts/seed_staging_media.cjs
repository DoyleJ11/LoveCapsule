// Synthetic fixtures only. Requires explicit staging ref plus the ignored local credentials.
/* global __dirname */
const { Buffer } = require('node:buffer');
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '..');
const config = parseEnv(fs.readFileSync(path.join(root, '.env.local'), 'utf8'));
const accounts = parseEnv(fs.readFileSync(path.join(root, '.env.staging-test'), 'utf8'));
const ref = process.env.STAGING_PROJECT_REF;
if (
  !ref ||
  config.EXPO_PUBLIC_SUPABASE_URL !== `https://${ref}.supabase.co` ||
  !accounts.STAGING_PARTNER_EMAIL?.endsWith('@lovecapsule.test')
) {
  throw new Error('Confirm the staging ref and synthetic partner account before seeding.');
}
const client = createClient(config.EXPO_PUBLIC_SUPABASE_URL, config.EXPO_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const entryId = 'ee000000-0000-4000-8000-000000000003';
async function checked(request) {
  const { data, error } = await request;
  if (error) throw error;
  return data;
}
async function main() {
  const auth = await checked(
    client.auth.signInWithPassword({
      email: accounts.STAGING_PARTNER_EMAIL,
      password: accounts.STAGING_PASSWORD,
    })
  );
  const couple = await checked(
    client
      .from('couples')
      .select('id')
      .or(`partner_1_id.eq.${auth.user.id},partner_2_id.eq.${auth.user.id}`)
      .single()
  );
  const existing = await checked(client.from('entries').select('id').eq('id', entryId));
  if (existing.length) {
    console.log('Synthetic media fixture already exists; nothing changed.');
    return;
  }
  // One second of a quiet generated tone, with no microphone recording.
  const rate = 22050;
  const wav = Buffer.alloc(44 + rate * 2);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(rate * 2, 40);
  for (let i = 0; i < rate; i++) {
    wav.writeInt16LE(Math.round(Math.sin((i / rate) * 440 * Math.PI * 2) * 900), 44 + i * 2);
  }
  const files = [
    {
      id: 'ff000000-0000-4000-8000-000000000001',
      bytes: fs.readFileSync(path.join(root, 'assets/images/icon.png')),
      filename: 'synthetic-keepsake.png',
      media_type: 'image',
      mime_type: 'image/png',
    },
    {
      id: 'ff000000-0000-4000-8000-000000000002',
      bytes: wav,
      filename: 'synthetic-tone.wav',
      media_type: 'audio',
      mime_type: 'audio/wav',
      duration_ms: 1000,
    },
  ];
  const media = [];
  for (const file of files) {
    const storagePath = `${auth.user.id}/${entryId}/${file.filename}`;
    const { error } = await client.storage.from('entry-media').upload(storagePath, file.bytes, {
      contentType: file.mime_type,
      upsert: false,
    });
    if (error && error.message !== 'The resource already exists') throw error;
    media.push({
      id: file.id,
      storage_path: storagePath,
      media_type: file.media_type,
      mime_type: file.mime_type,
      duration_ms: file.duration_ms,
      file_size_bytes: file.bytes.length,
    });
  }
  await checked(
    client.rpc('save_entry', {
      p_operation_id: 'ee000000-0000-4000-8000-000000000004',
      p_entry_id: entryId,
      p_expected_updated_at: null,
      p_entry: {
        couple_id: couple.id,
        title: 'A sound and a keepsake',
        content_plain:
          'A synthetic keepsake for testing attachments. The image is the bundled app icon, and the voice memo is a generated one-second tone.',
        is_draft: false,
        mood: 'happy',
        entry_date: new Date().toISOString().slice(0, 10),
      },
      p_media: media,
      p_remove_media: [],
    })
  );
  const due = new Date(Date.now() + 10000);
  await checked(
    client.rpc('save_checkpoint_schedule', {
      p_couple_id: couple.id,
      p_id: 'ee000000-0000-4000-8000-000000000005',
      p_expected_version: null,
      p_config: {
        frequency: 'specific_date',
        specific_date: due.toISOString().slice(0, 10),
        reveal_time: due.toISOString().slice(11, 19),
        timezone: 'UTC',
        is_active: true,
        label: 'A sound and a keepsake',
      },
    })
  );
  console.log('Created synthetic photo/audio note and a checkpoint due in ten seconds.');
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
