// client/src/components/UploadMedia.jsx
import React, { useState } from "react";
import { supabase } from "../supabaseClient";
import { convertIfHeic } from "../utils/convertHeicWeb";

export default function UploadMedia({ bucket = "media", folder = "uploads", onUploaded }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handleChange(e) {
    const f0 = e.target.files?.[0];
    if (!f0) return;
    setErr("");
    setBusy(true);
    try {
      const file = await convertIfHeic(f0); // ← конвертим при необходимости

      const fileName = `${folder}/${Date.now()}_${file.name}`.replace(/\s+/g, "_");
      const { error } = await supabase.storage
        .from(bucket)
        .upload(fileName, file, { contentType: file.type || "application/octet-stream", upsert: false });

      if (error) throw error;

      const { data: pub } = supabase.storage.from(bucket).getPublicUrl(fileName);
      onUploaded?.({ path: fileName, url: pub?.publicUrl || "", mime: file.type });
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
      e.target.value = ""; // сброс input
    }
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <input
        type="file"
        accept="image/*,.heic,.heif"
        onChange={handleChange}
        disabled={busy}
      />
      {busy && <div>Загрузка...</div>}
      {err && <div style={{ color: "crimson" }}>{err}</div>}
      <small style={{ color: "#6b7280" }}>HEIC конвертируется в JPEG автоматически.</small>
    </div>
  );
}
