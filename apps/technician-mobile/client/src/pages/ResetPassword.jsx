// src/pages/ResetPassword.jsx
import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  // Проверка наличия access_token в ссылке
  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("access_token");

    if (!token) {
      setError("Ссылка недействительна или устарела.");
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      setError(updateError.message);
    } else {
      setDone(true);
    }
  };

  if (done) {
    return (
      <div style={{ padding: 30 }}>
        <h2>Пароль обновлён ✔</h2>
        <p>Теперь можно войти в систему под новым паролем.</p>
        <a href="/login">Перейти к логину</a>
      </div>
    );
  }

  return (
    <div style={{ padding: 30, maxWidth: 400 }}>
      <h2>Создать новый пароль</h2>

      {error && <p style={{ color: "red", marginBottom: 10 }}>{error}</p>}

      <form onSubmit={handleSubmit}>
        <label>Новый пароль</label>
        <input
          type="password"
          style={{
            width: "100%",
            padding: 8,
            marginTop: 5,
            marginBottom: 15,
            borderRadius: 6,
            border: "1px solid #ccc",
          }}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button
          type="submit"
          style={{
            width: "100%",
            padding: 10,
            background: "#2563eb",
            border: "none",
            borderRadius: 6,
            color: "white",
            cursor: "pointer",
          }}
        >
          Сменить пароль
        </button>
      </form>
    </div>
  );
}
