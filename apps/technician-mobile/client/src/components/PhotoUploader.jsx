// client/src/components/PhotoUploader.jsx

import { useState } from 'react';
import { supabase } from '../supabaseClient';

export default function PhotoUploader({ jobId, onUpload }) {
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    const filePath = `${jobId}/${Date.now()}_${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from('job-photos')
      .upload(filePath, file);

    if (uploadError) {
      alert('Ошибка загрузки: ' + uploadError.message);
      setUploading(false);
      return;
    }

    const { data: urlData, error: urlError } = await supabase.storage
      .from('job-photos')
      .getPublicUrl(filePath);

    if (urlError) {
      alert('Ошибка получения URL: ' + urlError.message);
      setUploading(false);
      return;
    }

    if (urlData?.publicUrl) {
      const { error: insertError } = await supabase.from('materials').insert({
        job_id: jobId,
        name: 'фото',
        quantity: 1,
        price: 0,
        supplier: '',
        content: urlData.publicUrl
      });

      if (insertError) {
        alert('Ошибка сохранения фото в базе: ' + insertError.message);
      } else {
        onUpload();
      }
    }

    setUploading(false);
  };

  return (
    <div className="p-2 border rounded">
      <label className="block mb-1 font-medium">Загрузить фото:</label>
      <input type="file" onChange={handleUpload} disabled={uploading} />
      {uploading && <p>Загрузка...</p>}
    </div>
  );
}
