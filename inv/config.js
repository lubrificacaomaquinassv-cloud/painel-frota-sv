/** PWA offline + sync Supabase. Lista SAP vem do servidor quando campanha ABERTA. */
window.INVENTARIO_CONFIG = {
  /* Fallback local (piloto / sem campanha aberta) */
  DATA_URL: "./data/piloto_1_item.json",
  PILOTO_ENQUANTO_AGUARDA: true,
  TOLERANCIA_LEVE: 1,
  STORAGE_KEY: "sigcf_inventario_piloto_v1",
  SW_URL: "./sw.js",
  ASSET_VER: "5",
  SUPABASE_URL: "https://azhpxhrwhegfysoeqmft.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6aHB4aHJ3aGVnZnlzb2VxbWZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NzUxODcsImV4cCI6MjA5NDI1MTE4N30.iQU1T1NLaGIQyqScLS6qNaoo1QWcI8Mh-jjN52TU5to",
  /* Preenchido automaticamente ao detectar campanha aberta no Supabase */
  CAMPANHA_ID: "",
};
