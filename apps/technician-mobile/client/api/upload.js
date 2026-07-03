// client/api/upload.js
import formidable from 'formidable';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'attachments';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const form = formidable({ multiples: false, maxFileSize: 50 * 1024 * 1024 });
    const { files, fields } = await new Promise((resolve, reject) => {
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve({ fields: flds, files: fls })));
    });
    const file = files.file;
    if (!file) return res.status(400).json({ error: 'No file (field "file")' });

    const folder = fields.folder || '';
    const original = file.originalFilename || 'upload.bin';
    const ext = original.includes('.') ? original.split('.').pop() : 'bin';
    const name = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const path = folder ? `${folder}/${name}` : name;

    const buf = fs.readFileSync(file.filepath);
    const contentType = file.mimetype || 'application/octet-stream';

    const { error } = await supabase.storage.from(BUCKET).upload(path, buf, { contentType, upsert: false });
    if (error) return res.status(500).json({ error: error.message });

    const { data: signed, error: signErr } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (signErr) return res.status(500).json({ error: signErr.message });

    res.status(200).json({ path, url: signed.signedUrl });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Upload failed' });
  }
}
